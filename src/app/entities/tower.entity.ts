import { GameObject } from '../core/game-object';
import { ComponentType } from '../core/component';
import {
  TransformComponent,
  CombatComponent,
  RenderComponent,
} from '../game-components';
import { GeoPosition } from '../models/game.types';
import { TowerTypeId, getTowerType, TowerTypeConfig, UpgradeId, TowerUpgrade, getUpgradeCost, upgradeFactor, calculateSellValue, TargetingStrategy, AirSubStrategy } from '../configs/tower-types.config';
import { TIMING } from '../configs/timing.config';
import { COMBAT_TUNING } from '../configs/combat-tuning.config';
import { Enemy } from './enemy.entity';
import { RouteCell } from '../utils/route-cell';
import type { LosMask } from '../utils/los-mask';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';
import { canTargetAirEffective } from './tower-targeting.util';
import { TowerAim, createTowerAim } from './tower-aim';

/** See Tower.getSimState. Plain data. */
export interface TowerSimState {
  targetingStrategy: TargetingStrategy;
  airSubStrategy: AirSubStrategy;
  holdFire: boolean;
  manned: boolean;
  manualAim: { heading: number; pitch: number };
  triggerHeld: boolean;
  isSleeping: boolean;
  lastTargetTime: number;
  lastSleepCheck: number;
  rangeSquaredGeo: number;
  nextFirePointIndex: number;
  lastLosCheckTime: number;
  guardHeading: number | null;
  aim: TowerAim;
  cooldownMs: number;
  kills: number;
  damageDealt: number;
}

/**
 * Tower entity - combines Transform, Combat, and Render components
 */
export class Tower extends GameObject {
  readonly typeConfig: TowerTypeConfig;

  private _transform!: TransformComponent;
  private _combat!: CombatComponent;
  private _render!: RenderComponent;

  /** Track upgrade levels for each upgrade type */
  private upgradeLevels = new Map<UpgradeId, number>();

  /** Current targeting strategy (can be changed per tower by player) */
  targetingStrategy: TargetingStrategy;

  /** Sub-strategy for air-priority pool selection (closest/weakest/strongest) */
  airSubStrategy: AirSubStrategy;

  selected = false;

  /**
   * Hold fire, switched by the player (TowerLifecycle.setHoldFire):
   * findTarget() finds nothing, so the tower neither turns to an enemy nor
   * attacks. It can still be sold and upgraded.
   */
  holdFire = false;

  /**
   * The player sits in it (TowerLifecycle.man, docs/TOWER_CONTROL.md): no
   * automatic fire, the turret follows `manualAim` and fires while
   * `triggerHeld`, by the tower's own rules (TowerCombatService.updateMannedTower).
   */
  manned = false;

  /**
   * Where the player aims from inside, heading (geoHeading convention) and
   * pitch (up positive), rad. Set by command:tower-aim; read only while
   * manned.
   */
  readonly manualAim = { heading: 0, pitch: 0 };

  /** The player holds the trigger (command:tower-trigger); false unless manned */
  triggerHeld = false;

  /** Whether this tower is sleeping (no enemies in range) */
  isSleeping = false;

  /** Timestamp when tower last had a target */
  lastTargetTime = 0;

  /** Timestamp of last sleep wake-check */
  lastSleepCheck = 0;

  /** Pre-computed range² in geo-degrees for quick sleep checks */
  rangeSquaredGeo = 0;

  /**
   * Meters-per-degree-longitude at this tower's (constant) latitude. Cached so
   * the targeting hot path avoids a Math.cos() per distance check.
   */
  private readonly _mPerDegLon: number;

  /** How long (ms) without a target before sleeping */
  static readonly SLEEP_DELAY = COMBAT_TUNING.towerSleepDelayMs;

  /** Custom rotation set by user during placement (radians) */
  customRotation = 0;

  /**
   * Stone plinth under the tower (m), from the lowest point of its footprint
   * up to `position.height`, which is the top of the plinth. 0 = none.
   */
  readonly plinthHeight: number;

  /**
   * Footprint probes the plinth hangs over a drop at, as indices into
   * footprintSampleOffsets(footprintRadius) (TowerFootprint.overhang): past a
   * roof edge above a deep street. The plinth gets braces there. Empty = none.
   */
  readonly plinthOverhang: readonly number[];

