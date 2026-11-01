//! Owner setters: owner-only, 1 yocto, bounded, public event, no effect on funds.

use crate::tests::*;
use crate::*;

const S: u64 = 1_000_000_000;
const USDC: u128 = 1_000_000;

fn owner_call(c: &mut Contract, f: impl FnOnce(&mut Contract)) {
    set_yocto(owner());
    f(c);
}

#[test]
fn owner_sets_demo_timing_with_events() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 1_000 * USDC);
    let pool_before = c.get_pool();

    // Order matters: lower the hold before shortening the term below it.
    owner_call(&mut c, |c| c.set_min_hold_ns(U64(60 * S)));
    owner_call(&mut c, |c| c.set_loan_term_ns(U64(120 * S)));
    owner_call(&mut c, |c| c.set_grace_ns(U64(60 * S)));
    owner_call(&mut c, |c| c.set_score_ttl_ns(U64(3600 * S)));
    owner_call(&mut c, |c| c.set_max_borrower_share_bps(500));

    let v = c.get_config();
    assert_eq!(
        (v.loan_term_ns.0, v.min_hold_ns.0, v.grace_ns.0, v.score_ttl_ns.0),
        (120 * S, 60 * S, 60 * S, 3600 * S)
    );
    assert_eq!(v.max_borrower_share_bps, 500);
    let ev = events_named("param_changed");
    assert_eq!(ev.len(), 1, "one event per call (logs reset per context)");
    assert!(ev[0].contains("\"param\":\"max_borrower_share_bps\"") && ev[0].contains("\"old\":1000") && ev[0].contains("\"new\":500"));
    assert_eq!(c.get_pool(), pool_before, "no funds moved");
}

#[test]
fn duration_event_uses_string_ns() {
    let mut c = new_contract();
    owner_call(&mut c, |c| c.set_grace_ns(U64(60 * S)));
    let ev = events_named("param_changed");
    assert!(ev[0].contains("\"param\":\"grace_ns\"") && ev[0].contains("\"new\":\"60000000000\""), "{}", ev[0]);
}

#[test]
#[should_panic(expected = "Only the owner can change parameters")]
fn non_owner_rejected() {
    let mut c = new_contract();
    set_yocto(alice());
    c.set_grace_ns(U64(60 * S));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn needs_one_yocto() {
    let mut c = new_contract();
    set(owner());
    c.set_grace_ns(U64(60 * S));
}

#[test]
fn bounds_are_enforced() {
    type Call = Box<dyn Fn(&mut Contract)>;
    let cases: Vec<(&str, Call)> = vec![
        ("loan_term_ns must be between", Box::new(|c| c.set_loan_term_ns(U64(59 * S)))),
        ("loan_term_ns must be between", Box::new(|c| c.set_loan_term_ns(U64(366 * 24 * 3600 * S)))),
        ("grace_ns must be between", Box::new(|c| c.set_grace_ns(U64(59 * S)))),
        ("grace_ns must be between", Box::new(|c| c.set_grace_ns(U64(91 * 24 * 3600 * S)))),
        ("score_ttl_ns must be between", Box::new(|c| c.set_score_ttl_ns(U64(0)))),
        ("min_hold_ns must be at least 60 s", Box::new(|c| c.set_min_hold_ns(U64(59 * S)))),
        ("min_hold_ns must be at least 60 s and at most loan_term_ns", Box::new(|c| c.set_min_hold_ns(U64(31 * 24 * 3600 * S)))),
        // Term below the current 15-day hold.
        ("min_hold_ns must be at least 60 s and at most loan_term_ns", Box::new(|c| c.set_loan_term_ns(U64(120 * S)))),
        ("max_borrower_share_bps must be between 1 and 1000 (rule 12)", Box::new(|c| c.set_max_borrower_share_bps(1001))),
        ("max_borrower_share_bps must be between 1 and 1000 (rule 12)", Box::new(|c| c.set_max_borrower_share_bps(0))),
    ];
    for (want, call) in cases {
        let mut c = new_contract();
        let before = c.get_config();
        set_yocto(owner());
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| call(&mut c)))
            .expect_err(want);
        let msg = err
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_default();
        assert!(msg.contains(want), "expected '{want}', got '{msg}'");
        assert_eq!(c.get_config(), before, "{want}: config unchanged");
    }
}

#[test]
#[should_panic(expected = "max_borrower_share_bps must be between 1 and 1000 (rule 12)")]
fn init_cannot_exceed_ten_percent() {
    set(owner());
    let mut i = config_input();
    i.max_borrower_share_bps = 2000;
    Contract::new(i);
}

#[test]
#[should_panic(expected = "min_hold_ns must be at least 60 s")]
fn init_term_too_short_for_min_hold() {
    set(owner());
    let mut i = config_input();
    i.loan_term_ns = U64(100 * S); // derived hold 50 s
    Contract::new(i);
}
