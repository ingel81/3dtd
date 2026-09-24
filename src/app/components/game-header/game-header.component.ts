import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  afterRenderEffect,
  viewChild,
  HostListener,
  ElementRef,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { FavoriteLocation } from '../../models/location.types';
import { LOADING_NAME, NO_LOCATION_NAME } from '../../services/location/location-management.service';
import { FAVORITE_NAME_MAX_LENGTH } from '../../services/location/favorite-locations';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { DevWorldService } from '../../devworld/devworld.service';
import { GAME_BALANCE } from '../../configs/game-balance.config';
import { PulseThrottle } from '../../utils/pulse-throttle';
import { TdIconComponent } from '../icon/icon.component';
import { COUNT_EXACT_BELOW, CREDITS_EXACT_BELOW, hqReadout, statReadout } from './header-stats';

/** Flash of the HQ bar when the HQ loses health */
const HQ_BAR_PULSE: Keyframe[] = [
  { filter: 'brightness(2)', boxShadow: '0 0 6px 1px rgba(184, 62, 50, 0.9)' },
  { filter: 'brightness(1)', boxShadow: '0 0 0 0 rgba(184, 62, 50, 0)' },
];
const HQ_BAR_PULSE_MS = 450;
/** Several leaks in a row flash once, not in a flicker */
const HQ_BAR_PULSE_MIN_INTERVAL_MS = 300;

