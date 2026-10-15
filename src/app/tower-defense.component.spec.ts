/**
 * The game component's own logic (TODO E94), without rendering it: the start
 * (token screen or the start sequence), the window keys in their order, the
 * Esc a tooltip would take, the notice timer, the controls hint waiting for
 * the intro flight, the start menu and the coop and place menus, and the
 * teardown. Every service is a stub; the component is constructed in an
 * injection context, as Angular would, and its effects are flushed by hand.
 */
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementRef, signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';

import { TowerDefenseComponent } from './tower-defense.component';
import { SimClient } from './sim/client/sim-client.service';
import { PresentationService } from './presentation/presentation.service';
import { RouteGridVizService } from './services/world/route-grid-viz.service';
import { RunLogFacade } from './run-log/run-log.facade';
import { SaveGameService } from './services/save-game/save-game.service';
import { UIStore } from './store/ui.store';
import { ConfigService } from './core/services/config.service';
import { CameraControlService } from './services/camera-control.service';
import { InputHandlerService } from './services/input-handler.service';
import { HotkeyService } from './services/hotkey.service';
import { TowerUpgradeService } from './services/tower-upgrade.service';
import { TowerPlacementService } from './services/tower-placement.service';
import { MapPlacementService } from './services/world/map-placement.service';
import { AbilityTargetingService } from './services/ability-targeting.service';
import { LocationManagementService } from './services/location/location-management.service';
import { EngineInitializationService } from './services/infrastructure/engine-initialization.service';
import { LocationChangeCoordinatorService } from './services/location/location-change-coordinator.service';
import { WorldContext } from './world/world-context.service';
import { TowerDefenseFacadeService } from './services/facade/tower-defense-facade.service';
import { VisualizationFacadeService } from './services/facade/visualization-facade.service';
import { TowerDefenseStore } from './store/tower-defense.store';
import { BestWaveService } from './services/location/best-wave.service';
import { PhotoModeService } from './services/photo-mode.service';
import { BossIntroService } from './services/boss-intro.service';
import { ReplayService } from './services/replay.service';
import { CoopService } from './services/coop.service';
import { TowerControlService } from './services/tower-control.service';
import { MainMenuService } from './components/main-menu/main-menu.service';
import { WaveDebugService } from './services/debug/wave-debug.service';
import { EnemyDebugService } from './services/debug/enemy-debug.service';
import { DebugFacadeService } from './services/debug/debug-facade.service';
import { DebugWindowService } from './services/debug/debug-window.service';
import { BotClientService } from './bots/bot-client.service';
import { ResearchStore } from './store/research.store';
import { IntroCameraFlightService } from './services/world/intro-camera-flight.service';
import { RefusalHintService } from './services/refusal-hint.service';
import { HeroControlService } from './services/hero-control.service';
import { OnboardingService } from './services/onboarding/onboarding.service';
import { CamoHintService } from './services/camo-hint.service';
import { AssetManagerService } from './services/infrastructure/asset-manager.service';
import { WhatsNewService } from './services/onboarding/whats-new.service';
import { BenchmarkService } from './benchmark/benchmark.service';
import { RenderBenchmarkService } from './benchmark/render-benchmark.service';

/** A tooltip open over the page, the pane Material puts it in */
function tooltipPane(): HTMLElement {
  const pane = document.createElement('div');
  pane.className = 'cdk-overlay-pane mat-mdc-tooltip-panel';
  pane.appendChild(document.createElement('div'));
  document.body.appendChild(pane);
  return pane;
}

