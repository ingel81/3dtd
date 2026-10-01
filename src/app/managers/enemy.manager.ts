import { signal } from '@angular/core';
import { Vector3 } from 'three';
import { EntityManager } from './entity-manager';
import { Enemy } from '../entities/enemy.entity';
import { MovementComponent } from '../game-components/movement.component';
import { ENEMY_TYPES, EnemyTypeId, SplitOnDeath, enemyDeathDuration, enemyRewardWeight, leakDamageOf, REGEN_INTERVAL_MS } from '../configs/enemy-types.config';
import { GeoPosition, RouteWaypoint } from '../models/game.types';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import { GameEventBus, SubscriptionBag } from '../game-engine/game-event-bus';
import type { GameEvent } from '../game-engine/game-event-bus';
import { COMBAT_TUNING } from '../configs/combat-tuning.config';
import { waveMutator, waveRules } from '../director/wave-rules';
import type { DamageType } from '../configs/combat/combat.types';
import { airPortalExit, airPortalExitOffset, type AirPortalExit } from '../utils/air-portal-exit';
import type { StatusEffect } from '../models/status-effects';
import { portalCorridorWidth, portalScaleForWidth } from '../three-engine/renderers/marker/spawn-portal-pose';
import { WormChains, stepWormSegment } from './worm/worm-chains';
import type { WormGroup, WormLink } from './worm/worm-group';
import { OozeBodies } from './ooze-bodies';
import type { SimCoords } from '../sim/core/sim-coords';
import type { SimSink } from '../sim/core/sim-sink';
import type { KilledBy } from '../game-engine/game-event-bus';
import type { EnemiesState, SavedEnemy } from '../simulator/wave-snapshot';
import { assignPlainFields, decodeNumber, encodeNumber, plainFields } from '../simulator/plain-fields';

/**
 * How fast an enemy's feet may follow a corrected ground height (m/s).
 *
 * Cell samples can jump by metres when a finer tile lands. Easing into the
 * new value keeps that reading as the model settling rather than snapping.
 */
const ENEMY_GROUND_ADJUST_MPS = 8;

/**
 * With the perf panel open, the enemy loop times the phases of every Nth
 * enemy only and scales the sums up. Timing every enemy took six
 * performance.now() calls per enemy per sub-step: at 20k enemies over a
 * million a frame, more than some of the phases cost. The starting offset
 * rotates per sub-step, so every enemy is sampled once per N sub-steps and a
 * spawn pattern with period N cannot bias the estimate.
 */
const PROFILE_STRIDE = 32;

/**
 * Enemy fields a wave snapshot leaves out: identity and the route grid
 * memo's generation (restoreEnemyMemo)
 */
const ENEMY_NOT_SAVED = ['id', 'type', 'routeCellGen'];

/**
 * Why an enemy dies. A 'combat' kill (towers, damage over time) pays from
 * the wave's kill budget and splits a type with splitOnDeath. A 'debug' kill
 * (kill-all) does neither: the dev shortcut farms no gold and leaves nothing
 * of the wave.
 */
export type KillCause = 'combat' | 'debug';

/**
 * Where a spawn joins its path when it does not start on path[0]: a split
 * child where its parent died, all of it from the parent, or an enemy the
 * debugger placed on the route. Nothing is rolled.
 */
export interface SpawnStart {
  /** Segment, and progress (0-1) on it, see MovementComponent.setPath() */
  segmentIndex: number;
  segmentProgress: number;
  /** Place across the corridor, see MovementComponent.setLateralFactor() */
  lateralFactor: number;
  /** Air units' altitude offset, see MovementComponent.setHeightVariation() */
  heightVariation: number;
  /** Ground height (geo) at the start, the route grid's value under the parent */
  groundHeight: number;
}

/**
 * How a spawn enters its path:
 * - 'portal': out of the spawn portal on path[0], a wave spawn. An air unit
 *   flies out through the opening and climbs to its altitude
 *   (AIR_PORTAL_EXIT).
 * - a SpawnStart: part-way along it, a split child or a placed debug enemy.
 * - none: on path[0] at its type's height, a debug spawn.
 */
export type SpawnEntry = SpawnStart | 'portal';

/**
 * Manages all enemy entities - spawning, updating, and lifecycle
 *
 * Framework-agnostic, event-based:
 * - No @Injectable decorator
 * - Constructor injection
 * - Emits events: enemy:died, enemy:reached-base
 */
export class EnemyManager extends EntityManager<Enemy> {
  // Track enemies being killed to prevent double-kill
  private killingEnemies = new Set<string>();

  /**
   * The run's enemy stream (GameRng): lane offset and flight altitude. Default
   * `Math.random` for specs that build a manager without a seed; the game
   * wires the stream in `GameStateManager.initialize()`.
   */
  // eslint-disable-next-line no-restricted-properties -- fallback for specs; the game sets the enemy stream (setRandom)
  private random: () => number = () => Math.random();

  /** The seeded stream the enemies' lane and altitude draw from. */
  setRandom(random: () => number): void {
    this.random = random;
  }

  // Game-time pending removals: replaces wall-clock setTimeout for death-anim
  // delays so behavior is identical at every training timescale.
  private pendingDeaths: { enemy: Enemy; remainingMs: number }[] = [];

  // Reusable array to avoid allocations in update loop
  private toRemove: Enemy[] = [];

  // Reusable Vector3 for position conversion in update loop (avoids per-enemy allocation)
  private _tempLocalPos = new Vector3();

  /** Bodies of the oozes along their routes (OozeConfig) */
  private readonly oozes: OozeBodies;

  // Reactive signal for alive count (for UI bindings)
  readonly aliveCount = signal(0);

  // Debug toggle: skip movement + visual updates when false
  movementEnabled = true;

  // Cached alive enemies array (invalidated on spawn/kill/remove/clear)
  private cachedAliveEnemies: Enemy[] | null = null;

