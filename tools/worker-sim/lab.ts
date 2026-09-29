// Worker stage 1 (docs/WORKER_PLAN.md): the real simulation without a picture, the same code on the
// main thread and in a module worker. Record a run of several waves, re-simulate it from the replay
// file wave by wave and compare every state hash; time the sub-step at 5000 enemies.
import { diagnostics } from './diag';
import { lab } from './angular-shim';
import { buildSimWorld } from '../../src/app/integration/sim-world';
import { createSimBench, measureSteps, type StepStats } from '../../src/app/integration/sim-step-bench';
import type { WaveConfig, SpawnEntry } from '../../src/app/managers/wave.manager';
import { GameObject } from '../../src/app/core/game-object';
import { mulberry32 } from '../../src/app/utils/game-rng';
import { METERS_PER_DEGREE_LAT as M } from '../../src/app/utils/geo-utils';
import { Resimulation } from '../../src/app/simulator/resimulation';
import { buildReplayFile, readReplayFile } from '../../src/app/simulator/replay-file';

const SEED = 0x51a1;

const HERE = { configHash: 'lab', gameVersion: 'lab' };

function world() {
  GameObject.resetIdCounter();
  Math.random = mulberry32(SEED + 1);
  const built = buildSimWorld(lab().services, SEED);
  built.gsm.adjustBaseHealth(1e6);
  return built;
}

const entries = (types: readonly string[], n: number, health: number): SpawnEntry[] =>
  Array.from({ length: n }, (_, i) => ({ enemyType: types[i % types.length], speed: 1, health }) as SpawnEntry);

/** Mixed with commands, bodies and splitters, worms on both routes, a big one */
const WAVES: { config: WaveConfig; speed: number }[] = [
  { speed: 3, config: { schedule: { entries: entries(['zombie', 'rat', 'bat', 'zombie-soldier', 'skeleton', 'hornet'], 70, 2), baseDelay: 350, delayVariation: 0.3, spawnMode: 'random' } } },
  { speed: 4, config: { schedule: { entries: entries(['ooze', 'worm', 'skeleton', 'zombie', 'skeleton', 'bat'], 6, 0.3), baseDelay: 900, spawnMode: 'each' } } },
  { speed: 4, config: { schedule: { entries: entries(['worm', 'worm', 'zombie', 'bat'], 4, 0.2), baseDelay: 400, spawnMode: 'each' } } },
  { speed: 4, config: { schedule: { entries: entries(['zombie', 'rat', 'tank', 'skeleton', 'spider', 'penguin', 'bat', 'hornet'], 400, 3), baseDelay: 60, delayVariation: 0.5, spawnMode: 'random' } } },
];

export interface WaveResult {
  wave: number;
  steps: number;
  hashes: number;
  checked: number;
  divergedAt: number | null;
  endHash: number;
  ms: number;
}

