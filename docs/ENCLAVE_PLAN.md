# Plan: judges score inside the real enclave on testnet

Status (Nov 3): **proposed, not executed.** Needs the owner's yes for the two items marked **yes**.

## What was checked (Nov 3, testnet only)

| Check | Result | Transaction |
|---|---|---|
| OutLayer testnet workers respond | Yes. A direct run of our public scorer WASM answered in about 20 s (Oct 24-25 they timed out). | [`2gBFn4yd…`](https://testnet.nearblocks.io/txns/2gBFn4ydfJ6oqDSGR8i6gKmE4hJCAqyL1Cx6G1SGs6yH) |
| One real `request_score` on testnet | **Works.** Throwaway contract `kredofi-oltest-1793692348.testnet` (same `kredofi` wasm, `scorer_mode: OutLayer`, `outlayer.testnet`), project `kency.testnet/kredofi-scorer` with the public production scorer `7048cc92…`, secrets profile `kredofi` locked to `build:7048cc92… and from:<that contract>`. Plaid sandbox token, borrower signs `request_score` with 0.01 NEAR: OutLayer ran the scorer in 8.3 s, `on_score` stored band A 1000, `score_issued` emitted, 0.0082 NEAR refunded straight to the borrower. | [`EYqjio5X…`](https://testnet.nearblocks.io/txns/EYqjio5XCvWsqV5zX2w8Doj4sGtUesWFAxKUDP5E84pH) |

Cost of that score, read from the receipts: OutLayer charged 0.00183 NEAR; the borrower spent 0.00308 NEAR in total including gas. Script: `scripts/testnet_outlayer_check.mjs`.

So the fallback (a mainnet "judge" deployment with a worthless token) is **not needed**.

## What the switch needs (it isn't zero code)

The contract needs no change, but the mode is set at `new` and there is no `set_scorer_mode`, so `kredofi.kency.testnet` stays in Dev mode. The switch is the **new** demo contract: deploy `app.kency.testnet` (already planned for Nov 5) in OutLayer mode instead of Dev.

1. **Scorer build for testnet OutLayer (small scorer change, new hash).** Judges need the testnet behaviour "one sandbox login, many judges": the Plaid sandbox identity scoped per account (SPEC, `scope_identity_to_account`). Only the demo build has it, and the demo build prints the output twice (early print for the Dev server, then the final line), which OutLayer would not parse as one JSON value. Add a feature `testnet-outlayer` = scoped identity, no early print, no profiles. Build it in CI (canonical x86_64) and run it locally against Plaid sandbox.
2. **yes: publish that WASM** at a commit-pinned URL in the public `kenil1710/kredofi-scorer-wasm` repo (OutLayer fetches code only from a public URL). Then `outlayer deploy` it as a new version of `kency.testnet/kredofi-scorer` (testnet), and lock the secrets to `build:<new hash> and from:app.kency.testnet`.
3. **Web: an OutLayer path in the passbook** (`NEXT_PUBLIC_SCORER_MODE=outlayer`):
   - The demo account or wallet signs `request_score(public_token, reply_pubkey)` with 0.01 NEAR and 150 Tgas.
   - The page waits for `on_score` (polls `get_borrower`).
   - The page reads the sealed `reply` (rule results) from the OutLayer result in the transaction's receipts.
   - Scenarios (Riya/Sam/Max/custom): the server creates a Plaid sandbox `user_custom` token from the profile (as `scripts/mainnet_score.mjs` does), so the profile is fetched from Plaid inside the enclave, not passed in.
   - Default: `request_identity_release` attaches 0.01 NEAR.
   - `/api/score` (wasmtime on our server) is off in this mode.

   Tests: the main flow, the wallet loop and scenarios on a local server against a throwaway OutLayer-mode contract.
4. **yes: deploy `app.kency.testnet`** in OutLayer mode (Nov 5, with the ledger switch). The seeding script uses `request_score` with sandbox custom tokens instead of `dev_submit_score`.
5. Docs: testnet scoring then runs in the enclave too, so the testnet caveats on /trust, /docs and the README change to "same enclave as mainnet; test bank and test money".

Time: about one day (Nov 4) for steps 1 and 3 with tests; 2 and 4 on the owner's yes.

## Who pays: the relayer, through the account balance

`request_score` requires `signer == predecessor` (OutLayer's `sender_id` must be the borrower), so a NEP-366 meta-transaction can't carry it: the relayer would be the signer. Instead the relayer funds the account, and the account signs.

- **Demo accounts:** already created and funded by the relayer (0.05 NEAR). That covers the 0.01 fee plus 150 Tgas, and about 0.008 comes back.
- **Wallet users:** one top-up of 0.03 NEAR from the relayer, on the first score of an account under 0.03 NEAR. It needs the ownership challenge (NEP-413 signature), is once per account, and is capped per IP.

## Cost per judge (testnet NEAR, measured where marked)

| Item | NEAR |
|---|---|
| Score through OutLayer (fee charged + gas), measured Nov 3 | 0.003 |
| Demo account creation (account + test-USDC storage), from DEPLOY_HF.md | 0.007 |
| Borrower storage on the contract | 0.002 |
| Loan + repay (+ default and identity release on the Max path, 0.003 OutLayer) | 0.005 |
| **Spent per judge** | **≈ 0.017** |
| Left in each demo account (0.05 funding minus the above; not recoverable) | ≈ 0.04 |
| **Relayer outlay per judge** | **≈ 0.05-0.06** |

**200 judges ≈ 3.5 NEAR spent, ≈ 11-12 NEAR out of the relayer** (cut it to about 7 NEAR by funding demo accounts with 0.03). All testnet NEAR from the faucet (10 NEAR per faucet account). No mainnet NEAR.

## Abuse limits

| Limit | Value | Where |
|---|---|---|
| Demo accounts | 5 per IP per hour (existing) + **new** 60 per day in total | `/api/demo` |
| Scores | 15 per IP per hour (existing); one pending request per borrower (contract) | `/api/score`, contract |
| Wallet fee top-ups | **new:** once per account, 3 per IP per day, 50 per day in total, signed challenge | new relayer route |
| Relayer budget | **new:** stop funding when the relayer drops below 3 NEAR; `/api/health` reports `relayerLow` for the monitor | `/api/health` |
| Client IP | Cloudflare `CF-Connecting-IP`, trusted only with the Worker secret (Nov 3) | `server/clientIp.ts` |

An attacker who rotates IPs can drain at most the daily caps: 60 × 0.05 + 50 × 0.03 = 4.5 testnet NEAR a day. Worst case is testnet NEAR only; scoring then pauses until a top-up.

## Left on testnet after the check

`kredofi-oltest-1793692348.testnet` (throwaway, OutLayer mode, holds about 7 testnet NEAR) and the testnet OutLayer project `kency.testnet/kredofi-scorer` (production build `7048cc92…`; secrets readable only from that throwaway contract). Nothing on mainnet changed.
