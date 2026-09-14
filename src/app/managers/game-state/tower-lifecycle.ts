import type { GameEventBus } from '../../game-engine';
import type { TowerManager } from '../tower.manager';
import type { ResearchManager } from '../research.manager';
import type { WaveManager } from '../wave.manager';
import type { EnemyManager } from '../enemy.manager';
import type { TowerPlacementService } from '../../services/tower-placement.service';
import type { TowerCombatService } from '../../services/combat/tower-combat.service';
import type { ResearchStore } from '../../store/research.store';
import type { ThreeTilesEngine } from '../../three-engine';
import type { Tower } from '../../entities/tower.entity';
import type { Enemy } from '../../entities/enemy.entity';
import type { GeoPosition } from '../../models/game.types';
import type { ResearchEffect } from '../../configs/research/research.types';
import type { CreditsLedger } from './credits-ledger';
import { canTargetAirEffective } from '../../entities/tower-targeting.util';
import { TowerTypeId, TOWER_TYPES, UpgradeId, requiredUpgradeTier } from '../../configs/tower-types.config';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../../utils/geo-utils';

/**
 * Tower rules and glue around the TowerManager: what placing, selling and
 * upgrading checks and costs, the grid/LOS registration that goes with it,
 * and the guard heading the towers turn to outside a wave.
 *
 * Owned by the GameStateManager. Its placeTower(), sellTower() and
 * upgradeTower() delegate here, and its initialize() wires the listeners
 * (scheduleAirRetrofit, turnAllToGuard, turnToGuardIfClear) in their fixed
 * order among the other subscribers.
 */
export class TowerLifecycle {
  constructor(
    private readonly towerManager: TowerManager,
    private readonly researchManager: ResearchManager,
    private readonly waveManager: WaveManager,
    private readonly enemyManager: EnemyManager,
    private readonly placement: TowerPlacementService,
    private readonly combat: TowerCombatService,
    private readonly researchStore: ResearchStore,
    private readonly creditsLedger: CreditsLedger,
    private readonly eventBus: GameEventBus,
    /** The engine once the GameStateManager is initialized */
    private readonly engine: () => ThreeTilesEngine | null,
    /** Right before a tower is placed, see GameStateManager.setBeforeCorridorLock */
    private readonly beforePlace: () => void,
  ) {}

  /**
   * Place a new tower
   * @param position Geo position
   * @param typeId Tower type ID
   * @param customRotation Custom rotation set by user (radians)
   * @param plinthHeight Stone plinth below position.height (m), 0 = none
   */
  place(position: GeoPosition, typeId: TowerTypeId, customRotation: number, plinthHeight = 0): Tower | null {
    const config = TOWER_TYPES[typeId];
    if (!config) return null;

    // Research-gate: tower must be unlocked. Defense-in-depth against bots
    // or commands that bypass the UI's isTowerUnlocked() check.
    if (!this.researchStore.isTowerUnlocked(typeId)) {
      return null;
    }

    // Research Center: only one allowed
    if (typeId === 'research-center') {
      const existing = this.towerManager.getAll().find(t => t.typeConfig.id === 'research-center');
      if (existing) return null;
    }

    // Check if player has enough credits
    if (this.creditsLedger.credits() < config.cost) {
      return null;
    }

    // A corridor measurement still under way finishes first: the tower
    // stands on the cells it rebuilds.
    this.beforePlace();

    const tower = this.towerManager.placeTower(position, typeId, customRotation, plinthHeight);

    if (tower) {
      // Deduct cost
      this.creditsLedger.add(-config.cost);

      // Register tower on grid (LOS raycasting + grid registration + visualization)
      // Skip grid registration for passive buildings (no targeting/LOS needed)
      if (config.attackType !== 'passive') {
        this.placement.registerTowerOnGrid(tower, position, typeId);
      }

      // Notify ResearchManager when Research Center is placed
      if (typeId === 'research-center') {
        this.researchManager.onCenterPlaced();
      }
    }
    return tower;
  }

