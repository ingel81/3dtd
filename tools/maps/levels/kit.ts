/**
 * The level kit: builds a shipped map in code with the editor's own
 * operations (`MapKit`, src/app/editor/ops/map-kit.ts), on a new map of the
 * level's size and seed with the renderer's catalogue. A landscape call is
 * one stroke of the Landscape tool, one step in the editor's history.
 *
 * Order that works: ground shape (generator, forms, cliffs), rivers, roads,
 * spawns and HQ, then biomes and paint (they leave roads and markers alone),
 * then single objects.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogIndex, normalizeCatalog } from '../../../src/app/editor/catalog/asset-catalog';
import { MapKit } from '../../../src/app/editor/ops/map-kit';
import { EdgeIndex } from '../../../src/app/map-ops/path-graph';
import { objectsOnPaths } from '../../../src/app/editor/validation/map-validation';
import { createMapDocument } from '../../../src/app/world/custom-map/map-create';
import type { CustomMapDocument, MapObject, MapPoint } from '../../../src/app/world/custom-map/map-document';

export { facing } from '../../../src/app/editor/ops/map-kit';

/**
 * Ground layers a level may hold while it is built: the levels were made and
 * tuned when maps had at most 8, and their brushes fall back to a material
 * already there once the list is full; more would change every level
 */
const LEVEL_LAYERS = 8;

const CATALOG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/maps/assets/catalog.json');

let sharedCatalog: CatalogIndex | null = null;

