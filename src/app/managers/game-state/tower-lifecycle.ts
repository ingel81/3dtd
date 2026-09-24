import type { GameEventBus } from '../../game-engine';
import { LOCAL_PLAYER_ID } from './command-log';
import type { TowerManager } from '../tower.manager';
import type { ResearchManager } from '../research.manager';
import type { AbilityManager } from '../ability.manager';
import type { WaveManager } from '../wave.manager';
import type { EnemyManager } from '../enemy.manager';
import type { TowerPlacementService } from '../../services/tower-placement.service';
import type { TowerCombatService } from '../../services/combat/tower-combat.service';
import type { ThreeTilesEngine } from '../../three-engine';
import type { Tower } from '../../entities/tower.entity';
import type { Enemy } from '../../entities/enemy.entity';
import type { GeoPosition } from '../../models/game.types';
import type { ResearchEffect } from '../../configs/research/research.types';
import type { CreditsLedger } from './credits-ledger';
import { canTargetAirEffective } from '../../entities/tower-targeting.util';
import { releaseAim } from '../../entities/tower-aim';
import { TowerTypeId, TOWER_TYPES, UpgradeId, requiredUpgradeTier } from '../../configs/tower-types.config';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../../utils/geo-utils';
import type { SavedTower } from '../../simulator/sim-snapshot';
import { losMaskFromJson } from '../../utils/los-mask';

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
    /** A player's research (GameStateManager.researchOf): what the builder unlocked, the owner's center */
    private readonly research: (playerId: string) => ResearchManager,
    /** A player's abilities (GameStateManager.abilityOf): a launch site belongs to its owner's */
    private readonly abilities: (playerId: string) => Pick<AbilityManager, 'buildingChanged'>,
    private readonly waveManager: WaveManager,
    private readonly enemyManager: EnemyManager,
    private readonly placement: TowerPlacementService,
    private readonly combat: TowerCombatService,
    private readonly creditsLedger: CreditsLedger,
    private readonly eventBus: GameEventBus,
    /** The engine once the GameStateManager is initialized */
    private readonly engine: () => ThreeTilesEngine | null,
    /** The route corridor is being built: no tower until it is done, see GameStateManager.corridorPending */
    private readonly corridorPending: () => boolean,
    /** The player whose command runs (GameStateManager.actingPlayerId): pays, and owns what is built */
    private readonly actingPlayer: () => string = () => LOCAL_PLAYER_ID,
  ) {}

  /** The first player of the run: the owner of a tower from a snapshot saved before coop */
  private firstPlayer(): string {
    return this.creditsLedger.players[0];
  }

  /** The tower each player sits in (man()), by player; one each at most (COOP_PLAN D12) */
  private readonly manned = new Map<string, Tower>();

  /**
   * Put a tower back as a wave-start snapshot saved it (docs/SIMULATOR_PLAN.md,
   * P4): same id, upgrades, state and line of sight, no cost, no GPU, no
   * tower:placed. The caller sets the id counter so the tower gets `saved.id`.
   */
  restore(saved: SavedTower): Tower | null {
    const tower = this.towerManager.placeTower(
      { lat: saved.lat, lon: saved.lon, height: saved.height },
      saved.typeId,
      saved.customRotation,
      saved.plinthHeight,
      saved.plinthOverhang,
      true,
      saved.ownerId ?? this.firstPlayer(),
    );
    if (!tower) return null;
    tower.restoreUpgradeLevels(saved.upgrades);
    tower.restoreSimState(saved.state);
    if (saved.losMask && tower.typeConfig.attackType !== 'passive') {
      this.placement.registerTowerFromMask(tower, losMaskFromJson(saved.losMask));
    }
    const engine = this.engine();
    engine?.towers.updateRangeIndicator(tower.id, tower.combat.range);
    if (tower.holdFire) {
      engine?.towers.setHoldFire(tower.id, true);
      engine?.towerBadges.setHoldFire(tower.id, true);
    }
    return tower;
  }

  /** The towers the players sit in after a snapshot restore, without tower:manned. */
  restoreManned(manned: readonly (readonly [string, Tower])[]): void {
    this.manned.clear();
    for (const [playerId, tower] of manned) this.manned.set(playerId, tower);
  }

  /**
   * Place a new tower
   * @param position Geo position
   * @param typeId Tower type ID
   * @param customRotation Custom rotation set by user (radians)
   * @param plinthHeight Stone plinth below position.height (m), 0 = none
   * @param plinthOverhang Footprint probes the plinth hangs over a drop at, see Tower.plinthOverhang
   */
  place(
    position: GeoPosition,
    typeId: TowerTypeId,
    customRotation: number,
    plinthHeight = 0,
    plinthOverhang: readonly number[] = [],
  ): Tower | null {
    const config = TOWER_TYPES[typeId];
    if (!config) return null;

    // The corridor build replaces the cells the tower would register its LOS in.
    if (this.corridorPending()) return null;

    // Research-gate: the builder must have unlocked it. Defense-in-depth
    // against bots or commands that bypass the UI's isTowerUnlocked() check.
    const player = this.actingPlayer();
    if (!this.research(player).isTowerUnlocked(typeId)) {
      return null;
    }

    // A one-per-player building (Research Center, Missile Silo): not while the player's own stands
    if (config.unique && this.towerManager.getAll().some(t => t.typeConfig.id === typeId && t.ownerId === player)) {
      return null;
    }

    // Check if the player has enough credits
    if (this.creditsLedger.balance(player) < config.cost) {
      return null;
    }

    const tower = this.towerManager.placeTower(position, typeId, customRotation, plinthHeight, plinthOverhang, false, player);

    if (tower) {
      this.creditsLedger.add(-config.cost, 'build', player);

      // Register tower on grid (LOS raycasting + grid registration + visualization)
      // Skip grid registration for passive buildings (no targeting/LOS needed)
      if (config.attackType !== 'passive') {
        this.placement.registerTowerOnGrid(tower, position, typeId);
      }

      // Notify ResearchManager when Research Center is placed
      if (typeId === 'research-center') {
        this.research(player).onCenterPlaced();
      }

      // An ability that launches from it (the silo) gets its button
      this.abilities(player).buildingChanged(typeId);
    }
    return tower;
  }

  /**
   * Sell a tower and refund 50% of its cost
   */
  sell(tower: Tower): number {
    // Nobody sits in a tower that is gone
    const sitting = this.playerIn(tower);
    if (sitting !== null) this.leave(sitting);

    // Unregister from grid + dispose LOS visualization
    this.placement.unregisterTowerFromGrid(tower);

    this.towerManager.selectTower(null);

    // Stop flame beam if fire tower
    if (tower.typeConfig.id === 'fire') {
      this.combat.stopTowerBeam(tower.id);
    }

    // Notify ResearchManager when Research Center is sold
    if (tower.typeConfig.id === 'research-center') {
      this.research(tower.ownerId).onCenterRemoved();
    }

    // Sell tower (emits tower:sold event, returns refund)
    const refund = this.towerManager.sell(tower);
    this.creditsLedger.add(refund, 'sell', tower.ownerId);

    // Gone from the tower list: an ability that launched from it loses its button
    this.abilities(tower.ownerId).buildingChanged(tower.typeConfig.id);
    return refund;
  }

  /**
   * Hold fire on or off. On hold the combat finds no target for the tower
   * (Tower.findTarget), so it stops attacking from the next sub-step; a
   * flame stops at once, also while the game is paused. While it holds, the
   * model is greyed out and a pause sign stands over it in place of its
   * veteran badge. A passive tower has nothing to hold.
   * @returns false for a passive tower
   */
  setHoldFire(tower: Tower, holdFire: boolean): boolean {
    if (tower.typeConfig.attackType === 'passive') return false;
    tower.holdFire = holdFire;
    if (holdFire) this.combat.stopTowerBeam(tower.id);
    const engine = this.engine();
    engine?.towers.setHoldFire(tower.id, holdFire);
    engine?.towerBadges.setHoldFire(tower.id, holdFire);
    return true;
  }

  /**
   * Whether the player can get into `tower`: a projectile tower (the MVP of
   * docs/TOWER_CONTROL.md; beam, melee, chain and passive buildings not).
   */
  static canMan(tower: Tower): boolean {
    const attack = tower.typeConfig.attackType;
    return attack === undefined || attack === 'projectile';
  }

  /** The tower `playerId` sits in, null when none. */
  mannedTower(playerId: string): Tower | null {
    return this.manned.get(playerId) ?? null;
  }

  /** Every manned tower with its player, in the order they got in. */
  mannedTowers(): IterableIterator<[string, Tower]> {
    return this.manned.entries();
  }

  /** The player who sits in `tower`, null when nobody does. */
  private playerIn(tower: Tower): string | null {
    for (const [playerId, manned] of this.manned) if (manned === tower) return playerId;
    return null;
  }

  /**
   * The player gets into `tower`: out of the one they sat in, the tower
   * drops its target, the automatic fire stops (Tower.findTarget) and the
   * turret follows the aim, starting where it points now. Emits tower:manned.
   * @returns false for a tower that cannot be manned
   */
  man(tower: Tower, playerId: string = this.actingPlayer()): boolean {
    if (!TowerLifecycle.canMan(tower)) return false;
    const current = this.manned.get(playerId);
    if (current === tower) return true;
    // Somebody else sits in it
    if (tower.manned) return false;
    if (current) this.release(current);
    tower.manned = true;
    tower.triggerHeld = false;
    tower.clearTarget();
    releaseAim(tower.aim);
    tower.manualAim.heading = tower.aim.current;
    tower.manualAim.pitch = 0;
    this.manned.set(playerId, tower);
    this.emitManned(tower.id, playerId);
    return true;
  }

  /** The player gets out; the tower fires by itself again. Emits tower:manned with null. */
  leave(playerId: string = this.actingPlayer()): void {
    const tower = this.manned.get(playerId);
    if (!tower) return;
    this.release(tower);
    this.manned.delete(playerId);
    this.emitManned(null, playerId);
  }

  /** Every player out, e.g. at game over or a restart. */
  leaveAll(): void {
    for (const playerId of [...this.manned.keys()]) this.leave(playerId);
  }

  /** Trigger of the player's manned tower; nothing without one. */
  setTrigger(held: boolean, playerId: string = this.actingPlayer()): void {
    const tower = this.manned.get(playerId);
    if (tower) tower.triggerHeld = held;
  }

  private emitManned(towerId: string | null, playerId: string): void {
    this.eventBus.emit({ type: 'tower:manned', towerId, playerId, local: playerId === this.creditsLedger.localPlayer });
  }

  private release(tower: Tower): void {
    tower.manned = false;
    tower.triggerHeld = false;
    this.combat.clearMannedAim(tower.id);
    releaseAim(tower.aim);
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
      if (this.research(tower.ownerId).getMaxUpgradeTier() < requiredTier) return false;
    }

    if (!this.creditsLedger.spend(cost, 'upgrade', this.actingPlayer())) return false;

    const upgrade = tower.typeConfig.upgrades.find(u => u.id === upgradeId);
    const previousLevel = tower.getUpgradeLevel(upgradeId);
    tower.applyUpgrade(upgradeId);

    // Research Center slot upgrade
    if (upgrade?.effect.stat === 'research-slots' && tower.typeConfig.id === 'research-center') {
      this.research(tower.ownerId).upgradeCenter();
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
      upgradeId,
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
            this.research(tower.ownerId).upgradeCenter();
          }
        }
      }
      if (rangeChanged) {
        this.recomputeRangeAfterUpgrade(tower);
      }
      this.eventBus.emit({ type: 'tower:upgraded', tower, level: 0, cost: 0, upgradeId: 'debug-max' });
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
    // Restart, new place: everybody out of their tower before the towers go
    this.leaveAll();

    // First deselect any selected tower (hides its LOS visualization)
    this.towerManager.selectTower(null);

    // Delegate to TowerPlacementService
    this.placement.clearAllTowerOverlays(this.towerManager.getAll());
  }

  /**
   * research:completed. AA-Retrofit unlocks air targeting for towers that
   * were placed WITHOUT it. Their per-cell air visibility was never resolved
   * (registerTower ran with canTargetAir=false), so `cell.airVisibility` has
   * no entry for them, and combat counts a missing answer as not visible:
   * re-register the affected towers so the grid answers for them.
   * registerTowerIncremental only samples the entries that are actually
   * missing.
   *
   * Queued rather than run in this handler: each recompute renders a cube,
   * and the research can reach many towers at once. The game loop drains
   * the queue, one tower per frame (TowerLosRegistry.drainLosQueue); the air
   * flag comes from the ResearchManager, which sets it before the event.
   */
  scheduleAirRetrofit(effects: ResearchEffect[], playerId: string): void {
    const unlocksAir = effects.some(
      e => e.kind === 'enable-targeting' && e.capability === 'air',
    );
    if (!unlocksAir) return;
    for (const tower of this.towerManager.getAll()) {
      // The research is the player's: only their towers get the retrofit
      if (tower.ownerId !== playerId) continue;
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
