/**
 * The main menu as the player meets it (docs/MAIN_MENU_UI_PLAN.md): the
 * start menu in front of the loading place, Play while it loads, the
 * loading plate and its problem banner, Continue to an autosave at another
 * place with its question (E120), Esc stepping back, and the pause layer
 * over a running game.
 *
 * Real: MainMenuService, the shell, the list and the loading plate with
 * their templates (read from disk), GameStore and UIStore. Stand-ins: the
 * boot's signals (EngineInitializationService), the place
 * (LocationManagementService), the location change, the save game, coop
 * and the pages, which have specs of their own. Not covered: the look.
 */
// The components are partially compiled and need the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Input, input, signal } from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MainMenuComponent } from './main-menu.component';
import { MainMenuService, startMenuSkipped } from './main-menu.service';
import { MenuHomeComponent } from './pages/home/menu-home.component';
import { MenuLoadingComponent } from './loading/menu-loading.component';
import type { BootStep } from './loading/boot-step.model';
import { UIStore } from '../../store/ui.store';
import { GameStore } from '../../store/game.store';
import { COOP } from '../../services/coop.token';
import { AUTOSAVE_SLOT, SAVE_GAME, type LoadResult, type SaveSlotInfo } from '../../services/save-game/save-game.port';
import { EngineInitializationService } from '../../services/infrastructure/engine-initialization.service';
import { LocationManagementService } from '../../services/location/location-management.service';
import { LocationChangeCoordinatorService } from '../../services/location/location-change-coordinator.service';
import { TowerDefenseFacadeService } from '../../services/facade/tower-defense-facade.service';
import { ConfigService } from '../../core/services/config.service';
import { DevWorldService } from '../../devworld/devworld.service';

const read = (path: string) => readFileSync(resolve('src/app/components/main-menu', path), 'utf8');

/** The pages stand in with their selectors; they have specs of their own */
function pageStub(selector: string) {
  @Component({ selector, standalone: true, template: `<button type="button">{{ '${selector}' }}</button>` })
  class PageStub {
    readonly layer = input('start');
  }
  Input({ alias: 'layer', isSignal: true } as Input)(PageStub.prototype, 'layer');
  return PageStub;
}
const PAGES = ['new-game', 'coop', 'save', 'load', 'settings', 'extras'].map((page) => pageStub(`app-menu-${page}`));

// The @Input annotation the JIT transform adds for input() (see world-map.scenario.spec.ts)
Input({ alias: 'layer', isSignal: true, required: true } as Input)(MenuHomeComponent.prototype, 'layer');

const HEILBRONN = { lat: 49.14227, lon: 9.21878 };
const PARIS = { lat: 48.85341, lon: 2.3488 };

function steps(done: number, total = 10): BootStep[] {
  return Array.from({ length: total }, (_, i) => ({
    id: `s${i}`,
    title: `Step ${i + 1}`,
    status: i < done ? 'done' : i === done ? 'current' : 'pending',
    ...(i === done ? { meta: 'A* Pathfinding...' } : {}),
  }));
}

function autosaveAt(hq: { lat: number; lon: number } | null, location: string, wave = 7): SaveSlotInfo {
  return {
    id: AUTOSAVE_SLOT, name: `${location}, wave ${wave}`, autosave: true, wave, location,
    savedAt: '2026-10-08T20:00:00Z', gameVersion: '0.6.0', note: null,
    hq,
  };
}

