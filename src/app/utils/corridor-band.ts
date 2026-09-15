import { CentreMode, corridorConfig, cutShortBulges } from './route-corridor';

/**
 * The walkable band along a route and the enemies' line in it (phase 2 of
 * the corridor, tmp/fix1/reports/phase2-design.md).
 *
 * A pure function of what the route build froze: the OSM line of a route,
 * how far the clearance rays leave room at each station, and the columns
 * (lowest and highest hit) at the grid cells around it. Nothing here reads
 * the engine, the grid or the camera, so the same input gives the same band.
 *
 * 1. **Backbone:** at each station, the lowest plausible cell across the
 *    line within the OSM half width plus BACKBONE_SLACK_M: off a car, a
 *    hedge or the roof of a jetty the OSM line runs over, onto the street
 *    beside it, within the rays' walls. Plausible: not a hollow object, a
 *    neighbour across within `stepRise`, so a single pit does not count (a
 *    lane one cell wide between the walls does), and street: at most
 *    `stepDrop` under the cell of the OSM line, or within `stepRise` of the
 *    line's cell a few stations along (not the river beside a quay, the
 *    slope of a dam, a ditch). A start more than `stepDrop` under the
 *    backbones around it along the route is picked again.
 * 2. **Band:** from the backbone out to each side, cell by cell across, with
 *    the walk of corridor-walk.ts (a step at most `stepRise` up and `stepDrop`
 *    down from the ground reached before, the cross slope allowed for). The
 *    band ends before the first cell no walk reaches, a hollow object, one
 *    more than `roofRise` over the backbone, or at the rays' wall. It does not
 *    flow round a small object on a square: it ends before it (user decision
 *    2026-09-16). Its edge lies midway between the last cell reached and the
 *    first one not, so claiming the cells of the band takes exactly those.
 * 3. **Enemies' line:** the middle of the band (`centreMode` `band`) or the
 *    OSM line where it lies in the band with `edgeMargin` to spare, else the
 *    nearest point that does (`minimal`), smoothed: a smoothing spline with a
 *    penalty on the bend (CENTRE_STIFFNESS), kept within `edgeMargin` of both
 *    edges. The report gives its steepest slope and tightest bend.
 * 4. **No band:** a backbone more than `roofRise` above the backbones along
 *    the route around it (a jetty or a roof the mesh fills down to the
 *    street, a crown down to the ground, with no street beside it) makes the
 *    station part of a passage, run as a tunnel. A lower object filling the
 *    lane is its own backbone: the band lies on it and enemies climb over it
 *    (decision E6).
 *
 * Stretches the band does not decide (a bridge, a tunnel, a stretch under
 * another way, the stretch off a bridge end, the leg to the HQ) keep the OSM
 * line and the rays' widths; the line joins them smoothly.
 */

/** A column as the band reads it: the lowest and the highest hit at a point, metres (local y). */
export interface BandColumn {
  ground: number;
  top: number;
}

/** The frozen columns: the column at a local point (a cell centre), null where the mesh has no hit. */
export type BandColumns = (x: number, z: number) => BandColumn | null;

/** One route as buildBand reads it, local x, z in travel order. */
export interface BandRoute {
  points: readonly { x: number; z: number }[];
  /**
   * Per segment: a street on the ground, where the band is built. Not a
   * bridge, a tunnel or covered passage, a stretch under another way, the
   * stretch off a bridge end or the leg to the HQ.
   */
  open: readonly boolean[];
  /** Per segment: half width of the OSM street; the backbone is looked for this plus BACKBONE_SLACK_M either side. */
  streetHalfWidth: readonly number[];
  /**
   * Per segment and station: how far the clearance rays leave room left and
   * right of the direction of travel, metres from the line (the fitted half
   * width, without the walk caps). Station k of n stands at (k + 0.5) / n of
   * its segment. An empty list: stations every `stationSpacing` at the
   * street half width.
   */
  wallLeft: readonly (readonly number[])[];
  wallRight: readonly (readonly number[])[];
}

