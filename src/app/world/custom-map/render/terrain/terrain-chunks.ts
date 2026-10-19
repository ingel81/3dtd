import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshDepthMaterial,
  Ray,
  RGBADepthPacking,
  Sphere,
  Vector3,
  type Intersection,
  type IUniform,
  type Material,
  type Raycaster,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { LosVertexPatch } from '../../../../three-engine/tower-shadow-mapper';
import { cellSplit, type HeightField } from '../height-field';
import type { HeightTexture } from './height-texture';

/**
 * Declarations for the terrain's vertex stage: the height grid on the GPU
 * (HeightTexture's uniforms), the geomorph's attribute and uniforms, and
 * the functions TERRAIN_NORMAL_VERTEX and TERRAIN_HEIGHT_VERTEX read it with.
 * A chunk vertex carries only its place: `position` is its grid sample in
 * the map's scene frame at height 0 (a skirt vertex its drop below the
 * edge), the height comes from the texture. A brush uploads the rows of the
 * texture it changed, and nothing of the meshes but the cells whose
 * diagonal turned.
 */
export const TERRAIN_VERTEX_PARS = /* glsl */ `
uniform highp sampler2D uTerrainHeights;
uniform vec4 uTerrainGrid;
uniform vec2 uTerrainGridSize;
// x: sample step of the next coarser level (0: the coarsest, no geomorph), y/z: the detail distance band of it
attribute vec3 aMorph;
uniform vec3 uMorphEye;
uniform vec3 uMorphFocus;
float terrainSample(ivec2 g) {
  return texelFetch(uTerrainHeights, clamp(g, ivec2(0), ivec2(uTerrainGridSize) - 1), 0).r;
}
// The grid sample a chunk vertex stands on (scene x = -map x, scene z = map y)
ivec2 terrainSampleOf(vec3 p) {
  return ivec2(floor((vec2(-p.x, p.z) - uTerrainGrid.xy) / uTerrainGrid.z + 0.5));
}
// Central differences on the full grid at every level, so lighting does not jump when a chunk changes level
vec3 terrainGridNormal(ivec2 g) {
  float dhdx = (terrainSample(g + ivec2(1, 0)) - terrainSample(g - ivec2(1, 0))) / (2.0 * uTerrainGrid.z);
  float dhdy = (terrainSample(g + ivec2(0, 1)) - terrainSample(g - ivec2(0, 1))) / (2.0 * uTerrainGrid.z);
  return normalize(vec3(dhdx, 1.0, -dhdy));
}
// Height of the level every s-th sample at sample g, on that level's two triangles per cell (cellHeight). Chunks
// start on multiples of s, so its cells are the grid's; the last cell of a side ends on the grid's last sample
float terrainCoarse(ivec2 g, int s) {
  ivec2 c0 = (g / s) * s;
  ivec2 c1 = min(c0 + s, ivec2(uTerrainGridSize) - 1);
  vec2 f = vec2(g - c0) / vec2(max(c1 - c0, ivec2(1)));
  float h00 = terrainSample(c0);
  float h10 = terrainSample(ivec2(c1.x, c0.y));
  float h01 = terrainSample(ivec2(c0.x, c1.y));
  float h11 = terrainSample(c1);
  if (abs(h00 - h11) <= abs(h10 - h01)) {
    return f.x >= f.y ? h00 + f.x * (h10 - h00) + f.y * (h11 - h10) : h00 + f.y * (h01 - h00) + f.x * (h11 - h01);
  }
  return f.x + f.y <= 1.0 ? h00 + f.x * (h10 - h00) + f.y * (h01 - h00) : h11 + (1.0 - f.x) * (h01 - h11) + (1.0 - f.y) * (h10 - h11);
}
`;

/** In place of `beginnormal_vertex`: the vertex's normal from the grid */
export const TERRAIN_NORMAL_VERTEX = /* glsl */ `
vec3 objectNormal = terrainGridNormal(terrainSampleOf(position));
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif
`;

