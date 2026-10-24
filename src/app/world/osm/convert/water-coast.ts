/** The sea of an OSM world: the coastline's ways joined and closed along the frame into the sea's mask (water.ts) */
import { type OsmFeatures, runs } from '../osm-parse';
import { fillRings, type RasterGrid } from './raster';
import type { MapPoint } from '../../custom-map/map-document';
import { clipLine, cornersBetween, perimeter, ringArea } from '../square-clip';

/**
 * The sea's samples from the coastlines, null without any: the lines joined
 * end to end, cut to the map; each piece that crosses the map closed along
 * the edge clockwise (OSM draws the land on the left, so the water lies to
 * the right) to the next piece's start; closed rings inside (islands) cut
 * their holes. Pieces that end inside the map (the answer cut them) are run
 * straight on to the edge.
 */
export function coastMask(features: OsmFeatures, grid: RasterGrid): Uint8Array | null {
  const half = features.half;
  const chains: MapPoint[][] = [];
  for (const w of features.ways) if (w.tags['natural'] === 'coastline') chains.push(...runs(w.points));
  if (!chains.length) return null;
  const joined = joinChains(chains);
  const pieces: MapPoint[][] = [];
  const islands: MapPoint[][] = [];
  for (const chain of joined) {
    const closed = chain.length >= 4 && Math.hypot(chain[0].x - chain[chain.length - 1].x, chain[0].y - chain[chain.length - 1].y) < 0.01;
    if (closed && chain.every((p) => Math.abs(p.x) < half && Math.abs(p.y) < half)) {
      islands.push(chain.slice(0, -1));
      continue;
    }
    for (const piece of clipLine(chain, half)) pieces.push(piece.map((p) => ({ ...p })));
  }
  // Ends inside the map run on to the nearest edge
  for (const p of pieces) {
    p[0] = toEdge(p[0], half);
    p[p.length - 1] = toEdge(p[p.length - 1], half);
  }
  const rings: MapPoint[][] = [];
  if (!pieces.length) {
    // Only islands (or lakes drawn as coast): the sea is all around them, if they turn the way islands do
    if (!islands.some((r) => ringArea(r) > 0)) return null;
    rings.push([{ x: -half, y: half }, { x: half, y: half }, { x: half, y: -half }, { x: -half, y: -half }]);
  } else {
    const used = new Array(pieces.length).fill(false);
    for (let first = 0; first < pieces.length; first++) {
      if (used[first]) continue;
      const ring: MapPoint[] = [];
      let at = first;
      for (let guard = 0; guard <= pieces.length; guard++) {
        used[at] = true;
        ring.push(...pieces[at]);
        const exit = perimeter(pieces[at][pieces[at].length - 1], half);
        // The next start clockwise from the exit
        let next = -1;
        let gap = Infinity;
        pieces.forEach((p, k) => {
          const d = (perimeter(p[0], half) - exit + 8 * half) % (8 * half);
          if (d < gap && (!used[k] || k === first)) {
            gap = d;
            next = k;
          }
        });
        ring.push(...cornersBetween(exit, exit + gap, half));
        if (next === first || next < 0) break;
        at = next;
      }
      rings.push(ring);
    }
  }
  rings.push(...islands);
  const mask = new Uint8Array(grid.n * grid.n);
  fillRings(rings, grid, (i, j) => (mask[j * grid.n + i] = 1));
  return mask;
}

/** Coastline ways put end to end where one starts where another ends */
function joinChains(chains: MapPoint[][]): MapPoint[][] {
  const key = (p: MapPoint) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  const open = chains.map((c) => [...c]);
  const out: MapPoint[][] = [];
  while (open.length) {
    let chain = open.pop()!;
    for (let grew = true; grew; ) {
      grew = false;
      const end = key(chain[chain.length - 1]);
      const start = key(chain[0]);
      for (let k = 0; k < open.length; k++) {
        if (key(open[k][0]) === end) {
          chain = chain.concat(open.splice(k, 1)[0].slice(1));
          grew = true;
          break;
        }
        if (key(open[k][open[k].length - 1]) === start) {
          chain = open.splice(k, 1)[0].concat(chain.slice(1));
          grew = true;
          break;
        }
      }
    }
    out.push(chain);
  }
  return out;
}

/** A point moved straight onto the nearest edge of the square, if it is inside */
function toEdge(p: MapPoint, half: number): MapPoint {
  const dx = half - Math.abs(p.x);
  const dy = half - Math.abs(p.y);
  if (dx <= 0.01 || dy <= 0.01) return p;
  return dx < dy ? { x: Math.sign(p.x || 1) * half, y: p.y } : { x: p.x, y: Math.sign(p.y || 1) * half };
}
