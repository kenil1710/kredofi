//! SPEC 8e: the partner vault against the real KredoFi wasm. KredoFi is deployed unchanged and is
//! never told about the vault: the only link is a public view call.

mod common;

use common::*;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::{Value, json};

const TERM_NS: u64 = 120_000_000_000;
const GRACE_NS: u64 = 60_000_000_000;
const COLLATERAL: u128 = 110 * USDC;

async fn deploy_vault(env: &Env, name: &str, kredofi: &near_workspaces::AccountId) -> anyhow::Result<Contract> {
    let vault = sub(&env.worker, name).await?.deploy(&wasm().partner_vault).await?.into_result()?;
    vault.call("new").args_json(json!({ "kredofi": kredofi, "usdc": env.usdc.id() })).transact().await?.into_result()?;
    register(&env.minter, &env.usdc, vault.id()).await?;
    Ok(vault)
}

async fn vault_env(tweak: impl FnOnce(&mut Value)) -> anyhow::Result<(Env, Contract)> {
    let env = setup_with(tweak).await?;
    let vault = deploy_vault(&env, "vault", env.pool.id()).await?;
    Ok((env, vault))
}

async fn score(env: &Env, who: &Account, band: &str, points: u64, fp: u8) -> anyhow::Result<()> {
    env.scorer
        .call(env.pool.id(), "dev_submit_score")
        .args_json(json!({ "borrower": who.id(), "output": {
            "v": 1, "caller": who.id(), "band": band, "score": points, "income_cap": 1_000_000_000u64,
            "fingerprint": format!("{fp:02x}").repeat(32), "sealed_identity": "c2VhbGVk" } }))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

async fn position(vault: &Contract, who: &Account) -> anyhow::Result<Value> {
    Ok(vault.view("get_position").args_json(json!({ "account_id": who.id() })).await?.json()?)
}

fn vault_events(out: &ExecutionFinalResult) -> Vec<Value> {
    out.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|j| serde_json::from_str::<Value>(j).ok())
        .filter(|e| e["standard"] == "kredofi_partner_vault")
        .collect()
}

/// Opens with $110, checks the position and that the token moved.
async fn assert_opens(env: &Env, vault: &Contract, who: &Account, ratio: u64, basis: &str, credit: u128) -> anyhow::Result<()> {
    let before = balance(&env.usdc, who.id()).await?;
    let vault_before = balance(&env.usdc, vault.id()).await?;
    let out = transfer_call(who, &env.usdc, vault.id(), COLLATERAL, "open").await?;
    assert_eq!(out.clone().json::<String>()?, COLLATERAL.to_string(), "{out:?}");
    let p = position(vault, who).await?;
    assert_eq!(p["ratio_bps"], ratio, "{p}");
    assert_eq!(p["basis"], basis, "{p}");
    assert_eq!(p["collateral"], COLLATERAL.to_string());
    assert_eq!(p["credit"], credit.to_string());
    assert_eq!(balance(&env.usdc, who.id()).await?, before - COLLATERAL);
    assert_eq!(balance(&env.usdc, vault.id()).await?, vault_before + COLLATERAL);
    let ev = vault_events(&out);
    assert_eq!(ev[0]["event"], "position_opened");
    assert_eq!(ev[0]["data"][0]["basis"], basis);
    Ok(())
}

/// Refunded in full: balances unchanged, no position.
async fn assert_refunded(env: &Env, vault: &Contract, who: &Account, msg: &str, amount: u128) -> anyhow::Result<ExecutionFinalResult> {
    let before = balance(&env.usdc, who.id()).await?;
    let vault_before = balance(&env.usdc, vault.id()).await?;
    let out = transfer_call(who, &env.usdc, vault.id(), amount, msg).await?;
    assert_eq!(out.clone().json::<String>()?, "0", "{out:?}");
    assert_eq!(balance(&env.usdc, who.id()).await?, before);
    assert_eq!(balance(&env.usdc, vault.id()).await?, vault_before);
    Ok(out)
}

