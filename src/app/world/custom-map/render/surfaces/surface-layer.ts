import { ClampToEdgeWrapping, DataTexture, FloatType, NearestFilter, NoColorSpace, RGBAFormat, type Texture } from 'three';
import type { MapSurface } from '../../map-document';
import { MAX_SURFACE_MATERIALS } from '../../map-surfaces';
import type { MapAssetLibrary } from '../map-asset-library';
import type { HeightField } from '../height-field';
import type { HeightTexture } from '../terrain/height-texture';
import { uploadRect } from '../terrain/texture-ranges';
import { DrapedMaterial, DrapedTextures, DrapedTiles, type DrapedTile } from '../drape/draped-layer';
import { EDGE_REF, SURFACE_TILE, surfacePieces, surfaceRanks, type SurfaceGround, type SurfaceMesh, type SurfacePiece } from './surface-geometry';
import { SURFACE_EDGE_WIDTH, surfaceLook } from './surface-look';

/**
 * The map's surfaces (MapSurface: squares, playgrounds, pitches, car parks)
 * laid over the ground like the roads (drape/draped-layer.ts): one material
 * for all, a mesh per tile, a texture array of the materials they use, their
 * lines and wear drawn by the shader (surface-look.ts). The ground under a
 * surface is left to it (the path mask's covers, path-mask.ts): no grass
 * grows through, the terrain does none of its texture work there.
 *
 * Kept between changes: a surface whose content is as before keeps its
 * triangles and its edges' place in the edge texture (SurfaceEdgeStore);
 * only the tiles of surfaces that came, changed or went are laid anew, so a
 * corner dragged in the editor lays one or two tiles. The triangles follow
 * the ground as it is when they are cut (surface-geometry.ts cutCells):
 * where the ground moves under a surface (a brush in the editor), the
 * surface is cut again.
 */
export class SurfaceLayer {
  readonly material: SurfaceMaterial;
  private readonly tiles: DrapedTiles;
  private readonly textures: DrapedTextures;
  private readonly edges = new SurfaceEdgeStore();
  /** The materials in layer order: they only grow at the end, so the layers loaded keep their place */
  private materials: string[] = [];
  /** Each surface as built: its content, its triangles and where its edges lie in the edge texture */
  private built = new Map<string, { content: string; mesh: SurfaceMesh; edgeAt: number }>();
  /** The surfaces with pieces in each tile */
  private byTile = new Map<string, Set<string>>();
  private list: readonly MapSurface[] = [];
  private readonly ground: SurfaceGround;

  constructor(field: HeightField, heights: HeightTexture, gridNormals: Texture) {
    this.ground = { heightAt: (x, y) => field.heightAt(x, y), cell: field.cellSize, originX: field.originX, originY: field.originY };
    this.material = new SurfaceMaterial(heights, gridNormals, field, this.edges.uniform);
    this.tiles = new DrapedTiles(field, this.material, 'custom-map-surfaces', SURFACE_TILE);
    this.textures = new DrapedTextures(this.material, MAX_SURFACE_MATERIALS);
    this.tiles.group.visible = false;
  }

  get group() {
    return this.tiles.group;
  }

  /** The surfaces as laid now */
  get surfaces(): readonly MapSurface[] {
    return this.list;
  }

  /** Triangles laid (the plan's budget) */
  get triangles(): number {
    return this.tiles.triangles;
  }

  /** Where the textures come from; loads those the surfaces use */
  setAssets(library: MapAssetLibrary, anisotropy: number): void {
    this.textures.setAssets(library, anisotropy);
  }

  /** The surfaces of the map: lays what came, changed or went since the last call */
  set(surfaces: readonly MapSurface[]): void {
    this.list = surfaces;
    for (const s of surfaces) if (!this.materials.includes(s.material)) this.materials.push(s.material);
    const dirty = new Set<string>();
    const seen = new Set<string>();
    const ranks = surfaceRanks(surfaces);
    for (const s of surfaces) {
      seen.add(s.id);
      const layer = this.materials.indexOf(s.material);
      const rank = ranks.get(s.id) ?? 0;
      const content = JSON.stringify([layer, rank, s.outer, s.holes, s.marking]);
      const was = this.built.get(s.id);
      if (was?.content === content) continue;
      if (was) this.drop(s.id, was, dirty);
      const mesh = surfacePieces(s, layer, rank, this.ground, SURFACE_TILE);
      this.built.set(s.id, { content, mesh, edgeAt: this.edges.add(mesh.edges) });
      for (const key of mesh.pieces.keys()) {
        dirty.add(key);
        let ids = this.byTile.get(key);
        if (!ids) this.byTile.set(key, (ids = new Set()));
        ids.add(s.id);
      }
    }
    for (const [id, was] of this.built) {
      if (seen.has(id)) continue;
      this.drop(id, was, dirty);
      this.built.delete(id);
    }
    for (const key of dirty) this.tiles.set(this.tile(key));
    this.edges.upload();
    this.textures.setIds(this.materials);
  }

  /**
   * Heights changed inside a map rectangle (all when omitted): the surfaces
   * there are cut again on the new ground, the tiles fit their bounds again
   */
  refreshBounds(rect?: { minX: number; minY: number; maxX: number; maxY: number }): void {
    let moved = false;
    for (const s of this.list) {
      if (rect && !overlaps(s, rect)) continue;
      const b = this.built.get(s.id);
      if (b) {
        b.content = '';
        moved = true;
      }
    }
    if (moved) this.set(this.list);
    this.tiles.refreshBounds(rect);
  }

  dispose(): void {
    this.textures.dispose();
    this.tiles.clear();
    this.edges.dispose();
    this.material.dispose();
  }

