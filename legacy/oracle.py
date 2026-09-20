from __future__ import annotations

"""
Simple signing oracle for FlightDelayInsurance.

Flow:  fetch take-off data (API)  ->  build report  ->  sign with oracle key  ->  (optionally) submit on-chain

Data sources:
  mock          local JSON file, for demos and testing (no network)
  aviationstack https://aviationstack.com  (free key, has scheduled + actual runway times)
  opensky       https://opensky-network.org (free, ADS-B based; no schedule data, previous-day only)

Note: we call public flight-data APIs instead of scraping airline web pages.
Web pages change layout often, block bots, and may forbid scraping in their terms.
"""
import argparse
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

# Must match `enum Status` in the contract
STATUS_DEPARTED = 1
STATUS_CANCELLED = 2


@dataclass
class TakeoffReport:
    flight_number: str
    claimed_schedule: int   # unix seconds, what the buyer used for the policy
    oracle_schedule: int    # unix seconds, what the data source says
    actual_takeoff: int     # unix seconds, 0 if cancelled
    status: int             # 1 departed, 2 cancelled
    source: str

    @property
    def delay_minutes(self) -> int | None:
        if self.status != STATUS_DEPARTED:
            return None
        return (self.actual_takeoff - self.oracle_schedule) // 60


# --------------------------------------------------------------------------------------
# Data sources. Each returns a TakeoffReport, or None if the data is not available yet.
# --------------------------------------------------------------------------------------

def fetch_mock(flight_number: str, claimed_schedule: int, mock_file: str) -> TakeoffReport | None:
    data = json.loads(Path(mock_file).read_text())
    rec = data.get(flight_number)
    if rec is None:
        return None
    sched = int(rec.get("scheduled", claimed_schedule))
    if rec["status"] == "cancelled":
        return TakeoffReport(flight_number, claimed_schedule, sched, 0, STATUS_CANCELLED, "mock")
    actual = sched + int(rec["delay_minutes"]) * 60
    return TakeoffReport(flight_number, claimed_schedule, sched, actual, STATUS_DEPARTED, "mock")


def _aviationstack_time(value: str | None, tz_name: str | None) -> int | None:
    """AviationStack returns airport-local times labelled '+00:00'. We drop the label and
    apply the airport's real time zone. Check this against a flight you know before relying on it."""
    if not value:
        return None
    naive = datetime.fromisoformat(value).replace(tzinfo=None)
    tz = ZoneInfo(tz_name) if tz_name else timezone.utc
    return int(naive.replace(tzinfo=tz).timestamp())


def fetch_aviationstack(flight_number: str, claimed_schedule: int, api_key: str) -> TakeoffReport | None:
    # The free plan only allows plain HTTP; paid plans support HTTPS.
    resp = requests.get(
        "http://api.aviationstack.com/v1/flights",
        params={"access_key": api_key, "flight_iata": flight_number},
        timeout=20,
    )
    resp.raise_for_status()
    body = resp.json()
    if "error" in body:
        raise RuntimeError(f"AviationStack error: {body['error']}")

    # Pick the record whose scheduled departure is closest to the policy's schedule.
    best, best_gap = None, None
    for rec in body.get("data", []):
        dep = rec.get("departure") or {}
        sched = _aviationstack_time(dep.get("scheduled"), dep.get("timezone"))
        if sched is None:
            continue
        gap = abs(sched - claimed_schedule)
        if best_gap is None or gap < best_gap:
            best, best_gap = (rec, sched), gap
    if best is None or best_gap > 12 * 3600:
        return None   # this departure isn't in the results (yet)

    rec, sched = best
    dep = rec["departure"]
    if rec.get("flight_status") == "cancelled":
        return TakeoffReport(flight_number, claimed_schedule, sched, 0, STATUS_CANCELLED, "aviationstack")

    # "actual_runway" = wheels-off (take-off). Fall back to "actual" (gate departure) if missing.
    actual = _aviationstack_time(dep.get("actual_runway"), dep.get("timezone")) \
        or _aviationstack_time(dep.get("actual"), dep.get("timezone"))
    if actual is None:
        return None   # hasn't departed yet
    return TakeoffReport(flight_number, claimed_schedule, sched, actual, STATUS_DEPARTED, "aviationstack")


