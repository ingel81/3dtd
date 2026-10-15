import { BufferAttribute, BufferGeometry, Group, type Mesh, type ShaderMaterial } from 'three';
import type { MapLifeArea } from '../../map-document';
import { insideOutline, nearestOnShape } from '../../map-life';
import { WIND_UNIFORMS } from '../environment/wind';
import type { HeightField } from '../height-field';
import { heatHazeMesh } from '../water/heat-haze';
import type { SceneCopy } from '../water/scene-copy';

/**
 * Heat shimmering over hot ground (life areas of kind `haze`: a desert
 * canyon floor, a road in the sun): a sheet draped 0.6 m over the ground
 * inside the outline, or in a band along a line, drawing the frame behind it
 * moved by rising noise (water/heat-haze.ts, the same as over lava), faded
 * over its last CELL * 3 metres. It reads the frame copy the water's
 * refraction makes, so it shows only with the lava glow effect on (High and
 * Ultra, or the player's switch), as the lava's shimmer does.
 */

/** Metres between the sheet's points, the band's half width along a line, the most points of one area */
const CELL = 4;
const BAND = 8;
const MOST_POINTS = 40_000;

export class LifeHaze {
  readonly group = new Group();
  private sheets: Mesh<BufferGeometry, ShaderMaterial>[] = [];

  constructor(private readonly field: HeightField) {
    this.group.name = 'custom-map-life-haze';
    this.group.userData['losTransparent'] = true;
  }

  /** The sheets of these areas (those of kind haze); none without the frame copy (the effect off) */
  set(areas: readonly MapLifeArea[], copy: SceneCopy | null): void {
    this.clear();
    if (!copy) return;
    for (const area of areas) {
      if (area.kind !== 'haze') continue;
      const geometry = hazeGeometry(area, this.field);
      if (!geometry) continue;
      const sheet = heatHazeMesh(geometry, WIND_UNIFORMS.uWindTime, copy);
      sheet.frustumCulled = false;
      this.sheets.push(sheet);
      this.group.add(sheet);
    }
  }

  private clear(): void {
    for (const s of this.sheets) {
      s.removeFromParent();
      s.geometry.dispose();
      s.material.dispose();
    }
    this.sheets = [];
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }
}

/** The draped sheet of an area (scene space) with `aDepth`, null when it covers nothing */
export function hazeGeometry(area: MapLifeArea, field: HeightField): BufferGeometry | null {
  const pts = area.points;
  const band = area.shape === 'route' ? BAND : 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x - band);
    maxX = Math.max(maxX, p.x + band);
    minY = Math.min(minY, p.y - band);
    maxY = Math.max(maxY, p.y + band);
  }
  const step = Math.max(CELL, Math.sqrt(((maxX - minX) * (maxY - minY)) / MOST_POINTS));
  const cols = Math.max(2, Math.ceil((maxX - minX) / step) + 1);
  const rows = Math.max(2, Math.ceil((maxY - minY) / step) + 1);
  const position = new Float32Array(cols * rows * 3);
  const depth = new Float32Array(cols * rows);
  const inside = new Uint8Array(cols * rows);
  const near = { x: 0, y: 0 };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = minX + i * step;
      const y = minY + j * step;
      const k = j * cols + i;
      position.set([-x, field.heightAt(x, y) + 0.6, y], k * 3);
      if (area.shape === 'area') {
        if (!insideOutline(pts, x, y)) continue;
        // How far in from the outline, for the fade
        const d = nearestOnShape({ shape: 'route', points: [...pts, pts[0]] }, x, y, near);
        inside[k] = 1;
        depth[k] = Math.min(1, d / (CELL * 3));
      } else {
        const d = nearestOnShape(area, x, y, near);
        if (d > band) continue;
        inside[k] = 1;
        depth[k] = Math.min(1, (band - d) / (band * 0.6));
      }
    }
  }
  const index: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      if (!(inside[a] || inside[a + 1] || inside[a + cols] || inside[a + cols + 1])) continue;
      index.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  }
  if (!index.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('aDepth', new BufferAttribute(depth, 1));
  g.setIndex(index);
  return g;
}
