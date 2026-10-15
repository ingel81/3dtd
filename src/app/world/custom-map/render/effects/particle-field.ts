import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import type { EffectKind } from '../asset-catalog';
import { WIND_UNIFORMS } from '../environment/wind';

/**
 * Particles of map effects, one instanced mesh per effect kind for the whole
 * map. Every particle is stateless: its position, size and colour come from
 * its emitter (origin, radius, height, colour), a seed and the time, all in
 * the vertex shader. A particle loops through its life (phase = time * rate
 * + seed), so nothing is simulated or uploaded per frame: the CPU only
 * advances a time uniform.
 *
 * Quads face the camera. Fire, embers, sparks, fireflies and sparkle add light
 * (additive, no depth write); smoke, fog banks, leaves and snow blend
 * normally. Weather (rain, snow around the camera) is weather.ts.
 *
 * A smoke column (`column`) is one tall plume per emitter: puffs rise
 * `height` metres from a foot of `radius`, slowing and widening as they
 * climb, lean further with the wind the higher they are and thin out at
 * the top. Their phases are spread evenly over the life, so the column is
 * filled from foot to top at any time, and each puff is torn by a
 * scrolling noise instead of a round disc. An emitter's `glow` lights the
 * column's foot from below (lava, a fire), strongest at night.
 */

export type ParticleKind = Exclude<EffectKind, 'waterfall' | 'birds' | 'beam'> | 'spray' | 'dust';

const KIND_ID: Record<ParticleKind, number> = {
  fire: 0,
  smoke: 1,
  embers: 2,
  fireflies: 3,
  fog: 4,
  leaves: 5,
  snow: 6,
  sparkle: 7,
  spray: 8,
  sparks: 9,
  dust: 10,
  column: 11,
};

/** Per kind: particle life (s), size (m), default colour, additive, particles per unit rate */
const KIND_LOOK: Record<ParticleKind, { life: number; size: number; color: string; additive: boolean }> = {
  fire: { life: 0.9, size: 0.55, color: '#ff8a2a', additive: true },
  smoke: { life: 6, size: 2.2, color: '#6e6a66', additive: false },
  embers: { life: 2.5, size: 0.07, color: '#ffae4a', additive: true },
  fireflies: { life: 8, size: 0.22, color: '#d8ff6a', additive: true },
  fog: { life: 30, size: 14, color: '#c8d0d4', additive: false },
  leaves: { life: 9, size: 0.18, color: '#b0702a', additive: false },
  snow: { life: 10, size: 0.08, color: '#ffffff', additive: false },
  sparkle: { life: 1.6, size: 0.15, color: '#ffffff', additive: true },
  spray: { life: 2.2, size: 3.2, color: '#eef4f6', additive: false },
  sparks: { life: 1.4, size: 0.16, color: '#ffb040', additive: true },
  dust: { life: 4, size: 1.2, color: '#c8a878', additive: false },
  column: { life: 16, size: 3.4, color: '#5e5852', additive: false },
};

export interface ParticleEmitter {
  kind: ParticleKind;
  /** Scene position of the emitter's base */
  origin: Vector3;
  radius: number;
  height: number;
  /** Particles alive at once (rate x life) */
  count: number;
  color: string | undefined;
  /** Size multiplier */
  scale: number;
  /** #rrggbb light from below the foot (a column over lava or a fire); none without */
  glow?: string;
}

export class ParticleField {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;

