//! Day 1: lender pool on a real sandbox with real token transfers.
//! Covers SPEC 4 (deposit, withdraw, seed_reserve), SPEC 3 share math,
//! security rule 7 (state first, rollback on failed transfer) and rule 10 (no owner path).

mod common;

use common::*;
use near_workspaces::types::{Gas, NearToken};
use serde_json::{Value, json};
use std::collections::BTreeSet;

#[tokio::test]
async fn deposit_mints_shares_and_withdraw_pays_back() -> anyhow::Result<()> {
    let env = setup().await?;

    let out = transfer_call(&env.alice, &env.usdc, env.pool.id(), 1_000 * USDC, "deposit").await?;
    assert!(out.is_success(), "{out:?}");
    let used: String = out.clone().json()?;
    assert_eq!(used, (1_000 * USDC).to_string(), "pool kept all tokens");

    let ev = events(&out);
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0]["event"], "lender_deposit");
    assert_eq!(ev[0]["version"], "1.0.0");
    assert_eq!(ev[0]["data"][0]["lender"], env.alice.id().as_str());
    assert_eq!(ev[0]["data"][0]["amount"], (1_000 * USDC).to_string());
    assert_eq!(ev[0]["data"][0]["shares"], (1_000 * USDC).to_string());

    assert_eq!(lender(&env.pool, env.alice.id()).await?, (1_000 * USDC, 1_000 * USDC));
    let p = pool_state(&env.pool).await?;
    assert_eq!((p.cash, p.total_shares, p.pool_value), (1_000 * USDC, 1_000 * USDC, 1_000 * USDC));
    assert_eq!(balance(&env.usdc, env.alice.id()).await?, 9_000 * USDC);
    assert_books_balance(&env).await?;

    let out = withdraw(&env.alice, &env.pool, 400 * USDC).await?;
    assert!(out.is_success(), "{out:?}");
    assert!(out.clone().json::<bool>()?, "callback reports paid");
    let ev = events(&out);
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0]["event"], "lender_withdraw");
    assert_eq!(ev[0]["data"][0]["amount"], (400 * USDC).to_string());

    assert_eq!(balance(&env.usdc, env.alice.id()).await?, 9_400 * USDC);
    assert_eq!(lender(&env.pool, env.alice.id()).await?, (600 * USDC, 600 * USDC));
    assert_books_balance(&env).await?;
    Ok(())
}

#[tokio::test]
async fn two_lenders_get_proportional_shares_and_exit_whole() -> anyhow::Result<()> {
    let env = setup().await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 1_000 * USDC, "deposit").await?.into_result()?;
    transfer_call(&env.bob, &env.usdc, env.pool.id(), 500 * USDC, "deposit").await?.into_result()?;

    assert_eq!(lender(&env.pool, env.bob.id()).await?, (500 * USDC, 500 * USDC));
    let p = pool_state(&env.pool).await?;
    assert_eq!((p.pool_value, p.total_shares), (1_500 * USDC, 1_500 * USDC));

    withdraw(&env.alice, &env.pool, 1_000 * USDC).await?.into_result()?;
    withdraw(&env.bob, &env.pool, 500 * USDC).await?.into_result()?;

    assert_eq!(balance(&env.usdc, env.alice.id()).await?, 10_000 * USDC);
    assert_eq!(balance(&env.usdc, env.bob.id()).await?, 10_000 * USDC);
    let p = pool_state(&env.pool).await?;
    assert_eq!((p.cash, p.total_shares, p.pool_value), (0, 0, 0));
    assert_eq!(lender(&env.pool, env.alice.id()).await?, (0, 0));
    assert_books_balance(&env).await?;
    Ok(())
}

