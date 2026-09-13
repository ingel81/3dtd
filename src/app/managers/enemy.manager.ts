import { signal } from '@angular/core';
import { Vector3 } from 'three';
import { EntityManager } from './entity-manager';
import { Enemy } from '../entities/enemy.entity';
import { ENEMY_TYPES, EnemyTypeId, SplitOnDeath } from '../configs/enemy-types.config';
import { GeoPosition, RouteWaypoint } from '../models/game.types';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import { ThreeTilesEngine } from '../three-engine';
import { GameEventBus, SubscriptionBag } from '../game-engine';
import { TIMING } from '../configs/timing.config';
import { COMBAT_TUNING } from '../configs/combat-tuning.config';
import { goldBudgetForWave, enemyBaseDamageForWave } from '../configs/wave-curriculum.config';
import type { DamageType } from '../configs/combat/combat.types';
import { airPortalExit, airPortalExitOffset, type AirPortalExit } from '../utils/air-portal-exit';
import { getEnemyModelRangeY } from '../utils/enemy-aim.util';
import { portalCorridorWidth, portalScaleForWidth } from '../three-engine/renderers/marker/spawn-portal-pose';
import { WormChains, stepWormSegment } from './worm/worm-chains';
import type { WormLink } from './worm/worm-group';

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

  // Game-time pending removals: replaces wall-clock setTimeout for death-anim
  // delays so behavior is identical at every training timescale.
  private pendingDeaths: { enemy: Enemy; remainingMs: number }[] = [];
  // Game-time pending start-moving: replaces setTimeout in startAll()
  private pendingStarts: { enemy: Enemy; remainingMs: number }[] = [];

  // Reusable array to avoid allocations in update loop
  private toRemove: Enemy[] = [];

  // Track enemies with active frost visual (for state-change detection)
  private frozenVisualEnemies = new Set<string>();

  // Track enemies with active poison visual
  private poisonVisualEnemies = new Set<string>();

  // Track enemies with active burn visual (tint only)
  private burnVisualEnemies = new Set<string>();

  // Reusable Vector3 for position conversion in update loop (avoids per-enemy allocation)
  private _tempLocalPos = new Vector3();

  // Reactive signal for alive count (for UI bindings)
  readonly aliveCount = signal(0);

  // Debug toggle: skip movement + visual updates when false
  movementEnabled = true;

  // Cached alive enemies array (invalidated on spawn/kill/remove/clear)
  private cachedAliveEnemies: Enemy[] | null = null;

  // Wave-number provider (for WaveFactor in kill-reward formula).
  // Set via setWaveNumberProvider() after construction (loose coupling).
  private getWaveNumber: () => number = () => 0;

  // Deterministic kill-reward accumulator. Splits the wave's gold-budget
  // exactly across expected enemy slots — last paid kill picks up the
  // floor-rounding remainder so the total never exceeds the budget.
  // Tracked across kills via remainingKillBudget/Slots; rewardWaveNumber
  // triggers a reset when the wave changes.
  private rewardWaveNumber = -1;
  private remainingKillBudget = 0;
  private paidRewardSlots = 0;

  /** EventBus subscriptions — disposed in destroy(). */
  private readonly subs = new SubscriptionBag();

  /** Every worm (EnemyTypeConfig.chain) on the routes, ticked in update() */
  private readonly worms = new WormChains({
    spawnSegment: (group, link, paused) =>
      this.spawnOne(group.path, group.type.id, group.speedMps, paused, group.segmentMaxHp, undefined, link),
    // The head model is the worm type's own; presentFrame resolves the new slot
    showAsHead: (enemy) => this.tilesEngine?.enemies.setRenderType(enemy.id, enemy.typeConfig.id),
  });

  constructor(
    private eventBus: GameEventBus,
    private globalRouteGrid: GlobalRouteGridService,
    private spatialGrid: SpatialGridService
  ) {
    super();
    this.registerDebugHandlers();
  }

  private registerDebugHandlers(): void {
    this.subs.add(this.eventBus.on('debug:remove-enemy', (event) => {
      const enemy = this.getAll().find(e => e.id === event.enemyId);
      if (enemy) {
        this.remove(enemy);
      }
    }));

    this.subs.add(this.eventBus.on('debug:spawn-enemy', (event) => {
      if (!this.tilesEngine) {
        console.warn('[EnemyManager] Debug spawn ignored - not initialized');
        return;
      }

      if (!event.path || event.path.length < 2) {
        console.warn('[EnemyManager] Debug spawn ignored - invalid path');
        return;
      }

      const count = event.count ?? 1;
      for (let i = 0; i < count; i++) {
        this.spawn(
          event.path,
          event.enemyType as EnemyTypeId,
          event.speed,
          event.paused ?? false,
          event.health,
          event.start,
        );
      }
    }));
  }

  /**
   * Initialize enemy manager with ThreeTilesEngine
   */
  override initialize(tilesEngine: ThreeTilesEngine): void {
    super.initialize(tilesEngine);
  }

  /**
   * Spawn a new enemy at the start of a path, out of its spawn portal, or
   * part-way along it (split children, see splitOnDeath()). See SpawnEntry.
   *
   * A type with a chain (the worm) puts its whole chain on the route, and
   * `healthOverride` is the HP of each segment. Returns the head; the other
   * segments come out of the portal as the chain moves (WormChains).
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
      );
      if (head.worm !== null) this.eventBus.emit({ type: 'worm:spawned', head, group: head.worm.group });
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
    if (!this.tilesEngine) {
      throw new Error('EnemyManager not initialized');
    }

    const start = typeof entry === 'object' ? entry : undefined;
    const enemy = new Enemy(typeId, path, speedOverride, start?.segmentIndex, start?.segmentProgress);
    enemy.worm = worm;

    // Override health if specified
    if (healthOverride !== undefined) {
      enemy.health.resetMaxHp(healthOverride);
    }

    // Initialize audio with spatial audio manager
    if (this.tilesEngine.spatialAudio) {
      enemy.audio.initialize(this.tilesEngine.spatialAudio);
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
        enemy.movement.setLateralFactor((Math.random() * 2 - 1) * spread);
      }

      // Apply random height variation for air units
      if (enemy.typeConfig.heightVariation && enemy.typeConfig.heightVariation > 0) {
        const maxVar = enemy.typeConfig.heightVariation;
        const randomVar = (Math.random() * 2 - 1) * maxVar;
        enemy.movement.setHeightVariation(randomVar);
      }
    }

    // Get height at spawn position - the parent's ground for a split child,
    // else prefer path height (smoothed) over live sampling
    const startPos = path[0];
    const origin = this.tilesEngine.sync.getOrigin();
    let geoHeight: number;

    if (start) {
      geoHeight = start.groundHeight;
    } else if (startPos.height !== undefined && startPos.height !== 0) {
      // Path has pre-computed smoothed height - use it
      geoHeight = startPos.height;
    } else {
      // Fallback: sample terrain height at spawn position
      const localTerrainY = this.tilesEngine.getTerrainHeightAtGeo(startPos.lat, startPos.lon);
      // Convert local Y to geo height for proper round-trip through geoToLocalSimple
      // geoToLocalSimple does: Y = height - originHeight
      // So we need: geoHeight = localY + originHeight
      geoHeight = localTerrainY !== null ? localTerrainY + origin.height : origin.height;
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
    // A worm's body segments are drawn with the segment model.
    const renderType = worm !== null && !worm.head ? worm.group.chain.segmentModel : typeId;
    this.tilesEngine.enemies
      .create(enemy.id, renderType, enemy.position.lat, enemy.position.lon, geoHeight + enemy.heightOffset)
      .then((renderData) => {
        if (renderData && !paused) {
          this.tilesEngine!.enemies.startWalkAnimation(enemy.id);
        }
      });

    if (paused) {
      enemy.movement.pause();
    } else {
      // Start moving and sounds immediately if not paused
      enemy.startMoving();
    }

    // Play spawn sound (always, even if paused)
    enemy.playSpawnSound();

    this.add(enemy);
    this.aliveCount.update(c => c + 1);
    this.cachedAliveEnemies = null; // Invalidate cache

    // Emit enemy:spawned event for AI tracking
    this.eventBus.emit({
      type: 'enemy:spawned',
      enemy,
    });

    return enemy;
  }

  /**
   * An air unit's way out of the portal on `start`, see airPortalExit(). The
   * portal's scale follows the corridor there, as MarkerVisualizationService
   * stands it; the body is the VAT bake's measured range. Every type is
   * baked while the game loads; before that (unit tests) the body counts as
   * a point at its origin.
   */
  private portalExitFor(enemy: Enemy, start: RouteWaypoint): AirPortalExit {
    const range = getEnemyModelRangeY(enemy.typeConfig.id);
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
   * Used in the kill-reward formula (WaveFactor component).
   * Loose coupling — no direct WaveManager dependency.
   */
  setWaveNumberProvider(provider: () => number): void {
    this.getWaveNumber = provider;
  }

  /**
   * Set the wave-size provider from WaveManager: the bodies the wave can
   * field, split children included (getExpectedBodyCount). It sizes the
   * kill-reward slots.
   */
  setWaveSizeProvider(provider: () => number): void {
    this.getWaveSize = provider;
  }

  private getWaveSize: () => number = () => 1;

  /**
   * Calculate kill reward from the wave's deterministic kill-budget
   * (Phase 5.16): the curriculum pins a total per-wave gold amount which
   * we split deterministically across the expected bodies. Effect:
   *  - Income predictable wave-by-wave → balanceable against tower/research costs
   *  - Independent of NN's count/hp_mult choices (no swarm-flood, no boring-dribble)
   *  - Leaks naturally reduce earnings (uncollected kills = lost gold)
   *
   * Accumulator pattern: `floor(remainingBudget / remainingSlots)` per paid
   * kill, then decrement both. The last slot picks up the rounding remainder
   * so the SUM of rewards equals the budget exactly when every enemy dies —
   * fixes the W19 rat_tide bug where `Math.max(1, round(305/5000))` × 5000
   * paid out 5000g instead of the budgeted 305g. Extra kills past the slot
   * count pay 0g.
   *
   * Split children have slots of their own: a skeleton and each of its two
   * minions pay one slot, a leaked skeleton forfeits all three, and a split
   * never raises the wave's gold.
   */
  private calculateDynamicReward(_enemy: Enemy): number {
    const wave = this.getWaveNumber();

    if (wave !== this.rewardWaveNumber) {
      this.rewardWaveNumber = wave;
      this.remainingKillBudget = goldBudgetForWave(wave).kill;
      this.paidRewardSlots = 0;
    }

    // The wave size is read on every kill: a worm adds its segments to the
    // wave when it spawns, which can be after the wave's first kill.
    const slots = Math.max(1, this.getWaveSize()) - this.paidRewardSlots;
    if (slots <= 0 || this.remainingKillBudget <= 0) {
      return 0;
    }

    const reward = Math.floor(this.remainingKillBudget / slots);
    this.remainingKillBudget -= reward;
    this.paidRewardSlots += 1;
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
   * Returns false if the enemy is already dying; nothing happens then, so
   * callers that credit the kill must check the result.
   */
  kill(enemy: Enemy, cause: KillCause = 'combat'): boolean {
    if (this.killingEnemies.has(enemy.id)) return false;
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
    this.eventBus.emit({ type: 'enemy:died', enemy, credits });

    // Before the removal below: the children start from the parent's place
    const split = enemy.typeConfig.splitOnDeath;
    if (combat && split) this.splitOnDeath(enemy, split, wasPaused);

    const hasDeathAnim =
      !!enemy.typeConfig.deathAnimation ||
      (enemy.typeConfig.deathAnimations?.length ?? 0) > 0;
    if (hasDeathAnim) {
      this.tilesEngine?.enemies.playDeathAnimation(enemy.id);
      this.pendingDeaths.push({
        enemy,
        remainingMs: TIMING.deathAnimationDuration,
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

    const children: Enemy[] = [];
    for (let i = 0; i < split.count; i++) {
      // -1 .. 1 across the children, 0 for a single one
      const side = split.count > 1 ? (2 * i) / (split.count - 1) - 1 : 0;
      start.lateralFactor = centre + side * spread;
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

  // Performance profiling callback (set by PerformanceProfilerService).
  // move/grid/height are sampled estimates (see PROFILE_STRIDE); total is measured.
  onProfileTiming: ((move: number, grid: number, height: number, render: number, total: number) => void) | null = null;

  /** Rotating start offset of the profiled enemies, see PROFILE_STRIDE. */
  private profileSampleOffset = 0;

  /**
   * Reports the cost of {@link presentFrame} (ms), once per render frame.
   * Separate from `onProfileTiming` because the visual push no longer runs
   * per sub-step — mixing the two would resurrect the unit confusion the
   * panel just got rid of.
   */
  onPresentTiming: ((ms: number) => void) | null = null;

  /**
   * Update all enemies — movement and rendering. Called once per gameplay
   * sub-step (~16ms game-time). `gameTimeMs` is the engine game-clock used
   * for DoT ticks, status-effect lookups, and pending death/start delays.
   */
  override update(deltaTime: number, gameTimeMs: number): void {
    // Tick pending death-animation removals + pending start-moving delays
    // FIRST so they remain accurate even if movement is disabled.
    this.tickPendingDeaths(deltaTime);
    this.tickPendingStarts(deltaTime);

    if (!this.movementEnabled) return;

    // Worms first: their segments go where the chains put them, and segments
    // that come out of the portal now join the loop below
    this.worms.tick(deltaTime, gameTimeMs);

    const profiling = this.onProfileTiming !== null;
    let tMove = 0, tGrid = 0, tHeight = 0;
    let processed = 0, sampled = 0;
    const sampleOffset = profiling ? this.profileSampleOffset++ % PROFILE_STRIDE : 0;
    const tTotal = profiling ? performance.now() : 0;

    this.toRemove.length = 0;
    const origin = this.tilesEngine?.sync.getOrigin();

    for (const enemy of this.getAllActive()) {
      // `alive` reads a mirror kept on the enemy (Enemy.deadFlag), so this
      // check no longer loads the health component.
      if (!enemy.alive) continue;

      const sample = profiling && (processed++ + sampleOffset) % PROFILE_STRIDE === 0;
      if (sample) sampled++;

      let t0 = sample ? performance.now() : 0;
      // Deliberately NOT the generic enemy.update(): of the five enemy
      // components only transform (rotation lerp) and audio (loop positions)
      // do per-tick work — health, render and movement have empty update()
      // bodies, and iterating the component Map with five polymorphic calls
      // per enemy per sub-step was pure overhead at 10k+ enemies.
      // GameObject.update() remains for towers/projectiles.
      // `enabled` is honoured because the generic path did — nothing sets it
      // false on an enemy today, but silently ignoring it would be a trap.
      // The transform's only work is easing `rotation` toward the heading.
      // `isTurning` mirrors "initialized and rotation !== target", the exact
      // condition under which update() does anything, so skipping on it is
      // the early-out update() would take. Movement holds the heading per
      // segment, so this is true only for a few sub-steps after a corner.
      if (enemy.isTurning && enemy.transform.enabled) enemy.transform.update(deltaTime);
      // Audio's only per-tick work is moving loops, and few enemies hold a
      // loop handle (playing or paused). `hasAudioLoops` mirrors
      // `loopHandles.size > 0`, so skipping on it is exactly the early-out
      // update() takes, without loading the component. The call stays here
      // rather than in a separate pass over the looping enemies: the loops
      // share the enemy-sound budget, so the order of updateLoopPosition()
      // calls decides which paused loop gets to resume.
      if (enemy.hasAudioLoops && enemy.audio.enabled) enemy.audio.update(deltaTime);
      // Walk/run alternation (wallsmasher). Ticked before move() so the
      // multiplier takes effect in the sub-step that sets it. Only enemies
      // that carry the state pay for it; everyone else keeps multiplier 1.
      // Paused enemies (pending start, debug, dying) do not advance it.
      if (enemy.rush !== null && !enemy.movement.paused) {
        enemy.movement.speedMultiplier = enemy.rush.tick(deltaTime);
      }
      // Single-pass: remove expired effects + get slow/poison/burn flags (game-time)
      const statusFlags = enemy.movement.updateStatusEffects(gameTimeMs);
      // A worm segment goes where its chain put it (worms.tick above)
      const moveResult = enemy.worm === null
        ? enemy.movement.move(deltaTime, gameTimeMs, statusFlags.slowMultiplier)
        : stepWormSegment(enemy.movement, enemy.worm);
      if (sample) tMove += performance.now() - t0;

      if (moveResult === 'reached_end') {
        // Emit enemy:reached-base event — leak damage scales with wave-number
        // (Phase 5.16) so late-game leaks hurt more.
        this.eventBus.emit({
          type: 'enemy:reached-base',
          enemy,
          damage: enemyBaseDamageForWave(this.getWaveNumber()),
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
      if (this.tilesEngine) {
        // Compute local position ONCE, reused for grid update AND ground read below
        this.tilesEngine.sync.geoToLocalSimpleInto(
          enemy.position.lat,
          enemy.position.lon,
          0, // Height not needed for X/Z cell lookup
          this._tempLocalPos
        );
        // Both grids keep a memo on the enemy (route cell, spatial entry) and
        // skip their string-keyed lookups while it holds (see
        // GlobalRouteGrid.updateEnemyPosition and SpatialGrid.updateTracked).
        // The spatial entry still gets the exact x/z every sub-step, since
        // proximity queries filter on them.
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
      if (origin && this.globalRouteGrid.isInitialized()) {
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
          const target = cellY + origin.height + enemy.movement.getHeightVariation();
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

    // Remove enemies that reached base
    for (const enemy of this.toRemove) {
      this.remove(enemy);
    }

    // Send profiling data to PerformanceProfilerService
    if (profiling) {
      // Phases were timed on every PROFILE_STRIDE-th enemy; scale the sums
      // to the whole loop. Render is reported by presentFrame.
      const scale = sampled > 0 ? processed / sampled : 0;
      this.onProfileTiming!(tMove * scale, tGrid * scale, tHeight * scale, 0, performance.now() - tTotal);
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

  /**
   * Push simulation state to the renderer. Call once per render frame, after
   * the sub-step loop, and only when at least one sub-step actually ran.
   *
   * This work used to sit inside the per-sub-step loop, where it was redone
   * for every step even though only the last one is ever seen. Below 60 FPS
   * the loop runs several times a frame — measured at 5.8 sub-steps at 10k
   * enemies, and above 40 once the frame rate collapsed — so most of it was
   * thrown away. Skipping frames with no sub-step keeps the update rate
   * exactly where it was: at 144 FPS the simulation ticks roughly every
   * second frame, and the visuals now follow that same cadence rather than
   * running ahead of it.
   *
   * Deliberately NOT here: damage-over-time (emits `dot:damage`),
   * ground-height easing (combat and targeting read `terrainHeight`) and the
   * walk/run switch (feeds movement). Those are gameplay and stay on the
   * sub-step, or their outcome would depend on the frame rate. Only the clip
   * that shows the switch is chosen here.
   */
  presentFrame(gameTimeMs: number): void {
    const engine = this.tilesEngine;
    if (!engine) return;

    const profiling = this.onPresentTiming !== null;
    const t0 = profiling ? performance.now() : 0;
    const origin = engine.sync.getOrigin();

    for (const enemy of this.getAllActive()) {
      if (!enemy.alive) continue;

      // X/Z is re-derived rather than carried over from the sub-step: one
      // conversion per enemy per frame, against the whole visual push per
      // enemy per sub-step that it replaces.
      engine.sync.geoToLocalSimpleInto(
        enemy.position.lat,
        enemy.position.lon,
        0,
        this._tempLocalPos,
      );

      // The render slot is resolved once and kept on the enemy. A slot the
      // renderer freed (removal, engine-side clear) is flagged `released`
      // and resolved again. Resolving by id cost ~10 string-keyed Map
      // lookups per enemy per frame across the height offset and the push.
      let slot = enemy.renderSlot;
      if (slot === null || slot.released) {
        slot = enemy.renderSlot = engine.enemies.resolveSlot(enemy.id);
      }

      // Air units fly at fixed altitude over local terrain — `terrainHeight
      // + heightOffset` (air-unit configs set heightOffset to ≈15-20m).
      // Single-source-of-truth: matches `getAirTargetY(cell)` from the LOS
      // pipeline. Caveat (Option B): in dense skyscraper scenes, air units
      // may clip through facades — accepted trade-off for predictable
      // coverage visualization. Out of a spawn portal they fly lower for
      // the first ~45 m (Enemy.portalExit); the air LOS still samples the
      // cruise height there.
      this._tempLocalPos.y = origin
        ? (enemy.transform.terrainHeight + enemy.heightOffset) - origin.height
        : 0;

      const currentSpeed =
        enemy.movement.speedMps *
        enemy.movement.speedMultiplier *
        enemy.movement.getSlowMultiplier(gameTimeMs);

      if (slot !== null) {
        // Show the walk/run state the sub-step decided. Mismatch only right
        // after a switch, so the id-based call runs once per switch.
        const rush = enemy.rush;
        if (rush !== null && slot.isWalking === rush.running) {
          if (rush.running) engine.enemies.startRunAnimation(enemy.id);
          else engine.enemies.startWalkAnimation(enemy.id);
        }
        engine.enemies.updateSlot(
          slot,
          this._tempLocalPos,
          enemy.transform.rotation,
          enemy.health.healthPercent,
          currentSpeed,
        );
      }

      // Frost / poison / burn visuals are edge-triggered against a Set, so running
      // them once per frame instead of once per sub-step changes nothing but
      // the number of times the same state is re-checked. Each check is
      // skipped when it cannot be true: `.some` over an empty effect list and
      // a lookup in an empty Set both answer false.
      const isSlowed =
        enemy.movement.statusEffects.length !== 0 && enemy.movement.isSlowed(gameTimeMs);
      const hasFrost =
        this.frozenVisualEnemies.size !== 0 && this.frozenVisualEnemies.has(enemy.id);
      if (isSlowed && !hasFrost) {
        engine.enemies.setFreezeVisual(enemy.id, true);
        engine.effects.spawnFrostAura(enemy.id, this._tempLocalPos);
        this.frozenVisualEnemies.add(enemy.id);
      } else if (isSlowed && hasFrost) {
        engine.effects.updateFrostAuraPosition(enemy.id, this._tempLocalPos);
      } else if (!isSlowed && hasFrost) {
        engine.enemies.setFreezeVisual(enemy.id, false);
        engine.effects.stopFrostAura(enemy.id);
        this.frozenVisualEnemies.delete(enemy.id);
      }

      const isPoisoned =
        enemy.movement.statusEffects.length !== 0 && enemy.movement.isPoisoned(gameTimeMs);
      const hasPoison =
        this.poisonVisualEnemies.size !== 0 && this.poisonVisualEnemies.has(enemy.id);
      if (isPoisoned && !hasPoison) {
        engine.enemies.setPoisonVisual(enemy.id, true);
        engine.effects.spawnPoisonAura(enemy.id, this._tempLocalPos);
        this.poisonVisualEnemies.add(enemy.id);
      } else if (isPoisoned && hasPoison) {
        engine.effects.updatePoisonAuraPosition(enemy.id, this._tempLocalPos);
      } else if (!isPoisoned && hasPoison) {
        engine.enemies.setPoisonVisual(enemy.id, false);
        engine.effects.stopPoisonAura(enemy.id);
        this.poisonVisualEnemies.delete(enemy.id);
      }

      const isBurning =
        enemy.movement.statusEffects.length !== 0 && enemy.movement.isBurning(gameTimeMs);
      const hasBurn =
        this.burnVisualEnemies.size !== 0 && this.burnVisualEnemies.has(enemy.id);
      if (isBurning !== hasBurn) {
        engine.enemies.setBurnVisual(enemy.id, isBurning);
        if (isBurning) this.burnVisualEnemies.add(enemy.id);
        else this.burnVisualEnemies.delete(enemy.id);
      }
    }

    if (profiling) this.onPresentTiming!(performance.now() - t0);
  }

  /**
   * Start all paused enemies with a configurable game-time delay between each.
   * Delays are accumulated as game-time pending-starts and ticked from
   * update(deltaTime, …), matching 1× behavior at every training timescale.
   */
  startAll(defaultDelayBetween = TIMING.defaultSpawnStartDelay): void {
    const paused = this.getAll().filter((e) => e.movement.paused);
    let accumulatedDelay = 0;
    for (const enemy of paused) {
      const delay = enemy.typeConfig.spawnStartDelay ?? defaultDelayBetween;
      this.pendingStarts.push({ enemy, remainingMs: accumulatedDelay });
      accumulatedDelay += delay;
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

  /** Tick the game-time pending-start delays each sub-step. */
  private tickPendingStarts(deltaTime: number): void {
    if (this.pendingStarts.length === 0) return;
    let writeIdx = 0;
    for (const entry of this.pendingStarts) {
      entry.remainingMs -= deltaTime;
      if (entry.remainingMs <= 0) {
        if (entry.enemy.alive && entry.enemy.active) {
          entry.enemy.startMoving();
          this.tilesEngine?.enemies.startWalkAnimation(entry.enemy.id);
        }
      } else {
        this.pendingStarts[writeIdx++] = entry;
      }
    }
    this.pendingStarts.length = writeIdx;
  }

  /**
   * Remove enemy and cleanup resources.
   *
   * NOTE: does NOT splice the pendingDeaths / pendingStarts arrays — that
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
    // Cleanup frost visual if active
    if (this.frozenVisualEnemies.has(entity.id)) {
      this.tilesEngine?.effects.stopFrostAura(entity.id);
      this.frozenVisualEnemies.delete(entity.id);
    }
    // Cleanup poison visual if active
    if (this.poisonVisualEnemies.has(entity.id)) {
      this.tilesEngine?.effects.stopPoisonAura(entity.id);
      this.poisonVisualEnemies.delete(entity.id);
    }
    // The burn tint lives on the render slot, which goes with the enemy
    this.burnVisualEnemies.delete(entity.id);
    // Remove from global route grid and spatial grid
    this.globalRouteGrid.removeEnemy(entity);
    this.spatialGrid.removeEnemy(entity.id);
    this.tilesEngine?.enemies.remove(entity.id);
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
    // Clear pending game-time death/start delays
    this.pendingDeaths.length = 0;
    this.pendingStarts.length = 0;
    this.worms.clear();

    for (const enemy of this.getAll()) {
      this.globalRouteGrid.removeEnemy(enemy);
    }

    // Clear spatial grid
    this.spatialGrid.clear();

    this.tilesEngine?.enemies.clear();
    this.killingEnemies.clear();

    // Stop frost auras before clearing the tracking set
    for (const enemyId of this.frozenVisualEnemies) {
      this.tilesEngine?.effects.stopFrostAura(enemyId);
    }
    this.frozenVisualEnemies.clear();

    // Stop poison auras before clearing
    for (const enemyId of this.poisonVisualEnemies) {
      this.tilesEngine?.effects.stopPoisonAura(enemyId);
    }
    this.poisonVisualEnemies.clear();
    this.burnVisualEnemies.clear();
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
   * Get grid stats for debugging
   */
  getGridStats(): { trackedEnemies: number; occupiedCells: number } {
    const stats = this.globalRouteGrid.getStats();
    return {
      trackedEnemies: stats.trackedEnemies,
      occupiedCells: stats.occupiedCells,
    };
  }

  /**
   * Destroy the enemy manager - cleanup all resources and timeouts
   */
  override destroy(): void {
    this.subs.disposeAll();
    this.pendingDeaths.length = 0;
    this.pendingStarts.length = 0;
    this.killingEnemies.clear();
    super.destroy();
  }
}
