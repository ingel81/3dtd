import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../world/custom-map/map-create';
import { CatalogIndex, normalizeCatalog } from '../catalog/asset-catalog';
import { heightAt } from '../model/grid';
import { MapKit } from './map-kit';
import { readWeights } from './paint-ops';
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

describe('MapKit.rockyCoast', () => {
  it('raises a ragged cliff over the sea along the shore, rocks on its face and stones in the surf, and leaves the rest', () => {
    const k = kit();
    const t = k.doc.terrain;
    // Low land to the north, the sea 4 m deep to the south, a hill far inland
    const g = t.grid;
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = j * g.cellSize - 128 > 0 ? 1 : -4;
    k.raise({ x: 0, y: 90 }, { radius: 20, falloff: 0.2 }, 11);
    const hill = k.h(0, 90);
    k.sea(k.water(0, 'sea'));
    const placed = k.rockyCoast([{ x: -100, y: 0 }, { x: 100, y: 0 }], { land: 'left', top: 7 });
    // The shelf over the sea, the step down to the floor at its foot within a few metres
    const along = [-60, -40, -20, 0, 20, 40, 60];
    expect(Math.min(...along.map((x) => k.h(x, 8)))).toBeGreaterThan(5);
    expect(Math.max(...along.map((x) => k.h(x, -9)))).toBeLessThan(-2.5);
    // Inland, past the ends and the hill: as they were
    expect(k.h(0, 60)).toBeCloseTo(1, 5);
    expect(k.h(125, 10)).toBeCloseTo(1, 5);
    expect(k.h(0, 90)).toBeCloseTo(hill, 5);
    const rocks = placed.filter((o) => o.asset === 'cliff-coast');
    expect(rocks.length).toBeGreaterThanOrEqual(5);
    for (const o of rocks) {
      expect(Math.abs(o.y)).toBeLessThan(12);
      // From under the water to the cliff's edge (lower where it tapers out at the ends), the face to the sea (south)
      expect(k.h(o.x, o.y) + o.z).toBeLessThan(-1);
      if (Math.abs(o.x) < 80) expect(k.h(o.x, o.y) + o.z + index.object(o.asset).height * o.scale).toBeGreaterThan(5);
      expect(Math.abs(Math.abs(o.rotation) - Math.PI)).toBeLessThan(0.3);
    }
    const stones = placed.filter((o) => o.asset !== 'cliff-coast');
    expect(stones.length).toBeGreaterThan(0);
    for (const o of stones) {
      expect(o.y).toBeLessThan(0);
      // Each stone shows over the water
      expect(k.h(o.x, o.y) + o.z + index.object(o.asset).height * o.scale).toBeGreaterThan(0);
    }
  });

  it('finds the shore round an island, counter-clockwise, the land on its left', () => {
    const k = kit();
    k.doc.terrain.grid.heights.fill(-5);
    k.level({ x: 10, y: -20 }, { radius: 40, falloff: 0.1 }, 3);
    const shore = k.shoreAround({ x: 10, y: -20 }, 0, Math.PI);
    expect(shore.length).toBeGreaterThan(8);
    for (const p of shore) {
      expect(Math.hypot(p.x - 10, p.y + 20)).toBeGreaterThan(33);
      expect(Math.hypot(p.x - 10, p.y + 20)).toBeLessThan(42);
      expect(p.y).toBeGreaterThan(-21);
    }
    // From east round by north to west
    expect(shore[0].x).toBeGreaterThan(40);
    expect(shore[shore.length - 1].x).toBeLessThan(-20);
  });

  it('runs the Cliff rocks brush over steep ground only', () => {
    const k = kit();
    k.cliff([{ x: -60, y: 0 }, { x: 60, y: 0 }], 10, 20);
    const flat = k.cliffRocks({ x: 0, y: -60 }, { radius: 15 });
    expect(flat).toEqual([]);
    const ids = k.cliffRocks([{ x: -40, y: 0 }, { x: 40, y: 0 }], { radius: 8 });
    expect(ids.length).toBeGreaterThan(2);
    for (const id of ids) expect(Math.abs(k.doc.objects.find((o) => o.id === id)!.y)).toBeLessThan(10);
  });
});

