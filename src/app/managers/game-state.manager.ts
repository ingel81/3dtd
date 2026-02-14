import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { EnemyManager } from './enemy.manager';
import { TowerManager } from './tower.manager';
import { ProjectileManager } from './projectile.manager';
import { WaveManager, SpawnPoint, WaveConfig } from './wave.manager';
import { UIStore } from '../store/ui.store';
import { GameStore } from '../store/game.store';
import { PathAndRouteService } from '../services/path-route.service';
import { GlobalRouteGridService } from '../services/global-route-grid.service';
import { SpatialGridService } from '../services/spatial-grid.service';
import { CombatEffectService } from '../services/combat-effect.service';
import { HQDamageService } from '../services/hq-damage.service';
import { TowerCombatService } from '../services/tower-combat.service';
import { EntityPoolService } from '../services/entity-pool.service';
import { OsmStreetService, StreetNetwork } from '../services/osm-street.service';
import { WaveDebugService } from '../services/wave-debug.service';
import { EnemyDebugService } from '../services/enemy-debug.service';
import { MarkerVisualizationService } from '../services/marker-visualization.service';
import { TowerPlacementService } from '../services/tower-placement.service';
import { GeoPosition } from '../models/game.types';
import { GameObject } from '../core/game-object';
import { ENEMY_TYPES } from '../models/enemy-types';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { TIMING } from '../configs/timing.config';
import { Tower } from '../entities/tower.entity';
import { ThreeTilesEngine } from '../three-engine';
import { GameEventBus, VFXService, AudioService, ScreenShakeService, SubscriptionBag } from '../game-engine';
import { PerformanceProfilerService } from '../services/performance-profiler.service';

/**
 * Main game state orchestrator - coordinates all entity managers
 *
 * Handles game lifecycle, wave progression, and provides a unified API
 * for the game component to interact with.
 */
