import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DodecahedronGeometry,
  DoubleSide,
  Material,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  type CompressedTexture,
  type Object3D,
} from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { compressedTextureLoader, transcodeKtx2 } from '../../../three-engine/models/ktx2-transcoder';
import { createModelLoader, sharedTexture } from '../../../three-engine/models/model-loader';
import { mapDataFetch, mapDataUrl } from '../map-data';
import { shareGpu, unshareGpu } from '../../../three-engine/shared-gpu';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hexToRgb, parseCatalog, type AssetCatalog, type CatalogMaterial, type CatalogObject } from './asset-catalog';

/**
 * Loads the asset catalogue, ground material pixels and object models once
 * and keeps them for every map view (editor and game share one library per
 * base URL, see `shared`).
 *
 * Ground materials come as packed pixels, not as textures: a view stacks the
 * layers its map uses into texture arrays (terrain-textures.ts). Missing or
 * broken files fall back to a flat colour or a placeholder shape, so a map
 * always renders.
 */

export const DEFAULT_ASSET_BASE = 'maps/assets/';

/** One ground material, decoded and packed for the terrain texture arrays */
export interface MaterialPixels {
  id: string;
  size: number;
  /** RGBA: albedo (sRGB) and height in alpha */
  color: Uint8Array;
  /** RGBA: normal x, normal y, roughness, ambient occlusion */
  data: Uint8Array;
  /** Average albedo, sRGB 0..1 */
  average: [number, number, number];
}

/**
 * A ground material's two terrain layers as GPU-compressed textures with
 * their mipmaps (KTX2 through the transcoder worker), instead of pixels
 */
export interface MaterialCompressed {
  id: string;
  size: number;
  color: CompressedTexture;
  data: CompressedTexture;
  average: [number, number, number];
}

export interface ModelPart {
  geometry: BufferGeometry;
  material: Material;
}

export interface ObjectModel {
  id: string;
  entry: CatalogObject;
  parts: ModelPart[];
  /** Height of the model's bounding box in metres */
  height: number;
  placeholder: boolean;
}

export interface ImagePixels {
  width: number;
  height: number;
  /** RGBA */
  data: Uint8ClampedArray | Uint8Array;
}

export interface AssetLibraryOptions {
  /** Edge length of the material textures; every layer shares it */
  textureSize?: number;
  fetch?: typeof fetch;
  /** Decodes an image file to RGBA pixels of size x size */
  decodeImage?: (url: string, size: number) => Promise<ImagePixels>;
  /** Loads a GLB into a scene graph; default: the packed models with their shared textures (createModelLoader) */
  loadModel?: (url: string) => Promise<Object3D>;
  /** Loads an image into a texture (the far boxes' atlas) */
  loadTexture?: (url: string) => Promise<Texture>;
}

/** The atlas of the buildings' far stage (objects/far-boxes.ts, tools/map-assets/bake_far_boxes.mjs) */
export const FAR_ATLAS_FILE = 'models/far-boxes.webp';

export class MapAssetLibrary {
  private static readonly instances = new Map<string, MapAssetLibrary>();

  /** The library for a base URL (the map data's assets, map-data.ts, by default), created on first use */
  static shared(baseUrl = mapDataUrl(DEFAULT_ASSET_BASE)): MapAssetLibrary {
    let lib = MapAssetLibrary.instances.get(baseUrl);
    if (!lib) {
      lib = new MapAssetLibrary(baseUrl);
      MapAssetLibrary.instances.set(baseUrl, lib);
      // Its models outlive every renderer that draws them (shared-gpu.ts), until it goes
      shareGpu(lib.gpuSide);
    }
    return lib;
  }

  readonly textureSize: number;
  private catalogPromise: Promise<AssetCatalog> | null = null;
  private readonly materials = new Map<string, Promise<MaterialPixels>>();
  private readonly models = new Map<string, Promise<ObjectModel>>();
  /** What a renderer that goes frees of a shared library (shared-gpu.ts) */
  private readonly gpuSide = { dispose: () => this.releaseGpu() };
  /** The models of `models` that have loaded, for releaseGpu (it frees them at once, not a tick later) */
  private readonly loaded = new Set<ObjectModel>();
  private readonly fetchFn: typeof fetch;
  private readonly decodeImageFn: (url: string, size: number) => Promise<ImagePixels>;
  private readonly loadModelFn: (url: string) => Promise<Object3D>;
  private readonly loadTextureFn: (url: string) => Promise<Texture>;
  private farAtlasPromise: Promise<Texture | null> | null = null;
  /**
   * The shared model textures (textures/<name>-<hash>.ktx2) by URL: a brick
   * that thirty buildings use is one texture for all of them
   */
  private readonly sharedTextures = new Map<string, Promise<Texture | null>>();
  private gltfLoader: GLTFLoader | null = null;

