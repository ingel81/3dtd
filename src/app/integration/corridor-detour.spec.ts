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

/** Where a scenario lies: its street network, the spawn on it and the HQ. */
interface Site {
  network: () => StreetNetwork;
  spawn: { lat: number; lon: number };
  hq: { lat: number; lon: number };
}

/**
 * A scenario: the ground, and how far the clearance rays reach either side
 * of the line (walls), `left` if not as far as `free`; `hole` where the mesh
 * has none (no hit at all). On the eastbound street unless `site` says else.
 */
interface Scene {
  ground: Ground;
  free: number;
  left?: number;
  hole?: (x: number, z: number) => boolean;
  site?: Site;
}

const columnsOf = (ground: Ground, hole?: (x: number, z: number) => boolean) => (x: number, z: number): ColumnSample | null =>
  hole?.(x, z) ? null : { groundY: ground(x, z), topY: ground(x, z), tileDepth: 20, tileGeometricError: 2 };

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

const STREET: Site = { network, spawn: SPAWN, hq: HQ };

/**
 * The route once nothing changes any more: measured, then built, grid,
 * walk and obstacle check, built again, as CorridorController.rebuildCorridors
 * does (more passes than its MAX_WALK_PASSES, to see where it settles).
 */
function settle(scene: Scene): { service: PathAndRouteService; grid: GlobalRouteGrid; route: RouteWaypoint[]; builds: number } {
  holder.grid = null;
  const site = scene.site ?? STREET;
  const spawn = { id: 's1', name: 'Spawn', color: 0xff0000, lat: site.spawn.lat, lon: site.spawn.lon };
  const engine = engineFor(scene);
  const service = new PathAndRouteService();
  service.initialize(engine, site.network(), site.hq, (() => false) as never, new OsmStreetService(), null);
  service.showPathFromSpawn(spawn);
  const run = service.beginClearanceMeasurement();
  run.step(Infinity);
  run.commit();

  const build = (): GlobalRouteGrid => {
    service.showPathFromSpawn(spawn);
    const grid = new GlobalRouteGrid();
    grid.initialize(columnsOf(scene.ground, scene.hole) as never, engine.sync as never);
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
  service.showPathFromSpawn(spawn);
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

/** Positions of `route`'s enemies without a cell under them, or on a cell higher than the street there (`street`) + 0.3 m. */
function offTheStreet(grid: GlobalRouteGrid, route: RouteWaypoint[], street: Ground = () => 0): string[] {
  const bad: string[] = [];
  for (const { factor, x, z } of walks(route)) {
    const cell = grid.getCellAt(x, z);
    if (!cell) bad.push(`factor ${factor} at ${x.toFixed(2)},${z.toFixed(2)}: no cell`);
    else if (cell.terrainHeight > street(x, z) + 0.3) bad.push(`factor ${factor} at ${x.toFixed(2)},${z.toFixed(2)}: ${cell.terrainHeight} up`);
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

/**
 * Playtest 719, Erlenbach, Erlenbacher Weg (way 959083801, residential), the
 * cell report of route spawn-1, in the local frame of its picks. The line
 * runs west-north-west along the south edge of a row of parked cars; left of
 * travel is south (+z). Centre line cells on the cars 0.56 to 1.19 m over the
 * line, between them the line near the street; behind the cars the rays find
 * a low obstacle raised 1.6 to 2.6 m. Left of the cars the corridor had
 * single missing cells on the street, (413, 25) and (413, 27) without any hit
 * of their column. The street: 225.07 m at (411, 23), 226.01 m at (391, 21).
 */
describe('Route along a row of parked cars with raised ground behind them (playtest 719)', () => {
  const SQRT10 = Math.sqrt(10);
  /** The street's line through the centre line cells (415, 21), (409, 19), (403, 17), (391, 13). */
  const lineZ = (x: number) => 21 + (x - 415) / 3;
  /** Metres right of travel (north-north-east) from the line. */
  const across = (x: number, z: number) => (x - 415 - 3 * (z - 21)) / SQRT10;
  /** x of the point of the line beside (x, z). */
  const footX = (x: number, z: number) => x - across(x, z) / SQRT10;
  const geoAt = (x: number, z: number) => ({ lat: ORIGIN.lat - z / METERS_PER_DEGREE_LAT, lon: ORIGIN.lon + x / M_PER_DEG_LON });
  // A node between the ends, as every street route needs one before the segment nearest to the HQ.
  const east = { id: 21, ...geoAt(450, lineZ(450)) };
  const middle = { id: 23, ...geoAt(405, lineZ(405)) };
  const west = { id: 22, ...geoAt(360, lineZ(360)) };
  const site: Site = {
    network: () => ({
      streets: [{ id: 959083801, name: 'Erlenbacher Weg', type: 'residential', nodes: [east, middle, west] }],
      nodes: new Map([[east.id, east], [middle.id, middle], [west.id, west]]),
      bounds: { minLat: 47.99, maxLat: 48.01, minLon: 8.99, maxLon: 9.01 },
    }),
    spawn: east,
    hq: geoAt(360, lineZ(360) - 12),
  };
  /** The street, 225.07 m at x = 411 and rising 4.7 % westward. */
  const street: Ground = (x, z) => 225.07 + (411 - footX(x, z)) * 0.047;
  /** Cars along the line (from and to, x of the line) and their roofs over the street, as the cells on them. */
  const CARS: readonly [number, number, number][] = [[412.2, 416.5, 1.0], [407.6, 410.2, 1.2], [399.2, 402.2, 1.4], [390, 394.3, 1.2]];
  const carAt = (x: number, z: number) => {
    const v = across(x, z);
    const f = footX(x, z);
    return v >= -0.2 && v <= 1.6 ? CARS.find(([a, b]) => f >= a && f <= b) ?? null : null;
  };
  const model: Ground = (x, z) => {
    const v = across(x, z);
    const f = footX(x, z);
    const s = street(x, z);
    const row = f >= 385 && f <= 425;
    // A garden or a wall behind the cars, the cars, the parking strip between them.
    if (row && v > 1.6) return s + 1.8;
    if (row && v >= -0.2) return s + (carAt(x, z)?.[2] ?? 0.1);
    // The street, front yards past it.
    return v < -5.5 ? s + 0.15 : s;
  };
  /**
   * The heights the cell report gave, by grid spot: the centre line cells on
   * the cars and between them (up to 0.6 m over the street beside them), and
   * the street cells the corridor lost. The model everywhere else.
   */
  const REPORTED: Record<string, number> = {
    '415,21': 225.71, '413,21': 226.08, '411,21': 225.31, '409,19': 226.4, '407,19': 225.81, '405,19': 225.89,
    '403,17': 225.59, '401,17': 226.94, '399,17': 225.71, '399,15': 226.52, '393,13': 227.24, '391,13': 227.01,
    '411,23': 225.07, '409,25': 225.07, '407,23': 225.15, '405,21': 225.29, '405,23': 225.28, '391,21': 226.01,
  };
  const centre = (v: number) => (Math.floor(v / 2) + 0.5) * 2;
  const ground: Ground = (x, z) => REPORTED[`${centre(x)},${centre(z)}`] ?? model(x, z);
  /** No hit at all in the cells (413, 25) and (413, 27), not even half a metre beside their centres. */
  const hole = (x: number, z: number) => Math.hypot(x - 413, z - 26) < 1.6;

  it('bends to the street and keeps the street beside the cars whole', () => {
    const { grid, route } = settle({ ground, free: 7, hole, site });

    // Beside the row the route runs 3.5 m left of the line: the reported
    // cells on the cars are 2 m squares reaching 1.9 m left of it, the first
    // street column lies 2 m out, and the path keeps 1.5 m clear of it.
    const beside = route.map((p) => toLocal(p)).filter((p) => footX(p.x, p.z) > 390 && footX(p.x, p.z) < 416);
    expect(beside.length).toBeGreaterThan(0);
    for (const p of beside) expect(across(p.x, p.z), `${p.x.toFixed(1)}`).toBeCloseTo(-3.5, 6);

    // Along the row: no cell on anything 0.5 m or more over the street (the
    // cars, the cells 0.6 m up beside them), none missing on the street left
    // of it. With planning off, as before the rule, 11 and 6.
    const raised: string[] = [];
    const missing: string[] = [];
    for (let x = 381; x <= 429; x += 2) {
      for (let z = 1; z <= 35; z += 2) {
        if (footX(x, z) <= 388 || footX(x, z) >= 418) continue;
        const rise = ground(x, z) - street(x, z);
        const v = across(x, z);
        if (v > -2.5 && v < 1.6 && rise >= 0.5 && grid.getCellAt(x, z)) raised.push(`${x},${z}`);
        if (v <= -1 && v >= -5.5 && rise <= 0.3 && !grid.getCellAt(x, z)) missing.push(`${x},${z}`);
      }
    }
    expect({ raised, missing }).toEqual({ raised: [], missing: [] });
    // The two cells without a column are there, as at a seam: (413, 25)
    // takes the height of its stable neighbours either side (fillGaps);
    // (413, 27) at the edge of the corridor has no such pair and stays
    // without a height of its own. Neither is judged, so neither narrows it.
    expect([grid.getCellAt(413, 25)?.sample.state, grid.getCellAt(413, 27)?.sample.state]).toEqual(['filled', 'unsampled']);
    expect(offTheStreet(grid, route, street).slice(0, 5)).toEqual([]);
    // The path passes (403.9, 21.0), 3.5 m left of the line: its cell is named.
    expect(grid.describeCellsAround(403, 21, 0.5, null)[0]).toMatchObject({ cell: true, walkCheck: 'detour' });
  });
});
