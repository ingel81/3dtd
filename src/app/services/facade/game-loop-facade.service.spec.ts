import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { ReplayService } from '../replay.service';
import { TowerControlService } from '../tower-control.service';
import type { FacadeComponentBridge } from './tower-defense-facade.service';
import { SimClient } from '../../sim/client/sim-client.service';
import { SimMirror } from '../../sim/client/mirror/sim-mirror';
import { MainWorldService } from '../world/main-world.service';
import { GlobalRouteGridService } from '../world/global-route-grid.service';
import { RouteGridVizService } from '../world/route-grid-viz.service';
import { TowerSelectionService } from '../tower-selection.service';
import { PresentationService } from '../../presentation/presentation.service';
import { GameStore } from '../../store/game.store';
import type { WaveConfig } from '../../director/models/wave-config';
import { adaptDirectorWave } from '../../director/wave-config-adapter';
import type { DecisionExplanation } from '../../director/wave-explanation';
import type { PlannedWave } from '../../director/wave-source';
import { GameRng } from '../../utils/game-rng';
import { RunLogFacade } from '../../run-log/run-log.facade';
import { createMainEventBus, type MainEventBus } from '../../sim/client/view-events';

/**
 * The store path of the director's explanation. The facade is the only writer
 * of `waveExplanation` and the wave debug window only reads it, so a director
 * wave has to land there and every wave the director did not plan has to
 * clear it; otherwise the window keeps explaining a wave that is not running.
 */

const EXPLANATION: DecisionExplanation = {
  summary: 'Wave 1: Zombie Horde | 20 enemies | HP ×0.50',
  reasons: ['Campaign: wave 1 is always Zombie Horde (waves 1-30 are fixed).'],
};

function wave(explanation?: DecisionExplanation): WaveConfig {
  return { enemies: [{ type: 'zombie', count: 20 }], totalCount: 20, spawnDelay: 400, explanation };
}

/** What a source hands back: the wave plus what the run log gets. */
function planned(waveNumber: number, config = wave(EXPLANATION)): PlannedWave {
  return { wave: waveNumber, config, explanation: config.explanation ?? null, log: {} };
}

function makeStore() {
  return {
    phase: signal('setup'),
    spawnPoints: signal([{}]),
    waveNumber: signal(0),
    directorEnabled: signal(true),
    waveExplanation: signal<DecisionExplanation | null>(null),
    paused: signal(false),
  };
}

/** Injected by the facade but not touched by the wave-start paths. */
const UNUSED = [
  EngineStore, CameraControlService, TowerPlacementService, MapPlacementService, KeyboardPanService,
  MarkerVisualizationService, RouteAnimationService, IntroCameraFlightService,
  SoundDebugService, DebugWindowService, EnemyDebugService, NgZone,
  PerformanceProfilerService, StreetRenderingService, UIStore, BossIntroService, ReplayService, TowerControlService,
  GlobalRouteGridService, RouteGridVizService, TowerSelectionService, PresentationService, GameStore,
];

/** The simulation's side as the facade reaches it: commands go on the bus, the mirror serves the director's stream */
function simProviders(emitted: { type: string }[]) {
  return [
    { provide: SimClient, useValue: { bus: { emit: (e: { type: string }) => emitted.push(e) } } },
    { provide: SimMirror, useValue: { rng: new GameRng(1) } },
    { provide: MainWorldService, useValue: { corridorPending: () => false } },
  ];
}

