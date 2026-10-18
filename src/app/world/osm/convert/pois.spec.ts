import { createMapDocument } from '../../custom-map/map-create';
import type { CustomMapDocument, MapObject, MapPoint } from '../../custom-map/map-document';
import { BUILDING_MODELS } from '../building-tags';
import { OsmFrame, type OsmArea, type OsmFeatures, type OsmPoint } from '../osm-parse';
import { placeLanguage, poiCategory, signLanguage } from '../poi-tags';
import { facadesOf, facadeTurn } from './facades';
import { MAX_POI_SIGNS, placePois, streetAsset } from './pois';

const cost = () => 10;

/** The footprint of a model `asset` standing at `c` turned `rotation` (its wall box from building-tags.ts) */
function footprint(id: number, asset: string, c: MapPoint, rotation: number, tags: Record<string, string> = { building: 'yes' }): OsmArea {
  const [w, d] = BUILDING_MODELS[asset].box;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const ring = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => {
    const lx = (a * w) / 2;
    const lz = (b * d) / 2;
    return { x: c.x - (lx * cos + lz * sin), y: c.y - lx * sin + lz * cos };
  });
  return { id, from: 'way', tags, outer: [ring], inner: [], area: w * d };
}

function building(id: number, asset: string, c: MapPoint, rotation: number): MapObject {
  return { id: `osm-b${id}`, asset, x: c.x, y: c.y, z: 0, rotation, scale: 1, group: `osm-b${id}` };
}

/** A 200 m map with a road along y = 0, the HQ far east, buildings north of the road facing it (turned half round) */
function world(buildings: { id: number; asset: string; c: MapPoint }[], points: OsmPoint[], extra: OsmArea[] = []): { doc: CustomMapDocument; features: OsmFeatures } {
  const doc = createMapDocument({ id: 't', name: 't', width: 200, depth: 200, cellSize: 2, baseMaterial: 'grass', splatResolution: 64, starter: false });
  doc.paths = { nodes: [{ id: 'a', x: -95, y: 0 }, { id: 'b', x: 95, y: 0 }], edges: [{ id: 'e1', a: 'a', b: 'b', width: 6, kind: 'road' }] };
  doc.hq = { x: 90, y: 0 };
  doc.spawns = [];
  doc.objects = buildings.map((b) => building(b.id, b.asset, b.c, Math.PI));
  const areas = [...buildings.map((b) => footprint(b.id, b.asset, b.c, Math.PI)), ...extra];
  return { doc, features: { frame: new OsmFrame(0, 0), half: 100, ways: [], areas, points, stats: { elements: 0, ways: 0, relations: 0, points: 0, areas: 0, forcedRings: 0, cutAreas: 0, turnedAreas: 0, areasOutside: 0 } } };
}

const shop = (id: number, x: number, y: number, tags: Record<string, string>): OsmPoint => ({ id, x, y, tags });
const placed = (doc: CustomMapDocument) => doc.objects.filter((o) => o.id.startsWith('osm-p') || o.id.startsWith('osm-s'));

