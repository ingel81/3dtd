import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  NoColorSpace,
  RedFormat,
  RGFormat,
  UnsignedByteType,
  Vector2,
  Vector4,
  type ShaderMaterial,
} from 'three';
import type { MapWater } from '../../map-document';
import type { HeightField } from '../height-field';
import type { HeightTexture } from '../terrain/height-texture';
import { APRON_RINGS, RIVER_REACH, type ApronProfile } from '../terrain/terrain-apron';
import type { GridRect } from '../terrain/terrain-chunks';
import { uploadRect } from '../terrain/texture-ranges';
import { createWaterMaterial, setWaterColor, setWaterEffects, setWaterFlow, setWaterMask, setWaterSky } from './water-material';
import type { MapEffects } from '../map-effects';
import type { SceneCopy } from './scene-copy';
import { setHeatHaze } from './heat-haze';
import { bakeFlowMap } from './flow-map';

/**
 * One area body of a map (water, sea, swamp, ice or lava over a mask): a
 * flat surface at `level` over the mask grown by two cells. The material
 * cuts it where the terrain rises above the level (smooth shoreline,
 * water-material.ts) and fades it out by the mask, so cell-sized masks do
 * not show as steps.
 *
 * Only the main body runs on beyond the map's border (pass the apron).
 * Not a line-of-sight blocker (`userData.losTransparent`).
 *
 * The surface is cut into tiles of TILE cells a side, one mesh each with
 * the same material, plus one for the part beyond the border: a brush on the
 * mask rebuilds only the tiles it reaches (`set` with a rectangle), not the
 * whole map's surface.
 */
const TILE = 64;

