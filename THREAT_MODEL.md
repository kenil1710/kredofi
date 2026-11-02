# KredoFi threat model

What KredoFi protects, against whom, and where the protection stops. "Mainnet" means `kredofi.near` in OutLayer mode; "testnet" means the live demo (`kredofi.kency.testnet`, Dev mode). Every rule cited is in [docs/SPEC.md](docs/SPEC.md) section 7 and has a test.

## What we protect

| Asset | Protected from | How (mainnet) | Where |
|---|---|---|---|
| Bank transactions, balances, account details | lenders, the public chain, KredoFi's own servers | read only inside the TEE by the pinned scorer; the output is limited to band, score, income cap, fingerprint, sealed name and an optional sealed reply; the contract's parser refuses any other field; the bank connection is revoked after the fetch | `scorer/src/lib.rs` (`score_output`), `contracts/kredofi/src/score.rs` (`parse_output`) |
| Borrower's name | everyone, until a default | sealed with `SEAL_KEY` inside the TEE; no view returns it (rule 9); after a default it is re-sealed by the pinned scorer to the recovery partner's public key only | `scorer/src/crypto.rs`, `release_output`, rule 9 |
| Why a band was given (rule results, AI summary, fetch counts) | everyone but the borrower's browser | sealed to a key generated in the browser for that request | `reply` / `extra` (x25519 + ChaCha20-Poly1305) |
| Who may ask for a score | someone re-scoring another person's account | mainnet: `request_score` must be signed by the borrower (rule 3); testnet: a one-time NEP-413 challenge signed by a full-access key of the account | `contracts/kredofi/src/score.rs`, `web/src/lib/ownership.ts` |
| Score integrity | fake or replayed scores | a score is accepted only in `on_score` (`#[private]`) for the contract's own pending OutLayer request, with the pinned `version_key`; `null` or error results change nothing; `dev_submit_score` is refused in OutLayer mode | rules 1-4, `tests/tests/scores.rs` |
| One borrower per bank identity | the same person borrowing again from a new NEAR account | keyed fingerprint HMAC(`SEAL_KEY`, institution, owner name, account mask), unique per borrower (rule 6) | `crypto::fingerprint`, rule 6 |
| Scorer secrets (Plaid keys, `SEAL_KEY`) | other code and other callers on OutLayer | released only to the pinned build **and** only to requests from `kredofi.near` (`build:7048cc92… AND from:kredofi.near`); a direct call by the secrets owner was refused (tx `EJ8Ygrru…`) | `docs/LOG.md` (Nov 1) |
| Lender funds | borrowers and the owner | checked u128 math; state updated before every transfer, with a rollback callback; one borrower at most 10% of pool value (rule 12); owner methods can't move pool cash, outstanding loans or the reserve (rule 10); a default is paid from the reserve first | `contracts/kredofi/src/*`, `tests/tests/*` |
| Limit growth | borrowers gaming levels | a level-up needs the loan held at least half its term, at least half the limit borrowed, and at most one level-up per term (rule 13) | `loans.rs`, `loan_tests.rs` |

## What we do not protect, or only partly

**The owner can still change the code.** Both contract accounts keep their full-access keys during the hackathon, so whoever holds them can deploy new code, and new code could move any funds. Owner *methods* can't (rule 10, tested); a code upgrade can. Before real money this needs a locked account, a DAO or a time-locked upgrade path. The mainnet pool holds no funds today.

**`SEAL_KEY` was generated outside the enclave.** The mainnet `SEAL_KEY` was created on the developer's machine and given to OutLayer as a secret, so the developer could open sealed names and compute fingerprints offline. A production setup would generate it inside the TEE and never export it. The recovery partner's private key is also held by the developer (the partner is simulated).

**The live demo is not private from us.** On testnet the scorer runs on our server (Dev mode), so the server process sees the Plaid tokens and transactions in memory while it scores. It uses a separate testnet-only `SEAL_KEY` and keeps nothing but the public output and the borrower-sealed `extra`. The AI summary is also generated from our server. Testnet uses Plaid sandbox data only.

**Testnet scoring requires proof of the account.** Since Nov 2 every testnet score request carries a one-time challenge (5 minutes, single use) signed as a NEP-413 message by a full-access key of the account, naming the account and the browser's reply key; the server checks the signature and the key on chain (`web/src/lib/ownership.ts`, tested; a stranger's key, a replayed challenge and a mismatched reply key are refused). It still trusts the single testnet server that does the check; mainnet relies on the contract's own `signer == predecessor` rule.

**Trust in the TEE and its operators.** We rely on Intel TDX, OutLayer's worker registration and its secrets service. A broken enclave or a dishonest OutLayer operator could read bank data or forge results within the pinned code's limits.

**Plaid sees the data.** The bank connection goes through Plaid, which sees what any Plaid integration sees. KredoFi's own servers and the chain don't (mainnet).

**What the chain shows.** Bands, scores, loan amounts, due dates, repayments and defaults are public and linked to the borrower's NEAR account. Anyone who knows who owns an account learns their band and repayment history. Income, transactions and names are not on-chain.

**The fingerprint is only as good as the identity data.** Plaid sandbox account IDs change per login, so the fingerprint uses institution, owner name and mask. A person with accounts at several banks can be several borrowers; name variations could create new fingerprints. Production would use Plaid's persistent account ID.

**Releasing a defaulter's name is permissionless.** After the due date plus grace, anyone can mark a loan defaulted and request the release, and the sealed name goes to the recovery partner. That is the deterrent by design; it also means a borrower who misses the deadline by a minute is released (testnet terms are 2 minutes plus 1 minute of grace).

**Reproducible on one platform only.** The pinned scorer is rebuilt byte for byte on x86_64 Linux in the pinned Rust image (`./scorer/build-docker.sh`, or the GitHub workflow). The same source built on macOS or ARM Linux gives other bytes, so checking it needs Docker on an x86_64 machine or a run of the workflow.

**The scorer trusts Plaid's "complete" flag only so far.** Plaid's sandbox sometimes reports the historical update complete before the history arrives. The production rule waits for a later page with transactions, or 5 quiet polls. On a fast host that was too short for the testnet build (a prepared borrower was scored on 6 of 30 transactions); the testnet build now also requires every month of the window. The production build has the original rule and could, in theory, score a partial history the same way; a partial history lowers a score, it can't raise it.

**Demo accounts are throwaway.** A demo account's full-access key lives in the browser's `localStorage`. Anything that can run script on the page (an XSS bug, a malicious extension) could take it; it holds only test funds. "Start with a new account" forgets the key for good.

**Relayer abuse.** The relayer pays every demo fee. It relays only `borrow`, `withdraw`, `ft_transfer_call` (repay or deposit, 1 yoctoNEAR) and `storage_deposit` to the KredoFi and test USDC contracts, at most 20 actions per account per hour, and creates at most 5 demo accounts per hour per network. Limits are in memory and reset on restart. A determined abuser can still spend test NEAR.

**The AI summary can be wrong.** It never affects the score. Models sometimes state numbers wrongly, so the browser hides any summary that contains a number.

## Out of scope

Regulatory compliance (lending licences, KYC, fair-lending rules), real-money collections, and Plaid production access.
