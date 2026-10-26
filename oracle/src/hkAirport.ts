import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { getCachedDay, saveCachedDay } from "./db.js";

/**
 * Client for the Hong Kong Airport Authority's official historical flights
 * API (PRD §5.1). The host and query-parameter names are fixed; the only
 * variable is `date`, and it always comes from a registered flight's
 * scheduled arrival, never from user input.
 */
const BASE_URL = "https://www.hongkongairport.com/flightinfo-rest/rest/flights/past";

export interface HkFlightRecord {
  time: string; // "HH:MM"
  flight: { no: string; airline: string }[];
  status: string;
  origin: string[];
  statusCode?: unknown; // observed unreliable/null; never trusted for logic
}

export interface HkDateGroup {
  date: string; // "YYYY-MM-DD"
  list: HkFlightRecord[];
}

export class HkApiError extends Error {
  constructor(
    message: string,
    public readonly kind: "timeout" | "http_error" | "network" | "parse"
  ) {
    super(message);
    this.name = "HkApiError";
  }
}

export function buildUrl(recordDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) throw new HkApiError("Invalid record date", "parse");
  const url = new URL(BASE_URL);
  url.searchParams.set("date", recordDate);
  url.searchParams.set("arrival", "true");
  url.searchParams.set("cargo", "false");
  url.searchParams.set("lang", "en");
  return url.toString();
}

async function fetchRaw(recordDate: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<{ groups: HkDateGroup[]; rawBytes: Buffer }> {
  const url = buildUrl(recordDate);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new HkApiError(`HKIA request timed out after ${timeoutMs}ms (date=${recordDate})`, "timeout");
    }
    throw new HkApiError(`HKIA request failed: ${(err as Error).message}`, "network");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new HkApiError(`HKIA returned HTTP ${res.status} for date=${recordDate}`, "http_error");
  }

  let body: unknown;
  let rawBytes: Buffer;
  try {
    rawBytes = Buffer.from(await res.arrayBuffer());
    body = JSON.parse(rawBytes.toString("utf8"));
  } catch (err) {
    throw new HkApiError(`HKIA response was not valid JSON: ${(err as Error).message}`, "parse");
  }
  if (!Array.isArray(body) || !body.every((group) =>
    group && typeof group.date === "string" && Array.isArray(group.list))) {
    throw new HkApiError("HKIA response was not the expected array-of-date-groups shape", "parse");
  }
  return { groups: body as HkDateGroup[], rawBytes };
}

function hkDay(nowMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(nowMs));
}

/**
 * Returns the parsed date-groups for a given HKIA record date, sharing one
 * cached fetch across every request that needs the same date (PRD §6:
 * "同一天多个保单不各自下载整份数据") and capping automatic refreshes to
 * `maxDailyRefresh` per date per calendar day. Once the cap is hit, the last
 * cached response is reused even if stale; callers relying on a still-open
 * request simply see it as "not yet found" and retry on the next poll.
 */
export async function getPastFlights(
  db: Database.Database,
  recordDate: string,
  opts: { timeoutMs: number; maxDailyRefresh: number; refreshIntervalMs: number; nowMs?: number; fetchImpl?: typeof fetch }
): Promise<{ groups: HkDateGroup[]; sourceUrl: string; fetchedAt: number; rawBytes: Buffer; rawSha256: string; fromCache: boolean }> {
  const nowMs = opts.nowMs ?? Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  const today = hkDay(nowMs);
  const cached = getCachedDay(db, recordDate);
  const sourceUrl = buildUrl(recordDate);
  const refreshCountToday = cached && cached.refresh_day === today ? cached.refresh_count : 0;
  const lastAttemptToday = cached && cached.refresh_day === today ? cached.last_attempt_at : 0;
  const canRefresh = refreshCountToday < opts.maxDailyRefresh &&
    (!lastAttemptToday || nowMs - lastAttemptToday * 1000 >= opts.refreshIntervalMs);
  const cachedResult = () => {
    if (!cached?.raw_bytes || cached.fetched_at === 0) {
      throw new HkApiError("HKIA data unavailable; waiting for next allowed refresh", "network");
    }
    return {
      groups: JSON.parse(cached.raw_json) as HkDateGroup[], sourceUrl, fetchedAt: cached.fetched_at,
      rawBytes: cached.raw_bytes, rawSha256: createHash("sha256").update(cached.raw_bytes).digest("hex"), fromCache: true,
    };
  };
  if (!canRefresh) {
    return cachedResult();
  }

  try {
    const { groups, rawBytes } = await fetchRaw(recordDate, opts.timeoutMs, opts.fetchImpl ?? fetch);
    saveCachedDay(db, recordDate, rawBytes.toString("utf8"), rawBytes, nowSeconds, nowSeconds, today, refreshCountToday + 1);
    return {
      groups, sourceUrl, fetchedAt: nowSeconds, rawBytes,
      rawSha256: createHash("sha256").update(rawBytes).digest("hex"), fromCache: false,
    };
  } catch (err) {
    // Count only actual HTTP attempts. Preserve the previous successful body's
    // original fetched_at and bytes when an attempt fails.
    saveCachedDay(db, recordDate, cached?.raw_json ?? "[]", cached?.raw_bytes ?? null,
      cached?.fetched_at ?? 0, nowSeconds, today, refreshCountToday + 1);
    throw err;
  }
}
