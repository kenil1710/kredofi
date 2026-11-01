//! Nov 1 fee change: KredoFi treasury and the v1 -> v2 migration, on a real sandbox.
//! Rule 10: the owner can withdraw only the treasury, or move it into the reserve (one-way).
//! No owner path to pool cash, outstanding principal or the reserve.

mod common;

use common::*;
use near_workspaces::Account;
use near_workspaces::operations::Function;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use serde_json::{Value, json};

fn score_output(who: &Account, fp: u8) -> Value {
    json!({ "v": 1, "caller": who.id(), "band": "A", "score": 1000, "income_cap": 1_000_000_000u64,
            "fingerprint": format!("{fp:02x}").repeat(32), "sealed_identity": "c2VhbGVk" })
}

async fn owner_call(env: &Env, who: &Account, method: &str, amount: u128) -> anyhow::Result<ExecutionFinalResult> {
    Ok(who.call(env.pool.id(), method)
        .args_json(json!({ "amount": amount.to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(60))
        .transact()
        .await?)
}

fn failure(out: &ExecutionFinalResult) -> String {
    format!("{:?}", out.failures())
}

/// $1,000 pool, $300 reserve, Riya borrowed $100 and repaid $104: treasury $2.
async fn env_with_treasury() -> anyhow::Result<(Env, Account)> {
    let env = setup().await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 1_000 * USDC, "deposit").await?.into_result()?;
    transfer_call(&env.owner, &env.usdc, env.pool.id(), 300 * USDC, "seed_reserve").await?.into_result()?;
    let riya = sub(&env.worker, "riya").await?;
    register(&env.minter, &env.usdc, riya.id()).await?;
    mint(&env.minter, &env.usdc, riya.id(), 10 * USDC).await?;
    env.scorer.call(env.pool.id(), "dev_submit_score")
        .args_json(json!({ "borrower": riya.id(), "output": score_output(&riya, 0x11) }))
        .transact().await?.into_result()?;
    riya.call(env.pool.id(), "borrow").args_json(json!({ "amount": (100 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(60)).transact().await?.into_result()?;
    let out = transfer_call(&riya, &env.usdc, env.pool.id(), 104 * USDC, "repay").await?;
    assert_eq!(out.json::<String>()?, (104 * USDC).to_string());
    let p = pool_state(&env.pool).await?;
    assert_eq!((p.cash, p.reserve, p.treasury), (1_002 * USDC, 300 * USDC, 2 * USDC));
    assert_books_balance(&env).await?;
    Ok((env, riya))
}

#[tokio::test]
async fn owner_withdraws_the_treasury_and_nothing_else() -> anyhow::Result<()> {
    let (env, _) = env_with_treasury().await?;
    let owner_before = balance(&env.usdc, env.owner.id()).await?;

    // Rule 10: not a cent above the treasury, although $1,002 of lender cash and $300 of reserve sit there.
    for amount in [2 * USDC + 1, 300 * USDC, 1_002 * USDC] {
        let out = owner_call(&env, &env.owner, "withdraw_treasury", amount).await?;
        assert!(failure(&out).contains("Amount is above the treasury balance"), "{amount}");
        let out = owner_call(&env, &env.owner, "treasury_to_reserve", amount).await?;
        assert!(failure(&out).contains("Amount is above the treasury balance"), "{amount}");
    }
    // Only the owner.
    assert!(failure(&owner_call(&env, &env.alice, "withdraw_treasury", 1).await?).contains("Only the owner can withdraw the treasury"));
    assert!(failure(&owner_call(&env, &env.alice, "treasury_to_reserve", 1).await?).contains("Only the owner can move the treasury"));

    let out = owner_call(&env, &env.owner, "withdraw_treasury", 2 * USDC).await?;
    assert!(out.clone().json::<bool>()?, "{out:?}");
    let ev = events(&out);
    assert_eq!(ev[0]["event"], "treasury_withdrawn");
    assert_eq!(ev[0]["data"][0]["to"], env.owner.id().as_str());
    assert_eq!(balance(&env.usdc, env.owner.id()).await?, owner_before + 2 * USDC);

    let p = pool_state(&env.pool).await?;
    assert_eq!((p.cash, p.outstanding, p.reserve, p.treasury), (1_002 * USDC, 0, 300 * USDC, 0), "lender money and reserve untouched");
    assert_eq!(lender(&env.pool, env.alice.id()).await?.1, 1_002 * USDC);
    assert_books_balance(&env).await?;
    Ok(())
}

/// Rule 7: state first; a failed transfer to the owner restores the treasury exactly.
#[tokio::test]
async fn failed_treasury_transfer_rolls_back() -> anyhow::Result<()> {
    let (env, _) = env_with_treasury().await?;
    // The owner empties its USDC account and leaves the token, so the transfer must fail.
    let left = balance(&env.usdc, env.owner.id()).await?;
    env.owner.call(env.usdc.id(), "ft_transfer")
        .args_json(json!({ "receiver_id": env.bob.id(), "amount": left.to_string() }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    env.owner.call(env.usdc.id(), "storage_unregister").args_json(json!({}))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    let before = pool_state(&env.pool).await?;

    let out = owner_call(&env, &env.owner, "withdraw_treasury", 2 * USDC).await?;
    assert!(out.is_success(), "{out:?}");
    assert!(!out.clone().json::<bool>()?);
    assert!(!out.receipt_failures().is_empty(), "the ft_transfer really failed");
    assert!(events(&out).is_empty());
    assert_eq!(pool_state(&env.pool).await?, before);
    assert_books_balance(&env).await?;

    // The callback is private.
    let out = env.owner.call(env.pool.id(), "on_treasury_transfer")
        .args_json(json!({ "to": env.owner.id(), "amount": "1" })).transact().await?;
    assert!(failure(&out).contains("is private"));
    Ok(())
}

#[tokio::test]
async fn treasury_tops_up_the_reserve_one_way() -> anyhow::Result<()> {
    let (env, _) = env_with_treasury().await?;
    let held = balance(&env.usdc, env.pool.id()).await?;
    let out = owner_call(&env, &env.owner, "treasury_to_reserve", 2 * USDC).await?;
    assert!(out.is_success(), "{out:?}");
    assert_eq!(events(&out)[0]["event"], "treasury_to_reserve");
    let p = pool_state(&env.pool).await?;
    assert_eq!((p.cash, p.reserve, p.treasury), (1_002 * USDC, 302 * USDC, 0));
    assert_eq!(balance(&env.usdc, env.pool.id()).await?, held, "no tokens moved");
    assert_books_balance(&env).await?;
    Ok(())
}

/// The real migration: the exact v1 binary deployed on testnet and mainnet (sha256 ca2556e1…)
/// with real state, then v2 deployed with `migrate` in the same transaction.
#[tokio::test]
async fn migrate_from_deployed_v1_keeps_everything() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let owner = sub(&worker, "owner").await?;
    let minter = sub(&worker, "minter").await?;
    let alice = sub(&worker, "alice").await?;
    let scorer = sub(&worker, "scorer").await?;
    let riya = sub(&worker, "riya").await?;
    let usdc = deploy_token(&worker, "usdc", &minter).await?;
    let outlayer = sub(&worker, "outlayer").await?.deploy(&wasm().mock_outlayer).await?.into_result()?;
    let pool_acc = sub(&worker, "kredofi").await?;
    let pool = pool_acc.deploy(&wasm().kredofi_v1).await?.into_result()?;
    let mut cfg = config(&owner, &usdc, &scorer, &outlayer);
    cfg["reserve_share_bps"] = json!(2000); // v1 config field
    pool.call("new").args_json(json!({ "config": cfg })).transact().await?.into_result()?;
    for id in [owner.id(), alice.id(), riya.id(), pool.id()] { register(&minter, &usdc, id).await?; }
    mint(&minter, &usdc, alice.id(), 1_000 * USDC).await?;
    mint(&minter, &usdc, owner.id(), 300 * USDC).await?;
    mint(&minter, &usdc, riya.id(), 10 * USDC).await?;

    // v1 activity: deposit, seed, score, borrow $100, repay $102 (old 2% terms: 80/20 split).
    transfer_call(&alice, &usdc, pool.id(), 1_000 * USDC, "deposit").await?.into_result()?;
    transfer_call(&owner, &usdc, pool.id(), 300 * USDC, "seed_reserve").await?.into_result()?;
    scorer.call(pool.id(), "dev_submit_score").args_json(json!({ "borrower": riya.id(), "output": score_output(&riya, 0x11) }))
        .transact().await?.into_result()?;
    riya.call(pool.id(), "borrow").args_json(json!({ "amount": (100 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(60)).transact().await?.into_result()?;
    transfer_call(&riya, &usdc, pool.id(), 102 * USDC, "repay").await?.into_result()?;
    let v1_pool: Value = pool.view("get_pool").await?.json()?;
    assert_eq!(v1_pool["reserve"], "300400000", "v1 split");
    assert!(v1_pool.get("treasury").is_none());
    let v1_borrower: Value = pool.view("get_borrower").args_json(json!({ "account_id": riya.id() })).await?.json()?;
    let v1_lender: Value = pool.view("get_lender").args_json(json!({ "account_id": alice.id() })).await?.json()?;
    let v1_config: Value = pool.view("get_config").await?.json()?;

    // Only the contract itself can migrate.
    let out = alice.call(pool.id(), "migrate").args_json(json!({})).transact().await?;
    assert!(out.is_failure());

    // Deploy v2 and migrate atomically, as on testnet and mainnet.
    pool_acc.batch(pool.id())
        .deploy(&wasm().kredofi)
        .call(Function::new("migrate").args_json(json!({})).gas(Gas::from_tgas(30)))
        .transact().await?.into_result()?;

    let p: Value = pool.view("get_pool").await?.json()?;
    for k in ["cash", "outstanding", "total_shares", "reserve", "pool_value"] {
        assert_eq!(p[k], v1_pool[k], "{k} survives");
    }
    assert_eq!(p["treasury"], "0");
    assert_eq!(pool.view("get_borrower").args_json(json!({ "account_id": riya.id() })).await?.json::<Value>()?, v1_borrower);
    assert_eq!(pool.view("get_lender").args_json(json!({ "account_id": alice.id() })).await?.json::<Value>()?, v1_lender);
    let c: Value = pool.view("get_config").await?.json()?;
    assert!(c.get("reserve_share_bps").is_none());
    for k in ["owner", "usdc", "scorer_mode", "scorer_version", "partner_pubkey", "loan_term_ns", "min_hold_ns", "grace_ns", "max_borrower_share_bps"] {
        assert_eq!(c[k], v1_config[k], "{k}");
    }

    // A second migrate fails (state is already v2).
    let out = pool_acc.call(pool.id(), "migrate").args_json(json!({})).transact().await?;
    assert!(out.is_failure());

    // New terms apply: score again, borrow $100, repay $104 -> $2 lenders, $2 treasury.
    mint(&minter, &usdc, riya.id(), 2 * USDC).await?;
    riya.call(pool.id(), "borrow").args_json(json!({ "amount": (100 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(60)).transact().await?.into_result()?;
    let out = transfer_call(&riya, &usdc, pool.id(), 104 * USDC, "repay").await?;
    assert_eq!(out.json::<String>()?, (104 * USDC).to_string());
    let p: Value = pool.view("get_pool").await?.json()?;
    assert_eq!((p["cash"].as_str(), p["reserve"].as_str(), p["treasury"].as_str()), (Some("1003600000"), Some("300400000"), Some("2000000")));
    let held: String = usdc.view("ft_balance_of").args_json(json!({ "account_id": pool.id() })).await?.json()?;
    assert_eq!(held, "1306000000", "token balance = cash + reserve + treasury");
    Ok(())
}
