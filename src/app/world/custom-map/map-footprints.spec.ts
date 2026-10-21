import { describe, expect, it } from 'vitest';
import { FOOTPRINTS_FORMAT, footprintCount, footprintsWellFormed, packFootprints, readFootprints } from './map-footprints';

const square = (x: number, y: number, side: number) => [
  { x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side },
];

/** The footprints an OSM world keeps for the developer layer (TODO E290) */
describe('map footprints', () => {
  it('reads back what it packed, to the decimetre, with the storeys, in its format', () => {
    const packed = packFootprints([
      { points: [{ x: 10.04, y: -20.06 }, { x: 18.5, y: -20 }, { x: 18.5, y: -12.26 }], levels: 3, kind: 'ground' },
      { points: square(-1200, 1190, 8), levels: null, kind: 'ground' },
    ]);
    expect(packed.format).toBe(FOOTPRINTS_FORMAT);
    expect(footprintsWellFormed(packed.rings)).toBe(true);
    expect(footprintCount(packed)).toBe(2);
    const [a, b] = readFootprints(packed);
    expect(a).toEqual({ points: [{ x: 10, y: -20.1 }, { x: 18.5, y: -20 }, { x: 18.5, y: -12.3 }], holes: [], levels: 3, minLevel: 0, kind: 'ground', dropped: null });
    expect(b.levels).toBe(0);
    expect(b.points).toEqual(square(-1200, 1190, 8));
  });

  it('keeps each ring its kind, why the import left it out, its lowest storey and its courtyards', () => {
    const court = square(4, 4, 4);
    const packed = packFootprints([
      { points: square(0, 0, 12), holes: [court, square(1, 1, 1).slice(0, 2)], levels: 4, kind: 'ground', dropped: 'roads' },
      { points: square(20, 0, 5), levels: 9, minLevel: 6, kind: 'part' },
      { points: square(30, 0, 5), levels: null, kind: 'underground' },
      { points: square(40, 0, 5), levels: 1, kind: 'offGround', dropped: null },
      { points: square(50, 0, 5), levels: 2, kind: 'ground', dropped: 'budget' },
    ]);
    const read = readFootprints(packed);
    // The courtyard counts with its ring, the one of two points is left out
    expect(footprintCount(packed)).toBe(5);
    expect(read.map((f) => [f.kind, f.dropped, f.minLevel, f.holes.length])).toEqual([
      ['ground', 'roads', 0, 1],
      ['part', null, 6, 0],
      ['underground', null, 0, 0],
      ['offGround', null, 0, 0],
      ['ground', 'budget', 0, 0],
    ]);
    expect(read[0].holes[0]).toEqual(court);
    // Per ring three words and its points
    expect(packed.rings.length).toBe(6 * 3 + 6 * 8);
  });

  it('drops a closing point, leaves out rings too small or past the Int16 range', () => {
    const closed = [...square(0, 0, 5), { x: 0, y: 0 }];
    const packed = packFootprints([
      { points: closed, levels: 1, kind: 'ground' },
      { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], levels: 1, kind: 'ground' },
      { points: square(3300, 0, 10), levels: 1, kind: 'ground' },
    ]);
    const read = readFootprints(packed);
    expect(read).toHaveLength(1);
    expect(read[0].points).toHaveLength(4);
    // n, levels, info and 4 points
    expect(packed.rings.length).toBe(3 + 8);
  });

  it('tells a cut array from a whole one, and one that starts with a courtyard or an unknown kind', () => {
    const { rings } = packFootprints([{ points: square(0, 0, 5), levels: 2, kind: 'ground' }]);
    expect(footprintsWellFormed(rings.subarray(0, rings.length - 1))).toBe(false);
    expect(footprintsWellFormed(new Int16Array([2, 0, 0, 0, 0, 1, 1]))).toBe(false);
    expect(footprintsWellFormed(new Int16Array(0))).toBe(true);
    const court = Int16Array.from(rings);
    court[2] = 4;
    expect(footprintsWellFormed(court)).toBe(false);
    const unknown = Int16Array.from(rings);
    unknown[2] = 5;
    expect(footprintsWellFormed(unknown)).toBe(false);
    // The first format: count, storeys, points (no word of info) does not read as this one
    expect(footprintsWellFormed(new Int16Array([4, 2, 0, 0, 50, 0, 50, 50, 0, 50]))).toBe(false);
  });
});
