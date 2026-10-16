import { describe, expect, it } from 'vitest';
import { AUTOSAVE_MAP_SLOT, AUTOSAVE_SLOT } from '../services/save-game/save-game.port';
import { heroWorld, runAtRisk, samePick, whyNot, worldLock, type AutosaveRun, type WorldPick, type WorldRuleState } from './world-rules';

const OPEN: WorldRuleState = {
  hasKey: true, mapsOpen: true, coopGuest: false, inCoop: false, runLoaded: true, trial: false, waveRecorded: true,
};
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

  it('says why a way is locked, and nothing where it is open', () => {
    expect(whyNot('play', 'real', { ...OPEN, hasKey: false })).toBe('Needs a map key (Cesium Ion or Google)');
    expect(whyNot('play', 'maps', { ...OPEN, hasKey: false })).toBeNull();
    expect(whyNot('play', 'osm', { ...OPEN, mapsOpen: false })).toBe('Maps are coming soon');
    expect(whyNot('play', 'real', { ...OPEN, coopGuest: true })).toBe('In a coop room the host picks the map');
    expect(whyNot('edit', 'maps', { ...OPEN, mapsOpen: false })).toBe('The editor is coming soon');
    expect(whyNot('edit', 'maps', { ...OPEN, coopGuest: true })).toBe('Leave the coop room to edit');
    expect(whyNot('save', null, { ...OPEN, trial: true })).toBe('A trial run is not saved');
    expect(whyNot('save', null, { ...OPEN, runLoaded: false })).toBe('No run to save');
    expect(whyNot('replay', null, { ...OPEN, waveRecorded: false })).toBe('After the first wave');
    expect(whyNot('leave', null, { ...OPEN, inCoop: true })).toBe('Leave the coop room first');
    for (const action of ['play', 'edit', 'save', 'load', 'restart', 'replay', 'leave'] as const) {
      expect(whyNot(action, 'maps', OPEN)).toBeNull();
    }
  });

  it('a start asks about the run in its own autosave only: the real places keep theirs, OpenStreetMap and the maps share one', () => {
    const autosaves = [run(AUTOSAVE_SLOT, 'real', HEILBRONN), run(AUTOSAVE_MAP_SLOT, 'osm', { kind: 'map', id: 'heilbronn-osm', name: 'Heilbronn (OSM)' })];
    expect(runAtRisk('real', PARIS, autosaves)?.name).toBe('Heilbronn');
    // The same place is Continue, nothing at risk
    expect(runAtRisk('real', { ...HEILBRONN, hq: { lat: 49.14001, lon: 9.22001 } }, autosaves)).toBeNull();
    expect(runAtRisk('maps', VALLEY, autosaves)?.name).toBe('Heilbronn (OSM)');
    expect(runAtRisk('maps', VALLEY, autosaves.slice(0, 1))).toBeNull();
    // A save of before the place was kept is at risk from any place
    expect(runAtRisk('real', HEILBRONN, [{ ...autosaves[0], pick: null }])?.slotId).toBe(AUTOSAVE_SLOT);
  });

  it('names the same pick across kinds only when kind and place or id match', () => {
    expect(samePick(VALLEY, { ...VALLEY, name: 'other name' })).toBe(true);
    expect(samePick(VALLEY, HEILBRONN)).toBe(false);
    expect(samePick({ kind: 'tileset', id: 'a', name: 'A' }, { kind: 'tileset', id: 'a', name: 'B' })).toBe(true);
  });

  it('stands the last world played large, else the one of the newest autosave, else the real places', () => {
    const autosaves = [run(AUTOSAVE_SLOT, 'real', HEILBRONN, '2026-10-15T08:00:00Z'), run(AUTOSAVE_MAP_SLOT, 'maps', VALLEY, '2026-10-16T08:00:00Z')];
    expect(heroWorld(autosaves, 'osm')).toBe('osm');
    expect(heroWorld(autosaves, null)).toBe('maps');
    expect(heroWorld([], null)).toBe('real');
  });
});