/// Rule 7: the pool writes state before `ft_transfer`; when the transfer fails the
/// callback restores shares and cash. The transfer is made to fail for real by having
/// the lender unregister from the token after depositing everything.
#[tokio::test]
async fn failed_withdraw_transfer_rolls_back() -> anyhow::Result<()> {
    let env = setup().await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 10_000 * USDC, "deposit").await?.into_result()?;
    transfer_call(&env.bob, &env.usdc, env.pool.id(), 500 * USDC, "deposit").await?.into_result()?;
    let before_pool = pool_state(&env.pool).await?;
    let before_alice = lender(&env.pool, env.alice.id()).await?;

    // Alice now has 0 USDC, so she can leave the token without `force`.
    env.alice
        .call(env.usdc.id(), "storage_unregister")
        .args_json(json!({}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;

    let out = withdraw(&env.alice, &env.pool, 4_000 * USDC).await?;
    assert!(out.is_success(), "outer tx succeeds; the callback handles the failure: {out:?}");
    assert!(!out.clone().json::<bool>()?, "callback reports not paid");
    assert!(!out.receipt_failures().is_empty(), "the ft_transfer receipt really failed");
    assert!(events(&out).is_empty(), "no lender_withdraw event for a failed withdraw");

    assert_eq!(pool_state(&env.pool).await?, before_pool);
    assert_eq!(lender(&env.pool, env.alice.id()).await?, before_alice);
    assert_books_balance(&env).await?;

    // After re-registering, the same withdraw works.
    register(&env.alice, &env.usdc, env.alice.id()).await?;
    let out = withdraw(&env.alice, &env.pool, 4_000 * USDC).await?;
    assert!(out.clone().json::<bool>()?);
    assert_eq!(balance(&env.usdc, env.alice.id()).await?, 4_000 * USDC);
    assert_eq!(lender(&env.pool, env.alice.id()).await?, (6_000 * USDC, 6_000 * USDC));
    assert_books_balance(&env).await?;
    Ok(())
}

#[tokio::test]
async fn withdraw_rules() -> anyhow::Result<()> {
    let env = setup().await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 100 * USDC, "deposit").await?.into_result()?;
    transfer_call(&env.bob, &env.usdc, env.pool.id(), 100 * USDC, "deposit").await?.into_result()?;

    // More than owned.
    let out = withdraw(&env.alice, &env.pool, 100 * USDC + 1).await?;
    assert!(out.is_failure());
    assert!(format!("{:?}", out.failures()).contains("Not enough shares"));

    // Needs exactly 1 yoctoNEAR.
    let out = env.alice
        .call(env.pool.id(), "withdraw")
        .args_json(json!({ "shares": "1" }))
        .gas(Gas::from_tgas(60))
        .transact()
        .await?;
    assert!(out.is_failure());
    assert!(format!("{:?}", out.failures()).contains("1 yoctoNEAR"));

    assert_eq!(lender(&env.pool, env.alice.id()).await?, (100 * USDC, 100 * USDC));
    assert_books_balance(&env).await?;
    Ok(())
}

/// Only the configured USDC contract can credit deposits; anything else is refunded.
#[tokio::test]
async fn deposits_from_other_tokens_or_bad_msg_are_refunded() -> anyhow::Result<()> {
    let env = setup().await?;
    let fake = deploy_token(&env.worker, "fake-usdc", &env.alice).await?;
    register(&env.alice, &fake, env.alice.id()).await?;
    register(&env.alice, &fake, env.pool.id()).await?;
    mint(&env.alice, &fake, env.alice.id(), 1_000_000 * USDC).await?;

    let out = transfer_call(&env.alice, &fake, env.pool.id(), 1_000_000 * USDC, "deposit").await?;
    assert_eq!(out.clone().json::<String>()?, "0", "nothing used");
    assert!(format!("{:?}", out.failures()).contains("Only the configured USDC token is accepted"));
    assert_eq!(balance(&fake, env.alice.id()).await?, 1_000_000 * USDC, "refunded");
    assert_eq!(lender(&env.pool, env.alice.id()).await?, (0, 0));

    let out = transfer_call(&env.alice, &env.usdc, env.pool.id(), 100 * USDC, "donate").await?;
    assert_eq!(out.clone().json::<String>()?, "0");
    assert_eq!(balance(&env.usdc, env.alice.id()).await?, 10_000 * USDC, "refunded");

    // Calling ft_on_transfer directly (not via the token) is rejected too.
    let out = env.alice
        .call(env.pool.id(), "ft_on_transfer")
        .args_json(json!({ "sender_id": env.alice.id(), "amount": "1000000", "msg": "deposit" }))
        .transact()
        .await?;
    assert!(out.is_failure());

    let p = pool_state(&env.pool).await?;
    assert_eq!((p.cash, p.total_shares, p.reserve), (0, 0, 0));
    assert_books_balance(&env).await?;
    Ok(())
}

