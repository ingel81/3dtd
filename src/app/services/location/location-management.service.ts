import { Injectable, signal, inject, computed, effect, untracked } from '@angular/core';
import { SpawnLocationConfig, FavoriteLocation } from '../../models/location.types';
import { GeocodingService, NominatimAddress } from './geocoding.service';
import { MissionInfo } from '../../components/loading-screen/boot-step.model';
import { DEV_WORLD_ORIGIN } from '../../devworld/devworld.service';
import {
  RecentLocation,
  addRecentLocation,
  loadRecentLocations,
  saveRecentLocations,
} from './recent-locations';

const FAVORITES_KEY = 'td_favorites_v2';
const MAX_FAVORITES = 10;
/** Header text while no location is set */
const NO_LOCATION_NAME = 'No location';
/** Header text while the reverse geocode of a new HQ runs */
const LOADING_NAME = 'Loading...';

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
  readonly displayName = signal<string>(NO_LOCATION_NAME);

  // Structured address (road, postcode, city) — resolved async via geocoding,
  // needed by the loading screen's mission strip which renders each part on
  // its own line. Null until the first reverse-geocode completes.
  readonly address = signal<NominatimAddress | null>(null);

  // Composed mission info for the loading screen. Combines current HQ coords
  // with the latest resolved address — null until both are available.
  readonly missionInfo = computed<MissionInfo | null>(() => {
    const hq = this.hq();
    if (!hq) return null;
    const addr = this.address();
    const street = addr?.road
      ? (addr.house_number ? `${addr.road} ${addr.house_number}` : addr.road)
      : '';
    const city = addr?.city ?? addr?.town ?? addr?.village ?? addr?.municipality ?? '';
    return {
      address: street,
      postal: addr?.postcode ?? '',
      city,
      lat: hq.lat,
      lng: hq.lon,
    };
  });

  // Loading state
  readonly isApplyingLocation = signal(false);

  // Favorites (just coordinates)
  readonly favorites = signal<FavoriteLocation[]>([]);

  /** Places played lately, newest first (localStorage td_recent_locations_v1) */
  readonly recents = signal<RecentLocation[]>([]);

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
    this.recents.set(loadRecentLocations());
    this.trackRecents();
  }

  // ==================== LOCATION ====================

  /**
   * Set current location and resolve display name
   */
  setLocation(hq: { lat: number; lon: number }, spawns: { lat: number; lon: number }[]): void {

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
    this.displayName.set(LOADING_NAME);
    this.address.set(null);

    try {
      const result = await this.geocoding.reverseGeocodeDetailed(lat, lon);
      // Only update if coords haven't changed
      const current = this.hq();
      if (current && current.lat === lat && current.lon === lon) {
        if (result?.address) {
          this.displayName.set(this.geocoding.formatAddressShort(result.address));
          this.address.set(result.address);
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

  // ==================== RECENT LOCATIONS ====================

  /**
   * Remember every location once it is complete: HQ, a spawn and a resolved
   * name. That covers every way in (URL, geolocation, dialog, favorite, World
   * Dice, moving the HQ) without hooking each one. A new spawn at the same HQ
   * updates that entry, see addRecentLocation().
   */
  private trackRecents(): void {
    try {
      effect(() => {
        const hq = this.hq();
        const spawns = this.spawns();
        const name = this.displayName();
        if (!hq || spawns.length === 0 || name === NO_LOCATION_NAME || name === LOADING_NAME) return;
        untracked(() => this.recordRecent(hq, spawns, name));
      });
    } catch {
      // Outside an injection context (unit tests): not tracked
    }
  }

  /** Put a location on top of the recent list and persist it. DevWorld's fake origin is skipped. */
  recordRecent(
    hq: { lat: number; lon: number },
    spawns: { lat: number; lon: number }[],
    name: string,
  ): void {
    if (hq.lat === DEV_WORLD_ORIGIN.lat && hq.lon === DEV_WORLD_ORIGIN.lon) return;
    const next = addRecentLocation(this.recents(), {
      hq: { lat: hq.lat, lon: hq.lon },
      spawns: spawns.map((s) => ({ lat: s.lat, lon: s.lon })),
      name,
      visitedAt: Date.now(),
    });
    this.recents.set(next);
    saveRecentLocations(next);
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
    this.displayName.set(NO_LOCATION_NAME);
    this.isApplyingLocation.set(false);
  }
}
