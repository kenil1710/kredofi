# Security audit (Nov 3, 2026)

An independent agent audited KredoFi. It had not seen how the code was written and was given only the repository and `docs/SPEC.md`. Its limits:
- read-only calls to `kredofi.near` and testnet;
- 25 live HTTP requests;
- no transactions;
- proofs written as sandbox tests and a node test.

It found 2 High, 3 Medium, 5 Low and 5 Info issues. Every finding below has a status and either the commit that fixes it or the reason it is accepted. Commits are in this repository; "testnet tx" and "tx" link to the explorers.

**Where things stand:**
- **Code:** every fix is in `main`, with tests.
- **Live testnet site (`kredofi.kency.testnet`, Dev mode):** the web fixes are live.
- **`app.kency.testnet` (OutLayer mode, from Nov 5):** contract and scorer fixes ship there.
- **Mainnet `kredofi.near`:** contract and scorer fixes wait for the owner's yes on each transaction (`docs/MAINNET_PLAN.md`). The mainnet pool holds $0 and no mainnet loan has been made.

## Findings

| # | Severity | Finding | Status | Fix commit / reason | Tests and proof |
|---|---|---|---|---|---|
| H1 | High | Mainnet `request_score` carried the Plaid `public_token` in plain text, and nothing tied it to the sender. Anyone who copied a token (from a refused call, or by racing the worker) could have that bank scored for their own account. The bank identity was then bound to them. | **Fixed in code and on testnet. Mainnet re-pin waits for a yes.** The browser seals `account + token` to a key that only the scorer holds (`sealed1:`). The scorer refuses a token sealed for another account before any Plaid call, and on-chain builds refuse plain tokens. | `2d5ca4d` (scorer, JS sealing, SPEC "Sealed token"); `edf4389` (testnet build `0515ebca…` in OutLayer); `69f373e` (web) | `h1_*` scorer tests. Testnet enclave: the copied token was refused (testnet tx `5cyWM6MzXs3ySgwxLRtzeZ3ztcVjtgAnzb7Ggv5pRT3u`, `score_failed` "sealed for another account"), and the owner's own request with the same token scored band A (testnet tx `pNRfqHTCWdePuuYs5YkxjrQYTRQ6ERWMf7qNtMvjAqp`). |
| H2 | High | Mainnet scores come from the Plaid sandbox, where anyone can invent an income and get band A. Many accounts could each borrow and default. | **Fixed in code. Mainnet deploy waits for a yes.** Contract v3: lender deposits are refused until the owner sets `production_data`, which must wait for Plaid production access. Testnet contracts aren't gated. Documented in the README and THREAT_MODEL. | `2d5ca4d` | Unit `h2_*`; sandbox `migrate_from_deployed_v2_keeps_everything` (migrates the real deployed v2 binary; deposits are refunded until the flag is set; owner only). |
| M1 | Medium | If contract storage ran out between `request_score` and `on_score`, or OutLayer returned bytes that weren't JSON, `pending_request` stayed set for good and the borrower was locked out. | **Fixed in code** (testnet from Nov 5; mainnet with the v3 deploy). The callback reads raw bytes (at most 16 KB) and records any bad answer as `score_failed`. A borrower can call `cancel_pending_score` to clear their own stuck request. Lender deposits must be at least 1 USDC. `/api/health` reports `storageLow`. | `1654b39` (contract), `224ab9b` (health) | Sandbox `storage_starved_callback_is_recoverable` (the auditor's proof, now recoverable); unit `on_score_raw_bytes_*`, `borrower_cancels_stuck_score_request`, `cancel_*`, `deposit_under_one_usdc_rejected`. |
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

**Found before the audit (domain work, Nov 3):** the Space's `X-Forwarded-For` header could be forged to dodge rate limits (22 of 22 spoofed requests got through). **Fixed, live** in `39995f2`: through the Worker the app trusts only Cloudflare's client IP, and direct Space hits share one bucket.

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

## Tests after the fixes

- Contracts (`cargo test --workspace`): 133 unit, 36 sandbox and 3 mock.
- Scorer: 39 tests.
- Web: 76 tests.
- Browser runs:
  - Dev mode (live site): main flow 24/24, scenarios 11/11, wallet loop 13/13.
  - OutLayer mode (local, throwaway contract): main flow 23/24, scenarios 11/11, wallet loop 12/13. The only misses are the fetch receipt, which enclave runs don't report.

## Locking `kredofi.near` (not done)

Locking means deleting the contract account's last full-access key.

**Still works after a lock.** Owner methods are called by the owner account (`715363…`), not by `kredofi.near` itself:
- parameters and `set_production_data`;
- scorer re-pins;
- treasury withdrawals and moves to the reserve.

**Breaks for good after a lock:**
- every code deploy and migration, so no bug fixes and no adapting to OutLayer API changes;
- withdrawing the account's own NEAR.

**Not fixed by a lock:** the owner can still re-pin the scorer to any build.

**Recommendation:** lock last, after these steps (also on `/docs/roadmap`):
1. deploy the final audited build;
2. move the owner role to a multisig;
3. add a time lock on scorer re-pins.