/** Play the waves live, with commands in the first; the replay file and each wave's hash at its end. */
export function record(): { text: string; waves: WaveResult[]; ms: number } {
  const t0 = performance.now();
  const { gsm, towers } = world();
  const bus = gsm.getEventBus();
  const out: WaveResult[] = [];
  let now = 1000;
  bus.emit({ type: 'debug:ready-hero' });
  bus.emit({ type: 'debug:ready-ability', abilityId: 'frost-bomb' });
  WAVES.forEach(({ config, speed }, i) => {
    const w0 = performance.now();
    const wave = i + 1;
    let endHash: number | null = null;
    gsm.gameSpeed.set(speed);
    bus.emit({ type: 'command:start-wave', config } as never);
    for (let f = 0; f < 40000 && gsm.waveManager.phase() === 'wave'; f++) {
      now += 10 + ((f * 7) % 31);
      gsm.update(now, () => {
        if (endHash === null && gsm.waveManager.phase() !== 'wave' && gsm.simRecorder.get(wave)?.endStep != null) endHash = gsm.stateHash();
      });
      // What SimCore hands the packet after every frame
      gsm.ops.take();
      if (wave !== 1) continue;
      if (f === 20) bus.emit({ type: 'debug:add-credits', amount: 5000 });
      if (f === 25) bus.emit({ type: 'command:upgrade-tower', towerId: towers[0].id, upgradeId: 'damage' });
      if (f === 30) bus.emit({ type: 'command:set-targeting', towerId: towers[1].id, strategy: 'highest-hp' });
      if (f === 40) bus.emit({ type: 'command:hero-move', target: { lat: 200 / M, lon: 0 } });
      if (f === 60) bus.emit({ type: 'command:set-hold-fire', towerId: towers[2].id, holdFire: true });
      if (f === 90) bus.emit({ type: 'command:use-ability', abilityId: 'frost-bomb', target: { lat: 150 / M, lon: 0 } });
      if (f === 120) bus.emit({ type: 'command:set-hold-fire', towerId: towers[2].id, holdFire: false });
      if (f === 150) bus.emit({ type: 'command:upgrade-tower', towerId: towers[3].id, upgradeId: 'speed' });
    }
    if (gsm.waveManager.phase() === 'wave') throw new Error(`wave ${wave} did not end`);
    const rec = gsm.simRecorder.get(wave)!;
    out.push({
      wave, steps: rec.endStep! - rec.startStep, hashes: rec.hashes.length, checked: rec.hashes.length,
      divergedAt: null, endHash: endHash!, ms: performance.now() - w0,
    });
    // Let the last shots land, so the next wave's snapshot is allowed
    for (let k = 0; k < 400 && gsm.snapshotRefusal() !== null; k++) {
      gsm.update((now += 16.667));
      gsm.ops.take();
    }
  });
  const text = JSON.stringify(buildReplayFile(gsm.simRecorder.records, gsm.commandLog.entries, {
    worldKey: gsm.worldKey(), configHash: HERE.configHash, seed: gsm.rng.seed, gameVersion: HERE.gameVersion, commit: 'lab',
  }));
  return { text, waves: out, ms: performance.now() - t0 };
}

/** Re-simulate every wave of the file in a fresh game on the same world. */
export function resimulate(text: string): { waves: WaveResult[]; ms: number } {
  const t0 = performance.now();
  const { gsm } = world();
  const read = readReplayFile(text, { worldKey: gsm.worldKey(), ...HERE });
  if (read.refusal) throw new Error(`replay refused: ${read.refusal}`);
  const waves = read.file!.waves.map((record) => {
    const w0 = performance.now();
    const resim = new Resimulation(gsm.resimHost, record, read.file!.log);
    resim.start();
    while (resim.step()) { /* to the end */ }
    const r: WaveResult = {
      wave: record.wave, steps: resim.stepInWave, hashes: record.hashes.length, checked: resim.checkedHashes,
      divergedAt: resim.divergedAt, endHash: gsm.stateHash(), ms: performance.now() - w0,
    };
    resim.end();
    return r;
  });
  return { waves, ms: performance.now() - t0 };
}

/** The sub-step at `enemies` enemies (sim-step-bench.ts), best of `rounds` by median. */
export function bench(enemies: number, timescale: number, rounds = 3): StepStats & { setupMs: number } {
  const t0 = performance.now();
  const b = createSimBench({ name: 'worker-lab', routes: 4, routeLengthM: 1000, towers: 120, enemies, hpFactor: 8 }, lab().services);
  const setupMs = performance.now() - t0;
  let best: StepStats | null = null;
  for (let r = 0; r < rounds; r++) {
    const s = measureSteps(b, r === 0 ? 300 : 60, 600, timescale);
    if (!best || s.medianMs < best.medianMs) best = s;
  }
  b.dispose();
  return { ...best!, setupMs };
}

/** Injected services nobody provided: the simulation reached them, they got a no-op stub */
export const stubbedServices = (): string[] => [...lab().stubbed].sort();

export { diagnostics };

/**
 * What the simulation reaches outside itself: the run of `record` once more with every service
 * nobody provided traced (the simulation has no engine any more). Member path and calls, most first.
 */
export function reach(): [string, number][] {
  const l = lab();
  l.calls.clear();
  l.tracing = true;
  try {
    record();
  } finally {
    l.tracing = false;
  }
  return [...l.calls].sort((a, b) => b[1] - a[1]);
}

export const env = () => ({
  isolated: (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? false,
  worker: typeof (globalThis as { document?: unknown }).document === 'undefined',
});
