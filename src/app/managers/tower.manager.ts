import { EntityManager } from './entity-manager';
import { Tower } from '../entities/tower.entity';
import { TowerTypeId } from '../configs/tower-types.config';
import { GeoPosition } from '../models/game.types';
import { GameEventBus } from '../game-engine/game-event-bus';
import { LOCAL_PLAYER_ID } from './game-state/command-log';
import { computeGuardHeading } from '../utils/tower-guard-heading';
import { aimIdle } from '../entities/tower-aim';
import type { SimCoords } from '../sim/core/sim-coords';
import { opVec, type SimSink } from '../sim/core/sim-sink';

/**
 * Manages all tower entities
 *
 * Framework-agnostic, event-based:
 * - No @Injectable decorator
 * - No inject() calls
 * - Constructor injection
 * - Emits events: tower:placed, tower:sold
 *
 * What a tower looks like (model, plinth, searchlight, tentacle, crackle,
 * furnace) is built and taken down on the main thread through ops (SimSink).
 * Which tower is selected is the main thread's UI state.
 */
export class TowerManager extends EntityManager<Tower> {
  constructor(
    private eventBus: GameEventBus,
    private readonly coords: SimCoords,
    private readonly sink: SimSink,
  ) {
    super();
  }

  private activeRoutesGetter: (() => GeoPosition[][]) | null = null;

  /**
   * Set a callback to retrieve the active enemy routes, for the towers'
   * guard headings.
   */
  setActiveRoutesGetter(getter: () => GeoPosition[][]): void {
    this.activeRoutesGetter = getter;
  }

  /**
   * Recompute where a tower watches between waves (`Tower.guardHeading`).
   * Needed after its range changed; placement does it itself.
   */
  refreshGuardHeading(tower: Tower): void {
    this.updateGuardHeading(tower, this.activeRoutesGetter?.() ?? []);
  }

  /** refreshGuardHeading for every tower, after the routes changed. */
  refreshGuardHeadings(): void {
    const routes = this.activeRoutesGetter?.() ?? [];
    for (const tower of this.getAll()) {
      this.updateGuardHeading(tower, routes);
    }
  }

  private updateGuardHeading(tower: Tower, routes: GeoPosition[][]): void {
    tower.guardHeading = computeGuardHeading(tower.position, tower.combat.range, routes);
  }

