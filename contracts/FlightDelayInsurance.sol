// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title FlightDelayInsurance
/// @notice Parametric insurance for passenger flights arriving at Hong Kong
///         International Airport. Flights are pre-registered by the insurer
///         from officially-checked schedule data (see PRD "COMP7610 航班延误保险
///         DApp" v1.1 §7). A single trusted off-chain oracle account reports the
///         final HKIA "At gate" arrival time or cancellation; this contract only
///         compares that result against the fixed threshold and settles.
/// @dev    Course demo only: single trusted oracle signer, single trusted
///         insurer, no audits. Amounts are whole DemoToken units (0 decimals).
contract FlightDelayInsurance {
    // ---------------- configuration ----------------
    IERC20  public immutable token;
    address public immutable insurer;
    address public oracle;

    uint256 public constant PREMIUM            = 10;
    uint256 public constant PAYOUT              = 100;
    uint256 public constant WARNING_LINE        = 8_000;   // stop new sales below this balance
    uint256 public constant SALE_CUTOFF         = 24 hours; // no sales within 24h of scheduled arrival
    uint256 public constant DELAY_THRESHOLD_MIN = 120;       // arrival delay >= this pays out
    uint256 public constant REPORT_TIMEOUT      = 7 days;    // refund if no final result by then

    bool public paused;

    enum PolicyStatus { Active, Verifying, PaidOut, ClosedNoPay, Refunded }

    struct Flight {
        string  flightNo;          // e.g. "CX 750"
        string  origin;            // origin airport, e.g. "BKK"
        uint256 scheduledArrival;  // trusted plan time (unix seconds, UTC), fixed at registration
        bool    sellable;          // insurer toggles off if data is incomplete/wrong
        bool    exists;
    }

    struct Policy {
        address holder;
        uint256 flightId;
        uint256 requestId;   // 0 until requestVerification is called
        PolicyStatus status;
    }

    struct FlightResult {
        bool    isFinal;
        bool    cancelled;
        uint256 actualArrival;   // unix seconds UTC; 0 if cancelled
        uint256 delayMinutes;    // 0 if cancelled or not delayed
        string  dataDate;        // HKIA record date the result came from, e.g. "2026-09-20"
        bytes32 evidenceHash;    // hash of the raw matched record, for audit only
    }

    struct VerificationRequest {
        uint256 flightId;
        uint256 policyId;
        bool    exists;
        bool    fulfilled;
    }

    uint256 public flightCount;
    mapping(uint256 => Flight) public flights;

    Policy[] public policies;
    mapping(uint256 => mapping(address => bool)) public hasPolicyForFlight; // flightId => holder => bool

    mapping(uint256 => FlightResult) public flightResults; // flightId => result

    uint256 public requestCount;
    mapping(uint256 => VerificationRequest) public verificationRequests;

    uint256 public reservedPayouts; // R: sum of PAYOUT for every open (non-final) policy

    // ---------------- events ----------------
    event PoolFunded(address indexed from, uint256 amount);
    event SurplusWithdrawn(address indexed to, uint256 amount);
    event FlightRegistered(uint256 indexed flightId, string flightNo, string origin, uint256 scheduledArrival, bool sellable);
    event FlightSellableChanged(uint256 indexed flightId, bool sellable);
    event PolicyBought(uint256 indexed policyId, address indexed holder, uint256 indexed flightId);
    event VerificationRequested(uint256 indexed requestId, uint256 indexed flightId, uint256 indexed policyId, uint256 scheduledArrival);
    event FlightResultRecorded(uint256 indexed flightId, bool cancelled, uint256 actualArrival, uint256 delayMinutes, string dataDate, bytes32 evidenceHash);
    event PolicySettled(uint256 indexed policyId, address indexed holder, uint256 amountPaid, string reason);
    event PolicyRefunded(uint256 indexed policyId, address indexed holder, uint256 amount);

    modifier onlyInsurer() {
        require(msg.sender == insurer, "not insurer");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle, "not oracle");
        _;
    }

    constructor(address tokenAddress, address oracleAddress) {
        token = IERC20(tokenAddress);
        insurer = msg.sender;
        oracle = oracleAddress;
    }

    // ---------------- insurer administration ----------------

    function setOracle(address newOracle) external onlyInsurer {
        oracle = newOracle;
    }

    function pause() external onlyInsurer { paused = true; }
    function unpause() external onlyInsurer { paused = false; }

    /// @notice Insurer tops up the underwriting pool. Caller must approve() first.
    function fundPool(uint256 amount) external onlyInsurer {
        require(token.transferFrom(msg.sender, address(this), amount), "fundPool: transfer failed");
        emit PoolFunded(msg.sender, amount);
    }

    /// @notice Withdraw only funds not owed to the warning line or open policies.
    function withdrawSurplus(uint256 amount) external onlyInsurer {
        uint256 balAfter = token.balanceOf(address(this)) - amount; // reverts on underflow
        require(balAfter >= WARNING_LINE, "withdraw: breaches warning line");
        require(balAfter >= reservedPayouts, "withdraw: breaches reserved payouts");
        require(token.transfer(msg.sender, amount), "withdraw: transfer failed");
        emit SurplusWithdrawn(msg.sender, amount);
    }

    /// @notice Register a manually-verified, trusted flight instance. Terms are
    ///         fixed here and never change after sales begin (PRD §4: "售出后不跟随
    ///         事后时刻表变化"); if the underlying data turns out wrong, pull the
    ///         flight from sale with setFlightSellable instead of editing it.
    function registerFlight(
        string calldata flightNo,
        string calldata origin,
        uint256 scheduledArrival,
        bool sellable
    ) external onlyInsurer returns (uint256 flightId) {
        flightId = ++flightCount;
        flights[flightId] = Flight({
            flightNo: flightNo,
            origin: origin,
            scheduledArrival: scheduledArrival,
            sellable: sellable,
            exists: true
        });
        emit FlightRegistered(flightId, flightNo, origin, scheduledArrival, sellable);
    }

    function setFlightSellable(uint256 flightId, bool sellable) external onlyInsurer {
        require(flights[flightId].exists, "unknown flight");
        flights[flightId].sellable = sellable;
        emit FlightSellableChanged(flightId, sellable);
    }

    // ---------------- buying ----------------

    function buyPolicy(uint256 flightId) external returns (uint256 policyId) {
        require(!paused, "sales paused");
        Flight storage f = flights[flightId];
        require(f.exists, "unknown flight");
        require(f.sellable, "flight not sellable");
        require(block.timestamp + SALE_CUTOFF <= f.scheduledArrival, "sale cutoff passed");
        require(!hasPolicyForFlight[flightId][msg.sender], "already insured this flight");

        uint256 balance = token.balanceOf(address(this));
        require(balance >= WARNING_LINE, "pool below warning line");
        require(balance + PREMIUM >= reservedPayouts + PAYOUT, "pool cannot cover this policy");

        require(token.transferFrom(msg.sender, address(this), PREMIUM), "buyPolicy: transfer failed");
        reservedPayouts += PAYOUT;
        hasPolicyForFlight[flightId][msg.sender] = true;

        policies.push(Policy({
            holder: msg.sender,
            flightId: flightId,
            requestId: 0,
            status: PolicyStatus.Active
        }));
        policyId = policies.length - 1;
        emit PolicyBought(policyId, msg.sender, flightId);
    }

    // ---------------- verification ----------------

    /// @notice Holder asks for their policy to be checked. If the flight already
    ///         has a final cached result, settle immediately (no new oracle round
    ///         trip); otherwise raise an event for the oracle to pick up.
    function requestVerification(uint256 policyId) external {
        Policy storage p = policies[policyId];
        require(p.holder == msg.sender, "not policy holder");
        require(p.status == PolicyStatus.Active, "policy not active");

        uint256 flightId = p.flightId;
        if (flightResults[flightId].isFinal) {
            _settle(policyId);
            return;
        }

        uint256 requestId = ++requestCount;
        verificationRequests[requestId] = VerificationRequest({
            flightId: flightId,
            policyId: policyId,
            exists: true,
            fulfilled: false
        });
        p.requestId = requestId;
        p.status = PolicyStatus.Verifying;
        emit VerificationRequested(requestId, flightId, policyId, flights[flightId].scheduledArrival);
    }

    /// @notice Any other holder of the same flight settles once a final result
    ///         exists, without triggering another oracle request.
    function settlePolicy(uint256 policyId) external {
        Policy storage p = policies[policyId];
        require(p.status == PolicyStatus.Active || p.status == PolicyStatus.Verifying, "policy already closed");
        require(flightResults[p.flightId].isFinal, "no final result yet");
        _settle(policyId);
    }

    /// @notice Only the configured oracle account may submit a final result, and
    ///         only for a request it has not already fulfilled.
    function fulfillVerification(
        uint256 requestId,
        bool cancelled,
        uint256 actualArrival,
        uint256 delayMinutes,
        string calldata dataDate,
        bytes32 evidenceHash
    ) external onlyOracle {
        VerificationRequest storage req = verificationRequests[requestId];
        require(req.exists, "unknown request");
        require(!req.fulfilled, "already fulfilled");
        req.fulfilled = true;

        uint256 flightId = req.flightId;
        if (!flightResults[flightId].isFinal) {
            flightResults[flightId] = FlightResult({
                isFinal: true,
                cancelled: cancelled,
                actualArrival: actualArrival,
                delayMinutes: cancelled ? 0 : delayMinutes,
                dataDate: dataDate,
                evidenceHash: evidenceHash
            });
            emit FlightResultRecorded(flightId, cancelled, actualArrival, delayMinutes, dataDate, evidenceHash);
        }

        Policy storage p = policies[req.policyId];
        if (p.status == PolicyStatus.Verifying) {
            _settle(req.policyId);
        }
    }

    /// @notice If no final result lands within REPORT_TIMEOUT of the scheduled
    ///         arrival, the holder can reclaim the premium and close the policy.
    ///         Once a valid final result is already on-chain, this path is no
    ///         longer available: settlePolicy must be used instead (PRD §4/§7.1:
    ///         "不允许用户选择退款逃避既定结果").
    function refundUnresolved(uint256 policyId) external {
        Policy storage p = policies[policyId];
        require(p.holder == msg.sender, "not policy holder");
        require(p.status == PolicyStatus.Active || p.status == PolicyStatus.Verifying, "policy already closed");
        require(!flightResults[p.flightId].isFinal, "final result already available: use settlePolicy");
        require(block.timestamp > flights[p.flightId].scheduledArrival + REPORT_TIMEOUT, "not past report timeout");

        p.status = PolicyStatus.Refunded;
        reservedPayouts -= PAYOUT;
        require(token.transfer(p.holder, PREMIUM), "refund: transfer failed");
        emit PolicyRefunded(policyId, p.holder, PREMIUM);
    }

    // ---------------- internal settlement ----------------

    function _settle(uint256 policyId) internal {
        Policy storage p = policies[policyId];
        FlightResult storage r = flightResults[p.flightId];
        require(r.isFinal, "no final result");

        reservedPayouts -= PAYOUT;

        uint256 amount;
        string memory reason;
        if (r.cancelled) {
            amount = PAYOUT;
            reason = "cancelled: payout";
        } else if (r.delayMinutes >= DELAY_THRESHOLD_MIN) {
            amount = PAYOUT;
            reason = "delayed: payout";
        } else {
            amount = 0;
            reason = "on time: no payout";
        }

        p.status = amount > 0 ? PolicyStatus.PaidOut : PolicyStatus.ClosedNoPay;
        if (amount > 0) {
            require(token.transfer(p.holder, amount), "settle: transfer failed");
        }
        emit PolicySettled(policyId, p.holder, amount, reason);
    }

    // ---------------- views ----------------

    function policyCount() external view returns (uint256) {
        return policies.length;
    }

    function poolBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
