/**
 * PKWARE Data Compression Library "implode" decoder (explode), as MPQ
 * archives use it for compression mask 0x08 and the old IMPLODE file flag.
 *
 * Format (zlib contrib/blast.c describes it in full): byte 0 is the literal
 * mode (0 = literals as raw bytes, 1 = Huffman-coded literals), byte 1 the
 * dictionary size as extra distance bits (4, 5 or 6). Then a bit stream,
 * least significant bit first: flag 0 + 8 bits is a literal; flag 1 starts a
 * match of a coded length and a coded distance. Length 519 ends the stream.
 * Codes are prefix codes of at most 8 bits, given here as the bit patterns
 * StormLib's explode.c uses (LSB first).
 *
 * Only the binary literal mode is implemented; MPQ writers use it for every
 * file. Coded literals raise a clear error.
 */

import { W3xFormatError } from './binary-reader';

const LEN_BITS = [3, 2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 7, 7];
const LEN_CODE = [0x05, 0x03, 0x01, 0x06, 0x0a, 0x02, 0x0c, 0x14, 0x04, 0x18, 0x08, 0x30, 0x10, 0x20, 0x40, 0x00];
const EX_LEN_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];
const LEN_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 14, 22, 38, 70, 134, 262];
const DIST_BITS = [
  2, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
];
const DIST_CODE = [
  0x03, 0x0d, 0x05, 0x19, 0x09, 0x11, 0x01, 0x3e, 0x1e, 0x2e, 0x0e, 0x36, 0x16, 0x26, 0x06, 0x3a, 0x1a, 0x2a,
  0x0a, 0x32, 0x12, 0x22, 0x42, 0x02, 0x7c, 0x3c, 0x5c, 0x1c, 0x6c, 0x2c, 0x4c, 0x0c, 0x74, 0x34, 0x54, 0x14,
  0x64, 0x24, 0x44, 0x04, 0x78, 0x38, 0x58, 0x18, 0x68, 0x28, 0x48, 0x08, 0xf0, 0x70, 0xb0, 0x30, 0xd0, 0x50,
  0x90, 0x10, 0xe0, 0x60, 0xa0, 0x20, 0xc0, 0x40, 0x80, 0x00,
];

/** 256-entry lookup: the next 8 bits (LSB first) give symbol | bits << 8 */
function lookup(codes: number[], bits: number[]): Uint16Array {
  const table = new Uint16Array(256).fill(0xffff);
  for (let s = 0; s < codes.length; s++) {
    const n = bits[s];
    for (let high = 0; high < 1 << (8 - n); high++) table[codes[s] | (high << n)] = s | (n << 8);
  }
  return table;
}

let lenTable: Uint16Array | null = null;
let distTable: Uint16Array | null = null;

/** Most bytes a stream without a known size unpacks to */
const EXPLODE_LIMIT = 64 * 1024 * 1024;

/** Length of the stream's end marker */
const END_LENGTH = 519;

/**
 * Unpacks a PKWARE DCL stream: to `expectedSize` bytes (an MPQ sector), or
 * to its end marker. Never more than `limit` bytes (default the expected
 * size, else 64 MB): a stream that wants more throws.
 */
export function explode(data: Uint8Array, expectedSize?: number, limit = expectedSize ?? EXPLODE_LIMIT): Uint8Array {
  if (data.length < 2) throw new W3xFormatError('implode: stream too short');
  lenTable ??= lookup(LEN_CODE, LEN_BITS);
  distTable ??= lookup(DIST_CODE, DIST_BITS);
  const literalMode = data[0];
  const dictBits = data[1];
  if (literalMode === 1) throw new W3xFormatError('implode: coded literals (ASCII mode) are not supported');
  if (literalMode !== 0) throw new W3xFormatError(`implode: bad literal mode ${literalMode}`);
  if (dictBits < 4 || dictBits > 6) throw new W3xFormatError(`implode: bad dictionary size ${dictBits}`);

  let out = new Uint8Array(Math.min(limit, expectedSize ?? Math.max(64, data.length * 4)));
  let n = 0;
  let pos = 2;
  let buf = 0;
  let count = 0;
  // Up to one byte past the end reads as zero: an 8-bit code lookup may peek beyond the last bits
  const fill = (k: number): void => {
    while (count < k) {
      if (pos > data.length) throw new W3xFormatError('implode: stream ends early');
      buf |= (pos < data.length ? data[pos] : 0) << count;
      pos++;
      count += 8;
    }
  };
  const bits = (k: number): number => {
    fill(k);
    const v = buf & ((1 << k) - 1);
    buf >>>= k;
    count -= k;
    return v;
  };
  const decode = (table: Uint16Array): number => {
    fill(8);
    const e = table[buf & 0xff];
    if (e === 0xffff) throw new W3xFormatError('implode: bad code');
    const k = e >> 8;
    buf >>>= k;
    count -= k;
    return e & 0xff;
  };
  const ensure = (extra: number): void => {
    if (n + extra <= out.length) return;
    if (n + extra > limit) throw new W3xFormatError(`implode: unpacks to more than ${limit} bytes`);
    const grown = new Uint8Array(Math.min(limit, Math.max(out.length * 2, n + extra)));
    grown.set(out.subarray(0, n));
    out = grown;
  };

  // MPQ sectors stop at their known size, standalone streams at the end marker
  while (expectedSize === undefined || n < expectedSize) {
    if (bits(1) === 0) {
      ensure(1);
      out[n++] = bits(8);
      continue;
    }
    const ls = decode(lenTable);
    const length = LEN_BASE[ls] + (EX_LEN_BITS[ls] ? bits(EX_LEN_BITS[ls]) : 0) + 2;
    if (length === END_LENGTH) break;
    const ds = decode(distTable);
    const dist = (length === 2 ? (ds << 2) | bits(2) : (ds << dictBits) | bits(dictBits)) + 1;
    if (dist > n) throw new W3xFormatError('implode: distance before the start');
    ensure(length);
    for (let i = 0; i < length; i++, n++) out[n] = out[n - dist];
  }
  if (expectedSize !== undefined && n !== expectedSize) {
    throw new W3xFormatError(`implode: got ${n} bytes, expected ${expectedSize}`);
  }
  return out.subarray(0, n);
}
