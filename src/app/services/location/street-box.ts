import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import type { Street, StreetNetwork, StreetNode } from './osm-street.service';

/** A box in degrees, as StreetNetwork.bounds and an Overpass bbox. */
export type GeoBox = StreetNetwork['bounds'];

/** The box `radiusMeters` north, south, east and west of a point, as loadStreets asks Overpass for it. */
export function boxAround(lat: number, lon: number, radiusMeters: number): GeoBox {
  const latDelta = radiusMeters / METERS_PER_DEGREE_LAT;
  const lonDelta = radiusMeters / (METERS_PER_DEGREE_LAT * Math.cos(lat * DEG_TO_RAD));
  return { minLat: lat - latDelta, maxLat: lat + latDelta, minLon: lon - lonDelta, maxLon: lon + lonDelta };
}

/** Area of a box in km², for the log. */
export function boxAreaKm2(box: GeoBox): number {
  const midLat = (box.minLat + box.maxLat) / 2;
  const height = (box.maxLat - box.minLat) * METERS_PER_DEGREE_LAT;
  const width = (box.maxLon - box.minLon) * METERS_PER_DEGREE_LAT * Math.cos(midLat * DEG_TO_RAD);
  return (height * width) / 1e6;
}

/** Whether two boxes share more than an edge. */
export function boxesOverlap(a: GeoBox, b: GeoBox): boolean {
  return a.minLat < b.maxLat && b.minLat < a.maxLat && a.minLon < b.maxLon && b.minLon < a.maxLon;
}

/**
 * What of `box` lies outside `cut`, as up to four boxes: the strips south
 * and north of `cut` over the whole width of `box`, and between them the
 * strips west and east of it. Empty when `cut` covers `box`, `[box]` when
 * they do not overlap. Neighbouring strips share an edge.
 */
export function boxMinus(box: GeoBox, cut: GeoBox): GeoBox[] {
  if (!boxesOverlap(box, cut)) return [box];
  const minLat = Math.max(box.minLat, cut.minLat);
  const maxLat = Math.min(box.maxLat, cut.maxLat);
  const parts: GeoBox[] = [];
  if (box.minLat < minLat) parts.push({ ...box, maxLat: minLat });
  if (maxLat < box.maxLat) parts.push({ ...box, minLat: maxLat });
  if (box.minLon < cut.minLon) parts.push({ minLat, maxLat, minLon: box.minLon, maxLon: cut.minLon });
  if (cut.maxLon < box.maxLon) parts.push({ minLat, maxLat, minLon: cut.maxLon, maxLon: box.maxLon });
  return parts;
}

/**
 * Whether the segment from `a` to `b` touches `box`, in degrees
 * (Liang-Barsky: cut the segment down to the side of each edge the box is
 * on; it touches the box if something is left).
 */
function segmentTouchesBox(a: StreetNode, b: StreetNode, box: GeoBox): boolean {
  const dLon = b.lon - a.lon;
  const dLat = b.lat - a.lat;
  // Per edge: the step towards its outside and how far inside `a` is.
  const edges: [number, number][] = [
    [-dLon, a.lon - box.minLon],
    [dLon, box.maxLon - a.lon],
    [-dLat, a.lat - box.minLat],
    [dLat, box.maxLat - a.lat],
  ];
  let t0 = 0;
  let t1 = 1;
  for (const [step, inside] of edges) {
    if (step === 0) {
      if (inside < 0) return false;
      continue;
    }
    const t = inside / step;
    if (step < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

/** Whether a way runs through `box`: one of its segments touches it, a way that only crosses it included. */
export function wayTouchesBox(nodes: readonly StreetNode[], box: GeoBox): boolean {
  for (let i = 1; i < nodes.length; i++) {
    if (segmentTouchesBox(nodes[i - 1], nodes[i], box)) return true;
  }
  return false;
}

/**
 * The streets of `box`, put together from the ways of `kept` that run
 * through it and all ways of `fetched`, which Overpass sent for the rest
 * of the box. A way in both is taken once, as `fetched` has it. Ordered by
 * id, as Overpass lists ways; the nodes are those the ways use.
 */
export function mergeStreets(kept: StreetNetwork, fetched: StreetNetwork | null, box: GeoBox): StreetNetwork {
  const byId = new Map<number, Street>();
  for (const street of kept.streets) {
    if (wayTouchesBox(street.nodes, box)) byId.set(street.id, street);
  }
  for (const street of fetched?.streets ?? []) byId.set(street.id, street);
  const streets = [...byId.values()].sort((a, b) => a.id - b.id);
  const nodes = new Map<number, StreetNode>();
  for (const street of streets) {
    for (const node of street.nodes) nodes.set(node.id, node);
  }
  return { streets, nodes, bounds: box };
}
