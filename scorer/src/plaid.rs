//! Plaid sandbox calls (SPEC 5 steps 1-3, 8). wasm32-wasip2 only.
//! The access token never leaves this module and never appears in output or errors.

use kredofi_scorer::{BankData, SyncProgress, SyncStep};
use kredofi_scorer::rules::Tx;
use serde_json::{Value, json};
use std::time::Duration;
use wasi_http_client::Client;

const PLAID: &str = "https://sandbox.plaid.com";
/// Sandbox institution used for demo profiles ("First Platypus Bank").
const DEMO_INSTITUTION: &str = "ins_109508";

pub struct Plaid {
    client_id: String,
    secret: String,
}

fn cents(dollars: f64) -> i64 {
    (dollars * 100.0).round() as i64
}

impl Plaid {
    pub fn from_env() -> Result<Self, String> {
        Ok(Self {
            client_id: std::env::var("PLAID_CLIENT_ID").map_err(|_| "PLAID_CLIENT_ID secret missing")?,
            secret: std::env::var("PLAID_SECRET").map_err(|_| "PLAID_SECRET secret missing")?,
        })
    }

    fn post(&self, path: &str, mut body: Value) -> Result<Value, String> {
        body["client_id"] = json!(self.client_id);
        body["secret"] = json!(self.secret);
        let bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
        let resp = Client::new()
            .post(&format!("{PLAID}{path}"))
            .header("Content-Type", "application/json")
            .body(&bytes)
            .connect_timeout(Duration::from_secs(10))
            .send()
            .map_err(|_| format!("request to {path} failed"))?;
        let status = resp.status();
        let raw = resp.body().map_err(|_| format!("reading {path} failed"))?;
        let v: Value = serde_json::from_slice(&raw).map_err(|_| format!("bad JSON from {path}"))?;
        if status != 200 {
            // Plaid error codes only; never echo the request.
            return Err(format!("{path} returned {status}: {}", v["error_code"].as_str().unwrap_or("?")));
        }
        Ok(v)
    }

    /// Demo only: a sandbox custom user built from `profile` (SPEC 5 "Demo-only").
    pub fn public_token_from_profile(&self, profile: &Value) -> Result<String, String> {
        let r = self.post(
            "/sandbox/public_token/create",
            json!({
                "institution_id": DEMO_INSTITUTION,
                "initial_products": ["transactions", "identity"],
                "options": {
                    "override_username": "user_custom",
                    "override_password": profile.to_string(),
                    "transactions": { "days_requested": 730 },
                },
            }),
        )?;
        r["public_token"].as_str().map(String::from).ok_or_else(|| "no public_token".into())
    }

    pub fn exchange(&self, public_token: &str) -> Result<String, String> {
        let r = self.post("/item/public_token/exchange", json!({ "public_token": public_token }))?;
        r["access_token"].as_str().map(String::from).ok_or_else(|| "no access_token".into())
    }

    /// Revoke the bank connection (SPEC 5 step 8). Best effort; called on every path.
    pub fn remove(&self, access_token: &str) -> Result<(), String> {
        self.post("/item/remove", json!({ "access_token": access_token })).map(|_| ())
    }

