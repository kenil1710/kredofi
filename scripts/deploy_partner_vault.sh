#!/usr/bin/env bash
# Testnet only (SPEC 8e): create partner-vault.kency.testnet, deploy the vault, register it with test USDC.
# Safe to re-run: skips the account if it exists; a second init fails and changes nothing.
set -euo pipefail
cd "$(dirname "$0")/.."
NET=testnet; VAULT=partner-vault.kency.testnet; OWNER=kency.testnet; RELAYER=relayer.kency.testnet
KREDOFI=app.kency.testnet; USDC=musdc.kency.testnet
(cd contracts/partner-vault && cargo near build non-reproducible-wasm >/dev/null 2>&1)
WASM=target/near/partner_vault/partner_vault.wasm
shasum -a 256 "$WASM"
if ! near account view-account-summary $VAULT network-config $NET now >/dev/null 2>&1; then
  near account create-account fund-myself $VAULT '2.5 NEAR' autogenerate-new-keypair save-to-legacy-keychain \
    sign-as $OWNER network-config $NET sign-with-keychain send 2>&1 | grep -E "Transaction ID|rror" || true
fi
near contract deploy $VAULT use-file "$WASM" with-init-call new \
  json-args "{\"kredofi\":\"$KREDOFI\",\"usdc\":\"$USDC\"}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  network-config $NET sign-with-legacy-keychain send 2>&1 | grep -E "Transaction ID|rror" || true
near contract call-function as-transaction $USDC storage_deposit json-args "{\"account_id\":\"$VAULT\",\"registration_only\":true}" \
  prepaid-gas '30 Tgas' attached-deposit '0.0125 NEAR' sign-as $RELAYER network-config $NET sign-with-legacy-keychain send 2>&1 | grep -E "Transaction ID|rror" || true
near contract call-function as-read-only $VAULT get_stats json-args '{}' network-config $NET now 2>/dev/null | tail -6