#[tokio::test]
async fn only_owner_seeds_reserve_and_it_is_not_lender_money() -> anyhow::Result<()> {
    let env = setup().await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 1_000 * USDC, "deposit").await?.into_result()?;

    let out = transfer_call(&env.owner, &env.usdc, env.pool.id(), 300 * USDC, "seed_reserve").await?;
    assert_eq!(out.clone().json::<String>()?, (300 * USDC).to_string());
    let ev = events(&out);
    assert_eq!(ev[0]["event"], "reserve_seeded");
    assert_eq!(ev[0]["data"][0]["amount"], (300 * USDC).to_string());

    let out = transfer_call(&env.bob, &env.usdc, env.pool.id(), 50 * USDC, "seed_reserve").await?;
    assert_eq!(out.clone().json::<String>()?, "0", "non-owner seed refunded");
    assert_eq!(balance(&env.usdc, env.bob.id()).await?, 10_000 * USDC);

    let p = pool_state(&env.pool).await?;
    assert_eq!(p.reserve, 300 * USDC);
    assert_eq!(p.pool_value, 1_000 * USDC, "reserve is separate from pool value");
    assert_eq!(lender(&env.pool, env.alice.id()).await?.1, 1_000 * USDC);
    assert_books_balance(&env).await?;
    Ok(())
}

/// Rule 10: no owner path to lender funds or the reserve.
/// 1. The contract's public change methods are exactly this allowlist (from the built ABI).
///    Any new method must be added here on purpose, after checking it moves no funds.
/// 2. The owner cannot withdraw, cannot call the rollback callback, and nothing moves.
#[tokio::test]
async fn owner_cannot_move_lender_funds_or_reserve() -> anyhow::Result<()> {
    let abi: Value = serde_json::from_str(&std::fs::read_to_string(&wasm().kredofi_abi)?)?;
    let mut public_calls = BTreeSet::new();
    for f in abi["body"]["functions"].as_array().expect("abi functions") {
        let mods: Vec<&str> = f["modifiers"]
            .as_array()
            .map(|m| m.iter().filter_map(|x| x.as_str()).collect())
            .unwrap_or_default();
        if f["kind"] == "call" && !mods.contains(&"private") && !mods.contains(&"init") {
            public_calls.insert(f["name"].as_str().unwrap().to_string());
        }
    }
    // None of these move lender funds or the reserve: request_score forwards only the
    // borrower's own attached NEAR to OutLayer; the others write scores or config.
    let allowed: BTreeSet<String> = [
        "ft_on_transfer",
        "withdraw",
        "request_score",
        "dev_submit_score",
        // Clears only the caller's own pending score flag (audit M1); no tokens, no other account.
        "cancel_pending_score",
        // Scorer re-pin time lock (review 2, High): propose, apply after the delay, cancel;
        // the delay can only grow. Config only, no tokens.
        "propose_scorer_version",
        "apply_scorer_version",
        "cancel_scorer_version",
        "set_scorer_delay_ns",
        // borrow pays only the caller, within limit, cash and the 10% cap;
        // mark_default moves reserve INTO pool cash, never out of the contract.
        "borrow",
        "mark_default",
        "request_identity_release",
        "dev_submit_release",
        // Owner setters: bounded numbers in config only, no token or pool access.
        "set_loan_term_ns",
        "set_min_hold_ns",
        "set_grace_ns",
        "set_score_ttl_ns",
        "set_max_borrower_share_bps",
        // Owner flag that only opens or closes new lender deposits (audit H2); moves no tokens.
        "set_production_data",
        // Owner, treasury only: capped at pool.treasury; never touches cash, outstanding or reserve.
        "withdraw_treasury",
        "treasury_to_reserve",
    ].iter().map(|s| s.to_string()).collect();
    assert_eq!(public_calls, allowed, "public change methods changed; review rule 10");

    let env = setup().await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 1_000 * USDC, "deposit").await?.into_result()?;
    transfer_call(&env.owner, &env.usdc, env.pool.id(), 300 * USDC, "seed_reserve").await?.into_result()?;
    let before = pool_state(&env.pool).await?;

    // Owner has no shares.
    assert!(withdraw(&env.owner, &env.pool, 1).await?.is_failure());

    // Rollback callback is #[private]: neither the owner nor a lender can "restore" shares.
    for who in [&env.owner, &env.alice] {
        let out = who
            .call(env.pool.id(), "on_withdraw_transfer")
            .args_json(json!({ "lender": who.id(), "shares": (500 * USDC).to_string(), "amount": (500 * USDC).to_string() }))
            .transact()
            .await?;
        assert!(out.is_failure());
        assert!(format!("{:?}", out.failures()).contains("is private"));
    }

    // Re-initialising to take over config is impossible.
    let out = env.owner
        .call(env.pool.id(), "new")
        .args_json(json!({ "config": config(&env.owner, &env.usdc, &env.scorer, &env.outlayer) }))
        .transact()
        .await?;
    assert!(out.is_failure());

    assert_eq!(pool_state(&env.pool).await?, before);
    assert_eq!(balance(&env.usdc, env.owner.id()).await?, 700 * USDC);
    assert_books_balance(&env).await?;
    Ok(())
}

