import {
  ClampToEdgeWrapping,
  CompressedArrayTexture,
  DataArrayTexture,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type CompressedTexture,
} from 'three';
import type { MapSplat } from '../../map-document';
import type { HeightField } from '../height-field';
import type { MaterialCompressed, MaterialPixels } from '../map-asset-library';
import { uploadRect, type TexelRect } from './texture-ranges';

/**
 * GPU textures of the terrain: the ground materials stacked into two texture
 * arrays (one layer per material), the splat weights and the path mask.
 */

/** A terrain layer array: from pixels, or from GPU-compressed layers */
export type LayerArray = DataArrayTexture | CompressedArrayTexture;

/**
 * Whether GPU-compressed layers can share one array: every one compressed,
 * in one format and size with the same mipmaps (the transcoder picks one
 * format per GPU and file kind, so a map's layers agree unless a file failed)
 */
export function compressedTogether(materials: readonly (MaterialPixels | MaterialCompressed)[]): materials is MaterialCompressed[] {
  const all = materials.filter(isCompressed);
  if (all.length === 0 || all.length !== materials.length) return false;
  const same = (a: CompressedTexture, b: CompressedTexture) =>
    a.format === b.format && a.image.width === b.image.width && a.mipmaps?.length === b.mipmaps?.length;
  return all.every((m) => same(m.color, all[0].color) && same(m.data, all[0].data));
}

/** A material that came GPU-compressed */
export function isCompressed(m: MaterialPixels | MaterialCompressed): m is MaterialCompressed {
  return !(m.color instanceof Uint8Array);
}

/** Texture arrays of the materials a map uses, in layer order */
export class MaterialArrays {
  readonly color: LayerArray;
  readonly data: LayerArray;
  readonly count: number;

  /** Pixels, or GPU-compressed layers that agree (compressedTogether); never a mix */
  constructor(materials: MaterialPixels[] | MaterialCompressed[], anisotropy = 8) {
    this.count = materials.length;
    if (compressedTogether(materials)) {
      this.color = compressedArray(materials.map((m) => m.color), anisotropy);
      this.data = compressedArray(materials.map((m) => m.data), anisotropy);
      return;
    }
    const pixels = materials as MaterialPixels[];
    const size = pixels[0].size;
    const layerBytes = size * size * 4;
    const color = new Uint8Array(layerBytes * pixels.length);
    const data = new Uint8Array(layerBytes * pixels.length);
    pixels.forEach((m, k) => {
      if (m.size !== size) throw new Error(`Material ${m.id}: ${m.size} px, the array has ${size} px`);
      color.set(m.color, k * layerBytes);
      data.set(m.data, k * layerBytes);
    });
    this.color = arrayTexture(color, size, pixels.length, SRGBColorSpace, anisotropy);
    this.data = arrayTexture(data, size, pixels.length, NoColorSpace, anisotropy);
  }

  dispose(): void {
    this.color.dispose();
    this.data.dispose();
  }
}

function arrayTexture(
  pixels: Uint8Array,
  size: number,
  depth: number,
  colorSpace: typeof SRGBColorSpace | typeof NoColorSpace,
  anisotropy: number,
): DataArrayTexture {
  const t = new DataArrayTexture(pixels, size, size, depth);
  t.format = RGBAFormat;
  t.type = UnsignedByteType;
  t.colorSpace = colorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  // The pixels live on the GPU from the upload on: the CPU copy (some 96 MB for eight 2k
  // materials twice) goes. The arrays never change after they are built
  t.onUpdate = () => {
    (t.image as { data: Uint8Array | null }).data = null;
    t.onUpdate = null;
  };
  return t;
}

/**
 * GPU-compressed layers as one array: each mip level the layers' blocks one
 * after the other. The transcoded layers go once they are in the array, and
 * the array's own copy once it is on the GPU
 */
function compressedArray(layers: CompressedTexture[], anisotropy: number): CompressedArrayTexture {
  const first = layers[0];
  const mipmaps = first.mipmaps!.map((level, l) => {
    const parts = layers.map((t) => t.mipmaps![l].data as Uint8Array);
    const data = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    let at = 0;
    for (const p of parts) {
      data.set(p, at);
      at += p.byteLength;
    }
    return { data, width: level.width, height: level.height };
  });
  for (const t of layers) t.dispose();
  const t = new CompressedArrayTexture(mipmaps as unknown as ImageData[], first.image.width, first.image.height, layers.length, first.format, first.type);
  t.colorSpace = first.colorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = mipmaps.length > 1 ? LinearMipmapLinearFilter : LinearFilter;
  t.generateMipmaps = false;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  t.onUpdate = () => {
    t.mipmaps = [];
    t.onUpdate = null;
  };
  return t;
}

/** The two splat maps as linear textures over the whole map; `refresh` re-uploads after edits */
export class SplatTextures {
  readonly maps: [DataTexture, DataTexture];

  constructor(private splat: MapSplat) {
    this.maps = [this.make(splat.maps[0]), this.make(splat.maps[1])];
  }

