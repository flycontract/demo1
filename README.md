# COMP7610 flight insurance teaching demo

For a step-by-step Chinese handoff covering clean installs, authorized Sepolia deployment, receipt recovery, env fields, oracle/frontend operations, wallet checks, real-flight evidence and integration into main, see [Operations and handoff](docs/OPERATIONS.zh-CN.md).

Stage-three update (27 October 2026 HKT): the owner accepted [teaching terms v1](docs/teaching-terms-v1-2026-10-26.md). The five Sepolia deployment/funding/pause transactions confirmed within the approved 0.08 ETH budget; their [public manifest](deployments/sepolia.json) and [stage-three A acceptance](docs/phase3a-acceptance-2026-10-26.md) preserve the receipts. Separately authorized admission registered 29 October SQ898 as flight 1 and unpaused sales within the 0.02 ETH budget; see the [admission manifest](deployments/flight-sq898-2026-10-29.json) and [live status](docs/phase3b-live-status-2026-10-27.md).

The contracts are deployed on **Sepolia only**: token `0x350B48d0BB1f44764b04155AC2E4970A339f66b7`, insurance `0x0E8A379CA510aae2580a15A22F0A97BBF370da73`, insurance deployment block `11999004`. SQ898 flight 1 is on sale until **28 October 18:55 HKT**. The buyer signed an exact 10 FDT approval and purchased policy 0 at **27 October 00:17:48 HKT**, well before cutoff; current buyer balance is 190 FDT, pool 10010 FDT and reserve 100 FDT. Terms v1 uses the airport's published **At gate** time versus an independently frozen official planned arrival, or explicit **Cancelled**. The historical API's `time` field is not proven to be an original future plan and must not be used as one in real underwriting.

## Protocol implemented

- Insurer freezes a flight number, origin, origin-local departure date, codeshare aliases, scheduled departure and arrival (UTC seconds), plan source URL, fetch time and evidence hash. The contract rejects registered alias collisions for the same origin/date. The insurer must still check real aircraft identity and preserve the exact plan evidence outside the chain.
- Premium 10 FDT, payout 100 FDT, initial pool 10,000 FDT, warning line 8,000 FDT. One wallet may buy once per registered actual flight. Buying is allowed until **exactly 24 hours before scheduled departure**; less than 24 hours is rejected. Each open policy reserves 100 FDT. The warning line stops new sales but cannot block existing settlement.
- Verification opens at midnight HKT after the scheduled Hong Kong arrival date. The oracle alone may provide a final result before `scheduledArrival + 7 days`; at the deadline, unresolved holders may refund 10 FDT. A prior final result can settle another holder after the deadline. Arrival delay is compared in **seconds**: at least 7200 seconds pays 100; `delayMinutes` is display only. Cancellation pays 100; unknown data stays pending.
- The oracle hashes and stores raw HKIA response bytes, URL, fetch time, matched record, parser version, outcome and transaction state before broadcasting. The hash proves byte consistency, not truth of the source. One trusted insurer, oracle and data source remain.

## Reproduce locally with Node 22

Run from this repository root. On Windows this work used `F:\Environment\Node\node-v22.23.2-win-x64` on `PATH`; a standard Node 22 installation works without that absolute path. Install from locks with `npm ci`, `npm --prefix oracle ci`, and `npm --prefix frontend ci`. Python 3.11 contract tests use `test_python/requirements.txt` in a fresh venv (`python -m venv .venv`, then `.venv/Scripts/python -m pip install -r test_python/requirements.txt` on Windows) and solc 0.8.24, which py-solc-x downloads if missing. Install `py-evm` explicitly; the `eth-tester[py-evm]` extra can pull a Windows package requiring a C++ compiler.

```text
npm run compile
npm run abi:check
python test_python/run_tests.py
npm --prefix oracle run build
npm --prefix oracle test
npm --prefix frontend run build
npm run local:e2e
npm run secret:scan
```

`local:e2e` starts a private Hardhat 31337 chain in-process, uses an isolated temporary SQLite DB and never writes the three Sepolia `.env` files. It replays saved HKIA bytes for CX 636 on 2026-10-25 and uses clearly marked synthetic outcomes for delay, on-time, cancellation and unknown/refund. CX 636's planned 00:10 is an **illustrative assumption**, not independently verified original schedule. The script checks terminal states, exact FDT balances, reserves, evidence bytes/hash, oracle receipt, failed unauthorized callback, alias collision and restart/replay deduplication. It never sends a Sepolia transaction.

## Local environment and deployment boundary

The three actual `.env` files are Git ignored. `npm run env:prepare` creates them only if **none** exists; it generates independent insurer and oracle test accounts, writes keys privately and prints only public addresses. **Do not run it in this deployed workspace.** `npm run env:check -- deployed` verifies Sepolia chain, signer addresses, ABI hashes, bytecode, roles, the five live receipts, exact deployment block, pool, reserve and pause. A new clean clone has no `.env` and should use the local reproduction commands, not the deployed check. Never commit `.env` or raw private keys.

The existing `oracle/.env` and `frontend/.env` point to the deployed Sepolia contracts; `DEPLOY_BLOCK=VITE_DEPLOY_BLOCK=11999004` and `VITE_SALES_ENABLED=true` in this operating workspace. These private environment values are not in Git: a clean clone starts with the example placeholders and sales disabled until explicitly configured. The dedicated accounts are funded test accounts. The user's existing `0x9208707E8d967365901b54249D335CAc5B10829c` is a buyer only; no buyer private key belongs in this workspace.

Deployment is complete; `scripts/deploy.ts` and `scripts/admit-sq898.ts` keep intent/hash/receipt records so interrupted runs can inspect saved public evidence before continuation. Read [operations and handoff](docs/OPERATIONS.zh-CN.md), [phase-two acceptance](docs/phase2-acceptance-2026-10-26.md), [stage-three A acceptance](docs/phase3a-acceptance-2026-10-26.md) and the [current stage-three B record](docs/phase3b-live-status-2026-10-27.md). Browser wallet connection, the 200 FDT faucet claim and the timely SQ898 purchase were verified. The live oracle result and settlement have **not** yet occurred.

## Code layout

- `contracts/`: DemoToken and insurance protocol.
- `test_python/`: compiled-contract boundary and invariant tests.
- `oracle/`: HKIA parser, cache, evidence database, recovery service and offline fixture tests.
- `frontend/`: React/Vite UI; wallet chain/account guard and time-sensitive actions.
- `scripts/`: ABI sync, local E2E, safe env preparation/check and Sepolia deployment code.

The official history source can return 403, late corrections or conflicting records. Unknown, missing and ambiguous records do not become on-time results. The daily three-refresh maximum is **our project policy**, not a claimed airport API quota. Only a confirmed, independently sourced future schedule should be registered for real sale.
