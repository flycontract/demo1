"""
Contract-level acceptance tests for DemoToken + FlightDelayInsurance, covering
the checks in PRD §8 that are the smart contract's responsibility (parsing of
HKIA's raw JSON — cross-day formats, codeshare arrays, missing statusCode — is
the oracle's job and is covered separately in oracle/src/parse.test.ts, which
needs Node.js to run and is not exercised here).

Run:  .venv/bin/python test_python/run_tests.py
"""
from __future__ import annotations

import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import (  # noqa: E402
    Chain, PREMIUM, PAYOUT, WARNING_LINE, SALE_CUTOFF,
    DELAY_THRESHOLD_MIN, REPORT_TIMEOUT, INITIAL_POOL_FUND,
)

PASS = []
FAIL = []


def check(name, fn):
    try:
        fn()
        PASS.append(name)
        print(f"  PASS  {name}")
    except AssertionError as e:
        FAIL.append((name, str(e)))
        print(f"  FAIL  {name}: {e}")
    except Exception as e:
        FAIL.append((name, f"{type(e).__name__}: {e}"))
        print(f"  ERROR {name}: {type(e).__name__}: {e}")
        traceback.print_exc()


def expect_revert(fn, needle: str | None = None):
    try:
        fn()
    except Exception as e:
        if needle and needle not in str(e):
            raise AssertionError(f"reverted, but not with {needle!r}: {e}")
        return
    raise AssertionError("expected revert, but call succeeded")


# --------------------------------------------------------------------------
# 1. Buying: premium/reserve accounting, and every rejection path
# --------------------------------------------------------------------------

def test_buy_debits_premium_and_reserves_payout():
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)
    buyer = c.users[0]
    bal_before = c.balance()
    c.buy_policy(buyer, fid)
    assert c.balance() == bal_before + PREMIUM
    assert c.reserved() == PAYOUT
    assert c.token.functions.balanceOf(buyer).call() == 0


def test_buy_rejected_after_sale_cutoff():
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3600)  # < 24h away
    expect_revert(lambda: c.buy_policy(c.users[0], fid), "sale cutoff")


def test_buy_rejected_on_duplicate_wallet_same_flight():
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)
    buyer = c.users[0]
    c.buy_policy(buyer, fid)
    expect_revert(lambda: c.buy_policy(buyer, fid), "already insured")


def test_buy_allowed_different_wallets_same_flight():
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)
    c.buy_policy(c.users[0], fid)
    c.buy_policy(c.users[1], fid)  # must not revert
    assert c.reserved() == 2 * PAYOUT


def test_buy_rejected_when_flight_not_sellable():
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600, sellable=False)
    expect_revert(lambda: c.buy_policy(c.users[0], fid), "not sellable")


def test_buy_rejected_below_warning_line():
    c = Chain()
    c.fund_pool(WARNING_LINE - 1)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)
    expect_revert(lambda: c.buy_policy(c.users[0], fid), "warning line")


def test_buy_rejected_when_pool_cannot_cover_payout():
    # Each purchase shrinks the margin (balance - reserved) by PAYOUT - PREMIUM
    # = 90. With the floor fixed at 8,000, that margin only runs out after
    # roughly 87 simultaneously open policies -- so reaching the "coverage"
    # rejection (as opposed to the warning-line one) means opening that many.
    c = Chain()
    c.fund_pool(WARNING_LINE)  # minimum floor, no extra headroom
    buyer = c.users[0]
    bought = 0
    try:
        for i in range(200):
            fid = c.register_flight(f"TEST {i}", "XXX", c.now() + 3 * 24 * 3600)
            c.buy_policy(buyer, fid)
            bought += 1
        raise AssertionError("expected a 'cannot cover' revert but 200 purchases all succeeded")
    except AssertionError:
        raise
    except Exception as e:
        assert "cannot cover" in str(e), str(e)
    assert bought >= 80, f"expected the pool to sustain ~87 open policies, only reached {bought}"


# --------------------------------------------------------------------------
# 2. Settlement boundaries: 119/120 min, early arrival, cancellation
# --------------------------------------------------------------------------

