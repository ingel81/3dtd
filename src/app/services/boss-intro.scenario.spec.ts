// BossIntroComponent is created below; its decorator may need the JIT compiler
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed, as in boss-intro.service.spec.ts
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
import { BossIntroComponent } from '../components/boss-intro/boss-intro.component';
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
import { ENEMY_TYPES } from '../configs/enemy-types.config';
import {
  BOSS_INTRO_BODY_OUT_M,
  BOSS_INTRO_CLEAR_MARGIN_M,
  BOSS_INTRO_TIMING,
  bossIntroCutMs,
  bossIntroReturnMs,
} from '../utils/boss-intro';
import { PORTAL_DEPTH, portalDepthScale } from '../configs/marker-geometry.config';
import { portalCorridorWidth, portalScaleForWidth } from '../three-engine/renderers/marker/spawn-portal-pose';
import type { Enemy } from '../entities/enemy.entity';
import type { RouteWaypoint } from '../models/game.types';

/** 1e-5 degrees are one metre in the fake sync; origin height 100, so height 100 is ground 0. */
const ROUTE: RouteWaypoint[] = [
  { lat: 0, lon: 0, height: 100 },
  { lat: 0.002, lon: 0, height: 100 },
];
/** Metres from the route start at which a boss stands in front of a scale-1 portal and beyond */
const OUT_M = 20;

interface Boss {
  enemy: Enemy;
  /** Metres walked from the portal */
  walked: number;
}

/** A boss with its real type config, so isBoss and the card's name are the game's own. */
function boss(type: 'herbert' | 'worm' | 'ooze'): Boss {
  const b: Boss = { enemy: null as unknown as Enemy, walked: 0 };
  b.enemy = {
    typeConfig: ENEMY_TYPES[type],
    active: true,
    alive: true,
    movement: { path: ROUTE, getDistanceAlongPath: () => b.walked },
  } as unknown as Enemy;
  return b;
}

/**
 * Night-2 playtest 366 to 371 and 423 (docs/archive/REVIEW_SPRINT_2026-09-14.md)
 * replayed on the real BossIntroService with the real boss configs: the
 * wave's spawns come over the event bus as EnemyManager emits them, the
 * frames through update() as GameLoopFacadeService ticks it after the
 * sub-steps. The game component asks handleKeyDown() first on every keydown
 * and returns when it says true (tower-defense.component.ts onKeyDown), so
 * InputHandlerService (WASD, Esc out of build mode) and HotkeyService
 * (P, Space, G, V) never see such a key.
 */
