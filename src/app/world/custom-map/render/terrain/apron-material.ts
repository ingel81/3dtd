import { Color, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';
import type { MapBiome } from '../../map-document';
import { TerrainMaterial, type TerrainMaterialParams } from './terrain-material';

/**
 * How the backdrop range round a map of a look reads from afar: rock tint,
 * where snow lies (share of the range's height it starts at, and how much),
 * dust or regolith on the gentle slopes (colour and amount), how much
 * the crests lighten, and the land in front of the range: how much of it
 * is farmland (a patchwork of fields between hedges) and how much wood
 * (dark canopy in blots, its colour).
 */
export interface ApronLook {
  rock: string;
  snowFrom: number;
  snow: number;
  dust: string;
  dustAmount: number;
  crest: number;
  /** 0..1 rock strata on the cliffs: none where the rock is regolith, sand or dust (moon, mars, desert) */
  strata: number;
  fields: number;
  wood: number;
  woodColor: string;
}

const NO_DUST = { dust: '#808080', dustAmount: 0 };

export const APRON_LOOK: Record<MapBiome, ApronLook> = {
  temperate: { rock: '#d8d4cc', snowFrom: 2, snow: 0, ...NO_DUST, crest: 0.1, strata: 1, fields: 0.75, wood: 0.45, woodColor: '#3a5a2e' },
  mountain: { rock: '#d0ccc6', snowFrom: 0.5, snow: 1, ...NO_DUST, crest: 0.12, strata: 1, fields: 0.3, wood: 0.6, woodColor: '#31502f' },
  arctic: { rock: '#b8c0cc', snowFrom: 0.05, snow: 1, ...NO_DUST, crest: 0.08, strata: 1, fields: 0, wood: 0.45, woodColor: '#2c4434' },
  desert: { rock: '#f0d2a8', snowFrom: 2, snow: 0, dust: '#d8b07a', dustAmount: 0.35, crest: 0.14, strata: 0, fields: 0, wood: 0, woodColor: '#000000' },
  swamp: { rock: '#a8a89a', snowFrom: 2, snow: 0, ...NO_DUST, crest: 0.05, strata: 1, fields: 0, wood: 0.6, woodColor: '#34402a' },
  city: { rock: '#c8c4bc', snowFrom: 2, snow: 0, ...NO_DUST, crest: 0.08, strata: 1, fields: 0.55, wood: 0.3, woodColor: '#3a5632' },
  hell: { rock: '#6e5a52', snowFrom: 2, snow: 0, dust: '#3a3230', dustAmount: 0.4, crest: 0, strata: 1, fields: 0, wood: 0, woodColor: '#000000' },
  apocalypse: { rock: '#bab2a6', snowFrom: 2, snow: 0, dust: '#8a8070', dustAmount: 0.3, crest: 0.06, strata: 1, fields: 0.35, wood: 0.25, woodColor: '#4a4436' },
  moon: { rock: '#b4b4b4', snowFrom: 2, snow: 0, dust: '#a6a6a2', dustAmount: 0.55, crest: 0.18, strata: 0, fields: 0, wood: 0, woodColor: '#000000' },
  mars: { rock: '#e0a088', snowFrom: 2, snow: 0, dust: '#c08458', dustAmount: 0.5, crest: 0.1, strata: 0, fields: 0, wood: 0, woodColor: '#000000' },
};

/**
 * The material of the land beyond the border (terrain-apron.ts): the
 * terrain's material, sharing its uniforms (layers, the border's paint,
 * shadows, morphing), with the backdrop range painted as distant mountains
 * on top of the border's ground. From 150 m beyond the border:
 * - rock on the steep flanks (the cliff material, two side planes and the
 *   top at six times its scale, so its grain shows near and blurs far as
 *   its mip levels go), in strata bent by noise on the cliffs (ApronLook.strata);
 * - gullies down the fall line that bend the normal and darken the furrows,
 *   so the light shades the flanks in ribs instead of flat facets;
 * - blots of colour and brightness hundreds of metres across against the
 *   ground's repetition, crests lighter, the look's snow above its line on
 *   the gentler slopes, its dust or regolith on the gentle ones (ApronLook).
 * The haze over it is the distance's, as over any land (height-fog.ts).
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
    uApronStrata: { value: 0 },
    /** The land in front of the range: farmland and wood (amounts 0..1), the wood's colour */
    uApronLand: { value: [0, 0] as [number, number] },
    uApronWood: { value: new Color() },
    /** The border's natural ground: each splat channel's mean weight over the border (apron-paint.ts) */
    uApronMean: { value: new Float32Array(12) },
  };

  constructor(params: TerrainMaterialParams, ground: TerrainMaterial) {
    super(params);
    this.name = 'custom-map-apron';
    // Its program carries the border's paint (TERRAIN_SAMPLE), the ground's the openings cut into it
    this.defines = { ...this.defines, TERRAIN_APRON: '' };
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
    u.uApronStrata.value = look.strata;
    u.uApronLand.value = [look.fields, look.wood];
    u.uApronWood.value.set(look.woodColor);
  }

  /** The mean of the border's paint per splat channel (apronPaintWeights, MAX_GROUND_LAYERS per sample) */
  setPaintMean(weights: Float32Array | null): void {
    const mean = this.apronUniforms.uApronMean.value;
    mean.fill(0);
    if (!weights) return;
    const n = weights.length / mean.length;
    for (let s = 0; s < n; s++) for (let k = 0; k < mean.length; k++) mean[k] += weights[s * mean.length + k] / n;
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
uniform float uApronStrata;
uniform vec2 uApronLand;
uniform vec3 uApronWood;
uniform float uApronMean[12];
`;

/**
 * The land in front of the range, from 30 m beyond the border (the trees
 * mirrored onto the apron stand in the first 40, edge-trees.ts): farmland
 * as a patchwork of fields, turned and sized by region, each its own crop
 * (ripe, ploughed, green, fallow) at the border ground's brightness, its
 * furrows near, hedges along its edges at least a pixel wide; wood in blots
 * of dark canopy, lumpy with crowns near, a darker rim. Only on gentle
 * ground: the range's flanks keep their rock. A map without either (moon,
 * desert) keeps the border's ground and the range's blots.
 */
const APRON_LAND = /* glsl */ `
// The border's paint carried straight out draws streaks off the map; from some 100 m out the land settles into
// the mean of the border's natural ground at the brightness the terrain gave it here, varied by blots
float settle = smoothstep(80.0, 380.0, beyondBorder);
if (settle > 0.0) {
  vec3 meanGround = vec3(0.0);
  float meanSum = 0.0;
  for (int k = 0; k < TERRAIN_SPLATS; k++) {
    int layer = uSplatLayer[k];
    if (layer >= 0) {
      meanGround += uApronMean[k] * uAverage[layer];
      meanSum += uApronMean[k];
    }
  }
  if (meanSum > 0.01) {
    meanGround /= meanSum;
    vec4 settleBlot = textureLod(uVariation, mapPos / 1100.0 + 0.27, 0.0);
    float shade = mix(0.84, 1.12, settleBlot.r) * mix(0.95, 1.05, settleBlot.b);
    // The ground's mood and macro tint kept as the ratio of the albedo here to its own layers' average
    albedo = mix(albedo, meanGround * shade * clamp(dot(albedo, vec3(0.333)) / max(dot(accAvg, vec3(0.333)), 0.02), 0.6, 1.5), settle);
  }
}
// Fields and wood settle into the plain ground once a pixel spans some ten metres (far land seen flat)
float landShare = smoothstep(30.0, 160.0, beyondBorder) * (1.0 - smoothstep(0.2, 0.4, 1.0 - nGeo.y))
  * (1.0 - smoothstep(6.0, 14.0, apronFootprint))
  // and none on a sea's floor
  * smoothstep(uWaterLevel - 0.5, uWaterLevel + 1.0, tPos.y)
  * (1.0 - smoothstep(0.35, 0.6, (tPos.y - uApronBase) / uApronHeight));
if (landShare > 0.0 && uApronLand.x + uApronLand.y > 0.0) {
  float groundLum = max(dot(albedo, vec3(0.2126, 0.7152, 0.0722)), 0.01);
  vec4 region = textureLod(uVariation, mapPos / 2600.0 + 0.37, 0.0);
  // Fields: a grid turned and sized per block of farmland (some 700 m), each cell a crop by its hash; a block's
  // edge is a hedge like a field's
  vec2 block = floor(mapPos / 700.0 + 0.5);
  float blockHash = fract(sin(dot(block, vec2(41.3, 289.1))) * 43758.5453);
  float turn = blockHash * 3.1416;
  vec2 fq = mat2(cos(turn), sin(turn), -sin(turn), cos(turn)) * mapPos;
  vec2 cellSize = vec2(55.0, 120.0) * mix(0.75, 1.35, fract(blockHash * 7.13));
  vec2 cellAt = fq / cellSize + blockHash * 13.0;
  vec2 cell = floor(cellAt) + block * 97.0;
  vec2 inCell = fract(cellAt);
  vec2 blockAt = abs(fract(mapPos / 700.0 + 0.5) - 0.5) * 700.0;
  float crop = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  float tone = fract(sin(dot(cell, vec2(269.5, 183.3))) * 43758.5453);
  vec3 cropColor = crop < 0.28 ? vec3(0.86, 0.74, 0.4) : crop < 0.42 ? vec3(0.42, 0.33, 0.22) : crop < 0.78 ? vec3(0.42, 0.6, 0.26) : vec3(0.62, 0.64, 0.38);
  // At the border ground's brightness (ripe a little lighter, ploughed earth darker), lighter or darker per field
  float cropLum = crop < 0.28 ? 1.12 : crop < 0.42 ? 0.72 : 1.0;
  cropColor *= groundLum / dot(cropColor, vec3(0.2126, 0.7152, 0.0722)) * cropLum * mix(0.85, 1.12, tone);
  // Furrows along the field, three metres apart, gone before they alias
  float furrows = 1.0 - smoothstep(0.6, 1.6, apronFootprint);
  cropColor *= 1.0 - 0.12 * furrows * smoothstep(0.3, 0.7, abs(fract(inCell.x * cellSize.x / 3.0) - 0.5) * 2.0) * step(crop, 0.42);
  // Hedges along the edges: dark, at least a pixel wide
  vec2 toEdge = min(inCell, 1.0 - inCell) * cellSize;
  float hedgeWidth = max(2.5, apronFootprint * 1.2);
  // Far off, where a hedge is a pixel wide, it shows as a faint line, not a net over the land
  float hedge = (1.0 - smoothstep(hedgeWidth * 0.5, hedgeWidth, min(min(toEdge.x, toEdge.y), 350.0 - max(blockAt.x, blockAt.y))))
    * mix(0.8, 0.1, smoothstep(1.0, 3.0, apronFootprint));
  // Fields lie on level ground only, wood climbs the slopes below the range's upper flanks
  float farmland = smoothstep(0.5 - uApronLand.x * 0.5, 0.62 - uApronLand.x * 0.5, region.b) * (1.0 - smoothstep(0.04, 0.1, 1.0 - nGeo.y)) * step(1e-3, uApronLand.x);
  vec3 land = mix(albedo, mix(cropColor, mix(cropColor * 0.55, uApronWood, 0.5), hedge), farmland);
  // Wood: blots of canopy over the fields and the open ground
  float woodBlot = textureLod(uVariation, mapPos / 760.0 + 0.83, 0.0).g * 0.7 + region.a * 0.3;
  float woodAt = 0.74 - uApronLand.y * 0.28;
  float crowns = 1.0 - smoothstep(1.5, 4.0, apronFootprint);
  float canopy = 0.5 + (valueNoise(mapPos * 0.14) - 0.5) * crowns + (valueNoise(mapPos * 0.37 + 3.1) - 0.5) * 0.5 * crowns;
  // The wood's edge frays over some 20 m: copses run out of it, glades cut in
  woodBlot += (valueNoise(mapPos * 0.045 + 1.7) - 0.5) * 0.06;
  float wood = smoothstep(woodAt, woodAt + 0.05, woodBlot) * step(1e-3, uApronLand.y);
  float rim = wood * (1.0 - smoothstep(woodAt + 0.05, woodAt + 0.12, woodBlot));
  // Stands of trees some 25 m across, lighter and darker, at every distance: one dark shade read as a pond
  float stands = valueNoise(mapPos * 0.04 + 5.3);
  vec3 woodColor = mix(uApronWood, albedo, 0.25) * mix(0.7, 1.2, canopy) * mix(0.82, 1.15, stands) * (1.0 - 0.25 * rim);
  land = mix(land, woodColor, wood);
  albedo = mix(albedo, land, landShare);
  terrainAO *= 1.0 - landShare * (wood * (0.25 + 0.3 * (1.0 - canopy)) + farmland * hedge * 0.3);
  terrainRough = mix(terrainRough, 0.92, landShare * wood);
}
`;

// Runs at the end of the terrain's sampling (TERRAIN_SAMPLE), before the albedo is handed over
const APRON_PAINT = /* glsl */ `
float beyondBorder = max(edgeDist.x, edgeDist.y);
float rangeShare = smoothstep(150.0, 420.0, beyondBorder);
// Metres of ground per pixel: the gullies fade out before they alias into stripes far away
float apronFootprint = max(length(dPosX), length(dPosY));
// Metres of height per pixel: on a steep flank far less ground than height passes a pixel
float apronHeightPerPixel = fwidth(tPos.y);
${APRON_LAND}
if (rangeShare > 0.0) {
  float rise = clamp((tPos.y - uApronBase) / uApronHeight, 0.0, 1.2);
  // Blots over hundreds of metres (no derivatives inside the branch: one mip level, the blots are wide)
  vec4 blot = textureLod(uVariation, mapPos / 4000.0 + 0.13, 0.0);
  vec4 blotMid = textureLod(uVariation, mapPos / 1400.0 + 0.61, 0.0);
  // Gullies down the range, away from the map (the range runs along the border, its fall line across it): narrow
  // across, long down. Turned by the facets' normals instead, the pattern's coordinates (kilometres from the
  // centre) swung by a fraction of a degree across each facet and swirled into marble
  float cornerBlend = smoothstep(-60.0, 60.0, edgeDist.x - edgeDist.y);
  vec2 fall = normalize(vec2(sign(mapPos.x) * cornerBlend, sign(mapPos.y) * (1.0 - cornerBlend)) + 1e-4);
  vec2 across = vec2(-fall.y, fall.x);
  vec2 gq = vec2(dot(mapPos, across) * 0.045, dot(mapPos, fall) * 0.008);
  // Each octave fades towards its average once a pixel covers a sixth of its period across
  // (on a steep flank a pixel spans far more height than ground: the larger of the two counts)
  float pixelSpan = max(apronFootprint, apronHeightPerPixel);
  float o1 = 1.0 - smoothstep(2.5, 6.0, pixelSpan);
  float o2 = 1.0 - smoothstep(1.0, 2.5, pixelSpan);
  float g0 = 0.5 + (valueNoise(gq) - 0.5) * 0.65 * o1 + (valueNoise(gq * 2.7 + 5.3) - 0.5) * 0.35 * o2;
  float g1 = 0.5 + (valueNoise(gq + vec2(0.12, 0.0)) - 0.5) * 0.65 * o1 + (valueNoise(gq * 2.7 + 5.3 + vec2(0.324, 0.0)) - 0.5) * 0.35 * o2;
  float steep = 1.0 - smoothstep(0.55, 0.95, nGeo.y);
  // On near level ground the fall line has no direction (it turns with every bump): gullies there swirled into
  // wood grain over the plain, so they need a slope
  float gullies = smoothstep(0.12, 0.35, 1.0 - nGeo.y);
  // Bend the normal across the gully (map across -> scene: x mirrored)
  vec3 acrossScene = vec3(-across.x, 0.0, across.y);
  vec3 nRange = safeNormalize(terrainNormal + acrossScene * (g1 - g0) * 9.0 * (0.25 + steep) * gullies * rangeShare, terrainNormal);
  float slope = 1.0 - nRange.y;

  // The rock: the cliff material at six times its scale, the dominant side plane and the top
  int rockLayer = max(uCliffLayer, 0);
  float rs = uInvScale[rockLayer] / 6.0;
  // Both side planes by their weights: picking the dominant one switched planes along the coarse facets of the
  // range and drew zigzag seams down every flank
  float sideW = tri.x / max(tri.x + tri.z, 1e-4);
  vec3 rockSide = textureGrad(uColorArray, vec3(sideX * rs, float(rockLayer)), sideXdx * rs, sideXdy * rs).rgb * sideW
    + textureGrad(uColorArray, vec3(sideZ * rs, float(rockLayer)), sideZdx * rs, sideZdy * rs).rgb * (1.0 - sideW);
  vec3 rockTop = textureGrad(uColorArray, vec3(tPos.xz * rs, float(rockLayer)), dPosX * rs, dPosY * rs).rgb;
  vec3 rockTex = mix(rockTop, rockSide, smoothstep(0.15, 0.5, slope));
  vec3 rockAvg = uAverage[rockLayer];
  // The texture's grain as brightness around its average: near it shows, far its mips blur to the average
  float grain = clamp(dot(rockTex, vec3(0.333)) / max(dot(rockAvg, vec3(0.333)), 0.02), 0.55, 1.6);
  // Far off a pixel covers metres of the flank: the texture's streaks, stretched over the coarse facets, would
  // beat into moire; its brightness settles to the average
  grain = mix(grain, 1.0, smoothstep(0.5, 2.0, max(apronFootprint, apronHeightPerPixel)));
  // Strata along the height, bent a little by noise, in patches; on cliffs only (steeper than some 45 degrees):
  // on gentle flanks height bands read as contour lines, wood grain over a plain
  float warp = (blotMid.r - 0.5) * 24.0 + (g0 - 0.5) * 8.0;
  float strata = mix(0.84, 1.08, smoothstep(0.3, 0.7, valueNoise(vec2((tPos.y + warp) * 0.07, 2.9))));
  float cliff = 1.0 - smoothstep(0.45, 0.72, nGeo.y);
  // Bands 14 m apart fade before a pixel spans a seventh of one: farther, bent by the warp, they beat into moire
  strata = mix(1.0, strata, smoothstep(0.35, 0.65, blot.b) * cliff * uApronStrata * (1.0 - smoothstep(1.0, 2.0, apronHeightPerPixel)));
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
  float furrow = smoothstep(0.45, 0.15, g0) * (0.3 + steep * 0.7) * gullies;

  albedo = mix(albedo, col, rangeShare);
  terrainNormal = safeNormalize(mix(terrainNormal, nRange, rangeShare), terrainNormal);
  terrainAO *= 1.0 - 0.35 * furrow * rangeShare;
  terrainRough = mix(terrainRough, mix(terrainRough, 0.6, snow), rangeShare);
}
`;
