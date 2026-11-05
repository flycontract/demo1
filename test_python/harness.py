"""
Shared setup for exercising DemoToken + FlightDelayInsurance on an in-process
chain (eth-tester), without needing Node.js/Hardhat. Solidity is compiled with
py-solc-x. Used by run_tests.py (acceptance checks) and demo.py (readable e2e run).
"""
from __future__ import annotations

import json
from pathlib import Path

import solcx
from web3 import Web3, EthereumTesterProvider
from eth_tester import EthereumTester

ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = ROOT / "contracts"
SOLC_VERSION = "0.8.24"

# Contract constants (must mirror contracts/FlightDelayInsurance.sol)
PREMIUM = 10
PAYOUT = 100
WARNING_LINE = 8_000
SALE_CUTOFF = 24 * 3600
DELAY_THRESHOLD_MIN = 120
REPORT_TIMEOUT = 7 * 24 * 3600
INITIAL_POOL_FUND = 10_000


def compile_all():
    solcx.install_solc(SOLC_VERSION, show_progress=False)
    out = solcx.compile_files(
        [str(CONTRACTS / "DemoToken.sol"), str(CONTRACTS / "FlightDelayInsurance.sol")],
        output_values=["abi", "bin"],
        solc_version=SOLC_VERSION,
        evm_version="paris",
    )
    token = next(v for k, v in out.items() if k.endswith(":DemoToken"))
    insurance = next(v for k, v in out.items() if k.endswith(":FlightDelayInsurance"))
    return token, insurance


class Chain:
    """A deployed DemoToken + FlightDelayInsurance pair plus convenience helpers."""

    def __init__(self):
        self.tester = EthereumTester()
        self.w3 = Web3(EthereumTesterProvider(self.tester))
        accounts = self.w3.eth.accounts
        self.insurer = accounts[0]
        self.oracle = accounts[1]
        self.users = accounts[2:]

        token_art, insurance_art = compile_all()
        self.token_abi, token_bin = token_art["abi"], token_art["bin"]
        self.insurance_abi, insurance_bin = insurance_art["abi"], insurance_art["bin"]

        tx = self.w3.eth.contract(abi=self.token_abi, bytecode=token_bin) \
            .constructor(0).transact({"from": self.insurer})
        token_addr = self.w3.eth.wait_for_transaction_receipt(tx).contractAddress
        self.token = self.w3.eth.contract(address=token_addr, abi=self.token_abi)

        tx = self.w3.eth.contract(abi=self.insurance_abi, bytecode=insurance_bin) \
            .constructor(token_addr, self.oracle).transact({"from": self.insurer})
        insurance_addr = self.w3.eth.wait_for_transaction_receipt(tx).contractAddress
        self.insurance = self.w3.eth.contract(address=insurance_addr, abi=self.insurance_abi)

    def now(self) -> int:
        return self.w3.eth.get_block("latest")["timestamp"]

    def time_travel(self, to_timestamp: int):
        self.tester.time_travel(to_timestamp)
        self.tester.mine_blocks(1)

    def mint(self, to: str, amount: int):
        self.token.functions.mint(to, amount).transact({"from": self.insurer})

    def fund_pool(self, amount: int):
        self.mint(self.insurer, amount)
        self.token.functions.approve(self.insurance.address, amount).transact({"from": self.insurer})
        self.insurance.functions.fundPool(amount).transact({"from": self.insurer})

    def register_flight(self, flight_no: str, origin: str, scheduled_arrival: int, sellable: bool = True) -> int:
        receipt = self.w3.eth.wait_for_transaction_receipt(
            self.insurance.functions.registerFlight(flight_no, origin, scheduled_arrival, sellable)
            .transact({"from": self.insurer})
        )
        ev = self.insurance.events.FlightRegistered().process_receipt(receipt)[0]["args"]
        return ev["flightId"]

    def buy_policy(self, buyer: str, flight_id: int) -> int:
        self.mint(buyer, PREMIUM)
        self.token.functions.approve(self.insurance.address, PREMIUM).transact({"from": buyer})
        receipt = self.w3.eth.wait_for_transaction_receipt(
            self.insurance.functions.buyPolicy(flight_id).transact({"from": buyer})
        )
        ev = self.insurance.events.PolicyBought().process_receipt(receipt)[0]["args"]
        return ev["policyId"]

    def request_verification(self, caller: str, policy_id: int):
        return self.w3.eth.wait_for_transaction_receipt(
            self.insurance.functions.requestVerification(policy_id).transact({"from": caller})
        )

    def fulfill(self, request_id: int, cancelled: bool, actual_arrival: int, delay_minutes: int,
                data_date: str = "2026-09-21", evidence_hash: bytes | None = None):
        evidence_hash = evidence_hash or Web3.keccak(text=f"req-{request_id}")
        return self.w3.eth.wait_for_transaction_receipt(
            self.insurance.functions.fulfillVerification(
                request_id, cancelled, actual_arrival, delay_minutes, data_date, evidence_hash
            ).transact({"from": self.oracle})
        )

    def settle_policy(self, caller: str, policy_id: int):
        return self.w3.eth.wait_for_transaction_receipt(
            self.insurance.functions.settlePolicy(policy_id).transact({"from": caller})
        )

    def refund_unresolved(self, caller: str, policy_id: int):
        return self.w3.eth.wait_for_transaction_receipt(
            self.insurance.functions.refundUnresolved(policy_id).transact({"from": caller})
        )

    def request_id_of(self, receipt) -> int:
        ev = self.insurance.events.VerificationRequested().process_receipt(receipt)[0]["args"]
        return ev["requestId"]

    def policy(self, policy_id: int):
        return self.insurance.functions.policies(policy_id).call()

    def balance(self) -> int:
        return self.token.functions.balanceOf(self.insurance.address).call()

    def reserved(self) -> int:
        return self.insurance.functions.reservedPayouts().call()
