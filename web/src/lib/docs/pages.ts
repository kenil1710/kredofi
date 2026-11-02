// Public documentation at /docs. Plain text in a small Markdown subset (rendered by
// components/DocsBody.tsx) so the sidebar search can index it. Every number here is checked against
// the contract (contracts/kredofi), the scorer (scorer/src/rules.rs) and the live configs; see
// docs.test.ts for the link check. No internal notes, no developer account details, no secrets.

export type DocPage = { slug: string; title: string; summary: string; body: string };

const MAINNET_SCORER = '7048cc92a708564df3acdececd9a9880c3054f6d9ff0b4cebedd51ac268dc978';
const TESTNET_SCORER = 'ac8e2a9c732db84ccaee2854ed4f0b8394443b47e51dc7fcf8499005051ec0e9';
const TX_SCORE = 'https://nearblocks.io/txns/CNsoyGSj6aXtUmGzxUisxERirsv9jAsAZQ7GKVj7Udb7';
const TX_SCORE_NOV1 = 'https://nearblocks.io/txns/4dgHrA97KfibKifZuVZ2YF5zoAVCy4m2pXxxf9zdijyu';
const TX_PIN = 'https://nearblocks.io/txns/AtYo7XWz4Y4h655hm7N8YPSmMX4kxo8exzCM47GjJRZn';
const TX_DEPLOY = 'https://nearblocks.io/txns/Ags89jDRYZHi4h3ZXxk4kJGenNvrrGxAiAxGHmfKvwhp';
const TX_MIGRATE = 'https://nearblocks.io/txns/5fqzZSKCED3sv5eg9brTHJTLxCkiDjN9uaVof2bAKK34';
const WASM_URL = 'https://raw.githubusercontent.com/kenil1710/kredofi-scorer-wasm/f174d555cc79f009d4275b32ad9f4e533c823531/kredofi_scorer.wasm';

