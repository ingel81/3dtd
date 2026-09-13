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
import { ArmorType, DamageType } from '../../configs/combat/combat.types';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { HERO_SOURCE_ID } from '../../configs/hero.config';

/** Minimal Enemy stub — only the fields/methods DamageApplicationService touches. */
interface EnemyStub {
  id: string;
  position: { lat: number; lon: number };
  transform: { terrainHeight: number };
  heightOffset: number;
  typeConfig: { canBleed: boolean; armorType: ArmorType };
  health: { takeDamage: (n: number) => boolean; hp: number; maxHp: number };
  getEffectiveArmorType: () => ArmorType;
}

function makeEnemy(opts: {
  id?: string;
  hp?: number;
  maxHp?: number;
  armor?: ArmorType;
  canBleed?: boolean;
} = {}): EnemyStub {
  const armor = opts.armor ?? 'unarmored';
  let hp = opts.hp ?? 100;
  return {
    id: opts.id ?? 'e1',
    position: { lat: 48.0, lon: 9.0 },
    transform: { terrainHeight: 0 },
    heightOffset: 0,
    typeConfig: {
      canBleed: opts.canBleed ?? true,
      armorType: armor,
    },
    health: {
      get hp() { return hp; },
      maxHp: opts.maxHp ?? opts.hp ?? 100,
      // Clamps at 0 like HealthComponent.takeDamage
      takeDamage(n: number) {
        hp = Math.max(0, hp - n);
        return hp === 0;
      },
    },
    getEffectiveArmorType: () => armor,
  };
}

function makeTower(id: string) {
  return { id, combat: { kills: 0, damageDealt: 0 } };
}

