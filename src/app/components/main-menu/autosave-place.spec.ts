import { describe, expect, it } from 'vitest';
import { autosaveElsewhere, startPlaceGuess } from './autosave-place';
import { AUTOSAVE_SLOT, type SaveSlotInfo } from '../../services/save-game/save-game.port';
import type { RecentLocation } from '../../services/location/recent-locations';

const HEILBRONN = { lat: 49.14227, lon: 9.21878 };
const PARIS = { lat: 48.85341, lon: 2.3488 };

const autosave = (hq: { lat: number; lon: number } | null, location = 'Kiliansplatz, Heilbronn, Deutschland'): SaveSlotInfo => ({
  id: AUTOSAVE_SLOT, name: 'Heilbronn, wave 3', autosave: true, wave: 3, location,
  savedAt: '2026-10-08T20:00:00Z', gameVersion: '0.6.0', note: null,
  hq,
});
const recent = (hq: { lat: number; lon: number }, spawns = [{ lat: hq.lat + 0.005, lon: hq.lon }]): RecentLocation =>
  ({ hq, spawns, name: 'x', visitedAt: 1 });

describe('startPlaceGuess', () => {
  it('takes the autosave\'s place with the spawns of its recent entry', () => {
    const lanes = [{ lat: 49.15, lon: 9.22 }, { lat: 49.13, lon: 9.2 }];
    expect(startPlaceGuess(autosave(HEILBRONN), [recent(PARIS), recent(HEILBRONN, lanes)], '')).toEqual({
      hq: HEILBRONN, spawns: lanes, source: 'last run',
    });
  });

  it('takes the autosave\'s place with a random spawn when no recent entry knows it', () => {
    expect(startPlaceGuess(autosave(HEILBRONN), [recent(PARIS)], '')).toEqual({ hq: HEILBRONN, spawns: [], source: 'last run' });
  });

  it('takes the last place played without an autosave, or one saved before slots kept the HQ', () => {
    const last = recent(PARIS);
    expect(startPlaceGuess(null, [last], '')).toEqual({ hq: PARIS, spawns: last.spawns, source: 'last played' });
    expect(startPlaceGuess(autosave(null), [last], '')?.hq).toEqual(PARIS);
  });

  it('has none on a first visit and for an invite link', () => {
    expect(startPlaceGuess(null, [], '')).toBeNull();
    expect(startPlaceGuess(autosave(HEILBRONN), [recent(PARIS)], '?room=ABCD')).toBeNull();
  });
});

describe('autosaveElsewhere', () => {
  it('compares the HQs at the precision of the URL', () => {
    expect(autosaveElsewhere(autosave(HEILBRONN), { hq: { lat: 49.142271, lon: 9.218781 }, name: '' })).toBe(false);
    expect(autosaveElsewhere(autosave(PARIS), { hq: HEILBRONN, name: '' })).toBe(true);
  });

  it('falls back to the town of an older slot without the HQ', () => {
    expect(autosaveElsewhere(autosave(null), { hq: HEILBRONN, name: 'Allee 1, Heilbronn, Deutschland' })).toBe(false);
    expect(autosaveElsewhere(autosave(null, 'Rue de Rivoli, Paris, France'), { hq: HEILBRONN, name: 'Heilbronn' })).toBe(true);
  });

  it('leaves nothing with no place loaded', () => {
    expect(autosaveElsewhere(autosave(PARIS), { hq: null, name: '' })).toBe(false);
  });
});
