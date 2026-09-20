"""
Readable end-to-end run on an in-process chain: three travellers buy policies
on three flights (delayed / on-time / cancelled), the oracle account reports
each outcome, and every policy settles. No wallet, no testnet, no Node.js.

This is a *simulation* of the real flow (PRD §8 "独立模拟环境"): the "oracle"
step here just calls fulfillVerification directly with hand-picked outcomes,
standing in for oracle/src/index.ts actually fetching and parsing the Hong
Kong Airport API. It demonstrates the contract logic end-to-end; it does not
demonstrate a real pre-departure purchase against real HKIA data (PRD §8
"未来航班完整流程" -- that requires the deployed contract + the Node oracle
service + Sepolia, and is out of scope for this in-process script).

Run:  .venv/bin/python test_python/demo.py
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import Chain, PREMIUM, PAYOUT, INITIAL_POOL_FUND  # noqa: E402


def fmt(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def main():
    c = Chain()
    print(f"DemoToken deployed at   {c.token.address}")
    print(f"Insurance deployed at   {c.insurance.address}")
    print(f"Insurer account         {c.insurer}")
    print(f"Oracle account          {c.oracle}\n")

    c.fund_pool(INITIAL_POOL_FUND)
    print(f"Insurer funded pool with {INITIAL_POOL_FUND} FDT "
          f"(pool balance: {c.balance()} FDT)\n")

    sched = c.now() + 3 * 24 * 3600
    print(f"Registering 3 flights, all scheduled to arrive {fmt(sched)}...")
    flights = {
        "CX 750 (delayed 155 min)": c.register_flight("CX 750", "BKK", sched),
        "SQ 872 (on time, 12 min late)": c.register_flight("SQ 872", "SIN", sched),
        "MU 502 (cancelled)": c.register_flight("MU 502", "PVG", sched),
    }
    for label, fid in flights.items():
        print(f"  flightId={fid}  {label}")

    print("\n3 travellers buy policies (premium 10, payout on trigger 100)...")
    holders = c.users[:3]
    policy_ids = {}
    for holder, (label, fid) in zip(holders, flights.items()):
        pid = c.buy_policy(holder, fid)
        policy_ids[label] = (holder, fid, pid)
        print(f"  {holder[:10]}... bought policy {pid} on {label}")

    # Buying again on an already-covered flight, or after the sale cutoff, is
    # rejected -- both checks happen before any token is touched, so these
    # calls are made directly (not via the mint-then-buy test helper).
    def raw_buy(holder, fid):
        c.w3.eth.wait_for_transaction_receipt(
            c.insurance.functions.buyPolicy(fid).transact({"from": holder})
        )

    try:
        raw_buy(holders[0], flights["CX 750 (delayed 155 min)"])
    except Exception as e:
        print(f"\nDuplicate purchase rejected as expected: {str(e).splitlines()[-1]}")
    try:
        late_fid = c.register_flight("LATE 1", "XXX", c.now() + 3600)
        raw_buy(holders[0], late_fid)
    except Exception as e:
        print(f"Late purchase rejected as expected: {str(e).splitlines()[-1]}")

    print(f"\n... time passes to {fmt(sched + 6 * 3600)} ...\n")
    c.time_travel(sched + 6 * 3600)

    outcomes = {
        "CX 750 (delayed 155 min)": dict(cancelled=False, delay_minutes=155),
        "SQ 872 (on time, 12 min late)": dict(cancelled=False, delay_minutes=12),
        "MU 502 (cancelled)": dict(cancelled=True, delay_minutes=0),
    }

    print("Oracle reports each flight's final result (simulated, see module docstring)...")
    for label, (holder, fid, pid) in policy_ids.items():
        receipt = c.request_verification(holder, pid)
        req_id = c.request_id_of(receipt)
        outcome = outcomes[label]
        actual = 0 if outcome["cancelled"] else sched + outcome["delay_minutes"] * 60
        fulfil_receipt = c.fulfill(req_id, outcome["cancelled"], actual, outcome["delay_minutes"])
        settled = c.insurance.events.PolicySettled().process_receipt(fulfil_receipt)[0]["args"]
        print(f"  {label}: {settled['reason']}, paid {settled['amountPaid']} FDT")

    print(f"\nFinal balances:")
    for label, (holder, fid, pid) in policy_ids.items():
        print(f"  {holder[:10]}... ({label.split(' (')[0]}): {c.token.functions.balanceOf(holder).call()} FDT")
    print(f"\nPool balance at end: {c.balance()} FDT (reserved: {c.reserved()} FDT)")


if __name__ == "__main__":
    main()
