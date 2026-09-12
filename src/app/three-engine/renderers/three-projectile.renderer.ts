import {
  InstancedMesh,
  Matrix4,
  Vector3,
  Quaternion,
  BufferGeometry,
  Material,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  ShaderMaterial,
  Color,
  AdditiveBlending,
  DoubleSide,
  CylinderGeometry,
  ConeGeometry,
  BoxGeometry,
  Float32BufferAttribute,
  Euler,
  Scene,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CoordinateSync } from './index';
import {
  ProjectileTypeId,
  ProjectileVisualType,
  PROJECTILE_TYPES,
} from '../../configs/projectile-types.config';
import {
  MAGIC_ORB_VERTEX,
  MAGIC_ORB_FRAGMENT,
} from './magic-orb-shaders';
import { InstanceSlotAllocator } from './instance-slot-allocator';
import { DrawGate } from './draw-gate';

/**
 * Projectile render data
 */
export interface ProjectileRenderData {
  id: string;
  visualType: ProjectileVisualType;
}

/**
 * Simple instanced entity manager for projectiles
 */
export class ProjectileInstanceManager {
  readonly instancedMesh: InstancedMesh;
  private entities = new Map<string, number>(); // id -> instanceIndex
  private readonly slots: InstanceSlotAllocator;
  /** Hides the mesh while no projectile is in flight (R6). */
  private readonly gate: DrawGate;
  private readonly matrix = new Matrix4();
  /** Matrices written since the last flush(). */
  private matrixDirty = false;

  // Reusable vectors to avoid allocations in update loop
  private static readonly _tempPos = new Vector3();
  private static readonly _tempRot = new Quaternion();
  private static readonly _tempScale = new Vector3();

  constructor(
    geometry: BufferGeometry,
    material: Material,
    maxCount: number
  ) {
    this.instancedMesh = new InstancedMesh(geometry, material, maxCount);
    this.instancedMesh.count = 0;
    this.instancedMesh.frustumCulled = false;
    this.slots = new InstanceSlotAllocator(maxCount);
    this.gate = new DrawGate([this.instancedMesh]);
  }

  /** Skipped (not drawn) when all `maxCount` slots are in flight. */
  add(
    id: string,
    position: Vector3,
    rotation: Euler,
    scale: Vector3
  ): void {
    if (this.entities.has(id)) return;

    const index = this.slots.alloc();
    if (index < 0) return;

    this.entities.set(id, index);
    this.syncDrawCount();

    this.matrix.compose(
      position,
      ProjectileInstanceManager._tempRot.setFromEuler(rotation),
      scale
    );
    this.instancedMesh.setMatrixAt(index, this.matrix);
    this.matrixDirty = true;
  }

  update(id: string, position: Vector3, rotation: Euler): void {
    const index = this.entities.get(id);
    if (index === undefined) return;

    this.instancedMesh.getMatrixAt(index, this.matrix);
    this.matrix.decompose(
      ProjectileInstanceManager._tempPos,
      ProjectileInstanceManager._tempRot,
      ProjectileInstanceManager._tempScale
    );

    this.matrix.compose(
      position,
      ProjectileInstanceManager._tempRot.setFromEuler(rotation),
      ProjectileInstanceManager._tempScale
    );
    this.instancedMesh.setMatrixAt(index, this.matrix);
    this.matrixDirty = true;
  }

  /**
   * Update position only, keeping existing rotation and scale
   */
  updatePosition(id: string, position: Vector3): void {
    const index = this.entities.get(id);
    if (index === undefined) return;

    this.instancedMesh.getMatrixAt(index, this.matrix);
    this.matrix.decompose(
      ProjectileInstanceManager._tempPos,
      ProjectileInstanceManager._tempRot,
      ProjectileInstanceManager._tempScale
    );

    this.matrix.compose(
      position,
      ProjectileInstanceManager._tempRot,
      ProjectileInstanceManager._tempScale
    );
    this.instancedMesh.setMatrixAt(index, this.matrix);
    this.matrixDirty = true;
  }

