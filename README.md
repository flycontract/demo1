# Flight Delay Insurance DApp (COMP7610 project)

Parametric insurance for passenger flights arriving at Hong Kong International
Airport (HKIA). A buyer pays a fixed premium before a flight; after it lands
(or is cancelled), an off-chain oracle reports HKIA's official result and the
contract pays out automatically if the arrival was delayed ≥120 minutes or the
flight was cancelled. Built to the project's PRD (`PRD.md` in this repo's
parent folder) — see that document for the full business rules and the
data-verification trust boundaries this demo does **not** eliminate.

```
 HKIA official "past flights" API  ──►  oracle/ (Node.js/TypeScript)  ──►  fulfillVerification()
        (data.gov.hk / hongkongairport.com)     fetch + parse + match          FlightDelayInsurance.sol
                                                                                       │
 frontend/ (React + Ethers.js + MetaMask)  ──► buyPolicy / requestVerification ───────┘
```

## Layout

| Path | What it is |
|---|---|
| [`contracts/DemoToken.sol`](contracts/DemoToken.sol) | Minimal ERC-20 settlement token (0 decimals — every PRD amount is a whole token) |
| [`contracts/FlightDelayInsurance.sol`](contracts/FlightDelayInsurance.sol) | Flight registry, policies, oracle request/fulfil, settlement, invariants (PRD §7) |
| [`test_python/`](test_python) | Contract acceptance tests + a readable e2e run — usable **without installing Node** |
| [`oracle/`](oracle) | Node.js/TypeScript service: listens for verification requests, queries HKIA, submits results (PRD §6) |
| [`frontend/`](frontend) | React + Ethers.js + MetaMask app: Flights & Buy / My Policies / Insurer Admin (PRD §3) |
| `hardhat.config.ts`, `scripts/deploy.ts` | Compile + deploy both contracts to Sepolia |
| `legacy/` | The previous ETH-based, AviationStack/OpenSky-sourced prototype this demo replaced |

## Why the contract design differs from a "normal" oracle pattern

- **Fixed economics, not market pricing.** Premium 10 / payout 100 / 10,000
  initial fund / 8,000 warning line are PRD-mandated teaching parameters, not
  actuarially priced — see PRD §3.
- **Request → fulfil, not "anyone relays a signature."** `requestVerification`
  only emits an event; only the configured `oracle` account may call
  `fulfillVerification`. This matches PRD §6/§7's single-trusted-oracle
  design explicitly (not a stronger multi-source or signature-relay scheme).
- **Flight results are cached and shared.** Once one policy's request
  resolves a flight, every other policy on that flight settles via
  `settlePolicy` without a second oracle round trip (PRD §6: "同一天多个保单不
  各自下载整份数据" / §7.1: "已有最终结果时复用").
- **Manually-registered flights only.** `registerFlight` is a human-verified
  entry by the insurer, not an automated schedule feed — HKIA's historical API
  has no verified way to fetch *future* schedules (PRD §4). This is a
  deliberate, documented trust step, not automated underwriting.

## Trust boundaries (report this, don't hide it)

- **Single trusted oracle key.** If it's compromised or lies, the contract
  cannot tell — `fulfillVerification` just checks `msg.sender == oracle`.
- **Single trusted data source.** HKIA's API is the only signal; if it's
  wrong, the payout is wrong. `evidenceHash` lets you detect *if* the
  underlying record later changes, not whether it was ever accurate.
- **Single trusted insurer for flight registration.** `registerFlight`'s
  schedule is asserted by the insurer from manual research, not verified
  on-chain. See PRD §4 for why HKIA's historical API alone cannot support
  automated pre-departure underwriting yet.
- **HKIA API stability is unverified in a real Node.js deployment.** Only
  ad-hoc PowerShell requests have been checked so far (PRD §5.2); run
  `oracle/` against a real date before relying on it for a live demo.

## Running each piece

### 1. Contracts — no Node.js required

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install py-solc-x eth-tester web3 eth-account
python test_python/run_tests.py   # 24 acceptance checks (PRD §8's contract-side items)
python test_python/demo.py        # readable end-to-end run: buy → oracle reports → settle
```

These compile the real `contracts/*.sol` with `py-solc-x` and run them on an
in-process `eth-tester` chain — genuine contract execution, not a mock.

### 2. Deploy to Sepolia — needs Node.js ≥ 20

```bash
npm install
cp .env.example .env   # fill in SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY
npm run compile
npm run deploy:sepolia
```

Prints the token/insurance addresses and a starting block — paste those into
`oracle/.env` and `frontend/.env` (see their own `.env.example`).

### 3. Oracle service — needs Node.js ≥ 20

```bash
cd oracle
npm install
cp .env.example .env   # fill in RPC_URL, CONTRACT_ADDRESS, DEPLOY_BLOCK, ORACLE_PRIVATE_KEY
npm test                # parsing/matching unit tests (PRD §8 item 3: cross-day, codeshare, unknown text)
npm start                # long-running: recovers past requests, then listens + polls
```

The oracle account must also be set on the contract (`insurance.setOracle(...)`,
insurer-only) before its `fulfillVerification` calls will be accepted.

### 4. Frontend — needs Node.js ≥ 20

```bash
cd frontend
npm install
cp .env.example .env   # fill in VITE_RPC_URL, VITE_TOKEN_ADDRESS, VITE_INSURANCE_ADDRESS
npm run dev
```

Requires MetaMask (or another injected wallet) connected to Sepolia. The
**Insurer Admin** tab's write actions only succeed from the account that
deployed `FlightDelayInsurance` (or whatever the insurer later transfers
control to — the contract has no `transferOwnership`, deliberately, to keep
this demo's trust boundary explicit rather than pretending it's more
decentralized than it is).

## What's been verified vs. not (PRD §8/§9 distinctions — don't conflate these)

| Layer | Verified how | Not yet verified |
|---|---|---|
| Contract logic | 24 acceptance tests on a real compiled contract (`test_python/run_tests.py`) | Sepolia gas costs, a live MetaMask flow |
| HKIA JSON parsing/matching | Unit tests against hand-built fixtures matching the PRD's real sampled records (`oracle/src/parse.test.ts`) | A live Node.js process actually calling `hongkongairport.com` (PRD §5.2 only confirmed PowerShell worked; Python's default client got HTTP 403 once) |
| Full future-flight flow | Not yet run | End-to-end: register a real upcoming flight → buy before cutoff → oracle resolves real HKIA data → settle (PRD §8 "未来航班完整流程") |
| Frontend | Not yet run in a browser (no Node.js in this environment) | `npm run dev` + MetaMask smoke test |

Per PRD §9's completion bar: contract-level correctness is done; the "real
data, real future flight, real Node.js deployment" milestone is not yet
attempted and should not be reported as complete until it is.
