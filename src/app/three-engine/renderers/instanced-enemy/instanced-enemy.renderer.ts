import {
  Scene,
  Object3D,
  Camera,
  Vector3,
} from 'three';
import { CoordinateSync } from '../index';
import { EnemyTypeId, ENEMY_TYPES, EnemyTypeConfig } from '../../../configs/enemy-types.config';
import { AssetManagerService } from '../../../services/asset-manager.service';
import { EnemyInstanceManager } from './enemy-instance.manager';
import { HealthBarInstanceManager } from './health-bar-instance.manager';
import { bakeVAT, bakeObjectAnimVAT, bakeStaticVAT } from './vat-baker';

// Dummy Object3D shared across all instanced enemy stubs
const DUMMY_OBJECT = new Object3D();

/**
 * Debug overrides for enemy visual properties.
 * Used by enemy debugger for live tuning of a single enemy.
 */
export interface EnemyDebugOverrides {
  scale?: number;
  heightOffset?: number;
  healthBarOffset?: number;
  rotation?: number; // Y rotation in radians
  animationSpeed?: number; // Direct timeScale override
}

/**
 * Enemy render data - returned by create() for compatibility with enemy manager.
 * For instanced enemies this is a lightweight stub (mesh = DUMMY_OBJECT).
 */
export interface EnemyRenderData {
  id: string;
  mesh: Object3D;
  typeConfig: EnemyTypeConfig;
  isDestroyed: boolean;
  isWalking: boolean;
  lastHeading: number;
}

/**
 * InstancedEnemyRenderer
 *
 * GPU-instanced enemy renderer using Vertex Animation Textures (VAT)
 * for massive draw call reduction.
 *
 * All enemies use instanced rendering. Debug overrides (scale, height,
 * rotation, animation speed) are supported natively per-instance.
 *
 * Target: ~1000 draw calls → ~14 draw calls for 500 enemies
 */
export class InstancedEnemyRenderer {
  // Instanced rendering
  private readonly instanceManager: EnemyInstanceManager;
  private readonly healthBarManager: HealthBarInstanceManager;

  // Track active enemies
  private instancedEnemies = new Set<string>();

  // Track loaded types
  private loadedTypes = new Set<string>();
  private bakingPromises = new Map<string, Promise<void>>();

  // Cached parsed health bar colors per type (avoid repeated hex parsing)
  private healthBarColorCache = new Map<string, { r: number; g: number; b: number } | null>();

  // Reusable temp vector (avoids allocation in hot path)
  private static readonly _tempLocalPos = new Vector3();

  // Display toggle state
  private _showEnemies = true;
  private _showHealthBars = true;
  private _showAnimations = true;

  constructor(
    private readonly scene: Scene,
    private readonly sync: CoordinateSync,
    private readonly assetManager: AssetManagerService,
  ) {
    this.instanceManager = new EnemyInstanceManager(scene);
    this.healthBarManager = new HealthBarInstanceManager(scene);
  }

  // =====================================================
  // PRELOADING
  // =====================================================

  async preloadModel(typeId: EnemyTypeId): Promise<void> {
    const config = ENEMY_TYPES[typeId];
    if (!config) return;

    // Skip if already loaded or loading
    if (this.loadedTypes.has(typeId)) return;
    if (this.bakingPromises.has(typeId)) return this.bakingPromises.get(typeId)!;

    const promise = this.bakeAndCreatePool(typeId, config);
    this.bakingPromises.set(typeId, promise);
    await promise;
    this.bakingPromises.delete(typeId);
  }

  async preloadAllModels(): Promise<void> {
    const types = Object.keys(ENEMY_TYPES) as EnemyTypeId[];
    await Promise.all(types.map((t) => this.preloadModel(t)));
  }

