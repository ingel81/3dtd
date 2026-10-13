import { createMapDocument } from '../../world/custom-map/map-create';
import { heightAt } from '../model/grid';
import { detailTarget, increaseDetail } from './detail';
import { emptyWater } from './water-ops';

describe('increase detail', () => {
  it('refines a 4 m map to 2 m with the splat of new maps, the extent and every old height kept', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 400, depth: 200, cellSize: 4, splatResolution: 128 });
    const t = doc.terrain;
    const g = t.grid;
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = Math.sin(i / 7) * 5 + j * 0.3;
    t.water = emptyWater(t, 1);
    t.water.mask.fill(255, 0, g.columns * 10);
    t.waterBodies = [emptyWater(t, 3)];
    t.splat.maps[0].fill(0);
    for (let k = 0; k < 128 * 128; k++) t.splat.maps[0][k * 4 + 1] = 200;

    const target = detailTarget(t)!;
    expect(target).toEqual({ cellSize: 2, columns: 201, rows: 101, splatResolution: 256 });
    const fine = increaseDetail(t, target);
    expect([fine.width, fine.depth]).toEqual([400, 200]);
    for (let j = 0; j < g.rows; j += 7) {
      for (let i = 0; i < g.columns; i += 5) expect(fine.grid.heights[2 * j * 201 + 2 * i]).toBe(g.heights[j * g.columns + i]);
    }
    expect(heightAt(fine, 13, -27)).toBeCloseTo(heightAt(t, 13, -27), 4);
    expect(fine.water!.mask[0]).toBe(255);
    expect(fine.water!.mask[201 * 30]).toBe(0);
    expect(fine.waterBodies![0].mask).toHaveLength(201 * 101);
    expect(fine.splat.maps[0][(100 * 256 + 100) * 4 + 1]).toBe(200);
    // The old terrain is untouched, the new one needs nothing more
    expect(g.columns).toBe(101);
    expect(detailTarget(fine)).toBeNull();
  });

  it('keeps the extent exact with a cell that 2 m does not divide, and leaves fine maps alone', () => {
    const coarse = createMapDocument({ id: 'm', name: 'M', width: 300, depth: 300, cellSize: 3 });
    expect(detailTarget(coarse.terrain)).toMatchObject({ cellSize: 1.5, columns: 201 });
    const fine = createMapDocument({ id: 'f', name: 'F', width: 512, depth: 512 });
    expect(fine.terrain.grid.cellSize).toBe(2);
    expect(fine.terrain.splat.resolution).toBe(512);
    expect(detailTarget(fine.terrain)).toBeNull();
  });
});
