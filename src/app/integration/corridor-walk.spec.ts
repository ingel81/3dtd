/**
 * Integration Test: cells no enemy could walk to narrow the corridor
 *
 * User decision after the playtest of 2026-09-14 (orange cells): a cell
 * whose column comes down on a van, an eave or a raised garden leaves the
 * corridor, and the corridor ends before it so that no enemy walks where no
 * cell is. This runs the chain PathAndRouteService and CorridorController
 * run, on one straight street 60 m long: grid, walk check, caps per station,
 * corridor fit, grid again, until nothing changes. Then enemies walk it.
 */
import { describe, expect, it } from 'vitest';
import { GameObject } from '../core/game-object';
import { ComponentType } from '../core/component';
import { TransformComponent } from '../game-components/transform.component';
import { MovementComponent } from '../game-components/movement.component';
import { GlobalRouteGrid } from '../utils/global-route-grid';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { CorridorPiece, closeShortNarrowings, fitCorridorPieces } from '../utils/route-corridor';
import { walkCaps } from '../utils/corridor-walk';
import type { ColumnSample } from '../three-engine/column-sample';
import type { RouteWaypoint } from '../models/game.types';

const ORIGIN = { lat: 48.776, lon: 9.183 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);

/** The flat projection EllipsoidSync.geoToLocalSimple uses: x east, z south. */
const sync = {
  geoToLocalSimple: (lat: number, lon: number, height: number) => ({
    x: (lon - ORIGIN.lon) * M_PER_DEG_LON,
    y: height,
    z: -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT,
  }),
};

/** A waypoint at local (x, z), half widths left and right of the segment it starts. */
const at = (x: number, z: number, left?: number, right = left): RouteWaypoint => ({
  lat: ORIGIN.lat - z / METERS_PER_DEGREE_LAT,
  lon: ORIGIN.lon + x / M_PER_DEG_LON,
  corridorLeft: left,
  corridorRight: right,
});

const CELL = 2;

/** A street from `a` to `b` (local x, z), stations every 2 m; the free space they measure left and right of travel. */
interface Street {
  a: { x: number; z: number };
  b: { x: number; z: number };
  left: number;
  right: number;
}

/** Most tests: eastbound along z = 1 from x = 0 to 60, so right of travel is +z; no wall within 7 m. */
const STREET: Street = { a: { x: 0, z: 1 }, b: { x: 60, z: 1 }, left: 7, right: 7 };

/** Ground height of the photogrammetry at local (x, z); a car or an eave has no ground under it. */
type Ground = (x: number, z: number) => number;

/** Heights per grid spot, "x,z" of its centre, `street` elsewhere: the columns of a `__corridor.pick()`. */
const bySpot = (heights: Record<string, number>, street: number): Ground => {
  const centre = (v: number) => (Math.floor(v / CELL) + 0.5) * CELL;
  return (x, z) => heights[`${centre(x)},${centre(z)}`] ?? street;
};

const pieceAt = (pieces: readonly CorridorPiece[], t: number) => pieces.filter((p) => p.t <= t).pop()!;

/**
 * The street's grid once the corridor stays short of every cell no enemy
 * could walk to, the route it was built from and how many builds that took
 * after the first. What PathAndRouteService.narrowToWalkable and
 * CorridorController.rebuildCorridors do, on one segment.
 */
