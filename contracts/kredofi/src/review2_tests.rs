//! Security review 2 (AI-assisted, not a professional audit): the reviewer's proofs, turned into
//! regression tests after the fixes (docs/SECURITY_AUDIT.md, Review 2).

use crate::tests::*;
use crate::*;
use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::STANDARD as B64;
use near_sdk::serde_json::{Value, json};
use near_sdk::{PromiseResult, RuntimeFeesConfig, testing_env};

const USDC: u128 = 1_000_000;
const DAY: u64 = 24 * 3600 * 1_000_000_000;

fn riya() -> AccountId {
    acc("riya.near")
}

fn out(who: &AccountId, band: &str, score: u64, fp: u8) -> Value {
    json!({
        "v": 1, "caller": who, "band": band, "score": score,
        "income_cap": 1_000 * USDC as u64,
        "fingerprint": format!("{fp:02x}").repeat(32),
        "sealed_identity": B64.encode(b"sealed-name"),
    })
}

fn outlayer_pool() -> Contract {
    set(owner());
    let mut i = config_input();
    i.scorer_mode = ScorerMode::OutLayer;
    i.dev_scorer = None;
    let mut c = Contract::new(i);
    deposit(&mut c, alice(), 1_000 * USDC);
    c
}

fn request_at(c: &mut Contract, who: AccountId, ts: u64) {
    testing_env!(ctx(who).block_timestamp(ts).attached_deposit(NearToken::from_millinear(10)).build());
    let _ = c.request_score("public-sandbox".into(), "aa".repeat(32));
}

fn callback_at(ts: u64, result: PromiseResult) {
    testing_env!(
        ctx(pool_id()).block_timestamp(ts).build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

fn borrow_ok(c: &mut Contract, who: AccountId, amount: u128, ts: u64) {
    testing_env!(ctx(who.clone()).block_timestamp(ts).attached_deposit(NearToken::from_yoctonear(1)).build());
    let _ = c.borrow(U128(amount));
    callback_at(ts, PromiseResult::Successful(vec![]));
    assert!(c.on_borrow_transfer(who, U128(amount), None));
}

/// Riya scored A (fingerprint 0x11) through OutLayer at t=0.
fn scored_pool() -> Contract {
    let mut c = outlayer_pool();
    request_at(&mut c, riya(), 0);
    callback_at(0, PromiseResult::Successful(near_sdk::serde_json::to_vec(&out(&riya(), "A", 1000, 0x11)).unwrap()));
    assert!(c.on_score(riya()));
    c
}



/// Checked: running `migrate` on already-migrated (v4) state panics instead of mis-reading the
/// layout or wiping a pending scorer change, for realistic and for extreme balances.
#[test]
#[should_panic(expected = "State is not v3")]
fn r2_migrate_on_v4_state_panics() {
    let mut c = scored_pool();
    c.pool.treasury = (1u128 << 112) - 1;
    c.pool.reserve = u128::MAX;
    c.config.production_data = true;
    set(pool_id());
    env::state_write(&c);
    let _ = Contract::migrate();
}


/// Checked: amounts 0, 1, u128::MAX on every entry point fail cleanly (no wrap).
#[test]
fn r2_integer_edges_fail_cleanly() {
    let mut c = scored_pool();
    for amt in [0u128, u128::MAX] {
        testing_env!(ctx(riya()).attached_deposit(NearToken::from_yoctonear(1)).build());
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = c.borrow(U128(amt)); })).is_err());
        testing_env!(ctx(alice()).attached_deposit(NearToken::from_yoctonear(1)).build());
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = c.withdraw(U128(amt)); })).is_err());
        set(usdc());
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = c.ft_on_transfer(riya(), U128(amt), MSG_REPAY.into()); })).is_err());
        testing_env!(ctx(owner()).attached_deposit(NearToken::from_yoctonear(1)).build());
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = c.withdraw_treasury(U128(amt)); })).is_err());
    }
    // Deposit of u128::MAX on top of $1000: shares math overflows -> panic -> token refunds.
    set(usdc());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = c.ft_on_transfer(bob(), U128(u128::MAX), MSG_DEPOSIT.into()); })).is_err());
    // Borrow of 1 base unit (band A): interest ceil(1 * 4%) = 1, i.e. 100% interest. Rounding up
    // per loan; harmless for borrowers above ~$0.25 but worth noting.
    borrow_ok(&mut c, riya(), 1, 0);
    assert_eq!(c.get_borrower(riya()).unwrap().loan.unwrap().interest.0, 1);
}



