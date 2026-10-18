// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openStats, StatsWriter, summarize, type RequestRow } from './stats-store.ts';

const row = (t: number, extra: Partial<RequestRow> = {}): RequestRow => ({
  t, status: 200, outcome: 'ok', ms: 1000, msHead: 900, bytes: 100, country: 'DE',
  box: { s: 49.79, w: 9.93, n: 49.81, e: 9.96 }, areaKm2: 4.8, reason: null, ...extra,
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
});
