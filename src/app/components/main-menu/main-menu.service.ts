import { DestroyRef, Injectable, Injector, computed, effect, inject, signal, untracked } from '@angular/core';
import { UIStore } from '../../store/ui.store';
import { GameStore } from '../../store/game.store';
import { COOP } from '../../services/coop.token';
import { AUTOSAVE_SLOT, SAVE_GAME, type LoadResult, type SaveSlotInfo } from '../../services/save-game/save-game.port';
import { shortPlaceName } from '../../services/save-game/slot-name';
import { EngineInitializationService } from '../../services/infrastructure/engine-initialization.service';
import { LocationManagementService } from '../../services/location/location-management.service';
import { GLOBE_LINK } from '../../services/world/globe-link';
import { LocationChangeCoordinatorService } from '../../services/location/location-change-coordinator.service';
import { TowerDefenseFacadeService } from '../../services/facade/tower-defense-facade.service';
import { readDesktopBridge } from '../../core/desktop-bridge';
import { autosaveElsewhere } from './autosave-place';
import type { MenuLayer, MenuPage } from './menu-page';
import { startMenuSkipped } from './start-menu-skipped';
import { WorldContext } from '../../world/world-context.service';
import { WorldChoiceService } from '../../world/world-choice.service';
import { WorldStartService } from '../../world/world-start';
import { pageQuery } from '../../core/page-switches';
import { CUSTOM_MAPS_OPEN } from '../../world/custom-maps-open';
import { AppScreen } from '../../world/app-screen.service';
import { WorldSession, type ParkedWorld } from '../../world/world-session.service';
import type { OsmFrameRequest } from '../osm-frame/osm-frame-request';
import { PLAIN_START } from '../../world/world-start';
import { WorldsStageService } from '../../worlds/worlds-stage.service';
import { worldOfPage } from '../../world/world-of-page';
import { recordRecentMap } from '../../worlds/recent-maps';
import { autosaveSlotOf, type WorldId, type WorldPick } from '../../worlds/world-rules';
import { whyNot } from '../../world/why-not';

export { startMenuSkipped } from './start-menu-skipped';

/** The autosave as the list offers it: "Heilbronn | wave 12" */
export interface AutosaveOffer {
  /** The slot: the real places' autosave or the maps' */
  slotId: string;
  place: string;
  wave: number;
  /** It stands at another place than the one loaded: Continue goes there (E120) */
  elsewhere: boolean;
}

/**
 * The main menu's state and its ways (docs/MAIN_MENU_UI_PLAN.md): which
 * page shows in which layer, and the pages walked to get there. Provided by
 * TowerDefenseComponent, so the menu and its pages reach the game's
 * services (CoopService, SAVE_GAME, ReplayService); the open state is
 * mirrored in UIStore.mainMenu for code outside that scope.
 *
 * Pages navigate through here only: `open(page)` goes forward, `back()` one
 * page back, `close()` back to the game. A place chosen in the menu
 * (LocationChangeCoordinatorService.choosePlace) loads behind it, in the
 * start layer; `requestPlay()` closes the start menu once the place stands,
 * a click before that is kept and played when it does.
 *
 * Alone the game pauses while the menu stands, in both layers; it goes on
 * when the menu closes, unless it was paused before. In coop the room's
 * clock is everyone's, so the menu never pauses it.
 */
@Injectable()
export class MainMenuService {
  private readonly ui = inject(UIStore);
  private readonly store = inject(GameStore);
  private readonly coop = inject(COOP, { optional: true });
  private readonly saves = inject(SAVE_GAME);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly location = inject(LocationChangeCoordinatorService);
  private readonly globe = inject(GLOBE_LINK, { optional: true });
  private readonly facade = inject(TowerDefenseFacadeService, { optional: true });
  private readonly worldContext = inject(WorldContext);
  private readonly worlds = inject(WorldChoiceService);
  private readonly start = inject(WorldStartService);
  private readonly screens = inject(AppScreen);
  private readonly session = inject(WorldSession);
  /** This game stands held behind the globes (WorldSession.parked): paused, its frames stopped, the keys not its own */
  readonly parked = computed(() => this.session.parked() !== null);
  /** The custom maps are open (CUSTOM_MAPS_OPEN): the start list has its two tabs */
  private readonly mapsOpen = inject(CUSTOM_MAPS_OPEN);
  private readonly bridge = readDesktopBridge();