describe('DamageApplicationService', () => {
  let service: DamageApplicationService;
  let towerKillsById: Record<string, { combat: { kills: number; damageDealt: number } }>;
  let killedEnemyIds: string[];
  let dyingIds: Set<string>;
  let bus: GameEventBus;
  let vfx: {
    emitHitBlood: ReturnType<typeof vi.fn>;
    emitDeathBlood: ReturnType<typeof vi.fn>;
    emitBloodEffect: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = new DamageApplicationService();
    towerKillsById = {};
    killedEnemyIds = [];
    dyingIds = new Set();
    vfx = {
      emitHitBlood: vi.fn(),
      emitDeathBlood: vi.fn(),
      emitBloodEffect: vi.fn(),
    };

    const towerManager = {
      getById: (id: string) => towerKillsById[id],
    };
    const enemyManager = {
      // Mirrors EnemyManager.kill: false for an enemy that is already dying
      kill: (e: { id: string }) => {
        if (dyingIds.has(e.id)) return false;
        killedEnemyIds.push(e.id);
        return true;
      },
    };

    bus = new GameEventBus();
    service.initialize(towerManager as never, enemyManager as never, bus);
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

    it('announces the kill with the source tower', () => {
      const enemy = makeEnemy({ hp: 1 });
      towerKillsById['t-A'] = makeTower('t-A');
      const handler = vi.fn();
      bus.on('tower:kill', handler);
      service.applyDamage(vfx as never, enemy as never, 100, 'physical' as DamageType, 't-A', false, false);
      expect(handler).toHaveBeenCalledWith({ type: 'tower:kill', tower: towerKillsById['t-A'] });
    });

    it('credits the tower whose hit takes the last HP, not the one that dealt the most', () => {
      towerKillsById['t-A'] = makeTower('t-A');
      towerKillsById['t-B'] = makeTower('t-B');
      const enemy = makeEnemy({ hp: 100 });
      service.applyDamage(vfx as never, enemy as never, 90, 'physical' as DamageType, 't-A', false, false);
      // Damage over time and beam ticks come in through applyBeamDamage
      service.applyBeamDamage(vfx as never, enemy as never, 20, 'physical' as DamageType, 't-B', false);
      expect(towerKillsById['t-A'].combat.kills).toBe(0);
      expect(towerKillsById['t-B'].combat.kills).toBe(1);
    });

    it('does nothing on a missing source tower (no throw)', () => {
      const enemy = makeEnemy({ hp: 1 });
      expect(() =>
        service.applyDamage(vfx as never, enemy as never, 100, 'physical' as DamageType, 'missing', false, false),
      ).not.toThrow();
    });

    it('announces a kill by the hero as hero:kill and credits no tower', () => {
      const enemy = makeEnemy({ id: 'shot', hp: 1 });
      const heroKill = vi.fn();
      const towerKill = vi.fn();
      bus.on('hero:kill', heroKill);
      bus.on('tower:kill', towerKill);
      service.applyDamage(vfx as never, enemy as never, 100, 'physical' as DamageType, HERO_SOURCE_ID, false, false);
      expect(killedEnemyIds).toContain('shot');
      expect(heroKill).toHaveBeenCalledWith({ type: 'hero:kill', enemy });
      expect(towerKill).not.toHaveBeenCalled();
    });

    it('announces no hero kill for an enemy that is already dying', () => {
      dyingIds.add('dying');
      const heroKill = vi.fn();
      bus.on('hero:kill', heroKill);
      service.applyDamage(vfx as never, makeEnemy({ id: 'dying', hp: 1 }) as never, 100, 'physical' as DamageType, HERO_SOURCE_ID, false, false);
      expect(heroKill).not.toHaveBeenCalled();
    });

    it('credits no kill when the manager rejects it (enemy already dying)', () => {
      const enemy = makeEnemy({ id: 'dying', hp: 1 });
      dyingIds.add('dying');
      towerKillsById['t-A'] = makeTower('t-A');
      const handler = vi.fn();
      bus.on('tower:kill', handler);
      service.applyDamage(vfx as never, enemy as never, 100, 'physical' as DamageType, 't-A', false, false);
      expect(killedEnemyIds).not.toContain('dying');
      expect(towerKillsById['t-A'].combat.kills).toBe(0);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Damage dealt per tower
  // ────────────────────────────────────────────────────────────────
  describe('damage dealt', () => {
    it('adds the final damage of a hit to the source tower', () => {
      towerKillsById['t-A'] = makeTower('t-A');
      service.applyDamage(vfx as never, makeEnemy({ hp: 100 }) as never, 25, 'physical' as DamageType, 't-A', false, false);
      service.applyDamage(vfx as never, makeEnemy({ hp: 100 }) as never, 10, 'physical' as DamageType, 't-A', false, false);
      expect(towerKillsById['t-A'].combat.damageDealt).toBe(35);
    });

    it('counts only the HP a lethal hit took, not the overkill', () => {
      towerKillsById['t-A'] = makeTower('t-A');
      service.applyDamage(vfx as never, makeEnemy({ hp: 10 }) as never, 100, 'physical' as DamageType, 't-A', false, false);
      expect(towerKillsById['t-A'].combat.damageDealt).toBe(10);
    });

    it('adds nothing for a hit on an enemy already at 0 HP', () => {
      towerKillsById['t-A'] = makeTower('t-A');
      const enemy = makeEnemy({ hp: 5 });
      service.applyDamage(vfx as never, enemy as never, 50, 'physical' as DamageType, 't-A', false, false);
      service.applyDamage(vfx as never, enemy as never, 50, 'physical' as DamageType, 't-A', false, false);
      expect(towerKillsById['t-A'].combat.damageDealt).toBe(5);
    });

    it('counts beam ticks too', () => {
      towerKillsById['flame'] = makeTower('flame');
      const enemy = makeEnemy({ hp: 1000 });
      service.applyBeamDamage(vfx as never, enemy as never, 2.5, 'fire' as DamageType, 'flame', false);
      service.applyBeamDamage(vfx as never, enemy as never, 2.5, 'fire' as DamageType, 'flame', false);
      // Whatever the fire multiplier is: dealt equals the HP the two ticks took
      expect(enemy.health.hp).toBeLessThan(1000);
      expect(towerKillsById['flame'].combat.damageDealt).toBeCloseTo(1000 - enemy.health.hp, 6);
    });

    it('credits nothing to a tower that is gone (sold)', () => {
      expect(() =>
        service.applyDamage(vfx as never, makeEnemy() as never, 10, 'physical' as DamageType, 'sold', false, false),
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

  // ────────────────────────────────────────────────────────────────
  // applyMaxHpFraction: the matrix-free path for abilities
  // ────────────────────────────────────────────────────────────────
  describe('applyMaxHpFraction', () => {
    it('takes the share of max HP, whatever the armor', () => {
      const enemy = makeEnemy({ hp: 200, armor: 'fortified' });
      const killed = service.applyMaxHpFraction(vfx as never, enemy as never, 0.6, true);
      expect(killed).toBe(false);
      expect(enemy.health.hp).toBeCloseTo(80);
      expect(vfx.emitHitBlood).not.toHaveBeenCalled();
    });

    it('measures the share against max HP, not against what is left', () => {
      const enemy = makeEnemy({ id: 'worn', hp: 50, maxHp: 100 });
      expect(service.applyMaxHpFraction(vfx as never, enemy as never, 0.6, false)).toBe(true);
      expect(killedEnemyIds).toContain('worn');
    });

    it('credits the kill to no tower', () => {
      const handler = vi.fn();
      bus.on('tower:kill', handler);
      service.applyMaxHpFraction(vfx as never, makeEnemy({ hp: 10, maxHp: 100 }) as never, 0.6, false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('spawns death blood only when asked to', () => {
      const first = makeEnemy({ id: 'a', hp: 10, maxHp: 100 });
      const second = makeEnemy({ id: 'b', hp: 10, maxHp: 100 });
      service.applyMaxHpFraction(vfx as never, first as never, 0.6, false);
      service.applyMaxHpFraction(vfx as never, second as never, 0.6, true);
      expect(vfx.emitDeathBlood.mock.calls).toEqual([[second]]);
    });

    it('reports no kill for an enemy that is already dying', () => {
      dyingIds.add('dying');
      const enemy = makeEnemy({ id: 'dying', hp: 10, maxHp: 100 });
      expect(service.applyMaxHpFraction(vfx as never, enemy as never, 0.6, true)).toBe(false);
      expect(vfx.emitDeathBlood).not.toHaveBeenCalled();
    });

    it('does nothing before initialize', () => {
      const fresh = new DamageApplicationService();
      const enemy = makeEnemy({ hp: 100 });
      expect(fresh.applyMaxHpFraction(vfx as never, enemy as never, 0.6, true)).toBe(false);
      expect(enemy.health.hp).toBe(100);
    });
  });
});
