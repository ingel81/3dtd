import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../../world/custom-map/map-create';
import type { CustomMapDocument } from '../../../world/custom-map/map-document';
import { CatalogIndex, normalizeCatalog } from '../../catalog/asset-catalog';
import { EditorDocument, mergeChanges, type DocChange } from '../../model/editor-document';
import { heightAt } from '../../model/grid';
import { edgePolyline, nearestOnEdges } from '../path-graph';
import { biomeDab, finishBiome, previewSpots } from './biome-brush';
import { biomeById, BIOMES } from './biomes';
import { erosionDab } from './erosion';
import { LandscapeStroke } from './landscape-stroke';
import { carveRiver, DEFAULT_RIVER, recarveRiver, removeRiver } from './river';
import { movePoint, simplifyRiver } from '../river-edit';
import { buildRoad, DEFAULT_ROAD } from './road';
import { citySlots, streetDistance } from './city';
import { cliffAlong, craterProfile, formDab, formHeight } from './shapes';
import { cracksDab } from './cracks';
import { readWeights } from '../paint-ops';

const catalog = new CatalogIndex(
  normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'),
);

function map(): EditorDocument {
  return new EditorDocument(createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400, cellSize: 2, now: new Date(0) }));
}

const brush = { radius: 40, strength: 1, falloff: 0.5 };

/** A biome stroke along y = 80 from x = -100 to 100, a dab every 5 m */
function paint(ed: EditorDocument, biome: string, seed: number, strength = 1, step = 5): LandscapeStroke {
  const stroke = new LandscapeStroke(ed, 'Biome', seed, catalog);
  const def = biomeById(biome as never);
  const b = { ...brush, strength };
  for (let x = -100; x <= 100; x += step) for (let k = 0; k < 4; k++) biomeDab(stroke, { x, y: 80 }, b, def, 0.1);
  finishBiome(stroke, b, def);
  stroke.finish();
  return stroke;
}

function snapshot(doc: CustomMapDocument) {
  return {
    heights: Array.from(doc.terrain.grid.heights),
    splat: [Array.from(doc.terrain.splat.maps[0]), Array.from(doc.terrain.splat.maps[1])],
    layers: doc.terrain.layers.map((l) => l.material),
    objects: doc.objects.map((o) => ({ ...o })),
    water: doc.terrain.water ? Array.from(doc.terrain.water.mask) : null,
    bodies: (doc.terrain.waterBodies ?? []).map((b) => ({ kind: b.kind, level: b.level, mask: Array.from(b.mask) })),
  };
}