/** What the band found at one station. Offsets are metres right of the direction of travel from the OSM line. */
export interface BandStation {
  segment: number;
  /** Station k of n on its segment. */
  k: number;
  n: number;
  /** Metres along the route. */
  s: number;
  /** On the OSM line, and the unit vector right of travel. */
  x: number;
  z: number;
  rx: number;
  rz: number;
  /**
   * `band`: a band from the backbone; `climb`: the same, the backbone on
   * something higher than a step over the backbones around it (a car filling
   * the lane); `passage`: none, run as a tunnel; `fixed`: a stretch the band
   * does not decide, or no column across at all.
   */
  kind: 'band' | 'climb' | 'passage' | 'fixed';
  /** The backbone cell: its offset and height; null without a band. */
  backbone: { offset: number; y: number } | null;
  /** Edges of the band (without a band: the rays' walls), left at most right. */
  left: number;
  right: number;
  /** The enemies' line. */
  centre: number;
}

/** The band of one route, see buildBand. */
export interface CorridorBand {
  stations: BandStation[];
  /** Metres along the route, stations in a passage and half a station either side. */
  passages: { from: number; to: number }[];
  /** Steepest change of the enemies' line (m per m) and its tightest bend (1 per m) over stations with a band. */
  maxSlope: number;
  maxCurvature: number;
}

/** How far past the OSM half width the backbone is looked for, metres: the OSM line of 732 ran 1 to 2 m off the middle of the street. */
export const BACKBONE_SLACK_M = 1.5;

/** Stations either way whose backbones the along filter takes the median of. */
const ALONG_FILTER_STATIONS = 2;

/**
 * Stations either way where the OSM line coming down to a cell makes it
 * street: 8 m, past a parked car or a van the line runs over.
 */
const LINE_REACH_STATIONS = 4;

/** Stations either way whose backbones give the street ground a passage is measured against. */
const PASSAGE_REACH_STATIONS = 4;

/**
 * Penalty on the bend of the enemies' line against keeping to its target,
 * per second difference of stations 2 m apart. 150 spreads a 3 m change of
 * the target over about 20 m of route: its tightest bend stays under the
 * worm's 1/20 m and its slope under 0.25 m per m where the band leaves room
 * (corridor-band.spec.ts).
 */
export const CENTRE_STIFFNESS = 150;

/** Step along the line across the route that finds the cells it crosses, metres. */
const CROSS_STEP_M = 0.25;

/** A lattice cell on the line across a station. */
interface CrossCell {
  x: number;
  z: number;
  /** Offset of its centre from the OSM line, right of travel positive. */
  u: number;
  column: BandColumn | null;
}

/** One station while the band is built. */
interface Work extends BandStation {
  cells: CrossCell[];
  /** Index of the backbone in `cells`, -1 without one. */
  b: number;
  wallL: number;
  wallR: number;
  window: number;
}

/** Whether `column` shows a low object over a hollow: its top more than `stepRise` and at most `roofRise` over its lowest hit. */
function hollow(column: BandColumn): boolean {
  const over = column.top - column.ground;
  return over > corridorConfig.stepRise && over <= corridorConfig.roofRise;
}

/**
 * The walkable band along `route` and the enemies' line in it, see the file
 * comment. `columns` must be a pure lookup (the frozen measurement); each
 * cell's column is read once. `mode`: corridorConfig.centreMode unless given.
 */
