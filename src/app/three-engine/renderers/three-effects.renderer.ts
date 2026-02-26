import {
  Vector2,
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
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  PlaneGeometry,
  Texture,
  Material,
  Uniform,
} from 'three';
import { CoordinateSync } from './index';
import { TrailParticleConfig } from '../../configs/projectile-types.config';
import {
  PARTICLE_LIMITS,
  BLOOD_DECAL_CONFIG,
  ICE_DECAL_CONFIG,
} from '../../configs/visual-effects.config';
import { generateExplosionAtlas, generateSmokeAtlas } from './sprite-atlas-generator';

// Pool size constants derived from config
const TRAIL_ADDITIVE_POOL_SIZE = PARTICLE_LIMITS.maxTrailParticlesPerPool;
const TRAIL_NORMAL_POOL_SIZE = PARTICLE_LIMITS.maxTrailNormalParticlesPerPool;
import { DecalInstanceManager } from './decal-instance.manager';
import { createBloodDecalShader, createIceDecalShader } from './decal-shaders';
import { FloatingTextInstanceManager } from './floating-text/floating-text-instance.manager';
import type { Camera } from 'three';

/**
 * Particle data for GPU
 */
interface Particle {
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

/**
 * Active effect instance
 */
interface EffectInstance {
  id: string;
  type: 'blood' | 'fire' | 'explosion' | 'smoke';
  particles: Particle[];
  startTime: number;
  duration: number;
  localPosition: Vector3;
}

// Note: Blood and Ice decal instances are now managed by DecalInstanceManager
// See decal-instance.manager.ts for DecalInstance interface

/**
 * Floating text configuration
 */
export interface FloatingTextConfig {
  /** Text color (CSS format, default: '#FFD700' gold) */
  color?: string;
  /** Font size in pixels (default: 48) */
  fontSize?: number;
  /** Duration in ms (default: 1000) */
  duration?: number;
  /** Float speed - how fast it rises (default: 2) */
  floatSpeed?: number;
  /** Initial scale (default: 1) */
  scale?: number;
  /** Outline color (default: '#000000') */
  outlineColor?: string;
  /** Outline width (default: 3) */
  outlineWidth?: number;
}

/**
 * ThreeEffectsRenderer - Renders particle effects using Three.js
 *
 * Effects:
 * - Blood splatter (on enemy hit)
 * - Fire/smoke (on base damage)
 * - Explosions (on projectile impact)
 *
 * Uses Points with custom shader for GPU-accelerated particles.
 */
export class ThreeEffectsRenderer {
  private scene: Scene;
  private sync: CoordinateSync;

  // Active effects
  private activeEffects = new Map<string, EffectInstance>();
  private effectIdCounter = 0;

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
  // Populated during updateParticleBuffers (already O(n) per frame).
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
  private activeTowerFires = new Map<string, { particles: Particle[]; localPosition: Vector3 }>();

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
  private readonly ATLAS_COLS = 4;
  private readonly ATLAS_ROWS = 4;

  // Instanced decal managers (GPU instancing for performance)
  private bloodDecalManager: DecalInstanceManager | null = null;
  private iceDecalManager: DecalInstanceManager | null = null;
  private readonly MAX_BLOOD_DECALS = BLOOD_DECAL_CONFIG.maxDecals;
  private readonly DECAL_FADE_DELAY = BLOOD_DECAL_CONFIG.fadeDelay;
  private readonly DECAL_FADE_DURATION = BLOOD_DECAL_CONFIG.fadeDuration;
  private readonly MAX_ICE_DECALS = ICE_DECAL_CONFIG.maxDecals;
  private readonly ICE_DECAL_FADE_DELAY = ICE_DECAL_CONFIG.fadeDelay;
  private readonly ICE_DECAL_FADE_DURATION = ICE_DECAL_CONFIG.fadeDuration;
  private decalIdCounter = 0;

  // GPU-instanced floating text system (1 draw call for all texts)
  private floatingTextManager!: FloatingTextInstanceManager;

  // Frost aura tracking (orbiting ice particles per enemy)
  private activeFrostAuras = new Map<string, { particles: Particle[]; localPosition: Vector3; orbitAngle: number }>();

  // Poison aura tracking (orbiting green particles per enemy)
  private activePoisonAuras = new Map<string, { particles: Particle[]; localPosition: Vector3; orbitAngle: number }>();

  // Reusable temp vector for particle updates (avoids GC pressure)
  private readonly tempVelocity = new Vector3();