  /** Index for alternating fire points (dual-barrel etc.) */
  private _nextFirePointIndex = 0;

  /** References to visible cells from GlobalRouteGrid (for targeting) */
  visibleCells: RouteCell[] = [];

  /** Whether LOS computation is complete (tower won't fire until true) */
  losReady = false;

  /**
   * The answers in `visibleCells` and the grid as data, current after each
   * placement, range upgrade and air retrofit (TowerLosRegistry). null
   * until the first one. Applying it again gives the same answers without a
   * GPU (TowerLosRegistry.registerFromMask).
   */
  losMask: LosMask | null = null;

  /**
   * Heading (geoHeading convention) to where a route enters this tower's
   * range; the turret faces it from placement on and again after each wave.
   * null when no route reaches the range. Kept current by TowerManager on
   * placement, range upgrades and route changes.
   */
  guardHeading: number | null = null;

  /**
   * Where the turret points and turns to (tower-aim.ts). Simulation state,
   * stepped per sub-step for every tower; the renderer only draws it.
   */
  readonly aim: TowerAim;

  /** Cached current target - avoid re-searching every frame */
  private _currentTarget: Enemy | null = null;

  /** Distance to a body enemy during findTarget(), see its `bodyDistSq` */
  private _bodyDistSq: ((enemy: Enemy) => number) | null = null;

  /** Last time LOS was verified for current target */
  private _lastLosCheckTime = 0;

  /** Minimum interval between LOS rechecks (ms) */
  private readonly LOS_RECHECK_INTERVAL = TIMING.losRecheckInterval;

  constructor(
    position: GeoPosition,
    typeId: TowerTypeId,
    customRotation = 0,
    plinthHeight = 0,
    plinthOverhang: readonly number[] = [],
  ) {
    super('tower');
    this.typeConfig = getTowerType(typeId);
    this.customRotation = customRotation;
    this.aim = createTowerAim(this.typeConfig, customRotation);
    this.plinthHeight = plinthHeight;
    this.plinthOverhang = plinthOverhang;
    this.targetingStrategy = this.typeConfig.defaultTargeting ?? 'closest';
    this.airSubStrategy = this.typeConfig.defaultAirSubStrategy ?? 'closest';

    // Add components
    this._transform = this.addComponent(
      new TransformComponent(this),
      ComponentType.TRANSFORM
    );
    this._combat = this.addComponent(
      new CombatComponent(this, {
        damage: this.typeConfig.damage,
        range: this.typeConfig.range,
        fireRate: this.typeConfig.fireRate,
      }),
      ComponentType.COMBAT
    );
    this._render = this.addComponent(
      new RenderComponent(this),
      ComponentType.RENDER
    );

    this._transform.setPosition(position.lat, position.lon, position.height);

    // Pre-compute range² in geo-degrees for quick sleep wake-checks
    const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(position.lat * DEG_TO_RAD);
    this._mPerDegLon = metersPerDegreeLon;
    // Use average of lat/lon scale for approximation
    const avgMetersPerDegree = (METERS_PER_DEGREE_LAT + metersPerDegreeLon) / 2;
    const rangeInDegrees = this.typeConfig.range / avgMetersPerDegree;
    this.rangeSquaredGeo = rangeInDegrees * rangeInDegrees;
  }

  get transform(): TransformComponent {
    return this._transform;
  }
  get combat(): CombatComponent {
    return this._combat;
  }
  get render(): RenderComponent {
    return this._render;
  }

  get position(): GeoPosition {
    return this.transform.position;
  }

  /**
   * Get the next fire point offset (alternating for multi-barrel towers).
   * Returns null if no fire points are configured.
   */
  getNextFirePoint(): { x: number; z: number } | null {
    const points = this.typeConfig.firePoints;
    if (!points || points.length === 0) return null;
    const point = points[this._nextFirePointIndex % points.length];
    this._nextFirePointIndex++;
    return point;
  }

  /**
   * Get current target (for rotation tracking)
   */
  get currentTarget(): Enemy | null {
    return this._currentTarget;
  }

