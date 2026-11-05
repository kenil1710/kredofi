// Public documentation at /docs. Plain text in a small Markdown subset (rendered by
// components/DocsBody.tsx) so the sidebar search can index it. Every number here is checked against
// the contract (contracts/kredofi), the scorer (scorer/src/rules.rs) and the live configs; see
// docs.test.ts for the link check. No internal notes, no developer account details, no secrets.

import { IN_ENCLAVE, KREDOFI_CONTRACT, NETWORK } from '../config.ts';

import { trustTableMarkdown } from '../trustModel.ts';
export type DocPage = { slug: string; title: string; summary: string; body: string };

// Testnet text follows how the demo scores: Dev mode (our server) until Nov 5, then OutLayer (the
// same enclave service as mainnet). SCORER_MODE in lib/config.ts; nothing here may claim more.
const ENC = IN_ENCLAVE;
const CREDIT_MODEL = `
## How 4–8% compares

Interest is flat per loan: **A 4%, B 6%, C 8%**. The loan term is 30 days on mainnet and 2 minutes on the testnet demo. Over the 30-day mainnet term, that is about 49%, 73% and 97% a year if you borrowed all year, so this is expensive credit, and repaying early doesn't reduce it.

| Credit | Cost per about 30 days (the mainnet term) | APR |
|---|---|---|
| KredoFi, bands A to C | 4% to 8% | about 49% to 97% |
| US credit card | about 1.7% | [21.19% (Federal Reserve, August 2026)](https://www.federalreserve.gov/releases/g19/current/) |
| US payday loan | about 32% if rolled over ($15 per $100, two weeks) | [almost 400% (CFPB)](https://www.consumerfinance.gov/ask-cfpb/what-are-the-costs-and-fees-for-a-payday-loan-en-1589/) |

Cheaper than a payday loan, far dearer than a card. These rates are our starting assumption: **no real loan has been made, so they aren't priced from real default data.**

## How many defaults this can absorb

Each default loses up to the whole principal, while each repaid loan earns far less. Roughly, if every loan is the same size:

| Band | Lenders earn per repaid loan | Lenders break even at, with no reserve | All interest goes to losses, at |
|---|---|---|---|
| A | 2% | about 2.0% of loans defaulting | about 3.8% |
| B | 3% | about 2.9% | about 5.7% |
| C | 4% | about 3.8% | about 7.4% |

The last column is the most the rate could cover even if the owner moved the whole treasury share into the reserve.

## Treasury to reserve

The reserve earns no interest by itself. It grows only when the owner seeds it (\`seed_reserve\`) or moves treasury money into it (\`treasury_to_reserve\`): an owner choice, one-way, a public event, and nothing makes it automatic.

## When the reserve is empty

A default then falls entirely on lenders: the share price drops by the uncovered amount, for everyone in the pool. Nothing refills the reserve by itself. There is no collateral and no on-chain way to collect. The borrower stays blocked and their sealed name goes to the recovery partner, who is simulated today. Withdrawals only ever pay out cash the pool holds, so they can also wait until loans come back. On the testnet demo we top up the reserve by hand; that is a demo convenience, not a promise.

## The Pilot plan

Planned, not built: a licensed lending partner makes the loans, the pool is capped, loans stay small, and the default rate is measured before rates or limits grow. The rates and how much treasury goes to the reserve would then be set from that data. See the [Roadmap](/docs/roadmap).
`;
const T_CONTRACT = NETWORK === 'testnet' ? KREDOFI_CONTRACT : 'kredofi.kency.testnet';
const MAINNET_SCORER = '6888c15e1442b508202141daf8cc246dddb9ecf5e586f1f0743671de7c23e6e2';
const TESTNET_SCORER = ENC ? '96666cdf840746c062738e6e74af5ab46eacd8bc40c60ccb43d9d638ac17bcfc' : 'ac8e2a9c732db84ccaee2854ed4f0b8394443b47e51dc7fcf8499005051ec0e9';
const TESTNET_WASM = 'https://raw.githubusercontent.com/kenil1710/kredofi-scorer-wasm/fa82707fd3a3d8a27513b8ab397d6ccb43aafe5f/kredofi_scorer_testnet.wasm';
const TESTNET_PIN_NOTE = ENC
  ? 'The contract pins it in every OutLayer request, like mainnet. The file is public: `curl -sL ' + TESTNET_WASM + ' | shasum -a 256` prints the same hash.'
  : "The server refuses to score if its WASM's hash differs from the pinned one.";
