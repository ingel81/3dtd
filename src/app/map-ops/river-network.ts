/**
 * Rivers as one network (docs/WATER_NETWORK_PLAN.md, step 1): where the
 * bands of two rivers of a kind overlap, or two stretches of one river (a
 * hairpin), or a river runs into a body of its kind, they meet in a
 * junction. Nothing of it is stored: it follows from the rivers' lines and
 * the bodies' masks, so the brush, the OSM import and the loading of a map
 * all find the same junctions, and a moved point moves its junction along.
 *
 * - `joinRiverLevels` sets the rivers' surface heights (the points'
 *   `height`) so a junction is one water on one level: a river running into
 *   another or into a body ends on that water's level (its drop spread over
 *   its course, or flat up to it); crossing rivers and the stretches of a
 *   hairpin share the lowest level of the junction: one that leaves it on
 *   that level or lower drains it and is at most that high from where it
 *   enters on; one that stands higher past it (the higher of two crossing
 *   rivers) feeds it, falls into it and keeps its levels on either side, so
 *   all its arms keep their water. A far touch of one river with itself (a
 *   long loop grazing its own neck) keeps its levels: flattening the loop
 *   would leave its bed dry.
 * - `riverCover` says per vertex of a ribbon how far another water draws
 *   there instead (the receiving river, the body, the earlier stretch), so
 *   the renderer draws a junction once, with one surface and no seam, and
 *   mixes the currents where they meet.
 *
 * Only water of one kind joins (water with water, lava with lava); lava
 * meeting water is a later step. Pure and without three: the editor's
 * worker, the import and the view use it alike.
 */
import type { MapRiver, MapRiverPoint, MapTerrain, MapWater, MapWaterKind } from '../world/custom-map/map-document';
import { sampleRiver } from '../world/custom-map/render/water/river-line';

/** What joins with what: water (also sea and swamp) or lava; ice joins nothing */
export type WaterClass = 'water' | 'lava';

export function waterClass(kind: MapWaterKind | undefined): WaterClass | null {
  return kind === 'lava' ? 'lava' : kind === 'ice' ? null : 'water';
}

/** Metres between the samples of a line, as the renderer draws its ribbon (river-line.ts) */
const STEP = 2;
/** Metres a level may differ before it is set: below this the rounding of a stored height */
const TOL = 0.005;
/**
 * Two samples of one river touch only where the course between them is this
 * much longer than the gap across: a fold or a hairpin, not neighbours along
 * a bend
 */
const FOLD = 1.5;

/** How a river takes part in a junction */
export type RunRole = 'start' | 'end' | 'through' | 'whole';

/** A stretch of a river within a junction: its samples `first` to `last`, `from` to `to` metres along it */
export interface RiverRun {
  river: number;
  first: number;
  last: number;
  from: number;
  to: number;
  role: RunRole;
}

export interface RiverJunction {
  runs: RiverRun[];
  /** Bodies of the junction, by index in `[water, ...waterBodies]` */
  bodies: number[];
  /** False for a far touch of one river with itself: drawn as one, its levels kept */
  levels: boolean;
}

/** A river's line as drawn (sampleRiver, a sample every STEP metres) with its distances */
export interface RiverLine {
  samples: MapRiverPoint[];
  along: Float64Array;
  /** The sample at each of the river's points */
  at: Int32Array;
  cls: WaterClass;
}

export interface RiverNetwork {
  /** Per river; null for one of fewer than two points */
  lines: (RiverLine | null)[];
  junctions: RiverJunction[];
  /** Per river, per sample: the junction it is in, -1 outside one */
  junctionOf: Int32Array[];
  /** Per river, per sample: its run within the junction */
  runOf: Int32Array[];
  /** All samples in a grid, for the lookups of riverCover */
  index: SampleIndex;
  /** Bodies by index in `[water, ...waterBodies]` */
  bodies: (MapWater | null)[];
}

/** The samples of all rivers in a grid of square cells */
interface SampleIndex {
  cell: number;
  x0: number;
  y0: number;
  columns: number;
  rows: number;
  /** Start of each cell's samples in `items` (CSR), one past the end at the last */
  starts: Int32Array;
  /** River and sample of each entry */
  itemRiver: Int32Array;
  itemSample: Int32Array;
  /** Widest half width of any sample */
  maxHalf: number;
}

