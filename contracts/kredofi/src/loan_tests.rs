//! Unit tests for loans, repayment, defaults and identity release, with exact time control.
//! Real token transfers and `#[private]` guards are tested in `tests/tests/loans.rs`.

use crate::tests::*;
use crate::*;
use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::STANDARD as B64;
use near_sdk::serde_json::{Value, json};
use near_sdk::{PromiseError, PromiseResult, RuntimeFeesConfig, testing_env};

const USDC: u128 = 1_000_000;
const DAY: u64 = 24 * 3600 * 1_000_000_000;
const TERM: u64 = 30 * DAY;
const MIN_HOLD: u64 = 15 * DAY;
const GRACE: u64 = 7 * DAY;

fn riya() -> AccountId {
    acc("riya.near")
}
fn max() -> AccountId {
    acc("max.near")
}
fn scorer() -> AccountId {
    acc("scorer.near")
}

fn at(who: AccountId, ts: u64) {
    testing_env!(ctx(who).block_timestamp(ts).build());
}
fn at_yocto(who: AccountId, ts: u64) {
    testing_env!(
        ctx(who)
            .block_timestamp(ts)
            .attached_deposit(NearToken::from_yoctonear(1))
            .build()
    );
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

fn score_out(who: &AccountId, band: &str, score: u64, cap_usd: u64, fp: u8) -> Value {
    json!({
        "v": 1, "caller": who, "band": band, "score": score,
        "income_cap": cap_usd * 1_000_000,
        "fingerprint": format!("{fp:02x}").repeat(32),
        "sealed_identity": B64.encode(b"sealed-name"),
    })
}

/// Score `who` at time `ts` (score valid for 30 days from `ts`).
fn score_at(c: &mut Contract, who: AccountId, band: &str, score: u64, fp: u8, ts: u64) {
    at(scorer(), ts);
    c.dev_submit_score(who.clone(), score_out(&who, band, score, 1000, fp));
}

/// Pool with $1,000 from alice and a $300 reserve; Riya scored A at t=0.
fn pool() -> Contract {
    let mut c = new_contract();
    deposit(&mut c, alice(), 1_000 * USDC);
    set(usdc());
    let _ = c.ft_on_transfer(owner(), U128(300 * USDC), MSG_SEED_RESERVE.into());
    score_at(&mut c, riya(), "A", 1000, 0x11, 0);
    c
}

/// Borrow and resolve the transfer successfully.
fn borrow_ok(c: &mut Contract, who: AccountId, amount: u128, ts: u64) {
    at_yocto(who.clone(), ts);
    let _ = c.borrow(U128(amount));
    callback_at(ts, PromiseResult::Successful(vec![]));
    assert!(c.on_borrow_transfer(who, U128(amount), None));
}

fn repay(c: &mut Contract, who: AccountId, amount: u128, ts: u64) {
    at(usdc(), ts);
    let _ = c.ft_on_transfer(who, U128(amount), MSG_REPAY.into());
}

fn level(c: &Contract, who: AccountId) -> u8 {
    c.borrowers.get(&who).unwrap().level
}

// ------------------------------------------------------------------ borrow

#[test]
fn borrow_writes_loan_and_moves_cash_before_transfer() {
    let mut c = pool();
    at_yocto(riya(), DAY);
    let _ = c.borrow(U128(100 * USDC));
    // State is written before the transfer resolves (rule 7).
    let p = c.get_pool();
    assert_eq!((p.cash.0, p.outstanding.0, p.pool_value.0), (900 * USDC, 100 * USDC, 1_000 * USDC));
    let l = c.get_borrower(riya()).unwrap().loan.unwrap();
    assert_eq!((l.principal.0, l.interest.0, l.limit_at_borrow.0), (100 * USDC, 2 * USDC, 100 * USDC));
    assert_eq!((l.issued_at.0, l.due_at.0, l.state), (DAY, DAY + TERM, LoanState::Active));
    let st = c.get_stats().a;
    assert_eq!((st.loans_issued, st.volume.0), (1, 100 * USDC));
    assert!(events_named("loan_issued").is_empty(), "event only after the transfer succeeds");

    callback_at(DAY, PromiseResult::Successful(vec![]));
    assert!(c.on_borrow_transfer(riya(), U128(100 * USDC), None));
    assert_eq!(events_named("loan_issued").len(), 1);
}

#[test]
fn failed_borrow_transfer_rolls_back_exactly() {
    let mut c = pool();
    // A previous repaid loan exists; the rollback must restore it.
    borrow_ok(&mut c, riya(), 60 * USDC, DAY);
    repay(&mut c, riya(), 61_200_000, 2 * DAY);
    let before_pool = c.get_pool();
    let before_b = c.get_borrower(riya()).unwrap();
    let before_stats = c.get_stats();

    at_yocto(riya(), 3 * DAY);
    let _ = c.borrow(U128(100 * USDC));
    callback_at(3 * DAY, PromiseResult::Failed);
    assert!(!c.on_borrow_transfer(riya(), U128(100 * USDC), before_b.loan.clone()));

    assert_eq!(c.get_pool(), before_pool);
    assert_eq!(c.get_borrower(riya()).unwrap(), before_b);
    assert_eq!(c.get_stats(), before_stats);
}

#[test]
fn interest_by_band_rounds_up() {
    assert_eq!(ceil_bps(100 * USDC, Band::A.interest_bps()), 2 * USDC);
    assert_eq!(ceil_bps(75 * USDC, Band::B.interest_bps()), 2_250_000);
    assert_eq!(ceil_bps(50 * USDC, Band::C.interest_bps()), 2 * USDC);
    assert_eq!(ceil_bps(33, Band::A.interest_bps()), 1, "0.66 base units rounds up to 1");
    assert_eq!(ceil_bps(0, Band::A.interest_bps()), 0);
}

#[test]
#[should_panic(expected = "No score yet")]
fn borrow_needs_score() {
    let mut c = pool();
    at_yocto(max(), DAY);
    let _ = c.borrow(U128(USDC));
}

#[test]
#[should_panic(expected = "Score expired")]
fn borrow_needs_unexpired_score() {
    let mut c = pool();
    at_yocto(riya(), 30 * DAY);
    let _ = c.borrow(U128(USDC));
}

#[test]
#[should_panic(expected = "Band D cannot borrow")]
fn band_d_cannot_borrow() {
    let mut c = pool();
    let sam = acc("sam.near");
    score_at(&mut c, sam.clone(), "D", 270, 0x22, 0);
    at_yocto(sam, DAY);
    let _ = c.borrow(U128(USDC));
}

#[test]
#[should_panic(expected = "Amount is above your limit")]
fn borrow_above_limit_rejected() {
    let mut c = pool();
    at_yocto(riya(), DAY);
    let _ = c.borrow(U128(100 * USDC + 1));
}

/// Rule 12: one borrower can never exceed 10% of pool value.
#[test]
#[should_panic(expected = "Amount is above 10% of pool value")]
fn rule12_borrow_above_ten_percent_of_pool_rejected() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 500 * USDC); // 10% = $50, limit $100
    score_at(&mut c, riya(), "A", 1000, 0x11, 0);
    at_yocto(riya(), DAY);
    let _ = c.borrow(U128(50 * USDC + 1));
}

