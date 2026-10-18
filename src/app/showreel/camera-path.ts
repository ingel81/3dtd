/**
 * Camera moves of the showreel: smooth paths through keyframes and orbits,
 * in map space (x east, y north, h height in metres). A stage turns the pose
 * into its own scene (game or editor). Pure maths, no three.js.
 */

/** A point on the map: east, north, height (m) */
export interface MapPoint3 {
  x: number;
  y: number;
  h: number;
}

/** Where the camera is and what it looks at */
export interface CameraPose {
  eye: MapPoint3;
  look: MapPoint3;
}

export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'smooth';

/** 0..1 to 0..1; `smooth` starts and ends gently but keeps most of the middle at speed */
export function ease(kind: Ease, t: number): number {
  const u = Math.min(1, Math.max(0, t));
  switch (kind) {
    case 'linear':
      return u;
    case 'in':
      return u * u * u;
    case 'out':
      return 1 - (1 - u) ** 3;
    case 'inOut':
      return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
    case 'smooth':
      return u * u * u * (u * (u * 6 - 15) + 10);
  }
}

/**
 * Centripetal Catmull-Rom through `points` (at least one), `t` from 0 at the
 * first to 1 at the last; the ends are mirrored so the curve starts and
 * stops along its first and last legs. Centripetal (alpha 0.5) makes no
 * loops or cusps between close keyframes.
 */
export function catmullRom(points: readonly MapPoint3[], t: number): MapPoint3 {
  const n = points.length;
  if (n === 1) return { ...points[0] };
  const segments = n - 1;
  const s = Math.min(segments - 1e-9, Math.max(0, t * segments));
  const i = Math.floor(s);
  const local = s - i;
  const p1 = points[i];
  const p2 = points[i + 1];
  const p0 = i > 0 ? points[i - 1] : mirror(p2, p1);
  const p3 = i + 2 < n ? points[i + 2] : mirror(p1, p2);
  return centripetal(p0, p1, p2, p3, local);
}

/** `a` reflected through `about` */
function mirror(a: MapPoint3, about: MapPoint3): MapPoint3 {
  return { x: 2 * about.x - a.x, y: 2 * about.y - a.y, h: 2 * about.h - a.h };
}

function knot(a: MapPoint3, b: MapPoint3): number {
  return Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y, b.h - a.h)));
}

function centripetal(p0: MapPoint3, p1: MapPoint3, p2: MapPoint3, p3: MapPoint3, u: number): MapPoint3 {
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a: MapPoint3, b: MapPoint3, ta: number, tb: number): MapPoint3 => {
    const k = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: a.h + (b.h - a.h) * k };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * Curve parameter for an even share of the length along the curve: a path
 * whose keyframes lie unevenly apart still moves at one speed (before the
 * ease). `samples` steps of the table.
 */
export function arcLengthTable(points: readonly MapPoint3[], samples = 256): (share: number) => number {
  if (points.length < 2) return (share) => share;
  const lengths = [0];
  let prev = catmullRom(points, 0);
  for (let i = 1; i <= samples; i++) {
    const p = catmullRom(points, i / samples);
    lengths.push(lengths[i - 1] + Math.hypot(p.x - prev.x, p.y - prev.y, p.h - prev.h));
    prev = p;
  }
  const total = lengths[samples];
  if (total < 1e-6) return (share) => share;
  return (share) => {
    const goal = Math.min(1, Math.max(0, share)) * total;
    let lo = 0;
    let hi = samples;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid] < goal) lo = mid;
      else hi = mid;
    }
    const span = lengths[hi] - lengths[lo] || 1;
    return (lo + (goal - lengths[lo]) / span) / samples;
  };
}

/** A path through keyframes: the eye and the look point each on their own curve */
export interface PathShot {
  kind: 'path';
  keys: readonly CameraPose[];
  ease: Ease;
  /** Move the eye at one speed along its curve (default true); the look point follows the same parameter */
  even?: boolean;
}

/**
 * Round a centre: angles in degrees, 0 puts the eye south of the centre
 * looking north, 90 east of it looking west (counter-clockwise from above).
 * Radius and height may change on the way (a spiral in or out).
 */
export interface OrbitShot {
  kind: 'orbit';
  center: MapPoint3;
  from: number;
  to: number;
  radius: number;
  radiusTo?: number;
  /** Eye height above the centre (m) */
  height: number;
  heightTo?: number;
  ease: Ease;
}

export type Shot = PathShot | OrbitShot;

/** The pose of a shot at `t` (0..1 of its time) */
export function shotPose(shot: Shot, t: number, even?: (share: number) => number): CameraPose {
  const u = ease(shot.ease, t);
  if (shot.kind === 'orbit') {
    const angle = ((shot.from + (shot.to - shot.from) * u) * Math.PI) / 180;
    const radius = shot.radius + ((shot.radiusTo ?? shot.radius) - shot.radius) * u;
    const height = shot.height + ((shot.heightTo ?? shot.height) - shot.height) * u;
    const c = shot.center;
    return {
      eye: { x: c.x + Math.sin(angle) * radius, y: c.y - Math.cos(angle) * radius, h: c.h + height },
      look: { ...c },
    };
  }
  const s = even ? even(u) : u;
  return { eye: catmullRom(shot.keys.map((k) => k.eye), s), look: catmullRom(shot.keys.map((k) => k.look), s) };
}

/** A shot ready to play: the pose at a share of its time, the arc-length table built once */
export function shotPlayer(shot: Shot): (t: number) => CameraPose {
  const even = shot.kind === 'path' && shot.even !== false ? arcLengthTable(shot.keys.map((k) => k.eye)) : undefined;
  return (t) => shotPose(shot, t, even);
}

/** Orbit terms of a pose for an orbit camera: distance, yaw (0 looks north, turning west), pitch above the horizon */
export function poseToOrbit(pose: CameraPose): { distance: number; yaw: number; pitch: number } {
  const dx = pose.look.x - pose.eye.x;
  const dy = pose.look.y - pose.eye.y;
  const dh = pose.look.h - pose.eye.h;
  const distance = Math.max(1e-3, Math.hypot(dx, dy, dh));
  // CameraController's forward (-sin yaw, 0, cos yaw) in the scene is (sin yaw, cos yaw) east and north on the map
  const yaw = Math.atan2(dx, dy);
  const pitch = Math.asin(Math.min(1, Math.max(-1, -dh / distance)));
  return { distance, yaw, pitch };
}
