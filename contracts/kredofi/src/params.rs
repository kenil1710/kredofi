//! Owner parameter setters (SPEC 4 "Owner").
//!
//! Each setter is owner-only, needs 1 yoctoNEAR, checks the same bounds as `new`, and emits a
//! public `param_changed` event. None of them touches the pool, the reserve or any token: they
//! only change numbers in `config` (rule 10). Durations apply to new loans, except `grace_ns`
//! and `min_hold_ns`, which are read when a loan is defaulted or repaid.

use crate::*;

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 24 * 3600 * SECOND;

/// Shortest allowed loan term, minimum hold, grace and score TTL.
pub const MIN_DURATION_NS: u64 = 60 * SECOND;
pub const MAX_LOAN_TERM_NS: u64 = 365 * DAY;
pub const MAX_GRACE_NS: u64 = 90 * DAY;
pub const MAX_SCORE_TTL_NS: u64 = 365 * DAY;
/// Rule 12: one borrower can never exceed 10% of pool value, so this can only be lowered.
pub const MAX_BORROWER_SHARE_BPS: u16 = 1_000;

/// Bounds shared by `new` and every setter.
pub(crate) fn check_params(c: &Config) {
    let in_range = |v: u64, max: u64| (MIN_DURATION_NS..=max).contains(&v);
    require!(in_range(c.loan_term_ns, MAX_LOAN_TERM_NS), "loan_term_ns must be between 60 s and 365 days");
    require!(in_range(c.grace_ns, MAX_GRACE_NS), "grace_ns must be between 60 s and 90 days");
    require!(in_range(c.score_ttl_ns, MAX_SCORE_TTL_NS), "score_ttl_ns must be between 60 s and 365 days");
    require!(
        c.min_hold_ns >= MIN_DURATION_NS && c.min_hold_ns <= c.loan_term_ns,
        "min_hold_ns must be at least 60 s and at most loan_term_ns"
    );
    require!(
        c.max_borrower_share_bps >= 1 && c.max_borrower_share_bps <= MAX_BORROWER_SHARE_BPS,
        "max_borrower_share_bps must be between 1 and 1000 (rule 12)"
    );
}

#[near]
impl Contract {
    /// Must stay >= `min_hold_ns`: to shorten the term below the current hold, lower the hold first.
    #[payable]
    pub fn set_loan_term_ns(&mut self, value: U64) {
        let old = self.config.loan_term_ns;
        self.update_param("loan_term_ns", U64(old), U64(value.0), |c| c.loan_term_ns = value.0);
    }

    #[payable]
    pub fn set_min_hold_ns(&mut self, value: U64) {
        let old = self.config.min_hold_ns;
        self.update_param("min_hold_ns", U64(old), U64(value.0), |c| c.min_hold_ns = value.0);
    }

    #[payable]
    pub fn set_grace_ns(&mut self, value: U64) {
        let old = self.config.grace_ns;
        self.update_param("grace_ns", U64(old), U64(value.0), |c| c.grace_ns = value.0);
    }

    #[payable]
    pub fn set_score_ttl_ns(&mut self, value: U64) {
        let old = self.config.score_ttl_ns;
        self.update_param("score_ttl_ns", U64(old), U64(value.0), |c| c.score_ttl_ns = value.0);
    }

    #[payable]
    pub fn set_max_borrower_share_bps(&mut self, value: u16) {
        let old = self.config.max_borrower_share_bps;
        self.update_param("max_borrower_share_bps", old, value, |c| c.max_borrower_share_bps = value);
    }

    /// Owner: scores now come from real (Plaid production) bank data, so lender deposits may open
    /// (audit Nov 3, H2). `false` closes new deposits again; withdrawals and loans are unaffected.
    #[payable]
    pub fn set_production_data(&mut self, value: bool) {
        let old = self.config.production_data;
        self.update_param("production_data", old, value, |c| c.production_data = value);
    }
}

impl Contract {
    fn update_param<T: near_sdk::serde::Serialize>(
        &mut self,
        name: &str,
        old: T,
        new: T,
        apply: impl FnOnce(&mut Config),
    ) {
        assert_one_yocto();
        require!(
            env::predecessor_account_id() == self.config.owner,
            "Only the owner can change parameters"
        );
        let mut next = self.config.clone();
        apply(&mut next);
        check_params(&next);
        self.config = next;
        events::emit(
            "param_changed",
            json!({ "param": name, "old": old, "new": new, "by": env::predecessor_account_id() }),
        );
    }
}
