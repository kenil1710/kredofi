# Deploy KredoFi to a Hugging Face Space (testnet)

> **Blocked (Nov 2):** creating the Space returned `402 Payment Required`: "Static Spaces are free for everyone, but hosting Gradio and Docker Spaces on free cpu-basic requires a PRO subscription." Nothing was created and no secret was sent. Everything below works as soon as the account has PRO (or another host is chosen).

Decided Nov 2: a public **Docker Space** on the free CPU tier (2 vCPU, 16 GB RAM, no persistent disk,
sleeps after 48 h without visits). Fly.io (`docs/DEPLOY.md`) stays ready for when a card is available.

## What goes where

| Where | What |
|---|---|
| Space files (public) | `Dockerfile` (from `deploy/hf/`), `README.md` (Space card), the **git-tracked** files under `web/` (no `.env*`, no tests), and the pinned demo scorer `scorer/out/kredofi_scorer_demo.wasm` (`ca0936c6…`). Built by `scripts/hf_space.py stage` into `build/hf-space/` (git-ignored), which then scans every staged byte for every secret value in `.env` and `web/.env.local` and refuses on any hit (tested with a planted key). |
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
2. **New monitor**: type HTTP(s), URL `https://<username>-kredofi.hf.space/api/health`, interval 5 minutes.
   `/api/health` makes no chain or Plaid calls, so pings cost nothing.
3. Optional backup: https://cron-job.org (free), same URL every 15 minutes.

UptimeRobot also emails you if the Space goes down (for example after an HF restart or a failed build).

## kredofi.xyz -> the Space (redirect)

A free Space can't use a custom domain (that is a PRO feature), so `kredofi.xyz` **redirects** to the
`hf.space` address; the address bar then shows `<username>-kredofi.hf.space`.

**If your registrar offers URL forwarding** (Namecheap, Porkbun, Spaceship, GoDaddy all do, free):
forward `kredofi.xyz` and `www.kredofi.xyz` to `https://<username>-kredofi.hf.space` as a **301
permanent** redirect, with "forward path" on if offered.

**Or with Cloudflare (free plan)**: add `kredofi.xyz` as a site and switch the nameservers at your
registrar to the two Cloudflare gives you. In DNS add `A @ 192.0.2.1` and `A www 192.0.2.1`, both
**Proxied** (orange cloud; the IP is a placeholder, never reached). Then **Rules > Redirect Rules >
Create rule**: "All incoming requests", type **Dynamic**, expression
`concat("https://<username>-kredofi.hf.space", http.request.uri.path)`, status 301, preserve query string.

Check: `curl -sI https://kredofi.xyz/lend` shows `301` and `location: https://<username>-kredofi.hf.space/lend`.

## Testnet NEAR the live demo spends

Each new demo account costs the relayer about 0.007 NEAR, and each new borrower about 0.002 NEAR of
contract storage. On Nov 2: relayer 0.06, scorer 0.10, kency 0.06, contract 0.06 free. Top up before
judging (the faucet URL used earlier now returns 404).
