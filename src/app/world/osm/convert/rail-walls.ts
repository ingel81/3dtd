/**
 * Retaining walls between a road and a railway bed on another level. The
 * beds are levelled to their lines' profiles, the roads to theirs, and the
 * ground between a road's band (left alone, levelBeds) and a bed stepped
 * from one to the other across a sample of the 2 m height field: steeper
 * than the cliff angle from 1.7 m on, rock along the road, a road on a bank
 * beside a yard in saw teeth (Würzburg: some 1.4 km of such edges).
 *
 * Where a road's edge stands WALL_MIN or more over or under the ground
 * WALL_PROBE metres out, and that ground is a bed's (`levelled`: the beds
 * moved it; beside a line on a bridge the ground is the land's), a wall
 * (`track-wall`, a run piece stretched to its length) takes the step:
 *
 * - the bed higher (a road under an embankment): the wall's face at the
 *   road's edge, the bed behind it;
 * - the road higher (a road along a cutting): the face FACE_OUT metres out
 *   from the edge, the road's verge behind it at its level; only beside a
 *   road wide enough for the shelf to end under it (a footway's would reach
 *   past it, over the ground beyond).
 *
 * Behind the face the ground falls to the low side's height over BAND
 * metres, so the low side runs flat up to the face; the slope from there up
 * to the high side lies under the wall's gravel shelf at the top's level,
 * and the shelf's groundCut leaves the ground out under it (terrain-cuts.ts,
 * as at a tunnel portal and the subway's stairs). The road's own samples
 * stay: roads are laid on the ground. No wall stands on a car park, a
 * square or a pedestrian area (OPEN_AREAS): its surface is laid on the
 * ground later, its stalls reached past the road's edge under the shelf.
 */
import { heightAt, sampleX, sampleY } from '../../../map-ops/grid';
import { EdgeIndex, edgePolyline, pointSegmentDistance } from '../../../map-ops/path-graph';
import type { MapObject, MapPaths, MapPoint, MapTerrain } from '../../custom-map/map-document';
import type { OsmArea, OsmFeatures } from '../osm-parse';
import type { RailPlan } from './rails';
import { insideRing } from '../../custom-map/map-surfaces';

export const TRACK_WALL_ASSET = 'track-wall';
/** Length of a wall piece at stretch 1, and the depth of its shelf, metres (build_modern.py track_wall) */
const PIECE = 12;
const SHELF = 6;
/** Steps from this height on get a wall, metres: a 2 m sample over it is steeper than the cliff angle (40 degrees) */
export const WALL_MIN = 1;
/** Metres past the road's edge the face stands, its outer side */
const GAP = 0.25;
/** Metres out from the face the ground the step reaches is read */
const WALL_PROBE = 4;
/** Metres out from a road's edge the face stands where the road is the higher side */
export const FACE_OUT = 3;
/** Metres behind the face the ground takes the low side's height: past a sample's diagonal, so the low side is flat to the face */
const BAND = 2.9;
/** Metres a track's middle lies within of the face for the step to be a bed's */
const TRACK_NEAR = 12;
/** Metres along a road between the steps read */
const STEP = 1;
/** Bend that ends a piece, radians, and its longest run, metres */
const BEND = (8 * Math.PI) / 180;
const LONGEST = 2 * PIECE;
/** Areas whose surface reaches past a road's edge: no wall stands on them */
const OPEN_AREAS = (tags: Readonly<Record<string, string>>): boolean =>
  tags['amenity'] === 'parking' || tags['place'] === 'square' || tags['area:highway'] !== undefined || (!!tags['highway'] && tags['area'] === 'yes');
/** Longest gap in a run filled in, metres */
const GAP_FILL = 8;
/** Shortest run that gets a wall, metres */
const SHORTEST = 10;
/** Metres the ground at the shelf's far edge may lie off its top, and rise over it before: past them the shelf would float or sink */
const SEAT_TOLERANCE = 0.4;
/** Metres the shelf lies under the high side: under a road's surface, a bed's ballast, not through them */
const SHELF_SINK = 0.05;

export interface RailWallReport {
  /** Pieces placed, their metres, and of them where the bed was the higher side */
  pieces: number;
  metres: number;
  bedHigher: number;
  /** Ground samples brought to the low side */
  samples: number;
}

interface StepAt {
  /** Where the face stands, the direction it faces (to the low side), the heights either side */
  face: MapPoint;
  front: MapPoint;
  top: number;
  low: number;
  bedHigher: boolean;
}

