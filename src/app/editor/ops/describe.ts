/** What a spot on the map or a picked thing is, in a few words (Look, the status line) */
import type { CatalogIndex } from '../../map-ops/asset-catalog';
import type { CustomMapDocument, MapTerrain } from '../../world/custom-map/map-document';
import type { PickResult } from '../model/editor-document';
import { nearestSample, slopeAt, heightAt } from '../../map-ops/grid';
import { dominantLayer } from '../../map-ops/paint-ops';

/** A ground point in words: its ground layer, height, slope and the water over it */
export function describeGround(t: MapTerrain, x: number, y: number, catalog: CatalogIndex): { what: string; height: string; slope: string; water: string } {
  const layer = t.layers[dominantLayer(t, x, y)];
  const ground = layer ? catalog.material(layer.material).name : 'Ground';
  const h = heightAt(t, x, y);
  const { i, j } = nearestSample(t, x, y);
  const k = j * t.grid.columns + i;
  const bodies = [t.water, ...(t.waterBodies ?? [])].filter((w) => !!w && w.mask[k] && w.level > h);
  const top = bodies.reduce<(typeof bodies)[number] | null>((a, w) => (!a || w!.level > a.level ? w : a), null);
  const kind = top ? (top.kind ?? 'water') : null;
  return {
    what: `${ground}${kind ? `, under ${kind}` : ''}`,
    height: `${h.toFixed(1)} m`,
    slope: `${Math.round(slopeAt(t, x, y))} deg`,
    water: top ? `${kind} ${(top.level - h).toFixed(1)} m deep` : 'dry',
  };
}

/** What a picked thing is, in a few words for the status line and the panel */
export function describePick(picked: PickResult, doc: CustomMapDocument, catalog: CatalogIndex): string {
  switch (picked.kind) {
    case 'object': {
      const o = doc.objects.find((x) => x.id === picked.id);
      if (!o) return 'Object';
      const entry = catalog.object(o.asset);
      return `${entry.name} (${entry.category.toLowerCase()})`;
    }
    case 'spawn':
      return `Spawn ${doc.spawns.find((s) => s.id === picked.id)?.name ?? ''}`.trim();
    case 'hq':
      return 'HQ';
    case 'node':
      return 'Road node';
    case 'edge': {
      const e = doc.paths.edges.find((x) => x.id === picked.id);
      return e ? `${e.kind === 'path' ? 'Path' : e.kind === 'bridge' ? 'Bridge' : 'Road'}, ${Math.round(e.width)} m wide` : 'Road';
    }
  }
}
