import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed; the real modules pull in the engine.
vi.mock('../managers/game-state.manager', () => ({ GameStateManager: class GameStateManager {} }));
vi.mock('../ai/training/training-client.service', () => ({ TrainingClientService: class TrainingClientService {} }));
vi.mock('./infrastructure/engine-initialization.service', () => ({
  EngineInitializationService: class EngineInitializationService {},
}));
vi.mock('./camera-control.service', () => ({ CameraControlService: class CameraControlService {} }));
vi.mock('./keyboard-pan.service', () => ({ KeyboardPanService: class KeyboardPanService {} }));
vi.mock('./world/intro-camera-flight.service', () => ({ IntroCameraFlightService: class IntroCameraFlightService {} }));
vi.mock('../store/ui.store', () => ({ UIStore: class UIStore {} }));
vi.mock('../store/game.store', () => ({ GameStore: class GameStore {} }));

import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { BossIntroService } from './boss-intro.service';
import { GameStateManager } from '../managers/game-state.manager';
import { TrainingClientService } from '../ai/training/training-client.service';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { CameraControlService } from './camera-control.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { IntroCameraFlightService } from './world/intro-camera-flight.service';
import { UIStore } from '../store/ui.store';
import { GameStore } from '../store/game.store';
import { GameEventBus } from '../game-engine/game-event-bus';
import { BOSS_INTRO_TIMING, bossIntroCutMs, bossIntroReturnMs } from '../utils/boss-intro';
import type { Enemy } from '../entities/enemy.entity';
import type { RouteWaypoint } from '../models/game.types';

/** 1e-5 degrees are one metre in the fake sync; origin height 100, so height 100 is ground 0. */
const ROUTE: RouteWaypoint[] = [
  { lat: 0, lon: 0, height: 100 },
  { lat: 0.002, lon: 0, height: 100 },
];

interface FakeBoss {
  enemy: Enemy;
  /** Metres walked from the portal */
  walked: number;
}

function fakeBoss(id = 'herbert', isBoss = true): FakeBoss {
  const boss: FakeBoss = { enemy: null as unknown as Enemy, walked: 0 };
  boss.enemy = {
    typeConfig: { id, isBoss, name: 'Herbert' },
    active: true,
    alive: true,
    movement: { path: ROUTE, getDistanceAlongPath: () => boss.walked },
  } as unknown as Enemy;
  return boss;
}

/**
 * The boss intro takes the camera to the portal once a wave's boss is out of
 * it and gives the player's pose back afterwards; everything that is not a
 * wave's boss, or comes when nobody should watch, leaves the camera alone.
 */
