#!/usr/bin/env bash
# One-time owner setup on testnet (safe to re-run: each step checks state first).
#  1. Pin the scorer build that dev_scorer runs (demo build). Contract v4 has a re-pin time lock
#     (60 s on testnet): propose_scorer_version, wait, apply_scorer_version. v3 uses set_scorer_version.
#  2. Register the owner with mock USDC, mint $300 test USDC (relayer = minter), seed the reserve.
# kency.testnet signs with its keychain key (near CLI); the relayer with its legacy keychain key.
# Prepaid gas is 40 Tgas: NEAR reserves ~0.001 NEAR per prepaid Tgas at signing (tests/tests/gas_budget.rs).
set -euo pipefail
cd "$(dirname "$0")/.."
NET=testnet; POOL=${POOL:-kredofi.kency.testnet}; USDC=musdc.kency.testnet; OWNER=kency.testnet; RELAYER=relayer.kency.testnet
v() { node --input-type=module -e "import {view} from './scripts/lib/near.mjs'; console.log(JSON.stringify(await view('$1','$2',$3)))"; }

# The demo scorer must be the canonical CI build (x86_64 Linux): a local macOS build has another hash.
# Get it with: gh run download <run id> -n scorer-wasm -D scorer/out   (never rebuild it here)
test -f scorer/out/kredofi_scorer_demo.wasm || { echo 'scorer/out/kredofi_scorer_demo.wasm missing: download the CI artifact'; exit 1; }
HASH=$(shasum -a 256 scorer/out/kredofi_scorer_demo.wasm | cut -d' ' -f1)
PINNED=$(v $POOL get_config '{}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["scorer_version"])')
if [[ "$PINNED" != "$HASH" ]]; then
  DELAY=$(v $POOL get_config '{}' | python3 -c 'import json,sys;print(json.load(sys.stdin).get("scorer_delay_ns",""))')
  owner_call() { near contract call-function as-transaction $POOL "$1" json-args "$2" \
    prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as $OWNER network-config $NET sign-with-keychain send 2>&1 | grep -E "Transaction ID|EVENT_JSON|Error" || true; }
  if [[ -z "$DELAY" ]]; then
    echo "Pinning scorer_version $HASH (contract without time lock)"
    owner_call set_scorer_version "{\"version\":\"$HASH\"}"
  else
    PENDING=$(v $POOL get_pending_scorer '{}' | python3 -c 'import json,sys;p=json.load(sys.stdin);print(p["version"] if p else "")')
    if [[ -n "$PENDING" && "$PENDING" != "$HASH" ]]; then echo "Another change is pending ($PENDING): cancel it first"; exit 1; fi
    if [[ -z "$PENDING" ]]; then echo "Proposing scorer_version $HASH"; owner_call propose_scorer_version "{\"version\":\"$HASH\"}"; fi
    WAIT=$(( DELAY / 1000000000 + 5 )); echo "Time lock: waiting ${WAIT}s"; sleep $WAIT
    owner_call apply_scorer_version '{}'
  fi
else echo "scorer_version already pinned: $HASH"; fi

RESERVE=$(v $POOL get_pool '{}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["reserve"])')
if [[ "$RESERVE" == "0" ]]; then
  if [[ $(v $USDC storage_balance_of "{\"account_id\":\"$OWNER\"}") == "null" ]]; then
    near contract call-function as-transaction $USDC storage_deposit json-args "{\"account_id\":\"$OWNER\",\"registration_only\":true}" \
      prepaid-gas '30 Tgas' attached-deposit '0.0125 NEAR' sign-as $RELAYER network-config $NET sign-with-legacy-keychain send 2>&1 | grep -E "Transaction ID|Error" || true
  fi
  near contract call-function as-transaction $USDC mint json-args "{\"account_id\":\"$OWNER\",\"amount\":\"300000000\"}" \
    prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as $RELAYER network-config $NET sign-with-legacy-keychain send 2>&1 | grep -E "Transaction ID|Error" || true
  near contract call-function as-transaction $USDC ft_transfer_call json-args "{\"receiver_id\":\"$POOL\",\"amount\":\"300000000\",\"msg\":\"seed_reserve\"}" \
    prepaid-gas '40 Tgas' attached-deposit '1 yoctoNEAR' sign-as $OWNER network-config $NET sign-with-keychain send 2>&1 | grep -E "Transaction ID|reserve_seeded|Error" || true
else echo "reserve already seeded: $RESERVE"; fi
v $POOL get_pool '{}'
