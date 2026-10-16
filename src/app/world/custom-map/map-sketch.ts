import type { CustomMapDocument, MapPoint } from './map-document';

/** The side of a sketch in pixels, as the lists show map pictures */
export const MAP_SKETCH_PX = 256;

/**
 * A map's picture without a 3D view: the ground from straight above with
 * its relief shaded from the north-west, the water, and the roads and paths
 * as lines. For a map that has no picture of the editor yet (one made
 * from OpenStreetMap, docs/WORLDS_STATE_PLAN.md 6); a save by hand in the
 * editor puts its rendered one in place. PNG bytes, null where the page has
 * no 2D canvas (a spec).
 */
export async function sketchMapPicture(doc: CustomMapDocument, size = MAP_SKETCH_PX): Promise<Uint8Array | null> {
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  const ctx = canvas?.getContext('2d') ?? null;
  if (!canvas || !ctx) return null;
  canvas.width = size;
  canvas.height = size;
  drawGround(ctx, doc, size);
  drawPaths(ctx, doc, size);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** Map metres to the picture: the map's middle in the middle, its longer side across */
function toPixel(doc: CustomMapDocument, size: number): (p: MapPoint) => [number, number] {
  const side = Math.max(doc.terrain.width, doc.terrain.depth, 1);
  const k = size / side;
  return (p) => [size / 2 + p.x * k, size / 2 + p.y * k];
}

function drawGround(ctx: CanvasRenderingContext2D, doc: CustomMapDocument, size: number): void {
  const { grid, water } = doc.terrain;
  const { columns, rows, heights } = grid;
  let low = Infinity;
  let high = -Infinity;
  for (const h of heights) {
    if (h < low) low = h;
    if (h > high) high = h;
  }
  const span = Math.max(high - low, 1);
  const image = ctx.createImageData(size, size);
  const at = toPixel(doc, size);
  const [x0, y0] = at({ x: -doc.terrain.width / 2, y: -doc.terrain.depth / 2 });
  const [x1, y1] = at({ x: doc.terrain.width / 2, y: doc.terrain.depth / 2 });
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const o = (py * size + px) * 4;
      const u = (px - x0) / (x1 - x0);
      const v = (py - y0) / (y1 - y0);
      if (u < 0 || u > 1 || v < 0 || v > 1) {
        image.data.set([24, 30, 26, 255], o);
        continue;
      }
      const i = Math.min(columns - 1, Math.round(u * (columns - 1)));
      const j = Math.min(rows - 1, Math.round(v * (rows - 1)));
      const k = j * columns + i;
      if (water && water.mask[k] > 127) {
        image.data.set([74, 128, 158, 255], o);
        continue;
      }
      const h = heights[k];
      // The slope towards the north-west light: brighter where the ground faces it
      const west = heights[j * columns + Math.max(0, i - 1)];
      const north = heights[Math.max(0, j - 1) * columns + i];
      const shade = Math.max(-1, Math.min(1, ((west - h) + (north - h)) / Math.max(grid.cellSize, 0.5)));
      const t = (h - low) / span;
      const light = 0.85 - shade * 0.35;
      image.data.set([(96 + t * 80) * light, (128 + t * 40) * light, (74 + t * 30) * light, 255], o);
    }
  }
  ctx.putImageData(image, 0, 0);
}

function drawPaths(ctx: CanvasRenderingContext2D, doc: CustomMapDocument, size: number): void {
  const at = toPixel(doc, size);
  const nodes = new Map(doc.paths.nodes.map((n) => [n.id, n]));
  const k = size / Math.max(doc.terrain.width, doc.terrain.depth, 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const edge of doc.paths.edges) {
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) continue;
    const line = [a, ...(edge.via ?? []), b].map(at);
    ctx.strokeStyle = edge.kind === 'bridge' ? '#8a6a4a' : edge.kind === 'path' ? '#d9cfb4' : '#f2efe6';
    ctx.lineWidth = Math.max(1, edge.width * k * (edge.kind === 'path' ? 0.6 : 1));
    ctx.beginPath();
    ctx.moveTo(line[0][0], line[0][1]);
    for (const [x, y] of line.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
  }
}
