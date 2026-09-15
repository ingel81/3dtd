import { afterEach, describe, expect, it } from 'vitest';
import type { ColumnSample } from '../three-engine/column-sample';
import type { RouteCell } from './route-cell';
import { ColumnAt, WalkCapSegment, WalkGround, cellWalkable, judgeWalk, streetUnderRoof, walkCaps } from './corridor-walk';
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

  it('keeps the round end of the station next to a narrow cap off the spot', () => {
    // Stations meet at odd metres, the line runs inside the cells at z = 1.
    // The spot's station is capped under edgeMargin; the round end of the
    // one before it reaches 1.58 m.
    const [caps] = walkCaps([segment(1, 0.5, 21, 0.5, 10, 2, 7)], [{ x: 11.4, z: -0.8 }], 2);
    expect(caps.left[5]).toBeCloseTo(1.3 - MARGIN, 9);
    expect(caps.left[4]).toBeCloseTo(Math.hypot(0.4, 1.3) - 0.01, 9);
    expect(unlimited([...caps.left.slice(0, 4), ...caps.left.slice(6)])).toBe(true);
    expect(unlimited(caps.right)).toBe(true);
  });

  it('caps the station that claims a spot right at its end with its own half width', () => {
    // (11, -1) lies across the joint of stations 4 and 5: both claim it along their length.
    const [caps] = walkCaps([segment(1, 0.5, 21, 0.5, 10, 2, 7)], [{ x: 11, z: -1 }], 2);
    expect(caps.left[5]).toBeCloseTo(1.5 - MARGIN, 9);
    expect(caps.left[4]).toBeCloseTo(1.5 - 0.01, 9);
    expect(unlimited(caps.left.slice(6))).toBe(true);
  });

  it('caps a station whose round end reaches over a joint only the other side makes', () => {
    // Along z = 1, 7 m both sides. A spot right of stations 10 caps them
    // there, one left of station 11 there: the piece of station 10 ends
    // at x = 22 on the left side as well, and station 9, 7 m on the left
    // like station 10, reached (23, -1) with its round end from (20, 1).
    const [caps] = walkCaps([segment(0, 1, 60, 1, 30, 7)], [{ x: 23, z: -1 }, { x: 21, z: 3 }], 2);
    expect(caps.left[11]).toBeCloseTo(2 - MARGIN, 9);
    expect(caps.right[10]).toBeCloseTo(2 - MARGIN, 9);
    expect(caps.left[9]).toBeCloseTo(Math.hypot(3, 2) - 0.01, 9);
    expect(unlimited(caps.left.slice(0, 9))).toBe(true);
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
  afterEach(() => resetCorridorConfig());

  const flat =(): ColumnSample => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 2 });
  /** The columns, and a centre line running east through the grid spots at z = 1 (and through (1, 5) with `through`). */
  const ground = (column: ColumnAt, through = false, line: Pick<RouteCell, 'surface' | 'deckEnd'> = { surface: 'ground', deckEnd: null }): WalkGround => ({
    column,
    lineCell: (_x, z) => (Math.floor(z / 2) === 0 || (through && Math.floor(z / 2) === 2) ? line : null),
  });
  /** A cell 4 m south of the centre line spot (1, 1), 3 m up: on a roof over the street. */
  const cell = (over: Partial<RouteCell> = {}): RouteCell => ({
    key: 0, x: 1, z: 5, axisX: 1, axisZ: 1, terrainHeight: 3, surface: 'ground', tunnelSpan: null, deckEnd: null, routeAnchorY: 0,
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
    // A centre line cell whose own column is 3 m up, put on the street by the grid.
    const roof = (x: number, z: number): ColumnSample => ({ ...flat(), groundY: x === 1 && z === 5 ? 3 : 0 });
    expect(judgeWalk(cell({ terrainHeight: 0 }), ground(roof, true), 2))
      .toEqual({ walkable: null, check: 'centre line on a roof', overLine: 0 });
  });

  it('tells a drop from a step, and takes it from corridorConfig.stepDrop', () => {
    // 1 m below the centre line, 4 m out: a drop of 1 m on the last step.
    expect(judgeWalk(cell({ terrainHeight: -1 }), ground(flat), 2)).toEqual({ walkable: false, check: 'drop', overLine: -1 });
    // 0.4 m per step down a slope on one side only, nothing to mirror.
    const bank = (_x: number, z: number): ColumnSample => ({ ...flat(), groundY: z > 2 ? -0.2 * (z - 1) : 0 });
    expect(judgeWalk(cell({ terrainHeight: -0.8 }), ground(bank), 2).check).toBe('walkable');
    corridorConfig.stepDrop = 1.5;
    expect(cellWalkable(cell({ terrainHeight: -1 }), ground(flat), 2)).toBe(true);
  });

  it('walks out from the street beside a centre line raised on a row of cars', () => {
    // The line spots (0 <= z < 2) on a row of cars 1.5 m up: their median, the reference, on the roofs.
    const row = (_x: number, z: number): ColumnSample => ({ ...flat(), groundY: z >= 0 && z < 2 ? 1.5 : 0 });
    expect(judgeWalk(cell({ terrainHeight: 0 }), ground(row), 2)).toEqual({ walkable: true, check: 'walkable', overLine: -1.5 });
    // A car at the edge, measured from the street beside the row, not from its roofs.
    expect(judgeWalk(cell({ terrainHeight: 1.5 }), ground(row), 2).check).toBe('step');
    // A quay 4 m down on the other side: the walk goes on from the street, and the quay stays a drop.
    const quay = (x: number, z: number): ColumnSample => (z < 0 ? { ...flat(), groundY: -4 } : row(x, z));
    expect(judgeWalk(cell({ terrainHeight: 0 }), ground(quay), 2).check).toBe('walkable');
    expect(judgeWalk(cell({ z: -3, terrainHeight: -4 }), ground(quay), 2).check).toBe('drop');
  });

  it('walks out on the deck carried on past a bridge end, not on the quay under it', () => {
    // The deck at 80 m over a quay at 70 m north of z = 3, solid ground at 80 m south of it.
    const head = (_x: number, z: number): ColumnSample => (z < 3
      ? { groundY: 70, topY: 80, tileDepth: 20, tileGeometricError: 2 }
      : { groundY: 80, topY: 80, tileDepth: 20, tileGeometricError: 2 });
    const deckEnd = { path: [{ x: -20, z: 1 }, { x: 1, z: 1 }], m: 21 };
    const onDeck = cell({ terrainHeight: 80, surface: 'approach', deckEnd });
    // The centre line beside it is on the stretch as well, its spots on the deck.
    const line = { surface: 'approach' as const, deckEnd };
    expect(judgeWalk(onDeck, ground(head, false, line), 2)).toEqual({ walkable: true, check: 'walkable', overLine: 0 });
    // Judged from the quay, the same cell would stand 10 m over the street.
    expect(judgeWalk({ ...onDeck, surface: 'ground', deckEnd: null }, ground(head), 2))
      .toEqual({ walkable: false, check: 'roof', overLine: 10 });
    // A car on the deck carried on is still a car.
    const car = (x: number, z: number) => (z > 4 ? { groundY: 81.5, topY: 81.5, tileDepth: 20, tileGeometricError: 2 } : head(x, z));
    expect(cellWalkable({ ...onDeck, terrainHeight: 81.5 }, ground(car, false, line), 2)).toBe(false);
    // No column at the bridge end: no judgement.
    expect(judgeWalk(onDeck, ground((x, z) => (x < -10 ? null : head(x, z)), false, line), 2).check).toBe('no bridge end');
  });

  it('never pulls a cell on the deck carried on down to the quay under it', () => {
    // A centre line cell of the stretch at 80 m among line spots on the ground, whose lowest hit is the quay at 70 m.
    const quay = (): ColumnSample => ({ groundY: 70, topY: 80, tileDepth: 20, tileGeometricError: 2 });
    const deckEnd = { path: [{ x: -20, z: 1 }, { x: 1, z: 1 }], m: 21 };
    const onLine = cell({ z: 1, terrainHeight: 80, surface: 'approach', deckEnd });
    expect(streetUnderRoof(onLine, 80, ground(quay), 2)).toBeNull();
    // A ground cell there would take the line's ground, as under a jetty.
    expect(streetUnderRoof({ ...onLine, surface: 'ground', deckEnd: null }, 80, ground(quay), 2)).toBe(70);
    // With its line spots on the stretch as well, they count on the deck.
    expect(judgeWalk({ ...cell({ terrainHeight: 80 }), surface: 'approach', deckEnd },
      ground(quay, false, { surface: 'approach', deckEnd }), 2).overLine).toBe(0);
  });

  it('puts a centre line cell off a bridge end under a crown on the height carried there', () => {
    // The deck carried on at 80 m over the quay; over the cell a crown at 88 m, no ground under it.
    const crown = (x: number, z: number): ColumnSample => (x === 1 && z === 1
      ? { groundY: 88, topY: 88, tileDepth: 20, tileGeometricError: 2 }
      : { groundY: 70, topY: 80, tileDepth: 20, tileGeometricError: 2 });
    const deckEnd = { path: [{ x: -20, z: 1 }, { x: 1, z: 1 }], m: 21 };
    const line = { surface: 'approach' as const, deckEnd };
    const onLine = cell({ z: 1, terrainHeight: 88, surface: 'approach', deckEnd });
    expect(streetUnderRoof(onLine, 88, ground(crown, false, line), 2)).toBe(80);
    expect(judgeWalk(onLine, ground(crown, false, line), 2).check).toBe('centre line on a roof');
  });
});
