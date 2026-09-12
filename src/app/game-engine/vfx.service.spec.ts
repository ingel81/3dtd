import { describe, it, expect, vi } from 'vitest';
import { GameEventBus } from './game-event-bus';
import { VFXService } from './vfx.service';
import type { ThreeTilesEngine } from '../three-engine';
import { EXPLOSION_PRESETS, MUZZLE_FLASH_PROFILES } from '../configs/visual-effects.config';
import type { TowerTypeId } from '../configs/tower-types.config';
import { PROJECTILE_TYPES } from '../configs/projectile-types.config';

function setup() {
  const eventBus = new GameEventBus();
  const tilesEngine = {
    towers: {
      get: vi.fn(() => ({ lat: 0, lon: 0, height: 0, tipY: 12 })),
      triggerMuzzleFlash: vi.fn(),
    },
    sync: { geoToLocal: vi.fn(() => ({ x: 1, y: 0, z: 2 })) },
    effects: {
      spawnMuzzleFlash: vi.fn(),
      spawnArcaneBurstAtGeo: vi.fn(),
      spawnPoisonBurstAtGeo: vi.fn(),
      spawnExplosionAtGeo: vi.fn(),
    },
  };
  const service = new VFXService(eventBus, tilesEngine as unknown as ThreeTilesEngine);
  const fire = (towerTypeId: string) =>
    eventBus.emit({ type: 'vfx:muzzle-flash', towerId: 'tower-1', towerTypeId });
  return { eventBus, tilesEngine, service, fire };
}

describe('VFXService muzzle flash', () => {
  it.each(['archer', 'dual-gatling', 'cannon', 'rocket'] as TowerTypeId[])(
    'flashes for %s with its own profile',
    (typeId) => {
      const { tilesEngine, service, fire } = setup();
      fire(typeId);
      expect(tilesEngine.effects.spawnMuzzleFlash).toHaveBeenCalledWith(1, 12, 2, MUZZLE_FLASH_PROFILES[typeId]);
      service.destroy();
    }
  );

  it.each(['ice', 'magic', 'poison', 'fire', 'lightning', 'tentacle'])('does not flash for %s', (typeId) => {
    const { tilesEngine, service, fire } = setup();
    fire(typeId);
    expect(tilesEngine.effects.spawnMuzzleFlash).not.toHaveBeenCalled();
    expect(tilesEngine.towers.triggerMuzzleFlash).not.toHaveBeenCalled();
    service.destroy();
  });

  it('lights the cannon brighter than the gatling and leaves the bow dark', () => {
    const { tilesEngine, service, fire } = setup();
    fire('archer');
    expect(tilesEngine.towers.triggerMuzzleFlash).not.toHaveBeenCalled();
    fire('cannon');
    fire('dual-gatling');
    const [[, cannon], [, gatling]] = tilesEngine.towers.triggerMuzzleFlash.mock.calls;
    expect(cannon).toBeGreaterThan(gatling);
    service.destroy();
  });
});

describe('VFXService projectile impact', () => {
  const impact = (eventBus: GameEventBus, projectileType: string) =>
    eventBus.emit({ type: 'vfx:projectile-impact', lat: 1, lon: 2, height: 3, projectileType, targetLost: false });

  it('bursts violet/cyan for the arcane orb instead of the fire explosion', () => {
    const { eventBus, tilesEngine, service } = setup();
    impact(eventBus, 'arcane-orb');
    expect(tilesEngine.effects.spawnArcaneBurstAtGeo).toHaveBeenCalledWith(1, 2, 3, expect.any(Number));
    expect(tilesEngine.effects.spawnExplosionAtGeo).not.toHaveBeenCalled();
    service.destroy();
  });

  it('bursts green for the poison glob instead of the fire explosion', () => {
    const { eventBus, tilesEngine, service } = setup();
    impact(eventBus, 'poison-glob');
    expect(tilesEngine.effects.spawnPoisonBurstAtGeo).toHaveBeenCalledWith(1, 2, 3, EXPLOSION_PRESETS.poison.particles);
    expect(tilesEngine.effects.spawnExplosionAtGeo).not.toHaveBeenCalled();
    service.destroy();
  });

  it.each(['ice-shard', 'arrow'])('leaves the %s impact to other effects', (projectileType) => {
    const { eventBus, tilesEngine, service } = setup();
    impact(eventBus, projectileType);
    expect(tilesEngine.effects.spawnExplosionAtGeo).not.toHaveBeenCalled();
    expect(tilesEngine.effects.spawnPoisonBurstAtGeo).not.toHaveBeenCalled();
    service.destroy();
  });

  it('sizes the cannon explosion by its splash radius and the rocket by its preset', () => {
    const { eventBus, tilesEngine, service } = setup();
    impact(eventBus, 'cannonball');
    impact(eventBus, 'rocket');
    const { cannon, rocket } = EXPLOSION_PRESETS;
    expect(tilesEngine.effects.spawnExplosionAtGeo.mock.calls).toEqual([
      [1, 2, 3, cannon.particles, PROJECTILE_TYPES.cannonball.splashRadius, cannon.smokePuffs],
      [1, 2, 3, rocket.particles, rocket.radius, rocket.smokePuffs],
    ]);
    expect(cannon.smokePuffs).toBeGreaterThan(0);
    service.destroy();
  });
});
