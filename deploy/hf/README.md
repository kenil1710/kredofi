---
title: KredoFi
emoji: 📒
colorFrom: green
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
short_description: Private, income-based USDC loans on NEAR (testnet demo)
---

# KredoFi (testnet demo)

Borrow against your payslip: bank data is scored privately, and only a band and a limit go on-chain.
This Space runs the web app on NEAR **testnet** with test money and Plaid's public sandbox bank.

- Source and docs: see the project README.
- No secret is stored in this Space's files or image; keys are Space secrets, injected at runtime.
- Testnet only: the scorer runs on this server (Dev mode). On mainnet the same scorer runs inside Intel TDX through OutLayer.
