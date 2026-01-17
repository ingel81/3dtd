/**
 * Decal Shader Materials
 *
 * Custom shaders for instanced blood and ice decals with:
 * - Logarithmic depth buffer support (correct occlusion with 3D tiles)
 * - Per-instance color, opacity, variation
 * - Soft edges and procedural noise patterns
 * - Organic shapes for blood splatters
 */

import * as THREE from 'three';

/**
 * Blood Decal Shader
 *
 * Features:
 * - Procedural splatter pattern with noise
 * - Per-instance color variation (dark red shades)
 * - Soft edges with alpha falloff
 * - Random variation via instanceVariation attribute
 */
export function createBloodDecalShader(): THREE.ShaderMaterial {
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
    varying vec2 vUv;
    varying vec3 vInstanceColor;
    varying float vInstanceOpacity;
    varying float vInstanceVariation;

    #include <logdepthbuf_pars_fragment>

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

      gl_FragColor = vec4(color, alpha);

      #include <logdepthbuf_fragment>
    }
  `;

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
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
export function createIceDecalShader(): THREE.ShaderMaterial {
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
    varying vec2 vUv;
    varying vec3 vInstanceColor;
    varying float vInstanceOpacity;
    varying float vInstanceVariation;

    #include <logdepthbuf_pars_fragment>

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

      gl_FragColor = vec4(color, alpha);

      #include <logdepthbuf_fragment>
    }
  `;

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
