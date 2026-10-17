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
import { FIELD_TIPS } from './loading/field-tips';
import { RovingGroupDirective } from '../roving-group.directive';
import type { BootStep } from './loading/boot-step.model';
import { UIStore } from '../../store/ui.store';
import { GameStore } from '../../store/game.store';
import { COOP } from '../../services/coop.token';
import { AUTOSAVE_BUILT_SLOT, AUTOSAVE_SLOT, SAVE_GAME, type LoadResult, type SaveSlotInfo } from '../../services/save-game/save-game.port';
import { CUSTOM_MAPS_OPEN } from '../../world/custom-maps-open';
import { AppScreen } from '../../world/app-screen.service';
import { PLAIN_START, WorldStartService, type WorldStart } from '../../world/world-start';
import { WorldChoiceService } from '../../world/world-choice.service';
import { WorldSession, type ParkedWorld } from '../../world/world-session.service';
import { WorldsStageService } from '../../worlds/worlds-stage.service';
import { EngineInitializationService } from '../../services/infrastructure/engine-initialization.service';
import { LocationManagementService } from '../../services/location/location-management.service';
import { LocationChangeCoordinatorService } from '../../services/location/location-change-coordinator.service';
import { TowerDefenseFacadeService } from '../../services/facade/tower-defense-facade.service';
import { ConfigService } from '../../core/services/config.service';
import { MatDialog } from '@angular/material/dialog';
import { focusIsQuiet, focusedByKeyboard } from '../../utils/keyboard-target';
import { WorldContext } from '../../world/world-context.service';
import { fakeWorldContext } from '../../../test/world-context-fake';
import type { OverpassRetry } from '../../world/osm/overpass-client';
import { GLOBE_LINK } from '../../services/world/globe-link';

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

/** The icon stands in empty; its name and size are all the menu binds */
@Component({ selector: 'td-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}
Input({ alias: 'name', isSignal: true } as Input)(IconStub.prototype, 'name');
Input({ alias: 'size', isSignal: true } as Input)(IconStub.prototype, 'size');

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
    savedAt: '2026-10-08T20:00:00Z', gameVersion: '0.6.0', note: null, world: 'real',
    hq,
    map: null,
  };
}

