import {
  Vector3,
  Color,
  Scene,
  Points,
  PointsMaterial,
  ShaderMaterial,
  BufferGeometry,
  BufferAttribute,
  AdditiveBlending,
  NormalBlending,
  Texture,
} from 'three';
import { PARTICLE_LIMITS } from '../../configs/visual-effects.config';
import { generateExplosionAtlas, generateSmokeAtlas } from './sprite-atlas-generator';
import { createParticleShaderMaterials } from './particle-shaders';

// Pool size constants derived from config
const TRAIL_ADDITIVE_POOL_SIZE = PARTICLE_LIMITS.maxTrailParticlesPerPool;
const TRAIL_NORMAL_POOL_SIZE = PARTICLE_LIMITS.maxTrailNormalParticlesPerPool;

/**
 * Particle data for GPU
 */
export interface Particle {
  position: Vector3;
  velocity: Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: Color;
  /**
   * Sprite-sheet frame index for animated particles.
   * -1 = use default circular particle (no atlas), ≥0 = atlas frame.
   * When animated, this is the starting frame; actual frame is computed
   * from life progress during buffer updates.
   */
  frameIndex: number;
  /** Total frames for this particle's animation (0 = not animated) */
  totalFrames: number;
}

/** Identifies one of the three GPU particle pools. */
export type PoolKey = 'trailAdditive' | 'trailNormal' | 'towerFire';

/**
 * ParticlePoolManager - owns the three GPU particle pools and their machinery.
 *
 * Pools:
 * - trailAdditive — fire, tracers, glow (additive blending)
 * - trailNormal   — smoke, dust, blood (normal blending)
 * - towerFire     — dedicated tower inner-fire pool (always additive)
 *
 * Each pool is a fixed-size `Particle[]` rendered through a single `Points`
 * object. Inactive particles are recycled via an O(1) free-list with a
 * round-robin cursor fallback. GPU buffers are uploaded once per frame in
 * {@link updateBuffers}, which skips idle pools entirely.
 *
 * Split out of three-effects.renderer.ts — the renderer keeps `activeEffects`,
 * spawn methods and auras, and delegates all pool mechanics here.
 */
export class ParticlePoolManager {
  private scene: Scene;

  // Trail particle pools (additive for fire/glow, normal for smoke/blood)
  private trailPoolAdditive: Particle[] = [];
  private trailPoolNormal: Particle[] = [];
  private trailParticlesAdditive: Points | null = null;
  private trailParticlesNormal: Points | null = null;
  private trailMaterialAdditive: PointsMaterial | null = null;
  private trailMaterialNormal: PointsMaterial | null = null;

  // Round-robin cursors as fallback for inactive particle search
  private poolCursors = {
    trailAdditive: 0,
    trailNormal: 0,
    towerFire: 0,
  };

  // Free-lists (stacks of free indices) for O(1) inactive particle lookup.
  // Populated during updateBuffers (already O(n) per frame).
  // getInactiveParticle pops from here first, falling back to round-robin cursor.
  private freeIndicesAdditive: number[] = [];
  private freeIndicesNormal: number[] = [];
  private freeIndicesTowerFire: number[] = [];
  // Boolean tracking arrays to avoid duplicate free-list entries
  private inFreeListAdditive!: Uint8Array;
  private inFreeListNormal!: Uint8Array;
  private inFreeListTowerFire!: Uint8Array;

  // Dedicated tower inner fire pool (independent of combat effects)
  private towerFirePool: Particle[] = [];
  private readonly MAX_TOWER_FIRE_PARTICLES = 800;
  private towerFireParticles: Points | null = null;

  // Pool activity tracking — skip idle pools entirely (Tasks 1.3 + 1.4)
  private _prevActiveCountAdditive = 0;
  private _prevActiveCountNormal = 0;
  private _prevActiveCountTowerFire = 0;
  private _poolDirtyAdditive = false;
  private _poolDirtyNormal = false;
  private _poolDirtyTowerFire = false;

