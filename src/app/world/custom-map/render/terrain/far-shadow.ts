import { DataUtils, Vector4, type Vector3 } from 'three';
import type { HeightField } from '../height-field';
import { LIGHT_FLICKER, type LightGrid } from '../effects/light-grid';
import { farShadowData, farShadowRows, farShadowStart, type FarShadowTexels } from './ground-shape';

/**
 * The far cascade of the sun's shadow (the shadowCascade effect): where the
 * land itself hides the sun, baked once over the whole map into a small
 * texture (one byte per texel, about 2 to 4 m each). The cached shadow map
 * reaches only 70 to 450 m around the focus; beyond it a mountain casts no
 * shadow over the valley behind it. The terrain reads it there (1 lookup),
 * blended in towards the shadow box's rim: from the map's light grid
 * (light-grid.ts), whose flickering layer carries it in its alpha, so it
 * takes no texture unit of its own.
 *
 * Only the ground casts here (no trees or buildings: far off they are below
 * a few pixels), soft edged: each texel marches towards the sun and keeps
 * how close the land came to its ray, relative to the distance.
 */

/** Rows a slice of a bake spread over frames marches (some 2 to 6 ms) */
export const FAR_SHADOW_SLICE_ROWS = 24;

/** A byte of the bake as a half float, 0 to 1 */
const HALF = Uint16Array.from({ length: 256 }, (_, v) => DataUtils.toHalfFloat(v / 255));

/**
 * The baked far shadow, carried into the light grid, and where it applies,
 * as the terrain material's uniform (shared, like the morph uniforms): the
 * map x, y of the cached shadow map's centre, its radius and 1 when on
 */
export class FarShadow {
  readonly area = { value: new Vector4() };

  constructor(
    private readonly grid: LightGrid,
    /** The map's width and depth, m: the bake's texels cover them */
    private readonly width: number,
    private readonly depth: number,
  ) {}

  /** Bakes the land's shadow for `sunDir` (scene space, towards the sun); about 20 to 60 ms */
  bake(field: HeightField, sunDir: Vector3, width: number, depth: number): void {
    this.upload(farShadowData(field, sunDir, width, depth));
  }

  /**
   * The same bake spread over frames (an edit of the ground in the editor):
   * FAR_SHADOW_SLICE_ROWS rows at a time with a task between, so no frame
   * holds the whole of it. Stops without a result once `current` says a
   * newer bake took over. Resolves true when it uploaded.
   */
  async bakeSliced(field: HeightField, sunDir: Vector3, width: number, depth: number, current: () => boolean): Promise<boolean> {
    const out = farShadowStart(sunDir, width, depth);
    for (let j = 0; j < out.rows; j += FAR_SHADOW_SLICE_ROWS) {
      farShadowRows(field, sunDir, width, depth, out, j, j + FAR_SHADOW_SLICE_ROWS);
      await new Promise((resolve) => setTimeout(resolve));
      if (!current()) return false;
    }
    this.upload(out);
    return true;
  }

  /** Texels baked elsewhere (the editor's worker) */
  set(texels: FarShadowTexels): void {
    this.upload(texels);
  }

  /** The bake's texels into the grid's alpha at each grid texel's map point, bilinear as the texture read them */
  private upload({ data, columns, rows }: FarShadowTexels): void {
    const g = this.grid;
    const out = g.data;
    const start = g.layerStart(LIGHT_FLICKER) + 3;
    for (let j = 0; j < g.rows; j++) {
      const v = Math.min(rows - 1, Math.max(0, ((g.originY + j * g.texel) / this.depth + 0.5) * rows - 0.5));
      const b0 = Math.floor(v);
      const b1 = Math.min(rows - 1, b0 + 1);
      const fb = v - b0;
      for (let i = 0; i < g.columns; i++) {
        const u = Math.min(columns - 1, Math.max(0, ((g.originX + i * g.texel) / this.width + 0.5) * columns - 0.5));
        const a0 = Math.floor(u);
        const a1 = Math.min(columns - 1, a0 + 1);
        const fa = u - a0;
        const top = data[b0 * columns + a0] * (1 - fa) + data[b0 * columns + a1] * fa;
        const bottom = data[b1 * columns + a0] * (1 - fa) + data[b1 * columns + a1] * fa;
        out[start + (j * g.columns + i) * 4] = HALF[Math.round(top * (1 - fb) + bottom * fb)];
      }
    }
    g.changed(LIGHT_FLICKER);
  }

  /** The cached map's reach (map x, y and radius), and whether the far cascade shows */
  setArea(x: number, y: number, radius: number, on: boolean): void {
    this.area.value.set(x, y, Math.max(radius, 1), on ? 1 : 0);
  }

}
