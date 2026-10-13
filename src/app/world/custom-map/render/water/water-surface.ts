import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  Mesh,
  NoColorSpace,
  RedFormat,
  UnsignedByteType,
  Vector2,
  Vector4,
  type ShaderMaterial,
} from 'three';
import type { MapWater } from '../../map-document';
import type { HeightField } from '../height-field';
import type { HeightTexture } from '../terrain/height-texture';
import { APRON_RINGS, RIVER_REACH, type ApronProfile } from '../terrain/terrain-apron';
import { createWaterMaterial, setWaterColor, setWaterMask, setWaterSky } from './water-material';

/**
 * One area body of a map (water, sea, swamp, ice or lava over a mask): a
 * flat surface at `level` over the mask grown by two cells. The material
 * cuts it where the terrain rises above the level (smooth shoreline,
 * water-material.ts) and fades it out by the mask, so cell-sized masks do
 * not show as steps.
 *
 * Only the main body runs on beyond the map's border (pass the apron).
 * Not a line-of-sight blocker (`userData.losTransparent`).
 */
export class WaterSurface {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly mask: DataTexture;
  /** What the surface shows now */
  kind: MapWater['kind'];

  constructor(
    private readonly field: HeightField,
    private readonly heights: HeightTexture,
    water: MapWater,
    apron: ApronProfile | null,
  ) {
    this.kind = water.kind ?? 'water';
    this.mask = new DataTexture(water.mask, field.columns, field.rows, RedFormat, UnsignedByteType);
    this.mask.colorSpace = NoColorSpace;
    this.mask.magFilter = this.mask.minFilter = LinearFilter;
    this.mask.wrapS = this.mask.wrapT = ClampToEdgeWrapping;
    this.mask.generateMipmaps = false;
    this.mask.unpackAlignment = 1;
    this.mesh = new Mesh(new BufferGeometry(), this.material(water));
    this.mesh.name = 'custom-map-water';
    this.mesh.userData['losTransparent'] = true;
    this.mesh.renderOrder = 1;
    this.mesh.matrixAutoUpdate = false;
    this.set(water, apron);
  }

  /** Rebuilds the surface for changed water or heights */
  set(water: MapWater, apron: ApronProfile | null): void {
    const kind = water.kind ?? 'water';
    if (kind !== this.kind) {
      const sky = this.mesh.material.uniforms;
      const old = this.mesh.material;
      this.kind = kind;
      this.mesh.material = this.material(water);
      // Keep the sky and light the old material had
      for (const key of ['uZenith', 'uHorizon', 'uSunDir', 'uSunColor', 'uCloudColor', 'uCloudShadow', 'uCover', 'uGlow', 'uSkyTime', 'uCloudOffset', 'uLight']) {
        if (sky[key]) this.mesh.material.uniforms[key] = sky[key];
      }
      old.dispose();
    }
    setWaterColor(this.mesh.material, kind, water.color);
    this.mask.image.data = water.mask;
    this.mask.needsUpdate = true;
    this.mesh.geometry.dispose();
    this.mesh.geometry = this.buildGeometry(water, apron);
    this.mesh.visible = (this.mesh.geometry.index?.count ?? 0) > 0;
  }

  setSky(skyUniforms: ShaderMaterial['uniforms'], sunIntensity: number): void {
    setWaterSky(this.mesh.material, skyUniforms, sunIntensity);
  }

  update(dt: number): void {
    this.mesh.material.uniforms['uTime'].value += dt;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mask.dispose();
    this.mesh.removeFromParent();
  }

  private material(water: MapWater): ShaderMaterial {
    const f = this.field;
    const m = createWaterMaterial({
      kind: water.kind ?? 'water',
      river: false,
      heights: this.heights,
      color: water.color,
      mapHalf: new Vector2(((f.columns - 1) * f.cellSize) / 2, ((f.rows - 1) * f.cellSize) / 2),
    });
    // Map metres to mask texel centres
    const sx = 1 / (f.cellSize * f.columns);
    const sy = 1 / (f.cellSize * f.rows);
    setWaterMask(m, this.mask, new Vector4(sx, sy, -f.originX * sx + 0.5 / f.columns, -f.originY * sy + 0.5 / f.rows));
    return m;
  }

