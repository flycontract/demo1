import type { HkDateGroup, HkFlightRecord } from "./hkAirport.js";
import { normalizeAirport, normalizeFlightNo, parseStatus, type ParsedStatus } from "./parse.js";

export interface MatchResult {
  status: "final" | "pending" | "ambiguous";
  parsed?: ParsedStatus;
  record?: HkFlightRecord;
  recordDate?: string;
  reason?: string; // set when status === "ambiguous"
}

function recordMatches(record: HkFlightRecord, targetFlightNo: string, targetOrigin: string): boolean {
  const codes = record.flight.map((f) => normalizeFlightNo(f.no));
  if (!codes.includes(targetFlightNo)) return false;
  const origins = record.origin.map(normalizeAirport);
  return origins.includes(targetOrigin);
}

/**
 * Searches HKIA date-groups (possibly fetched for several candidate record
 * dates, since a cross-day "At gate" can land in the next day's group) for
 * the registered flight, matching on flight/codeshare number + origin
 * airport. Multiple groups can legitimately return the same record (PRD
 * §5.2: "返回数组还包含相邻日期分组"), so identical matches are deduplicated;
 * genuinely conflicting matches are reported as ambiguous rather than guessed.
 */
export function findMatch(
  groupsByDate: HkDateGroup[],
  targetFlightNo: string,
  targetOrigin: string
): MatchResult {
  const wantFlight = normalizeFlightNo(targetFlightNo);
  const wantOrigin = normalizeAirport(targetOrigin);

  const candidates: { record: HkFlightRecord; recordDate: string; parsed: ParsedStatus }[] = [];
  for (const group of groupsByDate) {
    for (const record of group.list) {
      if (!recordMatches(record, wantFlight, wantOrigin)) continue;
      candidates.push({ record, recordDate: group.date, parsed: parseStatus(record.status, group.date) });
    }
  }

  if (candidates.length === 0) {
    return { status: "pending" };
  }

  const finalOnes = candidates.filter((c) => c.parsed.final);
  if (finalOnes.length === 0) {
    return { status: "pending" };
  }

  const distinctOutcomes = new Set(
    finalOnes.map((c) => (c.parsed.cancelled ? "cancelled" : `arrived:${c.parsed.actualArrivalUtc}`))
  );
  if (distinctOutcomes.size > 1) {
    return {
      status: "ambiguous",
      reason: `${finalOnes.length} matching records for ${targetFlightNo}/${targetOrigin} disagree: ${[
        ...distinctOutcomes,
      ].join(", ")}`,
    };
  }

  const chosen = finalOnes[0];
  return { status: "final", parsed: chosen.parsed, record: chosen.record, recordDate: chosen.recordDate };
}
