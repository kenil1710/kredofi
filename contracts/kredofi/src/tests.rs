//! Unit tests for config and pool logic. Cross-contract behaviour (real token transfers,
//! refunds, rollback after a real failed transfer) is covered in `tests/` with near-workspaces.

use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_logs};
use near_sdk::{PromiseResult, RuntimeFeesConfig, testing_env};

const USDC: u128 = 1_000_000; // 6 decimals: $1

pub fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
pub fn owner() -> AccountId {
    acc("owner.near")
}
pub fn usdc() -> AccountId {
    acc("usdc.near")
}
pub fn pool_id() -> AccountId {
    acc("kredofi.near")
}
pub fn alice() -> AccountId {
    acc("alice.near")
}
pub fn bob() -> AccountId {
    acc("bob.near")
}

pub const VERSION: &str = "f45185a0f45185a0f45185a0f45185a0f45185a0f45185a0f45185a0f45185a0";
const PARTNER: &str = "0101010101010101010101010101010101010101010101010101010101010101";

pub fn config_input() -> ConfigInput {
    ConfigInput {
        owner: owner(),
        usdc: usdc(),
        scorer_mode: ScorerMode::Dev,
        dev_scorer: Some(acc("scorer.near")),
        outlayer: acc("outlayer.near"),
        scorer_project: "owner.near/kredofi-scorer".into(),
        scorer_version: VERSION.into(),
        secrets_profile: "kredofi".into(),
        secrets_account: owner(),
        partner_pubkey: PARTNER.into(),
        loan_term_ns: U64(30 * 24 * 3600 * 1_000_000_000),
        grace_ns: U64(7 * 24 * 3600 * 1_000_000_000),
        score_ttl_ns: U64(30 * 24 * 3600 * 1_000_000_000),
        max_borrower_share_bps: 1000,
    }
}

pub fn ctx(predecessor: AccountId) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(pool_id())
        .predecessor_account_id(predecessor.clone())
        .signer_account_id(predecessor);
    b
}

pub fn set(predecessor: AccountId) {
    testing_env!(ctx(predecessor).build());
}

pub fn set_yocto(predecessor: AccountId) {
    testing_env!(
        ctx(predecessor)
            .attached_deposit(NearToken::from_yoctonear(1))
            .build()
    );
}

