import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../../world/custom-map/map-create';
import type { CustomMapDocument } from '../../../world/custom-map/map-document';
import { CatalogIndex, normalizeCatalog } from '../../catalog/asset-catalog';
import { EditorDocument } from '../../model/editor-document';
import { heightAt } from '../../model/grid';
import { edgePolyline, nearestOnEdges } from '../path-graph';
import { biomeDab, finishBiome, previewSpots } from './biome-brush';
import { biomeById, BIOMES } from './biomes';
import { erosionDab } from './erosion';
import { LandscapeStroke } from './landscape-stroke';
import { carveRiver, DEFAULT_RIVER } from './river';
import { buildRoad, DEFAULT_ROAD } from './road';
import { cliffAlong, formDab, formHeight } from './shapes';

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
    const bushes = ed.doc.objects.filter((o) => o.asset === 'bush');
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
    const sandLayer = t.layers.findIndex((l) => l.material === 'sand');
    const res = t.splat.resolution;
    let painted = 0;
    let bare = 0;
    for (let a = 0; a < 64; a++) {
      const x = Math.cos((a / 64) * Math.PI * 2) * 34;
      const y = 100 + Math.sin((a / 64) * Math.PI * 2) * 34;
      const u = Math.floor(((x + 200) / 400) * res);
      const v = Math.floor(((y + 200) / 400) * res);
      const w = t.splat.maps[sandLayer >> 2][(v * res + u) * 4 + (sandLayer & 3)];
      if (w > 128) painted++;
      else bare++;
    }
    expect(painted).toBeGreaterThan(4);
    expect(bare).toBeGreaterThan(4);
  });

  it('is one undo step, layers, water and objects included', () => {
    const ed = map();
    const before = snapshot(ed.doc);
    paint(ed, 'swamp', 11);
    expect(ed.doc.terrain.water).not.toBeNull();
    expect(ed.doc.objects.length).toBeGreaterThan(0);
    expect(ed.historySteps).toBe(1);
    ed.undo();
    expect(snapshot(ed.doc)).toEqual(before);
    ed.redo();
    expect(ed.doc.terrain.water!.mask.some((v) => v > 0)).toBe(true);
  });

  it('every biome paints with the shipped catalogue', () => {
    for (const b of BIOMES) {
      const ed = map();
      paint(ed, b.id, 7);
      expect(ed.historySteps).toBe(1);
      expect(ed.doc.objects.length).toBeGreaterThan(0);
    }
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

describe('river and road', () => {
  it('carves a river with water, banks and a bridge where it crosses the road', () => {
    const ed = map();
    const stroke = new LandscapeStroke(ed, 'River', 3, catalog);
    const result = carveRiver(stroke, [{ x: -20, y: -150 }, { x: 0, y: 0 }, { x: 20, y: 150 }], DEFAULT_RIVER)!;
    stroke.finish();
    const t = ed.doc.terrain;
    expect(t.water).not.toBeNull();
    expect(heightAt(t, 10, 75)).toBeLessThan(result.level - 1);
    expect(result.bridges).toBe(1);
    const bridge = ed.doc.paths.edges.find((e) => e.kind === 'bridge')!;
    const line = edgePolyline(ed.doc.paths, bridge);
    expect(Math.min(...line.map((p) => p.x))).toBeLessThan(0);
    expect(Math.max(...line.map((p) => p.x))).toBeGreaterThan(0);
    expect(ed.doc.objects.length).toBeGreaterThan(10);
    expect(ed.historySteps).toBe(1);
    ed.undo();
    expect(ed.doc.paths.edges.every((e) => e.kind !== 'bridge')).toBe(true);
    expect(ed.doc.terrain.water).toBeNull();
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
