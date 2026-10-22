import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../map-document';
import { seatHeight, wallShear, type ObjectFooting } from './object-seat';

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

  it('runs a stretched length of row down a slope with both end posts on the ground', () => {
    // A vine row of 10 m stretched to 12.5 m, down ground that falls 0.4 m per metre along map x
    const vine: ObjectFooting = { category: 'plant', footprint: 3.1, height: 2.1, row: 10 };
    const ground = (x: number): number => 50 - 0.4 * x;
    const o = { ...at(20, 0), asset: 'vine-row', stretch: 1.25 };
    const lean = wallShear(vine, o, ground)!;
    // The matrix shears model x, which the stretch makes 1.25 m of map a model metre: the slope times the stretch
    expect(lean.shear).toBeCloseTo(0.4 * 1.25, 6);
    // Model x of -+5 (the end posts) is map x 20 -+ 6.25 after the stretch: on the ground there, a few centimetres sunk
    for (const m of [-5, 5]) expect(lean.height + lean.shear * m).toBeCloseTo(ground(20 - m * 1.25) - 0.04, 6);
    // Across the slope it stands level, as a plant does without a row
    expect(wallShear(vine, { ...o, rotation: Math.PI / 2 }, ground)).toBeNull();
    expect(wallShear({ ...vine, row: undefined }, o, ground)).toBeNull();
  });
});

describe('seatHeight', () => {
  // A bank falling 1 m per metre towards map +x: the ground under the middle is at 0
  const bank = (x: number): number => -x;
  const water = () => null;

  it('stands a tree at the lowest ground round its trunk, so its foot reaches down the bank', () => {
    const tree: ObjectFooting = { category: 'tree', footprint: 1.2, height: 13 };
    // Trunk radius 0.4 x 1.2 x 2 = 0.96 m at scale 2: the downhill side's ground, then 0.15 m per unit of scale under it
    expect(seatHeight(tree, { ...at(0, 0), scale: 2 }, bank, water)).toBeCloseTo(-0.96 - 0.3, 6);
    // On level ground as before
    expect(seatHeight(tree, at(0, 0), () => 4, water)).toBeCloseTo(4 - 0.15, 6);
  });

  it('stands a plant at the lowest ground under its patch, a length of row under its middle', () => {
    const reeds: ObjectFooting = { category: 'plant', footprint: 1.4, height: 2.1 };
    expect(seatHeight(reeds, at(0, 0), bank, water)).toBeCloseTo(-0.7 * 1.4, 6);
    expect(seatHeight({ ...reeds, row: 10 }, at(0, 0), bank, water)).toBeCloseTo(0, 6);
    expect(seatHeight({ ...reeds, category: 'prop', footprint: 0 }, at(0, 0), bank, water)).toBeCloseTo(0, 6);
  });
});
