// IntroSkipComponent is JIT-compiled
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed; the key handling needs no engine
vi.mock('../../three-engine', () => ({}));
vi.mock('./route-animation.service', () => ({ RouteAnimationService: class RouteAnimationService {} }));
vi.mock('../camera-control.service', () => ({ CameraControlService: class CameraControlService {} }));
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));
vi.mock('../../components/hotkey-help-dialog/open-hotkey-help-dialog', () => ({
  openHotkeyHelpDialog: (dialog: { open: () => void }) => dialog.open(),
}));
vi.mock('../facade/tower-defense-facade.service', () => ({
  TowerDefenseFacadeService: class TowerDefenseFacadeService {},
}));
vi.mock('../../managers/game-state.manager', () => ({ GameStateManager: class GameStateManager {} }));
vi.mock('../tower-placement.service', () => ({ TowerPlacementService: class TowerPlacementService {} }));
vi.mock('./map-placement.service', () => ({ MapPlacementService: class MapPlacementService {} }));
vi.mock('../ability-targeting.service', () => ({ AbilityTargetingService: class AbilityTargetingService {} }));
vi.mock('../photo-mode.service', () => ({ PhotoModeService: class PhotoModeService {} }));
vi.mock('../hero-control.service', () => ({ HeroControlService: class HeroControlService {} }));
vi.mock('../replay.service', () => ({ ReplayService: class ReplayService {} }));

import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { IntroCameraFlightService } from './intro-camera-flight.service';
import { RouteAnimationService } from './route-animation.service';
import { CameraControlService } from '../camera-control.service';
import { HotkeyService } from '../hotkey.service';
import { InputHandlerService } from '../input-handler.service';
import { KeyboardPanService } from '../keyboard-pan.service';
import { TowerDefenseFacadeService } from '../facade/tower-defense-facade.service';
import { GameStateManager } from '../../managers/game-state.manager';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { GameStore } from '../../store/game.store';
import { UIStore } from '../../store/ui.store';
import { ResearchStore } from '../../store/research.store';
import { TowerPlacementService } from '../tower-placement.service';
import { MapPlacementService } from './map-placement.service';
import { SellConfirmService } from '../sell-confirm.service';
import { AbilityTargetingService } from '../ability-targeting.service';
import { PhotoModeService } from '../photo-mode.service';
import { HeroControlService } from '../hero-control.service';
import { ReplayService } from '../replay.service';
import { UpgradeHintService } from '../upgrade-hint.service';
import { TowerUpgradeService } from '../tower-upgrade.service';
import { IntroSkipComponent } from '../../components/intro-skip/intro-skip.component';

const HQ = { lat: 48.7, lon: 9.1 };

/**
 * Playtest 525 to 528 (docs/REVIEW_FIX_2026-09-14.md) replayed: the real
 * intro flight, input handler and hotkey service in the order the game
 * component's window keydown runs them, the canvas and the skip button, an
 * open dialog as the CDK dialog takes Esc.
 */
