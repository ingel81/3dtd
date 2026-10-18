import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
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

/** An entry of the list */
export type HomeEntryId =
  | 'continue' | 'saves' | 'settings' | 'extras' | 'coop' | 'edit-map' | 'restart' | 'world-menu' | 'worlds' | 'quit';

export interface HomeEntry {
  id: HomeEntryId;
  label: string;
  /** The line under it: the world of World menu, why it is locked */
  sub: string | null;
  /** Below the line of the list (Coop and the ways out) */
  below: boolean;
  /** Why it is locked now (back to the worlds in a coop room): said under it, the entry stays */
  why?: string | null;
}

/** The icon before each entry */
export const HOME_ENTRY_ICON: Record<HomeEntryId, TdIconName> = {
  continue: 'play',
  saves: 'filing',
  settings: 'cog',
  extras: 'manual',
  coop: 'users',
  'edit-map': 'terrain',
  restart: 'refresh',
  'world-menu': 'layers',
  worlds: 'globe',
  quit: 'power',
};

/** What the list asks before it does it, in its own place under the list */
export type HomeConfirm =
  | { kind: 'restart' }
  | { kind: 'edit-map' }
  | { kind: 'quit' };

const PAGE_OF: Partial<Record<HomeEntryId, MenuPage>> = {
  coop: 'coop',
  saves: 'saves',
  settings: 'settings',
  extras: 'extras',
};

/**
 * The menu's list (docs/MAIN_MENU_UI_PLAN.md, Menü 4; docs/WORLDS_STATE_PLAN.md).
 * In the pause layer: Continue back to the game, Saves (saving, loading,
 * Restart), Settings, Extras, and below the line Coop, Edit this map (a
 * custom map), World menu, All worlds, Quit in the app. The editor's test
 * of a map is no run: Continue, Back to editor, Again from wave N, Settings.
 *
 * The start layer has no list: it is the loading of the world, as the
 * world menus' Start shows it (Loading <place>, the bar, Cancel back to the
 * world's menu); a world not started from there (a link, a room, another
 * place chosen) stands with Play once it is there.
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
  /** The layer the menu stands in: the pause list, or the start's loading */
  readonly layer = input.required<MenuLayer>();
  readonly icons = HOME_ENTRY_ICON;
  readonly menu = inject(MainMenuService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly store = inject(GameStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  readonly confirm = signal<HomeConfirm | null>(null);

  readonly plate = computed(() => loadingPlateView(this.engineInit.loadingSteps()));

  /** What the run loaded here is: "Heilbronn | wave 12", the wave as its Continue and its saves name it */
  readonly runLine = computed(() => {
    const place = this.menu.placeName();
    const wave = this.menu.runWave();
    return place ? `${place} | wave ${wave}` : `wave ${wave}`;
  });

  /** The start's loading: what loads, or what stands once it is there */
  readonly startName = computed(() => this.menu.startLabel ?? this.menu.placeName() ?? 'the world');
  /** Still loading: the bar shows; once the place stands a world not started from a menu waits for Play */
  readonly loadingNow = computed(() => !this.menu.hasPlace() || this.menu.placeLoading());

  readonly entries = computed<HomeEntry[]>(() => {
    const menu = this.menu;
    if (this.layer() !== 'pause') return [];
    const entry = (id: HomeEntryId, label: string, sub: string | null = null, below = false): HomeEntry => ({ id, label, sub, below });

    // The editor's test of its map is no run: back to the editor, the test again from its wave, the settings
    if (menu.fromEditor) {
      return [entry('continue', 'Continue'), entry('edit-map', menu.editMapLabel), entry('restart', menu.restartLabel), entry('settings', 'Settings', null, true)];
    }

    // Saves: locked with why in a coop game, never hidden (docs/WORLDS_NAVIGATION_PLAN.md, 3.2)
    const savesWhy = menu.inCoop() ? 'A coop game is not saved' : null;
    const list: HomeEntry[] = [
      entry('continue', 'Continue'),
      { ...entry('saves', 'Saves', savesWhy), why: savesWhy },
      entry('settings', 'Settings'),
      entry('extras', 'Extras'),
      entry('coop', 'Coop', null, true),
    ];
    if (menu.editableMapId() !== null) list.push({ ...entry('edit-map', menu.editMapLabel, menu.editWhy(), true), why: menu.editWhy() });
    // Back to the worlds: the game is held behind them (docs/WORLDS_STATE_PLAN.md, 3.7); in a coop room locked with why
    const leaveWhy = menu.leaveWhy();
    const worldMenu = menu.worldMenuLabel();
    if (worldMenu) list.push({ ...entry('world-menu', 'World menu', leaveWhy ?? worldMenu, true), why: leaveWhy });
    list.push({ ...entry('worlds', 'All worlds', leaveWhy, true), why: leaveWhy });
    if (menu.canQuit) list.push(entry('quit', 'Quit 3DTD', null, true));
    return list;
  });

  /** The head of the pause list: "Paused" left, the run's line right; in coop the game goes on; a run lost is over */
  readonly pauseWord = computed(() => (this.store.isGameOver() ? 'Game over' : this.menu.inCoop() ? 'Coop' : 'Paused'));

  activate(entry: HomeEntry): void {
    if (entry.why) return;
    const page = PAGE_OF[entry.id];
    if (page) {
      this.menu.open(page);
      return;
    }
    switch (entry.id) {
      case 'continue':
        this.menu.close();
        return;
      case 'restart':
        if (this.menu.underWay()) this.ask({ kind: 'restart' });
        else this.menu.restart();
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

  /** The confirmation's yes */
  confirmed(): void {
    const confirm = this.confirm();
    this.confirm.set(null);
    if (!confirm) return;
    if (confirm.kind === 'restart') this.menu.restart();
    else if (confirm.kind === 'edit-map') void this.menu.editThisMap();
    else this.menu.quit();
  }

  cancelConfirm(): void {
    const kind = this.confirm()?.kind ?? 'continue';
    this.confirm.set(null);
    // Back on the entry that asked
    afterNextRender(() => this.focusEntry(kind), { injector: this.injector });
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
      case 'restart':
        return this.menu.fromEditor
          ? { question: `${this.menu.restartLabel}? This test starts over.`, yes: 'Start over' }
          : { question: 'Restart here? The run ends.', yes: 'Restart' };
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
