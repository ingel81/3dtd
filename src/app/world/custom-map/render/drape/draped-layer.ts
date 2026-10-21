import { Box3, BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial, SRGBColorSpace, Sphere, Vector3, Vector4, type Texture } from 'three';
import type { MapAssetLibrary } from '../map-asset-library';
import { loadMaterialArrays, type MaterialArrays } from '../terrain/terrain-textures';
import { addHeightFog } from '../environment/height-fog';
import type { HeightField } from '../height-field';
import { SHADER_NOISE } from '../shader-noise';
import { TERRAIN_HEIGHT_GLSL, type HeightTexture } from '../terrain/height-texture';
import { mergeDraped, refineDraped, takeSplitting, triangleBuckets, type DrapedGeometry, type TriangleBuckets } from './draped-refine';

/**
 * What lies over the ground as a surface of its own: the paved roads
 * (paths/road-surface.ts) and the surfaces of squares, pitches and car
 * parks (surfaces/surface-layer.ts). Both are drawn the same way, here:
 *
 *   - one material for all, a mesh per tile (DRAPE_TILE metres for the
 *     roads, wider for the surfaces: a few draw calls, none per road or
 *     surface), each tile fitted to the heights for culling and fitted again
 *     when the ground moves;
 *   - the vertices take their height from the terrain's height texture, so
 *     a brush moves the surface with the ground without a rebuild, and their
 *     normal from the terrain's grid; where a crater sank the ground between
 *     them, the triangles over it leave their tile for a patch of the tile
 *     where they are split closer (refreshBounds with `sunk`,
 *     draped-refine.ts), so the surface follows it into the pit: a draw call
 *     more per tile a crater hit, the tile's own buffers kept;
 *   - they are drawn a little towards the camera (more with distance)
 *     instead of lifted: the surface never fights the ground it lies on and
 *     does not float over it seen from the side. Of two that overlap, the
 *     one of higher rank is drawn further towards the camera; every road
 *     comes before every surface (DrapePull);
 *   - their textures are ground materials of the catalogue, one texture
 *     array of the few they use, sampled twice up close with a slow noise
 *     between so the tile never repeats (drapeLookup); until the textures
 *     are in, each material draws its mean colour.
 *
 * A kind of surface gives its own attributes and the GLSL that draws its
 * look (DrapeLook); the fragment sets `drapeRough`, `drapeAO` and
 * `drapeNormal` (world space) and multiplies `diffuseColor`.
 */

/** Metres a side of a tile */
export const DRAPE_TILE = 512;

/**
 * How far a surface is drawn towards the camera: `base` metres, and per
 * metre of distance past PULL_FROM `perMetre` (up close the terrain is drawn
 * at full detail and the surface lies on it within a centimetre or two;
 * farther out the terrain is coarser and rises over it by up to metres), and
 * per rank `rank` metres plus `rankPerMetre` per metre of distance
 */
export interface DrapePull {
  base: number;
  perMetre: number;
  rank: number;
  rankPerMetre: number;
}

/** Metres from the camera where the pull starts to grow with distance */
const PULL_FROM = 200;

/** One tile's geometry: map positions (x, y per vertex), the look's attributes by name, triangles */
export interface DrapedTile {
  key: string;
  /** Lower corner of the tile, map metres */
  x: number;
  y: number;
  position: Float32Array;
  attributes: Readonly<Record<string, { array: Float32Array; itemSize: number }>>;
  index: Uint32Array;
}

/** The key of the tile holding a map point */
export function drapeTileKey(x: number, y: number): string {
  return `${Math.floor(x / DRAPE_TILE)},${Math.floor(y / DRAPE_TILE)}`;
}

/** The meshes of a draped surface, one per tile, fitted to the heights for culling */
export class DrapedTiles {
  readonly group = new Group();
  private readonly tiles = new Map<
    string,
    { mesh: Mesh; tile: DrapedTile; patch: { mesh: Mesh; geometry: DrapedGeometry } | null; buckets: TriangleBuckets | null }
  >();
  /** Craters may sink the ground (prepareForCraters): each tile keeps its triangles by where they lie */
  private craters = false;

