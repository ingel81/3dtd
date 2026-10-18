// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { osmQueryBox, osmWorldQuery } from '../../src/app/world/osm/osm-query.ts';
import { OSM_QUERY_MARGIN, OSM_WORLD_SIDE } from '../../src/app/world/osm/import-osm.ts';
import { boxAround } from '../../src/app/services/location/street-box.ts';

/** STREET_RADIUS_M of osm-street.service.ts (an Angular service, not imported here) */
const STREET_RADIUS_M = 2000;
import { analyzeQuery, anchorArea, anchorHull, capSettings, QlError, tokenize } from './ql.ts';
import { boxEdgesKm } from './geo.ts';

const LIMITS = { maxEdgeKm: 5, maxAreaKm2: 30 };
const CAPS = { timeoutS: 90, maxsizeBytes: 256 * 1024 * 1024 };

/** The street query of osm-street.service.ts (streetQuery), as the game sends it */
function streetQuery(boxes: { minLat: number; minLon: number; maxLat: number; maxLon: number }[]): string {
  const types = 'motorway|motorway_link|trunk|primary|residential|service|footway|path|steps';
  const ways = boxes.map((b) => `way["highway"~"^(${types})$"](${b.minLat},${b.minLon},${b.maxLat},${b.maxLon});`).join('\n        ');
  return `
      [out:json][timeout:25][maxsize:4194304];
      (
        ${ways}
      );
      out body;
      >;
      out skel qt;
    `;
}

/** The building query of osm-street.service.ts (loadBuildingsNearRoutes), `around` the routes */
function buildingQuery(routes: { lat: number; lon: number }[][], radius: number): string {
  const ways = routes
    .map((line) => `way["building"](around:${radius},${line.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join(',')});`)
    .join('\n        ');
  return `
      [out:json][timeout:25][maxsize:4194304];
      (
        ${ways}
      );
      out body;
      >;
      out skel qt;
    `;
}

/** A route of `n` points from the centre outwards over `km` */
const route = (lat: number, lon: number, km: number, n: number, dLat: number, dLon: number) =>
  Array.from({ length: n }, (_, k) => ({ lat: lat + (dLat * km * k) / n / 111.32, lon: lon + (dLon * km * k) / n / 111.32 / Math.cos((lat * Math.PI) / 180) }));

describe('tokenize', () => {
  it('keeps strings whole and drops comments', () => {
    const tokens = tokenize('// way["x"];\nway["name"="a;b"](1,2,3,4); /* area */ out;');
    expect(tokens.map((t) => t.text)).toEqual(['way', '[', '"name"', '=', '"a;b"', ']', '(', '1', ',', '2', ',', '3', ',', '4', ')', ';', 'out', ';']);
  });

  it('reads signed numbers, set names and the arrow', () => {
    expect(tokenize('(-33.9,151.2)->.a;').map((t) => t.text)).toEqual(['(', '-33.9', ',', '151.2', ')', '->', '.a', ';']);
  });

  it('throws on a string or comment without its end', () => {
    expect(() => tokenize('way["x];')).toThrow(QlError);
    expect(() => tokenize('/* way')).toThrow(QlError);
  });
});

describe('the game\'s queries', () => {
  it('takes the street load of a real place: one box of 4 km', () => {
    const b = boxAround(49.79, 9.95, STREET_RADIUS_M);
    const a = analyzeQuery(streetQuery([b]), LIMITS);
    expect(a.refusal).toBeNull();
    expect(a.anchors).toHaveLength(1);
    expect(a.settings).toMatchObject({ timeoutS: 25, maxsizeBytes: 4194304 });
    const edges = boxEdgesKm(anchorHull(a.anchors)!);
    expect(edges.ns).toBeCloseTo(4, 1);
    expect(edges.ew).toBeCloseTo(4, 1);
  });

  it('takes a street load of the boxes missing next to the streets loaded before', () => {
    const b = boxAround(49.79, 9.95, STREET_RADIUS_M);
    const east = { ...b, minLon: b.maxLon - 0.01, maxLon: b.maxLon + 0.01 };
    const north = { ...b, minLat: b.maxLat - 0.005, maxLat: b.maxLat + 0.005 };
    expect(analyzeQuery(streetQuery([east, north]), LIMITS)).toMatchObject({ refusal: null, anchors: [{ kind: 'box' }, { kind: 'box' }] });
  });

  it('takes the OSM world query: the global bbox of 2.6 km, 90 s and 256 MB', () => {
    const query = osmWorldQuery(osmQueryBox(48.7758, 9.1829, OSM_WORLD_SIDE, OSM_QUERY_MARGIN));
    const a = analyzeQuery(query, LIMITS);
    expect(a.refusal).toBeNull();
    expect(a.settings).toMatchObject({ timeoutS: 90, maxsizeBytes: 256 * 1024 * 1024 });
    expect(a.anchors).toHaveLength(1);
    expect(boxEdgesKm(anchorHull(a.anchors)!).ns).toBeCloseTo(2.6, 1);
    const capped = capSettings(query, a.settings, CAPS).query;
    expect(capped).toMatch(/^\[out:json\]\[bbox:[^\]]+\]\[timeout:90\]\[maxsize:268435456\];/);
    expect(capped.slice(capped.indexOf(';'))).toBe(query.slice(query.indexOf(';')));
  });

  it('takes the buildings around six routes of 2 km: their band, not their envelopes', () => {
    const routes = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]].map(([dLat, dLon]) => route(49.79, 9.95, 2, 120, dLat, dLon));
    const a = analyzeQuery(buildingQuery(routes, 25), LIMITS);
    expect(a.refusal).toBeNull();
    expect(a.anchors).toHaveLength(6);
    // 6 bands of 2 km x 50 m, and the discs at their ends
    expect(anchorArea(a.anchors)).toBeGreaterThan(0.55);
    expect(anchorArea(a.anchors)).toBeLessThan(0.7);
  });
});