/**
 * The walls along the roads of `paths` beside the beds of `plan` (after the
 * beds are levelled): the ground behind each face brought to the low side,
 * the pieces to place
 */
export function placeRailWalls(
  terrain: MapTerrain,
  plan: RailPlan,
  paths: MapPaths,
  levelled: (k: number) => boolean,
  features: Pick<OsmFeatures, 'areas'>,
): { objects: MapObject[]; report: RailWallReport } {
  const report: RailWallReport = { pieces: 0, metres: 0, bedHigher: 0, samples: 0 };
  const objects: MapObject[] = [];
  if (!plan.chains.length) return { objects, report };
  const roads = new EdgeIndex({ nodes: paths.nodes, edges: paths.edges.filter((e) => e.kind !== 'bridge' && !e.tunnel && !e.area && !e.covered) });
  const tracks = new TrackIndex(plan);
  const onRoad = (p: MapPoint): boolean =>
    roads.segmentsNear(p, 20).some((s) => pointSegmentDistance(p, s.a, s.b) < s.edge.width / 2 + Math.max(0, s.edge.sidewalk ?? 0) + GAP);
  const open = new AreaGrid(features.areas.filter((a) => OPEN_AREAS(a.tags)));
  const g = terrain.grid;
  const bed = (p: MapPoint): boolean => {
    const i = Math.round((p.x + terrain.width / 2) / g.cellSize);
    const j = Math.round((p.y + terrain.depth / 2) / g.cellSize);
    return i >= 0 && j >= 0 && i < g.columns && j < g.rows && levelled(j * g.columns + i);
  };
  /**
   * Whether the shelf behind a face at `from` metres along the normal
   * (`at`), running `dir` (1 out, -1 back), lies on the ground: the ground
   * just past its far edge at `top`, nowhere before it over the top (the
   * end of an embankment, a bed on a bank falling away, gave shelves in the
   * air)
   */
  const seated = (at: (d: number) => MapPoint, from: number, dir: number, top: number): boolean => {
    const h = (d: number) => {
      const p = at(from + dir * d);
      return heightAt(terrain, p.x, p.y);
    };
    if (Math.abs(h(SHELF + 0.5) - top) > SEAT_TOLERANCE) return false;
    for (let d = 1; d < SHELF; d++) if (h(d) > top + SEAT_TOLERANCE) return false;
    return true;
  };
  const runs: StepAt[][] = [];
  for (const edge of roads.paths.edges) {
    const line = edgePolyline(paths, edge);
    if (line.length < 2) continue;
    const half = edge.width / 2 + Math.max(0, edge.sidewalk ?? 0);
    for (const side of [-1, 1]) {
      const steps: (StepAt | null)[] = [];
      walk(line, STEP, (c, t) => steps.push(stepAt(c, t)));
      runs.push(...runsOf(steps));
      function stepAt(c: MapPoint, t: MapPoint): StepAt | null {
        const n = { x: -t.y * side, y: t.x * side };
        const at = (d: number) => ({ x: c.x + n.x * d, y: c.y + n.y * d });
        const edgeAt = at(half + GAP);
        const road = heightAt(terrain, c.x + n.x * (half - 0.3), c.y + n.y * (half - 0.3));
        const outAt = at(half + GAP + WALL_PROBE);
        const out = heightAt(terrain, outAt.x, outAt.y);
        const step = out - road;
        let kind: 'bed' | 'road' | null = Math.abs(step) < WALL_MIN || onRoad(outAt) || !bed(outAt) || !tracks.near(outAt, TRACK_NEAR) ? null : step > 0 ? 'bed' : 'road';
        if (kind === 'road' && 2 * half + GAP < SHELF - FACE_OUT) kind = null;
        if (!kind) return null;
        if (kind === 'bed') {
          // The face at the road's edge, facing the road; the bed's level where the shelf ends
          const end = at(half + GAP + SHELF);
          const top = heightAt(terrain, end.x, end.y);
          if (!bed(end) || !seated(at, half + GAP, 1, top) || open.inside(at(half + GAP + 1)) || open.inside(at(half + GAP + SHELF / 2))) return null;
          return { face: edgeAt, front: { x: -n.x, y: -n.y }, top, low: road, bedHigher: true };
        } else {
          // The face out from the edge, facing the bed; the road's verge behind it
          const face = at(half + GAP + FACE_OUT);
          const below = at(half + GAP + FACE_OUT + WALL_PROBE);
          if (onRoad(face) || !bed(below) || !seated(at, half + GAP + FACE_OUT, -1, road) || open.inside(face) || open.inside(at(half + GAP + 1))) return null;
          return { face, front: n, top: road, low: heightAt(terrain, below.x, below.y), bedHigher: false };
        }
      }
    }
  }
  // The ground behind each face down to the low side, then the pieces on it
  for (const run of runs) report.samples += lowerBehind(terrain, run, onRoad);
  for (const run of runs) {
    for (const piece of pieces(run)) {
      const a = piece[0];
      const b = piece[piece.length - 1];
      const length = Math.max(STEP, Math.hypot(b.face.x - a.face.x, b.face.y - a.face.y) + STEP);
      const mid = { x: (a.face.x + b.face.x) / 2, y: (a.face.y + b.face.y) / 2 };
      const front = unit({ x: piece.reduce((s, p) => s + p.front.x, 0), y: piece.reduce((s, p) => s + p.front.y, 0) });
      const top = piece.reduce((s, p) => s + p.top, 0) / piece.length - SHELF_SINK;
      // Model +z, map (-sin r, cos r), faces the low side
      const rotation = Math.atan2(-front.x, front.y);
      objects.push({
        id: `track-wall-${objects.length + 1}`,
        asset: TRACK_WALL_ASSET,
        x: round2(mid.x),
        y: round2(mid.y),
        z: round2(top - heightAt(terrain, mid.x, mid.y)),
        rotation: round3(rotation),
        scale: 1,
        stretch: round3(length / PIECE),
      });
      report.pieces++;
      report.metres += length;
      if (a.bedHigher) report.bedHigher++;
    }
  }
  report.metres = Math.round(report.metres);
  return { objects, report };
}

