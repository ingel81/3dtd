import * as THREE from 'three';
import { CoordinateSync } from './index';
import { TrailParticleConfig } from '../../configs/projectile-types.config';

/**
 * Particle data for GPU
 */
interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
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
  localPosition: THREE.Vector3;
}

/**
 * Blood decal instance (persistent ground stain)
 */
interface BloodDecal {
  id: string;
  mesh: THREE.Mesh;
  spawnTime: number;
  fadeStartTime: number;
  fadeDuration: number;
  active: boolean;
}

/**
 * Ice decal instance (temporary ground frost)
 */
interface IceDecal {
  id: string;
  mesh: THREE.Mesh;
  spawnTime: number;
  fadeStartTime: number;
  fadeDuration: number;
  active: boolean;
}

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
 * Active floating text instance
 */
interface FloatingTextInstance {
  id: string;
  sprite: THREE.Sprite;
  startTime: number;
  duration: number;
  floatSpeed: number;
  startY: number;
  active: boolean;
}

/**
 * ThreeEffectsRenderer - Renders particle effects using Three.js
 *
 * Effects:
 * - Blood splatter (on enemy hit)
 * - Fire/smoke (on base damage)
 * - Explosions (on projectile impact)
 *
 * Uses THREE.Points with custom shader for GPU-accelerated particles.
 */
export class ThreeEffectsRenderer {
  private scene: THREE.Scene;
  private sync: CoordinateSync;

  // Particle systems
  private bloodParticles: THREE.Points | null = null;
  private fireParticles: THREE.Points | null = null;

  // Active effects
  private activeEffects = new Map<string, EffectInstance>();
  private effectIdCounter = 0;

  // Blood particle pool
  private bloodPool: Particle[] = [];
  private readonly MAX_BLOOD_PARTICLES = 1000;

  // Fire particle pool
  private firePool: Particle[] = [];
  private readonly MAX_FIRE_PARTICLES = 2000;

  // Trail particle pools (additive for fire/glow, normal for smoke)
  private trailPoolAdditive: Particle[] = [];
  private trailPoolNormal: Particle[] = [];
  private readonly MAX_TRAIL_PARTICLES_PER_POOL = 1000;
  private trailParticlesAdditive: THREE.Points | null = null;
  private trailParticlesNormal: THREE.Points | null = null;
  private trailMaterialAdditive: THREE.PointsMaterial | null = null;
  private trailMaterialNormal: THREE.PointsMaterial | null = null;

  // ShaderMaterial alternatives with per-particle size and log depth support
  private trailShaderMaterialAdditive: THREE.ShaderMaterial | null = null;
  private trailShaderMaterialNormal: THREE.ShaderMaterial | null = null;
  private useShaderMaterial = true; // Default to ShaderMaterial (per-particle sizes, soft edges)

  // Blood decal pool (persistent ground stains)
  private bloodDecals: BloodDecal[] = [];
  private readonly MAX_BLOOD_DECALS = 100;
  private readonly DECAL_FADE_DELAY = 20000; // Start fading after 20 seconds
  private readonly DECAL_FADE_DURATION = 10000; // Fade out over 10 seconds
  private decalIdCounter = 0;
  private bloodDecalGeometry: THREE.CircleGeometry;
  private bloodDecalMaterial: THREE.MeshBasicMaterial;

  // Ice decal pool (temporary frost patches)
  private iceDecals: IceDecal[] = [];
  private readonly MAX_ICE_DECALS = 150; // More ice decals allowed
  private readonly ICE_DECAL_FADE_DELAY = 4000; // Start fading after 4 seconds
  private readonly ICE_DECAL_FADE_DURATION = 3000; // Fade out over 3 seconds
  private iceDecalIdCounter = 0;
  private iceDecalGeometry!: THREE.CircleGeometry;
  private iceDecalMaterial!: THREE.MeshBasicMaterial;

  // Floating text pool
  private floatingTexts: FloatingTextInstance[] = [];
  private readonly MAX_FLOATING_TEXTS = 50;
  private floatingTextIdCounter = 0;

  // Shared materials
  private bloodMaterial: THREE.PointsMaterial;
  private fireMaterial: THREE.PointsMaterial;

