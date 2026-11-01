//! Shared harness: builds both contracts once per test binary, starts a sandbox,
//! deploys mock USDC and KredoFi, and registers accounts with the token.
#![allow(dead_code)]

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::OnceLock;

pub const USDC: u128 = 1_000_000; // 6 decimals: $1
pub const PARTNER_PUBKEY: &str =
    "0101010101010101010101010101010101010101010101010101010101010101";

pub struct Wasm {
    pub kredofi: Vec<u8>,
    pub kredofi_abi: PathBuf,
    pub mock_usdc: Vec<u8>,
    pub mock_outlayer: Vec<u8>,
}

fn build(manifest: &str) -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let manifest = root.join(manifest).canonicalize().expect("manifest path");
    let opts = cargo_near_build::BuildOpts::builder()
        .manifest_path(camino_path(&manifest))
        .build();
    cargo_near_build::build_with_cli(opts)
        .expect("cargo near build failed")
        .into_std_path_buf()
}

fn camino_path(p: &std::path::Path) -> String {
    p.to_str().expect("utf-8 path").to_string()
}

/// Built once per test binary, so tests always run against the current source.
pub fn wasm() -> &'static Wasm {
    static WASM: OnceLock<Wasm> = OnceLock::new();
    WASM.get_or_init(|| {
        let usdc_path = build("contracts/mock-usdc/Cargo.toml");
        let kredofi_path = build("contracts/kredofi/Cargo.toml");
        let outlayer_path = build("tests/mock-outlayer/Cargo.toml");
        Wasm {
            mock_outlayer: std::fs::read(&outlayer_path).unwrap(),
            kredofi: std::fs::read(&kredofi_path).unwrap(),
            kredofi_abi: kredofi_path.with_file_name("kredofi_abi.json"),
            mock_usdc: std::fs::read(&usdc_path).unwrap(),
        }
    })
}

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub usdc: Contract,
    pub pool: Contract,
    pub owner: Account,
    pub minter: Account,
    pub alice: Account,
    pub bob: Account,
    /// `dev_scorer` in Dev mode.
    pub scorer: Account,
    /// Mock OutLayer (`config.outlayer`).
    pub outlayer: Contract,
}

pub async fn sub(worker: &Worker<Sandbox>, name: &str) -> anyhow::Result<Account> {
    Ok(worker
        .root_account()?
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?)
}

pub async fn deploy_token(worker: &Worker<Sandbox>, name: &str, minter: &Account) -> anyhow::Result<Contract> {
    let acc = sub(worker, name).await?;
    let token = acc.deploy(&wasm().mock_usdc).await?.into_result()?;
    token
        .call("new")
        .args_json(json!({ "owner": minter.id() }))
        .transact()
        .await?
        .into_result()?;
    Ok(token)
}

pub const SCORER_VERSION: &str = "f45185a0f45185a0f45185a0f45185a0f45185a0f45185a0f45185a0f45185a0";

pub fn config(owner: &Account, usdc: &Contract, scorer: &Account, outlayer: &Contract) -> Value {
    json!({
        "owner": owner.id(),
        "usdc": usdc.id(),
        "scorer_mode": "Dev",
        "dev_scorer": scorer.id(),
        "outlayer": outlayer.id(),
        "scorer_project": "owner/kredofi-scorer",
        "scorer_version": SCORER_VERSION,
        "secrets_profile": "kredofi",
        "secrets_account": owner.id(),
        "partner_pubkey": PARTNER_PUBKEY,
        "loan_term_ns": "600000000000",   // 10 minutes (demo)
        "grace_ns": "120000000000",       // 2 minutes (demo)
        "score_ttl_ns": "2592000000000000", // 30 days
        "reserve_share_bps": 2000,
        "max_borrower_share_bps": 1000,
    })
}

/// Sandbox with mock USDC and KredoFi deployed; alice and bob hold $10,000 each,
/// the owner holds $1,000 for the reserve seed.
pub async fn setup() -> anyhow::Result<Env> {
    setup_with(|_| {}).await
}

/// OutLayer mode, pointed at the mock OutLayer.
pub async fn setup_outlayer() -> anyhow::Result<Env> {
    setup_with(|c| {
        c["scorer_mode"] = json!("OutLayer");
        c["dev_scorer"] = Value::Null;
    })
    .await
}

/// Like `setup`, with the init config adjusted by `tweak`.
pub async fn setup_with(tweak: impl FnOnce(&mut Value)) -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let owner = sub(&worker, "owner").await?;
    let minter = sub(&worker, "minter").await?;
    let alice = sub(&worker, "alice").await?;
    let bob = sub(&worker, "bob").await?;
    let scorer = sub(&worker, "scorer").await?;
    let usdc = deploy_token(&worker, "usdc", &minter).await?;
    let outlayer = sub(&worker, "outlayer").await?.deploy(&wasm().mock_outlayer).await?.into_result()?;

    let pool_acc = sub(&worker, "kredofi").await?;
    let mut cfg = config(&owner, &usdc, &scorer, &outlayer);
    tweak(&mut cfg);
    let pool = pool_acc.deploy(&wasm().kredofi).await?.into_result()?;
    pool.call("new")
        .args_json(json!({ "config": cfg }))
        .transact()
        .await?
        .into_result()?;

    for id in [owner.id(), alice.id(), bob.id(), pool.id()] {
        register(&minter, &usdc, id).await?;
    }
    mint(&minter, &usdc, alice.id(), 10_000 * USDC).await?;
    mint(&minter, &usdc, bob.id(), 10_000 * USDC).await?;
    mint(&minter, &usdc, owner.id(), 1_000 * USDC).await?;

    Ok(Env { worker, usdc, pool, owner, minter, alice, bob, scorer, outlayer })
}

