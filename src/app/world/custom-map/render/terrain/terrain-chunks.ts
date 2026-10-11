import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshDepthMaterial,
  RGBADepthPacking,
  Sphere,
  Vector3,
  type Material,
} from 'three';
import type { HeightField } from '../height-field';

/** Declarations for TERRAIN_MORPH_VERTEX */
export const TERRAIN_MORPH_PARS = /* glsl */ `
attribute vec3 aMorph;
uniform vec3 uMorphEye;
uniform vec3 uMorphFocus;
`;

/**
 * Geomorph towards the next coarser level by the vertex's detail distance
 * (TerrainChunks: the nearer of the camera and, across the ground, the
 * camera's focus; world space), after `begin_vertex`. The shadow pass uses
 * the same points, so shadows lie on the drawn surface. Without a band (the
 * apron has no aMorph) nothing morphs.
 */
export const TERRAIN_MORPH_VERTEX = /* glsl */ `
vec3 morphWorld = (modelMatrix * vec4(position, 1.0)).xyz;
float morphDist = min(distance(morphWorld, uMorphEye), distance(morphWorld.xz, uMorphFocus.xz));
transformed.y += aMorph.z > aMorph.y ? aMorph.x * smoothstep(aMorph.y, aMorph.z, morphDist) : 0.0;
`;

/** Grid sample rectangle, inclusive */
export interface GridRect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

export interface TerrainChunkOptions {
  /** Cells per chunk edge at the finest level */
  chunkCells?: number;
  /** Coarsest level: step 2^maxLod samples */
  maxLod?: number;
  /**
   * Chunk edge lengths of distance per level (level n from n * this). The
   * default keeps the finest level, unmorphed, out to about 290 m around the
   * camera (2 m cells): the game camera's ground, where units stand on
   * `heightAt`, which is the finest level.
   */
  lodDistance?: number;
}

interface Chunk {
  mesh: Mesh;
  i0: number;
  j0: number;
  i1: number;
  j1: number;
  lod: number;
  /** Geometry per level, built on demand, cleared when heights change */
  levels: (BufferGeometry | null)[];
  box: Box3;
}

/**
 * The terrain as a grid of chunk meshes. Each chunk picks a level of detail
 * by its detail distance (every 2^lod-th sample): the nearer of the camera
 * and, across the ground, the camera's focus. A game camera hangs 150 m and
 * more over the action; measured from the camera alone, the ground units
 * stand on (`heightAt`, the finest level) was drawn coarser or morphed and
 * they floated or sank. Skirts hang down from chunk
 * edges and hide the cracks between neighbours of different levels.
 * Normals come from the full grid at every level, so lighting does not jump
 * when a chunk changes level.
 */
export class TerrainChunks {
  readonly group = new Group();
  /** Counts level switches and rebuilds: the sun's shadow map renders again after one */
  version = 0;
  /** Camera and focus in world space for the geomorph, shared by the terrain material and the shadow pass */
  readonly morphEye = { value: new Vector3() };
  readonly morphFocus = { value: new Vector3(1e9, 0, 1e9) };
  private readonly focusLocal = new Vector3(1e9, 0, 1e9);
  /** The chunks' shadow depth with the geomorph, so the terrain shades itself where it is drawn */
  private readonly depthMaterial: MeshDepthMaterial;
  private readonly chunks: Chunk[] = [];
  private readonly chunkCells: number;
  private readonly maxLod: number;
  private readonly lodDistance: number;
  private readonly tmp = new Vector3();

