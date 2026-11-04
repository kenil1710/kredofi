# KredoFi Design

**Reference implementations:** `docs/landing-reference.html` (the homepage) and `docs/passbook-reference.html` (the borrower passbook with the Riya, Sam and Max flows). It is the source of truth for look and motion. Build the real homepage from it, and build every app screen in the same world. When this file and the reference disagree, the reference wins for visuals; this file wins for behaviour and words.

**The idea:** every KredoFi loan is a **credit note**, printed like money. Banks put hard-to-fake features on banknotes; KredoFi does the same for loans, and each feature maps to a real mechanism:

| Banknote feature | KredoFi meaning |
|---|---|
| The amount | Your limit ($100, then $250, $500, $1,000) |
| The letter, in colour-shifting ink | Your band, A to D, the only score on-chain |
| The serial number | Fingerprint of your bank account: one bank identity, one borrower on this contract (several banks can get around it) |
| The security thread | Your name, sealed; opened only after a default |
| The watermark | Proof the scoring ran inside Intel TDX with the pinned code |

The app is dark "night ink" (where the private work happens) alternating with light "security paper" (where things are printed, checked and kept).

---

## 1. Tokens

### Color

| Token | Hex | Use |
|---|---|---|
| `night` | `#08130F` | Main dark ground |
| `deep` / `deep-2` | `#0F2A23` / `#123229` | Dark panels, lender area |
| `paper` / `paper-2` | `#E6EAE1` / `#EEF1E9` | Light sections, note paper |
| `ink` / `ink-soft` | `#10302A` / `#4E635B` | Text on paper |
| `mint` | `#9FD9BF` | Accents on night: money in, progress, focus ring |
| `violet` / `violet-ink` | `#8E6CF0` / `#4A2C8C` | Approval stamp and primary button on paper; glow on night |
| `copper` | `#C98A4B` | Only in the colour-shifting ink gradient (green, copper, violet) |
| `red-night` / `red-ink` | `#E58A80` / `#A3241C` | Rejected, default, errors |
| `muted` | `#93AAA1` | Secondary text on night |

Rules: glow (radial violet and mint light) only behind the enclave and the final call to action. Film grain only on the hero. Violet means approved; red means rejected or default; mint means money in or progress. No other hues.

### Type

| Role | Face | Setting |
|---|---|---|
| Display, amounts, scores, stamps | **Bodoni Moda** (Google Fonts, opsz 6..96) | 500 weight, opsz 96, tracking -0.03em; numbers tabular |
| Text, labels, buttons | **Public Sans** | 300 to 700 |

No monospace font. Transaction hashes are set in Public Sans, shortened in the middle (`8u8RsN…fbW`) with a copy button. Capitals only where a real banknote or stamp would use them (on the note, on stamps). Sentence case everywhere else. No small all-caps labels above headings.

### Shape

- Buttons: 2px radius, 50px tall (64px for the final call to action). Primary on night = paper fill; on paper = ink or violet-ink fill.
- Notes and cheques: 3 to 4px radius, layered soft shadow (they are paper objects).
- Panels on night: 1px `rgba(230,234,225,.14)` border, no radius, optional blur.
- Totals use a **double underline** (accounting convention). Ledger tables end with a double rule.

---

## 2. Signature elements (build these first, as components)

1. **`<CreditNote>`**: the note drawn on canvas from data (`name`, `band`, `amount`, `words`, `repay`, `denied`). Engraved rope border, under-print lines, coloured fibres, rosette vignette with the band letter, violet thread with microtext, two serials, watermark window, microprint line. Colour-shifting ink on the letter and amount follows the pointer. `denied` draws a red NOT ISSUED stamp. Copy `drawNote()` from the reference.
2. **The enclave**: the Three.js glass cube (fresnel shader, edges, violet core, rings, data particles spiralling in). Used on the landing hero and, small and calm, on the borrower page while a score is being computed.
3. **Stamps**: double-border rectangles in Bodoni caps. `BAND A, $100` (violet), `NOT THIS TIME` (red, rejection), `PAID` (violet), `DEFAULT` (red). They press in: scale 1.5 to 1, 300ms, slight overshoot, with a 300ms screen shake on the big ones.
4. **The tally**: five rule rows with points, total with double underline. Same component on the landing, the "score yourself" section and the borrower's result.
5. **Loupe**: magnifier over the note that makes the microprint readable. Landing and receipt only.

