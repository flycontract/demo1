import type Database from "better-sqlite3";
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

function buildUrl(recordDate: string): string {
  const url = new URL(BASE_URL);
  url.searchParams.set("date", recordDate);
  url.searchParams.set("arrival", "true");
  url.searchParams.set("cargo", "false");
  url.searchParams.set("lang", "en");
  return url.toString();
}

async function fetchRaw(recordDate: string, timeoutMs: number): Promise<HkDateGroup[]> {
  const url = buildUrl(recordDate);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
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
  try {
    body = await res.json();
  } catch (err) {
    throw new HkApiError(`HKIA response was not valid JSON: ${(err as Error).message}`, "parse");
  }
  if (!Array.isArray(body)) {
    throw new HkApiError("HKIA response was not the expected array-of-date-groups shape", "parse");
  }
  return body as HkDateGroup[];
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
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
  opts: { timeoutMs: number; maxDailyRefresh: number }
): Promise<{ groups: HkDateGroup[]; sourceUrl: string; fetchedAt: number; fromCache: boolean }> {
  const today = todayStamp();
  const cached = getCachedDay(db, recordDate);
  const sourceUrl = buildUrl(recordDate);

  const refreshCountToday = cached && cached.refresh_day === today ? cached.refresh_count : 0;
  if (cached && refreshCountToday >= opts.maxDailyRefresh) {
    return { groups: JSON.parse(cached.raw_json), sourceUrl, fetchedAt: cached.fetched_at, fromCache: true };
  }

  try {
    const groups = await fetchRaw(recordDate, opts.timeoutMs);
    saveCachedDay(db, recordDate, JSON.stringify(groups), today, refreshCountToday + 1);
    return { groups, sourceUrl, fetchedAt: Math.floor(Date.now() / 1000), fromCache: false };
  } catch (err) {
    // A failed fetch still burns one of today's refresh attempts for this
    // date, so a persistently-broken endpoint can't be hammered forever.
    if (cached) {
      saveCachedDay(db, recordDate, cached.raw_json, today, refreshCountToday + 1);
      throw err;
    }
    saveCachedDay(db, recordDate, "[]", today, refreshCountToday + 1);
    throw err;
  }
}