def _settle_via_request(c: Chain, delay_minutes: int | None, cancelled: bool = False):
    """Registers one flight, buys one policy, time-travels past arrival, and
    fulfils with the given outcome. Returns the PolicySettled event args."""
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)
    buyer = c.users[0]
    pid = c.buy_policy(buyer, fid)
    sched = c.insurance.functions.flights(fid).call()[2]
    c.time_travel(sched + 3600)
    receipt = c.request_verification(buyer, pid)
    req_id = c.request_id_of(receipt)
    actual = 0 if cancelled else sched + (delay_minutes or 0) * 60
    fulfill_receipt = c.fulfill(req_id, cancelled, actual, delay_minutes or 0)
    return c.insurance.events.PolicySettled().process_receipt(fulfill_receipt)[0]["args"]


def test_settle_119_minutes_no_payout():
    ev = _settle_via_request_delay(119)
    assert ev["amountPaid"] == 0, ev


def _settle_via_request_delay(minutes):
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    return _settle_via_request(c, minutes)


def test_settle_120_minutes_pays_out():
    ev = _settle_via_request_delay(120)
    assert ev["amountPaid"] == PAYOUT, ev


def test_settle_early_arrival_no_payout():
    ev = _settle_via_request_delay(0)
    assert ev["amountPaid"] == 0, ev


def test_settle_cancelled_pays_out():
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    ev = _settle_via_request(c, None, cancelled=True)
    assert ev["amountPaid"] == PAYOUT, ev


def test_reserved_payouts_released_after_settlement():
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    ev = _settle_via_request(c, 120)
    assert ev["amountPaid"] == PAYOUT
    assert c.reserved() == 0


# --------------------------------------------------------------------------
# 3. Ambiguous / not-yet-final data must never auto-settle
# --------------------------------------------------------------------------

def test_unfulfilled_request_stays_verifying_not_auto_settled():
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)
    buyer = c.users[0]
    pid = c.buy_policy(buyer, fid)
    sched = c.insurance.functions.flights(fid).call()[2]
    c.time_travel(sched + 3600)
    c.request_verification(buyer, pid)
    holder, flight_id, request_id, status = c.policy(pid)
    assert status == 1  # Verifying
    # No payout must have happened; token balance for the holder is still 0.
    assert c.token.functions.balanceOf(buyer).call() == 0


# --------------------------------------------------------------------------
# 4. Fault handling: duplicate fulfil, late fulfil after refund, refund
#    before/after timeout, refund blocked once a final result exists
# --------------------------------------------------------------------------

def test_duplicate_fulfil_same_request_rejected():
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)
    buyer = c.users[0]
    pid = c.buy_policy(buyer, fid)
    sched = c.insurance.functions.flights(fid).call()[2]
    c.time_travel(sched + 3600)
    receipt = c.request_verification(buyer, pid)
    req_id = c.request_id_of(receipt)
    c.fulfill(req_id, False, sched + 130 * 60, 130)
    expect_revert(lambda: c.fulfill(req_id, False, sched + 130 * 60, 130), "already fulfilled")


def test_only_oracle_can_fulfil():
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)
    buyer = c.users[0]
    pid = c.buy_policy(buyer, fid)
    sched = c.insurance.functions.flights(fid).call()[2]
    c.time_travel(sched + 3600)
    receipt = c.request_verification(buyer, pid)
    req_id = c.request_id_of(receipt)

    def fulfil_as_stranger():
        c.w3.eth.wait_for_transaction_receipt(
            c.insurance.functions.fulfillVerification(req_id, False, sched, 0, "2026-09-21", b"\x00" * 32)
            .transact({"from": c.users[1]})
        )
    expect_revert(fulfil_as_stranger, "not oracle")


def test_refund_rejected_before_timeout():
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)
    buyer = c.users[0]
    pid = c.buy_policy(buyer, fid)
    expect_revert(lambda: c.refund_unresolved(buyer, pid), "not past report timeout")


def test_refund_allowed_after_timeout_and_returns_premium():
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)
    buyer = c.users[0]
    pid = c.buy_policy(buyer, fid)
    sched = c.insurance.functions.flights(fid).call()[2]
    c.time_travel(sched + REPORT_TIMEOUT + 1)
    c.refund_unresolved(buyer, pid)
    assert c.token.functions.balanceOf(buyer).call() == PREMIUM
    assert c.reserved() == 0
    holder, flight_id, request_id, status = c.policy(pid)
    assert status == 4  # Refunded