  /** @param tile Metres a side of a tile (DRAPE_TILE, the roads'; the surfaces take wider ones) */
  constructor(
    private readonly field: HeightField,
    private readonly material: DrapedMaterial,
    private readonly name: string,
    private readonly tile = DRAPE_TILE,
  ) {
    this.group.name = name;
    this.group.userData['losTransparent'] = true;
  }

  get size(): number {
    return this.tiles.size;
  }

  /** Triangles of all tiles, with their patches over craters */
  get triangles(): number {
    let n = 0;
    for (const { tile, patch } of this.tiles.values()) n += (tile.index.length + (patch?.geometry.index.length ?? 0)) / 3;
    return n;
  }

  /** Tiles with a patch over craters: each a draw call more */
  get patches(): number {
    let n = 0;
    for (const { patch } of this.tiles.values()) if (patch) n++;
    return n;
  }

  /** The tile laid anew; an empty one goes */
  set(tile: DrapedTile): void {
    this.remove(tile.key);
    if (!tile.index.length) return;
    const mesh = this.meshOf(tile, `${this.name}-${tile.key}`);
    this.tiles.set(tile.key, { mesh, tile, patch: null, buckets: this.craters ? triangleBuckets(tile) : null });
    this.group.add(mesh);
    this.group.visible = true;
  }

  remove(key: string): void {
    const t = this.tiles.get(key);
    if (!t) return;
    t.mesh.geometry.dispose();
    t.mesh.removeFromParent();
    t.patch?.mesh.geometry.dispose();
    t.patch?.mesh.removeFromParent();
    this.tiles.delete(key);
    this.group.visible = this.tiles.size > 0;
  }

  /**
   * Craters may sink the ground under the tiles (a map that digs them): each
   * tile keeps its triangles by where they lie, made now and as tiles come,
   * so a crater looks only at the triangles near it (a town's tile holds
   * 20 000; looking at all of them took 5 ms a crater)
   */
  prepareForCraters(): void {
    if (this.craters) return;
    this.craters = true;
    for (const entry of this.tiles.values()) entry.buckets ??= triangleBuckets(entry.tile);
  }

  /** A mesh of a geometry in map positions; scene space (x = -map x, z = map y), the height from the terrain in the shader */
  private meshOf(geometry: DrapedGeometry, name: string): Mesh {
    const g = new BufferGeometry();
    const pos = new Float32Array((geometry.position.length / 2) * 3);
    for (let k = 0; k < geometry.position.length / 2; k++) {
      pos[k * 3] = -geometry.position[k * 2];
      pos[k * 3 + 2] = geometry.position[k * 2 + 1];
    }
    g.setAttribute('position', new BufferAttribute(pos, 3));
    for (const [n, a] of Object.entries(geometry.attributes)) g.setAttribute(n, new BufferAttribute(a.array, a.itemSize));
    g.setIndex(new BufferAttribute(geometry.index, 1));
    const mesh = new Mesh(g, this.material);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.fitBounds(mesh, geometry);
    return mesh;
  }

  /**
   * Heights changed inside a map rectangle (all when omitted): the tiles there fit their bounds again. `sunk`:
   * craters sank the ground there; the tiles' triangles over it are split closer (draped-refine.ts), so the
   * surface follows the ground into the pit instead of spanning it
   */
  refreshBounds(rect?: { minX: number; minY: number; maxX: number; maxY: number }, sunk = false): void {
    const heightAt = (x: number, y: number) => this.field.heightAt(x, y);
    for (const entry of this.tiles.values()) {
      const { mesh, tile } = entry;
      if (rect && (tile.x > rect.maxX || tile.y > rect.maxY || tile.x + this.tile < rect.minX || tile.y + this.tile < rect.minY)) continue;
      if (sunk && rect) {
        // The triangles over the pit out of the tile (drawn as nothing there now) into its patch, split closer
        const taken = takeSplitting(tile, rect, heightAt, this.field.cellSize, entry.buckets);
        if (taken) mesh.geometry.index!.needsUpdate = true;
        const had = entry.patch?.geometry ?? null;
        const joined = had && taken ? mergeDraped(had, taken) : (had ?? taken);
        const refined = joined && refineDraped(joined, rect, heightAt, this.field.cellSize);
        if (refined || taken) {
          entry.patch?.mesh.geometry.dispose();
          entry.patch?.mesh.removeFromParent();
          const geometry = refined ?? joined!;
          const patch = this.meshOf(geometry, `${this.name}-${tile.key}-patch`);
          entry.patch = { mesh: patch, geometry };
          this.group.add(patch);
        } else if (entry.patch) this.growBounds(entry.patch.mesh, rect);
        // Its box only grows by the ground in the rectangle: a walk over every vertex of a town's tile took
        // half a millisecond and more per crater
        this.growBounds(mesh, rect);
        continue;
      }
      this.fitBounds(mesh, tile);
    }
  }

