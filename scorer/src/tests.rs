//! Scorer tests. The SPEC 6 demo table must be reproduced exactly:
//! Riya 250/250/250/150/100 = 1000 A; Sam 100/100/10/0/60 = 270 D; Max 1000 A.

use super::*;
use crate::crypto::{open_sealed, public_of, rand32};
use crate::rules::Parts;

const SEAL_KEY: Key32 = [42u8; 32];
/// 2026-11-01T12:00:00Z: window = 2026-05 .. 2026-10.
const NOV_1_2026: u64 = 1_793_534_400;

// --------------------------------------------------- port of scripts/gen_borrowers.py

fn month_starts(now: u64) -> Vec<String> {
    window(now).to_vec()
}

fn tx(month: &str, day: u32, amount_usd: i64, name: &str) -> Tx {
    Tx { date: format!("{month}-{day:02}"), amount_cents: amount_usd * 100, name: name.into() }
}

fn riya_txs(now: u64) -> Vec<Tx> {
    month_starts(now)
        .iter()
        .flat_map(|m| {
            vec![
                tx(m, 1, -4000, "ACME CORP PAYROLL"),
                tx(m, 3, 1200, "RENT PAYMENT"),
                tx(m, 9, 320, "GROCERY MART"),
                tx(m, 13, 90, "CITY UTILITIES"),
                tx(m, 21, 150, "RESTAURANT"),
            ]
        })
        .collect()
}

fn sam_txs(now: u64) -> Vec<Tx> {
    let pay = [1500, 0, 3200, 800, 0, 2500];
    month_starts(now)
        .iter()
        .enumerate()
        .flat_map(|(i, m)| {
            let mut v = vec![tx(m, 4, 1100, "RENT PAYMENT"), tx(m, 10, 260, "GROCERY MART")];
            if pay[i] > 0 {
                v.push(tx(m, 6, -pay[i], "GIG PLATFORM PAYOUT"));
            }
            if i == 1 || i == 4 {
                v.push(tx(m, 16, 35, "OVERDRAFT FEE"));
                v.push(tx(m, 17, 35, "NSF RETURNED ITEM FEE"));
            }
            v
        })
        .collect()
}

fn max_txs(now: u64) -> Vec<Tx> {
    month_starts(now)
        .iter()
        .flat_map(|m| {
            vec![
                tx(m, 1, -3800, "GLOBEX PAYROLL"),
                tx(m, 3, 1150, "RENT PAYMENT"),
                tx(m, 10, 300, "GROCERY MART"),
                tx(m, 15, 120, "ONLINE SHOPPING"),
            ]
        })
        .collect()
}

fn bank(name: &str, balance_usd: i64, txs: Vec<Tx>) -> BankData {
    BankData {
        institution_id: "ins_109508".into(),
        owner_name: name.into(),
        mask: "0000".into(),
        balance_cents: balance_usd * 100,
        txs,
    }
}

fn level1_limit(s: &Score) -> u64 {
    let pct = match s.band { "A" => 100, "B" => 75, "C" => 50, _ => 0 };
    (100 * pct / 100).min(s.income_cap_usd)
}

#[test]
fn spec6_demo_table() {
    // (name, start balance, txs, parts, score, band, level-1 limit)
    let cases = [
        ("Riya Good", 6000, riya_txs(NOV_1_2026), [250, 250, 250, 150, 100], 1000, "A", 100),
        ("Sam Risky", 3000, sam_txs(NOV_1_2026), [100, 100, 10, 0, 60], 270, "D", 0),
        ("Max Cheater", 5000, max_txs(NOV_1_2026), [250, 250, 250, 150, 100], 1000, "A", 100),
    ];
    for (name, bal, txs, parts, total, band, limit) in cases {
        let s = score_output("x.testnet", &bank(name, bal, txs), &SEAL_KEY, None, NOV_1_2026).unwrap();
        let p = s.score.parts;
        assert_eq!(
            [p.income, p.stability, p.payment, p.cash_flow, p.buffer],
            parts,
            "{name} parts"
        );
        assert_eq!(s.score.score, total, "{name}");
        assert_eq!(s.score.band, band, "{name}");
        assert_eq!(level1_limit(&s.score), limit, "{name} level-1 limit");
        assert_eq!(s.output["score"], total);
        assert_eq!(s.output["band"], band);
    }
}

