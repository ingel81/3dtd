import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { LuminosityHighPassShader } from 'three/examples/jsm/shaders/LuminosityHighPassShader.js';

/**
 * GLSL: whether a value, or any channel of a colour, is NaN or infinite.
 * Both have every exponent bit set. A bit test, because a compiler may
 * treat isnan() as always false under fast-math.
 */
export const NON_FINITE_GLSL = /* glsl */ `
  bool nonFinite(float x) {
    return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u;
  }
  bool nonFinite(vec3 c) {
    return nonFinite(c.r) || nonFinite(c.g) || nonFinite(c.b);
  }
`;

/**
 * three's LuminosityHighPassShader with the frame's pixel cleaned first.
 *
 * The bloom blurs the bright pixels over five halvings of the frame, the
 * last at 1/32 with a kernel of 22 texels: one pixel reaches some 1150 px
 * to each side. A NaN or infinite pixel (a shader dividing by zero, a
 * half-float blend running over 65504) passes three's high pass, as
 * `mix(outputColor, texel, alpha)` keeps a NaN and turns an infinity times
 * zero into one, and every blur tap it falls in turns NaN. The composite
 * adds that onto the frame and the output pass shows NaN as black: a black
 * square of up to some 2300 px, which flickers as the pixel comes and goes.
 * Without bloom the same pixel is one black pixel.
 *
 * Here a non-finite pixel adds no bloom, and a negative channel (which
 * would darken the blur around it) counts as 0. The frame itself is left
 * as it is.
 */
export const GUARDED_HIGH_PASS_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec3 defaultColor;
  uniform float defaultOpacity;
  uniform float luminosityThreshold;
  uniform float smoothWidth;

  varying vec2 vUv;

  ${NON_FINITE_GLSL}

  void main() {
    vec4 texel = texture2D( tDiffuse, vUv );
    vec3 color = nonFinite( texel.rgb ) ? vec3( 0.0 ) : max( texel.rgb, 0.0 );

    float v = luminance( color );

    vec4 outputColor = vec4( defaultColor.rgb, defaultOpacity );

    float alpha = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v );

    gl_FragColor = mix( outputColor, vec4( color, texel.a ), alpha );
  }
`;

/**
 * Give `pass` the guarded high pass (GUARDED_HIGH_PASS_FRAGMENT), or with
 * `guarded` false three's own again. Same uniforms, so only the program
 * changes.
 */
export function guardBloomHighPass(pass: UnrealBloomPass, guarded = true): void {
  const material = pass.materialHighPassFilter;
  const fragmentShader = guarded ? GUARDED_HIGH_PASS_FRAGMENT : LuminosityHighPassShader.fragmentShader;
  if (material.fragmentShader === fragmentShader) return;
  material.fragmentShader = fragmentShader;
  material.needsUpdate = true;
}
