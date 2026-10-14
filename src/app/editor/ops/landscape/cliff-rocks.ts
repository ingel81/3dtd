/**
 * Cliff rocks: held over steep ground, the brush stands cliff models of the
 * catalogue along the steep edges, so a cliff reads as rock with ledges and
 * not as stretched ground. On a grid of spots (decided once a stroke, as
 * the biome brush's plants) each spot steeper than the map's cliff angle
 * gets a wall, its width along the contour and its face to the low side,
 * scaled to how far the ground falls there and sunk a little into the
 * slope; walls keep apart by about half their width. The models come from
 * the map's look (desert sandstone, volcanic basalt, Mars …) or the one
 * chosen in the panel.
 */
import type { MapBiome, MapPoint } from '../../../world/custom-map/map-document';
import type { CatalogIndex } from '../../catalog/asset-catalog';
import { brushWeight, type BrushSettings } from '../brush';
import { heightAt, slopeAt } from '../../model/grid';
import type { LandscapeStroke } from './landscape-stroke';

/** Cliff models by the map's look; the first that the catalogue has */
export const CLIFF_MODELS: Partial<Record<MapBiome, readonly string[]>> & { default: readonly string[] } = {
  default: ['cliff-wall', 'cliff-wall-b', 'cliff-face', 'cliff-face-b'],
  desert: ['cliff-wall-sandstone', 'cliff-wall'],
  hell: ['cliff-wall-basalt', 'cliff-wall-b'],
  apocalypse: ['cliff-wall-basalt', 'cliff-wall'],
  mars: ['mars-cliff', 'cliff-wall-b'],
  moon: ['cliff-wall', 'cliff-face'],
};

/** Every cliff model the catalogue offers, for the panel's choice */
export function cliffModelIds(catalog: CatalogIndex): string[] {
  const all = new Set([...Object.values(CLIFF_MODELS).flat(), 'cliff-coast']);
  return [...all].filter((id) => catalog.objects.has(id));
}

/** The models a stroke picks from: the chosen one, or those of the map's look */
export function cliffModelsFor(biome: MapBiome | undefined, chosen: string, catalog: CatalogIndex): string[] {
  if (chosen !== 'auto') return catalog.objects.has(chosen) ? [chosen] : [];
  const list = (biome && CLIFF_MODELS[biome]) || CLIFF_MODELS.default;
  return list.filter((id) => catalog.objects.has(id));
}

/** Spots a side apart on the stroke's grid */
const SPOT = 4;
/** Ground falls this far over a wall's depth before it counts, metres */
const MIN_FALL = 2;

/** One dab: walls on the steep spots under the brush; returns the new objects' ids */
export function cliffRocksDab(stroke: LandscapeStroke, center: MapPoint, brush: BrushSettings, models: readonly string[], catalog: CatalogIndex): string[] {
  if (!models.length) return [];
  const t = stroke.doc.terrain;
  const steep = Math.min(t.cliffAngle, 45);
  const before = stroke.added.length;
  const r = brush.radius;
  for (let gy = Math.floor((center.y - r) / SPOT); gy <= Math.ceil((center.y + r) / SPOT); gy++) {
    for (let gx = Math.floor((center.x - r) / SPOT); gx <= Math.ceil((center.x + r) / SPOT); gx++) {
      const key = `cliff:${gx},${gy}`;
      if (stroke.decided.has(key)) continue;
      // A spot jitters within its cell, the same way for the same seed
      const x = (gx + 0.2 + 0.6 * stroke.noise.hash(gx, gy, 71)) * SPOT;
      const y = (gy + 0.2 + 0.6 * stroke.noise.hash(gx, gy, 72)) * SPOT;
      const d = Math.hypot(x - center.x, y - center.y);
      if (d > r || stroke.noise.hash(gx, gy, 73) > brushWeight(d, r, brush.falloff) * brush.strength * 2) continue;
      stroke.decided.add(key);
      if (Math.abs(x) > t.width / 2 - 2 || Math.abs(y) > t.depth / 2 - 2) continue;
      if (slopeAt(t, x, y) < steep) continue;
      const asset = models[Math.floor(stroke.noise.hash(gx, gy, 74) * models.length) % models.length];
      const entry = catalog.object(asset);
      // Downhill along the gradient, measured over the wall's depth
      const reach = Math.max(2, entry.radius * 0.6);
      const gxh = (heightAt(t, x + reach, y) - heightAt(t, x - reach, y)) / (2 * reach);
      const gyh = (heightAt(t, x, y + reach) - heightAt(t, x, y - reach)) / (2 * reach);
      const g = Math.hypot(gxh, gyh);
      if (g < 1e-3) continue;
      const down = { x: -gxh / g, y: -gyh / g };
      const fall = heightAt(t, x - down.x * reach, y - down.y * reach) - heightAt(t, x + down.x * reach, y + down.y * reach);
      if (fall < MIN_FALL) continue;
      const scale = Math.min(1.8, Math.max(0.5, (fall / entry.height) * 1.15 * (0.9 + 0.2 * stroke.noise.hash(gx, gy, 75))));
      const width = entry.radius * scale;
      if (stroke.grid.near({ x, y }, width * 0.9)) continue;
      if (!stroke.freeForObject(x, y, width * 0.4)) continue;
      // The model's north to the low side: its width runs along the contour
      const rotation = Math.atan2(-down.x, down.y);
      stroke.addObject({
        asset,
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
        z: Math.round(-fall * 0.25 * 100) / 100,
        rotation: Math.round((((rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * 1000) / 1000,
        scale: Math.round(scale * 1000) / 1000,
      });
    }
  }
  // With their symmetric images
  return stroke.added.slice(before).map((o) => o.id);
}
