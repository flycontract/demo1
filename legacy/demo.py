"""
End-to-end demo on an in-process blockchain (no wallet, no testnet, no ETH needed).

  1. compile + deploy the contract
  2. insurer funds the pool
  3. three travellers buy policies (delayed / on-time / cancelled flights)
  4. time passes, the oracle fetches take-off data, signs it, submits it
  5. each policy is settled and balances are printed

Run:  python demo.py
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import solcx
from eth_account import Account
from eth_tester import EthereumTester
from web3 import Web3, EthereumTesterProvider

sys.path.insert(0, str(Path(__file__).parent / "oracle"))
import oracle  # noqa: E402

ROOT = Path(__file__).parent
SOLC_VERSION = "0.8.24"


def eth(wei):
    sign = "-" if wei < 0 else ""
    return f"{sign}{Web3.from_wei(abs(wei), 'ether'):.4f} ETH"


def compile_contract():
    # Use the precompiled artifact if it exists; otherwise compile from source with solc.
    artifact = ROOT / "build/FlightDelayInsurance.json"
    if artifact.exists() and artifact.stat().st_mtime >= (ROOT / "contracts/FlightDelayInsurance.sol").stat().st_mtime:
        data = json.loads(artifact.read_text())
        return data["abi"], data["bin"]
    solcx.install_solc(SOLC_VERSION)
    out = solcx.compile_files(
        [str(ROOT / "contracts/FlightDelayInsurance.sol")],
        output_values=["abi", "bin"], solc_version=SOLC_VERSION, evm_version="paris",
    )
    (c,) = [v for k, v in out.items() if k.endswith(":FlightDelayInsurance")]
    return c["abi"], c["bin"]


def main():
    tester = EthereumTester()
    w3 = Web3(EthereumTesterProvider(tester))
    insurer, alice, bob, carol, relayer = w3.eth.accounts[:5]

    # The oracle has its own signing key. It never needs ETH: anyone can relay its signature.
    oracle_key = Account.create()
    print(f"Oracle signer address: {oracle_key.address}\n")

    abi, bytecode = compile_contract()
    tx = w3.eth.contract(abi=abi, bytecode=bytecode).constructor(oracle_key.address).transact({"from": insurer})
    addr = w3.eth.wait_for_transaction_receipt(tx).contractAddress
    c = w3.eth.contract(address=addr, abi=abi)
    print(f"Contract deployed at {addr}")

    c.functions.fundPool().transact({"from": insurer, "value": Web3.to_wei(5, "ether")})
    print(f"Insurer funded pool: {eth(w3.eth.get_balance(addr))}\n")

    # Flights depart 3 days from "now" on the test chain
    now = w3.eth.get_block("latest")["timestamp"]
    sched = now + 3 * 24 * 3600
    buyers = [(alice, "CX101"), (bob, "SQ872"), (carol, "MU502")]
    premium = Web3.to_wei(0.05, "ether")

    start_bal = {}
    for who, flight in buyers:
        start_bal[who] = w3.eth.get_balance(who)
        c.functions.buyPolicy(flight, sched).transact({"from": who, "value": premium})
        print(f"{who[:8]}… bought policy on {flight}: premium {eth(premium)}, payout {eth(premium * 5)}")

    # Try buying too late (should fail: inside the 24h cutoff)
    try:
        c.functions.buyPolicy("CX101", now + 3600).transact({"from": alice, "value": premium})
    except Exception as e:
        print(f"\nLate purchase rejected as expected: {str(e).split(':')[-1].strip()}")

    # Jump the chain clock past departure
    tester.time_travel(sched + 6 * 3600)
    tester.mine_blocks(1)
    print(f"\n… time passes to {datetime.fromtimestamp(sched + 6*3600, timezone.utc):%Y-%m-%d %H:%M} UTC …\n")

    # Oracle: fetch -> sign -> relayer submits
    chain_id = w3.eth.chain_id

    # Attack check: a fake report signed by someone else must be rejected
    fake = oracle.TakeoffReport("CX101", sched, sched, sched + 5 * 3600, 1, "fake")
    forged = oracle.sign_report(fake, Account.create().key.hex(), addr, chain_id)
    try:
        oracle.submit_report(w3, c, forged, bob)
    except Exception as e:
        print(f"Forged report rejected as expected: {str(e).split(':')[-1].strip()}")

    for _, flight in buyers:
        report = oracle.fetch_mock(flight, sched, str(ROOT / "oracle/mock_flights.json"))
        signed = oracle.sign_report(report, oracle_key.key.hex(), addr, chain_id)
        oracle.submit_report(w3, c, signed, relayer)
        desc = "CANCELLED" if report.status == oracle.STATUS_CANCELLED else f"delay {report.delay_minutes} min"
        print(f"Oracle reported {flight}: {desc}")


    print()
    for pid, (who, flight) in enumerate(buyers):
        receipt = w3.eth.wait_for_transaction_receipt(c.functions.settle(pid).transact({"from": relayer}))
        ev = c.events.PolicyClosed().process_receipt(receipt)[0]["args"]
        net = w3.eth.get_balance(who) - start_bal[who]
        print(f"Policy {pid} ({flight}): {ev['reason']:<20} paid {eth(ev['amountPaid'])}  | holder net after gas {eth(net)}")

    print(f"\nPool balance at end: {eth(w3.eth.get_balance(addr))}")


if __name__ == "__main__":
    main()
