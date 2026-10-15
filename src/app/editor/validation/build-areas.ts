/**
 * Where a player may build a tower on the map, by the game's own rules: the
 * placement rules of the build preview (checkTowerPlacement: HQ, spawns,
 * the enemy routes), the map's water and the objects that forbid building
 * (CustomMapSurface.buildBlocker with PLACEMENT_CONFIG.TOWER_BUILD_RADIUS),
 * and the ground under the footprint (resolveTowerFootprint: a wall or a
 * drop under the centre or the inner ring). Each cell of a raster is
 * judged at its middle, as if the archer stood there. A buildable cell is
 * "in reach" when the route lies within a typical tower's range of it.
 *
 * For the editor's overlay (Measure, "Build areas") and the map check (the
 * room for towers along each lane). A few hundred ms on a large map: the
 * editor runs it in a worker (`buildAreasOffThread`).
 */
import { PLACEMENT_CONFIG } from '../../configs/placement.config';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { checkTowerPlacement, type TowerPlacementContext } from '../../utils/tower-placement-rules';
import { footprintSampleOffsets, footprintSurroundingOffsets, resolveTowerFootprint } from '../../utils/tower-footprint';
import { CustomMapFrame, CustomMapSurface } from '../../world/custom-map/custom-map-surface';
import {
  MAP_METERS_PER_DEGREE,
  type CustomMapDocument,
  type MapObject,
  type MapPoint,
} from '../../world/custom-map/map-document';
import { BUILD_BLOCKED_OBJECT, BUILD_BLOCKED_WATER } from '../../world/world-provider';

/** What a cell is: a tower may stand there (in reach of a route or not), or why not */
export const BuildCell = {
  Outside: 0,
  InReach: 1,
  OutOfReach: 2,
  Water: 3,
  Object: 4,
  Steep: 5,
  Route: 6,
  Marker: 7,
} as const;
export type BuildCell = (typeof BuildCell)[keyof typeof BuildCell];

/** The tower the raster is judged for: the archer, the first one anyone builds */
const PROBE_TOWER = TOWER_TYPES.archer;

/** A typical tower's range: the median base range of the towers that shoot (60 m) */
export const TYPICAL_TOWER_RANGE = (() => {
  const ranges = Object.values(TOWER_TYPES).map((t) => t.range).filter((r) => r > 0).sort((a, b) => a - b);
  return ranges[Math.floor(ranges.length / 2)] ?? 50;
})();

/** Ground one tower takes at the least spacing the game allows (MIN_DISTANCE_TO_OTHER_TOWER squared), m² */
export const TOWER_SPOT_M2 = PLACEMENT_CONFIG.MIN_DISTANCE_TO_OTHER_TOWER ** 2;

/** The raster: cells of `cell` metres from the map's south-west corner (x0, y0), row by row from the south */
export interface BuildAreas {
  cell: number;
  columns: number;
  rows: number;
  x0: number;
  y0: number;
  /** BuildCell per cell */
  kind: Uint8Array;
  /** Buildable area in reach of each lane's route, m² (a cell near two routes counts for both); `routed` false without a route */
  lanes: { spawnId: string; name: string; area: number; routed: boolean }[];
  /** Buildable area in reach of any route, and buildable in all, m² */
  inReach: number;
  buildable: number;
}

/** What the computation needs of the map: the ground, water, roads (bridge decks), blocking objects, markers, routes */
export interface BuildAreaInput {
  doc: Pick<CustomMapDocument, 'terrain' | 'paths' | 'spawns' | 'hq'> & { objects: MapObject[] };
  /** The catalogue's footprint radius, ground rectangle and build flag of the assets the objects use */
  catalog: { id: string; footprint: number; box?: readonly [number, number, number, number]; blocksBuild: boolean }[];
  /** Each lane's route from its spawn to the HQ, null where it has none */
  routes: { spawnId: string; name: string; points: MapPoint[] | null }[];
  /** Cell size, m; by default the map's longer side over 512, at least 4 */
  cell?: number;
}

/** The cell size for a map: about 512 cells along the longer side, never finer than 4 m */
export function buildAreaCell(width: number, depth: number): number {
  return Math.max(4, Math.ceil(Math.max(width, depth) / 512));
}

