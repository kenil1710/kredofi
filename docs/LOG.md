# Build log

- 2026-11-01 (day 1): mock-usdc (NEP-141, 6 dp) and kredofi pool (deposit / seed_reserve via ft_on_transfer, withdraw with rollback callback, checked share math, NEP-297 events) done; 37 unit + 8 near-workspaces tests pass. Pinned near-sdk 5.29.1 + near-workspaces 0.23.0 (newer need rustc 1.95). SPEC 4 now lists the pool edge rules (1 yocto withdraw, event after success, no 0-share deposits, min_hold = term/2); SPEC 8a: relayer owns mock-usdc and mints 10 USDC per demo account, 500 once per wallet. Next: day 2 scores.
