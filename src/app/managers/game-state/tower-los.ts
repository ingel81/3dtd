import type { GameEventBus } from '../../game-engine/game-event-bus';
import type { LosResolveReason } from '../../game-engine/events/event-types';
import type { GlobalRouteGridService } from '../../services/world/global-route-grid.service';
import type { SimCoords } from '../../sim/core/sim-coords';
import type { Tower } from '../../entities/tower.entity';
import type { LosMask } from '../../utils/los-mask';
import { TOWER_TYPES, type TowerTypeId } from '../../configs/tower-types.config';
import { canTargetAirEffective } from '../../entities/tower-targeting.util';

/**
 * The towers' line of sight in the simulation, as request and answer
 * (docs/SIM_WORKER.md, "Sichtlinien"). The simulation renders nothing: a
 * tower that needs its sight (placed, range upgraded, air targets
 * researched) waits here and `tower:los-needed` goes out. The main thread
 * renders the cube on its GPU and answers with `command:los-mask`, which
 * acts at the boundary of the tick it comes with, on every client alike
 * (applyMask). A tower placed without its mask does not fire; an upgraded
 * one keeps its old answers until the new ones come.
 *
 * Every applied mask goes out as `tower:los-resolved` and into the command
 * log with its boundary (CommandLog.recordLos). A re-simulation plays the
 * logged `command:los-mask` again; the log's `los:resolved` entries apply a
 * mask to a tower still waiting at their boundary (replayMask), which is how
 * a log from before this split, where the mask came with the command that
 * placed the tower, plays on.
 */
export class TowerLos {
  /** Towers waiting for their mask, oldest first, with why */
  private readonly awaiting = new Map<Tower, LosResolveReason>();

  constructor(
    private readonly grid: GlobalRouteGridService,
    private readonly coords: SimCoords,
    private readonly eventBus: GameEventBus,
    /** Air targeting researched by a tower's owner (ResearchManager.airTargetingUnlocked) */
    private readonly airTargetingFor: (playerId: string) => boolean,
  ) {}

  /** A placed tower waits for its first sight; it does not fire before it comes. */
  register(tower: Tower): void {
    if (!this.grid.isInitialized()) return;
    tower.losReady = false;
    this.request(tower, 'place');
  }

  /** A standing tower's sight changed (range upgrade, air retrofit): its old answers stay until the new ones come. */
  recompute(tower: Tower, reason: LosResolveReason): void {
    if (!this.grid.isInitialized()) return;
    this.request(tower, reason);
  }

  private request(tower: Tower, reason: LosResolveReason): void {
    // A second need while one waits: the answer to come covers it (the main
    // thread renders the tower as it stands when it gets to it)
    if (this.awaiting.has(tower)) return;
    this.awaiting.set(tower, reason);
    this.announce(tower, reason);
  }

  /**
   * `tower:los-needed` with what the main thread renders: the range (a
   * placed tower's base range, else its range now) and the layers it may
   * target, air as its owner's research has it now.
   */
  private announce(tower: Tower, reason: LosResolveReason): void {
    const typeId = tower.typeConfig.id as TowerTypeId;
    const config = TOWER_TYPES[typeId];
    this.eventBus.emit({
      type: 'tower:los-needed',
      towerId: tower.id,
      reason,
      range: reason === 'place' ? config.range : tower.combat.range,
      canTargetGround: config.canTargetGround ?? true,
      canTargetAir: canTargetAirEffective(typeId, this.airTargetingFor(tower.ownerId)),
    });
  }

  /**
   * The mask for a waiting tower (command:los-mask): its cells from now on,
   * announced as tower:los-resolved. A tower that waits for nothing takes
   * nothing (a second answer, one for a tower sold since).
   */
  applyMask(tower: Tower, mask: LosMask): boolean {
    const reason = this.awaiting.get(tower);
    if (reason === undefined) return false;
    this.awaiting.delete(tower);
    this.grid.unregisterTower(tower.id);
    this.registerFromMask(tower, mask);
    this.eventBus.emit({ type: 'tower:los-resolved', towerId: tower.id, mask, reason });
    return true;
  }

  /** A logged `los:resolved` entry in a re-simulation, see the class doc */
  replayMask(tower: Tower, mask: LosMask): void {
    if (!this.awaiting.has(tower)) return;
    this.applyMask(tower, mask);
  }

  /**
   * A tower's cells from a stored mask, no event: a snapshot restore puts
   * back what it had. The same cells, visibleCells and losReady as when the
   * mask was taken.
   */
  registerFromMask(tower: Tower, mask: LosMask): void {
    if (!this.grid.isInitialized()) return;
    const position = tower.position;
    const local = this.coords.sync.geoToLocalSimple(position.lat, position.lon, position.height ?? 0);
    tower.visibleCells = this.grid.applyLosMask(tower.id, local.x, local.z, mask);
    tower.losMask = mask;
    tower.losReady = true;
  }

  /** A tower gone (sold, cleared): off the grid and out of the queue. */
  unregister(tower: Tower): void {
    this.awaiting.delete(tower);
    this.grid.unregisterTower(tower.id);
    tower.visibleCells = [];
    tower.losMask = null;
  }

  clearAll(towers: readonly Tower[]): void {
    for (const tower of towers) this.unregister(tower);
    this.awaiting.clear();
  }

  isAwaiting(tower: Tower): boolean {
    return this.awaiting.has(tower);
  }

  /** The waiting towers with their reason, oldest first (snapshots) */
  awaitingEntries(): [string, LosResolveReason][] {
    return [...this.awaiting].map(([tower, reason]) => [tower.id, reason]);
  }

  /**
   * Put the waiting towers back, oldest first (a snapshot restore). A live
   * restore asks for them again: a request the main thread had in hand
   * belonged to the state before. A replay's restore asks nothing, its masks
   * come from the log.
   */
  restoreAwaiting(entries: readonly (readonly [Tower, LosResolveReason])[], announce: boolean): void {
    this.awaiting.clear();
    for (const [tower, reason] of entries) {
      this.awaiting.set(tower, reason);
      if (announce) this.announce(tower, reason);
    }
  }
}
