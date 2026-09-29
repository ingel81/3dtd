import type { GeoPosition } from '../../models/game.types';
import { fnv1a } from '../../utils/fnv1a';

/**
 * A key of the world the simulation runs on: the frozen cell heights, the
 * routes and the local origin, hashed. A snapshot or a replay file only
 * re-simulates on the world with the same key (docs/SIMULATOR_PLAN.md, P4),
 * and the simulation checks the world the main thread sent it against it
 * (docs/SIM_WORKER.md). Walks every cell, a few ms: not per frame.
 *
 * `heights` as GlobalRouteGrid.snapshotHeights gives them ([key, height]),
 * `paths` in the wave manager's order (spawn points in the order they were
 * set), `origin` the local frame's.
 */
export function worldKeyOf(
  heights: Iterable<readonly [number, number, ...unknown[]]>,
  paths: Iterable<readonly GeoPosition[]>,
  origin: GeoPosition | null,
): string {
  const sorted = [...heights].sort((a, b) => a[0] - b[0]);
  const parts: string[] = sorted.map(([key, height]) => `${key}:${height.toFixed(2)}`);
  for (const path of paths) {
    parts.push(path.map((p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`).join(';'));
  }
  if (origin) parts.push(`o=${origin.lat.toFixed(7)},${origin.lon.toFixed(7)}`);
  return fnv1a(parts.join('|'));
}
