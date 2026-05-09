import { describe, it, expect, beforeEach, vi } from 'vitest';

// Angular Injectable decorator must be a no-op so providedIn doesn't load the
// real platform; the service has no inject() of its own (managers are passed
// in via initialize()), so we can construct it directly.
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
  };
});

import { DamageApplicationService } from './damage-application.service';
import { ArmorType, DamageType } from '../configs/combat/combat.types';

/** Minimal Enemy stub — only the fields/methods DamageApplicationService touches. */
type EnemyStub = {
  id: string;
  position: { lat: number; lon: number };
  transform: { terrainHeight: number };
  typeConfig: { canBleed: boolean; heightOffset: number; armorType: ArmorType };
  health: { takeDamage: (n: number) => boolean; hp: number };
  getEffectiveArmorType: () => ArmorType;
};

function makeEnemy(opts: {
  id?: string;
  hp?: number;
  armor?: ArmorType;
  canBleed?: boolean;
} = {}): EnemyStub {
  const armor = opts.armor ?? 'unarmored';
  let hp = opts.hp ?? 100;
  return {
    id: opts.id ?? 'e1',
    position: { lat: 48.0, lon: 9.0 },
    transform: { terrainHeight: 0 },
    typeConfig: {
      canBleed: opts.canBleed ?? true,
      heightOffset: 0,
      armorType: armor,
    },
    health: {
      get hp() { return hp; },
      takeDamage(n: number) {
        hp -= n;
        return hp <= 0;
      },
    },
    getEffectiveArmorType: () => armor,
  };
}

function makeTower(id: string) {
  return { id, combat: { kills: 0 } };
}

