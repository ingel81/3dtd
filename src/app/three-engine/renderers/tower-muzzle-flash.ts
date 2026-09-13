import { PointLight, type Scene } from 'three';

/**
 * The muzzle flash light of ThreeTowerRenderer: one pooled PointLight that
 * lights a tower's shoot position for 50 ms per shot. The particles are
 * spawned separately (ThreeEffectsRenderer).
 *
 * The light lives in the scene for good, dark between shots. Adding and
 * removing it flipped the scene's point-light count, and every lit material
 * then needed a new shader program on the next frame.
 */
export class TowerMuzzleFlash {
  private light: PointLight | null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** VFX setting muzzleFlash; while off the light stays dark. */
  private enabled = true;

  constructor(private readonly scene: Scene) {
    this.light = new PointLight(0xffaa44, 0, 30);
    this.scene.add(this.light);
  }

  /** Whether flashes are on (VFX setting muzzleFlash). */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Switch the flashes on or off. The light stays in the scene, dark as
   * between shots: taking it out would give every lit material a new
   * shader program.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.light) this.light.intensity = 0;
  }

  /** Light local (x, y, z) at `intensity` for 50 ms; a new flash restarts the timer. */
  flash(x: number, y: number, z: number, intensity: number): void {
    if (!this.light) return;

    // Position at tower tip
    this.light.position.set(x, y, z);
    this.light.intensity = intensity;

    // Clear any existing timer
    if (this.timer) {
      clearTimeout(this.timer);
    }

    // Dark again after 50ms. Intensity only, see the class comment.
    this.timer = setTimeout(() => {
      if (this.light) {
        this.light.intensity = 0;
      }
      this.timer = null;
    }, 50);
  }

  /** Stop the timer and take the light out of the scene. */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.light) {
      this.scene.remove(this.light);
      this.light.dispose();
      this.light = null;
    }
  }
}
