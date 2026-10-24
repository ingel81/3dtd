import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { heightAt } from '../../../map-ops/grid';
import { objectsInAir, objectsOnPaths, validateMap } from '../../../map-ops/validation/map-validation';
import { createMapDocument } from '../../custom-map/map-create';
import { MASS_ASSET, type CustomMapDocument, type MapPoint } from '../../custom-map/map-document';
import { massArea, massContains, massDistance } from '../../custom-map/object-mass';
import { cellarDepth, cellarForDrop } from '../../custom-map/object-cellar';
import { toModel } from '../../custom-map/object-ground';
import { seatHeight } from '../../custom-map/render/objects/object-seat';
import { buildingKind, BUILDING_MODELS } from '../building-tags';
import { OsmFrame, type OsmArea, type OsmFeatures } from '../osm-parse';
import { fitModels, placeBuildings, splitFootprint, type BuildingCatalogEntry } from './buildings';
import { noteWords } from '../../testing/note-words';
import { minAreaRect } from '../../custom-map/map-surfaces';

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

/** A 200 m map with one road along y = 0 from west to east, rising `slope` to the north (falling for a negative one), the HQ far east */
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
    // A house on a sports ground is the club's; a covered reservoir or a service building a technical box
    expect(buildingKind({ building: 'yes' }, 200, 1.5, 'sports')).toBe('clubhouse');
    // On a cemetery its chapel, a small one its shed
    expect(buildingKind({ building: 'yes' }, 120, 1.6, 'cemetery')).toBe('chapel');
    expect(buildingKind({ building: 'yes' }, 20, 1.2, 'cemetery')).toBe('shed');
    expect(buildingKind({ building: 'yes' }, 1200, 1.5, 'sports')).toBe('industrial');
    expect(buildingKind({ building: 'yes', man_made: 'storage_tank' }, 55, 1.2, null)).toBe('garage');
    expect(buildingKind({ building: 'service' }, 32, 1.2, null)).toBe('garage');
    // A big untagged footprint: a block of flats among blocks, a big house among houses (a village, a suburb)
    expect(buildingKind({ building: 'yes' }, 280, 1.4, 'residential')).toBe('apartments');
    expect(buildingKind({ building: 'yes' }, 280, 1.4, 'residential', 110)).toBe('house');
    expect(buildingKind({ building: 'yes' }, 280, 1.4, 'residential', 600)).toBe('apartments');
    // A nursing home is no factory hall; a big footprint with wings or a courtyard is a block
    expect(buildingKind({ building: 'yes', amenity: 'social_facility' }, 3900, 2.5, null)).toBe('civic');
    expect(buildingKind({ building: 'yes' }, 3900, 2.5, null)).toBe('industrial');
    expect(buildingKind({ building: 'yes' }, 3900, 2.5, null, null, true)).toBe('apartments');
    // In an old town houses, shops and small public buildings are old-town houses; a church stays one
    expect(buildingKind({ building: 'yes' }, 140, 1.3, 'residential', 110, false, true)).toBe('oldtown');
    expect(buildingKind({ building: 'retail' }, 300, 1.5, null, null, false, true)).toBe('oldtown');
    expect(buildingKind({ building: 'church' }, 600, 2, null, null, false, true)).toBe('church');
    expect(buildingKind({ building: 'yes', 'building:levels': '8' }, 300, 1.5, null, null, false, true)).toBe('apartments');
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

  it("starts a house's door at its model's door on the front, and turns the front to a mapped entrance", () => {
    const ring = box({ x: 0, y: 12 }, 10, 8.6, 0);
    const street = world([area(1, ring, { building: 'house' })]);
    const toStreet = placeBuildings(street.doc, street.features, { catalog });
    const door = toStreet.doors.get(1)!;
    // On the front wall (y = 7.7), facing the road, at the model's door
    expect(door.ny).toBeLessThan(-0.9);
    expect(Math.abs(door.y - 7.7)).toBeLessThan(0.8);
    const o = toStreet.objects[0];
    const own = byId.get(o.asset)!.doors![0];
    expect(Math.hypot(door.x - (o.x - own[0] * Math.cos(o.rotation) * o.scale - own[1] * Math.sin(o.rotation) * o.scale), door.y - (o.y - own[0] * Math.sin(o.rotation) * o.scale + own[1] * Math.cos(o.rotation) * o.scale))).toBeLessThan(0.05);
    // The main entrance OSM maps on the back: the front, the door and so the footpath there
    const mapped = world([area(1, ring, { building: 'house' })]);
    mapped.features.points.push({ id: 9, tags: { entrance: 'main' }, x: 1, y: 16.3 }, { id: 10, tags: { entrance: 'service' }, x: -5, y: 10 });
    const entered = placeBuildings(mapped.doc, mapped.features, { catalog });
    expect(Math.cos(entered.objects[0].rotation)).toBeGreaterThan(0.9);
    expect(entered.doors.get(1)!.ny).toBeGreaterThan(0.9);
    expect(Math.abs(entered.doors.get(1)!.y - 16.3)).toBeLessThan(0.8);
  });

  it('turns a model whose door is on its side to show that side to the street (a kiosk)', () => {
    // 3 m along the road, 4 m deep: the kiosk (4 x 3, its door on its east side) stands across, its east to the road
    const { doc, features } = world([area(3, box({ x: 0, y: 6 }, 3, 4, 0), { building: 'kiosk' })]);
    const { objects, doors } = placeBuildings(doc, features, { catalog });
    expect(objects[0].asset).toBe('kiosk');
    expect(byId.get('kiosk')!.doors![0][2]).toBe('east');
    // Its front (local +z) along the road, its door facing it
    expect(Math.abs(Math.cos(objects[0].rotation))).toBeLessThan(0.1);
    expect(doors.get(3)!.ny).toBeLessThan(-0.9);
  });

  it("puts a raised building's door on the wall to the street, and none on a garage court", () => {
    const at = (xy: number[][]) => xy.map(([x, y]) => ({ x: x - 10, y: y + 45 }));
    const outline = at(HOME_OUTER);
    const yard = at(HOME_YARD);
    const ringArea = (r: MapPoint[]) => Math.abs(r.reduce((s, p, i) => s + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0) / 2);
    const home: OsmArea = { id: 5, from: 'relation', tags: { building: 'yes', amenity: 'social_facility' }, outer: [outline], inner: [yard], area: ringArea(outline) - ringArea(yard) };
    const garages = area(7, box({ x: -70, y: -14 }, 24, 6, 0), { building: 'garages' });
    const { doc, features } = world([home, garages]);
    const { objects, doors } = placeBuildings(doc, features, { catalog });
    const raised = objects.find((o) => o.group === 'osm-b5')!;
    const door = doors.get(5)!;
    // On the outline's south side, facing the road at y = 0, and so in the mass (MapMass.door, its own axes)
    expect(door.ny).toBeLessThan(-0.7);
    expect(door.y).toBeLessThan(25);
    const local = toModel(door.x - raised.x, door.y - raised.y, Math.cos(raised.rotation), Math.sin(raised.rotation));
    expect(Math.hypot(local.x - raised.mass!.door![0], local.z - raised.mass!.door![1])).toBeLessThan(0.05);
    expect(doors.has(7)).toBe(false);
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

  it('stands a house below the street at the street over a cellar open to the valley, no walls round it', () => {
    const { doc, features } = world([area(1, box({ x: 0, y: 14 }, 12, 10, 0), { building: 'house' })], -0.3);
    const { objects, report } = placeBuildings(doc, features, { catalog });
    expect(objects.filter((o) => o.asset === 'retaining-wall')).toEqual([]);
    const house = objects[0];
    expect(report.basements).toBe(1);
    // Its floor at the ground before its entrance (the street's side, south), its cellar open down past the seat
    const entry = byId.get(house.asset)!;
    const seat = seatHeight(entry, house, (x, y) => heightAt(doc.terrain, x, y), () => null);
    const front = house.y - entry.box![3] * house.scale - 1.5;
    expect(seat + house.z).toBeCloseTo(heightAt(doc.terrain, house.x, front), 0);
    expect(house.z).toBeGreaterThan(1.5);
    expect(house.cellar).toEqual(cellarForDrop(house.z));
    expect(house.cellar!.mode).toBe('auto');
    expect(cellarDepth(house.cellar!)).toBeGreaterThan(house.z);
    // Nothing filled under it: the valley side keeps its ground
    expect(heightAt(doc.terrain, house.x, house.y + 8)).toBeCloseTo(20 - (house.y + 8) * 0.3, 1);
    doc.objects = objects;
    expect(objectsInAir(doc, (a) => byId.get(a))).toEqual([]);
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

  it('stands whole over a passage through its wing and a square outline in its walls (E297 L1)', () => {
    const at = (xy: number[][]) => xy.map(([x, y]) => ({ x: x - 10, y: y + 45 }));
    const outline = at(HOME_OUTER);
    const yard = at(HOME_YARD);
    const ringArea = (r: MapPoint[]) => Math.abs(r.reduce((s, p, i) => s + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0) / 2);
    const home: OsmArea = { id: 5, from: 'relation', tags: { building: 'yes', amenity: 'social_facility' }, outer: [outline], inner: [yard], area: ringArea(outline) - ringArea(yard) };
    const { doc, features } = world([home]);
    // A footway through the north wing into the courtyard, its door on the north wall where a lane from the north
    // ends (as OSM maps a passage: its nodes on the wall), and the courtyard's outline with its ends in the east and
    // west wings
    doc.paths.nodes.push({ id: 'p0', x: 0, y: 95 }, { id: 'p1', x: 0, y: 75.14 }, { id: 'p2', x: 0, y: 58 }, { id: 'q1', x: -25, y: 40 }, { id: 'q2', x: 25, y: 46 });
    doc.paths.edges.push(
      { id: 'lane', a: 'p0', b: 'p1', width: 4, kind: 'road' },
      { id: 'pass', a: 'p1', b: 'p2', width: 2.5, kind: 'path', covered: true },
      { id: 'yard', a: 'q1', b: 'q2', width: 5, kind: 'road', area: true, via: [{ x: 0, y: 38 }] },
    );
    const { objects, report } = placeBuildings(doc, features, { catalog });
    expect(report.masses).toBe(1);
    const raised = objects.filter((o) => o.asset === MASS_ASSET);
    expect(raised.length).toBe(1);
    expect(raised[0].scale).toBe(1);
    expect(raised[0].mass!.rings.length).toBe(2);
    expect(massArea(raised[0].mass!) / home.area).toBeGreaterThan(0.97);
    // The editor's check agrees: the passage runs under it, the outline is walked, not built over
    doc.objects = objects;
    expect(objectsOnPaths(doc, { footingOf: (a) => byId.get(a), blocksBuild: () => true })).toEqual([]);
    expect(report.coverage).toMatchObject({ footprints: 1, below70: 0 });
    expect(report.coverage.median).toBeGreaterThan(0.97);
  });

  it('opens a covered way through a house: raised from its outline though a model would fit, its walls open over the way (E297)', () => {
    const { doc, features } = world([area(1, box({ x: -30, y: 20 }, 10, 8.6, 0), { building: 'house' }), area(3, box({ x: 30, y: 20 }, 10, 8.6, 0), { building: 'house' })]);
    doc.paths.nodes.push({ id: 'n1', x: -30, y: 30 }, { id: 'n2', x: -30, y: 10 }, { id: 'm1', x: 30, y: 30 }, { id: 'm2', x: 30, y: 10 });
    doc.paths.edges.push(
      { id: 'pass', a: 'n1', b: 'n2', width: 2.5, kind: 'path', covered: true, street: 'footway' },
      // A way that bends through the other house more than one opening could widen over: two that meet at the bend
      { id: 'bent', a: 'm1', b: 'm2', width: 2.5, kind: 'path', covered: true, street: 'footway', via: [{ x: 33.5, y: 20 }] },
    );
    const { objects, report } = placeBuildings(doc, features, { catalog });
    const of = (id: number) => objects.filter((o) => o.group === `osm-b${id}` && o.asset !== 'retaining-wall');
    expect(of(1).map((o) => o.asset)).toEqual([MASS_ASSET]);
    expect(of(3).map((o) => o.asset)).toEqual([MASS_ASSET]);
    const house = of(1)[0];
    const openings = house.mass!.openings!;
    expect(openings.length).toBe(1);
    expect(openings[0]).toMatchObject({ kind: 'passage', head: 'flat', width: 3, height: 2.9 });
    // Its line from outside one wall to outside the other, through the middle
    const [ax, az, bx, bz] = openings[0].line;
    expect(massContains(house.mass!, ax, az)).toBe(false);
    expect(massContains(house.mass!, bx, bz)).toBe(false);
    expect(massContains(house.mass!, (ax + bx) / 2, (az + bz) / 2)).toBe(true);
    expect(Math.hypot(bx - ax, bz - az)).toBeCloseTo(8.6 + 2, 1);
    expect(of(3)[0].mass!.openings!.length).toBe(2);
    expect(report.openings).toEqual({ passages: 3, arches: 0, garages: 0, closed: 0 });
    expect(validateMap({ ...doc, objects }, { footingOf: (a) => byId.get(a), blocksBuild: () => true }).filter((i) => i.severity === 'error' && i.code !== 'no-spawns').map((i) => i.code)).toEqual([]);
  });

  it('narrows a passage along a side wall to the room beside it, and closes one with none (E297)', () => {
    const { doc, features } = world([area(1, box({ x: -30, y: 20 }, 10, 8.6, 0), { building: 'house' })]);
    // 1.5 m and 0.8 m inside the east wall (x = -25)
    doc.paths.nodes.push({ id: 'n1', x: -26.5, y: 30 }, { id: 'n2', x: -26.5, y: 10 }, { id: 'm1', x: -25.8, y: 30 }, { id: 'm2', x: -25.8, y: 10 });
    doc.paths.edges.push(
      { id: 'pass', a: 'n1', b: 'n2', width: 2.5, kind: 'path', covered: true, street: 'footway' },
      { id: 'tight', a: 'm1', b: 'm2', width: 2.5, kind: 'path', covered: true, street: 'footway' },
    );
    const { objects, report } = placeBuildings(doc, features, { catalog });
    const house = objects.find((o) => o.group === 'osm-b1' && o.asset === MASS_ASSET)!;
    expect(house.mass!.openings!.map((o) => o.width)).toEqual([2.4]);
    expect(report.openings).toMatchObject({ passages: 1, closed: 1 });
  });

  it('ends two houses against each other in a gable: the party wall they share stands, no eaves over it (E297 L4)', () => {
    // Two houses north of the road sharing the wall x = 0, their backs askew (no model fits either)
    const west = area(60, [{ x: -10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 24 }, { x: -10, y: 14 }], { building: 'house', 'roof:shape': 'gabled' });
    const east = area(61, [{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 14 }, { x: 0, y: 24 }], { building: 'house', 'roof:shape': 'gabled' });
    const { doc, features } = world([west, east]);
    const { objects } = placeBuildings(doc, features, { catalog });
    for (const id of [60, 61]) {
      const o = objects.find((q) => q.group === `osm-b${id}` && q.asset === MASS_ASSET)!;
      expect(o.mass!.shared?.length).toBe(1);
      // The shared wall lies on x = 0 on the map
      const r = o.mass!.rings[0];
      const k = o.mass!.shared![0];
      const n = r.length / 2;
      const mx = (r[2 * k] + r[2 * ((k + 1) % n)]) / 2;
      const mz = (r[2 * k + 1] + r[2 * ((k + 1) % n) + 1]) / 2;
      const c = Math.cos(o.rotation);
      const s = Math.sin(o.rotation);
      expect(o.x - (mx * c + mz * s) * o.scale).toBeCloseTo(0, 0);
    }
  });

  it('keeps two houses off an alley OSM maps on their party wall, a covered way through neither (E297 L4)', () => {
    const west = area(62, [{ x: -10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 24 }, { x: -10, y: 14 }], { building: 'house' });
    const east = area(63, [{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 14 }, { x: 0, y: 24 }], { building: 'house' });
    const { doc, features } = world([west, east]);
    // The alley from the road along the wall the two share, covered (it goes on under a building further back)
    doc.paths.nodes.push({ id: 'g1', x: 0, y: 3 }, { id: 'g2', x: 0, y: 10 }, { id: 'g3', x: 0, y: 22 }, { id: 'g4', x: 0, y: 40 });
    doc.paths.edges.push({ id: 'gin', a: 'g1', b: 'g2', width: 4, kind: 'path', street: 'pedestrian' }, { id: 'gass', a: 'g2', b: 'g3', width: 4, kind: 'path', covered: true, street: 'pedestrian' }, { id: 'gout', a: 'g3', b: 'g4', width: 4, kind: 'path', street: 'pedestrian' });
    const { objects } = placeBuildings(doc, features, { catalog });
    for (const id of [62, 63]) {
      const o = objects.find((q) => q.group === `osm-b${id}` && q.asset === MASS_ASSET)!;
      const c = Math.cos(o.rotation);
      const s = Math.sin(o.rotation);
      // The alley's middle line is clear of both
      for (const y of [12, 16, 20]) {
        const m = toModel(0 - o.x, y - o.y, c, s);
        expect(massDistance(o.mass!, m.x / o.scale, m.z / o.scale)).toBeGreaterThan(0.5);
      }
    }
  });

  it('heads a passage through a palace with a round arch, a gateway wide and high (E297)', () => {
    const palace: OsmArea = { ...area(4, box({ x: 0, y: 40 }, 40, 14, 0), { building: 'palace', historic: 'castle', 'building:levels': '3' }) };
    const { doc, features } = world([palace]);
    doc.paths.nodes.push({ id: 'g1', x: 0, y: 50 }, { id: 'g2', x: 0, y: 30 });
    doc.paths.edges.push({ id: 'gate', a: 'g1', b: 'g2', width: 2.5, kind: 'path', covered: true, street: 'footway' });
    const { objects, report } = placeBuildings(doc, features, { catalog });
    const raised = objects.find((o) => o.group === 'osm-b4' && o.asset === MASS_ASSET)!;
    expect(raised.mass!.facade).toBe('stone');
    const [gate] = raised.mass!.openings!;
    expect(gate).toMatchObject({ kind: 'passage', head: 'arch', width: 3.6 });
    // The springing at least as high as a door, the crown under the first floor
    expect(gate.height - gate.width / 2).toBeGreaterThanOrEqual(1.9);
    expect(gate.height).toBeLessThan(raised.mass!.height / raised.mass!.floors + 1.5);
    expect(report.openings.arches).toBe(1);
  });

  it("opens a car park's entrance where its ramp meets the wall: its floor at the ramp's end, the house seated on its own ground (E297)", () => {
    const { doc, features } = world([area(2, box({ x: 30, y: 30 }, 20, 12, 0), { building: 'apartments', 'building:levels': '4' })]);
    // A ramp from the road north down to the wall at y = 24, 2 m deep there and a little past it, as underground.ts sinks it
    const g = doc.terrain.grid;
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.columns; i++) {
        const x = -100 + i * g.cellSize;
        const y = -100 + j * g.cellSize;
        if (Math.abs(x - 30) <= 3 && y >= 10 && y <= 26) g.heights[j * g.columns + i] = 20 - 2 * Math.min(1, (y - 10) / 14);
      }
    }
    doc.paths.nodes.push({ id: 'r0', x: 30, y: 4 }, { id: 'w', x: 30, y: 24.3 }, { id: 's', x: 30, y: 26.3 });
    doc.paths.edges.push(
      { id: 'ramp', a: 'r0', b: 'w', width: 4, kind: 'road', street: 'service' },
      { id: 'stub', a: 'w', b: 's', width: 4, kind: 'road', street: 'service', covered: true },
    );
    const { objects, report } = placeBuildings(doc, features, { catalog });
    const raised = objects.find((o) => o.group === 'osm-b2' && o.asset === MASS_ASSET)!;
    const [entrance] = raised.mass!.openings!;
    expect(entrance.kind).toBe('garage');
    expect(entrance.floor!).toBeLessThan(-1.7);
    expect(entrance.height - entrance.floor!).toBeCloseTo(2.4);
    expect(report.openings.garages).toBe(1);
    // Seated on its own ground, not down in the ramp's cutting
    const seat = seatHeight({ category: 'building', footprint: 1, height: 12 }, raised, (x, y) => heightAt(doc.terrain, x, y), () => null);
    expect(seat).toBeCloseTo(20, 1);
  });

  it("opens a car park's entrance whose stub ends in front of the wall (the building cut back off its drive) (E297)", () => {
    const { doc, features } = world([area(2, box({ x: 30, y: 30 }, 20, 12, 0), { building: 'apartments', 'building:levels': '4' })]);
    doc.paths.nodes.push({ id: 'r0', x: 30, y: 4 }, { id: 'w', x: 30, y: 20.5 }, { id: 's', x: 30, y: 22.5 });
    doc.paths.edges.push(
      { id: 'ramp', a: 'r0', b: 'w', width: 4, kind: 'road', street: 'service' },
      { id: 'stub', a: 'w', b: 's', width: 4, kind: 'road', street: 'service', covered: true },
    );
    const { objects } = placeBuildings(doc, features, { catalog });
    const raised = objects.find((o) => o.group === 'osm-b2' && o.asset === MASS_ASSET)!;
    const [entrance] = raised.mass!.openings!;
    expect(entrance.kind).toBe('garage');
    // From before the wall to 2 m in
    const [ax, az, bx, bz] = entrance.line;
    expect(Math.hypot(bx - ax, bz - az)).toBeCloseTo(3, 1);
  });

  it('takes a model only where it covers 85 % and stands out 10 % at most, else raises the footprint (decision 1)', () => {
    // A house as the model is, and a trapezoid the same model would cover whole but stand a fifth outside
    const trapezoid: MapPoint[] = [{ x: 15, y: 10 }, { x: 25, y: 10 }, { x: 23.2, y: 18.6 }, { x: 16.8, y: 18.6 }];
    const { doc, features } = world([area(1, box({ x: -30, y: 14 }, 10, 8.6, 0), { building: 'house' }), area(2, trapezoid, { building: 'house' })]);
    const { objects, report } = placeBuildings(doc, features, { catalog });
    const of = (id: number) => objects.filter((o) => o.group === `osm-b${id}` && o.asset !== 'retaining-wall');
    expect(of(1).map((o) => o.asset)).toEqual(['house-modern']);
    expect(of(2).map((o) => o.asset)).toEqual([MASS_ASSET]);
    expect(report.coverage).toMatchObject({ footprints: 2, below70: 0, overhang10: 0 });
  });

  it('keeps a landmark whole with the HQ in its courtyard, while the room round the HQ takes an ordinary house (decision 4)', () => {
    // A palace round a courtyard north of the road, the HQ in the courtyard; a house beside it within 14 m of the HQ
    const palace: OsmArea = {
      id: 40,
      from: 'relation',
      tags: { building: 'castle', historic: 'castle', castle_type: 'stately', 'building:levels': '4', wikidata: 'Q1' },
      outer: [box({ x: 40, y: 30 }, 36, 30, 0)],
      inner: [box({ x: 40, y: 30 }, 20, 14, 0)],
      area: 36 * 30 - 20 * 14,
    };
    const { doc, features } = world([palace, area(41, box({ x: 40, y: 50.5 }, 10, 8.6, 0), { building: 'house' })]);
    doc.hq = { x: 40, y: 36 };
    const { objects, report } = placeBuildings(doc, features, { catalog });
    const raised = objects.filter((o) => o.group === 'osm-b40');
    expect(raised.map((o) => o.asset)).toEqual([MASS_ASSET]);
    expect(raised[0].mass).toMatchObject({ facade: 'stone', floors: 4 });
    expect(raised[0].mass!.rings.length).toBe(2);
    expect(massArea(raised[0].mass!) / palace.area).toBeGreaterThan(0.97);
    expect(report.kinds.palace).toBe(1);
    expect(report.landmarks).toMatchObject({ palace: 1 });
    // The HQ stays where it was put; the ordinary house beside it goes for its room
    expect(doc.hq).toEqual({ x: 40, y: 36 });
    expect(objects.some((o) => o.group === 'osm-b41')).toBe(false);
    expect(report.dropped.hq).toBe(1);
  });

  it('raises a ruin from its outline, fallen from the start as the ruins of destroyed buildings are (decision 3)', () => {
    const { doc, features } = world([
      area(50, box({ x: -40, y: 20 }, 12, 9, 0), { building: 'ruins' }),
      area(51, box({ x: 0, y: 20 }, 6, 6, 0), { building: 'yes', man_made: 'tower', 'tower:type': 'defensive', ruins: 'yes', height: '18' }),
      area(52, box({ x: 40, y: 20 }, 10, 8.6, 0), { building: 'house' }),
    ]);
    const { objects, report } = placeBuildings(doc, features, { catalog });
    const of = (id: number) => objects.filter((o) => o.group === `osm-b${id}` && o.asset !== 'retaining-wall');
    expect(of(50).map((o) => [o.asset, o.damage])).toEqual([[MASS_ASSET, 3]]);
    expect(of(51).map((o) => [o.asset, o.damage])).toEqual([[MASS_ASSET, 3]]);
    expect(of(51)[0].mass).toMatchObject({ facade: 'stone', roof: 'pyramid' });
    expect(of(52)[0].damage).toBeUndefined();
    expect(report.ruins).toBe(2);
    expect(report.landmarks).toMatchObject({ tower: 1 });
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

  it('opens the gables at the ends of a row of terraced houses, and both on one that stands alone (V10)', () => {
    // Four terraced houses side by side north of the road, one apart from them
    const row = [0, 1, 2, 3].map((k) => area(20 + k, box({ x: -40 + k * 6, y: 14 }, 6, 10, 0), { building: 'terrace' }));
    const alone = area(30, box({ x: 30, y: 14 }, 6, 10, 0), { building: 'terrace' });
    const { doc, features } = world([...row, alone]);
    const { objects, report } = placeBuildings(doc, features, { catalog });
    const of = (id: number) => objects.filter((o) => o.group === `osm-b${id}`).map((o) => o.asset);
    expect(of(21)).toEqual(['house-terrace']);
    expect(of(22)).toEqual(['house-terrace']);
    // Facing the road (south), the model's west (-x) is the map's west
    expect(of(20)).toEqual(['house-terrace-end-w']);
    expect(of(23)).toEqual(['house-terrace-end-e']);
    expect(of(30)).toEqual(['house-terrace-ends']);
    expect(report.rowEnds).toBe(3);
  });

  it('with a cap, holds the buildings to it, the small far ones first; without one every footprint stands', () => {
    const areas = [area(1, box({ x: 0, y: 14 }, 10, 8.6, 0), { building: 'house' })];
    for (let k = 0; k < 8; k++) areas.push(area(10 + k, box({ x: -80 + k * 12, y: -12 }, 3, 6, 0), { building: 'garage' }));
    const { doc, features } = world(areas);
    const one = placeBuildings(doc, features, { catalog }).report.cost;
    const { report, warnings } = placeBuildings(world(areas).doc, features, { catalog, budget: one * 0.6 });
    expect(report.dropped.budget).toBeGreaterThan(0);
    expect(report.cost).toBeLessThanOrEqual(one * 0.6);
    expect(noteWords(warnings).some((w) => w.includes('scene cost'))).toBe(true);
    expect(placeBuildings(world(areas).doc, features, { catalog }).report.dropped.budget).toBe(0);
  });
});
