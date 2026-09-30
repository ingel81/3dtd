/**
 * Acceptance of coop lockstep (docs/COOP_PLAN.md, C0): two simulations in
 * one process, one relay between them. Both players give commands; each
 * client runs its frames at its own pace and the second one hears the relay
 * late and unevenly. The state hash at every sub-step boundary both passed
 * must be the same, bit for bit, and both command logs as well.
 *
 * GameObject ids come from a static counter; one per process is right for
 * the game, two simulations here each keep their own (Client.run).
 */
import { ResyncDriver } from '../coop/resync';
import type { WaveSnapshot } from '../simulator/wave-snapshot';
import type { WaveGroupDisplay } from '../services/debug/wave-debug.service';
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
import type { Tower } from '../entities/tower.entity';
import type { AbilityId } from '../configs/abilities.config';
import type { UpgradeId } from '../configs/tower-types.config';
import type { WaveConfig, SpawnEntry } from '../managers/wave.manager';
import type { WaveConfig as DirectorWave } from '../director/models/wave-config';
import { mulberry32 } from '../utils/game-rng';
import { METERS_PER_DEGREE_LAT as M } from '../utils/geo-utils';
import { LocalRelay, type LocalLink } from '../coop/local-relay';
import { GameClock } from '../managers/game-state/game-clock';
import { TICK_SUB_STEPS, type LockstepLink } from '../coop/lockstep';
import { HASH_EVERY_TICKS } from '../coop/hash-check';
import { buildWorldPackage, packagePaths, readWorldPackage } from '../coop/world-package';
import { buildSimWorld, worldSourceOf, type SimWorld, type SimWorldOptions } from './sim-world';

const SEED = 0xc0de;
const PLAYERS = ['a', 'b'];

class Client {
  /** This simulation's GameObject id counter while the other one runs */
  private ids: number;
  /** State hash at every sub-step boundary this client passed */
  readonly hashes = new Map<number, number>();
  private now = 1000;

  constructor(readonly world: SimWorld, readonly link: LocalLink) {
    this.ids = GameObject.getIdCounter();
    world.gsm.setLockstep(link);
    world.gsm.resimHost.setBoundaryListener((step, hash) => this.hashes.set(step, hash()));
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

  emit(event: { type: string } & Record<string, unknown>): void {
    this.run(() => this.gsm.getEventBus().emit(event as never));
  }

  frame(ms: number): void {
    this.run(() => this.gsm.update((this.now += ms)));
  }
}

function waveConfig(): WaveConfig {
  const types = ['zombie', 'rat', 'bat', 'zombie-soldier', 'skeleton', 'hornet'] as const;
  const entries: SpawnEntry[] = Array.from({ length: 60 }, (_, i) => ({
    enemyType: types[i % types.length],
    speed: 1,
    health: 2,
  }));
  return { schedule: { entries, baseDelay: 350, delayVariation: 0.3, spawnMode: 'random' } };
}

/**
 * The same kind of wave as the wave source hands out: the spawn schedule is
 * built where the command acts, drawing from the spawn stream on every client.
 */
function directorWave(): DirectorWave {
  return {
    enemies: [
      { type: 'zombie', count: 20, healthMultiplier: 2 },
      { type: 'bat', count: 12, healthMultiplier: 2 },
      { type: 'skeleton', count: 10, healthMultiplier: 2 },
    ],
    totalCount: 42,
    spawnDelay: 300,
    spawnDelayVariation: 0.4,
    spawnMode: 'random',
    pattern: 'random',
  };
}

function buildClient(relay: LocalRelay, playerId: string, options: SimWorldOptions = {}): Client {
  GameObject.resetIdCounter();
  const world = buildSimWorld(services, SEED, options);
  world.gsm.gameSpeed.set(3);
  // Two players; the eight towers of the world belong to them in turn
  world.gsm.setPlayers(PLAYERS, playerId);
  world.towers.forEach((tower, i) => { tower.ownerId = PLAYERS[i % 2]; });
  // Each player's research starts empty; the world's towers shoot at air as before
  for (const id of PLAYERS) world.gsm.researchOf(id).completeResearch('aa-retrofit');
  return new Client(world, relay.connect(playerId));
}

describe('Coop lockstep (COOP_PLAN C0)', () => {
  const mathRandom = Math.random;
  afterEach(() => {
    Math.random = mathRandom;
  });

  it('keeps two simulations bit for bit alike when both players give commands', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay();
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    const lag = mulberry32(7);
    const towersA = a.world.towers;
    let kills = 0;
    a.gsm.getEventBus().on('enemy:died', () => kills++);

    let waveSeen = false;
    let directorStarted = false;
    let directorFrame = 0;
    for (let f = 0; f < 12000; f++) {
      if (f === 2) a.emit({ type: 'command:start-wave', config: waveConfig() });
      if (f === 10) b.emit({ type: 'debug:add-credits', amount: 5000 });
      if (f === 15) a.emit({ type: 'command:upgrade-tower', towerId: towersA[0].id, upgradeId: 'damage' });
      if (f === 20) b.emit({ type: 'command:set-targeting', towerId: towersA[1].id, strategy: 'highest-hp' });
      if (f === 30) b.emit({ type: 'command:set-hold-fire', towerId: towersA[2].id, holdFire: true });
      if (f === 45) a.emit({ type: 'command:place-tower', typeId: 'archer', position: { lat: 300 / M, lon: 12 / M, height: 0 } });
      if (f === 60) b.emit({ type: 'command:sell-tower', towerId: towersA[3].id });
      if (f === 80) a.emit({ type: 'command:set-hold-fire', towerId: towersA[2].id, holdFire: false });
      if (f === 90) b.emit({ type: 'command:upgrade-tower', towerId: towersA[4].id, upgradeId: 'speed' });

      // The relay runs up to three ticks ahead of the faster client, as the
      // real one keeps the room's pace; A hears it at once, B late and in bursts
      const lead = Math.max(a.gsm.subStep, b.gsm.subStep) + 3 * TICK_SUB_STEPS;
      while ((relay.lastClosed + 1) * TICK_SUB_STEPS <= lead) relay.closeTick();
      a.link.deliver();
      if (lag() < 0.4) b.link.deliver(1 + Math.floor(lag() * 4));

      a.frame(10 + ((f * 7) % 31));
      b.frame(20 + ((f * 11) % 29));

      const waving = a.gsm.waveManager.phase() === 'wave';
      if (waving && !waveSeen) waveSeen = true;
      if (waveSeen && !waving && !directorStarted && b.gsm.waveManager.phase() !== 'wave') {
        // The second wave comes from the wave source, given by B
        b.emit({ type: 'command:start-wave', director: directorWave() });
        directorStarted = true;
        directorFrame = f;
      }
      if (directorStarted && f > directorFrame + 50 && !waving && b.gsm.waveManager.phase() !== 'wave') break;
    }
    expect(waveSeen).toBe(true);
    expect(a.gsm.waveManager.waveNumber()).toBe(2);
    expect(kills).toBeGreaterThan(20);

    // No more ticks: both run up to the barrier and stand at the same step
    b.link.deliver();
    const end = (relay.lastClosed + 1) * TICK_SUB_STEPS;
    for (let i = 0; i < 20000 && (a.gsm.subStep < end || b.gsm.subStep < end); i++) {
      a.frame(40);
      b.frame(40);
    }
    a.frame(40);
    b.frame(40);
    expect(a.gsm.subStep).toBe(end);
    expect(b.gsm.subStep).toBe(end);
    expect(a.gsm.waveManager.phase()).not.toBe('wave');

    // Every boundary both passed: same hash
    let compared = 0;
    for (const [step, hash] of a.hashes) {
      const other = b.hashes.get(step);
      if (other === undefined) continue;
      if (other !== hash) throw new Error(`diverged at sub-step boundary ${step}`);
      compared++;
    }
    expect(compared).toBeGreaterThan(1000);
    expect(a.run(() => a.gsm.stateHash())).toBe(b.run(() => b.gsm.stateHash()));
    // The relay compared the hashes both sent every HASH_EVERY_TICKS ticks and found nothing
    expect(relay.divergences).toEqual([]);

    // The same log on both sides, each command with who gave it
    expect(b.gsm.commandLog.entries).toEqual(a.gsm.commandLog.entries);
    const players = new Set(a.gsm.commandLog.entries.map((e) => e.playerId));
    expect(players).toEqual(new Set(['a', 'b']));
    expect(a.gsm.towerManager.getAll().length).toBe(8); // one placed, one sold
  });

  it('shows a change one side made past the relay as a different hash', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    for (let f = 0; f < 20; f++) {
      relay.closeTick();
      if (f === 10) b.run(() => b.gsm.addCredits(1, 'reset'));
      a.frame(40);
      b.frame(40);
    }
    const diverged = [...a.hashes].filter(([step, hash]) => b.hashes.has(step) && b.hashes.get(step) !== hash);
    expect(diverged.length).toBeGreaterThan(0);
  });

