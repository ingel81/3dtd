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
import { stepsOf } from './test-helpers';
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
  /** On both simulations right after they are built */
  configure?: (sim: Sim) => void;
  /** Sub-steps after the restore at most; a worm takes long */
  maxSteps?: number;
  /** Commands at sub-step `step` of the wave: on the first simulation before the snapshot, on both after */
  during?: (sim: Sim, step: number) => void;
}

function build(setup: Setup): Sim {
  GameObject.resetIdCounter();
  const world = buildSimWorld(services, SEED, setup.world);
  if (setup.players) {
    world.gsm.setPlayers(setup.players, setup.players[0]);
    world.towers.forEach((tower, i) => { tower.ownerId = setup.players![i % setup.players!.length]; });
    for (const id of setup.players) world.gsm.researchOf(id).completeResearch('aa-retrofit');
  }
  const sim = new Sim(world);
  setup.configure?.(sim);
  return sim;
}

function schedule(types: readonly EnemyTypeId[], count: number, health = 2, spawnMode: 'each' | 'random' = 'random', speed = 1): WaveConfig {
  const entries: SpawnEntry[] = Array.from({ length: count }, (_, i) => ({ enemyType: types[i % types.length], speed, health }));
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
      setup.during?.(a, i);
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
    for (let i = 0; i < (setup.maxSteps ?? 20_000); i++) {
      setup.during?.(a, at + i);
      setup.during?.(b, at + i);
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

  it('goes on bit for bit with slow, burn and poison on the enemies (TODO E87)', () => {
    // With 2 HP and speed 1 the enemies die at the first two towers and never meet the ice, fire and poison ones
    // further down the routes; these walk past them
    const tough = schedule(['zombie', 'tank', 'rat'], 30, 3000, 'random', 4);
    const effects = new Set<string>();
    const noted = (snapshot: WaveSnapshot) => {
      for (const type of ['slow', 'burn', 'poison']) if (JSON.stringify(snapshot).includes(`"${type}"`)) effects.add(type);
    };
    for (const at of [1300, 3000]) expect(splitAt({ wave: tough, maxSteps: 8000 }, at, noted)).toBeGreaterThan(100);
    expect([...effects].sort()).toEqual(['burn', 'poison', 'slow']);
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
      before: (sim) => sim.gsm.setLanes([['a', 'spawn-1'], ['b', 'spawn-2']]),
    };
    expect(splitAt(setup, 500)).toBeGreaterThan(100);
  });

  it('notices a snapshot that is off by one HP', () => {
    expect(() => splitAt({ wave: ground }, 333, (snapshot) => {
      const health = snapshot.wave!.enemies.enemies[0].health;
      health['_hp'] = (health['_hp'] as number) - 1;
    })).toThrow();
  });

  it('goes on bit for bit with the hero fighting and strikes on their way, a beam burning included', () => {
    const at = (sim: Sim, route: number, index: number) => {
      const p = sim.world.routes[route][index];
      return { lat: p.lat, lon: p.lon };
    };
    const setup: Setup = {
      wave: ground,
      before: (sim) => {
        sim.gsm.getEventBus().emit({ type: 'debug:add-credits', amount: 50000 });
        sim.gsm.getEventBus().emit({ type: 'debug:ready-hero' });
        for (const abilityId of ['frost-bomb', 'orbital-laser', 'emp'] as const) {
          sim.gsm.getEventBus().emit({ type: 'debug:ready-ability', abilityId });
        }
      },
      during: (sim, step) => {
        if (step === 10) sim.emit({ type: 'command:hero-move', target: at(sim, 0, 12) });
        if (step === stepsOf(7000)) sim.emit({ type: 'command:use-ability', abilityId: 'frost-bomb', target: at(sim, 0, 20) });
        if (step === stepsOf(7200)) sim.emit({ type: 'command:use-ability', abilityId: 'orbital-laser', target: at(sim, 0, 4) });
        if (step === stepsOf(8300)) sim.emit({ type: 'command:use-ability', abilityId: 'emp', target: at(sim, 1, 25) });
      },
    };
    // The frost bomb and the laser on their way, then the laser burning, the EMP on its way
    const strikes = (snapshot: WaveSnapshot) => snapshot.wave!.strikes.flatMap(([, list]) => list.map((strike) => strike.fields['abilityId']));
    expect(splitAt(setup, stepsOf(7400), (snapshot) => expect(strikes(snapshot)).toEqual(['frost-bomb', 'orbital-laser']))).toBeGreaterThan(100);
    expect(splitAt(setup, stepsOf(8700), (snapshot) => expect(strikes(snapshot)).toEqual(['orbital-laser', 'emp']))).toBeGreaterThan(100);
    expect(splitAt(setup, stepsOf(10_000), (snapshot) => {
      expect(strikes(snapshot)).toEqual(['orbital-laser']);
      // The beam has burnt enemies: its shares go along
      expect(snapshot.wave!.strikes[0][1][0].dealt!.length).toBeGreaterThan(0);
    })).toBeGreaterThan(100);
  });

  it('goes on bit for bit with the hero on his way and fighting', () => {
    const setup: Setup = {
      wave: ground,
      before: (sim) => sim.gsm.getEventBus().emit({ type: 'debug:ready-hero' }),
      during: (sim, step) => {
        // The towers hold their fire, so the enemies come to him
        if (step === 0) for (const tower of sim.world.towers) sim.emit({ type: 'command:set-hold-fire', towerId: tower.id, holdFire: true });
        const p = sim.world.routes[0][3];
        if (step === 1) sim.emit({ type: 'command:hero-move', target: { lat: p.lat, lon: p.lon } });
        if (step === stepsOf(83_000)) for (const tower of sim.world.towers) sim.emit({ type: 'command:set-hold-fire', towerId: tower.id, holdFire: false });
      },
    };
    expect(splitAt(setup, stepsOf(41_700))).toBeGreaterThan(100);
    for (const step of [stepsOf(65_000), stepsOf(68_300)]) {
      expect(splitAt(setup, step, (snapshot) => expect(snapshot.wave!.heroTargets.length).toBe(1))).toBeGreaterThan(100);
    }
  });

  it('goes on bit for bit with a player sitting in a tower, aiming and firing', () => {
    const setup: Setup = {
      wave: ground,
      during: (sim, step) => {
        const tower = sim.world.towers[0];
        if (step === 5) sim.emit({ type: 'command:man-tower', towerId: tower.id });
        if (step === 6) sim.emit({ type: 'command:tower-aim', heading: 0.1, pitch: -0.05 });
        if (step === 200) sim.emit({ type: 'command:tower-trigger', held: true });
        if (step === 700) sim.emit({ type: 'command:tower-trigger', held: false });
      },
    };
    for (const step of [300, 750]) {
      expect(splitAt(setup, step, (snapshot) => expect(snapshot.base.mannedByPlayer).toEqual([['local', 'tower-1']]))).toBeGreaterThan(100);
    }
  });

  it('goes on bit for bit with a tower still waiting for its line of sight', () => {
    const setup: Setup = {
      wave: ground,
      // Nobody answers (answerLos): the tower waits on both
      before: (sim) => sim.gsm.getEventBus().emit({ type: 'debug:add-credits', amount: 5000 }),
      during: (sim, step) => {
        if (step !== 100) return;
        const p = sim.world.routes[0][30];
        sim.emit({ type: 'command:place-tower', typeId: 'archer', position: { lat: p.lat, lon: p.lon + 10 / 111_000, height: 0 } });
      },
    };
    expect(splitAt(setup, 300, (snapshot) => expect(snapshot.base.awaitingLos).toHaveLength(1))).toBeGreaterThan(100);
  });

  const worms = schedule(['worm', 'zombie', 'rat'], 6, 0.1, 'each');
  const oozes = schedule(['ooze', 'zombie', 'skeleton'], 6, 0.3, 'each');

  it('goes on bit for bit with worms coming out of the portal, walking and falling apart', { timeout: 60_000 }, () => {
    const wormsIn = (snapshot: WaveSnapshot) => snapshot.wave!.enemies.worms.groups.length;
    const setup: Setup = {
      wave: worms,
      maxSteps: 100_000,
      // A segment in the middle of the first worm dies: it falls apart into two
      during: (sim, step) => {
        if (step !== stepsOf(20_000)) return;
        const segment = sim.gsm.enemyManager.getAlive().filter((e) => e.worm !== null && e.worm.group.seq === 1)[4];
        sim.run(() => sim.gsm.enemyManager.kill(segment));
      },
    };
    const chains = (snapshot: WaveSnapshot) => snapshot.wave!.enemies.worms.groups[0].state.chains.length;
    // One worm a lane: the wave runs on each spawn point
    expect(splitAt(setup, stepsOf(500), (snapshot) => expect(wormsIn(snapshot)).toBe(2))).toBeGreaterThan(100);
    expect(splitAt(setup, stepsOf(10_000), (snapshot) => expect(wormsIn(snapshot)).toBe(4))).toBeGreaterThan(100);
    // Soon after the cut: the short front part rushes (EnemyChain.rush) and is through early
    for (const at of [stepsOf(21_700), stepsOf(25_000)]) {
      expect(splitAt(setup, at, (snapshot) => expect(chains(snapshot)).toBeGreaterThan(1))).toBeGreaterThan(100);
    }
  });

  it('goes on bit for bit with oozes growing along the route, flowing in and splitting', () => {
    const bodies = (snapshot: WaveSnapshot) => snapshot.wave!.enemies.oozes.length;
    for (const at of [stepsOf(1000), stepsOf(6700), stepsOf(20_000)]) {
      expect(splitAt({ wave: oozes }, at, (snapshot) => expect(bodies(snapshot)).toBeGreaterThan(0))).toBeGreaterThan(50);
    }
    // After the oozes: their clumps
    expect(splitAt({ wave: oozes }, stepsOf(41_700))).toBeGreaterThan(50);
  });
});
