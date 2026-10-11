import type { MapPoint, MapTerrain } from '../../map-document';
import type { HeightField } from '../height-field';

/**
 * The highest water surface a bridge crosses: the main water and every
 * body where its mask covers a point of the bridge's line, rivers where
 * the line comes within their half width. -Infinity when it crosses none.
 * The deck stands at least a metre above it (BridgeLayer and the game's
 * CustomMapSurface alike); a bridge far from a lake up the hill is not
 * lifted to that lake's level.
 */
export function bridgeWaterLevel(line: MapPoint[], terrain: MapTerrain, field: HeightField): number {
  const bodies = [terrain.water, ...(terrain.waterBodies ?? [])].filter((b) => b !== null && b !== undefined);
  const rivers = terrain.rivers ?? [];
  let level = -Infinity;
  const step = field.cellSize * 0.5;
  for (let s = 0; s < line.length - 1; s++) {
    const a = line[s];
    const b = line[s + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n;
      const y = a.y + ((b.y - a.y) * k) / n;
      const i = Math.round((x - field.originX) / field.cellSize);
      const j = Math.round((y - field.originY) / field.cellSize);
      if (i >= 0 && j >= 0 && i < field.columns && j < field.rows) {
        for (const body of bodies) if (body.mask[j * field.columns + i] && body.level > level) level = body.level;
      }
      for (const r of rivers) {
        for (let p = 0; p < r.points.length - 1; p++) {
          const q0 = r.points[p];
          const q1 = r.points[p + 1];
          const dx = q1.x - q0.x;
          const dy = q1.y - q0.y;
          const len2 = dx * dx + dy * dy;
          const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - q0.x) * dx + (y - q0.y) * dy) / len2)) : 0;
          const half = (q0.width + (q1.width - q0.width) * u) / 2;
          if (Math.hypot(x - q0.x - dx * u, y - q0.y - dy * u) > half) continue;
          const h = q0.height + (q1.height - q0.height) * u;
          if (h > level) level = h;
        }
      }
    }
  }
  return level;
}
