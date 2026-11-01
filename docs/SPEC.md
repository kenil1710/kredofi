# KredoFi Specification

KredoFi lets a borrower get a small stablecoin loan without collateral by proving income privately. Bank data is read inside a TEE (OutLayer), scored by fixed open rules, and only the result reaches the NEAR contract. The contract accepts a score only from its own request to a pinned code version.

This file is the source of truth for what gets built in the hackathon (Nov 1-14, 2026). Every number here is a starting value that can be tuned, but every rule must exist in code and tests.

---

## 1. Components

| Folder | What | Language / target |
|---|---|---|
| `contracts/kredofi` | Lending pool, score registry, loans, defaults, reserve, treasury | Rust, `near-sdk` 5.x, `cargo near` |
| `contracts/mock-usdc` | 6-decimal NEP-141 token for local and testnet only | Rust |
| `scorer` | TEE program: Plaid fetch, features, score, sealed identity | Rust, `wasm32-wasip2`, OutLayer project |
| `web` | Borrower page, lender page, public dashboard | Next.js (see `DESIGN.md`) |
| `scripts` | Test borrower generator, deploy, demo, verify | Python / shell |
| `tests` | Contract integration tests | Rust, `near-workspaces` |
| `docs` | `SPEC.md`, `DESIGN.md`, `VERIFY.md`, `THREAT_MODEL.md` | Markdown |

---

## 2. Networks and modes

OutLayer testnet workers did not respond during prep (Oct 24-25); mainnet worked. A contract can only call OutLayer on its own network.

| Where | Scorer mode | Token | Used for |
|---|---|---|---|
| Local (`near-workspaces`) | `Dev` | mock USDC | All contract tests |
| NEAR testnet | `Dev` | mock USDC | Lending, repay, default flows in the web app |
| NEAR mainnet | `OutLayer` | real USDC (tiny amounts) | The connected flow: contract to OutLayer to callback, shown in the demo |

**Dev mode:** the contract has `scorer_mode: Dev | OutLayer`. In `Dev`, one configured `dev_scorer` account may call `dev_submit_score` with the same output format the TEE produces (the scorer WASM run locally with `wasmtime`). In `OutLayer` mode, `dev_submit_score` always panics. The README states which deployment uses which mode. Never hide this.

If OutLayer testnet workers come back, testnet can switch to `OutLayer` mode with no code change.

---

## 3. Contract state

```text
config:
  owner: AccountId
  usdc: AccountId                     // NEP-141 token contract, 6 decimals
  scorer_mode: Dev | OutLayer
  dev_scorer: Option<AccountId>
  outlayer: AccountId                 // outlayer.near / outlayer.testnet
  scorer_project: String              // "<owner>/kredofi-scorer"
  scorer_version: String              // SHA-256 of the scorer WASM, pinned
  secrets_profile: String
  secrets_account: AccountId
  partner_pubkey: [u8; 32]            // x25519, recovery partner (demo key in hackathon)
  loan_term_ns: u64                   // 30 days prod, minutes in demo
  grace_ns: u64                       // 7 days prod, minutes in demo
  score_ttl_ns: u64                   // 30 days
  min_hold_ns: u64                    // loan_term_ns / 2; repay before this = no level up
  max_borrower_share_bps: u16         // 1000 = one borrower max 10% of pool value (upper bound)

pool:
  cash: u128                          // USDC held for lending
  outstanding: u128                   // principal currently lent out
  total_shares: u128
  reserve: u128                       // first-loss: seed + owner top-ups from the treasury
  treasury: u128                      // KredoFi: half of every interest payment

lenders: LookupMap<AccountId, u128>   // shares

borrowers: LookupMap<AccountId, Borrower>
  Borrower { level: u8 (1..=4), last_level_up: u64, score: Option<ScoreRecord>, loan: Option<Loan>,
             pending_request: bool, defaults: u32, blocked: bool,
             sealed_identity: Option<Vec<u8>>, released_identity: Option<Vec<u8>> }

ScoreRecord { band: A|B|C|D, score: u16, income_cap: u128, fingerprint: [u8; 32],
              issued_at: u64, expires_at: u64, scorer_version: String }

Loan { principal: u128, interest: u128, limit_at_borrow: u128, band, issued_at: u64, due_at: u64, state: Active|Repaid|Defaulted }

fingerprints: LookupMap<[u8; 32], AccountId>   // one bank identity, one borrower
stats: per band { scored, loans_issued, repaid, defaulted, volume }
```

