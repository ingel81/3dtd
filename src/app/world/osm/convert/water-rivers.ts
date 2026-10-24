/**
 * Rivers and streams of an OSM world (water.ts): their courses carved
 * into the ground along the waterways, falling with the valley, and
 * runnels, the concrete channels of the small ones in built land.
 */
import type { Runnel, WaterPaintRole, WaterResult } from './water-types';
import type { CustomMapDocument, MapPoint, MapRiver, MapSurface, MapTerrain } from '../../custom-map/map-document';
import { type RasterGrid, stampLine } from './raster';
import { type OsmFeatures, runs } from '../osm-parse';
import { waterwayOf, type WaterwayType } from '../land-tags';
import { clipLine } from '../square-clip';
import { resample } from '../../../map-ops/lines';
import { polylineLength } from '../../../map-ops/path-graph';
import { bankLevels, riverPoints } from '../../../map-ops/river-levels';
import { MAX_SURFACE_MATERIALS, MAX_SURFACES, RUNNEL_TRICKLE, stripOutline, surfaceMaterials } from '../../custom-map/map-surfaces';
import { joinRiverLevels } from '../../../map-ops/river-network';
import { smooth } from '../../../map-ops/landscape-noise';
import { round2 } from './geom';
import { availableMaterial, MATERIAL_FALLBACK } from '../area-tags';

/** Shortest stretch of a waterway kept outside the water areas, metres */
const MIN_RIVER_RUN = 12;
/** Metres between the points a waterway's surface is read at */
const RIVER_STEP = 4;

/** Share of a runnel's bottom the water fills in a wet one (a dry one has a trickle, RUNNEL_TRICKLE) */
const RUNNEL_FULL = 0.8;
/** Metres of the shells either side of a runnel's bottom, up to their lip */
export const RUNNEL_SHELL = 0.14;
/** Material of the runnels' shells, falling back along its chain (area-tags.ts) */
const RUNNEL_MATERIAL = 'concrete';
/** Most points of a runnel's line in one surface (its outline holds twice as many) */
const RUNNEL_POINTS = 400;

/** What carveRivers writes besides the heights */
interface RiverOut {
  paint: Record<WaterPaintRole, Float32Array>;
  wet: Uint8Array;
  channel: Float32Array;
  dry: Uint8Array;
  runnels: Runnel[];
}

/**
 * The waterways outside the water areas (a river with its surface mapped
 * runs in it already), each run on its own. One with water as a river line:
 * the surface from the banks, falling downstream (the way's direction, as
 * OSM draws it; a way drawn uphill is turned round), the channel dug and the
 * banks shaped. A dry one or a drain as its channel only: dug into the
 * ground as it lies, painted by its bed (dry gravel, earth; a drain's
 * shells are its runnel). A sample takes the nearest waterway's shape.
 */
export function carveRivers(
  terrain: MapTerrain,
  grid: RasterGrid,
  features: OsmFeatures,
  owner: Int16Array,
  roads: Uint8Array,
  out: RiverOut,
): { rivers: MapRiver[]; dryLines: number } {
  const courses = riverCourses(terrain, grid, features, owner, roads, out);
  if (!courses.length) return { rivers: [], dryLines: 0 };
  joinCourseLevels(terrain, courses);
  digCourses(terrain, grid, owner, out, courses);
  const rivers = courses.filter((c) => c.river);
  return { dryLines: courses.length - rivers.length, rivers: riverLines(rivers) };
}

/** A waterway's run as it is carved: its line downhill, its water surface along it (none for a dry one), its size */
interface Course {
  line: MapPoint[];
  surface: number[];
  along: number[];
  width: number;
  depth: number;
  bank: number;
  type: WaterwayType;
  river: boolean;
}

