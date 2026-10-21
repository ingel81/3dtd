/**
 * A tiny PNG writer over fflate's zlib, the same on the page, in a worker
 * and in Node (the bake of the shipped maps): no canvas, no DOM. Rows go
 * unfiltered; the zlib squeezes them.
 */
import { zlibSync } from 'fflate';

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

/** PNG colour types the writer is used with */
export type PngColour = 'grey' | 'rgb';

/**
 * A PNG of `raw`: `height` rows, each a filter byte (0) and the row's
 * samples, `depth` bits each (8 or 16, big-endian)
 */
export function encodePngRows(raw: Uint8Array, width: number, height: number, depth: 8 | 16, colour: PngColour): Uint8Array {
  const ihdr = new Uint8Array(13);
  const h = new DataView(ihdr.buffer);
  h.setUint32(0, width);
  h.setUint32(4, height);
  ihdr[8] = depth;
  ihdr[9] = colour === 'rgb' ? 2 : 0;
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** An 8-bit RGB PNG of `rgb` (three bytes a pixel, rows top first) */
export function encodePngRgb(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return encodePngRows(raw, width, height, 8, 'rgb');
}
