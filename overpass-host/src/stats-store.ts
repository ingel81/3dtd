/**
 * The statistics of the proxy in SQLite (node:sqlite, WAL): one row per
 * request with its time, outcome, durations, size, country and box, never
 * an address or the query's text. The proxy writes in batches; the status
 * page reads the same file. Rows older than the retention go once an hour.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Box } from './geo.ts';

/**
 * What became of a request:
 * - `ok` Overpass answered 2xx; `upstream` it answered another status
 * - `refused` the query was refused (no box, too large, not readable); `rate`, `concurrent` the client's limit
 * - `busy` no slot within the wait; `down` Overpass could not be reached or is down for a new clone
 * - `origin` a foreign page; `bad` wrong method, path or body
 * - `aborted` the client went before the answer was complete; `timeout` Overpass took longer than the query may
 */
export type Outcome = 'ok' | 'upstream' | 'refused' | 'rate' | 'concurrent' | 'busy' | 'down' | 'origin' | 'bad' | 'aborted' | 'timeout';

export interface RequestRow {
  t: number;
  status: number;
  outcome: Outcome;
  /** From the request to the end of the answer, and to Overpass's headers, ms */
  ms: number;
  msHead: number | null;
  /** Bytes of the answer as sent (compressed where Overpass compressed it) */
  bytes: number;
  /** CF-IPCountry, two letters */
  country: string | null;
  box: Box | null;
  areaKm2: number | null;
  /** Why a query was refused, as a short code (RefusalCode) */
  reason: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS requests (
  t INTEGER NOT NULL,
  status INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  ms INTEGER NOT NULL,
  ms_head INTEGER,
  bytes INTEGER NOT NULL,
  country TEXT,
  s REAL, w REAL, n REAL, e REAL,
  area REAL,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS requests_t ON requests (t);
`;

export function openStats(path: string, readOnly = false): DatabaseSync {
  if (!readOnly) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, readOnly ? { readOnly: true } : {});
  if (!readOnly) {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    db.exec(SCHEMA);
  }
  db.exec('PRAGMA busy_timeout = 2000;');
  return db;
}

export class StatsWriter {
  private readonly insert: StatementSync;
  private pending: RequestRow[] = [];
  private readonly flushTimer: ReturnType<typeof setInterval>;
  private readonly pruneTimer: ReturnType<typeof setInterval>;
  private readonly db: DatabaseSync;
  private readonly keepDays: number;
  private readonly now: () => number;

  constructor(db: DatabaseSync, keepDays: number, now: () => number = Date.now) {
    this.db = db;
    this.keepDays = keepDays;
    this.now = now;
    this.insert = db.prepare(
      'INSERT INTO requests (t, status, outcome, ms, ms_head, bytes, country, s, w, n, e, area, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.flushTimer = setInterval(() => this.flush(), 1000);
    this.pruneTimer = setInterval(() => this.prune(), 3_600_000);
    this.flushTimer.unref();
    this.pruneTimer.unref();
    this.prune();
  }

  add(row: RequestRow): void {
    this.pending.push(row);
    if (this.pending.length >= 500) this.flush();
  }

  /** Write what waits, in one transaction; a failing disk costs the rows, not the proxy */
  flush(): void {
    if (!this.pending.length) return;
    const rows = this.pending;
    this.pending = [];
    try {
      this.db.exec('BEGIN');
      for (const r of rows) {
        this.insert.run(
          r.t, r.status, r.outcome, Math.round(r.ms), r.msHead === null ? null : Math.round(r.msHead), r.bytes, r.country,
          r.box?.s ?? null, r.box?.w ?? null, r.box?.n ?? null, r.box?.e ?? null, r.areaKm2, r.reason,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // no transaction open
      }
      console.error(`stats: ${rows.length} rows lost: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  prune(): void {
    if (!this.keepDays) return;
    try {
      this.db.prepare('DELETE FROM requests WHERE t < ?').run(this.now() - this.keepDays * 86_400_000);
    } catch (error) {
      console.error(`stats: prune failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  close(): void {
    clearInterval(this.flushTimer);
    clearInterval(this.pruneTimer);
    this.flush();
    this.db.close();
  }
}

/** The ranges the status page shows, with the width of one bar */
export const RANGES = {
  '1h': { ms: 3_600_000, bucketMs: 60_000 },
  '24h': { ms: 86_400_000, bucketMs: 900_000 },
  '7d': { ms: 7 * 86_400_000, bucketMs: 7_200_000 },
  '30d': { ms: 30 * 86_400_000, bucketMs: 43_200_000 },
} as const;
export type RangeName = keyof typeof RANGES;

export interface Bucket {
  t: number;
  ok: number;
  limited: number;
  refused: number;
  failed: number;
  /** Of the `ok` answers, ms */
  p50: number | null;
  p95: number | null;
}

export interface Summary {
  range: RangeName;
  from: number;
  to: number;
  bucketMs: number;
  buckets: Bucket[];
  totals: { requests: number; ok: number; bytes: number; p50: number | null; p95: number | null };
  outcomes: { outcome: string; status: number; count: number }[];
  countries: { country: string; count: number }[];
  /** Cells of 0.5°: their centre and how many queries had their box's centre there */
  heat: { lat: number; lon: number; count: number }[];
  /** The last requests that did not end ok */
  problems: { t: number; status: number; outcome: string; ms: number; country: string | null; reason: string | null; box: Box | null }[];
  reasons: { reason: string; count: number }[];
}

const LIMITED = new Set(['rate', 'concurrent']);
const REFUSED = new Set(['refused', 'origin', 'bad']);

const percentile = (sorted: number[], p: number): number | null =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null;

/** What the status page shows of `range` up to `now` */
export function summarize(db: DatabaseSync, range: RangeName, now = Date.now()): Summary {
  const { ms, bucketMs } = RANGES[range];
  const from = Math.floor((now - ms) / bucketMs) * bucketMs + bucketMs;
  const count = Math.round(ms / bucketMs);
  const buckets: Bucket[] = [];
  const durations: number[][] = [];
  for (let k = 0; k < count; k++) {
    buckets.push({ t: from + k * bucketMs, ok: 0, limited: 0, refused: 0, failed: 0, p50: null, p95: null });
    durations.push([]);
  }
  const all: number[] = [];
  let requests = 0;
  let ok = 0;
  let bytes = 0;
  for (const row of db.prepare('SELECT t, outcome, ms, bytes FROM requests WHERE t >= ?').iterate(from) as Iterable<{
    t: number; outcome: string; ms: number; bytes: number;
  }>) {
    const k = Math.floor((row.t - from) / bucketMs);
    const bucket = buckets[k];
    if (!bucket) continue;
    requests++;
    bytes += row.bytes;
    if (row.outcome === 'ok') {
      ok++;
      bucket.ok++;
      durations[k].push(row.ms);
      all.push(row.ms);
    } else if (LIMITED.has(row.outcome)) bucket.limited++;
    else if (REFUSED.has(row.outcome)) bucket.refused++;
    else bucket.failed++;
  }
  for (let k = 0; k < count; k++) {
    const d = durations[k].sort((a, b) => a - b);
    buckets[k].p50 = percentile(d, 0.5);
    buckets[k].p95 = percentile(d, 0.95);
  }
  all.sort((a, b) => a - b);
  const rows = <T>(sql: string, ...params: (number | string)[]): T[] => db.prepare(sql).all(...params) as T[];
  return {
    range,
    from,
    to: from + count * bucketMs,
    bucketMs,
    buckets,
    totals: { requests, ok, bytes, p50: percentile(all, 0.5), p95: percentile(all, 0.95) },
    outcomes: rows('SELECT outcome, status, count(*) AS count FROM requests WHERE t >= ? GROUP BY outcome, status ORDER BY count DESC', from),
    countries: rows("SELECT coalesce(country, '?') AS country, count(*) AS count FROM requests WHERE t >= ? GROUP BY 1 ORDER BY count DESC LIMIT 40", from),
    heat: rows(
      // Shifted to be positive, so that the cast to an integer is the floor
      `SELECT (CAST(((s + n) / 2 + 90) / 0.5 AS INTEGER) + 0.5) * 0.5 - 90 AS lat,
              (CAST(((w + e) / 2 + 180) / 0.5 AS INTEGER) + 0.5) * 0.5 - 180 AS lon, count(*) AS count
       FROM requests WHERE t >= ? AND s IS NOT NULL GROUP BY 1, 2`,
      from,
    ),
    problems: rows<{ t: number; status: number; outcome: string; ms: number; country: string | null; reason: string | null; s: number | null; w: number; n: number; e: number }>(
      "SELECT t, status, outcome, ms, country, reason, s, w, n, e FROM requests WHERE t >= ? AND outcome != 'ok' ORDER BY t DESC LIMIT 60",
      from,
    ).map((r) => ({ t: r.t, status: r.status, outcome: r.outcome, ms: r.ms, country: r.country, reason: r.reason, box: r.s === null ? null : { s: r.s, w: r.w, n: r.n, e: r.e } })),
    reasons: rows('SELECT reason, count(*) AS count FROM requests WHERE t >= ? AND reason IS NOT NULL GROUP BY reason ORDER BY count DESC LIMIT 20', from),
  };
}
