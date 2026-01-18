import { Injectable, signal, inject, computed } from '@angular/core';
import { SpawnLocationConfig, FavoriteLocation } from '../models/location.types';
import { GeocodingService } from './geocoding.service';

const FAVORITES_KEY = 'td_favorites_v2';
const MAX_FAVORITES = 10;

/**
 * LocationManagementService - Simplified
 *
 * Only stores coordinates. Names are always resolved via GeocodingService (with cache).
 * URL is the source of truth - this service just holds the current state.
 *
 * IMPORTANT: hq and spawns can be null if no location is set.
 * In this case, the component should show the location dialog.
 */
@Injectable({ providedIn: 'root' })
export class LocationManagementService {
  private readonly geocoding = inject(GeocodingService);

  // Current location (just coordinates) - null means no location set
  readonly hq = signal<{ lat: number; lon: number } | null>(null);
  readonly spawns = signal<{ lat: number; lon: number }[]>([]);

  // Flag: true if no spawn was provided and random spawn should be generated
  readonly needsRandomSpawn = signal<boolean>(false);

  // Display name - resolved async via geocoding
  readonly displayName = signal<string>('Kein Ort');

  // Loading state
  readonly isApplyingLocation = signal(false);

  // Favorites (just coordinates)
  readonly favorites = signal<FavoriteLocation[]>([]);

  // Check if location is set
  readonly hasLocation = computed(() => this.hq() !== null);

  // Computed: editable formats for backwards compatibility
  readonly editableHqLocation = computed(() => {
    const h = this.hq();
    if (!h) return null;
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
    console.log('\n' + '='.repeat(60));
    console.log('📍 LOCATION CHANGE');
    console.log('='.repeat(60));
    console.log(`HQ: ${hq.lat.toFixed(6)}, ${hq.lon.toFixed(6)}`);
    console.log(`Spawns: ${spawns.length} (needsRandom: ${spawns.length === 0})`);
    console.log('='.repeat(60) + '\n');

    this.hq.set(hq);

    if (spawns.length > 0) {
      this.spawns.set(spawns);
      this.needsRandomSpawn.set(false);
    } else {
      // No spawns provided - will be generated randomly after streets are loaded
      this.spawns.set([]);
      this.needsRandomSpawn.set(true);
    }

    this.resolveDisplayName(hq.lat, hq.lon);
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
      if (current && current.lat === lat && current.lon === lon) {
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
    const hq = this.hq();
    if (!hq || this.favorites().length >= MAX_FAVORITES) return;

    const fav: FavoriteLocation = {
      id: crypto.randomUUID(),
      hq: { ...hq },
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

  /**
   * Set spawns after random generation (clears needsRandomSpawn flag)
   */
  setGeneratedSpawns(spawns: { lat: number; lon: number }[]): void {
    this.spawns.set(spawns);
    this.needsRandomSpawn.set(false);
  }

  /**
   * Clear all location data
   */
  reset(): void {
    this.hq.set(null);
    this.spawns.set([]);
    this.needsRandomSpawn.set(false);
    this.displayName.set('Kein Ort');
    this.isApplyingLocation.set(false);
  }
}
