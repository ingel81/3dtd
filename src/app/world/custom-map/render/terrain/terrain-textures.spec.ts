import { MaterialArrays } from './terrain-textures';
import type { MaterialPixels } from '../map-asset-library';

const material = (id: string, v: number): MaterialPixels =>
  ({ id, size: 2, color: new Uint8Array(16).fill(v), data: new Uint8Array(16).fill(v + 1) }) as unknown as MaterialPixels;

describe('MaterialArrays', () => {
  it('stacks the materials and lets their CPU copy go once the GPU has it (review 2026-10-11)', () => {
    const arrays = new MaterialArrays([material('a', 10), material('b', 20)]);
    expect(arrays.count).toBe(2);
    const color = arrays.color.image.data as Uint8Array;
    expect(color.length).toBe(32);
    expect([color[0], color[16]]).toEqual([10, 20]);

    // What three calls after the upload
    for (const t of [arrays.color, arrays.data]) t.onUpdate?.(t);
    expect(arrays.color.image.data).toBeNull();
    expect(arrays.data.image.data).toBeNull();
    expect(arrays.color.onUpdate).toBeNull();
  });
});