  it('reports a state falsified on one side at the relay within HASH_EVERY_TICKS ticks (C5)', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    const falsifyAt = 2 * HASH_EVERY_TICKS + 3;
    for (let t = 0; t < 4 * HASH_EVERY_TICKS; t++) {
      relay.closeTick();
      if (t === falsifyAt) b.run(() => b.gsm.addCredits(1, 'reset'));
      a.frame(TICK_SUB_STEPS * 17);
      b.frame(TICK_SUB_STEPS * 17);
    }
    expect(relay.divergences.length).toBeGreaterThan(0);
    const first = relay.divergences[0];
    expect(first.tick).toBeGreaterThan(falsifyAt);
    expect(first.tick).toBeLessThanOrEqual(falsifyAt + HASH_EVERY_TICKS);
    expect(first.hashes.map(([player]) => player).sort()).toEqual(['a', 'b']);
    expect(first.hashes[0][1]).not.toBe(first.hashes[1][1]);
    // The part that ran apart is named (TODO E32)
    expect(first.parts).toEqual(['credits']);
  });

  it('catches up with the relay after falling behind, then keeps its pace (R2)', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    a.gsm.gameSpeed.set(1);
    // 60 ticks closed at once, as after a hidden tab: four game seconds behind
    for (let t = 0; t < 60; t++) relay.closeTick();
    let frames = 0;
    while (a.gsm.subStep < 59 * TICK_SUB_STEPS && frames < 1000) {
      a.frame(16);
      frames++;
    }
    // At the room's pace that is 240 frames; catching up takes well under that
    expect(frames).toBeLessThan(120);
    // Caught up: one tick a frame at the room's pace does not run it ahead again
    const at = a.gsm.subStep;
    relay.closeTick();
    for (let i = 0; i < 4; i++) a.frame(16);
    expect(a.gsm.subStep - at).toBeLessThanOrEqual(TICK_SUB_STEPS + 1);
  });

  it('keeps a tick in hand at the room pace and so never waits at the barrier (PLAYTEST T28)', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    a.gsm.gameSpeed.set(1);
    let blocked = 0;
    let frames = 0;
    let behindSum = 0;
    const link: LockstepLink = a.link;
    link.noteFrame = (_steps, wasBlocked, behind) => {
      frames++;
      if (wasBlocked) blocked++;
      behindSum += behind;
    };
    // The relay closes a tick every TICK_SUB_STEPS steps of wall clock,
    // after this client's frame, as the host measured it: at 144 fps
    const tickMs = TICK_SUB_STEPS * GameClock.FIXED_STEP_MS;
    const frameMs = 1000 / 144;
    let relayMs = 0;
    for (let f = 0; f < 3000; f++) {
      if (f === 1500) {
        frames = 0;
        blocked = 0;
        behindSum = 0;
      }
      a.frame(frameMs);
      relayMs += frameMs;
      while (relayMs >= tickMs) {
        relay.closeTick();
        relayMs -= tickMs;
      }
    }
    // Settled: next to never at the barrier. The pace holds one tick in hand before a sub-step; counted
    // after it (noteFrame), with a tick of one sub-step, that one is mostly just used up
    expect(blocked / frames).toBeLessThan(0.02);
    expect(behindSum / frames).toBeLessThan(2);
  });

  it("brings a falsified guest back in step with the host's state at the held boundary, mid-wave (C5b)", async () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    const both = (ms: number) => { a.frame(ms); b.frame(ms); };
    a.emit({ type: 'command:start-wave', config: waveConfig() });
    for (let t = 0; t < 3 * HASH_EVERY_TICKS; t++) {
      relay.closeTick();
      if (t === HASH_EVERY_TICKS + 3) b.run(() => b.gsm.addCredits(7, 'reset'));
      both(TICK_SUB_STEPS * 17);
    }
    expect(relay.divergences.length).toBeGreaterThan(0);
    expect(a.gsm.waveManager.phase()).toBe('wave');

    // The relay holds: no further tick, both run up to the boundary and stop there
    const hold = relay.lastClosed + 1;
    for (let i = 0; i < 20; i++) both(40);
    expect(a.gsm.subStep).toBe(hold * TICK_SUB_STEPS);
    expect(b.gsm.subStep).toBe(hold * TICK_SUB_STEPS);
    expect(a.gsm.stateHash()).not.toBe(b.gsm.stateHash());

    const game = (c: Client) => ({
      subStep: () => c.gsm.subStep,
      refusal: () => c.gsm.waveSnapshotRefusal(),
      capture: () => c.run(() => c.gsm.captureWaveSnapshot()),
      restore: (snapshot: WaveSnapshot) => c.run(() => c.gsm.restoreWaveSnapshot(snapshot, 'live')),
    });
    const loaded: boolean[] = [];
    const guest = new ResyncDriver(() => false, game(b), { state: () => undefined, loaded: (_t, ok) => loaded.push(ok) });
    const host = new ResyncDriver(() => true, game(a), { state: (tick, gz) => guest.state(tick, gz!), loaded: () => undefined });
    host.hold(hold);
    guest.hold(hold);
    await host.poll();
    await guest.poll();
    expect(loaded).toEqual([true]);
    expect(b.gsm.stateHash()).toBe(a.gsm.stateHash());

    // The room goes on: in step from here, no further divergence
    const found = relay.divergences.length;
    for (let t = 0; t < 3 * HASH_EVERY_TICKS; t++) {
      relay.closeTick();
      both(TICK_SUB_STEPS * 17);
    }
    expect(relay.divergences.length).toBe(found);
    expect(b.gsm.subStep).toBe(a.gsm.subStep);
    expect(b.gsm.stateHash()).toBe(a.gsm.stateHash());
  });

  it('holds the simulation at the barrier until the relay closes the tick', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay();
    const a = buildClient(relay, 'a');

    for (let i = 0; i < 10; i++) a.frame(40);
    expect(a.gsm.subStep).toBe(0);

    relay.closeTick();
    for (let i = 0; i < 10; i++) a.frame(40);
    expect(a.gsm.subStep).toBe(0); // closed at the relay, not yet heard here

    a.link.deliver();
    for (let i = 0; i < 10; i++) a.frame(40);
    expect(a.gsm.subStep).toBe(TICK_SUB_STEPS);
  });

  it('drops the commands of the dev tools once cheats are off, on every client alike (R3)', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    a.gsm.setCheatRule(() => false);
    b.gsm.setCheatRule(() => false);
    const credits = a.gsm.creditsOf('a');
    a.emit({ type: 'debug:add-credits', amount: 1000 });
    // A changed client that sends it anyway: the others ignore it too
    a.link.send({ type: 'debug:add-credits', amount: 1000 });
    for (let t = 0; t < 3; t++) {
      relay.closeTick();
      a.frame(TICK_SUB_STEPS * 17);
      b.frame(TICK_SUB_STEPS * 17);
    }
    expect(a.gsm.creditsOf('a')).toBe(credits);
    expect(b.gsm.creditsOf('a')).toBe(credits);
  });

  it("lets the host's cheat act on every client and drops the guest's, with cheats host only (D38)", () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    const hostOnly = (id: string) => id === 'a';
    a.gsm.setCheatRule(hostOnly);
    b.gsm.setCheatRule(hostOnly);
    const credits = { a: a.gsm.creditsOf('a'), b: a.gsm.creditsOf('b') };
    a.emit({ type: 'debug:add-credits', amount: 1000 });
    // The guest's own client does not send it; a changed one would, and nobody takes it
    b.emit({ type: 'debug:add-credits', amount: 1000 });
    b.link.send({ type: 'debug:add-credits', amount: 1000 });
    for (let t = 0; t < 3; t++) {
      relay.closeTick();
      a.frame(TICK_SUB_STEPS * 17);
      b.frame(TICK_SUB_STEPS * 17);
    }
    for (const client of [a, b]) {
      expect(client.gsm.creditsOf('a')).toBe(credits.a + 1000);
      expect(client.gsm.creditsOf('b')).toBe(credits.b);
    }
  });

  it('keeps both alike through a debug-panel wave and a kill-all in it (playtest T11)', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    let killed = false;
    // The debug panel's wave goes as the source's wave: its schedule draws
    // from the spawn stream where it acts, on both sides
    a.emit({ type: 'command:start-wave', director: directorWave() });
    for (let t = 0; t < 400; t++) {
      relay.closeTick();
      if (!killed && b.gsm.enemyManager.getAlive().length > 3) {
        b.emit({ type: 'debug:kill-all' });
        killed = true;
      }
      a.frame(TICK_SUB_STEPS * 17);
      b.frame(TICK_SUB_STEPS * 17);
    }
    expect(killed).toBe(true);
    expect(a.gsm.enemyManager.getAlive().length).toBe(0);
    expect(a.gsm.waveManager.phase()).not.toBe('wave');
    expect(relay.divergences).toEqual([]);
    expect(a.run(() => a.gsm.stateHash())).toBe(b.run(() => b.gsm.stateHash()));
  });

  it('runs a command at its tick, not where it was given', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const credits = a.gsm.credits();

    a.emit({ type: 'debug:add-credits', amount: 100 });
    expect(a.gsm.credits()).toBe(credits);
    expect(a.gsm.commandLog.length).toBe(0);

    relay.closeTick();
    a.frame(40);
    expect(a.gsm.credits()).toBe(credits + 100);
    expect(a.gsm.commandLog.entries[0]).toMatchObject({ step: 0, playerId: 'a' });
  });
});