#[tokio::test]
async fn band_sets_terms_on_the_real_kredofi_wasm() -> anyhow::Result<()> {
    let (env, vault) = vault_env(|_| {}).await?;
    for (name, band, points, fp, ratio, credit) in [
        ("riya", "A", 1000, 0x11, 11_000u64, 100_000_000u128),
        ("bea", "B", 720, 0x12, 12_500, 88_000_000),
        ("cam", "C", 550, 0x13, 14_000, 78_571_428),
        ("sam", "D", 270, 0x14, 15_000, 73_333_333),
    ] {
        let who = new_user(&env, name, 200).await?;
        score(&env, &who, band, points, fp).await?;
        assert_opens(&env, &vault, &who, ratio, band, credit).await?;
    }
    let stats: Value = vault.view("get_stats").await?.json()?;
    assert_eq!(stats["open_positions"], 4);
    assert_eq!(stats["total_collateral"], (4 * COLLATERAL).to_string());
    assert_eq!(balance(&env.usdc, vault.id()).await?, 4 * COLLATERAL);
    Ok(())
}

#[tokio::test]
async fn no_score_gets_standard_terms() -> anyhow::Result<()> {
    let (env, vault) = vault_env(|_| {}).await?;
    let who = new_user(&env, "newcomer", 200).await?;
    assert_opens(&env, &vault, &who, 15_000, "no_score", 73_333_333).await
}

#[tokio::test]
async fn expired_band_a_gets_standard_terms() -> anyhow::Result<()> {
    let (env, vault) = vault_env(|c| c["score_ttl_ns"] = json!("60000000000")).await?;
    let who = new_user(&env, "riya", 200).await?;
    score(&env, &who, "A", 1000, 0x11).await?;
    let b: Value = env.pool.view("get_borrower").args_json(json!({ "account_id": who.id() })).await?.json()?;
    let expires: u64 = b["score"]["expires_at"].as_str().unwrap().parse()?;
    advance_past(&env, expires).await?;
    assert_opens(&env, &vault, &who, 15_000, "expired", 73_333_333).await
}

