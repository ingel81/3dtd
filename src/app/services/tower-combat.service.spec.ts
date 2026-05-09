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
import { COMBAT_TUNING } from '../configs/combat-tuning.config';

/**
 * Coverage:
 * - calculateHeading: pure geo→radian heading math
 * - getEffectiveDPS / getEffectiveBeamWidth: upgrade-aware private getters
 * - Beam-state cleanup (stopTowerBeam, stopAllBeams) — flame-sound + throttle map
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

    it('stopTowerBeam clears the per-tower blood-effect throttle entry', () => {
      const p = priv(service);
      p.tilesEngine = { flameBeams: { stopBeam: vi.fn() } };
      p.lastBeamBloodEffect.set('t-1', 999);
      p.lastBeamBloodEffect.set('t-2', 888);

      service.stopTowerBeam('t-1');
      expect(p.lastBeamBloodEffect.has('t-1')).toBe(false);
      expect(p.lastBeamBloodEffect.has('t-2')).toBe(true);
      expect(p.tilesEngine!.flameBeams!.stopBeam).toHaveBeenCalledWith('t-1');
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
  // Sanity: combat-tuning constants are read into hot-path readonlies
  // ────────────────────────────────────────────────────────────────
  describe('config wiring', () => {
    it('BEAM_BLOOD_EFFECT_INTERVAL matches combat-tuning config', () => {
      const intv = (service as unknown as { BEAM_BLOOD_EFFECT_INTERVAL: number }).BEAM_BLOOD_EFFECT_INTERVAL;
      expect(intv).toBe(COMBAT_TUNING.beamBloodEffectIntervalMs);
    });
  });
});
