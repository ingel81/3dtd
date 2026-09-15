import { Component, inject, input, output, signal, effect, ElementRef, ViewChild, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GeocodingService, GeocodingResult, NominatimAddress } from '../services/location/geocoding.service';
import { TD_CSS_VARS } from '../styles/td-theme';
import { TdIconComponent } from './icon/icon.component';

type SearchState = 'idle' | 'too-short' | 'searching' | 'results' | 'no-results' | 'error' | 'selected';

@Component({
  selector: 'app-td-address-autocomplete',
  standalone: true,
  imports: [CommonModule, FormsModule, MatProgressSpinnerModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './address-autocomplete.component.html',
  styleUrl: './address-autocomplete.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class AddressAutocompleteComponent {
  @ViewChild('inputElement') inputElement!: ElementRef<HTMLInputElement>;

  readonly geocoding = inject(GeocodingService);

  // Inputs
  placeholder = input<string>('Search address...');
  currentValue = input<{ lat: number; lon: number; name?: string; address?: NominatimAddress } | null>(null);

  // Outputs
  locationSelected = output<{ lat: number; lon: number; name: string; address?: NominatimAddress }>();
  locationCleared = output<void>();

  /**
   * The text in the field. A signal: searchState counts its characters, and
   * as a plain field the state stayed "idle" while the first two were typed
   * (nothing it read had changed).
   */
  readonly searchText = signal('');
  readonly hasFocus = signal(false);
  readonly showDropdown = signal(false);

  // Computed search state for status display
  readonly searchState = computed<SearchState>(() => {
    const length = this.searchText().length;
    if (this.currentValue()) return 'selected';
    if (this.geocoding.error()) return 'error';
    if (this.geocoding.isLoading()) return 'searching';
    if (length === 0) return 'idle';
    if (length < 3) return 'too-short';
    if (this.geocoding.results().length > 0) return 'results';
    return 'no-results';
  });

  constructor() {
    // Update input text when value changes externally
    effect(() => {
      const value = this.currentValue();
      if (value && !this.hasFocus()) {
        this.searchText.set(this.formatValueName(value));
      } else if (!value && !this.hasFocus()) {
        this.searchText.set('');
      }
    });
  }

  /** Each keystroke in the field ((ngModelChange)). */
  onSearchChange(query: string): void {
    this.searchText.set(query);
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
      this.searchText.set('');
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
        this.searchText.set(this.formatValueName(value));
      }
    }, 200);
  }

  selectResult(result: GeocodingResult): void {
    this.searchText.set(this.formatSmartName(result));
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
    this.searchText.set('');
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
