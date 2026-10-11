/**
 * Glow cracks: the ground under the brush breaks into a net of thin lava
 * cracks with a dark crust beside them, on scorched volcanic rock. The net
 * comes from ridged noise, so it is the same however the brush was moved;
 * the cracks sink a little into the ground.
 */
import type { MapPoint } from '../../../world/custom-map/map-document';
import { sampleRectAround, sampleX, sampleY, texelRectAround, texelX, texelY, type GridRect } from '../../model/grid';
import { brushWeight, type BrushSettings } from '../brush';
import { MAX_LAYERS, readWeights, writeWeights } from '../paint-ops';
import { smooth } from './landscape-noise';
import type { LandscapeStroke } from './landscape-stroke';

/** Share per second the ground closes toward the cracked look */
const CRACK_RATE = 2.5;
/** Metres the cracks sink at full strength */
const CRACK_DEPTH = 0.5;
/** Metres between cracks */
const CRACK_WAVE = 9;

/** How much of a crack (1 in it, 0 away) and of its crust lies at a point */
export function crackAt(stroke: LandscapeStroke, x: number, y: number): { crack: number; crust: number } {
  const n = stroke.noise;
  // Warp the net so the cracks wander instead of following the noise lattice
  const wx = x + n.fbm(x, y, 20, 2, 'n5') * 4;
  const wy = y + n.fbm(x, y, 20, 2, 'n6') * 4;
  const ridge = n.ridged(wx, wy, CRACK_WAVE, 1);
  // Wider cracks in places, gone in others
  const life = smooth(-0.35, 0.1, n.fbm(x, y, 45, 2, 'n4'));
  return { crack: smooth(0.76, 0.86, ridge) * life, crust: smooth(0.5, 0.76, ridge) * (0.5 + 0.5 * life) };
}

export function cracksDab(stroke: LandscapeStroke, center: MapPoint, brush: BrushSettings, dt: number): { heights: GridRect; splat: GridRect | null } {
  const t = stroke.doc.terrain;
  const g = t.grid;
  const a = (1 - Math.exp(-CRACK_RATE * Math.min(dt, 0.1))) * brush.strength;
  const falloff = Math.max(0.3, brush.falloff);

  const rect = sampleRectAround(t, center.x, center.y, brush.radius);
  stroke.touchHeights(rect);
  for (let j = rect.j0; j <= rect.j1; j++) {
    const y = sampleY(t, j);
    for (let i = rect.i0; i <= rect.i1; i++) {
      const x = sampleX(t, i);
      const w = brushWeight(Math.hypot(x - center.x, y - center.y), brush.radius, falloff) * stroke.roadKeep(x, y);
      if (w <= 0) continue;
      const { crack } = crackAt(stroke, x, y);
      if (crack <= 0) continue;
      const k = j * g.columns + i;
      const target = stroke.baseHeight(i, j) - CRACK_DEPTH * crack * w;
      if (g.heights[k] > target) g.heights[k] += (target - g.heights[k]) * Math.min(1, a * 2);
    }
  }

  const lava = stroke.layerOf(['lava', 'lava-crust']);
  const crust = stroke.layerOf(['lava-crust', 'basalt', 'volcanic-rock']);
  const rock = stroke.layerOf(['scorched-ground', 'volcanic-rock', 'basalt']);
  if (lava === null || rock === null) return { heights: rect, splat: null };
  const splat = texelRectAround(t, center.x, center.y, brush.radius);
  stroke.touchSplat(splat);
  const res = t.splat.resolution;
  const w8 = new Float32Array(MAX_LAYERS);
  const target = new Float32Array(MAX_LAYERS);
  for (let v = splat.j0; v <= splat.j1; v++) {
    const y = texelY(t, v);
    for (let u = splat.i0; u <= splat.i1; u++) {
      const x = texelX(t, u);
      const w = brushWeight(Math.hypot(x - center.x, y - center.y), brush.radius, falloff) * stroke.roadKeep(x, y);
      if (w <= 0) continue;
      const c = crackAt(stroke, x, y);
      target.fill(0);
      target[lava] += c.crack;
      target[crust ?? rock] += c.crust * (1 - c.crack);
      target[rock] += Math.max(0, 1 - c.crack - c.crust * (1 - c.crack));
      let sum = 0;
      for (let k = 0; k < MAX_LAYERS; k++) sum += target[k];
      const texel = v * res + u;
      const blend = Math.min(1, a * w);
      readWeights(t, texel, w8);
      for (let k = 0; k < MAX_LAYERS; k++) w8[k] += ((target[k] / sum) * 255 - w8[k]) * blend;
      writeWeights(t, texel, w8);
    }
  }
  return { heights: rect, splat };
}
