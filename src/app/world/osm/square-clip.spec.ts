import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { MapPoint } from '../custom-map/map-document';
import type { OverpassElement, OverpassResponse } from './overpass-client';
import { OsmFrame, parseOsm, type OsmArea } from './osm-parse';
import { clipArea, insideRings, ringArea } from './square-clip';

const frame = new OsmFrame(47.5, 9.7);
/** The map's half side and the query box's (100 m margin), metres */
const HALF = 100;
const BOX = 200;
const inBox = (p: MapPoint) => Math.abs(p.x) <= BOX && Math.abs(p.y) <= BOX;

/**
 * Points as `out geom(<box>)` gives them: a node outside the box null unless
 * it neighbours one inside (`closed`: the way's last node is its first)
 */
function cut(points: readonly MapPoint[], closed: boolean): ({ lat: number; lon: number } | null)[] {
  const n = points.length;
  return points.map((p, k) => {
    const prev = closed ? points[(k + n - 1) % n] : points[k - 1];
    const next = closed ? points[(k + 1) % n] : points[k + 1];
    return inBox(p) || (prev && inBox(prev)) || (next && inBox(next)) ? frame.geo(p) : null;
  });
}

let nextId = 1;
/** A closed way around `ring` (first point not repeated), cut at the box */
function closedWay(ring: readonly MapPoint[], tags: Record<string, string>): OverpassElement {
  const geometry = cut(ring, true);
  const nodes = ring.map(() => nextId++);
  return { type: 'way', id: nextId++, tags, nodes: [...nodes, nodes[0]], geometry: [...geometry, geometry[0]] };
}

function member(points: readonly MapPoint[], role: 'outer' | 'inner') {
  return { type: 'way', ref: nextId++, role, geometry: cut(points, false) };
}

/** A building of 10 m by 10 m at x, y */
function house(x: number, y: number): OverpassElement {
  return closedWay([{ x, y }, { x: x + 10, y }, { x: x + 10, y: y + 10 }, { x, y: y + 10 }], { building: 'house' });
}

function areaOf(elements: OverpassElement[], id: number): OsmArea | undefined {
  const data: OverpassResponse = { elements };
  return parseOsm(data, frame, HALF).areas.find((a) => a.id === id);
}

/** Even-odd over the area's rings */
const covers = (a: OsmArea, x: number, y: number) => insideRings({ x, y }, [...a.outer, ...a.inner]);