/// The Plaid balance may be the starting balance or include the 6 months of flows;
/// the demo bands must not depend on which.
#[test]
fn demo_table_robust_to_balance_semantics() {
    for (name, start, txs, band) in [
        ("Riya Good", 6000, riya_txs(NOV_1_2026), "A"),
        ("Sam Risky", 3000, sam_txs(NOV_1_2026), "D"),
        ("Max Cheater", 5000, max_txs(NOV_1_2026), "A"),
    ] {
        let net: i64 = txs.iter().map(|t| -t.amount_cents).sum::<i64>() / 100;
        let a = score_output("x.testnet", &bank(name, start, txs.clone()), &SEAL_KEY, None, NOV_1_2026).unwrap();
        let b = score_output("x.testnet", &bank(name, start + net, txs), &SEAL_KEY, None, NOV_1_2026).unwrap();
        assert_eq!(a.score, b.score, "{name}: start {start} vs end {}", start + net);
        assert_eq!(a.score.band, band);
    }
}

#[test]
fn income_caps_for_demo_borrowers() {
    let riya = score_output("x", &bank("Riya Good", 6000, riya_txs(NOV_1_2026)), &SEAL_KEY, None, NOV_1_2026).unwrap();
    assert_eq!(riya.output["income_cap"], 1_000_000_000u64, "$1,000 cap");
    let sam = score_output("x", &bank("Sam Risky", 3000, sam_txs(NOV_1_2026)), &SEAL_KEY, None, NOV_1_2026).unwrap();
    assert_eq!(sam.output["income_cap"], 650_000_000u64);
}

// --------------------------------------------------- output privacy and size

#[test]
fn output_has_only_allowed_fields_and_no_private_data() {
    let reply_sk = rand32().unwrap();
    let s = score_output(
        "riya.kency.testnet",
        &bank("Riya Good", 6000, riya_txs(NOV_1_2026)),
        &SEAL_KEY,
        Some(&public_of(&reply_sk)),
        NOV_1_2026,
    )
    .unwrap();
    let keys: Vec<&str> = s.output.as_object().unwrap().keys().map(String::as_str).collect();
    for k in &keys {
        assert!(
            ["v", "caller", "band", "score", "income_cap", "fingerprint", "sealed_identity", "reply"].contains(k),
            "unexpected key {k}"
        );
    }
    assert_eq!(keys.len(), 8);
    let text = s.output.to_string();
    for secret in ["Riya", "RIYA", "ACME", "PAYROLL", "RENT", "6000", "4000", "ins_109508", "0000\""] {
        assert!(!text.contains(secret), "output leaks {secret}: {text}");
    }
    assert_eq!(s.output["caller"], "riya.kency.testnet");
    assert_eq!(s.output["v"], 1);
    assert_eq!(s.output["fingerprint"].as_str().unwrap().len(), 64);

    // sealed_identity opens with SEAL_KEY only.
    assert_eq!(crypto::open_identity(&SEAL_KEY, s.output["sealed_identity"].as_str().unwrap()).unwrap(), "Riya Good");

    // reply opens with the borrower's key and explains the band.
    let reply = open_sealed(&reply_sk, s.output["reply"].as_str().unwrap()).unwrap();
    let detail: Value = serde_json::from_slice(&reply).unwrap();
    assert_eq!(detail, json!({"parts": {"income": 250, "stability": 250, "payment": 250, "cash_flow": 150, "buffer": 100}}));
}

#[test]
fn worst_case_output_fits_900_bytes() {
    let caller = format!("{}.testnet", "a".repeat(56)); // 64-char account id
    let name = "Ñ".repeat(60); // 120 bytes, truncated to 64 for sealing
    let s = score_output(&caller, &bank(&name, 6000, riya_txs(NOV_1_2026)), &SEAL_KEY, Some(&public_of(&rand32().unwrap())), NOV_1_2026)
        .unwrap();
    let n = s.output.to_string().len();
    assert!(n < MAX_OUTPUT_BYTES, "{n} bytes");
    let sealed = crypto::open_identity(&SEAL_KEY, s.output["sealed_identity"].as_str().unwrap()).unwrap();
    assert_eq!(sealed.len(), 64);
}