  // Cached buffer attribute references (avoid per-frame string lookup)
  private _bufAdditive: { pos: BufferAttribute; size: BufferAttribute; color: BufferAttribute; frame: BufferAttribute } | null = null;
  private _bufNormal: { pos: BufferAttribute; size: BufferAttribute; color: BufferAttribute; frame: BufferAttribute } | null = null;
  private _bufTowerFire: { pos: BufferAttribute; size: BufferAttribute; color: BufferAttribute; frame: BufferAttribute } | null = null;

  // ShaderMaterial alternatives with per-particle size and log depth support
  private trailShaderMaterialAdditive: ShaderMaterial | null = null;
  private trailShaderMaterialNormal: ShaderMaterial | null = null;
  private useShaderMaterial = true; // Default to ShaderMaterial (per-particle sizes, soft edges)

  // Sprite-sheet atlas textures (procedurally generated)
  private explosionAtlas: Texture | null = null;
  private smokeAtlas: Texture | null = null;
  /** Atlas grid dimensions (cols × rows). Both atlases use the same grid. */
  readonly ATLAS_COLS = 4;
  readonly ATLAS_ROWS = 4;

  constructor(scene: Scene) {
    this.scene = scene;

    // PointsMaterial for additive blending (fire, tracers, glow effects)
    // Note: PointsMaterial works correctly with 3D tiles, ShaderMaterial has depth issues
    this.trailMaterialAdditive = new PointsMaterial({
      size: 1.5,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexColors: true,
    });

    // PointsMaterial for normal blending (smoke, opaque particles)
    this.trailMaterialNormal = new PointsMaterial({
      size: 2.0,
      transparent: true,
      opacity: 0.7,
      sizeAttenuation: true,
      depthWrite: false,
      blending: NormalBlending,
      vertexColors: true,
    });

    // Generate procedural sprite-sheet atlases
    this.explosionAtlas = generateExplosionAtlas({ cols: this.ATLAS_COLS, rows: this.ATLAS_ROWS, cellSize: 64 });
    this.smokeAtlas = generateSmokeAtlas({ cols: this.ATLAS_COLS, rows: this.ATLAS_ROWS, cellSize: 64 });

    // ShaderMaterial with logarithmic depth buffer support and per-particle sizes
    // This is required for custom shaders to work with 3D Tiles (which use log depth)
    this.initShaderMaterials();

    this.initParticleSystems();
    this.initTowerFirePool();
  }

  /**
   * Initialize dedicated tower fire particle pool.
   * This pool is independent of combat effects and guaranteed for tower inner fires.
   */
  private initTowerFirePool(): void {
    // Create geometry with position, size, color, frameIndex attributes
    const geometry = new BufferGeometry();
    const positions = new Float32Array(this.MAX_TOWER_FIRE_PARTICLES * 3);
    const sizes = new Float32Array(this.MAX_TOWER_FIRE_PARTICLES);
    const colors = new Float32Array(this.MAX_TOWER_FIRE_PARTICLES * 3);
    const frameIndices = new Float32Array(this.MAX_TOWER_FIRE_PARTICLES).fill(-1); // Default: no atlas

    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('size', new BufferAttribute(sizes, 1));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setAttribute('frameIndex', new BufferAttribute(frameIndices, 1));

    // Use additive shader material for fire glow
    this.towerFireParticles = new Points(geometry, this.trailShaderMaterialAdditive!);
    this.towerFireParticles.frustumCulled = false;
    this.towerFireParticles.renderOrder = 999;
    this.scene.add(this.towerFireParticles);

    // Initialize particle pool
    for (let i = 0; i < this.MAX_TOWER_FIRE_PARTICLES; i++) {
      this.towerFirePool.push({
        position: new Vector3(),
        velocity: new Vector3(),
        life: 0,
        maxLife: 0.6,
        size: 2.0,
        color: new Color(0xff6600),
        frameIndex: -1,
        totalFrames: 0,
      });
    }

    // Initialize free-list with all indices (all particles start inactive)
    this.inFreeListTowerFire = new Uint8Array(this.MAX_TOWER_FIRE_PARTICLES);
    this.freeIndicesTowerFire = [];
    for (let i = this.MAX_TOWER_FIRE_PARTICLES - 1; i >= 0; i--) {
      this.freeIndicesTowerFire.push(i);
      this.inFreeListTowerFire[i] = 1;
    }

    // Cache buffer attribute references
    this._bufTowerFire = {
      pos: geometry.attributes['position'] as BufferAttribute,
      size: geometry.attributes['size'] as BufferAttribute,
      color: geometry.attributes['color'] as BufferAttribute,
      frame: geometry.attributes['frameIndex'] as BufferAttribute,
    };

    console.log('[ParticlePoolManager] Tower fire pool initialized:', this.MAX_TOWER_FIRE_PARTICLES, 'particles');
  }

