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
import { WIND_UNIFORMS } from '../environment/wind';
import { SPIN_GLSL } from '../objects/spin';

/**
 * Light beams that sweep round (catalogue effect `beam`: a lighthouse):
 * two cones from the light, opposite each other, turning with the object's
 * spinning parts (objects/spin.ts, same clock and starting angle). Additive,
 * brightest along their middle and near the light, shown by darkness. One
 * instanced mesh for all; the turn is in the vertex shader. A cone widening
 * down into the water or the land showed there as a broad bright band cut
 * off hard where it went under: its lower side fades out before it sinks to
 * the light's foot, a beam fades where the camera comes close to it, and
 * seen from above (a faint streak in clear air, not a bright band) and
 * towards its far end.
 */

export interface Beam {
  /** Scene position of the light (group space) */
  origin: Vector3;
  /** Metres the light stands above the object's foot: the beam fades out before it sinks that far */
  rise: number;
  /** Metres the beam reaches */
  length: number;
  color: string;
  /** Seconds a turn takes */
  period: number;
}

export function buildBeams(beams: readonly Beam[], darkness: { value: number }): Mesh<InstancedBufferGeometry, ShaderMaterial> {
  // A narrow cone along +x from 0 (at the light) to 1, wider at the far end
  const cone = new CylinderGeometry(0.09, 0.012, 1, 14, 1, true).rotateZ(-Math.PI / 2).translate(0.5, 0, 0);
  const g = new InstancedBufferGeometry();
  g.index = cone.index;
  g.setAttribute('position', cone.getAttribute('position'));
  g.setAttribute('normal', cone.getAttribute('normal'));
  const n = beams.length * 2;
  const at = new Float32Array(n * 4);
  const turn = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const c = new Color();
  beams.forEach((b, k) => {
    c.set(b.color);
    for (let side = 0; side < 2; side++) {
      const i = k * 2 + side;
      at.set([b.origin.x, b.origin.y, b.origin.z, b.length], i * 4);
      turn.set([Math.max(0.5, b.period), side * Math.PI, Math.max(1, b.rise)], i * 3);
      colors.set([c.r, c.g, c.b], i * 3);
    }
  });
  g.setAttribute('aBeam', new InstancedBufferAttribute(at, 4));
  g.setAttribute('aTurn', new InstancedBufferAttribute(turn, 3));
  g.setAttribute('aColor', new InstancedBufferAttribute(colors, 3));
  g.instanceCount = n;
  cone.dispose();
  const material = new ShaderMaterial({
    uniforms: { uWindTime: WIND_UNIFORMS.uWindTime, uDarkness: darkness },
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  material.name = 'custom-map-beams';
  const mesh = new Mesh(g, material);
  mesh.name = 'custom-map-beams';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.matrixAutoUpdate = false;
  mesh.userData['losTransparent'] = true;
  return mesh;
}

const BEAM_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${SPIN_GLSL}
attribute vec4 aBeam;
attribute vec3 aTurn;
attribute vec3 aColor;
uniform float uWindTime;
varying float vAlong;
varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewDir;
varying float vNear;
varying float vSink;
varying float vAbove;
void main() {
  float a = uWindTime * 6.2831853 / aTurn.x + spinAngle(aBeam.xz) + aTurn.y;
  mat2 turn = mat2(cos(a), sin(a), -sin(a), cos(a));
  vec3 p = position * aBeam.w;
  p.xz = turn * p.xz;
  vec3 n = normal;
  n.xz = turn * n.xz;
  vec4 mvPosition = modelViewMatrix * vec4(aBeam.xyz + p, 1.0);
  // How steeply the camera looks down onto the beam: from above, a beam in clear air is a faint streak
  vAbove = normalize(cameraPosition - (modelMatrix * vec4(aBeam.xyz + p, 1.0)).xyz).y;
  vAlong = position.x;
  // How far below the light, in parts of its height over the foot
  vSink = -p.y / aTurn.z;
  vColor = aColor;
  vNormalV = normalize(normalMatrix * n);
  vViewDir = normalize(-mvPosition.xyz);
  // Distance from the camera in beam lengths (at least 12 m): a cone the camera is inside or close to fades out
  vNear = -mvPosition.z / max(aBeam.w * 0.25, 12.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`;

const BEAM_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uDarkness;
varying float vAlong;
varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewDir;
varying float vNear;
varying float vSink;
varying float vAbove;
void main() {
  #include <logdepthbuf_fragment>
  // Fades along its length; seen across, its middle is brighter than its edges; soft at the light, gone near the camera
  float across = abs(dot(normalize(vNormalV), normalize(vViewDir)));
  float a = pow(1.0 - vAlong, 2.0) * smoothstep(0.0, 0.04, vAlong) * (0.2 + 0.8 * across * across) * 0.45 * uDarkness;
  a *= smoothstep(0.15, 1.0, vNear) * (1.0 - smoothstep(0.3, 0.8, vSink)) * (1.0 - 0.75 * smoothstep(0.25, 0.85, vAbove));
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