@Injectable()
export class GameStateManager {
  // Angular-injected services (UI & coordination)
  private readonly uiStore = inject(UIStore);
  private readonly pathRouteService = inject(PathAndRouteService);
  private readonly globalRouteGrid = inject(GlobalRouteGridService);
  private readonly combatEffect = inject(CombatEffectService);
  private readonly hqDamage = inject(HQDamageService);
  private readonly towerCombat = inject(TowerCombatService);
  private readonly entityPool = inject(EntityPoolService);
  private readonly osmService = inject(OsmStreetService);
  private readonly waveDebug = inject(WaveDebugService);
  private readonly enemyDebug = inject(EnemyDebugService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly gameStore = inject(GameStore);
  private readonly spatialGrid = inject(SpatialGridService);

  // Game Engine (framework-agnostic)
  private readonly eventBus = new GameEventBus();
  private vfxService!: VFXService;
  private audioService!: AudioService;
  screenShakeService!: ScreenShakeService;
  readonly towerManager = new TowerManager(this.eventBus, this.osmService);
  readonly enemyManager = new EnemyManager(this.eventBus, this.entityPool, this.globalRouteGrid, this.spatialGrid);
  readonly projectileManager = new ProjectileManager(this.eventBus, this.entityPool);
  readonly waveManager = new WaveManager(this.eventBus, this.enemyManager);

  // Game state signals
  readonly baseHealth = signal<number>(GAME_BALANCE.player.startHealth);
  readonly credits = signal<number>(GAME_BALANCE.player.startCredits);
  /** Game over screen signal - delegated to HQDamageService */
  readonly showGameOverScreen = computed(() => this.hqDamage.showGameOverScreen());

  /** Training mode timescale (1.0 = normal, 3.0 = 3x speed) */
  readonly trainingTimescale = signal<number>(1.0);

  /** Sync timescale from GameStore (UI source of truth) → local signal */
  private readonly timescaleSyncEffect = effect(() => {
    const storeValue = this.gameStore.trainingTimescale();
    this.trainingTimescale.set(storeValue);
  });

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

  // Performance profiler (optional, set via setProfiler())
  private profiler: PerformanceProfilerService | null = null;

  /** EventBus subscription bag — cleaned up in reset() */
  private readonly eventBusSubs = new SubscriptionBag();

  /**
   * Set performance profiler for frame timing instrumentation.
   */
  setProfiler(profiler: PerformanceProfilerService): void {
    this.profiler = profiler;
  }

  /**
   * Initialize game state with ThreeTilesEngine
   */
  initialize(
    tilesEngine: ThreeTilesEngine,
    streetNetwork: StreetNetwork,
    basePosition: GeoPosition,
    spawnPoints: SpawnPoint[],
    cachedPaths: Map<string, GeoPosition[]>
  ): void {
    this.tilesEngine = tilesEngine;
    this.basePosition = basePosition;

    // Initialize defense-reach debug visualization (orange marker)
    this.globalRouteGrid.initDebugViz(tilesEngine.getScene());

    // Initialize entity managers (no callbacks - use events)
    this.enemyManager.initialize(tilesEngine);

    this.towerManager.initializeWithContext(
      tilesEngine,
      streetNetwork,
      basePosition,
      spawnPoints.map((s) => ({ lat: s.lat, lon: s.lon }))
    );

    // Initialize combat effect service (subscribes to projectile:hit events)
    this.combatEffect.initialize(
      tilesEngine,
      this.eventBus,
      this.towerManager,
      this.enemyManager,
      () => this.trainingTimescale()
    );

    // Initialize HQ damage service (handles fire, sounds, game over effects)
    this.hqDamage.initialize(tilesEngine, basePosition, this.eventBus);

    // Initialize tower combat service (handles targeting, rotation, shooting)
    this.towerCombat.initialize(tilesEngine);

    // Initialize VFX service (subscribes to vfx events)
    this.vfxService = new VFXService(this.eventBus, tilesEngine);

    // Initialize Audio service (subscribes to audio events)
    this.audioService = new AudioService(this.eventBus, tilesEngine);

    // Initialize Screen Shake service (subscribes to explosion/impact events)
    this.screenShakeService = new ScreenShakeService(this.eventBus, tilesEngine);

    // Register event handlers (tracked via SubscriptionBag for cleanup in reset())
    this.eventBusSubs.add(this.eventBus.on('enemy:reached-base', (event) => {
      const oldHealth = this.baseHealth();
      const newHealth = Math.max(0, oldHealth - event.damage);
      this.baseHealth.set(newHealth);

      // Emit health:changed - HQDamageService subscribes
      this.eventBus.emit({
        type: 'health:changed',
        health: newHealth,
        delta: newHealth - oldHealth,
      });
    }));

    this.eventBusSubs.add(this.eventBus.on('enemy:died', (event) => {
      if (event.credits > 0) {
        this.updateCredits(event.credits);

        // Show reward popup with actual dynamic credits (not static typeConfig.reward)
        if (this.tilesEngine) {
          this.tilesEngine.effects.spawnFloatingText(
            `+${event.credits}`,
            event.enemy.position.lat,
            event.enemy.position.lon,
            event.enemy.transform.terrainHeight + 5,
            {
              color: '#FFD700',
              duration: TIMING.rewardPopupDuration,
              floatSpeed: 1.5,
              scale: 0.75,
            }
          );
        }
      }
    }));

    // ══════════════════════════════════════════════════════════════
    // Command event handlers (UI → Game Engine)
    // ══════════════════════════════════════════════════════════════

    this.eventBusSubs.add(this.eventBus.on('command:place-tower', (event) => {
      this.placeTower(
        { lat: event.position.lat, lon: event.position.lon, height: event.position.height },
        event.typeId,
        event.rotation ?? 0
      );
    }));

    this.eventBusSubs.add(this.eventBus.on('command:sell-tower', (event) => {
      const tower = this.towerManager.getAll().find(t => t.id === event.towerId);
      if (tower) {
        this.sellTower(tower);
      }
    }));

    this.eventBusSubs.add(this.eventBus.on('command:upgrade-tower', (event) => {
      const tower = this.towerManager.getAll().find(t => t.id === event.towerId);
      if (!tower) return;

      const upgradeId = event.upgradeId;
      const cost = tower.getNextUpgradeCost(upgradeId);
      if (cost <= 0 || !tower.canUpgrade(upgradeId)) return;

      if (this.spendCredits(cost)) {
        const upgrade = tower.typeConfig.upgrades.find(u => u.id === upgradeId);
        const previousLevel = tower.getUpgradeLevel(upgradeId);
        tower.applyUpgrade(upgradeId);

        // If range changed, recompute LOS cells so targeting uses the new range
        if (upgrade?.effect.stat === 'range') {
          this.towerPlacement.recomputeTowerLOS(tower);
          // Update rangeSquaredGeo for sleep/wake checks
          const pos = tower.position;
          const metersPerDegreeLat = 111320;
          const metersPerDegreeLon = 111320 * Math.cos(pos.lat * 0.0174533);
          const avgMetersPerDegree = (metersPerDegreeLat + metersPerDegreeLon) / 2;
          const rangeInDegrees = tower.combat.range / avgMetersPerDegree;
          tower.rangeSquaredGeo = rangeInDegrees * rangeInDegrees;
        }

        this.eventBus.emit({
          type: 'tower:upgraded',
          tower,
          level: previousLevel + 1,
          cost,
        });
      }
    }));

    this.eventBusSubs.add(this.eventBus.on('command:start-wave', (event) => {
      if (event.config) {
        this.startWave(event.config);
      } else {
        this.beginWave();
      }
    }));

    this.eventBusSubs.add(this.eventBus.on('command:restart-game', () => {
      this.reset();
    }));

    this.eventBusSubs.add(this.eventBus.on('debug:add-credits', (event) => {
      this.updateCredits(event.amount);
    }));

    this.eventBusSubs.add(this.eventBus.on('debug:add-health', (event) => {
      const oldHealth = this.baseHealth();
      const newHealth = Math.max(0, oldHealth + event.amount);
      this.baseHealth.set(newHealth);
      this.eventBus.emit({
        type: 'health:changed',
        health: newHealth,
        delta: newHealth - oldHealth,
      });
    }));

    // Initialize projectile manager (no callback - uses events)
    this.projectileManager.initialize(tilesEngine);

    this.waveManager.initialize(spawnPoints, cachedPaths);
    this.waveManager.setTimescaleProvider(() => this.trainingTimescale());
  }

  /**
   * Main update loop - called EVERY FRAME regardless of phase
   * Phase controls WHAT updates, not IF updates happen
   */
  update(currentTime: number): void {
    const frameStart = performance.now();
    const profiling = this.profiler !== null;

    const rawDeltaTime = this.lastUpdateTime ? currentTime - this.lastUpdateTime : 16;
    this.lastUpdateTime = currentTime;

    // Apply training timescale (accelerates gameplay for faster training)
    const timescale = this.trainingTimescale();
    const deltaTime = rawDeltaTime * timescale;

    // Sync timescale to renderer (turret rotation speed)
    this.tilesEngine?.setTimescale(timescale);

    // ══════════════════════════════════════════════════════════════
    // ALWAYS UPDATE (Phase-independent)
    // ══════════════════════════════════════════════════════════════

    // Projectiles always complete their flight path
    let t0 = profiling ? performance.now() : 0;
    this.projectileManager.update(deltaTime);
    const tProjectile = profiling ? performance.now() - t0 : 0;

    // Process deferred events (VFX, audio, etc.) at stable point in game loop
    t0 = profiling ? performance.now() : 0;
    this.eventBus.processQueue();
    const tEvents = profiling ? performance.now() - t0 : 0;

    // Check combat conditions
    const hasDebugEnemies = this.enemyDebug.debugEnemies().length > 0;
    const isWavePhase = this.waveManager.phase() === 'wave';
    const shouldRunCombat = isWavePhase || hasDebugEnemies;

    // Tower idle rotation (smooth return to base position) - only when no combat
    let tTower = 0;
    t0 = profiling ? performance.now() : 0;
    if (!shouldRunCombat) {
      this.towerCombat.updateTowerIdleRotations(this.towerManager);
    }
    tTower = profiling ? performance.now() - t0 : 0;

    // Enemy movement - always update (debug enemies may move outside wave phase)
    // Paused enemies (e.g., during gathering) won't move due to movement.paused check
    if (this.enemyManager.getAll().length > 0) {
      this.enemyManager.update(deltaTime, this.trainingTimescale());
    }

    // Tower combat (targeting + firing)
    let tCombat = 0;
    if (shouldRunCombat) {
      t0 = profiling ? performance.now() : 0;
      this.towerCombat.updateTowerShooting(
        currentTime,
        this.towerManager,
        this.enemyManager,
        this.projectileManager,
        this.trainingTimescale()
      );

      // Beam tower combat (continuous flame damage)
      this.towerCombat.updateBeamTowers(
        deltaTime,
        this.towerManager,
        this.enemyManager,
        this.trainingTimescale()
      );

      // Melee tower combat (tentacle strikes)
      this.towerCombat.updateMeleeTowers(
        deltaTime,
        this.towerManager,
        this.enemyManager,
        this.trainingTimescale()
      );
      tCombat = profiling ? performance.now() - t0 : 0;
    }

    // Accumulate frame timings (tower idle + tower combat combined)
    if (profiling) {
      this.profiler!.accumulateFrameTiming(
        tTower, tProjectile, tCombat, tEvents,
        performance.now() - frameStart,
      );
    }

    // ══════════════════════════════════════════════════════════════
    // WAVE PHASE ONLY
    // ══════════════════════════════════════════════════════════════

    if (!isWavePhase) return;

    // Check wave completion
    if (this.waveManager.checkWaveComplete()) {
      this.waveManager.endWave();
      this.towerCombat.stopAllBeams(); // Stop fire tower beams
      this.towerCombat.stopAllMelee(); // Stop tentacle visuals
      this.enemyDebug.clearDebugEnemies(); // Clear orphaned debug enemy references
      this.updateCredits(GAME_BALANCE.waves.completionBonus);
    }

    // Check game over
    if (this.baseHealth() <= 0 && this.waveManager.phase() !== 'gameover') {
      this.triggerGameOver();
    }
  }

  /**
   * Trigger game over state
   */
  private triggerGameOver(): void {
    this.waveManager.phase.set('gameover');
    this.enemyManager.clear();
    this.enemyDebug.clearDebugEnemies(); // Clear orphaned debug enemy references
    this.towerManager.selectTower(null);

    // Delegate visual effects to HQDamageService
    this.hqDamage.triggerGameOverEffects();

    // Emit game:over event
    this.eventBus.emit({
      type: 'game:over',
      reason: 'base-destroyed',
    });
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Start a new wave with config
   */
  startWave(config: WaveConfig): void {
    // Update wave preview in sidebar with actual values (NOT timescaled)
    if (config.enemyType) {
      const enemyConfig = ENEMY_TYPES[config.enemyType];
      const baseHp = enemyConfig.baseHp;
      const baseSpeed = enemyConfig.baseSpeed;
      const actualHp = config.enemyHealth ?? baseHp;
      const actualSpeed = config.enemySpeed ?? baseSpeed;
      const healthMultiplier = actualHp / baseHp;
      const speedMultiplier = actualSpeed / baseSpeed;

      this.waveDebug.setCurrentWaveConfig(
        config.enemyType,
        config.enemyCount,
        baseHp,
        actualHp,
        baseSpeed,
        actualSpeed,
        config.spawnDelay,
        healthMultiplier,
        speedMultiplier
      );
    }

    const isFirstWave = this.waveManager.waveNumber() === 0;

    // Emit lifecycle event BEFORE startWave() so that AIDataCollector.clearHistory()
    // runs before wave:started sets up tracking (prevents NaN in wave history)
    if (isFirstWave) {
      this.eventBus.emit({ type: 'game:started' });
    }

    this.waveManager.startWave(config);
  }

  /**
   * Begin wave phase without auto-spawning
   */
  beginWave(): void {
    const isFirstWave = this.waveManager.waveNumber() === 0;

    // Emit lifecycle event BEFORE beginWave() so that AIDataCollector.clearHistory()
    // runs before wave:started sets up tracking (prevents NaN in wave history)
    if (isFirstWave) {
      this.eventBus.emit({ type: 'game:started' });
    }

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
   * Full dispose — called when the component is destroyed.
   * Cleans up EventBus subscriptions that were registered in initialize().
   */
  dispose(): void {
    this.eventBusSubs.disposeAll();
    this.hqDamage.reset();

    this.enemyManager.clear();
    this.towerManager.clear();
    this.projectileManager.clear();
    this.waveManager.reset();
    this.globalRouteGrid.clear();

    if (this.tilesEngine) {
      this.tilesEngine.effects.clear();
    }
  }

  /**
   * Reset game to initial state (restart).
   * Does NOT dispose EventBus subscriptions — handlers stay active for the next game.
   */
  reset(): void {
    // Reset HQ damage service (clears fires, timeouts, game over screen)
    this.hqDamage.reset();

    // Clear tower overlays before clearing towers
    this.clearAllTowerOverlays();

    this.enemyManager.clear();
    this.enemyDebug.clearDebugEnemies(); // Clear orphaned debug enemy references
    this.towerManager.clear();
    this.projectileManager.clear();
    this.waveManager.reset();

    // Clear GlobalRouteGrid (will be re-initialized on location change)
    this.globalRouteGrid.clear();

    if (this.tilesEngine) {
      this.tilesEngine.effects.clear();
    }

    this.baseHealth.set(GAME_BALANCE.player.startHealth);
    this.updateCredits(GAME_BALANCE.player.startCredits - this.credits());
    this.lastUpdateTime = 0;

    GameObject.resetIdCounter();

    // Emit game:reset so downstream services (e.g. GameStateSyncService) can react
    this.eventBus.emit({ type: 'game:reset' });
  }

  private updateCredits(delta: number): void {
    const newCredits = this.credits() + delta;
    this.credits.set(newCredits);
    this.eventBus.emit({
      type: 'credits:changed',
      credits: newCredits,
      delta,
    });
  }

  /**
   * Clear all tower overlays (LOS visualizations + GlobalRouteGrid registrations)
   * Called on reset to cleanup before starting fresh
   */
  private clearAllTowerOverlays(): void {
    // First deselect any selected tower (hides its LOS visualization)
    this.towerManager.selectTower(null);

    // Delegate to TowerPlacementService
    this.towerPlacement.clearAllTowerOverlays(this.towerManager.getAll());
  }

  /**
   * Sell a tower and refund 50% of its cost
   */
  sellTower(tower: Tower): number {
    // Unregister from grid + dispose LOS visualization
    this.towerPlacement.unregisterTowerFromGrid(tower);

    this.towerManager.selectTower(null);

    // Sell tower (emits tower:sold event, returns refund)
    const refund = this.towerManager.sell(tower);
    this.updateCredits(refund);
    return refund;
  }

  /**
   * Spend credits (for upgrades etc.)
   * @returns true if credits were spent, false if not enough
   */
  spendCredits(amount: number): boolean {
    if (this.credits() < amount) return false;
    this.updateCredits(-amount);
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

    if (tower) {
      // Deduct cost
      this.updateCredits(-config.cost);

      // Register tower on grid (LOS raycasting + grid registration + visualization)
      this.towerPlacement.registerTowerOnGrid(tower, position, typeId);
    }
    return tower;
  }

  /**
   * Called when tiles are loaded - notifies HQ damage service
   */
  onTilesLoaded(): void {
    this.hqDamage.onTilesLoaded();

    // Spawn debug point if debug option is enabled
    if (this.uiStore.specialPointsDebugVisible()) {
      this.markerViz.spawnHQDebugPoint();
    }
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

  /**
   * Calculate defense reach percent — delegates to GlobalRouteGridService.
   * @see GlobalRouteGridService.getDefenseReachPercent
   */
  getDefenseReachPercent(): number {
    return this.globalRouteGrid.getDefenseReachPercent(this.getCachedRoutes());
  }

  /**
   * Get EventBus for external subscriptions (e.g., game:over in UI components)
   */
  getEventBus(): GameEventBus {
    return this.eventBus;
  }

  /**
   * Get spawn points for bot/AI use
   */
  getSpawnPoints(): SpawnPoint[] {
    return this.waveManager.spawnPoints;
  }

  /**
   * Get cached paths for bot/AI use
   */
  getCachedPaths(): Map<string, GeoPosition[]> {
    return this.pathRouteService.getCachedPaths();
  }

  /**
   * Set training mode timescale
   * @param scale Timescale multiplier (1.0 = normal, 75.0 = 75x speed)
   * @param persist Whether to save to localStorage (default: true, set to false for automatic backend settings)
   */
  setTrainingTimescale(scale: number, persist = true): void {
    const clamped = Math.max(0.1, Math.min(75, scale));
    this.trainingTimescale.set(clamped);
    // Also update the global store so UI components stay in sync
    this.gameStore.trainingTimescale.set(clamped);
    if (persist) {
      localStorage.setItem('training-timescale', clamped.toString());
    }
  }
}
