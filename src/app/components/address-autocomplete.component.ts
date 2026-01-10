import { Component, inject, input, output, signal, effect, ElementRef, ViewChild, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GeocodingService, GeocodingResult, NominatimAddress } from '../services/geocoding.service';
import { TD_CSS_VARS } from '../styles/td-theme';

type SearchState = 'idle' | 'too-short' | 'searching' | 'results' | 'no-results' | 'error' | 'selected';

@Component({
  selector: 'app-td-address-autocomplete',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="autocomplete-container" [class.has-focus]="hasFocus()">
      <div class="input-wrapper" [class.has-value]="currentValue()">
        <mat-icon class="input-icon">{{ currentValue() ? 'place' : 'search' }}</mat-icon>
        <input
          #inputElement
          type="text"
          [placeholder]="placeholder()"
          [(ngModel)]="searchText"
          (ngModelChange)="onSearchChange($event)"
          (focus)="onFocus()"
          (blur)="onBlur()"
          [class.selected]="currentValue()"
        />
        @if (geocoding.isLoading()) {
          <mat-spinner diameter="14" class="loading-spinner"></mat-spinner>
        }
        @if (currentValue() && !geocoding.isLoading()) {
          <button class="clear-btn" (mousedown)="clearValue($event)" title="Löschen">
            <mat-icon>close</mat-icon>
          </button>
        }
      </div>

      <!-- Status hint below input -->
      @if (hasFocus() && !currentValue()) {
        <div class="status-bar" [class.expanded]="showDropdown()">
          @switch (searchState()) {
            @case ('idle') {
              <span class="hint">Adresse eingeben...</span>
            }
            @case ('too-short') {
              <span class="hint">
                <mat-icon>keyboard</mat-icon>
                Noch {{ 3 - searchText.length }} Zeichen
              </span>
            }
            @case ('searching') {
              <span class="hint searching">
                <mat-icon>search</mat-icon>
                Suche...
              </span>
            }
            @case ('results') {
              <span class="hint success">
                <mat-icon>check_circle</mat-icon>
                {{ geocoding.results().length }} Treffer
              </span>
            }
            @case ('no-results') {
              <span class="hint warning">
                <mat-icon>search_off</mat-icon>
                Keine Treffer
              </span>
            }
            @case ('error') {
              <span class="hint error">
                <mat-icon>error</mat-icon>
                Fehler bei Suche
              </span>
            }
          }
        </div>
      }

      <!-- Results dropdown -->
      @if (showDropdown() && geocoding.results().length > 0) {
        <div class="dropdown">
          @for (result of geocoding.results().slice(0, 5); track result.placeId) {
            <div class="result-item" (mousedown)="selectResult(result)">
              <mat-icon class="result-icon">place</mat-icon>
              <span class="result-text">{{ formatResultLine(result) }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      ${TD_CSS_VARS}
    }

    .autocomplete-container {
      position: relative;
      width: 100%;
    }

    .input-wrapper {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-dark);
      padding: 0 8px;
      transition: all 0.15s ease;
    }

    .autocomplete-container.has-focus .input-wrapper {
      border-color: var(--td-gold);
      background: var(--td-panel-secondary);
    }

    .input-wrapper.has-value {
      border-color: var(--td-green-dark);
      background: rgba(158, 214, 160, 0.08);
    }

    .input-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--td-text-muted);
      transition: color 0.15s ease;
    }

    .input-wrapper.has-value .input-icon {
      color: var(--td-green);
    }

    input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: var(--td-text-primary);
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      padding: 6px 0;
      min-width: 0;
    }

    input::placeholder {
      color: var(--td-text-disabled);
    }

    input.selected {
      color: var(--td-green);
      font-weight: 500;
    }

    .loading-spinner {
      --mdc-circular-progress-active-indicator-color: var(--td-gold);
    }

    .clear-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2px;
      background: transparent;
      border: none;
      color: var(--td-text-muted);
      cursor: pointer;
      transition: color 0.15s ease;
    }

    .clear-btn:hover {
      color: var(--td-health-red);
    }

    .clear-btn mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }

    /* Status bar */
    .status-bar {
      display: flex;
      align-items: center;
      padding: 4px 8px;
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-dark);
      border-top: none;
      margin-top: -1px;
    }

    .status-bar.expanded {
      border-color: var(--td-gold);
    }

    .hint {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 9px;
      color: var(--td-text-muted);
    }

    .hint mat-icon {
      font-size: 11px;
      width: 11px;
      height: 11px;
    }

    .hint.searching {
      color: var(--td-gold);
    }

    .hint.searching mat-icon {
      animation: pulse 1s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .hint.success {
      color: var(--td-green);
    }

    .hint.warning {
      color: var(--td-warn-orange);
    }

    .hint.error {
      color: var(--td-health-red);
    }

    /* Dropdown */
    .dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: var(--td-bg-dark);
      border: 1px solid var(--td-gold);
      border-top: none;
      max-height: 160px;
      overflow-y: auto;
      z-index: 100;
    }

    .result-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      cursor: pointer;
      transition: background 0.1s ease;
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .result-item:last-child {
      border-bottom: none;
    }

    .result-item:hover {
      background: var(--td-panel-main);
    }

    .result-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
      color: var(--td-teal);
      flex-shrink: 0;
    }

    .result-text {
      font-size: 10px;
      color: var(--td-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
    }
  `,
})
export class AddressAutocompleteComponent {
  @ViewChild('inputElement') inputElement!: ElementRef<HTMLInputElement>;

  readonly geocoding = inject(GeocodingService);

  // Inputs
  placeholder = input<string>('Adresse suchen...');
  currentValue = input<{ lat: number; lon: number; name?: string; address?: NominatimAddress } | null>(null);

  // Outputs
  locationSelected = output<{ lat: number; lon: number; name: string; address?: NominatimAddress }>();
  locationCleared = output<void>();

  searchText = '';
  readonly hasFocus = signal(false);
  readonly showDropdown = signal(false);

  // Computed search state for status display
  readonly searchState = computed<SearchState>(() => {
    if (this.currentValue()) return 'selected';
    if (this.geocoding.error()) return 'error';
    if (this.geocoding.isLoading()) return 'searching';
    if (this.searchText.length === 0) return 'idle';
    if (this.searchText.length < 3) return 'too-short';
    if (this.geocoding.results().length > 0) return 'results';
    if (this.searchText.length >= 3) return 'no-results';
    return 'idle';
  });

  constructor() {
    // Update input text when value changes externally
    effect(() => {
      const value = this.currentValue();
      if (value && !this.hasFocus()) {
        this.searchText = this.formatValueName(value);
      } else if (!value && !this.hasFocus()) {
        this.searchText = '';
      }
    });
  }

  onSearchChange(query: string): void {
    this.geocoding.search(query);
    // Show dropdown when we have results
    if (query.length >= 3) {
      this.showDropdown.set(true);
    }
  }

  onFocus(): void {
    this.hasFocus.set(true);
    // Clear text when focusing to edit
    if (this.currentValue()) {
      this.searchText = '';
      this.locationCleared.emit();
    }
    if (this.geocoding.results().length > 0) {
      this.showDropdown.set(true);
    }
  }

  onBlur(): void {
    // Delay to allow click on results
    setTimeout(() => {
      this.hasFocus.set(false);
      this.showDropdown.set(false);
      // Restore text if we have a value
      const value = this.currentValue();
      if (value) {
        this.searchText = this.formatValueName(value);
      }
    }, 200);
  }

  selectResult(result: GeocodingResult): void {
    this.searchText = this.formatSmartName(result);
    this.showDropdown.set(false);
    this.geocoding.clearResults();

    this.locationSelected.emit({
      lat: result.lat,
      lon: result.lon,
      name: result.displayName,
      address: result.address,
    });
  }

  /**
   * Build smart name from structured address (same logic as header display)
   * Priority: Street + HouseNumber, City > displayName > coordinates
   */
  formatSmartName(result: GeocodingResult): string {
    return this.formatValueName({
      lat: result.lat,
      lon: result.lon,
      name: result.displayName,
      address: result.address,
    });
  }

  /**
   * Format a location value for display (used for input text)
   */
  formatValueName(value: { lat: number; lon: number; name?: string; address?: NominatimAddress }): string {
    if (value.address) {
      const addr = value.address;
      const parts: string[] = [];

      // Street + house number
      if (addr.road) {
        parts.push(addr.house_number ? `${addr.road} ${addr.house_number}` : addr.road);
      }

      // City (prefer city > town > village > municipality)
      const city = addr.city || addr.town || addr.village || addr.municipality;
      if (city) {
        parts.push(city);
      }

      if (parts.length > 0) {
        return parts.join(', ');
      }
    }

    // Fall back to displayName or coordinates
    return value.name || `${value.lat.toFixed(4)}, ${value.lon.toFixed(4)}`;
  }

  clearValue(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.searchText = '';
    this.geocoding.clearResults();
    this.locationCleared.emit();
    // Focus input after clearing
    setTimeout(() => this.inputElement?.nativeElement?.focus(), 0);
  }

  /**
   * Format result as single line for dropdown display
   * Uses structured address if available for better formatting
   */
  formatResultLine(result: GeocodingResult): string {
    if (result.address) {
      const addr = result.address;
      const parts: string[] = [];

      // Street + house number (combined)
      if (addr.road) {
        parts.push(addr.house_number ? `${addr.road} ${addr.house_number}` : addr.road);
      }

      // City (prefer city > town > village > municipality)
      const city = addr.city || addr.town || addr.village || addr.municipality;
      if (city) {
        parts.push(city);
      }

      // Suburb/District if different from city and adds context
      if (addr.suburb && addr.suburb !== city) {
        // Insert suburb after street if we have one
        if (parts.length >= 2) {
          parts.splice(1, 0, addr.suburb);
        } else if (parts.length === 1) {
          parts.push(addr.suburb);
        }
      }

      if (parts.length > 0) {
        return parts.join(', ');
      }
    }

    // Fall back to displayName, but truncate country/postcode parts
    const parts = result.displayName.split(',');
    // Keep first 3-4 meaningful parts
    return parts.slice(0, 4).map(p => p.trim()).join(', ');
  }
}
