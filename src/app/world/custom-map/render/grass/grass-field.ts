import {
  DoubleSide,
  ShaderChunk,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Vector2,
  Vector4,
  type Texture,
} from 'three';
import { SHADER_NOISE } from '../shader-noise';
import { TERRAIN_HEIGHT_GLSL, type HeightTexture } from '../terrain/height-texture';
import { COVER_RIM, type CoverMap } from '../environment/cover-map';
import { MAX_FAR_GRASS_BLADES, MAX_GRASS_BLADES } from '../../../../three-engine/render-quality';
import { addHeightFog } from '../environment/height-fog';
import { WIND_GLSL, WIND_UNIFORMS } from '../environment/wind';
import { GROUND_COLOR_GLSL, GROUND_COLOR_UNIFORMS } from '../terrain/ground-color';

/**
 * One layer of grass blades (grass-layers.ts keeps a near and a far one): a tile of instanced blades that wraps
 * around the camera's focus (each blade's spot is fixed in the world and
 * folded into the tile), standing on the height grid (fetched in the vertex
 * shader), as dense as the grass layers of the splat there (none on roads,
 * paths and cliffs), swaying in the wind. Towards a circle inside the
 * tile the blades thin out (dithered) and shrink, so neither the tile's
 * square nor the switch to the painted ground is seen.
 *
 * Each ground layer grows its own blades (the catalogue's `blades`): a lawn
 * short and fine, a meadow tall with seed heads and flowers, mixed by the
 * splat's weights. Blades gather in tufts, thinner near the camera. Each
 * takes the colour the ground has under it (groundColorAt: the terrain's own
 * colour baked from above, ground-albedo.ts), so from high up the blades do
 * not show as a patch of their own colour, and glows through towards the
 * sun at its tip. None grows where the CoverMap's top lies above the
 * ground (footprints of buildings, structures and rocks, pools; water, lava
 * and ice), and round buildings, walls and rocks the blades grow shorter
 * over the last metre and a half, none right at the wall.
 *
 * Lit like any standard material (shadows received, fog, grade); blades do
 * not cast shadows. Not part of line of sight.
 */

/** The blades a grass layer grows (catalogue `blades`): heights from and to, width, and whether seed heads and flowers show, metres */
export interface GrassBlades {
  height: readonly [number, number];
  width: number;
  heads?: boolean;
}

/** Blades of a grass layer whose catalogue entry names none: knee-high meadow grass */
export const DEFAULT_BLADES: GrassBlades = { height: [0.35, 0.8], width: 0.095, heads: true };

/** The splat (GROUND_COLOR_UNIFORMS, set with the map's layers) tells where; these, what grows */
export interface GrassInputs {
  pathMask: Texture;
  /** Grass share per splat channel (1 for grass layers, 0 otherwise), one per splat map */
  mask: Vector4[];
  /** The blades of the layer in each splat channel, the maps in order (none for a channel without grass) */
  blades: (GrassBlades | null)[];
}

/** The shape of one grass layer */
export interface GrassLayout {
  name: string;
  /** Edge of the tile around the layer's centre, metres */
  tile: number;
  /**
   * Blades the field holds, for the highest quality level; a level draws the
   * first so many (setBlades). The random sequence runs blade by blade, so
   * the first 70 000 near blades lie where they lay before the levels
   */
  capacity: number;
  /** Blades drawn before a level says otherwise (High); fewer are drawn wider */
  defaultBlades: number;
  /** Rows of the blade strip */
  rows: number;
  /** Factors on the blades' width and height */
  width: number;
  height: number;
  /** Blades widen with their distance to the camera by this per metre (0: never), so they keep a pixel or two */
  grow: number;
  /** Camera distances over which a blade's own shading gives way to the plain ground colour, m */
  flat: [number, number];
  /** Factor on how far a blade's shading (darker root, lighter tip) strays from the ground colour */
  contrast: number;
  seed: number;
}

/** Blades round the camera's feet */
export const NEAR_GRASS: GrassLayout = {
  name: 'custom-map-grass', tile: 64, capacity: MAX_GRASS_BLADES, defaultBlades: 70000, rows: 4, width: 1, height: 1, grow: 0, flat: [25, 110], contrast: 1, seed: 12345,
};
/**
 * The ring beyond them: a tile four times as wide at a sixteenth of the
 * density or so, blades wider and a little taller, widening further away,
 * on a strip of two rows
 */