describe('The main menu', () => {
  let fixture: ComponentFixture<MainMenuComponent>;
  let menu: MainMenuService;
  let ui: UIStore;
  let game: GameStore;
  /** The engine's frames and sound, as the hold behind the globes stops them */
  const engine = { renderLoop: { start: vi.fn(), stop: vi.fn() }, spatialAudio: { setHeld: vi.fn() } };
  const engineInit = {
    loading: signal(true),
    getEngine: () => engine,
    error: signal<string | null>(null),
    loadingSteps: signal<BootStep[]>(steps(3)),
  };
  const locationMgmt = {
    hq: signal<{ lat: number; lon: number } | null>(null),
    displayName: signal('Kiliansplatz, Heilbronn, Deutschland'),
    missionInfo: signal<{ city: string } | null>({ city: 'Heilbronn' }),
    spawns: signal<{ lat: number; lon: number }[]>([]),
  };
  const coordinator = { awaitingStartChoice: signal(false), choosePlace: vi.fn(async () => true) };
  const saves = {
    slots: signal<SaveSlotInfo[]>([]),
    hasAutosave: signal(false),
    startPlace: signal(null),
    continueAutosave: vi.fn(async (): Promise<LoadResult> => ({ ok: true, note: null })),
    load: vi.fn(async (): Promise<LoadResult> => ({ ok: true, note: null })),
    canSave: signal(false),
    autosaveNow: vi.fn(async () => false),
    newRun: vi.fn(),
  };
  const worlds = { openSave: vi.fn(), editMap: vi.fn() };
  /** The custom maps open: the start list has its tabs */
  let mapsOpen = false;
  const coop = { inGame: signal(false), hostPlace: signal(null), room: signal<{ code: string } | null>(null) };
  const facade = { restartGame: vi.fn() };
  const config = { tileProvider: signal('cesium'), setupRequested: signal(false) };
  /** Dialogs over the menu (Extras, Settings) */
  const dialog = { openDialogs: [] as unknown[] };

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  let world = fakeWorldContext();
  const session = {
    reopen: vi.fn(), parked: signal<ParkedWorld | null>(null), onLeaveParked: vi.fn(() => () => undefined),
    world: signal(1), isOpen: signal(true),
  };
  const stage = {
    leaveGame: vi.fn(), makeMapOf: vi.fn(),
    loadAsk: vi.fn((): { text: string; note: string; run: unknown } | null => null), endRun: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    world = fakeWorldContext();
    engineInit.loading.set(true);
    engineInit.error.set(null);
    coordinator.awaitingStartChoice.set(false);
    engineInit.loadingSteps.set(steps(3));
    locationMgmt.hq.set(null);
    saves.slots.set([]);
    saves.hasAutosave.set(false);
    saves.canSave.set(false);
    coop.inGame.set(false);
    coop.room.set(null);
    config.setupRequested.set(false);
    dialog.openDialogs = [];
    mapsOpen = false;
    session.parked.set(null);
    session.world.set(1);
    session.isOpen.set(true);
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  async function setup(layer: 'start' | 'pause' = 'start', order: WorldStart | null = null) {
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
        { provide: WorldContext, useValue: world },
        { provide: MatDialog, useValue: dialog },
        { provide: CUSTOM_MAPS_OPEN, useValue: mapsOpen },
        { provide: WorldChoiceService, useValue: worlds },
        { provide: WorldSession, useValue: session },
        { provide: WorldsStageService, useValue: stage },
      ],
    });
    TestBed.overrideComponent(MainMenuComponent, {
      set: {
        template: read('main-menu.component.html'), templateUrl: undefined, styleUrl: undefined, styles: [],
        imports: [CdkTrapFocus, IconStub, MenuHomeComponent, MenuLoadingComponent, ...PAGES],
      },
    });
    TestBed.overrideComponent(MenuHomeComponent, {
      set: {
        template: read('pages/home/menu-home.component.html'), templateUrl: undefined, styleUrl: undefined, styles: [],
        imports: [RovingGroupDirective, IconStub],
      },
    });
    TestBed.overrideComponent(MenuLoadingComponent, {
      set: { template: read('loading/menu-loading.component.html'), templateUrl: undefined, styleUrl: undefined, styles: [] },
    });
    if (order) TestBed.inject(WorldStartService).set(order);
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

  describe('one world per start list (docs/WORLDS_STATE_PLAN.md 3.3)', () => {
    const mapAutosave = (wave = 4): SaveSlotInfo => ({
      ...autosaveAt(null, 'Ember Crater', wave), id: AUTOSAVE_BUILT_SLOT, world: 'maps', map: { id: 'ember-crater-copy', name: 'Ember Crater (copy)' },
    });

    it('a map behind the menu: its own Continue, no tabs, and no autosave of a real place in it', async () => {
      // The screenshot of the review: a map loaded behind the menu, the autosave of a real place stood above its Play
      mapsOpen = true;
      world.useCustomMap('ember-crater-copy', 'Ember Crater (copy)');
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      saves.hasAutosave.set(true);
      saves.slots.set([autosaveAt(HEILBRONN, 'Binswangen', 3), mapAutosave(4)]);
      await setup();

      expect(el().querySelector('[role="tablist"]')).toBeNull();
      expect(entries()).toEqual(['Continue', 'Play', 'New game', 'Coop', 'Load game', 'Settings', 'Extras', 'Map editor']);
      expect(entry('continue')?.querySelector('.mh-sub')?.textContent).toBe('Ember Crater (copy) | wave 4');
      expect(text()).not.toContain('Binswangen');
    });

    it('on a real place the list is its world only: the maps autosave stays on the globes and in the chips', async () => {
      mapsOpen = true;
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      saves.hasAutosave.set(true);
      saves.slots.set([autosaveAt(HEILBRONN, 'Kiliansplatz, Heilbronn, Deutschland', 12), mapAutosave(4)]);
      await setup();

      expect(el().querySelector('[role="tablist"]')).toBeNull();
      expect(entries()).toEqual(['Continue', 'Play', 'New game', 'Coop', 'Load game', 'Settings', 'Extras', 'Map editor']);
      expect(entry('continue')?.querySelector('.mh-sub')?.textContent).toBe('Heilbronn | wave 12');
      expect(text()).not.toContain('Ember Crater');
    });

    it('without the maps open the list is as before, the editor said to come', async () => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      await setup();

      expect(el().querySelector('[role="tablist"]')).toBeNull();
      expect(entries()).toEqual(['Play', 'New game', 'Coop', 'Load game', 'Settings', 'Extras', 'Map editor']);
    });
  });

  describe('the start menu', () => {
    it('without a place offers New game first, and no Play', async () => {
      coordinator.awaitingStartChoice.set(true);
      await setup();

      expect(entries()).toEqual(['New game', 'Coop', 'Load game', 'Settings', 'Extras', 'Map editor']);
      expect(el().querySelector('app-menu-loading')).toBeNull();
      // The map editor shows, not yet open
      expect(entry('editor')!.getAttribute('aria-disabled')).toBe('true');
    });

    it('pages through the tips with the dots under the card, and leads its foot with Legal and Privacy (TODO E147, E148)', async () => {
      coordinator.awaitingStartChoice.set(true);
      await setup();
      const dots = Array.from(el().querySelectorAll<HTMLElement>('.mm-tip-dot'));
      expect(dots).toHaveLength(FIELD_TIPS.length);

      await click(dots[2]);
      const shown = el().querySelector('.mm-tip-text')!.textContent!.replace(/\s+/g, ' ').trim();
      expect(shown).toBe(FIELD_TIPS[2].parts.map((p) => p.text).join('').replace(/\s+/g, ' ').trim());
      expect(dots[2].getAttribute('aria-current')).toBe('true');
      expect(dots[0].getAttribute('aria-current')).toBeNull();

      const foot = el().querySelector('.mm-version')!.textContent!.replace(/\s+/g, ' ').trim();
      expect(foot.startsWith('Legal | Privacy')).toBe(true);
    });

    it('hides the tip while the list reaches down to it, and shows it again with room', async () => {
      const observers: (() => void)[] = [];
      vi.stubGlobal('ResizeObserver', class {
        constructor(private readonly report: () => void) { observers.push(report); }
        observe = vi.fn();
        disconnect = vi.fn();
      });
      let listBottom = 500;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const top = this.classList.contains('mm-tip') ? 600 : 0;
        const bottom = this.tagName === 'APP-MENU-HOME' ? listBottom : 700;
        return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
      });
      try {
        coordinator.awaitingStartChoice.set(true);
        await setup();
        const tip = el().querySelector<HTMLElement>('.mm-tip')!;
        observers.forEach((report) => report());
        await settle();
        expect(tip.classList.contains('is-hidden')).toBe(false);

        // Continue and Save game in the list on a short window: it runs under the tip
        listBottom = 590;
        observers.forEach((report) => report());
        await settle();
        expect(tip.classList.contains('is-hidden')).toBe(true);
        expect(tip.getAttribute('aria-hidden')).toBe('true');

        listBottom = 560;
        observers.forEach((report) => report());
        await settle();
        expect(tip.classList.contains('is-hidden')).toBe(false);
      } finally {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
      }
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

    it('says the descent in one line once the place stands, not "Ready" above it', async () => {
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loadingSteps.set(steps(10));
      await setup();
      TestBed.inject(GLOBE_LINK).descent.set(33);
      await settle();

      const plate = el().querySelector('app-menu-loading')!;
      const said = plate.textContent!.replace(/\s+/g, ' ');
      expect(said).toContain('Loading the descent | 33%');
      expect(said).not.toContain('Ready');
      expect(plate.querySelectorAll('.ml-tiles')).toHaveLength(1);

      TestBed.inject(GLOBE_LINK).descent.set(0);
      await settle();
      expect(plate.textContent).toContain('Loading the descent | 0%');
    });

    it('says in the plate while the street servers are asked again, and the line goes with the load', async () => {
      locationMgmt.hq.set(HEILBRONN);
      const retrying = signal<OverpassRetry | null>(null);
      world.setProvider({ streets: { retrying } } as never);
      await setup();
      const plate = el().querySelector('app-menu-loading')!;
      expect(plate.querySelector('[data-test="streets-busy"]')).toBeNull();

      retrying.set({ attempt: 2, of: 5, waitMs: 2250, kind: 'busy' });
      await settle();
      expect(plate.querySelector('[data-test="streets-busy"]')?.textContent?.trim()).toBe('The map server is busy, trying again (2 of 5)…');
      // The load goes on under it: the bar, the step
      expect(plate.querySelector('[role="progressbar"]')).not.toBeNull();

      retrying.set(null);
      await settle();
      expect(plate.querySelector('[data-test="streets-busy"]')).toBeNull();
    });

    it('moves an untouched focus to Play when the place comes in above New game (TODO E151)', async () => {
      await setup();
      expect(entries()[0]).toBe('New game');
      entry('new-game')!.focus();

      locationMgmt.hq.set(HEILBRONN);
      await settle();
      await settle();
      expect(entries()[0]).toBe('Play');
      expect(document.activeElement).toBe(entry('play'));
      expect(entry('play')?.getAttribute('tabindex')).toBe('0');
    });

    it('leaves a focus the player moved where it is when the place comes in (TODO E151)', async () => {
      await setup();
      entry('settings')!.focus();
      locationMgmt.hq.set(HEILBRONN);
      await settle();
      await settle();
      expect(document.activeElement).toBe(entry('settings'));
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

    it('shows the loading in one entry: the first that loads, then the one chosen', async () => {
      locationMgmt.hq.set(HEILBRONN);
      saves.hasAutosave.set(true);
      saves.slots.set([autosaveAt(HEILBRONN, 'Kiliansplatz, Heilbronn, Deutschland', 12)]);
      await setup();
      expect(entries().slice(0, 2)).toEqual(['Continue', 'Play']);
      expect(el().querySelectorAll('.mh-bar')).toHaveLength(1);
      expect(entry('continue')?.querySelector('.mh-bar')).not.toBeNull();

      await click(entry('play'));
      expect(el().querySelectorAll('.mh-bar')).toHaveLength(1);
      expect(entry('play')?.querySelector('.mh-bar')).not.toBeNull();
      expect(entry('play')?.textContent).toContain('Starts when loaded');
      expect(entry('continue')?.textContent).not.toContain('Starts when loaded');
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

    it('Retry on a load without its own retry opens the world anew in the page, not the page without its link', async () => {
      session.reopen.mockClear();
      engineInit.loading.set(false);
      await setup();
      ui.loadProblem.set({ text: 'Outside the 3D tiles.', blocksPlay: true });
      await settle();

      const alert = el().querySelector('app-menu-loading [role="alert"]')!;
      await click(Array.from(alert.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent === 'Retry')!);
      expect(session.reopen).toHaveBeenCalledTimes(1);
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

    it('names a missing custom map by its map and offers another map, no map key', async () => {
      world.useCustomMap('no-such-map');
      engineInit.loading.set(false);
      engineInit.error.set('The world "map no-such-map" is not available: There is no map "no-such-map".');
      await setup();

      const plate = el().querySelector('app-menu-loading')!;
      expect(plate.querySelector('h3')?.textContent).toContain('no-such-map');
      const labels = Array.from(plate.querySelectorAll<HTMLElement>('button')).map((b) => b.textContent?.trim());
      expect(labels).toContain('Other map');
      expect(labels).not.toContain('Map key');
      expect(labels).not.toContain('Other place');
      engineInit.error.set(null);
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
      expect(entry('continue')?.querySelector('.mh-sub')?.textContent).toBe('Heilbronn | wave 12');
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

      expect(entry('continue')?.querySelector('.mh-sub')?.textContent).toBe('in Paris | wave 7');
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
      expect(entry('continue')?.querySelector('.mh-sub')?.textContent).toBe('in Paris | wave 7');
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

    it('takes Esc from the page once when the focus fell out of the menu, and the focus back', async () => {
      locationMgmt.hq.set(HEILBRONN);
      await setup('pause');
      await click(entry('extras'));
      (document.activeElement as HTMLElement | null)?.blur();
      expect(document.activeElement).toBe(document.body);

      await press('Escape', document.body);
      expect(menu.page()).toBe('home');
      expect(menu.isOpen()).toBe(true);
      expect(el().querySelector('.mm-root')!.contains(document.activeElement)).toBe(true);
    });

    it('leaves Esc to a dialog over the menu, and Esc inside the menu goes one step only', async () => {
      locationMgmt.hq.set(HEILBRONN);
      await setup('pause');
      await click(entry('extras'));
      dialog.openDialogs = [{}];
      await press('Escape', document.body);
      expect(menu.page()).toBe('extras');

      dialog.openDialogs = [];
      await press('Escape', el().querySelector<HTMLElement>('app-menu-extras button')!);
      expect(menu.page()).toBe('home');
      expect(menu.isOpen()).toBe(true);
    });

    it('gives the focus back to the button of the game on close, quietly: no tooltip, the next Esc for the game', async () => {
      locationMgmt.hq.set(HEILBRONN);
      const gameButton = document.body.appendChild(document.createElement('button'));
      const quiet: boolean[] = [];
      gameButton.addEventListener('focus', () => quiet.push(focusIsQuiet(gameButton)));
      gameButton.focus();
      quiet.length = 0;
      await setup('pause');
      entry('settings')!.focus();

      fixture.destroy();
      expect(document.activeElement).toBe(gameButton);
      expect(quiet).toEqual([true]);
      expect(focusedByKeyboard(gameButton)).toBe(false);
      gameButton.remove();
    });

    it('a focus dropped to the page goes back into the menu', async () => {
      locationMgmt.hq.set(HEILBRONN);
      await setup('pause');
      const button = entry('settings')!;
      button.focus();
      button.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
      button.blur();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(el().querySelector('.mm-root')!.contains(document.activeElement)).toBe(true);
    });

    it('moves between the entries with the arrows, wrapping, without choosing', async () => {
      coordinator.awaitingStartChoice.set(true);
      await setup();
      entry('new-game')!.focus();

      await press('ArrowDown');
      expect(document.activeElement).toBe(entry('coop'));
      await press('ArrowUp');
      await press('ArrowUp');
      // Wraps to the last entry; the map editor, not yet open, is skipped
      expect(document.activeElement).toBe(entry('extras'));
      expect(menu.page()).toBe('home');
    });
  });

  describe('a save the world opened to load (Continue, Load game, Back to the run)', () => {
    it('that did not load: the start list with Play for a fresh run and the reason, not a loading that waits for nothing', async () => {
      mapsOpen = true;
      world.useCustomMap('bay', 'Bay', 'edited');
      locationMgmt.hq.set(HEILBRONN);
      engineInit.loading.set(false);
      const reason = 'That save cannot load here. The map "Bay" was changed since this run was played on it, so the run cannot go on there.';
      saves.load.mockResolvedValueOnce({ ok: false, reason });
      await setup('start', { ...PLAIN_START, world: { kind: 'custom-map', mapId: 'bay', contentHash: '' }, resume: AUTOSAVE_BUILT_SLOT, play: true, label: 'Bay' });
      await vi.waitFor(() => expect(menu.notice()).not.toBeNull());
      await settle();
      expect(saves.load).toHaveBeenCalledWith(AUTOSAVE_BUILT_SLOT);
      expect(menu.starting()).toBe(false);
      expect(text()).not.toContain('Loading Bay');
      expect(text()).toContain(`${reason} Play starts a fresh run here.`);
      expect(entries()).toContain('Play');
      expect(ui.mainMenuOpen()).toBe(true);
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

      expect(entries()).toEqual(['Continue', 'Save game', 'Load game', 'Settings', 'Extras', 'New game', 'Coop', 'World menu', 'All worlds', 'Restart here']);
      expect(el().querySelector('.mh-pause-word')?.textContent).toBe('Paused');
      expect(el().querySelector('.mh-pause-place')?.textContent).toBe('Heilbronn | wave 1');
    });

    it('All worlds asks nothing: the run stays held behind the globes, the menu keeps it paused; Esc there is not the menu', async () => {
      await setup('pause');
      game.towerCount.set(2);
      await settle();
      await click(entry('worlds'));
      expect(el().querySelector('.mh-confirm')).toBeNull();
      expect(stage.leaveGame).toHaveBeenCalledWith(null, expect.objectContaining({ world: 'real', label: 'Heilbronn', wave: 1, run: true }));
      // Held: the stage parks it (stand-in), the menu stays and Esc belongs to the globes; no frames, no sound
      session.parked.set(stage.leaveGame.mock.calls[0][1] as ParkedWorld);
      await settle();
      expect(engine.renderLoop.stop).toHaveBeenCalled();
      expect(engine.spatialAudio.setHeld).toHaveBeenLastCalledWith(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(ui.mainMenuOpen()).toBe(true);
      expect(game.paused()).toBe(true);
      // Shown again: the menu goes, the game goes on
      session.parked.set(null);
      await settle();
      expect(ui.mainMenuOpen()).toBe(false);
      expect(game.paused()).toBe(false);
      expect(engine.renderLoop.start).toHaveBeenCalled();
      expect(engine.spatialAudio.setHeld).toHaveBeenLastCalledWith(false);
    });

    it('a held game that goes for good stays quiet and paused until it is gone (closed, or another world opened)', async () => {
      for (const drop of [() => session.isOpen.set(false), () => session.world.update((n) => n + 1)]) {
        await setup('pause');
        game.towerCount.set(2);
        await settle();
        session.parked.set({ world: 'real', pick: null, label: 'Heilbronn', wave: 1, run: true });
        await settle();
        engine.spatialAudio.setHeld.mockClear();
        // The session drops it (WorldSession.close or openHere): parked goes null with it
        session.parked.set(null);
        drop();
        await settle();
        expect(engine.spatialAudio.setHeld).not.toHaveBeenCalled();
        expect(engine.renderLoop.start).not.toHaveBeenCalled();
        expect(ui.mainMenuOpen()).toBe(true);
        expect(game.paused()).toBe(true);
        fixture.destroy();
        TestBed.resetTestingModule();
        vi.clearAllMocks();
        session.world.set(1);
        session.isOpen.set(true);
      }
    });

    it('Load of a save of another world ends the run of that world first (the rule of the globes), then opens it there', async () => {
      await setup('pause');
      const save: SaveSlotInfo = { ...autosaveAt(null, 'Ember Crater', 3), id: 'slot-2', autosave: false, world: 'maps', map: { id: 'ember-crater', name: 'Ember Crater' } };
      saves.slots.set([save]);
      const run = { slotId: AUTOSAVE_BUILT_SLOT, world: 'maps', pick: null, name: 'Demo Valley', wave: 4, savedAt: '' };
      stage.loadAsk.mockReturnValueOnce({ text: 'Demo Valley | wave 4 waits in Built Worlds.', note: '', run });
      expect(menu.loadAsk('slot-2')?.text).toBe('Demo Valley | wave 4 waits in Built Worlds.');
      expect(stage.loadAsk).toHaveBeenCalledWith(save);

      stage.loadAsk.mockReturnValueOnce({ text: '', note: '', run });
      await menu.loadSlot('slot-2');
      expect(stage.endRun).toHaveBeenCalledWith(run);
      expect(worlds.openSave).toHaveBeenCalledWith(save);
      expect(stage.endRun.mock.invocationCallOrder[0]).toBeLessThan(worlds.openSave.mock.invocationCallOrder[0]);
    });

    it('Make map on a real place opens its OpenStreetMap frame on the globes, the game held behind them', async () => {
      await setup('pause');
      menu.close();
      await settle();
      menu.makeMapOf();
      expect(stage.leaveGame).toHaveBeenCalledWith(null, expect.objectContaining({ world: 'real', run: false }));
      expect(stage.makeMapOf).toHaveBeenCalledWith(expect.objectContaining({ kind: 'place', hq: HEILBRONN }), 'real');
      // Held behind the globes, the pause menu keeps it paused
      expect(ui.mainMenuOpen()).toBe(true);
    });

    it('on a custom map offers Edit this map, asking first while a run is under way; not in a replay', async () => {
      mapsOpen = true;
      world.useCustomMap('ember-crater-copy', 'Ember Crater (copy)');
      await setup('pause');
      game.towerCount.set(1);
      await settle();
      const edit = vi.spyOn(menu, 'editThisMap').mockResolvedValue(undefined);

      expect(entries()).toEqual(['Continue', 'Save game', 'Load game', 'Settings', 'Extras', 'New game', 'Coop', 'Edit this map', 'World menu', 'All worlds', 'Restart here']);
      await click(entry('edit-map'));
      expect(edit).not.toHaveBeenCalled();
      expect(text()).toContain('Edit this map? The run ends.');
      await click(Array.from(el().querySelectorAll<HTMLElement>('.mh-confirm button')).find((b) => b.textContent === 'Open in the editor')!);
      expect(edit).toHaveBeenCalledTimes(1);

      ui.replayMode.set(true);
      await settle();
      expect(entries()).not.toContain('Edit this map');
    });

    it('in a coop game Edit this map says the coop game is left; no run waits, so the way back leads to the worlds', async () => {
      mapsOpen = true;
      world.useCustomMap('ember-crater-copy', 'Ember Crater (copy)');
      coop.inGame.set(true);
      await setup('pause');
      game.towerCount.set(1);
      saves.canSave.set(true);
      await settle();

      await click(entry('edit-map'));
      expect(text()).toContain('You leave the coop game.');
      await click(Array.from(el().querySelectorAll<HTMLElement>('.mh-confirm button')).find((b) => b.textContent === 'Open in the editor')!);
      await vi.waitFor(() => expect(worlds.editMap).toHaveBeenCalledWith('ember-crater-copy'));
      // The game goes with the editor (its CoopService leaves the room); nothing of the coop run is kept to come back to
      expect(saves.autosaveNow).not.toHaveBeenCalled();
      expect(TestBed.inject(AppScreen).waitingRun()).toBeNull();
    });

    it('between waves Edit this map keeps the run as autosave, and Back to the run names it (E195 phase 4)', async () => {
      mapsOpen = true;
      // Back to the run opens the map as it is then (no content hash): an edit since is the save's to refuse
      world.useCustomMap('ember-crater-copy', 'Ember Crater (copy)', 'v1');
      await setup('pause');
      game.towerCount.set(1);
      game.waveNumber.set(3);
      saves.canSave.set(true);
      saves.autosaveNow.mockImplementation(async () => {
        saves.slots.set([{ ...autosaveAt(null, 'Ember Crater', 4), id: AUTOSAVE_BUILT_SLOT, world: 'maps', map: { id: 'ember-crater-copy', name: 'Ember Crater (copy)' } }]);
        return true;
      });
      await settle();

      await click(entry('edit-map'));
      expect(text()).toContain('Edit this map? The run waits as autosave; Back to the run comes back to it.');
      await click(Array.from(el().querySelectorAll<HTMLElement>('.mh-confirm button')).find((b) => b.textContent === 'Open in the editor')!);
      await vi.waitFor(() => expect(worlds.editMap).toHaveBeenCalledWith('ember-crater-copy'));
      expect(saves.autosaveNow).toHaveBeenCalledTimes(1);
      expect(TestBed.inject(AppScreen).waitingRun()).toEqual({
        order: { ...PLAIN_START, world: { kind: 'custom-map', mapId: 'ember-crater-copy', contentHash: '', name: 'Ember Crater (copy)' }, resume: AUTOSAVE_BUILT_SLOT, play: true, label: 'Ember Crater (copy)' },
        label: 'Ember Crater (copy) | wave 4',
        mapId: 'ember-crater-copy',
      });
    });

    it('in a wave Edit this map keeps the autosave of its start, an older one does not count', async () => {
      mapsOpen = true;
      world.useCustomMap('ember-crater-copy', 'Ember Crater (copy)');
      await setup('pause');
      game.towerCount.set(1);
      game.waveNumber.set(5);
      saves.slots.set([{ ...autosaveAt(null, 'Ember Crater', 4), id: AUTOSAVE_BUILT_SLOT, world: 'maps', map: { id: 'ember-crater-copy', name: 'Ember Crater (copy)' } }]);
      await settle();
      await click(entry('edit-map'));
      expect(text()).toContain('Edit this map? The run ends.');
      await click(Array.from(el().querySelectorAll<HTMLElement>('.mh-confirm button')).find((b) => b.textContent === 'Cancel')!);

      game.waveNumber.set(4);
      await settle();
      await click(entry('edit-map'));
      expect(text()).toContain('Edit this map? The run waits as autosave from the start of this wave.');
      await click(Array.from(el().querySelectorAll<HTMLElement>('.mh-confirm button')).find((b) => b.textContent === 'Open in the editor')!);
      await vi.waitFor(() => expect(worlds.editMap).toHaveBeenCalledWith('ember-crater-copy'));
      expect(saves.autosaveNow).not.toHaveBeenCalled();
      expect(TestBed.inject(AppScreen).waitingRun()?.label).toBe('Ember Crater (copy) | wave 4');
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
      // Back to the worlds stays, locked: the room would lose the player
      expect(entries()).toEqual(['Continue', 'Settings', 'Extras', 'Coop', 'World menu', 'All worlds']);
      expect(entry('worlds')!.getAttribute('aria-disabled')).toBe('true');
      expect(entry('worlds')!.textContent).toContain('Leave the coop room first');
      expect(el().querySelector('.mh-pause-word')?.textContent).toBe('Coop');
      expect(el().querySelector('.mh-pause-place')?.textContent).toContain('Heilbronn');
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
