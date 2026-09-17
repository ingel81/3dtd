import { describe, it, expect, vi } from 'vitest';
import { Group, Vector3 } from 'three';
import { GameEventBus } from './game-event-bus';
import { VFXService } from './vfx.service';
import type { ThreeTilesEngine } from '../three-engine';
import {
  ABILITY_DEATH_BLOOD_CAP,
  BURST_PALETTES,
  EXPLOSION_PRESETS,
  FROST_BOMB_ICE_RINGS,
  MISSILE_LAUNCH_LOOK,
  MUZZLE_FLASH_PROFILES,
  NUCLEAR_STRIKE_SCORCH_RINGS,
  PARTICLE_LIMITS,
} from '../configs/visual-effects.config';
import { geoDistanceFast } from '../utils/geo-utils';
import { TOWER_TYPES, type TowerTypeId } from '../configs/tower-types.config';
import { PROJECTILE_TYPES } from '../configs/projectile-types.config';
import { ABILITY_IDS, lockedAbilityStatus } from '../configs/abilities.config';
import type { TowerRenderData } from '../three-engine/renderers/three-tower.renderer';

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
      spawnBloodSplatter: vi.fn(),
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

describe('VFXService hero ammo impacts', () => {
  const impact = (projectileType: string) => {
    const { eventBus, tilesEngine, service } = setup();
    eventBus.emit({ type: 'vfx:projectile-impact', lat: 1, lon: 2, height: 3, projectileType, targetLost: false });
    service.destroy();
    return tilesEngine.effects;
  };

  it('puffs like a bullet for standard rounds', () => {
    expect(impact('hero-round').spawnExplosionAtGeo).toHaveBeenCalledWith(1, 2, 3, EXPLOSION_PRESETS.bullet.particles);
  });

  it('bursts small for explosive rounds', () => {
    const { particles, radius, smokePuffs } = EXPLOSION_PRESETS.heroShell;
    expect(impact('hero-shell').spawnExplosionAtGeo).toHaveBeenCalledWith(1, 2, 3, particles, radius, smokePuffs);
  });

  it('sparks in arcane colours for rune rounds', () => {
    expect(impact('hero-rune').spawnBurstAtGeo)
      .toHaveBeenCalledWith(1, 2, 3, EXPLOSION_PRESETS.heroRune.particles, BURST_PALETTES.arcane);
  });
});

describe('VFXService hero level-up', () => {
  it('raises "LEVEL N" in gold from his head', () => {
    const eventBus = new GameEventBus();
    const spawnFloatingText = vi.fn();
    const tilesEngine = {
      hero: { headPosition: vi.fn((out: Vector3) => out.set(1, 2, 3)) },
      sync: { localToGeo: vi.fn(() => ({ lat: 48.1, lon: 9.2, height: 310 })) },
      effects: { spawnFloatingText },
    };
    const service = new VFXService(eventBus, tilesEngine as unknown as ThreeTilesEngine);
    eventBus.emit({ type: 'hero:level-up', level: 3, position: { lat: 48.1, lon: 9.2 } });
    expect(spawnFloatingText).toHaveBeenCalledWith('LEVEL 3', 48.1, 9.2, 310, expect.objectContaining({ color: '#D9BC68' }));
    service.destroy();
  });

  it('shows nothing while he is not on the map', () => {
    const eventBus = new GameEventBus();
    const spawnFloatingText = vi.fn();
    const tilesEngine = { hero: { headPosition: () => null }, sync: {}, effects: { spawnFloatingText } };
    const service = new VFXService(eventBus, tilesEngine as unknown as ThreeTilesEngine);
    eventBus.emit({ type: 'hero:level-up', level: 2, position: { lat: 0, lon: 0 } });
    expect(spawnFloatingText).not.toHaveBeenCalled();
    service.destroy();
  });
});