pub fn set_callback(result: PromiseResult) {
    testing_env!(
        ctx(pool_id()).build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

pub fn new_contract() -> Contract {
    set(owner());
    Contract::new(config_input())
}

pub fn deposit(c: &mut Contract, lender: AccountId, amount: u128) {
    set(usdc());
    let _ = c.ft_on_transfer(lender, U128(amount), MSG_DEPOSIT.into());
}

pub fn events_named(name: &str) -> Vec<String> {
    get_logs()
        .into_iter()
        .filter(|l| {
            l.starts_with("EVENT_JSON:{") && l.contains(&format!("\"event\":\"{name}\""))
        })
        .collect()
}

// ------------------------------------------------------------------ config

#[test]
fn init_stores_config_and_derives_min_hold() {
    let c = new_contract();
    let v = c.get_config();
    assert_eq!(v.owner, owner());
    assert_eq!(v.usdc, usdc());
    assert_eq!(v.scorer_mode, ScorerMode::Dev);
    assert_eq!(v.partner_pubkey, PARTNER);
    assert_eq!(v.min_hold_ns.0, v.loan_term_ns.0 / 2);
    assert_eq!(v.max_borrower_share_bps, 1000);
    assert_eq!(c.get_pool(), PoolView {
        cash: U128(0),
        outstanding: U128(0),
        total_shares: U128(0),
        reserve: U128(0),
        treasury: U128(0),
        pool_value: U128(0),
    });
}

#[test]
#[should_panic(expected = "Dev mode needs a dev_scorer account")]
fn dev_mode_requires_dev_scorer() {
    set(owner());
    let mut i = config_input();
    i.dev_scorer = None;
    Contract::new(i);
}

#[test]
fn outlayer_mode_without_dev_scorer_is_fine() {
    set(owner());
    let mut i = config_input();
    i.scorer_mode = ScorerMode::OutLayer;
    i.dev_scorer = None;
    assert_eq!(Contract::new(i).get_config().scorer_mode, ScorerMode::OutLayer);
}

#[test]
#[should_panic(expected = "partner_pubkey must be 32 bytes of hex")]
fn bad_partner_pubkey_rejected() {
    set(owner());
    let mut i = config_input();
    i.partner_pubkey = "abcd".into();
    Contract::new(i);
}

#[test]
#[should_panic(expected = "partner_pubkey must be 32 bytes of hex")]
fn non_hex_partner_pubkey_rejected() {
    set(owner());
    let mut i = config_input();
    i.partner_pubkey = "zz".repeat(32);
    Contract::new(i);
}

#[test]
fn hex_roundtrip() {
    let bytes: Vec<u8> = (0..=255).collect();
    assert_eq!(hex_decode(&hex_encode(&bytes)).unwrap(), bytes);
    assert_eq!(hex_decode("0g"), None);
    assert_eq!(hex_decode("abc"), None);
}

// ------------------------------------------------------------------ deposit

#[test]
fn first_deposit_mints_at_par_and_emits_event() {
    let mut c = new_contract();
    set(usdc());
    let ret = c.ft_on_transfer(alice(), U128(1000 * USDC), MSG_DEPOSIT.into());
    assert!(matches!(ret, PromiseOrValue::Value(U128(0))), "all tokens used");
    assert_eq!(c.get_lender(alice()), LenderView {
        shares: U128(1000 * USDC),
        value: U128(1000 * USDC),
    });
    let p = c.get_pool();
    assert_eq!((p.cash.0, p.total_shares.0, p.pool_value.0), (1000 * USDC, 1000 * USDC, 1000 * USDC));
    let ev = events_named("lender_deposit");
    assert_eq!(ev.len(), 1);
    assert!(ev[0].contains("\"standard\":\"kredofi\""));
    assert!(ev[0].contains("\"version\":\"1.0.0\""));
    assert!(ev[0].contains("\"lender\":\"alice.near\""));
    assert!(ev[0].contains("\"amount\":\"1000000000\""));
}

#[test]
fn deposit_after_interest_mints_at_current_price() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 1000 * USDC);
    // Simulate earned interest (day 3 adds it via repay): pool worth $1016 for 1000 shares.
    c.pool.cash += 16 * USDC;
    deposit(&mut c, bob(), 1016 * USDC);
    assert_eq!(c.get_lender(bob()).shares.0, 1000 * USDC);
    assert_eq!(c.get_lender(alice()).value.0, 1016 * USDC);
    assert_eq!(c.get_lender(bob()).value.0, 1016 * USDC);
}

#[test]
#[should_panic(expected = "Only the configured USDC token is accepted")]
fn deposit_from_other_token_rejected() {
    let mut c = new_contract();
    set(acc("fake-usdc.near"));
    let _ = c.ft_on_transfer(alice(), U128(100 * USDC), MSG_DEPOSIT.into());
}

#[test]
#[should_panic(expected = "Unknown msg")]
fn unknown_msg_rejected() {
    let mut c = new_contract();
    set(usdc());
    let _ = c.ft_on_transfer(alice(), U128(100 * USDC), "donate".into());
}

#[test]
#[should_panic(expected = "deposits are closed")]
fn deposit_into_wiped_out_pool_rejected() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 100 * USDC);
    c.pool.cash = 0; // total loss, shares remain
    deposit(&mut c, bob(), 100 * USDC);
}

#[test]
#[should_panic(expected = "Deposit too small for one share")]
fn dust_deposit_that_mints_zero_shares_rejected() {
    let mut c = new_contract();
    deposit(&mut c, alice(), USDC);
    c.pool.cash += 1_000_000 * USDC; // price just over 1 USDC per base-unit share
    deposit(&mut c, bob(), USDC);
}

/// Audit M1: the contract pays storage for each lender record, so dust deposits are refused.
#[test]
#[should_panic(expected = "Deposit at least 1 USDC")]
fn deposit_under_one_usdc_rejected() {
    let mut c = new_contract();
    deposit(&mut c, alice(), USDC - 1);
}

#[test]
fn deposit_of_exactly_one_usdc_accepted() {
    let mut c = new_contract();
    deposit(&mut c, alice(), USDC);
    assert_eq!(c.get_lender(alice()).value.0, USDC);
}

// ------------------------------------------------------------------ seed_reserve

#[test]
fn owner_seeds_reserve_outside_pool_value() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 1000 * USDC);
    set(usdc());
    let _ = c.ft_on_transfer(owner(), U128(300 * USDC), MSG_SEED_RESERVE.into());
    let p = c.get_pool();
    assert_eq!(p.reserve.0, 300 * USDC);
    assert_eq!(p.pool_value.0, 1000 * USDC, "reserve is not lender money");
    assert_eq!(c.get_lender(alice()).value.0, 1000 * USDC);
    assert_eq!(events_named("reserve_seeded").len(), 1);
}