  /**
   * Sell a tower and refund 50% of its cost
   */
  sell(tower: Tower): number {
    // Unregister from grid + dispose LOS visualization
    this.placement.unregisterTowerFromGrid(tower);

    this.towerManager.selectTower(null);

    // Stop flame beam if fire tower
    if (tower.typeConfig.id === 'fire') {
      this.combat.stopTowerBeam(tower.id);
    }

    // Notify ResearchManager when Research Center is sold
    if (tower.typeConfig.id === 'research-center') {
      this.researchManager.onCenterRemoved();
    }

    // Sell tower (emits tower:sold event, returns refund)
    const refund = this.towerManager.sell(tower);
    this.creditsLedger.add(refund);
    return refund;
  }

  /**
   * Upgrade one track of a tower by one level and emit tower:upgraded.
   * @returns false if refused: maxed out, tier not researched, credits short
   */
  upgrade(tower: Tower, upgradeId: UpgradeId): boolean {
    const cost = tower.getNextUpgradeCost(upgradeId);
    if (cost <= 0 || !tower.canUpgrade(upgradeId)) return false;

    // Tier gating: research-slots (Research Center) is always allowed.
    // Regular tower upgrades need a matching upgrade-tier research. The band
    // rule lives in requiredUpgradeTier(); the sidebar and the training bot
    // use the same function so the three cannot drift apart.
    if (upgradeId !== 'research-slots') {
      const requiredTier = requiredUpgradeTier(tower.getUpgradeLevel(upgradeId));
      if (this.researchManager.getMaxUpgradeTier() < requiredTier) return false;
    }

    if (!this.creditsLedger.spend(cost)) return false;

    const upgrade = tower.typeConfig.upgrades.find(u => u.id === upgradeId);
    const previousLevel = tower.getUpgradeLevel(upgradeId);
    tower.applyUpgrade(upgradeId);

    // Research Center slot upgrade
    if (upgrade?.effect.stat === 'research-slots' && tower.typeConfig.id === 'research-center') {
      this.researchManager.upgradeCenter();
    }

    // Range changed: recompute the LOS cells so targeting uses the new
    // range, and rangeSquaredGeo for the sleep/wake checks.
    if (upgrade?.effect.stat === 'range') {
      this.recomputeRangeAfterUpgrade(tower);
    }

    this.eventBus.emit({
      type: 'tower:upgraded',
      tower,
      level: previousLevel + 1,
      cost,
    });
    return true;
  }

  /** Debug: every track of every tower to its max level, free of charge. */
  maxUpgradeAll(): void {
    for (const tower of this.towerManager.getAll()) {
      let rangeChanged = false;
      for (const upgrade of tower.typeConfig.upgrades) {
        while (tower.canUpgrade(upgrade.id)) {
          if (!tower.applyUpgrade(upgrade.id)) break;
          if (upgrade.effect.stat === 'range') rangeChanged = true;
          if (upgrade.effect.stat === 'research-slots' && tower.typeConfig.id === 'research-center') {
            this.researchManager.upgradeCenter();
          }
        }
      }
      if (rangeChanged) {
        this.recomputeRangeAfterUpgrade(tower);
      }
      this.eventBus.emit({ type: 'tower:upgraded', tower, level: 0, cost: 0 });
    }
  }