#[test]
fn fingerprint_same_bank_identity_same_value() {
    let a = score_output("a.testnet", &bank("Riya Good", 6000, riya_txs(NOV_1_2026)), &SEAL_KEY, None, NOV_1_2026).unwrap();
    let b = score_output("b.testnet", &bank("riya  good", 100, vec![]), &SEAL_KEY, None, NOV_1_2026).unwrap();
    let c = score_output("a.testnet", &bank("Max Cheater", 5000, max_txs(NOV_1_2026)), &SEAL_KEY, None, NOV_1_2026).unwrap();
    assert_eq!(a.output["fingerprint"], b.output["fingerprint"], "one bank identity, one fingerprint");
    assert_ne!(a.output["fingerprint"], c.output["fingerprint"]);
}

#[test]
fn missing_caller_or_name_is_an_error() {
    assert!(score_output("", &bank("Riya", 1, vec![]), &SEAL_KEY, None, NOV_1_2026).is_err());
    assert!(score_output("x.testnet", &bank("  ", 1, vec![]), &SEAL_KEY, None, NOV_1_2026).is_err());
}

#[test]
fn no_history_scores_band_d_zero_cap() {
    let s = score_output("x.testnet", &bank("New Person", 0, vec![]), &SEAL_KEY, None, NOV_1_2026).unwrap();
    assert_eq!(s.score.parts, Parts { income: 40, stability: 0, payment: 250, cash_flow: 0, buffer: 0 });
    assert_eq!(s.score.band, "D");
    assert_eq!(s.output["income_cap"], 0);
}

// --------------------------------------------------- release

#[test]
fn release_reseals_name_to_partner() {
    let partner = rand32().unwrap();
    let sealed = crypto::seal_identity(&SEAL_KEY, "Max Cheater").unwrap();
    let out = release_output(&SEAL_KEY, &sealed, &public_of(&partner)).unwrap();
    assert_eq!(out.as_object().unwrap().len(), 2);
    assert_eq!(out["v"], 1);
    let name = open_sealed(&partner, out["released"].as_str().unwrap()).unwrap();
    assert_eq!(name, b"Max Cheater");
    assert!(open_sealed(&rand32().unwrap(), out["released"].as_str().unwrap()).is_err());
    assert!(!out.to_string().contains("Max"));
    // Something not sealed with this SEAL_KEY can't be released.
    assert!(release_output(&[1u8; 32], &sealed, &public_of(&partner)).is_err());
}

// --------------------------------------------------- dates

