/**
 * A custom map's own intro camera flight (CustomMapDocument.intro, TODO
 * E170): camera views flown through in turn, or an orbit around the HQ. The
 * game plays it instead of its default tour (IntroCameraFlightService), the
 * editor previews it. Pure: no three, no Angular.
 *
 * Map space: metres, x east, y north, `h` the height above the map's zero.
 */
import type { MapIntro, MapIntroView } from './map-document';

/** Seconds a map's intro may take, views a path may hold */
export const INTRO_SECONDS = { min: 3, max: 60, default: 16 } as const;
export const MAX_INTRO_VIEWS = 16;
/** An orbit's radius (m), height above the HQ's ground (m) and sweep (degrees) */
export const INTRO_ORBIT = {
  radius: { min: 20, max: 4000 },
  height: { min: 2, max: 2000 },
  sweep: { min: 30, max: 720, default: 360 },
} as const;

/** A camera pose in map space: where it stands and the point it looks at */
export interface IntroPose {
  x: number;
  y: number;
  h: number;
  lookX: number;
  lookY: number;
  lookH: number;
}

export function emptyPose(): IntroPose {
  return { x: 0, y: 0, h: 0, lookX: 0, lookY: 0, lookH: 0 };
}

/**
 * The pose `t` seconds into the intro, written to `out`. A path runs a
 * Catmull-Rom spline through its views, the same time between each two; an
 * orbit turns around the HQ from its start bearing (0 east, counter-clockwise
 * seen from above), looking at the HQ. `hq` carries the HQ's ground height.
 */
export function introPoseAt(intro: MapIntro, hq: { x: number; y: number; h: number }, t: number, out: IntroPose): IntroPose {
  const u = Math.min(1, Math.max(0, t / Math.max(0.001, intro.seconds)));
  if (intro.kind === 'orbit') {
    const sweep = ((intro.sweep ?? INTRO_ORBIT.sweep.default) * Math.PI) / 180;
    const a = intro.angle + sweep * u;
    out.x = hq.x + Math.cos(a) * intro.radius;
    out.y = hq.y + Math.sin(a) * intro.radius;
    out.h = hq.h + intro.height;
    out.lookX = hq.x;
    out.lookY = hq.y;
    out.lookH = hq.h;
    return out;
  }
  const views = intro.views;
  if (views.length === 1) return copyView(views[0], out);
  const span = u * (views.length - 1);
  const i = Math.min(views.length - 2, Math.floor(span));
  const f = span - i;
  const p0 = views[Math.max(0, i - 1)];
  const p1 = views[i];
  const p2 = views[i + 1];
  const p3 = views[Math.min(views.length - 1, i + 2)];
  for (const k of ['x', 'y', 'h', 'lookX', 'lookY', 'lookH'] as const) out[k] = catmullRom(p0[k], p1[k], p2[k], p3[k], f);
  return out;
}

function copyView(v: MapIntroView, out: IntroPose): IntroPose {
  out.x = v.x;
  out.y = v.y;
  out.h = v.h;
  out.lookX = v.lookX;
  out.lookY = v.lookY;
  out.lookH = v.lookH;
  return out;
}

/** Uniform Catmull-Rom between b and c (a and d the neighbours), f in 0..1 */
function catmullRom(a: number, b: number, c: number, d: number, f: number): number {
  const f2 = f * f;
  const f3 = f2 * f;
  return 0.5 * (2 * b + (c - a) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (3 * b - a - 3 * c + d) * f3);
}

/** What is wrong with a map's intro, in words; none when it has none */
export function introProblems(intro: unknown): string[] {
  if (intro === undefined) return [];
  if (!intro || typeof intro !== 'object') return ['intro is not an object'];
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const i = intro as MapIntro;
  const p: string[] = [];
  if (!finite(i.seconds) || i.seconds < INTRO_SECONDS.min || i.seconds > INTRO_SECONDS.max) {
    p.push(`intro.seconds must be ${INTRO_SECONDS.min} to ${INTRO_SECONDS.max}`);
  }
  if (i.kind === 'orbit') {
    const { radius, height, sweep } = INTRO_ORBIT;
    if (!finite(i.radius) || i.radius < radius.min || i.radius > radius.max) p.push(`intro.radius must be ${radius.min} to ${radius.max} m`);
    if (!finite(i.height) || i.height < height.min || i.height > height.max) p.push(`intro.height must be ${height.min} to ${height.max} m`);
    if (!finite(i.angle)) p.push('intro.angle must be a number (radians)');
    if (i.sweep !== undefined && (!finite(i.sweep) || i.sweep < sweep.min || i.sweep > sweep.max)) p.push(`intro.sweep must be ${sweep.min} to ${sweep.max} degrees`);
  } else if (i.kind === 'path') {
    const views = i.views;
    if (!Array.isArray(views) || views.length < 1 || views.length > MAX_INTRO_VIEWS) p.push(`intro.views must be a list of 1 to ${MAX_INTRO_VIEWS} views`);
    else if (views.some((v) => !v || !(['x', 'y', 'h', 'lookX', 'lookY', 'lookH'] as const).every((k) => finite(v[k])))) {
      p.push('every intro view needs x, y, h, lookX, lookY and lookH');
    }
  } else p.push('intro.kind must be path or orbit');
  return p;
}
