import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../world/custom-map/map-create';
import { CatalogIndex, normalizeCatalog } from '../catalog/asset-catalog';
import { heightAt } from '../model/grid';
import { MapKit } from './map-kit';
import { waterInAir } from '../validation/map-validation';

const index = new CatalogIndex(normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'));

function kit(): MapKit {
  const doc = createMapDocument({ id: 'm', name: 'M', width: 256, depth: 256, cellSize: 2, baseMaterial: 'grass', splatResolution: 256, starter: false, now: new Date(0) });
  return new MapKit(doc, index, { name: 't', seed: 7 });
}

describe('MapKit.quay', () => {
  it('stands the land at its top and the water side at its bed with a sheer step, bollards and lamps on the edge', () => {
    const k = kit();
    const placed = k.quay([{ x: -100, y: 0 }, { x: 100, y: 0 }], { top: 2.5, bed: -5, land: 'left', spacing: 10 });
    // Land to the left of a line running east is north
    expect(k.h(0, 6)).toBeCloseTo(2.5, 1);
    expect(k.h(0, -6)).toBeCloseTo(-5, 1);
    // One cell from the line on either side: the step is sheer
    expect(heightAt(k.doc.terrain, 0, 2.5) - heightAt(k.doc.terrain, 0, -2.5)).toBeGreaterThan(6);
    const bollards = placed.filter((o) => o.asset === 'bollards');
    const lamps = placed.filter((o) => o.asset === 'street-lamp');
    // One every 10 m along 200 m (two skipped next to the map's HQ in the middle), a lamp at every second
    expect(bollards.length).toBeGreaterThanOrEqual(17);
    expect(lamps.length).toBeGreaterThanOrEqual(8);
    for (const o of [...bollards, ...lamps]) expect(o.y).toBeGreaterThan(0);
  });
});

describe('MapKit.fillToRim', () => {
  it('sets a lake to just under where its hollow overflows, its mask the hollow alone', () => {
    const k = kit();
    k.doc.terrain.grid.heights.fill(2);
    k.level({ x: 0, y: 0 }, { radius: 30, falloff: 0.2 }, -1);
    // Dug at a level over the land round it: its mask, 40 m round the middle, ends in the air
    const lake = k.body(3, 'water');
    const t = k.doc.terrain;
    const g = t.grid;
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.columns; i++) if (Math.hypot(i * g.cellSize - 128, j * g.cellSize - 128) < 40) t.waterBodies![lake].mask[j * g.columns + i] = 255;
    }
    expect(waterInAir(k.doc).length).toBeGreaterThan(0);
    expect(k.fillToRim({ x: 0, y: 0 }, lake)).toBeCloseTo(1.7, 5);
    expect(waterInAir(k.doc)).toEqual([]);
  });
});
