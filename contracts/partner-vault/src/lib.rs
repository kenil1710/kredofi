//! Partner vault: a testnet demo of composability (SPEC 8e). A separate contract that reads KredoFi's
//! public band with a cross-contract view and sets collateral terms from it. KredoFi needs no change
//! and gives no permission. Never deploy to mainnet: `new` refuses any non-test account.
//!
//! Collateral is test USDC. Credit is only a number in this contract: no token is issued and no
//! price feed is used. Terms are fixed when a position opens. There is no owner.

use near_contract_standards::fungible_token::core::ext_ft_core;
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue, assert_one_yocto, env, ext_contract, near, require,
};

pub const STANDARD_RATIO_BPS: u16 = 15_000;
pub const MIN_COLLATERAL: u128 = 1_000_000; // $1
const BPS: u128 = 10_000;

const GAS_READ: Gas = Gas::from_tgas(20);
const GAS_ON_READ: Gas = Gas::from_tgas(15);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_ON_CLOSE: Gas = Gas::from_tgas(10);
/// `ft_on_transfer` itself plus both promises. Below this a read could not finish, so refuse early.
const GAS_MIN_OPEN: Gas = Gas::from_tgas(40);
const GAS_MIN_CLOSE: Gas = Gas::from_tgas(25);

/// The two fields of KredoFi's `get_borrower` this vault uses (serde ignores the rest).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScoreRead {
    pub band: String,
    pub expired: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BorrowerRead {
    pub score: Option<ScoreRead>,
    pub blocked: bool,
}

#[ext_contract(ext_kredofi)]
pub trait KredoFi {
    fn get_borrower(&self, account_id: AccountId) -> Option<BorrowerRead>;
}

#[ext_contract(ext_self)]
pub trait SelfCallbacks {
    fn on_kredofi_read(&mut self, borrower: AccountId, amount: U128) -> U128;
    fn on_close_transfer(&mut self, account: AccountId) -> bool;
}

/// What KredoFi's answer means here: the ratio, and why, in one word.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Terms {
    pub ratio_bps: u16,
    pub basis: &'static str,
}

/// A defaulted, expired or missing score gets standard terms; so does band D.
pub fn terms_for(read: &Option<BorrowerRead>) -> Terms {
    let standard = |basis| Terms { ratio_bps: STANDARD_RATIO_BPS, basis };
    let Some(b) = read else { return standard("no_score") };
    if b.blocked {
        return standard("blocked");
    }
    let Some(s) = &b.score else { return standard("no_score") };
    if s.expired {
        return standard("expired");
    }
    match s.band.as_str() {
        "A" => Terms { ratio_bps: 11_000, basis: "A" },
        "B" => Terms { ratio_bps: 12_500, basis: "B" },
        "C" => Terms { ratio_bps: 14_000, basis: "C" },
        _ => standard("D"),
    }
}

/// Collateral / ratio, rounded down.
pub fn credit_for(collateral: u128, ratio_bps: u16) -> u128 {
    collateral
        .checked_mul(BPS)
        .unwrap_or_else(|| env::panic_str("Math overflow"))
        / u128::from(ratio_bps)
}

/// Testnet names, plus sandbox sub-accounts of `test.near` (near-workspaces' root) for the tests.
pub fn is_test_account(id: &str) -> bool {
    id.ends_with(".testnet") || id.ends_with(".test.near")
}

