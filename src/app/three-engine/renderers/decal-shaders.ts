/**
 * Decal Shader Materials
 *
 * Custom shaders for instanced blood, scorch, goo and ice decals with:
 * - Logarithmic depth buffer support (correct occlusion with 3D tiles)
 * - Per-instance color, opacity, variation
 * - Soft edges and procedural noise patterns
 * - Organic shapes for blood splatters
 * - The blood moon's tint (`uBloodMoonTint`, GroundDecals.setBloodMoon):
 *   they draw after the mood's multiply quad, so they multiply by it
 *   themselves, like the ground under them got it
 * - Colours in display values, written for the target (displayOutput,
 *   display-output.ts); the blood moon's tint is in the target's values
 *   and applies after that
 */

import { ShaderMaterial, DoubleSide, Vector3, type IUniform } from 'three';
import { DISPLAY_OUTPUT_GLSL } from './display-output';

/** A tint uniform of the normal look, for a decal material without a shared one */
function neutralTint(): IUniform<Vector3> {
  return { value: new Vector3(1, 1, 1) };
}

/**
 * Blood Decal Shader
 *
 * Features:
 * - Procedural splatter pattern with noise
 * - Per-instance color variation (dark red shades)
 * - Soft edges with alpha falloff
 * - Random variation via instanceVariation attribute
 */
export function createBloodDecalShader(bloodMoonTint: IUniform<Vector3> = neutralTint()): ShaderMaterial {
  const vertexShader = /* glsl */ `
    attribute vec3 instanceColor;
    attribute float instanceOpacity;
    attribute float instanceVariation;

    varying vec2 vUv;
    varying vec3 vInstanceColor;
    varying float vInstanceOpacity;
    varying float vInstanceVariation;

    #include <common>
    #include <logdepthbuf_pars_vertex>

    void main() {
      vUv = uv;
      vInstanceColor = instanceColor;
      vInstanceOpacity = instanceOpacity;
      vInstanceVariation = instanceVariation;

      // Apply instance matrix (position, rotation, scale)
      vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
      vec4 mvPosition = modelViewMatrix * worldPosition;

      gl_Position = projectionMatrix * mvPosition;

      #include <logdepthbuf_vertex>
    }
  `;

  const fragmentShader = /* glsl */ `
    precision highp float;
    uniform vec3 uBloodMoonTint;
    varying vec2 vUv;
    varying vec3 vInstanceColor;
    varying float vInstanceOpacity;
    varying float vInstanceVariation;

    #include <logdepthbuf_pars_fragment>

    ${DISPLAY_OUTPUT_GLSL}

    // Simple noise function for variation
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f); // Smoothstep

      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));

      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    void main() {
      // Center coordinates (-1 to 1)
      vec2 center = vUv * 2.0 - 1.0;
      float dist = length(center);

      // Base circular shape
      if (dist > 1.0) discard;

      // Add noise-based splatter pattern
      vec2 noiseCoord = center * 3.0 + vInstanceVariation * 10.0;
      float noiseValue = noise(noiseCoord);
      float splatter = noise(noiseCoord * 2.0 + vInstanceVariation * 5.0);

      // Irregular edge with noise
      float edge = 0.7 + noiseValue * 0.3;
      if (dist > edge) discard;

      // Soft falloff from center to edge
      float alpha = 1.0 - smoothstep(0.4, edge, dist);

      // Add splatter detail (darker spots)
      float detail = smoothstep(0.5, 0.8, splatter);
      vec3 color = mix(vInstanceColor, vInstanceColor * 0.6, detail * 0.5);

      // Apply instance opacity
      alpha *= vInstanceOpacity;

      gl_FragColor = vec4(displayOutput(color) * uBloodMoonTint, alpha);

      #include <logdepthbuf_fragment>
    }
  `;

  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uBloodMoonTint: bloodMoonTint },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/**
 * Scorch Decal Shader (burn and blast marks)
 *
 * Features:
 * - Charred core fading to a ragged rim
 * - Soot streaks radiating from the centre, blotchy darker patches
 * - Normal alpha blending of a dark colour: darkens the photoreal tiles,
 *   which ignore scene lights
 * - Rim and streak noise sample the direction vector, not atan(), so there
 *   is no seam where the angle wraps
 */
