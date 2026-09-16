import { afterEach, describe, expect, it } from 'vitest';
import type { ColumnSample } from '../three-engine/column-sample';
import type { RouteCell } from './route-cell';
import { ColumnAt, WalkGround, cellWalkable, judgeWalk, portalGround } from './corridor-walk';
import type { BandStation } from './corridor-band';
import { corridorConfig, resetCorridorConfig } from './route-corridor';

/**
 * The walk check reads the frozen band: a cell within its edges lies in the
 * corridor, a cell beyond them is one the band ended before, and the check
 * says which rule of the walk out that was. Local x east, z south, as the
 * grid keys its cells; the station runs east, so right of travel is +z.
 */
const flat = (): ColumnSample => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 2 });

/** A band station on the line at (1, 1) heading east, its band 3 m either side, its backbone on the line. */
const station = (over: Partial<BandStation> = {}): BandStation => ({
  segment: 0, k: 0, n: 10, s: 1, x: 1, z: 1, rx: 0, rz: 1,
  kind: 'band', backbone: { offset: 0, y: 0 }, street: 0, left: -3, right: 3, centre: 0,
  ...over,
});

const ground = (column: ColumnAt, st: BandStation | null = station()): WalkGround => ({ column, station: () => st });

/** A cell 6 m right of the line at (1, 7), beyond a band that ends 3 m out; `terrainHeight` its height over the backbone. */
const cell = (over: Partial<RouteCell> = {}): RouteCell => ({
  key: 0, x: 1, z: 7, axisX: 1, axisZ: 1, terrainHeight: 3, surface: 'ground', tunnelSpan: null, deckEnd: null, routeAnchorY: 0,
  sample: { state: 'stable', sampledAt: 1, tileDepth: 20, tileGeometricError: 2 },
  heightSampled: true, enemies: new Set(), towerVisibility: new Map(), airVisibility: new Map(),
  ...over,
});