/// Review 2 L1, fixed: request -> cancel -> borrow -> the cancelled request's late answer lands. It is
/// ignored: no re-score while a loan is active, no second fingerprint, no stats change.
#[test]
fn r2_late_on_score_during_active_loan_is_ignored() {
    let mut c = scored_pool();
    request_at(&mut c, riya(), DAY);
    testing_env!(ctx(riya()).block_timestamp(DAY).build());
    c.cancel_pending_score();
    borrow_ok(&mut c, riya(), 100 * USDC, DAY);
    callback_at(DAY + 1, PromiseResult::Successful(near_sdk::serde_json::to_vec(&out(&riya(), "C", 550, 0x22)).unwrap()));
    assert!(!c.on_score(riya()), "late answer ignored");
    let b = c.get_borrower(riya()).unwrap();
    assert!(b.has_active_loan && !b.pending_request);
    assert_eq!(b.score.unwrap().band, Band::A);
    assert_eq!(c.fingerprints.get(&[0x22; 32]), None);
    assert_eq!(c.get_stats().a.scored + c.get_stats().c.scored, 1);
}

/// Review 2 L2, fixed: a late `on_score` after a default leaves the identity release's pending flag alone.
#[test]
fn r2_late_on_score_keeps_pending_identity_release() {
    let mut c = scored_pool();
    request_at(&mut c, riya(), DAY);
    testing_env!(ctx(riya()).block_timestamp(DAY).build());
    c.cancel_pending_score();
    borrow_ok(&mut c, riya(), 100 * USDC, DAY);
    let cfg = c.get_config();
    let after = DAY + cfg.loan_term_ns.0 + cfg.grace_ns.0 + 1;
    testing_env!(ctx(bob()).block_timestamp(after).build());
    c.mark_default(riya());
    testing_env!(ctx(bob()).block_timestamp(after).attached_deposit(NearToken::from_millinear(10)).build());
    let _ = c.request_identity_release(riya());
    callback_at(after, PromiseResult::Successful(near_sdk::serde_json::to_vec(&out(&riya(), "A", 1000, 0x11)).unwrap()));
    assert!(!c.on_score(riya()));
    assert!(c.get_borrower(riya()).unwrap().pending_request, "the release is still pending");
}

/// Review 2 M1, fixed: a pending release can be requested again (the only way out when its callback
/// failed on storage); the first answer is stored, a duplicate answer is ignored.
#[test]
fn r2_pending_release_can_be_retried_and_duplicates_are_ignored() {
    let mut c = scored_pool();
    borrow_ok(&mut c, riya(), 100 * USDC, DAY);
    let cfg = c.get_config();
    let after = DAY + cfg.loan_term_ns.0 + cfg.grace_ns.0 + 1;
    testing_env!(ctx(bob()).block_timestamp(after).build());
    c.mark_default(riya());
    for _ in 0..2 {
        testing_env!(ctx(bob()).block_timestamp(after).attached_deposit(NearToken::from_millinear(10)).build());
        let _ = c.request_identity_release(riya());
    }
    let rel = |r: &[u8]| json!({ "v": 1, "released": B64.encode(r) });
    callback_at(after, PromiseResult::Successful(near_sdk::serde_json::to_vec(&rel(b"first")).unwrap()));
    assert!(c.on_release(riya()));
    callback_at(after, PromiseResult::Successful(near_sdk::serde_json::to_vec(&rel(b"second")).unwrap()));
    assert!(!c.on_release(riya()), "duplicate ignored");
    let b = c.get_borrower(riya()).unwrap();
    assert_eq!(b.released_identity, Some(B64.encode(b"first")));
    assert!(!b.pending_request);
}

/// Review 2 M1, fixed: new score requests pause while the contract's free balance is under 0.05 NEAR
/// (the attached OutLayer fee doesn't count), so storage filling can't starve releases and repayments.
#[test]
fn r2_request_score_needs_storage_headroom() {
    let mut c = outlayer_pool();
    let fee = NearToken::from_millinear(10);
    let low = |extra_millinear: u128| {
        let used = env::storage_byte_cost().saturating_mul(10_000);
        ctx(riya()).storage_usage(10_000)
            .account_balance(used.saturating_add(NearToken::from_millinear(extra_millinear))) // the runtime adds the attached fee
            .attached_deposit(fee).build()
    };
    testing_env!(low(49));
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = c.request_score("public-sandbox".into(), "aa".repeat(32)); }));
    assert!(r.is_err(), "refused at 0.049 NEAR free");
    assert!(c.get_borrower(riya()).is_none());
    testing_env!(low(50));
    let _ = c.request_score("public-sandbox".into(), "aa".repeat(32));
    assert!(c.get_borrower(riya()).unwrap().pending_request);
}

