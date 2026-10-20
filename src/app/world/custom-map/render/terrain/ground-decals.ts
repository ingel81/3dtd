import {
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three';
import type { CustomMapDocument, MapObject } from '../../map-document';
import type { CatalogObject } from '../asset-catalog';
import { SHADER_NOISE } from '../shader-noise';
import { addHeightFog } from '../environment/height-fog';
import { TERRAIN_HEIGHT_GLSL, type HeightTexture } from './height-texture';

/**
 * Wear on the ground where life happens: fallen leaves under broadleaf
 * trees, needle litter under conifers and a well in the snow round a
 * snowed-in tree, trodden soil along roads and paths, a trodden path from a
 * house's door to the nearest road or path, puddles in wet places. Baked
 * from the map's rules (objects, paths, weather), never painted by hand;
 * one instanced mesh, one draw call.
 *
 * Each decal is a small grid draped over the terrain (the height texture
 * in the vertex shader, a few centimetres above it), lit, shadowed and
 * fogged like the ground (a standard material); its shape is drawn in the
 * fragment shader per kind, frayed at the rim by noise, so no square shows.
 * A decal may be stretched (a stretch of path: long along its way, narrow
 * across).
 *
 * The map's decals are all planned, but only those within STREAM_RADIUS of
 * the camera's focus draw, nearest first and MAX_DECALS at most, chosen
 * again once the focus moved STREAM_STEP; they fade out towards the radius.
 * A town of 8000 houses then keeps its paths and leaves wherever the camera
 * looks, where a fixed cap of 3000 for the whole map left most houses bare.
 */

/** What a decal shows */
export const DecalKind = { Leaves: 0, Soil: 1, Puddle: 2, Path: 3, Needles: 4, SnowWell: 5 } as const;
export type DecalKind = (typeof DecalKind)[keyof typeof DecalKind];

export interface Decal {
  x: number;
  y: number;
  /** Its length along its rotation, m */
  size: number;
  rotation: number;
  kind: DecalKind;
  /** Width over length (1 round, below 1 a stretch of path) */
  stretch?: number;
}

/** Decals drawn at most at a time (each is a few dozen triangles) */
export const MAX_DECALS = 4096;
/** Decals draw within this many metres of the camera's focus, and fade out over its last fifth */
export const STREAM_RADIUS = 320;
/** The decals drawn are chosen again once the focus moved this far, m */
const STREAM_STEP = 24;
/** Edge of a cell of the decals' grid, m */
const CELL = 32;
/** A door this far or less from a road or path gets a trodden path to it, m */
const PATH_REACH = 32;

export class GroundDecals {
  readonly mesh: InstancedMesh<PlaneGeometry, MeshStandardMaterial>;
  private readonly place: InstancedBufferAttribute;
  private readonly kind: InstancedBufferAttribute;
  /** Every planned decal (x, y, size, rotation; kind, seed, stretch), and the decals by grid cell */
  private all = new Float32Array(0);
  private looks = new Float32Array(0);
  private count = 0;
  private readonly cells = new Map<number, number[]>();
  private readonly focus = new Vector3(Infinity, 0, Infinity);
  /** The focus (map x, y) and the radius the shader fades the decals by */
  private readonly uniforms = { uDecalFocus: { value: new Vector3() }, uDecalRadius: { value: STREAM_RADIUS } };
  private picked: { d: number; i: number }[] = [];

  constructor(heights: HeightTexture) {
    // A grid of 4 x 4 cells in the x/z plane, draped per vertex
    const geometry = new PlaneGeometry(1, 1, 4, 4).rotateX(-Math.PI / 2);
    this.place = new InstancedBufferAttribute(new Float32Array(MAX_DECALS * 4), 4);
    this.kind = new InstancedBufferAttribute(new Float32Array(MAX_DECALS * 3), 3);
    geometry.setAttribute('aDecal', this.place);
    geometry.setAttribute('aDecalKind', this.kind);
    const material = new MeshStandardMaterial({ roughness: 0.9, metalness: 0, transparent: true, depthWrite: false });
    material.name = 'custom-map-decals';
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, heights.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\n${TERRAIN_HEIGHT_GLSL}\nattribute vec4 aDecal;\nattribute vec3 aDecalKind;\nuniform vec3 uDecalFocus;\nuniform float uDecalRadius;\nvarying vec2 vDecalUv;\nvarying vec3 vDecalKind;\nvarying float vDecalFade;`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          // Stretched across (x) and along (z), turned and sized in map space, then on the ground (scene x is map -x)
          float dc = cos(aDecal.w);
          float ds = sin(aDecal.w);
          vec2 shaped = vec2(position.x * aDecalKind.z, position.z);
          vec2 local = vec2(shaped.x * dc - shaped.y * ds, shaped.x * ds + shaped.y * dc) * aDecal.z;
          vec2 mapAt = aDecal.xy + vec2(-local.x, local.y);
          vec3 transformed = vec3(-mapAt.x, terrainHeightAt(mapAt), mapAt.y);
          // Above the ground by more with distance: the terrain's coarser levels and the logarithmic depth
          // would swallow a decal lying a few centimetres up
          transformed.y += 0.05 + length((modelMatrix * vec4(transformed, 1.0)).xyz - cameraPosition) * 0.002;
          vDecalUv = position.xz * 2.0;
          vDecalKind = aDecalKind;
          // Out towards the edge of what streams in
          vDecalFade = 1.0 - smoothstep(0.8, 1.0, distance(aDecal.xy, uDecalFocus.xy) / uDecalRadius);`,
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SHADER_NOISE}\nvarying vec2 vDecalUv;\nvarying vec3 vDecalKind;\nvarying float vDecalFade;`)
        .replace('#include <map_fragment>', DECAL_FRAGMENT)
        // Puddles shine; the rest stays matt
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = int(vDecalKind.x + 0.5) == 2 ? 0.08 : roughness;');
    };
    material.customProgramCacheKey = () => 'custom-map-decals-2';
    addHeightFog(material);
    this.mesh = new InstancedMesh(geometry, material, MAX_DECALS);
    this.mesh.name = 'custom-map-decals';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.mesh.userData['losTransparent'] = true;
    // The instance matrices stay identity: the vertex shader places every decal from aDecal
    this.mesh.matrixAutoUpdate = false;
    const identity = new Object3D();
    identity.updateMatrix();
    for (let i = 0; i < MAX_DECALS; i++) this.mesh.setMatrixAt(i, identity.matrix);
  }

  /** Plans the decals the map's rules ask for (objects by catalogue category, paths, weather); the nearest draw */
  set(doc: DecalSource, entries: Map<string, CatalogObject>): void {
    const decals = planDecals(doc, entries);
    const n = decals.length;
    this.all = new Float32Array(n * 4);
    this.looks = new Float32Array(n * 3);
    this.cells.clear();
    for (let i = 0; i < n; i++) {
      const d = decals[i];
      this.all.set([d.x, d.y, d.size, d.rotation], i * 4);
      this.looks.set([d.kind, ((i * 0.6180339) % 1) * 50, d.stretch ?? 1], i * 3);
      const key = cellKey(d.x, d.y);
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(i);
    }
    this.count = n;
    this.focus.set(Infinity, 0, Infinity);
    this.stream(this.uniforms.uDecalFocus.value.x, this.uniforms.uDecalFocus.value.y, true);
  }

  /** The camera's focus on the ground (map metres): the decals round it draw, chosen again once it moved STREAM_STEP */
  update(x: number, y: number): void {
    this.stream(x, y, false);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }

  private stream(x: number, y: number, force: boolean): void {
    if (!force && Math.hypot(x - this.focus.x, y - this.focus.z) < STREAM_STEP) return;
    this.focus.set(x, 0, y);
    this.uniforms.uDecalFocus.value.set(x, y, 0);
    const picked = this.picked;
    picked.length = 0;
    const r = STREAM_RADIUS;
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
      for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) {
        const list = this.cells.get(cx * 65536 + cy);
        if (!list) continue;
        for (const i of list) {
          const d = Math.hypot(this.all[i * 4] - x, this.all[i * 4 + 1] - y);
          if (d <= r) picked.push({ d, i });
        }
      }
    }
    if (picked.length > MAX_DECALS) picked.sort((a, b) => a.d - b.d);
    const n = Math.min(MAX_DECALS, picked.length);
    const place = this.place.array as Float32Array;
    const kind = this.kind.array as Float32Array;
    for (let k = 0; k < n; k++) {
      const i = picked[k].i;
      place.set(this.all.subarray(i * 4, i * 4 + 4), k * 4);
      kind.set(this.looks.subarray(i * 3, i * 3 + 3), k * 3);
    }
    if (n > 0) {
      this.place.clearUpdateRanges();
      this.place.addUpdateRange(0, n * 4);
      this.place.needsUpdate = true;
      this.kind.clearUpdateRanges();
      this.kind.addUpdateRange(0, n * 3);
      this.kind.needsUpdate = true;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0 && this.count > 0;
  }
}

function cellKey(x: number, y: number): number {
  return Math.floor(x / CELL) * 65536 + Math.floor(y / CELL);
}

// The shape and look of each kind of decal
const DECAL_FRAGMENT = /* glsl */ `
{
  float r = length(vDecalUv);
  float seed = vDecalKind.y;
  // A frayed rim: the radius the noise allows at this angle and spot
  float rim = 0.75 + (valueNoise(vDecalUv * 2.5 + seed) - 0.5) * 0.5;
  float body = smoothstep(rim, rim - 0.25, r);
  int kind = int(vDecalKind.x + 0.5);
  if (kind == 0) {
    // Leaves: scattered small blots in autumn colours, thicker towards the middle
    vec2 cell = vDecalUv * 9.0 + seed * 7.0;
    float leaf = smoothstep(0.35, 0.6, valueNoise(cell)) * (0.5 + 0.5 * smoothstep(0.2, 0.5, valueNoise(cell * 0.31 + 3.0)));
    vec3 tint = mix(vec3(0.36, 0.2, 0.08), vec3(0.58, 0.4, 0.12), valueNoise(cell * 0.5 + 9.0));
    diffuseColor = vec4(tint, leaf * body * 0.85);
  } else if (kind == 1) {
    // Trodden soil: a dark, slightly glossy stain, patchy inside
    float patchy = 0.6 + 0.4 * valueNoise(vDecalUv * 4.0 + seed);
    diffuseColor = vec4(vec3(0.075, 0.05, 0.03), body * patchy * 0.8);
  } else if (kind == 2) {
    // Puddle: dark water with a soft edge
    diffuseColor = vec4(vec3(0.05, 0.06, 0.07), smoothstep(rim * 0.85, rim * 0.6, r) * 0.75);
  } else if (kind == 3) {
    // A stretch of trodden path: bare earth down its middle (the stretch is narrow across: uv x), the sward worn
    // thin towards its edges, broken by tufts that survive; a little wet dark in its dips
    float across = abs(vDecalUv.x);
    float worn = smoothstep(0.85, 0.2, across + (valueNoise(vDecalUv * vec2(3.0, 9.0) + seed) - 0.5) * 0.45);
    float tufts = smoothstep(0.55, 0.75, valueNoise(vDecalUv * vec2(6.0, 14.0) + seed * 3.0)) * (1.0 - worn * 0.6);
    vec3 earth = mix(vec3(0.17, 0.12, 0.08), vec3(0.24, 0.18, 0.12), valueNoise(vDecalUv * vec2(4.0, 11.0) + 5.0));
    // Fades at the ends of its stretch: the next one along overlaps it
    float ends = smoothstep(1.0, 0.7, abs(vDecalUv.y));
    diffuseColor = vec4(earth, worn * (1.0 - tufts) * ends * 0.8);
  } else if (kind == 4) {
    // Needle litter under a conifer: a rusty brown carpet, dense at the trunk, thinning in a frayed ring
    float carpet = smoothstep(rim + 0.05, rim * 0.35, r);
    float grain = 0.65 + 0.35 * valueNoise(vDecalUv * 16.0 + seed);
    vec3 needles = mix(vec3(0.22, 0.12, 0.06), vec3(0.34, 0.2, 0.09), valueNoise(vDecalUv * 5.0 + seed * 2.0));
    diffuseColor = vec4(needles * grain, carpet * 0.75);
  } else {
    // The well in the snow round a snowed-in tree: a soft blue-grey hollow, needles and twigs dropped in it
    float well = smoothstep(rim, rim * 0.3, r);
    float debris = smoothstep(0.62, 0.8, valueNoise(vDecalUv * 14.0 + seed)) * smoothstep(0.7, 0.2, r);
    vec3 shade = mix(vec3(0.52, 0.58, 0.68), vec3(0.2, 0.14, 0.09), debris);
    diffuseColor = vec4(shade, max(well * 0.35, debris * 0.7));
  }
  diffuseColor.a *= vDecalFade;
  if (diffuseColor.a < 0.01) discard;
}`;

/** A repeatable random number from a seed (0..1) */
function hash(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** What decals are planned from: the objects shown, the paths, the weather and biome */
export type DecalSource = Pick<CustomMapDocument, 'objects' | 'paths' | 'environment'>;

/** A road or path as segments with its width, in a grid for the door paths' search */
interface WaySegments {
  /** ax, ay, bx, by, half width per segment */
  seg: Float32Array;
  cells: Map<number, number[]>;
}

/** The ways (roads and paths, no bridges or tunnels) as segments by grid cell */
function waySegments(doc: DecalSource): WaySegments {
  const nodes = new Map(doc.paths.nodes.map((n) => [n.id, n]));
  const out: number[] = [];
  for (const edge of doc.paths.edges) {
    if (edge.kind === 'bridge' || edge.tunnel) continue;
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) continue;
    const line = [a, ...(edge.via ?? []), b];
    for (let k = 0; k < line.length - 1; k++) out.push(line[k].x, line[k].y, line[k + 1].x, line[k + 1].y, edge.width / 2);
  }
  const seg = Float32Array.from(out);
  const cells = new Map<number, number[]>();
  for (let s = 0; s < seg.length / 5; s++) {
    const [ax, ay, bx, by] = seg.subarray(s * 5, s * 5 + 4);
    for (let cx = Math.floor(Math.min(ax, bx) / CELL); cx <= Math.floor(Math.max(ax, bx) / CELL); cx++) {
      for (let cy = Math.floor(Math.min(ay, by) / CELL); cy <= Math.floor(Math.max(ay, by) / CELL); cy++) {
        const key = cx * 65536 + cy;
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(s);
      }
    }
  }
  return { seg, cells };
}

/**
 * The point on the edge of the nearest road or path within PATH_REACH of
 * (x, y), and how far it is; null when none is that near
 */
function nearestWayEdge(ways: WaySegments, x: number, y: number): { x: number; y: number; d: number } | null {
  let best: { x: number; y: number; d: number } | null = null;
  const seen = new Set<number>();
  for (let cx = Math.floor((x - PATH_REACH) / CELL); cx <= Math.floor((x + PATH_REACH) / CELL); cx++) {
    for (let cy = Math.floor((y - PATH_REACH) / CELL); cy <= Math.floor((y + PATH_REACH) / CELL); cy++) {
      for (const s of ways.cells.get(cx * 65536 + cy) ?? []) {
        if (seen.has(s)) continue;
        seen.add(s);
        const [ax, ay, bx, by, half] = ways.seg.subarray(s * 5, s * 5 + 5);
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
        const px = ax + dx * t;
        const py = ay + dy * t;
        const centre = Math.hypot(x - px, y - py);
        const d = centre - half;
        if (d > PATH_REACH || (best && d >= best.d)) continue;
        // Onto the way's edge, from the point on its middle line
        const k = centre > 1e-6 ? half / centre : 0;
        best = { x: px + (x - px) * k, y: py + (y - py) * k, d: Math.max(0, d) };
      }
    }
  }
  return best;
}

/**
 * A trodden path from a house's door to the edge of the nearest road or
 * path: stretches of about 2.5 m along the line, each wandering a little
 * aside, overlapping their neighbours. None from a door at the road (it is
 * trodden by the road's edge already) or without a road within reach
 */
function doorPath(out: Decal[], o: MapObject, e: CatalogObject, ways: WaySegments): void {
  const s = o.scale || 1;
  const a = o.rotation;
  // The model's front (+z, map north at rotation 0) at its ground rectangle's front edge, else its footprint's
  const reach = e.box ? (e.box[1] + e.box[3]) * s : e.footprint * s * 0.9;
  const fx = -Math.sin(a);
  const fy = Math.cos(a);
  // A little off the middle of the front, as doors stand
  const side = (hash(o.x * 1.7 + o.y * 0.3) - 0.5) * (e.box ? e.box[2] * s : e.footprint * s) * 0.8;
  const dx = o.x + fx * reach + fy * side;
  const dy = o.y + fy * reach - fx * side;
  const edge = nearestWayEdge(ways, dx, dy);
  if (!edge || edge.d < 1.2) return;
  const len = Math.hypot(edge.x - dx, edge.y - dy);
  const tx = (edge.x - dx) / len;
  const ty = (edge.y - dy) / len;
  const pieces = Math.max(1, Math.ceil(len / 2.5));
  const step = len / pieces;
  const width = 0.9 + hash(o.x + o.y * 3.1) * 0.5;
  const wander = 0.25 + hash(o.y * 2.3 - o.x) * 0.35;
  for (let k = 0; k < pieces; k++) {
    const u = (k + 0.5) / pieces;
    // Off the straight line by a slow swing that is zero at both ends
    const off = Math.sin(u * Math.PI) * Math.sin(u * 5.0 + hash(o.x) * 6.28) * wander;
    const x = dx + tx * step * (k + 0.5) - ty * off;
    const y = dy + ty * step * (k + 0.5) + tx * off;
    const length = step * 1.5;
    out.push({ x, y, size: length, rotation: Math.atan2(tx, ty), kind: DecalKind.Path, stretch: width / length });
  }
}

/**
 * The decals of a map: leaves under broadleaf trees (one in two), needle
 * litter under conifers and a well in the snow under snowed-in trees,
 * trodden soil along roads and paths and a trodden path from each house's
 * door to the nearest of them, puddles beside paths when it rains (or
 * storms) or in a swamp
 */
export function planDecals(doc: DecalSource, entries: Map<string, CatalogObject>): Decal[] {
  const out: Decal[] = [];
  const wet = doc.environment.weather === 'rain' || doc.environment.weather === 'storm' || doc.environment.biome === 'swamp';
  const snowy = (doc.environment.snowCover ?? 0) > 0.2 || doc.environment.biome === 'arctic' || doc.environment.weather === 'snow';
  const objects: MapObject[] = doc.objects;
  let ways: WaySegments | null = null;
  for (const o of objects) {
    const e = entries.get(o.asset);
    if (!e) continue;
    const s = o.scale || 1;
    const h = hash(o.x * 0.37 + o.y * 0.71);
    const tags = e.tags ?? [];
    if (e.category === 'tree' && !tags.includes('hell') && !tags.includes('wasteland')) {
      const r = Math.max(4, e.footprint * s * 3);
      if (snowy || tags.includes('winter') || tags.includes('arctic')) {
        // Snow under a tree lies less and darker: a well round the trunk with what fell into it
        if (h < 0.7) out.push({ x: o.x, y: o.y, size: r * 0.8, rotation: h * 6.28, kind: DecalKind.SnowWell });
      } else if (tags.includes('conifer')) {
        // A carpet of needles round the trunk, most conifers
        if (h < 0.75) out.push({ x: o.x, y: o.y, size: r * 0.85, rotation: h * 6.28, kind: DecalKind.Needles });
      } else if (h < 0.5) {
        // One broadleaf tree in two drops a carpet of leaves around its trunk
        out.push({ x: o.x, y: o.y, size: r, rotation: h * 6.28, kind: DecalKind.Leaves });
      }
    } else if (e.category === 'building' && !o.mass && !tags.includes('moon') && !tags.includes('mars')) {
      doorPath(out, o, e, (ways ??= waySegments(doc)));
    }
  }
  // Along roads and paths: worn patches at their edges every 9 to 15 m, puddles in the wet; beyond a road's pavement
  // (the road surface draws it over the ground: a patch under it showed through as a dark stain on the paving)
  const nodes = new Map(doc.paths.nodes.map((n) => [n.id, n]));
  for (const edge of doc.paths.edges) {
    if (edge.kind === 'bridge' || edge.tunnel) continue;
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) continue;
    const line = [a, ...(edge.via ?? []), b];
    let walked = 0;
    for (let k = 0; k < line.length - 1; k++) {
      const p = line[k];
      const q = line[k + 1];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 1e-3) continue;
      const tx = (q.x - p.x) / len;
      const ty = (q.y - p.y) / len;
      for (; walked < len; walked += 9 + hash(walked + k) * 6) {
        const h = hash(p.x + walked * 1.3 + p.y * 0.7);
        const side = h < 0.5 ? -1 : 1;
        const off = edge.width / 2 + (edge.sidewalk ?? 0) + 0.6 + h * 1.2;
        const x = p.x + tx * walked - ty * off * side;
        const y = p.y + ty * walked + tx * off * side;
        const kind = wet && h > 0.7 ? DecalKind.Puddle : DecalKind.Soil;
        out.push({ x, y, size: kind === DecalKind.Puddle ? 2 + h * 2 : 3.2 + h * 2.8, rotation: h * 6.28, kind });
      }
      walked -= len;
    }
  }
  return out;
}
