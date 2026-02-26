import {
  Scene,
  Object3D,
  Camera,
  Vector3,
} from 'three';
import { CoordinateSync } from '../index';
import { EnemyTypeId, ENEMY_TYPES, EnemyTypeConfig } from '../../../models/enemy-types';
import { AssetManagerService } from '../../../services/asset-manager.service';
import { ThreeEnemyRenderer, EnemyRenderData, EnemyDebugOverrides } from '../three-enemy.renderer';
import { EnemyInstanceManager } from './enemy-instance.manager';
import { HealthBarInstanceManager } from './health-bar-instance.manager';
import { bakeVAT, bakeObjectAnimVAT, bakeStaticVAT } from './vat-baker';

// Dummy Object3D shared across all instanced enemy stubs
const DUMMY_OBJECT = new Object3D();

/**
 * InstancedEnemyRenderer
 *
 * Drop-in replacement for ThreeEnemyRenderer that uses GPU instancing
 * with Vertex Animation Textures (VAT) for massive draw call reduction.
 *
 * Normal enemies → instanced (VAT + InstancedMesh)
 * Boss enemies → fallback to classic ThreeEnemyRenderer
 *
 * Target: ~1000 draw calls → ~14 draw calls for 500 enemies
 */
export class InstancedEnemyRenderer {
  // Instanced rendering
  private readonly instanceManager: EnemyInstanceManager;
  private readonly healthBarManager: HealthBarInstanceManager;

  // Classic renderer for boss enemies
  private readonly classicRenderer: ThreeEnemyRenderer;

  // Track which enemies are instanced vs classic
  private instancedEnemies = new Set<string>();
  private classicEnemies = new Set<string>();