---

## 3. Screens

All screens share the fixed top bar from the reference (hides on scroll down, turns light over paper sections) and the testnet banner on app screens.

| Screen | Ground | What it shows |
|---|---|---|
| **Landing** | night + paper | Exactly the reference: loader, 3D hero, fly-into-the-enclave, statement, how to check a note, Riya vs Sam, score yourself, lend, proof, call to action |
| **Pick a test borrower** (now `/scenarios`, footer link only; the passbook starts with Connect your bank) | night | Three borrower cheques (Riya, Sam, Max) with one-line stories, plus "Build your own borrower" (the score-yourself sliders, SPEC 8b). Then "Continue without a wallet" or "Connect wallet" |
| **Borrower passbook** | paper, enclave panel on night | Entries stack like a passbook: account, bank connected, scoring (small live enclave + honest phases, 7.3), result (the CreditNote for this borrower + tally + stamp), borrow, repay, level-up. Sam sees NOT ISSUED with reasons and what would change them. Max sees the default chain |
| **What left the enclave** | paper | Two columns: blurred "stayed inside" rows vs the exact on-chain JSON; loupe on the note; Verify panel |
| **Lender** | deep | Ledger table with double rule (pool, lent out, reserve, lost by lenders), deposit (NEAR or other chain via Intents with the animated chain diagram), withdraw |
| **Public ledger** | night | Live event feed (new rows flash in), per-band table, filters, Verify panel |

Every number on a screen comes from the contract or the scorer. Example values are labelled as examples.

---

## 4. Words

Write like a person who knows lending. Specific, plain, active. One idea per sentence.

| Use | Avoid |
|---|---|
| Borrow against your payslip. | Unlock financial freedom |
| Try it with a test borrower | Get started |
| Repay $104.00 | Pay now |
| Riya gets $100. Sam doesn't, and he's told why. | Fair, transparent scoring for everyone |
| That one line is all that leaves. | Privacy-preserving AI credit infrastructure |
| Not this time | Application denied |

Errors say what happened and what to do next, with no apology. Banned: revolutionary, seamless, unlock, empower, next-gen, cutting-edge, leverage, supercharge, game-changer. No "X, not Y" slogans beyond the one in the hero statement, no em-dash asides, no colon reveals.

---

## 5. Never (these make a page look generated)

- One italic or coloured word inside a headline.
- Small all-caps labels above headings; "A · B · C" meta strings; arrows appended to buttons.
- Rows of identical rounded cards with the same shadow (bento grids).
- Monospace for small labels.
- Emoji or stock icon packs.
- Invented statistics. Use real run numbers (Nov 3 mainnet: 8.5 s, ~0.002 NEAR, 472 bytes on-chain; `web/src/lib/proofFacts.ts`) or label examples.
- Scroll-triggered fade-up on every section.

## 6. Quality floor

- Works at 390px: the landing keeps the story but drops pinning where it would trap the scroll; app screens are one column.
- `prefers-reduced-motion`: no loader, no smooth scroll, no pinning; every section shows its final state.
- Keyboard focus visible (2px mint on night, 2px violet-ink on paper). Touch targets 44px or more.
- Contrast AA on both grounds.
- Before calling a screen done: screenshot at 1440 and 390, compare with the reference, remove one thing.

---

## 7. UX, flow and motion

The look is sections 1-6. This section is how it behaves. A judge should understand KredoFi and finish a loan in under 3 minutes, without reading the README.

### 7.1 The judge's path (first 3 minutes)

Most judges have no NEAR testnet wallet and no bank in Plaid's sandbox. Remove both walls.

