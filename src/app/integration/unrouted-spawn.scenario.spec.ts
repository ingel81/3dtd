/**
 * TODO E232 replayed: a place whose spawn has no route to the HQ (a street
 * network torn by an incomplete Overpass answer). In 0.7.0 every wave broke
 * off after its failed spawns, counted as won and paid its gold, and with
 * the auto-start the empty waves ran one after the other: wave 28 without
 * a single enemy.
 *
 * Through the real GameStateManager sub-step loop and the real
 * GameLoopFacadeService auto-start on the main bus, with the harness of
 * strike-wave-end.scenario.spec.ts. The facade's startWave starts the
 * simulation's wave the way its command would.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));
// Only their DI tokens are needed, as in game-loop-facade.auto-wave.spec.ts
vi.mock('../services/boss-intro.service', () => ({ BossIntroService: class BossIntroService {} }));
vi.mock('../services/replay.service', () => ({ ReplayService: class ReplayService {} }));
vi.mock('../services/tower-control.service', () => ({ TowerControlService: class TowerControlService {} }));

const mockServices: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    effect: vi.fn(),
    inject: (token: { name?: string }) => {
      const name = token?.name ?? 'unknown';
      if (!mockServices[name]) mockServices[name] = withAutoStubs({});
      return mockServices[name];
    },
  };
});

import { signal } from '@angular/core';
import {
  provideSimServices,
  createTestCachedPaths,
  makeSingleTypeWaveConfig,
  withAutoStubs,
  TEST_PATH,
  TEST_SPAWN_POINTS,
} from './test-helpers';
import { GameStateManager } from '../managers/game-state.manager';
import { GameLoopFacadeService } from '../services/facade/game-loop-facade.service';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { EconomyService } from '../services/economy.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { GameObject } from '../core/game-object';
import { createMainEventBus, type ViewEvent } from '../sim/client/view-events';
import { AUTO_WAVE_DELAY_MS } from '../utils/auto-wave-countdown';
import { NO_ROUTE_TEXT } from '../services/world/path-route.service';
import type { GeoPosition } from '../models/game.types';
import type { SpawnPoint } from '../managers/wave.manager';
import type { UiNotice } from '../store/ui.store';
import type { FacadeComponentBridge } from '../services/facade/tower-defense-facade.service';

const BASE_POSITION: GeoPosition = TEST_PATH[TEST_PATH.length - 1];
/** A spawn on a street the network does not connect to the HQ: no route */
const LOST: SpawnPoint = { id: 'spawn-lost', name: 'Lost Spawn', lat: 48.7765, lon: 9.1835, height: 300 };
/** Three zombies, round robin over the spawn points */
const WAVE = makeSingleTypeWaveConfig({ count: 3, type: 'zombie', spawnDelay: 500, spawnMode: 'each' });