describe('Boss intro, night-2 playtest 366 to 371 and 423 replayed', () => {
  let bus: GameEventBus;
  let wave: number;
  let camera: PerspectiveCamera;
  let controls: { enabled: boolean };
  let photoMode: ReturnType<typeof signal<boolean>>;
  let paused: ReturnType<typeof signal<boolean>>;
  let timescale: ReturnType<typeof signal<number>>;
  let bossIntroEnabled: ReturnType<typeof signal<boolean>>;
  /** MatDialog.openDialogs: the location dialog, the key overview */
  let openDialogs: unknown[];
  let injector: Injector;
  let service: BossIntroService;
  let startPosition: Vector3;
  let startQuaternion: Quaternion;

  /** EnemyManager.spawnOne: viaPortal for the 'portal' entry of a wave spawn */
  const spawn = (b: Boss, viaPortal = true) => bus.emit({ type: 'enemy:spawned', enemy: b.enemy, viaPortal });
  const frame = (ms = 16) => service.update(ms);
  /** `ms` of wall clock in 16 ms frames */
  const play = (ms: number) => {
    for (let t = 0; t < ms; t += 16) service.update(Math.min(16, ms - t));
  };
  const wholeIntro = () => play(bossIntroReturnMs() + BOSS_INTRO_TIMING.revealMs);
  const keydown = (key: string) => new KeyboardEvent('keydown', { key, cancelable: true });
  const viewIsBack = () => {
    expect(camera.position.distanceTo(startPosition)).toBeLessThan(1e-9);
    expect(camera.quaternion.angleTo(startQuaternion)).toBeLessThan(1e-6);
  };

  beforeEach(() => {
    bus = new GameEventBus();
    wave = 10;
    camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
    camera.position.set(-240, 310, 520);
    camera.lookAt(40, 0, -60);
    camera.updateMatrixWorld();
    startPosition = camera.position.clone();
    startQuaternion = camera.quaternion.clone();
    controls = { enabled: true };
    photoMode = signal(false);
    paused = signal(false);
    timescale = signal(1);
    bossIntroEnabled = signal(true);
    openDialogs = [];
    const engine = {
      getCamera: () => camera,
      getControls: () => controls,
      getTerrainHeightAtGeo: () => 0,
      // Open ground: nothing in the way of the shot (obstacles: boss-intro.obstacles.scenario.spec.ts)
      terrain: { raycastLineOfSight: () => false, sampleColumn: () => null },
      sync: {
        getOrigin: () => ({ lat: 0, lon: 0, height: 100 }),
        geoToLocalSimple: (lat: number, lon: number) => new Vector3(lon * 1e5, 0, -lat * 1e5),
      },
    };
    injector = Injector.create({
      providers: [
        { provide: GameStateManager, useValue: { getEventBus: () => bus, waveNumber: () => wave } },
        { provide: GameStore, useValue: { gameSpeed: timescale, renderingEnabled: signal(true), paused } },
        { provide: UIStore, useValue: { photoMode } },
        { provide: BotClientService, useValue: { botEnabled: signal(false), isConnected: signal(false) } },
        { provide: EngineInitializationService, useValue: { getEngine: () => engine } },
        { provide: CameraControlService, useValue: { stopJump: vi.fn() } },
        { provide: KeyboardPanService, useValue: { clearKeys: vi.fn() } },
        { provide: IntroCameraFlightService, useValue: { active: signal(false) } },
        { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
        { provide: LiveAnnouncer, useValue: { announce: vi.fn() } },
        { provide: DebugFacadeService, useValue: { bossIntroEnabled } },
        { provide: MatDialog, useValue: { openDialogs } },
      ],
    });
    service = runInInjectionContext(injector, () => new BossIntroService());
  });

  afterEach(() => (injector as unknown as { destroy(): void }).destroy());

  it('open point 14: Herbert clears his portal while the key overview is open: no cut, no pause, none later; the next wave gives his', () => {
    const herbert = boss('herbert');
    spawn(herbert);
    // H: the key overview is a MatDialog (openHotkeyHelpDialog), as is the location dialog
    openDialogs.push({});
    herbert.walked = OUT_M;
    frame();
    expect(service.active()).toBe(false);
    expect(paused()).toBe(false);
    expect(controls.enabled).toBe(true);
    viewIsBack();

    // Closed again: the intro does not come late
    openDialogs.length = 0;
    play(1000);
    expect(service.active()).toBe(false);

    wave = 11;
    const next = boss('herbert');
    spawn(next);
    next.walked = OUT_M;
    frame();
    expect(service.active()).toBe(true);
  });

  it('366: Herbert out of the portal: dark, the card, 2.8 s on the portal, then exactly the view before and the game running', () => {
    const herbert = boss('herbert');
    spawn(herbert);
    frame();
    expect(service.active()).toBe(false);

    herbert.walked = OUT_M;
    frame();
    expect(service.stage()).toBe('dip-in');
    // tower-defense.component.html mutes the top HUD column (speed, boss bar) while active()
    expect(service.active()).toBe(true);
    expect(paused()).toBe(true);

    play(bossIntroCutMs());
    expect(service.stage()).toBe('hold');
    expect(service.card()).toEqual({ name: 'Herbert', wave: 10 });
    expect(camera.position.distanceTo(startPosition)).toBeGreaterThan(1);

    play(BOSS_INTRO_TIMING.holdMs);
    expect(BOSS_INTRO_TIMING.holdMs).toBe(2800);
    expect(service.stage()).toBe('dip-out');

    play(bossIntroCutMs());
    expect(service.stage()).toBe('reveal');
    viewIsBack();
    expect(paused()).toBe(false);
    expect(controls.enabled).toBe(true);

    play(BOSS_INTRO_TIMING.revealMs);
    expect(service.active()).toBe(false);
    expect(service.card()).toBeNull();
  });

  it('367: during the card the game stands, P, Space, WASD, the arrows, Home and N wait; Esc skips and goes no further', () => {
    const herbert = boss('herbert');
    herbert.walked = OUT_M;
    spawn(herbert);
    frame();
    play(bossIntroCutMs() + 500);
    expect(service.stage()).toBe('hold');
    // GameStateManager runs no sub-step while GameStore.paused: nothing walks or shoots
    expect(paused()).toBe(true);

    for (const key of ['p', ' ', 'w', 'a', 's', 'd', 'ArrowLeft', 'Home', 'n']) {
      const event = keydown(key);
      expect(service.handleKeyDown(event), key).toBe(true);
      // Not taken for anything: the game component just returns
      expect(event.defaultPrevented, key).toBe(false);
      expect(service.stage(), key).toBe('hold');
    }
    expect(paused()).toBe(true);

    // Esc: taken here, so InputHandlerService never ends the build mode with it
    const esc = keydown('Escape');
    expect(service.handleKeyDown(esc)).toBe(true);
    expect(esc.defaultPrevented).toBe(true);
    expect(service.stage()).toBe('reveal');
    viewIsBack();
    expect(paused()).toBe(false);

    // The view is back: the next Esc is the game's again
    expect(service.handleKeyDown(keydown('Escape'))).toBe(false);
  });

  it('367, 371: a click lands on the skip layer until the view is back and only skips', () => {
    const veil = runInInjectionContext(
      Injector.create({ providers: [{ provide: BossIntroService, useValue: service }] }),
      () => new BossIntroComponent(),
    );
    expect(veil.skippable()).toBe(false);

    const herbert = boss('herbert');
    herbert.walked = OUT_M;
    spawn(herbert);
    frame();
    // Over the whole canvas area, above the ability bar with the hero button
    // (z-index 25 against 6); InputHandlerService only takes pointer events
    // on the canvas itself, so the map under it gets nothing either
    expect(veil.skippable()).toBe(true);
    play(bossIntroCutMs() + 1000);
    expect(veil.shown()).toBe(true);
    expect(veil.skippable()).toBe(true);

    veil.skip();
    expect(service.stage()).toBe('reveal');
    expect(veil.skippable()).toBe(false);
    viewIsBack();
    expect(paused()).toBe(false);
    expect(controls.enabled).toBe(true);
  });

  it('371: G and V wait while the intro runs', () => {
    const herbert = boss('herbert');
    herbert.walked = OUT_M;
    spawn(herbert);
    frame();
    for (const key of ['g', 'G', 'v']) {
      const event = keydown(key);
      expect(service.handleKeyDown(event), key).toBe(true);
      expect(event.defaultPrevented, key).toBe(false);
    }
    expect(service.stage()).toBe('dip-in');
  });

  it('368: Herbert Count 3 with a 1 s delay: one intro, the later two walk out without one', () => {
    const first = boss('herbert');
    spawn(first);
    first.walked = OUT_M;
    frame();
    expect(service.card()).toEqual({ name: 'Herbert', wave: 10 });
    wholeIntro();
    expect(service.active()).toBe(false);

    // The spawner stood in the pause; the next two come a second of game time apart
    for (const later of [boss('herbert'), boss('herbert')]) {
      spawn(later);
      frame();
      later.walked = OUT_M;
      play(1000);
      expect(service.active()).toBe(false);
    }
    viewIsBack();
  });

  it('368: the worm: one intro "Skarnax" once its head is out, none for its segments or after a split', () => {
    const head = boss('worm');
    // EnemyManager.spawn: the head segment's enemy:spawned has no viaPortal, worm:spawned has
    spawn(head, false);
    bus.emit({ type: 'worm:spawned', head: head.enemy, group: {} as never, viaPortal: true });
    frame();
    expect(service.active()).toBe(false);

    head.walked = OUT_M;
    frame();
    expect(service.card()).toEqual({ name: 'Skarnax', epithet: 'The Thousand-Legged Calamity', wave: 10 });
    wholeIntro();

    // The segments behind come out through WormChains without viaPortal; a
    // split makes one of them a head (showAsHead) and spawns nothing
    for (let i = 0; i < 6; i++) {
      const segment = boss('worm');
      segment.walked = OUT_M;
      spawn(segment, false);
      frame();
    }
    expect(service.active()).toBe(false);
  });

  it('368: the ooze out of the portal gets one intro "Ooze"', () => {
    const ooze = boss('ooze');
    spawn(ooze);
    ooze.walked = OUT_M;
    frame();
    expect(service.card()).toEqual({ name: 'Ooze', wave: 10 });
    wholeIntro();
    frame();
    expect(service.active()).toBe(false);
  });

  it('playtest 2026-09-15: the ooze intro starts once its tip is 6 m out of the portal, not at 3 m like Herbert', () => {
    // The portal's front face on this route (no corridor width: the default one)
    const front = (PORTAL_DEPTH / 2) * portalDepthScale(portalScaleForWidth(portalCorridorWidth(ROUTE[0])));
    const ooze = boss('ooze');
    spawn(ooze);
    // Where Herbert's intro starts: only the rounded tip is out
    ooze.walked = front + BOSS_INTRO_CLEAR_MARGIN_M;
    frame();
    expect(service.active()).toBe(false);
    ooze.walked = front + BOSS_INTRO_BODY_OUT_M - 0.1;
    frame();
    expect(service.active()).toBe(false);

    ooze.walked = front + BOSS_INTRO_BODY_OUT_M;
    frame();
    expect(service.card()).toEqual({ name: 'Ooze', wave: 10 });
    play(bossIntroCutMs());
    expect(service.stage()).toBe('hold');
    // Over the route beyond the tip (-z), aimed at a point above the tip, the portal behind it
    const eye = camera.position;
    const view = camera.getWorldDirection(new Vector3());
    const tipZ = -(front + BOSS_INTRO_BODY_OUT_M);
    expect(eye.z).toBeLessThan(tipZ);
    const along = (tipZ - eye.z) / view.z;
    expect(eye.x + view.x * along).toBeCloseTo(0);
    expect(eye.y + view.y * along).toBeGreaterThan(0);

    // Herbert on the same portal still cuts at 3 m
    const herbert = boss('herbert');
    spawn(herbert);
    wholeIntro();
    herbert.walked = front + BOSS_INTRO_CLEAR_MARGIN_M;
    frame();
    expect(service.card()).toEqual({ name: 'Herbert', wave: 10 });
  });

  it('369: photo mode when Herbert steps out: no intro, and none once photo mode is left either', () => {
    photoMode.set(true);
    const herbert = boss('herbert');
    spawn(herbert);
    herbert.walked = OUT_M;
    frame();
    expect(service.active()).toBe(false);

    photoMode.set(false);
    herbert.walked = 60;
    play(2000);
    expect(service.active()).toBe(false);
    expect(paused()).toBe(false);
    viewIsBack();
  });

  it('369: Boss Intro off when Herbert steps out: no intro, and switching it on again brings none for him', () => {
    bossIntroEnabled.set(false);
    const herbert = boss('herbert');
    spawn(herbert);
    herbert.walked = OUT_M;
    frame();
    expect(service.active()).toBe(false);

    bossIntroEnabled.set(true);
    play(1000);
    expect(service.active()).toBe(false);
    viewIsBack();
  });

  it('370: at 4x the intro plays, the game is back at 4x afterwards, the view exactly as before', () => {
    // GameStore.gameSpeed is the HUD speed; the intro only reads it
    timescale.set(4);
    const herbert = boss('herbert');
    herbert.walked = OUT_M;
    spawn(herbert);
    frame();
    expect(service.stage()).toBe('dip-in');
    expect(paused()).toBe(true);

    wholeIntro();
    expect(service.active()).toBe(false);
    expect(timescale()).toBe(4);
    expect(paused()).toBe(false);
    viewIsBack();
  });

  it('423: Herbert and the Ooze out together: one intro "Herbert & Ooze", no second', () => {
    const herbert = boss('herbert');
    const ooze = boss('ooze');
    spawn(herbert);
    spawn(ooze);
    herbert.walked = OUT_M;
    ooze.walked = 4; // still in its portal
    frame();
    expect(service.card()).toEqual({ name: 'Herbert & Ooze', wave: 10 });
    wholeIntro();

    ooze.walked = OUT_M;
    play(1000);
    expect(service.active()).toBe(false);
  });
});
