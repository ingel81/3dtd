/**
 * Acceptance of the re-simulation (docs/SIMULATOR_PLAN.md, P5): a wave runs
 * live with commands in the middle of it (upgrades, targeting, hold fire,
 * the hero, an ability), then it is re-simulated from its wave-start
 * snapshot and the command log. Every state hash the live run took must
 * come out the same, bit for bit, and the state at the wave's end as well.
 *
 * The real GameStateManager with the real route grid, combat and damage on
 * a flat frame (the benchmark's harness, sim-step-bench.ts). The line of
 * sight side of TowerPlacementService is a small real stand-in that writes
 * masks into the grid: a restore has to put the towers' answers back.
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

import { GameStateManager } from '../managers/game-state.manager';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import { StatusEffectService } from '../services/combat/status-effect.service';
import { CombatVfxService } from '../services/combat/combat-vfx.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { TowerCombatService } from '../services/combat/tower-combat.service';
import { EconomyService } from '../services/economy.service';
import { GameObject } from '../core/game-object';
import type { Tower } from '../entities/tower.entity';
import type { GeoPosition } from '../models/game.types';
import type { WaveConfig, SpawnEntry } from '../managers/wave.manager';
import type { LosMask } from '../utils/los-mask';
import { mulberry32 } from '../utils/game-rng';
import { METERS_PER_DEGREE_LAT as M } from '../utils/geo-utils';
import { Resimulation } from '../simulator/resimulation';
import { buildReplayFile, readReplayFile } from '../simulator/replay-file';
import { noopStub } from './noop-stub';
import { buildRoute, createBenchEngine, flatSync, markAllVisible } from './sim-step-bench';

const SEED = 0x51a1;

/** The line of sight side of TowerPlacementService, on the real grid, no GPU. */
function losPlacement(grid: GlobalRouteGridService) {
  const queue: Tower[] = [];
  const unregister = (tower: Tower) => {
    grid.unregisterTower(tower.id);
    tower.visibleCells = [];
    tower.losMask = null;
  };
  return noopStub({
    registerTowerFromMask: (tower: Tower, mask: LosMask) => {
      tower.visibleCells = grid.applyLosMask(tower.id, tower.position.lon * M, -tower.position.lat * M, mask);
      tower.losMask = mask;
      tower.losReady = true;
    },
    unregisterTowerFromGrid: unregister,
    clearAllTowerOverlays: (towers: Tower[]) => towers.forEach(unregister),
    queuedLosTowerIds: () => queue.map((t) => t.id),
    requeueLos: (towers: Tower[]) => queue.splice(0, queue.length, ...towers),
    setLosMaskSource: () => undefined,
    drainLosQueue: () => undefined,
  });
}

interface World {
  gsm: GameStateManager;
  towers: Tower[];
  routes: GeoPosition[][];
  restoreMath(): void;
}

function buildWorld(): World {
  for (const key of Object.keys(services)) delete services[key];
  GameObject.resetIdCounter();
  const mathRandom = Math.random;
  Math.random = mulberry32(SEED + 1);

  const routes = [buildRoute(0, 600), buildRoute(200, 600)];
  const grid = new GlobalRouteGridService();
  grid.initialize((() => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 1 })) as never, flatSync as never);
  grid.generateFromRoutes(routes);
  const paths = new Map<string, GeoPosition[]>(routes.map((route, i) => [`spawn-${i + 1}`, route]));
  const spawnPoints = routes.map((route, i) => ({ id: `spawn-${i + 1}`, name: `Spawn ${i + 1}`, ...route[0] }));

  services['GlobalRouteGridService'] = grid;
  services['SpatialGridService'] = new SpatialGridService();
  services['StatusEffectService'] = new StatusEffectService();
  services['ResearchStore'] = noopStub();
  services['PathAndRouteService'] = noopStub({ getCachedPaths: () => paths });
  services['EnemyDebugService'] = noopStub({ debugEnemies: () => [], clearDebugEnemies: () => undefined });
  services['EconomyService'] = new EconomyService();
  services['CombatVfxService'] = new CombatVfxService();
  services['DamageApplicationService'] = new DamageApplicationService();
  services['CombatEffectService'] = new CombatEffectService();
  services['TowerCombatService'] = new TowerCombatService();
  services['TowerPlacementService'] = losPlacement(grid);

  const gsm = new GameStateManager();
  gsm.rng.reset(SEED);
  gsm.initialize(createBenchEngine(), routes[0][routes[0].length - 1], spawnPoints, paths);
  gsm.researchManager.completeResearch('aa-retrofit');

  const types = ['archer', 'cannon', 'ice', 'fire', 'lightning', 'rocket', 'magic', 'poison'] as const;
  const towers = types.map((type, i) => {
    const route = i % 2;
    const s = 60 + Math.floor(i / 2) * 120;
    const east = route * 200 + (i % 4 < 2 ? 9 : -11);
    const tower = gsm.towerManager.placeTower({ lat: s / M, lon: east / M, height: 0 }, type, 0)!;
    markAllVisible(grid, tower);
    return tower;
  });
  return { gsm, towers, routes, restoreMath: () => { Math.random = mathRandom; } };
}

