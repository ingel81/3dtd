/**
 * Resize or crop a map around its centre: the height grid keeps its cell
 * size and copies the samples both grids share (new ground takes the height
 * of the nearest old edge), the splat maps and water mask follow, and
 * objects, paths and markers outside the new extent are dropped or pulled
 * inside.
 */
import type { CustomMapDocument, MapTerrain } from '../../world/custom-map/map-document';
import { splatResolutionFor } from '../../world/custom-map/map-create';
import { clamp } from '../model/grid';

export interface ResizeResult {
  droppedObjects: number;
  droppedNodes: number;
}

export function resizeMap(doc: CustomMapDocument, width: number, depth: number): ResizeResult {
  const old = doc.terrain;
  const g = old.grid;
  const cell = g.cellSize;
  const columns = Math.max(2, Math.round(width / cell) + 1);
  const rows = Math.max(2, Math.round(depth / cell) + 1);
  const terrain: MapTerrain = {
    ...old,
    width: (columns - 1) * cell,
    depth: (rows - 1) * cell,
    grid: { columns, rows, cellSize: cell, heights: new Float32Array(columns * rows) },
    splat: { resolution: 0, maps: [new Uint8Array(0), new Uint8Array(0)] },
    water: old.water ? { ...old.water, mask: new Uint8Array(columns * rows) } : null,
    ...(old.waterBodies ? { waterBodies: old.waterBodies.map((w) => ({ ...w, mask: new Uint8Array(columns * rows) })) } : {}),
  };
  const masks = [old.water, ...(old.waterBodies ?? [])].flatMap((w, k) => {
    const to = k === 0 ? terrain.water : terrain.waterBodies![k - 1];
    return w && to ? [[w.mask, to.mask]] : [];
  });
  // Sample offsets between the two grids (both centred)
  const di = Math.round((old.width - terrain.width) / 2 / cell);
  const dj = Math.round((old.depth - terrain.depth) / 2 / cell);
  for (let j = 0; j < rows; j++) {
    const oj = clamp(j + dj, 0, g.rows - 1);
    for (let i = 0; i < columns; i++) {
      const oi = clamp(i + di, 0, g.columns - 1);
      terrain.grid.heights[j * columns + i] = g.heights[oj * g.columns + oi];
      if (i + di === oi && j + dj === oj) for (const [from, to] of masks) to[j * columns + i] = from[oj * g.columns + oi];
    }
  }
  // Splat: keep the texel size, resample by nearest texel
  const res = splatResolutionFor(Math.max(columns, rows));
  const maps: [Uint8Array, Uint8Array] = [new Uint8Array(res * res * 4), new Uint8Array(res * res * 4)];
  const ores = old.splat.resolution;
  for (let v = 0; v < res; v++) {
    const y = -terrain.depth / 2 + ((v + 0.5) / res) * terrain.depth;
    const ov = clamp(Math.floor(((y + old.depth / 2) / old.depth) * ores), 0, ores - 1);
    for (let u = 0; u < res; u++) {
      const x = -terrain.width / 2 + ((u + 0.5) / res) * terrain.width;
      const ou = clamp(Math.floor(((x + old.width / 2) / old.width) * ores), 0, ores - 1);
      for (let m = 0; m < 2; m++) maps[m].set(old.splat.maps[m].subarray((ov * ores + ou) * 4, (ov * ores + ou) * 4 + 4), (v * res + u) * 4);
    }
  }
  terrain.splat = { resolution: res, maps };
  doc.terrain = terrain;

  const hw = terrain.width / 2;
  const hd = terrain.depth / 2;
  const inside = (p: { x: number; y: number }) => Math.abs(p.x) <= hw && Math.abs(p.y) <= hd;
  const pull = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: clamp(p.x, -hw + cell, hw - cell), y: clamp(p.y, -hd + cell, hd - cell) });
  const objects = doc.objects.length;
  doc.objects = doc.objects.filter(inside);
  const nodes = doc.paths.nodes.length;
  const keep = new Set(doc.paths.nodes.filter(inside).map((n) => n.id));
  doc.paths = {
    nodes: doc.paths.nodes.filter((n) => keep.has(n.id)),
    edges: doc.paths.edges
      .filter((e) => keep.has(e.a) && keep.has(e.b))
      .map((e) => (e.via ? { ...e, via: e.via.map(pull) } : e)),
  };
  doc.spawns = doc.spawns.map(pull);
  doc.hq = pull(doc.hq);
  return { droppedObjects: objects - doc.objects.length, droppedNodes: nodes - doc.paths.nodes.length };
}
