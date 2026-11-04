//! Security review 2 (AI-assisted, not a professional audit) sandbox tests. The reviewer's proofs,
//! turned into regression tests after the fixes (docs/SECURITY_AUDIT.md, Review 2).

mod common;

use common::*;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::Account;
use serde_json::{Value, json};

const TERM_NS: u64 = 120_000_000_000;
const GRACE_NS: u64 = 60_000_000_000;
const BYTE: u128 = 10_000_000_000_000_000_000; // yocto per storage byte

fn output(caller: &str, fp_byte: u8) -> Value {
    json!({
        "v": 1, "caller": caller, "band": "A", "score": 1000,
        "income_cap": 1_000_000_000u64,
        "fingerprint": format!("{fp_byte:02x}").repeat(32),
        // 73 bytes, the size the code comment gives for a sealed 25-character name
        "sealed_identity": "QUFB".repeat(24) + "QQ==",
    })
}

async fn set_mock(env: &Env, response: Option<Value>, fail: bool) -> anyhow::Result<()> {
    env.owner.call(env.outlayer.id(), "set_response")
        .args_json(json!({ "response": response, "fail": fail }))
        .transact().await?.into_result()?;
    Ok(())
}

async fn request_score(who: &Account, env: &Env) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(who.call(env.pool.id(), "request_score")
        .args_json(json!({ "public_token": "public-sandbox-1", "reply_pubkey": "aa".repeat(32) }))
        .deposit(NearToken::from_millinear(10))
        .gas(Gas::from_tgas(200))
        .transact().await?)
}

async fn borrower(env: &Env, who: &Account) -> anyhow::Result<Value> {
    Ok(env.pool.view("get_borrower").args_json(json!({ "account_id": who.id() })).await?.json()?)
}

async fn storage(env: &Env) -> anyhow::Result<u64> {
    Ok(env.pool.view_account().await?.storage_usage)
}

async fn outlayer_env() -> anyhow::Result<Env> {
    setup_with(|c| {
        c["scorer_mode"] = json!("OutLayer");
        c["dev_scorer"] = Value::Null;
        c["loan_term_ns"] = json!(TERM_NS.to_string());
        c["grace_ns"] = json!(GRACE_NS.to_string());
    })
    .await
}

/// Review 2 M1, fixed: the contract pays storage for every borrower record and fingerprint, and an
/// `on_release` that fails on storage reverts as a whole, leaving `pending_request = true`. Before the
/// fix nothing could clear it (the blocked borrower can't cancel; a new release was refused as
/// "already pending"), so the identity release was lost. Now the release can be requested again once
/// the contract is topped up, and it completes. Also measures the storage the contract pays per borrower.
#[tokio::test]
async fn r2_starved_release_can_be_retried_after_top_up() -> anyhow::Result<()> {
    let env = outlayer_env().await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 1_000 * USDC, "deposit").await?.into_result()?;

    // Storage paid by the contract per borrower record (who pays: the contract, never the caller).
    let probe = new_user(&env, "probe-account-with-a-long-name-0123456789", 0).await?;
    set_mock(&env, None, true).await?;
    let s0 = storage(&env).await?;
    let r = request_score(&probe, &env).await?;
    assert!(r.is_success());
    let failed_record = storage(&env).await? - s0;
    let max = new_user(&env, "max", 0).await?;
    set_mock(&env, Some(output("$SIGNER", 0x33)), false).await?;
    let s1 = storage(&env).await?;
    assert!(request_score(&max, &env).await?.json::<bool>()?);
    let scored_record = storage(&env).await? - s1;
    println!("storage paid by contract: failed request {failed_record} B, scored borrower {scored_record} B");
    assert!(failed_record > 0 && scored_record > failed_record);

    env.worker.fast_forward(1).await?;
    max.call(env.pool.id(), "borrow").args_json(json!({ "amount": (10 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(60)).transact().await?.into_result()?;
    let due_at: u64 = borrower(&env, &max).await?["loan"]["due_at"].as_str().unwrap().parse()?;
    advance_past(&env, due_at + GRACE_NS).await?;
    env.bob.call(env.pool.id(), "mark_default").args_json(json!({ "borrower": max.id() }))
        .transact().await?.into_result()?;

    // Leave the contract ~40 bytes of free storage (an attacker can reach this by creating
    // borrower records with request_score from fresh accounts; mainnet has ~4.5 KB free).
    let acct = env.pool.view_account().await?;
    let (bal, used) = (acct.balance.as_yoctonear(), acct.storage_usage as u128);
    let send = bal - used * BYTE - 40 * BYTE;
    env.pool.as_account().transfer_near(env.owner.id(), NearToken::from_yoctonear(send)).await?.into_result()?;

    // Release output of 200 bytes (limit is 256).
    let released = "QUFB".repeat(66) + "QUE=";
    set_mock(&env, Some(json!({ "v": 1, "released": released })), false).await?;
    let out = env.alice.call(env.pool.id(), "request_identity_release")
        .args_json(json!({ "borrower": max.id() }))
        .deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(200)).transact().await?;
    println!("release tx failures: {:?}", out.failures());
    let b = borrower(&env, &max).await?;
    assert_eq!(b["pending_request"], true, "on_release reverted on storage; flag left set");
    assert!(b["released_identity"].is_null());

    // Top up, then request the release again: it completes.
    env.owner.transfer_near(env.pool.id(), NearToken::from_near(5)).await?.into_result()?;
    let out = max.call(env.pool.id(), "cancel_pending_score").transact().await?;
    assert!(format!("{:?}", out.failures()).contains("can't be cancelled"), "a defaulter still can't cancel");
    let out = env.alice.call(env.pool.id(), "request_identity_release")
        .args_json(json!({ "borrower": max.id() }))
        .deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(200)).transact().await?;
    assert!(out.is_success(), "{:?}", out.failures());
    let b = borrower(&env, &max).await?;
    assert_eq!(b["pending_request"], false);
    assert!(!b["released_identity"].is_null(), "identity released after the retry");
    // Released once: a further request is refused.
    let out = env.alice.call(env.pool.id(), "request_identity_release")
        .args_json(json!({ "borrower": max.id() }))
        .deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(200)).transact().await?;
    assert!(format!("{:?}", out.failures()).contains("only allowed once"));
    Ok(())
}

/// Gas actually burnt by each callback in the normal path, versus the static gas reserved
/// (on_score 30 Tgas, on_release 20, on_borrow_transfer 15, on_withdraw_transfer 15).
#[tokio::test]
async fn r2_callback_gas_vs_reserved() -> anyhow::Result<()> {
    let env = outlayer_env().await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 1_000 * USDC, "deposit").await?.into_result()?;
    set_mock(&env, Some(output("$SIGNER", 0x44)), false).await?;
    let max = new_user(&env, "max", 0).await?;
    let out = request_score(&max, &env).await?;
    for r in out.receipt_outcomes() {
        println!("request_score receipt {} burnt {} Tgas", r.executor_id, r.gas_burnt.as_tgas());
    }
    let out = max.call(env.pool.id(), "borrow").args_json(json!({ "amount": (10 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(60)).transact().await?;
    for r in out.receipt_outcomes() {
        println!("borrow receipt {} burnt {} Tgas", r.executor_id, r.gas_burnt.as_tgas());
    }
    let out = withdraw(&env.alice, &env.pool, 5 * USDC).await?;
    for r in out.receipt_outcomes() {
        println!("withdraw receipt {} burnt {} Tgas", r.executor_id, r.gas_burnt.as_tgas());
    }
    Ok(())
}
