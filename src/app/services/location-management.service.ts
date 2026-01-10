import { Injectable, signal } from '@angular/core';
import { LocationConfig, SpawnLocationConfig } from '../models/location.types';

/**
 * Default locations (Erlenbach, Germany)
 */
export const DEFAULT_BASE_COORDS = {
  latitude: 49.17326887448299,
  longitude: 9.268588397188681,
};

export const DEFAULT_SPAWN_POINTS = [
  {
    id: 'spawn-north',
    name: 'Nord',
    latitude: 49.17554723547113,
    longitude: 9.263870533891945,
  },
];

/** LocalStorage key for saved locations */
const LOCATION_STORAGE_KEY = 'td_custom_locations_v1';

/**
 * LocationManagementService
 *
 * Manages game location settings (HQ and spawn points).
 * Handles loading/saving from/to localStorage and provides editable location state.
 */
@Injectable({ providedIn: 'root' })
export class LocationManagementService {
  // ========================================
  // SIGNALS
  // ========================================

  /** Editable HQ location (for debug panel and location dialog) */
  readonly editableHqLocation = signal<LocationConfig | null>(null);

  /** Editable spawn locations (for debug panel and location dialog) */
  readonly editableSpawnLocations = signal<SpawnLocationConfig[]>([]);

  /** Currently applying location change (loading state) */
  readonly isApplyingLocation = signal(false);

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize editable locations from localStorage or defaults
   * Should be called in ngOnInit of the component
   */
  initializeEditableLocations(): void {
    // Try to load from localStorage
    const savedLocations = this.loadLocationsFromStorage();

    if (savedLocations && savedLocations.hq) {
      this.editableHqLocation.set(savedLocations.hq);
      this.editableSpawnLocations.set(savedLocations.spawns);
    } else {
      // Initialize from defaults
      this.editableHqLocation.set({
        lat: DEFAULT_BASE_COORDS.latitude,
        lon: DEFAULT_BASE_COORDS.longitude,
        name: 'Erlenbach (Default)',
      });

      // Convert spawn points to editable format
      const editableSpawns: SpawnLocationConfig[] = DEFAULT_SPAWN_POINTS.map((sp) => ({
        id: sp.id,
        lat: sp.latitude,
        lon: sp.longitude,
        name: sp.name,
      }));
      this.editableSpawnLocations.set(editableSpawns);
    }
  }

  /**
   * Get current HQ location
   */
  getCurrentHqLocation(): LocationConfig | null {
    return this.editableHqLocation();
  }

  /**
   * Get current spawn locations
   */
  getCurrentSpawnLocations(): SpawnLocationConfig[] {
    return this.editableSpawnLocations();
  }

  /**
   * Update HQ location
   * @param location New HQ location
   */
  updateHqLocation(location: LocationConfig): void {
    this.editableHqLocation.set(location);
  }

  /**
   * Update spawn locations
   * @param spawns New spawn locations
   */
  updateSpawnLocations(spawns: SpawnLocationConfig[]): void {
    this.editableSpawnLocations.set(spawns);
  }

  /**
   * Set applying location state
   * @param isApplying Whether location change is in progress
   */
  setApplyingLocation(isApplying: boolean): void {
    this.isApplyingLocation.set(isApplying);
  }

  // ========================================
  // LOCAL STORAGE
  // ========================================

  /**
   * Save current locations to localStorage
   */
  saveLocationsToStorage(): void {
    const data = {
      hq: this.editableHqLocation(),
      spawns: this.editableSpawnLocations(),
    };
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(data));
  }

  /**
   * Load locations from localStorage
   * @returns Saved locations or null if not found
   */
  loadLocationsFromStorage(): { hq: LocationConfig | null; spawns: SpawnLocationConfig[] } | null {
    try {
      const data = localStorage.getItem(LOCATION_STORAGE_KEY);
      if (!data) return null;
      const parsed = JSON.parse(data);
      return parsed;
    } catch (err) {
      console.error('[LocationMgmt] Failed to load locations from localStorage:', err);
      return null;
    }
  }

  /**
   * Clear saved locations from localStorage
   */
  clearLocationsFromStorage(): void {
    localStorage.removeItem(LOCATION_STORAGE_KEY);
  }

  /**
   * Reset to default locations
   */
  resetToDefaults(): void {
    this.editableHqLocation.set({
      lat: DEFAULT_BASE_COORDS.latitude,
      lon: DEFAULT_BASE_COORDS.longitude,
      name: 'Erlenbach (Default)',
    });

    const editableSpawns: SpawnLocationConfig[] = DEFAULT_SPAWN_POINTS.map((sp) => ({
      id: sp.id,
      lat: sp.latitude,
      lon: sp.longitude,
      name: sp.name,
    }));
    this.editableSpawnLocations.set(editableSpawns);

    this.clearLocationsFromStorage();
  }

  /**
   * Get smart location name for display
   * Extracts city/street name from full address
   */
  getLocationDisplayName(): string {
    const hq = this.editableHqLocation();
    if (!hq) return 'Erlenbach';

    // Try to build smart name from structured address
    const name = hq.name || '';

    // If name contains comma, take first part (usually city/street)
    if (name.includes(',')) {
      return name.split(',')[0].trim();
    }

    // If name is very long (> 30 chars), truncate
    if (name.length > 30) {
      return name.substring(0, 27) + '...';
    }

    return name || 'Unbekannt';
  }

  // ========================================
  // VALIDATION
  // ========================================

  /**
   * Validate location coordinates
   * @param lat Latitude
   * @param lon Longitude
   * @returns True if coordinates are valid
   */
  validateCoordinates(lat: number, lon: number): boolean {
    return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  /**
   * Check if location has valid coordinates
   * @param location Location to check
   * @returns True if location is valid
   */
  isLocationValid(location: LocationConfig | null): boolean {
    if (!location) return false;
    return this.validateCoordinates(location.lat, location.lon);
  }

  // ========================================
  // CLEANUP
  // ========================================

  /**
   * Reset service state
   */
  reset(): void {
    this.editableHqLocation.set(null);
    this.editableSpawnLocations.set([]);
    this.isApplyingLocation.set(false);
  }
}
