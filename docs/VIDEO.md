# Demo video script (2 minutes or less)

Rules (PLAN.md): problem in the first 10 seconds, live product by second 15, no login screens or bullet slides, one complete loop on camera, Sam rejected with reasons, Max defaults and the reserve pays, at least one real transaction opened on nearblocks. Final cut at least 4 hours before submitting.

One change from the PLAN wording: the complete loop uses the real bank connection (Plaid's public sandbox login) instead of Riya, because that is now the product's main path. Riya, Sam and Max are on the Demo scenarios page.

## Before recording (10 minutes)

1. Two fresh private windows at 1440 x 900, zoom 100%, nothing else on screen. Window A: https://kredofi.xyz. Window B: https://kredofi.xyz/scenarios.
2. **Max, 4 minutes before recording** (his default needs the 2-minute term plus 1-minute grace): in window B, **Use Max**, wait for the note, click **Borrow $100.00**. Leave the tab open.
3. Window A: open the landing page and let it load once (so the intro animation is cached), then reload.
4. Have a third tab ready on the public ledger: https://kredofi.xyz/ledger
5. Tab 4: https://nearblocks.io/txns/CNsoyGSj6aXtUmGzxUisxERirsv9jAsAZQ7GKVj7Udb7 (receipts expanded). Tab 5: a clean terminal, 24 pt font, with the `curl … | shasum -a 256` command from https://kredofi.xyz/docs/verify typed in.

## Script

The first 30 seconds are the privacy proof (the enclave and how to check it); the loan comes after.

| Time | On screen (exact clicks) | Voice-over |
|---|---|---|
| 0:00-0:06 | Window A, landing hero "Prove your income on NEAR without showing your bank statements." | "To borrow, you prove your income by handing a lender every bank statement. KredoFi proves it without showing them." |
| 0:06-0:14 | Scroll once: the camera dives into "Inside the enclave (mainnet)"; the tally counts to 1000 and stamps BAND A. | "On mainnet a pinned scorer fetches up to two years of history, uses the last six full months, inside a sealed enclave, Intel TDX, and puts eight fields on NEAR: a band and limit, a keyed fingerprint, sealed data, nothing raw." |
| 0:14-0:22 | Tab 4: the real mainnet score on nearblocks, [tx 9w6qBWdV…](https://nearblocks.io/txns/9w6qBWdViZrE2Y4KisYxxjdMtbCmAvRyNvAs6WGbymHm). Zoom on the receipts: `request_score` -> `outlayer.near`, the log with version `5175182a…`, then `score_issued`, band A. | "This is a real mainnet score. The contract asked OutLayer for one exact program, by its hash, and accepted the answer only in its own callback." |
| 0:22-0:30 | Tab 5: a terminal with one command in large type, `curl -sL <pinned WASM URL from /docs/verify> \| shasum -a 256`, printing `5175182a…`; cut to the /ledger Verify panel. | "Anyone can download that program and check the hash. Now the first use, a loan, live on testnet." |
| 0:30-0:36 | Window A: **Check my limit**, then **Connect your bank (sandbox)**. Plaid opens. | "This demo is testnet: Plaid's sandbox bank, test money, and the same rules running on our server instead of the enclave. No wallet needed." |
| 0:36-0:46 | In Plaid: **Continue without phone number**, search **First Platypus**, pick **First Platypus Bank**, `user_good` / `pass_good`, **Submit**, **Continue**, **Finish without saving**. (2x speed.) | "Plaid hands back a one-time token. The scorer uses it once and removes the bank connection." |
| 0:46-0:57 | "Limit checked in N s", the receipt line, the credit note stamped **BAND B, $75**, the five rule rows. | "Every transaction goes in. Five published rules, one line out, and it keeps none of them." |
| 0:57-1:02 | Point at the right rail, "What left the scorer": band, score, fingerprint, sealed_identity. | "This line is all that went on-chain: a band, a keyed fingerprint so one bank backs one borrower, and a sealed name." |
| 1:02-1:11 | **Borrow $75.00**; "Loan issued" with the countdown. **Repay $79.50**; Repaid and the PAID stamp. | "Borrow, repay, and your limit grows." |
| 1:11-1:15 | Click the transaction link under Repaid; testnet.nearblocks.io opens. | "Every step is a real NEAR transaction." |
| 1:15-1:27 | Window B, `/scenarios`: **Try another scenario**, **Use Sam**. **NOT THIS TIME** and "What would change this". | "Sam is refused and told why. Lenders only see the band." |
| 1:27-1:42 | Max's tab (borrowed 4 minutes ago): **Mark as defaulted**, then **Release the name to the recovery partner**. | "Max never paid. Anyone can mark the default; the reserve pays lenders first, and only now is his sealed name opened, for the recovery partner." |
| 1:42-1:53 | Ledger tab: the newest rows, then the Verify panel. | "Every score and loan is public; the bank data never is." |
| 1:53-2:00 | End card: "KredoFi. Prove your income on NEAR. Built at NEAR HACKATHON" and https://kredofi.xyz. | "KredoFi. Prove your income on NEAR without showing your statements." Closing line: "This is a hackathon MVP: next comes a capped pilot with real banks and a licensed lending partner." |

## Notes

- On mainnet the same scorer runs inside Intel TDX through OutLayer ([tx 9w6qBWdV…](https://nearblocks.io/txns/9w6qBWdViZrE2Y4KisYxxjdMtbCmAvRyNvAs6WGbymHm), with a sealed bank token; live view at https://kredofi.xyz/mainnet). Say "testnet" once on camera; the banner on every app screen says it too.
- If scoring takes longer than 20 s, cut the wait in editing and keep the "Limit checked in N s" title visible.
- Don't show `.env`, other terminal windows, the Cloudflare or Hugging Face settings. The only terminal on camera is the one-command hash check.
- If the testnet demo moves into OutLayer (docs/ENCLAVE_PLAN.md), change the 0:30 line to "the same enclave, with test money" and the rail title back to "What left the enclave".