function narrowed(ground: Ground, street: Street = STREET): { grid: GlobalRouteGrid; route: RouteWaypoint[]; builds: number } {
  const { a, b } = street;
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const stations = Math.max(1, Math.round(length / 2));
  const column = (x: number, z: number): ColumnSample => ({ groundY: ground(x, z), topY: ground(x, z), tileDepth: 20, tileGeometricError: 2 });
  const walk = { left: new Array<number>(stations).fill(Infinity), right: new Array<number>(stations).fill(Infinity) };
  for (let builds = 0; ; builds++) {
    const fitted = fitCorridorPieces([{
      left: new Array<number>(stations).fill(street.left), right: new Array<number>(stations).fill(street.right),
      fallback: 2.75, onStreet: true, walkLeft: walk.left, walkRight: walk.right,
    }]);
    const [pieces] = closeShortNarrowings(fitted, [length], [false]);
    const route = pieces.map((p) => at(a.x + (b.x - a.x) * p.t, a.z + (b.z - a.z) * p.t, p.left, p.right));
    route.push(at(b.x, b.z));
    const grid = new GlobalRouteGrid();
    grid.initialize(column as never, sync as never);
    grid.generateFromRoutes([route]);

    const widths = (side: 'left' | 'right') => Array.from({ length: stations }, (_, k) => pieceAt(pieces, (k + 0.5) / stations)[side]);
    const [caps] = walkCaps(
      [{ ax: a.x, az: a.z, bx: b.x, bz: b.z, stations, left: widths('left'), right: widths('right') }],
      grid.unwalkableCells(),
      CELL,
    );
    let changed = false;
    for (const side of ['left', 'right'] as const) {
      for (let k = 0; k < stations; k++) {
        if (caps[side][k] >= walk[side][k]) continue;
        walk[side][k] = caps[side][k];
        changed = true;
      }
    }
    if (!changed || builds === 5) return { grid, route, builds };
  }
}

class Walker extends GameObject {
  constructor() {
    super('enemy');
    this.addComponent(new TransformComponent(this), ComponentType.TRANSFORM);
  }
}

/** Walk `route` with each lateral factor and list every position without a cell under it. */
function positionsOutside(grid: GlobalRouteGrid, route: RouteWaypoint[]): string[] {
  const outside: string[] = [];
  for (const factor of [-1, -0.6, 0.3, 1]) {
    const walker = new Walker();
    const movement = new MovementComponent(walker);
    const transform = walker.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
    movement.setPath(route);
    movement.speedMps = 4;
    movement.setLateralFactor(factor);
    let steps = 0;
    while (movement.move(16.667, 0) === 'moving' && steps++ < 20000) {
      const local = sync.geoToLocalSimple(transform.position.lat, transform.position.lon, 0);
      if (!grid.getCellAt(local.x, local.z)) outside.push(`factor ${factor} at ${local.x.toFixed(2)},${local.z.toFixed(2)}`);
    }
  }
  return outside;
}