#[test]
fn rule12_borrow_at_exactly_ten_percent_ok() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 500 * USDC);
    score_at(&mut c, riya(), "A", 1000, 0x11, 0);
    borrow_ok(&mut c, riya(), 50 * USDC, DAY);
    assert_eq!(c.get_pool().outstanding.0, 50 * USDC);
}

#[test]
#[should_panic(expected = "Not enough cash in the pool")]
fn borrow_limited_by_cash() {
    let mut c = pool();
    c.pool.cash -= 950 * USDC; // pretend most is lent out
    c.pool.outstanding += 950 * USDC;
    at_yocto(riya(), DAY);
    let _ = c.borrow(U128(60 * USDC));
}

#[test]
#[should_panic(expected = "Repay the active loan first")]
fn one_active_loan_at_a_time() {
    let mut c = pool();
    borrow_ok(&mut c, riya(), 10 * USDC, DAY);
    at_yocto(riya(), DAY);
    let _ = c.borrow(U128(10 * USDC));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn borrow_requires_one_yocto() {
    let mut c = pool();
    at(riya(), DAY);
    let _ = c.borrow(U128(10 * USDC));
}

// ------------------------------------------------------------------ repay

#[test]
fn repay_splits_interest_between_pool_and_reserve() {
    let mut c = pool();
    borrow_ok(&mut c, riya(), 100 * USDC, DAY);
    repay(&mut c, riya(), 102 * USDC, DAY + MIN_HOLD);

    // SPEC 4a: pool cash +$101.60, outstanding -$100, reserve +$0.40.
    let p = c.get_pool();
    assert_eq!(p.cash.0, 1_001_600_000);
    assert_eq!(p.outstanding.0, 0);
    assert_eq!(p.reserve.0, 300_400_000);
    assert_eq!(c.get_lender(alice()).value.0, 1_001_600_000, "share price rose");
    let l = c.get_borrower(riya()).unwrap().loan.unwrap();
    assert_eq!(l.state, LoanState::Repaid);
    assert_eq!(c.get_stats().a.repaid, 1);
    let ev = events_named("loan_repaid");
    assert_eq!(ev.len(), 1);
    assert!(ev[0].contains("\"to_reserve\":\"400000\"") && ev[0].contains("\"to_pool\":\"1600000\""));
}

#[test]
#[should_panic(expected = "Repay exactly 102000000")]
fn partial_repay_rejected() {
    let mut c = pool();
    borrow_ok(&mut c, riya(), 100 * USDC, DAY);
    repay(&mut c, riya(), 101 * USDC, 2 * DAY);
}

#[test]
#[should_panic(expected = "Repay exactly 102000000")]
fn over_repay_rejected() {
    let mut c = pool();
    borrow_ok(&mut c, riya(), 100 * USDC, DAY);
    repay(&mut c, riya(), 103 * USDC, 2 * DAY);
}

#[test]
#[should_panic(expected = "No active loan")]
fn repay_without_loan_rejected() {
    let mut c = pool();
    repay(&mut c, riya(), 102 * USDC, DAY);
}

#[test]
#[should_panic(expected = "No active loan")]
fn repay_twice_rejected() {
    let mut c = pool();
    borrow_ok(&mut c, riya(), 100 * USDC, DAY);
    repay(&mut c, riya(), 102 * USDC, 2 * DAY);
    repay(&mut c, riya(), 102 * USDC, 3 * DAY);
}

// ------------------------------------------------------------------ rule 13 level-up

#[test]
fn level_up_after_full_hold_and_big_enough_loan() {
    let mut c = pool();
    borrow_ok(&mut c, riya(), 100 * USDC, 0);
    repay(&mut c, riya(), 102 * USDC, MIN_HOLD);
    assert_eq!(level(&c, riya()), 2);
    assert_eq!(c.get_limit(riya()).0, 250 * USDC, "SPEC 8: level 2, limit $250");
}

#[test]
fn rule13_early_repay_does_not_level_up() {
    let mut c = pool();
    borrow_ok(&mut c, riya(), 100 * USDC, 0);
    repay(&mut c, riya(), 102 * USDC, MIN_HOLD - 1);
    assert_eq!(level(&c, riya()), 1);
    let ev = events_named("loan_repaid");
    assert!(ev[0].contains("\"leveled_up\":false"));
}

#[test]
fn rule13_small_loan_does_not_level_up() {
    let mut c = pool();
    borrow_ok(&mut c, riya(), 49_999_999, 0); // just under 50% of the $100 limit
    repay(&mut c, riya(), 49_999_999 + ceil_bps(49_999_999, 200), MIN_HOLD);
    assert_eq!(level(&c, riya()), 1);

    // Exactly 50% counts.
    let mut c = pool();
    borrow_ok(&mut c, riya(), 50 * USDC, 0);
    repay(&mut c, riya(), 51 * USDC, MIN_HOLD);
    assert_eq!(level(&c, riya()), 2);
}

#[test]
fn rule13_second_level_up_within_one_term_blocked() {
    let mut c = pool();
    borrow_ok(&mut c, riya(), 100 * USDC, 0);
    repay(&mut c, riya(), 102 * USDC, MIN_HOLD); // level 2 at t = 15d
    assert_eq!(level(&c, riya()), 2);

    // Re-score so the score stays valid, then a full-size loan held long enough,
    // but repaid less than a term after the last level-up.
    score_at(&mut c, riya(), "A", 1000, 0x11, MIN_HOLD);
    c.pool.cash += 2_000 * USDC; // keep the 10% cap out of the way
    borrow_ok(&mut c, riya(), 250 * USDC, MIN_HOLD);
    repay(&mut c, riya(), 255 * USDC, MIN_HOLD + TERM - 1);
    assert_eq!(level(&c, riya()), 2, "second level-up within one term");

    // One full term after the last level-up it works.
    score_at(&mut c, riya(), "A", 1000, 0x11, MIN_HOLD + TERM);
    borrow_ok(&mut c, riya(), 250 * USDC, MIN_HOLD + TERM);
    repay(&mut c, riya(), 255 * USDC, MIN_HOLD + TERM + MIN_HOLD);
    assert_eq!(level(&c, riya()), 3);
}

#[test]
fn level_caps_at_four() {
    let mut c = pool();
    c.borrowers.get_mut(&riya()).unwrap().level = 4;
    c.pool.cash += 20_000 * USDC;
    borrow_ok(&mut c, riya(), 1_000 * USDC, 0);
    repay(&mut c, riya(), 1_020 * USDC, MIN_HOLD);
    assert_eq!(level(&c, riya()), 4);
}

// ------------------------------------------------------------------ mark_default

fn max_borrowed(c: &mut Contract) {
    score_at(c, max(), "A", 1000, 0x33, 0);
    borrow_ok(c, max(), 100 * USDC, 0);
}

#[test]
#[should_panic(expected = "Loan is not past due date plus grace")]
fn default_not_before_grace_ends() {
    let mut c = pool();
    max_borrowed(&mut c);
    at(alice(), TERM + GRACE);
    c.mark_default(max());
}

#[test]
fn default_covered_by_reserve_keeps_lenders_whole() {
    let mut c = pool();
    max_borrowed(&mut c);
    let value_before = c.get_pool().pool_value.0;
    at(acc("anyone.near"), TERM + GRACE + 1);
    c.mark_default(max());

    let p = c.get_pool();
    assert_eq!(p.reserve.0, 200 * USDC);
    assert_eq!(p.outstanding.0, 0);
    assert_eq!(p.cash.0, 1_000 * USDC);
    assert_eq!(p.pool_value.0, value_before, "lenders lose nothing");
    let b = c.get_borrower(max()).unwrap();
    assert!(b.blocked);
    assert_eq!(b.defaults, 1);
    assert_eq!(b.loan.unwrap().state, LoanState::Defaulted);
    assert_eq!(b.limit.0, 0);
    assert_eq!(c.get_stats().a.defaulted, 1);
    assert_eq!(c.fingerprints.get(&[0x33; 32]), Some(&max()), "fingerprint stays taken");
    let ev = events_named("loan_defaulted");
    assert!(ev[0].contains("\"covered_by_reserve\":\"100000000\"") && ev[0].contains("\"lender_loss\":\"0\""));
}

#[test]
fn default_beyond_reserve_lowers_share_price() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 1_000 * USDC);
    set(usdc());
    let _ = c.ft_on_transfer(owner(), U128(30 * USDC), MSG_SEED_RESERVE.into());
    max_borrowed(&mut c);
    at(alice(), TERM + GRACE + 1);
    c.mark_default(max());

    let p = c.get_pool();
    assert_eq!(p.reserve.0, 0);
    assert_eq!(p.pool_value.0, 930 * USDC, "lenders lose principal - covered = $70");
    assert_eq!(c.get_lender(alice()).value.0, 930 * USDC);
}

