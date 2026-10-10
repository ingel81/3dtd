/**
 * The asset catalogue of custom maps (`public/maps/assets/catalog.json`):
 * ground materials for the terrain and objects to place on it. Map documents
 * name entries by id; the renderer, the editor's palettes and the game's
 * build rules read the rest from here.
 */

export const CATALOG_VERSION = 1;

export type MaterialCategory = 'grass' | 'soil' | 'rock' | 'sand' | 'snow' | 'road' | 'forest';

/**
 * One PBR ground material. Files are relative to the catalogue:
 * - `color`: albedo (sRGB)
 * - `normal`: tangent-space normal map, OpenGL convention (green up)
 * - `arh`: ambient occlusion in R, roughness in G, height in B (linear)
 */
export interface CatalogMaterial {
  id: string;
  name: string;
  category: MaterialCategory;
  files: { color: string; normal: string; arh: string };
  /** Metres one texture repeat covers */
  scale: number;
  /** Average albedo as #rrggbb: distant terrain, fallbacks and editor swatches */
  average: string;
}

export type ObjectCategory = 'tree' | 'rock' | 'plant' | 'building' | 'prop' | 'wall';

export interface CatalogObject {
  id: string;
  name: string;
  category: ObjectCategory;
  /** GLB relative to the catalogue, pivot at the base centre, metres, +Y up, front towards +Z */
  file: string;
  /** Radius in metres that the object occupies on the ground at scale 1 */
  footprint: number;
  /** Height in metres at scale 1 */
  height: number;
  blocksLos: boolean;
  blocksBuild: boolean;
  /** Placement hints for brushes and generators */
  scaleRange: [number, number];
  randomRotation: boolean;
  /** Wind sway strength, 0 = rigid, 1 = a slender tree */
  wind: number;
  /** Beyond this camera distance in metres the object is not drawn */
  drawDistance: number;
}

export interface AssetCatalog {
  version: number;
  materials: CatalogMaterial[];
  objects: CatalogObject[];
}

/** Throws with a readable message when the JSON is not a catalogue this build understands */
export function parseCatalog(json: unknown): AssetCatalog {
  const c = json as Partial<AssetCatalog> | null;
  if (!c || typeof c !== 'object') throw new Error('Asset catalogue: not an object');
  if (c.version !== CATALOG_VERSION) throw new Error(`Asset catalogue: version ${c.version}, expected ${CATALOG_VERSION}`);
  if (!Array.isArray(c.materials) || !Array.isArray(c.objects)) {
    throw new Error('Asset catalogue: materials and objects must be lists');
  }
  const ids = new Set<string>();
  for (const entry of [...c.materials, ...c.objects]) {
    if (!entry?.id) throw new Error('Asset catalogue: entry without id');
    if (ids.has(entry.id)) throw new Error(`Asset catalogue: duplicate id ${entry.id}`);
    ids.add(entry.id);
  }
  return c as AssetCatalog;
}

/** Hex colour to an sRGB triple in 0..1 */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