describe('BossIntroService', () => {
  let bus: GameEventBus;
  let wave: number;
  let camera: PerspectiveCamera;
  let controls: { enabled: boolean };
  let photoMode: ReturnType<typeof signal<boolean>>;
  let injector: Injector;
  let service: BossIntroService;
  let startPosition: Vector3;
  let startQuaternion: Quaternion;

  const spawn = (boss: FakeBoss, viaPortal = true) => bus.emit({ type: 'enemy:spawned', enemy: boss.enemy, viaPortal });
  const frame = (ms = 16) => service.update(ms);
  /** `ms` of wall clock in 16 ms frames */
  const play = (ms: number) => {
    for (let t = 0; t < ms; t += 16) service.update(Math.min(16, ms - t));
  };

  beforeEach(() => {
    bus = new GameEventBus();
    wave = 10;
    camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
    camera.position.set(300, 400, 300);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    startPosition = camera.position.clone();
    startQuaternion = camera.quaternion.clone();
    controls = { enabled: true };
    photoMode = signal(false);
    const engine = {
      getCamera: () => camera,
      getControls: () => controls,
      getTerrainHeightAtGeo: () => 0,
      sync: {
        getOrigin: () => ({ lat: 0, lon: 0, height: 100 }),
        geoToLocalSimple: (lat: number, lon: number) => new Vector3(lon * 1e5, 0, -lat * 1e5),
      },
    };

    injector = Injector.create({
      providers: [
        { provide: GameStateManager, useValue: { getEventBus: () => bus, waveNumber: () => wave } },
        { provide: GameStore, useValue: { trainingTimescale: signal(1), renderingEnabled: signal(true) } },
        { provide: UIStore, useValue: { photoMode } },
        { provide: TrainingClientService, useValue: { botEnabled: signal(false), isConnected: signal(false) } },
        { provide: EngineInitializationService, useValue: { getEngine: () => engine } },
        { provide: CameraControlService, useValue: { stopJump: vi.fn() } },
        { provide: KeyboardPanService, useValue: { clearKeys: vi.fn() } },
        { provide: IntroCameraFlightService, useValue: { active: signal(false) } },
        { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
      ],
    });
    service = runInInjectionContext(injector, () => new BossIntroService());
  });

  afterEach(() => (injector as unknown as { destroy(): void }).destroy());

  it('waits while the boss is inside its portal, then cuts to it and back', () => {
    const boss = fakeBoss();
    spawn(boss);
    frame();
    expect(service.stage()).toBeNull();

    boss.walked = 20;
    frame();
    expect(service.stage()).toBe('dip-in');
    expect(controls.enabled).toBe(false);
    expect(camera.position.equals(startPosition)).toBe(true);

    play(bossIntroCutMs());
    expect(service.stage()).toBe('hold');
    // Over the route beyond the boss, looking back at the portal (+z)
    expect(camera.position.x).toBeCloseTo(0);
    expect(camera.position.z).toBeLessThan(-20);
    expect(camera.position.y).toBeGreaterThan(5);
    const view = camera.getWorldDirection(new Vector3());
    expect(view.z).toBeGreaterThan(0.8);

    play(bossIntroReturnMs() - bossIntroCutMs());
    expect(service.stage()).toBe('reveal');
    expect(camera.position.distanceTo(startPosition)).toBeLessThan(1e-9);
    expect(camera.quaternion.angleTo(startQuaternion)).toBeLessThan(1e-6);
    expect(controls.enabled).toBe(true);

    play(BOSS_INTRO_TIMING.revealMs);
    expect(service.stage()).toBeNull();
    expect(service.active()).toBe(false);
  });

  it('a stalled frame does not eat the hold', () => {
    const boss = fakeBoss();
    boss.walked = 20;
    spawn(boss);
    frame();
    play(bossIntroCutMs());
    frame(BOSS_INTRO_TIMING.holdMs);
    expect(service.stage()).toBe('hold');
  });

  it('leaves a placed boss and a regular enemy alone', () => {
    const placed = fakeBoss();
    const zombie = fakeBoss('zombie', false);
    placed.walked = zombie.walked = 20;
    spawn(placed, false);
    spawn(zombie);
    frame();
    expect(service.stage()).toBeNull();
    expect(controls.enabled).toBe(true);
  });

  it('plays once per boss type and wave', () => {
    const first = fakeBoss();
    const second = fakeBoss();
    first.walked = second.walked = 20;
    spawn(first);
    spawn(second);
    frame();
    play(bossIntroReturnMs() + BOSS_INTRO_TIMING.revealMs);
    expect(service.stage()).toBeNull();
    frame();
    expect(service.stage()).toBeNull();

    wave = 20;
    const next = fakeBoss();
    next.walked = 20;
    spawn(next);
    frame();
    expect(service.stage()).toBe('dip-in');
  });

  it('keeps the view in photo mode', () => {
    photoMode.set(true);
    const boss = fakeBoss();
    boss.walked = 20;
    spawn(boss);
    frame();
    play(bossIntroCutMs());
    expect(service.stage()).toBeNull();
    expect(camera.position.equals(startPosition)).toBe(true);
  });

  it('a restart ends the intro and gives the controls back', () => {
    const boss = fakeBoss();
    boss.walked = 20;
    spawn(boss);
    frame();
    play(bossIntroCutMs());
    expect(service.stage()).toBe('hold');

    bus.emit({ type: 'game:reset' });
    expect(service.stage()).toBeNull();
    expect(controls.enabled).toBe(true);
    frame();
    expect(service.stage()).toBeNull();
  });
});