  /**
   * Clear current target (call when target dies or leaves range)
   */
  clearTarget(): void {
    this._currentTarget = null;
    this._lastLosCheckTime = 0;
  }

  /**
   * Check if LOS recheck is needed (game-time throttle).
   * `gameTimeMs` is the engine game-clock — no timescale compensation needed
   * because the sub-step loop runs in game-time at every speed.
   */
  needsLosRecheck(gameTimeMs: number): boolean {
    return gameTimeMs - this._lastLosCheckTime >= this.LOS_RECHECK_INTERVAL;
  }

  /** Mark that LOS was just checked (game-time). */
  markLosChecked(gameTimeMs: number): void {
    this._lastLosCheckTime = gameTimeMs;
  }

  /**
   * Find target enemy within range using the tower's targeting strategy.
   * OPTIMIZED: Caches target to avoid expensive LOS checks every frame.
   * @param enemies List of potential targets
   * @param losCheck Optional line-of-sight check function (only called on target change)
   * @param bodyDistSq Squared distance to an enemy whose body lies along the
   *   route (Enemy.body, the ooze): to the tower's aim point on it, Infinity
   *   when no point is in range and sight (BodyAim). Such an enemy is out of
   *   reach without it; `losCheck` is not asked about it.
   * @returns Best enemy based on targeting strategy that is in range and visible, or null
   */
  findTarget(
    enemies: Enemy[],
    airTargetingUnlocked: boolean,
    losCheck?: (enemy: Enemy) => boolean,
    bodyDistSq?: (enemy: Enemy) => number,
  ): Enemy | null {
    // Hold fire, or the player aims it by hand
    if (this.holdFire || this.manned) {
      this.clearTarget();
      return null;
    }
    // Squared range for all distance comparisons below (range is stable within
    // a frame; comparisons against distance² avoid sqrt in the hot path).
    const rangeSq = this.combat.range * this.combat.range;
    this._bodyDistSq = bodyDistSq ?? null;

    // Fast path: Check if current target is still valid (no LOS check needed)
    if (this._currentTarget) {
      if (this._currentTarget.alive) {
        // Verify target type is still compatible (air/ground)
        const isAirEnemy = this._currentTarget.typeConfig.isAirUnit ?? false;
        const canTargetAir = canTargetAirEffective(this.typeConfig.id as TowerTypeId, airTargetingUnlocked);
        const canTargetGround = this.typeConfig.canTargetGround ?? true;
        const typeValid = (isAirEnemy && canTargetAir) || (!isAirEnemy && canTargetGround);

        if (typeValid) {
          const distSq = this.targetDistSq(this._currentTarget);
          if (distSq <= rangeSq) {
            // Target still valid - keep it without expensive LOS recheck
            return this._currentTarget;
          }
        }
      }
      // Target invalid - clear and search for new one
      this._currentTarget = null;
    }

    // Slow path: Search for new target (with LOS checks)
    // Build list of valid candidates first
    const candidates: Enemy[] = [];

    // Get targeting capabilities (AA-Retrofit research can extend air-targeting for Gatling).
    const canTargetAir = canTargetAirEffective(this.typeConfig.id as TowerTypeId, airTargetingUnlocked);
    const canTargetGround = this.typeConfig.canTargetGround ?? true;

    // LOS check only when selecting NEW target: the periodic recheck in
    // updateTowerShooting drops air and ground targets that lose it, and
    // checking at acquisition keeps both paths consistent (no
    // acquire-then-drop loop).
    for (const enemy of enemies) {
      if (this.canEngage(enemy, canTargetAir, canTargetGround, rangeSq, losCheck)) candidates.push(enemy);
    }

    if (candidates.length === 0) {
      this._currentTarget = null;
      return null;
    }

    // Select best target based on strategy
    const bestTarget = this.selectByStrategy(candidates);

    // Cache the new target
    this._currentTarget = bestTarget;
    return bestTarget;
  }

