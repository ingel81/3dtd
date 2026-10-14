import { DataTexture, LinearFilter, RedFormat, UnsignedByteType, Vector4, type Vector3 } from 'three';
import type { HeightField } from '../height-field';

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

/** Texels along the map's longer side */
const SIZE = 256;
/** How far the march looks for land in the way, metres */
const REACH = 1200;

/** Visibility of the sun (0 shadow, 255 lit) over the map, `width` x `height` texels row by row from the map's south west */
export function farShadowData(field: HeightField, sunDir: { x: number; y: number; z: number }, width: number, depth: number): { data: Uint8Array; columns: number; rows: number } {
  const out = farShadowStart(sunDir, width, depth);
  farShadowRows(field, sunDir, width, depth, out, 0, out.rows);
  return out;
}

/** The far shadow's texels, all lit (all dark once the sun has set), before farShadowRows marches them */
export function farShadowStart(sunDir: { y: number }, width: number, depth: number): { data: Uint8Array; columns: number; rows: number } {
  const columns = width >= depth ? SIZE : Math.max(2, Math.round((SIZE * width) / depth));
  const rows = depth >= width ? SIZE : Math.max(2, Math.round((SIZE * depth) / width));
  return { data: new Uint8Array(columns * rows).fill(sunDir.y <= 0.01 ? 0 : 255), columns, rows };
}

/** Rows j0 up to j1 of the far shadow, marched towards the sun (one band of a bake spread over frames) */
export function farShadowRows(
  field: HeightField,
  sunDir: { x: number; y: number; z: number },
  width: number,
  depth: number,
  out: { data: Uint8Array; columns: number; rows: number },
  j0: number,
  j1: number,
): void {
  const { data, columns, rows } = out;
  // The sun's direction on the map (scene x is map -x, scene z map y), its rise per metre along it
  const horizontal = Math.hypot(sunDir.x, sunDir.z);
  if (sunDir.y <= 0.01 || horizontal < 1e-4) return;
  const dx = -sunDir.x / horizontal;
  const dy = sunDir.z / horizontal;
  const rise = sunDir.y / horizontal;
  const cellX = width / columns;
  const cellY = depth / rows;
  const first = Math.max(field.cellSize, Math.min(cellX, cellY)) * 0.75;
  const reach = Math.min(REACH, Math.hypot(width, depth));
  const halfW = width / 2;
  const halfD = depth / 2;
  for (let j = j0; j < Math.min(j1, rows); j++) {
    const y = -halfD + (j + 0.5) * cellY;
    for (let i = 0; i < columns; i++) {
      const x = -halfW + (i + 0.5) * cellX;
      const h0 = field.heightAt(x, y) + 0.5;
      let lit = 1;
      for (let t = first; t < reach; t *= 1.06) {
        const px = x + dx * t;
        const py = y + dy * t;
        if (px < -halfW || px > halfW || py < -halfD || py > halfD) break;
        const above = h0 + t * rise - field.heightAt(px, py);
        // Soft: how far below the ray the land stays, against the distance (a penumbra widening with it)
        const k = above / (t * 0.04 + 0.5);
        if (k < lit) {
          lit = k;
          if (lit <= 0) break;
        }
      }
      data[j * columns + i] = Math.round(Math.max(0, lit) * 255);
    }
  }
}

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

  private upload({ data, columns, rows }: { data: Uint8Array; columns: number; rows: number }): void {
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
