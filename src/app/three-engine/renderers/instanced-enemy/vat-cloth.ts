import { Color, SRGBColorSpace, Vector4, type BufferGeometry, type IUniform } from 'three';
import type { ClothVariants } from '../../../configs/enemy-types.config';

/**
 * The look of each instance of an enemy type (TODO E185, E220,
 * EnemyTypeConfig.clothVariants): the VAT shader recolours regions of the
 * type's own texture (skin, shirt, trousers, hair) and lays dirt and dried
 * blood over the body, all from one random seed per instance, so a horde of
 * one model shows no clones. One float per instance (aClothSeed); no texture
 * and no draw call is added.
 *
 * A region is texels near its colour on a band of the body (a share of the
 * rest pose's height): the brown of the Zombie's trousers is also its hair,
 * the red of Zombie v2's shirt also the blood on its face. Each instance
 * takes one colour of the region's palette, darker or lighter, and bleached
 * up to the region's `fade`; a recoloured texel keeps its brightness against
 * the region's colour, so the shading, dirt and folds of the texture stay.
 * Over that the instance gets its own blotches: a slow mottle of the colour,
 * dirt climbing from the feet and dried blood running down from chest and
 * mouth, from noise in the rest pose (it moves with the body, not the
 * screen), offset by the seed.
 */

/** Regions a type may have and colours per region (the shader's uniform arrays) */
export const MAX_CLOTH_REGIONS = 4;
export const MAX_CLOTH_PALETTE = 6;

