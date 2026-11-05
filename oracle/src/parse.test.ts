import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeFlightNo, parseStatus } from "./parse.js";
import { findMatch } from "./match.js";
import type { HkDateGroup } from "./hkAirport.js";

test("parseStatus: same-day 'At gate' uses the record group's date", () => {
  const r = parseStatus("At gate 17:20", "2026-09-19");
  assert.equal(r.final, true);
  assert.equal(r.cancelled, false);
  // 2026-09-19 17:20 HKT == 2026-09-19 09:20 UTC
  assert.equal(new Date((r.actualArrivalUtc ?? 0) * 1000).toISOString(), "2026-09-19T09:20:00.000Z");
});

test("parseStatus: cross-day 'At gate' with an explicit date wins over the group date", () => {
  const r = parseStatus("At gate 00:21 (19/09/2026)", "2026-09-20");
  assert.equal(r.final, true);
  assert.equal(r.cancelled, false);
  // 2026-09-19 00:21 HKT == 2026-09-18 16:21 UTC
  assert.equal(new Date((r.actualArrivalUtc ?? 0) * 1000).toISOString(), "2026-09-18T16:21:00.000Z");
});

test("parseStatus: 'Cancelled' is final regardless of trailing text/case", () => {
  assert.equal(parseStatus("Cancelled", "2026-09-19").cancelled, true);
  assert.equal(parseStatus("cancelled", "2026-09-19").cancelled, true);
});

test("parseStatus: statusCode is never consulted -- only the text matters, and unknown text is never final", () => {
  for (const status of ["Estimated 15:05", "Boarding", "Delayed", "", "Some new HKIA wording we've never seen"]) {
    assert.equal(parseStatus(status, "2026-09-19").final, false, status);
  }
});

test("normalizeFlightNo: strips spaces and case so 'CX 750' matches 'CX750'", () => {
  assert.equal(normalizeFlightNo("CX 750"), normalizeFlightNo("cx750"));
});

test("findMatch: matches on any codeshare number in the flight array", () => {
  const groups: HkDateGroup[] = [
    {
      date: "2026-09-19",
      list: [
        {
          time: "15:05",
          flight: [
            { no: "CX 750", airline: "CPA" },
            { no: "AA 5750", airline: "AAL" }, // codeshare
          ],
          status: "At gate 17:20",
          origin: ["BKK"],
        },
      ],
    },
  ];
  const m = findMatch(groups, "AA 5750", "BKK");
  assert.equal(m.status, "final");
  assert.equal(m.parsed?.cancelled, false);
});

test("findMatch: no match at all is 'pending', not an error", () => {
  const groups: HkDateGroup[] = [{ date: "2026-09-19", list: [] }];
  const m = findMatch(groups, "CX 750", "BKK");
  assert.equal(m.status, "pending");
});

test("findMatch: a record present but still in-flight/estimated is 'pending'", () => {
  const groups: HkDateGroup[] = [
    { date: "2026-09-19", list: [{ time: "15:05", flight: [{ no: "CX 750", airline: "CPA" }], status: "Estimated 17:00", origin: ["BKK"] }] },
  ];
  const m = findMatch(groups, "CX 750", "BKK");
  assert.equal(m.status, "pending");
});

test("findMatch: identical record duplicated across adjacent date-groups is deduplicated, not ambiguous", () => {
  const record = { time: "00:15", flight: [{ no: "BX 3935", airline: "ABL" }], status: "Cancelled", origin: ["ICN"] };
  const groups: HkDateGroup[] = [
    { date: "2026-09-19", list: [record] },
    { date: "2026-09-20", list: [record] }, // same record echoed in the neighbouring group
  ];
  const m = findMatch(groups, "BX 3935", "ICN");
  assert.equal(m.status, "final");
  assert.equal(m.parsed?.cancelled, true);
});

test("findMatch: genuinely conflicting final records are 'ambiguous', never guessed", () => {
  const groups: HkDateGroup[] = [
    { date: "2026-09-19", list: [{ time: "15:05", flight: [{ no: "CX 750", airline: "CPA" }], status: "At gate 17:20", origin: ["BKK"] }] },
    { date: "2026-09-20", list: [{ time: "15:05", flight: [{ no: "CX 750", airline: "CPA" }], status: "Cancelled", origin: ["BKK"] }] },
  ];
  const m = findMatch(groups, "CX 750", "BKK");
  assert.equal(m.status, "ambiguous");
});

test("findMatch: origin must also match, so same flight number from a different city doesn't collide", () => {
  const groups: HkDateGroup[] = [
    { date: "2026-09-19", list: [{ time: "15:05", flight: [{ no: "CX 750", airline: "CPA" }], status: "At gate 17:20", origin: ["BKK"] }] },
  ];
  const m = findMatch(groups, "CX 750", "SIN");
  assert.equal(m.status, "pending");
});
