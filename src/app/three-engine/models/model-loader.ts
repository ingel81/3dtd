import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearMipmapNearestFilter,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipmapLinearFilter,
  NearestMipmapNearestFilter,
  RepeatWrapping,
  type CompressedTexture,
  type MagnificationTextureFilter,
  type MinificationTextureFilter,
  type Texture,
  type Wrapping,
} from 'three';
import { GLTFLoader, type GLTFLoaderPlugin, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The KTX2 transcoder's module and the meshopt decoder load with the first
 * model, not with the page: they stay out of the start's bundle
 */
let transcoderModule: Promise<typeof import('./ktx2-transcoder')> | null = null;
const transcoders = (): Promise<typeof import('./ktx2-transcoder')> => (transcoderModule ??= import('./ktx2-transcoder'));

interface MeshoptDecoderLike {
  supported: boolean;
  ready: Promise<void>;
  decodeGltfBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array, mode: string, filter?: string): void;
}

let meshoptModule: Promise<MeshoptDecoderLike> | null = null;
let meshoptDecoder: MeshoptDecoderLike | null = null;
/** GLTFLoader's meshopt decoder, its code fetched when GLTFLoader first waits for `ready` */
const lazyMeshopt: MeshoptDecoderLike = {
  supported: true,
  get ready(): Promise<void> {
    meshoptModule ??= import('three/examples/jsm/libs/meshopt_decoder.module.js').then((m) => (meshoptDecoder = m.MeshoptDecoder as MeshoptDecoderLike));
    return meshoptModule.then((decoder) => decoder.ready);
  },
  decodeGltfBuffer(target, count, size, source, mode, filter) {
    meshoptDecoder!.decodeGltfBuffer(target, count, size, source, mode, filter);
  },
};

/**
 * The one GLTFLoader setup of the game's models (V9): meshopt geometry
 * (EXT_meshopt_compression, quantised) and KTX2 textures (KHR_texture_basisu),
 * both as tools/model-pack writes them. A texture whose image is a file of
 * its own (the shared map textures, `../textures/<name>-<hash>.ktx2`) is
 * loaded once per page through `sharedTextures` and is the same texture for
 * every model that names it, so the GPU holds it once. An embedded one is
 * transcoded from the GLB's buffer, without a blob URL.
 *
 * Every KTX2 texture says in `userData.opaque` whether its file carries
 * alpha (the packer leaves alpha out where every texel is opaque); the enemy
 * VAT reads that instead of the pixels. With `keepColourFiles` the colour
 * maps of a model with more than one keep their file (by their image, so
 * copies of the texture find it too): the VAT bakes the second one into
 * vertex colours on the CPU (readTexturePixels).
 */

/** The KTX2 files kept for a CPU read, by the texture image they made */
const keptFiles = new WeakMap<Texture['source'], ArrayBuffer>();

export interface ModelLoaderOptions {
  /** Fetches a texture file named by URI (the map data's cache for the map models); default: fetch */
  fetch?: typeof fetch;
  /** Textures by URL, shared between the loads of this cache's owner; none: each load its own */
  sharedTextures?: Map<string, Promise<Texture | null>>;
  /** Keep the KTX2 file of each colour map in a model with more than one (the enemy models) */
  keepColourFiles?: boolean;
}

/** A GLTFLoader for the packed models */
export function createModelLoader(options: ModelLoaderOptions = {}): GLTFLoader {
  // GLTFLoader asks only `supported`, `ready` and `decodeGltfBuffer` of a decoder without decodeGltfBufferAsync
  return new GLTFLoader().setMeshoptDecoder(lazyMeshopt as never).register((parser) => new Ktx2TexturePlugin(parser, options));
}
const BASISU = 'KHR_texture_basisu';

/** glTF sampler values to three's, made on first use (specs that mock three load this file without them) */
const filters = (): Record<number, MagnificationTextureFilter | MinificationTextureFilter> => ({
  9728: NearestFilter,
  9729: LinearFilter,
  9984: NearestMipmapNearestFilter,
  9985: LinearMipmapNearestFilter,
  9986: NearestMipmapLinearFilter,
  9987: LinearMipmapLinearFilter,
});
const wrappings = (): Record<number, Wrapping> => ({ 33071: ClampToEdgeWrapping, 33648: MirroredRepeatWrapping, 10497: RepeatWrapping });

