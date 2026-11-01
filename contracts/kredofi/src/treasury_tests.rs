//! Treasury (Nov 1 fee change) and rule 10: the owner can withdraw only the treasury, or move it
//! into the reserve (one-way). No owner path to pool cash, outstanding or the reserve.

use crate::tests::*;
use crate::*;
use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::STANDARD as B64;
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{PromiseResult, RuntimeFeesConfig, testing_env};

const USDC: u128 = 1_000_000;
const DAY: u64 = 24 * 3600 * 1_000_000_000;

fn riya() -> AccountId { acc("riya.near") }

fn callback(result: PromiseResult) {
    testing_env!(ctx(pool_id()).build(), near_sdk::test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

/// $1,000 pool, $300 reserve, one repaid $100 band A loan: treasury $2.
fn with_treasury() -> Contract {
    let mut c = new_contract();
    deposit(&mut c, alice(), 1_000 * USDC);
    set(usdc());
    let _ = c.ft_on_transfer(owner(), U128(300 * USDC), MSG_SEED_RESERVE.into());
    testing_env!(ctx(acc("scorer.near")).build());
    c.dev_submit_score(riya(), json!({"v":1,"caller":riya(),"band":"A","score":1000,"income_cap":1_000_000_000u64,
        "fingerprint":"11".repeat(32),"sealed_identity":B64.encode(b"x")}));
    testing_env!(ctx(riya()).attached_deposit(NearToken::from_yoctonear(1)).build());
    let _ = c.borrow(U128(100 * USDC));
    callback(PromiseResult::Successful(vec![]));
    c.on_borrow_transfer(riya(), U128(100 * USDC), None);
    testing_env!(ctx(usdc()).block_timestamp(DAY).build());
    let _ = c.ft_on_transfer(riya(), U128(104 * USDC), MSG_REPAY.into());
    assert_eq!(c.get_pool().treasury.0, 2 * USDC);
    c
}

#[test]
fn owner_withdraws_treasury_only() {
    let mut c = with_treasury();
    let before = c.get_pool();
    set_yocto(owner());
    let _ = c.withdraw_treasury(U128(2 * USDC));
    let p = c.get_pool();
    assert_eq!(p.treasury.0, 0, "state first");
    assert_eq!((p.cash, p.outstanding, p.reserve, p.total_shares), (before.cash, before.outstanding, before.reserve, before.total_shares));
    callback(PromiseResult::Successful(vec![]));
    assert!(c.on_treasury_transfer(owner(), U128(2 * USDC)));
    assert_eq!(events_named("treasury_withdrawn").len(), 1);
}

#[test]
fn failed_treasury_transfer_rolls_back() {
    let mut c = with_treasury();
    let before = c.get_pool();
    set_yocto(owner());
    let _ = c.withdraw_treasury(U128(USDC));
    callback(PromiseResult::Failed);
    assert!(!c.on_treasury_transfer(owner(), U128(USDC)));
    assert_eq!(c.get_pool(), before);
    assert!(events_named("treasury_withdrawn").is_empty());
}

/// Rule 10: even with $1,002 of lender cash and a $300 reserve, the owner can't take a cent more
/// than the $2 treasury.
#[test]
#[should_panic(expected = "Amount is above the treasury balance")]
fn rule10_withdraw_capped_at_treasury() {
    let mut c = with_treasury();
    set_yocto(owner());
    let _ = c.withdraw_treasury(U128(2 * USDC + 1));
}

#[test]
#[should_panic(expected = "Amount is above the treasury balance")]
fn rule10_empty_treasury_withdraws_nothing() {
    let mut c = new_contract();
    deposit(&mut c, alice(), 1_000 * USDC);
    set(usdc());
    let _ = c.ft_on_transfer(owner(), U128(300 * USDC), MSG_SEED_RESERVE.into());
    set_yocto(owner());
    let _ = c.withdraw_treasury(U128(1));
}

#[test]
#[should_panic(expected = "Only the owner can withdraw the treasury")]
fn non_owner_cannot_withdraw_treasury() {
    let mut c = with_treasury();
    set_yocto(alice());
    let _ = c.withdraw_treasury(U128(1));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn withdraw_treasury_needs_one_yocto() {
    let mut c = with_treasury();
    set(owner());
    let _ = c.withdraw_treasury(U128(1));
}

#[test]
fn treasury_to_reserve_is_one_way_top_up() {
    let mut c = with_treasury();
    let before = c.get_pool();
    set_yocto(owner());
    c.treasury_to_reserve(U128(USDC + 500_000));
    let p = c.get_pool();
    assert_eq!(p.treasury.0, 500_000);
    assert_eq!(p.reserve.0, before.reserve.0 + USDC + 500_000);
    assert_eq!((p.cash, p.outstanding, p.total_shares), (before.cash, before.outstanding, before.total_shares));
    assert_eq!(events_named("treasury_to_reserve").len(), 1);
}

#[test]
#[should_panic(expected = "Amount is above the treasury balance")]
fn rule10_treasury_to_reserve_capped() {
    let mut c = with_treasury();
    set_yocto(owner());
    c.treasury_to_reserve(U128(2 * USDC + 1));
}

#[test]
#[should_panic(expected = "Only the owner can move the treasury")]
fn non_owner_cannot_move_treasury() {
    let mut c = with_treasury();
    set_yocto(alice());
    c.treasury_to_reserve(U128(1));
}

#[test]
fn reserve_gets_no_interest_and_still_covers_defaults() {
    let c = with_treasury();
    assert_eq!(c.get_pool().reserve.0, 300 * USDC);
}

// ------------------------------------------------------------------ migration v1 -> v2

#[test]
fn migrate_keeps_every_balance_and_adds_empty_treasury() {
    use crate::migrate::*;
    set(pool_id());
    let mut lenders: LookupMap<AccountId, u128> = LookupMap::new(b"l".to_vec());
    lenders.insert(alice(), 1_000 * USDC);
    lenders.flush();
    let i = config_input();
    let v1 = ContractV1 {
        config: ConfigV1 {
            owner: i.owner, usdc: i.usdc, scorer_mode: i.scorer_mode, dev_scorer: i.dev_scorer, outlayer: i.outlayer,
            scorer_project: i.scorer_project, scorer_version: i.scorer_version, secrets_profile: i.secrets_profile,
            secrets_account: i.secrets_account, partner_pubkey: [1u8; 32], loan_term_ns: 120_000_000_000,
            grace_ns: 60_000_000_000, score_ttl_ns: 30 * DAY, min_hold_ns: 60_000_000_000,
            reserve_share_bps: 2000, max_borrower_share_bps: 1000,
        },
        pool: PoolV1 { cash: 1_001_600_000, outstanding: 0, total_shares: 1_000 * USDC, reserve: 200_400_000 },
        lenders,
        borrowers: LookupMap::new(b"b".to_vec()),
        fingerprints: LookupMap::new(b"f".to_vec()),
        stats: Default::default(),
    };
    env::state_write(&v1);

    let c = Contract::migrate();
    let p = c.get_pool();
    assert_eq!((p.cash.0, p.outstanding.0, p.total_shares.0, p.reserve.0, p.treasury.0), (1_001_600_000, 0, 1_000 * USDC, 200_400_000, 0));
    assert_eq!(c.get_lender(alice()).shares.0, 1_000 * USDC, "lender shares survive (same storage prefix)");
    let v = c.get_config();
    assert_eq!((v.loan_term_ns.0, v.min_hold_ns.0, v.max_borrower_share_bps), (120_000_000_000, 60_000_000_000, 1000));
}

#[test]
#[should_panic(expected = "No v1 state to migrate")]
fn migrate_without_state_panics() {
    set(pool_id());
    Contract::migrate();
}