/** The waterways' runs outside the bodies and off the roads, downhill, each reaching one step into the water it meets; a drain's runnel noted */
function riverCourses(terrain: MapTerrain, grid: RasterGrid, features: OsmFeatures, owner: Int16Array, roads: Uint8Array, out: RiverOut): Course[] {
  const n = grid.n;
  const h = terrain.grid.heights;
  const lim = features.half - 1;
  const land = (x: number, y: number) => {
    const i = Math.min(n - 1, Math.max(0, Math.round((x - grid.origin) / grid.step)));
    const j = Math.min(n - 1, Math.max(0, Math.round((y - grid.origin) / grid.step)));
    return h[j * n + i];
  };
  /** 1 in a body's water, 2 on a road, 0 elsewhere */
  const blocked = (p: MapPoint) => {
    const i = Math.round((p.x - grid.origin) / grid.step);
    const j = Math.round((p.y - grid.origin) / grid.step);
    if (i < 0 || j < 0 || i >= n || j >= n) return 0;
    return owner[j * n + i] >= 0 ? 1 : roads[j * n + i] ? 2 : 0;
  };
  const courses: Course[] = [];
  for (const way of features.ways) {
    const type = waterwayOf(way.tags);
    if (!type) continue;
    for (const run of runs(way.points)) {
      for (const piece of clipLine(run, lim)) {
        // Dry runs outside the bodies and off the roads, each reaching one step into the water it meets
        const pts = resample(piece, RIVER_STEP / 2);
        const dryRuns: MapPoint[][] = [];
        let current: MapPoint[] = [];
        const flush = () => {
          if (current.length >= 2 && polylineLength(current) >= MIN_RIVER_RUN) dryRuns.push(current);
          current = [];
        };
        for (let k = 0; k < pts.length; k++) {
          const stop = blocked(pts[k]);
          if (stop) {
            if (current.length && stop === 1) current.push(pts[k]);
            flush();
            continue;
          }
          if (!current.length && k > 0 && blocked(pts[k - 1]) === 1) current.push(pts[k - 1]);
          current.push(pts[k]);
        }
        flush();
        for (const raw of dryRuns) {
          let line = resample(raw, RIVER_STEP);
          if (line.length < 2) continue;
          if (land(line[0].x, line[0].y) < land(line[line.length - 1].x, line[line.length - 1].y) - 1) line = line.reverse();
          const half = type.width / 2;
          // A river line holds water; a dry channel and a drain's runnel have no surface to level
          const river = type.wet && type.bed !== 'concrete';
          const surface = river ? bankLevels(land, line, () => half, type.bank + 1) : [];
          const along = [0];
          for (let k = 1; k < line.length; k++) along.push(along[k - 1] + Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y));
          courses.push({ line, surface, along, width: type.width, depth: type.depth, bank: type.bank, type, river });
          if (type.bed === 'concrete') out.runnels.push({ way: way.id, line, width: type.width, water: type.wet ? type.width * RUNNEL_FULL : RUNNEL_TRICKLE });
        }
      }
    }
  }
  return courses;
}

/**
 * The river lines join where they meet (map-ops/river-network.ts): a stream ends on the level of the river it runs into
 * (OSM joins them in a shared node), on a lake's, or where one way of a river ends and the next goes on. On every
 * vertex, so a level taken on at a junction starts where the junction does; the channels are dug to it. Dry channels
 * and drains have no surface and join nothing
 */
function joinCourseLevels(terrain: MapTerrain, courses: readonly Course[]): void {
  const wetCourses = courses.filter((c) => c.river);
  const joined: MapTerrain = {
    ...terrain,
    rivers: wetCourses.map((c, k) => ({ id: `river-${k + 1}`, kind: 'water', points: c.line.map((p, i) => ({ x: p.x, y: p.y, width: c.width, height: c.surface[i] })) })),
  };
  joinRiverLevels(joined);
  joined.rivers!.forEach((r, k) => (wetCourses[k].surface = r.points.map((p) => p.height)));
}

/** Each sample by its nearest course: dug to the channel's bed under the surface, the bank from just over it into the land; painted */
function digCourses(terrain: MapTerrain, grid: RasterGrid, owner: Int16Array, out: RiverOut, courses: readonly Course[]): void {
  const { paint, wet, channel, dry } = out;
  const n = grid.n;
  const h = terrain.grid.heights;
  // The nearest course per sample: its distance, half width, bank, depth and surface there
  const best = new Float32Array(n * n).fill(Infinity);
  const level = new Float32Array(n * n);
  const which = new Int32Array(n * n).fill(-1);
  // The channel is dug at least a sample wide either side: the grid would miss a narrower ditch's bed
  const cut = (c: { width: number }) => Math.max(c.width / 2, grid.step);
  courses.forEach((c, index) => {
    const half = cut(c);
    stampLine(c.line, grid, half + c.bank, (i, j, dist, s, t) => {
      const k = j * n + i;
      if (owner[k] >= 0) return;
      // The share of the distance to the bank's outer edge, so a wide river's bank wins over a ditch beside it
      const rel = dist / (half + c.bank);
      if (rel >= best[k]) return;
      best[k] = rel;
      which[k] = index;
      level[k] = c.river ? c.surface[s] + (c.surface[s + 1] - c.surface[s]) * t : 0;
    });
  });
  const base = h.slice();
  for (let k = 0; k < best.length; k++) {
    const index = which[k];
    if (index < 0) continue;
    const c = courses[index];
    const half = cut(c);
    const dist = best[k] * (half + c.bank);
    const surface = level[k];
    if (!c.river) {
      dryChannel(k, dist, half, c, base[k]);
      continue;
    }
    if (dist < half) {
      const deep = Math.pow(1 - smooth(0.2, 1, dist / half), 1.3);
      h[k] = Math.min(base[k], surface - 0.15 - c.depth * deep);
      channel[k] = h[k];
      paint.bed[k] = Math.max(paint.bed[k], 1);
      wet[k] = 1;
    } else {
      // The bank: from just over the surface into the land
      const shore = surface + 0.25;
      const s = smooth(0, 1, (dist - half) / (c.bank * 0.7));
      h[k] = shore + (base[k] - shore) * s;
      paint.bank[k] = Math.max(paint.bank[k], 1 - smooth(0.3, 1, (dist - half) / c.bank));
    }
  }

  /**
   * A sample `dist` from a dry channel's or a drain's line: dug into the
   * ground as it lies (no water to level it), the deepest in the middle;
   * painted by its bed, a dry river's gravel reaching a little onto its
   * banks; a drain's shells come as its runnel (layRunnels), bare earth
   * right beside them
   */
  function dryChannel(k: number, dist: number, half: number, c: { depth: number; bank: number; type: WaterwayType }, ground: number): void {
    const bed = c.type.bed;
    if (dist < half) {
      const deep = Math.pow(1 - smooth(0.2, 1, dist / half), 1.3);
      h[k] = Math.min(ground, ground - c.depth * deep);
      channel[k] = h[k];
      dry[k] = 1;
      if (bed === 'earth') paint.ditch[k] = Math.max(paint.ditch[k], 0.85 * (1 - smooth(0.5, 1, dist / half)));
      else if (bed === 'natural') paint.dryBed[k] = Math.max(paint.dryBed[k], 1);
      // Bare earth right along the shells: no grass grows over them (the ground's paint is coarser than a runnel)
      else paint.ditch[k] = Math.max(paint.ditch[k], 1 - smooth(0.5, 1.8, dist));
    } else if (bed === 'natural' && c.bank > 0) {
      paint.dryBed[k] = Math.max(paint.dryBed[k], 0.7 * (1 - smooth(0, 1, (dist - half) / c.bank)));
    }
  }
}