export class WaterSurface {
  /** The tiles and the part beyond the border */
  readonly object = new Group();
  private material: ShaderMaterial;
  private readonly tiles = new Map<number, Mesh<BufferGeometry, ShaderMaterial>>();
  private apronMesh: Mesh<BufferGeometry, ShaderMaterial> | null = null;
  private readonly mask: DataTexture;
  /** Baked current of the body (flow-map.ts), on the mask's grid */
  private readonly flow: DataTexture;
  /** A later bake of the current (editing: a pool brush must not pay for the whole body each step) */
  private flowDue: ReturnType<typeof setTimeout> | null = null;
  private flowBaked = false;
  /** What the surface shows now */
  kind: MapWater['kind'];
  private effects: { on: MapEffects; copy: SceneCopy } | null = null;
  private beforeRender: Mesh['onBeforeRender'] = () => undefined;
  /** The frame copy lava's heat shimmer reads, null when it is off (heat-haze.ts) */
  private hazeCopy: SceneCopy | null = null;

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
    this.flow = new DataTexture(new Uint8Array(field.columns * field.rows * 2), field.columns, field.rows, RGFormat, UnsignedByteType);
    this.flow.colorSpace = NoColorSpace;
    this.flow.magFilter = this.flow.minFilter = LinearFilter;
    this.flow.wrapS = this.flow.wrapT = ClampToEdgeWrapping;
    this.flow.generateMipmaps = false;
    this.flow.unpackAlignment = 1;
    this.object.name = 'custom-map-water-body';
    this.object.matrixAutoUpdate = false;
    this.material = this.makeMaterial(water);
    this.set(water, apron);
  }

  /**
   * Rebuilds the surface for changed water or heights; with `rect` (height
   * samples) only the tiles it reaches and that part of the mask, and the
   * part beyond the border only when `apron` is given
   */
  set(water: MapWater, apron: ApronProfile | null, rect?: GridRect): void {
    const kind = water.kind ?? 'water';
    if (kind !== this.kind) {
      const sky = this.material.uniforms;
      const old = this.material;
      // The haze reads the old material's clock: built again with the new one (setEffects below)
      for (const m of this.meshes()) setHeatHaze(m, null);
      this.kind = kind;
      this.material = this.makeMaterial(water);
      // Keep the sky and light the old material had
      for (const key of ['uZenith', 'uHorizon', 'uSunDir', 'uSunColor', 'uCloudColor', 'uCloudShadow', 'uCover', 'uGlow', 'uSkyTime', 'uCloudOffset', 'uSkyTex', 'uLight']) {
        if (sky[key]) this.material.uniforms[key] = sky[key];
      }
      old.dispose();
      for (const m of this.meshes()) m.material = this.material;
      if (this.effects) this.setEffects(this.effects.on, this.effects.copy);
    }
    setWaterColor(this.material, kind, water.color);
    const f = this.field;
    // A tile's cells reach two samples past the mask (the grown mask) and one for their far corner
    const r = rect
      ? { i0: Math.max(0, rect.i0 - 3), j0: Math.max(0, rect.j0 - 3), i1: Math.min(f.columns - 2, rect.i1 + 2), j1: Math.min(f.rows - 2, rect.j1 + 2) }
      : { i0: 0, j0: 0, i1: f.columns - 2, j1: f.rows - 2 };
    if (this.mask.image.data !== water.mask || !rect) {
      this.mask.image.data = water.mask;
      this.mask.needsUpdate = true;
    } else {
      uploadRect(this.mask, rect);
    }
    // Ice stands still. The current runs over the whole body, before the tiles are built: the first bake
    // right away, edits (a mask or height brush) once they pause for a quarter second
    if (kind !== 'ice') {
      if (this.flowDue) clearTimeout(this.flowDue);
      this.flowDue = null;
      const bake = (): void => {
        this.flowDue = null;
        this.flow.image.data = bakeFlowMap(this.field, water, this.flow.image.data as Uint8Array);
        this.flow.needsUpdate = true;
        this.flowBaked = true;
      };
      if (this.flowBaked) this.flowDue = setTimeout(bake, 250);
      else bake();
    }
    for (let tj = Math.floor(r.j0 / TILE); tj <= Math.floor(r.j1 / TILE); tj++) {
      for (let ti = Math.floor(r.i0 / TILE); ti <= Math.floor(r.i1 / TILE); ti++) this.buildTile(water, ti, tj);
    }
    if (apron || !rect) this.buildApron(water, apron);
  }

  /** The tile and border meshes (all share the material) */
  meshes(): Mesh<BufferGeometry, ShaderMaterial>[] {
    return [...this.tiles.values(), ...(this.apronMesh ? [this.apronMesh] : [])];
  }

  setSky(skyUniforms: ShaderMaterial['uniforms'], sunIntensity: number): void {
    setWaterSky(this.material, skyUniforms, sunIntensity);
  }

  /** Switchable effects (refraction, sea waves); `copy` is the view's frame copy */
  setEffects(on: MapEffects, copy: SceneCopy): void {
    this.effects = { on, copy };
    const { refraction } = setWaterEffects(this.material, this.kind ?? 'water', on, copy);
    this.beforeRender = refraction ? (renderer) => copy.capture(renderer) : () => undefined;
    for (const m of this.meshes()) m.onBeforeRender = this.beforeRender;
    // Lava's heat shimmer over every tile
    this.hazeCopy = on.lavaGlow && this.kind === 'lava' ? copy : null;
    for (const m of this.meshes()) setHeatHaze(m, this.hazeCopy);
  }

  update(dt: number): void {
    this.material.uniforms['uTime'].value += dt;
  }

  dispose(): void {
    for (const m of this.meshes()) setHeatHaze(m, null);
    for (const m of this.meshes()) m.geometry.dispose();
    this.tiles.clear();
    this.apronMesh = null;
    this.material.dispose();
    if (this.flowDue) clearTimeout(this.flowDue);
    this.mask.dispose();
    this.flow.dispose();
    this.object.removeFromParent();
  }

  private makeMesh(geometry: BufferGeometry): Mesh<BufferGeometry, ShaderMaterial> {
    const mesh = new Mesh(geometry, this.material);
    mesh.name = 'custom-map-water';
    mesh.userData['losTransparent'] = true;
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
    // Refraction copies the frame before the first tile draws (once a frame)
    mesh.onBeforeRender = this.beforeRender;
    if (this.hazeCopy) setHeatHaze(mesh, this.hazeCopy);
    mesh.matrixAutoUpdate = false;
    this.object.add(mesh);
    return mesh;
  }

  /** One tile's cells anew; a tile without water goes */
  private buildTile(water: MapWater, ti: number, tj: number): void {
    const key = tj * 4096 + ti;
    const old = this.tiles.get(key);
    const geometry = this.buildGeometry(water, ti * TILE, tj * TILE);
    if (old) {
      setHeatHaze(old, null);
      old.geometry.dispose();
      old.removeFromParent();
      this.tiles.delete(key);
    }
    if (!geometry) return;
    this.tiles.set(key, this.makeMesh(geometry));
  }

  private buildApron(water: MapWater, apron: ApronProfile | null): void {
    if (this.apronMesh) {
      setHeatHaze(this.apronMesh, null);
      this.apronMesh.geometry.dispose();
      this.apronMesh.removeFromParent();
      this.apronMesh = null;
    }
    const geometry = apron ? this.buildApronGeometry(water, apron) : null;
    if (geometry) this.apronMesh = this.makeMesh(geometry);
  }

  private makeMaterial(water: MapWater): ShaderMaterial {
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
    setWaterFlow(m, (water.kind ?? 'water') === 'ice' ? null : this.flow);
    return m;
  }

  /**
   * The cells of one tile (from cell (i0, j0), TILE a side) that hold water:
   * the mask grown by two samples, cells above the level at every corner
   * left out; null when none
   */
  private buildGeometry(water: MapWater, ci0: number, cj0: number): BufferGeometry | null {
    const f = this.field;
    const cols = f.columns;
    const rows = f.rows;
    const mask = water.mask;
    const ci1 = Math.min(cols - 2, ci0 + TILE - 1);
    const cj1 = Math.min(rows - 2, cj0 + TILE - 1);
    // The mask grown by two samples over the tile's samples: the material cuts the surface where the terrain is above it
    const sw = ci1 - ci0 + 2;
    const sh = cj1 - cj0 + 2;
    const grown = new Uint8Array(sw * sh);
    for (let j = Math.max(0, cj0 - 2); j <= Math.min(rows - 1, cj1 + 3); j++) {
      for (let i = Math.max(0, ci0 - 2); i <= Math.min(cols - 1, ci1 + 3); i++) {
        if (!mask[j * cols + i]) continue;
        for (let jj = Math.max(cj0, j - 2); jj <= Math.min(cj1 + 1, j + 2); jj++) {
          for (let ii = Math.max(ci0, i - 2); ii <= Math.min(ci1 + 1, i + 2); ii++) grown[(jj - cj0) * sw + ii - ci0] = 1;
        }
      }
    }
    const vertexOf = new Int32Array(sw * sh).fill(-1);
    const positions: number[] = [];
    const depths: number[] = [];
    const indices: number[] = [];
    const vertex = (i: number, j: number): number => {
      const k = (j - cj0) * sw + i - ci0;
      if (vertexOf[k] < 0) {
        vertexOf[k] = positions.length / 3;
        positions.push(-(f.originX + i * f.cellSize), water.level, f.originY + j * f.cellSize);
        depths.push(water.level - f.sample(i, j));
      }
      return vertexOf[k];
    };
    for (let j = cj0; j <= cj1; j++) {
      for (let i = ci0; i <= ci1; i++) {
        const k = (j - cj0) * sw + i - ci0;
        if (!(grown[k] && grown[k + 1] && grown[k + sw] && grown[k + sw + 1])) continue;
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
    return indices.length ? this.geometryOf(positions, depths, indices) : null;
  }

  /**
   * Water that reaches the border runs on beyond it over the apron's rings;
   * it ends where the apron's blurred bed rises above the level (negative
   * depth, discarded in the shader). Null when no water reaches the border
   */
  private buildApronGeometry(water: MapWater, p: ApronProfile): BufferGeometry | null {
    const f = this.field;
    const cols = f.columns;
    const mask = water.mask;
    const positions: number[] = [];
    const depths: number[] = [];
    const indices: number[] = [];
    // A river runs on a little way; a sea (most of the border wet) to the horizon
    const rings = p.wetShare > 0.5 ? APRON_RINGS.length : APRON_RINGS.filter((d) => d <= RIVER_REACH).length;
    const n = p.count;
    const wetBorder = (k: number): boolean => {
      const [x, y] = p.position(0, k);
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
        const [x, y] = p.position(r, k % n);
        positions.push(-x, water.level, y);
        depths.push(water.level - p.height(r, k % n));
        ringVertex.set(key, v);
      }
      return v;
    };
    for (let k = 0; k < n; k++) {
      if (p.wetShare <= 0.5 && (!wetBorder(k) || !wetBorder((k + 1) % n))) continue;
      for (let r = 0; r < rings - 1; r++) {
        const a = apronVertex(r, k);
        const b = apronVertex(r, k + 1);
        const c = apronVertex(r + 1, k);
        const e = apronVertex(r + 1, k + 1);
        // Both windings; the material draws one side
        indices.push(a, c, b, b, c, e, a, b, c, b, e, c);
      }
    }
    return indices.length ? this.geometryOf(positions, depths, indices) : null;
  }

  private geometryOf(positions: number[], depths: number[], indices: number[]): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute('aDepth', new BufferAttribute(new Float32Array(depths), 1));
    g.setIndex(indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
