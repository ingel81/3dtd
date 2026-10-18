import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  Matrix4,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Camera,
  type WebGLRenderer,
} from 'three';
import { mulberry32 } from '../../../../utils/game-rng';
import { HEIGHT_FOG_UNIFORMS } from './height-fog';

/**
 * The lightning of a storm (MapWeather `storm`, TODO E243): drawn and heard,
 * never simulated. Its own random numbers (never the run's), so a coop guest
 * and a replay see other strikes and the checksums never notice.
 *
 * A strike is either a cloud-to-ground bolt or a flash inside the clouds.
 * - Bolt: a channel from the cloud base to the ground, built once per strike
 *   on the CPU into a fixed buffer of segments (MAX_SEGMENTS): a slow wander
 *   of the whole channel, a zigzag of short steps on it (real lightning
 *   turns some 15 degrees every few metres), branches forking off downwards
 *   in its upper part that die out before the ground, now and then a branch
 *   of a branch. First the leader creeps down (faint, LEADER_S), then the
 *   return stroke lights the channel; two or three strokes follow each other
 *   within a third of a second, the branches lit only by the first. Where it
 *   meets the ground a glow lights the spot. One instanced draw: a camera
 *   facing ribbon per segment, a hot core and a violet glow around it, at
 *   least a pixel and a bit wide however far, the top fading into the cloud
 *   base, far bolts dimmed by the haze.
 * - Cloud flash: two or three soft pulses lighting the clouds from inside.
 *
 * Both light the sky (`flash` towards `flashDir`, sky-dome.ts) and the scene
 * (the environment lifts its hemisphere and ambient light and the haze for
 * the flash, CustomMapEnvironment.applyFlash): no light is added, no
 * material compiles. `onStrike` tells the sound (soundscape.ts thunder) how
 * far and to which side, the thunder follows at the speed of sound.
 *
 * `setFlashShare` dims everything for players sensitive to flashing light
 * (the setting "Lightning flashes"): below 1 the strokes merge into one
 * smooth swell, no flicker. In full a strike has at most three pulses and
 * strikes come no closer than MIN_GAP_S, under three flashes a second.
 */

/** Segments a bolt may have, its branches and the glow on the ground included */
export const MAX_SEGMENTS = 512;
/** Seconds the leader takes from the cloud base to the ground */
const LEADER_S = 0.05;
/** Seconds after the last stroke until the strike is over */
const AFTERGLOW_S = 0.9;
/** The least gap between two strikes, seconds */
export const MIN_GAP_S = 1.6;
/** Metres of the channel's steps */
const STEP_M = 9;
/** The colour of the flash's light (linear), a cold violet white */
export const FLASH_COLOR = new Color(0.78, 0.82, 1.0);

/** What the sound needs of a strike: how far it was from the camera, to which side, how strong */
export interface LightningStrike {
  kind: 'ground' | 'cloud';
  /** Metres from the camera to the nearest point of the channel (a cloud flash: to its light) */
  distance: number;
  /** -1 left .. 1 right of the camera */
  pan: number;
  /** 0..1 */
  power: number;
}

export class Lightning {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** Called as a strike begins (the light arrives at once, the sound follows by its distance) */
  onStrike: ((strike: Readonly<LightningStrike>) => void) | null = null;
  /**
   * Called at each stroke of a bolt with where it struck (scene space) and
   * how bright, the flash share applied: the land's light pulses there
   * (CustomMapWorld, the shots' light)
   */
  onStroke: ((x: number, y: number, z: number, strength: number) => void) | null = null;
  /** How bright the flash is now, for sky and scene (0 none, about 1 a close bolt), dimmed by the share */
  flash = 0;
  /** Scene direction from the camera towards the flash */
  readonly flashDir = new Vector3(0, 1, 0);

