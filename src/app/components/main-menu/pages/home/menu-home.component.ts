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
import { MainMenuService } from '../../main-menu.service';
import { EngineInitializationService } from '../../../../services/infrastructure/engine-initialization.service';
import { GameStore } from '../../../../store/game.store';
import { loadingPlateView } from '../../loading/loading-plate';
import type { MenuLayer, MenuPage } from '../../menu-page';

/** An entry of the list */
export type HomeEntryId =
  | 'continue' | 'play' | 'new-game' | 'coop' | 'save' | 'load' | 'settings' | 'extras' | 'restart' | 'quit';

export interface HomeEntry {
  id: HomeEntryId;
  label: string;
  /** The line under it in mono: "Heilbronn · wave 12" */
  sub: string | null;
  /** Below the line of the list (New game in the pause layer, Restart, Quit) */
  below: boolean;
  /** Loads with the place: its bar shows while it does */
  loads: boolean;
}

/** What the list asks before it does it, in its own place under the list */
export type HomeConfirm =
  | { kind: 'leave'; from: string; to: string }
  | { kind: 'restart' }
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
 * New game, Coop, Save (with a run), Load, Settings, Extras, Quit in the app.
 * In the pause layer: Continue back to the game, Save, Load, Settings,
 * Extras, and below the line New game, Coop, Restart here, Quit. Not in a
 * coop game: Save, Load, Restart, New game (the map is the room's).
 *
 * Play and Continue show the loading bar while the place loads; a click
 * then waits and plays once it stands. Continue to an autosave at another
 * place asks first (E120), Restart and Quit with a run under way too.
 */
@Component({
  selector: 'app-menu-home',
  standalone: true,
  imports: [RovingGroupDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './menu-home.component.html',
  styleUrl: './menu-home.component.scss',
  host: { '(keydown.escape)': 'onEscape($event)' },
})
export class MenuHomeComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
  readonly menu = inject(MainMenuService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly store = inject(GameStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  readonly confirm = signal<HomeConfirm | null>(null);
  /** The last Continue went wrong: why */
  readonly status = signal<string | null>(null);
  /** The autosave loads */
  readonly busy = signal(false);

  readonly plate = computed(() => loadingPlateView(this.engineInit.loadingSteps()));

  /** What the run loaded here is: "Heilbronn · wave 12" */
  private readonly runLine = computed(() => {
    const place = this.menu.placeName();
    const wave = Math.max(1, this.store.waveNumber());
    return place ? `${place} · wave ${wave}` : `wave ${wave}`;
  });

  readonly entries = computed<HomeEntry[]>(() => {
    const menu = this.menu;
    const solo = !menu.inCoop();
    const entry = (id: HomeEntryId, label: string, sub: string | null = null, below = false, loads = false): HomeEntry =>
      ({ id, label, sub, below, loads });
    const list: HomeEntry[] = [];

    if (this.layer() === 'pause') {
      list.push(entry('continue', 'Continue'));
      if (solo && menu.underWay()) list.push(entry('save', 'Save'));
      if (solo) list.push(entry('load', 'Load'));
      list.push(entry('settings', 'Settings'), entry('extras', 'Extras'));
      if (menu.canChangePlace()) list.push(entry('new-game', 'New game', null, true));
      list.push(entry('coop', 'Coop', null, true));
      if (menu.canRestart()) list.push(entry('restart', 'Restart here', null, true));
      if (menu.canQuit) list.push(entry('quit', 'Quit 3DTD', null, true));
      return list;
    }

    const offer = menu.autosaveOffer();
    const head: HomeEntry[] = [];
    if (offer) {
      const line = `${offer.place} · wave ${offer.wave}`;
      head.push(entry('continue', 'Continue', offer.elsewhere ? `in ${line}` : line, false, !offer.elsewhere));
    } else if (menu.hasPlace() && menu.underWay()) {
      head.push(entry('continue', 'Continue', this.runLine(), false, true));
    }
    if (menu.hasPlace() && !menu.underWay()) head.push(entry('play', 'Play', menu.placeName(), false, true));
    // A place in the link: it is what the player came for
    if (menu.linkedPlace) head.reverse();
    // No place yet: choosing one comes first
    if (!menu.hasPlace() && menu.canChangePlace()) head.push(entry('new-game', 'New game'));
    list.push(...head);
    if (menu.hasPlace() && menu.canChangePlace()) list.push(entry('new-game', 'New game'));
    list.push(entry('coop', 'Coop'));
    if (solo && menu.underWay()) list.push(entry('save', 'Save'));
    if (solo) list.push(entry('load', 'Load'));
    list.push(entry('settings', 'Settings'), entry('extras', 'Extras'));
    if (menu.canQuit) list.push(entry('quit', 'Quit 3DTD', null, true));
    return list;
  });

  /** The line under the pause list's logo: "Paused · Heilbronn · wave 12", in coop not paused */
  readonly pauseLine = computed(() => `${this.menu.inCoop() ? 'Coop' : 'Paused'} · ${this.runLine()}`);

  /** Play or Continue waits for the place: the bar shows in the entry */
  showsBar(entry: HomeEntry): boolean {
    return entry.loads && this.menu.placeLoading();
  }

  /** The line under an entry: what it plays, or that it waits */
  subOf(entry: HomeEntry): string | null {
    if (entry.loads && this.menu.pendingPlay()) return 'Starts when loaded';
    if (entry.id === 'continue' && this.busy()) return 'Loading the save';
    return entry.sub;
  }

  activate(entry: HomeEntry): void {
    this.status.set(null);
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
    else this.menu.quit();
  }

  cancelConfirm(): void {
    const kind = this.confirm()?.kind;
    this.confirm.set(null);
    // Back on the entry that asked
    const id: HomeEntryId = kind === 'leave' ? 'continue' : kind ?? 'continue';
    afterNextRender(() => this.focusEntry(id), { injector: this.injector });
  }

  private async loadAutosave(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const result = await this.menu.continueAutosave();
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
        return { question: 'Restart here? The run ends.', yes: 'Restart' };
      case 'quit':
        return { question: 'Quit 3DTD? The run ends.', yes: 'Quit' };
    }
  }
}
