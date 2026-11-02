# Mainnet re-pin: path-independent scorer build (PREPARED, NOT EXECUTED)

Status: waiting for the owner's explicit yes. Nothing below has been signed or sent on mainnet.

## What changes

| | Now (pinned on `kredofi.near`) | After the re-pin |
|---|---|---|
| Scorer SHA-256 | `87ceab664ebf5596ee1a78f84e7f3817faa452dcb67c5f98cac1ad724a3e1587` | `7614ee86f18e96bc64c1717fd367523d2d5fb8e08750f47e8d7519a77ef362a6` |
| Source code | same | same: only `scorer/build.sh` changed (`--remap-path-prefix`) |
| Build paths inside the WASM | the builder's home folder (28 strings) | fixed: `/kredofi/scorer/...` and `/cargo/...` |
| Rebuildable by anyone | no | yes: `cd scorer && ./build.sh` |

Reproducibility checked (Nov 2): the same `7614ee86…` from (1) the repository folder, (2) a copy in another folder with a fresh, empty Cargo home, and (3) a Linux container (`rust:1.93.0-slim`, see the log entry). `./build.sh legacy` still reproduces `87ceab66…` on the original machine.

## Mainnet transactions (all signed by the account that owns the OutLayer project and `kredofi.near`)

0. **Not a transaction, but public:** add `kredofi_scorer.wasm` (`7614ee86…`) and its `.sha256` to the public repository `kenil1710/kredofi-scorer-wasm` in a new commit; check `curl -sL https://raw.githubusercontent.com/kenil1710/kredofi-scorer-wasm/<new commit>/kredofi_scorer.wasm | shasum -a 256` prints `7614ee86…`.
1. **Register the new version** on OutLayer (to `outlayer.near`):
   `outlayer deploy kredofi-scorer https://raw.githubusercontent.com/kenil1710/kredofi-scorer-wasm/<new commit>/kredofi_scorer.wasm --hash 7614ee86f18e96bc64c1717fd367523d2d5fb8e08750f47e8d7519a77ef362a6 --no-activate`
   Cost: a storage deposit, at most about 0.1 NEAR (creating the project cost 0.1 NEAR on Nov 1), plus about 0.0013 NEAR gas.
2. **Move the secrets lock to the new build** (to `outlayer.near`, `update_access`):
   `outlayer secrets access --project <owner>/kredofi-scorer --profile kredofi --access allow-all --via kredofi.near --build 7614ee86f18e96bc64c1717fd367523d2d5fb8e08750f47e8d7519a77ef362a6`
   Cost: about 0.009 NEAR deposit (Nov 1: 0.0083 and 0.0092) plus about 0.0011 NEAR gas. From here the old build can no longer read the secrets, so step 3 follows right away.
3. **Pin it in the contract** (to `kredofi.near`):
   `near contract call-function as-transaction kredofi.near set_scorer_version json-args '{"version":"7614ee86f18e96bc64c1717fd367523d2d5fb8e08750f47e8d7519a77ef362a6"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' ...`
   Cost: about 0.0005 NEAR gas (about 0.03 NEAR is reserved while signing and refunded). Emits `scorer_version_changed`.
4. **Prove it end to end (optional, recommended):** one `request_score` from the same account with a Plaid sandbox token, as on Nov 1.
   Cost: 0.01 NEAR fee (about 0.008 NEAR comes back) plus about 0.002 NEAR gas.

**Total: at most about 0.125 NEAR** (most likely about 0.03 NEAR plus the version deposit). The signing account holds 0.304 NEAR (Nov 2).

## Afterwards

- README, VERIFY.md, `/docs` (Verify it yourself, Testnet vs mainnet, Contracts & API, Security) and THREAT_MODEL.md: replace `87ceab66…` with `7614ee86…`, drop the "not reproducible" limit, link the new transactions.
- Optional in the same re-pin (would change the hash again, so decide before step 0): also ship the stricter Plaid history check that the testnet build already uses.
