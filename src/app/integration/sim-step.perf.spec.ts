/**
 * Benchmark of the whole simulation sub-step (docs/SIMULATOR_PLAN.md, P5):
 * the real GameStateManager loop with enemies, towers of every fighting type
 * and their projectiles in fixed amounts, rendering off. Harness and what it
 * stubs: sim-step-bench.ts.
 *
 * The normal run only checks that the smallest scenario runs and the towers
 * fight. The measurement runs with SIM_BENCH=1 or `npm run bench:sim`, then
 * prints a table per scenario and the fast-forward speed of a mid-game wave:
 *
 *   npm run bench:sim
 *   $env:SIM_BENCH=1; npx vitest run src/app/integration/sim-step.perf.spec.ts --silent=false
 *
 * Wall-clock numbers: compare runs on the same machine, one after the other.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// Real three.js for the math; its audio classes from the mock, they would load files and need Web Audio
vi.mock('three', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('three');
  const mock = await import('@/test/mocks/three.mock');
  return {
    ...actual,
    Audio: mock.Audio,
    AudioListener: mock.AudioListener,
    AudioLoader: mock.AudioLoader,
    PositionalAudio: mock.PositionalAudio,
  };
});

const services = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  const { noopStub } = await import('./noop-stub');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    effect: () => undefined,
    inject: (token: { name?: string }) => {
      const name = token?.name ?? 'unknown';
      if (!services[name]) services[name] = noopStub();
      return services[name];
    },
  };
});

import {
  BENCH_TOWER_TYPES,
  createSimBench,
  measureFastForward,
  measureSteps,
  type SimBench,
  type SimScenario,
  type StepStats,
} from './sim-step-bench';

/** `npm run bench:sim` runs vitest with --mode simbench, which works the same in every shell */
const mode = (import.meta as { env?: Record<string, string> }).env?.['MODE'];
const HEAVY = process.env['SIM_BENCH'] === '1' || mode === 'simbench';

/** One tower of each fighting type */
const SMOKE: SimScenario = { name: 'smoke', routes: 1, routeLengthM: 300, towers: BENCH_TOWER_TYPES.length, enemies: 60, hpFactor: 4 };
const SCENARIOS: SimScenario[] = [
  { name: 'S', routes: 1, routeLengthM: 800, towers: 20, enemies: 200, hpFactor: 8 },
  { name: 'M', routes: 2, routeLengthM: 1000, towers: 60, enemies: 1000, hpFactor: 8 },
  { name: 'L', routes: 4, routeLengthM: 1000, towers: 120, enemies: 3000, hpFactor: 8 },
];
/** A mid-game wave: about the towers a player has then, one of each type and more, and its enemies alive at once */
const MID_WAVE: SimScenario = { name: 'mid-wave', routes: 1, routeLengthM: 800, towers: 20, enemies: 150, hpFactor: 8 };
/** A three-minute wave in sub-steps, the replay's seek target (under 2 s) */
const WAVE_STEPS = 10_800;
const WARMUP = 300;
const STEPS = 600;
/** Rounds of STEPS per scenario; the table shows the one with the lowest median, the least disturbed */
const ROUNDS = 3;

const f = (n: number, digits = 2): string => n.toFixed(digits);

function row(scenario: SimScenario, s: StepStats, bench: SimBench): string {
  return `| ${scenario.name} | ${scenario.towers} | ${scenario.enemies} | ${f(s.medianMs, 3)} | ${f(s.p95Ms, 3)} | `
    + `${f(s.stepsPerSecond, 0)} | ${f(s.projectileMs, 3)} | ${f(s.combatMs, 3)} | ${f(s.eventsMs, 3)} | `
    + `${f(s.meanMs - s.projectileMs - s.combatMs - s.eventsMs, 3)} | `
    + `${bench.gsm.projectileManager.getAll().length} | ${bench.kills()} |`;
}

