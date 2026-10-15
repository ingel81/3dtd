/**
 * The furniture of an OSM world (docs/OSM_WORLD_PLAN.md, phase O5,
 * Zuordnung: Ausstattung): fences, walls, hedges, retaining and city walls
 * and concrete road barriers along their lines, railway tracks, street
 * lamps (the mapped ones, and along lit roads where none are mapped), power
 * pylons and poles, benches, bins, bus stops, hydrants, bollards, fountains
 * and masts from their nodes.
 *
 * Every piece keeps off the roads (its middle outside the road's half width
 * plus a margin), the water, the building footprints and the HQ and
 * spawns. A bus stop or lamp mapped on the road moves to its edge. The
 * pieces of one line share a group (`osm-w<way id>`), the editor moves them
 * together. The pieces' scene cost is held to a share of the budget: past it
 * the lit-road lamps go first, then the points, then the tracks; the lines
 * go last.
 */
import { resample } from '../../../editor/ops/landscape/lines';
import { ObjectIds, objectsAlong, wallAlong, WALL_KITS, DEFAULT_LINE } from '../../../editor/ops/object-ops';
import { EdgeIndex } from '../../../editor/ops/path-graph';
import { hashCell } from '../../../editor/ops/landscape/landscape-noise';
import type { CustomMapDocument, MapObject, MapPoint } from '../../custom-map/map-document';
import { SCENE_BUDGET } from '../../custom-map/render/objects/scene-cost';
import { runs, type OsmFeatures } from '../osm-parse';
import { fillRings, sampleGrid } from './raster';
import type { WaterResult } from './water';

/** Share of the scene budget the furniture may take (plants 50 %, buildings for now without a cap) */
export const FURNITURE_BUDGET_SHARE = 0.15;

/** One straight piece of a line's model: its asset and the metres between two (a little under its length, they overlap) */
interface LinePiece {
  asset: string;
  spacing: number;
}

/** Line pieces of the catalogue; their length runs along model X, so they turn across the line */
const PIECES = {
  fenceWood: { asset: 'fence-wood', spacing: 3.8 },
  fenceRail: { asset: 'fence-rail', spacing: 3.8 },
  fencePicket: { asset: 'fence-picket', spacing: 3.6 },
  fenceChain: { asset: 'fence-chainlink', spacing: 3.6 },
  wall: { asset: 'wall-stone', spacing: 3.8 },
  wallDry: { asset: 'wall-dry-stone', spacing: 5.6 },
  retaining: { asset: 'retaining-wall', spacing: 5.4 },
  hedge: { asset: 'hedge-long', spacing: 6 },
  barrier: { asset: 'road-barrier', spacing: 1.4 },
  rail: { asset: 'rail-track', spacing: 10 },
} satisfies Record<string, LinePiece>;

/** Every asset the furniture may place, for the catalogue's costs (assetCosts) */
export const FURNITURE_ASSETS: readonly string[] = [
  ...Object.values(PIECES).map((p) => p.asset),
  ...WALL_KITS[0].pieces.map((p) => p.asset),
  WALL_KITS[0].corner,
  WALL_KITS[0].end,
  'street-lamp',
  'lamp-post',
  'power-pylon',
  'power-pole',
  'bench',
  'trash-can',
  'bus-stop',
  'hydrant',
  'bollards',
  'fountain',
  'antenna-mast',
  'watchtower',
];

/** The model of a `barrier` line, or null for one the map leaves out (kerbs, gates, guard rails: no model of a metal rail yet) */
export function barrierPiece(tags: Readonly<Record<string, string>>): LinePiece | null {
  switch (tags['barrier']) {
    case 'fence': {
      const type = tags['fence_type'] ?? '';
      if (/chain|metal|wire|mesh|bars|railing/.test(type)) return PIECES.fenceChain;
      if (/split_rail|rail|pole/.test(type)) return PIECES.fenceRail;
      if (/picket|pale/.test(type)) return PIECES.fencePicket;
      return PIECES.fenceWood;
    }
    case 'wall':
      return tags['wall'] === 'dry_stone' ? PIECES.wallDry : PIECES.wall;
    case 'retaining_wall':
      return PIECES.retaining;
    case 'hedge':
      return PIECES.hedge;
    case 'jersey_barrier':
      return PIECES.barrier;
    default:
      return null;
  }
}

