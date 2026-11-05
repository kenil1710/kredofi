#!/usr/bin/env bash
# TESTNET ONLY. Deploy a KredoFi contract in OutLayer mode, so testnet scores also run inside the
# enclave (docs/ENCLAVE_PLAN.md). Used for throwaway test contracts and for app.kency.testnet (Nov 5).
#
#   set -a; source .env; set +a     # PARTNER_PUBKEY, PLAID_CLIENT_ID, PLAID_SECRET, SEAL_KEY_TESTNET (never printed)
#   ./scripts/deploy_outlayer_testnet.sh <account>.testnet [initial NEAR, default 4]
#
# Steps: build the contract; create <account> as a sub-account of kency.testnet if it doesn't exist;
# deploy + init in OutLayer mode pinned to the testnet OutLayer scorer build; register the pool with
# test USDC (relayer pays); lock the OutLayer secrets profile to that build AND this contract.
# The secrets lock names one contract, so it moves to the newest deploy (the previous one can no
# longer read them). Seed the reserve afterwards: KREDOFI_CONTRACT=<account> ./scripts/reserve_guard.sh
set -euo pipefail
cd "$(dirname "$0")/.."

POOL="${1:?usage: deploy_outlayer_testnet.sh <account>.testnet [NEAR]}"
FUND="${2:-4}"
case "$POOL" in *.kency.testnet) ;; *) echo "refusing $POOL: testnet sub-accounts of kency.testnet only"; exit 1 ;; esac
NET=testnet
OWNER=kency.testnet
USDC=musdc.kency.testnet
RELAYER=relayer.kency.testnet
# Testnet OutLayer scorer build (scorer/build.sh testnet-outlayer, CI run 42006645803), published at
# kenil1710/kredofi-scorer-wasm@9fdaaea and added to kency.testnet/kredofi-scorer on outlayer.testnet.
SCORER_VERSION=96666cdf840746c062738e6e74af5ab46eacd8bc40c60ccb43d9d638ac17bcfc
TERM_NS=120000000000      # demo timing (SPEC 4): 2 min term, 1 min grace, 30 day score TTL
GRACE_NS=60000000000
TTL_NS=2592000000000000

for k in PARTNER_PUBKEY PLAID_CLIENT_ID PLAID_SECRET SEAL_KEY_TESTNET; do
  [[ -n "${!k:-}" ]] || { echo "$k not set (set -a; source .env; set +a)"; exit 1; }
done

(cd contracts/kredofi && cargo near build non-reproducible-wasm --no-embed-abi)

if ! near account view-account-summary "$POOL" network-config $NET now >/dev/null 2>&1; then
  near account create-account fund-myself "$POOL" "$FUND NEAR" autogenerate-new-keypair save-to-legacy-keychain \
    sign-as "$OWNER" network-config $NET sign-with-keychain send   # kency.testnet: macOS keychain
fi

CONFIG=$(cat <<JSON
{"config":{
  "owner":"$OWNER","usdc":"$USDC","scorer_mode":"OutLayer","dev_scorer":null,
  "outlayer":"outlayer.testnet","scorer_project":"$OWNER/kredofi-scorer",
  "scorer_version":"$SCORER_VERSION","secrets_profile":"kredofi","secrets_account":"$OWNER",
  "partner_pubkey":"$PARTNER_PUBKEY",
  "loan_term_ns":"$TERM_NS","grace_ns":"$GRACE_NS","score_ttl_ns":"$TTL_NS",
  "max_borrower_share_bps":1000,"require_production_data":false}}
JSON
)
near contract deploy "$POOL" use-file target/near/kredofi/kredofi.wasm \
  with-init-call new json-args "$CONFIG" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  network-config $NET sign-with-legacy-keychain send

near contract call-function as-transaction "$USDC" storage_deposit \
  json-args "{\"account_id\":\"$POOL\",\"registration_only\":true}" \
  prepaid-gas '30 Tgas' attached-deposit '0.0125 NEAR' \
  sign-as "$RELAYER" network-config $NET sign-with-legacy-keychain send

# Secrets: testnet Plaid sandbox keys and the TESTNET SEAL_KEY (never the mainnet one), readable only by
# this build when the run is started by this contract. Values go through argv of a local process only.
OUTLAYER_NETWORK=testnet outlayer secrets set \
  "$(python3 -c 'import json,os;print(json.dumps({"PLAID_CLIENT_ID":os.environ["PLAID_CLIENT_ID"],"PLAID_SECRET":os.environ["PLAID_SECRET"],"SEAL_KEY":os.environ["SEAL_KEY_TESTNET"]}))')" \
  --profile kredofi --project "$OWNER/kredofi-scorer" --access allow-all --via "$POOL" --build "$SCORER_VERSION" 2>&1 \
  | grep -v -i 'private_key\|PLAID_SECRET\|SEAL_KEY"' | tail -3

echo "Deployed $POOL in OutLayer mode (scorer $SCORER_VERSION). Next: KREDOFI_CONTRACT=$POOL ./scripts/reserve_guard.sh"
