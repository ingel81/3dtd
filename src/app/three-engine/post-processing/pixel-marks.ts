import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { NON_FINITE_GLSL } from './bloom-guard';

/**
 * Half the side of the square a mark paints, px: a bad pixel alone is too
 * small to find on the screen, a 9 px square is not.
 */
const MARK_RADIUS_PX = 4;

/**
 * Diagnostic pass (`__bloom.marks()`): every pixel of the frame within
 * MARK_RADIUS_PX of a NaN turns magenta, of an infinite value cyan, the
 * rest passes unchanged. Placed right after the scene, so it shows what
 * the scene wrote, before the bloom (bloom-guard.ts) could spread it.
 */
const PixelMarksShader = {
  name: 'PixelMarksShader',
  defines: { MARK_RADIUS: MARK_RADIUS_PX },
  uniforms: {
    tDiffuse: { value: null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;

    ${NON_FINITE_GLSL}

    // NaN: every exponent bit set and a mantissa; infinity has none
    bool isNaNBits(float x) {
      uint bits = floatBitsToUint(x);
      return (bits & 0x7f800000u) == 0x7f800000u && (bits & 0x007fffffu) != 0u;
    }
    bool hasNaN(vec3 c) {
      return isNaNBits(c.r) || isNaNBits(c.g) || isNaNBits(c.b);
    }

    void main() {
      ivec2 size = textureSize(tDiffuse, 0);
      ivec2 pixel = ivec2(gl_FragCoord.xy);
      bool nan = false;
      bool infinite = false;
      for (int y = -MARK_RADIUS; y <= MARK_RADIUS; y++) {
        for (int x = -MARK_RADIUS; x <= MARK_RADIUS; x++) {
          vec3 c = texelFetch(tDiffuse, clamp(pixel + ivec2(x, y), ivec2(0), size - 1), 0).rgb;
          if (hasNaN(c)) nan = true;
          else if (nonFinite(c)) infinite = true;
        }
      }
      if (nan) gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
      else if (infinite) gl_FragColor = vec4(0.0, 1.0, 1.0, 1.0);
      else gl_FragColor = texelFetch(tDiffuse, pixel, 0);
    }
  `,
};

/** The marks pass, off: the pipeline turns it on for `__bloom.marks()`. */
export function createPixelMarksPass(): ShaderPass {
  const pass = new ShaderPass(PixelMarksShader);
  pass.enabled = false;
  return pass;
}
