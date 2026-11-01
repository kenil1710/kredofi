#!/usr/bin/env bash
# Deploy mock-usdc and kredofi (Dev mode) to NEAR testnet.
# Accounts (created once, keys in ~/.near-credentials/testnet, never in the repo):
#   kredofi.kency.testnet  pool contract (needs ~3 NEAR: the wasm is ~271 KB of storage)
#   musdc.kency.testnet    mock USDC (owner/minter = relayer, SPEC 8a)
#   scorer.kency.testnet   dev_scorer
#   relayer.kency.testnet  no-wallet demo relayer and test USDC faucet
# Reads only PARTNER_PUBKEY from .env.
# Run once on fresh accounts: init calls fail on an already-initialised contract.
set -euo pipefail
cd "$(dirname "$0")/.."

NET=testnet
OWNER=kency.testnet
POOL=kredofi.kency.testnet
USDC=musdc.kency.testnet
SCORER=scorer.kency.testnet
RELAYER=relayer.kency.testnet
# Demo timing (SPEC 4 Owner): 2 min term (init derives a 1 min minimum hold), 1 min grace, 30 day score TTL.
TERM_NS=120000000000
GRACE_NS=60000000000
TTL_NS=2592000000000000
# No scorer WASM is pinned yet in Dev mode; set_scorer_version updates this on day 5.
SCORER_VERSION=0000000000000000000000000000000000000000000000000000000000000000

PARTNER_PUBKEY=$(grep '^PARTNER_PUBKEY=' .env | cut -d= -f2)
[[ ${#PARTNER_PUBKEY} -eq 64 ]] || { echo "PARTNER_PUBKEY missing in .env"; exit 1; }

(cd contracts/mock-usdc && cargo near build non-reproducible-wasm)
# --no-embed-abi: same binary as deployed on testnet and mainnet (saves ~3 KB of storage).
(cd contracts/kredofi && cargo near build non-reproducible-wasm --no-embed-abi)

near contract deploy "$USDC" use-file target/near/mock_usdc/mock_usdc.wasm \
  with-init-call new json-args "{\"owner\":\"$RELAYER\"}" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  network-config $NET sign-with-legacy-keychain send

CONFIG=$(cat <<JSON
{"config":{
  "owner":"$OWNER","usdc":"$USDC","scorer_mode":"Dev","dev_scorer":"$SCORER",
  "outlayer":"outlayer.testnet","scorer_project":"$OWNER/kredofi-scorer",
  "scorer_version":"$SCORER_VERSION","secrets_profile":"kredofi","secrets_account":"$OWNER",
  "partner_pubkey":"$PARTNER_PUBKEY",
  "loan_term_ns":"$TERM_NS","grace_ns":"$GRACE_NS","score_ttl_ns":"$TTL_NS",
  "max_borrower_share_bps":1000}}
JSON
)
near contract deploy "$POOL" use-file target/near/kredofi/kredofi.wasm \
  with-init-call new json-args "$CONFIG" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  network-config $NET sign-with-legacy-keychain send

# The pool must hold USDC: register it with the token (paid by the relayer).
near contract call-function as-transaction "$USDC" storage_deposit \
  json-args "{\"account_id\":\"$POOL\",\"registration_only\":true}" \
  prepaid-gas '30 Tgas' attached-deposit '0.0125 NEAR' \
  sign-as "$RELAYER" network-config $NET sign-with-legacy-keychain send

echo "Deployed: $POOL (Dev mode), $USDC (owner $RELAYER)"
