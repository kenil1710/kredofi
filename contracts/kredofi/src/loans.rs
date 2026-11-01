//! Loans, repayment, defaults and identity release (SPEC 4, 4a; rules 7, 11, 12, 13).

use crate::*;
use near_sdk::PromiseError;
use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::STANDARD as B64;
use near_sdk::serde_json::Value;

pub const MSG_REPAY: &str = "repay";
const BPS: u128 = 10_000;
const GAS_ON_BORROW: Gas = Gas::from_tgas(15);
const GAS_REQUEST_RELEASE: Gas = Gas::from_tgas(100);
const GAS_ON_RELEASE: Gas = Gas::from_tgas(20);
const MAX_RELEASED_BYTES: usize = 256;

impl Band {
    /// Flat interest per loan term (SPEC 4): A 2%, B 3%, C 4%. D never borrows.
    pub fn interest_bps(self) -> u128 {
        match self {
            Band::A => 200,
            Band::B => 300,
            Band::C => 400,
            Band::D => 0,
        }
    }
}

/// JSON form of `Loan` (views and the borrow rollback callback).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoanView {
    pub principal: U128,
    pub interest: U128,
    pub limit_at_borrow: U128,
    pub band: Band,
    pub issued_at: U64,
    pub due_at: U64,
    pub state: LoanState,
}

impl From<&Loan> for LoanView {
    fn from(l: &Loan) -> Self {
        Self {
            principal: U128(l.principal),
            interest: U128(l.interest),
            limit_at_borrow: U128(l.limit_at_borrow),
            band: l.band,
            issued_at: U64(l.issued_at),
            due_at: U64(l.due_at),
            state: l.state,
        }
    }
}

impl From<LoanView> for Loan {
    fn from(v: LoanView) -> Self {
        Self {
            principal: v.principal.0,
            interest: v.interest.0,
            limit_at_borrow: v.limit_at_borrow.0,
            band: v.band,
            issued_at: v.issued_at.0,
            due_at: v.due_at.0,
            state: v.state,
        }
    }
}

