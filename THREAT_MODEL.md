# KredoFi threat model

What KredoFi protects, against whom, and where the protection stops. "Mainnet" means `kredofi.near` in OutLayer mode; "testnet" means the live demo (`kredofi.kency.testnet`, Dev mode). Every rule cited is in [docs/SPEC.md](docs/SPEC.md) section 7 and has a test.

## What we protect

| Asset | Protected from | How (mainnet) | Where |
|---|---|---|---|
| Bank transactions, balances, account details | lenders, the public chain, KredoFi's own servers | read only inside the TEE by the pinned scorer; the output is limited to band, score, income cap, fingerprint, sealed name and an optional sealed reply; the contract's parser refuses any other field; the bank connection is revoked after the fetch | `scorer/src/lib.rs` (`score_output`), `contracts/kredofi/src/score.rs` (`parse_output`) |
| Borrower's name | everyone, until a default | sealed with `SEAL_KEY` inside the TEE; no view returns it (rule 9); after a default it is re-sealed by the pinned scorer to the recovery partner's public key only | `scorer/src/crypto.rs`, `release_output`, rule 9 |
| Why a band was given (rule results, fetch counts) | everyone but the borrower's browser | sealed to a key generated in the browser for that request | `reply` / `extra` (x25519 + ChaCha20-Poly1305) |
| Who may ask for a score | someone re-scoring another person's account | mainnet: `request_score` must be signed by the borrower (rule 3); testnet: a one-time NEP-413 challenge signed by a full-access key of the account | `contracts/kredofi/src/score.rs`, `web/src/lib/ownership.ts` |
| Score integrity | fake or replayed scores | a score is accepted only in `on_score` (`#[private]`) for the contract's own pending OutLayer request, with the pinned `version_key`; `null` or error results change nothing; `dev_submit_score` is refused in OutLayer mode | rules 1-4, `tests/tests/scores.rs` |
| One borrower per bank identity | the same person borrowing again from a new NEAR account | keyed fingerprint HMAC(`SEAL_KEY`, institution, owner name, account mask), unique per borrower (rule 6) | `crypto::fingerprint`, rule 6 |
| Scorer secrets (Plaid keys, `SEAL_KEY`) | other code and other callers on OutLayer | released only to the pinned build **and** only to requests from `kredofi.near` (`build:7048cc92… AND from:kredofi.near`); a direct call by the secrets owner was refused (tx `EJ8Ygrru…`) | `docs/LOG.md` (Nov 1) |
| Lender funds | borrowers and the owner | checked u128 math; state updated before every transfer, with a rollback callback; one borrower at most 10% of pool value (rule 12); owner methods can't move pool cash, outstanding loans or the reserve (rule 10); a default is paid from the reserve first | `contracts/kredofi/src/*`, `tests/tests/*` |
| Limit growth | borrowers gaming levels | a level-up needs the loan held at least half its term, at least half the limit borrowed, and at most one level-up per term (rule 13) | `loans.rs`, `loan_tests.rs` |

## What we do not protect, or only partly

**The owner can still change the code.** Both contract accounts keep their full-access keys during the hackathon, so whoever holds them can deploy new code, and new code could move any funds. Owner *methods* can't (rule 10, tested); a code upgrade can. Before real money this needs a locked account, a DAO or a time-locked upgrade path. The mainnet pool holds no funds today.

