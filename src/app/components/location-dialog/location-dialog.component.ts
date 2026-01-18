import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AddressAutocompleteComponent } from '../address-autocomplete.component';
import { GeocodingService, NominatimAddress } from '../../services/geocoding.service';
import {
  LocationDialogData,
  LocationDialogResult,
  LocationInfo,
  SpawnLocationConfig,
} from '../../models/location.types';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { haversineDistance } from '../../utils/geo-utils';

type SpawnMode = 'random' | 'manual';
type EditMode = 'full' | 'spawn-only';

@Component({
  selector: 'app-td-location-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    AddressAutocompleteComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="location-dialog">
      <!-- Header -->
      <div class="dialog-header">
        <mat-icon class="header-icon">edit_location</mat-icon>
        <h2>Spielort ändern</h2>
      </div>

      <!-- Mode Tabs -->
      <div class="mode-tabs">
        <button
          class="mode-tab"
          [class.active]="editMode() === 'full'"
          (click)="setEditMode('full')"
        >
          <mat-icon>swap_horiz</mat-icon>
          <span>Neuer Ort</span>
        </button>
        <button
          class="mode-tab"
          [class.active]="editMode() === 'spawn-only'"
          (click)="setEditMode('spawn-only')"
          [disabled]="!data.currentLocation"
        >
          <mat-icon>flag</mat-icon>
          <span>Nur Spawn</span>
        </button>
      </div>

      <!-- Content -->
      <div class="dialog-content">
        <!-- Warning box (only for full mode with game in progress) -->
        @if (data.isGameInProgress && editMode() === 'full') {
          <div class="warning-box">
            <mat-icon>warning</mat-icon>
            <div class="warning-text">
              <strong>Achtung!</strong> Das aktuelle Spiel wird beendet.
            </div>
          </div>
        }

        <!-- FULL MODE: New HQ + Spawn -->
        @if (editMode() === 'full') {
          <!-- HQ Section -->
          <div class="section hq-section">
            <div class="section-header">
              <mat-icon>home</mat-icon>
              <span class="section-title">Hauptquartier (HQ)</span>
            </div>
            <div class="section-body">
              <app-td-address-autocomplete
                [placeholder]="'Stadt, Straße oder Adresse...'"
                [currentValue]="selectedHQ()"
                (locationSelected)="onHQSelected($event)"
                (locationCleared)="onHQCleared()"
              />
              <!-- Coordinates toggle -->
              <button class="coords-toggle" (click)="toggleCoordinates()">
                <mat-icon>{{ showCoordinates() ? 'expand_less' : 'expand_more' }}</mat-icon>
                <span>Koordinaten eingeben</span>
              </button>
              @if (showCoordinates()) {
                <div class="coords-input">
                  <div class="coord-field">
                    <label for="coord-lat">Lat</label>
                    <input
                      id="coord-lat"
                      type="text"
                      [value]="coordLat()"
                      (input)="onCoordLatChange($event)"
                      (paste)="onCoordPaste($event)"
                      placeholder="49.5432"
                    />
                  </div>
                  <div class="coord-field">
                    <label for="coord-lon">Lon</label>
                    <input
                      id="coord-lon"
                      type="text"
                      [value]="coordLon()"
                      (input)="onCoordLonChange($event)"
                      (paste)="onCoordPaste($event)"
                      placeholder="9.1234"
                    />
                  </div>
                  <button
                    class="apply-coords-btn"
                    [disabled]="!canApplyCoords()"
                    (click)="applyCoordinates()"
                    matTooltip="Koordinaten übernehmen"
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
          </div>

          <!-- Spawn Section (full mode) -->
          <div class="section spawn-section">
            <div class="section-header">
              <mat-icon>flag</mat-icon>
              <span class="section-title">Spawn-Punkt</span>
              <span class="section-hint">Gegner erscheinen hier</span>
            </div>
            <div class="section-body">
              <div class="spawn-mode-toggle">
                <button
                  class="spawn-mode-btn"
                  [class.active]="spawnMode() === 'random'"
                  (click)="setSpawnMode('random')"
                >
                  <mat-icon>casino</mat-icon>
                  <span>Zufällig</span>
                </button>
                <button
                  class="spawn-mode-btn"
                  [class.active]="spawnMode() === 'manual'"
                  (click)="setSpawnMode('manual')"
                >
                  <mat-icon>edit_location_alt</mat-icon>
                  <span>Manuell</span>
                </button>
              </div>
              @if (spawnMode() === 'random') {
                <div class="spawn-info">
                  <mat-icon>info_outline</mat-icon>
                  <span>Automatisch 500m-1km vom HQ auf einer Straße</span>
                </div>
              } @else {
                <div class="manual-spawn-input">
                  <app-td-address-autocomplete
                    [placeholder]="'Spawn-Adresse suchen...'"
                    [currentValue]="selectedSpawn()"
                    (locationSelected)="onSpawnSelected($event)"
                    (locationCleared)="onSpawnCleared()"
                  />
                  @if (spawnDistance() !== null) {
                    <div class="distance-badge" [class.error]="isSpawnTooFar()">
                      <mat-icon>{{ isSpawnTooFar() ? 'error' : 'straighten' }}</mat-icon>
                      <span>{{ (spawnDistance()! / 1000).toFixed(1) }} km</span>
                      @if (isSpawnTooFar()) {
                        <span class="limit">(max 1.5 km)</span>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        }

        <!-- SPAWN-ONLY MODE -->
        @if (editMode() === 'spawn-only') {
          <!-- Current HQ (readonly) -->
          @if (data.currentLocation) {
            <div class="current-hq-info">
              <mat-icon>home</mat-icon>
              <div class="hq-details">
                <span class="hq-label">HQ bleibt</span>
                <span class="hq-name">{{ data.currentLocation.name }}</span>
              </div>
            </div>
          }

          <!-- Spawn Section (spawn-only mode) -->
          <div class="section spawn-section">
            <div class="section-header">
              <mat-icon>flag</mat-icon>
              <span class="section-title">Neuer Spawn-Punkt</span>
            </div>
            <div class="section-body">
              <app-td-address-autocomplete
                [placeholder]="'Neuen Spawn-Punkt suchen...'"
                [currentValue]="selectedSpawn()"
                (locationSelected)="onSpawnSelected($event)"
                (locationCleared)="onSpawnCleared()"
              />
              @if (spawnDistance() !== null) {
                <div class="distance-badge" [class.error]="isSpawnTooFar()">
                  <mat-icon>{{ isSpawnTooFar() ? 'error' : 'straighten' }}</mat-icon>
                  <span>{{ (spawnDistance()! / 1000).toFixed(1) }} km vom HQ</span>
                  @if (isSpawnTooFar()) {
                    <span class="limit">(max 1.5 km)</span>
                  }
                </div>
              }
              <div class="spawn-info">
                <mat-icon>info_outline</mat-icon>
                <span>Spawn muss max. 1.5 km vom HQ entfernt sein</span>
              </div>
            </div>
          </div>
        }
      </div>

      <!-- Actions -->
      <div class="dialog-actions">
        <button class="cancel-btn" (click)="cancel()">Abbrechen</button>
        <button class="confirm-btn" [disabled]="!canConfirm()" (click)="confirm()">
          <mat-icon>check</mat-icon>
          {{ editMode() === 'spawn-only' ? 'Spawn ändern' : 'Ort wechseln' }}
        </button>
      </div>
    </div>
  `,
  styles: `
    :host {
      ${TD_CSS_VARS}
    }

    .location-dialog {
      width: 420px;
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
      border-bottom: 1px solid var(--td-frame-dark);
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

    /* Mode Tabs */
    .mode-tabs {
      display: flex;
      background: var(--td-panel-shadow);
      border-bottom: 2px solid var(--td-frame-dark);
    }

    .mode-tab {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px 16px;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      color: var(--td-text-muted);
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .mode-tab:hover:not(:disabled) {
      color: var(--td-text-secondary);
      background: rgba(255, 255, 255, 0.02);
    }

    .mode-tab.active {
      color: var(--td-gold);
      border-bottom-color: var(--td-gold);
      background: rgba(201, 164, 76, 0.05);
    }

    .mode-tab:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .mode-tab mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .dialog-content {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* Warning Box */
    .warning-box {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      background: var(--td-health-bg);
      border: 1px solid var(--td-warn-orange);
      border-bottom-width: 2px;
    }

    .warning-box mat-icon {
      color: var(--td-warn-orange);
      font-size: 16px;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    .warning-text {
      font-size: 10px;
      color: var(--td-text-secondary);
    }

    .warning-text strong {
      color: var(--td-warn-orange);
    }

    /* Sections */
    .section {
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-dark);
      border-left-color: var(--td-frame-dark);
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: var(--td-panel-main);
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .section-header mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--td-teal);
    }

    .section-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--td-text-primary);
    }

    .section-hint {
      margin-left: auto;
      font-size: 9px;
      color: var(--td-text-muted);
    }

    .section-body {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* HQ Section specific */
    .hq-section .section-header mat-icon {
      color: var(--td-gold);
    }

    /* Coordinates toggle & input */
    .coords-toggle {
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

    .coords-toggle:hover {
      color: var(--td-text-secondary);
    }

    .coords-toggle mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .coords-input {
      display: flex;
      gap: 8px;
      padding: 10px;
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

    /* Spawn Mode Toggle */
    .spawn-mode-toggle {
      display: flex;
      gap: 6px;
    }

    .spawn-mode-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 12px;
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-dark);
      color: var(--td-text-muted);
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .spawn-mode-btn:hover {
      border-color: var(--td-frame-mid);
      color: var(--td-text-secondary);
    }

    .spawn-mode-btn.active {
      background: rgba(201, 164, 76, 0.1);
      border-color: var(--td-gold);
      color: var(--td-gold);
    }

    .spawn-mode-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    /* Spawn Info */
    .spawn-info {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-dark);
      font-size: 9px;
      color: var(--td-text-muted);
    }

    .spawn-info mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
      color: var(--td-teal);
      opacity: 0.7;
    }

    /* Manual Spawn Input */
    .manual-spawn-input {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* Distance Badge */
    .distance-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-mid);
      font-size: 10px;
      color: var(--td-text-secondary);
    }

    .distance-badge mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--td-teal);
    }

    .distance-badge.error {
      border-color: var(--td-health-red);
      background: var(--td-health-bg);
    }

    .distance-badge.error mat-icon {
      color: var(--td-health-red);
    }

    .distance-badge .limit {
      color: var(--td-health-red);
      font-weight: 500;
    }

    /* Current HQ Info (spawn-only mode) */
    .current-hq-info {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-left: 3px solid var(--td-gold);
    }

    .current-hq-info mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--td-gold);
    }

    .hq-details {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .hq-label {
      font-size: 9px;
      color: var(--td-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .hq-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--td-text-primary);
    }

    /* Dialog Actions */
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 12px 16px;
      background: var(--td-panel-main);
      border-top: 1px solid var(--td-frame-mid);
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
  readonly editMode = signal<EditMode>('full');
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

  // Spawn distance from HQ
  readonly spawnDistance = computed(() => {
    const spawn = this.selectedSpawn();
    if (!spawn) return null;

    let hqLat: number, hqLon: number;
    if (this.editMode() === 'spawn-only' && this.data.currentLocation) {
      hqLat = this.data.currentLocation.lat;
      hqLon = this.data.currentLocation.lon;
    } else if (this.selectedHQ()) {
      hqLat = this.selectedHQ()!.lat;
      hqLon = this.selectedHQ()!.lon;
    } else {
      return null;
    }

    return haversineDistance(hqLat, hqLon, spawn.lat, spawn.lon);
  });

  readonly isSpawnTooFar = computed(() => {
    const dist = this.spawnDistance();
    return dist !== null && dist > 1500;
  });

  readonly canConfirm = computed(() => {
    // Check spawn distance
    if (this.spawnMode() === 'manual' && this.isSpawnTooFar()) {
      return false;
    }

    if (this.editMode() === 'spawn-only') {
      return this.data.currentLocation !== null &&
             (this.spawnMode() === 'random' || this.selectedSpawn() !== null);
    }
    const hasHQ = this.selectedHQ() !== null;
    const hasSpawn = this.spawnMode() === 'random' || this.selectedSpawn() !== null;
    return hasHQ && hasSpawn;
  });

  setEditMode(mode: EditMode): void {
    this.editMode.set(mode);
    if (mode === 'spawn-only') {
      // In spawn-only mode, default to manual spawn selection
      this.spawnMode.set('manual');
    }
  }

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

  onCoordPaste(event: ClipboardEvent): void {
    const pastedText = event.clipboardData?.getData('text')?.trim();
    if (!pastedText) return;

    const coords = this.parseCoordinates(pastedText);
    if (coords) {
      event.preventDefault();
      this.coordLat.set(coords.lat);
      this.coordLon.set(coords.lon);
    }
  }

  private parseCoordinates(text: string): { lat: number; lon: number } | null {
    // Normalize whitespace and common separators
    const normalized = text.trim().replace(/\s+/g, ' ');

    // Try various formats

    // Format: "49.5432, 9.1234" or "49.5432,9.1234" or "49.5432 9.1234"
    const decimalPattern = /^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/;
    let match = normalized.match(decimalPattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      if (this.isValidLatLon(lat, lon)) {
        return { lat, lon };
      }
    }

    // Format with cardinal directions: "49.5432°N, 9.1234°E" or "49.5432N 9.1234E"
    const cardinalPattern = /^(-?\d+\.?\d*)\s*°?\s*([NSns])[,\s]+(-?\d+\.?\d*)\s*°?\s*([EWew])$/;
    match = normalized.match(cardinalPattern);
    if (match) {
      let lat = parseFloat(match[1]);
      let lon = parseFloat(match[3]);
      if (match[2].toUpperCase() === 'S') lat = -lat;
      if (match[4].toUpperCase() === 'W') lon = -lon;
      if (this.isValidLatLon(lat, lon)) {
        return { lat, lon };
      }
    }

    // Format: "N 49.5432, E 9.1234" or "N49.5432 E9.1234"
    const prefixCardinalPattern = /^([NSns])\s*(-?\d+\.?\d*)[,\s]+([EWew])\s*(-?\d+\.?\d*)$/;
    match = normalized.match(prefixCardinalPattern);
    if (match) {
      let lat = parseFloat(match[2]);
      let lon = parseFloat(match[4]);
      if (match[1].toUpperCase() === 'S') lat = -lat;
      if (match[3].toUpperCase() === 'W') lon = -lon;
      if (this.isValidLatLon(lat, lon)) {
        return { lat, lon };
      }
    }

    // DMS Format: "49°32'35.5\"N 9°7'24.2\"E" or similar
    const dmsPattern = /^(\d+)\s*°\s*(\d+)\s*['′]\s*(\d+\.?\d*)\s*["″]?\s*([NSns])[,\s]+(\d+)\s*°\s*(\d+)\s*['′]\s*(\d+\.?\d*)\s*["″]?\s*([EWew])$/;
    match = normalized.match(dmsPattern);
    if (match) {
      let lat = this.dmsToDecimal(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]));
      let lon = this.dmsToDecimal(parseFloat(match[5]), parseFloat(match[6]), parseFloat(match[7]));
      if (match[4].toUpperCase() === 'S') lat = -lat;
      if (match[8].toUpperCase() === 'W') lon = -lon;
      if (this.isValidLatLon(lat, lon)) {
        return { lat, lon };
      }
    }

    // Google Maps URL format: "@49.5432,9.1234" or "/@49.5432,9.1234,"
    const googleMapsPattern = /@(-?\d+\.?\d*),(-?\d+\.?\d*)/;
    match = text.match(googleMapsPattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      if (this.isValidLatLon(lat, lon)) {
        return { lat, lon };
      }
    }

    return null;
  }

  private dmsToDecimal(degrees: number, minutes: number, seconds: number): number {
    return degrees + minutes / 60 + seconds / 3600;
  }

  private isValidLatLon(lat: number, lon: number): boolean {
    return !isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
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
    let hqInfo: LocationInfo;

    if (this.editMode() === 'spawn-only') {
      // Use current HQ
      const current = this.data.currentLocation;
      if (!current) return;

      hqInfo = {
        lat: current.lat,
        lon: current.lon,
        name: current.name || `${current.lat.toFixed(4)}, ${current.lon.toFixed(4)}`,
        displayName: current.name || `${current.lat.toFixed(4)}, ${current.lon.toFixed(4)}`,
      };
    } else {
      // Use selected HQ
      const hq = this.selectedHQ();
      if (!hq) return;

      const extractedName = hq.address
        ? this.geocodingService.extractLocationName(hq.address)
        : 'Unbekannter Ort';

      hqInfo = {
        lat: hq.lat,
        lon: hq.lon,
        name: extractedName !== 'Unbekannter Ort' ? extractedName : (hq.name || `${hq.lat.toFixed(4)}, ${hq.lon.toFixed(4)}`),
        displayName: hq.name || '',
        address: hq.address,
      };
    }

    let spawnConfig: SpawnLocationConfig;

    if (this.spawnMode() === 'random') {
      spawnConfig = {
        id: 'spawn_random',
        lat: 0,
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