  /**
   * Initialize particle systems
   */
  private initParticleSystems(): void {
    // Trail particles - ADDITIVE pool (for fire, tracers, glow effects)
    const trailGeometryAdditive = new BufferGeometry();
    const trailPositionsAdditive = new Float32Array(TRAIL_ADDITIVE_POOL_SIZE * 3);
    const trailSizesAdditive = new Float32Array(TRAIL_ADDITIVE_POOL_SIZE);
    const trailColorsAdditive = new Float32Array(TRAIL_ADDITIVE_POOL_SIZE * 3);
    const trailFrameIndicesAdditive = new Float32Array(TRAIL_ADDITIVE_POOL_SIZE).fill(-1);

    trailGeometryAdditive.setAttribute('position', new BufferAttribute(trailPositionsAdditive, 3));
    trailGeometryAdditive.setAttribute('size', new BufferAttribute(trailSizesAdditive, 1));
    trailGeometryAdditive.setAttribute('color', new BufferAttribute(trailColorsAdditive, 3));
    trailGeometryAdditive.setAttribute('frameIndex', new BufferAttribute(trailFrameIndicesAdditive, 1));

    // Use ShaderMaterial by default for per-particle sizes and soft edges
    const additiveMaterial = this.useShaderMaterial
      ? this.trailShaderMaterialAdditive!
      : this.trailMaterialAdditive!;
    this.trailParticlesAdditive = new Points(trailGeometryAdditive, additiveMaterial);
    this.trailParticlesAdditive.frustumCulled = false;
    this.trailParticlesAdditive.renderOrder = 999; // Render after 3D tiles
    this.scene.add(this.trailParticlesAdditive);

    // Initialize additive trail pool
    for (let i = 0; i < TRAIL_ADDITIVE_POOL_SIZE; i++) {
      this.trailPoolAdditive.push({
        position: new Vector3(),
        velocity: new Vector3(),
        life: 0,
        maxLife: 0.5,
        size: 1.5,
        color: new Color(0xff8800),
        frameIndex: -1,
        totalFrames: 0,
      });
    }

    // Initialize additive free-list with all indices (all start inactive)
    this.inFreeListAdditive = new Uint8Array(TRAIL_ADDITIVE_POOL_SIZE);
    this.freeIndicesAdditive = [];
    for (let i = TRAIL_ADDITIVE_POOL_SIZE - 1; i >= 0; i--) {
      this.freeIndicesAdditive.push(i);
      this.inFreeListAdditive[i] = 1;
    }

    // Trail particles - NORMAL pool (for smoke, dust, blood effects)
    const trailGeometryNormal = new BufferGeometry();
    const trailPositionsNormal = new Float32Array(TRAIL_NORMAL_POOL_SIZE * 3);
    const trailSizesNormal = new Float32Array(TRAIL_NORMAL_POOL_SIZE);
    const trailColorsNormal = new Float32Array(TRAIL_NORMAL_POOL_SIZE * 3);
    const trailFrameIndicesNormal = new Float32Array(TRAIL_NORMAL_POOL_SIZE).fill(-1);

    trailGeometryNormal.setAttribute('position', new BufferAttribute(trailPositionsNormal, 3));
    trailGeometryNormal.setAttribute('size', new BufferAttribute(trailSizesNormal, 1));
    trailGeometryNormal.setAttribute('color', new BufferAttribute(trailColorsNormal, 3));
    trailGeometryNormal.setAttribute('frameIndex', new BufferAttribute(trailFrameIndicesNormal, 1));

    // Use ShaderMaterial by default for per-particle sizes and soft edges
    const normalMaterial = this.useShaderMaterial
      ? this.trailShaderMaterialNormal!
      : this.trailMaterialNormal!;
    this.trailParticlesNormal = new Points(trailGeometryNormal, normalMaterial);
    this.trailParticlesNormal.frustumCulled = false;
    this.trailParticlesNormal.renderOrder = 999; // Render after 3D tiles
    this.scene.add(this.trailParticlesNormal);

    // Initialize normal trail pool
    for (let i = 0; i < TRAIL_NORMAL_POOL_SIZE; i++) {
      this.trailPoolNormal.push({
        position: new Vector3(),
        velocity: new Vector3(),
        life: 0,
        maxLife: 0.5,
        size: 1.5,
        color: new Color(0x888888),
        frameIndex: -1,
        totalFrames: 0,
      });
    }

    // Initialize normal free-list with all indices (all start inactive)
    this.inFreeListNormal = new Uint8Array(TRAIL_NORMAL_POOL_SIZE);
    this.freeIndicesNormal = [];
    for (let i = TRAIL_NORMAL_POOL_SIZE - 1; i >= 0; i--) {
      this.freeIndicesNormal.push(i);
      this.inFreeListNormal[i] = 1;
    }

    // Cache buffer attribute references (avoid per-frame string lookup)
    this._bufAdditive = {
      pos: trailGeometryAdditive.attributes['position'] as BufferAttribute,
      size: trailGeometryAdditive.attributes['size'] as BufferAttribute,
      color: trailGeometryAdditive.attributes['color'] as BufferAttribute,
      frame: trailGeometryAdditive.attributes['frameIndex'] as BufferAttribute,
    };
    this._bufNormal = {
      pos: trailGeometryNormal.attributes['position'] as BufferAttribute,
      size: trailGeometryNormal.attributes['size'] as BufferAttribute,
      color: trailGeometryNormal.attributes['color'] as BufferAttribute,
      frame: trailGeometryNormal.attributes['frameIndex'] as BufferAttribute,
    };
  }

