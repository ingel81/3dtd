import { AUTOSAVE_VERSION_MS, MemoryVersionBackend, VERSIONS_KEPT, VersionHistory } from './version-store';

describe('version history', () => {
  const C = '2026-10-11T09:00:00.000Z';

  it('keeps changed saves, spaces autosaves out and holds the newest 20', async () => {
    const history = new VersionHistory(new MemoryVersionBackend());
    const t0 = new Date('2026-10-11T10:00:00Z').getTime();
    const at = (ms: number) => new Date(t0 + ms);
    expect(await history.record('m', C, new Uint8Array([1, 2, 3]), true, at(0))).not.toBeNull();
    // The same bytes again: nothing new
    expect(await history.record('m', C, new Uint8Array([1, 2, 3]), true, at(1000))).toBeNull();
    // An autosave soon after: skipped; later: kept
    expect(await history.record('m', C, new Uint8Array([4]), false, at(2000))).toBeNull();
    expect(await history.record('m', C, new Uint8Array([4]), false, at(AUTOSAVE_VERSION_MS + 1))).not.toBeNull();
    for (let k = 0; k < 30; k++) await history.record('m', C, new Uint8Array([5, k]), true, at(AUTOSAVE_VERSION_MS + 10000 + k * 1000));
    const list = await history.list('m', C);
    expect(list).toHaveLength(VERSIONS_KEPT);
    expect(Array.from((await history.bytes(list[0]))!)).toEqual([5, 29]);
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
    await history.clear('m');
    expect(await backend.list('m')).toEqual([]);
  });
});