  constructor(scene: Scene, sync: CoordinateSync) {
    this.scene = scene;
    this.sync = sync;

    // GPU-instanced floating text system
    this.floatingTextManager = new FloatingTextInstanceManager(scene, sync);

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

    // Initialize instanced decal managers with custom shaders
    this.initDecalManagers();

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

    console.log('[ThreeEffectsRenderer] Tower fire pool initialized:', this.MAX_TOWER_FIRE_PARTICLES, 'particles');
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
   * Initialize ShaderMaterials with logarithmic depth buffer support.
   * These work correctly with 3D Tiles and support per-particle sizes.
   *
   * The key insight: When `logarithmicDepthBuffer: true` is set on the WebGLRenderer,
   * custom ShaderMaterials must include the log depth shader chunks to write correct
   * depth values. Built-in materials (PointsMaterial, etc.) get this automatically.
   */
  private initShaderMaterials(): void {
    // Vertex shader with per-particle size, sprite-sheet frame, and log depth support.
    // The `frameIndex` attribute controls sprite-sheet animation:
    //   frameIndex < 0  → default circular particle (no atlas)
    //   frameIndex >= 0 → index into NxN atlas grid
    const vertexShader = /* glsl */ `
      attribute float size;
      attribute float frameIndex;
      varying vec3 vColor;
      varying float vFrameIndex;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vColor = color;
        vFrameIndex = frameIndex;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

        // Size attenuation: larger particles when closer
        gl_PointSize = size * (3000.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `;

    // Fragment shader for additive blending with sprite-sheet support
    const fragmentShaderAdditive = /* glsl */ `
      precision highp float;
      varying vec3 vColor;
      varying float vFrameIndex;
      uniform sampler2D uAtlas;
      uniform vec2 uAtlasGrid; // (cols, rows)

      #include <logdepthbuf_pars_fragment>

      void main() {
        if (vFrameIndex < 0.0) {
          // === Classic circular particle (no atlas) ===
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          if (dist > 0.5) discard;
          float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
          gl_FragColor = vec4(vColor * alpha, alpha);
        } else {
          // === Sprite-sheet atlas lookup ===
          float frame = floor(vFrameIndex + 0.5); // round to nearest int
          float col = mod(frame, uAtlasGrid.x);
          float row = floor(frame / uAtlasGrid.x);
          // UV within this cell: gl_PointCoord is [0,1] across the point
          vec2 cellUV = gl_PointCoord;
          // Map to atlas coordinates (row 0 = top of texture)
          vec2 uv = vec2(
            (col + cellUV.x) / uAtlasGrid.x,
            (row + cellUV.y) / uAtlasGrid.y
          );
          vec4 texel = texture2D(uAtlas, uv);
          if (texel.a < 0.01) discard;
          // Tint with particle color (allows color variation)
          gl_FragColor = vec4(texel.rgb * vColor, texel.a);
        }

        #include <logdepthbuf_fragment>
      }
    `;

    // Fragment shader for normal blending with sprite-sheet support
    const fragmentShaderNormal = /* glsl */ `
      precision highp float;
      varying vec3 vColor;
      varying float vFrameIndex;
      uniform sampler2D uAtlas;
      uniform vec2 uAtlasGrid; // (cols, rows)

      #include <logdepthbuf_pars_fragment>

      void main() {
        if (vFrameIndex < 0.0) {
          // === Classic circular particle (no atlas) ===
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          if (dist > 0.5) discard;
          float alpha = 0.7 * (1.0 - smoothstep(0.3, 0.5, dist));
          gl_FragColor = vec4(vColor, alpha);
        } else {
          // === Sprite-sheet atlas lookup ===
          float frame = floor(vFrameIndex + 0.5);
          float col = mod(frame, uAtlasGrid.x);
          float row = floor(frame / uAtlasGrid.x);
          vec2 cellUV = gl_PointCoord;
          vec2 uv = vec2(
            (col + cellUV.x) / uAtlasGrid.x,
            (row + cellUV.y) / uAtlasGrid.y
          );
          vec4 texel = texture2D(uAtlas, uv);
          if (texel.a < 0.01) discard;
          gl_FragColor = vec4(texel.rgb * vColor, texel.a * 0.85);
        }

        #include <logdepthbuf_fragment>
      }
    `;

    // Create additive ShaderMaterial (with explosion atlas)
    this.trailShaderMaterialAdditive = new ShaderMaterial({
      vertexShader,
      fragmentShader: fragmentShaderAdditive,
      uniforms: {
        uAtlas: new Uniform(this.explosionAtlas),
        uAtlasGrid: new Uniform(new Vector2(this.ATLAS_COLS, this.ATLAS_ROWS)),
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexColors: true,
    });

    // Create normal ShaderMaterial (with smoke atlas)
    this.trailShaderMaterialNormal = new ShaderMaterial({
      vertexShader,
      fragmentShader: fragmentShaderNormal,
      uniforms: {
        uAtlas: new Uniform(this.smokeAtlas),
        uAtlasGrid: new Uniform(new Vector2(this.ATLAS_COLS, this.ATLAS_ROWS)),
      },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      vertexColors: true,
    });

    console.log('[ThreeEffectsRenderer] ShaderMaterials with sprite-sheet atlas + log depth initialized');
  }

  /**
   * Toggle between PointsMaterial and ShaderMaterial for trail particles.
   * Use this to test shader-based particles with per-particle sizes.
   *
   * @param useShader - true to use ShaderMaterial, false for PointsMaterial
   */
  setUseShaderMaterial(useShader: boolean): void {
    if (this.useShaderMaterial === useShader) return;

    this.useShaderMaterial = useShader;

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

    console.log(`[ThreeEffectsRenderer] Switched to ${useShader ? 'ShaderMaterial' : 'PointsMaterial'}`);
  }

  /**
   * Check if ShaderMaterial is currently active
   */
  isUsingShaderMaterial(): boolean {
    return this.useShaderMaterial;
  }

  /**
   * Initialize instanced decal managers with custom shaders
   * Replaces old per-decal mesh system with GPU instancing (2 draw calls instead of 250!)
   */
  private initDecalManagers(): void {
    // Create shared plane geometry for all decals (rotated to lay flat)
    const decalGeometry = new PlaneGeometry(2, 2);
    decalGeometry.rotateX(-Math.PI / 2); // Rotate to lie flat on ground (XZ plane)

    // Create blood decal manager with custom shader
    const bloodShader = createBloodDecalShader();
    this.bloodDecalManager = new DecalInstanceManager(
      decalGeometry.clone(),
      bloodShader,
      this.MAX_BLOOD_DECALS
    );
    this.scene.add(this.bloodDecalManager.instancedMesh);

    // Create ice decal manager with custom shader
    const iceShader = createIceDecalShader();
    this.iceDecalManager = new DecalInstanceManager(
      decalGeometry.clone(),
      iceShader,
      this.MAX_ICE_DECALS
    );
    this.scene.add(this.iceDecalManager.instancedMesh);

    console.log('[ThreeEffectsRenderer] Instanced decal managers initialized');
    console.log(`  Blood decals: max ${this.MAX_BLOOD_DECALS} instances (1 draw call)`);
    console.log(`  Ice decals: max ${this.MAX_ICE_DECALS} instances (1 draw call)`);
  }

  /**
   * Spawn blood splatter effect at a position
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param count - Number of particles (default 20)
   */
  spawnBloodSplatter(lat: number, lon: number, height: number, count = 20): string {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    const id = `blood_${this.effectIdCounter++}`;

    const effect: EffectInstance = {
      id,
      type: 'blood',
      particles: [],
      startTime: performance.now(),
      duration: 1500, // 1.5 seconds
      localPosition: localPos.clone(),
    };

    // Spawn particles
    const maxBloodParticles = 100;
    for (let i = 0; i < count && effect.particles.length < maxBloodParticles; i++) {
      const particle = this.getInactiveParticle(this.trailPoolNormal, 'trailNormal');
      if (!particle) break;

      particle.position.copy(localPos);
      particle.velocity.set(
        (Math.random() - 0.5) * 5,
        Math.random() * 5,
        (Math.random() - 0.5) * 5
      );
      particle.life = 1.0;
      particle.maxLife = 1.0 + Math.random() * 0.5;
      particle.size = 0.2 + Math.random() * 0.3;

      // Vary blood color slightly
      const r = 0.7 + Math.random() * 0.3;
      particle.color.setRGB(r, 0, 0);

      effect.particles.push(particle);
    }

    this.activeEffects.set(id, effect);
    return id;
  }

  /**
   * Spawn a persistent blood decal on the ground
   * NOW USES GPU INSTANCING - much better performance!
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height (terrain height)
   * @param size - Size of the decal (0.5-3.0 meters, default 1.0)
   * @returns Decal ID
   */
  spawnBloodDecal(lat: number, lon: number, height: number, size = 1.0): string {
    if (!this.bloodDecalManager) {
      console.warn('[ThreeEffectsRenderer] Blood decal manager not initialized');
      return '';
    }

    const localPos = this.sync.geoToLocal(lat, lon, height);
    localPos.y += BLOOD_DECAL_CONFIG.heightOffset;

    const id = `blood_decal_${this.decalIdCounter++}`;
    const now = performance.now();

    // Random rotation for variety
    const rotation = Math.random() * Math.PI * 2;

    // Apply size with randomness - ellipse shape for puddle effect
    const baseSize = size * (0.8 + Math.random() * 0.4);

    // Randomize color slightly (dark red variations) - from config
    const colorVariation = Math.random() * BLOOD_DECAL_CONFIG.colorVariation;
    const color = new Color(
      BLOOD_DECAL_CONFIG.baseColor.r + colorVariation,
      BLOOD_DECAL_CONFIG.baseColor.g,
      BLOOD_DECAL_CONFIG.baseColor.b
    );

    // If pool is full, remove oldest decal
    if (this.bloodDecalManager.count >= this.MAX_BLOOD_DECALS) {
      const instances = this.bloodDecalManager.getAllInstances();
      if (instances.length > 0) {
        let oldest = instances[0];
        for (const inst of instances) {
          if (inst.spawnTime < oldest.spawnTime) {
            oldest = inst;
          }
        }
        this.bloodDecalManager.remove(oldest.id);
      }
    }

    // Add new decal instance
    this.bloodDecalManager.add(
      id,
      localPos,
      baseSize,
      rotation,
      color,
      BLOOD_DECAL_CONFIG.baseOpacity,
      now,
      this.DECAL_FADE_DELAY,
      this.DECAL_FADE_DURATION
    );

    return id;
  }

  /**
   * Spawn fire effect at a position
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param intensity - Fire intensity ('tiny' | 'small' | 'medium' | 'large' | 'inferno')
   */
  spawnFire(
    lat: number,
    lon: number,
    height: number,
    intensity: 'tiny' | 'small' | 'medium' | 'large' | 'inferno' = 'medium'
  ): string {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    const id = `fire_${this.effectIdCounter++}`;

    // Fire intensity config - all use duration: -1 for persistent fire
    const intensityConfig = {
      tiny: { count: 15, radius: 1.5 },
      small: { count: 40, radius: 2.5 },
      medium: { count: 80, radius: 4 },
      large: { count: 120, radius: 6 },
      inferno: { count: 200, radius: 10 },
    };

    const config = intensityConfig[intensity];

    const effect: EffectInstance = {
      id,
      type: 'fire',
      particles: [],
      startTime: performance.now(),
      duration: -1, // All fires are now persistent until stopped
      localPosition: localPos.clone(),
    };

    // Store radius in effect for respawning
    (effect as EffectInstance & { radius: number }).radius = config.radius;

    // Use trailPoolAdditive for better visuals (per-particle colors, shader support)
    for (let i = 0; i < config.count; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) break;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * config.radius;

      particle.position.copy(localPos);
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;

      particle.velocity.set(
        (Math.random() - 0.5) * 2,
        3 + Math.random() * 5, // Upward
        (Math.random() - 0.5) * 2
      );
      particle.life = 1.0;
      particle.maxLife = 0.4 + Math.random() * 0.8;
      particle.size = 1.5 + Math.random() * 2.5; // Bigger particles

      // Fire colors - yellow core, orange mid, red edges
      const t = Math.random();
      if (t < 0.3) {
        particle.color.setRGB(1, 0.9, 0.3); // Yellow core
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.5, 0.1); // Orange
      } else {
        particle.color.setRGB(1, 0.2, 0.05); // Red edges
      }

      effect.particles.push(particle);
    }

    this.activeEffects.set(id, effect);
    return id;
  }