describe('areas cut to the map square', () => {
  it('keeps a ring wholly inside as it is, and cuts a concave one crossing the edge into its parts', () => {
    const square = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
    const kept = clipArea([square], [], [], HALF)!;
    expect(kept.outer[0]).toBe(square);
    expect(kept.area).toBeCloseTo(400);
    // A U open to the north, its arms reaching past the edge: two arms and the bottom inside, one ring
    const u = [
      { x: -50, y: 50 }, { x: -50, y: 150 }, { x: -30, y: 150 }, { x: -30, y: 70 }, { x: 30, y: 70 }, { x: 30, y: 150 }, { x: 50, y: 150 }, { x: 50, y: 50 },
    ];
    const cutU = clipArea([u], [], [], HALF)!;
    expect(cutU.outer).toHaveLength(1);
    expect(cutU.inner).toEqual([]);
    expect(cutU.area).toBeCloseTo(100 * 50 - 60 * 30, 0);
    // A U open to the south crossing the north edge with its bottom: two separate arms inside
    const n = u.map((p) => ({ x: p.x, y: 220 - p.y }));
    const arms = clipArea([n], [], [], HALF)!;
    expect(arms.outer).toHaveLength(2);
    expect(arms.area).toBeCloseTo(2 * 20 * 30, 0);
  });

  it('covers the whole map with a lake whose shore lies past the map all round', () => {
    const ring = [{ x: -1000, y: -1000 }, { x: 1000, y: -1000 }, { x: 1000, y: 1000 }, { x: -1000, y: 1000 }];
    expect(clipArea([ring], [], [], HALF)!.area).toBeCloseTo(200 * 200);
  });

  it('cuts a lake larger than the map along its shore: water on the side the town is not', () => {
    // A shore across the map from west to east, the lake to the south, the rest of its ring far away
    const lake = [
      { x: -3000, y: -3000 }, { x: 3000, y: -3000 }, { x: 3000, y: 20 }, { x: 400, y: 20 }, { x: 180, y: 25 }, { x: 60, y: 10 }, { x: 0, y: -20 },
      { x: -60, y: 10 }, { x: -180, y: 30 }, { x: -400, y: 30 }, { x: -3000, y: 30 },
    ];
    const town = [house(-80, 50), house(-40, 60), house(0, 50), house(40, 70), house(70, 55), house(-60, 80), house(20, 85), house(60, 30), house(-20, 30)];
    const way = closedWay(lake, { natural: 'water', water: 'lake' });
    for (const elements of [[way, ...town], [...town, way]]) {
      const f = parseOsm({ elements }, frame, HALF);
      const a = f.areas.find((x) => x.id === way.id)!;
      // The shore alone closes round the north, the shorter way: the town turns it
      expect(f.stats.turnedAreas).toBe(1);
      expect(covers(a, 0, -90)).toBe(true);
      expect(covers(a, -90, -50)).toBe(true);
      expect(covers(a, 0, 80)).toBe(false);
      expect(covers(a, 90, 90)).toBe(false);
      // About the share of the map south of the shore
      expect(a.area).toBeGreaterThan(200 * 100);
      expect(a.area).toBeLessThan(200 * 125);
    }
  });

  it('lays a map wholly inside a lake under water but for its island, with or without a shore in the answer', () => {
    const island = [{ x: -30, y: -20 }, { x: 40, y: -25 }, { x: 35, y: 30 }, { x: -25, y: 25 }];
    const islandArea = Math.abs(ringArea(island));
    const shoreFar = [{ x: -5000, y: -5000 }, { x: 5000, y: -5000 }, { x: 5000, y: 5000 }, { x: -5000, y: 5000 }, { x: -5000, y: -5000 }];
    // The shore runs through the margin west of the map, the lake east of it: only the island tells
    const shoreNear = [{ x: -150, y: -5000 }, { x: -150, y: -300 }, { x: -150, y: -150 }, { x: -160, y: 0 }, { x: -150, y: 150 }, { x: -150, y: 300 }, { x: -150, y: 5000 }, { x: 5000, y: 5000 }, { x: 5000, y: -5000 }, { x: -150, y: -5000 }];
    for (const shore of [shoreFar, shoreNear]) {
      const id = nextId++;
      const lake: OverpassElement = {
        type: 'relation',
        id,
        tags: { type: 'multipolygon', natural: 'water', water: 'lake' },
        members: [member(shore, 'outer'), member([...island, island[0]], 'inner')],
      };
      const a = areaOf([lake], id)!;
      expect(a.area).toBeCloseTo(200 * 200 - islandArea, 0);
      expect(a.inner).toHaveLength(1);
      expect(covers(a, 0, 0)).toBe(false);
      expect(covers(a, -90, 90)).toBe(true);
    }
  });

  it('puts a ring together from several ways cut by the box, some drawn the other way', () => {
    // A lake reaching into the map from the south, its shore in three ways; the middle one runs backwards
    const w1 = [{ x: -600, y: -150 }, { x: -250, y: -150 }, { x: -60, y: -120 }, { x: -60, y: 0 }];
    const w2 = [{ x: 60, y: 0 }, { x: 0, y: 40 }, { x: -60, y: 0 }];
    const w3 = [{ x: 60, y: 0 }, { x: 60, y: -120 }, { x: 250, y: -150 }, { x: 600, y: -150 }, { x: 600, y: -900 }, { x: -600, y: -900 }, { x: -600, y: -150 }];
    const id = nextId++;
    const lake: OverpassElement = {
      type: 'relation',
      id,
      tags: { type: 'multipolygon', natural: 'water', water: 'lake' },
      members: [member(w1, 'outer'), member(w2, 'outer'), member(w3, 'outer')],
    };
    const data: OverpassResponse = { elements: [lake] };
    const f = parseOsm(data, frame, HALF);
    const a = f.areas.find((x) => x.id === id)!;
    expect(f.stats.forcedRings).toBe(0);
    expect(f.stats.cutAreas).toBe(1);
    expect(covers(a, 0, -50)).toBe(true);
    expect(covers(a, 0, 20)).toBe(true);
    expect(covers(a, -90, 0)).toBe(false);
    expect(covers(a, 0, 60)).toBe(false);
    // The bay inside the map: 120 m wide from the south edge up to y = 0, the round top above, no diagonal across
    expect(a.area).toBeGreaterThan(120 * 100);
    expect(a.area).toBeLessThan(120 * 100 + 120 * 40);
  });

  it('closes a corner cut by a lake round that corner: the island sets the side, a field poking in is the corner', () => {
    // The lake covers the map but its north-east corner, its ring reaching kilometres past the box
    const lake = [
      { x: -3000, y: -3000 }, { x: 3000, y: -3000 }, { x: 3000, y: 50 }, { x: 300, y: 50 }, { x: 150, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 150 },
      { x: 50, y: 300 }, { x: 50, y: 3000 }, { x: -3000, y: 3000 },
    ];
    const island = [{ x: -40, y: -40 }, { x: -20, y: -40 }, { x: -20, y: -20 }, { x: -40, y: -20 }];
    const id = nextId++;
    const rel: OverpassElement = {
      type: 'relation',
      id,
      tags: { type: 'multipolygon', natural: 'water', water: 'lake' },
      members: [member([...lake, lake[0]], 'outer'), member([...island, island[0]], 'inner')],
    };
    const a = areaOf([rel], id)!;
    expect(a.area).toBeCloseTo(200 * 200 - 50 * 50 - 20 * 20, 0);
    expect(covers(a, 90, 90)).toBe(false);
    expect(covers(a, 90, -90)).toBe(true);
    expect(covers(a, -90, 90)).toBe(true);
    // A field whose ring crosses the same corner and lies mostly outside the map: the corner alone
    const field = closedWay([{ x: 50, y: 150 }, { x: 50, y: 50 }, { x: 150, y: 50 }, { x: 300, y: 50 }, { x: 900, y: 50 }, { x: 900, y: 900 }, { x: 50, y: 900 }, { x: 50, y: 300 }], { landuse: 'farmland' });
    const f = areaOf([field], field.id)!;
    expect(f.area).toBeCloseTo(50 * 50, 0);
    expect(covers(f, 90, 90)).toBe(true);
  });

  it('drops an area whose cut ring stays in the margin', () => {
    const wood = closedWay([{ x: 120, y: -500 }, { x: 150, y: -150 }, { x: 160, y: 0 }, { x: 150, y: 150 }, { x: 120, y: 500 }, { x: 900, y: 500 }, { x: 900, y: -500 }], { landuse: 'forest' });
    const data: OverpassResponse = { elements: [wood] };
    const f = parseOsm(data, frame, HALF);
    expect(f.areas).toEqual([]);
    expect(f.stats.areasOutside).toBe(1);
  });
});

