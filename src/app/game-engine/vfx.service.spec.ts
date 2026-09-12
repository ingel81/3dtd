import { describe, it, expect, vi, afterEach } from 'vitest';
import { Vector3 } from 'three';
import { GameEventBus } from './game-event-bus';
import { VFXService } from './vfx.service';
import type { ThreeTilesEngine } from '../three-engine';
import {
  ABILITY_DEATH_BLOOD_CAP,
  BURST_PALETTES,
  EXPLOSION_PRESETS,
  MUZZLE_FLASH_PROFILES,
  NUCLEAR_STRIKE_VFX,
  PARTICLE_LIMITS,
} from '../configs/visual-effects.config';
import type { TowerTypeId } from '../configs/tower-types.config';
import { PROJECTILE_TYPES } from '../configs/projectile-types.config';

function setup() {
  const eventBus = new GameEventBus();
  const tilesEngine = {
    towers: {
      get: vi.fn(() => ({ lat: 0, lon: 0, height: 0, tipY: 12 })),
      triggerMuzzleFlash: vi.fn(),
    },
    sync: {
      geoToLocal: vi.fn(() => ({ x: 1, y: 0, z: 2 })),
      geoToLocalSimpleInto: vi.fn((_lat: number, _lon: number, _h: number, target: Vector3) => target.set(7, 8, 9)),
    },
    effects: {
      markScorch: vi.fn(),
      spawnMuzzleFlash: vi.fn(),
      spawnBurstAtGeo: vi.fn(),
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

describe('VFXService split', () => {
  it('bursts in bone colours a metre above the body a split came from', () => {
    const { eventBus, tilesEngine, service } = setup();
    const enemy = { position: { lat: 1, lon: 2 }, transform: { terrainHeight: 30 }, typeConfig: { heightOffset: 0.5 } };
    eventBus.emit({ type: 'enemy:split', enemy: enemy as never, children: [] });
    expect(tilesEngine.effects.spawnBurstAtGeo)
      .toHaveBeenCalledWith(1, 2, 31.5, EXPLOSION_PRESETS.bone.particles, BURST_PALETTES.bone);
    service.destroy();
  });
});

describe('VFXService projectile impact', () => {
  const impact = (eventBus: GameEventBus, projectileType: string) =>
    eventBus.emit({ type: 'vfx:projectile-impact', lat: 1, lon: 2, height: 3, projectileType, targetLost: false });

  it.each([
    ['arcane-orb', EXPLOSION_PRESETS.arcane.particles, BURST_PALETTES.arcane],
    ['chaos-orb', EXPLOSION_PRESETS.chaos.particles, BURST_PALETTES.chaos],
    ['poison-glob', EXPLOSION_PRESETS.poison.particles, BURST_PALETTES.poison],
  ] as const)('bursts %s in its own palette instead of the fire explosion', (projectileType, particles, palette) => {
    const { eventBus, tilesEngine, service } = setup();
    impact(eventBus, projectileType);
    expect(tilesEngine.effects.spawnBurstAtGeo).toHaveBeenCalledWith(1, 2, 3, particles, palette);
    expect(tilesEngine.effects.spawnExplosionAtGeo).not.toHaveBeenCalled();
    service.destroy();
  });

  it.each(['ice-shard', 'arrow'])('leaves the %s impact to other effects', (projectileType) => {
    const { eventBus, tilesEngine, service } = setup();
    impact(eventBus, projectileType);
    expect(tilesEngine.effects.spawnExplosionAtGeo).not.toHaveBeenCalled();
    expect(tilesEngine.effects.spawnBurstAtGeo).not.toHaveBeenCalled();
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

  it('burns scorch marks under cannon and rocket hits only', () => {
    const { eventBus, tilesEngine, service } = setup();
    for (const type of ['cannonball', 'rocket', 'bullet', 'poison-glob', 'arcane-orb', 'chaos-orb', 'ice-shard', 'arrow']) {
      impact(eventBus, type);
    }
    expect(tilesEngine.effects.markScorch.mock.calls).toEqual([
      [7, 8, 9, 'cannon'],
      [7, 8, 9, 'rocket'],
    ]);
    service.destroy();
  });
});

describe('VFXService nuclear strike', () => {
  const TARGET = { lat: 48, lon: 9, height: 300 };

  function strikeSetup() {
    vi.useFakeTimers();
    const eventBus = new GameEventBus();
    const tilesEngine = {
      sync: {
        geoToLocalSimpleInto: vi.fn((_lat: number, _lon: number, _h: number, target: Vector3) => target.set(7, 8, 9)),
      },
      effects: { spawnExplosion: vi.fn(), markScorch: vi.fn() },
      abilityMarkers: { showStrike: vi.fn(), removeStrike: vi.fn(), clear: vi.fn() },
    };
    const service = new VFXService(eventBus, tilesEngine as unknown as ThreeTilesEngine);
    const used = () => eventBus.emit({
      type: 'ability:used', abilityId: 'nuclear-strike', strikeId: 3, target: TARGET, radiusM: 25, warningMs: 1500,
    });
    const impact = () => eventBus.emit({
      type: 'ability:impact', abilityId: 'nuclear-strike', strikeId: 3, target: TARGET, radiusM: 25, hits: 0, kills: 0,
    });
    return { eventBus, tilesEngine, service, used, impact };
  }
  const explosionCount = 1 + NUCLEAR_STRIKE_VFX.rings.reduce((n, r) => n + r.count, 0);

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks the target on the ground while the strike is on its way', () => {
    const { tilesEngine, service, used } = strikeSetup();
    used();
    expect(tilesEngine.abilityMarkers.showStrike).toHaveBeenCalledWith(3, expect.objectContaining({ x: 7, y: 8, z: 9 }), 25, 1500);
    service.destroy();
  });

  it('removes the marker and stages the explosion: the core first, the rings after', () => {
    const { tilesEngine, service, impact } = strikeSetup();
    impact();
    expect(tilesEngine.abilityMarkers.removeStrike).toHaveBeenCalledWith(3);
    const { core, heightM } = NUCLEAR_STRIKE_VFX;
    expect(tilesEngine.effects.spawnExplosion.mock.calls).toEqual([
      [7, 8 + heightM, 9, core.particles, core.radius, core.smokePuffs],
    ]);

    vi.advanceTimersByTime(1000);
    expect(tilesEngine.effects.spawnExplosion).toHaveBeenCalledTimes(explosionCount);
    expect(tilesEngine.effects.markScorch).toHaveBeenCalledTimes(explosionCount);
    service.destroy();
  });

  it('stays within the particle pools, death blood included', () => {
    const { tilesEngine, service, impact } = strikeSetup();
    impact();
    vi.advanceTimersByTime(1000);
    const calls = tilesEngine.effects.spawnExplosion.mock.calls;
    const fireball = calls.reduce((n, c) => n + (c[3] as number), 0);
    const smoke = calls.reduce((n, c) => n + (c[5] as number), 0);
    expect(fireball).toBeLessThanOrEqual(PARTICLE_LIMITS.maxTrailParticlesPerPool / 4);
    // A death splatter is 40 particles in the normal pool (CombatVfxService.emitDeathBlood)
    expect(smoke + ABILITY_DEATH_BLOOD_CAP * 40).toBeLessThanOrEqual(PARTICLE_LIMITS.maxTrailNormalParticlesPerPool / 3);
    service.destroy();
  });

  it('drops the rings still to go off and the markers on a restart', () => {
    const { eventBus, tilesEngine, service, impact } = strikeSetup();
    impact();
    eventBus.emit({ type: 'game:reset' });
    vi.advanceTimersByTime(1000);
    expect(tilesEngine.effects.spawnExplosion).toHaveBeenCalledTimes(1);
    expect(tilesEngine.abilityMarkers.clear).toHaveBeenCalled();
    service.destroy();
  });
});

describe('VFXService blood', () => {
  it('lays no decal and casts no ray for one while ground marks are off', () => {
    const eventBus = new GameEventBus();
    const tilesEngine = {
      sync: { localToGeo: vi.fn(() => ({ lat: 1, lon: 2, height: 3 })) },
      getTerrainHeightAtGeo: vi.fn(() => 0),
      effects: { spawnBloodSplatter: vi.fn(), spawnBloodDecal: vi.fn(), groundMarksEnabled: false },
    };
    const service = new VFXService(eventBus, tilesEngine as unknown as ThreeTilesEngine);
    const bleed = () => eventBus.emit({ type: 'vfx:blood', position: new Vector3(), intensity: 40 });

    bleed();
    expect(tilesEngine.effects.spawnBloodSplatter).toHaveBeenCalledTimes(1);
    expect(tilesEngine.effects.spawnBloodDecal).not.toHaveBeenCalled();
    expect(tilesEngine.getTerrainHeightAtGeo).not.toHaveBeenCalled();

    tilesEngine.effects.groundMarksEnabled = true;
    bleed();
    expect(tilesEngine.effects.spawnBloodDecal).toHaveBeenCalledTimes(1);
    service.destroy();
  });
});
