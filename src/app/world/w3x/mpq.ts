/**
 * Read-only MPQ archive reader for Warcraft 3 maps (.w3x/.w3m).
 *
 * A map file starts with a 512-byte "HM3W" header; the MPQ header follows on
 * a 512-byte boundary. Supported: header versions 0 to 3 (the classic hash and
 * block tables; v1+ adds the high 16 bits of block offsets, v2/v3 the 64-bit
 * table positions), encrypted tables and files (incl. FIX_KEY), sector offset
 * tables, single-unit files, raw sectors, and the compressions zlib (0x02),
 * PKWARE implode (0x08) and bzip2 (0x10). Audio compressions (Huffman,
 * ADPCM), sparse and LZMA raise a clear error.
 *
 * Protected maps often drop the listfile and fill the tables with junk; the
 * reader clamps table sizes to the buffer and the caller looks files up by
 * their known names (`KNOWN_MAP_FILES`).
 */

import { unzlibSync } from 'fflate';
import { W3xFormatError } from './binary-reader';
import { bunzip2 } from './bzip2';
import { explode } from './explode';

// ---------------------------------------------------------------- crypto

const CRYPT = (() => {
  const t = new Uint32Array(0x500);
  let seed = 0x00100001;
  for (let i = 0; i < 0x100; i++) {
    for (let k = 0, idx = i; k < 5; k++, idx += 0x100) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const t1 = (seed & 0xffff) << 16;
      seed = (seed * 125 + 3) % 0x2aaaab;
      const t2 = seed & 0xffff;
      t[idx] = (t1 | t2) >>> 0;
    }
  }
  return t;
})();

export const MpqHash = {
  TableOffset: 0,
  NameA: 1,
  NameB: 2,
  FileKey: 3,
} as const;
export type MpqHashType = (typeof MpqHash)[keyof typeof MpqHash];

/** Storm's string hash; names are case-insensitive and use backslashes */
export function mpqHash(name: string, type: MpqHashType): number {
  let s1 = 0x7fed7fed;
  let s2 = 0xeeeeeeee;
  const upper = name.toUpperCase().replace(/\//g, '\\');
  for (let i = 0; i < upper.length; i++) {
    const c = upper.charCodeAt(i) & 0xff;
    s1 = (CRYPT[(type << 8) + c] ^ ((s1 + s2) >>> 0)) >>> 0;
    s2 = (c + s1 + s2 + ((s2 << 5) >>> 0) + 3) >>> 0;
  }
  return s1;
}

/** Decrypts (or, with `encrypt`, encrypts) whole 32-bit words in place */
export function mpqCrypt(data: Uint8Array, key: number, encrypt = false): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let seed = 0xeeeeeeee;
  key >>>= 0;
  for (let i = 0; i + 4 <= data.length; i += 4) {
    seed = (seed + CRYPT[0x400 + (key & 0xff)]) >>> 0;
    const v = view.getUint32(i, true);
    const out = (v ^ (key + seed)) >>> 0;
    view.setUint32(i, out, true);
    const plain = encrypt ? v : out;
    key = ((((~key << 0x15) >>> 0) + 0x11111111) >>> 0 | (key >>> 0x0b)) >>> 0;
    seed = (plain + seed + ((seed << 5) >>> 0) + 3) >>> 0;
  }
}

// ---------------------------------------------------------------- archive

export const MPQ_FILE = {
  IMPLODE: 0x100,
  COMPRESS: 0x200,
  ENCRYPTED: 0x10000,
  FIX_KEY: 0x20000,
  PATCH: 0x100000,
  SINGLE_UNIT: 0x1000000,
  DELETE_MARKER: 0x2000000,
  SECTOR_CRC: 0x4000000,
  EXISTS: 0x80000000,
} as const;

const COMPRESSION = {
  HUFFMAN: 0x01,
  ZLIB: 0x02,
  IMPLODE: 0x08,
  BZIP2: 0x10,
  SPARSE: 0x20,
  ADPCM_MONO: 0x40,
  ADPCM_STEREO: 0x80,
  LZMA: 0x12,
} as const;

