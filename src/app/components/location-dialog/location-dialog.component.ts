import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AddressAutocompleteComponent } from '../address-autocomplete.component';
import { GeocodingService, NominatimAddress } from '../../services/geocoding.service';
import {
  LocationDialogData,
  LocationDialogResult,
  LocationInfo,
  SpawnLocationConfig,
} from '../../models/location.types';
import { TD_CSS_VARS } from '../../styles/td-theme';

type SpawnMode = 'random' | 'manual';

@Component({
  selector: 'app-td-location-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatRadioModule,
    MatProgressSpinnerModule,
    AddressAutocompleteComponent,
  ],
  template: `
    <div class="location-dialog">
      <!-- Header -->
      <div class="dialog-header">
        <mat-icon class="header-icon">edit_location</mat-icon>
        <h2>Spielort ändern</h2>
      </div>

      <!-- Content -->
      <div class="dialog-content">
        <!-- Current location info -->
        @if (data.currentLocation) {
          <div class="current-location">
            <span class="label">Aktueller Ort</span>
            <div class="location-display">
              <mat-icon>place</mat-icon>
              <span>{{ data.currentLocation.name }}</span>
            </div>
          </div>
        }

        <!-- Warning box -->
        @if (data.isGameInProgress) {
          <div class="warning-box">
            <mat-icon>warning</mat-icon>
            <div class="warning-text">
              <strong>Achtung!</strong>
              <p>Das aktuelle Spiel wird beendet. Alle Türme werden ohne Rückerstattung gelöscht.</p>
            </div>
          </div>
        }

        <!-- New HQ Location -->
        <div class="section">
          <span class="section-label">Neuer Ort (HQ)</span>
          <app-td-address-autocomplete
            [placeholder]="'Adresse oder Ort suchen...'"
            [currentValue]="selectedHQ()"
            (locationSelected)="onHQSelected($event)"
            (locationCleared)="onHQCleared()"
          />
        </div>

        <!-- Expandable coordinates section -->
        <div class="section expandable">
          <button class="expand-header" (click)="toggleCoordinates()">
            <mat-icon>{{ showCoordinates() ? 'expand_less' : 'expand_more' }}</mat-icon>
            <span>Erweitert: Koordinaten</span>
          </button>
          @if (showCoordinates()) {
            <div class="coords-input">
              <div class="coord-field">
                <label>Lat</label>
                <input
                  type="number"
                  step="0.0001"
                  [value]="coordLat()"
                  (input)="onCoordLatChange($event)"
                  placeholder="z.B. 49.5432"
                />
              </div>
              <div class="coord-field">
                <label>Lon</label>
                <input
                  type="number"
                  step="0.0001"
                  [value]="coordLon()"
                  (input)="onCoordLonChange($event)"
                  placeholder="z.B. 9.1234"
                />
              </div>
              <button
                class="apply-coords-btn"
                [disabled]="!canApplyCoords()"
                (click)="applyCoordinates()"
              >
                @if (isLoadingCoords()) {
                  <mat-spinner diameter="14"></mat-spinner>
                } @else {
                  <mat-icon>check</mat-icon>
                }
              </button>
            </div>
          }
        </div>

        <!-- Spawn Point Section -->
        <div class="section">
          <span class="section-label">Spawn-Punkt (Gegner-Start)</span>
          <div class="spawn-options">
            <label class="radio-option" [class.selected]="spawnMode() === 'random'">
              <input
                type="radio"
                name="spawnMode"
                value="random"
                [checked]="spawnMode() === 'random'"
                (change)="setSpawnMode('random')"
              />
              <div class="radio-content">
                <span class="radio-label">Zufällig generieren</span>
                <span class="radio-desc">500m-1km vom HQ, auf einer Straße</span>
              </div>
            </label>
            <label class="radio-option" [class.selected]="spawnMode() === 'manual'">
              <input
                type="radio"
                name="spawnMode"
                value="manual"
                [checked]="spawnMode() === 'manual'"
                (change)="setSpawnMode('manual')"
              />
              <div class="radio-content">
                <span class="radio-label">Manuell festlegen</span>
              </div>
            </label>
          </div>

          @if (spawnMode() === 'manual') {
            <div class="manual-spawn-input">
              <app-td-address-autocomplete
                [placeholder]="'Spawn-Punkt suchen...'"
                [currentValue]="selectedSpawn()"
                (locationSelected)="onSpawnSelected($event)"
                (locationCleared)="onSpawnCleared()"
              />
            </div>
          }
        </div>
      </div>

      <!-- Actions -->
      <div class="dialog-actions">
        <button class="cancel-btn" (click)="cancel()">Abbrechen</button>
        <button class="confirm-btn" [disabled]="!canConfirm()" (click)="confirm()">
          <mat-icon>check</mat-icon>
          Ort wechseln
        </button>
      </div>
    </div>
  `,
  styles: `
    :host {
      ${TD_CSS_VARS}
    }

    .location-dialog {
      width: 400px;
      max-width: 90vw;
      background: var(--td-bg-dark);
      border-top: 1px solid var(--td-frame-light);
      border-left: 1px solid var(--td-frame-mid);
      border-right: 1px solid var(--td-frame-dark);
      border-bottom: 2px solid var(--td-frame-dark);
      color: var(--td-text-primary);
      font-family: 'JetBrains Mono', monospace;
    }

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      background: var(--td-panel-main);
      border-bottom: 2px solid var(--td-frame-dark);
      border-top: 1px solid var(--td-frame-light);
    }

    .header-icon {
      color: var(--td-gold);
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--td-gold);
    }

    .dialog-content {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .current-location {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .label,
    .section-label {
      font-size: 10px;
      color: var(--td-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .location-display {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-dark);
      border-left-color: var(--td-frame-dark);
      font-size: 11px;
    }

    .location-display mat-icon {
      color: var(--td-teal);
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .warning-box {
      display: flex;
      gap: 10px;
      padding: 10px 12px;
      background: var(--td-health-bg);
      border: 1px solid var(--td-warn-orange);
      border-top-color: rgba(201, 106, 58, 0.6);
      border-bottom-width: 2px;
    }

    .warning-box mat-icon {
      color: var(--td-warn-orange);
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }

    .warning-text {
      font-size: 11px;
      line-height: 1.4;
    }

    .warning-text strong {
      color: var(--td-warn-orange);
    }

    .warning-text p {
      margin: 4px 0 0;
      color: var(--td-text-secondary);
    }

    .section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .expandable .expand-header {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 0;
      background: transparent;
      border: none;
      color: var(--td-text-muted);
      font-size: 10px;
      font-family: 'JetBrains Mono', monospace;
      cursor: pointer;
      transition: color 0.15s ease;
    }

    .expand-header:hover {
      color: var(--td-text-secondary);
    }

    .expand-header mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .coords-input {
      display: flex;
      gap: 8px;
      padding: 8px;
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-dark);
    }

    .coord-field {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .coord-field label {
      font-size: 9px;
      color: var(--td-text-muted);
      text-transform: uppercase;
    }

    .coord-field input {
      width: 100%;
      padding: 6px 8px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-dark);
      color: var(--td-text-primary);
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
    }

    .coord-field input:focus {
      outline: none;
      border-color: var(--td-gold);
    }

    .apply-coords-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      margin-top: auto;
      background: var(--td-gold);
      border: none;
      border-top: 1px solid var(--td-edge-highlight);
      border-bottom: 2px solid var(--td-gold-dark);
      color: var(--td-bg-dark);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .apply-coords-btn:hover:not(:disabled) {
      background: #D4B05A;
      transform: translateY(-1px);
    }

    .apply-coords-btn:active:not(:disabled) {
      background: var(--td-gold-dark);
      transform: translateY(1px);
    }

    .apply-coords-btn:disabled {
      background: var(--td-disabled);
      color: var(--td-text-disabled);
      cursor: not-allowed;
      border-color: var(--td-frame-dark);
    }

    .apply-coords-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .spawn-options {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .radio-option {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 12px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-dark);
      border-left-color: var(--td-frame-dark);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .radio-option:hover {
      border-color: var(--td-frame-light);
      background: var(--td-panel-main);
    }

    .radio-option.selected {
      border-color: var(--td-gold);
      background: rgba(201, 164, 76, 0.1);
      box-shadow: inset 0 0 8px rgba(201, 164, 76, 0.15);
    }

    .radio-option input[type='radio'] {
      margin-top: 2px;
      accent-color: var(--td-gold);
    }

    .radio-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .radio-label {
      font-size: 11px;
      font-weight: 500;
      color: var(--td-text-primary);
    }

    .radio-desc {
      font-size: 9px;
      color: var(--td-text-muted);
    }

    .manual-spawn-input {
      margin-top: 8px;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 12px 16px;
      background: var(--td-panel-main);
      border-top: 1px solid var(--td-frame-light);
    }

    .cancel-btn,
    .confirm-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      font-size: 11px;
      font-weight: 500;
      font-family: 'JetBrains Mono', monospace;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .cancel-btn {
      background: transparent;
      color: var(--td-text-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom: 2px solid var(--td-frame-dark);
    }

    .cancel-btn:hover {
      background: var(--td-panel-secondary);
      color: var(--td-text-primary);
    }

    .confirm-btn {
      background: var(--td-gold);
      color: var(--td-bg-dark);
      border: none;
      border-top: 1px solid var(--td-edge-highlight);
      border-bottom: 2px solid var(--td-gold-dark);
    }

    .confirm-btn:hover:not(:disabled) {
      background: #D4B05A;
      transform: translateY(-1px);
    }

    .confirm-btn:active:not(:disabled) {
      background: var(--td-gold-dark);
      transform: translateY(1px);
    }

    .confirm-btn:disabled {
      background: var(--td-disabled);
      color: var(--td-text-disabled);
      cursor: not-allowed;
      border-color: var(--td-frame-dark);
    }

    .confirm-btn mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }
  `,
})
export class LocationDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<LocationDialogComponent>);
  private readonly geocodingService = inject(GeocodingService);
  readonly data: LocationDialogData = inject(MAT_DIALOG_DATA);

  // State
  readonly selectedHQ = signal<{ lat: number; lon: number; name?: string; address?: NominatimAddress } | null>(null);
  readonly selectedSpawn = signal<{ lat: number; lon: number; name?: string } | null>(null);
  readonly spawnMode = signal<SpawnMode>('random');
  readonly showCoordinates = signal(false);
  readonly isLoadingCoords = signal(false);

  // Coordinate inputs as signals for reactivity
  readonly coordLat = signal<number | null>(null);
  readonly coordLon = signal<number | null>(null);

  // Computed
  readonly canApplyCoords = computed(() => {
    const lat = this.coordLat();
    const lon = this.coordLon();
    return (
      lat !== null &&
      lon !== null &&
      !isNaN(lat) &&
      !isNaN(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180
    );
  });

  readonly canConfirm = computed(() => {
    const hasHQ = this.selectedHQ() !== null;
    const hasSpawn = this.spawnMode() === 'random' || this.selectedSpawn() !== null;
    return hasHQ && hasSpawn;
  });

  toggleCoordinates(): void {
    this.showCoordinates.update((v) => !v);
  }

  onCoordLatChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.coordLat.set(value ? parseFloat(value) : null);
  }

  onCoordLonChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.coordLon.set(value ? parseFloat(value) : null);
  }

  async applyCoordinates(): Promise<void> {
    if (!this.canApplyCoords()) return;

    const lat = this.coordLat()!;
    const lon = this.coordLon()!;

    this.isLoadingCoords.set(true);
    try {
      const result = await this.geocodingService.reverseGeocodeDetailed(lat, lon);
      if (result) {
        this.selectedHQ.set({
          lat,
          lon,
          name: result.displayName,
          address: result.address,
        });
      } else {
        // Use coordinates directly if reverse geocoding fails
        this.selectedHQ.set({
          lat,
          lon,
          name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
        });
      }
    } finally {
      this.isLoadingCoords.set(false);
    }
  }

  onHQSelected(location: { lat: number; lon: number; name: string; address?: NominatimAddress }): void {
    this.selectedHQ.set(location);
    // Update coordinate fields
    this.coordLat.set(location.lat);
    this.coordLon.set(location.lon);
  }

  onHQCleared(): void {
    this.selectedHQ.set(null);
  }

  setSpawnMode(mode: SpawnMode): void {
    this.spawnMode.set(mode);
    if (mode === 'random') {
      this.selectedSpawn.set(null);
    }
  }

  onSpawnSelected(location: { lat: number; lon: number; name: string }): void {
    this.selectedSpawn.set(location);
  }

  onSpawnCleared(): void {
    this.selectedSpawn.set(null);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  confirm(): void {
    const hq = this.selectedHQ();
    if (!hq) return;

    // Use structured address for name extraction, fall back to displayName
    const extractedName = hq.address
      ? this.geocodingService.extractLocationName(hq.address)
      : 'Unbekannter Ort';

    const hqInfo: LocationInfo = {
      lat: hq.lat,
      lon: hq.lon,
      name: extractedName !== 'Unbekannter Ort' ? extractedName : (hq.name || `${hq.lat.toFixed(4)}, ${hq.lon.toFixed(4)}`),
      displayName: hq.name || '',
      address: hq.address,
    };

    let spawnConfig: SpawnLocationConfig;

    if (this.spawnMode() === 'random') {
      // Random spawn will be generated by the caller
      spawnConfig = {
        id: 'spawn_random',
        lat: 0, // Will be set by caller
        lon: 0,
        isRandom: true,
      };
    } else {
      const spawn = this.selectedSpawn();
      if (!spawn) return;

      spawnConfig = {
        id: 'spawn_manual',
        lat: spawn.lat,
        lon: spawn.lon,
        name: spawn.name,
        isRandom: false,
      };
    }

    const result: LocationDialogResult = {
      hq: hqInfo,
      spawn: spawnConfig,
      confirmed: true,
    };

    this.dialogRef.close(result);
  }
}
