import { Injectable, inject, signal, computed } from '@angular/core';
import { Material } from 'three';
import { EnemyManager } from './enemy.manager';
import { TowerManager } from './tower.manager';
import { ProjectileManager } from './projectile.manager';
import { WaveManager, SpawnPoint, WaveConfig } from './wave.manager';
import { GameUIStateService } from '../services/game-ui-state.service';
import { PathAndRouteService } from '../services/path-route.service';
import { GlobalRouteGridService } from '../services/global-route-grid.service';
import { CombatEffectService } from '../services/combat-effect.service';
import { HQDamageService } from '../services/hq-damage.service';
import { TowerCombatService } from '../services/tower-combat.service';
import { StreetNetwork } from '../services/osm-street.service';
import { GeoPosition } from '../models/game.types';
import { GameObject } from '../core/game-object';
import { Enemy } from '../entities/enemy.entity';
import { Projectile } from '../entities/projectile.entity';
import { EnemyTypeId } from '../models/enemy-types';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { Tower } from '../entities/tower.entity';
import { ThreeTilesEngine } from '../three-engine';

/**
 * Main game state orchestrator - coordinates all entity managers
 *
 * Handles game lifecycle, wave progression, and provides a unified API
 * for the game component to interact with.
 */
@Injectable()
export class GameStateManager {
  // Entity managers
  readonly enemyManager = inject(EnemyManager);
  readonly towerManager = inject(TowerManager);
  readonly projectileManager = inject(ProjectileManager);
  readonly waveManager = inject(WaveManager);
  private readonly uiState = inject(GameUIStateService);
  private readonly pathRouteService = inject(PathAndRouteService);
  private readonly globalRouteGrid = inject(GlobalRouteGridService);
  private readonly combatEffect = inject(CombatEffectService);
  private readonly hqDamage = inject(HQDamageService);
  private readonly towerCombat = inject(TowerCombatService);

  // Game state signals
  readonly baseHealth = signal<number>(GAME_BALANCE.player.startHealth);
  readonly credits = signal<number>(GAME_BALANCE.player.startCredits);
  /** Game over screen signal - delegated to HQDamageService */
  readonly showGameOverScreen = computed(() => this.hqDamage.showGameOverScreen());

  // Computed signals for UI bindings
  readonly phase = computed(() => this.waveManager.phase());
  readonly waveNumber = computed(() => this.waveManager.waveNumber());
  readonly towerCount = computed(() => this.towerManager.getAll().length);
  readonly enemiesAlive = computed(() => this.enemyManager.aliveCount());
  readonly selectedTowerId = computed(() => this.towerManager.getSelectedId());
  readonly selectedTower = computed(() => this.towerManager.getSelected());

  // Engine reference
  private tilesEngine: ThreeTilesEngine | null = null;
  private lastUpdateTime = 0;
  private basePosition: GeoPosition | null = null;

  // Callbacks
  private onGameOverCallback?: () => void;
  private onDebugLogCallback?: (msg: string) => void;

  /**
   * Initialize game state with ThreeTilesEngine
   */
  initialize(
    tilesEngine: ThreeTilesEngine,
    streetNetwork: StreetNetwork,
    basePosition: GeoPosition,
    spawnPoints: SpawnPoint[],
    cachedPaths: Map<string, GeoPosition[]>,
    onDebugLog?: (msg: string) => void,
    onGameOver?: () => void
  ): void {
    this.tilesEngine = tilesEngine;
    this.basePosition = basePosition;
    this.onGameOverCallback = onGameOver;
    this.onDebugLogCallback = onDebugLog;

    // Initialize entity managers
    this.enemyManager.initialize(
      tilesEngine,
      (enemy) => this.onEnemyReachedBase(enemy)
    );

    this.towerManager.initializeWithContext(
      tilesEngine,
      streetNetwork,
      basePosition,
      spawnPoints.map((s) => ({ lat: s.latitude, lon: s.longitude }))
    );

    // Initialize combat effect service
    this.combatEffect.initialize(tilesEngine);

    // Initialize HQ damage service (handles fire, sounds, game over effects)
    this.hqDamage.initialize(tilesEngine, basePosition);

    // Initialize tower combat service (handles targeting, rotation, shooting)
    this.towerCombat.initialize(tilesEngine);

    this.projectileManager.initialize(
      tilesEngine,
      (proj, enemy) => this.handleProjectileHit(proj, enemy)
    );

    this.waveManager.initialize(spawnPoints, cachedPaths);
  }