describe('cellWalkable', () => {
  afterEach(() => resetCorridorConfig());

  it('tells only for a cell with a fine sample of its own on a stretch the band decides', () => {
    // Within the band's edges, and beyond them: the edge lies midway between the last cell reached and the first not.
    expect(cellWalkable(cell({ z: 3, terrainHeight: 0 }), ground(flat))).toBe(true);
    expect(cellWalkable(cell({ z: 5, terrainHeight: 0 }), ground(flat))).toBe(false);
    expect(cellWalkable(cell(), ground(flat))).toBe(false);
    // A deck or tunnel cell, one without a sample of its own, one from a coarse tile, and no band at all.
    expect(cellWalkable(cell({ surface: 'deck' }), ground(flat))).toBeNull();
    expect(cellWalkable(cell({ sample: { state: 'filled', sampledAt: 0, tileDepth: 0, tileGeometricError: Infinity } }), ground(flat))).toBeNull();
    expect(cellWalkable(cell({ sample: { state: 'stable', sampledAt: 1, tileDepth: 12, tileGeometricError: 20 } }), ground(flat))).toBeNull();
    expect(cellWalkable(cell(), ground(flat, null))).toBeNull();
  });

  it('says why, and how high the cell stands over the backbone', () => {
    expect(judgeWalk(cell(), ground(flat))).toEqual({ walkable: false, check: 'roof', overLine: 3 });
    expect(judgeWalk(cell({ terrainHeight: 1 }), ground(flat))).toEqual({ walkable: false, check: 'step', overLine: 1 });
    expect(judgeWalk(cell({ terrainHeight: -1 }), ground(flat))).toEqual({ walkable: false, check: 'drop', overLine: -1 });
    // Beside the band for another reason: the rays' wall, a bulge cut, the taper along the route.
    expect(judgeWalk(cell({ terrainHeight: 0.2 }), ground(flat))).toEqual({ walkable: false, check: 'beyond the band', overLine: 0.2 });
    expect(judgeWalk(cell({ z: 3, terrainHeight: 0.2 }), ground(flat))).toEqual({ walkable: true, check: 'band', overLine: 0.2 });
  });

  it('takes the step, the drop and the roof from corridorConfig', () => {
    corridorConfig.stepRise = 2;
    expect(judgeWalk(cell({ terrainHeight: 1 }), ground(flat)).check).toBe('beyond the band');
    corridorConfig.stepDrop = 2;
    expect(judgeWalk(cell({ terrainHeight: -1 }), ground(flat)).check).toBe('beyond the band');
    corridorConfig.roofRise = 1.5;
    expect(judgeWalk(cell({ terrainHeight: 2 }), ground(flat)).check).toBe('roof');
  });

  it('tells a cell under a car the mesh made hollow, the street under its body', () => {
    // Playtest 727, Galgengasse: the roof 1.48 m over the street the cell took.
    const over = (top: number) => (x: number, z: number): ColumnSample => (x === 1 && z === 7 ? { ...flat(), topY: top } : flat());
    expect(judgeWalk(cell({ terrainHeight: 0 }), ground(over(1.48)))).toEqual({ walkable: false, check: 'hollow', overLine: 0 });
    // A crown or an eave higher than roofRise over the street, and a blob no higher than a step: no hollow object.
    expect(judgeWalk(cell({ terrainHeight: 0 }), ground(over(6))).check).toBe('beyond the band');
    expect(judgeWalk(cell({ terrainHeight: 0 }), ground(over(0.4))).check).toBe('beyond the band');
  });

  it('judges no cell of a passage or of a stretch the band leaves alone', () => {
    expect(judgeWalk(cell(), ground(flat, station({ kind: 'passage', backbone: null }))))
      .toEqual({ walkable: null, check: 'passage', overLine: null });
    expect(judgeWalk(cell(), ground(flat, station({ kind: 'fixed', backbone: null }))))
      .toEqual({ walkable: null, check: 'fixed stretch', overLine: null });
    expect(judgeWalk(cell({ surface: 'tunnel', tunnelSpan: { ax: 0, az: 0, bx: 10, bz: 0, f: 0.5, passage: true } }), ground(flat)).check)
      .toBe('passage');
  });

  it('counts a cell of a climb, where the band lies on what fills the lane, as in the band', () => {
    // A car filling a lane is its own backbone (E6): its cells are the band.
    const climb = station({ kind: 'climb', backbone: { offset: 0, y: 1.5 }, left: -1.5, right: 1.5 });
    expect(judgeWalk(cell({ z: 1, terrainHeight: 1.5 }), ground(flat, climb))).toEqual({ walkable: true, check: 'band', overLine: 0 });
  });
});

describe('portalGround', () => {
  afterEach(() => resetCorridorConfig());

  it('gives a tunnel portal the street where its column came down on a roof over it', () => {
    // The column of the portal 5 m up on the jetty of the house the passage runs through.
    expect(portalGround(1, 1, 5, ground(flat))).toBe(0);
    // Within roofRise it keeps its hit, and so does a portal without a band or without a street.
    expect(portalGround(1, 1, 2, ground(flat))).toBeNull();
    expect(portalGround(1, 1, 5, ground(flat, null))).toBeNull();
    expect(portalGround(1, 1, 5, ground(flat, station({ street: null })))).toBeNull();
  });

  /**
   * Playtest 2026-09-16, Rothenburg, the Weisser Turm over Georgengasse: the
   * mesh of a gate tower reaches past the mouth of its archway, so the
   * station a portal asks can be a passage itself, or have its own backbone
   * on the tower. Both gave no answer until then, and the portal kept its
   * hit on the roof, which put every cell of the passage on the tower.
   */
  it('takes the street of a station that stands on the roof itself', () => {
    expect(portalGround(1, 1, 12, ground(flat, station({ kind: 'passage', backbone: null })))).toBe(0);
    expect(portalGround(1, 1, 12, ground(flat, station({ kind: 'climb', backbone: { offset: 0, y: 12 } })))).toBe(0);
  });

  it('gives a portal whose column has no hit the street, where the band has one', () => {
    expect(portalGround(1, 1, null, ground(flat))).toBe(0);
    expect(portalGround(1, 1, null, ground(flat, null))).toBeNull();
    expect(portalGround(1, 1, null, ground(flat, station({ street: null })))).toBeNull();
  });

  it('takes the threshold from corridorConfig.roofRise', () => {
    corridorConfig.roofRise = 1.5;
    expect(portalGround(1, 1, 2, ground(flat))).toBe(0);
  });
});