  readonly isOpen = computed(() => this.ui.mainMenu().open);
  readonly layer = computed(() => this.ui.mainMenu().layer);
  readonly page = computed(() => this.ui.mainMenu().page);

  /** The pages walked to the one showing, oldest first; Back pops it */
  private readonly history = signal<readonly MenuPage[]>([]);

  /** Automated runs play without the start menu (startMenuSkipped), so do a benchmark and a bot check the game started */
  readonly automated = startMenuSkipped(pageQuery()) || this.start.current().benchmark !== null || this.start.current().trial?.bot != null;

  /** The start order named the place (a link's ?l=): Play comes before Continue */
  readonly linkedPlace = this.start.current().place !== null;

  /**
   * The world was opened with Start (the globes, Continue, a map picked in
   * the game): the start layer is its loading, the game shows once it
   * stands, Esc or Cancel goes back to the world's menu (docs/WORLDS_NAVIGATION_PLAN.md, 3.3)
   */
  readonly fromStart = this.start.current().play;
  /** The Start's loading stands: until the game shows the first time */
  readonly starting = signal(this.fromStart);
  /** What loads, as the loading names it */
  readonly startLabel = this.start.current().label;
  /** The globes, looked up when the game goes back to them */
  private readonly injector = inject(Injector);
  private get stage(): WorldsStageService {
    return this.injector.get(WorldsStageService);
  }

  // ---- The place behind the menu ----

  /** A place is chosen and loads or stands; false while the game waits for the first one */
  readonly hasPlace = computed(() => !this.location.awaitingStartChoice() && this.locationMgmt.hq() !== null);
  /**
   * The place loads (the loading plate shows). A failed engine sets
   * `loading` off itself; an error left from a change that broke shows no
   * longer while the next place loads.
   */
  readonly placeLoading = computed(() => this.hasPlace() && this.engineInit.loading());
  /** The menu globe loads the dive's tiles before it flies: how far in percent, null while it does not */
  readonly descent = computed(() => this.globe?.descent() ?? null);
  /** The place stands, and the dive from the menu globe has landed in it: Play starts the game there */
  readonly ready = computed(
    () => this.hasPlace() && !this.engineInit.loading() && !this.playBlocked() && !this.globe?.holdsPlay(),
  );
  /**
   * The last load went wrong (UIStore.loadProblem), the map's tiles do not
   * come (UIStore.tilesProblem), or the engine failed.
   * The engine's error waits while another place loads: the plate shows that
   * load, not the failure before it.
   */
  readonly problem = computed(() => {
    const problem = this.ui.loadProblem() ?? this.ui.tilesProblem();
    if (problem) return problem;
    const error = this.engineInit.error();
    return error && !this.engineInit.loading() ? { text: error } : null;
  });
  /**
   * Nothing to play: the engine failed, the map's tiles do not come, or the place has no streets. A
   * place that did not load beside it (the dice, a change whose streets
   * did not come) leaves the old one to play on.
   */
  readonly playBlocked = computed(
    () => this.engineInit.error() !== null || this.ui.loadProblem()?.blocksPlay === true || this.ui.tilesProblem() !== null,
  );

  /** Play was pressed while the place loaded: the menu closes when it stands */
  readonly pendingPlay = signal(false);

  // ---- Real places and custom maps ----

  /** The page plays a custom map */
  readonly onMap = computed(() => this.worldContext.ref().kind === 'custom-map');
  /** The custom map this page plays, to edit: while the maps are open (or back from the editor's test), not in a replay; else null */
  readonly editableMapId = computed(() => {
    const ref = this.worldContext.ref();
    return (this.mapsOpen || this.fromEditor) && ref.kind === 'custom-map' && !this.ui.replayMode() ? ref.mapId : null;
  });

