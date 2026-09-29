import type { GameEventBus } from '../../game-engine/game-event-bus';
import type { LosResolveReason } from '../../game-engine/events/event-types';
import type { GlobalRouteGridService } from '../../services/world/global-route-grid.service';
import type { SimCoords } from '../../sim/core/sim-coords';
import type { Tower } from '../../entities/tower.entity';
import type { LosMask } from '../../utils/los-mask';
import { TOWER_TYPES, type TowerTypeId } from '../../configs/tower-types.config';
import { canTargetAirEffective } from '../../entities/tower-targeting.util';

/** Why a tower waits and the generation of its latest request */
export interface LosAwait {
  reason: LosResolveReason;
  generation: number;
}

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
 * Every request carries a generation and the answer brings it back: a
 * second need while one waits (a range upgrade or an air retrofit before
 * the first answer came) asks again with a new generation, and only the
 * answer to the latest applies. The generations are part of the
 * simulation's state (snapshots), so every coop client and a re-simulation
 * count alike; a logged mask without one (a log from before) answers what
 * waits.
 *
 * Every applied mask goes out as `tower:los-resolved` and into the command
 * log with its boundary (CommandLog.recordLos). A re-simulation plays the
 * logged `command:los-mask` again; the log's `los:resolved` entries apply a
 * mask to a tower still waiting at their boundary (replayMask), which is how
 * a log from before this split, where the mask came with the command that
 * placed the tower, plays on.
 */
export class TowerLos {
  /** Towers waiting for their mask, oldest first, with why and the generation asked for */
  private readonly awaiting = new Map<Tower, LosAwait>();
  /** Generation of the next request */
  private nextGeneration = 1;

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
    // A second need while one waits asks again: the pending answer was
    // rendered for the tower as it stood then (range, air). A tower that
    // never had its sight still needs all of it (place).
    const waiting = this.awaiting.get(tower);
    const entry: LosAwait = {
      reason: waiting?.reason === 'place' ? 'place' : reason,
      generation: this.nextGeneration++,
    };
    // In place, so the order stays that of the first request
    if (waiting) Object.assign(waiting, entry);
    else this.awaiting.set(tower, entry);
    this.announce(tower, entry);
  }

  /**
   * `tower:los-needed` with what the main thread renders: the range the
   * tower has now (a placed one's is its base range) and the layers it may
   * target, air as its owner's research has it now.
   */
  private announce(tower: Tower, { reason, generation }: LosAwait): void {
    const typeId = tower.typeConfig.id as TowerTypeId;
    const config = TOWER_TYPES[typeId];
    this.eventBus.emit({
      type: 'tower:los-needed',
      towerId: tower.id,
      reason,
      generation,
      range: tower.combat.range,
      canTargetGround: config.canTargetGround ?? true,
      canTargetAir: canTargetAirEffective(typeId, this.airTargetingFor(tower.ownerId)),
    });
  }

  /**
   * Ask again for every tower still waiting, with the same generations: the
   * live state back after a replay, whose restore the main thread did not
   * hear (the live listeners were muted).
   */
  announceAwaiting(): void {
    for (const [tower, entry] of this.awaiting) this.announce(tower, entry);
  }

  /**
   * The mask for a waiting tower (command:los-mask): its cells from now on,
   * announced as tower:los-resolved. A tower that waits for nothing takes
   * nothing (a second answer, one for a tower sold since), nor does one that
   * asked again since (`generation` of an older request). A mask without a
   * generation (a log from before generations) answers what waits.
   */
  applyMask(tower: Tower, mask: LosMask, generation?: number): boolean {
    const entry = this.awaiting.get(tower);
    if (entry === undefined) return false;
    if (generation !== undefined && generation !== entry.generation) return false;
    this.awaiting.delete(tower);
    this.grid.unregisterTower(tower.id);
    this.registerFromMask(tower, mask);
    this.eventBus.emit({ type: 'tower:los-resolved', towerId: tower.id, mask, reason: entry.reason });
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

  /**
   * A new run counts its generations from 1: the worker outlives the runs,
   * and a coop guest who joins fresh takes the host's masks only if both
   * counted alike (gsm.reset). A snapshot restore sets the counter itself.
   */
  newRun(): void {
    this.awaiting.clear();
    this.nextGeneration = 1;
  }

  isAwaiting(tower: Tower): boolean {
    return this.awaiting.has(tower);
  }

  /** The waiting towers with their reason and generation, oldest first (snapshots) */
  awaitingEntries(): [string, LosResolveReason, number][] {
    return [...this.awaiting].map(([tower, { reason, generation }]) => [tower.id, reason, generation]);
  }

  /** Generation of the next request (snapshots) */
  get generation(): number {
    return this.nextGeneration;
  }

  /**
   * Put the waiting towers back, oldest first, and the generation counter (a
   * snapshot restore). An entry without a generation (a snapshot from before
   * generations) gets a new one. A live restore asks for them again with the
   * same generations, so a coop client that restores the host's state takes
   * the host's answers. A replay's restore asks nothing, its masks come from
   * the log.
   */
  restoreAwaiting(
    entries: readonly (readonly [Tower, LosResolveReason, number?])[],
    nextGeneration: number | undefined,
    announce: boolean,
  ): void {
    this.awaiting.clear();
    if (nextGeneration !== undefined) this.nextGeneration = nextGeneration;
    for (const [tower, reason, generation] of entries) {
      const entry: LosAwait = { reason, generation: generation ?? this.nextGeneration++ };
      this.awaiting.set(tower, entry);
      if (announce) this.announce(tower, entry);
    }
  }
}
