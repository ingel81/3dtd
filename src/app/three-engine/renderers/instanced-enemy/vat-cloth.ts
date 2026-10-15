import { Color, SRGBColorSpace, Vector4, type BufferGeometry, type IUniform } from 'three';
import type { ClothVariants } from '../../../configs/enemy-types.config';

/**
 * Clothing looks of an enemy type (TODO E185, EnemyTypeConfig.clothVariants):
 * the VAT shader recolours the cloth regions of the type's own texture per
 * instance, so a horde of one model does not look cloned. One float per
 * instance (aClothLook) picks the look, 0 the model as it is; nothing else
 * is drawn, no texture is added.
 *
 * A region is texels near its colour on a band of the body (a share of the
 * rest pose's height): the brown of the Zombie's trousers is also its hair,
 * the red of Zombie v2's shirt also the blood on its face. A recoloured texel
 * keeps its brightness against the region's colour, so the shading, dirt and
 * folds of the texture stay.
 */

/** Regions and looks a type may have (the shader's uniform arrays) */
export const MAX_CLOTH_REGIONS = 2;
export const MAX_CLOTH_LOOKS = 4;

/** Rec. 709 luminance of a linear colour */
function luminance(c: Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The uniforms of a type's looks: per region its colour in sRGB and the
 * tolerance, its band in rest-pose y with a soft edge, the luminance of its
 * colour (linear); per look and region the new colour (linear, w 1) or none
 * (w 0).
 */
export function clothUniforms(cloth: ClothVariants, geometry: BufferGeometry): Record<string, IUniform> {
  if (cloth.regions.length > MAX_CLOTH_REGIONS || cloth.looks.length > MAX_CLOTH_LOOKS) {
    throw new Error(`clothVariants: at most ${MAX_CLOTH_REGIONS} regions and ${MAX_CLOTH_LOOKS} looks`);
  }
  geometry.computeBoundingBox();
  const low = geometry.boundingBox!.min.y;
  const height = geometry.boundingBox!.max.y - low || 1;
  const srgb = { r: 0, g: 0, b: 0 };
  const regions: Vector4[] = [];
  const bands: Vector4[] = [];
  const refLum: number[] = [];
  for (let r = 0; r < MAX_CLOTH_REGIONS; r++) {
    const region = cloth.regions[r];
    if (!region) {
      regions.push(new Vector4(0, 0, 0, 0));
      bands.push(new Vector4(0, 0, 1, 0));
      refLum.push(1);
      continue;
    }
    const color = new Color(region.color);
    color.getRGB(srgb, SRGBColorSpace);
    regions.push(new Vector4(srgb.r, srgb.g, srgb.b, region.tolerance));
    bands.push(new Vector4(low + region.from * height, low + region.to * height, 0.04 * height, 0));
    refLum.push(luminance(color));
  }
  const colors: Vector4[] = [];
  for (let l = 0; l < MAX_CLOTH_LOOKS; l++) {
    for (let r = 0; r < MAX_CLOTH_REGIONS; r++) {
      const hex = cloth.looks[l]?.[r];
      if (!hex || !cloth.regions[r]) {
        colors.push(new Vector4(0, 0, 0, 0));
        continue;
      }
      const c = new Color(hex);
      colors.push(new Vector4(c.r, c.g, c.b, 1));
    }
  }
  return {
    uClothRegion: { value: regions },
    uClothBand: { value: bands },
    uClothRefLum: { value: refLum },
    uClothColor: { value: colors },
  };
}

/**
 * The look an enemy wears, 0 (the model's own) to the number of looks:
 * picked by its id, so it keeps its clothes for its life and on every machine.
 */
export function clothLook(id: string, cloth: ClothVariants): number {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) % (cloth.looks.length + 1);
}

/** Vertex shader part: the look and the rest-pose height go to the fragment */
export const CLOTH_VERTEX_GLSL = /* glsl */ `
  #ifdef VAT_CLOTH
    attribute float aClothLook;
    varying float vClothLook;
    varying float vRestY;
  #endif
`;

/** Vertex shader main part */
export const CLOTH_VERTEX_MAIN_GLSL = /* glsl */ `
  #ifdef VAT_CLOTH
    vClothLook = aClothLook;
    vRestY = position.y;
  #endif
`;

/** Fragment shader part: clothRecolor(baseColor) */
export const CLOTH_FRAGMENT_GLSL = /* glsl */ `
  #ifdef VAT_CLOTH
    uniform vec4 uClothRegion[${MAX_CLOTH_REGIONS}];
    uniform vec4 uClothBand[${MAX_CLOTH_REGIONS}];
    uniform float uClothRefLum[${MAX_CLOTH_REGIONS}];
    uniform vec4 uClothColor[${MAX_CLOTH_REGIONS * MAX_CLOTH_LOOKS}];
    varying float vClothLook;
    varying float vRestY;

    vec3 clothRecolor(vec3 c) {
      int look = int(vClothLook + 0.5);
      if (look == 0) return c;
      vec3 g = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 outColor = c;
      for (int r = 0; r < ${MAX_CLOTH_REGIONS}; r++) {
        vec4 target = uClothColor[(look - 1) * ${MAX_CLOTH_REGIONS} + r];
        if (target.w < 0.5) continue;
        vec4 region = uClothRegion[r];
        vec4 band = uClothBand[r];
        float near = 1.0 - smoothstep(region.w * 0.6, region.w, distance(g, region.rgb));
        float inBand = smoothstep(band.x - band.z, band.x, vRestY) * (1.0 - smoothstep(band.y, band.y + band.z, vRestY));
        outColor = mix(outColor, target.rgb * (lum / max(uClothRefLum[r], 1e-4)), near * inBand);
      }
      return outColor;
    }
  #endif
`;
