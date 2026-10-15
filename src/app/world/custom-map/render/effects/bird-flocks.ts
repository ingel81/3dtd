import {
  BufferAttribute,
  Color,
  DataTexture,
  DoubleSide,
  FloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import { WIND_UNIFORMS } from '../environment/wind';
import type { MapBirdSpecies } from '../../map-document';

/**
 * Flocks of birds by day (songbirds, gulls, crows, birds of prey: BIRD_LOOK): one instanced mesh for all of them (one draw
 * call), every bird moved and flapping in the vertex shader on the wind's
 * clock, so they cost no work per frame and stand still with a still frame.
 * Each flock flies a closed loop: a circle (a flock placed as an object, the
 * map's own over open land), a loop inside a life area's outline, or out
 * along a route and back (map-life.ts). The loops sit in one float texture,
 * PATH_SAMPLES points each, evenly along their length; birds stray to the
 * loop's sides and up and down, and the whole loop drifts a little. Seen only
 * from afar: a bird nearer than BIRD_NEAR metres folds away, so none passes
 * the camera as a flat shape. At night they are gone, with the player's
 * plant motion off as well (it stands for motion on the map).
 */

/**
 * How each kind of bird looks and flies: colour, size (wingspan factor),
 * wing beats per second (radians), how much of the time it glides (added to
 * the glide wave: 0 songbirds, near 1 mostly gliding), its speed as a share
 */
export const BIRD_LOOK: Readonly<Record<MapBirdSpecies, { color: number; size: number; beat: number; glide: number; speed: number }>> = {
  songbirds: { color: 0x1d1d20, size: 1, beat: 11, glide: 0, speed: 1 },
  gulls: { color: 0xd4d8dc, size: 1.5, beat: 6, glide: 0.35, speed: 0.9 },
  crows: { color: 0x0e0e10, size: 1.3, beat: 8, glide: 0.1, speed: 0.85 },
  raptors: { color: 0x3a2c22, size: 2.6, beat: 4, glide: 0.8, speed: 0.6 },
};

/** Birds nearer the camera than this fold away, metres */
const BIRD_NEAR = 45;
/** Points of each flock's loop in the path texture, and most flocks */
const PATH_SAMPLES = 64;
export const MAX_FLOCKS = 64;

export interface Flock {
  /** The closed loop the flock flies, scene points (group space) at the height they fly; at least two */
  path: Vector3[];
  birds: number;
  /** How far birds stray to the loop's sides, metres */
  spread: number;
  /** How far the whole loop drifts about, metres */
  drift: number;
  /** 0..1, decides phases, speeds and the direction they fly */
  seed: number;
  /** What flies (default songbirds) */
  species?: MapBirdSpecies;
}

/** A flock circling `center` (scene space, at the height they fly) `radius` wide; its middle wanders about */
export function circleFlock(center: Vector3, radius: number, birds: number, seed: number): Flock {
  const path: Vector3[] = [];
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    path.push(new Vector3(center.x + Math.cos(a) * radius, center.y, center.z + Math.sin(a) * radius));
  }
  return { path, birds, spread: radius * 0.25, drift: radius * 0.6, seed };
}

export class BirdFlocks {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly material: ShaderMaterial;
  private paths = new DataTexture(new Float32Array(PATH_SAMPLES * 4), PATH_SAMPLES, 1, RGBAFormat, FloatType);

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
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uDay: { value: 1 } }]),
      vertexShader: BIRD_VERTEX,
      fragmentShader: BIRD_FRAGMENT,
      side: DoubleSide,
      fog: true,
    });
    this.material.uniforms['uWindTime'] = WIND_UNIFORMS.uWindTime;
    this.material.uniforms['uPlantSway'] = WIND_UNIFORMS.uPlantSway;
    this.material.uniforms['uPaths'] = { value: this.paths };
    this.material.name = 'custom-map-birds';
    this.mesh = new Mesh(g, this.material);
    this.mesh.name = 'custom-map-birds';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.userData['losTransparent'] = true;
    this.mesh.visible = false;
  }

  /** The flocks anew (none: nothing drawn); beyond MAX_FLOCKS they are left out */
  set(all: readonly Flock[]): void {
    const flocks = all.filter((f) => f.path.length >= 2 && f.birds > 0).slice(0, MAX_FLOCKS);
    const total = flocks.reduce((n, f) => n + f.birds, 0);
    const rows = Math.max(1, flocks.length);
    const texels = new Float32Array(PATH_SAMPLES * rows * 4);
    const flock = new Float32Array(total * 4);
    const bird = new Float32Array(total * 4);
    const looks = new Float32Array(total * 4);
    const tints = new Float32Array(total * 3);
    const c = new Color();
    let k = 0;
    let seed = 1;
    const next = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    flocks.forEach((f, row) => {
      const length = writeLoop(f.path, texels, row * PATH_SAMPLES * 4);
      seed = Math.max(1, Math.floor(f.seed * 2147483646));
      const look = BIRD_LOOK[f.species ?? 'songbirds'];
      c.setHex(look.color);
      for (let b = 0; b < f.birds; b++, k++) {
        flock.set([(row + 0.5) / rows, length, f.spread, f.drift], k * 4);
        // Where on the loop it starts, speed in m/s (with direction), side and height offset
        bird.set([next(), (7 + next() * 4) * look.speed * (f.seed > 0.5 ? 1 : -1), next() * 2 - 1, (next() - 0.5) * 14], k * 4);
        looks.set([look.size * (0.9 + next() * 0.2), look.beat, look.glide, 0], k * 4);
        tints.set([c.r, c.g, c.b], k * 3);
      }
    });
    this.paths.dispose();
    this.paths = new DataTexture(texels, PATH_SAMPLES, rows, RGBAFormat, FloatType);
    this.paths.magFilter = NearestFilter;
    this.paths.minFilter = NearestFilter;
    this.paths.needsUpdate = true;
    this.material.uniforms['uPaths'].value = this.paths;
    const g = this.mesh.geometry;
    g.setAttribute('aFlock', new InstancedBufferAttribute(flock, 4));
    g.setAttribute('aBird', new InstancedBufferAttribute(bird, 4));
    g.setAttribute('aLook', new InstancedBufferAttribute(looks, 4));
    g.setAttribute('aTint', new InstancedBufferAttribute(tints, 3));
    g.instanceCount = total;
    this.mesh.visible = total > 0 && this.material.uniforms['uDay'].value > 0;
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
    this.paths.dispose();
    this.mesh.removeFromParent();
  }
}

