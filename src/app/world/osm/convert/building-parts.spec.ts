import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMapDocument } from '../../custom-map/map-create';
import { MASS_ASSET, type MapMass, type MapPoint } from '../../custom-map/map-document';
import { massBodies, massProblem, massRoofAt, massTop, ringsContain } from '../../custom-map/object-mass';
import { toModel } from '../../custom-map/object-ground';
import { OsmFrame, type OsmArea, type OsmFeatures } from '../osm-parse';
import { clipOffRoads, isDrawnPart, partsCover, raiseMass, tagColour, type OsmPart } from './building-mass';
import { partsByOutline, placeBuildings, type BuildingCatalogEntry } from './buildings';
import { minAreaRect } from '../../custom-map/map-surfaces';

/** A rectangle `a` by `b` round `c` */
const box = (c: MapPoint, a: number, b: number): MapPoint[] => [
  { x: c.x - a / 2, y: c.y - b / 2 },
  { x: c.x + a / 2, y: c.y - b / 2 },
  { x: c.x + a / 2, y: c.y + b / 2 },
  { x: c.x - a / 2, y: c.y + b / 2 },
];

/** A regular octagon round `c` of radius `r` */
const octagon = (c: MapPoint, r: number): MapPoint[] =>
  Array.from({ length: 8 }, (_, k) => ({ x: c.x + r * Math.cos((k * Math.PI) / 4 + Math.PI / 8), y: c.y + r * Math.sin((k * Math.PI) / 4 + Math.PI / 8) }));

/**
 * A small palace as OSM's Simple 3D Buildings has one: an outline 40 x 20 m,
 * a wing under a gable roof, a tower at its east end and a helm on the
 * tower; the tower is narrower than the outline, so 100 m² stay bare. A
 * lift inside shows nothing
 */
const OUTLINE = box({ x: 0, y: 0 }, 40, 20);
const PARTS: OsmPart[] = [
  { outer: box({ x: -5, y: 0 }, 30, 20), holes: [], tags: { 'building:part': 'yes', height: '20', 'roof:height': '6', 'roof:shape': 'gabled', 'building:levels': '3', 'building:colour': 'red', 'roof:colour': 'gray' } },
  { outer: box({ x: 15, y: 0 }, 10, 10), holes: [], tags: { 'building:part': 'yes', height: '30', 'building:levels': '6', 'roof:shape': 'flat', 'building:colour': 'red', 'roof:colour': 'gray' } },
  { outer: octagon({ x: 15, y: 0 }, 5), holes: [], tags: { 'building:part': 'yes', min_height: '30', height: '45', 'roof:height': '12', 'roof:shape': 'onion', 'roof:material': 'copper', 'roof:colour': 'green' } },
  { outer: box({ x: -10, y: 0 }, 2, 2), holes: [], tags: { 'building:part': 'elevator' } },
];
const TAGS = { building: 'palace', 'building:levels': '4' };

function palace(parts: OsmPart[] = PARTS) {
  const rect = minAreaRect(OUTLINE);
  const raised = raiseMass(OUTLINE, [], rect, 'palace', TAGS, 800, 3, false, parts)!;
  const cos = Math.cos(raised.rotation);
  const sin = Math.sin(raised.rotation);
  const local = (p: MapPoint) => toModel(p.x - raised.centre.x, p.y - raised.centre.y, cos, sin);
  return { raised, mass: raised.mass, local };
}

