import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Contract, JsonRpcProvider } from "ethers";
import { bindDb, getCachedDay, getEvidence, getLastProcessedBlock, getRequestById,
  markEvidenceConfirmed, markEvidenceSubmitted, openDb, saveEvidence, upsertPendingRequest } from "./db.js";
import { getPastFlights } from "./hkAirport.js";
import { findMatch } from "./match.js";
import { OracleService, hkDateFromUnix } from "./service.js";

const raw = readFileSync(resolve(import.meta.dirname, "../fixtures/hkia-past-2026-10-25.raw"));

function withDb(fn: (db: ReturnType<typeof openDb>) => Promise<void> | void) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "flight-oracle-test-"));
    const db = openDb(join(dir, "test.sqlite"));
    try { await fn(db); }
    finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  };
}

test("real saved HKIA response: target group, cross-day, cancellation and codeshare", () => {
  const groups = JSON.parse(raw.toString("utf8"));
  const target = groups.filter((g: { date: string }) => g.date === "2026-10-25");
  assert.equal(target.length, 1);
  assert.equal(target[0].list.length, 449);
  assert.equal(findMatch(target, "CX 5671", "NGO").record?.flight[0].no, "UO 671");
  assert.equal(findMatch(target, "UO 671", "NGO").parsed?.actualArrivalUtc,
    Date.parse("2026-10-24T15:46:00Z") / 1000);
  assert.equal(findMatch(target, "6E 1745", "BOM").parsed?.cancelled, true);
  assert.equal(findMatch(groups.filter((g: { date: string }) => g.date === "2026-10-26"),
    "6E 1745", "BOM").status, "pending");
  assert.equal(hkDateFromUnix(Date.parse("2026-10-25T02:00:00Z") / 1000), "2026-10-25");
});

test("cache spaces real attempts, caps at three per Hong Kong day and preserves old fetch time on 403", withDb(async (db) => {
  const date = "2026-10-25";
  const base = Date.parse("2026-10-26T01:00:00Z");
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return calls === 2 ? new Response("denied", { status: 403 }) :
      new Response(new Uint8Array(raw), { status: 200 });
  }) as typeof fetch;
  const opts = { timeoutMs: 1000, maxDailyRefresh: 3, refreshIntervalMs: 4 * 3600000, fetchImpl };
  const first = await getPastFlights(db, date, { ...opts, nowMs: base });
  assert.equal(first.groups.find((g) => g.date === date)?.list.length, 449);
  const held = await getPastFlights(db, date, { ...opts, nowMs: base + 60000 });
  assert.equal(held.fromCache, true);
  assert.equal(calls, 1);
  await assert.rejects(getPastFlights(db, date, { ...opts, nowMs: base + 4 * 3600000 }), /HTTP 403/);
  assert.equal(getCachedDay(db, date)?.fetched_at, Math.floor(base / 1000));
  assert.equal(getCachedDay(db, date)?.refresh_count, 2);
  await getPastFlights(db, date, { ...opts, nowMs: base + 8 * 3600000 });
  await getPastFlights(db, date, { ...opts, nowMs: base + 9 * 3600000 });
  assert.equal(calls, 3);
  assert.equal(getCachedDay(db, date)?.refresh_count, 3);
}));

test("database refuses another chain or contract and evidence exists before transaction", withDb((db) => {
  bindDb(db, 31337n, "0x0000000000000000000000000000000000000001");
  assert.throws(() => bindDb(db, 11155111n, "0x0000000000000000000000000000000000000001"), /scope mismatch/);
  saveEvidence(db, {
    flightId: 1, requestId: 1, recordDate: "2026-10-25", sourceUrl: "https://www.hongkongairport.com/",
    fetchedAt: 123, rawBytes: raw, rawSha256: "hash", matchedRecordJson: "{}", parsedVersion: "test",
    evidenceHash: "0x" + "1".repeat(64), finalStatus: "cancelled", actualArrival: 0, delaySeconds: 0,
  });
  assert.equal(getEvidence(db, 1)?.submit_status, "prepared");
  assert.deepEqual(getEvidence(db, 1)?.raw_bytes, raw);
  markEvidenceSubmitted(db, 1, "0x" + "2".repeat(64));
  assert.equal(getEvidence(db, 1)?.submit_status, "submitted");
  markEvidenceConfirmed(db, 1);
  assert.equal(getEvidence(db, 1)?.submit_status, "confirmed");
}));

test("confirmed event scan uses chunks, checkpoint overlap and deduplicates replay", withDb(async (db) => {
  const ranges: string[] = [];
  const provider = { getBlockNumber: async () => 30 } as unknown as JsonRpcProvider;
  const event = { args: { requestId: 1n, flightId: 1n, policyId: 0n, scheduledArrival: 12345n } };
  const contract = {
    filters: { VerificationRequested: () => ({}) },
    queryFilter: async (_filter: unknown, from: number, to: number) => {
      ranges.push(`${from}-${to}`);
      return from <= 11 && to >= 11 ? [event] : [];
    },
    flights: async () => ({ exists: true, flightNo: "CX 750", origin: "BKK", departureDate: "2026-10-24",
      scheduledDeparture: 10000n, scheduledArrival: 12345n, earliestVerification: 13000n, sellable: true }),
  } as unknown as Contract;
  const opts = { deployBlock: 10, pollIntervalMs: 60000, httpTimeoutMs: 20000, maxDailyRefresh: 3,
    minRefreshIntervalMs: 14400000, confirmations: 2, eventChunkSize: 5, reorgOverlap: 3 };
  const service = new OracleService(db, provider, contract, contract, opts);
  await service.recoverEvents();
  assert.equal(getLastProcessedBlock(db), 29);
  assert.equal(getRequestById(db, 1)?.flight_no, "CX 750");
  assert.deepEqual(ranges.slice(0, 2), ["10-14", "15-19"]);
  await service.recoverEvents();
  assert.equal(ranges.at(-1), "27-29");
  assert.equal(getRequestById(db, 1)?.attempts, 0);
}));

