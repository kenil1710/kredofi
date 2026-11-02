# KredoFi

KredoFi lends USDC on NEAR against your income instead of collateral. Your bank history is read and scored by a pinned program inside a TEE (OutLayer, Intel TDX); only a band, a score, a limit cap, a keyed fingerprint and your name sealed for a recovery partner ever reach the contract.

**Live demo (NEAR testnet):** https://kenil1710-kredofi.hf.space · **Documentation:** https://kenil1710-kredofi.hf.space/docs

## Try it in 3 minutes

No wallet and no sign-up: the app creates a throwaway testnet account and a relayer pays every fee.

1. Open https://kenil1710-kredofi.hf.space and click **Check my limit**. You see your empty passbook and a Plaid sandbox login.
2. Click **Connect your bank (sandbox)**. Plaid Link opens. Choose **Continue without phone number**, search **First Platypus Bank** and pick the plain one (not OAuth), log in with `user_good` / `pass_good`, then **Continue** and **Finish without saving**.
3. Wait about 10 to 20 seconds. You see "Limit checked in N s", a fetch receipt ("Plaid sent 386 transactions from 14 accounts; the scorer read the last 6 months… and none of it left"), a credit note stamped **BAND B, $75**, the five rule results, and on the right the exact output that went on-chain. No transaction, amount or name from the bank appears anywhere.
4. Click **Borrow**. A "Loan issued" entry appears with a live countdown: "Repay after 0:52 to level up to $187.50".
5. Wait for "Repaying now levels you up to $187.50", then click **Repay**. The Repaid entry says your limit rose to level 2.
6. Open **Public ledger** (top nav): every score, loan and repayment is listed with a link to its transaction, and the **Verify** panel shows the contract and the pinned scorer hash.
7. Optional, footer link **Demo scenarios**: Riya (band A, $100), Sam (refused, with the reasons and what would change them), Max (borrows and never repays; after 3 minutes anyone can mark the default, the reserve pays the pool first and his name is released to the recovery partner).

Testnet terms are shortened so the whole loop fits a demo: loan term 2 minutes, grace 1 minute, minimum hold 1 minute (mainnet: 30 days).

## The problem

You can't borrow on-chain without locking up more collateral than you borrow, and proving income off-chain means handing your whole bank history to the lender. KredoFi checks income privately: a program anyone can verify reads the history inside an enclave, applies five published rules, and returns only what a lender needs.

## What is real and what is test

