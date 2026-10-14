import type { AssetCatalog, CatalogObject } from '../render/asset-catalog';
import { createMapDocument } from '../map-create';
import { MAX_GROUND_LAYERS, fitSplatMaps, type CustomMapDocument, type MapObject } from '../map-document';

export interface ShowcaseOptions {
  /** Ground materials as bands from west to east (at most 8, the splat limit) */
  materials?: string[];
  /** Objects in rows from south to north, in this order */
  objects?: string[];
  /** Instead of lists: every material and object carrying this tag */
  tag?: string;
}

const SIZE = 240;
const ROW_WIDTH = 100;

/**
 * A flat dev map that lines up catalogue assets for a look under the map
 * lighting (`/map-preview?showcase=winter` or `?assets=a,b&materials=c,d`):
 * ground materials in bands, objects in rows spaced by their footprint.
 */
export function createAssetShowcase(catalog: AssetCatalog, options: ShowcaseOptions): CustomMapDocument {
  const tagged = <T extends { id: string; tags?: string[] }>(list: T[]): string[] =>
    options.tag ? list.filter((e) => e.tags?.includes(options.tag ?? '')).map((e) => e.id) : [];
  const materials = (options.materials ?? tagged(catalog.materials)).slice(0, 8);
  const objectIds = expand(options.objects ?? tagged(catalog.objects), catalog.objects);
  const doc = createMapDocument({
    id: 'asset-showcase',
    name: `Showcase ${options.tag ?? ''}`.trim(),
    width: SIZE,
    depth: SIZE,
    cellSize: 2,
    starter: false,
    baseMaterial: materials[0] ?? 'grass',
  });
  const { splat } = doc.terrain;
  if (materials.length > 1) {
    doc.terrain.layers = materials.slice(0, MAX_GROUND_LAYERS).map((material) => ({ material }));
    fitSplatMaps(doc.terrain);
    const bands = doc.terrain.layers.length;
    const res = splat.resolution;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const band = Math.min(bands - 1, Math.floor((i / res) * bands));
        const t = j * res + i;
        splat.maps[0][t * 4] = 0;
        splat.maps[band >> 2][t * 4 + (band & 3)] = 255;
      }
    }
  }
  doc.objects = layout(objectIds, catalog.objects);
  return doc;
}

/** Ids with a trailing `*` stand for every object id with that prefix */
function expand(ids: string[], objects: CatalogObject[]): string[] {
  return ids.flatMap((id) => (id.endsWith('*') ? objects.filter((o) => o.id.startsWith(id.slice(0, -1))).map((o) => o.id) : [id]));
}

/** Rows centred on x = 0, the first one 30 m north of the south edge */
function layout(ids: string[], objects: CatalogObject[]): MapObject[] {
  const out: MapObject[] = [];
  let row: MapObject[] = [];
  let x = 0;
  let y = -SIZE / 2 + 30;
  let rowDepth = 0;
  const closeRow = (): void => {
    for (const o of row) o.x -= (x - 2) / 2;
    out.push(...row);
    row = [];
  };
  for (const id of ids) {
    const entry = objects.find((o) => o.id === id);
    const r = Math.max(1, entry?.footprint ?? 2);
    if (x + 2 * r > ROW_WIDTH && row.length > 0) {
      closeRow();
      x = 0;
      y += rowDepth + 4;
      rowDepth = 0;
    }
    row.push({ id: `show-${out.length + row.length}`, asset: id, x: x + r, y: y + r, z: 0, rotation: Math.PI, scale: 1 });
    x += 2 * r + 2;
    rowDepth = Math.max(rowDepth, 2 * r);
  }
  closeRow();
  return out;
}