/** Rec. 709 luminance of a linear colour */
function luminance(c: Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The uniforms of a type's looks: per region its colour in sRGB and the
 * tolerance, its band in rest-pose y with a soft edge and its fade, the
 * luminance of its colour (linear) and the size of its palette (0: no
 * region); the palettes (linear); the rest pose's lowest y and height with
 * the dirt and blood strengths.
 */
export function clothUniforms(cloth: ClothVariants, geometry: BufferGeometry): Record<string, IUniform> {
  if (cloth.regions.length > MAX_CLOTH_REGIONS || cloth.regions.some((r) => r.palette.length === 0 || r.palette.length > MAX_CLOTH_PALETTE)) {
    throw new Error(`clothVariants: at most ${MAX_CLOTH_REGIONS} regions of 1 to ${MAX_CLOTH_PALETTE} colours`);
  }
  geometry.computeBoundingBox();
  const low = geometry.boundingBox!.min.y;
  const height = geometry.boundingBox!.max.y - low || 1;
  const srgb = { r: 0, g: 0, b: 0 };
  const regions: Vector4[] = [];
  const bands: Vector4[] = [];
  const refLum: number[] = [];
  const counts: number[] = [];
  const palette: Vector4[] = [];
  for (let r = 0; r < MAX_CLOTH_REGIONS; r++) {
    const region = cloth.regions[r];
    for (let k = 0; k < MAX_CLOTH_PALETTE; k++) {
      const hex = region?.palette[k];
      const c = hex ? new Color(hex) : null;
      palette.push(new Vector4(c?.r ?? 0, c?.g ?? 0, c?.b ?? 0, c ? 1 : 0));
    }
    if (!region) {
      regions.push(new Vector4(0, 0, 0, 0));
      bands.push(new Vector4(0, 0, 1, 0));
      refLum.push(1);
      counts.push(0);
      continue;
    }
    const color = new Color(region.color);
    color.getRGB(srgb, SRGBColorSpace);
    regions.push(new Vector4(srgb.r, srgb.g, srgb.b, region.tolerance));
    bands.push(new Vector4(low + region.from * height, low + region.to * height, 0.04 * height, region.fade ?? 0));
    refLum.push(luminance(color));
    counts.push(region.palette.length);
  }
  return {
    uClothRegion: { value: regions },
    uClothBand: { value: bands },
    uClothRefLum: { value: refLum },
    uClothCount: { value: counts },
    uClothPalette: { value: palette },
    uClothRest: { value: new Vector4(low, height, cloth.grime?.dirt ?? 0, cloth.grime?.blood ?? 0) },
  };
}

/**
 * An enemy's seed for its look, in [0, 1): from its id, so it keeps its
 * look for its life and on every machine
 */
export function clothSeed(id: string): number {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Vertex shader part: the seed and the rest-pose position go to the fragment */
export const CLOTH_VERTEX_GLSL = /* glsl */ `
  #ifdef VAT_CLOTH
    attribute float aClothSeed;
    varying float vClothSeed;
    varying vec3 vRest;
  #endif
`;

/** Vertex shader main part */
export const CLOTH_VERTEX_MAIN_GLSL = /* glsl */ `
  #ifdef VAT_CLOTH
    vClothSeed = aClothSeed;
    vRest = position;
  #endif
`;

/** Fragment shader part: clothRecolor(baseColor) */
export const CLOTH_FRAGMENT_GLSL = /* glsl */ `
  #ifdef VAT_CLOTH
    uniform vec4 uClothRegion[${MAX_CLOTH_REGIONS}];
    uniform vec4 uClothBand[${MAX_CLOTH_REGIONS}];
    uniform float uClothRefLum[${MAX_CLOTH_REGIONS}];
    uniform float uClothCount[${MAX_CLOTH_REGIONS}];
    uniform vec4 uClothPalette[${MAX_CLOTH_REGIONS * MAX_CLOTH_PALETTE}];
    uniform vec4 uClothRest;
    varying float vClothSeed;
    varying vec3 vRest;

    // A number in [0, 1) per seed and key
    float clothHash(float seed, float key) {
      return fract(sin(seed * 91.3458 + key * 47.853) * 43758.5453);
    }

    float clothCorner(vec3 p) {
      p = fract(p * 0.3183099 + 0.1) * 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    // Value noise in [0, 1], smooth between lattice corners
    float clothNoise(vec3 x) {
      vec3 i = floor(x);
      vec3 f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(clothCorner(i), clothCorner(i + vec3(1.0, 0.0, 0.0)), f.x),
            mix(clothCorner(i + vec3(0.0, 1.0, 0.0)), clothCorner(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
        mix(mix(clothCorner(i + vec3(0.0, 0.0, 1.0)), clothCorner(i + vec3(1.0, 0.0, 1.0)), f.x),
            mix(clothCorner(i + vec3(0.0, 1.0, 1.0)), clothCorner(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
        f.z);
    }

    // Three octaves, the finer ones turned off the lattice so no grid shows
    float clothFbm(vec3 p) {
      const mat3 turn = mat3(0.8, 0.36, -0.48, -0.6, 0.48, -0.64, 0.0, 0.8, 0.6);
      float n = clothNoise(p) * 0.55;
      p = turn * p * 2.03;
      n += clothNoise(p) * 0.3;
      p = turn * p * 2.11;
      return n + clothNoise(p) * 0.15;
    }

    vec3 clothRecolor(vec3 c) {
      float seed = vClothSeed;
      vec3 g = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Rest pose in shares of the height (y 0 the soles), offset per instance
      vec3 p = (vRest - vec3(0.0, uClothRest.x, 0.0)) / uClothRest.y;
      vec3 q = p + vec3(seed * 31.7, seed * 17.3, seed * 23.9);
      float blotch = clothFbm(q * 4.0);
      vec3 outColor = c;
      float recoloured = 0.0;
      for (int r = 0; r < ${MAX_CLOTH_REGIONS}; r++) {
        float count = uClothCount[r];
        if (count < 0.5) continue;
        vec4 region = uClothRegion[r];
        vec4 band = uClothBand[r];
        float near = 1.0 - smoothstep(region.w * 0.6, region.w, distance(g, region.rgb));
        float inBand = smoothstep(band.x - band.z, band.x, vRest.y) * (1.0 - smoothstep(band.y, band.y + band.z, vRest.y));
        float w = near * inBand;
        if (w <= 0.0) continue;
        float fr = float(r);
        int pick = int(min(floor(clothHash(seed, fr) * count), count - 1.0));
        vec3 target = uClothPalette[r * ${MAX_CLOTH_PALETTE} + pick].rgb;
        // Darker or lighter per instance, then bleached toward its grey up to the region's fade
        target *= 0.8 + 0.4 * clothHash(seed, fr + 7.0);
        float bleach = band.w * clothHash(seed, fr + 13.0);
        target = mix(target, vec3(dot(target, vec3(0.2126, 0.7152, 0.0722))) * 1.08, bleach);
        // A slow mottle over the body: no flat patch of one colour
        target *= 0.86 + 0.28 * blotch;
        outColor = mix(outColor, target * (lum / max(uClothRefLum[r], 1e-4)), w);
        recoloured = max(recoloured, w);
      }

      // The model's own bright reds (painted wounds, blood) dry dark where no region took them
      float red = smoothstep(0.1, 0.26, g.r - max(g.g, g.b)) * (1.0 - recoloured) * uClothRest.w;
      outColor = mix(outColor, vec3(0.55, 0.07, 0.05) * lum, red);

      // Dirt climbing from the feet, its line higher on some than on others, in blotches
      float climb = 1.0 - smoothstep(0.04, 0.32 + 0.3 * clothHash(seed, 21.0), p.y);
      float dirt = smoothstep(0.42, 0.78, blotch * 0.75 + climb * 0.6) * uClothRest.z;
      outColor = mix(outColor, outColor * vec3(0.5, 0.42, 0.33), dirt);

      // Dried blood: stains on the chest and around the mouth, running down in streaks
      float zone = smoothstep(0.5, 0.68, p.y) * (1.0 - smoothstep(0.9, 0.98, p.y));
      float streak = clothFbm(vec3(q.x * 9.0, q.y * 2.2, q.z * 9.0));
      float stain = smoothstep(0.64, 0.7, streak + zone * (0.04 + 0.1 * clothHash(seed, 29.0)) - 0.06) * uClothRest.w;
      // Dark and brown where dried, a deeper red where fresher
      vec3 blood = mix(vec3(0.045, 0.006, 0.004), vec3(0.02, 0.007, 0.004), blotch);
      return mix(outColor, blood, stain);
    }
  #endif
`;