  constructor(
    readonly kind: ParticleKind,
    emitters: ParticleEmitter[],
    time: { value: number },
    light: { value: number },
  ) {
    const look = KIND_LOOK[kind];
    const total = emitters.reduce((n, e) => n + e.count, 0);
    const origin = new Float32Array(total * 3);
    const shape = new Float32Array(total * 4);
    const colors = new Float32Array(total * 3);
    const glows = new Float32Array(total * 3);
    const c = new Color();
    const glow = new Color();
    let i = 0;
    let seed = 1;
    for (const e of emitters) {
      c.set(e.color ?? look.color);
      glow.set(e.glow ?? 0x000000);
      // A column's puffs at evenly spread phases (a little jitter), each column on its own beat: no gaps up its length
      const start = seed / 2147483647;
      for (let k = 0; k < e.count; k++, i++) {
        origin.set([e.origin.x, e.origin.y, e.origin.z], i * 3);
        seed = (seed * 16807) % 2147483647;
        const s = kind === 'column' ? start + (k + 0.3 + 0.4 * (seed / 2147483647)) / e.count : seed / 2147483647;
        shape.set([e.radius, e.height, look.size * e.scale, s], i * 4);
        colors.set([c.r, c.g, c.b], i * 3);
        glows.set([glow.r, glow.g, glow.b], i * 3);
      }
    }
    const quad = new PlaneGeometry(1, 1);
    const g = new InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    g.setAttribute('aOrigin', new InstancedBufferAttribute(origin, 3));
    g.setAttribute('aShape', new InstancedBufferAttribute(shape, 4));
    g.setAttribute('aColor', new InstancedBufferAttribute(colors, 3));
    g.setAttribute('aGlow', new InstancedBufferAttribute(glows, 3));
    g.instanceCount = total;
    quad.dispose();
    g.boundingSphere = null;

    const material = new ShaderMaterial({
      // Kind and fog are uniforms, not defines: every kind shares one program
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        { uLife: { value: look.life }, uKind: { value: KIND_ID[kind] }, uFogged: { value: look.additive ? 0 : 1 } },
      ]),
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: look.additive ? AdditiveBlending : NormalBlending,
      // Fog would add its colour to additive light; those fade by distance in their own colour instead (uFogged)
      fog: true,
    });
    material.uniforms['uTime'] = time;
    material.uniforms['uLight'] = light;
    material.uniforms['uWindDir'] = WIND_UNIFORMS.uWindDir;
    material.uniforms['uWindStrength'] = WIND_UNIFORMS.uWindStrength;
    material.name = `custom-map-particles-${kind}`;
    this.mesh = new Mesh(g, material);
    this.mesh.name = material.name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = look.additive ? 3 : 2;
    this.mesh.userData['losTransparent'] = true;
    this.mesh.matrixAutoUpdate = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}

/** Particles alive at once for an effect, from its rate (per second) or a per-kind default */
export function particleCount(kind: ParticleKind, rate: number | undefined): number {
  const life = KIND_LOOK[kind].life;
  const defaults: Record<ParticleKind, number> = {
    fire: 28,
    smoke: 3,
    embers: 6,
    fireflies: 3,
    fog: 0.25,
    leaves: 2,
    snow: 6,
    sparkle: 8,
    spray: 14,
    sparks: 6,
    dust: 12,
    column: 8,
  };
  return Math.max(1, Math.min(400, Math.round((rate ?? defaults[kind]) * life)));
}

const PARTICLE_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute vec3 aOrigin;
attribute vec4 aShape;
attribute vec3 aColor;
attribute vec3 aGlow;
uniform float uTime;
uniform float uLife;
uniform float uLight;
uniform int uKind;
uniform vec2 uWindDir;
uniform float uWindStrength;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vPuff;

float rnd(float s) { return fract(sin(s * 91.3458) * 47453.5453); }

