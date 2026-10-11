import { ClampToEdgeWrapping, DataTexture, FloatType, NearestFilter, NoColorSpace, RedFormat, Vector2, Vector4 } from 'three';
import type { MapObject, MapTerrain } from '../../map-document';
import type { CatalogObject } from '../asset-catalog';
import type { HeightField } from '../height-field';

/**
 * The top of everything rain and snow stop on, one value per height sample:
 * the terrain, raised to the roof height inside the footprint of buildings,
 * structures and rocks, and to the surface of water, lava and ice. Weather
 * particles below it are not drawn, so it does not rain indoors or through
 * the ground; grass grows only where the top is the ground itself. Coarse
 * by design (the grid's cells, a footprint circle per object).
 */
export class CoverMap {
  readonly texture: DataTexture;
  private readonly tops: Float32Array;
  /** Uniforms for a shader that includes COVER_GLSL; uCoverFrame xy is the map group's scene offset */
  readonly uniforms: {
    uCover: { value: DataTexture };
    uCoverGrid: { value: Vector4 };
    uCoverSize: { value: Vector2 };
    uCoverFrame: { value: Vector2 };
  };

  constructor(private readonly field: HeightField) {
    this.tops = new Float32Array(field.columns * field.rows);
    this.texture = new DataTexture(this.tops, field.columns, field.rows, RedFormat, FloatType);
    this.texture.colorSpace = NoColorSpace;
    this.texture.magFilter = this.texture.minFilter = NearestFilter;
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.uniforms = {
      uCover: { value: this.texture },
      uCoverGrid: { value: new Vector4(field.originX, field.originY, field.cellSize, 0) },
      uCoverSize: { value: new Vector2(field.columns, field.rows) },
      uCoverFrame: { value: new Vector2() },
    };
    this.set([], new Map());
  }

  /** Terrain heights plus the roofs of buildings, structures and rocks, and the surfaces of water bodies and rivers */
  set(objects: MapObject[], entries: Map<string, CatalogObject>, terrain?: MapTerrain): void {
    const f = this.field;
    this.tops.set(f.grid.heights);
    if (terrain) this.addWater(terrain);
    for (const o of objects) {
      const e = entries.get(o.asset);
      if (!e || (e.category !== 'building' && e.category !== 'structure' && e.category !== 'rock')) continue;
      const s = o.scale || 1;
      const r = e.footprint * s;
      const top = f.heightAt(o.x, o.y) + o.z + e.height * s;
      const ci = (o.x - f.originX) / f.cellSize;
      const cj = (o.y - f.originY) / f.cellSize;
      const rc = r / f.cellSize;
      for (let j = Math.max(0, Math.floor(cj - rc)); j <= Math.min(f.rows - 1, Math.ceil(cj + rc)); j++) {
        for (let i = Math.max(0, Math.floor(ci - rc)); i <= Math.min(f.columns - 1, Math.ceil(ci + rc)); i++) {
          if (Math.hypot(i - ci, j - cj) > rc) continue;
          const k = j * f.columns + i;
          if (top > this.tops[k]) this.tops[k] = top;
        }
      }
    }
    this.texture.needsUpdate = true;
  }

  private addWater(t: MapTerrain): void {
    const f = this.field;
    const tops = this.tops;
    for (const body of [t.water, ...(t.waterBodies ?? [])]) {
      if (!body) continue;
      for (let k = 0; k < tops.length; k++) if (body.mask[k] && body.level > tops[k]) tops[k] = body.level;
    }
    // Rivers: a disc of the surface's width every half cell along the line
    for (const river of t.rivers ?? []) {
      for (let p = 0; p < river.points.length - 1; p++) {
        const a = river.points[p];
        const b = river.points[p + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (f.cellSize * 0.5)));
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          const x = a.x + (b.x - a.x) * u;
          const y = a.y + (b.y - a.y) * u;
          const level = a.height + (b.height - a.height) * u;
          const rc = ((a.width + (b.width - a.width) * u) * 0.5) / f.cellSize;
          const ci = (x - f.originX) / f.cellSize;
          const cj = (y - f.originY) / f.cellSize;
          for (let j = Math.max(0, Math.floor(cj - rc)); j <= Math.min(f.rows - 1, Math.ceil(cj + rc)); j++) {
            for (let i = Math.max(0, Math.floor(ci - rc)); i <= Math.min(f.columns - 1, Math.ceil(ci + rc)); i++) {
              if (Math.hypot(i - ci, j - cj) > rc) continue;
              const k = j * f.columns + i;
              if (level > tops[k]) tops[k] = level;
            }
          }
        }
      }
    }
  }

  /** Where the map group sits in the scene (the game moves it so its HQ is at the origin) */
  setFrame(x: number, z: number): void {
    this.uniforms.uCoverFrame.value.set(x, z);
  }

  dispose(): void {
    this.texture.dispose();
  }
}

export const COVER_GLSL = /* glsl */ `
uniform sampler2D uCover;
uniform vec4 uCoverGrid;
uniform vec2 uCoverSize;
uniform vec2 uCoverFrame;

// Height of the cover under a scene position (terrain or roof), nearest sample
float coverTopAt(vec3 scenePos) {
  vec2 m = vec2(-(scenePos.x - uCoverFrame.x), scenePos.z - uCoverFrame.y);
  vec2 g = clamp((m - uCoverGrid.xy) / uCoverGrid.z + 0.5, vec2(0.0), uCoverSize - 1.0);
  return texelFetch(uCover, ivec2(g), 0).r;
}
`;