#[test]
#[should_panic(expected = "No active loan")]
fn default_only_once() {
    let mut c = pool();
    max_borrowed(&mut c);
    at(alice(), TERM + GRACE + 1);
    c.mark_default(max());
    c.mark_default(max());
}

#[test]
#[should_panic(expected = "No active loan")]
fn repaid_loan_cannot_default() {
    let mut c = pool();
    borrow_ok(&mut c, riya(), 100 * USDC, 0);
    repay(&mut c, riya(), 102 * USDC, TERM + GRACE); // late but before anyone marked it
    at(alice(), TERM + GRACE + 1);
    c.mark_default(riya());
}

#[test]
#[should_panic(expected = "Borrower is blocked")]
fn defaulted_borrower_cannot_borrow_again() {
    let mut c = pool();
    max_borrowed(&mut c);
    at(alice(), TERM + GRACE + 1);
    c.mark_default(max());
    at_yocto(max(), TERM + GRACE + 2);
    let _ = c.borrow(U128(USDC));
}

// ------------------------------------------------------------------ identity release

fn defaulted_max() -> Contract {
    let mut c = pool();
    max_borrowed(&mut c);
    at(alice(), TERM + GRACE + 1);
    c.mark_default(max());
    c
}

fn release_out() -> Value {
    json!({ "v": 1, "released": B64.encode(b"name-sealed-to-partner") })
}

