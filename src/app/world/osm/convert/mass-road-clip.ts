/**
 * A raised building cut back off the roads (building-mass.ts, buildings.ts):
 * each road that reaches into its outline pushes the wall off it, or cuts
 * the outline at the road's edge, while enough of it is left.
 */
import type { MapMass, MapMassPart } from '../../custom-map/map-document';
import { ringArea2, segmentDistance } from '../../custom-map/object-mass';
import { round2 } from './geom';

/** A road's piece in the building's own axes (model x, z) with the half width the building keeps off */
interface MassRoad {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
}

/**
 * The share of its ground a raised building keeps at least when roads cut it
 * back (clipOffRoads); CLIP_LEAST where no less cut leaves it off the roads
 * (convert/buildings.ts)
 */
export const CLIP_KEEP = 0.5;
export const CLIP_LEAST = 0.3;

/**
 * Cuts a raised building's walls back from the roads that reach into it (an
 * old town's houses stand at the edge of a street the map draws wider): each
 * road piece that comes nearer to the outline than its half width cuts the
 * outline along a line beside it, on the side of the building's middle.
 * Courtyards the cut reaches go. Its parts are cut along the same lines,
 * a part cut away goes. False (the building unchanged) when less than
 * `keep` of the ground would be left or nothing is left to cut.
 */
export function clipOffRoads(mass: MapMass, roads: readonly MassRoad[], keep = CLIP_KEEP): boolean {
  let outer = mass.rings[0];
  const before = Math.abs(ringArea2(outer));
  let holes = mass.rings.slice(1);
  // What was done to the outline, once more for each part: a ring after it, null where nothing is left of it
  const steps: ((ring: number[]) => number[] | null)[] = [];
  for (const r of roads) {
    const dx = r.bx - r.ax;
    const dz = r.bz - r.az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6 || ringRoadDistance(outer, r) >= r.half) continue;
    // The side of the building's middle, and the line half a road's width off the centre line
    let nx = -dz / len;
    let nz = dx / len;
    const [cx, cz] = ringMiddle(outer);
    if ((cx - r.ax) * nx + (cz - r.az) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    // Only where the building stands beside the road: a cut that would take what lies behind the line past either
    // end of the piece (a big building whose corner a road leaves from) moves only the corners in its way off it
    if (overreaches(outer, r, nx, nz, len)) {
      const step = (ring: number[]) => pushedOff(ring, r, nx, nz, len);
      outer = step(outer);
      steps.push(step);
      continue;
    }
    const step = (ring: number[]) => clipHalfPlane(ring, r.ax, r.az, nx, nz, r.half);
    const cut = step(outer);
    if (!cut) return false;
    outer = cut;
    holes = holes.filter((h) => ringRoadDistance(h, r) >= r.half && step(h)?.length === h.length);
    steps.push(step);
  }
  if (outer === mass.rings[0]) return true;
  if (Math.abs(ringArea2(outer)) < before * keep) return false;
  mass.rings = [outer.map(round2), ...holes];
  // The walls it shared are other walls now (MapMass.shared counts them on the outline)
  delete mass.shared;
  if (mass.parts) {
    // The parts the same way: what lies past a cut goes, a part wholly past it with it
    const parts: MapMassPart[] = [];
    for (const p of mass.parts) {
      let ring: number[] | null = p.rings[0];
      let courts = p.rings.slice(1);
      for (const step of steps) {
        if (!ring) break;
        ring = step(ring);
        courts = courts.filter((h) => step(h)?.length === h.length);
      }
      if (!ring || Math.abs(ringArea2(ring)) < 1) continue;
      // A part cut keeps its roof over what is left of it (a helm its top, mass-roof.ts the rest), not its shared walls
      if (ring === p.rings[0]) {
        parts.push(p);
      } else {
        const cut: MapMassPart = { ...p, rings: [ring.map(round2), ...courts] };
        delete cut.shared;
        parts.push(cut);
      }
    }
    if (parts.length) mass.parts = parts;
    else delete mass.parts;
  }
  return true;
}

/**
 * Whether cutting a ring along road piece `r` (normal n towards the
 * building's middle) would take a point that lies behind the road (farther
 * than its half width and a little past its centre line) and beyond the
 * piece's ends: the line runs on where the road does not
 */
function overreaches(ring: readonly number[], r: MassRoad, nx: number, nz: number, len: number): boolean {
  const tx = (r.bx - r.ax) / len;
  const tz = (r.bz - r.az) / len;
  for (let i = 0; i < ring.length; i += 2) {
    const dx = ring[i] - r.ax;
    const dz = ring[i + 1] - r.az;
    if (dx * nx + dz * nz >= -(r.half + OVERREACH_SLACK)) continue;
    const t = dx * tx + dz * tz;
    if (t < -r.half || t > len + r.half) return true;
  }
  return false;
}

/** Metres behind a road's band a cut may still take beside the road's ends */
const OVERREACH_SLACK = 0.5;

/** The ring with its points in the band of road piece `r` (within its half width, along its length) moved off it along n */
function pushedOff(ring: number[], r: MassRoad, nx: number, nz: number, len: number): number[] {
  const tx = (r.bx - r.ax) / len;
  const tz = (r.bz - r.az) / len;
  let out: number[] | null = null;
  for (let i = 0; i < ring.length; i += 2) {
    const dx = ring[i] - r.ax;
    const dz = ring[i + 1] - r.az;
    const s = dx * nx + dz * nz;
    const t = dx * tx + dz * tz;
    if (s >= r.half || s < -r.half || t < -r.half || t > len + r.half) continue;
    out ??= [...ring];
    out[i] += (r.half - s) * nx;
    out[i + 1] += (r.half - s) * nz;
  }
  return out ?? ring;
}

/** Nearest approach (m) of a road piece's centre line to a ring's edges */
function ringRoadDistance(ring: readonly number[], r: MassRoad): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    best = Math.min(best, segmentDistance(ring[j], ring[j + 1], ring[i], ring[i + 1], r.ax, r.az, r.bx, r.bz));
  }
  return best;
}

/** Mean of a ring's points */
function ringMiddle(ring: readonly number[]): [number, number] {
  let x = 0;
  let z = 0;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i];
    z += ring[i + 1];
  }
  return [x / (ring.length / 2), z / (ring.length / 2)];
}

/** Sutherland-Hodgman: the part of a ring where (p - a) · n >= d; null when under three points are left */
function clipHalfPlane(ring: readonly number[], ax: number, az: number, nx: number, nz: number, d: number): number[] | null {
  const out: number[] = [];
  const n = ring.length / 2;
  for (let k = 0; k < n; k++) {
    const px = ring[2 * k];
    const pz = ring[2 * k + 1];
    const qx = ring[(2 * k + 2) % ring.length];
    const qz = ring[(2 * k + 3) % ring.length];
    const sp = (px - ax) * nx + (pz - az) * nz - d;
    const sq = (qx - ax) * nx + (qz - az) * nz - d;
    if (sp >= 0) out.push(px, pz);
    if (sp >= 0 !== sq >= 0) {
      const t = sp / (sp - sq);
      out.push(px + (qx - px) * t, pz + (qz - pz) * t);
    }
  }
  return out.length >= 6 ? out : null;
}
