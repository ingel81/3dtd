import { Vector2, type Mesh } from 'three';
import type { HeightTexture } from '../terrain/height-texture';
import type { CoverMap } from '../environment/cover-map';
import { FAR_GRASS, GRASS_FADE_FROM, GRASS_FADE_TO, GrassField, NEAR_GRASS, type GrassInputs } from './grass-field';

/**
 * How far ahead of the camera's foot the near tile's middle may sit, metres, plus half the camera's height over the
 * ground there: a low camera (a tower's view) keeps the blades at its feet and to the sides, not a patch round a far
 * aim point; a higher one, whose view starts further out, takes them there
 */
export const GRASS_AHEAD = NEAR_GRASS.tile * 0.3;
/**
 * How far beyond the near tile's middle the far one's may sit, metres: the near blades' whole circle stays where the
 * far ring is at full density, so wherever the near blades thin out the far ones stand in for them
 */
export const FAR_GRASS_AHEAD = GRASS_FADE_FROM * 0.5 * FAR_GRASS.tile - GRASS_FADE_TO * 0.5 * NEAR_GRASS.tile;

/**
 * The middles of both tiles for a camera at `cam` looking at `focus` (map
 * group space, x and z), `height` metres over the ground at its foot: the
 * near one from the camera's foot towards the focus (GRASS_AHEAD); the far
 * one further on, at most FAR_GRASS_AHEAD beyond, never past the focus
 */
export function grassCenters(cam: { x: number; z: number }, focus: { x: number; z: number }, height: number, near: Vector2, far: Vector2): void {
  const dx = focus.x - cam.x;
  const dz = focus.z - cam.z;
  const ahead = Math.hypot(dx, dz);
  const nearStep = Math.min(0.6 * ahead, GRASS_AHEAD + 0.5 * Math.max(0, height));
  const farStep = nearStep + Math.min(Math.max(0, ahead - nearStep), FAR_GRASS_AHEAD);
  const ux = ahead > 0 ? dx / ahead : 0;
  const uz = ahead > 0 ? dz / ahead : 0;
  near.set(cam.x + ux * nearStep, cam.z + uz * nearStep);
  far.set(cam.x + ux * farStep, cam.z + uz * farStep);
}

/** Share of a layer shown at the camera's distance `reach` to its focus: all to 85 % of `distance`, none from it */
export function grassShow(reach: number, distance: number): number {
  if (distance <= 0) return 0;
  const x = Math.min(1, Math.max(0, (reach - 0.85 * distance) / (0.15 * distance)));
  return 1 - x * x * (3 - 2 * x);
}

/**
 * The map's grass: dense blades round the camera's feet and a far ring of
 * fewer, larger blades out to some 190 m ahead, which grows where the near
 * blades thin out (their densities cross over, no seam). Beyond it the
 * painted ground carries on, the blades take its colour. Both thin out as
 * the camera draws away from its focus, or rises (three times its height
 * over the ground counts, whichever is less), each by its own distance.
 */
export class GrassLayers {
  readonly near: GrassField;
  readonly far: GrassField;
  private nearDistance = 140;
  private farDistance = 300;
  private readonly nearCenter = new Vector2();
  private readonly farCenter = new Vector2();

  constructor(heights: HeightTexture) {
    this.near = new GrassField(heights, NEAR_GRASS);
    this.far = new GrassField(heights, FAR_GRASS);
  }

  get meshes(): Mesh[] {
    return [this.near.mesh, this.far.mesh];
  }

  setInputs(p: GrassInputs): void {
    this.near.setInputs(p);
    this.far.setInputs(p);
  }

  setCover(cover: CoverMap): void {
    this.near.setCover(cover);
    this.far.setCover(cover);
  }

  /** The quality level's blades of both layers and up to which camera distance each shows */
  setQuality(nearBlades: number, nearDistance: number, farBlades: number, farDistance: number): void {
    this.near.setBlades(nearBlades);
    this.far.setBlades(farBlades);
    this.nearDistance = nearDistance;
    this.farDistance = farDistance;
  }

  /**
   * `cam` and `focus` in the map group's space, `height` the camera's over
   * the ground at its foot, `reach` its distance to the focus
   */
  update(cam: { x: number; z: number }, focus: { x: number; z: number }, height: number, reach: number): void {
    grassCenters(cam, focus, height, this.nearCenter, this.farCenter);
    this.near.setCenter(this.nearCenter.x, this.nearCenter.y);
    this.far.setCenter(this.farCenter.x, this.farCenter.y);
    // From high up the blades are below a pixel; a low camera looking far (a tower's view) keeps them
    const away = Math.min(reach, 3 * Math.max(0, height));
    this.near.setShow(grassShow(away, this.nearDistance));
    this.far.setShow(grassShow(away, this.farDistance));
    this.far.setHole(this.near);
  }

  dispose(): void {
    this.near.dispose();
    this.far.dispose();
  }
}
