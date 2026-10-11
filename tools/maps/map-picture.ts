/**
 * The list picture of a shipped map: ground in the catalogue's average
 * colours with hill shading, water, trees as dark specks, roads as pale
 * lines, spawns and HQ as small marks. A plain picture for the map
 * browser, drawn without WebGL.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CustomMapDocument } from '../../src/app/world/custom-map/map-document';
import { encodePng } from '../w3x/top-down';

type Rgb = [number, number, number];

function hex(c: string): Rgb {
  const n = parseInt(c.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mapPicture(doc: CustomMapDocument, size: number, catalogPath: string): Uint8Array {
  const catalog = JSON.parse(readFileSync(resolve(catalogPath), 'utf8')) as { materials: { id: string; average: string }[] };
  const colour = (id: string): Rgb => hex(catalog.materials.find((m) => m.id === id)?.average ?? '#777777');
  const t = doc.terrain;
  const layers = t.layers.map((l) => colour(l.material));
  const cliff = colour(t.cliffMaterial);
  const g = t.grid;
  const res = t.splat.resolution;
  const w = size;
  const h = Math.max(1, Math.round((size * t.depth) / t.width));
  const rgb = new Uint8Array(w * h * 3);
  const height = (i: number, j: number) => g.heights[Math.min(g.rows - 1, Math.max(0, j)) * g.columns + Math.min(g.columns - 1, Math.max(0, i))];
  const water = t.water;

  for (let py = 0; py < h; py++) {
    // Picture rows run north to south
    const fy = (1 - (py + 0.5) / h) * (g.rows - 1);
    for (let px = 0; px < w; px++) {
      const fx = ((px + 0.5) / w) * (g.columns - 1);
      const i = Math.round(fx);
      const j = Math.round(fy);
      const u = Math.min(res - 1, Math.floor((fx / (g.columns - 1)) * res));
      const v = Math.min(res - 1, Math.floor((fy / (g.rows - 1)) * res));
      const texel = (v * res + u) * 4;
      let r = 0;
      let gg = 0;
      let b = 0;
      let sum = 0;
      for (let k = 0; k < layers.length; k++) {
        const wk = t.splat.maps[k >> 2][texel + (k & 3)];
        r += layers[k][0] * wk;
        gg += layers[k][1] * wk;
        b += layers[k][2] * wk;
        sum += wk;
      }
      let c: Rgb = sum ? [r / sum, gg / sum, b / sum] : [120, 120, 120];
      const dx = (height(i + 1, j) - height(i - 1, j)) / (2 * g.cellSize);
      const dy = (height(i, j + 1) - height(i, j - 1)) / (2 * g.cellSize);
      const slope = Math.atan(Math.hypot(dx, dy)) * (180 / Math.PI);
      if (slope > t.cliffAngle) c = cliff;
      // Light from the north-west
      const shade = Math.max(0.55, Math.min(1.25, 1 + (-dx + dy) * 0.6));
      c = [c[0] * shade, c[1] * shade, c[2] * shade];
      if (water && water.mask[j * g.columns + i] && height(i, j) < water.level) {
        const mix = 0.6 + Math.min(1, (water.level - height(i, j)) / 3) * 0.3;
        const wc = hex(water.color);
        c = [c[0] * (1 - mix) + wc[0] * mix, c[1] * (1 - mix) + wc[1] * mix, c[2] * (1 - mix) + wc[2] * mix];
      }
      rgb.set(c.map((x) => Math.max(0, Math.min(255, Math.round(x)))), (py * w + px) * 3);
    }
  }

  const toPx = (x: number, y: number) => ({ px: ((x + t.width / 2) / t.width) * w, py: (1 - (y + t.depth / 2) / t.depth) * h });
  const dot = (x: number, y: number, r: number, c: Rgb, alpha = 1) => {
    const p = toPx(x, y);
    for (let yy = Math.floor(p.py - r); yy <= Math.ceil(p.py + r); yy++) {
      for (let xx = Math.floor(p.px - r); xx <= Math.ceil(p.px + r); xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || Math.hypot(xx - p.px, yy - p.py) > r) continue;
        const at = (yy * w + xx) * 3;
        for (let k = 0; k < 3; k++) rgb[at + k] = Math.round(rgb[at + k] * (1 - alpha) + c[k] * alpha);
      }
    }
  };

  for (const o of doc.objects) if (o.asset.startsWith('tree')) dot(o.x, o.y, Math.max(0.8, (2.5 * o.scale * w) / t.width), [32, 52, 26], 0.75);
  const scale = w / t.width;
  for (const e of doc.paths.edges) {
    const a = doc.paths.nodes.find((n) => n.id === e.a);
    const b = doc.paths.nodes.find((n) => n.id === e.b);
    if (!a || !b) continue;
    const pts = [a, ...(e.via ?? []), b];
    for (let k = 1; k < pts.length; k++) {
      const len = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
      const steps = Math.max(1, Math.ceil(len * scale));
      for (let s = 0; s <= steps; s++) {
        const x = pts[k - 1].x + ((pts[k].x - pts[k - 1].x) * s) / steps;
        const y = pts[k - 1].y + ((pts[k].y - pts[k - 1].y) * s) / steps;
        dot(x, y, Math.max(0.7, (e.width * scale) / 2), [214, 200, 168], 0.85);
      }
    }
  }
  for (const s of doc.spawns) dot(s.x, s.y, 3, [239, 68, 68]);
  dot(doc.hq.x, doc.hq.y, 3.5, [201, 164, 76]);
  return encodePng(rgb, w, h);
}