#[near]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Position {
    pub collateral: u128,
    pub credit: u128,
    pub ratio_bps: u16,
    pub basis: String,
    pub opened_at: u64,
    /// Collateral is on its way back. Blocks a new position until the transfer has settled.
    pub closing: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PositionView {
    pub collateral: U128,
    pub credit: U128,
    pub ratio_bps: u16,
    pub basis: String,
    pub opened_at: U64,
    pub closing: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VaultStats {
    pub kredofi: AccountId,
    pub usdc: AccountId,
    pub open_positions: u32,
    pub total_collateral: U128,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Positions,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    kredofi: AccountId,
    usdc: AccountId,
    positions: LookupMap<AccountId, Position>,
    open_positions: u32,
    total_collateral: u128,
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "kredofi_partner_vault", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

#[near]
impl Contract {
    #[init]
    #[private]
    pub fn new(kredofi: AccountId, usdc: AccountId) -> Self {
        require!(is_test_account(env::current_account_id().as_str()), "The partner vault is a testnet demo");
        Self {
            kredofi,
            usdc,
            positions: LookupMap::new(StorageKey::Positions),
            open_positions: 0,
            total_collateral: 0,
        }
    }

    /// Runs after KredoFi answers. The returned amount goes back to the borrower (NEP-141): the full
    /// amount refuses the position, 0 keeps the collateral. A panic here refunds in full as well.
    #[private]
    pub fn on_kredofi_read(
        &mut self,
        borrower: AccountId,
        amount: U128,
        #[callback_result] read: Result<Option<BorrowerRead>, PromiseError>,
    ) -> U128 {
        let refuse = |reason: &str| {
            emit("position_refused", json!({ "account": borrower, "amount": amount, "reason": reason }));
            amount
        };
        let Ok(read) = read else { return refuse("kredofi_read_failed") };
        // A second transfer sent at the same time passes the first check; only one can land here.
        if self.positions.contains_key(&borrower) {
            return refuse("position_exists");
        }
        let terms = terms_for(&read);
        let credit = credit_for(amount.0, terms.ratio_bps);
        self.positions.insert(
            borrower.clone(),
            Position {
                collateral: amount.0,
                credit,
                ratio_bps: terms.ratio_bps,
                basis: terms.basis.to_string(),
                opened_at: env::block_timestamp(),
                closing: false,
            },
        );
        self.open_positions += 1;
        self.total_collateral = self
            .total_collateral
            .checked_add(amount.0)
            .unwrap_or_else(|| env::panic_str("Math overflow"));
        emit(
            "position_opened",
            json!({ "account": borrower, "collateral": amount, "credit": U128(credit), "ratio_bps": terms.ratio_bps, "basis": terms.basis }),
        );
        U128(0)
    }

    /// Give the collateral back and cancel the credit. The position stays marked until the transfer settles.
    #[payable]
    pub fn close_position(&mut self) -> Promise {
        assert_one_yocto();
        require!(env::prepaid_gas() >= GAS_MIN_CLOSE, "Attach at least 25 Tgas");
        let account = env::predecessor_account_id();
        let position = self.positions.get_mut(&account).unwrap_or_else(|| env::panic_str("No open position"));
        require!(!position.closing, "This position is already closing");
        position.closing = true;
        let collateral = position.collateral;
        ext_ft_core::ext(self.usdc.clone())
            .with_static_gas(GAS_FT_TRANSFER)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .ft_transfer(account.clone(), U128(collateral), Some("partner vault: position closed".to_string()))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_ON_CLOSE).on_close_transfer(account))
    }

    /// Transfer done: remove the position. Transfer failed: the position stays open, nothing was lost.
    #[private]
    pub fn on_close_transfer(&mut self, account: AccountId, #[callback_result] sent: Result<(), PromiseError>) -> bool {
        let position = self.positions.get_mut(&account).unwrap_or_else(|| env::panic_str("No open position"));
        if sent.is_err() {
            position.closing = false;
            emit("position_close_failed", json!({ "account": account }));
            return false;
        }
        let collateral = position.collateral;
        self.positions.remove(&account);
        self.open_positions -= 1;
        self.total_collateral = self
            .total_collateral
            .checked_sub(collateral)
            .unwrap_or_else(|| env::panic_str("Math overflow"));
        emit("position_closed", json!({ "account": account, "collateral": U128(collateral) }));
        true
    }

    pub fn get_position(&self, account_id: AccountId) -> Option<PositionView> {
        self.positions.get(&account_id).map(|p| PositionView {
            collateral: U128(p.collateral),
            credit: U128(p.credit),
            ratio_bps: p.ratio_bps,
            basis: p.basis.clone(),
            opened_at: U64(p.opened_at),
            closing: p.closing,
        })
    }

    pub fn get_stats(&self) -> VaultStats {
        VaultStats {
            kredofi: self.kredofi.clone(),
            usdc: self.usdc.clone(),
            open_positions: self.open_positions,
            total_collateral: U128(self.total_collateral),
        }
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    /// `ft_transfer_call(vault, amount, "open")`. Any panic here refunds the sender in full.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "Only test USDC is accepted");
        require!(msg == "open", "The only message is open");
        require!(amount.0 >= MIN_COLLATERAL, "The smallest position is $1");
        require!(env::prepaid_gas() >= GAS_MIN_OPEN, "Attach more gas to ft_transfer_call");
        require!(!self.positions.contains_key(&sender_id), "This account already has a position");
        ext_kredofi::ext(self.kredofi.clone())
            .with_static_gas(GAS_READ)
            .get_borrower(sender_id.clone())
            .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_ON_READ).on_kredofi_read(sender_id, amount))
            .into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const USDC: u128 = 1_000_000;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ctx(current: &str, predecessor: &str, deposit: u128, gas: u64) {
        testing_env!(
            VMContextBuilder::new()
                .current_account_id(acc(current))
                .predecessor_account_id(acc(predecessor))
                .attached_deposit(NearToken::from_yoctonear(deposit))
                .prepaid_gas(Gas::from_tgas(gas))
                .build()
        );
    }

    const VAULT: &str = "partner-vault.kency.testnet";

    fn vault() -> Contract {
        ctx(VAULT, VAULT, 0, 100);
        Contract::new(acc("app.kency.testnet"), acc("musdc.kency.testnet"))
    }

    fn read(band: &str, expired: bool, blocked: bool) -> Option<BorrowerRead> {
        Some(BorrowerRead { score: Some(ScoreRead { band: band.into(), expired }), blocked })
    }

    fn open(v: &mut Contract, who: &str, usd: u128, r: Option<BorrowerRead>) -> U128 {
        ctx(VAULT, VAULT, 0, 100);
        v.on_kredofi_read(acc(who), U128(usd * USDC), Ok(r))
    }

    #[test]
    fn terms_table() {
        let t = |r: Option<BorrowerRead>| terms_for(&r);
        assert_eq!(t(read("A", false, false)), Terms { ratio_bps: 11_000, basis: "A" });
        assert_eq!(t(read("B", false, false)), Terms { ratio_bps: 12_500, basis: "B" });
        assert_eq!(t(read("C", false, false)), Terms { ratio_bps: 14_000, basis: "C" });
        assert_eq!(t(read("D", false, false)), Terms { ratio_bps: 15_000, basis: "D" });
        assert_eq!(t(None), Terms { ratio_bps: 15_000, basis: "no_score" });
        assert_eq!(t(Some(BorrowerRead { score: None, blocked: false })), Terms { ratio_bps: 15_000, basis: "no_score" });
        // A good band doesn't help once the score expired or the account defaulted.
        assert_eq!(t(read("A", true, false)), Terms { ratio_bps: 15_000, basis: "expired" });
        assert_eq!(t(read("A", false, true)), Terms { ratio_bps: 15_000, basis: "blocked" });
        assert_eq!(t(read("Z", false, false)).ratio_bps, STANDARD_RATIO_BPS);
    }

    #[test]
    fn credit_math_rounds_down() {
        assert_eq!(credit_for(110 * USDC, 11_000), 100_000_000);
        assert_eq!(credit_for(110 * USDC, 12_500), 88_000_000);
        assert_eq!(credit_for(110 * USDC, 14_000), 78_571_428);
        assert_eq!(credit_for(110 * USDC, 15_000), 73_333_333);
        assert_eq!(credit_for(1, 15_000), 0);
    }

    #[test]
    #[should_panic(expected = "Math overflow")]
    fn credit_math_is_checked() {
        credit_for(u128::MAX, 11_000);
    }

    #[test]
    fn test_accounts_only() {
        for ok in [VAULT, "vault.test.near"] {
            assert!(is_test_account(ok), "{ok}");
        }
        for no in ["partner-vault.near", "test.near", "kredofi.near", "testnet", &"a".repeat(64)] {
            assert!(!is_test_account(no), "{no}");
        }
    }

    #[test]
    #[should_panic(expected = "testnet demo")]
    fn refuses_to_init_on_mainnet() {
        ctx("partner-vault.near", "partner-vault.near", 0, 100);
        let _ = Contract::new(acc("kredofi.near"), acc("usdc.near"));
    }

    #[test]
    fn opens_a_position_and_counts_it() {
        let mut v = vault();
        assert_eq!(open(&mut v, "riya.testnet", 110, read("A", false, false)), U128(0));
        let p = v.get_position(acc("riya.testnet")).unwrap();
        assert_eq!((p.collateral.0, p.credit.0, p.ratio_bps, p.basis.as_str(), p.closing), (110 * USDC, 100 * USDC, 11_000, "A", false));
        let s = v.get_stats();
        assert_eq!((s.open_positions, s.total_collateral.0), (1, 110 * USDC));
    }

    #[test]
    fn failed_read_refunds_everything_and_changes_nothing() {
        let mut v = vault();
        ctx(VAULT, VAULT, 0, 100);
        assert_eq!(v.on_kredofi_read(acc("riya.testnet"), U128(5 * USDC), Err(PromiseError::Failed)), U128(5 * USDC));
        assert!(v.get_position(acc("riya.testnet")).is_none());
        assert_eq!(v.get_stats().open_positions, 0);
    }

    #[test]
    fn a_second_position_landing_at_the_same_time_is_refunded() {
        let mut v = vault();
        open(&mut v, "riya.testnet", 110, read("A", false, false));
        assert_eq!(open(&mut v, "riya.testnet", 50, read("A", false, false)), U128(50 * USDC));
        let p = v.get_position(acc("riya.testnet")).unwrap();
        assert_eq!(p.collateral.0, 110 * USDC);
        assert_eq!(v.get_stats().total_collateral.0, 110 * USDC);
    }

    #[test]
    #[should_panic(expected = "Only test USDC")]
    fn another_token_is_refused() {
        let mut v = vault();
        ctx(VAULT, "fake-usdc.testnet", 0, 100);
        let _ = v.ft_on_transfer(acc("riya.testnet"), U128(110 * USDC), "open".into());
    }

    #[test]
    #[should_panic(expected = "only message")]
    fn another_message_is_refused() {
        let mut v = vault();
        ctx(VAULT, "musdc.kency.testnet", 0, 100);
        let _ = v.ft_on_transfer(acc("riya.testnet"), U128(110 * USDC), "repay".into());
    }

    #[test]
    #[should_panic(expected = "smallest position")]
    fn dust_is_refused() {
        let mut v = vault();
        ctx(VAULT, "musdc.kency.testnet", 0, 100);
        let _ = v.ft_on_transfer(acc("riya.testnet"), U128(USDC - 1), "open".into());
    }

    #[test]
    #[should_panic(expected = "Attach more gas")]
    fn too_little_gas_is_refused_before_the_read() {
        let mut v = vault();
        ctx(VAULT, "musdc.kency.testnet", 0, 39);
        let _ = v.ft_on_transfer(acc("riya.testnet"), U128(110 * USDC), "open".into());
    }

    #[test]
    #[should_panic(expected = "already has a position")]
    fn second_open_is_refused_up_front() {
        let mut v = vault();
        open(&mut v, "riya.testnet", 110, read("A", false, false));
        ctx(VAULT, "musdc.kency.testnet", 0, 100);
        let _ = v.ft_on_transfer(acc("riya.testnet"), U128(USDC), "open".into());
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn close_needs_one_yocto() {
        let mut v = vault();
        open(&mut v, "riya.testnet", 110, read("A", false, false));
        ctx(VAULT, "riya.testnet", 0, 100);
        let _ = v.close_position();
    }

    #[test]
    #[should_panic(expected = "No open position")]
    fn only_your_own_position_can_be_closed() {
        let mut v = vault();
        open(&mut v, "riya.testnet", 110, read("A", false, false));
        ctx(VAULT, "thief.testnet", 1, 100);
        let _ = v.close_position();
    }

    #[test]
    fn close_marks_then_removes_and_a_failed_transfer_restores() {
        let mut v = vault();
        open(&mut v, "riya.testnet", 110, read("A", false, false));
        ctx(VAULT, "riya.testnet", 1, 100);
        let _ = v.close_position();
        assert!(v.get_position(acc("riya.testnet")).unwrap().closing);

        ctx(VAULT, VAULT, 0, 100);
        assert!(!v.on_close_transfer(acc("riya.testnet"), Err(PromiseError::Failed)));
        let p = v.get_position(acc("riya.testnet")).unwrap();
        assert_eq!((p.closing, p.collateral.0), (false, 110 * USDC));
        assert_eq!(v.get_stats().total_collateral.0, 110 * USDC);

        ctx(VAULT, "riya.testnet", 1, 100);
        let _ = v.close_position();
        ctx(VAULT, VAULT, 0, 100);
        assert!(v.on_close_transfer(acc("riya.testnet"), Ok(())));
        assert!(v.get_position(acc("riya.testnet")).is_none());
        let s = v.get_stats();
        assert_eq!((s.open_positions, s.total_collateral.0), (0, 0));
    }

    #[test]
    #[should_panic(expected = "already closing")]
    fn cannot_close_twice_while_settling() {
        let mut v = vault();
        open(&mut v, "riya.testnet", 110, read("A", false, false));
        ctx(VAULT, "riya.testnet", 1, 100);
        let _ = v.close_position();
        let _ = v.close_position();
    }
}