  /**
   * Spawn fire effect ON TERRAIN at given geo coordinates
   * Automatically raycasts to find terrain/roof height - no manual height calculation needed!
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param getTerrainHeight - Function to get terrain height (engine.getTerrainHeightAtGeo)
   * @param intensity - Fire intensity
   * @param heightOffset - Optional offset above terrain (default: 0)
   */
  spawnFireOnTerrain(
    lat: number,
    lon: number,
    getTerrainHeight: (lat: number, lon: number) => number | null,
    intensity: 'tiny' | 'small' | 'medium' | 'large' | 'inferno' = 'medium',
    heightOffset = 0
  ): string {
    const localY = getTerrainHeight(lat, lon) ?? 0;
    return this.spawnFireAtLocalY(lat, lon, localY + heightOffset, intensity);
  }

  /**
   * Spawn fire effect using local Y coordinate directly
   * Use this when you have a local terrain Y from getTerrainHeightAtGeo()
   *
   * @param lat - Latitude (for X/Z positioning)
   * @param lon - Longitude (for X/Z positioning)
   * @param localY - Local Y coordinate (from getTerrainHeightAtGeo)
   * @param intensity - Fire intensity
   */
  spawnFireAtLocalY(
    lat: number,
    lon: number,
    localY: number,
    intensity: 'tiny' | 'small' | 'medium' | 'large' | 'inferno' = 'medium'
  ): string {
    // Get X/Z from geo, but use provided localY directly
    const localXZ = this.sync.geoToLocalSimple(lat, lon, 0);
    const localPos = new Vector3(localXZ.x, localY, localXZ.z);

    const id = `fire_${this.effectIdCounter++}`;

    // Fire intensity config - all use duration: -1 for persistent fire
    const intensityConfig = {
      tiny: { count: 15, radius: 1.5 },
      small: { count: 40, radius: 2.5 },
      medium: { count: 80, radius: 4 },
      large: { count: 120, radius: 6 },
      inferno: { count: 200, radius: 10 },
    };

    const config = intensityConfig[intensity];

    const effect: EffectInstance = {
      id,
      type: 'fire',
      particles: [],
      startTime: performance.now(),
      duration: -1, // All fires are now persistent until stopped
      localPosition: localPos.clone(),
    };

    // Store radius in effect for respawning (using a custom property)
    (effect as EffectInstance & { radius: number }).radius = config.radius;

    // Use trailPoolAdditive for better visuals (per-particle colors, shader support)
    for (let i = 0; i < config.count; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) break;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * config.radius;

      particle.position.copy(localPos);
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;

      particle.velocity.set(
        (Math.random() - 0.5) * 2,
        3 + Math.random() * 5, // Upward
        (Math.random() - 0.5) * 2
      );
      particle.life = 1.0;
      particle.maxLife = 0.4 + Math.random() * 0.8;
      particle.size = 1.5 + Math.random() * 2.5; // Bigger particles

      // Fire colors - yellow core, orange mid, red edges
      const t = Math.random();
      if (t < 0.3) {
        particle.color.setRGB(1, 0.9, 0.3); // Yellow core
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.5, 0.1); // Orange
      } else {
        particle.color.setRGB(1, 0.2, 0.05); // Red edges
      }

      effect.particles.push(particle);
    }