  /**
   * Initialize the trail-particle ShaderMaterials.
   *
   * The GLSL + material construction lives in particle-shaders.ts; those
   * materials need the log-depth shader chunks to render correctly over
   * 3D Tiles (see that file for the rationale).
   */
  private initShaderMaterials(): void {
    const materials = createParticleShaderMaterials(
      this.explosionAtlas,
      this.smokeAtlas,
      this.ATLAS_COLS,
      this.ATLAS_ROWS,
    );
    this.trailShaderMaterialAdditive = materials.additive;
    this.trailShaderMaterialNormal = materials.normal;

    console.log('[ParticlePoolManager] ShaderMaterials with sprite-sheet atlas + log depth initialized');
  }

  /**
   * Toggle between PointsMaterial and ShaderMaterial for trail particles.
   * Use this to test shader-based particles with per-particle sizes.
   *
   * Note: the tower fire pool always uses the additive ShaderMaterial and is
   * never toggled — only the two trail pools switch.
   *
   * @param useShader - true to use ShaderMaterial, false for PointsMaterial
   */
  setUseShaderMaterial(useShader: boolean): void {
    if (this.useShaderMaterial === useShader) return;

    this.useShaderMaterial = useShader;

    // Note: Don't dispose materials here — both shader and non-shader materials
    // are persistent (created once at init, reused on toggle). Only the assignment changes.
    // Disposal happens in dispose() which cleans up all materials.
    if (this.trailParticlesAdditive) {
      this.trailParticlesAdditive.material = useShader
        ? this.trailShaderMaterialAdditive!
        : this.trailMaterialAdditive!;
    }

    if (this.trailParticlesNormal) {
      this.trailParticlesNormal.material = useShader
        ? this.trailShaderMaterialNormal!
        : this.trailMaterialNormal!;
    }

    console.log(`[ParticlePoolManager] Switched to ${useShader ? 'ShaderMaterial' : 'PointsMaterial'}`);
  }

