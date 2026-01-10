import * as THREE from 'three';
import { CoordinateSync } from './index';

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

  // Blood decal pool (persistent ground stains)
  private bloodDecals: BloodDecal[] = [];
  private readonly MAX_BLOOD_DECALS = 100;
  private readonly DECAL_FADE_DELAY = 20000; // Start fading after 20 seconds
  private readonly DECAL_FADE_DURATION = 10000; // Fade out over 10 seconds
  private decalIdCounter = 0;
  private bloodDecalGeometry: THREE.CircleGeometry;
  private bloodDecalMaterial: THREE.MeshBasicMaterial;

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

    // Create blood decal geometry and material (for persistent ground stains)
    this.bloodDecalGeometry = new THREE.CircleGeometry(1, 16);
    this.bloodDecalMaterial = new THREE.MeshBasicMaterial({
      color: 0x8b0000, // Dark red
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
    decal.mesh.position.y += 0.05; // Slightly above ground to avoid z-fighting

    // Random rotation around Y axis for variety
    decal.mesh.rotation.z = Math.random() * Math.PI * 2;

    // Apply size with some randomness
    const finalSize = size * (0.8 + Math.random() * 0.4);
    decal.mesh.scale.set(finalSize, finalSize, 1);

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
    this.activeEffects.clear();

    // Hide all blood decals
    for (const decal of this.bloodDecals) {
      decal.active = false;
      decal.mesh.visible = false;
    }

    // Hide all floating texts
    for (const textInstance of this.floatingTexts) {
      textInstance.active = false;
      textInstance.sprite.visible = false;
    }
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

    // Dispose blood decals
    for (const decal of this.bloodDecals) {
      this.scene.remove(decal.mesh);
      (decal.mesh.material as THREE.Material).dispose();
    }
    this.bloodDecals = [];

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
    this.bloodDecalGeometry.dispose();
    this.bloodDecalMaterial.dispose();
  }
}
