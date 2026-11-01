//! Testnet demo accounts hold ~0.05 NEAR, and NEAR requires the balance to cover prepaid gas at
//! ~10x the gas price (100 Tgas ~ 0.1 NEAR), so demo calls must work with <= 40 Tgas attached.
//! This test pins that budget: if a contract change needs more gas, it fails here first.

mod common;

use common::*;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use serde_json::json;

/// Prepaid gas used by scripts/demo.mjs for each call.
const DEMO_GAS_TGAS: u64 = 40;

fn burnt_tgas(out: &ExecutionFinalResult) -> f64 {
    out.total_gas_burnt.as_gas() as f64 / 1e12
}

#[tokio::test]
async fn demo_calls_fit_40_tgas() -> anyhow::Result<()> {
    let env = setup_with(|c| {
        c["loan_term_ns"] = json!("120000000000");
        c["grace_ns"] = json!("60000000000");
    })
    .await?;
    let gas = Gas::from_tgas(DEMO_GAS_TGAS);
    let ftc = |who: &near_workspaces::Account, amount: u128, msg: &str| {
        who.call(env.usdc.id(), "ft_transfer_call")
            .args_json(json!({ "receiver_id": env.pool.id(), "amount": amount.to_string(), "msg": msg }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(gas)
            .transact()
    };

    let out = ftc(&env.alice, 1_000 * USDC, "deposit").await?;
    assert_eq!(out.clone().json::<String>()?, (1_000 * USDC).to_string(), "deposit at 40 Tgas: {out:?}");
    println!("deposit: {:.1} Tgas burnt", burnt_tgas(&out));

    let out = ftc(&env.owner, 300 * USDC, "seed_reserve").await?;
    assert_eq!(out.clone().json::<String>()?, (300 * USDC).to_string());

    env.scorer
        .call(env.pool.id(), "dev_submit_score")
        .args_json(json!({ "borrower": env.bob.id(), "output": {
            "v": 1, "caller": env.bob.id(), "band": "A", "score": 1000, "income_cap": 1_000_000_000u64,
            "fingerprint": "11".repeat(32), "sealed_identity": "c2VhbGVk" } }))
        .gas(Gas::from_tgas(DEMO_GAS_TGAS))
        .transact()
        .await?
        .into_result()?;

    let out = env.bob
        .call(env.pool.id(), "borrow")
        .args_json(json!({ "amount": (100 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(gas)
        .transact()
        .await?;
    assert!(out.clone().json::<bool>()?, "borrow at 40 Tgas: {out:?}");
    println!("borrow: {:.1} Tgas burnt", burnt_tgas(&out));

    let out = ftc(&env.bob, 102 * USDC, "repay").await?;
    assert_eq!(out.clone().json::<String>()?, (102 * USDC).to_string(), "repay at 40 Tgas: {out:?}");
    println!("repay: {:.1} Tgas burnt", burnt_tgas(&out));

    let out = env.alice
        .call(env.pool.id(), "withdraw")
        .args_json(json!({ "shares": (10 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(gas)
        .transact()
        .await?;
    assert!(out.clone().json::<bool>()?, "withdraw at 40 Tgas: {out:?}");
    println!("withdraw: {:.1} Tgas burnt", burnt_tgas(&out));
    assert_books_balance(&env).await?;
    Ok(())
}