  // Wave-number provider: the gold budget of kill rewards and the damage of leaks, oozes included.
  // Set via setWaveNumberProvider() after construction (loose coupling).
  private getWaveNumber: () => number = () => 0;

  // Deterministic kill-reward accumulator. Splits the wave's gold budget
  // across its bodies by their base HP — the last paid kill picks up the
  // floor-rounding remainder so the total never exceeds the budget.
  // rewardWaveNumber triggers a reset when the wave changes.
  private rewardWaveNumber = -1;
  private remainingKillBudget = 0;
  private paidRewardWeight = 0;

  /** EventBus subscriptions — disposed in destroy(). */
  private readonly subs = new SubscriptionBag();

  /** Every worm (EnemyTypeConfig.chain) on the routes, ticked in update() */
  private readonly worms = new WormChains({
    spawnSegment: (group, link, paused) =>
      this.spawnOne(
        group.path, group.type.id, group.speedMps, paused,
        link.head ? group.headMaxHp : group.segmentMaxHp, group.start ?? undefined, link,
      ),
    // The head model is the worm type's own
    showAsHead: (enemy) => this.sink.enemies.setRenderType(enemy.id, enemy.typeConfig.id),
    showAsTail: (enemy) => {
      if (enemy.worm) this.sink.enemies.setRenderType(enemy.id, enemy.worm.group.chain.tailModel);
    },
  });

  /**
   * The ground (geo height) under a spawn the route grid has no cell for,
   * from the world (SimWorld.spawnGround); null where there is none.
   */
  private spawnGround: (at: GeoPosition) => number | null = () => null;

  constructor(
    private eventBus: GameEventBus,
    private globalRouteGrid: GlobalRouteGridService,
    private spatialGrid: SpatialGridService,
    private readonly coords: SimCoords,
    private readonly sink: SimSink,
  ) {
    super();
    this.oozes = new OozeBodies(globalRouteGrid, eventBus, () => this.getWaveNumber(), coords, sink);
  }

  /** See spawnGround */
  setSpawnGround(ground: (at: GeoPosition) => number | null): void {
    this.spawnGround = ground;
  }

  /** Every worm group on the routes (the packet's worm table) */
  get wormGroups(): readonly WormGroup[] {
    return this.worms.all;
  }

  /** The oozes' bodies (the packet's ooze table) */
  get oozeBodies(): OozeBodies {
    return this.oozes;
  }

  /**
   * The enemy debugger's remove (the debug:remove-enemy command). A debug
   * worm goes as a whole, the segments still in the portal with it, also
   * when the head Enemy Debug lists is dead already.
   */
  debugRemove(enemyId: string): void {
    const worm = this.worms.groupSpawnedWith(enemyId);
    if (worm) this.removeWorm(worm);
    const enemy = this.getAll().find(e => e.id === enemyId);
    if (enemy) {
      this.remove(enemy);
    }
  }

  /** The enemy debugger's spawn (the debug:spawn-enemy command); returns what it spawned. */
  debugSpawn(event: Extract<GameEvent, { type: 'debug:spawn-enemy' }>): Enemy[] {
    if (!event.path || event.path.length < 2) {
      console.warn('[EnemyManager] Debug spawn ignored - invalid path');
      return [];
    }

    const count = event.count ?? 1;
    const spawned: Enemy[] = [];
    for (let i = 0; i < count; i++) {
      spawned.push(this.spawn(
        event.path,
        event.enemyType as EnemyTypeId,
        event.speed,
        event.paused ?? false,
        event.health,
        event.start,
      ));
    }
    return spawned;
  }

  /** Remove every segment of `group` on the route; none comes out of the portal any more. */
  private removeWorm(group: WormGroup): void {
    group.dropPending();
    for (const segment of group.segments) {
      if (segment !== null) this.remove(segment);
    }
  }

  /**
   * Spawn a new enemy at the start of a path, out of its spawn portal, or
   * part-way along it (split children, see splitOnDeath()). See SpawnEntry.
   *
   * A type with a chain (the worm) puts its whole chain on the route, and
   * `healthOverride` is the HP of each segment. Returns the head; the other
   * segments come out where it did, out of the portal or at a SpawnStart
   * (Enemy Debug placement), as the chain moves (WormChains).
   */
  spawn(
    path: GeoPosition[],
    typeId: EnemyTypeId,
    speedOverride?: number,
    paused = false,
    healthOverride?: number,
    entry?: SpawnEntry,
  ): Enemy {
    const type = ENEMY_TYPES[typeId];
    const chain = type?.chain;
    if (chain) {
      const head = this.worms.spawn(
        path, type, chain, speedOverride ?? type.baseSpeed, healthOverride ?? type.baseHp, paused,
        typeof entry === 'object' ? entry : null,
      );
      if (head.worm !== null) {
        this.eventBus.emit({ type: 'worm:spawned', head, group: head.worm.group, viaPortal: entry === 'portal' });
      }
      return head;
    }
    return this.spawnOne(path, typeId, speedOverride, paused, healthOverride, entry, null);
  }

