import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { MatDialog } from '@angular/material/dialog';
import { MainMenuService } from './main-menu.service';
import { MENU_PAGE_TITLES, type MenuPage } from './menu-page';
import { MenuHomeComponent } from './pages/home/menu-home.component';
import { MenuNewGameComponent } from './pages/new-game/menu-new-game.component';
import { MenuCoopComponent } from './pages/coop/menu-coop.component';
import { MenuSaveComponent } from './pages/save/menu-save.component';
import { MenuLoadComponent } from './pages/load/menu-load.component';
import { MenuSettingsComponent } from './pages/settings/menu-settings.component';
import { MenuExtrasComponent } from './pages/extras/menu-extras.component';
import { MenuLoadingComponent } from './loading/menu-loading.component';
import { followStartPlaces } from './pages/start-places';
import { FIELD_TIPS } from './loading/field-tips';
import { BUILD_VERSION } from '../../configs/build-info.config';
import { ConfigService } from '../../core/services/config.service';
import { DevWorldService } from '../../devworld/devworld.service';

/** How long a field tip stands before the next, ms */
export const TIP_ROTATE_MS = 8000;

/**
 * The main menu (docs/MAIN_MENU_UI_PLAN.md): one place for everything that
 * is not playing. An overlay in the game's template, not a MatDialog, so its
 * pages reach the game's services. The list stands left under the logo, a
 * page opens as a plate beside it; in the start layer the loading plate of
 * the place behind it stands bottom right, a field tip and the version
 * bottom left.
 *
 * A modal dialog named by the page showing: the focus stays inside
 * (cdkTrapFocus) and goes back where it was when the menu closes. Esc steps
 * back (MainMenuService.back): page, list, and from the list in the game
 * back to the game. A page opened takes the focus; back on the list, the
 * entry that opened it has it again.
 */
@Component({
  selector: 'app-main-menu',
  standalone: true,
  imports: [
    CdkTrapFocus,
    MenuHomeComponent,
    MenuNewGameComponent,
    MenuCoopComponent,
    MenuSaveComponent,
    MenuLoadComponent,
    MenuSettingsComponent,
    MenuExtrasComponent,
    MenuLoadingComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './main-menu.component.html',
  styleUrl: './main-menu.component.scss',
  host: {
    '(document:keydown.escape)': 'onDocumentEscape($event)',
    '(focusout)': 'onFocusOut($event)',
  },
})
export class MainMenuComponent {
  readonly menu = inject(MainMenuService);
  private readonly config = inject(ConfigService);
  private readonly devWorld = inject(DevWorldService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  /** A dialog over the menu (Extras, Settings) keeps its own Esc and focus */
  private readonly dialog = inject(MatDialog);

  readonly layer = this.menu.layer;
  readonly page = this.menu.page;
  readonly title = computed(() => MENU_PAGE_TITLES[this.page()]);

  /**
   * The loading plate: on the start list while the place loads, or a load
   * went wrong. Not over a page, whose plate it would cover at smaller
   * sizes; the bar under Play and Continue goes on showing the load there.
   */
  readonly plateShown = computed(() =>
    this.layer() === 'start' && this.page() === 'home' && (this.menu.placeLoading() || this.menu.problem() !== null));

  readonly version = computed(() => {
    const tiles = this.devWorld.isActive ? 'devworld' : `tiles ${this.config.tileProvider()}`;
    return `${BUILD_VERSION} · ${tiles}`;
  });

  readonly tips = FIELD_TIPS;
  readonly tipIndex = signal(Math.floor(Math.random() * FIELD_TIPS.length));

  constructor() {
    // A start without a place takes the host's place of a coop join or a save's place
    followStartPlaces();
    const timer = setInterval(() => this.tipIndex.update((i) => (i + 1) % this.tips.length), TIP_ROTATE_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));

    // The focus follows the page: into a page opened, back to its entry on the list
    let shown: MenuPage = this.page();
    effect(() => {
      const page = this.page();
      const from = shown;
      shown = page;
      if (page === from) return;
      untracked(() => afterNextRender(() => this.focusFor(page, from), { injector: this.injector }));
    });
  }

  private focusFor(page: MenuPage, from: MenuPage): void {
    if (page === 'home') {
      this.host.querySelector<HTMLElement>(`[data-entry="${from}"]`)?.focus();
      return;
    }
    const body = this.host.querySelector<HTMLElement>('.mm-page-body');
    const first = body?.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
    );
    (first ?? this.host.querySelector<HTMLElement>('.mm-back'))?.focus();
  }

  /** Esc: one step back; on the start list it does nothing, there is no game behind it */
  onEscape(event: Event): void {
    if (this.menu.back()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /**
   * Esc that reached the document from outside the menu: the focus fell to
   * the page (a button disabled while it works), where the game ignores
   * keys while the menu stands. Taken once: not when the menu's own
   * listener had it (it comes from inside), not under a dialog over the menu.
   */
  onDocumentEscape(event: Event): void {
    if (event.defaultPrevented || this.dialog.openDialogs.length > 0) return;
    if (event.target instanceof Node && this.root()?.contains(event.target)) return;
    this.onEscape(event);
    this.focusBack();
  }

  /** The focus left the menu for nowhere (a focused control disabled, removed): back into the menu */
  onFocusOut(event: FocusEvent): void {
    if (event.relatedTarget !== null) return;
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      if (this.dialog.openDialogs.length > 0) return;
      this.focusBack();
    });
  }

  private root(): HTMLElement | null {
    return this.host.querySelector<HTMLElement>('.mm-root');
  }

  /** Into the focus trap again: the menu itself, the next Tab goes to its first control */
  private focusBack(): void {
    const active = document.activeElement;
    if (active && active !== document.body && this.root()?.contains(active)) return;
    this.root()?.focus({ preventScroll: true });
  }
}