describe('raised buildings from their OSM parts (E297 L3)', () => {
  it('raises each part from its own floor to its own top under its own roof; the outline stays the ground', () => {
    const { mass } = palace();
    expect(massProblem(mass)).toBeNull();
    // The lift shows nothing; the three parts and the one that fills the bare strips
    expect(isDrawnPart({ 'building:part': 'elevator' })).toBe(false);
    expect(mass.parts!.length).toBe(4);
    const [wing, tower, helm, fill] = mass.parts!;
    // The wing: its rectangle under a gable, the eaves under the tagged height by the roof's
    expect(wing).toMatchObject({ roof: 'gable', ridge: 6, height: 14, floors: 3 });
    expect(wing.base).toBeUndefined();
    expect(tower).toMatchObject({ roof: 'flat', height: 30.9, floors: 6 });
    // The helm on the tower: from 30 m, its walls to 33 m, a pyramid of 12 m to the tagged 45 m
    expect(helm).toMatchObject({ base: 30, height: 33, roof: 'pyramid', ridge: 12 });
    expect(massTop(mass)).toBeCloseTo(45);
    // What the parts leave bare is filled, drawn in from the walls and no higher than the lowest part on the ground
    expect(fill.roof).toBe('flat');
    expect(fill.height).toBeLessThanOrEqual(14);
    expect(partsCover(mass.rings, mass.parts!)).toBeGreaterThan(0.99);
    expect(partsCover(mass.rings, mass.parts!.slice(0, 3))).toBeCloseTo(700 / 800, 1);
  });

  it('stands the tower over the wing: the roof the rules read is the helm over the tower, the ridge over the wing', () => {
    const { mass, local } = palace();
    const towerTop = local({ x: 15, y: 0 });
    expect(massRoofAt(mass, towerTop.x, towerTop.z)).toBeCloseTo(45, 0);
    const ridge = local({ x: -5, y: 0 });
    expect(massRoofAt(mass, ridge.x, ridge.z)).toBeCloseTo(20, 0);
    // The bare strip beside the tower: the filling part's flat roof, under the wing's eaves
    const strip = local({ x: 15, y: 8 });
    expect(massRoofAt(mass, strip.x, strip.z)).toBeGreaterThan(5);
    expect(massRoofAt(mass, strip.x, strip.z)).toBeLessThan(14);
    // Beside the building nothing
    const off = local({ x: 30, y: 0 });
    expect(massRoofAt(mass, off.x, off.z)).toBe(0);
  });

  it('takes the storeys from building:levels and the floor from building:min_level where no metres are tagged', () => {
    const part: OsmPart = { outer: box({ x: 0, y: 0 }, 40, 20), holes: [], tags: { 'building:part': 'yes', 'building:levels': '4', 'building:min_level': '2' } };
    const { mass } = palace([part]);
    // A palace's storeys of 4.2 m over the plinth: from 8.8 m to 17.2 m, the parapet over it
    expect(mass.parts![0]).toMatchObject({ base: 8.8, height: 18.1, floors: 4, roof: 'flat' });
    // A part without height or storeys takes the building's; a tower a storey more
    const bare = palace([{ outer: box({ x: 0, y: 0 }, 40, 20), holes: [], tags: { 'building:part': 'yes' } }]).mass;
    const tower = palace([{ outer: box({ x: 0, y: 0 }, 40, 20), holes: [], tags: { 'building:part': 'yes', man_made: 'tower' } }]).mass;
    expect(bare.parts![0].height).toBeCloseTo(0.4 + 4 * 4.2 + 0.9);
    expect(tower.parts![0].height).toBeCloseTo(bare.parts![0].height + 4.2);
  });

  it('takes the colours and coverings OSM gives: red sandstone, a slate roof, a copper helm; the untagged building the colours of most of its parts', () => {
    const { raised, mass } = palace();
    // building:colour=red on stone is red sandstone, not paint; the parts' red is the building's now
    expect(raised.tint).toBe('#c98a72');
    expect(mass.parts!.every((p) => p.tint === undefined)).toBe(true);
    // roof:colour=gray: a slate roof for the building, the copper helm its own
    expect(mass).toMatchObject({ roofTint: '#5f6368', roofCover: 'slate' });
    expect(mass.parts![2]).toMatchObject({ roofTint: '#5f8f78', roofCover: 'metal' });
    expect(mass.parts![0].roofTint).toBeUndefined();
    const helm = massBodies(mass)[2];
    expect(helm).toMatchObject({ roofCover: 'metal', facade: 'stone' });
    expect(massBodies(mass)[0]).toMatchObject({ roofTint: '#5f6368', roofCover: 'slate' });
    expect(tagColour('antiquewhite', false)).toBe('#faebd7');
    expect(tagColour('#C65843', true)).toBe('#c65843');
    expect(tagColour('grey', false, true)).toBe('#5f6368');
  });

  it('builds the same building from the same parts in any order (the map is the same on every machine)', () => {
    const a = palace().mass;
    const b = palace([...PARTS].reverse()).mass;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(palace().raised)).toBe(JSON.stringify(palace().raised));
  });

  it('cuts its parts back from a road with it, and only beside the road: one that leaves from a corner cuts nothing across', () => {
    const { mass, local } = palace();
    const along = (p: MapPoint, q: MapPoint, half: number) => {
      const a = local(p);
      const b = local(q);
      return { ax: a.x, az: a.z, bx: b.x, bz: b.z, half };
    };
    // A road along the north wall, reaching 1 m in
    const cut: MapMass = structuredClone(mass);
    expect(clipOffRoads(cut, [along({ x: -40, y: 12 }, { x: 40, y: 12 }, 3)])).toBe(true);
    const north = local({ x: -5, y: 9.5 });
    expect(ringsContain(cut.rings, north.x, north.z)).toBe(false);
    expect(ringsContain(cut.parts![0].rings, north.x, north.z)).toBe(false);
    expect(cut.parts!.length).toBe(4);
    // A lane leaving the north-east corner flat to the east: its line runs on through the building, the cut along it
    // would take the whole north-west; only the corner moves off the lane, the west end stays whole
    const corner: MapMass = structuredClone(mass);
    expect(clipOffRoads(corner, [along({ x: 19, y: 9.5 }, { x: 50, y: 15.7 }, 3)])).toBe(true);
    const west = local({ x: -19, y: 9 });
    expect(ringsContain(corner.rings, west.x, west.z)).toBe(true);
    expect(ringsContain(corner.parts![0].rings, west.x, west.z)).toBe(true);
    const ne = local({ x: 19.5, y: 9.5 });
    expect(ringsContain(corner.rings, ne.x, ne.z)).toBe(false);
    expect(corner.parts!.length).toBe(4);
  });

  it('ends a wing at its tower in a gable: the wall it shares with the tower stands, the ridge runs into it (E297 L4)', () => {
    // A wing 30 x 10 m under a hip roof, a tower as wide at its east end
    const outline = box({ x: 0, y: 0 }, 40, 10);
    const parts: OsmPart[] = [
      { outer: box({ x: -5, y: 0 }, 30, 10), holes: [], tags: { 'building:part': 'yes', height: '20', 'roof:height': '5', 'roof:shape': 'hipped' } },
      { outer: box({ x: 15, y: 0 }, 10, 10), holes: [], tags: { 'building:part': 'yes', height: '30', 'roof:shape': 'flat' } },
    ];
    const raised = raiseMass(outline, [], minAreaRect(outline), 'palace', TAGS, 400, 3, false, parts)!;
    const wing = raised.mass.parts![0];
    expect(wing.shared?.length).toBe(1);
    const cos = Math.cos(raised.rotation);
    const sin = Math.sin(raised.rotation);
    const at = (p: MapPoint) => {
      const m = toModel(p.x - raised.centre.x, p.y - raised.centre.y, cos, sin);
      return massRoofAt({ ...raised.mass, parts: [wing] }, m.x, m.z);
    };
    // Up to the tower the ridge stands full height; at the free west end the hip comes down
    expect(at({ x: 9.6, y: 0 })).toBeCloseTo(20, 0);
    expect(at({ x: -19.6, y: 0 })).toBeLessThan(16);
  });

  it('slopes a lean-to without its way down away from the higher part it leans on: an aisle down from its nave', () => {
    const nave = box({ x: 0, y: 4 }, 40, 12);
    const aisle = box({ x: 0, y: -5 }, 40, 6);
    const outline = box({ x: 0, y: 1 }, 40, 18);
    const parts: OsmPart[] = [
      { outer: nave, holes: [], tags: { 'building:part': 'yes', height: '24', 'roof:shape': 'gabled', 'roof:height': '8' } },
      { outer: aisle, holes: [], tags: { 'building:part': 'yes', height: '12', 'roof:shape': 'skillion', 'roof:height': '3' } },
    ];
    const raised = raiseMass(outline, [], minAreaRect(outline), 'church', { building: 'church' }, 720, 2, false, parts)!;
    const cos = Math.cos(raised.rotation);
    const sin = Math.sin(raised.rotation);
    const at = (p: MapPoint) => {
      const m = toModel(p.x - raised.centre.x, p.y - raised.centre.y, cos, sin);
      return massRoofAt(raised.mass, m.x, m.z);
    };
    // High against the nave (y = -2), low at its outer wall (y = -8)
    expect(at({ x: 0, y: -2.1 })).toBeCloseTo(12, 0);
    expect(at({ x: 0, y: -7.9 })).toBeCloseTo(9, 0);
  });
});

