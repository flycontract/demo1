import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { keccak256, type Contract, type JsonRpcProvider } from "ethers";
import { isRequestFulfilled, readFlight, submitFulfillment } from "./contract.js";
import {
  getEvidence, getLastProcessedBlock, getPendingRequests, markAttempt, markBlocked,
  markEvidenceConfirmed, markEvidenceError, markEvidenceSubmitted, markFulfilled,
  saveEvidence, setLastProcessedBlock, upsertPendingRequest, type RequestRow,
} from "./db.js";
import { getPastFlights } from "./hkAirport.js";
import { findMatch } from "./match.js";
import { PARSED_VERSION } from "./parse.js";

export interface OracleOptions {
  deployBlock: number;
  pollIntervalMs: number;
  httpTimeoutMs: number;
  maxDailyRefresh: number;
  minRefreshIntervalMs: number;
  confirmations: number;
  eventChunkSize: number;
  reorgOverlap: number;
}

export function hkDateFromUnix(ts: number): string {
  return new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

export class OracleService {
  private running = false;

  constructor(
    private readonly db: Database.Database,
    private readonly provider: JsonRpcProvider,
    private readonly readContract: Contract,
    private readonly writeContract: Contract,
    private readonly opts: OracleOptions,
    private readonly fetchFlights: typeof getPastFlights = getPastFlights,
  ) {}

  private async recordRequest(requestId: number, flightId: number, policyId: number, scheduledArrival: number) {
    const flight = await readFlight(this.readContract, flightId);
    if (!flight.exists || flight.scheduledArrival !== scheduledArrival) {
      throw new Error(`Flight/event mismatch for request ${requestId}`);
    }
    upsertPendingRequest(this.db, {
      requestId, flightId, policyId, flightNo: flight.flightNo,
      origin: flight.origin, scheduledArrival,
    });
  }

  /** Re-query confirmed blocks in bounded chunks with overlap on every poll. */
  async recoverEvents() {
    const latest = await this.provider.getBlockNumber();
    const safeHead = latest - this.opts.confirmations + 1;
    if (safeHead < this.opts.deployBlock) return;
    const checkpoint = getLastProcessedBlock(this.db);
    let from = checkpoint === null ? this.opts.deployBlock :
      Math.max(this.opts.deployBlock, Math.min(checkpoint, safeHead) - this.opts.reorgOverlap + 1);
    while (from <= safeHead) {
      const to = Math.min(safeHead, from + this.opts.eventChunkSize - 1);
      const events = await this.readContract.queryFilter(this.readContract.filters.VerificationRequested(), from, to);
      for (const event of events) {
        if (!("args" in event)) continue;
        await this.recordRequest(Number(event.args.requestId), Number(event.args.flightId),
          Number(event.args.policyId), Number(event.args.scheduledArrival));
      }
      setLastProcessedBlock(this.db, to);
      from = to + 1;
    }
  }

  async processRequest(req: RequestRow) {
    const chainRequest = await this.readContract.verificationRequests(req.request_id);
    if (!chainRequest.exists || Number(chainRequest.flightId) !== req.flight_id) {
      markBlocked(this.db, req.request_id, "request absent or changed on chain");
      return;
    }
    const existing = await this.readContract.flightResults(req.flight_id);
    if (existing.isFinal || await isRequestFulfilled(this.readContract, req.request_id)) {
      markFulfilled(this.db, req.request_id);
      if (getEvidence(this.db, req.flight_id)) markEvidenceConfirmed(this.db, req.flight_id);
      return;
    }
    const block = await this.provider.getBlock("latest");
    if (!block) throw new Error("Could not read chain time");
    if (block.timestamp >= req.scheduled_arrival + 7 * 24 * 3600) {
      markBlocked(this.db, req.request_id, "report timeout passed; holder may refund");
      return;
    }

    let evidence = getEvidence(this.db, req.flight_id);
    if (evidence && evidence.request_id !== req.request_id) return; // same flight, one writer
    if (!evidence) {
      const recordDate = hkDateFromUnix(req.scheduled_arrival);
      let fetched;
      try {
        fetched = await this.fetchFlights(this.db, recordDate, {
          timeoutMs: this.opts.httpTimeoutMs,
          maxDailyRefresh: this.opts.maxDailyRefresh,
          refreshIntervalMs: this.opts.minRefreshIntervalMs,
        });
      } catch (error) {
        markAttempt(this.db, req.request_id, `HKIA unavailable: ${(error as Error).message}`);
        return;
      }
      const groups = fetched.groups.filter((group) => group.date === recordDate);
      if (groups.length !== 1) {
        markAttempt(this.db, req.request_id, "target HKIA date group missing or repeated");
        return;
      }
      const match = findMatch(groups, req.flight_no, req.origin);
      if (match.status !== "final" || !match.parsed || !match.record) {
        markAttempt(this.db, req.request_id, match.reason ?? `HKIA result ${match.status}`);
        return;
      }
      const cancelled = match.parsed.cancelled;
      const actualArrival = cancelled ? 0 : match.parsed.actualArrivalUtc!;
      const rawSha256 = createHash("sha256").update(fetched.rawBytes).digest("hex");
      const evidenceHash = keccak256(fetched.rawBytes);
      saveEvidence(this.db, {
        flightId: req.flight_id, requestId: req.request_id, recordDate,
        sourceUrl: fetched.sourceUrl, fetchedAt: fetched.fetchedAt,
        rawBytes: fetched.rawBytes, rawSha256,
        matchedRecordJson: JSON.stringify(match.record), parsedVersion: PARSED_VERSION,
        evidenceHash, finalStatus: cancelled ? "cancelled" : "arrived", actualArrival,
        delaySeconds: cancelled ? 0 : Math.max(0, actualArrival - req.scheduled_arrival),
      });
      evidence = getEvidence(this.db, req.flight_id);
      if (!evidence) throw new Error("Evidence was not persisted");
    }

    if (evidence.submit_status === "submitted" && evidence.tx_hash) {
      const receipt = await this.provider.getTransactionReceipt(evidence.tx_hash);
      if (receipt?.status === 1) {
        const final = await this.readContract.flightResults(req.flight_id);
        if (final.isFinal) {
          markEvidenceConfirmed(this.db, req.flight_id);
          markFulfilled(this.db, req.request_id);
          return;
        }
      }
      // A pending transaction may still be mined. A dropped or reverted
      // transaction is retried only after a bounded wait and a fresh chain read.
      if (!receipt && evidence.submitted_at && Date.now() / 1000 - evidence.submitted_at < 900) return;
    }

    try {
      await submitFulfillment(this.writeContract, {
        requestId: req.request_id,
        cancelled: evidence.final_status === "cancelled",
        actualArrival: evidence.actual_arrival,
        dataDate: evidence.record_date,
        evidenceHash: evidence.evidence_hash,
      }, (txHash) => markEvidenceSubmitted(this.db, req.flight_id, txHash));
      markEvidenceConfirmed(this.db, req.flight_id);
      markFulfilled(this.db, req.request_id);
    } catch (error) {
      const final = await this.readContract.flightResults(req.flight_id);
      if (final.isFinal) {
        markEvidenceConfirmed(this.db, req.flight_id);
        markFulfilled(this.db, req.request_id);
        return;
      }
      const message = (error as Error).message;
      markEvidenceError(this.db, req.flight_id, message);
      markAttempt(this.db, req.request_id, `submit failed: ${message}`);
    }
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.recoverEvents();
      for (const req of getPendingRequests(this.db)) await this.processRequest(req);
    } finally {
      this.running = false;
    }
  }
}
