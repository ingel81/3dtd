import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AbilityManager, type AbilityWorld } from './ability.manager';
import { GameEventBus, type GameEvent } from '../game-engine/game-event-bus';
import { ABILITIES } from '../configs/abilities.config';
import { ENEMY_TYPES } from '../configs/enemy-types.config';
import type { Enemy } from '../entities/enemy.entity';
import type { GamePhase, GeoPosition } from '../models/game.types';

/** GameClock.FIXED_STEP_MS: the length of one gameplay sub-step. */
const STEP_MS = 16.667;
const NUKE = ABILITIES['nuclear-strike'];
const TARGET: GeoPosition = { lat: 48.1, lon: 9.1, height: 0 };

function enemyOf(id: string, type: string): Enemy {
  return { id, typeConfig: ENEMY_TYPES[type] } as unknown as Enemy;
}

describe('AbilityManager', () => {
  let bus: GameEventBus;
  let manager: AbilityManager;
  let phase: GamePhase;
  let routeInReach: boolean;
  let inRadius: Enemy[];
  let strikes: { ids: string[]; fractions: number[] }[];
  let strikeKills: number;
  let world: AbilityWorld;

  const unlock = (perkId: string = NUKE.perkId) =>
    bus.emit({
      type: 'research:completed',
      researchId: 'nuclear-strike',
      effects: [{ kind: 'global-perk', perkId, description: '' }],
    });
  const completeWave = () =>
    bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: false, closeCall: false, hpLost: 0 });
  const tick = (steps: number) => {
    for (let i = 0; i < steps; i++) manager.update(STEP_MS);
  };

  beforeEach(() => {
    bus = new GameEventBus();
    phase = 'wave';
    routeInReach = true;
    inRadius = [];
    strikes = [];
    strikeKills = 0;
    world = {
      snapToRoute: vi.fn((target: GeoPosition) => (routeInReach ? { ...target, height: 5 } : null)),
      enemiesInRadius: vi.fn((_center: GeoPosition, _radius: number, out: Enemy[]) => {
        out.length = 0;
        out.push(...inRadius);
        return out;
      }),
      strike: vi.fn((targets: readonly Enemy[], fractionOf: (enemy: Enemy) => number) => {
        strikes.push({ ids: targets.map((t) => t.id), fractions: targets.map(fractionOf) });
        return strikeKills;
      }),
    };
    manager = new AbilityManager(bus, world);
    manager.setPhaseProvider(() => phase);
  });

  describe('unlocking', () => {
    it('is locked until its research completes', () => {
      expect(manager.getStatus('nuclear-strike').unlocked).toBe(false);
      expect(manager.use('nuclear-strike', TARGET)).toEqual({ ok: false, reason: 'locked' });
    });

    it('gets its first charge from the research', () => {
      unlock();
      expect(manager.getStatus('nuclear-strike')).toEqual({
        id: 'nuclear-strike',
        unlocked: true,
        charges: 1,
        maxCharges: 1,
        wavesUntilCharge: 0,
        pending: false,
      });
    });

    it('ignores other perks', () => {
      unlock('some-other-perk');
      expect(manager.getStatus('nuclear-strike').unlocked).toBe(false);
    });
  });

  describe('using', () => {
    beforeEach(() => unlock());

    it('fires only during a wave and keeps the charge otherwise', () => {
      phase = 'setup';
      expect(manager.use('nuclear-strike', TARGET)).toEqual({ ok: false, reason: 'no-wave' });
      expect(manager.getStatus('nuclear-strike').charges).toBe(1);
    });

    it('rejects a target with no route cell in reach and keeps the charge', () => {
      routeInReach = false;
      expect(manager.use('nuclear-strike', TARGET)).toEqual({ ok: false, reason: 'no-route' });
      expect(manager.getStatus('nuclear-strike').charges).toBe(1);
      expect(world.snapToRoute).toHaveBeenCalledWith(TARGET, NUKE.snapRadiusM);
    });

    it('spends the charge and aims at the snapped point', () => {
      const result = manager.use('nuclear-strike', TARGET);
      expect(result.ok).toBe(true);
      expect(result.ok && result.strike.target).toEqual({ ...TARGET, height: 5 });
      expect(manager.getStatus('nuclear-strike')).toMatchObject({ charges: 0, pending: true });
      expect(manager.use('nuclear-strike', TARGET)).toEqual({ ok: false, reason: 'no-charge' });
    });

    it('lands on the 90th sub-step after the command', () => {
      inRadius = [enemyOf('z1', 'zombie')];
      manager.use('nuclear-strike', TARGET);

      tick(89);
      expect(world.strike).not.toHaveBeenCalled();

      tick(1);
      expect(world.strike).toHaveBeenCalledTimes(1);
      expect(world.enemiesInRadius).toHaveBeenCalledWith({ ...TARGET, height: 5 }, NUKE.radiusM, expect.any(Array));
      expect(manager.getStatus('nuclear-strike').pending).toBe(false);

      tick(200);
      expect(world.strike).toHaveBeenCalledTimes(1);
    });

    it('takes 60% from everyone and 20% from bosses, ground and air alike', () => {
      expect(ENEMY_TYPES['bat'].isAirUnit).toBe(true);
      inRadius = [enemyOf('z1', 'zombie'), enemyOf('boss', 'herbert'), enemyOf('bat1', 'bat')];
      manager.use('nuclear-strike', TARGET);
      tick(90);
      expect(strikes).toEqual([{ ids: ['z1', 'boss', 'bat1'], fractions: [0.6, 0.2, 0.6] }]);
    });

    it('reports a strike as pending from the command until it lands', () => {
      expect(manager.hasPendingStrikes()).toBe(false);
      manager.use('nuclear-strike', TARGET);
      tick(89);
      expect(manager.hasPendingStrikes()).toBe(true);
      tick(1);
      expect(manager.hasPendingStrikes()).toBe(false);
    });

    it('spends the charge even when the strike finds nobody', () => {
      manager.use('nuclear-strike', TARGET);
      tick(90);
      expect(world.strike).not.toHaveBeenCalled();
      expect(manager.getStatus('nuclear-strike')).toMatchObject({ charges: 0, pending: false });
    });
  });

  describe('recharging', () => {
    beforeEach(() => unlock());

    it('gets the charge back after three completed waves, the wave of the use counted', () => {
      manager.use('nuclear-strike', TARGET);
      expect(manager.getStatus('nuclear-strike').wavesUntilCharge).toBe(3);

      completeWave();
      completeWave();
      expect(manager.getStatus('nuclear-strike')).toMatchObject({ charges: 0, wavesUntilCharge: 1 });

      completeWave();
      expect(manager.getStatus('nuclear-strike')).toMatchObject({ charges: 1, wavesUntilCharge: 0 });
    });

    it('banks nothing while the charge is full', () => {
      for (let i = 0; i < 5; i++) completeWave();
      manager.use('nuclear-strike', TARGET);
      completeWave();
      completeWave();
      expect(manager.getStatus('nuclear-strike').charges).toBe(0);
    });

    it('counts the waves a dev jump skips like completed waves, up to full', () => {
      manager.use('nuclear-strike', TARGET);
      manager.advanceWaves(NUKE.rechargeWaves - 1);
      expect(manager.getStatus('nuclear-strike')).toMatchObject({ charges: 0, wavesUntilCharge: 1 });

      manager.advanceWaves(10 * NUKE.rechargeWaves);
      expect(manager.getStatus('nuclear-strike')).toMatchObject({
        charges: NUKE.maxCharges,
        wavesUntilCharge: 0,
      });
    });

    it('a jump leaves a locked ability locked', () => {
      manager.reset();
      manager.advanceWaves(20);
      expect(manager.getStatus('nuclear-strike').unlocked).toBe(false);
    });
  });

  describe('debug refill (Nuke ready)', () => {
    it('does nothing while the ability is locked', () => {
      manager.refillCharges('nuclear-strike');
      expect(manager.getStatus('nuclear-strike').unlocked).toBe(false);
    });

    it('gives every charge back and restarts the count toward the next', () => {
      unlock();
      manager.use('nuclear-strike', TARGET);
      completeWave();
      manager.refillCharges('nuclear-strike');
      expect(manager.getStatus('nuclear-strike')).toMatchObject({ charges: NUKE.maxCharges, wavesUntilCharge: 0 });

      manager.use('nuclear-strike', TARGET);
      expect(manager.getStatus('nuclear-strike')).toMatchObject({ charges: 0, wavesUntilCharge: NUKE.rechargeWaves });
    });
  });

  describe('announcements', () => {
    let events: GameEvent[];
    const ofType = <T extends GameEvent['type']>(type: T) =>
      events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

    beforeEach(() => {
      events = [];
      bus.onAny((e) => events.push(e));
    });

    it('announces a use with the snapped target, radius and warning', () => {
      unlock();
      manager.use('nuclear-strike', TARGET);
      expect(ofType('ability:used')).toEqual([{
        type: 'ability:used',
        abilityId: 'nuclear-strike',
        strikeId: 1,
        target: { ...TARGET, height: 5 },
        radiusM: 25,
        warningMs: 1500,
      }]);
    });

    it('announces a refusal with its reason', () => {
      unlock();
      phase = 'setup';
      manager.use('nuclear-strike', TARGET);
      expect(ofType('ability:rejected')).toEqual([
        { type: 'ability:rejected', abilityId: 'nuclear-strike', reason: 'no-wave' },
      ]);
      expect(ofType('ability:used')).toEqual([]);
    });

    it('reports hits and kills when the strike lands', () => {
      unlock();
      inRadius = [enemyOf('a', 'zombie'), enemyOf('b', 'zombie'), enemyOf('c', 'herbert')];
      strikeKills = 2;
      manager.use('nuclear-strike', TARGET);
      tick(90);
      expect(ofType('ability:impact')).toEqual([{
        type: 'ability:impact',
        abilityId: 'nuclear-strike',
        strikeId: 1,
        target: { ...TARGET, height: 5 },
        radiusM: 25,
        hits: 3,
        kills: 2,
      }]);
    });

    it('sends a snapshot after unlock, use, impact and every wave toward a charge', () => {
      const charges = () =>
        ofType('ability:state-changed').map((e) => e.abilities[0]).map((s) => [s.charges, s.wavesUntilCharge, s.pending]);
      unlock();
      manager.use('nuclear-strike', TARGET);
      tick(90);
      completeWave();
      completeWave();
      completeWave();
      completeWave(); // full again: nothing to report
      expect(charges()).toEqual([
        [1, 0, false], // unlocked
        [0, 3, true],  // used
        [0, 3, false], // landed
        [0, 2, false],
        [0, 1, false],
        [1, 0, false], // recharged
      ]);
    });
  });

  describe('lifecycle', () => {
    it('reset locks every ability and drops pending strikes', () => {
      unlock();
      inRadius = [enemyOf('z1', 'zombie')];
      manager.use('nuclear-strike', TARGET);
      manager.reset();

      tick(90);
      expect(world.strike).not.toHaveBeenCalled();
      expect(manager.getStatus('nuclear-strike').unlocked).toBe(false);
    });

    it('destroy stops listening to research and waves', () => {
      manager.destroy();
      unlock();
      expect(manager.getStatus('nuclear-strike').unlocked).toBe(false);
    });
  });
});