#[test]
#[should_panic(expected = "Only the owner can seed the reserve")]
fn non_owner_cannot_seed_reserve() {
    let mut c = new_contract();
    set(usdc());
    let _ = c.ft_on_transfer(alice(), U128(300 * USDC), MSG_SEED_RESERVE.into());
}

// ------------------------------------------------------------------ withdraw

#[test]
fn withdraw_burns_shares_and_moves_cash_before_transfer() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 1000 * USDC);
    set_yocto(alice());
    let _ = c.withdraw(U128(400 * USDC));
    // State already updated before the transfer resolves (rule 7).
    assert_eq!(c.get_lender(alice()).shares.0, 600 * USDC);
    let p = c.get_pool();
    assert_eq!((p.cash.0, p.total_shares.0), (600 * USDC, 600 * USDC));

    set_callback(PromiseResult::Successful(vec![]));
    assert!(c.on_withdraw_transfer(alice(), U128(400 * USDC), U128(400 * USDC)));
    assert_eq!(events_named("lender_withdraw").len(), 1);
    assert_eq!(c.get_lender(alice()).shares.0, 600 * USDC);
}

#[test]
fn failed_withdraw_transfer_rolls_back_exactly() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 1000 * USDC);
    deposit(&mut c, bob(), 500 * USDC);
    let before_pool = c.get_pool();
    let before_alice = c.get_lender(alice());

    set_yocto(alice());
    let _ = c.withdraw(U128(1000 * USDC)); // all of Alice's shares: entry removed
    assert_eq!(c.get_lender(alice()).shares.0, 0);

    set_callback(PromiseResult::Failed);
    assert!(!c.on_withdraw_transfer(alice(), U128(1000 * USDC), U128(1000 * USDC)));
    assert_eq!(c.get_pool(), before_pool);
    assert_eq!(c.get_lender(alice()), before_alice);
    assert!(events_named("lender_withdraw").is_empty(), "no event for a failed withdraw");
}

#[test]
fn withdraw_after_interest_pays_more() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 1000 * USDC);
    c.pool.cash += 16 * USDC;
    set_yocto(alice());
    let _ = c.withdraw(U128(500 * USDC));
    assert_eq!(c.get_pool().cash.0, 508 * USDC); // paid 508
    assert_eq!(c.get_lender(alice()).value.0, 508 * USDC);
}

#[test]
#[should_panic(expected = "Not enough cash in the pool right now")]
fn withdraw_limited_by_cash() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 1000 * USDC);
    // Simulate $700 lent out (day 3 does this via borrow).
    c.pool.cash -= 700 * USDC;
    c.pool.outstanding += 700 * USDC;
    set_yocto(alice());
    let _ = c.withdraw(U128(400 * USDC));
}

#[test]
fn withdraw_up_to_cash_succeeds_when_partly_lent() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 1000 * USDC);
    c.pool.cash -= 700 * USDC;
    c.pool.outstanding += 700 * USDC;
    set_yocto(alice());
    let _ = c.withdraw(U128(300 * USDC));
    let p = c.get_pool();
    assert_eq!((p.cash.0, p.outstanding.0, p.pool_value.0), (0, 700 * USDC, 700 * USDC));
}

#[test]
#[should_panic(expected = "Not enough shares")]
fn cannot_withdraw_more_than_owned() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 100 * USDC);
    deposit(&mut c, bob(), 100 * USDC);
    set_yocto(alice());
    let _ = c.withdraw(U128(100 * USDC + 1));
}

#[test]
#[should_panic(expected = "Not enough shares")]
fn owner_without_shares_cannot_withdraw() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 100 * USDC);
    set(usdc());
    let _ = c.ft_on_transfer(owner(), U128(300 * USDC), MSG_SEED_RESERVE.into());
    set_yocto(owner());
    let _ = c.withdraw(U128(1));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn withdraw_requires_one_yocto() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 100 * USDC);
    set(alice());
    let _ = c.withdraw(U128(1));
}

#[test]
#[should_panic(expected = "Shares must be positive")]
fn withdraw_zero_rejected() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 100 * USDC);
    set_yocto(alice());
    let _ = c.withdraw(U128(0));
}

// `#[private]` on callbacks is enforced by the wasm entry point, so it is tested in
// tests/tests/pool.rs against the real contract, not here.