/** File names a map uses, for archives without a listfile */
export const KNOWN_MAP_FILES = [
  '(listfile)',
  '(attributes)',
  'war3map.w3i',
  'war3map.w3e',
  'war3map.doo',
  'war3map.w3r',
  'war3map.wpm',
  'war3map.shd',
  'war3map.mmp',
  'war3map.j',
  'scripts\\war3map.j',
  'war3map.lua',
  'scripts\\war3map.lua',
  'war3map.wts',
  'war3mapUnits.doo',
  'war3map.w3u',
  'war3map.w3t',
  'war3map.w3d',
  'war3map.w3a',
  'war3map.w3b',
  'war3map.w3h',
  'war3map.w3q',
  'war3mapMisc.txt',
  'war3mapSkin.txt',
  'war3mapExtra.txt',
  'war3map.wct',
  'war3map.wtg',
  'war3map.imp',
  'war3map.w3c',
  'war3map.w3s',
];

interface HashEntry {
  nameA: number;
  nameB: number;
  block: number;
}

export interface MpqBlock {
  /** Offset relative to the archive start */
  offset: number;
  compressedSize: number;
  size: number;
  flags: number;
}

export interface MpqHeader {
  /** Position of the MPQ header in the file */
  archiveOffset: number;
  formatVersion: number;
  sectorSize: number;
  hashTableEntries: number;
  blockTableEntries: number;
}

const HASH_FREE = 0xffffffff;
const HASH_DELETED = 0xfffffffe;

export class MpqArchive {
  readonly header: MpqHeader;
  readonly blocks: MpqBlock[];
  /** Notes about oddities the reader worked around (protected maps) */
  readonly notes: string[] = [];
  private readonly hashes: HashEntry[];
  private readonly view: DataView;

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const base = findHeader(data);
    if (base < 0) throw new W3xFormatError('Not an MPQ archive (no MPQ header found)');
    const v = this.view;
    const formatVersion = v.getUint16(base + 12, true);
    const sectorShift = v.getUint16(base + 14, true);
    let hashPos = v.getUint32(base + 16, true);
    let blockPos = v.getUint32(base + 20, true);
    let hashCount = v.getUint32(base + 24, true);
    let blockCount = v.getUint32(base + 28, true);
    let hiBlockPos = 0;
    if (formatVersion >= 1 && base + 44 <= data.length) {
      hiBlockPos = Number(v.getBigUint64(base + 32, true));
      hashPos += v.getUint16(base + 40, true) * 2 ** 32;
      blockPos += v.getUint16(base + 42, true) * 2 ** 32;
    }
    if (formatVersion > 3) this.notes.push(`unknown header version ${formatVersion}, read as v0`);
    // 4 KB sectors (shift 3) in every map; past 4 MB a sector is a damaged or hostile header
    if (sectorShift > 13) throw new W3xFormatError(`MPQ: bad sector size shift ${sectorShift}`);

    // Protectors write huge or wrapped table sizes; the tables cannot extend past the file
    const maxEntries = (pos: number): number => Math.max(0, Math.floor((data.length - base - pos) / 16));
    if (hashCount > maxEntries(hashPos)) {
      this.notes.push(`hash table clamped from ${hashCount} entries`);
      hashCount = maxEntries(hashPos);
    }
    if (blockCount > maxEntries(blockPos)) {
      this.notes.push(`block table clamped from ${blockCount} entries`);
      blockCount = maxEntries(blockPos);
    }
    if (hashCount === 0) throw new W3xFormatError('MPQ: empty or unreadable hash table');

    this.header = {
      archiveOffset: base,
      formatVersion,
      sectorSize: 512 << sectorShift,
      hashTableEntries: hashCount,
      blockTableEntries: blockCount,
    };

    const ht = data.slice(base + hashPos, base + hashPos + hashCount * 16);
    mpqCrypt(ht, mpqHash('(hash table)', MpqHash.FileKey));
    const htv = new DataView(ht.buffer);
    this.hashes = [];
    for (let i = 0; i < hashCount; i++) {
      this.hashes.push({
        nameA: htv.getUint32(i * 16, true),
        nameB: htv.getUint32(i * 16 + 4, true),
        block: htv.getUint32(i * 16 + 12, true),
      });
    }