  /** One enemy, see spawn(). `worm` links a worm segment to its chain. */
  private spawnOne(
    path: GeoPosition[],
    typeId: EnemyTypeId,
    speedOverride: number | undefined,
    paused: boolean,
    healthOverride: number | undefined,
    entry: SpawnEntry | undefined,
    worm: WormLink | null,
  ): Enemy {
    const start = typeof entry === 'object' ? entry : undefined;
    const enemy = new Enemy(typeId, path, speedOverride, start?.segmentIndex, start?.segmentProgress);
    enemy.worm = worm;

    // Override health if specified
    if (healthOverride !== undefined) {
      enemy.health.resetMaxHp(healthOverride);
    }

    if (start) {
      // Split child: lane and altitude come from the parent, nothing is rolled
      enemy.movement.setLateralFactor(start.lateralFactor);
      enemy.movement.setHeightVariation(start.heightVariation);
    } else {
      // Random place across the corridor for movement variety: a share of the
      // room the street leaves, up to how far this type strays.
      const spread = enemy.typeConfig.lateralSpread ?? 0;
      if (spread > 0) {
        enemy.movement.setLateralFactor((this.random() * 2 - 1) * spread);
      }

      // Apply random height variation for air units
      if (enemy.typeConfig.heightVariation && enemy.typeConfig.heightVariation > 0) {
        const maxVar = enemy.typeConfig.heightVariation;
        const randomVar = (this.random() * 2 - 1) * maxVar;
        enemy.movement.setHeightVariation(randomVar);
      }
    }

    // Get height at spawn position - the parent's ground for a split child,
    // else prefer path height (smoothed) over live sampling
    const startPos = path[0];
    const sync = this.coords.sync;
    const origin = sync.getOrigin();
    let geoHeight: number;

    if (start) {
      geoHeight = start.groundHeight;
    } else if (startPos.height !== undefined && startPos.height !== 0) {
      // Path has pre-computed smoothed height - use it
      geoHeight = startPos.height;
    } else {
      // Fallback: the ground under the spawn from the route grid, the frozen
      // cells every coop client shares (TODO E63 b). Where the grid has
      // nothing, the ground the world measured under the spawn point
      // (SimWorld.spawnGround), the same for every client.
      let localTerrainY: number | null = null;
      if (this.globalRouteGrid.isInitialized()) {
        sync.geoToLocalSimpleInto(startPos.lat, startPos.lon, 0, this._tempLocalPos);
        localTerrainY = this.globalRouteGrid.getGroundLocalYAt(this._tempLocalPos.x, this._tempLocalPos.z);
      }
      // geoToLocalSimple does: Y = height - originHeight
      geoHeight = localTerrainY !== null ? localTerrainY + origin.height : this.spawnGround(startPos) ?? origin.height;
    }

    enemy.transform.terrainHeight = geoHeight;

    // Apply height variation to initial spawn height (for air units)
    const heightVar = enemy.movement.getHeightVariation();
    if (heightVar !== 0) {
      geoHeight += heightVar;
      enemy.transform.terrainHeight = geoHeight;
    }

    // A wave spawn comes out of the spawn portal on path[0]. An air unit
    // flies out through the middle of the opening and climbs to its
    // altitude on the way (update()); a ground unit is at its height there.
    if (entry === 'portal' && enemy.typeConfig.isAirUnit) {
      const exit = this.portalExitFor(enemy, path[0]);
      enemy.portalExit = exit;
      enemy.heightOffset = exit.from;
    }

    // Create 3D model and start animation. `position` is path[0], or the
    // split start on the centre line; the first step adds the lane offset.
    // An ooze has no model instance: its body lies along the route. A worm's
    // body segments are drawn with the segment model, its last with the tail.
    if (enemy.typeConfig.ooze) {
      this.oozes.attach(enemy);
    } else {
      const renderType = worm === null || worm.head
        ? typeId
        : worm.tail ? worm.group.chain.tailModel : worm.group.chain.segmentModel;
      this.sink.enemies.create(enemy.id, renderType, enemy.position.lat, enemy.position.lon, geoHeight + enemy.heightOffset, !paused);
    }

    if (paused) {
      enemy.movement.pause();
    } else {
      enemy.startMoving();
    }

    this.add(enemy);
    this.aliveCount.update(c => c + 1);
    this.cachedAliveEnemies = null; // Invalidate cache

    // Emit enemy:spawned event for AI tracking
    this.eventBus.emit({
      type: 'enemy:spawned',
      enemy,
      viaPortal: entry === 'portal',
    });

    return enemy;
  }

  /**
   * An air unit's way out of the portal on `start`, see airPortalExit(). The
   * portal's scale follows the corridor there, as MarkerVisualizationService
   * stands it; the body is the model's range from its config (modelRangeY);
   * a type without one counts as a point at its origin.
   */
  private portalExitFor(enemy: Enemy, start: RouteWaypoint): AirPortalExit {
    const range = enemy.typeConfig.modelRangeY;
    const scale = enemy.typeConfig.scale;
    return airPortalExit(
      portalScaleForWidth(portalCorridorWidth(start)),
      range !== undefined ? range.min * scale : 0,
      range !== undefined ? range.max * scale : 0,
      enemy.movement.getHeightVariation(),
      enemy.typeConfig.heightOffset,
    );
  }

  /**
   * Set the wave-number provider (from WaveManager).
   * Used for the kill-reward budget and the damage of leaks, oozes included.
   * Loose coupling — no direct WaveManager dependency.
   */
  setWaveNumberProvider(provider: () => number): void {
    this.getWaveNumber = provider;
  }

  /**
   * Set the wave-weight provider from WaveManager: the reward weight of every
   * body the wave can field, split children included (getExpectedBodyWeight).
   * Kill gold is spread by it.
   */
  setWaveWeightProvider(provider: () => number): void {
    this.getWaveWeight = provider;
  }

  private getWaveWeight: () => number = () => 1;

  /**
   * Set the lane count of the wave (WaveManager.getWaveLaneCount): in coop
   * every lane gets the whole wave, and the kill gold of the wave once per
   * lane, so a kill pays what it pays alone. Without it the budget was spread
   * over both lanes' enemies and each player earned half the kill gold.
   */
  setWaveLaneCountProvider(provider: () => number): void {
    this.getWaveLaneCount = provider;
  }

  private getWaveLaneCount: () => number = () => 1;

