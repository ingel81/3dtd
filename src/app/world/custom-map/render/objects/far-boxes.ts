import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  Group,
  InstancedMesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RGBADepthPacking,
  RGBAFormat,
  Sphere,
  Vector2,
  Vector3,
  type Texture,
} from 'three';
import type { CatalogObject } from '../asset-catalog';
import { addHeightFog } from '../environment/height-fog';
import { addLodFade, fadeGeometry } from './lod-fade';
import { InstanceList, type InstanceSource } from './instance-list';
import type { SharedDraws } from './shared-draws';
import { NIGHT_WINDOW_UNIFORMS } from './night-windows';

/**
 * The far stage of the catalogue's buildings: every building of every asset
 * drawn as one box in one instanced draw (one for those that block sight,
 * one for the rest). A box is 24 triangles: its top a 3 x 3 grid of heights
 * (a flat roof, a gable either way, a hip, a shed), its four walls down to
 * the model's foundation, each textured with the model seen square on from
 * its side and the top from above, five tiles of one atlas for all
 * buildings (tools/map-assets/bake_far_boxes.mjs, catalogue `far`). The box
 * comes from the template's grid corner, the asset's row of a small data
 * texture and the instance's matrix, in the vertex shader of the material,
 * of the sun's shadow and of the line-of-sight cube alike. Window glass
 * (the atlas's half alpha) glows at night like the model's
 * (night-windows.ts), cell for cell, so a town keeps its lit windows from
 * afar. Flat shaded: each face lights by its own slope.
 */

/** Pixels per atlas tile and tiles per atlas row, as bake_far_boxes.mjs writes them */
export const FAR_TILE = 64;
export const FAR_COLUMNS = 16;
/** Texels per asset row of the parameter texture: box, span, nine heights and the tone (catalogue `far.tone`) */
const ROW_TEXELS = 5;

/** GLSL of the box: where a template vertex lies for its asset's row (farBoxLocal), and its place in the atlas (farBoxUv) */
const FAR_BOX_GLSL = /* glsl */ `
attribute float aFarRow;
uniform highp sampler2D uFarParams;
vec4 farParam(int k) {
  return texelFetch(uFarParams, ivec2(k, int(aFarRow + 0.5)), 0);
}
// p: grid column (0..2), top (1) or foundation (0), grid row (0..2)
vec3 farBoxLocal(vec3 p) {
  vec4 box = farParam(0);
  int k = int(p.z + 0.5) * 3 + int(p.x + 0.5);
  vec4 a = farParam(2);
  vec4 b = farParam(3);
  float h = k < 4 ? a[k] : k < 8 ? b[k - 4] : farParam(4).x;
  float y = p.y > 0.5 ? h : farParam(1).x;
  return vec3(box.x + (p.x - 1.0) * box.z, y, box.y + (p.z - 1.0) * box.w);
}
`;

const FAR_UV_GLSL = /* glsl */ `
uniform vec2 uFarAtlas;
// Where the atlas shows the template vertex p on side s (0 top, 1 -z, 2 +x, 3 +z, 4 -x) at height y
vec2 farBoxUv(vec3 p, float s, float y) {
  vec4 span = farParam(1);
  float u;
  float v;
  if (s < 0.5) {
    u = p.x * 0.5;
    v = p.z * 0.5;
  } else {
    // Seen from outside: from -z the right hand is -x, from +x it is -z, and so on round
    u = s < 1.5 ? 1.0 - p.x * 0.5 : s < 2.5 ? 1.0 - p.z * 0.5 : s < 3.5 ? p.x * 0.5 : p.z * 0.5;
    v = 1.0 - (y - span.x) / max(span.y - span.x, 0.01);
  }
  float t = span.z * 5.0 + s;
  vec2 tile = vec2(mod(t, ${FAR_COLUMNS}.0), floor(t / ${FAR_COLUMNS}.0));
  // A pixel and a half in from the tile's edge: its neighbours do not bleed in
  return (tile * ${FAR_TILE}.0 + 1.5 + vec2(u, v) * (${FAR_TILE}.0 - 3.0)) / uFarAtlas;
}
`;

/**
 * The template: the top's nine grid points, each wall's three columns at
 * the top and the foundation. Position: grid column, top or foundation,
 * grid row; uv.x: the side. Triangles face out.
 */