  /** A mesh's box grown to the ground's heights in a rectangle (its samples there) */
  private growBounds(mesh: Mesh, rect: { minX: number; minY: number; maxX: number; maxY: number }): void {
    const box = mesh.geometry.boundingBox;
    if (!box) return;
    const f = this.field;
    // Scene x is map -x: the box's x runs from -maxX to -minX
    const minX = Math.max(rect.minX, -box.max.x);
    const maxX = Math.min(rect.maxX, -box.min.x);
    const minY = Math.max(rect.minY, box.min.z);
    const maxY = Math.min(rect.maxY, box.max.z);
    if (minX > maxX || minY > maxY) return;
    const i0 = Math.floor((minX - f.originX) / f.cellSize);
    const i1 = Math.ceil((maxX - f.originX) / f.cellSize);
    const j0 = Math.floor((minY - f.originY) / f.cellSize);
    const j1 = Math.ceil((maxY - f.originY) / f.cellSize);
    let lo = box.min.y;
    let hi = box.max.y;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const h = f.sample(i, j);
        if (h - 1 < lo) lo = h - 1;
        if (h + 1 > hi) hi = h + 1;
      }
    }
    if (lo === box.min.y && hi === box.max.y) return;
    box.min.y = lo;
    box.max.y = hi;
    mesh.geometry.boundingSphere = box.getBoundingSphere(new Sphere());
  }

  clear(): void {
    for (const { mesh, patch } of this.tiles.values()) {
      mesh.geometry.dispose();
      patch?.mesh.geometry.dispose();
    }
    this.tiles.clear();
    this.group.clear();
  }

  private fitBounds(mesh: Mesh, tile: DrapedGeometry): void {
    const box = new Box3();
    const p = tile.position;
    const q = new Vector3();
    for (let k = 0; k < p.length; k += 2) box.expandByPoint(q.set(-p[k], this.field.heightAt(p[k], p[k + 1]), p[k + 1]));
    box.expandByScalar(1);
    mesh.geometry.boundingBox = box;
    mesh.geometry.boundingSphere = box.getBoundingSphere(new Sphere());
  }
}

/** Per material of the catalogue what a look may read of it besides its textures */
export interface DrapeMaterialInfo {
  id: string;
  scale?: number;
  category?: string;
  paved?: boolean;
}

/**
 * The textures of the materials a draped surface uses, as one array each
 * (colour, data), loaded when the materials or the library change; the
 * layers loaded keep their place, a new material joins at the end and draws
 * its mean colour until the textures with it are in
 */
export class DrapedTextures {
  private assets: { library: MapAssetLibrary; anisotropy: number } | null = null;
  private ids: string[] = [];
  private loaded: MaterialArrays | null = null;
  private generation = 0;
  /** What the last load asked for */
  private requested: { library: MapAssetLibrary; anisotropy: number; ids: string } | null = null;

  constructor(
    private readonly material: DrapedMaterial,
    private readonly max: number,
  ) {}

  /** Where the textures come from; loads those in use (nothing when they are in or on the way) */
  setAssets(library: MapAssetLibrary, anisotropy: number): void {
    this.assets = { library, anisotropy };
    void this.load();
  }

  /** The materials in use, in layer order */
  setIds(ids: readonly string[]): void {
    this.ids = ids.slice(0, this.max);
    void this.load();
  }

  dispose(): void {
    this.generation++;
    this.loaded?.dispose();
    this.loaded = null;
    this.requested = null;
  }

