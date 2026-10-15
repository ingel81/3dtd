/**
 * The one Overpass query of an OSM world: everything the map is made of in
 * the map's square plus a margin, ways and multipolygon relations with their
 * geometry cut at the box (`out body geom(<box>)`), and the tagged points
 * (trees, lamps, benches). When the server runs into its memory or time
 * limit (`remark`), the box is asked again in four quarters and the answers
 * are merged. docs/OSM_WORLD_PLAN.md
 */
import { boxAround, type GeoBox } from '../../services/location/street-box';
import { fetchOverpass, type OverpassElement, type OverpassLimits, type OverpassResponse } from './overpass-client';

/** Keys whose ways and multipolygons the world reads */
const WAY_KEYS = [
  'highway', 'building', 'landuse', 'natural', 'leisure', 'waterway', 'water', 'railway', 'barrier', 'man_made',
  'amenity', 'power',
] as const;

/** Tagged points the world reads */
const NODE_FILTERS = [
  '["natural"="tree"]',
  '["highway"~"^(street_lamp|bus_stop)$"]',
  '["barrier"]',
  '["man_made"]',
  '["amenity"~"^(bench|waste_basket|fountain)$"]',
  '["emergency"="fire_hydrant"]',
  '["power"~"^(tower|pole)$"]',
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

const fixed = (v: number): string => v.toFixed(6);

/** The box as Overpass writes it: south, west, north, east */
function boxText(box: GeoBox): string {
  return `${fixed(box.minLat)},${fixed(box.minLon)},${fixed(box.maxLat)},${fixed(box.maxLon)}`;
}

/** The Overpass QL of the world's query for `box` */
export function osmWorldQuery(box: GeoBox): string {
  const b = boxText(box);
  const ways = WAY_KEYS.map((key) => `way["${key}"];`).join('\n  ');
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
 * limits is asked again in four quarters (once, not deeper). Rejects when no
 * server answers.
 */
export async function downloadOsm(box: GeoBox, signal?: AbortSignal): Promise<OsmDownload> {
  const start = performance.now();
  let chars = 0;
  const ask = (b: GeoBox, what: string) =>
    fetchOverpass({
      what,
      query: osmWorldQuery(b),
      limits: OSM_QUERY_LIMITS,
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
