import type { MapPoint } from '../../custom-map/map-document';
import { angleBetween, fallLine, LEAST_RUN, longestSide, parcelsOf, RoadIndex, ROW_END_GAP, rowDirection, rowRuns, runPieces, runPlants, type Parcel } from './crop-rows';

const deg = (a: number) => (a * 180) / Math.PI;
const rect = (x0: number, y0: number, x1: number, y1: number): MapPoint[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const parcel = (outer: MapPoint[], inner: MapPoint[][] = []): Parcel => ({ outer, inner });
/** Ground falling `grade` per metre toward `downhill` (radians) */
const slope = (grade: number, downhill: number) => (x: number, y: number) => 100 - grade * (x * Math.cos(downhill) + y * Math.sin(downhill));
const flat = () => 50;
const free = () => true;

describe('crop rows: which way they run', () => {
  it('finds the fall line of the ground inside the parcel', () => {
    const f = fallLine(parcel(rect(0, 0, 80, 60)), slope(0.3, 0.4))!;
    expect(f.grade).toBeCloseTo(0.3, 6);
    expect(f.angle).toBeCloseTo(0.4, 6);
  });

  it('runs the rows down a slope without a road, across it never', () => {
    // A strip 120 m along the contour (x) and 40 m down the slope (y): its longest side lies across the fall line
    const d = rowDirection(parcel(rect(0, 0, 120, 40)), slope(0.25, -Math.PI / 2), null);
    expect(d.reason).toBe('slope');
    expect(angleBetween(d.angle, Math.PI / 2)).toBeLessThan(1e-6);
  });

  it('keeps the rows square to the road that serves the parcel where that is near the fall line', () => {
    // A road along the parcel's lower edge, 20 degrees off the contour: the rows square to it, 20 degrees off the fall line
    const tilt = (20 * Math.PI) / 180;
    const road = new RoadIndex([[{ x: -50, y: -4 - 50 * Math.tan(tilt) }, { x: 200, y: -4 + 200 * Math.tan(tilt) }]]);
    const p = parcel([
      { x: 0, y: 0 },
      { x: 120, y: 120 * Math.tan(tilt) },
      { x: 120, y: 60 },
      { x: 0, y: 60 },
    ]);
    const d = rowDirection(p, slope(0.3, -Math.PI / 2), road);
    expect(d.reason).toBe('road');
    expect(deg(angleBetween(d.angle, tilt + Math.PI / 2))).toBeLessThan(3);
    // The same road 60 degrees off the contour is no guide on the slope: the fall line rules
    const steep = (60 * Math.PI) / 180;
    const across = new RoadIndex([[{ x: 0, y: -6 }, { x: 0 + 300 * Math.cos(steep), y: -6 + 300 * Math.sin(steep) }]]);
    const p2 = parcel([
      { x: 6, y: 0 },
      { x: 6 + 100 * Math.cos(steep), y: 100 * Math.sin(steep) },
      { x: -30 + 100 * Math.cos(steep), y: 100 * Math.sin(steep) + 10 },
      { x: -30, y: 10 },
    ]);
    const d2 = rowDirection(p2, slope(0.3, -Math.PI / 2), across);
    expect(d2.reason).toBe('slope');
    expect(angleBetween(d2.angle, Math.PI / 2)).toBeLessThan(1e-6);
  });

  it('squares the rows to the nearest road on flat ground, else lays them along the longest side', () => {
    // A field 200 x 50 m; the road runs along its short west side
    const field = parcel(rect(0, 0, 200, 50));
    const road = new RoadIndex([[{ x: -5, y: -100 }, { x: -5, y: 150 }]]);
    const d = rowDirection(field, flat, road);
    expect(d.reason).toBe('road');
    expect(angleBetween(d.angle, 0)).toBeLessThan(1e-6);
    // With a road along its long south side the rows run north from it
    const south = new RoadIndex([[{ x: -50, y: -6 }, { x: 250, y: -6 }]]);
    expect(angleBetween(rowDirection(field, flat, south).angle, Math.PI / 2)).toBeLessThan(1e-6);
    // No road within reach: along the longest side, even where that side is drawn in many short pieces
    const far = new RoadIndex([[{ x: -500, y: -500 }, { x: -400, y: -500 }]]);
    const noisy = parcel([...Array.from({ length: 21 }, (_, k) => ({ x: k * 10, y: (k % 2) * 0.3 })), { x: 200, y: 50 }, { x: 0, y: 50 }]);
    const side = rowDirection(noisy, flat, far);
    expect(side.reason).toBe('side');
    expect(deg(angleBetween(side.angle, 0))).toBeLessThan(2);
    expect(deg(angleBetween(longestSide(rect(0, 0, 30, 90)), Math.PI / 2))).toBeLessThan(1e-6);
  });
});

describe('crop rows: runs', () => {
  it('lays straight rows across the whole parcel, ending a little inside its edge', () => {
    // 100 m along x, 24 m across: rows along x every 2.4 m, each one run from edge to edge
    const runs = rowRuns(parcel(rect(0, 0, 100, 24)), 0, 2.4, free);
    expect(runs.length).toBe(9);
    for (const r of runs) {
      expect(Math.min(r.a.x, r.b.x)).toBeCloseTo(ROW_END_GAP, 6);
      expect(Math.max(r.a.x, r.b.x)).toBeCloseTo(100 - ROW_END_GAP, 6);
      expect(r.a.y).toBeCloseTo(r.b.y, 9);
      expect(r.length).toBeCloseTo(100 - 2 * ROW_END_GAP, 6);
    }
    // Parallel, 2.4 m apart, on whole multiples of the spacing from the map's origin
    const ys = runs.map((r) => r.a.y).sort((p, q) => p - q);
    ys.forEach((y, k) => expect(y).toBeCloseTo(2.4 * (k + 1), 6));
  });

  it('ends each row at a slanted edge and breaks it at a path, a hole and what is not free', () => {
    // A trapezoid: the east edge slants, so the rows end at different lengths, each at the edge
    const p = parcel([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 80, y: 40 }, { x: 0, y: 40 }]);
    for (const r of rowRuns(p, 0, 2.4, free)) {
      const edge = 100 - r.a.y / 2;
      expect(Math.max(r.a.x, r.b.x)).toBeCloseTo(edge - ROW_END_GAP, 6);
    }
    // A path 3 m wide across at x 40..43 breaks every row in two, both halves ending at it
    const path = (x: number) => x < 40 || x > 43;
    const broken = rowRuns(parcel(rect(0, 0, 100, 24)), 0, 2.4, path);
    expect(broken.length).toBe(18);
    for (const r of broken) expect(Math.min(r.a.x, r.b.x) >= 43 || Math.max(r.a.x, r.b.x) <= 40).toBe(true);
    expect(Math.max(...broken.map((r) => Math.max(r.a.x, r.b.x)).filter((x) => x <= 40))).toBeGreaterThan(38.5);
    // A hole (a hut's yard) cuts the rows through it
    const holed = rowRuns(parcel(rect(0, 0, 100, 24), [rect(60, 5, 70, 15)]), 0, 2.4, free);
    for (const r of holed) {
      if (r.a.y > 5 && r.a.y < 15) expect(Math.min(r.a.x, r.b.x) >= 70 || Math.max(r.a.x, r.b.x) <= 60).toBe(true);
    }
    // Too short a piece of row is left out
    expect(rowRuns(parcel(rect(0, 0, LEAST_RUN + 2 * ROW_END_GAP - 0.5, 24)), 0, 2.4, free)).toEqual([]);
  });

  it('gives the same rows for the same parcel, whichever way its ring is drawn', () => {
    const ring = [{ x: 3, y: 7 }, { x: 140, y: 30 }, { x: 120, y: 95 }, { x: -10, y: 60 }];
    const a = rowRuns(parcel(ring), 1.1, 2.4, free);
    const b = rowRuns(parcel([...ring].reverse()), 1.1, 2.4, free);
    expect(a.length).toBeGreaterThan(20);
    expect(rowRuns(parcel(ring), 1.1, 2.4, free)).toEqual(a);
    // Drawn the other way round: the same runs to the last float bits of the crossings
    expect(b.length).toBe(a.length);
    a.forEach((r, k) => {
      for (const [p, q] of [[r.a, b[k].a], [r.b, b[k].b]]) {
        expect(q.x).toBeCloseTo(p.x, 9);
        expect(q.y).toBeCloseTo(p.y, 9);
      }
    });
  });

  it('assigns each hole to the outer ring it lies in', () => {
    const parcels = parcelsOf([rect(0, 0, 10, 10), rect(20, 0, 30, 10)], [rect(22, 2, 24, 4)]);
    expect(parcels.map((p) => p.inner.length)).toEqual([0, 1]);
  });
});