/** Hills along the routes, and a strip without tiles where cells take their neighbours' height */
function hills(x: number, z: number): number | null {
  if (z < -300 && z > -320) return null;
  return 4 * Math.sin(x / 37) + 2.5 * Math.cos(z / 23) + z * 0.01;
}

const HEAD = { gameVersion: 'v9.9.9', configHash: 'cfg' };

describe('Coop world package (COOP_PLAN C1)', () => {
  const mathRandom = Math.random;
  afterEach(() => {
    Math.random = mathRandom;
  });

  /** The host's world, packed and sent as text, and a joiner built from it on tiles that give nothing */
  function hostAndJoiner(relay: LocalRelay) {
    Math.random = mulberry32(SEED + 1);
    const host = buildClient(relay, 'a', { ground: hills });
    const source = worldSourceOf(host.world);
    const text = JSON.stringify(buildWorldPackage(source, HEAD));
    const read = readWorldPackage(text, HEAD);
    if (!read.world) throw new Error(`refused: ${read.refusal}`);
    const world = read.world;
    const joiner = buildClient(relay, 'b', {
      ground: () => null,
      world: { paths: packagePaths(world), spawns: world.spawns, heights: world.heights },
    });
    return { host, joiner, world, source };
  }

  it('gives the joiner the host world: same cells, same heights, same world key', () => {
    const { host, joiner, world, source } = hostAndJoiner(new LocalRelay(true));
    const grid = joiner.world.grid;
    expect(source.heights.some(([, , state]) => state === 2)).toBe(true); // filled cells travel too
    expect(joiner.gsm.worldKey()).toBe(world.worldKey);
    expect(joiner.gsm.worldKey()).toBe(host.gsm.worldKey());
    expect(grid.cellsWithoutHeight()).toBe(host.world.grid.cellsWithoutHeight());
    expect(grid.exportHeights()).toEqual(source.heights);

    // Without the heights the same routes give another world
    const bare = buildClient(new LocalRelay(true), 'c', {
      ground: () => null,
      world: { paths: packagePaths(world), spawns: world.spawns, heights: [] },
    });
    expect(bare.gsm.worldKey()).not.toBe(world.worldKey);
  });

  it('keeps host and joiner in step through a wave on the shared world', () => {
    const relay = new LocalRelay(true);
    const { host, joiner } = hostAndJoiner(relay);

    host.emit({ type: 'command:start-wave', director: directorWave() });
    joiner.emit({ type: 'command:upgrade-tower', towerId: host.world.towers[0].id, upgradeId: 'damage' });
    let waved = false;
    for (let f = 0; f < 20000; f++) {
      relay.closeTick();
      host.frame(40);
      joiner.frame(40);
      const phase = host.gsm.waveManager.phase();
      if (phase === 'wave') waved = true;
      else if (waved) break;
    }
    expect(waved).toBe(true);
    let compared = 0;
    for (const [step, hash] of host.hashes) {
      const other = joiner.hashes.get(step);
      if (other === undefined) continue;
      if (other !== hash) throw new Error(`diverged at sub-step boundary ${step}`);
      compared++;
    }
    expect(compared).toBeGreaterThan(500);
  });

  it('keeps host and joiner in step when the joiner has another clock, Math.random, sin and cos and no tiles (E63 a, E28)', () => {
    const relay = new LocalRelay();
    const { host, joiner } = hostAndJoiner(relay);
    // While the joiner runs: its own presentation random stream, a wall clock that is
    // offset and jumps, and native transcendentals off in their last bits, as another
    // machine's or another engine's would be
    const skewed = ['sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'exp', 'log', 'pow', 'hypot'] as const;
    const math = Math as unknown as Record<string, (...args: number[]) => number>;
    const native = Object.fromEntries(skewed.map((fn) => [fn, math[fn]]));
    const joinerMath = Object.fromEntries(skewed.map((fn) => [fn, (...args: number[]) => {
      const r = native[fn](...args);
      return r === 0 || !Number.isFinite(r) ? r : r * (1 + 2 ** -40);
    }]));
    const joinerRandom = mulberry32(0xbad5eed);
    const jump = mulberry32(99);
    let clock = 5_000_000;
    const perfNow = performance.now, dateNow = Date.now;
    const joinerRun = joiner.run.bind(joiner);
    joiner.run = <T>(fn: () => T): T => {
      const random = Math.random;
      Math.random = joinerRandom;
      for (const fn of skewed) math[fn] = joinerMath[fn];
      performance.now = () => (clock += 1 + jump() * 250);
      Date.now = () => Math.floor(1.7e12 + (clock += 1 + jump() * 250));
      try {
        return joinerRun(fn);
      } finally {
        Math.random = random;
        for (const fn of skewed) math[fn] = native[fn];
        performance.now = perfNow;
        Date.now = dateNow;
      }
    };

    host.emit({ type: 'debug:add-credits', amount: 20000 });
    joiner.emit({ type: 'debug:add-credits', amount: 20000 });
    host.emit({ type: 'debug:ready-hero' });
    host.emit({ type: 'debug:ready-ability', abilityId: 'frost-bomb' });
    host.emit({ type: 'command:start-wave', director: directorWave() });
    let waved = false;
    for (let f = 0; f < 20000; f++) {
      if (f === 40) joiner.emit({ type: 'command:place-tower', typeId: 'archer', position: { lat: 250 / M, lon: 10 / M, height: 0 } });
      if (f === 60) host.emit({ type: 'command:hero-move', target: { lat: 200 / M, lon: 0 } });
      if (f === 90) joiner.emit({ type: 'command:use-ability', abilityId: 'frost-bomb', target: { lat: 150 / M, lon: 0 } });
      if (f === 120) joiner.emit({ type: 'command:upgrade-tower', towerId: host.world.towers[1].id, upgradeId: 'speed' });
      const lead = Math.max(host.gsm.subStep, joiner.gsm.subStep) + 3 * TICK_SUB_STEPS;
      while ((relay.lastClosed + 1) * TICK_SUB_STEPS <= lead) relay.closeTick();
      host.link.deliver();
      if (jump() < 0.4) joiner.link.deliver(1 + Math.floor(jump() * 4));
      host.frame(10 + ((f * 7) % 31));
      joiner.frame(20 + ((f * 11) % 29));
      const phase = host.gsm.waveManager.phase();
      if (phase === 'wave') waved = true;
      else if (waved && joiner.gsm.waveManager.phase() !== 'wave') break;
    }
    expect(waved).toBe(true);
    // Both run up to the last closed tick
    joiner.link.deliver();
    const end = (relay.lastClosed + 1) * TICK_SUB_STEPS;
    for (let i = 0; i < 20000 && (host.gsm.subStep < end || joiner.gsm.subStep < end); i++) { host.frame(40); joiner.frame(40); }
    // The placed tower stands on both sides
    expect(joiner.gsm.towerManager.getAll().length).toBe(host.gsm.towerManager.getAll().length);
    expect(host.gsm.towerManager.getAll().length).toBe(9);
    let compared = 0;
    for (const [step, hash] of host.hashes) {
      const other = joiner.hashes.get(step);
      if (other === undefined) continue;
      if (other !== hash) throw new Error(`diverged at sub-step boundary ${step}`);
      compared++;
    }
    expect(compared).toBeGreaterThan(500);
    expect(relay.divergences).toEqual([]);
  });

  it('spawns on the shared cells, not on the tiles, where the route carries no height (E63 b)', () => {
    const relay = new LocalRelay(true);
    const { host, joiner } = hostAndJoiner(relay);
    // The routes start at height 0, so the spawn falls back to a ground lookup; the joiner's
    // ground under the spawn points (SimWorld.spawnGround) says another height, as a world
    // measured on another machine's tiles would: the cells win
    joiner.gsm.enemyManager.setSpawnGround(() => 3.7);
    host.emit({ type: 'command:start-wave', director: directorWave() });
    let waved = false;
    for (let f = 0; f < 20000; f++) {
      relay.closeTick();
      host.frame(40);
      joiner.frame(40);
      const phase = host.gsm.waveManager.phase();
      if (phase === 'wave') waved = true;
      else if (waved) break;
    }
    expect(waved).toBe(true);
    let compared = 0;
    for (const [step, hash] of host.hashes) {
      const other = joiner.hashes.get(step);
      if (other === undefined) continue;
      if (other !== hash) throw new Error(`diverged at sub-step boundary ${step}`);
      compared++;
    }
    expect(compared).toBeGreaterThan(500);
  });

  /**
   * E63 i: state changed on the joiner alone mid-wave (or on both, then apart). Returns after how
   * many sub-steps the hashes part (0: in the first hash after the change, taken at every
   * boundary here), null if they never do within the wave and a few seconds after.
   * `setup` runs on both clients through the relay before the wave starts.
   */
  function detectionLatency(
    mutate: (joiner: Client, host: Client) => void,
    setup: (host: Client) => void = () => undefined,
  ): number | null {
    const relay = new LocalRelay(true);
    const { host, joiner } = hostAndJoiner(relay);
    setup(host);
    host.emit({ type: 'command:start-wave', director: directorWave() });
    let mutatedAt = -1;
    let waved = false;
    let after = 0;
    for (let f = 0; f < 20000 && after < 60; f++) {
      relay.closeTick();
      host.frame(40);
      joiner.frame(40);
      if (mutatedAt < 0 && joiner.gsm.enemyManager.aliveCount() >= 15) {
        expect(joiner.gsm.subStep).toBe(host.gsm.subStep);
        joiner.run(() => mutate(joiner, host));
        mutatedAt = joiner.gsm.subStep;
      }
      const phase = host.gsm.waveManager.phase();
      if (phase === 'wave') waved = true;
      else if (waved) after++;
    }
    expect(mutatedAt).toBeGreaterThan(0);
    const steps = [...host.hashes.keys()].filter((s) => s >= mutatedAt && joiner.hashes.has(s)).sort((x, y) => x - y);
    const first = steps.find((s) => host.hashes.get(s) !== joiner.hashes.get(s));
    return first === undefined ? null : first - mutatedAt;
  }

  /** A strike of `abilityId` by player a at the first enemy, on `client` alone */
  function strike(client: Client, abilityId: AbilityId) {
    const target = client.gsm.enemyManager.getAlive()[0].position;
    return client.run(() => client.gsm.abilityOf('a').use(abilityId, { lat: target.lat, lon: target.lon }));
  }

  function upgradeTrack(tower: Tower, stat: string): UpgradeId {
    return tower.typeConfig.upgrades.find((u) => u.effect.stat === stat)!.id;
  }

  it('shows every piece of game state that acts on the game as a divergence (E63 i)', { timeout: 60_000 }, () => {
    const pendingOf = (c: Client) => (c.gsm.abilityOf('a') as unknown as { pending: { remainingMs: number }[] }).pending;
    const heroOf = (c: Client) => c.gsm.heroOf('a') as unknown as { kills: number; ammo: string; applyStats(): void };
    const readyHero = (h: Client) => h.emit({ type: 'debug:ready-hero' });
    const latency: Record<string, number | null> = {
      control: detectionLatency(() => undefined),
      'enemy: slow': detectionLatency((j) => {
        const enemy = j.gsm.enemyManager.getAlive()[0];
        enemy.movement.applyStatusEffect({ type: 'slow', value: 0.5, duration: 2000, startTime: j.gsm.gameTimeMs, sourceId: 'mutation' });
      }),
      'enemy: slow lasts longer': detectionLatency((j, h) => {
        for (const c of [h, j]) {
          const enemy = c.gsm.enemyManager.getAlive()[0];
          enemy.movement.applyStatusEffect({
            type: 'slow', value: 0.5, duration: c === j ? 9000 : 3000, startTime: c.gsm.gameTimeMs, sourceId: 'mutation',
          });
        }
      }),
      'tower: hold fire': detectionLatency((j) => j.gsm.setTowerHoldFire(j.world.towers[0], true)),
      'tower: targeting': detectionLatency((j) => { j.world.towers[1].targetingStrategy = 'last'; }),
      'tower: air targeting': detectionLatency((j) => { j.world.towers[0].airSubStrategy = 'highest-hp'; }),
      'tower: damage level': detectionLatency((j) => { j.world.towers[2].applyUpgrade(upgradeTrack(j.world.towers[2], 'damage')); }),
      'tower: range level': detectionLatency((j) => { j.world.towers[3].applyUpgrade(upgradeTrack(j.world.towers[3], 'range')); }),
      'research: node done': detectionLatency((j) => j.gsm.researchOf('b').completeResearch('advanced-weaponry')),
      'research: air lost': detectionLatency((j) => {
        const research = j.gsm.researchOf('a');
        const state = research.getState();
        research.restoreState({ ...state, completed: state.completed.filter((id) => id !== 'aa-retrofit') });
      }),
      'ability: charges': detectionLatency((j) => {
        (j.gsm.abilityOf('a') as unknown as { states: Map<AbilityId, { charges: number }> }).states.get('frost-bomb')!.charges--;
      }, (h) => h.emit({ type: 'debug:ready-ability', abilityId: 'frost-bomb' })),
      'ability: strike lands later': detectionLatency((j, h) => {
        for (const c of [h, j]) expect(strike(c, 'frost-bomb').ok).toBe(true);
        pendingOf(j)[0].remainingMs += 2000;
      }, (h) => h.emit({ type: 'debug:ready-ability', abilityId: 'frost-bomb' })),
      'hero: level': detectionLatency((j) => {
        const hero = heroOf(j);
        hero.kills += 200;
        hero.applyStats();
      }, readyHero),
      'hero: ammo': detectionLatency((j) => {
        const hero = heroOf(j);
        hero.ammo = 'explosive';
        hero.applyStats();
      }, readyHero),
      'economy: perfect streak': detectionLatency((j) => {
        (j.gsm as unknown as { economy: { _perfectStreak: number } }).economy._perfectStreak += 3;
      }),
    };
    console.log(`E63 i detection latency in sub-steps (null: never): ${JSON.stringify(latency, null, 1)}`);
    // Each in the first hash after it (before E63 i: slow 1, hold fire 23, targeting 106, upgrades
    // over 1200, a strike landing later 30 sub-steps; research, charges, hero and streak never)
    expect(latency['control']).toBeNull();
    for (const [what, steps] of Object.entries(latency)) {
      if (what !== 'control') expect(steps, what).toBe(0);
    }
  });

  it('refuses a package of another game version, other balance or no world at all', () => {
    const { source } = hostAndJoiner(new LocalRelay(true));
    const text = JSON.stringify(buildWorldPackage(source, HEAD));
    expect(readWorldPackage(text, { ...HEAD, gameVersion: 'v1.0.0' }).refusal).toBe('other-game');
    expect(readWorldPackage(text, { ...HEAD, configHash: 'other' }).refusal).toBe('other-balance');
    expect(readWorldPackage('{"format":"3dtd-replay"}', HEAD).refusal).toBe('not-a-world');
    expect(readWorldPackage('not json', HEAD).refusal).toBe('not-a-world');
  });
});

describe('Coop players in the simulation (COOP_PLAN C2a)', () => {
  const mathRandom = Math.random;
  afterEach(() => {
    Math.random = mathRandom;
  });

  it('books each player their own gold, owns what they build and refuses a partner tower', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    const start = a.gsm.creditsOf('a');
    const step = (frames = 3) => {
      for (let i = 0; i < frames; i++) {
        relay.closeTick();
        a.frame(40);
        b.frame(40);
      }
    };

    a.emit({ type: 'command:place-tower', typeId: 'archer', position: { lat: 300 / M, lon: 12 / M, height: 0 } });
    step();
    const built = a.gsm.towerManager.getAll().find((t) => !a.world.towers.includes(t))!;
    expect(built.ownerId).toBe('a');
    const cost = start - a.gsm.creditsOf('a');
    expect(cost).toBeGreaterThan(0);
    expect(a.gsm.creditsOf('b')).toBe(start);
    // The same accounts on both clients, each showing its own
    expect(b.gsm.creditsOf('a')).toBe(start - cost);
    expect(a.gsm.credits()).toBe(start - cost);
    expect(b.gsm.credits()).toBe(start);

    // B may not sell or hold A's tower; A may
    b.emit({ type: 'command:sell-tower', towerId: built.id });
    b.emit({ type: 'command:set-hold-fire', towerId: built.id, holdFire: true });
    step();
    expect(a.gsm.towerManager.getById(built.id)).toBeTruthy();
    expect(built.holdFire).toBe(false);
    expect(a.gsm.creditsOf('b')).toBe(start);

    // Selecting: a partner's tower too, to look at it; acting on it only its owner (TODO E39)
    expect(a.gsm.towerPolicy.may('a', built, 'select')).toBe(true);
    expect(b.gsm.towerPolicy.may('b', built, 'select')).toBe(true);
    expect(a.gsm.mayManage(built)).toBe(true);
    expect(b.gsm.mayManage(built)).toBe(false);

    a.emit({ type: 'command:sell-tower', towerId: built.id });
    step();
    expect(a.gsm.towerManager.getById(built.id)).toBeFalsy();
    expect(a.gsm.creditsOf('a')).toBeGreaterThan(start - cost);
    expect(a.run(() => a.gsm.stateHash())).toBe(b.run(() => b.gsm.stateHash()));
  });

  it('gives the gold of a kill to the owner of the tower that made it', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    const earned = new Map<string, number>();
    const byOwner = new Map<string, number>();
    const bus = a.gsm.getEventBus();
    bus.on('credits:changed', (e) => {
      if (e.source === 'kill') earned.set(e.playerId, (earned.get(e.playerId) ?? 0) + e.delta);
    });
    bus.on('enemy:died', (e) => {
      if (e.killedBy?.kind !== 'tower' || e.credits <= 0) return;
      const owner = a.gsm.towerManager.getById(e.killedBy.towerId)!.ownerId;
      byOwner.set(owner, (byOwner.get(owner) ?? 0) + e.credits);
    });

    a.emit({ type: 'command:start-wave', director: directorWave() });
    let waved = false;
    for (let f = 0; f < 20000; f++) {
      relay.closeTick();
      a.frame(40);
      b.frame(40);
      if (a.gsm.waveManager.phase() === 'wave') waved = true;
      else if (waved) break;
    }
    expect(earned.get('a')).toBeGreaterThan(0);
    expect(earned.get('b')).toBeGreaterThan(0);
    expect(earned).toEqual(byOwner);
    expect(a.run(() => a.gsm.stateHash())).toBe(b.run(() => b.gsm.stateHash()));
  });
});

