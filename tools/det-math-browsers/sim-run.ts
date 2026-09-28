/**
 * What the browsers run (run.mjs): DetMath over fixed inputs, the native
 * functions over the same inputs for comparison, and the simulation of the
 * re-simulation spec (a wave with hero, frost bomb and commands, then the
 * boss wave) with its recorded hashes. Every engine that computes the same
 * bits gives the same result object.
 */
import { services } from './angular-shim';
import { DetMath } from '../../src/app/utils/det-math';
import { GameObject } from '../../src/app/core/game-object';
import { buildSimWorld } from '../../src/app/integration/sim-world';
import { mulberry32 } from '../../src/app/utils/game-rng';
import { METERS_PER_DEGREE_LAT as M } from '../../src/app/utils/geo-utils';
import type { SpawnEntry, WaveConfig } from '../../src/app/managers/wave.manager';

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

function fnv(hash: number, word: number): number {
  let h = hash;
  for (let b = 0; b < 4; b++) {
    h ^= (word >>> (8 * b)) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h;
}

/** Inputs of every magnitude the simulation meets and beyond, in turn */
function inputs(n: number, seed: number): Float64Array {
  const r = mulberry32(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = i % 6;
    out[i] = k === 0 ? (r() - 0.5) * 4 * Math.PI
      : k === 1 ? (r() - 0.5) * 1e-3
      : k === 2 ? (r() - 0.5) * 4000
      : k === 3 ? (r() - 0.5) * 2
      : k === 4 ? (r() - 0.5) * 2e5
      : (r() < 0.5 ? -1 : 1) * DetMath.pow(10, (r() - 0.5) * 40);
  }
  return out;
}

type Fn = (a: number, b: number) => number;
const clamp1 = (x: number): number => Math.max(-1, Math.min(1, x));

/** Each function with its inputs mapped into its domain */
function table(m: Record<string, (...args: number[]) => number>): Record<string, Fn> {
  return {
    sin: (a) => m['sin'](a),
    cos: (a) => m['cos'](a),
    tan: (a) => m['tan'](a),
    atan: (a) => m['atan'](a),
    asin: (a) => m['asin'](clamp1(a)),
    acos: (a) => m['acos'](clamp1(a)),
    exp: (a) => m['exp'](a % 700),
    log: (a) => m['log'](Math.abs(a) + 1e-300),
    atan2: (a, b) => m['atan2'](a, b),
    pow: (a, b) => m['pow'](Math.abs(a) % 5000, b % 20),
    hypot: (a, b) => m['hypot'](a, b),
  };
}

/** Per function the FNV-1a of the bits of all results */
function fingerprints(fns: Record<string, Fn>, a: Float64Array, b: Float64Array): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, fn] of Object.entries(fns)) {
    let h = 0x811c9dc5;
    for (let i = 0; i < a.length; i++) {
      f64[0] = fn(a[i], b[i]);
      h = fnv(fnv(h, u32[0]), u32[1]);
    }
    out[name] = h >>> 0;
  }
  return out;
}

function waveConfig(): WaveConfig {
  const types = ['zombie', 'rat', 'bat', 'zombie-soldier', 'skeleton', 'hornet'] as const;
  const entries: SpawnEntry[] = Array.from({ length: 70 }, (_, i) => ({ enemyType: types[i % types.length], speed: 1, health: 2 }));
  return { schedule: { entries, baseDelay: 350, delayVariation: 0.3, spawnMode: 'random' } };
}

function bossConfig(): WaveConfig {
  const types = ['ooze', 'worm', 'skeleton', 'zombie', 'skeleton', 'bat'] as const;
  const entries: SpawnEntry[] = types.map((enemyType) => ({ enemyType, speed: 1, health: 0.3 }));
  return { schedule: { entries, baseDelay: 900, spawnMode: 'each' } };
}

/**
 * The two waves of the re-simulation spec; the hashes the recorder took and the end hash.
 * With `origin`, the world with bending routes around it (sim-world.ts): at the equator the
 * angles are so small that native and deterministic functions give the same bits.
 */
export function simulate(origin?: { lat: number; lon: number }): { hashes: number[][]; end: number; kills: number } {
  GameObject.resetIdCounter();
  const random = Math.random;
  Math.random = mulberry32(0x51a1 + 1);
  try {
    const { gsm, towers, routes } = buildSimWorld(services, 0x51a1, origin ? { origin } : {});
    // Hero and frost bomb on the first route; at the equator where the spec sends them
    const heroTarget = origin ? { lat: routes[0][20].lat, lon: routes[0][20].lon } : { lat: 200 / M, lon: 0 };
    const frostTarget = origin ? { lat: routes[0][15].lat, lon: routes[0][15].lon } : { lat: 150 / M, lon: 0 };
    const bus = gsm.getEventBus();
    let kills = 0;
    bus.on('enemy:died', () => kills++);
    let now = 1000;
    gsm.gameSpeed.set(3);
    bus.emit({ type: 'debug:ready-hero' });
    bus.emit({ type: 'debug:ready-ability', abilityId: 'frost-bomb' });
    bus.emit({ type: 'command:start-wave', config: waveConfig() } as never);
    for (let f = 0; f < 6000 && gsm.waveManager.phase() === 'wave'; f++) {
      gsm.update((now += 10 + ((f * 7) % 31)));
      if (f === 20) bus.emit({ type: 'debug:add-credits', amount: 5000 });
      if (f === 25) bus.emit({ type: 'command:upgrade-tower', towerId: towers[0].id, upgradeId: 'damage' });
      if (f === 30) bus.emit({ type: 'command:set-targeting', towerId: towers[1].id, strategy: 'highest-hp' });
      if (f === 40) bus.emit({ type: 'command:hero-move', target: heroTarget });
      if (f === 90) bus.emit({ type: 'command:use-ability', abilityId: 'frost-bomb', target: frostTarget });
      if (f === 150) bus.emit({ type: 'command:upgrade-tower', towerId: towers[3].id, upgradeId: 'speed' });
    }
    now = 1e6;
    for (let i = 0; i < 400 && gsm.snapshotRefusal() !== null; i++) gsm.update((now += 16.667));
    bus.emit({ type: 'command:start-wave', config: bossConfig() } as never);
    for (let f = 0; f < 20000 && gsm.waveManager.phase() === 'wave'; f++) gsm.update((now += 10 + ((f * 13) % 29)));
    return { hashes: gsm.simRecorder.records.map((r) => r.hashes), end: gsm.stateHash(), kills };
  } finally {
    Math.random = random;
  }
}

