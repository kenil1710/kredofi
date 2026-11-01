//! Day 3: loans on a real sandbox. The SPEC 8 demo flows (Riya, Sam, Max) as contract
//! tests, plus rules 7, 11, 12, 13 with real token transfers.
//! Demo timing: 60 s loan term (30 s minimum hold), 20 s grace.

mod common;

use common::*;
use near_workspaces::Account;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use serde_json::{Value, json};

const TERM_NS: u64 = 60_000_000_000;
const GRACE_NS: u64 = 20_000_000_000;

async fn demo_env() -> anyhow::Result<Env> {
    setup_with(|c| {
        c["loan_term_ns"] = json!(TERM_NS.to_string());
        c["grace_ns"] = json!(GRACE_NS.to_string());
    })
    .await
}

/// SPEC 8 step 1: a lender deposits $1,000; the owner seeds a $300 reserve.
async fn funded_env() -> anyhow::Result<Env> {
    let env = demo_env().await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 1_000 * USDC, "deposit").await?.into_result()?;
    transfer_call(&env.owner, &env.usdc, env.pool.id(), 300 * USDC, "seed_reserve").await?.into_result()?;
    Ok(env)
}

fn output(caller: &str, band: &str, score: u64, fp_byte: u8) -> Value {
    json!({
        "v": 1, "caller": caller, "band": band, "score": score,
        "income_cap": 1_000_000_000u64,
        "fingerprint": format!("{fp_byte:02x}").repeat(32),
        "sealed_identity": "c2VhbGVkLW5hbWU=",
    })
}

