# KredoFi build plan (Nov 1-14, 2026)

Solo build with Claude Code. Read with `SPEC.md` (what), `DESIGN.md` (look and behavior), `HACKATHON.md` (rules, deadlines), `CLAUDE.md` (how to work).

Each day ends with: tests passing, a commit, and one line in `docs/LOG.md` (what works, what's next). If a day slips, take time from the cut list at the bottom, never from tests.

## Week 1: the engine

| Day | Date | Build | Done when |
|---|---|---|---|
| 1 | Sun Nov 1 | Repo (private) with `contracts/`, `scorer/`, `web/`, `scripts/`, `tests/`, `docs/`. Copy the four docs in. `mock-usdc` (NEP-141, 6 decimals). `kredofi` config and pool: `deposit` and `seed_reserve` through `ft_on_transfer`, `withdraw` with rollback callback, share math. | Workspace tests for deposit, withdraw, share price, owner can't move funds |
| 2 | Mon Nov 2 | Scores: `dev_submit_score`, `on_score` parsing, `ScoreRecord`, expiry, one fingerprint per borrower, `get_limit`, NEP-297 events. | Security rules 1-6 each have a passing test |
| 3 | Tue Nov 3 | Loans: `borrow` (limit, cash, 10% cap, rollback), `repay` via `ft_transfer_call` (exact amount, interest split, level up), `mark_default` (grace, reserve first, block), `request_identity_release` in Dev mode. Deploy to testnet in Dev mode. | All SPEC section 7 tests pass; Riya/Sam/Max flows pass as contract tests |
| 4 | Wed Nov 4 | Scorer crate from the practice code: Plaid fetch (patched wasi-http-client), features, scoring rules, fingerprint (HMAC), seal (tested scheme), output under 900 bytes. `gen_borrowers.py` with an identity name per borrower. | Unit tests reproduce the SPEC section 6 table exactly; wasmtime run prints valid output |
| 5 | Thu Nov 5 | `scripts/dev_scorer`: runs the scorer WASM locally and calls `dev_submit_score`. Release op (re-encrypt to partner key). End-to-end on testnet: score, borrow, repay, default, release. | The full demo script (SPEC section 8, steps 1-5) runs from the command line on testnet |
| 6 | Fri Nov 6 | Mainnet OutLayer: upload scorer (commit-pinned URL), secrets with contract-only whitelist, deploy `kredofi` in OutLayer mode, one real `request_score` and successful `on_score`. Needs about 1.5 NEAR. | A mainnet tx where `on_score` stores a score. If blocked: write down why, keep the failure-path tx, move on |
| 7 | Sat Nov 7 | Web foundation: Next.js, tokens as CSS variables, Archivo, seal and stamp components, guilloche, enclave box, transaction-state hook (Signing, Sent, Confirmed, Failed). | Component test page matches the design canvas at 1440 and 375 px |

## Week 2: the product

| Day | Date | Build | Done when |
|---|---|---|---|
| 8 | Sun Nov 8 | Borrower passbook page wired to testnet: connect, pick test borrower, score with honest waiting phases, seal or Rejected stamp, receipt, borrow, repay, all states from DESIGN 7.7. | Riya and Sam work end to end in the browser with a wallet |
| 9 | Mon Nov 9 | No-wallet demo accounts (SPEC 8a): relayer API route, browser key, meta transactions, allowlist, rate limit. Pick-a-borrower screen with "Build your own borrower" (SPEC 8b) and "Connect a sandbox bank yourself" with real Plaid Link (SPEC 8c). | A fresh browser with no wallet finishes Riya's loop in under 3 minutes; a custom borrower with low income gets a lower band; a judge can log in to Plaid's test bank and get scored |
| 10 | Tue Nov 10 | Lender page (pool, deposit, withdraw). Public ledger (events, filters, band table, Verify panel). | Lender deposit shows on the ledger within 5 s |
| 11 | Wed Nov 11 | Landing page (hero animation). Then extras by priority: Intents cross-chain deposit, AI summary. Deploy web (testnet). | Live URL works on a phone |
| 12 | Thu Nov 12 | **Feature freeze.** Full runs of Riya, Sam, Max in a fresh browser. Fix bugs. Reduced motion, keyboard, 375 px. | No known bug in the demo path |
| 13 | Fri Nov 13 | README for AI judges (HACKATHON.md notes), `VERIFY.md`, `THREAT_MODEL.md`. Record the demo video (2-3 minutes). Draft the X post. | A stranger can follow the README and finish a loan |
| 14 | Sat Nov 14 | By 12:00 UTC: repo public, X post live, submission sent after Kency confirms the payload. | 201 response from the submission API |

## Every day (10 minutes, outside the build)

- **Push every commit** to the private GitHub repo. If the laptop dies, nothing is lost.
- **Build in public:** Kency posts one short update on X with a screen clip of what works today, tagging @NEARProtocol and the tech used that day (@near_ai, OutLayer). Judges should recognise KredoFi before they open the submission. Posting only; no DMs needed. Never post keys, account secrets or unfinished security details.

## Demo video rules (day 13)

- 2 minutes or less. Problem in the first 10 seconds ("you can't borrow on-chain without collateral, and proving income means showing everything").
- Live product on screen by second 15. No login screens, no slides with bullet lists.
- One complete loop on camera: Riya scored inside the enclave, borrows, repays. Then Sam rejected with reasons, then Max defaults and the reserve pays. Show at least one real transaction opening on nearblocks.
- Final cut finished at least 4 hours before we submit.

## Optional proof of skill (only if ahead)

- Open a GitHub issue (or a small PR) on `wasi-http-client` for the 4 KB request-body bug, with our fix from `scripts/fix_http.py`, and link it in the README. Sponsors and judges value builders who fix the tools they use.

## Cut list (in this order, only if behind)

1. AI summary (the score never depends on it).
2. Intents cross-chain deposit (keep the 1Click quote screen if the deposit flow isn't done).
3. Landing animation polish (a static hero is fine).
4. Mainnet live flow (keep the prep transactions as evidence and say so in the README).

Never cut: contract tests, the no-wallet demo path, the receipt ("What left the enclave"), the README.