  /**
   * Place a new tower
   * @param position Geo position
   * @param typeId Tower type ID
   * @param customRotation Custom rotation set by user (radians)
   * @param plinthHeight Stone plinth below position.height (m), 0 = none
   * @param plinthOverhang Footprint probes the plinth hangs over a drop at, see Tower.plinthOverhang
   */
  placeTower(
    position: GeoPosition,
    typeId: TowerTypeId,
    customRotation = 0,
    plinthHeight = 0,
    plinthOverhang: readonly number[] = [],
    /** A tower put back by a snapshot restore: no tower:placed, no sound */
    silent = false,
    /** Tower.ownerId, set before tower:placed goes out */
    ownerId: string = LOCAL_PLAYER_ID,
  ): Tower | null {
    // Note: Validation is done by TowerPlacementService (with 3D distance calculation)
    // We skip redundant validation here to allow rooftop placements etc.

    const tower = new Tower(position, typeId, customRotation, plinthHeight, plinthOverhang);
    tower.ownerId = ownerId;
    this.refreshGuardHeading(tower);
    // After its reference sweep the turret faces where the route comes in
    if (tower.guardHeading !== null) aimIdle(tower.aim, tower.guardHeading);

    if (position.height === undefined) {
      console.error('[TowerManager] position.height is undefined! Terrain height must be sampled before placing tower.');
    }

    const terrainHeight = position.height!;
    this.sink.towers.create(tower.id, typeId, position.lat, position.lon, terrainHeight, customRotation);

    // Stone plinth from the lowest point of the footprint up to the foot,
    // braced where it hangs over a drop
    if (tower.plinthHeight > 0) {
      this.sink.plinths.create(
        tower.id,
        position.lat,
        position.lon,
        terrainHeight,
        tower.plinthHeight,
        tower.typeConfig.footprintRadius,
        [...tower.plinthOverhang],
      );
    }

    // Searchlight for the blood moon, on the tower's foot (the plinth's top),
    // turning with the turret; passive buildings get none
    this.sink.searchlights.add(tower.id, position.lat, position.lon, terrainHeight, typeId);

    // Create tentacle visual for Tentacle Towers
    if (typeId === 'tentacle') {
      const shootPos = this.coords.sync.geoToLocalSimple(position.lat, position.lon, terrainHeight);
      shootPos.y += tower.typeConfig.heightOffset + tower.typeConfig.shootHeight;
      this.sink.tentacles.create(tower.id, opVec(shootPos));
    }

    // Start inner fire for Fire Towers
    if (typeId === 'fire') this.startInnerFire(tower);

    // Start permanent idle-crackle at tip for Lightning Towers
    if (typeId === 'lightning') {
      const tipPos = this.coords.sync.geoToLocalSimple(position.lat, position.lon, terrainHeight);
      tipPos.y += tower.typeConfig.heightOffset + tower.typeConfig.shootHeight;
      this.sink.lightningBolts.registerIdleCrackle(tower.id, opVec(tipPos));
    }

    this.add(tower);
    if (silent) return tower;

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
   * Sell a tower - emits tower:sold event
   * @returns The refund amount
   */
  sell(tower: Tower): number {
    const refund = tower.getSellValue();
    const position = tower.position;

    // Emit tower:sold event before removal
    this.eventBus.emit({
      type: 'tower:sold',
      tower,
      refund,
      damageDealt: tower.combat.damageDealt,
      kills: tower.combat.kills,
    });

    // Play sell sound
    this.eventBus.emit({
      type: 'audio:play',
      sound: 'tower-sold',
      lat: position.lat,
      lon: position.lon,
      height: position.height ?? 0,
    });

    this.remove(tower);
    return refund;
  }

  /**
   * Light the furnace of every fire tower again, after effects.clear()
   * put the fires out (a replay's seek, entering or leaving it).
   */
  refreshInnerFires(): void {
    this.sink.effects.stopAllTowerFires();
    for (const tower of this.getAll()) {
      if (tower.typeConfig.id === 'fire') this.startInnerFire(tower);
    }
  }

  /** The glow deep inside a fire tower's furnace. */
  private startInnerFire(tower: Tower): void {
    const { lat, lon } = tower.position;
    const localPos = this.coords.sync.geoToLocalSimple(lat, lon, tower.transform.terrainHeight);
    // Fire center: deep inside the tower furnace
    const fireHeight = tower.typeConfig.heightOffset - 1.5;
    this.sink.effects.spawnTowerInnerFire(tower.id, opVec(localPos), fireHeight, 0.5);
  }

  /**
   * Override remove to take its look down on the main thread
   */
  override remove(entity: Tower): void {
    // Stop inner fire for Fire Towers
    if (entity.typeConfig.id === 'fire') {
      this.sink.effects.stopTowerInnerFire(entity.id);
    }
    // Remove tentacle visual for Tentacle Towers
    if (entity.typeConfig.id === 'tentacle') {
      this.sink.tentacles.remove(entity.id);
    }
    // Stop idle-crackle for Lightning Towers
    if (entity.typeConfig.id === 'lightning') {
      this.sink.lightningBolts.deregisterIdleCrackle(entity.id);
    }
    if (entity.plinthHeight > 0) {
      this.sink.plinths.remove(entity.id);
    }
    this.sink.towerBadges.remove(entity.id);
    this.sink.searchlights.remove(entity.id);
    this.sink.towers.remove(entity.id);
    super.remove(entity);
  }

  /**
   * Override clear to take every tower's look down
   */
  override clear(): void {
    // Stop all tower inner fires
    this.sink.effects.stopAllTowerFires();
    // Clear all tentacle visuals
    this.sink.tentacles.clear();
    this.sink.plinths.clear();
    this.sink.towerBadges.clear();
    this.sink.searchlights.clear();
    this.sink.towers.clear();
    super.clear();
  }
}
