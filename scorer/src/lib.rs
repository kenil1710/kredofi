//! KredoFi scorer: everything except the Plaid HTTP calls, so it can be unit-tested natively.
//!
//! Input (stdin, SPEC 5):
//!   {"op":"score","public_token":"public-sandbox-...","reply_pubkey":"<x25519 hex>"}
//!   {"op":"score","profile":{...},"reply_pubkey":"..."}   (demo builds only)
//!   {"op":"release","sealed":"<base64>","partner_pubkey":"<x25519 hex>"}
//! Output (stdout): the score or release JSON, or {"success":false,"error":"..."}.
//! Never output: transactions, balances, names, tokens.

pub mod crypto;
pub mod rules;

use crypto::Key32;
use rules::{Features, Score, Tx};
use serde_json::{Map, Value, json};

/// On-chain OutLayer output limit (prep lesson).
pub const MAX_OUTPUT_BYTES: usize = 900;
const MAX_NAME_BYTES: usize = 64;

/// What the scorer needs from the bank, already reduced to the primary depository account.
#[derive(Clone, Debug)]
pub struct BankData {
    pub institution_id: String,
    pub owner_name: String,
    pub mask: String,
    pub balance_cents: i64,
    pub txs: Vec<Tx>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Source {
    PublicToken(String),
    /// Plaid sandbox custom-user config (demo builds only).
    Profile(Value),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Input {
    Score { source: Source, reply_pubkey: Option<Key32>, debug: bool },
    Release { sealed: String, partner_pubkey: Key32 },
}

/// Which optional inputs this build accepts (Cargo features `demo` and `debug`).
#[derive(Clone, Copy, Debug)]
pub struct BuildFlags {
    pub demo: bool,
    pub debug: bool,
}

pub const BUILD: BuildFlags = BuildFlags { demo: cfg!(feature = "demo"), debug: cfg!(feature = "debug") };

pub fn error_output(msg: &str) -> Value {
    json!({ "success": false, "error": msg })
}

// ------------------------------------------------------------------ transaction sync

pub const MAX_SYNC_RETRIES: u32 = 20;
/// Polls with nothing new after HISTORICAL_UPDATE_COMPLETE before accepting a short history.
pub const QUIET_POLLS_AFTER_COMPLETE: u32 = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SyncStep {
    Done,
    /// Sleep one second and call /transactions/sync again with the latest cursor.
    Poll,
    /// Retries exhausted: fail rather than score incomplete history.
    Fail,
}

/// When is the Plaid history complete? `HISTORICAL_UPDATE_COMPLETE` alone is not enough: in
/// sandbox the status sometimes flips to complete before the historical batch is delivered
/// (Nov 1: 3 of 8 runs got only the first 6 of 30 transactions). So after the status is complete
/// keep polling until a later page actually adds transactions, or until a few quiet polls show a
/// genuinely short history.
#[derive(Clone, Debug, Default)]
pub struct SyncProgress {
    checkpoints: u32,
    quiet_complete: u32,
    retries: u32,
}

impl SyncProgress {
    /// Call once per checkpoint (a page with `has_more == false`), with the transactions added
    /// since the previous checkpoint.
    pub fn checkpoint(&mut self, status_complete: bool, added_since_last: usize) -> SyncStep {
        self.checkpoints += 1;
        if status_complete {
            if self.checkpoints > 1 && added_since_last > 0 {
                return SyncStep::Done;
            }
            self.quiet_complete += 1;
            if self.quiet_complete > QUIET_POLLS_AFTER_COMPLETE {
                return SyncStep::Done;
            }
        }
        if self.retries >= MAX_SYNC_RETRIES {
            return SyncStep::Fail;
        }
        self.retries += 1;
        SyncStep::Poll
    }

    pub fn retries(&self) -> u32 {
        self.retries
    }
}

// ------------------------------------------------------------------ dates

/// (year, month 1-12) from a unix timestamp (UTC).
pub fn year_month(unix_secs: u64) -> (i64, u32) {
    // Howard Hinnant's civil_from_days.
    let z = (unix_secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m)
}

/// The last 6 full calendar months before the current one, oldest first, as `YYYY-MM`.
pub fn window(unix_secs: u64) -> [String; 6] {
    let (y, m) = year_month(unix_secs);
    let current = y * 12 + (m as i64 - 1);
    std::array::from_fn(|i| {
        let k = current - 6 + i as i64;
        format!("{:04}-{:02}", k.div_euclid(12), k.rem_euclid(12) + 1)
    })
}

// ------------------------------------------------------------------ input

fn only_keys(m: &Map<String, Value>, allowed: &[&str], what: &str) -> Result<(), String> {
    match m.keys().find(|k| !allowed.contains(&k.as_str())) {
        Some(k) => Err(format!("unexpected field in {what}: {k}")),
        None => Ok(()),
    }
}

pub fn parse_input(raw: &str, build: BuildFlags) -> Result<Input, String> {
    let v: Value = serde_json::from_str(raw).map_err(|_| "input is not JSON")?;
    let m = v.as_object().ok_or("input must be a JSON object")?;
    if m.contains_key("debug") && !build.debug {
        return Err("debug is disabled in this build".into());
    }
    match m.get("op").and_then(Value::as_str) {
        Some("score") => {
            only_keys(m, &["op", "public_token", "profile", "reply_pubkey", "debug"], "input")?;
            let reply_pubkey = match m.get("reply_pubkey") {
                None | Some(Value::Null) => None,
                Some(k) => Some(crypto::unhex32(k.as_str().ok_or("reply_pubkey must be hex")?)
                    .map_err(|_| "reply_pubkey must be 32 bytes of hex")?),
            };
            let source = match (m.get("public_token"), m.get("profile")) {
                (Some(t), None) => {
                    let t = t.as_str().ok_or("public_token must be a string")?;
                    if t.is_empty() || t.len() > 256 || !t.starts_with("public-") {
                        return Err("invalid public_token".into());
                    }
                    Source::PublicToken(t.to_string())
                }
                (None, Some(p)) => {
                    if !build.demo {
                        return Err("demo profiles are disabled in this build".into());
                    }
                    validate_profile(p)?;
                    Source::Profile(p.clone())
                }
                _ => return Err("give exactly one of public_token or profile".into()),
            };
            let debug = m.get("debug").and_then(Value::as_bool).unwrap_or(false);
            Ok(Input::Score { source, reply_pubkey, debug })
        }
        Some("release") => {
            only_keys(m, &["op", "sealed", "partner_pubkey"], "input")?;
            let sealed = m.get("sealed").and_then(Value::as_str).ok_or("missing sealed")?;
            if sealed.is_empty() || sealed.len() > 512 {
                return Err("invalid sealed".into());
            }
            let pk = m.get("partner_pubkey").and_then(Value::as_str).ok_or("missing partner_pubkey")?;
            let partner_pubkey = crypto::unhex32(pk).map_err(|_| "partner_pubkey must be 32 bytes of hex")?;
            Ok(Input::Release { sealed: sealed.to_string(), partner_pubkey })
        }
        _ => Err("op must be \"score\" or \"release\"".into()),
    }
}

/// SPEC 8b: demo profiles are checked again in the scorer (the browser checks first).
pub fn validate_profile(p: &Value) -> Result<(), String> {
    let m = p.as_object().ok_or("profile must be an object")?;
    only_keys(m, &["seed", "roll_dates_forward", "override_accounts"], "profile")?;
    let accounts = m.get("override_accounts").and_then(Value::as_array).ok_or("profile needs override_accounts")?;
    if accounts.len() != 1 {
        return Err("profile needs exactly one account".into());
    }
    let a = accounts[0].as_object().ok_or("account must be an object")?;
    only_keys(a, &["type", "subtype", "starting_balance", "identity", "transactions"], "account")?;
    if a.get("type").and_then(Value::as_str) != Some("depository") {
        return Err("account type must be depository".into());
    }
    let bal = a.get("starting_balance").and_then(Value::as_f64).ok_or("missing starting_balance")?;
    if !(0.0..=30_000.0).contains(&bal) {
        return Err("starting_balance must be 0 to 30000".into());
    }
    let names = a
        .get("identity")
        .and_then(|i| i.get("names"))
        .and_then(Value::as_array)
        .ok_or("account needs identity.names")?;
    if names.len() != 1 || names[0].as_str().is_none_or(|n| n.trim().is_empty() || n.len() > MAX_NAME_BYTES) {
        return Err("identity.names needs one name of 1-64 bytes".into());
    }
    let txs = a.get("transactions").and_then(Value::as_array).ok_or("account needs transactions")?;
    if txs.is_empty() || txs.len() > 200 {
        return Err("1 to 200 transactions".into());
    }
    for t in txs {
        let amount = t.get("amount").and_then(Value::as_f64).ok_or("transaction needs amount")?;
        if !(-8_000.0..=8_000.0).contains(&amount) {
            return Err("transaction amount must be -8000 to 8000".into());
        }
        let desc = t.get("description").and_then(Value::as_str).ok_or("transaction needs description")?;
        if desc.is_empty() || desc.len() > 64 {
            return Err("description must be 1-64 bytes".into());
        }
        for k in ["date_transacted", "date_posted"] {
            if t.get(k).and_then(Value::as_str).is_none_or(|d| d.len() != 10) {
                return Err(format!("transaction needs {k} as YYYY-MM-DD"));
            }
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ output

pub struct Scored {
    pub output: Value,
    pub score: Score,
    pub features: Features,
}

/// Build the on-chain output (SPEC 5). `caller` comes from NEAR_SENDER_ID, never from input.
pub fn score_output(
    caller: &str,
    bank: &BankData,
    seal_key: &Key32,
    reply_pubkey: Option<&Key32>,
    now_unix: u64,
) -> Result<Scored, String> {
    if caller.is_empty() || caller.len() > 64 {
        return Err("NEAR_SENDER_ID missing or invalid".into());
    }
    let name = bank.owner_name.trim();
    if name.is_empty() {
        return Err("no owner name returned by the bank".into());
    }
    let features = rules::features(&bank.txs, &window(now_unix), bank.balance_cents);
    let score = rules::score(&features);
    let fp = crypto::fingerprint(seal_key, &bank.institution_id, name, &bank.mask);
    let sealed = crypto::seal_identity(seal_key, truncate(name, MAX_NAME_BYTES))?;

    let mut out = json!({
        "v": 1,
        "caller": caller,
        "band": score.band,
        "score": score.score,
        "income_cap": score.income_cap_usd * 1_000_000,
        "fingerprint": crypto::hex(&fp),
        "sealed_identity": sealed,
    });
    if let Some(pk) = reply_pubkey {
        // Private to the borrower's browser: why this band (SPEC 8b result screen).
        let p = &score.parts;
        let detail = json!({ "parts": {
            "income": p.income, "stability": p.stability, "payment": p.payment,
            "cash_flow": p.cash_flow, "buffer": p.buffer,
        }});
        out["reply"] = json!(crypto::seal_to(pk, detail.to_string().as_bytes())?);
    }
    check_size(&out)?;
    Ok(Scored { output: out, score, features })
}

/// Release step: open the sealed name with SEAL_KEY, re-seal it to the partner key.
pub fn release_output(seal_key: &Key32, sealed: &str, partner_pubkey: &Key32) -> Result<Value, String> {
    let name = crypto::open_identity(seal_key, sealed)?;
    let out = json!({ "v": 1, "released": crypto::seal_to(partner_pubkey, name.as_bytes())? });
    check_size(&out)?;
    Ok(out)
}

fn check_size(out: &Value) -> Result<(), String> {
    let n = out.to_string().len();
    if n >= MAX_OUTPUT_BYTES {
        return Err(format!("output is {n} bytes, limit {MAX_OUTPUT_BYTES}"));
    }
    Ok(())
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

#[cfg(test)]
mod tests;

// ------------------------------------------------------------------ testnet identity scope
// (Kept at the end of the file on purpose: code above keeps its line numbers, so the production
// build stays byte-identical to the scorer pinned on mainnet.)

/// Testnet / Dev mode only (SPEC 8c): Plaid's sandbox logins (user_good, ...) return the same
/// identity for every judge, so under rule 6 only the first judge could ever be scored. Demo builds
/// scope the bank identity to the borrower's account before fingerprinting:
/// fingerprint = HMAC(SEAL_KEY, institution_id#account | name | mask). The sealed name is unchanged.
/// The production build (pinned on OutLayer mainnet) does not contain this function, so mainnet
/// keeps the strict rule: one real bank identity, one borrower, whatever the account.
#[cfg(any(test, feature = "demo"))]
pub fn scope_identity_to_account(mut bank: BankData, account: &str) -> BankData {
    bank.institution_id = format!("{}#{}", bank.institution_id, account);
    bank
}

// ------------------------------------------------------------------ testnet extras (demo builds)
// Also kept at the end of the file (see above). The production build contains none of this.

/// Testnet / Dev mode only: a fetch receipt (real counts, no transactions) and an optional AI
/// summary (SPEC 5 step 7), sealed to the borrower's reply key as `extra`. `extra` is never put
/// on-chain: the Dev-mode server strips it before `dev_submit_score` and hands it to the browser.
#[cfg(any(test, feature = "demo"))]
pub mod demo {
    use super::*;
    use std::cell::Cell;

    thread_local! {
        static PLAID_TXS: Cell<usize> = const { Cell::new(0) };
        static PLAID_ACCOUNTS: Cell<usize> = const { Cell::new(0) };
    }
    /// Called by the Plaid client: how many transactions and accounts Plaid sent (counts only).
    pub fn note_sync(transactions: usize) { PLAID_TXS.with(|c| c.set(transactions)); }
    pub fn note_accounts(accounts: usize) { PLAID_ACCOUNTS.with(|c| c.set(accounts)); }

    pub const NEARAI_URL: &str = "https://cloud-api.near.ai/v1/chat/completions";
    pub const NEARAI_MODEL: &str = "Qwen/Qwen3.8-27B";
    const MAX_SUMMARY: usize = 400;

    /// Counts for the borrower's fetch receipt. Never a transaction, amount, name or balance.
    pub fn receipt(f: &Features) -> Value {
        json!({
            "plaid_transactions": PLAID_TXS.with(Cell::get),
            "plaid_accounts": PLAID_ACCOUNTS.with(Cell::get),
            "read_transactions": f.tx_count,
            "months": f.monthly_income_cents.len(),
        })
    }

    /// The AI sees only derived results: band, points per rule and three coarse facts. No
    /// transactions, names, amounts or balances. The score never depends on its answer.
    pub fn summary_request(s: &Score, f: &Features) -> Value {
        let p = &s.parts;
        let months_paid = f.monthly_income_cents.iter().filter(|&&m| m > 0).count();
        let income: i64 = f.monthly_income_cents.iter().sum();
        let spent_more = f.spending_cents > income;
        let facts = format!(
            "Band {} ({} of 1000 points). Rule points: income level {}/250, steady income {}/250, on-time payments {}/250, money left over {}/150, savings buffer {}/100. Facts: income arrived in {} of the last 6 months; {} overdraft or returned-payment fees; spending was {} income.",
            s.band, s.score, p.income, p.stability, p.payment, p.cash_flow, p.buffer, months_paid, f.fee_events,
            if spent_more { "above" } else { "below" }
        );
        json!({
            "model": NEARAI_MODEL,
            "messages": [
                { "role": "system", "content": "/no_think You explain a credit result to the borrower in exactly two short, plain, kind sentences: why this band, and the one change that would help most. No numbers other than the band letter. No advice beyond the rules given." },
                { "role": "user", "content": facts },
            ],
            "max_tokens": 120,
            "temperature": 0.2,
            "chat_template_kwargs": { "enable_thinking": false },
        })
    }

    /// The model's text, cleaned (no reasoning tags, one line, bounded). None if unusable.
    pub fn parse_summary(v: &Value) -> Option<String> {
        let raw = v["choices"][0]["message"]["content"].as_str()?;
        let text = match raw.rfind("</think>") { Some(i) => &raw[i + 8..], None => raw };
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.is_empty() || text.contains("<think>") { return None; }
        Some(truncate(&text, MAX_SUMMARY).to_string())
    }

    #[cfg(target_os = "wasi")]
    fn ask_nearai(req: &Value) -> Option<String> {
        let key = std::env::var("NEARAI_KEY").ok().filter(|k| !k.is_empty())?;
        let body = serde_json::to_vec(req).ok()?;
        let resp = wasi_http_client::Client::new()
            .post(NEARAI_URL)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {key}").as_str())
            .body(&body)
            .connect_timeout(std::time::Duration::from_secs(10))
            .send()
            .ok()?;
        if resp.status() != 200 { return None; }
        parse_summary(&serde_json::from_slice(&resp.body().ok()?).ok()?)
    }
    #[cfg(not(target_os = "wasi"))]
    fn ask_nearai(_req: &Value) -> Option<String> { None }

    /// Testnet speed-up for the sync completion rule (demo builds): once Plaid says the historical
    /// update is complete AND the delivered transactions already reach back to the first month of
    /// the scoring window, the history is complete; no need for the quiet polls. When they don't
    /// reach that far (the Nov 1 sandbox case: status complete, only recent transactions), the
    /// normal `SyncProgress` rule still applies.
    pub fn covers_window<'a>(txs: impl Iterator<Item = &'a Value>) -> bool {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        covers_window_at(txs, now)
    }
    pub fn covers_window_at<'a>(txs: impl Iterator<Item = &'a Value>, now_unix: u64) -> bool {
        let first = window(now_unix)[0].clone(); // "YYYY-MM"
        txs.filter_map(|t| t["date"].as_str()).filter_map(|d| d.get(..7)).any(|m| m <= first.as_str())
    }

    /// Testnet: print the on-chain output as soon as the score exists, so the Dev-mode server can
    /// submit it while the scorer removes the bank connection and asks for the AI summary. The final
    /// line (output + sealed `extra`) still follows.
    pub fn print_early(scored: Scored) -> Scored {
        use std::io::Write;
        println!("{}", scored.output);
        let _ = std::io::stdout().flush();
        scored
    }

    /// Seal {receipt, summary} to the borrower as `extra`. Best effort: any failure leaves the
    /// scored output exactly as it was.
    pub fn with_extra(mut scored: Scored, reply_pubkey: Option<&Key32>) -> Scored {
        let Some(pk) = reply_pubkey else { return scored };
        let mut extra = json!({ "receipt": receipt(&scored.features) });
        if let Some(s) = ask_nearai(&summary_request(&scored.score, &scored.features)) {
            extra["summary"] = json!(s);
            extra["summary_by"] = json!(NEARAI_MODEL);
        }
        if let Ok(sealed) = crypto::seal_to(pk, extra.to_string().as_bytes()) {
            scored.output["extra"] = json!(sealed);
        }
        scored
    }
}
