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
  Euler,
  Scene,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CoordinateSync } from './index';
import {
  ProjectileTypeId,
  ProjectileVisualType,
  PROJECTILE_TYPES,
} from '../../configs/projectile-types.config';
import {
  MAGIC_ORB_VERTEX,
  MAGIC_ORB_FRAGMENT,
} from '../../game/tower-defense/shaders/magic-orb.shaders';

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
class ProjectileInstanceManager {
  readonly instancedMesh: InstancedMesh;
  private entities = new Map<string, number>(); // id -> instanceIndex
  private freeIndices: number[] = [];
  private activeCount = 0;
  private readonly matrix = new Matrix4();

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
  }

  add(
    id: string,
    position: Vector3,
    rotation: Euler,
    scale: Vector3
  ): void {
    if (this.entities.has(id)) return;

    let index: number;
    if (this.freeIndices.length > 0) {
      index = this.freeIndices.pop()!;
    } else {
      index = this.activeCount;
    }

    this.entities.set(id, index);
    this.activeCount = Math.max(this.activeCount, index + 1);
    this.instancedMesh.count = this.activeCount;

    this.matrix.compose(
      position,
      ProjectileInstanceManager._tempRot.setFromEuler(rotation),
      scale
    );
    this.instancedMesh.setMatrixAt(index, this.matrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;
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
    this.instancedMesh.instanceMatrix.needsUpdate = true;
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
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  remove(id: string): void {
    const index = this.entities.get(id);
    if (index === undefined) return;

    // Move to infinity (hide)
    this.matrix.makeTranslation(0, -10000, 0);
    this.instancedMesh.setMatrixAt(index, this.matrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    this.entities.delete(id);
    this.freeIndices.push(index);
  }

  get count(): number {
    return this.entities.size;
  }

  clear(): void {
    for (const id of this.entities.keys()) {
      this.remove(id);
    }
    this.entities.clear();
    this.freeIndices = [];
    this.activeCount = 0;
    this.instancedMesh.count = 0;
  }

  dispose(): void {
    this.clear();
    this.instancedMesh.geometry.dispose();
    (this.instancedMesh.material as Material).dispose();
  }
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
  private bulletManager: ProjectileInstanceManager;
  private rocketManager: ProjectileInstanceManager;

  // Track which manager owns each projectile
  private projectileTypes = new Map<string, ProjectileVisualType>();

  // Model loading state
  private arrowModelLoaded = false;

  constructor(scene: Scene, sync: CoordinateSync) {
    this.scene = scene;
    this.sync = sync;
    this.loader = new GLTFLoader();

    // Create instanced managers for each visual type
    this.cannonballManager = this.createCannonballManager();
    this.magicManager = this.createMagicManager();
    this.bulletManager = this.createBulletManager();
    this.rocketManager = this.createRocketManager();

    // Load arrow model async
    this.loadArrowModel();

    // Add meshes to scene
    // Arrow will be added when model loads
    scene.add(this.cannonballManager.instancedMesh);
    scene.add(this.magicManager.instancedMesh);
    scene.add(this.bulletManager.instancedMesh);
    scene.add(this.rocketManager.instancedMesh);
  }

  /**
   * Load arrow GLB model and create instanced mesh
   */
  private async loadArrowModel(): Promise<void> {
    const modelPath = '/assets/models/misc/arrow_01.glb';

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
    // Magic projectile: glowing sphere with custom shader
    const geometry = new SphereGeometry(1.2, 32, 32); // Higher segments for smooth shader

    const material = new ShaderMaterial({
      vertexShader: MAGIC_ORB_VERTEX,
      fragmentShader: MAGIC_ORB_FRAGMENT,
      uniforms: {
        uTime: { value: 0.0 },
        uColor1: { value: new Color(0x6600cc) }, // Deep purple
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
    // Rocket: sleek missile shape - white/light grey
    const bodyGeometry = new CylinderGeometry(0.3, 0.4, 3.0, 8);

    const material = new MeshStandardMaterial({
      color: 0xeeeeee, // Light grey/white
      emissive: 0xffffff, // White glow
      emissiveIntensity: 0.3,
      metalness: 0.5,
      roughness: 0.4,
    });

    return new ProjectileInstanceManager(bodyGeometry, material, 100);
  }

  private getManager(visualType: ProjectileVisualType): ProjectileInstanceManager | null {
    switch (visualType) {
      case 'arrow':
        return this.arrowManager;
      case 'cannonball':
        return this.cannonballManager;
      case 'magic':
        return this.magicManager;
      case 'bullet':
        return this.bulletManager;
      case 'rocket':
        return this.rocketManager;
    }
  }

  // Temporary vectors for quaternion calculations
  private static readonly UP = new Vector3(0, 1, 0);
  private static readonly tempQuat = new Quaternion();
  private static readonly tempDir = new Vector3();

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

    // Convert to Euler
    const euler = new Euler();
    euler.setFromQuaternion(ThreeProjectileRenderer.tempQuat);

    return euler;
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
      this.bulletManager.count +
      this.rocketManager.count
    );
  }

  /**
   * Commit all changes to GPU (no-op in simplified implementation)
   */
  commitToGPU(): void {
    // Instance matrix updates are done automatically in add/update/remove
  }

  clear(): void {
    this.arrowManager?.clear();
    this.cannonballManager.clear();
    this.magicManager.clear();
    this.bulletManager.clear();
    this.rocketManager.clear();
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
  }

  dispose(): void {
    if (this.arrowManager) {
      this.scene.remove(this.arrowManager.instancedMesh);
      this.arrowManager.dispose();
    }
    this.scene.remove(this.cannonballManager.instancedMesh);
    this.scene.remove(this.magicManager.instancedMesh);
    this.scene.remove(this.bulletManager.instancedMesh);
    this.scene.remove(this.rocketManager.instancedMesh);

    this.cannonballManager.dispose();
    this.magicManager.dispose();
    this.bulletManager.dispose();
    this.rocketManager.dispose();
    this.projectileTypes.clear();
  }
}
