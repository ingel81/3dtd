/** What a spot on the map or a picked thing is, in a few words (Look, the status line) */
import type { CatalogIndex } from '../../map-ops/asset-catalog';
import type { CustomMapDocument, MapTerrain } from '../../world/custom-map/map-document';
import type { PickResult } from '../model/editor-document';
import { nearestSample, slopeAt, heightAt } from '../../map-ops/grid';
import { dominantLayer } from '../../map-ops/paint-ops';
import type { Messages } from '../../i18n/messages/en';

/** A ground point in words: its ground layer, height, slope and the water over it */
export function describeGround(t: MapTerrain, x: number, y: number, catalog: CatalogIndex, words: Messages): { what: string; height: string; slope: string; water: string } {
  const w = words.editor.look;
  const layer = t.layers[dominantLayer(t, x, y)];
  const ground = layer ? catalog.material(layer.material).name : w.ground;
  const h = heightAt(t, x, y);
  const { i, j } = nearestSample(t, x, y);
  const k = j * t.grid.columns + i;
  const bodies = [t.water, ...(t.waterBodies ?? [])].filter((w) => !!w && w.mask[k] && w.level > h);
  const top = bodies.reduce<(typeof bodies)[number] | null>((a, w) => (!a || w!.level > a.level ? w : a), null);
  const kind = top ? words.editor.water.kinds[top.kind ?? 'water'] : null;
  return {
    what: kind ? w.under(ground, kind) : ground,
    height: w.metres(h),
    slope: w.degrees(Math.round(slopeAt(t, x, y))),
    water: top && kind ? w.deep(kind, top.level - h) : w.dry,
  };
}

/** What a picked thing is, in a few words for the status line and the panel */
export function describePick(picked: PickResult, doc: CustomMapDocument, catalog: CatalogIndex, words: Messages): string {
  const w = words.editor.look;
  switch (picked.kind) {
    case 'object': {
      const o = doc.objects.find((x) => x.id === picked.id);
      if (!o) return w.object;
      const entry = catalog.object(o.asset);
      return w.asset(entry.name, categoryWord(words, entry.category));
    }
    case 'spawn':
      return w.spawn(doc.spawns.find((s) => s.id === picked.id)?.name ?? '');
    case 'hq':
      return w.hq;
    case 'node':
      return w.node;
    case 'edge': {
      const e = doc.paths.edges.find((x) => x.id === picked.id);
      const kind = words.editor.paths.kinds[e?.kind ?? 'road'] ?? words.editor.paths.kinds.road;
      return e ? w.road(kind, Math.round(e.width)) : kind;
    }
  }
}

/** A catalogue category in the player's words, its own name where this build has none */
export function categoryWord(words: Messages, category: string): string {
  return (words.editor.categories as Record<string, string>)[category.toLowerCase()] ?? category.toLowerCase();
}
