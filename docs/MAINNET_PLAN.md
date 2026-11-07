# Mainnet changes for the security review fixes (H1, H2, M1)

The review was an AI-assisted security review by a fresh agent with no access to the build history; not a professional audit (`docs/SECURITY_AUDIT.md`).

Status: **done on Nov 3, after the owner's yes to steps 0–6.** Total 0.060941 NEAR from the dev account, within the 0.08 limit; every step cost what was listed.

Results:
- **Step 0:** public wasm commit `6db11596`; the URL hash was checked.
- **Step 1:** [tx C5AU6hFS…](https://nearblocks.io/txns/C5AU6hFSqahwtgREamTx3KUSi4hwHehsgrgwjz39e9dK), 0.050044 NEAR.
- **Step 2:** [tx 2zyjvpPa…](https://nearblocks.io/txns/2zyjvpPaybW9nUjpzQksbPVsgmHRxhmMWHkJ24VsSUAu), about 0.0023 NEAR from `kredofi.near`'s own balance. Code SHA-256 `b7f55eaf…`.
- **Step 3:** [tx 8YT7Kme2…](https://nearblocks.io/txns/8YT7Kme2ZK6TtLLwaEbe5Q1e5EVaM9PemAA6yVzxSj8Z), 0.005581 NEAR.
- **Step 4:** [tx EhEiZGuq…](https://nearblocks.io/txns/EhEiZGuqK7o7UEg7EbUq2GsRVT6YMJv6mYgnGcKaJqrt), 0.001123 NEAR.
- **Step 5:** [tx 2acP4tWJ…](https://nearblocks.io/txns/2acP4tWJVNQDYeqD66kwrMcFa1XfReAffuU4qyk7VxkG), 0.0002 NEAR.
- **Step 6:** [tx 3nbdkFd3…](https://nearblocks.io/txns/3nbdkFd3uNeeoYhqmE2AQHuRMXLZYbDhEZAUzsVDFGzo), 0.003993 NEAR. The token was `sealed1:` (228 characters); band A 1000 in 8.5 s; 0.0081 NEAR refunded.

Later re-pin, Nov 5-7 (`income_cap` buckets, scorer `5175182a…`, source commit `89694f4`, public wasm commit `fd039dc`), the first through the 24 h time lock:
- **Version:** [tx G9CfqecC…](https://nearblocks.io/txns/G9CfqecCvZSeEqoCzqNMTjmcKEBH8AC7cpdgwwCxoGSc), 0.00556 NEAR (Nov 5).
- **Propose:** [tx FmYKQGSK…](https://nearblocks.io/txns/FmYKQGSKGf1Ea3q2MDHHoMjkC8dfzRi81qzaQrjMPjW8), 0.00020 NEAR (Nov 5; applicable from Nov 6, 11:19 UTC).
- **Secrets lock:** [tx 3Gbj22t2…](https://nearblocks.io/txns/3Gbj22t2cMg9K2QQxKZaBgCuZ4uAq4x4aJpP9mkHRHZP), 0.001123 NEAR (Nov 7).
- **Apply:** [tx 29R9wmXS…](https://nearblocks.io/txns/29R9wmXS3WLbxdHEdnMSgcy38N375rp4T6mjts8DBFLd), 0.000200 NEAR (Nov 7).
- **Score:** [tx 9w6qBWdV…](https://nearblocks.io/txns/9w6qBWdViZrE2Y4KisYxxjdMtbCmAvRyNvAs6WGbymHm), 0.003923 NEAR (Nov 7): band A 1000, cap $1,000, 7.665 s in OutLayer, 472 bytes, 0.008164 NEAR refunded. OutLayer's verifier: PROVEN, task 1301269, `docs/proofs/mainnet-score-2026-11-07.attestation.json`.
- Nov 7 total 0.005246 NEAR. `kredofi.near` holds 0.0600 NEAR above its storage (score floor 0.05).

The original plan follows. No step moves money into or out of the pool; no real-money loan is made (the pool holds $0, and after step 2 lender deposits are refused until `production_data` is set).

What changes on `kredofi.near`:
- **H1:** the scorer accepts only a Plaid token sealed to the enclave with the borrower's account. The contract passes `public_token` through unchanged, so the v2 contract would also work with it.
- **H2:** contract v3. Lender deposits are refused until the owner sets `production_data`. The migration sets `require_production_data = true` because the account isn't `.testnet`.
- **M1:** contract v3. Callbacks read raw bytes, `cancel_pending_score` is added, and deposits must be at least 1 USDC.

## The artifacts (built and tested, Nov 3)

| What | Value | Proof |
|---|---|---|
| Production scorer (mainnet candidate) | `6888c15e1442b508202141daf8cc246dddb9ecf5e586f1f0743671de7c23e6e2`, 503,405 bytes | CI run 41623343936 (x86_64 Linux, pinned image), source commit `2d5ca4d` |
| Same logic, testnet build, in the real testnet enclave | `0515ebca…` | Copied sealed token refused (testnet tx `5cyWM6Mz…`); the owner's own request scored band A in the enclave in 7.8 s (testnet tx `pNRfqHTC…`) |
| Contract v3 wasm | `b7f55eaf89b2d592d1684293f5ec59d02b39e5d8e776319c65381cef94b0691c`, 292,698 bytes (`cargo near build non-reproducible-wasm --no-embed-abi`) | 133 unit tests + 36 sandbox tests, including migration from the deployed v2 binary (`tests/fixtures/kredofi_v2.wasm`, fetched from `kredofi.near`) |
| Mainnet token key (public) | `ddd29784c75beca2e6fcd4656e98b118dbdadf9d859092f5cf4048f66306795e` | `node scripts/token_pubkey.mjs SEAL_KEY` |

Balances now:
- `kredofi.near`: 2.9387 NEAR, 290,300 bytes used, **0.0357 NEAR free**.
- Dev account `715363…`: 0.2931 NEAR.

The new code is 3,808 bytes larger (+0.0381 NEAR of storage), and the deploy also needs about 0.03 NEAR free for its prepaid gas. So `kredofi.near` needs a small top-up first (step 1).

## Steps, in order (each waits for a yes)

| # | What | Signer | Command | Cost (NEAR) |
|---|---|---|---|---|
| 0 | Publish `kredofi_scorer.wasm` (`6888c15e…`) to the public repo `kenil1710/kredofi-scorer-wasm` and check the commit-pinned URL's SHA-256. Public GitHub push, not a transaction. | — | `git push`; `curl -sL https://raw.githubusercontent.com/kenil1710/kredofi-scorer-wasm/<commit>/kredofi_scorer.wasm \| shasum -a 256` | 0 |
| 1 | Storage top-up for the larger contract | dev `715363…` | `near tokens 715363… send-near kredofi.near '0.05 NEAR' network-config mainnet sign-with-access-key-file ~/.near-credentials/implicit/715363….json send` | 0.05 (stays in `kredofi.near` as storage) |
| 2 | Deploy contract v3 and migrate in one transaction | `kredofi.near` | `near contract deploy kredofi.near use-file target/near/kredofi/kredofi.wasm with-init-call migrate json-args '{}' prepaid-gas '10 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-legacy-keychain send` | about 0.003 gas (storage +0.0381 comes from step 1) |
| 3 | Add the scorer version to the OutLayer project | dev | `OUTLAYER_NETWORK=mainnet outlayer deploy kredofi-scorer <commit-pinned URL> --hash 6888c15e…` | about 0.0056 (Nov 2 measure) |
| 4 | Move the secrets lock to the new build (still only from `kredofi.near`) | dev | `outlayer secrets access --project 715363…/kredofi-scorer --profile kredofi --access allow-all --via kredofi.near --build 6888c15e…` | about 0.0011 |
| 5 | Pin the new scorer | dev (owner) | `set_scorer_version({"version":"6888c15e…"})`, 1 yoctoNEAR, 30 Tgas | about 0.0002 |
| 6 | Check: one real score with a sealed token | dev (as borrower) | `node scripts/mainnet_score.mjs` (seals with the mainnet token key); then `get_config` shows OutLayer, `6888c15e…`, `require_production_data: true`, `production_data: false` | about 0.004 (0.01 attached, about 0.008 refunded) |

**Total: about 0.064 NEAR** from the dev account (0.293 available), of which 0.05 stays as `kredofi.near` storage.

Between steps 4 and 5, mainnet scores fail: the old build can't read the secrets any more. Nobody uses mainnet, and step 5 follows within a minute.

Not planned: `set_production_data(true)`. That waits for Plaid production access, and therefore for real bank data.

## After the steps

- README, VERIFY.md, `/docs` and the ledger Verify panel name `6888c15e…` as the mainnet pin and keep the `7048cc92…` history.
- The H1 and H2 rows in `docs/SECURITY_AUDIT.md` become "Fixed on mainnet" with the transaction hashes.
