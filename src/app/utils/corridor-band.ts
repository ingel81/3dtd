import { CentreMode, corridorConfig, cutShortBulges } from './route-corridor';
import { segmentTouchesCell } from './route-grid-builder';

/**
 * The walkable band along a route and the enemies' line in it (phase 2 of
 * the corridor, tmp/fix1/reports/phase2-design.md).
 *
 * A pure function of what the route build froze: the OSM line of a route,
 * how far the clearance rays leave room at each station, and the columns
 * (lowest and highest hit) at the grid cells around it. Nothing here reads
 * the engine, the grid or the camera, so the same input gives the same band.
 *
 * 1. **Backbone:** at each station, the plausible cells across the line
 *    within the OSM half width plus BACKBONE_SLACK_M and the rays' walls.
 *    Plausible: not a hollow object, a neighbour across within `stepRise`,
 *    so a single pit does not count (a lane one cell wide between the walls
 *    does), and street: at most `stepDrop` under the cell of the OSM line, or
 *    within `stepRise` of the line's cell a few stations along (not the river
 *    beside a quay, the slope of a dam, a ditch). Cells more than `stepDrop`
 *    under the lowest cells of the stations around (their median: a drain, a
 *    hole in the mesh) drop out, unless none is left. The band walked from
 *    the lowest, then from the lowest it does not reach, and so on, are the
 *    ways across; the route takes one per station as a chain
 *    (chainSections): off a car, a hedge or the roof of a jetty the OSM line
 *    runs over, onto the street beside it, and on one side of what stands
 *    between two ways.
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
 * 4. **No band:** a backbone more than `roofRise` above the street under the
 *    station (`street`, streetLevel: the backbones with what covers the lane
 *    taken out), or a cell that high on the line it lays, makes the station
 *    part of a passage, run as a tunnel: a jetty or a roof the mesh fills
 *    down to the street, an archway, a gate tower. So do a few metres
 *    between two passages, or between a passage and a tunnel from OSM. A
 *    lower object filling the lane is its own backbone: the band lies on it
 *    and enemies climb over it (decision E6).
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
  /**
   * Per segment: under cover from OSM, a tunnel, a covered passage or a
   * stretch under another way. A passage the band finds next to one is
   * part of it (closePassageGaps, CorridorBand.passages).
   */
  covered: readonly boolean[];
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
  /**
   * The ground of the street under the station, whatever stands over it
   * (streetLevel). The backbone is judged against it (a passage, a climb),
   * and a tunnel portal takes it instead of a hit on a roof over the street
   * (portalGround). Null where no station of the route has a backbone.
   */
  street: number | null;
  /** Edges of the band (without a band: the rays' walls), left at most right. */
  left: number;
  right: number;
  /** The enemies' line. */
  centre: number;
}

/** The band of one route, see buildBand. */
export interface CorridorBand {
  stations: BandStation[];
  /**
   * Metres along the route, stations in a passage and half a station either
   * side. A passage next to a stretch under cover from OSM lengthens that
   * stretch (the mesh of a gate tower past the mouth of its archway) and is
   * not listed: where the lattice lies decides by a station whether there is
   * one at all.
   */
  passages: { from: number; to: number }[];
  /** Steepest change of the enemies' line (m per m) and its tightest bend (1 per m) over stations with a band. */
  maxSlope: number;
  maxCurvature: number;
}

/** How far past the OSM half width the backbone is looked for, metres: the OSM line of 732 ran 1 to 2 m off the middle of the street. */
export const BACKBONE_SLACK_M = 1.5;

/** Stations either way whose lowest backbone candidates the along filter takes the median of (withoutPits). */
const ALONG_FILTER_STATIONS = 2;

/**
 * Stations either way where the OSM line coming down to a cell makes it
 * street: 8 m, past a parked car or a van the line runs over.
 */
const LINE_REACH_STATIONS = 4;

/**
 * Metres of route the street under a station is found over (streetLevel).
 * What covers the lane for less than this is taken out of the backbones; a
 * gate tower is some 6 to 12 m deep along the street, an archway through a
 * house about as much, and the mesh of either reaches a few metres further.
 */