  /**
   * Calculate kill reward from the wave's deterministic kill-budget
   * (Phase 5.16): the campaign pins a total per-wave gold amount which
   * we split deterministically across the expected bodies. Effect:
   *  - Income predictable wave-by-wave → balanceable against tower/research costs
   *  - Independent of NN's count/hp_mult choices (no swarm-flood, no boring-dribble)
   *  - Leaks naturally reduce earnings (uncollected kills = lost gold)
   *
   * Each body weighs its base HP (enemyRewardWeight): a Herbert pays for
   * what it takes to kill it, a zombie of the same wave a fraction of that
   * (User, 2026-09-23; before, every body paid the same share).
   *
   * Accumulator pattern: `floor(remainingBudget × weight / remainingWeight)`
   * per paid kill, then decrement both. The last body picks up the rounding
   * remainder so the SUM of rewards equals the budget exactly when every
   * enemy dies — the W19 rat_tide bug paid 5000g for a 305g budget. Kills
   * past the wave's weight pay 0g.
   *
   * Split children weigh their own base HP: a skeleton and its two minions
   * pay each, a leaked skeleton forfeits all three, and a split never raises
   * the wave's gold.
   */
  /**
   * Forget the kill gold of the current wave, so the next kill starts the
   * budget of its wave afresh. The budget resets when the wave number
   * changes; a snapshot restore can bring back a wave number that already
   * paid (a replay runs wave N again), so it calls this.
   */
  resetKillRewards(): void {
    this.rewardWaveNumber = -1;
    this.remainingKillBudget = 0;
    this.paidRewardWeight = 0;
  }

  private calculateDynamicReward(enemy: Enemy): number {
    const wave = this.getWaveNumber();

    if (wave !== this.rewardWaveNumber) {
      this.rewardWaveNumber = wave;
      this.remainingKillBudget = waveRules().gold(wave).kill * Math.max(1, this.getWaveLaneCount());
      this.paidRewardWeight = 0;
    }

    // The wave's weight is read on every kill: a worm adds its segments to
    // the wave when it spawns, which can be after the wave's first kill.
    const weight = enemyRewardWeight(enemy.typeConfig.baseHp);
    const left = Math.max(1, this.getWaveWeight()) - this.paidRewardWeight;
    if (left <= 0 || this.remainingKillBudget <= 0) {
      return 0;
    }

    // The last body takes the remainder; the tolerance absorbs float drift in the weights
    const reward = weight >= left - 1e-9
      ? this.remainingKillBudget
      : Math.floor((this.remainingKillBudget * weight) / left);
    this.remainingKillBudget -= reward;
    this.paidRewardWeight += weight;
    return reward;
  }

  /**
   * Kill an enemy — plays death animation then removes after a game-time
   * delay (no wall-clock setTimeout — sub-stepping ticks the delay each frame).
   *
   * A 'combat' kill pays from the wave's kill budget and splits a type with
   * splitOnDeath. A 'debug' kill (kill-all) does neither, so the player can't
   * farm gold via the dev shortcut and nothing of the wave is left.
   *
   * `killedBy` says who gets the kill; the run log counts kills by source
   * from it (docs/RUN_LOG.md). null means nobody is credited.
   *
   * Returns false if the enemy is already dying or has left the manager;
   * nothing happens then, so callers that credit the kill must check the
   * result.
   *
   * The second guard is the leak: remove() takes an enemy out of the game
   * but leaves its HP, and every "is this target still valid" check asks
   * `alive` (Tower.findTarget's sticky fast path, Projectile.targetLost).
   * A tower that holds a leaked enemy, or a shot that was in the air when it
   * went through, therefore still reaches it, and the hit that takes its
   * last HP used to run this whole path on a body that was already booked as
   * a leak: a second enemy:died for it and a second decrement of aliveCount,
   * which Math.max(0, c - 1) then swallows for good (TODO E11).
   */
  kill(enemy: Enemy, cause: KillCause = 'combat', killedBy: KilledBy | null = null): boolean {
    if (this.killingEnemies.has(enemy.id)) return false;
    if (this.getById(enemy.id) !== enemy) return false;
    this.killingEnemies.add(enemy.id);

    this.aliveCount.update(c => Math.max(0, c - 1));
    this.cachedAliveEnemies = null;

    // Read before stopMoving() pauses it: an idle (debug) parent's children stay idle
    const wasPaused = enemy.movement.paused;
    if (!enemy.health.isDead) {
      enemy.health.takeDamage(enemy.health.hp);
    }
    enemy.stopMoving();

    const combat = cause === 'combat';
    // Before enemy:died, so its listeners see what is left of the worm
    const worm = enemy.worm;
    if (worm !== null) {
      worm.group.lose(worm.slot);
      // Kill-all leaves nothing of the wave, the rest of the worm included
      if (!combat) worm.group.dropPending();
    }
    const credits = combat ? this.calculateDynamicReward(enemy) : 0;
    this.eventBus.emit({ type: 'enemy:died', enemy, credits, killedBy });
    // A dying ooze stops bubbling and splats (OozeBodies)
    if (enemy.body !== null) this.oozes.died(enemy);

    // Before the removal below: the children start from the parent's place
    const split = enemy.typeConfig.splitOnDeath;
    if (combat && split) this.splitOnDeath(enemy, split, wasPaused);

    const hasDeathAnim =
      !!enemy.typeConfig.deathAnimation ||
      (enemy.typeConfig.deathAnimations?.length ?? 0) > 0;
    if (hasDeathAnim) {
      this.sink.enemies.playDeathAnimation(enemy.id);
      this.pendingDeaths.push({
        enemy,
        remainingMs: enemyDeathDuration(enemy.typeConfig),
      });
    } else {
      this.killingEnemies.delete(enemy.id);
      this.remove(enemy);
    }
    return true;
  }

  /** Start of the split child being spawned, refilled per child (spawn() reads it, keeps nothing). */
  private readonly splitStart: SpawnStart = {
    segmentIndex: 0,
    segmentProgress: 0,
    lateralFactor: 0,
    heightVariation: 0,
    groundHeight: 0,
  };