#[near]
impl Contract {
    /// Borrow `amount` USDC (base units). Requires 1 yoctoNEAR (full-access key).
    #[payable]
    pub fn borrow(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        let borrower = env::predecessor_account_id();
        let amount = amount.0;
        require!(amount > 0, "Amount must be positive");

        let mut b = self.borrower_or_new(&borrower);
        require!(!b.blocked, "Borrower is blocked after a default");
        require!(!b.has_active_loan(), "Repay the active loan first");
        require!(!b.pending_request, "A score request is pending");
        let score = b.score.clone().unwrap_or_else(|| env::panic_str("No score yet"));
        require!(env::block_timestamp() < score.expires_at, "Score expired; get a new score");
        require!(score.band != Band::D, "Band D cannot borrow");

        let limit = self.limit_of(&b);
        require!(amount <= limit, "Amount is above your limit");
        require!(amount <= self.pool.cash, "Not enough cash in the pool");
        let max_share = math::mul_div(
            self.pool.value(),
            self.config.max_borrower_share_bps as u128,
            BPS,
        );
        require!(amount <= max_share, "Amount is above 10% of pool value");

        let now = env::block_timestamp();
        let loan = Loan {
            principal: amount,
            interest: ceil_bps(amount, score.band.interest_bps()),
            limit_at_borrow: limit,
            band: score.band,
            issued_at: now,
            due_at: now
                .checked_add(self.config.loan_term_ns)
                .unwrap_or_else(|| env::panic_str("Math overflow")),
            state: LoanState::Active,
        };

        // State first (rule 7).
        let prev = b.loan.replace(loan).as_ref().map(LoanView::from);
        self.borrowers.insert(borrower.clone(), b);
        self.pool.cash = math::sub(self.pool.cash, amount);
        self.pool.outstanding = math::add(self.pool.outstanding, amount);
        let s = &mut self.stats[score.band.index()];
        s.loans_issued += 1;
        s.volume = U128(math::add(s.volume.0, amount));

        ext_ft::ext(self.config.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(borrower.clone(), U128(amount), Some("KredoFi loan".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_BORROW)
                    .on_borrow_transfer(borrower, U128(amount), prev),
            )
    }

    /// Rollback callback for `borrow`. On failure restores the previous loan record, pool
    /// cash/outstanding and stats. (A borrower whose transfer failed is not registered with
    /// the token, so they cannot repay in between.)
    #[private]
    pub fn on_borrow_transfer(&mut self, borrower: AccountId, amount: U128, prev: Option<LoanView>) -> bool {
        let mut b = self.borrower_or_new(&borrower);
        let loan = b.loan.clone().unwrap_or_else(|| env::panic_str("Missing loan"));
        if near_sdk::is_promise_success() {
            events::emit(
                "loan_issued",
                json!({
                    "borrower": borrower,
                    "principal": U128(loan.principal),
                    "interest": U128(loan.interest),
                    "band": loan.band,
                    "level": b.level,
                    "due_at": U64(loan.due_at),
                }),
            );
            return true;
        }
        b.loan = prev.map(Loan::from);
        self.borrowers.insert(borrower.clone(), b);
        self.pool.cash = math::add(self.pool.cash, amount.0);
        self.pool.outstanding = math::sub(self.pool.outstanding, amount.0);
        let s = &mut self.stats[loan.band.index()];
        s.loans_issued -= 1;
        s.volume = U128(math::sub(s.volume.0, amount.0));
        env::log_str(&format!("Loan transfer to {borrower} failed; loan undone"));
        false
    }

    /// Anyone may mark an Active loan as defaulted once `now > due_at + grace_ns`.
    /// The reserve covers the loss first; lenders lose only what it can't cover.
    pub fn mark_default(&mut self, borrower: AccountId) {
        let mut b = self.borrowers.get(&borrower).cloned().unwrap_or_else(|| env::panic_str("Unknown borrower"));
        require!(b.has_active_loan(), "No active loan");
        let mut loan = b.loan.clone().unwrap();
        let deadline = loan
            .due_at
            .checked_add(self.config.grace_ns)
            .unwrap_or_else(|| env::panic_str("Math overflow"));
        require!(env::block_timestamp() > deadline, "Loan is not past due date plus grace");

        let principal = loan.principal;
        let covered = principal.min(self.pool.reserve);
        self.pool.reserve = math::sub(self.pool.reserve, covered);
        self.pool.cash = math::add(self.pool.cash, covered);
        self.pool.outstanding = math::sub(self.pool.outstanding, principal);

        loan.state = LoanState::Defaulted;
        let band = loan.band;
        b.loan = Some(loan);
        b.blocked = true;
        b.defaults += 1;
        self.borrowers.insert(borrower.clone(), b);
        self.stats[band.index()].defaulted += 1;

        events::emit(
            "loan_defaulted",
            json!({
                "borrower": borrower,
                "principal": U128(principal),
                "covered_by_reserve": U128(covered),
                "lender_loss": U128(principal - covered),
                "by": env::predecessor_account_id(),
            }),
        );
    }

    /// Start the identity release for a defaulted borrower (once).
    /// OutLayer mode: asks the scorer to re-encrypt the sealed name to the partner key; the
    /// caller attaches the OutLayer fee and gets the unused part back.
    /// Dev mode: marks the release as requested; `dev_scorer` then calls `dev_submit_release`.
    #[payable]
    pub fn request_identity_release(&mut self, borrower: AccountId) -> PromiseOrValue<()> {
        let mut b = self.borrowers.get(&borrower).cloned().unwrap_or_else(|| env::panic_str("Unknown borrower"));
        require!(Self::release_allowed(&b), "Release is only allowed once, after a recorded default");
        require!(!b.pending_request, "A release is already pending");
        b.pending_request = true;
        let sealed = B64.encode(b.sealed_identity.as_ref().unwrap());
        self.borrowers.insert(borrower.clone(), b);

        if self.config.scorer_mode == ScorerMode::Dev {
            env::log_str(&format!("Identity release requested for {borrower}; waiting for dev_scorer"));
            return PromiseOrValue::Value(());
        }
        let caller = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        require!(deposit >= MIN_SCORE_DEPOSIT, "Attach at least 0.01 NEAR for the OutLayer fee");
        let c = &self.config;
        let input = json!({
            "op": "release",
            "sealed": sealed,
            "partner_pubkey": hex_encode(&c.partner_pubkey),
        })
        .to_string();
        PromiseOrValue::Promise(
            ext_outlayer::ext(c.outlayer.clone())
                .with_attached_deposit(deposit)
                .with_static_gas(GAS_REQUEST_RELEASE)
                .request_execution(
                    outlayer_source(c),
                    outlayer_limits(),
                    input,
                    Some(json!({ "profile": c.secrets_profile, "account_id": c.secrets_account })),
                    "Json".into(),
                    Some(caller),
                    None,
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_ON_RELEASE)
                        .on_release(borrower),
                ),
        )
    }

    /// OutLayer answer for a release. Never panics after clearing the pending flag.
    #[private]
    pub fn on_release(
        &mut self,
        borrower: AccountId,
        #[callback_result] result: Result<Option<Value>, PromiseError>,
    ) -> bool {
        let parsed = match result {
            Err(_) => Err("OutLayer execution failed".to_string()),
            Ok(None) => Err("OutLayer returned null".to_string()),
            Ok(Some(v)) => unwrap_outlayer_result(v).and_then(|o| parse_release(&o)),
        };
        match parsed {
            Ok(released) => {
                self.store_release(&borrower, released);
                true
            }
            Err(reason) => {
                let mut b = self.borrower_or_new(&borrower);
                b.pending_request = false;
                self.borrowers.insert(borrower.clone(), b);
                env::log_str(&format!("Identity release for {borrower} failed: {reason}"));
                false
            }
        }
    }

