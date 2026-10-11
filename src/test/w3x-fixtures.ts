/**
 * Synthetic Warcraft 3 map data for the w3x importer specs: a little-endian
 * byte writer and a minimal MPQ writer (v0 or v1 header, encrypted tables,
 * optional file encryption, sectors or single units, zlib or pre-packed
 * sectors), so the specs need no Blizzard files.
 */

import { zlibSync } from 'fflate';
import { MPQ_FILE, MpqHash, mpqCrypt, mpqHash } from '../app/world/w3x/mpq';

export class ByteWriter {
  private buf = new Uint8Array(256);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private grow(n: number): number {
    const at = this.length;
    if (at + n > this.buf.length) {
      const next = new Uint8Array(Math.max(this.buf.length * 2, at + n));
      next.set(this.buf);
      this.buf = next;
      this.view = new DataView(next.buffer);
    }
    this.length += n;
    return at;
  }

  u8(v: number): this {
    const at = this.grow(1);
    this.buf[at] = v;
    return this;
  }
  i16(v: number): this {
    const at = this.grow(2);
    this.view.setInt16(at, v, true);
    return this;
  }
  u16(v: number): this {
    const at = this.grow(2);
    this.view.setUint16(at, v, true);
    return this;
  }
  i32(v: number): this {
    const at = this.grow(4);
    this.view.setInt32(at, v, true);
    return this;
  }
  u32(v: number): this {
    const at = this.grow(4);
    this.view.setUint32(at, v >>> 0, true);
    return this;
  }
  f32(v: number): this {
    const at = this.grow(4);
    this.view.setFloat32(at, v, true);
    return this;
  }
  id4(s: string): this {
    for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i));
    return this;
  }
  cstr(s: string): this {
    this.bytes(new TextEncoder().encode(s));
    return this.u8(0);
  }
  bytes(b: Uint8Array): this {
    const at = this.grow(b.length);
    this.buf.set(b, at);
    return this;
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export interface FixtureFile {
  name: string;
  data: Uint8Array;
  /** 'zlib' (default), 'none', or a packer returning a sector with its mask byte */
  compress?: 'zlib' | 'none' | ((sector: Uint8Array) => Uint8Array);
  encrypt?: boolean;
  fixKey?: boolean;
  singleUnit?: boolean;
}

export interface FixtureArchiveOptions {
  /** 512 << sectorShift bytes per sector */
  sectorShift?: number;
  formatVersion?: 0 | 1;
  /** Write the HM3W map header in front (default true) */
  mapHeader?: boolean;
  /** Write a (listfile) (default true) */
  listfile?: boolean;
  hashTableSize?: number;
}

function packSector(f: FixtureFile, sector: Uint8Array): Uint8Array {
  if (f.compress === 'none') return sector;
  const packed =
    typeof f.compress === 'function'
      ? f.compress(sector)
      : new Uint8Array([0x02, ...zlibSync(sector)]);
  // Sectors that do not shrink are stored raw, as Storm does
  return packed.length < sector.length ? packed : sector;
}

/** Builds a .w3x-like file: HM3W header + an MPQ archive with the given files */
export function buildMpq(files: FixtureFile[], options: FixtureArchiveOptions = {}): Uint8Array {
  const sectorShift = options.sectorShift ?? 3;
  const sectorSize = 512 << sectorShift;
  const version = options.formatVersion ?? 0;
  const headerSize = version === 1 ? 44 : 32;
  const all = [...files];
  if (options.listfile !== false) {
    all.push({
      name: '(listfile)',
      data: new TextEncoder().encode(files.map((f) => f.name).join('\r\n')),
      encrypt: true,
      fixKey: true,
    });
  }

  const body = new ByteWriter();
  const blocks: { offset: number; csize: number; size: number; flags: number }[] = [];
  for (const f of all) {
    const offset = headerSize + body.length;
    let flags = MPQ_FILE.EXISTS;
    const compressed = f.compress !== 'none';
    if (compressed) flags |= MPQ_FILE.COMPRESS;
    let key = 0;
    if (f.encrypt) {
      flags |= MPQ_FILE.ENCRYPTED;
      key = mpqHash(f.name.split('\\').pop() ?? f.name, MpqHash.FileKey);
      if (f.fixKey) {
        flags |= MPQ_FILE.FIX_KEY;
        key = ((key + offset) ^ f.data.length) >>> 0;
      }
    }
    let out: Uint8Array;
    if (f.singleUnit) {
      flags |= MPQ_FILE.SINGLE_UNIT;
      out = compressed ? packSector(f, f.data) : f.data.slice();
      if (f.encrypt) mpqCrypt(out, key, true);
    } else if (!compressed) {
      out = f.data.slice();
      if (f.encrypt) {
        for (let i = 0; i * sectorSize < out.length; i++) {
          mpqCrypt(out.subarray(i * sectorSize, Math.min(out.length, (i + 1) * sectorSize)), (key + i) >>> 0, true);
        }
      }
    } else {
      const sectors: Uint8Array[] = [];
      for (let i = 0; i * sectorSize < f.data.length; i++) {
        sectors.push(packSector(f, f.data.subarray(i * sectorSize, (i + 1) * sectorSize)));
      }
      const table = new ByteWriter();
      let pos = (sectors.length + 1) * 4;
      for (const s of sectors) {
        table.u32(pos);
        pos += s.length;
      }
      table.u32(pos);
      const tableBytes = table.done();
      if (f.encrypt) {
        mpqCrypt(tableBytes, (key - 1) >>> 0, true);
        sectors.forEach((s, i) => mpqCrypt(s, (key + i) >>> 0, true));
      }
      const w = new ByteWriter().bytes(tableBytes);
      for (const s of sectors) w.bytes(s);
      out = w.done();
    }
    body.bytes(out);
    blocks.push({ offset, csize: out.length, size: f.data.length, flags });
  }

  const hashSize = options.hashTableSize ?? Math.max(16, 1 << Math.ceil(Math.log2(all.length * 2)));
  const hashes = new ByteWriter();
  const table = Array.from({ length: hashSize }, () => [0xffffffff, 0xffffffff, 0xffff, 0xffff, 0xffffffff]);
  all.forEach((f, bi) => {
    let i = mpqHash(f.name, MpqHash.TableOffset) % hashSize;
    while (table[i][4] !== 0xffffffff) i = (i + 1) % hashSize;
    table[i] = [mpqHash(f.name, MpqHash.NameA), mpqHash(f.name, MpqHash.NameB), 0, 0, bi];
  });
  for (const [a, b, locale, platform, block] of table) hashes.u32(a).u32(b).u16(locale).u16(platform).u32(block);
  const hashBytes = hashes.done();
  mpqCrypt(hashBytes, mpqHash('(hash table)', MpqHash.FileKey), true);
  const blockW = new ByteWriter();
  for (const b of blocks) blockW.u32(b.offset).u32(b.csize).u32(b.size).u32(b.flags);
  const blockBytes = blockW.done();
  mpqCrypt(blockBytes, mpqHash('(block table)', MpqHash.FileKey), true);

  const hashPos = headerSize + body.length;
  const blockPos = hashPos + hashBytes.length;
  const hiBlockPos = blockPos + blockBytes.length;
  const archiveSize = hiBlockPos + (version === 1 ? blocks.length * 2 : 0);
  const mpq = new ByteWriter()
    .id4('MPQ\x1a')
    .u32(headerSize)
    .u32(archiveSize)
    .u16(version)
    .u16(sectorShift)
    .u32(hashPos)
    .u32(blockPos)
    .u32(hashSize)
    .u32(blocks.length);
  if (version === 1) mpq.u32(hiBlockPos).u32(0).u16(0).u16(0);
  mpq.bytes(body.done()).bytes(hashBytes).bytes(blockBytes);
  // v1: the high 16 bits of every block offset (all zero below 4 GB)
  if (version === 1) mpq.bytes(new Uint8Array(blocks.length * 2));

  if (options.mapHeader === false) return mpq.done();
  const head = new ByteWriter().id4('HM3W').u32(0).cstr('Fixture').u32(0).u32(2);
  const padded = new Uint8Array(512 + mpq.length);
  padded.set(head.done());
  padded.set(mpq.done(), 512);
  return padded;
}

export function base64Bytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Minimal binary-mode implode encoder (greedy matches) to round-trip longer data */
export function implode(data: Uint8Array, dictBits: 4 | 5 | 6): Uint8Array {
  const LEN_BITS = [3, 2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 7, 7];
  const LEN_CODE = [0x05, 0x03, 0x01, 0x06, 0x0a, 0x02, 0x0c, 0x14, 0x04, 0x18, 0x08, 0x30, 0x10, 0x20, 0x40, 0x00];
  const EX = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];
  const BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 14, 22, 38, 70, 134, 262];
  const DIST_BITS = [2, 4, 4, 5, 5, 5, 5, ...Array(15).fill(6), ...Array(26).fill(7), ...Array(16).fill(8)];
  const DIST_CODE = [
    0x03, 0x0d, 0x05, 0x19, 0x09, 0x11, 0x01, 0x3e, 0x1e, 0x2e, 0x0e, 0x36, 0x16, 0x26, 0x06, 0x3a, 0x1a, 0x2a,
    0x0a, 0x32, 0x12, 0x22, 0x42, 0x02, 0x7c, 0x3c, 0x5c, 0x1c, 0x6c, 0x2c, 0x4c, 0x0c, 0x74, 0x34, 0x54, 0x14,
    0x64, 0x24, 0x44, 0x04, 0x78, 0x38, 0x58, 0x18, 0x68, 0x28, 0x48, 0x08, 0xf0, 0x70, 0xb0, 0x30, 0xd0, 0x50,
    0x90, 0x10, 0xe0, 0x60, 0xa0, 0x20, 0xc0, 0x40, 0x80, 0x00,
  ];
  const out = [0, dictBits];
  let acc = 0;
  let n = 0;
  const put = (v: number, k: number): void => {
    for (let i = 0; i < k; i++) {
      acc |= ((v >> i) & 1) << n;
      if (++n === 8) {
        out.push(acc);
        acc = 0;
        n = 0;
      }
    }
  };
  const putLength = (len: number): void => {
    const v = len - 2;
    let s = 15;
    while (BASE[s] > v) s--;
    put(1, 1);
    put(LEN_CODE[s], LEN_BITS[s]);
    if (EX[s]) put(v - BASE[s], EX[s]);
  };
  const window = 64 << dictBits;
  for (let i = 0; i < data.length; ) {
    let best = 0;
    let bestDist = 0;
    for (let d = 1; d <= Math.min(i, window); d++) {
      let l = 0;
      while (l < 518 && i + l < data.length && data[i + l] === data[i + l - d]) l++;
      if (l === 2 && d > 256) continue;
      if (l > best) {
        best = l;
        bestDist = d;
      }
    }
    if (best >= 2) {
      putLength(best);
      const d = bestDist - 1;
      const low = best === 2 ? 2 : dictBits;
      put(DIST_CODE[d >> low], DIST_BITS[d >> low]);
      put(d & ((1 << low) - 1), low);
      i += best;
    } else {
      put(0, 1);
      put(data[i], 8);
      i++;
    }
  }
  putLength(519);
  if (n) out.push(acc);
  return new Uint8Array(out);
}

/**
 * A Warcraft test map (not in the repo: tmp/ is ignored; Mafa TD by default), or null; specs
 * that read it skip without it. W3X_TEST_MAP overrides; worktrees find the
 * main checkout's copy. The caller passes `existsSync` (this file is also
 * compiled without Node types).
 */
export function findTestMap(exists: (path: string) => boolean, file = 'Mafa-Td-Queen-v14.6.w3x'): string | null {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
  const candidates = [
    file === 'Mafa-Td-Queen-v14.6.w3x' ? env?.['W3X_TEST_MAP'] : undefined,
    `tmp/wc3/${file}`,
    `D:/Source/3dtd/tmp/wc3/${file}`,
  ];
  return candidates.find((c): c is string => !!c && exists(c)) ?? null;
}
