/**
 * Model inspector for the enemy model budget (docs/ENEMY_MODEL_BUDGET.md).
 *
 * Reads GLB and binary FBX files without a parser dependency and reports what
 * the three.js loaders turn them into: meshes, which of them are skinned,
 * vertex and triangle counts, skins, materials, embedded image sizes and
 * animation clips.
 *
 * Follows the loaders where they change the numbers:
 * - GLTFLoader builds one Mesh per primitive and node instance. A node with a
 *   skin makes all its primitives SkinnedMeshes. Primitives that share a
 *   POSITION accessor each carry the full vertex array.
 * - FBXLoader builds one Mesh per Model->Geometry link, non-indexed, so every
 *   triangle of the fan-triangulated polygons brings three vertices.
 * - A clip lasts until the last key time over all of its tracks.
 */

import { readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

export interface ImageInfo {
  label: string;
  mimeType: string;
  width: number;
  height: number;
  /**
   * Base colour images only: texels with alpha below LOW_ALPHA. 0 for JPEG,
   * which has no alpha; null when the format is not decoded (WebP, KTX2,
   * interlaced PNG).
   */
  lowAlphaTexels?: number | null;
}

/** Alpha below which the VAT shader discards in blend mode (vat-material.ts). */
export const LOW_ALPHA = 0.05;

/**
 * Distinct vertices by position, by position + UV and by position + normal +
 * UV. Below the mesh's vertex count they show what welding could save: the
 * gap to `positionsUv` is spent on normal splits (hard edges), the gap to
 * `positions` on UV seams.
 */
export interface WeldInfo {
  positions: number;
  positionsUv: number;
  positionsNormalUv: number;
}

export interface MeshInfo {
  name: string;
  skinned: boolean;
  vertices: number;
  triangles: number;
  /** Vertex buffer identity; meshes sharing one bake its vertices twice. */
  vertexSource: string;
  morphTargets: number;
  /** Base colour image of the mesh's material. */
  diffuse: ImageInfo | null;
  /** Null when the vertex data could not be read. */
  weld: WeldInfo | null;
}

export interface ClipInfo {
  name: string;
  /** Seconds, as three.js computes AnimationClip.duration. */
  duration: number;
  channels: number;
  /** Key times summed over all channels. */
  keyframes: number;
}

export interface ModelInfo {
  format: 'glb' | 'fbx';
  fileBytes: number;
  /** In three.js traverse order. */
  meshes: MeshInfo[];
  /** Joint count per skin. */
  skins: number[];
  /** Distinct joints over all skins. */
  bones: number;
  materials: number;
  images: ImageInfo[];
  clips: ClipInfo[];
  /** A skinned primitive has JOINTS_1; three.js reads four influences only. */
  extraJointSets: boolean;
}

export function inspectModel(path: string): ModelInfo {
  const buf = readFileSync(path);
  const fileBytes = statSync(path).size;
  if (buf.length >= 4 && buf.readUInt32LE(0) === GLB_MAGIC) {
    return { ...inspectGlb(buf, dirname(path)), fileBytes };
  }
  if (path.toLowerCase().endsWith('.gltf')) {
    return { ...inspectGltf(JSON.parse(buf.toString('utf8')) as GltfJson, null, dirname(path)), fileBytes };
  }
  if (buf.toString('latin1', 0, 18) === 'Kaydara FBX Binary') {
    return { ...inspectFbx(buf), fileBytes };
  }
  throw new Error(`${path}: neither GLB nor binary FBX`);
}

// ---------------------------------------------------------------------------
// Image headers
// ---------------------------------------------------------------------------

/** Width and height from a PNG, JPEG, WebP or KTX2 header, or null. */
export function imageSize(bytes: Buffer): { mimeType: string; width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { mimeType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let p = 2;
    while (p + 9 < bytes.length) {
      if (bytes[p] !== 0xff) { p++; continue; }
      const marker = bytes[p + 1];
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { mimeType: 'image/jpeg', width: bytes.readUInt16BE(p + 7), height: bytes.readUInt16BE(p + 5) };
      }
      p += 2 + bytes.readUInt16BE(p + 2);
    }
    return null;
  }
  if (bytes.length >= 30 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('latin1', 12, 16);
    if (chunk === 'VP8 ') {
      return { mimeType: 'image/webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const bits = bytes.readUInt32LE(21);
      return { mimeType: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      return { mimeType: 'image/webp', width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    }
    return null;
  }
  if (bytes.length >= 28 && bytes.toString('latin1', 1, 7) === 'KTX 20') {
    return { mimeType: 'image/ktx2', width: bytes.readUInt32LE(20), height: bytes.readUInt32LE(24) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// PNG pixels
// ---------------------------------------------------------------------------

/** RGBA bytes of a decoded image, row by row from the top. */
export interface DecodedImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Channels per PNG colour type: grey, RGB, palette, grey + alpha, RGBA. */
const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * The pixels of a PNG as RGBA, with tRNS applied, 16-bit channels cut to
 * their high byte. Null for anything but a PNG and for interlaced ones.
 */
export function decodePng(bytes: Buffer): DecodedImage | null {
  if (bytes.length < 33 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let p = 8; p + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(p);
    const type = bytes.toString('latin1', p + 4, p + 8);
    const data = bytes.subarray(p + 8, p + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + length;
  }
  const channels = PNG_CHANNELS[colorType];
  if (!channels || interlace !== 0 || width === 0 || height === 0) return null;
  if (colorType === 3 && !palette) return null;

  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) return null;

  // Undo the per-row filters (PNG spec, section 9)
  const lines = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? lines[out + x - bpp] : 0;
      const b = y > 0 ? lines[out - stride + x] : 0;
      const c = x >= bpp && y > 0 ? lines[out - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) return null;
      lines[out + x] = v & 0xff;
    }
  }

  /** Channel `ch` of pixel `x` in row `y` at the file's bit depth. */
  const sample = (y: number, x: number, ch: number): number => {
    const row = y * stride;
    if (depth === 8) return lines[row + x * channels + ch];
    if (depth === 16) return (lines[row + (x * channels + ch) * 2] << 8) | lines[row + (x * channels + ch) * 2 + 1];
    const bit = x * depth; // depth 1, 2 or 4: grey or palette only
    return (lines[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const to8 = (v: number): number =>
    depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  const trnsAt = (i: number): number => (trns && trns.length >= 2 * i + 2 ? trns.readUInt16BE(2 * i) : -1);

  const data = new Uint8Array(width * height * 4);
  for (let y = 0, o = 0; y < height; y++) {
    for (let x = 0; x < width; x++, o += 4) {
      if (colorType === 3) {
        const index = sample(y, x, 0);
        data[o] = palette![index * 3];
        data[o + 1] = palette![index * 3 + 1];
        data[o + 2] = palette![index * 3 + 2];
        data[o + 3] = trns && index < trns.length ? trns[index] : 255;
      } else if (colorType === 0 || colorType === 4) {
        const grey = sample(y, x, 0);
        data[o] = data[o + 1] = data[o + 2] = to8(grey);
        data[o + 3] = colorType === 4 ? to8(sample(y, x, 1)) : grey === trnsAt(0) ? 0 : 255;
      } else {
        const r = sample(y, x, 0), g = sample(y, x, 1), b = sample(y, x, 2);
        data[o] = to8(r);
        data[o + 1] = to8(g);
        data[o + 2] = to8(b);
        data[o + 3] = colorType === 6 ? to8(sample(y, x, 3))
          : r === trnsAt(0) && g === trnsAt(1) && b === trnsAt(2) ? 0 : 255;
      }
    }
  }
  return { data, width, height };
}

/** Sets `lowAlphaTexels` of a base colour image, once per image. */
function countLowAlpha(info: ImageInfo, bytes: Buffer | null): ImageInfo {
  if (info.lowAlphaTexels !== undefined) return info;
  if (info.mimeType === 'image/jpeg') {
    info.lowAlphaTexels = 0;
    return info;
  }
  const image = bytes ? decodePng(bytes) : null;
  let low = 0;
  if (image) {
    for (let i = 3; i < image.data.length; i += 4) {
      if (image.data[i] < LOW_ALPHA * 255) low++;
    }
  }
  info.lowAlphaTexels = image ? low : null;
  return info;
}

// ---------------------------------------------------------------------------
// GLB
// ---------------------------------------------------------------------------

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_CHUNK_JSON = 0x4e4f534a;
const GLB_CHUNK_BIN = 0x004e4942;
const GL_FLOAT = 5126;
const GL_TRIANGLES = 4;
const GL_TRIANGLE_STRIP = 5;
const GL_TRIANGLE_FAN = 6;
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  max?: number[];
}
interface GltfBufferView { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }
interface GltfBuffer { uri?: string; byteLength: number }
interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
  targets?: unknown[];
}
interface GltfMesh { name?: string; primitives: GltfPrimitive[] }
interface GltfNode { name?: string; mesh?: number; skin?: number; children?: number[] }
interface GltfMaterial { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }
interface GltfTexture { source?: number; extensions?: Record<string, { source?: number } | undefined> }
interface GltfImage { name?: string; uri?: string; bufferView?: number; mimeType?: string }
interface GltfAnimation { name?: string; channels: unknown[]; samplers: { input: number }[] }
interface GltfJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  skins?: { joints: number[] }[];
  materials?: GltfMaterial[];
  textures?: GltfTexture[];
  images?: GltfImage[];
  animations?: GltfAnimation[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: GltfBuffer[];
}

type Inspected = Omit<ModelInfo, 'fileBytes'>;

function inspectGlb(buf: Buffer, baseDir: string): Inspected {
  let json: GltfJson | null = null;
  let bin: Buffer | null = null;
  for (let off = 12; off + 8 <= buf.length; ) {
    const length = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + length);
    if (type === GLB_CHUNK_JSON) json = JSON.parse(data.toString('utf8')) as GltfJson;
    else if (type === GLB_CHUNK_BIN && !bin) bin = data;
    off += 8 + length;
  }
  if (!json) throw new Error('GLB without JSON chunk');
  return inspectGltf(json, bin, baseDir);
}

/** `bin` is the GLB binary chunk; external buffers are read from `baseDir`. */
function inspectGltf(gltf: GltfJson, bin: Buffer | null, baseDir: string): Inspected {
  const accessors = gltf.accessors ?? [];

  const bufferViewBytes = (index: number): Buffer | null => {
    const view = gltf.bufferViews?.[index];
    if (!view) return null;
    const buffer = gltf.buffers?.[view.buffer];
    let source: Buffer | null = null;
    if (buffer?.uri) {
      const file = resolve(baseDir, decodeURIComponent(buffer.uri));
      source = existsSync(file) ? readFileSync(file) : null;
    } else if (view.buffer === 0) {
      source = bin;
    }
    if (!source) return null;
    const start = view.byteOffset ?? 0;
    return source.subarray(start, start + view.byteLength);
  };

  /** Raw bytes of every element as a string key, for counting distinct values. */
  const elementKeys = (index: number | undefined): string[] | null => {
    const accessor = index !== undefined ? accessors[index] : undefined;
    if (!accessor || accessor.bufferView === undefined) return null;
    const bytes = bufferViewBytes(accessor.bufferView);
    const size = (COMPONENT_BYTES[accessor.componentType] ?? 0) * (TYPE_COMPONENTS[accessor.type] ?? 0);
    if (!bytes || size === 0) return null;
    const stride = gltf.bufferViews?.[accessor.bufferView]?.byteStride ?? size;
    const keys = new Array<string>(accessor.count);
    for (let k = 0; k < accessor.count; k++) {
      const start = (accessor.byteOffset ?? 0) + k * stride;
      keys[k] = bytes.toString('latin1', start, start + size);
    }
    return keys;
  };

  const imageBytes = (index: number): Buffer | null => {
    const image = gltf.images?.[index];
    if (image?.bufferView !== undefined) return bufferViewBytes(image.bufferView);
    if (image?.uri?.startsWith('data:')) return Buffer.from(image.uri.slice(image.uri.indexOf(',') + 1), 'base64');
    if (image?.uri) {
      const file = resolve(baseDir, decodeURIComponent(image.uri));
      return existsSync(file) ? readFileSync(file) : null;
    }
    return null;
  };

  const imageCache = new Map<number, ImageInfo | null>();
  const imageInfo = (index: number): ImageInfo | null => {
    if (imageCache.has(index)) return imageCache.get(index) ?? null;
    const image = gltf.images?.[index];
    const bytes = imageBytes(index);
    const size = bytes ? imageSize(bytes) : null;
    const info = size
      ? { label: image?.name || image?.uri?.slice(0, 40) || `image_${index}`, ...size }
      : null;
    imageCache.set(index, info);
    return info;
  };

  const diffuseOf = (materialIndex: number | undefined): ImageInfo | null => {
    if (materialIndex === undefined) return null;
    const textureIndex = gltf.materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorTexture?.index;
    if (textureIndex === undefined) return null;
    const texture = gltf.textures?.[textureIndex];
    const source =
      texture?.source ??
      texture?.extensions?.['EXT_texture_webp']?.source ??
      texture?.extensions?.['KHR_texture_basisu']?.source;
    const info = source === undefined ? null : imageInfo(source);
    return info && countLowAlpha(info, imageBytes(source!));
  };

  const weldOf = (primitive: GltfPrimitive): WeldInfo | null => {
    const position = elementKeys(primitive.attributes['POSITION']);
    if (!position) return null;
    const normal = elementKeys(primitive.attributes['NORMAL']);
    const uv = elementKeys(primitive.attributes['TEXCOORD_0']);
    return countWeld(position.length, (k) => position[k], (k) => normal?.[k] ?? '', (k) => uv?.[k] ?? '');
  };

  const meshes: MeshInfo[] = [];
  let extraJointSets = false;
  const visit = (nodeIndex: number): void => {
    const node = gltf.nodes?.[nodeIndex];
    if (!node) return;
    const mesh = node.mesh !== undefined ? gltf.meshes?.[node.mesh] : undefined;
    if (mesh) {
      const skinned = node.skin !== undefined;
      mesh.primitives.forEach((primitive, i) => {
        const position = primitive.attributes['POSITION'];
        if (position === undefined) return;
        const vertices = accessors[position]?.count ?? 0;
        const elements = primitive.indices !== undefined ? accessors[primitive.indices]?.count ?? 0 : vertices;
        const mode = primitive.mode ?? GL_TRIANGLES;
        const triangles =
          mode === GL_TRIANGLES ? Math.floor(elements / 3)
            : mode === GL_TRIANGLE_STRIP || mode === GL_TRIANGLE_FAN ? Math.max(0, elements - 2)
              : 0;
        if (skinned && primitive.attributes['JOINTS_1'] !== undefined) extraJointSets = true;
        meshes.push({
          name: `${node.name ?? mesh.name ?? `node_${nodeIndex}`}${mesh.primitives.length > 1 ? `#${i}` : ''}`,
          skinned,
          vertices,
          triangles,
          vertexSource: `accessor:${position}`,
          morphTargets: primitive.targets?.length ?? 0,
          diffuse: diffuseOf(primitive.material),
          weld: weldOf(primitive),
        });
      });
    }
    node.children?.forEach(visit);
  };
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? [];
  roots.forEach(visit);

  const accessorMax = (index: number): number => {
    const accessor = accessors[index];
    if (!accessor) return 0;
    // GLTFLoader reads key times as float32; the JSON may carry the exact double.
    if (accessor.max?.length) return Math.fround(accessor.max[0]);
    if (accessor.componentType !== GL_FLOAT || accessor.bufferView === undefined) return 0;
    const bytes = bufferViewBytes(accessor.bufferView);
    if (!bytes) return 0;
    const stride = gltf.bufferViews?.[accessor.bufferView]?.byteStride ?? 4;
    let max = 0;
    for (let k = 0; k < accessor.count; k++) {
      max = Math.max(max, bytes.readFloatLE((accessor.byteOffset ?? 0) + k * stride));
    }
    return max;
  };

  const clips: ClipInfo[] = (gltf.animations ?? []).map((animation, i) => {
    let duration = 0;
    let keyframes = 0;
    for (const sampler of animation.samplers) {
      duration = Math.max(duration, accessorMax(sampler.input));
      keyframes += accessors[sampler.input]?.count ?? 0;
    }
    return { name: animation.name || `animation_${i}`, duration, channels: animation.channels.length, keyframes };
  });

  const skins = (gltf.skins ?? []).map((skin) => skin.joints.length);
  const bones = new Set((gltf.skins ?? []).flatMap((skin) => skin.joints)).size;
  const images = (gltf.images ?? [])
    .map((_, i) => imageInfo(i))
    .filter((image): image is ImageInfo => image !== null);

  return {
    format: 'glb',
    meshes,
    skins,
    bones,
    materials: gltf.materials?.length ?? 0,
    images,
    clips,
    extraJointSets,
  };
}

function countWeld(
  count: number,
  position: (k: number) => string,
  normal: (k: number) => string,
  uv: (k: number) => string,
): WeldInfo {
  const positions = new Set<string>();
  const positionsUv = new Set<string>();
  const positionsNormalUv = new Set<string>();
  for (let k = 0; k < count; k++) {
    const p = position(k);
    const u = uv(k);
    positions.add(p);
    positionsUv.add(p + u);
    positionsNormalUv.add(p + normal(k) + u);
  }
  return { positions: positions.size, positionsUv: positionsUv.size, positionsNormalUv: positionsNormalUv.size };
}

// ---------------------------------------------------------------------------
// Binary FBX
// ---------------------------------------------------------------------------

const FBX_TICKS_PER_SECOND = 46186158000;

interface FbxArray { type: string; length: number; encoding: number; data: Buffer }
type FbxProp = number | bigint | string | boolean | Buffer | FbxArray;
interface FbxNode { name: string; props: FbxProp[]; children: FbxNode[] }

function parseFbx(buf: Buffer): FbxNode[] {
  const version = buf.readUInt32LE(23);
  const wide = version >= 7500;
  const nodes: FbxNode[] = [];
  for (let off = 27; off < buf.length; ) {
    const record = readFbxNode(buf, off, wide);
    if (!record) break;
    nodes.push(record.node);
    off = record.end;
  }
  return nodes;
}

function readFbxNode(buf: Buffer, off: number, wide: boolean): { node: FbxNode; end: number } | null {
  const header = wide ? 25 : 13;
  if (off + header > buf.length) return null;
  const end = wide ? Number(buf.readBigUInt64LE(off)) : buf.readUInt32LE(off);
  if (end === 0) return null;
  const propCount = wide ? Number(buf.readBigUInt64LE(off + 8)) : buf.readUInt32LE(off + 4);
  const nameLength = buf.readUInt8(off + header - 1);
  const name = buf.toString('latin1', off + header, off + header + nameLength);
  let p = off + header + nameLength;

  const props: FbxProp[] = [];
  for (let i = 0; i < propCount; i++) {
    const type = String.fromCharCode(buf[p]);
    p++;
    switch (type) {
      case 'Y': props.push(buf.readInt16LE(p)); p += 2; break;
      case 'C': props.push(buf[p] !== 0); p += 1; break;
      case 'I': props.push(buf.readInt32LE(p)); p += 4; break;
      case 'F': props.push(buf.readFloatLE(p)); p += 4; break;
      case 'D': props.push(buf.readDoubleLE(p)); p += 8; break;
      case 'L': props.push(buf.readBigInt64LE(p)); p += 8; break;
      case 'f': case 'd': case 'l': case 'i': case 'b': {
        const length = buf.readUInt32LE(p);
        const encoding = buf.readUInt32LE(p + 4);
        const byteLength = buf.readUInt32LE(p + 8);
        props.push({ type, length, encoding, data: buf.subarray(p + 12, p + 12 + byteLength) });
        p += 12 + byteLength;
        break;
      }
      case 'S': case 'R': {
        const length = buf.readUInt32LE(p);
        const data = buf.subarray(p + 4, p + 4 + length);
        props.push(type === 'S' ? data.toString('utf8') : data);
        p += 4 + length;
        break;
      }
      default:
        throw new Error(`FBX: unknown property type '${type}' in ${name}`);
    }
  }

  const children: FbxNode[] = [];
  while (p < end) {
    const child = readFbxNode(buf, p, wide);
    if (!child) break;
    children.push(child.node);
    p = child.end;
  }
  return { node: { name, props, children }, end };
}

function fbxArrayBytes(array: FbxArray): Buffer {
  return array.encoding === 1 ? inflateSync(array.data) : array.data;
}

function isFbxArray(prop: FbxProp | undefined): prop is FbxArray {
  return typeof prop === 'object' && prop !== null && !Buffer.isBuffer(prop) && 'encoding' in prop;
}

function fbxChild(node: FbxNode | undefined, name: string): FbxNode | undefined {
  return node?.children.find((c) => c.name === name);
}

/** "Walk\0\x01AnimStack" -> "Walk". */
function fbxName(prop: FbxProp | undefined): string {
  return typeof prop === 'string' ? prop.split('\0\x01')[0] : '';
}

/**
 * Value of a layer element (normals, UVs) at polygon vertex `k` with control
 * point `cp`, as raw bytes, following its mapping and reference mode.
 */
function fbxLayerValue(
  geometry: FbxNode,
  layerName: string,
  valuesName: string,
  indexName: string,
  components: number,
): ((k: number, cp: number) => string) | null {
  const layer = fbxChild(geometry, layerName);
  const values = fbxChild(layer, valuesName)?.props[0];
  if (!layer || !isFbxArray(values)) return null;
  const mapping = fbxChild(layer, 'MappingInformationType')?.props[0];
  const reference = fbxChild(layer, 'ReferenceInformationType')?.props[0];
  const indexProp = fbxChild(layer, indexName)?.props[0];
  const valueBytes = fbxArrayBytes(values);
  const indexBytes = reference === 'IndexToDirect' && isFbxArray(indexProp) ? fbxArrayBytes(indexProp) : null;
  const stride = components * (values.type === 'd' ? 8 : 4);
  return (k, cp) => {
    const slot = mapping === 'AllSame' ? 0 : mapping === 'ByPolygonVertex' ? k : cp;
    const i = indexBytes ? indexBytes.readInt32LE(slot * 4) : slot;
    return valueBytes.toString('latin1', i * stride, i * stride + stride);
  };
}

function inspectFbx(buf: Buffer): Inspected {
  const top = parseFbx(buf);
  const objects = top.find((n) => n.name === 'Objects')?.children ?? [];
  const connections = top.find((n) => n.name === 'Connections')?.children ?? [];

  const byId = new Map<string, FbxNode>();
  for (const object of objects) byId.set(String(object.props[0]), object);

  const parents = new Map<string, string[]>();
  const kids = new Map<string, string[]>();
  for (const c of connections) {
    if (c.name !== 'C') continue;
    const child = String(c.props[1]);
    const parent = String(c.props[2]);
    parents.set(child, [...(parents.get(child) ?? []), parent]);
    kids.set(parent, [...(kids.get(parent) ?? []), child]);
  }
  const ofKind = (ids: string[] | undefined, kind: string, subclass?: string): FbxNode[] =>
    (ids ?? [])
      .map((id) => byId.get(id))
      .filter((n): n is FbxNode => !!n && n.name === kind && (subclass === undefined || n.props[2] === subclass));

  const imageCache = new Map<string, ImageInfo | null>();
  const videoImage = (video: FbxNode): ImageInfo | null => {
    const id = String(video.props[0]);
    if (imageCache.has(id)) return imageCache.get(id) ?? null;
    const content = fbxChild(video, 'Content')?.props[0];
    const size = Buffer.isBuffer(content) && content.length > 0 ? imageSize(content) : null;
    const info = size ? { label: fbxName(video.props[1]), ...size } : null;
    imageCache.set(id, info);
    return info;
  };

  // Base colour: Video -> Texture -> Material (property "DiffuseColor") -> Model.
  const diffuseOfModel = (modelId: string): ImageInfo | null => {
    for (const material of ofKind(kids.get(modelId), 'Material')) {
      for (const c of connections) {
        if (c.name !== 'C' || c.props[0] !== 'OP' || String(c.props[2]) !== String(material.props[0])) continue;
        if (c.props[3] !== 'DiffuseColor') continue;
        const texture = byId.get(String(c.props[1]));
        if (texture?.name !== 'Texture') continue;
        for (const video of ofKind(kids.get(String(texture.props[0])), 'Video')) {
          const image = videoImage(video);
          const content = fbxChild(video, 'Content')?.props[0];
          if (image) return countLowAlpha(image, Buffer.isBuffer(content) ? content : null);
        }
      }
    }
    return null;
  };

  const meshes: MeshInfo[] = [];
  const skins: number[] = [];
  for (const geometry of objects) {
    if (geometry.name !== 'Geometry' || geometry.props[2] !== 'Mesh') continue;
    const geometryId = String(geometry.props[0]);
    const indexProp = fbxChild(geometry, 'PolygonVertexIndex')?.props[0];
    const vertexProp = fbxChild(geometry, 'Vertices')?.props[0];
    let triangles = 0;
    let weld: WeldInfo | null = null;
    if (isFbxArray(indexProp)) {
      const indices = fbxArrayBytes(indexProp);
      const controlPoint = (k: number): number => {
        const raw = indices.readInt32LE(k * 4);
        return raw < 0 ? ~raw : raw;
      };
      let polygons = 0;
      for (let k = 0; k < indexProp.length; k++) if (indices.readInt32LE(k * 4) < 0) polygons++;
      triangles = indexProp.length - 2 * polygons;
      if (isFbxArray(vertexProp)) {
        const positions = fbxArrayBytes(vertexProp);
        const stride = 3 * (vertexProp.type === 'd' ? 8 : 4);
        const normal = fbxLayerValue(geometry, 'LayerElementNormal', 'Normals', 'NormalsIndex', 3);
        const uv = fbxLayerValue(geometry, 'LayerElementUV', 'UV', 'UVIndex', 2);
        weld = countWeld(
          indexProp.length,
          (k) => positions.toString('latin1', controlPoint(k) * stride, controlPoint(k) * stride + stride),
          (k) => normal?.(k, controlPoint(k)) ?? '',
          (k) => uv?.(k, controlPoint(k)) ?? '',
        );
      }
    }
    const skinDeformers = ofKind(kids.get(geometryId), 'Deformer', 'Skin');
    for (const skin of skinDeformers) skins.push(ofKind(kids.get(String(skin.props[0])), 'Deformer', 'Cluster').length);
    for (const model of ofKind(parents.get(geometryId), 'Model')) {
      meshes.push({
        name: fbxName(model.props[1]),
        skinned: skinDeformers.length > 0,
        vertices: triangles * 3,
        triangles,
        vertexSource: `geometry:${geometryId}`,
        morphTargets: ofKind(kids.get(geometryId), 'Deformer', 'BlendShape').length,
        diffuse: diffuseOfModel(String(model.props[0])),
        weld,
      });
    }
  }

  const clips: ClipInfo[] = [];
  for (const stack of objects) {
    if (stack.name !== 'AnimationStack') continue;
    let lastTick = 0;
    let keyframes = 0;
    let channels = 0;
    for (const layer of ofKind(kids.get(String(stack.props[0])), 'AnimationLayer')) {
      for (const curveNode of ofKind(kids.get(String(layer.props[0])), 'AnimationCurveNode')) {
        channels++;
        for (const curve of ofKind(kids.get(String(curveNode.props[0])), 'AnimationCurve')) {
          const keyTime = fbxChild(curve, 'KeyTime')?.props[0];
          if (!isFbxArray(keyTime)) continue;
          const bytes = fbxArrayBytes(keyTime);
          keyframes += keyTime.length;
          for (let k = 0; k < keyTime.length; k++) {
            lastTick = Math.max(lastTick, Number(bytes.readBigInt64LE(k * 8)));
          }
        }
      }
    }
    // FBXLoader keeps key times in a Float32Array, so the clip lasts the float32 of this.
    clips.push({ name: fbxName(stack.props[1]), duration: Math.fround(lastTick / FBX_TICKS_PER_SECOND), channels, keyframes });
  }

  const images = objects
    .filter((n) => n.name === 'Video')
    .map(videoImage)
    .filter((image): image is ImageInfo => image !== null);

  return {
    format: 'fbx',
    meshes,
    skins,
    bones: objects.filter((n) => n.name === 'Model' && n.props[2] === 'LimbNode').length,
    materials: objects.filter((n) => n.name === 'Material').length,
    images,
    clips,
    extraJointSets: false,
  };
}
