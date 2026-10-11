import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';
import { SHADER_NOISE } from '../shader-noise';

/**
 * Waterfall sheets: per waterfall object a curved strip from its lip down to
 * its foot, the water streaking down it. Local frame of the object: the lip
 * runs along x at `height`, the water leaves towards +z (the object's front)
 * and falls to y = 0, bulging out a little as it drops. All sheets of a map
 * share one geometry buffer (merged in scene space) and one material.
 */

export interface WaterfallSpec {
  /** Object matrix (position, rotation, scale) in the map group */
  matrix: Matrix4;
  /** Half width at scale 1 */
  radius: number;
  /** Drop height at scale 1 */
  height: number;
}

const ROWS = 16;
const COLS = 8;

export function buildWaterfalls(
  specs: WaterfallSpec[],
  time: { value: number },
  light: { value: number },
): Mesh<BufferGeometry, ShaderMaterial> {
  const perSheet = (ROWS + 1) * (COLS + 1);
  const pos = new Float32Array(specs.length * perSheet * 3);
  const uv = new Float32Array(specs.length * perSheet * 2);
  const across = new Float32Array(specs.length * perSheet);
  const index: number[] = [];
  const v = { x: 0, y: 0, z: 0 };
  specs.forEach((spec, s) => {
    const e = spec.matrix.elements;
    const base = s * perSheet;
    for (let r = 0; r <= ROWS; r++) {
      const t = r / ROWS;
      // Out from the lip, then straight down with a slight bulge
      const y = spec.height * (1 - t * t * 0.15 - t * 0.85);
      const z = Math.min(spec.height * 0.2, 3) * Math.sqrt(t);
      for (let c = 0; c <= COLS; c++) {
        const x = (c / COLS - 0.5) * 2 * spec.radius;
        v.x = x;
        v.y = y;
        v.z = z;
        const k = base + r * (COLS + 1) + c;
        pos[k * 3] = e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12];
        pos[k * 3 + 1] = e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13];
        pos[k * 3 + 2] = e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14];
        uv[k * 2] = (c / COLS) * spec.radius * 0.5;
        uv[k * 2 + 1] = t * spec.height * 0.25;
        across[k] = c / COLS;
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = base + r * (COLS + 1) + c;
        const b = a + COLS + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setAttribute('aAcross', new BufferAttribute(across, 1));
  g.setIndex(index);
  g.computeBoundingSphere();

  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog]),
    vertexShader: WATERFALL_VERTEX,
    fragmentShader: WATERFALL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
  });
  material.uniforms['uTime'] = time;
  material.uniforms['uLight'] = light;
  material.name = 'custom-map-waterfall';
  const mesh = new Mesh(g, material);
  mesh.name = 'custom-map-waterfalls';
  mesh.renderOrder = 2;
  mesh.userData['losTransparent'] = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

const WATERFALL_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute float aAcross;
varying vec2 vUv;
varying float vAcross;
void main() {
  vUv = uv;
  vAcross = aAcross;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const WATERFALL_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform float uLight;
varying vec2 vUv;
varying float vAcross;
${SHADER_NOISE}
void main() {
  #include <logdepthbuf_fragment>
  // Streaks stretched along the fall, scrolling down, faster near the foot
  float speed = 1.6;
  vec2 p = vec2(vUv.x * 6.0, vUv.y * 1.2 - uTime * speed);
  float streak = valueNoise(p * vec2(1.0, 0.25)) * 0.6 + valueNoise(p * vec2(2.3, 0.5) + 7.0) * 0.4;
  float foam = smoothstep(0.45, 0.85, streak);
  vec3 deep = vec3(0.32, 0.45, 0.5);
  vec3 white = vec3(0.92, 0.96, 0.97);
  vec3 color = mix(deep, white, foam * 0.8 + 0.15) * uLight;
  // Sides fray (noisy edge), the lip starts thin
  float edge = min(vAcross, 1.0 - vAcross) + (streak - 0.5) * 0.12;
  float side = smoothstep(0.0, 0.1, edge);
  float alpha = (0.55 + foam * 0.4) * smoothstep(0.0, 0.06, vUv.y);
  gl_FragColor = vec4(color, alpha * side);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