/** Everything the component reads, as stubs a test can steer */
function stubs() {
  const order: string[] = [];
  const key = (name: string, takes = false) => vi.fn(() => (order.push(name), takes));
  return {
    order,
    ui: {
      notice: signal<{ text: string; reload?: boolean } | null>(null),
      effectiveMusicVolume: signal(0.5),
      effectiveSfxVolume: signal(0.6),
      effectiveUiVolume: signal(0.7),
      mainMenuOpen: signal(false),
      devMenuExpanded: signal(false),
      viewOnly: signal(false),
      mapPlacementMode: signal(null),
      coopMapLocked: signal(false),
      coopDockOpen: signal(false),
      masterMuted: signal(false),
      cyclePerTowerLosFilter: vi.fn(),
    },
    store: {
      loading: signal(true),
      error: signal<string | null>(null),
      buildMode: signal(false),
      baseCoords: signal({ lat: 0, lon: 0 }),
      streetCount: signal(0),
      fps: signal(60),
      tileStats: signal(null),
      mapAttribution: signal<string[]>([]),
      compassRotation: signal(0),
      cameraFramingDebug: signal(false),
      worldRegenerating: signal(false),
      waveActive: signal(false),
      isGameOver: signal(false),
      selectedTowerType: signal(null),
      selectedTower: signal(null),
      selectedTowerRevision: signal(0),
      hero: signal(null),
      credits: signal(0),
      phase: signal('setup'),
      waveNumber: signal(0),
    },
    menu: {
      layer: signal<'start' | 'game'>('start'),
      automated: false,
      placeLoading: signal(false),
      problem: signal(null),
      openStart: vi.fn(),
      open: vi.fn(),
    },
    config: {
      credentialsRejected: signal(false),
      setupRequested: signal(false),
      needsCredentials: vi.fn(() => false),
    },
    world: { capabilities: signal({ credentials: true }) },
    facade: { initEffects: vi.fn(), startGame: vi.fn(async () => undefined), dispose: vi.fn(), startMapPlacement: vi.fn(), startWave: vi.fn() },
    presentation: { setMusicVolume: vi.fn() },
    bossIntro: { handleKeyDown: key('boss') },
    intro: { active: signal(false), handleKeyDown: key('intro') },
    input: { handleKeyDown: key('input'), handleKeyUp: vi.fn(), handleWindowBlur: vi.fn() },
    hotkeys: { handleKeyDown: key('hotkeys'), handleKeyUp: vi.fn(), handleWindowBlur: vi.fn() },
    photo: { trapTab: key('photo') },
    replay: { trapTab: key('replay'), recordedWave: signal(null), saveFile: vi.fn() },
    coop: { inGame: signal(false), isHost: signal(false), summary: signal(null), room: signal<object | null>(null), status: signal('idle'), intent: signal(null) },
    onboarding: { tip: signal<string | null>('Build a tower'), skip: vi.fn(), hide: vi.fn() },
    bot: { botEnabled: signal(false), botSkillLevel: signal('normal'), botStats: signal(null), enableBot: vi.fn(), disableBot: vi.fn() },
    whatsNew: { showAfterUpdate: vi.fn() },
    benchmark: { requested: false, runIfRequested: vi.fn() },
    dialog: { afterOpened: new Subject<never>() },
  };
}