describe('VFXService split', () => {
  it('bursts in bone colours a metre above the body a split came from', () => {
    const { eventBus, tilesEngine, service } = setup();
    const enemy = {
      position: { lat: 1, lon: 2 },
      transform: { terrainHeight: 30 },
      heightOffset: 0.5,
      typeConfig: { id: 'skeleton', canBleed: false },
    };
    eventBus.emit({ type: 'enemy:split', enemy: enemy as never, children: [enemy as never] });
    expect(tilesEngine.effects.spawnBurstAtGeo)
      .toHaveBeenCalledWith(1, 2, 31.5, EXPLOSION_PRESETS.bone.particles, BURST_PALETTES.bone);
    expect(tilesEngine.effects.spawnBloodSplatter).not.toHaveBeenCalled();
    service.destroy();
  });

  it('splashes in its blood colour where each piece of a bleeding enemy lands', () => {
    const { eventBus, tilesEngine, service } = setup();
    const ooze = {
      position: { lat: 1, lon: 2 },
      transform: { terrainHeight: 30 },
      heightOffset: 0,
      typeConfig: { id: 'ooze', canBleed: true, bloodColor: '#6fe021', ooze: { maxLengthM: 80, leakDamageFactor: 10 } },
    };
    const clump = { position: { lat: 3, lon: 4 }, transform: { terrainHeight: 10 } };
    eventBus.emit({ type: 'enemy:split', enemy: ooze as never, children: [clump as never, clump as never] });
    expect(tilesEngine.effects.spawnBloodSplatter).toHaveBeenCalledTimes(2);
    expect(tilesEngine.effects.spawnBloodSplatter).toHaveBeenCalledWith(3, 4, 11, 12, 0x6fe021);
    // Its debris comes from its whole body as the band collapses, no bone burst at the tip
    expect(tilesEngine.effects.spawnBurstAtGeo).not.toHaveBeenCalled();
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
    const eventBus = new GameEventBus();
    const tilesEngine = {
      sync: {
        geoToLocalSimpleInto: vi.fn((_lat: number, _lon: number, _h: number, target: Vector3) => target.set(7, 8, 9)),
      },
      effects: { spawnExplosion: vi.fn(), markScorch: vi.fn(), spawnIceDecal: vi.fn(), groundMarksEnabled: true },
      abilityMarkers: { showStrike: vi.fn(), removeStrike: vi.fn(), clear: vi.fn() },
      missileLaunches: { launch: vi.fn(), land: vi.fn(), clear: vi.fn() },
      towers: {
        get: vi.fn((_id: string): TowerRenderData | undefined => undefined),
        setPartShown: vi.fn(),
      },
      mushroomClouds: { detonate: vi.fn(), clear: vi.fn() },
      frostBursts: { burst: vi.fn(), clear: vi.fn() },
      empPulses: { pulse: vi.fn(), clear: vi.fn() },
      orbitalBeams: { fire: vi.fn(), clear: vi.fn() },
    };
    const service = new VFXService(eventBus, tilesEngine as unknown as ThreeTilesEngine);
    const used = () => eventBus.emit({
      type: 'ability:used', abilityId: 'nuclear-strike', strikeId: 3, target: TARGET, radiusM: 25, warningMs: 1500,
    });
    const impact = () => eventBus.emit({
      type: 'ability:impact', abilityId: 'nuclear-strike', strikeId: 3, target: TARGET, radiusM: 25,
    });
    return { eventBus, tilesEngine, service, used, impact };
  }

  it('marks the target on the ground while the strike is on its way', () => {
    const { tilesEngine, service, used } = strikeSetup();
    used();
    expect(tilesEngine.abilityMarkers.showStrike).toHaveBeenCalledWith(3, expect.objectContaining({ x: 7, y: 8, z: 9 }), 25, 1500);
    service.destroy();
  });

  it('flies the missile from the silo onto the target in the warning\'s time, only for a strike with a launch site', () => {
    const { eventBus, tilesEngine, service, used } = strikeSetup();
    const SILO = { lat: 48.01, lon: 9.01, height: 305 };
    // The stand-in conversion puts height into y, so silo and target are told apart
    tilesEngine.sync.geoToLocalSimpleInto.mockImplementation((_lat: number, _lon: number, h: number, target: Vector3) =>
      target.set(7, h, 9));
    used();
    expect(tilesEngine.missileLaunches.launch).not.toHaveBeenCalled();

    eventBus.emit({
      type: 'ability:used', abilityId: 'nuclear-strike', strikeId: 4, target: TARGET, radiusM: 25, warningMs: 6500,
      launch: { towerId: 'silo-1', position: SILO },
    });
    expect(tilesEngine.missileLaunches.launch).toHaveBeenCalledTimes(1);
    const [strikeId, start, target, durationS] = tilesEngine.missileLaunches.launch.mock.calls[0];
    expect([strikeId, durationS]).toEqual([4, 6.5]);
    expect(tilesEngine.towers.get).toHaveBeenCalledWith('silo-1');
    // No render object for the silo: the look values
    expect(start.site).toEqual(new Vector3(7, SILO.height, 9));
    expect(start.nozzle).toEqual(new Vector3(7, SILO.height + MISSILE_LAUNCH_LOOK.missile.baseHeight, 9));
    expect(target.y).toBe(TARGET.height);
    // The marker still goes up on the target
    const [markerId, , markerRadius, markerMs] = tilesEngine.abilityMarkers.showStrike.mock.lastCall!;
    expect([markerId, markerRadius, markerMs]).toEqual([4, 25, 6500]);

    // Another ability with a launch site shows no missile
    eventBus.emit({
      type: 'ability:used', abilityId: 'frost-bomb', strikeId: 5, target: TARGET, radiusM: 20, warningMs: 500,
      launch: { towerId: 'silo-1', position: SILO },
    });
    expect(tilesEngine.missileLaunches.launch).toHaveBeenCalledTimes(1);
    service.destroy();
  });

  it('starts the missile where the placed silo\'s missile node stands, turned and sized as there, and hides that one at once', () => {
    const { eventBus, tilesEngine, service } = strikeSetup();
    const mesh = new Group();
    mesh.position.set(40, 5, -12);
    mesh.rotation.y = 0.7;
    mesh.scale.setScalar(7.36);
    const node = new Group();
    node.name = MISSILE_LAUNCH_LOOK.missile.node;
    node.position.set(0, 0.3126, 0);
    mesh.add(node);
    tilesEngine.towers.get.mockImplementation((id: string) =>
      id === 'silo-1' ? ({ mesh, typeConfig: TOWER_TYPES['missile-silo'] } as unknown as TowerRenderData) : undefined);

    eventBus.emit({
      type: 'ability:used', abilityId: 'nuclear-strike', strikeId: 4, target: TARGET, radiusM: 25, warningMs: 6500,
      launch: { towerId: 'silo-1', position: { lat: 48.01, lon: 9.01, height: 5 } },
    });
    const [, start] = tilesEngine.missileLaunches.launch.mock.calls[0];
    expect(start.nozzle.x).toBeCloseTo(40, 6);
    expect(start.nozzle.y).toBeCloseTo(5 + 0.3126 * 7.36, 6);
    expect(start.nozzle.z).toBeCloseTo(-12, 6);
    expect(start.turn.angleTo(mesh.quaternion)).toBeLessThan(1e-6);
    expect(start.scale).toBeCloseTo(7.36, 6);
    expect(tilesEngine.towers.setPartShown).toHaveBeenCalledWith('missile-silo', MISSILE_LAUNCH_LOOK.missile.node, false);
    expect(tilesEngine.towers.setPartShown.mock.invocationCallOrder[0])
      .toBeLessThan(tilesEngine.missileLaunches.launch.mock.invocationCallOrder[0]);
    service.destroy();
  });

  it('shows the missile in the silo while a charge is ready and no strike is on its way, as each snapshot says', () => {
    const { eventBus, tilesEngine, service } = strikeSetup();
    const snapshot = (charges: number, pending: boolean) => eventBus.emit({
      type: 'ability:state-changed',
      abilities: ABILITY_IDS.map((id) => ({ ...lockedAbilityStatus(id), unlocked: true, launchSite: true, charges, pending })),
    });
    const shown = () => tilesEngine.towers.setPartShown.mock.calls as unknown[][];

    snapshot(1, false);
    // Only the nuclear strike launches from a building
    expect(shown()).toEqual([['missile-silo', MISSILE_LAUNCH_LOOK.missile.node, true]]);
    snapshot(0, true);
    snapshot(0, false);
    snapshot(1, false);
    expect(shown().map((call) => call[2])).toEqual([true, false, false, true]);
    service.destroy();
  });

  it('stands the missile back in the silo on a restart', () => {
    const { eventBus, tilesEngine, service } = strikeSetup();
    eventBus.emit({ type: 'game:reset' });
    expect(tilesEngine.towers.setPartShown).toHaveBeenCalledWith('missile-silo', MISSILE_LAUNCH_LOOK.missile.node, true);
    service.destroy();
  });

  it('lands the missile on the impact, before the mushroom cloud goes up', () => {
    const { tilesEngine, service, impact } = strikeSetup();
    impact();
    expect(tilesEngine.missileLaunches.land).toHaveBeenCalledWith(3);
    expect(tilesEngine.missileLaunches.land.mock.invocationCallOrder[0])
      .toBeLessThan(tilesEngine.mushroomClouds.detonate.mock.invocationCallOrder[0]);
    service.destroy();
  });

  it('removes the marker and sends the mushroom cloud up on the ground point, no pooled explosions', () => {
    const { tilesEngine, service, impact } = strikeSetup();
    impact();
    expect(tilesEngine.abilityMarkers.removeStrike).toHaveBeenCalledWith(3);
    expect(tilesEngine.mushroomClouds.detonate).toHaveBeenCalledWith(expect.objectContaining({ x: 7, y: 8, z: 9 }), 25);
    expect(tilesEngine.effects.spawnExplosion).not.toHaveBeenCalled();
    service.destroy();
  });

  it('burns scorch marks on the ground: the centre and the rings, all on impact', () => {
    const { tilesEngine, service, impact } = strikeSetup();
    impact();
    const calls = tilesEngine.effects.markScorch.mock.calls;
    expect(calls).toHaveLength(1 + NUCLEAR_STRIKE_SCORCH_RINGS.reduce((n, ring) => n + ring.count, 0));
    expect(calls[0]).toEqual([7, 8, 9, 'rocket']);
    // Ground height, the outer ring at its share of the 25 m radius
    expect(calls.every(([, y]) => y === 8)).toBe(true);
    const outer = NUCLEAR_STRIKE_SCORCH_RINGS[NUCLEAR_STRIKE_SCORCH_RINGS.length - 1].distance * 25;
    expect(Math.hypot(calls[calls.length - 1][0] - 7, calls[calls.length - 1][2] - 9)).toBeCloseTo(outer, 6);
    service.destroy();
  });

  it('keeps the death blood of a strike within a third of the normal pool', () => {
    // A death splatter is 40 particles in the normal pool (CombatVfxService.emitDeathBlood)
    expect(ABILITY_DEATH_BLOOD_CAP * 40).toBeLessThanOrEqual(PARTICLE_LIMITS.maxTrailNormalParticlesPerPool / 3);
  });

  it('picks the effects by the ability id: an ability without an entry shows nothing', () => {
    const { eventBus, tilesEngine, service } = strikeSetup();
    // Stands for an ability added later; the typed table would not compile without its entry
    const abilityId = 'later-ability' as never;
    eventBus.emit({ type: 'ability:used', abilityId, strikeId: 4, target: TARGET, radiusM: 25, warningMs: 1500 });
    eventBus.emit({ type: 'ability:impact', abilityId, strikeId: 4, target: TARGET, radiusM: 25 });
    expect(tilesEngine.abilityMarkers.showStrike).not.toHaveBeenCalled();
    expect(tilesEngine.abilityMarkers.removeStrike).not.toHaveBeenCalled();
    expect(tilesEngine.mushroomClouds.detonate).not.toHaveBeenCalled();
    expect(tilesEngine.effects.markScorch).not.toHaveBeenCalled();
    service.destroy();
  });

  it('drops the markers and the clouds on a restart', () => {
    const { eventBus, tilesEngine, service, impact } = strikeSetup();
    impact();
    eventBus.emit({ type: 'game:reset' });
    expect(tilesEngine.abilityMarkers.clear).toHaveBeenCalled();
    expect(tilesEngine.missileLaunches.clear).toHaveBeenCalled();
    expect(tilesEngine.mushroomClouds.clear).toHaveBeenCalled();
    expect(tilesEngine.frostBursts.clear).toHaveBeenCalled();
    expect(tilesEngine.empPulses.clear).toHaveBeenCalled();
    expect(tilesEngine.orbitalBeams.clear).toHaveBeenCalled();
    service.destroy();
  });

  it('orbital laser: the marker with the band of its path, then the beam along it, scorching as it goes', () => {
    const { eventBus, tilesEngine, service } = strikeSetup();
    const path = [TARGET, { lat: TARGET.lat - 0.0005, lon: TARGET.lon, height: TARGET.height }];
    eventBus.emit({ type: 'ability:used', abilityId: 'orbital-laser', strikeId: 7, target: TARGET, radiusM: 5, warningMs: 1000, path });
    const [, center, radius, warning, band] = tilesEngine.abilityMarkers.showStrike.mock.calls[0];
    expect(center).toEqual(expect.objectContaining({ x: 7, y: 8, z: 9 }));
    expect([radius, warning]).toEqual([5, 1000]);
    expect(band).toHaveLength(2);

    eventBus.emit({ type: 'ability:impact', abilityId: 'orbital-laser', strikeId: 7, target: TARGET, radiusM: 5, path });
    expect(tilesEngine.abilityMarkers.removeStrike).toHaveBeenCalledWith(7);
    const [beamPath, beamRadius, speed, burnS, scorch] = tilesEngine.orbitalBeams.fire.mock.calls[0];
    expect(beamPath).toHaveLength(2);
    expect([beamRadius, speed, burnS]).toEqual([5, 18, 4]);
    scorch(1, 2, 3);
    expect(tilesEngine.effects.markScorch).toHaveBeenCalledWith(1, 2, 3, 'beam');
    service.destroy();
  });

  it('EMP: the marker, then the pulse on the ground point, no ground marks', () => {
    const { eventBus, tilesEngine, service } = strikeSetup();
    eventBus.emit({ type: 'ability:used', abilityId: 'emp', strikeId: 6, target: TARGET, radiusM: 30, warningMs: 500 });
    expect(tilesEngine.abilityMarkers.showStrike).toHaveBeenCalledWith(6, expect.objectContaining({ x: 7, y: 8, z: 9 }), 30, 500);

    eventBus.emit({ type: 'ability:impact', abilityId: 'emp', strikeId: 6, target: TARGET, radiusM: 30 });
    expect(tilesEngine.abilityMarkers.removeStrike).toHaveBeenCalledWith(6);
    expect(tilesEngine.empPulses.pulse).toHaveBeenCalledWith(expect.objectContaining({ x: 7, y: 8, z: 9 }), 30);
    expect(tilesEngine.effects.markScorch).not.toHaveBeenCalled();
    expect(tilesEngine.effects.spawnIceDecal).not.toHaveBeenCalled();
    service.destroy();
  });

  it('frost bomb: the marker, then the burst with its rime held for the freeze and frost patches', () => {
    const { eventBus, tilesEngine, service } = strikeSetup();
    eventBus.emit({ type: 'ability:used', abilityId: 'frost-bomb', strikeId: 5, target: TARGET, radiusM: 20, warningMs: 500 });
    expect(tilesEngine.abilityMarkers.showStrike).toHaveBeenCalledWith(5, expect.objectContaining({ x: 7, y: 8, z: 9 }), 20, 500);

    eventBus.emit({ type: 'ability:impact', abilityId: 'frost-bomb', strikeId: 5, target: TARGET, radiusM: 20 });
    expect(tilesEngine.abilityMarkers.removeStrike).toHaveBeenCalledWith(5);
    expect(tilesEngine.frostBursts.burst).toHaveBeenCalledWith(expect.objectContaining({ x: 7, y: 8, z: 9 }), 20, 3);
    expect(tilesEngine.mushroomClouds.detonate).not.toHaveBeenCalled();
    expect(tilesEngine.effects.markScorch).not.toHaveBeenCalled();

    const patches = tilesEngine.effects.spawnIceDecal.mock.calls;
    expect(patches).toHaveLength(1 + FROST_BOMB_ICE_RINGS.reduce((n, ring) => n + ring.count, 0));
    expect(patches[0]).toEqual([TARGET.lat, TARGET.lon, TARGET.height, FROST_BOMB_ICE_RINGS[0].size]);
    // The outer ring at its share of the 20 m radius, on the ground height
    const [lat, lon, height] = patches[patches.length - 1];
    const outer = FROST_BOMB_ICE_RINGS[FROST_BOMB_ICE_RINGS.length - 1].distance * 20;
    expect(geoDistanceFast(TARGET, { lat, lon })).toBeCloseTo(outer, 1);
    expect(height).toBe(TARGET.height);
    service.destroy();
  });

  it('frost bomb: no frost patches while ground marks are off', () => {
    const { eventBus, tilesEngine, service } = strikeSetup();
    tilesEngine.effects.groundMarksEnabled = false;
    eventBus.emit({ type: 'ability:impact', abilityId: 'frost-bomb', strikeId: 5, target: TARGET, radiusM: 20 });
    expect(tilesEngine.frostBursts.burst).toHaveBeenCalled();
    expect(tilesEngine.effects.spawnIceDecal).not.toHaveBeenCalled();
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
