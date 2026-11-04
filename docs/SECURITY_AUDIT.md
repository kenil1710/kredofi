# Security review (Nov 3, 2026)

**What this is:** an AI-assisted security review by a fresh agent with no access to the build history; not a professional audit.

Review 1 was done by a fresh AI agent (Claude, run by the developer) that had not seen how the code was written and was given only the repository and `docs/SPEC.md`. Treat it as a careful second look, not as assurance. Its limits:
- read-only calls to `kredofi.near` and testnet;
- 25 live HTTP requests;
- no transactions;
- proofs written as sandbox tests and a node test.

It found 2 High, 3 Medium, 5 Low and 5 Info issues. Every finding below has a status and either the commit that fixes it or the reason it is accepted. Commits are in this repository; "testnet tx" and "tx" link to the explorers.

**Where things stand:**
- **Code:** every fix is in `main`, with tests.
- **Live testnet site (`kredofi.kency.testnet`, Dev mode):** the web fixes are live.
- **`app.kency.testnet` (OutLayer mode, from Nov 5):** contract and scorer fixes ship there.
- **Mainnet `kredofi.near`:** contract v3 and scorer `6888c15e…` have been live since 3 November, after the owner's yes on each transaction ([v3 deploy](https://nearblocks.io/txns/2zyjvpPaybW9nUjpzQksbPVsgmHRxhmMWHkJ24VsSUAu), [pin](https://nearblocks.io/txns/2acP4tWJVNQDYeqD66kwrMcFa1XfReAffuU4qyk7VxkG), `docs/MAINNET_PLAN.md`). The mainnet pool holds $0 and no mainnet loan has been made. Live view: https://kredofi.xyz/mainnet.

## Findings