describe('biome brush', () => {
  it('paints the same land for the same seed and strokes', () => {
    const a = map();
    const b = map();
    paint(a, 'forest', 42);
    paint(b, 'forest', 42);
    expect(snapshot(a.doc)).toEqual(snapshot(b.doc));
    const c = map();
    paint(c, 'forest', 43);
    expect(snapshot(c.doc).objects).not.toEqual(snapshot(a.doc).objects);
  });

  it('grows a forest with trees in the middle and bushes at the rim', () => {
    const ed = map();
    paint(ed, 'forest', 1);
    const trees = ed.doc.objects.filter((o) => o.asset.startsWith('tree'));
    const bushes = ed.doc.objects.filter((o) => ['bush', 'shrub', 'bush-ivy'].includes(o.asset));
    expect(trees.length).toBeGreaterThan(40);
    expect(bushes.length).toBeGreaterThan(5);
    const meanDist = (list: typeof trees) => list.reduce((s, o) => s + Math.abs(o.y - 80), 0) / list.length;
    expect(meanDist(bushes)).toBeGreaterThan(meanDist(trees));
    expect(ed.doc.terrain.layers.map((l) => l.material)).toContain('forest-floor');
  });

  it('grows more where the brush is stronger', () => {
    const weak = map();
    const strong = map();
    paint(weak, 'conifer', 5, 0.3);
    paint(strong, 'conifer', 5, 1);
    expect(strong.doc.objects.length).toBeGreaterThan(weak.doc.objects.length * 1.8);
  });

  it('keeps roads, spawns and the HQ free and leaves the road ground alone', () => {
    const ed = map();
    const doc = ed.doc;
    // The starter road runs along y = 0 from the west edge to the HQ
    const roadY = heightAt(doc.terrain, 0, 0);
    const stroke = new LandscapeStroke(ed, 'Biome', 9, catalog);
    for (let x = -150; x <= 150; x += 5) for (let k = 0; k < 4; k++) biomeDab(stroke, { x, y: 0 }, brush, biomeById('rocks'), 0.1);
    stroke.finish();
    expect(doc.objects.length).toBeGreaterThan(10);
    for (const o of doc.objects) {
      const hit = nearestOnEdges(doc.paths, o)!;
      expect(hit.dist).toBeGreaterThan(hit.edge.width / 2);
      expect(Math.hypot(o.x - doc.hq.x, o.y - doc.hq.y)).toBeGreaterThan(10);
      for (const s of doc.spawns) expect(Math.hypot(o.x - s.x, o.y - s.y)).toBeGreaterThan(10);
    }
    expect(heightAt(doc.terrain, 0, 0)).toBeCloseTo(roadY, 5);
  });

  it('frays its rim instead of a clean circle', () => {
    const ed = map();
    const stroke = new LandscapeStroke(ed, 'Biome', 3, catalog);
    for (let k = 0; k < 10; k++) biomeDab(stroke, { x: 0, y: 100 }, brush, biomeById('desert'), 0.1);
    stroke.finish();
    const t = ed.doc.terrain;
    // The desert's ground, whichever of its materials
    const grass = t.layers.findIndex((l) => l.material === 'grass');
    const res = t.splat.resolution;
    let painted = 0;
    let bare = 0;
    for (let a = 0; a < 64; a++) {
      const x = Math.cos((a / 64) * Math.PI * 2) * 34;
      const y = 100 + Math.sin((a / 64) * Math.PI * 2) * 34;
      const u = Math.floor(((x + 200) / 400) * res);
      const v = Math.floor(((y + 200) / 400) * res);
      const w = t.splat.maps[grass >> 2][(v * res + u) * 4 + (grass & 3)];
      if (w < 128) painted++;
      else bare++;
    }
    expect(painted).toBeGreaterThan(4);
    expect(bare).toBeGreaterThan(4);
  });

  it('is one undo step, layers, water and objects included', () => {
    const ed = map();
    const before = snapshot(ed.doc);
    paint(ed, 'swamp', 11);
    // Swamp pools fill a body of swamp water, not the main water
    expect(ed.doc.terrain.water).toBeNull();
    expect(ed.doc.terrain.waterBodies?.map((b) => b.kind)).toEqual(['swamp']);
    expect(ed.doc.objects.length).toBeGreaterThan(0);
    expect(ed.historySteps).toBe(1);
    ed.undo();
    expect(snapshot(ed.doc)).toEqual(before);
    expect(ed.doc.terrain.waterBodies).toBeUndefined();
    ed.redo();
    expect(ed.doc.terrain.waterBodies![0].mask.some((v) => v > 0)).toBe(true);
  });

  it('tells the view which pool body changed, so only it redraws', () => {
    const ed = map();
    const seen: DocChange[] = [];
    ed.onChange((c) => seen.push(c));
    paint(ed, 'swamp', 11);
    const pools = seen.filter((c) => c.bodies);
    expect(pools.length).toBeGreaterThan(0);
    expect(pools.every((c) => c.bodies!.join() === '0' && !!c.bodyRect)).toBe(true);
    // Only the new body itself made all water redraw, once
    expect(seen.filter((c) => c.water)).toHaveLength(1);
    const merged = mergeChanges({ bodies: [0], bodyRect: { i0: 0, j0: 0, i1: 2, j1: 2 } }, { bodies: [1], bodyRect: { i0: 5, j0: 5, i1: 6, j1: 6 } });
    expect(merged).toMatchObject({ bodies: [0, 1], bodyRect: { i0: 0, j0: 0, i1: 6, j1: 6 } });
  });

  it('every biome paints with the shipped catalogue', () => {
    for (const b of BIOMES) {
      const ed = map();
      paint(ed, b.id, 7);
      expect(ed.historySteps).toBe(1);
      expect(ed.doc.objects.length).toBeGreaterThan(0);
    }
  });

  it('lays the city on a street grid with buildings facing the streets', () => {
    const ed = map();
    const stroke = new LandscapeStroke(ed, 'City', 2, catalog);
    const def = biomeById('city');
    for (let x = -60; x <= 60; x += 6) for (let k = 0; k < 4; k++) biomeDab(stroke, { x, y: -100 }, { ...brush, radius: 60 }, def, 0.1);
    finishBiome(stroke, brush, def);
    stroke.finish();
    const t = ed.doc.terrain;
    const layers = t.layers.map((l) => l.material);
    expect(layers).toContain('asphalt');
    expect(layers).toContain('sidewalk');
    const blockAssets = def.objects.find((o) => o.zone === 'block')!.assets;
    const houses = ed.doc.objects.filter((o) => blockAssets.includes(o.asset));
    expect(houses.length).toBeGreaterThan(6);
    for (const h of houses) {
      expect(streetDistance(h.x, h.y)).toBeGreaterThan(10);
      // Front (+y at turn 0) points at the nearer street
      const fx = -Math.sin(h.rotation);
      const fy = Math.cos(h.rotation);
      expect(streetDistance(h.x + fx * 6, h.y + fy * 6)).toBeLessThan(streetDistance(h.x, h.y));
    }
    expect(ed.doc.objects.filter((o) => o.asset === 'street-lamp').every((o) => streetDistance(o.x, o.y) < 8.5)).toBe(true);
    // Parked cars stand at the curb, lengthwise
    const cars = ed.doc.objects.filter((o) => o.asset.startsWith('car-'));
    expect(cars.length).toBeGreaterThan(2);
    for (const c of cars) expect(streetDistance(c.x, c.y)).toBeCloseTo(3.6, 1);
    expect(citySlots('street', -64, 64, -64, 64).length).toBeGreaterThan(8);
  });

  it('fills hell pools with lava and the arctic ones with ice, and pocks the moon with craters', () => {
    const hell = map();
    paint(hell, 'hell', 3);
    expect(hell.doc.terrain.waterBodies?.map((b) => b.kind)).toEqual(['lava']);
    expect(hell.doc.terrain.layers.map((l) => l.material)).toContain('lava');
    const arctic = map();
    paint(arctic, 'arctic', 3);
    expect(arctic.doc.terrain.waterBodies?.map((b) => b.kind)).toEqual(['ice']);
    const moon = map();
    paint(moon, 'moon', 3);
    const row = Array.from({ length: 80 }, (_, k) => heightAt(moon.doc.terrain, -80 + k * 2, 80));
    expect(Math.min(...row)).toBeLessThan(-1);
    expect(Math.max(...row)).toBeGreaterThan(0.3);
  });

  it('previews the spots it would grow on', () => {
    const stroke = new LandscapeStroke(map(), 'Biome', 4, catalog);
    const spots = previewSpots(stroke.noise, catalog, { x: 0, y: 80 }, brush, biomeById('forest'));
    expect(spots.length).toBeGreaterThan(10);
    for (const s of spots) expect(Math.hypot(s.x, s.y - 80)).toBeLessThan(brush.radius);
  });
});

