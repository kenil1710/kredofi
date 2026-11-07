# KredoFi

**Prove your income on NEAR without showing your bank statements.**

A pinned, open scorer fetches up to two years of bank history, uses the last six full months, applies five published rules, and puts exactly eight fields on-chain: `v`, `caller`, `band`, `score`, `income_cap`, `fingerprint`, `sealed_identity`, `reply` (a band, a score and a limit cap, a keyed fingerprint, a sealed name, sealed rule results). No transactions, balances or account numbers leave it.
- **Mainnet** (`kredofi.near`): the scorer runs inside a TEE (OutLayer, Intel TDX), and the contract accepts a score only from its own request to the pinned build ([a real score, Nov 7](https://nearblocks.io/txns/9w6qBWdViZrE2Y4KisYxxjdMtbCmAvRyNvAs6WGbymHm)).
- **Testnet demo** (since Nov 4): a testnet build of the same scorer also runs inside the enclave (OutLayer testnet), and the contract accepts a score only from its own request, as on mainnet.

**First use: no-collateral USDC loans.** Borrow up to your limit, repay one fixed amount, and the limit grows. Any NEAR contract or app can read the same band and limit with view calls: [Use KredoFi scores in your app](https://kredofi.xyz/docs/integrate).

**Live demo (NEAR testnet):** https://kredofi.xyz · **Documentation:** https://kredofi.xyz/docs · **Mainnet proof (live from `kredofi.near`):** https://kredofi.xyz/mainnet

## Try it in 3 minutes

No wallet and no sign-up: the app creates a throwaway testnet account and a relayer pays every fee.

1. Open https://kredofi.xyz and click **Check my limit**. You see your empty passbook and a Plaid sandbox login.
2. Click **Connect your bank (sandbox)**. Plaid Link opens. Choose **Continue without phone number**, search **First Platypus Bank** and pick the plain one (not OAuth), log in with `user_good` / `pass_good`, then **Continue** and **Finish without saving**.
3. Wait about 20 seconds, up to about a minute when the test bank is slow, while the scorer runs in the enclave (OutLayer testnet). You see "Limit checked in N s", a credit note stamped **BAND B, $75**, the five rule results, and on the right the exact output that went on-chain. No transaction, amount or name from the bank appears anywhere.
4. Click **Borrow**. A "Loan issued" entry appears with a live countdown: "Repay after 0:52 to level up to $187.50".
5. Wait for "Repaying now levels you up to $187.50", then click **Repay**. The Repaid entry says your limit rose to level 2.
6. Open **Public ledger** (top nav): every score, loan and repayment is listed with a link to its transaction, and the **Verify** panel shows the contract and the pinned scorer hash.
7. Optional, footer link **Demo scenarios**: Riya (band A, $100), Sam (refused, with the reasons and what would change them), Max (borrows and never repays; after 3 minutes anyone can mark the default, the reserve pays the pool first, up to its balance, and his name is released to the recovery partner).

Testnet terms are shortened so the whole loop fits a demo:

| | Testnet demo | Mainnet |
|---|---|---|
| Loan term | 2 minutes | 30 days |
| Grace after the due date | 1 minute | 7 days |
| Minimum hold for a level-up | 1 minute | 15 days |
| Score valid for | 30 days | 30 days |
| Scorer re-pin time lock | 1 minute | 24 hours |

## The problem

You can't borrow on-chain without locking up more collateral than you borrow, and proving income off-chain means handing your whole bank history to the lender. KredoFi checks income privately: a program anyone can verify reads the history (inside an enclave on mainnet), applies five published rules, and returns only what a lender needs.

## What is real and what is test

| | Testnet (the live demo) | Mainnet |
|---|---|---|
| Contract | [`app.kency.testnet`](https://testnet.nearblocks.io/address/app.kency.testnet) (since Nov 4, contract v4; the Nov 1–4 Dev-mode contract [`kredofi.kency.testnet`](https://testnet.nearblocks.io/address/kredofi.kency.testnet) now holds only our own test runs, history kept) | [`kredofi.near`](https://nearblocks.io/address/kredofi.near) |
| Where the scorer runs | **OutLayer testnet** (Intel TDX): your account signs `request_score` itself (a relayer funds the fee), the contract calls OutLayer and accepts the score only in its own callback (`on_score`). Your browser seals the Plaid token to the enclave first | **OutLayer** (Intel TDX): the contract calls OutLayer itself and accepts the score only in its own callback (`on_score`) |
| Pinned scorer (SHA-256) | testnet build `96666cdf…` (production logic and sealed tokens, plus the shared sandbox login tied to your account; no fetch receipt) | production build `5175182a…` (sealed Plaid tokens, `income_cap` buckets), [public wasm](https://github.com/kenil1710/kredofi-scorer-wasm); both built reproducibly on x86_64 Linux ([VERIFY.md](VERIFY.md)) |
| Bank data | Plaid sandbox (public test logins) | Plaid sandbox (no production access yet) |
| Money | mock USDC (`musdc.kency.testnet`), test NEAR | real USDC contract configured; lender deposits locked until real bank data; no loans made |
| AI summary | NEAR AI Cloud, asked for by your browser after the score (band + rule results only, `web/src/app/api/summary/route.ts`) | not in the production build |
| Web app | live at https://kredofi.xyz (Cloudflare Worker in front of a Hugging Face Space) | no mainnet app; [/mainnet](https://kredofi.xyz/mainnet) is a read-only view of `kredofi.near` |

How to check all of this yourself: [VERIFY.md](VERIFY.md). What is protected and what isn't: [THREAT_MODEL.md](THREAT_MODEL.md). The short version for visitors: [/trust](https://kredofi.xyz/trust).

## How it works

```
browser ── Plaid Link (sandbox login) ──> public token
   │
   └─> request_score ──> kredofi contract ──> OutLayer (Intel TDX) runs the pinned scorer WASM
                                                 1. open the sealed token, fetch up to 2 years (rules use the last 6 months)
                                                 2. five rules -> band A-D, score 0-1000, income cap
                                                 3. fingerprint = HMAC(SEAL_KEY, bank identity)
                                                 4. name sealed to SEAL_KEY; rule results sealed to the browser
                                                 5. revoke the bank connection; nothing is kept
                     kredofi.on_score <── one line, under 900 bytes (no transactions, no balances)
   borrow / repay / default ──> pool of lender USDC; the reserve pays losses first
```

- **Contract** (`contracts/kredofi`, Rust, near-sdk 5): pool shares, scores, loans, levels, defaults, reserve, treasury. In OutLayer mode (mainnet) it trusts a score only from its own pinned OutLayer request (`on_score`, `#[private]`); in Dev mode (local runs and the old test contract) it also takes `dev_submit_score` from one configured scorer account; a fingerprint already used by another borrower is refused (one bank identity, one borrower).
- **Scorer** (`scorer/`, Rust to `wasm32-wasip2`): Plaid fetch, the rules in [SPEC section 6](docs/SPEC.md), sealing (x25519 + ChaCha20-Poly1305). Its SHA-256 is the OutLayer `version_key` the contract pins.
- **Web** (`web/`, Next.js 16): landing page, passbook (`/borrow`), lender page (`/lend`), public ledger (`/ledger`), demo scenarios (`/scenarios`); a relayer for no-wallet accounts; the Dev-mode scorer runner.

Rules (SPEC 6): income level (250 points), steady income (250), on-time payments (250), money left over (150), savings buffer (100). Bands: A from 800, B 650-799, C 500-649, D below 500 (no loan). Limit = min(level cap x band share, income cap); level caps $100, $250, $500, $1,000; band shares A 100%, B 75%, C 50%. One borrower can take at most 10% of the pool. Interest per term: A 4%, B 6%, C 8%; lenders get half, the KredoFi treasury half.

## NEAR features used

| Feature | Where |
|---|---|
| TEE (OutLayer, Intel TDX) with a pinned WASM version and encrypted secrets | `contracts/kredofi/src/score.rs` (`request_score`, `on_score`), `scorer/` |
| Private AI: Qwen with a NEAR AI fallback (NEAR AI Cloud, `Qwen/Qwen3.8-27B`, after 8 s `Qwen/Qwen3.6-35B-A3B-FP8`, thinking off) | `web/src/lib/aiSummary.ts` (`summaryRequest`, tested), testnet only |
| Stablecoins (NEP-141 `ft_transfer_call` for deposit and repay) | `contracts/kredofi/src/lib.rs`, `contracts/mock-usdc` |
| NEAR Intents 1Click (USDC from Base, Ethereum, Arbitrum, Solana; dry-run quotes only) | `web/src/lib/intents.ts`, `web/src/app/api/intents/quote/route.ts` |
| Meta transactions (the relayer pays all gas for demo accounts) | `web/src/app/api/relay/route.ts`, `web/src/lib/near/account.tsx` |
| Named sub-accounts (`demo<ms>.relayer.kency.testnet`) | `web/src/app/api/demo/route.ts` |
| NEP-297 events (the public ledger is built from them) | `contracts/kredofi/src/events.rs`, `web/src/lib/events.ts` |
| NEAR Connect wallet selector | `web/src/lib/near/wallet.tsx` |

## Tracks

- `privacy`: bank data is read only inside the TEE (mainnet); the chain gets a band and a keyed fingerprint; the name is sealed and opens only after a default.
- `defi`: a lending pool with share accounting, a first-loss reserve and a treasury; cross-chain deposit quotes from NEAR Intents 1Click (dry run only: Intents has no testnet, [docs/INTENTS_PLAN.md](docs/INTENTS_PLAN.md)).
  A second contract acts on the score, too: [`partner-vault.kency.testnet`](https://kredofi.xyz/integrate) reads a band and asks for 110% collateral from band A against 150% standard, with no change to KredoFi (testnet demo; real positions: [band A](https://testnet.nearblocks.io/txns/8u7XnMuxpnewZ5YL6BztMWfx7pELQXYk5TcVRH8E2Sdg), [band D](https://testnet.nearblocks.io/txns/Bmnhbgu2pEKkhEUqUb1SHF8hgMBeriSrkrpcn1DHzpL5)).
- `realworld`: income-based USDC credit with a recovery path, without the lender seeing statements.

## Run the tests

Needs Rust via rustup (the repo's `rust-toolchain.toml` installs 1.93.0 and the wasm target on first use), Node 22 and Python 3. The first `cargo test` downloads the NEAR sandbox node and builds the contracts (about 5 to 10 minutes).

```bash
cargo test --workspace                   # contracts: 169 unit + 3 mock-usdc + 17 partner-vault + 50 near-workspaces sandbox tests
(cd scorer && cargo test)                # scorer: 40 tests (reproduces the SPEC 6 table: Riya 1000/A, Sam 270/D, Max 1000/A)
(cd web && npm install && npm test)      # web: 98 tests (incl. a check that every docs link works)
(cd scripts && npm install && node --test seal.test.mjs)   # JS and Rust seal compatibility (1 of 3 skips without the partner key)
```

Every security rule in [SPEC section 7](docs/SPEC.md) has a test. Building the scorer WASM needs the `wasm32-wasip2` target and, for the pinned bytes, Docker on x86_64 ([VERIFY.md](VERIFY.md) section 3). Hosting: [docs/DEPLOY_HF.md](docs/DEPLOY_HF.md).

## Verify it yourself

No keys needed. The full walk-through, with what each result means, is in [VERIFY.md](VERIFY.md).

```bash
# Which scorer does the mainnet contract trust? Are lender deposits locked?
curl -s https://rpc.mainnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kredofi.near","method_name":"get_config","args_base64":""}}' \
  | python3 -c "import json,sys;c=json.loads(bytes(json.load(sys.stdin)['result']['result']));print(c['scorer_mode'],c['scorer_version'],c['require_production_data'],c['production_data'])"

# Is the published WASM that exact file? (5175182a…)
curl -sL https://raw.githubusercontent.com/kenil1710/kredofi-scorer-wasm/fd039dc761f43dd6c517f05df57f735179039b77/kredofi_scorer.wasm | shasum -a 256

# Did the Nov 7 mainnet score run inside Intel TDX? Expect PROVEN.
cargo install --git https://github.com/out-layer/outlayer-verify outlayer-verify
outlayer-verify tx 9w6qBWdViZrE2Y4KisYxxjdMtbCmAvRyNvAs6WGbymHm --api https://api.outlayer.ai
outlayer-verify bundle docs/proofs/mainnet-score-2026-11-07.attestation.json --offline   # same check, from the saved evidence

# Rebuild the scorer: x86_64 with Docker, or the GitHub workflow "scorer reproducible build" in a fork
./scorer/build-docker.sh                    # production
./scorer/build-docker.sh testnet-outlayer   # testnet enclave build
```

## Build and run

```bash
(cd contracts/kredofi && cargo near build non-reproducible-wasm)
(cd web && npm install && npx next build && npx next start)   # server secrets: web/.env.local, names in .env.example
```

## Built with

Versions are exact (from the lock files).

| Part | Libraries |
|---|---|
| Contracts | `near-sdk` 5.29.1, `near-contract-standards` 5.29.1 (mock USDC); tests: `near-workspaces` 0.23.0, `cargo-near-build` 0.11.5, `tokio` 1.54.1 |
| Scorer | `serde_json` 1.0.154, `x25519-dalek` 2.0.1, `chacha20poly1305` 0.10.1, `sha2` 0.10.9, `hmac` 0.12.1, `getrandom` 0.3.4, `base64` 0.22.1, `wasi-http-client` 0.2.1 (vendored with our patch for request bodies over 4 KB, `scripts/fix_http.py`) |
| Web | `next` 16.4.3, `react` 19.3.1, `@hot-labs/near-connect` 0.11.4, `near-api-js` 7.4.0, `@noble/curves` / `@noble/ciphers` / `@noble/hashes` 2.4.0, `borsh` 2.0.0, `three` 0.160.0, `gsap` 3.12.5, `lenis` 1.1.13, TypeScript 5.9.3 |
| Scripts | `near-api-js` 7.4.0 |
| Services | OutLayer (TEE runs, encrypted secrets), Plaid sandbox, NEAR AI Cloud (testnet summary only), NEAR Intents 1Click (dry-run quotes), Hugging Face Spaces + Cloudflare Workers (hosting) |
| Tools | Rust 1.93.0, `cargo-near`, `wasmtime` (Dev-mode scorer runner), Node 22, `near` CLI, `outlayer` CLI |

Fonts: Bodoni Moda and Public Sans (Google Fonts). Code was written with Claude Code.

## Status and roadmap

This is a **hackathon MVP**: it works end to end on testnet, and the mainnet contract scores inside the enclave, but it has never lent real money. The next phases, in order and without dates (each depends on partners and approvals we don't control yet):

1. **Now (MVP):** testnet demo; `kredofi.near` scores in OutLayer with lender deposits locked until real bank data ([/mainnet](https://kredofi.xyz/mainnet)).
2. **Pilot:** Plaid production access and a licensed lending partner; multisig owner (the scorer re-pin time lock is already built), then locked contract keys; a capped pool.
3. **India:** bank data through the RBI Account Aggregator network instead of Plaid.
4. **Platform:** KredoFi scores used by other NEAR apps (already readable with view calls: [Use KredoFi scores in your app](https://kredofi.xyz/docs/integrate)).
5. **Cross-chain:** lenders from other chains through NEAR Intents (today only dry-run quotes).

Details: [/docs/roadmap](https://kredofi.xyz/docs/roadmap).

## Who holds what today

Checking the code doesn't cover the people holding keys. Today most of them are one person, the developer. This is a hackathon MVP with $0 in the mainnet pool, and it would not be safe for real money as it stands. The Pilot column is a plan, not something built, except the 24 h scorer time lock. Same table: [/trust](https://kredofi.xyz/trust#who-holds-what), `web/src/lib/trustModel.ts`.

| What | Who holds it today | What they could do if misused | How the Pilot removes it |
|---|---|---|---|
| Sealing key (`SEAL_KEY`) | The developer, who created it on a laptop. A copy is an OutLayer secret. | Open any sealed bank token from the chain and, if it is still unused, exchange it first and read that bank data (the real score then fails). Open any sealed name. Compute fingerprints offline. | Generated inside the enclave, never held outside it. |
| Plaid keys | The developer. A copy is an OutLayer secret. Sandbox keys today. | With an opened token, read that bank data outside the enclave. Alone they read no bank data, because each read needs a token. | Production keys kept inside the enclave, under a licensed lending partner’s Plaid account. |
| `kredofi.near` full-access key | The developer. It is the only key on the account. | Deploy any code. New code could move every token the contract holds and bypass every rule here, including the scorer time lock. No delay and no warning. The mainnet pool holds $0 today. | Final reviewed build, then the key is deleted (lock), so the code can never change again. |
| Owner role on `kredofi.near` | The developer, one account. | Withdraw the treasury. Change loan settings within fixed bounds. Pin another scorer after a 24 h public wait (built). Switch `production_data` on at once, which unlocks lender deposits, with no wait. It cannot move lender cash, loans or the reserve. | Multisig, so several keys must sign. Time lock extended to the other owner settings. |
| Recovery partner key | The developer. The partner is simulated: no real partner exists. | Read the name of any borrower whose identity was released after a default. | Held only by a real, licensed recovery partner. We keep only its public key. |
| OutLayer secrets owner | The developer’s account, which also owns the scorer project. | Replace the secrets, or change which build and caller may read them, so another build could read the sealing and Plaid keys. Publish new scorer versions (the contract runs only the pinned one). | Same multisig as the owner. No secret left that a person ever knew. |
| OutLayer and Intel (not us) | OutLayer controls the approved enclave builds on `worker.outlayer.near`. Intel signs the hardware proof. | A build OutLayer approves could leak what it runs, and a TDX flaw could too. Attestation proves which approved build ran, not that the build behaves well. OutLayer can also refuse to run. | Not removed. We would review its governance and rely on more than one operator if available. |

## Mainnet transaction log

All on `kredofi.near`, Nov 1–4, 2026:
- Deployed in OutLayer mode: [tx Ags89jDR…](https://nearblocks.io/txns/Ags89jDRYZHi4h3ZXxk4kJGenNvrrGxAiAxGHmfKvwhp); upgraded with a state migration: [tx 5fqzZSKC…](https://nearblocks.io/txns/5fqzZSKCED3sv5eg9brTHJTLxCkiDjN9uaVof2bAKK34).
- A real score computed inside OutLayer and stored by `on_score` (band A, 1000, scorer `87ceab66…`), unused fee refunded to the borrower: [tx 4dgHrA97…](https://nearblocks.io/txns/4dgHrA97KfibKifZuVZ2YF5zoAVCy4m2pXxxf9zdijyu).
- Nov 2: re-pinned to the reproducible build `7048cc92…` (OutLayer version [tx 3MKpCgQs…](https://nearblocks.io/txns/3MKpCgQsJeXYF8zMK5yVnWfdckFBW3YToGirX4ZznCqs), secrets lock [tx CCE14Fyq…](https://nearblocks.io/txns/CCE14Fyq76Xhhh6yPzRCv8zhF4gQfXLi9n431f31dNLi), contract pin [tx AtYo7XWz…](https://nearblocks.io/txns/AtYo7XWz4Y4h655hm7N8YPSmMX4kxo8exzCM47GjJRZn)) and scored again inside OutLayer with it (band A, 1000, 7.6 s): [tx CNsoyGSj…](https://nearblocks.io/txns/CNsoyGSj6aXtUmGzxUisxERirsv9jAsAZQ7GKVj7Udb7).
- Nov 3 (security review fixes, [docs/MAINNET_PLAN.md](docs/MAINNET_PLAN.md)): storage top-up [tx C5AU6hFS…](https://nearblocks.io/txns/C5AU6hFSqahwtgREamTx3KUSi4hwHehsgrgwjz39e9dK); contract v3 deploy + migration [tx 2zyjvpPa…](https://nearblocks.io/txns/2zyjvpPaybW9nUjpzQksbPVsgmHRxhmMWHkJ24VsSUAu); OutLayer version `6888c15e…` [tx 8YT7Kme2…](https://nearblocks.io/txns/8YT7Kme2ZK6TtLLwaEbe5Q1e5EVaM9PemAA6yVzxSj8Z); secrets lock [tx EhEiZGuq…](https://nearblocks.io/txns/EhEiZGuqK7o7UEg7EbUq2GsRVT6YMJv6mYgnGcKaJqrt); contract pin [tx 2acP4tWJ…](https://nearblocks.io/txns/2acP4tWJVNQDYeqD66kwrMcFa1XfReAffuU4qyk7VxkG); a real score with a sealed Plaid token, band A 1000 in 8.5 s inside OutLayer: [tx 3nbdkFd3…](https://nearblocks.io/txns/3nbdkFd3uNeeoYhqmE2AQHuRMXLZYbDhEZAUzsVDFGzo). Total 0.061 NEAR.
- Nov 4 (security review 2 fixes and the 24 h scorer re-pin time lock): storage top-up [tx Ews7ubev…](https://nearblocks.io/txns/Ews7ubevwWF5ZdCnGqjM5mkJSKDBo5C7H1tqyJDDeMcs); contract v4 deploy + migration [tx Gj3X9axs…](https://nearblocks.io/txns/Gj3X9axsGU2ctvrsPLo3Uhn93YzbL9XYRtC15fHPEp5c).
- Nov 5-7 (`income_cap` buckets, the first re-pin through the 24 h time lock): OutLayer version `5175182a…` [tx G9CfqecC…](https://nearblocks.io/txns/G9CfqecCvZSeEqoCzqNMTjmcKEBH8AC7cpdgwwCxoGSc); proposed [tx FmYKQGSK…](https://nearblocks.io/txns/FmYKQGSKGf1Ea3q2MDHHoMjkC8dfzRi81qzaQrjMPjW8); secrets lock [tx 3Gbj22t2…](https://nearblocks.io/txns/3Gbj22t2cMg9K2QQxKZaBgCuZ4uAq4x4aJpP9mkHRHZP); applied [tx 29R9wmXS…](https://nearblocks.io/txns/29R9wmXS3WLbxdHEdnMSgcy38N375rp4T6mjts8DBFLd); a real score, band A 1000, cap $1,000, 7.7 s inside OutLayer, attestation PROVEN: [tx 9w6qBWdV…](https://nearblocks.io/txns/9w6qBWdViZrE2Y4KisYxxjdMtbCmAvRyNvAs6WGbymHm); storage top-up, 0.1 NEAR: [tx Ba9Gmc1u…](https://nearblocks.io/txns/Ba9Gmc1uLvfe6TB1Taqx9hPsqqKnbrZ1waJtRqYDqwcu).
- Two earlier attempts refused by OutLayer's secrets access rule before it was fixed (no score stored): [tx BCdtpGjj…](https://nearblocks.io/txns/BCdtpGjjqPeBFqjnPf7FvbgShyagerNWMM8KCFSY8qEP), [tx 2AjMgECA…](https://nearblocks.io/txns/2AjMgECA6PFJaMTQkbP5vZ3dpKATAoapWAqCocidDP4F).

## Known limits

- Bank data is Plaid sandbox only. Real banks need Plaid production access and a licensed lending partner. On mainnet this means a score proves nothing yet: anyone can log in to the Plaid sandbox as a custom user with made-up income and get band A. So `kredofi.near` (contract v4 since Nov 4) refuses lender deposits until the owner sets `production_data`, which waits for Plaid production access ([VERIFY.md](VERIFY.md) section 8). The mainnet pool holds $0 today.
- `income_cap` is public. It is one of five buckets, so it reveals a range and never a figure: $0 means below $200 a month, $100 means $200 to $499, $250 means $500 to $999, $500 means $1,000 to $1,999, $1,000 means $2,000 or more. The public `score` can narrow it further, since the income rule adds points at $1,000, $2,000 and $3,000. Testnet since Nov 5, mainnet since Nov 7.
- The live demo is testnet: test money and Plaid sandbox data, though scores run in OutLayer's testnet enclave since Nov 4. No mainnet loan has been made. Plaid sandbox is sometimes slow (15–19 s per history on Nov 4), and a score past OutLayer's run limit fails cleanly (`score_failed`, nothing else changes) and can be retried. The limit is 60 s on testnet since Nov 4, after 2 of 5 scores hit the earlier 30 s; `kredofi.near` still runs 30 s.
- The public ledger shows visitors' rows with seeded demo rows from `borrower-NN.kredofi-seed.testnet`, each tagged "Seeded demo": made by our script with Plaid sandbox data to show how the ledger looks over time (Nov 4–13). They are not real users ([docs/LEDGER_PLAN.md](docs/LEDGER_PLAN.md)). Our own live tests carry the tag "Developer check (date)" and are counted apart from visitors too.
- Testnet scoring requires a one-time challenge signed by the account's own key (NEP-413), so nobody can re-score another account (`web/src/lib/ownership.ts`).
- On testnet every judge can use the shared sandbox login because the testnet scorer ties the sandbox identity to your NEAR account ([SPEC 8c](docs/SPEC.md)); the mainnet build keeps the strict one-identity rule.
- The scorer is built reproducibly on x86_64 Linux in a pinned image: `./scorer/build-docker.sh` (or the GitHub workflow) gives the exact pinned bytes; builds on macOS or ARM give other hashes ([VERIFY.md](VERIFY.md) section 3).
- Both contract accounts still have their full-access keys, so the owner can redeploy the code. Owner methods can't move lender funds or the reserve (rule 10, tested), but a redeploy could. See [THREAT_MODEL.md](THREAT_MODEL.md).
- The developer generated the sealing keys and also holds the Plaid keys the enclave uses, so they could open sealed names and sealed Plaid tokens, and exchange a token first to read that bank data (the score would then fail). Since Nov 3 the token in `request_score` is sealed to the scorer with the borrower's account, so nobody else can use a copied token ([VERIFY.md](VERIFY.md) section 7, [security review](docs/SECURITY_AUDIT.md) H1; AI-assisted security review by a fresh agent with no access to the build history; not a professional audit). Production would create both keys inside the enclave.
- Security reviews: both were AI-assisted reviews by fresh agents with no access to the build history, not professional audits ([docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)). Review 2 (Nov 4, mainnet contract) found 1 High, 1 Medium and 5 Low. All but one Low (accepted) are fixed and live on `kredofi.near` since Nov 4 (contract v4, [tx Gj3X9axs…](https://nearblocks.io/txns/Gj3X9axsGU2ctvrsPLo3Uhn93YzbL9XYRtC15fHPEp5c)). The High is fixed with a time lock: a new scorer version is proposed in public and applies only after 24 h (`contracts/kredofi/src/pin.rs`). The time lock doesn't cover whoever holds `kredofi.near`'s own full-access key, which can deploy new code (see "Locking" in SECURITY_AUDIT).
- Trust assumptions: Intel TDX, OutLayer's worker registration, Plaid, NEAR AI Cloud (summary only; the score never depends on it).

Built for NEAR HACKATHON, November 2026. All code in this repository was written in the hackathon window: the first commit is 1 Nov 2026, and the only earlier work was throwaway tests on 23–25 Oct, after the 19 Oct announcement ([docs/PREP_LOG.md](docs/PREP_LOG.md)). No code from an earlier project. Specification: [docs/SPEC.md](docs/SPEC.md). Build log: [docs/LOG.md](docs/LOG.md).

License: [MIT](LICENSE), © 2026 Kenil Vekariya.
