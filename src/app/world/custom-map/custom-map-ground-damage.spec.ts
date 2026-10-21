import { CustomMapGroundDamage, GROUND_TILE, TOWER_HOLD_M, type GroundRect } from './custom-map-ground-damage';
import { craterCm } from '../../map-ops/impact-stamp';
import { rubbleCmAt, rubbleShapeOf } from '../../utils/stamp-field';
import { MAP_METERS_PER_DEGREE as K, type MapHeightGrid } from './map-document';
import type { RunStructure } from '../../sim/protocol/run-rules';

/** A 256 m square map at 2 m, its ground at 5 m */
function setup() {
  const grid: MapHeightGrid = { columns: 129, rows: 129, cellSize: 2, heights: new Float32Array(129 * 129).fill(5) };
  const applied: GroundRect[] = [];
  const ground = new CustomMapGroundDamage(grid, 256, 256, (rect) => applied.push(rect));
  /** Height of the sample at map (x, y), on the grid */
  const at = (x: number, y: number) => grid.heights[((y + 128) / 2) * 129 + (x + 128) / 2];
  const drain = () => {
    for (let n = 0; n < 1000 && ground.pending > 0; n++) ground.flush();
  };
  return { grid, ground, applied, at, drain };
}

const BARN: RunStructure = { id: 'barn', lat: 40 / K, lon: -20 / K, radius: 5, height: 9, hp: 100, box: [-20, 40, 4, 3, 0.4] };