Pool value = `cash + outstanding`. Reserve and treasury are separate balances, not lender money; the contract's USDC balance always equals `cash + reserve + treasury`. Share price = pool value / total_shares. Losses not covered by the reserve reduce `outstanding` without returning cash, so they lower the share price.

---

## 4. Methods

### Borrower

| Method | Rules |
|---|---|
| `request_score(public_token, reply_pubkey)` payable | Requires `signer == predecessor` (so OutLayer's `sender_id` is the borrower). Not blocked, no pending request, no active loan. Attached deposit >= 0.01 NEAR (OutLayer fee). Sets `pending_request`. Calls OutLayer `request_execution` with the pinned `scorer_version`, `secrets_ref`, `payer_account_id: borrower`, 100 Tgas, `max_execution_seconds: 30`. Callback: `on_score`. In `Dev` mode it panics; use `dev_submit_score`. |
| `on_score(borrower)` `#[private]` | OutLayer passes the scorer's stdout JSON object itself (no wrapper; confirmed on mainnet Nov 1, tx `4dgHrA97…`). `null` / error: clear `pending_request`, log, change nothing else. Success: parse output, require `output.caller == borrower`, require `output.v == 1`, require fingerprint unused or owned by this borrower. Store `ScoreRecord`, `sealed_identity`, bump `stats[band].scored`. Never panics after reading the borrower (a panic would undo clearing `pending_request`); every rejection emits `score_failed` with a reason. Refunds: `request_score` passes `payer_account_id = borrower`, so OutLayer sends the unused deposit straight to the borrower (OutLayer docs: "Unused deposit sent to payer_account_id"). Without it OutLayer refunds the calling contract (prep tx `CCWy2xNr…UvR`), and the contract cannot tell how much arrived or when. On-chain check: PLAN day 6. |
| `borrow(amount)` | Score exists and not expired. Band not D. No active loan. `amount <= limit(borrower)`. `amount <= cash`. `amount <= max_borrower_share_bps * pool value`. Requires exactly 1 yoctoNEAR (full-access key). Interest = `ceil(principal * band rate)` (A 4%, B 6%, C 8%). Write the loan, move cash to outstanding, **then** `ft_transfer` to borrower with callback `on_borrow_transfer`; on failure restore the previous loan record, pool and stats exactly. `loan_issued` is emitted only after the transfer succeeds. |
| `repay` | Via `usdc.ft_transfer_call(pool, amount, msg: "repay")`. Full repayment only: `amount == principal + interest`, otherwise return the tokens. Interest split: lenders get `ceil(principal * lender rate)` (A 2%, B 3%, C 4%, rounded in the lenders' favour) into pool cash; the treasury gets the rest; the reserve gets none. `loan_repaid` reports `to_pool` and `to_treasury`. `stats.repaid += 1`. **Level up by 1 (max 4) only if all three hold:** (a) the loan was held at least `min_hold_ns` (half the loan term: 15 days prod, half the demo term in demo), (b) principal was at least 50% of the limit at borrow time, (c) the last level-up was at least `loan_term_ns` ago (a borrower who never levelled up passes (c)). A late repay (after `due_at`, before anyone calls `mark_default`) is accepted. Otherwise the repay succeeds but the level stays. This stops "borrow today, repay tomorrow" farming: the fastest path from $100 to $1,000 takes three full terms (about 3 months) and three real loans. |

`limit(borrower) = min(LEVEL_CAP[level] * BAND_PCT[band], income_cap)` with
`LEVEL_CAP = {1: 100, 2: 250, 3: 500, 4: 1000}` USDC and `BAND_PCT = {A: 100%, B: 75%, C: 50%, D: 0}`.

Interest per loan term (flat), paid by the borrower: A 4%, B 6%, C 8%. Half (A 2%, B 3%, C 4%) goes to lenders, half to the KredoFi treasury. Band A on $100: repay $104 = $2 lenders + $2 treasury.

### Lender

| Method | Rules |
|---|---|
| deposit | Via `usdc.ft_transfer_call(pool, amount, msg: "deposit")`. Mint shares at current share price (rounded down). Rejected (tokens refunded) if it would mint 0 shares, or if the pool has shares but zero value. |
| `withdraw(shares)` | Requires exactly 1 yoctoNEAR attached (full-access key). Burn shares, pay `shares * price`, limited by `cash`. State first, then `ft_transfer` with rollback callback. `lender_withdraw` is emitted only in the callback, after the transfer succeeds. |

Cross-chain deposits: NEAR Intents 1Click delivers USDC to the **lender's own NEAR account**, then the lender deposits with `ft_transfer_call` (so the pool knows who deposited). One-step deposit only if 1Click can attach a message to a contract recipient (to check).

### Default and recovery

| Method | Rules |
|---|---|
| `mark_default(borrower)` | Anyone may call once `now > due_at + grace_ns` and the loan is Active. Loan becomes Defaulted. Loss = principal: `covered = min(reserve, principal)`; `reserve -= covered`; `cash += covered`; `outstanding -= principal`. So lenders lose only `principal - covered` (pool value drops by that much). Borrower `blocked = true`, `defaults += 1`. Fingerprint stays taken. Emits `loan_defaulted`. |
| `request_identity_release(borrower)` payable | Anyone may call. Only for a Defaulted loan, once, one request at a time (uses `pending_request`). OutLayer mode: caller attaches >= 0.01 NEAR; calls the scorer project (pinned version) with input `{"op":"release","sealed":...,"partner_pubkey":...}` and `payer_account_id` = caller; callback `on_release` (`#[private]`, never panics; on failure clears the pending flag so it can be retried). Dev mode: marks the request; then `dev_submit_release(borrower, output)` (only `dev_scorer`, only after a request, disabled in OutLayer mode) submits `{"v":1,"released":"<base64>"}`. Success stores `released_identity` and emits `identity_released`. |

### Owner

`seed_reserve` (via `ft_transfer_call` msg `"seed_reserve"`), `set_scorer_version(version)` (emits `scorer_version_changed`, public on-chain), parameter setters, and two treasury methods:

| Method | Rules |
|---|---|
| `withdraw_treasury(amount)` | Owner only, 1 yoctoNEAR. `amount <= treasury`. Treasury first, then `ft_transfer` to the **owner account** (fixed recipient) with rollback callback `on_treasury_transfer`; `treasury_withdrawn` only after success. |
| `treasury_to_reserve(amount)` | Owner only, 1 yoctoNEAR. `amount <= treasury`. Moves it into the reserve (accounting only, no transfer). One-way: nothing moves reserve funds back. Emits `treasury_to_reserve`. |

Neither can move pool cash, outstanding principal or reserve funds out: both are capped by the treasury balance.

Parameter setters: `set_loan_term_ns`, `set_min_hold_ns`, `set_grace_ns`, `set_score_ttl_ns`, `set_max_borrower_share_bps`. Each is owner-only, needs 1 yoctoNEAR, emits `param_changed` (`param`, `old`, `new`, `by`) and only changes a number in `config`; none touches the pool, the reserve or any token. The same bounds apply at init:

| Parameter | Bounds |
|---|---|
| `loan_term_ns` | 60 s to 365 days, and >= `min_hold_ns` |
| `min_hold_ns` | 60 s to `loan_term_ns` (init sets `loan_term_ns / 2`) |
| `grace_ns` | 60 s to 90 days |
| `score_ttl_ns` | 60 s to 365 days |
| `max_borrower_share_bps` | 1 to 1000 (can only lower the 10% cap, rule 12) |

To shorten the term below the current hold, lower `min_hold_ns` first. Term changes apply to new loans; `grace_ns` and `min_hold_ns` are read at default and repay time.

Testnet demo timing: loan term 2 minutes, minimum hold 1 minute, grace 1 minute (Riya can level up after 1 minute; Max can be defaulted about 3 minutes after borrowing). `min_hold_ns` is set at init to `loan_term_ns / 2`. **No method lets the owner move lender funds or the reserve out**; the owner can only withdraw the treasury or move it into the reserve. No contract upgrade method in the hackathon build. `migrate()` is a one-time `#[private]` state migration (v1 to v2, adds the treasury), run in the same transaction as a code deploy; only the contract account's own key can run it, the same key that can deploy code, so it adds no power.

### Views

`get_config`, `get_pool`, `get_lender(account)`, `get_borrower(account)` (never returns `sealed_identity`), `get_limit(account)`, `get_stats`, `is_release_allowed(account)`.

### Events (NEP-297, standard `kredofi`, version `1.0.0`)

`score_issued`, `score_failed`, `loan_issued`, `loan_repaid`, `loan_defaulted`, `identity_released`, `lender_deposit`, `lender_withdraw`, `reserve_seeded`, `scorer_version_changed`, `param_changed`, `treasury_withdrawn`, `treasury_to_reserve`.

---

## 4a. Money flow (one $100 band A loan)

| Step | Borrower | Pool (lenders) | Reserve | KredoFi treasury |
|---|---|---|---|---|
| Borrow | gets $100 | cash -$100, outstanding +$100 | - | - |
| Repay $104 | pays $104 | cash +$102, outstanding -$100 (share price rises by $2) | $0 | +$2 |
| Default instead | keeps $100, blocked, name released | loses $100 minus what the reserve covers | pays up to $100 into pool cash | $0 |

- Interest per 30-day term, paid by the borrower: A 4%, B 6%, C 8%. Lenders get half (A 2%, B 3%, C 4%) through the share price; the other half goes to the KredoFi treasury. Rounding favours lenders.
- The treasury is the business revenue. The owner can withdraw it, or move it into the reserve (one-way). The owner cannot withdraw lender money or the reserve (security rule 10).
- The reserve starts with a seed (`seed_reserve`, demo: $300 on testnet). It gets no share of interest; it grows only when the owner moves treasury into it.
- Lender yield is not promised. It depends on how much of the pool is lent out. Example: half the pool lent to band A all year gives lenders about 2% x 12 x 0.5 = about 12% a year before losses. The lender page shows earned-so-far from the share price, never a forecast.
- Defaults hurt lenders only after the reserve is used up. The reserve is the seed plus whatever the owner moves in from the treasury; each repaid $100 band A loan adds $2 to the treasury, so 50 repaid loans can fund the reserve for one default if the owner moves them in. That's why the seed exists, and why limits start at $100 and grow only with repayment.

---

## 5. Scorer (TEE program)

OutLayer project, `wasm32-wasip2`, reads JSON from stdin, writes JSON to stdout. Uses the patched `wasi-http-client` 0.2.1 in `scorer/vendor` (start the request, then stream the body in 4 KB chunks).

### Secrets (OutLayer encrypted, profile `kredofi`)

`PLAID_CLIENT_ID`, `PLAID_SECRET`, `SEAL_KEY` (32 random bytes, hex), optional `NEARAI_KEY`. Access condition = **`build:<pinned scorer SHA-256> AND from:<KredoFi contract>`** (`outlayer secrets access --access allow-all --via <contract> --build <sha256>`), so only runs that the contract itself starts, with the pinned build, can read them. OutLayer judges a `whitelist:` against the transaction **signer** (the borrower), so a whitelist naming the contract denies every borrower (mainnet tx `BCdtpGjj…`, Nov 1); the `from:` rule judges the account that calls OutLayer. A direct call to OutLayer, even by the secrets owner, is refused (mainnet tx `EJ8Ygrru…`).

### Input

```json
{"op": "score", "public_token": "public-sandbox-...", "reply_pubkey": "<x25519 hex>"}
{"op": "release", "sealed": "<base64>", "partner_pubkey": "<x25519 hex>"}
```

Demo-only: `{"op": "score", "profile": {...}}` creates a sandbox custom user (`override_username: "user_custom"`) instead of a Link token. Never accepted in production config.

Builds (`scorer/build.sh`): the production build (no Cargo features) is the one pinned on OutLayer; it rejects `profile` and `debug`. Feature `demo` accepts profiles (local and testnet Dev mode, run by `dev_scorer`); feature `debug` (local only) prints features to stderr, never stdout. Profiles are validated in the scorer: one depository account, starting balance 0-30,000, 1-200 transactions, amounts -8,000 to 8,000, one identity name of 1-64 bytes. Any failure outputs `{"success": false, "error": "..."}` (no `v`), which the contract records as `score_failed`.

### Score steps

1. `public_token` to `/item/public_token/exchange`. The access token never leaves the TEE.
2. `/transactions/sync` with `days_requested: 730` on item creation; loop on `has_more`; poll once per second (max 20). The history is complete only when the status is `HISTORICAL_UPDATE_COMPLETE` **and** a page after the first has delivered transactions (sandbox sometimes flags complete before the historical batch arrives), or after 5 quiet polls (a genuinely short history). If the retries run out, the scorer fails (`score_failed`) instead of scoring a partial history.
3. `/accounts/get` for current balance; `/identity/get` for the owner name (the Item needs products `transactions` and `identity`). Tested Oct 25 in sandbox: returns `accounts[].owners[].names` ("Alberta Bobbeth Charleson", 29 bytes). Plaid custom users (Riya, Sam, Max) need an identity block with a name added in `gen_borrowers.py`, or they may return none.
4. Compute features over the last 6 full months (Plaid sign: negative = money in).
5. Score (section 6). Fingerprint = `HMAC-SHA256(SEAL_KEY, institution_id | normalized owner name | account mask)`.
   Scored account: the primary depository account (first `checking`, else first depository). Its transactions (posted, not pending), current balance, mask and owner name are used; other accounts are ignored, so transfers between own accounts and credit cards don't count as income or spending. The 6-month window is the 6 full calendar months before the current UTC month.
6. `sealed_identity` = owner name (at most 64 bytes) encrypted with `SEAL_KEY` (ChaCha20-Poly1305). Because `SEAL_KEY` is reused for every borrower, each seal uses a fresh random 12-byte nonce: key = SHA-256("kredofi-identity-v1" | SEAL_KEY), output = nonce (12) | ciphertext+tag, base64.
   Crypto tested in `wasm32-wasip2` under wasmtime on Oct 25 (practice crate `seal-test`): `x25519-dalek` 2 (`default-features = false`, `static_secrets`), `chacha20poly1305` 0.10 (`default-features = false`, `alloc`), `sha2` 0.10, `getrandom` 0.3 (`getrandom::fill`), `base64` 0.22. Sealing to an x25519 key: ephemeral key, key = SHA-256("kredofi-seal-v1" | shared | eph_pub | rcpt_pub), zero nonce (key is single-use), output = eph_pub (32) | ciphertext+tag, base64. A 25-character name seals to 100 bytes. Right key opens it, wrong key fails. Use the same scheme for the release step.
7. Optional: AI summary from NEAR AI Cloud `Qwen/Qwen3.8-27B` (proven private: gateway + model attestation with `nvidia_payload`), encrypted to `reply_pubkey` so only the borrower's browser can read it. The score never depends on AI.
   Tested Oct 25: `POST https://cloud-api.near.ai/v1/chat/completions` with `"chat_template_kwargs": {"enable_thinking": false}` and `/no_think` in the system prompt. Without them Qwen3 spends the whole `max_tokens` on reasoning and returns `content: null`. Result: 2 plain sentences, 66 in / 31 out tokens, about $0.00005 per run. Key = `NEARAI_KEY` secret.
   `reply` (optional, when `reply_pubkey` is given): the five rule results `{"parts":{"income","stability","payment","cash_flow","buffer"}}` (plus the AI summary if built) sealed to `reply_pubkey` with the x25519 scheme, so only the borrower's browser can show why the band was given (SPEC 8b).
8. **Always** call `/item/remove` with the access token before the run ends, on success and on every error path. The bank connection is then revoked at Plaid, so the access token is useless even if it ever leaked. A new score needs a new bank connection (Plaid Link again).

Fee and refund: the borrower attaches the OutLayer fee (>= 0.01 NEAR) to `request_score`; the contract forwards all of it to `request_execution` with `payer_account_id` set to the borrower, so any unused part is refunded by OutLayer directly to the borrower, never kept by the contract. If mainnet shows `payer_account_id` does not work this way, the refund stays in the contract and the README says so (PLAN day 6).

Token safety: `public_token` passes through `request_score` arguments, so it is **visible on-chain**. That is acceptable only because it is single-use, expires after 30 minutes, and can be exchanged only with `PLAID_CLIENT_ID` + `PLAID_SECRET`, which exist only inside the TEE (OutLayer secrets, contract-only whitelist). The README and THREAT_MODEL.md must say this plainly.

### Output (must stay under about 900 bytes for on-chain mode)

```json
{"v": 1, "caller": "<NEAR_SENDER_ID>", "band": "A", "score": 1000, "income_cap": 1000000000,
 "fingerprint": "<hex32>", "sealed_identity": "<base64>", "reply": "<base64, optional>"}
```

`income_cap` is in USDC base units (6 decimals) and capped at 1,000 USDC, so it never reveals income above $2,000 a month. Raw transactions, balances, the access token and the name never appear in the output.

### Release step

Decrypt `sealed` with `SEAL_KEY`, re-encrypt to `partner_pubkey` (x25519 + ChaCha20-Poly1305), output `{"v":1,"released":"<base64>"}`. Only the contract can trigger it (secrets whitelist), and the contract only does so after a recorded default.

---

## 6. Scoring rules (open source, deterministic)

| Factor | Points | Rule |
|---|---|---|
| Income level | 250 | Avg monthly income >= $3,000: 250; >= $2,000: 180; >= $1,000: 100; else 40 |
| Stability | 250 | `150 * months_with_income / 6` + (CV <= 0.15: 100; CV <= 0.40: 50; else 0). CV = std / mean of monthly income, zero months included |
| Payment behavior | 250 | `max(0, 250 - 60 * fee_events)`; fee events = OVERDRAFT, NSF, RETURNED in the name |
| Cash flow | 150 | `(income - spending) / income` >= 0.3: 150; >= 0.1: 100; >= 0: 50; else 0 |
| Savings buffer | 100 | `balance / avg monthly spending` >= 3: 100; >= 1: 60; >= 0.3: 30; else 0 |

Bands: **A** >= 800, **B** 650-799, **C** 500-649, **D** < 500 (no loan).
`income_cap = min(1000, floor(avg_monthly_income * 0.5 / 50) * 50)` USDC.

Verified on the demo borrowers (`scripts/gen_borrowers.py`, `score_check.py`):

| Borrower | Parts | Score | Band | Level-1 limit |
|---|---|---|---|---|
| Riya Good | 250 / 250 / 250 / 150 / 100 | 1000 | A | $100 |
| Sam Risky | 100 / 100 / 10 / 0 / 60 | 270 | D | $0 (rejected) |
| Max Cheater | 250 / 250 / 250 / 150 / 100 | 1000 | A | $100 (defaults in the demo) |

Unit tests must reproduce this table exactly.

---

## 7. Security rules (each needs a test)

1. Scores are accepted only in `on_score` (`#[private]`), i.e. only from the contract's own OutLayer request.
2. The request pins `scorer_version`; changing it is a public owner action with an event.
3. `request_score` requires `signer == predecessor`; `on_score` requires `output.caller == borrower`.
4. A `null` or failed OutLayer result changes nothing except clearing `pending_request`.
5. Scores expire after `score_ttl_ns`.
6. One fingerprint, one borrower.
7. Write state before every token transfer; every transfer has a callback that rolls back on failure.
8. Checked u128 math. USDC has 6 decimals, NEAR has 24, time is nanoseconds.
9. `get_borrower` never returns `sealed_identity`; `released_identity` is encrypted to the partner key.
10. No owner path to lender funds (pool cash, outstanding principal) or the reserve. The owner can only withdraw the treasury (capped at the treasury balance, to the owner account, with rollback) or move treasury into the reserve (one-way). Tests: an ABI allowlist of public change methods, plus withdraw / top-up attempts above the treasury with lender cash and reserve present.
11. Borrowers and lenders must be registered with the USDC contract (`storage_deposit`); the web app handles it.
12. One borrower can never exceed 10% of pool value.
13. No fast level-up: an early repay (before `min_hold_ns`), a small loan (under 50% of the limit) or a second level-up within one term does not raise the level.

---

## 8. Demo script mapping

1. Lender deposits (testnet, mock USDC) and the dashboard shows pool value.
2. Riya: request score, Band A, borrow $100, repay, level 2, limit $250.
3. Sam: Band D, borrow button disabled with plain reasons.
4. Fake score: call `on_score` directly, rejected (it is private). Call `dev_submit_score` on mainnet: rejected.
5. Max: Band A, borrows $100, misses due date (demo minutes), anyone calls `mark_default`, reserve covers the loss, identity released to the partner key, Max blocked.
6. Mainnet: one real `request_score` through OutLayer with the transaction link shown.

---

## 8a. No-wallet demo account (core, testnet only)

Most judges have no NEAR testnet wallet. "Continue without a wallet" creates a throwaway testnet account for them, and the relayer pays all gas through meta transactions (NEP-366).

Facts tested on Oct 25 (practice script `~/near-practice/metatx`, near-api-js 7.4.0, demo account `demo1792909616401.kency.testnet`):

- A relayer can create `demo<timestamp>.<relayer>` and fund it in one transaction (`createAccount`, `transfer`, `addKey`).
- The demo key signs a `DelegateAction`, and the relayer sends it with `relayMetaTransaction`. The demo account's balance did not change, so the relayer paid the gas. Tx `8etwNVqLwriLvYKmFA6gnoaGT4L5SsDTheLumvoRQcRx`.
- A function-call key **cannot attach any deposit**: "Deposit is not allowed with function call".
- A function-call key works with **one receiver contract only**: "Access key receiver ... does not match transaction receiver".

Because `ft_transfer_call` needs 1 yocto, and repay and deposit go to the USDC contract (not KredoFi), a function-call key alone cannot repay. Design:

1. The web app generates the demo key in the browser and keeps it in `localStorage` (testnet, test money only; the README says so).
2. The relayer (a small API route in `web`, holding its own key in env) creates `demo<timestamp>.<relayer>` with a **full-access key** = that demo key, 0.005 test NEAR (covers the account's storage and 1-yocto deposits; the relayer pays all gas), and calls `mock-usdc.storage_deposit` for it. At most 5 new demo accounts per hour per IP.
3. Every demo action is a meta transaction: the browser signs the `DelegateAction`, and the relayer relays it and pays the gas. The user never sees gas or a wallet prompt.
4. The relayer only relays delegates whose `receiver_id` is the KredoFi contract or `mock-usdc`, with method allowlist `borrow`, `withdraw` (pays only the caller's own shares), `ft_transfer_call` (only to KredoFi, msg `repay` or `deposit`), `storage_deposit`; one FunctionCall per delegate, exact deposits, at most 100 Tgas (`web/src/lib/relayPolicy.ts`). Permissionless default steps for demo accounts (`mark_default`, `request_identity_release`) are sent by the relayer itself (on testnet, scoring runs in Dev mode through `dev_submit_score` by the `dev_scorer` backend, so demo accounts never call `request_score`), and at most 20 relays per demo account per hour. This gives the same safety as a function-call key, enforced by the relayer.
5. "Connect wallet" stays available. Demo accounts and wallet accounts use the same contract methods; the contract does not know which is which.
6. Mainnet never uses demo accounts.
7. Test USDC: the `mock-usdc` owner (the only account that can `mint`) is the relayer account. When the relayer creates a demo account it also mints 10 test USDC to it (enough to repay interest). Wallet users get a "Get 500 test USDC" button served by the relayer API, once per account. No contract change needed.

Build after the core loop works (score, borrow, repay, default), but before any optional extra. Estimated half a day.

---

## 8b. Build your own borrower (core, testnet)

So judges can test the scoring themselves instead of only watching three prepared people. On the pick screen, next to Riya, Sam and Max: "Build your own borrower" with five inputs:

| Input | Range |
|---|---|
| Monthly salary | $0 to $8,000 |
| Months with income (of the last 6) | 0 to 6 |
| Monthly spending | $0 to $8,000 |
| Overdraft or returned-payment fees | 0 to 6 |
| Current balance | $0 to $30,000 |

The web app turns these into a Plaid custom-user profile (same generator logic as `scripts/gen_borrowers.py`, ported to TypeScript, with a made-up name) and sends it through the normal demo-only `{"op":"score","profile":{...}}` path. The real scorer runs on real Plaid sandbox data built from those inputs. The result screen shows the five rule results, so the judge can see why the band changed. Inputs are validated in the browser and again in the scorer (reject out-of-range values).

---

## 8c. Connect a sandbox bank yourself (core, testnet)

So judges see a real bank connection, not only prepared people. The pick screen offers "Connect a sandbox bank yourself": the web app creates a Plaid Link token (`/link/token/create`, products `transactions` and `identity`, server-side with the Plaid keys from env), opens the real Plaid Link window, and the judge logs in to a sandbox bank with Plaid's public test login `user_good` / `pass_good`. The resulting `public_token` goes into the normal `{"op":"score","public_token":...}` path, and the TEE fetches that account live. The screen shows the test login next to the button so nobody has to look it up.

---

## 9. Known limits (state them in the README)

- Sandbox bank data only; real banks need Plaid production access and a licensed lending partner.
- Plaid sandbox account IDs change per login, so fingerprints use owner name, institution and mask. Production would use Plaid's persistent account ID where available.
- Trust assumptions: Intel TDX and NVIDIA confidential computing, and OutLayer's worker registration.
- Mainnet connected flow uses tiny real amounts; most demo flows run on testnet in Dev mode.