    this.activeEffects.set(id, effect);
    return id;
  }

  /**
   * Stop a fire effect
   */
  stopFire(id: string): void {
    const effect = this.activeEffects.get(id);
    if (effect && effect.type === 'fire') {
      // Set duration to fade out quickly
      effect.duration = 500;
      effect.startTime = performance.now();
    }
  }

  /**
   * Stop all fire effects
   */
  stopAllFires(): void {
    for (const [, effect] of this.activeEffects) {
      if (effect.type === 'fire') {
        effect.duration = 500;
        effect.startTime = performance.now();
      }
    }
  }

  /**
   * Stop a fire effect immediately (no fade)
   */
  stopFireImmediate(id: string): void {
    const effect = this.activeEffects.get(id);
    if (effect && effect.type === 'fire') {
      // Kill all particles immediately
      for (const p of effect.particles) {
        p.life = 0;
      }
      this.activeEffects.delete(id);
    }
  }

  // =====================================================
  // TOWER INNER FIRE - Dedicated pool for Fire Tower
  // =====================================================

  /**
   * Spawn persistent inner fire for a Fire Tower.
   * Uses dedicated pool independent of combat effects.
   *
   * @param towerId - Unique tower ID
   * @param localPosition - Local position of tower base
   * @param fireHeight - Height offset for fire center (inside tower)
   * @param intensity - Fire intensity 0.0-1.0 (default 0.5)
   * @returns Tower fire ID (same as towerId)
   */
  spawnTowerInnerFire(
    towerId: string,
    localPosition: Vector3,
    fireHeight = 3.0,
    intensity = 0.5
  ): string {
    // Check if already exists
    if (this.activeTowerFires.has(towerId)) {
      console.warn('[Effects] Tower fire already exists:', towerId);
      return towerId;
    }

    const clampedIntensity = Math.max(0.1, Math.min(1.0, intensity));
    const particleCount = Math.floor(30 + clampedIntensity * 80); // 30-110 particles
    const fireRadius = 0.8 + clampedIntensity * 1.2; // 0.8-2.0 meters

    // Fire center position (inside hollow tower)
    const fireCenter = localPosition.clone();
    fireCenter.y += fireHeight;

    const particles: Particle[] = [];

    for (let i = 0; i < particleCount; i++) {
      const particle = this.getInactiveParticle(this.towerFirePool, 'towerFire');
      if (!particle) {
        console.warn('[Effects] Tower fire pool exhausted at', i, 'particles');
        break;
      }

      // Spawn in cylinder around center
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * fireRadius;

      particle.position.copy(fireCenter);
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;
      particle.position.y += (Math.random() - 0.3) * 2; // Slight vertical spread

      // Upward velocity with turbulence
      particle.velocity.set(
        (Math.random() - 0.5) * 1.5,
        2 + Math.random() * 4, // Upward
        (Math.random() - 0.5) * 1.5
      );

      particle.life = Math.random(); // Stagger initial life for natural look
      particle.maxLife = 0.4 + Math.random() * 0.6;
      particle.size = 1.0 + Math.random() * 1.5 + clampedIntensity;

      // Fire colors - yellow core, orange mid, red edges
      const t = Math.random();
      if (t < 0.35) {
        particle.color.setRGB(1, 0.9, 0.3); // Yellow core
      } else if (t < 0.75) {
        particle.color.setRGB(1, 0.5, 0.1); // Orange
      } else {
        particle.color.setRGB(1, 0.25, 0.05); // Red edges
      }

      particles.push(particle);
    }

    this.activeTowerFires.set(towerId, {
      particles,
      localPosition: fireCenter.clone(),
    });

    console.log('[Effects] Tower inner fire spawned:', towerId, '| Particles:', particles.length);
    return towerId;
  }

  /**
   * Stop tower inner fire immediately
   */
  stopTowerInnerFire(towerId: string): void {
    const fire = this.activeTowerFires.get(towerId);
    if (!fire) return;

    // Kill all particles
    for (const p of fire.particles) {
      p.life = 0;
    }

    this.activeTowerFires.delete(towerId);
    console.log('[Effects] Tower inner fire stopped:', towerId);
  }

  /**
   * Stop all tower inner fires
   */
  stopAllTowerFires(): void {
    for (const [towerId] of this.activeTowerFires) {
      this.stopTowerInnerFire(towerId);
    }
  }

  /**
   * Check if tower has active inner fire
   */
  hasTowerFire(towerId: string): boolean {
    return this.activeTowerFires.has(towerId);
  }

  // =====================================================
  // FROST AURA - Orbiting ice particles for slowed enemies
  // =====================================================

  /**
   * Spawn frost aura around a slowed enemy.
   * Creates 3 orbiting cyan/white particles from the additive trail pool.
   *
   * @param enemyId - Unique enemy ID
   * @param localPosition - Current local position of the enemy
   * @returns Enemy ID (same as input)
   */
  spawnFrostAura(enemyId: string, localPosition: Vector3): string {
    if (this.activeFrostAuras.has(enemyId)) return enemyId;

    const particleCount = 3;
    const particles: Particle[] = [];
    const center = localPosition.clone();

    for (let i = 0; i < particleCount; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) break;

      // Stagger initial angles evenly (120° apart)
      const angle = (i / particleCount) * Math.PI * 2;
      const orbitRadius = 1.8;

      particle.position.set(
        center.x + Math.cos(angle) * orbitRadius,
        center.y + 1.5 + Math.sin(angle * 0.5) * 0.3,
        center.z + Math.sin(angle) * orbitRadius
      );

      // Minimal velocity — position is overridden each frame
      particle.velocity.set(0, 0.3 + Math.random() * 0.2, 0);
      particle.life = 1.0;
      particle.maxLife = 999; // Kept alive until explicitly stopped
      particle.size = 1.2 + Math.random() * 0.6;
      particle.frameIndex = -1;
      particle.totalFrames = 0;

      // Cyan / white ice colors
      const t = Math.random();
      if (t < 0.5) {
        particle.color.setRGB(0.6, 0.9, 1.0); // Cyan
      } else {
        particle.color.setRGB(0.85, 0.95, 1.0); // White-cyan
      }

      particles.push(particle);
    }

    this.activeFrostAuras.set(enemyId, {
      particles,
      localPosition: center,
      orbitAngle: 0,
    });

    return enemyId;
  }

  /**
   * Update frost aura position to follow a moving enemy.
   * Call each frame for enemies with active frost aura.
   */
  updateFrostAuraPosition(enemyId: string, localPosition: Vector3): void {
    const aura = this.activeFrostAuras.get(enemyId);
    if (!aura) return;
    aura.localPosition.copy(localPosition);
  }

  /**
   * Stop frost aura on an enemy (slow expired).
   */
  stopFrostAura(enemyId: string): void {
    const aura = this.activeFrostAuras.get(enemyId);
    if (!aura) return;

    for (const p of aura.particles) {
      p.life = 0;
    }
    this.activeFrostAuras.delete(enemyId);
  }

  /**
   * Check if an enemy has an active frost aura
   */
  hasFrostAura(enemyId: string): boolean {
    return this.activeFrostAuras.has(enemyId);
  }

  /**
   * Spawn orbiting green poison particles around a poisoned enemy.
   */
  spawnPoisonAura(enemyId: string, localPosition: Vector3): string {
    if (this.activePoisonAuras.has(enemyId)) return enemyId;

    const particleCount = 3;
    const particles: Particle[] = [];
    const center = localPosition.clone();

    for (let i = 0; i < particleCount; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) break;

      const angle = (i / particleCount) * Math.PI * 2;
      const orbitRadius = 1.8;

      particle.position.set(
        center.x + Math.cos(angle) * orbitRadius,
        center.y + 1.5 + Math.sin(angle * 0.5) * 0.3,
        center.z + Math.sin(angle) * orbitRadius
      );

      particle.velocity.set(0, 0.3 + Math.random() * 0.2, 0);
      particle.life = 1.0;
      particle.maxLife = 999;
      particle.size = 1.2 + Math.random() * 0.6;
      particle.frameIndex = -1;
      particle.totalFrames = 0;

      // Green poison colors
      const t = Math.random();
      if (t < 0.5) {
        particle.color.setRGB(0.2, 0.8, 0.1); // Green
      } else {
        particle.color.setRGB(0.5, 1.0, 0.2); // Yellow-green
      }

      particles.push(particle);
    }

    this.activePoisonAuras.set(enemyId, {
      particles,
      localPosition: center,
      orbitAngle: 0,
    });

    return enemyId;
  }

  /**
   * Update poison aura position to follow a moving enemy.
   */
  updatePoisonAuraPosition(enemyId: string, localPosition: Vector3): void {
    const aura = this.activePoisonAuras.get(enemyId);
    if (!aura) return;
    aura.localPosition.copy(localPosition);
  }

  /**
   * Stop poison aura on an enemy (poison expired).
   */
  stopPoisonAura(enemyId: string): void {
    const aura = this.activePoisonAuras.get(enemyId);
    if (!aura) return;

    for (const p of aura.particles) {
      p.life = 0;
    }
    this.activePoisonAuras.delete(enemyId);
  }

  /**
   * Check if an enemy has an active poison aura
   */
  hasPoisonAura(enemyId: string): boolean {
    return this.activePoisonAuras.has(enemyId);
  }

  /**
   * Spawn a single flame particle for beam effects.
   * Used by FlameBeamRenderer for flamethrower streams.
   */
  spawnFlameParticle(
    position: Vector3,
    velocity: Vector3,
    color: Color,
    size: number,
    maxLife: number
  ): void {
    const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
    if (!particle) return;

    particle.position.copy(position);
    particle.velocity.copy(velocity);
    particle.color.copy(color);
    particle.size = size;
    particle.life = 1.0;
    particle.maxLife = maxLife;
  }

  /**
   * Spawn a brief muzzle flash at a local position.
   * 3-5 bright additive particles (yellow/white) lasting ~50ms.
   * Used when projectile towers fire.
   *
   * @param localX - Local X coordinate (tower shoot position)
   * @param localY - Local Y coordinate (tower shoot position)
   * @param localZ - Local Z coordinate (tower shoot position)
   */
  spawnMuzzleFlash(localX: number, localY: number, localZ: number): void {
    const count = 3 + Math.floor(Math.random() * 3); // 3-5 particles

    for (let i = 0; i < count; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) break;

      // Spawn at shoot position with tiny random jitter
      particle.position.set(
        localX + (Math.random() - 0.5) * 0.3,
        localY + (Math.random() - 0.5) * 0.3,
        localZ + (Math.random() - 0.5) * 0.3
      );

      // Small outward burst velocity
      particle.velocity.set(
        (Math.random() - 0.5) * 4,
        Math.random() * 3,
        (Math.random() - 0.5) * 4
      );

      particle.life = 1.0;
      particle.maxLife = 0.04 + Math.random() * 0.02; // 40-60ms (~50ms)
      particle.size = 1.5 + Math.random() * 1.5; // 1.5-3.0 — bright and visible

      // Bright yellow/white flash color
      const t = Math.random();
      if (t < 0.5) {
        particle.color.setRGB(1, 1, 0.85); // White-yellow
      } else {
        particle.color.setRGB(1, 0.9, 0.4); // Warm yellow
      }
    }
  }

  /**
   * Spawn a brief fire flash that fades away
   * Used for damage indication when HP > 50%
   */
  spawnFireFlash(lat: number, lon: number, localY: number): void {
    const localXZ = this.sync.geoToLocalSimple(lat, lon, 0);
    const localPos = new Vector3(localXZ.x, localY, localXZ.z);

    // Spawn 30 particles that fade quickly
    for (let i = 0; i < 30; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) break;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 2;

      particle.position.copy(localPos);
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;

      particle.velocity.set(
        (Math.random() - 0.5) * 3,
        4 + Math.random() * 6,
        (Math.random() - 0.5) * 3
      );
      particle.life = 1.0;
      particle.maxLife = 0.8 + Math.random() * 0.6; // 0.8-1.4 seconds
      particle.size = 1.5 + Math.random() * 2.0;

      // Fire colors
      const t = Math.random();
      if (t < 0.3) {
        particle.color.setRGB(1, 0.9, 0.3);
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.5, 0.1);
      } else {
        particle.color.setRGB(1, 0.2, 0.05);
      }
    }
    // No effect tracking - particles just fade naturally
  }

  /**
   * Spawn scaled permanent fire (for HP 1-50%)
   * @param scale - 0.0 (small) to 1.0 (maximum inferno)
   */
  spawnScaledFire(lat: number, lon: number, localY: number, scale: number): string {
    const localXZ = this.sync.geoToLocalSimple(lat, lon, 0);
    const localPos = new Vector3(localXZ.x, localY, localXZ.z);

    const id = `fire_${this.effectIdCounter++}`;

    // Scale parameters: small fire at scale=0, massive inferno at scale=1
    const clampedScale = Math.max(0, Math.min(1, scale));
    const particleCount = Math.floor(30 + clampedScale * 200); // 30-230 particles
    const fireRadius = 1.5 + clampedScale * 10; // 1.5-11.5 meters

    const effect: EffectInstance = {
      id,
      type: 'fire',
      particles: [],
      startTime: performance.now(),
      duration: -1, // Persistent
      localPosition: localPos.clone(),
    };

    (effect as EffectInstance & { radius: number }).radius = fireRadius;

    for (let i = 0; i < particleCount; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) break;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * fireRadius;

      particle.position.copy(localPos);
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;

      particle.velocity.set(
        (Math.random() - 0.5) * 2,
        3 + Math.random() * 5,
        (Math.random() - 0.5) * 2
      );
      particle.life = 1.0;
      particle.maxLife = 0.4 + Math.random() * 0.8;
      particle.size = 1.5 + Math.random() * 2.5 + clampedScale * 1.5; // Bigger at higher scale

      // Fire colors
      const t = Math.random();
      if (t < 0.3) {
        particle.color.setRGB(1, 0.9, 0.3);
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.5, 0.1);
      } else {
        particle.color.setRGB(1, 0.2, 0.05);
      }

      effect.particles.push(particle);
    }

    this.activeEffects.set(id, effect);
    return id;
  }

  /**
   * Scale up an existing fire to inferno level
   * Adds more particles to the existing fire effect
   */
  scaleFireToInferno(fireId: string): void {
    const effect = this.activeEffects.get(fireId);
    if (!effect || effect.type !== 'fire') {
      console.warn('[Effects] Cannot scale fire - not found:', fireId);
      return;
    }

    const localPos = effect.localPosition;
    const currentRadius = (effect as EffectInstance & { radius: number }).radius || 5;

    // Increase radius to inferno level
    const infernoRadius = Math.max(currentRadius, 15);
    (effect as EffectInstance & { radius: number }).radius = infernoRadius;

    // Add more particles to reach inferno level (~300 total)
    const currentCount = effect.particles.length;
    const targetCount = 300;
    const toAdd = Math.max(0, targetCount - currentCount);

    for (let i = 0; i < toAdd; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) break;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * infernoRadius;

      particle.position.copy(localPos);
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;

      particle.velocity.set(
        (Math.random() - 0.5) * 3,
        4 + Math.random() * 8,
        (Math.random() - 0.5) * 3
      );
      particle.life = 1.0;
      particle.maxLife = 0.5 + Math.random() * 1.0;
      particle.size = 2.5 + Math.random() * 4.0;

      const t = Math.random();
      if (t < 0.3) {
        particle.color.setRGB(1, 0.9, 0.3);
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.5, 0.1);
      } else {
        particle.color.setRGB(1, 0.2, 0.05);
      }

      effect.particles.push(particle);
    }

    console.log('[Effects] Scaled fire to inferno:', fireId, '| Particles:', effect.particles.length);
  }

  /**
   * Spawn massive HQ destruction explosion
   * 3x scale - very dramatic final explosion
   */
  spawnHQExplosion(lat: number, lon: number, localY: number): void {
    const localXZ = this.sync.geoToLocalSimple(lat, lon, 0);
    const centerX = localXZ.x;
    const centerY = localY + 8; // Above ground (raised for larger explosion)
    const centerZ = localXZ.z;

    // Count available particles
    let availableParticles = 0;
    for (const p of this.trailPoolAdditive) {
      if (p.life <= 0) availableParticles++;
    }

    console.log('[HQ Explosion] Spawning at local:', centerX.toFixed(1), centerY.toFixed(1), centerZ.toFixed(1));
    console.log('[HQ Explosion] Input localY:', localY, '| Available particles:', availableParticles, '/', this.trailPoolAdditive.length);

    // Phase 1: Central bright flash - reduced count, larger size to compensate
    for (let i = 0; i < 150; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) {
        console.warn('[HQ Explosion] Pool exhausted at phase 1, particle', i);
        break;
      }

      particle.position.set(centerX, centerY, centerZ);

      // Spherical outward burst (3x speed and reach)
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 40 + Math.random() * 60; // 3x faster burst

      particle.velocity.set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed * 0.8 + 15, // Strong upward bias
        Math.sin(phi) * Math.sin(theta) * speed
      );

      particle.life = 1.0;
      particle.maxLife = 1.5 + Math.random() * 1.5; // Longer duration
      particle.size = (8.0 + Math.random() * 12.0) * 1.5; // 1.5x larger to compensate for fewer particles

      // Bright yellow/white core
      const t = Math.random();
      if (t < 0.4) {
        particle.color.setRGB(1, 1, 0.9); // White-yellow
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.95, 0.4); // Yellow
      } else {
        particle.color.setRGB(1, 0.7, 0.2); // Orange
      }
    }

    // Phase 2: Secondary fire/debris ring - reduced count, larger size to compensate
    for (let i = 0; i < 250; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) {
        console.warn('[HQ Explosion] Pool exhausted at phase 2, particle', i);
        break;
      }

      // Spawn in a ring around center (3x radius)
      const angle = Math.random() * Math.PI * 2;
      const ringRadius = 8 + Math.random() * 18;

      particle.position.set(
        centerX + Math.cos(angle) * ringRadius,
        centerY + Math.random() * 8,
        centerZ + Math.sin(angle) * ringRadius
      );

      // Outward and upward (3x speed)
      const speed = 25 + Math.random() * 50;
      particle.velocity.set(
        Math.cos(angle) * speed * 0.6,
        10 + Math.random() * 25,
        Math.sin(angle) * speed * 0.6
      );

      particle.life = 1.0;
      particle.maxLife = 2.0 + Math.random() * 2.0; // Longer duration
      particle.size = (6.0 + Math.random() * 10.0) * 1.3; // 1.3x larger to compensate for fewer particles

      // Orange/red fire colors
      const t = Math.random();
      if (t < 0.3) {
        particle.color.setRGB(1, 0.8, 0.3);
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.5, 0.15);
      } else {
        particle.color.setRGB(1, 0.2, 0.05);
      }
    }

    // Phase 3: Rising embers and sparks - reduced count
    for (let i = 0; i < 100; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) {
        console.warn('[HQ Explosion] Pool exhausted at phase 3, particle', i);
        break;
      }

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 30; // 3x radius

      particle.position.set(
        centerX + Math.cos(angle) * radius,
        centerY,
        centerZ + Math.sin(angle) * radius
      );

      // Slow rising embers
      particle.velocity.set(
        (Math.random() - 0.5) * 10,
        5 + Math.random() * 12,
        (Math.random() - 0.5) * 10
      );

      particle.life = 1.0;
      particle.maxLife = 2.0 + Math.random() * 2.0; // 2-4 seconds
      particle.size = 1.5 + Math.random() * 2.5;

      // Darker red/orange embers
      const t = Math.random();
      if (t < 0.5) {
        particle.color.setRGB(1, 0.4, 0.1);
      } else {
        particle.color.setRGB(1, 0.2, 0.05);
      }
    }

    console.log('[HQ Explosion] Spawned ~450 particles');
  }

  /**
   * Spawn rocket trail particles at a local position
   * Call this each frame for each active rocket to create a continuous trail
   * Uses ADDITIVE blending (fire/glow effect)
   *
   * @param localX - Local X coordinate
   * @param localY - Local Y coordinate (height)
   * @param localZ - Local Z coordinate
   * @param count - Number of particles to spawn (default 3)
   */
  spawnRocketTrail(localX: number, localY: number, localZ: number, count = 3): void {
    for (let i = 0; i < count; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) break;

      // Spawn at rocket position with small random offset
      particle.position.set(
        localX + (Math.random() - 0.5) * 0.5,
        localY + (Math.random() - 0.5) * 0.5,
        localZ + (Math.random() - 0.5) * 0.5
      );

      // Small random velocity (mostly stays in place, drifts slightly)
      particle.velocity.set(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2 - 1, // Slight downward drift
        (Math.random() - 0.5) * 2
      );

      particle.life = 1.0;
      particle.maxLife = 0.3 + Math.random() * 0.3; // 0.3-0.6 seconds
      particle.size = 1.0 + Math.random() * 1.0; // 1-2 size

      // Orange/yellow color with variation
      const t = Math.random();
      particle.color.setRGB(1, 0.4 + t * 0.4, t * 0.2);
    }
  }

  /**
   * Spawn rocket trail at geo coordinates
   * Convenience method that converts geo to local coordinates
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param count - Number of particles (default 3)
   */
  spawnRocketTrailAtGeo(lat: number, lon: number, height: number, count = 3): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnRocketTrail(localPos.x, localPos.y, localPos.z, count);
  }

  /**
   * Spawn bullet tracer effect at local position
   * Much smaller and faster-fading than rocket trails
   * Uses ADDITIVE blending (bright tracer effect)
   */
  spawnBulletTracer(localX: number, localY: number, localZ: number, count = 1): void {
    for (let i = 0; i < count; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) break;

      // Spawn at bullet position with tiny random offset
      particle.position.set(
        localX + (Math.random() - 0.5) * 0.1,
        localY + (Math.random() - 0.5) * 0.1,
        localZ + (Math.random() - 0.5) * 0.1
      );

      // Minimal velocity - tracer stays mostly in place
      particle.velocity.set(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5
      );

      particle.life = 1.0;
      particle.maxLife = 0.01 + Math.random() * 0.01; // 0.01-0.02 seconds (instant fade)
      particle.size = 0.03 + Math.random() * 0.02; // 0.03-0.05 size (barely visible)

      // Bright yellow/white tracer color
      particle.color.setRGB(1, 0.95, 0.6);
    }
  }

  /**
   * Spawn bullet tracer at geo coordinates
   */
  spawnBulletTracerAtGeo(lat: number, lon: number, height: number, count = 1): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnBulletTracer(localPos.x, localPos.y, localPos.z, count);
  }

  /**
   * Spawn subtle cannon smoke at local position
   * Very subtle black/dark grey particles for cannonball trails
   * Uses NORMAL blending (opaque smoke effect)
   */
  spawnCannonSmoke(localX: number, localY: number, localZ: number, count = 1): void {
    for (let i = 0; i < count; i++) {
      const particle = this.getInactiveParticle(this.trailPoolNormal, 'trailNormal');
      if (!particle) break;

      // Spawn at cannonball position with small random offset
      particle.position.set(
        localX + (Math.random() - 0.5) * 0.3,
        localY + (Math.random() - 0.5) * 0.3,
        localZ + (Math.random() - 0.5) * 0.3
      );

      // Slow drift upward and outward
      particle.velocity.set(
        (Math.random() - 0.5) * 1.5,
        0.5 + Math.random() * 1.0, // Drift upward
        (Math.random() - 0.5) * 1.5
      );

      particle.life = 1.0;
      particle.maxLife = 0.3 + Math.random() * 0.4; // 0.3-0.7 seconds
      particle.size = 0.4 + Math.random() * 0.4; // Small particles

      // Dark grey/black smoke color
      const grey = 0.1 + Math.random() * 0.15; // 0.1-0.25 (very dark)
      particle.color.setRGB(grey, grey, grey);
    }
  }

  /**
   * Spawn cannon smoke at geo coordinates
   */
  spawnCannonSmokeAtGeo(lat: number, lon: number, height: number, count = 1): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnCannonSmoke(localPos.x, localPos.y, localPos.z, count);
  }

  // Spiral angle tracker for railgun effect (uses time-based rotation)
  private spiralAngle = 0;

  /**
   * Spawn configurable trail particles based on TrailParticleConfig
   * Generic method that uses config values instead of hardcoded parameters
   * Automatically chooses additive or normal blending pool based on config.blending
   * Supports 'spiral' trailType for railgun-style rotating particles
   */
  spawnConfigurableTrail(
    localX: number,
    localY: number,
    localZ: number,
    config: TrailParticleConfig
  ): void {
    // Check spawn chance
    if (Math.random() > config.spawnChance) return;

    // Choose pool based on blending mode (default: additive for backwards compatibility)
    const pool = config.blending === 'normal' ? this.trailPoolNormal : this.trailPoolAdditive;
    const poolCursorKey = config.blending === 'normal' ? 'trailNormal' as const : 'trailAdditive' as const;

    // Spiral trail type: railgun-style rotating particles
    if (config.trailType === 'spiral') {
      const radius = config.spiralRadius ?? 1.0;
      const speed = config.spiralSpeed ?? 3.0;
      const angleStep = (Math.PI * 2) / Math.max(config.countPerSpawn, 1);

      for (let i = 0; i < config.countPerSpawn; i++) {
        const particle = this.getInactiveParticle(pool, poolCursorKey);
        if (!particle) break;

        // Calculate spiral position around the projectile path
        const angle = this.spiralAngle + i * angleStep;
        const offsetX = Math.cos(angle) * radius;
        const offsetY = Math.sin(angle) * radius;

        particle.position.set(
          localX + offsetX,
          localY + offsetY,
          localZ
        );

        // Outward velocity from center (creates expanding spiral)
        const outwardSpeed = 2.0;
        particle.velocity.set(
          Math.cos(angle) * outwardSpeed,
          Math.sin(angle) * outwardSpeed,
          0
        );

        particle.life = 1.0;
        particle.maxLife =
          config.lifetimeMin + Math.random() * (config.lifetimeMax - config.lifetimeMin);
        particle.size = config.sizeMin + Math.random() * (config.sizeMax - config.sizeMin);

        // Interpolate between min and max color
        const t = Math.random();
        particle.color.setRGB(
          config.colorMin.r + t * (config.colorMax.r - config.colorMin.r),
          config.colorMin.g + t * (config.colorMax.g - config.colorMin.g),
          config.colorMin.b + t * (config.colorMax.b - config.colorMin.b)
        );
      }

      // Advance spiral angle for next frame
      this.spiralAngle += speed * 0.016; // Assuming ~60fps
      return;
    }

    // Default trail type: random dispersion
    for (let i = 0; i < config.countPerSpawn; i++) {
      const particle = this.getInactiveParticle(pool, poolCursorKey);
      if (!particle) break;

      // Spawn at position with configurable offset
      particle.position.set(
        localX + (Math.random() - 0.5) * config.spawnOffset,
        localY + (Math.random() - 0.5) * config.spawnOffset,
        localZ + (Math.random() - 0.5) * config.spawnOffset
      );

      // Configurable velocity
      particle.velocity.set(
        config.velocityX.min + Math.random() * (config.velocityX.max - config.velocityX.min),
        config.velocityY.min + Math.random() * (config.velocityY.max - config.velocityY.min),
        config.velocityZ.min + Math.random() * (config.velocityZ.max - config.velocityZ.min)
      );

      particle.life = 1.0;
      particle.maxLife =
        config.lifetimeMin + Math.random() * (config.lifetimeMax - config.lifetimeMin);
      particle.size = config.sizeMin + Math.random() * (config.sizeMax - config.sizeMin);

      // Interpolate between min and max color
      const t = Math.random();
      particle.color.setRGB(
        config.colorMin.r + t * (config.colorMax.r - config.colorMin.r),
        config.colorMin.g + t * (config.colorMax.g - config.colorMin.g),
        config.colorMin.b + t * (config.colorMax.b - config.colorMin.b)
      );
    }
  }

  /**
   * Spawn configurable trail particles at geo coordinates
   */
  spawnConfigurableTrailAtGeo(
    lat: number,
    lon: number,
    height: number,
    config: TrailParticleConfig
  ): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnConfigurableTrail(localPos.x, localPos.y, localPos.z, config);
  }

  /**
   * Spawn explosion effect at local position
   * Used for rocket impacts and other explosions
   * Uses ADDITIVE blending (fire/glow effect)
   *
   * @param localX - Local X coordinate
   * @param localY - Local Y coordinate (height)
   * @param localZ - Local Z coordinate
   * @param count - Number of particles (default 25)
   * @param radius - Explosion radius in meters (default 5)
   */
  spawnExplosion(localX: number, localY: number, localZ: number, count = 25, _radius = 5): void {
    const totalAtlasFrames = this.ATLAS_COLS * this.ATLAS_ROWS; // 16 frames

    for (let i = 0; i < count; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) break;

      // Spawn at impact position
      particle.position.set(localX, localY, localZ);

      // Random direction outward (spherical distribution)
      const theta = Math.random() * Math.PI * 2; // Horizontal angle
      const phi = Math.random() * Math.PI; // Vertical angle
      const speed = 5 + Math.random() * 15; // 5-20 m/s outward

      particle.velocity.set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed * 0.5 + 2, // Bias upward slightly
        Math.sin(phi) * Math.sin(theta) * speed
      );

      particle.life = 1.0;
      particle.maxLife = 0.3 + Math.random() * 0.4; // 0.3-0.7 seconds (slightly longer for animation)
      particle.size = 2.5 + Math.random() * 3.0; // Bigger to show atlas detail (2.5-5.5)

      // Sprite-sheet animation: each particle starts at a random early frame
      // so the explosion looks varied (not all particles on same frame)
      particle.frameIndex = Math.floor(Math.random() * 3); // Start at frame 0-2
      particle.totalFrames = totalAtlasFrames;

      // Tint color (white = use atlas color as-is, slight variation adds richness)
      const t = Math.random();
      if (t < 0.4) {
        particle.color.setRGB(1, 1, 1); // Pure atlas color
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.9, 0.7); // Warm tint
      } else {
        particle.color.setRGB(1, 0.7, 0.5); // Orange tint
      }
    }
  }

  /**
   * Spawn explosion at geo coordinates
   * Convenience method that converts geo to local coordinates
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param count - Number of particles (default 25)
   */
  spawnExplosionAtGeo(lat: number, lon: number, height: number, count = 25): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnExplosion(localPos.x, localPos.y, localPos.z, count);
  }

  /**
   * Spawn ice explosion effect at local position
   * Used for ice tower impacts - cyan/blue particles
   *
   * @param localX - Local X coordinate
   * @param localY - Local Y coordinate (height)
   * @param localZ - Local Z coordinate
   * @param count - Number of particles (default 20)
   */
  spawnIceExplosion(localX: number, localY: number, localZ: number, count = 20): void {
    for (let i = 0; i < count; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive, 'trailAdditive');
      if (!particle) break;

      // Spawn at impact position
      particle.position.set(localX, localY, localZ);

      // Random direction outward (spherical distribution)
      const theta = Math.random() * Math.PI * 2; // Horizontal angle
      const phi = Math.random() * Math.PI; // Vertical angle
      const speed = 5 + Math.random() * 15;

      particle.velocity.set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed * 0.5 + 2, // Bias upward
        Math.sin(phi) * Math.sin(theta) * speed
      );

      particle.life = 1.0;
      particle.maxLife = 0.4 + Math.random() * 0.5; // 0.4-0.9 seconds (longer visible)
      particle.size = 1.5 + Math.random() * 2.0; // Larger particles

      // Very bright ice colors (more white/cyan)
      const t = Math.random();
      if (t < 0.4) {
        // Pure white core
        particle.color.setRGB(1.0, 1.0, 1.0);
      } else if (t < 0.7) {
        // Very light cyan
        particle.color.setRGB(0.9, 0.98, 1.0);
      } else {
        // Light ice blue
        particle.color.setRGB(0.8, 0.95, 1.0);
      }
    }
  }

  /**
   * Spawn ice explosion at geo coordinates
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param count - Number of particles (default 20)
   */
  spawnIceExplosionAtGeo(lat: number, lon: number, height: number, count = 20): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnIceExplosion(localPos.x, localPos.y, localPos.z, count);
  }

  /**
   * Spawn ice decal on ground (frost patch)
   * NOW USES GPU INSTANCING - much better performance!
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Terrain height
   * @param size - Size of the decal (1.0-4.0 meters, default 2.0)
   * @returns Decal ID
   */
  spawnIceDecal(lat: number, lon: number, height: number, size = 2.0): string {
    if (!this.iceDecalManager) {
      console.warn('[ThreeEffectsRenderer] Ice decal manager not initialized');
      return '';
    }

    const localPos = this.sync.geoToLocal(lat, lon, height);
    localPos.y += ICE_DECAL_CONFIG.heightOffset;

    const id = `ice_decal_${this.decalIdCounter++}`;
    const now = performance.now();

    // Random rotation for variety
    const rotation = Math.random() * Math.PI * 2;

    // Apply size with randomness
    const baseSize = size * (0.8 + Math.random() * 0.4);

    // Randomize color slightly (very light cyan/white variations) - from config
    const colorVariation = Math.random() * ICE_DECAL_CONFIG.colorVariation;
    const color = new Color(
      ICE_DECAL_CONFIG.baseColor.r + colorVariation,
      ICE_DECAL_CONFIG.baseColor.g + colorVariation * 0.5,
      ICE_DECAL_CONFIG.baseColor.b
    );

    // If pool is full, remove oldest decal
    if (this.iceDecalManager.count >= this.MAX_ICE_DECALS) {
      const instances = this.iceDecalManager.getAllInstances();
      if (instances.length > 0) {
        let oldest = instances[0];
        for (const inst of instances) {
          if (inst.spawnTime < oldest.spawnTime) {
            oldest = inst;
          }
        }
        this.iceDecalManager.remove(oldest.id);
      }
    }

    // Add new decal instance
    this.iceDecalManager.add(
      id,
      localPos,
      baseSize,
      rotation,
      color,
      ICE_DECAL_CONFIG.baseOpacity,
      now,
      this.ICE_DECAL_FADE_DELAY,
      this.ICE_DECAL_FADE_DURATION
    );

    return id;
  }

  /**
   * Spawn floating text at a position (e.g., for rewards, damage numbers, status messages)
   *
   * @param text - The text to display
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param config - Optional configuration
   * @returns Floating text ID
   */
  spawnFloatingText(
    text: string,
    lat: number,
    lon: number,
    height: number,
    config: FloatingTextConfig = {}
  ): void {
    this.floatingTextManager.spawn(text, lat, lon, height, config);
  }

  /**
   * Update floating text billboard uniforms and reclaim expired instances.
   * Must be called with the active camera for correct billboard orientation.
   */
  updateFloatingTexts(camera: Camera): void {
    this.floatingTextManager.update(camera);
  }

  /**
   * Update all active effects
   *
   * @param deltaTime - Time since last frame in milliseconds
   */
  update(deltaTime: number): void {
    const now = performance.now();
    const dt = deltaTime / 1000; // Convert to seconds
    const gravity = -9.8;

    // Update effects and remove expired ones
    for (const [id, effect] of this.activeEffects) {
      const elapsed = now - effect.startTime;

      // Check if effect expired
      if (effect.duration > 0 && elapsed > effect.duration) {
        // Return particles to pool
        for (const p of effect.particles) {
          p.life = 0;
        }
        this.activeEffects.delete(id);
        continue;
      }

      // Update particles
      for (const particle of effect.particles) {
        if (particle.life <= 0) continue;

        // Update position (reuse temp vector to avoid GC)
        particle.position.add(this.tempVelocity.copy(particle.velocity).multiplyScalar(dt));

        // Apply gravity (blood falls, fire rises)
        if (effect.type === 'blood') {
          particle.velocity.y += gravity * dt;
        }

        // Decay life
        particle.life -= dt / particle.maxLife;

        // Respawn fire particles (all fires are now persistent with duration: -1)
        if (effect.type === 'fire' && particle.life <= 0 && effect.duration < 0) {
          // Use stored radius or default to 5
          const fireRadius = (effect as EffectInstance & { radius?: number }).radius ?? 5;
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * fireRadius;

          particle.position.copy(effect.localPosition);
          particle.position.x += Math.cos(angle) * radius;
          particle.position.z += Math.sin(angle) * radius;

          particle.velocity.set(
            (Math.random() - 0.5) * 2,
            3 + Math.random() * 5,
            (Math.random() - 0.5) * 2
          );
          particle.life = 1.0;
          particle.maxLife = 0.4 + Math.random() * 0.8;
          particle.size = 1.5 + Math.random() * 2.5;
          particle.frameIndex = -1; // Fire uses circular particles
          particle.totalFrames = 0;

          // Fire colors on respawn
          const t = Math.random();
          if (t < 0.3) {
            particle.color.setRGB(1, 0.9, 0.3);
          } else if (t < 0.7) {
            particle.color.setRGB(1, 0.5, 0.1);
          } else {
            particle.color.setRGB(1, 0.2, 0.05);
          }
        }
      }
    }

    // Update blood decals (fading) - INSTANCED
    if (this.bloodDecalManager) {
      const instances = this.bloodDecalManager.getAllInstances();
      for (const instance of instances) {
        if (!instance.active) continue;

        const elapsed = now - instance.fadeStartTime;

        if (elapsed > 0) {
          // Calculate fade progress (0-1)
          const fadeProgress = Math.min(elapsed / instance.fadeDuration, 1);
          const opacity = BLOOD_DECAL_CONFIG.baseOpacity * (1 - fadeProgress);

          this.bloodDecalManager.updateOpacity(instance.id, opacity);

          // Remove when fully faded
          if (fadeProgress >= 1) {
            this.bloodDecalManager.remove(instance.id);
          }
        }
      }
    }

    // Update ice decals (faster fading) - INSTANCED
    if (this.iceDecalManager) {
      const instances = this.iceDecalManager.getAllInstances();
      for (const instance of instances) {
        if (!instance.active) continue;

        const elapsed = now - instance.fadeStartTime;

        if (elapsed > 0) {
          // Calculate fade progress (0-1)
          const fadeProgress = Math.min(elapsed / instance.fadeDuration, 1);
          const opacity = ICE_DECAL_CONFIG.baseOpacity * (1 - fadeProgress);

          this.iceDecalManager.updateOpacity(instance.id, opacity);

          // Remove when fully faded
          if (fadeProgress >= 1) {
            this.iceDecalManager.remove(instance.id);
          }
        }
      }
    }

    // Floating texts are updated via updateFloatingTexts(camera) called from the engine

    // Update trail particles - ADDITIVE pool (skip when idle)
    if (this._prevActiveCountAdditive > 0 || this._poolDirtyAdditive) {
      for (const particle of this.trailPoolAdditive) {
        if (particle.life <= 0) continue;
        particle.position.add(this.tempVelocity.copy(particle.velocity).multiplyScalar(dt));
        particle.life -= dt / particle.maxLife;
      }
    }

    // Update trail particles - NORMAL pool (skip when idle)
    if (this._prevActiveCountNormal > 0 || this._poolDirtyNormal) {
      for (const particle of this.trailPoolNormal) {
        if (particle.life <= 0) continue;
        particle.position.add(this.tempVelocity.copy(particle.velocity).multiplyScalar(dt));
        particle.life -= dt / particle.maxLife;
      }
    }

    // Update tower inner fire particles (persistent, respawn when dead)
    for (const [, fire] of this.activeTowerFires) {
      const fireRadius = 1.5; // Fixed radius for inner fire
      const fireCenter = fire.localPosition;

      for (const particle of fire.particles) {
        if (particle.life > 0) {
          // Update position
          particle.position.add(this.tempVelocity.copy(particle.velocity).multiplyScalar(dt));
          // Decay life
          particle.life -= dt / particle.maxLife;
        } else {
          // Respawn dead particle
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * fireRadius;

          particle.position.copy(fireCenter);
          particle.position.x += Math.cos(angle) * radius;
          particle.position.z += Math.sin(angle) * radius;
          particle.position.y += (Math.random() - 0.3) * 2;

          particle.velocity.set(
            (Math.random() - 0.5) * 1.5,
            2 + Math.random() * 4,
            (Math.random() - 0.5) * 1.5
          );

          particle.life = 1.0;
          particle.maxLife = 0.4 + Math.random() * 0.6;
          particle.size = 1.0 + Math.random() * 2.0;

          // Fire colors on respawn
          const t = Math.random();
          if (t < 0.35) {
            particle.color.setRGB(1, 0.9, 0.3);
          } else if (t < 0.75) {
            particle.color.setRGB(1, 0.5, 0.1);
          } else {
            particle.color.setRGB(1, 0.25, 0.05);
          }
        }
      }
    }

    // Update frost aura particles (orbiting around slowed enemies)
    for (const [, aura] of this.activeFrostAuras) {
      aura.orbitAngle += dt * 3.0; // ~3 rad/s orbit speed
      const orbitRadius = 1.8;
      const center = aura.localPosition;
      const count = aura.particles.length;

      for (let i = 0; i < count; i++) {
        const p = aura.particles[i];
        if (p.life <= 0) continue;

        const angle = aura.orbitAngle + (i / count) * Math.PI * 2;
        p.position.set(
          center.x + Math.cos(angle) * orbitRadius,
          center.y + 1.5 + Math.sin(angle * 2) * 0.4, // gentle vertical bob
          center.z + Math.sin(angle) * orbitRadius
        );

        // Keep alive indefinitely (reset life)
        p.life = 1.0;

        // Subtle size pulse
        p.size = 1.0 + 0.4 * Math.sin(angle * 1.5);
      }
    }

    // Update poison aura particles (orbiting around poisoned enemies)
    for (const [, aura] of this.activePoisonAuras) {
      aura.orbitAngle += dt * 2.5; // Slightly slower than frost (2.5 vs 3.0 rad/s)
      const orbitRadius = 1.8;
      const center = aura.localPosition;
      const count = aura.particles.length;

      for (let i = 0; i < count; i++) {
        const p = aura.particles[i];
        if (p.life <= 0) continue;

        const angle = aura.orbitAngle + (i / count) * Math.PI * 2;
        p.position.set(
          center.x + Math.cos(angle) * orbitRadius,
          center.y + 1.5 + Math.sin(angle * 2) * 0.4,
          center.z + Math.sin(angle) * orbitRadius
        );

        p.life = 1.0;
        p.size = 1.0 + 0.4 * Math.sin(angle * 1.5);
      }
    }

    // Update GPU buffers
    this.updateParticleBuffers();
  }

  /**
   * Update particle position buffers.
   * Skips idle pools entirely (no iteration, no GPU upload).
   * Uses cached buffer attribute refs to avoid per-frame string lookups.
   */
  private updateParticleBuffers(): void {
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
   * Get an inactive particle from a pool using O(1) free-list lookup.
   * Pops from the free-list stack first. Falls back to round-robin cursor
   * if the free-list is empty (e.g. after bulk respawns that bypass the list).
   */
  private getInactiveParticle(pool: Particle[], cursorKey: keyof typeof this.poolCursors): Particle | null {
    const freeList = this.getFreeList(cursorKey);
    const inFreeList = this.getInFreeList(cursorKey);

    // O(1) path: pop from free-list stack
    while (freeList.length > 0) {
      const idx = freeList.pop()!;
      inFreeList[idx] = 0;
      if (pool[idx].life <= 0) {
        // Reset sprite-sheet fields so reused particles default to circular
        pool[idx].frameIndex = -1;
        pool[idx].totalFrames = 0;
        this.markPoolDirty(cursorKey);
        return pool[idx];
      }
      // Particle was reactivated externally (e.g. fire respawn) — skip it
    }

    // Fallback: round-robin cursor scan (handles edge cases)
    const len = pool.length;
    const startIdx = this.poolCursors[cursorKey];
    for (let i = 0; i < len; i++) {
      const idx = (startIdx + i) % len;
      if (pool[idx].life <= 0) {
        this.poolCursors[cursorKey] = (idx + 1) % len;
        pool[idx].frameIndex = -1;
        pool[idx].totalFrames = 0;
        this.markPoolDirty(cursorKey);
        return pool[idx];
      }
    }
    return null;
  }

  private markPoolDirty(cursorKey: keyof typeof this.poolCursors): void {
    switch (cursorKey) {
      case 'trailAdditive': this._poolDirtyAdditive = true; break;
      case 'trailNormal': this._poolDirtyNormal = true; break;
      case 'towerFire': this._poolDirtyTowerFire = true; break;
    }
  }

  /** Map cursor key to corresponding free-list array */
  private getFreeList(cursorKey: keyof typeof this.poolCursors): number[] {
    switch (cursorKey) {
      case 'trailAdditive': return this.freeIndicesAdditive;
      case 'trailNormal': return this.freeIndicesNormal;
      case 'towerFire': return this.freeIndicesTowerFire;
    }
  }

  /** Map cursor key to corresponding inFreeList tracking array */
  private getInFreeList(cursorKey: keyof typeof this.poolCursors): Uint8Array {
    switch (cursorKey) {
      case 'trailAdditive': return this.inFreeListAdditive;
      case 'trailNormal': return this.inFreeListNormal;
      case 'towerFire': return this.inFreeListTowerFire;
    }
  }

  /** Push a dead particle's index back onto the free-list (if not already there) */
  private returnToFreeList(idx: number, cursorKey: keyof typeof this.poolCursors): void {
    const inFreeList = this.getInFreeList(cursorKey);
    if (!inFreeList[idx]) {
      inFreeList[idx] = 1;
      this.getFreeList(cursorKey).push(idx);
    }
  }

  // Debug spheres for visualization
  private debugSpheres: Mesh[] = [];

  /**
   * Spawn a debug sphere at a position (for debugging fire placement etc.)
   * Uses localY directly (not geo height)
   */
  spawnDebugSphere(
    lat: number,
    lon: number,
    localY: number,
    radius = 2,
    color = 0x00ff00
  ): void {
    const localXZ = this.sync.geoToLocalSimple(lat, lon, 0);

    const geometry = new SphereGeometry(radius, 16, 16);
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      depthTest: true,
    });
    const sphere = new Mesh(geometry, material);
    sphere.position.set(localXZ.x, localY, localXZ.z);
    sphere.renderOrder = 100;

    this.scene.add(sphere);
    this.debugSpheres.push(sphere);
  }

  /**
   * Set visibility of all debug spheres
   */
  setDebugSpheresVisible(visible: boolean): void {
    for (const sphere of this.debugSpheres) {
      sphere.visible = visible;
    }
  }

  /**
   * Clear all debug spheres
   */
  clearDebugSpheres(): void {
    for (const sphere of this.debugSpheres) {
      this.scene.remove(sphere);
      sphere.geometry.dispose();
      (sphere.material as Material).dispose();
    }
    this.debugSpheres = [];
  }

  /**
   * Clear all effects
   */
  clear(): void {
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

    this.activeEffects.clear();
    this.activeTowerFires.clear();

    // Clear frost auras
    for (const [, aura] of this.activeFrostAuras) {
      for (const p of aura.particles) {
        p.life = 0;
      }
    }
    this.activeFrostAuras.clear();

    // Clear poison auras
    for (const [, aura] of this.activePoisonAuras) {
      for (const p of aura.particles) {
        p.life = 0;
      }
    }
    this.activePoisonAuras.clear();

    // Clear instanced decals
    if (this.bloodDecalManager) {
      this.bloodDecalManager.clear();
    }
    if (this.iceDecalManager) {
      this.iceDecalManager.clear();
    }

    // Clear GPU-instanced floating texts
    this.floatingTextManager.clear();

    // Clear debug spheres
    this.clearDebugSpheres();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.clear();

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

    // Dispose instanced decal managers
    if (this.bloodDecalManager) {
      this.scene.remove(this.bloodDecalManager.instancedMesh);
      this.bloodDecalManager.dispose();
    }
    if (this.iceDecalManager) {
      this.scene.remove(this.iceDecalManager.instancedMesh);
      this.iceDecalManager.dispose();
    }

    // Dispose GPU-instanced floating texts
    this.floatingTextManager.dispose();

    this.trailMaterialAdditive?.dispose();
    this.trailMaterialNormal?.dispose();
    this.trailShaderMaterialAdditive?.dispose();
    this.trailShaderMaterialNormal?.dispose();

    // Dispose sprite-sheet atlas textures
    this.explosionAtlas?.dispose();
    this.smokeAtlas?.dispose();
  }
}
