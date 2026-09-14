import { afterEach, describe, expect, it } from 'vitest';
import type { ColumnSample } from '../three-engine/column-sample';
import type { RouteCell } from './route-cell';
import { ColumnAt, WalkCapSegment, WalkGround, cellWalkable, judgeWalk, walkCaps } from './corridor-walk';
import { corridorConfig, resetCorridorConfig } from './route-corridor';

/** How much further than a piece's half width a neighbouring piece's round end reaches, plus a centimetre. */
const MARGIN = 2 * Math.SQRT1_2 * Math.hypot(1, 0.5) - 1.5 + 0.01;

/** A segment with `n` stations of one half width (local x east, z south: right of travel east is +z). */
const segment = (ax: number, az: number, bx: number, bz: number, n: number, left: number, right = left): WalkCapSegment =>
  ({ ax, az, bx, bz, stations: n, left: new Array<number>(n).fill(left), right: new Array<number>(n).fill(right) });

const unlimited = (caps: number[]) => caps.every((c) => c === Infinity);

describe('walkCaps', () => {
  afterEach(() => resetCorridorConfig());

  it('caps the station a spot lies along, on its side, short of the spot', () => {
    const [caps] = walkCaps([segment(0, 0, 20, 0, 10, 7)], [{ x: 11, z: 3 }], 2);
    expect(caps.right[5]).toBeCloseTo(3 - MARGIN, 9);
    expect(caps.right.filter((c) => c < Infinity)).toHaveLength(1);
    expect(unlimited(caps.left)).toBe(true);
  });

  it('leaves a spot beyond the half width, and one the segment runs through', () => {
    const [narrow] = walkCaps([segment(0, 0, 20, 0, 10, 2)], [{ x: 11, z: 3 }], 2);
    expect(unlimited(narrow.right)).toBe(true);
    // The segment runs along the edge of the cell around (11, 1): the corridor claims it at any width.
    const [through] = walkCaps([segment(0, 0, 20, 0, 10, 7)], [{ x: 11, z: 1 }], 2);
    expect(unlimited(through.right)).toBe(true);
  });

  it('caps the last station for a spot its round end reaches at the end of the route', () => {
    const [caps] = walkCaps([segment(0, 0, 20, 0, 10, 7)], [{ x: 23, z: 1 }], 2);
    expect(caps.right[9]).toBeCloseTo(Math.hypot(3, 1) - MARGIN, 9);
  });

  it('caps the outer side of a corner once, on the earlier segment', () => {
    // East to (20, 0), then south: left of travel is the outer side.
    const [east, south] = walkCaps([segment(0, 0, 20, 0, 10, 7), segment(20, 0, 20, 20, 10, 7)], [{ x: 23, z: -3 }], 2);
    expect(east.left[9]).toBeCloseTo(Math.hypot(3, 3) - MARGIN, 9);
    expect(unlimited(east.left.slice(0, 9))).toBe(true);
    expect(unlimited(south.left)).toBe(true);
  });

  it('leaves a corner alone where neither round end reaches the spot', () => {
    // 2 m on the outer side after the corner: both round ends stop at about 2 m.
    const [east, south] = walkCaps([segment(0, 0, 20, 0, 10, 7), segment(20, 0, 20, 20, 10, 2)], [{ x: 23, z: -3 }], 2);
    expect(unlimited(east.left)).toBe(true);
    expect(unlimited(south.left)).toBe(true);
  });

  it('leaves a segment without stations alone', () => {
    const tunnel: WalkCapSegment = { ax: 0, az: 0, bx: 20, bz: 0, stations: 0, left: [3], right: [3] };
    expect(walkCaps([tunnel], [{ x: 11, z: 3 }], 2)).toEqual([{ left: [], right: [] }]);
  });

  it('keeps a wider margin with a steeper taper', () => {
    corridorConfig.taper = 1;
    const [caps] = walkCaps([segment(0, 0, 20, 0, 10, 7)], [{ x: 11, z: 3 }], 2);
    // A round end reaches half a cell diagonal times hypot(1, 1) past the enemies' limit.
    expect(caps.right[5]).toBeCloseTo(3 - (2 - 1.5 + 0.01), 9);
  });
});

describe('cellWalkable', () => {
  const flat = (): ColumnSample => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 2 });
  /** The columns, and a centre line running east through the grid spots at z = 1 (and through (1, 5) with `through`). */
  const ground = (column: ColumnAt, through = false): WalkGround => ({
    column,
    lineSurface: (_x, z) => (Math.floor(z / 2) === 0 || (through && Math.floor(z / 2) === 2) ? 'ground' : null),
  });
  /** A cell 4 m south of the centre line spot (1, 1), 3 m up: on a roof over the street. */
  const cell = (over: Partial<RouteCell> = {}): RouteCell => ({
    key: 0, x: 1, z: 5, axisX: 1, axisZ: 1, terrainHeight: 3, surface: 'ground', tunnelSpan: null, routeAnchorY: 0,
    sample: { state: 'stable', sampledAt: 1, tileDepth: 20, tileGeometricError: 2 },
    heightSampled: true, enemies: new Set(), towerVisibility: new Map(), airVisibility: new Map(),
    ...over,
  });

  it('tells only for an edge cell on the ground with a fine sample of its own', () => {
    expect(cellWalkable(cell(), ground(flat), 2)).toBe(false);
    expect(cellWalkable(cell({ terrainHeight: 0.2 }), ground(flat), 2)).toBe(true);
    // A centre line runs through it, a deck, a filled or coarse sample, no column on the centre line, a seam.
    expect(cellWalkable(cell(), ground(flat, true), 2)).toBeNull();
    expect(cellWalkable(cell({ surface: 'deck' }), ground(flat), 2)).toBeNull();
    expect(cellWalkable(cell({ sample: { state: 'filled', sampledAt: 0, tileDepth: 0, tileGeometricError: Infinity } }), ground(flat), 2))
      .toBeNull();
    expect(cellWalkable(cell({ sample: { state: 'stable', sampledAt: 1, tileDepth: 12, tileGeometricError: 20 } }), ground(flat), 2))
      .toBeNull();
    expect(cellWalkable(cell(), ground(() => null), 2)).toBeNull();
    expect(cellWalkable(cell({ terrainHeight: 60 }), ground(flat), 2)).toBeNull();
  });

  it('says why, and how high the cell stands over the centre line', () => {
    expect(judgeWalk(cell(), ground(flat), 2)).toEqual({ walkable: false, check: 'roof', overLine: 3 });
    expect(judgeWalk(cell({ terrainHeight: 0.2 }), ground(flat), 2)).toEqual({ walkable: true, check: 'walkable', overLine: 0.2 });
    expect(judgeWalk(cell(), ground(flat, true), 2)).toEqual({ walkable: null, check: 'centre line', overLine: 3 });
    expect(judgeWalk(cell(), ground(() => null), 2).check).toBe('no centre line ground');
  });
});
