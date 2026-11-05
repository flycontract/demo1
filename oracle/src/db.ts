import Database from "better-sqlite3";

export type RequestStatus = "pending" | "blocked" | "fulfilled";

export interface RequestRow {
  request_id: number;
  flight_id: number;
  policy_id: number;
  flight_no: string;
  origin: string;
  scheduled_arrival: number;
  status: RequestStatus;
  attempts: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export function openDb(path: string) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requests (
      request_id        INTEGER PRIMARY KEY,
      flight_id         INTEGER NOT NULL,
      policy_id         INTEGER NOT NULL,
      flight_no         TEXT NOT NULL,
      origin            TEXT NOT NULL,
      scheduled_arrival  INTEGER NOT NULL,
      status             TEXT NOT NULL DEFAULT 'pending',
      attempts           INTEGER NOT NULL DEFAULT 0,
      last_error         TEXT,
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hk_cache (
      record_date    TEXT PRIMARY KEY,
      raw_json       TEXT NOT NULL,
      fetched_at     INTEGER NOT NULL,
      refresh_day    TEXT NOT NULL,
      refresh_count  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence (
      flight_id          INTEGER PRIMARY KEY,
      request_id         INTEGER NOT NULL,
      record_date        TEXT NOT NULL,
      source_url         TEXT NOT NULL,
      fetched_at         INTEGER NOT NULL,
      matched_record_json TEXT NOT NULL,
      parsed_version      TEXT NOT NULL,
      evidence_hash        TEXT NOT NULL,
      final_status          TEXT NOT NULL,
      actual_arrival         INTEGER NOT NULL,
      delay_minutes           INTEGER NOT NULL,
      submitted_at             INTEGER NOT NULL,
      tx_hash                   TEXT NOT NULL
    );
  `);

  return db;
}

export function getLastProcessedBlock(db: Database.Database): number | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'last_processed_block'").get() as
    | { value: string }
    | undefined;
  return row ? Number(row.value) : null;
}

export function setLastProcessedBlock(db: Database.Database, block: number) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('last_processed_block', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(String(block));
}

export function upsertPendingRequest(
  db: Database.Database,
  row: {
    requestId: number;
    flightId: number;
    policyId: number;
    flightNo: string;
    origin: string;
    scheduledArrival: number;
  }
) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO requests (request_id, flight_id, policy_id, flight_no, origin, scheduled_arrival, status, attempts, created_at, updated_at)
     VALUES (@requestId, @flightId, @policyId, @flightNo, @origin, @scheduledArrival, 'pending', 0, @now, @now)
     ON CONFLICT(request_id) DO NOTHING`
  ).run({ ...row, now });
}

export function getPendingRequests(db: Database.Database): RequestRow[] {
  return db.prepare("SELECT * FROM requests WHERE status = 'pending'").all() as RequestRow[];
}

export function getRequestById(db: Database.Database, requestId: number): RequestRow | undefined {
  return db.prepare("SELECT * FROM requests WHERE request_id = ?").get(requestId) as RequestRow | undefined;
}

export function markAttempt(db: Database.Database, requestId: number, error: string | null) {
  db.prepare(
    `UPDATE requests SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE request_id = ?`
  ).run(error, Math.floor(Date.now() / 1000), requestId);
}

export function markBlocked(db: Database.Database, requestId: number, error: string) {
  db.prepare(
    `UPDATE requests SET status = 'blocked', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE request_id = ?`
  ).run(error, Math.floor(Date.now() / 1000), requestId);
}

export function markFulfilled(db: Database.Database, requestId: number) {
  db.prepare(
    `UPDATE requests SET status = 'fulfilled', last_error = NULL, updated_at = ? WHERE request_id = ?`
  ).run(Math.floor(Date.now() / 1000), requestId);
}

export function saveEvidence(
  db: Database.Database,
  row: {
    flightId: number;
    requestId: number;
    recordDate: string;
    sourceUrl: string;
    fetchedAt: number;
    matchedRecordJson: string;
    parsedVersion: string;
    evidenceHash: string;
    finalStatus: string;
    actualArrival: number;
    delayMinutes: number;
    txHash: string;
  }
) {
  db.prepare(
    `INSERT INTO evidence (flight_id, request_id, record_date, source_url, fetched_at, matched_record_json, parsed_version, evidence_hash, final_status, actual_arrival, delay_minutes, submitted_at, tx_hash)
     VALUES (@flightId, @requestId, @recordDate, @sourceUrl, @fetchedAt, @matchedRecordJson, @parsedVersion, @evidenceHash, @finalStatus, @actualArrival, @delayMinutes, @submittedAt, @txHash)
     ON CONFLICT(flight_id) DO UPDATE SET
       request_id = excluded.request_id, record_date = excluded.record_date,
       source_url = excluded.source_url, fetched_at = excluded.fetched_at,
       matched_record_json = excluded.matched_record_json, parsed_version = excluded.parsed_version,
       evidence_hash = excluded.evidence_hash, final_status = excluded.final_status,
       actual_arrival = excluded.actual_arrival, delay_minutes = excluded.delay_minutes,
       submitted_at = excluded.submitted_at, tx_hash = excluded.tx_hash`
  ).run({ ...row, submittedAt: Math.floor(Date.now() / 1000) });
}

export function getCachedDay(db: Database.Database, recordDate: string) {
  return db.prepare("SELECT * FROM hk_cache WHERE record_date = ?").get(recordDate) as
    | {
        record_date: string;
        raw_json: string;
        fetched_at: number;
        refresh_day: string;
        refresh_count: number;
      }
    | undefined;
}

export function saveCachedDay(
  db: Database.Database,
  recordDate: string,
  rawJson: string,
  refreshDay: string,
  refreshCount: number
) {
  db.prepare(
    `INSERT INTO hk_cache (record_date, raw_json, fetched_at, refresh_day, refresh_count)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(record_date) DO UPDATE SET
       raw_json = excluded.raw_json, fetched_at = excluded.fetched_at,
       refresh_day = excluded.refresh_day, refresh_count = excluded.refresh_count`
  ).run(recordDate, rawJson, Math.floor(Date.now() / 1000), refreshDay, refreshCount);
}
