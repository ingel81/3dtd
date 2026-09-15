import { BufferGeometry, Color, Vector3, type IUniform } from 'three';
import { SCORCH_DECAL_CONFIG, type ScorchSource, type ScorchStyle } from '../../configs/visual-effects.config';
import { DecalInstanceManager } from './decal-instance.manager';
import { createScorchDecalShader } from './decal-shaders';

/**
 * Ground the marks sit on: route cells for the one-per-cell rule and their
 * terrain height. GlobalRouteGridService provides both.
 */
export interface ScorchGround {
  getCellAt(localX: number, localZ: number): { key: number } | undefined;
  getGroundLocalYAt(localX: number, localZ: number): number | null;
}

/**
 * Scorch marks on the route grid (combat heatmap layer 1, see
 * SCORCH_DECAL_CONFIG). One GPU-instanced decal pool; the decal ID is the
 * route cell, so "does this cell have a mark" is the pool's own lookup and
 * needs no map of its own.
 */
export class ScorchMarks {
  readonly decals: DecalInstanceManager;
  private ground: ScorchGround | null = null;
  private readonly position = new Vector3();
  private readonly color = new Color();

  /** `bloodMoonTint`: the blood moon tint the ground marks share (GroundDecals) */
  constructor(geometry: BufferGeometry, bloodMoonTint?: IUniform<Vector3>) {
    this.decals = new DecalInstanceManager(geometry, createScorchDecalShader(bloodMoonTint), SCORCH_DECAL_CONFIG.maxDecals);
    // Drawn before blood and ice (999), so fresh blood lies on old burns
    this.decals.instancedMesh.renderOrder = 998;
  }

  /** Route grid to put marks on; null (the default) leaves no marks. */
  setGround(ground: ScorchGround | null): void {
    this.ground = ground;
  }

  /**
   * Burn a mark at a local position (the hit point; the mark goes on the
   * ground below it). A cell that already has one gets it darkened and its
   * fade restarted instead; a source with `ownMark` keeps a mark of its own
   * there. A full pool gives up the mark whose fade comes first.
   *
   * @param now - Wall clock in ms (performance.now())
   * @returns false when the point is off the route grid, has no known
   *   ground, or lies too high above it
   */
  mark(localX: number, localY: number, localZ: number, source: ScorchSource, now: number): boolean {
    const cfg = SCORCH_DECAL_CONFIG;
    const ground = this.ground;
    if (!ground) return false;

    const cell = ground.getCellAt(localX, localZ);
    if (!cell) return false;
    const groundY = ground.getGroundLocalYAt(localX, localZ);
    if (groundY === null || localY - groundY > cfg.maxHeightAboveGround) return false;

    const style: ScorchStyle = cfg.sources[source];
    const id = style.ownMark ? `scorch_${source}_${cell.key}` : `scorch_${cell.key}`;
    const fadeDelay = style.fadeDelay ?? cfg.fadeDelay;
    if (this.decals.reinforce(id, style.opacityStep, style.maxOpacity ?? cfg.maxOpacity, now, fadeDelay)) return true;

    if (this.decals.count >= cfg.maxDecals) {
      this.decals.removeNextToFade();
    }

    const base = style.color ?? cfg.baseColor;
    const variation = (Math.random() - 0.5) * 2 * cfg.colorVariation;
    this.color.setRGB(base.r + variation, base.g + variation, base.b + variation * 0.5);
    this.position.set(localX, groundY + cfg.heightOffset, localZ);
    const size = style.size * (0.85 + Math.random() * 0.3);

    this.decals.add(
      id,
      this.position,
      size,
      Math.random() * Math.PI * 2,
      this.color,
      style.opacity,
      now,
      fadeDelay,
      style.fadeDuration ?? cfg.fadeDuration
    );
    return true;
  }

  /** Fade marks out, see DecalInstanceManager.updateFades(). */
  updateFades(now: number): void {
    this.decals.updateFades(now);
  }

  clear(): void {
    this.decals.clear();
  }

  dispose(): void {
    this.decals.dispose();
  }
}