describe('Coop research per player (COOP_PLAN C2b)', () => {
  const mathRandom = Math.random;
  afterEach(() => {
    Math.random = mathRandom;
  });

  it('stays in step after a resync between waves, research centers and slot upgrades included (C5b)', async () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    const step = (frames = 3) => {
      for (let i = 0; i < frames; i++) {
        relay.closeTick();
        a.frame(40);
        b.frame(40);
      }
    };
    const at = (south: number, east: number) => ({ lat: south / M, lon: east / M, height: 0 });
    a.emit({ type: 'debug:add-credits', amount: 20000 });
    b.emit({ type: 'debug:add-credits', amount: 20000 });
    a.emit({ type: 'command:place-tower', typeId: 'research-center', position: at(100, 80) });
    b.emit({ type: 'command:place-tower', typeId: 'research-center', position: at(100, 130) });
    step();
    const centerOf = (id: string) => a.gsm.towerManager.getAll().find((t) => t.typeConfig.id === 'research-center' && t.ownerId === id)!;
    b.emit({ type: 'command:upgrade-tower', towerId: centerOf('b').id, upgradeId: 'research-slots' });
    b.emit({ type: 'command:start-research', researchId: 'ice-magic' });
    step(20);
    expect(a.run(() => a.gsm.stateHash())).toBe(b.run(() => b.gsm.stateHash()));

    // B's state goes astray: gold, and a slot upgrade only B made (it could afford it, A could not)
    b.run(() => b.gsm.addCredits(7, 'reset'));
    b.run(() => (b.gsm as never as { towerLifecycle: { upgrade(t: unknown, u: string): boolean } }).towerLifecycle.upgrade(b.gsm.towerManager.getById(centerOf('b').id), 'research-slots'));
    for (let i = 0; i < 20; i++) { a.frame(40); b.frame(40); }
    const hold = relay.lastClosed + 1;
    const game = (c: Client) => ({
      subStep: () => c.gsm.subStep,
      refusal: () => c.gsm.waveSnapshotRefusal(),
      capture: () => c.run(() => c.gsm.captureWaveSnapshot()),
      restore: (snapshot: WaveSnapshot) => c.run(() => c.gsm.restoreWaveSnapshot(JSON.parse(JSON.stringify(snapshot)), 'live')),
    });
    const guest = new ResyncDriver(() => false, game(b), { state: () => undefined, loaded: () => undefined });
    const host = new ResyncDriver(() => true, game(a), { state: (tick, gz) => guest.state(tick, gz!), loaded: () => undefined });
    host.hold(hold);
    guest.hold(hold);
    await host.poll();
    await guest.poll();
    expect(b.run(() => b.gsm.stateHash())).toBe(a.run(() => a.gsm.stateHash()));
    // Between waves the guest stays in the build phase: no empty wave ends and pays again
    expect(b.gsm.waveManager.phase()).toBe(a.gsm.waveManager.phase());

    // Both go on with the same commands: more slots on B's center, research on both sides
    b.emit({ type: 'command:upgrade-tower', towerId: centerOf('b').id, upgradeId: 'research-slots' });
    a.emit({ type: 'command:upgrade-tower', towerId: centerOf('a').id, upgradeId: 'research-slots' });
    step(30);
    b.emit({ type: 'command:upgrade-tower', towerId: centerOf('b').id, upgradeId: 'research-slots' });
    step(30);
    expect(b.gsm.researchOf('b').centerLevel).toBe(a.gsm.researchOf('b').centerLevel);
    expect(b.run(() => b.gsm.stateHash())).toBe(a.run(() => a.gsm.stateHash()));
  });

  it('keeps each player research, center and unlocks to themselves', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    const step = (frames = 3) => {
      for (let i = 0; i < frames; i++) {
        relay.closeTick();
        a.frame(40);
        b.frame(40);
      }
    };
    const at = (south: number, east: number) => ({ lat: south / M, lon: east / M, height: 0 });
    const ofType = (typeId: string) => a.gsm.towerManager.getAll().filter((t) => t.typeConfig.id === typeId);

    a.emit({ type: 'debug:add-credits', amount: 5000 });
    b.emit({ type: 'debug:add-credits', amount: 5000 });
    // A center each: one per player, not one per map
    a.emit({ type: 'command:place-tower', typeId: 'research-center', position: at(100, 80) });
    b.emit({ type: 'command:place-tower', typeId: 'research-center', position: at(100, 130) });
    step();
    expect(ofType('research-center').map((t) => t.ownerId).sort()).toEqual(['a', 'b']);
    expect(a.gsm.researchOf('a').centerLevel).toBe(1);
    expect(a.gsm.researchOf('b').centerLevel).toBe(1);

    const before = a.gsm.creditsOf('a');
    expect(a.gsm.researchOf('a').isCompleted('ice-magic')).toBe(false);
    a.emit({ type: 'command:start-research', researchId: 'ice-magic' });
    step();
    expect(a.gsm.creditsOf('a')).toBeLessThan(before);
    expect(a.gsm.researchOf('a').isActive('ice-magic')).toBe(true);
    expect(a.gsm.researchOf('b').isActive('ice-magic')).toBe(false);
    for (let i = 0; i < 5000 && !a.gsm.researchOf('a').isCompleted('ice-magic'); i++) step(1);
    expect(a.gsm.researchOf('a').isCompleted('ice-magic')).toBe(true);
    expect(b.gsm.researchOf('a').isCompleted('ice-magic')).toBe(true);
    expect(a.gsm.researchOf('b').isCompleted('ice-magic')).toBe(false);
    // The UI of each client shows its own player's research
    expect(a.gsm.researchManager.isCompleted('ice-magic')).toBe(true);
    expect(b.gsm.researchManager.isCompleted('ice-magic')).toBe(false);

    // A may build what A unlocked, B may not
    a.emit({ type: 'command:place-tower', typeId: 'ice', position: at(160, 40) });
    b.emit({ type: 'command:place-tower', typeId: 'ice', position: at(160, 160) });
    step();
    const placed = ofType('ice').filter((t) => !a.world.towers.includes(t));
    expect(placed.map((t) => t.ownerId)).toEqual(['a']);
    expect(a.run(() => a.gsm.stateHash())).toBe(b.run(() => b.gsm.stateHash()));
  });
});