const TX_SCORE = 'https://nearblocks.io/txns/3nbdkFd3uNeeoYhqmE2AQHuRMXLZYbDhEZAUzsVDFGzo';
const TX_SCORE_NOV2 = 'https://nearblocks.io/txns/CNsoyGSj6aXtUmGzxUisxERirsv9jAsAZQ7GKVj7Udb7';
const TX_V4 = 'https://nearblocks.io/txns/Gj3X9axsGU2ctvrsPLo3Uhn93YzbL9XYRtC15fHPEp5c';
const TX_V3 = 'https://nearblocks.io/txns/2zyjvpPaybW9nUjpzQksbPVsgmHRxhmMWHkJ24VsSUAu';
const TX_SCORE_NOV1 = 'https://nearblocks.io/txns/4dgHrA97KfibKifZuVZ2YF5zoAVCy4m2pXxxf9zdijyu';
const TX_PIN = 'https://nearblocks.io/txns/2acP4tWJVNQDYeqD66kwrMcFa1XfReAffuU4qyk7VxkG';
const TX_DEPLOY = 'https://nearblocks.io/txns/Ags89jDRYZHi4h3ZXxk4kJGenNvrrGxAiAxGHmfKvwhp';
const TX_MIGRATE = 'https://nearblocks.io/txns/5fqzZSKCED3sv5eg9brTHJTLxCkiDjN9uaVof2bAKK34';
const WASM_URL = 'https://raw.githubusercontent.com/kenil1710/kredofi-scorer-wasm/6db115961a822664fdef8c8d19f02668b6f67e92/kredofi_scorer.wasm';

