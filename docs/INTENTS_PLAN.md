# Plan: a real cross-chain lender deposit through NEAR Intents (not built)

Status (Nov 3): **plan only.** Today the Lend page asks 1Click for a real quote with `dry: true` (`web/src/app/api/intents/quote/route.ts`). No deposit address is ever issued, so no money moves.

## The blocker: there is no Intents testnet

The official rules say so (HACKATHON.md Q-007): "None exists or is planned. Mainnet, separate dev accounts, tiny amounts, dry: true quotes."

1Click delivers **real native USDC on NEAR mainnet** (`17208628…`). The testnet pool takes only mock USDC (`musdc.kency.testnet`). So a real Intents deposit **cannot land in the testnet pool**. Any "real" testnet version would be a simulation, and we would have to call it one.

## What a real version would take (mainnet only)

1. **Quote with `dry: false`** for "USDC on Base/Arbitrum/Ethereum/Solana → USDC on NEAR":
   - `recipient` = the lender's own NEAR account;
   - `refundTo` = the lender's address on the source chain;
   - `deadline` about 10 minutes out.

   1Click answers with a one-time **deposit address**. Without a partner JWT the fee is 0.2% (Q-006); with a free registration at partners.near-intents.org it can be lower.
2. **The lender sends USDC** to that address from their own source-chain wallet. That needs an EVM or Solana wallet connection in the page: a new dependency, and a second wallet next to NEAR Connect.
3. **Poll `/v0/status`** until `SUCCESS`, and show `REFUNDED` / `FAILED` states plainly.
4. **The lender deposits** with `ft_transfer_call(kredofi.near, amount, "deposit")` from their NEAR wallet. The pool only credits the account that sends the tokens, so this has to be the lender's own step: 1Click can't deposit for them.
5. **`kredofi.near` refuses lender deposits** until `production_data` is set (audit H2, live since Nov 3). So the last step would fail on mainnet today, on purpose.

Options for a hackathon demo:
- Stop after step 3, showing USDC arriving in the lender's own NEAR account.
- Use a separate mainnet "demo vault" contract with a cap. That is new scope and more audit surface.

## Time and cost

- **Code:** about 1.5–2 days, including tests and a dry-run harness.
  - quote with a deposit address;
  - a source-chain wallet in the browser;
  - status polling and error states;
  - the deposit step;
  - docs.
- **Live test:**
  - a few dollars of real USDC on Base;
  - about $0.01–$0.10 of source-chain gas per run;
  - the 0.2% 1Click fee;
  - a NEAR dev account for the receiving side.
- **Settlement time:** 1Click estimates about 1–3 minutes per swap (`timeEstimate` in the quote).

## Risks

- **Real money:** every run moves real USDC on mainnet. A bug in the address or amount loses funds. 1Click refunds to `refundTo` only if the swap fails inside its own flow.
- **The deposit is locked by design (H2):** a full lender path can't finish on `kredofi.near` until real bank data exists. Opening it early would bring back the H2 risk.
- **Regulatory:** taking cross-chain lender money for loans is lending. The roadmap puts it after the licensed-partner pilot.
- **Judging:** judges can't safely try it themselves (real money, no testnet). It would be shown by video only, which Q-012 accepts but which is weaker than the clickable testnet demo.
- **Scope:** a second wallet stack and a new contract (if we use a demo vault) are new audit surface in the last week.

## Recommendation

Keep the dry-run quote for the hackathon, and say plainly that Intents has no testnet. If you want one real proof, the smallest honest step is to stop after step 3:
- one real 1Click swap of about $2 from Base into the developer's mainnet account;
- shown in the video with the 1Click status and the NEAR transaction;
- no pool deposit.

That needs your yes (real funds), and about half a day.
