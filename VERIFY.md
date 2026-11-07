# Verify KredoFi yourself

Everything below uses public data only: the NEAR RPC, the public scorer WASM repository and the block explorer. No account or key is needed.

## 1. Which scorer does the mainnet contract trust?

The contract pins one scorer version (the WASM's SHA-256) and sends it as `version_key` in every OutLayer request.

```bash
curl -s https://rpc.mainnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kredofi.near","method_name":"get_config","args_base64":""}}' \
  | python3 -c "import json,sys;c=json.loads(bytes(json.load(sys.stdin)['result']['result']));print(c['scorer_mode'],c['scorer_version'],c['require_production_data'],c['production_data'])"
```

Expected: `OutLayer 5175182a13e3f3a8b737a8730524ca6f4a98575765784a0a4977fdf4151fa7ce True False`: the pinned scorer, and lender deposits locked until real bank data (section 8).

Is a scorer change waiting? Since contract v4 a new pin is first proposed in public and applies only after a 24 h time lock (security review 2, High):

```bash
curl -s https://rpc.mainnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kredofi.near","method_name":"get_pending_scorer","args_base64":""}}' \
  | python3 -c "import json,sys;r=json.load(sys.stdin)['result'];print(bytes(r['result']).decode() if 'result' in r else r.get('error'))"
```

Expected: `null` (nothing pending). A pending change would print `{"version":…,"proposed_at":…,"apply_at":…}`, and `get_config` shows the lock itself: `scorer_delay_ns` = `86400000000000` (24 h).

## 2. Is the published WASM that exact file?

The production build is published, and nothing else, at a commit-pinned URL (OutLayer downloads it from there and checks the hash):

```bash
curl -sL https://raw.githubusercontent.com/kenil1710/kredofi-scorer-wasm/fd039dc761f43dd6c517f05df57f735179039b77/kredofi_scorer.wasm | shasum -a 256
```

Expected: `5175182a13e3f3a8b737a8730524ca6f4a98575765784a0a4977fdf4151fa7ce`.

## 3. Does that WASM come from this source code?

Since Nov 2 scorer builds rewrite machine paths (`--remap-path-prefix`) and the canonical build runs on **x86_64 Linux in a pinned Rust image** (the bytes also depend on the build host's OS and CPU, so builds on macOS or ARM Linux give other hashes):

```bash
./scorer/build-docker.sh        # production: sha256 5175182a13e3f3a8b737a8730524ca6f4a98575765784a0a4977fdf4151fa7ce (scorer source at commit 89694f4)
./scorer/build-docker.sh demo   # testnet demo: the hash pinned on kredofi.kency.testnet (section 6)
```

On an x86_64 machine with Docker, or in a fork with the GitHub workflow `scorer reproducible build` (`.github/workflows/scorer-repro.yml`), which prints both hashes; two separate runs gave the same bytes.

The pinned mainnet build was produced by that workflow (CI runs 42006645803 and 42006679883, identical bytes) and published at the commit-pinned URL in section 2. Two more checks on the file itself:

- `strings kredofi_scorer.wasm | grep -c 'demo profiles are disabled in this build'` prints `1` (the production build refuses prepared sandbox profiles), and `strings kredofi_scorer.wasm | grep -c cloud-api.near.ai` prints `0` (no AI call in the production build).
- The output it may produce is fixed by the contract's strict parser (`contracts/kredofi/src/score.rs`, `parse_output`): exactly `v`, `caller`, `band`, `score`, `income_cap`, `fingerprint`, `sealed_identity` and an optional `reply`; anything else is refused.

History: until Nov 2 mainnet pinned `87ceab66…`, a macOS build with the builder's paths inside, reproducible only on that machine. It was replaced by `7048cc92…` (Nov 2: reproducible, stricter Plaid history check; published at commit `f174d555`), then on Nov 3 by `6888c15e…`, which accepts only a Plaid token sealed to the scorer together with the borrower's account (security review H1), then on Nov 7 by `5175182a…`, whose `income_cap` is one of five buckets (proposed in public on Nov 5: [tx FmYKQGSK…](https://nearblocks.io/txns/FmYKQGSKGf1Ea3q2MDHHoMjkC8dfzRi81qzaQrjMPjW8); applied after the 24 h time lock: [tx 29R9wmXS…](https://nearblocks.io/txns/29R9wmXS3WLbxdHEdnMSgcy38N375rp4T6mjts8DBFLd)).

## 4. Did a real score come from OutLayer?

Open [tx 9w6qBWdV…](https://nearblocks.io/txns/9w6qBWdViZrE2Y4KisYxxjdMtbCmAvRyNvAs6WGbymHm) (mainnet, Nov 7, 2026, with the current pin; earlier: [tx 3nbdkFd3…](https://nearblocks.io/txns/3nbdkFd3uNeeoYhqmE2AQHuRMXLZYbDhEZAUzsVDFGzo) on Nov 3 with `6888c15e…`, [tx CNsoyGSj…](https://nearblocks.io/txns/CNsoyGSj6aXtUmGzxUisxERirsv9jAsAZQ7GKVj7Udb7) on Nov 2 with `7048cc92…`, [tx 4dgHrA97…](https://nearblocks.io/txns/4dgHrA97KfibKifZuVZ2YF5zoAVCy4m2pXxxf9zdijyu) on Nov 1 with `87ceab66…`). Its receipts show:

1. `kredofi.near` → `request_score` whose `public_token` argument starts with `sealed1:` (the Plaid token sealed to the scorer with the borrower's account; unreadable on-chain), then a call to `outlayer.near` `request_execution` carrying `version_key` = `5175182a…` (OutLayer logs "Resolved project … version 5175182a…" and the commit-pinned URL);
2. OutLayer's worker resolving the request, then `kredofi.near` → `on_score` (a `#[private]` callback: only the contract itself can call it);
3. the event `EVENT_JSON:{"standard":"kredofi",…,"event":"score_issued",…}` with band A and score 1000;
4. the unused OutLayer fee refunded to the borrower (`payer_account_id`).

Read the stored result:

```bash
curl -s https://rpc.mainnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kredofi.near","method_name":"get_borrower","args_base64":"'$(printf '{"account_id":"715363554c6216e50dbbffd81750f2c6b3b8551c4f3466fdf02eee85cc7543b0"}' | base64)'"}}' \
  | python3 -c "import json,sys;b=json.loads(bytes(json.load(sys.stdin)['result']['result']));print(b['score'])"
```

Expected: band `A`, score `1000`, `income_cap` `1000000000`, `scorer_version` `5175182a…`. There is no `sealed_identity` in the view: the sealed name is stored but no view returns it (rule 9).

## 4b. Did that run really happen inside Intel TDX?

OutLayer publishes an Intel-signed TDX quote for each run ([job 1301269](https://app.outlayer.ai/attestation/1301269) is the transaction above). Check it with OutLayer's open-source verifier, not its website:

```bash
cargo install --git https://github.com/out-layer/outlayer-verify outlayer-verify   # commit we used: 90c27d9d4fc8
outlayer-verify tx 9w6qBWdViZrE2Y4KisYxxjdMtbCmAvRyNvAs6WGbymHm --api https://api.outlayer.ai
```

Expected: `PROVEN`, exit code 0, `wasm sha256 5175182a…`, `task 1301269`. The `--api` flag is needed for now: the tool's default address is retired. For a testnet score, add `--network testnet --api https://testnet-api.outlayer.ai` (we checked `Fp1ud4Vy…` and `2S18xg8W…`).

Offline, from the saved evidence: `outlayer-verify bundle docs/proofs/mainnet-score-2026-11-07.attestation.json --offline`. The Nov 3 score (`6888c15e…`, task 1257953) keeps its own evidence: `docs/proofs/mainnet-score-2026-11-03.attestation.json`.

It checks four things: the quote chains to the Intel root and the hardware is up to date; all five measurements (MRTD, RTMR0-3) are on the approved list of `worker.outlayer.near`; the quote commits to the scorer hash, input and output; those match the bytes in the transaction. See the [approved list](https://app.outlayer.ai/docs/trust-verification) with `near contract call-function as-read-only worker.outlayer.near get_approved_measurements json-args '{}' network-config mainnet now`.

**What it doesn't prove:** that the enclave deletes the data after the run, or that the approved enclave image is good. OutLayer controls that approved list, and this check doesn't link the image to published source (section 3 does that for our scorer, not for OutLayer's image). The record comes from OutLayer's API, although the quote inside it is Intel-signed.

## 5. Can anyone else write a score?

- On mainnet the contract is in `OutLayer` mode: `dev_submit_score` is refused, and `on_score` is `#[private]`. Tests: `contracts/kredofi/src/score_tests.rs` and `tests/tests/scores.rs` (fake scores, wrong caller, wrong version, reused fingerprint, OutLayer `null` or error results).
- The scorer's secrets (Plaid keys, `SEAL_KEY`) are released by OutLayer only to the pinned build **and** only when the request comes from `kredofi.near` (access condition `build:5175182a… AND from:kredofi.near`, set Nov 7: [tx 3Gbj22t2…](https://nearblocks.io/txns/3Gbj22t2cMg9K2QQxKZaBgCuZ4uAq4x4aJpP9mkHRHZP)). A direct OutLayer call by the secrets owner was refused (mainnet tx `EJ8Ygrru…`, `docs/LOG.md`, Nov 1).

## 6. The testnet demo

Since Nov 4 the live demo runs on `app.kency.testnet` (contract v4 with one change from mainnet: OutLayer run limit 60 s instead of 30 s, build `a1ddb323…`, [deploy tx](https://testnet.nearblocks.io/txns/Cydbu24U8vmbndfGMqBtDhdJe6gVw5bueE11QvoYDZex)) in **OutLayer mode**, like mainnet: the borrower signs `request_score`, OutLayer testnet runs the pinned testnet scorer inside Intel TDX, and the contract accepts the answer only in `on_score`. Check the mode and the pin:

```bash
curl -s https://kredofi.xyz/api/ledger | python3 -c "import json,sys;c=json.load(sys.stdin)['config'];print(c['scorer_mode'],c['scorer_version'],c['scorer_delay_ns'])"
```

Expected: `OutLayer 96666cdf840746c062738e6e74af5ab46eacd8bc40c60ccb43d9d638ac17bcfc 60000000000` (a 1-minute re-pin time lock on testnet). That build is published at `https://raw.githubusercontent.com/kenil1710/kredofi-scorer-wasm/9fdaaea69a4cc017048496a0c5e2b05903c6b02d/kredofi_scorer_testnet.wasm` (OutLayer logs this URL in every request). The Nov 1–4 testnet contract `kredofi.kency.testnet` (Dev mode: our server ran demo build `ac8e2a9c…` and submitted its output) now holds only our own test runs; its history stays on-chain.

Every event on [the public ledger](https://kredofi.xyz/ledger) links to its transaction on `testnet.nearblocks.io`; the ledger trusts only logs from receipts executed by the KredoFi contract itself (`web/src/lib/events.ts`, tested).

### What `income_cap` reveals (buckets since Nov 5)

The testnet build pinned on Nov 5 (propose [ELfMfp2A…](https://testnet.nearblocks.io/txns/ELfMfp2AWceFxnGtSoNUuWap6WPab5PbBvDRUNAFffBi), apply [6fmiNm8k…](https://testnet.nearblocks.io/txns/6fmiNm8k95egXGSp73cKh6QnPZEfxwsFimjskFHwES4i), scorer source at commit `89694f4`) only ever outputs 0, 100, 250, 500 or 1,000 USDC: `income_cap_bucket` in `scorer/src/rules.rs`. Mainnet has used the same buckets since Nov 7 (`5175182a…`, same source commit, [apply tx 29R9wmXS…](https://nearblocks.io/txns/29R9wmXS3WLbxdHEdnMSgcy38N375rp4T6mjts8DBFLd)). The contract is unchanged: it enforces only the $1,000 ceiling, so the buckets rest on the pinned scorer.

## 7. Is a copied Plaid token useless?

Since Nov 3 the scorer opens the sealed token and refuses it, before any Plaid call, unless the account inside equals the transaction's signer (`NEAR_SENDER_ID`): `scorer/src/crypto.rs` `open_token`, tests `h1_*` in `scorer/src/tests.rs`. Proven in OutLayer's testnet enclave with the same logic: another account submitting a copied token got `score_failed` "this token was sealed for another account" ([testnet tx 5cyWM6Mz…](https://testnet.nearblocks.io/txns/5cyWM6MzXs3ySgwxLRtzeZ3ztcVjtgAnzb7Ggv5pRT3u)), then the owner's own request with the same token scored ([testnet tx pNRfqHTC…](https://testnet.nearblocks.io/txns/pNRfqHTCWdePuuYs5YkxjrQYTRQ6ERWMf7qNtMvjAqp)).

If the testnet explorer hasn't indexed these, read the refusal from the RPC (the copy was submitted by `kf-ola-1793703739.testnet`):

```bash
curl -s https://archival-rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tx","params":{"tx_hash":"5cyWM6MzXs3ySgwxLRtzeZ3ztcVjtgAnzb7Ggv5pRT3u","sender_account_id":"kf-ola-1793703739.testnet","wait_until":"NONE"}}' \
  | python3 -c "import json,sys;r=json.load(sys.stdin)['result'];print([l for o in r['receipts_outcome'] for l in o['outcome']['logs'] if 'score_failed' in l])"
```

## 8. Are lender deposits locked on mainnet?

`kredofi.near` runs contract v4 (Nov 4: security review 2 fixes and the scorer re-pin time lock; deploy + v3 → v4 migration in one transaction, [tx Gj3X9axs…](https://nearblocks.io/txns/Gj3X9axsGU2ctvrsPLo3Uhn93YzbL9XYRtC15fHPEp5c); earlier v3 on Nov 3, [tx 2zyjvpPa…](https://nearblocks.io/txns/2zyjvpPaybW9nUjpzQksbPVsgmHRxhmMWHkJ24VsSUAu)). Its code is the build tested in this repository:

```bash
curl -s https://rpc.mainnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_code","finality":"final","account_id":"kredofi.near"}}' \
  | python3 -c "import json,sys,base64,hashlib;print(hashlib.sha256(base64.b64decode(json.load(sys.stdin)['result']['code_base64'])).hexdigest())"
```

Expected: `147d863d9413b1531eacec9dd5ad69a727837c9c0de10b270e3237306c5ed148` (`cd contracts/kredofi && cargo near build non-reproducible-wasm --no-embed-abi` from commit `40f245f`; contract builds are not byte-reproducible across machines, so compare the source). With `require_production_data: true` and `production_data: false` (section 1), every lender `deposit` is refused and the tokens go back (`contracts/kredofi/src/lib.rs` `internal_deposit`; tests `h2_*` and `migrate_from_deployed_v3_keeps_everything`). Mainnet scores come from Plaid's sandbox, where anyone can invent an income, so no lender money may come in before real bank data.

## 9. The money rules

- One $100 band A loan: the borrower repays $104; $2 goes to lenders (share price), $2 to the treasury; the reserve gets nothing (SPEC 4a).
- Owner methods can't move lender cash, outstanding loans or the reserve; the treasury can only be withdrawn or moved into the reserve (rule 10). Tests: `contracts/kredofi/src/treasury_tests.rs`, `tests/tests/treasury.rs`.
- A default is paid from the reserve first; only the rest is lost by lenders (`loan_defaulted.lender_loss`, visible on the ledger).

Run every test: `cargo test --workspace`, `(cd scorer && cargo test)`, `(cd web && npm test)`.
