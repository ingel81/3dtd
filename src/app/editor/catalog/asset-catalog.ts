/**
 * What the editor offers to paint and place: the ground materials and
 * object assets of the renderer's catalogue, with what the palettes need on
 * top (a colour, a rough shape for pictures, category names).
 */
import { MapAssetLibrary } from '../../world/custom-map/render/map-asset-library';

export interface GroundMaterialEntry {
  id: string;
  name: string;
  /** Mean colour, for swatches and the minimap */
  color: string;
  thumbnail?: string;
  /** Texture repeat in metres */
  scale?: number;
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
  /** The renderer's own part (bridge decks): not offered in the palette */
  internal?: boolean;
}

/** Catalogue objects the renderer places itself */
const INTERNAL_OBJECTS = new Set(['bridge-deck']);

export interface MapAssetCatalog {
  materials: GroundMaterialEntry[];
  objects: ObjectAssetEntry[];
}

export const OBJECT_CATEGORIES = ['Trees', 'Plants', 'Rocks', 'Buildings', 'Walls', 'Props'] as const;

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
  objects?: (Partial<ObjectAssetEntry> & { id: string; footprint?: number; file?: string })[];
}

const CATEGORY_NAMES: Record<string, string> = {
  tree: 'Trees',
  plant: 'Plants',
  rock: 'Rocks',
  building: 'Buildings',
  wall: 'Walls',
  prop: 'Props',
};

const CATEGORY_LOOK: Record<string, { color: string; shape: ObjectShape }> = {
  Trees: { color: '#3f6b2a', shape: 'tree' },
  Plants: { color: '#5f8f3c', shape: 'bush' },
  Rocks: { color: '#7d7a74', shape: 'rock' },
  Buildings: { color: '#9c8466', shape: 'house' },
  Walls: { color: '#87827a', shape: 'wall' },
  Props: { color: '#8c6d45', shape: 'crate' },
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
        internal: INTERNAL_OBJECTS.has(o.id) || undefined,
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

  categories(): string[] {
    const seen = new Set<string>(OBJECT_CATEGORIES);
    for (const o of this.catalog.objects) seen.add(o.category);
    return [...seen].filter((c) => this.catalog.objects.some((o) => o.category === c));
  }
}
