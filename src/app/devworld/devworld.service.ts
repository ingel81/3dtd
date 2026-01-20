import { Injectable } from '@angular/core';

/**
 * DevWorld Configuration
 *
 * All settings can be controlled via URL parameters:
 * - ?devworld              - Activates DevWorld mode
 * - ?devworld&terrain=flat - Terrain preset (flat, default, hills)
 * - ?devworld&buildings=dense - Building preset (none, sparse, dense, maze)
 * - ?devworld&spawn=north  - Spawn point (north, south, east, west, random)
 * - ?devworld&grid         - Show debug grid overlay
 */
export interface DevWorldConfig {
  /** Terrain heightmap preset */
  terrain: 'flat' | 'default' | 'hills';

  /** Building layout preset */
  buildings: 'none' | 'sparse' | 'dense' | 'maze';

  /** Spawn point location */
  spawn: 'north' | 'south' | 'east' | 'west' | 'random';

  /** Show debug grid overlay */
  grid: boolean;
}

/**
 * DevWorld Constants
 */
export const DEV_WORLD_SIZE = 1000; // meters (1km x 1km play area)
export const DEV_WORLD_HEIGHTMAP_SIZE = 1024; // pixels (~1m resolution)
export const DEV_WORLD_MAX_HEIGHT = 30; // meters

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
      this.config = {
        terrain: this.parseTerrainParam(params.get('terrain')),
        buildings: this.parseBuildingsParam(params.get('buildings')),
        spawn: this.parseSpawnParam(params.get('spawn')),
        grid: params.has('grid'),
      };

      console.log('[DevWorld] Active with config:', this.config);
    } else {
      // Default config (not used when inactive)
      this.config = {
        terrain: 'default',
        buildings: 'sparse',
        spawn: 'north',
        grid: false,
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
    const metersPerDegree = 111320;
    return {
      lat: DEV_WORLD_ORIGIN.lat + z / metersPerDegree,
      lon: DEV_WORLD_ORIGIN.lon - x / metersPerDegree, // -X = East = +lon
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
    const metersPerDegree = 111320;
    return {
      x: -(lon - DEV_WORLD_ORIGIN.lon) * metersPerDegree, // +lon = East = -X
      z: (lat - DEV_WORLD_ORIGIN.lat) * metersPerDegree,
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

    if (this.config.terrain !== 'default') {
      params.set('terrain', this.config.terrain);
    }
    if (this.config.buildings !== 'sparse') {
      params.set('buildings', this.config.buildings);
    }
    if (this.config.spawn !== 'north') {
      params.set('spawn', this.config.spawn);
    }
    if (this.config.grid) {
      params.set('grid', '');
    }

    const base = window.location.origin + window.location.pathname;
    return `${base}?${params.toString()}`;
  }

  private parseTerrainParam(value: string | null): DevWorldConfig['terrain'] {
    if (value === 'flat' || value === 'hills') {
      return value;
    }
    return 'default';
  }

  private parseBuildingsParam(value: string | null): DevWorldConfig['buildings'] {
    if (value === 'none' || value === 'dense' || value === 'maze') {
      return value;
    }
    return 'sparse';
  }

  private parseSpawnParam(value: string | null): DevWorldConfig['spawn'] {
    if (value === 'south' || value === 'east' || value === 'west' || value === 'random') {
      return value;
    }
    return 'north';
  }
}