export function buildBand(route: BandRoute, columns: BandColumns, cellSize: number, mode: CentreMode = corridorConfig.centreMode): CorridorBand {
  const memo = new Map<string, BandColumn | null>();
  const columnAt = (gx: number, gz: number): BandColumn | null => {
    const key = `${gx},${gz}`;
    if (!memo.has(key)) memo.set(key, columns((gx + 0.5) * cellSize, (gz + 0.5) * cellSize));
    return memo.get(key)!;
  };
  const reach = corridorConfig.maxHalfWidth + cellSize;
  const stations = stationsOf(route, (x, z, rx, rz) => crossCells(x, z, rx, rz, reach, cellSize, columnAt));

  // Ground of the cell the OSM line runs through at each station, for what the line comes down to along the route.
  const line = stations.map((st) => {
    let best: CrossCell | null = null;
    for (const cell of st.cells) if (cell.column && (!best || Math.abs(cell.u) < Math.abs(best.u))) best = cell;
    return best?.column?.ground ?? null;
  });
  const { stepRise, stepDrop } = corridorConfig;
  /**
   * Whether a cell of station `k` with ground `g` may be a backbone: no more
   * than `stepDrop` under the line's cell there, or the line comes to
   * within `stepRise` of it within LINE_REACH_STATIONS along the route. The
   * street between two parked cars the line runs over does; a river beside
   * a quay, a ditch, a sunken path or the slope of a dam does not.
   */
  const onStreet = (k: number, g: number): boolean => {
    const own = line[k];
    if (own !== null && g >= own - stepDrop) return true;
    for (let j = Math.max(0, k - LINE_REACH_STATIONS); j <= Math.min(stations.length - 1, k + LINE_REACH_STATIONS); j++) {
      const y = line[j];
      if (y !== null && stations[j].kind !== 'fixed' && Math.abs(y - g) <= stepRise) return true;
    }
    return false;
  };

  stations.forEach((st, k) => {
    if (st.kind !== 'fixed') pickBackbone(st, (g) => onStreet(k, g));
  });
  filterBackbones(stations, onStreet);
  markPassages(stations);
  for (const st of stations) walkBand(st);
  cutBulges(stations);
  taperEdges(stations);
  placeCentre(stations, mode);

  const passages: { from: number; to: number }[] = [];
  for (let k = 0; k < stations.length; k++) {
    if (stations[k].kind !== 'passage') continue;
    const half = halfStation(stations, k);
    const last = passages[passages.length - 1];
    if (last && k > 0 && stations[k - 1].kind === 'passage') last.to = stations[k].s + half;
    else passages.push({ from: stations[k].s - half, to: stations[k].s + half });
  }
  const { maxSlope, maxCurvature } = shapeOf(stations);
  return {
    stations: stations.map(({ cells: _cells, b: _b, wallL: _l, wallR: _r, window: _w, ...st }) => st),
    passages,
    maxSlope,
    maxCurvature,
  };
}

/** Half the distance to the neighbouring stations of station `k`. */
function halfStation(stations: readonly BandStation[], k: number): number {
  const before = k > 0 ? stations[k].s - stations[k - 1].s : Infinity;
  const after = k + 1 < stations.length ? stations[k + 1].s - stations[k].s : Infinity;
  const d = Math.min(before, after);
  return Number.isFinite(d) ? d / 2 : corridorConfig.stationSpacing / 2;
}

/** The stations of `route` with their cells across (`across`). */
function stationsOf(
  route: BandRoute,
  across: (x: number, z: number, rx: number, rz: number) => CrossCell[],
): Work[] {
  const { points } = route;
  const result: Work[] = [];
  let start = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length <= 0) continue;
    const rx = -(b.z - a.z) / length;
    const rz = (b.x - a.x) / length;
    const measured = route.wallLeft[i]?.length ?? 0;
    const n = measured > 0 ? measured : Math.max(1, Math.round(length / corridorConfig.stationSpacing));
    const street = route.streetHalfWidth[i];
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const wall = (list: readonly number[] | undefined) => {
        const v = measured > 0 ? list![k] : street;
        return Number.isFinite(v) ? v : street;
      };
      const wallL = wall(route.wallLeft[i]);
      const wallR = wall(route.wallRight[i]);
      result.push({
        segment: i, k, n, s: start + length * t, x, z, rx, rz,
        kind: route.open[i] ? 'band' : 'fixed',
        backbone: null, left: -wallL, right: wallR, centre: 0,
        cells: route.open[i] ? across(x, z, rx, rz) : [], b: -1, wallL, wallR, window: street + BACKBONE_SLACK_M,
      });
    }
    start += length;
  }
  return result;
}

