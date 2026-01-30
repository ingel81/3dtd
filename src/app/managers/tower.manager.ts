import { signal } from '@angular/core';
import { EntityManager } from './entity-manager';
import { Tower } from '../entities/tower.entity';
import { TowerTypeId } from '../configs/tower-types.config';
import { PLACEMENT_CONFIG } from '../configs/placement.config';
import { GeoPosition } from '../models/game.types';
import { OsmStreetService, StreetNetwork } from '../services/osm-street.service';
import { ThreeTilesEngine } from '../three-engine';
import { geoDistance } from '../utils/geo-utils';
import { GameEventBus } from '../game-engine';

/**
 * Manages all tower entities
 *
 * Framework-agnostic, event-based:
 * - No @Injectable decorator
 * - No inject() calls
 * - Constructor injection
 * - Emits events: tower:placed, tower:sold
 */
export class TowerManager extends EntityManager<Tower> {
  constructor(
    private eventBus: GameEventBus,
    private osmService: OsmStreetService
  ) {
    super();
  }

  // Use signal for reactive updates
  private readonly _selectedTowerId = signal<string | null>(null);
  private streetNetwork: StreetNetwork | null = null;
  private basePosition: GeoPosition | null = null;
  private spawnPoints: GeoPosition[] = [];
  private placementSoundRegistered = false;

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

    // Register placement sound
    if (!this.placementSoundRegistered && tilesEngine.spatialAudio) {
      tilesEngine.spatialAudio.registerSound('tower-placed', '/assets/sounds/effects/building_placed.mp3', {
        refDistance: 50,
        rolloffFactor: 1,
        volume: 0.6,
      });

      // Register fire tower flame loop sound
      tilesEngine.spatialAudio.registerSound('flame-loop', '/assets/sounds/towers/fire/flame_loop.mp3', {
        refDistance: 30,
        rolloffFactor: 1.2,
        volume: 0.5,
        loop: true,
      });

      this.placementSoundRegistered = true;
    }
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

    // Start inner fire for Fire Towers
    if (typeId === 'fire') {
      const localPos = this.tilesEngine.sync.geoToLocalSimple(
        position.lat,
        position.lon,
        terrainHeight
      );
      // Fire center: deep inside the tower furnace
      const fireHeight = tower.typeConfig.heightOffset - 1.5;
      this.tilesEngine.effects.spawnTowerInnerFire(
        tower.id,
        localPos,
        fireHeight,
        0.5 // Medium intensity
      );
    }

    this.add(tower);

    // Emit tower:placed event
    this.eventBus.emit({
      type: 'tower:placed',
      tower,
      position,
      cost: tower.typeConfig.cost,
    });

    // Play placement sound
    this.eventBus.emit({
      type: 'audio:play',
      sound: 'tower-placed',
      lat: position.lat,
      lon: position.lon,
      height: position.height ?? 0,
    });

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
    const distToBase = geoDistance(position, this.basePosition);
    if (distToBase < PLACEMENT_CONFIG.MIN_DISTANCE_TO_BASE) {
      return { valid: false, reason: 'Too close to base' };
    }

    // Check distance to spawn points
    for (const spawn of this.spawnPoints) {
      const distToSpawn = geoDistance(position, spawn);
      if (distToSpawn < PLACEMENT_CONFIG.MIN_DISTANCE_TO_SPAWN) {
        return { valid: false, reason: 'Too close to spawn point' };
      }
    }

    // Check distance to other towers
    for (const tower of this.getAll()) {
      const distToTower = geoDistance(position, tower.position);
      if (distToTower < PLACEMENT_CONFIG.MIN_DISTANCE_TO_OTHER_TOWER) {
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

    if (nearest.distance > PLACEMENT_CONFIG.MAX_DISTANCE_TO_STREET) {
      return { valid: false, reason: 'Too far from street' };
    }

    if (nearest.distance < PLACEMENT_CONFIG.MIN_DISTANCE_TO_STREET) {
      return { valid: false, reason: 'Cannot build directly on street' };
    }

    return { valid: true };
  }

  /**
   * Put tower to sleep (no enemies nearby).
   * Sleeping towers skip combat updates.
   */
  sleepTower(tower: Tower): void {
    if (!tower.isSleeping) {
      tower.isSleeping = true;
    }
  }

  /**
   * Wake tower up (enemy entered range).
   */
  wakeTower(tower: Tower): void {
    if (tower.isSleeping) {
      tower.isSleeping = false;
    }
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
        // Hide LOS visualization
        if (prev.losVisualization) {
          prev.losVisualization.visible = false;
        }
      }
    }

    // Select new
    this._selectedTowerId.set(id);
    if (id) {
      const tower = this.getById(id);
      if (tower) {
        tower.select();
        this.tilesEngine?.towers.select(id);
        // Show LOS visualization
        if (tower.losVisualization) {
          tower.losVisualization.visible = true;
        }
        // Emit tower:selected event
        this.eventBus.emit({ type: 'tower:selected', tower });
      }
    } else if (currentId) {
      // Emit tower:deselected event only if something was previously selected
      this.eventBus.emit({ type: 'tower:deselected' });
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
   * Sell a tower - emits tower:sold event
   * @returns The refund amount
   */
  sell(tower: Tower): number {
    const refund = tower.typeConfig.sellValue;

    // Emit tower:sold event before removal
    this.eventBus.emit({
      type: 'tower:sold',
      tower,
      refund,
    });

    this.remove(tower);
    return refund;
  }

  /**
   * Override remove to cleanup Three.js resources
   */
  override remove(entity: Tower): void {
    // Stop inner fire for Fire Towers
    if (entity.typeConfig.id === 'fire') {
      this.tilesEngine?.effects.stopTowerInnerFire(entity.id);
    }
    this.tilesEngine?.towers.remove(entity.id);
    super.remove(entity);
  }

  /**
   * Override clear to cleanup all Three.js resources
   */
  override clear(): void {
    // Stop all tower inner fires
    this.tilesEngine?.effects.stopAllTowerFires();
    this.tilesEngine?.towers.clear();
    this._selectedTowerId.set(null);
    super.clear();
  }
}
