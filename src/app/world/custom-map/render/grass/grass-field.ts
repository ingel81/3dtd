import {
  Color,
  DoubleSide,
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
import type { CoverMap } from '../environment/cover-map';
import { MAX_FAR_GRASS_BLADES, MAX_GRASS_BLADES } from '../../../../three-engine/render-quality';
import { addHeightFog } from '../environment/height-fog';
import { WIND_GLSL, WIND_UNIFORMS } from '../environment/wind';
import { VARIATION_GLSL, variationTexture } from '../terrain/variation-texture';

/**
 * One layer of grass blades (grass-layers.ts keeps a near and a far one): a tile of instanced blades that wraps
 * around the camera's focus (each blade's spot is fixed in the world and
 * folded into the tile), standing on the height grid (fetched in the vertex
 * shader), as dense as the grass layers of the splat there (none on roads,
 * paths and cliffs), swaying in the wind. Towards a circle inside the
 * tile the blades thin out (dithered) and shrink, so neither the tile's
 * square nor the switch to the painted ground is seen. Each blade takes the
 * colour the ground has under it (the splat's layer averages with the
 * terrain's macro variation), so from high up the blades do not show as a
 * patch of their own colour. None grows where the CoverMap's top lies
 * above the ground: in the footprints of buildings, structures and rocks
 * (pools too) and under water, lava and ice.
 *
 * Lit like any standard material (shadows received, fog, grade); blades do
 * not cast shadows. Not part of line of sight.
 */

export interface GrassInputs {
  /** Two splat maps, three on a map with more than 8 layers */
  splat: Texture[];
  pathMask: Texture;
  /** Grass share per splat channel (1 for grass layers, 0 otherwise), one per splat map */
  mask: Vector4[];
  /** Average colour (linear) of the layer in each splat channel, the maps in order */
  colors: Color[];
  width: number;
  depth: number;
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

export class GrassField {
  readonly mesh: Mesh<InstancedBufferGeometry, MeshStandardMaterial>;
  private hasGrass = false;
  /** Splat maps the program reads (two, or three past 8 layers) */
  private splatMaps = 2;
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
    uGrassSplat0: { value: null as Texture | null },
    uGrassSplat1: { value: null as Texture | null },
    uGrassSplat2: { value: null as Texture | null },
    uGrassPath: { value: null as Texture | null },
    uGrassMask0: { value: new Vector4() },
    uGrassMask1: { value: new Vector4() },
    uGrassMask2: { value: new Vector4() },
    uGrassMapSize: { value: new Vector2() },
    uGrassColors: { value: Array.from({ length: 12 }, () => new Color()) },
    uGrassCover: { value: null as Texture | null },
    uGrassHasCover: { value: 0 },
    /** Wider blades at a lower density (setBlades), so the meadow keeps its cover */
    uGrassWidth: { value: 1 },
    uVariation: { value: variationTexture() as Texture },
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
    const offsets = new Float32Array(capacity * 2);
    const rnd = new Float32Array(capacity * 4);
    let s = layout.seed;
    const next = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < capacity; i++) {
      offsets[i * 2] = next() * tile;
      offsets[i * 2 + 1] = next() * tile;
      rnd.set([next(), next(), next(), next()], i * 4);
    }
    g.setAttribute('aBladeOffset', new InstancedBufferAttribute(offsets, 2));
    g.setAttribute('aBladeRand', new InstancedBufferAttribute(rnd, 4));
    g.instanceCount = Math.min(capacity, layout.defaultBlades);

    const material = new MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: DoubleSide });
    material.name = layout.name;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms, heights.uniforms, WIND_UNIFORMS);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n#define GRASS_SPLATS ${this.splatMaps * 4}\n${GRASS_VERTEX_PARS}`)
        .replace('#include <beginnormal_vertex>', GRASS_NORMAL)
        .replace('#include <begin_vertex>', GRASS_BEGIN);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBladeColor;')
        .replace('#include <map_fragment>', 'diffuseColor.rgb = vBladeColor;')
        // Blades are double sided and three flips the normal on back faces: half the blades then
        // faced down and showed as dark specks over the meadow
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    };
    material.customProgramCacheKey = () => `custom-map-grass-2-${this.splatMaps}`;
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
    u.uGrassSplat0.value = p.splat[0];
    u.uGrassSplat1.value = p.splat[1];
    u.uGrassSplat2.value = p.splat[2] ?? null;
    u.uGrassPath.value = p.pathMask;
    u.uGrassMask0.value.copy(p.mask[0]);
    u.uGrassMask1.value.copy(p.mask[1]);
    u.uGrassMask2.value.set(0, 0, 0, 0);
    if (p.mask[2]) u.uGrassMask2.value.copy(p.mask[2]);
    // The third map is read by a program of its own, only on maps that have it
    if (this.splatMaps !== p.splat.length) {
      this.splatMaps = p.splat.length;
      this.mesh.material.needsUpdate = true;
    }
    u.uGrassColors.value.forEach((c, k) => c.copy(p.colors[k] ?? c.setRGB(0.2, 0.3, 0.1)));
    u.uGrassMapSize.value.set(p.width, p.depth);
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
uniform sampler2D uGrassSplat0;
uniform sampler2D uGrassSplat1;
#if GRASS_SPLATS > 8
uniform sampler2D uGrassSplat2;
uniform vec4 uGrassMask2;
#endif
uniform sampler2D uGrassPath;
uniform vec4 uGrassMask0;
uniform vec4 uGrassMask1;
uniform vec2 uGrassMapSize;
uniform vec3 uGrassColors[12];
uniform sampler2D uGrassCover;
uniform float uGrassHasCover;
uniform float uGrassWidth;
varying vec3 vBladeColor;
${SHADER_NOISE}
${WIND_GLSL}
${VARIATION_GLSL}
${TERRAIN_HEIGHT_GLSL}

