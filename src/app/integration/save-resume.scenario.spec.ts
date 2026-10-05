/**
 * Acceptance of the save game (docs/SAVE_LOAD_PLAN.md, TODO E110): a run is
 * saved between two waves, the save goes through its file as text, and a
 * fresh simulation built from the save's world package (not from the
 * tiles: its ground gives nothing) takes the snapshot back and plays the
 * next wave with the same commands. Every sub-step's state hash must come
 * out as the uninterrupted run's, bit for bit.
 *
 * The real GameStateManager with the real route grid, combat and damage on
 * a frame with hills (sim-world.ts), as the re-simulation and the coop
 * lockstep specs run it.
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

import { setActiveWaveRules } from '../director/wave-rules';
import { RUN_PLAN_RULES } from '../director/sources/budget/run-plan';
import { GameObject } from '../core/game-object';
import type { WaveConfig, SpawnEntry } from '../managers/wave.manager';
import { mulberry32 } from '../utils/game-rng';
import { METERS_PER_DEGREE_LAT as M } from '../utils/geo-utils';
import { buildWorldPackage, packagePaths } from '../coop/world-package';
import { buildSaveFile, readSaveFile } from '../simulator/save-file';
import { buildSimWorld, worldSourceOf, type SimWorld, type SimWorldOptions } from './sim-world';

const SEED = 0x5a7e;
const HEAD = { gameVersion: 'v9.9.9', configHash: 'cfg' };

function hills(x: number, z: number): number | null {
  return 3 * Math.sin(x / 41) + 2 * Math.cos(z / 29) + z * 0.008;
}

function waveConfig(health: number): WaveConfig {
  const types = ['zombie', 'rat', 'bat', 'zombie-soldier', 'skeleton', 'hornet', 'ooze'] as const;
  const entries: SpawnEntry[] = Array.from({ length: 50 }, (_, i) => ({ enemyType: types[i % types.length], speed: 1, health }));
  return { schedule: { entries, baseDelay: 400, delayVariation: 0.3, spawnMode: 'random' } };
}

/**
 * One wave with commands at fixed frames, line of sight answered after
 * every frame. Returns the state hash after each frame and at the end.
 */
function playWave(world: SimWorld, config: WaveConfig, commands: (frame: number) => void): number[] {
  const { gsm } = world;
  const bus = gsm.getEventBus();
  const hashes: number[] = [];
  let now = 1000 + gsm.subStep * 16;
  bus.emit({ type: 'command:start-wave', config } as never);
  for (let f = 0; f < 15_000 && gsm.waveManager.phase() === 'wave'; f++) {
    now += 10 + ((f * 7) % 31);
    gsm.update(now);
    world.answerLos();
    commands(f);
    hashes.push(gsm.stateHash());
  }
  expect(gsm.waveManager.phase()).not.toBe('wave');
  // The break after the wave: a few frames, the events of its end delivered
  for (let f = 0; f < 5; f++) {
    now += 16;
    gsm.update(now);
    world.answerLos();
  }
  hashes.push(gsm.stateHash());
  return hashes;
}

