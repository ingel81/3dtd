import { createMapDocument } from '../../world/custom-map/map-create';
import { contentBytes } from '../../world/custom-map/map-file';
import { heightAt } from '../model/grid';
import { MAX_SPAWN_PORTALS } from '../../configs/marker-geometry.config';
import { mirrorMap } from './mirror-map';

function map() {
  const doc = createMapDocument({ id: 'm', name: 'M', width: 200, depth: 200, cellSize: 4 });
  const g = doc.terrain.grid;
  // A hill in the west, a dip in the east
  for (let j = 0; j < g.rows; j++) {
    for (let i = 0; i < g.columns; i++) {
      const x = -100 + i * 4;
      const y = -100 + j * 4;
      g.heights[j * g.columns + i] = Math.max(0, 10 - Math.hypot(x + 50, y) / 3) - Math.max(0, 5 - Math.hypot(x - 50, y) / 4);
    }
  }
  return doc;
}

describe('mirrorMap', () => {
  it('makes the map mirror east and west from the western half', () => {
    const doc = map();
    doc.objects.push(
      { id: 'o1', asset: 'tree', x: -40, y: 10, z: 0, rotation: 0.5, scale: 1, group: 'g1' },
      { id: 'o2', asset: 'rock', x: 60, y: 0, z: 0, rotation: 0, scale: 1 },
    );
    const result = mirrorMap(doc, 'x', { x: -50, y: 0 });
    for (const [x, y] of [[-50, 0], [-30, 20], [-70, -12]]) expect(heightAt(doc.terrain, -x, y)).toBeCloseTo(heightAt(doc.terrain, x, y), 4);
    // The eastern rock went, the tree has a mirror image turned the other way, in a group of its own
    expect(doc.objects.map((o) => [o.asset, o.x, o.y])).toEqual([['tree', -40, 10], ['tree', 40, 10]]);
    expect(doc.objects[1].rotation).toBeCloseTo(2 * Math.PI - 0.5, 3);
    expect(doc.objects[1].group).toBe('g1m1');
    expect(result.objects).toBe(1);
    // The starter road from the west to the HQ east of the middle crosses the axis: it ends at the image of its west end
    const nodes = new Map(doc.paths.nodes.map((n) => [n.id, n]));
    const ends = doc.paths.edges.map((e) => [nodes.get(e.a)!.x, nodes.get(e.b)!.x].sort((a, b) => a - b));
    expect(ends).toContainEqual([-92, 92]);
    // The spawn at the west end gets its twin in the east
    expect(doc.spawns.map((s) => s.x).sort((a, b) => a - b)).toEqual([-92, 92]);
    expect(new Set(doc.spawns.map((s) => s.id)).size).toBe(2);
  });

  it('copies a quarter to the other three with Both, and does nothing without a symmetry', () => {
    const doc = map();
    doc.objects.push({ id: 'o1', asset: 'tree', x: -40, y: -30, z: 0, rotation: 0, scale: 1 });
    mirrorMap(doc, 'xy', { x: -50, y: -50 });
    expect(doc.objects.map((o) => `${o.x},${o.y}`).sort()).toEqual(['-40,-30', '-40,30', '40,-30', '40,30']);
    const before = contentBytes(doc);
    expect(mirrorMap(doc, 'none', { x: 0, y: 0 })).toEqual({ objects: 0, spawns: 0, roads: 0 });
    expect(contentBytes(doc)).toEqual(before);
  });
  it('adds no more spawn images than a map holds', () => {
    const doc = map();
    doc.spawns = Array.from({ length: 10 }, (_, k) => ({ id: `s${k}`, name: `S${k}`, x: -90 + k * 4, y: -60 }));
    const result = mirrorMap(doc, 'xy', { x: -50, y: -50 });
    expect(doc.spawns.length).toBe(MAX_SPAWN_PORTALS);
    expect(result.spawns).toBe(MAX_SPAWN_PORTALS - 10);
    expect(result.spawnsLeftOut).toBe(30 - (MAX_SPAWN_PORTALS - 10));
  });
});
