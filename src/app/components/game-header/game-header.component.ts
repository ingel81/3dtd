import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
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

  // Close favorites menu when clicking outside
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.favMenuExpanded()) return;

    const target = event.target as HTMLElement;
    const favWrapper = this.elementRef.nativeElement.querySelector('.fav-wrapper');

    if (favWrapper && !favWrapper.contains(target)) {
      this.favMenuExpanded.set(false);
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
  readonly favoriteNames = input<Record<string, string>>({});
  readonly canAddFavorite = input<boolean>(true);
  readonly placementMode = input<'hq' | 'spawn' | null>(null);
  readonly canPlace = input<boolean>(true);

  // Outputs
  readonly locationClick = output<void>();
  readonly closeClick = output<void>();
  readonly shareClick = output<void>();
  readonly diceClick = output<void>();
  readonly addFavoriteClick = output<void>();
  readonly selectFavoriteClick = output<FavoriteLocation>();
  readonly deleteFavoriteClick = output<string>();
  readonly placeHqClick = output<void>();
  readonly placeSpawnClick = output<void>();

  // Internal state
  readonly favMenuExpanded = signal(false);
  readonly shareConfirmed = signal(false);

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
  }

  /**
   * Toggle favorites menu
   */
  toggleFavMenu(): void {
    this.favMenuExpanded.update((v) => !v);
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
   * Handle add favorite click
   */
  onAddFavorite(): void {
    this.addFavoriteClick.emit();
    this.favMenuExpanded.set(false);
  }

  /**
   * Handle favorite selection
   */
  onSelectFavorite(fav: FavoriteLocation): void {
    this.selectFavoriteClick.emit(fav);
    this.favMenuExpanded.set(false);
  }

  /**
   * Handle favorite deletion
   */
  onDeleteFavorite(id: string, event: Event): void {
    event.stopPropagation();
    this.deleteFavoriteClick.emit(id);
  }
}