  /**
   * Check if ShaderMaterial is currently active
   */
  isUsingShaderMaterial(): boolean {
    return this.useShaderMaterial;
  }

  /**
   * Get a pool array for direct iteration (e.g. per-frame particle updates).
   */
  getPool(pool: PoolKey): Particle[] {
    switch (pool) {
      case 'trailAdditive': return this.trailPoolAdditive;
      case 'trailNormal': return this.trailPoolNormal;
      case 'towerFire': return this.towerFirePool;
    }
  }

  /**
   * Whether a pool currently has work to do — i.e. it has active particles
   * or new spawns were registered this frame. Idle pools can be skipped.
   */
  isPoolActive(pool: PoolKey): boolean {
    switch (pool) {
      case 'trailAdditive': return this._prevActiveCountAdditive > 0 || this._poolDirtyAdditive;
      case 'trailNormal': return this._prevActiveCountNormal > 0 || this._poolDirtyNormal;
      case 'towerFire': return this._prevActiveCountTowerFire > 0 || this._poolDirtyTowerFire;
    }
  }

  /**
   * Get an inactive particle from a pool using O(1) free-list lookup.
   * Pops from the free-list stack first. Falls back to round-robin cursor
   * if the free-list is empty (e.g. after bulk respawns that bypass the list).
   */
  getInactiveParticle(pool: PoolKey): Particle | null {
    const poolArr = this.getPool(pool);
    const freeList = this.getFreeList(pool);
    const inFreeList = this.getInFreeList(pool);

    // O(1) path: pop from free-list stack
    while (freeList.length > 0) {
      const idx = freeList.pop()!;
      inFreeList[idx] = 0;
      if (poolArr[idx].life <= 0) {
        // Reset sprite-sheet fields so reused particles default to circular
        poolArr[idx].frameIndex = -1;
        poolArr[idx].totalFrames = 0;
        this.markPoolDirty(pool);
        return poolArr[idx];
      }
      // Particle was reactivated externally (e.g. fire respawn) — skip it
    }

    // Fallback: round-robin cursor scan (handles edge cases)
    const len = poolArr.length;
    const startIdx = this.poolCursors[pool];
    for (let i = 0; i < len; i++) {
      const idx = (startIdx + i) % len;
      if (poolArr[idx].life <= 0) {
        this.poolCursors[pool] = (idx + 1) % len;
        poolArr[idx].frameIndex = -1;
        poolArr[idx].totalFrames = 0;
        this.markPoolDirty(pool);
        return poolArr[idx];
      }
    }
    return null;
  }

  /** Mark a pool dirty so its buffers are uploaded next frame. */
  markPoolDirty(pool: PoolKey): void {
    switch (pool) {
      case 'trailAdditive': this._poolDirtyAdditive = true; break;
      case 'trailNormal': this._poolDirtyNormal = true; break;
      case 'towerFire': this._poolDirtyTowerFire = true; break;
    }
  }

  /** Map pool key to corresponding free-list array */
  getFreeList(pool: PoolKey): number[] {
    switch (pool) {
      case 'trailAdditive': return this.freeIndicesAdditive;
      case 'trailNormal': return this.freeIndicesNormal;
      case 'towerFire': return this.freeIndicesTowerFire;
    }
  }

  /** Map pool key to corresponding inFreeList tracking array */
  getInFreeList(pool: PoolKey): Uint8Array {
    switch (pool) {
      case 'trailAdditive': return this.inFreeListAdditive;
      case 'trailNormal': return this.inFreeListNormal;
      case 'towerFire': return this.inFreeListTowerFire;
    }
  }

  /** Push a dead particle's index back onto the free-list (if not already there) */
  returnToFreeList(idx: number, pool: PoolKey): void {
    const inFreeList = this.getInFreeList(pool);
    if (!inFreeList[idx]) {
      inFreeList[idx] = 1;
      this.getFreeList(pool).push(idx);
    }
  }