describe('landforms', () => {
  it('a held mountain grows to its height and no further', () => {
    const ed = map();
    const stroke = new LandscapeStroke(ed, 'Mountain', 1, catalog);
    for (let k = 0; k < 200; k++) formDab(stroke, 'mountain', { x: 0, y: 100 }, brush, 0.1);
    stroke.finish();
    const peak = Math.max(...Array.from(ed.doc.terrain.grid.heights));
    expect(peak).toBeGreaterThan(formHeight('mountain', brush) * 0.4);
    expect(peak).toBeLessThan(formHeight('mountain', brush) * 1.3);
  });

  it('a valley lowers, a plateau raises a table', () => {
    const ed = map();
    const valley = new LandscapeStroke(ed, 'Valley', 1, catalog);
    for (let k = 0; k < 60; k++) formDab(valley, 'valley', { x: 0, y: 100 }, brush, 0.1);
    valley.finish();
    expect(heightAt(ed.doc.terrain, 0, 100)).toBeLessThan(-3);
    const plateau = new LandscapeStroke(ed, 'Plateau', 1, catalog);
    for (let k = 0; k < 60; k++) formDab(plateau, 'plateau', { x: 0, y: -100 }, brush, 0.1);
    plateau.finish();
    expect(heightAt(ed.doc.terrain, 0, -100)).toBeGreaterThan(5);
    expect(heightAt(ed.doc.terrain, 5, -100)).toBeCloseTo(heightAt(ed.doc.terrain, -5, -100), 0);
  });

  it('a cliff rises left of the drawn line', () => {
    const ed = map();
    const stroke = new LandscapeStroke(ed, 'Cliff', 2, catalog);
    // Drawn eastward: north is on the left
    cliffAlong(stroke, [{ x: -60, y: 100 }, { x: 60, y: 100 }], 10, 30);
    stroke.finish();
    expect(heightAt(ed.doc.terrain, 0, 110)).toBeGreaterThan(7);
    expect(heightAt(ed.doc.terrain, 0, 90)).toBeLessThan(1);
  });

  it('erosion carves the same gullies for the same seed and keeps the soil', () => {
    const run = () => {
      const ed = map();
      const m = new LandscapeStroke(ed, 'Mountain', 1, catalog);
      for (let k = 0; k < 100; k++) formDab(m, 'mountain', { x: 0, y: 100 }, brush, 0.1);
      m.finish();
      const before = Array.from(ed.doc.terrain.grid.heights);
      const e = new LandscapeStroke(ed, 'Erode', 5, catalog);
      for (let k = 0; k < 20; k++) erosionDab(e, { x: 0, y: 100 }, brush, k);
      e.finish();
      return { before, after: Array.from(ed.doc.terrain.grid.heights) };
    };
    const a = run();
    const b = run();
    expect(a.after).toEqual(b.after);
    const sum = (h: number[]) => h.reduce((s, v) => s + v, 0);
    const moved = a.after.reduce((s, v, k) => s + Math.abs(v - a.before[k]), 0);
    expect(moved).toBeGreaterThan(1);
    // Soil moves; it does not vanish: a drop may carry some off at the brush's edge
    expect(Math.abs(sum(a.after) - sum(a.before))).toBeLessThan(moved);
  });
});

