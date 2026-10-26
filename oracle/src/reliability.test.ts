import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Contract, JsonRpcProvider } from "ethers";
import { bindDb, getCachedDay, getEvidence, getLastProcessedBlock, getRequestById,
  markEvidenceConfirmed, markEvidenceSubmitted, openDb, saveEvidence } from "./db.js";
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