  private async bakeAndCreatePool(typeId: string, config: EnemyTypeConfig): Promise<void> {
    try {
      const cached = await this.assetManager.loadModel(config.modelUrl);

      if (config.hasAnimations && cached.animations.length > 0) {
        // Clone with skeleton for VAT baking
        const clone = this.assetManager.cloneModel(config.modelUrl, { preserveSkeleton: true });
        if (!clone) {
          console.error(`[InstancedRenderer] Clone failed for ${typeId} — enemy type will not render`);
          this.loadedTypes.add(typeId);
          return;
        }

        // Collect animation clip names to bake
        const clipNames: string[] = [];
        if (config.walkAnimation) clipNames.push(config.walkAnimation);
        if (config.runAnimation) clipNames.push(config.runAnimation);
        if (config.deathAnimation) clipNames.push(config.deathAnimation);
        if (config.idleAnimation) clipNames.push(config.idleAnimation);

        let vatData = bakeVAT(clone, cached.animations, clipNames);

        // Fallback: try object/rigid-body animation bake (e.g., mech, hornet)
        if (!vatData) {
          vatData = bakeObjectAnimVAT(clone, cached.animations, clipNames);
        }

        if (vatData) {
          // Use config's unlit flag (material detection is unreliable before conversion)
          if (config.unlit) vatData.isUnlit = true;
          this.instanceManager.createPool(typeId, vatData, config);
          this.loadedTypes.add(typeId);
        } else {
          console.error(`[InstancedRenderer] VAT bake failed for ${typeId} — enemy type will not render`);
          this.loadedTypes.add(typeId);
        }
      } else {
        // Non-animated model → static VAT
        const clone = this.assetManager.cloneModel(config.modelUrl);
        if (!clone) {
          console.error(`[InstancedRenderer] Clone failed for ${typeId} — enemy type will not render`);
          this.loadedTypes.add(typeId);
          return;
        }

        const vatData = bakeStaticVAT(clone);
        if (vatData) {
          if (config.unlit) vatData.isUnlit = true;
          this.instanceManager.createPool(typeId, vatData, config);
          this.loadedTypes.add(typeId);
        } else {
          console.error(`[InstancedRenderer] Static VAT failed for ${typeId} — enemy type will not render`);
          this.loadedTypes.add(typeId);
        }
      }
    } catch (err) {
      console.error(`[InstancedRenderer] Failed to bake ${typeId}:`, err);
      this.loadedTypes.add(typeId);
    }
  }

  // =====================================================
  // CREATE / REMOVE
  // =====================================================

  async create(
    id: string,
    typeId: EnemyTypeId,
    lat: number,
    lon: number,
    height: number,
  ): Promise<EnemyRenderData | null> {
    const config = ENEMY_TYPES[typeId];
    if (!config) return null;

    // Wait for baking if still in progress
    if (this.bakingPromises.has(typeId)) {
      await this.bakingPromises.get(typeId);
    }

    if (!this.instanceManager.hasPool(typeId)) {
      console.warn(`[InstancedRenderer] No pool for ${typeId} — cannot create enemy`);
      return null;
    }

    // Convert geo to local position
    const localPos = this.sync.geoToLocal(lat, lon, height + config.heightOffset);

    // Add to instance pool
    const state = this.instanceManager.addEnemy(id, typeId, localPos, 0);
    if (!state) return null;

    // Add health bar (use cached parsed color)
    let fixedColor = this.healthBarColorCache.get(typeId);
    if (fixedColor === undefined) {
      if (config.healthBarColor) {
        const hex = parseInt(config.healthBarColor.replace('#', ''), 16);
        fixedColor = {
          r: ((hex >> 16) & 0xff) / 255,
          g: ((hex >> 8) & 0xff) / 255,
          b: (hex & 0xff) / 255,
        };
      } else {
        fixedColor = null;
      }
      this.healthBarColorCache.set(typeId, fixedColor);
    }

    this.healthBarManager.add(
      id,
      localPos,
      config.healthBarOffset,
      false, // isBoss
      fixedColor,
      6, // barWidth (matches original Sprite scale)
      1, // barHeight
    );

    if (!this._showHealthBars) {
      this.healthBarManager.hide(id);
    }

    this.instancedEnemies.add(id);

    // Return stub EnemyRenderData
    return {
      id,
      mesh: DUMMY_OBJECT,
      typeConfig: config,
      isDestroyed: false,
      isWalking: true,
      lastHeading: 0,
    };
  }

  remove(id: string): void {
    if (this.instancedEnemies.has(id)) {
      this.instanceManager.removeEnemy(id);
      this.healthBarManager.remove(id);
      this.instancedEnemies.delete(id);
    }
  }

  // =====================================================
  // UPDATE
  // =====================================================

  update(
    id: string,
    lat: number,
    lon: number,
    height: number,
    heading: number,
    healthPercent: number,
    currentSpeed?: number,
    precomputedLocalPos?: Vector3,
  ): void {
    if (!this._showEnemies) return;

    const state = this.instanceManager.getState(id);
    if (!state) return;

    // Use pre-computed local position if available (avoids duplicate geoToLocalSimpleInto)
    let localPos: Vector3;
    if (precomputedLocalPos) {
      localPos = precomputedLocalPos;
    } else {
      const heightOffset = state.config.heightOffset;
      localPos = this.sync.geoToLocalSimpleInto(
        lat, lon, height + heightOffset,
        InstancedEnemyRenderer._tempLocalPos,
      );
    }

    // Update instance position/rotation
    this.instanceManager.updateEnemy(id, localPos, heading, currentSpeed);

    // Update health bar (with debug healthBarOffset if set)
    const barOffset = state.debugHealthBarOffset ?? state.config.healthBarOffset;
    this.healthBarManager.update(
      id,
      localPos,
      barOffset,
      healthPercent,
      6, // barWidth
      1, // barHeight
    );
  }

