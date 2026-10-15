import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { heightAt } from '../../../editor/model/grid';
import { objectsInAir } from '../../../editor/validation/map-validation';
import { createMapDocument } from '../../custom-map/map-create';
import type { CustomMapDocument, MapPoint } from '../../custom-map/map-document';
import { seatHeight } from '../../custom-map/render/objects/object-seat';
import { buildingKind, BUILDING_MODELS } from '../building-tags';
import { OsmFrame, type OsmArea, type OsmFeatures } from '../osm-parse';
import { fitModels, minAreaRect, placeBuildings, splitFootprint, type BuildingCatalogEntry } from './buildings';

const catalog: BuildingCatalogEntry[] = JSON.parse(readFileSync(join(__dirname, '../../../../../public/maps/assets/catalog.json'), 'utf8')).objects;
const byId = new Map(catalog.map((e) => [e.id, e]));
const all = () => true;

/** A rectangle `a` by `b` round `c`, its side `a` turned `angle` from east */
function box(c: MapPoint, a: number, b: number, angle: number): MapPoint[] {
  const u = { x: Math.cos(angle), y: Math.sin(angle) };
  const v = { x: -u.y, y: u.x };
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([p, q]) => ({ x: c.x + (u.x * a * p) / 2 + (v.x * b * q) / 2, y: c.y + (u.y * a * p) / 2 + (v.y * b * q) / 2 }));
}

function area(id: number, ring: MapPoint[], tags: Record<string, string>): OsmArea {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  return { id, from: 'way', tags, outer: [ring], inner: [], area: Math.abs(s / 2) };
}

/** A 200 m map with one road along y = 0 from west to east, rising `slope` to the north, the HQ far east */
function world(areas: OsmArea[], slope = 0): { doc: CustomMapDocument; features: OsmFeatures } {
  const doc = createMapDocument({ id: 't', name: 't', width: 200, depth: 200, cellSize: 2, baseMaterial: 'grass', splatResolution: 64, starter: false });
  const g = doc.terrain.grid;
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = 20 + Math.max(0, j * g.cellSize - 100) * slope;
  doc.paths = { nodes: [{ id: 'a', x: -95, y: 0 }, { id: 'b', x: 95, y: 0 }], edges: [{ id: 'e1', a: 'a', b: 'b', width: 6, kind: 'road' }] };
  doc.hq = { x: 90, y: 0 };
  doc.spawns = [];
  doc.objects = [];
  return { doc, features: { frame: new OsmFrame(0, 0), half: 100, ways: [], areas, points: [], stats: { elements: 0, ways: 0, relations: 0, points: 0, areas: 0, forcedRings: 0, areasOutside: 0 } } };
}

describe('OSM buildings: shapes and models', () => {
  it('finds the turned rectangle of a footprint', () => {
    const r = minAreaRect(box({ x: 10, y: -4 }, 12, 7, 0.4));
    expect(r.c.x).toBeCloseTo(10, 5);
    expect(r.c.y).toBeCloseTo(-4, 5);
    expect([r.a, r.b].sort((p, q) => p - q).map((v) => +v.toFixed(5))).toEqual([7, 12]);
    // Its side runs along the footprint's
    expect(Math.abs(Math.abs(r.u.x * Math.cos(0.4) + r.u.y * Math.sin(0.4)) - (r.a > r.b ? 1 : 0))).toBeLessThan(1e-6);
  });

  it('cuts an L into two rectangles that cover it', () => {
    const l = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 }];
    const rect = minAreaRect(l);
    const parts = splitFootprint(l, [], rect, 500);
    expect(parts.length).toBe(2);
    const covered = parts.reduce((s, p) => s + p.a * p.b, 0);
    expect(covered).toBeGreaterThan(450);
    expect(covered).toBeLessThanOrEqual(500 + 1e-6);
  });

  it('fits a house with one model, a long block with a row of modules, a garage court with garages', () => {
    const house = fitModels('house', 10, 8.6, null, all)!;
    expect(house.copies * house.rows).toBe(1);
    expect(['house-modern', 'house-modern-red']).toContain(house.model.asset);
    expect(house.scale).toBeGreaterThanOrEqual(0.8);
    expect(house.scale).toBeLessThanOrEqual(1.25);
    const block = fitModels('apartments', 75, 12, 4, all)!;
    expect(block.model.asset).toBe('block-row-4');
    expect(block.copies).toBe(5);
    const garages = fitModels('garage', 15, 6, null, all)!;
    expect(garages.copies * garages.model.box[0] * garages.scale).toBeCloseTo(15, 0);
    // The storeys choose the model, not the scale
    expect(fitModels('office', 22, 18, 8, all)!.model.asset).toBe('office-high');
    // Nothing of a shed's fits a 40 m hall
    expect(fitModels('shed', 40, 20, null, all)).toBeNull();
  });

  it('guesses the kind from the tags, the size and the land use', () => {
    expect(buildingKind({ building: 'yes' }, 10, 1.2, null)).toBe('shed');
    expect(buildingKind({ building: 'yes' }, 36, 2, null)).toBe('garage');
    expect(buildingKind({ building: 'yes' }, 140, 1.3, 'residential')).toBe('house');
    expect(buildingKind({ building: 'yes', 'building:levels': '5' }, 300, 1.5, null)).toBe('apartments');
    expect(buildingKind({ building: 'yes' }, 2000, 2, 'industrial')).toBe('industrial');
    expect(buildingKind({ building: 'yes', amenity: 'place_of_worship' }, 600, 2, null)).toBe('church');
    expect(buildingKind({ building: 'garages' }, 90, 5, null)).toBe('garage');
  });

  it('only names models the catalogue has', () => {
    for (const asset of Object.keys(BUILDING_MODELS)) expect(byId.has(asset)).toBe(true);
    expect(byId.has('retaining-wall')).toBe(true);
  });
});