  /** The world is the editor's test of its map ("Test map", the bot check): editing the map goes back to the editor */
  readonly fromEditor = this.start.current().trial !== null;
  /** The words of the way into the editor: back to it from its test tab, else the map opens there */
  readonly editMapLabel = this.fromEditor ? 'Back to editor' : 'Edit this map';

  /**
   * The map editor in this window on the map this page plays (a shipped one opens there as an own copy); the
   * run waits as autosave (runWaits). From the editor's test the editor comes back as it was, the map and its
   * history still open in it; the test is not kept.
   */
  async editThisMap(): Promise<void> {
    const mapId = this.editableMapId();
    if (mapId === null) return;
    if (this.fromEditor) this.screens.openEditor(null);
    else await this.editMap(mapId);
  }

  /**
   * Off to another world's Continue (a chip of the path): the run here is kept as autosave first when it
   * stands between the waves, then `go`; in a wave the autosave of its start stays its Continue
   */
  async goElsewhere(go: () => void): Promise<void> {
    if (this.underWay() && !this.inCoop() && !this.store.isGameOver() && this.saves.canSave()) await this.saves.autosaveNow();
    go();
  }

  /** The map editor in this window, on its list of maps (or the map open in it); the run waits as autosave */
  openMapEditor(): Promise<void> {
    return this.editMap(null);
  }

  /** The map editor in this window on `mapId` (null: its list); the run waits as autosave (runWaits) */
  async editMap(mapId: string | null): Promise<void> {
    await this.runWaits();
    this.worlds.editMap(mapId);
  }

  /** This world's autosave slot (each world keeps its own); null where a run keeps none (DevWorld) */
  private readonly autosaveSlotHere = computed(() => {
    const world = worldOfPage(this.worldContext.ref());
    return world ? autosaveSlotOf(world) : null;
  });

  /** The autosave that holds this run at the start of the wave under way, null without one */
  private readonly autosaveOfThisWave = computed(() => {
    const slotId = this.autosaveSlotHere();
    const slot = slotId ? this.saves.slots().find((s) => s.id === slotId) : undefined;
    if (!slot || slot.wave !== this.store.waveNumber()) return null;
    const ref = this.worldContext.ref();
    if (ref.kind === 'custom-map') return slot.map?.id === ref.mapId ? slot : null;
    return autosaveElsewhere(slot, { hq: this.locationMgmt.hq(), name: this.placeName() ?? '' }) ? null : slot;
  });

  /**
   * What happens to the run when the editor opens (decision 2 of docs/WORLDS_NAVIGATION_PLAN.md): it waits
   * as autosave between waves, at the start of its wave in one; it ends without an autosave; null with no
   * run under way.
   */
  readonly runWhenEditing = computed<'waits' | 'wave-start' | 'ends' | null>(() => {
    if (!this.underWay() || this.store.isGameOver()) return null;
    if (this.inCoop() || this.ui.replayMode() || !this.autosaveSlotHere()) return 'ends';
    if (this.saves.canSave()) return 'waits';
    return this.autosaveOfThisWave() ? 'wave-start' : 'ends';
  });

  /**
   * The run waits as its world's autosave while the editor shows: saved now between waves, else the
   * autosave of its wave's start; AppScreen.waitingRun names it for "Back to the run". Nothing waits when
   * the run ends (runWhenEditing).
   */
  private async runWaits(): Promise<void> {
    const when = this.runWhenEditing();
    const slotId = this.autosaveSlotHere();
    this.screens.waitingRun.set(null);
    if (!slotId || (when !== 'waits' && when !== 'wave-start')) return;
    const saved = when === 'waits' && (await this.saves.autosaveNow());
    const slot = saved ? this.saves.slots().find((s) => s.id === slotId) : this.autosaveOfThisWave();
    if (!slot) return;
    const ref = this.worldContext.ref();
    const name = ref.kind === 'custom-map' ? (slot.map?.name ?? slot.location) : shortPlaceName(slot.location);
    this.screens.waitingRun.set({
      order: { ...PLAIN_START, world: ref.kind === 'tiles' ? null : ref, resume: slotId, play: true, label: name },
      label: `${name} | wave ${slot.wave}`,
      mapId: ref.kind === 'custom-map' ? ref.mapId : null,
    });
  }