#[test]
fn release_flow_dev_mode() {
    let mut c = defaulted_max();
    assert!(c.is_release_allowed(max()));
    at(alice(), TERM + GRACE + 2);
    let _ = c.request_identity_release(max());
    assert!(c.get_borrower(max()).unwrap().pending_request);

    at(scorer(), TERM + GRACE + 3);
    c.dev_submit_release(max(), release_out());
    let b = c.get_borrower(max()).unwrap();
    assert_eq!(b.released_identity.as_deref(), Some(B64.encode(b"name-sealed-to-partner").as_str()));
    assert!(!b.pending_request);
    assert!(!c.is_release_allowed(max()), "only once");
    assert_eq!(events_named("identity_released").len(), 1);
}

#[test]
#[should_panic(expected = "only allowed once, after a recorded default")]
fn release_needs_default() {
    let mut c = pool();
    borrow_ok(&mut c, riya(), 100 * USDC, 0);
    at(alice(), DAY);
    let _ = c.request_identity_release(riya());
}

#[test]
#[should_panic(expected = "only allowed once, after a recorded default")]
fn release_only_once() {
    let mut c = defaulted_max();
    at(alice(), TERM + GRACE + 2);
    let _ = c.request_identity_release(max());
    at(scorer(), TERM + GRACE + 3);
    c.dev_submit_release(max(), release_out());
    at(alice(), TERM + GRACE + 4);
    let _ = c.request_identity_release(max());
}

