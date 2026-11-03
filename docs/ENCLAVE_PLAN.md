# Plan: judges score inside the real enclave on testnet

Status (Nov 3): **built and tested on a throwaway testnet contract; the owner said yes to the Nov 5 switch.** `app.kency.testnet` is deployed on Nov 5 (runbook below).

## What was checked (Nov 3, testnet only)

| Check | Result | Transaction |
|---|---|---|
| OutLayer testnet workers respond | Yes. A direct run of our public scorer WASM answered in about 20 s (Oct 24-25 they timed out). | [`2gBFn4yd…`](https://testnet.nearblocks.io/txns/2gBFn4ydfJ6oqDSGR8i6gKmE4hJCAqyL1Cx6G1SGs6yH) |
| One real `request_score` on testnet | **Works.** Throwaway contract `kredofi-oltest-1793692348.testnet` (same `kredofi` wasm, `scorer_mode: OutLayer`, `outlayer.testnet`), project `kency.testnet/kredofi-scorer` with the public production scorer `7048cc92…`, secrets profile `kredofi` locked to `build:7048cc92… and from:<that contract>`. Plaid sandbox token, borrower signs `request_score` with 0.01 NEAR: OutLayer ran the scorer in 8.3 s, `on_score` stored band A 1000, `score_issued` emitted, 0.0082 NEAR refunded straight to the borrower. | [`EYqjio5X…`](https://testnet.nearblocks.io/txns/EYqjio5XCvWsqV5zX2w8Doj4sGtUesWFAxKUDP5E84pH) |

Cost of that score, read from the receipts: OutLayer charged 0.00183 NEAR; the borrower spent 0.00308 NEAR in total including gas. Script: `scripts/testnet_outlayer_check.mjs`.

So the fallback (a mainnet "judge" deployment with a worthless token) is **not needed**.

## Built and tested (Nov 3, owner's yes)

| Piece | Where | Proof |
|---|---|---|
| Scorer build `testnet-outlayer` (production + per-account sandbox identity; one output line; sealed tokens only) | `scorer/` feature `testnet-outlayer`; CI run 41623343936: `0515ebcad56ec6569a13a9fdc76e523025c6fd3daed399d4560604c8262e03b9` | Published at `kenil1710/kredofi-scorer-wasm@fa82707` (URL hash checked); added to `kency.testnet/kredofi-scorer` on `outlayer.testnet` |
| OutLayer-mode deploy script | `scripts/deploy_outlayer_testnet.sh <account>` (creates the sub-account, deploys v3 in OutLayer mode, registers test USDC, locks the secrets to build + contract) | Throwaway `kredofi-ol2-1793703603.kency.testnet` |
| H1 in the enclave | sealed tokens | A copied token was refused (testnet tx `5cyWM6Mz…`); the owner's own request scored band A in 7.8 s (testnet tx `pNRfqHTC…`) |
| Web OutLayer path (`NEXT_PUBLIC_SCORER_MODE=outlayer`) | Details below | Local runs against the throwaway: main flow 23/24, scenarios 11/11, wallet loop 12/13 (the misses are the fetch receipt, which enclave runs don't report) |
| Seeded ledger in OutLayer mode | `seed_ledger.mjs` detects `scorer_mode` and scores with sealed sandbox tokens signed by each seeded borrower; `setup` tops each borrower up to 0.25 NEAR | Throwaway: borrower 02 scored A in the enclave, took two loans and repaid both; borrower 22 scored D |
| Copy | Landing, `/trust`, `/docs`, Passbook follow `SCORER_MODE`; they say "in the enclave" for testnet only when the build runs in OutLayer mode | `docs` rendered in both modes |

What the web OutLayer path does:
- The browser seals the token, and the account signs `request_score` itself.
- The output is read back from the transaction, including after a reload or on a new device.
- Prepared borrowers come from `/api/plaid/sandbox`.
- A default releases the name through the enclave.
- `/api/score` and `/api/release` are switched off.

## Who pays: the relayer, through the account balance

`request_score` requires `signer == predecessor`, so a NEP-366 meta-transaction can't carry it: the relayer would be the signer. Instead, the relayer funds the account and the account signs.

Measured on Nov 3: NEAR checks the balance up front at the pessimistic gas price. So the account needs about **0.16 NEAR available** (0.01 fee + 150 Tgas) to sign, although only about 0.003 is spent.

- **Demo accounts:** funded with 0.2 NEAR at creation. Right after the score, the browser sends everything above 0.02 back to the relayer.
- **Wallets, and demo accounts scoring again:** `/api/fund` tops the account up to 0.2 when it has less than 0.17. It needs a signed one-time challenge, and allows at most 3 per account and 5 per network a day, 60 a day in total. Wallets keep the top-up.

## Cost per judge (testnet NEAR)

| Item | NEAR |
|---|---|
| Score through OutLayer (fee charged + gas), measured | 0.003 |
| Demo account storage + test-USDC registration | about 0.003 |
| Kept in the demo account after the return (later fees) | 0.02 |
| Relayer gas for account creation and about 10 relayed actions | about 0.005 |
| Max path only: identity release through the enclave (relayer pays) | 0.003 |
| **Net per judge (demo account)** | **about 0.03** |
| Peak outlay before the leftover comes back | 0.2 |

**200 judges ≈ 6–7 NEAR net.** If browsers close before the return, the worst case is 0.2 per account.

The relayer holds about 17.8 testnet NEAR after the Nov 3 top-up (faucet accounts, 10 NEAR each).

## Abuse limits

| Limit | Value | Where |
|---|---|---|
| Demo accounts | 5 per IP per hour + 60 per day in total; none while the relayer is under 3 NEAR | `/api/demo` |
| Score fee top-ups | signed challenge; 3 per account, 5 per network, 60 in total per day; none under 3 NEAR | `/api/fund` |
| Prepared-borrower sandbox tokens | 15 per network per hour, 1 per account per 20 s | `/api/plaid/sandbox` |
| One pending request per borrower | contract | `request_score` |
| Relayer floor | `relayerLow` in `/api/health` for the monitor | `/api/health` |
| Client IP | Cloudflare `CF-Connecting-IP`, trusted only with the Worker secret; IPv6 per /64 | `server/clientIp.ts` |

**Worst case per day, if nothing is returned:** (60 + 60) × 0.2 = 24 testnet NEAR. Then funding stops at the 3 NEAR floor, and scoring needs a wallet with its own test NEAR until the relayer is topped up from the faucet. No mainnet NEAR is involved.

## Nov 5 runbook (on the owner's yes, given Nov 3)

1. `set -a; source .env; set +a; ./scripts/deploy_outlayer_testnet.sh app.kency.testnet 4` (contract v3 with the audit fixes, OutLayer mode, secrets locked to `0515ebca…` and `app.kency.testnet`).
2. `KREDOFI_CONTRACT=app.kency.testnet ./scripts/reserve_guard.sh`, plus a lender deposit for borrowing room.
3. `KREDOFI_CONTRACT=app.kency.testnet node --experimental-strip-types scripts/seed_ledger.mjs setup`; then the repository variables `SEED_CONTRACT=app.kency.testnet` and `SEED_START`.
4. Space: `NEXT_PUBLIC_SCORER_MODE=outlayer NEXT_PUBLIC_KREDOFI_CONTRACT=app.kency.testnet uv run --with huggingface_hub==0.36.0 python scripts/hf_space.py push --space kenil1710/kredofi`.
5. Live checks on kredofi.xyz: main flow, scenarios, wallet loop; `/api/health`.
6. README and VERIFY.md: the testnet demo scores in the enclave (`0515ebca…`); hero, `/trust` and `/docs` flip by themselves with `SCORER_MODE`.

## Left on testnet after the check

`kredofi-oltest-1793692348.testnet` (throwaway, OutLayer mode, holds about 7 testnet NEAR) and the testnet OutLayer project `kency.testnet/kredofi-scorer` (production build `7048cc92…`; secrets readable only from that throwaway contract). Nothing on mainnet changed.
