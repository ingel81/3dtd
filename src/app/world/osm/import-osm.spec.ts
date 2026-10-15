import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { validateMap } from '../../editor/validation/map-validation';
import { routeBetween } from '../../editor/ops/path-graph';
import { packMapFile, unpackMapFile, validateMapDocument } from '../custom-map/map-file';
import { mapStreetNetwork } from '../custom-map/custom-map-streets';
import type { DemMosaic } from './dem-tiles';
import { convertOsm, type OsmImportInput } from './import-osm';
import { MAX_GROUND_LAYERS } from '../custom-map/map-document';
import { readWeights } from '../../editor/ops/paint-ops';
import { heightAt } from '../../editor/model/grid';
import { spawnRoutes } from '../../editor/ops/path-graph';
import { plantCosts, PLANT_BUDGET_SHARE } from './convert/vegetation';
import { SCENE_BUDGET } from '../custom-map/render/objects/scene-cost';

const catalog = JSON.parse(readFileSync(join(__dirname, '../../../../public/maps/assets/catalog.json'), 'utf8'));

/** The frozen probe (integration/fixtures/osm/README.md, OSM worlds): Miltenberg, 1.2 km square, Overpass and heights */
function probe(): OsmImportInput {
  const dir = join(__dirname, '../../integration/fixtures/osm');
  const read = (name: string) => JSON.parse(gunzipSync(readFileSync(join(dir, name))).toString('utf8'));
  const over = read('world-miltenberg.overpass.json.gz');
  const dem = read('world-miltenberg.dem.json.gz');
  const bytes = Buffer.from(dem.heights, 'base64');
  const raw = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const mosaic: DemMosaic = {
    source: dem.source, zoom: dem.zoom, tileSize: dem.tileSize, left: dem.left, top: dem.top, columns: dem.columns, rows: dem.rows,
    heights: Float32Array.from(raw, (v) => v * dem.unit),
  };
  return { lat: over.place.lat, lon: over.place.lon, address: 'Miltenberg', overpass: { elements: over.elements }, dem: mosaic, fetchedAt: over.source.fetchedAt };
}