/**
 * After `begin_vertex`: the sample's height, then the geomorph towards the
 * next coarser level by the vertex's detail distance (TerrainChunks: the
 * nearer of the camera and, across the ground, the camera's focus; world
 * space). The shadow pass uses the same points, so shadows lie on the drawn
 * surface.
 */
export const TERRAIN_HEIGHT_VERTEX = /* glsl */ `
ivec2 terrainAt = terrainSampleOf(position);
float terrainH = terrainSample(terrainAt);
transformed.y += terrainH;
if (aMorph.x > 0.0) {
  vec3 morphWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float morphDist = min(distance(morphWorld, uMorphEye), distance(morphWorld.xz, uMorphFocus.xz));
  transformed.y += (terrainCoarse(terrainAt, int(aMorph.x)) - terrainH) * smoothstep(aMorph.y, aMorph.z, morphDist);
}
`;

/**
 * The shadow pass lifts the skirts back onto their chunk's edge (attribute
 * aSkirt: metres a vertex hangs below it, 0 on the surface), so they cast
 * nothing. The sun's shadow map is built over a few frames and shown until
 * the next is whole (shadow-parts.ts): under a brush it lags the ground by
 * those frames, and a skirt hanging from where the edge was stood out of
 * the lowered ground in it, its shadow a dark cross along the chunk edges
 * for the length of the stroke (E204). A crack between levels is far below
 * a shadow texel; the drawn skirts keep hiding it from the camera.
 */
const TERRAIN_SKIRT_LIFT = /* glsl */ `
transformed.y += aSkirt;
`;

/** The terrain's vertex stage in a material of three's (the chunks' depth, the plain ground before the layers load) */
export function patchTerrainVertex(shader: WebGLProgramParametersWithUniforms, uniforms: Record<string, IUniform>, extra = ''): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${TERRAIN_VERTEX_PARS}`)
    .replace('#include <beginnormal_vertex>', TERRAIN_NORMAL_VERTEX)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TERRAIN_HEIGHT_VERTEX}${extra}`);
}

/** Grid sample rectangle, inclusive */
export interface GridRect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

export interface TerrainChunkOptions {
  /** Cells per edge of a piece of the finest level (every piece has as many at its own step); a multiple of 2^maxLod */
  chunkCells?: number;
  /** Coarsest level: step 2^maxLod samples, pieces 2^maxLod finest pieces a side */
  maxLod?: number;
  /**
   * Edge lengths of a finest piece of distance per level (level n from
   * 2^(n-1) times this). The default keeps the finest level, unmorphed (the
   * geomorph's band is the last MORPH_BAND of a level's reach), out to about
   * 270 m around the camera and its focus (2 m cells): the game camera's
   * ground, where units stand on `heightAt`, which is the finest level. A
   * coarse piece takes the level of its nearest finest piece, so the
   * quadtree draws more of the finest level than pieces of one size did:
   * 3.5 there, 2.625 here, about the triangles of then.
   */
  lodDistance?: number;
  /**
   * Cells of geometry built at most per update: a view starts with the
   * coarsest pieces and refines the nearest first, a few pieces a frame,
   * instead of building the finest level of all of them in the frame it
   * opens (45 ms on a 2048 m map in a dev build). Pieces built once are
   * kept and switch freely.
   */
  buildCells?: number;
}

/** Share of a level's reach over which its vertices blend towards the next coarser level */
const MORPH_BAND = 0.2;

/** Cells built per update by default: about eight pieces */
const BUILD_CELLS = 8 * 64 * 64;



/**
 * A piece of the quadtree: level n covers 2^n finest pieces a side at every
 * 2^n-th sample (the same cells as a finest piece), its children the next
 * finer level over its quarters
 */
interface Node {
  level: number;
  i0: number;
  j0: number;
  i1: number;
  j1: number;
  mesh: Mesh;
  /** Built on demand and kept: it holds no heights */
  geometry: BufferGeometry | null;
  /** Sample rectangle whose heights changed since the diagonals were picked; null when they hold */
  stale: GridRect | null;
  box: Box3;
  children: Node[];
  parent: Node | null;
  /** Whether it is drawn now */
  shown: boolean;
}

