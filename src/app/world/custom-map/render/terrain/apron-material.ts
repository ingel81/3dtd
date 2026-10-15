import { Color, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';
import type { MapBiome } from '../../map-document';
import { TerrainMaterial, type TerrainMaterialParams } from './terrain-material';

/**
 * How the backdrop range round a map of a look reads from afar: rock tint,
 * where snow lies (share of the range's height it starts at, and how much),
 * dust or regolith on the gentle slopes (colour and amount), how much the
 * crests lighten, and how much of the haze over land beyond the border the
 * range's upper flanks shed (0 none, 1 all: the peaks rise out of the haze
 * that the foothills sink into).
 */
export interface ApronLook {
  rock: string;
  snowFrom: number;
  snow: number;
  dust: string;
  dustAmount: number;
  crest: number;
  clear: number;
}

const NO_DUST = { dust: '#808080', dustAmount: 0 };

export const APRON_LOOK: Record<MapBiome, ApronLook> = {
  temperate: { rock: '#d8d4cc', snowFrom: 2, snow: 0, ...NO_DUST, crest: 0.1, clear: 0.4 },
  mountain: { rock: '#d0ccc6', snowFrom: 0.5, snow: 1, ...NO_DUST, crest: 0.12, clear: 0.45 },
  arctic: { rock: '#b8c0cc', snowFrom: 0.05, snow: 1, ...NO_DUST, crest: 0.08, clear: 0.4 },
  desert: { rock: '#f0d2a8', snowFrom: 2, snow: 0, dust: '#d8b07a', dustAmount: 0.35, crest: 0.14, clear: 0.4 },
  swamp: { rock: '#a8a89a', snowFrom: 2, snow: 0, ...NO_DUST, crest: 0.05, clear: 0.2 },
  city: { rock: '#c8c4bc', snowFrom: 2, snow: 0, ...NO_DUST, crest: 0.08, clear: 0.3 },
  hell: { rock: '#6e5a52', snowFrom: 2, snow: 0, dust: '#3a3230', dustAmount: 0.4, crest: 0, clear: 0.35 },
  apocalypse: { rock: '#bab2a6', snowFrom: 2, snow: 0, dust: '#8a8070', dustAmount: 0.3, crest: 0.06, clear: 0.35 },
  moon: { rock: '#b4b4b4', snowFrom: 2, snow: 0, dust: '#a6a6a2', dustAmount: 0.55, crest: 0.18, clear: 0.3 },
  mars: { rock: '#e0a088', snowFrom: 2, snow: 0, dust: '#c08458', dustAmount: 0.5, crest: 0.1, clear: 0.4 },
};

/**
 * The material of the land beyond the border (terrain-apron.ts): the
 * terrain's material, sharing its uniforms (layers, the border's paint,
 * shadows, morphing), with the backdrop range painted as distant mountains
 * on top of the border's ground. From 150 m beyond the border:
 * - rock on the steep flanks (the cliff material, two side planes and the
 *   top at six times its scale, so its grain shows near and blurs far as
 *   its mip levels go), in strata bent by noise;
 * - gullies down the fall line that bend the normal and darken the furrows,
 *   so the light shades the flanks in ribs instead of flat facets;
 * - blots of colour and brightness hundreds of metres across against the
 *   ground's repetition, crests lighter, the look's snow above its line on
 *   the gentler slopes, its dust or regolith on the gentle ones (ApronLook);
 * - the upper flanks shed part of the haze over land beyond the border
 *   (height-fog.ts, FOG_BEYOND_KEEP): the range reads as mountains, its foot
 *   sinks into the haze as before.
 * One program more than the terrain, no draw call more: the apron is one mesh.
 */
export class ApronMaterial extends TerrainMaterial {
  readonly apronUniforms = {
    /** Height the range rises from (the apron's hills) and the range's height, metres */
    uApronBase: { value: 0 },
    uApronHeight: { value: 1 },
    uApronRock: { value: new Color(1, 1, 1) },
    /** Snow line (share of the range's height) and amount */
    uApronSnow: { value: [2, 0] as [number, number] },
    uApronDust: { value: new Color() },
    uApronDustAmount: { value: 0 },
    uApronCrest: { value: 0 },
    uApronClear: { value: 0 },
  };

  constructor(params: TerrainMaterialParams, ground: TerrainMaterial) {
    super(params);
    this.name = 'custom-map-apron';
    // The ground's uniforms themselves: what the layer sets on its material (paint, splat, time) holds here too
    Object.assign(this.terrainUniforms, ground.terrainUniforms);
    const base = this.onBeforeCompile;
    this.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => {
      base.call(this, shader, renderer);
      Object.assign(shader.uniforms, this.apronUniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${APRON_PARS}`)
        .replace('diffuseColor.rgb = albedo;', `${APRON_PAINT}\ndiffuseColor.rgb = albedo;`);
    };
  }

  /** The range's foot and height (ApronProfile.base, BACKDROP_HEIGHT) and the look's paint */
  setRange(base: number, height: number, look: ApronLook): void {
    const u = this.apronUniforms;
    u.uApronBase.value = base;
    u.uApronHeight.value = Math.max(1, height);
    u.uApronRock.value.set(look.rock);
    u.uApronSnow.value = [look.snowFrom, look.snow];
    u.uApronDust.value.set(look.dust);
    u.uApronDustAmount.value = look.dustAmount;
    u.uApronCrest.value = look.crest;
    u.uApronClear.value = height > 0 ? look.clear : 0;
  }

  override customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}-apron`;
  }
}

const APRON_PARS = /* glsl */ `
uniform float uApronBase;
uniform float uApronHeight;
uniform vec3 uApronRock;
uniform vec2 uApronSnow;
uniform vec3 uApronDust;
uniform float uApronDustAmount;
uniform float uApronCrest;
uniform float uApronClear;
// Share of the haze over land beyond the border this fragment keeps (height-fog.ts)
float apronHazeKeep = 1.0;
#define FOG_BEYOND_KEEP apronHazeKeep
`;

// Runs at the end of the terrain's sampling (TERRAIN_SAMPLE), before the albedo is handed over
const APRON_PAINT = /* glsl */ `
float rangeShare = smoothstep(150.0, 420.0, max(edgeDist.x, edgeDist.y));
// Metres of ground per pixel: the gullies fade out before they alias into stripes far away
float apronFootprint = max(length(dPosX), length(dPosY));
if (rangeShare > 0.0) {
  float rise = clamp((tPos.y - uApronBase) / uApronHeight, 0.0, 1.2);
  // Blots over hundreds of metres (no derivatives inside the branch: one mip level, the blots are wide)
  vec4 blot = textureLod(uVariation, mapPos / 4000.0 + 0.13, 0.0);
  vec4 blotMid = textureLod(uVariation, mapPos / 1400.0 + 0.61, 0.0);
  // Gullies along the fall line: narrow across it, long down it
  vec2 fall = normalize(vec2(-nGeo.x, nGeo.z) + 1e-4);
  vec2 across = vec2(-fall.y, fall.x);
  vec2 gq = vec2(dot(mapPos, across) * 0.045, dot(mapPos, fall) * 0.008);
  // Each octave fades towards its average once a pixel covers a sixth of its period across
  float o1 = 1.0 - smoothstep(2.5, 6.0, apronFootprint);
  float o2 = 1.0 - smoothstep(1.0, 2.5, apronFootprint);
  float g0 = 0.5 + (valueNoise(gq) - 0.5) * 0.65 * o1 + (valueNoise(gq * 2.7 + 5.3) - 0.5) * 0.35 * o2;
  float g1 = 0.5 + (valueNoise(gq + vec2(0.12, 0.0)) - 0.5) * 0.65 * o1 + (valueNoise(gq * 2.7 + 5.3 + vec2(0.324, 0.0)) - 0.5) * 0.35 * o2;
  float steep = 1.0 - smoothstep(0.55, 0.95, nGeo.y);
  // Bend the normal across the gully (map across -> scene: x mirrored)
  vec3 acrossScene = vec3(-across.x, 0.0, across.y);
  vec3 nRange = safeNormalize(terrainNormal + acrossScene * (g1 - g0) * 9.0 * (0.25 + steep) * rangeShare, terrainNormal);
  float slope = 1.0 - nRange.y;

  // The rock: the cliff material at six times its scale, the dominant side plane and the top
  int rockLayer = max(uCliffLayer, 0);
  float rs = uInvScale[rockLayer] / 6.0;
  bool onX = tri.x > tri.z;
  vec2 sideUv = onX ? sideX : sideZ;
  vec2 sideDx = onX ? sideXdx : sideZdx;
  vec2 sideDy = onX ? sideXdy : sideZdy;
  vec3 rockSide = textureGrad(uColorArray, vec3(sideUv * rs, float(rockLayer)), sideDx * rs, sideDy * rs).rgb;
  vec3 rockTop = textureGrad(uColorArray, vec3(tPos.xz * rs, float(rockLayer)), dPosX * rs, dPosY * rs).rgb;
  vec3 rockTex = mix(rockTop, rockSide, smoothstep(0.15, 0.5, slope));
  vec3 rockAvg = uAverage[rockLayer];
  // The texture's grain as brightness around its average: near it shows, far its mips blur to the average
  float grain = clamp(dot(rockTex, vec3(0.333)) / max(dot(rockAvg, vec3(0.333)), 0.02), 0.55, 1.6);
  // Strata along the height, bent by noise, in patches
  float warp = (blotMid.r - 0.5) * 60.0 + (g0 - 0.5) * 12.0;
  float strata = mix(0.82, 1.1, smoothstep(0.3, 0.7, valueNoise(vec2((tPos.y + warp) * 0.07, 2.9))));
  // On the steep faces only: on gentle hills height bands read as contour lines
  strata = mix(1.0, strata, smoothstep(0.35, 0.65, blot.b) * steep);
  vec3 rock = rockAvg * uApronRock * mix(1.0, grain, 0.8) * strata;

  // Rock where it is steep (and on the highest crests), the border's ground where it is gentle
  float rockShare = smoothstep(0.16, 0.38, slope + (blotMid.g - 0.5) * 0.22 + (g0 - 0.5) * 0.12);
  vec3 ground = albedo * mix(1.0, grain, 0.35);
  vec3 col = mix(ground, rock, rockShare);
  // Dust or regolith settles on the gentle slopes, thicker low down
  float dust = uApronDustAmount * smoothstep(0.32, 0.08, slope) * (0.6 + 0.4 * blot.g) * (1.0 - 0.5 * rise);
  col = mix(col, uApronDust * mix(1.0, grain, 0.25), dust);
  // Snow above the look's line, not on the steepest faces, ragged by noise; a little in the gullies' heads
  float snowLine = uApronSnow.x + (blotMid.b - 0.5) * 0.25 - (g0 - 0.5) * 0.12;
  float snow = smoothstep(snowLine, snowLine + 0.14, rise) * (1.0 - smoothstep(0.3, 0.5, slope)) * uApronSnow.y;
  col = mix(col, vec3(0.86, 0.9, 0.95) * mix(0.92, 1.04, g0), snow);
  // Large blots of brightness and hue against the repetition
  col *= mix(0.8, 1.14, blot.r) * mix(0.93, 1.06, blotMid.r);
  col = mix(col, col * vec3(1.06, 1.0, 0.9), smoothstep(0.55, 0.8, blot.g) * 0.5);
  // Crests catch light, furrows hold shade
  col *= 1.0 + uApronCrest * smoothstep(0.45, 1.0, rise) * (1.0 - snow);
  float furrow = smoothstep(0.45, 0.15, g0) * (0.3 + steep * 0.7);

  albedo = mix(albedo, col, rangeShare);
  terrainNormal = safeNormalize(mix(terrainNormal, nRange, rangeShare), terrainNormal);
  terrainAO *= 1.0 - 0.35 * furrow * rangeShare;
  terrainRough = mix(terrainRough, mix(terrainRough, 0.6, snow), rangeShare);
  // The upper flanks rise out of the haze the foothills sink into
  apronHazeKeep = 1.0 - uApronClear * smoothstep(0.08, 0.7, rise) * rangeShare;
}
`;
