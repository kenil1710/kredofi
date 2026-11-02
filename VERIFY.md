# Verify KredoFi yourself

Everything below uses public data only: the NEAR RPC, the public scorer WASM repository and the block explorer. No account or key is needed.

## 1. Which scorer does the mainnet contract trust?

The contract pins one scorer version (the WASM's SHA-256) and sends it as `version_key` in every OutLayer request.

```bash
curl -s https://rpc.mainnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kredofi.near","method_name":"get_config","args_base64":""}}' \
  | python3 -c "import json,sys;c=json.loads(bytes(json.load(sys.stdin)['result']['result']));print(c['scorer_mode'],c['scorer_version'])"
```

Expected: `OutLayer 87ceab664ebf5596ee1a78f84e7f3817faa452dcb67c5f98cac1ad724a3e1587`.

## 2. Is the published WASM that exact file?

The production build is published, and nothing else, at a commit-pinned URL (OutLayer downloads it from there and checks the hash):

```bash
curl -sL https://raw.githubusercontent.com/kenil1710/kredofi-scorer-wasm/78235f1146672e48b042768f25c921ceb23731e5/kredofi_scorer.wasm | shasum -a 256
```

Expected: `87ceab664ebf5596ee1a78f84e7f3817faa452dcb67c5f98cac1ad724a3e1587`.

## 3. Does that WASM come from this source code?

Since Nov 2 scorer builds rewrite machine paths (`--remap-path-prefix`) and the canonical build runs on **x86_64 Linux in a pinned Rust image** (the bytes also depend on the build host's OS and CPU, so builds on macOS or ARM Linux give other hashes):

```bash
./scorer/build-docker.sh        # production: sha256 39eec3ba1e0208f838cfa7d5cb32ff0f8112594217fd44cb5703cd5954fa2975
./scorer/build-docker.sh demo   # testnet demo: the hash pinned on kredofi.kency.testnet (section 6)
```

On an x86_64 machine with Docker, or in a fork with the GitHub workflow `scorer reproducible build` (`.github/workflows/scorer-repro.yml`), which prints both hashes; two separate runs gave the same bytes.

Honest gap until the mainnet re-pin: `kredofi.near` still pins `87ceab66…`, which was built on macOS before path rewriting. It embeds the builder's paths, so it reproduces only on the original machine (`./build.sh legacy`); the code is the same as `39eec3ba…` (only the build changed). The re-pin to `39eec3ba…` is prepared and waits for the owner's approval: [docs/REPIN_PLAN.md](docs/REPIN_PLAN.md). Until then, check the published file against the pin (sections 1 and 2) and these properties of it:

- `strings kredofi_scorer.wasm | grep -c 'demo profiles are disabled in this build'` prints `1` (the production build refuses prepared sandbox profiles at input parsing, `scorer/src/lib.rs` `parse_input`), and `strings kredofi_scorer.wasm | grep -c cloud-api.near.ai` prints `0` (no AI call in the production build).
- The output it may produce is fixed by the contract's strict parser (`contracts/kredofi/src/score.rs`, `parse_output`): exactly `v`, `caller`, `band`, `score`, `income_cap`, `fingerprint`, `sealed_identity` and an optional `reply`; anything else is refused.

## 4. Did a real score come from OutLayer?

Open [tx 4dgHrA97…](https://nearblocks.io/txns/4dgHrA97KfibKifZuVZ2YF5zoAVCy4m2pXxxf9zdijyu) (mainnet, Nov 1, 2026). Its receipts show:

1. `kredofi.near` → `request_score`, then a call to `outlayer.near` `request_execution` carrying `version_key` = `87ceab66…`;
2. OutLayer's worker resolving the request, then `kredofi.near` → `on_score` (a `#[private]` callback: only the contract itself can call it);
3. the event `EVENT_JSON:{"standard":"kredofi",…,"event":"score_issued",…}` with band A and score 1000;
4. the unused OutLayer fee refunded to the borrower (`payer_account_id`).

Read the stored result:

```bash
curl -s https://rpc.mainnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kredofi.near","method_name":"get_borrower","args_base64":"'$(printf '{"account_id":"715363554c6216e50dbbffd81750f2c6b3b8551c4f3466fdf02eee85cc7543b0"}' | base64)'"}}' \
  | python3 -c "import json,sys;b=json.loads(bytes(json.load(sys.stdin)['result']['result']));print(b['score'])"
```

Expected: band `A`, score `1000`, `scorer_version` `87ceab66…`. There is no `sealed_identity` in the view: the sealed name is stored but no view returns it (rule 9).

## 5. Can anyone else write a score?

- On mainnet the contract is in `OutLayer` mode: `dev_submit_score` is refused, and `on_score` is `#[private]`. Tests: `contracts/kredofi/src/score_tests.rs` and `tests/tests/scores.rs` (fake scores, wrong caller, wrong version, reused fingerprint, OutLayer `null` or error results).
- The scorer's secrets (Plaid keys, `SEAL_KEY`) are released by OutLayer only to the pinned build **and** only when the request comes from `kredofi.near` (access condition `build:87ceab66… AND from:kredofi.near`). A direct OutLayer call by the secrets owner was refused (mainnet tx `EJ8Ygrru…`, `docs/LOG.md`, Nov 1).

## 6. The testnet demo

The live demo runs on testnet in Dev mode, where the server runs the pinned demo scorer and submits its output. Check what it pins and that it matches the server's file:

```bash
curl -s https://kenil1710-kredofi.hf.space/api/ledger | python3 -c "import json,sys;print(json.load(sys.stdin)['config']['scorer_version'])"
```

Expected: `7f57898102233ceaa9990eef9d4abde214a58c11f3ecfa850e7a5b532a51ecb9`. The server refuses to score if its WASM's hash differs from the pinned value (`web/src/server/scorer.ts`, `checkPinned`), and the container build refuses a WASM with any other hash (`deploy/hf/Dockerfile`).

Every event on [the public ledger](https://kenil1710-kredofi.hf.space/ledger) links to its transaction on `testnet.nearblocks.io`; the ledger trusts only logs from receipts executed by the KredoFi contract itself (`web/src/lib/events.ts`, tested).

## 7. The money rules

- One $100 band A loan: the borrower repays $104; $2 goes to lenders (share price), $2 to the treasury; the reserve gets nothing (SPEC 4a).
- Owner methods can't move lender cash, outstanding loans or the reserve; the treasury can only be withdrawn or moved into the reserve (rule 10). Tests: `contracts/kredofi/src/treasury_tests.rs`, `tests/tests/treasury.rs`.
- A default is paid from the reserve first; only the rest is lost by lenders (`loan_defaulted.lender_loss`, visible on the ledger).

Run every test: `cargo test --workspace`, `(cd scorer && cargo test)`, `(cd web && npm test)`.
