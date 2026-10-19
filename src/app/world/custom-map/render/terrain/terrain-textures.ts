import {
  Box2,
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
  Vector3,
  type CompressedTexture,
  type WebGLRenderer,
} from 'three';
import type { MapSplat } from '../../map-document';
import type { HeightField } from '../height-field';
import type { GroundBaker } from './ground-shape';
import { gridWet, wetReach, writeGridNormals } from './grid-normals';
import type { MapAssetLibrary, MaterialCompressed, MaterialPixels } from '../map-asset-library';
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

/**
 * The ground materials `ids` as texture arrays: GPU-compressed layers where
 * every one came so, else the pixels of all (an array is never mixed); the
 * materials come back too (their mean colours)
 */
export async function loadMaterialArrays(
  assets: MapAssetLibrary,
  ids: readonly string[],
  anisotropy: number,
): Promise<{ arrays: MaterialArrays; materials: MaterialPixels[] | MaterialCompressed[] }> {
  const textures = await Promise.all(ids.map((id) => assets.materialTextures(id)));
  let materials: MaterialPixels[] | MaterialCompressed[];
  if (compressedTogether(textures)) {
    materials = textures;
  } else {
    for (const m of textures.filter(isCompressed)) {
      m.color.dispose();
      m.data.dispose();
    }
    materials = await Promise.all(ids.map((id) => assets.material(id)));
  }
  return { arrays: new MaterialArrays(materials, anisotropy), materials };
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

/**
 * The splat maps as one texture array over the whole map, a layer per map
 * (two, three past 8 layers): one texture unit for what were three, in the
 * ground's program and in everything that reads the ground's colour
 * (groundColorAt). The array holds no copy of the pixels: each layer goes
 * up from the document's own map, whole when it is new, else the rectangle
 * a stroke painted, before the ground next draws (`flush`, from its
 * material's onBeforeRender). Until then three only allocates it.
 */
export class SplatTextures {
  array: DataArrayTexture;
  private resolution: number;
  /** The maps as textures three never uploads: the source of each layer's upload */
  private readonly sources: DataTexture[] = [];
  /** By layer: the rectangle that waits to go up, null when none */
  private readonly pending: (TexelRect | null)[] = [];
  private readonly region = new Box2();
  private readonly at = new Vector3();

  constructor(splat: MapSplat) {
    this.resolution = splat.resolution;
    this.array = this.make(splat);
  }

  /**
   * After the editor painted (`rect`, in splat texels) or replaced the
   * splat: what changed goes up with the next flush. Another resolution or
   * another number of maps makes a new array; true when it did (the
   * materials take it anew)
   */
  refresh(splat: MapSplat, rect?: TexelRect): boolean {
    if (splat.resolution !== this.resolution || splat.maps.length !== this.sources.length) {
      this.array.dispose();
      this.resolution = splat.resolution;
      this.array = this.make(splat);
      return true;
    }
    const r = this.resolution - 1;
    splat.maps.forEach((pixels, k) => {
      const source = this.sources[k];
      const same = source.image.data === pixels;
      source.image.data = pixels;
      const whole = { i0: 0, j0: 0, i1: r, j1: r };
      const add = same && rect ? { i0: Math.max(0, rect.i0), j0: Math.max(0, rect.j0), i1: Math.min(r, rect.i1), j1: Math.min(r, rect.j1) } : whole;
      if (add.i1 < add.i0 || add.j1 < add.j0) return;
      const p = this.pending[k];
      this.pending[k] = p ? { i0: Math.min(p.i0, add.i0), j0: Math.min(p.j0, add.j0), i1: Math.max(p.i1, add.i1), j1: Math.max(p.j1, add.j1) } : add;
    });
    return false;
  }

  /** Uploads what waits, each layer's rectangle from its map; nothing when nothing does */
  flush(renderer: WebGLRenderer): void {
    for (let k = 0; k < this.pending.length; k++) {
      const p = this.pending[k];
      if (!p) continue;
      this.pending[k] = null;
      this.region.min.set(p.i0, p.j0);
      this.region.max.set(p.i1 + 1, p.j1 + 1);
      renderer.copyTextureToTexture(this.sources[k], this.array, this.region, this.at.set(p.i0, p.j0, k));
    }
  }

  dispose(): void {
    this.array.dispose();
  }

  private make(splat: MapSplat): DataArrayTexture {
    const r = this.resolution;
    this.sources.length = 0;
    this.pending.length = 0;
    for (const pixels of splat.maps) {
      this.sources.push(new DataTexture(pixels, r, r, RGBAFormat, UnsignedByteType));
      this.pending.push({ i0: 0, j0: 0, i1: r - 1, j1: r - 1 });
    }
    const t = new DataArrayTexture(null, r, r, splat.maps.length);
    t.format = RGBAFormat;
    t.type = UnsignedByteType;
    t.colorSpace = NoColorSpace;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearFilter;
    t.generateMipmaps = false;
    t.name = 'splat';
    // Storage only: the layers go up from the maps (flush)
    t.source.dataReady = false;
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
 * cliff edges. The texels come from grid-normals.ts, worked out here or by a
 * `baker` (the game's ground worker) the first time; until it answers the
 * ground stands flat and dry (`settled`).
 */
export class GridNormalTexture {
  readonly texture: DataTexture;
  private readonly pixels: Uint16Array;
  private wet: Float32Array | null = null;
  /** Counts the changes made here: a baker's answer for an older state is dropped */
  private changes = 0;
  /** The first texels are in */
  readonly settled: Promise<void>;

  /** @param water The water's mask (setWater): normals and wet banks worked out once, not the normals twice */
  constructor(
    private readonly field: HeightField,
    water: Uint8Array | null = null,
    baker: GroundBaker | null = null,
  ) {
    // Half floats: 8 bits per component band visibly on gentle slopes
    this.pixels = new Uint16Array(field.columns * field.rows * 4);
    this.texture = new DataTexture(this.pixels, field.columns, field.rows, RGBAFormat, HalfFloatType);
    this.texture.colorSpace = NoColorSpace;
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    const ask = baker?.normals?.(water);
    if (!ask) {
      this.setWater(water);
      this.settled = Promise.resolve();
      return;
    }
    // Flat and dry until the baker's texels are in
    const up = DataUtils.toHalfFloat(1);
    for (let q = 1; q < this.pixels.length; q += 4) this.pixels[q] = up;
    uploadRect(this.texture, undefined);
    const asked = this.changes;
    this.settled = ask.then((done) => {
      if (asked !== this.changes) return;
      if (!done) {
        this.setWater(water);
        return;
      }
      this.pixels.set(done.pixels);
      this.wet = done.wet;
      uploadRect(this.texture, undefined);
    });
  }

  /**
   * How near each sample lies to the water, in the alpha channel: 1 within
   * WET_REACH samples (the shader darkens banks just above the water level
   * there), fading to 0 at SHORE_REACH (the shore strip of the biome). A
   * chamfer distance over the mask (gridWet); a brush redoes its rectangle
   * and the reach round it.
   */
  setWater(mask: Uint8Array | null, rect?: { i0: number; j0: number; i1: number; j1: number }): void {
    const f = this.field;
    const r = rect && this.wet ? wetReach(rect, f.columns, f.rows) : null;
    this.wet = mask ? gridWet(mask, f.columns, f.rows, r ? rect! : null, r ? this.wet : null) : null;
    this.update(r ?? undefined);
  }

  /** Recomputes the samples in a rectangle (all when omitted) and re-uploads */
  update(rect?: { i0: number; j0: number; i1: number; j1: number }): void {
    this.changes++;
    const f = this.field;
    const r = {
      i0: Math.max(0, rect?.i0 ?? 0),
      j0: Math.max(0, rect?.j0 ?? 0),
      i1: Math.min(f.columns - 1, rect?.i1 ?? f.columns - 1),
      j1: Math.min(f.rows - 1, rect?.j1 ?? f.rows - 1),
    };
    writeGridNormals(f.grid.heights, f.columns, f.rows, f.cellSize, this.wet, this.pixels, r);
    uploadRect(this.texture, rect ? r : undefined);
  }

  dispose(): void {
    this.texture.dispose();
  }
}