  constructor(
    readonly baseUrl = DEFAULT_ASSET_BASE,
    options: AssetLibraryOptions = {},
  ) {
    this.textureSize = options.textureSize ?? 1024;
    this.fetchFn = options.fetch ?? ((input, init) => mapDataFetch(input, init));
    this.decodeImageFn = options.decodeImage ?? ((url, size) => decodeImage(this.fetchFn, url, size));
    this.loadModelFn = options.loadModel ?? ((url) => this.loadGlb(url));
    this.loadTextureFn = options.loadTexture ?? ((url) => loadTexture(url, this.fetchFn));
  }

  /** The far boxes' atlas, once; null (with a warning) when it does not load: the buildings keep their LOD models */
  farAtlas(): Promise<Texture | null> {
    this.farAtlasPromise ??= this.loadTextureFn(this.url(FAR_ATLAS_FILE)).catch((error) => {
      console.warn('[MapAssetLibrary] far box atlas not loaded', error);
      return null;
    });
    return this.farAtlasPromise;
  }

  /** The catalogue; an unreachable catalogue gives an empty one (with a warning) */
  catalog(): Promise<AssetCatalog> {
    this.catalogPromise ??= this.fetchFn(this.url('catalog.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => parseCatalog(json))
      .catch((error: unknown) => {
        console.warn('[MapAssetLibrary] catalogue not loaded, maps render with placeholders', error);
        return { version: 1, materials: [], objects: [] };
      });
    return this.catalogPromise;
  }

  async materialEntry(id: string): Promise<CatalogMaterial | null> {
    return (await this.catalog()).materials.find((m) => m.id === id) ?? null;
  }

  async objectEntry(id: string): Promise<CatalogObject | null> {
    return (await this.catalog()).objects.find((o) => o.id === id) ?? null;
  }

  /**
   * A ground material for the terrain: GPU-compressed where the catalogue
   * has its packed files and the page has a transcoder (WebGL2,
   * compressedTextureLoader), else its pixels (`material`). The compressed ones are not kept: the
   * terrain's arrays hold them on the GPU, and the files stay in the map
   * data's cache.
   */
  async materialTextures(id: string): Promise<MaterialPixels | MaterialCompressed> {
    const entry = await this.materialEntry(id);
    const packed = entry?.files.packed;
    const loader = entry && packed ? compressedTextureLoader() : null;
    if (!entry || !packed || !loader) return this.material(id);
    try {
      const load = async (path: string): Promise<CompressedTexture> => {
        const res = await this.fetchFn(this.url(path));
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
        const buffer = await res.arrayBuffer();
        return transcodeKtx2(loader, buffer);
      };
      const [color, data] = await Promise.all([load(packed.color), load(packed.data)]);
      return { id, size: color.image.width, color, data, average: hexToRgb(entry.average) };
    } catch (error) {
      console.warn(`[MapAssetLibrary] packed material ${id} not loaded, decoding its images`, error);
      return this.material(id);
    }
  }

  /**
   * Gets a ground material's files on their way before the terrain asks
   * (map start): the packed KTX2 files into the map data's cache, where
   * there are some, else the decoded pixels as `material` keeps them
   */
  async prefetchMaterial(id: string): Promise<void> {
    const packed = (await this.materialEntry(id))?.files.packed;
    if (!packed) {
      await this.material(id);
      return;
    }
    await Promise.all([packed.color, packed.data].map(async (path) => (await this.fetchFn(this.url(path))).arrayBuffer()));
  }

  /** Packed pixels of a ground material; unknown ids and broken files give a flat grey-green */
  material(id: string): Promise<MaterialPixels> {
    let p = this.materials.get(id);
    if (!p) {
      p = this.loadMaterial(id);
      this.materials.set(id, p);
    }
    return p;
  }

  /** A catalogue object's model; unknown ids and broken files give a placeholder shape */
  model(id: string): Promise<ObjectModel> {
    let p = this.models.get(id);
    if (!p) {
      p = this.loadObject(id).then((m) => this.keep(m));
      this.models.set(id, p);
    }
    return p;
  }

  /**
   * The lower detail models of a catalogue object (`lod` entries), nearest
   * first, with the screen share each one takes over at. Broken files are skipped.
   * A part whose material has the name of one of the full model's draws
   * with that one (sharedMaterials): a tree's far copy shares the model's
   * materials and programs (its textures are the model's shared files).
   */
  async lodModels(id: string): Promise<{ model: ObjectModel; screen: number }[]> {
    const entry = await this.objectEntry(id);
    if (!entry?.lod) return [];
    // All of them at once, nearest (the largest screen share) first in the answer
    const loaded = await Promise.all(
      [...entry.lod].sort((a, b) => b.screen - a.screen).map(async (lod) => {
        const key = `${id}#${lod.file}`;
        let p = this.models.get(key);
        if (!p) {
          this.startTextures(lod.textures);
          p = Promise.all([this.loadModelFn(this.url(lod.file)), this.model(id)]).then(([root, full]) => {
            const parts = sharedMaterials(collectParts(root), full.parts);
            return this.keep({ id, entry, parts, height: partsHeight(parts), placeholder: false });
          });
          this.models.set(key, p);
        }
        try {
          const model = await p;
          return model.parts.length ? { model, screen: lod.screen } : null;
        } catch (error) {
          console.warn(`[MapAssetLibrary] LOD ${lod.file} of ${id} not loaded`, error);
          return null;
        }
      }),
    );
    return loaded.filter((l): l is { model: ObjectModel; screen: number } => l !== null);
  }

  /** Frees the GPU side of every loaded model and forgets them */
  dispose(): void {
    this.releaseGpu();
    unshareGpu(this.gpuSide);
    this.models.clear();
    this.loaded.clear();
    this.materials.clear();
    void this.farAtlasPromise?.then((t) => t?.dispose());
    this.farAtlasPromise = null;
    this.sharedTextures.clear();
    for (const [key, lib] of MapAssetLibrary.instances) if (lib === this) MapAssetLibrary.instances.delete(key);
  }

  /**
   * Frees the GPU side of every loaded model, LOD models included: geometry, material and its textures. The
   * models stay loaded; the next renderer to draw them uploads them again
   */
  releaseGpu(): void {
    for (const m of this.loaded) {
      for (const part of m.parts) {
        part.geometry.dispose();
        disposeTextures(part.material);
        part.material.dispose();
      }
    }
  }

  private keep(model: ObjectModel): ObjectModel {
    this.loaded.add(model);
    return model;
  }

  private url(path: string): string {
    return this.baseUrl + path;
  }

  /** Starts the shared textures a model file names (catalogue `textures`) beside its GLB; the model takes them from the cache */
  private startTextures(paths: readonly string[] | undefined): void {
    for (const path of paths ?? []) {
      const url = new URL(this.url(path), typeof document !== 'undefined' ? document.baseURI : 'http://localhost/').href;
      sharedTexture(url, this.sharedTextures, this.fetchFn).catch(() => undefined);
    }
  }

  /** A model's file through the map data's cache, then parsed; its shared textures come through the same cache */
  private async loadGlb(url: string): Promise<Object3D> {
    this.gltfLoader ??= createModelLoader({ fetch: this.fetchFn, sharedTextures: this.sharedTextures });
    const response = await this.fetchFn(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const gltf = await this.gltfLoader.parseAsync(await response.arrayBuffer(), url.slice(0, url.lastIndexOf('/') + 1));
    return gltf.scene;
  }

  private async loadMaterial(id: string): Promise<MaterialPixels> {
    const entry = await this.materialEntry(id);
    const size = this.textureSize;
    if (!entry) return flatMaterial(id, size, [0.36, 0.42, 0.25]);
    try {
      const [color, normal, arh] = await Promise.all([
        this.decodeImageFn(this.url(entry.files.color), size),
        this.decodeImageFn(this.url(entry.files.normal), size),
        this.decodeImageFn(this.url(entry.files.arh), size),
      ]);
      return packMaterial(id, size, color, normal, arh, hexToRgb(entry.average));
    } catch (error) {
      console.warn(`[MapAssetLibrary] material ${id} not loaded, using its average colour`, error);
      return flatMaterial(id, size, hexToRgb(entry.average));
    }
  }

  private async loadObject(id: string): Promise<ObjectModel> {
    const entry = (await this.objectEntry(id)) ?? placeholderEntry(id);
    // Effect-only entries (waterfall, fireflies, fog bank) have no mesh at all
    if (!entry.file && (entry.effects?.length || entry.light)) {
      return { id, entry, parts: [], height: entry.height, placeholder: false };
    }
    if (entry.file) {
      try {
        this.startTextures(entry.textures);
        const root = await this.loadModelFn(this.url(entry.file));
        const parts = collectParts(root);
        if (parts.length > 0) return { id, entry, parts, height: partsHeight(parts), placeholder: false };
      } catch (error) {
        console.warn(`[MapAssetLibrary] model ${id} not loaded, using a placeholder`, error);
      }
    }
    const parts = placeholderParts(entry);
    return { id, entry, parts, height: partsHeight(parts), placeholder: true };
  }
}

/** Packs the three decoded maps of a material into the two layer textures */
export function packMaterial(
  id: string,
  size: number,
  color: ImagePixels,
  normal: ImagePixels,
  arh: ImagePixels,
  average: [number, number, number],
): MaterialPixels {
  const n = size * size;
  const outColor = new Uint8Array(n * 4);
  const outData = new Uint8Array(n * 4);
  for (let p = 0, q = 0; p < n; p++, q += 4) {
    outColor[q] = color.data[q];
    outColor[q + 1] = color.data[q + 1];
    outColor[q + 2] = color.data[q + 2];
    outColor[q + 3] = arh.data[q + 2]; // height
    outData[q] = normal.data[q];
    outData[q + 1] = normal.data[q + 1];
    outData[q + 2] = arh.data[q + 1]; // roughness
    outData[q + 3] = arh.data[q]; // ambient occlusion
  }
  return { id, size, color: outColor, data: outData, average };
}

/** A material of one colour: flat normal, rough, mid height */
export function flatMaterial(id: string, size: number, rgb: [number, number, number]): MaterialPixels {
  const n = size * size;
  const color = new Uint8Array(n * 4);
  const data = new Uint8Array(n * 4);
  for (let q = 0; q < n * 4; q += 4) {
    color[q] = Math.round(rgb[0] * 255);
    color[q + 1] = Math.round(rgb[1] * 255);
    color[q + 2] = Math.round(rgb[2] * 255);
    color[q + 3] = 128;
    data[q] = 128;
    data[q + 1] = 128;
    data[q + 2] = 230;
    data[q + 3] = 255;
  }
  return { id, size, color, data, average: rgb };
}

async function decodeImage(fetchFn: typeof fetch, url: string, size: number): Promise<ImagePixels> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const bitmap = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
    resizeWidth: size,
    resizeHeight: size,
    resizeQuality: 'high',
  });
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: image.data };
}

