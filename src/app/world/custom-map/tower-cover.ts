import type { BuildCatalogEntry } from './custom-map-surface';
import type { MapObject } from './map-document';

/**
 * What a tower's plinth covers of a map: the low barriers (catalogue
 * category `wall` that block no building: a hedge, a fence, a low wall)
 * under it leave the picture while it stands, so a tower may be built
 * across a garden's hedge without the hedge running through its plinth.
 * Only the picture: the barriers block no sight to speak of and the run
 * never reads them.
 */
export function lowBarriersUnder(
  objects: readonly MapObject[],
  entries: ReadonlyMap<string, Pick<BuildCatalogEntry, 'footprint' | 'blocksBuild' | 'box' | 'category'>>,
  x: number,
  y: number,
  radius: number,
): string[] {
  const out: string[] = [];
  for (const o of objects) {
    const e = entries.get(o.asset);
    if (!e || e.category !== 'wall' || (o.blocksBuild ?? e.blocksBuild)) continue;
    const s = o.scale || 1;
    // A rough reach first: its circle on the ground
    if (Math.hypot(o.x - x, o.y - y) > radius + e.footprint * s) continue;
    if (!e.box) {
      out.push(o.id);
      continue;
    }
    // Its ground rectangle, turned with it (as CustomMapSurface reads it)
    const cos = Math.cos(o.rotation);
    const sin = Math.sin(o.rotation);
    const [cx, cz, hx, hz] = e.box;
    const ox = x - (o.x - (cx * cos + cz * sin) * s);
    const oy = y - (o.y - cx * sin * s + cz * cos * s);
    const mx = Math.max(0, Math.abs(-ox * cos - oy * sin) - hx * s);
    const mz = Math.max(0, Math.abs(-ox * sin + oy * cos) - hz * s);
    if (mx * mx + mz * mz <= radius * radius) out.push(o.id);
  }
  return out;
}