#[tokio::test]
async fn defaulted_band_a_gets_standard_terms() -> anyhow::Result<()> {
    let (env, vault) = vault_env(|c| {
        c["loan_term_ns"] = json!(TERM_NS.to_string());
        c["grace_ns"] = json!(GRACE_NS.to_string());
    })
    .await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 1_000 * USDC, "deposit").await?.into_result()?;
    transfer_call(&env.owner, &env.usdc, env.pool.id(), 300 * USDC, "seed_reserve").await?.into_result()?;
    let max = new_user(&env, "max", 200).await?;
    score(&env, &max, "A", 1000, 0x33).await?;
    max.call(env.pool.id(), "borrow")
        .args_json(json!({ "amount": (100 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(60))
        .transact()
        .await?
        .into_result()?;
    let b: Value = env.pool.view("get_borrower").args_json(json!({ "account_id": max.id() })).await?.json()?;
    let due: u64 = b["loan"]["due_at"].as_str().unwrap().parse()?;
    advance_past(&env, due + GRACE_NS).await?;
    env.bob.call(env.pool.id(), "mark_default").args_json(json!({ "borrower": max.id() })).transact().await?.into_result()?;
    assert_opens(&env, &vault, &max, 15_000, "blocked", 73_333_333).await
}

/// KredoFi unreachable: the sender keeps everything and no position opens.
#[tokio::test]
async fn failed_read_refunds_in_full() -> anyhow::Result<()> {
    let env = setup().await?;
    // An account with no contract, and a contract without get_borrower: both make the read fail.
    let empty = sub(&env.worker, "empty").await?;
    for (name, target) in [("vault1", empty.id().clone()), ("vault2", env.usdc.id().clone())] {
        let vault = deploy_vault(&env, name, &target).await?;
        let out = assert_refunded(&env, &vault, &env.alice, "open", COLLATERAL).await?;
        assert_eq!(vault_events(&out)[0]["event"], "position_refused");
        assert_eq!(vault_events(&out)[0]["data"][0]["reason"], "kredofi_read_failed");
        assert!(position(&vault, &env.alice).await?.is_null());
    }
    Ok(())
}

#[tokio::test]
async fn wrong_token_message_or_size_is_refunded() -> anyhow::Result<()> {
    let (env, vault) = vault_env(|_| {}).await?;
    // Another token, with its own vault registration.
    let fake = deploy_token(&env.worker, "fake", &env.minter).await?;
    for id in [env.alice.id(), vault.id()] {
        register(&env.minter, &fake, id).await?;
    }
    mint(&env.minter, &fake, env.alice.id(), 500 * USDC).await?;
    let out = transfer_call(&env.alice, &fake, vault.id(), COLLATERAL, "open").await?;
    assert_eq!(out.clone().json::<String>()?, "0", "{out:?}");
    assert_eq!(balance(&fake, env.alice.id()).await?, 500 * USDC);
    assert_eq!(balance(&fake, vault.id()).await?, 0);

    let _ = assert_refunded(&env, &vault, &env.alice, "repay", COLLATERAL).await?;
    let _ = assert_refunded(&env, &vault, &env.alice, "", COLLATERAL).await?;
    let _ = assert_refunded(&env, &vault, &env.alice, "open", USDC - 1).await?;
    assert!(position(&vault, &env.alice).await?.is_null());
    Ok(())
}

/// However little gas the sender attaches, the collateral either backs a position or comes back.
#[tokio::test]
async fn low_gas_never_loses_collateral() -> anyhow::Result<()> {
    let (env, vault) = vault_env(|_| {}).await?;
    let start = balance(&env.usdc, env.alice.id()).await?;
    let mut refused = 0;
    for tgas in [36, 38, 40, 42, 45, 50] {
        let out = env.alice
            .call(env.usdc.id(), "ft_transfer_call")
            .args_json(json!({ "receiver_id": vault.id(), "amount": COLLATERAL.to_string(), "msg": "open" }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(tgas))
            .transact()
            .await?;
        let held = balance(&env.usdc, vault.id()).await?;
        let p = position(&vault, &env.alice).await?;
        println!("{tgas} Tgas: position {}, vault holds {held}", !p.is_null());
        assert_eq!(balance(&env.usdc, env.alice.id()).await? + held, start, "{tgas} Tgas: {out:?}");
        if p.is_null() {
            assert_eq!(held, 0, "{tgas} Tgas: collateral held without a position");
            refused += 1;
        } else {
            assert_eq!(held, COLLATERAL);
            assert!(close(&env.alice, &vault).await?.json::<bool>()?);
        }
    }
    println!("refused or refunded at {refused} of 6 gas levels");
    Ok(())
}

/// 100 Tgas is what /integrate attaches and the relayer's ceiling.
#[tokio::test]
async fn opening_and_closing_fit_the_gas_the_page_attaches() -> anyhow::Result<()> {
    let (env, vault) = vault_env(|_| {}).await?;
    let who = &env.alice;
    score(&env, who, "A", 1000, 0x11).await?;
    let out = transfer_call(who, &env.usdc, vault.id(), COLLATERAL, "open").await?;
    println!("open: {:.1} Tgas burnt", out.total_gas_burnt.as_gas() as f64 / 1e12);
    assert_eq!(out.json::<String>()?, COLLATERAL.to_string());
    let out = close(who, &vault).await?;
    println!("close: {:.1} Tgas burnt", out.total_gas_burnt.as_gas() as f64 / 1e12);
    assert!(out.json::<bool>()?);
    Ok(())
}

async fn close(who: &Account, vault: &Contract) -> anyhow::Result<ExecutionFinalResult> {
    Ok(who
        .call(vault.id(), "close_position")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?)
}

#[tokio::test]
async fn second_position_is_refunded_and_close_returns_collateral() -> anyhow::Result<()> {
    let (env, vault) = vault_env(|_| {}).await?;
    let start = balance(&env.usdc, env.alice.id()).await?;
    assert_opens(&env, &vault, &env.alice, 15_000, "no_score", 73_333_333).await?;
    let _ = assert_refunded(&env, &vault, &env.alice, "open", COLLATERAL).await?;

    // Someone else can't close it.
    assert!(close(&env.bob, &vault).await?.is_failure());
    assert_eq!(balance(&env.usdc, vault.id()).await?, COLLATERAL);

    let out = close(&env.alice, &vault).await?;
    assert!(out.clone().json::<bool>()?, "{out:?}");
    assert_eq!(vault_events(&out)[0]["event"], "position_closed");
    assert!(position(&vault, &env.alice).await?.is_null());
    assert_eq!(balance(&env.usdc, env.alice.id()).await?, start);
    assert_eq!(balance(&env.usdc, vault.id()).await?, 0);
    let stats: Value = vault.view("get_stats").await?.json()?;
    assert_eq!((stats["open_positions"].as_u64(), stats["total_collateral"].as_str()), (Some(0), Some("0")));

    // Terms are read again for the next position.
    score(&env, &env.alice, "A", 1000, 0x11).await?;
    assert_opens(&env, &vault, &env.alice, 11_000, "A", 100_000_000).await
}

/// The token refuses the payout (account unregistered): the position survives and can close later.
#[tokio::test]
async fn failed_close_transfer_keeps_the_position() -> anyhow::Result<()> {
    let (env, vault) = vault_env(|_| {}).await?;
    let who = new_user(&env, "leaver", 110).await?;
    assert_opens(&env, &vault, &who, 15_000, "no_score", 73_333_333).await?;
    who.call(env.usdc.id(), "storage_unregister")
        .args_json(json!({}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;

    let out = close(&who, &vault).await?;
    assert!(!out.clone().json::<bool>()?, "{out:?}");
    assert_eq!(vault_events(&out)[0]["event"], "position_close_failed");
    let p = position(&vault, &who).await?;
    assert_eq!(p["closing"], false);
    assert_eq!(p["collateral"], COLLATERAL.to_string());
    assert_eq!(balance(&env.usdc, vault.id()).await?, COLLATERAL);

    register(&env.minter, &env.usdc, who.id()).await?;
    assert!(close(&who, &vault).await?.json::<bool>()?);
    assert_eq!(balance(&env.usdc, who.id()).await?, COLLATERAL);
    Ok(())
}

#[tokio::test]
async fn callbacks_are_private_and_init_runs_once() -> anyhow::Result<()> {
    let (env, vault) = vault_env(|_| {}).await?;
    let out = env.alice
        .call(vault.id(), "on_kredofi_read")
        .args_json(json!({ "borrower": env.alice.id(), "amount": COLLATERAL.to_string() }))
        .transact()
        .await?;
    assert!(out.is_failure());
    assert!(format!("{:?}", out.failures()).contains("private"), "{out:?}");
    assert!(position(&vault, &env.alice).await?.is_null());

    transfer_call(&env.alice, &env.usdc, vault.id(), COLLATERAL, "open").await?.into_result()?;
    let out = env.alice
        .call(vault.id(), "on_close_transfer")
        .args_json(json!({ "account": env.alice.id() }))
        .transact()
        .await?;
    assert!(out.is_failure());
    assert!(!position(&vault, &env.alice).await?.is_null());

    assert!(env.alice.call(vault.id(), "new").args_json(json!({ "kredofi": env.alice.id(), "usdc": env.alice.id() })).transact().await?.is_failure());
    Ok(())
}

/// A KredoFi score changes nothing on KredoFi's side when read: its books stay as they were.
#[tokio::test]
async fn kredofi_state_is_untouched() -> anyhow::Result<()> {
    let (env, vault) = vault_env(|_| {}).await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 1_000 * USDC, "deposit").await?.into_result()?;
    score(&env, &env.bob, "A", 1000, 0x11).await?;
    let before = pool_state(&env.pool).await?;
    let b_before: Value = env.pool.view("get_borrower").args_json(json!({ "account_id": env.bob.id() })).await?.json()?;
    transfer_call(&env.bob, &env.usdc, vault.id(), COLLATERAL, "open").await?.into_result()?;
    assert_eq!(pool_state(&env.pool).await?, before);
    let b_after: Value = env.pool.view("get_borrower").args_json(json!({ "account_id": env.bob.id() })).await?.json()?;
    assert_eq!(b_before, b_after);
    assert_books_balance(&env).await
}