/** The lattice cells the line across a station crosses, from `reach` left to `reach` right, in that order. */
function crossCells(
  x: number, z: number, rx: number, rz: number, reach: number, cellSize: number,
  columnAt: (gx: number, gz: number) => BandColumn | null,
): CrossCell[] {
  const cells: CrossCell[] = [];
  let lastX = NaN;
  let lastZ = NaN;
  for (let u = -reach; u <= reach + 1e-9; u += CROSS_STEP_M) {
    const gx = Math.floor((x + rx * u) / cellSize);
    const gz = Math.floor((z + rz * u) / cellSize);
    if (gx === lastX && gz === lastZ) continue;
    lastX = gx;
    lastZ = gz;
    const cx = (gx + 0.5) * cellSize;
    const cz = (gz + 0.5) * cellSize;
    cells.push({ x: cx, z: cz, u: (cx - x) * rx + (cz - z) * rz, column: columnAt(gx, gz) });
  }
  return cells;
}

/**
 * The cells of `st` a backbone may stand on: within its window and the rays'
 * walls (the cell the line runs through always), with a column, not hollow,
 * `onStreet` with its ground, and a neighbour across within `stepRise`
 * unless no neighbour lies within the walls (a lane one cell wide).
 */
function backboneCandidates(st: Work, onStreet: (ground: number) => boolean): number[] {
  const { stepRise } = corridorConfig;
  let line = 0;
  st.cells.forEach((cell, j) => {
    if (Math.abs(cell.u) < Math.abs(st.cells[line].u)) line = j;
  });
  const within = (j: number) => j === line || (st.cells[j].u >= -st.wallL && st.cells[j].u <= st.wallR);
  const found: number[] = [];
  st.cells.forEach((cell, j) => {
    if (!within(j) || Math.abs(cell.u) > st.window || cell.column === null || hollow(cell.column) || !onStreet(cell.column.ground)) return;
    const g = cell.column.ground;
    const near = [j - 1, j + 1].filter((i) => i >= 0 && i < st.cells.length && within(i) && st.cells[i].column !== null);
    if (near.length === 0 || near.some((i) => Math.abs(st.cells[i].column!.ground - g) <= stepRise)) found.push(j);
  });
  return found;
}

/** The lowest of `candidates` in `st` at least `floor` high; ties to the one nearest the line. -1 without one. */
function lowest(st: Work, candidates: readonly number[], floor = -Infinity): number {
  let best = -1;
  for (const j of candidates) {
    const g = st.cells[j].column!.ground;
    if (g < floor) continue;
    if (best < 0) {
      best = j;
      continue;
    }
    const bg = st.cells[best].column!.ground;
    if (g < bg - 0.01 || (Math.abs(g - bg) <= 0.01 && Math.abs(st.cells[j].u) < Math.abs(st.cells[best].u))) best = j;
  }
  return best;
}

/** The backbone of `st`, see the file comment; `fixed` where no cell across has a plausible column. */
function pickBackbone(st: Work, onStreet: (ground: number) => boolean): void {
  st.b = lowest(st, backboneCandidates(st, onStreet));
  if (st.b < 0) {
    st.kind = 'fixed';
    return;
  }
  const cell = st.cells[st.b];
  st.backbone = { offset: cell.u, y: cell.column!.ground };
}

/** Median of the backbone heights of the stations within `reach` of `k` that have one, `k` itself left out unless `self`. */
function backboneMedian(stations: readonly Work[], k: number, reach: number, self: boolean): number | null {
  const heights: number[] = [];
  for (let j = Math.max(0, k - reach); j <= Math.min(stations.length - 1, k + reach); j++) {
    if (j === k && !self) continue;
    const y = stations[j].backbone?.y;
    if (y !== undefined) heights.push(y);
  }
  if (heights.length === 0) return null;
  heights.sort((a, b) => a - b);
  return heights[Math.floor((heights.length - 1) / 2)];
}