void main() {
  float radius = aShape.x;
  float height = aShape.y;
  float size = aShape.z;
  float seed = aShape.w;
  float t = uTime / uLife + seed;
  float phase = fract(t);
  float cycle = floor(t);
  // A new spot each cycle, inside the emitter's disc
  float a = rnd(seed + cycle * 1.37) * 6.2832;
  float r = sqrt(rnd(seed * 3.1 + cycle)) * radius;
  vec3 p = aOrigin + vec3(cos(a) * r, 0.0, sin(a) * r);
  float alpha = 1.0;
  vec3 color = aColor;
  vec3 glow = vec3(0.0);
  vPuff = vec2(0.0);
if (uKind == 0) {
  // Fire: rises fast, narrows, red at the top
  p.y += height + phase * size * 2.6;
  p.xz += vec2(sin(uTime * 7.0 + seed * 20.0), cos(uTime * 6.0 + seed * 13.0)) * 0.05 * phase;
  size *= (1.0 - phase * 0.7);
  color = mix(vec3(1.0, 0.85, 0.45), aColor * vec3(1.0, 0.45, 0.25), phase);
  alpha = smoothstep(0.0, 0.15, phase) * (1.0 - phase);
} else if (uKind == 1) {
  // Smoke: rises slowly, grows, drifts with the wind
  p.y += height + phase * 9.0;
  p.xz += uWindDir * phase * (1.0 + 8.0 * uWindStrength);
  size *= 0.5 + phase * 1.6;
  alpha = smoothstep(0.0, 0.2, phase) * (1.0 - phase) * 0.45;
} else if (uKind == 2) {
  // Embers: rise and wander, cool down
  p.y += height + phase * 5.0;
  p.xz += vec2(sin(phase * 9.0 + seed * 30.0), cos(phase * 7.0 + seed * 17.0)) * 0.6;
  color = mix(vec3(1.0, 0.8, 0.4), aColor * 0.6, phase);
  alpha = (1.0 - phase) * (0.6 + 0.4 * sin(uTime * 20.0 + seed * 50.0));
} else if (uKind == 3) {
  // Fireflies: hover and wander in the area, blink
  p = aOrigin + vec3(
    sin(uTime * 0.31 + seed * 40.0) * radius,
    height + 0.5 + sin(uTime * 0.53 + seed * 17.0) * 0.8 + rnd(seed) * 1.5,
    cos(uTime * 0.27 + seed * 23.0) * radius);
  alpha = smoothstep(0.55, 1.0, sin(uTime * (1.1 + rnd(seed) * 1.4) + seed * 60.0));
} else if (uKind == 4) {
  // Fog bank: big soft sheets drifting slowly near the ground
  p.y += height + 1.5 + rnd(seed * 7.0) * 3.0;
  p.xz += uWindDir * (phase - 0.5) * radius * (0.3 + 0.8 * uWindStrength);
  alpha = sin(phase * 3.1416) * 0.18;
} else if (uKind == 5) {
  // Falling leaves: from the crown height, tumbling and swaying
  p.y += height * (1.0 - phase);
  p.xz += vec2(sin(phase * 8.0 + seed * 9.0), cos(phase * 6.0 + seed * 5.0)) * 1.2 + uWindDir * phase * (0.8 + 6.0 * uWindStrength);
  size *= 0.6 + 0.4 * abs(sin(uTime * 3.0 + seed * 30.0));
  alpha = smoothstep(0.0, 0.05, phase) * smoothstep(1.0, 0.92, phase);
} else if (uKind == 6) {
  // Snow over an area: drifting down
  p.y += height * (1.0 - phase);
  p.xz += vec2(sin(phase * 5.0 + seed * 11.0), cos(phase * 4.0 + seed * 7.0)) * 0.8 + uWindDir * phase * (0.5 + 4.0 * uWindStrength);
  alpha = smoothstep(0.0, 0.05, phase) * smoothstep(1.0, 0.9, phase) * 0.9;
} else if (uKind == 7) {
  // Sparkle: twinkles in place
  p.y += height * rnd(seed * 5.0 + cycle);
  alpha = sin(phase * 3.1416);
  alpha *= alpha;
} else if (uKind == 9) {
  // Sparks: shot up and out in bursts, falling back; bright at night, faint by day (uLight is the day's light)
  float s = phase * uLife;
  float up = 4.0 + rnd(seed * 7.0 + cycle) * 5.0;
  p.y += height + up * s - 4.9 * s * s;
  p.xz += vec2(cos(a * 3.0), sin(a * 3.0)) * (0.8 + rnd(seed * 11.0 + cycle) * 1.6) * s;
  color = mix(vec3(1.0, 0.95, 0.7), aColor, phase);
  alpha = (1.0 - phase) * step(0.5, rnd(seed * 5.0 + cycle * 0.7)) * mix(1.0, 0.3, clamp(uLight, 0.0, 1.0));
} else if (uKind == 10) {
  // Dust devil: a whirl wandering round its spot (radius), dust spiralling up and spreading at the top; each lives
  // about 40 s of every minute. Its own seed comes from its spot, so all its particles share the whirl
  float own = fract(aOrigin.x * 0.137 + aOrigin.z * 0.071) * 100.0;
  vec2 centre = aOrigin.xz + vec2(sin(uTime * 0.07 + own), cos(uTime * 0.05 + own * 1.3)) * radius;
  float alive = fract(uTime / 60.0 + own * 0.01);
  float on = smoothstep(0.0, 0.08, alive) * (1.0 - smoothstep(0.6, 0.68, alive));
  float turn = seed * 40.0 + uTime * 3.0 + phase * 8.0;
  float wide = 0.6 + phase * phase * 4.0;
  p = vec3(centre.x, aOrigin.y, centre.y) + vec3(cos(turn) * wide, height + phase * 18.0, sin(turn) * wide);
  size *= 0.5 + phase * 2.5;
  alpha = smoothstep(0.0, 0.1, phase) * (1.0 - phase) * 0.35 * on;
} else if (uKind == 11) {
  // Smoke column: rises fast from the foot and slows, widens, leans with the wind the higher it is and wanders as a
  // whole (its own beat from its foot); dense and dark low, thinner and paler high, gone smoothly at the top
  float own = fract(aOrigin.x * 0.137 + aOrigin.z * 0.071) * 100.0;
  float f = 1.0 - pow(1.0 - phase, 1.4);
  float wide = radius * (1.0 + 4.0 * f);
  float turn = a + phase * 2.5;
  float off = sqrt(rnd(seed * 5.3 + cycle)) * wide * 0.7;
  vec2 lean = uWindDir * height * (0.1 + 0.9 * uWindStrength) * f * f;
  vec2 wander = vec2(sin(uTime * 0.13 + f * 4.0 + own), cos(uTime * 0.11 + f * 3.3 + own * 1.7)) * wide * 0.3 * f;
  p = aOrigin + vec3(cos(turn) * off + lean.x + wander.x, f * height, sin(turn) * off + lean.y + wander.y);
  size *= 0.6 + 2.4 * f;
  color = aColor * mix(0.75, 1.3, f);
  alpha = smoothstep(0.0, 0.04, phase) * (1.0 - smoothstep(0.5, 1.0, phase)) * 0.75;
  // Lit from below: strong at the foot, a warm tint a third of the way up; brighter at night (uLight low)
  glow = aGlow * pow(1.0 - f, 2.0) * (1.25 - 0.75 * clamp(uLight, 0.0, 1.0));
  // The puff's own noise: where it starts (seed) and how far it has torn (phase)
  vPuff = vec2(rnd(seed * 13.0 + cycle) * 37.0, phase);
} else {
  // Spray at a waterfall's foot: billows up and out from where the water lands
  p.xz += vec2(cos(a), sin(a)) * phase * 2.5;
  p.y += height + phase * 3.5 - phase * phase * 2.0;
  size *= 0.4 + phase * 1.2;
  alpha = smoothstep(0.0, 0.15, phase) * (1.0 - phase) * 0.75;
}
  vUv = uv;
if (uKind == 1 || uKind == 4 || uKind == 5 || uKind == 6 || uKind == 8 || uKind == 10 || uKind == 11) {
  // Lit things (smoke, fog, leaves, snow, spray) follow the scene's light; glowing ones do not
  color *= uLight;
}
  vColor = color + glow;
  vAlpha = alpha;
  // Camera-facing quad around p
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  mvPosition.xy += position.xy * size;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const PARTICLE_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform int uKind;
uniform float uFogged;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vPuff;

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + 1.0), f.x), f.y);
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float shape;
if (uKind == 5) {
  // Leaf: a small pointed oval
  shape = smoothstep(1.0, 0.8, length(d * vec2(2.4, 1.2)) * 2.0);
} else if (uKind == 11) {
  // Column puff: a soft disc torn by two octaves of noise that scroll up through it, more torn as it ages; its top
  // half a little lighter (the sky's light from above)
  vec2 q = vUv * 2.0 + vPuff.x + vec2(0.0, -vPuff.y * 1.8);
  q += vec2(noise2(q * 1.7 + 3.3), noise2(q * 1.7 + 9.1)) * 0.8;
  float n = noise2(q) * 0.65 + noise2(q * 2.3 + 7.1) * 0.35;
  shape = smoothstep(0.08 + 0.3 * vPuff.y, 0.8, (1.0 - r) * (0.1 + 1.4 * n));
} else if (uKind == 1 || uKind == 4 || uKind == 8 || uKind == 10) {
  // Smoke, fog and dust: very soft puffs
  shape = pow(max(1.0 - r, 0.0), 1.6);
} else {
  shape = pow(max(1.0 - r, 0.0), 2.2);
}
  float alpha = shape * vAlpha;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(uKind == 11 ? vColor * (0.85 + 0.3 * vUv.y) : vColor, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  if (uFogged > 0.5) {
    #include <fog_fragment>
  }
}
`;
