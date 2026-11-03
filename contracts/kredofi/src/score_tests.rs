//! Unit tests for scores: parsing, acceptance, expiry, fingerprints, limits.
//! The `#[private]` guard and real cross-contract calls are tested in `tests/tests/scores.rs`.

use crate::tests::*;
use crate::*;
use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::STANDARD as B64;
use near_sdk::serde_json::{Value, json};
use near_sdk::testing_env;

const USDC: u128 = 1_000_000;
const DAY: u64 = 24 * 3600 * 1_000_000_000;
const SEALED: &[u8] = b"sealed-name-ciphertext-bytes";

fn scorer() -> AccountId {
    acc("scorer.near")
}
fn riya() -> AccountId {
    acc("riya.near")
}
fn max() -> AccountId {
    acc("max.near")
}

fn fp(byte: u8) -> String {
    format!("{byte:02x}").repeat(32)
}

fn output(caller: &AccountId, band: &str, score: u64, cap: u128, fp_byte: u8) -> Value {
    json!({
        "v": 1,
        "caller": caller,
        "band": band,
        "score": score,
        "income_cap": cap as u64,
        "fingerprint": fp(fp_byte),
        "sealed_identity": B64.encode(SEALED),
    })
}

/// SPEC 6 demo table: Riya 1000/A, Max 1000/A; Sam 270/D.
fn riya_output() -> Value {
    output(&riya(), "A", 1000, 1_000 * USDC, 0x11)
}

fn at(predecessor: AccountId, ts: u64) {
    testing_env!(ctx(predecessor).block_timestamp(ts).build());
}

fn dev_submit(c: &mut Contract, borrower: AccountId, out: Value) {
    at(scorer(), 0);
    c.dev_submit_score(borrower, out);
}

fn outlayer_contract() -> Contract {
    set(owner());
    let mut i = config_input();
    i.scorer_mode = ScorerMode::OutLayer;
    i.dev_scorer = None;
    Contract::new(i)
}

fn request(c: &mut Contract, who: AccountId) {
    testing_env!(
        ctx(who)
            .attached_deposit(NearToken::from_millinear(10))
            .build()
    );
    let _ = c.request_score("public-sandbox-abc".into(), fp(0xaa));
}

// ------------------------------------------------------------------ parsing

#[test]
fn parses_valid_output() {
    let o = parse_output(&riya_output()).unwrap();
    assert_eq!(o.caller, riya());
    assert_eq!((o.band, o.score, o.income_cap), (Band::A, 1000, 1_000 * USDC));
    assert_eq!(o.fingerprint, [0x11; 32]);
    assert_eq!(o.sealed_identity, SEALED);
}

#[test]
fn income_cap_may_be_a_string_and_reply_is_allowed() {
    let mut v = riya_output();
    v["income_cap"] = json!("250000000");
    v["reply"] = json!("b64reply");
    assert_eq!(parse_output(&v).unwrap().income_cap, 250 * USDC);
}

/// SPEC 5: `reply` (AI summary encrypted to the borrower's key) is optional and allowed.
#[test]
fn reply_field_is_optional_and_accepted() {
    let without = parse_output(&riya_output()).unwrap();
    let mut v = riya_output();
    v["reply"] = json!(B64.encode(b"encrypted-ai-summary"));
    assert_eq!(parse_output(&v).unwrap(), without, "reply is not stored, only allowed");
}

