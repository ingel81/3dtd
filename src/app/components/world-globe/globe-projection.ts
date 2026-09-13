/**
 * Orthographic projection of the world map globe, free of Angular and canvas.
 *
 * World frame: unit vectors with x = cos(lat) sin(lon), y = sin(lat),
 * z = cos(lat) cos(lon). View frame: x to the right, y up, z towards the
 * viewer. A point faces the viewer while its view z (depth) is above 0.
 */

const DEG = Math.PI / 180;

/** Latitude the view centre stops at while dragging, so the poles never flip */
export const MAX_VIEW_LAT = 80;
/** Zoom range of the wheel; 1 fits the whole globe */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

/** Where the disc sits on the canvas and which lat/lon faces the viewer */
export interface GlobeView {
  /** Latitude at the centre of the disc, degrees */
  lat: number;
  /** Longitude at the centre of the disc, degrees */
  lon: number;
  /** Disc radius, px */
  radius: number;
  /** Disc centre on the canvas, px */
  cx: number;
  cy: number;
}

/** Row-major 3x3 rotation from the world frame to the view frame */
export type Rotation = readonly [number, number, number, number, number, number, number, number, number];

export interface ScreenPoint {
  x: number;
  y: number;
  /** View z: 1 at the centre of the disc, 0 on the rim, below 0 on the far side */
  depth: number;
}

/** Polylines as unit vectors, xyz per point; line i runs from starts[i] to starts[i + 1] - 1 */
export interface GlobeLines {
  xyz: Float32Array;
  starts: Uint32Array;
}

/** What a canvas path needs; CanvasRenderingContext2D fits */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
}

export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Rotation that brings lat/lon to the centre of the disc */
export function viewRotation(lat: number, lon: number): Rotation {
  const sp = Math.sin(lat * DEG);
  const cp = Math.cos(lat * DEG);
  const sl = Math.sin(lon * DEG);
  const cl = Math.cos(lon * DEG);
  return [cl, 0, -sl, -sp * sl, cp, -sp * cl, cp * sl, sp, cp * cl];
}

export function project(
  lat: number,
  lon: number,
  view: GlobeView,
  rot: Rotation = viewRotation(view.lat, view.lon),
): ScreenPoint {
  const cla = Math.cos(lat * DEG);
  const wx = cla * Math.sin(lon * DEG);
  const wy = Math.sin(lat * DEG);
  const wz = cla * Math.cos(lon * DEG);
  return {
    x: view.cx + view.radius * (rot[0] * wx + rot[1] * wy + rot[2] * wz),
    y: view.cy - view.radius * (rot[3] * wx + rot[4] * wy + rot[5] * wz),
    depth: rot[6] * wx + rot[7] * wy + rot[8] * wz,
  };
}

/**
 * Adds the parts of `lines` that face the viewer to a path. A segment that
 * crosses the horizon is cut where it does and ends on the rim of the disc.
 * Segments are straight chords between their points, fine for lines with
 * points a few degrees apart.
 */
export function traceLines(sink: PathSink, lines: GlobeLines, view: GlobeView, rot: Rotation): void {
  const { xyz, starts } = lines;
  const { cx, cy, radius: r } = view;
  for (let l = 0; l < starts.length - 1; l++) {
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let i = starts[l]; i < starts[l + 1]; i++) {
      const wx = xyz[3 * i];
      const wy = xyz[3 * i + 1];
      const wz = xyz[3 * i + 2];
      const x = rot[0] * wx + rot[1] * wy + rot[2] * wz;
      const y = rot[3] * wx + rot[4] * wy + rot[5] * wz;
      const z = rot[6] * wx + rot[7] * wy + rot[8] * wz;
      if (i === starts[l]) {
        if (z > 0) sink.moveTo(cx + r * x, cy - r * y);
      } else if (z > 0 && pz > 0) {
        sink.lineTo(cx + r * x, cy - r * y);
      } else if (z > 0 !== pz > 0) {
        // The chord crosses z = 0 at t; its xy pushed out to the unit circle is the rim point
        const t = pz / (pz - z);
        let hx = px + t * (x - px);
        let hy = py + t * (y - py);
        const len = Math.hypot(hx, hy) || 1;
        hx /= len;
        hy /= len;
        if (pz > 0) {
          sink.lineTo(cx + r * hx, cy - r * hy);
        } else {
          sink.moveTo(cx + r * hx, cy - r * hy);
          sink.lineTo(cx + r * x, cy - r * y);
        }
      }
      px = x;
      py = y;
      pz = z;
    }
  }
}

