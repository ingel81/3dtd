import { CompressedArrayTexture, CompressedTexture, DataArrayTexture, RGBA_BPTC_Format, SRGBColorSpace } from 'three';
import { MaterialArrays, compressedTogether } from './terrain-textures';
import type { MaterialCompressed, MaterialPixels } from '../map-asset-library';

const material = (id: string, v: number): MaterialPixels =>
  ({ id, size: 2, color: new Uint8Array(16).fill(v), data: new Uint8Array(16).fill(v + 1) }) as unknown as MaterialPixels;

/** A layer of 8 x 8 px in BC7 (16 bytes a 4 x 4 block) with two mip levels, every byte `v` */
function layer(v: number, format = RGBA_BPTC_Format): CompressedTexture {
  const mips = [
    { data: new Uint8Array(64).fill(v), width: 8, height: 8 },
    { data: new Uint8Array(16).fill(v), width: 4, height: 4 },
  ];
  const t = new CompressedTexture(mips as unknown as ImageData[], 8, 8, format as typeof RGBA_BPTC_Format);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const packed = (id: string, v: number, format?: number): MaterialCompressed =>
  ({ id, size: 8, color: layer(v, format as typeof RGBA_BPTC_Format), data: layer(v + 1, format as typeof RGBA_BPTC_Format), average: [0, 0, 0] }) as MaterialCompressed;

describe('MaterialArrays', () => {
  it('stacks the materials and lets their CPU copy go once the GPU has it (review 2026-10-11)', () => {
    const arrays = new MaterialArrays([material('a', 10), material('b', 20)]);
    expect(arrays.count).toBe(2);
    const color = arrays.color as DataArrayTexture;
    expect(color.image.data!.length).toBe(32);
    expect([color.image.data![0], color.image.data![16]]).toEqual([10, 20]);

    // What three calls after the upload
    for (const t of [arrays.color, arrays.data]) t.onUpdate?.(t);
    expect(color.image.data).toBeNull();
    expect((arrays.data as DataArrayTexture).image.data).toBeNull();
    expect(arrays.color.onUpdate).toBeNull();
  });

  it('stacks GPU-compressed layers level by level, and only layers of one format', () => {
    expect(compressedTogether([packed('a', 1), packed('b', 2)])).toBe(true);
    expect(compressedTogether([packed('a', 1), material('b', 2)])).toBe(false);
    expect(compressedTogether([packed('a', 1), packed('b', 2, 0x8e8d)])).toBe(false);

    const arrays = new MaterialArrays([packed('a', 1), packed('b', 2)]);
    const color = arrays.color as CompressedArrayTexture;
    expect(color).toBeInstanceOf(CompressedArrayTexture);
    expect(color.image.depth).toBe(2);
    expect(color.format).toBe(RGBA_BPTC_Format);
    expect(color.colorSpace).toBe(SRGBColorSpace);
    const [level0, level1] = color.mipmaps as unknown as { data: Uint8Array }[];
    expect([level0.data.length, level0.data[0], level0.data[64]]).toEqual([128, 1, 2]);
    expect([level1.data.length, level1.data[16]]).toEqual([32, 2]);
    // The array's copy goes once it is on the GPU
    color.onUpdate?.(color);
    expect(color.mipmaps).toEqual([]);
  });
});
