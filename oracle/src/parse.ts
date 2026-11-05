/**
 * Turns one HKIA flight record's `status` text into a final result, or
 * `{ final: false }` if the record does not yet represent a settled outcome
 * (estimated/boarding/in-flight/unknown text, or an unparsable string).
 * Never trusts `statusCode`, which HKIA's own responses show as unreliable
 * (PRD §5.2: observed null on every sampled record).
 */
export const PARSED_VERSION = "hk-parse-v1";

export interface ParsedStatus {
  final: boolean;
  cancelled: boolean;
  /** unix seconds UTC; only set when final && !cancelled */
  actualArrivalUtc?: number;
}

const AT_GATE_RE = /^at gate\s+(\d{2}):(\d{2})(?:\s*\((\d{2})\/(\d{2})\/(\d{4})\))?/i;
const CANCELLED_RE = /^cancelled/i;

/**
 * @param status raw `status` string from the record, e.g. "At gate 17:20" or
 *   "At gate 00:21 (19/09/2026)" or "Cancelled".
 * @param recordGroupDate the `date` field of the date-group this record was
 *   returned under ("YYYY-MM-DD"), used as the HK-local date for a time-only
 *   "At gate HH:MM" status per PRD §5.3.3.
 */
export function parseStatus(status: string, recordGroupDate: string): ParsedStatus {
  const trimmed = status.trim();

  if (CANCELLED_RE.test(trimmed)) {
    return { final: true, cancelled: true };
  }

  const m = AT_GATE_RE.exec(trimmed);
  if (m) {
    const [, hh, mm, dd, mo, yyyy] = m;
    const hkDate = dd && mo && yyyy ? `${yyyy}-${mo}-${dd}` : recordGroupDate;
    const actualArrivalUtc = hkLocalToUtcSeconds(hkDate, hh, mm);
    if (actualArrivalUtc === null) {
      return { final: false, cancelled: false };
    }
    return { final: true, cancelled: false, actualArrivalUtc };
  }

  // Estimated / Delayed / Boarding / other in-progress or unrecognized text.
  return { final: false, cancelled: false };
}

/** Hong Kong has no DST, so "local date + HH:MM" -> UTC is a fixed -8h shift. */
function hkLocalToUtcSeconds(hkDate: string, hh: string, mm: string): number | null {
  const isoLocal = `${hkDate}T${hh}:${mm}:00+08:00`;
  const ms = Date.parse(isoLocal);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

export function normalizeFlightNo(no: string): string {
  return no.replace(/\s+/g, "").toUpperCase();
}

export function normalizeAirport(code: string): string {
  return code.trim().toUpperCase();
}
