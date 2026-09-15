import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core';

// Only its DI token is needed; the real module pulls in the game state manager.
vi.mock('../boss-intro.service', () => ({ BossIntroService: class BossIntroService {} }));
import { BossIntroService } from '../boss-intro.service';
// Only its DI token is needed; the real module pulls in services that need the JIT compiler
vi.mock('../replay.service', () => ({ ReplayService: class ReplayService {} }));

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
import { WaveDirectorService } from '../../ai/core/wave-director.service';
import { AIDataCollectorService } from '../../ai/core/ai-data-collector.service';
import { TrainingClientService } from '../../ai/training/training-client.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { PerformanceProfilerService } from '../debug/performance-profiler.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { UIStore } from '../../store/ui.store';
import { ReplayService } from '../replay.service';
import type { FacadeComponentBridge } from './tower-defense-facade.service';
import type { GameStateManager } from '../../managers/game-state.manager';
import type { WaveConfig } from '../../ai/core/models/wave-config';
import type { DecisionExplanation } from '../../ai/core/decision-explainer';

/**
 * The store path of the director's explanation. The facade is the only writer
 * of `aiExplanation` and the wave debug window only reads it, so a director
 * wave has to land there and every wave the director did not plan has to
 * clear it; otherwise the window keeps explaining a wave that is not running.
 */

const EXPLANATION: DecisionExplanation = {
  summary: 'Wave 1: Zombie Horde · 20 enemies · HP ×0.50',
  reasons: ['Curriculum: wave 1 is always Zombie Horde (waves 1-30 are fixed).'],
};

function wave(explanation?: DecisionExplanation): WaveConfig {
  return { enemies: [{ type: 'zombie', count: 20 }], totalCount: 20, spawnDelay: 400, explanation };
}

function makeStore() {
  return {
    phase: signal('setup'),
    spawnPoints: signal([{}]),
    waveNumber: signal(0),
    useStaticCurriculum: signal(false),
    useAIDirector: signal(true),
    aiExplanation: signal<DecisionExplanation | null>(null),
    aiError: signal<string | null>(null),
    paused: signal(false),
  };
}

/** Injected by the facade but not touched by the wave-start paths. */
const UNUSED = [
  EngineStore, CameraControlService, TowerPlacementService, MapPlacementService, KeyboardPanService,
  MarkerVisualizationService, RouteAnimationService, IntroCameraFlightService,
  SoundDebugService, DebugWindowService, EnemyDebugService, NgZone,
  PerformanceProfilerService, StreetRenderingService, UIStore, BossIntroService, ReplayService,
];

describe('GameLoopFacadeService: aiExplanation', () => {
  let facade: GameLoopFacadeService;
  let store: ReturnType<typeof makeStore>;
  let connected: boolean;
  let emitted: { type: string }[];
  const director = { getNextWave: vi.fn(async () => wave(EXPLANATION)) };
  const backend = {
    isConnected: () => connected,
    requestWaveConfig: vi.fn(async () => wave()),
  };
  const collector = { getStateSnapshot: () => ({}), setCurrentWaveConfig: vi.fn() };
  /** Enemy types of the wave the facade started */
  const startedTypes = () =>
    (emitted as unknown as { config: { schedule: { entries: { enemyType: string }[] } } }[])[0]
      .config.schedule.entries.map((e) => e.enemyType);

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    connected = false;
    emitted = [];
    store = makeStore();
    const injector = Injector.create({
      providers: [
        ...UNUSED.map((token) => ({ provide: token, useValue: {} })),
        { provide: TowerDefenseStore, useValue: store },
        { provide: WaveDirectorService, useValue: director },
        { provide: TrainingClientService, useValue: backend },
        { provide: AIDataCollectorService, useValue: collector },
        { provide: WaveDebugService, useValue: { toAIWaveConfig: () => wave() } },
      ],
    });
    facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    facade.initialize(
      { getEngine: () => ({}) } as unknown as FacadeComponentBridge,
      { getEventBus: () => ({ emit: (e: { type: string }) => emitted.push(e) }), corridorPending: () => false } as unknown as GameStateManager,
    );
  });

  it('puts the explanation of a director wave into the store', async () => {
    facade.startWave();
    await settle();
    expect(store.aiExplanation()).toBe(EXPLANATION);
    expect(emitted.map((e) => e.type)).toEqual(['command:start-wave']);
  });

  it('clears it for a custom wave from the debug window', () => {
    store.aiExplanation.set(EXPLANATION);
    facade.startCustomWave();
    expect(store.aiExplanation()).toBeNull();
  });

  it('clears it for a static-curriculum wave', () => {
    store.aiExplanation.set(EXPLANATION);
    store.useStaticCurriculum.set(true);
    facade.startWave();
    expect(store.aiExplanation()).toBeNull();
  });

  it('clears it for a manual wave with the director off', () => {
    store.aiExplanation.set(EXPLANATION);
    store.useAIDirector.set(false);
    facade.startWave();
    expect(store.aiExplanation()).toBeNull();
  });

  it('clears it when the training backend plans the wave', async () => {
    // The backend picks the wave over the WebSocket and sends no reasons.
    store.aiExplanation.set(EXPLANATION);
    connected = true;
    facade.startWave();
    await settle();
    expect(backend.requestWaveConfig).toHaveBeenCalled();
    expect(store.aiExplanation()).toBeNull();
  });

  describe('boss rotation past the curriculum', () => {
    it('ships the variant in place of the director wave and explains that (W35: the worm)', async () => {
      store.waveNumber.set(34);
      facade.startWave();
      await settle();
      expect(startedTypes()).toEqual(['worm']);
      expect(store.aiExplanation()?.summary).toContain('Boss: Skarnax');
      expect(collector.setCurrentWaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ templateName: 'Boss: Skarnax' }),
      );
    });

    it('leaves the director its own boss waves', async () => {
      store.waveNumber.set(39);
      facade.startWave();
      await settle();
      expect(startedTypes()).toEqual(Array(20).fill('zombie'));
      expect(store.aiExplanation()).toBe(EXPLANATION);
    });

    it('leaves a training wave alone', async () => {
      connected = true;
      store.waveNumber.set(34);
      facade.startWave();
      await settle();
      expect(startedTypes()).toEqual(Array(20).fill('zombie'));
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
    store.useAIDirector.set(false);
    store.paused.set(true);
    const injector = Injector.create({
      providers: [
        ...UNUSED.map((token) => ({ provide: token, useValue: {} })),
        { provide: TowerDefenseStore, useValue: store },
        { provide: WaveDirectorService, useValue: {} },
        { provide: TrainingClientService, useValue: {} },
        { provide: AIDataCollectorService, useValue: {} },
        { provide: WaveDebugService, useValue: { toAIWaveConfig: () => wave() } },
      ],
    });
    facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    facade.initialize(
      { getEngine: () => ({}) } as unknown as FacadeComponentBridge,
      { getEventBus: () => ({ emit: (e: { type: string }) => emitted.push(e) }), corridorPending: () => false } as unknown as GameStateManager,
    );
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
