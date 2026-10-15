import { Mesh, ShaderMaterial, type BufferGeometry } from 'three';
import { SHADER_NOISE } from '../shader-noise';
import { SCENE_COPY_GLSL, type SceneCopy } from './scene-copy';

/**
 * Heat shimmering over lava (the lavaGlow effect): a sheet over the lava's
 * own geometry, 0.4 m up, that draws the frame behind it (SceneCopy) moved
 * by slow rising noise, so the lava and whatever stands beyond it waver.
 * Weaker with distance, faded where the lava is shallow (its rim).
 *
 * The copy holds the frame as the target stores it; the sheet writes it
 * back without tone mapping (it is tone mapped already on the canvas, and
 * the post target's OutputPass maps it once).
 */
export function setHeatHaze(owner: Mesh<BufferGeometry, ShaderMaterial>, copy: SceneCopy | null): void {
  let haze = owner.userData['heatHaze'] as Mesh<BufferGeometry, ShaderMaterial> | undefined;
  if (!copy) {
    if (haze) {
      haze.material.dispose();
      haze.removeFromParent();
      delete owner.userData['heatHaze'];
    }
    return;
  }
  if (!haze) {
    haze = heatHazeMesh(owner.geometry, owner.material.uniforms['uTime'], copy);
    haze.position.y = 0.4;
    owner.add(haze);
    owner.userData['heatHaze'] = haze;
  }
  // The owner's geometry is rebuilt on edits: follow it
  haze.geometry = owner.geometry;
  haze.updateMatrix();
}

/**
 * A shimmering sheet over `geometry` (its `aDepth` attribute fades it: 0 at
 * a rim, 1 inside), drawing the frame behind it moved by rising noise on
 * `time`: over lava, and over a life area of hot ground (effects/life-haze.ts)
 */
export function heatHazeMesh(geometry: BufferGeometry, time: { value: number }, copy: SceneCopy): Mesh<BufferGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    uniforms: { uTime: time, ...copy.uniforms },
    vertexShader: HAZE_VERTEX,
    fragmentShader: HAZE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  material.name = 'custom-map-heat-haze';
  const haze = new Mesh(geometry, material);
  haze.name = 'custom-map-heat-haze';
  haze.renderOrder = 4;
  haze.userData['losTransparent'] = true;
  haze.onBeforeRender = (renderer) => copy.capture(renderer);
  return haze;
}

const HAZE_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aDepth;
varying vec3 vWorldPos;
varying float vDepth;
void main() {
  vDepth = aDepth;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
  #include <logdepthbuf_vertex>
}
`;

const HAZE_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
varying vec3 vWorldPos;
varying float vDepth;
${SHADER_NOISE}
${SCENE_COPY_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  float dist = length(cameraPosition - vWorldPos);
  // Rising: the noise runs up the screen over time, two scales
  vec2 p = vWorldPos.xz * 0.6;
  vec2 n = vec2(valueNoise(p + vec2(0.0, uTime * 1.8)), valueNoise(p * 1.7 + vec2(5.3, uTime * 2.3))) - 0.5;
  float strength = clamp(30.0 / max(dist, 1.0), 0.15, 1.0) * smoothstep(0.1, 0.6, vDepth);
  if (strength < 0.01) discard;
  vec2 offset = n * 0.006 * strength;
  vec3 behind = sceneBehind(offset);
  gl_FragColor = vec4(behind, 1.0);
  #include <colorspace_fragment>
}
`;