#[test]
fn rejects_bad_outputs() {
    type Mutate = Box<dyn Fn(&mut Value)>;
    let cases: Vec<(&str, Mutate)> = vec![
        ("version", Box::new(|v| v["v"] = json!(2))),
        ("version", Box::new(|v| { v.as_object_mut().unwrap().remove("v"); })),
        ("Unexpected field", Box::new(|v| v["transactions"] = json!([1, 2]))),
        ("Unexpected field", Box::new(|v| v["name"] = json!("Riya Good"))),
        ("caller", Box::new(|v| v["caller"] = json!("NOT VALID"))),
        ("band", Box::new(|v| v["band"] = json!("E"))),
        ("score", Box::new(|v| v["score"] = json!(1001))),
        ("score", Box::new(|v| v["score"] = json!(-5))),
        ("Band does not match score", Box::new(|v| v["score"] = json!(270))),
        ("income_cap", Box::new(|v| v["income_cap"] = json!(1_000 * USDC as u64 + 1))),
        ("income_cap", Box::new(|v| v["income_cap"] = json!("lots"))),
        ("fingerprint", Box::new(|v| v["fingerprint"] = json!("abcd"))),
        ("fingerprint", Box::new(|v| v["fingerprint"] = json!("zz".repeat(32)))),
        ("sealed_identity", Box::new(|v| v["sealed_identity"] = json!("%%%not base64"))),
        ("sealed_identity", Box::new(|v| v["sealed_identity"] = json!(""))),
        ("sealed_identity", Box::new(|v| v["sealed_identity"] = json!(B64.encode([7u8; 257])))),
        ("reply", Box::new(|v| v["reply"] = json!({"x": 1}))),
    ];
    for (want, mutate) in cases {
        let mut v = riya_output();
        mutate(&mut v);
        let err = parse_output(&v).expect_err(&format!("should reject: {v}"));
        assert!(err.contains(want), "expected '{want}' in '{err}' for {v}");
    }
    assert!(parse_output(&json!("text")).is_err());
}

#[test]
fn band_boundaries_match_spec() {
    for (score, band) in [
        (1000, Band::A), (800, Band::A), (799, Band::B), (650, Band::B),
        (649, Band::C), (500, Band::C), (499, Band::D), (270, Band::D), (0, Band::D),
    ] {
        assert_eq!(Band::for_score(score), band, "score {score}");
    }
}

#[test]
fn unwraps_outlayer_result_shapes() {
    let raw = riya_output();
    assert_eq!(unwrap_outlayer_result(raw.clone()).unwrap(), raw);
    assert_eq!(unwrap_outlayer_result(json!(raw.to_string())).unwrap(), raw);
    assert_eq!(unwrap_outlayer_result(json!({"success": true, "output": raw})).unwrap(), raw);
    assert_eq!(unwrap_outlayer_result(json!({"output": raw.to_string()})).unwrap(), raw);

    let e = unwrap_outlayer_result(json!({"success": false, "error": "timeout"})).unwrap_err();
    assert!(e.contains("timeout"), "{e}");
    assert!(unwrap_outlayer_result(json!({"something": 1})).is_err());
    assert!(unwrap_outlayer_result(json!(42)).is_err());
    assert!(unwrap_outlayer_result(json!("not json")).is_err());
    // Bounded nesting.
    let deep = json!({"output": {"output": {"output": {"output": raw}}}});
    assert!(unwrap_outlayer_result(deep).is_err());
}

// ------------------------------------------------------------------ dev_submit_score

#[test]
fn dev_scorer_submits_and_score_is_stored() {
    let mut c = new_contract();
    dev_submit(&mut c, riya(), riya_output());
    let b = c.get_borrower(riya()).unwrap();
    let s = b.score.unwrap();
    assert_eq!((s.band, s.score, s.income_cap.0), (Band::A, 1000, 1_000 * USDC));
    assert_eq!(s.expires_at.0, 30 * DAY);
    assert_eq!(s.scorer_version, VERSION);
    assert!(!s.expired);
    assert_eq!(b.level, 1);
    assert_eq!(c.get_limit(riya()).0, 100 * USDC, "SPEC 6 table: level-1 limit $100");
    assert_eq!(c.get_stats().a.scored, 1);
    let ev = events_named("score_issued");
    assert_eq!(ev.len(), 1);
    assert!(ev[0].contains("\"borrower\":\"riya.near\""));
    assert!(ev[0].contains("\"band\":\"A\""));
}

#[test]
fn sam_band_d_gets_zero_limit() {
    let mut c = new_contract();
    let sam = acc("sam.near");
    dev_submit(&mut c, sam.clone(), output(&sam, "D", 270, 400 * USDC, 0x22));
    assert_eq!(c.get_limit(sam.clone()).0, 0);
    assert_eq!(c.get_stats().d.scored, 1);
}

