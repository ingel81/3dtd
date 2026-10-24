/**
 * Where an OSM world has an old town (docs/OSM_WORLD_PLAN.md, "Altstadt"):
 * there the houses take the old-town models (half-timbered, steep roofs,
 * kind `oldtown` in building-tags.ts) instead of today's. A footprint lies
 * in the old town when
 *
 * - its own tags say it is old: `building:architecture` (half-timbered,
 *   medieval, gothic …), `historic=building`, `heritage`, a `start_date` or
 *   `building:age` before OLD_YEAR;
 * - it stands in an area tagged as one (`historic=city`/`district`/
 *   `old_town`, a place or area named Altstadt, old town and the like);
 * - it stands inside the town wall: the hull of the `barrier=city_wall`
 *   (`historic=citywalls`) lines, where they run long enough to ring a town;
 * - or the town is built as old towns are: densely (DENSE_COVER of the
 *   ground round it under roofs) with small houses (their median footprint
 *   under SMALL_MEDIAN), what a suburb never is and a city centre of blocks
 *   rarely.
 */
import type { MapPoint } from '../../custom-map/map-document';
import type { OsmFeatures } from '../osm-parse';
import { fillRings, type RasterGrid } from './raster';
import { convexHull, insideRing } from '../../custom-map/map-surfaces';

/** Buildings older than this year are old-town houses */
const OLD_YEAR = 1850;
/** `building:architecture` values of old towns */
const OLD_STYLES = new Set([
  'half-timbered', 'half_timbered', 'timber_frame', 'timber-framed', 'fachwerk', 'medieval', 'romanesque', 'gothic', 'renaissance',
  'baroque', 'vernacular', 'historicism',
]);
/** Names of old-town areas, most languages of the places people pick */
const OLD_NAMES = /\b(alt-?stadt|old ?town|vieille ville|centro storico|casco (antiguo|viejo)|stare miasto|staré město|oude stad|gamla stan|gamle by)\b/i;
/** Town wall lines at least this long (m, all together) ring a town */
const WALL_RING = 500;
/** Cell of the coverage raster, m, and the window the share of roofs is taken over (half side, m) */
const COVER_CELL = 4;
const COVER_REACH = 40;
/** At least this share of the ground round a footprint under roofs, with small houses: an old town */
const DENSE_COVER = 0.42;
/** Median footprint (m²) of the buildings round it under which the houses are small */
export const SMALL_MEDIAN = 260;

export interface OldTown {
  /** Whether a footprint with these tags, its middle at `p` and `median` m² the median footprint around (null unknown), is old town */
  has(p: MapPoint, tags: Readonly<Record<string, string>>, median: number | null): boolean;
  /** How many footprints the tests found, by reason (the report) */
  reasons: { tags: number; area: number; wall: number; dense: number };
}

/** The old town of `features` on a map of `side` metres */
export function findOldTown(features: OsmFeatures, side: number): OldTown {
  const areas = features.areas.filter((a) => isOldArea(a.tags));
  const wall = wallHull(features);
  // Share of the ground under roofs: a raster of the footprints and its running sums
  const n = Math.ceil(side / COVER_CELL) + 1;
  const grid: RasterGrid = { n, origin: -side / 2, step: COVER_CELL };
  const built = new Uint8Array(n * n);
  for (const a of features.areas) if (a.tags['building']) fillRings(a.outer, grid, (i, j) => (built[j * n + i] = 1));
  const sum = new Uint32Array((n + 1) * (n + 1));
  for (let j = 0; j < n; j++) {
    let row = 0;
    for (let i = 0; i < n; i++) {
      row += built[j * n + i];
      sum[(j + 1) * (n + 1) + i + 1] = sum[j * (n + 1) + i + 1] + row;
    }
  }
  const cover = (p: MapPoint): number => {
    const r = Math.round(COVER_REACH / COVER_CELL);
    const ci = Math.round((p.x - grid.origin) / COVER_CELL);
    const cj = Math.round((p.y - grid.origin) / COVER_CELL);
    const i0 = Math.max(0, ci - r);
    const i1 = Math.min(n, ci + r + 1);
    const j0 = Math.max(0, cj - r);
    const j1 = Math.min(n, cj + r + 1);
    if (i1 <= i0 || j1 <= j0) return 0;
    const s = sum[j1 * (n + 1) + i1] - sum[j0 * (n + 1) + i1] - sum[j1 * (n + 1) + i0] + sum[j0 * (n + 1) + i0];
    return s / ((i1 - i0) * (j1 - j0));
  };
  const reasons = { tags: 0, area: 0, wall: 0, dense: 0 };
  return {
    reasons,
    has(p, tags, median) {
      if (isOldBuilding(tags)) {
        reasons.tags++;
        return true;
      }
      if (areas.some((a) => a.outer.some((r) => insideRing(p, r)) && !a.inner.some((r) => insideRing(p, r)))) {
        reasons.area++;
        return true;
      }
      if (wall && insideRing(p, wall)) {
        reasons.wall++;
        return true;
      }
      if (median !== null && median < SMALL_MEDIAN && cover(p) >= DENSE_COVER) {
        reasons.dense++;
        return true;
      }
      return false;
    },
  };
}

/** Whether a building's own tags say it is old */
export function isOldBuilding(tags: Readonly<Record<string, string>>): boolean {
  if (OLD_STYLES.has((tags['building:architecture'] ?? '').toLowerCase())) return true;
  if (tags['historic'] === 'building' || tags['heritage']) return true;
  const year = parseInt((tags['start_date'] ?? tags['building:age'] ?? tags['construction_date'] ?? '').replace(/^~|^C/i, ''), 10);
  return year > 800 && year < OLD_YEAR;
}

/** Whether an area's tags make it an old town */
export function isOldArea(tags: Readonly<Record<string, string>>): boolean {
  const historic = tags['historic'];
  if (historic === 'city' || historic === 'district' || historic === 'old_town' || historic === 'town') return true;
  return OLD_NAMES.test(tags['name'] ?? '') && !tags['building'] && !tags['highway'];
}

/** The hull of the town wall's lines, where they run WALL_RING metres or more; null without one */
function wallHull(features: OsmFeatures): MapPoint[] | null {
  const points: MapPoint[] = [];
  let length = 0;
  for (const w of features.ways) {
    if (w.tags['barrier'] !== 'city_wall' && w.tags['historic'] !== 'citywalls') continue;
    let prev: MapPoint | null = null;
    for (const p of w.points) {
      if (!p) {
        prev = null;
        continue;
      }
      if (prev) length += Math.hypot(p.x - prev.x, p.y - prev.y);
      points.push(p);
      prev = p;
    }
  }
  for (const a of features.areas) {
    if (a.tags['barrier'] !== 'city_wall' && a.tags['historic'] !== 'citywalls') continue;
    for (const r of a.outer) points.push(...r);
    length += WALL_RING;
  }
  if (length < WALL_RING || points.length < 3) return null;
  return convexHull(points);
}

