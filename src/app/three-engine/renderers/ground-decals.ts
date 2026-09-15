import { Color, PlaneGeometry, Vector3, type IUniform, type Scene } from 'three';
import {
  BLOOD_DECAL_CONFIG,
  GOO_DECAL_CONFIG,
  ICE_DECAL_CONFIG,
  type ScorchSource,
} from '../../configs/visual-effects.config';
import { bloodMoonMultiplier } from '../blood-moon/blood-moon-mood';
import { DecalInstanceManager } from './decal-instance.manager';
import { createBloodDecalShader, createGooDecalShader, createIceDecalShader } from './decal-shaders';
import { ScorchMarks, type ScorchGround } from './scorch-marks';

/** A killed ooze's splash, see GroundDecals.layGoo */
export interface GooSplash {
  /** Across (m), before the stretch */
  size: number;
  /** Length over width, 1 for round */
  stretch: number;
  /** Turn about the up axis (rad) */
  rotation: number;
  /** 0..1, seeds its shape and shade */
  variation: number;
  /** Hex */
  color: number;
}

/**
 * The marks effects leave on the ground: blood, ice and goo decals,
 * GPU-instanced with custom shaders (one draw call per pool instead of one
 * per decal), and the scorch marks on the route grid (combat heatmap layer
 * 1). Owned by ParticleEffectsRenderer, which switches them with the
 * groundMarks VFX setting.
 */
export class GroundDecals {
  readonly blood: DecalInstanceManager;
  readonly ice: DecalInstanceManager;
  /** At most one per route cell (SCORCH_DECAL_CONFIG). */
  readonly scorch: ScorchMarks;
  /** The splashes of killed oozes (GOO_DECAL_CONFIG), apart from the blood so it does not push them out. */
  readonly goo: DecalInstanceManager;
  private readonly gooColor = new Color();
  private decalIdCounter = 0;
  /** Blood moon tint the three decal materials share, see setBloodMoon(); the orbital beam's embers take it too */
  readonly bloodMoonTint: IUniform<Vector3> = { value: new Vector3(1, 1, 1) };

  constructor(private readonly scene: Scene) {
    // Create shared plane geometry for all decals (rotated to lay flat)
    const decalGeometry = new PlaneGeometry(2, 2);
    decalGeometry.rotateX(-Math.PI / 2); // Rotate to lie flat on ground (XZ plane)

    // Create blood decal manager with custom shader
    this.blood = new DecalInstanceManager(
      decalGeometry.clone(),
      createBloodDecalShader(this.bloodMoonTint),
      BLOOD_DECAL_CONFIG.maxDecals,
    );
    this.scene.add(this.blood.instancedMesh);

    // Create ice decal manager with custom shader
    this.ice = new DecalInstanceManager(decalGeometry.clone(), createIceDecalShader(this.bloodMoonTint), ICE_DECAL_CONFIG.maxDecals);
    this.scene.add(this.ice.instancedMesh);

    this.scorch = new ScorchMarks(decalGeometry.clone(), this.bloodMoonTint);
    this.scene.add(this.scorch.decals.instancedMesh);

    this.goo = new DecalInstanceManager(decalGeometry.clone(), createGooDecalShader(this.bloodMoonTint), GOO_DECAL_CONFIG.maxDecals);
    this.scene.add(this.goo.instancedMesh);
  }

  /**
   * Blood moon look at `amount` (0..1, BloodMoonLook): the mood's
   * multiplier in the values of the target. The decals blend after the
   * mood's quad (transparent, renderOrder 998/999), so without it green
   * slime and ice lay untinted on the red ground. One uniform write for
   * all four pools.
   */
  setBloodMoon(amount: number, linearOutput: boolean): void {
    bloodMoonMultiplier(amount, linearOutput, this.bloodMoonTint.value);
  }

  /**
   * A persistent blood decal at a local ground position, round, `size`
   * across ±20 %, in `color` (hex) or the configured dark red. The oldest
   * one goes when the pool is full.
   * @returns Decal ID
   */
  layBlood(localPos: Vector3, size: number, color?: number): string {
    localPos.y += BLOOD_DECAL_CONFIG.heightOffset;

    const id = `blood_decal_${this.decalIdCounter++}`;
    const now = performance.now();

    // Random rotation for variety
    const rotation = Math.random() * Math.PI * 2;

    // Round, `size` across with some randomness
    const radius = (size * (0.8 + Math.random() * 0.4)) / 2;

    // Randomize color slightly (dark red variations) - from config; a given
    // colour is darkened as far as the red varies
    const colorVariation = Math.random() * BLOOD_DECAL_CONFIG.colorVariation;
    const decalColor = color === undefined
      ? new Color(
        BLOOD_DECAL_CONFIG.baseColor.r + colorVariation,
        BLOOD_DECAL_CONFIG.baseColor.g,
        BLOOD_DECAL_CONFIG.baseColor.b
      )
      : new Color(color).multiplyScalar(1 - colorVariation);

    // If pool is full, remove oldest decal
    if (this.blood.count >= BLOOD_DECAL_CONFIG.maxDecals) {
      this.blood.removeNextToFade();
    }

    // Add new decal instance
    this.blood.add(
      id,
      localPos,
      radius,
      rotation,
      decalColor,
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
      this.ice.removeNextToFade();
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

  /**
   * A killed ooze's splash at a local ground position
   * (OOZE_DEATH_LOOK.splashes), as `splash` gives it: nothing drawn at
   * random here, so the same kill lays the same splashes at any timescale.
   * The oldest one goes when the pool is full.
   * @returns Decal ID
   */
  layGoo(localPos: Vector3, splash: Readonly<GooSplash>): string {
    localPos.y += GOO_DECAL_CONFIG.heightOffset;

    const id = `goo_decal_${this.decalIdCounter++}`;
    if (this.goo.count >= GOO_DECAL_CONFIG.maxDecals) {
      this.goo.removeNextToFade();
    }
    this.goo.add(
      id,
      localPos,
      splash.size / 2,
      splash.rotation,
      this.gooColor.setHex(splash.color),
      GOO_DECAL_CONFIG.baseOpacity,
      performance.now(),
      GOO_DECAL_CONFIG.fadeDelay,
      GOO_DECAL_CONFIG.fadeDuration,
      splash.stretch,
      splash.variation
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

  /** Fade out blood, ice, scorch and goo decals (idle until the first fade is due). */
  updateFades(now: number): void {
    this.blood.updateFades(now);
    this.ice.updateFades(now);
    this.scorch.updateFades(now);
    this.goo.updateFades(now);
  }

  /** Remove every mark; the empty pools leave the render list (DrawGate). */
  clear(): void {
    this.blood.clear();
    this.ice.clear();
    this.scorch.clear();
    this.goo.clear();
  }

  /** Remove the decal meshes from the scene and dispose them. */
  dispose(): void {
    this.scene.remove(this.blood.instancedMesh);
    this.blood.dispose();
    this.scene.remove(this.ice.instancedMesh);
    this.ice.dispose();
    this.scene.remove(this.scorch.decals.instancedMesh);
    this.scorch.dispose();
    this.scene.remove(this.goo.instancedMesh);
    this.goo.dispose();
  }
}
