/**
 * bzip2 decoder for MPQ compression mask 0x10. Written from the format
 * (Julian Seward's bzip2, as documented in "bzip2 format" notes): stream
 * header "BZh1".."BZh9", blocks with the magic 0x314159265359, each a
 * Burrows-Wheeler transform over move-to-front and run-length coded symbols
 * in up to six Huffman tables, then the end-of-stream magic 0x177245385090.
 * Bits are read most significant first. Several concatenated streams are
 * decoded one after another. Block CRCs are not checked; MPQ files carry no
 * checksum we rely on either.
 */

import { W3xFormatError } from './binary-reader';

class BitReader {
  private pos = 0;
  private buf = 0;
  private count = 0;

  constructor(private readonly data: Uint8Array) {}

  get atEnd(): boolean {
    return this.pos >= this.data.length && this.count === 0;
  }

  bits(n: number): number {
    let v = 0;
    while (n > 0) {
      if (this.count === 0) {
        if (this.pos >= this.data.length) throw new W3xFormatError('bzip2: stream ends early');
        this.buf = this.data[this.pos++];
        this.count = 8;
      }
      const take = Math.min(n, this.count);
      const shift = this.count - take;
      v = v * (1 << take) + ((this.buf >> shift) & ((1 << take) - 1));
      this.count -= take;
      n -= take;
    }
    return v;
  }

  bit(): number {
    return this.bits(1);
  }

  /** Skips to the next byte boundary (between concatenated streams) */
  align(): void {
    this.count = 0;
  }
}

const BLOCK_MAGIC_HI = 0x314159;
const BLOCK_MAGIC_LO = 0x265359;
const END_MAGIC_HI = 0x177245;
const END_MAGIC_LO = 0x385090;
const MAX_GROUPS = 6;
const GROUP_SIZE = 50;
const MAX_CODE_LEN = 20;

/** Canonical Huffman table for one group: limit/base/perm as in the reference decoder */
interface HuffTable {
  minLen: number;
  limit: Int32Array;
  base: Int32Array;
  perm: Int32Array;
}

function buildTable(lengths: Uint8Array, alphaSize: number): HuffTable {
  let minLen = 32;
  let maxLen = 0;
  for (let i = 0; i < alphaSize; i++) {
    minLen = Math.min(minLen, lengths[i]);
    maxLen = Math.max(maxLen, lengths[i]);
  }
  const perm = new Int32Array(alphaSize);
  let pp = 0;
  for (let len = minLen; len <= maxLen; len++) {
    for (let s = 0; s < alphaSize; s++) if (lengths[s] === len) perm[pp++] = s;
  }
  const count = new Int32Array(MAX_CODE_LEN + 2);
  for (let i = 0; i < alphaSize; i++) count[lengths[i]]++;
  const limit = new Int32Array(MAX_CODE_LEN + 2).fill(-1);
  const base = new Int32Array(MAX_CODE_LEN + 2);
  let code = 0;
  let index = 0;
  for (let len = minLen; len <= maxLen; len++) {
    // Codes of this length run from `code` to `code + count - 1`; base maps them to perm indices
    base[len] = index - code;
    code += count[len];
    index += count[len];
    limit[len] = code - 1;
    code <<= 1;
  }
  return { minLen, limit, base, perm };
}

function decodeSymbol(r: BitReader, t: HuffTable): number {
  let len = t.minLen;
  let code = r.bits(len);
  while (len <= MAX_CODE_LEN) {
    if (t.limit[len] >= 0 && code <= t.limit[len]) return t.perm[t.base[len] + code];
    code = (code << 1) | r.bit();
    len++;
  }
  throw new W3xFormatError('bzip2: bad Huffman code');
}

class Output {
  bytes: Uint8Array;
  n = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(Math.max(size, 64));
  }

  push(b: number): void {
    if (this.n === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.n++] = b;
  }
}