#[test]
#[should_panic(expected = "No identity release was requested")]
fn dev_release_needs_request() {
    let mut c = defaulted_max();
    at(scorer(), TERM + GRACE + 3);
    c.dev_submit_release(max(), release_out());
}

#[test]
#[should_panic(expected = "Only the dev_scorer can submit a release")]
fn dev_release_only_from_dev_scorer() {
    let mut c = defaulted_max();
    at(alice(), TERM + GRACE + 2);
    let _ = c.request_identity_release(max());
    at(owner(), TERM + GRACE + 3);
    c.dev_submit_release(max(), release_out());
}

#[test]
fn release_output_parser() {
    assert_eq!(parse_release(&release_out()).unwrap(), b"name-sealed-to-partner");
    for bad in [
        json!({ "v": 2, "released": "AA==" }),
        json!({ "v": 1, "released": "" }),
        json!({ "v": 1, "released": "%%" }),
        json!({ "v": 1, "released": "AA==", "name": "Max" }),
        json!({ "v": 1 }),
        json!("x"),
    ] {
        assert!(parse_release(&bad).is_err(), "{bad}");
    }
}

#[test]
fn outlayer_release_failure_clears_pending_and_allows_retry() {
    set(owner());
    let mut i = config_input();
    i.scorer_mode = ScorerMode::OutLayer;
    i.dev_scorer = None;
    let mut c = Contract::new(i);
    deposit(&mut c, alice(), 1_000 * USDC);
    // Score via the callback path, borrow, default.
    set(pool_id());
    c.accept_score(&max(), parse_output(&score_out(&max(), "A", 1000, 1000, 0x33)).unwrap()).unwrap();
    borrow_ok(&mut c, max(), 100 * USDC, 0);
    at(alice(), TERM + GRACE + 1);
    c.mark_default(max());

    testing_env!(
        ctx(alice())
            .block_timestamp(TERM + GRACE + 2)
            .attached_deposit(NearToken::from_millinear(10))
            .build()
    );
    let _ = c.request_identity_release(max());
    set(pool_id());
    assert!(!c.on_release(max(), Err(PromiseError::Failed)));
    assert!(!c.get_borrower(max()).unwrap().pending_request);
    assert!(c.is_release_allowed(max()));

    assert!(c.on_release(max(), Ok(Some(release_out()))));
    assert!(c.get_borrower(max()).unwrap().released_identity.is_some());
}

#[test]
#[should_panic(expected = "Attach at least 0.01 NEAR")]
fn outlayer_release_needs_fee() {
    set(owner());
    let mut i = config_input();
    i.scorer_mode = ScorerMode::OutLayer;
    i.dev_scorer = None;
    let mut c = Contract::new(i);
    deposit(&mut c, alice(), 1_000 * USDC);
    set(pool_id());
    c.accept_score(&max(), parse_output(&score_out(&max(), "A", 1000, 1000, 0x33)).unwrap()).unwrap();
    borrow_ok(&mut c, max(), 100 * USDC, 0);
    at(alice(), TERM + GRACE + 1);
    c.mark_default(max());
    at(alice(), TERM + GRACE + 2);
    let _ = c.request_identity_release(max());
}

#[test]
fn get_borrower_still_hides_sealed_identity_after_release() {
    let mut c = defaulted_max();
    at(alice(), TERM + GRACE + 2);
    let _ = c.request_identity_release(max());
    at(scorer(), TERM + GRACE + 3);
    c.dev_submit_release(max(), release_out());
    let view = near_sdk::serde_json::to_string(&c.get_borrower(max()).unwrap()).unwrap();
    assert!(!view.contains("sealed"), "{view}");
    assert!(!view.contains(&B64.encode(b"sealed-name")), "{view}");
}
