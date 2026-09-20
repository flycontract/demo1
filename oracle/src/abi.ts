/**
 * Hand-written human-readable ABI covering only what the oracle calls.
 * After compiling the contracts (e.g. `npx hardhat compile`), you can swap
 * this for the generated artifact's full ABI instead -- this subset is
 * sufficient for the oracle service either way.
 */
export const FLIGHT_DELAY_INSURANCE_ABI = [
  "event VerificationRequested(uint256 indexed requestId, uint256 indexed flightId, uint256 indexed policyId, uint256 scheduledArrival)",
  "event FlightResultRecorded(uint256 indexed flightId, bool cancelled, uint256 actualArrival, uint256 delayMinutes, string dataDate, bytes32 evidenceHash)",
  "function flights(uint256) view returns (string flightNo, string origin, uint256 scheduledArrival, bool sellable, bool exists)",
  "function verificationRequests(uint256) view returns (uint256 flightId, uint256 policyId, bool exists, bool fulfilled)",
  "function flightResults(uint256) view returns (bool isFinal, bool cancelled, uint256 actualArrival, uint256 delayMinutes, string dataDate, bytes32 evidenceHash)",
  "function fulfillVerification(uint256 requestId, bool cancelled, uint256 actualArrival, uint256 delayMinutes, string dataDate, bytes32 evidenceHash) external",
];