/** A slope rising 0.5 m per metre to the north, 0 m along y = 0 */
function slope(k: MapKit): void {
  const g = k.doc.terrain.grid;
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = (j * g.cellSize - 128) * 0.5;
}

describe('MapKit.contour', () => {
  it('traces where the ground stands at a height across a slope, in pieces where it never gets there', () => {
    const k = kit();
    slope(k);
    const [line, ...rest] = k.contour({ x: -100, y: 0 }, { x: 100, y: 0 }, 10, { spacing: 10 });
    expect(rest).toEqual([]);
    expect(line.length).toBe(21);
    for (const p of line) expect(p.y).toBeCloseTo(20, 0);
    // Out of reach of the line it is looked up from: nothing
    expect(k.contour({ x: -100, y: 0 }, { x: 100, y: 0 }, 10, { spacing: 10, reach: 10 })).toEqual([]);
    // A hump on the line: the contour runs round it on its low side
    k.raise({ x: 0, y: 20 }, { radius: 30, falloff: 0.2 }, 30);
    const [round] = k.contour({ x: -100, y: 0 }, { x: 100, y: 0 }, 10, { spacing: 10, reach: 20 });
    expect(round.find((p) => p.x === 0)!.y).toBeLessThan(0);
    // Too far round for the reach: the line breaks there
    expect(k.contour({ x: -100, y: 20 }, { x: 100, y: 20 }, 10, { spacing: 10, reach: 6 }).length).toBe(2);
  });
});

describe('MapKit.glacier', () => {
  it('eases the ground under a tongue, sinks it, paints it with snow and sets ice at its snout', () => {
    const k = kit();
    slope(k);
    k.roughen({ x: 0, y: 40 }, { radius: 60, falloff: 1 }, 6, 3);
    const line = [{ x: 0, y: 100 }, { x: 0, y: 20 }];
    const rough = (): number => {
      let sum = 0;
      for (let y = 30; y <= 90; y += 2) sum += Math.abs(k.h(0, y + 2) - 2 * k.h(0, y) + k.h(0, y - 2));
      return sum;
    };
    const before = rough();
    const beside = k.h(-30, 60);
    const mid = k.h(0, 60);
    const placed = k.glacier(line, { width: 30, snow: 'snow-fresh', sink: 3, snout: ['ice-blocks'], moraine: ['scree-scatter'] });
    expect(rough()).toBeLessThan(before * 0.5);
    expect(k.h(0, 60) - mid).toBeLessThan(-1.5);
    expect(k.h(-30, 60)).toBeCloseTo(beside, 0);
    const snow = k.doc.terrain.layers.findIndex((l) => l.material === 'snow-fresh');
    const w = new Float32Array(8);
    readWeights(k.doc.terrain, (60 + 128) * 256 + 128, w);
    expect(w[snow]).toBeGreaterThan(0.6);
    const ice = placed.filter((o) => o.asset === 'ice-blocks');
    expect(ice.length).toBeGreaterThan(0);
    for (const o of ice) expect(Math.hypot(o.x, o.y - 20)).toBeLessThan(13);
    expect(placed.some((o) => o.asset === 'scree-scatter')).toBe(true);
  });
});

describe('MapKit.place', () => {
  it('aligns to the slope on request, as the Align to slope button does', () => {
    const k = kit();
    const g = k.doc.terrain.grid;
    // Rising 0.3 m per metre to the north
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = 0.3 * j * g.cellSize;
    const flat = k.place('shipwreck', 0, 0);
    const tilted = k.place('shipwreck', 20, 0, { align: true });
    expect(flat.pitch ?? 0).toBe(0);
    expect(Math.abs(tilted.pitch ?? 0)).toBeCloseTo(Math.atan(0.3), 1);
  });
});