/**
 * Reads an encoded polyline (Google's polyline algorithm, lat before lon)
 * into [lat, lon, lat, lon, ...] degrees. `factor` is the steps per degree
 * it was written with; Google's own is 1e5.
 */
export function decodePolyline(encoded: string, factor: number): number[] {
  const out: number[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number => {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    out.push(lat / factor, lon / factor);
  }
  return out;
}

/** Encoded polylines as unit vectors for traceLines() */
export function toGlobeLines(encoded: readonly string[], factor: number): GlobeLines {
  const decoded = encoded.map((s) => decodePolyline(s, factor));
  const total = decoded.reduce((n, d) => n + d.length / 2, 0);
  const xyz = new Float32Array(total * 3);
  const starts = new Uint32Array(decoded.length + 1);
  let p = 0;
  decoded.forEach((latLon, l) => {
    starts[l] = p;
    for (let i = 0; i < latLon.length; i += 2, p++) {
      const lat = latLon[i] * DEG;
      const lon = latLon[i + 1] * DEG;
      xyz[3 * p] = Math.cos(lat) * Math.sin(lon);
      xyz[3 * p + 1] = Math.sin(lat);
      xyz[3 * p + 2] = Math.cos(lat) * Math.cos(lon);
    }
  });
  starts[decoded.length] = p;
  return { xyz, starts };
}

/** Meridians and parallels every `step` degrees, sampled every `sample` degrees; poles left out */
export function graticule(step = 30, sample = 3): GlobeLines {
  const lines: number[][] = [];
  for (let lon = -180; lon < 180; lon += step) {
    const line: number[] = [];
    for (let lat = -90 + step / 2; lat <= 90 - step / 2; lat += sample) line.push(lat, lon);
    lines.push(line);
  }
  for (let lat = -90 + step; lat < 90; lat += step) {
    const line: number[] = [];
    for (let lon = -180; lon <= 180; lon += sample) line.push(lat, lon);
    lines.push(line);
  }
  const total = lines.reduce((n, l) => n + l.length / 2, 0);
  const xyz = new Float32Array(total * 3);
  const starts = new Uint32Array(lines.length + 1);
  let p = 0;
  lines.forEach((latLon, l) => {
    starts[l] = p;
    for (let i = 0; i < latLon.length; i += 2, p++) {
      const lat = latLon[i] * DEG;
      const lon = latLon[i + 1] * DEG;
      xyz[3 * p] = Math.cos(lat) * Math.sin(lon);
      xyz[3 * p + 1] = Math.sin(lat);
      xyz[3 * p + 2] = Math.cos(lat) * Math.cos(lon);
    }
  });
  starts[lines.length] = p;
  return { xyz, starts };
}

/** View centre after dragging by dx/dy px: the surface follows the pointer. */
export function dragged(view: GlobeView, dx: number, dy: number): { lat: number; lon: number } {
  const perPx = 1 / (view.radius * DEG);
  return {
    lat: Math.min(MAX_VIEW_LAT, Math.max(-MAX_VIEW_LAT, view.lat + dy * perPx)),
    lon: wrapLon(view.lon - dx * perPx),
  };
}

/** Centre between `from` (t = 0) and `to` (t = 1), across the antimeridian the short way */
export function lerpCenter(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  t: number,
): { lat: number; lon: number } {
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lon: wrapLon(from.lon + wrapLon(to.lon - from.lon) * t),
  };
}

/** Index of the point facing the viewer closest to x/y within maxDist px, -1 if none */
export function nearestPoint(points: readonly ScreenPoint[], x: number, y: number, maxDist: number): number {
  let best = -1;
  let bestD = maxDist * maxDist;
  points.forEach((p, i) => {
    if (p.depth <= 0) return;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which labels to draw: in the given order, each one that overlaps none drawn before it. */
export function placeLabels(boxes: readonly LabelBox[]): boolean[] {
  const placed: LabelBox[] = [];
  return boxes.map((b) => {
    const free = placed.every((p) => b.x >= p.x + p.w || p.x >= b.x + b.w || b.y >= p.y + p.h || p.y >= b.y + b.h);
    if (free) placed.push(b);
    return free;
  });
}
