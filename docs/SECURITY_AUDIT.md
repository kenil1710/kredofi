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
- **Live testnet site (then `kredofi.kency.testnet`, Dev mode; `app.kency.testnet` in OutLayer mode since Nov 4):** the web fixes are live.
- **`app.kency.testnet` (OutLayer mode, from Nov 4):** contract and scorer fixes ship there.
- **Mainnet `kredofi.near`:** contract v3 and scorer `6888c15e…` have been live since 3 November, after the owner's yes on each transaction ([v3 deploy](https://nearblocks.io/txns/2zyjvpPaybW9nUjpzQksbPVsgmHRxhmMWHkJ24VsSUAu), [pin](https://nearblocks.io/txns/2acP4tWJVNQDYeqD66kwrMcFa1XfReAffuU4qyk7VxkG), `docs/MAINNET_PLAN.md`). Since then: contract v4 (4 November, below) and scorer `5175182a…` (7 November, Judge review below). The mainnet pool holds $0 and no mainnet loan has been made. Live view: https://kredofi.xyz/mainnet.

## Findings

| # | Severity | Finding | Status | Fix commit / reason | Tests and proof |
|---|---|---|---|---|---|
| H1 | High | Mainnet `request_score` carried the Plaid `public_token` in plain text, and nothing tied it to the sender. Anyone who copied a token (from a refused call, or by racing the worker) could have that bank scored for their own account. The bank identity was then bound to them. | **Fixed on mainnet (3 Nov).** The browser seals `account + token` to a key that only the scorer holds (`sealed1:`). The scorer refuses a token sealed for another account before any Plaid call, and on-chain builds refuse plain tokens. | `2d5ca4d` (scorer, JS sealing, SPEC "Sealed token"); `edf4389` (testnet build `0515ebca…` in OutLayer); `69f373e` (web) | `h1_*` scorer tests. Testnet enclave: the copied token was refused (testnet tx `5cyWM6MzXs3ySgwxLRtzeZ3ztcVjtgAnzb7Ggv5pRT3u`, `score_failed` "sealed for another account"), and the owner's own request with the same token scored band A (testnet tx `pNRfqHTCWdePuuYs5YkxjrQYTRQ6ERWMf7qNtMvjAqp`). Mainnet: scorer `6888c15e…` pinned ([tx 2acP4tWJ…](https://nearblocks.io/txns/2acP4tWJVNQDYeqD66kwrMcFa1XfReAffuU4qyk7VxkG)); a real score with a `sealed1:` token, band A in 8.5 s ([tx 3nbdkFd3…](https://nearblocks.io/txns/3nbdkFd3uNeeoYhqmE2AQHuRMXLZYbDhEZAUzsVDFGzo)). |
| H2 | High | Mainnet scores come from the Plaid sandbox, where anyone can invent an income and get band A. Many accounts could each borrow and default. | **Fixed on mainnet (3 Nov).** Contract v3: lender deposits are refused until the owner sets `production_data`, which must wait for Plaid production access. Testnet contracts aren't gated. Documented in the README and THREAT_MODEL. | `2d5ca4d` | Unit `h2_*`; sandbox `migrate_from_deployed_v2_keeps_everything` (migrates the real deployed v2 binary; deposits are refunded until the flag is set; owner only). Mainnet v3 deploy + migration [tx 2zyjvpPa…](https://nearblocks.io/txns/2zyjvpPaybW9nUjpzQksbPVsgmHRxhmMWHkJ24VsSUAu) (log: `require_production_data = true, production_data = false`); `get_config` shows both flags. |
| M1 | Medium | If contract storage ran out between `request_score` and `on_score`, or OutLayer returned bytes that weren't JSON, `pending_request` stayed set for good and the borrower was locked out. | **Fixed on mainnet (v3, 3 Nov)**; testnet from Nov 4. The callback reads raw bytes (at most 16 KB) and records any bad answer as `score_failed`. A borrower can call `cancel_pending_score` to clear their own stuck request. Lender deposits must be at least 1 USDC. `/api/health` reports `storageLow`. | `1654b39` (contract), `224ab9b` (health) | Sandbox `storage_starved_callback_is_recoverable` (the auditor's proof, now recoverable); unit `on_score_raw_bytes_*`, `borrower_cancels_stuck_score_request`, `cancel_*`, `deposit_under_one_usdc_rejected`. |
| M2 | Medium | `/api/faucet` had no IP limit and accepted made-up implicit ids, so the testnet relayer could be drained. | **Fixed, live.** The account must exist on chain. Limits: 10 calls per IP per hour, 10 lender grants per IP per hour (3 per day until Nov 7), 300 calls and 60 grants a day in total. | `224ab9b` | `guards.test.ts` faucet budget; live: a random implicit id gets "does not exist". |
| M3 | Medium/Low | `/api/default` sent `mark_default` before the due date, so the relayer paid for refused transactions. `/api/release` had no IP limit. | **Fixed, live.** The route checks the contract's own `due_at + grace` rule first, and both routes allow 30 calls per IP per hour. | `224ab9b` | `pastDue` test; main flow and scenarios defaults pass. |
| L1 | Low | The level stays with the account when its bank identity changes. | **Accepted.** In one line: a borrower who re-scores with another bank keeps the limit they earned by repaying, and only the latest sealed name is kept. This can't move funds (limits stay capped by the new income cap, 10% of the pool and the reserve), and changing the level rule during the freeze would change SPEC rule 13. | — | Auditor's sandbox proof. |
| L2 | Low | Each IPv6 address was its own rate-limit bucket. | **Fixed, live.** IPv6 is keyed on its /64. | `224ab9b` | `clientIp.test.ts`. |
| L3 | Low | Anyone could flood score challenges for another account and push out the nonce its wallet was signing. | **Fixed, live.** A requester evicts only its own nonces (5 per account), with at most 50 per account; expired entries are swept. | `224ab9b` | `guards.test.ts`; wallet loop 13/13. |
| L4 | Low | The ledger showed events from receipts that failed and were rolled back. | **Fixed, live.** Failed receipts are skipped, and the cache was rebuilt. | `224ab9b` | `events.test.ts`. |
| L5 | Low | A failed withdraw transfer restores shares at the old price. | **Accepted.** The other lenders' dilution is at most the interest earned between the withdraw call and its callback (one block), and it needs a failed USDC transfer. | — | — |
| I1 | Info | `kredofi.near` still has a full-access key, so a code deploy could move any funds. | **Accepted until the final reviewed build.** Locking now would block the H2 and M1 fixes. The lock path (final reviewed build, multisig owner, time lock on scorer re-pins, then lock) is on `/docs/roadmap`. | `ff7b829` (roadmap) | — |
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