describe('Coop hero, abilities and manned towers per player (COOP_PLAN C2c)', () => {
  const mathRandom = Math.random;
  afterEach(() => {
    Math.random = mathRandom;
  });

  function pair() {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    const step = (frames = 3) => {
      for (let i = 0; i < frames; i++) {
        relay.closeTick();
        a.frame(40);
        b.frame(40);
      }
    };
    return { a, b, step };
  }

  it('gives each player a hero and abilities of their own, and their kills gold', () => {
    const { a, b, step } = pair();
    const earned = new Map<string, number>();
    const byKiller = new Map<string, number>();
    const bus = a.gsm.getEventBus();
    bus.on('credits:changed', (e) => {
      if (e.source === 'kill') earned.set(e.playerId, (earned.get(e.playerId) ?? 0) + e.delta);
    });
    bus.on('enemy:died', (e) => {
      if (e.credits <= 0 || !e.killedBy) return;
      let owner: string;
      if (e.killedBy.kind === 'tower') owner = a.gsm.towerManager.getById(e.killedBy.towerId)!.ownerId;
      else if (e.killedBy.kind === 'hero') owner = e.killedBy.heroId === 'hero:a' ? 'a' : 'b';
      else if (e.killedBy.kind === 'ability') owner = e.killedBy.ownerId!;
      else return;
      byKiller.set(owner, (byKiller.get(owner) ?? 0) + e.credits);
    });

    a.emit({ type: 'debug:ready-hero' });
    b.emit({ type: 'debug:ready-hero' });
    a.emit({ type: 'debug:ready-ability', abilityId: 'frost-bomb' });
    step();
    expect(a.gsm.heroOf('a').getHero()).not.toBeNull();
    expect(a.gsm.heroOf('b').getHero()).not.toBeNull();
    expect(a.gsm.heroOf('a').heroId).not.toBe(a.gsm.heroOf('b').heroId);
    // Each client shows its own player's
    expect(a.gsm.heroManager.owner.playerId).toBe('a');
    expect(b.gsm.heroManager.owner.playerId).toBe('b');
    const chargesB = a.gsm.abilityOf('b').getStatus('frost-bomb').charges;

    a.emit({ type: 'command:start-wave', director: directorWave() });
    let waved = false;
    let used = false;
    for (let f = 0; f < 20000; f++) {
      step(1);
      const phase = a.gsm.waveManager.phase();
      if (phase === 'wave') waved = true;
      else if (waved) break;
      if (waved && !used && a.gsm.enemyManager.getAll().length > 6) {
        const target = a.gsm.enemyManager.getAll()[0].position;
        a.emit({ type: 'command:use-ability', abilityId: 'frost-bomb', target: { lat: target.lat, lon: target.lon } });
        used = true;
      }
    }
    expect(used).toBe(true);
    expect(a.gsm.abilityOf('b').getStatus('frost-bomb').charges).toBe(chargesB);
    expect(earned.get('a')).toBeGreaterThan(0);
    expect(earned.get('b')).toBeGreaterThan(0);
    expect(earned).toEqual(byKiller);
    expect(a.run(() => a.gsm.stateHash())).toBe(b.run(() => b.gsm.stateHash()));
  });

  it('lets each player sit in a tower of their own at the same time', () => {
    const { a, b, step } = pair();
    const [towerA, towerB] = a.world.towers; // owned by a and b in turn
    a.emit({ type: 'command:man-tower', towerId: towerA.id });
    b.emit({ type: 'command:man-tower', towerId: towerA.id }); // A's tower: refused
    step();
    expect(a.gsm.getMannedTower()?.id).toBe(towerA.id);
    expect(b.gsm.getMannedTower()).toBeNull();

    b.emit({ type: 'command:man-tower', towerId: towerB.id });
    b.emit({ type: 'command:tower-aim', heading: 1.25, pitch: 0.1 });
    a.emit({ type: 'command:tower-aim', heading: -0.5, pitch: 0 });
    step();
    expect(b.gsm.getMannedTower()?.id).toBe(towerB.id);
    const mirrorA = b.gsm.towerManager.getById(towerA.id)!;
    const mirrorB = a.gsm.towerManager.getById(towerB.id)!;
    expect(mirrorA.manned && mirrorB.manned).toBe(true);
    expect(mirrorA.manualAim.heading).toBe(-0.5);
    expect(mirrorB.manualAim.heading).toBe(1.25);

    a.emit({ type: 'command:leave-tower' });
    step();
    expect(a.gsm.getMannedTower()).toBeNull();
    expect(a.gsm.towerManager.getById(towerB.id)!.manned).toBe(true);
    expect(a.run(() => a.gsm.stateHash())).toBe(b.run(() => b.gsm.stateHash()));
  });
});