def fetch_opensky(flight_number: str, claimed_schedule: int, callsign: str, airport_icao: str,
                  token: str | None = None) -> TakeoffReport | None:
    """OpenSky gives 'firstSeen' (first ADS-B contact, close to wheels-off) but NOT the
    airline schedule, so we trust the buyer's schedule here. Its flight tables are built
    in nightly batches, so data usually appears the day after the flight.
    callsign is ICAO style, e.g. CX101 -> 'CPA101'. airport_icao e.g. Hong Kong = 'VHHH'."""
    begin = claimed_schedule - 2 * 3600
    end = claimed_schedule + 24 * 3600
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    resp = requests.get(
        "https://opensky-network.org/api/flights/departure",
        params={"airport": airport_icao, "begin": begin, "end": end},
        headers=headers, timeout=30,
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    for rec in resp.json():
        if (rec.get("callsign") or "").strip().upper() == callsign.upper():
            return TakeoffReport(flight_number, claimed_schedule, claimed_schedule,
                                 int(rec["firstSeen"]), STATUS_DEPARTED, "opensky")
    # Not found does NOT prove cancellation (ADS-B coverage has gaps), so report nothing.
    return None


# --------------------------------------------------------------------------------------
# Signing and submitting
# --------------------------------------------------------------------------------------

def flight_key(flight_number: str, scheduled: int) -> bytes:
    return Web3.solidity_keccak(["string", "uint256"], [flight_number, scheduled])


def sign_report(report: TakeoffReport, private_key: str, contract_address: str, chain_id: int) -> dict:
    key = flight_key(report.flight_number, report.claimed_schedule)
    msg_hash = Web3.solidity_keccak(
        ["address", "uint256", "bytes32", "uint256", "uint256", "uint8"],
        [Web3.to_checksum_address(contract_address), chain_id, key,
         report.oracle_schedule, report.actual_takeoff, report.status],
    )
    signed = Account.sign_message(encode_defunct(primitive=msg_hash), private_key=private_key)
    return {
        "flightKey": "0x" + key.hex().removeprefix("0x"),
        "oracleSchedule": report.oracle_schedule,
        "actualTakeoff": report.actual_takeoff,
        "status": report.status,
        "signature": "0x" + signed.signature.hex().removeprefix("0x"),
        "signer": Account.from_key(private_key).address,
    }


def submit_report(w3: Web3, contract, signed: dict, sender: str):
    tx = contract.functions.reportTakeoff(
        signed["flightKey"], signed["oracleSchedule"], signed["actualTakeoff"],
        signed["status"], signed["signature"],
    ).transact({"from": sender})
    return w3.eth.wait_for_transaction_receipt(tx)


def fetch(source: str, flight: str, scheduled: int, args) -> TakeoffReport | None:
    if source == "mock":
        return fetch_mock(flight, scheduled, args.mock_file)
    if source == "aviationstack":
        return fetch_aviationstack(flight, scheduled, os.environ["AVIATIONSTACK_KEY"])
    if source == "opensky":
        return fetch_opensky(flight, scheduled, args.callsign, args.airport, os.environ.get("OPENSKY_TOKEN"))
    raise ValueError(source)


def main():
    p = argparse.ArgumentParser(description="Fetch take-off data and produce a signed oracle report")
    p.add_argument("--source", choices=["mock", "aviationstack", "opensky"], default="mock")
    p.add_argument("--flight", required=True, help="IATA flight number, e.g. CX101")
    p.add_argument("--scheduled", required=True, help="scheduled departure, ISO-8601 with zone, e.g. 2026-09-25T09:00+08:00")
    p.add_argument("--mock-file", default=str(Path(__file__).with_name("mock_flights.json")))
    p.add_argument("--callsign", help="OpenSky only: ICAO callsign, e.g. CPA101")
    p.add_argument("--airport", help="OpenSky only: departure airport ICAO code, e.g. VHHH")
    p.add_argument("--contract", default="0x0000000000000000000000000000000000000000")
    p.add_argument("--chain-id", type=int, default=11155111, help="default: Sepolia")
    args = p.parse_args()

    scheduled = int(datetime.fromisoformat(args.scheduled).timestamp())
    report = fetch(args.source, args.flight, scheduled, args)
    if report is None:
        print("No take-off data available yet. Try again later.")
        return

    print(f"Source: {report.source}")
    print(f"Scheduled: {datetime.fromtimestamp(report.oracle_schedule, timezone.utc):%Y-%m-%d %H:%M} UTC")
    if report.status == STATUS_CANCELLED:
        print("Status: CANCELLED")
    else:
        print(f"Take-off:  {datetime.fromtimestamp(report.actual_takeoff, timezone.utc):%Y-%m-%d %H:%M} UTC"
              f"  (delay {report.delay_minutes} min)")

    pk = os.environ.get("ORACLE_PRIVATE_KEY")
    if pk:
        print(json.dumps(sign_report(report, pk, args.contract, args.chain_id), indent=2))
    else:
        print("(Set ORACLE_PRIVATE_KEY to also output a signed report.)")


if __name__ == "__main__":
    main()