  /**
   * Whether the tower may attack `enemy`: the rule of findTarget(), for a
   * shot the player aims (TowerCombatService.updateMannedTower). Parameters
   * as there; hold fire does not apply, the player fires by hand.
   */
  mayEngage(
    enemy: Enemy,
    airTargetingUnlocked: boolean,
    losCheck?: (enemy: Enemy) => boolean,
    bodyDistSq?: (enemy: Enemy) => number,
  ): boolean {
    this._bodyDistSq = bodyDistSq ?? null;
    const canTargetAir = canTargetAirEffective(this.typeConfig.id as TowerTypeId, airTargetingUnlocked);
    const canTargetGround = this.typeConfig.canTargetGround ?? true;
    return this.canEngage(enemy, canTargetAir, canTargetGround, this.combat.range * this.combat.range, losCheck);
  }

  /** One candidate of findTarget() and mayEngage(): alive, air or ground, in range, in sight. */
  private canEngage(
    enemy: Enemy,
    canTargetAir: boolean,
    canTargetGround: boolean,
    rangeSq: number,
    losCheck?: (enemy: Enemy) => boolean,
  ): boolean {
    if (!enemy.alive) return false;

    // Air/Ground targeting filter
    const isAirEnemy = enemy.typeConfig.isAirUnit ?? false;
    if (isAirEnemy && !canTargetAir) return false;
    if (!isAirEnemy && !canTargetGround) return false;

    // Range is intentionally HORIZONTAL coverage (flat-earth distance²);
    // air units' flight height does not shrink a tower's reach.
    if (this.targetDistSq(enemy) > rangeSq) return false;

    // The predicate dispatches per-enemy on isAirUnit (buildLosCheck) — air
    // targets resolve against the air-LOS pipeline, ground targets against
    // ground-LOS. Air is NOT exempt: tall buildings break air LOS too.
    // A body's distance already counts only points in sight.
    return !!enemy.body || !losCheck || losCheck(enemy);
  }