/** The smallest rectangle holding both (b when a is null) */
function unite(a: GridRect | null, b: GridRect): GridRect {
  return a ? { i0: Math.min(a.i0, b.i0), j0: Math.min(a.j0, b.j0), i1: Math.max(a.i1, b.i1), j1: Math.max(a.j1, b.j1) } : { ...b };
}

const noRaycast = (): void => undefined;

/**
 * The terrain as a quadtree of pieces: each of the same cells at its own
 * step, so a piece four times the area farther off costs one draw call as a
 * finest piece near the camera does (report-gperf 6: pieces of one size drew
 * some 260 pieces of terrain on a 2.4 km map). A piece is split into its
 * children by its detail distance (in levels, as levelFor counts them): the
 * nearer of the camera and, across the ground, the camera's focus. A game
 * camera hangs 150 m and more over the action; measured from the camera
 * alone, the ground units stand on (`heightAt`, the finest level) was drawn
 * coarser or morphed and they floated or sank. Skirts hang down from the
 * pieces' edges and hide the cracks between neighbours of different levels;
 * the geomorph towards the next coarser level (aMorph, uMorphEye) hides the
 * switch.
 *
 * The heights live on the GPU (HeightTexture): the vertex stage reads each
 * vertex's height, its normal from the full grid at every level (lighting
 * does not jump when a piece changes level) and the geomorph's target. On
 * the CPU a piece keeps its box and its index buffer: each cell splits along
 * the diagonal `cellSplit` picks from its corner heights, as
 * HeightField.heightAt assumes, so a height change picks the diagonals of
 * the cells it reached anew (in the pieces shown at once, the others when
 * they show). Rays meet the surface `heightAt` reports (HeightField.raycast),
 * the line-of-sight cube draws the heights through `userData.losVertex`.
 */
export class TerrainChunks {
  readonly group = new Group();
  /** Counts piece switches and rebuilds: the sun's shadow map renders again after one */
  version = 0;
  /** Camera and focus in world space for the geomorph, shared by the terrain material and the shadow pass */
  readonly morphEye = { value: new Vector3() };
  readonly morphFocus = { value: new Vector3(1e9, 0, 1e9) };
  /** What a material drawing the pieces binds: the height grid and the geomorph's camera */
  readonly uniforms: Record<string, IUniform>;
  /**
   * What the line-of-sight cube adds to a piece's vertex (tower-shadow-mapper.ts, each mesh's `userData.losVertex`):
   * its height at its level's sample, without the geomorph
   */
  private readonly losVertex: LosVertexPatch;
  private readonly focusLocal = new Vector3(1e9, 0, 1e9);
  /** The pieces' shadow depth with the heights and the geomorph, so the terrain shades itself where it is drawn */
  private readonly depthMaterial: MeshDepthMaterial;
  /** The coarsest pieces, row by row */
  private readonly roots: Node[] = [];
  /** The finest pieces, row by row (rays find theirs) */
  private readonly leaves: Node[] = [];
  /** Finest pieces per row */
  private readonly across: number;
  /** The pieces drawn now, in the tree's order */
  private shownList: Node[] = [];
  /** The far ground's material (TerrainMaterial.far) for the pieces of `farLevel` and coarser; null: all draw `material` */
  private farMaterial: Material | null = null;
  /** The finest level drawn with the far ground's material (setFarFrom) */
  private farLevel = 1;
  private readonly chunkCells: number;
  private readonly maxLod: number;
  private readonly lodDistance: number;
  private readonly buildCells: number;
  /** update's scratch, kept: the pieces it draws and those that wait to be built, with their distance */
  private next: Node[] = [];
  private readonly waiting: { n: Node; d: number }[] = [];
  private readonly tmp = new Vector3();
  private readonly cameraLocal = new Vector3();
  private readonly ray = new Ray();
  private readonly inverse = new Matrix4();
  private readonly hit = new Vector3();

