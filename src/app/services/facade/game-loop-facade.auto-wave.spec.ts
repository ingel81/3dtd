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
import { WaveDirector } from '../../director/wave-director';
import { StateSnapshotService } from '../../director/state-snapshot.service';
import { BotClientService } from '../../bots/bot-client.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { PerformanceProfilerService } from '../debug/performance-profiler.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { UIStore } from '../../store/ui.store';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { AUTO_WAVE_DELAY_MS } from '../../utils/auto-wave-countdown';
import { ReplayService } from '../replay.service';
import type { FacadeComponentBridge } from './tower-defense-facade.service';
import type { GameStateManager } from '../../managers/game-state.manager';
import { GameRng } from '../../utils/game-rng';
import { RunLogFacade } from '../../run-log/run-log.facade';

/** Injected by the facade but not touched by the auto-start. */
const UNUSED = [
  EngineStore, CameraControlService, TowerPlacementService, MapPlacementService, KeyboardPanService,
  MarkerVisualizationService, RouteAnimationService, IntroCameraFlightService,
  WaveDebugService, SoundDebugService, DebugWindowService, EnemyDebugService,
  WaveDirector, StateSnapshotService, PerformanceProfilerService,
  StreetRenderingService, BossIntroService, ReplayService,
];

const WAVE_DONE = { type: 'wave:completed', wave: 3, credits: 0, perfect: true, closeCall: false, hpLost: 0 } as const;

describe('GameLoopFacadeService: auto-start of the next wave', () => {
  let facade: GameLoopFacadeService;
  let bus: GameEventBus;
  let clock: { gameTimeMs: number };
  let startWave: ReturnType<typeof vi.spyOn>;
  const autoStartWaves = signal(true);
  const botEnabled = signal(false);
  const store = {
    phase: signal<string>('setup'),
    waveNumber: signal(3),
    autoWaveSecondsLeft: signal<number | null>(null),
  };

  beforeEach(() => {
    bus = new GameEventBus();
    clock = { gameTimeMs: 50_000 };
    autoStartWaves.set(true);
    botEnabled.set(false);
    store.phase.set('setup');
    store.autoWaveSecondsLeft.set(null);

    const injector = Injector.create({
      providers: [
        ...UNUSED.map((token) => ({ provide: token, useValue: {} })),
        { provide: RunLogFacade, useValue: { tick: () => undefined, collector: { noteDirectorDecision: () => undefined } } },
        { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
        { provide: TowerDefenseStore, useValue: store },
        { provide: UIStore, useValue: { autoStartWaves } },
        { provide: BotClientService, useValue: { botEnabled } },
      ],
    });
    facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    const gameState = {
      getEventBus: () => bus,
      get gameTimeMs() { return clock.gameTimeMs; },
      waveManager: { stopSpawning: vi.fn() },
      rng: new GameRng(1),
    };
    facade.initialize({ getEngine: () => ({}) } as unknown as FacadeComponentBridge, gameState as unknown as GameStateManager);
    facade.subscribeToEventBus({ onGameOverExtra: () => undefined });
    startWave = vi.spyOn(facade, 'startWave').mockImplementation(() => undefined);
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
