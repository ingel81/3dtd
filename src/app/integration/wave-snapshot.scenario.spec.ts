/**
 * The snapshot mid-wave (simulator/wave-snapshot.ts, TODO E58, COOP_PLAN
 * C5b): a wave runs to sub-step N, the state goes through JSON into a fresh
 * simulation on the same world, and both run on to the wave's end. The state
 * hash must be the same after every sub-step, and so must a second snapshot
 * taken at the end.
 *
 * GameObject ids come from a static counter; each simulation keeps its own
 * (Sim.run), as in the coop lockstep spec.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

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

import { GameObject } from '../core/game-object';
import type { WaveConfig, SpawnEntry } from '../managers/wave.manager';
import type { EnemyTypeId } from '../configs/enemy-types.config';
import type { WaveSnapshot } from '../simulator/wave-snapshot';
import { mulberry32 } from '../utils/game-rng';
import { HASH_PARTS, firstDifferences } from '../coop/hash-check';
import { buildSimWorld, type SimWorld, type SimWorldOptions } from './sim-world';

const SEED = 0x5a5e;

/** One simulation with its own GameObject id counter */
class Sim {
  private ids: number;

  constructor(readonly world: SimWorld) {
    this.ids = GameObject.getIdCounter();
  }

  get gsm() {
    return this.world.gsm;
  }

  run<T>(fn: () => T): T {
    GameObject.setIdCounter(this.ids);
    try {
      return fn();
    } finally {
      this.ids = GameObject.getIdCounter();
    }
  }

  /** One sub-step, as a re-simulation steps; true while the wave runs */
  step(): boolean {
    return this.run(() => {
      this.gsm.resimHost.simulateStep();
      return this.gsm.waveManager.phase() === 'wave';
    });
  }

  hash(): number {
    return this.run(() => this.gsm.stateHash());
  }

  emit(event: { type: string } & Record<string, unknown>): void {
    this.run(() => this.gsm.getEventBus().emit(event as never));
  }
}

interface Setup {
  world?: SimWorldOptions;
  /** Before the wave starts, on the simulation that will be snapshot */
  before?: (sim: Sim) => void;
  wave: WaveConfig;
  /** Coop: the players, each with the eight towers in turn */
  players?: string[];
}

function build(setup: Setup): Sim {
  GameObject.resetIdCounter();
  const world = buildSimWorld(services, SEED, setup.world);
  if (setup.players) {
    world.gsm.setPlayers(setup.players, setup.players[0]);
    world.towers.forEach((tower, i) => { tower.ownerId = setup.players![i % setup.players!.length]; });
    for (const id of setup.players) world.gsm.researchOf(id).completeResearch('aa-retrofit');
  }
  return new Sim(world);
}

function schedule(types: readonly EnemyTypeId[], count: number, health = 2, spawnMode: 'each' | 'random' = 'random'): WaveConfig {
  const entries: SpawnEntry[] = Array.from({ length: count }, (_, i) => ({ enemyType: types[i % types.length], speed: 1, health }));
  return { schedule: { entries, baseDelay: 300, delayVariation: 0.3, spawnMode } };
}

/**
 * Run the wave on one simulation to sub-step `at` after its start, take the
 * snapshot through JSON, restore it into a fresh one and run both to the end.
 * Returns the sub-steps compared.
 */
