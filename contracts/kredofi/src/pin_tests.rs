//! Scorer re-pin time lock (security review 2, High R2-H; SPEC 4 "Owner", rule 2).

use crate::tests::*;
use crate::*;
use near_sdk::testing_env;

const SEC: u64 = 1_000_000_000;
const HOUR: u64 = 3600 * SEC;
const NEW: &str = "abababababababababababababababababababababababababababababababab";

fn owner_at(ts: u64) {
    testing_env!(ctx(owner()).attached_deposit(NearToken::from_yoctonear(1)).block_timestamp(ts).build());
}

fn proposed(at: u64) -> Contract {
    let mut c = new_contract();
    owner_at(at);
    c.propose_scorer_version(NEW.into());
    c
}

fn testnet_input() -> ConfigInput {
    let id = acc("kredofi.kency.testnet");
    testing_env!(ctx(owner()).current_account_id(id).build());
    config_input()
}

#[test]
fn mainnet_default_is_24h_and_views_show_none() {
    let c = new_contract();
    assert_eq!(c.get_config().scorer_delay_ns.0, 24 * HOUR);
    assert_eq!(c.get_pending_scorer(), None);
    assert_eq!(c.get_config().pending_scorer, None);
}

#[test]
fn testnet_default_is_one_minute() {
    let c = Contract::new(testnet_input());
    assert_eq!(c.get_config().scorer_delay_ns.0, 60 * SEC);
}

#[test]
#[should_panic(expected = "scorer_delay_ns must be between")]
fn mainnet_init_refuses_under_one_hour() {
    set(owner());
    let mut i = config_input();
    i.scorer_delay_ns = Some(U64(HOUR - 1));
    Contract::new(i);
}

#[test]
fn mainnet_init_accepts_exactly_one_hour_and_testnet_one_minute() {
    set(owner());
    let mut i = config_input();
    i.scorer_delay_ns = Some(U64(HOUR));
    assert_eq!(Contract::new(i).get_config().scorer_delay_ns.0, HOUR);
    let mut t = testnet_input();
    t.scorer_delay_ns = Some(U64(60 * SEC));
    assert_eq!(Contract::new(t).get_config().scorer_delay_ns.0, 60 * SEC);
}

#[test]
#[should_panic(expected = "scorer_delay_ns must be between")]
fn testnet_init_refuses_under_one_minute() {
    let mut t = testnet_input();
    t.scorer_delay_ns = Some(U64(59 * SEC));
    Contract::new(t);
}

#[test]
#[should_panic(expected = "scorer_delay_ns must be between")]
fn init_refuses_over_30_days() {
    set(owner());
    let mut i = config_input();
    i.scorer_delay_ns = Some(U64(MAX_SCORER_DELAY_NS + 1));
    Contract::new(i);
}

#[test]
fn propose_records_pending_with_event_and_keeps_old_pin() {
    let c = proposed(5 * SEC);
    let p = c.get_pending_scorer().unwrap();
    assert_eq!((p.version.as_str(), p.proposed_at.0, p.apply_at.0), (NEW, 5 * SEC, 5 * SEC + 24 * HOUR));
    assert_eq!(c.get_config().pending_scorer, Some(p));
    assert_eq!(c.get_config().scorer_version, VERSION, "the pin does not change at propose");
    let ev = events_named("scorer_change_proposed");
    assert_eq!(ev.len(), 1);
    let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(ev[0].trim_start_matches("EVENT_JSON:")).unwrap();
    let d = &v["data"][0];
    assert_eq!((d["old"].as_str(), d["new"].as_str(), d["by"].as_str()), (Some(VERSION), Some(NEW), Some(owner().as_str())));
    assert_eq!(d["apply_at"], (5 * SEC + 24 * HOUR).to_string());
}

#[test]
#[should_panic(expected = "still in its time lock")]
fn apply_before_delay_panics() {
    let mut c = proposed(0);
    owner_at(24 * HOUR - 1);
    c.apply_scorer_version();
}

#[test]
fn apply_at_delay_pins_and_clears_pending() {
    let mut c = proposed(0);
    owner_at(24 * HOUR);
    c.apply_scorer_version();
    assert_eq!(c.get_config().scorer_version, NEW);
    assert_eq!(c.get_pending_scorer(), None);
    let ev = events_named("scorer_version_changed");
    assert_eq!(ev.len(), 1);
    assert!(ev[0].contains(VERSION) && ev[0].contains(NEW));
}

#[test]
#[should_panic(expected = "Only the owner can change the scorer version")]
fn non_owner_cannot_apply() {
    let mut c = proposed(0);
    testing_env!(ctx(alice()).attached_deposit(NearToken::from_yoctonear(1)).block_timestamp(48 * HOUR).build());
    c.apply_scorer_version();
}

