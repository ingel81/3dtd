import { signal } from '@angular/core';
import { Vector3 } from 'three';
import { EntityManager } from './entity-manager';
import { Enemy } from '../entities/enemy.entity';
import { EnemyTypeId } from '../configs/enemy-types.config';
import { GeoPosition } from '../models/game.types';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import { ThreeTilesEngine } from '../three-engine';
import { GameEventBus } from '../game-engine';
import { TIMING } from '../configs/timing.config';
import { COMBAT_TUNING } from '../configs/combat-tuning.config';
import { goldBudgetForWave, enemyBaseDamageForWave } from '../configs/wave-curriculum.config';

/**
 * How fast an enemy's feet may follow a corrected ground height (m/s).
 *
 * Cell samples can jump by metres when a finer tile lands. Easing into the
 * new value keeps that reading as the model settling rather than snapping.
 */
const ENEMY_GROUND_ADJUST_MPS = 8;

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

  // Poison tick accumulator in GAME-TIME ms per enemy. Increments by the
  // per-sub-step deltaTime; each time it crosses poisonTickIntervalMs we fire
  // one tick and subtract the interval. Robust at any timescale because we
  // never tie ticks to wall-clock time.
  private poisonTickAccum = new Map<string, number>();

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
  private remainingRewardSlots = 0;

  constructor(
    private eventBus: GameEventBus,
    private globalRouteGrid: GlobalRouteGridService,
    private spatialGrid: SpatialGridService
  ) {
    super();
    this.registerDebugHandlers();
  }

  private registerDebugHandlers(): void {
    this.eventBus.on('debug:toggle-movement', (event) => {
      this.movementEnabled = event.enabled;
    });

    this.eventBus.on('debug:remove-enemy', (event) => {
      const enemy = this.getAll().find(e => e.id === event.enemyId);
      if (enemy) {
        this.remove(enemy);
      }
    });

    this.eventBus.on('debug:clear-enemies', () => {
      this.clear();
    });

    this.eventBus.on('debug:spawn-enemy', (event) => {
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
        );
      }
    });
  }

  /**
   * Initialize enemy manager with ThreeTilesEngine
   */
  override initialize(tilesEngine: ThreeTilesEngine): void {
    super.initialize(tilesEngine);
  }

  /**
   * Spawn a new enemy at the start of a path
   */
  spawn(
    path: GeoPosition[],
    typeId: EnemyTypeId,
    speedOverride?: number,
    paused = false,
    healthOverride?: number,
  ): Enemy {
    if (!this.tilesEngine) {
      throw new Error('EnemyManager not initialized');
    }

    const enemy = new Enemy(typeId, path, speedOverride);

    // Override health if specified
    if (healthOverride !== undefined) {
      enemy.health.resetMaxHp(healthOverride);
    }

    // Initialize audio with spatial audio manager
    if (this.tilesEngine.spatialAudio) {
      enemy.audio.initialize(this.tilesEngine.spatialAudio);
    }

    // Apply random lateral offset for movement variety
    if (enemy.typeConfig.lateralOffset && enemy.typeConfig.lateralOffset > 0) {
      const maxOffset = enemy.typeConfig.lateralOffset;
      const randomOffset = (Math.random() * 2 - 1) * maxOffset;
      enemy.movement.setLateralOffset(randomOffset);
    }

    // Apply random height variation for air units
    if (enemy.typeConfig.heightVariation && enemy.typeConfig.heightVariation > 0) {
      const maxVar = enemy.typeConfig.heightVariation;
      const randomVar = (Math.random() * 2 - 1) * maxVar;
      enemy.movement.setHeightVariation(randomVar);
    }

    // Get height at spawn position - prefer path height (smoothed) over live sampling
    const startPos = path[0];
    const origin = this.tilesEngine.sync.getOrigin();
    let geoHeight: number;

    if (startPos.height !== undefined && startPos.height !== 0) {
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

    // Create 3D model and start animation
    this.tilesEngine.enemies
      .create(enemy.id, typeId, startPos.lat, startPos.lon, geoHeight)
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
   * Set the wave-number provider (from WaveManager).
   * Used in the kill-reward formula (WaveFactor component).
   * Loose coupling — no direct WaveManager dependency.
   */
  setWaveNumberProvider(provider: () => number): void {
    this.getWaveNumber = provider;
  }

  /**
   * Set the wave-size provider (expected enemy count) from WaveManager.
   * Used for swarm-discount in the kill-reward formula.
   */
  setWaveSizeProvider(provider: () => number): void {
    this.getWaveSize = provider;
  }

  private getWaveSize: () => number = () => 1;

  /**
   * Calculate kill reward from the wave's deterministic kill-budget
   * (Phase 5.16): the curriculum pins a total per-wave gold amount which
   * we split deterministically across the expected enemy count. Effect:
   *  - Income predictable wave-by-wave → balanceable against tower/research costs
   *  - Independent of NN's count/hp_mult choices (no swarm-flood, no boring-dribble)
   *  - Leaks naturally reduce earnings (uncollected kills = lost gold)
   *
   * Accumulator pattern: `floor(remainingBudget / remainingSlots)` per paid
   * kill, then decrement both. The last slot picks up the rounding remainder
   * so the SUM of rewards equals the budget exactly when every enemy dies —
   * fixes the W19 rat_tide bug where `Math.max(1, round(305/5000))` × 5000
   * paid out 5000g instead of the budgeted 305g. Extra kills past the slot
   * count (e.g. boss spawning more sub-units than budgeted) pay 0g.
   */
  private calculateDynamicReward(_enemy: Enemy): number {
    const wave = this.getWaveNumber();

    if (wave !== this.rewardWaveNumber) {
      this.rewardWaveNumber = wave;
      this.remainingKillBudget = goldBudgetForWave(wave).kill;
      this.remainingRewardSlots = Math.max(1, this.getWaveSize());
    }

    if (this.remainingRewardSlots <= 0 || this.remainingKillBudget <= 0) {
      return 0;
    }

    const reward = Math.floor(this.remainingKillBudget / this.remainingRewardSlots);
    this.remainingKillBudget -= reward;
    this.remainingRewardSlots -= 1;
    return reward;
  }

  /**
   * Kill an enemy — plays death animation then removes after a game-time
   * delay (no wall-clock setTimeout — sub-stepping ticks the delay each frame).
   */
  /**
   * Kill an enemy. If `awardCredits` is false, no gold is awarded — used by
   * debug kill-all so the player can't farm gold via the dev shortcut.
   */
  kill(enemy: Enemy, awardCredits = true): void {
    if (this.killingEnemies.has(enemy.id)) return;
    this.killingEnemies.add(enemy.id);

    this.aliveCount.update(c => Math.max(0, c - 1));
    this.cachedAliveEnemies = null;

    if (!enemy.health.isDead) {
      enemy.health.takeDamage(enemy.health.hp);
    }
    enemy.stopMoving();

    const credits = awardCredits ? this.calculateDynamicReward(enemy) : 0;
    this.eventBus.emit({ type: 'enemy:died', enemy, credits });

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
  }

  // Performance profiling callback (set by PerformanceProfilerService)
  onProfileTiming: ((move: number, grid: number, height: number, render: number, total: number) => void) | null = null;

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

    const profiling = this.onProfileTiming !== null;
    let tMove = 0, tGrid = 0, tHeight = 0;
    const tTotal = profiling ? performance.now() : 0;

    this.toRemove.length = 0;
    const origin = this.tilesEngine?.sync.getOrigin();

    for (const enemy of this.getAllActive()) {
      if (!enemy.alive) continue;

      let t0 = profiling ? performance.now() : 0;
      // Deliberately NOT the generic enemy.update(): of the five enemy
      // components only transform (rotation lerp) and audio (loop positions)
      // do per-tick work — health, render and movement have empty update()
      // bodies, and iterating the component Map with five polymorphic calls
      // per enemy per sub-step was pure overhead at 10k+ enemies.
      // GameObject.update() remains for towers/projectiles.
      // `enabled` is honoured because the generic path did — nothing sets it
      // false on an enemy today, but silently ignoring it would be a trap.
      if (enemy.transform.enabled) enemy.transform.update(deltaTime);
      if (enemy.audio.enabled) enemy.audio.update(deltaTime);
      // Single-pass: remove expired effects + get slow/poison flags (game-time)
      const statusFlags = enemy.movement.updateStatusEffects(gameTimeMs);
      const moveResult = enemy.movement.move(deltaTime, gameTimeMs, statusFlags.slowMultiplier);
      if (profiling) tMove += performance.now() - t0;

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

      // Update global route grid position for O(1) tower targeting
      // Also update spatial grid for O(1) proximity queries (sleep wake-checks, fallback targeting)
      t0 = profiling ? performance.now() : 0;
      if (this.tilesEngine) {
        // Compute local position ONCE — reuse for grid update AND frost visual below
        this.tilesEngine.sync.geoToLocalSimpleInto(
          enemy.position.lat,
          enemy.position.lon,
          0, // Height not needed for X/Z cell lookup
          this._tempLocalPos
        );
        if (this.globalRouteGrid.isInitialized()) {
          this.globalRouteGrid.updateEnemyPosition(enemy, this._tempLocalPos.x, this._tempLocalPos.z);
        }
        this.spatialGrid.updateEnemy(enemy.id, this._tempLocalPos.x, this._tempLocalPos.z);
      }
      if (profiling) tGrid += performance.now() - t0;

      // Ground comes from the route grid, per frame.
      //
      // It used to come from heights baked into the path at route-build time.
      // Those never updated: the grid self-heals as tiles refine, the bake did
      // not, so a route built during the coarse-LOD phase kept walking enemies
      // at whatever height that phase reported — rooftop level in a dense city.
      // The grid is the single ground truth for feet, route line and LOS, so
      // read it directly (a cell lookup, no raycast) and let the same healing
      // carry the enemies.
      t0 = profiling ? performance.now() : 0;

      let geoHeight = enemy.transform.terrainHeight;
      if (origin && this.globalRouteGrid.isInitialized()) {
        const cellY = this.globalRouteGrid.getGroundLocalYAt(
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
      if (profiling) tHeight += performance.now() - t0;

      // Animation state (walk vs run) feeds movement speed, so it is read
      // during simulation rather than in the visual pass.
      enemy.movement.speedMultiplier =
        this.tilesEngine?.enemies.getSpeedMultiplier(enemy.id) ?? 1.0;

      // Poison damage-over-time. This lives here and NOT in the visual pass:
      // it emits `dot:damage`, so it is gameplay, and it has to tick once per
      // sub-step or poison damage would change with the frame rate.
      if (statusFlags.isPoisoned) {
        const interval = COMBAT_TUNING.poisonTickIntervalMs;
        let acc = (this.poisonTickAccum.get(enemy.id) ?? 0) + deltaTime;
        if (acc >= interval) {
          const poisonEffect = enemy.movement.statusEffects.find(
            (e) => e.type === 'poison'
          );
          if (poisonEffect) {
            // DPS scaled to the tick interval (e.g. 500ms tick = DPS * 0.5).
            const tickDamage = poisonEffect.value * (COMBAT_TUNING.poisonTickIntervalMs / 1000);
            while (acc >= interval) {
              this.eventBus.emit({
                type: 'dot:damage',
                enemy,
                damage: tickDamage,
                sourceId: poisonEffect.sourceId ?? '',
                effectType: 'poison',
                damageType: 'poison',
              });
              acc -= interval;
            }
          } else {
            // No active poison effect — drop the surplus rather than burning ticks.
            acc = 0;
          }
        }
        this.poisonTickAccum.set(enemy.id, acc);
      }
    }

    // Remove enemies that reached base
    for (const enemy of this.toRemove) {
      this.remove(enemy);
    }

    // Send profiling data to PerformanceProfilerService
    if (profiling) {
      // Render is reported by presentFrame — it no longer happens here.
      this.onProfileTiming!(tMove, tGrid, tHeight, 0, performance.now() - tTotal);
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
   * Deliberately NOT here: poison damage-over-time (emits `dot:damage`),
   * ground-height easing (combat and targeting read `terrainHeight`) and the
   * animation-speed read (feeds movement). Those are gameplay and stay on the
   * sub-step, or their outcome would depend on the frame rate.
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

      const geoHeight = enemy.transform.terrainHeight;
      const heightOffset = engine.enemies.getHeightOffset(enemy.id);

      // Air units fly at fixed altitude over local terrain — `terrainHeight
      // + heightOffset` (air-unit configs set heightOffset to ≈15-20m).
      // Single-source-of-truth: matches `getAirTargetY(cell)` from the LOS
      // pipeline. Caveat (Option B): in dense skyscraper scenes, air units
      // may clip through facades — accepted trade-off for predictable
      // coverage visualization.
      this._tempLocalPos.y = origin ? (geoHeight + heightOffset) - origin.height : 0;

      const currentSpeed =
        enemy.movement.speedMps *
        enemy.movement.speedMultiplier *
        enemy.movement.getSlowMultiplier(gameTimeMs);

      engine.enemies.update(
        enemy.id,
        enemy.position.lat,
        enemy.position.lon,
        geoHeight,
        enemy.transform.rotation,
        enemy.health.healthPercent,
        currentSpeed,
        this._tempLocalPos,
      );

      // Frost / poison visuals are edge-triggered against a Set, so running
      // them once per frame instead of once per sub-step changes nothing but
      // the number of times the same state is re-checked.
      const isSlowed = enemy.movement.isSlowed(gameTimeMs);
      const hasFrost = this.frozenVisualEnemies.has(enemy.id);
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

      const isPoisoned = enemy.movement.isPoisoned(gameTimeMs);
      const hasPoison = this.poisonVisualEnemies.has(enemy.id);
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
        this.poisonTickAccum.delete(enemy.id);
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
    // Cleanup frost visual if active
    if (this.frozenVisualEnemies.has(entity.id)) {
      this.tilesEngine?.effects.stopFrostAura(entity.id);
      this.frozenVisualEnemies.delete(entity.id);
    }
    // Cleanup poison visual if active
    if (this.poisonVisualEnemies.has(entity.id)) {
      this.tilesEngine?.effects.stopPoisonAura(entity.id);
      this.poisonVisualEnemies.delete(entity.id);
      this.poisonTickAccum.delete(entity.id);
    }
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
    this.poisonTickAccum.clear();
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
    this.pendingDeaths.length = 0;
    this.pendingStarts.length = 0;
    this.killingEnemies.clear();
    super.destroy();
  }
}