describe('GameLoopFacadeService: waveExplanation', () => {
  let facade: GameLoopFacadeService;
  let store: ReturnType<typeof makeStore>;
  let emitted: { type: string }[];
  /** Plans a plain zombie wave for whatever wave it is asked for. */
  const director = waveDirectorStub({
    getNextWave: vi.fn(async (waveNumber: number) => planned(waveNumber)),
  });
  const collector = { getStateSnapshot: () => ({}), setCurrentWaveConfig: vi.fn() };
  /** Enemy types of the wave the facade started; its schedule is built where the command acts */
  const startedTypes = () =>
    adaptDirectorWave((emitted as unknown as { director: WaveConfig }[])[0].director)
      .schedule.entries.map((e) => e.enemyType);

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    emitted = [];
    store = makeStore();
    // Restored per test: one of them replaces it to plan a boss wave.
    director.getNextWave = vi.fn(async (waveNumber: number) => planned(waveNumber));
    const injector = Injector.create({
      providers: [
        ...UNUSED.map((token) => ({ provide: token, useValue: {} })),
        ...simProviders(emitted),
        { provide: RunLogFacade, useValue: { tick: () => undefined, collector: { noteDirectorDecision: () => undefined } } },
        { provide: TowerDefenseStore, useValue: store },
        { provide: WaveDirector, useValue: director },
        { provide: BotClientService, useValue: {} },
        { provide: StateSnapshotService, useValue: collector },
        { provide: WaveDebugService, useValue: { toAIWaveConfig: () => wave() } },
      ],
    });
    facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    facade.initialize({ getEngine: () => ({}) } as unknown as FacadeComponentBridge);
  });

  it('puts the explanation of a director wave into the store', async () => {
    facade.startWave();
    await settle();
    expect(store.waveExplanation()).toBe(EXPLANATION);
    expect(emitted.map((e) => e.type)).toEqual(['command:start-wave']);
  });

  it('clears it for a custom wave from the debug window', () => {
    store.waveExplanation.set(EXPLANATION);
    facade.startCustomWave();
    expect(store.waveExplanation()).toBeNull();
  });

  it('sends the custom wave without the spawn floor, a planned wave keeps it', async () => {
    facade.startCustomWave();
    const custom = (emitted as unknown as { director: WaveConfig }[])[0].director;
    expect(custom.spawnFloor).toBe(false);
    expect(adaptDirectorWave(custom).schedule.spawnFloor).toBe(false);

    emitted.length = 0;
    // The start answered, so the next one goes out
    store.phase.set('setup');
    (facade as unknown as { startSentAt: number | null }).startSentAt = null;
    facade.startWave();
    await settle();
    const plannedWave = (emitted as unknown as { director: WaveConfig }[])[0].director;
    expect(plannedWave.spawnFloor).toBeUndefined();
    expect(adaptDirectorWave(plannedWave).schedule.spawnFloor).toBeUndefined();
  });

  it('clears it for a manual wave with the director off', () => {
    store.waveExplanation.set(EXPLANATION);
    store.directorEnabled.set(false);
    facade.startWave();
    expect(store.waveExplanation()).toBeNull();
  });

  /**
   * The facade ships the planned wave and changes nothing about it. Until the
   * wave sources landed it substituted boss variants itself, so "which wave
   * comes next" was decided in two places; the wave is the source's now
   * (WAVE_SOURCE_PLAN.md).
   */
  describe('what the source planned', () => {
    it('ships it unchanged, whatever wave number it is', async () => {
      const bossWave: WaveConfig = {
        enemies: [{ type: 'worm', count: 1 }],
        totalCount: 1,
        spawnDelay: 0,
        templateName: 'Boss: Skarnax',
        explanation: { summary: 'W35: Boss: Skarnax, HP ×1', reasons: [] },
      };
      director.getNextWave = vi.fn(async (waveNumber: number) => planned(waveNumber, bossWave));
      store.waveNumber.set(34);
      facade.startWave();
      await settle();
      expect(startedTypes()).toEqual(['worm']);
      expect(store.waveExplanation()?.summary).toContain('Boss: Skarnax');
    });

    it('does not read the wave number to second-guess a boss wave', async () => {
      // W35 is a boss wave of the rotation. The facade must still ship what
      // it was handed, or the substitution would happen twice.
      store.waveNumber.set(34);
      facade.startWave();
      await settle();
      expect(startedTypes()).toEqual(Array(20).fill('zombie'));
      expect(store.waveExplanation()).toBe(EXPLANATION);
    });

    it('asks for the wave after the counter', async () => {
      store.waveNumber.set(11);
      facade.startWave();
      await settle();
      expect(director.getNextWave).toHaveBeenCalledWith(12);
    });
  });
});

/**
 * A wave start lifts the pause. The start button, the hotkey and the
 * auto-start all go through startWave(), the debug window through
 * startCustomWave().
 */
