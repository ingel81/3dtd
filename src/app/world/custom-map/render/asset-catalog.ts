/**
 * The asset catalogue of custom maps (`public/maps/assets/catalog.json`):
 * ground materials for the terrain and objects to place on it. Map documents
 * name entries by id; the renderer, the editor's palettes and the game's
 * build rules read the rest from here.
 */

import type { CatalogRoof } from '../object-roof';

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
  /**
   * A hard surface (pavement, asphalt, planks): the ground's wear, tints and
   * scree stay off it, at most a little grime settles in its joints. Earth
   * and gravel paths are not paved; they stay earthy inside
   */
  paved?: boolean;
  /**
   * Grass layers: the blades that grow on it, heights from and to and their
   * width in metres, and whether seed heads and flowers show among them (a
   * lawn short and fine, a meadow knee-high and flowering); without, the
   * meadow's (grass-field.ts DEFAULT_BLADES)
   */
  blades?: { height: [number, number]; width: number; heads?: boolean };
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
  | 'sparks'
  | 'column'
  | 'waterfall'
  | 'birds'
  | 'beam'
  | 'shaft'
  | 'surf';

/**
 * A particle or sheet effect an object carries. Sizes are at scale 1 and
 * scale with the object. A `waterfall` builds a falling sheet `radius` wide
 * on each side and `height` high (from the object's base up) with spray at
 * its foot; `birds` is a flock of `rate` birds circling `radius` wide at
 * `height` over the object (effects/bird-flocks.ts); `beam` two light beams
 * `radius` long from `height`, turning with the object's `spin` (a
 * lighthouse), shown in the dark; `shaft` a shaft of light `radius` wide
 * standing `height` up from the object's foot (a hell gate's glow), faint
 * by day, its colour the object's light's unless it names one; `surf`
 * spray thrown up in bursts on the swell's beat from a disc of `radius` at
 * `height` (waves breaking on rock); `column` a tall plume of smoke rising
 * `height` from a foot `radius` wide, leaning with the wind and lit from
 * below over lava or by the object's own light; the others emit particles
 * from a disc of `radius` at `height`.
 */
export interface CatalogEffect {
  kind: EffectKind;
  /**
   * Where on the model it comes from, beside its origin: x and z of the
   * model's own frame (as the glTF holds it), metres at scale 1, turned and
   * scaled with the object (a house's chimney)
   */
  at?: readonly [number, number];
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
  /** Seconds between two short flashes (a beacon on a mast); the light is off between them and lights no ground */
  blink?: number;
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
  /**
   * Buildings and walls: the ground rectangle at scale 1, metres: its middle
   * (model x, z), half width and half depth, 0.9 of the model's bounds like
   * the footprint (tools/map-assets/measure_boxes.mjs). Building bans and the
   * seat take it within the footprint disc (object-ground.ts)
   */
  box?: [number, number, number, number];
  /**
   * Buildings, walls and structures a tower can stand on: the model's top
   * surface at scale 1 (tools/map-assets/measure_roofs.mjs), object-roof.ts.
   * Missing: the object blocks building around it, and nothing stands on it
   */
  roof?: CatalogRoof;
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
  /**
   * A road may run through it (a gatehouse, a farm gate): the editor's check
   * does not report it standing on a road
   */
  roadThrough?: boolean;
  /**
   * An opening into the ground behind its front face (a tunnel portal's
   * vault): half width, spring, crown and length at scale 1, metres, running
   * from model z = 0 along -z, straight walls to the spring and an elliptic
   * arch to the crown. The terrain is not drawn inside it (terrain-cuts.ts),
   * so the hill over a tunnel can lie on the vault
   */
  groundCut?: [number, number, number, number];
  /**
   * Seconds a full turn of its parts with materials named `spin-…` takes,
   * round the model's upright axis (a radar dish, a lighthouse's lens; its
   * `beam` turns with them). Default 8 where such parts exist
   */
  spin?: number;
  /**
   * Seconds a full turn of its parts with materials named `rotor-…` takes,
   * round their own hub (a windmill's sails, a water wheel, a turbine's
   * blades; objects/rotor.ts). Default 8 where such parts exist
   */
  rotor?: number;
  /**
   * A cable's span (a cable car's ropes, effects/cable-ride.ts): two ropes
   * `gauge` metres apart along its front, `length` long at scale 1, at the
   * height of its origin; movers hanging from a line along it ride them
   */
  cable?: { gauge: number; length: number };
  /** Metres from the origin up to where a hanging mover holds its rope (a gondola's grip); default its height */
  grip?: number;
  /**
   * Looks of the model in its baked texture atlas (a grid, 2 x 2 for four):
   * each instance shows the one its place picks (objects/atlas-variants.ts),
   * a herd of one cow model shows several breeds
   */
  variants?: number;
  /** Lower detail models by camera distance */
  lod?: { file: string; distance: number; triangles?: number }[];
  /** Where an object's `sign` is written on the model (render/objects/sign-text.ts) */
  signPanel?: CatalogSignPanel;
}

/**
 * The face of a model a sign is written on: a rectangle in the model's own
 * frame (as the glTF holds it: metres at scale 1, +y up, front +z)
 */
export interface CatalogSignPanel {
  /** Middle of the face, its width and height */
  at: readonly [number, number, number];
  width: number;
  height: number;
  /** The way it faces, a unit vector across the face (default front, [0, 0, 1]); its up is +y */
  normal?: readonly [number, number, number];
  /** Written on both faces (a hanging sign) */
  sides?: 1 | 2;
  /** #rrggbb of the writing; default dark on a light board, light on a dark one (from the object's tint) */
  ink?: string;
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
