import type { MapTerrain, MapWaterKind } from './map-document';

/**
 * The highest water surface over the ground at map point (x, y), null on
 * dry ground: the main water, further bodies (by their masks) and rivers.
 * `ground` is the terrain's height there (the renderer passes its own
 * surface, the editor's check the grid's). Floating objects stand on it.
 * With `kind` only water of that kind counts (ice that objects stand on).
 */
export function waterLevelAt(t: MapTerrain, x: number, y: number, ground: number, kind?: MapWaterKind): number | null {
  const g = t.grid;
  const i = Math.round((x + t.width / 2) / g.cellSize);
  const j = Math.round((y + t.depth / 2) / g.cellSize);
  let best: number | null = null;
  if (i >= 0 && j >= 0 && i < g.columns && j < g.rows) {
    const k = j * g.columns + i;
    for (const body of [t.water, ...(t.waterBodies ?? [])]) {
      if (body && (!kind || body.kind === kind) && body.mask[k] && body.level > ground && (best === null || body.level > best)) best = body.level;
    }
  }
  for (const r of t.rivers ?? []) {
    if (kind && r.kind !== kind) continue;
    for (let s = 0; s < r.points.length - 1; s++) {
      const a = r.points[s];
      const b = r.points[s + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const half = (a.width + (b.width - a.width) * u) / 2;
      if (Math.hypot(x - a.x - dx * u, y - a.y - dy * u) > half) continue;
      const level = a.height + (b.height - a.height) * u;
      if (level > ground && (best === null || level > best)) best = level;
    }
  }
  return best;
}
