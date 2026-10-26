# Stage 3A acceptance and stage 3B status — 26 October 2026

## Scope and verdict

**Sepolia deployment and read-only contract checks: PASS.** Chain `11155111`; deployed token `0x350B48d0BB1f44764b04155AC2E4970A339f66b7`, insurance `0x0E8A379CA510aae2580a15A22F0A97BBF370da73`. Five approved insurer transactions confirmed. **At this deployment checkpoint**, the insurance pool was `10000 FDT`, reserved payout `0 FDT`, flight count `0`, `paused=true`. The later flight admission and wallet status are tracked separately in [stage 3B live status](phase3b-live-status-2026-10-27.md). This checkpoint is **not** acceptance of a future-flight purchase or a live oracle callback.

The user accepted [teaching terms v1](teaching-terms-v1-2026-10-26.md) and separately authorized only these five transactions, with combined spend at most `0.08 Sepolia ETH` and per-transaction max fee at most `10 gwei`. Their authorization excludes flight registration, opening sales and buyer signatures. Actual insurer gas spend according to five receipts: `0.002594607418990694 Sepolia ETH`; manifest stores the exact wei value `2594607418990694`. No mainnet transaction was sent.

## Reproducibility gate

Fixed source commit `3430f4ccc2311b123577f5c887dc421817b53a8f`. A new remote clone on the **same Windows computer**, `courses/COMP7610/demo1-clean-4a-final-2026-10-26`, began without `.env`, keys, database, `node_modules`, artifacts, dist or venv. Node `22.23.2`, npm `10.9.8`, Python `3.11.9`, solc `0.8.24`, pinned `test_python/requirements.txt` including PyEVM. All commands exited `0`: three `npm ci` installs, fresh venv install, compile, ABI check, Python contract tests `31/31`, oracle build and tests `19/19`, frontend build, isolated 31337 E2E, secret scan. The E2E final pool was `9840 FDT`, reserved `0`; that is local simulation, **not** the Sepolia pool. The clone remained Git clean after compilation. Commands and exit codes: `courses/COMP7610/evidence/phase3-clean-4a-final-summary.txt`; individual logs share that filename prefix. This does not claim reproduction on another physical computer.

## Public deployment record

The machine-readable [manifest](../deployments/sepolia.json) records chain ID, source commit, solc `0.8.24` optimizer `200` / EVM `paris`, hardhat config SHA-256 `32e822381e8f30e4608c91e2b464c755357c7201dd3031282991ad97f787780a`, token ABI SHA-256 `3da3b66065ce0f8e40122ef4511b81ef213119d9cc7c78ad2c6576944ca6ff5a`, insurance ABI SHA-256 `9789ec8220e9a4ba67387c2d8c186d4da8f8c0d1e07b0acd9d2cf7ff084ac27c`, account addresses, each transaction hash and complete public receipt. The exact insurance `DEPLOY_BLOCK=11999004` came from its deployment transaction receipt.

| Step | Sepolia transaction | Block | Result |
|---|---|---:|---|
| Deploy DemoToken | `0xa34f28ab341dfa9497d9e0b10345153cd81e229cb0c5828685e0700c82e9e842` | 11998968 | success |
| Deploy FlightDelayInsurance | `0x7b60507a41933c2a0ba74ff6bf102b03324b0e4c7fbd63f5beaf47dc2c9505f8` | 11999004 | success |
| Approve 10000 FDT | `0x377d0ecfefd3b51881a35770a819932be108ca44e472faeca4ccc9b61bfe8448` | 11999005 | success |
| Fund pool 10000 FDT | `0x92db58d93ccecd3366d467a247c234fc5b56cb48f2c9362f77689a8ac4c08d66` | 11999009 | success |
| Pause sales on chain | `0x88bf9843a7a005fea25319581f7e5e1b1c4d63325a80ec43efd77ebe06a4cf49` | 11999010 | success |

The first broadcaster run timed out after the approve hash was saved. It had already recorded both deployment receipts. A second run confirmed the saved approve hash and completed only fund/pause; no earlier step was resent. `npm run env:check -- deployed` then passed by checking RPC chain ID, bytecode, roles, ABI hash, all five live receipts, deployment block, pool/reserve and pause. The frontend rebuilt after config changes.

## Private configuration and service

| File | State | Values deliberately withheld |
|---|---|---|
| Root `.env` | Existing, Git ignored; Sepolia RPC and insurer signer unchanged | RPC credential and private key |
| `oracle/.env` | Existing, Git ignored; insurance address and block `11999004` updated; isolated `oracle-sepolia.sqlite` retained | RPC credential and oracle private key |
| `frontend/.env` | Existing, Git ignored; token/insurance addresses updated; `VITE_SALES_ENABLED=false` | RPC URL details |

The Sepolia oracle started with signer `0x3C65B6280BeCCdb01857B53579407Bf026B1F939`, verified its contract role and independent SQLite scope `11155111:0x0e8a379ca510aae2580a15a22f0a97bbf370da73`. It stopped and restarted with the same database; checkpoint advanced from block `11999014` to `11999017`, with `requests=0`. This verifies startup, event scanning and restart, **not a real request or callback**. Start/stop/recovery commands are in [operations](OPERATIONS.zh-CN.md).

## Stage 3B state and next gates

At this deployment checkpoint, the [primary 29 October SQ898](phase3-sq898-candidate-2026-10-29.md) and [backup 30 October SQ898](phase3-sq898-backup-2026-10-30.md) were candidates with saved airline timetable and HKIA future-arrival evidence. Subsequent separately authorized 29 October admission and buyer faucet evidence are in [stage 3B live status](phase3b-live-status-2026-10-27.md). No historical HKIA result for these future dates exists yet.

The subsequent separate authorization and budget for 29 October SQ898 admission were obtained and executed as documented in [stage 3B live status](phase3b-live-status-2026-10-27.md). The buyer must personally sign exactly `10 FDT` approve and purchase. Preserve the purchase transaction and block time before the 24-hour cutoff. After the planned Hong Kong arrival date ends, request verification and allow the oracle to use the real official historical response; unknown/403/conflicting/missing responses remain pending. Do not describe the earlier synthetic 31337 E2E as this live result.
