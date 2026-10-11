import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3, type Material } from 'three';
import type { HeightField } from '../height-field';

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
  /** Chunk edge lengths of distance per level (level n from n * this) */
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
 * by camera distance (every 2^lod-th sample); skirts hang down from chunk
 * edges and hide the cracks between neighbours of different levels.
 * Normals come from the full grid at every level, so lighting does not jump
 * when a chunk changes level.
 */
export class TerrainChunks {
  readonly group = new Group();
  /** Counts level switches and rebuilds: the sun's shadow map renders again after one */
  version = 0;
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
    this.lodDistance = options.lodDistance ?? 1.6;
    this.group.name = 'custom-map-terrain';
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
  update(cameraPos: Vector3): void {
    const edge = this.chunkCells * this.field.cellSize;
    for (const c of this.chunks) {
      const d = c.box.distanceToPoint(cameraPos) / (edge * this.lodDistance);
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
      for (let l = 0; l < c.levels.length; l++) {
        c.levels[l]?.dispose();
        c.levels[l] = null;
      }
      this.computeBox(c);
      const lod = c.lod;
      c.lod = -1;
      this.setLevel(c, lod);
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
    const lod = Math.round(Math.log2(step));
    const switchAt = this.chunkCells * f.cellSize * this.lodDistance * 2 ** lod;
    const bandStart = lod >= this.maxLod ? 1e9 : switchAt * 0.65;
    const bandEnd = lod >= this.maxLod ? 1e9 + 1 : switchAt;
    const skirt = Math.max(2, f.cellSize * step * 2);
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
    const put = (v: number, i: number, j: number, drop: number): void => {
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

    for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) put(b * nx + a, is[a], js[b], 0);

    // Border loop (counter-clockwise in grid space) and its dropped copy
    const border: number[] = [];
    for (let a = 0; a < nx; a++) border.push(a);
    for (let b = 1; b < ny; b++) border.push(b * nx + nx - 1);
    for (let a = nx - 2; a >= 0; a--) border.push((ny - 1) * nx + a);
    for (let b = ny - 2; b >= 1; b--) border.push(b * nx);
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
