/**
 * The lookups the buildings are placed with (buildings.ts): OSM entrances
 * on the outlines, road segments, the placed models' boxes, the buildings
 * around a spot and the land-use areas; a footprint's door and the doors
 * along a raised building's walls.
 */
import type { CustomMapDocument, MapPoint } from '../../custom-map/map-document';
import type { OsmArea, OsmFeatures } from '../osm-parse';
import { DOOR_CORNER, DOOR_WALL, ENTRANCE_RANKS, ENTRANCE_REACH, FRONT_REACH, NO_DOOR } from './building-config';
import { doorNodes, offDoors, pointSegmentDistance } from '../../../map-ops/path-graph';
import { insideRing, type TurnedRect } from '../../custom-map/map-surfaces';
import type { BuildingCatalogEntry, BuildingDoor, Footprint, Placement } from './building-types';
import { origin, placementAxes } from './building-placement';
import { toModel } from '../../custom-map/object-ground';
import { round2, round3 } from './geom';
import { ringArea } from '../square-clip';
import { PATH_WALL_SHARE } from '../../../map-ops/validation/map-validation';

interface Segment {
  a: MapPoint;
  b: MapPoint;
  /** Half the width that counts against buildings */
  half: number;
  road: boolean;
  /** Holds buildings off: not a square's outline (pulled off the walls, square-outlines.ts) */
  blocks: boolean;
}

/**
 * The map's path segments in a grid of cells, for the nearest street and the
 * roads near a building. A passage through a building (`covered`) is in
 * neither, but kept apart: where it runs along a building's wall instead of
 * through it, it holds that building off (coveredNear); a square's outline
 * (`area`) gives a front to face, nothing to keep off
 */
/** An entrance OSM maps (`entrance`): where, and how much it says (ENTRANCE_RANKS, 0 the main one) */
interface Entrance {
  p: MapPoint;
  rank: number;
}

/** The entrances of the points by 16 m cells: each building's (on its outline) found quickly */
export class EntranceIndex {
  private readonly cell = 16;
  private readonly cells = new Map<string, Entrance[]>();

  constructor(points: OsmFeatures['points']) {
    for (const pt of points) {
      const rank = ENTRANCE_RANKS[pt.tags['entrance'] ?? ''];
      if (rank === undefined) continue;
      const key = `${Math.floor(pt.x / this.cell)},${Math.floor(pt.y / this.cell)}`;
      const list = this.cells.get(key);
      const e = { p: { x: pt.x, y: pt.y }, rank };
      if (list) list.push(e);
      else this.cells.set(key, [e]);
    }
  }

  /** The entrance on an outline (within ENTRANCE_REACH), the main one first; null for none */
  on(ring: readonly MapPoint[]): MapPoint | null {
    if (!this.cells.size) return null;
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    let best: Entrance | null = null;
    for (let i = Math.floor((Math.min(...xs) - ENTRANCE_REACH) / this.cell); i <= Math.floor((Math.max(...xs) + ENTRANCE_REACH) / this.cell); i++) {
      for (let j = Math.floor((Math.min(...ys) - ENTRANCE_REACH) / this.cell); j <= Math.floor((Math.max(...ys) + ENTRANCE_REACH) / this.cell); j++) {
        for (const e of this.cells.get(`${i},${j}`) ?? []) {
          if (best && e.rank >= best.rank) continue;
          if (ringDistance(ring, e.p) <= ENTRANCE_REACH) best = e;
        }
      }
    }
    return best?.p ?? null;
  }
}

/** Distance from a point to a closed ring's edges */
function ringDistance(ring: readonly MapPoint[], p: MapPoint): number {
  let d = Infinity;
  for (let k = 0; k < ring.length; k++) d = Math.min(d, pointSegmentDistance(p, ring[k], ring[(k + 1) % ring.length]));
  return d;
}

