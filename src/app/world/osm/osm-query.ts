/**
 * The one Overpass query of an OSM world: everything the map is made of in
 * the map's square plus a margin, ways and multipolygon relations with their
 * geometry cut at the box (`out body geom(<box>)`), and the tagged points
 * (trees, lamps, benches, shops, stations). When the server runs into its memory or time
 * limit (`remark`), the box is asked again in four quarters and the answers
 * are merged. docs/OSM_WORLD_PLAN.md
 */
import { boxAround, type GeoBox } from '../../services/location/street-box';
import {
  fetchOverpass,
  type OverpassElement,
  type OverpassLimits,
  type OverpassResponse,
  type OverpassRetry,
  type OverpassRetryPolicy,
} from './overpass-client';

/**
 * Version of the query: part of a stored frame's key (osm-frame-store.ts),
 * so a frame kept from an older query is downloaded again and has what the
 * world reads now. Raise it whenever the query asks for more.
 */
export const OSM_QUERY_VERSION = 3;

/**
 * Ways and multipolygons the world reads, by key: the land, water, roads and
 * buildings, and the places people go (shops, inns, offices, sights; round 2,
 * docs/OSM_WORLD_ROUND2_PLAN.md), also where they are a building or an area
 * without `building`, and paved squares drawn as areas (`area:highway`)
 */
const WAY_KEYS = [
  'highway', 'building', 'landuse', 'natural', 'leisure', 'waterway', 'water', 'railway', 'barrier', 'man_made',
  'amenity', 'power', 'shop', 'tourism', 'historic', 'craft', 'office', 'healthcare', 'area:highway',
] as const;

/** Ways asked for by key and value */
const WAY_FILTERS = ['["place"="square"]'] as const;

/** `amenity` values of the points the world reads: the street's furniture and the places people go */
const POINT_AMENITIES = [
  'bench', 'waste_basket', 'fountain', 'drinking_water', 'bicycle_parking', 'restaurant', 'cafe', 'fast_food', 'pub',
  'bar', 'biergarten', 'ice_cream', 'bank', 'pharmacy', 'fuel', 'place_of_worship', 'townhall', 'post_office',
  'marketplace', 'clock', 'post_box', 'telephone', 'toilets', 'shelter', 'recycling', 'charging_station',
  'bicycle_rental', 'cinema', 'theatre', 'library', 'police', 'fire_station', 'school', 'kindergarten', 'doctors',
  'dentist',
] as const;

/**
 * Tagged points the world reads. Not every `amenity` (parking spaces,
 * vending machines and car park entrances are most of them in a city and
 * show nothing), and no memorial stones set into the pavement
 * (`memorial=stolperstein`): the world puts nothing there.
 */
const NODE_FILTERS = [
  '["natural"="tree"]',
  '["highway"~"^(street_lamp|bus_stop|crossing|traffic_signals)$"]',
  '["barrier"]',
  '["man_made"]',
  `["amenity"~"^(${POINT_AMENITIES.join('|')})$"]`,
  '["emergency"="fire_hydrant"]',
  '["power"~"^(tower|pole)$"]',
  '["railway"~"^(buffer_stop|level_crossing|crossing|station|halt|tram_stop)$"]',
  '["public_transport"="station"]',
  '["shop"]',
  '["tourism"]',
  '["historic"]["memorial"!="stolperstein"]',
  '["craft"]',
  '["office"]',
  '["healthcare"]',
  '["leisure"~"^(picnic_table|outdoor_seating|fitness_station|playground|bandstand)$"]',
  '["playground"]',
  '["seamark:type"]',
  '["waterway"~"^(lock_gate|weir|dam)$"]',
  '["advertising"~"^(column|billboard)$"]',
] as const;

/**
 * Server memory the query may take, bytes. A city centre answered with 15 MB
 * of JSON (Stuttgart Mitte, docs/OSM_WORLD_PLAN.md); the street loads' 4 MB
 * would end it with a remark.
 */
const OSM_QUERY_MAXSIZE = 256 * 1024 * 1024;

/** Seconds the server may run the query */
const OSM_QUERY_TIMEOUT_S = 90;

/**
 * Limits of the world's query: the server starts its answer once it has run
 * the query (up to OSM_QUERY_TIMEOUT_S), and the body of a city centre is
 * 15 MB
 */
export const OSM_QUERY_LIMITS: OverpassLimits = {
  headerTimeoutMs: (OSM_QUERY_TIMEOUT_S + 15) * 1000,
  bodyTimeoutMs: 60_000,
  hedgeMs: 8000,
};

/**
 * Retries of the world's query: six rounds within 3.5 min, waits of about
 * 3, 6, 12 and then 22 s. Fewer than the street loads' within a longer
 * budget, as a round of this query may take long by itself (a city centre's
 * answer)
 */
export const OSM_QUERY_RETRY: OverpassRetryPolicy = { rounds: 6, budgetMs: 210_000, baseDelayMs: 4000, maxDelayMs: 30_000 };

const fixed = (v: number): string => v.toFixed(6);

/** The box as Overpass writes it: south, west, north, east */
function boxText(box: GeoBox): string {
  return `${fixed(box.minLat)},${fixed(box.minLon)},${fixed(box.maxLat)},${fixed(box.maxLon)}`;
}

