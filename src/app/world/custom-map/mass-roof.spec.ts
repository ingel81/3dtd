import { gableIsTriangle, ROOF_EAVES, roofModel, roofRiseAt, roofRun, roofTriangleGuess, roofTriangles, type RoofBody } from './mass-roof';

const rect = (w: number, d: number): number[] => [-w / 2, -d / 2, w / 2, -d / 2, w / 2, d / 2, -w / 2, d / 2];
/** Every corner of the drawn polygons as (x, rise, z) */
const corners = (body: RoofBody) =>
  roofModel(body)!.polygons.flatMap((p) => p.rings.flatMap((r) => r.flatMap((_, i) => (i % 2 ? [] : [[r[i], p.px * r[i] + p.pz * r[i + 1] + p.p0, r[i + 1]]]))));

describe('roof models over any outline (E297 L4)', () => {
  it('runs a gable along a rectangle: two slopes, two gables, eaves and verges past the walls', () => {
    const body: RoofBody = { rings: [rect(20, 10)], roof: 'gable', ridge: 4 };
    const m = roofModel(body)!;
    expect(m.polygons.length).toBe(2);
    expect(m.gables.length).toBe(2);
    expect(m.gables.every(gableIsTriangle)).toBe(true);
    expect(m.top).toBeCloseTo(4);
    // The ridge along x, the eaves 0.4 m past the long walls and that much lower; the verges past the ends
    expect(roofRiseAt(m, 3, 0)).toBeCloseTo(4);
    expect(roofRiseAt(m, 3, 2.5)).toBeCloseTo(2);
    const pts = corners(body);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(10 + ROOF_EAVES);
    expect(Math.max(...pts.map((p) => p[2]))).toBeCloseTo(5 + ROOF_EAVES);
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo((-4 / 5) * ROOF_EAVES);
    expect(roofTriangleGuess(body)).toBe(roofTriangles(m));
    expect(roofRun(body)).toBeCloseTo(5);
  });

  it('stands a gable on a skewed end, its top where the ridge meets the wall', () => {
    // A wing 10 m wide whose east end runs askew
    const body: RoofBody = { rings: [[0, 0, 24, 0, 20, 10, 0, 10]], roof: 'gable', ridge: 4 };
    const m = roofModel(body)!;
    expect(m.gables.length).toBe(2);
    const skew = m.gables.find((g) => Math.abs(g.ax - g.bx) > 1)!;
    // The ridge at z = 5 meets the skewed end at x = 22, full height
    expect(skew.top[3]).toBeCloseTo(4, 1);
    expect(roofRiseAt(m, 21.9, 5)).toBeCloseTo(4, 1);
  });

  it('ends at a party wall in a gable without eaves, the slopes spanning the other way', () => {
    // A town house 8 m wide, 14 m deep, its neighbours against both long sides (walls 1 and 3)
    const body: RoofBody = { rings: [rect(8, 14)], roof: 'gable', ridge: 5, shared: [1, 3] };
    const m = roofModel(body)!;
    // The ridge across the house (along x, over z = 0), sloped front and back
    expect(roofRiseAt(m, 0, 0)).toBeCloseTo(5);
    expect(roofRiseAt(m, 3.9, 0)).toBeCloseTo(5);
    expect(roofRiseAt(m, 0, 3.5)).toBeCloseTo(2.5);
    // No verge past a party wall: nothing drawn beyond x = 4
    expect(Math.max(...corners(body).map((p) => p[0]))).toBeCloseTo(4);
    expect(m.gables.length).toBe(2);
  });

  it('keeps a small hip over a half-hip\'s gable', () => {
    const body: RoofBody = { rings: [rect(20, 10)], roof: 'halfhip', ridge: 4 };
    const m = roofModel(body)!;
    expect(m.polygons.length).toBe(4);
    for (const g of m.gables) {
      expect(gableIsTriangle(g)).toBe(false);
      // Up to the cut, then the hip
      expect(Math.max(...g.top.filter((_, i) => i % 2 === 1))).toBeLessThan(3);
    }
    expect(roofRiseAt(m, 9.9, 0)).toBeLessThan(3);
    expect(roofRiseAt(m, 0, 0)).toBeCloseTo(4);
  });

  it('cuts a mansard flat at its run, round a courtyard too', () => {
    const body: RoofBody = { rings: [rect(40, 40), rect(20, 20)], roof: 'mansard', ridge: 3 };
    const m = roofModel(body)!;
    expect(m.polygons.some((p) => p.flat)).toBe(true);
    expect(m.top).toBe(3);
    expect(roofRiseAt(m, 15, 0)).toBeCloseTo(3);
    expect(roofRiseAt(m, 0, 0)).toBeNull();
  });

  it('slopes a lean-to one way, its walls up to it; round a courtyard down to the courtyard', () => {
    const lean: RoofBody = { rings: [rect(12, 6)], roof: 'skillion', ridge: 2, roofDirection: Math.PI / 2 };
    const m = roofModel(lean)!;
    expect(m.walls).toBeDefined();
    expect(roofRiseAt(m, 0, -2.9)).toBeCloseTo(2 * (5.9 / 6), 2);
    // No eave on the high side, eaves on the low side and the verges
    const pts = corners(lean);
    expect(Math.min(...pts.map((p) => p[2]))).toBeCloseTo(-3);
    expect(Math.max(...pts.map((p) => p[2]))).toBeCloseTo(3 + ROOF_EAVES);
    const cloister: RoofBody = { rings: [rect(30, 30), rect(18, 18)], roof: 'skillion', ridge: 2 };
    const c = roofModel(cloister)!;
    // High at the outer walls, low at the courtyard, the outer walls' gables up to the slope
    expect(roofRiseAt(c, 14.9, 0)).toBeCloseTo(2, 1);
    expect(roofRiseAt(c, 9.1, 0)).toBeLessThan(0.2);
    expect(c.gables.length).toBe(4);
    expect(roofRun(cloister)).toBeCloseTo(6, 1);
  });

  it('turns a rectangle\'s ridge across it: gables on its long sides', () => {
    const body: RoofBody = { rings: [rect(20, 8)], roof: 'gable', ridge: 6, roofAcross: true };
    const m = roofModel(body)!;
    expect(roofRiseAt(m, 0, 3)).toBeCloseTo(6);
    expect(roofRiseAt(m, 5, 0)).toBeCloseTo(3);
    expect(m.gables.every((g) => Math.abs(g.az - g.bz) < 1e-9)).toBe(true);
    expect(roofRun(body)).toBeCloseTo(10);
  });

  it('makes none for a flat roof, a pyramid or no rise', () => {
    expect(roofModel({ rings: [rect(10, 8)], roof: 'flat' })).toBeNull();
    expect(roofModel({ rings: [rect(10, 8)], roof: 'pyramid', ridge: 4 })).toBeNull();
    expect(roofModel({ rings: [rect(10, 8)], roof: 'gable' })).toBeNull();
    expect(roofTriangleGuess({ rings: [rect(10, 8)], roof: 'flat' })).toBe(0);
  });
});
