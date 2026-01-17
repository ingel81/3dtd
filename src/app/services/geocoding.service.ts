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
  private readonly REVERSE_CACHE_KEY = 'td_geocode_cache_v1';

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  // Reverse geocoding cache (memory + localStorage)
  private reverseCache = new Map<string, string>();

  readonly isLoading = signal(false);
  readonly results = signal<GeocodingResult[]>([]);
  readonly error = signal<string | null>(null);

  constructor() {
    this.loadCacheFromStorage();
  }

  /**
   * Load reverse geocode cache from localStorage
   */
  private loadCacheFromStorage(): void {
    try {
      const cached = localStorage.getItem(this.REVERSE_CACHE_KEY);
      if (cached) {
        const entries = JSON.parse(cached) as [string, string][];
        this.reverseCache = new Map(entries);
      }
    } catch {
      // Ignore parse errors, start with empty cache
    }
  }

  /**
   * Save reverse geocode cache to localStorage
   */
  private saveCacheToStorage(): void {
    try {
      const entries = Array.from(this.reverseCache.entries());
      // Limit to 100 entries to prevent localStorage bloat
      const limited = entries.slice(-100);
      localStorage.setItem(this.REVERSE_CACHE_KEY, JSON.stringify(limited));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Get cache key for reverse geocoding (4 decimal places for ~11m precision)
   */
  private getReverseCacheKey(lat: number, lon: number): string {
    return `${lat.toFixed(4)},${lon.toFixed(4)}`;
  }

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
   * Reverse geocoding with cache and retry logic
   * Returns cached name or fetches from API with retry on rate limit
   * @param lat Latitude
   * @param lon Longitude
   * @returns Location name as "Street, City" or coordinate string as fallback
   */
  async reverseGeocodeWithCache(lat: number, lon: number): Promise<string> {
    const cacheKey = this.getReverseCacheKey(lat, lon);

    // Check memory cache first
    const cached = this.reverseCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch with retry
    try {
      const result = await this.reverseGeocodeDetailed(lat, lon);
      if (result?.address) {
        const name = this.formatAddressShort(result.address);
        this.reverseCache.set(cacheKey, name);
        this.saveCacheToStorage();
        return name;
      }
    } catch {
      // Fall through to fallback
    }

    // Fallback: return coordinates as string
    const fallback = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    return fallback;
  }

  /**
   * Format address as "Street 123, City" (same format everywhere)
   */
  formatAddressShort(addr: NominatimAddress): string {
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

    return parts.length > 0 ? parts.join(', ') : 'Unbekannter Ort';
  }

  /**
   * Fetch with exponential backoff retry on rate limit (HTTP 429)
   * @param url URL to fetch
   * @param retries Number of retry attempts
   * @returns Response
   */
  private async fetchWithRetry(url: string, retries = 3): Promise<Response> {
    const delays = [1000, 2000, 4000];

    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Nervbox-TowerDefense/1.0',
        },
      });

      if (response.status === 429 && attempt < retries) {
        // Rate limited, wait and retry
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
        continue;
      }

      return response;
    }

    throw new Error('Max retries exceeded');
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