describe('CustomMapGroundDamage (docs/DESTRUCTION_PLAN.md, Z4)', () => {
  it('keeps the craters as stamped and when each was dug in the run; a restore forgets the times (E283)', () => {
    const grid: MapHeightGrid = { columns: 129, rows: 129, cellSize: 2, heights: new Float32Array(129 * 129).fill(5) };
    let clock = 7;
    const ground = new CustomMapGroundDamage(grid, 256, 256, () => undefined, undefined, undefined, undefined, undefined, undefined, () => clock, (x) => (x > 0 ? 'water' : null));
    const v0 = ground.craterVersion;
    ground.crater(100, 200, 25, 40, 1);
    expect(ground.craterVersion).toBeGreaterThan(v0);
    expect([...ground.craters()]).toEqual([['c100,200', { x: 10, y: 20, radius: 2.5, depthCm: 40 }]]);
    // Known, not dug in the run (a restore stamps them so): no time
    expect(ground.dugAt('c100,200')).toBeNull();
    clock = 12.5;
    ground.dug(100, 200);
    expect(ground.dugAt('c100,200')).toBe(12.5);
    expect(ground.waterAt(100, 0)).toBe('water');
    expect(ground.waterAt(-100, 0)).toBeNull();
    // Deepened: out and in again with its new depth
    ground.crater(100, 200, 25, 40, -1);
    ground.crater(100, 200, 25, 80, 1);
    expect(ground.craters().get('c100,200')?.depthCm).toBe(80);
    ground.clear();
    expect(ground.craters().size).toBe(0);
    expect(ground.dugAt('c100,200')).toBeNull();
  });

  it('stamps a crater into the run\'s heights with the shape of the simulation, a few tiles a frame', () => {
    const { ground, applied, at, drain } = setup();
    ground.crater(100, 200, 25, 40, 1);
    // Nothing is written before a frame flushes
    expect(at(10, 20)).toBe(5);
    ground.flush(1);
    expect(applied).toHaveLength(1);
    drain();
    for (const [x, y] of [[10, 20], [12, 20], [10, 22], [14, 22], [8, 16]]) {
      const dx = x - 10;
      const dy = y - 20;
      expect(at(x, y)).toBeCloseTo(5 + craterCm(dx * dx + dy * dy, 2.5, 40) / 100, 5);
    }
    expect(at(10, 20)).toBeCloseTo(4.6, 5);
    // A rectangle per frame, never more than its tiles
    for (const r of applied) expect(r.maxX - r.minX).toBeLessThanOrEqual(2 * GROUND_TILE * 2);
  });

  it('tells the view only the samples that changed, not the whole tiles round them', () => {
    const { ground, applied, drain } = setup();
    // A 2.5 m crater 10 m in from the map's south-west corner, in the corner's tile
    ground.crater(-1180, -1180, 25, 40, 1);
    drain();
    expect(applied).toHaveLength(1);
    const [r] = applied;
    // The crater reaches 1.35 times its radius: a few samples, clear of the border (the apron stays)
    expect(r.minX).toBeGreaterThan(-128 + 4);
    expect(r.minY).toBeGreaterThan(-128 + 4);
    expect(r.maxX).toBeLessThan(-118 + 4);
    expect(r.maxY).toBeLessThan(-118 + 4);
  });

  it('keeps the ground structures stand on: the craters, not the rubble, and the craters alone per point', () => {
    const { ground, drain } = setup();
    const rects: GroundRect[] = [];
    const told = new CustomMapGroundDamage(ground.standing, 256, 256, () => undefined, undefined, undefined, undefined, undefined, (r) => rects.push(r));
    const standingAt = (x: number, y: number) => ground.standing.heights[((y + 128) / 2) * 129 + (x + 128) / 2];
    // A nuke's crater (25 m, 4 m) over the barn's rubble
    ground.rubble(BARN, 1);
    ground.crater(-200, 400, 250, 400, 1);
    expect(ground.craterCmAt(-20, 40)).toBeCloseTo(-400, 5);
    expect(ground.craterCmAt(-19, 41)).toBeLessThan(-390);
    drain();
    // The standing ground sinks with the crater and does not rise on the rubble; the ground itself takes both
    expect(standingAt(-20, 40)).toBeCloseTo(1, 5);
    expect(standingAt(-60, 40)).toBe(5);
    // Out again: as built
    ground.crater(-200, 400, 250, 400, -1);
    drain();
    expect(standingAt(-20, 40)).toBe(5);
    expect(ground.craterCmAt(-20, 40)).toBe(0);
    // A crater tells its rectangle at once (what stands in it may be gone), a clear the whole map
    told.crater(0, 0, 100, 140, 1);
    expect(rects).toEqual([{ minX: -13.5, minY: -13.5, maxX: 13.5, maxY: 13.5 }]);
    told.clear();
    expect(rects[1]).toEqual({ minX: -128, minY: -128, maxX: 128, maxY: 128 });
  });

  it('heaps the rubble of a fallen structure as the stamp field does', () => {
    const { ground, at, drain } = setup();
    ground.rubble(BARN, 1);
    drain();
    const shape = rubbleShapeOf(BARN);
    for (const [x, y] of [[-20, 40], [-16, 42], [-24, 36], [-12, 40]]) expect(at(x, y)).toBeCloseTo(5 + rubbleCmAt(shape, x, y) / 100, 5);
    expect(at(-20, 40)).toBeGreaterThan(7);
  });

  it('comes to the same heights from a restore that stamps everything anew as from the run, and back to flat on a clear', () => {
    const run = setup();
    run.ground.crater(100, 200, 25, 30, 1);
    run.ground.rubble(BARN, 1);
    // The crater deepened: its old stamp out, the new in
    run.ground.crater(100, 200, 25, 30, -1);
    run.ground.crater(100, 200, 25, 60, 1);
    run.drain();
    const restored = setup();
    restored.ground.rubble(BARN, 1);
    restored.ground.crater(100, 200, 25, 60, 1);
    restored.drain();
    expect(Array.from(restored.grid.heights)).toEqual(Array.from(run.grid.heights));
    run.ground.clear();
    run.drain();
    expect(run.grid.heights.every((h) => h === 5)).toBe(true);
  });

  it('holds the ground under a standing tower: a crater beside it, and a tower in a crater', () => {
    const { ground, at, drain } = setup();
    // A tower at (0, 0) before any stamp, a crater right on it
    ground.holdTower('t1', 0, 0);
    ground.crater(0, 0, 60, 120, 1);
    drain();
    expect(at(0, 0)).toBe(5);
    expect(at(2, 2)).toBe(5);
    expect(at(TOWER_HOLD_M + 1, 0)).toBeLessThan(5);
    // Sold: the ground follows the crater
    ground.releaseTower('t1');
    drain();
    expect(at(0, 0)).toBeCloseTo(3.8, 5);
    // A tower built in the crater stands on its floor, which a second crater there does not move
    ground.holdTower('t2', 0, 0);
    ground.crater(0, 0, 60, 120, -1);
    ground.crater(0, 0, 60, 200, 1);
    drain();
    expect(at(0, 0)).toBeCloseTo(3.8, 5);
    expect(at(4, 0)).toBeLessThan(4);
  });
});
