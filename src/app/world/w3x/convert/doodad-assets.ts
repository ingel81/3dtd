/**
 * Warcraft doodads and destructables to objects of the asset catalogue.
 *
 * The second letter of a doodad id is its category (the first is the
 * tileset): T trees, R rocks, O objects/props, S structures, P plants,
 * W water decoration, Z misc, D/B doors and bridges. Each category maps to a
 * catalogue category and a list of candidate assets; the doodad's index picks
 * one deterministically, so an import always gives the same map. Trees lean
 * towards conifers on snowy tilesets and bare trees on barren ones.
 *
 * Pathing and sight blockers and invisible doodads have no model and are
 * skipped.
 */

import type { CatalogEntryRef } from './ground-materials';

export type AssetCategory = 'tree' | 'rock' | 'plant' | 'building' | 'prop' | 'wall';

/** Invisible helpers placed as destructables: pathing, air and sight blockers, platforms */
export const BLOCKER_IDS = /^(YT[pfal][bc]|Yt[lw][bc]|OTi[ps]|YTw[0-9]|Ytrb)$/;

const LETTER_CATEGORY: Record<string, AssetCategory> = {
  T: 'tree',
  R: 'rock',
  O: 'prop',
  S: 'building',
  P: 'plant',
  W: 'plant',
  Z: 'prop',
  D: 'wall',
  B: 'wall',
};

/** Candidates per category when no catalogue is given (ids of the planned catalogue) */
export const DEFAULT_ASSETS: Record<AssetCategory, string[]> = {
  tree: ['tree-oak', 'tree-birch', 'tree-pine', 'tree-fir'],
  rock: ['rock-small', 'rock-large'],
  plant: ['bush'],
  building: ['house', 'house-large', 'tower-ruin', 'well'],
  prop: ['barrel', 'crate'],
  wall: ['wall-stone', 'fence-wood'],
};

/** Tree preference by tileset letter: snowy, barren, dark */
const TREES_BY_TILESET: Record<string, string[]> = {
  N: ['tree-pine', 'tree-fir'],
  I: ['tree-pine', 'tree-fir'],
  B: ['tree-dead', 'tree-birch'],
  K: ['tree-dead', 'tree-pine'],
  C: ['tree-dead', 'tree-oak'],
  Q: ['tree-dead', 'tree-pine'],
};

export function doodadCategory(id: string): AssetCategory {
  return LETTER_CATEGORY[id[1]] ?? 'prop';
}

/** Small integer hash, the same on every engine */
export function hashIndex(n: number, salt = 0): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export class AssetPicker {
  private readonly lists = new Map<AssetCategory, string[]>();

  constructor(tileset: string, catalog?: CatalogEntryRef[]) {
    for (const cat of Object.keys(DEFAULT_ASSETS) as AssetCategory[]) {
      let list = cat === 'tree' ? (TREES_BY_TILESET[tileset] ?? DEFAULT_ASSETS.tree) : DEFAULT_ASSETS[cat];
      if (catalog?.length) {
        const ids = new Set(catalog.map((c) => c.id));
        const known = list.filter((id) => ids.has(id));
        list = known.length ? known : catalog.filter((c) => c.category === cat).map((c) => c.id);
      }
      this.lists.set(cat, list);
    }
  }

  /** Asset for doodad number `index` of `category`, or null when the catalogue has none */
  pick(category: AssetCategory, index: number): string | null {
    const list = this.lists.get(category) ?? [];
    if (list.length === 0) return null;
    return list[hashIndex(index, 0x5eed) % list.length];
  }
}