  /** A save the page was opened to load (?resume=), said when it went wrong */
  readonly notice = signal<string | null>(null);

  // ---- The run ----

  readonly inCoop = computed(() => this.coop?.inGame() ?? false);
  /** The run has begun: Restart, Load and Quit end something */
  readonly underWay = computed(() => this.store.gameStarted() || this.store.towerCount() > 0);
  /** Restart needs the game's facade; in coop the host restarts at game over (docs/COOP_PLAN.md, R1) */
  readonly canRestart = computed(() => this.facade !== null && !this.inCoop() && this.hasPlace());
  /** The place is the player's to change: not in a coop game, not for a guest in a lobby (coopMapLocked) */
  readonly canChangePlace = computed(() => !this.inCoop() && !this.ui.coopMapLocked());
  /** Quit exists where the app can end itself: the desktop build from 0.5.1 on */
  readonly canQuit = typeof this.bridge?.quit === 'function';

  /**
   * This world's autosave, offered while the new run has not begun (the
   * start list of a game opened at once: a link, a coop room); once the run
   * is under way the autosave is this run's. The other worlds' Continues are
   * the globes' and the chips' (docs/WORLDS_STATE_PLAN.md, 3.3).
   */
  readonly autosaveOffer = computed<AutosaveOffer | null>(() => {
    if (this.inCoop() || this.underWay()) return null;
    const slotId = this.autosaveSlotHere();
    const autosave = slotId ? this.saves.slots().find((slot) => slot.id === slotId) : undefined;
    if (!autosave) return null;
    const place = autosave.map?.name ?? shortPlaceName(autosave.location);
    const elsewhere = this.needsOtherWorld(autosave) || (!autosave.map && this.autosavePlaceDiffers());
    return { slotId: autosave.id, place, wave: autosave.wave, elsewhere };
  });

  /** The place loaded here, as the list names it */
  readonly placeName = computed(() => (this.hasPlace() ? shortPlaceName(this.locationMgmt.displayName()) : null));

  /** The game paused by the menu goes on when it closes */
  private pausedByMenu = false;

  constructor() {
    this.resumeFromLink();
    // Held behind the globes: no frames drawn, the pause menu shut once the game shows again
    let held = false;
    effect(() => {
      const parked = this.parked();
      if (parked === held) return;
      held = parked;
      untracked(() => {
        const loop = this.engineInit.getEngine()?.renderLoop;
        if (parked) {
          loop?.stop();
          return;
        }
        loop?.start();
        this.close();
      });
    });
    const offHeld = this.session.onLeaveParked((keep) => this.leaveHeld(keep));
    inject(DestroyRef).onDestroy(offHeld);
    // A Built World played (its first wave or tower) goes on top of that world's Recent; a test of the map does not
    effect(() => {
      const ref = this.worldContext.ref();
      if (!this.underWay() || this.fromEditor || ref.kind !== 'custom-map' || worldOfPage(ref) !== 'maps') return;
      untracked(() => recordRecentMap(ref.mapId));
    });
    // Started from a world's menu: played as soon as the place is there (a save's Continue plays once loaded)
    if (this.fromStart && !this.start.current().resume) {
      let asked = false;
      effect(() => {
        if (asked || !this.hasPlace()) return;
        asked = true;
        untracked(() => this.requestPlay());
      });
    }
    // Play waiting for the landing makes the dive quicker
    effect(() => this.globe?.playWaits.set(this.pendingPlay()));
    effect(() => {
      const hold = this.isOpen() && !this.inCoop();
      const paused = this.store.paused();
      untracked(() => this.holdPause(hold, paused));
    });
    // Play pressed while loading: played once the place stands
    effect(() => {
      if (!this.pendingPlay() || !this.ready()) return;
      untracked(() => {
        this.pendingPlay.set(false);
        this.close();
      });
    });
    // In a coop room the place is the room's (a guest joining or following the
    // host, the host's dice in the lobby): nobody waits behind Play, the menu
    // goes once the place stands and the dock or the game is in front again
    effect(() => {
      if (this.coop?.room() && this.placeLoading()) untracked(() => this.pendingPlay.set(true));
    });
    // Another place starts to load (header, dice, favourite, a save elsewhere,
    // a coop guest following the host): the start layer shows its plate. A
    // page open stays (the Load page waits for its load to say how it went),
    // a closed menu opens on its list.
    let wasLoading = this.engineInit.loading();
    effect(() => {
      const loading = this.engineInit.loading();
      const began = loading && !wasLoading;
      wasLoading = loading;
      if (began && !this.automated) untracked(() => this.showStartLayer());
    });
  }

