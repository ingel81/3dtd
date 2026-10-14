import { InstancedMesh, Mesh, PlaneGeometry, ShaderMaterial, type IUniform, type Object3D } from 'three';

/**
 * Soft round shadows under enemies and the hero, on worlds that ask for
 * them (WorldCapabilities.groundShadows: custom maps, whose sun casts real
 * shadows of trees and buildings; on tiles nothing does). Enemies and the
 * hero are not in the cached shadow map: they move every frame.
 *
 * Per enemy type a second instanced mesh shares the type pool's instance
 * matrices and slide offsets (aPrevOffset, uStateLerp), so it costs no
 * per-frame work on the CPU: one small draw per type. Air units get none.
 */

let blobMaterial: ShaderMaterial | null = null;

function material(stateLerp: IUniform<number>): ShaderMaterial {
  if (blobMaterial) return blobMaterial;
  blobMaterial = new ShaderMaterial({
    uniforms: { uStateLerp: stateLerp },
    vertexShader: BLOB_VERTEX,
    fragmentShader: BLOB_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  blobMaterial.name = 'blob-shadow';
  return blobMaterial;
}

/**
 * A blob under every instance of `pool` (`radius` metres at scale 1),
 * following its count, matrices and slide; returns the blob mesh, added
 * beside the pool
 */
export function attachBlobShadow(pool: InstancedMesh, radius: number, stateLerp: IUniform<number>): InstancedMesh {
  const quad = new PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2);
  const blob = new InstancedMesh(quad, material(stateLerp), 1);
  blob.name = `${pool.name || 'enemies'}-blob`;
  blob.frustumCulled = false;
  blob.renderOrder = 1;
  blob.userData['losTransparent'] = true;
  blob.onBeforeRender = () => {
    // The pool grows by replacing its attributes: follow them
    blob.count = pool.visible ? pool.count : 0;
    blob.instanceMatrix = pool.instanceMatrix;
    const slide = pool.geometry.getAttribute('aPrevOffset');
    if (slide && quad.getAttribute('aPrevOffset') !== slide) quad.setAttribute('aPrevOffset', slide);
  };
  blob.count = 0;
  pool.parent?.add(blob);
  return blob;
}

/** One blob under a single object (the hero), its own mesh; follows `target` each frame */
export function singleBlobShadow(target: Object3D, radius: number): Mesh {
  const blob = new Mesh(new PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2), SINGLE_MATERIAL());
  blob.name = 'hero-blob';
  blob.position.y = 0.06;
  blob.renderOrder = 1;
  blob.userData['losTransparent'] = true;
  target.add(blob);
  return blob;
}

let single: ShaderMaterial | null = null;
function SINGLE_MATERIAL(): ShaderMaterial {
  if (single) return single;
  single = new ShaderMaterial({ vertexShader: SINGLE_VERTEX, fragmentShader: BLOB_FRAGMENT, transparent: true, depthWrite: false });
  single.name = 'blob-shadow-single';
  return single;
}

const BLOB_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aPrevOffset;
uniform float uStateLerp;
varying vec2 vBlob;
void main() {
  // The enemy's foot: its instance position (and its slide), the quad flat under it at its scale
  float s = length(instanceMatrix[0].xyz);
  vec3 foot = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz + aPrevOffset * (1.0 - uStateLerp);
  vec4 world = vec4(foot + vec3(position.x * s, 0.06, position.z * s), 1.0);
  vBlob = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const SINGLE_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vBlob;
void main() {
  vBlob = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const BLOB_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec2 vBlob;
void main() {
  #include <logdepthbuf_fragment>
  // Dark under the feet, fading out to the quad's rim
  float r = length(vBlob);
  float a = (1.0 - smoothstep(0.3, 1.0, r)) * 0.45;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;
