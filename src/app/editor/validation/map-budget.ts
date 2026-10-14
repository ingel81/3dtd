import { MAX_MAP_BYTES } from '../../coop/protocol';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { objectCost, sceneCost, SCENE_BUDGET } from '../../world/custom-map/render/objects/scene-cost';
import type { CatalogIndex } from '../catalog/asset-catalog';

/**
 * What a map spends of its budget, for the Map panel: the scene cost of its
 * objects against what keeps a map fluid (scene-cost.ts, SCENE_BUDGET), the
 * file against what a coop room can send (MAX_MAP_BYTES).
 */

/** From this share on a line shows as a warning */
export const WARN_SHARE = 0.8;

export interface BudgetLine {
  label: string;
  /** What is spent of what, as text */
  text: string;
  /** Second line under the bar (the scene cost's object count) */
  detail?: string;
  /** Share spent, 0 to 1 and above */
  share: number;
  state: 'ok' | 'warn' | 'over';
}

function line(label: string, used: number, limit: number, text: (share: number) => string, detail?: string): BudgetLine {
  const share = used / limit;
  return { label, text: text(share), detail, share, state: share > 1 ? 'over' : share >= WARN_SHARE ? 'warn' : 'ok' };
}

function mb(bytes: number): string {
  return `${(bytes / 2 ** 20).toFixed(1)} MB`;
}

/** What one object of an asset costs on this map, by the editor's catalogue */
export function assetCosts(catalog: CatalogIndex, doc: Pick<CustomMapDocument, 'terrain'>): (asset: string) => number {
  const area = doc.terrain.width * doc.terrain.depth;
  return (asset) => objectCost(catalog.objects.get(asset)?.drawing, area);
}

/** The scene cost of a map's objects in points (scene-cost.ts) */
export function mapSceneCost(doc: Pick<CustomMapDocument, 'terrain' | 'objects'>, catalog: CatalogIndex): number {
  return sceneCost(doc.objects, assetCosts(catalog, doc));
}

/** The budget lines; the file line only once its size is known (packed at a save) */
export function mapBudget(cost: number, objects: number, fileBytes: number | null): BudgetLine[] {
  const lines = [
    line('Scene cost', cost, SCENE_BUDGET, (share) => `${Math.round(share * 100)} %`, `${objects.toLocaleString('en-US')} objects`),
  ];
  if (fileBytes !== null) lines.push(line('File', fileBytes, MAX_MAP_BYTES, () => `${mb(fileBytes)} of ${mb(MAX_MAP_BYTES)}`));
  return lines;
}
