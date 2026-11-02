# Deploying the testnet app to kredofi.xyz (Fly.io)

What goes live: the Next.js app (passbook, lender page, public ledger) plus its API routes, which
run the **pinned demo scorer with wasmtime** (testnet Dev mode), relay no-wallet meta transactions
and serve the ledger. Testnet only: no mainnet key is ever on this server.

Prepared and tested locally on Nov 2: the image builds, passes its checksum checks, contains no
secrets, and finished the full no-wallet Riya loop (`scripts/e2e_demo.mjs`) in 120 s.

## What it costs

| Item | Monthly |
|---|---|
| 1 machine, shared-cpu-1x, 1 GB RAM, always on (`bom`, Mumbai) | about $5.70 |
| 1 GB volume (`/data`: ledger cache, scorer outputs for identity release) | about $0.15 |
| TLS certificates for kredofi.xyz and www | free (first 10) |
| **Total** | **about $6** |

Keep it at **one machine**: rate limits and the ledger cache are per machine.

## Files

| File | What it does |
|---|---|
| `Dockerfile` | Builds the app; installs wasmtime 50.0.0 (checksum-verified); copies the demo scorer and **refuses to build** unless its SHA-256 equals the version pinned on testnet (`17f25a0d…`). |
| `docker-entrypoint.sh` | Makes the `/data` volume writable, then runs the server as the unprivileged `node` user. |
| `.dockerignore` | Allowlist: only `web/`, the scorer wasm and the entrypoint. `.env` and `web/.env.local` can never enter the image. |
| `fly.toml` | App `kredofi`, region `bom`, port 3000, HTTPS only, always on, volume `kredofi_data` at `/data`. |
| `scripts/fly_secrets.sh` | Streams the server secrets from `web/.env.local` to Fly without printing them, and refuses if the SEAL_KEY is the mainnet one. |

## Secrets (set once, encrypted by Fly, injected at runtime only)

`PLAID_CLIENT_ID`, `PLAID_SECRET` (sandbox), `SEAL_KEY` (the **testnet-only** key, `SEAL_KEY_TESTNET`
in `.env`), `DEV_SCORER_ACCOUNT_ID` + `DEV_SCORER_KEY` (`scorer.kency.testnet`), `RELAYER_ACCOUNT_ID` +
`RELAYER_KEY` (`relayer.kency.testnet`), optional `NEAR_RPC_URLS` (comma-separated RPC URLs, e.g.
with a FastNEAR API key). All of them are testnet keys.

## Step by step

Run from the repo root on your Mac. Nothing here touches mainnet.

1. **Install flyctl and sign in.**
   ```
   brew install flyctl
   fly auth login
   ```
2. **Create the app** (no deploy yet). If the name `kredofi` is taken on Fly, pick another and
   change `app` in `fly.toml` to match.
   ```
   fly apps create kredofi
   ```
3. **Create the volume** in the same region.
   ```
   fly volumes create kredofi_data --region bom --size 1 --yes
   ```
4. **Build the pinned demo scorer** (the Dockerfile checks its hash).
   ```
   (cd scorer && ./build.sh demo)    # must print sha256 17f25a0d…
   ```
5. **Set the secrets** from `web/.env.local` (values are never shown).
   ```
   ./scripts/fly_secrets.sh
   ```
   It prints only the secret names. If it says "Refusing", the web SEAL_KEY is the mainnet one:
   stop and tell Claude.
6. **Deploy.** Fly builds the image on its own builders and starts one machine.
   ```
   fly deploy
   ```
7. **Check it** on the Fly URL before the domain.
   ```
   curl -s -o /dev/null -w "%{http_code}\n" https://kredofi.fly.dev/borrow      # 200
   node scripts/e2e_demo.mjs https://kredofi.fly.dev                            # full no-wallet loop, about 2 min
   ```
8. **Point kredofi.xyz at it.**
   ```
   fly ips list                      # note the shared IPv4 and the IPv6
   fly certs add kredofi.xyz
   fly certs add www.kredofi.xyz
   ```
   At your domain registrar, add: `A kredofi.xyz -> <IPv4>`, `AAAA kredofi.xyz -> <IPv6>`,
   `CNAME www -> kredofi.fly.dev`. Then `fly certs show kredofi.xyz` until it says the certificate
   is issued (usually a few minutes after DNS updates).
9. **Final check:** open https://kredofi.xyz/borrow in a private window and do the Riya loop.

## Everyday operations

- Logs: `fly logs`
- Restart: `fly machine restart`
- Roll back: `fly releases` then `fly deploy --image <image from an earlier release>`
- New scorer build: rebuild the demo wasm, pin it on testnet (`scripts/testnet_setup.sh`), update
  `SCORER_SHA256` in the `Dockerfile`, then `fly deploy`.
- Relayer low on test NEAR: top up `relayer.kency.testnet` (faucet), no redeploy needed.
- Rotate a key: `fly secrets set NAME=...` (Fly restarts the machine).
