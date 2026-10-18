/**
 * Boxes on the planet as the proxy measures them: edges and areas in km on a
 * sphere, good to a few percent for the boxes of a few km it deals with.
 */

/** South, west, north, east in degrees, as Overpass writes a box */
export interface Box {
  s: number;
  w: number;
  n: number;
  e: number;
}

const KM_PER_DEGREE = 111.32;
const RAD = Math.PI / 180;

/** The latitude of the box nearest the equator, where it is widest */
const widestLat = (box: Box): number => (box.s <= 0 && box.n >= 0 ? 0 : Math.min(Math.abs(box.s), Math.abs(box.n)));

/** Width of the box in degrees of longitude; a box with west east of east crosses the date line */
const lonSpan = (box: Box): number => (box.e >= box.w ? box.e - box.w : box.e + 360 - box.w);

/** The box's edges, km: north to south, and west to east at its widest */
export function boxEdgesKm(box: Box): { ns: number; ew: number } {
  return {
    ns: (box.n - box.s) * KM_PER_DEGREE,
    ew: lonSpan(box) * KM_PER_DEGREE * Math.cos(widestLat(box) * RAD),
  };
}

/** The box's area, km² */
export function boxAreaKm2(box: Box): number {
  const meanLat = ((box.s + box.n) / 2) * RAD;
  return (box.n - box.s) * KM_PER_DEGREE * lonSpan(box) * KM_PER_DEGREE * Math.cos(meanLat);
}

/** Distance between two points, km (flat around their middle, fine for the few km here) */
function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * RAD);
  return Math.hypot(x, b.lat - a.lat) * KM_PER_DEGREE;
}

/**
 * What `around:<radius>,<points>` reads: the envelope of the points widened
 * by the radius, and the area of the band it sweeps along the line through
 * them (a disc at each end), at most the envelope's area. The buildings of
 * the game ask `around` the routes, a band of 50 m along a few km, whose
 * envelope is a few km² while it reads a fraction of that.
 */
export function aroundAreaKm2(points: readonly { lat: number; lon: number }[], radiusM: number): { box: Box; areaKm2: number } {
  let s = 90, n = -90, w = 180, e = -180;
  for (const p of points) {
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
  }
  const rKm = radiusM / 1000;
  const dLat = rKm / KM_PER_DEGREE;
  const edgeLat = Math.min(89.9, Math.max(Math.abs(s), Math.abs(n)) + dLat);
  const dLon = Math.min(180, rKm / (KM_PER_DEGREE * Math.cos(edgeLat * RAD)));
  const box: Box = {
    s: Math.max(-90, s - dLat),
    n: Math.min(90, n + dLat),
    w: Math.max(-180, w - dLon),
    e: Math.min(180, e + dLon),
  };
  let length = 0;
  for (let k = 1; k < points.length; k++) length += distanceKm(points[k - 1], points[k]);
  const band = 2 * rKm * length + Math.PI * rKm * rKm;
  return { box, areaKm2: Math.min(band, boxAreaKm2(box)) };
}