describe('OSM POIs: kinds and language', () => {
  it('reads the kind from the tags, the cuisine making an inn of a restaurant', () => {
    expect(poiCategory({ shop: 'bakery' })?.id).toBe('bakery');
    expect(poiCategory({ amenity: 'restaurant', cuisine: 'german' })?.id).toBe('inn');
    expect(poiCategory({ amenity: 'restaurant', cuisine: 'italian' })?.id).toBe('restaurant');
    expect(poiCategory({ amenity: 'bar', bar: 'wine' })?.id).toBe('wine');
    expect(poiCategory({ shop: 'something_odd' })?.id).toBe('shop');
    expect(poiCategory({ shop: 'vacant' })).toBeNull();
    expect(poiCategory({ craft: 'carpenter' })?.id).toBe('craft');
    expect(poiCategory({ healthcare: 'pharmacy' })?.id).toBe('pharmacy');
    expect(poiCategory({ tourism: 'hotel' })?.id).toBe('hotel');
    expect(poiCategory({ amenity: 'bench' })).toBeNull();
  });

  it('writes in the language of the place', () => {
    const at: [number, number, string][] = [
      [49.79, 9.93, 'de'], // Würzburg
      [50.776, 6.083, 'de'], // Aachen, by the border
      [48.857, 2.36, 'fr'], // Paris, Marais
      [48.58, 7.75, 'fr'], // Strasbourg
      [52.37, 4.9, 'nl'], // Amsterdam
      [51.05, 3.72, 'nl'], // Ghent
      [50.85, 4.35, 'fr'], // Brussels
      [47.37, 8.54, 'de'], // Zurich
      [46.2, 6.14, 'fr'], // Geneva
      [46.0, 8.95, 'it'], // Lugano
      [41.9, 12.5, 'it'], // Rome
      [40.42, -3.7, 'es'], // Madrid
      [48.21, 16.37, 'de'], // Vienna
      [51.5, -0.12, 'en'], // London
    ];
    for (const [lat, lon, lang] of at) expect([lat, lon, placeLanguage(lat, lon)]).toEqual([lat, lon, lang]);
    // The addresses' country wins over the coarse outline
    expect(signLanguage({ lat: 51.5, lon: -0.12 }, [{ tags: { 'addr:country': 'FR' } }, { tags: { 'addr:country': 'FR' } }, { tags: {} }])).toBe('fr');
  });

  it('knows the street things that stand at their point', () => {
    expect(streetAsset({ advertising: 'column' })).toBe('advertising-column');
    expect(streetAsset({ historic: 'wayside_cross' })).toBe('wayside-cross');
    expect(streetAsset({ amenity: 'bicycle_parking' })).toBe('bike-rack');
    expect(streetAsset({ amenity: 'recycling', recycling_type: 'container' })).toBe('recycling-containers');
    expect(streetAsset({ amenity: 'recycling', recycling_type: 'centre' })).toBeNull();
    expect(streetAsset({ amenity: 'clock', support: 'pole' })).toBe('street-clock');
    expect(streetAsset({ amenity: 'clock', support: 'wall_mounted' })).toBeNull();
    expect(streetAsset({ leisure: 'picnic_table' })).toBe('picnic-table');
    expect(streetAsset({ amenity: 'bench' })).toBeNull();
  });
});

describe('OSM POIs: fronts', () => {
  it('gives a house its street front and both sides, a row module only its front, a corner house front and west', () => {
    const house = facadesOf(building(1, 'house-modern', { x: 0, y: 14 }, Math.PI), BUILDING_MODELS['house-modern']);
    expect(house.map((f) => f.side)).toEqual([0, 3, 1]);
    // Turned half round, the front faces south to the road
    expect(house[0].ny).toBeCloseTo(-1);
    expect(house[0].y).toBeCloseTo(14 - 8.6 / 2);
    expect(house[0].width).toBeCloseTo(10);
    expect(facadeTurn(house[0])).toBeCloseTo(Math.PI);
    expect(facadesOf(building(2, 'block-row-4', { x: 0, y: 14 }, 0), BUILDING_MODELS['block-row-4']).map((f) => f.side)).toEqual([0]);
    expect(facadesOf(building(3, 'block-corner-4', { x: 0, y: 14 }, 0), BUILDING_MODELS['block-corner-4']).map((f) => f.side)).toEqual([0, 3]);
    expect(facadesOf(building(4, 'garage', { x: 0, y: 14 }, 0), BUILDING_MODELS['garage'])).toEqual([]);
  });
});

