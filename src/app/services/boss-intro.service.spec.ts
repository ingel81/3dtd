import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed; the real modules pull in the engine, and
// the partially compiled CDK needs the JIT compiler under vitest.
vi.mock('@angular/cdk/a11y', () => ({ LiveAnnouncer: class LiveAnnouncer {} }));
vi.mock('../managers/game-state.manager', () => ({ GameStateManager: class GameStateManager {} }));
vi.mock('../bots/bot-client.service', () => ({ BotClientService: class BotClientService {} }));
vi.mock('./infrastructure/engine-initialization.service', () => ({
  EngineInitializationService: class EngineInitializationService {},
}));
vi.mock('./camera-control.service', () => ({ CameraControlService: class CameraControlService {} }));
vi.mock('./keyboard-pan.service', () => ({ KeyboardPanService: class KeyboardPanService {} }));
vi.mock('./world/intro-camera-flight.service', () => ({ IntroCameraFlightService: class IntroCameraFlightService {} }));
vi.mock('../store/ui.store', () => ({ UIStore: class UIStore {} }));
vi.mock('../store/game.store', () => ({ GameStore: class GameStore {} }));
vi.mock('./debug/debug-facade.service', () => ({ DebugFacadeService: class DebugFacadeService {} }));
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));

import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { MatDialog } from '@angular/material/dialog';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { BossIntroService } from './boss-intro.service';
import { GameStateManager } from '../managers/game-state.manager';
import { BotClientService } from '../bots/bot-client.service';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { CameraControlService } from './camera-control.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { IntroCameraFlightService } from './world/intro-camera-flight.service';
import { UIStore } from '../store/ui.store';
import { GameStore } from '../store/game.store';
import { DebugFacadeService } from './debug/debug-facade.service';
import { GameEventBus } from '../game-engine/game-event-bus';
import { BOSS_INTRO_TIMING, bossIntroCutMs, bossIntroReturnMs } from '../utils/boss-intro';
import type { Enemy } from '../entities/enemy.entity';
import type { RouteWaypoint } from '../models/game.types';
import { BOSS_INTRO_SOUNDS } from '../configs/game-sounds.config';

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