/** The renderer's asset catalogue as the editor indexes it */
export function levelCatalog(): CatalogIndex {
  sharedCatalog ??= new CatalogIndex(normalizeCatalog(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')), 'http://localhost/maps/assets/'));
  return sharedCatalog;
}

/** Shipped levels carry a fixed date so packing them stays byte for byte the same */
const SHIPPED_DATE = new Date('2026-10-11T00:00:00.000Z');

export interface LevelSpec {
  id: string;
  name: string;
  description: string;
  /** Square side in metres (512 Small, 1024 Medium) */
  size: number;
  /** Metres between height samples (default 2) */
  cell?: number;
  /** Splat texels per side (default one per metre, at most 1024) */
  splat?: number;
  /** Material of layer 0 */
  base: string;
  seed: number;
}

export class LevelKit extends MapKit {
  /** A new map of the spec's size, or `base` (a map made otherwise, the demo valley) to build on */
  constructor(
    readonly spec: LevelSpec,
    base?: CustomMapDocument,
  ) {
    const doc = base ?? createMapDocument({
      id: spec.id,
      name: spec.name,
      author: '3DTD',
      description: spec.description,
      width: spec.size,
      depth: spec.size,
      cellSize: spec.cell ?? 2,
      baseMaterial: spec.base,
      splatResolution: spec.splat ?? Math.min(1024, spec.size),
      starter: false,
      now: SHIPPED_DATE,
    });
    super(doc, levelCatalog(), { name: spec.id, seed: spec.seed, maxLayers: LEVEL_LAYERS });
  }

  /**
   * Ejecta round a crater: blocks of rock strewn along its real rim (the
   * highest ground on each ray out from `center` within `reach` metres), in
   * clumps with gaps between them, big and close at the rim, smaller and
   * sparser further out; never a closed ring. `rocks` from largest to
   * smallest; one block per `spacing` metres of rim
   */
  ejecta(center: MapPoint, reach: number, rocks: readonly string[], o: { spacing?: number; spread?: number } = {}): void {
    const rays = 72;
    const rim: number[] = [];
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      let best = reach * 0.3;
      let top = -Infinity;
      for (let d = reach * 0.3; d <= reach; d += 1) {
        const h = this.h(center.x + Math.cos(a) * d, center.y + Math.sin(a) * d);
        if (h > top) [top, best] = [h, d];
      }
      rim.push(best);
    }
    const mean = rim.reduce((s, d) => s + d, 0) / rays;
    const n = Math.round((Math.PI * 2 * mean) / (o.spacing ?? 6));
    const spread = o.spread ?? 0.35;
    // Clumps: a slow wave round the rim with a random phase; blocks fall only where it stands high
    const phase = this.noise.hash(center.x, center.y, 1) * Math.PI * 2;
    const lobes = 2 + Math.floor(this.noise.hash(center.x, center.y, 2) * 3);
    for (let i = 0; i < n; i++) {
      const a = this.noise.hash(center.x + i, center.y, 3) * Math.PI * 2;
      if (0.5 + 0.5 * Math.sin(a * lobes + phase) < this.noise.hash(center.x, center.y + i, 4) * 0.9) continue;
      // Most land at the rim, a few thrown far out
      const out = Math.pow(this.noise.hash(i, center.x, 5), 2.5);
      const d = rim[Math.floor((a / (Math.PI * 2)) * rays) % rays] * (0.97 + spread * out);
      const p = { x: center.x + Math.cos(a) * d, y: center.y + Math.sin(a) * d };
      const size = Math.min(rocks.length - 1, Math.floor(out * rocks.length + this.noise.hash(i, center.y, 6) * 1.6));
      if (!this.free(p.x, p.y, 2)) continue;
      this.place(rocks[size], p.x, p.y, { rotation: this.noise.hash(p.x, p.y, 7) * Math.PI * 2, scale: (1.25 - 0.5 * out) * (0.7 + 0.5 * this.noise.hash(p.y, p.x, 8)) });
    }
  }

  /**
   * The nearest spot to `p` where `asset` stands clear of every road and
   * bridge with its whole footprint (MapKit.free), searched in rings out to
   * `reach` metres; a spot meant for the water's edge (`onWater`) may be wet.
   * Null when there is none: a level then leaves the object out
   */
  clearSpot(asset: string, p: MapPoint, o: { reach?: number; onWater?: boolean; scale?: number } = {}): MapPoint | null {
    // A building's ground rectangle may reach past its footprint radius (a porch, a landing): the circle round it counts
    const entry = this.catalog.object(asset);
    const box = entry.box;
    const footprint = (box ? Math.max(entry.radius, Math.hypot(Math.abs(box[0]) + box[2], Math.abs(box[1]) + box[3])) : entry.radius) * (o.scale ?? 1);
    const onWater = o.onWater ?? false;
    if (this.free(p.x, p.y, footprint, onWater)) return p;
    for (let r = 1; r <= (o.reach ?? 12); r++) {
      const n = Math.max(8, Math.round(r * 2 * Math.PI));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const q = { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
        if (this.free(q.x, q.y, footprint, onWater)) return q;
      }
    }
    return null;
  }

  /** What the check's object-on-path asks of an asset, from the catalogue */
  private readonly roadCheck = {
    blocksBuild: (a: string) => this.catalog.object(a).blocksBuild,
    roadThrough: (a: string) => !!this.catalog.object(a).roadThrough,
    footingOf: (a: string) => this.catalog.object(a).footing,
  };

  /** Whether `asset` placed so would stand on a road by the editor's check (object-on-path), before it is placed */
  standsOnRoad(asset: string, x: number, y: number, o: { rotation?: number; scale?: number } = {}): boolean {
    const probe: MapObject = { id: 'probe', asset, x, y, z: 0, rotation: o.rotation ?? 0, scale: o.scale ?? 1 };
    return objectsOnPaths({ ...this.doc, objects: [probe] }, this.roadCheck).length > 0;
  }

  /**
   * Moves every object that stands on a road by the editor's check
   * (`object-on-path`: its ground against the road's width) to the nearest
   * spot within `reach` metres where it stands clear, keeping its turn and
   * scale; one with no such spot goes. Returns the objects moved and removed
   */
  keepOffRoads(reach = 6): { moved: string[]; removed: string[] } {
    const edges = new EdgeIndex(this.doc.paths);
    const onRoad = (o: MapObject) => objectsOnPaths({ ...this.doc, objects: [o] }, this.roadCheck, edges).length > 0;
    const moved: string[] = [];
    const removed = new Set<string>();
    for (const o of objectsOnPaths(this.doc, this.roadCheck, edges)) {
      let spot: MapPoint | null = null;
      for (let r = 0.5; r <= reach && !spot; r += 0.5) {
        const n = Math.max(8, Math.round(r * 2 * Math.PI));
        for (let i = 0; i < n && !spot; i++) {
          const a = (i / n) * Math.PI * 2;
          const q = { ...o, x: o.x + Math.cos(a) * r, y: o.y + Math.sin(a) * r };
          if (!onRoad(q)) spot = q;
        }
      }
      if (spot) {
        o.x = Math.round(spot.x * 100) / 100;
        o.y = Math.round(spot.y * 100) / 100;
        moved.push(`${o.asset} ${o.id}`);
      } else removed.add(o.id);
    }
    this.doc.objects = this.doc.objects.filter((o) => !removed.has(o.id));
    return { moved, removed: [...removed] };
  }

  /** The finished document; throws on the editor check's errors, on objects or water in the air (object-floating, water-floating) and on objects in a mover route's way */
  finish(): CustomMapDocument {
    this.settleRocks();
    const issues = this.issues();
    // LEVEL_LOG=1 prints what the editor's panels would show: lanes, objects, warnings, layers left out
    if (process.env['LEVEL_LOG']) {
      console.log(this.spec.id, { lanes: this.lanes(), objects: this.doc.objects.length, leftOut: [...this.leftOut], warnings: issues.map((i) => `${i.message}${i.target && 'id' in i.target ? ` [${i.target.id}]` : ''}${i.focus ? ` at ${Math.round(i.focus.x)},${Math.round(i.focus.y)}` : ''}`) });
    }
    // A shipped level has nothing hanging in the air and nothing a rover drives through: the check's warnings stop it here
    const errors = issues.filter((i) => i.severity === 'error' || i.code === 'object-floating' || i.code === 'water-floating' || i.code === 'object-on-mover-route');
    if (errors.length) throw new Error(`${this.spec.id}: ${errors.map((e) => `${e.message}${e.focus ? ` (at ${Math.round(e.focus.x)}, ${Math.round(e.focus.y)})` : ''}`).join('; ')}`);
    return this.doc;
  }
}
