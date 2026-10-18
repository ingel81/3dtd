import { describe, it, expect } from 'vitest';
import { BEAM_LIGHTS, BLAST_LIGHTS, FLIGHT_LIGHTS, IMPACT_LIGHTS, LIGHTNING_LIGHT, MUZZLE_LIGHTS, type ShotLightLook } from './shot-lights.config';
import { MUZZLE_FLASH_PROFILES } from './visual-effects.config';
import { PROJECTILE_TYPES } from './projectile-types.config';

type AnyLook = ShotLightLook & { durationS?: number; jitter?: number };
const looks: [string, AnyLook][] = [
  ...Object.entries(MUZZLE_LIGHTS),
  ...Object.entries(FLIGHT_LIGHTS),
  ...Object.entries(IMPACT_LIGHTS),
  ...Object.entries(BEAM_LIGHTS),
  ...Object.entries(BLAST_LIGHTS),
  ['lightning', LIGHTNING_LIGHT] as const,
].map(([id, look]) => [id, look as AnyLook]);

describe('shot lights config', () => {
  it('lights a muzzle only where it flashes, never the bow', () => {
    for (const id of Object.keys(MUZZLE_LIGHTS)) expect(MUZZLE_FLASH_PROFILES).toHaveProperty(id);
    expect(MUZZLE_LIGHTS).not.toHaveProperty('archer');
  });

  it('names real projectiles and looks', () => {
    for (const id of Object.keys(IMPACT_LIGHTS)) expect(PROJECTILE_TYPES).toHaveProperty(id);
    const visuals = new Set(Object.values(PROJECTILE_TYPES).map((p) => p.visualType));
    for (const visual of Object.keys(FLIGHT_LIGHTS)) expect(visuals).toContain(visual);
  });

  it.each(looks)('%s has a colour, a strength, a reach, and a pulse ends', (_id, look) => {
    for (const c of look.color) expect(c).toBeGreaterThanOrEqual(0);
    expect(Math.max(...look.color)).toBeLessThanOrEqual(1);
    expect(look.intensity).toBeGreaterThan(0);
    expect(look.radius).toBeGreaterThan(0);
    if (look.durationS !== undefined) expect(look.durationS).toBeGreaterThan(0);
    if (look.jitter !== undefined) expect(look.jitter).toBeLessThan(1);
  });

  it('lights the heavy guns brighter and wider than the gatling', () => {
    const gatling = MUZZLE_LIGHTS['dual-gatling']!;
    for (const heavy of [MUZZLE_LIGHTS.cannon!, MUZZLE_LIGHTS.bastion!]) {
      expect(heavy.intensity).toBeGreaterThan(gatling.intensity);
      expect(heavy.radius).toBeGreaterThan(gatling.radius);
    }
  });
});