  // ---- Pages ----

  /**
   * Open the menu on `page`, or go to it while the menu stands (Back returns
   * to the page before). A closed menu opens in `layer`, by default the
   * pause layer; an open one keeps its layer unless one is given.
   */
  open(page: MenuPage = 'home', layer?: MenuLayer): void {
    const state = this.ui.mainMenu();
    if (!state.open) {
      this.history.set([]);
      this.ui.mainMenu.set({ open: true, layer: layer ?? 'pause', page });
      return;
    }
    if (state.page !== page) this.history.update((pages) => [...pages, state.page]);
    this.ui.mainMenu.set({ open: true, layer: layer ?? state.layer, page });
  }

  /** Back to the list in `layer`, no page history; opens the menu when it is closed */
  home(layer: MenuLayer = this.layer()): void {
    this.history.set([]);
    this.ui.mainMenu.set({ open: true, layer, page: 'home' });
  }

  /** The start layer, on the page open or else on the list */
  private showStartLayer(): void {
    const state = this.ui.mainMenu();
    if (!state.open) this.history.set([]);
    this.ui.mainMenu.set({ open: true, layer: 'start', page: state.open ? state.page : 'home' });
  }

  /** The start menu at app start, after the token step; not for automated runs */
  openStart(): void {
    if (!this.automated) this.open('home', 'start');
  }

  /**
   * One step back: the page before, else the list. On the list the pause
   * layer closes (back to the game); the start layer stays, it has no game
   * behind it to go back to. True when it did something.
   */
  back(): boolean {
    const state = this.ui.mainMenu();
    if (!state.open) return false;
    const pages = this.history();
    if (pages.length > 0) {
      this.history.set(pages.slice(0, -1));
      this.ui.mainMenu.set({ ...state, page: pages[pages.length - 1] });
      return true;
    }
    if (state.page !== 'home') {
      this.ui.mainMenu.set({ ...state, page: 'home' });
      return true;
    }
    if (state.layer === 'pause') {
      this.close();
      return true;
    }
    // The loading of a Start: Esc cancels it, back to the world's menu, nothing changed
    if (this.starting() && !this.inCoop()) {
      this.cancelStart();
      return true;
    }
    return false;
  }

  /** Back to the game; the show of a place that stood up meanwhile starts now (StartShowService) */
  close(): void {
    const state = this.ui.mainMenu();
    if (!state.open) return;
    this.history.set([]);
    this.pendingPlay.set(false);
    this.starting.set(false);
    // Said and gone: the place played on is the old one
    if (!this.playBlocked()) this.ui.loadProblem.set(null);
    this.ui.mainMenu.set({ ...state, open: false, page: 'home' });
  }

  // ---- Playing ----

  /** Play, or Continue of a run already loaded: now when the place stands, else as soon as it does */
  requestPlay(): void {
    if (this.ready()) this.close();
    else if (this.hasPlace() && !this.playBlocked()) this.pendingPlay.set(true);
  }