function boxTemplate(): BufferGeometry {
  const pos: number[] = [];
  const side: number[] = [];
  const index: number[] = [];
  const vertex = (i: number, top: number, j: number, s: number): number => {
    pos.push(i, top, j);
    side.push(s, 0);
    return pos.length / 3 - 1;
  };
  // Where a template point lies for a unit box with a flat top at 1: to check each triangle faces out
  const at = (v: number) => new Vector3(pos[v * 3] - 1, pos[v * 3 + 1], pos[v * 3 + 2] - 1);
  const face = (a: number, b: number, c: number, out: Vector3): void => {
    const n = at(b).sub(at(a)).cross(at(c).sub(at(a)));
    if (n.dot(out) >= 0) index.push(a, b, c);
    else index.push(a, c, b);
  };
  const grid: number[] = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) grid.push(vertex(i, 1, j, 0));
  const up = new Vector3(0, 1, 0);
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const g = (di: number, dj: number) => grid[(j + dj) * 3 + i + di];
      face(g(0, 0), g(0, 1), g(1, 0), up);
      face(g(1, 0), g(0, 1), g(1, 1), up);
    }
  }
  // The walls: side 1 at -z (row 0), 2 at +x (column 2), 3 at +z (row 2), 4 at -x (column 0)
  const walls: [number, (k: number) => [number, number], Vector3][] = [
    [1, (k) => [k, 0], new Vector3(0, 0, -1)],
    [2, (k) => [2, k], new Vector3(1, 0, 0)],
    [3, (k) => [k, 2], new Vector3(0, 0, 1)],
    [4, (k) => [0, k], new Vector3(-1, 0, 0)],
  ];
  for (const [s, corner, out] of walls) {
    const top: number[] = [];
    const bottom: number[] = [];
    for (let k = 0; k < 3; k++) {
      const [i, j] = corner(k);
      top.push(vertex(i, 1, j, s));
      bottom.push(vertex(i, 0, j, s));
    }
    for (let k = 0; k < 2; k++) {
      face(bottom[k], top[k], bottom[k + 1], out);
      face(bottom[k + 1], top[k], top[k + 1], out);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(side), 2));
  g.setIndex(index);
  // Instances lie anywhere: the mesh is culled by the bounds of its buildings, never by the template's
  g.boundingSphere = new Sphere(new Vector3(), 1e6);
  return g;
}

/** One draw of boxes: its instances and its mesh */
interface FarDraw {
  list: InstanceList;
  mesh: InstancedMesh;
}

/** The keys of the boxes' two draws: those that block sight, the rest */
export const FAR_BLOCKING = 'blocking';
export const FAR_OPEN = 'open';

export class FarBoxes implements SharedDraws {
  /** Per asset: its box and atlas tile, 5 texels a row (box, span, nine heights, tone) */
  private params: DataTexture;
  private readonly rows = new Map<string, number>();
  private readonly template = boxTemplate();
  private readonly material: MeshStandardMaterial;
  private readonly depthMaterial: MeshDepthMaterial;
  private readonly uniforms: { uFarParams: { value: DataTexture }; uFarAtlas: { value: Vector2 } };
  /** The boxes that block sight (key `blocking`), and the rest (`open`) */
  private readonly draws = new Map<string, FarDraw>();
  /** Bounds of every building drawn as a box, per draw */
  private readonly boundsOf = new Map<string, Sphere>();

