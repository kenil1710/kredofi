//! KredoFi: private, income-based stablecoin loans on NEAR.
//!
//! Built so far (docs/PLAN.md): config, lending pool, lender deposit and withdraw,
//! reserve seeding, share math (day 1); scores, expiry, fingerprints, limits (day 2).
//! Loans arrive on day 3.
//!
//! Money rules (SPEC 3, 7):
//! - Pool value = `cash + outstanding`. The reserve is separate and is not lender money.
//! - State is written before every token transfer; every transfer has a callback that
//!   rolls the state back if the transfer fails (rule 7).
//! - There is no owner method that moves lender funds or the reserve (rule 10).

mod events;
mod math;
mod score;

pub use score::*;

use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
    assert_one_yocto, env, ext_contract, near, require,
};

/// Gas for `usdc.ft_transfer`.
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
/// Gas reserved for our own rollback callbacks. Generous: a callback that runs out of gas
/// could not roll back.
const GAS_CALLBACK: Gas = Gas::from_tgas(15);

const MAX_BPS: u16 = 10_000;

pub const MSG_DEPOSIT: &str = "deposit";
pub const MSG_SEED_RESERVE: &str = "seed_reserve";

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Lenders,
    Borrowers,
    Fingerprints,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScorerMode {
    /// `dev_scorer` submits scorer output with `dev_submit_score` (local and testnet).
    Dev,
    /// Scores come only from the contract's own OutLayer request (mainnet).
    OutLayer,
}