  constructor(
    private readonly field: HeightField,
    heights: HeightTexture,
    private material: Material,
    options: TerrainChunkOptions = {},
  ) {
    this.chunkCells = options.chunkCells ?? 64;
    this.maxLod = options.maxLod ?? 3;
    this.lodDistance = options.lodDistance ?? 2.625;
    this.buildCells = options.buildCells ?? BUILD_CELLS;
    if (this.chunkCells % (1 << this.maxLod)) throw new Error('Pieces must start on samples of every level');
    this.across = Math.ceil((field.columns - 1) / this.chunkCells);
    this.uniforms = { ...heights.uniforms, uMorphEye: this.morphEye, uMorphFocus: this.morphFocus };
    this.losVertex = {
      key: 'custom-map-terrain',
      pars: TERRAIN_VERTEX_PARS,
      vertex: 'localPos.y += terrainSample(terrainSampleOf(localPos.xyz));',
      uniforms: this.uniforms,
    };
    this.group.name = 'custom-map-terrain';
    this.group.raycast = (raycaster, intersects) => this.raycast(raycaster, intersects);
    this.depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    this.depthMaterial.onBeforeCompile = (shader) => {
      patchTerrainVertex(shader, this.uniforms, TERRAIN_SKIRT_LIFT);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSkirt;');
    };
    this.depthMaterial.customProgramCacheKey = () => 'custom-map-terrain-depth-3';
    this.build();
  }

  /** The pieces drawn now; together they cover the map once */
  get meshes(): readonly Mesh[] {
    return this.shownList.map((n) => n.mesh);
  }

  /** The ground's material, and the far ground's for the coarser pieces (setFarFrom) when there is one */
  setMaterial(material: Material, far: Material | null = null): void {
    this.material = material;
    this.farMaterial = far;
    const visit = (n: Node): void => {
      n.mesh.material = this.materialOf(n);
      for (const c of n.children) visit(c);
    };
    for (const r of this.roots) visit(r);
  }

  /**
   * Metres of detail distance from which the ground may draw with the far ground's material: from the first level
   * whose pieces start there (a piece of level n from 2^(n-1) x lodDistance finest edges), so the near material,
   * which draws its layers' mean colours from about there (uFarFlat), meets the far one where both draw alike
   */
  setFarFrom(metres: number): void {
    const unit = this.chunkCells * this.field.cellSize * this.lodDistance;
    let level = 1;
    while (level < this.maxLod && unit * 2 ** (level - 1) < metres) level++;
    if (level === this.farLevel) return;
    this.farLevel = level;
    this.setMaterial(this.material, this.farMaterial);
  }

  private materialOf(n: Node): Material {
    return this.farMaterial && n.level >= this.farLevel ? this.farMaterial : this.material;
  }

  /** `cameraPos` and the camera's ground `focus` in the pieces' own (map) space: picks the pieces drawn */
  update(cameraPos: Vector3, focus?: Vector3): void {
    this.morphEye.value.copy(cameraPos).applyMatrix4(this.group.matrixWorld);
    if (focus) this.focusLocal.copy(focus);
    this.morphFocus.value.copy(this.focusLocal).applyMatrix4(this.group.matrixWorld);
    this.cameraLocal.copy(cameraPos);
    this.next.length = 0;
    this.waiting.length = 0;
    for (const r of this.roots) this.place(r);
    this.show();
    this.unsettled = this.waiting.length;
    this.buildWaiting();
  }

  /** Whether every piece shows the level it wants (none waits to be built) */
  get settled(): boolean {
    return this.unsettled === 0;
  }

  /** Pieces still waiting to be built after the last update; -1 before the first */
  private unsettled = -1;