describe('OSM buildings: placing', () => {
  it('turns a house to the street, keeps it off the road and levels nothing on flat ground', () => {
    // A house north of the road, its long side along it, a little turned
    const { doc, features } = world([area(1, box({ x: 0, y: 12 }, 10, 8.6, 0.1), { building: 'house' })]);
    const { objects, report } = placeBuildings(doc, features, { catalog });
    expect(objects.length).toBe(1);
    const o = objects[0];
    // Front (local +z) turned by the rotation: (-sin r, cos r) points south, to the road
    expect(Math.cos(o.rotation)).toBeLessThan(-0.9);
    expect(o.group).toBe('osm-b1');
    expect(report.placed).toBe(1);
    expect(report.pads).toBe(0);
  });

  it('leaves out what stands on the road, in water and at the HQ', () => {
    const { doc, features } = world([
      area(1, box({ x: -40, y: 0 }, 10, 10, 0), { building: 'house' }),
      area(2, box({ x: 88, y: 12 }, 10, 8, 0), { building: 'house' }),
      area(3, box({ x: 0, y: 40 }, 10, 8, 0), { building: 'house' }),
      area(4, box({ x: 0, y: 40 }, 40, 40, 0), { natural: 'water' }),
    ]);
    const { objects, report } = placeBuildings(doc, features, { catalog });
    expect(objects).toEqual([]);
    expect(report.dropped).toMatchObject({ roads: 1, hq: 1, water: 1 });
  });

  it('cuts a pad to the lowest corner on a slope, seats the house there and holds the hill with a retaining wall', () => {
    const { doc, features } = world([area(1, box({ x: 0, y: 130 - 100 + 14 }, 12, 10, 0), { building: 'house' })], 0.35);
    const { objects, report } = placeBuildings(doc, features, { catalog });
    const house = objects.find((o) => o.asset !== 'retaining-wall')!;
    expect(report.pads).toBe(1);
    const entry = byId.get(house.asset)!;
    const seat = seatHeight(entry, house, (x, y) => heightAt(doc.terrain, x, y), () => null);
    const groundUnder = heightAt(doc.terrain, house.x, house.y);
    expect(seat).toBeCloseTo(groundUnder, 3);
    doc.objects = objects;
    expect(objectsInAir(doc, (a) => byId.get(a))).toEqual([]);
    // The hill uphill (north) stands more than two metres over the pad: walls there, facing the house
    const walls = objects.filter((o) => o.asset === 'retaining-wall');
    expect(walls.length).toBeGreaterThan(0);
    for (const w of walls) expect(w.y).toBeGreaterThan(house.y);
  });

  it('holds the buildings to their share of the scene budget, the small far ones first', () => {
    const areas = [area(1, box({ x: 0, y: 14 }, 10, 8.6, 0), { building: 'house' })];
    for (let k = 0; k < 8; k++) areas.push(area(10 + k, box({ x: -80 + k * 12, y: -12 }, 3, 6, 0), { building: 'garage' }));
    const { doc, features } = world(areas);
    const one = placeBuildings(doc, features, { catalog }).report.cost;
    const { report, warnings } = placeBuildings(world(areas).doc, features, { catalog, budget: one * 0.6 });
    expect(report.dropped.budget).toBeGreaterThan(0);
    expect(report.cost).toBeLessThanOrEqual(one * 0.6);
    expect(warnings.some((w) => w.includes('scene cost'))).toBe(true);
  });
});