describe('a lake larger than the map (frozen probe Lindau)', () => {
  // src/app/integration/fixtures/osm/README.md: the Bodensee as the answer of a 2.4 km world brought it, and the buildings
  const probe = JSON.parse(gunzipSync(readFileSync(join(__dirname, '../../integration/fixtures/osm/world-lindau-lake.overpass.json.gz'))).toString('utf8'));
  const lindau = new OsmFrame(probe.place.lat, probe.place.lon);

  it('lays the lake around the island, under the water south of it and between it and the shore, the town dry', () => {
    const f = parseOsm({ elements: probe.elements }, lindau, 1200);
    const lake = f.areas.find((a) => a.tags['name'] === 'Bodensee')!;
    const at = (lat: number, lon: number) => {
      const p = lindau.point({ lat, lon });
      return insideRings(p, [...lake.outer, ...lake.inner]);
    };
    // Open water south and west of the island, the Kleiner See between island and mainland
    expect(at(47.5375, 9.6800)).toBe(true);
    expect(at(47.5400, 9.6990)).toBe(true);
    expect(at(47.55, 9.6856)).toBe(true);
    // The old town on the island, Reutin on the mainland
    expect(at(47.5450, 9.6850)).toBe(false);
    expect(at(47.5560, 9.7000)).toBe(false);
    // Most of the square is lake
    expect(lake.area).toBeGreaterThan(0.5 * 2400 * 2400);
    expect(lake.area).toBeLessThan(0.85 * 2400 * 2400);
  });
});
