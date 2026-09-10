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
import { COMBAT_TUNING } from '../../configs/combat-tuning.config';
import { Tower } from '../../entities/tower.entity';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';

/**
 * Coverage:
 * - calculateHeading: pure geo→radian heading math
 * - getEffectiveDPS / getEffectiveBeamWidth: upgrade-aware private getters
 * - Beam-state cleanup (stopTowerBeam, stopAllBeams) — flame-sound + throttle map
 * - updateBeamTowers radius fallback (no visibleCells): query covers detection range
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
    mockInjections['ResearchStore'] = { airTargetingUnlocked: () => false };
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
          upgrades: [{ id: 'damage', effect: { stat: 'damage', multiplier: 1.5 } }],
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
          upgrades: [{ id: 'damage', effect: { stat: 'damage', multiplier: 1.5 } }],
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
          upgrades: [{ id: 'wide-burn', effect: { stat: 'beamWidth', multiplier: 1.25 } }],
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
  // updateBeamTowers: radius fallback for towers without visibleCells
  // ────────────────────────────────────────────────────────────────
  describe('updateBeamTowers radius fallback', () => {
    const towerPos = { lat: 48.0, lon: 9.0, height: 0 };

    /** Ground enemy `meters` due north of the tower. */
    function enemyNorthOf(meters: number) {
      return {
        id: `e-${meters}`,
        alive: true,
        position: { lat: towerPos.lat + meters / METERS_PER_DEGREE_LAT, lon: towerPos.lon },
        typeConfig: { id: 'zombie', isAirUnit: false, heightOffset: 0, scale: 1 },
        transform: { terrainHeight: 0 },
        movement: { getPathProgress: () => 0.5 },
      };
    }

    /**
     * The grid mock returns the enemy only if the queried radius reaches it,
     * so a too-small fallback radius shows up as "no target".
     */
    function setup(enemyDistance: number) {
      const enemy = enemyNorthOf(enemyDistance);
      const getEnemiesInRadius = vi.fn(
        (_x: number, _z: number, radius: number, _ex: unknown, out: unknown[]) => {
          out.length = 0;
          if (radius >= enemyDistance) out.push(enemy);
          return out;
        },
      );
      mockInjections['GlobalRouteGridService'] = { getEnemiesInRadius };
      mockInjections['CombatEffectService'] = { applyBeamDamage: vi.fn() };
      service = new TowerCombatService();

      const engine = {
        sync: {
          geoToLocalSimple: () => ({ x: 0, y: 0, z: 0 }),
          geoToLocalSimpleInto: (_lat: number, _lon: number, _h: number, target: unknown) => target,
        },
        towers: { updateRotation: vi.fn(), resetRotation: vi.fn(), hasLineOfSight: () => true },
        flameBeams: { startBeam: vi.fn(), stopBeam: vi.fn() },
      };
      service.initialize(engine as never);
      // Cone geometry needs real Vector3 math, which the three mock lacks.
      (service as unknown as { getEnemiesInCone: () => unknown[] }).getEnemiesInCone = () => [];

      const tower = new Tower(towerPos, 'fire');
      tower.losReady = true;
      const towerManager = { getAllActive: () => [tower] };
      const run = () => service.updateBeamTowers(16, towerManager as never, {} as never, 1000);
      return { engine, tower, getEnemiesInRadius, run };
    }

    it('acquires an enemy between beamRange and the detection range', () => {
      const { tower, engine, run } = setup(24.5);
      expect(tower.typeConfig.beamRange).toBeLessThan(24.5);
      expect(tower.combat.range).toBeGreaterThan(24.5);

      run();
      expect(engine.flameBeams.startBeam).toHaveBeenCalledWith(
        tower.id, expect.anything(), expect.anything(), expect.any(Number), expect.any(Number),
      );
      expect(engine.flameBeams.stopBeam).not.toHaveBeenCalled();
    });

    it('queries with the upgraded detection range', () => {
      const { tower, engine, getEnemiesInRadius, run } = setup(30);
      for (let i = 0; i < 10; i++) tower.applyUpgrade('range');
      expect(tower.combat.range).toBeGreaterThan(30);

      run();
      expect(getEnemiesInRadius.mock.calls[0][2]).toBeGreaterThanOrEqual(tower.combat.range);
      expect(engine.flameBeams.startBeam).toHaveBeenCalled();
    });

    it('leaves the exact range check to findTarget', () => {
      // Inside the query margin, outside combat.range: candidate but no target.
      const { engine, run } = setup(26);
      run();
      expect(engine.flameBeams.startBeam).not.toHaveBeenCalled();
      expect(engine.flameBeams.stopBeam).toHaveBeenCalled();
    });

    it('drops the blood-throttle entry of an enemy the beam killed', () => {
      const { run } = setup(10);
      const svc = service as unknown as {
        getEnemiesInCone: (...args: unknown[]) => unknown[];
        combatEffectService: { applyBeamDamage: (e: { alive: boolean }) => void };
        lastBeamBloodEffect: Map<string, number>;
      };
      // Every candidate is in the cone; the second tick is lethal.
      let lethal = false;
      svc.getEnemiesInCone = (...args) => args[4] as unknown[];
      svc.combatEffectService = { applyBeamDamage: (e) => { if (lethal) e.alive = false; } };

      run();
      expect(svc.lastBeamBloodEffect.has('e-10')).toBe(true);

      lethal = true;
      run();
      expect(svc.lastBeamBloodEffect.has('e-10')).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Range upgrades reach the wake check and the radius fallback
  // ────────────────────────────────────────────────────────────────
  describe('upgraded range', () => {
    it('wakes and queries a sleeping tower with its upgraded range', () => {
      const hasEnemyInRadius = vi.fn((_x: number, _z: number, _r: number) => true);
      const getEnemiesInRadius = vi.fn(
        (_x: number, _z: number, _r: number, _ex: unknown, out: unknown[]) => {
          out.length = 0;
          return out;
        },
      );
      mockInjections['SpatialGridService'] = { hasEnemyInRadius };
      mockInjections['GlobalRouteGridService'] = { getEnemiesInRadius };
      service = new TowerCombatService();
      service.initialize({
        sync: { geoToLocalSimpleInto: (_lat: number, _lon: number, _h: number, target: unknown) => target },
        towers: { resetRotation: vi.fn() },
      } as never);

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
      expect(getEnemiesInRadius.mock.calls[0][2]).toBeCloseTo(radius, 6);
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
