# Plan: a clean testnet ledger before judging (PROPOSAL, not executed)

Status: proposal for the owner's yes (Nov 2). Nothing has been wiped, deployed or seeded.

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
| `kredofi-demo.kency.testnet` (new) | the live site, judges, seeded history | yes |
| `kredofi.kency.testnet` (today's) | our automated tests and scripts from now on | no; linked from /docs as "development contract, our test runs" |

The same `kredofi` wasm as today, deployed fresh, with the same config (term 2 min, grace 1 min, min hold 1 min) and the pinned testnet demo scorer `ac8e2a9c…`. A second test-USDC isn't needed: both contracts use `musdc.kency.testnet`. The old contract's history stays on-chain and readable, so nothing is hidden.

Test scripts get a guard: `scripts/demo.mjs`, the Playwright runs and `dev_scorer.mjs` refuse the judge contract unless `ALLOW_DEMO_CONTRACT=1` is set, so a test can't land there by accident. Our end-to-end checks run against a local server (or a second private Space) pointed at the test contract.

**2. A seeded history, labelled as seeded everywhere.**

- Seeded borrowers are separate testnet accounts named `seed-01.kency.testnet` … `seed-24.kency.testnet`. The list is published in `web/src/lib/seeded.ts` and in /docs.
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
| Nov 5 | Deploy `kredofi-demo.kency.testnet`, init, pin scorer, seed reserve $500, point the Space at it, redeploy; docs/README/VERIFY updated to the new address | **yes** |
| Nov 5–12 | Seeding runs a few loans a day (cron on this machine) | covered by the Nov 5 yes |
| Nov 13 | Freeze: seeding stops, reserve topped up, final check of every number on the ledger | no |

Cost: testnet NEAR only (faucet); no mainnet transaction, no change to `kredofi.near` or the mainnet docs.

## Not proposed

- Wiping or migrating the old contract's state (it stays as the honest record of our tests).
- Fabricated events or anything that isn't a real transaction.
- Presenting seeded borrowers as users anywhere.

## Open questions for you

1. Names: `kredofi-demo.kency.testnet` for the judge contract OK?
2. Mix: is 2 defaults in 29 loans the right story, or would you rather show 0, or more?
3. Ledger tag and split table are UI outside SPEC: OK to add?