describe('Coop lanes and readiness (COOP_PLAN C2d)', () => {
  const mathRandom = Math.random;
  afterEach(() => {
    Math.random = mathRandom;
  });

  it('runs the whole wave on every lane, each on its own spawn', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    const lanes = new Map([['a', 'spawn-1'], ['b', 'spawn-2']]);
    a.gsm.setLanes(lanes);
    b.gsm.setLanes(lanes);
    // Route 1 runs north at 0 m east, route 2 at 200 m east (sim-world.ts)
    const perLane = [0, 0];
    let announced = 0;
    a.gsm.getEventBus().on('wave:started', (e) => { announced = e.enemyCount; });
    a.gsm.getEventBus().on('enemy:spawned', (e) => {
      if (e.viaPortal) perLane[e.enemy.position.lon * M < 100 ? 0 : 1]++;
    });

    a.emit({ type: 'command:start-wave', director: directorWave() });
    let waved = false;
    for (let f = 0; f < 20000; f++) {
      relay.closeTick();
      a.frame(40);
      b.frame(40);
      if (a.gsm.waveManager.phase() === 'wave') waved = true;
      else if (waved) break;
    }
    const total = directorWave().totalCount;
    expect(announced).toBe(2 * total);
    expect(perLane).toEqual([total, total]);
    expect(a.run(() => a.gsm.stateHash())).toBe(b.run(() => b.gsm.stateHash()));
  });

  it('pays a kill on two lanes what it pays on one: every lane has the whole wave and its kill gold', () => {
    /** The gold of each tower kill of wave 1, with or without lanes */
    const killGold = (withLanes: boolean): number[] => {
      Math.random = mulberry32(SEED + 1);
      const relay = new LocalRelay(true);
      const a = buildClient(relay, 'a');
      const b = buildClient(relay, 'b');
      if (withLanes) {
        const lanes = new Map([['a', 'spawn-1'], ['b', 'spawn-2']]);
        a.gsm.setLanes(lanes);
        b.gsm.setLanes(lanes);
      }
      const paid: number[] = [];
      a.gsm.getEventBus().on('enemy:died', (e) => {
        if (e.killedBy?.kind === 'tower') paid.push(e.credits);
      });
      a.emit({ type: 'command:start-wave', director: directorWave() });
      let waved = false;
      for (let f = 0; f < 20000; f++) {
        relay.closeTick();
        a.frame(40);
        b.frame(40);
        if (a.gsm.waveManager.phase() === 'wave') waved = true;
        else if (waved) break;
      }
      return paid;
    };
    const alone = killGold(false);
    const laned = killGold(true);
    expect(alone.length).toBeGreaterThan(0);
    expect(laned.length).toBeGreaterThan(alone.length);
    // A zombie of the same wave is worth the same; before, the budget was spread over both lanes
    expect(laned[0]).toBe(alone[0]);
  });

  it('previews one lane of a coop wave and how many lanes get it (TODO E34)', () => {
    const preview = (withLanes: boolean) => {
      Math.random = mulberry32(SEED + 1);
      const relay = new LocalRelay(true);
      const a = buildClient(relay, 'a');
      const b = buildClient(relay, 'b');
      if (withLanes) {
        const lanes = new Map([['a', 'spawn-1'], ['b', 'spawn-2']]);
        a.gsm.setLanes(lanes);
        b.gsm.setLanes(lanes);
      }
      let shown: WaveGroupDisplay[] = [];
      a.gsm.getEventBus().on('wave:groups', (event) => { shown = event.groups; });
      a.emit({ type: 'command:start-wave', director: directorWave() });
      for (let f = 0; f < 200 && a.gsm.waveManager.phase() !== 'wave'; f++) {
        relay.closeTick();
        a.frame(40);
        b.frame(40);
      }
      return shown.map((g) => [g.enemyType, g.count, g.lanes]);
    };
    const alone = preview(false);
    expect(alone.length).toBeGreaterThan(0);
    expect(preview(true)).toEqual(alone.map(([type, count]) => [type, count, 2]));
  });

  it('tells everyone once every player is ready, and forgets it when the wave starts', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    const heard: { playerId: string; ready: boolean; allReady: boolean; local: boolean }[] = [];
    b.gsm.getEventBus().on('coop:ready-changed', (e) => heard.push({ playerId: e.playerId, ready: e.ready, allReady: e.allReady, local: e.local }));
    const step = () => { relay.closeTick(); a.frame(40); b.frame(40); };

    a.emit({ type: 'command:set-ready', ready: true });
    step();
    expect(b.gsm.allReady()).toBe(false);
    b.emit({ type: 'command:set-ready', ready: true });
    step();
    expect(a.gsm.allReady()).toBe(true);
    expect(heard).toEqual([
      { playerId: 'a', ready: true, allReady: false, local: false },
      { playerId: 'b', ready: true, allReady: true, local: true },
    ]);

    a.emit({ type: 'command:start-wave', director: directorWave() });
    step();
    expect(a.gsm.allReady()).toBe(false);
    expect(b.gsm.allReady()).toBe(false);
  });
});

