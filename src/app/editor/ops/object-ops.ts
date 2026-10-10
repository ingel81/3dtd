/**
 * Object placement: the scatter brush (density, random size and turn, a
 * minimum distance, sinking into slopes), its eraser, box selection, grid
 * snap and duplicates. Ids are `o<number>`, counted on from the highest.
 */
import type { CustomMapDocument, MapObject, MapPoint, MapTerrain } from '../../world/custom-map/map-document';
import { slopeAt, insideMap } from '../model/grid';
import { brushWeight, type BrushSettings } from './brush';

/** Hands out fresh object ids, starting past the highest in the map */
export class ObjectIds {
  private next: number;

  constructor(objects: readonly MapObject[]) {
    let max = 0;
    for (const o of objects) {
      const m = /^o(\d+)$/.exec(o.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    this.next = max + 1;
  }

  take(): string {
    return `o${this.next++}`;
  }
}

export interface ScatterOptions {
  /** Asset ids to pick from at random */
  assets: readonly string[];
  /** Objects per 1000 square metres at full strength */
  density: number;
  scaleMin: number;
  scaleMax: number;
  /** Turn each object at random */
  randomRotation: boolean;
  /** No two objects closer than this, metres */
  minDistance: number;
  /** Sink objects into slopes so they do not float on the low side */
  sinkOnSlope: boolean;
}

export const DEFAULT_SCATTER: ScatterOptions = {
  assets: [],
  density: 4,
  scaleMin: 0.8,
  scaleMax: 1.25,
  randomRotation: true,
  minDistance: 4,
  sinkOnSlope: true,
};

/** Grid of objects by cell for distance checks while scattering */
export class ObjectGrid {
  private readonly cells = new Map<number, MapPoint[]>();

  constructor(
    private readonly cell: number,
    objects: readonly MapPoint[] = [],
  ) {
    for (const o of objects) this.add(o);
  }

  add(p: MapPoint): void {
    const key = this.key(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell));
    let list = this.cells.get(key);
    if (!list) this.cells.set(key, (list = []));
    list.push(p);
  }

  /** True when some point lies closer than `d` */
  near(p: MapPoint, d: number): boolean {
    const ci = Math.floor(p.x / this.cell);
    const cj = Math.floor(p.y / this.cell);
    const r = Math.ceil(d / this.cell);
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        for (const q of this.cells.get(this.key(i, j)) ?? []) {
          if (Math.hypot(q.x - p.x, q.y - p.y) < d) return true;
        }
      }
    }
    return false;
  }

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }
}

/**
 * One dab of the scatter brush: tries `density * area` spots weighted by
 * the brush and keeps those far enough from every object. Returns the new
 * objects (not yet in the map).
 */
export function scatterDab(
  terrain: MapTerrain,
  center: MapPoint,
  brush: BrushSettings,
  options: ScatterOptions,
  grid: ObjectGrid,
  ids: ObjectIds,
  random: () => number,
  share = 1,
): MapObject[] {
  if (!options.assets.length) return [];
  const area = Math.PI * brush.radius * brush.radius;
  const tries = (options.density / 1000) * area * brush.strength * share;
  let n = Math.floor(tries);
  if (random() < tries - n) n++;
  const out: MapObject[] = [];
  for (let k = 0; k < n; k++) {
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(random()) * brush.radius;
    const p = { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r };
    if (random() > brushWeight(r, brush.radius, brush.falloff)) continue;
    if (!insideMap(terrain, p, 1)) continue;
    if (grid.near(p, options.minDistance)) continue;
    const scale = options.scaleMin + (options.scaleMax - options.scaleMin) * random();
    const slope = options.sinkOnSlope ? slopeAt(terrain, p.x, p.y) : 0;
    const object: MapObject = {
      id: ids.take(),
      asset: options.assets[Math.floor(random() * options.assets.length)],
      x: round(p.x),
      y: round(p.y),
      // About half a metre of sinking per 10 degrees, scaled with the object
      z: round(-Math.min(3, (slope / 10) * 0.5) * scale),
      rotation: options.randomRotation ? round(random() * Math.PI * 2, 1000) : 0,
      scale: round(scale, 1000),
    };
    grid.add(object);
    out.push(object);
  }
  return out;
}

/** Ids of objects under the brush (of the given assets, or any) */
export function objectsUnderBrush(doc: CustomMapDocument, center: MapPoint, radius: number, assets?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const o of doc.objects) {
    if (assets && assets.size && !assets.has(o.asset)) continue;
    if (Math.hypot(o.x - center.x, o.y - center.y) <= radius) out.push(o.id);
  }
  return out;
}

/** Ids of objects inside an axis-aligned box in map space */
export function objectsInBox(doc: CustomMapDocument, a: MapPoint, b: MapPoint): string[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return doc.objects.filter((o) => o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1).map((o) => o.id);
}

/** Copies of objects with fresh ids, moved by `offset` */
export function duplicateObjects(doc: CustomMapDocument, ids: readonly string[], offset: MapPoint): MapObject[] {
  const set = new Set(ids);
  const fresh = new ObjectIds(doc.objects);
  return doc.objects
    .filter((o) => set.has(o.id))
    .map((o) => ({ ...o, id: fresh.take(), x: round(o.x + offset.x), y: round(o.y + offset.y) }));
}

export function snapTo(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

/** Centre of a set of objects */
export function centroid(doc: CustomMapDocument, ids: readonly string[]): MapPoint | null {
  const set = new Set(ids);
  let x = 0;
  let y = 0;
  let n = 0;
  for (const o of doc.objects) {
    if (!set.has(o.id)) continue;
    x += o.x;
    y += o.y;
    n++;
  }
  return n ? { x: x / n, y: y / n } : null;
}

function round(v: number, f = 100): number {
  return Math.round(v * f) / f;
}
