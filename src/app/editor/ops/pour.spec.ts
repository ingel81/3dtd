import { createMapDocument } from '../../world/custom-map/map-create';
import { LandscapeNoise } from './landscape/landscape-noise';
import { filledHeights, holdsLake, pourWater } from './pour';
import { addPouredBodies, emptyWater, wetSamples } from './water-ops';

/** A slope falling 0.25 m per metre to the east with three pits 4 m deep in a row along y = 0 */
function cascade() {
  const t = createMapDocument({ id: 'm', name: 'M', width: 200, depth: 200, cellSize: 2, starter: false }).terrain;
  const g = t.grid;
  const slope = (x: number) => 30 - 0.25 * x;
  const pits = [-60, -10, 40];
  for (let j = 0; j < g.rows; j++) {
    for (let i = 0; i < g.columns; i++) {
      const x = i * 2 - 100;
      const y = j * 2 - 100;
      let h = slope(x);
      for (const cx of pits) {
        const r = Math.hypot(x - cx, y);
        if (r < 12) h = slope(cx + 12) - 4 + r * 0.1;
      }
      g.heights[j * g.columns + i] = h;
    }
  }
  const sample = (x: number, y: number) => Math.round((y + 100) / 2) * g.columns + Math.round((x + 100) / 2);
  return { t, g, slope, pits, sample };
}

/**
 * A crater 30 m across on top of a mound 120 m across, on a plain of 600 m
 * rolling like the hills biome (2.5 m at an 80 m wave)
 */
function craterOnPlain(seed: number) {
  const columns = 301;
  const noise = new LandscapeNoise(seed);
  const heights = new Float32Array(columns * columns);
  for (let j = 0; j < columns; j++) {
    for (let i = 0; i < columns; i++) {
      const x = i * 2 - 300;
      const y = j * 2 - 300;
      const d = Math.hypot(x, y);
      const r = d / 15;
      const crater = r < 1 ? -(1 - r * r) * 0.85 + 0.3 * Math.pow(r, 6) : 0.3 * Math.exp(-Math.pow((r - 1) * 2.6, 2));
      heights[j * columns + i] = 20 + 2.5 * noise.fbm(x, y, 80, 4) + 8 * Math.max(0, 1 - d / 60) + 5 * crater;
    }
  }
  return { columns, heights, centre: 150 * columns + 150 };
}

describe('pour', () => {
  it('fills every hollow so none is left lower than its rim', () => {
    const { g } = cascade();
    const filled = filledHeights(g.heights, g.columns, g.rows, new Uint8Array(g.heights.length));
    for (let k = 0; k < filled.length; k++) expect(filled[k]).toBeGreaterThanOrEqual(g.heights[k]);
    // No sample inside lies below all its neighbours: the water finds a way down everywhere
    for (let j = 1; j < g.rows - 1; j++) {
      for (let i = 1; i < g.columns - 1; i++) {
        const k = j * g.columns + i;
        expect(Math.min(filled[k - 1], filled[k + 1], filled[k - g.columns], filled[k + g.columns])).toBeLessThanOrEqual(filled[k]);
      }
    }
  });

  it('fills the hollow it lands in, spills over and fills each one further down, in order', () => {
    const { g, slope, pits, sample } = cascade();
    const { lakes, skipped } = pourWater({ columns: g.columns, rows: g.rows, heights: g.heights, starts: [sample(-60, 0)], wet: new Uint8Array(g.heights.length), cellSize: 2 });
    expect(skipped).toBe(0);
    expect(lakes.length).toBe(3);
    lakes.forEach((lake, n) => {
      // Each brims over at the low (east) side of its rim
      expect(lake.level).toBeCloseTo(slope(pits[n] + 12), 0);
      expect(lake.level - lake.floor).toBeGreaterThan(3);
    });
  });

  it('pours from higher up the slope into the first hollow and stops at water already there', () => {
    const { t, g, sample } = cascade();
    // The middle pit holds a lake already
    t.water = emptyWater(t, 30);
    for (let k = 0; k < g.heights.length; k++) {
      const i = k % g.columns;
      const x = i * 2 - 100;
      if (Math.abs(x + 10) < 12) t.water.mask[k] = 255;
    }
    const wet = wetSamples(t);
    const { lakes } = pourWater({ columns: g.columns, rows: g.rows, heights: g.heights, starts: [sample(-90, 0)], wet, cellSize: 2 });
    expect(lakes.length).toBe(1);
  });

  it('turns the lakes into bodies just below their rims, the same hollow from two starts once', () => {
    const { t, g, sample } = cascade();
    const { lakes } = pourWater({ columns: g.columns, rows: g.rows, heights: g.heights, starts: [sample(-60, 0), sample(-62, 2)], wet: new Uint8Array(g.heights.length), cellSize: 2 });
    expect(lakes.length).toBe(3);
    expect(addPouredBodies(t, lakes, 'lava', 64)).toBe(3);
    const bodies = t.waterBodies!;
    expect(bodies.map((b) => b.kind)).toEqual(['lava', 'lava', 'lava']);
    expect(bodies[0].level).toBeCloseTo(lakes[0].level - 0.3, 1);
    expect(bodies[0].mask[sample(-60, 0)]).toBe(255);
    expect(bodies[0].mask[sample(-10, 0)]).toBe(0);
    expect(bodies[1].mask[sample(-10, 0)]).toBe(255);
    // A full map takes no more
    expect(addPouredBodies(t, lakes, 'water', 4)).toBe(1);
  });

  it('fills a crater above a rolling plain and runs on across the plain', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { columns, heights, centre } = craterOnPlain(seed);
      const wet = new Uint8Array(heights.length);
      // The plain has dips well past half a metre (the overflow used to fill them as lakes up to 37 000 m²)
      const filled = filledHeights(heights, columns, columns, wet);
      let deepest = 0;
      for (let k = 0; k < heights.length; k++) {
        const i = k % columns;
        const j = (k - i) / columns;
        if (Math.hypot(i - 150, j - 150) > 40) deepest = Math.max(deepest, filled[k] - heights[k]);
      }
      expect(deepest).toBeGreaterThan(1);
      const { lakes } = pourWater({ columns, rows: columns, heights, starts: [centre], wet, cellSize: 2 });
      expect(lakes.length).toBe(1);
      expect(lakes[0].level - lakes[0].floor).toBeGreaterThan(3);
      expect(lakes[0].cells.length * 4).toBeLessThan(800);
    }
  });

  it('takes deep hollows, deep for their width or deep on average, as lakes', () => {
    // A crater 20 m across, 2 m deep
    expect(holdsLake(2, 1, 314)).toBe(true);
    // A valley lake 200 by 100 m, 5 m deep
    expect(holdsLake(5, 2.2, 20000)).toBe(true);
    // A dip of a rolling plain: 2 m deep, 0.55 m on average, 37 000 m²
    expect(holdsLake(2, 0.55, 37000)).toBe(false);
    // Under a metre
    expect(holdsLake(0.9, 0.5, 50)).toBe(false);
  });
});
