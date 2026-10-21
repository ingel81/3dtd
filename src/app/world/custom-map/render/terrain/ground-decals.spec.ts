import { createMapDocument } from '../../map-create';
import type { CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { DecalKind, GroundDecals, MAX_DECALS, STREAM_RADIUS, planDecals } from './ground-decals';
import { HeightTexture } from './height-texture';

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
  ['house', { id: 'house', category: 'building', footprint: 4, box: [0, 0, 3, 3] } as CatalogObject],
  ['snowpine', { id: 'snowpine', category: 'tree', footprint: 2, tags: ['conifer', 'winter'] } as CatalogObject],
]);

describe('planDecals', () => {
  it('wears soil along both edges of a road, beside it, not on it', () => {
    const decals = planDecals(doc(), entries);
    const soil = decals.filter((d) => d.kind === DecalKind.Soil);
    expect(soil.length).toBeGreaterThan(8);
    expect(soil.every((d) => Math.abs(d.y) > 3)).toBe(true);
    expect(soil.some((d) => d.y > 0) && soil.some((d) => d.y < 0)).toBe(true);
    // Beyond a pavement, not on it
    const paved = doc();
    paved.paths.edges[0].sidewalk = 2;
    expect(planDecals(paved, entries).filter((d) => d.kind === DecalKind.Soil).every((d) => Math.abs(d.y) > 5.6)).toBe(true);
  });

  it('wears no soil beside a paved road, none on another way and none on a surface drawn on the ground', () => {
    const paved = doc();
    paved.paths.edges[0].surface = 'asphalt';
    expect(planDecals(paved, entries).some((d) => d.kind === DecalKind.Soil)).toBe(false);
    // A dirt track 4 m north of a paved road: its southern patches would lie on the road
    const both = doc();
    both.paths.nodes.push({ id: 'c', x: -80, y: 7 }, { id: 'd', x: 80, y: 7 });
    both.paths.edges[0].surface = 'asphalt';
    both.paths.edges.push({ id: 'f', a: 'c', b: 'd', width: 2, kind: 'path' });
    const soil = planDecals(both, entries).filter((d) => d.kind === DecalKind.Soil);
    expect(soil.length).toBeGreaterThan(3);
    expect(soil.every((d) => d.y > 3)).toBe(true);
    // A car park north of the road takes the patches and the house's trodden path that would lie on it
    const park = doc();
    park.objects = [{ id: 'h', asset: 'house', x: 10, y: 14, z: 0, rotation: Math.PI, scale: 1 }];
    park.surfaces = [{ id: 's', material: 'asphalt', outer: [{ x: -80, y: 3 }, { x: 80, y: 3 }, { x: 80, y: 12 }, { x: -80, y: 12 }] }];
    const left = planDecals(park, entries).filter((d) => d.kind === DecalKind.Soil || d.kind === DecalKind.Path);
    expect(left.some((d) => d.y > 3 && d.y < 12)).toBe(false);
    expect(left.some((d) => d.y < -3)).toBe(true);
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

  it('treads a path from a house door to the edge of the nearest road, none from a house far from any', () => {
    const d = doc();
    // Facing south (rotation pi: front towards map -y) 14 m north of the road; a second house 60 m off it
    d.objects = [
      { id: 'h', asset: 'house', x: 10, y: 14, z: 0, rotation: Math.PI, scale: 1 },
      { id: 'far', asset: 'house', x: 10, y: 80, z: 0, rotation: 0, scale: 1 },
    ];
    const paths = planDecals(d, entries).filter((x) => x.kind === DecalKind.Path);
    expect(paths.length).toBeGreaterThanOrEqual(3);
    // From the front (y 11) down to the road's edge (y 3), each stretch narrow and along the way
    expect(paths.every((p) => p.y > 3 && p.y < 11.5 && Math.abs(p.x - 10) < 2.5)).toBe(true);
    expect(paths.every((p) => (p.stretch ?? 1) < 1)).toBe(true);
    expect(paths.every((p) => Math.abs(Math.abs(p.rotation) - Math.PI) < 0.01)).toBe(true);
    // No round patch at the door any more
    expect(planDecals(d, entries).some((x) => x.kind === DecalKind.Soil && x.y > 9)).toBe(false);
  });

  it('lays needles under conifers and a well in the snow under snowed-in trees', () => {
    const d = doc();
    d.objects = Array.from({ length: 40 }, (_, k) => ({ id: `t${k}`, asset: k % 2 ? 'pine' : 'snowpine', x: -60 + k * 3, y: 50, z: 0, rotation: 0, scale: 1 }));
    const decals = planDecals(d, entries);
    const needles = decals.filter((x) => x.kind === DecalKind.Needles);
    const wells = decals.filter((x) => x.kind === DecalKind.SnowWell);
    expect(needles.length).toBeGreaterThan(5);
    expect(wells.length).toBeGreaterThan(5);
    expect(needles.every((n) => d.objects.find((o) => o.x === n.x)?.asset === 'pine')).toBe(true);
    // On a snowed map every tree has a well, none a carpet of needles
    d.environment.snowCover = 0.8;
    expect(planDecals(d, entries).some((x) => x.kind === DecalKind.Needles)).toBe(false);
  });

  it('draws the decals round the focus, nearest first, and chooses again once it moved', () => {
    const field = new HeightField({ columns: 3, rows: 3, cellSize: 1000, heights: new Float32Array(9) }, 2000, 2000);
    const decals = new GroundDecals(new HeightTexture(field));
    const d = doc();
    d.paths = { nodes: [], edges: [] };
    // A forest of conifers along map x, a tree every 2 m from -900 to 900
    d.objects = Array.from({ length: 901 }, (_, k) => ({ id: `t${k}`, asset: 'pine', x: -900 + k * 2, y: 0, z: 0, rotation: 0, scale: 1 }));
    decals.set(d, entries);
    decals.update(0, 0);
    const drawn = (): number[] => Array.from({ length: decals.mesh.count }, (_, k) => (decals.mesh.geometry.getAttribute('aDecal').array as Float32Array)[k * 4]);
    const near = drawn();
    expect(near.length).toBeGreaterThan(100);
    expect(near.length).toBeLessThanOrEqual(MAX_DECALS);
    expect(near.every((x) => Math.abs(x) <= STREAM_RADIUS)).toBe(true);
    // A small step keeps them; a long one brings the ones there
    decals.update(10, 0);
    expect(drawn()).toEqual(near);
    decals.update(600, 0);
    expect(drawn().every((x) => Math.abs(x - 600) <= STREAM_RADIUS)).toBe(true);
    decals.dispose();
  });
});