  remove(id: string): void {
    const index = this.entities.get(id);
    if (index === undefined) return;

    // Move to infinity (hide)
    this.matrix.makeTranslation(0, -10000, 0);
    this.instancedMesh.setMatrixAt(index, this.matrix);
    this.matrixDirty = true;

    this.entities.delete(id);
    this.slots.release(index);
    this.syncDrawCount();
  }

  get count(): number {
    return this.entities.size;
  }

  /**
   * Upload the matrices written since the last flush, once per frame (see
   * ThreeProjectileRenderer.commitToGPU). (0, activeCount) covers every
   * drawn slot, so one range per frame replaces the full maxCount-sized
   * upload a bare needsUpdate would do. add/update/remove only set the flag:
   * a per-slot range on those paths would pile up while rendering is off
   * (headless training keeps creating and removing projectiles).
   */
  flush(): void {
    if (!this.matrixDirty) return;
    this.matrixDirty = false;
    // activeCount 0: nothing is drawn, and (0, 0) would upload the whole
    // buffer (bufferSubData reads a length of 0 as "to the end").
    const activeCount = this.slots.activeCount;
    if (activeCount === 0) return;
    const instanceMatrix = this.instancedMesh.instanceMatrix;
    instanceMatrix.clearUpdateRanges();
    instanceMatrix.addUpdateRange(0, activeCount * 16);
    instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    // No hide writes needed: count 0 draws nothing, and add() rewrites a
    // slot before the pool grows over it again.
    this.entities.clear();
    this.slots.reset();
    this.syncDrawCount();
    this.matrixDirty = false;
  }

  /** Draw count follows the slot allocator; the gate hides an empty pool. */
  private syncDrawCount(): void {
    this.instancedMesh.count = this.slots.activeCount;
    this.gate.setCount(this.slots.activeCount);
  }

  dispose(): void {
    this.clear();
    this.instancedMesh.geometry.dispose();
    (this.instancedMesh.material as Material).dispose();
  }
}

/**
 * Rocket mesh: nozzle, body, nose cone and four fins merged into one
 * geometry, so the rocket pool stays a single draw call. Each part carries
 * its colour as vertex colours (white body, red nose and fins, dark nozzle).
 *
 * Points +Y like the other projectile geometries (directionToEuler rotates
 * +Y onto the flight direction), 4.2 m long and centred on the projectile
 * position: the nozzle sits 2.1 m behind it, which is
 * PROJECTILE_TYPES.rocket.tailOffset.
 */
export function createRocketGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const addPart = (geometry: BufferGeometry, rgb: readonly [number, number, number]): void => {
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = rgb[0];
      colors[i * 3 + 1] = rgb[1];
      colors[i * 3 + 2] = rgb[2];
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    parts.push(geometry);
  };

  const white = [0.85, 0.85, 0.82] as const;
  const red = [0.75, 0.05, 0.03] as const;
  const darkRed = [0.55, 0.04, 0.03] as const;
  const nozzleGrey = [0.1, 0.1, 0.11] as const;

  // Nozzle (y -2.1 .. -1.85), slightly flared
  addPart(new CylinderGeometry(0.2, 0.26, 0.25, 12).translate(0, -1.975, 0), nozzleGrey);
  // Body (y -1.85 .. 1.05)
  addPart(new CylinderGeometry(0.3, 0.3, 2.9, 12).translate(0, -0.4, 0), white);
  // Nose cone (y 1.05 .. 2.1)
  addPart(new ConeGeometry(0.3, 1.05, 12).translate(0, 1.575, 0), red);
  // Four fins at the tail end of the body (y -1.85 .. -1.05), 0.5 m deep
  for (let i = 0; i < 4; i++) {
    addPart(
      new BoxGeometry(0.05, 0.8, 0.5).translate(0, -1.45, 0.55).rotateY((i * Math.PI) / 2),
      darkRed
    );
  }

  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('[ThreeProjectileRenderer] Rocket geometry merge failed');
  return merged;
}