  /**
   * Continue an autosave (by default the real places'): it loads (at its
   * place, which may be another), then the game shows. Asking about another
   * place is the list's (E120).
   */
  async continueAutosave(slotId: string = AUTOSAVE_SLOT): Promise<LoadResult> {
    const slot = this.saves.slots().find((s) => s.id === slotId);
    const result = slotId === AUTOSAVE_SLOT && !(slot && this.needsOtherWorld(slot))
      ? await this.saves.continueAutosave()
      : await this.loadSlot(slotId);
    if (result.ok) this.requestPlay();
    return result;
  }

  /**
   * Load a slot. One of another world (a map's save on the real places, a
   * real place's on a map, another map) loads the page anew there and
   * loads it then (WorldChoiceService.openSave); else here.
   */
  async loadSlot(slotId: string): Promise<LoadResult> {
    const slot = this.saves.slots().find((s) => s.id === slotId);
    if (slot && this.needsOtherWorld(slot)) {
      this.worlds.openSave(slot);
      return { ok: true, note: null };
    }
    return this.saves.load(slotId);
  }

  /** The save plays on another world than this page's */
  needsOtherWorld(slot: Pick<SaveSlotInfo, 'map'>): boolean {
    const here = this.worldContext.ref();
    if (slot.map) return here.kind !== 'custom-map' || here.mapId !== slot.map.id;
    return !this.worldContext.capabilities().realPlace;
  }

  /** The start order asks to load a save (a link's ?resume=): it loads now, once (WorldStartService.takeResume) */
  private resumeFromLink(): void {
    const slotId = this.start.takeResume();
    if (!slotId) return;
    void this.saves.load(slotId).then((result) => {
      if (!result.ok) this.notice.set(result.reason);
      else if (result.note) this.notice.set(`Loaded. ${result.note}`);
      else this.requestPlay();
    });
  }

  /** The autosave stands at another place than the one loaded (E120) */
  autosavePlaceDiffers(): boolean {
    const autosave = this.saves.slots().find((slot) => slot.id === AUTOSAVE_SLOT);
    if (!autosave || !this.hasPlace()) return false;
    return autosaveElsewhere(autosave, { hq: this.locationMgmt.hq(), name: this.locationMgmt.displayName() });
  }

  /** Restart at the same place (the list asks first while a run is under way) */
  restart(): void {
    if (!this.canRestart()) return;
    this.saves.newRun();
    this.facade?.restartGame();
    this.close();
  }

  /** End the desktop app */
  quit(): void {
    this.bridge?.quit?.();
  }

  // ---- Back to the worlds ----

  /** Why the game cannot go back to the worlds now (a coop room would lose the player), null when it can */
  readonly leaveWhy = computed(() =>
    whyNot('leave', {
      mapsOpen: this.mapsOpen,
      inCoopRoom: this.inCoop() || (this.coop?.room() ?? null) !== null,
      coopGuest: this.ui.coopMapLocked(),
      replay: this.ui.replayMode(),
    }),
  );

  /** The world menu of this world's kind, as the pause menu names it */
  readonly worldMenuLabel = computed(() => {
    const world = this.worldOfPage();
    return world === 'real' ? 'Real places' : world === 'osm' ? 'OpenStreetMap' : world === 'maps' ? 'Built Worlds' : 'Worlds';
  });

  /**
   * Leave the game for the globes: `world` to this world's menu with its
   * place or map picked, else the three globes. Nothing ends: the game stays
   * held behind them (WorldSession.park), Continue or Back to shows it at
   * once, and it goes only when something else starts (docs/WORLDS_STATE_PLAN.md, 3.7).
   * The pause menu stays open meanwhile, so the game stays paused and its keys are the menu's.
   */
  leaveTo(target: 'world' | 'globes'): void {
    if (this.leaveWhy()) return;
    const world = this.worldOfPage();
    this.stage.leaveGame(target === 'world' && world ? { world, pick: this.pickOfPage() } : null, this.hold());
  }