#[test]
#[should_panic(expected = "Only the owner can change the scorer version")]
fn non_owner_cannot_cancel() {
    let mut c = proposed(0);
    set_yocto(alice());
    c.cancel_scorer_version();
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn propose_needs_one_yocto() {
    let mut c = new_contract();
    set(owner());
    c.propose_scorer_version(NEW.into());
}

#[test]
fn cancel_drops_pending_with_event_and_apply_then_fails() {
    let mut c = proposed(0);
    owner_at(HOUR);
    c.cancel_scorer_version();
    assert_eq!(c.get_pending_scorer(), None);
    let ev = events_named("scorer_change_cancelled");
    assert_eq!(ev.len(), 1);
    assert!(ev[0].contains(NEW));
    owner_at(48 * HOUR);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.apply_scorer_version()));
    assert!(r.is_err(), "nothing to apply after cancel");
    assert_eq!(c.get_config().scorer_version, VERSION);
}

#[test]
#[should_panic(expected = "already pending")]
fn second_proposal_needs_cancel_first() {
    let mut c = proposed(0);
    owner_at(1);
    c.propose_scorer_version("cd".repeat(32));
}

#[test]
fn new_proposal_after_cancel_restarts_the_clock() {
    let mut c = proposed(0);
    owner_at(23 * HOUR);
    c.cancel_scorer_version();
    c.propose_scorer_version("cd".repeat(32));
    assert_eq!(c.get_pending_scorer().unwrap().apply_at.0, 47 * HOUR);
}

#[test]
#[should_panic(expected = "already pinned")]
fn proposing_the_current_pin_panics() {
    let mut c = new_contract();
    set_yocto(owner());
    c.propose_scorer_version(VERSION.into());
}

#[test]
#[should_panic(expected = "No scorer change is pending")]
fn apply_without_proposal_panics() {
    let mut c = new_contract();
    set_yocto(owner());
    c.apply_scorer_version();
}

#[test]
#[should_panic(expected = "No scorer change is pending")]
fn cancel_without_proposal_panics() {
    let mut c = new_contract();
    set_yocto(owner());
    c.cancel_scorer_version();
}

#[test]
fn delay_can_be_increased_with_param_event() {
    let mut c = new_contract();
    set_yocto(owner());
    c.set_scorer_delay_ns(U64(48 * HOUR));
    assert_eq!(c.get_config().scorer_delay_ns.0, 48 * HOUR);
    let ev = events_named("param_changed");
    assert!(ev.last().unwrap().contains("scorer_delay_ns"));
    // A later proposal uses the longer lock.
    c.propose_scorer_version(NEW.into());
    assert_eq!(c.get_pending_scorer().unwrap().apply_at.0, 48 * HOUR);
}

#[test]
#[should_panic(expected = "can only be increased")]
fn delay_can_never_be_shortened() {
    let mut c = new_contract();
    set_yocto(owner());
    c.set_scorer_delay_ns(U64(24 * HOUR - 1));
}

#[test]
#[should_panic(expected = "scorer_delay_ns must be between")]
fn delay_is_capped_at_30_days() {
    let mut c = new_contract();
    set_yocto(owner());
    c.set_scorer_delay_ns(U64(MAX_SCORER_DELAY_NS + 1));
}

#[test]
#[should_panic(expected = "Only the owner can change parameters")]
fn non_owner_cannot_change_delay() {
    let mut c = new_contract();
    set_yocto(alice());
    c.set_scorer_delay_ns(U64(48 * HOUR));
}

#[test]
fn raising_delay_does_not_move_a_pending_apply_time() {
    let mut c = proposed(0);
    owner_at(1);
    c.set_scorer_delay_ns(U64(72 * HOUR));
    assert_eq!(c.get_pending_scorer().unwrap().apply_at.0, 24 * HOUR, "fixed when proposed");
}

#[test]
fn propose_near_u64_max_fails_cleanly() {
    let mut c = new_contract();
    owner_at(u64::MAX - HOUR);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.propose_scorer_version(NEW.into())));
    assert!(r.is_err(), "time overflow refused");
    assert_eq!(c.get_pending_scorer(), None);
}

#[test]
fn requests_pin_old_version_until_applied() {
    // OutLayer request pins whatever `config.scorer_version` is; the pending one is not used.
    let mut c = proposed(0);
    assert_eq!(c.get_config().scorer_version, VERSION);
    owner_at(24 * HOUR);
    c.apply_scorer_version();
    assert_eq!(c.get_config().scorer_version, NEW);
}
