import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core';

import { GameLoopFacadeService } from './game-loop-facade.service';
import { EngineStore } from '../../store/engine.store';
import { CameraControlService } from '../camera-control.service';
import { TowerPlacementService } from '../tower-placement.service';
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
  };
}

/** Injected by the facade but not touched by the wave-start paths. */
const UNUSED = [
  EngineStore, CameraControlService, TowerPlacementService, KeyboardPanService,
  MarkerVisualizationService, RouteAnimationService, IntroCameraFlightService,
  SoundDebugService, DebugWindowService, EnemyDebugService, NgZone,
  PerformanceProfilerService, StreetRenderingService, UIStore,
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
        { provide: AIDataCollectorService, useValue: { getStateSnapshot: () => ({}) } },
        { provide: WaveDebugService, useValue: { toAIWaveConfig: () => wave() } },
      ],
    });
    facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    facade.initialize(
      { getEngine: () => ({}) } as unknown as FacadeComponentBridge,
      { getEventBus: () => ({ emit: (e: { type: string }) => emitted.push(e) }) } as unknown as GameStateManager,
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
});
