import type { MapPoint } from '../../custom-map/map-document';
import type { OsmWay } from '../osm-parse';

/**
 * Roundabouts as circles. OSM draws a roundabout (`junction=roundabout` or
 * `circular`) as a ring of a few nodes, often split into a way per stretch
 * between its mouths; laid as given, the ring was a polygon, its corners
 * rounded off but its sides straight, the island inside it angular. The
 * ways of a ring (joined where they share nodes) get a circle fitted to all
 * their nodes: each node moves onto it, in every way that has it (the roads
 * into the ring with it), and between two of its nodes a ring way follows
 * the arc (points a metre apart, nodes of their own; buildRoads thins them
 * to the 0.2 m it keeps). A ring too far from a circle (a long oval, an odd
 * shape) stays as mapped. Changes the ways in place: whatever reads them
 * after (the roads, the pavements, the furniture along them) sees circles.
 */

/** Radii a ring may have to be laid as a circle, metres (a mini roundabout to a large one) */
const MIN_RADIUS = 4;
const MAX_RADIUS = 80;
/** Furthest a ring's node may lie off its circle, as a share of the radius */
const MAX_OFF = 0.3;
/** Widest gap between a ring's nodes round its circle, radians */
const MAX_GAP = (Math.PI * 2) / 3;
/** Fewest nodes a ring needs for a circle */
const MIN_NODES = 4;
/** Metres between the points of an arc */
const ARC_STEP = 1;

interface Ring {
  /** Where each node of a ring lies on its circle */
  moved: Map<number, MapPoint>;
  /** The circle of each ring way */
  circles: Map<OsmWay, { x: number; y: number; r: number }>;
}

function isRoundabout(way: OsmWay): boolean {
  const j = way.tags['junction'];
  return j === 'roundabout' || j === 'circular';
}

/** The roundabouts among `ways` laid as circles, in place (see the file's comment); how many */
export function roundRoundabouts(ways: OsmWay[]): number {
  const rounds = roundaboutCircles(ways);
  if (!rounds.moved.size) return 0;
  let next = -1;
  for (const way of ways) {
    if (!way.nodes.some((id) => rounds.moved.has(id))) continue;
    const circle = rounds.circles.get(way);
    const nodes: number[] = [];
    const points: (MapPoint | null)[] = [];
    way.points.forEach((p, k) => {
      const id = way.nodes[k];
      const at = p && (rounds.moved.get(id) ?? p);
      const prev = points.length ? points[points.length - 1] : null;
      if (circle && at && prev) {
        // The arc from the node before, the short way round
        const a0 = Math.atan2(prev.y - circle.y, prev.x - circle.x);
        let turn = Math.atan2(at.y - circle.y, at.x - circle.x) - a0;
        if (turn > Math.PI) turn -= Math.PI * 2;
        if (turn < -Math.PI) turn += Math.PI * 2;
        const steps = Math.floor((Math.abs(turn) * circle.r) / ARC_STEP);
        for (let s = 1; s < steps; s++) {
          const a = a0 + (turn * s) / steps;
          nodes.push(next--);
          points.push({ x: circle.x + Math.cos(a) * circle.r, y: circle.y + Math.sin(a) * circle.r });
        }
      }
      nodes.push(id);
      points.push(at);
    });
    way.nodes = nodes;
    way.points = points;
  }
  return new Set(rounds.circles.values()).size;
}

function roundaboutCircles(ways: readonly OsmWay[]): Ring {
  const out: Ring = { moved: new Map(), circles: new Map() };
  const rings = ways.filter(isRoundabout);
  if (!rings.length) return out;
  // The ways of one ring: joined over shared nodes
  const parent = rings.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const byNode = new Map<number, number>();
  rings.forEach((w, k) => {
    for (const id of w.nodes) {
      const seen = byNode.get(id);
      if (seen === undefined) byNode.set(id, k);
      else parent[find(seen)] = find(k);
    }
  });
  const groups = new Map<number, OsmWay[]>();
  rings.forEach((w, k) => {
    const g = groups.get(find(k));
    if (g) g.push(w);
    else groups.set(find(k), [w]);
  });
  for (const group of groups.values()) {
    const points = new Map<number, MapPoint>();
    for (const w of group) w.nodes.forEach((id, k) => w.points[k] && points.set(id, w.points[k]!));
    if (points.size < MIN_NODES) continue;
    const circle = fitCircle([...points.values()]);
    if (!circle || circle.r < MIN_RADIUS || circle.r > MAX_RADIUS) continue;
    let off = 0;
    for (const p of points.values()) off = Math.max(off, Math.abs(Math.hypot(p.x - circle.x, p.y - circle.y) - circle.r));
    if (off > circle.r * MAX_OFF) continue;
    // Round about: no wider gap between its nodes than a third of the circle (a long rectangle's corners lie on one too)
    const angles = [...points.values()].map((p) => Math.atan2(p.y - circle.y, p.x - circle.x)).sort((a, b) => a - b);
    let gap = angles[0] + Math.PI * 2 - angles[angles.length - 1];
    for (let k = 1; k < angles.length; k++) gap = Math.max(gap, angles[k] - angles[k - 1]);
    if (gap > MAX_GAP) continue;
    for (const [id, p] of points) {
      const d = Math.hypot(p.x - circle.x, p.y - circle.y) || 1;
      out.moved.set(id, { x: circle.x + ((p.x - circle.x) / d) * circle.r, y: circle.y + ((p.y - circle.y) / d) * circle.r });
    }
    for (const w of group) out.circles.set(w, circle);
  }
  return out;
}

/** The circle nearest the points (least squares on x² + y² + D x + E y + F = 0), null when they lie on a line */
function fitCircle(points: readonly MapPoint[]): { x: number; y: number; r: number } | null {
  // About their mean, for a well conditioned system
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= points.length;
  my /= points.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sx = 0;
  let sy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  for (const p of points) {
    const x = p.x - mx;
    const y = p.y - my;
    const z = x * x + y * y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sx += x;
    sy += y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }
  const n = points.length;
  // [sxx sxy sx; sxy syy sy; sx sy n] [D E F] = -[sxz syz sz]
  const m = [
    [sxx, sxy, sx, -sxz],
    [sxy, syy, sy, -syz],
    [sx, sy, n, -sz],
  ];
  for (let c = 0; c < 3; c++) {
    let pivot = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    if (Math.abs(m[pivot][c]) < 1e-9) return null;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  const d = m[0][3] / m[0][0];
  const e = m[1][3] / m[1][1];
  const f = m[2][3] / m[2][2];
  const r2 = (d * d + e * e) / 4 - f;
  if (!(r2 > 0)) return null;
  return { x: mx - d / 2, y: my - e / 2, r: Math.sqrt(r2) };
}