/** A backbone more than `stepDrop` under the median of those around it (a drain, a hole in the mesh) is picked again above that. */
function filterBackbones(stations: Work[], onStreet: (k: number, ground: number) => boolean): void {
  const medians = stations.map((_, k) => backboneMedian(stations, k, ALONG_FILTER_STATIONS, true));
  stations.forEach((st, k) => {
    const median = medians[k];
    if (!st.backbone || median === null || st.backbone.y >= median - corridorConfig.stepDrop) return;
    const j = lowest(st, backboneCandidates(st, (g) => onStreet(k, g)), median - corridorConfig.stepDrop);
    if (j < 0) return;
    st.b = j;
    st.backbone = { offset: st.cells[j].u, y: st.cells[j].column!.ground };
  });
}

/** Stations whose backbone lies more than `roofRise` over those around them become a passage, more than `stepRise` a climb. */
function markPassages(stations: Work[]): void {
  const medians = stations.map((_, k) => backboneMedian(stations, k, PASSAGE_REACH_STATIONS, false));
  stations.forEach((st, k) => {
    const median = medians[k];
    if (!st.backbone || median === null) return;
    const over = st.backbone.y - median;
    if (over > corridorConfig.roofRise) {
      st.kind = 'passage';
      st.backbone = null;
      st.b = -1;
    } else if (over > corridorConfig.stepRise) {
      st.kind = 'climb';
    }
  });
}

/** The edges of the band of `st` (band and climb), see the file comment. */
function walkBand(st: Work): void {
  if (st.b < 0) return;
  const toRight = st.cells[st.b + 1]?.column ?? null;
  const toLeft = st.cells[st.b - 1]?.column ?? null;
  st.right = walkSide(st, 1, crossSlope(st, 1, toRight, toLeft));
  st.left = walkSide(st, -1, crossSlope(st, -1, toLeft, toRight));
}

/**
 * Rise per metre of the ground across `st` towards side `dir`, from the
 * backbone's neighbour on that side (`toward`) and on the other (`away`):
 * where it rises towards the side about as much as it falls on the other,
 * or falls about as much as it rises there (the two within `stepRise` over a
 * cell), the smaller of the two, negative where it falls; else 0. As
 * crossSlope in corridor-walk.ts, from the backbone.
 */
function crossSlope(st: Work, dir: number, toward: BandColumn | null, away: BandColumn | null): number {
  const b = st.cells[st.b];
  const t = st.cells[st.b + dir];
  const a = st.cells[st.b - dir];
  if (!toward || !away || !t || !a) return 0;
  const y = b.column!.ground;
  const out = (toward.ground - y) / Math.max(1e-6, Math.abs(t.u - b.u));
  const back = (y - away.ground) / Math.max(1e-6, Math.abs(b.u - a.u));
  const cell = Math.hypot(t.x - b.x, t.z - b.z);
  if (out * back <= 0 || Math.abs(out - back) * cell > corridorConfig.stepRise) return 0;
  return Math.sign(out) * Math.min(Math.abs(out), Math.abs(back));
}

/**
 * The edge of the band of `st` on side `dir` (1 right, -1 left): the walk of
 * corridor-walk.ts from the backbone out, cell by cell, `slope` the cross
 * slope towards the side per metre. A cell counts as reached where its
 * ground lies at most `stepRise` above the highest ground reached (each
 * carried down a falling slope to the backbone) or the last one plus the
 * rise since, and at most `stepDrop` below the lowest reached or the last one
 * less the fall since. A cell without a column (a hole in the mesh) is passed
 * over. The first cell not reached, hollow, or more than `roofRise` over the
 * backbone ends the band midway to the last one reached; the rays' wall ends
 * it at the wall.
 */