/** A game on `spawns` and `paths` with the "auto 10s" switch on and the facade on the main bus. */
function createGame(spawns: SpawnPoint[], paths: Map<string, GeoPosition[]>, hasRoutes: boolean) {
  for (const key of Object.keys(mockServices)) delete mockServices[key];
  provideSimServices(mockServices);
  GameObject.resetIdCounter();

  mockServices['GlobalRouteGridService'] = withAutoStubs({ isInitialized: () => false });
  mockServices['SpatialGridService'] = withAutoStubs({ updateEnemyTracked: () => null });
  // The completion gold as the game books it
  mockServices['EconomyService'] = new EconomyService();
  mockServices['DamageApplicationService'] = new DamageApplicationService();
  mockServices['CombatEffectService'] = new CombatEffectService();
  const notice = signal<UiNotice | null>(null);
  mockServices['UIStore'] = withAutoStubs({ autoStartWaves: signal(true), notice });
  mockServices['BotClientService'] = withAutoStubs({ botEnabled: signal(false) });
  mockServices['NgZone'] = { run: (fn: () => unknown) => fn() };
  const store = withAutoStubs({
    phase: signal<string>('setup'),
    waveNumber: signal(0),
    autoWaveSecondsLeft: signal<number | null>(null),
    hasRoutes: signal(hasRoutes),
    paused: signal(false),
  });
  mockServices['TowerDefenseStore'] = store;

  const gsm = new GameStateManager();
  gsm.initialize(BASE_POSITION, spawns, paths);
  gsm.gameSpeed.set(1);

  // The simulation's events of a frame on the main bus after the frame, the mirror at the frame's game time
  const mainBus = createMainEventBus();
  const pending: ViewEvent[] = [];
  gsm.getEventBus().onAny((event) => pending.push(event as unknown as ViewEvent));
  const scalars = { gameTimeMs: gsm.gameTimeMs };
  const deliver = () => {
    scalars.gameTimeMs = gsm.gameTimeMs;
    for (const event of pending.splice(0)) mainBus.emit(event);
  };
  mockServices['SimClient'] = withAutoStubs({ bus: mainBus, started: true });
  mockServices['SimMirror'] = withAutoStubs({ scalars });

  const facade = new GameLoopFacadeService();
  facade.initialize({ getEngine: () => ({}) } as unknown as FacadeComponentBridge);
  facade.subscribeToEventBus({ onGameOverExtra: () => undefined });
  // The press, the hotkey and the auto-start: the wave the command would start
  const startWave = vi.spyOn(facade, 'startWave').mockImplementation(() => gsm.startWave(WAVE));

  const bus = gsm.getEventBus();
  const seen = { started: 0, completed: 0, refused: 0 };
  bus.on('wave:started', () => seen.started++);
  bus.on('wave:completed', () => seen.completed++);
  bus.on('wave:refused', () => seen.refused++);

  let now = 1000;
  const frame = () => {
    now += 16;
    gsm.update(now);
    store.phase.set(gsm.waveManager.phase());
    deliver();
    facade.tickAutoWave();
  };
  /** Frames for `ms` of game time */
  const run = (ms: number) => {
    const end = gsm.gameTimeMs + ms;
    while (gsm.gameTimeMs < end) frame();
  };
  return { gsm, facade, startWave, notice, seen, frame, run };
}

describe('A spawn without a route to the HQ (TODO E232)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts no wave on a place without a route: the counter stays, no gold, no auto-start loop', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { gsm, facade, startWave, notice, seen, run } = createGame([...TEST_SPAWN_POINTS], new Map(), false);
    const credits = gsm.credits();

    // The press goes to the simulation (a coop host's start, a bot's): turned down
    facade.startWave();
    run(3 * AUTO_WAVE_DELAY_MS);

    expect(seen).toEqual({ started: 0, completed: 0, refused: 1 });
    expect(gsm.waveManager.waveNumber()).toBe(0);
    expect(gsm.waveManager.phase()).toBe('setup');
    expect(gsm.credits()).toBe(credits);
    expect(gsm.enemyManager.getAll()).toHaveLength(0);
    // Said in the banner, and no countdown armed by it: the press was the only start
    expect(notice()?.text).toContain(NO_ROUTE_TEXT);
    expect(startWave).toHaveBeenCalledTimes(1);
  });

  it('has no lane and no share of the start credits for the spawn without one', () => {
    const alone = createGame([...TEST_SPAWN_POINTS], createTestCachedPaths(), true);
    const startCredits = alone.gsm.credits();
    const { gsm } = createGame([...TEST_SPAWN_POINTS, LOST], createTestCachedPaths(), true);
    expect(gsm.getSpawnPoints().map((spawn) => spawn.id)).toEqual(['spawn-1']);
    expect(gsm.laneSpawns).toEqual(['spawn-1']);
    expect(gsm.credits()).toBe(startCredits);
  });

  it("plays the wave on the spawn with a route beside one without: 'each' skips it, the wave pays once", () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { gsm, facade, startWave, seen, frame, run } = createGame([...TEST_SPAWN_POINTS, LOST], createTestCachedPaths(), true);
    const paths = new Set<readonly GeoPosition[]>();
    gsm.getEventBus().on('enemy:spawned', (event) => paths.add(event.enemy.movement.path));
    const credits = gsm.credits();

    facade.startWave();
    // Until the three have walked in and the wave is over
    while (seen.completed === 0 && gsm.gameTimeMs < 600_000) frame();

    expect(seen.started).toBe(1);
    expect(seen.completed).toBe(1);
    expect(seen.refused).toBe(0);
    expect(gsm.waveManager.waveNumber()).toBe(1);
    // All three came, all on the one route
    expect([...paths]).toEqual([TEST_PATH]);
    expect(gsm.credits()).toBeGreaterThan(credits);
    // The auto-start counts again after a real wave and starts the next
    run(AUTO_WAVE_DELAY_MS + 100);
    expect(startWave).toHaveBeenCalledTimes(2);
    expect(seen.started).toBe(2);
  });
});