/** How far a point lies outside a turned rectangle (0 inside) */
export function rectReach(rect: TurnedRect, p: MapPoint): number {
  const dx = p.x - rect.c.x;
  const dy = p.y - rect.c.y;
  const along = Math.abs(dx * rect.u.x + dy * rect.u.y) - rect.a / 2;
  const across = Math.abs(-dx * rect.u.y + dy * rect.u.x) - rect.b / 2;
  return Math.hypot(Math.max(0, along), Math.max(0, across));
}

/**
 * A footprint's door (BuildingDoor): its mapped entrance's, else the one
 * nearest the street, of its models (the catalogue's `doors`; the middle
 * of the front for a model without) or on the walls of its raised building,
 * whose MapMass.door it sets (the walls' middles that face out, DOOR_CORNER
 * off their corners). Null where nothing has one, or for a kind without a
 * door (NO_DOOR) where OSM maps none
 */
export function footprintDoor(f: Footprint, catalog: ReadonlyMap<string, BuildingCatalogEntry> | null, roads: SegmentIndex): BuildingDoor | null {
  if (!f.entrance && NO_DOOR.has(f.kind)) return null;
  const doors: { door: BuildingDoor; pl: Placement }[] = [];
  for (const pl of f.placements) {
    const { f: front, x } = placementAxes(pl);
    if (pl.mass) {
      for (const door of wallDoors(f.ring, f.entrance)) doors.push({ door, pl });
      continue;
    }
    const o = origin(pl);
    const own = catalog?.get(pl.asset)?.doors;
    if (!own?.length) {
      doors.push({ door: { x: pl.p.x + front.x * pl.hd, y: pl.p.y + front.y * pl.hd, nx: front.x, ny: front.y }, pl });
      continue;
    }
    for (const [dx, dz, side] of own) {
      const n = side === 'front' ? front : side === 'back' ? { x: -front.x, y: -front.y } : side === 'east' ? x : { x: -x.x, y: -x.y };
      doors.push({ door: { x: o.x + (dx * x.x + dz * front.x) * pl.scale, y: o.y + (dx * x.y + dz * front.y) * pl.scale, nx: n.x, ny: n.y }, pl });
    }
  }
  if (!doors.length) return null;
  const e = f.entrance;
  // At the entrance; else where a few metres out lies nearest a road
  const cost = (d: BuildingDoor) => (e ? Math.hypot(d.x - e.x, d.y - e.y) : roads.distance({ x: d.x + d.nx * 3, y: d.y + d.ny * 3 }, FRONT_REACH));
  let best = doors[0];
  for (const d of doors) if (cost(d.door) < cost(best.door)) best = d;
  const { door, pl } = best;
  if (pl.mass) {
    const o = origin(pl);
    const m = toModel(door.x - o.x, door.y - o.y, Math.cos(pl.rotation), Math.sin(pl.rotation));
    pl.mass.door = [round2(m.x / pl.scale), round2(m.z / pl.scale)];
  }
  return { x: round2(door.x), y: round2(door.y), nx: round3(door.nx), ny: round3(door.ny) };
}

/**
 * Where a raised building's door may be: on each wall of its outline long
 * enough, its middle and points DOOR_CORNER off its corners, facing out;
 * with a mapped entrance, there (on its wall) only
 */
function wallDoors(ring: readonly MapPoint[], entrance: MapPoint | null): BuildingDoor[] {
  const turn = ringArea(ring) > 0 ? 1 : -1;
  const out: BuildingDoor[] = [];
  let nearest: { door: BuildingDoor; d: number } | null = null;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < DOOR_WALL) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    // Outward: to the right of a counter-clockwise ring
    const nx = uy * turn;
    const ny = -ux * turn;
    if (entrance) {
      const s = Math.max(DOOR_CORNER, Math.min(len - DOOR_CORNER, (entrance.x - a.x) * ux + (entrance.y - a.y) * uy));
      const door = { x: a.x + ux * s, y: a.y + uy * s, nx, ny };
      const d = Math.hypot(door.x - entrance.x, door.y - entrance.y);
      if (!nearest || d < nearest.d) nearest = { door, d };
      continue;
    }
    for (const s of [DOOR_CORNER, len / 2, len - DOOR_CORNER]) out.push({ x: a.x + ux * s, y: a.y + uy * s, nx, ny });
  }
  return nearest ? [nearest.door] : out;
}

