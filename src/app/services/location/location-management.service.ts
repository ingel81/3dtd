import { Injectable, signal, inject, computed, effect, untracked, isDevMode } from '@angular/core';
import { SpawnLocationConfig, FavoriteLocation, SavedSpawn } from '../../models/location.types';
import { GeocodingService, NominatimAddress } from './geocoding.service';
import { MissionInfo } from '../../components/loading-screen/boot-step.model';
import { DEV_WORLD_ORIGIN } from '../../devworld/devworld.service';
import { COORD_DECIMALS, canonicalCoords } from '../../utils/geo-utils';
import { PathAndRouteService } from '../world/path-route.service';
import {
  RecentLocation,
  addRecentLocation,
  loadRecentLocations,
  saveRecentLocations,
} from './recent-locations';
import {
  loadFavoriteLocations,
  moveFavoriteLocation,
  normalizeFavoriteName,
  renameFavoriteLocation,
  saveFavoriteLocations,
} from './favorite-locations';

/** Header text while no location is set */
export const NO_LOCATION_NAME = 'No location';
/** Header text while the reverse geocode of a new HQ runs */
export const LOADING_NAME = 'Loading...';

/**
 * `__showcase.line()`'s output: a ready-to-paste ShowcaseLocation snippet
 * (id/name/hint left as 'TODO') for the current HQ and its first spawn, in
 * the format showcase-locations.config.ts uses. `null` hq (no location
 * loaded) prints a message instead.
 */
export function formatShowcaseLine(hq: { lat: number; lon: number } | null, spawn: SavedSpawn | undefined): string {
  if (!hq) return 'No location loaded.';
  const at = (p: { lat: number; lon: number }) =>
    `lat: ${p.lat.toFixed(COORD_DECIMALS)}, lon: ${p.lon.toFixed(COORD_DECIMALS)}`;
  const bearing = spawn?.portalBearing === undefined ? '' : `, portalBearing: ${spawn.portalBearing.toFixed(1)}`;
  const spawnPart = spawn ? `, spawn: { ${at(spawn)}${bearing} }` : '';
  return `{ id: 'TODO', name: 'TODO', hint: 'TODO', ${at(hq)}${spawnPart} }`;
}

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
  private readonly pathRoute = inject(PathAndRouteService);

  // Current location (just coordinates) - null means no location set
  readonly hq = signal<{ lat: number; lon: number } | null>(null);
  /** With the bearing of each portal the player turned, see SavedSpawn */
  readonly spawns = signal<SavedSpawn[]>([]);

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
      portalBearing: s.portalBearing,
    } as SpawnLocationConfig));
  });

  constructor() {
    this.loadFavorites();
    this.recents.set(loadRecentLocations());
    this.trackRecents();
    this.installShowcaseConsole();
  }

  /**
   * `__showcase.line()` in DevTools: prints and returns a ready-to-paste
   * snippet for the current place, so a playtester can hand over new
   * showcase entries without typing coordinates by hand. Dev only, like
   * `__footprintDebug` (TowerPlacementService).
   */
  private installShowcaseConsole(): void {
    if (!isDevMode() || typeof window === 'undefined') return;
    (globalThis as Record<string, unknown>)['__showcase'] = {
      line: (): string => {
        const line = formatShowcaseLine(this.hq(), this.spawns()[0]);
        console.log(line);
        return line;
      },
    };
  }

  // ==================== LOCATION ====================

  /**
   * Set current location and resolve display name. HQ and spawns are kept
   * in their canonical form (canonicalCoords), however many digits they
   * came with: the URL, favorites, recent places and the world map store
   * the place as the game plays it.
   * @param spawns With the bearing of each portal the player turned (SavedSpawn); URL and favorites take it from here
   */
  setLocation(hq: { lat: number; lon: number }, spawns: SavedSpawn[]): void {
    const at = canonicalCoords(hq);
    this.hq.set(at);

    if (spawns.length > 0) {
      this.spawns.set(spawns.map((spawn) => canonicalCoords(spawn)));
      this.needsRandomSpawn.set(false);
    } else {
      // No spawns provided - will be generated randomly after streets are loaded
      this.spawns.set([]);
      this.needsRandomSpawn.set(true);
    }

    this.resolveDisplayName(at.lat, at.lon);
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
   * Load favorites from localStorage (td_favorites_v2), see loadFavoriteLocations
   */
  loadFavorites(): void {
    this.favorites.set(loadFavoriteLocations());
  }

  /**
   * Save the current location as a favorite at the end of the list. There
   * is no limit; the list in the header scrolls.
   * @param name Name for it; empty leaves the name to the geocoding cache
   */
  saveFavorite(name?: string): void {
    const hq = this.hq();
    if (!hq) return;

    const normalized = normalizeFavoriteName(name);
    const fav: FavoriteLocation = {
      id: crypto.randomUUID(),
      hq: { ...hq },
      spawns: this.spawns().map(s => ({ ...s })),
      createdAt: Date.now(),
      ...(normalized ? { name: normalized } : {}),
    };

    this.favorites.update(favs => [...favs, fav]);
    this.persistFavorites();
  }

  /** Rename a favorite; an empty name falls back to the geocoded one. */
  renameFavorite(id: string, name: string): void {
    this.favorites.update(favs => renameFavoriteLocation(favs, id, name));
    this.persistFavorites();
  }

  /** Move a favorite `offset` places in the list (-1 up, 1 down), stopped at either end. */
  moveFavorite(id: string, offset: number): void {
    this.favorites.update(favs => moveFavoriteLocation(favs, id, offset));
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
    saveFavoriteLocations(this.favorites());
  }

  // ==================== RECENT LOCATIONS ====================

  /**
   * The location as it goes on the recent list, once it is playable: HQ, a
   * spawn, a resolved name, and a route between spawn and HQ. A place whose
   * route fails stays off the list. Null until then.
   */
  readonly recentCandidate = computed(() => {
    const hq = this.hq();
    const spawns = this.spawns();
    const name = this.displayName();
    if (!hq || spawns.length === 0 || name === NO_LOCATION_NAME || name === LOADING_NAME) return null;
    if (!this.pathRoute.hasRoutes()) return null;
    return { hq, spawns, name };
  });

  /**
   * Remember every location once it is playable (recentCandidate). That covers
   * every way in (URL, geolocation, dialog, favorite, World Dice, moving the
   * HQ) without hooking each one: each clears the old routes before it sets
   * the new place. A new spawn at the same HQ updates that entry, see
   * addRecentLocation().
   */
  private trackRecents(): void {
    try {
      effect(() => {
        const candidate = this.recentCandidate();
        if (!candidate) return;
        untracked(() => this.recordRecent(candidate.hq, candidate.spawns, candidate.name));
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

  /**
   * Set spawns after random generation (clears needsRandomSpawn flag), in
   * their canonical form like setLocation()
   */
  setGeneratedSpawns(spawns: { lat: number; lon: number }[]): void {
    this.spawns.set(spawns.map((spawn) => canonicalCoords(spawn)));
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
