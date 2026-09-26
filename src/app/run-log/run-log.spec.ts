import { describe, it, expect, beforeEach } from 'vitest';
import { GameEventBus, SubscriptionBag } from '../game-engine/game-event-bus';
import { RunLogCollector, SAMPLE_INTERVAL_MS, type RunLogWorld } from './run-log.service';
import { reconcileWave, RUN_LOG_FORMAT, type RunLogEvent, type RunLogSample, type RunLogWave } from './run-log.types';
import { fromJsonl, toJsonl } from './run-log.export';
import { setBuildCommit } from './build-commit';

/**
 * A run played into the log through the real event bus: what a wave block
 * holds, what the timeline keeps, and that the numbers add up
 * (docs/RUN_LOG.md).
 */

/** A tower as the log reads it. */
function tower(id: string, type: string) {
  return {
    id,
    typeConfig: { id: type, name: type, upgrades: [{ id: 'damage' }, { id: 'range' }] },
    combat: { damageDealt: 0, kills: 0 },
    getUpgradeLevel: (upgradeId: string) => (upgradeId === 'damage' ? 2 : 0),
  };
}

describe('the run log', () => {
  let bus: GameEventBus;
  let subs: SubscriptionBag;
  let log: RunLogCollector;
  let step = 0;
  let timeMs = 0;
  let credits = 100;
  let health = 100;
  let alive = 0;
  let standing: ReturnType<typeof tower>[] = [];

  const world = (): RunLogWorld => ({
    step: () => step,
    timeMs: () => timeMs,
    credits: () => credits,
    baseHealth: () => health,
    enemiesAlive: () => alive,
    dps: () => 42.6,
    towers: () => standing as never,
  });

  const open = () => log.open({ seed: 4711, map: 'devworld', player: 'bot', botSkill: 'expert' }, world());
  const book = (delta: number, source: string) => {
    credits += delta;
    bus.emit({ type: 'credits:changed', credits, delta, source, playerId: 'local', local: true } as never);
  };
  const kill = (id: string, towerId = 't1') =>
    bus.emit({ type: 'enemy:died', enemy: { id } as never, credits: 5, killedBy: { kind: 'tower', towerId } });
  const events = (): RunLogEvent[] =>
    (log.current()?.records ?? []).filter((r): r is RunLogEvent => r.kind === 'event');
  const waves = (): RunLogWave[] =>
    (log.current()?.records ?? []).filter((r): r is RunLogWave => r.kind === 'wave');
  const samples = (): RunLogSample[] =>
    (log.current()?.records ?? []).filter((r): r is RunLogSample => r.kind === 'sample');

  beforeEach(() => {
    bus = new GameEventBus();
    subs = new SubscriptionBag();
    log = new RunLogCollector();
    log.attach(bus, subs);
    step = 0;
    timeMs = 0;
    credits = 100;
    health = 100;
    alive = 0;
    standing = [];
    setBuildCommit('abc1234');
  });

  describe('the head', () => {
    it('marks a coop run with its players, and only the open run (review R16)', () => {
      open();
      log.markCoop(['Ann', 'Bob'], 'Bob');
      expect(log.close('defeat')!.head.coop).toEqual({ players: ['Ann', 'Bob'], you: 'Bob' });
      log.markCoop(['Carl'], 'Carl');
      open();
      expect(log.close('defeat')!.head.coop).toBeUndefined();
    });

    it('names the build, the balance, the seed and who played', () => {
      const head = open();

      expect(head).toMatchObject({
        kind: 'head',
        format: RUN_LOG_FORMAT,
        commit: 'abc1234',
        seed: 4711,
        map: 'devworld',
        player: 'bot',
        botSkill: 'expert',
      });
      expect(head.configHash).toMatch(/^[0-9a-f]+$/);
      expect(head.runId).toContain('devworld');
    });

    it('stamps the commit into a head that was born before the file arrived', () => {
      // The commit is fetched at startup and lands a moment after the first
      // run opened; the head must not keep its `unknown`.
      setBuildCommit('unknown');
      const head = open();
      expect(head.commit).toBe('unknown');

      log.setCommit('feedbee');

      expect(log.current()!.head.commit).toBe('feedbee');
    });

    it('never rewrites a commit the head already names', () => {
      const head = open();
      log.setCommit('something-else');
      expect(head.commit).toBe('abc1234');
    });

    it('is the first record, followed by the opening of the run', () => {
      open();
      expect(log.current()!.records[0].kind).toBe('head');
      expect(events()[0]).toMatchObject({ event: 'run-opened', wave: 0 });
    });
  });

  describe('a wave block', () => {
    it('covers the build phase before the wave: what was spent there belongs to it', () => {
      open();
      // Build phase: a tower and an upgrade before wave 1 even starts
      const archer = tower('t1', 'archer');
      standing = [archer];
      bus.emit({ type: 'tower:placed', tower: archer as never, position: { lat: 1, lon: 2 }, cost: 60 });
      book(-60, 'build');
      bus.emit({ type: 'tower:upgraded', tower: archer as never, level: 1, cost: 40, upgradeId: 'damage' });
      book(-40, 'upgrade');

      bus.emit({ type: 'wave:started', wave: 1, enemyCount: 3 });
      for (const id of ['e1', 'e2', 'e3']) bus.emit({ type: 'enemy:spawned', enemy: { id } as never });
      kill('e1');
      kill('e2');
      book(10, 'kill');
      archer.combat.damageDealt = 300;
      archer.combat.kills = 2;
      bus.emit({ type: 'enemy:reached-base', enemy: { id: 'e3' } as never, damage: 5 });
      health = 95;
      book(30, 'wave-bonus');
      bus.emit({ type: 'wave:completed', wave: 1, credits: 30, perfect: false, closeCall: false, hpLost: 5 });

      const [wave] = waves();
      expect(wave).toMatchObject({
        wave: 1,
        creditsStart: 100,
        creditsEnd: 40,
        spending: { build: 60, upgrade: 40 },
        towerSpending: { archer: 100 },
        income: { kill: 10, 'wave-bonus': 30 },
        enemiesSpawned: 3,
        killsByTower: 2,
        leaked: 1,
        healthStart: 100,
        healthEnd: 95,
      });
      expect(wave.towers).toEqual([
        { id: 't1', type: 'archer', levels: { damage: 2 }, damage: 300, kills: 2 },
      ]);
      expect(wave.mismatches).toBeUndefined();
    });

    it('books build and upgrade gold per tower type, so damage per gold has a divisor', () => {
      open();
      const archer = tower('t1', 'archer');
      const cannon = tower('t2', 'cannon');
      standing = [archer, cannon];
      bus.emit({ type: 'tower:placed', tower: archer as never, position: { lat: 1, lon: 2 }, cost: 45 });
      book(-45, 'build');
      bus.emit({ type: 'tower:placed', tower: cannon as never, position: { lat: 3, lon: 4 }, cost: 120 });
      book(-120, 'build');
      bus.emit({ type: 'tower:upgraded', tower: cannon as never, level: 1, cost: 80, upgradeId: 'damage' });
      book(-80, 'upgrade');
      bus.emit({ type: 'tower:upgraded', tower: cannon as never, level: 2, cost: 95, upgradeId: 'range' });
      book(-95, 'upgrade');

      bus.emit({ type: 'wave:started', wave: 1, enemyCount: 1 });
      bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });

      const [wave] = waves();
      expect(wave.towerSpending).toEqual({ archer: 45, cannon: 295 });
      // The types split exactly what the wave booked as build and upgrade gold
      const perType = Object.values(wave.towerSpending).reduce((a, b) => a + b, 0);
      expect(perType).toBe((wave.spending.build ?? 0) + (wave.spending.upgrade ?? 0));
    });

    it('leaves the free dev max-upgrade out, the same way the spending does', () => {
      open();
      const archer = tower('t1', 'archer');
      standing = [archer];
      bus.emit({ type: 'tower:placed', tower: archer as never, position: { lat: 1, lon: 2 }, cost: 45 });
      book(-45, 'build');
      bus.emit({ type: 'tower:upgraded', tower: archer as never, level: 1, cost: 0, upgradeId: 'damage' });

      bus.emit({ type: 'wave:started', wave: 1, enemyCount: 1 });
      bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });

      expect(waves()[0].towerSpending).toEqual({ archer: 45 });
    });

    it('starts a fresh tower spending per block, so a type is not counted twice', () => {
      open();
      const archer = tower('t1', 'archer');
      standing = [archer];
      bus.emit({ type: 'tower:placed', tower: archer as never, position: { lat: 1, lon: 2 }, cost: 45 });
      book(-45, 'build');
      bus.emit({ type: 'wave:started', wave: 1, enemyCount: 1 });
      bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });

      bus.emit({ type: 'wave:started', wave: 2, enemyCount: 1 });
      bus.emit({ type: 'wave:completed', wave: 2, credits: 0, perfect: true, closeCall: false, hpLost: 0 });

      expect(waves().map((w) => w.towerSpending)).toEqual([{ archer: 45 }, {}]);
    });

    it('starts the next block where the last one ended, so nothing is booked twice', () => {
      open();
      bus.emit({ type: 'wave:started', wave: 1, enemyCount: 1 });
      book(50, 'kill');
      bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
      book(-30, 'build');
      bus.emit({ type: 'wave:started', wave: 2, enemyCount: 1 });
      bus.emit({ type: 'wave:completed', wave: 2, credits: 0, perfect: true, closeCall: false, hpLost: 0 });

      expect(waves().map((w) => [w.wave, w.creditsStart, w.creditsEnd, w.income.kill ?? 0, w.spending.build ?? 0]))
        .toEqual([[1, 100, 150, 50, 0], [2, 150, 120, 0, 30]]);
    });

    it('keeps what the director decided', () => {
      open();
      log.noteDirectorDecision({
        template: 'Zombie Horde',
        reason: ['Campaign: wave 1 is always Zombie Horde (waves 1-30 are fixed).'],
        pressureMultiplier: 1.3,
        composition: [{ type: 'zombie', count: 20, hp: 0.8 }],
      });
      bus.emit({ type: 'wave:started', wave: 1, enemyCount: 20 });
      bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });

      expect(waves()[0]).toMatchObject({
        template: 'Zombie Horde',
        pressureMultiplier: 1.3,
        composition: [{ type: 'zombie', count: 20, hp: 0.8 }],
      });
      expect(waves()[0].reason).toHaveLength(1);
    });

    it('counts kills by who made them, an ooze only once as a leak', () => {
      open();
      bus.emit({ type: 'wave:started', wave: 1, enemyCount: 5 });
      kill('e1');
      bus.emit({ type: 'enemy:died', enemy: { id: 'e2' } as never, credits: 5, killedBy: { kind: 'hero' } });
      bus.emit({ type: 'enemy:died', enemy: { id: 'e3' } as never, credits: 5, killedBy: { kind: 'ability' } });
      bus.emit({ type: 'enemy:died', enemy: { id: 'e4' } as never, credits: 0, killedBy: { kind: 'debug' } });
      // The ooze flows in point by point, then dies: one leak, no kill
      bus.emit({ type: 'enemy:leaking', enemy: { id: 'ooze' } as never, damage: 1 });
      bus.emit({ type: 'enemy:leaking', enemy: { id: 'ooze' } as never, damage: 1 });
      bus.emit({ type: 'enemy:died', enemy: { id: 'ooze' } as never, credits: 0, killedBy: null });
      bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: false, closeCall: false, hpLost: 2 });

      expect(waves()[0]).toMatchObject({
        killsByTower: 1, killsByHero: 1, killsByAbility: 1, killsByDebug: 1, killsByOther: 0, leaked: 1,
      });
    });

    // Coop (TODO E34): the run log is this player's run
    it('keeps the towers and kills of a coop partner out of the numbers of this player', () => {
      const mine = tower('t1', 'archer');
      const theirs = tower('t2', 'cannon');
      standing = [mine, theirs];
      log.open({ seed: 1, map: 'devworld', player: 'human' }, {
        ...world(),
        ownsTower: (t) => t.id === 't1',
        ownsKill: (by) => by?.kind !== 'tower' || by.towerId === 't1',
      });
      bus.emit({ type: 'tower:placed', tower: mine as never, position: { lat: 1, lon: 2 }, cost: 45 });
      bus.emit({ type: 'tower:placed', tower: theirs as never, position: { lat: 3, lon: 4 }, cost: 120 });
      bus.emit({ type: 'wave:started', wave: 1, enemyCount: 3 });
      mine.combat = { damageDealt: 50, kills: 1 };
      theirs.combat = { damageDealt: 90, kills: 2 };
      kill('e1', 't1');
      kill('e2', 't2');
      kill('e3', 't2');
      bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });

      const [wave] = waves();
      expect(wave).toMatchObject({ killsByTower: 1, killsByPartner: 2, towerSpending: { archer: 45 } });
      expect(wave.towers.map((t) => t.id)).toEqual(['t1']);
      expect(events().filter((e) => e.event === 'tower-built').map((e) => e.id)).toEqual(['archer']);
      expect(reconcileWave({ ...wave, enemiesSpawned: 3 })).toEqual([]);
    });

    it('writes the block of the wave the base fell in', () => {
      open();
      bus.emit({ type: 'wave:started', wave: 7, enemyCount: 10 });
      kill('e1');

      // No wave:completed: the run ends inside the wave
      const run = log.close('defeat');

      const closedWaves = run!.records.filter((r): r is RunLogWave => r.kind === 'wave');
      expect(closedWaves.map((w) => w.wave)).toEqual([7]);
      expect(run!.records.at(-1)).toMatchObject({ kind: 'end', reason: 'defeat', waveReached: 7 });
      expect(log.isOpen).toBe(false);
    });

    it('hands the last wave and the end record to a drain after the close', () => {
      open();
      bus.emit({ type: 'wave:started', wave: 3, enemyCount: 1 });
      bus.emit({ type: 'wave:completed', wave: 3, credits: 0, perfect: false, closeCall: false, hpLost: 0 });
      log.drain();                                  // the bot sent wave 3
      bus.emit({ type: 'wave:started', wave: 4, enemyCount: 1 });

      // Game over reaches the log first, the bot session second
      log.close('defeat');
      const fresh = log.drain();

      expect(fresh.filter((r) => r.kind === 'wave').map((r) => (r as RunLogWave).wave)).toEqual([4]);
      expect(fresh.at(-1)).toMatchObject({ kind: 'end', reason: 'defeat' });
    });

    it('ends the run once, whoever asks first', () => {
      open();
      bus.emit({ type: 'wave:started', wave: 2, enemyCount: 1 });

      expect(log.close('defeat')).not.toBeNull();
      expect(log.close('defeat')).toBeNull();      // the bot session, a moment later

      const ends = log.current()!.records.filter((r) => r.kind === 'end');
      expect(ends).toHaveLength(1);
    });

    it('writes nothing more once the run is closed', () => {
      open();
      bus.emit({ type: 'wave:started', wave: 2, enemyCount: 1 });
      log.close('defeat');
      const after = log.current()!.records.length;

      kill('e1');
      bus.emit({ type: 'wave:completed', wave: 2, credits: 10, perfect: false, closeCall: false, hpLost: 0 });

      expect(log.current()!.records).toHaveLength(after);
    });
  });

  describe('the timeline', () => {
    it('stamps every event with the sub-step it happened in', () => {
      open();
      step = 12;
      timeMs = 200;
      bus.emit({ type: 'wave:started', wave: 1, enemyCount: 1 });
      step = 90;
      timeMs = 1500;
      bus.emit({ type: 'research:started', playerId: 'local', local: true, researchId: 'gatling-tech' } as never);

      expect(events().map((e) => [e.event, e.step, e.wave])).toEqual([
        ['run-opened', 0, 0],
        ['wave-started', 12, 1],
        ['research-started', 90, 1],
      ]);
    });

    it('keeps the decisions a player makes, with what they cost', () => {
      open();
      const archer = tower('t1', 'archer');
      standing = [archer];
      bus.emit({ type: 'tower:placed', tower: archer as never, position: { lat: 1, lon: 2 }, cost: 60 });
      bus.emit({ type: 'tower:upgraded', tower: archer as never, level: 1, cost: 40, upgradeId: 'damage' });
      bus.emit({ type: 'tower:sold', tower: archer as never, refund: 45 });
      log.noteHeroHired(1200);
      log.noteSpeed(75);
      log.notePause(true);

      expect(events().slice(1)).toMatchObject([
        { event: 'tower-built', id: 'archer', credits: -60, at: { lat: 1, lon: 2 } },
        { event: 'tower-upgraded', id: 'archer', credits: -40, value: 'damage' },
        { event: 'tower-sold', id: 'archer', credits: 45 },
        { event: 'hero-hired', credits: -1200 },
        { event: 'speed', value: 75 },
        { event: 'pause', value: true },
      ]);
    });

    it('leaves the dev max-upgrade out: it is no decision', () => {
      open();
      const archer = tower('t1', 'archer');
      bus.emit({ type: 'tower:upgraded', tower: archer as never, level: 0, cost: 0, upgradeId: 'debug-max' });
      expect(events().filter((e) => e.event === 'tower-upgraded')).toHaveLength(0);
    });
  });

  describe('the samples', () => {
    it('writes one a second of game time, not one a frame', () => {
      open();
      log.tick();                       // t=0: the first one
      timeMs = 500;
      log.tick();                       // too early
      timeMs = SAMPLE_INTERVAL_MS;
      alive = 12;
      log.tick();

      expect(samples()).toHaveLength(2);
      expect(samples()[1]).toMatchObject({ timeMs: 1000, credits: 100, baseHealth: 100, enemiesAlive: 12, dps: 43 });
    });

    it('writes nothing while no run is open', () => {
      log.tick();
      expect(log.current()).toBeNull();
    });
  });

  describe('the checks', () => {
    it('names a wave whose gold does not add up', () => {
      const wave = {
        kind: 'wave', wave: 1, step: 0, timeMs: 0, durationMs: 0,
        creditsStart: 100, creditsEnd: 500,
        income: { kill: 10 }, spending: { build: 60 }, towerSpending: { archer: 60 },
        enemiesSpawned: 3, killsByTower: 3, killsByHero: 0, killsByAbility: 0,
        killsByDebug: 0, killsByOther: 0, leaked: 0,
        enemiesAtStart: 0, enemiesAlive: 0,
        healthStart: 100, healthEnd: 100, towers: [],
      } as RunLogWave;

      expect(reconcileWave(wave)).toEqual(['gold: 100 + 10 - 60 = 50, end 500']);
    });

    it('names a wave whose bodies do not add up', () => {
      const wave = {
        kind: 'wave', wave: 1, step: 0, timeMs: 0, durationMs: 0,
        creditsStart: 0, creditsEnd: 0, income: {}, spending: {}, towerSpending: {},
        enemiesSpawned: 10, killsByTower: 4, killsByHero: 0, killsByAbility: 0,
        killsByDebug: 0, killsByOther: 0, leaked: 2,
        enemiesAtStart: 0, enemiesAlive: 1,
        healthStart: 100, healthEnd: 90, towers: [],
      } as RunLogWave;

      expect(reconcileWave(wave)).toEqual([
        'bodies: stood 0 + spawned 10 = 10, killed 4 + leaked 2 + alive 1 = 7',
      ]);
    });

    it('lets a wave kill what the one before it left standing', () => {
      const wave = {
        kind: 'wave', wave: 2, step: 0, timeMs: 0, durationMs: 0,
        creditsStart: 0, creditsEnd: 0, income: {}, spending: {}, towerSpending: {},
        enemiesSpawned: 10, killsByTower: 12, killsByHero: 0, killsByAbility: 0,
        killsByDebug: 0, killsByOther: 0, leaked: 0,
        enemiesAtStart: 2, enemiesAlive: 0,
        healthStart: 100, healthEnd: 100, towers: [],
      } as RunLogWave;

      expect(reconcileWave(wave)).toEqual([]);
    });

    it('passes a wave that adds up, and the collector then writes no mismatches', () => {
      open();
      bus.emit({ type: 'wave:started', wave: 1, enemyCount: 2 });
      bus.emit({ type: 'enemy:spawned', enemy: { id: 'e1' } as never });
      bus.emit({ type: 'enemy:spawned', enemy: { id: 'e2' } as never });
      kill('e1');
      bus.emit({ type: 'enemy:reached-base', enemy: { id: 'e2' } as never, damage: 5 });
      health = 95;
      bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: false, closeCall: false, hpLost: 5 });

      expect(waves()[0].mismatches).toBeUndefined();
    });
  });

  describe('as a file', () => {
    it('is one JSON object per line, and reads back the same', () => {
      open();
      bus.emit({ type: 'wave:started', wave: 1, enemyCount: 1 });
      bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
      const run = log.close('restart')!;

      const text = toJsonl(run.records);
      expect(text.split('\n').filter(Boolean)).toHaveLength(run.records.length);
      expect(fromJsonl(text)).toEqual(run.records);
    });

    it('survives a half-written last line', () => {
      const text = '{"kind":"head"}\n{"kind":"eve';
      expect(fromJsonl(text)).toEqual([{ kind: 'head' }]);
    });
  });
});
