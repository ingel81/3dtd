import { createMapDocument } from '../../world/custom-map/map-create';
import { heightAt } from '../model/grid';
import { nearestOnEdges } from './path-graph';
import { finishGenerated, generateTerrain, TERRAIN_PRESETS, type TerrainPreset } from './generate';

const fresh = () => createMapDocument({ id: 'g', name: 'G', width: 512, depth: 512, cellSize: 4, now: new Date(0) });

describe('terrain generator', () => {
  it('gives the same ground for the same seed and another for another', () => {
    const a = fresh();
    const b = fresh();
    const c = fresh();
    generateTerrain(a.terrain, { preset: 'hills', seed: 5, strength: 0.6 });
    generateTerrain(b.terrain, { preset: 'hills', seed: 5, strength: 0.6 });
    generateTerrain(c.terrain, { preset: 'hills', seed: 6, strength: 0.6 });
    expect(Array.from(a.terrain.grid.heights)).toEqual(Array.from(b.terrain.grid.heights));
    expect(Array.from(c.terrain.grid.heights)).not.toEqual(Array.from(a.terrain.grid.heights));
  });

  it('every preset makes its kind of land', () => {
    const range = (p: TerrainPreset) => {
      const d = fresh();
      generateTerrain(d.terrain, { preset: p, seed: 3, strength: 1 });
      const h = Array.from(d.terrain.grid.heights);
      return { min: Math.min(...h), max: Math.max(...h), d };
    };
    for (const p of TERRAIN_PRESETS) expect(Number.isFinite(range(p.id).max)).toBe(true);
    expect(range('flat').max).toBe(0);
    const islands = range('islands');
    expect(heightAt(islands.d.terrain, 0, 0)).toBeGreaterThan(0);
    expect(heightAt(islands.d.terrain, 250, 250)).toBeLessThan(0);
    const canyon = range('canyon');
    expect(canyon.max - canyon.min).toBeGreaterThan(20);
  });

  it('a generated map stays playable: water, levelled roads above it, paint', () => {
    const d = fresh();
    const res = generateTerrain(d.terrain, { preset: 'islands', seed: 9, strength: 0.8 });
    finishGenerated(d, res, (m) => ['sand', 'rocky-ground'].includes(m));
    const t = d.terrain;
    expect(t.water?.level).toBe(0);
    expect(t.layers.map((l) => l.material)).toEqual(['grass', 'sand', 'rocky-ground']);
    for (const x of [-240, -150, 0, 100]) {
      expect(nearestOnEdges(d.paths, { x, y: 0 })!.dist).toBeLessThan(1);
      expect(heightAt(t, x, 0)).toBeGreaterThan(0.5);
    }
  });

  it('adds onto existing ground', () => {
    const d = fresh();
    d.terrain.grid.heights.fill(10);
    generateTerrain(d.terrain, { preset: 'flat', seed: 1, strength: 1, add: true });
    expect(heightAt(d.terrain, 0, 0)).toBe(10);
  });
});