  /**
   * Update particle position buffers.
   * Skips idle pools entirely (no iteration, no GPU upload).
   * Uses cached buffer attribute refs to avoid per-frame string lookups.
   */
  updateBuffers(): void {
    // ADDITIVE pool — skip when idle (prevActive=0 AND no new spawns)
    if (this._bufAdditive && (this._prevActiveCountAdditive > 0 || this._poolDirtyAdditive)) {
      const { pos: positions, size: sizes, color: colors, frame: frameIndices } = this._bufAdditive;
      const posArray = positions.array as Float32Array;
      const sizeArray = sizes.array as Float32Array;
      const colorArray = colors.array as Float32Array;
      const frameArray = frameIndices.array as Float32Array;

      let activeCount = 0;
      for (let i = 0; i < this.trailPoolAdditive.length; i++) {
        const p = this.trailPoolAdditive[i];
        if (p.life > 0) {
          const idx3 = activeCount * 3;
          posArray[idx3] = p.position.x;
          posArray[idx3 + 1] = p.position.y;
          posArray[idx3 + 2] = p.position.z;
          sizeArray[activeCount] = p.size * p.life;
          colorArray[idx3] = p.color.r;
          colorArray[idx3 + 1] = p.color.g;
          colorArray[idx3 + 2] = p.color.b;
          if (p.totalFrames > 0) {
            const progress = 1.0 - p.life;
            frameArray[activeCount] = Math.min(
              Math.floor(progress * p.totalFrames),
              p.totalFrames - 1
            );
          } else {
            frameArray[activeCount] = -1;
          }
          activeCount++;
        } else {
          this.returnToFreeList(i, 'trailAdditive');
        }
      }

      // Only upload to GPU if there are active particles or count just changed to 0
      if (activeCount > 0 || this._prevActiveCountAdditive > 0) {
        positions.needsUpdate = true;
        sizes.needsUpdate = true;
        colors.needsUpdate = true;
        frameIndices.needsUpdate = true;
      }
      this.trailParticlesAdditive!.geometry.setDrawRange(0, activeCount);
      this._prevActiveCountAdditive = activeCount;
      this._poolDirtyAdditive = false;
    }

    // NORMAL pool — skip when idle
    if (this._bufNormal && (this._prevActiveCountNormal > 0 || this._poolDirtyNormal)) {
      const { pos: positions, size: sizes, color: colors, frame: frameIndices } = this._bufNormal;
      const posArray = positions.array as Float32Array;
      const sizeArray = sizes.array as Float32Array;
      const colorArray = colors.array as Float32Array;
      const frameArray = frameIndices.array as Float32Array;

      let activeCount = 0;
      for (let i = 0; i < this.trailPoolNormal.length; i++) {
        const p = this.trailPoolNormal[i];
        if (p.life > 0) {
          const idx3 = activeCount * 3;
          posArray[idx3] = p.position.x;
          posArray[idx3 + 1] = p.position.y;
          posArray[idx3 + 2] = p.position.z;
          sizeArray[activeCount] = p.size * p.life;
          colorArray[idx3] = p.color.r;
          colorArray[idx3 + 1] = p.color.g;
          colorArray[idx3 + 2] = p.color.b;
          if (p.totalFrames > 0) {
            const progress = 1.0 - p.life;
            frameArray[activeCount] = Math.min(
              Math.floor(progress * p.totalFrames),
              p.totalFrames - 1
            );
          } else {
            frameArray[activeCount] = -1;
          }
          activeCount++;
        } else {
          this.returnToFreeList(i, 'trailNormal');
        }
      }

      if (activeCount > 0 || this._prevActiveCountNormal > 0) {
        positions.needsUpdate = true;
        sizes.needsUpdate = true;
        colors.needsUpdate = true;
        frameIndices.needsUpdate = true;
      }
      this.trailParticlesNormal!.geometry.setDrawRange(0, activeCount);
      this._prevActiveCountNormal = activeCount;
      this._poolDirtyNormal = false;
    }

    // TOWER FIRE pool — skip when idle
    if (this._bufTowerFire && (this._prevActiveCountTowerFire > 0 || this._poolDirtyTowerFire)) {
      const { pos: positions, size: sizes, color: colors, frame: frameIndices } = this._bufTowerFire;
      const posArray = positions.array as Float32Array;
      const sizeArray = sizes.array as Float32Array;
      const colorArray = colors.array as Float32Array;
      const frameArray = frameIndices.array as Float32Array;

      let activeCount = 0;
      for (let i = 0; i < this.towerFirePool.length; i++) {
        const p = this.towerFirePool[i];
        if (p.life > 0) {
          const idx3 = activeCount * 3;
          posArray[idx3] = p.position.x;
          posArray[idx3 + 1] = p.position.y;
          posArray[idx3 + 2] = p.position.z;
          sizeArray[activeCount] = p.size * p.life;
          colorArray[idx3] = p.color.r;
          colorArray[idx3 + 1] = p.color.g;
          colorArray[idx3 + 2] = p.color.b;
          frameArray[activeCount] = -1;
          activeCount++;
        } else {
          this.returnToFreeList(i, 'towerFire');
        }
      }

      if (activeCount > 0 || this._prevActiveCountTowerFire > 0) {
        positions.needsUpdate = true;
        sizes.needsUpdate = true;
        colors.needsUpdate = true;
        frameIndices.needsUpdate = true;
      }
      this.towerFireParticles!.geometry.setDrawRange(0, activeCount);
      this._prevActiveCountTowerFire = activeCount;
      this._poolDirtyTowerFire = false;
    }
  }

