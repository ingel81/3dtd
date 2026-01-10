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
    .location-dialog {
      width: 400px;
      max-width: 90vw;
      background: linear-gradient(180deg, #1a1b1f 0%, #0d0d0f 100%);
      color: #fff;
      font-family: 'Inter', sans-serif;
    }

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 16px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .header-icon {
      color: #9333ea;
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }

    .dialog-content {
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .current-location {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .label,
    .section-label {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.5);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .location-display {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(147, 51, 234, 0.15);
      border: 1px solid rgba(147, 51, 234, 0.3);
      border-radius: 4px;
      font-size: 13px;
    }

    .location-display mat-icon {
      color: #9333ea;
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .warning-box {
      display: flex;
      gap: 10px;
      padding: 12px;
      background: rgba(249, 115, 22, 0.15);
      border: 1px solid rgba(249, 115, 22, 0.4);
      border-radius: 4px;
    }

    .warning-box mat-icon {
      color: #f97316;
      font-size: 20px;
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }

    .warning-text {
      font-size: 12px;
      line-height: 1.4;
    }

    .warning-text strong {
      color: #f97316;
    }

    .warning-text p {
      margin: 4px 0 0;
      color: rgba(255, 255, 255, 0.7);
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
      color: rgba(255, 255, 255, 0.5);
      font-size: 11px;
      cursor: pointer;
      transition: color 0.15s ease;
    }

    .expand-header:hover {
      color: rgba(255, 255, 255, 0.8);
    }

    .expand-header mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .coords-input {
      display: flex;
      gap: 8px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 4px;
    }

    .coord-field {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .coord-field label {
      font-size: 9px;
      color: rgba(255, 255, 255, 0.4);
      text-transform: uppercase;
    }

    .coord-field input {
      width: 100%;
      padding: 6px 8px;
      background: rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 3px;
      color: #fff;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
    }

    .coord-field input:focus {
      outline: none;
      border-color: #9333ea;
    }

    .apply-coords-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      margin-top: auto;
      background: #9333ea;
      border: none;
      border-radius: 4px;
      color: #fff;
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .apply-coords-btn:hover:not(:disabled) {
      background: #7c22d6;
    }

    .apply-coords-btn:disabled {
      background: rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.3);
      cursor: not-allowed;
    }

    .apply-coords-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
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
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .radio-option:hover {
      border-color: rgba(255, 255, 255, 0.2);
    }

    .radio-option.selected {
      border-color: #9333ea;
      background: rgba(147, 51, 234, 0.1);
    }

    .radio-option input[type='radio'] {
      margin-top: 2px;
      accent-color: #9333ea;
    }

    .radio-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .radio-label {
      font-size: 12px;
      font-weight: 500;
    }

    .radio-desc {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.5);
    }

    .manual-spawn-input {
      margin-top: 8px;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 12px 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }

    .cancel-btn,
    .confirm-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .cancel-btn {
      background: transparent;
      color: rgba(255, 255, 255, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .cancel-btn:hover {
      background: rgba(255, 255, 255, 0.05);
      color: #fff;
    }

    .confirm-btn {
      background: #9333ea;
      color: #fff;
    }

    .confirm-btn:hover:not(:disabled) {
      background: #7c22d6;
    }

    .confirm-btn:disabled {
      background: rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.3);
      cursor: not-allowed;
    }

    .confirm-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
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