describe('The main menu', () => {
  let fixture: ComponentFixture<MainMenuComponent>;
  let menu: MainMenuService;
  let ui: UIStore;
  let game: GameStore;
  const engineInit = {
    loading: signal(true),
    error: signal<string | null>(null),
    loadingSteps: signal<BootStep[]>(steps(3)),
  };
  const locationMgmt = {
    hq: signal<{ lat: number; lon: number } | null>(null),
    displayName: signal('Kiliansplatz, Heilbronn, Deutschland'),
    missionInfo: signal<{ city: string } | null>({ city: 'Heilbronn' }),
  };
  const coordinator = { awaitingStartChoice: signal(false), choosePlace: vi.fn(async () => true) };
  const saves = {
    slots: signal<SaveSlotInfo[]>([]),
    hasAutosave: signal(false),
    startPlace: signal(null),
    continueAutosave: vi.fn(async (): Promise<LoadResult> => ({ ok: true, note: null })),
  };
  const coop = { inGame: signal(false), hostPlace: signal(null), room: signal<{ code: string } | null>(null) };
  const facade = { restartGame: vi.fn() };
  const config = { tileProvider: signal('cesium'), setupRequested: signal(false) };

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    vi.clearAllMocks();
    engineInit.loading.set(true);
    engineInit.error.set(null);
    coordinator.awaitingStartChoice.set(false);
    engineInit.loadingSteps.set(steps(3));
    locationMgmt.hq.set(null);
    saves.slots.set([]);
    saves.hasAutosave.set(false);
    coop.inGame.set(false);
    coop.room.set(null);
    config.setupRequested.set(false);
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  async function setup(layer: 'start' | 'pause' = 'start') {
    TestBed.configureTestingModule({
      providers: [
        MainMenuService,
        { provide: EngineInitializationService, useValue: engineInit },
        { provide: LocationManagementService, useValue: locationMgmt },
        { provide: LocationChangeCoordinatorService, useValue: coordinator },
        { provide: SAVE_GAME, useValue: saves },
        { provide: COOP, useValue: coop },
        { provide: TowerDefenseFacadeService, useValue: facade },
        { provide: ConfigService, useValue: config },
        { provide: DevWorldService, useValue: { isActive: false } },
      ],
    });
    TestBed.overrideComponent(MainMenuComponent, {
      set: {
        template: read('main-menu.component.html'), templateUrl: undefined, styleUrl: undefined, styles: [],
        imports: [CdkTrapFocus, MenuHomeComponent, MenuLoadingComponent, ...PAGES],
      },
    });
    TestBed.overrideComponent(MenuHomeComponent, {
      set: { template: read('pages/home/menu-home.component.html'), templateUrl: undefined, styleUrl: undefined, styles: [] },
    });
    TestBed.overrideComponent(MenuLoadingComponent, {
      set: { template: read('loading/menu-loading.component.html'), templateUrl: undefined, styleUrl: undefined, styles: [] },
    });
    menu = TestBed.inject(MainMenuService);
    ui = TestBed.inject(UIStore);
    game = TestBed.inject(GameStore);
    ui.loadProblem.set(null);
    menu.open('home', layer);
    fixture = TestBed.createComponent(MainMenuComponent);
    document.body.appendChild(fixture.nativeElement);
    await settle();
  }

  async function settle() {
    TestBed.tick();
    await fixture?.whenStable();
    TestBed.tick();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const entries = () => Array.from(el().querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .map((item) => item.querySelector('.mh-label')?.textContent?.trim());
  const entry = (id: string) => el().querySelector<HTMLElement>(`[data-entry="${id}"]`);
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  async function click(target: HTMLElement | null) {
    expect(target).not.toBeNull();
    target!.click();
    await settle();
  }
  async function press(key: string, target: HTMLElement = document.activeElement as HTMLElement ?? el()) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await settle();
  }

  describe('the start menu', () => {
    it('without a place offers New game first, and no Play', async () => {
      coordinator.awaitingStartChoice.set(true);
      await setup();

      expect(entries()).toEqual(['New game', 'Coop', 'Load game', 'Settings', 'Extras']);
      expect(el().querySelector('app-menu-loading')).toBeNull();
    });

    // The focus moving in on open is cdkTrapFocus's (autoCapture), which jsdom's layout-less tabbable check never finds
    it('is a modal dialog named by its page, the list one tab stop on its first entry', async () => {
      coordinator.awaitingStartChoice.set(true);
      await setup();
      const dialog = el().querySelector('[role="dialog"]')!;

      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Menu');
      expect(entry('new-game')?.getAttribute('tabindex')).toBe('0');
      expect(entry('coop')?.getAttribute('tabindex')).toBe('-1');

      await click(entry('settings'));
      expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Settings');
    });

    it('shows the loading plate while the place loads: place, percent, step and the steps to open', async () => {
      locationMgmt.hq.set(HEILBRONN);
      await setup();

      const plate = el().querySelector('app-menu-loading')!;
      expect(plate.textContent).toContain('Heilbronn');
      expect(plate.textContent).toContain('30%');
      expect(plate.textContent).toContain('Step 4');
      expect(plate.textContent).toContain('4 of 10');
      expect(plate.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('30');
      expect(plate.querySelectorAll('.ml-steps-row')).toHaveLength(0);

      await click(plate.querySelector<HTMLElement>('.ml-toggle'));
      expect(plate.querySelectorAll('.ml-steps-row')).toHaveLength(10);
    });

    it('keeps Play pressed while loading and plays once the place stands', async () => {
      locationMgmt.hq.set(HEILBRONN);
      await setup();
      expect(entries()[0]).toBe('Play');
      expect(entry('play')?.querySelector('.mh-bar')).not.toBeNull();

      await click(entry('play'));
      expect(menu.isOpen()).toBe(true);
      expect(entry('play')?.textContent).toContain('Starts when loaded');

      engineInit.loading.set(false);
      await settle();
      expect(ui.mainMenuOpen()).toBe(false);
    });

    it('Play on a place that stands closes the menu at once', async () => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      await setup();

      await click(entry('play'));
      expect(ui.mainMenuOpen()).toBe(false);
    });

    it('says a load that went wrong in the plate, Retry tries it again, Other place opens New game', async () => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      const retry = vi.fn();
      await setup();
      ui.loadProblem.set({ text: 'The streets of Heilbronn did not load.', retry, blocksPlay: true });
      await settle();

      const alert = el().querySelector('app-menu-loading [role="alert"]')!;
      expect(alert.textContent).toContain('The streets of Heilbronn did not load.');
      expect(entry('play')?.getAttribute('aria-disabled')).toBe('true');
      await click(entry('play'));
      expect(menu.isOpen()).toBe(true);
      await click(Array.from(alert.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent === 'Retry')!);
      expect(retry).toHaveBeenCalledTimes(1);

      await click(Array.from(alert.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent === 'Other place')!);
      expect(menu.page()).toBe('new-game');
    });

    it('a place that did not load beside the one standing leaves Play to it', async () => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      await setup();
      ui.loadProblem.set({ text: 'No city came from the dice.' });
      await settle();

      expect(el().querySelector('app-menu-loading [role="alert"]')).not.toBeNull();
      expect(entry('play')?.getAttribute('aria-disabled')).toBeNull();
      await click(entry('play'));
      expect(ui.mainMenuOpen()).toBe(false);
      expect(ui.loadProblem()).toBeNull();
    });

    it('offers the map key when the engine failed', async () => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      engineInit.error.set('Error loading 3D map');
      await setup();

      const mapKey = Array.from(el().querySelectorAll<HTMLElement>('app-menu-loading button')).find((b) => b.textContent === 'Map key');
      await click(mapKey!);
      expect(config.setupRequested()).toBe(true);
    });

    it('shows the next load in the plate, not the failure of the change before it', async () => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      engineInit.error.set('Error changing location');
      await setup();
      expect(el().querySelector('app-menu-loading [role="alert"]')).not.toBeNull();

      // Other place: the next load runs while the broken change's error still stands
      engineInit.loading.set(true);
      await settle();
      expect(el().querySelector('app-menu-loading [role="alert"]')).toBeNull();
      expect(el().querySelector('app-menu-loading [role="progressbar"]')).not.toBeNull();
      expect(menu.playBlocked()).toBe(true);
      engineInit.error.set(null);
    });

    // jsdom finds nothing tabbable (see above): the test reads where the trap is told to go
    it('a menu opened on a page starts there: the page body is the trap’s first focus', async () => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      await setup('pause');
      menu.open('settings');
      await settle();
      expect(el().querySelector('.mm-page-body')?.hasAttribute('cdkFocusInitial')).toBe(true);
    });

    it('Continue of an autosave at this place loads it and plays', async () => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      saves.hasAutosave.set(true);
      saves.slots.set([autosaveAt(HEILBRONN, 'Kiliansplatz, Heilbronn, Deutschland', 12)]);
      await setup();

      expect(entries().slice(0, 2)).toEqual(['Continue', 'Play']);
      expect(entry('continue')?.querySelector('.mh-sub')?.textContent).toBe('Heilbronn · wave 12');
      await click(entry('continue'));

      expect(saves.continueAutosave).toHaveBeenCalledTimes(1);
      expect(ui.mainMenuOpen()).toBe(false);
    });

    it('asks before Continue leaves the place loaded for the autosave elsewhere (E120)', async () => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      saves.hasAutosave.set(true);
      saves.slots.set([autosaveAt(PARIS, 'Rue de Rivoli, Paris, France', 7)]);
      await setup();

      expect(entry('continue')?.querySelector('.mh-sub')?.textContent).toBe('in Paris · wave 7');
      await click(entry('continue'));
      expect(saves.continueAutosave).not.toHaveBeenCalled();
      expect(text()).toContain('Leaves Heilbronn: the save plays in Paris.');
      expect(document.activeElement?.textContent).toBe('Continue anyway');

      // Esc takes the question back, the menu stays where it was
      await press('Escape');
      expect(el().querySelector('.mh-confirm')).toBeNull();
      expect(menu.isOpen()).toBe(true);

      await click(entry('continue'));
      await click(Array.from(el().querySelectorAll<HTMLElement>('.mh-confirm button')).find((b) => b.textContent === 'Continue anyway')!);
      expect(saves.continueAutosave).toHaveBeenCalledTimes(1);
    });

    it('tells an older slot without its HQ by the name of the place', async () => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      saves.hasAutosave.set(true);
      saves.slots.set([autosaveAt(null, 'Rue de Rivoli, Paris, France')]);
      await setup();
      expect(entry('continue')?.querySelector('.mh-sub')?.textContent).toBe('in Paris · wave 7');
    });

    it('says why the autosave did not load, and stays', async () => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      saves.hasAutosave.set(true);
      saves.slots.set([autosaveAt(HEILBRONN, 'Heilbronn')]);
      saves.continueAutosave.mockResolvedValueOnce({ ok: false, reason: 'That save is damaged.' });
      await setup();

      await click(entry('continue'));
      await settle();
      expect(el().querySelector('[role="status"]')?.textContent).toBe('That save is damaged.');
      expect(menu.isOpen()).toBe(true);
    });

    it('Esc on the list does nothing, there is no game behind it; on a page it goes back', async () => {
      locationMgmt.hq.set(HEILBRONN);
      await setup();

      await press('Escape', entry('play')!);
      expect(menu.isOpen()).toBe(true);

      await click(entry('extras'));
      expect(menu.page()).toBe('extras');
      await press('Escape', el().querySelector<HTMLElement>('app-menu-extras button')!);
      expect(menu.page()).toBe('home');
      // Back on the entry that opened the page
      await vi.waitFor(() => expect(document.activeElement).toBe(entry('extras')));
    });

    it('the pointer over an entry takes the focus along from the list, never from a page', async () => {
      coordinator.awaitingStartChoice.set(true);
      await setup();
      entry('new-game')!.focus();
      entry('settings')!.dispatchEvent(new MouseEvent('mouseenter'));
      expect(document.activeElement).toBe(entry('settings'));

      await click(entry('extras'));
      const onPage = el().querySelector<HTMLElement>('app-menu-extras button')!;
      onPage.focus();
      entry('coop')!.dispatchEvent(new MouseEvent('mouseenter'));
      expect(document.activeElement).toBe(onPage);
    });

    it('moves between the entries with the arrows, wrapping, without choosing', async () => {
      coordinator.awaitingStartChoice.set(true);
      await setup();
      entry('new-game')!.focus();

      await press('ArrowDown');
      expect(document.activeElement).toBe(entry('coop'));
      await press('ArrowUp');
      await press('ArrowUp');
      expect(document.activeElement).toBe(entry('extras'));
      expect(menu.page()).toBe('home');
    });
  });

  describe('the pause layer', () => {
    beforeEach(() => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
    });

    it('lists Continue, the run\'s pages and below the line New game, Coop and Restart', async () => {
      await setup('pause');
      game.towerCount.set(2);
      await settle();

      expect(entries()).toEqual(['Continue', 'Save game', 'Load game', 'Settings', 'Extras', 'New game', 'Coop', 'Restart here']);
      expect(text()).toContain('Paused · Heilbronn · wave 1');
    });

    it('Continue and Esc go back to the game', async () => {
      await setup('pause');
      await click(entry('continue'));
      expect(ui.mainMenuOpen()).toBe(false);

      menu.open('home', 'pause');
      await settle();
      await press('Escape', entry('continue')!);
      expect(ui.mainMenuOpen()).toBe(false);
    });

    it('asks before Restart ends a run under way', async () => {
      await setup('pause');
      game.towerCount.set(1);
      await settle();

      await click(entry('restart'));
      expect(facade.restartGame).not.toHaveBeenCalled();
      await click(Array.from(el().querySelectorAll<HTMLElement>('.mh-confirm button')).find((b) => b.textContent === 'Restart')!);
      expect(facade.restartGame).toHaveBeenCalledTimes(1);
      expect(ui.mainMenuOpen()).toBe(false);
    });

    it('pauses the game alone and lets it go on; in coop it never pauses, and offers no Save, Load or Restart', async () => {
      await setup('pause');
      expect(game.paused()).toBe(true);
      menu.close();
      await settle();
      expect(game.paused()).toBe(false);

      coop.inGame.set(true);
      menu.open('home', 'pause');
      await settle();
      expect(game.paused()).toBe(false);
      expect(entries()).toEqual(['Continue', 'Settings', 'Extras', 'Coop']);
      expect(text()).toContain('Coop · Heilbronn');
    });
  });

  describe('after game over and in the desktop app', () => {
    beforeEach(() => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
    });

    afterEach(() => {
      delete (window as unknown as { desktop?: unknown }).desktop;
    });

    it('game over, Main menu: New game and Restart here are there, New game opens its page', async () => {
      await setup('pause');
      game.towerCount.set(4);
      game.phase.set('gameover');
      await settle();

      expect(entries()).toContain('New game');
      expect(entries()).toContain('Restart here');
      await click(entry('new-game'));
      expect(menu.page()).toBe('new-game');
      expect(el().querySelector('app-menu-new-game')).not.toBeNull();
    });

    it('Quit 3DTD only in the app: at once with nothing under way, asked first during a run', async () => {
      const quit = vi.fn();
      (window as unknown as { desktop?: unknown }).desktop = {
        version: '0.7.0', onUpdateReady: () => () => undefined, installUpdateNow: vi.fn(), saveRun: vi.fn(), quit,
      };
      await setup('start');
      expect(entries()).toContain('Quit 3DTD');
      await click(entry('quit'));
      expect(quit).toHaveBeenCalledTimes(1);

      game.towerCount.set(1);
      await settle();
      await click(entry('quit'));
      expect(quit).toHaveBeenCalledTimes(1);
      expect(text()).toContain('Quit 3DTD? The run ends.');
      await click(Array.from(el().querySelectorAll<HTMLElement>('.mh-confirm button')).find((b) => b.textContent === 'Quit')!);
      expect(quit).toHaveBeenCalledTimes(2);
    });

    it('a browser has no Quit: a tab cannot close itself', async () => {
      await setup('start');
      expect(entries()).not.toContain('Quit 3DTD');
    });
  });

  describe('a place loads in the game', () => {
    it('switches the menu to the start layer with the plate, the page open kept, or opens it', async () => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      await setup('pause');
      menu.open('load');
      await settle();

      engineInit.loading.set(true);
      await settle();
      expect(menu.layer()).toBe('start');
      expect(menu.page()).toBe('load');
      // Not over the page's plate: the bar under the list's entry shows the load
      expect(el().querySelector('app-menu-loading')).toBeNull();
      expect(menu.back()).toBe(true);
      expect(menu.page()).toBe('home');
      await settle();
      expect(el().querySelector('app-menu-loading')).not.toBeNull();

      engineInit.loading.set(false);
      menu.close();
      await settle();
      engineInit.loading.set(true);
      await settle();
      expect(ui.mainMenuOpen()).toBe(true);
    });

    it('in a coop room a new place shows its plate and then goes by itself: nobody waits behind Play', async () => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      coop.room.set({ code: 'ABC123' });
      await setup('pause');
      menu.close();
      await settle();

      // The host moved the room to another place: the guest follows
      engineInit.loading.set(true);
      await settle();
      expect(menu.layer()).toBe('start');
      expect(el().querySelector('app-menu-loading')).not.toBeNull();
      expect(menu.pendingPlay()).toBe(true);

      engineInit.loading.set(false);
      await settle();
      expect(ui.mainMenuOpen()).toBe(false);
    });

    it('a guest who joined a room before any place plays once the place of the host stands', async () => {
      coordinator.awaitingStartChoice.set(true);
      await setup('start');
      coop.room.set({ code: 'ABC123' });
      // The host's place comes and loads behind the menu
      coordinator.awaitingStartChoice.set(false);
      locationMgmt.hq.set(HEILBRONN);
      await settle();
      expect(menu.pendingPlay()).toBe(true);

      engineInit.loading.set(false);
      await settle();
      expect(ui.mainMenuOpen()).toBe(false);
    });
  });
});

describe('startMenuSkipped', () => {
  it('skips the start menu for bots, the benchmark and menu=skip, not for bot=manual', () => {
    expect(startMenuSkipped('?devworld&bot=auto')).toBe(true);
    expect(startMenuSkipped('?bot=coop&devworld')).toBe(true);
    expect(startMenuSkipped('?devworld&benchmark')).toBe(true);
    expect(startMenuSkipped('?l=49.1,9.2&menu=skip')).toBe(true);
    expect(startMenuSkipped('?devworld&bot=manual')).toBe(false);
    expect(startMenuSkipped('?l=49.1,9.2')).toBe(false);
    expect(startMenuSkipped('')).toBe(false);
  });
});