/// Review 2 L3, fixed: grace can't be shortened while loans are outstanding (it is read when a
/// default is marked, so it would shorten loans already issued); lengthening is always allowed.
#[test]
fn r2_grace_cannot_shrink_while_loans_are_outstanding() {
    let mut c = scored_pool();
    borrow_ok(&mut c, riya(), 100 * USDC, DAY);
    let grace = c.get_config().grace_ns.0;
    testing_env!(ctx(owner()).attached_deposit(NearToken::from_yoctonear(1)).build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.set_grace_ns(U64(60_000_000_000))));
    assert!(r.is_err());
    assert_eq!(c.get_config().grace_ns.0, grace);
    testing_env!(ctx(owner()).attached_deposit(NearToken::from_yoctonear(1)).build());
    c.set_grace_ns(U64(grace + 1));
    assert_eq!(c.get_config().grace_ns.0, grace + 1);
    // No loans outstanding: shortening is allowed again.
    let mut fresh = outlayer_pool();
    testing_env!(ctx(owner()).attached_deposit(NearToken::from_yoctonear(1)).build());
    fresh.set_grace_ns(U64(60_000_000_000));
    assert_eq!(fresh.get_config().grace_ns.0, 60_000_000_000);
}

/// Review 2 L4, fixed: after repeated near-total losses `shares * value` no longer fits in u128;
/// `mul_div` uses a 256-bit intermediate, so views and a full withdraw work.
#[test]
fn r2_share_math_survives_collapse() {
    let mut c = outlayer_pool();
    c.pool.total_shares = 10u128.pow(36);
    c.pool.cash = 10u128.pow(12);
    c.lenders.insert(alice(), 10u128.pow(36));
    set(alice());
    assert_eq!(c.get_lender(alice()).value.0, 10u128.pow(12));
    testing_env!(ctx(alice()).attached_deposit(NearToken::from_yoctonear(1)).build());
    let _ = c.withdraw(U128(10u128.pow(36)));
    assert_eq!(c.pool.cash, 0);
}

#[test]
fn r2_mul_div_wide_matches_exact_math() {
    use crate::math::mul_div;
    // Small values: same as plain u128 math.
    assert_eq!(mul_div(7, 9, 4), 15);
    // a*b overflows u128, result fits: checked against exact values.
    assert_eq!(mul_div(10u128.pow(36), 10u128.pow(12), 10u128.pow(36)), 10u128.pow(12));
    assert_eq!(mul_div(u128::MAX, u128::MAX, u128::MAX), u128::MAX);
    assert_eq!(mul_div(u128::MAX, 2, 4), u128::MAX / 2);
    assert_eq!(mul_div(1u128 << 100, 1u128 << 100, 1u128 << 90), 1u128 << 110);
    assert_eq!(mul_div(u128::MAX, u128::MAX - 1, u128::MAX), u128::MAX - 1);
    // (2^127 + 1) * 3 / 2 = 3 * 2^126 + 1 (floor of x.5)
    assert_eq!(mul_div((1u128 << 127) + 1, 3, 2), 3 * (1u128 << 126) + 1);
    // Result too large: still panics.
    let r = std::panic::catch_unwind(|| mul_div(u128::MAX, u128::MAX, 1));
    assert!(r.is_err());
}

/// Review 2 High, fixed by the time lock (pin.rs): a proposed scorer pin does not apply to the
/// next request; requests keep pinning the old version until the delay has passed and the owner
/// applies it. Full time-lock tests: pin_tests.rs.
#[test]
fn r2_scorer_pin_change_waits_for_time_lock() {
    let mut c = scored_pool();
    testing_env!(ctx(owner()).attached_deposit(NearToken::from_yoctonear(1)).build());
    c.propose_scorer_version("ab".repeat(32));
    assert_eq!(c.get_config().scorer_version, VERSION, "not pinned yet");
    let sybil = acc("sybil1.near");
    request_at(&mut c, sybil.clone(), 1);
    callback_at(1, PromiseResult::Successful(near_sdk::serde_json::to_vec(&out(&sybil, "A", 1000, 0x99)).unwrap()));
    assert!(c.on_score(sybil.clone()));
    assert_eq!(c.get_borrower(sybil).unwrap().score.unwrap().scorer_version, VERSION);
}
