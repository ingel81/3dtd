import { Injectable } from '@angular/core';
import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { TERRAIN_PRESETS, TerrainPreset } from './terrain-presets';

/**
 * DevWorld Configuration
 *
 * All settings can be controlled via URL parameters:
 * - ?devworld              - Activates DevWorld mode
 * - ?devworld&terrain=hills - Terrain preset (flat, default, hills, valleys)
 * - ?devworld&buildings=dense - Building preset (none, sparse, dense, maze)
 * - ?devworld&spawn=north  - Spawn point (north, south, east, west, random)
 * - ?devworld&spawns=2     - Spawns of the street generator, 1 to 4 (default 1): lanes for a coop test
 */
export interface DevWorldConfig {
  /** Terrain heightmap preset */
  terrain: TerrainPreset;

  /** Building layout preset */
  buildings: 'none' | 'sparse' | 'dense' | 'maze';

  /** Spawn point location */
  spawn: 'north' | 'south' | 'east' | 'west' | 'random';

  /** Seed for reproducible generation (terrain, streets, buildings) */
  seed: number;

  /**
   * How many of the street generator's spawns the map gets, 1 to 4. One by
   * default: bots and measurements play the game that ships, one approach
   * route. More give coop a lane per player.
   */
  spawnCount: number;
}

/** Most spawns the street generator emits */
export const DEV_WORLD_MAX_SPAWNS = 4;

/**
 * DevWorld Constants
 */
export const DEV_WORLD_SIZE = 1000; // meters (1km x 1km play area)
export const DEV_WORLD_HEIGHTMAP_SIZE = 1024; // pixels (~1m resolution)
export const DEV_WORLD_MAX_HEIGHT = 150; // meters - dramatic terrain!

/**
 * Fake origin for DevWorld (somewhere in the ocean, unlikely to conflict)
 * All geo-coordinates in DevWorld are relative to this point
 */
export const DEV_WORLD_ORIGIN = {
  lat: 0.0,
  lon: 0.0,
  height: 0,
};

/**
 * Default seed for reproducible DevWorld generation.
 * Always use this when no seed is specified in URL.
 */
export const DEV_WORLD_DEFAULT_SEED = 42;

/**
 * Spawn point locations in local coordinates (meters from origin)
 *
 * Coordinate convention (same as EllipsoidSync):
 * - -X = East, +X = West
 * - +Z = North, -Z = South
 *
 * Spawns are positioned on outer streets to create long routes
 * through the 1km x 1km play area.
 */
export const DEV_WORLD_SPAWNS: Record<string, { x: number; z: number }> = {
  north: { x: 200, z: 400 },    // Intersection col-w1 × row-n2
  south: { x: -200, z: -400 },  // Intersection col-e1 × row-s2
  east: { x: -400, z: 200 },    // Intersection col-e2 × row-n1
  west: { x: 400, z: -200 },    // Intersection col-w2 × row-s1
};

@Injectable({
  providedIn: 'root',
})
export class DevWorldService {
  /** Whether DevWorld mode is active */
  readonly isActive: boolean;

  /** DevWorld configuration from URL parameters */
  readonly config: DevWorldConfig;

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.isActive = params.has('devworld');

