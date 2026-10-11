import { existsSync, readFileSync } from 'fs';
import { base64Bytes, buildMpq, implode, findTestMap } from '../../../test/w3x-fixtures';
import { MpqArchive, decompress } from './mpq';

const TEST_MAP = findTestMap(existsSync);

function bytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    // Compressible: mostly a small alphabet with some noise
    out[i] = i % 13 === 0 ? s >>> 24 : 'war3map'.charCodeAt(i % 7);
  }
  return out;
}

const BZ2_HELLO = 'QlpoOTFBWSZTWZ5iW/4AAAKRAEAAAkSgACEUYGaCke8jRwu5IpwoSE8xLf8A';

describe('MpqArchive', () => {
  it('reads zlib files over several sectors, with and without encryption', () => {
    const a = bytes(10000, 1);
    const b = bytes(5000, 2);
    const c = bytes(9000, 3);
    const mpq = new MpqArchive(
      buildMpq(
        [
          { name: 'war3map.w3e', data: a },
          { name: 'war3map.j', data: b, encrypt: true },
          { name: 'scripts\\war3map.j', data: c, encrypt: true, fixKey: true },
        ],
        { sectorShift: 1 },
      ),
    );
    expect(mpq.header.archiveOffset).toBe(512);
    expect(mpq.header.sectorSize).toBe(1024);
    expect(mpq.read('war3map.w3e')).toEqual(a);
    expect(mpq.read('WAR3MAP.J')).toEqual(b);
    expect(mpq.read('scripts/war3map.j')).toEqual(c);
    expect(mpq.read('war3map.doo')).toBeNull();
    expect(mpq.list()).toEqual(['(listfile)', 'scripts\\war3map.j', 'war3map.j', 'war3map.w3e']);
  });

  it('reads single-unit, stored and stored-encrypted files', () => {
    const a = bytes(3000, 4);
    const b = bytes(700, 5);
    const c = bytes(2500, 6);
    const mpq = new MpqArchive(
      buildMpq(
        [
          { name: 'war3map.w3i', data: a, singleUnit: true, encrypt: true },
          { name: 'war3map.wts', data: b, compress: 'none' },
          { name: 'war3map.w3r', data: c, compress: 'none', encrypt: true, fixKey: true },
        ],
        { sectorShift: 1 },
      ),
    );
    expect(mpq.read('war3map.w3i')).toEqual(a);
    expect(mpq.read('war3map.wts')).toEqual(b);
    expect(mpq.read('war3map.w3r')).toEqual(c);
  });

  it('reads bzip2 and implode sectors and a v1 header', () => {
    const hello = new TextEncoder().encode('hello hello hello');
    const imploded = bytes(4000, 7);
    const mpq = new MpqArchive(
      buildMpq(
        [
          { name: 'war3map.wts', data: hello, compress: () => new Uint8Array([0x10, ...base64Bytes(BZ2_HELLO)]) },
          { name: 'war3map.doo', data: imploded, compress: (s) => new Uint8Array([0x08, ...implode(s, 6)]) },
        ],
        { formatVersion: 1 },
      ),
    );
    expect(mpq.header.formatVersion).toBe(1);
    // bzip2 of such a short text is longer than the text: Storm would store it raw, the fixture keeps it raw too
    expect(new TextDecoder().decode(mpq.read('war3map.wts')!)).toBe('hello hello hello');
    expect(mpq.read('war3map.doo')).toEqual(imploded);
  });

  it('decompresses a bzip2 sector', () => {
    const packed = new Uint8Array([0x10, ...base64Bytes(BZ2_HELLO)]);
    expect(new TextDecoder().decode(decompress(packed, 17))).toBe('hello hello hello');
  });

  it('finds files without a listfile by their known names', () => {
    const w3e = bytes(500, 8);
    const mpq = new MpqArchive(buildMpq([{ name: 'war3map.w3e', data: w3e }], { listfile: false }));
    expect(mpq.list()).toEqual(['war3map.w3e']);
  });

  it('clamps junk table sizes of protected maps', () => {
    const data = buildMpq([{ name: 'war3map.w3e', data: bytes(500, 9) }]);
    // Block table entry count far past the end of the file
    new DataView(data.buffer).setUint32(512 + 28, 0x00ffffff, true);
    const mpq = new MpqArchive(data);
    expect(mpq.notes.join()).toMatch(/block table clamped/);
    expect(mpq.read('war3map.w3e')).toEqual(bytes(500, 9));
  });

  it('names unsupported compressions and non-archives', () => {
    expect(() => decompress(new Uint8Array([0x01, 1, 2, 3]), 10, 'x.wav')).toThrow(/audio compression/);
    expect(() => decompress(new Uint8Array([0x12, 1, 2, 3]), 10)).toThrow(/LZMA/);
    expect(() => new MpqArchive(new Uint8Array(2048))).toThrow(/no MPQ header/);
  });

  it.skipIf(!TEST_MAP)('reads the test map', () => {
    const mpq = new MpqArchive(new Uint8Array(readFileSync(TEST_MAP!)));
    const files = mpq.list();
    for (const f of ['war3map.w3e', 'war3map.w3i', 'war3map.doo', 'war3map.j', 'war3map.w3r', 'war3map.wpm']) {
      expect(files).toContain(f);
    }
    expect(mpq.read('war3map.w3e')!.length).toBe(116568);
    expect(new TextDecoder().decode(mpq.read('war3map.j')!.subarray(0, 7))).toBe('globals');
  });
});