// Share of a layer's blades kept at p (grassFade in grass-field.ts): all inside a circle, none from just inside the tile's edge
float grassFade(vec2 p, vec2 center, float tile) {
  return 1.0 - smoothstep(${GRASS_FADE_FROM.toFixed(2)}, ${GRASS_FADE_TO.toFixed(2)}, length(p - center) / (0.5 * tile));
}

// 1 where something stands on the ground or water lies over it, 0 on open ground; bilinear over the grid
float grassCovered(vec2 m) {
  if (uGrassHasCover < 0.5) return 0.0;
  vec2 g = (m - uTerrainGrid.xy) / uTerrainGrid.z;
  vec2 g0 = floor(g);
  vec2 fr = g - g0;
  ivec2 hi = ivec2(uTerrainGridSize) - 1;
  float c[4];
  for (int k = 0; k < 4; k++) {
    ivec2 p = clamp(ivec2(g0) + ivec2(k & 1, k >> 1), ivec2(0), hi);
    c[k] = step(0.05, texelFetch(uGrassCover, p, 0).r - texelFetch(uTerrainHeights, p, 0).r);
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
vec2 mapPos = vec2(-sceneXZ.x, sceneXZ.y);
// Towards a circle inside the tile: fewer blades (each drops out at its own threshold), and shorter; so
// too as the camera draws away. The far ring grows only where the near blades thin out, so the two
// densities cross over: no seam, no band of both
float fade = grassFade(sceneXZ, uGrassCenter, uGrassTile) * uGrassShow;
if (uGrassHoleTile > 0.0) fade *= 1.0 - grassFade(sceneXZ, uGrassHoleCenter, uGrassHoleTile) * uGrassHoleShow;
float keepEdge = smoothstep(0.0, 0.25, fade - fract(aBladeRand.x * 7.31 + aBladeRand.y * 3.17));
bool onMap = abs(mapPos.x) <= uGrassMapSize.x * 0.5 && abs(mapPos.y) <= uGrassMapSize.y * 0.5;
// A dropped blade: every vertex on one point, so its triangles draw nothing. The checks run cheapest
// first and the rest only for blades that stay (a third of the tile lies outside the circle, roads and
// bare ground have none): splat and path mask, then the terrain, then the cover
vec3 transformed = vec3(sceneXZ.x, -1e4, sceneXZ.y);
vBladeColor = vec3(0.0);
float grass = 0.0;
vec4 s0 = vec4(0.0);
vec4 s1 = vec4(0.0);
#if GRASS_SPLATS > 8
vec4 s2 = vec4(0.0);
#endif
if (keepEdge > 0.0 && onMap) {
  vec2 uvMap = mapPos / uGrassMapSize + 0.5;
  s0 = texture2D(uGrassSplat0, uvMap);
  s1 = texture2D(uGrassSplat1, uvMap);
  float total = dot(s0, vec4(1.0)) + dot(s1, vec4(1.0));
  grass = dot(s0, uGrassMask0) + dot(s1, uGrassMask1);
#if GRASS_SPLATS > 8
  s2 = texture2D(uGrassSplat2, uvMap);
  total += dot(s2, vec4(1.0));
  grass += dot(s2, uGrassMask2);
#endif
  grass /= max(total, 1e-3);
  vec2 pm = texture2D(uGrassPath, uvMap).rg;
  grass *= 1.0 - max(pm.r, pm.g);
}
float ground0 = 0.0;
if (grass > 0.45) {
  // No grass on steep ground (forward differences over a metre)
  ground0 = terrainHeightAt(mapPos);
  vec2 rise = vec2(terrainHeightAt(mapPos + vec2(1.0, 0.0)), terrainHeightAt(mapPos + vec2(0.0, 1.0))) - ground0;
  grass *= smoothstep(0.9, 0.5, length(rise));
  // None in footprints of buildings, structures, rocks and pools, nor under water, lava or ice
  if (grass > 0.45) grass *= 1.0 - smoothstep(0.25, 0.6, grassCovered(mapPos));
}
float keep = smoothstep(0.45, 0.8, grass) * keepEdge * (0.4 + 0.6 * fade);
if (keep > 0.0) {
  // Kinds of blades: most plain, some short and broad, some tall with a seed head, a few flowering
  float kindRoll = fract(aBladeRand.w * 13.7 + aBladeRand.x * 5.3);
  float broad = step(kindRoll, 0.14);
  float seedHead = step(0.9, kindRoll);
  float flower = step(0.85, kindRoll) * (1.0 - seedHead);
  float bladeHeight = (0.35 + aBladeRand.y * 0.45) * keep * (1.0 - 0.35 * broad + 0.5 * seedHead) * uGrassSize.y;
  // Wider with the distance to the camera (the far ring), so a blade does not thin below a pixel and flicker
  float grow = uGrassGrow > 0.0 ? clamp(distance((modelMatrix * vec4(sceneXZ.x, ground0, sceneXZ.y, 1.0)).xyz, cameraPosition) * uGrassGrow, 1.0, 3.0) : 1.0;
  float bladeWidth = (0.07 + aBladeRand.z * 0.05) * sqrt(keep) * uGrassWidth * uGrassSize.x * grow * (1.0 + 0.8 * broad - 0.35 * seedHead);
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
  // The ground's colour here: the grass layers' averages by splat weight, with the terrain's macro
  // variation and grading (terrain-material.ts), so blades match the painted ground under them
  vec3 ground = vec3(0.0);
  float gw = 0.0;
  for (int k = 0; k < 4; k++) {
    ground += uGrassColors[k] * s0[k] * uGrassMask0[k] + uGrassColors[k + 4] * s1[k] * uGrassMask1[k];
    gw += s0[k] * uGrassMask0[k] + s1[k] * uGrassMask1[k];
#if GRASS_SPLATS > 8
    ground += uGrassColors[k + 8] * s2[k] * uGrassMask2[k];
    gw += s2[k] * uGrassMask2[k];
#endif
  }
  ground /= max(gw, 1e-3);
  // The terrain's macro variation from the same texture (terrain-material.ts)
  vec4 varCoarse = variationAt(mapPos);
  float n1 = varCoarse.r;
  float n2 = varCoarse.g;
  float n3 = varCoarse.b;
  ground *= mix(0.86, 1.1, n1 * 0.6 + n2 * 0.4) * mix(0.93, 1.06, n3);
  ground = mix(ground, ground * vec3(1.1, 1.04, 0.8), smoothstep(0.5, 0.85, n2) * 0.5);
  ground = mix(ground, ground * vec3(0.84, 0.92, 0.95), smoothstep(0.45, 0.15, n1) * 0.6);
  ground *= mix(vec3(1.0), vec3(0.86, 1.04, 0.92), smoothstep(0.0, 0.08, ground.g - max(ground.r, ground.b)));
  ground = mix(vec3(dot(ground, vec3(0.299, 0.587, 0.114))), ground, 0.94);
  // The ground's texture AO darkens it a little on average
  ground *= 0.94;
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
}
`;
