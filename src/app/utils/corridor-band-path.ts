/**
 * The enemies' line through a corridor band (corridor-band.ts): the station
 * nearest a point, a point's offset from the OSM line, and the polyline the
 * waypoints are taken from (bandPath).
 */

import type { BandRoute, BandStation, CorridorBand } from './corridor-band';
import { DetMath } from './det-math';

/** The station of `band` nearest to the local point (x, z), null where it has none. */
export function stationNear(band: CorridorBand, x: number, z: number): BandStation | null {
  let best: BandStation | null = null;
  let bestD = Infinity;
  for (const st of band.stations) {
    const d = (st.x - x) ** 2 + (st.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = st;
    }
  }
  return best;
}

/** Offset of the local point (x, z) from the OSM line at station `st`, right of the direction of travel positive. */
export function offsetAt(st: BandStation, x: number, z: number): number {
  return (x - st.x) * st.rx + (z - st.z) * st.rz;
}

/** A point of the enemies' line, local x, z, with what holds for the piece from it to the next point. */
export interface BandPoint {
  x: number;
  z: number;
  /** Segment of the route the piece lies on. */
  segment: number;
  /** How far the point lies off the OSM line, right of the direction of travel positive. */
  offset: number;
  /** Half widths left and right of the line for the piece: the narrower at its two ends. */
  left: number;
  right: number;
  /** The piece runs through a passage (a tunnel). */
  passage: boolean;
}

/**
 * The enemies' line of `band` as a polyline: the route's start, every
 * station moved by its centre, every point of the route between two
 * segments moved along the mitre by the offset interpolated there, the
 * route's end. Round the inside of a turn a station that lies past the
 * mitre along its segment is left out, and the mitre takes its widths. The
 * half widths of a piece are those of the band at its ends, the narrower of
 * the two; in a passage the street's half width.
 */
export function bandPath(route: BandRoute, band: CorridorBand): BandPoint[] {
  const nodes = lineNodes(route, band.stations);
  // A piece takes the narrower half widths of its two ends.
  return nodes.map(({ station: _station, ...node }, i) => {
    const next = nodes[i + 1];
    if (!next) return node;
    return { ...node, left: Math.min(node.left, next.left), right: Math.min(node.right, next.right), passage: node.passage || next.passage };
  });
}

/** A point of the enemies' line before its piece takes the narrower widths (bandPath), with the station it stands for, -1 between two segments. */
export interface LineNode extends BandPoint {
  station: number;
}

/** The points of the enemies' line of `stations` along `route`, see bandPath; a piece is a passage where either end is. */
export function lineNodes(route: BandRoute, stations: readonly BandStation[]): LineNode[] {
  const { points } = route;
  if (points.length < 2 || stations.length === 0) return [];
  const widths = (st: BandStation) => (st.kind === 'passage'
    ? { left: route.streetHalfWidth[st.segment], right: route.streetHalfWidth[st.segment] }
    : { left: st.centre - st.left, right: st.right - st.centre });
  const nodes: LineNode[] = [];
  const first = stations[0];
  nodes.push({ x: points[0].x, z: points[0].z, segment: first.segment, offset: 0, ...widths(first), passage: first.kind === 'passage', station: 0 });
  // Along `st`'s direction of travel, how far `node` lies past `mitre`.
  const past = (node: LineNode, mitre: LineNode, st: BandStation) => (node.x - mitre.x) * st.rz - (node.z - mitre.z) * st.rx;
  // A station dropped at a mitre hands the mitre its widths, so the piece now over its place keeps them.
  const handOver = (node: LineNode, mitre: LineNode) => {
    mitre.left = Math.min(mitre.left, node.left);
    mitre.right = Math.min(mitre.right, node.right);
  };
  // The last mitre while the stations after it on its segment may still lie behind it.
  let mitre: LineNode | null = null;
  for (let k = 0; k < stations.length; k++) {
    const st = stations[k];
    const next = stations[k + 1];
    const node: LineNode = {
      x: st.x + st.rx * st.centre, z: st.z + st.rz * st.centre, segment: st.segment, offset: st.centre, ...widths(st),
      passage: st.kind === 'passage', station: k,
    };
    if (mitre !== null && mitre.segment === st.segment && past(node, mitre, st) < 0) {
      handOver(node, mitre);
    } else {
      mitre = null;
      nodes.push(node);
    }
    if (!next || next.segment === st.segment) continue;
    // The point between the two segments, along the mitre of their right vectors.
    const joint = points[next.segment];
    const f = (DetMath.hypot(joint.x - st.x, joint.z - st.z)) / Math.max(1e-6, next.s - st.s);
    const offset = st.centre + (next.centre - st.centre) * Math.min(1, Math.max(0, f));
    const dot = st.rx * next.rx + st.rz * next.rz;
    const scale = 1 + dot > 0.2 ? 1 / (1 + dot) : 0.5;
    const wa = widths(st);
    const wb = widths(next);
    const joined: LineNode = {
      x: joint.x + (st.rx + next.rx) * scale * offset,
      z: joint.z + (st.rz + next.rz) * scale * offset,
      segment: next.segment,
      offset,
      left: Math.min(wa.left, wb.left),
      right: Math.min(wa.right, wb.right),
      passage: st.kind === 'passage' && next.kind === 'passage',
      station: -1,
    };
    // Round the inside of a turn the parallel folds: a station nearer the
    // joint than the mitre lies past it, and the line would step back. The
    // stations past it before the joint go here, those short of it after the
    // joint as they come; the route's start and end stay.
    while (nodes.length > 1) {
      const last = nodes[nodes.length - 1];
      if (last.station < 0 || last.segment !== st.segment || past(last, joined, st) <= 0) break;
      handOver(last, joined);
      nodes.pop();
    }
    nodes.push(joined);
    mitre = joined;
  }
  const end = points[points.length - 1];
  const last = stations.length - 1;
  nodes.push({ x: end.x, z: end.z, segment: stations[last].segment, offset: 0, ...widths(stations[last]), passage: false, station: last });
  return nodes;
}