  /**
   * Reset all pools — kills all particles, rebuilds free-lists and cursors.
   * (Pool part of ThreeEffectsRenderer.clear().)
   */
  reset(): void {
    // Reset all particles
    for (const p of this.trailPoolAdditive) {
      p.life = 0;
    }
    for (const p of this.trailPoolNormal) {
      p.life = 0;
    }
    for (const p of this.towerFirePool) {
      p.life = 0;
    }
    this.poolCursors = { trailAdditive: 0, trailNormal: 0, towerFire: 0 };

    // Rebuild free-lists (all particles are now inactive)
    this.freeIndicesAdditive = [];
    this.inFreeListAdditive.fill(1);
    for (let i = this.trailPoolAdditive.length - 1; i >= 0; i--) {
      this.freeIndicesAdditive.push(i);
    }
    this.freeIndicesNormal = [];
    this.inFreeListNormal.fill(1);
    for (let i = this.trailPoolNormal.length - 1; i >= 0; i--) {
      this.freeIndicesNormal.push(i);
    }
    this.freeIndicesTowerFire = [];
    this.inFreeListTowerFire.fill(1);
    for (let i = this.towerFirePool.length - 1; i >= 0; i--) {
      this.freeIndicesTowerFire.push(i);
    }
  }

  /**
   * Dispose pool resources — removes the Points objects from the scene and
   * disposes geometries, materials and atlas textures.
   * (Pool part of ThreeEffectsRenderer.dispose().)
   */
  dispose(): void {
    if (this.trailParticlesAdditive) {
      this.scene.remove(this.trailParticlesAdditive);
      this.trailParticlesAdditive.geometry.dispose();
    }
    if (this.trailParticlesNormal) {
      this.scene.remove(this.trailParticlesNormal);
      this.trailParticlesNormal.geometry.dispose();
    }
    if (this.towerFireParticles) {
      this.scene.remove(this.towerFireParticles);
      this.towerFireParticles.geometry.dispose();
    }

    this.trailMaterialAdditive?.dispose();
    this.trailMaterialNormal?.dispose();
    this.trailShaderMaterialAdditive?.dispose();
    this.trailShaderMaterialNormal?.dispose();

    // Dispose sprite-sheet atlas textures
    this.explosionAtlas?.dispose();
    this.smokeAtlas?.dispose();
  }
}