def test_refund_blocked_once_final_result_exists_even_past_timeout():
    # A's own request gets fulfilled (which also settles A immediately). B never
    # requested verification, so B's policy is still nominally "Active" when the
    # 7-day deadline passes -- but a final result already exists for the flight,
    # so B must go through settlePolicy, not walk away with a refund.
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)
    a, b = c.users[0], c.users[1]
    pid_a = c.buy_policy(a, fid)
    pid_b = c.buy_policy(b, fid)
    sched = c.insurance.functions.flights(fid).call()[2]
    c.time_travel(sched + 3600)
    receipt = c.request_verification(a, pid_a)
    req_id = c.request_id_of(receipt)
    c.time_travel(sched + REPORT_TIMEOUT + 1)
    c.fulfill(req_id, False, sched + 130 * 60, 130)  # late, but settles A and caches the result
    expect_revert(lambda: c.refund_unresolved(b, pid_b), "use settlePolicy")
    c.settle_policy(b, pid_b)
    assert c.token.functions.balanceOf(b).call() == PAYOUT


def test_late_fulfil_after_refund_does_not_double_pay():
    # Two buyers on the same flight: buyer A requests verification (oracle never
    # answers in time), buyer A refunds after the timeout. The oracle's answer
    # then lands late for A's request — it must record the flight result (so
    # buyer B can still settle) without re-paying or reverting on A's policy.
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)
    a, b = c.users[0], c.users[1]
    pid_a = c.buy_policy(a, fid)
    pid_b = c.buy_policy(b, fid)
    sched = c.insurance.functions.flights(fid).call()[2]
    c.time_travel(sched + 3600)
    receipt = c.request_verification(a, pid_a)
    req_id = c.request_id_of(receipt)

    c.time_travel(sched + REPORT_TIMEOUT + 1)
    c.refund_unresolved(a, pid_a)
    assert c.token.functions.balanceOf(a).call() == PREMIUM

    fulfil_receipt = c.fulfill(req_id, False, sched + 130 * 60, 130)
    settled_events = c.insurance.events.PolicySettled().process_receipt(fulfil_receipt)
    assert len(settled_events) == 0, "the already-refunded policy must not be settled again"

    # Flight result is now cached; buyer B settles independently and gets paid.
    c.settle_policy(b, pid_b)
    assert c.token.functions.balanceOf(b).call() == PAYOUT


# --------------------------------------------------------------------------
# 5. Multiple users on one flight settle independently; warning line still
#    honours existing policies; withdrawal cannot eat into reserves
# --------------------------------------------------------------------------

def test_multiple_holders_same_flight_settle_independently():
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)
    a, b, d = c.users[0], c.users[1], c.users[2]
    pid_a, pid_b, pid_d = c.buy_policy(a, fid), c.buy_policy(b, fid), c.buy_policy(d, fid)
    sched = c.insurance.functions.flights(fid).call()[2]
    c.time_travel(sched + 3600)
    receipt = c.request_verification(a, pid_a)  # only A triggers the oracle
    req_id = c.request_id_of(receipt)
    c.fulfill(req_id, False, sched + 150 * 60, 150)  # delayed -> payout

    c.settle_policy(b, pid_b)
    c.settle_policy(d, pid_d)
    for holder in (a, b, d):
        assert c.token.functions.balanceOf(holder).call() == PAYOUT


def test_balance_below_warning_line_still_honours_existing_policy():
    c = Chain()
    c.fund_pool(8_050)  # just enough headroom that one payout pushes it under 8,000
    fid_a = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)   # will be cancelled
    fid_b = c.register_flight("SQ 872", "SIN", c.now() + 3 * 24 * 3600)  # bought before the drain
    a, b, newcomer = c.users[0], c.users[1], c.users[2]

    pid_a = c.buy_policy(a, fid_a)
    pid_b = c.buy_policy(b, fid_b)
    sched_a = c.insurance.functions.flights(fid_a).call()[2]
    sched_b = c.insurance.functions.flights(fid_b).call()[2]
    c.time_travel(sched_a + 3600)

    receipt = c.request_verification(a, pid_a)
    c.fulfill(c.request_id_of(receipt), True, 0, 0)  # cancelled -> payout, drains pool under the line
    assert c.balance() < WARNING_LINE

    # New sales are blocked while the pool sits under the warning line (register
    # the flight now so its cutoff is relative to the post-time-travel clock)...
    fid_c = c.register_flight("MU 502", "PVG", c.now() + 3 * 24 * 3600)
    expect_revert(lambda: c.buy_policy(newcomer, fid_c), "warning line")

    # ...but B's pre-existing policy, bought before the drain, still settles in full.
    receipt = c.request_verification(b, pid_b)
    c.fulfill(c.request_id_of(receipt), False, sched_b + 150 * 60, 150)
    assert c.token.functions.balanceOf(b).call() == PAYOUT


