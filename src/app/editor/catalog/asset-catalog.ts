/**
 * What the editor offers to paint and place: ground materials and object
 * assets. The real catalogue (`maps/assets/catalog.json`, written with the
 * map renderer's assets) wins; the built-in list keeps the editor usable
 * without it and names the ids the starter maps use. Every entry carries a
 * colour and a rough shape, which the editor draws until the renderer has
 * the model.
 */

export interface GroundMaterialEntry {
  id: string;
  name: string;
  /** Mean colour, for the placeholder ground, the minimap and swatches */
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
}

export interface MapAssetCatalog {
  materials: GroundMaterialEntry[];
  objects: ObjectAssetEntry[];
}

export const OBJECT_CATEGORIES = ['Trees', 'Plants', 'Rocks', 'Buildings', 'Props'] as const;

export const BUILTIN_CATALOG: MapAssetCatalog = {
  materials: [
    { id: 'grass', name: 'Grass', color: '#5b7a3a' },
    { id: 'grass-dry', name: 'Dry grass', color: '#8a8a4a' },
    { id: 'forest-floor', name: 'Forest floor', color: '#4a4a2c' },
    { id: 'dirt', name: 'Dirt', color: '#7a5f43' },
    { id: 'mud', name: 'Mud', color: '#4f4234' },
    { id: 'sand', name: 'Sand', color: '#c2b080' },
    { id: 'gravel', name: 'Gravel', color: '#8a867c' },
    { id: 'rock', name: 'Rock', color: '#6d6a66' },
    { id: 'cobble', name: 'Cobblestone', color: '#77736b' },
    { id: 'road', name: 'Road dirt', color: '#8f7656' },
    { id: 'snow', name: 'Snow', color: '#e6ebef' },
    { id: 'ash', name: 'Ash', color: '#3d3b39' },
  ],
  objects: [
    { id: 'tree-oak', name: 'Oak', category: 'Trees', color: '#3f6b2a', shape: 'tree', blocksLos: true, blocksBuild: true, radius: 3, height: 10 },
    { id: 'tree-birch', name: 'Birch', category: 'Trees', color: '#6c8f3a', shape: 'tree', blocksLos: true, blocksBuild: true, radius: 2.2, height: 11 },
    { id: 'tree-pine', name: 'Pine', category: 'Trees', color: '#2c4f2f', shape: 'pine', blocksLos: true, blocksBuild: true, radius: 2.5, height: 13 },
    { id: 'tree-dead', name: 'Dead tree', category: 'Trees', color: '#5a4a3a', shape: 'pine', blocksLos: false, blocksBuild: true, radius: 1.5, height: 8 },
    { id: 'bush', name: 'Bush', category: 'Plants', color: '#4c7a33', shape: 'bush', blocksLos: false, blocksBuild: false, radius: 1.5, height: 1.6 },
    { id: 'fern', name: 'Fern', category: 'Plants', color: '#5f8f3c', shape: 'bush', blocksLos: false, blocksBuild: false, radius: 0.8, height: 0.8 },
    { id: 'rock-small', name: 'Small rock', category: 'Rocks', color: '#7d7a74', shape: 'rock', blocksLos: false, blocksBuild: true, radius: 1, height: 1 },
    { id: 'rock-large', name: 'Boulder', category: 'Rocks', color: '#6a6762', shape: 'rock', blocksLos: true, blocksBuild: true, radius: 3.5, height: 4 },
    { id: 'rock-cliff', name: 'Cliff rock', category: 'Rocks', color: '#5d5a56', shape: 'rock', blocksLos: true, blocksBuild: true, radius: 6, height: 9 },
    { id: 'house', name: 'House', category: 'Buildings', color: '#9c8466', shape: 'house', blocksLos: true, blocksBuild: true, radius: 6, height: 8 },
    { id: 'barn', name: 'Barn', category: 'Buildings', color: '#7c4b3a', shape: 'house', blocksLos: true, blocksBuild: true, radius: 9, height: 10 },
    { id: 'tower-ruin', name: 'Ruined tower', category: 'Buildings', color: '#8a8478', shape: 'tower', blocksLos: true, blocksBuild: true, radius: 4, height: 14 },
    { id: 'wall', name: 'Stone wall', category: 'Buildings', color: '#87827a', shape: 'wall', blocksLos: true, blocksBuild: true, radius: 4, height: 2.5 },
    { id: 'fence', name: 'Fence', category: 'Props', color: '#7a6247', shape: 'wall', blocksLos: false, blocksBuild: true, radius: 3, height: 1.2 },
    { id: 'crate', name: 'Crates', category: 'Props', color: '#8c6d45', shape: 'crate', blocksLos: false, blocksBuild: true, radius: 1.2, height: 1.2 },
    { id: 'barrel', name: 'Barrels', category: 'Props', color: '#6e5235', shape: 'crate', blocksLos: false, blocksBuild: true, radius: 0.8, height: 1.1 },
  ],
};

/** Joins a catalogue over the built-in one: entries of the same id are replaced */
export function mergeCatalogs(base: MapAssetCatalog, over: Partial<MapAssetCatalog>): MapAssetCatalog {
  const byId = <T extends { id: string }>(a: T[], b: T[] | undefined): T[] => {
    const map = new Map(a.map((e) => [e.id, e]));
    for (const e of b ?? []) map.set(e.id, { ...map.get(e.id), ...e });
    return [...map.values()];
  };
  return { materials: byId(base.materials, over.materials), objects: byId(base.objects, over.objects) };
}

/** Reads `maps/assets/catalog.json` over the built-in list; the built-in list alone when it is missing */
export async function loadAssetCatalog(baseUrl: string = document.baseURI): Promise<MapAssetCatalog> {
  try {
    const response = await fetch(new URL('maps/assets/catalog.json', baseUrl).toString());
    if (!response.ok) return BUILTIN_CATALOG;
    const json = (await response.json()) as Partial<MapAssetCatalog>;
    return mergeCatalogs(BUILTIN_CATALOG, normalize(json, baseUrl));
  } catch {
    return BUILTIN_CATALOG;
  }
}

/** Fills what a catalogue file may leave out and resolves thumbnail paths */
function normalize(json: Partial<MapAssetCatalog>, baseUrl: string): Partial<MapAssetCatalog> {
  const url = (p?: string) => (p ? new URL(p, new URL('maps/assets/', baseUrl)).toString() : undefined);
  return {
    materials: json.materials?.map((m) => ({ ...m, color: m.color ?? '#777777', thumbnail: url(m.thumbnail) })),
    objects: json.objects?.map((o) => ({
      ...o,
      category: o.category ?? 'Props',
      color: o.color ?? '#888888',
      shape: o.shape ?? 'generic',
      radius: o.radius ?? 1,
      height: o.height ?? 2,
      blocksLos: o.blocksLos ?? false,
      blocksBuild: o.blocksBuild ?? true,
      thumbnail: url(o.thumbnail),
    })),
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
