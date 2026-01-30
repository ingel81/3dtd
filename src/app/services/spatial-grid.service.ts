import { Injectable } from '@angular/core';

/**
 * SpatialGrid — General-purpose uniform grid spatial index
 *
 * Provides O(1) insert/remove/update and O(k) radius/rect queries
 * where k = number of cells checked.
 *
 * Works in local coordinates (meters). Complements GlobalRouteGrid:
 * - GlobalRouteGrid: route-specific cells, LOS pre-computation, 2m cells
 * - SpatialGrid: general-purpose, any entity, configurable cell size (~50m default)
 *
 * Primary use cases:
 * - Tower sleep wake-checks (are any enemies nearby?)
 * - Fallback targeting when GlobalRouteGrid isn't available
 * - General proximity queries
 */

/** Position data stored per entity */
interface EntityEntry {
  x: number;
  z: number;
  cellKey: string;
}

/**
 * Pure data structure — no Angular dependencies.
 * Can be used standalone or wrapped in an Angular service.
 */
export class SpatialGrid {
  /** Map of cell key -> Set of entity IDs in that cell */
  private cells = new Map<string, Set<string>>();

  /** Map of entity ID -> position + current cell */
  private entities = new Map<string, EntityEntry>();

  /** Inverse of cell size for fast multiplication instead of division */
  private readonly invCellSize: number;

  constructor(private readonly cellSize: number = 50) {
    this.invCellSize = 1 / cellSize;
  }

  /**
   * Get the cell key for a world position.
   * Uses bitwise OR for fast floor (works for positive and negative coords).
   */
  private cellKey(x: number, z: number): string {
    const cx = (x * this.invCellSize) | 0;
    const cz = (z * this.invCellSize) | 0;
    return `${cx}_${cz}`;
  }

  /** Extract cell indices from position */
  private cellIndices(x: number, z: number): [number, number] {
    return [(x * this.invCellSize) | 0, (z * this.invCellSize) | 0];
  }

  /**
   * Insert an entity at position (x, z).
   * O(1) amortized.
   */
  insert(id: string, x: number, z: number): void {
    const key = this.cellKey(x, z);

    // Add to cell
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Set();
      this.cells.set(key, cell);
    }
    cell.add(id);

