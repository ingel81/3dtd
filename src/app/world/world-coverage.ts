import { haversineDistance } from '../utils/geo-utils';

/**
 * The area a world has ground in: a circle around `center`. The Google tiles
 * cover the earth (no coverage, null), an own tileset one area
 * (WorldFactory.coverage). HQ and spawns stay inside; every check here lets
 * everything through without a coverage.
 */
export interface WorldCoverage {
  center: { lat: number; lon: number };
  radiusM: number;
}

/**
 * How far inside the edge HQ and spawns stay, m: a portal, its approach and
 * the base stand on tiles, not on the void just past the last one.
 */
export const COVERAGE_EDGE_MARGIN_M = 50;

/** The radius HQ and spawns may use: the circle less the edge margin, at least half the circle */
function usableRadius(coverage: WorldCoverage): number {
  return Math.max(coverage.radiusM - COVERAGE_EDGE_MARGIN_M, coverage.radiusM / 2);
}

/** Whether a point lies in the covered area (inside the edge margin); always true without a coverage */
export function isInsideCoverage(coverage: WorldCoverage | null, lat: number, lon: number): boolean {
  if (!coverage) return true;
  return haversineDistance(coverage.center.lat, coverage.center.lon, lat, lon) <= usableRadius(coverage);
}

/**
 * The distance range for a spawn around `hq` that can reach covered ground.
 * Beyond the far side of the circle (HQ to center plus the usable radius)
 * no point is covered, so `max` is capped there; `min` drops to half the
 * capped maximum where that is less, so a small area still leaves a ring
 * for a spawn. Without a coverage the range comes back as it is. A spawn
 * found in the range must still pass isInsideCoverage: the range is a ring
 * around the HQ, the circle is not.
 */
export function coveredSpawnRange(
  coverage: WorldCoverage | null,
  hq: { lat: number; lon: number },
  min: number,
  max: number,
): { min: number; max: number } {
  if (!coverage) return { min, max };
  const farthest = haversineDistance(hq.lat, hq.lon, coverage.center.lat, coverage.center.lon) + usableRadius(coverage);
  const cappedMax = Math.min(max, farthest);
  return { min: Math.min(min, cappedMax / 2), max: cappedMax };
}

/** What the player reads when a place lies outside the world's area */
export function outsideCoverageText(): string {
  return 'This place lies outside the area this map covers. Pick a place inside it.';
}

/** The hint where a HQ or portal would stand outside the world's area */
export const OUTSIDE_COVERAGE_HINT = 'Outside the map area';
