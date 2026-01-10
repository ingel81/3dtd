import { Component, inject, input, output, signal, effect, ElementRef, ViewChild, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GeocodingService, GeocodingResult, NominatimAddress } from '../services/geocoding.service';

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
          @for (result of geocoding.results().slice(0, 5); track result.displayName) {
            <div class="result-item" (mousedown)="selectResult(result)">
              <mat-icon class="result-icon">place</mat-icon>
              <div class="result-text">
                <span class="result-name">{{ formatName(result.displayName) }}</span>
                <span class="result-detail">{{ formatDetail(result.displayName) }}</span>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .autocomplete-container {
      position: relative;
      width: 100%;
    }

    .input-wrapper {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      padding: 0 8px;
      transition: all 0.15s ease;
    }

    .autocomplete-container.has-focus .input-wrapper {
      border-color: #9333ea;
      background: rgba(0, 0, 0, 0.7);
    }

    .input-wrapper.has-value {
      border-color: rgba(34, 197, 94, 0.5);
      background: rgba(34, 197, 94, 0.1);
    }

    .input-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: rgba(255, 255, 255, 0.4);
      transition: color 0.15s ease;
    }

    .input-wrapper.has-value .input-icon {
      color: #22c55e;
    }

    input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: #fff;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      padding: 6px 0;
      min-width: 0;
    }

    input::placeholder {
      color: rgba(255, 255, 255, 0.3);
    }

    input.selected {
      color: #22c55e;
      font-weight: 500;
    }

    .loading-spinner {
      --mdc-circular-progress-active-indicator-color: #9333ea;
    }

    .clear-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2px;
      background: transparent;
      border: none;
      color: rgba(255, 255, 255, 0.4);
      cursor: pointer;
      transition: color 0.15s ease;
    }

    .clear-btn:hover {
      color: #ef4444;
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
      background: rgba(20, 20, 20, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-top: none;
      border-radius: 0 0 4px 4px;
      margin-top: -1px;
    }

    .status-bar.expanded {
      border-color: #9333ea;
      border-radius: 0;
    }

    .hint {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 9px;
      color: rgba(255, 255, 255, 0.5);
    }

    .hint mat-icon {
      font-size: 11px;
      width: 11px;
      height: 11px;
    }

    .hint.searching {
      color: #9333ea;
    }

    .hint.searching mat-icon {
      animation: pulse 1s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .hint.success {
      color: #22c55e;
    }

    .hint.warning {
      color: #f97316;
    }

    .hint.error {
      color: #ef4444;
    }

    /* Dropdown */
    .dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: rgba(10, 10, 10, 0.98);
      border: 1px solid #9333ea;
      border-top: none;
      border-bottom-left-radius: 4px;
      border-bottom-right-radius: 4px;
      max-height: 180px;
      overflow-y: auto;
      z-index: 100;
    }

    .result-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 10px;
      cursor: pointer;
      transition: background 0.1s ease;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .result-item:last-child {
      border-bottom: none;
    }

    .result-item:hover {
      background: rgba(147, 51, 234, 0.25);
    }

    .result-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: #9333ea;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .result-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }

    .result-name {
      font-size: 10px;
      color: #fff;
      font-weight: 500;
    }

    .result-detail {
      font-size: 8px;
      color: rgba(255, 255, 255, 0.5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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

  formatName(displayName: string): string {
    // Return first part (street + number or POI name)
    const parts = displayName.split(',');
    return parts[0]?.trim() || displayName;
  }

  formatDetail(displayName: string): string {
    // Return all remaining parts (city, region, country, etc.)
    const parts = displayName.split(',');
    if (parts.length <= 1) return '';
    return parts.slice(1).map(p => p.trim()).join(', ');
  }
}