  /** A piece's detail distance in levels' units (edges of a finest piece times lodDistance) */
  private distanceOf(n: Node): number {
    // Across the ground from the focus: its height is the box's own
    this.tmp.set(this.focusLocal.x, Math.min(Math.max(this.focusLocal.y, n.box.min.y), n.box.max.y), this.focusLocal.z);
    const d = Math.min(n.box.distanceToPoint(this.cameraLocal), n.box.distanceToPoint(this.tmp));
    return d / (this.chunkCells * this.field.cellSize * this.lodDistance);
  }

  /**
   * Puts the pieces that draw `n`'s area into `next`: its children where it
   * is wanted finer and they can draw, else itself where it is built; what
   * is missing waits to be built. False when nothing over its area is built
   * (its parent draws it meanwhile)
   */
  private place(n: Node): boolean {
    const d = this.distanceOf(n);
    // Finer at once; coarser only when clearly past the threshold, so a piece on the line does not flip every frame
    const finer = n.level > 0 && (this.levelFor(d) < n.level || (!n.shown && this.levelFor(d * 0.9) < n.level));
    if (!finer && n.geometry) {
      this.next.push(n);
      return true;
    }
    if (!finer) this.waiting.push({ n, d });
    if (n.level > 0) {
      // Wanted finer, or itself not built yet: its children while they can draw all of it
      const mark = this.next.length;
      let all = true;
      for (const c of n.children) all = this.place(c) && all;
      if (all) return true;
      this.next.length = mark;
    }
    if (n.geometry) {
      this.next.push(n);
      return true;
    }
    return false;
  }

  /** Draws the pieces `place` put into `next` and no others */
  private show(): void {
    const next = this.next;
    let changed = next.length !== this.shownList.length;
    for (const n of this.shownList) n.shown = false;
    for (let k = 0; k < next.length; k++) {
      next[k].shown = true;
      if (this.shownList[k] !== next[k]) changed = true;
    }
    if (!changed) return;
    for (const n of this.shownList) if (!n.shown) this.group.remove(n.mesh);
    for (const n of next) {
      if (n.mesh.parent === this.group) continue;
      this.fitBounds(n);
      this.pickDiagonals(n);
      this.group.add(n.mesh);
    }
    this.next = this.shownList;
    this.shownList = next;
    this.version++;
  }

  /** Builds the waiting pieces nearest first, within the cells an update may build; the rest wait for the next */
  private buildWaiting(): void {
    const waiting = this.waiting;
    if (!waiting.length) return;
    waiting.sort((a, b) => a.d - b.d);
    let budget = this.buildCells;
    for (const w of waiting) {
      const step = 1 << w.n.level;
      const cells = Math.ceil((w.n.i1 - w.n.i0) / step) * Math.ceil((w.n.j1 - w.n.j0) / step);
      // The first always goes in, so a budget below a piece still moves on
      if (budget < cells && budget < this.buildCells) break;
      budget -= cells;
      this.ensureGeometry(w.n);
    }
    waiting.length = 0;
  }

  private ensureGeometry(n: Node): void {
    if (n.geometry) return;
    n.geometry = this.buildGeometry(n);
    n.mesh.geometry = n.geometry;
  }

  /** Level for a distance in units of `lodDistance` piece edges: 0 below 1, then one more per doubling */
  private levelFor(d: number): number {
    return d < 1 ? 0 : Math.min(this.maxLod, Math.floor(Math.log2(d)) + 1);
  }

  /**
   * Heights changed inside a sample rectangle (all when omitted; the height texture uploads them): the pieces
   * there take their new boxes, the shown ones pick the diagonals of the cells reached, the others when shown
   */
  rebuild(rect?: GridRect): void {
    const f = this.field;
    const r = rect ?? { i0: 0, j0: 0, i1: f.columns - 1, j1: f.rows - 1 };
    const visit = (n: Node): void => {
      if (r.i1 < n.i0 || r.i0 > n.i1 || r.j1 < n.j0 || r.j0 > n.j1) return;
      for (const c of n.children) visit(c);
      if (n.children.length) {
        n.box.makeEmpty();
        for (const c of n.children) n.box.union(c.box);
      } else {
        this.computeBox(n);
      }
      if (n.geometry) {
        n.stale = unite(n.stale, r);
        this.fitBounds(n);
        if (n.shown) this.pickDiagonals(n);
      }
    };
    for (const root of this.roots) visit(root);
    this.version++;
  }

