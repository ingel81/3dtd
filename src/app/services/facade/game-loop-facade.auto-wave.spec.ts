import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core';

// Only its DI token is needed; the real module pulls in the game state manager.
vi.mock('../boss-intro.service', () => ({ BossIntroService: class BossIntroService {} }));
import { BossIntroService } from '../boss-intro.service';
// Only its DI token is needed; the real module pulls in services that need the JIT compiler
vi.mock('../replay.service', () => ({ ReplayService: class ReplayService {} }));
vi.mock('../tower-control.service', () => ({ TowerControlService: class TowerControlService {} }));

import { GameLoopFacadeService } from './game-loop-facade.service';
import { EngineStore } from '../../store/engine.store';
import { CameraControlService } from '../camera-control.service';
import { TowerPlacementService } from '../tower-placement.service';
import { MapPlacementService } from '../world/map-placement.service';
import { KeyboardPanService } from '../keyboard-pan.service';
import { MarkerVisualizationService } from '../world/marker-visualization.service';
import { RouteAnimationService } from '../world/route-animation.service';
import { IntroCameraFlightService } from '../world/intro-camera-flight.service';
import { WaveDebugService } from '../debug/wave-debug.service';
import { SoundDebugService } from '../debug/sound-debug.service';
import { DebugWindowService } from '../debug/debug-window.service';
import { EnemyDebugService } from '../debug/enemy-debug.service';
import { WaveDirector } from '../../director/wave-director';
import { waveDirectorStub } from '../../director/wave-director.stub';
import { StateSnapshotService } from '../../director/state-snapshot.service';
import { BotClientService } from '../../bots/bot-client.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { PerformanceProfilerService } from '../debug/performance-profiler.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { UIStore } from '../../store/ui.store';
import { createMainEventBus, type MainEventBus } from '../../sim/client/view-events';
import { SimClient } from '../../sim/client/sim-client.service';
import { SimMirror } from '../../sim/client/mirror/sim-mirror';
import { MainWorldService } from '../world/main-world.service';
import { GlobalRouteGridService } from '../world/global-route-grid.service';
import { RouteGridVizService } from '../world/route-grid-viz.service';
import { TowerSelectionService } from '../tower-selection.service';
import { PresentationService } from '../../presentation/presentation.service';
import { GameStore } from '../../store/game.store';
import { AUTO_WAVE_DELAY_MS } from '../../utils/auto-wave-countdown';
import { ReplayService } from '../replay.service';
import { TowerControlService } from '../tower-control.service';
import type { FacadeComponentBridge } from './tower-defense-facade.service';
import { GameRng } from '../../utils/game-rng';
import { RunLogFacade } from '../../run-log/run-log.facade';
import { COOP } from '../coop.token';
import type { CoopService } from '../coop.service';
import { DEFAULT_ROOM_OPTIONS } from '../../coop/room-options';

/** Injected by the facade but not touched by the auto-start. */
const UNUSED = [
  EngineStore, CameraControlService, TowerPlacementService, MapPlacementService, KeyboardPanService,
  MarkerVisualizationService, RouteAnimationService, IntroCameraFlightService,
  WaveDebugService, SoundDebugService, DebugWindowService, EnemyDebugService,
  StateSnapshotService, PerformanceProfilerService,
  StreetRenderingService, BossIntroService, ReplayService, TowerControlService,
  GlobalRouteGridService, RouteGridVizService, TowerSelectionService, PresentationService, GameStore,
];

/** The simulation's side: its bus, and the mirror's game clock and director stream */
function simProviders(
  bus: MainEventBus,
  clock: { gameTimeMs: number } = { gameTimeMs: 0 },
  configure: (config: unknown) => void = () => undefined,
) {
  return [
    { provide: SimClient, useValue: { bus, started: true, configure } },
    { provide: SimMirror, useValue: { rng: new GameRng(1), get scalars() { return { gameTimeMs: clock.gameTimeMs }; } } },
    { provide: MainWorldService, useValue: { corridorPending: () => false } },
  ];
}

const WAVE_DONE = { type: 'wave:completed', wave: 3, credits: 0, perfect: true, closeCall: false, hpLost: 0 } as const;