describe('Coop restart in the room (review R1)', () => {
  const mathRandom = Math.random;
  afterEach(() => {
    Math.random = mathRandom;
  });

  it('starts the same new run on every client, and commands after it act at once', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    const tick = () => {
      relay.closeTick();
      a.frame(TICK_SUB_STEPS * 17);
      b.frame(TICK_SUB_STEPS * 17);
    };
    a.emit({ type: 'command:start-wave', director: directorWave() });
    for (let t = 0; t < 60; t++) tick();
    const stepsBefore = a.gsm.subStep;
    expect(stepsBefore).toBeGreaterThan(50 * TICK_SUB_STEPS);

    // Each client's own Math.random differs: the seed has to come with the command
    Math.random = mulberry32(99);
    a.emit({ type: 'command:restart-game', seed: 4242 });
    for (let t = 0; t < 3; t++) tick();
    expect(a.gsm.subStep).toBeLessThan(stepsBefore);
    expect(a.gsm.waveManager.waveNumber()).toBe(0);

    const credits = a.gsm.creditsOf('a');
    b.emit({ type: 'command:give-credits', to: 'a', amount: 7 });
    for (let t = 0; t < 3; t++) tick();
    // Acted within a few ticks, not after the ticks the old run had used up
    expect(a.gsm.creditsOf('a')).toBe(credits + 7);
    expect(b.gsm.creditsOf('a')).toBe(credits + 7);
    expect(a.run(() => a.gsm.stateHash())).toBe(b.run(() => b.gsm.stateHash()));
    expect(relay.divergences).toEqual([]);
  });
});

