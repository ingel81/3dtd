import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  type Vector3,
} from 'three';

/**
 * Shafts of light standing up from the ground (catalogue effect `shaft`):
 * the glow out of a hell gate, a beacon fire's light in smoke, a ray from a
 * crystal. An open tube `radius` wide at its foot, a little wider at the
 * top, `height` high; additive, brightest seen across its middle (a volume
 * of lit air reads so), faint at the top. Light rises through it in slow
 * bands and the whole shaft breathes. Faint by day, full at night. One
 * instanced mesh for all shafts of a map; the motion is in the shaders.
 */

export interface Shaft {
  /** Scene position of the shaft's foot (group space) */
  origin: Vector3;
  radius: number;
  height: number;
  color: string;
}

export function buildShafts(shafts: readonly Shaft[], time: { value: number }, darkness: { value: number }): Mesh<InstancedBufferGeometry, ShaderMaterial> {
  // A tube from 0 to 1 high, radius 1 at the foot and 1.35 at the top
  const tube = new CylinderGeometry(1.35, 1, 1, 24, 6, true).translate(0, 0.5, 0);
  const g = new InstancedBufferGeometry();
  g.index = tube.index;
  g.setAttribute('position', tube.getAttribute('position'));
  g.setAttribute('normal', tube.getAttribute('normal'));
  const at = new Float32Array(shafts.length * 4);
  const size = new Float32Array(shafts.length * 2);
  const colors = new Float32Array(shafts.length * 3);
  const c = new Color();
  shafts.forEach((s, k) => {
    c.set(s.color);
    at.set([s.origin.x, s.origin.y, s.origin.z, Math.max(1, s.height)], k * 4);
    // Each shaft breathes at its own phase
    size.set([Math.max(0.2, s.radius), ((Math.abs(Math.sin(s.origin.x * 12.9898 + s.origin.z * 78.233)) * 43758.5453) % 1) * 6.283], k * 2);
    colors.set([c.r, c.g, c.b], k * 3);
  });
  g.setAttribute('aShaft', new InstancedBufferAttribute(at, 4));
  g.setAttribute('aSize', new InstancedBufferAttribute(size, 2));
  g.setAttribute('aColor', new InstancedBufferAttribute(colors, 3));
  g.instanceCount = shafts.length;
  tube.dispose();
  const material = new ShaderMaterial({
    uniforms: { uTime: time, uDarkness: darkness },
    vertexShader: SHAFT_VERTEX,
    fragmentShader: SHAFT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  material.name = 'custom-map-shafts';
  const mesh = new Mesh(g, material);
  mesh.name = 'custom-map-shafts';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.matrixAutoUpdate = false;
  mesh.userData['losTransparent'] = true;
  return mesh;
}

/** The shafts' mesh without shafts, to compile its program before a map gets its first (CustomMapView.effectTwins) */
export function shaftStandIn(): Mesh<InstancedBufferGeometry, ShaderMaterial> {
  return buildShafts([], { value: 0 }, { value: 0 });
}

const SHAFT_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aShaft;
attribute vec2 aSize;
attribute vec3 aColor;
varying float vUp;
varying float vAround;
varying float vPhase;
varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewDir;
varying float vNear;
void main() {
  vec3 p = vec3(position.x * aSize.x, position.y * aShaft.w, position.z * aSize.x);
  vec4 mvPosition = modelViewMatrix * vec4(aShaft.xyz + p, 1.0);
  vUp = position.y;
  vAround = atan(position.z, position.x);
  vPhase = aSize.y;
  vColor = aColor;
  vNormalV = normalize(normalMatrix * vec3(normal.x, 0.0, normal.z));
  vViewDir = normalize(-mvPosition.xyz);
  // Distance from the camera in shaft widths: a shaft the camera stands in or right by fades out
  vNear = -mvPosition.z / max(aSize.x * 3.0, 4.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`;

const SHAFT_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform float uDarkness;
varying float vUp;
varying float vAround;
varying float vPhase;
varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewDir;
varying float vNear;
void main() {
  #include <logdepthbuf_fragment>
  // Seen across its middle the lit air is thickest; its rim, seen edge on, thin
  float across = abs(dot(normalize(vNormalV), normalize(vViewDir)));
  // Bands of light rising, broken round the tube so they do not read as rings
  float bands = 0.72 + 0.18 * sin(vUp * 9.0 - uTime * 1.7 + sin(vAround * 3.0 + vPhase) * 1.4)
    + 0.1 * sin(vUp * 23.0 - uTime * 3.1 + vAround * 5.0);
  float breathe = 0.85 + 0.15 * sin(uTime * 1.3 + vPhase);
  float a = pow(1.0 - vUp, 1.15) * smoothstep(0.0, 0.05, vUp) * across * across * bands * breathe;
  // Faint by day, full in the dark; gone where the camera is close
  a *= mix(0.6, 1.25, uDarkness) * smoothstep(0.3, 1.0, vNear);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