export function computeBuildAreas(input: BuildAreaInput): BuildAreas {
  const { doc } = input;
  const t = doc.terrain;
  const cell = input.cell ?? buildAreaCell(t.width, t.depth);
  const columns = Math.max(1, Math.floor(t.width / cell));
  const rows = Math.max(1, Math.floor(t.depth / cell));
  const x0 = -t.width / 2 + (t.width - columns * cell) / 2;
  const y0 = -t.depth / 2 + (t.depth - rows * cell) / 2;

  // The game's surface of this map, its frame at the map's middle (scene x = -map x, z = map y)
  const frame = new CustomMapFrame();
  const surface = new CustomMapSurface(doc as CustomMapDocument, frame);
  surface.setObjectCatalog(input.catalog);
  const geo = (p: MapPoint) => ({ lat: p.y / MAP_METERS_PER_DEGREE, lon: p.x / MAP_METERS_PER_DEGREE });
  const M = MAP_METERS_PER_DEGREE;
  const ctx: TowerPlacementContext = {
    bounds: { minLat: -t.depth / 2 / M, maxLat: t.depth / 2 / M, minLon: -t.width / 2 / M, maxLon: t.width / 2 / M },
    base: geo(doc.hq),
    spawns: doc.spawns.map(geo),
    towers: [],
    // The route rule is checked against the raster of distances below, the same limit
    routes: [],
    // The synthetic frame lies at the equator: degrees are metres over MAP_METERS_PER_DEGREE
    geo: { haversineDistance: (la1, lo1, la2, lo2) => Math.hypot(la2 - la1, lo2 - lo1) * M },
    blocked: (lat, lon) => surface.buildBlocker(lat, lon, PLACEMENT_CONFIG.TOWER_BUILD_RADIUS),
  };

  const near = new RouteNear(input.routes.map((r) => r.points), TYPICAL_TOWER_RANGE, x0, y0, columns * cell, rows * cell);
  const radius = PROBE_TOWER.footprintRadius;
  const offsets = footprintSampleOffsets(radius);
  const around = footprintSurroundingOffsets(radius);
  const kind = new Uint8Array(columns * rows);
  const laneCells = new Array<number>(input.routes.length).fill(0);
  let inReach = 0;
  let buildable = 0;
  const dist = new Float64Array(input.routes.length);
  for (let j = 0; j < rows; j++) {
    const y = y0 + (j + 0.5) * cell;
    for (let i = 0; i < columns; i++) {
      const x = x0 + (i + 0.5) * cell;
      const nearest = near.distances(x, y, dist);
      let k: BuildCell;
      // The game's order: play area, HQ, spawns, then the route, then the world's blockers, then the ground
      const rules = checkTowerPlacement(y / M, x / M, ctx);
      const refused = rules.valid ? null : reasonCell(rules.reason);
      if (refused === BuildCell.Outside || refused === BuildCell.Marker) k = refused;
      else if (nearest < PLACEMENT_CONFIG.MIN_DISTANCE_TO_ROUTE) k = BuildCell.Route;
      else if (refused !== null) k = refused;
      else {
        // The ground under the footprint, probed as the build preview does (scene offsets dx, dz)
        const sx = frame.sceneX(x);
        const sz = frame.sceneZ(y);
        const columnsAt = (list: readonly (readonly [number, number])[]) => list.map(([dx, dz]) => surface.footprintColumn(sx + dx, sz + dz));
        const footprint = resolveTowerFootprint(surface.heightAtMap(x, y), radius, columnsAt(offsets), () => columnsAt(around));
        if (footprint.refusal) k = BuildCell.Steep;
        else k = nearest <= TYPICAL_TOWER_RANGE ? BuildCell.InReach : BuildCell.OutOfReach;
      }
      kind[j * columns + i] = k;
      if (k === BuildCell.InReach || k === BuildCell.OutOfReach) buildable++;
      if (k === BuildCell.InReach) {
        inReach++;
        for (let r = 0; r < dist.length; r++) if (dist[r] <= TYPICAL_TOWER_RANGE) laneCells[r]++;
      }
    }
  }
  const area = cell * cell;
  return {
    cell, columns, rows, x0, y0, kind,
    lanes: input.routes.map((r, n) => ({ spawnId: r.spawnId, name: r.name, area: laneCells[n] * area, routed: !!r.points?.length })),
    inReach: inReach * area,
    buildable: buildable * area,
  };
}

/** The cell a refusal of the placement rules makes */
function reasonCell(reason: string | undefined): BuildCell {
  switch (reason) {
    case BUILD_BLOCKED_WATER: return BuildCell.Water;
    case BUILD_BLOCKED_OBJECT: return BuildCell.Object;
    case 'Too close to HQ':
    case 'Too close to spawn': return BuildCell.Marker;
    default: return BuildCell.Outside;
  }
}

