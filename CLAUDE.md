# CLAUDE.md: rules for building KredoFi

KredoFi: private, income-based stablecoin loans on NEAR. Bank data is scored inside a TEE (OutLayer); the contract trusts only its own pinned OutLayer request.

**Read first, every session:** `docs/SPEC.md` (what to build), `docs/DESIGN.md` (how the UI looks and behaves), `docs/landing-reference.html` (the finished landing page: copy its look, motion and `drawNote()`), `docs/passbook-reference.html` (the borrower flow to build for real), `docs/PLAN.md` (what to build today, cut list), `docs/PREP_LOG.md` (what was already tested, exact settings and lessons), `HACKATHON.md` (official rules plus our notes, deadline 2026-11-14 23:59 UTC). End each day with a line in `docs/LOG.md`.

## Golden rules

1. `docs/SPEC.md` is the source of truth. If code and spec disagree, stop and ask; don't silently change either.
2. Write the test before or with the code. Every rule in SPEC section 7 has a test. Don't mark work done while tests fail.
3. Never commit secrets. Keys live in `.env` (git-ignored) or OutLayer secrets. `.env.example` lists names only.
4. Never claim a feature in the README that isn't built and tested. Every claim points to a file or a transaction.
5. Small, working steps. Build, test, commit. Don't write large untested batches.

## Stack and versions

- Contracts: Rust, `near-sdk` 5.x, build with `cargo near build non-reproducible-wasm`, tests with `near-workspaces`.
- Scorer: Rust, target `wasm32-wasip2`, `serde_json`, `wasi-http-client` 0.2.1 **patched** via `[patch.crates-io]` to `scorer/vendor/wasi-http-client` (`scripts/fix_http.py`). The unpatched crate crashes or hangs on request bodies over 4 KB.
- Web: Next.js + TypeScript, NEAR Connect (`@hot-labs/near-connect@0.11.4`, the wallet connector NEAR docs recommend; not RainbowKit, which is EVM-only), three@0.160.0, gsap 3.12.5 (+ScrollTrigger), lenis 1.1.13. Fonts: Bodoni Moda + Public Sans. Follow `docs/DESIGN.md` and `docs/landing-reference.html` exactly; app screens live in the same visual world as the landing page.
- Do **not** use the Shade Agent Framework (deprecated April 2026). The TEE layer is OutLayer.

## Units (most common source of bugs)

- USDC: 6 decimals. $100 = `100_000_000`.
- NEAR: 24 decimals (yocto). Amounts in JSON are strings.
- Time: nanoseconds (`env::block_timestamp()`).
- Plaid amounts: negative = money in, positive = money out.

## NEAR contract rules

- Callbacks are `#[private]`. Scores are accepted only in `on_score`.
- Update state **before** any token transfer; every transfer has a callback that rolls back on failure.
- Handle OutLayer results of `null` or error: clear `pending_request`, change nothing else.
- Pin the scorer version (`version_key` = WASM SHA-256) in every OutLayer request.
- Attach about 100 Tgas to `request_execution`, not 300. Fee deposit 0.01 NEAR.
- `request_score` requires `env::signer_account_id() == env::predecessor_account_id()`.
- Checked math on u128. No owner method may move lender funds or the reserve.
- Emit NEP-297 events listed in SPEC section 4.

## Scorer rules

- Output only: `v`, `caller`, `band`, `score`, `income_cap`, `fingerprint`, `sealed_identity`, optional `reply`. Never raw transactions, balances, names, or tokens. Keep output under 900 bytes.
- `caller` comes from `NEAR_SENDER_ID`, never from input.
- Plaid: `days_requested: 730`; loop `/transactions/sync` on `has_more`; retry until `HISTORICAL_UPDATE_COMPLETE` (max 20, 1 s apart).
- The `"debug"` input flag is for local `wasmtime` runs only and must be compiled out or rejected in the deployed build.
- Scoring rules are in SPEC section 6. The unit test must reproduce the demo table (Riya 1000/A, Sam 270/D, Max 1000/A).
- NEAR AI Cloud: only `Qwen/Qwen3.8-27B` (proven private). The score never depends on AI output.

## OutLayer deployment

- Host the scorer WASM at a **commit-pinned** URL: `https://raw.githubusercontent.com/<user>/<repo>/<commit>/scorer.wasm`. Never `/main/` (GitHub caches it and the hash check fails).
- Verify before deploying: `curl -sL <url> | shasum -a 256` must equal the build hash.
- `outlayer deploy <name> <url> --hash <sha256>`. Each code change is a new version.
- Secrets profile `kredofi`; access whitelist = the KredoFi contract account.
- `outlayer run` often times out in the CLI while the run continues; check with `near transaction view-status <hash> network-config <net>`.
- OutLayer testnet workers were down during prep; mainnet works. A contract only calls OutLayer on its own network.

## Commands

```bash
# contracts: unit tests inside each contract
cd contracts/kredofi && cargo near build non-reproducible-wasm && cargo test
cd contracts/mock-usdc && cargo near build non-reproducible-wasm && cargo test
# full suite from the repo root (unit + near-workspaces sandbox tests in tests/; rebuilds both wasm files)
cargo test --workspace
# scorer: unit tests (native) and wasm builds; each build prints its SHA-256 (= OutLayer version_key)
cd scorer && cargo test
cd scorer && ./build.sh          # production (pin this): out/kredofi_scorer.wasm, rejects profiles and debug
cd scorer && ./build.sh demo     # + demo profiles: out/kredofi_scorer_demo.wasm (local / testnet Dev mode)
cd scorer && ./build.sh debug    # + debug features on stderr: local only, never deploy
# demo borrowers -> scorer/out/borrowers/{good,risky,cheater}.json (ready scorer inputs)
python3 scripts/gen_borrowers.py
# run locally: keys from .env, passed to wasmtime by NAME only (never values on the command line)
set -a; source .env; set +a
wasmtime run -S http --env PLAID_CLIENT_ID --env PLAID_SECRET --env SEAL_KEY --env NEAR_SENDER_ID=riya.kency.testnet scorer/out/kredofi_scorer_demo.wasm < scorer/out/borrowers/good.json
# open a sealed reply/release with a secret held in an env var
(cd scorer && cargo run -q --example open_sealed -- PARTNER_PRIVKEY) < released.b64
```

## Never

- Never deploy to mainnet, sign mainnet transactions, push, make the repo public, post on X or submit the hackathon form without the human's explicit yes.
- Never use the human's prize wallet (HOT) in any script. Mainnet dev work uses the separate dev account.
- Never print, log or commit `PLAID_SECRET`, `SEAL_KEY`, `NEARAI_KEY`, `RELAYER_KEY`, private keys or Plaid access tokens.
- Never add features outside SPEC without asking. Cut scope before cutting tests.
