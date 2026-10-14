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
import type { CustomMapDocument } from '../../../src/app/world/custom-map/map-document';

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
  constructor(readonly spec: LevelSpec) {
    const doc = createMapDocument({
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

  /** The finished document; throws on the editor check's errors */
  finish(): CustomMapDocument {
    this.settleRocks();
    const issues = this.issues();
    // LEVEL_LOG=1 prints what the editor's panels would show: lanes, objects, warnings, layers left out
    if (process.env['LEVEL_LOG']) {
      console.log(this.spec.id, { lanes: this.lanes(), objects: this.doc.objects.length, leftOut: [...this.leftOut], warnings: issues.map((i) => `${i.message}${i.target && 'id' in i.target ? ` [${i.target.id}]` : ''}${i.focus ? ` at ${Math.round(i.focus.x)},${Math.round(i.focus.y)}` : ''}`) });
    }
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length) throw new Error(`${this.spec.id}: ${errors.map((e) => e.message).join('; ')}`);
    return this.doc;
  }
}
