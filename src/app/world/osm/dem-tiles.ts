/**
 * Ground heights for an OSM world from free elevation tiles in the Terrarium
 * encoding (height = R * 256 + G + B / 256 - 32768 metres): the tiles over a
 * box, decoded and laid into one mosaic, sampled bilinearly. Two sources,
 * the first that delivers every tile wins (docs/OSM_WORLD_PLAN.md, heights):
 *
 * - Mapterhorn: 512 px WebP, in Germany and much of Europe 1 m survey data,
 *   elsewhere mostly Copernicus GLO-30 (30 m)
 * - AWS Terrain Tiles (Mapzen): 256 px PNG, in Europe EU-DEM (about 25 m)
 *
 * Decoding needs `createImageBitmap` and `OffscreenCanvas` (browser, Web
 * Worker); Node and the specs pass their own decoder or a mosaic.
 */
import type { GeoBox } from '../../services/location/street-box';

export type DemSourceId = 'mapterhorn' | 'aws';

export interface DemSource {
  id: DemSourceId;
  /** Tile URL of zoom z, column x, row y */
  url(z: number, x: number, y: number): string;
  tileSize: number;
  /** Zoom the world asks for (see DEM_SOURCES) */
  zoom: number;
  /** Who made the heights, for the map's attribution */
  attribution: string;
}

/**
 * The sources. Mapterhorn at zoom 14 (3.2 m a pixel at 49 degrees): on the
 * map's 2 m grid it looks the same as zoom 15 (1.6 m) and takes 6 to 9
 * tiles, 0.7 to 0.9 MB, instead of 16 to 20 tiles, 1.5 to 2.3 MB (three probe
 * places, 2026-10-15). The AWS tiles carry EU-DEM at about 25 m in Europe: at
 * zoom 15 a third to three quarters of their pixels lie on a straight line
 * with their neighbours, so zoom 13 (12 m a pixel) loses nothing.
 */
