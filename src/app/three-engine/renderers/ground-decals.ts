import { Color, PlaneGeometry, type Scene, type Vector3 } from 'three';
import { BLOOD_DECAL_CONFIG, ICE_DECAL_CONFIG, type ScorchSource } from '../../configs/visual-effects.config';
import { DecalInstanceManager } from './decal-instance.manager';
import { createBloodDecalShader, createIceDecalShader } from './decal-shaders';
import { ScorchMarks, type ScorchGround } from './scorch-marks';

/**
 * The marks effects leave on the ground: blood and ice decals, GPU-instanced
 * with custom shaders (2 draw calls instead of 250), and the scorch marks on
 * the route grid (combat heatmap layer 1). Owned by ParticleEffectsRenderer,
 * which switches them with the groundMarks VFX setting.
 */
export class GroundDecals {
  readonly blood: DecalInstanceManager;
  readonly ice: DecalInstanceManager;
  /** At most one per route cell (SCORCH_DECAL_CONFIG). */
  readonly scorch: ScorchMarks;
  private decalIdCounter = 0;

  constructor(private readonly scene: Scene) {
    // Create shared plane geometry for all decals (rotated to lay flat)
    const decalGeometry = new PlaneGeometry(2, 2);
    decalGeometry.rotateX(-Math.PI / 2); // Rotate to lie flat on ground (XZ plane)

    // Create blood decal manager with custom shader
    this.blood = new DecalInstanceManager(decalGeometry.clone(), createBloodDecalShader(), BLOOD_DECAL_CONFIG.maxDecals);
    this.scene.add(this.blood.instancedMesh);

    // Create ice decal manager with custom shader
    this.ice = new DecalInstanceManager(decalGeometry.clone(), createIceDecalShader(), ICE_DECAL_CONFIG.maxDecals);
    this.scene.add(this.ice.instancedMesh);

    this.scorch = new ScorchMarks(decalGeometry.clone());
    this.scene.add(this.scorch.decals.instancedMesh);
  }

  /**
   * A persistent blood decal at a local ground position, round, `size`
   * across ±20 %. The oldest one goes when the pool is full.
   * @returns Decal ID
   */
  layBlood(localPos: Vector3, size: number): string {
    localPos.y += BLOOD_DECAL_CONFIG.heightOffset;

    const id = `blood_decal_${this.decalIdCounter++}`;
    const now = performance.now();

    // Random rotation for variety
    const rotation = Math.random() * Math.PI * 2;

    // Round, `size` across with some randomness
    const radius = (size * (0.8 + Math.random() * 0.4)) / 2;

    // Randomize color slightly (dark red variations) - from config
    const colorVariation = Math.random() * BLOOD_DECAL_CONFIG.colorVariation;
    const color = new Color(
      BLOOD_DECAL_CONFIG.baseColor.r + colorVariation,
      BLOOD_DECAL_CONFIG.baseColor.g,
      BLOOD_DECAL_CONFIG.baseColor.b
    );

    // If pool is full, remove oldest decal
    if (this.blood.count >= BLOOD_DECAL_CONFIG.maxDecals) {
      this.blood.removeOldest();
    }

    // Add new decal instance
    this.blood.add(
      id,
      localPos,
      radius,
      rotation,
      color,
      BLOOD_DECAL_CONFIG.baseOpacity,
      now,
      BLOOD_DECAL_CONFIG.fadeDelay,
      BLOOD_DECAL_CONFIG.fadeDuration
    );

    return id;
  }

  /**
   * A frost patch at a local ground position, round, `size` across ±20 %.
   * The oldest one goes when the pool is full.
   * @returns Decal ID
   */
  layIce(localPos: Vector3, size: number): string {
    localPos.y += ICE_DECAL_CONFIG.heightOffset;

    const id = `ice_decal_${this.decalIdCounter++}`;
    const now = performance.now();

    // Random rotation for variety
    const rotation = Math.random() * Math.PI * 2;

    // Round, `size` across with some randomness
    const radius = (size * (0.8 + Math.random() * 0.4)) / 2;

    // Randomize color slightly (very light cyan/white variations) - from config
    const colorVariation = Math.random() * ICE_DECAL_CONFIG.colorVariation;
    const color = new Color(
      ICE_DECAL_CONFIG.baseColor.r + colorVariation,
      ICE_DECAL_CONFIG.baseColor.g + colorVariation * 0.5,
      ICE_DECAL_CONFIG.baseColor.b
    );

    // If pool is full, remove oldest decal
    if (this.ice.count >= ICE_DECAL_CONFIG.maxDecals) {
      this.ice.removeOldest();
    }

    // Add new decal instance
    this.ice.add(
      id,
      localPos,
      radius,
      rotation,
      color,
      ICE_DECAL_CONFIG.baseOpacity,
      now,
      ICE_DECAL_CONFIG.fadeDelay,
      ICE_DECAL_CONFIG.fadeDuration
    );

    return id;
  }

  /** Route grid the scorch marks sit on; null leaves none. */
  setScorchGround(ground: ScorchGround | null): void {
    this.scorch.setGround(ground);
  }

  /** Burn a scorch mark below a local hit point, see ScorchMarks.mark. */
  markScorch(localX: number, localY: number, localZ: number, source: ScorchSource, now: number): void {
    this.scorch.mark(localX, localY, localZ, source, now);
  }

  /** Fade out blood, ice and scorch decals (idle until the first fade is due). */
  updateFades(now: number): void {
    this.blood.updateFades(now);
    this.ice.updateFades(now);
    this.scorch.updateFades(now);
  }

  /** Remove every mark; the empty pools leave the render list (DrawGate). */
  clear(): void {
    this.blood.clear();
    this.ice.clear();
    this.scorch.clear();
  }

  /** Remove the decal meshes from the scene and dispose them. */
  dispose(): void {
    this.scene.remove(this.blood.instancedMesh);
    this.blood.dispose();
    this.scene.remove(this.ice.instancedMesh);
    this.ice.dispose();
    this.scene.remove(this.scorch.decals.instancedMesh);
    this.scorch.dispose();
  }
}
