import { BufferAttribute, Color, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';
import { WIND_UNIFORMS } from '../environment/wind';

/**
 * Flocks of birds circling over open land by day: one instanced mesh for
 * all of them (one draw call), every bird moved and flapping in the vertex
 * shader on the wind's clock, so they cost no work per frame and stand
 * still with a still frame. Each flock circles its centre, which drifts
 * slowly; birds wander in and out of the ring and up and down. Seen only
 * from afar: a bird nearer than BIRD_NEAR metres folds away, so none
 * passes the camera as a flat shape. At night they are gone, with the
 * player's plant motion off as well (it stands for motion on the map).
 */

/** Birds nearer the camera than this fold away, metres */
const BIRD_NEAR = 45;

export interface Flock {
  /** Scene position of the circle's centre (group space), at the height they fly */
  center: Vector3;
  radius: number;
  birds: number;
  /** 0..1, decides phases and speeds */
  seed: number;
}

export class BirdFlocks {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly material: ShaderMaterial;

  constructor() {
    // A bird: a body and two wings, six triangles; x across the wings (span 1), z along the body (nose at +z)
    const v = [
      // Left wing: shoulder front, shoulder back, tip
      -0.06, 0, 0.12, -0.06, 0, -0.1, -0.5, 0, -0.06,
      // Right wing
      0.06, 0, -0.1, 0.06, 0, 0.12, 0.5, 0, -0.06,
      // Body: nose, tail left, tail right
      0, 0, 0.3, -0.06, 0, -0.25, 0.06, 0, -0.25,
    ];
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
    g.instanceCount = 0;
    this.material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uColor: { value: new Color(0x1d1d20) }, uDay: { value: 1 } }]),
      vertexShader: BIRD_VERTEX,
      fragmentShader: BIRD_FRAGMENT,
      side: DoubleSide,
      fog: true,
    });
    this.material.uniforms['uWindTime'] = WIND_UNIFORMS.uWindTime;
    this.material.uniforms['uPlantSway'] = WIND_UNIFORMS.uPlantSway;
    this.material.name = 'custom-map-birds';
    this.mesh = new Mesh(g, this.material);
    this.mesh.name = 'custom-map-birds';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.userData['losTransparent'] = true;
    this.mesh.visible = false;
  }

  /** The flocks anew (none: nothing drawn) */
  set(flocks: readonly Flock[]): void {
    const total = flocks.reduce((n, f) => n + f.birds, 0);
    const flock = new Float32Array(total * 4);
    const bird = new Float32Array(total * 4);
    let k = 0;
    let seed = 1;
    const next = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const f of flocks) {
      seed = Math.max(1, Math.floor(f.seed * 2147483646));
      for (let b = 0; b < f.birds; b++, k++) {
        flock.set([f.center.x, f.center.y, f.center.z, f.radius], k * 4);
        // Phase on the circle, speed in m/s (with direction), radius and height offset
        bird.set([next() * Math.PI * 2, (7 + next() * 4) * (f.seed > 0.5 ? 1 : -1), 0.75 + next() * 0.5, (next() - 0.5) * 14], k * 4);
      }
    }
    const g = this.mesh.geometry;
    g.setAttribute('aFlock', new InstancedBufferAttribute(flock, 4));
    g.setAttribute('aBird', new InstancedBufferAttribute(bird, 4));
    g.instanceCount = total;
    this.mesh.visible = total > 0;
  }

  /** 0 by day, 1 at night: they fade out at dusk and are gone at night */
  setDarkness(darkness: number): void {
    const day = 1 - Math.min(1, Math.max(0, (darkness - 0.3) / 0.4));
    this.material.uniforms['uDay'].value = day;
    this.mesh.visible = day > 0 && this.mesh.geometry.instanceCount > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}

const BIRD_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute vec4 aFlock;
attribute vec4 aBird;
uniform float uWindTime;
uniform float uPlantSway;
uniform float uDay;
void main() {
  float t = uWindTime;
  float radius = aFlock.w * aBird.z * (1.0 + 0.12 * sin(t * 0.21 + aBird.x * 3.0));
  float angle = aBird.x + t * aBird.y / max(aFlock.w, 1.0);
  // The flock's centre drifts slowly
  vec3 centre = aFlock.xyz + vec3(sin(t * 0.031 + aFlock.x), 0.0, cos(t * 0.027 + aFlock.z)) * aFlock.w * 0.6;
  vec3 at = centre + vec3(cos(angle) * radius, aBird.w + sin(t * 0.4 + aBird.x * 5.0) * 3.0, sin(angle) * radius);
  // Heading along the circle
  vec3 fwd = normalize(vec3(-sin(angle), 0.0, cos(angle)) * sign(aBird.y));
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  // Wings beat, now and then a glide
  float glide = smoothstep(0.2, 0.6, sin(t * 0.35 + aBird.x * 7.0));
  float beat = sin(t * 11.0 + aBird.x * 13.0) * (1.0 - glide * 0.85);
  vec3 p = position;
  p.y += abs(p.x) * 1.4 * beat;
  float dist = length((modelMatrix * vec4(at, 1.0)).xyz - cameraPosition);
  // At least a few pixels from far away, folded away near the camera, by night and without motion
  float span = max(1.6, dist * 0.006) * smoothstep(${BIRD_NEAR.toFixed(1)}, ${(BIRD_NEAR * 1.6).toFixed(1)}, dist) * step(0.001, uPlantSway) * uDay;
  vec3 world = at + (side * p.x + vec3(0.0, p.y, 0.0) + fwd * p.z) * span;
  vec4 mvPosition = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const BIRD_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(uColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
