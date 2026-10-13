import { Vector2, Vector3 } from 'three';
import { createMapDocument } from '../../map-create';
import { packMapFile, unpackMapFile, validateMapDocument } from '../../map-file';
import { mapToScene } from '../map-coords';
import { setWind, windOf, windSceneDirection, windSwayAtTop, WIND_UNIFORMS } from './wind';
import { CustomMapEnvironment } from './map-environment';

function sample() {
  return createMapDocument({ id: 'wind', name: 'Wind', width: 32, depth: 32, ground: 'flat', seed: 1, now: new Date('2026-10-14T00:00:00Z') });
}

describe('wind', () => {
  it('sways a slender 18 m tree by about a metre at the top in a strong wind', () => {
    expect(windSwayAtTop(1, 18)).toBeGreaterThan(0.8);
    expect(windSwayAtTop(1, 18)).toBeLessThan(1.1);
  });

  it('moves an oak a small part of what the old formula did', () => {
    // The old shader bent h * h * sway / 18 metres: 4 m for a 12 m oak of sway 0.5
    const old = (12 * 12 * 0.5) / 18;
    const now = windSwayAtTop(0.5, 12);
    expect(now).toBeLessThan(0.35);
    expect(now).toBeLessThan(old / 10);
  });

  it('lets small plants move more for their size than tall trees, and rigid ones not at all', () => {
    expect(windSwayAtTop(1, 0.55) / 0.55).toBeGreaterThan(windSwayAtTop(1, 18) / 18);
    expect(windSwayAtTop(0, 12)).toBe(0);
  });

  it('takes the map wind, or the biome default when the map has none', () => {
    const own = { strength: 0.8, direction: 90, gusts: 0.1 };
    expect(windOf({ biome: 'swamp', wind: own })).toBe(own);
    expect(windOf({}).strength).toBeCloseTo(0.35);
    expect(windOf({ biome: 'moon' }).strength).toBe(0);
    expect(windOf({ biome: 'swamp' }).strength).toBeLessThan(windOf({ biome: 'mountain' }).strength);
  });

  it('blows away from where it comes from, in the scene frame of the map', () => {
    const d = new Vector2();
    // From the west: towards map east
    const east = mapToScene(1, 0, 0, new Vector3());
    windSceneDirection(270, d);
    expect(d.x).toBeCloseTo(east.x);
    expect(d.y).toBeCloseTo(east.z);
    // From the north: towards map south
    const south = mapToScene(0, -1, 0, new Vector3());
    windSceneDirection(0, d);
    expect(d.x).toBeCloseTo(south.x);
    expect(d.y).toBeCloseTo(south.z);
  });

  it('clamps strength and gusts into the shared uniforms', () => {
    setWind({ strength: 3, direction: 90, gusts: -1 });
    expect(WIND_UNIFORMS.uWindStrength.value).toBe(1);
    expect(WIND_UNIFORMS.uWindGust.value).toBe(0);
    expect(WIND_UNIFORMS.uWindDir.value.length()).toBeCloseTo(1);
  });

  it('installs the map wind with the environment', () => {
    const doc = sample();
    const env = new CustomMapEnvironment({ ...doc.environment, wind: { strength: 0.6, direction: 180, gusts: 0.3 } });
    expect(WIND_UNIFORMS.uWindStrength.value).toBeCloseTo(0.6);
    expect(WIND_UNIFORMS.uWindDir.value.y).toBeCloseTo(1);
    env.set({ ...doc.environment, wind: undefined, biome: 'moon' });
    expect(WIND_UNIFORMS.uWindStrength.value).toBe(0);
    env.dispose();
  });

  it('keeps the wind in the map file, and maps without it stay valid', () => {
    const doc = sample();
    expect(doc.environment.wind).toBeUndefined();
    expect(validateMapDocument(doc)).toEqual([]);
    doc.environment.wind = { strength: 0.5, direction: 200, gusts: 0.7 };
    expect(unpackMapFile(packMapFile(doc)).doc.environment.wind).toEqual(doc.environment.wind);
    doc.environment.wind = { strength: Number.NaN, direction: 200, gusts: 0.7 };
    expect(validateMapDocument(doc).some((m) => m.includes('wind'))).toBe(true);
  });
});