  /**
   * Spawn what a killed enemy splits into, on its path where it died.
   *
   * Runs inside kill(), in the sub-step that dealt the killing damage, so in
   * game time. Nothing is rolled: the children take the parent's segment and
   * progress, lanes spread by index around the parent's lane (inside the room
   * their own lateralSpread allows), its ground and altitude, and its HP and
   * speed multipliers, so a wave's hpMult reaches them too. A kill inside the
   * movement pass (damage over time) adds them to the entity list after the
   * pass took its snapshot, so they first move in the next sub-step.
   */
  private splitOnDeath(parent: Enemy, split: SplitOnDeath, paused: boolean): void {
    const childType = ENEMY_TYPES[split.type];
    if (!childType || split.count <= 0) return;

    const pm = parent.movement;
    const hpScale = parent.health.maxHp / parent.typeConfig.baseHp;
    const speedScale = pm.speedMps / parent.typeConfig.baseSpeed;
    const room = childType.lateralSpread ?? 0;
    const spread = Math.min(split.spread, room);
    const centre = Math.max(spread - room, Math.min(room - spread, pm.getLateralFactor()));

    const start = this.splitStart;
    start.segmentIndex = pm.currentIndex;
    start.segmentProgress = pm.progress;
    start.heightVariation = pm.getHeightVariation();
    start.groundHeight = parent.transform.terrainHeight - start.heightVariation;

    // An ooze breaks up along its body, into as many clumps as its length
    // holds, their lanes scattered by index (OozeBodies)
    const body = parent.body !== null;
    const count = body ? this.oozes.splitCount(parent, split.count) : split.count;
    const children: Enemy[] = [];
    for (let i = 0; i < count; i++) {
      // -1 .. 1 across the children, 0 for a single one
      const side = body
        ? ((i * 0.618034) % 1) * 2 - 1
        : count > 1 ? (2 * i) / (count - 1) - 1 : 0;
      start.lateralFactor = centre + side * spread;
      if (body) this.oozes.placeSplitChild(parent, i, count, start);
      children.push(this.spawn(
        pm.path,
        split.type,
        childType.baseSpeed * speedScale,
        paused,
        childType.baseHp * hpScale,
        start,
      ));
    }
    this.eventBus.emit({ type: 'enemy:split', enemy: parent, children });
  }

  // Performance profiling callback, set while the perf panel is open
  // (GameStateManager.setProfiler). move/grid/height are sampled estimates
  // (see PROFILE_STRIDE); total is measured.
  onProfileTiming: ((move: number, grid: number, height: number, total: number) => void) | null = null;

  /** Rotating start offset of the profiled enemies, see PROFILE_STRIDE. */
  private profileSampleOffset = 0;

  /**
   * Regeneration, every REGEN_INTERVAL_MS of game time: each living enemy
   * heals its type's share (regenPerSecond, the Regen trait) plus the wave's
   * (the Regeneration mutator), none while it burns. On the game clock and
   * the status effects alone, so a restored snapshot heals on the same
   * sub-steps. Worm segments and route bodies keep their own HP.
   */
  private tickRegeneration(deltaTime: number, gameTimeMs: number): void {
    if (Math.floor(gameTimeMs / REGEN_INTERVAL_MS) === Math.floor((gameTimeMs - deltaTime) / REGEN_INTERVAL_MS)) return;
    const wavePerSecond = waveMutator(this.getWaveNumber())?.regenPerSecond ?? 0;
    const step = REGEN_INTERVAL_MS / 1000;
    for (const enemy of this.getAllActive()) {
      if (!enemy.alive || enemy.worm !== null || enemy.body) continue;
      const perSecond = wavePerSecond + (enemy.typeConfig.regenPerSecond ?? 0);
      if (perSecond === 0) continue;
      const health = enemy.health;
      if (health.hp >= health.maxHp || enemy.movement.isBurning(gameTimeMs)) continue;
      health.heal(health.maxHp * perSecond * step);
    }
  }

