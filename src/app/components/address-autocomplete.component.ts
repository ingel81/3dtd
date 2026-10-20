import { Component, inject, input, output, signal, effect, ElementRef, ViewChild, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GeocodingService, GeocodingResult, NominatimAddress } from '../services/location/geocoding.service';
import { TdIconComponent } from './icon/icon.component';
import { injectT } from '../i18n/i18n.service';
import { contextLines } from '../services/location/search-results';

type SearchState = 'idle' | 'too-short' | 'ready' | 'searching' | 'results' | 'no-results' | 'error' | 'selected';

@Component({
  selector: 'app-td-address-autocomplete',
  standalone: true,
  imports: [CommonModule, FormsModule, MatProgressSpinnerModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './address-autocomplete.component.html',
  styleUrl: './address-autocomplete.component.scss',
})
export class AddressAutocompleteComponent {
  @ViewChild('inputElement') inputElement!: ElementRef<HTMLInputElement>;

  readonly geocoding = inject(GeocodingService);
  protected readonly t = injectT();

  // Inputs
  /** The field's hint and name; every caller names its own (worlds.searchPlaceholder, places.searchPlaceholder ...) */
  placeholder = input<string>('');
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
  /** The text last searched for: until Enter or the search button, what is typed is not searched */
  readonly searchedText = signal<string | null>(null);
  readonly hasFocus = signal(false);
  readonly showDropdown = signal(false);
  /** The result the arrow keys stand on, -1 for none */
  readonly activeIndex = signal(-1);
  /** The results the dropdown lists */
  readonly shownResults = computed(() => this.geocoding.results().slice(0, 5));
  /** Each shown hit's second line: kind and where it lies, so hits of one name differ */
  readonly contexts = computed(() => contextLines(this.t(), this.shownResults()));
  readonly dropdownShown = computed(() => this.showDropdown() && this.shownResults().length > 0);

  // Computed search state for status display
  /** The search button and Enter search only a text long enough, and not again while it runs */
  readonly canSearch = computed(() =>
    this.searchText().trim().length >= this.geocoding.MIN_QUERY_LENGTH && !this.geocoding.isLoading());

  readonly searchState = computed<SearchState>(() => {
    const length = this.searchText().length;
    if (this.currentValue()) return 'selected';
    if (this.geocoding.error()) return 'error';
    if (this.geocoding.isLoading()) return 'searching';
    if (length === 0) return 'idle';
    if (length < this.geocoding.MIN_QUERY_LENGTH) return 'too-short';
    if (this.searchedText() !== this.searchText()) return 'ready';
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

  /** Each keystroke in the field ((ngModelChange)): only the text, the results of an earlier search go */
  onSearchChange(query: string): void {
    this.searchText.set(query);
    this.activeIndex.set(-1);
    if (this.searchedText() !== null) {
      this.searchedText.set(null);
      this.geocoding.clearResults();
    }
    this.showDropdown.set(false);
  }

  /** Search for the text in the field: Enter or the search button */
  submitSearch(): void {
    if (!this.canSearch()) return;
    const query = this.searchText();
    this.searchedText.set(query);
    this.activeIndex.set(-1);
    this.geocoding.search(query);
    this.showDropdown.set(true);
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
    this.activeIndex.set(-1);
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

  /**
   * The field by keyboard: Enter searches; with the list open, the arrows walk
   * the results, Enter takes the one stood on (the first when none is),
   * Escape closes the list.
   */
  onKeyDown(event: KeyboardEvent): void {
    const results = this.shownResults();
    if (!this.dropdownShown()) {
      if (event.key === 'ArrowDown' && results.length > 0) {
        this.showDropdown.set(true);
        event.preventDefault();
      } else if (event.key === 'Enter') {
        this.submitSearch();
        event.preventDefault();
        // The dialog behind does not take the Enter
        event.stopPropagation();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        this.activeIndex.set((this.activeIndex() + 1) % results.length);
        break;
      case 'ArrowUp':
        this.activeIndex.set(this.activeIndex() <= 0 ? results.length - 1 : this.activeIndex() - 1);
        break;
      case 'Enter':
        this.selectResult(results[Math.max(0, this.activeIndex())]);
        break;
      case 'Escape':
        this.showDropdown.set(false);
        break;
      default:
        return;
    }
    event.preventDefault();
    // Escape and Enter stop here: the dialog behind keeps open
    event.stopPropagation();
  }

  clearValue(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.searchText.set('');
    this.searchedText.set(null);
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
