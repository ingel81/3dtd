import { MAX_MAP_BYTES } from '../../coop/protocol';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { objectCost, sceneCost, SCENE_BUDGET } from '../../world/custom-map/render/objects/scene-cost';
import type { CatalogIndex } from '../asset-catalog';

/**
 * What a map spends of its budget, for the Map panel: the scene cost of its
 * objects against what keeps a map fluid (scene-cost.ts, SCENE_BUDGET), the
 * file against what a coop room can send (MAX_MAP_BYTES).
 */

/** From this share on a line shows as a warning */
export const WARN_SHARE = 0.8;

/** One line of the budget; the panel says it (i18n `editor.budget`) */
export interface BudgetLine {
  /** The objects' scene cost, or the packed file */
  kind: 'scene' | 'file';
  used: number;
  limit: number;
  /** The objects on the map (the scene line) */
  objects?: number;
  /** Share spent, 0 to 1 and above */
  share: number;
  state: 'ok' | 'warn' | 'over';
}

function line(kind: BudgetLine['kind'], used: number, limit: number, objects?: number): BudgetLine {
  const share = used / limit;
  return { kind, used, limit, objects, share, state: share > 1 ? 'over' : share >= WARN_SHARE ? 'warn' : 'ok' };
}

/** What one object of an asset costs on this map, alone or as a piece of a line (scene-cost.ts objectCost), by the editor's catalogue */
export function assetCosts(catalog: CatalogIndex, doc: Pick<CustomMapDocument, 'terrain'>): (asset: string, inLine: boolean) => number {
  const area = doc.terrain.width * doc.terrain.depth;
  return (asset, inLine) => objectCost(catalog.objects.get(asset)?.drawing, area, inLine);
}

/** The scene cost of a map's objects in points (scene-cost.ts) */
export function mapSceneCost(doc: Pick<CustomMapDocument, 'terrain' | 'objects'>, catalog: CatalogIndex): number {
  return sceneCost(doc.objects, assetCosts(catalog, doc));
}

/** The budget lines; the file line only once its size is known (packed at a save) */
export function mapBudget(cost: number, objects: number, fileBytes: number | null): BudgetLine[] {
  const lines = [line('scene', cost, SCENE_BUDGET, objects)];
  if (fileBytes !== null) lines.push(line('file', fileBytes, MAX_MAP_BYTES));
  return lines;
}