  /**
   * Update all enemies — movement and rendering. Called once per gameplay
   * sub-step (~16ms game-time). `gameTimeMs` is the engine game-clock used
   * for DoT ticks, status-effect lookups, and pending death delays.
   */
  override update(deltaTime: number, gameTimeMs: number): void {
    // Tick pending death-animation removals FIRST so they remain accurate
    // even if movement is disabled.
    this.tickPendingDeaths(deltaTime);

    if (!this.movementEnabled) return;

    // Worms first: their segments go where the chains put them, and segments
    // that come out of the portal now join the loop below
    this.worms.tick(deltaTime, gameTimeMs);
    this.tickRegeneration(deltaTime, gameTimeMs);

    const profiling = this.onProfileTiming !== null;
    let tMove = 0, tGrid = 0, tHeight = 0;
    let processed = 0, sampled = 0;
    const sampleOffset = profiling ? this.profileSampleOffset++ % PROFILE_STRIDE : 0;
    const tTotal = profiling ? performance.now() : 0;

    this.toRemove.length = 0;
    const sync = this.coords.sync;
    const originHeight = sync.getOrigin().height;

    for (const enemy of this.getAllActive()) {
      // `alive` reads a mirror kept on the enemy (Enemy.deadFlag), so this
      // check no longer loads the health component.
      if (!enemy.alive) continue;

      const sample = profiling && (processed++ + sampleOffset) % PROFILE_STRIDE === 0;
      if (sample) sampled++;

      let t0 = sample ? performance.now() : 0;
      // Deliberately NOT the generic enemy.update(): of the enemy components
      // only transform (rotation lerp) does per-tick work — health, render
      // and movement have empty update() bodies, and iterating the component
      // Map with polymorphic calls per enemy per sub-step was pure overhead
      // at 10k+ enemies.
      // GameObject.update() remains for towers/projectiles.
      // `enabled` is honoured because the generic path did — nothing sets it
      // false on an enemy today, but silently ignoring it would be a trap.
      // The transform's only work is easing `rotation` toward the heading.
      // `isTurning` mirrors "initialized and rotation !== target", the exact
      // condition under which update() does anything, so skipping on it is
      // the early-out update() would take. Movement holds the heading per
      // segment, so this is true only for a few sub-steps after a corner.
      if (enemy.isTurning && enemy.transform.enabled) enemy.transform.update(deltaTime);
      // Single-pass: remove expired effects + get the status flags (game-time).
      // Without effects the array is not loaded at all (hasStatusEffects).
      const statusFlags = enemy.movement.hasStatusEffects
        ? enemy.movement.updateStatusEffects(gameTimeMs)
        : MovementComponent.NO_STATUS;
      // Walk/run alternation (wallsmasher). Ticked before move() so the
      // multiplier takes effect in the sub-step that sets it. Only enemies
      // that carry the state pay for it; everyone else keeps multiplier 1.
      // Paused enemies (pending start, debug, dying) and halted ones (freeze)
      // do not advance it.
      if (enemy.rush !== null && !enemy.movement.paused && !statusFlags.isHalted) {
        enemy.movement.speedMultiplier = enemy.rush.tick(deltaTime);
      }
      // A worm segment goes where its chain put it (worms.tick above)
      const moveResult = enemy.worm === null
        ? enemy.movement.move(deltaTime, gameTimeMs, statusFlags.slowMultiplier)
        : stepWormSegment(enemy, enemy.worm);
      if (sample) tMove += performance.now() - t0;

      // An ooze flows into the base over many sub-steps (OozeBodies.update)
      if (moveResult === 'reached_end' && enemy.body === null) {
        // What its type costs (leakDamageOf), scaled with the wave number
        // (Phase 5.16) so late-game leaks hurt more. A worm segment pays its
        // share of the whole worm's.
        const typeDamage = enemy.worm === null
          ? leakDamageOf(enemy.typeConfig.id as EnemyTypeId)
          : leakDamageOf('worm') / Math.max(1, enemy.worm.group.size);
        this.eventBus.emit({
          type: 'enemy:reached-base',
          enemy,
          damage: typeDamage * waveRules().leakScale(this.getWaveNumber()),
        });
        this.toRemove.push(enemy);
        continue;
      }

      // On the way out of the spawn portal an air unit's height follows the
      // distance it has flown along the route, the same at every timescale.
      // Once it is up it cruises at its type's height.
      const exit = enemy.portalExit;
      if (exit !== null) {
        const flown = enemy.movement.getDistanceAlongPath();
        enemy.heightOffset = airPortalExitOffset(exit, flown);
        if (flown >= exit.climbEnd) enemy.portalExit = null;
      }

      // Update global route grid position for O(1) tower targeting
      // Also update spatial grid for O(1) proximity queries (sleep wake-checks, fallback targeting)
      t0 = sample ? performance.now() : 0;
      // Compute local position ONCE, reused for grid update AND ground read below
      sync.geoToLocalSimpleInto(
        enemy.position.lat,
        enemy.position.lon,
        0, // Height not needed for X/Z cell lookup
        this._tempLocalPos
      );
      // Both grids keep a memo on the enemy (route cell, spatial entry) and
      // skip their string-keyed lookups while it holds (see
      // GlobalRouteGrid.updateEnemyPosition and SpatialGrid.updateTracked).
      // The spatial entry still gets the exact x/z every sub-step, since
      // proximity queries filter on them. A body along the route (ooze) is
      // in neither: the route grid keeps it in its body list.
      if (enemy.body === null) {
        if (this.globalRouteGrid.isInitialized()) {
          this.globalRouteGrid.updateEnemyPosition(enemy, this._tempLocalPos.x, this._tempLocalPos.z);
        }
        enemy.spatialEntry = this.spatialGrid.updateEnemyTracked(
          enemy.spatialEntry,
          enemy.id,
          this._tempLocalPos.x,
          this._tempLocalPos.z,
        );
      }
      if (sample) tGrid += performance.now() - t0;

      // Ground comes from the route grid, per frame.
      //
      // It used to come from heights baked into the path at route-build time.
      // Those never updated: the grid self-heals as tiles refine, the bake did
      // not, so a route built during the coarse-LOD phase kept walking enemies
      // at whatever height that phase reported — rooftop level in a dense city.
      // The grid is the single ground truth for feet, route line and LOS, so
      // read it directly (a cell lookup, no raycast) and let the same healing
      // carry the enemies.
      t0 = sample ? performance.now() : 0;

      let geoHeight = enemy.transform.terrainHeight;
      if (this.globalRouteGrid.isInitialized()) {
        // Reuses the cell updateEnemyPosition() just resolved above: the
        // value getGroundLocalYAt() would return, minus the Map probe.
        const cellY = this.globalRouteGrid.getGroundLocalYForEnemy(
          enemy,
          this._tempLocalPos.x,
          this._tempLocalPos.z,
        );
        if (cellY !== null) {
          // Air units carry their spread here rather than in the movement
          // component, where it used to be folded into terrainHeight each step.
          const target = cellY + originHeight + enemy.movement.getHeightVariation();
          // Cell refreshes can move ground by metres in one frame. Ease into
          // it so a streaming correction reads as the enemy settling rather
          // than teleporting.
          const delta = target - geoHeight;
          const maxStep = ENEMY_GROUND_ADJUST_MPS * (Math.min(deltaTime, 100) / 1000);
          geoHeight += Math.abs(delta) <= maxStep ? delta : Math.sign(delta) * maxStep;
          enemy.transform.terrainHeight = geoHeight;
        }
      }
      if (sample) tHeight += performance.now() - t0;

      // Damage over time (poison, burn). This lives here and NOT in the visual
      // pass: it emits `dot:damage`, so it is gameplay, and it has to tick once
      // per sub-step or DoT damage would change with the frame rate.
      if (statusFlags.isPoisoned || statusFlags.isBurning) {
        this.tickDamageOverTime(enemy, deltaTime);
      }
    }

    // The oozes' bodies follow their tips; those fully in the base leak
    this.oozes.update(deltaTime, gameTimeMs, this.toRemove);

    // Remove enemies that reached base
    for (const enemy of this.toRemove) {
      this.remove(enemy);
    }

    if (profiling) {
      // Phases were timed on every PROFILE_STRIDE-th enemy; scale the sums
      // to the whole loop
      const scale = sampled > 0 ? processed / sampled : 0;
      this.onProfileTiming!(tMove * scale, tGrid * scale, tHeight * scale, performance.now() - tTotal);
    }
  }

