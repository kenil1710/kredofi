# Deploy KredoFi to a Hugging Face Space (testnet)

> **Live (Nov 3):** https://kredofi.xyz (Cloudflare Worker, below) in front of https://kenil1710-kredofi.hf.space, Space `kenil1710/kredofi` (public, Docker). The free tier refused Docker (`402 Payment Required`: Docker Spaces on free cpu-basic need PRO), so it runs on paid **cpu-upgrade** hardware (8 vCPU, 32 GB, $0.03/hour) billed to the account's prepaid HF credits, with sleep **off** (`hf_space.py create --hardware cpu-upgrade`, then sleep time set to never). No PRO, no card. $20 of credits lasts about 666 hours (27 days) running continuously. Because it never sleeps, the uptime pinger is optional (still useful as a down alert).

Decided Nov 2: a public **Docker Space** on the free CPU tier (2 vCPU, 16 GB RAM, no persistent disk,
sleeps after 48 h without visits). Fly.io (`docs/DEPLOY.md`) stays ready for when a card is available.

## What goes where

| Where | What |
|---|---|
| Space files (public) | `Dockerfile` (from `deploy/hf/`), `README.md` (Space card), the **git-tracked** files under `web/` (no `.env*`, no tests), and the pinned demo scorer `scorer/out/kredofi_scorer_demo.wasm` (`ac8e2a9c…`). Built by `scripts/hf_space.py stage` into `build/hf-space/` (git-ignored), which then scans every staged byte for every secret value in `.env` and `web/.env.local` and refuses on any hit (tested with a planted key). |
| Space secrets (encrypted, runtime env only) | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `SEAL_KEY` (**testnet** key from `web/.env.local`; the script refuses the mainnet one), `NEARAI_KEY`, `DEV_SCORER_ACCOUNT_ID`, `DEV_SCORER_KEY`, `RELAYER_ACCOUNT_ID`, `RELAYER_KEY`, `NEAR_RPC_URLS`. |
| Image settings | wasmtime 50.0.0 (checksum-verified), runs as uid 1000, port 7860, scorer outputs and ledger cache under `/home/node/data` (lost on restart: the ledger re-reads the chain; a borrower who defaulted before a restart can't release their name until they score again). |

Verified locally (Nov 2): the staged image built for linux/amd64, ran as uid 1000 with only the Space
secrets, served `/`, `/borrow`, `/lend`, `/api/health`, `/api/ledger`, and scored a testnet borrower
end to end through wasmtime (band A, tx `7SCUsFy1…`, sealed AI summary stored).

## You: create the account and a token (5 minutes)

1. Go to https://huggingface.co/join, sign up with email (no card), confirm the email.
2. Pick your username. The Space will be `https://huggingface.co/spaces/<username>/kredofi`, and the app
   will run at `https://<username>-kredofi.hf.space`.
3. Open https://huggingface.co/settings/tokens, **Create new token**, type **Write**, name it `kredofi-deploy`.
   Copy it.
4. Add it to `.env` in the repo (git-ignored) as one line, without showing it anywhere else:
   `HF_TOKEN=hf_...`
5. Tell me your username and say go.

## Me, after your go (nothing below has run yet)

```bash
cd ~/kredofi
uv run --with huggingface_hub==0.36.0 python scripts/hf_space.py create  --space <username>/kredofi  # public Docker Space
uv run --with huggingface_hub==0.36.0 python scripts/hf_space.py secrets --space <username>/kredofi  # 9 secrets, names printed only
uv run --with huggingface_hub==0.36.0 python scripts/hf_space.py push    --space <username>/kredofi  # stage + secret scan + upload
```

The first build on HF takes about 5 to 8 minutes (Space page, **Logs** tab). Then:
`curl https://<username>-kredofi.hf.space/api/health` prints `{"ok":true,"network":"testnet",...}`.

Each later deploy: commit, then `push` again (it re-stages from git and re-scans).
If the scorer changes: rebuild the demo build, pin it on testnet, update `SCORER_SHA256` in
`deploy/hf/Dockerfile` (stage refuses a mismatch), commit, push.

## Keep it awake during judging (free)

A free Space sleeps after 48 h without visits; a ping every few minutes keeps it up.

1. https://uptimerobot.com, sign up (free, no card).
2. **New monitor**: type HTTP(s), URL `https://kredofi.xyz/api/health`, interval 5 minutes.
   `/api/health` makes no chain or Plaid calls, so pings cost nothing.
3. Optional backup: https://cron-job.org (free), same URL every 15 minutes.

Add a second monitor, type **Keyword**, same URL, keyword `"reserveLow":true`, alert when it **exists**: `/api/health` reports the testnet reserve, and this emails you when judge testing has pushed it below $200. Then run `./scripts/reserve_guard.sh` (tops it up to $500).

UptimeRobot also emails you if the Space goes down (for example after an HF restart or a failed build).

## kredofi.xyz -> the Space (Cloudflare Worker reverse proxy)

A free Space can't use a custom domain, so a free Cloudflare Worker (`deploy/cloudflare/worker.js`,
tests in `worker.test.mjs`) proxies `https://kredofi.xyz` to the Space and the address bar stays
`kredofi.xyz`. `www.kredofi.xyz` and plain HTTP redirect (301) to `https://kredofi.xyz`. Bodies stream
both ways; cookies and redirects pass through (redirects to the Space address are rewritten).