describe('the parts of the OSM footprints, in the world', () => {
  const catalog: BuildingCatalogEntry[] = JSON.parse(readFileSync(join(__dirname, '../../../../../public/maps/assets/catalog.json'), 'utf8')).objects;
  const area = (id: number, ring: MapPoint[], tags: Record<string, string>, inner: MapPoint[][] = []): OsmArea => {
    let s = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
    return { id, from: 'way', tags, outer: [ring], inner, area: Math.abs(s / 2) };
  };
  const features = (areas: OsmArea[]): OsmFeatures => ({
    frame: new OsmFrame(0, 0),
    half: 100,
    ways: [],
    areas,
    points: [],
    stats: { elements: 0, ways: 0, relations: 0, points: 0, areas: 0, forcedRings: 0, cutAreas: 0, turnedAreas: 0, areasOutside: 0 },
  });

  it('hangs each part on the smallest building its middle lies in, a stair tower in the courtyard too', () => {
    const castle = area(1, box({ x: 0, y: 40 }, 40, 40), { building: 'castle' }, [box({ x: 0, y: 40 }, 20, 20)]);
    const shed = area(2, box({ x: 30, y: 40 }, 6, 6), { building: 'shed' });
    const stair = area(3, octagon({ x: -8, y: 32 }, 2.5), { 'building:part': 'yes', man_made: 'tower' });
    const wing = area(4, box({ x: 0, y: 55 }, 40, 10), { 'building:part': 'yes', height: '20' });
    const lift = area(5, box({ x: 0, y: 55 }, 2, 2), { 'building:part': 'elevator' });
    const inShed = area(6, box({ x: 30, y: 40 }, 3, 3), { 'building:part': 'yes' });
    const of = partsByOutline(features([castle, shed, stair, wing, lift, inShed]));
    expect(of.get(castle.outer[0])!.map((p) => p.tags['height'] ?? p.tags['man_made'])).toEqual(['tower', '20']);
    expect(of.get(shed.outer[0])!.length).toBe(1);
  });

  it('raises a footprint with parts as them, one object, and measures what they cover', () => {
    const doc = createMapDocument({ id: 't', name: 't', width: 200, depth: 200, cellSize: 2, baseMaterial: 'grass', splatResolution: 64, starter: false });
    doc.paths = { nodes: [{ id: 'a', x: -95, y: 0 }, { id: 'b', x: 95, y: 0 }], edges: [{ id: 'e1', a: 'a', b: 'b', width: 6, kind: 'road' }] };
    doc.hq = { x: 90, y: 0 };
    doc.spawns = [];
    doc.objects = [];
    const shift = (ring: MapPoint[]) => ring.map((p) => ({ x: p.x, y: p.y + 40 }));
    const areas = [area(9, shift(OUTLINE), TAGS), ...PARTS.map((p, k) => area(20 + k, shift([...p.outer]), p.tags as Record<string, string>))];
    const { objects, report } = placeBuildings(doc, features(areas), { catalog });
    const raised = objects.filter((o) => o.group === 'osm-b9');
    expect(raised.map((o) => o.asset)).toEqual([MASS_ASSET]);
    expect(raised[0].mass!.parts!.length).toBe(4);
    expect(report).toMatchObject({ withParts: 1, parts: 4 });
    expect(report.coverage.median).toBeGreaterThan(0.98);
  });

  it("opens a passage under an overhang up to the overhang's floor, one through a part on the ground under its eaves (E297)", () => {
    const doc = createMapDocument({ id: 't', name: 't', width: 200, depth: 200, cellSize: 2, baseMaterial: 'grass', splatResolution: 64, starter: false });
    // Two pedestrian ways north through a house: the west one under its part on the ground, the east one under a part
    // from 3.2 m up over bare ground
    doc.paths = {
      nodes: [{ id: 'a', x: -95, y: 0 }, { id: 'b', x: 95, y: 0 }, { id: 'w1', x: -6, y: 30 }, { id: 'w2', x: -6, y: 50 }, { id: 'e1', x: 6, y: 30 }, { id: 'e2', x: 6, y: 50 }],
      edges: [
        { id: 'r', a: 'a', b: 'b', width: 6, kind: 'road' },
        { id: 'west', a: 'w1', b: 'w2', width: 3, kind: 'path', street: 'pedestrian', covered: true },
        { id: 'east', a: 'e1', b: 'e2', width: 3, kind: 'path', street: 'pedestrian', covered: true },
      ],
    };
    doc.hq = { x: 90, y: 0 };
    doc.spawns = [];
    doc.objects = [];
    const house = area(1, box({ x: 0, y: 40 }, 24, 10), { building: 'yes', 'building:levels': '3' });
    const low = area(2, box({ x: -6, y: 40 }, 12, 10), { 'building:part': 'yes', height: '9' });
    const over = area(3, box({ x: 6, y: 40 }, 12, 10), { 'building:part': 'yes', height: '9', min_height: '3.2' });
    const { objects } = placeBuildings(doc, features([house, low, over]), { catalog });
    const raised = objects.find((o) => o.group === 'osm-b1' && o.asset === MASS_ASSET)!;
    const openings = raised.mass!.openings!;
    // A pedestrian street's 3.4 m under the part on the ground, the overhang's floor at 3.2 m over the other
    expect(openings.map((o) => o.height).sort()).toEqual([3.2, 3.4]);
  });
});