describe('GameLoopFacadeService: auto-start of the next wave', () => {
  let facade: GameLoopFacadeService;
  let bus: MainEventBus;
  let clock: { gameTimeMs: number };
  let startWave: ReturnType<typeof vi.spyOn>;
  let resetDirector: ReturnType<typeof vi.fn<() => void>>;
  let configure: ReturnType<typeof vi.fn<(config: unknown) => void>>;
  let sourceId: string;
  const autoStartWaves = signal(true);
  const botEnabled = signal(false);
  const store = {
    phase: signal<string>('setup'),
    waveNumber: signal(3),
    autoWaveSecondsLeft: signal<number | null>(null),
  };

  beforeEach(() => {
    bus = createMainEventBus();
    clock = { gameTimeMs: 50_000 };
    resetDirector = vi.fn<() => void>();
    configure = vi.fn<(config: unknown) => void>();
    sourceId = 'budget';
    autoStartWaves.set(true);
    botEnabled.set(false);
    store.phase.set('setup');
    store.autoWaveSecondsLeft.set(null);

    // The source in service is the one the last reset put in
    const director = waveDirectorStub({ resetForNewGame: resetDirector });
    Object.defineProperty(director, 'source', { get: () => ({ id: sourceId }) });
    const injector = Injector.create({
      providers: [
        ...UNUSED.map((token) => ({ provide: token, useValue: {} })),
        ...simProviders(bus, clock, configure),
        { provide: WaveDirector, useValue: director },
        { provide: RunLogFacade, useValue: { tick: () => undefined, collector: { noteDirectorDecision: () => undefined } } },
        { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
        { provide: TowerDefenseStore, useValue: store },
        { provide: UIStore, useValue: { autoStartWaves } },
        { provide: BotClientService, useValue: { botEnabled } },
      ],
    });
    facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    facade.initialize({ getEngine: () => ({}) } as unknown as FacadeComponentBridge);
    facade.subscribeToEventBus({ onGameOverExtra: () => undefined });
    startWave = vi.spyOn(facade, 'startWave').mockImplementation(() => undefined);
  });

  // A location change resets the game without restartGame. The director's
  // per-run correction and a wave source switched in the debug window have to
  // start over there as well (docs/PLAYTEST.md M5).
  it('resets the wave director once when wired (the first run has no game:reset) and on every game reset', () => {
    expect(resetDirector).toHaveBeenCalledTimes(1);
    bus.emit({ type: 'game:reset' });
    expect(resetDirector).toHaveBeenCalledTimes(2);
  });

  // The simulation's kill gold, leak damage and completion gold follow the source's rules
  it('hands the simulation the source in service at the start and after every reset', () => {
    expect(configure).toHaveBeenLastCalledWith({ waveSource: 'budget' });
    // Switched in the debug window or by the coop host: in service from the next run
    sourceId = 'table';
    bus.emit({ type: 'game:reset' });
    expect(configure).toHaveBeenLastCalledWith({ waveSource: 'table' });
    expect(configure).toHaveBeenCalledTimes(2);
  });

  it('counts down on the game clock after a wave and starts the next once', () => {
    bus.emit(WAVE_DONE);
    expect(store.autoWaveSecondsLeft()).toBe(AUTO_WAVE_DELAY_MS / 1000);

    clock.gameTimeMs += AUTO_WAVE_DELAY_MS - 1;
    facade.tickAutoWave();
    expect(startWave).not.toHaveBeenCalled();
    expect(store.autoWaveSecondsLeft()).toBe(1);

    clock.gameTimeMs += 1;
    facade.tickAutoWave();
    facade.tickAutoWave();
    expect(startWave).toHaveBeenCalledTimes(1);
    expect(store.autoWaveSecondsLeft()).toBeNull();
  });

  it('stands while the game clock stands (pause)', () => {
    bus.emit(WAVE_DONE);
    clock.gameTimeMs += 4_000;
    for (let i = 0; i < 1000; i++) facade.tickAutoWave();
    expect(startWave).not.toHaveBeenCalled();
    expect(store.autoWaveSecondsLeft()).toBe(6);
  });

  it('a manual start ends the countdown', () => {
    bus.emit(WAVE_DONE);
    bus.emit({ type: 'wave:started', wave: 4, enemyCount: 10 });
    expect(store.autoWaveSecondsLeft()).toBeNull();
    clock.gameTimeMs += AUTO_WAVE_DELAY_MS * 2;
    facade.tickAutoWave();
    expect(startWave).not.toHaveBeenCalled();
  });

  it('game over and a restart end it', () => {
    bus.emit(WAVE_DONE);
    bus.emit({ type: 'game:over', reason: 'base-destroyed' });
    expect(store.autoWaveSecondsLeft()).toBeNull();

    bus.emit(WAVE_DONE);
    bus.emit({ type: 'game:reset' });
    clock.gameTimeMs += AUTO_WAVE_DELAY_MS;
    facade.tickAutoWave();
    expect(startWave).not.toHaveBeenCalled();
  });

  it('does nothing while switched off', () => {
    autoStartWaves.set(false);
    bus.emit(WAVE_DONE);
    clock.gameTimeMs += AUTO_WAVE_DELAY_MS;
    facade.tickAutoWave();
    expect(store.autoWaveSecondsLeft()).toBeNull();
    expect(startWave).not.toHaveBeenCalled();
  });

  it('leaves the waves to a bot that plays', () => {
    botEnabled.set(true);
    bus.emit(WAVE_DONE);
    clock.gameTimeMs += AUTO_WAVE_DELAY_MS;
    facade.tickAutoWave();
    expect(startWave).not.toHaveBeenCalled();
  });
});

describe('GameLoopFacadeService: restart after the coop connection broke (TODO E40)', () => {
  it('goes on alone first, then restarts as a single player game', () => {
    const bus = createMainEventBus();
    const lost = signal(true);
    const continueAlone = vi.fn(() => lost.set(false));
    const coop = { lostInGame: lost, inGame: () => false, isHost: () => false, continueAlone, setWaveStarter: () => undefined };
    const injector = Injector.create({
      providers: [
        ...UNUSED.map((token) => ({ provide: token, useValue: {} })),
        ...simProviders(bus),
        { provide: WaveDirector, useValue: waveDirectorStub() },
        { provide: RunLogFacade, useValue: { tick: () => undefined, collector: { noteDirectorDecision: () => undefined } } },
        { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
        { provide: TowerDefenseStore, useValue: { phase: signal('setup'), waveNumber: signal(1), autoWaveSecondsLeft: signal(null) } },
        { provide: UIStore, useValue: { autoStartWaves: signal(false) } },
        { provide: BotClientService, useValue: { botEnabled: signal(false), resetBot: () => undefined } },
        { provide: COOP, useValue: coop as unknown as CoopService },
      ],
    });
    const facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    facade.initialize({ getEngine: () => ({}) } as unknown as FacadeComponentBridge);

    const restarts: unknown[] = [];
    bus.on('command:restart-game', (event) => restarts.push(event));
    facade.restartGame(() => undefined);

    expect(continueAlone).toHaveBeenCalledTimes(1);
    expect(restarts).toEqual([{ type: 'command:restart-game' }]);
  });
});

describe('GameLoopFacadeService: restart with a given seed', () => {
  // A bot run's config names the seed of the next run (bot-server); the
  // simulation takes it with the restart command
  it('hands the seed of the single player game on to the simulation', () => {
    const bus = createMainEventBus();
    const injector = Injector.create({
      providers: [
        ...UNUSED.map((token) => ({ provide: token, useValue: {} })),
        ...simProviders(bus),
        { provide: WaveDirector, useValue: waveDirectorStub() },
        { provide: RunLogFacade, useValue: { tick: () => undefined, collector: { noteDirectorDecision: () => undefined } } },
        { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
        { provide: TowerDefenseStore, useValue: { phase: signal('setup'), waveNumber: signal(1), autoWaveSecondsLeft: signal(null) } },
        { provide: UIStore, useValue: { autoStartWaves: signal(false) } },
        { provide: BotClientService, useValue: { botEnabled: signal(false), resetBot: () => undefined } },
      ],
    });
    const facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    facade.initialize({ getEngine: () => ({}) } as unknown as FacadeComponentBridge);

    const restarts: unknown[] = [];
    bus.on('command:restart-game', (event) => restarts.push(event));
    facade.restartGame(() => undefined, 4242);
    facade.restartGame(() => undefined);

    expect(restarts).toEqual([{ type: 'command:restart-game', seed: 4242 }, { type: 'command:restart-game' }]);
  });
});

describe('GameLoopFacadeService: the bot\'s wave button in coop', () => {
  it('says ready every time and never takes it back, where the button toggles', () => {
    const bus = createMainEventBus();
    const sayReady = vi.fn();
    const toggleReady = vi.fn();
    const coop = {
      lostInGame: signal(false), inGame: () => true, isHost: () => false, options: () => DEFAULT_ROOM_OPTIONS,
      sayReady, toggleReady, setWaveStarter: () => undefined,
    };
    const injector = Injector.create({
      providers: [
        ...UNUSED.map((token) => ({ provide: token, useValue: {} })),
        ...simProviders(bus),
        { provide: WaveDirector, useValue: waveDirectorStub() },
        { provide: RunLogFacade, useValue: { tick: () => undefined, collector: { noteDirectorDecision: () => undefined } } },
        { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
        { provide: TowerDefenseStore, useValue: { phase: signal('setup'), waveNumber: signal(1), autoWaveSecondsLeft: signal(null) } },
        { provide: UIStore, useValue: { autoStartWaves: signal(false) } },
        { provide: BotClientService, useValue: { botEnabled: signal(true), resetBot: () => undefined } },
        { provide: COOP, useValue: coop as unknown as CoopService },
      ],
    });
    const facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    facade.initialize({ getEngine: () => ({}) } as unknown as FacadeComponentBridge);

    // Two decisions before the first ready came back from the relay
    facade.readyOrStartWave();
    facade.readyOrStartWave();

    expect(sayReady).toHaveBeenCalledTimes(2);
    expect(toggleReady).not.toHaveBeenCalled();
  });
});
