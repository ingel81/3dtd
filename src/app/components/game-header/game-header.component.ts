import { Component, input, output, signal, HostListener, ElementRef, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { FavoriteLocation } from '../../models/location.types';

@Component({
  selector: 'app-game-header',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="header">
      <div class="header-left">
        <mat-icon class="title-icon">cell_tower</mat-icon>
        <h2 class="title">3DTD</h2>
        <button class="location-btn" (click)="locationClick.emit()" matTooltip="Spielort ändern">
          <span class="location-name">{{ locationName() }}</span>
          <mat-icon class="location-edit">edit</mat-icon>
        </button>

        <!-- Location Actions -->
        <div class="location-actions">
          <!-- Share Button -->
          <button class="action-btn" (click)="onShare()" matTooltip="Link kopieren">
            <mat-icon>{{ shareConfirmed() ? 'check' : 'link' }}</mat-icon>
          </button>

          <!-- Favorites Dropdown -->
          <div class="fav-wrapper">
            <button class="action-btn" [class.active]="favMenuExpanded()"
                    (click)="toggleFavMenu()" matTooltip="Favoriten">
              <mat-icon>star</mat-icon>
            </button>
            <div class="fav-dropdown" [class.expanded]="favMenuExpanded()">
              @if (canAddFavorite()) {
                <button class="fav-item fav-add" (click)="onAddFavorite()">
                  <mat-icon>add</mat-icon>
                  <span>Ort speichern</span>
                </button>
              }
              @for (fav of favorites(); track fav.id) {
                <div class="fav-item">
                  <button class="fav-select" (click)="onSelectFavorite(fav)">
                    <span class="fav-name">{{ favoriteNames()[fav.id] || 'Laden...' }}</span>
                    <span class="fav-coords">{{ fav.hq.lat.toFixed(4) }}, {{ fav.hq.lon.toFixed(4) }}</span>
                  </button>
                  <button class="fav-delete" (click)="onDeleteFavorite(fav.id, $event)" matTooltip="Löschen">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              } @empty {
                @if (!canAddFavorite()) {
                  <div class="fav-empty">Max. Favoriten erreicht</div>
                } @else {
                  <div class="fav-empty">Keine Favoriten</div>
                }
              }
            </div>
          </div>

          <!-- Home Button -->
          <button class="action-btn" (click)="homeClick.emit()" matTooltip="Erlenbach (Default)">
            <mat-icon>home</mat-icon>
          </button>
        </div>
      </div>
      <div class="header-stats">
        <div class="stat hp">
          <mat-icon>favorite</mat-icon>
          <span>{{ baseHealth() }}</span>
        </div>
        <div class="stat credits">
          <mat-icon>paid</mat-icon>
          <span>{{ credits() }}</span>
        </div>
        <div class="stat wave">
          <mat-icon>waves</mat-icon>
          <span>{{ waveNumber() }}</span>
        </div>
        @if (waveActive()) {
          <div class="stat enemies">
            <mat-icon>pest_control</mat-icon>
            <span>{{ enemiesAlive() }}</span>
          </div>
        }
      </div>
      @if (isDialog()) {
        <button class="close-btn" (click)="closeClick.emit()" matTooltip="Schliessen">
          <mat-icon>close</mat-icon>
        </button>
      }
    </header>
  `,
  styles: `
    :host {
      display: block;
      ${TD_CSS_VARS}
    }

    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 12px;
      background:
        linear-gradient(rgba(15, 19, 15, 0.8), rgba(15, 19, 15, 0.8)),
        url('/assets/images/425.jpg') repeat;
      background-size: auto, 64px 64px;
      border-bottom: 3px solid var(--td-panel-shadow);
      border-top: 1px solid var(--td-frame-light);
      box-shadow:
        0 4px 8px rgba(0, 0, 0, 0.5),
        0 2px 4px rgba(0, 0, 0, 0.3),
        inset 0 -2px 4px rgba(0, 0, 0, 0.3);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--td-panel-shadow);
      padding: 4px 10px;
      border: 1px solid var(--td-frame-dark);
      border-top-color: var(--td-frame-mid);
    }

    .title-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--td-gold);
    }

    .title {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      color: var(--td-gold);
      text-transform: uppercase;
    }

    .location-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      margin-left: 8px;
      background: transparent;
      border: 1px solid transparent;
      border-left: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s ease;
      border-radius: 0 3px 3px 0;
      font-family: inherit;
      font-size: 10px;
    }

    .location-btn:hover {
      border-color: var(--td-gold-dark);
      background: rgba(255, 215, 0, 0.1);
      color: var(--td-gold);
    }

    .location-name {
      font-weight: 500;
    }

    .location-edit {
      font-size: 12px;
      width: 12px;
      height: 12px;
      opacity: 0.5;
    }

    .location-btn:hover .location-edit {
      opacity: 1;
    }

    .header-stats {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      margin-right: 8px;
    }

    .stat {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 600;
      background: var(--td-panel-shadow);
      padding: 4px 10px;
      min-width: 50px;
      border: 1px solid var(--td-frame-dark);
      border-top-color: var(--td-frame-mid);
    }

    .stat mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .stat.hp { color: var(--td-health-red); }
    .stat.credits { color: var(--td-gold); }
    .stat.wave { color: var(--td-teal); }
    .stat.enemies { color: var(--td-warn-orange); }

    .close-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }

    .close-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .close-btn:hover {
      background: var(--td-health-red);
      color: var(--td-text-primary);
    }

    /* Location Actions */
    .location-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      margin-left: 4px;
      border-left: 1px solid var(--td-frame-mid);
      padding-left: 4px;
    }

    .action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      background: transparent;
      border: 1px solid transparent;
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .action-btn:hover, .action-btn.active {
      background: rgba(255, 215, 0, 0.1);
      border-color: var(--td-gold-dark);
      color: var(--td-gold);
    }

    .action-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .fav-wrapper {
      position: relative;
    }

    .fav-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 4px;
      min-width: 200px;
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      opacity: 0;
      visibility: hidden;
      transform: translateY(-4px);
      transition: all 0.15s ease;
      z-index: 100;
    }

    .fav-dropdown.expanded {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }

    .fav-item {
      display: flex;
      align-items: center;
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .fav-item:last-child {
      border-bottom: none;
    }

    .fav-select {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      padding: 8px 10px;
      background: transparent;
      border: none;
      color: var(--td-text-secondary);
      cursor: pointer;
      font-family: inherit;
      text-align: left;
    }

    .fav-select:hover {
      background: rgba(255, 215, 0, 0.1);
      color: var(--td-gold);
    }

    .fav-name {
      font-size: 11px;
      font-weight: 500;
    }

    .fav-coords {
      font-size: 9px;
      opacity: 0.6;
    }

    .fav-delete {
      padding: 8px;
      background: transparent;
      border: none;
      color: var(--td-text-secondary);
      cursor: pointer;
      opacity: 0.5;
    }

    .fav-delete:hover {
      color: var(--td-health-red);
      opacity: 1;
    }

    .fav-delete mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .fav-add, .fav-empty {
      padding: 8px 10px;
      font-size: 10px;
      color: var(--td-text-secondary);
    }

    .fav-add {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      background: transparent;
      border: none;
      border-bottom: 1px solid var(--td-frame-dark);
      cursor: pointer;
      font-family: inherit;
    }

    .fav-add:hover {
      background: rgba(255, 215, 0, 0.1);
      color: var(--td-gold);
    }

    .fav-add mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
  `,
})
export class GameHeaderComponent {
  private readonly elementRef = inject(ElementRef);

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

  // Outputs
  readonly locationClick = output<void>();
  readonly closeClick = output<void>();
  readonly shareClick = output<void>();
  readonly homeClick = output<void>();
  readonly addFavoriteClick = output<void>();
  readonly selectFavoriteClick = output<FavoriteLocation>();
  readonly deleteFavoriteClick = output<string>();

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
