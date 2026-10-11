/**
 * A top-down picture of an imported map for checking by eye: ground layers
 * in flat colours with hill shading, water, objects as dots by category,
 * roads as lines in their width, spawns (red) and the HQ (yellow).
 * Writes PNG bytes with a tiny encoder over fflate's zlib.
 */

import { zlibSync } from 'fflate';
import type { CustomMapDocument } from '../../src/app/world/custom-map/map-document';

const LAYER_COLOURS: Record<string, [number, number, number]> = {
  grass: [96, 140, 64],
  'grass-lush': [70, 130, 50],
  'grass-dry': [150, 150, 80],
  meadow: [110, 150, 70],
  dirt: [130, 100, 70],
  mud: [95, 75, 55],
  'forest-floor': [80, 90, 50],
  'forest-ground': [90, 85, 55],
  'rocky-ground': [125, 120, 110],
  gravel: [150, 145, 135],
  cliff: [100, 95, 90],
  'rock-mossy': [100, 115, 90],
  sand: [210, 190, 140],
  snow: [235, 240, 245],
  cobblestone: [160, 120, 110],
  paving: [175, 170, 160],
  'dirt-path': [160, 130, 95],
  'gravel-path': [165, 155, 135],
  'gravel-light': [190, 185, 175],
  'forest-moss': [70, 95, 45],
  'cobblestone-grey': [150, 150, 150],
  'cobblestone-mossy': [120, 130, 100],
  'snow-fresh': [245, 248, 250],
  'snow-rocky': [200, 205, 210],
  'snow-windswept': [230, 235, 240],
  'frozen-ground': [190, 200, 205],
  'sandstone-paving': [205, 180, 140],
  'sand-gravelly': [200, 180, 140],
  'desert-hardpan': [190, 160, 120],
  'desert-stony': [170, 150, 120],
  'grass-sparse': [140, 150, 90],
  'grass-leafy': [110, 140, 60],
  'grass-withered': [160, 150, 90],
  'leaves-autumn': [170, 100, 40],
  'leaves-scattered': [140, 110, 60],
};

const OBJECT_COLOURS: [RegExp, [number, number, number]][] = [
  [/^tree/, [20, 70, 20]],
  [/^rock/, [60, 60, 60]],
  [/^bush|plant|fern/, [40, 110, 40]],
  [/^house|tower|barn/, [150, 40, 150]],
  [/^wall|fence/, [90, 60, 30]],
  [/./, [230, 150, 30]],
];

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Renders `pixelsPerMetre` pixels per metre (north up) */
export function renderTopDown(doc: CustomMapDocument, pixelsPerMetre = 2): { png: Uint8Array; width: number; height: number } {
  const t = doc.terrain;
  const W = Math.round(t.width * pixelsPerMetre);
  const H = Math.round(t.depth * pixelsPerMetre);
  const rgb = new Uint8Array(W * H * 3);
  const g = t.grid;
  const hAt = (x: number, y: number): number => {
    const i = Math.max(0, Math.min(g.columns - 1, Math.round((x + t.width / 2) / g.cellSize)));
    const j = Math.max(0, Math.min(g.rows - 1, Math.round((y + t.depth / 2) / g.cellSize)));
    return g.heights[j * g.columns + i];
  };
  const res = t.splat.resolution;
  const layerColours = t.layers.map((l) => LAYER_COLOURS[l.material] ?? [200, 0, 200]);
  for (let py = 0; py < H; py++) {
    const y = t.depth / 2 - (py + 0.5) / pixelsPerMetre;
    for (let px = 0; px < W; px++) {
      const x = -t.width / 2 + (px + 0.5) / pixelsPerMetre;
      const u = Math.min(res - 1, Math.floor(((x + t.width / 2) / t.width) * res));
      const v = Math.min(res - 1, Math.floor(((y + t.depth / 2) / t.depth) * res));
      let r = 0;
      let gg = 0;
      let b = 0;
      let sum = 0;
      for (let k = 0; k < t.layers.length; k++) {
        const w = t.splat.maps[k >> 2][(v * res + u) * 4 + (k & 3)];
        r += layerColours[k][0] * w;
        gg += layerColours[k][1] * w;
        b += layerColours[k][2] * w;
        sum += w;
      }
      if (sum > 0) {
        r /= sum;
        gg /= sum;
        b /= sum;
      }
      // Hill shade from the north-west, plus a little height brightness
      const d = 1 / pixelsPerMetre;
      const h = hAt(x, y);
      const slope = (hAt(x - d, y + d) - hAt(x + d, y - d)) / (2 * d);
      const steep = Math.abs(hAt(x + d, y) - hAt(x - d, y)) / (2 * d) + Math.abs(hAt(x, y + d) - hAt(x, y - d)) / (2 * d);
      let shade = 1 + Math.max(-0.5, Math.min(0.5, slope * 0.4)) + h * 0.01;
      if (steep > Math.tan((t.cliffAngle * Math.PI) / 180)) shade *= 0.55;
      const o = (py * W + px) * 3;
      rgb[o] = Math.max(0, Math.min(255, r * shade));
      rgb[o + 1] = Math.max(0, Math.min(255, gg * shade));
      rgb[o + 2] = Math.max(0, Math.min(255, b * shade));
      if (t.water) {
        const i = Math.round((x + t.width / 2) / g.cellSize);
        const j = Math.round((y + t.depth / 2) / g.cellSize);
        if (t.water.mask[j * g.columns + i]) {
          rgb[o] = rgb[o] * 0.3 + 40;
          rgb[o + 1] = rgb[o + 1] * 0.3 + 110;
          rgb[o + 2] = rgb[o + 2] * 0.3 + 200;
        }
      }
    }
  }
  const toPx = (x: number, y: number): [number, number] => [(x + t.width / 2) * pixelsPerMetre, (t.depth / 2 - y) * pixelsPerMetre];
  const dot = (cx: number, cy: number, radius: number, c: [number, number, number], alpha = 1): void => {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const px = Math.round(cx + dx);
        const py = Math.round(cy + dy);
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const o = (py * W + px) * 3;
        for (let k = 0; k < 3; k++) rgb[o + k] = rgb[o + k] * (1 - alpha) + c[k] * alpha;
      }
    }
  };
  for (const ob of doc.objects) {
    const [px, py] = toPx(ob.x, ob.y);
    dot(px, py, Math.max(1, ob.scale * pixelsPerMetre * 0.8), OBJECT_COLOURS.find(([re]) => re.test(ob.asset))![1]);
  }
  const nodes = new Map(doc.paths.nodes.map((n) => [n.id, n]));
  for (const e of doc.paths.edges) {
    const a = nodes.get(e.a)!;
    const b = nodes.get(e.b)!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let s = 0; s <= len; s += 0.5 / pixelsPerMetre) {
      const [px, py] = toPx(a.x + ((b.x - a.x) * s) / len, a.y + ((b.y - a.y) * s) / len);
      dot(px, py, (e.width / 2) * pixelsPerMetre, [230, 60, 40], 0.18);
      dot(px, py, 1, [255, 80, 40]);
    }
  }
  for (const n of doc.paths.nodes) dot(...toPx(n.x, n.y), 2, [255, 255, 255]);
  for (const s of doc.spawns) dot(...toPx(s.x, s.y), 6, [220, 0, 0]);
  dot(...toPx(doc.hq.x, doc.hq.y), 8, [255, 220, 0]);
  return { png: encodePng(rgb, W, H), width: W, height: H };
}
