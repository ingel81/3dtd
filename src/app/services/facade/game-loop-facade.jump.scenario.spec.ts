import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core';

// Only their DI tokens are needed; the real modules pull in the game state manager
vi.mock('../boss-intro.service', () => ({ BossIntroService: class BossIntroService {} }));
vi.mock('../replay.service', () => ({ ReplayService: class ReplayService {} }));
vi.mock('../tower-control.service', () => ({ TowerControlService: class TowerControlService {} }));

import { GameLoopFacadeService } from './game-loop-facade.service';
import { GameStateSyncService } from '../infrastructure/game-state-sync.service';
import { BossIntroService } from '../boss-intro.service';
import { ReplayService } from '../replay.service';
import { TowerControlService } from '../tower-control.service';
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
import { BudgetWaveSource } from '../../director/sources/budget/budget-source';
import { createEmptySnapshot } from '../../director/models/game-state-snapshot';
import { StateSnapshotService } from '../../director/state-snapshot.service';
import { BotClientService } from '../../bots/bot-client.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { ResearchStore } from '../../store/research.store';
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
import { waveButtonView } from '../../components/game-sidebar/wave-panel/wave-button';
import type { FacadeComponentBridge } from './tower-defense-facade.service';
import type { WaveConfig } from '../../director/models/wave-config';
import { adaptDirectorWave } from '../../director/wave-config-adapter';
import { GameRng } from '../../utils/game-rng';
import { RunLogFacade } from '../../run-log/run-log.facade';

/** Injected by the facade but not touched by the wave-start path. */
const UNUSED = [
  EngineStore, CameraControlService, TowerPlacementService, MapPlacementService, KeyboardPanService,
  MarkerVisualizationService, RouteAnimationService, IntroCameraFlightService,
  SoundDebugService, DebugWindowService, EnemyDebugService, NgZone,
  PerformanceProfilerService, StreetRenderingService, UIStore, BossIntroService, ReplayService, TowerControlService,
  GlobalRouteGridService, RouteGridVizService, TowerSelectionService, PresentationService, GameStore,
];

/**
 * Playtest 357, 365, 379 and 380 (docs/archive/REVIEW_SPRINT_2026-09-14.md)
 * replayed after the dev jump: the `wave:jumped` event the simulation
 * sends (game-state.manager.spec.ts) goes over the main bus through the real
 * GameStateSyncService into the store, and the real GameLoopFacadeService
 * starts the next wave from it. The director is a stub around the budget
 * source, so the wave that starts is the run plan's row for that number. The
 * wave button reads the store as the WAVE panel does.
 */
describe('Wave start after a jump, playtest 357, 365, 379 and 380 replayed', () => {
  let bus: MainEventBus;
  let facade: GameLoopFacadeService;
  let started: WaveConfig[];
  const store = {
    phase: signal<'setup' | 'wave' | 'gameover'>('setup'),
    spawnPoints: signal([{}]),
    waveNumber: signal(0),
    directorEnabled: signal(true),
    waveExplanation: signal<WaveConfig['explanation'] | null>(null),
    paused: signal(false),
    enemiesAlive: signal(0),
    waveEnemyTotal: signal(0),
    waveEnemiesLeft: signal(0),
  };
  /** Plans with the budget source against an empty defense, whatever wave the facade asks for. */
  const director = waveDirectorStub({
    getNextWave: vi.fn(async (wave: number) => {
      const state = createEmptySnapshot();
      state.waveNumber = wave - 1;
      return new BudgetWaveSource().plan({ wave, state, random: () => 0.5 });
    }),
  });
  const collector = { getStateSnapshot: () => ({}), setCurrentWaveConfig: vi.fn() };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** Enemy types of the last wave the facade started; its schedule is built where the command acts */
  const startedTypes = () =>
    adaptDirectorWave(started[started.length - 1]).schedule.entries.map((e) => e.enemyType);
  /** SidebarWavePanelComponent.waveButton between waves: the upcoming wave */
  const buttonLabel = () => waveButtonView(store.waveNumber() + 1, false, 0, 0).label;
  const jump = (from: number, wave: number) =>
    bus.emit({ type: 'wave:jumped', from, wave, skipped: wave - 1 - from, credits: 0 });
  /** What WaveManager and the sync do around one wave */
  const playWave = (wave: number) => {
    bus.emit({ type: 'wave:started', wave, enemyCount: 1 });
    bus.emit({ type: 'wave:completed', wave, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
  };

  beforeEach(() => {
    bus = createMainEventBus();
    started = [];
    bus.on('command:start-wave', (e) => started.push(e.director! as WaveConfig));
    store.phase.set('setup');
    store.waveNumber.set(0);
    store.waveExplanation.set(null);
    const injector = Injector.create({
      providers: [
        ...UNUSED.map((token) => ({ provide: token, useValue: {} })),
        { provide: SimClient, useValue: { bus } },
        { provide: SimMirror, useValue: { rng: new GameRng(1), localPlayerId: 'local', scalars: { gameTimeMs: 0 } } },
        { provide: MainWorldService, useValue: { corridorPending: () => false } },
        { provide: RunLogFacade, useValue: { tick: () => undefined, collector: { noteDirectorDecision: () => undefined } } },
        { provide: TowerDefenseStore, useValue: store },
        { provide: ResearchStore, useValue: {} },
        { provide: WaveDirector, useValue: director },
        { provide: BotClientService, useValue: { isConnected: () => false } },
        { provide: StateSnapshotService, useValue: collector },
        { provide: WaveDebugService, useValue: {} },
      ],
    });
    runInInjectionContext(injector, () => new GameStateSyncService()).initialize();
    facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    facade.initialize({ getEngine: () => ({}) } as unknown as FacadeComponentBridge);
  });

  it('379 and 357: after the jump to 30 the button shows Wave 30, Space starts the worm, "Why this wave" names it', async () => {
    jump(0, 30);
    expect(store.waveNumber()).toBe(29);
    expect(buttonLabel()).toBe('Wave 30');

    facade.startWave();
    await settle();
    expect(startedTypes()).toEqual(['worm']);
    expect(store.waveExplanation()?.summary).toMatch(/^Wave 30: Boss: Skarnax · 1 enemies · HP ×[\d.]+$/);

    // The header reads the store's wave
    bus.emit({ type: 'wave:started', wave: 30, enemyCount: 1 });
    expect(store.waveNumber()).toBe(30);
    expect(store.phase()).toBe('wave');
  });

  it('357: W40 is the run plan\'s golem boss wave', async () => {
    jump(0, 30);
    playWave(30);
    jump(30, 40);
    expect(buttonLabel()).toBe('Wave 40');
    facade.startWave();
    await settle();
    expect(new Set(startedTypes())).toEqual(new Set(['golem-king', 'stone-golem', 'mammoth']));
    expect(store.waveExplanation()?.summary).toMatch(/^Wave 40: Boss: Golem King/);
  });

  it('365 and 380: after W30 a jump to 60 starts the worm again', async () => {
    jump(0, 30);
    playWave(30);
    jump(30, 60);
    expect(buttonLabel()).toBe('Wave 60');

    facade.startWave();
    await settle();
    expect(startedTypes()).toEqual(['worm']);
    expect(store.waveExplanation()?.summary).toMatch(/^Wave 60: Boss: Skarnax/);
  });
});
