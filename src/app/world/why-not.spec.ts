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

  it('on the globes: a world without its key or release says so; the run\'s ways say what they lack', () => {
    expect(whyNot('play', { ...open, world: 'real', hasKey: false })).toBe('Needs a map key (Cesium Ion or Google)');
    expect(whyNot('play', { ...open, world: 'maps', hasKey: false })).toBeNull();
    expect(whyNot('play', { ...open, world: 'osm', mapsOpen: false })).toBe('Maps are coming soon');
    // The open world's own play knows nothing of the key
    expect(whyNot('play', { ...open, hasKey: false })).toBeNull();
    expect(whyNot('save', { ...open, trial: true })).toBe('A trial run is not saved');
    expect(whyNot('save', { ...open, runLoaded: false })).toBe('No run to save');
    expect(whyNot('save', { ...open, coopGuest: true })).toBe('In coop the host saves');
    expect(whyNot('load', { ...open, coopGuest: true })).toBe("The room plays the host's map");
    expect(whyNot('restart', { ...open, coopGuest: true })).toBe('The host restarts');
    expect(whyNot('replay', { ...open, waveRecorded: false })).toBe('After the first wave');
    expect(whyNot('leave', { ...open, inCoopRoom: true })).toBe('Leave the coop room first');
    for (const way of ['play', 'edit', 'save', 'load', 'restart', 'replay', 'leave'] as const) {
      expect(whyNot(way, { ...open, world: 'maps', hasKey: true, runLoaded: true, waveRecorded: true })).toBeNull();
    }
  });

  it('names the worlds as the path does: the world the page plays in, as its menu and the pause menu name it', () => {
    expect(worldName('real')).toBe('Real places');
    expect(worldName('osm')).toBe('OpenStreetMap');
    expect(worldName('maps')).toBe('Built Worlds');
    expect(worldName(null)).toBe('DevWorld');
  });
});
