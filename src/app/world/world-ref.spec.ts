import {
  LEGACY_DEV_WORLD_REF,
  worldRefFromSearch,
  legacyWorldRef,
  sameWorld,
  worldLabel,
  worldPlaceName,
  worldRefShape,
  worldUrlValue,
  worldsMatch,
  worldNotHere,
  type WorldRef,
} from './world-ref';
import { en } from '../i18n/messages/en';

const CESIUM: WorldRef = { kind: 'tiles', source: 'cesium' };
const GOOGLE: WorldRef = { kind: 'tiles', source: 'google' };
const DEV: WorldRef = { kind: 'devworld', terrain: 'flat', seed: 42, buildings: 'dense', spawns: 1 };
const MAP: WorldRef = { kind: 'custom-map', mapId: 'bay', contentHash: 'abc', name: 'Bay' };
const TILESET: WorldRef = { kind: 'tileset', id: 'kalasatama' };

describe('WorldRef', () => {
  it('says why a run cannot stand here: another world, another map, or its map changed since', () => {
    expect(worldNotHere(en, MAP, { ...MAP })).toBeNull();
    // A file of before the content hash fits any content of its map
    expect(worldNotHere(en, { ...MAP, contentHash: '' }, { ...MAP, contentHash: 'new' })).toBeNull();
    expect(worldNotHere(en, MAP, { ...MAP, contentHash: 'edited' }))
      .toBe('The map "Bay" was changed since this run was played on it, so the run cannot go on there.');
    expect(worldNotHere(en, MAP, { kind: 'custom-map', mapId: 'reef', contentHash: 'x' })).toBe('It plays the map "Bay", which is not open here. Open that map first.');
    expect(worldNotHere(en, DEV, CESIUM)).toContain('It plays on another world');
  });

  it('reads a custom map from the link and writes it back', () => {
    expect(worldRefFromSearch('?world=map:bay')).toEqual({ kind: 'custom-map', mapId: 'bay', contentHash: '' });
    expect(worldRefFromSearch('?world=map:')).toBeNull();
    expect(worldRefFromSearch('?devworld')).toBeNull();
    expect(worldUrlValue(MAP)).toBe('map:bay');
    expect(worldUrlValue(DEV)).toBeNull();
  });

  it('reads an own tileset from the link and writes it back', () => {
    expect(worldRefFromSearch('?world=tileset:kalasatama&l=60.18,24.97')).toEqual(TILESET);
    expect(worldRefFromSearch('?world=tileset:')).toBeNull();
    expect(worldRefFromSearch('?world=moon:x')).toBeNull();
    expect(worldUrlValue(TILESET)).toBe('tileset:kalasatama');
    // A real place: the address names it, not the world
    expect(worldPlaceName(TILESET)).toBeNull();
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
    // An own tileset is its own world, not the Google tiles at the same place
    expect(worldsMatch(TILESET, GOOGLE)).toBe(false);
    expect(worldsMatch(TILESET, { kind: 'tileset', id: 'other' })).toBe(false);
    expect(worldsMatch(TILESET, { kind: 'tileset', id: 'kalasatama' })).toBe(true);
    // A link carries no content hash: any content of the map
    expect(worldsMatch(MAP, { kind: 'custom-map', mapId: 'bay', contentHash: '' })).toBe(true);
  });

  it('checks the shape of a ref read from a file', () => {
    for (const ref of [CESIUM, DEV, MAP, TILESET]) expect(worldRefShape(JSON.parse(JSON.stringify(ref)))).toEqual(ref);
    expect(worldRefShape({ kind: 'tiles', source: 'bing' })).toBeNull();
    expect(worldRefShape({ kind: 'devworld', terrain: 'flat', seed: 'x', buildings: 'dense', spawns: 1 })).toBeNull();
    expect(worldRefShape(null)).toBeNull();
    expect(worldRefShape({ kind: 'tileset', id: '' })).toBeNull();
    expect(worldLabel(MAP)).toBe('map Bay');
  });
});
