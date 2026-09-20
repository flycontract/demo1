import { keccak256, toUtf8Bytes, type Contract } from "ethers";
import { config } from "./config.js";
import { getContract, getOracleWallet, getProvider, isRequestFulfilled, readFlight, submitFulfillment } from "./contract.js";
import {
  getLastProcessedBlock,
  getPendingRequests,
  getRequestById,
  markAttempt,
  markBlocked,
  markFulfilled,
  openDb,
  saveEvidence,
  setLastProcessedBlock,
  upsertPendingRequest,
  type RequestRow,
} from "./db.js";
import { getPastFlights, type HkDateGroup } from "./hkAirport.js";
import { findMatch } from "./match.js";
import { PARSED_VERSION } from "./parse.js";

/** Hong Kong has no DST: local calendar date is always UTC+8. */
function hkDateFromUnix(ts: number): string {
  return new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

async function recordRequest(
  db: ReturnType<typeof openDb>,
  contract: Contract,
  requestId: number,
  flightId: number,
  policyId: number,
  scheduledArrival: number
) {
  const flight = await readFlight(contract, flightId);
  upsertPendingRequest(db, {
    requestId,
    flightId,
    policyId,
    flightNo: flight.flightNo,
    origin: flight.origin,
    scheduledArrival,
  });
}

async function processRequest(db: ReturnType<typeof openDb>, contract: Contract, req: RequestRow) {
  // PRD §5.3.1: filter by the record date in the response. The record date is the
  // Hong Kong calendar date of the registered scheduled arrival; HKIA keeps a
  // flight in that group and expresses a cross-midnight actual arrival inside the
  // status text (e.g. "At gate 00:11 (20/09/2026)"), so the next day's group is
  // not needed. Mixing the next day in made every daily flight number ambiguous
  // -- the same flight number has its own, different record the next day -- which
  // blocked settlement forever.
  const recordDate = hkDateFromUnix(req.scheduled_arrival);

  let groups: HkDateGroup[] = [];
  let latestFetch: { sourceUrl: string; fetchedAt: number } | null = null;
  try {
    const fetched = await getPastFlights(db, recordDate, {
      timeoutMs: config.httpTimeoutMs,
      maxDailyRefresh: config.maxDailyRefresh,
    });
    groups = fetched.groups.filter((g) => g.date === recordDate);
    latestFetch = { sourceUrl: fetched.sourceUrl, fetchedAt: fetched.fetchedAt };
  } catch (err) {
    markAttempt(db, req.request_id, `fetch failed: ${(err as Error).message}`);
    console.warn(`[oracle] request ${req.request_id}: HKIA fetch failed, will retry: ${(err as Error).message}`);
    return;
  }

  const match = findMatch(groups, req.flight_no, req.origin);

  if (match.status === "pending") {
    markAttempt(db, req.request_id, null);
    console.log(`[oracle] request ${req.request_id}: no final HKIA record yet for ${req.flight_no}, will retry`);
    return;
  }
  if (match.status === "ambiguous") {
    markBlocked(db, req.request_id, match.reason ?? "ambiguous match");
    console.warn(`[oracle] request ${req.request_id}: ${match.reason}`);
    return;
  }

  const parsed = match.parsed!;
  const cancelled = parsed.cancelled;
  const actualArrival = cancelled ? 0 : parsed.actualArrivalUtc!;
  const delayMinutes = cancelled ? 0 : Math.max(0, Math.round((actualArrival - req.scheduled_arrival) / 60));
  const evidenceHash = keccak256(toUtf8Bytes(JSON.stringify(match.record)));

  try {
    const txHash = await submitFulfillment(contract, {
      requestId: req.request_id,
      cancelled,
      actualArrival,
      delayMinutes,
      dataDate: match.recordDate!,
      evidenceHash,
    });
    markFulfilled(db, req.request_id);
    saveEvidence(db, {
      flightId: req.flight_id,
      requestId: req.request_id,
      recordDate: match.recordDate!,
      sourceUrl: latestFetch?.sourceUrl ?? "",
      fetchedAt: latestFetch?.fetchedAt ?? Math.floor(Date.now() / 1000),
      matchedRecordJson: JSON.stringify(match.record),
      parsedVersion: PARSED_VERSION,
      evidenceHash,
      finalStatus: cancelled ? "cancelled" : "arrived",
      actualArrival,
      delayMinutes,
      txHash,
    });
    console.log(`[oracle] request ${req.request_id}: submitted fulfillVerification (tx ${txHash})`);
  } catch (err) {
    // If a previous run submitted this successfully but crashed before
    // recording it locally, don't treat the on-chain "already fulfilled" as
    // a real failure -- just catch up local state.
    if (await isRequestFulfilled(contract, req.request_id)) {
      markFulfilled(db, req.request_id);
      console.log(`[oracle] request ${req.request_id}: already fulfilled on-chain, catching up local state`);
      return;
    }
    markAttempt(db, req.request_id, `submit failed: ${(err as Error).message}`);
    console.error(`[oracle] request ${req.request_id}: submit failed, will retry: ${(err as Error).message}`);
  }
}

async function main() {
  const db = openDb(config.dbPath);
  const provider = getProvider();
  const wallet = getOracleWallet(provider);
  const contract = getContract(wallet);
  const readContract = getContract(provider);

  const latest = await provider.getBlockNumber();
  const fromBlock = getLastProcessedBlock(db) ?? config.deployBlock;
  console.log(`[oracle] recovering VerificationRequested events from block ${fromBlock} to ${latest}...`);

  const pastEvents = await readContract.queryFilter(readContract.filters.VerificationRequested(), fromBlock, latest);
  for (const ev of pastEvents) {
    if (!("args" in ev)) continue;
    const { requestId, flightId, policyId, scheduledArrival } = ev.args as unknown as {
      requestId: bigint;
      flightId: bigint;
      policyId: bigint;
      scheduledArrival: bigint;
    };
    await recordRequest(db, readContract, Number(requestId), Number(flightId), Number(policyId), Number(scheduledArrival));
  }
  setLastProcessedBlock(db, latest);
  console.log(`[oracle] recovered ${pastEvents.length} historical request(s)`);

  contract.on("VerificationRequested", async (requestId, flightId, policyId, scheduledArrival, event) => {
    const rid = Number(requestId);
    await recordRequest(db, readContract, rid, Number(flightId), Number(policyId), Number(scheduledArrival));
    setLastProcessedBlock(db, event.log.blockNumber);
    const row = getRequestById(db, rid);
    if (row) await processRequest(db, contract, row);
  });

  console.log(`[oracle] listening for VerificationRequested events, polling pending requests every ${config.pollIntervalMs}ms`);

  const tick = async () => {
    for (const req of getPendingRequests(db)) {
      await processRequest(db, contract, req);
    }
  };
  await tick();
  setInterval(tick, config.pollIntervalMs);
}

main().catch((err) => {
  console.error("[oracle] fatal error:", err);
  process.exit(1);
});
