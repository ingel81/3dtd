// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { openStats, StatsWriter, summarize, type RequestRow } from './stats-store.ts';

const row = (t: number, extra: Partial<RequestRow> = {}): RequestRow => ({
  t, status: 200, outcome: 'ok', ms: 1000, msHead: 900, bytes: 100, country: 'DE',
  box: { s: 49.79, w: 9.93, n: 49.81, e: 9.96 }, areaKm2: 4.8, reason: null,
  kind: 'streets', client: 'web', browser: 'chrome', version: null, cell: '995,198', ...extra,
});

describe('stats', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const file = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ovstats-'));
    dirs.push(dir);
    return join(dir, 'requests.sqlite');
  };

  it('sums the last hour by minute, with answer times, countries, boxes and problems', () => {
    const path = file();
    const now = 10 * 3_600_000;
    const writer = new StatsWriter(openStats(path), 30, () => now);
    for (let k = 0; k < 10; k++) writer.add(row(now - 60_000 * 30 + k, { ms: 100 * (k + 1) }));
    writer.add(row(now - 1000, { status: 429, outcome: 'rate', country: 'FR', box: null, areaKm2: null }));
    writer.add(row(now - 2000, { status: 400, outcome: 'refused', reason: 'too-large', box: { s: -33.9, w: 151.2, n: -33.8, e: 151.3 } }));
    writer.add(row(now - 5 * 3_600_000));
    writer.close();

    const reader = openStats(path, true);
    const s = summarize(reader, '1h', now);
    expect(s.buckets).toHaveLength(60);
    expect(s.totals).toMatchObject({ requests: 12, ok: 10, p50: 600, p95: 1000 });
    const busy = s.buckets.find((b) => b.ok)!;
    expect(busy).toMatchObject({ ok: 10, p50: 600 });
    expect(s.buckets.reduce((a, b) => a + b.limited, 0)).toBe(1);
    expect(s.buckets.reduce((a, b) => a + b.refused, 0)).toBe(1);
    expect(s.countries).toEqual([{ country: 'DE', count: 11 }, { country: 'FR', count: 1 }]);
    expect(s.heat).toEqual([{ lat: 49.75, lon: 9.75, count: 10 }, { lat: -33.75, lon: 151.25, count: 1 }].sort((a, b) => a.lat - b.lat));
    expect(s.reasons).toEqual([{ reason: 'too-large', count: 1 }]);
    expect(s.problems.map((p) => p.outcome)).toEqual(['rate', 'refused']);
    expect(Object.keys(s.problems[0])).not.toContain('address');
    reader.close();
  });

  it('drops rows past the days it keeps', () => {
    const path = file();
    const day = 86_400_000;
    let now = 40 * day;
    const writer = new StatsWriter(openStats(path), 30, () => now);
    writer.add(row(now - 31 * day));
    writer.add(row(now - day));
    writer.flush();
    writer.prune();
    writer.close();
    const reader = openStats(path, true);
    expect(reader.prepare('SELECT count(*) AS n FROM requests').get()).toEqual({ n: 1 });
    reader.close();
    now = 0;
  });

  it('adds the new columns to a file of the first version and keeps its rows', () => {
    const path = file();
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE requests (t INTEGER NOT NULL, status INTEGER NOT NULL, outcome TEXT NOT NULL, ms INTEGER NOT NULL,
      ms_head INTEGER, bytes INTEGER NOT NULL, country TEXT, s REAL, w REAL, n REAL, e REAL, area REAL, reason TEXT)`);
    old.prepare('INSERT INTO requests (t, status, outcome, ms, bytes) VALUES (?, 200, ?, 10, 5)').run(1000, 'ok');
    old.close();
    const writer = new StatsWriter(openStats(path), 0, () => 2000);
    writer.add(row(1500));
    writer.close();
    const reader = openStats(path, true);
    expect(reader.prepare('SELECT t, kind, cell FROM requests ORDER BY t').all()).toEqual([
      { t: 1000, kind: null, cell: null },
      { t: 1500, kind: 'streets', cell: '995,198' },
    ]);
    reader.close();
  });

  it('sums kinds, clients, versions, places new and asked before, and players per day', () => {
    const path = file();
    const now = Date.parse('2026-10-18T12:00:00Z');
    const writer = new StatsWriter(openStats(path), 30, () => now);
    // A place asked two days ago comes back; another is new today
    writer.add(row(now - 2 * 86_400_000, { cell: '995,198' }));
    writer.add(row(now - 60_000, { cell: '995,198', ms: 300, bytes: 1000 }));
    writer.add(row(now - 50_000, { cell: '994,185', kind: 'osm-world', ms: 700, bytes: 5000 }));
    writer.add(row(now - 40_000, { kind: 'buildings', client: 'desktop', browser: 'electron', version: '0.8.0', cell: null, box: null }));
    writer.add(row(now - 30_000, { kind: 'buildings', outcome: 'rate', status: 429, client: 'desktop', browser: 'electron', version: '0.8.0' }));
    writer.flush();
    writer.setPlace('995,198', { name: 'Würzburg', country: 'DE' });
    writer.setPlayers('2026-10-18', 3);
    writer.setPlayers('2026-10-16', 1);
    expect(writer.hasPlace('995,198')).toBe(true);
    expect(writer.playersOf('2026-10-18')).toBe(3);
    writer.close();

    const reader = openStats(path, true);
    const s = summarize(reader, '24h', now);
    reader.close();
    expect(s.kinds.find((k) => k.kind === 'buildings')).toMatchObject({ count: 2, ok: 1 });
    expect(s.kinds.find((k) => k.kind === 'osm-world')).toMatchObject({ count: 1, ok: 1, bytes: 5000, p50: 700 });
    expect(s.clients).toEqual(expect.arrayContaining([{ client: 'desktop', browser: 'electron', count: 2 }, { client: 'web', browser: 'chrome', count: 2 }]));
    expect(s.versions).toEqual([{ version: '0.8.0', count: 2 }]);
    expect(s.placeCounts).toEqual({ fresh: 1, returning: 1, unnamed: 1 });
    expect(s.places.find((p) => p.cell === '995,198')).toMatchObject({ name: 'Würzburg', country: 'DE', isNew: false, count: 1 });
    expect(s.places.find((p) => p.cell === '994,185')).toMatchObject({ name: null, isNew: true });
    expect(s.days).toEqual([{ day: '2026-10-17', players: null, requests: 0 }, { day: '2026-10-18', players: 3, requests: 4 }]);
  });

  it('counts a town of several cells as one place', () => {
    const path = file();
    const now = Date.parse('2026-10-18T12:00:00Z');
    const writer = new StatsWriter(openStats(path), 30, () => now);
    writer.add(row(now - 3000, { cell: '995,198' }));
    writer.add(row(now - 2000, { cell: '995,199' }));
    writer.add(row(now - 1000, { cell: '995,199' }));
    writer.flush();
    writer.setPlace('995,198', { name: 'Würzburg', country: 'DE' });
    writer.setPlace('995,199', { name: 'Würzburg', country: 'DE' });
    writer.close();
    const reader = openStats(path, true);
    const s = summarize(reader, '1h', now);
    reader.close();
    expect(s.places).toEqual([expect.objectContaining({ name: 'Würzburg', count: 3, cell: '995,199', isNew: true })]);
  });
});