  constructor(
    atlas: Texture,
    private readonly groups: { blocking: Group; open: Group },
  ) {
    const image = atlas.image as { width: number; height: number };
    this.params = new DataTexture(new Float32Array(ROW_TEXELS * 4 * 16), ROW_TEXELS, 16, RGBAFormat, FloatType);
    this.params.magFilter = this.params.minFilter = NearestFilter;
    this.params.needsUpdate = true;
    this.uniforms = { uFarParams: { value: this.params }, uFarAtlas: { value: new Vector2(image.width, image.height) } };

    const m = new MeshStandardMaterial({ map: atlas, flatShading: true, roughness: 0.85, metalness: 0 });
    m.name = 'far-box';
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms, NIGHT_WINDOW_UNIFORMS);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${FAR_BOX_GLSL}\n${FAR_UV_GLSL}\nvarying vec3 vFarWorld;\nvarying vec3 vFarTone;`)
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `vec3 transformed = farBoxLocal(position);
          vMapUv = farBoxUv(position, uv.x, transformed.y);
          vFarWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vFarTone = farParam(4).yzw;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFarWorld;\nvarying vec3 vFarTone;\nuniform float uNightWindows;')
        // The asset's tone (catalogue `far.tone`): the box as bright as its model in the same light
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= vFarTone;')
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          if (uNightWindows > 0.0 && texture2D(map, vMapUv).a < 0.75) {
            // The model's windows (night-windows.ts): one storey and bay per cell, lit or not, warmer or paler
            vec3 cell = floor(vFarWorld * vec3(0.4, 0.333, 0.4));
            float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            vec3 warm = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.85, 0.6), fract(h * 7.0));
            totalEmissiveRadiance += warm * step(0.45, h) * uNightWindows * 0.9;
          }`,
        );
    };
    m.customProgramCacheKey = () => 'custom-map-far-box';
    addLodFade(m);
    addHeightFog(m);
    this.material = m;

    const d = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    d.name = 'far-box-depth';
    d.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${FAR_BOX_GLSL}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = farBoxLocal(position);');
    };
    d.customProgramCacheKey = () => 'custom-map-far-box-depth';
    this.depthMaterial = d;
  }

  bounds(key: string): Sphere {
    let b = this.boundsOf.get(key);
    if (!b) this.boundsOf.set(key, (b = new Sphere()));
    return b;
  }

  /** The asset's row (its box and tile written on first use) */
  row(entry: CatalogObject): number {
    const known = this.rows.get(entry.id);
    if (known !== undefined) return known;
    const far = entry.far!;
    const r = this.rows.size;
    this.rows.set(entry.id, r);
    if (r >= this.params.image.height) {
      const grown = new DataTexture(new Float32Array(ROW_TEXELS * 4 * this.params.image.height * 2), ROW_TEXELS, this.params.image.height * 2, RGBAFormat, FloatType);
      (grown.image.data as Float32Array).set(this.params.image.data as Float32Array);
      grown.magFilter = grown.minFilter = NearestFilter;
      this.params.dispose();
      this.params = grown;
      this.uniforms.uFarParams.value = grown;
    }
    const data = this.params.image.data as Float32Array;
    const at = r * ROW_TEXELS * 4;
    const [cx, cz, hw, hd, y0, top] = far.box;
    data.set([cx, cz, hw, hd, y0, top, far.tile, 0, ...far.top, ...(far.tone ?? [1, 1, 1])], at);
    this.params.needsUpdate = true;
    return r;
  }

  /** The list of the boxes that block sight or not, with room for at least `capacity`; a new one when it had less */
  list(key: string, capacity: number): { list: InstanceList; renewed: boolean } {
    const blocks = key === FAR_BLOCKING;
    const old = this.draws.get(key);
    if (old && old.list.capacity >= capacity) return { list: old.list, renewed: false };
    if (old) this.disposeDraw(old);
    const list = new InstanceList(Math.max(capacity, old ? old.list.capacity * 2 : 256), true, [1]);
    const geometry = fadeGeometry(this.template, list.fades);
    geometry.setAttribute('aFarRow', list.extras[0]);
    const mesh = new InstancedMesh(geometry, this.material, 0);
    mesh.instanceMatrix = list.matrices;
    mesh.instanceColor = list.colors;
    mesh.customDepthMaterial = this.depthMaterial;
    mesh.boundingSphere = this.bounds(key);
    mesh.name = blocks ? 'far-boxes' : 'far-boxes-decor';
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.userData['objectsKind'] = 'far-box';
    // A far stand-in the camera chose: the LOS cube draws the buildings' full models (object-layer.ts LosDraw)
    mesh.userData['losTransparent'] = true;
    let drawn = 0;
    mesh.onBeforeShadow = () => {
      drawn = mesh.count;
      mesh.count = Math.min(drawn, list.casters);
    };
    mesh.onAfterShadow = () => {
      mesh.count = drawn;
    };
    (blocks ? this.groups.blocking : this.groups.open).add(mesh);
    this.draws.set(key, { list, mesh });
    return { list, renewed: true };
  }

  /** Uploads what the lists changed and draws what they hold (or, `warmUp`, one box each for a render that compiles them) */
  sync(warmUp = false): void {
    for (const d of this.draws.values()) {
      if (warmUp && d.list.count === 0) d.list.placeholder(PLACEHOLDER, 0);
      d.list.flush();
      d.mesh.count = warmUp ? Math.max(1, d.list.count) : d.list.count;
      d.mesh.visible = d.mesh.count > 0;
      d.mesh.castShadow = warmUp || d.list.casters > 0;
      d.mesh.frustumCulled = !warmUp;
    }
  }

  /** While `on` the boxes near the focus alone (MapObjectLayer.nearOnly) */
  nearOnly(on: boolean): void {
    for (const d of this.draws.values()) d.mesh.count = on ? Math.min(d.list.count, d.list.casters) : d.list.count;
  }

  /** The meshes of the boxes that block no sight (a water reflection leaves them out) */
  openMeshes(): InstancedMesh[] {
    const open = this.draws.get(FAR_OPEN);
    return open ? [open.mesh] : [];
  }

  dispose(): void {
    for (const d of this.draws.values()) this.disposeDraw(d);
    this.draws.clear();
    this.template.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.params.dispose();
  }

  private disposeDraw(d: FarDraw): void {
    d.mesh.removeFromParent();
    d.mesh.dispose();
    // The template's buffers stay for the next list; the fades and rows of this one go with it
    const g = d.mesh.geometry;
    g.deleteAttribute('position');
    g.deleteAttribute('uv');
    g.setIndex(null);
    g.dispose();
  }
}

/** What a warm-up render draws of an empty list: a box of row 0 at the origin */
const PLACEHOLDER: InstanceSource = {
  matrices: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  colors: null,
  extras: [[0]],
};

export type { InstanceSource };
