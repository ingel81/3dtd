import {
  DataTexture,
  RGBAFormat,
  UnsignedByteType,
  LinearFilter,
  ClampToEdgeWrapping,
  Vector2,
} from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Color grading preset names
 */
export type ColorGradingPreset = 'none' | 'dark-fantasy' | 'noir' | 'warm-sunset';

/**
 * All available presets for UI iteration
 */
export const COLOR_GRADING_PRESETS: { id: ColorGradingPreset; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'dark-fantasy', label: 'Dark Fantasy' },
  { id: 'noir', label: 'Noir' },
  { id: 'warm-sunset', label: 'Warm Sunset' },
];

/**
 * LUT size — 16³ is enough for subtle color grading and very cheap
 */
const LUT_SIZE = 16;

// ============================================================
// Custom LUT Shader (avoids importing LUTPass from three/addons)
// Single fullscreen pass: sample the scene texture, look up in 3D LUT
// We encode a 3D LUT as a 2D strip texture (LUT_SIZE * LUT_SIZE wide, LUT_SIZE tall)
// ============================================================

const LUTShader = {
  name: 'LUTShader',
  uniforms: {
    tDiffuse: { value: null },       // scene render target (auto-bound by EffectComposer)
    tLUT: { value: null },           // 2D strip LUT texture
    lutSize: { value: LUT_SIZE },    // LUT dimension
    intensity: { value: 1.0 },       // blend 0..1
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
    uniform sampler2D tLUT;
    uniform float lutSize;
    uniform float intensity;
    varying vec2 vUv;

    // Sample a 3D LUT encoded as a horizontal strip in a 2D texture
    // Layout: lutSize slices side-by-side, each slice is lutSize × lutSize
    vec3 sampleLUT(vec3 color) {
      float sliceCount = lutSize;
      float sliceWidth = 1.0 / sliceCount;

      // Clamp input
      vec3 c = clamp(color, 0.0, 1.0);

      // Blue channel selects the slice (Z axis of LUT)
      float blueSlice = c.b * (sliceCount - 1.0);
      float sliceLow = floor(blueSlice);
      float sliceHigh = min(sliceLow + 1.0, sliceCount - 1.0);
      float sliceFrac = blueSlice - sliceLow;

      // Half-texel offset for correct sampling
      float halfTexel = 0.5 / (lutSize * lutSize);
      float halfTexelY = 0.5 / lutSize;

      // UV within a single slice: R = x, G = y
      vec2 uvLow = vec2(
        (sliceLow + c.r) * sliceWidth,
        c.g
      );
      // Apply half-texel offsets to avoid edge bleeding
      uvLow.x = uvLow.x * (1.0 - 2.0 * halfTexel) + halfTexel;
      uvLow.y = uvLow.y * (1.0 - 2.0 * halfTexelY) + halfTexelY;

      vec2 uvHigh = vec2(
        (sliceHigh + c.r) * sliceWidth,
        c.g
      );
      uvHigh.x = uvHigh.x * (1.0 - 2.0 * halfTexel) + halfTexel;
      uvHigh.y = uvHigh.y * (1.0 - 2.0 * halfTexelY) + halfTexelY;

      // Sample both slices and interpolate
      vec3 colorLow = texture2D(tLUT, uvLow).rgb;
      vec3 colorHigh = texture2D(tLUT, uvHigh).rgb;

      return mix(colorLow, colorHigh, sliceFrac);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 graded = sampleLUT(texel.rgb);
      gl_FragColor = vec4(mix(texel.rgb, graded, intensity), texel.a);
    }
  `,
};

/**
 * Create a ShaderPass for LUT-based color grading.
 * Returns the pass and a method to swap LUT presets at runtime.
 */
export function createColorGradingPass(): {
  pass: ShaderPass;
  setPreset: (preset: ColorGradingPreset) => void;
  setIntensity: (value: number) => void;
  dispose: () => void;
} {
  const pass = new ShaderPass(LUTShader);
  pass.enabled = false; // default OFF

  // Cache generated LUT textures
  const lutCache = new Map<ColorGradingPreset, DataTexture>();

  function getLUT(preset: ColorGradingPreset): DataTexture | null {
    if (preset === 'none') return null;
    if (lutCache.has(preset)) return lutCache.get(preset)!;
    const tex = generateLUT(preset);
    lutCache.set(preset, tex);
    return tex;
  }

  function setPreset(preset: ColorGradingPreset): void {
    if (preset === 'none') {
      pass.enabled = false;
      return;
    }
    const lut = getLUT(preset);
    if (lut) {
      pass.uniforms['tLUT'].value = lut;
      pass.uniforms['lutSize'].value = LUT_SIZE;
      pass.enabled = true;
    }
  }

  function setIntensity(value: number): void {
    pass.uniforms['intensity'].value = Math.max(0, Math.min(1, value));
  }

  function dispose(): void {
    for (const tex of lutCache.values()) {
      tex.dispose();
    }
    lutCache.clear();
  }

  return { pass, setPreset, setIntensity, dispose };
}

// ============================================================
// Procedural LUT generation
// Each preset transforms RGB → RGB in a 16³ lookup table
// Encoded as a 2D strip texture: width = LUT_SIZE * LUT_SIZE, height = LUT_SIZE
// ============================================================

function generateLUT(preset: ColorGradingPreset): DataTexture {
  const size = LUT_SIZE;
  const width = size * size;  // horizontal strip: size slices of size pixels
  const height = size;
  const data = new Uint8Array(width * height * 4);

  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        // Normalized input color
        const ri = r / (size - 1);
        const gi = g / (size - 1);
        const bi = b / (size - 1);

        // Apply preset transformation
        let [ro, go, bo] = applyPreset(ri, gi, bi, preset);

        // Clamp
        ro = Math.max(0, Math.min(1, ro));
        go = Math.max(0, Math.min(1, go));
        bo = Math.max(0, Math.min(1, bo));

        // Write to strip texture
        // Pixel position: x = b * size + r, y = g
        const x = b * size + r;
        const y = g;
        const idx = (y * width + x) * 4;
        data[idx + 0] = Math.round(ro * 255);
        data[idx + 1] = Math.round(go * 255);
        data[idx + 2] = Math.round(bo * 255);
        data[idx + 3] = 255;
      }
    }
  }

  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return texture;
}

/**
 * Apply a color grading preset to an RGB triplet (all values 0..1)
 */
function applyPreset(r: number, g: number, b: number, preset: ColorGradingPreset): [number, number, number] {
  switch (preset) {
    case 'dark-fantasy':
      return darkFantasy(r, g, b);
    case 'noir':
      return noir(r, g, b);
    case 'warm-sunset':
      return warmSunset(r, g, b);
    default:
      return [r, g, b];
  }
}

// ---- Utility functions ----

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** S-curve contrast (adjustable midpoint & strength) */
function sCurve(x: number, strength = 1.0): number {
  // Attempt a sigmoid centered at 0.5
  const t = (x - 0.5) * strength;
  return 1.0 / (1.0 + Math.exp(-t * 5));
}

/** Desaturate toward luminance by amount (0 = no change, 1 = grayscale) */
function desaturate(r: number, g: number, b: number, amount: number): [number, number, number] {
  const l = luminance(r, g, b);
  return [
    r + (l - r) * amount,
    g + (l - g) * amount,
    b + (l - b) * amount,
  ];
}

/** Lerp helper */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---- Presets ----

/**
 * Dark Fantasy: Desaturated dark tones, bluish shadows, warm highlights
 * Inspired by dark medieval RPG aesthetics
 */
function darkFantasy(r: number, g: number, b: number): [number, number, number] {
  // 1. Slight desaturation (40%)
  let [ro, go, bo] = desaturate(r, g, b, 0.4);

  // 2. Increase contrast with S-curve
  ro = sCurve(ro, 1.2);
  go = sCurve(go, 1.2);
  bo = sCurve(bo, 1.2);

  // 3. Color split based on luminance:
  //    - Shadows → bluish tint
  //    - Highlights → warm amber tint
  const lum = luminance(ro, go, bo);

  // Shadow tint (blue-ish)
  const shadowR = ro * 0.85;
  const shadowG = go * 0.88;
  const shadowB = bo * 1.2;

  // Highlight tint (warm amber)
  const highlightR = ro * 1.15;
  const highlightG = go * 1.05;
  const highlightB = bo * 0.85;

  // Blend based on luminance (shadows < 0.3, highlights > 0.7)
  const shadowWeight = Math.max(0, 1.0 - lum * 2.5); // Strong below 0.4
  const highlightWeight = Math.max(0, (lum - 0.5) * 2.0); // Strong above 0.5

  ro = lerp(ro, shadowR, shadowWeight * 0.6);
  go = lerp(go, shadowG, shadowWeight * 0.6);
  bo = lerp(bo, shadowB, shadowWeight * 0.6);

  ro = lerp(ro, highlightR, highlightWeight * 0.5);
  go = lerp(go, highlightG, highlightWeight * 0.5);
  bo = lerp(bo, highlightB, highlightWeight * 0.5);

  // 4. Slight overall darken (crush blacks)
  ro = ro * 0.92 + 0.02;
  go = go * 0.92 + 0.02;
  bo = bo * 0.92 + 0.02;

  return [ro, go, bo];
}

/**
 * Noir: High contrast B&W with slight cool tone
 */
function noir(r: number, g: number, b: number): [number, number, number] {
  // Heavy desaturation (85%)
  let [ro, go, bo] = desaturate(r, g, b, 0.85);

  // Strong S-curve contrast
  ro = sCurve(ro, 1.8);
  go = sCurve(go, 1.8);
  bo = sCurve(bo, 1.8);

  // Cool tone in shadows
  const lum = luminance(ro, go, bo);
  const shadowWeight = Math.max(0, 1.0 - lum * 2.0);
  bo = lerp(bo, bo * 1.15, shadowWeight * 0.5);

  // Slight vignette simulation: darken overall
  ro = ro * 0.9 + 0.03;
  go = go * 0.9 + 0.03;
  bo = bo * 0.9 + 0.03;

  return [ro, go, bo];
}

/**
 * Warm Sunset: Golden hour warmth with lifted shadows
 */
function warmSunset(r: number, g: number, b: number): [number, number, number] {
  // Slight saturation boost (desaturate by -15% = saturate)
  let [ro, go, bo] = desaturate(r, g, b, -0.15);

  // Gentle contrast
  ro = sCurve(ro, 0.8);
  go = sCurve(go, 0.8);
  bo = sCurve(bo, 0.8);

  // Warm shift: boost reds/oranges, reduce blues
  ro = ro * 1.12;
  go = go * 1.02;
  bo = bo * 0.82;

  // Lift shadows (don't crush blacks)
  const lum = luminance(ro, go, bo);
  const shadowWeight = Math.max(0, 1.0 - lum * 3.0);
  ro = lerp(ro, ro + 0.08, shadowWeight);
  go = lerp(go, go + 0.05, shadowWeight);
  bo = lerp(bo, bo + 0.03, shadowWeight);

  // Add golden haze to highlights
  const highlightWeight = Math.max(0, (lum - 0.6) * 2.5);
  ro = lerp(ro, Math.min(1, ro + 0.1), highlightWeight * 0.4);
  go = lerp(go, Math.min(1, go + 0.06), highlightWeight * 0.4);

  return [ro, go, bo];
}
