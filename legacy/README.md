# Flight Delay Insurance — Simple Signing Oracle (demo)

A parametric insurance contract that pays out automatically when a flight takes off
2+ hours late or is cancelled. Take-off data comes from an off-chain **signing oracle**.

```
 Flight API  ──►  oracle.py  ──(signed report)──►  anyone relays  ──►  FlightDelayInsurance.sol
 (AviationStack / OpenSky / mock)   signs with oracle key                 checks signature with ecrecover
```

## Files
| File | What it does |
|---|---|
| `contracts/FlightDelayInsurance.sol` | Policies, liquidity pool, signature check, payout logic |
| `oracle/oracle.py` | Fetches take-off data, builds + signs the report, can submit it |
| `oracle/mock_flights.json` | Fake flight results for demos (edit freely) |
| `demo.py` | Full end-to-end run on an in-process blockchain |
| `build/FlightDelayInsurance.json` | Precompiled ABI + bytecode (solc 0.8.24, evm "paris") |

## Run the demo (no wallet or testnet needed)
```bash
pip install -r oracle/requirements.txt
python demo.py
```
Expected: CX101 (155 min late) pays out, SQ872 (12 min late) doesn't, MU502 (cancelled) pays out,
a late purchase and a forged oracle report are both rejected.

If you edit the contract, delete `build/` or keep it older than the .sol file and `demo.py`
recompiles with `py-solc-x` (downloads solc on first run).

## Use real flight data
```bash
# AviationStack (free key at aviationstack.com, ~100 requests/month on free tier)
export AVIATIONSTACK_KEY=...
python oracle/oracle.py --source aviationstack --flight CX101 --scheduled 2026-09-25T09:00+08:00

# OpenSky (free; data usually available the day after the flight)
python oracle/oracle.py --source opensky --flight CX101 --callsign CPA101 --airport VHHH \
    --scheduled 2026-09-25T09:00+08:00
```
Add `ORACLE_PRIVATE_KEY=0x...` plus `--contract <address> --chain-id <id>` to get a signed report.

## Design choices (useful for the report)
- **Signed reports, not `onlyOracle`**: the oracle key never needs gas money, anyone can relay,
  and the signature binds contract address + chain id to prevent replay.
- **Take-off = wheels-off** (`actual_runway` / OpenSky `firstSeen`), not gate departure.
- **24h sale cutoff** stops people buying after they already know about a delay.
- **Schedule check**: the oracle reports the real schedule; if the buyer's schedule is off by >1h
  the policy is voided and refunded.
- **Solvency**: a policy can only be sold if the pool covers every open payout.
- **No report within 3 days** → premium refunded, so funds are never stuck.

## Known limits (the "why decentralize" argument)
- One trusted signer: if the key is stolen or the operator lies, the contract can't tell.
- One data source: if the API is wrong, the report is wrong.
- OpenSky lacks schedules and "not found" ≠ cancelled (ADS-B coverage gaps).
- AviationStack free tier is HTTP-only; times are airport-local and need time-zone handling.
Next step: replace `oracle.py` with Chainlink Functions querying 2+ providers.
