import { ClampToEdgeWrapping, DataArrayTexture, DataUtils, HalfFloatType, LinearFilter, NoColorSpace, RGBAFormat, Vector4 } from 'three';
import type { HeightField } from '../height-field';

/** Most texels a side */
const MAX_TEXELS = 512;

/** Layers of the grid, and what their channels hold */
export const LIGHT_LAMPS = 0;
export const LIGHT_FLICKER = 1;

/**
 * The light baked onto the map's ground, on one grid over the map (a texel
 * per metre, MAX_TEXELS a side at most) in one texture array that every
 * map material reads through a single texture unit (height-fog.ts,
 * LAMP_LIGHT_PARS):
 * - layer LIGHT_LAMPS: the steady lamp light (rgb, lamp-light.ts) and the
 *   ground height the lamps stand on (a);
 * - layer LIGHT_FLICKER: the flickering lamp light, fire and lava (rgb), and
 *   the sun's far shadow (a, 1 lit; far-shadow.ts, read by the terrain).
 * Each bake writes its channels and hands its layer over (`changed`); a
 * layer goes up whole, half floats, 2 MB at most.
 */
export class LightGrid {
  readonly texture: DataArrayTexture;
  readonly columns: number;
  readonly rows: number;
  /** Metres per texel, and map x, y of texel (0, 0) */
  readonly texel: number;
  readonly originX: number;
  readonly originY: number;
  /** Both layers' texels, layer after layer, RGBA half floats */
  readonly data: Uint16Array;
  /** Whether the texture went up once: until then a layer change uploads all (three allocates on the first) */
  private uploaded = false;

  constructor(field: HeightField) {
    const width = (field.columns - 1) * field.cellSize;
    const depth = (field.rows - 1) * field.cellSize;
    this.texel = Math.max(1, Math.max(width, depth) / (MAX_TEXELS - 1));
    this.columns = Math.ceil(width / this.texel) + 1;
    this.rows = Math.ceil(depth / this.texel) + 1;
    this.originX = field.originX;
    this.originY = field.originY;
    this.data = new Uint16Array(this.columns * this.rows * 4 * 2);
    // The sun's far shadow is lit until it is baked
    const lit = DataUtils.toHalfFloat(1);
    for (let q = this.layerStart(LIGHT_FLICKER) + 3; q < this.data.length; q += 4) this.data[q] = lit;
    const t = new DataArrayTexture(this.data, this.columns, this.rows, 2);
    t.format = RGBAFormat;
    t.type = HalfFloatType;
    t.colorSpace = NoColorSpace;
    t.magFilter = t.minFilter = LinearFilter;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.name = 'light-grid';
    t.onUpdate = () => {
      this.uploaded = true;
    };
    t.needsUpdate = true;
    this.texture = t;
  }

  /** Index in `data` of a layer's first texel */
  layerStart(layer: number): number {
    return layer * this.columns * this.rows * 4;
  }

  /** The texture's uv for map metres (x, y): u = x * uv.x + uv.z, v = y * uv.y + uv.w */
  gridUv(target: Vector4): Vector4 {
    const sx = 1 / (this.texel * this.columns);
    const sy = 1 / (this.texel * this.rows);
    return target.set(sx, sy, -this.originX * sx + 0.5 / this.columns, -this.originY * sy + 0.5 / this.rows);
  }

  /** A layer's texels changed: it goes up with the next render */
  changed(layer: number): void {
    if (this.uploaded) this.texture.addLayerUpdate(layer);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