interface SamplerDef {
  magFilter?: number;
  minFilter?: number;
  wrapS?: number;
  wrapT?: number;
}

interface GltfJson {
  textures: { sampler?: number; name?: string; extensions?: Record<string, { source: number }> }[];
  images: { uri?: string; bufferView?: number; mimeType?: string; name?: string }[];
  samplers?: SamplerDef[];
  materials?: { pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
}

/**
 * Takes over GLTFLoader's own KHR_texture_basisu (registered under its name,
 * so the built-in one is not asked): shared files, no blob URLs, alpha flag.
 */
class Ktx2TexturePlugin implements GLTFLoaderPlugin {
  readonly name = BASISU;
  private readonly json: GltfJson;
  /** Textures of this load by image and sampler */
  private readonly own = new Map<string, Promise<Texture | null>>();
  /** Images the colour maps use, when they keep their files */
  private readonly keepFiles: Set<number>;

  constructor(
    private readonly parser: GLTFParser,
    private readonly options: ModelLoaderOptions,
  ) {
    this.json = parser.json as GltfJson;
    this.keepFiles = options.keepColourFiles ? colourImages(this.json) : new Set();
  }

  // A texture that does not load is null, as GLTFLoader's own give (the material draws without it)
  loadTexture(textureIndex: number): Promise<Texture> | null {
    const textureDef = this.json.textures[textureIndex];
    const source = textureDef.extensions?.[BASISU]?.source;
    if (source === undefined) return null;
    const sampler = this.json.samplers?.[textureDef.sampler ?? -1] ?? {};
    const imageDef = this.json.images[source];
    const key = `${source}:${textureDef.sampler}`;
    let promise = this.own.get(key);
    if (!promise) {
      const base = imageDef.uri !== undefined && this.options.sharedTextures
        ? sharedTexture(this.resolve(imageDef.uri), this.options.sharedTextures, this.options.fetch)
        : decodeKtx2(this.bytes(imageDef), this.keepFiles.has(source));
      promise = base
        .then((texture) => (texture ? withSampler(texture, sampler, textureDef.name || imageDef.name || '') : null))
        .then((texture) => {
          if (texture) this.parser.associations.set(texture, { textures: textureIndex });
          return texture;
        })
        .catch((error: unknown) => {
          console.error(`[ModelLoader] texture ${imageDef.uri ?? source} not loaded`, error);
          return null;
        });
      this.own.set(key, promise);
    }
    return promise as Promise<Texture>;
  }

  private bytes(imageDef: GltfJson['images'][number]): Promise<ArrayBuffer> {
    if (imageDef.bufferView !== undefined) return this.parser.getDependency('bufferView', imageDef.bufferView) as Promise<ArrayBuffer>;
    const fetchFn = this.options.fetch ?? fetch;
    const url = this.resolve(imageDef.uri ?? '');
    return fetchFn(url).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res.arrayBuffer();
    });
  }

  /** An image URI against the model's own URL */
  private resolve(uri: string): string {
    const path = (this.parser.options as { path?: string }).path || './';
    return new URL(uri, new URL(path, typeof document !== 'undefined' ? document.baseURI : 'http://localhost/')).href;
  }

}

/**
 * A shared texture file's texture, loaded once per URL for every model of
 * `cache` (and by whoever asks first: the map library starts a model's files
 * beside its GLB); null without a transcoder. A failed load leaves the cache.
 */
export function sharedTexture(url: string, cache: Map<string, Promise<Texture | null>>, fetchFn: typeof fetch = fetch): Promise<Texture | null> {
  let promise = cache.get(url);
  if (!promise) {
    promise = transcoders()
      .then((m) => (m.compressedTextureLoader() ? fetchFn(url) : null))
      .then((res) => {
        if (!res) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return decodeKtx2(res.arrayBuffer(), false);
      })
      .catch((error: unknown) => {
        cache.delete(url);
        throw error;
      });
    cache.set(url, promise);
  }
  return promise;
}