describe('Simulation sub-step benchmark', () => {
  let bench: SimBench | null = null;

  afterEach(() => {
    bench?.dispose();
    bench = null;
    vi.restoreAllMocks();
  });

  it('smoke: the loop runs, towers of every kind deal damage, enemies stay topped up', () => {
    // A handler that throws is caught and logged by the event bus: stub gaps show up here
    const errors = vi.spyOn(console, 'error');
    bench = createSimBench(SMOKE, services);
    expect(bench.run(300, 10)).toBe(bench.gsm.subStep);
    expect(bench.gsm.subStep).toBeGreaterThanOrEqual(300);
    expect(errors).not.toHaveBeenCalled();
    // A stub answering undefined where a number is due turns into NaN silently
    const unplaced = bench.gsm.enemyManager.getAlive().filter((e) =>
      !Number.isFinite(e.transform.terrainHeight) || !Number.isFinite(e.position.lat));
    expect(unplaced).toEqual([]);
    expect(bench.damageDealt()).toBeGreaterThan(0);
    const idle = bench.towers.filter((t) => t.combat.damageDealt === 0).map((t) => t.typeConfig.id);
    expect(idle).toEqual([]);
    expect(bench.gsm.enemyManager.aliveCount()).toBeGreaterThan(SMOKE.enemies / 2);
  });

  it('smoke: the same seed gives the same run, whatever Math.random draws', () => {
    const outcome = (skipDraws: number): string => {
      const b = createSimBench(SMOKE, services);
      // Math.random is the presentation's; the simulation draws from gsm.rng
      for (let i = 0; i < skipDraws; i++) Math.random();
      b.run(300, 10);
      const result = `${b.damageDealt()} ${b.kills()} ${b.gsm.enemyManager.aliveCount()}`;
      b.dispose();
      return result;
    };
    const first = outcome(0);
    expect(outcome(0)).toBe(first);
    expect(outcome(7)).toBe(first);
  });

  it.runIf(HEAVY)('measures ms per sub-step for S, M and L', { timeout: 900_000 }, () => {
    const lines = [
      '| Szenario | Tower | Gegner | Median ms | p95 ms | Sub-Steps/s | Projektile ms | Kampf ms | Events ms | Rest ms | Projektile aktiv | Kills gesamt |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ];
    for (const scenario of SCENARIOS) {
      bench = createSimBench(scenario, services);
      let stats = measureSteps(bench, WARMUP, STEPS);
      for (let r = 1; r < ROUNDS; r++) {
        const round = measureSteps(bench, 0, STEPS);
        if (round.medianMs < stats.medianMs) stats = round;
      }
      expect(bench.damageDealt()).toBeGreaterThan(0);
      lines.push(row(scenario, stats, bench));
      bench.dispose();
      bench = null;
    }
    console.log(`\nSub-step, ${STEPS} steps after ${WARMUP} warm-up, timescale 10\n${lines.join('\n')}`);
  });

  it.runIf(HEAVY)('measures the state hash the recorder takes once per game second', { timeout: 300_000 }, () => {
    const lines = ['| Szenario | Gegner | Tower | Hash ms | je Sub-Step (1/60) ms |', '|---|---|---|---|---|'];
    for (const scenario of SCENARIOS) {
      bench = createSimBench(scenario, services);
      bench.run(WARMUP, 10);
      const times: number[] = [];
      for (let i = 0; i < 40; i++) {
        const t0 = performance.now();
        bench.gsm.stateHash();
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      const median = times[times.length >> 1];
      lines.push(`| ${scenario.name} | ${scenario.enemies} | ${scenario.towers} | ${f(median, 3)} | ${f(median / 60, 4)} |`);
      bench.dispose();
      bench = null;
    }
    console.log(`\nState hash (StateHasher), median of 40\n${lines.join('\n')}`);
  });

  it.runIf(HEAVY)('measures the fast-forward of a mid-game wave', { timeout: 300_000 }, () => {
    bench = createSimBench(MID_WAVE, services);
    bench.run(WARMUP, 75);
    const { totalMs, stepsPerSecond } = measureFastForward(bench, WAVE_STEPS);
    expect(bench.damageDealt()).toBeGreaterThan(0);
    console.log(
      `\nFast-forward ${MID_WAVE.name} (${MID_WAVE.towers} towers, ${MID_WAVE.enemies} enemies): `
      + `${WAVE_STEPS} sub-steps in ${f(totalMs, 0)} ms, ${f(stepsPerSecond, 0)} sub-steps/s, `
      + `${bench.kills()} kills`,
    );
  });
});