  private readonly random: () => number;
  private strength = 0;
  private share = 1;
  /** Branches per step at full detail (the quality level's particle share scales it) */
  private detail = 1;
  private clock = 0;
  private nextAt = Number.POSITIVE_INFINITY;
  /** The strike shown: when it began, its kind, its pulses */
  private strikeAt = Number.NEGATIVE_INFINITY;
  private bolt = false;
  private readonly pulseAt = new Float32Array(4);
  private readonly pulseAmp = new Float32Array(4);
  private readonly pulseDecay = new Float32Array(4);
  private readonly pulseAttack = new Float32Array(4);
  private pulses = 0;
  /** The next stroke onStroke has not heard of */
  private stroke = 0;
  private endsAt = Number.NEGATIVE_INFINITY;
  private readonly starts: Float32Array;
  private readonly ends: Float32Array;
  private readonly shapes: Float32Array;
  private segments = 0;
  private readonly heard: LightningStrike = { kind: 'ground', distance: 0, pan: 0, power: 0 };
  private readonly cam = new Vector3();
  private readonly look = new Vector3();
  private readonly right = new Vector3();
  private readonly top = new Vector3();
  private readonly ground = new Vector3();
  private readonly near = new Vector3();
  private readonly size = new Vector2();
  private readonly toLocal = new Matrix4();
  /** Ground height at a scene point (x, z), the view's terrain; flat at the focus without one */
  private groundAt: ((x: number, z: number) => number) | null = null;

  constructor(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.random = mulberry32(seed);
    const g = new InstancedBufferGeometry();
    // A ribbon: x along the segment (0 start, 1 end), y across (-1, 1)
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    this.starts = new Float32Array(MAX_SEGMENTS * 3);
    this.ends = new Float32Array(MAX_SEGMENTS * 3);
    this.shapes = new Float32Array(MAX_SEGMENTS * 4);
    g.setAttribute('aStart', new InstancedBufferAttribute(this.starts, 3));
    g.setAttribute('aEnd', new InstancedBufferAttribute(this.ends, 3));
    // Width (m), brightness, level (0 the channel, 1 and 2 branches, 3 the glow on the ground), when the leader reaches it (0..1)
    g.setAttribute('aShape', new InstancedBufferAttribute(this.shapes, 4));
    // One dark segment, so the warm-up (withAllShown) draws the program once
    g.instanceCount = 1;
    const material = new ShaderMaterial({
      uniforms: {
        uFlash: { value: 0 },
        uBranch: { value: 1 },
        uReveal: { value: 1 },
        uViewHeight: { value: 1080 },
        uCore: { value: new Color(0.95, 0.96, 1.0) },
        uGlow: { value: new Color(0.5, 0.52, 1.0) },
        uFogDensity: HEIGHT_FOG_UNIFORMS.uFogDensity,
        uFogStart: HEIGHT_FOG_UNIFORMS.uFogStart,
      },
      vertexShader: BOLT_VERTEX,
      fragmentShader: BOLT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      // The ribbon's winding follows the camera's side of it
      side: DoubleSide,
    });
    material.name = 'custom-map-lightning';
    this.mesh = new Mesh(g, material);
    this.mesh.name = 'custom-map-lightning';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.userData['losTransparent'] = true;
    this.mesh.visible = false;
  }

  /** The terrain's height at a scene point, for where a bolt ends */
  setGround(groundAt: ((x: number, z: number) => number) | null): void {
    this.groundAt = groundAt;
  }

