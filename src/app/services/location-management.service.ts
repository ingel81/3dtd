import { Injectable, signal, inject, computed } from '@angular/core';
import { SpawnLocationConfig, FavoriteLocation } from '../models/location.types';
import { GeocodingService } from './geocoding.service';

/**
 * Default locations (Erlenbach, Germany)
 */
export const DEFAULT_HQ = { lat: 49.17326887448299, lon: 9.268588397188681 };
export const DEFAULT_SPAWN = { lat: 49.17554723547113, lon: 9.263870533891945 };

// Legacy exports for backwards compatibility
export const DEFAULT_BASE_COORDS = { latitude: DEFAULT_HQ.lat, longitude: DEFAULT_HQ.lon };
export const DEFAULT_SPAWN_POINTS = [{ id: 'spawn-north', name: 'Nord', latitude: DEFAULT_SPAWN.lat, longitude: DEFAULT_SPAWN.lon }];

const FAVORITES_KEY = 'td_favorites_v2';
const MAX_FAVORITES = 10;

/**
 * LocationManagementService - Simplified
 *
 * Only stores coordinates. Names are always resolved via GeocodingService (with cache).
 * URL is the source of truth - this service just holds the current state.
 */
@Injectable({ providedIn: 'root' })
export class LocationManagementService {
  private readonly geocoding = inject(GeocodingService);

  // Current location (just coordinates)
  readonly hq = signal<{ lat: number; lon: number }>(DEFAULT_HQ);
  readonly spawns = signal<{ lat: number; lon: number }[]>([DEFAULT_SPAWN]);

  // Display name - resolved async via geocoding
  readonly displayName = signal<string>('Laden...');

  // Loading state
  readonly isApplyingLocation = signal(false);

  // Favorites (just coordinates)
  readonly favorites = signal<FavoriteLocation[]>([]);

  // Computed: editable formats for backwards compatibility
  readonly editableHqLocation = computed(() => {
    const h = this.hq();
    return { lat: h.lat, lon: h.lon, name: this.displayName() };
  });

  readonly editableSpawnLocations = computed(() => {
    return this.spawns().map((s, i) => ({
      id: `spawn-${i + 1}`,
      lat: s.lat,
      lon: s.lon,
    } as SpawnLocationConfig));
  });

  constructor() {
    this.loadFavorites();
  }

  // ==================== LOCATION ====================

  /**
   * Set current location and resolve display name
   */
  setLocation(hq: { lat: number; lon: number }, spawns: { lat: number; lon: number }[]): void {
    this.hq.set(hq);
    this.spawns.set(spawns.length > 0 ? spawns : [{ lat: hq.lat + 0.005, lon: hq.lon }]);
    this.resolveDisplayName(hq.lat, hq.lon);
  }

  /**
   * Reset to default location
   */
  resetToDefaults(): void {
    this.setLocation(DEFAULT_HQ, [DEFAULT_SPAWN]);
  }

  /**
   * Get display name (for header)
   */
  getLocationDisplayName(): string {
    return this.displayName();
  }

  /**
   * Resolve display name via reverse geocoding
   */
  private async resolveDisplayName(lat: number, lon: number): Promise<void> {
    this.displayName.set('Laden...');

    try {
      const result = await this.geocoding.reverseGeocodeDetailed(lat, lon);
      // Only update if coords haven't changed
      const current = this.hq();
      if (current.lat === lat && current.lon === lon) {
        if (result?.address) {
          this.displayName.set(this.geocoding.formatAddressShort(result.address));
        } else {
          this.displayName.set(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
        }
      }
    } catch {
      this.displayName.set(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    }
  }

  // ==================== FAVORITES ====================

  /**
   * Load favorites from localStorage
   */
  loadFavorites(): void {
    try {
      const data = localStorage.getItem(FAVORITES_KEY);
      if (data) {
        this.favorites.set(JSON.parse(data));
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Save current location as favorite
   */
  saveFavorite(): void {
    if (this.favorites().length >= MAX_FAVORITES) return;

    const fav: FavoriteLocation = {
      id: crypto.randomUUID(),
      hq: { ...this.hq() },
      spawns: this.spawns().map(s => ({ ...s })),
      createdAt: Date.now(),
    };

    this.favorites.update(favs => [...favs, fav]);
    this.persistFavorites();
  }

  /**
   * Delete a favorite
   */
  deleteFavorite(id: string): void {
    this.favorites.update(favs => favs.filter(f => f.id !== id));
    this.persistFavorites();
  }

  /**
   * Get display name for a favorite (async, uses cache)
   */
  async getFavoriteDisplayName(fav: FavoriteLocation): Promise<string> {
    return this.geocoding.reverseGeocodeWithCache(fav.hq.lat, fav.hq.lon);
  }

  private persistFavorites(): void {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(this.favorites()));
    } catch {
      // Ignore
    }
  }

  // ==================== LEGACY COMPATIBILITY ====================

  getCurrentHqLocation() { return this.editableHqLocation(); }
  getCurrentSpawnLocations() { return this.editableSpawnLocations(); }
  setApplyingLocation(v: boolean) { this.isApplyingLocation.set(v); }

  // These are now handled by setLocation()
  initializeEditableLocations() { /* no-op, handled by component */ }
  saveLocationsToStorage() { /* no-op, URL is source of truth */ }
  clearLocationsFromStorage() { /* no-op */ }

  reset(): void {
    this.hq.set(DEFAULT_HQ);
    this.spawns.set([DEFAULT_SPAWN]);
    this.displayName.set('Erlenbach');
    this.isApplyingLocation.set(false);
  }
}
