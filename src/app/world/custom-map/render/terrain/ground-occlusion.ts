import { ClampToEdgeWrapping, DataTexture, LinearFilter, NoColorSpace, RedFormat, UnsignedByteType } from 'three';
import type { MapObject } from '../../map-document';
import type { CatalogObject } from '../asset-catalog';
import type { HeightField } from '../height-field';

/**
 * Ambient occlusion baked onto the height grid, one value per sample:
 *
 * - terrain: how much of the sky the slopes around a sample hide (horizon
 *   angles in eight directions out to 32 m), so hollows, gullies and the
 *   foot of slopes and cliffs darken
 * - objects: a soft dark spot under trees, rocks and buildings (contact
 *   shadow), as wide as their footprint and a bit more
 *
 * The terrain shader multiplies its ambient light by it (and the direct
 * light a little). One byte per sample, linearly filtered.
 */

const DIRECTIONS = 8;
const STEPS = [2, 4, 8, 16, 32];
/** How dark full occlusion gets */
const TERRAIN_STRENGTH = 1.1;

const OBJECT_DARKNESS: Partial<Record<CatalogObject['category'], number>> = {
  tree: 0.4,
  building: 0.55,
  structure: 0.4,
  wall: 0.35,
  rock: 0.35,
  plant: 0.15,
  prop: 0.2,
};

export class GroundOcclusion {
  readonly texture: DataTexture;
  private readonly terrain: Float32Array;
  private readonly objects: Float32Array;
  private readonly pixels: Uint8Array;

  constructor(private readonly field: HeightField) {
    const n = field.columns * field.rows;
    this.terrain = new Float32Array(n).fill(1);
    this.objects = new Float32Array(n).fill(1);
    this.pixels = new Uint8Array(n).fill(255);
    this.texture = new DataTexture(this.pixels, field.columns, field.rows, RedFormat, UnsignedByteType);
    this.texture.colorSpace = NoColorSpace;
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.unpackAlignment = 1;
    this.updateTerrain();
  }

  /** Terrain occlusion of the samples in a rectangle (whole grid when omitted), plus the reach of the horizon search */
  updateTerrain(rect?: { i0: number; j0: number; i1: number; j1: number }): void {
    const f = this.field;
    const reach = Math.ceil(STEPS[STEPS.length - 1] / f.cellSize);
    const i0 = Math.max(0, (rect?.i0 ?? 0) - reach);
    const j0 = Math.max(0, (rect?.j0 ?? 0) - reach);
    const i1 = Math.min(f.columns - 1, (rect?.i1 ?? f.columns - 1) + reach);
    const j1 = Math.min(f.rows - 1, (rect?.j1 ?? f.rows - 1) + reach);
    const dirs = Array.from({ length: DIRECTIONS }, (_, k) => {
      const a = (k / DIRECTIONS) * Math.PI * 2;
      return [Math.cos(a), Math.sin(a)];
    });
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = f.originX + i * f.cellSize;
        const y = f.originY + j * f.cellSize;
        const h = f.sample(i, j);
        let occ = 0;
        for (const [dx, dy] of dirs) {
          let maxSin = 0;
          for (const d of STEPS) {
            const rise = f.heightAt(x + dx * d, y + dy * d) - h;
            if (rise <= 0) continue;
            const sin = rise / Math.hypot(rise, d);
            if (sin > maxSin) maxSin = sin;
          }
          occ += maxSin;
        }
        this.terrain[j * f.columns + i] = Math.max(0.25, 1 - (occ / DIRECTIONS) * TERRAIN_STRENGTH);
      }
    }
    this.upload(i0, j0, i1, j1);
  }

  /** Contact shadows of the placed objects (replaces the previous ones) */
  setObjects(objects: MapObject[], entries: Map<string, CatalogObject>): void {
    const f = this.field;
    this.objects.fill(1);
    for (const o of objects) {
      const e = entries.get(o.asset);
      const dark = e ? OBJECT_DARKNESS[e.category] : undefined;
      if (!e || !dark || e.footprint <= 0) continue;
      const r = e.footprint * (o.scale || 1) * 1.5;
      const ci = (o.x - f.originX) / f.cellSize;
      const cj = (o.y - f.originY) / f.cellSize;
      const rc = r / f.cellSize;
      for (let j = Math.max(0, Math.floor(cj - rc)); j <= Math.min(f.rows - 1, Math.ceil(cj + rc)); j++) {
        for (let i = Math.max(0, Math.floor(ci - rc)); i <= Math.min(f.columns - 1, Math.ceil(ci + rc)); i++) {
          const d = Math.hypot(i - ci, j - cj) / rc;
          if (d >= 1) continue;
          const t = 1 - d;
          const k = j * f.columns + i;
          this.objects[k] *= 1 - dark * t * t * (3 - 2 * t);
        }
      }
    }
    this.upload(0, 0, f.columns - 1, f.rows - 1);
  }

  /** Occlusion at sample (i, j), 0 dark to 1 open */
  at(i: number, j: number): number {
    return this.pixels[j * this.field.columns + i] / 255;
  }

  dispose(): void {
    this.texture.dispose();
  }

  private upload(i0: number, j0: number, i1: number, j1: number): void {
    const cols = this.field.columns;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * cols + i;
        this.pixels[k] = Math.round(Math.max(0, Math.min(1, this.terrain[k] * this.objects[k])) * 255);
      }
    }
    this.texture.needsUpdate = true;
  }
}