export const FAR_GRASS: GrassLayout = {
  name: 'custom-map-grass-far', tile: 256, capacity: MAX_FAR_GRASS_BLADES, defaultBlades: 60000, rows: 2, width: 2.2, height: 1.15, grow: 1 / 45, flat: [80, 320], contrast: 1.8, seed: 67890,
};

/** A layer's blades thin out between these shares of its half tile (a circle inside the tile) */
export const GRASS_FADE_FROM = 0.6;
export const GRASS_FADE_TO = 0.95;

/** The share of a layer's blades kept at distance `d` from its centre (the vertex shader's grassFade) */
export function grassFade(d: number, tile: number): number {
  const x = Math.min(1, Math.max(0, (d / (0.5 * tile) - GRASS_FADE_FROM) / (GRASS_FADE_TO - GRASS_FADE_FROM)));
  return 1 - x * x * (3 - 2 * x);
}

/** Each layout's blade spots and randoms, rolled once per page: every view of every map takes the same */
const blades = new Map<string, { offsets: Float32Array; rnd: Float32Array }>();

function bladeData({ seed, capacity, tile }: GrassLayout): { offsets: Float32Array; rnd: Float32Array } {
  const key = `${seed}|${capacity}|${tile}`;
  let data = blades.get(key);
  if (data) return data;
  const offsets = new Float32Array(capacity * 2);
  const rnd = new Float32Array(capacity * 4);
  let s = seed;
  const next = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < capacity; i++) {
    offsets[i * 2] = next() * tile;
    offsets[i * 2 + 1] = next() * tile;
    for (let c = 0; c < 4; c++) rnd[i * 4 + c] = next();
  }
  blades.set(key, (data = { offsets, rnd }));
  return data;
}

export class GrassField {
  readonly mesh: Mesh<InstancedBufferGeometry, MeshStandardMaterial>;
  private hasGrass = false;
  /** The quality level draws grass at all */
  private enabled = true;
  private readonly uniforms = {
    uGrassCenter: { value: new Vector2() },
    uGrassTile: { value: 64 },
    /** Share of the layer shown (the camera's distance); fewer and shorter blades below 1 */
    uGrassShow: { value: 1 },
    /**
     * The layer inside this one (the far ring's hole): where its blades
     * thin out, these grow, so the densities cross over and never add up;
     * tile 0 for none
     */
    uGrassHoleCenter: { value: new Vector2() },
    uGrassHoleTile: { value: 0 },
    uGrassHoleShow: { value: 0 },
    uGrassSize: { value: new Vector2(1, 1) },
    uGrassGrow: { value: 0 },
    uGrassFlat: { value: new Vector2(25, 110) },
    uGrassContrast: { value: 1 },
    uGrassPath: { value: null as Texture | null },
    uGrassMask0: { value: new Vector4() },
    uGrassMask1: { value: new Vector4() },
    uGrassMask2: { value: new Vector4() },
    /** Per splat channel the blades of its layer: height from and to, width, seed heads (0 or 1), metres */
    uGrassBlades: { value: Array.from({ length: 12 }, () => new Vector4(DEFAULT_BLADES.height[0], DEFAULT_BLADES.height[1], DEFAULT_BLADES.width, 1)) },
    uGrassCover: { value: null as Texture | null },
    /** The cover's distance to the nearest footprint (CoverMap.rim), 1 for COVER_RIM */
    uGrassRim: { value: null as Texture | null },
    uGrassHasCover: { value: 0 },
    /** Wider blades at a lower density (setBlades), so the meadow keeps its cover */
    uGrassWidth: { value: 1 },
  };