1. **Landing:** the reference page. Every "Check my limit" button leads to the passbook, whose start is **Connect your bank (sandbox)** (real Plaid Link). Prepared borrowers live on `/scenarios`, linked only from the footer (decided Nov 2).
2. **Pick a test borrower:** three rows, Riya (steady salary), Sam (irregular income), Max (looks good, will default). One click picks a Plaid sandbox profile. No bank login needed.
3. **No-wallet demo account:** "Continue without a wallet" creates a throwaway testnet account whose key lives only in the browser. A relayer pays every gas fee through **meta transactions** and only relays calls to the KredoFi and mock USDC contracts (SPEC 8a explains why a function-call key alone cannot repay). "Connect wallet" stays available for anyone who has one.
4. Score, then borrow, then repay or default, all on one passbook page (section 3).
5. Every result has a **Verify** link (7.6).

A small, fixed banner on testnet: "Testnet demo. Test banks and test money only." Never hidden.

### 7.2 Flows, step by step

**Borrower**

| Step | User does | Screen shows | Done when |
|---|---|---|---|
| 1 Account | Picks wallet or demo account | Account name in the header | Signed in |
| 2 Bank | Plaid Link (or test borrower pick) | "Bank connected" entry | Public token received |
| 3 Score | "Check my limit" | Enclave box with live progress (7.3) | `score_issued` or `score_failed` event |
| 4 Result | Reads their credit note, or NOT ISSUED | Band, limit, plain reasons, Verify | Always |
| 5 Borrow | Enters amount (pre-filled with the limit) | Interest, total to repay, due date, consequence of not repaying | `loan_issued` event and USDC received |
| 6 Repay | "Repay $104.00" | Countdown to due date | `loan_repaid` event; PAID stamp; new limit shown |
| 6b Default | Nothing (or anyone presses "Mark as defaulted" after grace) | DEFAULT stamp, reserve covered the loss, identity released to partner | `loan_defaulted` event |

**Lender:** Deposit (direct USDC on NEAR, or "From another chain" via NEAR Intents as a 3-step stepper: get deposit address, send, arrives in your account, then deposit) and Withdraw. Always show: pool value, your share, cash available to withdraw now.

**Public ledger:** live table of events (7.5), filters by band and event, per-band totals, Verify panel.

One primary action per screen. The primary button always says exactly what happens next.

### 7.3 Waiting honestly (the most important UX in the product)

Scoring takes about 5 to 20 seconds (OutLayer run plus NEAR blocks). Never a bare spinner, never a fake percentage. Show real phases, each confirmed by something real:

| Phase | Shown as | Confirmed by |
|---|---|---|
| 1 | "Waiting for your signature" | Wallet / relayer |
| 2 | "Request sent" + tx link | Transaction hash returned |
| 3 | "Enclave reading your transactions" + elapsed seconds | Transaction included; waiting for callback |
| 4 | "Sealed" | `score_issued` event (or `score_failed`) |

- An elapsed timer ("12 s") after phase 3 starts; at 30 s, add "Taking longer than usual. You can leave this page; the result will be here when you come back."
- The result is read from the chain, so a refresh never loses it.
- `aria-live="polite"` announces each phase.

Same pattern for every transaction: **Signing, Sent (tx link), Confirmed.** Buttons become disabled with the phase as their label ("Sending…") so nothing is submitted twice.

### 7.4 Motion system

Landing: the full reference motion (loader, Lenis smooth scroll, GSAP, pinned chapters, Three.js enclave). App screens: motion only when it answers the user or shows real progress (the enclave while scoring, the stamp on a result, a new passbook entry, a new ledger row). Libraries: three@0.160.0, gsap 3.12.5 + ScrollTrigger, lenis 1.1.13.


Motion shows what changed because of the user. Nothing moves on its own except the waiting indicator.

| Token | Value | Use |
|---|---|---|
| `t-fast` | 120ms | Button press, focus, toggles |
| `t-base` | 200ms | Panels opening, row insert |
| `t-slow` | 400ms | Ink settling after a stamp |
| `ease-out` | `cubic-bezier(.2,.8,.2,1)` | Everything by default |
| `ease-press` | `cubic-bezier(.2,.9,.3,1.2)` | Stamps only (slight overshoot) |

The full list of animations (nothing else animates):

