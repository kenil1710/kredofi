//! Day 2: scores on a real sandbox. One test (or more) per security rule 1-6 (SPEC 7).
//! OutLayer-mode tests use the mock OutLayer in `tests/mock-outlayer`, so the full
//! request_score -> request_execution -> on_score path runs as real cross-contract calls.

mod common;

use common::*;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId};
use serde_json::{Value, json};

const REPLY_KEY: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SEALED_B64: &str = "c2VhbGVkLW5hbWUtY2lwaGVydGV4dA==";

fn fp(byte: u8) -> String {
    format!("{byte:02x}").repeat(32)
}

fn output(caller: &str, band: &str, score: u64, cap_usd: u64, fp_byte: u8) -> Value {
    json!({
        "v": 1,
        "caller": caller,
        "band": band,
        "score": score,
        "income_cap": cap_usd * 1_000_000,
        "fingerprint": fp(fp_byte),
        "sealed_identity": SEALED_B64,
    })
}

async fn dev_submit(from: &Account, env: &Env, borrower: &AccountId, out: Value) -> anyhow::Result<ExecutionFinalResult> {
    Ok(from
        .call(env.pool.id(), "dev_submit_score")
        .args_json(json!({ "borrower": borrower, "output": out }))
        .transact()
        .await?)
}

async fn request_score(from: &Account, env: &Env) -> anyhow::Result<ExecutionFinalResult> {
    Ok(from
        .call(env.pool.id(), "request_score")
        .args_json(json!({ "public_token": "public-sandbox-123", "reply_pubkey": REPLY_KEY }))
        .deposit(NearToken::from_millinear(10))
        .gas(Gas::from_tgas(200))
        .transact()
        .await?)
}