export const PASSAGE_SPAN_M = 30;

/**
 * Penalty on the bend of the enemies' line against keeping to its target,
 * per second difference of stations 2 m apart. The line follows a change of
 * the target over about `stationSpacing * stiffness^(1/4) * sqrt(2)` of
 * route, so 150 spreads one over some 10 m: a 3 m change bends less than
 * the worm's 1/20 m and moves less than 0.25 m per m where the band leaves
 * room (corridor-band.spec.ts). The band's edges bound the line whatever
 * the stiffness, so a stiffer one does not leave the band; it only reaches
 * the middle later.
 */
export const CENTRE_STIFFNESS = 150;

/**
 * Longest gap along the route between two passages, or a passage and a
 * stretch under cover from OSM, that becomes part of the passage, metres
 * (closePassageGaps): two stations. What covers a lane is judged in 2 m
 * cells, so where the lattice lies decides by a cell whether the edge of a
 * cover still reaches a station's line, and a surface of the cover within
 * `roofRise` of the street (an arch, a lower roof) can give a station or two
 * a backbone on it. Neither splits one passage into two any more.
 */
const PASSAGE_GAP_M = 4;

/**
 * How far past its square the band counts a cell as one its line runs
 * through, metres: the line reaches the grid through latitude and longitude
 * (PathAndRouteService.laidInBand), so a point can come back off by a few
 * micrometres, and a cell the line only touches at a corner is claimed
 * (claimSegmentCells).
 */
const CLAIM_MARGIN_M = 1e-3;

/** Step along the line across the route that finds the cells it crosses, metres. */
const CROSS_STEP_M = 0.25;

/**
 * Rounds of placing the enemies' line and tapering the room beside it: the
 * two depend on each other, and the second round settles them (the line
 * moves by centimetres in it).
 */
const CENTRE_ROUNDS = 2;

/** A lattice cell on the line across a station. */
interface CrossCell {
  x: number;
  z: number;
  /** Offset of its centre from the OSM line, right of travel positive. */
  u: number;
  column: BandColumn | null;
}

/**
 * A way across a station: a backbone and the band walked out from it. Two
 * ways of a station lie beside each other, parted by what ended the walk of
 * each (a hollow object, a step, a drop).
 */
interface Section {
  /** Index of the backbone in the station's cells. */
  b: number;
  left: number;
  right: number;
}

/** One station while the band is built. */
interface Work extends BandStation {
  cells: CrossCell[];
  /** The ways across, lowest backbone first (sectionsOf). */
  sections: Section[];
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

  // Ground of the cell across whose centre lies nearest the OSM line at each
  // station, for what the line comes down to along the route.
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

  const candidates = withoutPits(stations, stations.map((st, k) => (st.kind === 'fixed' ? [] : backboneCandidates(st, (g) => onStreet(k, g)))));
  stations.forEach((st, k) => {
    st.sections = sectionsOf(st, candidates[k]);
    if (st.sections.length === 0) st.kind = 'fixed';
  });
  chainSections(stations);
  const street = streetLevel(stations);
  stations.forEach((st, k) => {
    st.street = street[k];
  });
  // Passages, band and line, until the line runs through no cell on a cover
  // outside a passage (coveredOnLine). Each round starts from the walk and
  // only adds stations, so it ends.
  const walked = stations.map(({ kind, backbone, b, left, right }) => ({ kind, backbone, b, left, right }));
  const underCover = new Set<number>();
  for (;;) {
    stations.forEach((st, k) => Object.assign(st, walked[k]));
    markPassages(stations, route, underCover);
    cutBulges(stations);
    taperEdges(stations);
    // The line and the room beside it settle together: the line moves within
    // the band, so the room changes faster than the edges do (taperWidths).
    for (let round = 0; round < CENTRE_ROUNDS; round++) {
      placeCentre(stations, mode);
      taperWidths(stations);
    }
    const found = coveredOnLine(route, stations, columnAt, cellSize).filter((k) => !underCover.has(k));
    if (found.length === 0) break;
    for (const k of found) underCover.add(k);
  }

