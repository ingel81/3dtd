import { createMapDocument } from '../../world/custom-map/map-create';
import { heightAt } from '../../map-ops/grid';
import { raiseDab } from '../../map-ops/terrain-ops';
import { emptyWater } from '../../map-ops/water-ops';
import { resizeMap } from './resize';

describe('resize', () => {
  it('keeps the shared middle and drops what falls outside', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 200, depth: 200, cellSize: 2 });
    raiseDab(doc.terrain, 0, 0, { radius: 10, strength: 1, falloff: 0 }, 5);
    doc.objects.push({ id: 'o1', asset: 'a', x: 90, y: 90, z: 0, rotation: 0, scale: 1 }, { id: 'o2', asset: 'a', x: 1, y: 1, z: 0, rotation: 0, scale: 1 });
    const result = resizeMap(doc, 100, 120);
    expect(doc.terrain.width).toBe(100);
    expect(doc.terrain.depth).toBe(120);
    expect(doc.terrain.grid.heights.length).toBe(51 * 61);
    expect(heightAt(doc.terrain, 0, 0)).toBeCloseTo(5);
    expect(result.droppedObjects).toBe(1);
    expect(Math.abs(doc.spawns[0].x)).toBeLessThanOrEqual(50);
    // The starter road loses its west end
    expect(doc.paths.edges).toHaveLength(0);
    const bigger = createMapDocument({ id: 'b', name: 'B', width: 40, depth: 40, cellSize: 2 });
    raiseDab(bigger.terrain, 19, 0, { radius: 2, strength: 1, falloff: 0 }, 3);
    resizeMap(bigger, 80, 40);
    // New ground takes the edge height
    expect(heightAt(bigger.terrain, 30, 0)).toBeCloseTo(heightAt(bigger.terrain, 20, 0));
  });

  it('resizes the masks of further water bodies with the grid', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 100, depth: 100, cellSize: 2 });
    const lake = emptyWater(doc.terrain, 2);
    lake.mask[25 * 51 + 25] = 255;
    doc.terrain.waterBodies = [lake];
    resizeMap(doc, 60, 40);
    const g = doc.terrain.grid;
    expect(doc.terrain.waterBodies![0].mask).toHaveLength(g.columns * g.rows);
    expect(doc.terrain.waterBodies![0].mask[10 * g.columns + 15]).toBe(255);
  });
});
