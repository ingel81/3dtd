import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../map-document';
import { wallShear, type ObjectFooting } from './object-seat';

const fence: ObjectFooting = { category: 'wall', footprint: 2, height: 1.2, box: [0, 0, 2, 0.1] };
const at = (x: number, y: number, rotation = 0): MapObject => ({ id: 'f', asset: 'fence', x, y, z: 0, rotation, scale: 1 });

describe('wallShear', () => {
  it('runs a fence along the slope with its foot on the ground at both ends', () => {
    // The ground rises 0.3 m per metre along map x; at rotation 0 the fence's length (model x) lies along map -x
    const ground = (x: number): number => 10 + 0.3 * x;
    const lean = wallShear(fence, at(5, 0), ground)!;
    expect(lean.shear).toBeCloseTo(-0.3, 6);
    // Model x of +-2 is map x 5 -+ 2: the foot meets the ground there, a few centimetres sunk
    for (const m of [-2, 2]) expect(lean.height + lean.shear * m).toBeCloseTo(ground(5 - m) - 0.04, 6);
    // Turned a quarter, the same fence runs across the slope: level
    expect(wallShear(fence, at(5, 0, Math.PI / 2), ground)).toBeNull();
  });

  it('leaves level ground, walls turned by hand and other kinds alone, and sinks over a dip', () => {
    expect(wallShear(fence, at(0, 0), () => 3)).toBeNull();
    expect(wallShear(fence, { ...at(0, 0), pitch: 0.1 }, (x) => x)).toBeNull();
    expect(wallShear({ ...fence, category: 'building' }, at(0, 0), (x) => x)).toBeNull();
    // Both ends at 0 and 1, the middle a metre lower: the foot goes down with it
    const lean = wallShear(fence, at(0, 0), (x) => (Math.abs(x) < 0.5 ? -0.5 : x > 0 ? 0 : 1))!;
    expect(lean.height).toBeCloseTo(0.5 - 1 - 0.04, 6);
  });
});
