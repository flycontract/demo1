// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title FlightDelayInsurance (demo)
/// @notice Parametric flight-delay insurance. A trusted off-chain oracle signs
///         the real take-off data; anyone can relay that signed report on-chain.
/// @dev    Course demo only: single trusted signer, no audits, no upgradeability.
contract FlightDelayInsurance {
    // ---------------- configuration ----------------
    address public immutable owner;
    address public oracleSigner;                         // key the off-chain oracle signs with

    uint256 public constant DELAY_THRESHOLD = 2 hours;   // pay if delay >= this
    uint256 public constant SALE_CUTOFF     = 24 hours;  // no sales within 24h of departure
    uint256 public constant PAYOUT_MULTIPLE = 5;         // payout = premium * 5
    uint256 public constant MAX_SCHEDULE_DRIFT = 1 hours;// buyer's schedule vs oracle's schedule
    uint256 public constant REPORT_DEADLINE = 3 days;    // refund if oracle never reports
    uint256 public constant MIN_PREMIUM = 0.001 ether;
    uint256 public constant MAX_PREMIUM = 0.1 ether;

    enum Status { Unreported, Departed, Cancelled }

    struct Flight {
        uint256 claimedSchedule;   // schedule given by the first buyer (part of the key)
        uint256 oracleSchedule;    // schedule according to the oracle
        uint256 actualTakeoff;     // wheels-off time according to the oracle (0 if cancelled)
        Status  status;
    }

    struct Policy {
        address holder;
        bytes32 flightKey;
        uint256 premium;
        uint256 payout;
        bool    closed;
    }

    mapping(bytes32 => Flight) public flights;
    Policy[] public policies;
    uint256 public reservedPayouts;   // money promised to open policies

    // ---------------- events ----------------
    event PolicyBought(uint256 indexed policyId, address indexed holder, bytes32 indexed flightKey, uint256 premium, uint256 payout);
    event TakeoffReported(bytes32 indexed flightKey, uint256 oracleSchedule, uint256 actualTakeoff, Status status);
    event PolicyClosed(uint256 indexed policyId, address indexed holder, uint256 amountPaid, string reason);

    constructor(address _oracleSigner) {
        owner = msg.sender;
        oracleSigner = _oracleSigner;
    }

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    /// @notice Insurer adds capital to the pool that pays claims.
    function fundPool() external payable onlyOwner {}

    function setOracleSigner(address s) external onlyOwner { oracleSigner = s; }

    /// @notice Unique id for "flight X scheduled at time T".
    function flightKey(string memory flightNumber, uint256 scheduledDeparture) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(flightNumber, scheduledDeparture));
    }

    // ---------------- buying ----------------
    function buyPolicy(string calldata flightNumber, uint256 scheduledDeparture)
        external payable returns (uint256 policyId)
    {
        require(block.timestamp + SALE_CUTOFF <= scheduledDeparture, "sales closed for this flight");
        require(msg.value >= MIN_PREMIUM && msg.value <= MAX_PREMIUM, "premium out of range");

        uint256 payout = msg.value * PAYOUT_MULTIPLE;
        // Solvency: the pool (which now includes this premium) must cover every promise.
        require(address(this).balance >= reservedPayouts + payout, "pool cannot cover this policy");
        reservedPayouts += payout;

        bytes32 key = flightKey(flightNumber, scheduledDeparture);
        if (flights[key].claimedSchedule == 0) flights[key].claimedSchedule = scheduledDeparture;

        policies.push(Policy(msg.sender, key, msg.value, payout, false));
        policyId = policies.length - 1;
        emit PolicyBought(policyId, msg.sender, key, msg.value, payout);
    }

    // ---------------- oracle report ----------------
    /// @notice The exact bytes the oracle signs. Binding the contract address and
    ///         chain id stops a signature from being replayed on another deployment.
    function reportHash(bytes32 key, uint256 oracleSchedule, uint256 actualTakeoff, Status status)
        public view returns (bytes32)
    {
        return keccak256(abi.encodePacked(address(this), block.chainid, key, oracleSchedule, actualTakeoff, uint8(status)));
    }

    /// @notice Anyone may submit a report, but only one signed by oracleSigner is accepted.
    function reportTakeoff(
        bytes32 key,
        uint256 oracleSchedule,
        uint256 actualTakeoff,
        Status status,
        bytes calldata signature
    ) external {
        Flight storage f = flights[key];
        require(f.claimedSchedule != 0, "no policies for this flight");
        require(f.status == Status.Unreported, "already reported");
        require(status != Status.Unreported, "invalid status");
        require(block.timestamp >= f.claimedSchedule, "flight not due yet");

        bytes32 digest = _toEthSignedMessageHash(reportHash(key, oracleSchedule, actualTakeoff, status));
        require(_recover(digest, signature) == oracleSigner, "bad oracle signature");

        f.oracleSchedule = oracleSchedule;
        f.actualTakeoff  = actualTakeoff;
        f.status         = status;
        emit TakeoffReported(key, oracleSchedule, actualTakeoff, status);
    }

    // ---------------- settlement ----------------
    /// @notice Close a policy: pays out, refunds, or lets the premium go to the pool.
    function settle(uint256 policyId) external {
        Policy storage p = policies[policyId];
        require(!p.closed, "already closed");
        Flight storage f = flights[p.flightKey];

        uint256 amount;
        string memory reason;

        if (f.status == Status.Unreported) {
            // Oracle never reported: refund after the deadline so money is never stuck.
            require(block.timestamp > f.claimedSchedule + REPORT_DEADLINE, "waiting for oracle");
            amount = p.premium;
            reason = "no report: refund";
        } else if (_drift(f.claimedSchedule, f.oracleSchedule) > MAX_SCHEDULE_DRIFT) {
            // Buyer gave a wrong schedule (maybe to dodge the sale cutoff): void, refund.
            amount = p.premium;
            reason = "schedule mismatch: void";
        } else if (f.status == Status.Cancelled) {
            amount = p.payout;
            reason = "cancelled: payout";
        } else if (f.actualTakeoff >= f.oracleSchedule + DELAY_THRESHOLD) {
            amount = p.payout;
            reason = "delayed: payout";
        } else {
            amount = 0;
            reason = "on time: no payout";
        }

        p.closed = true;                  // update state before sending money
        reservedPayouts -= p.payout;
        if (amount > 0) {
            (bool ok, ) = p.holder.call{value: amount}("");
            require(ok, "transfer failed");
        }
        emit PolicyClosed(policyId, p.holder, amount, reason);
    }

    function policyCount() external view returns (uint256) { return policies.length; }

    // ---------------- signature helpers (no external libraries) ----------------
    function _drift(uint256 a, uint256 b) private pure returns (uint256) { return a > b ? a - b : b - a; }

    function _toEthSignedMessageHash(bytes32 h) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        require(sig.length == 65, "bad signature length");
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8   v = uint8(sig[64]);
        if (v < 27) v += 27;
        // Reject "high s" values to prevent signature malleability.
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "bad s");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "invalid signature");
        return signer;
    }
}
