# KredoFi prep log (Oct 23-25, 2026)

Everything below was tested before the hackathon, in practice code (`~/near-practice`), not in the KredoFi repo. Claude Code: trust these results and reuse the exact settings; don't re-discover them.

## Results

| # | What | Result | Proof |
|---|---|---|---|
| 1 | Rust contract build and deploy (near-sdk 5, cargo-near) | Works. Auction template needs an init call (`end_time` in ns) | `hello.kency.testnet` |
| 2 | OutLayer TEE run on mainnet | Works: returned "Hello from the TEE", about 0.002 NEAR | tx `G8Hu1yUJn2Dcc5iMnh4BabiirQdjLGgBu2mFK8RDza6a` |
| 3 | OutLayer testnet | Workers didn't respond (requests 5604, 5606 timed out about 2 min, refunded) | Use mainnet for the connected flow |
| 4 | Contract calling OutLayer, failure path | `version_key` pinned the exact version; `NEAR_SENDER_ID` = borrower; failed run gives `null` to the `#[private]` callback, nothing changes; unused deposit refunded to the contract | tx `CCWy2xNr2GbTWecTqCs3x2Y7iCLU83TY3YqzPZbazUvr` (`ask.kency.testnet`) |
| 5 | Contract calling OutLayer, success path | **Not tested** (needs NEAR for storage). PLAN day 6 | - |
| 6 | Plaid sandbox inside the TEE with encrypted secrets | Works: 14 accounts found, keys and access token never left the TEE; 0.00145 NEAR, 3.9 s | tx `8u8RsNzgxKSdhSbzSwi5qb7CGeWrk9RJWhHzVvWfZfbW`, version `f45185a0…` |
| 7 | Test borrowers (Plaid custom users) | Riya 30 tx / 1000 / A; Sam 20 tx / 270 / D; Max 24 tx / 1000 / A | `gen_borrowers.py`, `score_check.py` |
| 8 | Owner name from Plaid `/identity/get` | Works in sandbox: "Alberta Bobbeth Charleson", 29 bytes | Oct 25, `identity_test.sh` |
| 9 | Sealing the name inside `wasm32-wasip2` | Works: 100-byte sealed value, right key opens, wrong key fails | `seal-test` crate, SPEC section 5 |
| 10 | NEAR AI Cloud privacy | Qwen/Qwen3.8-27B has gateway + GPU (`nvidia_payload`) attestation. Many other models don't | `/v1/attestation/report` |
| 11 | NEAR AI Cloud call | Works with thinking turned off: 2 sentences, 97 tokens, about $0.00005 | Oct 25 |
| 12 | NEAR Intents 1Click quote | Dry quote: 10 USDC on Base gives 9.993 USDC on NEAR, about 35 s | `POST /v0/quote` with `dry: true` |
| 13 | Meta transactions + function-call keys | Relayer created a demo sub-account and paid its gas. Function-call key: no deposit allowed, one receiver only | tx `8etwNVqLwriLvYKmFA6gnoaGT4L5SsDTheLumvoRQcRx`, SPEC 8a |

## Lessons (each cost time once)

- Shade Agent Framework is deprecated; use OutLayer.
- OutLayer versions are keyed by WASM SHA-256; the same hash can't be uploaded twice.
- Host the WASM at a **commit-pinned** GitHub raw URL, never `/main/` (cached, hash check fails). FastFS returned 502 for 30+ minutes.
- `outlayer deploy <name> <url> --hash <sha>`; the CLI's own suggested commands had wrong flags (`--wasm-url`) and file names.
- `outlayer run` times out in the CLI while the run continues; check with `near transaction view-status`.
- The CLI reserves 300 Tgas (about 0.3 NEAR); call `request_execution` with 100 Tgas instead.
- Secrets need `secrets_ref` in the request and the caller on the access whitelist.
- On-chain OutLayer output limit is about 900 bytes.
- `wasi-http-client` 0.2.1 crashes or hangs on bodies over 4 KB; use the vendored patch (`fix_http.py`).
- Plaid: `days_requested: 730` (default 90); `roll_dates_forward: true`; negative amount = money in; sandbox drops transactions that would push the balance below zero (give borrowers enough starting balance); loop `/transactions/sync` until `HISTORICAL_UPDATE_COMPLETE`.
- Qwen3 on NEAR AI: send `"chat_template_kwargs": {"enable_thinking": false}` and `/no_think`, or `content` comes back `null`.
- NEAR AI needs credits and a spending limit before any call.
- zsh: use `read -rs "VAR?Prompt: "` to enter secrets; plain `read -s` can return empty.
- Function-call keys can't attach deposits, so they can't do `ft_transfer_call` (1 yocto).
