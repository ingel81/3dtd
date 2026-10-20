import { Injectable, signal } from '@angular/core';
import { readJson, writeJson } from '../../utils/storage';
import { injectT } from '../../i18n/i18n.service';

/** A search or reverse lookup without an answer for this long fails, ms (it showed "Searching..." until the browser gave up) */
const GEOCODE_TIMEOUT_MS = 10_000;
/** Nominatim's usage policy: at most one request a second, so a search waits out what is left of the last one's */
const MIN_REQUEST_GAP_MS = 1000;
/** Searches answered this session, by query: asking the same twice is against the policy */
const SEARCH_CACHE_SIZE = 50;

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
 * Fallback name when Nominatim returns nothing usable. The menu's place picker
 * compares against it to fall back to the HQ name or coordinates.
 */
export const UNKNOWN_LOCATION_NAME = 'Unknown location';

/**
 * Geocoding Service using Nominatim (OpenStreetMap) API: address search and
 * reverse lookup. A search runs only when the player asks for it (Enter or the
 * search button), never as they type: Nominatim's usage policy forbids
 * search-as-you-type on its API. Answers are cached, and requests keep a
 * second apart.
 */
@Injectable({
  providedIn: 'root',
})
export class GeocodingService {
  private readonly t = injectT();
  private readonly NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
  readonly MIN_QUERY_LENGTH = 3;
  private readonly MAX_RESULTS = 8;
  private readonly REVERSE_CACHE_KEY = 'td_geocode_cache_v1';

  private abortController: AbortController | null = null;
  /** When the last search went out, ms (performance.now) */
  private lastRequestAt = -Infinity;
  private readonly searchCache = new Map<string, GeocodingResult[]>();

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
    // Anything else than [key, name] pairs starts with an empty cache
    const cached = readJson(this.REVERSE_CACHE_KEY);
    if (!Array.isArray(cached)) return;
    const entries = cached.filter((e): e is [string, string] =>
      Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string');
    this.reverseCache = new Map(entries);
  }

  /**
   * Save reverse geocode cache to localStorage
   */
  private saveCacheToStorage(): void {
    // Limit to 100 entries to prevent localStorage bloat
    writeJson(this.REVERSE_CACHE_KEY, Array.from(this.reverseCache.entries()).slice(-100));
  }

  /**
   * Get cache key for reverse geocoding (4 decimal places for ~11m precision)
   */
  private getReverseCacheKey(lat: number, lon: number): string {
    return `${lat.toFixed(4)},${lon.toFixed(4)}`;
  }

  /**
   * Search for an address, when the player asks for it. A query under
   * MIN_QUERY_LENGTH characters clears the results; one asked before comes
   * from the cache; a newer search cancels one still running.
   */
  search(query: string): void {
    this.abortController?.abort();
    const key = query.trim().toLowerCase();
    if (key.length < this.MIN_QUERY_LENGTH) {
      this.results.set([]);
      this.error.set(null);
      this.isLoading.set(false);
      return;
    }
    const cached = this.searchCache.get(key);
    if (cached) {
      this.results.set(cached);
      this.error.set(null);
      this.isLoading.set(false);
      return;
    }
    this.isLoading.set(true);
    void this.executeSearch(query.trim(), key);
  }

  /**
   * Execute the actual search request
   */
  private async executeSearch(query: string, key: string): Promise<void> {
    const controller = new AbortController();
    this.abortController = controller;

    try {
      const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      if (controller.signal.aborted) return;
      this.lastRequestAt = performance.now();

      const params = new URLSearchParams({
        q: query,
        format: 'json',
        addressdetails: '1',
        limit: this.MAX_RESULTS.toString(),
      });

      const response = await fetch(`${this.NOMINATIM_URL}/search?${params}`, {
        // A newer search cancels it; a server that does not answer ends it after a while (TimeoutError, shown)
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(GEOCODE_TIMEOUT_MS)]),
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

      this.searchCache.set(key, results);
      if (this.searchCache.size > SEARCH_CACHE_SIZE) this.searchCache.delete(this.searchCache.keys().next().value!);
      this.results.set(results);
      this.error.set(null);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request was cancelled, ignore
        return;
      }
      console.error('Geocoding error:', err);
      this.error.set(this.t().places.searchFailed);
      this.results.set([]);
    } finally {
      // A newer search keeps loading
      if (this.abortController === controller) this.isLoading.set(false);
    }
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
        signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
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

    return UNKNOWN_LOCATION_NAME;
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
   * Format address as "Street 123, City, Country" (same format everywhere).
   * The country is part of it since 2026-09-20: a city name alone says little
   * about where in the world the player stands, and the dice sends them
   * anywhere.
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

    if (addr.country) {
      parts.push(addr.country);
    }

    return parts.length > 0 ? parts.join(', ') : UNKNOWN_LOCATION_NAME;
  }

  /**
   * Clear search results
   */
  clearResults(): void {
    this.abortController?.abort();
    this.results.set([]);
    this.error.set(null);
    this.isLoading.set(false);
  }
}
