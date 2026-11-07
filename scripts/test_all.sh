#!/usr/bin/env bash
# Every test in the repo, in one command, from the repo root: ./scripts/test_all.sh
# Offline except the first cargo run (downloads the NEAR sandbox node). The live-site raw HTML check is not here
# (it needs a running build: BASE=http://localhost:3000 node --test scripts/raw_html.test.mjs).
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n== %s\n' "$1"; }

step 'contracts: unit + near-workspaces sandbox (cargo test --workspace)'
cargo test --workspace

step 'scorer (SPEC 6 table: Riya 1000/A, Sam 270/D, Max 1000/A)'
(cd scorer && cargo test)

step 'web: lib, server and docs tests'
(cd web && npm ci --no-audit --no-fund >/dev/null && npm test)

step 'scripts, Cloudflare Worker and Space timing (offline)'
(cd scripts && npm ci --no-audit --no-fund >/dev/null)
node --experimental-strip-types --test scripts/seal.test.mjs scripts/seed_ledger.test.mjs scripts/drift_guard.test.mjs scripts/slow_check.test.mjs
node --test deploy/cloudflare/worker.test.mjs deploy/cloudflare/cron.test.mjs deploy/hf/timing.test.mjs

printf '\nAll tests passed.\n'
