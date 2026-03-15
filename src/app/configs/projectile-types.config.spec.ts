import { describe, it, expect } from 'vitest';
import {
  getAllProjectileTypes,
  getProjectileType,
  PROJECTILE_TYPES,
  ProjectileTypeId,
  TrailParticleConfig,
} from './projectile-types.config';

describe('projectile types config', () => {
  const allIds: ProjectileTypeId[] = ['arrow', 'cannonball', 'fireball', 'ice-shard', 'bullet', 'rocket', 'poison-glob'];

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

  it('getAllProjectileTypes() returns array with 7 elements', () => {
    const all = getAllProjectileTypes();
    expect(all).toHaveLength(7);
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