  /**
   * A map of a real place (Make map in the path, the place picker): its
   * OpenStreetMap frame on the globes, this game held behind them. `request`
   * names the place; none: the one loaded here, with the spawns of its run.
   */
  makeMapOf(request: OsmFrameRequest | null = null): void {
    if (this.leaveWhy()) return;
    const pick = this.pickOfPage();
    const place: Extract<WorldPick, { kind: 'place' }> | null = request
      ? { kind: 'place', hq: { lat: request.place.lat, lon: request.place.lon }, spawns: [...(request.spawnsAt ?? [])], name: request.place.address ?? request.place.name }
      : pick?.kind === 'place' ? pick : null;
    if (!place) return;
    this.stage.leaveGame(null, this.hold());
    this.stage.makeMapOf(place, 'real');
  }

  /**
   * What the globes hold of this game when it leaves for them (WorldSession.park); null for the editor's
   * test, which is no run to hold and ends. The pause menu opens, so the game stays paused behind them.
   */
  private hold(): ParkedWorld | null {
    if (this.fromEditor) return null;
    if (!this.isOpen()) this.open('home', 'pause');
    const pick = this.pickOfPage();
    return {
      world: this.worldOfPage(),
      pick,
      label: pick ? (pick.kind === 'place' ? shortPlaceName(pick.name) : pick.name) : (this.placeName() ?? 'this place'),
      wave: Math.max(1, this.store.waveNumber() + (this.store.phase() === 'setup' ? 1 : 0)),
      run: this.underWay() && !this.store.isGameOver(),
    };
  }

  /**
   * The held game goes for good (another start, the editor, a coop room):
   * its run is kept as autosave when it stands between the waves; in a wave
   * the autosave of that wave's start stays. With `keep` false the run ends.
   */
  private async leaveHeld(keep: boolean): Promise<void> {
    if (keep && this.underWay() && !this.store.isGameOver()) await this.saves.autosaveNow();
  }

  /** The loading of a Start stopped: back to the world's menu with its pick; the editor's test back to the editor */
  cancelStart(): void {
    if (this.fromEditor) {
      this.screens.openEditor(null);
      return;
    }
    const world = this.worldOfPage();
    this.stage.leaveGame(world ? { world, pick: this.pickOfPage() } : null);
  }

  /** The world of the globes this page plays in (worldOfPage); null for DevWorld */
  private worldOfPage(): WorldId | null {
    return worldOfPage(this.worldContext.ref());
  }

  /** The place or map this page plays, as a world's menu picks it */
  private pickOfPage(): WorldPick | null {
    const ref = this.worldContext.ref();
    if (ref.kind === 'custom-map') return { kind: 'map', id: ref.mapId, name: ref.name ?? this.startLabel ?? ref.mapId };
    if (ref.kind === 'tileset') {
      const set = this.worlds.tilesets().find((t) => t.id === ref.id);
      return { kind: 'tileset', id: ref.id, name: set?.name ?? ref.id };
    }
    const hq = this.locationMgmt.hq() ?? this.start.current().place?.hq ?? null;
    if (!hq) return null;
    const spawns = this.locationMgmt.hq() ? this.locationMgmt.spawns() : (this.start.current().place?.spawns ?? []);
    const name = this.hasPlace() ? this.locationMgmt.displayName() : (this.startLabel ?? `${hq.lat.toFixed(4)}, ${hq.lon.toFixed(4)}`);
    return {
      kind: 'place',
      hq: { lat: hq.lat, lon: hq.lon },
      spawns: spawns.map(({ lat, lon, portalBearing }) => (portalBearing === undefined ? { lat, lon } : { lat, lon, portalBearing })),
      name,
    };
  }

  // ---- Pause ----

  /**
   * Pause the solo game while the menu stands; let it go on after, unless
   * it was paused before. A new run behind the menu (a place, a restart)
   * sets it going: paused again.
   */
  private holdPause(hold: boolean, paused: boolean): void {
    if (hold && !paused) {
      this.pausedByMenu = true;
      this.store.paused.set(true);
    } else if (!hold && this.pausedByMenu) {
      this.pausedByMenu = false;
      this.store.paused.set(false);
    }
  }
}
