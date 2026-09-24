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
import type { WaveConfig as DirectorWave } from '../director/models/wave-config';
import { mulberry32 } from '../utils/game-rng';
import { METERS_PER_DEGREE_LAT as M } from '../utils/geo-utils';
import { LocalRelay, type LocalLink } from '../coop/local-relay';
import { TICK_SUB_STEPS } from '../coop/lockstep';
import { buildWorldPackage, packagePaths, readWorldPackage } from '../coop/world-package';
import { buildSimWorld, type SimWorld, type SimWorldOptions } from './sim-world';

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
    const source = host.gsm.worldSource()!;
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
    const grid = joiner.gsm.getGlobalRouteGrid();
    expect(source.heights.some(([, , state]) => state === 2)).toBe(true); // filled cells travel too
    expect(joiner.gsm.worldKey()).toBe(world.worldKey);
    expect(joiner.gsm.worldKey()).toBe(host.gsm.worldKey());
    expect(grid.cellsWithoutHeight()).toBe(host.gsm.getGlobalRouteGrid().cellsWithoutHeight());
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

    // Selecting: each client only its own player's towers
    expect(a.gsm.selectableTower(built.id)).toBe(built.id);
    expect(b.gsm.selectableTower(built.id)).toBeNull();

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