| | Testnet (the live demo) | Mainnet |
|---|---|---|
| Contract | [`kredofi.kency.testnet`](https://testnet.nearblocks.io/address/kredofi.kency.testnet) | [`kredofi.near`](https://nearblocks.io/address/kredofi.near) |
| Where the scorer runs | **Dev mode**: the pinned scorer runs on our server with wasmtime, outside an enclave, and the server submits its output (`dev_submit_score`) | **OutLayer** (Intel TDX): the contract calls OutLayer itself and accepts the score only in its own callback (`on_score`) |
| Pinned scorer (SHA-256) | demo build `473be96d…` (adds sandbox profiles, the AI summary and the fetch receipt) | production build `87ceab66…`, [public wasm](https://github.com/kenil1710/kredofi-scorer-wasm) |
| Bank data | Plaid sandbox (public test logins) | Plaid sandbox (no production access yet) |
| Money | mock USDC (`musdc.kency.testnet`), test NEAR | real USDC contract configured; no loans made yet |
| AI summary | NEAR AI Cloud, generated on our server, sealed to your browser | not in the production build |
| Web app | live (Hugging Face Space) | not deployed |

Mainnet proof, all on `kredofi.near` (Nov 1, 2026):
- Deployed in OutLayer mode: [tx Ags89jDR…](https://nearblocks.io/txns/Ags89jDRYZHi4h3ZXxk4kJGenNvrrGxAiAxGHmfKvwhp); upgraded with a state migration: [tx 5fqzZSKC…](https://nearblocks.io/txns/5fqzZSKCED3sv5eg9brTHJTLxCkiDjN9uaVof2bAKK34).
- A real score computed inside OutLayer and stored by `on_score` (band A, 1000, scorer `87ceab66…`), unused fee refunded to the borrower: [tx 4dgHrA97…](https://nearblocks.io/txns/4dgHrA97KfibKifZuVZ2YF5zoAVCy4m2pXxxf9zdijyu).
- Two earlier attempts refused by OutLayer's secrets access rule before it was fixed (no score stored): [tx BCdtpGjj…](https://nearblocks.io/txns/BCdtpGjjqPeBFqjnPf7FvbgShyagerNWMM8KCFSY8qEP), [tx 2AjMgECA…](https://nearblocks.io/txns/2AjMgECA6PFJaMTQkbP5vZ3dpKATAoapWAqCocidDP4F).

How to check all of this yourself: [VERIFY.md](VERIFY.md). What is protected and what isn't: [THREAT_MODEL.md](THREAT_MODEL.md).

## How it works

```
browser ── Plaid Link (sandbox login) ──> public token
   │
   └─> request_score ──> kredofi contract ──> OutLayer (Intel TDX) runs the pinned scorer WASM
                                                 1. exchange the token, fetch 2 years of transactions
                                                 2. five rules -> band A-D, score 0-1000, income cap
                                                 3. fingerprint = HMAC(SEAL_KEY, bank identity)
                                                 4. name sealed to SEAL_KEY; rule results sealed to the browser
                                                 5. revoke the bank connection; nothing is kept
                     kredofi.on_score <── one line, under 900 bytes (no transactions, no balances)
   borrow / repay / default ──> pool of lender USDC; the reserve pays losses first
```

- **Contract** (`contracts/kredofi`, Rust, near-sdk 5): pool shares, scores, loans, levels, defaults, reserve, treasury. It trusts a score only from its own pinned OutLayer request (`on_score`, `#[private]`); a fingerprint already used by another borrower is refused (one bank identity, one borrower).
- **Scorer** (`scorer/`, Rust to `wasm32-wasip2`): Plaid fetch, the rules in [SPEC section 6](docs/SPEC.md), sealing (x25519 + ChaCha20-Poly1305). Its SHA-256 is the OutLayer `version_key` the contract pins.
- **Web** (`web/`, Next.js 16): landing page, passbook (`/borrow`), lender page (`/lend`), public ledger (`/ledger`), demo scenarios (`/scenarios`); a relayer for no-wallet accounts; the Dev-mode scorer runner.

Rules (SPEC 6): income level (250 points), steady income (250), on-time payments (250), money left over (150), savings buffer (100). Bands: A from 800, B 650-799, C 500-649, D below 500 (no loan). Limit = min(level cap x band share, income cap); level caps $100, $250, $500, $1,000; band shares A 100%, B 75%, C 50%. One borrower can take at most 10% of the pool. Interest per term: A 4%, B 6%, C 8%; lenders get half, the KredoFi treasury half.

## NEAR features used

| Feature | Where |
|---|---|
| TEE (OutLayer, Intel TDX) with a pinned WASM version and encrypted secrets | `contracts/kredofi/src/score.rs` (`request_score`, `on_score`), `scorer/` |
| Private AI (NEAR AI Cloud, `Qwen/Qwen3.8-27B`, thinking off) | `scorer/src/lib.rs` (`demo::summary_request`), testnet only |
| Stablecoins (NEP-141 `ft_transfer_call` for deposit and repay) | `contracts/kredofi/src/lib.rs`, `contracts/mock-usdc` |
| NEAR Intents 1Click (USDC from Base, Ethereum, Arbitrum, Solana; dry-run quotes only) | `web/src/lib/intents.ts`, `web/src/app/api/intents/quote/route.ts` |
| Meta transactions (the relayer pays all gas for demo accounts) | `web/src/app/api/relay/route.ts`, `web/src/lib/near/account.tsx` |
| Named sub-accounts (`demo<ms>.relayer.kency.testnet`) | `web/src/app/api/demo/route.ts` |
| NEP-297 events (the public ledger is built from them) | `contracts/kredofi/src/events.rs`, `web/src/lib/events.ts` |
| NEAR Connect wallet selector | `web/src/lib/near/wallet.tsx` |

## Tracks

- `privacy`: bank data is read only inside the TEE (mainnet); the chain gets a band and a keyed fingerprint; the name is sealed and opens only after a default.
- `realworld`: income-based USDC credit with a recovery path, as a consumer lender would run it, without the lender seeing statements.
- `defi`: a lending pool with share accounting, a first-loss reserve, a treasury and cross-chain deposits through NEAR Intents.

## Run the tests

```bash
cargo test --workspace                   # contracts: 121 unit + 3 mock-usdc + 35 near-workspaces sandbox tests
(cd scorer && cargo test)                # scorer: 36 tests (reproduces the SPEC 6 table: Riya 1000/A, Sam 270/D, Max 1000/A)
(cd web && npm install && npm test)      # web: 47 tests (incl. a check that every docs link works)
(cd scripts && npm install && node --test seal.test.mjs)   # JS and Rust seal compatibility
```

Every security rule in [SPEC section 7](docs/SPEC.md) has a test. Build and run commands: `CLAUDE.md` (Commands); hosting: [docs/DEPLOY_HF.md](docs/DEPLOY_HF.md).

## Known limits

- Bank data is Plaid sandbox only. Real banks need Plaid production access and a licensed lending partner.
- The live demo is testnet in Dev mode: the scorer runs on our server, not in an enclave. Only mainnet uses OutLayer, and no mainnet loan has been made.
- On testnet every judge can use the shared sandbox login because the testnet scorer ties the sandbox identity to your NEAR account ([SPEC 8c](docs/SPEC.md)); the mainnet build keeps the strict one-identity rule.
- The production scorer WASM contains absolute build paths, so rebuilding it on another machine gives a different hash; verify the published file instead ([VERIFY.md](VERIFY.md)).
- Both contract accounts still have their full-access keys, so the owner can redeploy the code. Owner methods can't move lender funds or the reserve (rule 10, tested), but a redeploy could. See [THREAT_MODEL.md](THREAT_MODEL.md).
- Trust assumptions: Intel TDX, OutLayer's worker registration, Plaid, NEAR AI Cloud (summary only; the score never depends on it).

Built for NEAR HACKATHON, November 2026. Specification: [docs/SPEC.md](docs/SPEC.md). Build log: [docs/LOG.md](docs/LOG.md).