/** An image file through `fetchFn` (the map data's cache) into an sRGB texture with mipmaps */
async function loadTexture(url: string, fetchFn: typeof fetch): Promise<Texture> {
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const texture = new Texture(bitmap);
  // An ImageBitmap uploads as decoded, top row first
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Foliage cards (materials named `foliage-*` by build_models.py, or any
 * material with an alpha-blended texture) draw alpha-tested and double
 * sided: sorting thousands of blended cards is not possible, and alpha to
 * coverage smooths the cut edges under MSAA.
 */
function prepareMaterial(material: Material): void {
  const m = material as MeshStandardMaterial;
  if (m.name.startsWith('foliage-') || (m.transparent && m.map)) {
    m.transparent = false;
    m.alphaTest = 0.4;
    m.alphaToCoverage = true;
    m.side = DoubleSide;
    m.depthWrite = true;
  }
}

/** Every mesh of a model with its node transform baked into a copy of the geometry */
/**
 * `parts` with each textured material that has the name of one of
 * `full`'s replaced by that one, the replaced material and its textures
 * freed (never drawn, so never uploaded). Only textured parts with UVs: a
 * plain-coloured copy (the builders' flat LODs, no UVs) keeps its own
 * colour, and merges with its like as before
 */
export function sharedMaterials(parts: ModelPart[], full: readonly ModelPart[]): ModelPart[] {
  const byName = new Map<string, Material>();
  for (const p of full) if (p.material.name && !byName.has(p.material.name)) byName.set(p.material.name, p.material);
  const freed = new Set<Material>();
  const out = parts.map((p) => {
    const textured = !!(p.material as MeshStandardMaterial).map && p.geometry.hasAttribute('uv');
    const shared = textured && p.material.name ? byName.get(p.material.name) : undefined;
    if (!shared || shared === p.material) return p;
    freed.add(p.material);
    return { geometry: p.geometry, material: shared };
  });
  for (const m of freed) {
    for (const value of Object.values(m)) if (value instanceof Texture) value.dispose();
    m.dispose();
  }
  return out;
}

function collectParts(root: Object3D): ModelPart[] {
  root.updateMatrixWorld(true);
  const parts: ModelPart[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const materials: Material[] = Array.isArray(obj.material) ? obj.material : [obj.material];
    materials.forEach(prepareMaterial);
    const geometry = dequantize((obj.geometry as BufferGeometry).clone()).applyMatrix4(obj.matrixWorld);
    if (materials.length === 1) {
      parts.push({ geometry, material: materials[0] });
      return;
    }
    // Multi-material meshes: one part per group
    for (const group of geometry.groups) {
      const sub = geometry.clone();
      sub.clearGroups();
      sub.setDrawRange(group.start, group.count);
      parts.push({ geometry: sub, material: materials[group.materialIndex ?? 0] });
    }
  });
  return parts;
}