/** The loop's PATH_SAMPLES points evenly along its length into `out` from `at`; returns the length (along the ground) */
function writeLoop(path: readonly Vector3[], out: Float32Array, at: number): number {
  const n = path.length;
  const cumulative = [0];
  for (let k = 1; k <= n; k++) {
    const a = path[k - 1];
    const b = path[k % n];
    cumulative.push(cumulative[k - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const length = Math.max(cumulative[n], 1);
  let seg = 0;
  for (let s = 0; s < PATH_SAMPLES; s++) {
    const d = (s / PATH_SAMPLES) * cumulative[n];
    while (seg < n - 1 && cumulative[seg + 1] < d) seg++;
    const a = path[seg];
    const b = path[(seg + 1) % n];
    const span = cumulative[seg + 1] - cumulative[seg];
    const t = span > 0 ? (d - cumulative[seg]) / span : 0;
    out[at + s * 4] = a.x + (b.x - a.x) * t;
    out[at + s * 4 + 1] = a.y + (b.y - a.y) * t;
    out[at + s * 4 + 2] = a.z + (b.z - a.z) * t;
    out[at + s * 4 + 3] = 1;
  }
  return length;
}

const BIRD_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute vec4 aFlock;
attribute vec4 aBird;
attribute vec4 aLook;
attribute vec3 aTint;
varying vec3 vTint;
uniform float uWindTime;
uniform float uPlantSway;
uniform float uDay;
uniform sampler2D uPaths;
const float SAMPLES = ${PATH_SAMPLES.toFixed(1)};
// A point of the flock's loop at sample position u (wraps round), between two texels
vec3 loopAt(float u) {
  float i0 = mod(floor(u), SAMPLES);
  float i1 = mod(i0 + 1.0, SAMPLES);
  vec3 a = texture2D(uPaths, vec2((i0 + 0.5) / SAMPLES, aFlock.x)).xyz;
  vec3 b = texture2D(uPaths, vec2((i1 + 0.5) / SAMPLES, aFlock.x)).xyz;
  return mix(a, b, fract(u));
}
void main() {
  float t = uWindTime;
  float u = fract(aBird.x + t * aBird.y / max(aFlock.y, 1.0)) * SAMPLES;
  vec3 on = loopAt(u);
  // Heading along the loop, the way the flock flies
  vec3 ahead = loopAt(u + 0.6) - loopAt(u + SAMPLES - 0.6);
  vec3 fwd = normalize(vec3(ahead.x, 0.0, ahead.z) * sign(aBird.y) + vec3(1e-4, 0.0, 0.0));
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  // The loop drifts slowly; each bird keeps to its side of it, wandering in and out, and up and down
  vec3 drift = vec3(sin(t * 0.031 + aFlock.x * 40.0), 0.0, cos(t * 0.027 + aFlock.x * 60.0)) * aFlock.w;
  float stray = aBird.z * aFlock.z * (1.0 + 0.5 * sin(t * 0.21 + aBird.x * 19.0));
  vec3 at = on + drift + side * stray + vec3(0.0, aBird.w + sin(t * 0.4 + aBird.x * 31.0) * 3.0, 0.0);
  // Wings beat, now and then a glide
  float glide = smoothstep(0.2, 0.6, sin(t * 0.35 + aBird.x * 44.0) + aLook.z);
  float beat = sin(t * aLook.y + aBird.x * 82.0) * (1.0 - glide * 0.85);
  vTint = aTint;
  vec3 p = position;
  p.y += abs(p.x) * 1.4 * beat;
  float dist = length((modelMatrix * vec4(at, 1.0)).xyz - cameraPosition);
  // At least a few pixels from far away, folded away near the camera, by night and without motion
  float span = max(1.6, dist * 0.006) * aLook.x * smoothstep(${BIRD_NEAR.toFixed(1)}, ${(BIRD_NEAR * 1.6).toFixed(1)}, dist) * step(0.001, uPlantSway) * uDay;
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
varying vec3 vTint;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(vTint, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