/** Brings the samples within BAND behind a run's faces (off the roads) to the low side's height; how many */
function lowerBehind(terrain: MapTerrain, run: readonly StepAt[], onRoad: (p: MapPoint) => boolean): number {
  const g = terrain.grid;
  const xs = run.map((s) => s.face.x);
  const ys = run.map((s) => s.face.y);
  const pad = BAND + STEP;
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - pad + terrain.width / 2) / g.cellSize));
  const i1 = Math.min(g.columns - 1, Math.ceil((Math.max(...xs) + pad + terrain.width / 2) / g.cellSize));
  const j0 = Math.max(0, Math.floor((Math.min(...ys) - pad + terrain.depth / 2) / g.cellSize));
  const j1 = Math.min(g.rows - 1, Math.ceil((Math.max(...ys) + pad + terrain.depth / 2) / g.cellSize));
  let changed = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const q = { x: sampleX(terrain, i), y: sampleY(terrain, j) };
      // The nearest step of the run: behind its face (against its front), within the run's reach along it
      let best: StepAt | null = null;
      let bestD = Infinity;
      for (const s of run) {
        const d = Math.hypot(q.x - s.face.x, q.y - s.face.y);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (!best) continue;
      const ox = q.x - best.face.x;
      const oy = q.y - best.face.y;
      const back = -(ox * best.front.x + oy * best.front.y);
      const along = Math.abs(ox * best.front.y - oy * best.front.x);
      if (back <= 0 || back > BAND || along > STEP || onRoad(q)) continue;
      const k = j * g.columns + i;
      if (Math.abs(g.heights[k] - best.low) < 0.01) continue;
      g.heights[k] = best.low;
      changed++;
    }
  }
  return changed;
}

/**
 * The runs of a road's side: its steps of one kind in a row, gaps of up to
 * GAP_FILL metres between two of a kind filled in between them (a sample
 * on a kerb's drop, a shelf a few centimetres off: a wall broken into
 * stubs, the rock between them), runs shorter than SHORTEST left out
 */
function runsOf(steps: (StepAt | null)[]): StepAt[][] {
  const filled = [...steps];
  let last = -1;
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k];
    if (!s) continue;
    const prev = last >= 0 ? steps[last] : null;
    if (prev && k - last > 1 && (k - last - 1) * STEP <= GAP_FILL && prev.bedHigher === s.bedHigher) {
      for (let m = last + 1; m < k; m++) {
        const f = (m - last) / (k - last);
        const mix = (a: number, b: number) => a + (b - a) * f;
        filled[m] = {
          face: { x: mix(prev.face.x, s.face.x), y: mix(prev.face.y, s.face.y) },
          front: unit({ x: mix(prev.front.x, s.front.x), y: mix(prev.front.y, s.front.y) }),
          top: mix(prev.top, s.top),
          low: mix(prev.low, s.low),
          bedHigher: s.bedHigher,
        };
      }
    }
    last = k;
  }
  const out: StepAt[][] = [];
  let run: StepAt[] = [];
  const close = () => {
    if (run.length * STEP >= SHORTEST) out.push(run);
    run = [];
  };
  for (const s of filled) {
    if (!s || (run.length && run[0].bedHigher !== s.bedHigher)) close();
    if (s) run.push(s);
  }
  close();
  return out;
}

