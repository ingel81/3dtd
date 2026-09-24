import { describe, it, expect, beforeEach } from 'vitest';
import { WaveOutcomeTracker } from './wave-outcome-tracker';
import { GAME_BALANCE } from '../configs/game-balance.config';

const START_HP = GAME_BALANCE.player.startHealth;

/**
 * The running-wave bookkeeping on its own. The collector spec drives it
 * through the event bus; these pin the arithmetic with explicit times.
 */
describe('WaveOutcomeTracker', () => {
  let tracker: WaveOutcomeTracker;

  beforeEach(() => {
    tracker = new WaveOutcomeTracker();
  });

  it('counts spawns, kills and leaks per wave and per type', () => {
    tracker.start(3, 100, 0);
    tracker.enemySpawned('a', 'zombie', 0);
    tracker.enemySpawned('b', 'zombie', 0);
    tracker.enemySpawned('c', 'tank', 0);
    tracker.enemyDied('a', 'zombie', 0.5, 100);
    tracker.enemyReachedBase('c', 'tank', 200);

    const outcome = tracker.finalize('completed', 300);

    expect(outcome).toMatchObject({ enemiesSpawned: 3, enemiesKilled: 1, enemiesReachedBase: 1, playerSurvived: true });
    expect(outcome.enemyPerformance['zombie']).toMatchObject({ spawned: 2, killed: 1, reachedBase: 0 });
    expect(outcome.enemyPerformance['tank']).toMatchObject({ spawned: 1, killed: 0, reachedBase: 1 });
    expect(outcome.enemyProgressValues).toEqual([0.5, 1]);
    expect(outcome.avgPathProgressPercent).toBe(0.75);
  });

  it('counts only health losses as damage and keeps the lowest health', () => {
    tracker.start(0, 80, 0);
    tracker.healthChanged(70, -10);
    tracker.healthChanged(90, +20);
    tracker.healthChanged(85, -5);

    const outcome = tracker.finalize('completed', 0);

    expect(outcome.damageToPlayer).toBe(15);
    // Gegen die Start-HP der Config, nicht gegen den Stand zu Wellenbeginn.
    // Der Druck-Regler rechnet bewusst anders (pressure-controller.ts).
    expect(outcome.damagePercent).toBe(15 / START_HP);
    expect(outcome.lowestPlayerHealth).toBe(70);
  });

  it('ends a lifetime at death or base arrival and counts the rest up to the end', () => {
    tracker.start(3, 100, 1000);
    tracker.enemySpawned('a', 'zombie', 1000);
    tracker.enemySpawned('b', 'zombie', 1000);
    tracker.enemySpawned('c', 'zombie', 2000);
    tracker.enemyDied('a', 'zombie', undefined, 1500);  // 500
    tracker.enemyReachedBase('b', 'zombie', 3000);      // 2000

    const outcome = tracker.finalize('completed', 4000);  // c: 2000

    expect(outcome.avgEnemyLifetimeMs).toBe(1500);
    expect(outcome.enemyPerformance['zombie'].avgLifetimeMs).toBe(500);
    expect(outcome.enemyProgressValues).toEqual([1]);   // a had no movement component
  });

  it('counts an enemy spawned at game time 0', () => {
    tracker.start(1, 100, 0);
    tracker.enemySpawned('a', 'zombie', 0);
    tracker.enemyDied('a', 'zombie', 0.2, 800);

    const outcome = tracker.finalize('completed', 2000);

    expect(outcome.waveDurationMs).toBe(2000);
    expect(outcome.avgEnemyLifetimeMs).toBe(800);
    expect(outcome.enemyPerformance['zombie'].avgLifetimeMs).toBe(800);
  });

  it('calls a normal end a close call below 30% of the start health', () => {
    // Die Schwelle ist ein Anteil der Start-HP aus der Config, also rechnet
    // der Test mit ihr statt mit einer eigenen Zahl.
    const third = START_HP * 0.3;
    tracker.start(0, START_HP, 0);
    tracker.healthChanged(third, -(START_HP - third));
    expect(tracker.finalize('completed', 0).wasCloseCall).toBe(false);

    tracker.start(0, third, 0);
    tracker.healthChanged(third - 1, -1);
    expect(tracker.finalize('completed', 0).wasCloseCall).toBe(true);
  });

  it('marks a wave that destroyed the base as lost and a close call at zero health', () => {
    tracker.start(1, 10, 0);
    tracker.healthChanged(0, -10);

    const outcome = tracker.finalize('base-destroyed', 2000);

    expect(outcome).toMatchObject({ playerSurvived: false, wasCloseCall: true, lowestPlayerHealth: 0, waveDurationMs: 2000 });
  });

  it('reports an empty wave with zeroed progress and lifetime', () => {
    tracker.start(0, 100, 0);
    const outcome = tracker.finalize('completed', 500);

    expect(outcome.enemyProgressValues).toEqual([]);
    expect(outcome.avgPathProgressPercent).toBe(0);
    expect(outcome.avgEnemyLifetimeMs).toBe(0);
  });

  it('forgets the running wave on reset, keeping the clock', () => {
    tracker.start(2, 100, 1000);
    tracker.enemySpawned('a', 'zombie', 1000);
    tracker.enemyDied('a', 'zombie', 0.9, 1500);
    tracker.reset();

    const outcome = tracker.finalize('completed', 3000);

    expect(outcome.enemiesKilled).toBeUndefined();
    expect(outcome.enemyProgressValues).toEqual([]);
    expect(outcome.waveDurationMs).toBe(2000);
    expect(outcome.lowestPlayerHealth).toBe(100);
  });

  it('measures the duration from a restarted clock', () => {
    tracker.restartClock(5000);
    expect(tracker.finalize('completed', 6000).waveDurationMs).toBe(1000);
  });

  it('books an ooze as a leak from its first point that flows in, once, and not as a kill after it', () => {
    tracker.start(2, 100, 0);
    tracker.enemySpawned('ooze', 'ooze', 0);
    tracker.enemySpawned('whole', 'ooze', 0);
    // Flows in point by point, then dies halfway in
    tracker.enemyLeaking('ooze', 'ooze', 1000);
    tracker.enemyLeaking('ooze', 'ooze', 1500);
    tracker.enemyDied('ooze', 'ooze', 1, 2000);
    // Flows in whole
    tracker.enemyLeaking('whole', 'ooze', 3000);
    tracker.enemyReachedBase('whole', 'ooze', 4000);

    const outcome = tracker.finalize('completed', 5000);

    expect(outcome).toMatchObject({ enemiesKilled: 0, enemiesReachedBase: 2 });
    expect(outcome.enemyPerformance['ooze']).toMatchObject({ spawned: 2, killed: 0, reachedBase: 2 });
    expect(outcome.enemyProgressValues).toEqual([1, 1]);
    // Lifetimes end with the first point in
    expect(outcome.avgEnemyLifetimeMs).toBe(2000);
  });

  it('counts split children as spawned bodies', () => {
    tracker.start(1, 100, 0);
    tracker.enemiesSplit(2);

    expect(tracker.finalize('completed', 0).enemiesSpawned).toBe(3);
  });

  it('adds up ability kills from zero at every wave start', () => {
    tracker.start(3, 100, 0);
    tracker.abilityKilled(2);
    tracker.abilityKilled(1);
    expect(tracker.finalize('completed', 0).abilityKills).toBe(3);

    tracker.start(3, 100, 0);
    expect(tracker.finalize('completed', 0).abilityKills).toBe(0);
  });
});