    // Track entity
    this.entities.set(id, { x, z, cellKey: key });
  }

  /**
   * Remove an entity by ID.
   * O(1).
   */
  remove(id: string): void {
    const entry = this.entities.get(id);
    if (!entry) return;

    const cell = this.cells.get(entry.cellKey);
    if (cell) {
      cell.delete(id);
      if (cell.size === 0) {
        this.cells.delete(entry.cellKey);
      }
    }

    this.entities.delete(id);
  }

  /**
   * Update an entity's position.
   * O(1) — skips cell transition if still in the same cell.
   */
  update(id: string, x: number, z: number): void {
    const entry = this.entities.get(id);
    if (!entry) {
      // Not tracked yet — insert
      this.insert(id, x, z);
      return;
    }

    const newKey = this.cellKey(x, z);
    entry.x = x;
    entry.z = z;

    if (newKey === entry.cellKey) return; // Same cell, done

    // Remove from old cell
    const oldCell = this.cells.get(entry.cellKey);
    if (oldCell) {
      oldCell.delete(id);
      if (oldCell.size === 0) {
        this.cells.delete(entry.cellKey);
      }
    }

    // Add to new cell
    let newCell = this.cells.get(newKey);
    if (!newCell) {
      newCell = new Set();
      this.cells.set(newKey, newCell);
    }
    newCell.add(id);

    entry.cellKey = newKey;
  }

  /**
   * Query all entity IDs within a radius of (x, z).
   * O(k) where k = cells checked. Performs exact distance filtering.
   */
  queryRadius(x: number, z: number, radius: number): string[] {
    const radiusSq = radius * radius;
    const cellRadius = Math.ceil(radius * this.invCellSize);
    const [cx, cz] = this.cellIndices(x, z);

    const result: string[] = [];

    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dz = -cellRadius; dz <= cellRadius; dz++) {
        const key = `${cx + dx}_${cz + dz}`;
        const cell = this.cells.get(key);
        if (!cell) continue;

        for (const id of cell) {
          const entry = this.entities.get(id)!;
          const ex = entry.x - x;
          const ez = entry.z - z;
          if (ex * ex + ez * ez <= radiusSq) {
            result.push(id);
          }
        }
      }
    }

    return result;
  }

  /**
   * Query all entity IDs within an axis-aligned rectangle.
   * O(k) where k = cells checked.
   */
  queryRect(minX: number, minZ: number, maxX: number, maxZ: number): string[] {
    const minCX = (minX * this.invCellSize) | 0;
    const minCZ = (minZ * this.invCellSize) | 0;
    const maxCX = (maxX * this.invCellSize) | 0;
    const maxCZ = (maxZ * this.invCellSize) | 0;

    const result: string[] = [];

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const key = `${cx}_${cz}`;
        const cell = this.cells.get(key);
        if (!cell) continue;

        for (const id of cell) {
          const entry = this.entities.get(id)!;
          if (entry.x >= minX && entry.x <= maxX && entry.z >= minZ && entry.z <= maxZ) {
            result.push(id);
          }
        }
      }
    }

    return result;
  }

  /**
   * Check if any entity exists within radius (early exit).
   * Faster than queryRadius when you only need a boolean answer.
   */
  hasAny(x: number, z: number, radius: number): boolean {
    const radiusSq = radius * radius;
    const cellRadius = Math.ceil(radius * this.invCellSize);
    const [cx, cz] = this.cellIndices(x, z);

    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dz = -cellRadius; dz <= cellRadius; dz++) {
        const key = `${cx + dx}_${cz + dz}`;
        const cell = this.cells.get(key);
        if (!cell) continue;

        for (const id of cell) {
          const entry = this.entities.get(id)!;
          const ex = entry.x - x;
          const ez = entry.z - z;
          if (ex * ex + ez * ez <= radiusSq) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Get the position of a tracked entity, or undefined if not found.
   */
  getPosition(id: string): { x: number; z: number } | undefined {
    const entry = this.entities.get(id);
    return entry ? { x: entry.x, z: entry.z } : undefined;
  }

  /**
   * Get the number of tracked entities.
   */
  get size(): number {
    return this.entities.size;
  }

  /**
   * Get the number of occupied cells.
   */
  get occupiedCells(): number {
    return this.cells.size;
  }

  /**
   * Clear all data.
   */
  clear(): void {
    this.cells.clear();
    this.entities.clear();
  }
}

/**
 * Angular injectable wrapper around SpatialGrid.
 *
 * Manages a single global enemy spatial index in local coordinates.
 * Towers and other systems can query this for fast proximity lookups
 * without going through the GlobalRouteGrid (which only covers route cells).
 */
@Injectable({ providedIn: 'root' })
export class SpatialGridService {
  /** Grid for enemy positions (local coordinates, meters) */
  private readonly enemyGrid = new SpatialGrid(50);

  /**
   * Get the underlying enemy grid for direct queries.
   */
  getEnemyGrid(): SpatialGrid {
    return this.enemyGrid;
  }

  /**
   * Update an enemy's position in the spatial grid.
   * Call each frame after enemy movement.
   *
   * @param enemyId Enemy unique ID
   * @param localX Local X coordinate (meters)
   * @param localZ Local Z coordinate (meters)
   */
  updateEnemy(enemyId: string, localX: number, localZ: number): void {
    this.enemyGrid.update(enemyId, localX, localZ);
  }

  /**
   * Remove an enemy from the spatial grid.
   * Call when enemy dies or is removed.
   */
  removeEnemy(enemyId: string): void {
    this.enemyGrid.remove(enemyId);
  }

  /**
   * Check if any enemy exists within radius of a local position.
   * Used for tower sleep wake-checks (fast early exit).
   *
   * @param localX Center X (local coordinates)
   * @param localZ Center Z (local coordinates)
   * @param radiusMeters Radius in meters
   */
  hasEnemyInRadius(localX: number, localZ: number, radiusMeters: number): boolean {
    return this.enemyGrid.hasAny(localX, localZ, radiusMeters);
  }

  /**
   * Get all enemy IDs within radius.
   *
   * @param localX Center X (local coordinates)
   * @param localZ Center Z (local coordinates)
   * @param radiusMeters Radius in meters
   */
  getEnemyIdsInRadius(localX: number, localZ: number, radiusMeters: number): string[] {
    return this.enemyGrid.queryRadius(localX, localZ, radiusMeters);
  }

  /**
   * Clear all tracked enemies.
   */
  clear(): void {
    this.enemyGrid.clear();
  }
}
