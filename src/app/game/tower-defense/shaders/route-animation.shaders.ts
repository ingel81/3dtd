/**
 * Route Animation Shaders
 *
 * Knight Rider Effekt: Leuchtender Kopf + nachleuchtender Schweif
 * läuft von Spawn → HQ und signalisiert Gefahr.
 */

export const ROUTE_ANIMATION_VERTEX = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const ROUTE_ANIMATION_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;
