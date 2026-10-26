# Phase 4 final reproduction, video and merge handoff

This is a checklist for the final COMP7610 submission due **8 November 2026**. The source branch is `origin/icn`; do not publish or push `main` until the final evidence and review are complete. On 27 October, `origin/main` was the initial commit and an ancestor of `origin/icn`; recheck their merge base and commit counts before merging.

## 1. Fix the final evidence boundary

Read [stage 3A acceptance](phase3a-acceptance-2026-10-26.md), [stage 3B live status](phase3b-live-status-2026-10-27.md), [teaching terms](teaching-terms-v1-2026-10-26.md), the [public deployment manifest](../deployments/sepolia.json) and [SQ898 admission manifest](../deployments/flight-sq898-2026-10-29.json). The timely buyer purchase is complete; Phase 3B's **real settlement remains incomplete** until an HKIA historical response has been matched, saved and settled (including a correct no-payout result). Until then, label the result “pending”, never “real closed loop”. The 31337 E2E and CX636 historical replay are supporting tests, not substitutes.

## 2. Fresh clone on a genuinely separate computer

Use a new directory, Node 22, Python 3.11, the committed npm lockfiles and `test_python/requirements.txt` with PyEVM and solc 0.8.24. Record host/OS, versions, `git rev-parse HEAD`, every command/exit code and final Git status. Do **not** copy `.env`, keys, SQLite, `node_modules`, artifacts, frontend dist or venv. Commands from the repository root:

```powershell
git clone --branch icn https://github.com/flycontract/demo1.git demo1-final-repro
Set-Location demo1-final-repro
npm ci
npm --prefix oracle ci
npm --prefix frontend ci
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -r test_python\requirements.txt
npm run compile
npm run abi:check
.venv\Scripts\python.exe test_python\run_tests.py
npm --prefix oracle run build
npm --prefix oracle test
npm --prefix frontend run build
npm run local:e2e
npm run secret:scan
git status --short
```

`local:e2e` should finish with **9840 FDT** pool and **0 FDT** reserve on chain 31337. That balance is not Sepolia. A separate computer cannot run `env:check deployed` without a Sepolia RPC and the three protected operating `.env` files; do not copy private keys merely to satisfy that command. Instead inspect the public receipts in an explorer or with a read-only Sepolia RPC. The earlier new clone gate used a fresh directory on the **same** Windows machine, so a second-computer claim still requires this step.

## 3. Record a concise demo video

1. Show the fixed `icn` SHA, locally passing tests, and clearly label historical replay versus synthetic 31337 outcomes.
2. Show the accepted terms, independent original SQ898 plan and the saved raw source/hash evidence; show the contract's immutable arrival plan and 24-hour sale cutoff.
3. Show Sepolia token/insurance addresses, five deployment receipts, role addresses, exact deployment block, pool/reserve and the SQ898 admission receipts. Mask RPC tokens and private configuration.
4. Show the buyer address, Sepolia network, **exactly 10 FDT** approval, timely purchase receipt/block time, Active policy, buyer FDT −10, pool +10 and reserved payout +100. Never display wallet password or seed phrase. The saved pre-purchase screenshot is supporting evidence, not a continuous recording.
5. After 30 October 00:00 HKT, show the request, genuine historical HKIA response URL/raw bytes/fetch time/matched flight, evidence hash, oracle callback and final state/balances. If HKIA is unavailable, show the pending state and explain the seven-day refund simulation separately; do not manufacture a live result.

## 4. Cross-day continuation

Next eligibility check: **30 October 2026 00:00 HKT**, after the planned Hong Kong arrival date ends. Inspect the hidden Sepolia oracle PID, logs and SQLite checkpoint using [operations](OPERATIONS.zh-CN.md); restart after machine sleep or shutdown. The buyer must personally sign `requestVerification` when the contract permits it. If the official historical endpoint returns 403, missing, ambiguous or unknown data, preserve the failure and wait under the configured low-frequency retry policy. Seven-day unresolved refund eligibility begins **5 November 2026 22:45 HKT**. No automation has been authorized, and a local background process is not a guarantee of unattended execution.

## 5. Final review and merge

Before any final report or main merge, rerun secret scan and deployment checks, verify all receipt links and balances, close or explicitly list all real-data gaps, and include contract/ABI limitations: single trusted insurer/oracle/source, mutable official data, one final on-chain settlement. Fetch both branches and review `git log --oneline origin/main..origin/icn`, `git diff --stat origin/main...origin/icn`, and the merge base. Open a normal review/PR or fast-forward **only after** the owner authorizes final publication; do not reset, force-push or copy `.env` into the merge.
