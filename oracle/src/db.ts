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
      raw_bytes      BLOB,
      fetched_at     INTEGER NOT NULL,
      last_attempt_at INTEGER NOT NULL,
      refresh_day    TEXT NOT NULL,
      refresh_count  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence (
      flight_id          INTEGER PRIMARY KEY,
      request_id         INTEGER NOT NULL,
      record_date        TEXT NOT NULL,
      source_url         TEXT NOT NULL,
      fetched_at         INTEGER NOT NULL,
      raw_bytes          BLOB NOT NULL,
      raw_sha256         TEXT NOT NULL,
      matched_record_json TEXT NOT NULL,
      parsed_version      TEXT NOT NULL,
      evidence_hash        TEXT NOT NULL,
      final_status          TEXT NOT NULL,
      actual_arrival         INTEGER NOT NULL,
      delay_seconds           INTEGER NOT NULL,
      submit_status           TEXT NOT NULL,
      submitted_at             INTEGER,
      confirmed_at             INTEGER,
      tx_hash                   TEXT,
      last_error                TEXT
    );
  `);

  const cacheColumns = db.prepare("PRAGMA table_info(hk_cache)").all() as { name: string }[];
  const evidenceColumns = db.prepare("PRAGMA table_info(evidence)").all() as { name: string }[];
  if (!cacheColumns.some((column) => column.name === "raw_bytes") ||
      !evidenceColumns.some((column) => column.name === "submit_status")) {
    db.close();
    throw new Error("Legacy oracle DB schema: create a new isolated DB_PATH; existing data was not changed");
  }

  return db;
}

/** A DB belongs to exactly one chain and one insurance contract. */
export function bindDb(db: Database.Database, chainId: bigint, contractAddress: string) {
  const expected = `${chainId}:${contractAddress.toLowerCase()}`;
  const row = db.prepare("SELECT value FROM meta WHERE key = 'scope'").get() as { value: string } | undefined;
  if (row && row.value !== expected) throw new Error(`Oracle DB scope mismatch (expected ${expected}, found ${row.value})`);
  if (!row) db.prepare("INSERT INTO meta (key, value) VALUES ('scope', ?)").run(expected);
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
    rawBytes: Buffer;
    rawSha256: string;
    matchedRecordJson: string;
    parsedVersion: string;
    evidenceHash: string;
    finalStatus: string;
    actualArrival: number;
    delaySeconds: number;
  }
) {
  db.prepare(
    `INSERT INTO evidence (flight_id, request_id, record_date, source_url, fetched_at, raw_bytes, raw_sha256, matched_record_json, parsed_version, evidence_hash, final_status, actual_arrival, delay_seconds, submit_status)
     VALUES (@flightId, @requestId, @recordDate, @sourceUrl, @fetchedAt, @rawBytes, @rawSha256, @matchedRecordJson, @parsedVersion, @evidenceHash, @finalStatus, @actualArrival, @delaySeconds, 'prepared')
     ON CONFLICT(flight_id) DO NOTHING`
  ).run(row);
}

export interface EvidenceRow {
  flight_id: number;
  request_id: number;
  record_date: string;
  source_url: string;
  fetched_at: number;
  raw_bytes: Buffer;
  raw_sha256: string;
  matched_record_json: string;
  parsed_version: string;
  evidence_hash: string;
  final_status: string;
  actual_arrival: number;
  delay_seconds: number;
  submit_status: "prepared" | "submitted" | "confirmed";
  submitted_at: number | null;
  confirmed_at: number | null;
  tx_hash: string | null;
  last_error: string | null;
}

export function getEvidence(db: Database.Database, flightId: number): EvidenceRow | undefined {
  return db.prepare("SELECT * FROM evidence WHERE flight_id = ?").get(flightId) as EvidenceRow | undefined;
}

export function markEvidenceSubmitted(db: Database.Database, flightId: number, txHash: string) {
  db.prepare("UPDATE evidence SET submit_status = 'submitted', tx_hash = ?, submitted_at = ?, last_error = NULL WHERE flight_id = ?")
    .run(txHash, Math.floor(Date.now() / 1000), flightId);
}

export function markEvidenceConfirmed(db: Database.Database, flightId: number) {
  db.prepare("UPDATE evidence SET submit_status = 'confirmed', confirmed_at = ?, last_error = NULL WHERE flight_id = ?")
    .run(Math.floor(Date.now() / 1000), flightId);
}

export function markEvidenceError(db: Database.Database, flightId: number, error: string) {
  db.prepare("UPDATE evidence SET last_error = ? WHERE flight_id = ?").run(error, flightId);
}

export function getCachedDay(db: Database.Database, recordDate: string) {
  return db.prepare("SELECT * FROM hk_cache WHERE record_date = ?").get(recordDate) as
    | {
        record_date: string;
        raw_json: string;
        raw_bytes: Buffer | null;
        fetched_at: number;
        last_attempt_at: number;
        refresh_day: string;
        refresh_count: number;
      }
    | undefined;
}

export function saveCachedDay(
  db: Database.Database,
  recordDate: string,
  rawJson: string,
  rawBytes: Buffer | null,
  fetchedAt: number,
  lastAttemptAt: number,
  refreshDay: string,
  refreshCount: number
) {
  db.prepare(
    `INSERT INTO hk_cache (record_date, raw_json, raw_bytes, fetched_at, last_attempt_at, refresh_day, refresh_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(record_date) DO UPDATE SET
       raw_json = excluded.raw_json, fetched_at = excluded.fetched_at,
       raw_bytes = excluded.raw_bytes, last_attempt_at = excluded.last_attempt_at,
       refresh_day = excluded.refresh_day, refresh_count = excluded.refresh_count`
  ).run(recordDate, rawJson, rawBytes, fetchedAt, lastAttemptAt, refreshDay, refreshCount);
}