  private drop(id: string, was: { mesh: SurfaceMesh; edgeAt: number }, dirty: Set<string>): void {
    this.edges.free(was.edgeAt, was.mesh.edges.length / 4);
    for (const key of was.mesh.pieces.keys()) {
      dirty.add(key);
      this.byTile.get(key)?.delete(id);
    }
  }

  /** A tile's pieces put together, in the order of the map's list (the same tile comes out the same) */
  private tile(key: string): DrapedTile {
    const ids = this.byTile.get(key);
    const pieces: { piece: SurfacePiece; edgeAt: number }[] = [];
    if (ids?.size) {
      for (const s of this.list) {
        const b = ids.has(s.id) ? this.built.get(s.id) : undefined;
        const piece = b?.mesh.pieces.get(key);
        if (b && piece) pieces.push({ piece, edgeAt: b.edgeAt });
      }
    }
    let vertices = 0;
    let indices = 0;
    for (const { piece } of pieces) {
      vertices += piece.position.length / 2;
      indices += piece.index.length;
    }
    const position = new Float32Array(vertices * 2);
    const mark = new Float32Array(vertices * 4);
    const look = new Float32Array(vertices * 3);
    const index = new Uint32Array(indices);
    let v = 0;
    let i = 0;
    for (const { piece, edgeAt } of pieces) {
      position.set(piece.position, v * 2);
      mark.set(piece.mark, v * 4);
      look.set(piece.look, v * 3);
      // The cells' edge lists from the surface's own to the texture's
      for (let k = 0; k < piece.position.length / 2; k++) {
        const ref = piece.look[k * 3 + 1];
        if (ref % EDGE_REF) look[(v + k) * 3 + 1] = ref + edgeAt * EDGE_REF;
      }
      for (const k of piece.index) index[i++] = k + v;
      v += piece.position.length / 2;
    }
    const [tx, ty] = key.split(',').map(Number);
    return {
      key,
      x: tx * SURFACE_TILE,
      y: ty * SURFACE_TILE,
      position,
      attributes: { aSurfMark: { array: mark, itemSize: 4 }, aSurfLook: { array: look, itemSize: 3 } },
      index,
    };
  }
}

/** Whether a surface's box overlaps a rectangle */
function overlaps(s: MapSurface, r: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of s.outer) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return x0 <= r.maxX && x1 >= r.minX && y0 <= r.maxY && y1 >= r.minY;
}

/**
 * The edges every surface's cells list (surface-geometry.ts), in one float
 * texture of SURFACE_EDGE_WIDTH texels a row, a texel an edge: each surface
 * a block of its own that stays where it is while the surface does (a block
 * set free goes to the next that fits), the texture grown by rows when full
 * and uploaded by the rows that changed
 */
class SurfaceEdgeStore {
  readonly uniform = { value: null as DataTexture | null };
  private data = new Float32Array(SURFACE_EDGE_WIDTH * 4 * 4);
  private texture: DataTexture | null = null;
  /** Texels in use up to here; free blocks before it */
  private end = 0;
  private freeBlocks: { at: number; size: number }[] = [];
  private dirty: { from: number; to: number } | null = null;

  /** The edges stored, where they start (texels) */
  add(edges: Float32Array): number {
    const size = edges.length / 4;
    if (!size) return 0;
    let at: number;
    const k = this.freeBlocks.findIndex((b) => b.size >= size);
    if (k >= 0) {
      const b = this.freeBlocks[k];
      at = b.at;
      if (b.size === size) this.freeBlocks.splice(k, 1);
      else this.freeBlocks[k] = { at: b.at + size, size: b.size - size };
    } else {
      at = this.end;
      this.end += size;
      if (this.end * 4 > this.data.length) this.grow(this.end);
    }
    this.data.set(edges, at * 4);
    this.mark(at, at + size);
    return at;
  }

  free(at: number, size: number): void {
    if (size) this.freeBlocks.push({ at, size });
  }

  /** The rows written since the last upload go up */
  upload(): void {
    const rows = this.data.length / 4 / SURFACE_EDGE_WIDTH;
    if (!this.texture || this.texture.image.height !== rows) {
      this.texture?.dispose();
      const t = new DataTexture(this.data, SURFACE_EDGE_WIDTH, rows, RGBAFormat, FloatType);
      t.colorSpace = NoColorSpace;
      t.magFilter = t.minFilter = NearestFilter;
      t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.generateMipmaps = false;
      uploadRect(t, undefined);
      this.texture = t;
      this.uniform.value = t;
    } else if (this.dirty) {
      const w = SURFACE_EDGE_WIDTH;
      uploadRect(this.texture, { i0: 0, j0: Math.floor(this.dirty.from / w), i1: w - 1, j1: Math.floor((this.dirty.to - 1) / w) });
    }
    this.dirty = null;
  }

  dispose(): void {
    this.texture?.dispose();
    this.texture = null;
    this.uniform.value = null;
  }

  private mark(from: number, to: number): void {
    this.dirty = this.dirty ? { from: Math.min(this.dirty.from, from), to: Math.max(this.dirty.to, to) } : { from, to };
  }

  private grow(texels: number): void {
    let rows = this.data.length / 4 / SURFACE_EDGE_WIDTH;
    while (rows * SURFACE_EDGE_WIDTH < texels) rows *= 2;
    const data = new Float32Array(rows * SURFACE_EDGE_WIDTH * 4);
    data.set(this.data);
    this.data = data;
  }
}

export class SurfaceMaterial extends DrapedMaterial {
  constructor(heights: HeightTexture, gridNormals: Texture, field: HeightField, edges: { value: DataTexture | null }) {
    super('custom-map-surfaces', surfaceLook(MAX_SURFACE_MATERIALS, edges), MAX_SURFACE_MATERIALS, heights, gridNormals, field);
  }
}
