import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed. The real modules pull in the engine, and
// the partially compiled CDK needs the JIT compiler under vitest.
vi.mock('@angular/cdk/a11y', () => ({ LiveAnnouncer: class LiveAnnouncer {} }));
vi.mock('../sim/client/sim-client.service', () => ({ SimClient: class SimClient {} }));
vi.mock('./tower-selection.service', () => ({ TowerSelectionService: class TowerSelectionService {} }));
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
vi.mock('../director/wave-director', () => ({ WaveDirector: class WaveDirector {} }));
vi.mock('./location/location-management.service', () => ({
  LocationManagementService: class LocationManagementService {},
}));
vi.mock('../run-log/config-hash', () => ({ balanceConfigHash: () => 'hash' }));

// No change detection here: the recording's effect and the focus after layout stay idle
vi.mock('@angular/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@angular/core')>()),
  effect: () => ({ destroy: () => undefined }),
  afterNextRender: () => undefined,
}));

import { ElementRef, Injector, NgZone, runInInjectionContext, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { ReplayService } from './replay.service';
import { SimClient } from '../sim/client/sim-client.service';
import { TowerSelectionService } from './tower-selection.service';
import { initialScalars } from '../sim/client/mirror/sim-mirror';
import type { SimFramePacket } from '../sim/protocol/packet';
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
import { WaveDirector } from '../director/wave-director';
import { LocationManagementService } from './location/location-management.service';

/**
 * The gate of ReplayService.enter(): a replay starts only with a recorded
 * wave, between waves, and not while a boss intro holds the camera (the
 * intro pauses the game and puts the camera back itself). The simulation
 * re-simulates the wave (SimClient.rpc replayEnter); its packets name the
 * waves it can show.
 */
describe('ReplayService.enter gate', () => {
  let host: HTMLElement;
  let introActive: ReturnType<typeof signal<boolean>>;
  /** The frame listeners the service put on the SimClient */
  let frames: ((packet: SimFramePacket) => void)[];
  /** The rpcs the simulation got */
  let rpc: ReturnType<typeof vi.fn>;
  let phase: ReturnType<typeof signal<string>>;
  let paused: ReturnType<typeof signal<boolean>>;
  let getEngine: ReturnType<typeof vi.fn>;
  let service: ReplayService;
  let injector: Injector;
  /** What SimScalars.snapshotRefusal says: shots still flying or a quiet field */
  let refusal: string | null;

  /** A packet naming the waves the simulation can re-simulate */
  const recorded = (...waves: number[]) => {
    const scalars = { ...initialScalars(), replayableWaves: waves };
    for (const listener of frames) listener({ scalars } as SimFramePacket);
  };
  /** The replays the simulation was asked to enter */
  const entered = () => rpc.mock.calls.filter(([method]) => method === 'replayEnter');
  /** Let the async start (rpc replayEnter) finish */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  const pose = () => ({ clone: () => ({}), copy: vi.fn() });

  beforeEach(() => {
    frames = [];
    rpc = vi.fn(async (method: string, wave?: number) =>
      (method === 'replayEnter' ? { wave, startStep: 0, lengthInSteps: 100, waves: [wave], markers: [] } : null));
    refusal = null;
    host = document.createElement('div');
    document.body.append(host);
    introActive = signal(false);
    phase = signal('setup');
    paused = signal(false);
    const engine = {
      towerBadges: { setVisible: vi.fn() },
      getCamera: () => ({ position: pose(), quaternion: pose(), up: pose(), updateMatrixWorld: vi.fn() }),
      getControls: () => null,
    };
    getEngine = vi.fn(() => engine);

    injector = Injector.create({
      providers: [
        {
          provide: UIStore,
          useValue: { replayMode: signal(false), openMenu: signal(null), mapPlacementMode: signal(false), coopMapLocked: signal(false) },
        },
        { provide: TowerDefenseStore, useValue: { loading: signal(false), error: signal(null), phase } },
        { provide: GameStore, useValue: { paused, mannedTowerId: signal(null) } },
        {
          provide: SimClient,
          useValue: {
            bus: { emit: vi.fn() },
            get scalars() {
              return { ...initialScalars(), snapshotRefusal: refusal, baseHealth: 100 };
            },
            onFrame: (listener: (packet: SimFramePacket) => void) => {
              frames.push(listener);
              return () => frames.splice(frames.indexOf(listener), 1);
            },
            rpc,
            replay: null,
          },
        },
        { provide: TowerSelectionService, useValue: { select: vi.fn() } },
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
        { provide: WaveDirector, useValue: { source: { id: 'budget' } } },
        { provide: LocationManagementService, useValue: { editableHqLocation: () => null } },
      ],
    });
    service = runInInjectionContext(injector, () => new ReplayService());
    recorded(3);
  });

  afterEach(() => {
    host.remove();
  });

  it('stops listening to the simulation's frames when the game component goes', () => {
    expect(frames).toHaveLength(1);
    (injector as unknown as { destroy(): void }).destroy();
    expect(frames).toHaveLength(0);
  });

  it('does not start while a boss intro holds the camera', async () => {
    introActive.set(true);
    expect(service.available()).toBe(true);

    service.enter();
    await settle();

    expect(service.active()).toBe(false);
    expect(getEngine).not.toHaveBeenCalled();
    expect(entered()).toHaveLength(0);
    expect(paused()).toBe(false);
  });

  it('starts once the intro is over, pausing the live game', async () => {
    introActive.set(true);
    service.enter();
    introActive.set(false);

    service.enter();
    await settle();

    expect(service.active()).toBe(true);
    expect(entered()).toEqual([['replayEnter', 3, false]]);
    expect(paused()).toBe(true);
  });

  it('offers the player the button while REPLAY_CONFIG.offered is on', async () => {
    expect(service.available()).toBe(true);
    expect(service.offered()).toBe(true);

    service.enter();
    await settle();
    expect(service.active()).toBe(true);
  });

  it('does not start without a recorded wave or during a wave', async () => {
    recorded();
    service.enter();
    recorded(3);
    phase.set('wave');
    service.enter();
    await settle();

    expect(service.active()).toBe(false);
    expect(entered()).toHaveLength(0);
  });

  it('stays out when the simulation cannot re-simulate the wave, and gives the pause back', async () => {
    rpc.mockResolvedValueOnce(null);
    service.enter();
    await settle();

    expect(entered()).toHaveLength(1);
    expect(service.active()).toBe(false);
    expect(paused()).toBe(false);
  });

  it('waits for the last shots of a wave to land, then starts by itself (R8)', async () => {
    vi.useFakeTimers();
    try {
      refusal = 'projectiles';
      service.enter();
      expect(service.active()).toBe(false);
      service.update();
      expect(entered()).toHaveLength(0);

      refusal = null;
      service.update();
      await vi.runAllTimersAsync();
      expect(service.active()).toBe(true);
      expect(entered()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after 5 s of shots in the air and starts nothing', async () => {
    vi.useFakeTimers();
    try {
      refusal = 'projectiles';
      service.enter();
      vi.advanceTimersByTime(5001);
      service.update();
      refusal = null;
      service.update();
      await vi.runAllTimersAsync();
      expect(service.active()).toBe(false);
      expect(entered()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