export const DOC_PAGES: DocPage[] = [
  {
    slug: 'overview',
    title: 'Overview',
    summary: 'What KredoFi is, who it is for, and what is live today.',
    body: `
**Prove your income on NEAR without showing your bank statements.** A pinned scorer fetches up to two years of your bank history, uses the last six full months, applies five published rules, and puts eight fields on the chain: \`v\`, \`caller\`, \`band\`, \`score\`, \`income_cap\`, \`fingerprint\`, \`sealed_identity\` and \`reply\`. ${ENC ? 'It runs inside a sealed computer (a TEE, OutLayer on Intel TDX), on mainnet and on the testnet demo alike; our server never sees your bank data.' : 'On mainnet it runs inside a sealed computer (a TEE, OutLayer on Intel TDX); on the testnet demo it runs on our server, which sees the test bank data while it scores.'}\n\n**First use: no-collateral USDC loans.** Borrow against that limit, repay, and the limit grows. Any other NEAR app can read the same band and limit: [Use KredoFi scores in your app](/docs/integrate).

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

After the due date plus the grace period, anyone can mark the loan as defaulted. The reserve pays the pool back first, up to the reserve's balance, the borrower can never borrow again, and the sealed name is re-sealed by the scorer to the recovery partner's key. See [Security](/docs/security).

## On the testnet demo

${ENC ? 'The same steps run in the same enclave service (OutLayer testnet) with a testnet build of the scorer and test money; a relayer gives no-wallet demo accounts the test NEAR for the scoring fee and pays their other fees.' : 'The same steps run, but the scorer runs on our server (Dev mode) and the server submits its output; a relayer pays all fees for no-wallet demo accounts.'} See [Testnet vs mainnet](/docs/testnet-vs-mainnet).
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
- your **income cap**: half your average monthly income, rounded down to one of five buckets: $0, $100, $250, $500 or $1,000.

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

A score is valid for 30 days, on mainnet and on the testnet demo. After that, check your limit again. While a score request is pending you can't borrow.

## If you don't repay

After the due date plus the grace period, **anyone** can mark the loan as defaulted; the contract checks the dates itself. Then:

- the reserve pays the pool back first, up to the loan's principal and the reserve's balance;
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

When a loan defaults, the **reserve pays first**, up to the loan's principal and the reserve's balance. Only what the reserve can't cover is lost by lenders, through the share price. Every default shows on the [public ledger](/ledger) with how much the reserve covered and how much lenders lost.

## Limits that protect the pool

- One borrower can take at most 10% of the pool's value.
- One bank identity (bank, owner name, account mask) can back only one borrower on this contract. Someone with accounts at several banks could become several borrowers.
- Limits start at $100 and grow only after on-time repayment of meaningful loans.
- The owner can't withdraw lender cash, outstanding loans or the reserve (see [Fees & treasury](/docs/fees-treasury) and [Security](/docs/security) for the caveat about code upgrades).
${CREDIT_MODEL}`,
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
- **Scores expire** after 30 days, on mainnet and on the testnet demo.
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

On mainnet the scorer runs on OutLayer inside **Intel TDX**, a trusted execution environment: memory is encrypted and it is designed so the operator can't read it. [Verify it yourself](/docs/verify) shows how to check the attestation of a run, and what that does and doesn't prove. The contract asks OutLayer for one exact program, identified by its SHA-256 (the pinned version). OutLayer releases the scorer's secrets (the Plaid keys and the sealing key) only to that program **and** only for requests that come from the KredoFi contract.

## What leaves the scorer

Exactly one short line (under 900 bytes), checked field by field by the contract:

| Field | What it is |
|---|---|
| \`band\`, \`score\` | A to D, 0 to 1,000 |
| \`income_cap\` | the cap on your limit, in USDC: always 0, 100, 250, 500 or 1,000 (base units on-chain) |
| \`fingerprint\` | a keyed hash of your bank identity (institution, owner name, account mask). Without the scorer's key it can't be reversed or linked to a bank |
| \`sealed_identity\` | your name, encrypted to the scorer's sealing key. Today the developer generated that key and can open it (see [Security](/docs/security)); production would make it inside the enclave |
| \`caller\` | your NEAR account (from the request, never from input) |
| \`reply\` (optional) | the five rule results, encrypted to a key your browser made for this request |

No transactions, balances, account numbers or names. The bank connection is removed at Plaid after the fetch.

## Who can open what

| Data | Who can read it |
|---|---|
| Band, score, income cap, loans | everyone (public chain) |
| Rule results (\`reply\`) | only the browser that asked for the score |
| Your name (\`sealed_identity\`) | the holder of the sealing key (today the developer, on both networks); after a default the scorer re-seals it to the recovery partner's key. No contract view ever returns it. |

## What we can't promise

- Plaid sees what any Plaid connection sees.
- The enclave relies on Intel TDX and OutLayer's operations.
${ENC ? '- The **testnet demo** scores in the same enclave service (OutLayer), testnet deployment, with a testnet build, Plaid sandbox data and test money.' : '- On the **testnet demo** the scorer runs on our server, not in an enclave, so that server sees the data while it scores (it keeps only the public output).'}

Details: [Security](/docs/security).

## The AI summary (testnet only)

On the testnet demo, a short plain-English summary is generated by NEAR AI Cloud, Qwen with a NEAR AI fallback (\`Qwen/Qwen3.8-27B\` first; if it hasn't answered in 8 seconds, \`Qwen/Qwen3.6-35B-A3B-FP8\`, also hosted by NEAR AI Cloud), after your score is set: your browser sends our server only the band and the five rule results (described in words, no numbers), never transactions, so our server does see those, and it asks NEAR AI and keeps nothing. It is a separate request, so it can't delay or change the score; if it fails, nothing is shown, and the page hides it if it contains numbers (models sometimes get them wrong). The mainnet scorer has no AI.
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
curl -s https://rpc.mainnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kredofi.near","method_name":"get_config","args_base64":""}}' | python3 -c "import json,sys;c=json.loads(bytes(json.load(sys.stdin)['result']['result']));print(c['scorer_mode'],c['scorer_version'],c['production_data'])"
\`\`\`

Expected: \`OutLayer ${MAINNET_SCORER} False\`. \`False\` means lender deposits are locked until real bank data (see [Mainnet proof](/mainnet)).

## 2. Is the published WASM that file?

\`\`\`
curl -sL ${WASM_URL} | shasum -a 256
\`\`\`

Expected: \`${MAINNET_SCORER}\`. OutLayer downloads the scorer from this commit-pinned address and checks the same hash.

## 3. Did a real score come from the enclave?

Open [the scoring transaction](${TX_SCORE}) (mainnet, 3 November 2026, with the current scorer; earlier builds scored on [2 November](${TX_SCORE_NOV2}) and [1 November](${TX_SCORE_NOV1})). Its receipts show \`request_score\` (its bank token starts with \`sealed1:\`: sealed to the scorer with the borrower's account, so a copied token is refused), the request to \`outlayer.near\` with the pinned version, the private callback \`on_score\`, the event \`score_issued\` (band A, 1,000) and the unused fee refunded to the borrower.

## 3b. Did that run really happen inside Intel TDX?

OutLayer publishes an Intel-signed TDX quote for each run. [Job 1257953](https://app.outlayer.ai/attestation/1257953) is that transaction. Check it with OutLayer's open-source verifier, not its website:

\`\`\`
cargo install --git https://github.com/out-layer/outlayer-verify outlayer-verify
outlayer-verify tx 3nbdkFd3uNeeoYhqmE2AQHuRMXLZYbDhEZAUzsVDFGzo --api https://api.outlayer.ai
\`\`\`

Expected: \`PROVEN\`, exit code 0, \`wasm sha256 6888c15e…\`. (The \`--api\` flag is needed for now: the tool's default address is retired. For a testnet score add \`--network testnet --api https://testnet-api.outlayer.ai\`.) It checks that the quote chains to Intel, that all five measurements are on the approved list of \`worker.outlayer.near\`, that the quote commits to the scorer hash, input and output, and that those match the bytes in the transaction. A saved copy is in the repository: \`outlayer-verify bundle docs/proofs/mainnet-score-2026-11-03.attestation.json --offline\`.

**What it doesn't prove:** that the enclave deletes the data after the run, or that the approved enclave image is good. OutLayer controls that approved list, and the image isn't linked to published source by this check. The attestation record comes from OutLayer's API, although the quote inside it is Intel-signed.

## 4. Can anyone else write a score?

No. On mainnet the contract is in OutLayer mode, so \`dev_submit_score\` is refused, and \`on_score\` is a private callback only the contract's own request can reach. Fake scores, wrong callers, wrong versions and reused fingerprints are all tested.

## 5. Does the WASM come from this source?

The source is in the repository (\`scorer/\`). The pinned build is made on x86_64 Linux in a pinned Rust image: \`./scorer/build-docker.sh\` gives \`${MAINNET_SCORER}\` on any x86_64 machine with Docker, and the repository's GitHub workflow prints the same hash (CI run 41623343936). Builds on macOS or ARM Linux give other hashes for the same source, which is why one platform is canonical.

## 6. The testnet demo

\`\`\`
curl -s https://kredofi.xyz/api/ledger | python3 -c "import json,sys;print(json.load(sys.stdin)['config']['scorer_version'])"
\`\`\`

Expected: \`${TESTNET_SCORER}\`. ${TESTNET_PIN_NOTE} Every event on the [public ledger](/ledger) links to its transaction on testnet.nearblocks.io.

## 7. Contract deployments

- Deployed in OutLayer mode: [transaction](${TX_DEPLOY}).
- Upgraded with a state migration (fee change): [transaction](${TX_MIGRATE}).
- Upgraded to contract v3 (security review fixes; lender deposits locked until real bank data): [transaction](${TX_V3}). Current scorer pinned: [transaction](${TX_PIN}).
- Upgraded to contract v4 (4 November: security review 2 fixes; new scorer pins wait 24 hours): [transaction](${TX_V4}).
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

The reserve pays losses first when a loan defaults, up to the loan's principal and the reserve's balance. It gets no share of interest. It grows only when the owner seeds it with USDC (\`seed_reserve\`) or moves treasury money into it. Moving treasury into the reserve is one-way.

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
${CREDIT_MODEL}`,
  },
  {
    slug: 'contracts-api',
    title: 'Contracts & API',
    summary: 'Addresses, methods, views and events.',
    body: `
## Addresses

| | Mainnet | Testnet |
|---|---|---|
| KredoFi contract | \`kredofi.near\` | \`${T_CONTRACT}\` |
| USDC | \`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1\` (native USDC) | \`musdc.kency.testnet\` (test USDC) |
| Scoring | OutLayer (\`outlayer.near\`), Intel TDX | ${ENC ? 'OutLayer (`outlayer.testnet`), Intel TDX' : 'Dev mode (our server)'} |
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

\`propose_scorer_version\`, \`apply_scorer_version\`, \`cancel_scorer_version\`, \`set_scorer_delay_ns\`, \`set_loan_term_ns\`, \`set_grace_ns\`, \`set_min_hold_ns\`, \`set_score_ttl_ns\`, \`set_max_borrower_share_bps\`, \`withdraw_treasury\`, \`treasury_to_reserve\`, and \`ft_transfer_call\` with \`msg: "seed_reserve"\`. Each needs 1 yoctoNEAR and emits an event.

A new scorer version never applies at once (contract v4, security review 2): the owner proposes it in public, and can apply it only after the time lock (24 hours on mainnet, never below 1 hour; 1 minute on testnet). The owner can cancel a pending change, and the lock can only be made longer. [Mainnet proof](/mainnet) shows any pending change.

## Views

\`get_config\`, \`get_pending_scorer\` (the proposed scorer and when it can apply, or \`null\`), \`get_pool\`, \`get_lender(account_id)\`, \`get_borrower(account_id)\` (never returns the sealed name), \`get_limit(account_id)\`, \`get_stats\`, \`is_release_allowed(account_id)\`.

## Events

NEP-297 logs with standard \`kredofi\`, version \`1.0.0\`:

\`score_issued\`, \`score_failed\`, \`loan_issued\`, \`loan_repaid\`, \`loan_defaulted\`, \`identity_released\`, \`lender_deposit\`, \`lender_withdraw\`, \`reserve_seeded\`, \`treasury_withdrawn\`, \`treasury_to_reserve\`, \`scorer_change_proposed\`, \`scorer_change_cancelled\`, \`scorer_version_changed\` (the applied change), \`param_changed\`.

The [public ledger](/ledger) is built from these events and trusts only logs from receipts executed by the KredoFi contract itself.

## Web API (testnet demo)

${ENC ? 'In OutLayer mode the account signs `request_score` itself (no server step); `/api/fund` gives a wallet low on test NEAR one fee top-up, with the same signed challenge. ' : ''}Scoring in Dev mode needs proof that you control the account: \`POST /api/score/challenge\` returns a one-time nonce (5 minutes), the account signs a NEP-413 message naming the account and the browser's reply key, and \`/api/score\` checks the signature and that the key is a full-access key of the account.

The demo's server routes (\`/api/score\`, \`/api/relay\`, \`/api/demo\`, \`/api/faucet\`, \`/api/ledger\`, \`/api/intents/quote\`) exist to run the testnet demo; they are rate-limited and not a stable public API.
`,
  },
  {
    slug: 'integrate',
    title: 'Use KredoFi scores in your app',
    summary: 'Read a borrower’s band and limit from any NEAR contract or frontend, and what that never reveals.',
    body: `
A KredoFi score is public, on-chain state. Any NEAR contract or frontend can read it with the contract's existing view methods: no API key, no permission from KredoFi, no new code on our side. Use it to gate a feature, size a limit or skip a deposit for people who have proven their income.

## The two views you need

| Method | Returns |
|---|---|
| \`get_limit({ account_id })\` | KredoFi's current credit limit for the account, in USDC base units (6 decimals). \`"0"\` without a valid score, after expiry, or if the account defaulted. |
| \`get_borrower({ account_id })\` | \`null\`, or \`{ level, score: { band, score, income_cap, expires_at, expired, scorer_version, … }, defaults, blocked, has_active_loan, loan, limit }\` |
| \`get_config({})\` | includes \`scorer_mode\` (\`OutLayer\` or \`Dev\`) and the pinned \`scorer_version\` |

Contracts: \`kredofi.near\` (mainnet, OutLayer mode) and \`${T_CONTRACT}\` (testnet, ${ENC ? 'OutLayer' : 'Dev'} mode). See [Contracts & API](/docs/contracts-api).

## From a frontend (near-api-js)

\`\`\`js
import { JsonRpcProvider } from 'near-api-js';

const near = new JsonRpcProvider({ url: 'https://rpc.mainnet.fastnear.com' });
const view = (method, args) => near.callFunction({ contractId: 'kredofi.near', method, args });

const b = await view('get_borrower', { account_id: 'alice.near' });
const proven = b?.score && !b.score.expired && !b.blocked;     // income proven and still valid
const band = proven ? b.score.band : null;                      // 'A' | 'B' | 'C' | 'D'
const limitUsd = Number(await view('get_limit', { account_id: 'alice.near' })) / 1e6;
\`\`\`

From a terminal: \`near contract call-function as-read-only kredofi.near get_borrower json-args '{"account_id":"alice.near"}' network-config mainnet now\`.

## From a contract (Rust, near-sdk 5)

A view method can be called across contracts like any other method; read the answer in a callback.

\`\`\`rust
#[ext_contract(ext_kredofi)]
trait KredoFi {
    fn get_borrower(&self, account_id: AccountId) -> Option<serde_json::Value>;
}

pub fn check_income(&mut self) -> Promise {
    let user = env::predecessor_account_id();
    ext_kredofi::ext("kredofi.near".parse().unwrap())
        .with_static_gas(Gas::from_tgas(5))
        .get_borrower(user.clone())
        .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).on_kredofi(user))
}

#[private]
pub fn on_kredofi(&mut self, user: AccountId,
                  #[callback_result] r: Result<Option<serde_json::Value>, PromiseError>) -> bool {
    let Ok(Some(b)) = r else { return false };
    let score = &b["score"];
    let ok = !score.is_null() && score["expired"] == false && b["blocked"] == false
        && matches!(score["band"].as_str(), Some("A" | "B"));
    // store or act on \`ok\` for \`user\`
    ok
}
\`\`\`

## Check before you rely on it

- **Mode.** Trust a score as enclave-made only if \`get_config\` says \`scorer_mode: "OutLayer"\`. ${ENC ? 'Both the mainnet and the testnet demo contract do; a testnet score is still sandbox data.' : 'On the testnet contract (`Dev`), scores are submitted by our server.'}
- **Version.** \`score.scorer_version\` is the SHA-256 of the scorer that made it. Compare it with the pinned version you have checked yourself ([Verify it yourself](/docs/verify)).
- **Freshness.** Scores last 30 days on mainnet and on the testnet demo (\`expires_at\`, nanoseconds). An expired score reads \`expired: true\` and a limit of 0.
- **Who controls the account.** A score proves that someone's bank data was scored for this NEAR account. It doesn't prove who holds the account's keys today.

## What it never reveals

No transactions, balances, account numbers, bank names or the borrower's name: none of these reach the chain, and no view returns the sealed name (\`sealed_identity\` has no view at all).

What it does reveal, publicly, to everyone:
- the band, the score and the KredoFi loan history (level, loans, repayments, defaults);
- \`income_cap\`, one of five buckets, which puts your average monthly income in a range: $0 means below $200 a month, $100 means $200 to $499, $250 means $500 to $999, $500 means $1,000 to $1,999, and $1,000 means $2,000 or more. It never gives a figure, but anyone can read which range you are in.
- the \`score\` can narrow that further, because the income rule adds 40, 100, 180 or 250 points at $1,000, $2,000 and $3,000 a month. A score of 1,000 can only mean at least $3,000 a month, more than the $1,000 bucket alone says.
- Buckets apply to scores from the testnet build \`96666cdf…\` onward. Scores already on-chain keep the $50-step value they were issued with. On mainnet, \`kredofi.near\` still pins the older \`6888c15e…\` with $50 steps until the bucket build passes its 24-hour time lock; its deposits are locked and only our own test account has scored there.
- a keyed \`fingerprint\` of the bank identity, which can't be reversed but is the same for every score of that bank identity.
`,
  },
  {
    slug: 'security',
    title: 'Security',
    summary: 'What we protect, what we don’t, and the known limits, in plain language.',
    body: `
## What we protect

- **Your bank data** is read only by the pinned scorer, inside the enclave on mainnet. Only eight fields come out: \`v\`, \`caller\`, \`band\`, \`score\`, \`income_cap\`, \`fingerprint\`, \`sealed_identity\` and \`reply\`. Nobody outside can verify the enclave deletes the data when the run ends.
- **Your name** stays sealed unless you default.
${ENC ? "- **A score's origin can't be forged.** The contract accepts a score only from its own pinned OutLayer request, on mainnet and on the testnet demo. Its input can be: with Plaid sandbox data anyone can use a test login, so today a score proves where it was computed, not that the income is real." : "- **A score's origin can't be forged on mainnet.** The contract accepts a score only from its own pinned OutLayer request. Its input can be: with Plaid sandbox data anyone can use a test login, so today a score proves where it was computed, not that the income is real. On the testnet demo (Dev mode) it accepts scores from one scorer account that our server holds, so there you trust our server."}
- **Only you can ask for your score.** ${ENC ? 'The contract requires your account to sign the request, and the bank token inside it is sealed to the enclave together with your account, so a copied token is refused.' : "On mainnet the contract requires your account's signature."} ${ENC ? '(Until the testnet demo moved into the enclave on 4 November, it asked for a one-time challenge signed with a full-access key of your account, a NEAR NEP-413 signed message, instead.)' : "On the testnet demo, every score request carries a one-time challenge signed with a full-access key of your account (a NEAR NEP-413 signed message), so nobody can re-score someone else's account."}
- **Lender money.** Checked math, state written before every transfer with rollback on failure, a 10% per-borrower limit, the reserve pays first up to its balance, and no owner method can move lender cash, loans or the reserve.

## What we don't protect, or only partly

- **The owner can still change the code.** The contract accounts still have their full-access keys, so the owner could deploy different code, and different code could move funds. Before real money this needs locked keys, a DAO or time-locked upgrades. The mainnet pool holds no funds today.
- **The Plaid keys are also held by the developer.** The enclave's Plaid keys were handed to OutLayer by the developer. Since 3 November the one-time bank token goes on-chain sealed to the scorer with your account (a copy is refused), but the developer also holds the sealing key, so could open it, exchange it first and read that bank data (the score would then fail). Production would create and keep these keys only inside the enclave.\n- **The sealing key was made outside the enclave.** The mainnet sealing key was generated by the developer and handed to OutLayer as a secret, so the developer could open sealed names. The recovery partner is simulated and its key is also held by the developer. Production would generate the key inside the enclave.
${ENC ? '- **The testnet demo uses test data.** It scores in the enclave like mainnet, with its own sealing key, sandbox banks and test money.' : "- **The testnet demo isn't private from us.** Its scorer runs on our server, so that server sees the data while scoring. It uses its own sealing key, sandbox banks and test money."}
- **Trust in the enclave.** We rely on Intel TDX and on OutLayer's worker registration and secrets service. An attestation proves an approved build ran; OutLayer decides which builds are approved.
- **The chain is public.** Your band, score, loans and repayments are linked to your NEAR account.
- **Fingerprints rely on identity data.** Someone with accounts at several banks could become several borrowers.
- **A missed deadline releases your name.** After the due date plus grace, anyone can mark the default; that is the deterrent by design.
- **Partial bank history.** Plaid's sandbox sometimes reports the history as complete before it has arrived. The scorer waits for it (and the testnet scorer also checks every month is present); a partial history can lower a score, never raise it.
- **Rebuilding the scorer needs x86_64 Linux.** The pinned file rebuilds byte for byte in the pinned Docker image on x86_64 (or in the repository's GitHub workflow); macOS and ARM builds give other bytes. See [Verify it yourself](/docs/verify).
- **Demo accounts live in your browser.** Their key is in local storage; anything that can run script on the page could take it. They hold only test funds.

## Who holds what today

Today most of this is one person, the developer. This is a hackathon MVP with $0 in the mainnet pool, and it would not be safe for real money as it stands. The Pilot column is a plan, not something built, except the 24 h scorer time lock.

${trustTableMarkdown()}

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
| Contract | \`${T_CONTRACT}\`${T_CONTRACT !== 'kredofi.kency.testnet' ? ' (since 4 November; before that \`kredofi.kency.testnet\`, Dev mode, now only our own test runs, history kept on-chain: [explorer](https://testnet.nearblocks.io/address/kredofi.kency.testnet))' : ''} | \`kredofi.near\` |
| Scoring | ${ENC ? '**OutLayer** (`outlayer.testnet`), Intel TDX; the contract accepts a score only in its own callback' : '**Dev mode**: the pinned scorer runs on our server; the server submits its output'} | **OutLayer**, Intel TDX; the contract accepts a score only in its own callback |
| Pinned scorer | testnet build \`${TESTNET_SCORER.slice(0, 8)}…\` | production build \`${MAINNET_SCORER.slice(0, 8)}…\` |
| Bank data | Plaid sandbox | Plaid sandbox (no production access yet) |
| Money | test USDC and test NEAR | native USDC configured; pool empty, no loans yet |
| Accounts | no-wallet demo accounts, a relayer pays every fee, or any testnet wallet | your own wallet |
| Loan term / grace / minimum hold | 2 min / 1 min / 1 min | 30 days / 7 days / 15 days |
| AI summary | yes: our server sends your band and rule results in words (no numbers, no bank data) to NEAR AI Cloud | no |
| Extras in the scorer | ${ENC ? 'the shared sandbox login is tied to your account (prepared borrowers and build-your-own are made as Plaid sandbox users by our server, then fetched from Plaid inside the enclave)' : 'prepared borrowers (Riya, Sam, Max, build your own); the shared sandbox login is tied to your account; a fetch receipt'} | none |

## Proof of the mainnet path

- Contract deployed in OutLayer mode: [transaction](${TX_DEPLOY}).
- A real score computed inside OutLayer and stored by the contract's callback (band A, 1,000), with the unused fee refunded to the borrower: [transaction](${TX_SCORE_NOV1}) (1 November, earlier build).
- Re-pinned to the reproducible build \`7048cc92…\` and scored again inside OutLayer (band A, 1,000, 7.6 seconds): [transaction](${TX_SCORE_NOV2}) (2 November).
- Contract upgraded with a state migration: [transaction](${TX_MIGRATE}).
- Security review fixes (3 November; an AI-assisted review, not a professional audit): contract v3, lender deposits locked until real bank data ([transaction](${TX_V3})); scorer \`${MAINNET_SCORER.slice(0, 8)}…\` with sealed bank tokens pinned ([transaction](${TX_PIN})) and scored with a sealed token inside OutLayer (band A, 1,000, 8.5 seconds): [transaction](${TX_SCORE}).
- Security review 2 fixes and a 24-hour time lock on scorer re-pins (4 November): contract v4 ([transaction](${TX_V4})).
- Live view of all of this: [Mainnet proof](/mainnet).

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

No. Every score request is signed with your account's own key: ${ENC ? 'your account signs the score transaction itself.' : 'on mainnet by your transaction, on the testnet demo by a one-time signed challenge.'}

## Can KredoFi see my transactions?

On mainnet they are read inside the enclave and never leave it; the one exception is the Plaid-key caveat in [Security](/docs/security) (the developer holds the same keys). ${ENC ? 'On the testnet demo too: it scores in the enclave, with Plaid sandbox data.' : 'On the testnet demo the scorer runs on our server, which sees them while scoring and keeps only the public output.'}

## Why is my band lower than I expected?

Open your passbook: the five rule results show which rules cost points, and refused scores list what would change them. The rules are on [Scoring model](/docs/scoring-model).

## Why can't I borrow my full limit?

The pool lends one borrower at most 10% of its value, and only what it has in cash. The borrow form shows the most you can take now.

## Why didn't my limit go up?

A repayment raises your level only after the minimum hold, on a loan of at least half your limit, at most once per loan term. The Repaid entry says which condition wasn't met.

## Can I use the same bank with two accounts?

Not with the same bank identity (bank, owner name, account mask) on this contract: it backs one borrower. Accounts at other banks are different identities, so someone with several banks could become several borrowers. (On testnet, the shared sandbox login is tied to each NEAR account so every visitor can try it.)

## What happens if I don't repay?

After the due date plus grace, anyone can mark the default. The reserve pays lenders first, up to its balance, you can't borrow again, and your sealed name can be released to the recovery partner.

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
    summary: 'A hackathon MVP today; the phases after it, in order.',
    body: `
KredoFi today is a **hackathon MVP**: it works end to end on testnet, and the mainnet contract scores inside the enclave, but it has never lent real money. These are the next phases, in order. There are no dates: each phase depends on partners and approvals we don't control yet.

## Now: the MVP

- Live on testnet: bank scoring, loans, repayments, level-ups, defaults paid by the reserve, and the identity release, all on public transactions.
- On mainnet, \`kredofi.near\` scores inside Intel TDX through OutLayer with a pinned, published scorer ([Mainnet proof](/mainnet)). Lender deposits stay locked until real bank data.
- Bank data is Plaid's sandbox only.

## Pilot: real banks, small and capped

- **Plaid production access**, and a **licensed lending partner** to make the loans; KredoFi supplies the score.
- **Owner role behind a multisig**; the **time lock on scorer re-pins** is already built (24 hours on mainnet), so users can leave before a new scorer applies; then the contract keys are locked (below).
- **A capped pool**: small loans and a hard limit on total lending while the default rate is measured.
- The sealing key and the Plaid keys created inside the enclave, so nobody else holds them.
- **Time-lock \`production_data\`**: today the owner can switch it on at once, which unlocks lender deposits with no public wait.
- A real recovery partner that holds its own key, and the OutLayer secrets owner behind the same multisig. The full list of who holds what today is in [Security](/docs/security).

## India: RBI Account Aggregator

The same rules on bank data shared through India's Account Aggregator network (consented, regulated data sharing), instead of Plaid. This needs an Account Aggregator integration and a regulated lending partner in India.

## Platform: scores for other NEAR apps

Other NEAR contracts and apps already can read a borrower's band and limit with view calls ([Use KredoFi scores in your app](/docs/integrate)). This phase makes that a product: stable interfaces, documented guarantees, and apps that use the score for things other than loans (access, deposits, reputation).

## Cross-chain: lenders through NEAR Intents

Lenders deposit USDC from other chains through NEAR Intents (1Click) and earn on the NEAR pool. The demo shows dry-run quotes only; Intents has no testnet, so this needs a careful mainnet setup with tiny amounts first.

## Locking the mainnet contract

The contract account \`kredofi.near\` still has a full-access key. Whoever holds it could deploy new code, and new code could move any funds; owner methods can't (tested). Deleting that key now would also block every fix, so the lock comes last:

1. Deploy the **final reviewed build**, with the fixes from both security reviews (AI-assisted, not professional audits; \`docs/SECURITY_AUDIT.md\` in the repository).
2. Move the **owner role to a multisig**, so several keys must sign every owner call.
3. **Time lock on scorer re-pins** (built, contract v4): a proposed scorer applies only after 24 hours, so lenders and borrowers can leave before a new scorer build applies.
4. **Lock**: delete the contract account's full-access key, so the code can never change again.

Not done yet: today the mainnet pool holds no money.

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