  /** Re-upload after the editor painted (same resolution) or replaced the splat */
  refresh(splat: MapSplat, rect?: TexelRect): void {
    if (splat.resolution !== this.splat.resolution) {
      this.dispose();
      (this.maps as DataTexture[])[0] = this.make(splat.maps[0]);
      (this.maps as DataTexture[])[1] = this.make(splat.maps[1]);
    } else {
      const same = this.maps[0].image.data === splat.maps[0] && this.maps[1].image.data === splat.maps[1];
      this.maps[0].image.data = splat.maps[0];
      this.maps[1].image.data = splat.maps[1];
      uploadRect(this.maps[0], same ? rect : undefined);
      uploadRect(this.maps[1], same ? rect : undefined);
    }
    this.splat = splat;
  }

  dispose(): void {
    this.maps[0].dispose();
    this.maps[1].dispose();
  }

  private make(pixels: Uint8Array): DataTexture {
    const r = this.splat.resolution;
    const t = new DataTexture(pixels, r, r, RGBAFormat, UnsignedByteType);
    t.colorSpace = NoColorSpace;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }
}

/** Path mask texture (road, path, across position) over the whole map */
export function maskTexture(pixels: Uint8Array, resolution: number): DataTexture {
  const t = new DataTexture(pixels, resolution, resolution, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * Surface normals of the height grid, one texel per sample (x and z of the
 * scene-space normal in RGB, half floats; alpha: near water, for wet banks). The terrain shader reads them bilinearly:
 * the cliff test and the base normal then change smoothly inside a cell
 * instead of following the mesh's diagonal, which drew saw teeth along
 * cliff edges.
 */
export class GridNormalTexture {
  readonly texture: DataTexture;
  private readonly pixels: Uint16Array;

  constructor(private readonly field: HeightField) {
    // Half floats: 8 bits per component band visibly on gentle slopes
    this.pixels = new Uint16Array(field.columns * field.rows * 4);
    this.texture = new DataTexture(this.pixels, field.columns, field.rows, RGBAFormat, HalfFloatType);
    this.texture.colorSpace = NoColorSpace;
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.update();
  }

  private wet: Float32Array | null = null;

  /**
   * Marks the samples within two cells of water (mask grown by two samples),
   * where the shader darkens banks just above the water level.
   */
  setWater(mask: Uint8Array | null, rect?: { i0: number; j0: number; i1: number; j1: number }): void {
    const f = this.field;
    // A brush on the mask: the samples within two of its rectangle, the rest stays
    const r = rect && this.wet ? { i0: Math.max(0, rect.i0 - 2), j0: Math.max(0, rect.j0 - 2), i1: Math.min(f.columns - 1, rect.i1 + 2), j1: Math.min(f.rows - 1, rect.j1 + 2) } : null;
    if (!mask) {
      this.wet = null;
    } else {
      const wet = r ? this.wet! : new Float32Array(f.columns * f.rows);
      for (let j = r?.j0 ?? 0; j <= (r?.j1 ?? f.rows - 1); j++) {
        for (let i = r?.i0 ?? 0; i <= (r?.i1 ?? f.columns - 1); i++) {
          let m = 0;
          for (let dj = -2; dj <= 2 && m === 0; dj++) {
            for (let di = -2; di <= 2; di++) {
              const ii = i + di;
              const jj = j + dj;
              if (ii >= 0 && jj >= 0 && ii < f.columns && jj < f.rows && mask[jj * f.columns + ii] > 0) {
                m = 1;
                break;
              }
            }
          }
          wet[j * f.columns + i] = m;
        }
      }
      this.wet = wet;
    }
    this.update(r ?? undefined);
  }

  /** Recomputes the samples in a rectangle (all when omitted) and re-uploads */
  update(rect?: { i0: number; j0: number; i1: number; j1: number }): void {
    const f = this.field;
    const i0 = Math.max(0, rect?.i0 ?? 0);
    const j0 = Math.max(0, rect?.j0 ?? 0);
    const i1 = Math.min(f.columns - 1, rect?.i1 ?? f.columns - 1);
    const j1 = Math.min(f.rows - 1, rect?.j1 ?? f.rows - 1);
    const c2 = 2 * f.cellSize;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dhdx = (f.sample(i + 1, j) - f.sample(i - 1, j)) / c2;
        const dhdy = (f.sample(i, j + 1) - f.sample(i, j - 1)) / c2;
        // Scene normal (dhdx, 1, -dhdy), normalised
        const len = Math.hypot(dhdx, 1, dhdy);
        const q = (j * f.columns + i) * 4;
        this.pixels[q] = DataUtils.toHalfFloat(dhdx / len);
        this.pixels[q + 1] = DataUtils.toHalfFloat(1 / len);
        this.pixels[q + 2] = DataUtils.toHalfFloat(-dhdy / len);
        this.pixels[q + 3] = this.wet ? DataUtils.toHalfFloat(this.wet[j * f.columns + i]) : 0;
      }
    }
    uploadRect(this.texture, rect ? { i0, j0, i1, j1 } : undefined);
  }

  dispose(): void {
    this.texture.dispose();
  }
}
