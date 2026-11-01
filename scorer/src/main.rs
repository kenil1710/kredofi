//! OutLayer entry point: JSON on stdin, JSON on stdout (SPEC 5).
//! Secrets from env: PLAID_CLIENT_ID, PLAID_SECRET, SEAL_KEY. Caller from NEAR_SENDER_ID.

#[cfg(target_os = "wasi")]
mod plaid;

#[cfg(target_os = "wasi")]
fn run() -> Result<serde_json::Value, String> {
    use kredofi_scorer::{BUILD, Input, Source, crypto, parse_input, release_output, score_output};
    use std::io::Read;

    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw).map_err(|_| "cannot read input")?;
    let input = parse_input(&raw, BUILD)?;
    let seal_key = crypto::unhex32(&std::env::var("SEAL_KEY").map_err(|_| "SEAL_KEY secret missing")?)
        .map_err(|_| "SEAL_KEY must be 32 bytes of hex")?;

    match input {
        Input::Release { sealed, partner_pubkey } => release_output(&seal_key, &sealed, &partner_pubkey),
        Input::Score { source, reply_pubkey, debug } => {
            let caller = std::env::var("NEAR_SENDER_ID").map_err(|_| "NEAR_SENDER_ID missing")?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "clock error")?
                .as_secs();
            let plaid = plaid::Plaid::from_env()?;
            let public_token = match source {
                Source::PublicToken(t) => t,
                Source::Profile(p) => plaid.public_token_from_profile(&p)?,
            };
            let access_token = plaid.exchange(&public_token)?;
            // Always revoke the bank connection, on success and on every error path.
            let result = plaid.fetch(&access_token).and_then(|bank| { #[cfg(feature = "demo")] let bank = kredofi_scorer::scope_identity_to_account(bank, &caller); // testnet/Dev only, SPEC 8c
                if debug {
                    // `debug` builds only: transactions per month, including outside the window.
                    let mut months = std::collections::BTreeMap::<String, (u32, i64)>::new();
                    for t in &bank.txs {
                        let e = months.entry(t.date.get(..7).unwrap_or("?").to_string()).or_default();
                        e.0 += 1;
                        if t.amount_cents < 0 {
                            e.1 -= t.amount_cents;
                        }
                    }
                    eprintln!("debug window: {:?}", kredofi_scorer::window(now));
                    eprintln!("debug months (count, income cents): {months:?}");
                }
                score_output(&caller, &bank, &seal_key, reply_pubkey.as_ref(), now)
            });
            let removed = plaid.remove(&access_token);
            let scored = result?;
            removed.map_err(|e| format!("item/remove failed: {e}"))?;
            if debug {
                // `debug` builds only (rejected by parse_input otherwise). stderr, never stdout.
                eprintln!("debug features: {:?}", scored.features);
                eprintln!("debug parts: {:?}", scored.score.parts);
            }
            Ok(scored.output)
        }
    }
}

#[cfg(target_os = "wasi")]
fn main() {
    let out = run().unwrap_or_else(|e| kredofi_scorer::error_output(&e));
    println!("{out}");
}

#[cfg(not(target_os = "wasi"))]
fn main() {
    eprintln!("kredofi_scorer runs as wasm32-wasip2; build with ./build.sh");
    std::process::exit(1);
}
