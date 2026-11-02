#!/usr/bin/env bash
# Testnet reserve guard: if the reserve of kredofi.kency.testnet is below MIN_USD, top it up to
# TARGET_USD with test USDC (the relayer mints to the owner; the owner seeds with msg "seed_reserve").
# Safe to run often (cron, or before a judging session); it does nothing when the reserve is healthy.
#   ./scripts/reserve_guard.sh            # defaults: MIN_USD=200 TARGET_USD=500
#   MIN_USD=300 TARGET_USD=800 ./scripts/reserve_guard.sh
# Testnet only. kency.testnet signs with its keychain key, the relayer with its legacy keychain key.
set -euo pipefail
cd "$(dirname "$0")/.."
NET=testnet; POOL="${KREDOFI_CONTRACT:-kredofi.kency.testnet}"; USDC=musdc.kency.testnet; OWNER=kency.testnet; RELAYER=relayer.kency.testnet
MIN_USD="${MIN_USD:-200}"; TARGET_USD="${TARGET_USD:-500}"
v() { node --input-type=module -e "import {view} from './scripts/lib/near.mjs'; console.log(JSON.stringify(await view('$1','$2',$3)))"; }
RESERVE=$(v $POOL get_pool '{}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["reserve"])')
echo "reserve now: \$$(python3 -c "print(f'{$RESERVE/1e6:,.2f}')")"
if python3 -c "import sys; sys.exit(0 if $RESERVE >= $MIN_USD*10**6 else 1)"; then echo "healthy (at least \$$MIN_USD): nothing to do"; exit 0; fi
NEED=$(python3 -c "print($TARGET_USD*10**6 - $RESERVE)")
echo "topping up by \$$(python3 -c "print(f'{$NEED/1e6:,.2f}')") to \$$TARGET_USD"
if [[ $(v $USDC storage_balance_of "{\"account_id\":\"$OWNER\"}") == "null" ]]; then
  near contract call-function as-transaction $USDC storage_deposit json-args "{\"account_id\":\"$OWNER\",\"registration_only\":true}" \
    prepaid-gas '30 Tgas' attached-deposit '0.0125 NEAR' sign-as $RELAYER network-config $NET sign-with-legacy-keychain send 2>&1 | grep -E "Transaction ID|Error" || true
fi
near contract call-function as-transaction $USDC mint json-args "{\"account_id\":\"$OWNER\",\"amount\":\"$NEED\"}" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as $RELAYER network-config $NET sign-with-legacy-keychain send 2>&1 | grep -E "Transaction ID|Error" || true
near contract call-function as-transaction $USDC ft_transfer_call json-args "{\"receiver_id\":\"$POOL\",\"amount\":\"$NEED\",\"msg\":\"seed_reserve\"}" \
  prepaid-gas '40 Tgas' attached-deposit '1 yoctoNEAR' sign-as $OWNER network-config $NET sign-with-keychain send 2>&1 | grep -E "Transaction ID|reserve_seeded|Error" || true
v $POOL get_pool '{}' | python3 -c 'import json,sys;p=json.load(sys.stdin);print("reserve after: $%.2f" % (int(p["reserve"])/1e6))'