  /**
   * One sub-step of every damage-over-time effect on `enemy`.
   *
   * Each poison or burn entry keeps its own game-time accumulator
   * (`tickAccumMs`) and fires one `dot:damage` each time it crosses the
   * type's tick interval, DPS scaled to the interval (500 ms tick = DPS × 0.5).
   * Robust at any timescale because ticks never depend on wall-clock time.
   * The accumulator lives on the effect: it survives refreshes (see
   * MovementComponent.applyStatusEffect) and ends exactly when the effect
   * expires, so a partial interval never carries into the next application.
   */
  private tickDamageOverTime(enemy: Enemy, deltaTime: number): void {
    for (const effect of enemy.movement.statusEffects) {
      let interval: number;
      let damageType: DamageType;
      if (effect.type === 'poison') {
        interval = COMBAT_TUNING.poisonTickIntervalMs;
        damageType = 'poison';
      } else if (effect.type === 'burn') {
        interval = COMBAT_TUNING.burnTickIntervalMs;
        damageType = 'fire';
      } else {
        continue;
      }

      let acc = (effect.tickAccumMs ?? 0) + deltaTime;
      if (acc >= interval) {
        const tickDamage = effect.value * (interval / 1000);
        while (acc >= interval) {
          this.eventBus.emit({
            type: 'dot:damage',
            enemy,
            damage: tickDamage,
            sourceId: effect.sourceId ?? '',
            effectType: effect.type,
            damageType,
          });
          acc -= interval;
        }
      }
      effect.tickAccumMs = acc;
    }
  }

  /** Tick the game-time death-animation removals each sub-step. */
  private tickPendingDeaths(deltaTime: number): void {
    if (this.pendingDeaths.length === 0) return;
    let writeIdx = 0;
    for (const entry of this.pendingDeaths) {
      entry.remainingMs -= deltaTime;
      if (entry.remainingMs <= 0) {
        this.killingEnemies.delete(entry.enemy.id);
        this.remove(entry.enemy);
      } else {
        this.pendingDeaths[writeIdx++] = entry;
      }
    }
    this.pendingDeaths.length = writeIdx;
  }

  /**
   * Remove enemy and cleanup resources.
   *
   * NOTE: does NOT splice the pendingDeaths array — that
   * would re-entrantly mutate tickPendingDeaths's iteration. The tick
   * methods are the sole owners of those arrays and drop the id from
   * killingEnemies themselves before calling remove(). The killingEnemies
   * delete here is purely defensive in case some external path (debug
   * event, direct remove) bypasses the pending-tick flow.
   */
  override remove(entity: Enemy): void {
    if (entity.alive) {
      this.aliveCount.update(c => Math.max(0, c - 1));
      this.cachedAliveEnemies = null;
    }
    // Safe: Set delete is not being iterated elsewhere in this call chain
    this.killingEnemies.delete(entity.id);
    // Through at the HQ or removed: a gap in its worm (a kill made it one already)
    if (entity.worm !== null) entity.worm.group.lose(entity.worm.slot);
    // Remove from global route grid and spatial grid
    this.globalRouteGrid.removeEnemy(entity);
    this.spatialGrid.removeEnemy(entity.id);
    this.sink.enemies.remove(entity.id);
    if (entity.body !== null) this.oozes.detach(entity);
    super.remove(entity);
  }

  /**
   * Read-only snapshot of pending death-animation entries for diagnostics.
   * Each entry pairs an enemy id with the remaining game-time delay in ms.
   */
  getPendingDeathsSnapshot(): { id: string; remainingMs: number }[] {
    return this.pendingDeaths.map((p) => ({ id: p.enemy.id, remainingMs: p.remainingMs }));
  }

  /**
   * Clear all enemies and cleanup resources
   */
  override clear(): void {
    // Clear pending game-time death delays
    this.pendingDeaths.length = 0;
    this.worms.clear();

    for (const enemy of this.getAll()) {
      this.globalRouteGrid.removeEnemy(enemy);
    }

    // Clear spatial grid
    this.spatialGrid.clear();

    this.sink.enemies.clear();
    this.oozes.clear();
    this.killingEnemies.clear();

    super.clear();
    this.aliveCount.set(0);
    this.cachedAliveEnemies = null; // Invalidate cache
  }

  /**
   * Get all alive enemies (cached per frame)
   */
  getAlive(): Enemy[] {
    if (this.cachedAliveEnemies === null) {
      this.cachedAliveEnemies = this.getAll().filter((e) => e.alive);
    }
    return this.cachedAliveEnemies;
  }

  /**
   * Get count of enemies currently in death animation (killed but not yet removed)
   */
  getKillingCount(): number {
    return this.killingEnemies.size;
  }

  /**
   * Worm segments still inside the spawn portal (WormChains). No enemies
   * yet, but the wave is not over before they have come out and are beaten.
   */
  getPendingSpawnCount(): number {
    return this.worms.pendingCount();
  }

  /**
   * Get count of alive enemies (uses signal, no array allocation)
   */
  getAliveCount(): number {
    return this.aliveCount();
  }

  /**
   * The enemies mid-wave as plain data (wave-snapshot.ts): every enemy with
   * its components' fields, the death animations, the kill gold of the wave
   * and the route grid's cells. `pathId` names the spawn point of a route.
   */
  captureWaveState(pathId: (path: readonly GeoPosition[]) => string | null): Omit<EnemiesState, 'ghosts'> {
    return {
      worms: this.worms.captureWaveState(pathId),
      oozes: this.oozes.captureWaveState(),
      enemies: this.getAll().map((enemy) => this.saveEnemy(enemy, pathId)),
      pendingDeaths: this.pendingDeaths.map((p) => [p.enemy.id, encodeNumber(p.remainingMs)]),
      killing: [...this.killingEnemies],
      rewards: plainFields({
        rewardWaveNumber: this.rewardWaveNumber,
        remainingKillBudget: this.remainingKillBudget,
        paidRewardWeight: this.paidRewardWeight,
      }),
      cells: this.globalRouteGrid.captureEnemyCells(),
    };
  }