  constructor(heights: HeightTexture, readonly layout: GrassLayout = NEAR_GRASS) {
    const { tile, rows, capacity } = layout;
    const u = this.uniforms;
    u.uGrassTile.value = tile;
    u.uGrassSize.value.set(layout.width, layout.height);
    u.uGrassGrow.value = layout.grow;
    u.uGrassFlat.value.set(...layout.flat);
    u.uGrassContrast.value = layout.contrast;
    const g = new InstancedBufferGeometry();
    // A tapering strip: (rows + 1) pairs of vertices, x across, y up
    const pos = new Float32Array((rows + 1) * 2 * 3);
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const w = 0.5 * (1 - t * 0.85);
      pos.set([-w, t, 0, w, t, 0], r * 6);
    }
    const index: number[] = [];
    for (let r = 0; r < rows; r++) {
      const a = r * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(index);
    const { offsets, rnd } = bladeData(layout);
    g.setAttribute('aBladeOffset', new InstancedBufferAttribute(offsets, 2));
    g.setAttribute('aBladeRand', new InstancedBufferAttribute(rnd, 4));
    g.instanceCount = Math.min(capacity, layout.defaultBlades);

    const material = new MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: DoubleSide });
    material.name = layout.name;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms, heights.uniforms, WIND_UNIFORMS, GROUND_COLOR_UNIFORMS);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GRASS_VERTEX_PARS}`)
        .replace('#include <beginnormal_vertex>', GRASS_NORMAL)
        .replace('#include <begin_vertex>', GRASS_BEGIN);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBladeColor;\nvarying float vBladeGlow;')
        .replace('#include <map_fragment>', 'diffuseColor.rgb = vBladeColor;')
        // Blades are double sided and three flips the normal on back faces: half the blades then
        // faced down and showed as dark specks over the meadow
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifndef FLAT_SHADED\nnormal = normalize(vNormal);\n#endif')
        .replace('#include <lights_fragment_begin>', GRASS_LIGHTS);
    };
    material.customProgramCacheKey = () => 'custom-map-grass-5';
    addHeightFog(material);
    this.mesh = new Mesh(g, material);
    this.mesh.name = layout.name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.userData['losTransparent'] = true;
  }

  setInputs(p: GrassInputs): void {
    const u = this.uniforms;
    u.uGrassPath.value = p.pathMask;
    u.uGrassMask0.value.copy(p.mask[0]);
    u.uGrassMask1.value.copy(p.mask[1]);
    u.uGrassMask2.value.set(0, 0, 0, 0);
    if (p.mask[2]) u.uGrassMask2.value.copy(p.mask[2]);
    u.uGrassBlades.value.forEach((v, k) => {
      const b = p.blades[k] ?? DEFAULT_BLADES;
      v.set(b.height[0], b.height[1], b.width, b.heads ? 1 : 0);
    });
    this.hasGrass = p.mask.some((m) => m.lengthSq() > 0);
    this.showMesh();
  }

  /** Blades drawn around the centre (the quality level); 0 draws no grass */
  setBlades(blades: number): void {
    const count = Math.min(this.layout.capacity, Math.max(0, Math.round(blades)));
    this.enabled = count > 0;
    this.mesh.geometry.instanceCount = count;
    this.uniforms.uGrassWidth.value = count > 0 ? Math.min(1.6, Math.max(1, Math.sqrt(this.layout.defaultBlades / count))) : 1;
    this.showMesh();
  }

  private showMesh(): void {
    this.mesh.visible = this.hasGrass && this.uniforms.uGrassShow.value > 0 && this.enabled;
  }

  /** Footprints and water surfaces (the CoverMap shares the height grid) */
  setCover(cover: CoverMap): void {
    this.uniforms.uGrassCover.value = cover.texture;
    this.uniforms.uGrassRim.value = cover.rim;
    this.uniforms.uGrassHasCover.value = 1;
  }

  /** Share of the layer shown, by the camera's distance (0 hides it) */
  setShow(show: number): void {
    this.uniforms.uGrassShow.value = show;
    this.showMesh();
  }

  /** The tile's centre, in the map group's space */
  setCenter(x: number, z: number): void {
    this.uniforms.uGrassCenter.value.set(x, z);
  }

  /** The layer inside this one (null: none), where this one's blades give way */
  setHole(inner: GrassField | null): void {
    const u = this.uniforms;
    const show = inner?.mesh.visible ? inner.uniforms.uGrassShow.value : 0;
    u.uGrassHoleTile.value = inner && show > 0 ? inner.layout.tile : 0;
    u.uGrassHoleShow.value = show;
    if (inner) u.uGrassHoleCenter.value.copy(inner.uniforms.uGrassCenter.value);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}

const GRASS_VERTEX_PARS = /* glsl */ `
attribute vec2 aBladeOffset;
attribute vec4 aBladeRand;
uniform vec2 uGrassCenter;
uniform float uGrassTile;
uniform float uGrassShow;
uniform vec2 uGrassHoleCenter;
uniform float uGrassHoleTile;
uniform float uGrassHoleShow;
uniform vec2 uGrassSize;
uniform float uGrassGrow;
uniform vec2 uGrassFlat;
uniform float uGrassContrast;
uniform vec4 uGrassMask2;
uniform sampler2D uGrassPath;
uniform vec4 uGrassMask0;
uniform vec4 uGrassMask1;
uniform vec4 uGrassBlades[12];
uniform sampler2D uGrassCover;
uniform sampler2D uGrassRim;
uniform float uGrassHasCover;
uniform float uGrassWidth;
varying vec3 vBladeColor;
varying float vBladeGlow;
${SHADER_NOISE}
${WIND_GLSL}
${GROUND_COLOR_GLSL}
${TERRAIN_HEIGHT_GLSL}