/** The network of the terrain's rivers and bodies as they stand */
export function riverNetwork(t: MapTerrain): RiverNetwork {
  const rivers = t.rivers ?? [];
  const lines = rivers.map((r) => riverLine(r));
  const bodies = [t.water, ...(t.waterBodies ?? [])];
  const index = sampleIndex(lines);
  const offsets: number[] = [];
  let total = 0;
  for (const line of lines) {
    offsets.push(total);
    total += line?.samples.length ?? 0;
  }
  // Union-find over all samples, one node more per body
  const parent = new Int32Array(total + bodies.length);
  for (let k = 0; k < parent.length; k++) parent[k] = k;
  const find = (k: number): number => {
    while (parent[k] !== k) {
      parent[k] = parent[parent[k]];
      k = parent[k];
    }
    return k;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const touching = new Uint8Array(total);
  /** Samples that touch another stretch of their own river */
  const selfTouching = new Uint8Array(total);

  lines.forEach((line, r) => {
    if (!line) return;
    const s = line.samples;
    for (let k = 0; k < s.length; k++) {
      const p = s[k];
      const half = p.width / 2;
      const gid = offsets[r] + k;
      // Other samples whose band overlaps this one's
      eachNear(index, p.x, p.y, half + index.maxHalf, (r2, k2) => {
        const g2 = offsets[r2] + k2;
        if (g2 <= gid) return;
        const line2 = lines[r2]!;
        if (line2.cls !== line.cls) return;
        const q = line2.samples[k2];
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d >= half + q.width / 2) return;
        if (r2 === r && Math.abs(line.along[k2] - line.along[k]) <= FOLD * d + 2 * STEP) return;
        touching[gid] = 1;
        touching[g2] = 1;
        if (r2 === r) selfTouching[gid] = selfTouching[g2] = 1;
        union(gid, g2);
      });
      // A body of its kind under it
      const b = bodyAt(t, bodies, line.cls, p.x, p.y);
      if (b >= 0) {
        touching[gid] = 1;
        union(gid, total + b);
      }
    }
    // Neighbours along the line that both touch belong to one junction
    for (let k = 1; k < s.length; k++) if (touching[offsets[r] + k] && touching[offsets[r] + k - 1]) union(offsets[r] + k, offsets[r] + k - 1);
  });

  // The junctions: per root, the runs of touching samples along each river and the bodies
  const junctionByRoot = new Map<number, number>();
  const junctions: RiverJunction[] = [];
  const junctionOf: Int32Array[] = [];
  const runOf: Int32Array[] = [];
  const junctionAt = (root: number) => {
    let j = junctionByRoot.get(root);
    if (j === undefined) {
      j = junctions.length;
      junctionByRoot.set(root, j);
      junctions.push({ runs: [], bodies: [], levels: true });
    }
    return j;
  };
  lines.forEach((line, r) => {
    const n = line?.samples.length ?? 0;
    const jo = new Int32Array(n).fill(-1);
    const ro = new Int32Array(n).fill(-1);
    junctionOf.push(jo);
    runOf.push(ro);
    if (!line) return;
    let run: RiverRun | null = null;
    let runRoot = -1;
    for (let k = 0; k < n; k++) {
      const gid = offsets[r] + k;
      if (!touching[gid]) {
        run = null;
        continue;
      }
      const root = find(gid);
      const j = junctionAt(root);
      if (!run || root !== runRoot) {
        run = { river: r, first: k, last: k, from: line.along[k], to: line.along[k], role: 'through' };
        runRoot = root;
        junctions[j].runs.push(run);
      }
      run.last = k;
      run.to = line.along[k];
      jo[k] = j;
      ro[k] = junctions[j].runs.length - 1;
    }
  });
  bodies.forEach((body, b) => {
    if (!body) return;
    const j = junctionByRoot.get(find(total + b));
    if (j !== undefined) junctions[j].bodies.push(b);
  });
  for (const j of junctions) {
    for (const run of j.runs) {
      const last = lines[run.river]!.samples.length - 1;
      run.role = run.first === 0 && run.last === last ? 'whole' : run.first === 0 ? 'start' : run.last === last ? 'end' : 'through';
    }
    // A far touch of one river with itself keeps its levels: a long loop between its stretches that touches
    // nothing on the way (two legs side by side all along, which a meander parts here and there, are one water)
    if (!j.bodies.length && j.runs.every((q) => q.river === j.runs[0].river)) {
      const r = j.runs[0].river;
      const line = lines[r]!;
      const runs = [...j.runs].sort((a, b) => a.from - b.from);
      for (let k = 1; k < runs.length; k++) {
        const wide = line.samples[runs[k - 1].last].width + line.samples[runs[k].first].width;
        if (runs[k].from - runs[k - 1].to <= Math.max(30, 3 * wide)) continue;
        let alone = true;
        for (let s = runs[k - 1].last + 1; s < runs[k].first && alone; s++) if (selfTouching[offsets[r] + s]) alone = false;
        if (alone) j.levels = false;
      }
    }
  }
  return { lines, junctions, junctionOf, runOf, index, bodies };
}