| # | Severity | Finding | Status | Fix commit / reason | Tests and proof |
|---|---|---|---|---|---|
| H1 | High | Mainnet `request_score` carried the Plaid `public_token` in plain text, and nothing tied it to the sender. Anyone who copied a token (from a refused call, or by racing the worker) could have that bank scored for their own account. The bank identity was then bound to them. | **Fixed on mainnet (3 Nov).** The browser seals `account + token` to a key that only the scorer holds (`sealed1:`). The scorer refuses a token sealed for another account before any Plaid call, and on-chain builds refuse plain tokens. | `2d5ca4d` (scorer, JS sealing, SPEC "Sealed token"); `edf4389` (testnet build `0515ebca…` in OutLayer); `69f373e` (web) | `h1_*` scorer tests. Testnet enclave: the copied token was refused (testnet tx `5cyWM6MzXs3ySgwxLRtzeZ3ztcVjtgAnzb7Ggv5pRT3u`, `score_failed` "sealed for another account"), and the owner's own request with the same token scored band A (testnet tx `pNRfqHTCWdePuuYs5YkxjrQYTRQ6ERWMf7qNtMvjAqp`). Mainnet: scorer `6888c15e…` pinned ([tx 2acP4tWJ…](https://nearblocks.io/txns/2acP4tWJVNQDYeqD66kwrMcFa1XfReAffuU4qyk7VxkG)); a real score with a `sealed1:` token, band A in 8.5 s ([tx 3nbdkFd3…](https://nearblocks.io/txns/3nbdkFd3uNeeoYhqmE2AQHuRMXLZYbDhEZAUzsVDFGzo)). |
| H2 | High | Mainnet scores come from the Plaid sandbox, where anyone can invent an income and get band A. Many accounts could each borrow and default. | **Fixed on mainnet (3 Nov).** Contract v3: lender deposits are refused until the owner sets `production_data`, which must wait for Plaid production access. Testnet contracts aren't gated. Documented in the README and THREAT_MODEL. | `2d5ca4d` | Unit `h2_*`; sandbox `migrate_from_deployed_v2_keeps_everything` (migrates the real deployed v2 binary; deposits are refunded until the flag is set; owner only). Mainnet v3 deploy + migration [tx 2zyjvpPa…](https://nearblocks.io/txns/2zyjvpPaybW9nUjpzQksbPVsgmHRxhmMWHkJ24VsSUAu) (log: `require_production_data = true, production_data = false`); `get_config` shows both flags. |
| M1 | Medium | If contract storage ran out between `request_score` and `on_score`, or OutLayer returned bytes that weren't JSON, `pending_request` stayed set for good and the borrower was locked out. | **Fixed on mainnet (v3, 3 Nov)**; testnet from Nov 5. The callback reads raw bytes (at most 16 KB) and records any bad answer as `score_failed`. A borrower can call `cancel_pending_score` to clear their own stuck request. Lender deposits must be at least 1 USDC. `/api/health` reports `storageLow`. | `1654b39` (contract), `224ab9b` (health) | Sandbox `storage_starved_callback_is_recoverable` (the auditor's proof, now recoverable); unit `on_score_raw_bytes_*`, `borrower_cancels_stuck_score_request`, `cancel_*`, `deposit_under_one_usdc_rejected`. |
| M2 | Medium | `/api/faucet` had no IP limit and accepted made-up implicit ids, so the testnet relayer could be drained. | **Fixed, live.** The account must exist on chain. Limits: 10 calls per IP per hour, 3 lender grants per IP per day, 300 calls and 60 grants a day in total. | `224ab9b` | `guards.test.ts` faucet budget; live: a random implicit id gets "does not exist". |
| M3 | Medium/Low | `/api/default` sent `mark_default` before the due date, so the relayer paid for refused transactions. `/api/release` had no IP limit. | **Fixed, live.** The route checks the contract's own `due_at + grace` rule first, and both routes allow 30 calls per IP per hour. | `224ab9b` | `pastDue` test; main flow and scenarios defaults pass. |
| L1 | Low | The level stays with the account when its bank identity changes. | **Accepted.** In one line: a borrower who re-scores with another bank keeps the limit they earned by repaying, and only the latest sealed name is kept. This can't move funds (limits stay capped by the new income cap, 10% of the pool and the reserve), and changing the level rule during the freeze would change SPEC rule 13. | — | Auditor's sandbox proof. |
| L2 | Low | Each IPv6 address was its own rate-limit bucket. | **Fixed, live.** IPv6 is keyed on its /64. | `224ab9b` | `clientIp.test.ts`. |
| L3 | Low | Anyone could flood score challenges for another account and push out the nonce its wallet was signing. | **Fixed, live.** A requester evicts only its own nonces (5 per account), with at most 50 per account; expired entries are swept. | `224ab9b` | `guards.test.ts`; wallet loop 13/13. |
| L4 | Low | The ledger showed events from receipts that failed and were rolled back. | **Fixed, live.** Failed receipts are skipped, and the cache was rebuilt. | `224ab9b` | `events.test.ts`. |
| L5 | Low | A failed withdraw transfer restores shares at the old price. | **Accepted.** The other lenders' dilution is at most the interest earned between the withdraw call and its callback (one block), and it needs a failed USDC transfer. | — | — |
| I1 | Info | `kredofi.near` still has a full-access key, so a code deploy could move any funds. | **Accepted until the final audited build.** Locking now would block the H2 and M1 fixes. The lock path (final audited build, multisig owner, time lock on scorer re-pins, then lock) is on `/docs/roadmap`. | `ff7b829` (roadmap) | — |
| I2 | Info | After a total loss with shares outstanding, the pool refuses new deposits. | **Accepted.** It needs the reserve and every lender to be wiped out, and refusing deposits then is the safe outcome. | — | `deposit_into_wiped_out_pool_rejected`. |
| I3 | Info | The check for direct Space hits trusted Hugging Face to reject odd Host headers. | **Fixed, live.** With `PROXY_SECRET` set, any request without the Worker's secret goes to one shared bucket, whatever its Host. | `224ab9b` | `clientIp.test.ts`. |
| I4 | Info | Routes returned raw RPC error text. | **Fixed, live.** Internal errors go to the server log only. | `224ab9b` | `publicError` tests. |
| I5 | Info | `on_score` records the version pinned when the callback runs. | **Accepted.** It differs only if the owner re-pins during a request, and a re-pin is public with an event. | — | — |

**Found before the review (domain work, Nov 3):** the Space's `X-Forwarded-For` header could be forged to dodge rate limits (22 of 22 spoofed requests got through). **Fixed, live** in `39995f2`: through the Worker the app trusts only Cloudflare's client IP, and direct Space hits share one bucket.

## Checked and found sound

- Share math, rounding, and first-depositor inflation.
- The token entry point.
- Private callbacks, with rollback on a failed transfer.
- Owner powers: bounded, and the treasury moves one way only.
- Strict score parsing.
- Scorer build gates, and where the caller id comes from.
- The relayer allowlist.
- The NEP-413 ownership check.
- The Worker's header stripping and redirects.

## Tests after the Review 1 fixes

- Contracts (`cargo test --workspace`): 133 unit, 36 sandbox and 3 mock.
- Scorer: 39 tests.
- Web: 76 tests.
- Browser runs:
  - Dev mode (live site): main flow 24/24, scenarios 11/11, wallet loop 13/13.
  - OutLayer mode (local, throwaway contract): main flow 23/24, scenarios 11/11, wallet loop 12/13. The only misses are the fetch receipt, which enclave runs don't report.

## Review 2 (Nov 4, 2026): mainnet contract only