    pub fn fetch(&self, access_token: &str) -> Result<BankData, String> {
        // Transactions first: the historical pull may need retries.
        let (txs, status, retries) = self.sync_all(access_token)?; #[cfg(feature = "demo")] kredofi_scorer::demo::note_sync(txs.len());
        #[cfg(feature = "debug")]
        if std::env::var("KREDOFI_TRACE").is_ok() {
            eprintln!("trace sync: status {status}, retries {retries}, transactions {}", txs.len());
        }
        let _ = (&status, retries);

        let accts = self.post("/accounts/get", json!({ "access_token": access_token }))?;
        let institution_id = accts["item"]["institution_id"].as_str().unwrap_or("").to_string();
        let list = accts["accounts"].as_array().ok_or("no accounts")?; #[cfg(feature = "demo")] kredofi_scorer::demo::note_accounts(list.len());
        let depository = |a: &&Value| a["type"] == "depository";
        let primary = list
            .iter()
            .filter(depository)
            .find(|a| a["subtype"] == "checking")
            .or_else(|| list.iter().find(depository))
            .ok_or("no checking or savings account")?;
        let account_id = primary["account_id"].as_str().ok_or("account without id")?.to_string();
        let mask = primary["mask"].as_str().unwrap_or("").to_string();
        let balance_cents = cents(primary["balances"]["current"].as_f64().unwrap_or(0.0));

        let ident = self.post("/identity/get", json!({ "access_token": access_token }))?;
        let owner_name = ident["accounts"]
            .as_array()
            .and_then(|a| a.iter().find(|x| x["account_id"] == account_id.as_str()))
            .and_then(|a| a["owners"].get(0))
            .and_then(|o| o["names"].get(0))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        let txs = txs
            .into_iter()
            .filter(|t| t["account_id"] == account_id.as_str() && t["pending"] != true)
            .map(|t| Tx {
                date: t["date"].as_str().unwrap_or("").to_string(),
                amount_cents: cents(t["amount"].as_f64().unwrap_or(0.0)),
                name: t["name"].as_str().unwrap_or("").to_string(),
            })
            .collect();
        Ok(BankData { institution_id, owner_name, mask, balance_cents, txs })
    }

    /// `/transactions/sync`: loop on `has_more`, poll once per second; completion rule in
    /// `kredofi_scorer::SyncProgress` (status alone is not enough, see there).
    fn sync_all(&self, access_token: &str) -> Result<(Vec<Value>, String, u32), String> {
        let mut by_id: std::collections::BTreeMap<String, Value> = Default::default();
        let mut cursor = String::new();
        let mut progress = SyncProgress::default();
        let mut added_since_checkpoint = 0usize;
        loop {
            let r = self.post(
                "/transactions/sync",
                json!({ "access_token": access_token, "cursor": cursor, "count": 500 }),
            )?;
            let added = r["added"].as_array().map_or(0, Vec::len);
            added_since_checkpoint += added;
            for t in r["added"].as_array().into_iter().flatten().chain(r["modified"].as_array().into_iter().flatten()) {
                if let Some(id) = t["transaction_id"].as_str() {
                    by_id.insert(id.to_string(), t.clone());
                }
            }
            for t in r["removed"].as_array().into_iter().flatten() {
                if let Some(id) = t["transaction_id"].as_str() {
                    by_id.remove(id);
                }
            }
            cursor = r["next_cursor"].as_str().unwrap_or("").to_string();
            let status = r["transactions_update_status"].as_str().unwrap_or("").to_string(); if r["has_more"].as_bool() != Some(true) { match kredofi_scorer::sync_guard::checkpoint_step(status == "HISTORICAL_UPDATE_COMPLETE", by_id.values()) { kredofi_scorer::sync_guard::Step::Done => return Ok((by_id.into_values().collect(), status, progress.retries())), kredofi_scorer::sync_guard::Step::Repoll => { std::thread::sleep(Duration::from_millis(1500)); continue; } kredofi_scorer::sync_guard::Step::Normal => {} } }
            #[cfg(feature = "debug")]
            if std::env::var("KREDOFI_TRACE").is_ok() {
                eprintln!("trace page: added {added} has_more {} status {status}", r["has_more"]);
            }
            if r["has_more"].as_bool() == Some(true) {
                continue;
            }
            match progress.checkpoint(status == "HISTORICAL_UPDATE_COMPLETE", added_since_checkpoint) {
                SyncStep::Done => return Ok((by_id.into_values().collect(), status, progress.retries())),
                SyncStep::Fail => return Err("bank history not ready yet; try again in a minute".into()),
                SyncStep::Poll => {
                    added_since_checkpoint = 0;
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
        }
    }
}
