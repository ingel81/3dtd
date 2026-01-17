/**
 * Magic Orb Shaders
 *
 * Pulsierender magischer Orb mit wirbelnden Energie-Mustern:
 * - Dynamischer Farbverlauf (violett → cyan → weiß)
 * - Wirbelende Voronoi-ähnliche Muster
 * - Pulsierender Glow-Effekt
 * - Additive Blending für leuchtende Magie
 */

export const MAGIC_ORB_VERTEX = /* glsl */ `
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
  }
`;

export const MAGIC_ORB_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor1;      // Base color (e.g., deep purple)
  uniform vec3 uColor2;      // Mid color (e.g., cyan/blue)
  uniform vec3 uColor3;      // Highlight color (e.g., white)
  uniform float uIntensity;  // Overall glow intensity

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vUv;

  // Simple 2D noise function
  float noise(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // Smooth noise using bilinear interpolation
  float smoothNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f); // Smoothstep

    float a = noise(i);
    float b = noise(i + vec2(1.0, 0.0));
    float c = noise(i + vec2(0.0, 1.0));
    float d = noise(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Fractal Brownian Motion for organic patterns
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for (int i = 0; i < 4; i++) {
      value += amplitude * smoothNoise(p * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
    }

    return value;
  }

  // Voronoi-style cellular pattern
  float voronoi(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    float minDist = 1.0;

    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = vec2(float(x), float(y));
        vec2 point = i + neighbor;

        // Animated cell centers
        vec2 cellOffset = vec2(
          noise(point + uTime * 0.1),
          noise(point + uTime * 0.1 + 100.0)
        );

        vec2 diff = neighbor + cellOffset - f;
        float dist = length(diff);
        minDist = min(minDist, dist);
      }
    }

    return minDist;
  }

  void main() {
    // === Animated swirling pattern ===
    // Rotate UV coordinates over time for swirling effect
    float angle = uTime * 0.5;
    vec2 rotatedUv = vec2(
      vUv.x * cos(angle) - vUv.y * sin(angle),
      vUv.x * sin(angle) + vUv.y * cos(angle)
    );

    // Multi-scale noise for depth
    float noise1 = fbm(rotatedUv * 3.0 + uTime * 0.3);
    float noise2 = fbm(rotatedUv * 6.0 - uTime * 0.4);
    float combinedNoise = (noise1 + noise2) * 0.5;

    // Cellular energy pattern
    float cells = voronoi(rotatedUv * 8.0 + uTime * 0.2);
    cells = pow(cells, 2.0); // Sharpen the cells

    // === Pulsing effect ===
    float pulse = 0.5 + 0.5 * sin(uTime * 3.0);

    // === Fresnel glow (edge highlight) ===
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
    fresnel = pow(fresnel, 2.0);

    // === Color mixing ===
    // Base: deep magic color with noise
    vec3 baseColor = mix(uColor1, uColor2, combinedNoise);

    // Add cellular highlights
    vec3 cellColor = mix(baseColor, uColor3, cells * 0.6);

    // Add fresnel edge glow
    vec3 finalColor = mix(cellColor, uColor3, fresnel * 0.8);

    // Apply pulsing intensity
    finalColor *= uIntensity * (0.8 + 0.4 * pulse);

    // === Sphere fade at edges for soft appearance ===
    float sphereFade = 1.0 - pow(fresnel, 0.5);

    // Output with additive-friendly alpha
    gl_FragColor = vec4(finalColor, sphereFade * 0.9);
  }
`;