    const bt = data.slice(base + blockPos, base + blockPos + blockCount * 16);
    mpqCrypt(bt, mpqHash('(block table)', MpqHash.FileKey));
    const btv = new DataView(bt.buffer);
    const hiOk = hiBlockPos > 0 && base + hiBlockPos + blockCount * 2 <= data.length;
    this.blocks = [];
    for (let i = 0; i < blockCount; i++) {
      const hi = hiOk ? v.getUint16(base + hiBlockPos + i * 2, true) : 0;
      this.blocks.push({
        offset: btv.getUint32(i * 16, true) + hi * 2 ** 32,
        compressedSize: btv.getUint32(i * 16 + 4, true),
        size: btv.getUint32(i * 16 + 8, true),
        flags: btv.getUint32(i * 16 + 12, true),
      });
    }
  }

  /** Block index of a file, or -1 */
  find(name: string): number {
    const n = this.hashes.length;
    const a = mpqHash(name, MpqHash.NameA);
    const b = mpqHash(name, MpqHash.NameB);
    let i = mpqHash(name, MpqHash.TableOffset) % n;
    for (let k = 0; k < n; k++, i = (i + 1) % n) {
      const h = this.hashes[i];
      if (h.block === HASH_FREE) return -1;
      if (h.nameA === a && h.nameB === b && h.block !== HASH_DELETED && h.block < this.blocks.length) {
        return h.block;
      }
    }
    return -1;
  }

  has(name: string): boolean {
    const bi = this.find(name);
    return bi >= 0 && (this.blocks[bi].flags & MPQ_FILE.EXISTS) !== 0;
  }

  /** File contents, or null when the archive has no such file */
  read(name: string): Uint8Array | null {
    const bi = this.find(name);
    if (bi < 0) return null;
    return this.readBlock(bi, name);
  }

  /** Names from the listfile plus the known map files that exist */
  list(): string[] {
    const names = new Set<string>();
    const lf = this.read('(listfile)');
    if (lf) {
      for (const line of new TextDecoder().decode(lf).split(/[\r\n;]+/)) {
        const s = line.trim();
        if (s) names.add(s);
      }
    }
    for (const n of KNOWN_MAP_FILES) names.add(n);
    return [...names].filter((n) => this.has(n)).sort();
  }

  private readBlock(index: number, name: string): Uint8Array | null {
    const block = this.blocks[index];
    const { flags, size } = block;
    if (!(flags & MPQ_FILE.EXISTS) || flags & MPQ_FILE.DELETE_MARKER) return null;
    // The size is read from the archive: allocate nothing a map file never needs
    if (size > MAX_FILE_SIZE) throw new W3xFormatError(`MPQ: ${name} claims ${size} bytes, more than ${MAX_FILE_SIZE}`);
    if (flags & MPQ_FILE.PATCH) throw new W3xFormatError(`MPQ: ${name} is a patch file`);
    const start = this.header.archiveOffset + block.offset;
    const end = start + block.compressedSize;
    if (start < 0 || end > this.data.length) {
      throw new W3xFormatError(`MPQ: ${name} lies outside the archive (protected or truncated map)`);
    }
    const raw = this.data.slice(start, end);

    let key: number | null = null;
    if (flags & MPQ_FILE.ENCRYPTED) {
      key = mpqHash(name.split(/[\\/]/).pop() ?? name, MpqHash.FileKey);
      if (flags & MPQ_FILE.FIX_KEY) key = ((key + block.offset) ^ size) >>> 0;
    }

    if (flags & MPQ_FILE.SINGLE_UNIT) {
      if (key !== null) mpqCrypt(raw, key);
      return this.unpack(raw, size, flags, name);
    }

    if (!(flags & (MPQ_FILE.COMPRESS | MPQ_FILE.IMPLODE))) {
      if (key !== null) {
        const sector = this.header.sectorSize;
        for (let i = 0; i * sector < raw.length; i++) {
          mpqCrypt(raw.subarray(i * sector, Math.min(raw.length, (i + 1) * sector)), (key + i) >>> 0);
        }
      }
      return raw.subarray(0, size);
    }

    const sector = this.header.sectorSize;
    const sectors = Math.ceil(size / sector);
    const tableLength = (sectors + 1 + (flags & MPQ_FILE.SECTOR_CRC ? 1 : 0)) * 4;
    if (raw.length < tableLength) throw new W3xFormatError(`MPQ: ${name} has a truncated sector table`);
    const table = raw.slice(0, tableLength);
    if (key !== null) mpqCrypt(table, (key - 1) >>> 0);
    const tv = new DataView(table.buffer);
    const out = new Uint8Array(size);
    for (let i = 0; i < sectors; i++) {
      const from = tv.getUint32(i * 4, true);
      const to = tv.getUint32(i * 4 + 4, true);
      if (to < from || to > raw.length) throw new W3xFormatError(`MPQ: ${name} has a bad sector table`);
      const part = raw.slice(from, to);
      if (key !== null) mpqCrypt(part, (key + i) >>> 0);
      const want = Math.min(sector, size - i * sector);
      out.set(this.unpack(part, want, flags, name), i * sector);
    }
    return out;
  }

  /** One sector or a single-unit file; stored data is as long as the output */
  private unpack(data: Uint8Array, size: number, flags: number, name: string): Uint8Array {
    if (data.length >= size) return data.subarray(0, size);
    if (flags & MPQ_FILE.IMPLODE) return explode(data, size);
    return decompress(data, size, name);
  }
}

