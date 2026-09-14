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

/** The street: eastbound along z = 1 from x = 0 to 60, so right of travel is +z; 2 m stations, no wall within 7 m. */
const LENGTH = 60;
const STATIONS = 30;
const CELL = 2;

/** Ground height of the photogrammetry at local (x, z); a car or an eave has no ground under it. */
type Ground = (x: number, z: number) => number;

const pieceAt = (pieces: readonly CorridorPiece[], t: number) => pieces.filter((p) => p.t <= t).pop()!;

/**
 * The street's grid once the corridor stays short of every cell no enemy
 * could walk to, the route it was built from and how many builds that took
 * after the first.
 */
function narrowed(ground: Ground): { grid: GlobalRouteGrid; route: RouteWaypoint[]; builds: number } {
  const column = (x: number, z: number): ColumnSample => ({ groundY: ground(x, z), topY: ground(x, z), tileDepth: 20, tileGeometricError: 2 });
  const free = new Array<number>(STATIONS).fill(7);
  const walk = { left: new Array<number>(STATIONS).fill(Infinity), right: new Array<number>(STATIONS).fill(Infinity) };
  for (let builds = 0; ; builds++) {
    const fitted = fitCorridorPieces([{ left: free, right: free, fallback: 2.75, onStreet: true, walkLeft: walk.left, walkRight: walk.right }]);
    const [pieces] = closeShortNarrowings(fitted, [LENGTH], [false]);
    const route = pieces.map((p) => at(p.t * LENGTH, 1, p.left, p.right));
    route.push(at(LENGTH, 1));
    const grid = new GlobalRouteGrid();
    grid.initialize(column as never, sync as never);
    grid.generateFromRoutes([route]);

    const widths = (side: 'left' | 'right') => Array.from({ length: STATIONS }, (_, k) => pieceAt(pieces, (k + 0.5) / STATIONS)[side]);
    const [caps] = walkCaps(
      [{ ax: 0, az: 1, bx: LENGTH, bz: 1, stations: STATIONS, left: widths('left'), right: widths('right') }],
      grid.unwalkableCells(),
      CELL,
    );
    let changed = false;
    for (const side of ['left', 'right'] as const) {
      for (let k = 0; k < STATIONS; k++) {
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
