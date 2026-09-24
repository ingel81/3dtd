import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock three.js — TowerCombatService uses Vector3 for hot-path math.
vi.mock('three', async () => await import('@/test/mocks/three.mock'));

// Mock Angular DI: inject() returns minimal stubs for the four services
// TowerCombatService injects.
const mockInjections: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    inject: (token: { name?: string }) => mockInjections[token?.name ?? ''] ?? {},
  };
});

import { TowerCombatService } from './tower-combat.service';
import { NO_RESEARCH } from '../../managers/research.manager';
import { COMBAT_TUNING } from '../../configs/combat-tuning.config';
import { GAME_BALANCE } from '../../configs/game-balance.config';
import { Tower } from '../../entities/tower.entity';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';

/**
 * Coverage:
 * - calculateHeading: pure geo→radian heading math
 * - getEffectiveDPS / getEffectiveBeamWidth: upgrade-aware private getters
 * - Beam-state cleanup (stopTowerBeam, stopAllBeams) — flame-sound + throttle map
 * - updateBeamTowers: acquires only inside the flame, flame follows the range
 * - Turret heading without a target: held during a wave, guard heading after
 *
 * Targeting strategies (closest/strongest/nearest/lowest-hp) live on
 * Tower.findTarget and are covered by tower.entity.spec.ts. Beam cone
 * geometry depends on a real engine and is left for an integration test.
 */