describe('OSM world (frozen probe Miltenberg)', () => {
  // Spawns are drawn as on the real places (Math.random); a fixed sequence keeps the scene the same
  let seed = 1;
  beforeEach(() => {
    seed = 1;
    vi.spyOn(Math, 'random').mockImplementation(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
  });
  afterEach(() => vi.restoreAllMocks());

  const options = { sideM: 1200, splatResolution: 512, now: new Date('2026-10-15T00:00:00Z') };

  it('makes a map that packs, reads back and passes the editor check without errors', () => {
    const { doc, report } = convertOsm(probe(), options);
    expect(validateMapDocument(doc)).toEqual([]);
    expect(unpackMapFile(packMapFile(doc)).doc.paths.edges.length).toBe(doc.paths.edges.length);
    const errors = validateMap(doc).filter((i) => i.severity === 'error');
    expect(errors.map((e) => e.message)).toEqual([]);
    expect(doc.meta.source).toMatchObject({ kind: 'osm', address: 'Miltenberg', sideM: 1200, dem: 'mapterhorn', zeroM: report.terrain.zeroM });
    expect(doc.meta.id).toBe('osm-miltenberg');
    expect(report.warnings.filter((w) => w.startsWith('heights'))).toEqual([]);
  });

  it('lays the real streets as one network over node ids, with the bridges over the Main and the ground at its heights', () => {
    const { doc, report } = convertOsm(probe(), options);
    // Miltenberg lies at about 125 m by the Main and climbs to the castle hill
    expect(report.terrain.minM).toBeGreaterThan(115);
    expect(report.terrain.minM).toBeLessThan(135);
    expect(report.terrain.maxM - report.terrain.minM).toBeGreaterThan(60);
    expect(report.roads.edges).toBeGreaterThan(500);
    expect(report.roads.bridges).toBeGreaterThan(0);
    const types = new Set(doc.paths.edges.map((e) => e.street));
    for (const type of ['residential', 'footway', 'steps']) expect(types).toContain(type);
    for (const e of doc.paths.edges) expect(e.kind === 'bridge' ? e.style : e.surface).toBeTruthy();
    // Nearly every street joins the network the HQ stands on
    const network = mapStreetNetwork(doc);
    expect(network.streets.length).toBe(doc.paths.edges.length);
    const reached = doc.paths.nodes.filter((_, k) => k % 25 === 0).filter((n) => routeBetween(doc.paths, n, doc.hq) !== null).length;
    expect(reached / Math.ceil(doc.paths.nodes.length / 25)).toBeGreaterThan(0.9);
  });

  it('puts the HQ on the road at the place and spawns out on the streets with a route to it, the first always open', () => {
    const { doc, report } = convertOsm(probe(), options);
    expect(report.layout.hqShiftM).toBeLessThan(50);
    expect(doc.spawns.length).toBeGreaterThan(0);
    expect(doc.spawns[0].optional).toBeUndefined();
    for (const s of doc.spawns.slice(1)) expect(s.optional).toBe(true);
    for (const s of report.layout.spawns) {
      // The probe's square is 1.2 km: the real places' 500 to 1000 m shrink to the half of what it covers (coveredSpawnRange)
      expect(s.distanceM).toBeGreaterThanOrEqual(250);
      expect(s.routeM).toBeGreaterThan(s.distanceM * 0.9);
    }
    for (const s of doc.spawns) expect(routeBetween(doc.paths, s, doc.hq)).not.toBeNull();
  });

  it('paints the land into the layers the roads leave, the smaller area over the larger', () => {
    const { doc, report } = convertOsm(probe(), options);
    const t = doc.terrain;
    expect(t.layers.length).toBeLessThanOrEqual(MAX_GROUND_LAYERS);
    for (const e of doc.paths.edges) if (e.surface) expect(t.layers.map((l) => l.material)).toContain(e.surface);
    expect(report.ground.areas.forest).toBeGreaterThan(0);
    expect(report.ground.areas.meadow).toBeGreaterThan(0);
    // The sun as high as at noon around the equinox at 49.7 degrees north, from the south
    expect(doc.environment.sunElevation).toBe(40);
    expect(doc.environment.sunAzimuth).toBe(150);
    // Every class painted its own material or the one it fell back on
    for (const [material, took] of Object.entries(report.ground.fellBack)) {
      expect(t.layers.map((l) => l.material)).not.toContain(material);
      expect(t.layers.map((l) => l.material)).toContain(took);
    }
    // The texels still add up to full weight
    const w = new Float32Array(MAX_GROUND_LAYERS);
    const res = t.splat.resolution;
    for (let k = 0; k < res * res; k += 997) {
      readWeights(t, k, w);
      expect(w.reduce((s, v) => s + v, 0)).toBe(255);
    }
  });

  it('lays the Main as the main water on its level, with the land at its rim over it and no water in the air', () => {
    const { doc, report } = convertOsm(probe(), options);
    const t = doc.terrain;
    expect(report.water.main).toBe('river');
    const main = t.water!;
    const g = t.grid;
    let wet = 0;
    for (let k = 0; k < main.mask.length; k++) {
      if (!main.mask[k]) continue;
      wet++;
      expect(g.heights[k]).toBeLessThan(main.level);
    }
    // About 65 000 m² of the Main lie in the probe's square
    expect(wet * g.cellSize * g.cellSize).toBeGreaterThan(50_000);
    // The Main lies at the bottom of the town
    expect(main.level).toBeLessThan(5);
    const issues = validateMap(doc).map((i) => i.code);
    expect(issues).not.toContain('water-floating');
    expect(issues).not.toContain('path-under-water');
    for (const river of t.rivers ?? []) {
      for (let k = 1; k < river.points.length; k++) expect(river.points[k].height).toBeLessThanOrEqual(river.points[k - 1].height);
      for (const p of river.points) expect(heightAt(t, p.x, p.y)).toBeLessThan(p.height + 0.01);
    }
  });

  it('grows forests, single trees and shore reeds off the roads and the HQ, the same every time, within the plants budget', () => {
    const costs = plantCosts(catalog.objects, 1200);
    const { doc, report } = convertOsm(probe(), { ...options, plantCosts: costs });
    const placed = report.plants.placed;
    expect(placed['forest']).toBeGreaterThan(300);
    expect(placed['trees']).toBeGreaterThan(20);
    expect(placed['shore']).toBeGreaterThan(0);
    expect(report.plants.cost).toBeLessThanOrEqual(PLANT_BUDGET_SHARE * SCENE_BUDGET);
    expect(validateMap(doc).map((i) => i.code)).not.toContain('object-on-path');
    for (const o of doc.objects) expect(Math.hypot(o.x - doc.hq.x, o.y - doc.hq.y)).toBeGreaterThan(20);
    for (const o of doc.objects) for (const b of [t(doc).water, ...(t(doc).waterBodies ?? [])]) expect(b ? wetAt(doc, o, b.mask) : false).toBe(false);
    seed = 1;
    expect(convertOsm(probe(), { ...options, plantCosts: costs }).doc.objects).toEqual(doc.objects);
  });

  it('thins the plants far from the routes first when the budget runs short, and keeps the single trees', () => {
    const costs = plantCosts(catalog.objects, 1200);
    const full = convertOsm(probe(), { ...options, plantCosts: costs });
    seed = 1;
    // Each plant dearer, so that about a quarter of them fits
    const factor = (4 * PLANT_BUDGET_SHARE * SCENE_BUDGET) / full.report.plants.cost;
    const dear = Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, v * factor]));
    const thin = convertOsm(probe(), { ...options, plantCosts: dear });
    expect(thin.report.plants.objects).toBeLessThan(full.report.plants.objects / 2);
    expect(thin.report.plants.placed['trees']).toBe(full.report.plants.placed['trees']);
    const near = (doc: typeof full.doc) => {
      const routes = [...spawnRoutes(doc).values()].flatMap((r) => (r ? [r.points] : []));
      const forest = doc.objects.filter((o) => o.asset.startsWith('tree-'));
      const close = forest.filter((o) => routes.some((line) => line.some((p, k) => k > 0 && segmentDistance(o, line[k - 1], p) < 150)));
      return close.length / forest.length;
    };
    expect(near(thin.doc)).toBeGreaterThan(near(full.doc));
  });
});

const t = (doc: { terrain: import('../custom-map/map-document').MapTerrain }) => doc.terrain;

function wetAt(doc: { terrain: import('../custom-map/map-document').MapTerrain }, p: { x: number; y: number }, mask: Uint8Array): boolean {
  const g = doc.terrain.grid;
  const i = Math.round((p.x + doc.terrain.width / 2) / g.cellSize);
  const j = Math.round((p.y + doc.terrain.depth / 2) / g.cellSize);
  return mask[j * g.columns + i] !== 0;
}

function segmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
}