  private async load(): Promise<void> {
    const assets = this.assets;
    const ids = this.ids;
    if (!assets || !ids.length) return;
    // The same library and materials as the textures in or on the way: nothing to fetch, decode or upload
    const wanted = { library: assets.library, anisotropy: assets.anisotropy, ids: ids.join('|') };
    const r = this.requested;
    if (r && r.library === wanted.library && r.anisotropy === wanted.anisotropy && r.ids === wanted.ids) return;
    this.requested = wanted;
    const generation = ++this.generation;
    const [{ arrays, materials }, catalog] = await Promise.all([loadMaterialArrays(assets.library, ids, assets.anisotropy), assets.library.catalog()]);
    if (generation !== this.generation) {
      arrays.dispose();
      return;
    }
    this.loaded?.dispose();
    this.loaded = arrays;
    const info = ids.map((id): DrapeMaterialInfo => catalog.materials.find((m) => m.id === id) ?? { id });
    this.material.setTextures(
      arrays,
      info,
      materials.map((m) => m.average),
    );
  }
}

/** What a kind of draped surface brings to the shared material: its attributes' GLSL and its look */
export interface DrapeLook {
  /** Program cache key */
  key: string;
  /** Vertex declarations: its attributes and varyings */
  vertexPars: string;
  /** Vertex code after the shared normal (`drapeMap` is the map point): fills its varyings */
  vertex: string;
  /** A float GLSL expression in the vertex shader: this vertex's rank (DrapePull) */
  rank: string;
  pull: DrapePull;
  /** Fragment declarations: its varyings and functions */
  fragmentPars: string;
  /** The look (see the file's comment) */
  fragment: string;
  /** Uniforms of its own */
  uniforms?: Record<string, { value: unknown }>;
}

/**
 * The material of a draped surface: heights, normals, pull towards the
 * camera, texture arrays and fog, with the look of its kind. Per layer
 * besides the textures: 1 / the metres a texture tile covers, the mean
 * colour, and whether the material is grass and whether it is paved
 */
export class DrapedMaterial extends MeshStandardMaterial {
  readonly drapeUniforms;

  constructor(
    name: string,
    private readonly look: DrapeLook,
    readonly maxLayers: number,
    heights: HeightTexture,
    gridNormals: Texture,
    field: HeightField,
  ) {
    super({ roughness: 0.9, metalness: 0 });
    this.name = name;
    this.drapeUniforms = {
      uDrapeColor: { value: null as Texture | null },
      uDrapeData: { value: null as Texture | null },
      uGridNormals: { value: gridNormals as Texture | null },
      /** Map metres to the grid normals' uv (as TerrainMaterial's uGridUv) */
      uDrapeGridUv: { value: new Vector4() },
      uDrapeInvScale: { value: new Float32Array(maxLayers).fill(0.25) },
      uDrapeAverage: { value: Array.from({ length: maxLayers }, () => new Color(0.09, 0.09, 0.085)) },
      uDrapeGrass: { value: new Float32Array(maxLayers) },
      uDrapePaved: { value: new Float32Array(maxLayers) },
      /** Layers the textures hold */
      uDrapeLayers: { value: 0 },
    };
    const sx = 1 / (field.cellSize * field.columns);
    const sy = 1 / (field.cellSize * field.rows);
    this.drapeUniforms.uDrapeGridUv.value.set(sx, sy, -field.originX * sx + 0.5 / field.columns, -field.originY * sy + 0.5 / field.rows);
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.drapeUniforms, heights.uniforms, look.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${DRAPE_VERTEX_PARS}\n${look.vertexPars}`)
        .replace('#include <beginnormal_vertex>', `${DRAPE_BEGIN_NORMAL}\n${look.vertex}`)
        .replace('#include <begin_vertex>', DRAPE_BEGIN_VERTEX)
        .replace('#include <project_vertex>', drapeProjectVertex(look.rank, look.pull));
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${drapeFragmentPars(maxLayers)}\n${look.fragmentPars}`)
        .replace('#include <map_fragment>', look.fragment)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(drapeRough, 0.2, 1.0);\n// map-roughness-done')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(drapeNormal, 0.0)).xyz);')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= drapeAO;\nreflectedLight.directDiffuse *= mix(1.0, drapeAO, 0.5);');
    };
    addHeightFog(this);
  }

  /** The materials' texture arrays, what the catalogue says of them, and their mean colours (sRGB), by layer */
  setTextures(arrays: MaterialArrays, info: readonly DrapeMaterialInfo[], averages: readonly (readonly [number, number, number])[]): void {
    const u = this.drapeUniforms;
    u.uDrapeColor.value = arrays.color;
    u.uDrapeData.value = arrays.data;
    u.uDrapeLayers.value = info.length;
    info.forEach((m, k) => {
      u.uDrapeInvScale.value[k] = 1 / (m.scale ?? 4);
      u.uDrapeGrass.value[k] = m.category === 'grass' ? 1 : 0;
      u.uDrapePaved.value[k] = m.paved ? 1 : 0;
    });
    averages.forEach((a, k) => u.uDrapeAverage.value[k].setRGB(a[0], a[1], a[2], SRGBColorSpace));
  }

  override customProgramCacheKey(): string {
    return this.look.key;
  }
}