  // Runs of passage stations; one next to a stretch under cover from OSM is part of that stretch.
  const passages: { from: number; to: number }[] = [];
  const nextToCover = (k: number) => stations[k] !== undefined && route.covered[stations[k].segment];
  for (let k = 0; k < stations.length; k++) {
    if (stations[k].kind !== 'passage') continue;
    let end = k;
    while (end + 1 < stations.length && stations[end + 1].kind === 'passage') end++;
    if (!nextToCover(k - 1) && !nextToCover(end + 1)) {
      passages.push({ from: stations[k].s - halfStation(stations, k), to: stations[end].s + halfStation(stations, end) });
    }
    k = end;
  }
  const { maxSlope, maxCurvature } = shapeOf(stations);
  return {
    stations: stations.map(({ cells: _cells, sections: _sections, b: _b, wallL: _l, wallR: _r, window: _w, ...st }) => st),
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
        backbone: null, street: null, left: -wallL, right: wallR, centre: 0,
        cells: route.open[i] ? across(x, z, rx, rz) : [], sections: [], b: -1, wallL, wallR, window: street + BACKBONE_SLACK_M,
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

/** The lowest of `candidates` in `st`; ties to the one nearest the line. -1 without one. */
function lowest(st: Work, candidates: readonly number[]): number {
  let best = -1;
  for (const j of candidates) {
    if (best < 0) {
      best = j;
      continue;
    }
    const g = st.cells[j].column!.ground;
    const bg = st.cells[best].column!.ground;
    if (g < bg - 0.01 || (Math.abs(g - bg) <= 0.01 && Math.abs(st.cells[j].u) < Math.abs(st.cells[best].u))) best = j;
  }
  return best;
}

/**
 * The backbone candidates of every station without those more than
 * `stepDrop` under the median of the lowest candidates within
 * ALONG_FILTER_STATIONS of it (a drain, a hole in the mesh), unless that
 * leaves none.
 */
function withoutPits(stations: readonly Work[], candidates: readonly (readonly number[])[]): (readonly number[])[] {
  const lows = stations.map((st, k) => {
    const j = lowest(st, candidates[k]);
    return j < 0 ? null : st.cells[j].column!.ground;
  });
  return candidates.map((list, k) => {
    if (lows[k] === null) return list;
    const heights: number[] = [];
    for (let j = Math.max(0, k - ALONG_FILTER_STATIONS); j <= Math.min(stations.length - 1, k + ALONG_FILTER_STATIONS); j++) {
      if (lows[j] !== null) heights.push(lows[j]!);
    }
    heights.sort((a, b) => a - b);
    const floor = heights[Math.floor((heights.length - 1) / 2)] - corridorConfig.stepDrop;
    if (lows[k]! >= floor) return list;
    const kept = list.filter((j) => stations[k].cells[j].column!.ground >= floor);
    return kept.length > 0 ? kept : list;
  });
}

/**
 * The ways across `st` (Section): the band walked from the lowest of
 * `candidates`, then from the lowest candidate no band so far reaches, until
 * every candidate lies in one. Lowest backbone first.
 */
function sectionsOf(st: Work, candidates: readonly number[]): Section[] {
  const sections: Section[] = [];
  let open = candidates;
  while (open.length > 0) {
    const b = lowest(st, open);
    const section = { b, ...walkBand(st, b) };
    sections.push(section);
    open = open.filter((j) => j !== b && (st.cells[j].u < section.left || st.cells[j].u > section.right));
  }
  return sections;
}

/** What a chain of ways across costs so far (chainSections), compared in this order. */
interface ChainCost {
  /** Changes between ways that do not overlap: the line crosses what ended their walks. */
  crossings: number;
  /** Metres the backbones stand more than `stepRise` over the lowest backbone across their station, summed. */
  raised: number;
  /** Metres the ways lie off the OSM line, summed. */
  off: number;
}

const cheaper = (a: ChainCost, b: ChainCost) =>
  a.crossings !== b.crossings ? a.crossings < b.crossings : a.raised !== b.raised ? a.raised < b.raised : a.off < b.off;

/**
 * The way across every station (sectionsOf), chosen along the route as one
 * chain: the fewest changes to a way that does not overlap the way at the
 * station before, then the least standing on something higher than a step
 * over the lowest way across, then the ways nearest the OSM line. A shortest
 * path over stations and ways (Viterbi), over each run of stations with a
 * way across; ties to the lower way. Sets backbone and band.
 *
 * Each station used to take the lowest cell on its own. Where a cell beside
 * the street lay a little lower (a verge under a hedge 0.46 m down, a strip
 * 3 cm down behind a row of posts) or an object stood between the two sides,
 * neighbouring stations laid their bands on different sides of it, and the
 * taper along the route (taperEdges) cut each down to its backbone: 0 to
 * 1.5 m where the walks alone were 4 to 14 m wide (playtest 748, Stuttgart,
 * Berlin, Paris; tmp/fix1/reports/cornerband.md).
 *
 * - Off a car, a hedge or a roof the OSM line runs over: that way stands
 *   more than a step over the street beside it, which overlaps the stations
 *   around it as well.
 * - A car filling a lane: the only way across, the band lies on it (E6).
 * - Across a long row of objects: the chain crosses it where no way goes
 *   round it, once.
 * - Within a step of each other (a verge, a gutter), the way the OSM line
 *   runs in.
 */
function chainSections(stations: Work[]): void {
  const { stepRise } = corridorConfig;
  for (let start = 0; start < stations.length; start++) {
    if (stations[start].sections.length === 0) continue;
    let end = start;
    while (end + 1 < stations.length && stations[end + 1].sections.length > 0) end++;
    const own = (st: Work, i: number): ChainCost => {
      const section = st.sections[i];
      const base = st.cells[st.sections[0].b].column!.ground;
      return {
        crossings: 0,
        raised: Math.max(0, st.cells[section.b].column!.ground - base - stepRise),
        off: Math.max(0, section.left, -section.right),
      };
    };
    let cost = stations[start].sections.map((_, i) => own(stations[start], i));
    // from[k - start - 1][i]: the way at station k - 1 of the cheapest chain to way i at station k.
    const from: number[][] = [];
    for (let k = start + 1; k <= end; k++) {
      const prior = stations[k - 1].sections;
      const priorCost = cost;
      const step: number[] = [];
      cost = stations[k].sections.map((section, i) => {
        const here = own(stations[k], i);
        let best = -1;
        let bestCost = here;
        for (let p = 0; p < prior.length; p++) {
          const apart = Math.min(prior[p].right, section.right) <= Math.max(prior[p].left, section.left);
          const total = { crossings: priorCost[p].crossings + (apart ? 1 : 0), raised: priorCost[p].raised + here.raised, off: priorCost[p].off + here.off };
          if (best < 0 || cheaper(total, bestCost)) {
            best = p;
            bestCost = total;
          }
        }
        step.push(best);
        return bestCost;
      });
      from.push(step);
    }
    let i = cost.reduce((b, c, j) => (cheaper(c, cost[b]) ? j : b), 0);
    for (let k = end; k >= start; k--) {
      const st = stations[k];
      const section = st.sections[i];
      const cell = st.cells[section.b];
      st.b = section.b;
      st.backbone = { offset: cell.u, y: cell.column!.ground };
      st.left = section.left;
      st.right = section.right;
      if (k > start) i = from[k - start - 1][i];
    }
    start = end;
  }
}

/**
 * The ground of the street under each station, whatever stands over it: the
 * backbones as a morphological opening along the route over `PASSAGE_SPAN_M`
 * (the lowest backbone within half a span either way, then the highest of
 * those). An excursion upward shorter than the span is gone from it, so a
 * gate tower, an archway, a jetty or a car no longer counts as the ground,
 * while a street that climbs keeps its slope: on a straight one the opening
 * gives it back exactly. A station without a backbone (a bridge, a tunnel,
 * the leg to the HQ, a station whose cells across gave nothing) takes the
 * street from the stations within half a span of it; null where no station
 * within reach has a backbone.
 */
function streetLevel(stations: readonly Work[]): (number | null)[] {
  const half = PASSAGE_SPAN_M / 2;
  const n = stations.length;
  // Stations run in route order, so `s` never falls and the window rolls.
  const roll = (source: readonly (number | null)[], lowest: boolean): (number | null)[] => {
    const out = new Array<number | null>(n).fill(null);
    let lo = 0;
    let hi = 0;
    for (let k = 0; k < n; k++) {
      while (lo < n && stations[lo].s < stations[k].s - half) lo++;
      while (hi < n && stations[hi].s <= stations[k].s + half) hi++;
      let best: number | null = null;
      for (let j = lo; j < hi; j++) {
        const v = source[j];
        if (v !== null && (best === null || (lowest ? v < best : v > best))) best = v;
      }
      out[k] = best;
    }
    return out;
  };
  return roll(roll(stations.map((st) => st.backbone?.y ?? null), true), false);
}

/**
 * Stations the band cannot put on the street become a passage, run as a
 * tunnel; one whose backbone stands more than `stepRise` over the street a
 * climb. Both are measured against `street` (streetLevel), not against the
 * backbones of the stations around them: under a gate tower or in an
 * archway every station within a few metres stands on the same roof, so a
 * median over them is the roof itself.
 *
 * A passage, on a street the band decides and where the street is known:
 *
 * - the **backbone** stands more than `roofRise` over the street: no cell
 *   across the line is on the street at all (the lane is filled down to the
 *   ground, a crown, a jetty);
 * - the **line** runs through a cell that far over the street (`underCover`,
 *   coveredOnLine), with or without a backbone;
 * - a **gap** between two passages, or between a passage and a stretch
 *   under cover from OSM, no longer than PASSAGE_GAP_M (closePassageGaps).
 *
 * Playtest 2026-09-16, Rothenburg, the Weisser Turm over Georgengasse: the
 * first rule found only the two ends of the stretch under the tower (the
 * median over four stations either way was the tower roof), the band
 * between them lay on the tower, and the cells the line ran through under
 * the overhangs either side stood 14 to 16 m up. Playtest 747: the same
 * tower loaded twice, the cell lattice 19 cm apart, gave two passages and
 * one, and in the second the cells between the passage and the archway
 * stood on the tower. Both rules needed a backbone, under the tower one on
 * its roof: in the snapshots two roof cells beside the line lay 0.26 m
 * apart in one load and 0.57 m in the other, a step apart or not, and the
 * station was a passage or had no band at all. And the line was checked
 * only in the cell each station stands in, not in the cells it crosses
 * between two stations.
 */
function markPassages(stations: Work[], route: BandRoute, underCover: ReadonlySet<number>): void {
  const { roofRise, stepRise } = corridorConfig;
  stations.forEach((st, k) => {
    if (!route.open[st.segment] || st.street === null) return;
    if ((st.backbone !== null && st.backbone.y - st.street > roofRise) || underCover.has(k)) toPassage(st);
    else if (st.backbone !== null && st.backbone.y - st.street > stepRise) st.kind = 'climb';
  });
  closePassageGaps(stations, route);
}

/** `st` becomes part of a passage: no backbone, the rays' walls. */
function toPassage(st: Work): void {
  st.kind = 'passage';
  st.backbone = null;
  st.b = -1;
  st.left = -st.wallL;
  st.right = st.wallR;
}

/**
 * The stations between two passages, or between a passage and a stretch
 * under cover from OSM (`covered`: a tunnel, a covered passage, a stretch
 * under another way), become part of the passage where they span at most
 * PASSAGE_GAP_M along the route, all of them on a street the band decides
 * and with a street known under them.
 */
function closePassageGaps(stations: Work[], route: BandRoute): void {
  const cover = (st: Work) => st.kind === 'passage' || route.covered[st.segment];
  let last = -1;
  stations.forEach((st, k) => {
    if (!cover(st)) return;
    if (last >= 0 && k - last > 1 && !(route.covered[stations[last].segment] && route.covered[st.segment])) {
      const gap = stations.slice(last + 1, k);
      const span = st.s - stations[last].s - halfStation(stations, last) - halfStation(stations, k);
      if (span <= PASSAGE_GAP_M + 1e-6 && gap.every((g) => route.open[g.segment] && g.street !== null)) gap.forEach(toPassage);
    }
    last = k;
  });
}

/**
 * The stations whose line runs through a cell more than `roofRise` over the
 * street under them, outside a passage: the cells a route claims whatever
 * its width (claimSegmentCells, every cell its line runs through), on the
 * pieces of the line as bandPath lays them. A piece is checked against the
 * station at each of its ends that the band decides, and a cell counts for
 * the nearer of them; it becomes a passage (markPassages), which makes every
 * piece at it one. A point between two segments is no such end: its piece
 * is a passage when the station at its other end is.
 *
 * A cell over the street on the line keeps the roof over the lane: an upper
 * floor jutting over an alley, the mesh of a gate tower past the mouth of
 * its archway. Until 2026-09-16 `streetUnderRoof` gave such a cell the
 * street; the band replaced it, then checked only the cell each station
 * stands in, where the band was narrower than two `edgeMargin`. On a line
 * at an angle to the lattice a covered cell between two stations then went
 * unchecked, and whether a station stood in it depended on where the
 * lattice lay (playtest 747).
 */
function coveredOnLine(
  route: BandRoute, stations: readonly Work[], columnAt: (gx: number, gz: number) => BandColumn | null, cellSize: number,
): number[] {
  const { roofRise } = corridorConfig;
  const nodes = lineNodes(route, stations);
  const found = new Set<number>();
  const decides = (k: number) => k >= 0 && route.open[stations[k].segment] && stations[k].street !== null;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (a.passage || b.passage || !route.open[a.segment]) continue;
    const ends = [a.station, b.station].filter(decides);
    if (ends.length === 0) continue;
    const m = CLAIM_MARGIN_M;
    for (let gx = Math.floor((Math.min(a.x, b.x) - m) / cellSize); gx <= Math.floor((Math.max(a.x, b.x) + m) / cellSize); gx++) {
      for (let gz = Math.floor((Math.min(a.z, b.z) - m) / cellSize); gz <= Math.floor((Math.max(a.z, b.z) + m) / cellSize); gz++) {
        if (!segmentTouchesCell(cellSize, a, b, gx, gz, m)) continue;
        const column = columnAt(gx, gz);
        if (column === null) continue;
        const cx = (gx + 0.5) * cellSize;
        const cz = (gz + 0.5) * cellSize;
        const k = ends.reduce((p, q) => (Math.hypot(stations[q].x - cx, stations[q].z - cz) < Math.hypot(stations[p].x - cx, stations[p].z - cz) ? q : p));
        if (column.ground - stations[k].street! > roofRise) found.add(k);
      }
    }
  }
  return [...found].sort((p, q) => p - q);
}

/** The edges of the band of `st` walked from its cell `b`, see the file comment. */
function walkBand(st: Work, b: number): { left: number; right: number } {
  const toRight = st.cells[b + 1]?.column ?? null;
  const toLeft = st.cells[b - 1]?.column ?? null;
  return {
    left: walkSide(st, b, -1, crossSlope(st, b, -1, toLeft, toRight)),
    right: walkSide(st, b, 1, crossSlope(st, b, 1, toRight, toLeft)),
  };
}

/**
 * Rise per metre of the ground across `st` towards side `dir`, from the
 * neighbour of its cell `b` on that side (`toward`) and on the other (`away`):
 * where it rises towards the side about as much as it falls on the other,
 * or falls about as much as it rises there (the two within `stepRise` over a
 * cell), the smaller of the two, negative where it falls; else 0. As
 * crossSlope in corridor-walk.ts, from cell `b`.
 */
function crossSlope(st: Work, b: number, dir: number, toward: BandColumn | null, away: BandColumn | null): number {
  const from = st.cells[b];
  const t = st.cells[b + dir];
  const a = st.cells[b - dir];
  if (!toward || !away || !t || !a) return 0;
  const y = from.column!.ground;
  const out = (toward.ground - y) / Math.max(1e-6, Math.abs(t.u - from.u));
  const back = (y - away.ground) / Math.max(1e-6, Math.abs(from.u - a.u));
  const cell = Math.hypot(t.x - from.x, t.z - from.z);
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
function walkSide(st: Work, b: number, dir: number, slope: number): number {
  const { stepRise, stepDrop, roofRise } = corridorConfig;
  const wall = dir > 0 ? st.wallR : -st.wallL;
  const start = st.cells[b];
  const y0 = start.column!.ground;
  const rise = Math.max(0, slope);
  const fall = Math.min(0, slope);
  let high = y0;
  let bottom = y0;
  let last = y0;
  let lastD = 0;
  let lastU = start.u;
  for (let j = b + dir; j >= 0 && j < st.cells.length; j += dir) {
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
 * The room beside the enemies' line rises along the route by at most
 * `taper` per metre, the same rule the edges keep (taperEdges) and the
 * enemies' lateral limits are built with (buildSideLimits). The line moves
 * within the band as well, so the room beside it changes faster than the
 * edges do: beside a van the band narrowed from 7 to 1.5 m while the line
 * moved 0.15 m per metre, and the worm's rings, which sit across the
 * corridor (wormSway), turned 17 degrees against each other
 * (worm-detour.spec.ts). Only ever narrows the band, and the backbone stays
 * inside.
 */
function taperWidths(stations: Work[]): void {
  const { taper } = corridorConfig;
  for (const side of ['left', 'right'] as const) {
    const room = stations.map((st) => (side === 'left' ? st.centre - st.left : st.right - st.centre));
    for (let k = 1; k < stations.length; k++) room[k] = Math.min(room[k], room[k - 1] + taper * (stations[k].s - stations[k - 1].s));
    for (let k = stations.length - 2; k >= 0; k--) room[k] = Math.min(room[k], room[k + 1] + taper * (stations[k + 1].s - stations[k].s));
    stations.forEach((st, k) => {
      if (st.kind !== 'band' && st.kind !== 'climb') return;
      const b = st.backbone!.offset;
      if (side === 'left') st.left = Math.min(b, st.centre - room[k]);
      else st.right = Math.max(b, st.centre + room[k]);
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
 * route's end. The half widths of a piece are those of the band at its ends,
 * the narrower of the two; in a passage the street's half width.
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
interface LineNode extends BandPoint {
  station: number;
}

/** The points of the enemies' line of `stations` along `route`, see bandPath; a piece is a passage where either end is. */
function lineNodes(route: BandRoute, stations: readonly BandStation[]): LineNode[] {
  const { points } = route;
  if (points.length < 2 || stations.length === 0) return [];
  const widths = (st: BandStation) => (st.kind === 'passage'
    ? { left: route.streetHalfWidth[st.segment], right: route.streetHalfWidth[st.segment] }
    : { left: st.centre - st.left, right: st.right - st.centre });
  const nodes: LineNode[] = [];
  const first = stations[0];
  nodes.push({ x: points[0].x, z: points[0].z, segment: first.segment, offset: 0, ...widths(first), passage: first.kind === 'passage', station: 0 });
  for (let k = 0; k < stations.length; k++) {
    const st = stations[k];
    const next = stations[k + 1];
    nodes.push({
      x: st.x + st.rx * st.centre, z: st.z + st.rz * st.centre, segment: st.segment, offset: st.centre, ...widths(st),
      passage: st.kind === 'passage', station: k,
    });
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
      offset,
      left: Math.min(wa.left, wb.left),
      right: Math.min(wa.right, wb.right),
      passage: st.kind === 'passage' && next.kind === 'passage',
      station: -1,
    });
  }
  const end = points[points.length - 1];
  const last = stations.length - 1;
  nodes.push({ x: end.x, z: end.z, segment: stations[last].segment, offset: 0, ...widths(stations[last]), passage: false, station: last });
  return nodes;
}
