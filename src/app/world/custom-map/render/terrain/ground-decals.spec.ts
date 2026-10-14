import { createMapDocument } from '../../map-create';
import type { CatalogObject } from '../asset-catalog';
import { DecalKind, planDecals } from './ground-decals';

function doc() {
  const d = createMapDocument({ id: 'd', name: 'D', width: 200, depth: 200, ground: 'flat', seed: 1, now: new Date('2026-10-14T00:00:00Z') });
  d.paths = {
    nodes: [
      { id: 'a', x: -80, y: 0 },
      { id: 'b', x: 80, y: 0 },
    ],
    edges: [{ id: 'e', a: 'a', b: 'b', width: 6, kind: 'road' }],
  };
  return d;
}

const entries = new Map<string, CatalogObject>([
  ['oak', { id: 'oak', category: 'tree', footprint: 2, tags: ['temperate'] } as CatalogObject],
  ['pine', { id: 'pine', category: 'tree', footprint: 2, tags: ['conifer'] } as CatalogObject],
  ['house', { id: 'house', category: 'building', footprint: 4 } as CatalogObject],
]);

describe('planDecals', () => {
  it('wears soil along both edges of a road, beside it, not on it', () => {
    const decals = planDecals(doc(), entries);
    const soil = decals.filter((d) => d.kind === DecalKind.Soil);
    expect(soil.length).toBeGreaterThan(8);
    expect(soil.every((d) => Math.abs(d.y) > 3)).toBe(true);
    expect(soil.some((d) => d.y > 0) && soil.some((d) => d.y < 0)).toBe(true);
  });

  it('drops leaves under broadleaf trees, not under conifers, and puddles only in the wet', () => {
    const d = doc();
    d.objects = Array.from({ length: 40 }, (_, k) => ({ id: `t${k}`, asset: k % 2 ? 'oak' : 'pine', x: -60 + k * 3, y: 50, z: 0, rotation: 0, scale: 1 }));
    const leaves = planDecals(d, entries).filter((x) => x.kind === DecalKind.Leaves);
    expect(leaves.length).toBeGreaterThan(3);
    expect(leaves.every((l) => d.objects.find((o) => o.x === l.x)?.asset === 'oak')).toBe(true);
    expect(planDecals(d, entries).some((x) => x.kind === DecalKind.Puddle)).toBe(false);
    d.environment.weather = 'rain';
    expect(planDecals(d, entries).some((x) => x.kind === DecalKind.Puddle)).toBe(true);
  });
});
