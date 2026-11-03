//! One-time state migration v2 -> v3 (audit Nov 3, H2).
//!
//! v2 = the code deployed on testnet and mainnet since Nov 1 (on-chain code hash
//! 4USWKFGZ…, wasm sha256 339a94ea…, kept as `tests/fixtures/kredofi_v2.wasm`). v3 adds two config
//! fields: `require_production_data` (true unless the account ends in `.testnet`) and
//! `production_data` (false). Every balance, share, borrower and fingerprint is kept.
//! `#[private]`: only the contract account itself can call it, i.e. the same key that can deploy
//! code, so it adds no power. Run it in the same transaction as the deploy (`with-init-call migrate`).
//! (The v1 -> v2 migration of Nov 1 is in git history: both networks were migrated then.)

use crate::*;

#[near(serializers = [borsh])]
pub(crate) struct ConfigV2 {
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
}

#[near(serializers = [borsh])]
pub(crate) struct ContractV2 {
    pub config: ConfigV2,
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
        let old: ContractV2 = env::state_read().unwrap_or_else(|| env::panic_str("No v2 state to migrate"));
        let c = old.config;
        let require_production_data = default_require_production_data();
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
                require_production_data,
                production_data: false,
            },
            pool: old.pool,
            lenders: old.lenders,
            borrowers: old.borrowers,
            fingerprints: old.fingerprints,
            stats: old.stats,
        };
        env::log_str(&format!(
            "Migrated state v2 -> v3 (require_production_data = {require_production_data}, production_data = false)"
        ));
        migrated
    }
}