  /** 0 no storm (no new strikes; one running ends) .. 1 the wildest */
  setStorm(strength: number): void {
    const k = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0));
    if (k > 0 && this.strength === 0) this.nextAt = this.clock + 2 + this.random() * 4;
    if (k === 0) this.nextAt = Number.POSITIVE_INFINITY;
    this.strength = k;
  }

  /** The player's flash brightness, 0..1 (render-quality.ts `lightningFlash`): under 1 dimmer and without flicker */
  setFlashShare(share: number): void {
    this.share = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 1));
  }

  /** The quality level's detail, 0..1: fewer branches below 1, no branches of branches under 0.5 */
  setDetail(detail: number): void {
    this.detail = Math.min(1, Math.max(0, detail));
  }

  /** Whether a strike is being shown */
  get active(): boolean {
    return this.clock < this.endsAt;
  }

  /**
   * Per frame: maybe a new strike around `focus` (scene space, the ground the
   * camera looks at), and the flash and the bolt of the one shown
   */
  update(dt: number, camera: Camera, focus: Vector3, renderer: WebGLRenderer | null): void {
    this.clock += dt;
    if (this.clock >= this.nextAt) this.strike(camera, focus);
    if (!this.active) {
      this.flash = 0;
      this.mesh.visible = false;
      return;
    }
    const t = this.clock - this.strikeAt;
    const envelope = this.envelope(t);
    this.flash = envelope * this.share;
    const u = this.mesh.material.uniforms;
    if (!this.bolt) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    // Each stroke lights the land where it struck
    while (this.stroke < this.pulses && t >= this.pulseAt[this.stroke]) {
      this.onStroke?.(this.ground.x, this.ground.y, this.ground.z, this.pulseAmp[this.stroke] * this.share);
      this.stroke++;
    }
    const first = this.pulseAt[0];
    // The leader creeps down faintly, then the strokes light the channel; it glows on a little between them
    const leading = t < first;
    u['uReveal'].value = leading ? t / first : 1;
    const between = t < this.pulseAt[this.pulses - 1] + 0.1 ? 0.07 : 0;
    u['uFlash'].value = (leading ? 0.16 : Math.max(envelope, between)) * (0.45 + 0.55 * this.share);
    // The branches carry the first stroke only
    u['uBranch'].value = leading ? 1 : 0.15 + 0.85 * Math.exp(-(t - first) / 0.06);
    if (renderer) u['uViewHeight'].value = renderer.getDrawingBufferSize(this.size).y || 1080;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
    this.onStrike = null;
    this.onStroke = null;
  }

  /** The strike's brightness at `t` seconds after it began: its pulses, each a fast rise and an exponential fall */
  private envelope(t: number): number {
    let e = 0;
    for (let i = 0; i < this.pulses; i++) {
      const tau = t - this.pulseAt[i];
      if (tau < 0) continue;
      const a = this.pulseAttack[i];
      e += this.pulseAmp[i] * (tau < a ? tau / a : Math.exp(-(tau - a) / this.pulseDecay[i]));
    }
    return e;
  }

  /** A new strike, and when the next one comes */
  private strike(camera: Camera, focus: Vector3): void {
    const r = this.random;
    const k = this.strength;
    // A storm of strength 0.6 strikes every 11 s on average, the wildest every 6 s; a quarter come in pairs
    const mean = 18 - 12 * k;
    this.nextAt = this.clock + (r() < 0.25 ? MIN_GAP_S + r() * 2.5 : Math.max(MIN_GAP_S, mean * (0.35 + r() * 1.3)));
    this.strikeAt = this.clock;
    camera.getWorldPosition(this.cam);
    camera.getWorldDirection(this.look);
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.right.y = 0;
    this.right.normalize();
    const parent = this.mesh.parent;
    if (parent) {
      parent.worldToLocal(this.cam);
      this.look.transformDirection(this.toLocal.copy(parent.matrixWorld).invert());
    }
    const from = Number.isFinite(focus.x) ? focus : this.cam;
    // Most strikes where the camera looks, the rest anywhere around (heard, and seen in the sky)
    const yaw = Math.atan2(this.look.z, this.look.x);
    const angle = r() < 0.7 ? yaw + (r() - 0.5) * 1.7 : r() * Math.PI * 2;
    this.bolt = r() < 0.4 + 0.25 * k;
    this.heard.kind = this.bolt ? 'ground' : 'cloud';
    if (this.bolt) {
      // A third close by, on the ground the camera sees from its height; the rest out over the land
      const height = Math.max(0, this.cam.y - from.y);
      const dist = r() < 0.35 ? 30 + r() * Math.max(150, height) : 300 + 1900 * Math.pow(r(), 1.3);
      const gx = from.x + Math.cos(angle) * dist;
      const gz = from.z + Math.sin(angle) * dist;
      this.ground.set(gx, this.groundAt ? this.groundAt(gx, gz) : from.y, gz);
      this.top.set(gx + (r() - 0.5) * 160, this.ground.y + 430 + r() * 280, gz + (r() - 0.5) * 160);
      this.build();
      this.timeStrokes();
      // The nearest point of the channel to the camera
      const dx = this.ground.x - this.top.x;
      const dy = this.ground.y - this.top.y;
      const dz = this.ground.z - this.top.z;
      const along = Math.min(1, Math.max(0, ((this.cam.x - this.top.x) * dx + (this.cam.y - this.top.y) * dy + (this.cam.z - this.top.z) * dz) / (dx * dx + dy * dy + dz * dz)));
      this.near.set(this.top.x + dx * along, this.top.y + dy * along, this.top.z + dz * along);
      this.flashDir.set(this.top.x - this.cam.x, this.top.y - this.cam.y, this.top.z - this.cam.z).normalize();
      this.heard.power = 1;
    } else {
      const dist = 700 + 2800 * r();
      this.near.set(from.x + Math.cos(angle) * dist, from.y + 600 + r() * 400, from.z + Math.sin(angle) * dist);
      this.flashDir.subVectors(this.near, this.cam).normalize();
      this.timeCloud();
      this.heard.power = 0.45;
    }
    this.endsAt = this.strikeAt + this.pulseAt[this.pulses - 1] + AFTERGLOW_S;
    this.stroke = 0;
    const toX = this.near.x - this.cam.x;
    const toZ = this.near.z - this.cam.z;
    const flat = Math.hypot(toX, toZ) || 1;
    this.heard.distance = this.near.distanceTo(this.cam);
    this.heard.pan = (toX * this.right.x + toZ * this.right.z) / flat;
    this.onStrike?.(this.heard);
  }

  /** A bolt's strokes: two or three, a third of a second at most; one smooth swell when dimmed */
  private timeStrokes(): void {
    const r = this.random;
    if (this.share < 1) {
      this.pulses = 1;
      this.pulse(0, LEADER_S, 0.9, 0.09, 0.5);
      return;
    }
    const n = r() < 0.55 ? 3 : 2;
    this.pulses = n;
    let at = LEADER_S;
    this.pulse(0, at, 1, 0.006, 0.075);
    for (let i = 1; i < n; i++) {
      at += 0.06 + r() * 0.07;
      this.pulse(i, at, 0.45 + r() * 0.45, 0.006, 0.05 + r() * 0.04);
    }
  }

  /** A flash in the clouds: two or three soft pulses, or one swell when dimmed */
  private timeCloud(): void {
    const r = this.random;
    if (this.share < 1) {
      this.pulses = 1;
      this.pulse(0, 0, 0.5, 0.12, 0.45);
      return;
    }
    const n = 2 + Math.floor(r() * 2);
    this.pulses = n;
    let at = 0;
    for (let i = 0; i < n; i++) {
      this.pulse(i, at, 0.3 + r() * 0.35, 0.02, 0.07 + r() * 0.08);
      at += 0.09 + r() * 0.14;
    }
  }

  private pulse(i: number, at: number, amp: number, attack: number, decay: number): void {
    this.pulseAt[i] = at;
    this.pulseAmp[i] = amp;
    this.pulseAttack[i] = attack;
    this.pulseDecay[i] = decay;
  }

  /**
   * The channel from `top` to `ground` into the segment buffer: a slow
   * wander of the whole, a zigzag of steps on it, branches off its upper
   * three quarters
   */
  private build(): void {
    const r = this.random;
    this.segments = 0;
    const t0x = this.top.x;
    const t0y = this.top.y;
    const t0z = this.top.z;
    const height = t0y - this.ground.y;
    const steps = Math.min(90, Math.max(30, Math.round(height / STEP_M)));
    const step = height / steps;
    // The wander: two slow sines across, vanishing at both ends
    const a1 = height * (0.06 + r() * 0.08);
    const a2 = height * (0.02 + r() * 0.04);
    const f1 = 2 + r() * 2;
    const f2 = 5 + r() * 4;
    const p1 = r() * 6.3;
    const p2 = r() * 6.3;
    const q1 = r() * 6.3;
    const q2 = r() * 6.3;
    const width = 0.45 + r() * 0.25;
    const branchChance = 0.2 * (0.4 + 0.6 * this.detail);
    let px = t0x;
    let py = t0y;
    let pz = t0z;
    let jx = 0;
    let jz = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const env = Math.sin(Math.PI * t);
      jx = jx * 0.55 + (r() - 0.5) * step * 1.7;
      jz = jz * 0.55 + (r() - 0.5) * step * 1.7;
      const tail = 1 - t * t * t * t;
      let x = t0x + (this.ground.x - t0x) * t + (a1 * Math.sin(f1 * t + p1) + a2 * Math.sin(f2 * t + p2)) * env + jx * tail;
      let y = t0y - height * t + (r() - 0.5) * step * 0.6 * tail;
      let z = t0z + (this.ground.z - t0z) * t + (a1 * Math.sin(f1 * t + q1) + a2 * Math.sin(f2 * t + q2)) * env + jz * tail;
      if (i === steps) {
        x = this.ground.x;
        y = this.ground.y;
        z = this.ground.z;
      }
      // Thicker where it is hot near the ground, thin up in the cloud
      this.emit(px, py, pz, x, y, z, width * (0.7 + 0.3 * t), 1, 0, t);
      if (t > 0.04 && t < 0.78 && r() < branchChance) this.branch(x, y, z, t, 1 / steps, step, width, 1);
      px = x;
      py = y;
      pz = z;
    }
    // The glow where it struck, its middle a third of its size over the ground (the ground hides the lower part)
    const glow = 26 + r() * 14;
    this.emit(this.ground.x, this.ground.y + glow * 0.3, this.ground.z, this.ground.x, this.ground.y + glow * 0.3 + 0.5, this.ground.z, glow, 0.9, 3, 1);
    this.commit();
  }

  /** A branch from (x, y, z) at leader time `at`, going down and out and dying out; `level` 1 or 2 */
  private branch(x: number, y: number, z: number, at: number, dt: number, step: number, width: number, level: 1 | 2): void {
    const r = this.random;
    const n = level === 1 ? 6 + Math.floor(r() * 16) : 3 + Math.floor(r() * 6);
    const angle = r() * Math.PI * 2;
    const out = level === 1 ? 0.5 + r() * 0.9 : 0.8 + r();
    let dx = Math.cos(angle) * out;
    let dy = -1;
    let dz = Math.sin(angle) * out;
    const len = step * (level === 1 ? 0.85 : 0.7);
    const bright = level === 1 ? 0.4 + r() * 0.2 : 0.22;
    const w = width * (level === 1 ? 0.5 : 0.32);
    for (let j = 1; j <= n; j++) {
      dx += (r() - 0.5) * 0.7;
      dz += (r() - 0.5) * 0.7;
      dy = Math.min(-0.25, dy + (r() - 0.5) * 0.4);
      const norm = 1 / Math.hypot(dx, dy, dz);
      const s = len * (0.7 + r() * 0.6) * norm;
      const nx = x + dx * s;
      const ny = y + dy * s;
      const nz = z + dz * s;
      const fade = 1 - (j / n) * 0.7;
      this.emit(x, y, z, nx, ny, nz, w * (1 - (j / n) * 0.5), bright * fade, level, Math.min(1, at + j * dt));
      if (level === 1 && this.detail >= 0.5 && r() < 0.12) this.branch(nx, ny, nz, Math.min(1, at + j * dt), dt, step, width, 2);
      x = nx;
      y = ny;
      z = nz;
    }
  }

  private emit(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, bright: number, level: number, reach: number): void {
    const i = this.segments;
    if (i >= MAX_SEGMENTS) return;
    this.starts[i * 3] = ax;
    this.starts[i * 3 + 1] = ay;
    this.starts[i * 3 + 2] = az;
    this.ends[i * 3] = bx;
    this.ends[i * 3 + 1] = by;
    this.ends[i * 3 + 2] = bz;
    this.shapes[i * 4] = width;
    this.shapes[i * 4 + 1] = bright;
    this.shapes[i * 4 + 2] = level;
    this.shapes[i * 4 + 3] = reach;
    this.segments = i + 1;
  }

  /** The segments built go to the GPU, only the part in use */
  private commit(): void {
    const g = this.mesh.geometry;
    const n = this.segments;
    upload(g.getAttribute('aStart') as InstancedBufferAttribute, n);
    upload(g.getAttribute('aEnd') as InstancedBufferAttribute, n);
    upload(g.getAttribute('aShape') as InstancedBufferAttribute, n);
    g.instanceCount = n;
  }

  /** Segments of the bolt built last, for tests */
  get segmentCount(): number {
    return this.segments;
  }
}