**What this is:** another AI-assisted security review by a fresh agent with no access to the build history; not a professional audit. It got a copy of `contracts/`, `tests/` and `docs/SPEC.md` with no git history, no logs and no Review 1 report (code comments still name earlier fix labels; it was told to treat them as unverified). Limits: 40 read-only mainnet RPC calls (6 used), no transactions, no keys. Checklist: storage staking and DoS, upgrade and migrate safety, owner key compromise, OutLayer callback failure paths, gas in callbacks, integer edges at 0 and max, event correctness, and anything Review 1 missed.

It found 1 High (a trust/design issue), 1 Medium, 5 Low and 5 Info. Each finding came with a test that proved it. After the fixes those tests assert the fixed behaviour (`contracts/kredofi/src/review2_tests.rs`, `tests/tests/review2.rs`).

**Mainnet status:** the fixes, including the time lock for the High, are in `main` as contract v4 (the time lock adds two config fields, so v4 deploys with a v3 → v4 migration, tested against the binary deployed on `kredofi.near`). `kredofi.near` still runs v3 (`b7f55eaf…`): redeploying needs the owner's yes (below). Nothing is at risk today: the mainnet pool holds $0 and lender deposits are closed.

| # | Severity | Finding | Status | Tests and proof |
|---|---|---|---|---|
| R2-H | High (trust) | The owner account can re-pin the scorer immediately, and it also owns the OutLayer project and the secrets. With the owner key, an attacker could pin a build that gives any sybil band A, and once deposits are open, borrow the pool out and default (the reserve pays first, lenders lose the rest). They could also give that build the sealing key and open sealed names. | **Fixed in code (contract v4); on `kredofi.near` after the redeploy below.** Re-pins are time-locked (`contracts/kredofi/src/pin.rs`, SPEC 4 "Owner"): `propose_scorer_version` emits `scorer_change_proposed` with `apply_at`; `apply_scorer_version` works only after `scorer_delay_ns` (24 h on mainnet, never below 1 h; 60 s on testnet; max 30 days); the owner can cancel; the delay can only be increased. `get_pending_scorer`, `/mainnet` and the ledger Verify panel show any pending change, so lenders and borrowers get the whole delay to leave. `set_scorer_version` is removed. **Not covered:** (1) whoever holds `kredofi.near`'s own full-access key can deploy new code, which skips any time lock (see "Locking" below); (2) the secrets owner can still change the OutLayer secrets access, which could expose the sealing key and Plaid keys to another build (sealed names, not pool funds); both move to separate keys and a multisig in the Pilot phase. | Unit `pin_tests.rs` (25 tests: bounds per network, increase-only, owner-only, 1 yocto, too-early apply, cancel, one pending at a time, events, overflow) and `r2_scorer_pin_change_waits_for_time_lock` (the reviewer's proof, now failing to take effect); sandbox `rule2_request_pins_version_and_change_is_public` (requests keep the old pin during the lock; applied after the sandbox clock passes 1 h) and `migrate_from_deployed_v3_keeps_everything` (deployed v3 binary re-pins instantly; after deploy + migrate it can't, and every balance, borrower, lender, stat and config value survives). |
| R2-M1 | Medium | The contract pays for every borrower record and score, and mainnet had about 4.5 KB free. Anyone could fill it with cheap `request_score` calls. A defaulter could then make `on_release` fail on storage: the callback reverts, `pending_request` stays set, the blocked borrower can't cancel, and a new release was refused as "already pending", so the identity release was lost for good. | **Fixed in code.** `request_score` is refused while the contract's free balance is under 0.05 NEAR (filling storage now only pauses new scores until a top-up). A pending release can be requested again, and a duplicate answer is ignored. | Sandbox `r2_starved_release_can_be_retried_after_top_up` (the reviewer's proof, now completing after the retry) and `storage_starved_callback_is_recoverable`; unit `r2_request_score_needs_storage_headroom`, `r2_pending_release_can_be_retried_and_duplicates_are_ignored`. Measured: a failed request costs the contract 115 bytes; a scored borrower costs 379. |
| R2-L1 | Low | Request → cancel → borrow → the cancelled request's late answer lands: the score and band were replaced during an active loan, and a second fingerprint was taken. | **Fixed in code.** A score answer that lands while a loan is active or after a default is ignored. | `r2_late_on_score_during_active_loan_is_ignored` |
| R2-L2 | Low | That late answer also cleared `pending_request` even when it belonged to an identity release in flight. | **Fixed in code** (same check; the flag is left alone). | `r2_late_on_score_keeps_pending_identity_release` |
| R2-L3 | Low | The owner could shorten the grace period of loans already issued (7 days to 60 s), so late payers could be defaulted, and their identity released, a minute after the due date. | **Fixed in code.** Grace can't be shortened while any loan is outstanding; lengthening is always allowed. | `r2_grace_cannot_shrink_while_loans_are_outstanding` |
| R2-L4 | Low | After repeated near-total losses, `shares × pool value` overflowed u128, so `get_lender` and a full withdraw panicked. | **Fixed in code.** `mul_div` uses a 256-bit intermediate. | `r2_share_math_survives_collapse`, `r2_mul_div_wide_matches_exact_math` (checked against exact values, including u128::MAX) |
| R2-L5 | Low | After a total wipe with shares outstanding, deposits are closed for good. | **Accepted** (same as Review 1 I2: safe outcome after the reserve and every lender are wiped out). | `deposit_into_wiped_out_pool_rejected` |
| R2-I1 | Info | Events from a receipt that later failed are still in the logs (seen in the M1 proof). | **Handled off-chain:** the ledger skips failed receipts (Review 1 L4). | `events.test.ts` |
| R2-I2 | Info | No owner transfer method: if the owner key is lost, the treasury stays stuck. | **Accepted;** the multisig owner in the Pilot phase needs a planned upgrade anyway. | — |
| R2-I3 | Info | Interest is rounded up per loan, so a 1-unit loan carries 1 unit of interest. | **Accepted** (rounding goes to lenders by design; loans are dollars, not units). | `r2_integer_edges_fail_cleanly` |
| R2-I4 | Info | A fingerprint stays tied to its first account for good, even if that account's key is lost. | **Accepted** (one bank identity, one borrower: SPEC rule). | — |
| R2-I5 | Info | Circle can freeze USDC accounts, which would freeze funds; rollbacks keep the books consistent. | **Accepted** (property of the token). | — |

**Checked and found sound by Review 2:**
- The v2→v3 migration: field order matched the deployed v2 binary; it is `#[private]`. Its successor, v3→v4 (added with the time lock), parses the state exactly, so running it on v4 state panics instead of misreading it or wiping a pending change (`r2_migrate_on_v4_state_panics`).
- Every owner method and its bounds (term, hold, TTL and share caps; the treasury moves one way).
- Raw-byte callbacks and rollbacks.
- Gas: callbacks burn 1–2 Tgas against 15–30 reserved.
- Integer edges at 0 and u128::MAX on every entry point (`r2_integer_edges_fail_cleanly`).
- Events in SPEC 4 match the state changes.
- `#[private]` on all six callbacks and `migrate`; signer checks; `ft_on_transfer` accepts only the configured USDC.

**Tests after the Review 2 fixes and the time lock:** contracts 168 unit, 38 sandbox and 3 mock (`cargo test --workspace`), including migration from the deployed v3 binary (`tests/fixtures/kredofi_v3.wasm`, sha256 `b7f55eaf…`, fetched from `kredofi.near`) and the gas budget. Web 82.

**Putting v4 on `kredofi.near` (not done; waits for the owner's yes).** Build `147d863d9413b1531eacec9dd5ad69a727837c9c0de10b270e3237306c5ed148`, 299,999 bytes (`cd contracts/kredofi && cargo near build non-reproducible-wasm --no-embed-abi`). Today `kredofi.near` holds 2.9865 NEAR with 294,110 bytes used (0.0454 NEAR free); the dev account holds 0.2321 NEAR.

| # | What | Signer | Cost (NEAR) |
|---|---|---|---|
| 1 | Storage top-up: +7,301 bytes of code (0.073 NEAR), the 0.05 NEAR score floor, and about 0.031 NEAR held for the deploy's prepaid gas | dev `715363…` | 0.09 (stays in `kredofi.near` as storage) |
| 2 | Deploy v4 and run `migrate` in the same transaction (10 Tgas) | `kredofi.near` | about 0.003 (from `kredofi.near`'s own balance) |
| 3 | Read-only checks: `view_code` hash = `147d863d…`; `get_config` unchanged plus `scorer_delay_ns` = `86400000000000` and `pending_scorer` = null; `get_pending_scorer` = null; `get_pool` all zeros; free balance ≥ 0.05 NEAR | — | 0 |

After step 2, `kredofi.near` has about 0.059 NEAR free, so scores keep working. Every future mainnet re-pin then takes 24 h: publish the build and add it to OutLayer, propose, and 24 h later move the secrets lock and apply back to back.

## Locking `kredofi.near` (not done)

Locking means deleting the contract account's last full-access key.

**Still works after a lock.** Owner methods are called by the owner account (`715363…`), not by `kredofi.near` itself:
- parameters and `set_production_data`;
- scorer re-pins;
- treasury withdrawals and moves to the reserve.

**Breaks for good after a lock:**
- every code deploy and migration, so no bug fixes and no adapting to OutLayer API changes;
- withdrawing the account's own NEAR.

**Not fixed by a lock:** the owner can still re-pin the scorer to any build, but since contract v4 only after the public 24 h time lock.

**Recommendation:** lock last, after these steps (also on `/docs/roadmap`):
1. deploy the final audited build;
2. move the owner role to a multisig;
3. ~~add a time lock on scorer re-pins~~ built (contract v4).
