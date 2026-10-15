import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { objectsInAir, validateMap } from '../../editor/validation/map-validation';
import { routeBetween } from '../../editor/ops/path-graph';
import { packMapFile, unpackMapFile, validateMapDocument } from '../custom-map/map-file';
import { mapStreetNetwork } from '../custom-map/custom-map-streets';
import type { DemMosaic } from './dem-tiles';
import { objectCost, SCENE_BUDGET } from '../custom-map/render/objects/scene-cost';
import type { CatalogObject } from '../custom-map/render/asset-catalog';
import { BUILDING_BUDGET_SHARE } from './convert/buildings';
import { convertOsm, type OsmImportInput } from './import-osm';

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

  it('stands the buildings on their footprints: catalogue models, off the roads, seated, within their share of the scene cost', () => {
    const catalog: CatalogObject[] = JSON.parse(readFileSync(join(__dirname, '../../../../public/maps/assets/catalog.json'), 'utf8')).objects;
    const byId = new Map(catalog.map((e) => [e.id, e]));
    const { doc, report } = convertOsm(probe(), { ...options, catalog });
    const b = report.buildings;
    // Miltenberg's 1.2 km: about a thousand footprints, nearly all of them stand
    expect(b.footprints).toBeGreaterThan(800);
    expect(b.placed / b.footprints).toBeGreaterThan(0.9);
    expect(doc.objects.length).toBe(b.objects);
    for (const o of doc.objects) expect(byId.has(o.asset)).toBe(true);
    expect(b.kinds.house).toBeGreaterThan(0);
    expect(b.kinds.apartments).toBeGreaterThan(0);
    expect(b.kinds.garage).toBeGreaterThan(0);
    const issues = validateMap(doc, { footingOf: (a) => byId.get(a), blocksBuild: (a) => byId.get(a)?.blocksBuild ?? false });
    expect(issues.filter((i) => i.code === 'object-on-path' || i.code === 'object-floating' || i.severity === 'error')).toEqual([]);
    expect(objectsInAir(doc, (a) => byId.get(a))).toEqual([]);
    const area = doc.terrain.width * doc.terrain.depth;
    const cost = doc.objects.reduce((s, o) => s + objectCost(byId.get(o.asset), area), 0);
    expect(cost).toBeCloseTo(b.cost, -2);
    expect(b.cost).toBeLessThanOrEqual(BUILDING_BUDGET_SHARE * SCENE_BUDGET * 1.1);
    expect(b.missing.every((m) => m.count > 0)).toBe(true);
  });

  it('places no buildings without them in the data, and warns when it has no catalogue', () => {
    const input = probe();
    const { report } = convertOsm({ ...input, overpass: { elements: input.overpass.elements.filter((e) => !e.tags?.['building']) } }, options);
    expect(report.buildings.objects).toBe(0);
    expect(report.warnings.some((w) => w.startsWith('buildings: no asset catalogue'))).toBe(true);
  });
});
