/**
 * How long each lane is, for the coop lobby (User, 2026-09-24): metres of
 * route from the spawn to the HQ, the time a standard enemy walks it, and
 * the share of the longest lane for a bar. A short lane leaves less time to
 * shoot, so it plays harder. Framework-free and pure.
 */
import { haversineDistance } from '../utils/geo-utils';

export interface LaneStat {
  /** Route length, m */
  meters: number;
  /** Walking time at the given speed, s */
  seconds: number;
  /** meters over the longest lane's, 0 to 1 */
  share: number;
}

/** The lanes of `paths` (spawn id to its route), walked at `speedMps`. */
export function laneStats(
  paths: ReadonlyMap<string, readonly { lat: number; lon: number }[]>,
  speedMps: number,
): Map<string, LaneStat> {
  const meters = new Map<string, number>();
  for (const [id, path] of paths) {
    let sum = 0;
    for (let i = 1; i < path.length; i++) {
      sum += haversineDistance(path[i - 1].lat, path[i - 1].lon, path[i].lat, path[i].lon);
    }
    meters.set(id, sum);
  }
  const longest = Math.max(0, ...meters.values());
  const stats = new Map<string, LaneStat>();
  for (const [id, m] of meters) {
    stats.set(id, {
      meters: Math.round(m),
      seconds: speedMps > 0 ? Math.round(m / speedMps) : 0,
      share: longest > 0 ? m / longest : 0,
    });
  }
  return stats;
}