export const DEM_SOURCES: Record<DemSourceId, DemSource> = {
  mapterhorn: {
    id: 'mapterhorn',
    url: (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`,
    tileSize: 512,
    zoom: 14,
    attribution: 'Heights: Mapterhorn (mapterhorn.com) and its sources',
  },
  aws: {
    id: 'aws',
    url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
    tileSize: 256,
    zoom: 13,
    attribution: 'Heights: Terrain Tiles (Mapzen, AWS Open Data) and its sources',
  },
};

/** The order the world tries the sources in */
export const DEM_ORDER: readonly DemSourceId[] = ['mapterhorn', 'aws'];

/** Decoded RGBA pixels of one tile */
export interface DemImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** Turns a tile's bytes into pixels; the default uses createImageBitmap and an OffscreenCanvas */
export type DemDecoder = (bytes: ArrayBuffer, mime: string) => Promise<DemImage>;

/**
 * Heights in the pixels of one zoom: `columns` x `rows` pixels, row-major
 * from the north-west; its first pixel is world pixel (`left`, `top`) at
 * that zoom and tile size (worldPixel). A block of tiles starts at a tile's
 * corner, a cut-out anywhere
 */
export interface DemMosaic {
  source: DemSourceId;
  zoom: number;
  tileSize: number;
  left: number;
  top: number;
  columns: number;
  rows: number;
  heights: Float32Array;
}

/** World pixel coordinates (from the north-west of the world) of a point at a zoom, tile size `size` */
export function worldPixel(lat: number, lon: number, zoom: number, size: number): { px: number; py: number } {
  const n = 2 ** zoom * size;
  const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return {
    px: ((lon + 180) / 360) * n,
    py: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  };
}

/** The tiles of a zoom that cover a box */
export function tilesFor(box: GeoBox, zoom: number): { x0: number; y0: number; x1: number; y1: number } {
  const nw = worldPixel(box.maxLat, box.minLon, zoom, 1);
  const se = worldPixel(box.minLat, box.maxLon, zoom, 1);
  return { x0: Math.floor(nw.px), y0: Math.floor(nw.py), x1: Math.floor(se.px), y1: Math.floor(se.py) };
}

/** Terrarium pixels to metres */
export function decodeTerrarium(image: DemImage, out: Float32Array = new Float32Array(image.width * image.height)): Float32Array {
  const d = image.data;
  for (let k = 0, p = 0; k < out.length; k++, p += 4) out[k] = d[p] * 256 + d[p + 1] + d[p + 2] / 256 - 32768;
  return out;
}

/** Height of the mosaic at a point, bilinear between pixel centres, clamped at its rim */
export function sampleMosaic(m: DemMosaic, lat: number, lon: number): number {
  const { px, py } = worldPixel(lat, lon, m.zoom, m.tileSize);
  const fx = Math.max(0, Math.min(m.columns - 1.001, px - m.left - 0.5));
  const fy = Math.max(0, Math.min(m.rows - 1.001, py - m.top - 0.5));
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const u = fx - i;
  const v = fy - j;
  const h = m.heights;
  const k = j * m.columns + i;
  const top = h[k] + (h[k + 1] - h[k]) * u;
  const bottom = h[k + m.columns] + (h[k + m.columns + 1] - h[k + m.columns]) * u;
  return top + (bottom - top) * v;
}

/**
 * The mosaic sampled on a grid of `lons.length` columns and `lats.length`
 * rows (a map's height grid: row j at lats[j]) into `out`, row-major; the
 * projection worked out once per column and row
 */
export function sampleMosaicRows(m: DemMosaic, lons: readonly number[], lats: readonly number[], out: Float32Array): void {
  const fxs = lons.map((lon) => Math.max(0, Math.min(m.columns - 1.001, worldPixel(0, lon, m.zoom, m.tileSize).px - m.left - 0.5)));
  const fys = lats.map((lat) => Math.max(0, Math.min(m.rows - 1.001, worldPixel(lat, 0, m.zoom, m.tileSize).py - m.top - 0.5)));
  const h = m.heights;
  const c = m.columns;
  for (let j = 0; j < lats.length; j++) {
    const fy = fys[j];
    const row = Math.floor(fy);
    const v = fy - row;
    for (let i = 0; i < lons.length; i++) {
      const fx = fxs[i];
      const col = Math.floor(fx);
      const u = fx - col;
      const k = row * c + col;
      const top = h[k] + (h[k + 1] - h[k]) * u;
      const bottom = h[k + c] + (h[k + c + 1] - h[k + c]) * u;
      out[j * lons.length + i] = top + (bottom - top) * v;
    }
  }
}

/** The browser's decoder: pixels exactly as stored (no colour conversion, no premultiplied alpha) */
export const browserDecoder: DemDecoder = async (bytes, mime) => {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return { width: canvas.width, height: canvas.height, data };
};

export interface DemDownload {
  mosaic: DemMosaic;
  tiles: number;
  bytes: number;
  ms: number;
  /** Sources tried before this one, with why they failed */
  failed: { source: DemSourceId; reason: string }[];
}

/** Tiles of one source fetched at once */
const PARALLEL_TILES = 4;

/** The tiles of one source over `box` as a mosaic; throws when a tile does not come */
export async function downloadMosaic(
  source: DemSource,
  box: GeoBox,
  decode: DemDecoder = browserDecoder,
  signal?: AbortSignal,
): Promise<{ mosaic: DemMosaic; tiles: number; bytes: number }> {
  const { x0, y0, x1, y1 } = tilesFor(box, source.zoom);
  const size = source.tileSize;
  const columns = (x1 - x0 + 1) * size;
  const rows = (y1 - y0 + 1) * size;
  const heights = new Float32Array(columns * rows);
  const jobs: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push({ x, y });
  let bytes = 0;
  const one = async ({ x, y }: { x: number; y: number }) => {
    const response = await fetch(source.url(source.zoom, x, y), { signal });
    if (!response.ok) throw new Error(`tile ${source.zoom}/${x}/${y}: HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    bytes += buffer.byteLength;
    const image = await decode(buffer, response.headers.get('content-type') ?? (source.id === 'aws' ? 'image/png' : 'image/webp'));
    if (image.width !== size || image.height !== size) throw new Error(`tile ${source.zoom}/${x}/${y}: ${image.width} x ${image.height} px`);
    const tile = decodeTerrarium(image);
    const ox = (x - x0) * size;
    const oy = (y - y0) * size;
    for (let r = 0; r < size; r++) heights.set(tile.subarray(r * size, (r + 1) * size), (oy + r) * columns + ox);
  };
  for (let k = 0; k < jobs.length; k += PARALLEL_TILES) await Promise.all(jobs.slice(k, k + PARALLEL_TILES).map(one));
  return { mosaic: { source: source.id, zoom: source.zoom, tileSize: size, left: x0 * size, top: y0 * size, columns, rows, heights }, tiles: jobs.length, bytes };
}

/** The heights over `box` from the first source in `order` that delivers every tile; throws when none does */
export async function downloadDem(
  box: GeoBox,
  options: { order?: readonly DemSourceId[]; decode?: DemDecoder; signal?: AbortSignal } = {},
): Promise<DemDownload> {
  const start = performance.now();
  const failed: DemDownload['failed'] = [];
  for (const id of options.order ?? DEM_ORDER) {
    try {
      const got = await downloadMosaic(DEM_SOURCES[id], box, options.decode, options.signal);
      return { ...got, ms: performance.now() - start, failed };
    } catch (e) {
      if (options.signal?.aborted) throw e;
      failed.push({ source: id, reason: (e as Error).message ?? String(e) });
    }
  }
  throw new Error(`No elevation tiles: ${failed.map((f) => `${f.source} (${f.reason})`).join(', ')}`);
}
