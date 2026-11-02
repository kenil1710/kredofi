# Mainnet re-pin: reproducible scorer build (DONE, Nov 2)

Status: executed on Nov 2 after the owner's yes, with a different final hash than first planned: the build also includes the stricter Plaid history check, so mainnet and testnet share the scoring logic. Final production hash `7048cc92a708564df3acdececd9a9880c3054f6d9ff0b4cebedd51ac268dc978` (two CI runs identical). Public WASM: commit `f174d555cc79f009d4275b32ad9f4e533c823531`. Transactions: add_version [3MKpCgQs…](https://nearblocks.io/txns/3MKpCgQsJeXYF8zMK5yVnWfdckFBW3YToGirX4ZznCqs) (0.0056 NEAR), update_access [CCE14Fyq…](https://nearblocks.io/txns/CCE14Fyq76Xhhh6yPzRCv8zhF4gQfXLi9n431f31dNLi) (0.0011), set_scorer_version [AtYo7XWz…](https://nearblocks.io/txns/AtYo7XWz4Y4h655hm7N8YPSmMX4kxo8exzCM47GjJRZn) (0.0002), request_score [CNsoyGSj…](https://nearblocks.io/txns/CNsoyGSj6aXtUmGzxUisxERirsv9jAsAZQ7GKVj7Udb7) (0.0039; band A 1000 inside OutLayer, 7.6 s). Total 0.0108 NEAR.

The plan as prepared (hash `39eec3ba…` then) follows.

## What changes

| | Now (pinned on `kredofi.near`) | After the re-pin |
|---|---|---|
| Scorer SHA-256 | `87ceab664ebf5596ee1a78f84e7f3817faa452dcb67c5f98cac1ad724a3e1587` | `39eec3ba1e0208f838cfa7d5cb32ff0f8112594217fd44cb5703cd5954fa2975` |
| Source code | same | same: only the build changed (`--remap-path-prefix`, built on x86_64 Linux) |
| Build paths inside the WASM | the builder's home folder (28 strings) | fixed: `/kredofi/scorer/...` and `/cargo/...` |
| Rebuildable by anyone | no | yes: `./scorer/build-docker.sh` on any x86_64 machine with Docker, or the GitHub workflow in a fork |

Reproducibility checked (Nov 2): the bytes depend on the build host's operating system and CPU, even with the same source, `Cargo.lock` and rustc 1.93.0 (macOS arm64, Linux arm64 and Linux x86_64 each give their own hash, likely because Cargo mixes the host into its crate hashes). So the canonical build is **x86_64 Linux in the pinned image** `rust:1.93.0-slim@sha256:760ad1d6…` (`scorer/build-docker.sh`), run by the GitHub workflow `scorer reproducible build`: two separate runs gave the same `39eec3ba…` (production) and `7f578981…` (testnet demo), with no build-machine paths inside. `./build.sh legacy` still reproduces `87ceab66…` on the original machine.

## Mainnet transactions (all signed by the account that owns the OutLayer project and `kredofi.near`)

0. **Not a transaction, but public:** add the CI-built `kredofi_scorer.wasm` (`39eec3ba…`, artifact of the workflow run) and its `.sha256` to the public repository `kenil1710/kredofi-scorer-wasm` in a new commit; check `curl -sL https://raw.githubusercontent.com/kenil1710/kredofi-scorer-wasm/<new commit>/kredofi_scorer.wasm | shasum -a 256` prints `39eec3ba…`.
1. **Register the new version** on OutLayer (to `outlayer.near`):
   `outlayer deploy kredofi-scorer https://raw.githubusercontent.com/kenil1710/kredofi-scorer-wasm/<new commit>/kredofi_scorer.wasm --hash 39eec3ba1e0208f838cfa7d5cb32ff0f8112594217fd44cb5703cd5954fa2975 --no-activate`
   Cost: a storage deposit, at most about 0.1 NEAR (creating the project cost 0.1 NEAR on Nov 1), plus about 0.0013 NEAR gas.
2. **Move the secrets lock to the new build** (to `outlayer.near`, `update_access`):
   `outlayer secrets access --project <owner>/kredofi-scorer --profile kredofi --access allow-all --via kredofi.near --build 39eec3ba1e0208f838cfa7d5cb32ff0f8112594217fd44cb5703cd5954fa2975`
   Cost: about 0.009 NEAR deposit (Nov 1: 0.0083 and 0.0092) plus about 0.0011 NEAR gas. From here the old build can no longer read the secrets, so step 3 follows right away.
3. **Pin it in the contract** (to `kredofi.near`):
   `near contract call-function as-transaction kredofi.near set_scorer_version json-args '{"version":"39eec3ba1e0208f838cfa7d5cb32ff0f8112594217fd44cb5703cd5954fa2975"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' ...`
   Cost: about 0.0005 NEAR gas (about 0.03 NEAR is reserved while signing and refunded). Emits `scorer_version_changed`.
4. **Prove it end to end (optional, recommended):** one `request_score` from the same account with a Plaid sandbox token, as on Nov 1.
   Cost: 0.01 NEAR fee (about 0.008 NEAR comes back) plus about 0.002 NEAR gas.

**Total: at most about 0.125 NEAR** (most likely about 0.03 NEAR plus the version deposit). The signing account holds 0.304 NEAR (Nov 2).

## Afterwards

- README, VERIFY.md, `/docs` (Verify it yourself, Testnet vs mainnet, Contracts & API, Security) and THREAT_MODEL.md: replace `87ceab66…` with `39eec3ba…`, drop the "not reproducible" limit, link the new transactions.
- Optional in the same re-pin (would change the hash again, so decide before step 0): also ship the stricter Plaid history check that the testnet build already uses.