  // =====================================================
  // ANIMATIONS
  // =====================================================

  startWalkAnimation(id: string): void {
    this.instanceManager.startWalkAnimation(id);
  }

  startRunAnimation(id: string): void {
    this.instanceManager.startRunAnimation(id);
  }

  playIdleAnimation(id: string): void {
    this.instanceManager.playIdleAnimation(id);
  }

  playDeathAnimation(id: string): void {
    this.instanceManager.playDeathAnimation(id);
    this.healthBarManager.hide(id);
  }

  updateAnimations(deltaTime: number, camera: Camera): void {
    // Skip instanced updates if hidden or animations disabled
    if (!this._showEnemies || !this._showAnimations) return;

    // Update instanced animation frames
    this.instanceManager.updateAnimations(deltaTime);

    // Flush batched GPU buffer dirty flags (matrices, tint colors)
    this.instanceManager.flushDirtyFlags();

    // Update health bar billboards (also flushes health bar dirty flags)
    this.healthBarManager.updateBillboard(camera);
  }

  // =====================================================
  // VISUAL EFFECTS
  // =====================================================

  setFreezeVisual(id: string, active: boolean): void {
    this.instanceManager.setFreezeVisual(id, active);
  }

  setPoisonVisual(id: string, active: boolean): void {
    this.instanceManager.setPoisonVisual(id, active);
  }

  // =====================================================
  // QUERIES
  // =====================================================

  get(_id: string): EnemyRenderData | undefined {
    // Instanced enemies have no full render data — return undefined
    return undefined;
  }

  getSpeedMultiplier(id: string): number {
    return this.instanceManager.getSpeedMultiplier(id);
  }

  getHeightOffset(id: string): number {
    const state = this.instanceManager.getState(id);
    return state?.config.heightOffset ?? 0;
  }

  getAllIds(): string[] {
    return this.instanceManager.getAllIds();
  }

  get count(): number {
    return this.instanceManager.count;
  }

  // =====================================================
  // DISPLAY TOGGLES
  // =====================================================

  setHealthBarsVisible(visible: boolean): void {
    this._showHealthBars = visible;
    this.healthBarManager.setVisible(visible);
  }

  get showHealthBars(): boolean {
    return this._showHealthBars;
  }

  setAnimationsEnabled(enabled: boolean): void {
    this._showAnimations = enabled;
  }

  get showAnimations(): boolean {
    return this._showAnimations;
  }

  setEnemiesVisible(visible: boolean): void {
    if (this._showEnemies === visible) return;
    this._showEnemies = visible;
    this.instanceManager.setVisible(visible);
    this.healthBarManager.setVisible(visible && this._showHealthBars);
  }

  get showEnemies(): boolean {
    return this._showEnemies;
  }

  // Legacy display toggles — no-ops for instanced rendering, kept for API compat
  setTexturesEnabled(_enabled: boolean): void { /* no-op */ }
  readonly showTextures = true;
  setSkeletonCloningEnabled(_enabled: boolean): void { /* no-op */ }
  readonly useSkeletonClone = true;
  setAlphaBlendEnabled(_enabled: boolean): void { /* no-op */ }
  readonly showAlphaBlend = true;

  // =====================================================
  // DEBUG OVERRIDES (native instanced support)
  // =====================================================

  /**
   * Apply debug overrides to an enemy instance.
   * Supports scale, heightOffset, healthBarOffset, rotation, animationSpeed.
   * Used by the enemy debugger for live tuning.
   */
  applyDebugOverrides(id: string, overrides: EnemyDebugOverrides): void {
    this.instanceManager.applyDebugOverrides(id, overrides);
  }

  /** No-op kept for API compat — markForClassic is no longer needed */
  markForClassic(_id: string): void { /* no-op */ }

  setAnimationSpeed(id: string, speed: number): void {
    const state = this.instanceManager.getState(id);
    if (!state) return;
    const baseAnimSpeed = state.config.animationSpeed ?? 1.0;
    const speedRatio = speed / state.config.baseSpeed;
    state.animSpeed = baseAnimSpeed * speedRatio;
  }

  setAnimationTimeScale(id: string, timeScale: number): void {
    const state = this.instanceManager.getState(id);
    if (!state) return;
    state.animSpeed = timeScale;
  }

  // =====================================================
  // CLEANUP
  // =====================================================

  clear(): void {
    this.instanceManager.clear();
    this.healthBarManager.clear();
    this.instancedEnemies.clear();
  }

  dispose(): void {
    this.clear();
    this.instanceManager.dispose();
    this.healthBarManager.dispose();
    this.loadedTypes.clear();
  }
}