/// Rule 1: only the configured dev_scorer, and only in Dev mode.
#[test]
#[should_panic(expected = "Only the dev_scorer can submit scores")]
fn rule1_random_account_cannot_submit_score() {
    let mut c = new_contract();
    set(riya());
    c.dev_submit_score(riya(), riya_output());
}

#[test]
#[should_panic(expected = "Only the dev_scorer can submit scores")]
fn rule1_owner_cannot_submit_score() {
    let mut c = new_contract();
    set(owner());
    c.dev_submit_score(riya(), riya_output());
}

#[test]
#[should_panic(expected = "dev_submit_score is disabled in OutLayer mode")]
fn rule1_dev_submit_disabled_in_outlayer_mode() {
    let mut c = outlayer_contract();
    set(scorer());
    c.dev_submit_score(riya(), riya_output());
}

/// Rule 3 (second half): output.caller must be the borrower.
#[test]
#[should_panic(expected = "is not the borrower")]
fn rule3_dev_output_for_other_caller_rejected() {
    let mut c = new_contract();
    dev_submit(&mut c, max(), riya_output());
}

/// Rule 6: one fingerprint, one borrower.
#[test]
#[should_panic(expected = "already used by another borrower")]
fn rule6_fingerprint_taken_by_other_borrower() {
    let mut c = new_contract();
    dev_submit(&mut c, riya(), riya_output());
    dev_submit(&mut c, max(), output(&max(), "A", 1000, 1_000 * USDC, 0x11));
}

#[test]
fn rule6_same_borrower_can_rescore_same_bank() {
    let mut c = new_contract();
    dev_submit(&mut c, riya(), riya_output());
    dev_submit(&mut c, riya(), output(&riya(), "B", 700, 500 * USDC, 0x11));
    assert_eq!(c.get_borrower(riya()).unwrap().score.unwrap().band, Band::B);
    assert_eq!(c.fingerprints.get(&[0x11; 32]), Some(&riya()));
    assert_eq!(c.get_stats().a.scored + c.get_stats().b.scored, 2);
}

#[test]
#[should_panic(expected = "Borrower is blocked")]
fn blocked_borrower_cannot_be_scored() {
    let mut c = new_contract();
    let mut b = Borrower::new();
    b.blocked = true;
    c.borrowers.insert(max(), b);
    dev_submit(&mut c, max(), output(&max(), "A", 1000, 1_000 * USDC, 0x33));
}

#[test]
#[should_panic(expected = "Repay the active loan before a new score")]
fn borrower_with_active_loan_cannot_be_rescored() {
    let mut c = new_contract();
    let mut b = Borrower::new();
    b.loan = Some(Loan {
        principal: 100 * USDC,
        interest: 2 * USDC,
        limit_at_borrow: 100 * USDC,
        band: Band::A,
        issued_at: 0,
        due_at: DAY,
        state: LoanState::Active,
    });
    c.borrowers.insert(riya(), b);
    dev_submit(&mut c, riya(), riya_output());
}

// ------------------------------------------------------------------ expiry (rule 5)

#[test]
fn rule5_score_expires_after_ttl() {
    let mut c = new_contract();
    dev_submit(&mut c, riya(), riya_output());
    at(riya(), 30 * DAY - 1);
    assert_eq!(c.get_limit(riya()).0, 100 * USDC);
    at(riya(), 30 * DAY);
    assert_eq!(c.get_limit(riya()).0, 0);
    let b = c.get_borrower(riya()).unwrap();
    assert!(b.score.unwrap().expired);
    assert_eq!(b.limit.0, 0);
}

// ------------------------------------------------------------------ limits