Client IP for rate limits: the Worker sends Cloudflare's `CF-Connecting-IP` as `x-kredofi-client-ip`
with `x-kredofi-proxy: PROXY_SECRET`; the app trusts it only when the secret matches
(`web/src/server/clientIp.ts`). Visitor-sent `x-kredofi-*`, `cf-*` and `X-Forwarded-For` are dropped.
Requests straight to `*.hf.space` without the secret share one bucket (the Space's `X-Forwarded-For` can be
forged), and page loads there redirect to `kredofi.xyz` (`web/src/proxy.ts`).

Deploy (zone `kredofi.xyz` on Cloudflare; token with Workers Scripts, Workers Routes/Custom Domains, DNS and
Zone Settings edit):

```bash
set -a; source .env; set +a      # CLOUDFLARE_API_TOKEN, PROXY_SECRET (never printed)
python3 scripts/cf_worker.py deploy   # Worker + secret, custom domains (DNS + certificates), Always Use HTTPS, TLS 1.2+
uv run --with huggingface_hub==0.36.0 python scripts/hf_space.py secrets --space <user>/kredofi   # PROXY_SECRET on the Space too
```

Check: `curl -sI http://www.kredofi.xyz/lend` ends at `https://kredofi.xyz/lend`; `curl -s https://kredofi.xyz/api/health`.

## Testnet NEAR the live demo spends

Each new demo account costs the relayer about 0.007 NEAR, and each new borrower about 0.002 NEAR of
contract storage. On Nov 2: relayer 0.06, scorer 0.10, kency 0.06, contract 0.06 free. Top up before
judging (the faucet URL used earlier now returns 404).

## Keeping the demo up until Nov 25 (rule Q-012)

State on Nov 4: `/api/health` ok; reserve $500; relayer 16.4 testnet NEAR (floor 3); contract storage 0.81 NEAR free;
Space RUNNING on cpu-upgrade with sleep off; domain `kredofi.xyz` registered until 2027-11-03; the Worker has no
expiry and stays far under the free plan's 100k requests/day.

Watch: `.github/workflows/health-watch.yml` reads `/api/health` every 6 hours until Nov 26 and fails (GitHub emails
you) when the site is down or the reserve, relayer or storage is low. No secrets, no transactions.

| What | Runs out when | Check | Fix |
|---|---|---|---|
| HF credits ($0.72/day) | $20 from Nov 2 lasts to about Nov 29: only 4 days of margin | huggingface.co/settings/billing on **Nov 10 and Nov 18**: you need at least $0.72 × days left to Nov 25 | add $5–10 of prepaid credits |
| Testnet reserve | each Max-style default can take up to $100 of it | health-watch email (below $200) | `./scripts/reserve_guard.sh` (tops up to $500) |
| Relayer NEAR | about 0.03 per judge in OutLayer mode (from Nov 5); demo funding stops at 3 NEAR | health-watch email; `relayerLow` | faucet accounts → `relayer.kency.testnet` |
| Cloudflare Worker | doesn't | `curl -sI https://kredofi.xyz` | `python3 scripts/cf_worker.py deploy` |
| Seeded ledger | stops by itself after Nov 13 (`SEED_UNTIL`); the hourly tick keeps pinging healthchecks.io through Nov 26 | nothing to do | — |

Before judging starts (Nov 16): run `./scripts/reserve_guard.sh` once and open `/api/health`.