describe('erosion on a high peak', () => {
  it('carves the flank without leaving needles', () => {
    const ed = map();
    const t = ed.doc.terrain;
    const g = t.grid;
    // A smooth bell 100 m high, radius 120 m
    for (let j = 0; j < g.rows; j++)
      for (let i = 0; i < g.columns; i++) {
        const d = Math.hypot(i * g.cellSize - t.width / 2, j * g.cellSize - t.depth / 2 - 100) / 120;
        g.heights[j * g.columns + i] = d < 1 ? 100 * (1 - d * d) ** 2 : 0;
      }
    const before = Float32Array.from(g.heights);
    const stroke = new LandscapeStroke(ed, 'Erode', 4, catalog);
    for (let k = 0; k < 16; k++) erosionDab(stroke, { x: -60 + k * 8, y: 40 }, { radius: 70, strength: 1, falloff: 0.5 }, k);
    stroke.finish();
    let moved = 0;
    let worst = 0;
    for (let j = 1; j < g.rows - 1; j++)
      for (let i = 1; i < g.columns - 1; i++) {
        const k = j * g.columns + i;
        moved += Math.abs(g.heights[k] - before[k]);
        const n = [g.heights[k - 1], g.heights[k + 1], g.heights[k - g.columns], g.heights[k + g.columns]];
        worst = Math.max(worst, g.heights[k] - Math.max(...n), Math.min(...n) - g.heights[k]);
      }
    expect(moved).toBeGreaterThan(10);
    // No sample stands more than about a cell above or below all its neighbours
    expect(worst).toBeLessThan(g.cellSize);
  });
});

