import { ShaderChunk } from 'three';

/** Three's turn of the PCF taps per pixel (a pattern: GLSL, no text for the i18n guard) */
const SCREEN_TURN = /float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;/g;

/**
 * Holds the soft shadow's taps still on the surface: three's PCF turns its
 * five taps (a Vogel disk, each a hardware 2x2 compare) by a noise of the
 * pixel's place on the screen, meant to be averaged away by a temporal
 * filter over frames. The game has none: in every partly lit pixel (a
 * shadow's edge, a wall's foot, a roof at a grazing sun) the grain stood on
 * the screen while the picture moved under it, and sparkled with every move
 * of the camera, on until its damping came to rest. Turned the same way
 * everywhere, a pixel's shadow depends on its place in the world alone: it
 * holds still as the camera moves, the edge as soft. Directional, spot and
 * point lights alike, every material, at the cost of a constant instead of a
 * noise. Installed with the shadow edge fade when the first renderer is made
 * (renderer-host.ts); three keys programs by their parameters, not by the
 * chunk's text, so a later install would leave programs built before it.
 */
export function installSteadyShadowTaps(): void {
  const chunk = ShaderChunk.shadowmap_pars_fragment;
  if (!chunk.includes('interleavedGradientNoise( gl_FragCoord.xy )')) {
    if (chunk.includes('float phi = 0.0;')) return;
    throw new Error("shadow-steady-taps: three's PCF changed, no turn per pixel found");
  }
  (ShaderChunk as Record<string, string>)['shadowmap_pars_fragment'] = chunk.replace(SCREEN_TURN, 'float phi = 0.0;');
}