  /**
   * After a range-stat upgrade (manual or debug-max-upgrade), refresh the
   * tower's LOS cells, geo-degree-squared range cache, and range ring.
   */
  recomputeRangeAfterUpgrade(tower: Tower): void {
    this.placement.recomputeTowerLOS(tower);
    const pos = tower.position;
    const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(pos.lat * DEG_TO_RAD);
    const avgMetersPerDegree = (METERS_PER_DEGREE_LAT + metersPerDegreeLon) / 2;
    const rangeInDegrees = tower.combat.range / avgMetersPerDegree;
    tower.rangeSquaredGeo = rangeInDegrees * rangeInDegrees;
    this.engine()?.towers.updateRangeIndicator(tower.id, tower.combat.range);

    // A longer range meets the route earlier. Between waves the tower stands
    // at its guard heading and follows the new one; in a wave it keeps
    // aiming where it was and turns after the wave.
    this.towerManager.refreshGuardHeading(tower);
    if (this.waveManager.phase() !== 'wave') {
      this.combat.turnToGuardHeading(tower);
    }
  }

  /**
   * Clear all tower overlays (LOS visualizations + GlobalRouteGrid registrations)
   * Called on reset to cleanup before starting fresh
   */
  clearAllOverlays(): void {
    // First deselect any selected tower (hides its LOS visualization)
    this.towerManager.selectTower(null);

    // Delegate to TowerPlacementService
    this.placement.clearAllTowerOverlays(this.towerManager.getAll());
  }

  /**
   * research:completed. AA-Retrofit unlocks air targeting for towers that
   * were placed WITHOUT it. Their per-cell air visibility was never resolved
   * (registerTower ran with canTargetAir=false), so `cell.airVisibility` has
   * no entry for them: air-only cells are missing from `visibleCells`
   * entirely, and for the rest `buildLosCheck` finds no cached answer and
   * falls back to a synchronous CPU raycast per candidate. Harmless while
   * air LOS was not enforced in `findTarget` — now that it is, re-register
   * the affected towers so the grid answers for them.
   * registerTowerIncremental only samples the entries that are actually
   * missing.
   *
   * Queued rather than run in this handler: recomputeTowerLOS reads the air
   * flag from the ResearchStore, and the store learns about the unlock in
   * GameStateSyncService's research:completed handler, which subscribes
   * after this one. Run right here, the recompute still saw air targeting
   * as locked and resolved no air entry at all.
   */
  scheduleAirRetrofit(effects: ResearchEffect[]): void {
    const unlocksAir = effects.some(
      e => e.kind === 'enable-targeting' && e.capability === 'air',
    );
    if (!unlocksAir) return;
    for (const tower of this.towerManager.getAll()) {
      const typeId = tower.typeConfig.id as TowerTypeId;
      // Only the retrofit-gated types — everything else already registered
      // with its final air capability.
      if (canTargetAirEffective(typeId, false)) continue;
      if (!canTargetAirEffective(typeId, true)) continue;
      this.placement.scheduleLosRecompute(tower);
    }
  }

  /** Turn every tower to where the route enters its range. */
  turnAllToGuard(): void {
    this.combat.turnTowersToGuard(this.towerManager);
  }

  /**
   * Debug enemies fought outside a wave never complete one, so no
   * wave:completed turns the towers back. Once the last enemy is gone
   * outside a wave, turn them as the wave end would. `leaving` is the
   * enemy of the event: one that reaches the base is still alive while
   * the event runs and removed after it.
   *
   * A killed enemy of a splitting type (splitOnDeath) is followed by its
   * children in the same EnemyManager.kill(), right after its enemy:died:
   * they are not alive yet, but the route is not clear. Kill-all is the one
   * death without a split, and debug:kill-all checks again once all died.
   */
  turnToGuardIfClear(leaving?: Enemy): void {
    if (this.waveManager.phase() === 'wave') return;
    if (leaving?.alive === false && leaving.typeConfig.splitOnDeath) return;
    for (const enemy of this.enemyManager.getAlive()) {
      if (enemy !== leaving) return;
    }
    this.combat.turnTowersToGuard(this.towerManager);
  }

  /** The routes changed: new guard headings, turned to at once outside a wave. */
  refreshGuardHeadings(): void {
    this.towerManager.refreshGuardHeadings();
    if (this.waveManager.phase() !== 'wave') {
      this.combat.turnTowersToGuard(this.towerManager);
    }
  }
}
