import { Component, input, output, signal, HostListener, ElementRef, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { FavoriteLocation } from '../../models/location.types';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { DevWorldService } from '../../devworld/devworld.service';
import { TdIconComponent } from '../icon/icon.component';

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
