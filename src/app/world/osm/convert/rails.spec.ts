import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { heightAt } from '../../../map-ops/grid';
import { MAX_LAYERS, readWeights } from '../../../map-ops/paint-ops';
import { objectsInAir, validateMap } from '../../../map-ops/validation/map-validation';
import { routeBetween } from '../../../map-ops/path-graph';
import { bridgeDecks, deckHeightAt } from '../../custom-map/bridge-decks';
import { createMapDocument } from '../../custom-map/map-create';
import { HeightField } from '../../custom-map/render/height-field';
import type { CustomMapDocument, MapObject } from '../../custom-map/map-document';
import type { CatalogObject } from '../../custom-map/render/asset-catalog';
import { OsmFrame, parseOsm } from '../osm-parse';
import type { OverpassElement } from '../overpass-client';
import { placeFurniture } from './furniture';
import { sampleGrid } from './raster';
import {
  BED_HALF,
  CROSSING_RAMP,
  CROSSING_SINK,
  equipment,
  LATTICE,
  levelRails,
  OVER_CLEARANCE,
  PANEL_TOP,
  planRails,
  profileAt,
  RAIL_ASSETS,
  RAIL_DECK_DEPTH,
  paintRails,
  RAIL_GROUND,
  RAIL_HEAD,
  railPieces,
  STREET_SINK,
  STREET_TOP,
  timberSleepers,
  UNDER_CLEARANCE,
  type RailPlan,
} from './rails';
import { buildRoads, levelRoads } from './roads';
import type { WaterResult } from './water';

const catalog = JSON.parse(readFileSync(join(__dirname, '../../../../../public/maps/assets/catalog.json'), 'utf8')) as { objects: CatalogObject[] };
const byId = new Map(catalog.objects.map((o) => [o.id, o]));

const frame = new OsmFrame(48, 9);
const g = (x: number, y: number) => frame.geo({ x, y });

function way(id: number, tags: Record<string, string>, points: [number, number, number][]): OverpassElement {
  return { type: 'way', id, tags, nodes: points.map((p) => p[2]), geometry: points.map(([x, y]) => g(x, y)) };
}

function node(id: number, tags: Record<string, string>, x: number, y: number): OverpassElement {
  return { type: 'node', id, tags, ...g(x, y) };
}

/**
 * A 400 m map from `elements`, its ground `ground(x, y)`, the roads built and
 * levelled as convertOsm does; the railway planned on it
 */
function world(elements: OverpassElement[], ground: (x: number, y: number) => number = () => 0) {
  const doc = createMapDocument({ id: 't', name: 't', width: 400, depth: 400, cellSize: 2, splatResolution: 128, starter: false });
  const t = doc.terrain;
  for (let j = 0; j < t.grid.rows; j++) {
    for (let i = 0; i < t.grid.columns; i++) t.grid.heights[j * t.grid.columns + i] = ground(i * 2 - 200, j * 2 - 200);
  }
  const features = parseOsm({ elements }, frame, 200);
  const roads = buildRoads(features);
  doc.paths = roads.paths;
  doc.hq = { x: 190, y: 190 };
  doc.spawns = [];
  doc.objects = [];
  levelRoads(t, doc.paths);
  const plan = planRails(features, doc.paths);
  return { doc, features, plan };
}

function noWater(doc: CustomMapDocument): WaterResult {
  const n = sampleGrid(doc.terrain.width, doc.terrain.grid.cellSize).n ** 2;
  return { wet: new Uint8Array(n), sea: new Uint8Array(n), roads: new Uint8Array(n) } as WaterResult;
}

const costOf = () => 1;
const of = (doc: CustomMapDocument, asset: string): MapObject[] => doc.objects.filter((o) => o.asset === asset);
/** Map direction of a model's front (glTF +Z) at a turn */
const front = (r: number) => ({ x: -Math.sin(r), y: Math.cos(r) });

/** A secondary road north to south over x = 0 and a track east to west over y = 0, sharing node 2 */
const crossingElements = (tags: Record<string, string>) => [
  way(1, { highway: 'secondary', lit: 'yes' }, [[0, -190, 1], [0, 0, 2], [0, 190, 3]]),
  way(10, { railway: 'rail' }, [[-190, 0, 11], [0, 0, 2], [190, 0, 12]]),
  node(2, tags, 0, 0),
];

