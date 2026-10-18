import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { heightAt } from '../../../map-ops/grid';
import { objectsInAir, objectsOnPaths, validateMap } from '../../../map-ops/validation/map-validation';
import { createMapDocument } from '../../custom-map/map-create';
import { MASS_ASSET, type CustomMapDocument, type MapPoint } from '../../custom-map/map-document';
import { massArea } from '../../custom-map/object-mass';
import { seatHeight } from '../../custom-map/render/objects/object-seat';
import { buildingKind, BUILDING_MODELS } from '../building-tags';
import { OsmFrame, type OsmArea, type OsmFeatures } from '../osm-parse';
import { fitModels, minAreaRect, placeBuildings, splitFootprint, type BuildingCatalogEntry } from './buildings';

/** A nursing home's outline and courtyard as OSM maps such buildings (mirrored), metres east and north of its middle */
const HOME_OUTER = [
  [-24.5, 28.1], [-7, 27], [-6.8, 29.5], [5.5, 28.8], [5.6, 30.4], [15.6, 29.8], [15.5, 28.4], [27.3, 27.7], [27.2, 25.7], [34.5, 25.2],
  [34.7, 28.5], [60.5, 33.9], [62.7, 23.5], [74.2, 22.2], [74, 13.6], [40.5, 15.4], [40, 9.7], [41.7, 9.7], [41, -8.2], [39.1, -8.1],
  [38.9, -13.3], [61.9, -14.9], [61.2, -23.8], [51.2, -23.3], [50.7, -26], [31, -25.2], [31.1, -23.8], [-16.3, -21.1], [-16.3, -19.4],
  [-23.6, -19.4], [-24.2, -14.7], [-28, -14.4], [-28.1, -17.8], [-35.4, -17.3], [-34.9, -5.3], [-38.9, -5.1], [-39.6, -15.1], [-41.5, -14.9],
  [-41.9, -18], [-42.6, -19.6], [-43.8, -19.7], [-45.7, -19.7], [-47.6, -18.9], [-48.7, -17.6], [-49.8, -15.5], [-49.5, -4.4], [-58.6, -4.5],
  [-58.9, -6.3], [-73, -5], [-72.2, 14.3], [-54.2, 13.4], [-54.4, 6.8], [-33, 5.5], [-26.9, 14.8], [-25.1, 14.8],
];
const HOME_YARD = [
  [31.4, 14.1], [30.8, 1.8], [27.7, 2], [27.5, -2.2], [30, -2.3], [29.5, -13.2], [25.2, -13], [25.3, -10.5], [13.5, -9.9],
  [13.6, -7.7], [3, -7.2], [2.9, -8.9], [-8.2, -8.3], [-8.3, -10], [-13.4, -9.8], [-12.1, 16.3],
];

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
  return { doc, features: { frame: new OsmFrame(0, 0), half: 100, ways: [], areas, points: [], stats: { elements: 0, ways: 0, relations: 0, points: 0, areas: 0, forcedRings: 0, cutAreas: 0, turnedAreas: 0, areasOutside: 0 } } };
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

  it('fits the outbuildings, the farm barn and the small commercial building of their size', () => {
    expect(fitModels('shed', 4.5, 4.5, null, all)!.model.asset).toBe('outbuilding');
    expect(fitModels('farm', 12, 18, null, all)!.model.asset).toBe('barn-modern');
    expect(fitModels('carport', 7, 2.6, null, all)!.model.asset).toBe('shelter-lean-to');
    expect(fitModels('office', 12, 10, 4, all)!.model.asset).toBe('shop-office');
    expect(fitModels('house', 7, 5, null, all)!.model.asset).toBe('annex');
  });

  it('guesses the kind from the tags, the size and the land use', () => {
    expect(buildingKind({ building: 'yes' }, 10, 1.2, null)).toBe('shed');
    expect(buildingKind({ building: 'yes' }, 36, 2, null)).toBe('garage');
    expect(buildingKind({ building: 'yes' }, 140, 1.3, 'residential')).toBe('house');
    expect(buildingKind({ building: 'yes', 'building:levels': '5' }, 300, 1.5, null)).toBe('apartments');
    expect(buildingKind({ building: 'yes' }, 2000, 2, 'industrial')).toBe('industrial');
    expect(buildingKind({ building: 'yes', amenity: 'place_of_worship' }, 600, 2, null)).toBe('church');
    expect(buildingKind({ building: 'garages' }, 90, 5, null)).toBe('garage');
    // A big untagged footprint: a block of flats among blocks, a big house among houses (a village, a suburb)
    expect(buildingKind({ building: 'yes' }, 280, 1.4, 'residential')).toBe('apartments');
    expect(buildingKind({ building: 'yes' }, 280, 1.4, 'residential', 110)).toBe('house');
    expect(buildingKind({ building: 'yes' }, 280, 1.4, 'residential', 600)).toBe('apartments');
    // A nursing home is no factory hall; a big footprint with wings or a courtyard is a block
    expect(buildingKind({ building: 'yes', amenity: 'social_facility' }, 3900, 2.5, null)).toBe('civic');
    expect(buildingKind({ building: 'yes' }, 3900, 2.5, null)).toBe('industrial');
    expect(buildingKind({ building: 'yes' }, 3900, 2.5, null, null, true)).toBe('apartments');
  });

  it('lays a house as one house, not as a row of terraced modules; the narrow one as a lone module', () => {
    // 13 x 10 m: one house at its scale, whatever the salt
    for (let salt = 0; salt < 7; salt++) {
      const fit = fitModels('house', 13, 10, null, all, salt)!;
      expect(fit.copies * fit.rows).toBe(1);
      expect(fit.model.module).toBeFalsy();
    }
    // 6 x 10 m between neighbours: the terraced module, alone
    const narrow = fitModels('house', 6, 10, null, all)!;
    expect(narrow.model.asset).toBe('house-terrace');
    expect(narrow.copies * narrow.rows).toBe(1);
    // A terrace stays a row of modules
    expect(fitModels('terrace', 30, 10, null, all)!.copies).toBeGreaterThan(1);
  });

  it('varies the houses: both detached models and tints over many footprints', () => {
    const areas = Array.from({ length: 24 }, (_, k) => area(1000 + k * 7919, box({ x: -88 + k * 7.5, y: 12 }, 7, 9.5, 0), { building: 'house' }));
    const { doc, features } = world(areas);
    const { objects } = placeBuildings(doc, features, { catalog });
    const assets = new Set(objects.map((o) => o.asset));
    expect(assets.size).toBeGreaterThan(1);
    expect(new Set(objects.map((o) => o.tint ?? 'none')).size).toBeGreaterThan(2);
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

  it('raises a footprint with wings round a courtyard from its outline: one building, all of it, nothing on the road', () => {
    // A nursing home as in E235: wings round a courtyard, metres about its middle
    const at = (xy: number[][]) => xy.map(([x, y]) => ({ x: x - 10, y: y + 45 }));
    const outline = at(HOME_OUTER);
    const yard = at(HOME_YARD);
    const ringArea = (r: MapPoint[]) => Math.abs(r.reduce((s, p, i) => s + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0) / 2);
    const home: OsmArea = { id: 5, from: 'relation', tags: { building: 'yes', amenity: 'social_facility' }, outer: [outline], inner: [yard], area: ringArea(outline) - ringArea(yard) };
    const { doc, features } = world([home, area(6, box({ x: -60, y: -14 }, 10, 8.6, 0), { building: 'house' })]);
    const { objects, report } = placeBuildings(doc, features, { catalog });
    expect(report.masses).toBe(1);
    expect(report.kinds.civic).toBe(1);
    const raised = objects.filter((o) => o.asset === MASS_ASSET);
    expect(raised.length).toBe(1);
    const mass = raised[0].mass!;
    expect(mass.rings.length).toBe(2);
    // All of it, less what simplifying the outline takes
    expect(massArea(mass) / home.area).toBeGreaterThan(0.97);
    expect(mass.facade).toBe('plaster');
    expect(raised[0].group).toBe('osm-b5');
    // The house beside it keeps its model
    expect(objects.some((o) => o.group === 'osm-b6' && o.asset !== MASS_ASSET)).toBe(true);
    doc.objects = objects;
    const footingOf = (a: string) => byId.get(a);
    expect(validateMap(doc, { footingOf, blocksBuild: () => true }).filter((i) => i.code === 'object-on-path' || i.code === 'object-floating')).toEqual([]);
    expect(objectsInAir(doc, footingOf)).toEqual([]);
  });

  it('cuts a raised building back from the road it reaches onto, and raises a footprint no model fits', () => {
    // An L whose wing reaches 1 m onto the road's south half (the road along y = 0, 6 m wide)
    const l: MapPoint[] = [{ x: -30, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 12 }, { x: -20, y: 12 }, { x: -20, y: 30 }, { x: -30, y: 30 }];
    const { doc, features } = world([area(7, l, { building: 'school' })]);
    const { objects, report } = placeBuildings(doc, features, { catalog });
    expect(report.masses).toBe(1);
    doc.objects = objects;
    expect(objectsOnPaths(doc, { footingOf: (a) => byId.get(a), blocksBuild: () => true })).toEqual([]);
    expect(massArea(objects[0].mass!)).toBeGreaterThan(0.85 * 460);
  });

  it('with a cap, holds the buildings to it, the small far ones first; without one every footprint stands', () => {
    const areas = [area(1, box({ x: 0, y: 14 }, 10, 8.6, 0), { building: 'house' })];
    for (let k = 0; k < 8; k++) areas.push(area(10 + k, box({ x: -80 + k * 12, y: -12 }, 3, 6, 0), { building: 'garage' }));
    const { doc, features } = world(areas);
    const one = placeBuildings(doc, features, { catalog }).report.cost;
    const { report, warnings } = placeBuildings(world(areas).doc, features, { catalog, budget: one * 0.6 });
    expect(report.dropped.budget).toBeGreaterThan(0);
    expect(report.cost).toBeLessThanOrEqual(one * 0.6);
    expect(warnings.some((w) => w.includes('scene cost'))).toBe(true);
    expect(placeBuildings(world(areas).doc, features, { catalog }).report.dropped.budget).toBe(0);
  });
});