    /// Dev mode: `dev_scorer` submits the release output `{"v":1,"released":"<base64>"}`.
    pub fn dev_submit_release(&mut self, borrower: AccountId, output: Value) {
        require!(
            self.config.scorer_mode == ScorerMode::Dev,
            "dev_submit_release is disabled in OutLayer mode"
        );
        require!(
            Some(env::predecessor_account_id()) == self.config.dev_scorer,
            "Only the dev_scorer can submit a release"
        );
        let b = self.borrowers.get(&borrower).unwrap_or_else(|| env::panic_str("Unknown borrower"));
        require!(
            b.pending_request && Self::release_allowed(b),
            "No identity release was requested for this borrower"
        );
        let released = parse_release(&output).unwrap_or_else(|e| env::panic_str(&e));
        self.store_release(&borrower, released);
    }

    pub fn is_release_allowed(&self, account_id: AccountId) -> bool {
        self.borrowers.get(&account_id).is_some_and(Self::release_allowed)
    }
}

impl Contract {
    /// `msg: "repay"`: full repayment only (`amount == principal + interest`).
    pub(crate) fn internal_repay(&mut self, borrower: AccountId, amount: u128) {
        let mut b = self.borrowers.get(&borrower).cloned().unwrap_or_else(|| env::panic_str("No active loan"));
        require!(b.has_active_loan(), "No active loan");
        let mut loan = b.loan.clone().unwrap();
        let due = math::add(loan.principal, loan.interest);
        require!(amount == due, format!("Repay exactly {due} (principal + interest)"));

        let to_reserve = math::mul_div(loan.interest, self.config.reserve_share_bps as u128, BPS);
        let to_pool = math::sub(loan.interest, to_reserve);
        self.pool.outstanding = math::sub(self.pool.outstanding, loan.principal);
        self.pool.cash = math::add(self.pool.cash, math::add(loan.principal, to_pool));
        self.pool.reserve = math::add(self.pool.reserve, to_reserve);

        // Level up only if all three hold (rule 13).
        let now = env::block_timestamp();
        let held_long_enough = now.saturating_sub(loan.issued_at) >= self.config.min_hold_ns;
        let big_enough = math::add(loan.principal, loan.principal) >= loan.limit_at_borrow;
        // `last_level_up == 0` means never leveled up: no previous level-up to wait for.
        let not_too_soon = b.last_level_up == 0
            || now.saturating_sub(b.last_level_up) >= self.config.loan_term_ns;
        let leveled_up = held_long_enough && big_enough && not_too_soon && b.level < MAX_LEVEL;
        if leveled_up {
            b.level += 1;
            b.last_level_up = now;
        }

        loan.state = LoanState::Repaid;
        let band = loan.band;
        let principal = loan.principal;
        let interest = loan.interest;
        b.loan = Some(loan);
        let level = b.level;
        self.borrowers.insert(borrower.clone(), b);
        self.stats[band.index()].repaid += 1;

        events::emit(
            "loan_repaid",
            json!({
                "borrower": borrower,
                "principal": U128(principal),
                "interest": U128(interest),
                "to_reserve": U128(to_reserve),
                "to_pool": U128(to_pool),
                "level": level,
                "leveled_up": leveled_up,
            }),
        );
    }

    fn release_allowed(b: &Borrower) -> bool {
        matches!(&b.loan, Some(l) if l.state == LoanState::Defaulted)
            && b.sealed_identity.is_some()
            && b.released_identity.is_none()
    }

    fn store_release(&mut self, borrower: &AccountId, released: Vec<u8>) {
        let mut b = self.borrower_or_new(borrower);
        b.pending_request = false;
        b.released_identity = Some(released);
        self.borrowers.insert(borrower.clone(), b);
        events::emit(
            "identity_released",
            json!({
                "borrower": borrower,
                "partner_pubkey": hex_encode(&self.config.partner_pubkey),
            }),
        );
    }
}

/// `ceil(amount * bps / 10000)`: rounding goes to lenders, never to the borrower.
pub fn ceil_bps(amount: u128, bps: u128) -> u128 {
    let num = amount
        .checked_mul(bps)
        .unwrap_or_else(|| env::panic_str("Math overflow"));
    num.div_ceil(BPS)
}

/// Release output: `{"v":1,"released":"<base64>"}` (SPEC 5 release step).
pub fn parse_release(v: &Value) -> Result<Vec<u8>, String> {
    let m = v.as_object().ok_or("Release output must be a JSON object")?;
    if let Some(k) = m.keys().find(|k| !["v", "released"].contains(&k.as_str())) {
        return Err(format!("Unexpected field in release output: {k}"));
    }
    if m.get("v").and_then(Value::as_u64) != Some(1) {
        return Err("Unsupported release output version".into());
    }
    m.get("released")
        .and_then(Value::as_str)
        .and_then(|s| B64.decode(s).ok())
        .filter(|r| !r.is_empty() && r.len() <= MAX_RELEASED_BYTES)
        .ok_or_else(|| "Missing or invalid released".into())
}