function walkSide(st: Work, dir: number, slope: number): number {
  const { stepRise, stepDrop, roofRise } = corridorConfig;
  const wall = dir > 0 ? st.wallR : -st.wallL;
  const start = st.cells[st.b];
  const y0 = start.column!.ground;
  const rise = Math.max(0, slope);
  const fall = Math.min(0, slope);
  let high = y0;
  let bottom = y0;
  let last = y0;
  let lastD = 0;
  let lastU = start.u;
  for (let j = st.b + dir; j >= 0 && j < st.cells.length; j += dir) {
    const cell = st.cells[j];
    if (dir * (cell.u - wall) > 0) return wall;
    const d = Math.abs(cell.u - start.u);
    if (cell.column === null) {
      lastU = cell.u;
      continue;
    }
    const g = cell.column.ground;
    const ceiling = Math.max(high + fall * d, last + rise * (d - lastD)) + stepRise;
    const floor = Math.min(bottom, last + fall * (d - lastD)) - stepDrop;
    if (hollow(cell.column) || g - y0 > roofRise || g > ceiling || g < floor) return (lastU + cell.u) / 2;
    last = g;
    lastD = d;
    high = Math.max(high, g - fall * d);
    bottom = Math.min(bottom, g);
    lastU = cell.u;
  }
  return wall;
}

/**
 * Short bulges of the band along the route cut, each side on its own, as the
 * clearance fitting cuts them (cutShortBulges, `bulgeLength`): the gap
 * between two parked cars, a driveway. The band keeps its backbone.
 */
function cutBulges(stations: Work[]): void {
  const banded = (st: Work) => st.kind === 'band' || st.kind === 'climb';
  for (const side of ['left', 'right'] as const) {
    const values = stations.map((st) => (banded(st) ? (side === 'left' ? -st.left : st.right) : NaN));
    const cut = cutShortBulges(values);
    stations.forEach((st, k) => {
      if (!banded(st) || Number.isNaN(cut[k])) return;
      const b = st.backbone!.offset;
      if (side === 'left') st.left = Math.min(b, -cut[k]);
      else st.right = Math.max(b, cut[k]);
    });
  }
}

/**
 * The band's edges rise along the route by at most `taper` per metre, as the
 * lateral limits of the enemies do (buildSideLimits): the band narrows
 * before what ends it instead of jumping sideways at one station. Without it
 * the round end of the cells of a wide station half a car length away sweeps
 * over the car the band ends before (jointCap only caps the next segment).
 * Both ways, as a min-plus distance transform; a station without a band
 * (a passage, a tunnel, a bridge) keeps the rays' wall but tapers the band
 * beside it. The backbone stays inside.
 */
function taperEdges(stations: Work[]): void {
  const { taper } = corridorConfig;
  for (const side of ['left', 'right'] as const) {
    const out = stations.map((st) => (side === 'left' ? -st.left : st.right));
    for (let k = 1; k < stations.length; k++) out[k] = Math.min(out[k], out[k - 1] + taper * (stations[k].s - stations[k - 1].s));
    for (let k = stations.length - 2; k >= 0; k--) out[k] = Math.min(out[k], out[k + 1] + taper * (stations[k + 1].s - stations[k].s));
    stations.forEach((st, k) => {
      if (st.kind !== 'band' && st.kind !== 'climb') return;
      const b = st.backbone!.offset;
      if (side === 'left') st.left = Math.min(b, -out[k]);
      else st.right = Math.max(b, out[k]);
    });
  }
}

/**
 * The enemies' line of every station: its target (the middle of the band,
 * or in `minimal` mode the OSM line moved into the band only as far as
 * needed), kept within `edgeMargin` of both edges (the middle where the
 * band is narrower), smoothed along the route (smoothCentre). Stations
 * without a band keep the OSM line, and so do both ends of the route.
 */
function placeCentre(stations: Work[], mode: CentreMode): void {
  const e = corridorConfig.edgeMargin;
  const n = stations.length;
  const target: number[] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  const pinned: boolean[] = [];
  stations.forEach((st, k) => {
    const banded = st.kind === 'band' || st.kind === 'climb';
    const pin = !banded || k === 0 || k === n - 1;
    let low = st.left + e;
    let high = st.right - e;
    if (low > high) low = high = (st.left + st.right) / 2;
    const middle = (st.left + st.right) / 2;
    target.push(pin ? 0 : mode === 'band' ? middle : Math.min(high, Math.max(low, 0)));
    lo.push(pin ? 0 : low);
    hi.push(pin ? 0 : high);
    pinned.push(pin);
  });
  const centre = smoothCentre(target, lo, hi, pinned, CENTRE_STIFFNESS);
  stations.forEach((st, k) => {
    st.centre = centre[k];
  });
}