  /**
   * Main update loop - called EVERY FRAME regardless of phase
   * Phase controls WHAT updates, not IF updates happen
   */
  update(currentTime: number): void {
    const deltaTime = this.lastUpdateTime ? currentTime - this.lastUpdateTime : 16;
    this.lastUpdateTime = currentTime;

    // ══════════════════════════════════════════════════════════════
    // ALWAYS UPDATE (Phase-independent)
    // ══════════════════════════════════════════════════════════════

    // Projectiles always complete their flight path
    this.projectileManager.update(deltaTime);

    // Tower idle rotation (smooth return to base position) - only when not in wave
    if (this.waveManager.phase() !== 'wave') {
      this.towerCombat.updateTowerIdleRotations(this.towerManager);
    }

    // ══════════════════════════════════════════════════════════════
    // WAVE PHASE ONLY
    // ══════════════════════════════════════════════════════════════

    if (this.waveManager.phase() !== 'wave') return;

    // Enemy movement
    this.enemyManager.update(deltaTime);

    // Tower combat (targeting + firing) - delegates to TowerCombatService
    this.towerCombat.updateTowerShooting(
      currentTime,
      this.towerManager,
      this.enemyManager,
      this.projectileManager
    );

    // Check wave completion
    if (this.waveManager.checkWaveComplete()) {
      this.waveManager.endWave();
      this.credits.update((c) => c + GAME_BALANCE.waves.completionBonus);
    }

    // Check game over
    if (this.baseHealth() <= 0 && this.waveManager.phase() !== 'gameover') {
      this.triggerGameOver();
    } else if (this.baseHealth() < 100 && this.baseHealth() > 0) {
      this.hqDamage.updateFireIntensity(this.baseHealth());
    }
  }


  /**
   * Handle enemy reaching the base
   */
  private onEnemyReachedBase(_enemy: Enemy): void {
    this.baseHealth.update((h) => Math.max(0, h - GAME_BALANCE.combat.enemyBaseDamage));
    this.hqDamage.updateFireIntensity(this.baseHealth());
    this.hqDamage.playDamageSound();
  }

  /**
   * Handle projectile hitting an enemy - delegates to CombatEffectService
   */
  private handleProjectileHit(projectile: Projectile, enemy: Enemy): void {
    const result = this.combatEffect.onProjectileHit(
      projectile,
      enemy,
      this.towerManager,
      this.enemyManager
    );
    if (result.reward > 0) {
      this.credits.update((c) => c + result.reward);
    }
  }