  /** One enemy with its components' fields, see captureWaveState */
  saveEnemy(enemy: Enemy, pathId: (path: readonly GeoPosition[]) => string | null): SavedEnemy {
    const id = pathId(enemy.movement.path);
    if (id === null) throw new Error(`Enemy ${enemy.id} walks a route of no spawn point`);
    const m = enemy.movement;
    return {
      id: enemy.id,
      typeId: enemy.typeConfig.id as EnemyTypeId,
      pathId: id,
      entity: plainFields(enemy, ENEMY_NOT_SAVED),
      cellCurrent: this.globalRouteGrid.enemyMemoCurrent(enemy),
      position: plainFields(enemy.position),
      transform: plainFields(enemy.transform),
      health: plainFields(enemy.health),
      movement: plainFields(m),
      statusEffects: m.statusEffects.map((effect) => plainFields(effect)),
      rush: enemy.rush ? plainFields(enemy.rush) : null,
      portalExit: enemy.portalExit ? plainFields(enemy.portalExit) : null,
      worm: this.saveWormLink(enemy.worm),
    };
  }

  /** A segment's link with its group as an index into the worm groups; null for a group gone */
  private saveWormLink(link: WormLink | null): SavedEnemy['worm'] {
    if (link === null) return null;
    const group = this.worms.all.indexOf(link.group);
    if (group < 0) return null;
    return {
      group, slot: link.slot, head: link.head, tail: link.tail,
      target: encodeNumber(link.target), lateral: encodeNumber(link.lateral),
    };
  }

  /**
   * The enemy saveEnemy() took, built anew and not added to the manager. The
   * caller sets the GameObject id counter first, so it gets its id again.
   */
  loadEnemy(saved: SavedEnemy, path: GeoPosition[]): Enemy {
    const enemy = new Enemy(saved.typeId, path);
    const worm = saved.worm;
    const group = worm ? this.worms.all[worm.group] : undefined;
    if (worm && group) {
      enemy.worm = {
        group, slot: worm.slot, head: worm.head, tail: worm.tail,
        target: decodeNumber(worm.target), lateral: decodeNumber(worm.lateral),
      };
    }
    if (enemy.id !== saved.id) throw new Error(`Enemy ${saved.id} came back as ${enemy.id}`);
    const m = enemy.movement;
    // The lane's limits and the height variation first, then every field as it was
    m.setLateralFactor(decodeNumber(saved.movement['lateralFactor'] as number | string));
    m.setHeightVariation(decodeNumber(saved.movement['heightVariationMeters'] as number | string));
    assignPlainFields(enemy, saved.entity);
    assignPlainFields(enemy.position, saved.position);
    assignPlainFields(enemy.transform, saved.transform);
    assignPlainFields(enemy.health, saved.health);
    assignPlainFields(m, saved.movement);
    m.statusEffects = saved.statusEffects.map((effect) => {
      const out = {} as StatusEffect;
      assignPlainFields(out, effect);
      return out;
    });
    if (enemy.rush && saved.rush) assignPlainFields(enemy.rush, saved.rush);
    if (saved.portalExit) {
      const exit = {} as AirPortalExit;
      assignPlainFields(exit, saved.portalExit);
      enemy.portalExit = exit;
    }
    this.globalRouteGrid.restoreEnemyMemo(enemy, saved.cellCurrent);
    return enemy;
  }

  /**
   * Put the enemies of captureWaveState() back, after clear(). `beforeEach`
   * sets the GameObject id counter before each enemy is built.
   */
  restoreWaveState(state: Omit<EnemiesState, 'ghosts'>, pathOf: (id: string) => GeoPosition[], beforeEach: (id: string) => void): void {
    const groups = this.worms.restoreWaveState(state.worms, pathOf, (id) => ENEMY_TYPES[id as EnemyTypeId]);
    for (const saved of state.enemies) {
      beforeEach(saved.id);
      const enemy = this.loadEnemy(saved, pathOf(saved.pathId));
      const m = enemy.movement;
      const link = enemy.worm;
      const renderType = link === null || link.head ? saved.typeId : link.tail ? link.group.chain.tailModel : link.group.chain.segmentModel;
      if (!enemy.typeConfig.ooze) {
        this.sink.enemies.create(
          enemy.id, renderType, enemy.position.lat, enemy.position.lon,
          enemy.transform.terrainHeight + enemy.heightOffset, enemy.alive && !m.paused,
        );
      }
      this.add(enemy);
      if (enemy.alive) this.aliveCount.update((c) => c + 1);
    }
    this.cachedAliveEnemies = null;
    const byId = (id: string) => this.getById(id);
    state.worms.groups.forEach((saved, i) => groups[i].restoreSegments(saved.state, byId));
    this.oozes.restoreWaveState(state.oozes, byId);
    for (const [id, remainingMs] of state.pendingDeaths) {
      const enemy = byId(id);
      if (enemy) this.pendingDeaths.push({ enemy, remainingMs: decodeNumber(remainingMs) });
    }
    for (const id of state.killing) this.killingEnemies.add(id);
    const rewards = { rewardWaveNumber: -1, remainingKillBudget: 0, paidRewardWeight: 0 };
    assignPlainFields(rewards, state.rewards);
    this.rewardWaveNumber = rewards.rewardWaveNumber;
    this.remainingKillBudget = rewards.remainingKillBudget;
    this.paidRewardWeight = rewards.paidRewardWeight;
    this.globalRouteGrid.restoreEnemyCells(state.cells, byId);
  }

  /**
   * Destroy the enemy manager - cleanup all resources and timeouts
   */
  override destroy(): void {
    this.subs.disposeAll();
    this.pendingDeaths.length = 0;
    this.killingEnemies.clear();
    this.oozes.clear();
    super.destroy();
  }
}