describe('crop rows: pieces', () => {
  it('fills a run end to end with equal pieces stretched to fit', () => {
    const run = { a: { x: 0, y: 0 }, b: { x: 0, y: 63 }, length: 63 };
    const pieces = runPieces(run, 10);
    expect(pieces.length).toBe(6);
    for (const p of pieces) expect(p.stretch).toBeCloseTo(1.05, 6);
    // First and last end at the run's ends: the end posts stand there
    expect(pieces[0].y - 5 * pieces[0].stretch).toBeCloseTo(0, 6);
    expect(pieces[5].y + 5 * pieces[5].stretch).toBeCloseTo(63, 6);
    // A short run is one shorter piece; the stretch stays near 1 on long runs
    expect(runPieces({ ...run, b: { x: 0, y: 4 }, length: 4 }, 10)[0].stretch).toBeCloseTo(0.4, 6);
    for (let L = 15; L < 300; L += 7) for (const p of runPieces({ a: { x: 0, y: 0 }, b: { x: L, y: 0 }, length: L }, 10)) expect(Math.abs(p.stretch - 1)).toBeLessThanOrEqual(1 / 3 + 1e-9);
  });

  it('spaces plants of a row evenly, the spare length split between the ends', () => {
    const trees = runPlants({ a: { x: 0, y: 0 }, b: { x: 30, y: 0 }, length: 30 }, 7);
    expect(trees.map((p) => p.x)).toEqual([1, 8, 15, 22, 29]);
  });
});
