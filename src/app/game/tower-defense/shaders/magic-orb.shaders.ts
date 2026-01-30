/**
 * Magic Orb Shaders
 *
 * Pulsating magical orb with swirling energy patterns:
 * - Dynamic color gradient (violet → cyan → white)
 * - Swirling Voronoi-like patterns
 * - Pulsating glow effect
 * - Additive blending for glowing magic
 */

export const MAGIC_ORB_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    vPosition = position;
    vNormal = normalize(normalMatrix * normal);

    // Use spherical UV mapping for seamless patterns
    vUv = vec2(
      0.5 + atan(position.z, position.x) / (2.0 * 3.14159265),
      0.5 - asin(position.y) / 3.14159265
    );

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

    #include <logdepthbuf_vertex>
  }
`;

export const MAGIC_ORB_FRAGMENT = /* glsl */ `
  precision highp float;
  #include <logdepthbuf_pars_fragment>

  uniform float uTime;
  uniform vec3 uColor1;      // Base color (e.g., deep purple)
  uniform vec3 uColor2;      // Mid color (e.g., cyan/blue)
  uniform vec3 uColor3;      // Highlight color (e.g., white)
  uniform float uIntensity;  // Overall glow intensity

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vUv;

  // Simple 2D hash (cheaper than sin-based noise)
  float hash(vec2 p) {
    float h = dot(p, vec2(127.1, 311.7));
    return fract(sin(h) * 43758.5453);
  }

  // Smooth noise using bilinear interpolation
  float smoothNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f); // Smoothstep

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Single-octave noise (was FBM with 2 octaves — one octave is enough for orb swirl)
  float fbm(vec2 p) {
    return smoothNoise(p);
  }

  // Voronoi-style cellular pattern (2×2 grid)
  float voronoi(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    float minDist = 1.0;

    for (int y = 0; y <= 1; y++) {
      for (int x = 0; x <= 1; x++) {
        vec2 neighbor = vec2(float(x), float(y));

        // Animated cell center — single hash call with offset
        vec2 cellOffset = vec2(
          hash(i + neighbor + uTime * 0.1),
          hash(i + neighbor + 100.0 + uTime * 0.1)
        );

        vec2 diff = neighbor + cellOffset - f;
        minDist = min(minDist, dot(diff, diff)); // squared distance (skip sqrt)
      }
    }

    return sqrt(minDist); // single sqrt at the end
  }

  void main() {
    // === Animated swirling pattern ===
    // Swirl UVs with simple offset (avoids per-fragment sin/cos rotation)
    vec2 swirlUv = vUv + uTime * vec2(0.08, -0.05);

    // Single noise sample for organic variation
    float noiseVal = fbm(swirlUv * 4.0 + uTime * 0.3);

    // Cellular energy pattern
    float cells = voronoi(swirlUv * 8.0 + uTime * 0.2);
    cells *= cells; // Sharpen the cells (cheaper than pow)

    // === Pulsing effect ===
    float pulse = 0.5 + 0.5 * sin(uTime * 3.0);

    // === Fresnel glow (edge highlight) ===
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
    fresnel *= fresnel; // pow(fresnel, 2.0) → multiply

    // === Color mixing ===
    // Base: deep magic color with noise
    vec3 baseColor = mix(uColor1, uColor2, noiseVal);

    // Add cellular highlights
    vec3 cellColor = mix(baseColor, uColor3, cells * 0.6);

    // Add fresnel edge glow
    vec3 finalColor = mix(cellColor, uColor3, fresnel * 0.8);

    // Apply pulsing intensity
    finalColor *= uIntensity * (0.8 + 0.4 * pulse);

    // === Sphere fade at edges for soft appearance ===
    float sphereFade = 1.0 - sqrt(fresnel);

    // Output with additive-friendly alpha
    gl_FragColor = vec4(finalColor, sphereFade * 0.9);

    #include <logdepthbuf_fragment>
  }
`;