function riverLine(river: MapRiver): RiverLine | null {
  if (river.points.length < 2) return null;
  const samples = sampleRiver(river.points, STEP);
  const along = new Float64Array(samples.length);
  for (let k = 1; k < samples.length; k++) along[k] = along[k - 1] + Math.hypot(samples[k].x - samples[k - 1].x, samples[k].y - samples[k - 1].y);
  // sampleRiver starts each segment at its point: the point's sample is the count of the samples before it
  const at = new Int32Array(river.points.length);
  let k = 0;
  for (let s = 0; s < river.points.length - 1; s++) {
    at[s] = k;
    const a = river.points[s];
    const b = river.points[s + 1];
    k += Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP));
  }
  at[river.points.length - 1] = samples.length - 1;
  return { samples, along, at, cls: river.kind === 'lava' ? 'lava' : 'water' };
}

function sampleIndex(lines: readonly (RiverLine | null)[]): SampleIndex {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let maxHalf = 0;
  let count = 0;
  for (const line of lines) {
    for (const p of line?.samples ?? []) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
      maxHalf = Math.max(maxHalf, p.width / 2);
      count++;
    }
  }
  if (!count) return { cell: 1, x0: 0, y0: 0, columns: 0, rows: 0, starts: new Int32Array(1), itemRiver: new Int32Array(0), itemSample: new Int32Array(0), maxHalf: 0 };
  const cell = Math.max(8, maxHalf);
  const columns = Math.floor((x1 - x0) / cell) + 1;
  const rows = Math.floor((y1 - y0) / cell) + 1;
  const cellOf = (p: MapRiverPoint) => Math.floor((p.y - y0) / cell) * columns + Math.floor((p.x - x0) / cell);
  const starts = new Int32Array(columns * rows + 1);
  for (const line of lines) for (const p of line?.samples ?? []) starts[cellOf(p) + 1]++;
  for (let c = 0; c < columns * rows; c++) starts[c + 1] += starts[c];
  const fill = starts.slice(0, columns * rows);
  const itemRiver = new Int32Array(count);
  const itemSample = new Int32Array(count);
  lines.forEach((line, r) =>
    line?.samples.forEach((p, k) => {
      const n = fill[cellOf(p)]++;
      itemRiver[n] = r;
      itemSample[n] = k;
    }),
  );
  return { cell, x0, y0, columns, rows, starts, itemRiver, itemSample, maxHalf };
}

/** Each sample within `reach` metres of (x, y) by cell (some farther), as river and sample */
function eachNear(index: SampleIndex, x: number, y: number, reach: number, visit: (river: number, sample: number) => void): void {
  if (!index.columns) return;
  const i0 = Math.max(0, Math.floor((x - reach - index.x0) / index.cell));
  const i1 = Math.min(index.columns - 1, Math.floor((x + reach - index.x0) / index.cell));
  const j0 = Math.max(0, Math.floor((y - reach - index.y0) / index.cell));
  const j1 = Math.min(index.rows - 1, Math.floor((y + reach - index.y0) / index.cell));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const c = j * index.columns + i;
      for (let n = index.starts[c]; n < index.starts[c + 1]; n++) visit(index.itemRiver[n], index.itemSample[n]);
    }
  }
}

/** The body of class `cls` whose water stands at map (x, y) (its mask set, its level over the ground), -1 none */
function bodyAt(t: MapTerrain, bodies: readonly (MapWater | null)[], cls: WaterClass, x: number, y: number): number {
  const g = t.grid;
  const i = Math.round((x + t.width / 2) / g.cellSize);
  const j = Math.round((y + t.depth / 2) / g.cellSize);
  if (i < 0 || j < 0 || i >= g.columns || j >= g.rows) return -1;
  const k = j * g.columns + i;
  for (let b = 0; b < bodies.length; b++) {
    const body = bodies[b];
    if (body && body.mask[k] >= 128 && body.level > g.heights[k] && waterClass(body.kind) === cls) return b;
  }
  return -1;
}