  // IDs that should use classic renderer (debug enemies need live overrides)
  private forceClassicIds = new Set<string>();

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
    this.classicRenderer = new ThreeEnemyRenderer(scene, sync, assetManager);
  }

  // =====================================================
  // PRELOADING
  // =====================================================

  async preloadModel(typeId: EnemyTypeId): Promise<void> {
    const config = ENEMY_TYPES[typeId];
    if (!config) return;

    // Boss → classic renderer only
    if (config.bossName) {
      return this.classicRenderer.preloadModel(typeId);
    }

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
          console.warn(`[InstancedRenderer] Clone failed for ${typeId}, using classic renderer`);
          await this.classicRenderer.preloadModel(typeId as EnemyTypeId);
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
          // VAT bake failed → fall back to classic
          console.warn(`[InstancedRenderer] VAT bake failed for ${typeId}, using classic renderer`);
          await this.classicRenderer.preloadModel(typeId as EnemyTypeId);
          this.loadedTypes.add(typeId);
        }
      } else {
        // Non-animated model → static VAT
        const clone = this.assetManager.cloneModel(config.modelUrl);
        if (!clone) {
          console.warn(`[InstancedRenderer] Clone failed for ${typeId}, using classic renderer`);
          await this.classicRenderer.preloadModel(typeId as EnemyTypeId);
          this.loadedTypes.add(typeId);
          return;
        }

        const vatData = bakeStaticVAT(clone);
        if (vatData) {
          if (config.unlit) vatData.isUnlit = true;
          this.instanceManager.createPool(typeId, vatData, config);
          this.loadedTypes.add(typeId);
        } else {
          console.warn(`[InstancedRenderer] Static VAT failed for ${typeId}, using classic renderer`);
          await this.classicRenderer.preloadModel(typeId as EnemyTypeId);
          this.loadedTypes.add(typeId);
        }
      }
    } catch (err) {
      console.error(`[InstancedRenderer] Failed to bake ${typeId}:`, err);
      // Fallback to classic
      await this.classicRenderer.preloadModel(typeId as EnemyTypeId);
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

    // Boss, debug, or failed bake → classic renderer
    if (config.bossName || this.forceClassicIds.has(id) || !this.instanceManager.hasPool(typeId)) {
      const data = await this.classicRenderer.create(id, typeId, lat, lon, height);
      if (data) this.classicEnemies.add(id);
      return data;
    }

    // Convert geo to local position
    const localPos = this.sync.geoToLocal(lat, lon, height + config.heightOffset);

    // Add to instance pool
    const state = this.instanceManager.addEnemy(id, typeId, localPos, 0);
    if (!state) return null;

    // Add health bar (use cached parsed color)
    const isBoss = false;
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
      isBoss,
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
      mixer: null,
      animations: new Map(),
      currentAction: null,
      healthBar: null,
      healthBarBucket: 100,
      typeConfig: config,
      isDestroyed: false,
      isWalking: true,
      animationVariationTimer: null,
      lastHeading: 0,
      lodStaggerOffset: 0,
    };
  }

  remove(id: string): void {
    if (this.classicEnemies.has(id)) {
      this.classicRenderer.remove(id);
      this.classicEnemies.delete(id);
      return;
    }

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
  ): void {
    if (this.classicEnemies.has(id)) {
      this.classicRenderer.update(id, lat, lon, height, heading, healthPercent, currentSpeed);
      return;
    }

    if (!this._showEnemies) return;

    const state = this.instanceManager.getState(id);
    if (!state) return;

    const heightOffset = state.config.heightOffset;
    const localPos = this.sync.geoToLocalSimpleInto(
      lat, lon, height + heightOffset,
      InstancedEnemyRenderer._tempLocalPos,
    );

    // Update instance position/rotation
    this.instanceManager.updateEnemy(id, localPos, heading, currentSpeed);

    // Update health bar
    this.healthBarManager.update(
      id,
      localPos,
      state.config.healthBarOffset,
      healthPercent,
      6, // barWidth
      1, // barHeight
    );
  }

  // =====================================================
  // ANIMATIONS
  // =====================================================

  startWalkAnimation(id: string): void {
    if (this.classicEnemies.has(id)) {
      this.classicRenderer.startWalkAnimation(id);
      return;
    }
    this.instanceManager.startWalkAnimation(id);
  }

  startRunAnimation(id: string): void {
    if (this.classicEnemies.has(id)) {
      this.classicRenderer.startRunAnimation(id);
      return;
    }
    this.instanceManager.startRunAnimation(id);
  }

  playIdleAnimation(id: string): void {
    if (this.classicEnemies.has(id)) {
      this.classicRenderer.playIdleAnimation(id);
      return;
    }
    this.instanceManager.playIdleAnimation(id);
  }

  playDeathAnimation(id: string): void {
    if (this.classicEnemies.has(id)) {
      this.classicRenderer.playDeathAnimation(id);
      return;
    }
    this.instanceManager.playDeathAnimation(id);
    this.healthBarManager.hide(id);
  }

  updateAnimations(deltaTime: number, camera: Camera): void {
    // Update classic renderer animations (bosses)
    this.classicRenderer.updateAnimations(deltaTime, camera);

    // Skip instanced updates if hidden or animations disabled
    if (!this._showEnemies || !this._showAnimations) return;

    // Update instanced animation frames
    this.instanceManager.updateAnimations(deltaTime);

    // Update health bar billboards
    this.healthBarManager.updateBillboard(camera);
  }

  // =====================================================
  // VISUAL EFFECTS
  // =====================================================

  setFreezeVisual(id: string, active: boolean): void {
    if (this.classicEnemies.has(id)) {
      this.classicRenderer.setFreezeVisual(id, active);
      return;
    }
    this.instanceManager.setFreezeVisual(id, active);
  }

  setPoisonVisual(id: string, active: boolean): void {
    if (this.classicEnemies.has(id)) {
      this.classicRenderer.setPoisonVisual(id, active);
      return;
    }
    this.instanceManager.setPoisonVisual(id, active);
  }

  // =====================================================
  // QUERIES
  // =====================================================

  get(id: string): EnemyRenderData | undefined {
    if (this.classicEnemies.has(id)) {
      return this.classicRenderer.get(id);
    }
    // For instanced enemies, return undefined (no full render data)
    return undefined;
  }

  getSpeedMultiplier(id: string): number {
    if (this.classicEnemies.has(id)) {
      return this.classicRenderer.getSpeedMultiplier(id);
    }
    return this.instanceManager.getSpeedMultiplier(id);
  }

  getAllIds(): string[] {
    return [
      ...this.instanceManager.getAllIds(),
      ...this.classicRenderer.getAllIds(),
    ];
  }

  get count(): number {
    return this.instanceManager.count + this.classicRenderer.count;
  }

  // =====================================================
  // DISPLAY TOGGLES
  // =====================================================

  setHealthBarsVisible(visible: boolean): void {
    this._showHealthBars = visible;
    this.healthBarManager.setVisible(visible);
    this.classicRenderer.setHealthBarsVisible(visible);
  }

  get showHealthBars(): boolean {
    return this._showHealthBars;
  }

  setAnimationsEnabled(enabled: boolean): void {
    this._showAnimations = enabled;
    this.classicRenderer.setAnimationsEnabled(enabled);
  }

  get showAnimations(): boolean {
    return this._showAnimations;
  }

  setEnemiesVisible(visible: boolean): void {
    if (this._showEnemies === visible) return;
    this._showEnemies = visible;
    this.instanceManager.setVisible(visible);
    this.healthBarManager.setVisible(visible && this._showHealthBars);
    this.classicRenderer.setEnemiesVisible(visible);
  }

  get showEnemies(): boolean {
    return this._showEnemies;
  }

  // These toggles are irrelevant for instanced rendering but needed for API compat
  setTexturesEnabled(enabled: boolean): void {
    this.classicRenderer.setTexturesEnabled(enabled);
  }

  get showTextures(): boolean {
    return this.classicRenderer.showTextures;
  }

  setSkeletonCloningEnabled(enabled: boolean): void {
    this.classicRenderer.setSkeletonCloningEnabled(enabled);
  }

  get useSkeletonClone(): boolean {
    return this.classicRenderer.useSkeletonClone;
  }

  setAlphaBlendEnabled(enabled: boolean): void {
    this.classicRenderer.setAlphaBlendEnabled(enabled);
  }

  get showAlphaBlend(): boolean {
    return this.classicRenderer.showAlphaBlend;
  }

  /**
   * Mark an enemy ID to use classic renderer on next create().
   * Used for debug enemies that need live override support.
   */
  markForClassic(id: string): void {
    this.forceClassicIds.add(id);
  }

  // Debug overrides (classic enemies only — use markForClassic() before create())
  applyDebugOverrides(id: string, overrides: EnemyDebugOverrides): void {
    if (this.classicEnemies.has(id)) {
      this.classicRenderer.applyDebugOverrides(id, overrides);
    }
  }

  setAnimationSpeed(id: string, speed: number): void {
    if (this.classicEnemies.has(id)) {
      this.classicRenderer.setAnimationSpeed(id, speed);
    }
  }

  setAnimationTimeScale(id: string, timeScale: number): void {
    if (this.classicEnemies.has(id)) {
      this.classicRenderer.setAnimationTimeScale(id, timeScale);
    }
  }

  // =====================================================
  // CLEANUP
  // =====================================================

  clear(): void {
    this.instanceManager.clear();
    this.healthBarManager.clear();
    this.classicRenderer.clear();
    this.instancedEnemies.clear();
    this.classicEnemies.clear();
  }

  dispose(): void {
    this.clear();
    this.instanceManager.dispose();
    this.healthBarManager.dispose();
    this.classicRenderer.dispose();
    this.loadedTypes.clear();
  }
}