function readBlock(r: BitReader, blockMax: number, out: Output): void {
  r.bits(32); // block CRC
  if (r.bit()) throw new W3xFormatError('bzip2: randomised blocks are not supported');
  const origPtr = r.bits(24);

  // Symbol map: which byte values occur in the block
  const used = r.bits(16);
  const seqToUnseq: number[] = [];
  for (let i = 0; i < 16; i++) {
    if (used & (0x8000 >> i)) {
      const bitsUsed = r.bits(16);
      for (let j = 0; j < 16; j++) if (bitsUsed & (0x8000 >> j)) seqToUnseq.push(i * 16 + j);
    }
  }
  if (seqToUnseq.length === 0) throw new W3xFormatError('bzip2: block without symbols');
  const alphaSize = seqToUnseq.length + 2;

  const nGroups = r.bits(3);
  if (nGroups < 2 || nGroups > MAX_GROUPS) throw new W3xFormatError('bzip2: bad table count');
  const nSelectors = r.bits(15);
  if (nSelectors < 1) throw new W3xFormatError('bzip2: no selectors');
  const mtfGroups = Array.from({ length: nGroups }, (_, i) => i);
  const selectors = new Uint8Array(nSelectors);
  for (let i = 0; i < nSelectors; i++) {
    let j = 0;
    while (r.bit()) {
      j++;
      if (j >= nGroups) throw new W3xFormatError('bzip2: bad selector');
    }
    const g = mtfGroups[j];
    mtfGroups.splice(j, 1);
    mtfGroups.unshift(g);
    selectors[i] = g;
  }

  const tables: HuffTable[] = [];
  for (let g = 0; g < nGroups; g++) {
    const lengths = new Uint8Array(alphaSize);
    let len = r.bits(5);
    for (let s = 0; s < alphaSize; s++) {
      for (;;) {
        if (len < 1 || len > MAX_CODE_LEN) throw new W3xFormatError('bzip2: bad code length');
        if (!r.bit()) break;
        len += r.bit() ? -1 : 1;
      }
      lengths[s] = len;
    }
    tables.push(buildTable(lengths, alphaSize));
  }

  // Huffman -> MTF/RLE2 -> BWT input (tt) and byte counts
  const eob = alphaSize - 1;
  const mtf = seqToUnseq.slice();
  const tt = new Uint32Array(blockMax);
  const counts = new Int32Array(256);
  let count = 0;
  let selector = 0;
  let groupLeft = 0;
  let table = tables[0];
  let runLength = 0;
  let runWeight = 1;
  const flushRun = (): void => {
    if (runLength === 0) return;
    const b = mtf[0];
    if (count + runLength > blockMax) throw new W3xFormatError('bzip2: block overflow');
    counts[b] += runLength;
    for (let i = 0; i < runLength; i++) tt[count++] = b;
    runLength = 0;
    runWeight = 1;
  };
  for (;;) {
    if (groupLeft === 0) {
      if (selector >= nSelectors) throw new W3xFormatError('bzip2: selectors exhausted');
      table = tables[selectors[selector++]];
      groupLeft = GROUP_SIZE;
    }
    groupLeft--;
    const sym = decodeSymbol(r, table);
    if (sym <= 1) {
      // RUNA adds 1 x weight, RUNB 2 x weight, in bijective base 2
      runLength += (sym + 1) * runWeight;
      runWeight <<= 1;
      if (runLength > blockMax) throw new W3xFormatError('bzip2: run too long');
      continue;
    }
    flushRun();
    if (sym === eob) break;
    const idx = sym - 1;
    const b = mtf[idx];
    mtf.splice(idx, 1);
    mtf.unshift(b);
    if (count >= blockMax) throw new W3xFormatError('bzip2: block overflow');
    counts[b]++;
    tt[count++] = b;
  }
  if (origPtr >= count) throw new W3xFormatError('bzip2: bad origin pointer');

  // Inverse BWT: tt[k] high bits get the index of the next byte
  const start = new Int32Array(256);
  for (let i = 0, sum = 0; i < 256; i++) {
    start[i] = sum;
    sum += counts[i];
  }
  for (let i = 0; i < count; i++) {
    const b = tt[i] & 0xff;
    tt[start[b]++] |= i << 8;
  }

  // Walk the chain and undo the initial run-length coding (4 equal bytes + a repeat count)
  let pos = tt[origPtr] >>> 8;
  let last = -1;
  let same = 0;
  for (let i = 0; i < count; i++) {
    const entry = tt[pos];
    const b = entry & 0xff;
    pos = entry >>> 8;
    if (same === 4) {
      for (let k = 0; k < b; k++) out.push(last);
      same = 0;
      last = -1;
      continue;
    }
    out.push(b);
    if (b === last) same++;
    else {
      last = b;
      same = 1;
    }
  }
}

export function bunzip2(data: Uint8Array, expectedSize?: number): Uint8Array {
  const r = new BitReader(data);
  const out = new Output(expectedSize ?? data.length * 4);
  let streams = 0;
  while (!r.atEnd) {
    // Concatenated streams start on byte boundaries; trailing zero padding ends the data
    if (streams > 0) {
      r.align();
      if (r.atEnd) break;
    }
    const b = r.bits(8);
    if (b === 0 && streams > 0) break;
    if (b !== 0x42 || r.bits(8) !== 0x5a || r.bits(8) !== 0x68) throw new W3xFormatError('bzip2: bad stream header');
    const level = r.bits(8) - 0x30;
    if (level < 1 || level > 9) throw new W3xFormatError('bzip2: bad block size');
    const blockMax = level * 100000;
    for (;;) {
      const hi = r.bits(24);
      const lo = r.bits(24);
      if (hi === BLOCK_MAGIC_HI && lo === BLOCK_MAGIC_LO) {
        readBlock(r, blockMax, out);
      } else if (hi === END_MAGIC_HI && lo === END_MAGIC_LO) {
        r.bits(32); // combined CRC
        break;
      } else {
        throw new W3xFormatError('bzip2: bad block magic');
      }
    }
    streams++;
  }
  if (expectedSize !== undefined && out.n !== expectedSize) {
    throw new W3xFormatError(`bzip2: got ${out.n} bytes, expected ${expectedSize}`);
  }
  return out.bytes.subarray(0, out.n);
}
