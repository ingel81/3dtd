/**
 * Relief shading for the AI agent's top-down picture (docs/AGENT_MCP.md):
 * the editor's top view is lit flat from above, so a hill of 13 m on grass
 * did not show at all and agents read heights to find their own work. Each
 * pixel is darkened or brightened by how its ground faces a light from the
 * north-west, as on a relief map; flat ground keeps its colour.
 */
import { heightAt } from '../model/grid';
import type { MapTerrain } from '../../world/custom-map/map-document';

/** Light from the north-west, 45 degrees up (x east, y north, z up) */
const LIGHT = (() => {
  const l = [-1, 1, Math.SQRT2];
  const n = Math.hypot(l[0], l[1], l[2]);
  return l.map((v) => v / n);
})();
const FLAT = LIGHT[2];

/**
 * Shades RGBA `pixels` (rows from the north, `width` x `height`, covering
 * the whole map) in place; `strength` 0..1 scales the effect
 */
export function shadeRelief(pixels: Uint8ClampedArray, width: number, height: number, terrain: MapTerrain, strength = 0.7): void {
  const w = terrain.width;
  const d = terrain.depth;
  const step = Math.max(terrain.grid.cellSize, w / width, d / height);
  for (let py = 0; py < height; py++) {
    const y = d / 2 - ((py + 0.5) / height) * d;
    for (let px = 0; px < width; px++) {
      const x = -w / 2 + ((px + 0.5) / width) * w;
      const dx = (heightAt(terrain, x + step, y) - heightAt(terrain, x - step, y)) / (2 * step);
      const dy = (heightAt(terrain, x, y + step) - heightAt(terrain, x, y - step)) / (2 * step);
      const n = Math.hypot(dx, dy, 1);
      const lambert = (-dx * LIGHT[0] - dy * LIGHT[1] + LIGHT[2]) / n;
      const k = Math.min(1.6, Math.max(0.35, 1 + (strength * (lambert - FLAT)) / FLAT));
      if (k === 1) continue;
      const o = (py * width + px) * 4;
      pixels[o] = Math.min(255, pixels[o] * k);
      pixels[o + 1] = Math.min(255, pixels[o + 1] * k);
      pixels[o + 2] = Math.min(255, pixels[o + 2] * k);
    }
  }
}
