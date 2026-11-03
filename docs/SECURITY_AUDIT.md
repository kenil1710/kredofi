# Independent security audit (Nov 3)

A fresh agent that had not seen how the code was written audited the repo, given only the code and `docs/SPEC.md`. Its limits:

- Read-only calls to `kredofi.near` and testnet.
- 25 live HTTP requests.
- No transactions.
- Proofs written as sandbox tests and a node test outside the repo.

It found 2 High, 3 Medium, 5 Low and 5 Info findings. Fixes come with tests. Contract fixes are in the code and the sandbox suite, and reach a chain only with the next deploy:
- `app.kency.testnet` on Nov 5.
- `kredofi.near` only with the owner's yes.

| # | Severity | Finding | Status | Where / proof |
|---|---|---|---|---|
| H1 | High | Mainnet `request_score` carries the Plaid `public_token` in plain text, and nothing ties it to the sender. After a refused call, or by racing the worker, anyone can submit the token from their own account. They then get the victim's band, and the victim's bank identity is bound to the attacker. | **Accepted for now, fix planned.** The browser encrypts the token to a key held only in the enclave, with the borrower's account as associated data, and the scorer rejects a mismatch. That is a new scorer build, so a mainnet re-pin (needs a yes). Testnet is not affected: tokens go to our server with a signed NEP-413 challenge. | README Known limits, THREAT_MODEL |
| H2 | High | Mainnet uses the Plaid sandbox, where anyone can log in as a custom user with made-up income and get band A. | **Accepted, documented.** The mainnet pool holds $0 and must take no real deposits before Plaid production access. A contract-level deposit cap would be a mainnet redeploy (needs a yes). | README Known limits, THREAT_MODEL |
| M1 | Medium | If contract storage runs out between `request_score` and `on_score`, the callback fails and `pending_request` stays set for good. A non-JSON or empty OutLayer result made the SDK's deserializer panic with the same effect. | **Fixed (contract).** Details below the table. | sandbox `storage_starved_callback_is_recoverable` (the auditor's proof, now recoverable); unit `on_score_raw_bytes_never_leave_request_pending`, `on_score_raw_bytes_accepts_a_valid_answer`, `borrower_cancels_stuck_score_request`, `cancel_without_pending_request_panics`, `cancel_by_stranger_panics`, `deposit_under_one_usdc_rejected`, `deposit_of_exactly_one_usdc_accepted` |
| M2 | Medium | `/api/faucet` had no IP limit and accepted made-up implicit ids, so the testnet relayer could be drained. | **Fixed (web).** The account must exist on chain. Limits: 10 calls per IP per hour, 3 lender grants per IP per day, 300 calls and 60 grants a day in total. | `web/src/server/guards.ts` `FaucetBudget`; tests `faucet budget…` in `guards.test.ts`; live check: a random implicit id gets "does not exist" |
| M3 | Medium/Low | `/api/default` sent `mark_default` without checking the due date, so the relayer paid for refused transactions. `/api/release` had no IP limit. | **Fixed (web).** `/api/default` checks `due_at + grace` (same rule as the contract) before sending. Both routes allow 30 calls per IP per hour. | `pastDue` + test; main flow and scenarios defaults pass |
| L1 | Low | The level stays with the account when the bank identity changes, and only the latest sealed name is kept. | **Accepted, proposed.** Changing it alters SPEC level rules (reset the level on a new fingerprint, keep every sealed name). Owner decision. | auditor's sandbox proof |
| L2 | Low | Each IPv6 address was its own rate-limit bucket. | **Fixed (web).** IPv6 is keyed on its /64. | `clientIp.test.ts` "IPv6 addresses from one /64 share a bucket" |
| L3 | Low | Anyone could flood score challenges for another account and push out the nonce the owner's wallet was signing. | **Fixed (web).** Each requester (IP key) holds at most 5 open nonces per account and evicts only its own. At most 50 per account; expired entries are swept. | `ChallengeStore` + tests; wallet loop 13/13 |
| L4 | Low | The ledger showed events logged in receipts that later failed and were rolled back. | **Fixed (web).** Failed receipts are skipped. The ledger cache got a new version, so old entries are rebuilt from the index. | `events.test.ts` "events from failed (rolled-back) receipts are skipped" |
| L5 | Low | A failed withdraw transfer restores shares at the old price (tiny dilution). | **Accepted** (documented here). | |
| I1 | Info | `kredofi.near` has a full-access key: a redeploy could take any funds. | **Accepted until the final deploy.** See "Locking kredofi.near" below. | README Known limits, THREAT_MODEL |
| I2 | Info | After a total loss with shares outstanding, the pool refuses deposits for good. | **Accepted** (needs the reserve and lenders both wiped out; documented here). | |
| I3 | Info | The Space-host check relied on Hugging Face rejecting other Host headers. | **Fixed (web).** With `PROXY_SECRET` set, every request without the Worker's secret is in the shared 'direct' bucket, whatever the Host. | `clientIp.test.ts` "secret set: any request without it is direct" |
| I4 | Info | Routes returned raw near-api-js error text. | **Fixed (web).** Internal errors go to the server log, and visitors get a fixed message. Scorer messages written for visitors still pass through (`PublicError`). | `publicError` tests |
| I5 | Info | `on_score` records the version pinned when it runs, which differs only if the owner re-pins during a request. | **Accepted** (the re-pin is public and emits an event). | |

