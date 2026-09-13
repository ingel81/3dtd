import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { decodePng } from './model-inspect';

/** A PNG from its IHDR fields and filtered rows (filter byte first); decodePng skips the CRCs. */
function png(width: number, height: number, depth: number, colorType: number, rows: number[][], extra: [string, number[]][] = []): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extra.map(([type, data]) => chunk(type, Buffer.from(data))),
    chunk('IDAT', deflateSync(Buffer.from(rows.flat()))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('decodePng', () => {
  it('undoes the row filters of an RGBA image', () => {
    // Row 0 Sub, row 1 Up, row 2 Average, row 3 Paeth: every row decodes to the same two pixels
    const pixels = [10, 20, 30, 255, 40, 50, 60, 0];
    const rows = [
      [1, 10, 20, 30, 255, 30, 30, 30, 1],
      [2, 0, 0, 0, 0, 0, 0, 0, 0],
      [3, 5, 10, 15, 128, 15, 15, 15, 129],
      [4, 0, 0, 0, 0, 0, 0, 0, 0],
    ];
    const image = decodePng(png(2, 4, 8, 6, rows));
    expect(image && [image.width, image.height]).toEqual([2, 4]);
    for (let y = 0; y < 4; y++) {
      expect([...image!.data.subarray(y * 8, y * 8 + 8)], `row ${y}`).toEqual(pixels);
    }
  });

  it('gives palette entries their tRNS alpha', () => {
    const image = decodePng(png(3, 1, 2, 3, [[0, 0b00011000]], [
      ['PLTE', [255, 0, 0, 0, 255, 0, 0, 0, 255]],
      ['tRNS', [0, 128]],
    ]));
    expect([...image!.data]).toEqual([255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 255]);
  });

  it('cuts 16-bit grey to its high byte and keys out the tRNS grey', () => {
    const image = decodePng(png(2, 1, 16, 0, [[0, 0x12, 0x34, 0xab, 0xcd]], [['tRNS', [0x12, 0x34]]]));
    expect([...image!.data]).toEqual([0x12, 0x12, 0x12, 0, 0xab, 0xab, 0xab, 255]);
  });

  it('is null for anything but a non-interlaced PNG', () => {
    expect(decodePng(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    const interlaced = png(1, 1, 8, 6, [[0, 1, 2, 3, 4]]);
    interlaced[8 + 8 + 12] = 1; // IHDR interlace method
    expect(decodePng(interlaced)).toBeNull();
  });
});
