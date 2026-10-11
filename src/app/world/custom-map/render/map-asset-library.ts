import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
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
  /** Loads a GLB into a scene graph */
  loadModel?: (url: string) => Promise<Object3D>;
}

export class MapAssetLibrary {
  private static readonly instances = new Map<string, MapAssetLibrary>();

  /** The library for a base URL, created on first use */
  static shared(baseUrl = DEFAULT_ASSET_BASE): MapAssetLibrary {
    let lib = MapAssetLibrary.instances.get(baseUrl);
    if (!lib) {
      lib = new MapAssetLibrary(baseUrl);
      MapAssetLibrary.instances.set(baseUrl, lib);
    }
    return lib;
  }

  readonly textureSize: number;
  private catalogPromise: Promise<AssetCatalog> | null = null;
  private readonly materials = new Map<string, Promise<MaterialPixels>>();
  private readonly models = new Map<string, Promise<ObjectModel>>();
  private readonly fetchFn: typeof fetch;
  private readonly decodeImageFn: (url: string, size: number) => Promise<ImagePixels>;
  private readonly loadModelFn: (url: string) => Promise<Object3D>;

  constructor(
    readonly baseUrl = DEFAULT_ASSET_BASE,
    options: AssetLibraryOptions = {},
  ) {
    this.textureSize = options.textureSize ?? 1024;
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
    this.decodeImageFn = options.decodeImage ?? ((url, size) => decodeImage(this.fetchFn, url, size));
    this.loadModelFn = options.loadModel ?? ((url) => loadGlb(url));
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
      p = this.loadObject(id);
      this.models.set(id, p);
    }
    return p;
  }

  /**
   * The lower detail models of a catalogue object (`lod` entries), nearest
   * first, with the distance each one starts at. Broken files are skipped.
   */
  async lodModels(id: string): Promise<{ model: ObjectModel; distance: number }[]> {
    const entry = await this.objectEntry(id);
    const out: { model: ObjectModel; distance: number }[] = [];
    if (!entry?.lod) return out;
    for (const lod of [...entry.lod].sort((a, b) => a.distance - b.distance)) {
      const key = `${id}#${lod.file}`;
      let p = this.models.get(key);
      if (!p) {
        p = this.loadModelFn(this.url(lod.file)).then((root) => {
          const parts = collectParts(root);
          return { id, entry, parts, height: partsHeight(parts), placeholder: false };
        });
        this.models.set(key, p);
      }
      try {
        const model = await p;
        if (model.parts.length) out.push({ model, distance: lod.distance });
      } catch (error) {
        console.warn(`[MapAssetLibrary] LOD ${lod.file} of ${id} not loaded`, error);
      }
    }
    return out;
  }

  /** Frees the GPU side of every loaded model */
  dispose(): void {
    for (const p of this.models.values()) {
      void p.then((m) => {
        for (const part of m.parts) {
          part.geometry.dispose();
          part.material.dispose();
        }
      });
    }
    this.models.clear();
    this.materials.clear();
    for (const [key, lib] of MapAssetLibrary.instances) if (lib === this) MapAssetLibrary.instances.delete(key);
  }

  private url(path: string): string {
    return this.baseUrl + path;
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

let gltfLoader: GLTFLoader | null = null;

async function loadGlb(url: string): Promise<Object3D> {
  gltfLoader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await gltfLoader.loadAsync(url);
  return gltf.scene;
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

/** A simple stand-in of the entry's size, shaped by category */
function placeholderParts(entry: CatalogObject): ModelPart[] {
  const r = entry.footprint;
  const h = entry.height;
  const mat = (hex: number): MeshStandardMaterial => new MeshStandardMaterial({ color: hex, roughness: 0.9 });
  switch (entry.category) {
    case 'tree': {
      const trunk = new CylinderGeometry(r * 0.12, r * 0.18, h * 0.35, 6).translate(0, h * 0.175, 0);
      const crown = new ConeGeometry(r, h * 0.75, 8).translate(0, h * 0.625, 0);
      return [
        { geometry: trunk, material: mat(0x5a4030) },
        { geometry: crown, material: mat(0x2f5a2a) },
      ];
    }
    case 'rock':
    case 'plant': {
      const g = mergeVertices(new DodecahedronGeometry(r, 0)).scale(1, h / (2 * r), 1);
      g.translate(0, h / 2, 0);
      return [{ geometry: g, material: mat(entry.category === 'rock' ? 0x77736b : 0x4c7a34) }];
    }
    default:
      return [{ geometry: new BoxGeometry(r * 1.4, h, r * 1.4).translate(0, h / 2, 0), material: mat(0x9a8a70) }];
  }
}
