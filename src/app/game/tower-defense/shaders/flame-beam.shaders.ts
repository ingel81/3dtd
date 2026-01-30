/**
 * Flame Beam Shaders
 *
 * High-quality animated fire cone for Fire Tower flamethrower effect:
 * - Multi-octave FBM noise for realistic fire turbulence
 * - Hot white-yellow core fading to orange-red edges
 * - Volumetric-style layered noise for depth
 * - Animated distortion and flickering
 * - Log depth buffer support for 3D Tiles compatibility
 *
 * Used with ConeGeometry oriented from tower to target.
 */

export const FLAME_BEAM_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  varying vec2 vUv;
  varying float vProgress;  // 0 = base (tower), 1 = tip (target)
  varying vec3 vLocalPos;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vLocalPos = position;

    // Progress along the cone (Y-axis in cone local space)
    vProgress = (position.y + 0.5);

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

    #include <logdepthbuf_vertex>
  }
`;

export const FLAME_BEAM_FRAGMENT = /* glsl */ `
  precision highp float;
  #include <logdepthbuf_pars_fragment>

  uniform float uTime;
  uniform float uIntensity;
  uniform float uFlameSpeed;

  varying vec2 vUv;
  varying float vProgress;
  varying vec3 vLocalPos;
  varying vec3 vWorldPos;

  // Improved hash functions
  float hash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  // Gradient noise (smoother than value noise)
  float gnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    // Quintic interpolation for smoother results
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    float a = hash2(i);
    float b = hash2(i + vec2(1.0, 0.0));
    float c = hash2(i + vec2(0.0, 1.0));
    float d = hash2(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // Fractal Brownian Motion - 5 octaves for rich detail
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    float lacunarity = 2.0;
    float gain = 0.5;

    for (int i = 0; i < 5; i++) {
      value += amplitude * gnoise(p * frequency);
      frequency *= lacunarity;
      amplitude *= gain;
    }

    return value;
  }

  // Turbulent FBM (absolute value creates sharper ridges like flames)
  float turbulence(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for (int i = 0; i < 5; i++) {
      value += amplitude * abs(gnoise(p * frequency) * 2.0 - 1.0);
      frequency *= 2.0;
      amplitude *= 0.5;
    }

    return value;
  }

  // Domain warping for more organic movement
  vec2 warp(vec2 p, float time) {
    float n1 = fbm(p + time * 0.5);
    float n2 = fbm(p + vec2(5.2, 1.3) + time * 0.3);
    return p + vec2(n1, n2) * 0.3;
  }

  void main() {
    float time = uTime * uFlameSpeed;

    // === UV distortion for organic fire shape ===
    vec2 centeredUv = vUv - 0.5;
    float angle = atan(centeredUv.y, centeredUv.x);
    float radius = length(centeredUv) * 2.0;

    // Animate along the beam direction
    vec2 flowUv = vec2(
      vUv.x + sin(vProgress * 8.0 + time * 3.0) * 0.08 * (1.0 - vProgress),
      vProgress - time * 0.8
    );

    // Domain warping for more turbulent fire
    vec2 warpedUv = warp(flowUv * 3.0, time);

    // === Multiple noise layers for depth ===
    float baseNoise = fbm(warpedUv * 2.0 + time * 0.5);
    float detailNoise = turbulence(flowUv * 6.0 - time * 1.2);
    float fineNoise = gnoise(flowUv * 12.0 + time * 2.0);

    // Combine noise layers
    float fireShape = baseNoise * 0.6 + detailNoise * 0.3 + fineNoise * 0.1;

    // === Hot core calculation ===
    // Distance from center axis (creates hot core)
    float coreDistance = radius;
    float coreFactor = 1.0 - smoothstep(0.0, 0.6, coreDistance);
    coreFactor = pow(coreFactor, 1.5);

    // Pulsing core
    float pulse = sin(time * 8.0 + vProgress * 4.0) * 0.1 + 0.9;
    coreFactor *= pulse;

    // === Color palette (physically-inspired fire colors) ===
    vec3 white = vec3(1.0, 1.0, 0.95);           // Hottest - white
    vec3 brightYellow = vec3(1.0, 0.95, 0.6);   // Very hot - bright yellow
    vec3 yellow = vec3(1.0, 0.85, 0.2);         // Hot - yellow
    vec3 orange = vec3(1.0, 0.55, 0.1);         // Medium - orange
    vec3 deepOrange = vec3(1.0, 0.35, 0.05);    // Cooler - deep orange
    vec3 red = vec3(0.9, 0.15, 0.0);            // Cool - red
    vec3 darkRed = vec3(0.4, 0.05, 0.0);        // Coldest - dark red/ember

    // === Color mixing based on temperature ===
    // Temperature decreases with distance from core and along beam
    float temperature = coreFactor * (1.0 - vProgress * 0.4);
    temperature += fireShape * 0.25;
    temperature = clamp(temperature, 0.0, 1.0);

    vec3 fireColor;
    if (temperature > 0.85) {
      // White-hot core
      fireColor = mix(brightYellow, white, (temperature - 0.85) / 0.15);
    } else if (temperature > 0.65) {
      // Yellow zone
      fireColor = mix(yellow, brightYellow, (temperature - 0.65) / 0.2);
    } else if (temperature > 0.45) {
      // Orange zone
      fireColor = mix(orange, yellow, (temperature - 0.45) / 0.2);
    } else if (temperature > 0.25) {
      // Deep orange zone
      fireColor = mix(deepOrange, orange, (temperature - 0.25) / 0.2);
    } else if (temperature > 0.1) {
      // Red zone
      fireColor = mix(red, deepOrange, (temperature - 0.1) / 0.15);
    } else {
      // Dark red/ember at edges
      fireColor = mix(darkRed, red, temperature / 0.1);
    }

    // === Bright flickering highlights ===
    float flicker = pow(fineNoise, 4.0) * coreFactor;
    fireColor = mix(fireColor, white, flicker * 0.5);

    // === Alpha calculation ===
    // Radial falloff (soft edges)
    float radialAlpha = 1.0 - smoothstep(0.2, 0.85, radius);
    radialAlpha = pow(radialAlpha, 0.8);

    // Add noise to edges for irregular flame shape
    float edgeNoise = detailNoise * 0.4 + baseNoise * 0.3;
    radialAlpha *= smoothstep(0.1, 0.5, radialAlpha + edgeNoise * 0.3);

    // Fade at tip (fire dissipates)
    float tipFade = 1.0 - smoothstep(0.6, 1.0, vProgress);
    tipFade = pow(tipFade, 0.7);

    // Base fade (less fire at very start too)
    float baseFade = smoothstep(0.0, 0.15, vProgress);

    // Flickering alpha
    float alphaFlicker = 0.85 + fireShape * 0.15;

    // Combined alpha
    float alpha = radialAlpha * tipFade * baseFade * alphaFlicker * uIntensity;

    // Boost core visibility
    alpha = mix(alpha, min(alpha * 1.5, 1.0), coreFactor * 0.5);

    // Discard transparent pixels
    if (alpha < 0.02) discard;

    // === Final output ===
    // HDR-style bloom effect on hot areas
    float bloom = pow(temperature, 3.0) * 0.3;
    fireColor *= 1.0 + bloom;

    // Additive blending friendly output
    gl_FragColor = vec4(fireColor * alpha * uIntensity, alpha);

    #include <logdepthbuf_fragment>
  }
`;

/**
 * Default uniform values for flame beam shader
 */
export const FLAME_BEAM_UNIFORMS = {
  uTime: { value: 0.0 },
  uIntensity: { value: 1.0 },
  uFlameSpeed: { value: 1.5 },
};