/**
 * Distance from a point to each route, within `reach` (Infinity beyond): the
 * routes' segments in 32 m buckets, each segment in every bucket its reach
 * touches.
 */
class RouteNear {
  private static readonly BUCKET = 32;
  private readonly cols: number;
  private readonly rows: number;
  /** Per bucket: route index and the segment's ends, five numbers each */
  private readonly buckets: (number[] | undefined)[];

  constructor(routes: (MapPoint[] | null)[], private readonly reach: number, private readonly x0: number, private readonly y0: number, width: number, depth: number) {
    const b = RouteNear.BUCKET;
    this.cols = Math.max(1, Math.ceil(width / b));
    this.rows = Math.max(1, Math.ceil(depth / b));
    this.buckets = new Array(this.cols * this.rows);
    routes.forEach((points, r) => {
      if (!points) return;
      for (let k = 1; k < points.length; k++) {
        const a = points[k - 1];
        const c = points[k];
        const i0 = this.col(Math.min(a.x, c.x) - reach);
        const i1 = this.col(Math.max(a.x, c.x) + reach);
        const j0 = this.row(Math.min(a.y, c.y) - reach);
        const j1 = this.row(Math.max(a.y, c.y) + reach);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) (this.buckets[j * this.cols + i] ??= []).push(r, a.x, a.y, c.x, c.y);
        }
      }
    });
  }

  /** Fills `out` with the distance to each route (Infinity beyond the reach); returns the least */
  distances(x: number, y: number, out: Float64Array): number {
    out.fill(Infinity);
    const list = this.buckets[this.row(y) * this.cols + this.col(x)];
    let least = Infinity;
    if (!list) return least;
    for (let k = 0; k < list.length; k += 5) {
      const d = segmentDistance(x, y, list[k + 1], list[k + 2], list[k + 3], list[k + 4]);
      if (d > this.reach) continue;
      const r = list[k];
      if (d < out[r]) out[r] = d;
      if (d < least) least = d;
    }
    return least;
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.x0) / RouteNear.BUCKET)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.y0) / RouteNear.BUCKET)));
  }
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const u = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(ax + dx * u - px, ay + dy * u - py);
}

/** The input for the worker: copies of the arrays, the objects that may block only */
export function buildAreaInput(
  doc: CustomMapDocument,
  catalog: (asset: string) => { radius: number; box?: readonly [number, number, number, number]; blocksBuild: boolean },
  routes: BuildAreaInput['routes'],
): BuildAreaInput {
  const t = doc.terrain;
  const objects = doc.objects
    .filter((o) => o.blocksBuild ?? catalog(o.asset).blocksBuild)
    .map((o) => ({ id: o.id, asset: o.asset, x: o.x, y: o.y, z: 0, rotation: o.rotation, scale: o.scale, blocksBuild: true }));
  const assets = [...new Set(objects.map((o) => o.asset))];
  return {
    doc: {
      terrain: {
        ...t,
        grid: { ...t.grid, heights: t.grid.heights.slice() },
        // The worker reads levels and masks only
        splat: { resolution: 1, maps: [new Uint8Array(0), new Uint8Array(0)] },
        water: t.water ? { ...t.water, mask: t.water.mask.slice() } : null,
        waterBodies: t.waterBodies?.map((w) => ({ ...w, mask: w.mask.slice() })),
      },
      paths: doc.paths,
      spawns: doc.spawns,
      hq: doc.hq,
      objects,
    },
    catalog: assets.map((id) => ({ id, footprint: catalog(id).radius, box: catalog(id).box, blocksBuild: true })),
    routes,
  };
}

/** computeBuildAreas in a worker; in place where there are no workers (specs) */
export function buildAreasOffThread(input: BuildAreaInput): Promise<BuildAreas> {
  if (typeof Worker === 'undefined') return Promise.resolve(computeBuildAreas(input));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/build-areas.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<BuildAreas | { error: string }>) => {
      worker.terminate();
      if ('error' in e.data) reject(new Error(e.data.error));
      else resolve(e.data);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'The build area worker failed'));
    };
    const t = input.doc.terrain;
    const transfer: Transferable[] = [t.grid.heights.buffer];
    if (t.water) transfer.push(t.water.mask.buffer);
    for (const w of t.waterBodies ?? []) transfer.push(w.mask.buffer);
    worker.postMessage(input, transfer);
  });
}
