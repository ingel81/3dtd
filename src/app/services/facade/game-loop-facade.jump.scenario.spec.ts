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
import { bossVariantForWave, bossVariantWave } from '../../configs/boss-variants.config';
import { StateSnapshotService } from '../../director/state-snapshot.service';
import { BotClientService } from '../../bots/bot-client.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { ResearchStore } from '../../store/research.store';
import { PerformanceProfilerService } from '../debug/performance-profiler.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { UIStore } from '../../store/ui.store';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { waveButtonView } from '../../components/game-sidebar/wave-panel/wave-button';
import type { FacadeComponentBridge } from './tower-defense-facade.service';
import type { GameStateManager } from '../../managers/game-state.manager';
import type { WaveConfig } from '../../director/models/wave-config';
import { GameRng } from '../../utils/game-rng';
import { RunLogFacade } from '../../run-log/run-log.facade';

/** Injected by the facade but not touched by the wave-start path. */
const UNUSED = [
  EngineStore, CameraControlService, TowerPlacementService, MapPlacementService, KeyboardPanService,
  MarkerVisualizationService, RouteAnimationService, IntroCameraFlightService,
  SoundDebugService, DebugWindowService, EnemyDebugService, NgZone,
  PerformanceProfilerService, StreetRenderingService, UIStore, BossIntroService, ReplayService, TowerControlService,
];

/** The director's plan for a boss wave past the campaign */
const DIRECTED: WaveConfig = {
  enemies: [{ type: 'stone-golem', count: 24, healthMultiplier: 3.5 }],
  totalCount: 24,
  spawnDelay: 300,
  templateName: 'Boss: Stone Golem',
  templateStrength: 3.5,
  explanation: { summary: 'Director: Boss: Stone Golem', reasons: ['Boss wave past W30.'] },
};

/**
 * Playtest 357, 365, 379 and 380 (docs/archive/REVIEW_SPRINT_2026-09-14.md)
 * replayed after the dev jump: the `wave:jumped` event GameStateManager
 * sends (game-state.manager.spec.ts) goes through the real
 * GameStateSyncService into the store, and the real GameLoopFacadeService
 * starts the next wave from it. The director is a stub that plans a boss wave
 * and applies the boss rotation to it, as the adaptive source does. The wave
 * button reads the store as the WAVE panel does.
 */
describe('Wave start after a jump, playtest 357, 365, 379 and 380 replayed', () => {
  let bus: GameEventBus;
  let facade: GameLoopFacadeService;
  let started: WaveConfig[];
  const store = {
    phase: signal<'setup' | 'wave' | 'gameover'>('setup'),
    spawnPoints: signal([{}]),
    waveNumber: signal(0),
    directorEnabled: signal(true),
    waveExplanation: signal<WaveConfig['explanation'] | null>(null),
    directorError: signal<string | null>(null),
    paused: signal(false),
    enemiesAlive: signal(0),
    waveEnemyTotal: signal(0),
    waveEnemiesLeft: signal(0),
  };
  /**
   * Stands in for the adaptive source: it plans `DIRECTED` and applies the
   * boss rotation to it, which is what the source does inside `plan()`. The
   * facade must not do it, or the substitution would happen twice.
   */
  const director = waveDirectorStub({
    getNextWave: vi.fn(async (wave: number) => {
      const variant = bossVariantForWave(wave);
      const config = variant ? bossVariantWave(variant, DIRECTED, wave) : DIRECTED;
      return { wave, config, explanation: config.explanation ?? null, log: {} };
    }),
  });
  const collector = { getStateSnapshot: () => ({}), setCurrentWaveConfig: vi.fn() };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** Enemy types of the last wave the facade started */
  const startedTypes = () =>
    (started[started.length - 1] as unknown as { schedule: { entries: { enemyType: string }[] } })
      .schedule.entries.map((e) => e.enemyType);
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
    bus = new GameEventBus();
    started = [];
    bus.on('command:start-wave', (e) => started.push(e.config as unknown as WaveConfig));
    store.phase.set('setup');
    store.waveNumber.set(0);
    store.waveExplanation.set(null);
    const injector = Injector.create({
      providers: [
        ...UNUSED.map((token) => ({ provide: token, useValue: {} })),
        { provide: RunLogFacade, useValue: { tick: () => undefined, collector: { noteDirectorDecision: () => undefined } } },
        { provide: TowerDefenseStore, useValue: store },
        { provide: ResearchStore, useValue: {} },
        { provide: WaveDirector, useValue: director },
        { provide: BotClientService, useValue: { isConnected: () => false } },
        { provide: StateSnapshotService, useValue: collector },
        { provide: WaveDebugService, useValue: {} },
      ],
    });
    runInInjectionContext(injector, () => new GameStateSyncService()).initialize(bus);
    facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    facade.initialize(
      { getEngine: () => ({}) } as unknown as FacadeComponentBridge,
      { getEventBus: () => bus, corridorPending: () => false, rng: new GameRng(1) } as unknown as GameStateManager,
    );
  });

  it('379 and 357: after the jump to 35 the button shows Wave 35, Space starts the worm, "Why this wave" names the replaced boss', async () => {
    jump(0, 35);
    expect(store.waveNumber()).toBe(34);
    expect(buttonLabel()).toBe('Wave 35');

    facade.startWave();
    await settle();
    expect(startedTypes()).toEqual(['worm']);
    expect(store.waveExplanation()?.summary).toBe('W35: Boss: Skarnax, HP ×3.5');
    expect(store.waveExplanation()?.reasons[0]).toContain("in place of the director's Boss: Stone Golem");

    // The header reads the store's wave
    bus.emit({ type: 'wave:started', wave: 35, enemyCount: 1 });
    expect(store.waveNumber()).toBe(35);
    expect(store.phase()).toBe('wave');
  });

  it('357: W40 stays the director\'s boss wave', async () => {
    jump(0, 35);
    playWave(35);
    jump(35, 40);
    expect(buttonLabel()).toBe('Wave 40');
    facade.startWave();
    await settle();
    expect(startedTypes()).toEqual(Array(24).fill('stone-golem'));
    expect(store.waveExplanation()).toBe(DIRECTED.explanation);
  });

  it('365 and 380: after W35 a jump to 45 starts the ooze wave', async () => {
    jump(0, 35);
    playWave(35);
    jump(35, 45);
    expect(buttonLabel()).toBe('Wave 45');

    facade.startWave();
    await settle();
    expect(startedTypes()).toEqual(['ooze']);
    expect(store.waveExplanation()?.summary).toBe('W45: Boss: Ooze, HP ×3.5');
  });
});