  dispose(): void {
    const visit = (n: Node): void => {
      n.geometry?.dispose();
      for (const c of n.children) visit(c);
    };
    for (const r of this.roots) visit(r);
    this.roots.length = 0;
    this.leaves.length = 0;
    this.shownList = [];
    this.group.clear();
    this.depthMaterial.dispose();
  }

  /**
   * The first point where a ray meets the surface, as heightAt reports it (the finest level), on the piece drawn
   * there: the pieces' geometry holds no heights to test. The meshes answer nothing themselves
   */
  private raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    const f = this.field;
    this.inverse.copy(this.group.matrixWorld).invert();
    this.ray.copy(raycaster.ray).applyMatrix4(this.inverse);
    const local = this.hit;
    if (f.raycast(this.ray, local, Math.min(raycaster.far, 20000)) === null) return;
    const point = local.clone().applyMatrix4(this.group.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(point);
    if (distance < raycaster.near || distance > raycaster.far) return;
    const edge = f.cellSize * this.chunkCells;
    const ci = Math.min(this.across - 1, Math.max(0, Math.floor((-local.x - f.originX) / edge)));
    const cj = Math.max(0, Math.floor((local.z - f.originY) / edge));
    let n = this.leaves[Math.min(this.leaves.length - 1, cj * this.across + ci)];
    while (!n.shown && n.parent) n = n.parent;
    intersects.push({ distance, point, object: n.mesh });
  }

  private build(): void {
    const f = this.field;
    const span = this.chunkCells << this.maxLod;
    for (let j0 = 0; j0 < f.rows - 1; j0 += span) {
      for (let i0 = 0; i0 < f.columns - 1; i0 += span) this.roots.push(this.node(this.maxLod, i0, j0, null));
    }
    // The coarsest pieces at first, cheap for all; update refines the near ones (buildCells a frame)
    for (const r of this.roots) {
      this.ensureGeometry(r);
      this.next.push(r);
    }
    this.show();
  }