#[tokio::test]
async fn config_view_matches_init() -> anyhow::Result<()> {
    let env = setup().await?;
    let c: Value = env.pool.view("get_config").await?.json()?;
    assert_eq!(c["owner"], env.owner.id().as_str());
    assert_eq!(c["usdc"], env.usdc.id().as_str());
    assert_eq!(c["scorer_mode"], "Dev");
    assert_eq!(c["partner_pubkey"], PARTNER_PUBKEY);
    assert_eq!(c["min_hold_ns"], "300000000000", "half of the 10-minute demo term");
    let meta: Value = env.usdc.view("ft_metadata").await?.json()?;
    assert_eq!(meta["decimals"], 6);
    Ok(())
}

/// Owner setters: public events, bounded, owner-only, and no funds move.
#[tokio::test]
async fn owner_setters_change_only_config() -> anyhow::Result<()> {
    let env = setup().await?;
    transfer_call(&env.alice, &env.usdc, env.pool.id(), 1_000 * USDC, "deposit").await?.into_result()?;
    transfer_call(&env.owner, &env.usdc, env.pool.id(), 300 * USDC, "seed_reserve").await?.into_result()?;
    let before = pool_state(&env.pool).await?;

    let call = |who: &near_workspaces::Account, method: &str, args: Value| {
        who.call(env.pool.id(), method)
            .args_json(args)
            .deposit(NearToken::from_yoctonear(1))
            .transact()
    };
    // Testnet demo timing, in the required order.
    for (m, v) in [("set_min_hold_ns", "60000000000"), ("set_loan_term_ns", "120000000000"), ("set_grace_ns", "60000000000")] {
        let out = call(&env.owner, m, json!({ "value": v })).await?;
        assert!(out.is_success(), "{m}: {out:?}");
        let ev = events(&out);
        assert_eq!(ev[0]["event"], "param_changed");
        assert_eq!(ev[0]["data"][0]["new"], v);
    }
    let c: Value = env.pool.view("get_config").await?.json()?;
    assert_eq!((c["loan_term_ns"].as_str(), c["min_hold_ns"].as_str(), c["grace_ns"].as_str()),
               (Some("120000000000"), Some("60000000000"), Some("60000000000")));

    assert!(format!("{:?}", call(&env.alice, "set_grace_ns", json!({ "value": "60000000000" })).await?.failures())
        .contains("Only the owner can change parameters"));
    assert!(format!("{:?}", call(&env.owner, "set_max_borrower_share_bps", json!({ "value": 5000 })).await?.failures())
        .contains("rule 12"));

    assert_eq!(pool_state(&env.pool).await?, before);
    assert_eq!(balance(&env.usdc, env.owner.id()).await?, 700 * USDC);
    assert_books_balance(&env).await?;
    Ok(())
}
