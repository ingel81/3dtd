import { worldOfMap, type WorldId } from '../worlds/world-rules';
import { openedCustomMap } from './custom-map/custom-map-world';
import type { WorldRef } from './world-ref';

/**
 * The world of the globes a page's game plays in: the real places for the
 * tiles and an own tileset, OpenStreetMap or the Built Worlds for a map by
 * its document (worldOfMap), none for DevWorld
 */
export function worldOfPage(ref: WorldRef): WorldId | null {
  if (ref.kind === 'custom-map') return worldOfMap(openedCustomMap(ref)?.doc.meta);
  return ref.kind === 'devworld' ? null : 'real';
}