/**
 * The line c nearest to `target` with a penalty `stiffness` on its second
 * differences, within [lo, hi] at every station and exactly `target` where
 * `pinned`: a smoothing spline with bounds. Solved exactly on the
 * five-diagonal system, the bounds by an active set: a station outside its
 * bound is held on it, one held where the line would move inwards is let go,
 * one at a time, until neither is left. Deterministic.
 */
export function smoothCentre(target: readonly number[], lo: readonly number[], hi: readonly number[], pinned: readonly boolean[], stiffness: number): number[] {
  const n = target.length;
  if (n === 0) return [];
  // Band matrix A = I + stiffness * D'D, row i holding columns i-2 .. i+2.
  const A = Array.from({ length: n }, () => new Float64Array(5));
  for (let i = 0; i < n; i++) A[i][2] = 1;
  const coef = [1, -2, 1];
  for (let j = 1; j < n - 1; j++) {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) A[j - 1 + a][2 + (b - a)] += stiffness * coef[a] * coef[b];
    }
  }
  const held = new Map<number, number>();
  pinned.forEach((pin, k) => {
    if (pin) held.set(k, target[k]);
  });
  let c = solveBand(A, target, held);
  for (let round = 0; round < 4 * n + 10; round++) {
    let worst = -1;
    let worstBy = 1e-9;
    for (let k = 0; k < n; k++) {
      if (held.has(k)) continue;
      const by = Math.max(lo[k] - c[k], c[k] - hi[k]);
      if (by > worstBy) {
        worst = k;
        worstBy = by;
      }
    }
    if (worst >= 0) {
      held.set(worst, c[worst] < lo[worst] ? lo[worst] : hi[worst]);
      c = solveBand(A, target, held);
      continue;
    }
    // Every free station within its bounds: let go the held one pulled inwards hardest.
    let release = -1;
    let releaseBy = 1e-9;
    for (const [k, v] of held) {
      if (pinned[k] || lo[k] === hi[k]) continue;
      let g = -target[k];
      for (let d = -2; d <= 2; d++) if (k + d >= 0 && k + d < n) g += A[k][2 + d] * c[k + d];
      const inwards = v === lo[k] ? -g : g;
      if (inwards > releaseBy) {
        release = k;
        releaseBy = inwards;
      }
    }
    if (release < 0) break;
    held.delete(release);
    c = solveBand(A, target, held);
  }
  return c;
}

/** Solve A c = target (A a symmetric band matrix, see smoothCentre) with the stations in `held` fixed at their values. */
function solveBand(A: readonly Float64Array[], target: readonly number[], held: ReadonlyMap<number, number>): number[] {
  const n = target.length;
  const m = A.map((row) => Float64Array.from(row));
  const rhs = [...target];
  for (const [k, v] of held) {
    for (let d = -2; d <= 2; d++) {
      const i = k + d;
      if (d === 0 || i < 0 || i >= n) continue;
      rhs[i] -= m[i][2 - d] * v;
      m[i][2 - d] = 0;
      m[k][2 + d] = 0;
    }
    m[k][2] = 1;
    rhs[k] = v;
  }
  // Gaussian elimination on the band, no pivoting (symmetric, positive definite).
  for (let k = 0; k < n; k++) {
    for (let i = k + 1; i <= Math.min(k + 2, n - 1); i++) {
      const f = m[i][2 + (k - i)] / m[k][2];
      if (f === 0) continue;
      for (let j = k; j <= Math.min(k + 2, n - 1); j++) m[i][2 + (j - i)] -= f * m[k][2 + (j - k)];
      rhs[i] -= f * rhs[k];
    }
  }
  const c = new Array<number>(n).fill(0);
  for (let k = n - 1; k >= 0; k--) {
    let v = rhs[k];
    for (let j = k + 1; j <= Math.min(k + 2, n - 1); j++) v -= m[k][2 + (j - k)] * c[j];
    c[k] = v / m[k][2];
  }
  return c;
}