/** Sets the rivers' levels so each junction is one water (see the top); true when a height changed */
export function joinRiverLevels(t: MapTerrain, network = riverNetwork(t)): boolean {
  const rivers = t.rivers ?? [];
  if (!network.junctions.length) return false;
  /** The distance along the river of each point */
  const pointAlong = rivers.map((r, k) => {
    const line = network.lines[k];
    return line ? Array.from(line.at, (s) => line.along[s]) : [];
  });
  const levelAt = (r: number, s: number) => {
    const pts = rivers[r].points;
    const along = pointAlong[r];
    let k = 1;
    while (k < pts.length - 1 && along[k] < s) k++;
    const f = Math.min(1, Math.max(0, (s - along[k - 1]) / Math.max(1e-6, along[k] - along[k - 1])));
    return pts[k - 1].height + (pts[k].height - pts[k - 1].height) * f;
  };
  const levelOf = (q: RiverRun, at: number) => levelAt(q.river, q.from + (q.to - q.from) * at);
  /** Past the run, a little way on: a river that feeds a junction stands higher there, one that drains it not */
  const beyond = (q: RiverRun) => levelAt(q.river, Math.min(q.to + 2 * STEP, pointAlong[q.river][pointAlong[q.river].length - 1]));
  const touched = new Set<number>();
  // Levels pass on through the junctions (a river lowered at one meets the next lower): a few rounds settle them
  for (let round = 0; round < 8; round++) {
    let moved = false;
    /** At most `level` from `from` metres along river `r` on, up to `to` */
    const lower = (r: number, from: number, level: number, to = Infinity) => {
      const pts = rivers[r].points;
      pointAlong[r].forEach((s, k) => {
        if (s >= from && s <= to && pts[k].height > level + TOL) {
          pts[k].height = level;
          touched.add(r);
          moved = true;
        }
      });
    };
    for (const j of network.junctions) {
      if (!j.levels) continue;
      const level = junctionLevel(j, network, levelOf);
      if (level === null) continue;
      // A single river running through (a mouth into it, a branch out of it) keeps its levels: it receives
      const receiving = !j.bodies.length && j.runs.filter((q) => q.role === 'through').length === 1;
      for (const q of j.runs) {
        if (q.role === 'whole') continue;
        if (q.role === 'through') {
          // One that drains the junction from where it enters on; one that feeds it only within it
          if (!receiving) lower(q.river, q.from, level, beyond(q) > level + TOL ? q.to : Infinity);
        } else if (q.role === 'start') lower(q.river, 0, level);
        else {
          // A river ending in the junction ends on its level: a drop spread over its course, or flat up to it; one
          // lower than a body it runs into keeps its levels and ends under its surface (raised, it would stand over
          // a shore the body's mask does not reach)
          const pts = rivers[q.river].points;
          const along = pointAlong[q.river];
          const over = levelAt(q.river, q.from) - level;
          if (over > TOL) {
            along.forEach((s, k) => (pts[k].height -= over * Math.min(1, s / Math.max(q.from, 1e-6))));
            touched.add(q.river);
            moved = true;
            lower(q.river, q.from, level);
          } else if (over < -TOL && !j.bodies.length) {
            pts.forEach((p) => {
              if (p.height < level - TOL) {
                p.height = level;
                touched.add(q.river);
                moved = true;
              }
            });
          }
        }
      }
    }
    if (!moved) break;
  }
  // Stored to the centimetre, as the brush and the import store them; rivers not touched stay as they are
  for (const r of touched) for (const p of rivers[r].points) p.height = Math.round(p.height * 100) / 100;
  return touched.size > 0;
}

/**
 * The one level of a junction: a body's (the lowest of several); else, where
 * rivers or stretches of one run through it side by side or across, the
 * lowest where one of them leaves it, so all of the junction stands on it; a
 * single river running through (a mouth into it, a branch out of it) gives
 * its own, where its run is halfway in; else those that leave it, else those
 * that end in it, each halfway in
 */
function junctionLevel(j: RiverJunction, network: RiverNetwork, levelOf: (q: RiverRun, at: number) => number): number | null {
  if (j.bodies.length) return Math.min(...j.bodies.map((b) => network.bodies[b]!.level));
  const through = j.runs.filter((q) => q.role === 'through');
  if (through.length > 1) return Math.min(...through.map((q) => levelOf(q, 1)));
  for (const role of ['through', 'start', 'end'] as const) {
    const runs = j.runs.filter((q) => q.role === role);
    if (runs.length) return Math.min(...runs.map((q) => levelOf(q, 0.5)));
  }
  return null;
}