describe('OSM POIs: placing', () => {
  it('hangs a shop on the street front of the house it is in: sign with its kind, shopfront, awning, all in the house group', () => {
    const { doc, features } = world([{ id: 1, asset: 'house-modern', c: { x: 0, y: 14 } }], [shop(10, 1, 13, { shop: 'bakery', name: 'Bäckerei Müller' })]);
    const r = placePois(doc, features, { costOf: cost, language: 'de' });
    expect(r).toMatchObject({ pois: 1, inside: 1, signs: 1 });
    const mine = placed(doc);
    expect(mine.map((o) => o.asset).sort()).toEqual(['awning', 'shopfront-wide', 'sign-facade']);
    const sign = mine.find((o) => o.asset === 'sign-facade')!;
    // The kind's word, never the name
    expect(sign.sign).toEqual({ text: 'Bäckerei', icon: 'pretzel' });
    expect(sign.rotation).toBeCloseTo(Math.PI);
    // On the wall, out by what stands out of it
    expect(sign.y).toBeCloseTo(14 - 4.3 - 0.05);
    for (const o of mine) {
      expect(o.group).toBe('osm-b1');
      // On the wall, above the road's edge: nothing stands on the road
      expect(o.y).toBeGreaterThan(3 + 1.5);
    }
    expect(mine.find((o) => o.asset === 'awning')!.z).toBeGreaterThanOrEqual(2.1);
  });

  it('takes a point mapped beside the wall (within 8 m), not one farther off', () => {
    const { doc, features } = world([{ id: 1, asset: 'house-modern', c: { x: 0, y: 14 } }], [shop(10, 0, 8, { shop: 'florist' }), shop(11, 40, 40, { shop: 'florist' })]);
    const r = placePois(doc, features, { costOf: cost });
    expect(r).toMatchObject({ pois: 2, inside: 0, near: 1, noBuilding: 1 });
    expect(placed(doc).find((o) => o.asset === 'sign-facade')!.sign!.text).toBe('Florist');
  });

  it('shares a front between its shops left to right, one per 2.8 m, the lower kinds first out', () => {
    const points = [shop(1, -5, 14, { shop: 'bakery' }), shop(2, 0, 14, { amenity: 'pharmacy' }), shop(3, 5, 14, { office: 'insurance' })];
    const { doc, features } = world([{ id: 1, asset: 'block-row-4', c: { x: 0, y: 14 } }], points);
    placePois(doc, features, { costOf: cost, language: 'en' });
    const signs = placed(doc).filter((o) => o.asset === 'sign-facade').sort((p, q) => p.x - q.x);
    expect(signs.map((o) => o.sign!.text)).toEqual(['Bakery', 'Pharmacy', 'Office']);
    // Slots of 5 m: their middles 5 m apart along the 15 m front, in the order the shops lie
    expect(signs.map((o) => Math.round(o.x) + 0)).toEqual([-5, 0, 5]);
    // A shop floor of its own: no shopfront in front of it
    expect(placed(doc).some((o) => o.asset.startsWith('shopfront'))).toBe(false);

    const crowd = Array.from({ length: 9 }, (_, k) => shop(20 + k, -6 + k * 1.5, 14, k === 8 ? { shop: 'bakery' } : { office: 'company' }));
    const w2 = world([{ id: 2, asset: 'block-row-4', c: { x: 0, y: 14 } }], crowd);
    const r2 = placePois(w2.doc, w2.features, { costOf: cost, language: 'en' });
    expect(r2.dropped.slots).toBe(9 - 5);
    expect(placed(w2.doc).filter((o) => o.asset === 'sign-facade').map((o) => o.sign!.text)).toContain('Bakery');
  });

  it('hangs a shop on the street edge of a building raised from its footprint, under its first floor’s windows', () => {
    // A 20 x 10 m outline north of the road (object axes: x west, z north), two storeys of plaster under a flat roof
    const mass = { rings: [[-10, -5, 10, -5, 10, 5, -10, 5]], height: 7.4, floors: 2, roof: 'flat' as const, facade: 'plaster' as const };
    const ring = [{ x: 10, y: 9 }, { x: -10, y: 9 }, { x: -10, y: 19 }, { x: 10, y: 19 }];
    const { doc, features } = world([], [shop(1, 3, 12, { shop: 'bakery' })], [{ id: 5, from: 'way', tags: { building: 'yes' }, outer: [ring], inner: [], area: 200 }]);
    doc.objects.push({ id: 'osm-b1', asset: 'building-mass', x: 0, y: 14, z: 0, rotation: 0, scale: 1, group: 'osm-b5', mass });
    placePois(doc, features, { costOf: cost, language: 'de' });
    const sign = placed(doc).find((o) => o.asset === 'sign-facade')!;
    expect(sign.sign!.text).toBe('Bäckerei');
    // On the south edge (to the road), facing it
    expect(sign.y).toBeCloseTo(9 - 0.03);
    expect(sign.rotation).toBeCloseTo(Math.PI);
    // Over the ground floor: plinth 0.45 and a storey of (7.4 - 0.45 - 1.15) / 2
    expect(sign.z).toBeCloseTo(0.45 + 2.9 + 0.08);
    expect(sign.group).toBe('osm-b5');
  });

  it('writes a single shop on the building’s own sign panel', () => {
    const { doc, features } = world([{ id: 1, asset: 'shop-small', c: { x: 0, y: 14 } }], [shop(1, 0, 14, { shop: 'books' })]);
    placePois(doc, features, { costOf: cost, language: 'fr' });
    expect(doc.objects.find((o) => o.id === 'osm-b1')!.sign).toEqual({ text: 'Librairie', icon: 'book' });
    expect(placed(doc).some((o) => o.asset === 'sign-facade')).toBe(false);
  });

  it('puts tables out only where OSM says so and never on the road', () => {
    const near = world([{ id: 1, asset: 'house-modern', c: { x: 0, y: 7 } }], [shop(1, 0, 7, { amenity: 'cafe', outdoor_seating: 'yes' })]);
    placePois(near.doc, near.features, { costOf: cost });
    // The front is 2.7 m from the road's middle: no room in front of it
    expect(placed(near.doc).some((o) => o.asset === 'cafe-set')).toBe(false);
    const far = world([{ id: 1, asset: 'house-modern', c: { x: 0, y: 16 } }], [shop(1, 0, 16, { amenity: 'cafe', outdoor_seating: 'yes' })]);
    placePois(far.doc, far.features, { costOf: cost });
    const tables = placed(far.doc).filter((o) => o.asset === 'cafe-set');
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(t.y).toBeGreaterThan(3 + 1);
    const quiet = world([{ id: 1, asset: 'house-modern', c: { x: 0, y: 16 } }], [shop(1, 0, 16, { amenity: 'cafe' })]);
    placePois(quiet.doc, quiet.features, { costOf: cost });
    expect(placed(quiet.doc).some((o) => o.asset === 'cafe-set')).toBe(false);
  });

  it('hangs an old town’s inn a wrought-iron sign beside its board', () => {
    const old = footprint(1, 'house-modern', { x: 0, y: 14 }, Math.PI, { building: 'yes', heritage: '4' });
    const { doc, features } = world([], [shop(1, 0, 14, { amenity: 'restaurant', cuisine: 'regional' })], [old]);
    doc.objects.push(building(1, 'house-modern', { x: 0, y: 14 }, Math.PI));
    placePois(doc, features, { costOf: cost, language: 'de' });
    const bracket = placed(doc).find((o) => o.asset === 'sign-bracket')!;
    expect(bracket.sign).toEqual({ icon: 'beer' });
    expect(placed(doc).find((o) => o.asset === 'sign-facade')!.sign!.text).toBe('Gasthaus');
  });

  it('holds the signs to their cap, the nearest to the HQ first, and the objects to the budget', () => {
    const blocks = Array.from({ length: 6 }, (_, k) => ({ id: k + 1, asset: 'house-modern', c: { x: -75 + k * 30, y: 14 } }));
    const points = blocks.map((b) => shop(100 + b.id, b.c.x, 14, { shop: 'bakery' }));
    const { doc, features } = world(blocks, points);
    const r = placePois(doc, features, { costOf: cost, maxSigns: 2 });
    expect(r.signs).toBe(2);
    expect(r.dropped.signs).toBe(4);
    // The HQ stands east: the two easternmost write
    expect(placed(doc).filter((o) => o.asset === 'sign-facade').map((o) => Math.round(o.x)).sort((a, b) => a - b)).toEqual([45, 75]);
    expect(MAX_POI_SIGNS).toBe(512);
    const tight = world(blocks, points);
    const r2 = placePois(tight.doc, tight.features, { costOf: cost, budget: 35 });
    expect(r2.cost).toBeLessThanOrEqual(35);
    expect(r2.dropped.budget).toBeGreaterThan(0);
  });

  it('sets up the pumps of a fuel station under its canopy, and street things off the road', () => {
    const { doc, features } = world([], [shop(1, 20, 30, { amenity: 'fuel' }), shop(2, -20, 12, { advertising: 'column' }), shop(3, -30, 1, { advertising: 'column' })]);
    doc.objects.push({ id: 'osm-b9', asset: 'station-canopy', x: 20, y: 30, z: 0, rotation: 0, scale: 1, group: 'osm-b9' });
    const r = placePois(doc, features, { costOf: cost });
    expect(r.placed['fuel-pump']).toBe(3);
    // The column on the road is left out
    expect(r.placed['advertising-column']).toBe(1);
    expect(placed(doc).find((o) => o.asset === 'advertising-column')).toMatchObject({ x: -20, y: 12 });
  });
});