export function createScorchDecalShader(bloodMoonTint: IUniform<Vector3> = neutralTint()): ShaderMaterial {
  const vertexShader = /* glsl */ `
    attribute vec3 instanceColor;
    attribute float instanceOpacity;
    attribute float instanceVariation;

    varying vec2 vUv;
    varying vec3 vInstanceColor;
    varying float vInstanceOpacity;
    varying float vInstanceVariation;

    #include <common>
    #include <logdepthbuf_pars_vertex>

    void main() {
      vUv = uv;
      vInstanceColor = instanceColor;
      vInstanceOpacity = instanceOpacity;
      vInstanceVariation = instanceVariation;

      // Apply instance matrix (position, rotation, scale)
      vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
      vec4 mvPosition = modelViewMatrix * worldPosition;

      gl_Position = projectionMatrix * mvPosition;

      #include <logdepthbuf_vertex>
    }
  `;

  const fragmentShader = /* glsl */ `
    precision highp float;
    uniform vec3 uBloodMoonTint;
    varying vec2 vUv;
    varying vec3 vInstanceColor;
    varying float vInstanceOpacity;
    varying float vInstanceVariation;

    #include <logdepthbuf_pars_fragment>

    ${DISPLAY_OUTPUT_GLSL}

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);

      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));

      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    void main() {
      // Center coordinates (-1 to 1)
      vec2 center = vUv * 2.0 - 1.0;
      float dist = length(center);
      if (dist > 1.0) discard;

      vec2 dir = center / max(dist, 0.0001);
      vec2 seed = vec2(vInstanceVariation * 17.0, vInstanceVariation * 29.0);

      // Ragged rim between 0.6 and 0.95 of the quad
      float rim = 0.6 + 0.35 * noise(dir * 1.8 + seed);
      if (dist > rim) discard;

      // Charred core, soft towards the rim
      float alpha = 1.0 - smoothstep(0.15, rim, dist);

      // Soot streaks radiating outwards
      float streaks = noise(dir * 5.0 + seed + vec2(dist * 1.2, 0.0));
      alpha *= 0.7 + 0.3 * streaks;

      // Blotchy darker patches
      float blotch = noise(center * 4.0 + seed * 0.5);
      vec3 color = mix(vInstanceColor, vInstanceColor * 0.45, smoothstep(0.35, 0.75, blotch) * 0.7);

      gl_FragColor = vec4(displayOutput(color) * uBloodMoonTint, alpha * vInstanceOpacity);

      #include <logdepthbuf_fragment>
    }
  `;

  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uBloodMoonTint: bloodMoonTint },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/**
 * Goo Decal Shader (the splashes of a killed ooze, GroundDecals.layGoo)
 *
 * Features:
 * - A puddle with a wandering rim, ragged fingers thrown out of it and
 *   drops flung past it, all from instanceVariation, so no two splashes
 *   share a shape; the instance's stretch draws the whole splash long
 * - Wet slime: deep in the middle, a bright meniscus along the rim, glossy
 *   patches, each splash a shade of its own
 * - Rim and finger noise sample the direction vector, not atan(), so there
 *   is no seam where the angle wraps
 */
