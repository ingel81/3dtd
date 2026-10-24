import { validateMap } from '../../../map-ops/validation/map-validation';
import { createMapDocument } from '../../custom-map/map-create';
import type { CustomMapDocument, MapPoint } from '../../custom-map/map-document';
import { insideSurface, markingFrame, parkingRows } from '../../custom-map/map-surfaces';
import { areaLookOf, availableMaterial } from '../area-tags';
import { landClassOf } from '../land-tags';
import { OsmFrame, type OsmArea, type OsmFeatures, type OsmPoint } from '../osm-parse';
import { layAreas } from './areas';
import { sampleGrid } from './raster';
import type { WaterResult } from './water-types';

const box = (x0: number, y0: number, x1: number, y1: number): MapPoint[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

let nextId = 1;
const area = (tags: Record<string, string>, outer: MapPoint[], inner: MapPoint[][] = []): OsmArea => ({ id: nextId++, from: 'way', tags, outer: [outer], inner, area: Math.abs(ringArea(outer)) });
const ringArea = (r: MapPoint[]) => r.reduce((s, p, k) => s + (r[(k + r.length - 1) % r.length].x - p.x) * (r[(k + r.length - 1) % r.length].y + p.y), 0) / 2;

/** A 400 m map with one 6 m road along y = -150, the HQ far east */
function world(areas: OsmArea[], points: OsmPoint[] = []): { doc: CustomMapDocument; features: OsmFeatures; water: WaterResult } {
  const doc = createMapDocument({ id: 't', name: 't', width: 400, depth: 400, cellSize: 2, baseMaterial: 'grass', splatResolution: 64, starter: false });
  doc.paths = { nodes: [{ id: 'a', x: -195, y: -150 }, { id: 'b', x: 195, y: -150 }], edges: [{ id: 'e1', a: 'a', b: 'b', width: 6, kind: 'road', surface: 'asphalt' }] };
  doc.hq = { x: 190, y: -150 };
  doc.spawns = [];
  doc.objects = [];
  const n = sampleGrid(400, 2).n ** 2;
  const water = { wet: new Uint8Array(n), sea: new Uint8Array(n), roads: new Uint8Array(n) } as WaterResult;
  const features: OsmFeatures = { frame: new OsmFrame(0, 0), half: 200, ways: [], areas, points, stats: { elements: 0, ways: 0, relations: 0, points: 0, areas: 0, forcedRings: 0, cutAreas: 0, turnedAreas: 0, areasOutside: 0 } };
  return { doc, features, water };
}

const costOf = () => 100;
const lay = (w: ReturnType<typeof world>, budget?: number) => layAreas(w.doc, w.features, w.water, { costOf, routes: [], budget, hasMaterial: () => true });

describe('OSM areas: the table', () => {
  it('reads the kind, material and lines of an area from its tags', () => {
    expect(areaLookOf({ leisure: 'pitch', sport: 'soccer' })).toMatchObject({ kind: 'soccer', material: 'grass-lush', marking: 'soccer', level: true });
    expect(areaLookOf({ leisure: 'pitch', sport: 'soccer', surface: 'artificial_turf' })?.material).toBe('artificial-turf');
    expect(areaLookOf({ leisure: 'pitch', sport: 'tennis' })?.material).toBe('red-earth');
    expect(areaLookOf({ leisure: 'pitch', sport: 'tennis', surface: 'asphalt' })?.material).toBe('hard-court-green');
    expect(areaLookOf({ leisure: 'pitch', sport: 'basketball;soccer' })?.kind).toBe('basketball');
    expect(areaLookOf({ leisure: 'pitch', sport: 'curling' })).toMatchObject({ kind: 'pitch', material: 'grass-lush' });
    expect(areaLookOf({ leisure: 'playground', surface: 'sand' })?.material).toBe('sand');
    // A playground without a surface is lawn (rubber only where OSM says so)
    expect(areaLookOf({ leisure: 'playground' })?.material).toBe('grass-lush');
    expect(areaLookOf({ leisure: 'playground', surface: 'rubber' })?.material).toBe('rubber-safety');
    expect(areaLookOf({ amenity: 'parking' })).toMatchObject({ kind: 'parking', marking: 'parking' });
    expect(areaLookOf({ amenity: 'parking', parking: 'multi-storey' })).toBeNull();
    expect(areaLookOf({ highway: 'pedestrian', area: 'yes' })).toMatchObject({ kind: 'square', material: 'paving' });
    expect(areaLookOf({ 'area:highway': 'footway', surface: 'sett' })).toMatchObject({ kind: 'square', material: 'cobblestone' });
    expect(areaLookOf({ 'area:highway': 'primary' })).toBeNull();
    expect(areaLookOf({ railway: 'platform' })).toMatchObject({ kind: 'platform', marking: 'platform' });
    expect(areaLookOf({ landuse: 'cemetery' })).toMatchObject({ kind: 'cemetery', material: null });
    expect(areaLookOf({ leisure: 'pitch', sport: 'soccer', building: 'yes' })).toBeNull();
  });

  it('falls back along a material chain to one the catalogue has, the last when it says nothing', () => {
    const has = (id: string) => ['red-earth', 'sand', 'asphalt'].includes(id);
    expect(availableMaterial('tartan', has)).toBe('red-earth');
    expect(availableMaterial('hard-court-green', has)).toBe('asphalt');
    expect(availableMaterial('tartan', null)).toBe('sand');
    expect(availableMaterial('paving', null)).toBe('paving');
  });

  it('paints no ground under retail and commercial land any more: paving lies where OSM says paving', () => {
    expect(landClassOf({ landuse: 'retail' })).toBeNull();
    expect(landClassOf({ landuse: 'commercial' })).toBeNull();
    expect(landClassOf({ leisure: 'pitch' })).toBe('pitch');
  });
});

describe('OSM areas: surfaces and objects', () => {
  it('lays a football pitch with its lines and a goal on each goal line facing the middle', () => {
    const w = world([area({ leisure: 'pitch', sport: 'soccer' }, box(-55, -35, 55, 35))]);
    const { report } = lay(w);
    const s = w.doc.surfaces![0];
    expect(s).toMatchObject({ material: 'grass-lush', group: expect.stringMatching(/^osm-a/) });
    expect(s.marking).toMatchObject({ kind: 'soccer', length: 110, width: 70 });
    expect(report.surfaces.soccer).toBe(1);
    const goals = w.doc.objects.filter((o) => o.asset === 'football-goal');
    expect(goals).toHaveLength(2);
    for (const g of goals) {
      const f = markingFrame(s.marking!, g);
      expect(Math.abs(Math.abs(f.u) - 54.95)).toBeLessThan(1.5);
      // Facing the middle: the model's front (north at turn 0) points at the centre
      const front = { x: -Math.sin(g.rotation), y: Math.cos(g.rotation) };
      expect(front.x * -g.x + front.y * -g.y).toBeGreaterThan(0);
    }
  });

  it('fences a tennis court and puts its net across the middle, keeps the lines off a badly filled outline', () => {
    const w = world([
      area({ leisure: 'pitch', sport: 'tennis' }, box(-80, 0, -62, 36)),
      area({ leisure: 'pitch', sport: 'tennis' }, [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 40 }, { x: 0, y: 40 }]),
    ]);
    lay(w);
    const [court, odd] = w.doc.surfaces!;
    expect(court.marking?.kind).toBe('tennis');
    expect(odd.marking).toBeUndefined();
    expect(w.doc.objects.filter((o) => o.asset === 'tennis-net')).toHaveLength(1);
    expect(w.doc.objects.filter((o) => o.asset === 'fence-chainlink').length).toBeGreaterThan(20);
  });

  it('parks cars nose in on some of the stalls, all of them on the car park', () => {
    const w = world([area({ amenity: 'parking' }, box(-60, 0, 0, 34))]);
    lay(w);
    const s = w.doc.surfaces![0];
    const m = s.marking!;
    const cars = w.doc.objects.filter((o) => o.asset.startsWith('car-'));
    const stalls = parkingRows(m).reduce((n, r) => n + r.stalls.length, 0);
    expect(cars.length).toBeGreaterThan(stalls * 0.3);
    expect(cars.length).toBeLessThan(stalls * 0.8);
    for (const c of cars) expect(insideSurface(s, c)).toBe(true);
  });

  it('puts the mapped devices on a playground, a set by its size where none are mapped, benches at its edge', () => {
    const mapped = area({ leisure: 'playground' }, box(-100, 20, -60, 60));
    const bare = area({ leisure: 'playground' }, box(60, 20, 100, 60));
    const w = world([mapped, bare], [
      { id: 1, tags: { playground: 'swing' }, x: -90, y: 30 },
      { id: 2, tags: { playground: 'slide' }, x: -70, y: 50 },
    ]);
    lay(w);
    const left = w.doc.objects.filter((o) => o.x < 0 && o.asset !== 'bench');
    expect(left.map((o) => o.asset).sort()).toEqual(['playground-slide', 'playground-swing']);
    const right = w.doc.objects.filter((o) => o.x > 0 && o.asset !== 'bench');
    expect(right.length).toBeGreaterThanOrEqual(4);
    expect(w.doc.objects.some((o) => o.asset === 'bench')).toBe(true);
  });

  it('gives an untagged square inside another its material, keeps objects off the road and holds the budget', () => {
    const w = world([
      area({ highway: 'pedestrian', area: 'yes', surface: 'sett' }, box(-40, 60, 40, 120)),
      area({ 'area:highway': 'footway' }, box(-10, 80, 10, 100)),
      area({ amenity: 'parking' }, box(-30, -160, 30, -120)),
    ]);
    const { report } = lay(w, 1500);
    const [square, footway] = w.doc.surfaces!.filter((s) => s.material !== 'asphalt');
    expect(square.material).toBe('cobblestone');
    expect(footway.material).toBe('cobblestone');
    expect(report.cost).toBeLessThanOrEqual(1500);
    expect(report.dropped.budget + report.dropped.road).toBeGreaterThan(0);
    expect(validateMap(w.doc).map((i) => i.code)).not.toContain('object-on-path');
  });

  it('levels the ground of a pitch on a slope to one height, the ground round it eased to it', () => {
    const w = world([area({ leisure: 'pitch', sport: 'soccer' }, box(-30, -20, 30, 20))]);
    const g = w.doc.terrain.grid;
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = (i * g.cellSize - 200) * 0.1;
    const { report } = lay(w);
    expect(report.levelled).toBe(1);
    const at = (x: number, y: number) => g.heights[Math.round((y + 200) / 2) * g.columns + Math.round((x + 200) / 2)];
    expect(at(-28, 0)).toBeCloseTo(at(28, 0), 5);
    expect(at(-40, 0)).toBeCloseTo(-4, 1);
  });

  it('lays rows of graves with paths across a cemetery, a hedge round it, and plots in allotments', () => {
    const w = world([area({ landuse: 'cemetery' }, box(-150, 20, -50, 100)), area({ landuse: 'allotments' }, box(20, 20, 140, 120))]);
    const { report } = lay(w);
    expect(report.placed['graves']).toBeGreaterThan(50);
    expect(report.placed['cemetery hedge']).toBeGreaterThan(10);
    expect(w.doc.surfaces!.filter((s) => s.id.includes('-path-'))).toHaveLength(2);
    expect(report.placed['allotment sheds']).toBeGreaterThan(5);
  });
});
