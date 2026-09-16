import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed. The real modules pull in the engine, and
// the partially compiled CDK needs the JIT compiler under vitest.
vi.mock('@angular/cdk/a11y', () => ({ LiveAnnouncer: class LiveAnnouncer {} }));
vi.mock('../managers/game-state.manager', () => ({ GameStateManager: class GameStateManager {} }));
vi.mock('../store/game.store', () => ({ GameStore: class GameStore {} }));
vi.mock('../store/tower-defense.store', () => ({ TowerDefenseStore: class TowerDefenseStore {} }));
vi.mock('../store/ui.store', () => ({ UIStore: class UIStore {} }));
vi.mock('./tower-placement.service', () => ({ TowerPlacementService: class TowerPlacementService {} }));
vi.mock('./world/map-placement.service', () => ({ MapPlacementService: class MapPlacementService {} }));
vi.mock('./ability-targeting.service', () => ({ AbilityTargetingService: class AbilityTargetingService {} }));
vi.mock('./camera-control.service', () => ({ CameraControlService: class CameraControlService {} }));
vi.mock('./photo-mode.service', () => ({ PhotoModeService: class PhotoModeService {} }));
vi.mock('./hero-control.service', () => ({ HeroControlService: class HeroControlService {} }));
vi.mock('./boss-intro.service', () => ({ BossIntroService: class BossIntroService {} }));
vi.mock('./infrastructure/engine-initialization.service', () => ({
  EngineInitializationService: class EngineInitializationService {},
}));
vi.mock('../replay/replay-bar-view', () => ({ commandMarkers: () => [] }));

// The players the service builds, standing in for the engine-bound ReplayPlayer
const players = vi.hoisted(() => [] as { enter: () => void }[]);
vi.mock('../replay/replay-player', () => ({
  ReplayPlayer: class ReplayPlayer {
    currentMs = 0;
    durationMs = 1000;
    isPlaying = false;
    currentSpeed = 1;
    baseHealth = 100;
    enemiesAlive = 0;
    setSpeed = vi.fn();
    enter = vi.fn();
    exit = vi.fn();
    constructor() {
      players.push(this);
    }
  },
}));

// No change detection here: the recording's effect and the focus after layout stay idle
vi.mock('@angular/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@angular/core')>()),
  effect: () => ({ destroy: () => undefined }),
  afterNextRender: () => undefined,
}));

import { ElementRef, Injector, NgZone, runInInjectionContext, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { ReplayService } from './replay.service';
import { GameStateManager } from '../managers/game-state.manager';
import { GameStore } from '../store/game.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { UIStore } from '../store/ui.store';
import { TowerPlacementService } from './tower-placement.service';
import { MapPlacementService } from './world/map-placement.service';
import { AbilityTargetingService } from './ability-targeting.service';
import { CameraControlService } from './camera-control.service';
import { PhotoModeService } from './photo-mode.service';
import { HeroControlService } from './hero-control.service';
import { BossIntroService } from './boss-intro.service';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';

/**
 * The gate of ReplayService.enter(): a replay starts only with a recorded
 * wave, between waves, and not while a boss intro holds the camera (the
 * intro pauses the game and puts the camera back itself).
 */
describe('ReplayService.enter gate', () => {
  let host: HTMLElement;
  let introActive: ReturnType<typeof signal<boolean>>;
  let recordedWave: ReturnType<typeof signal<number | null>>;
  let phase: ReturnType<typeof signal<string>>;
  let paused: ReturnType<typeof signal<boolean>>;
  let getEngine: ReturnType<typeof vi.fn>;
  let service: ReplayService;

  const pose = () => ({ clone: () => ({}) });

  beforeEach(() => {
    players.length = 0;
    host = document.createElement('div');
    document.body.append(host);
    introActive = signal(false);
    recordedWave = signal<number | null>(3);
    phase = signal('setup');
    paused = signal(false);
    const engine = {
      towerBadges: { setVisible: vi.fn() },
      getCamera: () => ({ position: pose(), quaternion: pose(), up: pose() }),
      getControls: () => null,
    };
    getEngine = vi.fn(() => engine);

    const injector = Injector.create({
      providers: [
        {
          provide: UIStore,
          useValue: { replayMode: signal(false), openMenu: signal(null), mapPlacementMode: signal(false) },
        },
        { provide: TowerDefenseStore, useValue: { loading: signal(false), error: signal(null), phase } },
        { provide: GameStore, useValue: { paused } },
        {
          provide: GameStateManager,
          useValue: {
            replayRecorder: { readyWave: recordedWave, recording: { wave: 3 } },
            paused: signal(false),
            towerManager: { selectTower: vi.fn() },
            heroManager: { presentFrame: vi.fn() },
            getGlobalRouteGrid: () => ({ getGroundLocalYAt: () => 0 }),
          },
        },
        { provide: TowerPlacementService, useValue: { buildMode: signal(false) } },
        { provide: MapPlacementService, useValue: {} },
        { provide: AbilityTargetingService, useValue: { targeting: signal(null) } },
        { provide: CameraControlService, useValue: { cancelJump: vi.fn() } },
        { provide: EngineInitializationService, useValue: { getEngine } },
        { provide: PhotoModeService, useValue: { active: signal(false) } },
        { provide: HeroControlService, useValue: { deselect: vi.fn() } },
        { provide: BossIntroService, useValue: { active: introActive } },
        { provide: LiveAnnouncer, useValue: { announce: vi.fn() } },
        { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
        { provide: ElementRef, useValue: new ElementRef(host) },
      ],
    });
    service = runInInjectionContext(injector, () => new ReplayService());
  });

  afterEach(() => {
    host.remove();
  });

  it('does not start while a boss intro holds the camera', () => {
    introActive.set(true);
    expect(service.available()).toBe(true);

    service.enter();

    expect(service.active()).toBe(false);
    expect(getEngine).not.toHaveBeenCalled();
    expect(players).toHaveLength(0);
    expect(paused()).toBe(false);
  });

  it('starts once the intro is over, pausing the live game', () => {
    introActive.set(true);
    service.enter();
    introActive.set(false);

    service.enter();

    expect(service.active()).toBe(true);
    expect(players).toHaveLength(1);
    expect(players[0].enter).toHaveBeenCalled();
    expect(paused()).toBe(true);
  });

  it('offers the player no button while REPLAY_CONFIG.offered is off, and starts from code still', () => {
    expect(service.available()).toBe(true);
    expect(service.offered()).toBe(false);

    service.enter();
    expect(service.active()).toBe(true);
  });

  it('does not start without a recorded wave or during a wave', () => {
    recordedWave.set(null);
    service.enter();
    recordedWave.set(3);
    phase.set('wave');
    service.enter();

    expect(service.active()).toBe(false);
    expect(players).toHaveLength(0);
  });
});