/** The rivers' lines for the map: their points along each line with its width and surface, in centimetres */
function riverLines(rivers: readonly Course[]): MapRiver[] {
  const round = (v: number) => round2(v);
  return rivers.map((c, index) => ({
    id: `river-${index + 1}`,
    kind: 'water',
    points: riverPoints(c.line, c.along, c.surface).map(({ p, s }) => {
      let k = 1;
      while (k < c.along.length - 1 && c.along[k] < s) k++;
      const f = Math.min(1, Math.max(0, (s - c.along[k - 1]) / Math.max(1e-6, c.along[k] - c.along[k - 1])));
      return { x: round(p.x), y: round(p.y), width: round(c.width), height: round(c.surface[k - 1] + (c.surface[k] - c.surface[k - 1]) * f) };
    }),
  }));
}

/**
 * The drains' runnels (`water.runnels`) laid on `doc` as surfaces of
 * concrete shells (MapSurface with a `runnel` marking, after the areas'
 * surfaces): a strip as wide as the runnel's bottom and its shells along
 * the drain's line, the water at the bottom drawn by the shader; one draped
 * layer for all of them, no draw call of their own. The material falls back
 * along its chain past MAX_SURFACE_MATERIALS; past MAX_SURFACES the rest are
 * left out. How many were laid
 */
export function layRunnels(doc: CustomMapDocument, water: WaterResult, has: ((id: string) => boolean) | null): number {
  if (!water.runnels.length) return 0;
  const surfaces = doc.surfaces ?? [];
  const used = new Set(surfaceMaterials(surfaces));
  let material = availableMaterial(RUNNEL_MATERIAL, has);
  if (!used.has(material) && used.size >= MAX_SURFACE_MATERIALS) material = (MATERIAL_FALLBACK[material] ?? []).find((m) => used.has(m)) ?? material;
  const laid: MapSurface[] = [];
  const pieces = new Map<number, number>();
  for (const r of water.runnels) {
    const width = r.width + 2 * RUNNEL_SHELL;
    for (let start = 0; start < r.line.length - 1; start += RUNNEL_POINTS - 1) {
      if (surfaces.length + laid.length >= MAX_SURFACES) break;
      const line = r.line.slice(start, start + RUNNEL_POINTS);
      const outer = stripOutline(line, width / 2);
      if (!outer) continue;
      const a = line[0];
      const b = line[line.length - 1];
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of line) {
        const u = (p.x - a.x) * ux + (p.y - a.y) * uy;
        lo = Math.min(lo, u);
        hi = Math.max(hi, u);
      }
      const mid = (lo + hi) / 2;
      const k = (pieces.get(r.way) ?? 0) + 1;
      pieces.set(r.way, k);
      const surface: MapSurface = {
        id: `osm-w${r.way}-${k}`,
        material,
        outer: outer.map((p) => ({ x: round2(p.x), y: round2(p.y) })),
        marking: {
          kind: 'runnel',
          x: round2(a.x + ux * mid),
          y: round2(a.y + uy * mid),
          angle: Math.round(angle * 1e4) / 1e4,
          length: round2(Math.max(width, hi - lo)),
          width: round2(width),
        },
        group: `osm-w${r.way}`,
      };
      if (r.water !== RUNNEL_TRICKLE) surface.marking!.water = round2(Math.min(r.water, width));
      laid.push(surface);
    }
  }
  if (laid.length) doc.surfaces = [...surfaces, ...laid];
  return laid.length;
}