describe('Intro flight input, playtest 525 to 528 replayed', () => {
  let intro: IntroCameraFlightService;
  let input: InputHandlerService;
  let hotkeys: HotkeyService;
  let skip: IntroSkipComponent;
  let canvas: HTMLCanvasElement;
  let resetCamera: ReturnType<typeof vi.fn>;
  let focusGeo: ReturnType<typeof vi.fn>;
  let startWave: ReturnType<typeof vi.fn>;
  let selectTowerType: ReturnType<typeof vi.fn>;
  let openDialog: ReturnType<typeof vi.fn>;
  let pan: { onKeyDown: ReturnType<typeof vi.fn>; onKeyUp: ReturnType<typeof vi.fn> };
  let openDialogs: unknown[];
  const controls = { enabled: true };
  const paused = signal(false);
  const cleanups: (() => void)[] = [];

  beforeEach(() => {
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    resetCamera = vi.fn();
    focusGeo = vi.fn(() => true);
    startWave = vi.fn();
    selectTowerType = vi.fn();
    openDialog = vi.fn();
    openDialogs = [];
    paused.set(false);
    controls.enabled = true;
    // KeyboardPanService takes WASD and the arrows
    pan = { onKeyDown: vi.fn((e: KeyboardEvent) => /^([wasd]|Arrow\w+)$/i.test(e.key)), onKeyUp: vi.fn() };

    const flightInjector = Injector.create({
      providers: [
        { provide: CameraControlService, useValue: { resetCamera, focusGeo } },
        { provide: RouteAnimationService, useValue: { setHoldUntilReleased: vi.fn() } },
        { provide: NgZone, useValue: { run: (fn: () => void) => fn() } },
      ],
    });
    intro = runInInjectionContext(flightInjector, () => new IntroCameraFlightService());
    intro.initialize({
      getRenderer: () => ({ domElement: canvas }),
      getControls: () => controls,
      getCamera: () => ({}),
    } as never);

    const injector = Injector.create({
      providers: [
        { provide: IntroCameraFlightService, useValue: intro },
        { provide: CameraControlService, useValue: { resetCamera, focusGeo } },
        { provide: TowerDefenseFacadeService, useValue: { startWave, upgradeTower: vi.fn(), sellSelectedTower: vi.fn() } },
        { provide: GameStateManager, useValue: { towerManager: { selectTower: vi.fn() }, tilesEngine: null } },
        {
          provide: TowerDefenseStore,
          useValue: {
            loading: signal(false),
            error: signal<string | null>(null),
            selectedTower: signal(null),
            selectedTowerId: signal(null),
            credits: signal(10_000),
            canStartWave: signal(true),
            isGameOver: signal(false),
            baseCoords: signal(HQ),
            spawnPoints: signal([{ lat: 48.71, lon: 9.1 }]),
          },
        },
        { provide: GameStore, useValue: { paused, trainingTimescale: signal(1) } },
        {
          provide: UIStore,
          useValue: {
            openMenu: signal(null),
            mapPlacementMode: signal(null),
            buildMode: signal(false),
            selectedTowerType: signal(null),
            viewOnly: signal(false),
          },
        },
        {
          provide: ResearchStore,
          useValue: {
            centerPlaced: signal(false),
            maxUpgradeTier: signal(1),
            isTowerUnlocked: (id: string) => id === 'archer' || id === 'research-center',
          },
        },
        { provide: TowerPlacementService, useValue: { selectTowerType, buildMode: () => false } },
        { provide: MapPlacementService, useValue: { startRotating: () => false } },
        { provide: KeyboardPanService, useValue: pan },
        { provide: SellConfirmService, useValue: new SellConfirmService() },
        { provide: MatDialog, useValue: { open: openDialog, get openDialogs() { return openDialogs; } } },
        { provide: AbilityTargetingService, useValue: { targeting: signal(null), start: vi.fn(), cancel: vi.fn() } },
        { provide: PhotoModeService, useValue: { active: signal(false), toggle: vi.fn(), exit: vi.fn() } },
        {
          provide: HeroControlService,
          useValue: { selected: signal(false), summon: vi.fn(() => false), cycleAmmo: vi.fn(() => false), deselect: vi.fn() },
        },
        { provide: ReplayService, useValue: { active: signal(false) } },
        { provide: UpgradeHintService, useValue: new UpgradeHintService() },
        // U buys through it; no key here reaches a purchase
        { provide: TowerUpgradeService, useValue: { buyFirst: vi.fn(() => false) } },
      ],
    });
    input =runInInjectionContext(injector, () => new InputHandlerService());
    hotkeys = runInInjectionContext(injector, () => new HotkeyService());
    skip = runInInjectionContext(injector, () => new IntroSkipComponent());
  });

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()!();
    intro.stop();
    canvas.remove();
  });

  /** The flight as beginRun() leaves it: running, the controls off, the canvas listening */
  const startFlight = () => {
    const flight = intro as unknown as { running: boolean; attachCancelHandlers(): void };
    flight.attachCancelHandlers();
    flight.running = true;
    intro.active.set(true);
    controls.enabled = false;
  };

  /**
   * TowerDefenseComponent.onKeyDown in its order; the boss intro is not
   * running and the Tab traps of photo mode and replay take no other key.
   */
  const onWindowKeyDown = (event: KeyboardEvent) => {
    if (intro.handleKeyDown(event)) return;
    input.handleKeyDown(event);
    hotkeys.handleKeyDown(event);
  };
  const press = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    onWindowKeyDown(event);
    return event;
  };
  const keydown = (target: EventTarget, key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  const listen = (target: EventTarget, type: string, listener: (e: Event) => void) => {
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  };
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K) => {
    const el = document.createElement(tag);
    document.body.appendChild(el);
    cleanups.push(() => el.remove());
    return el;
  };
  /**
   * An open CDK dialog: its DialogRef takes Esc from the overlay keydown
   * dispatcher on the body, prevents it and closes (@angular/cdk dialog.mjs,
   * DialogRef constructor; both dialogs here open with disableClose false).
   */
  const openDialogOnBody = () => {
    openDialogs.push({});
    listen(document.body, 'keydown', (e) => {
      if ((e as KeyboardEvent).key !== 'Escape' || openDialogs.length === 0) return;
      e.preventDefault();
      openDialogs.length = 0;
    });
  };

  it('525: Home, N, W, Space, 1, H and P do nothing while it flies; Esc ends it, then Home flies to the HQ', () => {
    startFlight();
    for (const key of ['Home', 'n', 'w', ' ', '1', 'h', 'p']) press(key);
    expect(intro.isRunning()).toBe(true);
    expect(focusGeo).not.toHaveBeenCalled();
    expect(pan.onKeyDown).not.toHaveBeenCalled();
    expect(startWave).not.toHaveBeenCalled();
    expect(selectTowerType).not.toHaveBeenCalled();
    expect(openDialog).not.toHaveBeenCalled();
    expect(paused()).toBe(false);

    expect(press('Escape').defaultPrevented).toBe(true);
    expect(intro.isRunning()).toBe(false);
    expect(intro.active()).toBe(false);
    expect(resetCamera).toHaveBeenCalledTimes(1);
    expect(controls.enabled).toBe(true);

    press('Home');
    expect(focusGeo).toHaveBeenCalledWith(HQ.lat, HQ.lon);
  });

  it('526: a click on the map, the wheel and Skip Intro each end the flight', () => {
    startFlight();
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(intro.isRunning()).toBe(false);

    startFlight();
    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    expect(intro.isRunning()).toBe(false);

    startFlight();
    skip.skip();
    expect(intro.isRunning()).toBe(false);
    expect(resetCamera).toHaveBeenCalledTimes(3);
    expect(controls.enabled).toBe(true);
  });

  it('527: typing in the location search works and the Esc that closes the dialog leaves the flight flying', () => {
    startFlight();
    listen(window, 'keydown', (e) => onWindowKeyDown(e as KeyboardEvent));
    // "DEFEND <place>" in the header: a click outside the canvas
    element('button').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    openDialogOnBody();
    const search = element('input');
    search.type = 'text';

    for (const key of ['P', 'a', 'r', 'i', 's', ' ']) {
      expect(keydown(search, key).defaultPrevented, key).toBe(false);
    }
    expect(intro.isRunning()).toBe(true);
    expect(pan.onKeyDown).not.toHaveBeenCalled();
    expect(startWave).not.toHaveBeenCalled();

    expect(keydown(search, 'Escape').defaultPrevented).toBe(true);
    expect(openDialogs).toEqual([]);
    expect(intro.isRunning()).toBe(true);
    expect(resetCamera).not.toHaveBeenCalled();
  });

  it('528: Keys opens the overview during the flight, Esc closes it, a second Esc skips the flight', () => {
    startFlight();
    listen(window, 'keydown', (e) => onWindowKeyDown(e as KeyboardEvent));
    // Sidebar foot "Keys" (GameSidebarComponent.openHotkeys): a click outside the canvas
    const keysButton = element('button');
    keysButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    openDialogOnBody();
    expect(intro.isRunning()).toBe(true);

    keydown(keysButton, 'Escape');
    expect(openDialogs).toEqual([]);
    expect(intro.isRunning()).toBe(true);

    keydown(keysButton, 'Escape');
    expect(intro.isRunning()).toBe(false);
    expect(resetCamera).toHaveBeenCalledTimes(1);
  });
});
