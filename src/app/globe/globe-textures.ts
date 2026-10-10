import { ClampToEdgeWrapping, RepeatWrapping, type CompressedTexture, type WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/**
 * The globe's textures, loaded in stages (docs/GLOBE_PLAN.md, Texturen und
 * Leistung): a small set first, the sharp set after, the region tiles around
 * the place last. All of them Basis Universal ETC1S in KTX2, built by
 * tools/globe/build_textures.py and transcoded on the device to the GPU's
 * own compressed format.
 */

/** Where the textures lie, under the app's base href */
export const GLOBE_ASSETS = 'assets/globe/';
/** Where the Basis transcoder lies (copied by postinstall, like the Draco decoder) */
export const BASIS_PATH = 'basis/';

export type GlobeQuality = 'high' | 'low';

export interface GlobeMaps {
  /** sRGB day surface */
  day: CompressedTexture;
  /** sRGB city lights, cloud cover in alpha */
  night: CompressedTexture;
  /** Height in red, water in alpha, linear */
  relief: CompressedTexture;
}

/** The files of a stage */
export function stageFiles(stage: 'base' | 'sharp'): Record<keyof GlobeMaps, string> {
  return stage === 'base'
    ? { day: 'earth-day-2k.ktx2', night: 'earth-night-2k.ktx2', relief: 'earth-relief-2k.ktx2' }
    : { day: 'earth-day-8k.ktx2', night: 'earth-night-8k.ktx2', relief: 'earth-relief-4k.ktx2' };
}

/** The region tiles' grid, region/index.json */
export interface RegionIndex {
  /** Degrees per tile, latitude and longitude */
  deg: number;
  /** Tiles present, "<row>_<col>": row 0 starts at 90 N, column 0 at 180 W */
  tiles: string[];
}

/** One region tile and where it lies in the global texture's UV (v down from the north pole) */
export interface RegionTile {
  key: string;
  /** u0, v0, u1, v1 */
  rect: [number, number, number, number];
}

/**
 * The region tiles that cover a place and its surroundings: the 2x2 block
 * whose shared corner lies nearest to it, so the place is at least half a
 * tile from the block's edge. Tiles missing from the index (water only) are
 * left out; the global texture shows there.
 */
export function regionTilesAround(lat: number, lon: number, index: RegionIndex): RegionTile[] {
  const { deg } = index;
  const rows = Math.round(180 / deg);
  const cols = Math.round(360 / deg);
  const y = (90 - lat) / deg;
  const x = (lon + 180) / deg;
  const row = Math.min(rows - 1, Math.max(0, Math.floor(y)));
  const col = ((Math.floor(x) % cols) + cols) % cols;
  const row2 = Math.min(rows - 1, Math.max(0, y - row < 0.5 ? row - 1 : row + 1));
  const col2 = (((x - Math.floor(x) < 0.5 ? col - 1 : col + 1) % cols) + cols) % cols;
  const present = new Set(index.tiles);
  const out: RegionTile[] = [];
  const seen = new Set<string>();
  for (const [r, c] of [[row, col], [row, col2], [row2, col], [row2, col2]]) {
    const key = `${r}_${c}`;
    if (seen.has(key) || !present.has(key)) continue;
    seen.add(key);
    out.push({ key, rect: [(c * deg) / 360, (r * deg) / 180, ((c + 1) * deg) / 360, ((r + 1) * deg) / 180] });
  }
  return out;
}

/** Loads and owns the textures; dispose() frees them all */
export class GlobeTextures {
  private readonly loader: KTX2Loader;
  private readonly owned = new Set<CompressedTexture>();
  private index: Promise<RegionIndex | null> | null = null;
  private disposed = false;

  /**
   * @param baseUrl the app's base (document.baseURI): paths resolve against
   *   it, also inside a worker, whose own location is its script's
   */
  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly baseUrl: string,
  ) {
    this.loader = new KTX2Loader()
      .setTranscoderPath(new URL(BASIS_PATH, baseUrl).href)
      .setWorkerLimit(2)
      .detectSupport(renderer);
  }

  private url(path: string): string {
    return new URL(GLOBE_ASSETS + path, this.baseUrl).href;
  }

  /** A stage's three maps; null after dispose() */
  async loadStage(stage: 'base' | 'sharp'): Promise<GlobeMaps | null> {
    const files = stageFiles(stage);
    const [day, night, relief] = await Promise.all([
      this.load(files.day, true),
      this.load(files.night, true),
      this.load(files.relief, true),
    ]);
    if (this.disposed) return null;
    return { day, night, relief };
  }

  /** The region tiles around a place, as textures with their UV rectangles */
  async loadRegion(lat: number, lon: number): Promise<{ tile: RegionTile; texture: CompressedTexture }[]> {
    this.index ??= fetch(this.url('region/index.json'))
      .then((r) => (r.ok ? (r.json() as Promise<RegionIndex>) : null))
      .catch(() => null);
    const index = await this.index;
    if (!index || this.disposed) return [];
    const tiles = regionTilesAround(lat, lon, index);
    const textures = await Promise.all(
      tiles.map((tile) => this.load(`region/${tile.key}.ktx2`, false).catch(() => null)),
    );
    return tiles.flatMap((tile, i) => (textures[i] ? [{ tile, texture: textures[i] }] : []));
  }

  /** Frees a texture loaded here (a region tile replaced) */
  release(texture: CompressedTexture): void {
    if (this.owned.delete(texture)) texture.dispose();
  }

  private async load(file: string, repeat: boolean): Promise<CompressedTexture> {
    const texture = (await this.loader.loadAsync(this.url(file))) as CompressedTexture;
    if (this.disposed) {
      texture.dispose();
      throw new Error('globe textures disposed');
    }
    texture.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.owned.add(texture);
    return texture;
  }

  dispose(): void {
    this.disposed = true;
    for (const texture of this.owned) texture.dispose();
    this.owned.clear();
    this.loader.dispose();
  }
}
