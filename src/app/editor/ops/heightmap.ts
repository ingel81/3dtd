/**
 * Heightmaps in and out: 16-bit greyscale PNG and RAW (16-bit little endian,
 * square, the format of Gaea, World Machine and many terrain tools). The
 * image's top row is the map's north edge. 0 is the lowest height, 65535 the
 * highest; the metres they stand for travel in the file name
 * (`<id>-heights-<low>m-<high>m.png`) and are asked for on import.
 *
 * The PNG coder is the small part of the format heightmaps need: greyscale
 * or colour (the first channel counts), 8 or 16 bits, with or without alpha,
 * all five row filters, no interlacing; written as 16-bit greyscale.
 */
import { unzlibSync, zlibSync } from 'fflate';
import type { MapHeightGrid } from '../../world/custom-map/map-document';

export interface HeightImage {
  width: number;
  height: number;
  /** 0..1 per pixel, top row first */
  values: Float32Array;
}

export class HeightmapError extends Error {
  override name = 'HeightmapError';
}

// ---------------------------------------------------------------- grid <-> image

/** The grid as an image: lowest height 0, highest 1; with the range in metres */
export function gridToImage(grid: MapHeightGrid): { image: HeightImage; low: number; high: number } {
  const { columns, rows, heights } = grid;
  let low = Infinity;
  let high = -Infinity;
  for (const h of heights) {
    if (h < low) low = h;
    if (h > high) high = h;
  }
  const span = high - low || 1;
  const values = new Float32Array(columns * rows);
  for (let r = 0; r < rows; r++) {
    const j = rows - 1 - r;
    for (let i = 0; i < columns; i++) values[r * columns + i] = (heights[j * columns + i] - low) / span;
  }
  return { image: { width: columns, height: rows, values }, low, high };
}

/**
 * Heights for a grid of columns x rows from an image of any size: bilinear
 * over the image, so it covers the whole map; `low` and `high` in metres
 */
export function imageToHeights(image: HeightImage, columns: number, rows: number, low: number, high: number): Float32Array {
  const out = new Float32Array(columns * rows);
  const { width, height, values } = image;
  for (let j = 0; j < rows; j++) {
    const fy = ((rows - 1 - j) / Math.max(1, rows - 1)) * (height - 1);
    const y0 = Math.min(height - 1, Math.floor(fy));
    const y1 = Math.min(height - 1, y0 + 1);
    const v = fy - y0;
    for (let i = 0; i < columns; i++) {
      const fx = (i / Math.max(1, columns - 1)) * (width - 1);
      const x0 = Math.min(width - 1, Math.floor(fx));
      const x1 = Math.min(width - 1, x0 + 1);
      const u = fx - x0;
      const top = values[y0 * width + x0] * (1 - u) + values[y0 * width + x1] * u;
      const bottom = values[y1 * width + x0] * (1 - u) + values[y1 * width + x1] * u;
      out[j * columns + i] = low + (top * (1 - v) + bottom * v) * (high - low);
    }
  }
  return out;
}

/** The range a file name carries (`…-heights-<low>m-<high>m…`), or null */
export function rangeFromName(name: string): { low: number; high: number } | null {
  const m = /heights-(-?\d+(?:\.\d+)?)m-(-?\d+(?:\.\d+)?)m/.exec(name);
  return m ? { low: Number(m[1]), high: Number(m[2]) } : null;
}

export function heightmapName(id: string, low: number, high: number, ext: 'png' | 'raw'): string {
  const r = (v: number) => Math.round(v * 100) / 100;
  return `${id}-heights-${r(low)}m-${r(high)}m.${ext}`;
}

// ---------------------------------------------------------------- RAW

export function encodeRaw16(image: HeightImage): Uint8Array {
  const out = new Uint8Array(image.values.length * 2);
  const view = new DataView(out.buffer);
  image.values.forEach((v, k) => view.setUint16(k * 2, Math.round(Math.min(1, Math.max(0, v)) * 65535), true));
  return out;
}

/** A square RAW of 16-bit little-endian samples (its side from its size) */
export function decodeRaw16(bytes: Uint8Array): HeightImage {
  const n = bytes.byteLength / 2;
  const side = Math.round(Math.sqrt(n));
  if (!Number.isInteger(n) || side * side !== n || side < 2) {
    throw new HeightmapError(`A RAW heightmap has to be square with 16 bits a sample; ${bytes.byteLength} bytes are not.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float32Array(n);
  for (let k = 0; k < n; k++) values[k] = view.getUint16(k * 2, true) / 65535;
  return { width: side, height: side, values };
}

// ---------------------------------------------------------------- PNG

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let k = 0; k < 4; k++) out[4 + k] = type.charCodeAt(k);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A 16-bit greyscale PNG */
export function encodePng16(image: HeightImage): Uint8Array {
  const { width, height, values } = image;
  const ihdr = new Uint8Array(13);
  const h = new DataView(ihdr.buffer);
  h.setUint32(0, width);
  h.setUint32(4, height);
  ihdr[8] = 16;
  ihdr[9] = 0;
  const raw = new Uint8Array(height * (1 + width * 2));
  const view = new DataView(raw.buffer);
  for (let r = 0; r < height; r++) {
    const row = r * (1 + width * 2);
    raw[row] = 0;
    for (let i = 0; i < width; i++) view.setUint16(row + 1 + i * 2, Math.round(Math.min(1, Math.max(0, values[r * width + i])) * 65535));
  }
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The first channel of a PNG as 0..1 */
export function decodePng(bytes: Uint8Array): HeightImage {
  if (bytes.length < 8 || SIGNATURE.some((b, k) => bytes[k] !== b)) throw new HeightmapError('This is not a PNG file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  const idat: Uint8Array[] = [];
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      depth = data[8];
      colour = data[9];
      if (data[12] !== 0) throw new HeightmapError('Interlaced PNGs are not read; save the heightmap without interlacing.');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colour];
  if (!width || !height || !channels || (depth !== 8 && depth !== 16)) {
    throw new HeightmapError(`This PNG (colour type ${colour}, ${depth} bits) is no heightmap; use 16-bit greyscale.`);
  }
  const packed = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const d of idat) {
    packed.set(d, p);
    p += d.length;
  }
  const raw = unzlibSync(packed);
  const bpp = channels * (depth / 8);
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) throw new HeightmapError('The PNG ends early.');
  const rows = new Uint8Array(height * stride);
  for (let r = 0; r < height; r++) {
    const filter = raw[r * (stride + 1)];
    const line = raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1));
    const out = rows.subarray(r * stride, (r + 1) * stride);
    const prev = r ? rows.subarray((r - 1) * stride, r * stride) : null;
    for (let k = 0; k < stride; k++) {
      const a = k >= bpp ? out[k - bpp] : 0;
      const b = prev ? prev[k] : 0;
      const c = prev && k >= bpp ? prev[k - bpp] : 0;
      let x = line[k];
      if (filter === 1) x += a;
      else if (filter === 2) x += b;
      else if (filter === 3) x += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        x += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[k] = x & 0xff;
    }
  }
  const values = new Float32Array(width * height);
  for (let k = 0; k < width * height; k++) {
    const q = k * bpp;
    values[k] = depth === 16 ? ((rows[q] << 8) | rows[q + 1]) / 65535 : rows[q] / 255;
  }
  return { width, height, values };
}
