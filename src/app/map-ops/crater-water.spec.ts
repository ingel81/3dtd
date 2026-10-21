import { describe, expect, it } from 'vitest';
import type { MapRiver } from '../world/custom-map/map-document';
import { craterCm } from './impact-stamp';
import { craterCuts, lakeLevelAt, spill, type GroundGrid } from './crater-water';

const SIDE = 200;
const CELL = 2;

/** Ground `land(x, y)` with a channel along x = 0 (half width 6 m, 2.5 m deep) and a crater stamped in */
function ground(land: (x: number, y: number) => number, crater: { x: number; y: number; radius: number; depthCm: number } | null): GroundGrid {
  const n = SIDE / CELL + 1;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -SIDE / 2 + i * CELL;
      const y = -SIDE / 2 + j * CELL;
      let h = land(x, y);
      if (Math.abs(x) < 6) h -= 2.5;
      if (crater) h += craterCm((x - crater.x) ** 2 + (y - crater.y) ** 2, crater.radius, crater.depthCm) / 100;
      heights[j * n + i] = h;
    }
  }
  return { columns: n, rows: n, cellSize: CELL, originX: -SIDE / 2, originY: -SIDE / 2, heights };
}

/** A river down the channel, flowing north, its level 1 m under the land beside it */
function river(land: (x: number, y: number) => number): MapRiver {
  return { id: 'r', kind: 'water', points: Array.from({ length: 21 }, (_, k) => ({ x: 0, y: -100 + k * 10, width: 12, height: land(0, -100 + k * 10) - 1 })) };
}

const slope = (_x: number, y: number) => 20 - 0.02 * y;

describe('craterCuts', () => {
  it('leaves a crater wholly under the water alone: it only deepens the bed', () => {
    const c = { x: 0, y: 0, radius: 2.5, depthCm: 35 };
    expect(craterCuts(ground(slope, c), [river(slope)], c)).toEqual([]);
  });

  it('cuts a river with a crater wider than its water: the river comes in and goes on, the lake fills to the river downstream', () => {
    const c = { x: 0, y: 0, radius: 18, depthCm: 700 };
    const g = ground(slope, c);
    const [cut] = craterCuts(g, [river(slope)], c);
    expect(cut.river).toBe(0);
    expect(cut.entry).toBeLessThan(cut.exit);
    expect(cut.lip.y).toBeLessThan(-15);
    expect(cut.floor).toBeLessThan(slope(0, 0) - 9);
    // The spill is the channel downstream: the lake rises to the river's level there, no higher than it comes in
    expect(cut.downstream).toBe(true);
    expect(cut.spill.y).toBeGreaterThan(10);
    expect(cut.level).toBeCloseTo(cut.levelOut, 1);
    expect(cut.level).toBeLessThanOrEqual(cut.levelIn);
    expect(cut.volume).toBeGreaterThan(1000);
    expect(cut.fillSeconds).toBeGreaterThan(10);
    expect(cut.fillSeconds).toBeLessThanOrEqual(20);
    expect(cut.outflow).toBeNull();
  });

  it('spills where the ground falls away beside the river: a new way out, the lake as high as that', () => {
    // The land falls steeply east, the channel's banks hold the river: the crater's east wall is the lowest
    const tilt = (x: number, y: number) => 20 - 0.02 * y - 0.25 * Math.max(0, x - 8);
    const c = { x: 8, y: 0, radius: 14, depthCm: 500 };
    const [cut] = craterCuts(ground(tilt, c), [river(tilt)], c);
    expect(cut.downstream).toBe(false);
    expect(cut.spill.x).toBeGreaterThan(10);
    expect(cut.level).toBeLessThan(cut.levelOut);
    // The water's new way: down the slope to the east, to the map's edge, its surface never rising
    const way = cut.outflow!;
    expect(way.length).toBeGreaterThan(20);
    expect(way[way.length - 1].x).toBeGreaterThan(90);
    for (let k = 1; k < way.length; k++) expect(way[k].height).toBeLessThanOrEqual(way[k - 1].height);
  });

  it('lava spilling down to water ends there, where it sets as rock', () => {
    const tilt = (x: number, y: number) => 20 - 0.02 * y - 0.25 * Math.max(0, x - 8);
    const c = { x: 8, y: 0, radius: 14, depthCm: 500 };
    const lava = { ...river(tilt), kind: 'lava' as const };
    // Water from x = 60 on (a lake down the slope)
    const [cut] = craterCuts(ground(tilt, c), [lava], c, (x) => (x > 60 ? 'water' : null));
    expect(cut.outflowMeets).toBe('water');
    expect(cut.outflow![cut.outflow!.length - 1].x).toBeGreaterThan(60);
    expect(cut.outflow![cut.outflow!.length - 1].x).toBeLessThan(66);
  });

  it('a lava flow fills three times as slowly', () => {
    const c = { x: 0, y: 0, radius: 18, depthCm: 700 };
    const water = craterCuts(ground(slope, c), [river(slope)], c)[0];
    const lava = craterCuts(ground(slope, c), [{ ...river(slope), kind: 'lava' }], c)[0];
    expect(lava.fillSeconds).toBeCloseTo(water.fillSeconds * 3, 5);
  });
});

describe('spill and filling', () => {
  it('finds the lowest way out of a bowl', () => {
    const c = { x: 0, y: 0, radius: 10, depthCm: 400 };
    // A notch in the wall to the south-west
    const g = ground(() => 10, c);
    const n = g.columns;
    const heights = g.heights as Float32Array;
    for (let k = 0; k < 12; k++) heights[(n >> 1) * n + (n >> 1) - 8 - k] = 9.5;
    const s = spill({ ...g, heights }, { x: 30, y: 30, radius: 10 })!;
    expect(s).not.toBeNull();
    expect(spill(g, c)!.level).toBeLessThanOrEqual(10);
  });

  it('fills from the floor to the level over its seconds, never past it', () => {
    const cut = { floor: 2, level: 8, fillSeconds: 12 };
    expect(lakeLevelAt(cut, 0)).toBe(2);
    expect(lakeLevelAt(cut, 6)).toBeGreaterThan(5);
    expect(lakeLevelAt(cut, 12)).toBe(8);
    expect(lakeLevelAt(cut, 99)).toBe(8);
    let last = 2;
    for (let s = 0; s <= 12; s += 0.5) {
      const h = lakeLevelAt(cut, s);
      expect(h).toBeGreaterThanOrEqual(last);
      last = h;
    }
  });
});