    if (this.isActive) {
      const rawTerrain = params.get('terrain');
      this.config = {
        terrain: this.parseTerrainParam(rawTerrain),
        buildings: this.parseBuildingsParam(params.get('buildings')),
        spawn: this.parseSpawnParam(params.get('spawn')),
        seed: this.parseSeedParam(params.get('seed')),
        spawnCount: this.parseSpawnCountParam(params.get('spawns')),
      };

      // Update URL to show resolved defaults (e.g. ?devworld -> ?devworld&terrain=flat&seed=42)
      this.updateUrl();
    } else {
      // Default config (not used when inactive, but keep consistent)
      this.config = {
        terrain: 'flat',
        buildings: 'dense',
        spawn: 'north',
        seed: DEV_WORLD_DEFAULT_SEED,
        spawnCount: 1,
      };
    }
  }

  /**
   * Get spawn position in local coordinates
   */
  getSpawnPosition(): { x: number; z: number } {
    if (this.config.spawn === 'random') {
      const spawns = Object.values(DEV_WORLD_SPAWNS);
      return spawns[Math.floor(Math.random() * spawns.length)];
    }
    return DEV_WORLD_SPAWNS[this.config.spawn] || DEV_WORLD_SPAWNS['north'];
  }

  /**
   * Convert local coordinates to fake geo coordinates
   *
   * Uses same convention as EllipsoidSync:
   * - -X = East, +X = West
   * - +Z = North, -Z = South
   * - 1 degree lat ≈ 111320m at equator
   */
  localToGeo(x: number, z: number): { lat: number; lon: number } {
    return {
      lat: DEV_WORLD_ORIGIN.lat + z / METERS_PER_DEGREE_LAT,
      lon: DEV_WORLD_ORIGIN.lon - x / METERS_PER_DEGREE_LAT, // -X = East = +lon
    };
  }

  /**
   * Convert fake geo coordinates to local coordinates
   *
   * Uses same convention as EllipsoidSync:
   * - -X = East, +X = West
   * - +Z = North, -Z = South
   */
  geoToLocal(lat: number, lon: number): { x: number; z: number } {
    return {
      x: -(lon - DEV_WORLD_ORIGIN.lon) * METERS_PER_DEGREE_LAT, // +lon = East = -X
      z: (lat - DEV_WORLD_ORIGIN.lat) * METERS_PER_DEGREE_LAT,
    };
  }

  /**
   * Check if coordinates are within DevWorld bounds
   */
  isInBounds(x: number, z: number): boolean {
    const halfSize = DEV_WORLD_SIZE / 2;
    return Math.abs(x) <= halfSize && Math.abs(z) <= halfSize;
  }

  /**
   * Get the URL to share DevWorld with current config
   */
  getShareUrl(): string {
    const params = new URLSearchParams();
    params.set('devworld', '');
    params.set('terrain', this.config.terrain);
    params.set('seed', String(this.config.seed));

    if (this.config.buildings !== 'dense') {
      params.set('buildings', this.config.buildings);
    }
    if (this.config.spawn !== 'north') {
      params.set('spawn', this.config.spawn);
    }
    if (this.config.spawnCount !== 1) {
      params.set('spawns', String(this.config.spawnCount));
    }

    const base = window.location.origin + window.location.pathname;
    return `${base}?${params.toString()}`;
  }

  private parseTerrainParam(value: string | null): TerrainPreset {
    if (value && (TERRAIN_PRESETS as readonly string[]).includes(value)) {
      return value as TerrainPreset;
    }
    return 'flat'; // Default: flat terrain for deterministic testing
  }

  private parseBuildingsParam(value: string | null): DevWorldConfig['buildings'] {
    if (value === 'none' || value === 'sparse' || value === 'maze') {
      return value;
    }
    return 'dense'; // Default: dense buildings
  }

  private parseSpawnParam(value: string | null): DevWorldConfig['spawn'] {
    if (value === 'south' || value === 'east' || value === 'west' || value === 'random') {
      return value;
    }
    return 'north';
  }

  private parseSpawnCountParam(value: string | null): number {
    const count = Number(value);
    return Number.isInteger(count) && count >= 1 ? Math.min(count, DEV_WORLD_MAX_SPAWNS) : 1;
  }

  private parseSeedParam(value: string | null): number {
    if (value) {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        return parsed;
      }
    }
    // Use fixed seed for reproducible DevWorld
    return DEV_WORLD_DEFAULT_SEED;
  }

  /**
   * Update configuration and URL parameters.
   * Call this when changing settings from UI.
   */
  updateConfig(updates: Partial<DevWorldConfig>): void {
    Object.assign(this.config, updates);
    this.updateUrl();
  }

  /**
   * Update URL with current config (without reload)
   */
  private updateUrl(): void {
    const url = new URL(window.location.href);
    url.searchParams.set('terrain', this.config.terrain);
    url.searchParams.set('seed', String(this.config.seed));
    url.searchParams.set('buildings', this.config.buildings);
    if (this.config.spawn !== 'north') {
      url.searchParams.set('spawn', this.config.spawn);
    } else {
      url.searchParams.delete('spawn');
    }
    if (this.config.spawnCount !== 1) {
      url.searchParams.set('spawns', String(this.config.spawnCount));
    } else {
      url.searchParams.delete('spawns');
    }
    window.history.replaceState({}, '', url.toString());
  }
}
