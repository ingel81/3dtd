/**
 * Builds src/app/components/world-globe/world-outlines.data.ts, the coastlines
 * and land borders of the world map, from Natural Earth 1:110m.
 *
 * Source: Natural Earth, https://www.naturalearthdata.com, public domain
 * (https://www.naturalearthdata.com/about/terms-of-use/). The GeoJSON files
 * come from github.com/nvkelso/natural-earth-vector at tag NE_TAG:
 *   ne_110m_coastline                    Physical vectors, coastline
 *   ne_110m_admin_0_boundary_lines_land  Cultural vectors, land boundaries
 *
 *   node tools/world-outlines/build.mjs         downloads both files
 *   node tools/world-outlines/build.mjs <dir>   reads them from <dir>
 *
 * Every line is simplified (Douglas-Peucker, TOLERANCE_DEG), long segments
 * are split into steps of MAX_STEP_DEG (the globe draws straight chords, and
 * a border along a parallel such as 49 N must bend with it), then rounded to
 * 1 / FACTOR degree and written as an encoded polyline (Google's polyline
 * algorithm with FACTOR instead of 1e5, lat before lon): plain text, a
 * character or two per coordinate. decodePolyline() in globe-projection.ts
 * reads it back.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NE_TAG = 'v5.1.2';
const NE_BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_TAG}/geojson`;
const FILES = {
  coastlines: 'ne_110m_coastline.geojson',
  borders: 'ne_110m_admin_0_boundary_lines_land.geojson',
};
/** Simplification tolerance in degrees; 0.1 is about 11 km, under a pixel at the globe's default size */
const TOLERANCE_DEG = 0.1;
/** Longest segment in degrees after densifying */
const MAX_STEP_DEG = 2;
/** Coordinates are stored in steps of 1 / FACTOR degree */
const FACTOR = 10;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(root, 'src/app/components/world-globe/world-outlines.data.ts');

async function loadGeoJson(name, dir) {
  if (dir) return JSON.parse(await readFile(join(dir, name), 'utf8'));
  const res = await fetch(`${NE_BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

/** Every LineString of the collection as an array of [lon, lat] */
function linesOf(geojson) {
  const lines = [];
  for (const f of geojson.features) {
    const g = f.geometry;
    if (g.type === 'LineString') lines.push(g.coordinates);
    else if (g.type === 'MultiLineString') lines.push(...g.coordinates);
  }
  return lines;
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(points[i], points[first], points[last]);
      if (d > worst) { worst = d; index = i; }
    }
    if (worst > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Points added along every segment longer than maxStep degrees, straight in lon/lat */
function densify(points, maxStep) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [lon0, lat0] = points[i - 1];
    const [lon1, lat1] = points[i];
    const n = Math.ceil(Math.max(Math.abs(lon1 - lon0), Math.abs(lat1 - lat0)) / maxStep);
    for (let k = 1; k < n; k++) out.push([lon0 + ((lon1 - lon0) * k) / n, lat0 + ((lat1 - lat0) * k) / n]);
    out.push(points[i]);
  }
  return out;
}

/** Rounded to FACTOR steps as [lat, lon] integers, repeated points dropped */
function quantize(points) {
  const out = [];
  for (const [lon, lat] of points) {
    const q = [Math.round(lat * FACTOR), Math.round(lon * FACTOR)];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== q[0] || prev[1] !== q[1]) out.push(q);
  }
  return out;
}

function encodeValue(v) {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let s = '';
  while (n >= 0x20) {
    s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return s + String.fromCharCode(n + 63);
}

function encode(points) {
  let lat = 0;
  let lon = 0;
  let s = '';
  for (const [qlat, qlon] of points) {
    s += encodeValue(qlat - lat) + encodeValue(qlon - lon);
    lat = qlat;
    lon = qlon;
  }
  return s;
}

function build(lines) {
  let pointsIn = 0;
  let pointsOut = 0;
  const encoded = [];
  for (const line of lines) {
    pointsIn += line.length;
    const q = quantize(densify(simplify(line, TOLERANCE_DEG), MAX_STEP_DEG));
    if (q.length < 2) continue;
    pointsOut += q.length;
    encoded.push(encode(q));
  }
  return { encoded, pointsIn, pointsOut };
}

const dir = process.argv[2];
const coast = build(linesOf(await loadGeoJson(FILES.coastlines, dir)));
const borders = build(linesOf(await loadGeoJson(FILES.borders, dir)));

const list = (items) => items.map((s) => `  ${JSON.stringify(s)},`).join('\n');
const out = `// Generated by tools/world-outlines/build.mjs, do not edit by hand.
// Natural Earth 1:110m (${NE_TAG}), ne_110m_coastline and
// ne_110m_admin_0_boundary_lines_land. Public domain:
// https://www.naturalearthdata.com/about/terms-of-use/
// Encoded polylines, lat before lon, in steps of 1/${FACTOR} degree;
// decodePolyline() in globe-projection.ts reads them.

/** Degrees per stored step is 1 / OUTLINE_FACTOR */
export const OUTLINE_FACTOR = ${FACTOR};

/** Coastlines, ${coast.encoded.length} lines, ${coast.pointsOut} points */
export const COASTLINES: readonly string[] = [
${list(coast.encoded)}
];

/** Land borders between countries, ${borders.encoded.length} lines, ${borders.pointsOut} points */
export const BORDERS: readonly string[] = [
${list(borders.encoded)}
];
`;
await writeFile(OUT, out);
console.log(`coastlines: ${coast.pointsIn} -> ${coast.pointsOut} points, ${coast.encoded.length} lines`);
console.log(`borders:    ${borders.pointsIn} -> ${borders.pointsOut} points, ${borders.encoded.length} lines`);
console.log(`wrote ${OUT} (${Buffer.byteLength(out)} bytes)`);
