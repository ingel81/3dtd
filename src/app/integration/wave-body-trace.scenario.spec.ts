/**
 * A trace per enemy id, from the spawn to the body's last booking.
 *
 * The run log reported `killed = spawned + 1` in about one wave in a hundred
 * (TODO E11): always exactly one body too many, always as a tower kill. The
 * bodies check of a wave block (reconcileWave, docs/RUN_LOG.md) only says
 * that the sum is off, not which body it was. This drives the real managers
 * and books every event by its id, so a body counted twice shows up as the
 * id it belongs to.
 *
 * What it pins down: an enemy that leaks is removed from the manager, but it
 * keeps its HP and with it `alive`. Every "is this target still valid" check
 * asks `alive` (Tower.findTarget's sticky fast path, Projectile.targetLost),
 * so a tower that holds it or a shot already in the air still reaches it.
 * The hit that takes its last HP then runs the full kill path on a body that
 * has left the game: a second `enemy:died` for it, and a second decrement of
 * `aliveCount`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Three.js before any imports that use it
vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import { createTestManagers, TestManagers, TEST_PATH, tickEngine } from './test-helpers';
import { GameEventBus, SubscriptionBag } from '../game-engine/game-event-bus';
import { RunLogCollector, type RunLogWorld } from '../run-log/run-log.service';
import type { RunLogWave } from '../run-log/run-log.types';
import { Tower } from '../entities/tower.entity';
import { Enemy } from '../entities/enemy.entity';
import type { GeoPosition } from '../models/game.types';

/** Right next to the last point of TEST_PATH, so the HQ end is in range. */
const TOWER_AT_BASE: GeoPosition = { lat: 48.7768, lon: 9.1830, height: 300 };

/** What a body was booked as, counted per event so a double shows as 2. */
interface BodyTrace {
  spawned: number;
  died: number;
  leaked: number;
}

describe('the bodies of a wave, traced per id', () => {
  let m: TestManagers;
  let bus: GameEventBus;
  let subs: SubscriptionBag;
  let log: RunLogCollector;
  let trace: Map<string, BodyTrace>;
  let clock: { now: number };

  const bodyOf = (id: string): BodyTrace => {
    let body = trace.get(id);
    if (!body) {
      body = { spawned: 0, died: 0, leaked: 0 };
      trace.set(id, body);
    }
    return body;
  };

  const world = (): RunLogWorld => ({
    step: () => Math.round(clock.now / 16),
    timeMs: () => clock.now,
    credits: () => 0,
    baseHealth: () => 100,
    enemiesAlive: () => m.enemyManager.getAliveCount(),
    dps: () => 0,
    towers: () => [],
  });

  const waves = (): RunLogWave[] =>
    (log.current()?.records ?? []).filter((r): r is RunLogWave => r.kind === 'wave');

  /** Walk an enemy into the HQ: the leak path, remove() without a kill. */
  const leak = (enemy: Enemy): void => {
    for (let i = 0; i < 200 && m.enemyManager.getById(enemy.id) !== null; i++) {
      clock = tickEngine(m, 16, clock);
    }
  };

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
    bus = m.eventBus;
    subs = new SubscriptionBag();
    log = new RunLogCollector();
    log.attach(bus, subs);
    trace = new Map();
    clock = { now: 0 };

    subs.add(bus.on('enemy:spawned', (e) => { bodyOf(e.enemy.id).spawned++; }));
    subs.add(bus.on('enemy:died', (e) => { bodyOf(e.enemy.id).died++; }));
    subs.add(bus.on('enemy:reached-base', (e) => { bodyOf(e.enemy.id).leaked++; }));
  });

  afterEach(() => {
    subs.disposeAll();
    vi.restoreAllMocks();
  });

  it('leaves a leaked enemy reachable for a tower that holds it', () => {
    // The last stretch of the route, so the tower at the HQ has it in range
    const enemy = m.enemyManager.spawn(TEST_PATH.slice(9), 'zombie', 40, false);
    const tower = new Tower(TOWER_AT_BASE, 'archer');

    // The tower acquires it while it is still on the route
    expect(tower.findTarget([enemy], false)).toBe(enemy);

    leak(enemy);

    // It is out of the game: removed from the manager and booked as a leak
    expect(m.enemyManager.getById(enemy.id)).toBeNull();
    expect(bodyOf(enemy.id).leaked).toBe(1);
    // ... but it kept its HP, so `alive` still says yes and the sticky fast
    // path of findTarget hands it back although no list holds it any more
    expect(enemy.alive).toBe(true);
    expect(tower.findTarget([], false)).toBe(enemy);
  });

  it('books a leaked body once, even when a tower shot still takes its HP', () => {
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 40, false);
    leak(enemy);
    expect(m.enemyManager.getAliveCount()).toBe(0);

    // The shot that was in the air when it leaked: its hit takes the last HP
    // and runs the kill path (DamageApplicationService.killEnemy).
    enemy.health.takeDamage(enemy.health.hp);
    const killed = m.enemyManager.kill(enemy, 'combat', { kind: 'tower', towerId: 't1' });

    expect(killed).toBe(false);
    expect(bodyOf(enemy.id)).toEqual({ spawned: 1, died: 0, leaked: 1 });
    expect(m.enemyManager.getAliveCount()).toBe(0);
  });

  it('does not drift aliveCount when a leaked body is killed on top', () => {
    const leaker = m.enemyManager.spawn(TEST_PATH, 'zombie', 40, false);
    leak(leaker);
    const walker = m.enemyManager.spawn(TEST_PATH, 'zombie', 1, false);
    expect(m.enemyManager.getAliveCount()).toBe(1);

    leaker.health.takeDamage(leaker.health.hp);
    m.enemyManager.kill(leaker, 'combat', { kind: 'tower', towerId: 't1' });

    // The second decrement used to eat the living one: aliveCount read 0 with
    // `walker` on the route, and checkWaveComplete() ends a wave on that 0.
    expect(m.enemyManager.getAliveCount()).toBe(1);
    expect(m.enemyManager.getById(walker.id)).toBe(walker);
  });

  it('adds up the bodies of a wave block in which one enemy leaked', () => {
    log.open({ seed: 4711, map: 'devworld', player: 'human' }, world());
    bus.emit({ type: 'wave:started', wave: 1, enemyCount: 2 });

    const leaker = m.enemyManager.spawn(TEST_PATH, 'zombie', 40, false);
    leak(leaker);
    const shot = m.enemyManager.spawn(TEST_PATH, 'zombie', 1, false);

    // The stale shot lands on the body that already leaked
    leaker.health.takeDamage(leaker.health.hp);
    m.enemyManager.kill(leaker, 'combat', { kind: 'tower', towerId: 't1' });
    // ... and a real kill on the enemy that is still there
    shot.health.takeDamage(shot.health.hp);
    m.enemyManager.kill(shot, 'combat', { kind: 'tower', towerId: 't1' });
    clock = tickEngine(m, 3000, clock);

    bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: false, closeCall: false, hpLost: 10 });

    const block = waves()[0];
    expect(block).toMatchObject({
      enemiesAtStart: 0,
      enemiesSpawned: 2,
      killsByTower: 1,
      leaked: 1,
      enemiesAlive: 0,
    });
    expect(block.mismatches).toBeUndefined();
  });
});