#[test]
fn limit_table() {
    let mut c = new_contract();
    // (level, band, score, income_cap $) -> limit $ (SPEC 4)
    let cases: [(u8, &str, u64, u128, u128); 9] = [
        (1, "A", 1000, 1000, 100_000_000),
        (1, "B", 700, 1000, 75_000_000),
        (1, "C", 550, 1000, 50_000_000),
        (1, "D", 100, 1000, 0),
        (2, "A", 900, 1000, 250_000_000),
        (2, "B", 700, 1000, 187_500_000),
        (3, "C", 600, 1000, 250_000_000),
        (4, "A", 1000, 600, 600_000_000), // income cap binds
        (4, "A", 1000, 1000, 1_000_000_000),
    ];
    for (i, (level, band, score, cap, want)) in cases.into_iter().enumerate() {
        let who = acc(&format!("b{i}.near"));
        dev_submit(&mut c, who.clone(), output(&who, band, score, cap * USDC, i as u8));
        c.borrowers.get_mut(&who).unwrap().level = level;
        assert_eq!(c.get_limit(who).0, want, "level {level} band {band} cap {cap}");
    }
    assert_eq!(c.get_limit(acc("nobody.near")).0, 0);
}

// ------------------------------------------------------------------ rule 9 view

#[test]
fn get_borrower_never_returns_sealed_identity() {
    let mut c = new_contract();
    dev_submit(&mut c, riya(), riya_output());
    let view = near_sdk::serde_json::to_string(&c.get_borrower(riya()).unwrap()).unwrap();
    assert!(!view.contains("sealed"), "{view}");
    assert!(!view.contains(&B64.encode(SEALED)), "{view}");
    assert_eq!(c.borrowers.get(&riya()).unwrap().sealed_identity.as_deref(), Some(SEALED));
}

// ------------------------------------------------------------------ request_score / on_score

#[test]
#[should_panic(expected = "request_score is disabled in Dev mode")]
fn request_score_disabled_in_dev_mode() {
    let mut c = new_contract();
    request(&mut c, riya());
}

/// Rule 3: signer must equal predecessor.
#[test]
#[should_panic(expected = "must be signed by the borrower directly")]
fn rule3_request_via_another_contract_rejected() {
    let mut c = outlayer_contract();
    testing_env!(
        ctx(acc("proxy.near"))
            .signer_account_id(riya())
            .attached_deposit(NearToken::from_millinear(10))
            .build()
    );
    let _ = c.request_score("public-sandbox-abc".into(), fp(0xaa));
}

#[test]
#[should_panic(expected = "Attach at least 0.01 NEAR")]
fn request_needs_fee_deposit() {
    let mut c = outlayer_contract();
    testing_env!(
        ctx(riya())
            .attached_deposit(NearToken::from_millinear(9))
            .build()
    );
    let _ = c.request_score("public-sandbox-abc".into(), fp(0xaa));
}

#[test]
#[should_panic(expected = "reply_pubkey must be 32 bytes of hex")]
fn request_needs_valid_reply_key() {
    let mut c = outlayer_contract();
    testing_env!(
        ctx(riya())
            .attached_deposit(NearToken::from_millinear(10))
            .build()
    );
    let _ = c.request_score("public-sandbox-abc".into(), "beef".into());
}

#[test]
#[should_panic(expected = "A score request is already pending")]
fn only_one_pending_request() {
    let mut c = outlayer_contract();
    request(&mut c, riya());
    assert!(c.get_borrower(riya()).unwrap().pending_request);
    request(&mut c, riya());
}

#[test]
fn on_score_success_stores_and_clears_pending() {
    let mut c = outlayer_contract();
    request(&mut c, riya());
    set(pool_id());
    assert!(c.finish_score(riya(), Ok(Some(riya_output()))));
    let b = c.get_borrower(riya()).unwrap();
    assert!(!b.pending_request);
    assert_eq!(b.score.unwrap().band, Band::A);
    assert_eq!(events_named("score_issued").len(), 1);
}

#[test]
fn on_score_accepts_wrapped_output() {
    let mut c = outlayer_contract();
    request(&mut c, riya());
    set(pool_id());
    assert!(c.finish_score(riya(), Ok(Some(json!({"success": true, "output": riya_output()})))));
    assert!(c.get_borrower(riya()).unwrap().score.is_some());
}