describe('Corridor short of the cells no enemy could walk to', () => {
  it('ends the corridor before a van beside the road, with the pavement behind it', () => {
    // A van 2.2 m high from 2.5 to 4.5 m right of the centre line, x 20 to 26; the pavement behind it.
    const { grid, route, builds } = narrowed((x, z) => (x > 20 && x < 26 && z > 3.5 && z < 5.5 ? 2.2 : z >= 5.5 ? 0.15 : 0));

    expect(builds).toBe(1);
    expect(grid.unwalkableCells()).toEqual([]);
    expect(grid.getCellAt(23, 5)).toBeUndefined(); // on the van
    expect(grid.getCellAt(23, 7)).toBeUndefined(); // the pavement behind it
    expect(grid.getCellAt(23, 3)).toBeDefined(); // the street in front of it
    expect(grid.getCellAt(11, 7)).toBeDefined(); // the pavement away from it
    expect(positionsOutside(grid, route)).toEqual([]);
  });

  it('ends the corridor before an eave over the edge', () => {
    // A house left of the street from x 30 to 50: its eave, 6 m up, 3.5 m and more off the centre line.
    const { grid, route } = narrowed((x, z) => (x > 30 && x < 50 && z < -2.5 ? 6 : 0));

    expect(grid.unwalkableCells()).toEqual([]);
    expect(grid.getCellAt(41, -3)).toBeUndefined();
    expect(grid.getCellAt(41, -1)).toBeDefined();
    expect(grid.getCellAt(11, -3)).toBeDefined();
    expect(positionsOutside(grid, route)).toEqual([]);
  });

  it('drops a raised garden behind a gap, not a courtyard at street level', () => {
    // Right of the street, 3 m and more off the centre line: a garden 1.2 m
    // up from x 30 to 42, a courtyard at 0.1 m from x 46 to 56.
    const { grid, route } = narrowed((x, z) => (z > 4 && x > 30 && x < 42 ? 1.2 : z > 4 && x > 46 && x < 56 ? 0.1 : 0));

    expect(grid.unwalkableCells()).toEqual([]);
    expect(grid.getCellAt(35, 5)).toBeUndefined();
    expect(grid.getCellAt(35, 3)).toBeDefined();
    expect(grid.getCellAt(51, 7)).toBeDefined();
    expect(positionsOutside(grid, route)).toEqual([]);
  });

  /**
   * Playtest 2026-09-14, retest 560 to 563, Rothenburg ob der Tauber, pick
   * C: an alley with a wall 1.5 m left of the centre line (half width 1),
   * open to the right. The column of the centre line spot (-231, -57) came
   * down on a jetty 5.7 m above the street, and the cell (-235, -57), 2 m
   * above the street under an eave, was measured against it and passed.
   * Heights as the pick printed them; the line runs through the corner
   * (-232, -58) as the order of its rows shows, a little steeper than 1 in 3,
   * so the point of the line nearest to (-235, -57) lies in (-231, -57).
   */
  it('measures an edge cell from the street, not from a centre line spot on a jetty', () => {
    const ground = bySpot({ '-231,-57': 477, '-231,-55': 471.93, '-235,-57': 473.31 }, 471.25);
    const alley: Street = { a: { x: -235, z: -70 }, b: { x: -229, z: -46 }, left: 1.5, right: 7 };
    const { grid, route, builds } = narrowed(ground, alley);

    expect(builds).toBe(1);
    expect(grid.getCellAt(-235, -57)).toBeUndefined();
    // The centre line cell under the jetty stays, the corridor keeps it at
    // any width, but on the street: enemies take their height from it.
    const [jetty] = grid.describeCellsAround(-231, -57, 0.5, null);
    expect(jetty).toMatchObject({ x: -231, z: -57, cell: true, walkable: null, walkCheck: 'centre line on a roof', overLineM: 0 });
    expect(jetty.heightM).toBeLessThan(472);
    expect(grid.getCellAt(-235, -61)).toBeDefined();
    expect(positionsOutside(grid, route)).toEqual([]);
  });

  it('drops a car cell next to where two stations of a narrow lane meet', () => {
    // A wall 2.5 m left of the centre line (half width 2), stations meeting
    // at odd metres; a car 1.5 m up, 1.5 m off the line, across the joint
    // at x = 21. Capped under edgeMargin, a station's neighbour still
    // reached the cell with its round end.
    const lane: Street = { a: { x: 1, z: 0.5 }, b: { x: 41, z: 0.5 }, left: 2.5, right: 7 };
    const { grid, route, builds } = narrowed((x, z) => (x > 20 && x < 22 && z > -2 && z < 0 ? 1.5 : 0), lane);

    expect(builds).toBe(1);
    expect(grid.getCellAt(21, -1)).toBeUndefined();
    expect(grid.getCellAt(11, -1)).toBeDefined();
    expect(positionsOutside(grid, route)).toEqual([]);
  });

  /**
   * Pick A of the same playtest: two cells on a car 0.6 m above the street
   * (473.99 m over street cells at 473.37 to 473.42 m, 0.57 m over the one
   * in front of it). A stepRise of 0.75 m let the walk climb onto it.
   */
  it('ends the corridor before a low car blob, 0.6 m over the street', () => {
    const ground = bySpot({ '21,5': 473.99, '23,5': 473.99, '21,3': 473.42, '23,3': 473.37 }, 473.4);
    const { grid, route, builds } = narrowed(ground);

    expect(builds).toBe(1);
    expect(grid.getCellAt(21, 5)).toBeUndefined();
    expect(grid.getCellAt(23, 5)).toBeUndefined();
    expect(grid.getCellAt(21, 3)).toBeDefined();
    expect(grid.getCellAt(11, 5)).toBeDefined();
    expect(positionsOutside(grid, route)).toEqual([]);
  });

  /**
   * User decision after the second playtest of 2026-09-14: parked cars and
   * transporters narrow the corridor, no cells on them. Also on a street
   * across a slope, where the step check allows the cross slope: the car
   * stands 0.6 m on the ground rising 15 % towards it.
   */
  it('ends the corridor before a car on the uphill side of a street across a slope', () => {
    const slope = (z: number) => (z - 1) * 0.15;
    const onCar = (x: number, z: number) => x > 20 && x < 24 && z > 4 && z < 6;
    const { grid, route, builds } = narrowed((x, z) => slope(z) + (onCar(x, z) ? 0.6 : 0));

    expect(builds).toBe(1);
    expect(grid.getCellAt(21, 5)).toBeUndefined();
    expect(grid.getCellAt(23, 5)).toBeUndefined();
    expect(grid.getCellAt(21, 3)).toBeDefined();
    // The slope itself keeps its cells, uphill and downhill.
    expect(grid.getCellAt(11, 7)).toBeDefined();
    expect(grid.getCellAt(21, -5)).toBeDefined();
    expect(positionsOutside(grid, route)).toEqual([]);
  });

  /**
   * Playtest 2026-09-15, retest 607, Rothenburg: single parked cars still
   * carried cells (a red car, no pick). On the downhill side of a street
   * across a slope the step check measured a car from the highest ground
   * reached, the centre line: a car 0.8 m high 4 m down a 10 % cross slope
   * stood only 0.4 m over it. Now from the ground in front of it.
   */
  it('ends the corridor before a car on the downhill side of a street across a slope', () => {
    const slope = (z: number) => -(z - 1) * 0.1;
    const onCar = (x: number, z: number) => x > 20 && x < 24 && z > 4 && z < 6;
    const { grid, route, builds } = narrowed((x, z) => slope(z) + (onCar(x, z) ? 0.8 : 0));

    expect(builds).toBe(1);
    expect(grid.getCellAt(21, 5)).toBeUndefined();
    expect(grid.getCellAt(23, 5)).toBeUndefined();
    expect(grid.getCellAt(21, 3)).toBeDefined();
    // The slope itself keeps its cells, downhill and uphill.
    expect(grid.getCellAt(11, 7)).toBeDefined();
    expect(grid.getCellAt(21, -5)).toBeDefined();
    expect(positionsOutside(grid, route)).toEqual([]);
  });

  it('keeps a step up from the ground in front on the downhill side of a street across a slope', () => {
    // Falling 10 % towards +z, a garden level with the centre line from 5 m
    // off it: 0.4 m over the road edge in front of it at 4 m, 0.6 m over the
    // road carried on down the slope.
    const { grid, builds } = narrowed((_x, z) => (z > 6 ? 0 : -(z - 1) * 0.1));

    expect(builds).toBe(0);
    expect(grid.getCellAt(31, 7)).toBeDefined();
  });

  it('keeps a kerb, photogrammetry noise and a bank rising 20 % on one side walkable', () => {
    // Right: a kerb 0.2 m up from 2 m off the centre line, then a bank
    // rising 0.2 m per metre, with nothing falling on the other side to
    // count as a cross slope. Left: 0.1 m up or down from cell to cell.
    const noise = (x: number, z: number) => ((Math.floor(x / CELL) + Math.floor(z / CELL)) % 2 === 0 ? 0.1 : -0.1);
    const { grid, builds } = narrowed((x, z) => (z > 2 ? 0.2 + Math.max(0, z - 3) * 0.2 : noise(x, z)));

    expect(builds).toBe(0);
    expect(grid.unwalkableCells()).toEqual([]);
    expect(grid.getCellAt(31, 7)).toBeDefined();
    expect(grid.getCellAt(31, -5)).toBeDefined();
  });

  it('keeps a kerb down, photogrammetry noise and a bank falling 20 % on one side walkable', () => {
    // The mirror of the test above: right, a kerb 0.2 m down from 2 m off
    // the centre line, then a bank falling 0.2 m per metre.
    const noise = (x: number, z: number) => ((Math.floor(x / CELL) + Math.floor(z / CELL)) % 2 === 0 ? 0.1 : -0.1);
    const { grid, builds } = narrowed((x, z) => (z > 2 ? -0.2 - Math.max(0, z - 3) * 0.2 : noise(x, z)));

    expect(builds).toBe(0);
    expect(grid.unwalkableCells()).toEqual([]);
    expect(grid.getCellAt(31, 7)).toBeDefined();
    expect(grid.getCellAt(31, -5)).toBeDefined();
  });

  it('keeps a bank falling 15 % on one side of a diagonal street walkable', () => {
    const diagonal: Street = { a: { x: 0, z: 0 }, b: { x: 40, z: 40 }, left: 7, right: 7 };
    const { grid, builds } = narrowed((x, z) => -Math.max(0, (z - x) / Math.SQRT2) * 0.15, diagonal);

    expect(builds).toBe(0);
    expect(grid.unwalkableCells()).toEqual([]);
    expect(grid.getCellAt(15, 23)).toBeDefined();
  });

  /**
   * Playtest 2026-09-15, retest 605, Rothenburg ob der Tauber: on a street
   * across a slope the uphill side ended at the bank, but on the valley side
   * rows of cells stepped down the embankment into the vegetation. The walk
   * went down any drop. A road 6 m wide tilting 3 % towards the valley, the
   * embankment below it falling 1 in 1.5, the bank above it rising as much.
   */
  it('ends the corridor at the top of the embankment on the valley side of a street across a slope', () => {
    // The valley lies right of travel (+z).
    const terrace = (_x: number, z: number) => {
      const off = z - 1;
      if (off > 3) return -0.09 - (off - 3) / 1.5;
      if (off < -3) return 0.09 + (-off - 3) / 1.5;
      return -0.03 * off;
    };
    const { grid, route, builds } = narrowed(terrace);

    expect(builds).toBe(1);
    expect(grid.unwalkableCells()).toEqual([]);
    expect(grid.getCellAt(31, 3)).toBeDefined(); // the road, valley side
    expect(grid.getCellAt(31, 5)).toBeUndefined(); // 1 m down the embankment
    expect(grid.getCellAt(31, 7)).toBeUndefined();
    expect(grid.getCellAt(31, -1)).toBeDefined(); // the road, uphill side
    expect(grid.getCellAt(31, -3)).toBeUndefined(); // the bank, as before
    expect(positionsOutside(grid, route)).toEqual([]);
  });

  /**
   * Playtest 2026-09-15, 608, Erlenbach: beside a residential street the
   * corridor stepped down the embankment on the valley side in several rows
   * of cells, each about 0.5 to 1 m below the one before. The street level,
   * the gardens on the uphill side at street level (nothing to mirror), the
   * rows below it uneven as vegetation makes them.
   */
  const residential = (verge: number, below: number) => (x: number, z: number) => {
    const uneven = ((Math.floor(x / CELL) % 3) - 1) * 0.15;
    return z > 6 ? below + uneven : z > 4 ? verge + uneven : z < -2 ? 0.1 : 0;
  };

  it('ends the corridor at the edge of a residential street above an embankment', () => {
    // The first row 0.55 to 0.85 m below the street, the next 1.35 to 1.65 m.
    const { grid, route, builds } = narrowed(residential(-0.7, -1.5));

    expect(builds).toBe(1);
    expect(grid.unwalkableCells()).toEqual([]);
    for (let x = 1; x < 60; x += 2) {
      expect(grid.getCellAt(x, 3), `${x},3`).toBeDefined();
      expect(grid.getCellAt(x, 5), `${x},5`).toBeUndefined();
      expect(grid.getCellAt(x, 7), `${x},7`).toBeUndefined();
    }
    expect(grid.getCellAt(31, -5)).toBeDefined(); // the gardens uphill
    expect(positionsOutside(grid, route)).toEqual([]);
  });

  it('keeps one row of a verge less than a step below the street, not the embankment below it', () => {
    // The first row 0.15 to 0.45 m below the street, the next 0.8 m below that.
    const { grid, route } = narrowed(residential(-0.3, -1.1));

    expect(grid.unwalkableCells()).toEqual([]);
    expect(grid.getCellAt(31, 5)).toBeDefined();
    expect(grid.getCellAt(31, 7)).toBeUndefined();
    expect(positionsOutside(grid, route)).toEqual([]);
  });

  it('ends the corridor at a quay wall, not on the river below it', () => {
    // The river 4 m down from 3 m right of the centre line.
    const { grid, route } = narrowed((_x, z) => (z > 4 ? -4 : 0));

    expect(grid.unwalkableCells()).toEqual([]);
    expect(grid.getCellAt(31, 3)).toBeDefined();
    expect(grid.getCellAt(31, 5)).toBeUndefined();
    expect(positionsOutside(grid, route)).toEqual([]);
  });

  it('keeps a bank rising 15 % on one side of a diagonal street walkable', () => {
    // South-east along x = z: the walk out crosses the grid diagonally,
    // 0.42 m per spot on the bank right of travel (south-west).
    const diagonal: Street = { a: { x: 0, z: 0 }, b: { x: 40, z: 40 }, left: 7, right: 7 };
    const { grid, builds } = narrowed((x, z) => Math.max(0, (z - x) / Math.SQRT2) * 0.15, diagonal);

    expect(builds).toBe(0);
    expect(grid.unwalkableCells()).toEqual([]);
    expect(grid.getCellAt(15, 23)).toBeDefined();
  });

  /**
   * Playtest Erlenbach (Weinstraße, Erlenweg): single cells up in tree
   * crowns beside the street. A crown that also covers two centre line
   * spots in a row tipped the median of three spots onto the crown: the
   * cells beside it were measured against the crown and passed, and the
   * centre line cells stayed up in it. Irregular heights, as a crown gives.
   */
  it('ends the corridor before a tree crown and keeps the centre line under it on the street', () => {
    const crown = bySpot({
      '23,1': 6.8, '25,1': 7.9,
      '21,3': 3.2, '23,3': 6.1, '25,3': 8.2, '27,3': 5.4, '23,5': 4.0,
      '23,-1': 4.9, '25,-1': 7.0, '27,-1': 2.9,
    }, 0);
    const { grid, route, builds } = narrowed(crown);

    expect(builds).toBe(1);
    for (const [x, z] of [[21, 3], [23, 3], [25, 3], [27, 3], [23, 5], [23, -1], [25, -1], [27, -1]]) {
      expect(grid.getCellAt(x, z), `${x},${z}`).toBeUndefined();
    }
    expect(grid.getCellAt(23, 1)!.terrainHeight).toBe(0);
    expect(grid.getCellAt(25, 1)!.terrainHeight).toBe(0);
    expect(grid.getCellAt(11, 3)).toBeDefined();
    expect(positionsOutside(grid, route)).toEqual([]);
  });

  it('ends the corridor before a hedge with an uneven top, and the front garden behind it', () => {
    // Pavement 0.12 m, then a hedge 0.7 to 1.6 m from x 30 to 40, the
    // garden behind it at 0.15 m: the corridor is a band per side.
    const hedge = bySpot({ '31,5': 1.4, '33,5': 1.1, '35,5': 1.6, '37,5': 0.7, '39,5': 1.3 }, 0);
    const { grid, route } = narrowed((x, z) => (z > 2 && z < 4 ? 0.12 : z > 6 && x > 30 && x < 40 ? 0.15 : hedge(x, z)));

    expect(grid.unwalkableCells()).toEqual([]);
    for (const x of [31, 33, 35, 37, 39]) expect(grid.getCellAt(x, 5), `${x},5`).toBeUndefined();
    expect(grid.getCellAt(35, 7)).toBeUndefined();
    expect(grid.getCellAt(35, 3)).toBeDefined();
    expect(grid.getCellAt(15, 7)).toBeDefined();
    expect(positionsOutside(grid, route)).toEqual([]);
  });

  it('keeps the full corridor across a slope', () => {
    // Rising 0.4 m per metre southwards: 0.8 m from one cell to the next, more
    // than stepRise, and 2.4 m at the edge cells, less than roofRise.
    const { grid, route, builds } = narrowed((_x, z) => (z - 1) * 0.4);

    expect(builds).toBe(0);
    expect(grid.getCellAt(31, 7)).toBeDefined();
    expect(grid.getCellAt(31, -5)).toBeDefined();
    expect(positionsOutside(grid, route)).toEqual([]);
  });
});
