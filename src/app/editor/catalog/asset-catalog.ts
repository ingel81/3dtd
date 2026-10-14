/**
 * What the editor offers to paint and place: the ground materials and
 * object assets of the renderer's catalogue, with what the palettes need on
 * top (a colour, a rough shape for pictures, category names).
 */
import type { CatalogObject } from '../../world/custom-map/render/asset-catalog';
import { MapAssetLibrary } from '../../world/custom-map/render/map-asset-library';
import type { CostEntry } from '../../world/custom-map/render/objects/scene-cost';

export interface GroundMaterialEntry {
  id: string;
  name: string;
  /** Mean colour, for swatches and the minimap */
  color: string;
  thumbnail?: string;
  /** Texture repeat in metres */
  scale?: number;
  /** Biomes and brush roles from the catalogue (temperate, swamp, shore, scree …) */
  tags?: string[];
}

export type ObjectShape = 'tree' | 'pine' | 'bush' | 'rock' | 'house' | 'tower' | 'wall' | 'crate' | 'generic';

export interface ObjectAssetEntry {
  id: string;
  name: string;
  category: string;
  color: string;
  shape: ObjectShape;
  thumbnail?: string;
  model?: string;
  blocksLos: boolean;
  blocksBuild: boolean;
  /** Footprint radius in metres at scale 1 */
  radius: number;
  /** Height in metres at scale 1 */
  height: number;
  /** Rocks: their underside (half width, half depth, depth below the pivot), see `CatalogObject.base`; they settle on it */
  base?: readonly [number, number, number];
  /** Floats on water (boats, buoys, piers, lily pads): z counts from the waterline, so it neither sinks nor tilts with the ground */
  float?: boolean;
  /** The renderer's own part (bridge decks): not offered in the palette */
  internal?: boolean;
  /** Biomes and brush roles from the catalogue (temperate, swamp, shore, scree …) */
  tags?: string[];
  /** What the renderer draws of it (triangles, detail levels, draw distance, effects), for the scene cost; none for an unknown asset */
  drawing?: CostEntry;
}

/** The catalogue's biome tags in the order the palettes offer them (brush roles like shore or scree are left out) */
export const BIOME_TAGS = [
  'temperate',
  'autumn',
  'winter',
  'arctic',
  'mountain',
  'coast',
  'swamp',
  'desert',
  'volcanic',
  'hell',
  'village',
  'castle',
  'city',
  'wasteland',
  'moon',
  'mars',
  'crystal',
  'arena',
] as const;

