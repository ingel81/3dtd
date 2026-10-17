/**
 * The minimap's marks (ui/panels/minimap.component.ts): roads, spawns and
 * HQ drawn over the picture from above, in the editor's worker on an
 * OffscreenCanvas whenever the roads, the markers or the map's size change
 * (EditorMinimap, job `minimap`); the page draws the bitmap that comes back
 * and only the camera's frame itself. On a map with ten thousand roads,
 * stroking them took 6 ms of every camera frame and 10 ms of every change.
 */
import { SPAWN_COLORS } from '../../configs/map-constants.config';
import { edgePolyline } from '../../map-ops/path-graph';
import { TD_THEME } from '../../styles/td-theme';
import type { CustomMapDocument } from '../../world/custom-map/map-document';

/** Side of the minimap's canvas, in pixels */
export const MINIMAP_SIZE = 200;

/** The map's rectangle inside the square canvas */
export function minimapBox(width: number, depth: number): { x: number; y: number; w: number; h: number } {
  const k = MINIMAP_SIZE / Math.max(width, depth);
  const w = width * k;
  const h = depth * k;
  return { x: (MINIMAP_SIZE - w) / 2, y: (MINIMAP_SIZE - h) / 2, w, h };
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Roads, spawns and HQ of `doc` onto a clear canvas of MINIMAP_SIZE */
export function drawMinimapMarks(c: Context2D, doc: Pick<CustomMapDocument, 'terrain' | 'paths' | 'spawns' | 'hq'>): void {
  const t = doc.terrain;
  const b = minimapBox(t.width, t.depth);
  const px = (x: number) => b.x + (x / t.width + 0.5) * b.w;
  const py = (y: number) => b.y + (0.5 - y / t.depth) * b.h;
  c.lineWidth = 1.5;
  c.strokeStyle = TD_THEME.knobLight;
  c.beginPath();
  for (const e of doc.paths.edges) {
    edgePolyline(doc.paths, e).forEach((p, k) => (k ? c.lineTo(px(p.x), py(p.y)) : c.moveTo(px(p.x), py(p.y))));
  }
  c.stroke();
  doc.spawns.forEach((s, k) => {
    c.fillStyle = `#${SPAWN_COLORS[k % SPAWN_COLORS.length].toString(16).padStart(6, '0')}`;
    c.beginPath();
    c.arc(px(s.x), py(s.y), 4, 0, Math.PI * 2);
    c.fill();
  });
  c.fillStyle = TD_THEME.brass;
  c.fillRect(px(doc.hq.x) - 4, py(doc.hq.y) - 4, 8, 8);
}

/** The worker's canvas, kept between jobs (transferToImageBitmap leaves it clear) */
export class MinimapMarks {
  private canvas: OffscreenCanvas | null = null;

  /** The marks as a bitmap; null where there is no OffscreenCanvas (in-process, the tests) */
  run(doc: CustomMapDocument): ImageBitmap | null {
    if (typeof OffscreenCanvas === 'undefined') return null;
    this.canvas ??= new OffscreenCanvas(MINIMAP_SIZE, MINIMAP_SIZE);
    const c = this.canvas.getContext('2d');
    if (!c) return null;
    drawMinimapMarks(c, doc);
    return this.canvas.transferToImageBitmap();
  }
}
