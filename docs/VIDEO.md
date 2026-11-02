# Demo video script (2 minutes or less)

Rules (PLAN.md): problem in the first 10 seconds, live product by second 15, no login screens or bullet slides, one complete loop on camera, Sam rejected with reasons, Max defaults and the reserve pays, at least one real transaction opened on nearblocks. Final cut at least 4 hours before submitting.

One change from the PLAN wording: the complete loop uses the real bank connection (Plaid's public sandbox login) instead of Riya, because that is now the product's main path. Riya, Sam and Max are on the Demo scenarios page.

## Before recording (10 minutes)

1. Two fresh private windows at 1440 x 900, zoom 100%, nothing else on screen. Window A: https://kenil1710-kredofi.hf.space. Window B: https://kenil1710-kredofi.hf.space/scenarios.
2. **Max, 4 minutes before recording** (his default needs the 2-minute term plus 1-minute grace): in window B, **Use Max**, wait for the note, click **Borrow $100.00**. Leave the tab open.
3. Window A: open the landing page and let it load once (so the intro animation is cached), then reload.
4. Have a third tab ready on the public ledger: https://kenil1710-kredofi.hf.space/ledger

## Script

| Time | On screen (exact clicks) | Voice-over |
|---|---|---|
| 0:00-0:08 | Window A, landing hero "Borrow against your payslip." | "On-chain, you can't borrow without locking up more than you borrow. And proving your income means showing a lender everything." |
| 0:08-0:15 | Scroll once: the camera dives into the enclave; the tally counts to 1000 and stamps BAND A. | "KredoFi reads your bank history inside a sealed computer and puts only a band and a limit on NEAR." |
| 0:15-0:22 | Click **Check my limit**, then **Connect your bank (sandbox)**. Plaid opens. | "Here's the real flow, on testnet, with Plaid's public sandbox bank. No wallet needed." |
| 0:22-0:35 | In Plaid: **Continue without phone number**, search **First Platypus**, pick **First Platypus Bank**, type `user_good` / `pass_good`, **Submit**, **Continue**, **Finish without saving**. (Speed this part up 2x in editing.) | "Plaid hands a one-time token to the scorer, never to us or to the chain." |
| 0:35-0:50 | The "Checking your limit" box with its four phases, then "Limit checked in N s", the receipt line, the credit note stamped **BAND B, $75**, the five rule rows. | "The pinned scorer pulled 386 transactions, applied five published rules, and kept none of it. The receipt shows counts, never the transactions." |
| 0:50-0:57 | Point at the right rail, "What left the enclave": the JSON with band, score, fingerprint, sealed_identity. | "This one line is everything that left: a band, a keyed fingerprint so one bank backs one borrower, and the name sealed for a recovery partner." |
| 0:57-1:07 | Click **Borrow $75.00**. "Loan issued" appears with "Repay after 0:5x to level up". Click **Repay $79.50**. The Repaid entry and PAID stamp appear. | "Borrow, repay. Interest is split: half to lenders, half to the treasury. Hold the loan longer and your limit grows." |
| 1:07-1:13 | Click the transaction link under Repaid; testnet.nearblocks.io opens on that transaction. | "Every step is a real transaction on NEAR." |
| 1:13-1:28 | Window B, `/scenarios`: click **Try another scenario**, **Use Sam**. The note stamped **NOT THIS TIME** and "What would change this". | "Sam is refused, and he's told why: income in only four of six months, four overdraft fees. Lenders only see the band." |
| 1:28-1:45 | Switch to Max's tab (borrowed 4 minutes ago). Click **Mark as defaulted**, then **Release the name to the recovery partner**. The Defaulted entry: "Reserve paid the pool back first", "sealed, then opened". | "Max looked perfect and never paid. After the grace period anyone can mark the default: the reserve pays lenders first, and only now is his sealed name opened, for the recovery partner." |
| 1:45-1:55 | Ledger tab: the newest rows (Default, the reserve paid; Loan repaid; Score issued, band B), then the Verify panel. | "The public ledger shows every score and loan, and the scorer's hash that anyone can check." |
| 1:55-2:00 | End card: "KredoFi, built at NEAR HACKATHON" and the live URL. | "KredoFi. Private credit on NEAR." |

## Notes

- On mainnet the same scorer runs inside Intel TDX through OutLayer ([tx 4dgHrA97…](https://nearblocks.io/txns/4dgHrA97KfibKifZuVZ2YF5zoAVCy4m2pXxxf9zdijyu)). Say "testnet" once on camera; the banner on every app screen says it too.
- If scoring takes longer than 20 s, cut the wait in editing and keep the "Limit checked in N s" title visible.
- Don't show `.env`, terminal windows or the Hugging Face settings.