/** Steepest slope and tightest bend of the enemies' line over neighbouring stations with a band. */
function shapeOf(stations: readonly BandStation[]): { maxSlope: number; maxCurvature: number } {
  const banded = (st: BandStation | undefined) => st !== undefined && (st.kind === 'band' || st.kind === 'climb');
  let maxSlope = 0;
  let maxCurvature = 0;
  for (let k = 0; k + 1 < stations.length; k++) {
    const a = stations[k];
    const b = stations[k + 1];
    if (!banded(a) || !banded(b)) continue;
    maxSlope = Math.max(maxSlope, Math.abs(b.centre - a.centre) / (b.s - a.s));
    const c = stations[k + 2];
    if (!banded(c)) continue;
    const h1 = b.s - a.s;
    const h2 = c.s - b.s;
    const second = ((c.centre - b.centre) / h2 - (b.centre - a.centre) / h1) / ((h1 + h2) / 2);
    maxCurvature = Math.max(maxCurvature, Math.abs(second));
  }
  return { maxSlope, maxCurvature };
}

/** A point of the enemies' line, local x, z, with what holds for the piece from it to the next point. */
export interface BandPoint {
  x: number;
  z: number;
  /** Segment of the route the piece lies on. */
  segment: number;
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
 * route's end. The half widths of a piece are those of the band at its ends,
 * the narrower of the two; in a passage the street's half width.
 */
export function bandPath(route: BandRoute, band: CorridorBand): BandPoint[] {
  const { points } = route;
  const { stations } = band;
  if (points.length < 2 || stations.length === 0) return [];
  const widths = (st: BandStation) => (st.kind === 'passage'
    ? { left: route.streetHalfWidth[st.segment], right: route.streetHalfWidth[st.segment] }
    : { left: st.centre - st.left, right: st.right - st.centre });
  interface Node { x: number; z: number; segment: number; left: number; right: number; passage: boolean }
  const nodes: Node[] = [];
  const first = stations[0];
  nodes.push({ x: points[0].x, z: points[0].z, segment: first.segment, ...widths(first), passage: first.kind === 'passage' });
  for (let k = 0; k < stations.length; k++) {
    const st = stations[k];
    const next = stations[k + 1];
    nodes.push({ x: st.x + st.rx * st.centre, z: st.z + st.rz * st.centre, segment: st.segment, ...widths(st), passage: st.kind === 'passage' });
    if (!next || next.segment === st.segment) continue;
    // The point between the two segments, along the mitre of their right vectors.
    const joint = points[next.segment];
    const f = (Math.hypot(joint.x - st.x, joint.z - st.z)) / Math.max(1e-6, next.s - st.s);
    const offset = st.centre + (next.centre - st.centre) * Math.min(1, Math.max(0, f));
    const dot = st.rx * next.rx + st.rz * next.rz;
    const scale = 1 + dot > 0.2 ? 1 / (1 + dot) : 0.5;
    const wa = widths(st);
    const wb = widths(next);
    nodes.push({
      x: joint.x + (st.rx + next.rx) * scale * offset,
      z: joint.z + (st.rz + next.rz) * scale * offset,
      segment: next.segment,
      left: Math.min(wa.left, wb.left),
      right: Math.min(wa.right, wb.right),
      passage: st.kind === 'passage' && next.kind === 'passage',
    });
  }
  const end = points[points.length - 1];
  const lastSt = stations[stations.length - 1];
  nodes.push({ x: end.x, z: end.z, segment: lastSt.segment, ...widths(lastSt), passage: false });
  // A piece takes the narrower half widths of its two ends.
  return nodes.map((node, i) => {
    const next = nodes[i + 1];
    if (!next) return node;
    return { ...node, left: Math.min(node.left, next.left), right: Math.min(node.right, next.right), passage: node.passage || next.passage };
  });
}
