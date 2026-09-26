import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

// Only their DI tokens are needed. The real modules pull in Material's
// dialog, which needs the JIT compiler under vitest.
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));
vi.mock('../components/hotkey-help-dialog/open-hotkey-help-dialog', () => ({
  openHotkeyHelpDialog: (dialog: { open: () => void }) => dialog.open(),
}));
vi.mock('./facade/tower-defense-facade.service', () => ({
  TowerDefenseFacadeService: class TowerDefenseFacadeService {},
}));
vi.mock('../managers/game-state.manager', () => ({ GameStateManager: class GameStateManager {} }));
vi.mock('./tower-placement.service', () => ({ TowerPlacementService: class TowerPlacementService {} }));
vi.mock('./camera-control.service', () => ({ CameraControlService: class CameraControlService {} }));
vi.mock('./world/intro-camera-flight.service', () => ({
  IntroCameraFlightService: class IntroCameraFlightService {},
}));
vi.mock('./ability-targeting.service', () => ({
  AbilityTargetingService: class AbilityTargetingService {},
}));
vi.mock('./photo-mode.service', () => ({ PhotoModeService: class PhotoModeService {} }));
vi.mock('./hero-control.service', () => ({ HeroControlService: class HeroControlService {} }));
vi.mock('./replay.service', () => ({ ReplayService: class ReplayService {} }));
vi.mock('./tower-control.service', () => ({ TowerControlService: class TowerControlService {} }));

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { HotkeyService } from './hotkey.service';
import { TowerDefenseFacadeService } from './facade/tower-defense-facade.service';
import { GameStateManager } from '../managers/game-state.manager';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { GameStore } from '../store/game.store';
import { UIStore } from '../store/ui.store';
import { ResearchStore } from '../store/research.store';
import { TowerPlacementService } from './tower-placement.service';
import { SellConfirmService } from './sell-confirm.service';
import { CameraControlService } from './camera-control.service';
import { IntroCameraFlightService } from './world/intro-camera-flight.service';
import { AbilityTargetingService } from './ability-targeting.service';
import { PhotoModeService } from './photo-mode.service';
import { HeroControlService } from './hero-control.service';
import { ReplayService } from './replay.service';
import { TowerControlService } from './tower-control.service';
import { UpgradeHintService } from './upgrade-hint.service';
import { TowerUpgradeService } from './tower-upgrade.service';
import { TOWER_TYPES, UpgradeId } from '../configs/tower-types.config';
import { DebugFacadeService } from './debug/debug-facade.service';

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
  return event;
}

function release(key: string): KeyboardEvent {
  return new KeyboardEvent('keyup', { key, cancelable: true });
}