  /** The piece of `level` from sample (i0, j0), with the pieces below it */
  private node(level: number, i0: number, j0: number, parent: Node | null): Node {
    const f = this.field;
    const span = this.chunkCells << level;
    const n: Node = {
      level,
      i0,
      j0,
      i1: Math.min(i0 + span, f.columns - 1),
      j1: Math.min(j0 + span, f.rows - 1),
      mesh: new Mesh(undefined, this.material),
      geometry: null,
      stale: null,
      box: new Box3(),
      children: [],
      parent,
      shown: false,
    };
    n.mesh.name = level ? `terrain-chunk-${i0}-${j0}-${level}` : `terrain-chunk-${i0}-${j0}`;
    n.mesh.receiveShadow = true;
    n.mesh.castShadow = true;
    n.mesh.customDepthMaterial = this.depthMaterial;
    n.mesh.matrixAutoUpdate = false;
    n.mesh.raycast = noRaycast;
    n.mesh.userData['losVertex'] = this.losVertex;
    if (level > 0) {
      const half = span >> 1;
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        if (i0 + di * half < n.i1 && j0 + dj * half < n.j1) n.children.push(this.node(level - 1, i0 + di * half, j0 + dj * half, n));
      }
      for (const c of n.children) n.box.union(c.box);
    } else {
      this.computeBox(n);
      this.leaves[(j0 / this.chunkCells) * this.across + i0 / this.chunkCells] = n;
    }
    return n;
  }

  private computeBox(n: Node): void {
    const f = this.field;
    const h = f.grid.heights;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = n.j0; j <= n.j1; j++) {
      const row = j * f.columns;
      for (let i = n.i0; i <= n.i1; i++) {
        const v = h[row + i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const x0 = f.originX + n.i0 * f.cellSize;
    const x1 = f.originX + n.i1 * f.cellSize;
    const y0 = f.originY + n.j0 * f.cellSize;
    const y1 = f.originY + n.j1 * f.cellSize;
    n.box.min.set(-x1, lo, y0);
    n.box.max.set(-x0, hi, y1);
  }

  /** A piece's bounds for culling: its box down to its skirts */
  private fitBounds(n: Node): void {
    const g = n.geometry;
    if (!g) return;
    g.boundingBox ??= new Box3();
    g.boundingBox.copy(n.box);
    g.boundingBox.min.y -= TerrainChunks.skirtDrop(this.field.cellSize, 1 << n.level);
    g.boundingSphere ??= new Sphere();
    g.boundingBox.getBoundingSphere(g.boundingSphere);
  }

  /** Metres the skirts of a level hang below its edge: whole metres, as the shadow pass reads them from a byte */
  private static skirtDrop(cellSize: number, step: number): number {
    return Math.min(255, Math.ceil(Math.max(2, cellSize * step * 2)));
  }

  /** Sample indices along one axis from a to b in steps, always ending on b */
  private static axis(a: number, b: number, step: number): number[] {
    const out: number[] = [];
    for (let v = a; v < b; v += step) out.push(v);
    out.push(b);
    return out;
  }

  /**
   * The cells of a level whose corners lie in its stale rectangle pick their diagonal anew from the heights now;
   * only the index rows they lie in go to the GPU
   */
  private pickDiagonals(c: Node): void {
    const rect = c.stale;
    if (!rect || !c.geometry) return;
    c.stale = null;
    const step = 1 << c.level;
    const is = TerrainChunks.axis(c.i0, c.i1, step);
    const js = TerrainChunks.axis(c.j0, c.j1, step);
    const nx = is.length;
    const index = c.geometry.getIndex() as BufferAttribute;
    const idx = index.array as Uint16Array | Uint32Array;
    // The cells from the first whose right corner reaches the rectangle to the last whose left corner lies in it
    let a0 = 0;
    while (a0 < nx - 2 && is[a0 + 1] < rect.i0) a0++;
    let a1 = nx - 2;
    while (a1 > 0 && is[a1] > rect.i1) a1--;
    let b0 = -1;
    let b1 = -1;
    for (let b = 0; b < js.length - 1; b++) {
      if (js[b + 1] < rect.j0 || js[b] > rect.j1) continue;
      if (b0 < 0) b0 = b;
      b1 = b;
      for (let a = a0; a <= a1; a++) this.cell(idx, (b * (nx - 1) + a) * 6, is[a], js[b], is[a + 1], js[b + 1], b * nx + a, nx);
    }
    if (b0 < 0 || a1 < a0) return;
    const start = b0 * (nx - 1) * 6;
    // Added to what waits for the next upload: two brush steps in one frame send both
    index.addUpdateRange(start, (b1 + 1) * (nx - 1) * 6 - start);
    index.needsUpdate = true;
  }

  /**
   * The two triangles of the cell from samples (i0, j0) to (i1, j1) at `index[k]`, vertex v00 at its first
   * corner in a level of `nx` vertices a row, split along the diagonal cellSplit picks from the corner heights,
   * as HeightField.heightAt assumes; a coarser level picks from its own corners
   */
  private cell(index: Uint16Array | Uint32Array, k: number, i0: number, j0: number, i1: number, j1: number, v00: number, nx: number): void {
    const f = this.field;
    const v10 = v00 + 1;
    const v01 = v00 + nx;
    const v11 = v01 + 1;
    if (cellSplit(f.sample(i0, j0), f.sample(i1, j0), f.sample(i0, j1), f.sample(i1, j1))) {
      index[k] = v00;
      index[k + 1] = v10;
      index[k + 2] = v11;
      index[k + 3] = v00;
      index[k + 4] = v11;
      index[k + 5] = v01;
    } else {
      index[k] = v00;
      index[k + 1] = v10;
      index[k + 2] = v01;
      index[k + 3] = v10;
      index[k + 4] = v11;
      index[k + 5] = v01;
    }
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

  /**
   * A level's geometry: each vertex at its sample at height 0 (a skirt vertex its drop below), the geomorph's
   * step and band, the skirts' drop for the shadow pass, and the index with every cell's diagonal picked
   */
  private buildGeometry(c: Node): BufferGeometry {
    const f = this.field;
    const lod = c.level;
    const step = 1 << lod;
    const is = TerrainChunks.axis(c.i0, c.i1, step);
    const js = TerrainChunks.axis(c.j0, c.j1, step);
    const nx = is.length;
    const ny = js.length;
    const ring = 2 * (nx + ny) - 4;
    const vertexCount = nx * ny + ring;
    const pos = new Float32Array(vertexCount * 3);
    // Geomorphing (x: sample step of the next coarser level, y/z: the camera distance band in which the
    // terrain blends towards it, ending where the chunk switches), so a level change does not pop
    const morph = new Float32Array(vertexCount * 3);
    const switchAt = this.chunkCells * f.cellSize * this.lodDistance * 2 ** lod;
    const coarsest = lod >= this.maxLod;
    const skirt = TerrainChunks.skirtDrop(f.cellSize, step);
    const put = (v: number, i: number, j: number, drop: number): void => {
      pos[v * 3] = -(f.originX + i * f.cellSize);
      pos[v * 3 + 1] = -drop;
      pos[v * 3 + 2] = f.originY + j * f.cellSize;
      morph[v * 3] = coarsest ? 0 : step * 2;
      morph[v * 3 + 1] = coarsest ? 1e9 : switchAt * (1 - MORPH_BAND);
      morph[v * 3 + 2] = coarsest ? 1e9 + 1 : switchAt;
    };
    for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) put(b * nx + a, is[a], js[b], 0);

    // Border loop (counter-clockwise in grid space) and its dropped copy
    const border = TerrainChunks.border(nx, ny);
    const skirtBase = nx * ny;
    border.forEach((v, k) => {
      const a = v % nx;
      const b = (v - a) / nx;
      put(skirtBase + k, is[a], js[b], skirt);
    });

    const cells = (nx - 1) * (ny - 1);
    const count = cells * 6 + ring * 12;
    const index = vertexCount <= 65536 ? new Uint16Array(count) : new Uint32Array(count);
    let k = 0;
    for (let b = 0; b < ny - 1; b++) {
      for (let a = 0; a < nx - 1; a++) {
        this.cell(index, k, is[a], js[b], is[a + 1], js[b + 1], b * nx + a, nx);
        k += 6;
      }
    }
    // Skirt quads, both windings so they show from either side
    for (let e = 0; e < ring; e++) {
      const t0 = border[e];
      const t1 = border[(e + 1) % ring];
      const s0 = skirtBase + e;
      const s1 = skirtBase + ((e + 1) % ring);
      index.set([t0, s0, t1, t1, s0, s1, t0, t1, s0, t1, s1, s0], k);
      k += 12;
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aMorph', new BufferAttribute(morph, 3));
    // Never read (the normal comes from the grid), but three draws a standard material on a geometry without
    // normals flat shaded, another program: three bytes a vertex, up once
    const up = new Int8Array(vertexCount * 3);
    for (let v = 1; v < up.length; v += 3) up[v] = 127;
    g.setAttribute('normal', new BufferAttribute(up, 3, true));
    // How far each vertex hangs below the edge, for the shadow pass (TERRAIN_SKIRT_LIFT): a byte, the ring only
    const lift = new Uint8Array(vertexCount);
    lift.fill(skirt, skirtBase);
    g.setAttribute('aSkirt', new BufferAttribute(lift, 1));
    g.setIndex(new BufferAttribute(index, 1));
    g.boundingBox = new Box3().copy(c.box);
    g.boundingBox.min.y -= skirt;
    g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
    return g;
  }
}