  /**
   * Trigger game over state
   */
  private triggerGameOver(): void {
    this.waveManager.phase.set('gameover');
    this.enemyManager.clear();
    this.towerManager.selectTower(null);

    // Delegate visual effects to HQDamageService
    this.hqDamage.triggerGameOverEffects();
    this.onGameOverCallback?.();
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Start a new wave with config
   */
  startWave(config: WaveConfig): void {
    this.waveManager.startWave(config);
  }

  /**
   * Begin wave phase without auto-spawning
   */
  beginWave(): void {
    this.waveManager.beginWave();
  }

  /**
   * Heal base to full health
   */
  healBase(): void {
    this.baseHealth.set(100);
    this.hqDamage.healBase();
  }

  /**
   * Reset game to initial state
   */
  reset(): void {
    // Reset HQ damage service (clears fires, timeouts, game over screen)
    this.hqDamage.reset();

    // Clear tower overlays before clearing towers
    this.clearAllTowerOverlays();

    this.enemyManager.clear();
    this.towerManager.clear();
    this.projectileManager.clear();
    this.waveManager.reset();

    // Clear GlobalRouteGrid (will be re-initialized on location change)
    this.globalRouteGrid.clear();

    if (this.tilesEngine) {
      this.tilesEngine.effects.clear();
    }

    this.baseHealth.set(GAME_BALANCE.player.startHealth);
    this.credits.set(GAME_BALANCE.player.startCredits);
    this.lastUpdateTime = 0;

    GameObject.resetIdCounter();
  }

  /**
   * Get all towers
   */
  towers(): Tower[] {
    return this.towerManager.getAll();
  }

  /**
   * Get all enemies
   */
  enemies(): Enemy[] {
    return this.enemyManager.getAll();
  }

  /**
   * Spawn an enemy
   */
  spawnEnemy(
    path: GeoPosition[],
    typeId: EnemyTypeId,
    speed?: number,
    paused = false,
    health?: number
  ): Enemy {
    return this.enemyManager.spawn(path, typeId, speed, paused, health);
  }

  /**
   * Start all paused enemies
   */
  startAllEnemies(delayBetween = 300): void {
    this.enemyManager.startAll(delayBetween);
  }

  /**
   * Select a tower
   */
  selectTower(id: string): void {
    this.towerManager.selectTower(id);
  }

  /**
   * Deselect all towers
   */
  deselectAll(): void {
    this.towerManager.selectTower(null);
  }

  /**
   * Clear all tower overlays (LOS visualizations + GlobalRouteGrid registrations)
   * Called on reset to cleanup before starting fresh
   */
  private clearAllTowerOverlays(): void {
    // First deselect any selected tower (hides its LOS visualization)
    this.towerManager.selectTower(null);

    // Then dispose all LOS visualizations
    for (const tower of this.towerManager.getAll()) {
      // Dispose LOS visualization
      if (tower.losVisualization && this.tilesEngine) {
        tower.losVisualization.visible = false; // Ensure hidden
        this.tilesEngine.getScene().remove(tower.losVisualization);
        tower.losVisualization.geometry.dispose();
        (tower.losVisualization.material as Material).dispose();
        tower.losVisualization = null;
      }

      // Unregister from GlobalRouteGrid
      this.globalRouteGrid.unregisterTower(tower.id);
      tower.visibleCells = [];
    }
  }

  /**
   * Sell a tower and refund 50% of its cost
   */
  sellTower(tower: Tower): number {
    const refund = tower.typeConfig.sellValue;

    // Dispose LOS visualization
    if (tower.losVisualization && this.tilesEngine) {
      this.tilesEngine.getScene().remove(tower.losVisualization);
      tower.losVisualization.geometry.dispose();
      (tower.losVisualization.material as Material).dispose();
      tower.losVisualization = null;
    }

    // Unregister from GlobalRouteGrid
    this.globalRouteGrid.unregisterTower(tower.id);
    tower.visibleCells = []; // Clear references

    this.towerManager.selectTower(null);
    this.towerManager.remove(tower);
    this.credits.update((c) => c + refund);
    return refund;
  }

  /**
   * Spend credits (for upgrades etc.)
   * @returns true if credits were spent, false if not enough
   */
  spendCredits(amount: number): boolean {
    if (this.credits() < amount) return false;
    this.credits.update((c) => c - amount);
    return true;
  }

  /**
   * Place a new tower
   * @param position Geo position
   * @param typeId Tower type ID
   * @param customRotation Custom rotation set by user (radians)
   */
  placeTower(position: GeoPosition, typeId: TowerTypeId = 'archer', customRotation = 0): Tower | null {
    const config = TOWER_TYPES[typeId];
    if (!config) return null;

    // Check if player has enough credits
    if (this.credits() < config.cost) {
      return null;
    }

    const tower = this.towerManager.placeTower(position, typeId, customRotation);
    if (tower && this.tilesEngine && this.globalRouteGrid.isInitialized()) {
      // Deduct cost
      this.credits.update((c) => c - config.cost);

      // Register tower with GlobalRouteGrid for LOS pre-computation
      // IMPORTANT: Use geoToLocalSimple for consistency with grid cell coordinates
      const terrainPos = this.tilesEngine.sync.geoToLocalSimple(position.lat, position.lon, position.height ?? 0);
      const tipY = terrainPos.y + config.heightOffset + config.shootHeight;

      // Get LOS raycaster from tower renderer
      const losRaycaster = this.tilesEngine.towers.getLosRaycaster();

      if (losRaycaster) {
        // Check if this is a pure air tower (only targets air, not ground)
        const isPureAirTower = (config.canTargetAir ?? false) && !(config.canTargetGround ?? true);

        // Register tower and store visible cells reference
        // Air towers skip LOS checks (air enemies are always visible)
        tower.visibleCells = this.globalRouteGrid.registerTower(
          tower.id,
          terrainPos.x,
          terrainPos.z,
          tipY,
          config.range,
          losRaycaster,
          isPureAirTower
        );

        // Create LOS visualization (hidden by default, shown on selection)
        tower.losVisualization = this.globalRouteGrid.createTowerVisualization(
          tower.id,
          terrainPos.x,
          terrainPos.z,
          config.range
        );

        if (tower.losVisualization) {
          tower.losVisualization.visible = false;
          this.tilesEngine.getScene().add(tower.losVisualization);
        }
      } else {
        console.warn('[GameStateManager] placeTower: no losRaycaster!');
      }
    } else if (tower) {
      // Still deduct cost even if grid not initialized
      this.credits.update((c) => c - config.cost);
    }
    return tower;
  }

  /**
   * Kill an enemy
   */
  killEnemy(enemy: Enemy): void {
    this.enemyManager.kill(enemy);
  }

  /**
   * Check if wave is complete
   */
  checkWaveComplete(): boolean {
    return this.waveManager.checkWaveComplete();
  }

  /**
   * End current wave
   */
  endWave(): void {
    this.waveManager.endWave();
  }

  /**
   * Stop all pending spawns (for Kill All functionality)
   */
  stopSpawning(): void {
    this.waveManager.stopSpawning();
  }

  /**
   * Log debug message
   */
  debugLog(msg: string): void {
    this.onDebugLogCallback?.(msg);
  }

  /**
   * Called when tiles are loaded - notifies HQ damage service
   */
  onTilesLoaded(): void {
    this.hqDamage.onTilesLoaded();

    // Spawn debug point if debug option is enabled
    if (this.uiState.specialPointsDebugVisible()) {
      this.spawnHQDebugPoint();
    }
  }

  /**
   * Spawn or update HQ debug point at cached terrain height
   */
  spawnHQDebugPoint(): void {
    this.hqDamage.spawnDebugPoint();
  }

  /**
   * Update debug sphere visibility based on UI state
   */
  updateDebugSpheresVisibility(): void {
    if (!this.tilesEngine) return;
    this.tilesEngine.effects.setDebugSpheresVisible(
      this.uiState.specialPointsDebugVisible()
    );
  }

  /**
   * Get cached enemy routes for LOS preview during tower placement
   */
  getCachedRoutes(): GeoPosition[][] {
    return Array.from(this.pathRouteService.getCachedPaths().values());
  }

  /**
   * Initialize GlobalRouteGrid after routes are computed
   * Should be called after engine and routes are ready
   */
  initializeGlobalRouteGrid(): void {
    if (!this.tilesEngine) {
      console.warn('[GameStateManager] Cannot initialize GlobalRouteGrid - no engine');
      return;
    }

    // Initialize with terrain raycaster and coordinate sync
    const terrainRaycaster = (x: number, z: number) => this.tilesEngine!.getTerrainHeightAtLocal(x, z);
    this.globalRouteGrid.initialize(terrainRaycaster, this.tilesEngine.sync);

    // Generate cells from routes
    const routes = this.getCachedRoutes();
    if (routes.length > 0) {
      this.globalRouteGrid.generateFromRoutes(routes);
    }
  }

  /**
   * Get GlobalRouteGrid service (for visualization access)
   */
  getGlobalRouteGrid(): GlobalRouteGridService {
    return this.globalRouteGrid;
  }
}