describe('OSM railway', () => {
  it('reads what stands at a level crossing from its node, a road crossing with a cross by default', () => {
    expect(equipment({}, false)).toEqual({ saltire: true, light: false, barrier: false });
    expect(equipment({}, true)).toEqual({ saltire: false, light: false, barrier: false });
    expect(equipment({ 'crossing:saltire': 'no', 'crossing:light': 'yes', 'crossing:barrier': 'half' }, false)).toEqual({ saltire: false, light: true, barrier: true });
    expect(equipment({ 'crossing:barrier': 'no', 'crossing:light': 'yes', 'crossing:saltire': 'yes' }, true)).toEqual({ saltire: true, light: true, barrier: false });
  });

  it('lays a level crossing where track and road share a node: panels over the road, signals and barriers at both approaches', () => {
    const { doc, features, plan } = world(crossingElements({ railway: 'level_crossing', 'crossing:barrier': 'half', 'crossing:light': 'yes' }));
    expect(plan.crossings).toHaveLength(1);
    expect(plan.crossings[0]).toMatchObject({ saltire: true, light: true, barrier: true, roadWidth: 9 });
    expect(plan.stats).toMatchObject({ lines: 1, crossings: 1, bridges: 0, overpasses: 0 });
    placeFurniture(doc, features, noWater(doc), { costOf, rails: plan });

    // Panels cover the road and its margin (the crossing is square: 4.5 + 0.75 m either side, on the lattice)
    const panels = of(doc, RAIL_ASSETS.crossing);
    expect(panels.length).toBe(6);
    expect(Math.min(...panels.map((o) => o.x))).toBeCloseTo(-6.25, 5);
    expect(Math.max(...panels.map((o) => o.x))).toBeCloseTo(6.25, 5);
    // No bed lies on the road: the nearest bed piece starts where the panels end
    const beds = [...of(doc, RAIL_ASSETS.track), ...of(doc, RAIL_ASSETS.trackShort)];
    for (const o of beds) expect(Math.abs(o.x) - (o.asset === RAIL_ASSETS.track ? 5 : 1.25)).toBeGreaterThanOrEqual(7.5 - 1e-6);

    // A cross with lights on the right of each approach, facing the traffic; the raised barrier behind it
    const posts = of(doc, RAIL_ASSETS.signal);
    expect(posts).toHaveLength(2);
    const north = posts.find((o) => o.y > 0)!;
    const south = posts.find((o) => o.y < 0)!;
    // From the north the traffic drives south: its right is the west
    expect(north.x).toBeLessThan(-4.5);
    expect(south.x).toBeGreaterThan(4.5);
    expect(front(north.rotation).y).toBeCloseTo(1, 3);
    expect(front(south.rotation).y).toBeCloseTo(-1, 3);
    const barriers = of(doc, RAIL_ASSETS.barrier);
    expect(barriers).toHaveLength(2);
    for (const b of barriers) expect(Math.abs(b.y)).toBeGreaterThan(Math.abs(north.y));

    // The lit road's lamps keep off the track bed
    const lamps = doc.objects.filter((o) => o.asset === 'lamp-post' || o.asset === 'street-lamp');
    expect(lamps.length).toBeGreaterThan(5);
    for (const o of lamps) expect(Math.abs(o.y)).toBeGreaterThan(BED_HALF);

    const footingOf = (a: string) => byId.get(a);
    const issues = validateMap(doc, { footingOf, blocksBuild: (a) => byId.get(a)?.blocksBuild ?? false, roadThrough: (a) => !!byId.get(a)?.roadThrough });
    expect(issues.map((i) => i.code)).not.toContain('object-on-path');
  });

  it('brings the track\'s rail heads to the panels a little over the road at a level crossing and leaves the road as it was levelled', () => {
    // The road runs along a ridge 1.5 m over the land
    const ridge = (x: number) => 3 + 1.5 * Math.exp(-(x * x) / 200);
    const { doc, plan } = world(crossingElements({ railway: 'level_crossing' }), (x) => ridge(x));
    const t = doc.terrain;
    const road = (y: number) => heightAt(t, 0, y);
    const before = [-6, -4, -2, 0, 2, 4, 6].map((y) => [-4, -2, 0, 2, 4].map((x) => heightAt(t, x, y)));
    const report = levelRails(t, plan, doc.paths);
    expect(report.samples).toBeGreaterThan(0);
    // The road band is untouched, routes drive over the crossing at the road's height
    expect([-6, -4, -2, 0, 2, 4, 6].map((y) => [-4, -2, 0, 2, 4].map((x) => heightAt(t, x, y)))).toEqual(before);
    const c = plan.chains[0];
    const x = plan.crossings[0];
    // The formation CROSSING_SINK under the road: the rail heads flush with the panels, PANEL_TOP over the road
    expect(profileAt(c, x.along, t)).toBeCloseTo(road(0) - CROSSING_SINK, 2);
    expect(profileAt(c, x.along, t) + RAIL_HEAD - road(0)).toBeCloseTo(PANEL_TOP, 2);
    // Under the panels past the road the ground at the road's level (they lie in it as on the road, 6.25 m
    // to 7.5 m from the road's middle); past them the bed's ground at the formation, ramping back to the land's
    // average past CROSSING_RAMP
    expect(heightAt(t, 6, 0)).toBeCloseTo(road(0), 1);
    expect(heightAt(t, 10, 0)).toBeLessThan(road(0) - CROSSING_SINK + 0.15);
    expect(heightAt(t, 10, 0)).toBeGreaterThan(heightAt(t, x.half + CROSSING_RAMP + 10, 0));
    // Flat across the bed
    expect(heightAt(t, 40, BED_HALF - 0.5)).toBeCloseTo(heightAt(t, 40, 0), 2);
    // No step for anything walking the road over the crossing
    for (let y = -20; y < 20; y++) expect(Math.abs(road(y + 1) - road(y))).toBeLessThan(0.2);
    expect(routeBetween(doc.paths, { x: 0, y: -180 }, { x: 0, y: 180 })).not.toBeNull();
  });

  it('joins bed and crossing pieces rail to rail, the panels following a graded road across a slanted crossing', () => {
    // A road climbing 6 % to the north-east, the track east to west across it at 45 degrees
    const grade = (x: number, y: number) => 10 + 0.06 * ((x + y) / Math.SQRT2);
    const elements = [
      way(1, { highway: 'residential' }, [[-130, -130, 1], [0, 0, 2], [130, 130, 3]]),
      way(10, { railway: 'rail' }, [[-190, 0, 11], [0, 0, 2], [190, 0, 12]]),
      node(2, { railway: 'level_crossing' }, 0, 0),
    ];
    const { doc, plan } = world(elements, grade);
    const t = doc.terrain;
    levelRails(t, plan, doc.paths);
    const c = plan.chains[0];
    const pieces = railPieces(plan, t, doc.paths).filter((p) => p.source === 'track' || p.source === 'crossing');
    const panels = pieces.filter((p) => p.source === 'crossing').map((p) => p.o);
    expect(panels.length).toBeGreaterThan(4);
    // Each piece near the crossing has its formation on the profile, tilted to it: bed and crossing meet rail to rail
    for (const { o } of pieces) {
      if (Math.abs(o.x) > 30) continue;
      const along = Math.abs(o.x - c.line[0].x);
      const len = o.asset === RAIL_ASSETS.track ? 10 : LATTICE;
      expect(heightAt(t, o.x, o.y) + o.z).toBeCloseTo(profileAt(c, along, t), 1);
      expect(Math.abs((o.roll ?? 0) - Math.atan2(profileAt(c, along - len / 2, t) - profileAt(c, along + len / 2, t), len))).toBeLessThan(1e-3);
    }
    // The panels over the road PANEL_TOP over it, however it climbs across the crossing
    const road = (x: number) => heightAt(t, x, 0);
    const onRoad = panels.filter((o) => Math.abs(o.x) < 4);
    expect(onRoad.length).toBeGreaterThan(1);
    for (const o of onRoad) expect(heightAt(t, o.x, o.y) + o.z + RAIL_HEAD - road(o.x)).toBeCloseTo(PANEL_TOP, 1);
  });

  it('tiles a line exactly on its lattice, each piece tilted to the profile between its ends', () => {
    // A track rising 4 % to the east over 300 m, no road
    const { doc, plan } = world([way(10, { railway: 'rail' }, [[-150, 20, 11], [150, 20, 12]])], (x) => 10 + 0.04 * x);
    levelRails(doc.terrain, plan, doc.paths);
    const pieces = railPieces(plan, doc.terrain, doc.paths).filter((p) => p.source === 'track');
    const len = (o: { asset: string }) => (o.asset === RAIL_ASSETS.track ? 10 : LATTICE);
    const sorted = pieces.map((p) => p.o).sort((a, b) => a.x - b.x);
    expect(sorted.reduce((s, o) => s + len(o), 0)).toBeCloseTo(300, 5);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k].x - sorted[k - 1].x).toBeCloseTo((len(sorted[k]) + len(sorted[k - 1])) / 2, 3);
    // Model +X points back west, down the grade: tilted down toward it
    for (const o of sorted) expect(o.roll).toBeCloseTo(-Math.atan(0.04), 2);
    expect(objectsInAir({ ...doc, objects: sorted.map((o, k) => ({ id: `o${k}`, ...o })) }, (a) => byId.get(a))).toEqual([]);
  });

  it('carries the track over a road on its own bridge, raising it and its approaches where the road needs the headroom', () => {
    // The data's bridge over a road on flat land: the bridge must rise
    const elements = [
      way(1, { highway: 'residential' }, [[0, -190, 1], [0, 190, 3]]),
      way(10, { railway: 'rail' }, [[-190, 0, 11], [-12, 0, 13]]),
      way(11, { railway: 'rail', bridge: 'yes', layer: '1' }, [[-12, 0, 13], [12, 0, 14]]),
      way(12, { railway: 'rail' }, [[12, 0, 14], [190, 0, 12]]),
    ];
    const { doc, features, plan } = world(elements, () => 5);
    expect(plan.chains).toHaveLength(1);
    expect(plan.bridges).toEqual([expect.objectContaining({ from: expect.closeTo(178, 3), to: expect.closeTo(202, 3), implicit: false, under: [expect.objectContaining({ clear: UNDER_CLEARANCE.road })] })]);
    expect(plan.crossings).toEqual([]);
    const t = doc.terrain;
    const road = [-6, -2, 0, 2, 6].map((y) => heightAt(t, 0, y));
    const report = levelRails(t, plan, doc.paths);
    expect(report.raisedM).toBeCloseTo(UNDER_CLEARANCE.road + RAIL_DECK_DEPTH, 1);
    const c = plan.chains[0];
    // The deck clears the road; the road is where it was
    expect(profileAt(c, 190, t) - RAIL_DECK_DEPTH - heightAt(t, 0, 0)).toBeGreaterThanOrEqual(UNDER_CLEARANCE.road - 0.01);
    expect([-6, -2, 0, 2, 6].map((y) => heightAt(t, 0, y))).toEqual(road);
    // An embankment carries the approach, falling back to the land along the ramp
    expect(heightAt(t, -20, 0)).toBeGreaterThan(9);
    expect(heightAt(t, -100, 0)).toBeLessThan(heightAt(t, -20, 0));
    expect(heightAt(t, -100, 0)).toBeGreaterThan(heightAt(t, -180, 0));
    expect(heightAt(t, -180, 0)).toBeLessThan(5.5);

    placeFurniture(doc, features, noWater(doc), { costOf, rails: plan });
    const deck = [...of(doc, RAIL_ASSETS.bridge), ...of(doc, RAIL_ASSETS.bridgeShort)];
    expect(deck.length).toBeGreaterThan(0);
    for (const o of deck) expect(o.z).toBeGreaterThan(4);
    const abutments = of(doc, RAIL_ASSETS.abutment);
    expect(abutments).toHaveLength(2);
    // Their faces toward the span, their tops under the deck, their feet in the ground
    for (const o of abutments) {
      expect(front(o.rotation).x * Math.sign(-o.x)).toBeCloseTo(1, 3);
      expect(o.z).toBeLessThan(0);
      expect(Math.abs(o.x)).toBeGreaterThan(4.5 + 1);
    }
    expect(objectsInAir(doc, (a) => byId.get(a))).toEqual([]);
    expect(validateMap(doc, { blocksBuild: (a) => byId.get(a)?.blocksBuild ?? false, roadThrough: (a) => !!byId.get(a)?.roadThrough, footingOf: (a) => byId.get(a) }).map((i) => i.code)).not.toContain('object-on-path');
  });

  it('gives the track its own bridge over an underpass the map keeps as a road, and over a road on a lower layer', () => {
    const elements = [
      way(1, { highway: 'footway', tunnel: 'yes', layer: '-1' }, [[-60, -15, 1], [-60, 15, 2]]),
      way(2, { highway: 'service', layer: '-1' }, [[60, -100, 3], [60, 100, 4]]),
      way(10, { railway: 'rail' }, [[-190, 0, 11], [190, 0, 12]]),
    ];
    const { plan } = world(elements, () => 0);
    expect(plan.crossings).toEqual([]);
    expect(plan.bridges.map((b) => [Math.round(b.from + b.to) / 2 - 190, b.implicit])).toEqual([
      [-60, true],
      [60, true],
    ]);
    expect(plan.stats.underpasses).toBe(2);
  });

  it('raises a line over two bridges side by side as high as the higher needs, not the two added', () => {
    // Two footway underpasses 14 m apart under the line: each wants its own bridge some metres up
    const elements = [
      way(1, { highway: 'footway', tunnel: 'yes', layer: '-1' }, [[-7, -15, 1], [-7, 15, 2]]),
      way(2, { highway: 'footway', tunnel: 'yes', layer: '-1' }, [[7, -15, 3], [7, 15, 4]]),
      way(10, { railway: 'rail' }, [[-190, 0, 11], [190, 0, 12]]),
    ];
    const { doc, plan } = world(elements, () => 0);
    expect(plan.bridges).toHaveLength(2);
    const report = levelRails(doc.terrain, plan, doc.paths);
    const top = Math.max(...plan.chains[0].profile!);
    // Before, between them the line stood at the sum of both raises
    expect(top).toBeLessThanOrEqual(report.raisedM + 0.01);
    expect(top).toBeGreaterThan(report.raisedM - 0.3);
  });

  it('runs the track under a road bridge, keeping its bed there and sinking it where the deck is too low', () => {
    const elements = [
      way(1, { highway: 'secondary' }, [[0, -190, 1], [0, -20, 2]]),
      way(2, { highway: 'secondary', bridge: 'yes', layer: '1' }, [[0, -20, 2], [0, 20, 3]]),
      way(3, { highway: 'secondary' }, [[0, 20, 3], [0, 190, 4]]),
      way(10, { railway: 'rail', electrified: 'contact_line' }, [[-190, 0, 11], [190, 0, 12]]),
    ];
    // Flat land: the bridge's deck stands on the ground at its ends, far too low over the track
    const { doc, features, plan } = world(elements, () => 0);
    expect(plan.overpasses).toHaveLength(1);
    expect(plan.crossings).toEqual([]);
    const t = doc.terrain;
    const deck = deckHeightAt(bridgeDecks(doc.paths, t, new HeightField(t.grid, t.width, t.depth)), 0, 0);
    const report = levelRails(t, plan, doc.paths);
    expect(report.loweredM).toBeGreaterThan(4);
    // Under the deck with the overhead line's headroom: in a cutting
    expect(profileAt(plan.chains[0], 190, t)).toBeLessThanOrEqual(deck - 1.25 - OVER_CLEARANCE.electrified + 0.01);
    expect(heightAt(t, 20, 0)).toBeLessThan(-3);
    placeFurniture(doc, features, noWater(doc), { costOf, rails: plan });
    // The bed passes under the deck (not left out as "on a road")
    const under = [...of(doc, RAIL_ASSETS.track), ...of(doc, RAIL_ASSETS.trackShort)].filter((o) => Math.abs(o.x) < 6);
    expect(under.length).toBeGreaterThan(0);
    // The bridge's abutments stand where the cutting opens under the deck, facing in, their feet in the ground
    const abutments = of(doc, RAIL_ASSETS.abutment).sort((a, b) => a.y - b.y);
    expect(abutments).toHaveLength(2);
    expect(abutments[0].y).toBeGreaterThan(-20);
    expect(abutments[0].y).toBeLessThan(-BED_HALF);
    expect(front(abutments[0].rotation).y).toBeCloseTo(1, 3);
    expect(front(abutments[1].rotation).y).toBeCloseTo(-1, 3);
    for (const o of abutments) expect(o.z).toBeLessThan(0);
  });

  it('takes a crossing the data give no shared node for a level one, and a track on a lower layer under a road for panels only', () => {
    const plain = world([way(1, { highway: 'residential' }, [[0, -190, 1], [0, 190, 3]]), way(10, { railway: 'rail' }, [[-190, 0, 11], [190, 0, 12]])]);
    expect(plain.plan.crossings).toEqual([expect.objectContaining({ saltire: true, light: false, barrier: false })]);
    const low = world([way(1, { highway: 'residential' }, [[0, -190, 1], [0, 190, 3]]), way(10, { railway: 'rail', layer: '-1' }, [[-190, 0, 11], [190, 0, 12]])]);
    expect(low.plan.crossings).toEqual([expect.objectContaining({ saltire: false, light: false, barrier: false })]);
  });

  it('lays a tramway in the street as rails in the pavement, with no St Andrew\'s cross where it crosses a road', () => {
    // A street east to west with the tram down its middle from x -100 to 100, a cross street at x = 0
    const elements = [
      way(1, { highway: 'residential' }, [[-190, 0, 1], [0, 0, 2], [190, 0, 3]]),
      way(2, { highway: 'residential' }, [[0, -190, 4], [0, 0, 2], [0, 190, 5]]),
      way(10, { railway: 'tram' }, [[-100, 0.5, 11], [100, 0.5, 12]]),
    ];
    const { doc, features, plan } = world(elements);
    expect(plan.crossings).toEqual([expect.objectContaining({ saltire: false, light: false, barrier: false })]);
    placeFurniture(doc, features, noWater(doc), { costOf, rails: plan });
    // Panels where it crosses the cross street, rails in the asphalt along the rest: 200 m in 2.5 m modules
    expect(of(doc, RAIL_ASSETS.crossing).length).toBe(4);
    expect(of(doc, RAIL_ASSETS.street).length).toBe(76);
    expect([...of(doc, RAIL_ASSETS.track), ...of(doc, RAIL_ASSETS.trackShort)]).toEqual([]);
    expect([...of(doc, RAIL_ASSETS.saltire), ...of(doc, RAIL_ASSETS.signal)]).toEqual([]);
  });

  it('paints gravel along the bed but not under its bridge, and lays timber sleepers on sidings', () => {
    const elements = [
      way(1, { highway: 'residential' }, [[0, -190, 1], [0, 190, 3]]),
      way(10, { railway: 'rail' }, [[-190, 0, 11], [-12, 0, 13]]),
      way(11, { railway: 'rail', bridge: 'yes' }, [[-12, 0, 13], [12, 0, 14]]),
      way(12, { railway: 'rail' }, [[12, 0, 14], [190, 0, 12]]),
    ];
    const { doc, plan } = world(elements);
    const t = doc.terrain;
    paintRails(t, plan);
    const layer = t.layers.findIndex((l) => l.material === RAIL_GROUND.material);
    expect(layer).toBeGreaterThanOrEqual(0);
    const w = new Float32Array(MAX_LAYERS);
    const share = (x: number, y: number) => {
      const res = t.splat.resolution;
      readWeights(t, Math.floor(((y + 200) / 400) * res) * res + Math.floor(((x + 200) / 400) * res), w);
      return w[layer] / w.reduce((a, b) => a + b, 0);
    };
    expect(share(-100, 0)).toBeGreaterThan(0.9);
    expect(share(-100, 2.5)).toBeGreaterThan(0.9);
    expect(share(-100, 12)).toBeLessThan(0.05);
    expect(share(0, 1)).toBeLessThan(0.05);
    expect(timberSleepers({ railway: 'rail', service: 'siding' })).toBe(true);
    expect(timberSleepers({ railway: 'narrow_gauge' })).toBe(true);
    expect(timberSleepers({ railway: 'rail', usage: 'main' })).toBe(false);
  });

  it('leaves a long rail tunnel out and gives it mouths for portals, a short one stays track', () => {
    const elements = [
      way(10, { railway: 'rail' }, [[-190, 0, 11], [-60, 0, 13]]),
      way(11, { railway: 'rail', tunnel: 'yes' }, [[-60, 0, 13], [60, 0, 14]]),
      way(12, { railway: 'rail' }, [[60, 0, 14], [190, 0, 12]]),
      way(20, { railway: 'rail' }, [[-190, 50, 21], [-10, 50, 22]]),
      way(21, { railway: 'rail', tunnel: 'yes' }, [[-10, 50, 22], [10, 50, 23]]),
      way(22, { railway: 'rail' }, [[10, 50, 23], [190, 50, 24]]),
    ];
    const { plan } = world(elements);
    expect(plan.tunnels).toHaveLength(1);
    expect(plan.mouths.map((m) => m.p.x).sort((a, b) => a - b)).toEqual([-60, 60]);
    // The long tunnel splits its line in two; the short one is part of its line
    expect(plan.chains.map((c) => Math.round(c.length)).sort((a, b) => a - b)).toEqual([130, 130, 380]);
  });

  it('brings the lines of a track field to one level, so their beds meet without a step', () => {
    // Two lines 4.5 m apart across a slope of 1 in 5: the ground under them differs by 0.9 m
    const elements = [way(10, { railway: 'rail' }, [[-190, 0, 11], [190, 0, 12]]), way(11, { railway: 'rail' }, [[-190, 4.5, 13], [190, 4.5, 14]])];
    const { doc, plan } = world(elements, (_, y) => 10 + 0.2 * y);
    levelRails(doc.terrain, plan, doc.paths);
    const [a, b] = plan.chains;
    const gap = Math.abs(profileAt(a, 190, doc.terrain) - profileAt(b, 190, doc.terrain));
    expect(gap).toBeLessThan(0.1);
    // Halfway between them: the ground they share
    expect(heightAt(doc.terrain, 0, 2)).toBeCloseTo(profileAt(a, 190, doc.terrain), 0);
  });

  it('runs the line through a switch where two ways go on straight, the branch on its bed at its height', () => {
    // A line split at a switch (node 13) on a slope, a siding leaving it there at 6 degrees
    const elements = [
      way(10, { railway: 'rail' }, [[-190, 0, 11], [21.3, 0, 13]]),
      way(11, { railway: 'rail' }, [[21.3, 0, 13], [190, 0, 12]]),
      way(12, { railway: 'rail', service: 'siding' }, [[21.3, 0, 13], [190, 17.8, 15]]),
    ];
    const { doc, plan } = world(elements, (x, y) => 5 + 0.03 * x + 0.05 * y);
    expect(plan.chains).toHaveLength(2);
    const main = plan.chains.find((c) => c.ways.some((w) => w.id === 10))!;
    const branch = plan.chains.find((c) => c.ways.some((w) => w.id === 12))!;
    expect(main.ways.map((w) => w.id)).toEqual([10, 11]);
    expect(main.length).toBeCloseTo(380, 3);
    levelRails(doc.terrain, plan, doc.paths);
    // The branch starts on the line at its height: one bed, no step
    const atSwitch = Math.abs(21.3 - main.line[0].x);
    const start = Math.hypot(branch.line[0].x - 21.3, branch.line[0].y) < 1 ? 0 : branch.length;
    expect(profileAt(branch, start, doc.terrain)).toBeCloseTo(profileAt(main, atSwitch, doc.terrain), 3);
    // The main line's bed is tiled through the switch without a gap
    const beds = railPieces(plan, doc.terrain, doc.paths).filter((p) => p.source === 'track' && Math.abs(p.o.y) < 0.01).map((p) => p.o);
    expect(beds.filter((o) => Math.abs(o.x - 21.3) < (o.asset === RAIL_ASSETS.track ? 5 : 1.25)).length).toBeGreaterThan(0);
    // A bend too sharp for a through line (90 degrees) ends both
    const sharp = world([
      way(10, { railway: 'rail' }, [[-190, 0, 11], [0, 0, 13]]),
      way(11, { railway: 'rail' }, [[0, 0, 13], [0, 190, 12]]),
      way(12, { railway: 'rail' }, [[0, 0, 13], [0, -190, 15]]),
    ]);
    expect(sharp.plan.chains.map((c) => Math.round(c.length)).sort((a, b) => a - b)).toEqual([190, 380]);
  });

  it('sinks street track under the road it runs in, its pieces on the profile, joining the bed rail to rail', () => {
    // A yard road along the middle of a line, x -50 to 50
    const elements = [way(1, { highway: 'service' }, [[-50, 0.3, 1], [50, 0.3, 2]]), way(10, { railway: 'rail' }, [[-190, 0, 11], [190, 0, 12]])];
    const { doc, plan } = world(elements, () => 3);
    expect(plan.streets.length).toBe(1);
    const t = doc.terrain;
    levelRails(t, plan, doc.paths);
    const c = plan.chains[0];
    expect(profileAt(c, 190, t)).toBeCloseTo(heightAt(t, 0, 0) - STREET_SINK, 2);
    const pieces = railPieces(plan, t, doc.paths).filter((p) => p.source === 'track').map((p) => p.o);
    const street = pieces.filter((o) => o.asset === RAIL_ASSETS.street);
    expect(street.length).toBeGreaterThan(30);
    // Every piece's formation on the profile: the street's rail heads STREET_TOP over the road, the bed's meet them
    for (const o of pieces) {
      if (Math.abs(o.x) > 70) continue;
      expect(Math.abs(heightAt(t, o.x, o.y) + o.z - profileAt(c, Math.abs(o.x - c.line[0].x), t))).toBeLessThan(0.1);
    }
    for (const o of street.filter((o) => Math.abs(o.x) < 40)) expect(heightAt(t, o.x, o.y) + o.z + RAIL_HEAD - heightAt(t, o.x, 0.3)).toBeCloseTo(STREET_TOP, 1);
  });

  it("carries a crossing's panels over the road's pavements, stands its signals past them and leaves them as the road levelled them", () => {
    const elements = [
      way(1, { highway: 'secondary', sidewalk: 'both' }, [[0, -190, 1], [0, 0, 2], [0, 190, 3]]),
      way(10, { railway: 'rail' }, [[-190, 0, 11], [0, 0, 2], [190, 0, 12]]),
      node(2, { railway: 'level_crossing' }, 0, 0),
    ];
    const { doc, features } = world(elements, (x) => 3 + 0.02 * x);
    // The pavements as layPavements gives them, 2 m either side
    for (const e of doc.paths.edges) if (e.kind === 'road') e.sidewalk = 2;
    const plan = planRails(features, doc.paths);
    const edge = doc.paths.edges.find((e) => e.kind === 'road')!;
    const pavement = 2;
    const x = plan.crossings[0];
    expect(x.half).toBeGreaterThanOrEqual(edge.width / 2 + pavement);
    const t = doc.terrain;
    // The pavements' ground beside the bed, before and after
    const outer = edge.width / 2 + pavement - 0.5;
    const before = [-6, -4, 4, 6].map((y) => heightAt(t, outer, y));
    levelRails(t, plan, doc.paths);
    expect([-6, -4, 4, 6].map((y) => heightAt(t, outer, y))).toEqual(before);
    // The cross and the barrier stand past the pavement, not on it
    const posts = railPieces(plan, t, doc.paths).filter((p) => p.source === 'crossing signal');
    expect(posts.length).toBe(2);
    for (const p of posts) expect(Math.abs(p.o.x)).toBeGreaterThan(edge.width / 2 + pavement);
  });

  it('stops a hedge OSM maps across the line at the bed and its gravel and at the road', () => {
    const elements = [...crossingElements({ railway: 'level_crossing' }), way(20, { barrier: 'hedge' }, [[-40, -30, 21], [-40, 30, 22]]), way(21, { barrier: 'hedge' }, [[-20, 10, 23], [20, 10, 24]])];
    const { doc, features, plan } = world(elements);
    placeFurniture(doc, features, noWater(doc), { costOf, rails: plan });
    const hedges = of(doc, 'hedge-long');
    expect(hedges.filter((o) => Math.abs(o.x + 40) < 0.01).length).toBeGreaterThan(6);
    expect(hedges.filter((o) => Math.abs(o.y - 10) < 0.01).length).toBeGreaterThan(3);
    // No piece reaches over the bed and its gravel, or onto the road (4.5 m half width), with its length (3 m either side)
    for (const o of hedges) {
      for (const f of [-1, -0.5, 0, 0.5, 1]) {
        const x = o.x + Math.cos(o.rotation) * 3 * f;
        const y = o.y + Math.sin(o.rotation) * 3 * f;
        expect(Math.abs(y)).toBeGreaterThanOrEqual(RAIL_GROUND.half - 0.01);
        expect(Math.abs(x)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('joins track ways end to end into one line, and ends lines at a switch', () => {
    // Two ways in a row, and a siding leaving the second at node 13
    const elements = [
      way(10, { railway: 'rail' }, [[-190, 0, 11], [-50, 0, 12]]),
      way(11, { railway: 'rail' }, [[190, 0, 14], [50, 0, 13], [-50, 0, 12]]),
      way(12, { railway: 'rail', service: 'siding' }, [[50, 0, 13], [150, 10, 15]]),
    ];
    const { plan }: { plan: RailPlan } = world(elements);
    // Node 13 is inner to way 11: no join there; ways 10 and 11 meet end to end at node 12
    expect(plan.chains).toHaveLength(2);
    const main = plan.chains.find((c) => c.length > 300)!;
    expect(main.length).toBeCloseTo(380, 3);
    expect(main.ways.map((w) => w.id)).toEqual([10, 11, 11]);
  });
});
