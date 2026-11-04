//! Time lock on scorer re-pins (security review 2, High R2-H).
//!
//! The scorer version decides who gets a score, so an instant re-pin by a stolen owner key could
//! pin a scorer that hands out band A and borrow the pool out. Now a new version is first proposed
//! in public (`scorer_change_proposed`), and only after `scorer_delay_ns` can the owner apply it
//! (`scorer_version_changed`). Anyone watching sees the pending change (`get_pending_scorer`, the
//! `/mainnet` page) and has the whole delay to withdraw or stop borrowing; the owner can cancel.
//!
//! Delay bounds: mainnet (any account not ending in `.testnet`) at least 1 h, default 24 h;
//! testnet at least and by default 60 s. At most 30 days. `set_scorer_delay_ns` can only raise it,
//! so a stolen key can't shorten the lock first.

use crate::*;

const SECOND: u64 = 1_000_000_000;
const HOUR: u64 = 3600 * SECOND;
pub const MAINNET_MIN_SCORER_DELAY_NS: u64 = HOUR;
pub const MAINNET_DEFAULT_SCORER_DELAY_NS: u64 = 24 * HOUR;
pub const TESTNET_SCORER_DELAY_NS: u64 = 60 * SECOND;
pub const MAX_SCORER_DELAY_NS: u64 = 30 * 24 * HOUR;

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingScorer {
    pub version: String,
    pub proposed_at: u64,
    pub apply_at: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingScorerView {
    pub version: String,
    pub proposed_at: U64,
    pub apply_at: U64,
}

impl From<&PendingScorer> for PendingScorerView {
    fn from(p: &PendingScorer) -> Self {
        Self { version: p.version.clone(), proposed_at: U64(p.proposed_at), apply_at: U64(p.apply_at) }
    }
}

fn is_testnet() -> bool {
    env::current_account_id().as_str().ends_with(".testnet")
}

pub(crate) fn min_scorer_delay_ns() -> u64 {
    if is_testnet() { TESTNET_SCORER_DELAY_NS } else { MAINNET_MIN_SCORER_DELAY_NS }
}

pub(crate) fn default_scorer_delay_ns() -> u64 {
    if is_testnet() { TESTNET_SCORER_DELAY_NS } else { MAINNET_DEFAULT_SCORER_DELAY_NS }
}

#[near]
impl Contract {
    /// Owner: propose a new scorer version (WASM SHA-256). It can be applied after `scorer_delay_ns`.
    /// Only one change can be pending; cancel it first to propose another.
    #[payable]
    pub fn propose_scorer_version(&mut self, version: String) {
        self.require_owner_yocto();
        require!(is_sha256_hex(&version), "scorer_version must be a 64-char lowercase hex SHA-256");
        require!(version != self.config.scorer_version, "This version is already pinned");
        require!(self.config.pending_scorer.is_none(), "A scorer change is already pending; cancel it first");
        let now = env::block_timestamp();
        let apply_at = now
            .checked_add(self.config.scorer_delay_ns)
            .unwrap_or_else(|| env::panic_str("Time overflow"));
        self.config.pending_scorer = Some(PendingScorer { version: version.clone(), proposed_at: now, apply_at });
        events::emit(
            "scorer_change_proposed",
            json!({
                "old": self.config.scorer_version,
                "new": version,
                "apply_at": U64(apply_at),
                "by": env::predecessor_account_id(),
            }),
        );
    }

    /// Owner: pin the pending version once its delay has passed.
    #[payable]
    pub fn apply_scorer_version(&mut self) {
        self.require_owner_yocto();
        let p = self.config.pending_scorer.clone().unwrap_or_else(|| env::panic_str("No scorer change is pending"));
        require!(env::block_timestamp() >= p.apply_at, "The scorer change is still in its time lock");
        self.config.pending_scorer = None;
        let old = std::mem::replace(&mut self.config.scorer_version, p.version.clone());
        events::emit(
            "scorer_version_changed",
            json!({ "old": old, "new": p.version, "by": env::predecessor_account_id() }),
        );
    }

    /// Owner: drop the pending change (also the way to react to a proposal made with a stolen key).
    #[payable]
    pub fn cancel_scorer_version(&mut self) {
        self.require_owner_yocto();
        let p = self.config.pending_scorer.take().unwrap_or_else(|| env::panic_str("No scorer change is pending"));
        events::emit(
            "scorer_change_cancelled",
            json!({ "version": p.version, "by": env::predecessor_account_id() }),
        );
    }

    /// Owner: lengthen the time lock. It can never be shortened.
    #[payable]
    pub fn set_scorer_delay_ns(&mut self, value: U64) {
        let old = self.config.scorer_delay_ns;
        require!(value.0 >= old, "The scorer time lock can only be increased");
        self.update_param("scorer_delay_ns", U64(old), U64(value.0), |c| c.scorer_delay_ns = value.0);
    }

    pub fn get_pending_scorer(&self) -> Option<PendingScorerView> {
        self.config.pending_scorer.as_ref().map(PendingScorerView::from)
    }
}

impl Contract {
    fn require_owner_yocto(&self) {
        assert_one_yocto();
        require!(
            env::predecessor_account_id() == self.config.owner,
            "Only the owner can change the scorer version"
        );
    }
}
