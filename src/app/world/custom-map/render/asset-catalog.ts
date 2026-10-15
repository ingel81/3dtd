/**
 * The asset catalogue of custom maps (`public/maps/assets/catalog.json`):
 * ground materials for the terrain and objects to place on it. Map documents
 * name entries by id; the renderer, the editor's palettes and the game's
 * build rules read the rest from here.
 */

export const CATALOG_VERSION = 1;

export type MaterialCategory =
  | 'grass'
  | 'soil'
  | 'rock'
  | 'sand'
  | 'snow'
  | 'road'
  | 'forest'
  | 'ice'
  | 'volcanic'
  | 'wood';

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
  files: {
    color: string;
    normal: string;
    arh: string;
    /**
     * The two terrain layers GPU-compressed (tools/map-assets/pack_textures.py):
     * colour and height (sRGB), normal x/y, roughness and occlusion (linear)
     */
    packed?: { color: string; data: string };
  };
  /** Metres one texture repeat covers */
  scale: number;
  /** Average albedo as #rrggbb: distant terrain, fallbacks and editor swatches */
  average: string;
  /** Where the files came from (licence record) */
  source?: string;
  /** Biome tags for palettes and generators: temperate, autumn, winter, desert, swamp, volcanic, coast, castle, ... */
  tags?: string[];
  /**
   * Glow of the albedo, 0..1 (lava): the terrain lights this layer itself,
   * strongest where the texture's height is low (cracks), pulsing slowly
   */
  emissive?: number;
  /** Scroll speed of the layer in m/s (flowing lava), along map +x */
  flow?: number;
}

export type ObjectCategory = 'tree' | 'rock' | 'plant' | 'building' | 'prop' | 'wall' | 'structure' | 'fx';

export type EffectKind =
  | 'fire'
  | 'smoke'
  | 'embers'
  | 'fireflies'
  | 'fog'
  | 'leaves'
  | 'snow'
  | 'sparkle'
  | 'waterfall';

/**
 * A particle or sheet effect an object carries. Sizes are at scale 1 and
 * scale with the object. A `waterfall` builds a falling sheet `radius` wide
 * on each side and `height` high (from the object's base up) with spray at
 * its foot; the others emit particles from a disc of `radius` at `height`.
 */
export interface CatalogEffect {
  kind: EffectKind;
  radius?: number;
  height?: number;
  /** Particles per second */
  rate?: number;
  /** #rrggbb tint */
  color?: string;
}

/** A light an object gives: an additive glow always, a real point light for the nearest few at night */
export interface CatalogLight {
  color: string;
  intensity: number;
  /** Reach in metres */
  distance: number;
  /** Height of the light above the object's base, metres */
  height: number;
  flicker?: boolean;
}

export interface CatalogObject {
  id: string;
  name: string;
  category: ObjectCategory;
  /** GLB relative to the catalogue, pivot at the base centre, metres, +Y up, front towards +Z; '' for effect-only entries */
  file: string;
  /** Triangles the model draws (tools/map-assets/count_triangles.py), for the editor's scene cost */
  triangles?: number;
  /** Radius in metres that the object occupies on the ground at scale 1 */
  footprint: number;
  /** Height in metres at scale 1 */
  height: number;
  /**
   * Rocks: the underside at scale 1, metres: half its width (model x), half
   * its depth (model z) and how far its lowest point lies below the pivot.
   * Measured from the model (tools/map-assets/measure_bases.mjs); placing
   * sinks a rock until this plate reaches the ground on a slope
   */
  base?: [number, number, number];
  blocksLos: boolean;
  blocksBuild: boolean;
  /** Placement hints for brushes and generators */
  scaleRange: [number, number];
  randomRotation: boolean;
  /** Wind sway strength, 0 = rigid, 1 = a slender tree */
  wind: number;
  /** Beyond this camera distance in metres the object is not drawn */
  drawDistance: number;
  /** Where the model came from (licence record) */
  source?: string;
  tags?: string[];
  effects?: CatalogEffect[];
  light?: CatalogLight;
  /**
   * Floats on water: the model's origin is its waterline, placed at the
   * level of the water under it (on dry ground at the terrain), plus the
   * object's own z. Boats, buoys, lily pads, floes, piers.
   */
  float?: boolean;
  /**
   * Stands in the air by design: it spans a gap or hangs from something
   * above it (object bridges, cable spans, the gondola). The editor's check
   * of objects in the air leaves it out.
   */
  aloft?: boolean;
  /**
   * Stands on legs over uneven or wet ground (a hut on stilts at a shore):
   * placing it levels no ground, which moved the bank and stranded water
   */
  stilts?: boolean;
  /** Lower detail models by camera distance */
  lod?: { file: string; distance: number; triangles?: number }[];
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

/**
 * Decoration in the colours the game speaks with: small bright red spots on
 * the ground read as enemies, blood or warnings from the game camera. Maps
 * keep them off the play area; the editor's check names them with what to
 * use instead. Large props in red (banners, containers, cars) are not in it:
 * they read as things, not as signals.
 */
export const DANGER_LOOK: Readonly<Record<string, { why: string; instead: string }>> = {
  'mushrooms-red': { why: 'red toadstools read as enemy markers or blood from the game camera', instead: 'mushrooms' },
  'flowers-red': { why: 'red poppies read as enemy markers or blood from the game camera', instead: 'flowers-yellow' },
};

/** Why an asset reads as danger and what to place instead, or null when it does not */
export function dangerLook(assetId: string): { why: string; instead: string } | null {
  return DANGER_LOOK[assetId] ?? null;
}