/** Bodies along the route, a chain of segments and splitting skeletons: the enemies with state of their own */
function bossConfig(): WaveConfig {
  const types = ['ooze', 'worm', 'skeleton', 'zombie', 'skeleton', 'bat'] as const;
  const entries: SpawnEntry[] = types.map((enemyType) => ({ enemyType, speed: 1, health: 0.3 }));
  return { schedule: { entries, baseDelay: 900, spawnMode: 'each' } };
}

function waveConfig(): WaveConfig {
  const types = ['zombie', 'rat', 'bat', 'zombie-soldier', 'skeleton', 'hornet'] as const;
  const entries: SpawnEntry[] = Array.from({ length: 70 }, (_, i) => ({
    enemyType: types[i % types.length],
    speed: 1,
    health: 2,
  }));
  return { schedule: { entries, baseDelay: 350, delayVariation: 0.3, spawnMode: 'random' } };
}

/**
 * Run the live wave: frames of changing length (so the steps per frame
 * vary), commands between frames at fixed frame counts. Returns the state
 * hash right after the wave's last step.
 */
function playLive(world: World): number {
  const { gsm, towers } = world;
  const bus = gsm.getEventBus();
  let now = 1000;
  let endHash: number | null = null;
  const frame = (ms: number) => {
    now += ms;
    gsm.update(now, () => {
      if (endHash === null && gsm.waveManager.phase() !== 'wave' && gsm.simRecorder.records[0]?.endStep !== null) {
        endHash = gsm.stateHash();
      }
    });
  };

  gsm.gameSpeed.set(3);
  bus.emit({ type: 'debug:ready-hero' });
  bus.emit({ type: 'debug:ready-ability', abilityId: 'frost-bomb' });
  bus.emit({ type: 'command:start-wave', config: waveConfig() } as never);

  for (let f = 0; f < 6000 && gsm.waveManager.phase() === 'wave'; f++) {
    // Frames of 10 to 40 ms: 1 to 7 sub-steps at 3x
    frame(10 + ((f * 7) % 31));
    if (f === 20) bus.emit({ type: 'debug:add-credits', amount: 5000 });
    if (f === 25) bus.emit({ type: 'command:upgrade-tower', towerId: towers[0].id, upgradeId: 'damage' });
    if (f === 30) bus.emit({ type: 'command:set-targeting', towerId: towers[1].id, strategy: 'highest-hp' });
    if (f === 40) bus.emit({ type: 'command:hero-move', target: { lat: 200 / M, lon: 0 } });
    if (f === 60) bus.emit({ type: 'command:set-hold-fire', towerId: towers[2].id, holdFire: true });
    if (f === 90) bus.emit({ type: 'command:use-ability', abilityId: 'frost-bomb', target: { lat: 150 / M, lon: 0 } });
    if (f === 120) bus.emit({ type: 'command:set-hold-fire', towerId: towers[2].id, holdFire: false });
    if (f === 150) bus.emit({ type: 'command:upgrade-tower', towerId: towers[3].id, upgradeId: 'speed' });
  }
  expect(gsm.waveManager.phase()).not.toBe('wave');
  expect(endHash).not.toBeNull();
  return endHash!;
}

