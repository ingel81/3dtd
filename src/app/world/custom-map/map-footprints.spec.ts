import { describe, expect, it } from 'vitest';
import { footprintCount, footprintsNearRoutes, footprintsWellFormed, packFootprints, readFootprints } from './map-footprints';

const square = (x: number, y: number, side: number) => [
  { x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side },
];

/** The footprints an OSM world keeps for the developer layer (TODO E290) */
describe('map footprints', () => {
  it('reads back what it packed, to the decimetre, with the storeys', () => {
    const packed = packFootprints([
      { points: [{ x: 10.04, y: -20.06 }, { x: 18.5, y: -20 }, { x: 18.5, y: -12.26 }], levels: 3 },
      { points: square(-1200, 1190, 8), levels: null },
    ]);
    expect(footprintsWellFormed(packed.rings)).toBe(true);
    expect(footprintCount(packed)).toBe(2);
    const [a, b] = readFootprints(packed);
    expect(a.levels).toBe(3);
    expect(a.points).toEqual([{ x: 10, y: -20.1 }, { x: 18.5, y: -20 }, { x: 18.5, y: -12.3 }]);
    expect(b.levels).toBe(0);
    expect(b.points).toEqual(square(-1200, 1190, 8));
  });

  it('drops a closing point, leaves out rings too small or past the Int16 range', () => {
    const closed = [...square(0, 0, 5), { x: 0, y: 0 }];
    const packed = packFootprints([
      { points: closed, levels: 1 },
      { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], levels: 1 },
      { points: square(3300, 0, 10), levels: 1 },
    ]);
    const read = readFootprints(packed);
    expect(read).toHaveLength(1);
    expect(read[0].points).toHaveLength(4);
    // n, levels and 4 points
    expect(packed.rings.length).toBe(2 + 8);
  });

  it('tells a cut array from a whole one', () => {
    const { rings } = packFootprints([{ points: square(0, 0, 5), levels: 2 }]);
    expect(footprintsWellFormed(rings.subarray(0, rings.length - 1))).toBe(false);
    expect(footprintsWellFormed(new Int16Array([2, 0, 0, 0, 1, 1]))).toBe(false);
    expect(footprintsWellFormed(new Int16Array(0))).toBe(true);
  });

  describe('near the routes', () => {
    const route = [[{ x: 0, y: 0 }, { x: 200, y: 0 }]];

    it('keeps those whose outline comes within the radius, also by an edge between far corners', () => {
      const near = { points: square(50, 20, 10), levels: 2 };
      const far = { points: square(50, 40, 10), levels: 2 };
      // A long hall across the route's end: its corners 60 m off, its wall 10 m
      const hall = { points: [{ x: 210, y: -60 }, { x: 230, y: -60 }, { x: 230, y: 60 }, { x: 210, y: 60 }], levels: 1 };
      // Astride the route
      const astride = { points: square(100, -5, 10), levels: 1 };
      const out = footprintsNearRoutes([near, far, hall, astride], route, 25);
      expect(out).toEqual([near, hall, astride]);
    });

    it('keeps none without routes', () => {
      expect(footprintsNearRoutes([{ points: square(0, 0, 5), levels: 1 }], [], 25)).toEqual([]);
      expect(footprintsNearRoutes([{ points: square(0, 0, 5), levels: 1 }], [[{ x: 0, y: 0 }]], 25)).toEqual([]);
    });

    it('finds each footprint once over routes that share their cells', () => {
      const fp = { points: square(10, 10, 5), levels: 1 };
      const out = footprintsNearRoutes([fp], [[{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: 1 }, { x: 100, y: 1 }]], 25);
      expect(out).toEqual([fp]);
    });
  });
});