  constructor(scene: THREE.Scene, sync: CoordinateSync) {
    this.scene = scene;
    this.sync = sync;

    // Create blood material
    this.bloodMaterial = new THREE.PointsMaterial({
      color: 0xcc0000,
      size: 0.5,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      depthWrite: false,
    });

    // Create fire material
    this.fireMaterial = new THREE.PointsMaterial({
      color: 0xff6600,
      size: 1.0,
      transparent: true,
      opacity: 0.7,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    // PointsMaterial for additive blending (fire, tracers, glow effects)
    // Note: PointsMaterial works correctly with 3D tiles, ShaderMaterial has depth issues
    this.trailMaterialAdditive = new THREE.PointsMaterial({
      size: 1.5,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    // PointsMaterial for normal blending (smoke, opaque particles)
    this.trailMaterialNormal = new THREE.PointsMaterial({
      size: 2.0,
      transparent: true,
      opacity: 0.7,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexColors: true,
    });

    // ShaderMaterial with logarithmic depth buffer support and per-particle sizes
    // This is required for custom shaders to work with 3D Tiles (which use log depth)
    this.initShaderMaterials();

    // Create blood decal geometry and material (for persistent ground stains)
    this.bloodDecalGeometry = new THREE.CircleGeometry(1, 16);
    this.bloodDecalMaterial = new THREE.MeshBasicMaterial({
      color: 0x8b0000, // Dark red
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // Create ice decal geometry and material (for temporary frost patches)
    this.iceDecalGeometry = new THREE.CircleGeometry(1, 16);
    this.iceDecalMaterial = new THREE.MeshBasicMaterial({
      color: 0xc0f0ff, // Very light cyan/almost white ice
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.initParticleSystems();
  }

  /**
   * Initialize particle systems
   */
  private initParticleSystems(): void {
    // Blood particles
    const bloodGeometry = new THREE.BufferGeometry();
    const bloodPositions = new Float32Array(this.MAX_BLOOD_PARTICLES * 3);
    const bloodColors = new Float32Array(this.MAX_BLOOD_PARTICLES * 3);

    bloodGeometry.setAttribute('position', new THREE.BufferAttribute(bloodPositions, 3));
    bloodGeometry.setAttribute('color', new THREE.BufferAttribute(bloodColors, 3));

    this.bloodParticles = new THREE.Points(bloodGeometry, this.bloodMaterial);
    this.bloodParticles.frustumCulled = false;
    this.bloodParticles.renderOrder = 999; // Render after 3D tiles
    this.scene.add(this.bloodParticles);

    // Initialize blood pool
    for (let i = 0; i < this.MAX_BLOOD_PARTICLES; i++) {
      this.bloodPool.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        size: 0.3,
        color: new THREE.Color(0xcc0000),
      });
    }

    // Fire particles
    const fireGeometry = new THREE.BufferGeometry();
    const firePositions = new Float32Array(this.MAX_FIRE_PARTICLES * 3);
    const fireColors = new Float32Array(this.MAX_FIRE_PARTICLES * 3);

    fireGeometry.setAttribute('position', new THREE.BufferAttribute(firePositions, 3));
    fireGeometry.setAttribute('color', new THREE.BufferAttribute(fireColors, 3));

    this.fireParticles = new THREE.Points(fireGeometry, this.fireMaterial);
    this.fireParticles.frustumCulled = false;
    this.fireParticles.renderOrder = 999; // Render after 3D tiles
    this.scene.add(this.fireParticles);

    // Initialize fire pool
    for (let i = 0; i < this.MAX_FIRE_PARTICLES; i++) {
      this.firePool.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        size: 1.0,
        color: new THREE.Color(0xff6600),
      });
    }

    // Trail particles - ADDITIVE pool (for fire, tracers, glow effects)
    const trailGeometryAdditive = new THREE.BufferGeometry();
    const trailPositionsAdditive = new Float32Array(this.MAX_TRAIL_PARTICLES_PER_POOL * 3);
    const trailSizesAdditive = new Float32Array(this.MAX_TRAIL_PARTICLES_PER_POOL);
    const trailColorsAdditive = new Float32Array(this.MAX_TRAIL_PARTICLES_PER_POOL * 3);

    trailGeometryAdditive.setAttribute('position', new THREE.BufferAttribute(trailPositionsAdditive, 3));
    trailGeometryAdditive.setAttribute('size', new THREE.BufferAttribute(trailSizesAdditive, 1));
    trailGeometryAdditive.setAttribute('color', new THREE.BufferAttribute(trailColorsAdditive, 3));

    // Use ShaderMaterial by default for per-particle sizes and soft edges
    const additiveMaterial = this.useShaderMaterial
      ? this.trailShaderMaterialAdditive!
      : this.trailMaterialAdditive!;
    this.trailParticlesAdditive = new THREE.Points(trailGeometryAdditive, additiveMaterial);
    this.trailParticlesAdditive.frustumCulled = false;
    this.trailParticlesAdditive.renderOrder = 999; // Render after 3D tiles
    this.scene.add(this.trailParticlesAdditive);

    // Initialize additive trail pool
    for (let i = 0; i < this.MAX_TRAIL_PARTICLES_PER_POOL; i++) {
      this.trailPoolAdditive.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0.5,
        size: 1.5,
        color: new THREE.Color(0xff8800),
      });
    }

    // Trail particles - NORMAL pool (for smoke, dust effects)
    const trailGeometryNormal = new THREE.BufferGeometry();
    const trailPositionsNormal = new Float32Array(this.MAX_TRAIL_PARTICLES_PER_POOL * 3);
    const trailSizesNormal = new Float32Array(this.MAX_TRAIL_PARTICLES_PER_POOL);
    const trailColorsNormal = new Float32Array(this.MAX_TRAIL_PARTICLES_PER_POOL * 3);

    trailGeometryNormal.setAttribute('position', new THREE.BufferAttribute(trailPositionsNormal, 3));
    trailGeometryNormal.setAttribute('size', new THREE.BufferAttribute(trailSizesNormal, 1));
    trailGeometryNormal.setAttribute('color', new THREE.BufferAttribute(trailColorsNormal, 3));

    // Use ShaderMaterial by default for per-particle sizes and soft edges
    const normalMaterial = this.useShaderMaterial
      ? this.trailShaderMaterialNormal!
      : this.trailMaterialNormal!;
    this.trailParticlesNormal = new THREE.Points(trailGeometryNormal, normalMaterial);
    this.trailParticlesNormal.frustumCulled = false;
    this.trailParticlesNormal.renderOrder = 999; // Render after 3D tiles
    this.scene.add(this.trailParticlesNormal);

    // Initialize normal trail pool
    for (let i = 0; i < this.MAX_TRAIL_PARTICLES_PER_POOL; i++) {
      this.trailPoolNormal.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0.5,
        size: 1.5,
        color: new THREE.Color(0x888888),
      });
    }
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
    // Vertex shader with per-particle size and log depth support
    const vertexShader = /* glsl */ `
      attribute float size;
      varying vec3 vColor;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

        // Size attenuation: larger particles when closer
        gl_PointSize = size * (3000.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `;

    // Fragment shader for additive blending (fire, tracers, glow)
    const fragmentShaderAdditive = /* glsl */ `
      varying vec3 vColor;

      #include <logdepthbuf_pars_fragment>

      void main() {
        // Circular particle with soft edges
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        if (dist > 0.5) discard;

        // Soft falloff from center
        float alpha = 1.0 - smoothstep(0.0, 0.5, dist);

        // Additive: color * alpha, alpha for blending
        gl_FragColor = vec4(vColor * alpha, alpha);

        #include <logdepthbuf_fragment>
      }
    `;

    // Fragment shader for normal blending (smoke, dust)
    const fragmentShaderNormal = /* glsl */ `
      varying vec3 vColor;

      #include <logdepthbuf_pars_fragment>

      void main() {
        // Circular particle with soft edges
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        if (dist > 0.5) discard;

        // Soft falloff from center
        float alpha = 0.7 * (1.0 - smoothstep(0.3, 0.5, dist));

        // Normal blending: opaque color with alpha
        gl_FragColor = vec4(vColor, alpha);

        #include <logdepthbuf_fragment>
      }
    `;

    // Create additive ShaderMaterial
    this.trailShaderMaterialAdditive = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: fragmentShaderAdditive,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    // Create normal ShaderMaterial
    this.trailShaderMaterialNormal = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: fragmentShaderNormal,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexColors: true,
    });

    console.log('[ThreeEffectsRenderer] ShaderMaterials with log depth support initialized');
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
   * Spawn blood splatter effect at a position
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param count - Number of particles (default 20)
   */
  spawnBloodSplatter(lat: number, lon: number, height: number, count: number = 20): string {
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
    for (let i = 0; i < count && effect.particles.length < this.MAX_BLOOD_PARTICLES; i++) {
      const particle = this.getInactiveParticle(this.bloodPool);
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
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height (terrain height)
   * @param size - Size of the decal (0.5-3.0 meters, default 1.0)
   * @returns Decal ID
   */
  spawnBloodDecal(lat: number, lon: number, height: number, size: number = 1.0): string {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    const id = `decal_${this.decalIdCounter++}`;

    // Check if we have room for more decals
    let decal = this.bloodDecals.find((d) => !d.active);

    if (!decal) {
      // Pool is full - either reuse oldest or create new if under limit
      if (this.bloodDecals.length >= this.MAX_BLOOD_DECALS) {
        // Find and reuse the oldest decal
        let oldest = this.bloodDecals[0];
        for (const d of this.bloodDecals) {
          if (d.spawnTime < oldest.spawnTime) {
            oldest = d;
          }
        }
        decal = oldest;
      } else {
        // Create new decal mesh
        const mesh = new THREE.Mesh(
          this.bloodDecalGeometry,
          this.bloodDecalMaterial.clone() // Clone material for individual opacity
        );
        mesh.rotation.x = -Math.PI / 2; // Lay flat on ground
        this.scene.add(mesh);

        decal = {
          id: '',
          mesh,
          spawnTime: 0,
          fadeStartTime: 0,
          fadeDuration: this.DECAL_FADE_DURATION,
          active: false,
        };
        this.bloodDecals.push(decal);
      }
    }

    // Configure decal
    decal.id = id;
    decal.active = true;
    decal.spawnTime = performance.now();
    decal.fadeStartTime = decal.spawnTime + this.DECAL_FADE_DELAY;

    // Set position and size
    decal.mesh.position.copy(localPos);
    decal.mesh.position.y += 0.12; // Above ground to avoid z-fighting

    // Random rotation around Y axis for variety
    decal.mesh.rotation.z = Math.random() * Math.PI * 2;

    // Apply size with randomness - ellipse shape for puddle effect
    const baseSize = size * (0.8 + Math.random() * 0.4);
    const stretchFactor = 0.6 + Math.random() * 0.8; // 0.6 to 1.4 ratio
    decal.mesh.scale.set(baseSize * stretchFactor, baseSize / stretchFactor, 1);

    // Reset opacity
    (decal.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7;
    decal.mesh.visible = true;

    // Randomize color slightly (dark red variations)
    const colorVariation = Math.random() * 0.2;
    (decal.mesh.material as THREE.MeshBasicMaterial).color.setRGB(
      0.55 + colorVariation,
      0,
      0
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

    const intensityConfig = {
      tiny: { count: 10, radius: 1, duration: 3000 },
      small: { count: 30, radius: 2, duration: 5000 },
      medium: { count: 60, radius: 3, duration: 8000 },
      large: { count: 100, radius: 5, duration: 10000 },
      inferno: { count: 200, radius: 8, duration: -1 }, // -1 = infinite
    };

    const config = intensityConfig[intensity];

    const effect: EffectInstance = {
      id,
      type: 'fire',
      particles: [],
      startTime: performance.now(),
      duration: config.duration,
      localPosition: localPos.clone(),
    };

    // Spawn particles
    for (let i = 0; i < config.count && effect.particles.length < this.MAX_FIRE_PARTICLES; i++) {
      const particle = this.getInactiveParticle(this.firePool);
      if (!particle) break;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * config.radius;

      particle.position.copy(localPos);
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;

      particle.velocity.set(
        (Math.random() - 0.5) * 2,
        2 + Math.random() * 4, // Upward
        (Math.random() - 0.5) * 2
      );
      particle.life = 1.0;
      particle.maxLife = 0.5 + Math.random() * 1.0;
      particle.size = 0.5 + Math.random() * 1.5;

      // Fire colors (yellow to red)
      const t = Math.random();
      particle.color.setRGB(1, 0.3 + t * 0.5, t * 0.2);

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
    heightOffset: number = 0
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
    const localPos = new THREE.Vector3(localXZ.x, localY, localXZ.z);

    const id = `fire_${this.effectIdCounter++}`;

    const intensityConfig = {
      tiny: { count: 10, radius: 1, duration: 3000 },
      small: { count: 30, radius: 2, duration: 5000 },
      medium: { count: 60, radius: 3, duration: 8000 },
      large: { count: 100, radius: 5, duration: 10000 },
      inferno: { count: 200, radius: 8, duration: -1 },
    };

    const config = intensityConfig[intensity];

    const effect: EffectInstance = {
      id,
      type: 'fire',
      particles: [],
      startTime: performance.now(),
      duration: config.duration,
      localPosition: localPos.clone(),
    };

    for (let i = 0; i < config.count && effect.particles.length < this.MAX_FIRE_PARTICLES; i++) {
      const particle = this.getInactiveParticle(this.firePool);
      if (!particle) break;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * config.radius;

      particle.position.copy(localPos);
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;

      particle.velocity.set(
        (Math.random() - 0.5) * 2,
        2 + Math.random() * 4,
        (Math.random() - 0.5) * 2
      );
      particle.life = 1.0;
      particle.maxLife = 0.5 + Math.random() * 1.0;
      particle.size = 0.5 + Math.random() * 1.5;

      const t = Math.random();
      particle.color.setRGB(1, 0.3 + t * 0.5, t * 0.2);

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
    for (const [id, effect] of this.activeEffects) {
      if (effect.type === 'fire') {
        effect.duration = 500;
        effect.startTime = performance.now();
      }
    }
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
  spawnRocketTrail(localX: number, localY: number, localZ: number, count: number = 3): void {
    for (let i = 0; i < count; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive);
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
  spawnRocketTrailAtGeo(lat: number, lon: number, height: number, count: number = 3): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnRocketTrail(localPos.x, localPos.y, localPos.z, count);
  }

  /**
   * Spawn bullet tracer effect at local position
   * Much smaller and faster-fading than rocket trails
   * Uses ADDITIVE blending (bright tracer effect)
   */
  spawnBulletTracer(localX: number, localY: number, localZ: number, count: number = 1): void {
    for (let i = 0; i < count; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive);
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
  spawnBulletTracerAtGeo(lat: number, lon: number, height: number, count: number = 1): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnBulletTracer(localPos.x, localPos.y, localPos.z, count);
  }

  /**
   * Spawn subtle cannon smoke at local position
   * Very subtle black/dark grey particles for cannonball trails
   * Uses NORMAL blending (opaque smoke effect)
   */
  spawnCannonSmoke(localX: number, localY: number, localZ: number, count: number = 1): void {
    for (let i = 0; i < count; i++) {
      const particle = this.getInactiveParticle(this.trailPoolNormal);
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
  spawnCannonSmokeAtGeo(lat: number, lon: number, height: number, count: number = 1): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnCannonSmoke(localPos.x, localPos.y, localPos.z, count);
  }

  /**
   * Spawn configurable trail particles based on TrailParticleConfig
   * Generic method that uses config values instead of hardcoded parameters
   * Automatically chooses additive or normal blending pool based on config.blending
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

    for (let i = 0; i < config.countPerSpawn; i++) {
      const particle = this.getInactiveParticle(pool);
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
  spawnExplosion(localX: number, localY: number, localZ: number, count: number = 25, radius: number = 5): void {
    for (let i = 0; i < count; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive);
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
      particle.maxLife = 0.2 + Math.random() * 0.3; // 0.2-0.5 seconds (fast explosion)
      particle.size = 1.5 + Math.random() * 2.0; // 1.5-3.5 size (bigger than trail)

      // Orange/red/yellow explosion colors
      const t = Math.random();
      if (t < 0.3) {
        // Yellow core
        particle.color.setRGB(1, 0.9, 0.3);
      } else if (t < 0.7) {
        // Orange
        particle.color.setRGB(1, 0.5, 0.1);
      } else {
        // Red edges
        particle.color.setRGB(1, 0.2, 0.05);
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
  spawnExplosionAtGeo(lat: number, lon: number, height: number, count: number = 25): void {
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
  spawnIceExplosion(localX: number, localY: number, localZ: number, count: number = 20): void {
    for (let i = 0; i < count; i++) {
      const particle = this.getInactiveParticle(this.trailPoolAdditive);
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
  spawnIceExplosionAtGeo(lat: number, lon: number, height: number, count: number = 20): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnIceExplosion(localPos.x, localPos.y, localPos.z, count);
  }

  /**
   * Spawn ice decal on ground (frost patch)
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Terrain height
   * @param size - Size of the decal (1.0-4.0 meters, default 2.0)
   * @returns Decal ID
   */
  spawnIceDecal(lat: number, lon: number, height: number, size: number = 2.0): string {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    const id = `ice_decal_${this.iceDecalIdCounter++}`;

    // Check if we have room for more decals
    let decal = this.iceDecals.find((d) => !d.active);

    if (!decal) {
      // Pool is full - either reuse oldest or create new if under limit
      if (this.iceDecals.length >= this.MAX_ICE_DECALS) {
        // Find and reuse the oldest decal
        let oldest = this.iceDecals[0];
        for (const d of this.iceDecals) {
          if (d.spawnTime < oldest.spawnTime) {
            oldest = d;
          }
        }
        decal = oldest;
      } else {
        // Create new decal mesh
        const mesh = new THREE.Mesh(
          this.iceDecalGeometry,
          this.iceDecalMaterial.clone() // Clone material for individual opacity
        );
        mesh.rotation.x = -Math.PI / 2; // Lay flat on ground
        this.scene.add(mesh);

        decal = {
          id: '',
          mesh,
          spawnTime: 0,
          fadeStartTime: 0,
          fadeDuration: this.ICE_DECAL_FADE_DURATION,
          active: false,
        };
        this.iceDecals.push(decal);
      }
    }

    // Configure decal
    decal.id = id;
    decal.active = true;
    decal.spawnTime = performance.now();
    decal.fadeStartTime = decal.spawnTime + this.ICE_DECAL_FADE_DELAY;

    // Set position and size
    decal.mesh.position.copy(localPos);
    decal.mesh.position.y += 0.12; // Above ground to avoid z-fighting

    // Random rotation around Y axis for variety
    decal.mesh.rotation.z = Math.random() * Math.PI * 2;

    // Apply size with randomness - ellipse shape for puddle effect
    const baseSize = size * (0.8 + Math.random() * 0.4);
    const stretchFactor = 0.6 + Math.random() * 0.8; // 0.6 to 1.4 ratio
    decal.mesh.scale.set(baseSize * stretchFactor, baseSize / stretchFactor, 1);

    // Reset opacity
    (decal.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7;
    decal.mesh.visible = true;

    // Randomize color slightly (very light cyan/white variations)
    const colorVariation = Math.random() * 0.1;
    (decal.mesh.material as THREE.MeshBasicMaterial).color.setRGB(
      0.75 + colorVariation, // More white
      0.94 + colorVariation * 0.5,
      1.0
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
  ): string {
    const {
      color = '#FFD700', // Gold
      fontSize = 48,
      duration = 1000,
      floatSpeed = 2,
      scale = 1,
      outlineColor = '#000000',
      outlineWidth = 3,
    } = config;

    const localPos = this.sync.geoToLocal(lat, lon, height);
    const id = `text_${this.floatingTextIdCounter++}`;

    // Try to reuse inactive sprite
    let instance = this.floatingTexts.find((t) => !t.active);

    if (!instance) {
      if (this.floatingTexts.length >= this.MAX_FLOATING_TEXTS) {
        // Reuse oldest
        let oldest = this.floatingTexts[0];
        for (const t of this.floatingTexts) {
          if (t.startTime < oldest.startTime) {
            oldest = t;
          }
        }
        instance = oldest;
      } else {
        // Create new sprite
        const spriteMaterial = new THREE.SpriteMaterial({
          transparent: true,
          depthTest: false,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        this.scene.add(sprite);

        instance = {
          id: '',
          sprite,
          startTime: 0,
          duration: 0,
          floatSpeed: 0,
          startY: 0,
          active: false,
        };
        this.floatingTexts.push(instance);
      }
    }

    // Create text texture
    const texture = this.createTextTexture(text, color, fontSize, outlineColor, outlineWidth);
    const material = instance.sprite.material as THREE.SpriteMaterial;

    // Dispose old texture if exists
    if (material.map) {
      material.map.dispose();
    }

    material.map = texture;
    material.opacity = 1;
    material.needsUpdate = true;

    // Calculate sprite size based on text
    const aspect = texture.image.width / texture.image.height;
    const baseSize = scale * 3; // Base size in world units
    instance.sprite.scale.set(baseSize * aspect, baseSize, 1);

    // Position sprite
    instance.sprite.position.copy(localPos);
    instance.sprite.visible = true;

    // Configure instance
    instance.id = id;
    instance.startTime = performance.now();
    instance.duration = duration;
    instance.floatSpeed = floatSpeed;
    instance.startY = localPos.y;
    instance.active = true;

    return id;
  }

  /**
   * Create a canvas texture with text
   */
  private createTextTexture(
    text: string,
    color: string,
    fontSize: number,
    outlineColor: string,
    outlineWidth: number
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    // Set font to measure text
    const font = `bold ${fontSize}px Arial, sans-serif`;
    ctx.font = font;
    const metrics = ctx.measureText(text);

    // Canvas size with padding for outline
    const padding = outlineWidth * 2 + 4;
    canvas.width = Math.ceil(metrics.width) + padding * 2;
    canvas.height = fontSize + padding * 2;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Set font again after resize
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Draw outline
    if (outlineWidth > 0) {
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = outlineWidth;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, centerX, centerY);
    }

    // Draw fill
    ctx.fillStyle = color;
    ctx.fillText(text, centerX, centerY);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    return texture;
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

        // Update position
        particle.position.add(particle.velocity.clone().multiplyScalar(dt));

        // Apply gravity (blood falls, fire rises)
        if (effect.type === 'blood') {
          particle.velocity.y += gravity * dt;
        }

        // Decay life
        particle.life -= dt / particle.maxLife;

        // Respawn fire particles
        if (effect.type === 'fire' && particle.life <= 0 && effect.duration < 0) {
          // Infinite fire - respawn
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * 5;

          particle.position.copy(effect.localPosition);
          particle.position.x += Math.cos(angle) * radius;
          particle.position.z += Math.sin(angle) * radius;

          particle.velocity.set(
            (Math.random() - 0.5) * 2,
            2 + Math.random() * 4,
            (Math.random() - 0.5) * 2
          );
          particle.life = 1.0;
        }
      }
    }

    // Update blood decals (fading)
    for (const decal of this.bloodDecals) {
      if (!decal.active) continue;

      const elapsed = now - decal.fadeStartTime;

      if (elapsed > 0) {
        // Calculate fade progress (0-1)
        const fadeProgress = Math.min(elapsed / decal.fadeDuration, 1);
        const opacity = 0.7 * (1 - fadeProgress);

        (decal.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;

        // Mark as inactive when fully faded
        if (fadeProgress >= 1) {
          decal.active = false;
          decal.mesh.visible = false;
        }
      }
    }

    // Update ice decals (faster fading)
    for (const decal of this.iceDecals) {
      if (!decal.active) continue;

      const elapsed = now - decal.fadeStartTime;

      if (elapsed > 0) {
        // Calculate fade progress (0-1)
        const fadeProgress = Math.min(elapsed / decal.fadeDuration, 1);
        const opacity = 0.6 * (1 - fadeProgress);

        (decal.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;

        // Mark as inactive when fully faded
        if (fadeProgress >= 1) {
          decal.active = false;
          decal.mesh.visible = false;
        }
      }
    }

    // Update floating texts (rise + fade)
    for (const textInstance of this.floatingTexts) {
      if (!textInstance.active) continue;

      const elapsed = now - textInstance.startTime;
      const progress = Math.min(elapsed / textInstance.duration, 1);

      // Float upward
      textInstance.sprite.position.y = textInstance.startY + progress * textInstance.floatSpeed * 3;

      // Fade out (start fading at 50% progress)
      const fadeProgress = Math.max(0, (progress - 0.5) * 2);
      (textInstance.sprite.material as THREE.SpriteMaterial).opacity = 1 - fadeProgress;

      // Scale up slightly as it rises
      const scaleMultiplier = 1 + progress * 0.3;
      const baseScale = textInstance.sprite.scale.clone();
      textInstance.sprite.scale.setScalar(scaleMultiplier);
      // Preserve aspect ratio
      const aspect = baseScale.x / baseScale.y;
      textInstance.sprite.scale.x = textInstance.sprite.scale.y * aspect;

      // Mark as inactive when done
      if (progress >= 1) {
        textInstance.active = false;
        textInstance.sprite.visible = false;
      }
    }

    // Update trail particles - ADDITIVE pool (independent of effects system)
    for (const particle of this.trailPoolAdditive) {
      if (particle.life <= 0) continue;

      // Update position
      particle.position.add(particle.velocity.clone().multiplyScalar(dt));

      // Decay life
      particle.life -= dt / particle.maxLife;
    }

    // Update trail particles - NORMAL pool (independent of effects system)
    for (const particle of this.trailPoolNormal) {
      if (particle.life <= 0) continue;

      // Update position
      particle.position.add(particle.velocity.clone().multiplyScalar(dt));

      // Decay life
      particle.life -= dt / particle.maxLife;
    }

    // Update GPU buffers
    this.updateParticleBuffers();
  }

  /**
   * Update particle position buffers
   */
  private updateParticleBuffers(): void {
    // Update blood particles
    if (this.bloodParticles) {
      const positions = this.bloodParticles.geometry.attributes['position'] as THREE.BufferAttribute;
      const posArray = positions.array as Float32Array;

      let activeCount = 0;
      for (let i = 0; i < this.bloodPool.length; i++) {
        const p = this.bloodPool[i];
        if (p.life > 0) {
          posArray[activeCount * 3] = p.position.x;
          posArray[activeCount * 3 + 1] = p.position.y;
          posArray[activeCount * 3 + 2] = p.position.z;
          activeCount++;
        }
      }

      positions.needsUpdate = true;
      this.bloodParticles.geometry.setDrawRange(0, activeCount);
    }

    // Update fire particles
    if (this.fireParticles) {
      const positions = this.fireParticles.geometry.attributes['position'] as THREE.BufferAttribute;
      const posArray = positions.array as Float32Array;

      let activeCount = 0;
      for (let i = 0; i < this.firePool.length; i++) {
        const p = this.firePool[i];
        if (p.life > 0) {
          posArray[activeCount * 3] = p.position.x;
          posArray[activeCount * 3 + 1] = p.position.y;
          posArray[activeCount * 3 + 2] = p.position.z;
          activeCount++;
        }
      }

      positions.needsUpdate = true;
      this.fireParticles.geometry.setDrawRange(0, activeCount);
    }

    // Update trail particles - ADDITIVE pool
    if (this.trailParticlesAdditive) {
      const positions = this.trailParticlesAdditive.geometry.attributes['position'] as THREE.BufferAttribute;
      const sizes = this.trailParticlesAdditive.geometry.attributes['size'] as THREE.BufferAttribute;
      const colors = this.trailParticlesAdditive.geometry.attributes['color'] as THREE.BufferAttribute;
      const posArray = positions.array as Float32Array;
      const sizeArray = sizes.array as Float32Array;
      const colorArray = colors.array as Float32Array;

      let activeCount = 0;
      for (let i = 0; i < this.trailPoolAdditive.length; i++) {
        const p = this.trailPoolAdditive[i];
        if (p.life > 0) {
          posArray[activeCount * 3] = p.position.x;
          posArray[activeCount * 3 + 1] = p.position.y;
          posArray[activeCount * 3 + 2] = p.position.z;
          // Size decreases as particle fades
          sizeArray[activeCount] = p.size * p.life;
          // Per-particle color
          colorArray[activeCount * 3] = p.color.r;
          colorArray[activeCount * 3 + 1] = p.color.g;
          colorArray[activeCount * 3 + 2] = p.color.b;
          activeCount++;
        }
      }

      positions.needsUpdate = true;
      sizes.needsUpdate = true;
      colors.needsUpdate = true;
      this.trailParticlesAdditive.geometry.setDrawRange(0, activeCount);
    }

    // Update trail particles - NORMAL pool
    if (this.trailParticlesNormal) {
      const positions = this.trailParticlesNormal.geometry.attributes['position'] as THREE.BufferAttribute;
      const sizes = this.trailParticlesNormal.geometry.attributes['size'] as THREE.BufferAttribute;
      const colors = this.trailParticlesNormal.geometry.attributes['color'] as THREE.BufferAttribute;
      const posArray = positions.array as Float32Array;
      const sizeArray = sizes.array as Float32Array;
      const colorArray = colors.array as Float32Array;

      let activeCount = 0;
      for (let i = 0; i < this.trailPoolNormal.length; i++) {
        const p = this.trailPoolNormal[i];
        if (p.life > 0) {
          posArray[activeCount * 3] = p.position.x;
          posArray[activeCount * 3 + 1] = p.position.y;
          posArray[activeCount * 3 + 2] = p.position.z;
          // Size decreases as particle fades
          sizeArray[activeCount] = p.size * p.life;
          // Per-particle color
          colorArray[activeCount * 3] = p.color.r;
          colorArray[activeCount * 3 + 1] = p.color.g;
          colorArray[activeCount * 3 + 2] = p.color.b;
          activeCount++;
        }
      }

      positions.needsUpdate = true;
      sizes.needsUpdate = true;
      colors.needsUpdate = true;
      this.trailParticlesNormal.geometry.setDrawRange(0, activeCount);
    }
  }

  /**
   * Get an inactive particle from a pool
   */
  private getInactiveParticle(pool: Particle[]): Particle | null {
    for (const p of pool) {
      if (p.life <= 0) {
        return p;
      }
    }
    return null;
  }

  // Debug spheres for visualization
  private debugSpheres: THREE.Mesh[] = [];

  /**
   * Spawn a debug sphere at a position (for debugging fire placement etc.)
   * Uses localY directly (not geo height)
   */
  spawnDebugSphere(
    lat: number,
    lon: number,
    localY: number,
    radius: number = 2,
    color: number = 0x00ff00
  ): void {
    const localXZ = this.sync.geoToLocalSimple(lat, lon, 0);

    const geometry = new THREE.SphereGeometry(radius, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      depthTest: true,
    });
    const sphere = new THREE.Mesh(geometry, material);
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
      (sphere.material as THREE.Material).dispose();
    }
    this.debugSpheres = [];
  }

  /**
   * Clear all effects
   */
  clear(): void {
    // Reset all particles
    for (const p of this.bloodPool) {
      p.life = 0;
    }
    for (const p of this.firePool) {
      p.life = 0;
    }
    for (const p of this.trailPoolAdditive) {
      p.life = 0;
    }
    for (const p of this.trailPoolNormal) {
      p.life = 0;
    }
    this.activeEffects.clear();

    // Hide all blood decals
    for (const decal of this.bloodDecals) {
      decal.active = false;
      decal.mesh.visible = false;
    }

    // Hide all ice decals
    for (const decal of this.iceDecals) {
      decal.active = false;
      decal.mesh.visible = false;
    }

    // Hide all floating texts
    for (const textInstance of this.floatingTexts) {
      textInstance.active = false;
      textInstance.sprite.visible = false;
    }

    // Clear debug spheres
    this.clearDebugSpheres();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.clear();

    if (this.bloodParticles) {
      this.scene.remove(this.bloodParticles);
      this.bloodParticles.geometry.dispose();
    }
    if (this.fireParticles) {
      this.scene.remove(this.fireParticles);
      this.fireParticles.geometry.dispose();
    }
    if (this.trailParticlesAdditive) {
      this.scene.remove(this.trailParticlesAdditive);
      this.trailParticlesAdditive.geometry.dispose();
    }
    if (this.trailParticlesNormal) {
      this.scene.remove(this.trailParticlesNormal);
      this.trailParticlesNormal.geometry.dispose();
    }

    // Dispose blood decals
    for (const decal of this.bloodDecals) {
      this.scene.remove(decal.mesh);
      (decal.mesh.material as THREE.Material).dispose();
    }
    this.bloodDecals = [];

    // Dispose ice decals
    for (const decal of this.iceDecals) {
      this.scene.remove(decal.mesh);
      (decal.mesh.material as THREE.Material).dispose();
    }
    this.iceDecals = [];

    // Dispose floating texts
    for (const textInstance of this.floatingTexts) {
      this.scene.remove(textInstance.sprite);
      const material = textInstance.sprite.material as THREE.SpriteMaterial;
      if (material.map) {
        material.map.dispose();
      }
      material.dispose();
    }
    this.floatingTexts = [];

    this.bloodMaterial.dispose();
    this.fireMaterial.dispose();
    this.trailMaterialAdditive?.dispose();
    this.trailMaterialNormal?.dispose();
    this.bloodDecalGeometry.dispose();
    this.bloodDecalMaterial.dispose();
    this.iceDecalGeometry.dispose();
    this.iceDecalMaterial.dispose();
  }
}