@Component({
  selector: 'app-game-header',
  standalone: true,
  imports: [CommonModule, MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './game-header.component.html',
  styleUrl: './game-header.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class GameHeaderComponent {
  private readonly elementRef = inject(ElementRef);
  private readonly store = inject(TowerDefenseStore);

  /** True when the app runs in DevWorld mode (URL `?devworld`). Used to gate
   *  the headless-rendering toggle, which is a training-only debug control. */
  readonly isDevWorld = inject(DevWorldService).isActive;
  /** Phase 5.14: headless rendering toggle (readable for template binding). */
  readonly renderingEnabled = this.store.renderingEnabled;

  toggleRendering(): void {
    this.store.renderingEnabled.update((v) => !v);
  }

  // Close favorites menu when clicking outside. The path is taken at dispatch:
  // a button in the menu that a click swaps for the name field still counts
  // as inside.
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.favMenuExpanded()) return;

    const favWrapper = this.elementRef.nativeElement.querySelector('.fav-wrapper');

    if (favWrapper && !event.composedPath().includes(favWrapper)) {
      this.closeFavMenu();
    }
  }

  // Inputs
  readonly locationName = input.required<string>();
  readonly baseHealth = input.required<number>();
  readonly credits = input.required<number>();
  readonly waveNumber = input.required<number>();
  readonly enemiesAlive = input.required<number>();
  readonly waveActive = input.required<boolean>();
  readonly isDialog = input<boolean>(false);
  readonly favorites = input<FavoriteLocation[]>([]);
  /** Geocoded names of the favorites without a name of their own */
  readonly favoriteNames = input<Record<string, string>>({});
  readonly placementMode = input<'hq' | 'spawn' | null>(null);
  readonly canPlace = input<boolean>(true);

  // Outputs
  readonly locationClick = output<void>();
  readonly closeClick = output<void>();
  readonly shareClick = output<void>();
  readonly diceClick = output<void>();
  /** Save the current location, with the name from the field (may be empty) */
  readonly addFavoriteClick = output<string>();
  readonly renameFavoriteClick = output<{ id: string; name: string }>();
  /** Move a favorite up (-1) or down (1) */
  readonly moveFavoriteClick = output<{ id: string; offset: number }>();
  readonly selectFavoriteClick = output<FavoriteLocation>();
  readonly deleteFavoriteClick = output<string>();
  readonly placeHqClick = output<void>();
  readonly placeSpawnClick = output<void>();
  /** Place one more spawn, in addition to the ones there */
  readonly addSpawnClick = output<void>();

  // Internal state
  readonly favMenuExpanded = signal(false);
  readonly shareConfirmed = signal(false);

  /**
   * The favorite whose name is being edited, 'new' while the current
   * location is being saved; null when no name field is open. One at a time.
   */
  readonly favEditing = signal<string | null>(null);
  /** What the name field starts with */
  readonly favDraftName = signal('');
  readonly favNameMaxLength = FAVORITE_NAME_MAX_LENGTH;
  private readonly favInput = viewChild<ElementRef<HTMLInputElement>>('favInput');

  /** HQ health at the start of a run. Nothing heals in play; the +HP cheat can go past it. */
  private readonly maxHealth = GAME_BALANCE.player.startHealth;

  // Figures of the stat bar and the enemies chip, short enough for their cells
  readonly hq = computed(() => hqReadout(this.baseHealth(), this.maxHealth));
  readonly creditsStat = computed(() => statReadout(this.credits(), CREDITS_EXACT_BELOW));
  readonly waveStat = computed(() => statReadout(this.waveNumber(), COUNT_EXACT_BELOW));
  readonly enemiesStat = computed(() => statReadout(this.enemiesAlive(), COUNT_EXACT_BELOW));

  private readonly hpBar = viewChild<ElementRef<HTMLElement>>('hpBar');
  private readonly hpPulse = new PulseThrottle(HQ_BAR_PULSE_MIN_INTERVAL_MS);
  private lastHealth: number | null = null;

  constructor() {
    // Flash the HQ bar when the HQ loses health; a reset or the cheat raises it quietly
    effect(() => {
      const health = this.baseHealth();
      const previous = this.lastHealth;
      this.lastHealth = health;
      if (previous === null || health >= previous) return;
      const bar = this.hpBar()?.nativeElement;
      if (!bar || typeof bar.animate !== 'function') return;
      if (this.hpPulse.tryPulse(performance.now())) {
        bar.animate(HQ_BAR_PULSE, { duration: HQ_BAR_PULSE_MS, easing: 'ease-out' });
      }
    });

    // A name field that opens takes the focus with its text selected, so
    // typing replaces the suggestion and Enter keeps it
    afterRenderEffect(() => {
      const field = this.favInput()?.nativeElement;
      if (!field) return;
      field.focus();
      field.select();
    });
  }

  /**
   * Toggle favorites menu
   */
  toggleFavMenu(): void {
    if (this.favMenuExpanded()) this.closeFavMenu();
    else this.favMenuExpanded.set(true);
  }

  /** Close the menu; a name field left open is dropped */
  private closeFavMenu(): void {
    this.favMenuExpanded.set(false);
    this.favEditing.set(null);
  }

  /** Name shown for a favorite: its own, else the geocoded one */
  favoriteName(fav: FavoriteLocation): string {
    return fav.name || this.favoriteNames()[fav.id] || 'Loading...';
  }

  /** Open the name field for the current location, prefilled with the header's name */
  startAddFavorite(): void {
    const name = this.locationName();
    this.favDraftName.set(name === NO_LOCATION_NAME || name === LOADING_NAME ? '' : name);
    this.favEditing.set('new');
  }

  /** Open the name field for a favorite, prefilled with the name it shows */
  startRenameFavorite(fav: FavoriteLocation): void {
    this.favDraftName.set(fav.name || this.favoriteNames()[fav.id] || '');
    this.favEditing.set(fav.id);
  }

  /** Save what the name field holds (Enter or the check button) */
  commitFavoriteName(): void {
    const editing = this.favEditing();
    if (editing === null) return;
    const name = this.favInput()?.nativeElement.value ?? this.favDraftName();
    if (editing === 'new') this.addFavoriteClick.emit(name);
    else this.renameFavoriteClick.emit({ id: editing, name });
    this.favEditing.set(null);
  }

  /** Close the name field without saving (Esc or the cross); Esc goes no further */
  cancelFavoriteName(event?: Event): void {
    event?.stopPropagation();
    this.favEditing.set(null);
  }

  /** Move a favorite one place up (-1) or down (1) */
  onMoveFavorite(id: string, offset: number): void {
    this.moveFavoriteClick.emit({ id, offset });
  }

  /**
   * Handle share button click
   */
  onShare(): void {
    this.shareClick.emit();
    // Show checkmark briefly
    this.shareConfirmed.set(true);
    setTimeout(() => this.shareConfirmed.set(false), 1500);
  }

  /**
   * Handle favorite selection
   */
  onSelectFavorite(fav: FavoriteLocation): void {
    this.selectFavoriteClick.emit(fav);
    this.closeFavMenu();
  }

  /**
   * Handle favorite deletion
   */
  onDeleteFavorite(id: string, event: Event): void {
    event.stopPropagation();
    this.deleteFavoriteClick.emit(id);
  }
}