/** Railway kinds that get a track (no disused, abandoned or platform lines) */
const TRACKS = new Set(['rail', 'light_rail', 'tram', 'narrow_gauge', 'subway', 'funicular']);

/** The model of a tagged point, or null */
export function pointAsset(tags: Readonly<Record<string, string>>): string | null {
  if (tags['highway'] === 'street_lamp') return LAMP;
  if (tags['highway'] === 'bus_stop') return 'bus-stop';
  if (tags['power'] === 'tower') return 'power-pylon';
  if (tags['power'] === 'pole') return 'power-pole';
  if (tags['emergency'] === 'fire_hydrant') return 'hydrant';
  if (tags['barrier'] === 'bollard') return 'bollards';
  switch (tags['amenity']) {
    case 'bench':
      return 'bench';
    case 'waste_basket':
      return 'trash-can';
    case 'fountain':
      return 'fountain';
  }
  if (tags['man_made'] === 'mast' || (tags['man_made'] === 'tower' && tags['tower:type'] === 'communication')) return 'antenna-mast';
  if (tags['man_made'] === 'tower' && /^(observation|watchtower|lookout)$/.test(tags['tower:type'] ?? '')) return 'watchtower';
  return null;
}

/** A lamp's stand-in until the place's mood picks the model (STREET_LAMPS) */
const LAMP = 'lamp';
/** The lamp of a city (a modern street lamp) and of a town or village (a lantern on a post, a fifteenth of the cost) */
const STREET_LAMPS = { city: 'street-lamp', town: 'lamp-post' } as const;

/** Points that stand beside the road when mapped on it */
const ROADSIDE = new Set([LAMP, 'bus-stop']);

/** Road types along which a lit road gets lamps */
const LIT_ROADS = new Set([
  'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service',
]);
/** Metres between the lamps of a lit road, and the nearest an added lamp stands to another */
const LAMP_SPACING = 32;
const LAMP_GAP = 18;
/** Metres a piece's middle keeps beyond a road's half width */
const ROAD_CLEAR = 0.4;
/** Metres a roadside point stands beyond the road's edge */
const ROADSIDE_OFFSET = 0.9;
/** Metres the furniture keeps from the HQ and from a spawn */
const HQ_CLEAR = 25;
const SPAWN_CLEAR = 10;

export interface FurnitureOptions {
  /** Scene cost of one object of an asset on this map */
  costOf: (asset: string) => number;
  /** Points the furniture may cost, default FURNITURE_BUDGET_SHARE of SCENE_BUDGET */
  budget?: number;
}

export interface FurnitureReport {
  /** Pieces placed by source (fence, wall, hedge, city wall, barrier, track, lamps, lit roads, the point kinds) */
  placed: Record<string, number>;
  objects: number;
  /** Pieces left out: on a road, in water or a building, by the HQ or a spawn, past the budget */
  dropped: { road: number; water: number; building: number; clearing: number; budget: number };
  cost: number;
  budget: number;
}

interface Candidate {
  o: Omit<MapObject, 'id'>;
  source: string;
  /** Lower goes first when the budget runs short */
  priority: number;
}

/**
 * The furniture of `features` placed on `doc` (after the roads, HQ, spawns
 * and buildings, before the plants): objects added to `doc.objects`
 */