function fakeBoss(id = 'herbert', isBoss = true, name = 'Herbert'): FakeBoss {
  const boss: FakeBoss = { enemy: null as unknown as Enemy, walked: 0 };
  boss.enemy = {
    typeConfig: { id, isBoss, name, heightOffset: 0.5, healthBarOffset: 7 },
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
  let announce: ReturnType<typeof vi.fn>;
  let paused: ReturnType<typeof signal<boolean>>;
  let pauseKeepsLoops: ReturnType<typeof signal<boolean>>;
  let playGlobal: ReturnType<typeof vi.fn>;
  let bossIntroEnabled: ReturnType<typeof signal<boolean>>;
  /** MatDialog.openDialogs */
  let openDialogs: unknown[];

  const spawn =(boss: FakeBoss, viaPortal = true) => bus.emit({ type: 'enemy:spawned', enemy: boss.enemy, viaPortal });
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
    announce = vi.fn();
    paused = signal(false);
    pauseKeepsLoops = signal(false);
    bossIntroEnabled = signal(true);
    openDialogs = [];
    playGlobal = vi.fn(() => Promise.resolve(null));
    const engine = {
      spatialAudio: { playGlobal },
      getCamera: () => camera,
      getControls: () => controls,
      getTerrainHeightAtGeo: () => 0,
      // Open ground: nothing in the way of the shot
      terrain: { raycastLineOfSight: () => false, sampleColumn: () => null },
      sync: {
        getOrigin: () => ({ lat: 0, lon: 0, height: 100 }),
        geoToLocalSimple: (lat: number, lon: number) => new Vector3(lon * 1e5, 0, -lat * 1e5),
      },
    };

    injector = Injector.create({
      providers: [
        { provide: GameStateManager, useValue: { getEventBus: () => bus, waveNumber: () => wave } },
        { provide: GameStore, useValue: { gameSpeed: signal(1), renderingEnabled: signal(true), paused, pauseKeepsLoops } },
        { provide: UIStore, useValue: { photoMode } },
        { provide: BotClientService, useValue: { botEnabled: signal(false), isConnected: signal(false) } },
        { provide: EngineInitializationService, useValue: { getEngine: () => engine } },
        { provide: CameraControlService, useValue: { stopJump: vi.fn() } },
        { provide: KeyboardPanService, useValue: { clearKeys: vi.fn() } },
        { provide: IntroCameraFlightService, useValue: { active: signal(false) } },
        { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
        { provide: LiveAnnouncer, useValue: { announce } },
        { provide: DebugFacadeService, useValue: { bossIntroEnabled } },
        { provide: MatDialog, useValue: { openDialogs } },
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

  it('skips a boss that clears its portal while a dialog is open, and gives it none once the dialog closes', () => {
    const boss = fakeBoss();
    spawn(boss);
    openDialogs.push({});
    expect(service.blocked()).toBe('dialog');

    boss.walked = 20;
    frame();
    expect(service.stage()).toBeNull();
    expect(controls.enabled).toBe(true);
    expect(paused()).toBe(false);
    expect(camera.position.equals(startPosition)).toBe(true);

    openDialogs.length = 0;
    expect(service.blocked()).toBeNull();
    play(1000);
    expect(service.active()).toBe(false);
  });

  it('names the boss and its wave on the card and to a screen reader', () => {
    const boss = fakeBoss();
    boss.walked = 20;
    spawn(boss);
    frame();
    expect(service.card()).toEqual({ name: 'Herbert', wave: 10 });
    expect(announce).toHaveBeenCalledWith('Boss: Herbert, wave 10. Escape skips.');

    play(bossIntroReturnMs() + BOSS_INTRO_TIMING.revealMs);
    expect(service.card()).toBeNull();
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

  it('gives two boss types that leave together one intro that names both', () => {
    const herbert = fakeBoss();
    const ooze = fakeBoss('ooze', true, 'Ooze');
    herbert.walked = 20;
    ooze.walked = 12; // still in its portal
    spawn(herbert);
    spawn(ooze);
    frame();
    expect(service.stage()).toBe('dip-in');
    expect(service.card()).toEqual({ name: 'Herbert & Ooze', wave: 10 });
    expect(announce).toHaveBeenCalledWith('Bosses: Herbert and Ooze, wave 10. Escape skips.');

    play(bossIntroReturnMs() + BOSS_INTRO_TIMING.revealMs);
    expect(service.stage()).toBeNull();
    ooze.walked = 30;
    frame();
    expect(service.stage()).toBeNull();
  });

  it('still gives a boss of another type that comes later in the wave its own intro', () => {
    const herbert = fakeBoss();
    herbert.walked = 20;
    spawn(herbert);
    frame();
    play(bossIntroReturnMs() + BOSS_INTRO_TIMING.revealMs);

    const ooze = fakeBoss('ooze', true, 'Ooze');
    ooze.walked = 20;
    spawn(ooze);
    frame();
    expect(service.card()).toEqual({ name: 'Ooze', wave: 10 });
  });

  it('gives a worm one intro, from its worm:spawned, not from its segments', () => {
    const head = fakeBoss('worm');
    const segment = fakeBoss('worm');
    head.walked = segment.walked = 20;
    // Head and segments bring their own enemy:spawned, without viaPortal
    spawn(head, false);
    bus.emit({ type: 'worm:spawned', head: head.enemy, group: {} as never, viaPortal: true });
    spawn(segment, false);
    frame();
    expect(service.stage()).toBe('dip-in');
    play(bossIntroReturnMs() + BOSS_INTRO_TIMING.revealMs);
    expect(service.stage()).toBeNull();

    // A second worm of the same wave, and more segments: none
    const second = fakeBoss('worm');
    second.walked = 20;
    bus.emit({ type: 'worm:spawned', head: second.enemy, group: {} as never, viaPortal: true });
    spawn(segment, false);
    frame();
    expect(service.stage()).toBeNull();
  });

  it('leaves a worm placed through Enemy Debug alone', () => {
    const head = fakeBoss('worm');
    head.walked = 20;
    bus.emit({ type: 'worm:spawned', head: head.enemy, group: {} as never, viaPortal: false });
    frame();
    expect(service.stage()).toBeNull();
  });

  it('stays out when switched off in the display menu', () => {
    bossIntroEnabled.set(false);
    const boss = fakeBoss();
    boss.walked = 20;
    spawn(boss);
    frame();
    expect(service.stage()).toBeNull();
    expect(paused()).toBe(false);
    expect(camera.position.equals(startPosition)).toBe(true);
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

  it('pauses the game for the intro and lets it run on with the view', () => {
    const boss = fakeBoss();
    boss.walked = 20;
    spawn(boss);
    frame();
    expect(paused()).toBe(true);
    play(bossIntroReturnMs());
    expect(service.stage()).toBe('reveal');
    expect(paused()).toBe(false);
  });

  it('plays the signature sound of the boss that comes, none for a boss without one', () => {
    const boss = fakeBoss('worm', true, 'Skarnax');
    boss.walked = 20;
    spawn(boss);
    frame();
    expect(playGlobal).toHaveBeenCalledWith(BOSS_INTRO_SOUNDS['worm'].id);
  });

  it('keeps the sound loops running while the intro pauses the game, so the boss is heard', () => {
    const boss = fakeBoss();
    boss.walked = 20;
    spawn(boss);
    frame();
    expect(pauseKeepsLoops()).toBe(true);
    play(bossIntroReturnMs());
    expect(pauseKeepsLoops()).toBe(false);
  });

  it('leaves a game the player had paused paused', () => {
    paused.set(true);
    const boss = fakeBoss();
    boss.walked = 20;
    spawn(boss);
    frame();
    play(bossIntroReturnMs());
    expect(service.stage()).toBe('reveal');
    expect(paused()).toBe(true);
  });

  it('Esc skips: view and game back at once, the veil fades out', () => {
    const boss = fakeBoss();
    boss.walked = 20;
    spawn(boss);
    frame();
    play(bossIntroCutMs() + 500);
    expect(camera.position.equals(startPosition)).toBe(false);

    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    expect(service.handleKeyDown(esc)).toBe(true);
    expect(esc.defaultPrevented).toBe(true);
    expect(service.stage()).toBe('reveal');
    expect(camera.position.distanceTo(startPosition)).toBeLessThan(1e-9);
    expect(paused()).toBe(false);
    expect(controls.enabled).toBe(true);

    play(BOSS_INTRO_TIMING.revealMs);
    expect(service.stage()).toBeNull();
  });

  it('a click during the first fade skips before the cut', () => {
    const boss = fakeBoss();
    boss.walked = 20;
    spawn(boss);
    frame();
    service.skip();
    play(BOSS_INTRO_TIMING.revealMs);
    expect(service.stage()).toBeNull();
    expect(camera.position.equals(startPosition)).toBe(true);
    expect(paused()).toBe(false);
  });

  it('holds the other game keys back until the view is back, not typing', () => {
    const key = (name: string, target?: EventTarget) => {
      const event = new KeyboardEvent('keydown', { key: name, cancelable: true });
      if (target) Object.defineProperty(event, 'target', { value: target });
      return event;
    };
    expect(service.handleKeyDown(key('p'))).toBe(false);

    const boss = fakeBoss();
    boss.walked = 20;
    spawn(boss);
    frame();
    expect(service.handleKeyDown(key('p'))).toBe(true);
    expect(service.handleKeyDown(key(' '))).toBe(true);
    expect(service.stage()).toBe('dip-in');
    expect(service.handleKeyDown(key('p', document.createElement('input')))).toBe(false);
    // Esc a dialog has already taken
    const taken = key('Escape');
    taken.preventDefault();
    expect(service.handleKeyDown(taken)).toBe(false);
    expect(service.stage()).toBe('dip-in');

    play(bossIntroReturnMs());
    expect(service.handleKeyDown(key('p'))).toBe(false);
  });
});