const DRAPE_VERTEX_PARS = /* glsl */ `
varying vec2 vDrapeMap;
varying vec3 vDrapeNormal;
uniform sampler2D uGridNormals;
uniform vec4 uDrapeGridUv;
${TERRAIN_HEIGHT_GLSL}
`;

const DRAPE_BEGIN_NORMAL = /* glsl */ `
vec2 drapeMap = vec2(-position.x, position.z);
vec3 objectNormal = normalize(texture2D(uGridNormals, drapeMap * uDrapeGridUv.xy + uDrapeGridUv.zw).xyz);
vDrapeNormal = objectNormal;
vDrapeMap = drapeMap;
`;

const DRAPE_BEGIN_VERTEX = /* glsl */ `
vec3 transformed = vec3(position.x, terrainHeightAt(drapeMap), position.z);
`;

// Drawn towards the camera along the view ray: where it lands on screen stays, its depth comes before the ground's
function drapeProjectVertex(rank: string, p: DrapePull): string {
  return /* glsl */ `
vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
float drapeDist = length(mvPosition.xyz);
float drapeRank = ${rank};
float drapePull = ${p.base.toFixed(4)} + max(0.0, drapeDist - ${PULL_FROM.toFixed(1)}) * ${p.perMetre.toFixed(5)} + drapeRank * (${p.rank.toFixed(4)} + drapeDist * ${p.rankPerMetre.toFixed(6)});
mvPosition.xyz *= 1.0 - min(0.5, drapePull / max(drapeDist, 1e-3));
gl_Position = projectionMatrix * mvPosition;
`;
}

function drapeFragmentPars(layers: number): string {
  return /* glsl */ `
precision highp sampler2DArray;
varying vec2 vDrapeMap;
varying vec3 vDrapeNormal;
uniform sampler2DArray uDrapeColor;
uniform sampler2DArray uDrapeData;
uniform float uDrapeInvScale[${layers}];
uniform vec3 uDrapeAverage[${layers}];
uniform float uDrapeGrass[${layers}];
uniform float uDrapePaved[${layers}];
uniform float uDrapeLayers;
${SHADER_NOISE}

// The material's texture at p (x across, y along): up close two lookups shifted by a slow noise so the tile never repeats
void drapeLookup(vec2 p, float layer, float invScale, float near, out vec4 rc, out vec4 rd) {
  vec2 ruv = p * invScale;
  vec2 rdx = dFdx(ruv);
  vec2 rdy = dFdy(ruv);
  float l = valueNoise(vec2(p.y * 0.035, p.x * 0.05 + layer * 7.0)) * 6.0;
  float ia = floor(l);
  vec2 oa = sin(vec2(3.0, 7.0) * ia);
  rc = textureGrad(uDrapeColor, vec3(ruv + oa, layer), rdx, rdy);
  rd = textureGrad(uDrapeData, vec3(ruv + oa, layer), rdx, rdy);
  float b = smoothstep(0.3, 0.7, fract(l)) * step(0.001, near);
  if (b > 0.0) {
    vec2 ob = sin(vec2(3.0, 7.0) * (ia + 1.0));
    rc = mix(rc, textureGrad(uDrapeColor, vec3(ruv + ob, layer), rdx, rdy), b);
    rd = mix(rd, textureGrad(uDrapeData, vec3(ruv + ob, layer), rdx, rdy), b);
  }
}
`;
}