export class SegmentIndex {
  private readonly cell = 32;
  private readonly cells = new Map<number, Segment[]>();
  private readonly coveredCells = new Map<number, Segment[]>();

  constructor(doc: CustomMapDocument) {
    const nodes = new Map(doc.paths.nodes.map((nd) => [nd.id, nd]));
    const doors = doorNodes(doc.paths);
    for (const e of doc.paths.edges) {
      const a = nodes.get(e.a);
      const b = nodes.get(e.b);
      if (!a || !b) continue;
      const line = [a, ...(e.via ?? []), b];
      const half = (e.width / 2) * (e.kind === 'path' ? PATH_WALL_SHARE : 1);
      const cells = e.covered ? this.coveredCells : this.cells;
      for (let s = 0; s + 1 < line.length; s++) {
        // A way into a passage holds the building off only past its door (offDoors), as the editor's check sees it
        const piece = e.covered ? [line[s], line[s + 1]] : offDoors(line[s], line[s + 1], s === 0 && doors.has(e.a), s === line.length - 2 && doors.has(e.b), half);
        if (!piece) continue;
        const seg = { a: piece[0], b: piece[1], half, road: e.kind !== 'path', blocks: !e.area && !e.covered };
        const i0 = Math.floor(Math.min(seg.a.x, seg.b.x) / this.cell);
        const i1 = Math.floor(Math.max(seg.a.x, seg.b.x) / this.cell);
        const j0 = Math.floor(Math.min(seg.a.y, seg.b.y) / this.cell);
        const j1 = Math.floor(Math.max(seg.a.y, seg.b.y) / this.cell);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const key = this.key(i, j);
            let list = cells.get(key);
            if (!list) cells.set(key, (list = []));
            list.push(seg);
          }
        }
      }
    }
  }

  /** Pieces of covered ways (passages) whose cells come within `reach` of `p` */
  coveredNear(p: MapPoint, reach: number): Segment[] {
    const out = new Set<Segment>();
    const i0 = Math.floor((p.x - reach) / this.cell);
    const i1 = Math.floor((p.x + reach) / this.cell);
    const j0 = Math.floor((p.y - reach) / this.cell);
    const j1 = Math.floor((p.y + reach) / this.cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const s of this.coveredCells.get(this.key(i, j)) ?? []) out.add(s);
    return [...out];
  }

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  /** Segments that hold buildings off whose cells come within `reach` of `p` */
  blocking(p: MapPoint, reach: number): Segment[] {
    return this.near(p, reach).filter((s) => s.blocks);
  }

  /** Segments whose cells come within `reach` of `p` */
  near(p: MapPoint, reach: number): Segment[] {
    const out = new Set<Segment>();
    const i0 = Math.floor((p.x - reach) / this.cell);
    const i1 = Math.floor((p.x + reach) / this.cell);
    const j0 = Math.floor((p.y - reach) / this.cell);
    const j1 = Math.floor((p.y + reach) / this.cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const s of this.cells.get(this.key(i, j)) ?? []) out.add(s);
    return [...out];
  }

  /** Distance from `p` to the nearest road's edge (paths only where no road is within `reach`), Infinity past `reach` */
  distance(p: MapPoint, reach: number): number {
    let road = Infinity;
    let path = Infinity;
    for (const s of this.near(p, reach)) {
      const d = Math.max(0, pointSegmentDistance(p, s.a, s.b) - s.half);
      if (s.road) road = Math.min(road, d);
      else path = Math.min(path, d);
    }
    const best = road <= reach ? road : path;
    return best <= reach ? best : Infinity;
  }
}

/** Placements in a grid of cells by their middles, for what stands next to a point */
export class BoxIndex {
  private readonly cell = 32;
  private readonly cells = new Map<number, Placement[]>();
  private widest = 0;