describe('what is refused', () => {
  const refusal = (query: string) => analyzeQuery(query, LIMITS).refusal?.code ?? null;

  it('a statement without a box', () => {
    expect(refusal('[out:json];way["highway"];out;')).toBe('unbounded');
    expect(refusal('nwr[amenity](if: t["x"] == "1"); out;')).toBe('unbounded');
    expect(refusal('(node(49,9,49.01,9.01); way["building"];); out;')).toBe('unbounded');
  });

  it('areas, which the host does not have', () => {
    expect(refusal('[out:json];area[name="Deutschland"];way(area)[highway];out;')).toBe('area');
    expect(refusal('way(pivot.a);out;')).toBe('area');
    expect(refusal('is_in(49.7,9.9);out;')).toBe('area');
  });

  it('a box larger than the edge, or boxes larger together than the area', () => {
    expect(refusal('way(49.0,9.0,49.1,9.1);out;')).toBe('too-large');
    const box = (lat: number) => `(${lat},9.9,${lat + 0.04},9.96)`;
    expect(refusal(`(way${box(49.7)};way${box(49.8)};);out;`)).toBe('too-large');
    expect(refusal('[bbox:48,9,49,10];way["highway"];out;')).toBe('too-large');
    expect(refusal('node(49.7,9.9,49.71,9.91);way(around:3000);out;')).toBe('too-large');
  });

  it('history, XML and filters that are no filters', () => {
    expect(refusal('[date:"2020-01-01T00:00:00Z"];way(49.7,9.9,49.71,9.91);out;')).toBe('history');
    expect(refusal('<osm-script><query type="way"/></osm-script>')).toBe('xml');
    expect(refusal('way(49.71,9.9,49.7,9.91);out;')).toBe('filter');
    expect(refusal('way(around:25,49.7);out;')).toBe('filter');
    expect(refusal('way(poly:"49 9 49.01");out;')).toBe('filter');
  });

  it('not what only looks like a refused word in a string or comment', () => {
    expect(refusal('// area\nway["name"="area"](49.7,9.9,49.71,9.91);out;')).toBeNull();
  });
});

describe('what is taken', () => {
  const taken = (query: string) => analyzeQuery(query, LIMITS).refusal;

  it('ids, input sets, recursion and blocks over a bounded start', () => {
    expect(taken('[out:json];node(1);out;')).toBeNull();
    expect(taken('way(id:1,2,3);out geom;')).toBeNull();
    expect(taken('rel(49.7,9.9,49.71,9.91)->.r; way(r.r:"outer"); node(w); out skel;')).toBeNull();
    expect(taken('way(49.7,9.9,49.71,9.91)->.a; foreach.a->.b { node(w.b); out; }')).toBeNull();
    expect(taken('way(49.7,9.9,49.71,9.91); foreach( out; );')).toBeNull();
    expect(taken('node(49.7,9.9,49.71,9.91); if (count(nodes) > 0) { way(bn); out; } else { out count; }')).toBeNull();
    expect(taken('way(49.7,9.9,49.71,9.91)->.a; node.a[amenity]; way(around.a:100); make stat n=count(ways); out;')).toBeNull();
    expect(taken('(way(49.7,9.9,49.71,9.91); - way[building](49.7,9.9,49.71,9.91);); out;')).toBeNull();
  });

  it('poly and the global bbox', () => {
    expect(taken('way(poly:"49.7 9.9 49.71 9.9 49.71 9.91")["highway"];out;')).toBeNull();
    expect(taken('[out:json][bbox:49.7,9.9,49.71,9.91];(way["highway"];node["natural"="tree"];);out geom;')).toBeNull();
  });

  it('settings with a csv output, whose parentheses and semicolon stay inside the brackets', () => {
    const a = analyzeQuery('[out:csv(::id, name; false)][timeout:10];node(1);out;', LIMITS);
    expect(a.refusal).toBeNull();
    expect(a.settings.others).toEqual(['[out:csv(::id, name; false)]']);
  });
});

describe('capSettings', () => {
  const cap = (query: string) => capSettings(query, analyzeQuery(query, LIMITS).settings, CAPS);

  it('puts the caps in front of a query without settings', () => {
    expect(cap('node(1);out;').query).toBe(`[timeout:90][maxsize:${CAPS.maxsizeBytes}];\nnode(1);out;`);
  });

  it('lowers a timeout or maxsize above the cap and keeps one below', () => {
    const high = cap('[out:json][timeout:1000][maxsize:2147483648];node(1);out;');
    expect(high).toMatchObject({ timeoutS: 90, maxsizeBytes: CAPS.maxsizeBytes });
    expect(high.query).toBe(`[out:json][timeout:90][maxsize:${CAPS.maxsizeBytes}];node(1);out;`);
    expect(cap('[timeout:25][maxsize:4194304][out:json];node(1);out;').query).toBe('[out:json][timeout:25][maxsize:4194304];node(1);out;');
  });

  it('adds the missing one', () => {
    expect(cap('[out:json][timeout:30];node(1);out;').query).toBe(`[out:json][timeout:30][maxsize:${CAPS.maxsizeBytes}];node(1);out;`);
  });
});
