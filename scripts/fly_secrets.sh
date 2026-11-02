#!/usr/bin/env bash
# Send the server secrets from web/.env.local to Fly (encrypted at rest, injected at runtime).
# Values are streamed to `fly secrets import` on stdin: never printed, never on the command line.
# web/.env.local must hold the TESTNET SEAL_KEY (SEAL_KEY_TESTNET), never the mainnet one.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=web/.env.local
KEYS="PLAID_CLIENT_ID PLAID_SECRET SEAL_KEY NEARAI_KEY DEV_SCORER_ACCOUNT_ID DEV_SCORER_KEY RELAYER_ACCOUNT_ID RELAYER_KEY NEAR_RPC_URLS"
# Safety: refuse if the web server's SEAL_KEY equals the mainnet one in .env.
main=$(grep '^SEAL_KEY=' .env | cut -d= -f2-)
web=$(grep '^SEAL_KEY=' "$ENV_FILE" | cut -d= -f2-)
if [[ -z "$web" || "$web" == "$main" ]]; then echo "Refusing: $ENV_FILE SEAL_KEY is missing or equals the mainnet SEAL_KEY."; exit 1; fi
for k in $KEYS; do grep -E "^${k}=" "$ENV_FILE" || true; done | fly secrets import "$@"
echo "Secrets staged on Fly (names only):"
fly secrets list "$@" | awk 'NR==1 || /PLAID|SEAL|SCORER|RELAYER|RPC/ {print $1}'