describe('crater, dunes and glow cracks', () => {
  it('digs a crater where the stroke began, with a raised rim', () => {
    const ed = map();
    const stroke = new LandscapeStroke(ed, 'Crater', 2, catalog);
    // The pointer wanders; the crater stays at the first spot
    for (let k = 0; k < 80; k++) formDab(stroke, 'crater', { x: 50 + k * 0.5, y: -100 }, brush, 0.1);
    stroke.finish();
    const t = ed.doc.terrain;
    const depth = formHeight('crater', brush);
    expect(heightAt(t, 50, -100)).toBeLessThan(-depth * 0.7);
    const rim = Math.max(...[0, 1, 2, 3].map((q) => heightAt(t, 50 + Math.cos(q) * 24, -100 + Math.sin(q) * 24)));
    expect(rim).toBeGreaterThan(depth * 0.15);
    expect(heightAt(t, 50 + 39, -100)).toBeCloseTo(0, 1);
    expect(craterProfile(0)).toBeLessThan(craterProfile(0.5));
    expect(craterProfile(1)).toBeGreaterThan(craterProfile(1.4));
  });

  it('heaps dunes in rows across the wind', () => {
    const ed = map();
    const stroke = new LandscapeStroke(ed, 'Dunes', 4, catalog);
    for (let k = 0; k < 60; k++) formDab(stroke, 'dunes', { x: 0, y: -100 }, brush, 0.1);
    stroke.finish();
    const t = ed.doc.terrain;
    const row = Array.from({ length: 30 }, (_, k) => heightAt(t, -30 + k * 2, -100));
    expect(Math.max(...row)).toBeGreaterThan(1.5);
    expect(Math.min(...row)).toBeLessThan(Math.max(...row) * 0.4);
    expect(row.every((h) => h >= 0)).toBe(true);
  });

  it('breaks the ground into thin glowing cracks on scorched rock', () => {
    const ed = map();
    const stroke = new LandscapeStroke(ed, 'Cracks', 6, catalog);
    for (let k = 0; k < 40; k++) cracksDab(stroke, { x: 0, y: -100 }, brush, 0.1);
    stroke.finish();
    const t = ed.doc.terrain;
    const layers = t.layers.map((l) => l.material);
    const lava = layers.indexOf('lava');
    const rock = layers.indexOf('scorched-ground');
    expect(lava).toBeGreaterThanOrEqual(0);
    expect(rock).toBeGreaterThanOrEqual(0);
    const res = t.splat.resolution;
    const w = new Float32Array(8);
    let inside = 0;
    let glowing = 0;
    for (let v = 0; v < res; v++)
      for (let u = 0; u < res; u++) {
        const x = ((u + 0.5) / res) * t.width - t.width / 2;
        const y = ((v + 0.5) / res) * t.depth - t.depth / 2;
        if (Math.hypot(x, y + 100) > 30) continue;
        inside++;
        readWeights(t, v * res + u, w);
        if (w[lava] > w.reduce((a, b) => a + b, 0) * 0.5) glowing++;
      }
    expect(glowing / inside).toBeGreaterThan(0.03);
    expect(glowing / inside).toBeLessThan(0.3);
    expect(Math.min(...Array.from(t.grid.heights))).toBeLessThan(-0.2);
    expect(ed.historySteps).toBe(1);
  });
});

