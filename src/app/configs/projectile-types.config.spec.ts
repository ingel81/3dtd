import { describe, it, expect } from 'vitest';
import {
  getAllProjectileTypes,
  getProjectileType,
  PROJECTILE_SOUNDS,
  PROJECTILE_TYPES,
  ProjectileTypeId,
  TrailParticleConfig,
} from './projectile-types.config';
import { PROJECTILE_SOUND_IDS } from './audio.config';
import { TOWER_TYPES } from './tower-types.config';

describe('projectile types config', () => {
  const allIds: ProjectileTypeId[] = ['arrow', 'cannonball', 'arcane-orb', 'ice-shard', 'bullet', 'rocket', 'poison-glob', 'chaos-orb'];

  const expectValidTrail = (trail: TrailParticleConfig) => {
    expect(typeof trail.enabled).toBe('boolean');
    expect(trail.spawnChance).toBeGreaterThanOrEqual(0);
    expect(trail.spawnChance).toBeLessThanOrEqual(1);
    expect(trail.countPerSpawn).toBeGreaterThan(0);

    const colorChannels = ['r', 'g', 'b'] as const;
    colorChannels.forEach((channel) => {
      expect(trail.colorMin[channel]).toBeGreaterThanOrEqual(0);
      expect(trail.colorMin[channel]).toBeLessThanOrEqual(1);
      expect(trail.colorMax[channel]).toBeGreaterThanOrEqual(0);
      expect(trail.colorMax[channel]).toBeLessThanOrEqual(1);
      expect(trail.colorMin[channel]).toBeLessThanOrEqual(trail.colorMax[channel]);
    });

    expect(trail.sizeMin).toBeGreaterThan(0);
    expect(trail.sizeMax).toBeGreaterThan(0);
    expect(trail.sizeMin).toBeLessThanOrEqual(trail.sizeMax);

    expect(trail.lifetimeMin).toBeGreaterThan(0);
    expect(trail.lifetimeMax).toBeGreaterThan(0);
    expect(trail.lifetimeMin).toBeLessThanOrEqual(trail.lifetimeMax);

    expect(trail.velocityX.min).toBeLessThanOrEqual(trail.velocityX.max);
    expect(trail.velocityY.min).toBeLessThanOrEqual(trail.velocityY.max);
    expect(trail.velocityZ.min).toBeLessThanOrEqual(trail.velocityZ.max);

    expect(trail.spawnOffset).toBeGreaterThanOrEqual(0);

    if (trail.blending) {
      expect(['additive', 'normal']).toContain(trail.blending);
    }

    if (trail.trailType) {
      expect(['default', 'spiral']).toContain(trail.trailType);
    }

    if (trail.trailType === 'spiral') {
      expect(trail.spiralRadius).toBeGreaterThan(0);
      expect(trail.spiralSpeed).toBeGreaterThan(0);
    }
  };

  it('contains all projectile types', () => {
    allIds.forEach((id) => {
      expect(PROJECTILE_TYPES[id]).toBeDefined();
    });
  });

  it('getProjectileType() returns correct type for each id', () => {
    allIds.forEach((id) => {
      expect(getProjectileType(id)).toBe(PROJECTILE_TYPES[id]);
    });
  });

  it('getAllProjectileTypes() returns array with 8 elements', () => {
    const all = getAllProjectileTypes();
    expect(all).toHaveLength(8);
  });

  it('has a sound for every projectile type and budgets exactly those sounds', () => {
    allIds.forEach((id) => {
      expect(PROJECTILE_SOUNDS[id].url).toMatch(/^assets\/sounds\/.+\.mp3$/);
    });
    // poison-glob was missing from the budget list until 2026-09-12, so the
    // poison tower's shots never counted against maxProjectileSounds.
    expect([...PROJECTILE_SOUND_IDS].sort()).toEqual(Object.keys(PROJECTILE_SOUNDS).sort());
  });

  it('gives every projectile-firing tower an existing projectile type', () => {
    Object.values(TOWER_TYPES).forEach((tower) => {
      expect(PROJECTILE_TYPES[tower.projectileType]).toBeDefined();
    });
  });

  it('keeps the arcane orb trail violet-to-cyan, not fire coloured', () => {
    // Playtest 2026-09-10: the old red/orange spiral read as a fireball.
    const trail = PROJECTILE_TYPES['arcane-orb'].trailParticles!;
    expect(TOWER_TYPES.magic.projectileType).toBe('arcane-orb');
    [trail.colorMin, trail.colorMax].forEach((c) => {
      expect(c.b).toBeGreaterThan(c.r);
      expect(c.b).toBeGreaterThanOrEqual(0.9);
    });
  });

  it('keeps the rocket trail a thin smoke line, not a fire cloud', () => {
    // Playtest 2026-09-10: too much fire trail. Smoke in the normal pool and
    // a particle count per rocket in flight far below the old ~520.
    const rocket = PROJECTILE_TYPES.rocket;
    const trail = rocket.trailParticles!;
    expect(trail.blending).toBe('normal');
    const gatesPerSecond = rocket.speed / 0.5; // TRAIL_SPAWN_DISTANCE_M in projectile.manager
    const meanLifetime = (trail.lifetimeMin + trail.lifetimeMax) / 2;
    const alivePerRocket = gatesPerSecond * trail.spawnChance * trail.countPerSpawn * meanLifetime;
    expect(alivePerRocket).toBeLessThan(80);
    expect(trail.sizeMax).toBeLessThanOrEqual(1.2);
  });

  it('keeps the chaos orb trail a dark smoke line in the normal pool', () => {
    // Additive particles can only brighten, so the black-violet trail needs
    // the normal pool, and it must stay as cheap per orb as the rocket's.
    const orb = PROJECTILE_TYPES['chaos-orb'];
    const trail = orb.trailParticles!;
    expect(trail.blending).toBe('normal');
    expect(trail.colorMax.b).toBeGreaterThan(trail.colorMax.g);
    expect(Math.max(trail.colorMax.r, trail.colorMax.g, trail.colorMax.b)).toBeLessThan(0.5);
    const gatesPerSecond = orb.speed / 0.5; // TRAIL_SPAWN_DISTANCE_M in projectile.manager
    const meanLifetime = (trail.lifetimeMin + trail.lifetimeMax) / 2;
    const alivePerOrb = gatesPerSecond * trail.spawnChance * trail.countPerSpawn * meanLifetime;
    expect(alivePerOrb).toBeLessThan(40);
  });

  it('all projectile types have required fields and valid values', () => {
    const all = getAllProjectileTypes();
    all.forEach((projectile) => {
      expect(projectile.id).toBeTruthy();
      expect(projectile.visualType).toBeTruthy();
      expect(projectile.scale).toBeGreaterThan(0);
      expect(projectile.speed).toBeGreaterThan(0);

      if (projectile.splashRadius !== undefined) {
        expect(projectile.splashRadius).toBeGreaterThan(0);
      }

      if (projectile.trailParticles) {
        expectValidTrail(projectile.trailParticles);
      }
    });
  });
});