describe('Re-simulation of a wave (SIMULATOR_PLAN P5)', () => {
  let world: World | null = null;
  afterEach(() => {
    world?.restoreMath();
    world = null;
  });

  it('re-simulates a live wave bit for bit, commands in the middle of it included', () => {
    world = buildWorld();
    const { gsm } = world;
    const liveEnd = playLive(world);

    const record = gsm.simRecorder.get(1)!;
    expect(record.refusal).toBeNull();
    expect(record.tainted).toBeNull();
    expect(record.endStep).not.toBeNull();
    expect(record.hashes.length).toBeGreaterThan(5);
    const commands = gsm.commandLog.entries.filter((e) => e.step >= record.startStep).map((e) => e.command.type);
    expect(commands).toEqual(expect.arrayContaining([
      'command:upgrade-tower', 'command:set-targeting', 'command:hero-move', 'command:set-hold-fire', 'command:use-ability',
    ]));

    const resim = new Resimulation(gsm.resimHost, record, gsm.commandLog.entries);
    resim.start();
    while (resim.step()) { /* to the end */ }

    expect(resim.divergedAt).toBeNull();
    expect(resim.checkedHashes).toBe(record.hashes.length);
    expect(gsm.subStep).toBe(record.endStep);
    expect(gsm.stateHash()).toBe(liveEnd);
    resim.end();
  });

  it('comes out the same when it seeks back and runs again', () => {
    world = buildWorld();
    const { gsm } = world;
    const liveEnd = playLive(world);
    const record = gsm.simRecorder.get(1)!;

    const resim = new Resimulation(gsm.resimHost, record, gsm.commandLog.entries);
    resim.stepTo(900);
    const at900 = gsm.stateHash();
    resim.stepTo(2000);
    resim.stepTo(900);
    expect(gsm.stateHash()).toBe(at900);
    while (resim.step()) { /* to the end */ }
    expect(resim.divergedAt).toBeNull();
    expect(gsm.stateHash()).toBe(liveEnd);
    resim.end();
  });

  it('gives the live game back from a snapshot taken before the replay', () => {
    world = buildWorld();
    const { gsm } = world;
    playLive(world);
    // Let the last shots land, then the state is quiet again
    let now = 1e6;
    for (let i = 0; i < 200 && gsm.snapshotRefusal() !== null; i++) gsm.update((now += 16.667));
    expect(gsm.snapshotRefusal()).toBeNull();
    const live = gsm.captureSnapshot();
    const liveHash = gsm.stateHash();

    const resim = new Resimulation(gsm.resimHost, gsm.simRecorder.get(1)!, gsm.commandLog.entries);
    resim.stepTo(1500);
    resim.end();
    gsm.restoreSnapshot(live, 'live');

    expect(gsm.stateHash()).toBe(liveHash);
    expect(gsm.captureSnapshot()).toEqual(live);
  });
  it('re-simulates a wave from a replay file in a fresh game on the same world', () => {
    world = buildWorld();
    const played = world.gsm;
    const liveEnd = playLive(world);
    const head = { worldKey: played.worldKey(), configHash: 'balance', seed: played.rng.seed };
    const text = JSON.stringify(buildReplayFile(played.simRecorder.records, played.commandLog.entries, head));
    world.restoreMath();

    // Another game on the same map, nothing played in it
    world = buildWorld();
    const fresh = world.gsm;
    expect(fresh.worldKey()).toBe(head.worldKey);
    const read = readReplayFile(text, { worldKey: fresh.worldKey(), configHash: 'balance' });
    expect(read.refusal).toBeNull();

    const resim = new Resimulation(fresh.resimHost, read.file!.waves[0], read.file!.log);
    resim.start();
    while (resim.step()) { /* to the end */ }
    expect(resim.divergedAt).toBeNull();
    expect(resim.checkedHashes).toBe(read.file!.waves[0].hashes.length);
    expect(fresh.stateHash()).toBe(liveEnd);
    resim.end();
  });

  it('refuses a replay file of another world or balance', () => {
    world = buildWorld();
    const { gsm } = world;
    playLive(world);
    const head = { worldKey: gsm.worldKey(), configHash: 'balance', seed: 1 };
    const text = JSON.stringify(buildReplayFile(gsm.simRecorder.records, gsm.commandLog.entries, head));
    expect(readReplayFile(text, { worldKey: 'elsewhere', configHash: 'balance' }).refusal).toBe('other-world');
    expect(readReplayFile(text, { worldKey: head.worldKey, configHash: 'changed' }).refusal).toBe('other-balance');
    expect(readReplayFile('{"x":1}', { worldKey: head.worldKey, configHash: 'balance' }).refusal).toBe('not-a-replay');
  });
  it('re-simulates a wave of an ooze, a worm and splitting skeletons', () => {
    world = buildWorld();
    const { gsm } = world;
    const bus = gsm.getEventBus();
    let now = 1000;
    const spawned = new Map<string, number>();
    bus.on('enemy:spawned', (e) => spawned.set(e.enemy.typeConfig.id, (spawned.get(e.enemy.typeConfig.id) ?? 0) + 1));
    gsm.gameSpeed.set(4);
    bus.emit({ type: 'command:start-wave', config: bossConfig() } as never);
    for (let f = 0; f < 20000 && gsm.waveManager.phase() === 'wave'; f++) gsm.update((now += 10 + ((f * 13) % 29)));
    expect(gsm.waveManager.phase()).not.toBe('wave');
    const record = gsm.simRecorder.get(1)!;
    expect(record.endStep).not.toBeNull();
    // The ooze, the worm's segments and the skeletons' minions all came
    expect(spawned.get('ooze')).toBe(1);
    expect(spawned.get('worm')).toBeGreaterThan(3);
    expect(spawned.get('skeleton-minion') ?? spawned.get('skeleton-warrior') ?? 0).toBeGreaterThan(0);
    expect(record.hashes.length).toBeGreaterThan(10);

    const resim = new Resimulation(gsm.resimHost, record, gsm.commandLog.entries);
    resim.start();
    while (resim.step()) { /* to the end */ }
    expect(resim.divergedAt).toBeNull();
    expect(resim.checkedHashes).toBe(record.hashes.length);
    expect(gsm.subStep).toBe(record.endStep);
    resim.end();
  });
  it('leaves nothing of the replay in the live game: the next 120 sub-steps come out as without it', () => {
    world = buildWorld();
    const { gsm } = world;
    playLive(world);
    let now = 1e6;
    for (let i = 0; i < 200 && gsm.snapshotRefusal() !== null; i++) gsm.update((now += 16.667));
    const live = gsm.captureSnapshot();
    const run = () => {
      for (let i = 0; i < 120; i++) gsm.update((now += 16.667));
      return gsm.captureSnapshot();
    };
    // Both runs from the restored state: a restore starts the frame bookkeeping over
    gsm.restoreSnapshot(live, 'live');
    const without = run();

    gsm.restoreSnapshot(live, 'live');
    const resim = new Resimulation(gsm.resimHost, gsm.simRecorder.get(1)!, gsm.commandLog.entries);
    resim.start();
    // To the very end: the wave's last step leaves wave:completed waiting in the bus
    while (resim.step()) { /* to the end */ }
    gsm.restoreSnapshot(live, 'live');
    resim.end();
    expect(gsm.getEventBus().hasDeferred).toBe(false);

    expect(run()).toEqual(without);
  });

  it('re-simulates worms on two routes from a file in a fresh session', () => {
    // delay 0 after the first entry: the next spawns in the same sub-step, so segments of
    // worms on both routes come out in the same steps and the order of the paths shows
    const worms = (types: readonly string[]): WaveConfig => ({
      schedule: {
        entries: types.map((enemyType, i) => ({ enemyType, speed: 1, health: 0.2, ...(i === 0 ? { delay: 0 } : {}) }) as SpawnEntry),
        baseDelay: 400,
        spawnMode: 'each',
      },
    });
    const play = (gsm: GameStateManager, config: WaveConfig, from: number) => {
      let now = from;
      gsm.getEventBus().emit({ type: 'command:start-wave', config } as never);
      for (let f = 0; f < 20000 && gsm.waveManager.phase() === 'wave'; f++) gsm.update((now += 10 + ((f * 11) % 23)));
      for (let i = 0; i < 400 && gsm.snapshotRefusal() !== null; i++) gsm.update((now += 16.667));
      return now;
    };

    world = buildWorld();
    const played = world.gsm;
    played.gameSpeed.set(4);
    // Wave 1: the first worm of the session walks route 2; wave 2: worms on both routes
    const t = play(played, worms(['zombie', 'worm']), 1000);
    play(played, worms(['worm', 'worm', 'zombie', 'bat']), t);
    const record = played.simRecorder.get(2)!;
    expect(record.endStep).not.toBeNull();
    const text = JSON.stringify(buildReplayFile(played.simRecorder.records, played.commandLog.entries, {
      worldKey: played.worldKey(), configHash: 'balance', seed: played.rng.seed,
    }));
    world.restoreMath();

    world = buildWorld();
    const fresh = world.gsm;
    const read = readReplayFile(text, { worldKey: fresh.worldKey(), configHash: 'balance' });
    const wave2 = read.file!.waves.find((w) => w.wave === 2)!;
    const resim = new Resimulation(fresh.resimHost, wave2, read.file!.log);
    resim.start();
    while (resim.step()) { /* to the end */ }
    expect(resim.checkedHashes).toBe(wave2.hashes.length);
    expect(resim.divergedAt).toBeNull();
    resim.end();
  });
});
