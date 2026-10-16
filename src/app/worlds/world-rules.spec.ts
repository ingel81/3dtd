import { describe, expect, it } from 'vitest';
import { AUTOSAVE_BUILT_SLOT, AUTOSAVE_OSM_SLOT, AUTOSAVE_SLOT } from '../services/save-game/save-game.port';
import { autosaveSlotOf, heroWorld, runAtRisk, samePick, worldLock, worldOfMap, type AutosaveRun, type WorldPick } from './world-rules';

const HEILBRONN: WorldPick = { kind: 'place', hq: { lat: 49.14, lon: 9.22 }, spawns: [], name: 'Heilbronn' };
const PARIS: WorldPick = { kind: 'place', hq: { lat: 48.86, lon: 2.29 }, spawns: [], name: 'Paris' };
const VALLEY: WorldPick = { kind: 'map', id: 'demo-valley', name: 'Demo Valley' };
const run = (slotId: string, world: AutosaveRun['world'], pick: WorldPick, savedAt = '2026-10-16T08:00:00Z'): AutosaveRun =>
  ({ slotId, world, pick, name: pick.name, wave: 12, savedAt });

/** The rules of the globes and the world menus (docs/WORLDS_NAVIGATION_PLAN.md, 3.2 and 3.5) */
describe('world rules', () => {
  it('locks the real places without a key and the maps before their release; the globes stay clickable', () => {
    expect(worldLock('real', { hasKey: false, mapsOpen: true })).toBe('No map key');
    expect(worldLock('real', { hasKey: true, mapsOpen: false })).toBeNull();
    expect(worldLock('osm', { hasKey: false, mapsOpen: false })).toBe('Coming soon');
    expect(worldLock('maps', { hasKey: false, mapsOpen: true })).toBeNull();
  });

  it('a start asks about the run in its own world only: each world keeps its own autosave', () => {
    const osm = run(AUTOSAVE_OSM_SLOT, 'osm', { kind: 'map', id: 'heilbronn-osm', name: 'Heilbronn' });
    const autosaves = [run(AUTOSAVE_SLOT, 'real', HEILBRONN), osm];
    expect(runAtRisk('real', PARIS, autosaves)?.name).toBe('Heilbronn');
    // The same place is Continue, nothing at risk
    expect(runAtRisk('real', { ...HEILBRONN, hq: { lat: 49.14001, lon: 9.22001 } }, autosaves)).toBeNull();
    // OpenStreetMap's run is none of the Built Worlds'
    expect(runAtRisk('maps', VALLEY, autosaves)).toBeNull();
    expect(runAtRisk('osm', { kind: 'map', id: 'other-osm', name: 'Other' }, autosaves)?.slotId).toBe(AUTOSAVE_OSM_SLOT);
    // A save of before the place was kept is at risk from any place
    expect(runAtRisk('real', HEILBRONN, [{ ...autosaves[0], pick: null }])?.slotId).toBe(AUTOSAVE_SLOT);
  });

  it('gives each world its slot and a map its world: an unchanged OpenStreetMap map is of OpenStreetMap, every other a Built World', () => {
    expect(['real', 'osm', 'maps'].map((w) => autosaveSlotOf(w as 'real'))).toEqual([AUTOSAVE_SLOT, AUTOSAVE_OSM_SLOT, AUTOSAVE_BUILT_SLOT]);
    expect(worldOfMap({ generated: true })).toBe('osm');
    expect(worldOfMap({})).toBe('maps');
    expect(worldOfMap(undefined)).toBe('maps');
  });

  it('names the same pick across kinds only when kind and place or id match', () => {
    expect(samePick(VALLEY, { ...VALLEY, name: 'other name' })).toBe(true);
    expect(samePick(VALLEY, HEILBRONN)).toBe(false);
    expect(samePick({ kind: 'tileset', id: 'a', name: 'A' }, { kind: 'tileset', id: 'a', name: 'B' })).toBe(true);
  });

  it('stands the world of the newest Continue large, else the last world played, else the real places', () => {
    const autosaves = [run(AUTOSAVE_SLOT, 'real', HEILBRONN, '2026-10-15T08:00:00Z'), run(AUTOSAVE_BUILT_SLOT, 'maps', VALLEY, '2026-10-16T08:00:00Z')];
    expect(heroWorld(autosaves, 'osm')).toBe('maps');
    expect(heroWorld([], 'osm')).toBe('osm');
    expect(heroWorld([], null)).toBe('real');
  });
});