const arrival = Date.parse("2026-10-25T12:00:00Z") / 1000;
const opts = { deployBlock: 1, pollIntervalMs: 60000, httpTimeoutMs: 20000,
  maxDailyRefresh: 3, minRefreshIntervalMs: 14400000, confirmations: 1,
  eventChunkSize: 10, reorgOverlap: 2 };

function requestDb(db: ReturnType<typeof openDb>) {
  upsertPendingRequest(db, { requestId: 1, flightId: 1, policyId: 0,
    flightNo: "CX 750", origin: "BKK", scheduledArrival: arrival });
  const request = getRequestById(db, 1);
  assert.ok(request);
  return request;
}

function serviceMocks(db: ReturnType<typeof openDb>, status: string, onSend: () => void,
  finalOnChain = false, receiptOnChain = false) {
  const chain = { final: finalOnChain };
  const provider = {
    getBlock: async () => ({ timestamp: arrival + 86400 }),
    getTransactionReceipt: async () => receiptOnChain ? { status: 1 } : null,
  } as unknown as JsonRpcProvider;
  const requestTuple = Object.assign([1n, 0n, true, false], { flightId: 1n, exists: true });
  const readContract = {
    verificationRequests: async () => requestTuple,
    flightResults: async () => ({ isFinal: chain.final }),
  } as unknown as Contract;
  const writeContract = {
    fulfillVerification: async () => {
      onSend();
      return { hash: "0x" + "2".repeat(64), wait: async () => {
        chain.final = true;
        return { status: 1, hash: "0x" + "2".repeat(64) };
      } };
    },
  } as unknown as Contract;
  const group = { date: "2026-10-25", list: [{ time: "12:00", flight: [{ no: "CX 750", airline: "CPA" }],
    status, origin: ["BKK"] }] };
  const rawBytes = Buffer.from(JSON.stringify([group]));
  const fetchFlights = (async () => ({ groups: [group], sourceUrl: "https://www.hongkongairport.com/flightinfo-rest/rest/flights/past?date=2026-10-25",
    fetchedAt: arrival + 100, rawBytes, rawSha256: "sample", fromCache: false })) as typeof getPastFlights;
  return new OracleService(db, provider, readContract, writeContract, opts, fetchFlights);
}

test("OracleService keeps synthetic malformed or pending status unknown; sends no callback", withDb(async (db) => {
  const request = requestDb(db);
  let sends = 0;
  for (const status of ["At gate 12:00 (31/02/2026)", "At gate 12:00 (bad date)",
    "At gate 12:00 unrecognized extra", "Cancelled - pending confirmation"]) {
    await serviceMocks(db, status, () => { sends++; }).processRequest(request);
  }
  assert.equal(sends, 0);
  assert.equal(getEvidence(db, 1), undefined);
  assert.equal(getRequestById(db, 1)?.status, "pending");
  assert.equal(getRequestById(db, 1)?.attempts, 4);
}));

test("OracleService resumes prepared evidence after restart, sends once and settles idempotently", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flight-oracle-restart-"));
  const path = join(dir, "test.sqlite");
  let db = openDb(path);
  try {
    const request = requestDb(db);
    const preCrash = serviceMocks(db, "At gate 12:00", () => { throw Error("transport unavailable before broadcast"); });
    // The service itself prepares durable evidence. The transport fails before
    // any transaction is returned, reproducing a restartable pre-send window.
    await preCrash.processRequest(request);
    assert.equal(getEvidence(db, 1)?.submit_status, "prepared");
    assert.equal(getEvidence(db, 1)?.tx_hash, null);
    db.close();
    db = openDb(path);
    let sends = 0;
    const resumed = serviceMocks(db, "ignored because evidence is prepared", () => { sends++; });
    await resumed.processRequest(request);
    assert.equal(sends, 1);
    assert.equal(getEvidence(db, 1)?.submit_status, "confirmed");
    assert.equal(getRequestById(db, 1)?.status, "fulfilled");
    await resumed.processRequest(request);
    assert.equal(sends, 1, "chain-final recheck must prevent a second transaction");
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("OracleService reconciles successful on-chain tx after restart without resubmitting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flight-oracle-mined-restart-"));
  const path = join(dir, "test.sqlite");
  let db = openDb(path);
  try {
    const request = requestDb(db);
    saveEvidence(db, { flightId: 1, requestId: 1, recordDate: "2026-10-25",
      sourceUrl: "https://www.hongkongairport.com/", fetchedAt: arrival + 100,
      rawBytes: raw, rawSha256: "saved", matchedRecordJson: "{}", parsedVersion: "hk-parse-v2",
      evidenceHash: "0x" + "1".repeat(64), finalStatus: "arrived", actualArrival: arrival,
      delaySeconds: 0 });
    markEvidenceSubmitted(db, 1, "0x" + "2".repeat(64));
    db.close();
    db = openDb(path);
    let sends = 0;
    const resumed = serviceMocks(db, "ignored", () => { sends++; }, true, true);
    await resumed.processRequest(request);
    assert.equal(sends, 0);
    assert.equal(getEvidence(db, 1)?.submit_status, "confirmed");
    assert.equal(getRequestById(db, 1)?.status, "fulfilled");
    await resumed.processRequest(request);
    assert.equal(sends, 0);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