export function createGooDecalShader(bloodMoonTint: IUniform<Vector3> = neutralTint()): ShaderMaterial {
  const vertexShader = /* glsl */ `
    attribute vec3 instanceColor;
    attribute float instanceOpacity;
    attribute float instanceVariation;

    varying vec2 vUv;
    varying vec3 vInstanceColor;
    varying float vInstanceOpacity;
    varying float vInstanceVariation;

    #include <common>
    #include <logdepthbuf_pars_vertex>

    void main() {
      vUv = uv;
      vInstanceColor = instanceColor;
      vInstanceOpacity = instanceOpacity;
      vInstanceVariation = instanceVariation;

      // Apply instance matrix (position, rotation, scale)
      vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
      vec4 mvPosition = modelViewMatrix * worldPosition;

      gl_Position = projectionMatrix * mvPosition;

      #include <logdepthbuf_vertex>
    }
  `;

  const fragmentShader = /* glsl */ `
    precision highp float;
    uniform vec3 uBloodMoonTint;
    varying vec2 vUv;
    varying vec3 vInstanceColor;
    varying float vInstanceOpacity;
    varying float vInstanceVariation;

    #include <logdepthbuf_pars_fragment>

    ${DISPLAY_OUTPUT_GLSL}

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);

      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));

      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    void main() {
      // Center coordinates (-1 to 1)
      vec2 center = vUv * 2.0 - 1.0;
      float dist = length(center);
      if (dist > 1.0) discard;

      vec2 dir = center / max(dist, 0.0001);
      vec2 seed = vec2(vInstanceVariation * 23.0, vInstanceVariation * 37.0);

      // The puddle, its rim wandering between 0.35 and 0.65 of the quad
      float rim = 0.35 + 0.3 * noise(dir * 1.7 + seed);
      // Fingers the splash threw out, ragged, reaching up to 0.95
      float finger = smoothstep(0.55, 0.85, noise(dir * 6.0 + seed * 1.7));
      float reach = rim + finger * (0.95 - rim) * (0.6 + 0.4 * noise(dir * 13.0 + seed));
      float body = 1.0 - smoothstep(reach - 0.05, reach, dist);

      // Drops flung past the rim: round dots on a jittered grid, about one cell in four
      vec2 grid = center * 4.5 + seed;
      vec2 cell = floor(grid);
      vec2 jitter = vec2(hash(cell + 7.1), hash(cell + 3.7)) - 0.5;
      float dropRadius = 0.08 + 0.14 * hash(cell + 1.3);
      float dropDist = length(fract(grid) - 0.5 - jitter * 0.5);
      float drop = step(0.72, hash(cell)) * step(rim, dist) * (1.0 - smoothstep(dropRadius * 0.7, dropRadius, dropDist));

      float alpha = max(body, drop);
      if (alpha < 0.01) discard;

      // Wet slime: deep in the middle, a bright meniscus along the rim, glossy patches
      float edge = smoothstep(reach - 0.22, reach - 0.02, dist);
      vec3 color = vInstanceColor * (0.55 + 0.25 * noise(center * 5.0 + seed));
      color = mix(color, vInstanceColor * 1.35, edge * body);
      float gloss = smoothstep(0.7, 0.9, noise(center * 3.0 + seed.yx));
      color += vec3(0.18, 0.24, 0.1) * gloss * body * (1.0 - edge);
      // Each splash a shade of its own
      color *= 0.8 + 0.3 * fract(vInstanceVariation * 7.31);

      gl_FragColor = vec4(displayOutput(color) * uBloodMoonTint, alpha * vInstanceOpacity);

      #include <logdepthbuf_fragment>
    }
  `;

  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uBloodMoonTint: bloodMoonTint },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/**
 * Ice Decal Shader
 *
 * Features:
 * - Crystalline frost pattern
 * - Per-instance color variation (cyan/white shades)
 * - Soft edges with radial gradient
 * - Subtle sparkle effect
 */
export function createIceDecalShader(bloodMoonTint: IUniform<Vector3> = neutralTint()): ShaderMaterial {
  const vertexShader = /* glsl */ `
    attribute vec3 instanceColor;
    attribute float instanceOpacity;
    attribute float instanceVariation;

    varying vec2 vUv;
    varying vec3 vInstanceColor;
    varying float vInstanceOpacity;
    varying float vInstanceVariation;

    #include <common>
    #include <logdepthbuf_pars_vertex>

    void main() {
      vUv = uv;
      vInstanceColor = instanceColor;
      vInstanceOpacity = instanceOpacity;
      vInstanceVariation = instanceVariation;

      // Apply instance matrix (position, rotation, scale)
      vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
      vec4 mvPosition = modelViewMatrix * worldPosition;

      gl_Position = projectionMatrix * mvPosition;

      #include <logdepthbuf_vertex>
    }
  `;

  const fragmentShader = /* glsl */ `
    precision highp float;
    uniform vec3 uBloodMoonTint;
    varying vec2 vUv;
    varying vec3 vInstanceColor;
    varying float vInstanceOpacity;
    varying float vInstanceVariation;

    #include <logdepthbuf_pars_fragment>

    ${DISPLAY_OUTPUT_GLSL}

    // Simple noise function
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);

      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));

      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    void main() {
      // Center coordinates (-1 to 1)
      vec2 center = vUv * 2.0 - 1.0;
      float dist = length(center);

      // Base circular shape
      if (dist > 1.0) discard;

      // Crystalline frost pattern with noise
      vec2 noiseCoord = center * 5.0 + vInstanceVariation * 7.0;
      float crystal = noise(noiseCoord);
      float frostPattern = noise(noiseCoord * 2.0) * 0.5 + 0.5;

      // Soft radial gradient from center
      float alpha = 1.0 - smoothstep(0.0, 1.0, dist);

      // Add frost detail (brighter sparkles)
      float sparkle = smoothstep(0.7, 0.9, crystal);
      vec3 color = mix(vInstanceColor, vec3(1.0, 1.0, 1.0), sparkle * 0.4);

      // Add subtle crystalline structure
      color = mix(color, color * 1.2, frostPattern * 0.2);

      // Apply instance opacity
      alpha *= vInstanceOpacity;

      gl_FragColor = vec4(displayOutput(color) * uBloodMoonTint, alpha);

      #include <logdepthbuf_fragment>
    }
  `;

  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uBloodMoonTint: bloodMoonTint },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}