/**
 * ThreeProjectileRenderer - Renders projectiles using GPU instancing
 */
export class ThreeProjectileRenderer {
  private scene: Scene;
  private sync: CoordinateSync;
  private loader: GLTFLoader;

  // Instanced managers per visual type
  private arrowManager: ProjectileInstanceManager | null = null;
  private cannonballManager: ProjectileInstanceManager;
  private magicManager: ProjectileInstanceManager;
  private iceManager: ProjectileInstanceManager;
  private bulletManager: ProjectileInstanceManager;
  private rocketManager: ProjectileInstanceManager;
  private poisonManager: ProjectileInstanceManager;
  private chaosManager: ProjectileInstanceManager;

  // Track which manager owns each projectile
  private projectileTypes = new Map<string, ProjectileVisualType>();

  // Model loading state
  private arrowModelLoaded = false;
  /** Settles once the arrow pool exists, from the model or the fallback. */
  private readonly arrowLoad: Promise<void>;

  constructor(scene: Scene, sync: CoordinateSync) {
    this.scene = scene;
    this.sync = sync;
    this.loader = new GLTFLoader();

    // Create instanced managers for each visual type
    this.cannonballManager = this.createCannonballManager();
    this.magicManager = this.createMagicManager();
    this.iceManager = this.createIceManager();
    this.bulletManager = this.createBulletManager();
    this.rocketManager = this.createRocketManager();
    this.poisonManager = this.createPoisonManager();
    this.chaosManager = this.createChaosManager();

    // Load arrow model async
    this.arrowLoad = this.loadArrowModel();

    // Add meshes to scene
    // Arrow will be added when model loads
    scene.add(this.cannonballManager.instancedMesh);
    scene.add(this.magicManager.instancedMesh);
    scene.add(this.iceManager.instancedMesh);
    scene.add(this.bulletManager.instancedMesh);
    scene.add(this.rocketManager.instancedMesh);
    scene.add(this.poisonManager.instancedMesh);
    scene.add(this.chaosManager.instancedMesh);
  }

  /**
   * Resolves once every projectile pool exists, the arrow pool included.
   * The shader warm-up waits for it so the arrow is not left out.
   */
  whenLoaded(): Promise<void> {
    return this.arrowLoad;
  }

  /**
   * Load arrow GLB model and create instanced mesh
   */
  private async loadArrowModel(): Promise<void> {
    const modelPath = 'assets/models/projectiles/arrow.glb';

    try {
      const gltf = await this.loader.loadAsync(modelPath);

      // Extract geometry and material from model
      let arrowGeometry: BufferGeometry | null = null;
      let arrowMaterial: Material | null = null;

      gltf.scene.traverse((child) => {
        if ((child as Mesh).isMesh && !arrowGeometry) {
          const mesh = child as Mesh;
          arrowGeometry = mesh.geometry.clone();

          if (mesh.material) {
            arrowMaterial = Array.isArray(mesh.material)
              ? (mesh.material[0] as Material).clone()
              : (mesh.material as Material).clone();
          }
        }
      });

      if (arrowGeometry) {
        const material = arrowMaterial || new MeshStandardMaterial({
          color: 0x8b4513,
          metalness: 0.3,
          roughness: 0.7,
        });

        this.arrowManager = new ProjectileInstanceManager(arrowGeometry, material, 500);
        this.scene.add(this.arrowManager.instancedMesh);
        this.arrowModelLoaded = true;
      } else {
        console.warn('[ThreeProjectileRenderer] No mesh in arrow model, using fallback');
        this.createFallbackArrow();
      }
    } catch (error) {
      console.error('[ThreeProjectileRenderer] Failed to load arrow model:', error);
      this.createFallbackArrow();
    }
  }

