/**
 * Line-of-Sight Hatching Shaders
 *
 * Animierte Schraffur-Visualisierung für Tower-Reichweite:
 * - Sichtbare Felder: Dezentes Punkt-Raster (grün, pulsierend)
 * - Blockierte Felder: Diagonale Schraffur (rot, wandernd)
 *
 * Verwendet InstancedMesh für optimale Performance (1 Draw Call statt 500+)
 */

export const LOS_HATCHING_VERTEX = /* glsl */ `
  // Per-instance attributes
  attribute float aIsBlocked;

  // Varyings to fragment shader
  varying vec2 vLocalPos;
  varying vec3 vWorldPos;
  varying float vIsBlocked;

  void main() {
    // Local position for edge detection (before instance transform)
    vLocalPos = position.xy;
    vIsBlocked = aIsBlocked;

    // Get world position for consistent pattern across instances
    vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;

    gl_Position = projectionMatrix * modelViewMatrix * worldPosition;
  }
`;

export const LOS_HATCHING_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uVisibleColor;
  uniform vec3 uBlockedColor;
  uniform float uVisibleOpacity;
  uniform float uBlockedOpacity;
  uniform float uHexRadius;

  varying vec2 vLocalPos;
  varying vec3 vWorldPos;
  varying float vIsBlocked;

  void main() {
    // Choose color based on blocked state
    vec3 color = mix(uVisibleColor, uBlockedColor, vIsBlocked);
    float baseOpacity = mix(uVisibleOpacity, uBlockedOpacity, vIsBlocked);

    // === Blocked Pattern: Diagonal hatching lines ===
    float blockedSpacing = 3.0;
    float blockedLineWidth = 0.25;
    // Diagonal stripes that animate slowly
    float diagonal = (vWorldPos.x + vWorldPos.z + uTime * 1.5) / blockedSpacing;
    float blockedPattern = smoothstep(0.0, 0.08, abs(fract(diagonal) - 0.5) - blockedLineWidth);
    blockedPattern = 1.0 - blockedPattern;

    // === Visible Pattern: Subtle dot grid ===
    float visibleSpacing = 5.0;
    float dotRadius = 0.12 + sin(uTime * 2.0) * 0.02; // Gentle pulsing
    vec2 gridPos = mod(vWorldPos.xz, visibleSpacing) / visibleSpacing;
    float distToCenter = length(gridPos - 0.5);
    float visiblePattern = 1.0 - smoothstep(dotRadius, dotRadius + 0.08, distToCenter);

    // Combine patterns based on blocked state
    float pattern = mix(visiblePattern, blockedPattern, vIsBlocked);

    // === Edge fade for soft hex boundaries ===
    // Use local position (hex geometry centered at origin)
    float distFromHexCenter = length(vLocalPos);
    float edgeFade = 1.0 - smoothstep(uHexRadius * 0.7, uHexRadius * 0.95, distFromHexCenter);

    // === Final color ===
    float alpha = pattern * baseOpacity * edgeFade;

    // Discard fully transparent pixels for performance
    if (alpha < 0.01) discard;

    gl_FragColor = vec4(color, alpha);
  }
`;
