//! Scores (SPEC 3, 4, 5 output, 6 bands, 7 rules 1-6).
//!
//! Scores enter the contract in exactly two places:
//! - `on_score`: the `#[private]` callback of the contract's own OutLayer request (OutLayer mode).
//! - `dev_submit_score`: the configured `dev_scorer`, Dev mode only.
//!
//! Both run the same parser and the same acceptance rules.

use crate::*;
use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::STANDARD as B64;
use near_sdk::serde_json::{Map, Value};
use near_sdk::PromiseError;

pub const USDC: u128 = 1_000_000;
/// Limit by level 1..=4, in USDC base units (SPEC 4).
pub const LEVEL_CAP: [u128; 4] = [100 * USDC, 250 * USDC, 500 * USDC, 1_000 * USDC];
pub const MAX_LEVEL: u8 = 4;
/// The scorer caps `income_cap` at $1,000 (SPEC 5).
pub const MAX_INCOME_CAP: u128 = 1_000 * USDC;
pub const MAX_SCORE: u16 = 1_000;
/// A sealed 25-character name is about 73 bytes; leave room, but bound storage.
pub const MAX_SEALED_BYTES: usize = 256;
pub const MAX_PUBLIC_TOKEN_LEN: usize = 256;

/// OutLayer fee deposit (SPEC 4).
pub const MIN_SCORE_DEPOSIT: NearToken = NearToken::from_millinear(10);
const GAS_REQUEST_EXECUTION: Gas = Gas::from_tgas(100);
const GAS_ON_SCORE: Gas = Gas::from_tgas(30);
const MAX_INSTRUCTIONS: u64 = 1_000_000_000;
const MAX_MEMORY_MB: u32 = 128;
const MAX_EXECUTION_SECONDS: u32 = 30;

/// Output keys the scorer may emit. Anything else is rejected (SPEC 5 / CLAUDE.md scorer rules).
const OUTPUT_KEYS: [&str; 8] = [
    "v", "caller", "band", "score", "income_cap", "fingerprint", "sealed_identity", "reply",
];

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Band {
    A,
    B,
    C,
    D,
}

impl Band {
    /// Share of the level cap a band may borrow, in bps (SPEC 4 `BAND_PCT`).
    pub fn pct_bps(self) -> u128 {
        match self {
            Band::A => 10_000,
            Band::B => 7_500,
            Band::C => 5_000,
            Band::D => 0,
        }
    }

    /// SPEC 6: A >= 800, B 650-799, C 500-649, D < 500.
    pub fn for_score(score: u16) -> Band {
        match score {
            800.. => Band::A,
            650..=799 => Band::B,
            500..=649 => Band::C,
            _ => Band::D,
        }
    }

    pub fn index(self) -> usize {
        self as usize
    }

