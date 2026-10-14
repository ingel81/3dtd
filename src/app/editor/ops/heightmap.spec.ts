import { zlibSync } from 'fflate';
import { createMapDocument } from '../../world/custom-map/map-create';
import {
  HeightmapError,
  decodePng,
  decodeRaw16,
  encodePng16,
  encodeRaw16,
  gridToImage,
  heightmapName,
  imageToHeights,
  rangeFromName,
  squareImage,
} from './heightmap';

/** A PNG of 8-bit RGB rows, each row with the filter given (the decoder does not check CRCs) */
function rgbPng(width: number, pixels: number[][], filters: number[]): Uint8Array {
  const height = pixels.length;
  const stride = width * 3;
  const raw: number[] = [];
  let prev = new Array(stride).fill(0);
  pixels.forEach((row, r) => {
    const line = row.flatMap((v) => [v, 0, 255]);
    const f = filters[r];
    raw.push(f);
    for (let k = 0; k < stride; k++) {
      const a = k >= 3 ? line[k - 3] : 0;
      const b = prev[k];
      const c = k >= 3 ? prev[k - 3] : 0;
      const pa = Math.abs(b - c);
      const pb = Math.abs(a - c);
      const pc = Math.abs(a + b - 2 * c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      raw.push((line[k] - pred + 256) & 255);
    }
    prev = line;
  });
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    for (let k = 0; k < 4; k++) out[4 + k] = type.charCodeAt(k);
    out.set(data, 8);
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(new Uint8Array(raw))), chunk('IEND', new Uint8Array(0))];
  return new Uint8Array(parts.flatMap((p) => [...p]));
}

describe('heightmaps', () => {
  it('writes a map as a 16-bit PNG and RAW and reads it back to the same heights', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 64, depth: 32, cellSize: 4 });
    const g = doc.terrain.grid;
    for (let k = 0; k < g.heights.length; k++) g.heights[k] = -5 + (k % 17) * 1.5 + Math.floor(k / g.columns);
    const { image, low, high } = gridToImage(g);
    expect(image.width).toBe(g.columns);
    const back = decodePng(encodePng16(image));
    expect([back.width, back.height]).toEqual([g.columns, g.rows]);
    const heights = imageToHeights(back, g.columns, g.rows, low, high);
    for (let k = 0; k < heights.length; k++) expect(heights[k]).toBeCloseTo(g.heights[k], 2);
    // The top row is the north edge
    expect(back.values[0]).toBeCloseTo((g.heights[(g.rows - 1) * g.columns] - low) / (high - low), 4);
    const square = gridToImage(createMapDocument({ id: 's', name: 'S', width: 32, depth: 32, cellSize: 4 }).terrain.grid).image;
    expect(decodeRaw16(encodeRaw16(square)).width).toBe(9);
    expect(() => decodeRaw16(new Uint8Array(10))).toThrow(HeightmapError);
  });

  it('writes a wide map as a square RAW, which reads back onto its grid', () => {
    // A Wide map: twice as many columns as rows. RAW takes its side from the byte count, so it has to be square
    const doc = createMapDocument({ id: 'w', name: 'W', width: 64, depth: 32, cellSize: 4 });
    const g = doc.terrain.grid;
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = i * 0.5 + j * 2;
    const { image, low, high } = gridToImage(g);
    const square = squareImage(image);
    expect([square.width, square.height]).toEqual([g.columns, g.columns]);
    const back = decodeRaw16(encodeRaw16(square));
    const heights = imageToHeights(back, g.columns, g.rows, low, high);
    // A plane comes back as the same plane (bilinear twice is exact on it, up to 16-bit steps)
    for (let k = 0; k < heights.length; k++) expect(heights[k]).toBeCloseTo(g.heights[k], 1);
    expect(squareImage(back)).toBe(back);
  });

  it('reads 8-bit colour PNGs with every row filter, first channel only', () => {
    const pixels = [
      [0, 10, 20, 30],
      [40, 50, 60, 70],
      [80, 90, 100, 110],
      [120, 130, 140, 150],
      [160, 170, 180, 190],
    ];
    const img = decodePng(rgbPng(4, pixels, [0, 1, 2, 3, 4]));
    expect(Array.from(img.values, (v) => Math.round(v * 255))).toEqual(pixels.flat());
  });

  it('scales an image to a grid of another size and keeps the range in the file name', () => {
    const img = { width: 2, height: 2, values: new Float32Array([1, 1, 0, 0]) };
    // Top row high: the north edge high
    const h = imageToHeights(img, 3, 3, 0, 10);
    expect(Array.from(h)).toEqual([0, 0, 0, 5, 5, 5, 10, 10, 10]);
    const name = heightmapName('valley', -3.456, 42, 'png');
    expect(name).toBe('valley-heights--3.46m-42m.png');
    expect(rangeFromName(name)).toEqual({ low: -3.46, high: 42 });
    expect(rangeFromName('plain.png')).toBeNull();
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow(HeightmapError);
  });
});