/** A KTX2 file's texture through the page's transcoder; null without one (no WebGL2) */
async function decodeKtx2(bytes: Promise<ArrayBuffer>, keepFile: boolean): Promise<Texture | null> {
  const { compressedTextureLoader, transcodeKtx2 } = await transcoders();
  const transcoder = compressedTextureLoader();
  if (!transcoder) return null;
  const buffer = await bytes;
  const opaque = ktx2Opaque(new Uint8Array(buffer));
  // The transcoder takes the buffer over (transferred to its worker)
  const file = keepFile ? buffer.slice(0) : null;
  const texture = await transcodeKtx2(transcoder, buffer);
  texture.flipY = false;
  texture.userData['mimeType'] = 'image/ktx2';
  if (opaque !== null) texture.userData['opaque'] = opaque;
  if (file) keptFiles.set(texture.source, file);
  return texture;
}

/** The texture with the sampler's filters and wrapping: itself the first time, a copy sharing its image when they differ */
function withSampler(texture: Texture, sampler: SamplerDef, name: string): Texture {
  const FILTERS = filters();
  const WRAPPINGS = wrappings();
  const magFilter = (FILTERS[sampler.magFilter ?? -1] ?? LinearFilter) as MagnificationTextureFilter;
  const minFilter = (FILTERS[sampler.minFilter ?? -1] ?? LinearMipmapLinearFilter) as MinificationTextureFilter;
  const wrapS = WRAPPINGS[sampler.wrapS ?? -1] ?? RepeatWrapping;
  const wrapT = WRAPPINGS[sampler.wrapT ?? -1] ?? RepeatWrapping;
  const fresh = texture.userData['sampled'] !== true;
  const same = texture.magFilter === magFilter && texture.minFilter === minFilter && texture.wrapS === wrapS && texture.wrapT === wrapT;
  const out = fresh || same ? texture : texture.clone();
  out.magFilter = magFilter;
  out.minFilter = minFilter;
  out.wrapS = wrapS;
  out.wrapT = wrapT;
  out.userData['sampled'] = true;
  if (fresh) out.name = name;
  return out;
}

/** The images of a model's colour maps, when it has more than one (else none: the VAT samples the one on the GPU) */
function colourImages(json: GltfJson): Set<number> {
  const images = new Set<number>();
  for (const material of json.materials ?? []) {
    const index = material.pbrMetallicRoughness?.baseColorTexture?.index;
    const source = index === undefined ? undefined : json.textures[index]?.extensions?.[BASISU]?.source;
    if (source !== undefined) images.add(source);
  }
  return images.size > 1 ? images : new Set();
}

/** Data format descriptor colour models and channels (Khronos Data Format 1.3) */
const MODEL_ETC1S = 163;
const MODEL_UASTC = 166;
const ETC1S_AAA = 15;
const UASTC_RGBA = 3;
const UASTC_RRRG = 5;

/**
 * Whether a Basis KTX2 file carries no alpha, from its data format
 * descriptor; null when the file is something else
 */
export function ktx2Opaque(file: Uint8Array): boolean | null {
  if (file.byteLength < 80) return null;
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const dfd = view.getUint32(48, true);
  if (dfd + 28 > file.byteLength) return null;
  const blockSize = view.getUint16(dfd + 10, true);
  const model = view.getUint8(dfd + 12);
  const samples = Math.max(0, (blockSize - 24) / 16);
  const channel = (i: number): number => view.getUint8(dfd + 28 + i * 16 + 3) & 0x0f;
  if (model === MODEL_ETC1S) {
    for (let i = 0; i < samples; i++) if (channel(i) === ETC1S_AAA) return false;
    return true;
  }
  if (model === MODEL_UASTC) return samples > 0 && channel(0) !== UASTC_RGBA && channel(0) !== UASTC_RRRG;
  return null;
}

/** RGBA bytes of a texture, as the VAT bakes them into vertex colours */
export interface RgbaPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * The pixels of a KTX2 texture that kept its file (keepColourFiles),
 * transcoded to RGBA8 on the side; null when it has none
 */
export async function readTexturePixels(texture: Texture): Promise<RgbaPixels | null> {
  const file = keptFiles.get(texture.source);
  if (!file) return null;
  const { rgbaTextureLoader } = await transcoders();
  const rgba = await new Promise<CompressedTexture>((resolve, reject) =>
    rgbaTextureLoader().parse(file.slice(0), (t) => resolve(t as CompressedTexture), reject),
  );
  const level = rgba.mipmaps?.[0] as { data: Uint8Array; width: number; height: number } | undefined;
  rgba.dispose();
  if (!level) return null;
  return { data: new Uint8ClampedArray(level.data.buffer, level.data.byteOffset, level.data.byteLength), width: level.width, height: level.height };
}