/// Rule 4 (and rules 3, 6 inside the callback): every failure only clears
/// `pending_request`, emits `score_failed`, and never panics.
#[test]
fn rule4_failed_results_change_nothing_but_pending() {
    let failures: Vec<(&str, Result<Option<Value>, String>)> = vec![
        ("execution failed", Err("OutLayer execution failed".to_string())),
        ("returned null", Ok(None)),
        ("Scorer run failed", Ok(Some(json!({"success": false, "error": "timeout"})))),
        ("Unrecognised", Ok(Some(json!({"weird": true})))),
        ("Band does not match score", Ok(Some(output(&riya(), "A", 270, 0, 0x11)))),
        ("is not the borrower", Ok(Some(output(&max(), "A", 1000, 1_000 * USDC, 0x11)))),
        ("already used by another borrower", Ok(Some(output(&riya(), "A", 1000, 1_000 * USDC, 0x99)))),
    ];
    for (want, result) in failures {
        // Fresh mocked storage per case (testing_env! keeps storage between contexts).
        near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
        let mut c = outlayer_contract();
        // Max already owns fingerprint 0x99.
        set(pool_id());
        c.accept_score(&max(), parse_output(&output(&max(), "A", 1000, 1_000 * USDC, 0x99)).unwrap())
            .unwrap();
        let stats_before = c.get_stats();

        request(&mut c, riya());
        set(pool_id());
        assert!(!c.finish_score(riya(), result), "{want}");

        let b = c.get_borrower(riya()).unwrap();
        assert!(!b.pending_request, "{want}: pending cleared");
        assert!(b.score.is_none(), "{want}: no score stored");
        assert_eq!(b.level, 1);
        assert!(c.borrowers.get(&riya()).unwrap().sealed_identity.is_none());
        assert_eq!(c.get_stats(), stats_before, "{want}: stats unchanged");
        assert_eq!(c.fingerprints.get(&[0x11; 32]), None, "{want}: fingerprint not taken");
        let ev = events_named("score_failed");
        assert_eq!(ev.len(), 1, "{want}");
        assert!(ev[0].contains(want), "{want} not in {}", ev[0]);

        // And the borrower can try again.
        request(&mut c, riya());
        assert!(c.get_borrower(riya()).unwrap().pending_request);
    }
}

// ------------------------------------------------------------------ rule 2

#[test]
fn rule2_owner_changes_scorer_version_with_event() {
    let mut c = new_contract();
    let new_v = "ab".repeat(32);
    set_yocto(owner());
    c.set_scorer_version(new_v.clone());
    assert_eq!(c.get_config().scorer_version, new_v);
    let ev = events_named("scorer_version_changed");
    assert_eq!(ev.len(), 1);
    assert!(ev[0].contains(VERSION) && ev[0].contains(&new_v));
    // Scores record the version that produced them.
    dev_submit(&mut c, riya(), riya_output());
    assert_eq!(c.get_borrower(riya()).unwrap().score.unwrap().scorer_version, new_v);
}

#[test]
#[should_panic(expected = "Only the owner can change the scorer version")]
fn rule2_non_owner_cannot_change_version() {
    let mut c = new_contract();
    set_yocto(riya());
    c.set_scorer_version("ab".repeat(32));
}

#[test]
#[should_panic(expected = "64-char lowercase hex")]
fn rule2_version_must_be_a_sha256() {
    let mut c = new_contract();
    set_yocto(owner());
    c.set_scorer_version("main".into());
}

#[test]
#[should_panic(expected = "64-char lowercase hex")]
fn init_rejects_non_hash_version() {
    set(owner());
    let mut i = config_input();
    i.scorer_version = "latest".into();
    Contract::new(i);
}