describe('river and road', () => {
  it('carves a river that flows downhill, with banks and a bridge where it crosses the road', () => {
    const ed = map();
    const stroke = new LandscapeStroke(ed, 'River', 3, catalog);
    const result = carveRiver(stroke, [{ x: -20, y: -150 }, { x: 0, y: 0 }, { x: 20, y: 150 }], DEFAULT_RIVER)!;
    stroke.finish();
    const t = ed.doc.terrain;
    expect(t.water).toBeNull();
    expect(t.rivers).toEqual([result.river]);
    const pts = result.river.points;
    expect(pts.length).toBeGreaterThan(30);
    for (let k = 1; k < pts.length; k++) expect(pts[k].height).toBeLessThan(pts[k - 1].height);
    expect(pts.slice(4, -4).every((p) => p.width > 6 && p.width < 20)).toBe(true);
    expect(pts[0].width).toBeLessThan(pts[8].width);
    const mid = pts[Math.floor(pts.length / 2)];
    expect(heightAt(t, mid.x, mid.y)).toBeLessThan(mid.height - 1);
    expect(result.bridges).toBe(1);
    const bridge = ed.doc.paths.edges.find((e) => e.kind === 'bridge')!;
    const line = edgePolyline(ed.doc.paths, bridge);
    expect(Math.min(...line.map((p) => p.x))).toBeLessThan(0);
    expect(Math.max(...line.map((p) => p.x))).toBeGreaterThan(0);
    expect(ed.doc.objects.length).toBeGreaterThan(10);
    expect(ed.historySteps).toBe(1);
    ed.undo();
    expect(ed.doc.paths.edges.every((e) => e.kind !== 'bridge')).toBe(true);
    expect(ed.doc.terrain.rivers).toBeUndefined();
    ed.redo();
    expect(ed.doc.terrain.rivers?.[0].points).toEqual(pts);
  });

  it('turns a river drawn uphill round and puts a waterfall over a step', () => {
    const ed = map();
    const t = ed.doc.terrain;
    const g = t.grid;
    // A 12 m step across the map: high ground in the south
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) if (j * g.cellSize - t.depth / 2 < 0) g.heights[j * g.columns + i] = 12;
    const stroke = new LandscapeStroke(ed, 'River', 5, catalog);
    const result = carveRiver(stroke, [{ x: 100, y: 150 }, { x: 100, y: -150 }], { ...DEFAULT_RIVER, bridges: false })!;
    stroke.finish();
    const pts = result.river.points;
    expect(pts[0].y).toBeLessThan(0);
    expect(pts[0].height).toBeGreaterThan(pts[pts.length - 1].height + 10);
    expect(result.waterfalls).toBe(1);
    const fall = ed.doc.objects.find((o) => o.asset === 'fx-waterfall')!;
    expect(Math.abs(fall.y)).toBeLessThan(10);
    // Faces downstream (north, +y): front +y at turn 0
    expect(Math.abs(fall.rotation)).toBeLessThan(0.4);
    expect(fall.scale).toBeGreaterThan(0.5);
  });

  it('lets a river run as rapids down a long slope, and cascades over a high cliff', () => {
    const slope = map();
    let t = slope.doc.terrain;
    let g = t.grid;
    // 40 m down over 50 m in the middle of the map: steep, but no cliff
    for (let j = 0; j < g.rows; j++)
      for (let i = 0; i < g.columns; i++) {
        const y = j * g.cellSize - t.depth / 2;
        g.heights[j * g.columns + i] = 40 * (1 - Math.min(1, Math.max(0, (y + 25) / 50)));
      }
    let stroke = new LandscapeStroke(slope, 'River', 5, catalog);
    expect(carveRiver(stroke, [{ x: 100, y: -150 }, { x: 100, y: 150 }], { ...DEFAULT_RIVER, bridges: false })!.waterfalls).toBe(0);
    const cliff = map();
    t = cliff.doc.terrain;
    g = t.grid;
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) if (j * g.cellSize - t.depth / 2 < 0) g.heights[j * g.columns + i] = 30;
    stroke = new LandscapeStroke(cliff, 'River', 5, catalog);
    const result = carveRiver(stroke, [{ x: 100, y: -150 }, { x: 100, y: 150 }], { ...DEFAULT_RIVER, bridges: false })!;
    stroke.finish();
    expect(result.waterfalls).toBe(3);
    // Each sheet stands below its lip, none hangs over the low ground
    for (const f of cliff.doc.objects.filter((o) => o.asset === 'fx-waterfall')) {
      expect(f.z).toBeLessThan(0);
      expect(Math.abs(f.y)).toBeLessThan(6);
    }
  });

  it('carves the bed again after a point moved, and thins a straight river out', () => {
    const ed = map();
    let stroke = new LandscapeStroke(ed, 'River', 3, catalog);
    const river = carveRiver(stroke, [{ x: 100, y: -150 }, { x: 100, y: 150 }], { ...DEFAULT_RIVER, bridges: false })!.river;
    stroke.finish();
    const live = ed.doc.terrain.rivers![0];
    const k = Math.floor(live.points.length / 2);
    movePoint(live, k, { x: 140, y: live.points[k].y });
    expect(heightAt(ed.doc.terrain, 140, live.points[k].y)).toBeGreaterThan(live.points[k].height);
    stroke = new LandscapeStroke(ed, 'Carve', 1, catalog);
    recarveRiver(stroke, live);
    stroke.finish();
    expect(heightAt(ed.doc.terrain, 140, live.points[k].y)).toBeLessThan(live.points[k].height - 1);
    const before = river.points.length;
    const straight = structuredClone(river);
    simplifyRiver(straight, 3);
    expect(straight.points.length).toBeLessThan(before);
    expect(straight.points[0]).toEqual(river.points[0]);
  });

  it('removes a river with its bed filled from the land on both sides, its reeds along, one undo step', () => {
    const ed = map();
    const t = ed.doc.terrain;
    // Tilted land, so the fill has to follow it across and along
    const plane = (x: number, y: number) => 0.04 * x + 0.02 * y + 10;
    for (let j = 0; j < t.grid.rows; j++) {
      for (let i = 0; i < t.grid.columns; i++) t.grid.heights[j * t.grid.columns + i] = plane(i * t.grid.cellSize - t.width / 2, j * t.grid.cellSize - t.depth / 2);
    }
    let stroke = new LandscapeStroke(ed, 'River', 3, catalog);
    carveRiver(stroke, [{ x: -30, y: -150 }, { x: 10, y: 0 }, { x: -20, y: 150 }], DEFAULT_RIVER);
    stroke.finish();
    const carved = Array.from(t.grid.heights);
    const objects = ed.doc.objects.length;
    expect(objects).toBeGreaterThan(0);
    expect(heightAt(t, 10, 0)).toBeLessThan(plane(10, 0) - 1.5);
    const ground = new Float32Array(8);
    const texel = (x: number, y: number) => {
      const res = t.splat.resolution;
      return Math.floor(((y + t.depth / 2) / t.depth) * res) * res + Math.floor(((x + t.width / 2) / t.width) * res);
    };
    readWeights(t, texel(120, -80), ground);
    expect(ed.doc.paths.edges.some((e) => e.kind === 'bridge')).toBe(true);
    const land = Array.from(ground);

    stroke = new LandscapeStroke(ed, 'Remove river', 1, catalog);
    removeRiver(stroke, 0);
    stroke.finish();
    expect(t.rivers).toBeUndefined();
    expect(ed.doc.objects.length).toBe(0);
    for (const [x, y] of [[10, 0], [-14, -80], [-6, 80], [16, 0], [4, 0]]) expect(Math.abs(heightAt(t, x, y) - plane(x, y))).toBeLessThan(0.4);
    // The mud and sand went with it: the bed has the ground of the land beside it
    readWeights(t, texel(-14, -80), ground);
    Array.from(ground).forEach((w, k) => expect(Math.abs(w - land[k])).toBeLessThan(3));
    expect(ed.doc.paths.edges.some((e) => e.kind === 'bridge')).toBe(false);

    ed.undo();
    expect(Array.from(t.grid.heights)).toEqual(carved);
    expect(t.rivers).toHaveLength(1);
    expect(ed.doc.objects.length).toBe(objects);
    expect(ed.doc.paths.edges.some((e) => e.kind === 'bridge')).toBe(true);
  });

  it('lets a lava flow run with scorched banks, without reeds, falls or bridges', () => {
    const ed = map();
    const stroke = new LandscapeStroke(ed, 'Lava', 3, catalog);
    const result = carveRiver(stroke, [{ x: -20, y: -150 }, { x: 0, y: 0 }, { x: 20, y: 150 }], { ...DEFAULT_RIVER, kind: 'lava' })!;
    stroke.finish();
    expect(result.river.kind).toBe('lava');
    expect(result.bridges).toBe(0);
    expect(ed.doc.objects.some((o) => o.asset.includes('reed'))).toBe(false);
    expect(ed.doc.terrain.layers.map((l) => l.material)).toContain('scorched-ground');
  });

  it('builds a road joined to the network, levels it and lines it with lamps', () => {
    const ed = map();
    // A hill to cut through
    const hill = new LandscapeStroke(ed, 'Mountain', 1, catalog);
    for (let k = 0; k < 60; k++) formDab(hill, 'mountain', { x: 0, y: 100 }, brush, 0.1);
    hill.finish();
    const nodes = ed.doc.paths.nodes.length;
    const stroke = new LandscapeStroke(ed, 'Road', 3, catalog);
    const result = buildRoad(stroke, [{ x: 0, y: 2 }, { x: 0, y: 60 }, { x: 0, y: 150 }], DEFAULT_ROAD)!;
    stroke.finish();
    expect(result).not.toBeNull();
    // The start split the starter road: a junction plus the new end
    expect(ed.doc.paths.nodes.length).toBe(nodes + 2);
    const across = Math.abs(heightAt(ed.doc.terrain, -3, 100) - heightAt(ed.doc.terrain, 3, 100));
    expect(across).toBeLessThan(0.5);
    expect(result.lamps).toBeGreaterThan(1);
    for (const o of ed.doc.objects) {
      const hit = nearestOnEdges(ed.doc.paths, o)!;
      expect(hit.dist).toBeGreaterThan(hit.edge.width / 2);
    }
    ed.undo();
    expect(ed.doc.paths.nodes.length).toBe(nodes);
  });
});