export function placeFurniture(doc: CustomMapDocument, features: OsmFeatures, water: WaterResult, options: FurnitureOptions): FurnitureReport {
  const t = doc.terrain;
  const half = t.width / 2;
  const grid = sampleGrid(t.width, t.grid.cellSize);
  const n = grid.n;
  const seed = Math.round(features.frame.lat * 1e4) ^ Math.round(features.frame.lon * 1e4);
  const report: FurnitureReport = { placed: {}, objects: 0, dropped: { road: 0, water: 0, building: 0, clearing: 0, budget: 0 }, cost: 0, budget: 0 };
  const cell = (p: MapPoint) => {
    const i = Math.round((p.x - grid.origin) / grid.step);
    const j = Math.round((p.y - grid.origin) / grid.step);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i;
  };

  // Where nothing stands: the roads above ground, water, the building footprints, the HQ and spawns
  const roads = new EdgeIndex({ nodes: doc.paths.nodes, edges: doc.paths.edges.filter((e) => !e.tunnel) });
  const built = new Uint8Array(n * n);
  for (const a of features.areas) {
    if (a.tags['building']) fillRings([...a.outer, ...a.inner], grid, (i, j) => (built[j * n + i] = 1));
  }
  const clearings = [{ ...doc.hq, r: HQ_CLEAR }, ...doc.spawns.map((s) => ({ x: s.x, y: s.y, r: SPAWN_CLEAR }))];
  const onRoad = (p: MapPoint) => {
    const hit = roads.nearest(p, 16);
    return !!hit && hit.dist < hit.edge.width / 2 + ROAD_CLEAR;
  };
  const why = (p: MapPoint, inBuilding = true): keyof FurnitureReport['dropped'] | 'outside' | null => {
    if (Math.abs(p.x) > half - 1 || Math.abs(p.y) > half - 1) return 'outside';
    const k = cell(p);
    if (k < 0) return 'outside';
    if (water.wet[k] || water.sea[k]) return 'water';
    if (inBuilding && built[k]) return 'building';
    if (clearings.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < c.r)) return 'clearing';
    if (onRoad(p)) return 'road';
    return null;
  };

  const candidates: Candidate[] = [];
  // The pieces' ids are taken again when they are placed
  const ids = new ObjectIds([]);
  const still = () => 0;
  const keep = (pieces: readonly MapObject[], source: string, priority: number, group?: string, inBuilding = true) => {
    for (const { id: _, ...o } of pieces) {
      const no = why(o, inBuilding);
      if (no === 'outside') continue;
      if (no) report.dropped[no]++;
      else candidates.push({ o: group ? { ...o, group } : o, source, priority });
    }
  };

  // Lines: barriers, city walls, tracks
  const across = { ...DEFAULT_LINE, turn: 'across' as const };
  for (const w of features.ways) {
    const piece = barrierPiece(w.tags);
    const cityWall = w.tags['barrier'] === 'city_wall';
    const track = TRACKS.has(w.tags['railway'] ?? '') && !w.tags['tunnel'] && !w.tags['bridge'];
    if (!piece && !cityWall && !track) continue;
    // The pieces of one way move together in the editor
    const group = `osm-w${w.id}`;
    for (const raw of runs(w.points)) {
      if (raw.length < 2) continue;
      if (cityWall) {
        // The castle kit's wall: its pieces may stand where a building footprint touches it (gates, towers built in)
        keep(wallAlong(raw, WALL_KITS[0], { corners: 'blocks', front: 'left' }, ids), 'city wall', 0, group, false);
      } else if (track) {
        keep(objectsAlong(raw, PIECES.rail.asset, { ...across, spacing: PIECES.rail.spacing }, ids, still), 'track', 1, group);
      } else if (piece) {
        // A retaining wall's low side is on the right of its way (OSM): its face turns there
        const line = piece === PIECES.retaining ? [...raw].reverse() : raw;
        const source = w.tags['barrier'] === 'jersey_barrier' ? 'barrier' : w.tags['barrier'];
        keep(objectsAlong(line, piece.asset, { ...across, spacing: piece.spacing }, ids, still), source, 0, group);
      }
    }
  }

  // Points: turned to the nearest road, roadside ones moved to its edge
  const lamps: MapPoint[] = [];
  const lamp = doc.environment.biome === 'city' ? STREET_LAMPS.city : STREET_LAMPS.town;
  let powerLines: Map<number, number> | undefined;
  const facing = (p: MapPoint, toward: MapPoint) => wrap(Math.atan2(-(toward.x - p.x), toward.y - p.y));
  for (const pt of features.points) {
    const asset = pointAsset(pt.tags);
    if (!asset) continue;
    let p: MapPoint = { x: pt.x, y: pt.y };
    const hit = roads.nearest(p, 30);
    let rotation = hit && hit.dist > 0.01 ? facing(p, hit.point) : hashCell(pt.id % 1e6, 7, seed) * Math.PI * 2;
    if (ROADSIDE.has(asset) && hit && hit.dist < hit.edge.width / 2 + ROAD_CLEAR) {
      // On the road: to its edge, on the side the node lies (the right of the edge when on its line)
      const line = roads.polyline(hit.edge);
      const a = line[hit.segment];
      const b = line[hit.segment + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = (b.y - a.y) / len;
      const ny = -(b.x - a.x) / len;
      const side = (p.x - hit.point.x) * nx + (p.y - hit.point.y) * ny < 0 ? -1 : 1;
      const out = hit.edge.width / 2 + ROADSIDE_OFFSET;
      p = { x: hit.point.x + nx * side * out, y: hit.point.y + ny * side * out };
      rotation = facing(p, hit.point);
    }
    if (asset === 'power-pylon' || asset === 'power-pole') rotation = (powerLines ??= powerLineTurns(features)).get(pt.id) ?? rotation;
    if (asset === LAMP) lamps.push(p);
    keep([{ id: '', asset: asset === LAMP ? lamp : asset, x: round2(p.x), y: round2(p.y), z: 0, rotation: round3(rotation), scale: 1 }], asset === LAMP ? 'lamps' : asset, 2);
  }

  // Lit roads without mapped lamps: one every LAMP_SPACING on the right, none nearer than LAMP_GAP to another
  const lampCells = new Map<number, MapPoint[]>();
  const lampKey = (p: MapPoint) => Math.floor(p.x / LAMP_GAP) * 4096 + Math.floor(p.y / LAMP_GAP);
  const addLamp = (p: MapPoint) => {
    const key = lampKey(p);
    lampCells.set(key, [...(lampCells.get(key) ?? []), p]);
  };
  const lampNear = (p: MapPoint) => {
    const ci = Math.floor(p.x / LAMP_GAP);
    const cj = Math.floor(p.y / LAMP_GAP);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        if ((lampCells.get(i * 4096 + j) ?? []).some((q) => Math.hypot(q.x - p.x, q.y - p.y) < LAMP_GAP)) return true;
      }
    }
    return false;
  };
  lamps.forEach(addLamp);
  for (const w of features.ways) {
    if (w.tags['lit'] !== 'yes' || !LIT_ROADS.has(w.tags['highway'] ?? '') || w.tags['tunnel'] || w.tags['bridge']) continue;
    for (const raw of runs(w.points)) {
      const stops = resample(raw, LAMP_SPACING);
      for (let k = 1; k + 1 < stops.length; k++) {
        const hit = roads.nearest(stops[k], 4);
        if (!hit || hit.edge.kind === 'path') continue;
        const a = stops[k - 1];
        const b = stops[k + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const out = hit.edge.width / 2 + ROADSIDE_OFFSET;
        const p = { x: hit.point.x + ((b.y - a.y) / len) * out, y: hit.point.y - ((b.x - a.x) / len) * out };
        if (lampNear(p)) continue;
        addLamp(p);
        keep([{ id: '', asset: lamp, x: round2(p.x), y: round2(p.y), z: 0, rotation: round3(facing(p, hit.point)), scale: 1 }], 'lit roads', 3);
      }
    }
  }

  // The budget: by priority until the points run out
  const budget = options.budget ?? FURNITURE_BUDGET_SHARE * SCENE_BUDGET;
  candidates.sort((p, q) => p.priority - q.priority);
  const objectIds = new ObjectIds(doc.objects);
  let cost = 0;
  for (const c of candidates) {
    const add = options.costOf(c.o.asset);
    if (cost + add > budget) {
      report.dropped.budget++;
      continue;
    }
    cost += add;
    report.placed[c.source] = (report.placed[c.source] ?? 0) + 1;
    doc.objects.push({ id: objectIds.take(), ...c.o });
    report.objects++;
  }
  report.cost = Math.round(cost);
  report.budget = Math.round(budget);
  return report;
}

/** The turn of each pylon or pole on a power line: the line's direction there turned to north */
function powerLineTurns(features: OsmFeatures): Map<number, number> {
  const out = new Map<number, number>();
  for (const w of features.ways) {
    if (w.tags['power'] !== 'line' && w.tags['power'] !== 'minor_line') continue;
    w.nodes.forEach((node, k) => {
      const a = w.points[Math.max(0, k - 1)];
      const b = w.points[Math.min(w.points.length - 1, k + 1)];
      if (!a || !b || (a.x === b.x && a.y === b.y) || out.has(node)) return;
      out.set(node, wrap(Math.atan2(-(b.x - a.x), b.y - a.y)));
    });
  }
  return out;
}

const wrap = (r: number): number => ((r % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