  constructor(placements: readonly Placement[]) {
    for (const pl of placements) {
      const key = this.key(Math.floor(pl.p.x / this.cell), Math.floor(pl.p.y / this.cell));
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(pl);
      this.widest = Math.max(this.widest, Math.hypot(pl.hw, pl.hd));
    }
  }

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  /** Placements whose boxes may reach `p` */
  near(p: MapPoint): Placement[] {
    const r = Math.ceil(this.widest / this.cell);
    const ci = Math.floor(p.x / this.cell);
    const cj = Math.floor(p.y / this.cell);
    const out: Placement[] = [];
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) out.push(...(this.cells.get(this.key(i, j)) ?? []));
    return out;
  }
}

/** The footprints' middles and sizes in a grid of cells, for the median size of the buildings around a point */
export class AroundIndex {
  private readonly cell = 100;
  private readonly cells = new Map<number, number[]>();

  constructor(areas: readonly OsmArea[]) {
    for (const area of areas) {
      const c = ringMiddle(area.outer[0]);
      const key = this.key(Math.floor(c.x / this.cell), Math.floor(c.y / this.cell));
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(c.x, c.y, area.area);
    }
  }

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  /** Median footprint (m²) of the buildings within `reach` of `p`, null with fewer than five */
  median(p: MapPoint, reach: number): number | null {
    const sizes: number[] = [];
    const r = Math.ceil(reach / this.cell);
    const ci = Math.floor(p.x / this.cell);
    const cj = Math.floor(p.y / this.cell);
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 3) if (Math.hypot(list[k] - p.x, list[k + 1] - p.y) <= reach) sizes.push(list[k + 2]);
      }
    }
    if (sizes.length < 5) return null;
    sizes.sort((a, b) => a - b);
    return sizes[sizes.length >> 1];
  }
}

/** Mean of a ring's points */
export function ringMiddle(ring: readonly MapPoint[]): MapPoint {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / Math.max(1, ring.length), y: y / Math.max(1, ring.length) };
}

/** A small hash of an OSM id (ids pass 2^32) */
export function hashId(id: number): number {
  return Math.abs(Math.imul(id % 2147483647 | 0, 2654435761) >>> 0) % 1009;
}

/** Areas in a grid of cells by their bounds, for the area a point lies in (the smallest) */
export class AreaIndex {
  private readonly cell = 64;
  private readonly cells = new Map<number, OsmArea[]>();

  constructor(areas: readonly OsmArea[]) {
    for (const area of areas) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const r of area.outer) {
        for (const p of r) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
      for (let j = Math.floor(minY / this.cell); j <= Math.floor(maxY / this.cell); j++) {
        for (let i = Math.floor(minX / this.cell); i <= Math.floor(maxX / this.cell); i++) {
          const key = (i + 4096) * 8192 + (j + 4096);
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(area);
        }
      }
    }
  }

  at(p: MapPoint): OsmArea | null {
    let best: OsmArea | null = null;
    for (const area of this.cells.get((Math.floor(p.x / this.cell) + 4096) * 8192 + (Math.floor(p.y / this.cell) + 4096)) ?? []) {
      if (best && area.area >= best.area) continue;
      if (area.outer.some((r) => insideRing(p, r)) && !area.inner.some((r) => insideRing(p, r))) best = area;
    }
    return best;
  }

  /** The smallest outer ring a point lies in, its courtyards counted in */
  outerAt(p: MapPoint): readonly MapPoint[] | null {
    let best: readonly MapPoint[] | null = null;
    let bestArea = Infinity;
    for (const area of this.cells.get((Math.floor(p.x / this.cell) + 4096) * 8192 + (Math.floor(p.y / this.cell) + 4096)) ?? []) {
      for (const r of area.outer) {
        if (!insideRing(p, r)) continue;
        const a = Math.abs(ringArea(r));
        if (a < bestArea) {
          best = r;
          bestArea = a;
        }
      }
    }
    return best;
  }
}