/** A tag as the palettes show it */
export function tagName(tag: string): string {
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

/** Catalogue objects the renderer places itself */
const INTERNAL_OBJECTS = new Set(['bridge-deck']);

export interface MapAssetCatalog {
  materials: GroundMaterialEntry[];
  objects: ObjectAssetEntry[];
}

export const OBJECT_CATEGORIES = ['Trees', 'Plants', 'Rocks', 'Buildings', 'Walls', 'Structures', 'Props', 'Effects'] as const;

/** Before the catalogue is in */
export const EMPTY_CATALOG: MapAssetCatalog = { materials: [], objects: [] };

/** The renderer's catalogue (`maps/assets/catalog.json`, read once by `MapAssetLibrary`) for the palettes */
export async function loadAssetCatalog(library = MapAssetLibrary.shared()): Promise<MapAssetCatalog> {
  const catalog = await library.catalog();
  return normalizeCatalog(catalog as RawCatalog, new URL(library.baseUrl, document.baseURI).toString());
}

/** A catalogue file as the renderer writes it (`render/asset-catalog.ts`), with the editor's own fields optional */
interface RawCatalog {
  materials?: (Partial<GroundMaterialEntry> & { id: string; average?: string; files?: { color?: string } })[];
  objects?: (Partial<ObjectAssetEntry> &
    Partial<Pick<CatalogObject, 'drawDistance' | 'triangles' | 'lod' | 'effects'>> & { id: string; footprint?: number; file?: string; category?: string })[];
}

const CATEGORY_NAMES: Record<string, string> = {
  tree: 'Trees',
  plant: 'Plants',
  rock: 'Rocks',
  building: 'Buildings',
  wall: 'Walls',
  structure: 'Structures',
  prop: 'Props',
  fx: 'Effects',
};

const CATEGORY_LOOK: Record<string, { color: string; shape: ObjectShape }> = {
  Trees: { color: '#3f6b2a', shape: 'tree' },
  Plants: { color: '#5f8f3c', shape: 'bush' },
  Rocks: { color: '#7d7a74', shape: 'rock' },
  Buildings: { color: '#9c8466', shape: 'house' },
  Walls: { color: '#87827a', shape: 'wall' },
  Structures: { color: '#7a6448', shape: 'wall' },
  Props: { color: '#8c6d45', shape: 'crate' },
  Effects: { color: '#6fa3c8', shape: 'generic' },
};

/** The editor's entries from a catalogue file: colours, shapes and pictures where the file has none */
export function normalizeCatalog(json: RawCatalog, assetsUrl: string): MapAssetCatalog {
  const url = (p?: string) => (p ? new URL(p, assetsUrl).toString() : undefined);
  return {
    materials: (json.materials ?? []).map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      color: m.color ?? m.average ?? '#777777',
      thumbnail: url(m.thumbnail ?? m.files?.color),
      scale: m.scale,
      tags: m.tags?.length ? [...m.tags] : undefined,
    })),
    objects: (json.objects ?? []).map((o) => {
      const category = CATEGORY_NAMES[o.category ?? ''] ?? o.category ?? 'Props';
      const look = CATEGORY_LOOK[category] ?? CATEGORY_LOOK['Props'];
      return {
        id: o.id,
        name: o.name ?? o.id,
        category,
        color: o.color ?? look.color,
        shape: o.shape ?? (o.id.includes('pine') || o.id.includes('fir') ? 'pine' : look.shape),
        thumbnail: url(o.thumbnail),
        model: url(o.model ?? o.file),
        blocksLos: o.blocksLos ?? false,
        blocksBuild: o.blocksBuild ?? true,
        radius: o.radius ?? o.footprint ?? 1,
        height: o.height ?? 2,
        base: o.base,
        float: o.float || undefined,
        internal: INTERNAL_OBJECTS.has(o.id) || undefined,
        tags: o.tags?.length ? [...o.tags] : undefined,
        drawing:
          o.drawDistance === undefined
            ? undefined
            : {
                category: (o.category ?? 'prop') as CatalogObject['category'],
                height: o.height ?? 2,
                drawDistance: o.drawDistance,
                file: o.file ?? '',
                triangles: o.triangles,
                lod: o.lod,
                effects: o.effects,
              },
      };
    }),
  };
}

export class CatalogIndex {
  readonly materials = new Map<string, GroundMaterialEntry>();
  readonly objects = new Map<string, ObjectAssetEntry>();

  constructor(readonly catalog: MapAssetCatalog) {
    for (const m of catalog.materials) this.materials.set(m.id, m);
    for (const o of catalog.objects) this.objects.set(o.id, o);
  }

  material(id: string): GroundMaterialEntry {
    return this.materials.get(id) ?? { id, name: id, color: '#777777' };
  }

  object(id: string): ObjectAssetEntry {
    return (
      this.objects.get(id) ?? {
        id,
        name: id,
        category: 'Props',
        color: '#888888',
        shape: 'generic',
        blocksLos: false,
        blocksBuild: true,
        radius: 1,
        height: 2,
      }
    );
  }

  /** The biome tags some object or material carries, in palette order */
  biomes(): string[] {
    const seen = new Set<string>();
    for (const e of [...this.catalog.objects, ...this.catalog.materials]) for (const t of e.tags ?? []) seen.add(t);
    return BIOME_TAGS.filter((t) => seen.has(t));
  }

  categories(): string[] {
    const seen = new Set<string>(OBJECT_CATEGORIES);
    for (const o of this.catalog.objects) seen.add(o.category);
    return [...seen].filter((c) => this.catalog.objects.some((o) => o.category === c));
  }
}