/** A run cut into straight pieces: at a bend of BEND, or LONGEST metres */
function pieces(run: readonly StepAt[]): StepAt[][] {
  const out: StepAt[][] = [];
  let cur: StepAt[] = [run[0]];
  for (let k = 1; k < run.length; k++) {
    const s = run[k];
    const first = cur[0];
    const turn = Math.acos(Math.max(-1, Math.min(1, s.front.x * first.front.x + s.front.y * first.front.y)));
    if ((turn > BEND && cur.length * STEP >= SHORTEST) || cur.length * STEP >= LONGEST) {
      out.push(cur);
      cur = [];
    }
    cur.push(s);
  }
  out.push(cur);
  return out;
}

/** Calls `f` every `step` metres along `line` with the point and the unit direction there */
function walk(line: readonly MapPoint[], step: number, f: (p: MapPoint, t: MapPoint) => void): void {
  let carry = step / 2;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1];
    const b = line[k];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    for (let s = carry; s < len; s += step) f({ x: a.x + t.x * s, y: a.y + t.y * s }, t);
    carry = (((carry - len) % step) + step) % step;
  }
}

/** Areas in a grid of cells by their bounds, to ask whether a point lies on one */
class AreaGrid {
  private readonly cells = new Map<number, OsmArea[]>();
  private static readonly CELL = 64;

  constructor(areas: readonly OsmArea[]) {
    for (const a of areas) {
      const pts = a.outer.flat();
      if (!pts.length) continue;
      const c = AreaGrid.CELL;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      for (let j = Math.floor(Math.min(...ys) / c); j <= Math.floor(Math.max(...ys) / c); j++) {
        for (let i = Math.floor(Math.min(...xs) / c); i <= Math.floor(Math.max(...xs) / c); i++) {
          const key = (i + 4096) * 8192 + (j + 4096);
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(a);
        }
      }
    }
  }

  inside(p: MapPoint): boolean {
    const c = AreaGrid.CELL;
    for (const a of this.cells.get((Math.floor(p.x / c) + 4096) * 8192 + (Math.floor(p.y / c) + 4096)) ?? []) {
      if (a.outer.some((r) => insideRing(p, r)) && !a.inner.some((r) => insideRing(p, r))) return true;
    }
    return false;
  }
}

/** The lines' segments in a grid of cells, to ask whether a track runs near */
class TrackIndex {
  private readonly cells = new Map<number, [MapPoint, MapPoint][]>();
  private static readonly CELL = 16;

  constructor(plan: RailPlan) {
    for (const c of plan.chains) {
      for (let k = 1; k < c.line.length; k++) {
        const a = c.line[k - 1];
        const b = c.line[k];
        const s = TrackIndex.CELL;
        for (let j = Math.floor(Math.min(a.y, b.y) / s); j <= Math.floor(Math.max(a.y, b.y) / s); j++) {
          for (let i = Math.floor(Math.min(a.x, b.x) / s); i <= Math.floor(Math.max(a.x, b.x) / s); i++) {
            const key = (i + 100_000) * 200_003 + (j + 100_000);
            let list = this.cells.get(key);
            if (!list) this.cells.set(key, (list = []));
            list.push([a, b]);
          }
        }
      }
    }
  }

  near(p: MapPoint, r: number): boolean {
    const s = TrackIndex.CELL;
    for (let j = Math.floor((p.y - r) / s); j <= Math.floor((p.y + r) / s); j++) {
      for (let i = Math.floor((p.x - r) / s); i <= Math.floor((p.x + r) / s); i++) {
        for (const [a, b] of this.cells.get((i + 100_000) * 200_003 + (j + 100_000)) ?? []) if (pointSegmentDistance(p, a, b) < r) return true;
      }
    }
    return false;
  }
}

const unit = (v: MapPoint): MapPoint => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
