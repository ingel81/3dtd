import type { CompressedTexture } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/**
 * The Basis Universal transcoder of the page's KTX2 textures: map models,
 * game models and ground materials (docs/CUSTOM_WORLD_PERF_VISUAL_PLAN.md,
 * V9). One loader with two workers for all of them, made on first use; it
 * asks a WebGL2 context of its own which compressed formats the GPU takes
 * (every context of the page has the same GPU), so no renderer has to come
 * first. Its workers end when idle (TRANSCODER_IDLE_MS) and start again with
 * the next file. The menu globe runs in its worker and keeps its own
 * (globe-textures.ts).
 */

/** Where the Basis transcoder lies (copied by postinstall, like the Draco decoder) */
export const BASIS_PATH = 'basis/';
/** The transcoder's worker as a file (tools/basis/build-ktx2-worker.mjs), beside the transcoder */
export const TRANSCODER_WORKER = BASIS_PATH + 'ktx2-worker.js';

/**
 * KTX2Loader with its worker from a file instead of a blob. The transcoder's
 * embind makes its bindings with `new Function`; a blob worker inherits the
 * page's Content-Security-Policy, which forbids that (no globe in the desktop
 * app, 2026-10-13), a worker from a URL takes its own response's, which
 * allows it for this one file (desktop/src/protocol.js, public/.htaccess).
 */
export class FileWorkerKTX2Loader extends KTX2Loader {
  constructor(private readonly workerUrl: string) {
    super();
  }

  override init(): Promise<void> {
    return super.init().then(() => {
      this.workerPool.setWorkerCreator(() => {
        const worker = new Worker(this.workerUrl);
        const transcoderBinary = this.transcoderBinary!.slice(0);
        worker.postMessage({ type: 'init', config: this.workerConfig, transcoderBinary }, [transcoderBinary]);
        return worker;
      });
    });
  }
}

/** The extensions of a WebGL context, as KTX2Loader.detectSupport reads them from a renderer */
interface ExtensionSource {
  extensions: { has(name: string): boolean; get(name: string): unknown };
}

let gpu: KTX2Loader | null | undefined;
let rgba: KTX2Loader | null = null;

function baseUrl(): string {
  return typeof document !== 'undefined' ? document.baseURI : '/';
}

function loader(support: ExtensionSource, workers: number): KTX2Loader {
  const base = baseUrl();
  return new FileWorkerKTX2Loader(new URL(TRANSCODER_WORKER, base).href)
    .setTranscoderPath(new URL(BASIS_PATH, base).href)
    .setWorkerLimit(workers)
    .detectSupport(support as never);
}

/**
 * The compressed formats of this GPU, from a context made and lost again;
 * null without WebGL2 (tests). It asks for the GPU the game's canvas asks for
 * (CANVAS_RENDERER_OPTIONS): on a laptop with two the formats could differ.
 */
function probeGpu(): ExtensionSource | null {
  if (typeof document === 'undefined' || typeof WebGL2RenderingContext === 'undefined') return null;
  let gl: WebGL2RenderingContext | null;
  try {
    gl = document.createElement('canvas').getContext('webgl2', { powerPreference: 'high-performance' });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const found = new Map<string, unknown>();
  for (const name of gl.getSupportedExtensions() ?? []) found.set(name, gl.getExtension(name));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { extensions: { has: (name) => found.has(name), get: (name) => found.get(name) } };
}

/**
 * The transcoder to the GPU's compressed formats (BC7, ASTC, ETC2), made on
 * first use; null where the page has no WebGL2 (tests): KTX2 textures then
 * do not load, and their models draw without them.
 */
export function compressedTextureLoader(): KTX2Loader | null {
  if (gpu === undefined) {
    const support = probeGpu();
    gpu = support ? loader(support, 2) : null;
  }
  return gpu;
}

/**
 * A transcoder to plain RGBA8, for the few textures the CPU reads (the
 * enemy VAT bakes a second colour map into vertex colours), made on first use
 */
export function rgbaTextureLoader(): KTX2Loader {
  rgba ??= loader({ extensions: { has: () => false, get: () => null } }, 1);
  return rgba;
}

/** Transcodes under way, and the end of the transcoder's workers once none is */
let transcoding = 0;
let transcoderIdle: ReturnType<typeof setTimeout> | null = null;
/** The transcoder's workers end this long after their last file (some 35 MB they held for good), ms; the next file starts them again */
const TRANSCODER_IDLE_MS = 5_000;

/**
 * `buffer` (a KTX2 file, transferred to the worker) transcoded by `loader`
 * (compressedTextureLoader); its workers go once nothing is left to
 * transcode for a while
 */
export function transcodeKtx2(loader: KTX2Loader, buffer: ArrayBuffer): Promise<CompressedTexture> {
  transcoding++;
  if (transcoderIdle) clearTimeout(transcoderIdle);
  transcoderIdle = null;
  return new Promise<CompressedTexture>((resolve, reject) => loader.parse(buffer, (t) => resolve(t as CompressedTexture), reject)).finally(() => {
    if (--transcoding > 0) return;
    transcoderIdle = setTimeout(() => {
      transcoderIdle = null;
      // Idle workers only: a file asked for meanwhile cleared the timer
      if (transcoding === 0) loader.workerPool.dispose();
    }, TRANSCODER_IDLE_MS);
  });
}

/** Test hook: the transcoder compressedTextureLoader() hands out (null: none), undefined probes again */
export function setCompressedTextureLoaderForTest(value: KTX2Loader | null | undefined): void {
  gpu = value;
}