describe('HotkeyService', () => {
  const setHealthBarsInverted = vi.fn();
  let service: HotkeyService;
  let facade: { startWave: ReturnType<typeof vi.fn>; upgradeTower: ReturnType<typeof vi.fn>; sellSelectedTower: ReturnType<typeof vi.fn> };
  let selectTower: ReturnType<typeof vi.fn>;
  let selectTowerType: ReturnType<typeof vi.fn>;
  let openDialog: ReturnType<typeof vi.fn>;
  let openDialogs: unknown[];
  let sellConfirm: SellConfirmService;
  let focusGeo: ReturnType<typeof vi.fn>;
  const introActive = signal(false);
  /** Whether the strike could fire, AbilityTargetingService.start checks it */
  let strikeCanFire: boolean;
  const abilityTargeting = {
    targeting: signal<string | null>(null),
    start: vi.fn((id: string) => {
      if (strikeCanFire) abilityTargeting.targeting.set(id);
    }),
    cancel: vi.fn(() => abilityTargeting.targeting.set(null)),
  };
  const photoActive = signal(false);
  const photoMode = {
    active: photoActive,
    toggle: vi.fn(() => photoActive.update((on) => !on)),
    exit: vi.fn(() => photoActive.set(false)),
  };
  /** Whether the hero is hired, HeroControlService.summon and cycleAmmo check it */
  let heroHired: boolean;
  const heroControl = {
    selected: signal(false),
    summon: vi.fn(() => heroHired),
    deselect: vi.fn(() => heroControl.selected.set(false)),
    cycleAmmo: vi.fn(() => heroHired),
  };
  const replayActive = signal(false);
  const replay = {
    active: replayActive,
    togglePlay: vi.fn(),
    stepSpeed: vi.fn(),
    exit: vi.fn(() => replayActive.set(false)),
  };
  const mannedActive = signal(false);
  const towerControl = {
    active: mannedActive,
    toggle: vi.fn(() => true),
    exit: vi.fn(() => mannedActive.set(false)),
    update: vi.fn(),
  };

  /** Level per track; facade.upgradeTower raises it like the real command */
  let levels: Record<string, number>;
  const tower = {
    id: 't1',
    position: { lat: 48.7, lon: 9.1, height: 300 },
    typeConfig: { shootHeight: 2, upgrades: [{ id: 'damage', name: 'Damage' }, { id: 'speed', name: 'Speed' }] },
    getSellValue: () => 50,
    getAvailableUpgrades: () => [{ id: 'damage' as UpgradeId }, { id: 'speed' as UpgradeId }],
    getNextUpgradeCost: (id: UpgradeId) => (id === 'damage' ? 500 : 30),
    getUpgradeLevel: (id: UpgradeId) => levels[id] ?? 0,
  };
  let spawnFloatingText: ReturnType<typeof vi.fn>;
  let upgradeHint: UpgradeHintService;

  const store = {
    loading: signal(false),
    error: signal<string | null>(null),
    selectedTower: signal<typeof tower | null>(null),
    credits: signal(10_000),
    canStartWave: signal(true),
    isGameOver: signal(false),
    placedUniqueTypes: signal(new Set<string>()),
    baseCoords: signal({ lat: 48.7, lon: 9.1 }),
    spawnPoints: signal([{ lat: 48.71, lon: 9.1 }, { lat: 48.69, lon: 9.12 }]),
  };
  const gameStore = { paused: signal(false), gameSpeed: signal(1) };
  const uiStore = {
    openMenu: signal<string | null>(null),
    mapPlacementMode: signal<'hq' | 'spawn' | null>(null),
    buildMode: signal(false),
    selectedTowerType: signal<string | null>(null),
    coopDockOpen: signal(false),
  };
  const research = {
    maxUpgradeTier: signal(1),
    isTowerUnlocked: (id: string) => id === 'archer' || id === 'research-center',
  };

  beforeEach(() => {
    store.loading.set(false);
    store.error.set(null);
    store.selectedTower.set(null);
    store.credits.set(10_000);
    store.canStartWave.set(true);
    store.isGameOver.set(false);
    gameStore.paused.set(false);
    gameStore.gameSpeed.set(1);
    uiStore.openMenu.set(null);
    uiStore.mapPlacementMode.set(null);
    uiStore.buildMode.set(false);
    uiStore.coopDockOpen.set(false);

    levels = {};
    facade = {
      startWave: vi.fn(),
      upgradeTower: vi.fn((_t: unknown, id: UpgradeId) => {
        levels[id] = (levels[id] ?? 0) + 1;
        return true;
      }),
      sellSelectedTower: vi.fn(),
    };
    spawnFloatingText = vi.fn();
    upgradeHint = new UpgradeHintService();
    selectTower = vi.fn();
    selectTowerType = vi.fn();
    openDialog = vi.fn();
    openDialogs = [];
    sellConfirm = new SellConfirmService();
    focusGeo = vi.fn(() => true);
    introActive.set(false);
    strikeCanFire = true;
    abilityTargeting.targeting.set(null);
    abilityTargeting.start.mockClear();
    abilityTargeting.cancel.mockClear();
    photoActive.set(false);
    heroHired = true;
    heroControl.selected.set(false);
    heroControl.summon.mockClear();
    heroControl.deselect.mockClear();
    heroControl.cycleAmmo.mockClear();
    replayActive.set(false);
    replay.togglePlay.mockClear();
    replay.stepSpeed.mockClear();
    replay.exit.mockClear();
    mannedActive.set(false);
    towerControl.toggle.mockClear();
    towerControl.exit.mockClear();

    const injector = Injector.create({
      providers: [
        { provide: TowerDefenseFacadeService, useValue: facade },
        {
          provide: GameStateManager,
          useValue: { towerManager: { selectTower }, tilesEngine: { effects: { spawnFloatingText } } },
        },
        { provide: TowerDefenseStore, useValue: store },
        { provide: GameStore, useValue: gameStore },
        { provide: UIStore, useValue: uiStore },
        { provide: ResearchStore, useValue: research },
        { provide: TowerPlacementService, useValue: { selectTowerType } },
        { provide: SellConfirmService, useValue: sellConfirm },
        { provide: MatDialog, useValue: { open: openDialog, get openDialogs() { return openDialogs; } } },
        { provide: CameraControlService, useValue: { focusGeo } },
        { provide: IntroCameraFlightService, useValue: { active: introActive } },
        { provide: AbilityTargetingService, useValue: abilityTargeting },
        { provide: PhotoModeService, useValue: photoMode },
        { provide: HeroControlService, useValue: heroControl },
        { provide: ReplayService, useValue: replay },
        { provide: TowerControlService, useValue: towerControl },
        { provide: DebugFacadeService, useValue: { setHealthBarsInverted } },
        { provide: UpgradeHintService, useValue: upgradeHint },
        // The real one: U answers through it, on the facade and stores above
        { provide: TowerUpgradeService, useFactory: () => new TowerUpgradeService() },
      ],
    });
    service = runInInjectionContext(injector, () => new HotkeyService());
  });

  describe('in a manned tower', () => {
    beforeEach(() => mannedActive.set(true));

    it('C and Esc get out', () => {
      service.handleKeyDown(press('c'));
      mannedActive.set(true);
      service.handleKeyDown(press('Escape'));
      expect(towerControl.exit).toHaveBeenCalledTimes(2);
      expect(towerControl.toggle).not.toHaveBeenCalled();
    });

    it('the wave, pause and speed go on', () => {
      service.handleKeyDown(press(' '));
      service.handleKeyDown(press('p'));
      service.handleKeyDown(press('+'));
      expect(facade.startWave).toHaveBeenCalledTimes(1);
      expect(gameStore.paused()).toBe(true);
      expect(gameStore.gameSpeed()).toBe(2);
    });

    it('builds, upgrades, sells, aims, photographs, moves the camera and opens nothing', () => {
      store.selectedTower.set(tower);
      for (const key of ['1', 'u', 'Delete', 'k', 'o', 'g', 'Home', 'h']) {
        const event = press(key);
        service.handleKeyDown(event);
        expect(event.defaultPrevented).toBe(false);
      }
      expect(selectTowerType).not.toHaveBeenCalled();
      expect(facade.upgradeTower).not.toHaveBeenCalled();
      expect(facade.sellSelectedTower).not.toHaveBeenCalled();
      expect(abilityTargeting.start).not.toHaveBeenCalled();
      expect(photoMode.toggle).not.toHaveBeenCalled();
      expect(heroControl.summon).not.toHaveBeenCalled();
      expect(focusGeo).not.toHaveBeenCalled();
      expect(openDialog).not.toHaveBeenCalled();
    });
  });

  it('C outside a tower asks TowerControlService to get into the selected one', () => {
    service.handleKeyDown(press('c'));
    expect(towerControl.toggle).toHaveBeenCalledTimes(1);
  });

  describe('during the replay of the last wave', () => {
    beforeEach(() => replayActive.set(true));

    it('Space and P pause and play the replay instead of the game', () => {
      const space = press(' ');
      service.handleKeyDown(space);
      service.handleKeyDown(press('p'));
      expect(replay.togglePlay).toHaveBeenCalledTimes(2);
      expect(space.defaultPrevented).toBe(true);
      expect(facade.startWave).not.toHaveBeenCalled();
      expect(gameStore.paused()).toBe(false);
    });

    it('+ and - step the replay speed, not the game speed', () => {
      service.handleKeyDown(press('+'));
      service.handleKeyDown(press('-'));
      expect(replay.stepSpeed.mock.calls).toEqual([[1], [-1]]);
      expect(gameStore.gameSpeed()).toBe(1);
    });

    it('Esc leaves the replay', () => {
      service.handleKeyDown(press('Escape'));
      expect(replay.exit).toHaveBeenCalledTimes(1);
    });

    it('builds, upgrades, sells, aims and photographs nothing', () => {
      store.selectedTower.set(tower);
      for (const key of ['1', 'u', 'Delete', 'k', 'o']) {
        const event = press(key);
        service.handleKeyDown(event);
        expect(event.defaultPrevented).toBe(false);
      }
      expect(selectTowerType).not.toHaveBeenCalled();
      expect(facade.upgradeTower).not.toHaveBeenCalled();
      expect(facade.sellSelectedTower).not.toHaveBeenCalled();
      expect(abilityTargeting.start).not.toHaveBeenCalled();
      expect(photoMode.toggle).not.toHaveBeenCalled();
    });

    it('keeps the camera keys and the help', () => {
      service.handleKeyDown(press('Home'));
      service.handleKeyDown(press('h'));
      expect(focusGeo).toHaveBeenCalledWith(48.7, 9.1);
      expect(openDialog).toHaveBeenCalledTimes(1);
    });
  });

  describe('when keys reach the game', () => {
    it('Space starts the wave and takes the key', () => {
      const event = press(' ');
      service.handleKeyDown(event);
      expect(facade.startWave).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves a key the input handler already handled', () => {
      const event = press(' ');
      event.preventDefault();
      service.handleKeyDown(event);
      expect(facade.startWave).not.toHaveBeenCalled();
    });

    it('ignores keys while typing', () => {
      const event = press(' ');
      Object.defineProperty(event, 'target', { value: document.createElement('input') });
      service.handleKeyDown(event);
      expect(facade.startWave).not.toHaveBeenCalled();
    });

    it('takes Space on a focused checkbox, it only toggles on click', () => {
      const event = press(' ');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      Object.defineProperty(event, 'target', { value: checkbox });
      service.handleKeyDown(event);
      expect(facade.startWave).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves Home to a focused slider and still starts the wave on Space', () => {
      const slider = document.createElement('input');
      slider.type = 'range';
      const home = press('Home');
      Object.defineProperty(home, 'target', { value: slider });
      service.handleKeyDown(home);
      expect(focusGeo).not.toHaveBeenCalled();
      expect(home.defaultPrevented).toBe(false);

      const space = press(' ');
      Object.defineProperty(space, 'target', { value: slider });
      service.handleKeyDown(space);
      expect(facade.startWave).toHaveBeenCalledTimes(1);
    });

    it('ignores keys while a dialog is open and while loading', () => {
      openDialogs = [{}];
      service.handleKeyDown(press(' '));
      openDialogs = [];
      store.loading.set(true);
      service.handleKeyDown(press(' '));
      expect(facade.startWave).not.toHaveBeenCalled();
    });

    it('keeps a focused button from clicking on the keyup of the Space that started the wave', () => {
      service.handleKeyDown(press(' '));
      // Held key: the repeats find the wave running and do nothing
      store.canStartWave.set(false);
      service.handleKeyDown(press(' ', { repeat: true }));
      const up = release(' ');
      service.handleKeyUp(up);
      expect(up.defaultPrevented).toBe(true);
    });

    it('lets Space click a focused button when it started no wave', () => {
      store.canStartWave.set(false);
      service.handleKeyDown(press(' '));
      const up = release(' ');
      service.handleKeyUp(up);
      expect(up.defaultPrevented).toBe(false);
    });

    it('leaves the next Space alone once the wave-starting one is released', () => {
      service.handleKeyDown(press(' '));
      service.handleKeyUp(release(' '));
      store.canStartWave.set(false);
      service.handleKeyDown(press(' '));
      const up = release(' ');
      service.handleKeyUp(up);
      expect(up.defaultPrevented).toBe(false);
    });
  });

  it('Space does nothing while a wave cannot start', () => {
    store.canStartWave.set(false);
    const event = press(' ');
    service.handleKeyDown(event);
    expect(facade.startWave).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  describe('Alt', () => {
    beforeEach(() => setHealthBarsInverted.mockClear());

    it('turns the health bars round while held and takes the key from the browser menu', () => {
      const down = press('Alt', { altKey: true });
      service.handleKeyDown(down);
      expect(setHealthBarsInverted).toHaveBeenLastCalledWith(true);
      expect(down.defaultPrevented).toBe(true);

      const up = release('Alt');
      service.handleKeyUp(up);
      expect(setHealthBarsInverted).toHaveBeenLastCalledWith(false);
      expect(up.defaultPrevented).toBe(true);
    });

    it('puts them back when the window loses the keyup', () => {
      service.handleKeyDown(press('Alt', { altKey: true }));
      service.handleWindowBlur();
      expect(setHealthBarsInverted).toHaveBeenLastCalledWith(false);
    });
  });

  describe('number keys', () => {
    it('1 picks the first build card', () => {
      service.handleKeyDown(press('1'));
      expect(selectTowerType).toHaveBeenCalledWith('archer');
    });

    it('does not pick a locked card or one the player cannot pay for', () => {
      service.handleKeyDown(press('2')); // dual-gatling, locked here
      store.credits.set(TOWER_TYPES.archer.cost - 1);
      service.handleKeyDown(press('1'));
      expect(selectTowerType).not.toHaveBeenCalled();
    });

    it('does not pick while placing the HQ or a spawn', () => {
      uiStore.mapPlacementMode.set('hq');
      service.handleKeyDown(press('1'));
      expect(selectTowerType).not.toHaveBeenCalled();
    });
  });

  describe('U', () => {
    it('buys the first upgrade the player can afford', () => {
      store.selectedTower.set(tower);
      store.credits.set(100);
      service.handleKeyDown(press('u'));
      expect(facade.upgradeTower).toHaveBeenCalledWith(tower, 'speed');
    });

    it('raises the track and its new level over the tower and flashes its tile', () => {
      store.selectedTower.set(tower);
      store.credits.set(100);
      const event = press('u');
      service.handleKeyDown(event);
      expect(event.defaultPrevented).toBe(true);
      expect(spawnFloatingText).toHaveBeenCalledWith(
        'SPEED LV 1', 48.7, 9.1, 305, expect.objectContaining({ color: '#D9BC68' }),
      );
      expect(upgradeHint.hint()).toMatchObject({ towerId: 't1', upgradeId: 'speed', refusal: null });
    });

    it('says why when it buys nothing: over the tower and in the panel', () => {
      store.selectedTower.set(tower);
      store.credits.set(10);
      const event = press('u');
      service.handleKeyDown(event);
      expect(facade.upgradeTower).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(spawnFloatingText).toHaveBeenCalledWith(
        'NEED 20 CREDITS', 48.7, 9.1, 305, expect.objectContaining({ color: '#C96A3A' }),
      );
      expect(upgradeHint.hint()).toMatchObject({
        towerId: 't1',
        upgradeId: null,
        refusal: { kind: 'credits', upgradeId: 'speed', missing: 20 },
      });
    });

    it('leaves the key alone without a selected tower', () => {
      const event = press('u');
      service.handleKeyDown(event);
      expect(event.defaultPrevented).toBe(false);
      expect(spawnFloatingText).not.toHaveBeenCalled();
      expect(upgradeHint.hint()).toBeNull();
    });
  });

  it('Delete arms the sale, the second press sells', () => {
    store.selectedTower.set(tower);
    service.handleKeyDown(press('Delete'));
    expect(sellConfirm.armedTowerId()).toBe('t1');
    expect(facade.sellSelectedTower).not.toHaveBeenCalled();

    service.handleKeyDown(press('Delete'));
    expect(facade.sellSelectedTower).toHaveBeenCalledTimes(1);
  });

  it('P toggles the pause, but not after game over', () => {
    service.handleKeyDown(press('p'));
    expect(gameStore.paused()).toBe(true);
    service.handleKeyDown(press('p'));
    expect(gameStore.paused()).toBe(false);

    store.isGameOver.set(true);
    service.handleKeyDown(press('p'));
    expect(gameStore.paused()).toBe(false);
  });

  it('+ and - step the game speed', () => {
    service.handleKeyDown(press('+'));
    service.handleKeyDown(press('+'));
    expect(gameStore.gameSpeed()).toBe(4);
    service.handleKeyDown(press('-'));
    expect(gameStore.gameSpeed()).toBe(2);
  });

  describe('camera jumps', () => {
    it('Home flies to the HQ', () => {
      service.handleKeyDown(press('Home'));
      expect(focusGeo).toHaveBeenCalledWith(48.7, 9.1);
    });

    it('N goes round the spawn points', () => {
      service.handleKeyDown(press('n'));
      service.handleKeyDown(press('n'));
      service.handleKeyDown(press('n'));
      expect(focusGeo.mock.calls).toEqual([[48.71, 9.1], [48.69, 9.12], [48.71, 9.1]]);
    });

    it('leaves the camera to the intro flight while it plays', () => {
      introActive.set(true);
      service.handleKeyDown(press('Home'));
      service.handleKeyDown(press('n'));
      expect(focusGeo).not.toHaveBeenCalled();
    });
  });

  describe('K', () => {
    it('arms the nuclear strike like its button, a second press leaves the mode', () => {
      const first = press('k');
      service.handleKeyDown(first);
      expect(abilityTargeting.start).toHaveBeenCalledWith('nuclear-strike');
      expect(abilityTargeting.targeting()).toBe('nuclear-strike');
      expect(first.defaultPrevented).toBe(true);

      service.handleKeyDown(press('k'));
      expect(abilityTargeting.cancel).toHaveBeenCalledTimes(1);
      expect(abilityTargeting.targeting()).toBeNull();
    });

    it('leaves the key alone while the strike cannot fire', () => {
      strikeCanFire = false;
      const event = press('k');
      service.handleKeyDown(event);
      expect(abilityTargeting.targeting()).toBeNull();
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('hero keys', () => {
    it('G does what his bar button does and takes the key', () => {
      const event = press('g');
      service.handleKeyDown(event);
      expect(heroControl.summon).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('G leaves the key alone when that does nothing, before the hire', () => {
      heroHired = false;
      const event = press('g');
      service.handleKeyDown(event);
      expect(event.defaultPrevented).toBe(false);
    });

    it('V switches his ammo once he is hired', () => {
      const event = press('v');
      service.handleKeyDown(event);
      expect(heroControl.cycleAmmo).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);

      heroHired = false;
      const refused = press('v');
      service.handleKeyDown(refused);
      expect(refused.defaultPrevented).toBe(false);
    });

    it('Esc closes the coop dock last, after a selected tower', () => {
      uiStore.coopDockOpen.set(true);
      store.selectedTower.set(tower);
      service.handleKeyDown(press('Escape'));
      expect(selectTower).toHaveBeenCalledWith(null);
      expect(uiStore.coopDockOpen()).toBe(true);

      store.selectedTower.set(null);
      const event = press('Escape');
      service.handleKeyDown(event);
      expect(uiStore.coopDockOpen()).toBe(false);
      expect(event.defaultPrevented).toBe(true);
    });

    it('Esc lets him go before it deselects a tower', () => {
      heroControl.selected.set(true);
      store.selectedTower.set(tower);
      service.handleKeyDown(press('Escape'));
      expect(heroControl.deselect).toHaveBeenCalledTimes(1);
      expect(selectTower).not.toHaveBeenCalled();
    });
  });

  it('H opens the shortcut overview', () => {
    service.handleKeyDown(press('h'));
    expect(openDialog).toHaveBeenCalledTimes(1);
  });

  describe('photo mode', () => {
    it('O turns it on and off and takes the key', () => {
      const event = press('o');
      service.handleKeyDown(event);
      expect(photoActive()).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      service.handleKeyDown(press('o'));
      expect(photoActive()).toBe(false);
    });

    it('Esc leaves it before it closes a menu', () => {
      photoActive.set(true);
      uiStore.openMenu.set('display');
      service.handleKeyDown(press('Escape'));
      expect(photoActive()).toBe(false);
      expect(uiStore.openMenu()).toBe('display');
    });

    it('number keys do not start building while it is on', () => {
      photoActive.set(true);
      service.handleKeyDown(press('1'));
      expect(selectTowerType).not.toHaveBeenCalled();
    });

    it('K does not aim the strike while it is on', () => {
      photoActive.set(true);
      const event = press('k');
      service.handleKeyDown(event);
      expect(abilityTargeting.start).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });

  it('Esc closes a menu first, then drops a pending sale, then deselects', () => {
    uiStore.openMenu.set('dev');
    store.selectedTower.set(tower);
    sellConfirm.request('t1');

    service.handleKeyDown(press('Escape'));
    expect(uiStore.openMenu()).toBeNull();
    expect(sellConfirm.armedTowerId()).toBe('t1');

    service.handleKeyDown(press('Escape'));
    expect(sellConfirm.armedTowerId()).toBeNull();
    expect(selectTower).not.toHaveBeenCalled();

    service.handleKeyDown(press('Escape'));
    expect(selectTower).toHaveBeenCalledWith(null);
  });
});
