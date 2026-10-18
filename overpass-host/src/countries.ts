/**
 * The country a point lies in, from Natural Earth's 1:50m borders
 * (countries.txt): good to a kilometre or two at a border, enough to name the
 * country of a place asked for. Outer rings only; where two contain the point
 * (an enclave such as San Marino in Italy) the smaller ring wins. Loaded once,
 * on the first question.
 */
import { readFileSync } from 'node:fs';

interface Ring {
  code: string;
  /** Longitude, latitude, ... in degrees */
  points: Float64Array;
  s: number;
  w: number;
  n: number;
  e: number;
  area: number;
}

let rings: Ring[] | null = null;

function load(): Ring[] {
  const text = readFileSync(new URL('./countries.txt', import.meta.url), 'utf8');
  const out: Ring[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    const code = line.slice(0, colon);
    for (const part of line.slice(colon + 1).split('|')) {
      const steps = part.split(',').map(Number);
      const points = new Float64Array(steps.length);
      let lon = 0, lat = 0, s = 90, n = -90, w = 180, e = -180, area = 0;
      for (let k = 0; k < steps.length; k += 2) {
        lon += steps[k];
        lat += steps[k + 1];
        points[k] = lon / 100;
        points[k + 1] = lat / 100;
        s = Math.min(s, points[k + 1]);
        n = Math.max(n, points[k + 1]);
        w = Math.min(w, points[k]);
        e = Math.max(e, points[k]);
        if (k >= 2) area += points[k - 2] * points[k + 1] - points[k] * points[k - 1];
      }
      out.push({ code, points, s, w, n, e, area: Math.abs(area / 2) });
    }
  }
  return out;
}

function inside(ring: Ring, lon: number, lat: number): boolean {
  const p = ring.points;
  let hit = false;
  for (let k = 0, j = p.length - 2; k < p.length; j = k, k += 2) {
    const yi = p[k + 1], yj = p[j + 1];
    if (yi > lat !== yj > lat && lon < ((p[j] - p[k]) * (lat - yi)) / (yj - yi) + p[k]) hit = !hit;
  }
  return hit;
}

/** The country code at a point, or null at sea and where the data has none */
export function countryAt(lat: number, lon: number): string | null {
  rings ??= load();
  let best: Ring | null = null;
  for (const ring of rings) {
    if (lat < ring.s || lat > ring.n || lon < ring.w || lon > ring.e) continue;
    if ((!best || ring.area < best.area) && inside(ring, lon, lat)) best = ring;
  }
  return best?.code ?? null;
}
