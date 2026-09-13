import { describe, it, expect, vi } from 'vitest';
import { Color, Scene, Texture, Vector3 } from 'three';
import type { TrailParticleConfig } from '../../configs/projectile-types.config';
import { BURST_PALETTES, EXPLOSION_LOOK, MUZZLE_FLASH_PROFILES } from '../../configs/visual-effects.config';
import { ParticlePoolManager } from './particle-pool-manager';
import {
  emitColorBurst,
  emitConfigurableTrail,
  emitExplosion,
  emitFlameParticle,
  emitMuzzleFlash,
  emitPortalSparks,
} from './particle-emitters';

// Die Atlanten malen auf ein 2D-Canvas, das jsdom nicht hat.
vi.mock('./sprite-atlas-generator', () => ({
  generateExplosionAtlas: () => new Texture(),
  generateSmokeAtlas: () => new Texture(),
}));

const setup = () => {
  const pools = new ParticlePoolManager(new Scene());
  const alive = (pool: 'trailAdditive' | 'trailNormal') => pools.getPool(pool).filter((p) => p.life > 0);
  return { pools, alive };
};

const TRAIL: TrailParticleConfig = {
  enabled: true,
  spawnChance: 1,
  countPerSpawn: 4,
  colorMin: { r: 1, g: 0, b: 0 },
  colorMax: { r: 1, g: 0, b: 0 },
  sizeMin: 1,
  sizeMax: 1,
  lifetimeMin: 0.5,
  lifetimeMax: 0.5,
  velocityX: { min: 0, max: 0 },
  velocityY: { min: 0, max: 0 },
  velocityZ: { min: 0, max: 0 },
  spawnOffset: 0,
};

describe('particle emitters', () => {
  it('emits one flame particle as given', () => {
    const { pools, alive } = setup();
    emitFlameParticle(pools, new Vector3(1, 2, 3), new Vector3(0, 5, 0), new Color(1, 0.5, 0), 2, 0.4);
    const [p] = alive('trailAdditive');
    expect(p.position.toArray()).toEqual([1, 2, 3]);
    expect(p).toMatchObject({ size: 2, maxLife: 0.4, life: 1 });
  });

  it('emits a muzzle flash within the profile count at the shoot position', () => {
    const { pools, alive } = setup();
    const profile = MUZZLE_FLASH_PROFILES.cannon!;
    emitMuzzleFlash(pools, 0, 10, 0, profile);
    const flash = alive('trailAdditive');
    expect(flash.length).toBeGreaterThanOrEqual(profile.countMin);
    expect(flash.length).toBeLessThanOrEqual(profile.countMax);
    for (const p of flash) expect(Math.abs(p.position.y - 10)).toBeLessThanOrEqual(0.15);
  });

  it('takes the trail pool from the blending and spawns nothing past the spawn chance', () => {
    const { pools, alive } = setup();
    expect(emitConfigurableTrail(pools, 0, 0, 0, { ...TRAIL, spawnChance: 0 }, 0.3)).toBe(0.3);
    expect(alive('trailAdditive')).toHaveLength(0);

    emitConfigurableTrail(pools, 0, 0, 0, { ...TRAIL, blending: 'normal' }, 0);
    expect(alive('trailNormal')).toHaveLength(4);
    expect(alive('trailAdditive')).toHaveLength(0);
  });

  it('lays a spiral trail around the path and turns the spiral on for the next one', () => {
    const { pools, alive } = setup();
    const spiral = { ...TRAIL, trailType: 'spiral' as const, spiralRadius: 2, spiralSpeed: 5 };
    const next = emitConfigurableTrail(pools, 10, 0, 0, spiral, 0.5);
    expect(next).toBeCloseTo(0.5 + 5 * 0.016, 12);
    for (const p of alive('trailAdditive')) {
      expect(Math.hypot(p.position.x - 10, p.position.y)).toBeCloseTo(2, 9);
    }
  });

  it('bursts in the palette colours and throws portal sparks out along the facing', () => {
    const { pools, alive } = setup();
    const palette = BURST_PALETTES.arcane;
    emitColorBurst(pools, 0, 0, 0, 12, palette);
    const colours = palette.map((c) => new Color(c.r, c.g, c.b).getHex());
    expect(alive('trailAdditive').every((p) => colours.includes(p.color.getHex()))).toBe(true);

    const fresh = setup();
    emitPortalSparks(fresh.pools, 0, 0, 0, 0, 1, 4, 10, 20, palette);
    for (const p of fresh.alive('trailAdditive')) {
      expect(Math.abs(p.position.x)).toBeLessThanOrEqual(3.6); // across the 8 m opening
      expect(p.velocity.z).toBeGreaterThan(0); // out of the portal
    }
  });

  it('emits the fireball as atlas sprites and the smoke delayed', () => {
    const { pools, alive } = setup();
    emitExplosion(pools, 0, 0, 0, 10, EXPLOSION_LOOK.referenceRadius, 3);
    expect(alive('trailAdditive')).toHaveLength(10);
    expect(alive('trailNormal')).toHaveLength(3);
    expect(alive('trailNormal').every((p) => p.life > 1)).toBe(true);
  });
});
