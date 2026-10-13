import { AUTOSAVE_VERSION_MS, MemoryVersionBackend, VERSIONS_KEPT, VersionHistory, thinVersions, type MapVersion } from './version-store';

describe('version history', () => {
  const C = '2026-10-11T09:00:00.000Z';

  it('keeps changed saves, spaces autosaves out and holds at most VERSIONS_KEPT', async () => {
    const history = new VersionHistory(new MemoryVersionBackend());
    const t0 = new Date('2026-10-11T10:00:00Z').getTime();
    const at = (ms: number) => new Date(t0 + ms);
    expect(await history.record('m', C, new Uint8Array([1, 2, 3]), true, at(0))).not.toBeNull();
    // The same bytes again: nothing new
    expect(await history.record('m', C, new Uint8Array([1, 2, 3]), true, at(1000))).toBeNull();
    // An autosave soon after: skipped; later: kept
    expect(await history.record('m', C, new Uint8Array([4]), false, at(2000))).toBeNull();
    expect(await history.record('m', C, new Uint8Array([4]), false, at(AUTOSAVE_VERSION_MS + 1))).not.toBeNull();
    for (let k = 0; k < 50; k++) await history.record('m', C, new Uint8Array([5, k]), true, at(AUTOSAVE_VERSION_MS + 10000 + k * 1000));
    const list = await history.list('m', C);
    expect(list).toHaveLength(VERSIONS_KEPT);
    expect(Array.from((await history.bytes(list[0]))!)).toEqual([5, 49]);
    expect(await history.list('other', C)).toEqual([]);
  });

  it("does not show a deleted map's versions to a new map of the same id, and drops them", async () => {
    const backend = new MemoryVersionBackend();
    const history = new VersionHistory(backend);
    await history.record('m', C, new Uint8Array([1]), true);
    const later = '2026-10-12T09:00:00.000Z';
    expect(await history.list('m', later)).toEqual([]);
    await history.record('m', later, new Uint8Array([2]), true);
    expect(await backend.list('m')).toHaveLength(1);
    await history.clear('m', C);
    expect(await backend.list('m')).toHaveLength(1);
    await history.clear('m', later);
    expect(await backend.list('m')).toEqual([]);
  });

  it('thins old versions out instead of cutting them off: a save every ten minutes for ten days', async () => {
    const history = new VersionHistory(new MemoryVersionBackend());
    const t0 = Date.parse('2026-10-01T00:00:00Z');
    const steps = 10 * 24 * 6;
    for (let k = 0; k <= steps; k++) await history.record('m', C, new Uint8Array([k & 255, k >> 8]), true, new Date(t0 + k * 600_000));
    const now = t0 + steps * 600_000;
    const list = await history.list('m', C);
    expect(list.length).toBeLessThanOrEqual(VERSIONS_KEPT);
    const age = (v: MapVersion) => now - Date.parse(v.savedAt);
    // The last hour whole, one an hour back to a day, one a day back to the start
    expect(list.filter((v) => age(v) < 3_600_000)).toHaveLength(6);
    const hours = list.filter((v) => age(v) >= 3_600_000 && age(v) < 86_400_000).map((v) => Math.floor(Date.parse(v.savedAt) / 3_600_000));
    expect(new Set(hours).size).toBe(hours.length);
    expect(hours.length).toBeGreaterThanOrEqual(22);
    expect(Math.max(...list.map(age))).toBeGreaterThan(8 * 86_400_000);
  });

  it('keeps a pinned version through the thinning, and lets it go once unpinned', async () => {
    const backend = new MemoryVersionBackend();
    const history = new VersionHistory(backend);
    const t0 = Date.parse('2026-10-01T10:00:00Z');
    const first = (await history.record('m', C, new Uint8Array([1]), true, new Date(t0)))!;
    await history.pin(first, true);
    // A newer one in the same hour: once that hour is a day back, it alone would stay
    await history.record('m', C, new Uint8Array([2]), true, new Date(t0 + 60_000));
    await history.record('m', C, new Uint8Array([3]), true, new Date(t0 + 2 * 86_400_000));
    const keys = (await history.list('m', C)).map((v) => v.key);
    expect(keys).toContain(first.key);
    expect((await history.list('m', C)).find((v) => v.key === first.key)?.pinned).toBe(true);
    const listed = (await history.list('m', C)).find((v) => v.key === first.key)!;
    expect(thinVersions(await backend.list('m'), t0 + 2 * 86_400_000)).toEqual([]);
    await history.pin(listed, false);
    expect(thinVersions(await backend.list('m'), t0 + 2 * 86_400_000)).toEqual([first.key]);
  });
});