pub async fn register(payer: &Account, token: &Contract, id: &near_workspaces::AccountId) -> anyhow::Result<()> {
    payer
        .call(token.id(), "storage_deposit")
        .args_json(json!({ "account_id": id, "registration_only": true }))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

pub async fn mint(minter: &Account, token: &Contract, to: &near_workspaces::AccountId, amount: u128) -> anyhow::Result<()> {
    minter
        .call(token.id(), "mint")
        .args_json(json!({ "account_id": to, "amount": amount.to_string() }))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

/// `token.ft_transfer_call(receiver, amount, msg)`; returns the full outcome.
pub async fn transfer_call(
    from: &Account,
    token: &Contract,
    receiver: &near_workspaces::AccountId,
    amount: u128,
    msg: &str,
) -> anyhow::Result<ExecutionFinalResult> {
    Ok(from
        .call(token.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": receiver, "amount": amount.to_string(), "msg": msg }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?)
}

pub async fn withdraw(lender: &Account, pool: &Contract, shares: u128) -> anyhow::Result<ExecutionFinalResult> {
    Ok(lender
        .call(pool.id(), "withdraw")
        .args_json(json!({ "shares": shares.to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(60))
        .transact()
        .await?)
}

pub async fn balance(token: &Contract, id: &near_workspaces::AccountId) -> anyhow::Result<u128> {
    let v: String = token
        .view("ft_balance_of")
        .args_json(json!({ "account_id": id }))
        .await?
        .json()?;
    Ok(v.parse()?)
}

fn u(v: &Value, k: &str) -> u128 {
    v[k].as_str().unwrap_or_else(|| panic!("missing {k} in {v}")).parse().unwrap()
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct PoolState {
    pub cash: u128,
    pub outstanding: u128,
    pub total_shares: u128,
    pub reserve: u128,
    pub pool_value: u128,
}

pub async fn pool_state(pool: &Contract) -> anyhow::Result<PoolState> {
    let v: Value = pool.view("get_pool").await?.json()?;
    Ok(PoolState {
        cash: u(&v, "cash"),
        outstanding: u(&v, "outstanding"),
        total_shares: u(&v, "total_shares"),
        reserve: u(&v, "reserve"),
        pool_value: u(&v, "pool_value"),
    })
}

/// (shares, value)
pub async fn lender(pool: &Contract, id: &near_workspaces::AccountId) -> anyhow::Result<(u128, u128)> {
    let v: Value = pool
        .view("get_lender")
        .args_json(json!({ "account_id": id }))
        .await?
        .json()?;
    Ok((u(&v, "shares"), u(&v, "value")))
}

/// All NEP-297 `kredofi` events in an outcome, as parsed JSON.
pub fn events(outcome: &ExecutionFinalResult) -> Vec<Value> {
    outcome
        .logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|j| serde_json::from_str::<Value>(j).ok())
        .filter(|e| e["standard"] == "kredofi")
        .collect()
}

/// Tokens the contract holds must always equal what it accounts for.
/// (`outstanding` is with borrowers, so it is not on the contract's balance.)
pub async fn assert_books_balance(env: &Env) -> anyhow::Result<()> {
    let p = pool_state(&env.pool).await?;
    let held = balance(&env.usdc, env.pool.id()).await?;
    assert_eq!(held, p.cash + p.reserve, "token balance != cash + reserve: {p:?}");
    Ok(())
}

/// Current sandbox block timestamp (ns).
pub async fn now(env: &Env) -> anyhow::Result<u64> {
    Ok(env.worker.view_block().await?.timestamp())
}

/// Fast-forward the sandbox until block time is strictly after `ts` (ns).
pub async fn advance_past(env: &Env, ts: u64) -> anyhow::Result<()> {
    for _ in 0..50 {
        if now(env).await? > ts {
            return Ok(());
        }
        env.worker.fast_forward(50).await?;
    }
    anyhow::bail!("sandbox time did not pass {ts}")
}

/// New account registered with the token and holding `usd` test USDC.
pub async fn new_user(env: &Env, name: &str, usd: u128) -> anyhow::Result<Account> {
    let a = sub(&env.worker, name).await?;
    register(&env.minter, &env.usdc, a.id()).await?;
    if usd > 0 {
        mint(&env.minter, &env.usdc, a.id(), usd * USDC).await?;
    }
    Ok(a)
}