export const DOC_PAGES: DocPage[] = [
  {
    slug: 'overview',
    title: 'Overview',
    summary: 'What KredoFi is, who it is for, and what is live today.',
    body: `
KredoFi lends USDC on NEAR against your income instead of collateral. A program anyone can check reads your bank history inside a sealed computer (a TEE), applies five published rules, and puts only a band and a limit on the chain. Lenders never see your statements, and neither do we.

## What is live

- **Testnet demo**, open to anyone with no wallet: [Check my limit](/borrow). It uses Plaid's public sandbox bank and test USDC.
- **Mainnet contract** \`kredofi.near\`, configured to score inside Intel TDX through OutLayer. A real score was computed there with the current scorer ([transaction](${TX_SCORE})). No mainnet loans have been made yet, and the mainnet pool is empty.

The differences are spelled out in [Testnet vs mainnet](/docs/testnet-vs-mainnet).

## In one minute

1. You connect a bank through Plaid. KredoFi never sees your bank login.
2. The scorer reads the last 6 full months of your main account and scores five things: income level, steady income, on-time payments, money left over and a savings buffer. See [Scoring model](/docs/scoring-model).
3. Only a band (A to D), a score, an income cap, a keyed fingerprint and your name sealed for a recovery partner leave the scorer. See [Privacy & the enclave](/docs/privacy).
4. You borrow up to your limit and repay one fixed amount. Repay on time and your limit grows. See [For borrowers](/docs/borrowers).
5. Lenders fund the pool and earn half the interest. A reserve pays losses first. See [For lenders](/docs/lenders).

## Where to go next

- The two-minute version: [Why is this safe?](/trust)
- Judges and the curious: [Verify it yourself](/docs/verify).
- What we protect and what we don't: [Security](/docs/security).
- Addresses, methods and events: [Contracts & API](/docs/contracts-api).
`,
  },
  {
    slug: 'how-it-works',
    title: 'How it works',
    summary: 'The path from a bank login to a loan, step by step.',
    body: `
:::diagram

## 1. Connect a bank

The browser opens Plaid Link. You log in to your bank inside Plaid's window; KredoFi gets a one-time public token, never your password.

## 2. Ask for a score

On mainnet, your account calls \`request_score\` on the KredoFi contract with that token and a fresh public key generated in your browser, and attaches at least 0.01 NEAR for the OutLayer fee (the unused part is refunded to you). The contract asks OutLayer to run one exact scorer program, pinned by its SHA-256.

## 3. The scorer runs inside the enclave

Inside Intel TDX, the scorer:

1. exchanges the token with Plaid and fetches up to two years of transactions;
2. picks your checking account (or the first deposit account) and keeps the last 6 full calendar months;
3. applies the [five rules](/docs/scoring-model) and works out a band, a score and an income cap;
4. computes a keyed fingerprint of your bank identity, so one bank identity can back only one borrower;
5. seals your name to a key only the scorer holds, and seals the rule results to your browser's key;
6. removes the bank connection at Plaid.

Nothing else leaves: no transactions, balances or names.

## 4. The contract checks and stores

The answer can only arrive in the contract's own callback (\`on_score\`), for its own pending request. The contract checks the output's shape and fields, that it is for you, and that the fingerprint isn't already used by someone else, then stores the score for 30 days. A failed or empty answer changes nothing.

## 5. Borrow, repay, grow

\`borrow\` sends USDC from the pool to you. Repaying is one transfer of the exact amount due. Repay after the minimum hold, on a loan of at least half your limit, and your level goes up. See [For borrowers](/docs/borrowers).

## 6. If a loan isn't repaid

After the due date plus the grace period, anyone can mark the loan as defaulted. The reserve pays the pool back first, the borrower can never borrow again, and the sealed name is re-sealed by the scorer to the recovery partner's key. See [Security](/docs/security).

## On the testnet demo

The same steps run, but the scorer runs on our server (Dev mode) and the server submits its output; a relayer pays all fees for no-wallet demo accounts. See [Testnet vs mainnet](/docs/testnet-vs-mainnet).
`,
  },
  {
    slug: 'borrowers',
    title: 'For borrowers',
    summary: 'Limits, terms, repaying, levels, and what happens if you don’t repay.',
    body: `
## Your limit

Your limit is the smaller of two numbers:

- your **level cap** times your **band share**: level caps are $100, $250, $500 and $1,000 (levels 1 to 4); band shares are A 100%, B 75%, C 50%, D 0%;
- your **income cap**: half your average monthly income, rounded down to a multiple of $50, at most $1,000.

Example: band B at level 1 with a $250 income cap can borrow min($100 x 75%, $250) = $75.

The pool also lends one borrower at most **10% of the pool's value**, and only what it has in cash. The borrow form shows the most you can take right now.

## Terms

| | Mainnet | Testnet demo |
|---|---|---|
| Loan term | 30 days | 2 minutes |
| Grace after the due date | 7 days | 1 minute |
| Minimum hold for a level-up | 15 days | 1 minute |
| Score valid for | 30 days | 30 days |

Interest is a flat amount per loan (rounded up to the smallest USDC unit): **A 4%, B 6%, C 8%**. Band D can't borrow. You can have one loan at a time.

## Repaying

You repay the whole amount due in one transfer: principal plus interest. A $100 band A loan repays $104.

## Growing your limit

When you repay, your level goes up by one if all of these hold. The values come from the contract's own settings (\`min_hold_ns\`, \`loan_term_ns\`):

| Level-up rule | Mainnet | Testnet demo |
|---|---|---|
| Hold the loan at least | 15 days (half the term) | 1 minute |
| Borrow at least | half your limit at the time | half your limit at the time |
| Your limit can rise at most once per | 30 days (one term) | 2 minutes (one term) |
| Highest level | 4 | 4 |

What the app says, built from those settings:

- Mainnet: "Hold at least 15 days and borrow at least half your limit to level up. Limits can rise at most once per term (30 days)."
- Testnet: "Hold your next loan at least 1 minute to level up."

While a loan is open, the passbook shows a countdown box ("Level up in 0:42"), then "Repay now to level up to $187.50". After a repayment, "Borrow again" takes you to the next loan. If a repayment doesn't level you up, the passbook says which condition wasn't met.

## Your score

A score is valid for 30 days. After that, check your limit again. While a score request is pending you can't borrow.

## If you don't repay

After the due date plus the grace period, **anyone** can mark the loan as defaulted; the contract checks the dates itself. Then:

- the reserve pays the pool back first, up to the loan's principal;
- your account is blocked from borrowing for good, and your bank fingerprint stays taken, so the same bank identity can't start over with a new account;
- anyone can ask for your sealed name to be released to the recovery partner (once). Only the partner's key can open it.

## What lenders see

Your band, score, loan amounts and dates, linked to your NEAR account. Never your income, transactions or name.
`,
  },
  {
    slug: 'lenders',
    title: 'For lenders',
    summary: 'Deposits, shares, withdrawals, earnings and losses.',
    body: `
## Depositing

Send USDC to the pool with \`ft_transfer_call\` and the message \`deposit\`. You get pool shares at the current share price, rounded down. On the testnet demo, [Lend](/lend) gives a new demo account 500 test USDC once.

From another chain: NEAR Intents (1Click) turns USDC on Base, Ethereum, Arbitrum or Solana into USDC in your own NEAR account, and then you deposit it, so the pool knows the deposit is yours. The demo shows real 1Click quotes as dry runs only; no money moves.

## Earnings

Borrowers pay a flat interest per loan; **lenders get half** through the share price: 2% for band A, 3% for B, 4% for C. The other half goes to the KredoFi treasury. See [Fees & treasury](/docs/fees-treasury).

The share price only moves with repaid interest (up) and uncovered losses (down). Nothing on the page is a forecast.

## Withdrawing

\`withdraw(shares)\` burns shares and pays their current value, limited by the pool's cash: money that is lent out comes back as loans are repaid. It needs 1 yoctoNEAR attached (a full-access key confirmation).

## Losses

When a loan defaults, the **reserve pays first**, up to the loan's principal. Only what the reserve can't cover is lost by lenders, through the share price. Every default shows on the [public ledger](/ledger) with how much the reserve covered and how much lenders lost.

## Limits that protect the pool

- One borrower can take at most 10% of the pool's value.
- One bank identity can back only one borrower.
- Limits start at $100 and grow only after on-time repayment of meaningful loans.
- The owner can't withdraw lender cash, outstanding loans or the reserve (see [Fees & treasury](/docs/fees-treasury) and [Security](/docs/security) for the caveat about code upgrades).
`,
  },
  {
    slug: 'scoring-model',
    title: 'Scoring model',
    summary: 'The five rules, bands, the income cap and the anti-farming rules, exactly as coded.',
    body: `
The rules are open source and deterministic: the same history always gives the same score. The score never depends on AI. Code: \`scorer/src/rules.rs\`.

## What is read

- The **last 6 full calendar months** before the current month (in November: May to October).
- Your **checking account** (or the first deposit account if there is none).
- **Money in** each month (all incoming transactions), **money out** (all outgoing), **fees** (transactions named overdraft, NSF or returned) and the **current balance**.

## The five rules (1,000 points)

| Rule | Points | How |
|---|---|---|
| Income level | 40 to 250 | average monthly money in: $3,000 or more 250; $2,000 or more 180; $1,000 or more 100; less 40 |
| Steady income | 0 to 250 | 150 x (months with income out of 6), rounded down, plus 100 if the monthly amounts vary by 15% or less (coefficient of variation), 50 if 40% or less |
| On-time payments | 0 to 250 | 250 minus 60 per overdraft, NSF or returned-payment fee, never below 0 |
| Money left over | 0 to 150 | (money in minus money out) / money in: 30% or more 150; 10% or more 100; 0% or more 50; negative 0 |
| Savings buffer | 0 to 100 | balance / average monthly spending: 3 months or more 100; 1 or more 60; 0.3 or more 30; less 0 |

## Bands

| Band | Score | Can borrow | Interest per loan |
|---|---|---|---|
| A | 800 to 1,000 | 100% of the level cap | 4% |
| B | 650 to 799 | 75% | 6% |
| C | 500 to 649 | 50% | 8% |
| D | below 500 | no loan | n/a |

## Income cap

Half your average monthly money in, rounded down to a multiple of $50, at most $1,000. Your limit is never above it.

## Worked examples (from the tests)

| Borrower | Rules | Score | Band | First limit |
|---|---|---|---|---|
| Riya: $4,000 every month, no fees, saves | 250 / 250 / 250 / 150 / 100 | 1,000 | A | $100 |
| Sam: income in 4 of 6 months, 4 fees, spends more than he earns | 100 / 100 / 10 / 0 / 60 | 270 | D | none |
| Max: looks like Riya, never repays | 250 / 250 / 250 / 150 / 100 | 1,000 | A | $100 |

## Anti-farming rules

- **One bank identity, one borrower.** A keyed fingerprint of the bank identity is stored with the score; a second account with the same fingerprint is refused.
- **Levels grow slowly.** A repayment raises the level only after the minimum hold (half the term), on a loan of at least half the limit, at most once per loan term.
- **Limits start small** ($100 at most) and the pool lends one borrower at most 10% of its value.
- **Scores expire** after 30 days.
- **A default blocks the account for good**, and its fingerprint stays taken.

## Testnet differences

The testnet scorer also accepts prepared sandbox borrowers, and it ties the shared sandbox login to your NEAR account before fingerprinting so every visitor can use the same test login. The mainnet scorer does neither. See [Testnet vs mainnet](/docs/testnet-vs-mainnet).
`,
  },
  {
    slug: 'privacy',
    title: 'Privacy & the enclave',
    summary: 'What the TEE does, what leaves it, and who can open what.',
    body: `
## The enclave

On mainnet the scorer runs on OutLayer inside **Intel TDX**, a trusted execution environment: memory is encrypted and the operator can't read it. The contract asks OutLayer for one exact program, identified by its SHA-256 (the pinned version). OutLayer releases the scorer's secrets (the Plaid keys and the sealing key) only to that program **and** only for requests that come from the KredoFi contract.

## What leaves the scorer

Exactly one short line (under 900 bytes), checked field by field by the contract:

| Field | What it is |
|---|---|
| \`band\`, \`score\` | A to D, 0 to 1,000 |
| \`income_cap\` | the cap on your limit, in USDC |
| \`fingerprint\` | a keyed hash of your bank identity (institution, owner name, account mask). Without the scorer's key it can't be reversed or linked to a bank |
| \`sealed_identity\` | your name, encrypted to a key only the scorer holds |
| \`caller\` | your NEAR account (from the request, never from input) |
| \`reply\` (optional) | the five rule results, encrypted to a key your browser made for this request |

No transactions, balances, account numbers or names. The bank connection is removed at Plaid after the fetch.

## Who can open what

| Data | Who can read it |
|---|---|
| Band, score, income cap, loans | everyone (public chain) |
| Rule results (\`reply\`) | only the browser that asked for the score |
| Your name (\`sealed_identity\`) | nobody, until a default; then the scorer re-seals it to the recovery partner's key, and only the partner can open it. No contract view ever returns it. |

## What we can't promise

- Plaid sees what any Plaid connection sees.
- The enclave relies on Intel TDX and OutLayer's operations.
- On the **testnet demo** the scorer runs on our server, not in an enclave, so that server sees the data while it scores (it keeps only the public output).

Details: [Security](/docs/security).

## The AI summary (testnet only)

On the testnet demo, a short plain-English summary is generated by NEAR AI Cloud (\`Qwen/Qwen3.8-27B\`) from the band and rule points only, never from transactions, and sealed to your browser. It is generated on our server, it never changes the score, and the page hides it if it contains numbers (models sometimes get them wrong). The mainnet scorer has no AI.
`,
  },
  {
    slug: 'verify',
    title: 'Verify it yourself',
    summary: 'Check the pinned scorer, the published WASM and a real on-chain score.',
    body: `
Everything below uses public data only. No account or key needed.

## 1. Which scorer does mainnet trust?

\`\`\`
curl -s https://rpc.mainnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kredofi.near","method_name":"get_config","args_base64":""}}' | python3 -c "import json,sys;c=json.loads(bytes(json.load(sys.stdin)['result']['result']));print(c['scorer_mode'],c['scorer_version'])"
\`\`\`

Expected: \`OutLayer ${MAINNET_SCORER}\`

## 2. Is the published WASM that file?

\`\`\`
curl -sL ${WASM_URL} | shasum -a 256
\`\`\`

Expected: \`${MAINNET_SCORER}\`. OutLayer downloads the scorer from this commit-pinned address and checks the same hash.

## 3. Did a real score come from the enclave?

Open [the scoring transaction](${TX_SCORE}) (mainnet, 2 November 2026, with the current scorer; the first, on 1 November with the earlier build, is [here](${TX_SCORE_NOV1})). Its receipts show \`request_score\`, the request to \`outlayer.near\` with the pinned version, the private callback \`on_score\`, the event \`score_issued\` (band A, 1,000) and the unused fee refunded to the borrower.

## 4. Can anyone else write a score?

No. On mainnet the contract is in OutLayer mode, so \`dev_submit_score\` is refused, and \`on_score\` is a private callback only the contract's own request can reach. Fake scores, wrong callers, wrong versions and reused fingerprints are all tested.

## 5. Does the WASM come from this source?

The source is in the repository (\`scorer/\`). The pinned build is made on x86_64 Linux in a pinned Rust image: \`./scorer/build-docker.sh\` gives \`${MAINNET_SCORER}\` on any x86_64 machine with Docker, and the repository's GitHub workflow prints the same hash (two separate runs matched). Builds on macOS or ARM Linux give other hashes for the same source, which is why one platform is canonical.

## 6. The testnet demo

\`\`\`
curl -s https://kenil1710-kredofi.hf.space/api/ledger | python3 -c "import json,sys;print(json.load(sys.stdin)['config']['scorer_version'])"
\`\`\`

Expected: \`${TESTNET_SCORER}\`. The server refuses to score if its WASM's hash differs from the pinned one. Every event on the [public ledger](/ledger) links to its transaction on testnet.nearblocks.io.

## 7. Contract deployments

- Deployed in OutLayer mode: [transaction](${TX_DEPLOY}).
- Upgraded with a state migration (fee change): [transaction](${TX_MIGRATE}).
`,
  },
  {
    slug: 'fees-treasury',
    title: 'Fees & treasury',
    summary: 'Where every cent of interest goes, and what the owner can and can’t move.',
    body: `
## Interest

A flat amount per loan, set by the band: **A 4%, B 6%, C 8%** of the principal. Half goes to lenders and half to the KredoFi treasury. Rounding always favours lenders: the lenders' half is rounded up.

## Example: $100, band A

| | Amount |
|---|---|
| You borrow | $100.00 |
| You repay | **$104.00** |
| To lenders (share price) | $2.00 |
| To the KredoFi treasury | $2.00 |
| To the reserve | $0.00 |

Band B on $75: you repay $79.50, of which $2.25 goes to lenders and $2.25 to the treasury.

## The reserve

The reserve pays losses first when a loan defaults, up to the loan's principal. It gets no share of interest. It grows only when the owner seeds it with USDC (\`seed_reserve\`) or moves treasury money into it. Moving treasury into the reserve is one-way.

## Other costs

- Asking for a score on mainnet: attach at least 0.01 NEAR for OutLayer's fee; the unused part is refunded to you.
- NEAR network fees for your own transactions. On the testnet demo, a relayer pays all of them.

## What the owner can do

- withdraw from the **treasury** only (never more than its balance; restored if the transfer fails);
- move treasury money into the reserve;
- seed the reserve;
- pin a new scorer version (a public event);
- change loan term, grace, minimum hold, score validity and the per-borrower share, within fixed bounds (each a public event): terms 60 seconds to 365 days, grace up to 90 days, minimum hold at most the term, per-borrower share 0.01% to 10%.

## What the owner can't do

No owner method can move **lender cash, outstanding loans or the reserve**. This is tested.

One caveat, said plainly: the contract accounts still have their full-access keys, so the owner could deploy different code. See [Security](/docs/security).
`,
  },
  {
    slug: 'contracts-api',
    title: 'Contracts & API',
    summary: 'Addresses, methods, views and events.',
    body: `
## Addresses

| | Mainnet | Testnet |
|---|---|---|
| KredoFi contract | \`kredofi.near\` | \`kredofi.kency.testnet\` |
| USDC | \`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1\` (native USDC) | \`musdc.kency.testnet\` (test USDC) |
| Scoring | OutLayer (\`outlayer.near\`), Intel TDX | Dev mode (our server) |
| Pinned scorer | \`${MAINNET_SCORER}\` | \`${TESTNET_SCORER}\` |

Amounts are USDC with 6 decimals ($100 = \`100000000\`), passed as strings. Times are nanoseconds.

## Borrower methods

| Method | What it does |
|---|---|
| \`request_score(public_token, reply_pubkey)\` | mainnet: ask for a score; attach at least 0.01 NEAR; must be signed by the borrower |
| \`borrow(amount)\` | take a loan up to your limit; 1 yoctoNEAR |
| USDC \`ft_transfer_call\` with \`msg: "repay"\` | repay the exact amount due |

## Lender methods

| Method | What it does |
|---|---|
| USDC \`ft_transfer_call\` with \`msg: "deposit"\` | deposit and receive shares |
| \`withdraw(shares)\` | burn shares for USDC; 1 yoctoNEAR |

## Anyone

| Method | What it does |
|---|---|
| \`mark_default(borrower)\` | after the due date plus grace |
| \`request_identity_release(borrower)\` | after a default, once; attach at least 0.01 NEAR |

## Owner

\`set_scorer_version\`, \`set_loan_term_ns\`, \`set_grace_ns\`, \`set_min_hold_ns\`, \`set_score_ttl_ns\`, \`set_max_borrower_share_bps\`, \`withdraw_treasury\`, \`treasury_to_reserve\`, and \`ft_transfer_call\` with \`msg: "seed_reserve"\`. Each needs 1 yoctoNEAR and emits an event.

## Views

\`get_config\`, \`get_pool\`, \`get_lender(account_id)\`, \`get_borrower(account_id)\` (never returns the sealed name), \`get_limit(account_id)\`, \`get_stats\`, \`is_release_allowed(account_id)\`.

## Events

NEP-297 logs with standard \`kredofi\`, version \`1.0.0\`:

\`score_issued\`, \`score_failed\`, \`loan_issued\`, \`loan_repaid\`, \`loan_defaulted\`, \`identity_released\`, \`lender_deposit\`, \`lender_withdraw\`, \`reserve_seeded\`, \`treasury_withdrawn\`, \`treasury_to_reserve\`, \`scorer_version_changed\`, \`param_changed\`.

The [public ledger](/ledger) is built from these events and trusts only logs from receipts executed by the KredoFi contract itself.

## Web API (testnet demo)

Scoring on the demo needs proof that you control the account: \`POST /api/score/challenge\` returns a one-time nonce (5 minutes), the account signs a NEP-413 message naming the account and the browser's reply key, and \`/api/score\` checks the signature and that the key is a full-access key of the account.

The demo's server routes (\`/api/score\`, \`/api/relay\`, \`/api/demo\`, \`/api/faucet\`, \`/api/ledger\`, \`/api/intents/quote\`) exist to run the testnet demo; they are rate-limited and not a stable public API.
`,
  },
  {
    slug: 'security',
    title: 'Security',
    summary: 'What we protect, what we don’t, and the known limits, in plain language.',
    body: `
## What we protect

- **Your bank data** is read only by the pinned scorer, inside the enclave on mainnet. Only a band, a score, an income cap, a fingerprint and a sealed name come out.
- **Your name** stays sealed unless you default.
- **Scores can't be faked.** The contract accepts a score only from its own pinned OutLayer request.
- **Only you can ask for your score.** On mainnet the contract requires your account's signature. On the testnet demo, every score request carries a one-time challenge signed with a full-access key of your account (a NEAR NEP-413 signed message), so nobody can re-score someone else's account.
- **Lender money.** Checked math, state written before every transfer with rollback on failure, a 10% per-borrower limit, the reserve pays first, and no owner method can move lender cash, loans or the reserve.

## What we don't protect, or only partly

- **The owner can still change the code.** The contract accounts still have their full-access keys, so the owner could deploy different code, and different code could move funds. Before real money this needs locked keys, a DAO or time-locked upgrades. The mainnet pool holds no funds today.
- **The sealing key was made outside the enclave.** The mainnet sealing key was generated by the developer and handed to OutLayer as a secret, so the developer could open sealed names. The recovery partner is simulated and its key is also held by the developer. Production would generate the key inside the enclave.
- **The testnet demo isn't private from us.** Its scorer runs on our server, so that server sees the data while scoring. It uses its own sealing key, sandbox banks and test money.
- **Trust in the enclave.** We rely on Intel TDX and on OutLayer's worker registration and secrets service.
- **The chain is public.** Your band, score, loans and repayments are linked to your NEAR account.
- **Fingerprints rely on identity data.** Someone with accounts at several banks could become several borrowers.
- **A missed deadline releases your name.** After the due date plus grace, anyone can mark the default; that is the deterrent by design.
- **Partial bank history.** Plaid's sandbox sometimes reports the history as complete before it has arrived. The scorer waits for it (and the testnet scorer also checks every month is present); a partial history can lower a score, never raise it.
- **Rebuilding the scorer needs x86_64 Linux.** The pinned file rebuilds byte for byte in the pinned Docker image on x86_64 (or in the repository's GitHub workflow); macOS and ARM builds give other bytes. See [Verify it yourself](/docs/verify).
- **Demo accounts live in your browser.** Their key is in local storage; anything that can run script on the page could take it. They hold only test funds.

## Known limits

- Bank data is Plaid sandbox only; real banks need Plaid production access and a licensed lending partner.
- No mainnet loan has been made yet.
- Regulation (lending licences, KYC, collections) is out of scope for this demo.

The full write-up is \`THREAT_MODEL.md\` in the repository.
`,
  },
  {
    slug: 'testnet-vs-mainnet',
    title: 'Testnet vs mainnet',
    summary: 'What runs where, and the transactions that prove the mainnet path.',
    body: `
| | Testnet demo | Mainnet |
|---|---|---|
| Contract | \`kredofi.kency.testnet\` | \`kredofi.near\` |
| Scoring | **Dev mode**: the pinned scorer runs on our server; the server submits its output | **OutLayer**, Intel TDX; the contract accepts a score only in its own callback |
| Pinned scorer | testnet build \`${TESTNET_SCORER.slice(0, 8)}…\` | production build \`${MAINNET_SCORER.slice(0, 8)}…\` |
| Bank data | Plaid sandbox | Plaid sandbox (no production access yet) |
| Money | test USDC and test NEAR | native USDC configured; pool empty, no loans yet |
| Accounts | no-wallet demo accounts, a relayer pays every fee, or any testnet wallet | your own wallet |
| Loan term / grace / minimum hold | 2 min / 1 min / 1 min | 30 days / 7 days / 15 days |
| AI summary | yes, generated on our server | no |
| Extras in the scorer | prepared borrowers (Riya, Sam, Max, build your own); the shared sandbox login is tied to your account; a fetch receipt | none |

## Proof of the mainnet path

- Contract deployed in OutLayer mode: [transaction](${TX_DEPLOY}).
- A real score computed inside OutLayer and stored by the contract's callback (band A, 1,000), with the unused fee refunded to the borrower: [transaction](${TX_SCORE_NOV1}) (1 November, earlier build).
- Re-pinned to the reproducible build \`${MAINNET_SCORER.slice(0, 8)}…\` ([transaction](${TX_PIN})) and scored again inside OutLayer with it (band A, 1,000, 7.6 seconds): [transaction](${TX_SCORE}) (2 November).
- Contract upgraded with a state migration: [transaction](${TX_MIGRATE}).

How to check these yourself: [Verify it yourself](/docs/verify).
`,
  },
  {
    slug: 'faq',
    title: 'FAQ',
    summary: 'Short answers to common questions.',
    body: `
## Do I need a wallet?

Not for the testnet demo: it creates a throwaway account and pays every fee. You can also connect a testnet wallet.

## Is this real money?

Not in the demo: test USDC on NEAR testnet and Plaid's sandbox bank. The mainnet contract exists but has made no loans.

## Can someone else check my limit or re-score my account?

No. Every score request is signed with your account's own key: on mainnet by your transaction, on the testnet demo by a one-time signed challenge.

## Can KredoFi see my transactions?

On mainnet, no: they are read inside the enclave and never leave it. On the testnet demo the scorer runs on our server, which sees them while scoring and keeps only the public output.

## Why is my band lower than I expected?

Open your passbook: the five rule results show which rules cost points, and refused scores list what would change them. The rules are on [Scoring model](/docs/scoring-model).

## Why can't I borrow my full limit?

The pool lends one borrower at most 10% of its value, and only what it has in cash. The borrow form shows the most you can take now.

## Why didn't my limit go up?

A repayment raises your level only after the minimum hold, on a loan of at least half your limit, at most once per loan term. The Repaid entry says which condition wasn't met.

## Can I use the same bank with two accounts?

No. One bank identity backs one borrower. (On testnet, the shared sandbox login is tied to each NEAR account so every visitor can try it.)

## What happens if I don't repay?

After the due date plus grace, anyone can mark the default. The reserve pays lenders first, you can't borrow again, and your sealed name can be released to the recovery partner.

## Who is the recovery partner?

In this demo, a simulated partner whose key is held by the developer. A real deployment would use a licensed collection or credit partner.

## Can the owner take the money?

No owner method can move lender cash, loans or the reserve. But the contract keys still allow a code upgrade; see [Security](/docs/security).

## How do I check any of this?

[Verify it yourself](/docs/verify).
`,
  },
  {
    slug: 'roadmap',
    title: 'Roadmap',
    summary: 'What comes after the hackathon, in order.',
    body: `
Nothing on this page is built yet; it is the plan, roughly in order.

1. **Lock the contract keys** behind a time-locked upgrade path or a DAO, so code can't change silently.
2. **Generate the sealing key inside the enclave** and never export it; a real recovery partner with its own key.
3. **Plaid production access** and a licensed lending partner; Plaid's persistent account IDs for fingerprints.
4. **First mainnet loans** with small amounts.
5. **Live cross-chain deposits** through NEAR Intents (the demo shows dry-run quotes only).
6. **The AI summary inside the enclave** on mainnet, with the model's attestation checked.

Progress is logged in the repository (\`docs/LOG.md\`).
`,
  },
];

export const docBySlug = (slug: string) => DOC_PAGES.find((p) => p.slug === slug);

/** Plain text of a page for search (Markdown marks removed). */
export function plainText(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/:::diagram/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*#|>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Heading anchors, as the renderer makes them: "## Your limit" -> "your-limit". */
export const anchorOf = (heading: string) =>
  heading.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
