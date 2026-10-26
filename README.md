# COMP7610 flight insurance teaching demo

This branch implements phase two locally. **No Sepolia contracts have been deployed. Real sales are disabled.** The proposed payout metric is the airport's published **At gate** time versus an independently frozen official planned arrival, or explicit **Cancelled**. The user has not yet approved that metric. The historical API's `time` field is not proven to be an original future plan and must not be used as one in real underwriting.

## Protocol implemented

- Insurer freezes a flight number, origin, origin-local departure date, codeshare aliases, scheduled departure and arrival (UTC seconds), plan source URL, fetch time and evidence hash. The contract rejects registered alias collisions for the same origin/date. The insurer must still check real aircraft identity and preserve the exact plan evidence outside the chain.
- Premium 10 FDT, payout 100 FDT, initial pool 10,000 FDT, warning line 8,000 FDT. One wallet may buy once per registered actual flight. Buying is allowed until **exactly 24 hours before scheduled departure**; less than 24 hours is rejected. Each open policy reserves 100 FDT. The warning line stops new sales but cannot block existing settlement.
- Verification opens at midnight HKT after the scheduled Hong Kong arrival date. The oracle alone may provide a final result before `scheduledArrival + 7 days`; at the deadline, unresolved holders may refund 10 FDT. A prior final result can settle another holder after the deadline. Arrival delay is compared in **seconds**: at least 7200 seconds pays 100; `delayMinutes` is display only. Cancellation pays 100; unknown data stays pending.
- The oracle hashes and stores raw HKIA response bytes, URL, fetch time, matched record, parser version, outcome and transaction state before broadcasting. The hash proves byte consistency, not truth of the source. One trusted insurer, oracle and data source remain.

## Reproduce phase two with Node 22

Run from this repository root. On Windows this work used `F:\Environment\Node\node-v22.23.2-win-x64` on `PATH`; a standard Node 22 installation works without that absolute path. Install from locks with `npm ci`, `npm --prefix oracle ci`, and `npm --prefix frontend ci`. Python contract tests require `py-solc-x`, `eth-tester`, `web3`, and `eth-account` in a venv and a local solc 0.8.24.

```text
npm run compile
npm run abi:check
python test_python/run_tests.py
npm --prefix oracle run build
npm --prefix oracle test
npm --prefix frontend run build
npm run local:e2e
npm run env:check -- prepare
```

`local:e2e` starts a private Hardhat 31337 chain in-process, uses an isolated temporary SQLite DB and never writes the three Sepolia `.env` files. It replays saved HKIA bytes for CX 636 on 2026-10-25 and uses clearly marked synthetic outcomes for delay, on-time, cancellation and unknown/refund. CX 636's planned 00:10 is an **illustrative assumption**, not independently verified original schedule. The script checks terminal states, exact FDT balances, reserves, evidence bytes/hash, oracle receipt, failed unauthorized callback, alias collision and restart/replay deduplication. It never sends a Sepolia transaction.

## Local environment and deployment boundary

The three actual `.env` files are Git ignored. `npm run env:prepare` creates them only if **none** exists; it generates independent insurer and oracle test accounts, writes keys privately and prints only public addresses. Do not run it again when any `.env` exists. `npm run env:check -- prepare` checks the RPC chain, keys by derived public address, nonsecret frontend, placeholder fields, DB separation and Git ignore status without sending transactions. `npm run env:check -- deployed` requires real contract addresses and block and verifies bytecode plus the contract's token/oracle/insurer getters. Never commit `.env` or raw private keys.

Until authorized Sepolia deployment, `CONTRACT_ADDRESS`, `VITE_TOKEN_ADDRESS`, `VITE_INSURANCE_ADDRESS` and `DEPLOY_BLOCK` remain `UNDEPLOYED`. The frontend displays this as unavailable and has `VITE_SALES_ENABLED=false`. The dedicated account keys are local test accounts; they have not been funded on Sepolia. The user's existing `0x9208707E8d967365901b54249D335CAc5B10829c` is a buyer only.

After the terms and official per-flight plan evidence are confirmed and the stage-three deployment is authorized, run deployment only with a dedicated insurer signer and a distinct oracle signer. `scripts/deploy.ts` requires an explicit oracle address and reports the insurance transaction's exact deployment block. Review [phase-two acceptance](docs/phase2-acceptance-2026-10-26.md) and [phase-three handoff](docs/phase3-handoff-2026-10-26.md) before any deployment. A real future-flight purchase, wallet browser interaction and live oracle settlement have **not** been verified.

## Code layout

- `contracts/`: DemoToken and insurance protocol.
- `test_python/`: compiled-contract boundary and invariant tests.
- `oracle/`: HKIA parser, cache, evidence database, recovery service and offline fixture tests.
- `frontend/`: React/Vite UI; wallet chain/account guard and time-sensitive actions.
- `scripts/`: ABI sync, local E2E, safe env preparation/check and Sepolia deployment code.

The official history source can return 403, late corrections or conflicting records. Unknown, missing and ambiguous records do not become on-time results. The daily three-refresh maximum is **our project policy**, not a claimed airport API quota. Only a confirmed, independently sourced future schedule should be registered for real sale.