  private buildGeometry(water: MapWater, apron: ApronProfile | null): BufferGeometry {
    const f = this.field;
    const cols = f.columns;
    const rows = f.rows;
    const mask = water.mask;
    // The mask grown by two samples: the material cuts the surface where the terrain is above it
    const grown = new Uint8Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (!mask[j * cols + i]) continue;
        for (let dj = -2; dj <= 2; dj++) {
          for (let di = -2; di <= 2; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii >= 0 && jj >= 0 && ii < cols && jj < rows) grown[jj * cols + ii] = 1;
          }
        }
      }
    }
    const vertexOf = new Int32Array(cols * rows).fill(-1);
    const positions: number[] = [];
    const depths: number[] = [];
    const indices: number[] = [];
    const vertex = (i: number, j: number): number => {
      const k = j * cols + i;
      if (vertexOf[k] < 0) {
        vertexOf[k] = positions.length / 3;
        positions.push(-(f.originX + i * f.cellSize), water.level, f.originY + j * f.cellSize);
        depths.push(water.level - f.sample(i, j));
      }
      return vertexOf[k];
    };
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const k = j * cols + i;
        if (!(grown[k] && grown[k + 1] && grown[k + cols] && grown[k + cols + 1])) continue;
        // Skip cells above the water at every corner (their planar triangles are above it everywhere)
        const lo = Math.min(f.sample(i, j), f.sample(i + 1, j), f.sample(i, j + 1), f.sample(i + 1, j + 1));
        if (lo > water.level) continue;
        const v00 = vertex(i, j);
        const v10 = vertex(i + 1, j);
        const v01 = vertex(i, j + 1);
        const v11 = vertex(i + 1, j + 1);
        indices.push(v00, v10, v11, v00, v11, v01);
      }
    }
    // Water that reaches the border runs on beyond it over the apron's rings; it ends where the
    // apron's blurred bed rises above the level (negative depth, discarded in the shader)
    const p = apron;
    // A river runs on a little way; a sea (most of the border wet) to the horizon
    const rings = p && p.wetShare > 0.5 ? APRON_RINGS.length : APRON_RINGS.filter((d) => d <= RIVER_REACH).length;
    const n = p?.count ?? 0;
    const wetBorder = (k: number): boolean => {
      const [x, y] = p!.position(0, k);
      const i = Math.round((x - f.originX) / f.cellSize);
      const j = Math.round((y - f.originY) / f.cellSize);
      return mask[j * cols + i] > 0 && f.sample(i, j) < water.level;
    };
    const ringVertex = new Map<number, number>();
    const apronVertex = (r: number, k: number): number => {
      const key = r * n + (k % n);
      let v = ringVertex.get(key);
      if (v === undefined) {
        v = positions.length / 3;
        const [x, y] = p!.position(r, k % n);
        positions.push(-x, water.level, y);
        depths.push(water.level - p!.height(r, k % n));
        ringVertex.set(key, v);
      }
      return v;
    };
    for (let k = 0; k < n; k++) {
      if (p!.wetShare <= 0.5 && (!wetBorder(k) || !wetBorder((k + 1) % n))) continue;
      for (let r = 0; r < rings - 1; r++) {
        const a = apronVertex(r, k);
        const b = apronVertex(r, k + 1);
        const c = apronVertex(r + 1, k);
        const e = apronVertex(r + 1, k + 1);
        // Both windings; the material draws one side
        indices.push(a, c, b, b, c, e, a, b, c, b, e, c);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute('aDepth', new BufferAttribute(new Float32Array(depths), 1));
    g.setIndex(indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
