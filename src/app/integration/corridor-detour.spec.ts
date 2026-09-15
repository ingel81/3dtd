/**
 * Integration Test: the route bends round an obstacle on its centre line
 *
 * User decision 2026-09-15 (E6, retest 706 to 708): the OSM line of a
 * street runs over parked cars, a jetty, a roof corner; the 3D model counts.
 * With room beside it the enemies' way bends round it, without it an
 * obstacle over the lane is a passage and a low one is climbed. This runs
 * the chain CorridorController runs: PathAndRouteService builds the route
 * from the street network with the measured corridor, the grid is built
 * from it, the walk check and the obstacle check narrow and bend it, again
 * until nothing changes. Then enemies walk it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, Vector3 } from 'three';

// The route service's grid is a real grid, built in each test (rebuild()).
const holder = vi.hoisted(() => ({ grid: null as unknown }));

vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  const current = () => holder.grid as { getGroundLocalYAt(x: number, z: number): number | null } | null;
  const stubs: Record<string, unknown> = {
    DevWorldService: { isActive: false },
    UIStore: { routesVisible: () => false },
    PathfindingWorkerService: { isWorkerAvailable: false, dispose: () => undefined },
    GlobalRouteGridService: {
      isInitialized: () => holder.grid !== null,
      getGroundLocalYAt: (x: number, z: number) => current()?.getGroundLocalYAt(x, z) ?? null,
      getGrid: () => holder.grid,
    },
  };
  return { ...actual, inject: (token: { name?: string }) => stubs[token?.name ?? ''] ?? {} };
});

import { PathAndRouteService } from '../services/world/path-route.service';
import { OsmStreetService, StreetNetwork } from '../services/location/osm-street.service';
import { GlobalRouteGrid } from '../utils/global-route-grid';
import { GameObject } from '../core/game-object';
import { ComponentType } from '../core/component';
import { TransformComponent } from '../game-components/transform.component';
import { MovementComponent } from '../game-components/movement.component';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { rampLength } from '../utils/corridor-detour';
import { routeBodyStations } from '../utils/route-body';
import { wormPathOf } from '../managers/worm/worm-path';
import type { ThreeTilesEngine } from '../three-engine';
import type { ColumnSample } from '../three-engine/column-sample';
import type { StationProbe } from '../utils/route-corridor';
import type { RouteWaypoint } from '../models/game.types';

const ORIGIN = { lat: 48.0, lon: 9.0 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);

/** Local x (east) and z (south) of a geo point, as the engine's geoToLocalSimple below. */
const toLocal = (p: { lat: number; lon: number }) => ({
  x: (p.lon - ORIGIN.lon) * M_PER_DEG_LON,
  z: -(p.lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT,
});

/**
 * The street: eastbound along local z = LINE_Z, the centres of a row of
 * grid cells, from x = 0 to 120 with a node at 60. Right of travel is +z.
 */
const LINE_Z = -1;
const node = (id: number, x: number) => ({ id, lat: ORIGIN.lat - LINE_Z / METERS_PER_DEGREE_LAT, lon: ORIGIN.lon + x / M_PER_DEG_LON });
const SPAWN = node(0, 0);
/** 12 m north of the east end: the route ends in a leg off the street. */
const HQ = { lat: ORIGIN.lat + 13 / METERS_PER_DEGREE_LAT, lon: ORIGIN.lon + 120 / M_PER_DEG_LON };

function network(): StreetNetwork {
  const nodes = [node(1, 0), node(2, 60), node(3, 120)];
  return {
    streets: [{ id: 100, name: 'Way 100', type: 'residential', nodes }],
    nodes: new Map(nodes.map((n) => [n.id, n])),
    bounds: { minLat: 47.99, maxLat: 48.01, minLon: 8.99, maxLon: 9.01 },
  };
}

/** Ground height of the photogrammetry at local (x, z); a car, a jetty or a roof has no ground under it. */
type Ground = (x: number, z: number) => number;

/** A scenario: the ground, and how far the clearance rays reach either side of the line (walls), `left` if not as far as `free`. */
interface Scene {
  ground: Ground;
  free: number;
  left?: number;
}

const columnsOf = (ground: Ground) => (x: number, z: number): ColumnSample =>
  ({ groundY: ground(x, z), topY: ground(x, z), tileDepth: 20, tileGeometricError: 2 });

function engineFor(scene: Scene): ThreeTilesEngine {
  const overlay = new Group();
  return {
    getOverlayGroup: () => overlay,
    getTerrainHeightAtGeo: () => 0,
    terrain: {
      getStreetHeightEstimate: () => 0,
      measureStreetClearance: (_x: number, _z: number, _ax: number, _az: number, heights: readonly number[], max: number): StationProbe => {
        const right = Math.min(scene.free, max);
        const left = Math.min(scene.left ?? scene.free, max);
        return { unmeasured: null, tileError: 2, left: heights.map(() => left), right: heights.map(() => right) };
      },
    },
    sync: {
      getOrigin: () => ({ ...ORIGIN, height: 0 }),
      geoToLocalSimple: (lat: number, lon: number, h: number) => {
        const { x, z } = toLocal({ lat, lon });
        return new Vector3(x, h, z);
      },
    },
  } as unknown as ThreeTilesEngine;
}

const SPAWN_POINT = { id: 's1', name: 'Spawn', color: 0xff0000, lat: SPAWN.lat, lon: SPAWN.lon };

/**
 * The route once nothing changes any more: measured, then built, grid,
 * walk and obstacle check, built again, as CorridorController.rebuildCorridors
 * does (more passes than its MAX_WALK_PASSES, to see where it settles).
 */
function settle(scene: Scene): { service: PathAndRouteService; grid: GlobalRouteGrid; route: RouteWaypoint[]; builds: number } {
  holder.grid = null;
  const engine = engineFor(scene);
  const service = new PathAndRouteService();
  service.initialize(engine, network(), HQ, (() => false) as never, new OsmStreetService(), null);
  service.showPathFromSpawn(SPAWN_POINT);
  const run = service.beginClearanceMeasurement();
  run.step(Infinity);
  run.commit();

  const build = (): GlobalRouteGrid => {
    service.showPathFromSpawn(SPAWN_POINT);
    const grid = new GlobalRouteGrid();
    grid.initialize(columnsOf(scene.ground) as never, engine.sync as never);
    grid.generateFromRoutes([service.getCachedPath('s1')!]);
    holder.grid = grid;
    return grid;
  };
  let grid = build();
  let builds = 0;
  while (builds < 6 && service.narrowToWalkable()) {
    grid = build();
    builds++;
  }
  // The route line on the last grid's heights.
  service.showPathFromSpawn(SPAWN_POINT);
  return { service, grid, route: service.getCachedPath('s1')!, builds };
}

class Walker extends GameObject {
  constructor() {
    super('enemy');
    this.addComponent(new TransformComponent(this), ComponentType.TRANSFORM);
  }
}

/** Where enemies with each lateral factor walk `route`, local x, z, a sub-step apart. */
function walks(route: RouteWaypoint[]): { factor: number; x: number; z: number }[] {
  const found: { factor: number; x: number; z: number }[] = [];
  for (const factor of [-1, -0.6, 0, 0.3, 1]) {
    const walker = new Walker();
    const movement = new MovementComponent(walker);
    const transform = walker.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
    movement.setPath(route);
    movement.speedMps = 4;
    movement.setLateralFactor(factor);
    let steps = 0;
    while (movement.move(16.667, 0) === 'moving' && steps++ < 20000) found.push({ factor, ...toLocal(transform.position) });
  }
  return found;
}

/** Positions of `route`'s enemies without a cell under them, or on a cell higher than `street` + 0.3 m. */
function offTheStreet(grid: GlobalRouteGrid, route: RouteWaypoint[], street = 0): string[] {
  const bad: string[] = [];
  for (const { factor, x, z } of walks(route)) {
    const cell = grid.getCellAt(x, z);
    if (!cell) bad.push(`factor ${factor} at ${x.toFixed(2)},${z.toFixed(2)}: no cell`);
    else if (cell.terrainHeight > street + 0.3) bad.push(`factor ${factor} at ${x.toFixed(2)},${z.toFixed(2)}: ${cell.terrainHeight} up`);
  }
  return bad;
}

/** Offset of each waypoint of the route on the street from the street's line, + right of travel (south). */
const offsets = (route: RouteWaypoint[]) => route.map((p) => toLocal(p)).filter((p) => p.x > 1 && p.x < 119).map((p) => p.z - LINE_Z);

/** Largest turn between two neighbouring segments of the route, degrees. */
function sharpestTurn(route: RouteWaypoint[]): number {
  const local = route.map((p) => toLocal(p));
  let worst = 0;
  for (let i = 1; i < local.length - 1; i++) {
    const a = Math.atan2(local[i].z - local[i - 1].z, local[i].x - local[i - 1].x);
    const b = Math.atan2(local[i + 1].z - local[i].z, local[i + 1].x - local[i].x);
    if (local[i].x > 118) continue; // the turn onto the leg to the HQ
    let turn = Math.abs(b - a);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    worst = Math.max(worst, (turn * 180) / Math.PI);
  }
  return worst;
}

/** A parked car 4.5 m long from x = 55, 1.8 m wide on the line, 1.5 m high. */
const onCar = (x: number, z: number) => x >= 55 && x <= 59.5 && Math.abs(z - LINE_Z) < 0.9;

describe('Route round an obstacle on its centre line', () => {
  beforeEach(() => {
    holder.grid = null;
  });

  it('bends round a car on the centre line where the street leaves room, smoothly and on the street', () => {
    const { service, grid, route } = settle({ ground: (x, z) => (onCar(x, z) ? 1.5 : 0), free: 7 });

    // Beside the car: 2.5 m to the right, the smallest offset that keeps
    // the cells the path touches off it; nowhere else.
    const off = offsets(route);
    expect(Math.max(...off)).toBeCloseTo(2.5, 6);
    expect(Math.min(...off)).toBeGreaterThanOrEqual(-1e-6);
    const beside = route.filter((p) => toLocal(p).x > 54 && toLocal(p).x < 61);
    expect(beside.length).toBeGreaterThan(0);
    for (const p of beside) expect(toLocal(p).z - LINE_Z).toBeCloseTo(2.5, 6);
    // Ramps as gentle as the worm bends: its turns stay small.
    expect(sharpestTurn(route)).toBeLessThan(6);
    expect(route.filter((p) => p.detour).length).toBeGreaterThan(2 * Math.floor(rampLength(2.5)) - 4);

    // No cell on the car, every enemy on a cell on the street.
    for (let x = 55; x <= 59; x += 2) expect(grid.getCellAt(x, LINE_Z), `${x}`).toBeUndefined();
    expect(offTheStreet(grid, route).slice(0, 5)).toEqual([]);
    // The red line runs at street height (its waypoints take the cells' heights).
    expect(Math.max(...route.map((p) => p.height ?? 0))).toBeLessThan(0.3);

    // __corridor.pick(): the path's cells are named, the station knows how far it is moved.
    // The cell whose centre is 2 m right of the street's line, 0.5 m left of the path.
    const [row] = grid.describeCellsAround(57, LINE_Z + 2, 0.5, null);
    expect(row).toMatchObject({ cell: true, walkCheck: 'detour' });
    expect(service.explainCorridorAt(57, LINE_Z + 2.5)).toMatchObject({ detourM: 2.5, passage: false });
  });

  it('carries the ooze band and the worm round the car without a kink', () => {
    const { route } = settle({ ground: (x, z) => (onCar(x, z) ? 1.5 : 0), free: 7 });
    // The band turns across the route no more than a few degrees from one station to the next.
    const sync = { geoToLocalSimpleInto: (lat: number, lon: number, h: number, out: Vector3) => out.set(toLocal({ lat, lon }).x, h, toLocal({ lat, lon }).z) };
    const stations = routeBodyStations(route, sync as never, 0);
    let worst = 0;
    for (let k = 1; k < stations.count; k++) {
      if (stations.x[k] > 110) break; // the turn onto the leg to the HQ
      const dot = stations.rightX[k] * stations.rightX[k - 1] + stations.rightZ[k] * stations.rightZ[k - 1];
      worst = Math.max(worst, (Math.acos(Math.min(1, dot)) * 180) / Math.PI);
    }
    expect(worst).toBeLessThan(8);
    // The worm rounds the ramps' waypoints with arcs where the corridor
    // leaves room on the inner side; beside the car it has none and they
    // stay sharp, a few degrees each (worm-detour.spec.ts walks it).
    const worm = wormPathOf(route);
    const arcs = route.filter((p, k) => p.detour && worm.radiusAt(k) > 0).length;
    expect(arcs).toBeGreaterThan(0);
  });

  it('lets enemies climb over a car that fills a narrow lane', () => {
    // Houses 2 m either side of the line, 8 m up.
    const lane: Ground = (x, z) => (Math.abs(z - LINE_Z) >= 2 ? 8 : onCar(x, z) ? 1.5 : 0);
    const { grid, route } = settle({ ground: lane, free: 2 });

    expect(route.some((p) => p.detour || p.passage)).toBe(false);
    // The model shows the car there: its cells stay on it.
    expect(grid.getCellAt(57, LINE_Z)!.terrainHeight).toBe(1.5);
    expect(grid.describeCellsAround(57, LINE_Z, 0.5, null)[0].walkCheck).toBe('centre line');
  });

  it('runs a passage under a jetty the mesh fills down to a narrow lane', () => {
    const jetty: Ground = (x, z) => (Math.abs(z - LINE_Z) >= 2 ? 8 : x >= 55.5 && x <= 58.5 ? 5 : 0);
    const { service, grid, route } = settle({ ground: jetty, free: 2 });

    const under = route.filter((p) => p.passage);
    expect(under.length).toBeGreaterThan(0);
    expect(under.every((p) => p.inTunnel)).toBe(true);
    // At street height between its portals, yellow in the overlay, named in pick().
    for (const x of [55, 57, 59]) {
      expect(grid.getCellAt(x, LINE_Z), `${x}`).toMatchObject({ surface: 'tunnel' });
      expect(grid.getCellAt(x, LINE_Z)!.terrainHeight, `${x}`).toBeCloseTo(0, 6);
    }
    expect(grid.describeCellsAround(57, LINE_Z, 0.5, null)[0].walkCheck).toBe('passage');
    expect(service.explainCorridorAt(57, LINE_Z)).toMatchObject({ passage: true, inTunnel: true, unmeasured: 'passage: not measured' });
    expect(route.some((p) => p.detour)).toBe(false);
  });

  it('bends round a roof corner over the line where the street leaves room', () => {
    // Houses from 3 m left of the line (north) along the street, the leg to
    // the HQ past them; a corner of one reaching 0.8 m past the line, 8 m up.
    const houses = (x: number, z: number) => x < 115 && z <= LINE_Z - 3;
    const corner = (x: number, z: number) => x >= 55.5 && x <= 58.5 && z < LINE_Z + 0.8;
    const { grid, route } = settle({ ground: (x, z) => (houses(x, z) || corner(x, z) ? 8 : 0), free: 7, left: 3 });

    expect(Math.max(...offsets(route))).toBeCloseTo(2.5, 6);
    // The one cell on the line whose centre lies under the corner is gone.
    expect(grid.getCellAt(57, LINE_Z)).toBeUndefined();
    expect(offTheStreet(grid, route).slice(0, 5)).toEqual([]);
  });

  it('keeps a street with a car at its edge on its line', () => {
    const edge = (x: number, z: number) => x >= 55 && x <= 59.5 && z > LINE_Z + 2.5 && z < LINE_Z + 4.3;
    const { route } = settle({ ground: (x, z) => (edge(x, z) ? 1.5 : 0), free: 7 });
    expect(offsets(route).every((o) => Math.abs(o) < 1e-6)).toBe(true);
  });
});