describe('TowerDefenseComponent', () => {
  let s: ReturnType<typeof stubs>;
  let component: TowerDefenseComponent;
  const reload = vi.fn();
  const originalLocation = window.location;

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    vi.useFakeTimers();
    s = stubs();
    reload.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, search: '', reload } });
    const providers = [
      [SimClient, {}],
      [PresentationService, s.presentation],
      [RouteGridVizService, { toggleAirRouteLayer: vi.fn() }],
      [RunLogFacade, { waveSeries: signal([]), export: vi.fn(() => true) }],
      [SaveGameService, {}],
      [UIStore, s.ui],
      [ConfigService, s.config],
      [CameraControlService, { resetCamera: vi.fn() }],
      [InputHandlerService, s.input],
      [HotkeyService, s.hotkeys],
      [TowerUpgradeService, { buy: vi.fn(() => true) }],
      [TowerPlacementService, { validationReason: signal(null), exitBuildMode: vi.fn() }],
      [MapPlacementService, { validationReason: signal(null) }],
      [AbilityTargetingService, { targeting: signal(null), warning: signal(null) }],
      [LocationManagementService, { editableHqLocation: signal(null), editableSpawnLocations: signal([]), favorites: signal([]), getLocationDisplayName: () => 'Here' }],
      [EngineInitializationService, { loading: signal(false) }],
      [LocationChangeCoordinatorService, { favoriteNamesMap: signal(new Map()) }],
      [WorldContext, s.world],
      [TowerDefenseFacadeService, s.facade],
      [VisualizationFacadeService, { buildingFootprints: () => [] }],
      [TowerDefenseStore, s.store],
      [BestWaveService, {}],
      [PhotoModeService, s.photo],
      [BossIntroService, s.bossIntro],
      [ReplayService, s.replay],
      [CoopService, s.coop],
      [TowerControlService, {}],
      [MainMenuService, s.menu],
      [WaveDebugService, {}],
      [EnemyDebugService, {}],
      [DebugFacadeService, {}],
      [DebugWindowService, { hasOpenWindows: signal(false) }],
      [BotClientService, s.bot],
      [ResearchStore, { airTargetingUnlocked: signal(false) }],
      [IntroCameraFlightService, s.intro],
      [RefusalHintService, { refusal: signal(null) }],
      [HeroControlService, { selected: signal(false), warning: signal(null) }],
      [OnboardingService, s.onboarding],
      [CamoHintService, {}],
      [AssetManagerService, { failedModels: signal<string[]>([]) }],
      [WhatsNewService, s.whatsNew],
      [BenchmarkService, s.benchmark],
      [RenderBenchmarkService, { requested: false, runIfRequested: vi.fn() }],
      [MatDialog, s.dialog],
    ].map(([provide, useValue]) => ({ provide, useValue }));
    TestBed.configureTestingModule({ providers });
    component = TestBed.runInInjectionContext(() => new TowerDefenseComponent());
    component.gameCanvas = new ElementRef(document.createElement('canvas'));
    TestBed.tick();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.useRealTimers();
  });

  describe('start and teardown', () => {
    it('starts the game behind the start menu and hands it the volumes once it is up', async () => {
      s.presentation.setMusicVolume.mockClear();
      await component.ngAfterViewInit();
      expect(s.facade.initEffects).toHaveBeenCalledWith(component);
      expect(s.menu.openStart).toHaveBeenCalledTimes(1);
      expect(s.menu.open).not.toHaveBeenCalled();
      expect(s.facade.startGame).toHaveBeenCalledWith(component.gameCanvas.nativeElement);
      expect(s.presentation.setMusicVolume).toHaveBeenCalledWith(0.5);
      expect(component.awaitingCredentials()).toBe(false);
    });

    it('an invite link opens the coop page of the start menu', async () => {
      window.location.search = '?room=ABC123';
      s.ui.mainMenuOpen.set(true);
      await component.ngAfterViewInit();
      expect(s.menu.open).toHaveBeenCalledWith('coop');
    });

    it('asks for tile credentials first where the world needs them, then starts on save', async () => {
      s.config.needsCredentials.mockReturnValue(true);
      await component.ngAfterViewInit();
      expect(component.awaitingCredentials()).toBe(true);
      expect(component.tokenScreen()).toBe(true);
      expect(s.facade.startGame).not.toHaveBeenCalled();

      await component.onCredentialsSaved();
      expect(component.awaitingCredentials()).toBe(false);
      expect(s.facade.startGame).toHaveBeenCalledTimes(1);
      // Credentials again in a running game (a key refused mid-flight): a reload rebuilds the tiles
      await component.onCredentialsSaved();
      expect(reload).toHaveBeenCalledTimes(1);
      expect(s.facade.startGame).toHaveBeenCalledTimes(1);
    });

    it('a world without credentials (a map, DevWorld) never asks, ?tokensetup or not', async () => {
      s.config.needsCredentials.mockReturnValue(true);
      s.world.capabilities.set({ credentials: false });
      window.location.search = '?tokensetup';
      await component.ngAfterViewInit();
      expect(component.awaitingCredentials()).toBe(false);
      expect(s.facade.startGame).toHaveBeenCalledTimes(1);
    });

    it('?tokensetup forces the token screen even with a key in place', async () => {
      window.location.search = '?tokensetup';
      await component.ngAfterViewInit();
      expect(component.awaitingCredentials()).toBe(true);
      expect(s.facade.startGame).not.toHaveBeenCalled();
    });

    it('disposes the facade and drops its Esc listener on teardown', () => {
      TestBed.resetTestingModule();
      component.ngOnDestroy();
      expect(s.facade.dispose).toHaveBeenCalledTimes(1);
      // The capture listener went with the injector: an Esc past a tooltip reaches no handler
      const pane = tooltipPane();
      try {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(s.order).toEqual([]);
      } finally {
        pane.remove();
      }
    });
  });

  describe('window keys', () => {
    const press = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      component.onKeyDown(event);
      return event;
    };

    it('hands a key to the boss intro, the intro flight, the bar traps, the input handler and the hotkeys in turn', () => {
      press('b');
      expect(s.order).toEqual(['boss', 'intro', 'photo', 'replay', 'input', 'hotkeys']);
    });

    it('stops at the boss intro or the intro flight when one takes the key', () => {
      s.bossIntro.handleKeyDown.mockImplementationOnce(() => (s.order.push('boss'), true));
      press('Escape');
      expect(s.order).toEqual(['boss']);
      s.order.length = 0;
      s.intro.handleKeyDown.mockImplementationOnce(() => (s.order.push('intro'), true));
      press('Home');
      expect(s.order).toEqual(['boss', 'intro']);
    });

    it('leaves every key to the main menu while it is open', () => {
      s.ui.mainMenuOpen.set(true);
      press('Escape');
      press('Tab');
      expect(s.order).toEqual([]);
    });

    it('takes an Esc a tooltip would spend on its way down, once', () => {
      const pane = tooltipPane();
      try {
        const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
        window.dispatchEvent(event);
        expect(s.order.filter((n) => n === 'hotkeys')).toHaveLength(1);
        // The window listener sees the same event afterwards and leaves it
        component.onKeyDown(event);
        expect(s.order.filter((n) => n === 'hotkeys')).toHaveLength(1);
      } finally {
        pane.remove();
      }
    });

    it('passes key up and window blur to the input handler and the hotkeys', () => {
      const up = new KeyboardEvent('keyup', { key: 'w' });
      component.onKeyUp(up);
      component.onWindowBlur();
      expect(s.input.handleKeyUp).toHaveBeenCalledWith(up);
      expect(s.hotkeys.handleKeyUp).toHaveBeenCalledWith(up);
      expect(s.input.handleWindowBlur).toHaveBeenCalledTimes(1);
      expect(s.hotkeys.handleWindowBlur).toHaveBeenCalledTimes(1);
    });
  });

  describe('menus and hints', () => {
    it('closes a notice after a while, one waiting for a reload stays', () => {
      s.ui.notice.set({ text: 'Saved' });
      TestBed.tick();
      vi.advanceTimersByTime(60_000);
      expect(s.ui.notice()).toBeNull();
      s.ui.notice.set({ text: 'Models missing', reload: true });
      TestBed.tick();
      vi.advanceTimersByTime(60_000);
      expect(s.ui.notice()).toEqual({ text: 'Models missing', reload: true });
    });

    it('raises a notice when a model did not load', () => {
      const assets = TestBed.inject(AssetManagerService) as unknown as { failedModels: ReturnType<typeof signal<string[]>> };
      assets.failedModels.set(['zombie']);
      TestBed.tick();
      expect(s.ui.notice()?.reload).toBe(true);
    });

    it('starts the controls hint timer only after the intro flight', async () => {
      s.intro.active.set(true);
      await component.ngAfterViewInit();
      TestBed.tick();
      vi.advanceTimersByTime(20_000);
      expect(component.controlsHintVisible()).toBe(true);
      s.intro.active.set(false);
      TestBed.tick();
      vi.advanceTimersByTime(15_000);
      expect(component.controlsHintVisible()).toBe(false);
    });

    it('shows the onboarding tip only in the running game, not under the intro flight', () => {
      expect(component.onboardingTip()).toBeNull();
      s.store.loading.set(false);
      expect(component.onboardingTip()).toBe('Build a tower');
      s.intro.active.set(true);
      expect(component.onboardingTip()).toBeNull();
      s.intro.active.set(false);
      s.ui.mainMenuOpen.set(true);
      expect(component.onboardingTip()).toBeNull();
    });

    it('shows the HUD once loaded and the start menu is gone', () => {
      s.ui.mainMenuOpen.set(true);
      s.store.loading.set(false);
      expect(component.startMenu()).toBe(true);
      expect(component.hudShown()).toBe(false);
      s.ui.mainMenuOpen.set(false);
      expect(component.hudShown()).toBe(true);
      s.store.error.set('Tiles refused');
      expect(component.hudShown()).toBe(false);
    });

    it('checks for what is new once the game is up, or runs a requested benchmark instead', () => {
      expect(s.whatsNew.showAfterUpdate).not.toHaveBeenCalled();
      s.store.loading.set(false);
      TestBed.tick();
      expect(s.whatsNew.showAfterUpdate).toHaveBeenCalledTimes(1);
      s.store.loading.set(true);
      TestBed.tick();
      s.store.loading.set(false);
      TestBed.tick();
      expect(s.whatsNew.showAfterUpdate).toHaveBeenCalledTimes(1);
    });

    it('opens the coop page, or the dock while a room is open or joining', () => {
      component.openCoop();
      expect(s.menu.open).toHaveBeenCalledWith('coop');
      s.coop.room.set({ code: 'ABC123', players: [] });
      component.openCoop();
      expect(s.ui.coopDockOpen()).toBe(true);
      component.openCoop();
      expect(s.ui.coopDockOpen()).toBe(false);
    });

    it('opens the place choice only while the coop map is not locked', () => {
      s.ui.coopMapLocked.set(true);
      component.openPlaceChoice();
      expect(s.menu.open).not.toHaveBeenCalled();
      s.ui.coopMapLocked.set(false);
      component.openPlaceChoice();
      expect(s.menu.open).toHaveBeenCalledWith('new-game');
    });

    it('lets HQ and spawns be placed only before wave 1 in setup, not while the coop map is locked', () => {
      expect(component.canPlaceOnMap()).toBe(true);
      s.store.waveNumber.set(1);
      expect(component.canPlaceOnMap()).toBe(false);
      s.store.waveNumber.set(0);
      s.ui.coopMapLocked.set(true);
      expect(component.canPlaceOnMap()).toBe(false);
    });

    it('plays a bot run silent', () => {
      s.presentation.setMusicVolume.mockClear();
      s.bot.botEnabled.set(true);
      TestBed.tick();
      expect(s.presentation.setMusicVolume).toHaveBeenLastCalledWith(0);
    });
  });

  it('keeps the engine and street network the facade hands it through the bridge', () => {
    const bridge = component.getFacadeBridge();
    const engine = {} as never;
    bridge.setEngine(engine);
    bridge.setStreetNetworkLocation({ lat: 1, lon: 2 });
    expect(bridge.getEngine()).toBe(engine);
    expect(bridge.getStreetNetworkLocation()).toEqual({ lat: 1, lon: 2 });
    expect(bridge.getCanvasElement()).toBe(component.gameCanvas.nativeElement);
  });
});
