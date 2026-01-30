/**
 * Route Animation Shaders
 *
 * Knight Rider effect: Glowing head + glowing tail
 * runs from Spawn → HQ and signals danger.
 */

export const ROUTE_ANIMATION_VERTEX = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const ROUTE_ANIMATION_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;
