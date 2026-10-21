import { createMapDocument } from '../../custom-map/map-create';
import type { CustomMapDocument, MapObject, MapPoint } from '../../custom-map/map-document';
import { OsmFrame, type OsmArea, type OsmFeatures } from '../osm-parse';
import { ROW_END_GAP } from './crop-rows';
import { LAND_CLASSES } from './ground';
import { fillRings, sampleGrid, stampLine } from './raster';
import { growVegetation } from './vegetation';
import type { WaterResult } from './water';

const SIDE = 300;
const VINE = 10;

/**
 * A 300 m map on a hillside rising 0.3 m per metre to the north, a 6 m road
 * along y = 0 below a vineyard (x -60..60, y 10..110), and optional tracks
 */
function hillside(tracks: MapPoint[][] = []): { doc: CustomMapDocument; features: OsmFeatures; land: Uint8Array; water: WaterResult } {
  const doc = createMapDocument({ id: 't', name: 't', width: SIDE, depth: SIDE, cellSize: 2, baseMaterial: 'grass', splatResolution: 64, starter: false });
  const g = doc.terrain.grid;
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = 50 + 0.3 * (-SIDE / 2 + j * g.cellSize);
  const lines = [[{ x: -140, y: 0 }, { x: 140, y: 0 }], ...tracks];
  const nodes = lines.flatMap((l, k) => l.map((p, m) => ({ id: `n${k}-${m}`, ...p })));
  doc.paths = { nodes, edges: lines.map((l, k) => ({ id: `e${k}`, a: `n${k}-0`, b: `n${k}-${l.length - 1}`, width: k ? 3 : 6, kind: k ? 'path' : 'road' })) };
  doc.hq = { x: 130, y: -130 };
  doc.spawns = [];
  doc.objects = [];
  const grid = sampleGrid(SIDE, 2);
  const n = grid.n * grid.n;
  const roads = new Uint8Array(n);
  for (const [k, l] of lines.entries()) stampLine(l, grid, (k ? 3 : 6) / 2, (i, j) => (roads[j * grid.n + i] = 1));
  const water = { wet: new Uint8Array(n), sea: new Uint8Array(n), dry: new Uint8Array(n), roads } as WaterResult;
  const ring = [{ x: -60, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 110 }, { x: -60, y: 110 }];
  const area: OsmArea = { id: 1, from: 'way', tags: { landuse: 'vineyard' }, outer: [ring], inner: [], area: 12000 };
  const land = new Uint8Array(n);
  const index = LAND_CLASSES.indexOf('vineyard') + 1;
  fillRings([ring], grid, (i, j) => (land[j * grid.n + i] = index));
  const features: OsmFeatures = { frame: new OsmFrame(0, 0), half: SIDE / 2, ways: [], areas: [area], points: [], stats: { elements: 0, ways: 0, relations: 0, points: 0, areas: 0, forcedRings: 0, cutAreas: 0, turnedAreas: 0, areasOutside: 0 } };
  return { doc, features, land, water };
}

/** The pieces of each row (one row per x), south to north, with their south and north ends */
function rows(objects: readonly MapObject[]): Map<number, { y0: number; y1: number }[]> {
  const out = new Map<number, { y0: number; y1: number }[]>();
  for (const o of objects) {
    if (o.asset !== 'vine-row') continue;
    const half = (VINE / 2) * (o.stretch ?? 1);
    const key = Math.round(o.x * 10);
    out.set(key, [...(out.get(key) ?? []), { y0: o.y - half, y1: o.y + half }]);
  }
  for (const list of out.values()) list.sort((a, b) => a.y0 - b.y0);
  return out;
}

const costOf = (asset: string) => (asset === 'vine-row' ? 30 : 10);

describe('OSM vineyards', () => {
  it('runs the rows straight up the slope, square to the road below, each one unbroken from edge to edge', () => {
    const { doc, features, land, water } = hillside();
    growVegetation(doc, features, land, water, { costOf, routes: [] });
    const vines = doc.objects.filter((o) => o.asset === 'vine-row');
    expect(vines.length).toBeGreaterThan(200);
    // Along map y (north, up the hill): the model's length runs along x turned a quarter
    for (const o of vines) expect(Math.abs(Math.cos(o.rotation))).toBeLessThan(2e-3);
    const all = rows(vines);
    // A row every 2.4 m across the 120 m parcel
    expect(all.size).toBe(49);
    for (const pieces of all.values()) {
      // From the lower edge to the upper one, a little inside each (the road's verge keeps clear of the lower edge)
      expect(pieces[0].y0).toBeCloseTo(10 + ROW_END_GAP, 1);
      expect(pieces[pieces.length - 1].y1).toBeCloseTo(110 - ROW_END_GAP, 1);
      // End to end, no gap and no overlap between the pieces, each within a third of its length
      for (let k = 1; k < pieces.length; k++) expect(pieces[k].y0).toBeCloseTo(pieces[k - 1].y1, 1);
      for (const o of vines) expect(Math.abs((o.stretch ?? 1) - 1)).toBeLessThanOrEqual(0.34);
    }
  });

  it('breaks the rows at a track across the parcel, both halves ending at it', () => {
    const { doc, features, land, water } = hillside([[{ x: -100, y: 60 }, { x: 100, y: 60 }]]);
    growVegetation(doc, features, land, water, { costOf, routes: [] });
    for (const pieces of rows(doc.objects).values()) {
      const below = pieces.filter((p) => p.y1 < 60);
      const above = pieces.filter((p) => p.y0 > 60);
      expect(below.length + above.length).toBe(pieces.length);
      // The track is 3 m wide: each half stops at its edge plus the metre the plants keep off a road
      expect(below[below.length - 1].y1).toBeGreaterThan(55);
      expect(above[0].y0).toBeLessThan(65);
    }
  });

  it('keeps or leaves out whole rows when the budget runs short, and gives the same rows every time', () => {
    const run = (budget?: number) => {
      const w = hillside();
      growVegetation(w.doc, w.features, w.land, w.water, { costOf, routes: [], budget });
      return w.doc.objects;
    };
    const full = run();
    expect(run()).toEqual(full);
    const total = full.filter((o) => o.asset === 'vine-row').length * 30;
    // Rows may take 40 % of the budget: with this one about half the rows
    const half = run(total * 1.25);
    const kept = rows(half);
    expect(kept.size).toBeGreaterThan(15);
    expect(kept.size).toBeLessThan(35);
    for (const pieces of kept.values()) {
      expect(pieces[0].y0).toBeCloseTo(10 + ROW_END_GAP, 1);
      expect(pieces[pieces.length - 1].y1).toBeCloseTo(110 - ROW_END_GAP, 1);
    }
  });
});