**What the enclave attestation does and doesn't show.** Each OutLayer run has an Intel-signed TDX quote; [VERIFY 4b](VERIFY.md) checks the Nov 3 mainnet score (`PROVEN`). It shows an approved build ran our pinned scorer on that input and output. It doesn't show the enclave deletes the data afterwards, and OutLayer controls the approved list. Who holds which key today: [README](README.md#who-holds-what-today).

**`SEAL_KEY` was generated outside the enclave.** The mainnet `SEAL_KEY` was created on the developer's machine and given to OutLayer as a secret, so the developer could open sealed names and compute fingerprints offline. A production setup would generate it inside the TEE and never export it. The recovery partner's private key is also held by the developer (the partner is simulated).

**The developer also holds the Plaid keys.** The enclave's `PLAID_CLIENT_ID` and `PLAID_SECRET` were handed to OutLayer by the developer, who still has them. The one-time Plaid `public_token` (valid for 30 minutes) goes on-chain sealed, but the developer holds `SEAL_KEY` and could open it, exchange it first and read that borrower's bank data; the enclave's own exchange would then fail and no score would land. Today every bank is Plaid sandbox. Production would create the Plaid credentials and the sealing key inside the enclave only.

**`income_cap` is public, so it is coarse (testnet since Nov 5, mainnet since Nov 7).** At $50 steps it narrowed a low earner's income to about $100. It is now one of five buckets that each cover a wide range, with no figure. It still reveals that range, the public score can narrow it further, and values already on-chain don't change.

**The Plaid token is bound to the borrower (mainnet since Nov 3).** Until Nov 3 the mainnet scorer (`7048cc92…`) took `public_token` in plain text and exchanged it for whoever signed, so a token copied from a refused call could be scored for another account, which would then own that bank identity. Every pin since (now `5175182a…` on mainnet, [tx 29R9wmXS…](https://nearblocks.io/txns/29R9wmXS3WLbxdHEdnMSgcy38N375rp4T6mjts8DBFLd); `96666cdf…` on testnet OutLayer) accepts only `sealed1:` tokens: the browser seals `account + token` to a key derived from `SEAL_KEY`, and the scorer refuses a token sealed for another account before calling Plaid (proven in the testnet enclave, txs `5cyWM6Mz…` and `pNRfqHTC…`; real mainnet scores with a sealed token: [tx 3nbdkFd3…](https://nearblocks.io/txns/3nbdkFd3uNeeoYhqmE2AQHuRMXLZYbDhEZAUzsVDFGzo), [tx 9w6qBWdV…](https://nearblocks.io/txns/9w6qBWdViZrE2Y4KisYxxjdMtbCmAvRyNvAs6WGbymHm)). The developer, who holds `SEAL_KEY`, could still open a sealed token (security review H1, an AI-assisted review, not a professional audit: [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)). On the testnet demo in Dev mode, the server sees the token anyway.

**Mainnet scores carry no information yet.** The scorer talks to Plaid's sandbox, where anyone can log in as a custom user with any income, balance and name. Until Plaid production access exists, a mainnet band A is free to get, and many accounts could each borrow and default. Contract v3 refuses lender deposits until the owner sets `production_data`, which waits for Plaid production; on mainnet it lands with the v3 deploy on the owner's yes. The mainnet pool holds no funds today (security review Nov 3, H2).

**The contract pays for storage.** Lender and borrower records are paid from the contract's own NEAR. Deposits under 1 USDC are refused, and `/api/health` reports `storageLow` under 0.2 NEAR free. If storage does run out between `request_score` and `on_score`, the borrower can clear the stuck request with `cancel_pending_score` (security review Nov 3, M1; contract build after Nov 3).

**The live demo uses test data.** Since Nov 4 the testnet demo scores in OutLayer's testnet enclave, with its own `SEAL_KEY`, so our server no longer sees the Plaid tokens or fetched transactions. It does make the prepared sandbox users (Riya, Sam, Max, build your own), so it knows those made-up profiles. The AI summary is asked for by the browser after the score, from the band and rule results only (`/api/summary`), so our server sees those too; it keeps nothing. Testnet uses Plaid sandbox data only.

**Testnet scoring requires proof of the account.** Since Nov 2 every testnet score request carries a one-time challenge (5 minutes, single use) signed as a NEP-413 message by a full-access key of the account, naming the account and the browser's reply key; the server checks the signature and the key on chain (`web/src/lib/ownership.ts`, tested; a stranger's key, a replayed challenge and a mismatched reply key are refused). It still trusts the single testnet server that does the check; mainnet relies on the contract's own `signer == predecessor` rule.

**Trust in the TEE and its operators.** We rely on Intel TDX, OutLayer's worker registration and its secrets service. A broken enclave or a dishonest OutLayer operator could read bank data or forge results within the pinned code's limits.

**Plaid sees the data.** The bank connection goes through Plaid, which sees what any Plaid integration sees. KredoFi's own servers and the chain don't (mainnet).

**What the chain shows.** Bands, scores, income buckets (`income_cap`), bank fingerprints, loan amounts, due dates, repayments and defaults are public and linked to the borrower's NEAR account. Any app can read them without the borrower's consent. Anyone who knows who owns an account learns their band, income range and repayment history. Exact income, transactions and names are not on-chain (the name only sealed).

**The fingerprint is only as good as the identity data.** Plaid sandbox account IDs change per login, so the fingerprint uses institution, owner name and mask. A person with accounts at several banks can be several borrowers; name variations could create new fingerprints. Production would use Plaid's persistent account ID.

**Releasing a defaulter's name is permissionless.** After the due date plus grace, anyone can mark a loan defaulted and request the release, and the sealed name goes to the recovery partner. That is the deterrent by design; it also means a borrower who misses the deadline by a minute is released (testnet terms are 2 minutes plus 1 minute of grace).

**Reproducible on one platform only.** The pinned scorer is rebuilt byte for byte on x86_64 Linux in the pinned Rust image (`./scorer/build-docker.sh`, or the GitHub workflow). The same source built on macOS or ARM Linux gives other bytes, so checking it needs Docker on an x86_64 machine or a run of the workflow.

**The scorer trusts Plaid's "complete" flag only so far.** Plaid's sandbox sometimes reports the historical update complete before the history arrives. The production rule waits for a later page with transactions, or 5 quiet polls. On a fast host that was too short for the testnet build (a prepared borrower was scored on 6 of 30 transactions); the testnet build now also requires every month of the window. The production build has the original rule and could, in theory, score a partial history the same way; a partial history lowers a score, it can't raise it.

**Demo accounts are throwaway.** A demo account's full-access key lives in the browser's `localStorage`. Anything that can run script on the page (an XSS bug, a malicious extension) could take it; it holds only test funds. "Start with a new account" forgets the key for good.

**Relayer abuse.** The relayer pays every demo fee. It relays only `borrow`, `withdraw`, `ft_transfer_call` (repay or deposit, 1 yoctoNEAR) and `storage_deposit` to the KredoFi and test USDC contracts, at most 20 actions per account per hour, and creates at most 20 demo accounts per hour and 30 per day per network, and 60 a day in total. The test USDC faucet only funds accounts that exist, 10 times per network per hour (lender grants of $500: 10 per network per hour, 60 a day in total) and 300 times a day in total; default and release steps check the contract's own date rule before the relayer sends anything. Client IPs come from Cloudflare through our Worker only (IPv6 counted per /64). `/api/verify-score` runs a verifier binary on a checked transaction hash, with no shell and none of the server's secrets, at most two at once and 30 per network per hour. Limits are in memory and reset on restart. A determined abuser can still spend test NEAR.

**The AI summary can be wrong.** It never affects the score. Models sometimes state numbers wrongly, so the browser hides any summary that contains a number.

## Out of scope

Regulatory compliance (lending licences, KYC, fair-lending rules), real-money collections, and Plaid production access.