describe('TowerCombatService', () => {
  let service: TowerCombatService;

  beforeEach(() => {
    Object.keys(mockInjections).forEach(k => delete mockInjections[k]);
    mockInjections['GlobalRouteGridService'] = {};
    mockInjections['SpatialGridService'] = {};
    mockInjections['CombatEffectService'] = {};
    service = new TowerCombatService();
  });

  // ────────────────────────────────────────────────────────────────
  // calculateHeading
  // ────────────────────────────────────────────────────────────────
  describe('calculateHeading', () => {
    it('points 0 rad for due-north target (same lon, +lat)', () => {
      const h = service.calculateHeading({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
      expect(h).toBeCloseTo(0, 6);
    });

    it('points π/2 (east) for +lon delta', () => {
      const h = service.calculateHeading({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
      expect(h).toBeCloseTo(Math.PI / 2, 6);
    });

    it('points π or -π (south) for -lat delta', () => {
      const h = service.calculateHeading({ lat: 1, lon: 0 }, { lat: 0, lon: 0 });
      expect(Math.abs(h)).toBeCloseTo(Math.PI, 6);
    });

    it('points -π/2 (west) for -lon delta', () => {
      const h = service.calculateHeading({ lat: 0, lon: 1 }, { lat: 0, lon: 0 });
      expect(h).toBeCloseTo(-Math.PI / 2, 6);
    });

    it('is metric: a target as far north as east is π/4 away at 48°N too', () => {
      // A degree of longitude is cos(lat) shorter than a degree of latitude;
      // on raw degree deltas this target read as 56° instead of 45°.
      const lat = 48;
      const meters = 30;
      const mPerDegLon = METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
      const h = service.calculateHeading(
        { lat, lon: 9 },
        { lat: lat + meters / METERS_PER_DEGREE_LAT, lon: 9 + meters / mPerDegLon },
      );
      expect(h).toBeCloseTo(Math.PI / 4, 6);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // getEffectiveDPS — accessed via type assertion
  // ────────────────────────────────────────────────────────────────
  describe('getEffectiveDPS', () => {
    interface PrivateApi {
      getEffectiveDPS: (tower: unknown) => number;
    }
    function priv(svc: TowerCombatService): PrivateApi {
      return svc as unknown as PrivateApi;
    }

    it('returns the config DPS when no damage upgrades exist', () => {
      const tower = {
        typeConfig: { damagePerSecond: 30, upgrades: [] },
        getUpgradeLevel: () => 0,
      };
      expect(priv(service).getEffectiveDPS(tower)).toBe(30);
    });

    it('falls back to default 30 when damagePerSecond is missing', () => {
      const tower = {
        typeConfig: { upgrades: [] },
        getUpgradeLevel: () => 0,
      };
      expect(priv(service).getEffectiveDPS(tower)).toBe(30);
    });

    it('multiplies DPS by the damage-upgrade level', () => {
      const tower = {
        typeConfig: {
          damagePerSecond: 30,
          upgrades: [{ id: 'damage', maxLevel: 25, effect: { stat: 'damage', multiplier: 1.5 } }],
        },
        getUpgradeLevel: (id: string) => (id === 'damage' ? 2 : 0),
      };
      // 30 × 1.5² = 67.5
      expect(priv(service).getEffectiveDPS(tower)).toBeCloseTo(67.5, 5);
    });

    it('ignores damage upgrade at level 0', () => {
      const tower = {
        typeConfig: {
          damagePerSecond: 30,
          upgrades: [{ id: 'damage', maxLevel: 25, effect: { stat: 'damage', multiplier: 1.5 } }],
        },
        getUpgradeLevel: () => 0,
      };
      expect(priv(service).getEffectiveDPS(tower)).toBe(30);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // getEffectiveBeamWidth
  // ────────────────────────────────────────────────────────────────
  describe('getEffectiveBeamWidth', () => {
    interface PrivateApi {
      getEffectiveBeamWidth: (tower: unknown) => number;
    }
    function priv(svc: TowerCombatService): PrivateApi {
      return svc as unknown as PrivateApi;
    }

    it('returns config beamWidth when no upgrade present', () => {
      const tower = {
        typeConfig: { beamWidth: 6, upgrades: [] },
        getUpgradeLevel: () => 0,
      };
      expect(priv(service).getEffectiveBeamWidth(tower)).toBe(6);
    });

    it('falls back to default 8 when beamWidth is missing', () => {
      const tower = {
        typeConfig: { upgrades: [] },
        getUpgradeLevel: () => 0,
      };
      expect(priv(service).getEffectiveBeamWidth(tower)).toBe(8);
    });

    it('multiplies width by beamWidth-upgrade level', () => {
      const tower = {
        typeConfig: {
          beamWidth: 6,
          upgrades: [{ id: 'wide-burn', maxLevel: 10, effect: { stat: 'beamWidth', multiplier: 1.25 } }],
        },
        getUpgradeLevel: (id: string) => (id === 'wide-burn' ? 3 : 0),
      };
      // 6 × 1.25³ = 11.71875
      expect(priv(service).getEffectiveBeamWidth(tower)).toBeCloseTo(11.71875, 5);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Beam-state cleanup
  // ────────────────────────────────────────────────────────────────
  describe('stopTowerBeam / stopAllBeams', () => {
    interface PrivateState {
      lastBeamBloodEffect: Map<string, number>;
      activeFlameSounds: Map<string, string>;
      tilesEngine: { flameBeams?: { stopBeam: ReturnType<typeof vi.fn> } } | null;
    }
    function priv(svc: TowerCombatService): PrivateState {
      return svc as unknown as PrivateState;
    }

    it('stopTowerBeam stops the beam and keeps the per-enemy throttle', () => {
      // The throttle is keyed by enemy id and shared by all fire towers;
      // selling one tower has nothing to remove from it.
      const p = priv(service);
      p.tilesEngine = { flameBeams: { stopBeam: vi.fn() } };
      p.lastBeamBloodEffect.set('e-1', 999);

      service.stopTowerBeam('t-1');
      expect(p.tilesEngine!.flameBeams!.stopBeam).toHaveBeenCalledWith('t-1');
      expect(p.lastBeamBloodEffect.get('e-1')).toBe(999);
    });

    it('stopTowerBeam tolerates a missing tilesEngine', () => {
      priv(service).tilesEngine = null;
      expect(() => service.stopTowerBeam('t-X')).not.toThrow();
    });

    it('stopAllBeams clears the entire throttle map', () => {
      const p = priv(service);
      p.tilesEngine = {
        flameBeams: {
          stopBeam: vi.fn(),
          clear: vi.fn(),
        },
      } as never;
      p.lastBeamBloodEffect.set('t-1', 1);
      p.lastBeamBloodEffect.set('t-2', 2);

      service.stopAllBeams();
      expect(p.lastBeamBloodEffect.size).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // updateBeamTowers: flame reach (enemy in a cell the tower sees)
  // ────────────────────────────────────────────────────────────────
  describe('updateBeamTowers flame reach', () => {
    const towerPos = { lat: 48.0, lon: 9.0, height: 0 };

    /** Ground enemy `meters` due north of the tower. */
    function enemyNorthOf(meters: number) {
      return {
        id: `e-${meters}`,
        alive: true,
        position: { lat: towerPos.lat + meters / METERS_PER_DEGREE_LAT, lon: towerPos.lon },
        typeConfig: { id: 'zombie', isAirUnit: false, heightOffset: 0, scale: 1 },
        heightOffset: 0,
        transform: { terrainHeight: 0 },
        movement: { getPathProgress: () => 0.5 },
      };
    }

    /**
     * The enemy stands in a cell the tower sees (its visibleCells), so the
     * exact range check of findTarget decides.
     */
    function setup(enemyDistance: number) {
      const enemy = enemyNorthOf(enemyDistance);
      const getEnemiesForTower = vi.fn((_cells: unknown[], out: unknown[]) => {
        out.length = 0;
        out.push(enemy);
        return out;
      });
      mockInjections['GlobalRouteGridService'] = {
        getEnemiesForTower,
        getBodyEnemies: () => [],
        isPositionVisibleFromTower: () => true,
      };
      mockInjections['CombatEffectService'] = { applyBeamDamage: vi.fn() };
      service = new TowerCombatService();

      const engine = {
        sync: {
          geoToLocalSimple: () => ({ x: 0, y: 0, z: 0 }),
          geoToLocalSimpleInto: (_lat: number, _lon: number, _h: number, target: unknown) => target,
        },
        towers: {},
        flameBeams: { startBeam: vi.fn(), stopBeam: vi.fn() },
      };
      service.initialize(engine as never, NO_RESEARCH);
      // Cone geometry needs real Vector3 math, which the three mock lacks.
      (service as unknown as { getEnemiesInCone: () => unknown[] }).getEnemiesInCone = () => [];

      const tower = new Tower(towerPos, 'fire');
      tower.losReady = true;
      tower.visibleCells = [{} as never];
      const towerManager = { getAllActive: () => [tower] };
      const run = () => service.updateBeamTowers(16, towerManager as never, {} as never, 1000);
      return { engine, tower, getEnemiesForTower, run };
    }

    it('does not acquire an enemy beyond the flame', () => {
      // Regression: detection was 25 m against a 20 m flame, so the tower
      // aimed at enemies in that ring and burnt nothing.
      const { tower, engine, run } = setup(22);
      expect(tower.combat.range).toBeLessThan(22);

      run();
      expect(engine.flameBeams.startBeam).not.toHaveBeenCalled();
      expect(engine.flameBeams.stopBeam).toHaveBeenCalled();
    });

    it('burns an enemy inside the flame with a cone as long as the range', () => {
      const { tower, engine, run } = setup(18);

      run();
      expect(engine.flameBeams.startBeam).toHaveBeenCalledWith(
        tower.id, expect.anything(), expect.anything(), tower.combat.range, expect.any(Number),
      );
      expect(engine.flameBeams.stopBeam).not.toHaveBeenCalled();
    });

    it('burns nothing and puts the flame out on hold fire', () => {
      const { tower, engine, run } = setup(18);
      tower.holdFire = true;

      run();
      expect(engine.flameBeams.startBeam).not.toHaveBeenCalled();
      expect(engine.flameBeams.stopBeam).toHaveBeenCalledWith(tower.id);
    });

    it('range upgrades lengthen the flame', () => {
      const { tower, engine, run } = setup(21);
      for (let i = 0; i < 3; i++) tower.applyUpgrade('range');
      expect(tower.combat.range).toBeGreaterThan(21);

      run();
      expect(engine.flameBeams.startBeam.mock.calls[0][3]).toBeCloseTo(tower.combat.range, 6);
    });

    it('leaves the exact range check to findTarget', () => {
      // Inside the query margin, outside combat.range: candidate but no target.
      const { engine, run } = setup(21);
      run();
      expect(engine.flameBeams.startBeam).not.toHaveBeenCalled();
      expect(engine.flameBeams.stopBeam).toHaveBeenCalled();
    });

    it('drops the blood-throttle entry of an enemy the beam killed', () => {
      const { run } = setup(10);
      const svc = service as unknown as {
        getEnemiesInCone: (...args: unknown[]) => unknown[];
        combatEffectService: {
          applyBeamDamage: (e: { alive: boolean }) => void;
          applyBurn: ReturnType<typeof vi.fn>;
        };
        lastBeamBloodEffect: Map<string, number>;
      };
      // Every candidate is in the cone; the second tick is lethal.
      let lethal = false;
      const applyBurn = vi.fn();
      svc.getEnemiesInCone = (...args) => args[4] as unknown[];
      svc.combatEffectService = {
        applyBeamDamage: (e) => { if (lethal) e.alive = false; },
        applyBurn,
      };

      run();
      expect(svc.lastBeamBloodEffect.has('e-10')).toBe(true);
      expect(applyBurn).toHaveBeenCalledTimes(1);

      lethal = true;
      run();
      expect(svc.lastBeamBloodEffect.has('e-10')).toBe(false);
      expect(applyBurn).toHaveBeenCalledTimes(1); // no burn on the enemy the beam killed
    });

    it('deals the burn share of the DPS as burn instead of directly', () => {
      const { tower, run } = setup(10);
      const applyBeamDamage = vi.fn();
      const applyBurn = vi.fn();
      const svc = service as unknown as {
        getEnemiesInCone: (...args: unknown[]) => unknown[];
        combatEffectService: unknown;
      };
      svc.getEnemiesInCone = (...args) => args[4] as unknown[];
      svc.combatEffectService = { applyBeamDamage, applyBurn };

      run(); // one 16 ms sub-step
      const dps = tower.typeConfig.damagePerSecond!;
      const share = GAME_BALANCE.effects.burn.beamDpsShare;
      expect(applyBeamDamage.mock.calls[0][1]).toBeCloseTo(dps * (1 - share) * 0.016, 9);
      expect(applyBurn).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'e-10' }),
        dps * share,
        tower.id,
      );
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Range upgrades reach the wake check and the radius fallback
  // ────────────────────────────────────────────────────────────────
  describe('upgraded range', () => {
    it('wakes a sleeping tower with its upgraded range and reads its visible cells', () => {
      const hasEnemyInRadius = vi.fn((_x: number, _z: number, _r: number) => true);
      const getEnemiesForTower = vi.fn((_cells: unknown[], out: unknown[]) => {
        out.length = 0;
        return out;
      });
      mockInjections['SpatialGridService'] = { hasEnemyInRadius };
      mockInjections['GlobalRouteGridService'] = { getEnemiesForTower, getBodyEnemies: () => [] };
      service = new TowerCombatService();
      service.initialize({
        sync: { geoToLocalSimpleInto: (_lat: number, _lon: number, _h: number, target: unknown) => target },
        towers: {},
      } as never, NO_RESEARCH);

      const tower = new Tower({ lat: 48.0, lon: 9.0, height: 0 }, 'archer');
      tower.losReady = true;
      tower.isSleeping = true;
      // Stands in for a few range upgrades; applyUpgrade scales the same field.
      tower.combat.range = tower.typeConfig.range * 2;

      service.updateTowerShooting(
        1000, 16, { getAllActive: () => [tower] } as never, {} as never, {} as never,
      );

      const radius = tower.combat.range * COMBAT_TUNING.rangeMargin.standard;
      expect(hasEnemyInRadius.mock.calls[0][2]).toBeCloseTo(radius, 6);
      expect(tower.isSleeping).toBe(false);
      expect(getEnemiesForTower).toHaveBeenCalledWith(tower.visibleCells, expect.any(Array));
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Turret heading without a target: held in a wave, guard heading after
  // ────────────────────────────────────────────────────────────────
  describe('turret heading without a target', () => {
    const noEnemies = (_cells: unknown[], out: unknown[]) => {
      out.length = 0;
      return out;
    };

    function setup() {
      mockInjections['GlobalRouteGridService'] = { getEnemiesForTower: noEnemies, getBodyEnemies: () => [] };
      service = new TowerCombatService();
      service.initialize({
        sync: { geoToLocalSimpleInto: (_lat: number, _lon: number, _h: number, target: unknown) => target },
        towers: {},
        flameBeams: { stopBeam: vi.fn() },
      } as never, NO_RESEARCH);
    }

    const loops: {
      kind: string;
      typeId: 'archer' | 'fire' | 'tentacle';
      run: (towerManager: never) => void;
    }[] = [
      { kind: 'projectile', typeId: 'archer', run: (tm) => service.updateTowerShooting(1000, 16, tm, {} as never, {} as never) },
      { kind: 'beam', typeId: 'fire', run: (tm) => service.updateBeamTowers(16, tm, {} as never, 1000) },
      { kind: 'melee', typeId: 'tentacle', run: (tm) => service.updateMeleeTowers(16, tm, {} as never, 1000) },
    ];

    for (const { kind, typeId, run } of loops) {
      it(`${kind}: keeps the heading when the tower has no target during a wave`, () => {
        setup();
        const tower = new Tower({ lat: 48.0, lon: 9.0, height: 0 }, typeId);
        tower.losReady = true;
        tower.guardHeading = 1.2;
        tower.aim.hasTarget = true;
        const heading = tower.aim.target;

        run({ getAllActive: () => [tower] } as never);

        expect(tower.aim.hasTarget).toBe(false);
        expect(tower.aim.target).toBe(heading);
      });
    }

    it('turnTowersToGuard turns the towers that have a guard heading', () => {
      setup();
      const guarded = new Tower({ lat: 48.0, lon: 9.0, height: 0 }, 'archer');
      guarded.guardHeading = 0.7;
      const unguarded = new Tower({ lat: 48.001, lon: 9.0, height: 0 }, 'archer');
      const unguardedHeading = unguarded.aim.target;

      service.turnTowersToGuard({ getAllActive: () => [guarded, unguarded] } as never);

      expect(guarded.aim.target).toBe(0.7);
      expect(guarded.aim.hasTarget).toBe(false);
      expect(unguarded.aim.target).toBe(unguardedHeading);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Chain jumps and bodies along the route
  // ────────────────────────────────────────────────────────────────
  describe('chain jumps', () => {
    it('do not reach a body the tower has no aim point on, however near its tip', () => {
      const find = (service as unknown as {
        findNearestUnhit: (from: unknown, candidates: unknown[], hit: Set<string>, max: number) => unknown;
      }).findNearestUnhit.bind(service);
      const from = { lat: 48.0, lon: 9.0 };
      const ooze = { id: 'ooze', alive: true, body: {}, position: { lat: 48.0, lon: 9.0 } };
      const zombie = { id: 'z', alive: true, body: null, position: { lat: 48.0 + 5 / METERS_PER_DEGREE_LAT, lon: 9.0 } };
      // No tower turn has begun in BodyAim: no aim point on the ooze
      expect(find(from, [ooze, zombie], new Set(), 15)).toBe(zombie);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Line of sight: the tower's answers in the cells, no raycast (D2)
  // ────────────────────────────────────────────────────────────────
  describe('line of sight from the cells', () => {
    const towerPos = { lat: 48.0, lon: 9.0, height: 0 };
    const enemy = {
      id: 'e-10',
      alive: true,
      body: null,
      position: { lat: towerPos.lat + 10 / METERS_PER_DEGREE_LAT, lon: towerPos.lon },
      typeConfig: { id: 'zombie', isAirUnit: false, heightOffset: 0, scale: 1 },
      heightOffset: 0,
      transform: { terrainHeight: 0 },
      movement: { getPathProgress: () => 0.5 },
    };

    function setup(answer: boolean, visibleCells: unknown[]) {
      const isPositionVisibleFromTower = vi.fn(() => answer);
      const getEnemiesForTower = vi.fn((cells: unknown[], out: unknown[]) => {
        out.length = 0;
        if (cells.length > 0) out.push(enemy);
        return out;
      });
      // No radius query: a tower that sees no cell has no candidates
      mockInjections['GlobalRouteGridService'] = { getEnemiesForTower, getBodyEnemies: () => [], isPositionVisibleFromTower };
      service = new TowerCombatService();
      // A tripwire: the renderer has no line-of-sight raycast any more
      const towers = { hasLineOfSight: vi.fn(() => true) };
      service.initialize({
        sync: { geoToLocalSimpleInto: (_lat: number, _lon: number, _h: number, target: unknown) => target },
        towers,
      } as never, NO_RESEARCH);
      const tower = new Tower(towerPos, 'archer');
      tower.losReady = true;
      tower.visibleCells = visibleCells as never;
      // On cooldown: the test stops at the target, before a shot
      tower.combat.fire();
      const run = () => service.updateTowerShooting(1000, 16, { getAllActive: () => [tower] } as never, {} as never, {} as never);
      return { towers, tower, run, isPositionVisibleFromTower, getEnemiesForTower };
    }

    it('takes an enemy whose cell answers visible', () => {
      const { towers, tower, run } = setup(true, [{}]);
      run();
      expect(tower.currentTarget).toBe(enemy);
      expect(tower.aim.hasTarget).toBe(true);
      expect(towers.hasLineOfSight).not.toHaveBeenCalled();
    });

    it('does not take an enemy whose cell has no answer of the tower, and casts no ray', () => {
      // The grid answers false for a cell without the tower's entry and for a spot off the grid
      const { towers, tower, run, isPositionVisibleFromTower } = setup(false, [{}]);
      run();
      expect(isPositionVisibleFromTower).toHaveBeenCalled();
      expect(tower.currentTarget).toBeNull();
      expect(tower.aim.hasTarget).toBe(false);
      expect(towers.hasLineOfSight).not.toHaveBeenCalled();
    });

    it('gives a tower that sees no cell no candidates', () => {
      const { tower, run, getEnemiesForTower, towers } = setup(true, []);
      run();
      expect(getEnemiesForTower).toHaveBeenCalled();
      expect(tower.currentTarget).toBeNull();
      expect(towers.hasLineOfSight).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Sanity: combat-tuning constants are read into hot-path readonlies
  // ────────────────────────────────────────────────────────────────
  describe('config wiring', () => {
    it('BEAM_BLOOD_EFFECT_INTERVAL matches combat-tuning config', () => {
      const intv = (service as unknown as { BEAM_BLOOD_EFFECT_INTERVAL: number }).BEAM_BLOOD_EFFECT_INTERVAL;
      expect(intv).toBe(COMBAT_TUNING.beamBloodEffectIntervalMs);
    });
  });
});
