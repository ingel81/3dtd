import { describe, expect, it } from 'vitest';
import { whyNot, worldName, type WhyNotFacts } from './why-not';

/** The reasons beside a blocked way (docs/WORLDS_NAVIGATION_PLAN.md, 3.2) */
describe('whyNot', () => {
  const open: WhyNotFacts = { mapsOpen: true, inCoopRoom: false, coopGuest: false, replay: false };

  it('keeps play and edit open alone, with the maps released', () => {
    expect(whyNot('play', open)).toBeNull();
    expect(whyNot('edit', open)).toBeNull();
  });

  it('says why: the release first, then the coop room, then a replay', () => {
    expect(whyNot('edit', { ...open, mapsOpen: false, inCoopRoom: true })).toBe('Coming soon');
    expect(whyNot('edit', { ...open, inCoopRoom: true, replay: true })).toBe('Leave the coop room to edit');
    expect(whyNot('edit', { ...open, replay: true })).toBe('Leave the replay first');
    expect(whyNot('play', { ...open, inCoopRoom: true, coopGuest: true })).toBe('In a coop room the host picks the map');
  });

  it('names the worlds as the path does', () => {
    expect(worldName({ kind: 'tiles', source: 'google' })).toBe('Real places');
    expect(worldName({ kind: 'custom-map', mapId: 'bay', contentHash: '' })).toBe('Maps');
    expect(worldName({ kind: 'tileset', id: 'campus' })).toBe('Own tilesets');
  });
});
