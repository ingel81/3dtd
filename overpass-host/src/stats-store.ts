/**
 * The statistics of the proxy in SQLite (node:sqlite, WAL): one row per
 * request with its time, outcome, durations, size, country, box, the kind of
 * query, the client's class and the cell of its box, never an address, a
 * User-Agent or the query's text; the names of the cells asked for
 * (places.ts); the count of players per day (players.ts). The proxy writes in
 * batches; the status page reads the same file. Rows older than the retention
 * go once an hour. A file of an older version gets the new columns on open.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { BrowserFamily, ClientKind, QueryKind } from './classify.ts';
import type { Box } from './geo.ts';
import { cellCentre, type PlaceName } from './places.ts';
import { dayOf } from './players.ts';

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
  kind: QueryKind | null;
  client: ClientKind | null;
  browser: BrowserFamily | null;
  /** The desktop app's version */
  version: string | null;
  /** The cell of the box's middle (places.ts), for its name */
  cell: string | null;
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
CREATE TABLE IF NOT EXISTS places (cell TEXT PRIMARY KEY, name TEXT, country TEXT, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS players (day TEXT PRIMARY KEY, players INTEGER NOT NULL);
`;

/** Columns added after the first version, with their type; added to an older file on open */
const ADDED_COLUMNS: [string, string][] = [['kind', 'TEXT'], ['client', 'TEXT'], ['browser', 'TEXT'], ['version', 'TEXT'], ['cell', 'TEXT']];

function migrate(db: DatabaseSync): void {
  const have = new Set((db.prepare('PRAGMA table_info(requests)').all() as { name: string }[]).map((c) => c.name));
  for (const [name, type] of ADDED_COLUMNS) if (!have.has(name)) db.exec(`ALTER TABLE requests ADD COLUMN ${name} ${type}`);
  db.exec('CREATE INDEX IF NOT EXISTS requests_cell ON requests (cell)');
}

export function openStats(path: string, readOnly = false): DatabaseSync {
  if (!readOnly) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, readOnly ? { readOnly: true } : {});
  if (!readOnly) {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    db.exec(SCHEMA);
    migrate(db);
  }
  db.exec('PRAGMA busy_timeout = 2000;');
  return db;
}

export class StatsWriter {
  private readonly insert: StatementSync;
  private readonly named = new Set<string>();
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
      'INSERT INTO requests (t, status, outcome, ms, ms_head, bytes, country, s, w, n, e, area, reason, kind, client, browser, version, cell) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const row of db.prepare('SELECT cell FROM places').all() as { cell: string }[]) this.named.add(row.cell);
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
          r.kind, r.client, r.browser, r.version, r.cell,
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

  /** Whether the cell has its name (or was found nameless) */
  hasPlace(cell: string): boolean {
    return this.named.has(cell);
  }

  /** Keep the name of a cell */
  setPlace(cell: string, place: PlaceName): void {
    this.named.add(cell);
    try {
      this.db.prepare('INSERT OR REPLACE INTO places (cell, name, country, at) VALUES (?, ?, ?, ?)').run(cell, place.name, place.country, this.now());
    } catch (error) {
      console.error(`stats: place not kept: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The players of a day as written so far (the base after a restart) */
  playersOf(day: string): number {
    try {
      return (this.db.prepare('SELECT players FROM players WHERE day = ?').get(day) as { players: number } | undefined)?.players ?? 0;
    } catch {
      return 0;
    }
  }

  /** Write the count of players of a day */
  setPlayers(day: string, players: number): void {
    try {
      this.db.prepare('INSERT INTO players (day, players) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET players = excluded.players').run(day, players);
    } catch (error) {
      console.error(`stats: players not kept: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  prune(): void {
    if (!this.keepDays) return;
    try {
      const before = this.now() - this.keepDays * 86_400_000;
      this.db.prepare('DELETE FROM players WHERE day < ?').run(dayOf(before));
      this.db.prepare('DELETE FROM requests WHERE t < ?').run(before);
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
  /** Per kind of query: how many, of them answered, bytes and answer time of the answered */
  kinds: { kind: string; count: number; ok: number; bytes: number; p50: number | null; p95: number | null }[];
  clients: { client: string; browser: string; count: number }[];
  /** Versions of the desktop app */
  versions: { version: string; count: number }[];
  /** The places of the answered queries, most asked first, with whether the range saw them first */
  places: { cell: string; name: string | null; country: string | null; lat: number; lon: number; count: number; isNew: boolean }[];
  /** Places asked for in the range: first seen in it, seen before it, not named (yet) */
  placeCounts: { fresh: number; returning: number; unnamed: number };
  /** Per UTC day of the range: players (about) and requests */
  days: { day: string; players: number | null; requests: number }[];
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

  const kindTimes = new Map<string, { count: number; ok: number; bytes: number; ms: number[] }>();
  for (const row of db.prepare('SELECT kind, outcome, ms, bytes FROM requests WHERE t >= ? AND kind IS NOT NULL').iterate(from) as Iterable<{
    kind: string; outcome: string; ms: number; bytes: number;
  }>) {
    const k = kindTimes.get(row.kind) ?? { count: 0, ok: 0, bytes: 0, ms: [] };
    k.count++;
    if (row.outcome === 'ok') {
      k.ok++;
      k.bytes += row.bytes;
      k.ms.push(row.ms);
    }
    kindTimes.set(row.kind, k);
  }
  const kinds = [...kindTimes].map(([kind, k]) => {
    const sorted = k.ms.sort((a, b) => a - b);
    return { kind, count: k.count, ok: k.ok, bytes: k.bytes, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
  }).sort((a, b) => b.count - a.count);

  const asked = rows<{ cell: string; count: number; first: number; name: string | null; country: string | null; named: number }>(
    `SELECT r.cell AS cell, count(*) AS count,
            (SELECT min(t) FROM requests f WHERE f.cell = r.cell AND f.outcome = 'ok') AS first,
            p.name AS name, p.country AS country, p.cell IS NOT NULL AS named
     FROM requests r LEFT JOIN places p ON p.cell = r.cell
     WHERE r.t >= ? AND r.cell IS NOT NULL AND r.outcome = 'ok' GROUP BY r.cell ORDER BY count DESC`,
    from,
  );
  const placeCounts = { fresh: 0, returning: 0, unnamed: 0 };
  for (const a of asked) {
    if (a.first >= from) placeCounts.fresh++;
    else placeCounts.returning++;
    if (!a.named) placeCounts.unnamed++;
  }
  // One line per named place (a town of several cells counts once, at its busiest cell); a nameless cell stands alone
  const byPlace = new Map<string, Summary['places'][number]>();
  for (const a of asked) {
    const key = a.name ? `${a.name}|${a.country ?? ''}` : a.cell;
    const known = byPlace.get(key);
    if (known) {
      known.count += a.count;
      known.isNew &&= a.first >= from;
    } else {
      byPlace.set(key, { cell: a.cell, name: a.name, country: a.country, ...cellCentre(a.cell), count: a.count, isNew: a.first >= from });
    }
  }
  const places = [...byPlace.values()].sort((x, y) => y.count - x.count).slice(0, 40);

  const playersByDay = new Map(rows<{ day: string; players: number }>('SELECT day, players FROM players WHERE day >= ?', dayOf(from)).map((r) => [r.day, r.players]));
  const requestsByDay = new Map(rows<{ day: string; requests: number }>(
    "SELECT strftime('%Y-%m-%d', t / 1000, 'unixepoch') AS day, count(*) AS requests FROM requests WHERE t >= ? GROUP BY 1",
    from,
  ).map((r) => [r.day, r.requests]));
  // Every day of the range, the quiet ones too, so the chart keeps its scale
  const days: Summary['days'] = [];
  for (let t = Date.parse(`${dayOf(from)}T00:00:00Z`); t <= now; t += 86_400_000) {
    const day = dayOf(t);
    days.push({ day, players: playersByDay.get(day) ?? null, requests: requestsByDay.get(day) ?? 0 });
  }
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
    kinds,
    clients: rows('SELECT client, browser, count(*) AS count FROM requests WHERE t >= ? AND client IS NOT NULL GROUP BY client, browser ORDER BY count DESC', from),
    versions: rows("SELECT version, count(*) AS count FROM requests WHERE t >= ? AND client = 'desktop' AND version IS NOT NULL GROUP BY version ORDER BY count DESC LIMIT 20", from),
    places,
    placeCounts,
    days,
  };
}
