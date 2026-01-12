import { Injectable, inject, signal } from '@angular/core';
import { EntityManager } from './entity-manager';
import { Tower } from '../entities/tower.entity';
import { TowerTypeId } from '../configs/tower-types.config';
import { GeoPosition } from '../models/game.types';
import { OsmStreetService, StreetNetwork } from '../services/osm-street.service';
import { ThreeTilesEngine } from '../three-engine';

/**
 * Manages all tower entities
 */
@Injectable()
export class TowerManager extends EntityManager<Tower> {
  private osmService = inject(OsmStreetService);

  // Use signal for reactive updates
  private readonly _selectedTowerId = signal<string | null>(null);
  private streetNetwork: StreetNetwork | null = null;
  private basePosition: GeoPosition | null = null;
  private spawnPoints: GeoPosition[] = [];

  // Placement constraints
  private readonly MIN_DISTANCE_TO_STREET = 10;
  private readonly MAX_DISTANCE_TO_STREET = 50;
  private readonly MIN_DISTANCE_TO_BASE = 30;
  private readonly MIN_DISTANCE_TO_SPAWN = 30;
  private readonly MIN_DISTANCE_TO_OTHER_TOWER = 8;

  /**
   * Initialize with ThreeTilesEngine and street network context
   */
  initializeWithContext(
    tilesEngine: ThreeTilesEngine,
    streetNetwork: StreetNetwork,
    basePosition: GeoPosition,
    spawnPoints: GeoPosition[]
  ): void {
    super.initialize(tilesEngine);
    this.streetNetwork = streetNetwork;
    this.basePosition = basePosition;
    this.spawnPoints = spawnPoints;
  }

  /**
   * Place a new tower
   * @param position Geo position
   * @param typeId Tower type ID
   * @param customRotation Custom rotation set by user (radians)
   */
  placeTower(position: GeoPosition, typeId: TowerTypeId, customRotation = 0): Tower | null {
    if (!this.tilesEngine) {
      throw new Error('TowerManager not initialized');
    }

    // Note: Validation is done by TowerPlacementService (with 3D distance calculation)
    // We skip redundant validation here to allow rooftop placements etc.

    const tower = new Tower(position, typeId, customRotation);

    if (position.height === undefined) {
      console.error('[TowerManager] position.height is undefined! Terrain height must be sampled before placing tower.');
    }

    const terrainHeight = position.height!;
    this.tilesEngine.towers.create(
      tower.id,
      typeId,
      position.lat,
      position.lon,
      terrainHeight,
      customRotation
    );

    this.add(tower);
    return tower;
  }

  /**
   * Validate tower placement position
   */
  validatePosition(position: GeoPosition): { valid: boolean; reason?: string } {
    if (!this.streetNetwork || !this.basePosition) {
      return { valid: false, reason: 'Not initialized' };
    }

    // Check distance to base
    const distToBase = this.calculateDistance(position, this.basePosition);
    if (distToBase < this.MIN_DISTANCE_TO_BASE) {
      return { valid: false, reason: 'Too close to base' };
    }

    // Check distance to spawn points
    for (const spawn of this.spawnPoints) {
      const distToSpawn = this.calculateDistance(position, spawn);
      if (distToSpawn < this.MIN_DISTANCE_TO_SPAWN) {
        return { valid: false, reason: 'Too close to spawn point' };
      }
    }

    // Check distance to other towers
    for (const tower of this.getAll()) {
      const distToTower = this.calculateDistance(position, tower.position);
      if (distToTower < this.MIN_DISTANCE_TO_OTHER_TOWER) {
        return { valid: false, reason: 'Too close to another tower' };
      }
    }

    // Check distance to street
    const nearest = this.osmService.findNearestStreetPoint(
      this.streetNetwork,
      position.lat,
      position.lon
    );

    if (!nearest) {
      return { valid: false, reason: 'No street nearby' };
    }

    if (nearest.distance > this.MAX_DISTANCE_TO_STREET) {
      return { valid: false, reason: 'Too far from street' };
    }

    if (nearest.distance < this.MIN_DISTANCE_TO_STREET) {
      return { valid: false, reason: 'Cannot build directly on street' };
    }

    return { valid: true };
  }

  /**
   * Select a tower
   */
  selectTower(id: string | null): void {
    const currentId = this._selectedTowerId();

    // Deselect previous
    if (currentId) {
      const prev = this.getById(currentId);
      if (prev) {
        prev.deselect();
        this.tilesEngine?.towers.deselect(currentId);
      }
    }

    // Select new
    this._selectedTowerId.set(id);
    if (id) {
      const tower = this.getById(id);
      if (tower) {
        tower.select();
        this.tilesEngine?.towers.select(id);
      }
    }
  }

  /**
   * Get currently selected tower
   */
  getSelected(): Tower | null {
    const id = this._selectedTowerId();
    return id ? this.getById(id) : null;
  }

  /**
   * Get ID of currently selected tower
   */
  getSelectedId(): string | null {
    return this._selectedTowerId();
  }

  /**
   * Deselect all towers
   */
  deselectAll(): void {
    this.selectTower(null);
  }

  /**
   * Calculate distance between two positions
   */
  private calculateDistance(pos1: GeoPosition, pos2: GeoPosition): number {
    const R = 6371000; // Earth radius in meters
    const dLat = ((pos2.lat - pos1.lat) * Math.PI) / 180;
    const dLon = ((pos2.lon - pos1.lon) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((pos1.lat * Math.PI) / 180) *
        Math.cos((pos2.lat * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Override remove to cleanup Three.js resources
   */
  override remove(entity: Tower): void {
    this.tilesEngine?.towers.remove(entity.id);
    super.remove(entity);
  }

  /**
   * Override clear to cleanup all Three.js resources
   */
  override clear(): void {
    this.tilesEngine?.towers.clear();
    this._selectedTowerId.set(null);
    super.clear();
  }
}
