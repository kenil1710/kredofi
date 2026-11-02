# KredoFi

Private, income-based stablecoin loans on NEAR. Bank data is scored inside a TEE (OutLayer, Intel TDX); only a band, a score, an income cap, a keyed fingerprint and a sealed name reach the contract. The rules are in [`docs/SPEC.md`](docs/SPEC.md).

> Work in progress for the NEAR hackathon (Nov 2026). This README only states what is built and tested, with a link for each claim. The full guide comes on Nov 13.

## Where things run

| | Testnet | Mainnet |
|---|---|---|
| Contract | `kredofi.kency.testnet` | `kredofi.near` |
| Scorer mode | **Dev**: the pinned scorer runs on our server, outside the enclave | **OutLayer**: the scorer runs in Intel TDX |
| Money | mock USDC, test NEAR | real USDC (no loans yet) |
| Pinned scorer (SHA-256) | demo build `3be5f906…` | production build `87ceab66…` ([public wasm](https://github.com/kenil1710/kredofi-scorer-wasm)) |

Proof of the mainnet path: a real `request_score` scored inside OutLayer and stored by `on_score`, with the unused fee refunded to the borrower: [tx 4dgHrA97…](https://nearblocks.io/txns/4dgHrA97KfibKifZuVZ2YF5zoAVCy4m2pXxxf9zdijyu).

## Testnet only: one sandbox login, many judges

Plaid's sandbox login `user_good` returns the same identity to everyone. KredoFi allows one bank identity per borrower (security rule 6), so on testnet the demo scorer scopes that identity to your NEAR account before fingerprinting; every judge can log in with `user_good` / `pass_good`. The mainnet build does not include this and keeps the strict rule. Details and tests: [SPEC 8c](docs/SPEC.md), `scorer/src/lib.rs` (`scope_identity_to_account`).

## Known limits

- Sandbox bank data only (Plaid sandbox). Real banks need Plaid production access and a licensed lending partner.
- Testnet scoring runs outside the enclave (Dev mode); only mainnet uses OutLayer.
- The contract accounts keep their full-access keys during the hackathon (to redeploy fixes); this will be decided and stated here before submission.
