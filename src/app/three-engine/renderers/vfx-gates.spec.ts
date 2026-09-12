import { describe, it, expect, vi } from 'vitest';
import { Scene, Texture, Vector3 } from 'three';
import type { DecalInstanceManager } from './decal-instance.manager';
import { BURST_PALETTES, MUZZLE_FLASH_PROFILES } from '../../configs/visual-effects.config';
import type { TrailParticleConfig } from '../../configs/projectile-types.config';
import { DEFAULT_VFX_SETTINGS, type VfxSettings } from '../vfx-settings';
import { ParticlePoolManager } from './particle-pool-manager';
import { ParticleEffectsRenderer } from './particle-effects-renderer';
import { AuraRenderer } from './aura-renderer';
import { TrailStreakRenderer } from './trail-streak.renderer';
import type { ScorchGround } from './scorch-marks';
import type { CoordinateSync } from './index';

// Die Atlanten malen auf ein 2D-Canvas, das jsdom nicht hat.
vi.mock('./sprite-atlas-generator', () => ({
  generateExplosionAtlas: () => new Texture(),
  generateSmokeAtlas: () => new Texture(),
}));

/** A trail that spawns on every call. */
const TRAIL: TrailParticleConfig = {
  enabled: true,
  spawnChance: 1,
  countPerSpawn: 2,
  colorMin: { r: 1, g: 1, b: 1 },
  colorMax: { r: 1, g: 1, b: 1 },
  sizeMin: 1,
  sizeMax: 1,
  lifetimeMin: 0.5,
  lifetimeMax: 0.5,
  velocityX: { min: 0, max: 0 },
  velocityY: { min: 0, max: 0 },
  velocityZ: { min: 0, max: 0 },
  spawnOffset: 0,
};

/** Every point lies on the route, its ground at 0. */
const FLAT_ROUTE: ScorchGround = {
  getCellAt: (x, z) => ({ key: Math.round(x) * 1000 + Math.round(z) }),
  getGroundLocalYAt: () => 0,
};

function alive(pools: ParticlePoolManager): number {
  return [...pools.getPool('trailAdditive'), ...pools.getPool('trailNormal')].filter((p) => p.life > 0).length;
}

function setup(off: Partial<VfxSettings> = {}) {
  const pools = new ParticlePoolManager(new Scene());
  const sync = { geoToLocal: () => new Vector3() } as unknown as CoordinateSync;
  const effects = new ParticleEffectsRenderer(new Scene(), sync, pools);
  effects.setScorchGround(FLAT_ROUTE);
  effects.setVfxSettings({ ...DEFAULT_VFX_SETTINGS, ...off });
  const { bloodDecalManager, iceDecalManager, scorchMarks } = effects as unknown as {
    bloodDecalManager: DecalInstanceManager;
    iceDecalManager: DecalInstanceManager;
    scorchMarks: { decals: DecalInstanceManager };
  };
  const decalPools = [bloodDecalManager, iceDecalManager, scorchMarks.decals];
  const decals = () => decalPools.reduce((n, pool) => n + pool.count, 0);
  return { pools, effects, decals, decalPools };
}

/** The particle spawns each switch covers. */
const SPAWNS = {
  muzzleFlash: (e: ParticleEffectsRenderer) => e.spawnMuzzleFlash(0, 0, 0, MUZZLE_FLASH_PROFILES.cannon!),
  projectileTrails: (e: ParticleEffectsRenderer) => e.spawnConfigurableTrail(0, 0, 0, TRAIL),
  impactEffects: (e: ParticleEffectsRenderer) => {
    e.spawnExplosion(0, 0, 0, 20, 6, 4);
    e.spawnIceExplosion(0, 0, 0, 20);
    e.spawnBurstAtGeo(0, 0, 0, 14, BURST_PALETTES.arcane);
    e.spawnBloodSplatter(0, 0, 0, 10);
  },
};
type ParticleSwitch = keyof typeof SPAWNS;
const PARTICLE_SWITCHES = Object.keys(SPAWNS) as ParticleSwitch[];

describe('VFX settings in the particle effects', () => {
  it.each(PARTICLE_SWITCHES)('spawns no particles for %s while it is off, and only for it', (key) => {
    const off: Partial<VfxSettings> = {};
    off[key] = false;
    const { pools, effects } = setup(off);

    SPAWNS[key](effects);
    expect(alive(pools)).toBe(0);

    for (const other of PARTICLE_SWITCHES) {
      if (other !== key) SPAWNS[other](effects);
    }
    expect(alive(pools)).toBeGreaterThan(0);
  });

  it('lays no ground marks while they are off and clears the ones lying', () => {
    const { effects, decals, decalPools } = setup();
    const layMarks = () => {
      effects.spawnBloodDecal(0, 0, 0, 2);
      effects.spawnIceDecal(0, 0, 0, 2);
      effects.markScorch(0, 0, 0, 'cannon');
    };
    layMarks();
    expect(decals()).toBe(3);

    effects.setVfxSettings({ ...DEFAULT_VFX_SETTINGS, groundMarks: false });
    expect(decals()).toBe(0);
    for (const pool of decalPools) expect(pool.instancedMesh.visible).toBe(false); // out of the render list
    expect(effects.groundMarksEnabled).toBe(false);

    layMarks();
    expect(decals()).toBe(0);
  });
});

describe('VFX settings in the frost auras', () => {
  it('keeps a hidden frost aura on its enemy and shows it again when switched on', () => {
    const pools = new ParticlePoolManager(new Scene());
    const auras = new AuraRenderer(pools);
    auras.setFrostEnabled(false);
    auras.spawnFrostAura('slowed', new Vector3());
    expect(auras.hasFrostAura('slowed')).toBe(true);
    expect(alive(pools)).toBe(0);

    auras.setFrostEnabled(true);
    expect(alive(pools)).toBe(3);

    auras.setFrostEnabled(false);
    expect(alive(pools)).toBe(0);
    auras.spawnPoisonAura('poisoned', new Vector3()); // not part of the freeze look
    expect(alive(pools)).toBe(3);
  });
});

describe('VFX settings in the trail streaks', () => {
  it('gives no projectile a trail while trails are off and drops the ones in flight', () => {
    const scene = new Scene();
    const trails = new TrailStreakRenderer(scene);
    const drawn = () => scene.children.filter((mesh) => mesh.visible).length;
    expect(trails.create('p1', 'rocket')).toBe(true);
    expect(drawn()).toBe(1);

    trails.setEnabled(false);
    expect(trails.count).toBe(0);
    expect(drawn()).toBe(0);
    expect(trails.create('p2', 'rocket')).toBe(false);

    trails.setEnabled(true);
    expect(trails.create('p3', 'rocket')).toBe(true);
    trails.dispose();
  });
});