  constructor(
    private readonly field: HeightField,
    private material: Material,
    options: TerrainChunkOptions = {},
  ) {
    this.chunkCells = options.chunkCells ?? 64;
    this.maxLod = options.maxLod ?? 3;
    this.lodDistance = options.lodDistance ?? 3.5;
    this.group.name = 'custom-map-terrain';
    this.depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    this.depthMaterial.onBeforeCompile = (shader) => {
      shader.uniforms['uMorphEye'] = this.morphEye;
      shader.uniforms['uMorphFocus'] = this.morphFocus;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_MORPH_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TERRAIN_MORPH_VERTEX}`);
    };
    this.depthMaterial.customProgramCacheKey = () => 'custom-map-terrain-depth-1';
    this.build();
  }

  get meshes(): readonly Mesh[] {
    return this.chunks.map((c) => c.mesh);
  }

  setMaterial(material: Material): void {
    this.material = material;
    for (const c of this.chunks) c.mesh.material = material;
  }

  /** Picks each chunk's level for a camera at `cameraPos` (in the group's space) */
  /** `cameraPos` and the camera's ground `focus` in the chunks' own (map) space */
  update(cameraPos: Vector3, focus?: Vector3): void {
    this.morphEye.value.copy(cameraPos).applyMatrix4(this.group.matrixWorld);
    if (focus) this.focusLocal.copy(focus);
    this.morphFocus.value.copy(this.focusLocal).applyMatrix4(this.group.matrixWorld);
    const edge = this.chunkCells * this.field.cellSize;
    for (const c of this.chunks) {
      // Across the ground from the focus: its height is the box's own
      this.tmp.set(this.focusLocal.x, Math.min(Math.max(this.focusLocal.y, c.box.min.y), c.box.max.y), this.focusLocal.z);
      const d = Math.min(c.box.distanceToPoint(cameraPos), c.box.distanceToPoint(this.tmp)) / (edge * this.lodDistance);
      // Coarser only when clearly past the threshold, so a chunk on the line does not flip every frame
      let lod = this.levelFor(d);
      if (lod > c.lod && this.levelFor(d * 0.9) <= c.lod) lod = c.lod;
      if (lod !== c.lod) this.setLevel(c, lod);
    }
  }

  /** Level for a distance in units of `lodDistance` chunk edges: 0 below 1, then one more per doubling */
  private levelFor(d: number): number {
    return d < 1 ? 0 : Math.min(this.maxLod, Math.floor(Math.log2(d)) + 1);
  }

  /** Rebuilds the chunks that touch a sample rectangle (all when omitted) */
  rebuild(rect?: GridRect): void {
    for (const c of this.chunks) {
      if (rect && (rect.i1 < c.i0 - 1 || rect.i0 > c.i1 + 1 || rect.j1 < c.j0 - 1 || rect.j0 > c.j1 + 1)) continue;
      const lod = c.lod;
      // The shown level is rewritten in place for the samples the change reaches (a brush on a fine
      // chunk rebuilt 4 000 vertices per step); the others are dropped and built when next shown
      const kept = rect && lod >= 0 ? c.levels[lod] : null;
      for (let l = 0; l < c.levels.length; l++) {
        if (c.levels[l] === kept) continue;
        c.levels[l]?.dispose();
        c.levels[l] = null;
      }
      this.computeBox(c);
      if (kept && rect) {
        this.updateGeometry(c, kept, 1 << lod, rect);
        this.version++;
      } else {
        c.lod = -1;
        this.setLevel(c, lod);
      }
    }
  }

  dispose(): void {
    for (const c of this.chunks) for (const g of c.levels) g?.dispose();
    this.chunks.length = 0;
    this.group.clear();
  }

  private build(): void {
    const f = this.field;
    const n = this.chunkCells;
    for (let j0 = 0; j0 < f.rows - 1; j0 += n) {
      for (let i0 = 0; i0 < f.columns - 1; i0 += n) {
        const c: Chunk = {
          mesh: new Mesh(undefined, this.material),
          i0,
          j0,
          i1: Math.min(i0 + n, f.columns - 1),
          j1: Math.min(j0 + n, f.rows - 1),
          lod: -1,
          levels: new Array<BufferGeometry | null>(this.maxLod + 1).fill(null),
          box: new Box3(),
        };
        c.mesh.name = `terrain-chunk-${i0}-${j0}`;
        c.mesh.receiveShadow = true;
        c.mesh.castShadow = true;
        c.mesh.customDepthMaterial = this.depthMaterial;
        c.mesh.matrixAutoUpdate = false;
        this.computeBox(c);
        this.setLevel(c, 0);
        this.chunks.push(c);
        this.group.add(c.mesh);
      }
    }
  }

  private computeBox(c: Chunk): void {
    const f = this.field;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = c.j0; j <= c.j1; j++) {
      for (let i = c.i0; i <= c.i1; i++) {
        const h = f.sample(i, j);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    const x0 = f.originX + c.i0 * f.cellSize;
    const x1 = f.originX + c.i1 * f.cellSize;
    const y0 = f.originY + c.j0 * f.cellSize;
    const y1 = f.originY + c.j1 * f.cellSize;
    c.box.min.set(-x1, lo, y0);
    c.box.max.set(-x0, hi, y1);
  }

  private setLevel(c: Chunk, lod: number): void {
    c.lod = lod;
    this.version++;
    let g = c.levels[lod];
    if (!g) {
      g = this.buildGeometry(c, 1 << lod);
      c.levels[lod] = g;
    }
    c.mesh.geometry = g;
  }

  /** Sample indices along one axis from a to b in steps, always ending on b */
  private static axis(a: number, b: number, step: number): number[] {
    const out: number[] = [];
    for (let v = a; v < b; v += step) out.push(v);
    out.push(b);
    return out;
  }

  /**
   * Rewrites the vertices of a built level whose samples lie in `rect` or
   * near enough to feel it (normals look one sample out, the morph target
   * two steps), skirts included
   */
  private updateGeometry(c: Chunk, g: BufferGeometry, step: number, rect: GridRect): void {
    const is = TerrainChunks.axis(c.i0, c.i1, step);
    const js = TerrainChunks.axis(c.j0, c.j1, step);
    const nx = is.length;
    const ny = js.length;
    const pos = g.getAttribute('position') as BufferAttribute;
    const nor = g.getAttribute('normal') as BufferAttribute;
    const morph = g.getAttribute('aMorph') as BufferAttribute;
    const put = this.vertexWriter(c, step, pos.array as Float32Array, nor.array as Float32Array, morph.array as Float32Array);
    const reach = step * 2 + 1;
    const near = (i: number, j: number): boolean =>
      i >= rect.i0 - reach && i <= rect.i1 + reach && j >= rect.j0 - reach && j <= rect.j1 + reach;
    for (let b = 0; b < ny; b++) {
      if (js[b] < rect.j0 - reach || js[b] > rect.j1 + reach) continue;
      for (let a = 0; a < nx; a++) if (near(is[a], js[b])) put(b * nx + a, is[a], js[b], 0);
    }
    const skirt = Math.max(2, this.field.cellSize * step * 2);
    TerrainChunks.border(nx, ny).forEach((v, k) => {
      const a = v % nx;
      const b = (v - a) / nx;
      if (near(is[a], js[b])) put(nx * ny + k, is[a], js[b], skirt);
    });
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    morph.needsUpdate = true;
    g.computeBoundingSphere();
    g.computeBoundingBox();
  }

  /** The vertex indices of a level's border loop, counter-clockwise in grid space */
  private static border(nx: number, ny: number): number[] {
    const border: number[] = [];
    for (let a = 0; a < nx; a++) border.push(a);
    for (let b = 1; b < ny; b++) border.push(b * nx + nx - 1);
    for (let a = nx - 2; a >= 0; a--) border.push((ny - 1) * nx + a);
    for (let b = ny - 2; b >= 1; b--) border.push(b * nx);
    return border;
  }

  /** Writes one vertex of a level: position (dropped for skirts), normal from the full grid, morph target and band */
  private vertexWriter(
    c: Chunk,
    step: number,
    pos: Float32Array,
    nor: Float32Array,
    morph: Float32Array,
  ): (v: number, i: number, j: number, drop: number) => void {
    const f = this.field;
    const lod = Math.round(Math.log2(step));
    const switchAt = this.chunkCells * f.cellSize * this.lodDistance * 2 ** lod;
    const bandStart = lod >= this.maxLod ? 1e9 : switchAt * 0.65;
    const bandEnd = lod >= this.maxLod ? 1e9 + 1 : switchAt;
    const n = this.tmp;

    // Height of the next coarser level (step 2s) at a sample, on its two triangles per cell
    const coarse = (i: number, j: number): number => {
      const s2 = step * 2;
      const ci0 = c.i0 + Math.floor((i - c.i0) / s2) * s2;
      const cj0 = c.j0 + Math.floor((j - c.j0) / s2) * s2;
      const ci1 = Math.min(ci0 + s2, c.i1);
      const cj1 = Math.min(cj0 + s2, c.j1);
      const u = ci1 > ci0 ? (i - ci0) / (ci1 - ci0) : 0;
      const w = cj1 > cj0 ? (j - cj0) / (cj1 - cj0) : 0;
      const h00 = f.sample(ci0, cj0);
      const h11 = f.sample(ci1, cj1);
      return u >= w
        ? h00 + u * (f.sample(ci1, cj0) - h00) + w * (h11 - f.sample(ci1, cj0))
        : h00 + w * (f.sample(ci0, cj1) - h00) + u * (h11 - f.sample(ci0, cj1));
    };
    return (v: number, i: number, j: number, drop: number): void => {
      const x = f.originX + i * f.cellSize;
      const y = f.originY + j * f.cellSize;
      const h = f.sample(i, j);
      pos[v * 3] = -x;
      pos[v * 3 + 1] = h - drop;
      pos[v * 3 + 2] = y;
      morph[v * 3] = lod >= this.maxLod ? 0 : coarse(i, j) - h;
      morph[v * 3 + 1] = bandStart;
      morph[v * 3 + 2] = bandEnd;
      // Central differences on the full grid, scene frame (x = -map x)
      const dhdx = (f.sample(i + 1, j) - f.sample(i - 1, j)) / (2 * f.cellSize);
      const dhdy = (f.sample(i, j + 1) - f.sample(i, j - 1)) / (2 * f.cellSize);
      n.set(dhdx, 1, -dhdy).normalize();
      nor[v * 3] = n.x;
      nor[v * 3 + 1] = n.y;
      nor[v * 3 + 2] = n.z;
    };
  }

  private buildGeometry(c: Chunk, step: number): BufferGeometry {
    const f = this.field;
    const is = TerrainChunks.axis(c.i0, c.i1, step);
    const js = TerrainChunks.axis(c.j0, c.j1, step);
    const nx = is.length;
    const ny = js.length;
    const ring = 2 * (nx + ny) - 4;
    const vertexCount = nx * ny + ring;
    const pos = new Float32Array(vertexCount * 3);
    const nor = new Float32Array(vertexCount * 3);
    // Geomorphing (x: height to the next coarser level, y/z: the camera distance band in which the
    // terrain material blends towards it, ending where the chunk switches), so a level change does not pop
    const morph = new Float32Array(vertexCount * 3);
    const skirt = Math.max(2, f.cellSize * step * 2);
    const put = this.vertexWriter(c, step, pos, nor, morph);

    for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) put(b * nx + a, is[a], js[b], 0);

    // Border loop (counter-clockwise in grid space) and its dropped copy
    const border = TerrainChunks.border(nx, ny);
    const skirtBase = nx * ny;
    border.forEach((v, k) => {
      const a = v % nx;
      const b = (v - a) / nx;
      put(skirtBase + k, is[a], js[b], skirt);
    });

    const quads = (nx - 1) * (ny - 1) + ring;
    const index = new Uint32Array(quads * 6 + ring * 6);
    let k = 0;
    for (let b = 0; b < ny - 1; b++) {
      for (let a = 0; a < nx - 1; a++) {
        const v00 = b * nx + a;
        const v10 = v00 + 1;
        const v01 = v00 + nx;
        const v11 = v01 + 1;
        // Diagonal (i, j) -> (i + 1, j + 1), as HeightField.heightAt assumes
        index[k++] = v00;
        index[k++] = v10;
        index[k++] = v11;
        index[k++] = v00;
        index[k++] = v11;
        index[k++] = v01;
      }
    }
    // Skirt quads, both windings so they show from either side
    for (let e = 0; e < ring; e++) {
      const t0 = border[e];
      const t1 = border[(e + 1) % ring];
      const s0 = skirtBase + e;
      const s1 = skirtBase + ((e + 1) % ring);
      index[k++] = t0;
      index[k++] = s0;
      index[k++] = t1;
      index[k++] = t1;
      index[k++] = s0;
      index[k++] = s1;
      index[k++] = t0;
      index[k++] = t1;
      index[k++] = s0;
      index[k++] = t1;
      index[k++] = s1;
      index[k++] = s0;
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(nor, 3));
    g.setAttribute('aMorph', new BufferAttribute(morph, 3));
    g.setIndex(new BufferAttribute(index.subarray(0, k), 1));
    g.boundingBox = c.box.clone();
    g.boundingBox.min.y -= skirt;
    g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
    return g;
  }
}
