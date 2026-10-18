import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RovingGroupDirective } from '../../../roving-group.directive';
import { TdIconComponent, type TdIconName } from '../../../icon/icon.component';
import { MainMenuService } from '../../main-menu.service';
import { EngineInitializationService } from '../../../../services/infrastructure/engine-initialization.service';
import { GameStore } from '../../../../store/game.store';
import { loadingPlateView } from '../../loading/loading-plate';
import type { MenuLayer, MenuPage } from '../../menu-page';
import { CUSTOM_MAPS_OPEN } from '../../../../world/custom-maps-open';

/** An entry of the list */
export type HomeEntryId =
  | 'continue' | 'play' | 'new-game' | 'coop' | 'save' | 'load' | 'settings' | 'extras' | 'editor' | 'edit-map' | 'restart'
  | 'world-menu' | 'worlds' | 'quit';

export interface HomeEntry {
  id: HomeEntryId;
  label: string;
  /** The line under it: "Heilbronn, wave 12" */
  sub: string | null;
  /** Below the line of the list (New game in the pause layer, Restart, Quit) */
  below: boolean;
  /** Loads with the place: its bar shows while it does */
  loads: boolean;
  /** Shown but not yet open (the map editor before its release) */
  off?: boolean;
  /** Why it is locked now (back to the worlds in a coop room): said under it, the entry stays */
  why?: string | null;
}

/** The icon before each entry */
export const HOME_ENTRY_ICON: Record<HomeEntryId, TdIconName> = {
  continue: 'play',
  play: 'play',
  'new-game': 'flag',
  coop: 'users',
  save: 'download',
  load: 'filing',
  settings: 'cog',
  extras: 'manual',
  editor: 'terrain',
  'edit-map': 'terrain',
  restart: 'refresh',
  'world-menu': 'layers',
  worlds: 'globe',
  quit: 'power',
};

/** What the list asks before it does it, in its own place under the list */
export type HomeConfirm =
  | { kind: 'leave'; from: string; to: string }
  | { kind: 'restart' }
  | { kind: 'editor' }
  | { kind: 'edit-map' }
  | { kind: 'quit' };

const PAGE_OF: Partial<Record<HomeEntryId, MenuPage>> = {
  'new-game': 'new-game',
  coop: 'coop',
  save: 'save',
  load: 'load',
  settings: 'settings',
  extras: 'extras',
};

/**
 * The menu's list (docs/MAIN_MENU_UI_PLAN.md, Menü 4). In the start layer:
 * Continue (an autosave, or a run loaded), Play (the place behind the menu),
 * New game, Coop, Save (with a run), Load, Settings, Extras, World menu and All worlds, Quit in the app.
 * In the pause layer: Continue back to the game, Save, Load, Settings,
 * Extras, and below the line New game, Coop, Edit this map (a custom map), Restart here, Quit. Not in a
 * coop game: Save, Load, Restart, New game (the map is the room's).
 *
 * While the place loads, one entry shows the bar: the one the player chose,
 * else the first that loads (Play and Continue both can); a click then
 * waits and plays once it stands. Continue to an autosave at another
 * place asks first (E120), Restart and Quit with a run under way too.
 */
