//! One-time state migration v3 -> v4 (security review 2, High: scorer re-pin time lock).
//!
//! v3 = the code deployed on `kredofi.near` since Nov 3 (wasm sha256 b7f55eaf…, kept as
//! `tests/fixtures/kredofi_v3.wasm`, fetched from mainnet). v4 adds two config fields:
//! `scorer_delay_ns` (24 h unless the account ends in `.testnet`, then 60 s) and `pending_scorer`
//! (none). Every balance, share, borrower and fingerprint is kept.
//! `#[private]`: only the contract account itself can call it, i.e. the same key that can deploy
//! code, so it adds no power. Run it in the same transaction as the deploy (`with-init-call migrate`).
//! (Earlier migrations, v1 -> v2 on Nov 1 and v2 -> v3 on Nov 3, are in git history.)

use crate::*;

#[near(serializers = [borsh])]
pub(crate) struct ConfigV3 {
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
    pub max_borrower_share_bps: u16,
    pub require_production_data: bool,
    pub production_data: bool,
}

#[near(serializers = [borsh])]
pub(crate) struct ContractV3 {
    pub config: ConfigV3,
    pub pool: Pool,
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
        let raw = env::storage_read(b"STATE").unwrap_or_else(|| env::panic_str("No v3 state to migrate"));
        // Exact parse: v4 state is longer (two more config fields), so reading it as v3 fails and a
        // second migrate can't wipe a pending change.
        let old: ContractV3 = near_sdk::borsh::from_slice(&raw)
            .unwrap_or_else(|_| env::panic_str("State is not v3; nothing to migrate"));
        let c = old.config;
        let delay = default_scorer_delay_ns();
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
                require_production_data: c.require_production_data,
                production_data: c.production_data,
                scorer_delay_ns: delay,
                pending_scorer: None,
            },
            pool: old.pool,
            lenders: old.lenders,
            borrowers: old.borrowers,
            fingerprints: old.fingerprints,
            stats: old.stats,
        };
        env::log_str(&format!("Migrated state v3 -> v4 (scorer_delay_ns = {delay}, no pending scorer change)"));
        migrated
    }
}