#[test]
fn window_is_last_six_full_months() {
    assert_eq!(window(NOV_1_2026), ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    // 2027-02-15: wraps the year.
    assert_eq!(window(1_802_692_800), ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
    // 2028-02-29 (leap day) and 2000-03-01.
    assert_eq!(year_month(1_835_395_200), (2028, 2));
    assert_eq!(year_month(951_868_800), (2000, 3));
    assert_eq!(year_month(0), (1970, 1));
}

// --------------------------------------------------- input

const PROD: BuildFlags = BuildFlags { demo: false, debug: false };
const DEMO: BuildFlags = BuildFlags { demo: true, debug: false };
const DEBUG: BuildFlags = BuildFlags { demo: true, debug: true };
const PK: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn profile() -> Value {
    json!({
        "seed": "Riya Good", "roll_dates_forward": true,
        "override_accounts": [{
            "type": "depository", "subtype": "checking", "starting_balance": 6000,
            "identity": {"names": ["Riya Good"]},
            "transactions": [{"date_transacted": "2026-10-01", "date_posted": "2026-10-01",
                              "currency": "USD", "amount": -4000, "description": "ACME CORP PAYROLL"}],
        }],
    })
}

#[test]
fn parses_score_and_release_inputs() {
    let i = parse_input(&json!({"op":"score","public_token":"public-sandbox-abc","reply_pubkey":PK}).to_string(), PROD).unwrap();
    assert_eq!(i, Input::Score { source: Source::PublicToken("public-sandbox-abc".into()), reply_pubkey: Some([0xaa; 32]), debug: false });
    let i = parse_input(&json!({"op":"release","sealed":"AAAA","partner_pubkey":PK}).to_string(), PROD).unwrap();
    assert_eq!(i, Input::Release { sealed: "AAAA".into(), partner_pubkey: [0xaa; 32] });
}

#[test]
fn production_build_rejects_demo_profile_and_debug() {
    let p = json!({"op":"score","profile":profile()}).to_string();
    assert!(parse_input(&p, PROD).unwrap_err().contains("demo profiles are disabled"));
    assert!(parse_input(&p, DEMO).is_ok());

    let d = json!({"op":"score","public_token":"public-sandbox-abc","debug":true}).to_string();
    assert!(parse_input(&d, PROD).unwrap_err().contains("debug is disabled"));
    assert!(parse_input(&d, DEMO).unwrap_err().contains("debug is disabled"));
    assert!(matches!(parse_input(&d, DEBUG).unwrap(), Input::Score { debug: true, .. }));
}

/// `cargo test` without features = the production build: its real flags reject both.
#[cfg(not(any(feature = "demo", feature = "debug")))]
#[test]
fn production_build_flags_reject_demo_and_debug() {
    let p = json!({"op":"score","profile":profile()}).to_string();
    assert!(parse_input(&p, BUILD).is_err());
    let d = json!({"op":"score","public_token":"public-sandbox-abc","debug":true}).to_string();
    assert!(parse_input(&d, BUILD).is_err());
}

#[test]
fn rejects_bad_inputs() {
    for (bad, want) in [
        (json!({"op":"score"}), "exactly one"),
        (json!({"op":"score","public_token":"public-x","profile":{}}), "exactly one"),
        (json!({"op":"score","public_token":"access-sandbox-123"}), "invalid public_token"),
        (json!({"op":"score","public_token":""}), "invalid public_token"),
        (json!({"op":"score","public_token":"public-x","reply_pubkey":"beef"}), "reply_pubkey"),
        (json!({"op":"score","public_token":"public-x","caller":"evil.near"}), "unexpected field"),
        (json!({"op":"release","sealed":"AA","partner_pubkey":"00"}), "partner_pubkey"),
        (json!({"op":"steal"}), "op must be"),
        (json!([1, 2]), "object"),
    ] {
        let err = parse_input(&bad.to_string(), DEMO).unwrap_err();
        assert!(err.contains(want), "{bad}: {err}");
    }
    assert!(parse_input("not json", DEMO).is_err());
}

#[test]
fn profile_validation_ranges() {
    assert!(validate_profile(&profile()).is_ok());
    type Mutate = Box<dyn Fn(&mut Value)>;
    let cases: Vec<(&str, Mutate)> = vec![
        ("starting_balance", Box::new(|p| p["override_accounts"][0]["starting_balance"] = json!(30_001))),
        ("starting_balance", Box::new(|p| p["override_accounts"][0]["starting_balance"] = json!(-1))),
        ("amount", Box::new(|p| p["override_accounts"][0]["transactions"][0]["amount"] = json!(-8001))),
        ("description", Box::new(|p| p["override_accounts"][0]["transactions"][0]["description"] = json!("x".repeat(65)))),
        ("identity.names", Box::new(|p| p["override_accounts"][0]["identity"]["names"] = json!([]))),
        ("depository", Box::new(|p| p["override_accounts"][0]["type"] = json!("credit"))),
        ("exactly one account", Box::new(|p| { let a = p["override_accounts"][0].clone(); p["override_accounts"] = json!([a.clone(), a]); })),
        ("unexpected field", Box::new(|p| p["override_username"] = json!("user_good"))),
        ("1 to 200", Box::new(|p| p["override_accounts"][0]["transactions"] = json!([]))),
        ("date_posted", Box::new(|p| p["override_accounts"][0]["transactions"][0]["date_posted"] = json!("2026-10"))),
    ];
    for (want, f) in cases {
        let mut p = profile();
        f(&mut p);
        let err = validate_profile(&p).unwrap_err();
        assert!(err.contains(want), "expected {want}: {err}");
    }
}

// --------------------------------------------------- Plaid sync completion (observed Nov 1)

fn run_sync(pages: &[(bool, usize)]) -> (Vec<SyncStep>, u32) {
    let mut p = SyncProgress::default();
    let steps = pages.iter().map(|(complete, added)| p.checkpoint(*complete, *added)).collect();
    (steps, p.retries())
}

#[test]
fn sync_normal_initial_then_historical() {
    // 6 initial, then complete with the 24 historical.
    let (s, _) = run_sync(&[(false, 6), (true, 24)]);
    assert_eq!(s, [SyncStep::Poll, SyncStep::Done]);
}

#[test]
fn sync_complete_before_historical_batch_keeps_polling() {
    // The bug seen in 3 of 8 runs: complete with nothing new, history arrives one poll later.
    let (s, _) = run_sync(&[(false, 6), (true, 0), (true, 24)]);
    assert_eq!(s, [SyncStep::Poll, SyncStep::Poll, SyncStep::Done]);
    // Complete already on the first page with only the initial 6.
    let (s, _) = run_sync(&[(true, 6), (true, 24)]);
    assert_eq!(s, [SyncStep::Poll, SyncStep::Done]);
}

#[test]
fn sync_short_history_accepted_after_quiet_polls() {
    // Everything arrived at once (or the account is new): accept after 5 quiet polls.
    let pages: Vec<(bool, usize)> = std::iter::once((true, 30)).chain(std::iter::repeat_n((true, 0), 5)).collect();
    let (s, retries) = run_sync(&pages);
    assert_eq!(s.last(), Some(&SyncStep::Done));
    assert!(s[..s.len() - 1].iter().all(|x| *x == SyncStep::Poll));
    assert_eq!(retries, 5);
}

#[test]
fn sync_never_complete_fails_instead_of_scoring_partial_data() {
    let pages = vec![(false, 6); MAX_SYNC_RETRIES as usize + 1];
    let (s, retries) = run_sync(&pages);
    assert_eq!(s.last(), Some(&SyncStep::Fail));
    assert_eq!(retries, MAX_SYNC_RETRIES);
}

// --------------------------------------------------- SPEC 8c: identity scope per mode

/// Production / OutLayer mainnet: the same bank identity under two accounts gives the SAME
/// fingerprint, so the contract's rule 6 refuses the second account.
#[test]
fn mainnet_mode_same_bank_identity_same_fingerprint_for_any_account() {
    let b = bank("Alberta Bobbeth Charleson", 1000, riya_txs(NOV_1_2026));
    let a1 = score_output("judge1.near", &b, &SEAL_KEY, None, NOV_1_2026).unwrap();
    let a2 = score_output("judge2.near", &b, &SEAL_KEY, None, NOV_1_2026).unwrap();
    assert_eq!(a1.output["fingerprint"], a2.output["fingerprint"]);
}

/// Testnet / Dev builds: user_good's identity is scoped per account, so every judge gets their
/// own fingerprint, while one account keeps one stable fingerprint across re-scores.
#[test]
fn testnet_mode_scopes_sandbox_identity_per_account() {
    let scoped = |account: &str| {
        let b = scope_identity_to_account(bank("Alberta Bobbeth Charleson", 1000, riya_txs(NOV_1_2026)), account);
        score_output(account, &b, &SEAL_KEY, None, NOV_1_2026).unwrap()
    };
    let j1 = scoped("judge1.testnet");
    let j2 = scoped("judge2.testnet");
    assert_ne!(j1.output["fingerprint"], j2.output["fingerprint"], "two judges, two fingerprints");
    assert_eq!(j1.output["fingerprint"], scoped("judge1.testnet").output["fingerprint"], "stable per account");
    // The sealed name is the real one, not the scoped institution.
    assert_eq!(crypto::open_identity(&SEAL_KEY, j1.output["sealed_identity"].as_str().unwrap()).unwrap(), "Alberta Bobbeth Charleson");
    // Scoring itself is unchanged.
    let unscoped = score_output("judge1.testnet", &bank("Alberta Bobbeth Charleson", 1000, riya_txs(NOV_1_2026)), &SEAL_KEY, None, NOV_1_2026).unwrap();
    assert_eq!(j1.score, unscoped.score);
}

// --------------------------------------------------- testnet extras (demo builds)

#[test]
fn demo_extra_is_sealed_counts_only_and_ai_input_has_no_bank_data() {
    let bank = bank("Riya Good", 6000, riya_txs(NOV_1_2026));
    demo::note_sync(64);
    demo::note_accounts(2);
    let pk_secret = rand32().unwrap();
    let pk = public_of(&pk_secret);
    let scored = score_output("riya.testnet", &bank, &SEAL_KEY, Some(&pk), NOV_1_2026).unwrap();
    let before = scored.output.clone();
    let scored = demo::with_extra(scored, Some(&pk));
    // the on-chain fields are untouched; `extra` is added and sealed
    for k in ["v", "caller", "band", "score", "income_cap", "fingerprint", "sealed_identity", "reply"] {
        assert_eq!(scored.output[k].is_null(), before[k].is_null(), "{k}");
    }
    let opened = open_sealed(&pk_secret, scored.output["extra"].as_str().unwrap()).unwrap();
    let extra: Value = serde_json::from_slice(&opened).unwrap();
    assert_eq!(extra["receipt"]["plaid_transactions"], 64);
    assert_eq!(extra["receipt"]["plaid_accounts"], 2);
    assert_eq!(extra["receipt"]["months"], 6);
    assert!(extra["receipt"]["read_transactions"].as_u64().unwrap() > 0);
    assert!(extra.get("summary").is_none(), "no network in native tests");
    // what the AI would see: derived results only
    let req = demo::summary_request(&scored.score, &scored.features).to_string();
    assert!(req.contains("Band A") && req.contains("6 of the last 6 months"));
    for secret in [bank.owner_name.as_str(), bank.mask.as_str(), "Acme", "4000"] {
        assert!(!req.contains(secret), "AI input leaks {secret}");
    }
    assert!(req.contains("\"enable_thinking\":false") && req.contains("/no_think"));
}

#[test]
fn demo_summary_parsing() {
    let ok = serde_json::json!({ "choices": [{ "message": { "content": "<think>\n</think>\n\nYou were paid every month.  Keep fees at zero." } }] });
    assert_eq!(demo::parse_summary(&ok).unwrap(), "You were paid every month. Keep fees at zero.");
    let null = serde_json::json!({ "choices": [{ "message": { "content": null } }] });
    assert!(demo::parse_summary(&null).is_none());
    let long = serde_json::json!({ "choices": [{ "message": { "content": "a ".repeat(500) } }] });
    assert!(demo::parse_summary(&long).unwrap().len() <= 400);
}

#[test]
fn demo_history_covers_window_only_when_every_month_is_there() {
    let tx = |d: &str| serde_json::json!({ "date": d });
    // Nov 1 2026: window 2026-05 .. 2026-10
    let months = ["2026-05-03", "2026-06-03", "2026-07-03", "2026-08-03", "2026-09-03", "2026-10-03"];
    let full: Vec<_> = months.iter().map(|d| tx(d)).collect();
    assert!(sync_guard::covers_window_at(full.iter(), NOV_1_2026));
    // reaches back to May but a month is missing (caught mid-delivery, the live Riya C case)
    let gap: Vec<_> = months.iter().filter(|d| !d.starts_with("2026-08")).map(|d| tx(d)).collect();
    assert!(!sync_guard::covers_window_at(gap.iter(), NOV_1_2026));
    // the Nov 1 sandbox bug: only the last month delivered
    let recent_only = [tx("2026-10-05"), tx("2026-10-20")];
    assert!(!sync_guard::covers_window_at(recent_only.iter(), NOV_1_2026));
    assert!(!sync_guard::covers_window_at([].iter(), NOV_1_2026));
}