/// Init arguments. Times are nanoseconds as JSON strings; `partner_pubkey` is x25519 hex.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ConfigInput {
    pub owner: AccountId,
    pub usdc: AccountId,
    pub scorer_mode: ScorerMode,
    pub dev_scorer: Option<AccountId>,
    pub outlayer: AccountId,
    pub scorer_project: String,
    pub scorer_version: String,
    pub secrets_profile: String,
    pub secrets_account: AccountId,
    pub partner_pubkey: String,
    pub loan_term_ns: U64,
    pub grace_ns: U64,
    pub score_ttl_ns: U64,
    pub reserve_share_bps: u16,
    pub max_borrower_share_bps: u16,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Config {
    pub owner: AccountId,
    pub usdc: AccountId,
    pub scorer_mode: ScorerMode,
    pub dev_scorer: Option<AccountId>,
    pub outlayer: AccountId,
    pub scorer_project: String,
    pub scorer_version: String,
    pub secrets_profile: String,
    pub secrets_account: AccountId,
    pub partner_pubkey: [u8; 32],
    pub loan_term_ns: u64,
    pub grace_ns: u64,
    pub score_ttl_ns: u64,
    /// Repaying before this (half the loan term) does not raise the level (rule 13).
    pub min_hold_ns: u64,
    pub reserve_share_bps: u16,
    pub max_borrower_share_bps: u16,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigView {
    pub owner: AccountId,
    pub usdc: AccountId,
    pub scorer_mode: ScorerMode,
    pub dev_scorer: Option<AccountId>,
    pub outlayer: AccountId,
    pub scorer_project: String,
    pub scorer_version: String,
    pub secrets_profile: String,
    pub secrets_account: AccountId,
    pub partner_pubkey: String,
    pub loan_term_ns: U64,
    pub grace_ns: U64,
    pub score_ttl_ns: U64,
    pub min_hold_ns: U64,
    pub reserve_share_bps: u16,
    pub max_borrower_share_bps: u16,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Pool {
    /// USDC held for lending (6 decimals).
    pub cash: u128,
    /// Principal currently lent out.
    pub outstanding: u128,
    pub total_shares: u128,
    /// First-loss reserve: owner seed + share of interest. Not part of pool value.
    pub reserve: u128,
}

impl Pool {
    pub fn value(&self) -> u128 {
        math::add(self.cash, self.outstanding)
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolView {
    pub cash: U128,
    pub outstanding: U128,
    pub total_shares: U128,
    pub reserve: U128,
    /// `cash + outstanding`
    pub pool_value: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LenderView {
    pub shares: U128,
    /// What the shares are worth now, in USDC base units (rounded down).
    pub value: U128,
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    config: Config,
    pool: Pool,
    /// Lender shares.
    lenders: LookupMap<AccountId, u128>,
    borrowers: LookupMap<AccountId, Borrower>,
    /// One bank identity, one borrower (rule 6).
    fingerprints: LookupMap<[u8; 32], AccountId>,
    /// Per band, indexed by `Band::index()` (A, B, C, D).
    stats: [BandStats; 4],
}

#[near]
impl Contract {
    #[init]
    pub fn new(config: ConfigInput) -> Self {
        Self {
            config: validate_config(config),
            pool: Pool::default(),
            lenders: LookupMap::new(StorageKey::Lenders),
            borrowers: LookupMap::new(StorageKey::Borrowers),
            fingerprints: LookupMap::new(StorageKey::Fingerprints),
            stats: Default::default(),
        }
    }

    // ---------------------------------------------------------------- NEP-141 receiver

    /// Entry point for USDC sent with `ft_transfer_call`.
    /// `msg`: `"deposit"` (lender) or `"seed_reserve"` (owner only).
    /// Any panic here makes the token contract refund the full amount to the sender.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.config.usdc,
            "Only the configured USDC token is accepted"
        );
        require!(amount.0 > 0, "Amount must be positive");
        match msg.as_str() {
            MSG_DEPOSIT => self.internal_deposit(sender_id, amount.0),
            MSG_SEED_RESERVE => self.internal_seed_reserve(sender_id, amount.0),
            _ => env::panic_str("Unknown msg; expected \"deposit\" or \"seed_reserve\""),
        }
        // All tokens used.
        PromiseOrValue::Value(U128(0))
    }

    // ---------------------------------------------------------------- Lender

    /// Burn `shares` and receive their current value in USDC, limited by pool `cash`.
    /// Requires 1 yoctoNEAR (full-access key confirmation).
    #[payable]
    pub fn withdraw(&mut self, shares: U128) -> Promise {
        assert_one_yocto();
        let lender = env::predecessor_account_id();
        let shares = shares.0;
        require!(shares > 0, "Shares must be positive");
        let owned = self.lender_shares(&lender);
        require!(shares <= owned, "Not enough shares");

        let amount = math::value_of_shares(shares, self.pool.value(), self.pool.total_shares);
        require!(amount > 0, "Withdrawal rounds to zero USDC");
        require!(
            amount <= self.pool.cash,
            "Not enough cash in the pool right now; withdraw fewer shares"
        );

        // State first (rule 7).
        self.set_lender_shares(&lender, math::sub(owned, shares));
        self.pool.total_shares = math::sub(self.pool.total_shares, shares);
        self.pool.cash = math::sub(self.pool.cash, amount);

        ext_ft::ext(self.config.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(lender.clone(), U128(amount), Some("KredoFi withdraw".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_withdraw_transfer(lender, U128(shares), U128(amount)),
            )
    }

    /// Rollback callback for `withdraw`. Returns true if the lender was paid.
    #[private]
    pub fn on_withdraw_transfer(&mut self, lender: AccountId, shares: U128, amount: U128) -> bool {
        if near_sdk::is_promise_success() {
            events::emit(
                "lender_withdraw",
                json!({
                    "lender": lender,
                    "shares": shares,
                    "amount": amount,
                }),
            );
            true
        } else {
            let owned = self.lender_shares(&lender);
            self.set_lender_shares(&lender, math::add(owned, shares.0));
            self.pool.total_shares = math::add(self.pool.total_shares, shares.0);
            self.pool.cash = math::add(self.pool.cash, amount.0);
            env::log_str(&format!(
                "Withdraw transfer to {lender} failed; restored {} shares",
                shares.0
            ));
            false
        }
    }

    // ---------------------------------------------------------------- Views

    pub fn get_config(&self) -> ConfigView {
        let c = &self.config;
        ConfigView {
            owner: c.owner.clone(),
            usdc: c.usdc.clone(),
            scorer_mode: c.scorer_mode,
            dev_scorer: c.dev_scorer.clone(),
            outlayer: c.outlayer.clone(),
            scorer_project: c.scorer_project.clone(),
            scorer_version: c.scorer_version.clone(),
            secrets_profile: c.secrets_profile.clone(),
            secrets_account: c.secrets_account.clone(),
            partner_pubkey: hex_encode(&c.partner_pubkey),
            loan_term_ns: U64(c.loan_term_ns),
            grace_ns: U64(c.grace_ns),
            score_ttl_ns: U64(c.score_ttl_ns),
            min_hold_ns: U64(c.min_hold_ns),
            reserve_share_bps: c.reserve_share_bps,
            max_borrower_share_bps: c.max_borrower_share_bps,
        }
    }

    pub fn get_pool(&self) -> PoolView {
        PoolView {
            cash: U128(self.pool.cash),
            outstanding: U128(self.pool.outstanding),
            total_shares: U128(self.pool.total_shares),
            reserve: U128(self.pool.reserve),
            pool_value: U128(self.pool.value()),
        }
    }

    pub fn get_lender(&self, account_id: AccountId) -> LenderView {
        let shares = self.lender_shares(&account_id);
        LenderView {
            shares: U128(shares),
            value: U128(math::value_of_shares(
                shares,
                self.pool.value(),
                self.pool.total_shares,
            )),
        }
    }
}

// -------------------------------------------------------------------- internal

impl Contract {
    fn internal_deposit(&mut self, lender: AccountId, amount: u128) {
        let shares =
            math::shares_for_deposit(amount, self.pool.value(), self.pool.total_shares);
        require!(shares > 0, "Deposit too small for one share");
        let owned = self.lender_shares(&lender);
        self.set_lender_shares(&lender, math::add(owned, shares));
        self.pool.total_shares = math::add(self.pool.total_shares, shares);
        self.pool.cash = math::add(self.pool.cash, amount);
        events::emit(
            "lender_deposit",
            json!({
                "lender": lender,
                "amount": U128(amount),
                "shares": U128(shares),
            }),
        );
    }

    fn internal_seed_reserve(&mut self, sender: AccountId, amount: u128) {
        require!(sender == self.config.owner, "Only the owner can seed the reserve");
        self.pool.reserve = math::add(self.pool.reserve, amount);
        events::emit(
            "reserve_seeded",
            json!({
                "by": sender,
                "amount": U128(amount),
                "reserve": U128(self.pool.reserve),
            }),
        );
    }

    fn lender_shares(&self, account: &AccountId) -> u128 {
        self.lenders.get(account).copied().unwrap_or(0)
    }

    fn set_lender_shares(&mut self, account: &AccountId, shares: u128) {
        if shares == 0 {
            self.lenders.remove(account);
        } else {
            self.lenders.insert(account.clone(), shares);
        }
    }
}

fn validate_config(c: ConfigInput) -> Config {
    require!(
        c.reserve_share_bps <= MAX_BPS && c.max_borrower_share_bps <= MAX_BPS,
        "bps values must be <= 10000"
    );
    require!(c.max_borrower_share_bps > 0, "max_borrower_share_bps must be positive");
    require!(c.loan_term_ns.0 > 0, "loan_term_ns must be positive");
    require!(c.score_ttl_ns.0 > 0, "score_ttl_ns must be positive");
    require!(
        is_sha256_hex(&c.scorer_version),
        "scorer_version must be a 64-char lowercase hex SHA-256"
    );
    if c.scorer_mode == ScorerMode::Dev {
        require!(c.dev_scorer.is_some(), "Dev mode needs a dev_scorer account");
    }
    let partner_pubkey: [u8; 32] = hex_decode(&c.partner_pubkey)
        .and_then(|v| v.try_into().ok())
        .unwrap_or_else(|| env::panic_str("partner_pubkey must be 32 bytes of hex"));
    Config {
        owner: c.owner,
        usdc: c.usdc,
        scorer_mode: c.scorer_mode,
        dev_scorer: c.dev_scorer,
        outlayer: c.outlayer,
        scorer_project: c.scorer_project,
        scorer_version: c.scorer_version,
        secrets_profile: c.secrets_profile,
        secrets_account: c.secrets_account,
        partner_pubkey,
        loan_term_ns: c.loan_term_ns.0,
        grace_ns: c.grace_ns.0,
        score_ttl_ns: c.score_ttl_ns.0,
        min_hold_ns: c.loan_term_ns.0 / 2,
        reserve_share_bps: c.reserve_share_bps,
        max_borrower_share_bps: c.max_borrower_share_bps,
    }
}

pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

pub(crate) fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod score_tests;
