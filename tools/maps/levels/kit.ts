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
import { createMapDocument } from '../../../src/app/world/custom-map/map-create';
import type { CustomMapDocument, MapPoint } from '../../../src/app/world/custom-map/map-document';

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