**Mainnet status: live on `kredofi.near` since Nov 4** as contract v4 (`147d863d…`), with the time lock for the High: storage top-up [tx Ews7ubev…](https://nearblocks.io/txns/Ews7ubevwWF5ZdCnGqjM5mkJSKDBo5C7H1tqyJDDeMcs), deploy + v3 → v4 migration [tx Gj3X9axs…](https://nearblocks.io/txns/Gj3X9axsGU2ctvrsPLo3Uhn93YzbL9XYRtC15fHPEp5c) (log: "Migrated state v3 -> v4 (scorer_delay_ns = 86400000000000, no pending scorer change)"). The mainnet pool holds $0 and lender deposits stay closed.

| # | Severity | Finding | Status | Tests and proof |
|---|---|---|---|---|
| R2-H | High (trust) | The owner account can re-pin the scorer immediately, and it also owns the OutLayer project and the secrets. With the owner key, an attacker could pin a build that gives any sybil band A, and once deposits are open, borrow the pool out and default (the reserve pays first, lenders lose the rest). They could also give that build the sealing key and open sealed names. | **Fixed on mainnet (Nov 4, [tx Gj3X9axs…](https://nearblocks.io/txns/Gj3X9axsGU2ctvrsPLo3Uhn93YzbL9XYRtC15fHPEp5c)).** Re-pins are time-locked (`contracts/kredofi/src/pin.rs`, SPEC 4 "Owner"): `propose_scorer_version` emits `scorer_change_proposed` with `apply_at`; `apply_scorer_version` works only after `scorer_delay_ns` (24 h on mainnet, never below 1 h; 60 s on testnet; max 30 days); the owner can cancel; the delay can only be increased. `get_pending_scorer`, `/mainnet` and the ledger Verify panel show any pending change, so lenders and borrowers get the whole delay to leave. `set_scorer_version` is removed. **Not covered:** (1) whoever holds `kredofi.near`'s own full-access key can deploy new code, which skips any time lock (see "Locking" below); (2) the secrets owner can still change the OutLayer secrets access, which could expose the sealing key and Plaid keys to another build (sealed names, not pool funds); both move to separate keys and a multisig in the Pilot phase. | Unit `pin_tests.rs` (25 tests: bounds per network, increase-only, owner-only, 1 yocto, too-early apply, cancel, one pending at a time, events, overflow) and `r2_scorer_pin_change_waits_for_time_lock` (the reviewer's proof, now failing to take effect); sandbox `rule2_request_pins_version_and_change_is_public` (requests keep the old pin during the lock; applied after the sandbox clock passes 1 h) and `migrate_from_deployed_v3_keeps_everything` (deployed v3 binary re-pins instantly; after deploy + migrate it can't, and every balance, borrower, lender, stat and config value survives). |
| R2-M1 | Medium | The contract pays for every borrower record and score, and mainnet had about 4.5 KB free. Anyone could fill it with cheap `request_score` calls. A defaulter could then make `on_release` fail on storage: the callback reverts, `pending_request` stays set, the blocked borrower can't cancel, and a new release was refused as "already pending", so the identity release was lost for good. | **Fixed on mainnet (Nov 4).** `request_score` is refused while the contract's free balance is under 0.05 NEAR (filling storage now only pauses new scores until a top-up). A pending release can be requested again, and a duplicate answer is ignored. | Sandbox `r2_starved_release_can_be_retried_after_top_up` (the reviewer's proof, now completing after the retry) and `storage_starved_callback_is_recoverable`; unit `r2_request_score_needs_storage_headroom`, `r2_pending_release_can_be_retried_and_duplicates_are_ignored`. Measured: a failed request costs the contract 115 bytes; a scored borrower costs 379. |
| R2-L1 | Low | Request → cancel → borrow → the cancelled request's late answer lands: the score and band were replaced during an active loan, and a second fingerprint was taken. | **Fixed on mainnet (Nov 4).** A score answer that lands while a loan is active or after a default is ignored. | `r2_late_on_score_during_active_loan_is_ignored` |
| R2-L2 | Low | That late answer also cleared `pending_request` even when it belonged to an identity release in flight. | **Fixed on mainnet (Nov 4)** (same check; the flag is left alone). | `r2_late_on_score_keeps_pending_identity_release` |
| R2-L3 | Low | The owner could shorten the grace period of loans already issued (7 days to 60 s), so late payers could be defaulted, and their identity released, a minute after the due date. | **Fixed on mainnet (Nov 4).** Grace can't be shortened while any loan is outstanding; lengthening is always allowed. | `r2_grace_cannot_shrink_while_loans_are_outstanding` |
| R2-L4 | Low | After repeated near-total losses, `shares × pool value` overflowed u128, so `get_lender` and a full withdraw panicked. | **Fixed on mainnet (Nov 4).** `mul_div` uses a 256-bit intermediate. | `r2_share_math_survives_collapse`, `r2_mul_div_wide_matches_exact_math` (checked against exact values, including u128::MAX) |
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

**Putting v4 on `kredofi.near` (done Nov 4, after the owner's yes; cap 0.1 NEAR, used 0.0924).** Build `147d863d9413b1531eacec9dd5ad69a727837c9c0de10b270e3237306c5ed148`, 299,999 bytes (`cd contracts/kredofi && cargo near build non-reproducible-wasm --no-embed-abi`, commit `40f245f`).

| # | What | Signer | Result |
|---|---|---|---|
| 1 | Storage top-up | dev `715363…` | [tx Ews7ubev…](https://nearblocks.io/txns/Ews7ubevwWF5ZdCnGqjM5mkJSKDBo5C7H1tqyJDDeMcs), 0.09 NEAR + 0.00002 fee |
| 2 | Deploy v4 + `migrate` in one transaction (10 Tgas) | `kredofi.near` | [tx Gj3X9axs…](https://nearblocks.io/txns/Gj3X9axsGU2ctvrsPLo3Uhn93YzbL9XYRtC15fHPEp5c), about 0.0023 NEAR from its own balance |
| 3 | Read-only checks | — | `view_code` sha256 = `147d863d…`; `get_config` identical to before except the new `scorer_delay_ns` = `86400000000000` (24 h) and `pending_scorer` = null; `get_pending_scorer` = null; `get_pool`, `get_stats`, the stored score (band A, 1000) and limit ($100) unchanged; storage 294,110 → 301,420 bytes; 0.0600 NEAR free (score floor 0.05) |

No new score transaction was needed: the pin (`6888c15e…`), OutLayer mode and the secrets lock are unchanged, and the free balance is above the 0.05 NEAR floor that `request_score` checks. The margin is small: each new scored borrower stores about 379 bytes (0.0038 NEAR), so about two new mainnet borrowers fit before scores pause until a top-up. (Nov 7: topped up 0.1 NEAR, [tx Ba9Gmc1u…](https://nearblocks.io/txns/Ba9Gmc1uLvfe6TB1Taqx9hPsqqKnbrZ1waJtRqYDqwcu); about 29 fit now.)

Every future mainnet re-pin now takes 24 h: publish the build and add it to OutLayer, propose, and 24 h later move the secrets lock and apply back to back.

## Open for the Pilot: time-lock `production_data`

Found Nov 4 while writing the trust table. `set_production_data` (`contracts/kredofi/src/params.rs`) takes effect at once: the owner can unlock lender deposits on `kredofi.near` with no public wait, unlike a scorer re-pin (24 h). Accepted for the MVP on the owner's decision, because the pool holds $0, and disclosed on `/trust` and `/docs/security`. On the Pilot list: **time-lock `production_data`**.

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
1. deploy the final reviewed build;
2. move the owner role to a multisig;
3. ~~add a time lock on scorer re-pins~~ built (contract v4).

## Judge review, Nov 5

| Finding | Severity | Status |
|---|---|---|
| `income_cap` is public and at $50 steps narrowed a low earner's income to about $100, against the claim that lenders never see a salary. | High (privacy) | Fixed on testnet (scorer `96666cdf…`, Nov 5): five buckets (0, 100, 250, 500, 1,000), rounded down, so no limit rises. Fixed on mainnet (scorer `5175182a…`, Nov 7, after the 24-hour lock and the owner's yes: [lock](https://nearblocks.io/txns/3Gbj22t2cMg9K2QQxKZaBgCuZ4uAq4x4aJpP9mkHRHZP), [apply](https://nearblocks.io/txns/29R9wmXS3WLbxdHEdnMSgcy38N375rp4T6mjts8DBFLd), [score, PROVEN](https://nearblocks.io/txns/9w6qBWdViZrE2Y4KisYxxjdMtbCmAvRyNvAs6WGbymHm)). Still public: the range itself, and the score can narrow it. |

## Incident, Nov 11, 2026: four key values printed in a Claude Code session

**What happened.** While checking the prize payout address against our own accounts, the AI coding agent ran a `grep` over `.env` and `web/.env.local` whose pattern matched every 64-character hex value. It printed the values of `SEAL_KEY` (mainnet), `SEAL_KEY_TESTNET`, `PARTNER_PRIVKEY`, `PROXY_SECRET` and `PARTNER_PUBKEY` (public by design). No key value is in this entry.

**Where the values went.** Only into that session: the terminal output, the session's local transcript on the developer's Mac (to be deleted after the session), and the model provider that ran the session. Not into git, the public repository, the site, Hugging Face, Cloudflare or any log we publish. A scan of all 144 commits the same day found no key value in history.

**What the keys protect today.** Only Plaid sandbox data: test banks, test identities and test money, the same for everyone.
- `SEAL_KEY` (mainnet scorer secret in OutLayer): the keyed bank fingerprints and the sealed names on `kredofi.near`. Every name sealed so far is a Plaid sandbox identity, and lender deposits on mainnet are locked until real bank data (H2).
- `SEAL_KEY_TESTNET`: the same for `app.kency.testnet` (sandbox data only).
- `PARTNER_PRIVKEY`: the demo recovery partner's key, which opens names released after a default (sandbox names only).
- `PROXY_SECRET`: lets a request claim a visitor IP to the app's rate limits.

**Done.**
- `PROXY_SECRET` rotated the same day: a new random value in `.env`, `web/.env.local`, the Hugging Face Space secret and the Cloudflare Worker secret, never printed. Checked after: kredofi.xyz pages load, a page load straight to the Space without the secret still redirects to kredofi.xyz, the rate limits key on the visitor's own IP (a request through kredofi.xyz right after a direct hit is not in the shared "direct" bucket, and a second one within 3 s gets 429), and the health watch passes.
- The cause is fixed: the agent may no longer search or print `.env`, `.env.local` or `~/.near-credentials`. A Claude Code hook (`.claude/hooks/guard_secret_reads.py`, wired in `.claude/settings.json`) blocks grep, rg, cat, head, sed and the like on those files, and recursive grep; searches use `git grep`. Rule added to CLAUDE.md.

**Still to do (must happen after Nov 25, when judging ends, and before any real bank data).** Rotate `SEAL_KEY`, `SEAL_KEY_TESTNET` and `PARTNER_PRIVKEY`. `SEAL_KEY` lives in OutLayer's secrets for the pinned mainnet build, so that rotation is a mainnet step and needs the owner's yes. A new `SEAL_KEY` changes every fingerprint, so borrowers scored before the rotation get a new fingerprint on their next score. Names sealed under the old key stay readable with the old key, so the rotation must come before any real borrower is scored. Until then the old keys protect sandbox data only.