def test_withdraw_cannot_breach_warning_line_or_reserves():
    c = Chain()
    c.fund_pool(INITIAL_POOL_FUND)
    fid = c.register_flight("CX 750", "BKK", c.now() + 3 * 24 * 3600)
    c.buy_policy(c.users[0], fid)  # reserves 100
    balance = c.balance()
    reserved = c.reserved()
    max_withdraw = balance - max(WARNING_LINE, reserved)
    assert max_withdraw == balance - WARNING_LINE  # warning line is the binding constraint here

    expect_revert(
        lambda: c.w3.eth.wait_for_transaction_receipt(
            c.insurance.functions.withdrawSurplus(max_withdraw + 1).transact({"from": c.insurer})
        ),
        "warning line",
    )
    c.w3.eth.wait_for_transaction_receipt(
        c.insurance.functions.withdrawSurplus(max_withdraw).transact({"from": c.insurer})
    )
    assert c.balance() == WARNING_LINE


def test_withdraw_blocked_by_reserves_even_above_warning_line():
    # WARNING_LINE (8,000) dwarfs a single PAYOUT (100), so with only a handful
    # of open policies the warning line is always the tighter constraint. To
    # isolate the "reserved payouts" constraint we need reserved > 8,000, i.e.
    # more than 80 simultaneously open policies.
    c = Chain()
    c.fund_pool(WARNING_LINE + 200)  # headroom for ~81 open policies before "cannot cover"
    buyer = c.users[0]
    for i in range(81):
        fid = c.register_flight(f"TEST {i}", "XXX", c.now() + 3 * 24 * 3600)
        c.buy_policy(buyer, fid)

    balance = c.balance()
    reserved = c.reserved()
    assert reserved > WARNING_LINE, f"expected reserved > warning line, got {reserved}"
    room_above_reserved = balance - reserved

    expect_revert(
        lambda: c.w3.eth.wait_for_transaction_receipt(
            c.insurance.functions.withdrawSurplus(room_above_reserved + 1).transact({"from": c.insurer})
        ),
        "breaches reserved payouts",
    )
    c.w3.eth.wait_for_transaction_receipt(
        c.insurance.functions.withdrawSurplus(room_above_reserved).transact({"from": c.insurer})
    )
    assert c.balance() == reserved


# --------------------------------------------------------------------------
# 6. Token faucet sanity
# --------------------------------------------------------------------------

def test_faucet_grants_tokens_once_per_cooldown():
    c = Chain()
    claimant = c.users[0]
    c.token.functions.faucet().transact({"from": claimant})
    assert c.token.functions.balanceOf(claimant).call() == 200
    expect_revert(lambda: c.token.functions.faucet().transact({"from": claimant}), "cooldown")


ALL_TESTS = [
    test_buy_debits_premium_and_reserves_payout,
    test_buy_rejected_after_sale_cutoff,
    test_buy_rejected_on_duplicate_wallet_same_flight,
    test_buy_allowed_different_wallets_same_flight,
    test_buy_rejected_when_flight_not_sellable,
    test_buy_rejected_below_warning_line,
    test_buy_rejected_when_pool_cannot_cover_payout,
    test_settle_119_minutes_no_payout,
    test_settle_120_minutes_pays_out,
    test_settle_early_arrival_no_payout,
    test_settle_cancelled_pays_out,
    test_reserved_payouts_released_after_settlement,
    test_unfulfilled_request_stays_verifying_not_auto_settled,
    test_duplicate_fulfil_same_request_rejected,
    test_only_oracle_can_fulfil,
    test_refund_rejected_before_timeout,
    test_refund_allowed_after_timeout_and_returns_premium,
    test_refund_blocked_once_final_result_exists_even_past_timeout,
    test_late_fulfil_after_refund_does_not_double_pay,
    test_multiple_holders_same_flight_settle_independently,
    test_balance_below_warning_line_still_honours_existing_policy,
    test_withdraw_cannot_breach_warning_line_or_reserves,
    test_withdraw_blocked_by_reserves_even_above_warning_line,
    test_faucet_grants_tokens_once_per_cooldown,
]


def main():
    print(f"Running {len(ALL_TESTS)} contract acceptance tests...\n")
    for t in ALL_TESTS:
        check(t.__name__, t)
    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        sys.exit(1)


if __name__ == "__main__":
    main()