/// Contract <-> scorer compatibility: a real output of the scorer WASM (demo build, live Plaid
/// sandbox, Nov 1 2026) for Sam, including the optional `reply`, passes the strict parser.
#[test]
fn accepts_real_scorer_output() {
    let raw = r#"{"band":"D","caller":"sam.kency.testnet","fingerprint":"e329d846f3946c538dd48f289e95f1970064768ad3b50d16ff10b83e88b4e7fa","income_cap":650000000,"reply":"e4QQ3agqEuF1V/WBgKZ9Qo5rwLfkZIcC0auSgd7hPyZOYjrKeaiqVBqj+a/SVJyXbDHWR2oLor82mqCRkvho2bWAKLmCuKcCIOio4tbLhS8m2HIta5XS5AeuipKQmgyPDde56nkTrwmP5boLtRNLpdLaPOBt4PKaiPpIuAhNCg==","score":270,"sealed_identity":"K0UGKn1YNJUWdYtT3N5WEpPpz4QhJkX8P/tOVGaRu+tLGQbRMA==","v":1}"#;
    let v: Value = near_sdk::serde_json::from_str(raw).unwrap();
    let o = parse_output(&v).unwrap();
    assert_eq!(o.caller.as_str(), "sam.kency.testnet");
    assert_eq!((o.band, o.score, o.income_cap), (Band::D, 270, 650 * USDC));
    let mut c = new_contract();
    let sam = acc("sam.kency.testnet");
    dev_submit(&mut c, sam.clone(), v);
    assert_eq!(c.get_limit(sam).0, 0, "band D");
}

// ------------------------------------------------------------------ audit M1: raw callback, cancel

/// The real `on_score` entry point with raw promise bytes: invalid JSON, empty bytes and a failed
/// promise each clear `pending_request` and emit `score_failed` instead of panicking.
#[test]
fn on_score_raw_bytes_never_leave_request_pending() {
    use near_sdk::PromiseResult;
    let cases: Vec<(&str, PromiseResult)> = vec![
        ("not JSON", PromiseResult::Successful(b"<html>502</html>".to_vec())),
        ("returned null", PromiseResult::Successful(vec![])),
        ("returned null", PromiseResult::Successful(b"null".to_vec())),
        ("execution failed", PromiseResult::Failed),
        ("too long", PromiseResult::Successful(vec![b' '; MAX_OUTLAYER_RESULT_BYTES + 1])),
    ];
    for (want, raw) in cases {
        near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
        let mut c = outlayer_contract();
        request(&mut c, riya());
        assert!(c.get_borrower(riya()).unwrap().pending_request);
        set_callback(raw);
        assert!(!c.on_score(riya()), "{want}");
        assert!(!c.get_borrower(riya()).unwrap().pending_request, "{want}");
        let ev = events_named("score_failed");
        assert!(ev.len() == 1 && ev[0].contains(want), "{want}: {ev:?}");
    }
}

#[test]
fn on_score_raw_bytes_accepts_a_valid_answer() {
    let mut c = outlayer_contract();
    request(&mut c, riya());
    let bytes = near_sdk::serde_json::to_vec(&json!({"success": true, "output": riya_output()})).unwrap();
    set_callback(near_sdk::PromiseResult::Successful(bytes));
    assert!(c.on_score(riya()));
    let b = c.get_borrower(riya()).unwrap();
    assert!(!b.pending_request && b.score.is_some());
}

/// A borrower whose callback never completed (storage or gas ran out) can clear the flag and
/// score again; a late answer for the cancelled request is still the pinned scorer's own.
#[test]
fn borrower_cancels_stuck_score_request() {
    let mut c = outlayer_contract();
    request(&mut c, riya());
    set(riya());
    c.cancel_pending_score();
    let b = c.get_borrower(riya()).unwrap();
    assert!(!b.pending_request && b.score.is_none());
    assert!(events_named("score_failed").iter().any(|e| e.contains("Cancelled by the borrower")));
    request(&mut c, riya());
    assert!(c.get_borrower(riya()).unwrap().pending_request, "can request again");
    set(pool_id());
    assert!(c.finish_score(riya(), Ok(Some(riya_output()))));
}

#[test]
#[should_panic(expected = "No score request is pending")]
fn cancel_without_pending_request_panics() {
    let mut c = outlayer_contract();
    request(&mut c, riya());
    set(pool_id());
    assert!(c.finish_score(riya(), Ok(Some(riya_output()))));
    set(riya());
    c.cancel_pending_score();
}

#[test]
#[should_panic(expected = "Unknown borrower")]
fn cancel_by_stranger_panics() {
    let mut c = outlayer_contract();
    request(&mut c, riya());
    set(max());
    c.cancel_pending_score();
}
