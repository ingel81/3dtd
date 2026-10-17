import { DataTexture, LinearFilter, RedFormat, UnsignedByteType, Vector4, type Vector3 } from 'three';
import type { HeightField } from '../height-field';
import { farShadowData, farShadowRows, farShadowStart, type FarShadowTexels } from './ground-shape';

/**
 * The far cascade of the sun's shadow (the shadowCascade effect): where the
 * land itself hides the sun, baked once over the whole map into a small
 * texture (one byte per texel, about 2 to 4 m each). The cached shadow map
 * reaches only 70 to 450 m around the focus; beyond it a mountain casts no
 * shadow over the valley behind it. The terrain reads this texture there
 * (1 lookup), blended in towards the shadow box's rim.
 *
 * Only the ground casts here (no trees or buildings: far off they are below
 * a few pixels), soft edged: each texel marches towards the sun and keeps
 * how close the land came to its ray, relative to the distance.
 */

/** Rows a slice of a bake spread over frames marches (some 2 to 6 ms) */
export const FAR_SHADOW_SLICE_ROWS = 24;

/**
 * The baked far shadow and where it applies, as the terrain material's
 * uniforms (shared, like the morph uniforms): the texture, and the map x, y
 * of the cached shadow map's centre, its radius and 1 when on
 */
export class FarShadow {
  readonly texture = { value: FarShadow.make(new Uint8Array([255]), 1, 1) };
  readonly area = { value: new Vector4() };

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

  private upload({ data, columns, rows }: FarShadowTexels): void {
    const t = this.texture.value;
    if (t.image.width === columns && t.image.height === rows) {
      (t.image.data as Uint8Array).set(data);
      t.needsUpdate = true;
      return;
    }
    t.dispose();
    this.texture.value = FarShadow.make(data, columns, rows);
  }

  /** The cached map's reach (map x, y and radius), and whether the far cascade shows */
  setArea(x: number, y: number, radius: number, on: boolean): void {
    this.area.value.set(x, y, Math.max(radius, 1), on ? 1 : 0);
  }

  dispose(): void {
    this.texture.value.dispose();
  }

  private static make(data: Uint8Array, columns: number, rows: number): DataTexture {
    const t = new DataTexture(data, columns, rows, RedFormat, UnsignedByteType);
    t.minFilter = t.magFilter = LinearFilter;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
  }
}
