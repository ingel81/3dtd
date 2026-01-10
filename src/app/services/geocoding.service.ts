import { Injectable, signal } from '@angular/core';

export interface GeocodingResult {
  placeId: number;
  displayName: string;
  lat: number;
  lon: number;
  type: string;
  importance: number;
  address?: NominatimAddress;
}

/**
 * Nominatim address details structure
 */
export interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  suburb?: string;
  city_district?: string;
  county?: string;
  state?: string;
  country?: string;
  postcode?: string;
  road?: string;
  house_number?: string;
}

/**
 * Result from reverse geocoding with full address details
 */
export interface ReverseGeocodeResult {
  displayName: string;
  locationName: string;
  address: NominatimAddress;
  lat: number;
  lon: number;
}

/**
 * Geocoding Service using Nominatim (OpenStreetMap) API
 * Provides address search with autocomplete functionality
 */
@Injectable({
  providedIn: 'root',
})
export class GeocodingService {
  private readonly NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
  private readonly DEBOUNCE_MS = 300;
  private readonly MIN_QUERY_LENGTH = 3;
  private readonly MAX_RESULTS = 8;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  readonly isLoading = signal(false);
  readonly results = signal<GeocodingResult[]>([]);
  readonly error = signal<string | null>(null);

  /**
   * Search for addresses with autocomplete
   * Debounced to avoid excessive API calls
   */
  search(query: string): void {
    // Clear previous timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Clear previous request
    if (this.abortController) {
      this.abortController.abort();
    }

    // Reset state for short queries
    if (query.length < this.MIN_QUERY_LENGTH) {
      this.results.set([]);
      this.error.set(null);
      return;
    }

    this.isLoading.set(true);

    this.debounceTimer = setTimeout(() => {
      this.executeSearch(query);
    }, this.DEBOUNCE_MS);
  }

  /**
   * Execute the actual search request
   */
  private async executeSearch(query: string): Promise<void> {
    this.abortController = new AbortController();

    try {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        addressdetails: '1',
        limit: this.MAX_RESULTS.toString(),
        // Prefer results in Germany/Europe
        countrycodes: 'de,at,ch',
      });

      const response = await fetch(`${this.NOMINATIM_URL}/search?${params}`, {
        signal: this.abortController.signal,
        headers: {
          // Nominatim requires a user-agent
          'User-Agent': 'Nervbox-TowerDefense/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`Geocoding failed: ${response.statusText}`);
      }

      const data = await response.json();

      const results: GeocodingResult[] = data.map(
        (item: {
          place_id: number;
          display_name: string;
          lat: string;
          lon: string;
          type: string;
          importance: number;
          address?: NominatimAddress;
        }) => ({
          placeId: item.place_id,
          displayName: item.display_name,
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon),
          type: item.type,
          importance: item.importance,
          address: item.address,
        })
      );

      this.results.set(results);
      this.error.set(null);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request was cancelled, ignore
        return;
      }
      console.error('Geocoding error:', err);
      this.error.set('Adresssuche fehlgeschlagen');
      this.results.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Reverse geocoding: get address from coordinates
   */
  async reverseGeocode(lat: number, lon: number): Promise<string | null> {
    const result = await this.reverseGeocodeDetailed(lat, lon);
    return result?.displayName ?? null;
  }

  /**
   * Reverse geocoding with full address details
   */
  async reverseGeocodeDetailed(lat: number, lon: number): Promise<ReverseGeocodeResult | null> {
    try {
      const params = new URLSearchParams({
        lat: lat.toString(),
        lon: lon.toString(),
        format: 'json',
        addressdetails: '1',
      });

      const response = await fetch(`${this.NOMINATIM_URL}/reverse?${params}`, {
        headers: {
          'User-Agent': 'Nervbox-TowerDefense/1.0',
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      if (!data || data.error) {
        return null;
      }

      return {
        displayName: data.display_name || '',
        locationName: this.extractLocationName(data.address || {}),
        address: data.address || {},
        lat: parseFloat(data.lat),
        lon: parseFloat(data.lon),
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract a human-readable location name from Nominatim address
   * Priority: city > town > village > municipality > suburb > county
   */
  extractLocationName(address: NominatimAddress): string {
    const candidates = [
      address.city,
      address.town,
      address.village,
      address.municipality,
      address.suburb,
      address.city_district,
      address.county,
    ];

    for (const name of candidates) {
      if (name?.trim()) {
        return name.trim();
      }
    }

    return 'Unbekannter Ort';
  }

  /**
   * Clear search results
   */
  clearResults(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.abortController) {
      this.abortController.abort();
    }
    this.results.set([]);
    this.error.set(null);
    this.isLoading.set(false);
  }
}