/** The first `n` items of an instanced attribute go to the GPU on the next draw */
function upload(attr: InstancedBufferAttribute, n: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n * attr.itemSize);
  attr.needsUpdate = true;
}

const BOLT_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec4 aShape;
uniform float uReveal;
uniform float uViewHeight;
varying vec2 vLine;
varying vec4 vProfile;
varying vec2 vKind;
varying float vDist;
void main() {
  vec3 a = (modelMatrix * vec4(aStart, 1.0)).xyz;
  vec3 b = (modelMatrix * vec4(aEnd, 1.0)).xyz;
  vec3 seg = b - a;
  float len = max(length(seg), 1e-3);
  vec3 dir = seg / len;
  vec3 toCam = cameraPosition - 0.5 * (a + b);
  float dist = max(length(toCam), 1e-3);
  vec3 side = cross(dir, toCam / dist);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  // A metre seen from here, in pixels: the core stays at least a pixel and a bit wide far off
  float pixel = 2.0 * dist / (projectionMatrix[1][1] * uViewHeight);
  bool glow = aShape.z > 2.5;
  float core = glow ? aShape.x : max(aShape.x, pixel * 1.3);
  float halo = glow ? aShape.x : core * 7.0;
  // Ends round off over the core's width (the glow's over all of it): the steps join without gaps
  float ext = glow ? halo : core;
  float s = mix(-ext, len + ext, position.x);
  float v = position.y * halo;
  vec3 p = a + dir * s + side * v;
  vLine = vec2(s, v);
  // Lit once the leader reached it
  vProfile = vec4(len, halo, core, aShape.y * step(aShape.w, uReveal + 1e-4));
  vKind = vec2(aShape.z, aShape.w);
  vDist = dist;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const BOLT_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uFlash;
uniform float uBranch;
uniform vec3 uCore;
uniform vec3 uGlow;
uniform float uFogDensity;
uniform float uFogStart;
varying vec2 vLine;
varying vec4 vProfile;
varying vec2 vKind;
varying float vDist;
void main() {
  #include <logdepthbuf_fragment>
  float off = max(max(-vLine.x, vLine.x - vProfile.x), 0.0);
  float d = length(vec2(off, vLine.y));
  float halo = vProfile.y;
  float core = 1.0 - smoothstep(vProfile.z * 0.3, vProfile.z, d);
  float glow = exp(-4.0 * d / halo) * (1.0 - smoothstep(0.55 * halo, halo, d));
  float level = vKind.x;
  vec3 c;
  if (level > 2.5) {
    // The spot it struck: a soft disc of light, hottest in the middle
    c = (uCore * pow(glow, 3.0) * 1.6 + uGlow * glow * 0.7);
  } else {
    // The top fades into the cloud base; branches carry the first stroke
    float top = smoothstep(0.0, 0.12, vKind.y);
    float lit = level < 0.5 ? 1.0 : uBranch;
    c = (uCore * core * 3.2 + uGlow * glow * 0.85) * top * lit;
  }
  // The rain's haze swallows far bolts, less than it does the land: they are bright
  c *= vProfile.w * uFlash * exp(-max(vDist - uFogStart, 0.0) * uFogDensity * 0.35);
  if (max(c.r, max(c.g, c.b)) < 0.002) discard;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