/** The Overpass QL of the world's query for `box` */
export function osmWorldQuery(box: GeoBox): string {
  const b = boxText(box);
  const ways = [...WAY_KEYS.map((key) => `["${key}"]`), ...WAY_FILTERS].map((filter) => `way${filter};`).join('\n  ');
  const nodes = NODE_FILTERS.map((filter) => `node${filter};`).join('\n  ');
  return `[out:json][timeout:${OSM_QUERY_TIMEOUT_S}][maxsize:${OSM_QUERY_MAXSIZE}][bbox:${b}];
(
  ${ways}
  relation["type"="multipolygon"];
  ${nodes}
);
out body geom(${b});`;
}

/** The query's box: the map's square of `sideM` around the centre plus `marginM` on every side */
export function osmQueryBox(lat: number, lon: number, sideM: number, marginM: number): GeoBox {
  return boxAround(lat, lon, sideM / 2 + marginM);
}

/** The four quarters of a box */
export function quarters(box: GeoBox): GeoBox[] {
  const midLat = (box.minLat + box.maxLat) / 2;
  const midLon = (box.minLon + box.maxLon) / 2;
  return [
    { minLat: box.minLat, maxLat: midLat, minLon: box.minLon, maxLon: midLon },
    { minLat: box.minLat, maxLat: midLat, minLon: midLon, maxLon: box.maxLon },
    { minLat: midLat, maxLat: box.maxLat, minLon: box.minLon, maxLon: midLon },
    { minLat: midLat, maxLat: box.maxLat, minLon: midLon, maxLon: box.maxLon },
  ];
}

/** A remark that says the answer is cut short (memory, time), not a mere note */
export function answerCutShort(remark: string | undefined): boolean {
  return !!remark && /out of memory|timed out|timeout/i.test(remark);
}

type Geometry = NonNullable<OverpassElement['geometry']>;

/**
 * The points two cut answers have of one way, merged: each node's point from
 * whichever answer has it (an answer cut at its box leaves the nodes outside
 * it null). Geometry not aligned with the node list (a way without one) keeps
 * the longer.
 */
function mergeGeometry(a: Geometry | undefined, b: Geometry | undefined): Geometry | undefined {
  if (!a || !b) return a ?? b;
  if (a.length !== b.length) return a.filter(Boolean).length >= b.filter(Boolean).length ? a : b;
  return a.map((p, k) => p ?? b[k]);
}

/**
 * Several answers for adjacent boxes as one: every element once, a way or
 * relation cut by the boxes with the points of all of them (mergeGeometry).
 * Members of a relation merge the same way, by their index.
 */
export function mergeAnswers(answers: readonly OverpassResponse[]): OverpassResponse {
  const byKey = new Map<string, OverpassElement>();
  for (const answer of answers) {
    for (const element of answer.elements) {
      const key = `${element.type}/${element.id}`;
      const known = byKey.get(key);
      if (!known) {
        byKey.set(key, {
          ...element,
          ...(element.members ? { members: element.members.map((m) => ({ ...m })) } : {}),
        });
        continue;
      }
      known.geometry = mergeGeometry(known.geometry, element.geometry);
      if (known.members && element.members && known.members.length === element.members.length) {
        known.members.forEach((m, k) => (m.geometry = mergeGeometry(m.geometry, element.members![k].geometry)));
      }
    }
  }
  return { elements: [...byKey.values()] };
}

/** One answer of the world's query, with what it took */
export interface OsmDownload {
  data: OverpassResponse;
  /** JSON characters received, all requests together */
  chars: number;
  /** Requests sent: 1, or 5 when the box had to be split */
  requests: number;
  ms: number;
}

/**
 * Asks the world's query for `box`; an answer cut short by the server's
 * limits is asked again in four quarters (once, not deeper). Busy servers
 * are asked again (OSM_QUERY_RETRY), `onRetry` hears each round about to be
 * asked again, `onBytes` the bytes received so far, `onAsk` each server as
 * it is asked. Rejects when no server answers.
 */
export async function downloadOsm(
  box: GeoBox,
  signal?: AbortSignal,
  onRetry?: (retry: OverpassRetry) => void,
  onBytes?: (bytes: number) => void,
  onAsk?: (host: string) => void,
): Promise<OsmDownload> {
  const start = performance.now();
  let chars = 0;
  const ask = (b: GeoBox, what: string) =>
    fetchOverpass({
      what,
      query: osmWorldQuery(b),
      box: b,
      limits: OSM_QUERY_LIMITS,
      retry: OSM_QUERY_RETRY,
      onRetry,
      // The bytes of all requests together (four quarters after a cut answer)
      onBytes: onBytes && ((bytes) => onBytes(chars + bytes)),
      onAsk,
      signal,
      accept: (data, length) => {
        chars += length;
        return data;
      },
    });
  const whole = await ask(box, 'world');
  if (!answerCutShort(whole.remark)) return { data: whole, chars, requests: 1, ms: performance.now() - start };
  const parts: OverpassResponse[] = [];
  // One quarter after the other: the servers give an IP few slots
  for (const [k, quarter] of quarters(box).entries()) {
    const part = await ask(quarter, `world quarter ${k + 1}`);
    if (answerCutShort(part.remark)) throw new Error(`The OSM server could not answer for this place (${part.remark})`);
    parts.push(part);
  }
  return { data: mergeAnswers(parts), chars, requests: 5, ms: performance.now() - start };
}