export function run(n = 1_000_000): unknown {
  const a = inputs(n, 7), b = inputs(n, 11);
  const t0 = performance.now();
  const det = fingerprints(table(DetMath as unknown as Record<string, (...args: number[]) => number>), a, b);
  const t1 = performance.now();
  const native = fingerprints(table(Math as unknown as Record<string, (...args: number[]) => number>), a, b);
  const t2 = performance.now();
  const sim = { equator: simulate(), curved: simulate({ lat: 49.0069, lon: 8.4037 }) };
  const t3 = performance.now();
  const nativeInSim = countNative(() => simulate({ lat: 49.0069, lon: 8.4037 }));
  return {
    inputs: n, det, native, sim, nativeInSim,
    ms: { det: Math.round(t1 - t0), native: Math.round(t2 - t1), sim: Math.round(t3 - t2) },
  };
}

/**
 * How often `fn` calls a native transcendental, and how often its answer is not
 * DetMath's: where this engine's native bits would enter the state.
 */
function countNative(fn: () => unknown): Record<string, [number, number]> {
  const names = ['sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'exp', 'log', 'pow', 'hypot'] as const;
  const math = Math as unknown as Record<string, (...args: number[]) => number>;
  const det = DetMath as unknown as Record<string, (...args: number[]) => number>;
  const native = Object.fromEntries(names.map((name) => [name, math[name]]));
  const counts: Record<string, [number, number]> = Object.fromEntries(names.map((name) => [name, [0, 0]]));
  for (const name of names) {
    math[name] = (...args: number[]) => {
      const r = native[name](...args);
      counts[name][0]++;
      if (args.length <= 2 && !Object.is(r, det[name](...args)) && !(r !== r && det[name](...args) !== det[name](...args))) counts[name][1]++;
      return r;
    };
  }
  try {
    fn();
  } finally {
    for (const name of names) math[name] = native[name];
  }
  return counts;
}

/**
 * A long, heavy run for the late divergence of Chromium against Firefox (TODO E64): the curved
 * world at 49 N, every tower upgraded, waves of oozes, skeletons, zombies and bats with much HP,
 * a frost bomb every few seconds. The state hash at every sub-step boundary, so two engines
 * show the first sub-step where they part.
 */
export function heavy(waves = 6): { hashes: number[]; waves: number; kills: number; subSteps: number } {
  GameObject.resetIdCounter();
  const random = Math.random;
  Math.random = mulberry32(0x51a1 + 3);
  try {
    const { gsm, towers, routes } = buildSimWorld(services, 0x51a1, { origin: { lat: 49.0069, lon: 8.4037 } });
    const hashes: number[] = [];
    gsm.resimHost.setBoundaryListener((_step, hash) => hashes.push(hash()));
    const bus = gsm.getEventBus();
    let kills = 0;
    bus.on('enemy:died', () => kills++);
    let now = 1000;
    gsm.gameSpeed.set(4);
    bus.emit({ type: 'debug:add-credits', amount: 500000 });
    bus.emit({ type: 'debug:ready-hero' });
    gsm.update((now += 40));
    for (const tower of towers) {
      for (const upgradeId of ['damage', 'speed', 'damage', 'range', 'damage'] as const) {
        bus.emit({ type: 'command:upgrade-tower', towerId: tower.id, upgradeId } as never);
      }
    }
    gsm.update((now += 40));
    const types = ['ooze', 'skeleton', 'zombie', 'bat', 'skeleton', 'zombie'] as const;
    let played = 0;
    for (let w = 0; w < waves && gsm.waveManager.phase() !== 'gameover'; w++) {
      const entries: SpawnEntry[] = Array.from({ length: 48 }, (_, i) => ({ enemyType: types[i % types.length], speed: 1, health: 4 + w }));
      bus.emit({ type: 'command:start-wave', config: { schedule: { entries, baseDelay: 250, delayVariation: 0.3, spawnMode: 'random' } } } as never);
      played++;
      for (let f = 0; f < 40000 && gsm.waveManager.phase() === 'wave'; f++) {
        gsm.update((now += 10 + ((f * 13) % 29)));
        if (f % 120 === 60) {
          const enemies = gsm.enemyManager.getAll();
          const target = enemies.length > 0 ? enemies[Math.floor(enemies.length / 2)].position : routes[0][15];
          bus.emit({ type: 'debug:ready-ability', abilityId: 'frost-bomb' });
          bus.emit({ type: 'command:use-ability', abilityId: 'frost-bomb', target: { lat: target.lat, lon: target.lon } } as never);
        }
      }
      for (let i = 0; i < 200 && gsm.waveManager.phase() !== 'wave' && gsm.waveManager.phase() !== 'gameover'; i++) {
        gsm.update((now += 16.667));
      }
    }
    return { hashes, waves: played, kills, subSteps: gsm.subStep };
  } finally {
    Math.random = random;
  }
}

(globalThis as unknown as { detMathRun: typeof run }).detMathRun = run;