  /**
   * Select the best target from valid candidates based on the current targeting strategy.
   */
  private selectByStrategy(candidates: Enemy[]): Enemy | null {
    switch (this.targetingStrategy) {
      case 'closest': {
        let best: Enemy | null = null;
        let bestDistSq = Infinity;
        for (const enemy of candidates) {
          const distSq = this.targetDistSq(enemy);
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            best = enemy;
          }
        }
        return best;
      }

      case 'lowest-hp': {
        let best: Enemy | null = null;
        let lowestHp = Infinity;
        for (const enemy of candidates) {
          if (enemy.health.hp < lowestHp) {
            lowestHp = enemy.health.hp;
            best = enemy;
          }
        }
        return best;
      }

      case 'highest-hp': {
        let best: Enemy | null = null;
        let highestHp = -Infinity;
        for (const enemy of candidates) {
          if (enemy.health.hp > highestHp) {
            highestHp = enemy.health.hp;
            best = enemy;
          }
        }
        return best;
      }

      case 'first': {
        // Pick the enemy furthest along its path (closest to reaching the end)
        let best: Enemy | null = null;
        let highestProgress = -Infinity;
        for (const enemy of candidates) {
          const progress = enemy.movement.getPathProgress();
          if (progress > highestProgress) {
            highestProgress = progress;
            best = enemy;
          }
        }
        return best;
      }

      case 'last': {
        // Mirror of 'first': the enemy that has covered the least of its path
        let best: Enemy | null = null;
        let lowestProgress = Infinity;
        for (const enemy of candidates) {
          const progress = enemy.movement.getPathProgress();
          if (progress < lowestProgress) {
            lowestProgress = progress;
            best = enemy;
          }
        }
        return best;
      }

      case 'air-priority': {
        // Separate air and ground enemies
        const airEnemies: Enemy[] = [];
        const groundEnemies: Enemy[] = [];
        for (const enemy of candidates) {
          if (enemy.typeConfig.isAirUnit) {
            airEnemies.push(enemy);
          } else {
            groundEnemies.push(enemy);
          }
        }
        // Pick from air pool first (using sub-strategy), then ground fallback
        const pool = airEnemies.length > 0 ? airEnemies : groundEnemies;
        return this.selectFromPool(pool, this.airSubStrategy);
      }

      default:
        return candidates[0] ?? null;
    }
  }

  /**
   * Select best enemy from a pool using the given sub-strategy.
   */
  private selectFromPool(pool: Enemy[], strategy: AirSubStrategy): Enemy | null {
    if (pool.length === 0) return null;

    switch (strategy) {
      case 'closest': {
        let best: Enemy | null = null;
        let bestDistSq = Infinity;
        for (const enemy of pool) {
          const distSq = this.targetDistSq(enemy);
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            best = enemy;
          }
        }
        return best;
      }
      case 'lowest-hp': {
        let best: Enemy | null = null;
        let lowestHp = Infinity;
        for (const enemy of pool) {
          if (enemy.health.hp < lowestHp) {
            lowestHp = enemy.health.hp;
            best = enemy;
          }
        }
        return best;
      }
      case 'highest-hp': {
        let best: Enemy | null = null;
        let highestHp = -Infinity;
        for (const enemy of pool) {
          if (enemy.health.hp > highestHp) {
            highestHp = enemy.health.hp;
            best = enemy;
          }
        }
        return best;
      }
    }
  }

  /**
   * Select this tower
   */
  select(): void {
    this.selected = true;
  }

  /**
   * Deselect this tower
   */
  deselect(): void {
    this.selected = false;
  }

  /**
   * Get available upgrades that haven't reached max level
   */
  getAvailableUpgrades(): TowerUpgrade[] {
    return this.typeConfig.upgrades.filter(upgrade => {
      const currentLevel = this.upgradeLevels.get(upgrade.id) ?? 0;
      return currentLevel < upgrade.maxLevel;
    });
  }

  /**
   * Get the current level of a specific upgrade
   */
  getUpgradeLevel(upgradeId: UpgradeId): number {
    return this.upgradeLevels.get(upgradeId) ?? 0;
  }

  /**
   * Check if an upgrade can be applied (not at max level)
   */
  canUpgrade(upgradeId: UpgradeId): boolean {
    const upgrade = this.typeConfig.upgrades.find(u => u.id === upgradeId);
    if (!upgrade) return false;
    const currentLevel = this.upgradeLevels.get(upgradeId) ?? 0;
    return currentLevel < upgrade.maxLevel;
  }

  /**
   * Apply an upgrade to this tower
   * @returns true if upgrade was applied successfully
   */
  applyUpgrade(upgradeId: UpgradeId): boolean {
    const upgrade = this.typeConfig.upgrades.find(u => u.id === upgradeId);
    if (!upgrade) return false;

    const currentLevel = this.upgradeLevels.get(upgradeId) ?? 0;
    if (currentLevel >= upgrade.maxLevel) return false;
    const newLevel = currentLevel + 1;

    // Aus Basiswert × Track-Faktor neu rechnen statt zu multiplizieren: die
    // Stufen ab L16 sind degressiv, und so kann nichts driften.
    const factor = upgradeFactor(upgrade, newLevel);
    switch (upgrade.effect.stat) {
      case 'fireRate':
        this._combat.fireRate = this.typeConfig.fireRate * factor;
        break;
      case 'damage':
        this._combat.damage = this.typeConfig.damage * factor;
        break;
      case 'range':
        this._combat.range = this.typeConfig.range * factor;
        break;
      case 'beamWidth':
        // Beam width is computed dynamically via getEffectiveBeamWidth()
        break;
    }

    this.upgradeLevels.set(upgradeId, newLevel);
    return true;
  }

  /**
   * What the simulation changes on a tower over a run, for the wave-start
   * snapshot (docs/SIMULATOR_PLAN.md, P4); upgrades and the line of sight
   * come separately. Taken between waves, where a tower has no target.
   */
  getSimState(): TowerSimState {
    return {
      targetingStrategy: this.targetingStrategy,
      airSubStrategy: this.airSubStrategy,
      holdFire: this.holdFire,
      manned: this.manned,
      manualAim: { heading: this.manualAim.heading, pitch: this.manualAim.pitch },
      triggerHeld: this.triggerHeld,
      isSleeping: this.isSleeping,
      lastTargetTime: this.lastTargetTime,
      lastSleepCheck: this.lastSleepCheck,
      rangeSquaredGeo: this.rangeSquaredGeo,
      nextFirePointIndex: this._nextFirePointIndex,
      lastLosCheckTime: this._lastLosCheckTime,
      guardHeading: this.guardHeading,
      aim: { ...this.aim },
      cooldownMs: this._combat.cooldownRemaining,
      kills: this._combat.kills,
      damageDealt: this._combat.damageDealt,
    };
  }

  /** Put the state getSimState() took back; the stats follow the upgrades, restore those first. */
  restoreSimState(state: TowerSimState): void {
    this.targetingStrategy = state.targetingStrategy;
    this.airSubStrategy = state.airSubStrategy;
    this.holdFire = state.holdFire;
    this.manned = state.manned;
    this.manualAim.heading = state.manualAim.heading;
    this.manualAim.pitch = state.manualAim.pitch;
    this.triggerHeld = state.triggerHeld;
    this.isSleeping = state.isSleeping;
    this.lastTargetTime = state.lastTargetTime;
    this.lastSleepCheck = state.lastSleepCheck;
    this.rangeSquaredGeo = state.rangeSquaredGeo;
    this._nextFirePointIndex = state.nextFirePointIndex;
    this._lastLosCheckTime = state.lastLosCheckTime;
    this.guardHeading = state.guardHeading;
    Object.assign(this.aim, state.aim);
    this._combat.restoreCooldown(state.cooldownMs);
    this._combat.kills = state.kills;
    this._combat.damageDealt = state.damageDealt;
  }

  /**
   * Every upgrade track with a level above 0, for the wave-start snapshot
   * (docs/SIMULATOR_PLAN.md, P4). Plain data.
   */
  getUpgradeLevels(): [UpgradeId, number][] {
    return [...this.upgradeLevels];
  }

  /**
   * Put the tracks back at `levels`, stats included, as if the upgrades had
   * been bought: applyUpgrade computes every stat from the base value and
   * the track's level, so the order they were bought in does not matter.
   */
  restoreUpgradeLevels(levels: readonly (readonly [UpgradeId, number])[]): void {
    for (const [upgradeId, level] of levels) {
      while (this.getUpgradeLevel(upgradeId) < level && this.applyUpgrade(upgradeId)) { /* next level */ }
    }
  }

  /**
   * Get the current cost for the next level of a specific upgrade
   */
  getNextUpgradeCost(upgradeId: UpgradeId): number {
    const upgrade = this.typeConfig.upgrades.find(u => u.id === upgradeId);
    if (!upgrade) return 0;
    const currentLevel = this.upgradeLevels.get(upgradeId) ?? 0;
    return getUpgradeCost(upgrade, currentLevel);
  }

  /**
   * Get total credits invested in upgrades
   */
  getTotalUpgradeCost(): number {
    let total = 0;
    for (const upgrade of this.typeConfig.upgrades) {
      const maxLevel = this.upgradeLevels.get(upgrade.id) ?? 0;
      for (let i = 0; i < maxLevel; i++) {
        total += getUpgradeCost(upgrade, i);
      }
    }
    return total;
  }

  /**
   * Refund value when selling this tower: SELL_RATIO of (baseCost + totalUpgradeCost).
   * Reflects upgrades that were paid for, not just the base cost.
   */
  getSellValue(): number {
    return calculateSellValue(this.typeConfig.cost, this.getTotalUpgradeCost());
  }

  /**
   * Squared distance (m²) to what this tower would hit of `enemy`: its
   * position, or for a body along the route the aim point findTarget() was
   * handed (Infinity without one).
   */
  private targetDistSq(enemy: Enemy): number {
    if (enemy.body) return this._bodyDistSq ? this._bodyDistSq(enemy) : Infinity;
    return this.calculateDistanceFastSq(enemy.position);
  }

  /**
   * Fast SQUARED distance (m²) from this tower to a target, flat-earth
   * approximation. Avoids the sqrt + per-call Math.cos of a true distance:
   * range checks and 'closest' selection are monotonic in distance², so the
   * squared value is sufficient. Uses the cached _mPerDegLon (tower latitude
   * is constant). Accurate enough for tower range checks (< 200m).
   */
  private calculateDistanceFastSq(target: GeoPosition): number {
    const dLat = target.lat - this.position.lat;
    const dLon = target.lon - this.position.lon;
    const dx = dLon * this._mPerDegLon;
    const dy = dLat * METERS_PER_DEGREE_LAT;
    return dx * dx + dy * dy;
  }
}