@Component({
  selector: 'app-menu-home',
  standalone: true,
  imports: [RovingGroupDirective, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './menu-home.component.html',
  styleUrl: './menu-home.component.scss',
  host: { '(keydown.escape)': 'onEscape($event)' },
})
export class MenuHomeComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
  readonly icons = HOME_ENTRY_ICON;
  readonly menu = inject(MainMenuService);
  /** The map editor opens; until its release the entry shows disabled */
  private readonly mapsOpen = inject(CUSTOM_MAPS_OPEN);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly store = inject(GameStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  readonly confirm = signal<HomeConfirm | null>(null);
  /** The last Continue went wrong: why */
  readonly status = signal<string | null>(null);
  /** The autosave loads */
  readonly busy = signal(false);
  /** The entry that loads the player last chose: it carries the bar */
  private readonly chosen = signal<HomeEntryId | null>(null);

  readonly plate = computed(() => loadingPlateView(this.engineInit.loadingSteps()));

  constructor() {
    // The first choice is the top entry (TODO E151). The menu focuses the
    // first entry as it opens, often before the place behind it is known;
    // Play or Continue then come in above New game. Focus still on the old
    // top entry means the player has not moved it: it goes to the new one.
    let top: HomeEntryId | null = null;
    effect(() => {
      const now = this.entries()[0]?.id ?? null;
      const before = top;
      top = now;
      if (before === null || now === null || now === before) return;
      afterNextRender(() => {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused.dataset['entry'] === before && this.host.contains(focused)) {
          this.focusEntry(now);
        }
      }, { injector: this.injector });
    });
  }

  /** What the run loaded here is: "Heilbronn | wave 12", the wave as its Continue and its saves name it */
  readonly runLine = computed(() => {
    const place = this.menu.placeName();
    const wave = this.menu.runWave();
    return place ? `${place} | wave ${wave}` : `wave ${wave}`;
  });

  readonly entries = computed<HomeEntry[]>(() => {
    const menu = this.menu;
    const solo = !menu.inCoop();
    const entry = (id: HomeEntryId, label: string, sub: string | null = null, below = false, loads = false): HomeEntry =>
      ({ id, label, sub, below, loads });
    const list: HomeEntry[] = [];

    // Back to the worlds: the game is held behind them (docs/WORLDS_STATE_PLAN.md, 3.7); in a coop room locked with why
    const leaveWhy = menu.leaveWhy();
    const worldMenu = menu.worldMenuLabel();
    const leave = [
      ...(worldMenu ? [{ ...entry('world-menu', 'World menu', leaveWhy ?? worldMenu, true), why: leaveWhy }] : []),
      { ...entry('worlds', 'All worlds', leaveWhy, true), why: leaveWhy },
    ];

    // The editor's test of its map is no run: back to the editor, the test again from its wave, the settings
    if (this.layer() === 'pause' && menu.fromEditor) {
      list.push(entry('continue', 'Continue'), entry('edit-map', menu.editMapLabel), entry('restart', menu.restartLabel));
      list.push(entry('settings', 'Settings', null, true));
      return list;
    }

    if (this.layer() === 'pause') {
      list.push(entry('continue', 'Continue'));
      // Save and Load keep their place, locked with why (docs/WORLDS_NAVIGATION_PLAN.md, 3.2): never hidden
      const saveWhy = !solo ? 'A coop game is not saved' : this.store.isGameOver() ? 'The run is over' : !menu.underWay() ? 'No run yet: build or start a wave' : null;
      const loadWhy = solo ? null : 'Leave the coop game first';
      list.push({ ...entry('save', 'Save game', saveWhy), why: saveWhy }, { ...entry('load', 'Load game', loadWhy), why: loadWhy });
      list.push(entry('settings', 'Settings'), entry('extras', 'Extras'));
      if (menu.offersNewGame()) list.push(entry('new-game', 'New game', null, true));
      list.push(entry('coop', 'Coop', null, true));
      if (menu.editableMapId() !== null) list.push({ ...entry('edit-map', menu.editMapLabel, menu.editWhy(), true), why: menu.editWhy() });
      list.push(...leave);
      if (menu.canRestart()) list.push(entry('restart', menu.restartLabel, null, true));
      if (menu.canQuit) list.push(entry('quit', 'Quit 3DTD', null, true));
      return list;
    }

    // The start list of a game opened at once (a link, a coop room, a save): this world's Continue and
    // Play; the other worlds are the globes' (World menu, All worlds), the place picker is New game
    const offer = menu.autosaveOffer();
    const head: HomeEntry[] = [];
    if (offer) {
      const line = `${offer.place} | wave ${offer.wave}`;
      head.push(entry('continue', 'Continue', offer.elsewhere ? `in ${line}` : line, false, !offer.elsewhere));
    } else if (menu.hasPlace() && menu.underWay()) {
      head.push(entry('continue', 'Continue', this.runLine(), false, true));
    }
    if (menu.hasPlace() && !menu.underWay()) head.push(entry('play', 'Play', menu.placeName(), false, true));
    // A place in the link: it is what the player came for
    if (menu.linkedPlace) head.reverse();
    // No place yet: choosing one comes first
    const choose = menu.offersNewGame();
    if (choose && !menu.hasPlace()) head.push(entry('new-game', 'New game'));
    list.push(...head);
    if (choose && menu.hasPlace()) list.push(entry('new-game', 'New game'));
    list.push(entry('coop', 'Coop'));
    if (solo && menu.underWay()) list.push(entry('save', 'Save game'));
    if (solo) list.push(entry('load', 'Load game'));
    list.push(entry('settings', 'Settings'), entry('extras', 'Extras'));
    const editWhy = this.mapsOpen ? menu.editWhy() : null;
    list.push({ ...entry('editor', 'Map editor', this.mapsOpen ? editWhy : 'Coming soon', true), off: !this.mapsOpen, why: editWhy });
    // The way back to the globes from a world opened at once, which may never stand (a room that does not answer)
    list.push(...leave);
    if (menu.canQuit) list.push(entry('quit', 'Quit 3DTD', null, true));
    return list;
  });

  /** The head of the pause list: "Paused" left, the run's line right; in coop the game goes on; a run lost is over */
  readonly pauseWord = computed(() => (this.store.isGameOver() ? 'Game over' : this.menu.inCoop() ? 'Coop' : 'Paused'));

  /** The one entry that shows the loading: the one chosen, else the first that loads */
  private readonly loadingEntry = computed<HomeEntryId | null>(() => {
    const loading = this.entries().filter((entry) => entry.loads);
    const chosen = this.chosen();
    return loading.find((entry) => entry.id === chosen)?.id ?? loading[0]?.id ?? null;
  });

  /** Play or Continue waits for the place: the bar shows in one entry, not in both */
  showsBar(entry: HomeEntry): boolean {
    return entry.id === this.loadingEntry() && this.menu.placeLoading();
  }

  /** The line under an entry: what it plays, or that it waits */
  subOf(entry: HomeEntry): string | null {
    if (entry.id === this.loadingEntry() && this.menu.pendingPlay()) return 'Starts when loaded';
    if (entry.id === 'continue' && this.busy()) return 'Loading the save';
    return entry.sub;
  }

  activate(entry: HomeEntry): void {
    if (entry.off || entry.why) return;
    this.status.set(null);
    if (entry.loads) this.chosen.set(entry.id);
    const page = PAGE_OF[entry.id];
    if (page) {
      this.menu.open(page);
      return;
    }
    switch (entry.id) {
      case 'continue':
        this.continue();
        return;
      case 'play':
        this.menu.requestPlay();
        return;
      case 'restart':
        if (this.menu.underWay()) this.ask({ kind: 'restart' });
        else this.menu.restart();
        return;
      case 'editor':
        if (this.menu.underWay() || this.menu.inCoop()) this.ask({ kind: 'editor' });
        else void this.menu.openMapEditor();
        return;
      case 'edit-map':
        if (this.menu.underWay() || this.menu.inCoop()) this.ask({ kind: 'edit-map' });
        else void this.menu.editThisMap();
        return;
      case 'world-menu':
      case 'worlds':
        // Nothing ends: the game stays held behind the globes (MainMenuService.leaveTo)
        this.menu.leaveTo(entry.id === 'worlds' ? 'globes' : 'world');
        return;
      case 'quit':
        if (this.menu.underWay() || this.menu.inCoop()) this.ask({ kind: 'quit' });
        else this.menu.quit();
        return;
    }
  }

  /** Continue: back to the game, the run loaded, or the autosave (asking first when it leaves this place) */
  private continue(): void {
    if (this.layer() === 'pause') {
      this.menu.close();
      return;
    }
    const offer = this.menu.autosaveOffer();
    if (!offer) {
      this.menu.requestPlay();
      return;
    }
    if (offer.elsewhere) {
      this.ask({ kind: 'leave', from: this.menu.placeName() ?? 'this place', to: offer.place });
      return;
    }
    void this.loadAutosave();
  }

  /** The confirmation's yes */
  confirmed(): void {
    const confirm = this.confirm();
    this.confirm.set(null);
    if (!confirm) return;
    if (confirm.kind === 'leave') void this.loadAutosave();
    else if (confirm.kind === 'restart') this.menu.restart();
    else if (confirm.kind === 'editor') void this.menu.openMapEditor();
    else if (confirm.kind === 'edit-map') void this.menu.editThisMap();
    else this.menu.quit();
  }

  cancelConfirm(): void {
    const confirm = this.confirm();
    const kind = confirm?.kind;
    this.confirm.set(null);
    // Back on the entry that asked
    const id: HomeEntryId = kind === 'leave' ? 'continue'
      : kind ?? 'continue';
    afterNextRender(() => this.focusEntry(id), { injector: this.injector });
  }

  private async loadAutosave(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const result = await this.menu.continueAutosave(this.menu.autosaveOffer()?.slotId);
      if (!result.ok) this.status.set(result.reason);
      else if (result.note) this.status.set(`Loaded. ${result.note}`);
    } finally {
      this.busy.set(false);
    }
  }

  private ask(confirm: HomeConfirm): void {
    this.confirm.set(confirm);
    afterNextRender(() => this.host.querySelector<HTMLElement>('.mh-confirm button')?.focus(), { injector: this.injector });
  }

  private focusEntry(id: HomeEntryId): void {
    this.host.querySelector<HTMLElement>(`[data-entry="${id}"]`)?.focus();
  }

  /**
   * The pointer over an entry takes the focus along while it is on the list,
   * so hover and keyboard focus never mark two entries at once. Not while the
   * focus is elsewhere (a page's search field): crossing the list with the
   * mouse must not pull it out.
   */
  followPointer(event: MouseEvent): void {
    const entry = event.currentTarget as HTMLElement;
    const focused = document.activeElement;
    if (focused === entry || !(focused instanceof HTMLElement) || focused.getAttribute('role') !== 'menuitem') return;
    if (!this.host.contains(focused)) return;
    entry.focus({ preventScroll: true });
  }

  /** Esc on a question takes it back, before the menu steps back */
  onEscape(event: Event): void {
    if (!this.confirm()) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancelConfirm();
  }

  /** The confirmation's question and its yes */
  confirmText(confirm: HomeConfirm): { question: string; yes: string } {
    switch (confirm.kind) {
      case 'leave':
        return { question: `Leaves ${confirm.from}: the save plays in ${confirm.to}.`, yes: 'Continue anyway' };
      case 'restart':
        return this.menu.fromEditor
          ? { question: `${this.menu.restartLabel}? This test starts over.`, yes: 'Start over' }
          : { question: 'Restart here? The run ends.', yes: 'Restart' };
      case 'editor':
        return { question: `Open the map editor? ${this.runWhenEditingText()}`, yes: 'Open the editor' };
      case 'edit-map':
        return this.menu.fromEditor
          ? { question: 'Back to the editor? The test run ends.', yes: 'Back to editor' }
          : { question: `Edit this map? ${this.runWhenEditingText()}`, yes: 'Open in the editor' };
      case 'quit':
        return { question: 'Quit 3DTD? The run ends.', yes: 'Quit' };
    }
  }

  /** What becomes of the run when the editor opens (MainMenuService.runWhenEditing) */
  private runWhenEditingText(): string {
    switch (this.menu.runWhenEditing()) {
      case 'waits':
        return 'The run waits as autosave; Back to the run comes back to it.';
      case 'wave-start':
        return 'The run waits as autosave from the start of this wave.';
      default:
        return this.menu.inCoop() ? 'You leave the coop game.' : 'The run ends.';
    }
  }
}