// A repeatable pair of fractions for a cell
vec2 grassHash2(vec2 c) {
  return fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453);
}

// Share of a layer's blades kept at p (grassFade in grass-field.ts): all inside a circle, none from just inside the tile's edge
float grassFade(vec2 p, vec2 center, float tile) {
  return 1.0 - smoothstep(${GRASS_FADE_FROM.toFixed(2)}, ${GRASS_FADE_TO.toFixed(2)}, length(p - center) / (0.5 * tile));
}

// x: 1 where something stands on the ground or water lies over it, 0 on open ground; y: metres to the nearest
// footprint of a building, wall or rock (CoverMap.rim); bilinear over the grid
vec2 grassCovered(vec2 m) {
  if (uGrassHasCover < 0.5) return vec2(0.0, 1e3);
  vec2 g = (m - uTerrainGrid.xy) / uTerrainGrid.z;
  vec2 g0 = floor(g);
  vec2 fr = g - g0;
  ivec2 hi = ivec2(uTerrainGridSize) - 1;
  vec2 c[4];
  for (int k = 0; k < 4; k++) {
    ivec2 p = clamp(ivec2(g0) + ivec2(k & 1, k >> 1), ivec2(0), hi);
    c[k] = vec2(step(0.05, texelFetch(uGrassCover, p, 0).r - texelFetch(uTerrainHeights, p, 0).r), texelFetch(uGrassRim, p, 0).r * ${COVER_RIM.toFixed(1)});
  }
  return mix(mix(c[0], c[1], fr.x), mix(c[2], c[3], fr.x), fr.y);
}
`;

const GRASS_NORMAL = /* glsl */ `
// Normals point up: blades light like the ground they grow from
vec3 objectNormal = vec3(0.0, 1.0, 0.0);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(1.0, 0.0, 0.0);
#endif
`;

const GRASS_BEGIN = /* glsl */ `
// The blade's spot in the world, folded into the tile around the focus
vec2 sceneXZ = uGrassCenter + mod(aBladeOffset - uGrassCenter, vec2(uGrassTile)) - 0.5 * uGrassTile;
// Tufts: blades gather towards the middle of their cell of about 0.8 m, some more than others (the cell's own
// pull), so the meadow shows clumps and gaps instead of an even pile
vec2 tuftCell = floor(sceneXZ / 0.8);
vec2 tuftAt = (tuftCell + 0.2 + 0.6 * grassHash2(tuftCell)) * 0.8;
float tuftPull = 0.35 + 0.35 * grassHash2(tuftCell + 17.0).x;
sceneXZ = mix(sceneXZ, tuftAt, tuftPull * (0.4 + 0.6 * aBladeRand.z));
// Shorter towards the tuft's rim
float tuftRim = clamp(length(sceneXZ - tuftAt) / 0.5, 0.0, 1.0);
vec2 mapPos = vec2(-sceneXZ.x, sceneXZ.y);
// Towards a circle inside the tile: fewer blades (each drops out at its own threshold), and shorter; so
// too as the camera draws away. The far ring grows only where the near blades thin out, so the two
// densities cross over: no seam, no band of both
float fade = grassFade(sceneXZ, uGrassCenter, uGrassTile) * uGrassShow;
if (uGrassHoleTile > 0.0) fade *= 1.0 - grassFade(sceneXZ, uGrassHoleCenter, uGrassHoleTile) * uGrassHoleShow;
float keepEdge = smoothstep(0.0, 0.25, fade - fract(aBladeRand.x * 7.31 + aBladeRand.y * 3.17));
bool onMap = abs(mapPos.x) <= uGroundSize.x * 0.5 && abs(mapPos.y) <= uGroundSize.y * 0.5;
// A dropped blade: every vertex on one point, so its triangles draw nothing. The checks run cheapest
// first and the rest only for blades that stay (a third of the tile lies outside the circle, roads and
// bare ground have none): splat and path mask, then the terrain, then the cover
vec3 transformed = vec3(sceneXZ.x, -1e4, sceneXZ.y);
vBladeColor = vec3(0.0);
vBladeGlow = 0.0;
float grass = 0.0;
vec4 s0 = vec4(0.0);
vec4 s1 = vec4(0.0);
vec4 s2 = vec4(0.0);
if (keepEdge > 0.0 && onMap) {
  vec2 uvMap = mapPos / uGroundSize + 0.5;
  s0 = texture(uGroundSplats, vec3(uvMap, 0.0));
  s1 = texture(uGroundSplats, vec3(uvMap, 1.0));
  float total = dot(s0, vec4(1.0)) + dot(s1, vec4(1.0));
  grass = dot(s0, uGrassMask0) + dot(s1, uGrassMask1);
  // The third splat map only on maps past 8 layers: read behind a uniform branch, one program for both
  if (uGroundLayers > 8.5) {
    s2 = texture(uGroundSplats, vec3(uvMap, 2.0));
    total += dot(s2, vec4(1.0));
    grass += dot(s2, uGrassMask2);
  }
  grass /= max(total, 1e-3);
  vec3 pm = texture2D(uGrassPath, uvMap).rgb;
  grass *= 1.0 - max(pm.r, pm.g);
  // None under a road surface (path-mask.ts covers): where no path is painted, blue is the cover's share between texels
  // (a texel of a big map 1.2 m). Only where all four texels round a blade were covered it reached the whole of a
  // pavement's outer metre, the blades stood on its slabs; past half covered none grows
  if (pm.b > 0.5 && pm.r + pm.g < 0.002) grass = 0.0;
}
float ground0 = 0.0;
// Short towards a wall: 1 from 1.5 m off a footprint, 0 at 0.3 m
float wall = 1.0;
if (grass > 0.45) {
  // No grass on steep ground (forward differences over a metre)
  ground0 = terrainHeightAt(mapPos);
  vec2 rise = vec2(terrainHeightAt(mapPos + vec2(1.0, 0.0)), terrainHeightAt(mapPos + vec2(0.0, 1.0))) - ground0;
  grass *= smoothstep(0.9, 0.5, length(rise));
  // None in footprints of buildings, structures, rocks and pools, nor under water, lava or ice
  if (grass > 0.45) {
    vec2 covered = grassCovered(mapPos);
    grass *= 1.0 - smoothstep(0.25, 0.6, covered.x);
    wall = smoothstep(0.3, 1.5, covered.y + (aBladeRand.y - 0.5) * 0.3);
  }
}
float keep = smoothstep(0.45, 0.8, grass) * keepEdge * (0.4 + 0.6 * fade) * step(0.02, wall);
if (keep > 0.0) {
  // The blades of the grass layers here, by their splat weights (the catalogue's blades): height from and to, width,
  // and how much the layers grow seed heads and flowers
  vec4 kind = vec4(0.0);
  float kw = 0.0;
  for (int k = 0; k < 4; k++) {
    float w0 = s0[k] * uGrassMask0[k];
    float w1 = s1[k] * uGrassMask1[k];
    float w2 = s2[k] * uGrassMask2[k];
    kind += uGrassBlades[k] * w0 + uGrassBlades[k + 4] * w1 + uGrassBlades[k + 8] * w2;
    kw += w0 + w1 + w2;
  }
  kind /= max(kw, 1e-3);
  // Kinds of blades: most plain, some short and broad, and on a meadow some tall with a seed head, a few flowering
  float kindRoll = fract(aBladeRand.w * 13.7 + aBladeRand.x * 5.3);
  float broad = step(kindRoll, 0.14);
  float seedHead = step(0.9, kindRoll) * step(0.5, kind.w);
  float flower = step(0.85, kindRoll) * (1.0 - step(0.9, kindRoll)) * step(0.5, kind.w);
  float bladeHeight = mix(kind.x, kind.y, aBladeRand.y) * keep * wall * (1.0 - 0.35 * broad + 0.5 * seedHead) * (1.0 - 0.35 * tuftRim) * uGrassSize.y;
  // Wider with the distance to the camera (the far ring), so a blade does not thin below a pixel and flicker;
  // the near blades finer at the camera's feet, where a blade is many pixels wide
  float camDist = distance((modelMatrix * vec4(sceneXZ.x, ground0, sceneXZ.y, 1.0)).xyz, cameraPosition);
  float grow = uGrassGrow > 0.0 ? clamp(camDist * uGrassGrow, 1.0, 3.0) : mix(0.6, 1.0, smoothstep(2.0, 18.0, camDist));
  float bladeWidth = kind.z * (0.8 + aBladeRand.z * 0.45) * sqrt(keep) * uGrassWidth * uGrassSize.x * grow * (1.0 + 0.8 * broad - 0.35 * seedHead);
  // Turned at random, bent by its own lean and the wind
  float a = aBladeRand.x * 6.2832;
  vec2 dir = vec2(cos(a), sin(a));
  float t = position.y;
  // Flowers and seed heads swell at the top, where the blade itself is thinnest
  float across = position.x * bladeWidth * (1.0 + (flower * 6.0 + seedHead * 1.8) * smoothstep(0.7, 1.0, t));
  transformed = vec3(dir.x * across, t * bladeHeight, dir.y * across);
  // The map's wind: bowed along it, further where a gust front runs over the meadow, each blade trembling
  float push = windPush(sceneXZ);
  vec2 sway = (uWindDir * (0.08 + 0.5 * push)
    + vec2(sin(uWindTime * 2.7 + aBladeRand.w * 20.0), cos(uWindTime * 2.1 + aBladeRand.w * 13.0)) * 0.05 * (0.3 + push)) * uPlantSway;
  vec2 lean = vec2(-dir.y, dir.x) * (aBladeRand.w - 0.5) * 0.5;
  vec2 bow = (lean + sway) * t * t;
  transformed.xz += bow * bladeHeight;
  // Bent, not stretched
  transformed.y *= inversesqrt(1.0 + dot(bow, bow));
  transformed += vec3(sceneXZ.x, ground0, sceneXZ.y);
  // The ground's colour here as the terrain paints it (its bake from above: layers, variation, the biome's mood),
  // so blades match the ground under them; its texture AO darkens it a little on average
  vec3 ground = groundColorAt(mapPos) * 0.94;
  // Darker root, lighter tip, each blade a little different; the same brightness as the ground on
  // average, and flatter with distance (the far ring's larger blades later), where single blades are below a pixel
  float near = 1.0 - smoothstep(uGrassFlat.x, uGrassFlat.y, length((modelViewMatrix * vec4(transformed, 1.0)).xyz));
  float shade = 1.0 + (mix(0.78, 1.18, smoothstep(0.0, 0.8, t)) * (0.94 + aBladeRand.z * 0.12) - 1.0) * uGrassContrast;
  vec3 dry = mix(vec3(1.0), vec3(1.1, 1.04, 0.82), step(0.85, aBladeRand.y));
  vBladeColor = ground * mix(vec3(1.0), dry * shade, near);
  // Seed heads go straw coloured at the tip; flowers (only on green meadow) white, yellow or violet
  float tip = smoothstep(0.75, 1.0, t) * near;
  float meadow = smoothstep(0.0, 0.04, ground.g - max(ground.r, ground.b));
  float lum = dot(ground, vec3(0.299, 0.587, 0.114));
  vec3 bloom = aBladeRand.z < 0.45 ? vec3(1.0, 0.98, 0.9) : aBladeRand.z < 0.75 ? vec3(1.0, 0.82, 0.25) : vec3(0.62, 0.45, 0.9);
  vBladeColor = mix(vBladeColor, lum * 2.2 * vec3(1.15, 1.0, 0.62), tip * seedHead);
  vBladeColor = mix(vBladeColor, lum * 3.2 * bloom, tip * flower * meadow);
  // Against the sun the blade glows through, most at its thin tip, less where it is many blades deep (far)
  vBladeGlow = smoothstep(0.15, 1.0, t) * near * (1.0 - flower * tip);
}
`;

/**
 * three's light loop with the sun's light shining through the blades
 * (GRASS_GLOW, after its shadow): seen against it, a blade's tip glows in
 * its own colour, a meadow in the evening rims bright
 */
const GRASS_LIGHTS = ShaderChunk.lights_fragment_begin.replace(
  /(vDirectionalShadowCoord\[ i \] \) : 1\.0;\s*#endif\s*)(RE_Direct\()/,
  '$1reflectedLight.directDiffuse += directLight.color * diffuseColor.rgb * vBladeGlow * 0.55 * pow(max(dot(geometryViewDir, -directLight.direction), 0.0), 4.0);\n\t\t$2',
);
