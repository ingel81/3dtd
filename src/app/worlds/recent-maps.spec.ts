import { afterEach, describe, expect, it } from 'vitest';
import { forgetRecentMap, loadRecentMaps, overflowWorlds, recordRecentMap } from './recent-maps';

/** The Built Worlds' Recent and the share of the Recent worlds (docs/WORLDS_STATE_PLAN.md, decisions 3, 4, 11) */
describe('recent maps', () => {
  afterEach(() => localStorage.clear());

  it('keeps the five maps played last, newest first, each once, and forgets one on request', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'b']) recordRecentMap(id);
    expect(loadRecentMaps()).toEqual(['b', 'f', 'e', 'd', 'c']);
    forgetRecentMap('f');
    expect(loadRecentMaps()).toEqual(['b', 'e', 'd', 'c']);
  });

  it('sends the oldest generated maps beyond ten to the trash, never one a run plays on', () => {
    const maps = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, updatedAt: `2026-10-${String(10 + i).padStart(2, '0')}` }));
    expect(overflowWorlds(maps, new Set()).map((m) => m.id)).toEqual(['m1', 'm0']);
    expect(overflowWorlds(maps, new Set(['m0'])).map((m) => m.id)).toEqual(['m1']);
    expect(overflowWorlds(maps.slice(0, 10), new Set())).toEqual([]);
  });
});