describe('DamageApplicationService', () => {
  let service: DamageApplicationService;
  let towerKillsById: Record<string, { combat: { kills: number } }>;
  let killedEnemyIds: string[];
  let vfx: {
    emitHitBlood: ReturnType<typeof vi.fn>;
    emitDeathBlood: ReturnType<typeof vi.fn>;
    emitBloodEffect: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = new DamageApplicationService();
    towerKillsById = {};
    killedEnemyIds = [];
    vfx = {
      emitHitBlood: vi.fn(),
      emitDeathBlood: vi.fn(),
      emitBloodEffect: vi.fn(),
    };

    const towerManager = {
      getById: (id: string) => towerKillsById[id],
    };
    const enemyManager = {
      kill: (e: { id: string }) => { killedEnemyIds.push(e.id); },
    };

    service.initialize(towerManager as never, enemyManager as never);
  });

  // ────────────────────────────────────────────────────────────────
  // applyDamage — matrix lookups
  // ────────────────────────────────────────────────────────────────
  describe('applyDamage — damage matrix', () => {
    it('passes raw damage through to takeDamage when matrix multiplier is 1.0', () => {
      const enemy = makeEnemy({ hp: 100, armor: 'unarmored' });
      // ballistic vs unarmored is the canonical 1.0× row
      const result = service.applyDamage(
        vfx as never, enemy as never, 25, 'physical' as DamageType,
        'tower-1', false, false,
      );
      expect(result?.finalDamage).toBe(25);
      expect(result?.baseDamage).toBe(25);
      expect(enemy.health.hp).toBe(75);
    });

    it('applies the matrix multiplier to finalDamage', () => {
      const enemy = makeEnemy({ hp: 1000, armor: 'fortified' });
      // Whatever the matrix value is, finalDamage must equal damage × multiplier.
      const result = service.applyDamage(
        vfx as never, enemy as never, 100, 'siege' as DamageType,
        'tower-1', false, false,
      );
      expect(result).not.toBeNull();
      expect(result!.finalDamage).toBe(100 * result!.multiplier);
    });

    it('returns null and does no work if not initialized', () => {
      const fresh = new DamageApplicationService();
      const enemy = makeEnemy();
      const r = fresh.applyDamage(
        vfx as never, enemy as never, 10, 'physical' as DamageType,
        'tower-1', false, false,
      );
      expect(r).toBeNull();
      expect(vfx.emitHitBlood).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // applyDamage — VFX + kill flow
  // ────────────────────────────────────────────────────────────────
  describe('applyDamage — vfx + kill flow', () => {
    it('emits hit blood by default, suppresses it with skipBloodEffects', () => {
      const enemy = makeEnemy({ hp: 1000 });
      service.applyDamage(vfx as never, enemy as never, 10, 'physical' as DamageType, 't', false, false);
      expect(vfx.emitHitBlood).toHaveBeenCalledTimes(1);

      service.applyDamage(vfx as never, enemy as never, 10, 'physical' as DamageType, 't', false, true);
      expect(vfx.emitHitBlood).toHaveBeenCalledTimes(1); // unchanged
    });

    it('passes the splash-flag through to emitHitBlood', () => {
      const enemy = makeEnemy();
      service.applyDamage(vfx as never, enemy as never, 5, 'physical' as DamageType, 't', true, false);
      expect(vfx.emitHitBlood).toHaveBeenCalledWith(enemy, true);
    });

    it('emits death blood and kills the enemy on lethal hit', () => {
      const enemy = makeEnemy({ id: 'doomed', hp: 10 });
      const r = service.applyDamage(
        vfx as never, enemy as never, 50, 'physical' as DamageType, 't', false, false,
      );
      expect(r).not.toBeNull();
      expect(vfx.emitDeathBlood).toHaveBeenCalledWith(enemy);
      expect(killedEnemyIds).toContain('doomed');
    });

    it('skips death blood when skipBloodEffects is true (e.g. ice projectiles)', () => {
      const enemy = makeEnemy({ id: 'frozen', hp: 1 });
      service.applyDamage(vfx as never, enemy as never, 100, 'magic' as DamageType, 't', false, true);
      expect(vfx.emitDeathBlood).not.toHaveBeenCalled();
      expect(killedEnemyIds).toContain('frozen');
    });

    it('credits the kill to the source tower', () => {
      const enemy = makeEnemy({ hp: 1 });
      towerKillsById['t-A'] = makeTower('t-A');
      service.applyDamage(vfx as never, enemy as never, 100, 'physical' as DamageType, 't-A', false, false);
      expect(towerKillsById['t-A'].combat.kills).toBe(1);
    });

    it('does nothing on a missing source tower (no throw)', () => {
      const enemy = makeEnemy({ hp: 1 });
      expect(() =>
        service.applyDamage(vfx as never, enemy as never, 100, 'physical' as DamageType, 'missing', false, false),
      ).not.toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // applyBeamDamage
  // ────────────────────────────────────────────────────────────────
  describe('applyBeamDamage', () => {
    it('respects showBloodEffects gating + canBleed flag', () => {
      const bleeder = makeEnemy({ hp: 1000, canBleed: true });
      const robot = makeEnemy({ hp: 1000, canBleed: false });

      service.applyBeamDamage(vfx as never, bleeder as never, 20, 'fire' as DamageType, 't', true);
      expect(vfx.emitBloodEffect).toHaveBeenCalledTimes(1);

      service.applyBeamDamage(vfx as never, robot as never, 20, 'fire' as DamageType, 't', true);
      expect(vfx.emitBloodEffect).toHaveBeenCalledTimes(1); // robot suppressed

      service.applyBeamDamage(vfx as never, bleeder as never, 20, 'fire' as DamageType, 't', false);
      expect(vfx.emitBloodEffect).toHaveBeenCalledTimes(1); // throttled by caller
    });

    it('triggers death effects + kill on lethal beam tick', () => {
      const enemy = makeEnemy({ id: 'burned', hp: 5 });
      towerKillsById['flame'] = makeTower('flame');
      service.applyBeamDamage(vfx as never, enemy as never, 100, 'fire' as DamageType, 'flame', true);
      expect(vfx.emitDeathBlood).toHaveBeenCalledWith(enemy);
      expect(killedEnemyIds).toContain('burned');
      expect(towerKillsById['flame'].combat.kills).toBe(1);
    });

    it('returns null when service is not initialized', () => {
      const fresh = new DamageApplicationService();
      const r = fresh.applyBeamDamage(vfx as never, makeEnemy() as never, 10, 'fire' as DamageType, 't', true);
      expect(r).toBeNull();
    });
  });
});
