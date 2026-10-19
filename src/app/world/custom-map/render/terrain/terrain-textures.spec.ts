import { CompressedArrayTexture, CompressedTexture, DataArrayTexture, DataUtils, RGBA_BPTC_Format, SRGBColorSpace, type WebGLRenderer } from 'three';
import { GridNormalTexture, MaterialArrays, SplatTextures, compressedTogether } from './terrain-textures';
import { HeightField } from '../height-field';
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

describe('SplatTextures', () => {
  /** What the array would receive: per copy its layer and rectangle, from which map's pixels */
  function recorder() {
    const copies: { layer: number; x: number; y: number; w: number; h: number; data: unknown }[] = [];
    const renderer = {
      copyTextureToTexture: (src: { image: { data: unknown } }, _dst: unknown, region: { min: { x: number; y: number }; max: { x: number; y: number } }, at: { x: number; y: number; z: number }) =>
        copies.push({ layer: at.z, x: at.x, y: at.y, w: region.max.x - region.min.x, h: region.max.y - region.min.y, data: src.image.data }),
    } as unknown as WebGLRenderer;
    return { copies, renderer };
  }

  it('holds the maps as one array without a copy of their pixels, each layer up whole first', () => {
    const splat = { resolution: 8, maps: [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)] };
    const textures = new SplatTextures(splat);
    expect(textures.array.image).toMatchObject({ width: 8, height: 8, depth: 3, data: null });
    expect(textures.array.source.dataReady).toBe(false);
    // A stroke before the first draw: the layers still go up whole (three allocates on the first upload)
    textures.refresh(splat, { i0: 2, j0: 2, i1: 3, j1: 3 });
    const { copies, renderer } = recorder();
    textures.flush(renderer);
    expect(copies).toEqual(splat.maps.map((data, layer) => ({ layer, x: 0, y: 0, w: 8, h: 8, data })));
    textures.flush(renderer);
    expect(copies.length).toBe(3);
  });

  it('uploads only what strokes painted, united per layer, and a replaced map whole', () => {
    const splat = { resolution: 8, maps: [new Uint8Array(256), new Uint8Array(256)] };
    const textures = new SplatTextures(splat);
    const { copies, renderer } = recorder();
    textures.flush(renderer);
    copies.length = 0;
    textures.refresh(splat, { i0: 2, j0: 3, i1: 3, j1: 4 });
    textures.refresh(splat, { i0: 5, j0: 1, i1: 9, j1: 2 });
    textures.flush(renderer);
    expect(copies.slice(0, 2)).toEqual([
      { layer: 0, x: 2, y: 1, w: 6, h: 4, data: splat.maps[0] },
      { layer: 1, x: 2, y: 1, w: 6, h: 4, data: splat.maps[1] },
    ]);
    copies.length = 0;
    const replaced = { resolution: 8, maps: [splat.maps[0], new Uint8Array(256)] };
    expect(textures.refresh(replaced, { i0: 0, j0: 0, i1: 1, j1: 1 })).toBe(false);
    textures.flush(renderer);
    expect(copies[1]).toEqual({ layer: 1, x: 0, y: 0, w: 8, h: 8, data: replaced.maps[1] });
    // A third map: a new array of three layers
    const array = textures.array;
    expect(textures.refresh({ resolution: 8, maps: [...replaced.maps, new Uint8Array(256)] })).toBe(true);
    expect(textures.array).not.toBe(array);
    expect(textures.array.image.depth).toBe(3);
  });
});

describe('GridNormalTexture', () => {
  it('holds the normalised normal of each sample, clamped at the border, and how near the water it lies', () => {
    const columns = 7;
    const rows = 5;
    const heights = Float32Array.from({ length: columns * rows }, (_, k) => Math.sin(k * 1.7) * 6 + (k % columns) * 0.5);
    const field = new HeightField({ columns, rows, cellSize: 2, heights }, 12, 8);
    const texture = new GridNormalTexture(field);
    const mask = new Uint8Array(columns * rows);
    mask[3 * columns + 5] = 1;
    texture.setWater(mask);
    const pixels = texture.texture.image.data as Uint16Array;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < columns; i++) {
        const dx = (field.sample(i + 1, j) - field.sample(i - 1, j)) / 4;
        const dy = (field.sample(i, j + 1) - field.sample(i, j - 1)) / 4;
        const len = Math.hypot(dx, 1, dy);
        const q = (j * columns + i) * 4;
        expect(DataUtils.fromHalfFloat(pixels[q])).toBeCloseTo(dx / len, 2);
        expect(DataUtils.fromHalfFloat(pixels[q + 1])).toBeCloseTo(1 / len, 2);
        expect(DataUtils.fromHalfFloat(pixels[q + 2])).toBeCloseTo(-dy / len, 2);
        // 1 within two samples of the water (octile distance), fading to 0 at six: the shore strip
        const a = Math.abs(i - 5);
        const b = Math.abs(j - 3);
        const d = Math.max(a, b) + (Math.SQRT2 - 1) * Math.min(a, b);
        const wet = d <= 2 ? 1 : Math.max(0, 1 - (d - 2) / 4);
        expect(DataUtils.fromHalfFloat(pixels[q + 3])).toBeCloseTo(wet, 2);
      }
    }
  });
});
