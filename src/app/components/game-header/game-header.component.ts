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
  DestroyRef,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS, TD_THEME } from '../../styles/td-theme';
import { FavoriteLocation } from '../../models/location.types';
import { LOADING_NAME, NO_LOCATION_NAME } from '../../services/location/location-management.service';
import { FAVORITE_NAME_MAX_LENGTH } from '../../services/location/favorite-locations';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { DevWorldService } from '../../devworld/devworld.service';
import { GAME_BALANCE } from '../../configs/game-balance.config';
import { PulseThrottle } from '../../utils/pulse-throttle';
import { TdIconComponent } from '../icon/icon.component';
import { creditsRefusals } from '../../services/credits-refusal';
import {
  COUNT_EXACT_BELOW,
  CREDITS_COUNT_MS,
  CREDITS_DELTA_SHOW_MS,
  CREDITS_EXACT_BELOW,
  CreditsDelta,
  CreditsDeltaTracker,
  HQ_SEGMENTS,
  countedValue,
  hqLevel,
  hqReadout,
  hqSegmentsLit,
  statReadout,
  waveProgressPercent,
} from './header-stats';

/** Flash of the HQ plate when the HQ loses health; the jolt only without reduced motion */
const HQ_HIT_FLASH: Keyframe[] = [{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }];
const HQ_HIT_JOLT: Keyframe[] = [
  { transform: 'translateX(0)' },
  { transform: 'translateX(-2px)', offset: 0.2 },
  { transform: 'translateX(2px)', offset: 0.45 },
  { transform: 'translateX(-1px)', offset: 0.7 },
  { transform: 'translateX(0)' },
];
const HQ_HIT_MS = 450;
/** Several leaks in a row flash once, not in a flicker */
const HQ_HIT_MIN_INTERVAL_MS = 300;
/** The credits plate's edge when a buy was refused for too few credits: red, then back */
const CREDITS_REFUSED_FLASH: Keyframe[] = [
  { backgroundColor: TD_THEME.healthRed },
  { backgroundColor: TD_THEME.healthRed, offset: 0.5 },
  { backgroundColor: TD_THEME.lineSteel },
];
const CREDITS_REFUSED_MS = 600;
/** The wave plate's brass edge when a wave starts */
const WAVE_START_EDGE_MS = 600;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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

  /** Esc closes the spawn menu or the favorites, before the Esc chain of the game gets the key */
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (this.spawnMenuOpen()) {
      this.spawnMenuOpen.set(false);
    } else if (this.favMenuExpanded()) {
      this.closeFavMenu();
    } else {
      return;
    }
    event.preventDefault();
  }

  // Close favorites menu when clicking outside. The path is taken at dispatch:
  // a button in the menu that a click swaps for the name field still counts
  // as inside.
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const spawnWrapper = this.elementRef.nativeElement.querySelector('.spawn-wrapper');
    if (this.spawnMenuOpen() && spawnWrapper && !event.composedPath().includes(spawnWrapper)) this.spawnMenuOpen.set(false);
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
  /** Enemies the running wave brings, 0 = not announced; with waveEnemiesLeft the wave plate's bar */
  readonly waveEnemyTotal = input(0);
  readonly waveEnemiesLeft = input(0);
  readonly isDialog = input<boolean>(false);
  readonly favorites = input<FavoriteLocation[]>([]);
  /** Geocoded names of the favorites without a name of their own */
  readonly favoriteNames = input<Record<string, string>>({});
  readonly placementMode = input<'hq' | 'spawn' | null>(null);
  readonly canPlace = input<boolean>(true);
  /** Coop: the map belongs to the room, no other place (UIStore.coopMapLocked) */
  readonly locationLocked = input<boolean>(false);

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
  /** Spawn placement: the index of the one spawn to move, null for one spawn in place of all */
  readonly placeSpawnClick = output<number | null>();
  /** Place one more spawn, in addition to the ones there */
  readonly addSpawnClick = output<void>();
  /** How many spawns stand; with more than one the flag asks which to move */
  readonly spawnCount = input(1);
  readonly spawnMenuOpen = signal(false);
  readonly spawnIndexes = computed(() => Array.from({ length: this.spawnCount() }, (_, i) => i));
  /** Coop: the room while in one (code, a lane colour per player or null without a lane, seats), null otherwise */
  readonly coopChip = input<{ code: string; colors: (string | null)[]; max: number } | null>(null);
  readonly coopClick = output<void>();

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

  /**
   * The credits figure on the plate: counts to a new value over
   * CREDITS_COUNT_MS (at once with reduced motion); null before the first
   * change. Screen readers and the tooltip get the real value.
   */
  readonly creditsShown = signal<number | null>(null);

  // Figures of the stat plates and the enemies chip, short enough for their plates
  readonly hq = computed(() => hqReadout(this.baseHealth(), this.maxHealth));
  readonly hqLevel = computed(() => hqLevel(this.hq().percent));
  /** One flag per segment of the HQ bar, lit or not */
  readonly hqSegments = computed(() => {
    const lit = hqSegmentsLit(this.hq().percent);
    return Array.from({ length: HQ_SEGMENTS }, (_, i) => i < lit);
  });
  readonly creditsStat = computed(() => statReadout(this.credits(), CREDITS_EXACT_BELOW));
  readonly creditsShownText = computed(() =>
    statReadout(this.creditsShown() ?? this.credits(), CREDITS_EXACT_BELOW).text,
  );
  readonly waveStat = computed(() => statReadout(this.waveNumber(), COUNT_EXACT_BELOW));
  readonly waveProgress = computed(() =>
    waveProgressPercent(this.waveActive(), this.waveEnemyTotal(), this.waveEnemiesLeft()),
  );
  readonly enemiesStat = computed(() => statReadout(this.enemiesAlive(), COUNT_EXACT_BELOW));

  /** "+25" / "-150" over the credits plate, null when none shows */
  readonly creditsDelta = signal<CreditsDelta | null>(null);
  /** The wave plate's brass edge, for WAVE_START_EDGE_MS after a wave starts */
  readonly waveStarting = signal(false);

  private readonly hqPlate = viewChild<ElementRef<HTMLElement>>('hqPlate');
  private readonly creditsPlate = viewChild<ElementRef<HTMLElement>>('creditsPlate');
  private readonly hqPulse = new PulseThrottle(HQ_HIT_MIN_INTERVAL_MS);
  private lastHealth: number | null = null;
  private lastCredits: number | null = null;
  private lastRefusals = creditsRefusals();
  private lastWaveActive: boolean | null = null;
  private readonly deltas = new CreditsDeltaTracker();
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  private waveTimer: ReturnType<typeof setTimeout> | null = null;
  private countFrame: number | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.deltaTimer !== null) clearTimeout(this.deltaTimer);
      if (this.waveTimer !== null) clearTimeout(this.waveTimer);
      if (this.countFrame !== null) cancelAnimationFrame(this.countFrame);
    });

    // Flash the HQ plate (and jolt it) when the HQ loses health; a reset or the cheat raises it quietly
    effect(() => {
      const health = this.baseHealth();
      const previous = this.lastHealth;
      this.lastHealth = health;
      if (previous === null || health >= previous) return;
      const plate = this.hqPlate()?.nativeElement;
      if (!plate || typeof plate.animate !== 'function') return;
      if (!this.hqPulse.tryPulse(performance.now())) return;
      plate.animate(HQ_HIT_FLASH, { duration: HQ_HIT_MS, easing: 'ease-out' });
      if (!prefersReducedMotion()) plate.animate(HQ_HIT_JOLT, { duration: HQ_HIT_MS * 0.7, easing: 'ease-out' });
    });

    // Credits: the change rises over the plate and the figure counts to the new value
    effect(() => {
      const credits = this.credits();
      const previous = this.lastCredits;
      this.lastCredits = credits;
      if (previous === null || credits === previous) return;
      untracked(() => {
        this.showDelta(credits - previous);
        this.countCredits(this.creditsShown() ?? previous, credits);
      });
    });

    // A buy refused for too few credits flashes the plate's edge red
    effect(() => {
      const refusals = creditsRefusals();
      if (refusals === this.lastRefusals) return;
      this.lastRefusals = refusals;
      const plate = this.creditsPlate()?.nativeElement;
      if (plate && typeof plate.animate === 'function') {
        plate.animate(CREDITS_REFUSED_FLASH, { duration: CREDITS_REFUSED_MS, easing: 'ease-out' });
      }
    });

    // A wave that starts gives the wave plate a brass edge for a moment
    effect(() => {
      const active = this.waveActive();
      const previous = this.lastWaveActive;
      this.lastWaveActive = active;
      if (previous !== false || !active) return;
      untracked(() => {
        if (this.waveTimer !== null) clearTimeout(this.waveTimer);
        this.waveStarting.set(true);
        this.waveTimer = setTimeout(() => {
          this.waveTimer = null;
          this.waveStarting.set(false);
        }, WAVE_START_EDGE_MS);
      });
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

  private showDelta(diff: number): void {
    this.creditsDelta.set(this.deltas.change(diff, performance.now()));
    if (this.deltaTimer !== null) clearTimeout(this.deltaTimer);
    this.deltaTimer = setTimeout(() => {
      this.deltaTimer = null;
      this.creditsDelta.set(null);
    }, CREDITS_DELTA_SHOW_MS);
  }

  /** Count the figure from `from` to `to`; with reduced motion, or without frames, it jumps */
  private countCredits(from: number, to: number): void {
    if (this.countFrame !== null) cancelAnimationFrame(this.countFrame);
    this.countFrame = null;
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      this.creditsShown.set(to);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const value = countedValue(from, to, now - start, CREDITS_COUNT_MS);
      this.creditsShown.set(value);
      this.countFrame = value === to ? null : requestAnimationFrame(step);
    };
    this.countFrame = requestAnimationFrame(step);
  }

  /** The flag: one spawn places at once, with several a menu asks which one to move */
  onSpawnFlag(): void {
    if (this.spawnCount() > 1) this.spawnMenuOpen.update((open) => !open);
    else this.placeSpawnClick.emit(null);
  }

  pickSpawn(index: number | null): void {
    this.spawnMenuOpen.set(false);
    this.placeSpawnClick.emit(index);
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
