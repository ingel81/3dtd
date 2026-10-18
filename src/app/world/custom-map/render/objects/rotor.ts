import { BufferAttribute, type BufferGeometry, type Material, MeshDepthMaterial, RGBADepthPacking } from 'three';
import { WIND_UNIFORMS } from '../environment/wind';
import { SPIN_GLSL } from './spin';

/**
 * Parts that turn round a hub of their own (materials `rotor-…`, catalogue
 * `rotor`: seconds a turn): a windmill's sails, a water wheel, a wind
 * turbine's blades. Unlike `spin` parts (an upright axis through the
 * model's origin) the hub and axle come from the shape: a rotor is
 * rotationally symmetric (its sails, paddles or blades are copies turned
 * round the hub), so the mean of its vertices lies on the axle, and it is
 * flat across the axle, so the axle runs along its thinnest extent. All
 * rotor parts of a model share one hub. Every vertex carries it (`aRotor`:
 * hub x, y, z and the axle 0, 1, 2 for x, y, z); the turn is in the vertex
 * shader, on the wind's clock with each object's own starting angle, its
 * shadow turning with it (rotorDepthMaterial).
 */

/** Seconds a turn takes when the catalogue names none */
export const DEFAULT_ROTOR = 8;

export function isRotor(material: Material): boolean {
  return material.name.startsWith('rotor-');
}

/** The shared hub of rotor parts (model space) and the axle along their thinnest extent (0 x, 1 y, 2 z) */
export function rotorHub(geometries: readonly BufferGeometry[]): { hub: [number, number, number]; axle: number } {
  const sum = [0, 0, 0];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let n = 0;
  for (const g of geometries) {
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      const p = [pos.getX(k), pos.getY(k), pos.getZ(k)];
      for (let a = 0; a < 3; a++) {
        sum[a] += p[a];
        min[a] = Math.min(min[a], p[a]);
        max[a] = Math.max(max[a], p[a]);
      }
      n++;
    }
  }
  if (!n) return { hub: [0, 0, 0], axle: 1 };
  const extent = [0, 1, 2].map((a) => max[a] - min[a]);
  const axle = extent.indexOf(Math.min(...extent));
  return { hub: [sum[0] / n, sum[1] / n, sum[2] / n], axle };
}

/** A copy of a rotor part whose vertices carry the hub and axle (`aRotor`) */
export function rotorGeometry(source: BufferGeometry, hub: { hub: [number, number, number]; axle: number }): BufferGeometry {
  const out = source.clone();
  const count = source.getAttribute('position').count;
  const data = new Float32Array(count * 4);
  for (let k = 0; k < count; k++) data.set([...hub.hub, hub.axle], k * 4);
  out.setAttribute('aRotor', new BufferAttribute(data, 4));
  return out;
}

/** GLSL: the rotor's turn now (`rotorTurn(v)`: v turned round the hub; `rotorTurnDir(n)`: a direction turned) */
const ROTOR_GLSL = /* glsl */ `
attribute vec4 aRotor;
uniform float uRotorPeriod;
${SPIN_GLSL}
vec3 rotorAxle() {
  return aRotor.w < 0.5 ? vec3(1.0, 0.0, 0.0) : aRotor.w < 1.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
}
float rotorAngle() {
  float phase = 0.0;
  #ifdef USE_INSTANCING
  phase = spinAngle(instanceMatrix[3].xz);
  #endif
  return uWindTime * 6.2831853 / uRotorPeriod + phase;
}
// Rodrigues: v turned by a round the unit axle k
vec3 rotorTurnDir(vec3 v) {
  vec3 k = rotorAxle();
  float a = rotorAngle();
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
vec3 rotorTurn(vec3 v) {
  return aRotor.xyz + rotorTurnDir(v - aRotor.xyz);
}
`;

/** Turns a material's rotor part in its vertex shader (inside onBeforeCompile; needs uWindTime) */
export function addRotorTurn(shader: { vertexShader: string; uniforms: Record<string, { value: unknown }> }, period: { value: number }): void {
  shader.uniforms['uRotorPeriod'] = period;
  shader.vertexShader = shader.vertexShader
    // Before main, after whatever declares uWindTime (the wind's chunk, the depth material's own line)
    .replace('void main() {', `${ROTOR_GLSL}\nvoid main() {`)
    .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = rotorTurnDir(objectNormal);')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = rotorTurn(transformed);');
}

/** The shadow pass's material for a rotor part: its shadow turns with it */
export function rotorDepthMaterial(period: { value: number }): MeshDepthMaterial {
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  m.name = 'rotor-depth';
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uWindTime'] = WIND_UNIFORMS.uWindTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWindTime;');
    addRotorTurn(shader, period);
  };
  m.customProgramCacheKey = () => 'custom-map-rotor-depth';
  return m;
}