1. **Stamp press** (signature): scale 1.5 to 1, opacity 0 to 1, 300ms with slight overshoot, plus a 300ms screen shake on the result stamp. The credit note for the result draws its border in like ink (stroke draw, 1.5s) the first time it appears.
2. **Stamp variants**: Rejected and Default press the same way; Default adds one 6px horizontal shake (120ms).
3. **Enclave rows**: blurred bars slide into the box (200ms, staggered 40ms), then pulse slowly while waiting.
4. **New passbook entry / ledger row**: height expands 200ms and the row background flashes mint at 16% then fades over 0.6s, like fresh ink.
5. **Repay**: PAID stamp presses on the loan row; the new limit replaces the old one with a vertical roll (old figure slides up, new slides in, 200ms).
6. **Buttons**: press scale 0.98 at 80ms; hover darkens 6%. No hover animations on cards or rows.
7. **Page changes**: View Transitions API crossfade, 160ms. No slide-in sections on scroll, ever.

`prefers-reduced-motion`: all of the above become instant state changes; the waiting pulse becomes static text.

### 7.5 Smoothness (performance)

- Animate only `transform` and `opacity`. Never width, height or top in a loop (row expand uses `grid-template-rows: 0fr → 1fr`).
- The credit note canvas is redrawn only when its data or the pointer changes; the Three.js scene renders only while it is on screen.
- SVG ink filters are expensive: apply them to static stamps; during the press animate the wrapper, not the filter.
- Target: 60 fps on a mid-range phone, LCP under 2 s, no layout shift (reserve space for the note and the result before they arrive), JavaScript under 200 KB, fonts subset to Latin.
- Ledger updates by polling the contract every 5 s (or the indexer); new rows insert without moving the user's scroll position.

### 7.6 Trust UX (what wins the privacy argument)

- **"What left the enclave" receipt** on every result: two columns. Left, "Stayed inside": 30 transactions, balances, your name, the access token (shown as blurred rows, never real data). Right, "Left the enclave": the exact on-chain output (`band`, `score`, `income_cap`, `fingerprint` hash, `sealed_identity` as ciphertext). This makes the privacy claim checkable at a glance.
- **Verify drawer**: contract account, pinned scorer version (SHA-256), the OutLayer request and result transactions, a link to the scorer source at that exact commit, and the command to check the hash yourself.
- **Plain reasons**: every band shows the rule results that produced it ("Income in 6 of 6 months"), and for Band D what would change it. Reasons come from the rules, not from AI.
- **Consequences before commitment**: the borrow step states what happens on default before the button.

### 7.7 States every screen needs

| State | Rule |
|---|---|
| Empty | One sentence and the next action ("No loans yet. Check your limit to start.") |
| Loading (first load) | Reserve the exact layout space; text placeholders in `paper-2` (paper) or `deep-2` (night), no shimmer |
| Waiting on chain | 7.3 phases |
| Error | What happened, and the fix ("Plaid returned no transactions. Connect again or pick a test borrower.") with a retry button. Never "Something went wrong" |
| Wallet rejected | "You cancelled the signature. Nothing was sent." + retry |
| Insufficient funds | Exact amount missing and where to get test USDC |
| Score expired | "Your score expired on Nov 24. Check your limit again." |
| Pool empty | "The pool has no cash to lend right now." + link to Lend |

### 7.8 Input and feedback details

- Amount fields: USDC with 2 decimals, tabular figures, a "Use my limit" link, validation as you type ("Above your limit of $100.00").
- Copy buttons on hashes and accounts: icon changes to a check and the text says "Copied" for 1.5 s.
- Every hash shortened in the middle (`8u8RsN…fbW`), full value on hover and in the copy.
- Times: relative for recent ("2 min ago"), absolute on hover; due dates always absolute with year.
- Touch targets at least 44px. On phones, the borrower's current primary action sits in a sticky bottom bar.

### 7.9 Build order for the UI (fits the 14-day plan)

1. Tokens (CSS variables) and fonts.
2. CreditNote, enclave (Three.js), stamps, tally and loupe, each on its own test page, copied from `docs/landing-reference.html` and polished first.
3. Transaction-state hook (Signing, Sent, Confirmed, Failed) used by every button.
4. Borrower passbook page with all states from 7.7.
5. Ledger, then Lender.
6. Landing last, built from the finished components.
7. Screenshot review against this file at 1440 px and 375 px; fix, then remove one thing.