async fn score(env: &Env, who: &Account, band: &str, score: u64, fp_byte: u8) -> anyhow::Result<()> {
    env.scorer
        .call(env.pool.id(), "dev_submit_score")
        .args_json(json!({ "borrower": who.id(), "output": output(who.id().as_str(), band, score, fp_byte) }))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

async fn borrow(env: &Env, who: &Account, amount: u128) -> anyhow::Result<ExecutionFinalResult> {
    Ok(who
        .call(env.pool.id(), "borrow")
        .args_json(json!({ "amount": amount.to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(60))
        .transact()
        .await?)
}

async fn borrower(env: &Env, who: &Account) -> anyhow::Result<Value> {
    Ok(env.pool.view("get_borrower").args_json(json!({ "account_id": who.id() })).await?.json()?)
}

async fn limit(env: &Env, who: &Account) -> anyhow::Result<u128> {
    let v: String = env.pool.view("get_limit").args_json(json!({ "account_id": who.id() })).await?.json()?;
    Ok(v.parse()?)
}

fn fails_with(out: &ExecutionFinalResult, text: &str) {
    assert!(out.is_failure(), "expected failure '{text}', got success");
    let f = format!("{:?}", out.failures());
    assert!(f.contains(text), "expected '{text}' in {f}");
}

// ------------------------------------------------------------------ SPEC 8 flows

/// SPEC 8 step 2: Riya is scored A, borrows $100, repays $102 after the minimum hold,
/// reaches level 2 with a $250 limit. Lenders earn $1.60, the reserve $0.40.
#[tokio::test]
async fn riya_borrows_repays_and_levels_up() -> anyhow::Result<()> {
    let env = funded_env().await?;
    let riya = new_user(&env, "riya", 10).await?; // 10 test USDC to pay interest (SPEC 8a)
    score(&env, &riya, "A", 1000, 0x11).await?;
    assert_eq!(limit(&env, &riya).await?, 100 * USDC);

    let out = borrow(&env, &riya, 100 * USDC).await?;
    assert!(out.is_success(), "{out:?}");
    assert!(out.clone().json::<bool>()?);
    let ev = events(&out);
    assert_eq!(ev[0]["event"], "loan_issued");
    assert_eq!(ev[0]["data"][0]["interest"], "2000000");
    assert_eq!(balance(&env.usdc, riya.id()).await?, 110 * USDC);
    let p = pool_state(&env.pool).await?;
    assert_eq!((p.cash, p.outstanding, p.pool_value), (900 * USDC, 100 * USDC, 1_000 * USDC));
    assert_books_balance(&env).await?;

    let issued_at: u64 = borrower(&env, &riya).await?["loan"]["issued_at"].as_str().unwrap().parse()?;
    advance_past(&env, issued_at + TERM_NS / 2).await?;

    let out = transfer_call(&riya, &env.usdc, env.pool.id(), 102 * USDC, "repay").await?;
    assert_eq!(out.clone().json::<String>()?, (102 * USDC).to_string(), "all used: {out:?}");
    let ev = events(&out);
    assert_eq!(ev[0]["event"], "loan_repaid");
    assert_eq!(ev[0]["data"][0]["leveled_up"], true);
    assert_eq!(ev[0]["data"][0]["to_reserve"], "400000");

    let b = borrower(&env, &riya).await?;
    assert_eq!(b["level"], 2);
    assert_eq!(b["loan"]["state"], "Repaid");
    assert_eq!(limit(&env, &riya).await?, 250 * USDC);
    assert_eq!(balance(&env.usdc, riya.id()).await?, 8 * USDC);

    let p = pool_state(&env.pool).await?;
    assert_eq!((p.cash, p.outstanding, p.reserve), (1_001_600_000, 0, 300_400_000));
    assert_eq!(lender(&env.pool, env.alice.id()).await?.1, 1_001_600_000, "share price rose");
    assert_books_balance(&env).await?;

    let stats: Value = env.pool.view("get_stats").await?.json()?;
    assert_eq!(stats["A"]["loans_issued"], 1);
    assert_eq!(stats["A"]["repaid"], 1);
    assert_eq!(stats["A"]["volume"], (100 * USDC).to_string());
    Ok(())
}

/// SPEC 8 step 3: Sam is band D; borrowing is refused with a plain reason.
#[tokio::test]
async fn sam_band_d_cannot_borrow() -> anyhow::Result<()> {
    let env = funded_env().await?;
    let sam = new_user(&env, "sam", 10).await?;
    score(&env, &sam, "D", 270, 0x22).await?;
    assert_eq!(limit(&env, &sam).await?, 0);
    fails_with(&borrow(&env, &sam, USDC).await?, "Band D cannot borrow");
    assert_eq!(balance(&env.usdc, sam.id()).await?, 10 * USDC);
    assert_eq!(pool_state(&env.pool).await?.outstanding, 0);
    Ok(())
}

/// SPEC 8 step 5: Max borrows $100 and misses the due date; anyone marks the default;
/// the reserve covers the loss; Max is blocked; his identity is released to the partner key.
#[tokio::test]
async fn max_defaults_reserve_pays_identity_released() -> anyhow::Result<()> {
    let env = funded_env().await?;
    let max = new_user(&env, "max", 0).await?;
    score(&env, &max, "A", 1000, 0x33).await?;
    borrow(&env, &max, 100 * USDC).await?.into_result()?;
    let due_at: u64 = borrower(&env, &max).await?["loan"]["due_at"].as_str().unwrap().parse()?;

    // Too early: still inside due date + grace.
    fails_with(
        &env.bob.call(env.pool.id(), "mark_default").args_json(json!({ "borrower": max.id() })).transact().await?,
        "not past due date plus grace",
    );

    advance_past(&env, due_at + GRACE_NS).await?;
    let out = env.bob.call(env.pool.id(), "mark_default").args_json(json!({ "borrower": max.id() })).transact().await?;
    assert!(out.is_success(), "{out:?}");
    let ev = events(&out);
    assert_eq!(ev[0]["event"], "loan_defaulted");
    assert_eq!(ev[0]["data"][0]["covered_by_reserve"], (100 * USDC).to_string());
    assert_eq!(ev[0]["data"][0]["lender_loss"], "0");

    let p = pool_state(&env.pool).await?;
    assert_eq!((p.cash, p.outstanding, p.reserve), (1_000 * USDC, 0, 200 * USDC));
    assert_eq!(lender(&env.pool, env.alice.id()).await?.1, 1_000 * USDC, "lenders whole");
    assert_books_balance(&env).await?;

    let b = borrower(&env, &max).await?;
    assert_eq!(b["blocked"], true);
    assert_eq!(b["defaults"], 1);
    assert_eq!(b["loan"]["state"], "Defaulted");
    fails_with(&borrow(&env, &max, USDC).await?, "Borrower is blocked");
    // Max can't come back with a new score either.
    let out = env.scorer
        .call(env.pool.id(), "dev_submit_score")
        .args_json(json!({ "borrower": max.id(), "output": output(max.id().as_str(), "A", 1000, 0x44) }))
        .transact()
        .await?;
    fails_with(&out, "Borrower is blocked");

    // Identity release, Dev mode: anyone requests, dev_scorer submits the re-encrypted name.
    assert!(env.pool.view("is_release_allowed").args_json(json!({ "account_id": max.id() })).await?.json::<bool>()?);
    env.alice.call(env.pool.id(), "request_identity_release").args_json(json!({ "borrower": max.id() })).transact().await?.into_result()?;
    let out = env.scorer
        .call(env.pool.id(), "dev_submit_release")
        .args_json(json!({ "borrower": max.id(), "output": { "v": 1, "released": "bmFtZS10by1wYXJ0bmVy" } }))
        .transact()
        .await?;
    assert_eq!(events(&out)[0]["event"], "identity_released");
    let b = borrower(&env, &max).await?;
    assert_eq!(b["released_identity"], "bmFtZS10by1wYXJ0bmVy");
    assert!(!b.to_string().contains("sealed"), "rule 9");
    assert!(!env.pool.view("is_release_allowed").args_json(json!({ "account_id": max.id() })).await?.json::<bool>()?);
    fails_with(
        &env.alice.call(env.pool.id(), "request_identity_release").args_json(json!({ "borrower": max.id() })).transact().await?,
        "only allowed once",
    );

    let stats: Value = env.pool.view("get_stats").await?.json()?;
    assert_eq!(stats["A"]["defaulted"], 1);
    Ok(())
}

/// A default the reserve can't fully cover lowers the share price by the uncovered part.
#[tokio::test]
async fn default_beyond_reserve_hits_lenders() -> anyhow::Result<()> {
    let env = demo_env().await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 1_000 * USDC, "deposit").await?.into_result()?;
    transfer_call(&env.owner, &env.usdc, env.pool.id(), 30 * USDC, "seed_reserve").await?.into_result()?;
    let max = new_user(&env, "max", 0).await?;
    score(&env, &max, "A", 1000, 0x33).await?;
    borrow(&env, &max, 100 * USDC).await?.into_result()?;
    let due_at: u64 = borrower(&env, &max).await?["loan"]["due_at"].as_str().unwrap().parse()?;
    advance_past(&env, due_at + GRACE_NS).await?;
    env.bob.call(env.pool.id(), "mark_default").args_json(json!({ "borrower": max.id() })).transact().await?.into_result()?;

    let p = pool_state(&env.pool).await?;
    assert_eq!((p.reserve, p.pool_value), (0, 930 * USDC));
    assert_eq!(lender(&env.pool, env.alice.id()).await?.1, 930 * USDC);
    assert_books_balance(&env).await?;
    Ok(())
}

// ------------------------------------------------------------------ rules 7, 11, 12, 13

/// Rules 7 and 11: a borrower not registered with USDC can't receive the loan; the callback
/// undoes the loan exactly. After registering, the same borrow works.
#[tokio::test]
async fn rule7_unregistered_borrower_loan_rolled_back() -> anyhow::Result<()> {
    let env = funded_env().await?;
    let riya = sub(&env.worker, "riya").await?; // not registered with mock USDC
    score(&env, &riya, "A", 1000, 0x11).await?;
    let before = pool_state(&env.pool).await?;
    let stats_before: Value = env.pool.view("get_stats").await?.json()?;

    let out = borrow(&env, &riya, 100 * USDC).await?;
    assert!(out.is_success(), "callback handles it: {out:?}");
    assert!(!out.clone().json::<bool>()?);
    assert!(!out.receipt_failures().is_empty(), "the ft_transfer really failed");
    assert!(events(&out).is_empty(), "no loan_issued event");

    assert_eq!(pool_state(&env.pool).await?, before);
    let b = borrower(&env, &riya).await?;
    assert_eq!(b["loan"], Value::Null);
    assert_eq!(b["has_active_loan"], false);
    let stats: Value = env.pool.view("get_stats").await?.json()?;
    assert_eq!(stats, stats_before);
    assert_books_balance(&env).await?;

    register(&riya, &env.usdc, riya.id()).await?;
    assert!(borrow(&env, &riya, 100 * USDC).await?.json::<bool>()?);
    assert_eq!(balance(&env.usdc, riya.id()).await?, 100 * USDC);
    Ok(())
}

/// Rule 12: one borrower can never exceed 10% of pool value.
#[tokio::test]
async fn rule12_ten_percent_cap() -> anyhow::Result<()> {
    let env = demo_env().await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 500 * USDC, "deposit").await?.into_result()?;
    let riya = new_user(&env, "riya", 0).await?;
    score(&env, &riya, "A", 1000, 0x11).await?;
    assert_eq!(limit(&env, &riya).await?, 100 * USDC, "limit alone would allow $100");
    fails_with(&borrow(&env, &riya, 50 * USDC + 1).await?, "above 10% of pool value");
    assert!(borrow(&env, &riya, 50 * USDC).await?.json::<bool>()?);
    Ok(())
}

/// Rule 13 (early repay) on chain: repaying right away does not level up.
/// The minimum-hold, size and once-per-term boundaries are unit-tested with exact time.
#[tokio::test]
async fn rule13_early_repay_no_level_up() -> anyhow::Result<()> {
    let env = funded_env().await?;
    let riya = new_user(&env, "riya", 10).await?;
    score(&env, &riya, "A", 1000, 0x11).await?;
    borrow(&env, &riya, 100 * USDC).await?.into_result()?;
    let out = transfer_call(&riya, &env.usdc, env.pool.id(), 102 * USDC, "repay").await?;
    assert_eq!(events(&out)[0]["data"][0]["leveled_up"], false);
    assert_eq!(borrower(&env, &riya).await?["level"], 1);
    assert_eq!(limit(&env, &riya).await?, 100 * USDC);
    Ok(())
}

/// Repay must be exact; anything else is refunded and the loan stays active.
#[tokio::test]
async fn wrong_repay_amount_refunded() -> anyhow::Result<()> {
    let env = funded_env().await?;
    let riya = new_user(&env, "riya", 10).await?;
    score(&env, &riya, "A", 1000, 0x11).await?;
    borrow(&env, &riya, 100 * USDC).await?.into_result()?;
    for amount in [100 * USDC, 101 * USDC, 103 * USDC] {
        let out = transfer_call(&riya, &env.usdc, env.pool.id(), amount, "repay").await?;
        assert_eq!(out.clone().json::<String>()?, "0", "refunded {amount}");
        assert!(format!("{:?}", out.failures()).contains("Repay exactly 102000000"));
    }
    assert_eq!(balance(&env.usdc, riya.id()).await?, 110 * USDC);
    assert_eq!(borrower(&env, &riya).await?["loan"]["state"], "Active");
    // Someone without a loan can't "repay" either.
    let out = transfer_call(&env.bob, &env.usdc, env.pool.id(), 102 * USDC, "repay").await?;
    assert_eq!(out.clone().json::<String>()?, "0");
    assert_books_balance(&env).await?;
    Ok(())
}

/// Rule 1/7: the rollback and release callbacks are private.
#[tokio::test]
async fn loan_callbacks_are_private() -> anyhow::Result<()> {
    let env = funded_env().await?;
    let out = env.alice
        .call(env.pool.id(), "on_borrow_transfer")
        .args_json(json!({ "borrower": env.alice.id(), "amount": "1", "prev": null }))
        .transact()
        .await?;
    fails_with(&out, "on_borrow_transfer is private");
    let out = env.alice
        .call(env.pool.id(), "on_release")
        .args_json(json!({ "borrower": env.alice.id() }))
        .transact()
        .await?;
    fails_with(&out, "on_release is private");
    Ok(())
}

/// OutLayer mode release through the mock: request -> request_execution(op release) -> on_release.
#[tokio::test]
async fn outlayer_mode_identity_release() -> anyhow::Result<()> {
    let env = setup_with(|c| {
        c["scorer_mode"] = json!("OutLayer");
        c["dev_scorer"] = Value::Null;
        c["loan_term_ns"] = json!(TERM_NS.to_string());
        c["grace_ns"] = json!(GRACE_NS.to_string());
    })
    .await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 1_000 * USDC, "deposit").await?.into_result()?;
    let max = new_user(&env, "max", 0).await?;

    let set_mock = |response: Value| {
        let env = &env;
        async move {
            env.owner
                .call(env.outlayer.id(), "set_response")
                .args_json(json!({ "response": response, "fail": false }))
                .transact()
                .await?
                .into_result()?;
            anyhow::Ok(())
        }
    };
    set_mock(output("$SIGNER", "A", 1000, 0x33)).await?;
    let out = max
        .call(env.pool.id(), "request_score")
        .args_json(json!({ "public_token": "public-sandbox-1", "reply_pubkey": "aa".repeat(32) }))
        .deposit(NearToken::from_millinear(10))
        .gas(Gas::from_tgas(200))
        .transact()
        .await?;
    assert!(out.json::<bool>()?);
    borrow(&env, &max, 100 * USDC).await?.into_result()?;
    let due_at: u64 = borrower(&env, &max).await?["loan"]["due_at"].as_str().unwrap().parse()?;
    advance_past(&env, due_at + GRACE_NS).await?;
    env.bob.call(env.pool.id(), "mark_default").args_json(json!({ "borrower": max.id() })).transact().await?.into_result()?;

    set_mock(json!({ "v": 1, "released": "bmFtZS10by1wYXJ0bmVy" })).await?;
    let out = env.alice
        .call(env.pool.id(), "request_identity_release")
        .args_json(json!({ "borrower": max.id() }))
        .deposit(NearToken::from_millinear(10))
        .gas(Gas::from_tgas(200))
        .transact()
        .await?;
    assert!(out.is_success(), "{out:?}");
    assert_eq!(events(&out)[0]["event"], "identity_released");

    let req: Value = env.outlayer.view("get_last_request").await?.json()?;
    let input: Value = serde_json::from_str(req["input_data"].as_str().unwrap())?;
    assert_eq!(input["op"], "release");
    assert_eq!(input["sealed"], "c2VhbGVkLW5hbWU=");
    assert_eq!(input["partner_pubkey"], PARTNER_PUBKEY);
    assert_eq!(req["source"]["Project"]["version_key"], SCORER_VERSION);
    assert_eq!(req["payer_account_id"], env.alice.id().as_str());
    assert_eq!(borrower(&env, &max).await?["released_identity"], "bmFtZS10by1wYXJ0bmVy");

    // dev_submit_release is off in OutLayer mode.
    let out = env.owner
        .call(env.pool.id(), "dev_submit_release")
        .args_json(json!({ "borrower": max.id(), "output": { "v": 1, "released": "AA==" } }))
        .transact()
        .await?;
    fails_with(&out, "disabled in OutLayer mode");
    Ok(())
}