async fn set_mock(env: &Env, response: Option<Value>, fail: bool) -> anyhow::Result<()> {
    env.owner
        .call(env.outlayer.id(), "set_response")
        .args_json(json!({ "response": response, "fail": fail }))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

async fn borrower(env: &Env, id: &AccountId) -> anyhow::Result<Value> {
    Ok(env.pool.view("get_borrower").args_json(json!({ "account_id": id })).await?.json()?)
}

async fn limit(env: &Env, id: &AccountId) -> anyhow::Result<u128> {
    let v: String = env.pool.view("get_limit").args_json(json!({ "account_id": id })).await?.json()?;
    Ok(v.parse()?)
}

fn failure_text(out: &ExecutionFinalResult) -> String {
    format!("{:?}", out.failures())
}

fn event_names(out: &ExecutionFinalResult) -> Vec<String> {
    events(out).iter().map(|e| e["event"].as_str().unwrap().to_string()).collect()
}

// ------------------------------------------------------------------ happy paths

#[tokio::test]
async fn dev_mode_score_riya_sam() -> anyhow::Result<()> {
    let env = setup().await?;
    let riya = env.alice.id();
    let sam = env.bob.id();

    let out = dev_submit(&env.scorer, &env, riya, output(riya.as_str(), "A", 1000, 1000, 0x11)).await?;
    assert!(out.is_success(), "{out:?}");
    let ev = events(&out);
    assert_eq!(ev[0]["event"], "score_issued");
    assert_eq!(ev[0]["data"][0]["band"], "A");
    assert_eq!(ev[0]["data"][0]["scorer_version"], SCORER_VERSION);

    dev_submit(&env.scorer, &env, sam, output(sam.as_str(), "D", 270, 400, 0x22)).await?.into_result()?;

    // SPEC 6 table: Riya A -> $100 at level 1; Sam D -> $0.
    assert_eq!(limit(&env, riya).await?, 100 * USDC);
    assert_eq!(limit(&env, sam).await?, 0);
    let b = borrower(&env, riya).await?;
    assert_eq!(b["level"], 1);
    assert_eq!(b["score"]["score"], 1000);
    assert_eq!(b["score"]["expired"], false);

    // Rule 9 (early check): the view has no sealed identity.
    let text = b.to_string();
    assert!(!text.contains("sealed") && !text.contains(SEALED_B64), "{text}");

    let stats: Value = env.pool.view("get_stats").await?.json()?;
    assert_eq!(stats["A"]["scored"], 1);
    assert_eq!(stats["D"]["scored"], 1);
    Ok(())
}

#[tokio::test]
async fn outlayer_mode_full_round_trip() -> anyhow::Result<()> {
    let env = setup_outlayer().await?;
    // Includes the optional `reply` field (SPEC 5).
    let mut response = output("$SIGNER", "A", 1000, 1000, 0x11);
    response["reply"] = json!("ZW5jcnlwdGVkLWFpLXN1bW1hcnk=");
    set_mock(&env, Some(response), false).await?;

    let out = request_score(&env.alice, &env).await?;
    assert!(out.is_success(), "{out:?}");
    assert!(out.clone().json::<bool>()?, "on_score accepted");

    // Unused OutLayer deposit goes straight to the borrower.
    let req: Value = env.outlayer.view("get_last_request").await?.json()?;
    assert_eq!(req["payer_account_id"], env.alice.id().as_str());
    assert_eq!(event_names(&out), vec!["score_issued"]);

    let b = borrower(&env, env.alice.id()).await?;
    assert_eq!(b["pending_request"], false);
    assert_eq!(b["score"]["band"], "A");
    assert_eq!(limit(&env, env.alice.id()).await?, 100 * USDC);
    Ok(())
}

// ------------------------------------------------------------------ rule 1

/// Rule 1: scores only arrive via the private callback (or dev_scorer in Dev mode).
#[tokio::test]
async fn rule1_on_score_is_private_and_dev_submit_is_restricted() -> anyhow::Result<()> {
    let env = setup().await?;
    let riya = env.alice.id();
    let fake = output(riya.as_str(), "A", 1000, 1000, 0x11);

    // Calling the callback directly, as the borrower or the owner: rejected.
    for who in [&env.alice, &env.owner] {
        let out = who
            .call(env.pool.id(), "on_score")
            .args_json(json!({ "borrower": riya }))
            .transact()
            .await?;
        assert!(out.is_failure());
        assert!(failure_text(&out).contains("on_score is private"), "{}", failure_text(&out));
    }

    // dev_submit_score from anyone but dev_scorer: rejected.
    for who in [&env.alice, &env.owner] {
        let out = dev_submit(who, &env, riya, fake.clone()).await?;
        assert!(failure_text(&out).contains("Only the dev_scorer can submit scores"));
    }
    assert_eq!(borrower(&env, riya).await?, Value::Null, "nothing stored");
    Ok(())
}

/// Rule 1 / SPEC 8 step 4: in OutLayer mode dev_submit_score always fails, even for dev_scorer.
#[tokio::test]
async fn rule1_dev_submit_rejected_in_outlayer_mode() -> anyhow::Result<()> {
    let env = setup_with(|c| c["scorer_mode"] = json!("OutLayer")).await?;
    let out = dev_submit(&env.scorer, &env, env.alice.id(), output(env.alice.id().as_str(), "A", 1000, 1000, 0x11)).await?;
    assert!(failure_text(&out).contains("dev_submit_score is disabled in OutLayer mode"));
    assert_eq!(borrower(&env, env.alice.id()).await?, Value::Null);
    Ok(())
}

// ------------------------------------------------------------------ rule 2

/// Rule 2: every request pins scorer_version; changing it is an owner action with an event.
#[tokio::test]
async fn rule2_request_pins_version_and_change_is_public() -> anyhow::Result<()> {
    let env = setup_outlayer().await?;
    set_mock(&env, None, false).await?;
    request_score(&env.alice, &env).await?.into_result()?;

    let req: Value = env.outlayer.view("get_last_request").await?.json()?;
    assert_eq!(req["source"]["Project"]["version_key"], SCORER_VERSION);
    assert_eq!(req["source"]["Project"]["project_id"], "owner/kredofi-scorer");
    assert_eq!(req["secrets_ref"]["profile"], "kredofi");
    assert_eq!(req["secrets_ref"]["account_id"], env.owner.id().as_str());
    assert_eq!(req["response_format"], "Json");
    assert_eq!(req["resource_limits"]["max_execution_seconds"], 30);
    assert_eq!(req["deposit"], NearToken::from_millinear(10).as_yoctonear().to_string());
    assert_eq!(req["predecessor"], env.pool.id().as_str());
    assert_eq!(req["signer"], env.alice.id().as_str(), "NEAR_SENDER_ID would be the borrower");
    assert_eq!(req["payer_account_id"], env.alice.id().as_str(), "refund goes to the borrower");
    let input: Value = serde_json::from_str(req["input_data"].as_str().unwrap())?;
    assert_eq!(input, json!({ "op": "score", "public_token": "public-sandbox-123", "reply_pubkey": REPLY_KEY }));

    // Non-owner cannot change the version.
    let new_v = "ab".repeat(32);
    let out = env.alice
        .call(env.pool.id(), "set_scorer_version")
        .args_json(json!({ "version": new_v }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(failure_text(&out).contains("Only the owner can change the scorer version"));

    // Owner can, publicly.
    let out = env.owner
        .call(env.pool.id(), "set_scorer_version")
        .args_json(json!({ "version": new_v }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    let ev = events(&out);
    assert_eq!(ev[0]["event"], "scorer_version_changed");
    assert_eq!(ev[0]["data"][0]["old"], SCORER_VERSION);
    assert_eq!(ev[0]["data"][0]["new"], new_v);

    // The next request pins the new version.
    request_score(&env.bob, &env).await?.into_result()?;
    let req: Value = env.outlayer.view("get_last_request").await?.json()?;
    assert_eq!(req["source"]["Project"]["version_key"], new_v);
    Ok(())
}

// ------------------------------------------------------------------ rule 3

/// Rule 3a: request_score through another contract (signer != predecessor) is rejected,
/// so OutLayer's NEAR_SENDER_ID is always the borrower.
#[tokio::test]
async fn rule3_request_through_a_contract_rejected() -> anyhow::Result<()> {
    let env = setup_outlayer().await?;
    set_mock(&env, Some(output("$SIGNER", "A", 1000, 1000, 0x11)), false).await?;

    let out = env.alice
        .call(env.outlayer.id(), "proxy_request_score")
        .args_json(json!({ "pool": env.pool.id(), "public_token": "public-sandbox-123", "reply_pubkey": REPLY_KEY }))
        .deposit(NearToken::from_millinear(10))
        .gas(Gas::from_tgas(250))
        .transact()
        .await?;
    assert!(failure_text(&out).contains("must be signed by the borrower directly"), "{out:?}");
    assert_eq!(borrower(&env, env.alice.id()).await?, Value::Null);
    assert_eq!(borrower(&env, env.outlayer.id()).await?, Value::Null);
    let n: u32 = env.outlayer.view("get_requests").await?.json()?;
    assert_eq!(n, 0, "OutLayer was never called");
    Ok(())
}

/// Rule 3b: on_score requires output.caller == borrower.
#[tokio::test]
async fn rule3_output_for_another_caller_rejected() -> anyhow::Result<()> {
    let env = setup_outlayer().await?;
    set_mock(&env, Some(output(env.bob.id().as_str(), "A", 1000, 1000, 0x11)), false).await?;

    let out = request_score(&env.alice, &env).await?;
    assert!(out.is_success());
    assert!(!out.clone().json::<bool>()?);
    let ev = events(&out);
    assert_eq!(ev[0]["event"], "score_failed");
    assert!(ev[0]["data"][0]["reason"].as_str().unwrap().contains("is not the borrower"));

    for id in [env.alice.id(), env.bob.id()] {
        let b = borrower(&env, id).await?;
        assert!(b.is_null() || b["score"].is_null(), "no score for {id}: {b}");
    }
    assert_eq!(borrower(&env, env.alice.id()).await?["pending_request"], false);
    Ok(())
}

// ------------------------------------------------------------------ rule 4

/// Rule 4: a null or failed OutLayer result only clears pending_request.
#[tokio::test]
async fn rule4_null_or_failed_result_changes_nothing_else() -> anyhow::Result<()> {
    let env = setup_outlayer().await?;
    let stats_before: Value = env.pool.view("get_stats").await?.json()?;

    // (mock response, mock panics?)
    for (response, fail) in [(None, false), (None, true), (Some(json!({ "success": false, "error": "timeout" })), false)] {
        set_mock(&env, response, fail).await?;
        let out = request_score(&env.alice, &env).await?;
        assert!(out.is_success(), "callback must not panic: {out:?}");
        assert!(!out.clone().json::<bool>()?);
        assert_eq!(event_names(&out), vec!["score_failed"]);

        let b = borrower(&env, env.alice.id()).await?;
        assert_eq!(b["pending_request"], false);
        assert_eq!(b["score"], Value::Null);
        assert_eq!(b["level"], 1);
        assert_eq!(b["blocked"], false);
        let stats: Value = env.pool.view("get_stats").await?.json()?;
        assert_eq!(stats, stats_before);
    }

    // After failures the borrower can still be scored.
    set_mock(&env, Some(output("$SIGNER", "A", 1000, 1000, 0x11)), false).await?;
    assert!(request_score(&env.alice, &env).await?.json::<bool>()?);
    assert_eq!(limit(&env, env.alice.id()).await?, 100 * USDC);
    Ok(())
}

// ------------------------------------------------------------------ rule 5

/// Rule 5: scores expire after score_ttl_ns.
#[tokio::test]
async fn rule5_score_expires() -> anyhow::Result<()> {
    // 60-second TTL (the minimum) so the sandbox can pass it quickly.
    let env = setup_with(|c| c["score_ttl_ns"] = json!("60000000000")).await?;
    let riya = env.alice.id();
    dev_submit(&env.scorer, &env, riya, output(riya.as_str(), "A", 1000, 1000, 0x11)).await?.into_result()?;
    assert_eq!(limit(&env, riya).await?, 100 * USDC);
    assert_eq!(borrower(&env, riya).await?["score"]["expired"], false);

    let expires_at: u64 = borrower(&env, riya).await?["score"]["expires_at"].as_str().unwrap().parse()?;
    // Advance until the chain time passes expires_at.
    for _ in 0..20 {
        env.worker.fast_forward(100).await?;
        let now = env.worker.view_block().await?.timestamp();
        if now > expires_at {
            break;
        }
    }
    assert!(env.worker.view_block().await?.timestamp() > expires_at, "sandbox time did not advance");

    assert_eq!(limit(&env, riya).await?, 0);
    let b = borrower(&env, riya).await?;
    assert_eq!(b["score"]["expired"], true);
    assert_eq!(b["limit"], "0");
    Ok(())
}

// ------------------------------------------------------------------ rule 6

/// Rule 6: one fingerprint (bank identity), one borrower - in both modes.
#[tokio::test]
async fn rule6_one_fingerprint_one_borrower_dev() -> anyhow::Result<()> {
    let env = setup().await?;
    let (riya, max) = (env.alice.id(), env.bob.id());
    dev_submit(&env.scorer, &env, riya, output(riya.as_str(), "A", 1000, 1000, 0x11)).await?.into_result()?;

    let out = dev_submit(&env.scorer, &env, max, output(max.as_str(), "A", 1000, 1000, 0x11)).await?;
    assert!(failure_text(&out).contains("already used by another borrower"));
    assert_eq!(borrower(&env, max).await?, Value::Null);

    // The owner of the fingerprint can re-score with it.
    dev_submit(&env.scorer, &env, riya, output(riya.as_str(), "B", 700, 1000, 0x11)).await?.into_result()?;
    assert_eq!(borrower(&env, riya).await?["score"]["band"], "B");
    Ok(())
}

#[tokio::test]
async fn rule6_one_fingerprint_one_borrower_outlayer() -> anyhow::Result<()> {
    let env = setup_outlayer().await?;
    set_mock(&env, Some(output("$SIGNER", "A", 1000, 1000, 0x11)), false).await?;
    assert!(request_score(&env.alice, &env).await?.json::<bool>()?);

    let out = request_score(&env.bob, &env).await?;
    assert!(out.is_success());
    assert!(!out.clone().json::<bool>()?);
    assert!(events(&out)[0]["data"][0]["reason"].as_str().unwrap().contains("already used by another borrower"));
    let b = borrower(&env, env.bob.id()).await?;
    assert_eq!(b["score"], Value::Null);
    assert_eq!(b["pending_request"], false);
    Ok(())
}
