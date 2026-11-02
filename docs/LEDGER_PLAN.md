# Plan: a clean testnet ledger before judging

Status (Nov 2): **approved** (29 loans, 27 repaid, 2 defaults in band B and C only; tag every seeded row; SPEC 8d). Scripts and ledger tags are built and dry-run on a throwaway contract. **Deploying `app.kency.testnet` and switching the site still need the owner's yes (Nov 5).** Nothing on `kredofi.kency.testnet` was changed.

## Built and tested (Nov 2)

- `scripts/seed_ledger.mjs`: `plan` (prints the 29-loan plan), `plan --score-check` (runs the pinned demo scorer on all 24 profiles with Plaid sandbox, nothing submitted: **24/24 land in their planned band**, after retuning the B and C profiles, which first scored a band too high), `setup`, `tick` (scheduled, see below), `status`. Run with `node --experimental-strip-types`.
- Accounts: `borrower-01…24.kredofi-seed.testnet` and `lender.kredofi-seed.testnet`, under the faucet-funded `kredofi-seed.testnet` (`kency.testnet` holds only 1.26 NEAR, so `seed-NN.kency.testnet` couldn't be funded).
- Ledger: "Seeded demo" tag on every seeded row; band table split into "Visitors and judges" (the contract's `get_stats` minus the seeded part) and "Seeded demo", under the sentence below (`web/src/lib/seeded.ts`, tests).
- Scripts default to `kredofi.kency.testnet` and refuse `app.kency.testnet` unless `ALLOW_DEMO_CONTRACT=1` (`scripts/lib/near.mjs`).
- Dry run on throwaway `kredofi-seedtest-1793636134.testnet` (same wasm, owner `kredofi-seed.testnet`): setup, then borrower 01 two loans repaid (levels 1→2→3, limit $100→$500), borrower 21 band C default (reserve $500→$461), borrower 22 band D score. Contract `get_stats` and the ledger's seeded table matched exactly.
- `tick` runs on **GitHub Actions**, not on a laptop (`.github/workflows/seed-tick.yml`): every 3 hours on GitHub's runners, testnet only, no-op until the repository variable `SEED_CONTRACT` is set, frozen after 2026-11-13 23:59 UTC. It accepts only `app.kency.testnet` or a throwaway `kredofi-seedtest-*.testnet`. Repository secrets (set from `.env` and `~/.near-credentials` through stdin, never printed): `PLAID_CLIENT_ID`, `PLAID_SECRET` (sandbox), `SEAL_KEY_TESTNET`, `SEED_TESTNET_KEYS` (the 24 borrowers, the lender and `scorer.kency.testnet`; no owner, relayer, parent or mainnet key). The pinned demo scorer comes from CI run 41438833584 (artifact kept until 2027-01-31) and wasmtime 50.0.0 is hash-checked. The done-list lives on the `seed-state` branch, and every step is checked on-chain first (`chainState`: a loan already taken is never repeated, an open loan left by a killed run is repaid or defaulted on schedule). Tested Nov 2 from GitHub on the throwaway contract: borrower 02 scored A 960, two loans repaid (level-up $100 to $250); a re-run did nothing; a run with no saved state for borrower 01 found both loans on-chain and skipped them.
- Found and fixed in the dry run: `borrow` needs 1 yoctoNEAR; the ledger cache file wasn't tied to a contract (a switch would have shown the old contract's events), now it records its contract and ignores another's.

## Switch checklist (Nov 5, after the yes)

1. Faucet account for funds; create `app.kency.testnet` (about 3 NEAR) and deploy the same wasm with init `new` (owner `kency.testnet`, Dev mode, scorer `ac8e2a9c…`, term 2 min, grace 1 min).
2. Register it with `musdc.kency.testnet`; `KREDOFI_CONTRACT=app.kency.testnet ./scripts/reserve_guard.sh`.
3. `KREDOFI_CONTRACT=app.kency.testnet node --experimental-strip-types scripts/seed_ledger.mjs setup` (local, once), then start the schedule: `gh variable set SEED_CONTRACT --body app.kency.testnet` and `gh variable set SEED_START --body <setup's start time>`. Stop at any time with `gh variable delete SEED_CONTRACT`.
4. Space: `NEXT_PUBLIC_KREDOFI_CONTRACT=app.kency.testnet`, redeploy; relayer allow-list and `/api/health` follow the variable.
5. Docs, README, VERIFY, video notes: new address, and the sentence about seeded rows. Our Playwright runs move to a local server on `kredofi.kency.testnet`.

## The problem

`kredofi.kency.testnet` holds every test run since Nov 1. On Nov 2 the public ledger showed:

| Band | Scored | Loans | Repaid | Defaulted |
|---|---|---|---|---|
| A | 36 | 15 | 7 | 7 |
| B | 27 | 15 | 12 | 3 |
| C | 11 | 2 | 0 | 2 |
| D | 20 | 0 | 0 | 0 |

The defaults are our own scripts testing the default path (Max, "Mark as defaulted"), not borrowers. A judge reading the ledger sees band A failing half the time.

## Proposal

**1. Two testnet contracts instead of one (same code, no contract change).**

| Contract | Used by | Shown on the live site |
|---|---|---|
| `app.kency.testnet` (new) | the live site, judges, seeded history | yes |
| `kredofi.kency.testnet` (today's) | our automated tests and scripts from now on | no; linked from /docs as "development contract, our test runs" |

The same `kredofi` wasm as today, deployed fresh, with the same config (term 2 min, grace 1 min, min hold 1 min) and the pinned testnet demo scorer `ac8e2a9c…`. A second test-USDC isn't needed: both contracts use `musdc.kency.testnet`. The old contract's history stays on-chain and readable, so nothing is hidden.

Test scripts get a guard: `scripts/demo.mjs`, the Playwright runs and `dev_scorer.mjs` refuse the judge contract unless `ALLOW_DEMO_CONTRACT=1` is set, so a test can't land there by accident. Our end-to-end checks run against a local server (or a second private Space) pointed at the test contract.

**2. A seeded history, labelled as seeded everywhere.**

- Seeded borrowers are separate testnet accounts named `borrower-01.kredofi-seed.testnet` … `borrower-24.kredofi-seed.testnet`. The pattern is published in `web/src/lib/seeded.ts` and in /docs.
- Every seeded step is a real transaction through the real path: a Plaid sandbox score from the pinned scorer (sandbox profiles), `borrow`, `repay` or a real default after the grace period, with the reserve paying the pool. Only the borrower is scripted.
- Proposed mix (about 24 borrowers, spread over Nov 5–12, a few loans a day rather than all at once):

| Band | Borrowers | Loans | Repaid | Defaulted |
|---|---|---|---|---|
| A | 8 | 12 | 12 | 0 |
| B | 8 | 11 | 10 | 1 |
| C | 5 | 6 | 5 | 1 |
| D | 3 | 0 (refused, as the rules say) | — | — |

  That's 27 of 29 loans repaid and 2 defaults, both paid back to the pool by the reserve (about $150 of the $500 reserve; `reserve_guard.sh` tops it up).
- **Labels:** on /ledger, each seeded event carries a "Seeded demo" tag, the band table shows seeded and visitor numbers separately, and a line above it says: "Rows tagged Seeded demo were made by our script with Plaid sandbox data to show how the ledger looks over time. They are not real users." The same sentence goes in /docs (Testnet vs mainnet), README and the demo video notes. Judges' own runs show untagged.

**3. Steps and timing (all testnet)**

| When | Step | Needs your yes |
|---|---|---|
| Nov 3 | Script `scripts/seed_ledger.mjs` (dry run prints the plan), ledger "Seeded demo" tag + split table, script guards, tests | no (code only) |
| Nov 4 | Full dry run of the seeding against a throwaway contract `kredofi-seedtest.kency.testnet`; I show you the ledger page | no |
| Nov 5 | Deploy `app.kency.testnet`, init, pin scorer, seed reserve $500, point the Space at it, redeploy; docs/README/VERIFY updated to the new address | **yes** |
| Nov 5–12 | Seeding runs a few loans a day (GitHub Actions schedule, every 3 h; works with the laptop asleep) | covered by the Nov 5 yes |
| Nov 13 | Freeze: seeding stops, reserve topped up, final check of every number on the ledger | no |

Cost: testnet NEAR only (faucet); no mainnet transaction, no change to `kredofi.near` or the mainnet docs.

## Not proposed

- Wiping or migrating the old contract's state (it stays as the honest record of our tests).
- Fabricated events or anything that isn't a real transaction.
- Presenting seeded borrowers as users anywhere.

## Decisions (owner, Nov 2)

Contract name `app.kency.testnet`; 2 defaults in 29 loans, band B and C only; tag and split table added to SPEC (8d).
