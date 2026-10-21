import { afterEach, describe, expect, it } from 'vitest';
import { RECENT_MAPS_KEY, loadRecentMaps, overflowWorlds, recordRecentMap } from './recent-maps';

/** The maps played lately in Built Worlds and the share of the Recent worlds (docs/WORLDS_STATE_PLAN.md, decisions 3, 4, 11) */
describe('recent maps', () => {
  afterEach(() => localStorage.clear());

  it('keeps the five maps played last with when, newest first, each once', () => {
    ['a', 'b', 'c', 'd', 'e', 'f', 'b'].forEach((id, i) => recordRecentMap(id, `2026-10-0${i + 1}T08:00:00Z`));
    expect(loadRecentMaps().map((r) => r.id)).toEqual(['b', 'f', 'e', 'd', 'c']);
    recordRecentMap('c', '2026-10-21T09:41:00Z');
    expect(loadRecentMaps()[0]).toEqual({ id: 'c', at: '2026-10-21T09:41:00Z' });
  });

  it('reads nothing it does not know: ids of the first version, broken entries', () => {
    localStorage.setItem(RECENT_MAPS_KEY, JSON.stringify(['a', { id: 'b' }, { id: 'c', at: '2026-10-21T09:41:00Z' }, null]));
    expect(loadRecentMaps()).toEqual([{ id: 'c', at: '2026-10-21T09:41:00Z' }]);
  });

  it('sends the oldest generated maps beyond ten to the trash, never one a run plays on', () => {
    const maps = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, updatedAt: `2026-10-${String(10 + i).padStart(2, '0')}` }));
    expect(overflowWorlds(maps, new Set()).map((m) => m.id)).toEqual(['m1', 'm0']);
    expect(overflowWorlds(maps, new Set(['m0'])).map((m) => m.id)).toEqual(['m1']);
    expect(overflowWorlds(maps.slice(0, 10), new Set())).toEqual([]);
  });
});