/**
 * Meshopt-compressed models store positions and normals as normalised
 * integers (KHR_mesh_quantization) with the scale on the node; baking the
 * node transform needs floats, or the integers are overwritten with
 * truncated metres.
 */
function dequantize(geometry: BufferGeometry): BufferGeometry {
  for (const name of ['position', 'normal', 'tangent']) {
    const attr = geometry.getAttribute(name);
    if (!attr || (attr.array instanceof Float32Array && !attr.normalized)) continue;
    const out = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) {
      for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
    }
    geometry.setAttribute(name, new BufferAttribute(out, attr.itemSize));
  }
  return geometry;
}

function partsHeight(parts: ModelPart[]): number {
  let top = 0;
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    top = Math.max(top, part.geometry.boundingBox?.max.y ?? 0);
  }
  return top;
}

function placeholderEntry(id: string): CatalogObject {
  return {
    id,
    name: id,
    category: 'prop',
    file: '',
    footprint: 1,
    height: 2,
    blocksLos: false,
    blocksBuild: true,
    scaleRange: [1, 1],
    randomRotation: true,
    wind: 0,
    drawDistance: 1500,
  };
}

/** A magenta and black checkerboard: a missing model shows at once, by day and at night */
function placeholderMaterial(): MeshStandardMaterial {
  const cells = 8;
  const data = new Uint8Array(cells * cells * 4);
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const magenta = (x + y) % 2 === 0;
      data.set(magenta ? [255, 0, 255, 255] : [0, 0, 0, 255], (y * cells + x) * 4);
    }
  }
  const checker = new DataTexture(data, cells, cells);
  checker.magFilter = NearestFilter;
  checker.minFilter = NearestFilter;
  checker.wrapS = checker.wrapT = RepeatWrapping;
  checker.colorSpace = SRGBColorSpace;
  checker.needsUpdate = true;
  return new MeshStandardMaterial({ map: checker, emissiveMap: checker, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.9 });
}

/** A simple stand-in of the entry's size, shaped by category, in the placeholder checkerboard */
function placeholderParts(entry: CatalogObject): ModelPart[] {
  const r = entry.footprint;
  const h = entry.height;
  switch (entry.category) {
    case 'tree': {
      const trunk = new CylinderGeometry(r * 0.12, r * 0.18, h * 0.35, 6).translate(0, h * 0.175, 0);
      const crown = new ConeGeometry(r, h * 0.75, 8).translate(0, h * 0.625, 0);
      return [
        { geometry: trunk, material: placeholderMaterial() },
        { geometry: crown, material: placeholderMaterial() },
      ];
    }
    case 'rock':
    case 'plant': {
      const g = mergeVertices(new DodecahedronGeometry(r, 0)).scale(1, h / (2 * r), 1);
      g.translate(0, h / 2, 0);
      return [{ geometry: g, material: placeholderMaterial() }];
    }
    default:
      return [{ geometry: new BoxGeometry(r * 1.4, h, r * 1.4).translate(0, h / 2, 0), material: placeholderMaterial() }];
  }
}

/** Disposes every texture a material holds (map, normalMap, roughnessMap, ...) */
function disposeTextures(material: Material): void {
  for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
}