describe('Coop gold from one player to another', () => {
  const mathRandom = Math.random;
  afterEach(() => {
    Math.random = mathRandom;
  });

  it('moves the gold at the tick on both clients, and refuses more than the giver has', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    const start = a.gsm.creditsOf('a');
    const given: number[] = [];
    b.gsm.getEventBus().on('coop:credits-given', (e) => { if (e.toLocal) given.push(e.amount); });

    a.emit({ type: 'command:give-credits', to: 'b', amount: 60 });
    a.emit({ type: 'command:give-credits', to: 'b', amount: start * 10 }); // more than A has
    a.emit({ type: 'command:give-credits', to: 'a', amount: 5 }); // to oneself
    b.emit({ type: 'command:give-credits', to: 'a', amount: 2.5 }); // not whole gold
    expect(a.gsm.creditsOf('a')).toBe(start); // at the tick, not at the click
    for (let t = 0; t < 3; t++) {
      relay.closeTick();
      a.frame(TICK_SUB_STEPS * 17);
      b.frame(TICK_SUB_STEPS * 17);
    }
    for (const client of [a, b]) {
      expect(client.gsm.creditsOf('a')).toBe(start - 60);
      expect(client.gsm.creditsOf('b')).toBe(start + 60);
    }
    expect(b.gsm.credits()).toBe(start + 60);
    expect(given).toEqual([60]);
    expect(relay.divergences).toEqual([]);
  });
});

describe('Coop line of sight from the host (COOP_PLAN C3)', () => {
  const mathRandom = Math.random;
  afterEach(() => {
    Math.random = mathRandom;
  });

  it('makes a new tower ready at the same boundary on host and guest, from the host mask', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay();
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    // A renders and answers (the host's TowerLosRegistry), B only waits
    const readyAt = new Map<string, number>();
    const lag = mulberry32(3);

    a.emit({ type: 'command:start-wave', director: directorWave() });
    let placed: string | null = null;
    let waved = false;
    for (let f = 0; f < 20000; f++) {
      const lead = Math.max(a.gsm.subStep, b.gsm.subStep) + 3 * TICK_SUB_STEPS;
      while ((relay.lastClosed + 1) * TICK_SUB_STEPS <= lead) relay.closeTick();
      a.link.deliver();
      if (lag() < 0.5) b.link.deliver(1 + Math.floor(lag() * 3));
      a.frame(40);
      a.run(() => a.world.answerLos());
      b.frame(40);
      if (f === 30) b.emit({ type: 'command:place-tower', typeId: 'archer', position: { lat: 250 / M, lon: 10 / M, height: 0 } });
      if (placed === null) {
        placed = a.gsm.towerManager.getAll().find((t) => !a.world.towers.includes(t))?.id ?? null;
      }
      for (const [client, name] of [[a, 'a'], [b, 'b']] as const) {
        const tower = placed ? client.gsm.towerManager.getById(placed) : null;
        if (tower?.losReady && !readyAt.has(name)) readyAt.set(name, client.gsm.subStep);
      }
      if (a.gsm.waveManager.phase() === 'wave') waved = true;
      else if (waved) break;
    }
    b.link.deliver();
    for (let i = 0; i < 400; i++) { a.frame(40); b.frame(40); }

    expect(placed).not.toBeNull();
    expect(a.gsm.towerManager.getById(placed!)!.ownerId).toBe('b');
    const masks = a.gsm.commandLog.entries.filter((e) => e.command.type === 'command:los-mask');
    expect(masks.map((e) => e.playerId)).toEqual(['a']);
    expect(b.gsm.commandLog.entries.filter((e) => e.command.type === 'command:los-mask').map((e) => e.step))
      .toEqual(masks.map((e) => e.step));
    expect(readyAt.get('a')).toBeDefined();
    expect(a.gsm.towerManager.getById(placed!)!.combat.kills).toBe(b.gsm.towerManager.getById(placed!)!.combat.kills);
    let compared = 0;
    for (const [step, hash] of a.hashes) {
      const other = b.hashes.get(step);
      if (other === undefined) continue;
      if (other !== hash) throw new Error(`diverged at sub-step boundary ${step}`);
      compared++;
    }
    expect(compared).toBeGreaterThan(500);
  });
});

describe('Coop player leaving (COOP_PLAN C4)', () => {
  const mathRandom = Math.random;
  afterEach(() => {
    Math.random = mathRandom;
  });

  it('closes the lane of who left, and does not wait for them to be ready', () => {
    Math.random = mulberry32(SEED + 1);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    const b = buildClient(relay, 'b');
    const lanes = new Map([['a', 'spawn-1'], ['b', 'spawn-2']]);
    a.gsm.setLanes(lanes);
    b.gsm.setLanes(lanes);
    const step = () => { relay.closeTick(); a.frame(40); b.frame(40); };

    // The relay sends it for B when B's socket closes; here B's link does
    b.link.send({ type: 'command:leave-game' });
    step();
    expect(a.gsm.laneSpawns).toEqual(['spawn-1']);
    expect(b.gsm.laneSpawns).toEqual(['spawn-1']);
    a.emit({ type: 'command:set-ready', ready: true });
    step();
    expect(a.gsm.allReady()).toBe(true);

    let announced = 0;
    a.gsm.getEventBus().on('wave:started', (e) => { announced = e.enemyCount; });
    a.emit({ type: 'command:start-wave', director: directorWave() });
    step();
    expect(announced).toBe(directorWave().totalCount);
    expect(a.run(() => a.gsm.stateHash())).toBe(b.run(() => b.gsm.stateHash()));
  });

  it('takes commands from this player once it goes on alone without the relay (PLAYTEST T38)', () => {
    Math.random = mulberry32(SEED + 2);
    const relay = new LocalRelay(true);
    const a = buildClient(relay, 'a');
    a.gsm.setLanes(new Map([['a', 'spawn-1'], ['b', 'spawn-2']]));
    // CoopService.continueAlone: no link, the partner gone, the ids stay
    a.gsm.setLockstep(null);
    a.gsm.playerLeft('b');

    let started = 0;
    a.gsm.getEventBus().on('wave:started', () => { started++; });
    a.emit({ type: 'command:start-wave', director: directorWave() });
    a.frame(40);
    expect(started).toBe(1);
    const before = a.gsm.creditsOf('a');
    a.emit({ type: 'debug:add-credits', amount: 1000 });
    expect(a.gsm.creditsOf('a')).toBe(before + 1000);
  });
});
