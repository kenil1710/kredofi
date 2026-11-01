//! One-time state migration v1 -> v2 (Nov 1 fee change).
//!
//! v1 = the code deployed on testnet and mainnet before the fee change (wasm sha256
//! ca2556e1…): `Config` had `reserve_share_bps`, `Pool` had no `treasury`. `migrate` reads the
//! v1 state and writes v2 with `treasury = 0`, keeping every balance, share, borrower and
//! fingerprint. It is `#[private]`: only the contract account itself can call it, i.e. the same
//! key that can deploy code, so it adds no new power. Run it in the same transaction as the
//! deploy (`with-init-call migrate`) so the contract is never left unreadable.

use crate::*;

#[near(serializers = [borsh])]
pub(crate) struct ConfigV1 {
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
    pub min_hold_ns: u64,
    pub reserve_share_bps: u16,
    pub max_borrower_share_bps: u16,
}

#[near(serializers = [borsh])]
pub(crate) struct PoolV1 {
    pub cash: u128,
    pub outstanding: u128,
    pub total_shares: u128,
    pub reserve: u128,
}

#[near(serializers = [borsh])]
pub(crate) struct ContractV1 {
    pub config: ConfigV1,
    pub pool: PoolV1,
    pub lenders: LookupMap<AccountId, u128>,
    pub borrowers: LookupMap<AccountId, Borrower>,
    pub fingerprints: LookupMap<[u8; 32], AccountId>,
    pub stats: [BandStats; 4],
}

#[near]
impl Contract {
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: ContractV1 = env::state_read().unwrap_or_else(|| env::panic_str("No v1 state to migrate"));
        let c = old.config;
        let migrated = Self {
            config: Config {
                owner: c.owner,
                usdc: c.usdc,
                scorer_mode: c.scorer_mode,
                dev_scorer: c.dev_scorer,
                outlayer: c.outlayer,
                scorer_project: c.scorer_project,
                scorer_version: c.scorer_version,
                secrets_profile: c.secrets_profile,
                secrets_account: c.secrets_account,
                partner_pubkey: c.partner_pubkey,
                loan_term_ns: c.loan_term_ns,
                grace_ns: c.grace_ns,
                score_ttl_ns: c.score_ttl_ns,
                min_hold_ns: c.min_hold_ns,
                max_borrower_share_bps: c.max_borrower_share_bps,
            },
            pool: Pool {
                cash: old.pool.cash,
                outstanding: old.pool.outstanding,
                total_shares: old.pool.total_shares,
                reserve: old.pool.reserve,
                treasury: 0,
            },
            lenders: old.lenders,
            borrowers: old.borrowers,
            fingerprints: old.fingerprints,
            stats: old.stats,
        };
        env::log_str("Migrated state v1 -> v2 (treasury added, reserve_share_bps removed)");
        migrated
    }
}
