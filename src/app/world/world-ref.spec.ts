import {
  LEGACY_DEV_WORLD_REF,
  customMapRefFromSearch,
  legacyWorldRef,
  sameWorld,
  worldLabel,
  worldRefShape,
  worldUrlValue,
  worldsMatch,
  type WorldRef,
} from './world-ref';

const CESIUM: WorldRef = { kind: 'tiles', source: 'cesium' };
const GOOGLE: WorldRef = { kind: 'tiles', source: 'google' };
const DEV: WorldRef = { kind: 'devworld', terrain: 'flat', seed: 42, buildings: 'dense', spawns: 1 };
const MAP: WorldRef = { kind: 'custom-map', mapId: 'bay', contentHash: 'abc', name: 'Bay' };

describe('WorldRef', () => {
  it('reads a custom map from the link and writes it back', () => {
    expect(customMapRefFromSearch('?world=map:bay')).toEqual({ kind: 'custom-map', mapId: 'bay', contentHash: '' });
    expect(customMapRefFromSearch('?world=map:')).toBeNull();
    expect(customMapRefFromSearch('?devworld')).toBeNull();
    expect(worldUrlValue(MAP)).toBe('map:bay');
    expect(worldUrlValue(DEV)).toBeNull();
  });

  it('maps a file of before the field by its origin', () => {
    expect(legacyWorldRef({ lat: 0, lon: 0 }, 'google')).toEqual(LEGACY_DEV_WORLD_REF);
    expect(legacyWorldRef({ lat: 48.1, lon: 11.5 }, 'google')).toEqual(GOOGLE);
  });

  it('lets a run stand on the tiles of either source, other worlds only on the same one', () => {
    expect(worldsMatch(CESIUM, GOOGLE)).toBe(true);
    expect(sameWorld(CESIUM, GOOGLE)).toBe(false);
    expect(worldsMatch(CESIUM, DEV)).toBe(false);
    expect(worldsMatch(DEV, { ...DEV, seed: 7 })).toBe(false);
    expect(worldsMatch(MAP, { ...MAP, contentHash: 'other' })).toBe(false);
    // A link carries no content hash: any content of the map
    expect(worldsMatch(MAP, { kind: 'custom-map', mapId: 'bay', contentHash: '' })).toBe(true);
  });

  it('checks the shape of a ref read from a file', () => {
    for (const ref of [CESIUM, DEV, MAP]) expect(worldRefShape(JSON.parse(JSON.stringify(ref)))).toEqual(ref);
    expect(worldRefShape({ kind: 'tiles', source: 'bing' })).toBeNull();
    expect(worldRefShape({ kind: 'devworld', terrain: 'flat', seed: 'x', buildings: 'dense', spawns: 1 })).toBeNull();
    expect(worldRefShape(null)).toBeNull();
    expect(worldLabel(MAP)).toBe('map Bay');
  });
});