/** Largest file the reader unpacks; the biggest map files (war3map.w3e, .doo) stay far below */
export const MAX_FILE_SIZE = 64 * 1024 * 1024;

/**
 * Most bytes a stage in the middle of a chain may produce on the way to
 * `size`: its output is the next stage's compressed input, at most a little
 * larger than what that stage unpacks to
 */
function chainLimit(size: number): number {
  return size + (size >> 3) + 1024;
}

/**
 * Decompresses one MPQ sector (first byte: compression mask). No stage
 * writes more than the sector needs (zip bombs stop there): the last one
 * exactly `size`, one in the middle at most `chainLimit(size)`.
 */
export function decompress(data: Uint8Array, size: number, name = 'file'): Uint8Array {
  const mask = data[0];
  let d = data.subarray(1);
  if (mask === COMPRESSION.LZMA) throw new W3xFormatError(`MPQ: ${name} uses LZMA, not supported`);
  if (mask & COMPRESSION.SPARSE) throw new W3xFormatError(`MPQ: ${name} uses sparse compression, not supported`);
  if (mask & (COMPRESSION.HUFFMAN | COMPRESSION.ADPCM_MONO | COMPRESSION.ADPCM_STEREO)) {
    throw new W3xFormatError(`MPQ: ${name} uses audio compression (mask 0x${mask.toString(16)}), not supported`);
  }
  const known = COMPRESSION.ZLIB | COMPRESSION.IMPLODE | COMPRESSION.BZIP2;
  if (mask & ~known) throw new W3xFormatError(`MPQ: ${name} uses unknown compression 0x${mask.toString(16)}`);
  // Writers apply zlib/implode first and bzip2 last; undo in reverse
  const last = (mask & (COMPRESSION.ZLIB | COMPRESSION.IMPLODE)) === 0;
  const middle = chainLimit(size);
  if (mask & COMPRESSION.BZIP2) d = last ? bunzip2(d, size) : bunzip2(d, undefined, middle);
  if (mask & COMPRESSION.IMPLODE) d = mask & COMPRESSION.ZLIB ? explode(d, undefined, middle) : explode(d, size);
  if (mask & COMPRESSION.ZLIB) {
    // Into a buffer one byte longer than wanted: fflate stops writing at its end, a full buffer means too much
    d = unzlibSync(d, { out: new Uint8Array(size + 1) });
    if (d.length > size) throw new W3xFormatError(`MPQ: ${name} unpacks to more than ${size} bytes`);
  }
  if (d.length !== size) throw new W3xFormatError(`MPQ: ${name} unpacked to ${d.length} bytes, expected ${size}`);
  return d;
}

const MPQ_MAGIC = 0x1a51504d; // "MPQ\x1a"
const MPQ_SHUNT = 0x1b51504d; // "MPQ\x1b", user data header

function findHeader(data: Uint8Array): number {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let off = 0; off + 32 <= data.length; off += 512) {
    const magic = v.getUint32(off, true);
    if (magic === MPQ_MAGIC) return off;
    if (magic === MPQ_SHUNT) {
      const at = off + v.getUint32(off + 8, true);
      if (at + 32 <= data.length && v.getUint32(at, true) === MPQ_MAGIC) return at;
    }
  }
  return -1;
}