describe('GameLoopFacadeService: pause', () => {
  let facade: GameLoopFacadeService;
  let store: ReturnType<typeof makeStore>;
  let emitted: { type: string }[];

  beforeEach(() => {
    emitted = [];
    store = makeStore();
    store.directorEnabled.set(false);
    store.paused.set(true);
    const injector = Injector.create({
      providers: [
        ...UNUSED.map((token) => ({ provide: token, useValue: {} })),
        ...simProviders(emitted),
        { provide: RunLogFacade, useValue: { tick: () => undefined, collector: { noteDirectorDecision: () => undefined } } },
        { provide: TowerDefenseStore, useValue: store },
        { provide: WaveDirector, useValue: waveDirectorStub() },
        { provide: BotClientService, useValue: {} },
        { provide: StateSnapshotService, useValue: {} },
        { provide: WaveDebugService, useValue: { toAIWaveConfig: () => wave() } },
      ],
    });
    facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    facade.initialize({ getEngine: () => ({}) } as unknown as FacadeComponentBridge);
  });

  it('is lifted by a wave start', () => {
    facade.startWave();
    expect(store.paused()).toBe(false);
    expect(emitted.map((e) => e.type)).toEqual(['command:start-wave']);
  });

  it('is lifted by a custom wave from the debug window', () => {
    facade.startCustomWave();
    expect(store.paused()).toBe(false);
  });

  it('stays while no wave can start', () => {
    store.phase.set('wave');
    facade.startWave();
    facade.startCustomWave();
    expect(store.paused()).toBe(true);
    expect(emitted).toEqual([]);
  });
});

/**
 * The store's phase follows a start only with the packet that brings
 * wave:started, a frame or two after the command (in coop the relay's round
 * trip). Until then the button, the auto-start or a fast bot must not send a
 * second start.
 */
describe('GameLoopFacadeService: one start until the simulation answers', () => {
  let facade: GameLoopFacadeService;
  let store: ReturnType<typeof makeStore>;
  let bus: MainEventBus;
  let starts: number;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance'] });
    store = makeStore();
    store.directorEnabled.set(false);
    bus = createMainEventBus();
    starts = 0;
    bus.on('command:start-wave', () => starts++);
    const injector = Injector.create({
      providers: [
        ...UNUSED.map((token) => ({ provide: token, useValue: {} })),
        { provide: SimClient, useValue: { bus, started: true, configure: () => undefined } },
        { provide: SimMirror, useValue: { rng: new GameRng(1) } },
        { provide: MainWorldService, useValue: { corridorPending: () => false } },
        { provide: RunLogFacade, useValue: { tick: () => undefined, collector: { noteDirectorDecision: () => undefined } } },
        { provide: TowerDefenseStore, useValue: store },
        { provide: WaveDirector, useValue: waveDirectorStub() },
        { provide: BotClientService, useValue: {} },
        { provide: StateSnapshotService, useValue: {} },
        { provide: WaveDebugService, useValue: { toAIWaveConfig: () => wave() } },
      ],
    });
    facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    facade.initialize({ getEngine: () => ({}) } as unknown as FacadeComponentBridge);
    facade.subscribeToEventBus({ onGameOverExtra: () => undefined });
  });

  afterEach(() => vi.useRealTimers());

  it('sends one start while the phase still says setup, the next after the wave', () => {
    facade.startWave();
    facade.readyOrStartWave();
    facade.startCustomWave();
    expect(starts).toBe(1);

    bus.emit({ type: 'wave:started', wave: 1, enemyCount: 20 });
    bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
    facade.startWave();
    expect(starts).toBe(2);
  });

  it('a new run lets the start go again', () => {
    facade.startWave();
    bus.emit({ type: 'game:reset' });
    facade.startWave();
    expect(starts).toBe(2);
  });

  it('a start the simulation dropped without a word holds the button only a while', () => {
    facade.startWave();
    vi.advanceTimersByTime(1000);
    facade.startWave();
    expect(starts).toBe(1);
    vi.advanceTimersByTime(1500);
    facade.startWave();
    expect(starts).toBe(2);
  });
});