  /**
   * Create fallback arrow geometry if model fails to load
   */
  private createFallbackArrow(): void {
    const geometry = new ConeGeometry(0.1, 1.5, 6);
    const material = new MeshStandardMaterial({
      color: 0x8b4513,
      metalness: 0.1,
      roughness: 0.8,
    });
    this.arrowManager = new ProjectileInstanceManager(geometry, material, 500);
    this.scene.add(this.arrowManager.instancedMesh);
    this.arrowModelLoaded = true;
  }

  private createCannonballManager(): ProjectileInstanceManager {
    // Cannonball: sphere - size increased for visibility
    const geometry = new SphereGeometry(1.5, 16, 16);

    const material = new MeshStandardMaterial({
      color: 0x333333,
      metalness: 0.8,
      roughness: 0.3,
      emissive: 0x111111,
      emissiveIntensity: 0.2,
    });

    return new ProjectileInstanceManager(geometry, material, 200);
  }

  private createMagicManager(): ProjectileInstanceManager {
    // Magic projectile (arcane orb): violet body, cyan cells and rim. Kept
    // violet-dominant so it does not read as the blue/white ice orb.
    const geometry = new SphereGeometry(1.2, 32, 32); // Higher segments for smooth shader

    const material = new ShaderMaterial({
      vertexShader: MAGIC_ORB_VERTEX,
      fragmentShader: MAGIC_ORB_FRAGMENT,
      uniforms: {
        uTime: { value: 0.0 },
        uColor1: { value: new Color(0x2a0a6e) }, // Deep indigo
        uColor2: { value: new Color(0x7b2cff) }, // Vivid violet
        uColor3: { value: new Color(0x8fe8ff) }, // Pale cyan highlights
        uIntensity: { value: 2.5 },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });

    return new ProjectileInstanceManager(geometry, material, 500);
  }

  private createIceManager(): ProjectileInstanceManager {
    // Ice projectile: glowing blue/white sphere with custom shader
    const geometry = new SphereGeometry(1.2, 32, 32);

    const material = new ShaderMaterial({
      vertexShader: MAGIC_ORB_VERTEX,
      fragmentShader: MAGIC_ORB_FRAGMENT,
      uniforms: {
        uTime: { value: 0.0 },
        uColor1: { value: new Color(0x0066cc) }, // Deep blue
        uColor2: { value: new Color(0x00ccff) }, // Cyan
        uColor3: { value: new Color(0xffffff) }, // White highlights
        uIntensity: { value: 2.5 },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });

    return new ProjectileInstanceManager(geometry, material, 500);
  }

  private createBulletManager(): ProjectileInstanceManager {
    // Bullet: small yellow/golden tracer - elongated cylinder for "bullet trail" effect
    const geometry = new CylinderGeometry(0.3, 0.3, 2.0, 8);

    const material = new MeshStandardMaterial({
      color: 0xffcc00,
      emissive: 0xff9900,
      emissiveIntensity: 2.0,
      metalness: 0.8,
      roughness: 0.2,
    });

    return new ProjectileInstanceManager(geometry, material, 1000);
  }

  private createRocketManager(): ProjectileInstanceManager {
    const material = new MeshStandardMaterial({
      vertexColors: true, // Part colours, see createRocketGeometry()
      metalness: 0.35,
      roughness: 0.45,
      // Keeps the body readable in shadow, low enough not to wash out the red
      emissive: 0xffffff,
      emissiveIntensity: 0.12,
    });

    return new ProjectileInstanceManager(createRocketGeometry(), material, 100);
  }

  private createPoisonManager(): ProjectileInstanceManager {
    // Poison projectile: glowing green orb with custom shader
    const geometry = new SphereGeometry(1.2, 32, 32);

    const material = new ShaderMaterial({
      vertexShader: MAGIC_ORB_VERTEX,
      fragmentShader: MAGIC_ORB_FRAGMENT,
      uniforms: {
        uTime: { value: 0.0 },
        uColor1: { value: new Color(0x1a6600) }, // Dark green
        uColor2: { value: new Color(0x33cc00) }, // Vivid green
        uColor3: { value: new Color(0xccff33) }, // Yellow-green highlights
        uIntensity: { value: 2.5 },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });

    return new ProjectileInstanceManager(geometry, material, 500);
  }

  private createChaosManager(): ProjectileInstanceManager {
    // Chaos orb: the arcane-orb shader over a near-black core. Additive
    // blending drops the dark body, so it reads as a violet/magenta rim
    // around a void; the black comes from its smoke trail.
    const geometry = new SphereGeometry(1.2, 32, 32);

    const material = new ShaderMaterial({
      vertexShader: MAGIC_ORB_VERTEX,
      fragmentShader: MAGIC_ORB_FRAGMENT,
      uniforms: {
        uTime: { value: 0.0 },
        uColor1: { value: new Color(0x12001c) }, // Near-black violet
        uColor2: { value: new Color(0x9d00ff) }, // Violet
        uColor3: { value: new Color(0xff2fd6) }, // Magenta highlights
        uIntensity: { value: 2.5 },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });

    return new ProjectileInstanceManager(geometry, material, 500);
  }

  private getManager(visualType: ProjectileVisualType): ProjectileInstanceManager | null {
    switch (visualType) {
      case 'arrow':
        return this.arrowManager;
      case 'cannonball':
        return this.cannonballManager;
      case 'magic':
        return this.magicManager;
      case 'ice':
        return this.iceManager;
      case 'bullet':
        return this.bulletManager;
      case 'rocket':
        return this.rocketManager;
      case 'poison':
        return this.poisonManager;
      case 'chaos':
        return this.chaosManager;
    }
  }

  // Temporary vectors for quaternion calculations
  private static readonly UP = new Vector3(0, 1, 0);
  private static readonly tempQuat = new Quaternion();
  private static readonly tempDir = new Vector3();
  private static readonly tempEuler = new Euler();

  /**
   * Create a new projectile with direction vector
   */
  create(
    id: string,
    typeId: ProjectileTypeId,
    startLat: number,
    startLon: number,
    startHeight: number,
    direction: { dx: number; dy: number; dz: number }
  ): void {
    const config = PROJECTILE_TYPES[typeId];
    if (!config) {
      console.error(`[ThreeProjectileRenderer] Unknown type: ${typeId}`);
      return;
    }

    const visualType = config.visualType;
    const manager = this.getManager(visualType);

    if (!manager) {
      // Model not loaded yet, skip
      console.warn(`[ThreeProjectileRenderer] Manager for ${visualType} not ready`);
      return;
    }

    const localPos = this.sync.geoToLocal(startLat, startLon, startHeight);

    // Calculate rotation quaternion from direction vector
    // Model should point +Y by default, we rotate to match direction
    const rotation = this.directionToEuler(direction);

    const scale = new Vector3(config.scale, config.scale, config.scale);

    manager.add(id, localPos, rotation, scale);
    this.projectileTypes.set(id, visualType);
  }

  /**
   * Convert direction vector to Euler rotation
   * The cone geometry points +Y by default, this rotates it to match direction
   */
  private directionToEuler(dir: { dx: number; dy: number; dz: number }): Euler {
    // Set target direction
    ThreeProjectileRenderer.tempDir.set(dir.dx, dir.dy, dir.dz).normalize();

    // Calculate quaternion that rotates +Y to target direction
    ThreeProjectileRenderer.tempQuat.setFromUnitVectors(
      ThreeProjectileRenderer.UP,
      ThreeProjectileRenderer.tempDir
    );

    // Convert to Euler. Reuse a static instance — the result is consumed
    // synchronously by manager.update() (composed into a matrix), never retained.
    return ThreeProjectileRenderer.tempEuler.setFromQuaternion(ThreeProjectileRenderer.tempQuat);
  }

  /**
   * Update projectile position (rotation stays fixed)
   */
  update(
    id: string,
    lat: number,
    lon: number,
    height: number
  ): void {
    const visualType = this.projectileTypes.get(id);
    if (!visualType) return;

    const manager = this.getManager(visualType);
    if (!manager) return;

    const localPos = this.sync.geoToLocal(lat, lon, height);
    manager.updatePosition(id, localPos);
  }

  /**
   * Update projectile position AND rotation (for homing projectiles like rockets)
   */
  updateWithRotation(
    id: string,
    lat: number,
    lon: number,
    height: number,
    direction: { dx: number; dy: number; dz: number }
  ): void {
    const visualType = this.projectileTypes.get(id);
    if (!visualType) return;

    const manager = this.getManager(visualType);
    if (!manager) return;

    const localPos = this.sync.geoToLocal(lat, lon, height);
    const rotation = this.directionToEuler(direction);
    manager.update(id, localPos, rotation);
  }

  /**
   * Remove projectile
   */
  remove(id: string): void {
    const visualType = this.projectileTypes.get(id);
    if (!visualType) return;

    const manager = this.getManager(visualType);
    if (manager) {
      manager.remove(id);
    }
    this.projectileTypes.delete(id);
  }

  get count(): number {
    return (
      (this.arrowManager?.count ?? 0) +
      this.cannonballManager.count +
      this.magicManager.count +
      this.iceManager.count +
      this.bulletManager.count +
      this.rocketManager.count +
      this.poisonManager.count +
      this.chaosManager.count
    );
  }

  /**
   * Upload this frame's instance changes. Call once per frame, after all
   * create/update/remove calls.
   */
  commitToGPU(): void {
    this.arrowManager?.flush();
    this.cannonballManager.flush();
    this.magicManager.flush();
    this.iceManager.flush();
    this.bulletManager.flush();
    this.rocketManager.flush();
    this.poisonManager.flush();
    this.chaosManager.flush();
  }

  clear(): void {
    this.arrowManager?.clear();
    this.cannonballManager.clear();
    this.magicManager.clear();
    this.iceManager.clear();
    this.bulletManager.clear();
    this.rocketManager.clear();
    this.poisonManager.clear();
    this.chaosManager.clear();
    this.projectileTypes.clear();
  }

  /**
   * Update shader uniforms (call once per frame)
   */
  updateShaderUniforms(time: number): void {
    // Update magic orb shader time uniform
    const magicMaterial = this.magicManager.instancedMesh.material as ShaderMaterial;
    if (magicMaterial.uniforms?.['uTime']) {
      magicMaterial.uniforms['uTime'].value = time;
    }

    // Update ice orb shader time uniform
    const iceMaterial = this.iceManager.instancedMesh.material as ShaderMaterial;
    if (iceMaterial.uniforms?.['uTime']) {
      iceMaterial.uniforms['uTime'].value = time;
    }

    // Update poison orb shader time uniform
    const poisonMaterial = this.poisonManager.instancedMesh.material as ShaderMaterial;
    if (poisonMaterial.uniforms?.['uTime']) {
      poisonMaterial.uniforms['uTime'].value = time;
    }

    // Update chaos orb shader time uniform
    const chaosMaterial = this.chaosManager.instancedMesh.material as ShaderMaterial;
    if (chaosMaterial.uniforms?.['uTime']) {
      chaosMaterial.uniforms['uTime'].value = time;
    }
  }

  dispose(): void {
    if (this.arrowManager) {
      this.scene.remove(this.arrowManager.instancedMesh);
      this.arrowManager.dispose();
    }
    this.scene.remove(this.cannonballManager.instancedMesh);
    this.scene.remove(this.magicManager.instancedMesh);
    this.scene.remove(this.iceManager.instancedMesh);
    this.scene.remove(this.bulletManager.instancedMesh);
    this.scene.remove(this.rocketManager.instancedMesh);
    this.scene.remove(this.poisonManager.instancedMesh);
    this.scene.remove(this.chaosManager.instancedMesh);

    this.cannonballManager.dispose();
    this.magicManager.dispose();
    this.iceManager.dispose();
    this.bulletManager.dispose();
    this.rocketManager.dispose();
    this.poisonManager.dispose();
    this.chaosManager.dispose();
    this.projectileTypes.clear();
  }
}