**M1 fix (contract):** three parts.
1. `on_score` and `on_release` read the result as raw bytes, at most 16 KB. An empty answer, bytes that aren't JSON or an oversized answer each become a recorded `score_failed`.
2. New `cancel_pending_score()`: the caller clears their own pending score request. Blocked borrowers can't use it. It moves no tokens and is on the rule-10 method list.
3. Lender deposits under 1 USDC are refused. `/api/health` reports `storageLow` when the contract has under 0.2 NEAR free.

The audit also checked these and found them sound:
- share math and rounding;
- first-depositor inflation;
- the token entry point;
- callbacks being private, and rollback on a failed transfer;
- owner powers (bounded, one-way treasury);
- strict score parsing;
- scorer build gates and caller source;
- the relayer allowlist;
- the NEP-413 ownership check;
- the Worker's header stripping and redirects.

Test totals after the fixes:
- `cargo test --workspace`: 128 unit tests, plus 1 + 10 + 9 + 12 + 4 + 3 sandbox and mock tests.
- Web: 73 tests.
- Browser runs on a local production build: main flow 24/24, scenarios 11/11, wallet loop 13/13.

## Locking kredofi.near (not done)

"Locking" means deleting the last full-access key of `kredofi.near`. After that nobody can sign as the contract account.

**Still works after a lock.** Owner methods are called by the owner account (`715363…`), not by `kredofi.near` itself:
- `set_*` parameters;
- `set_scorer_version`;
- `withdraw_treasury`, `treasury_to_reserve`, seeding the reserve.

So a lock does not take these powers away.

**Breaks for good after a lock:**
- Any code deploy, so no bug fixes. That includes the M1 fix above, the H1 token binding if it needs a contract change, and a mainnet deposit cap for H2.
- `migrate()` for a state change.
- Adapting if OutLayer changes its `request_execution` interface.
- Topping up storage still works (anyone can send NEAR), but the account's own NEAR can never be withdrawn and the account can't be deleted.

**Not fixed by a lock:**
- The owner can still re-pin the scorer to a build that issues any score (`set_scorer_version`, public and evented).
- The owner can still change parameters within their bounds.

So a lock alone does not make the system trustless.

**Recommendation:** don't lock now. The mainnet pool holds $0, and H1, H2 and M1 all need a mainnet redeploy. Before any real deposit:
1. deploy the final audited build;
2. move ownership to a multisig or DAO;
3. add a time lock on `set_scorer_version` so users can exit before a re-pin applies (needs code and a SPEC change: owner decision);
4. then delete the full-access key, or hand upgrades to the same time-locked DAO.
