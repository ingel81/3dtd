import { Vector3 } from 'three';
import type { EffectRgb } from '../../../configs/visual-effects.config';

/** Value noise and a three-octave fbm for the portal shaders. */
export const PORTAL_NOISE_GLSL = /* glsl */ `
  float portalHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float portalNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = portalHash(i);
    float b = portalHash(i + vec2(1.0, 0.0));
    float c = portalHash(i + vec2(0.0, 1.0));
    float d = portalHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float portalFbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
      v += amp * portalNoise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      amp *= 0.5;
    }
    return v / 0.875;
  }
`;

/** Opening of the portal at scale 1 (m), see PORTAL_SHADER_LAYOUT. */
export interface PortalShaderLayout {
  halfOpening: number;
  openingHeight: number;
  halfDepth: number;
  groundHalfWidth: number;
  groundBack: number;
  groundFront: number;
}

/** Colours of the portal look, see SPAWN_PORTAL_LOOK.palette. */
export interface PortalPalette {
  void: EffectRgb;
  ember: EffectRgb;
  hot: EffectRgb;
  violet: EffectRgb;
}

/** The palette as shader uniforms, written as they are (no colour space conversion). */
export function portalPaletteUniforms(palette: PortalPalette) {
  const rgb = (c: EffectRgb) => ({ value: new Vector3(c.r, c.g, c.b) });
  return {
    uVoid: rgb(palette.void),
    uEmber: rgb(palette.ember),
    uHot: rgb(palette.hot),
    uViolet: rgb(palette.violet),
  };
}

export const PORTAL_PALETTE_GLSL = /* glsl */ `
  uniform vec3 uVoid;   // near-black ground of the void
  uniform vec3 uEmber;  // dark red: swirl, seams, light on stone and street
  uniform vec3 uHot;    // dull orange: hottest points, embers
  uniform vec3 uViolet; // the swirl's troughs
`;

/** Where the surge of a wave start lies in the energy, see SPAWN_PORTAL_LOOK. */
export interface PortalSurge {
  waveEnergy: number;
  surge: number;
}
