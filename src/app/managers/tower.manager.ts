import { signal } from '@angular/core';
import { Vector3 } from 'three';
import { EntityManager } from './entity-manager';
import { Tower } from '../entities/tower.entity';
import { TowerTypeId } from '../configs/tower-types.config';
import { PLACEMENT_CONFIG } from '../configs/placement.config';
import { GeoPosition } from '../models/game.types';
import { OsmStreetService, StreetNetwork } from '../services/location/osm-street.service';
import { ThreeTilesEngine } from '../three-engine';
import { geoDistanceFastSq, findNearestRouteDistance } from '../utils/geo-utils';
import { GameEventBus } from '../game-engine';
import type { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { TOWER_TYPES } from '../configs/tower-types.config';
import { TowerLosViz } from '../utils/tower-los-viz';
import { canTargetAirEffective } from '../entities/tower-targeting.util';
import { ResearchStore } from '../store/research.store';

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
    private osmService: OsmStreetService,
    private researchStore: ResearchStore,
  ) {
    super();
  }

  // Use signal for reactive updates
  private readonly _selectedTowerId = signal<string | null>(null);
  private streetNetwork: StreetNetwork | null = null;
  private basePosition: GeoPosition | null = null;
  private spawnPoints: GeoPosition[] = [];
  private placementSoundRegistered = false;
  private activeRoutesGetter: (() => GeoPosition[][]) | null = null;

  /**
   * GlobalRouteGridService — Quelle für Cells-in-Range und Cell-Size beim
   * Bauen der Selection-LOS-Viz.
   */
  private globalRouteGrid: GlobalRouteGridService | null = null;

  setGlobalRouteGrid(grid: GlobalRouteGridService): void {
    this.globalRouteGrid = grid;
  }

  /**
   * Aktuell aktive Selection-LOS-Viz. Lebt solange ein Tower selected
   * ist und vor allem Build-Mode NICHT aktiv (siehe Lesson 9).
   */
  private selectionViz: TowerLosViz | null = null;
  private selectionVizTowerId: string | null = null;

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

      // Register tentacle strike sound
      tilesEngine.spatialAudio.registerSound('tentacle-grab', '/assets/sounds/towers/tentacle/tentacle-01.mp3', {
        refDistance: 25,
        rolloffFactor: 1.5,
        volume: 0.7,
      });

      // Register lightning chain shot sound
      tilesEngine.spatialAudio.registerSound('lightning-chain', '/assets/sounds/towers/lightning/lightning_chain.mp3', {
        refDistance: 40,
        rolloffFactor: 1.2,
        volume: 0.6,
      });

      this.placementSoundRegistered = true;
    }
  }

  /**
   * Set a callback to retrieve active enemy routes for placement validation.
   */
  setActiveRoutesGetter(getter: () => GeoPosition[][]): void {
    this.activeRoutesGetter = getter;
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

    // Create tentacle visual for Tentacle Towers
    if (typeId === 'tentacle') {
      const localPos = this.tilesEngine.sync.geoToLocalSimple(
        position.lat,
        position.lon,
        terrainHeight
      );
      const shootPos = localPos.clone();
      shootPos.y += tower.typeConfig.heightOffset + tower.typeConfig.shootHeight;
      this.tilesEngine.tentacles.create(tower.id, shootPos);
    }

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

    // Start permanent idle-crackle at tip for Lightning Towers
    if (typeId === 'lightning') {
      const tipPos = this.tilesEngine.sync.geoToLocalSimple(
        position.lat,
        position.lon,
        terrainHeight,
      );
      tipPos.y += tower.typeConfig.heightOffset + tower.typeConfig.shootHeight;
      this.tilesEngine.lightningBolts.registerIdleCrackle(
        tower.id,
        tipPos,
        performance.now() / 1000,
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

    // Check distance to base (squared comparison avoids sqrt)
    const distToBaseSq = geoDistanceFastSq(position, this.basePosition);
    if (distToBaseSq < PLACEMENT_CONFIG.MIN_DISTANCE_TO_BASE ** 2) {
      return { valid: false, reason: 'Too close to base' };
    }

    // Check distance to spawn points (squared comparison avoids sqrt)
    for (const spawn of this.spawnPoints) {
      const distToSpawnSq = geoDistanceFastSq(position, spawn);
      if (distToSpawnSq < PLACEMENT_CONFIG.MIN_DISTANCE_TO_SPAWN ** 2) {
        return { valid: false, reason: 'Too close to spawn point' };
      }
    }

    // Check distance to other towers (squared comparison avoids sqrt)
    for (const tower of this.getAll()) {
      const distToTowerSq = geoDistanceFastSq(position, tower.position);
      if (distToTowerSq < PLACEMENT_CONFIG.MIN_DISTANCE_TO_OTHER_TOWER ** 2) {
        return { valid: false, reason: 'Too close to another tower' };
      }
    }

    // Check distance to active enemy routes
    const activeRoutes = this.activeRoutesGetter?.() ?? [];
    if (activeRoutes.length > 0) {
      const routeDistance = findNearestRouteDistance(activeRoutes, position.lat, position.lon);
      if (routeDistance < PLACEMENT_CONFIG.MIN_DISTANCE_TO_ROUTE) {
        return { valid: false, reason: 'Too close to route' };
      }
    }
    // If no routes exist yet, allow placement anywhere

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
      }
    }

    // Bei jedem Selection-Wechsel die vorige Viz disposen — wir behalten
    // nicht mehrere parallel.
    this.disposeSelectionViz();

    // Select new
    this._selectedTowerId.set(id);
    if (id) {
      const tower = this.getById(id);
      if (tower) {
        tower.select();
        this.tilesEngine?.towers.select(id);
        if (tower.losReady) this.buildSelectionViz(tower);
        this.eventBus.emit({ type: 'tower:selected', tower });
      }
    } else if (currentId) {
      this.eventBus.emit({ type: 'tower:deselected' });
    }
  }

  /**
   * Selection-LOS-Viz für `tower` bauen. No-op wenn nicht alle
   * Dependencies bereit sind.
   */
  private buildSelectionViz(tower: Tower): void {
    if (!this.globalRouteGrid || !this.tilesEngine) return;
    const config = TOWER_TYPES[tower.typeConfig.id as TowerTypeId];
    if (!config) return;

    const localPos = this.tilesEngine.sync.geoToLocalSimple(
      tower.position.lat,
      tower.position.lon,
      tower.position.height ?? 0,
    );
    const tipY = localPos.y + config.heightOffset + config.shootHeight;
    const towerTip = new Vector3(localPos.x, tipY, localPos.z);

    const canTargetGround = config.canTargetGround ?? true;
    const canTargetAir = canTargetAirEffective(
      tower.typeConfig.id as TowerTypeId,
      this.researchStore.airTargetingUnlocked(),
    );
    const range = tower.combat.range;

    const blockerGroup = this.tilesEngine.getLosBlockerGroup();
    if (!blockerGroup) return;
    const cells = this.globalRouteGrid.getCellsInRange(
      localPos.x, localPos.z, range,
    );
    if (cells.length === 0) return;

    this.selectionViz = new TowerLosViz({
      cells,
      towerTip,
      groundRange: range,
      airRange: range,
      canTargetGround,
      canTargetAir,
      gridCellSize: this.globalRouteGrid.getCellSize(),
      shadowMapper: this.tilesEngine.getTowerShadowMapper(),
      blockerGroup,
    });
    // Restore the persisted per-tower-LOS filter on the fresh viz —
    // applyLosFilter() is also called externally on signal changes by
    // GameLoopFacade.
    this.selectionViz.setFilterMode(this.losFilterMode);
    this.selectionViz.addTo(this.tilesEngine.getScene());
    this.selectionVizTowerId = tower.id;
  }

  /**
   * Current per-tower-LOS filter for the SELECTION viz. Owned by
   * UIStore.perTowerLosFilter — the GameLoopFacade pushes changes in
   * via `applyLosFilter()`. Mirrored here so that newly built selection
   * vizes (after a tower-click or refreshSelectionViz) start with the
   * correct state.
   */
  private losFilterMode: 'both' | 'ground' | 'air' = 'both';

  /**
   * Apply the per-tower-LOS filter to the active selection viz (if any)
   * and remember the mode for any future viz built during the same
   * session. Idempotent.
   */
  applyLosFilter(mode: 'both' | 'ground' | 'air'): void {
    this.losFilterMode = mode;
    this.selectionViz?.setFilterMode(mode);
  }

  /**
   * Aktive Selection-LOS-Viz (oder null wenn kein Tower selected oder Viz
   * noch nicht gebaut). Vom LOS-Debug-Panel benutzt um die Plate-Meshes
   * für 3D-Picking zu raycasten.
   */
  getSelectionViz(): TowerLosViz | null {
    return this.selectionViz;
  }

  private disposeSelectionViz(): void {
    if (this.selectionViz) {
      this.selectionViz.dispose();
      this.selectionViz = null;
      this.selectionVizTowerId = null;
    }
  }

  /**
   * Wird vom TowerPlacementService nach `registerTowerOnGrid` /
   * `recomputeTowerLOS` aufgerufen, wenn dieser Tower selected ist.
   * Baut die Viz mit dem aktuellen Cell-Set + Range neu.
   */
  refreshSelectionViz(tower: Tower): void {
    if (this._selectedTowerId() !== tower.id) return;
    this.disposeSelectionViz();
    if (tower.losReady) this.buildSelectionViz(tower);
  }

  /**
   * Wird beim Sell aufgerufen — bereinigt die Selection-Viz, falls dieser
   * Tower gerade dargestellt wurde.
   */
  onTowerUnregistered(tower: Tower): void {
    if (this.selectionVizTowerId === tower.id) {
      this.disposeSelectionViz();
    }
  }

  /** Per-Frame-Tick — pulse animation. */
  tickSelectionViz(timeSeconds: number): void {
    this.selectionViz?.tick(timeSeconds);
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
    const refund = tower.getSellValue();

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
    // Remove tentacle visual for Tentacle Towers
    if (entity.typeConfig.id === 'tentacle') {
      this.tilesEngine?.tentacles.remove(entity.id);
    }
    // Stop idle-crackle for Lightning Towers
    if (entity.typeConfig.id === 'lightning') {
      this.tilesEngine?.lightningBolts.deregisterIdleCrackle(entity.id);
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
    // Clear all tentacle visuals
    this.tilesEngine?.tentacles.clear();
    this.tilesEngine?.towers.clear();
    this._selectedTowerId.set(null);
    super.clear();
  }
}