/** Which of two runs of a junction draws where both bands lie: the receiving one, then the earlier river or stretch */
function draws(a: RiverRun, b: RiverRun): boolean {
  const rank = (q: RiverRun) => (q.role === 'through' || q.role === 'whole' ? 2 : q.role === 'start' ? 1 : 0);
  if (rank(a) !== rank(b)) return rank(a) > rank(b);
  if (a.river !== b.river) return a.river < b.river;
  return a.from < b.from;
}

/** What riverCover says of a ribbon's vertex */
export interface CoverAt {
  /**
   * 0 to 1: how far other water draws here instead (a body; the run that
   * draws, all through its band but its outer rim, where this one takes over)
   */
  cover: number;
  /**
   * 0 to 1: how far the water this one draws over goes on past here, so its
   * side stays open (no fade at its edge): two layers of the same water fading
   * across each other let the ground show through as a seam
   */
  open: number;
  /** The current of a run drawn here under this one, mixed in by `mix` (0 to 0.5), as map x and y in m/s */
  flowX: number;
  flowY: number;
  mix: number;
}

/** 1 below `a`, 0 above `b`, smooth between */
function fallOff(a: number, b: number, u: number): number {
  const t = Math.min(1, Math.max(0, (u - a) / (b - a)));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * How a vertex at map (x, y) of river `r`'s ribbon, in the row of sample `k`,
 * meets other water: covered by the water that draws there (cover), and
 * the current of a run it draws over (to mix into its own). `flow` gives a
 * sample's current as map (x, y) in m/s.
 */
export function riverCover(
  t: MapTerrain,
  network: RiverNetwork,
  r: number,
  k: number,
  x: number,
  y: number,
  flow: (river: number, sample: number) => readonly [number, number],
  out: CoverAt,
): CoverAt {
  out.cover = 0;
  out.open = 0;
  out.mix = 0;
  out.flowX = 0;
  out.flowY = 0;
  const j = network.junctionOf[r]?.[k] ?? -1;
  if (j < 0) return out;
  const junction = network.junctions[j];
  const run = junction.runs[network.runOf[r][k]];
  const line = network.lines[r]!;
  for (const b of junction.bodies) {
    const body = network.bodies[b]!;
    out.cover = Math.max(out.cover, bodyCover(t, body, x, y));
  }
  eachNear(network.index, x, y, network.index.maxHalf, (r2, k2) => {
    if (network.junctionOf[r2][k2] !== j) return;
    const other = junction.runs[network.runOf[r2][k2]];
    if (other === run) return;
    const samples = network.lines[r2]!.samples;
    const q = samples[k2];
    const u = Math.hypot(q.x - x, q.y - y) / (q.width / 2);
    if (u >= 1) return;
    // Not behind the first row of a ribbon or past its last (a river that starts where another ends)
    if (k2 === 0 || k2 === samples.length - 1) {
      const n = samples[k2 === 0 ? 1 : k2 - 1];
      if ((x - q.x) * (n.x - q.x) + (y - q.y) * (n.y - q.y) < 0) return;
    }
    // Of one river only the other stretch, not the neighbours of this sample along a bend
    if (r2 === r && Math.abs(network.lines[r2]!.along[k2] - line.along[k]) <= FOLD * Math.hypot(q.x - line.samples[k].x, q.y - line.samples[k].y) + 2 * STEP) return;
    if (draws(other, run)) {
      out.cover = Math.max(out.cover, fallOff(0.75, 0.95, u));
    } else {
      out.open = Math.max(out.open, fallOff(0.8, 0.95, u));
      const w = 0.5 * fallOff(0.5, 1, u);
      if (w > out.mix) {
        const [fx, fy] = flow(r2, k2);
        out.mix = w;
        out.flowX = fx;
        out.flowY = fy;
      }
    }
  });
  return out;
}

/** A body's water at map (x, y), 0 to 1 over a cell (its mask and level against the ground, bilinear) */
function bodyCover(t: MapTerrain, body: MapWater, x: number, y: number): number {
  const g = t.grid;
  const fi = (x + t.width / 2) / g.cellSize;
  const fj = (y + t.depth / 2) / g.cellSize;
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const at = (a: number, b: number) => {
    if (a < 0 || b < 0 || a >= g.columns || b >= g.rows) return 0;
    const k = b * g.columns + a;
    return body.mask[k] >= 128 && body.level > g.heights[k] ? 1 : 0;
  };
  const u = fi - i;
  const v = fj - j;
  return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
}