function splitAt(setup: Setup, at: number, tamper?: (snapshot: WaveSnapshot) => void): number {
  const mathRandom = Math.random;
  Math.random = mulberry32(SEED + 1);
  try {
    const a = build(setup);
    a.run(() => setup.before?.(a));
    a.emit({ type: 'command:start-wave', config: setup.wave });
    for (let i = 0; i < at; i++) {
      if (!a.step()) throw new Error(`the wave ended at sub-step ${i}, before ${at}`);
    }
    const refusal = a.run(() => a.gsm.waveSnapshotRefusal());
    if (refusal) throw new Error(`refused at ${at}: ${refusal}`);
    const snapshot = JSON.parse(JSON.stringify(a.run(() => a.gsm.captureWaveSnapshot()))) as WaveSnapshot;
    tamper?.(snapshot);

    const b = build(setup);
    b.run(() => b.gsm.restoreWaveSnapshot(snapshot));
    expect(b.hash()).toBe(a.hash());

    let compared = 0;
    for (let i = 0; i < 20_000; i++) {
      const runningA = a.step();
      const runningB = b.step();
      const ha = a.hash(), hb = b.hash();
      if (ha !== hb) {
        const pa = a.run(() => a.gsm.stateHashBreakdown());
        const pb = b.run(() => b.gsm.stateHashBreakdown());
        const parts = HASH_PARTS.filter((_, k) => pa.parts[k] !== pb.parts[k]);
        const first = firstDifferences([['a', pa.entities], ['b', pb.entities]], 1)[0];
        throw new Error(`diverged ${i + 1} sub-steps after the restore at ${at}: ${parts.join(', ')} ${JSON.stringify(first)}`);
      }
      compared++;
      expect(runningB).toBe(runningA);
      if (!runningA) break;
    }
    expect(a.gsm.waveManager.phase()).not.toBe('wave');
    return compared;
  } finally {
    Math.random = mathRandom;
  }
}

describe('Snapshot mid-wave (TODO E58, COOP_PLAN C5b)', () => {
  afterEach(() => {
    for (const key of Object.keys(services)) delete services[key];
  });

  const ground = schedule(['zombie', 'zombie-soldier', 'rat', 'tank'], 40);
  const air = schedule(['bat', 'hornet', 'dragon'], 30);
  const splitters = schedule(['skeleton', 'zombie'], 24, 1);
  const bosses = schedule(['stone-golem', 'mammoth', 'wallsmasher', 'zombie'], 12, 0.6, 'each');

  for (const at of [1, 60, 333, 900]) {
    it(`goes on bit for bit from sub-step ${at} of a ground wave`, () => {
      expect(splitAt({ wave: ground }, at)).toBeGreaterThan(100);
    });
  }

  it('goes on bit for bit in an air wave, portal climbs included', () => {
    for (const at of [40, 400]) expect(splitAt({ wave: air }, at)).toBeGreaterThan(100);
  });

  it('goes on bit for bit with skeletons splitting and shots in flight', () => {
    for (const at of [200, 700]) expect(splitAt({ wave: splitters }, at)).toBeGreaterThan(100);
  });

  it('goes on bit for bit with the heavy ones', () => {
    expect(splitAt({ wave: bosses }, 500)).toBeGreaterThan(100);
  });

  it('goes on bit for bit on a world at 49 N with bending routes', () => {
    expect(splitAt({ wave: ground, world: { origin: { lat: 49.0069, lon: 8.4037 } } }, 450)).toBeGreaterThan(100);
  });

  it('goes on bit for bit with two coop players on two lanes', () => {
    const setup: Setup = {
      wave: ground,
      players: ['a', 'b'],
      before: (sim) => sim.gsm.setLanes(new Map([['a', 'spawn-1'], ['b', 'spawn-2']])),
    };
    expect(splitAt(setup, 500)).toBeGreaterThan(100);
  });

  it('notices a snapshot that is off by one HP', () => {
    expect(() => splitAt({ wave: ground }, 333, (snapshot) => {
      const health = snapshot.wave!.enemies.enemies[0].health;
      health['_hp'] = (health['_hp'] as number) - 1;
    })).toThrow();
  });

  it.skip('worms: a chain is not in the snapshot yet (WaveSnapshotRefusal worm)', () => undefined);
  it.skip('oozes: a body along the route is not in the snapshot yet (WaveSnapshotRefusal ooze)', () => undefined);
  it.skip('strikes on their way: not in the snapshot yet (WaveSnapshotRefusal pending-strike)', () => undefined);
  it.skip('a hero with a target: not in the snapshot yet (WaveSnapshotRefusal hero-target)', () => undefined);
  it.skip('a manned tower: not in the snapshot yet (WaveSnapshotRefusal manned)', () => undefined);
});