describe('Save game: saved between waves, loaded into a fresh simulation (TODO E110)', () => {
  const mathRandom = Math.random;
  afterEach(() => {
    Math.random = mathRandom;
  });

  function build(seed: number, options: SimWorldOptions): SimWorld {
    GameObject.resetIdCounter();
    Math.random = mulberry32(seed + 1);
    setActiveWaveRules(RUN_PLAN_RULES);
    return buildSimWorld(services, seed, options);
  }

  it('plays the next wave bit for bit as the run that was never left', () => {
    const live = build(SEED, { ground: hills });
    const { gsm } = live;
    const bus = gsm.getEventBus();
    const towers = live.towers;

    // Wave 1 with purchases, then the break: the save
    gsm.gameSpeed.set(3);
    bus.emit({ type: 'debug:add-credits', amount: 4000 });
    playWave(live, waveConfig(2), (f) => {
      if (f === 15) bus.emit({ type: 'command:upgrade-tower', towerId: towers[0].id, upgradeId: 'damage' });
      if (f === 40) bus.emit({ type: 'command:hero-move', target: { lat: 180 / M, lon: 0 } });
    });
    bus.emit({ type: 'command:set-targeting', towerId: towers[1].id, strategy: 'highest-hp' });
    gsm.update(1000 + gsm.subStep * 16 + 16);
    expect(gsm.snapshotRefusal()).toBeNull();

    const text = JSON.stringify(buildSaveFile({
      ...HEAD,
      commit: 'test',
      name: 'Hills, wave 2',
      wave: gsm.waveManager.waveNumber() + 1,
      place: { name: 'Hills', hq: live.hq, spawns: gsm.getSpawnPoints().map(({ lat, lon }) => ({ lat, lon })) },
      world: buildWorldPackage(worldSourceOf(live), HEAD),
      sim: gsm.captureSnapshot(),
      director: { source: 'budget', sourceState: null, planned: null },
      mainRng: { seed: SEED, streams: {} },
      runLog: null,
      waveSeries: [],
    }));
    const keyAtSave = gsm.worldKey();
    // The frame bookkeeping starts over as after a load (GameClock.setState): which wall-clock frame
    // takes which sub-step is the loop's business, not the game's, and the commands go in by frame here
    const clock = (gsm as unknown as { clock: { getState(): unknown; setState(state: unknown): void } }).clock;
    clock.setState(clock.getState());

    // The run goes on without a break: wave 2 with commands
    const wave2Commands = (f: number) => {
      if (f === 10) bus.emit({ type: 'command:upgrade-tower', towerId: towers[3].id, upgradeId: 'speed' });
      if (f === 30) bus.emit({ type: 'command:set-hold-fire', towerId: towers[2].id, holdFire: true });
      if (f === 60) bus.emit({ type: 'command:set-hold-fire', towerId: towers[2].id, holdFire: false });
    };
    const uninterrupted = playWave(live, waveConfig(5), wave2Commands);

    // The save loaded: a fresh simulation on its world package, on ground that gives nothing
    const read = readSaveFile(text, HEAD);
    if (!read.file) throw new Error(`refused: ${read.refusal}`);
    expect(read.note).toBeNull();
    const file = read.file;
    const loaded = build(0x0bad, {
      ground: () => null,
      world: { paths: packagePaths(file.world), spawns: file.world.spawns, heights: file.world.heights },
    });
    expect(loaded.gsm.worldKey()).toBe(keyAtSave);
    loaded.gsm.restoreSnapshot(file.sim, 'live');
    loaded.gsm.gameSpeed.set(3);
    expect(loaded.gsm.stateHash()).not.toBe(0);

    const lbus = loaded.gsm.getEventBus();
    const resumed = playWave(loaded, waveConfig(5), (f) => {
      if (f === 10) lbus.emit({ type: 'command:upgrade-tower', towerId: towers[3].id, upgradeId: 'speed' });
      if (f === 30) lbus.emit({ type: 'command:set-hold-fire', towerId: towers[2].id, holdFire: true });
      if (f === 60) lbus.emit({ type: 'command:set-hold-fire', towerId: towers[2].id, holdFire: false });
    });

    // A real wave: many frames, the state moving all along
    expect(uninterrupted.length).toBeGreaterThan(100);
    expect(new Set(uninterrupted).size).toBeGreaterThan(100);
    expect(resumed.length).toBe(uninterrupted.length);
    const firstDiff = resumed.findIndex((hash, i) => hash !== uninterrupted[i]);
    expect(firstDiff).toBe(-1);

    // The check sees a difference: the same save with one hit point less on the HQ comes out another way
    const off = build(0x0bad, {
      ground: () => null,
      world: { paths: packagePaths(file.world), spawns: file.world.spawns, heights: file.world.heights },
    });
    off.gsm.restoreSnapshot({ ...file.sim, baseHealth: file.sim.baseHealth - 1 }, 'live');
    off.gsm.gameSpeed.set(3);
    const obus = off.gsm.getEventBus();
    const other = playWave(off, waveConfig(5), (f) => {
      if (f === 10) obus.emit({ type: 'command:upgrade-tower', towerId: towers[3].id, upgradeId: 'speed' });
    });
    expect(other.at(-1)).not.toBe(uninterrupted.at(-1));
  });

  it('loads a save of another game version or balance with a note, and refuses another format', () => {
    const save = { format: '3dtd-save', version: 999 };
    expect(readSaveFile(JSON.stringify(save), HEAD)).toEqual({ file: null, refusal: 'version' });
    expect(readSaveFile('{"format":"3dtd-replay"}', HEAD)).toEqual({ file: null, refusal: 'not-a-save' });
    expect(readSaveFile('not json', HEAD)).toEqual({ file: null, refusal: 'not-a-save' });
  });
});
