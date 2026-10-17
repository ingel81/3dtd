/** Lengths along the ground (Measure, lane walking times) */
import type { MapPoint, MapTerrain } from '../../world/custom-map/map-document';
import { heightAt } from '../../map-ops/grid';

/** What a measured line comes to */
export interface MeasureResult {
  /** Straight length on the map */
  flat: number;
  /** Length along the ground, up and down included */
  ground: number;
  climb: number;
  drop: number;
}

/** Lengths of a measured line, sampled every 2 m along the ground */
export function measureLine(t: MapTerrain, points: readonly MapPoint[]): MeasureResult {
  let flat = 0;
  let ground = 0;
  let climb = 0;
  let drop = 0;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    flat += len;
    const n = Math.max(1, Math.ceil(len / 2));
    let h = heightAt(t, a.x, a.y);
    for (let s = 1; s <= n; s++) {
      const x = a.x + ((b.x - a.x) * s) / n;
      const y = a.y + ((b.y - a.y) * s) / n;
      const next = heightAt(t, x, y);
      ground += Math.hypot(len / n, next - h);
      if (next > h) climb += next - h;
      else drop += h - next;
      h = next;
    }
  }
  return { flat, ground, climb, drop };
}