    fn parse(s: &str) -> Option<Band> {
        match s {
            "A" => Some(Band::A),
            "B" => Some(Band::B),
            "C" => Some(Band::C),
            "D" => Some(Band::D),
            _ => None,
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScoreRecord {
    pub band: Band,
    pub score: u16,
    pub income_cap: u128,
    pub fingerprint: [u8; 32],
    pub issued_at: u64,
    pub expires_at: u64,
    pub scorer_version: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoanState {
    Active,
    Repaid,
    Defaulted,
}

/// Loan record (written on day 3; defined now so the borrower layout is final).
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Loan {
    pub principal: u128,
    pub interest: u128,
    pub limit_at_borrow: u128,
    pub band: Band,
    pub issued_at: u64,
    pub due_at: u64,
    pub state: LoanState,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Borrower {
    pub level: u8,
    pub last_level_up: u64,
    pub score: Option<ScoreRecord>,
    pub loan: Option<Loan>,
    pub pending_request: bool,
    pub defaults: u32,
    pub blocked: bool,
    /// Owner name sealed with SEAL_KEY inside the TEE. Never returned by any view (rule 9).
    pub sealed_identity: Option<Vec<u8>>,
    /// Name re-encrypted to the partner key after a default.
    pub released_identity: Option<Vec<u8>>,
}

impl Borrower {
    pub fn new() -> Self {
        Self {
            level: 1,
            last_level_up: 0,
            score: None,
            loan: None,
            pending_request: false,
            defaults: 0,
            blocked: false,
            sealed_identity: None,
            released_identity: None,
        }
    }

    pub fn has_active_loan(&self) -> bool {
        matches!(&self.loan, Some(l) if l.state == LoanState::Active)
    }
}

impl Default for Borrower {
    fn default() -> Self {
        Self::new()
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BandStats {
    pub scored: u64,
    pub loans_issued: u64,
    pub repaid: u64,
    pub defaulted: u64,
    /// Total principal lent, USDC base units.
    pub volume: U128,
}

/// Parsed, validated scorer output.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScorerOutput {
    pub caller: AccountId,
    pub band: Band,
    pub score: u16,
    pub income_cap: u128,
    pub fingerprint: [u8; 32],
    pub sealed_identity: Vec<u8>,
}

// ------------------------------------------------------------------ views

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScoreView {
    pub band: Band,
    pub score: u16,
    pub income_cap: U128,
    pub fingerprint: String,
    pub issued_at: U64,
    pub expires_at: U64,
    pub scorer_version: String,
    pub expired: bool,
}

/// Public borrower view. Has no `sealed_identity` field at all (rule 9).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BorrowerView {
    pub level: u8,
    pub last_level_up: U64,
    pub score: Option<ScoreView>,
    pub pending_request: bool,
    pub defaults: u32,
    pub blocked: bool,
    pub has_active_loan: bool,
    /// Current or last loan.
    pub loan: Option<LoanView>,
    /// Base64, encrypted to the partner key.
    pub released_identity: Option<String>,
    pub limit: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatsView {
    #[serde(rename = "A")]
    pub a: BandStats,
    #[serde(rename = "B")]
    pub b: BandStats,
    #[serde(rename = "C")]
    pub c: BandStats,
    #[serde(rename = "D")]
    pub d: BandStats,
}

#[ext_contract(ext_outlayer)]
#[allow(dead_code)]
pub trait OutLayer {
    #[allow(clippy::too_many_arguments)]
    fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Value,
        input_data: String,
        secrets_ref: Option<Value>,
        response_format: String,
        payer_account_id: Option<AccountId>,
        params: Option<Value>,
    );
}

// ------------------------------------------------------------------ contract methods

#[near]
impl Contract {
    /// Ask the pinned scorer (inside OutLayer's TEE) to score the caller's bank data.
    /// OutLayer mode only. Must be signed by the borrower directly, so OutLayer's
    /// `NEAR_SENDER_ID` is the borrower (rule 3).
    #[payable]
    pub fn request_score(&mut self, public_token: String, reply_pubkey: String) -> Promise {
        require!(
            self.config.scorer_mode == ScorerMode::OutLayer,
            "request_score is disabled in Dev mode; use dev_submit_score"
        );
        let borrower = env::predecessor_account_id();
        require!(
            env::signer_account_id() == borrower,
            "request_score must be signed by the borrower directly"
        );
        let deposit = env::attached_deposit();
        require!(
            deposit >= MIN_SCORE_DEPOSIT,
            "Attach at least 0.01 NEAR for the OutLayer fee"
        );
        require!(
            !public_token.is_empty() && public_token.len() <= MAX_PUBLIC_TOKEN_LEN,
            "Invalid public_token"
        );
        require!(
            hex_decode(&reply_pubkey).is_some_and(|k| k.len() == 32),
            "reply_pubkey must be 32 bytes of hex"
        );

        let mut b = self.borrower_or_new(&borrower);
        self.require_can_score(&b);
        b.pending_request = true;
        self.borrowers.insert(borrower.clone(), b);

        let c = &self.config;
        let input = json!({
            "op": "score",
            "public_token": public_token,
            "reply_pubkey": reply_pubkey,
        })
        .to_string();
        let secrets_ref = json!({ "profile": c.secrets_profile, "account_id": c.secrets_account });

        ext_outlayer::ext(c.outlayer.clone())
            .with_attached_deposit(deposit)
            .with_static_gas(GAS_REQUEST_EXECUTION)
            // payer_account_id = borrower: OutLayer sends the unused deposit straight back
            // to the borrower instead of to this contract (SPEC 4, checked on mainnet day 6).
            .request_execution(
                outlayer_source(c),
                outlayer_limits(),
                input,
                Some(secrets_ref),
                "Json".into(),
                Some(borrower.clone()),
                None,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_SCORE)
                    .on_score(borrower),
            )
    }

    /// OutLayer's answer. `#[private]`: only this contract's own request can land here (rule 1).
    /// Never panics after reading the borrower: a panic would undo clearing `pending_request`.
    /// Any failure only clears `pending_request` and emits `score_failed` (rule 4).
    #[private]
    pub fn on_score(
        &mut self,
        borrower: AccountId,
        #[callback_result] result: Result<Option<Value>, PromiseError>,
    ) -> bool {
        let mut b = self.borrower_or_new(&borrower);
        b.pending_request = false;
        self.borrowers.insert(borrower.clone(), b);

        let accepted = match result {
            Err(_) => Err("OutLayer execution failed".to_string()),
            Ok(None) => Err("OutLayer returned null".to_string()),
            Ok(Some(v)) => unwrap_outlayer_result(v)
                .and_then(|o| parse_output(&o))
                .and_then(|o| self.accept_score(&borrower, o)),
        };
        match accepted {
            Ok(()) => true,
            Err(reason) => {
                events::emit("score_failed", json!({ "borrower": borrower, "reason": reason }));
                false
            }
        }
    }

    /// Dev mode only: the configured `dev_scorer` submits the scorer's JSON output
    /// (the same scorer WASM, run locally with wasmtime). Panics in OutLayer mode.
    pub fn dev_submit_score(&mut self, borrower: AccountId, output: Value) {
        require!(
            self.config.scorer_mode == ScorerMode::Dev,
            "dev_submit_score is disabled in OutLayer mode"
        );
        require!(
            Some(env::predecessor_account_id()) == self.config.dev_scorer,
            "Only the dev_scorer can submit scores"
        );
        let b = self.borrower_or_new(&borrower);
        self.require_can_score(&b);
        let out = parse_output(&output).unwrap_or_else(|e| env::panic_str(&e));
        self.accept_score(&borrower, out)
            .unwrap_or_else(|e| env::panic_str(&e));
    }

    /// Owner: pin a new scorer version (WASM SHA-256). Public on-chain with an event (rule 2).
    #[payable]
    pub fn set_scorer_version(&mut self, version: String) {
        assert_one_yocto();
        require!(
            env::predecessor_account_id() == self.config.owner,
            "Only the owner can change the scorer version"
        );
        require!(is_sha256_hex(&version), "scorer_version must be a 64-char lowercase hex SHA-256");
        let old = std::mem::replace(&mut self.config.scorer_version, version.clone());
        events::emit(
            "scorer_version_changed",
            json!({ "old": old, "new": version, "by": env::predecessor_account_id() }),
        );
    }

    // -------------------------------------------------------------- views

    /// What `account_id` may borrow right now, in USDC base units. Zero without a valid score.
    pub fn get_limit(&self, account_id: AccountId) -> U128 {
        U128(
            self.borrowers
                .get(&account_id)
                .map(|b| self.limit_of(b))
                .unwrap_or(0),
        )
    }

    pub fn get_borrower(&self, account_id: AccountId) -> Option<BorrowerView> {
        let b = self.borrowers.get(&account_id)?;
        let now = env::block_timestamp();
        Some(BorrowerView {
            level: b.level,
            last_level_up: U64(b.last_level_up),
            score: b.score.as_ref().map(|s| ScoreView {
                band: s.band,
                score: s.score,
                income_cap: U128(s.income_cap),
                fingerprint: hex_encode(&s.fingerprint),
                issued_at: U64(s.issued_at),
                expires_at: U64(s.expires_at),
                scorer_version: s.scorer_version.clone(),
                expired: now >= s.expires_at,
            }),
            pending_request: b.pending_request,
            defaults: b.defaults,
            blocked: b.blocked,
            has_active_loan: b.has_active_loan(),
            loan: b.loan.as_ref().map(LoanView::from),
            released_identity: b.released_identity.as_ref().map(|r| B64.encode(r)),
            limit: U128(self.limit_of(b)),
        })
    }

    pub fn get_stats(&self) -> StatsView {
        let [a, b, c, d] = self.stats.clone();
        StatsView { a, b, c, d }
    }
}

// ------------------------------------------------------------------ internal

impl Contract {
    pub(crate) fn borrower_or_new(&self, id: &AccountId) -> Borrower {
        self.borrowers.get(id).cloned().unwrap_or_default()
    }

    fn require_can_score(&self, b: &Borrower) {
        require!(!b.blocked, "Borrower is blocked after a default");
        require!(!b.pending_request, "A score request is already pending");
        require!(!b.has_active_loan(), "Repay the active loan before a new score");
    }

    /// Acceptance rules shared by both entry points. Returns Err instead of panicking so
    /// `on_score` can record the failure without reverting `pending_request`.
    pub(crate) fn accept_score(&mut self, borrower: &AccountId, out: ScorerOutput) -> Result<(), String> {
        if out.caller != *borrower {
            return Err(format!("Output caller {} is not the borrower", out.caller));
        }
        if let Some(owner) = self.fingerprints.get(&out.fingerprint)
            && owner != borrower
        {
            return Err("This bank identity is already used by another borrower".into());
        }
        let mut b = self.borrower_or_new(borrower);
        if b.blocked {
            return Err("Borrower is blocked after a default".into());
        }
        let now = env::block_timestamp();
        let expires_at = now
            .checked_add(self.config.score_ttl_ns)
            .unwrap_or_else(|| env::panic_str("Math overflow"));
        let record = ScoreRecord {
            band: out.band,
            score: out.score,
            income_cap: out.income_cap,
            fingerprint: out.fingerprint,
            issued_at: now,
            expires_at,
            scorer_version: self.config.scorer_version.clone(),
        };
        b.score = Some(record);
        b.sealed_identity = Some(out.sealed_identity);
        self.borrowers.insert(borrower.clone(), b);
        self.fingerprints.insert(out.fingerprint, borrower.clone());
        self.stats[out.band.index()].scored += 1;
        events::emit(
            "score_issued",
            json!({
                "borrower": borrower,
                "band": out.band,
                "score": out.score,
                "income_cap": U128(out.income_cap),
                "expires_at": U64(expires_at),
                "scorer_version": self.config.scorer_version,
            }),
        );
        Ok(())
    }

    /// SPEC 4: `min(LEVEL_CAP[level] * BAND_PCT[band], income_cap)`; zero if blocked,
    /// unscored or expired (rule 5).
    pub(crate) fn limit_of(&self, b: &Borrower) -> u128 {
        if b.blocked {
            return 0;
        }
        let Some(s) = &b.score else { return 0 };
        if env::block_timestamp() >= s.expires_at {
            return 0;
        }
        let level = b.level.clamp(1, MAX_LEVEL) as usize;
        let cap = math::mul_div(LEVEL_CAP[level - 1], s.band.pct_bps(), 10_000);
        cap.min(s.income_cap)
    }
}

/// Every OutLayer request pins the scorer version (rule 2).
pub fn outlayer_source(c: &Config) -> Value {
    json!({ "Project": { "project_id": c.scorer_project, "version_key": c.scorer_version } })
}

pub fn outlayer_limits() -> Value {
    json!({
        "max_instructions": MAX_INSTRUCTIONS,
        "max_memory_mb": MAX_MEMORY_MB,
        "max_execution_seconds": MAX_EXECUTION_SECONDS,
    })
}

// ------------------------------------------------------------------ parsing

/// OutLayer's success payload is the scorer's stdout parsed as JSON. The exact envelope on
/// mainnet is confirmed on day 6, so accept the raw output object, a JSON string holding it,
/// or a wrapper `{ "output": ... }`. A wrapper with `"success": false` is a failure.
pub fn unwrap_outlayer_result(v: Value) -> Result<Value, String> {
    fn step(v: Value, depth: u8) -> Result<Value, String> {
        if depth > 2 {
            return Err("Unrecognised OutLayer result".into());
        }
        match v {
            Value::String(s) => near_sdk::serde_json::from_str::<Value>(&s)
                .map_err(|_| "OutLayer output is not JSON".to_string())
                .and_then(|inner| step(inner, depth + 1)),
            Value::Object(ref m) if m.contains_key("v") => Ok(v),
            Value::Object(mut m) => {
                if m.get("success") == Some(&Value::Bool(false)) {
                    let err = m.get("error").map(|e| e.to_string()).unwrap_or_default();
                    return Err(format!("Scorer run failed {err}").trim().to_string());
                }
                match m.remove("output") {
                    Some(o) => step(o, depth + 1),
                    None => Err("Unrecognised OutLayer result".into()),
                }
            }
            _ => Err("Unrecognised OutLayer result".into()),
        }
    }
    step(v, 0)
}

/// Strict parser for the scorer output (SPEC 5).
pub fn parse_output(v: &Value) -> Result<ScorerOutput, String> {
    let m: &Map<String, Value> = v.as_object().ok_or("Scorer output must be a JSON object")?;
    if let Some(k) = m.keys().find(|k| !OUTPUT_KEYS.contains(&k.as_str())) {
        return Err(format!("Unexpected field in scorer output: {k}"));
    }
    if m.get("v").and_then(Value::as_u64) != Some(1) {
        return Err("Unsupported scorer output version".into());
    }
    let caller: AccountId = m
        .get("caller")
        .and_then(Value::as_str)
        .and_then(|s| s.parse().ok())
        .ok_or("Missing or invalid caller")?;
    let band = m
        .get("band")
        .and_then(Value::as_str)
        .and_then(Band::parse)
        .ok_or("Missing or invalid band")?;
    let score = m
        .get("score")
        .and_then(Value::as_u64)
        .filter(|s| *s <= MAX_SCORE as u64)
        .ok_or("Missing or invalid score")? as u16;
    if Band::for_score(score) != band {
        return Err("Band does not match score".into());
    }
    let income_cap = match m.get("income_cap") {
        Some(Value::Number(n)) => n.as_u64().map(u128::from),
        Some(Value::String(s)) => s.parse::<u128>().ok(),
        _ => None,
    }
    .filter(|c| *c <= MAX_INCOME_CAP)
    .ok_or("Missing or invalid income_cap")?;
    let fingerprint: [u8; 32] = m
        .get("fingerprint")
        .and_then(Value::as_str)
        .and_then(hex_decode)
        .and_then(|v| v.try_into().ok())
        .ok_or("Missing or invalid fingerprint")?;
    let sealed_identity = m
        .get("sealed_identity")
        .and_then(Value::as_str)
        .and_then(|s| B64.decode(s).ok())
        .filter(|v| !v.is_empty() && v.len() <= MAX_SEALED_BYTES)
        .ok_or("Missing or invalid sealed_identity")?;
    if m.get("reply").is_some_and(|r| !r.is_string()) {
        return Err("Invalid reply".into());
    }
    Ok(ScorerOutput { caller, band, score, income_cap, fingerprint, sealed_identity })
}

pub fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

