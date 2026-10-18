import { Frustum, Matrix4, Sphere, Vector3, type Camera } from 'three';
import type { ShotLightLook, ShotLightPulseLook } from '../../configs/shot-lights.config';
import { SHOT_GRID, SHOT_LIGHT_UNIFORMS, SHOT_LIGHTS_MAX } from './shot-light-shader';

/**
 * The light of shots on the land (docs/SHOT_LIGHTS.md, E242): muzzle
 * flashes, glowing projectiles, impacts, beams and blasts, gathered each
 * frame and handed to the materials that take them as one small array of
 * lights (SHOT_LIGHT_UNIFORMS, shot-light-shader.ts). No three.js light: a
 * PointLight per shot would change the program of every lit material with
 * each shot, and every light costs every lit pixel of the scene.
 *
 * Per frame (update): pulses that still glow, and the lights the sources add
 * (projectiles in flight, beams), become candidates. Those out of view go;
 * the rest merge by cells of MERGE_M (a gatling's stream of tracers is one
 * light walking along its path, not twenty), and the strongest in view by
 * their light over their distance take the `max` places the quality level
 * gives (0: off, nothing is gathered). Pulses age on wall time: a flash is
 * as short at any game speed.
 *
 * A fragment reads only the lights that can reach it: the ground the chosen
 * lights cover is cut into SHOT_GRID × SHOT_GRID cells, each cell holds a
 * bit per light whose sphere touches its column. Twenty lights spread over a
 * battle cost a pixel the two or three around it, not twenty.
 *
 * Steady lights go through the same buffer: a custom map's lamps nearest the
 * view at night (SteadyLightSource, effect-layer.ts), which were three.js
 * PointLights. They take their places first, unmerged; the shots take the
 * places left. The scene then holds no point light at all, so day and night,
 * a lamp more or less and every quality level draw with the same programs.
 */

/** A source of lights that holds them itself (the projectile pools, the beams): asked each frame */
export interface ShotLightSource {
  shotLights(lights: ShotLights): void;
}

/**
 * A source of lights that stand (a custom map's lamps nearest the view):
 * asked each frame before the shots, whatever the shots' places, its lights
 * (steadyLight) take places first
 */
export interface SteadyLightSource {
  steadyLights(lights: ShotLights): void;
}

/** Pulses glowing at once at most; the oldest gives way */
const PULSES = 256;
/** Floats per pulse: x, y, z, r, g, b, intensity, radius, age, duration, and r, g, b at its end */
const PULSE_FLOATS = 13;
/** Candidates per frame at most */
const CANDIDATES = 1024;
/** Floats per candidate: x, y, z, r, g, b (times intensity), radius, weight */
const CANDIDATE_FLOATS = 8;
/** Lights closer than this merge into one, m */
const MERGE_M = 4;
/** Slots of the merge's hash table (a power of two, well over CANDIDATES) */
const MERGE_SLOTS = 2048;
/**
 * The falloff's core as a share of the radius: within it the light is near
 * full, beyond it falls as an inverse square. Wide: a flash 6 m up the
 * barrel still lights a pool on the ground below (a narrow core lit a
 * hand's breadth under a tracer and left the rest dark)
 */
const CORE = 0.5;
/** No light is gathered further than this from the camera, m */
const FAR_M = 900;
/**
 * A light in a cell that had a place in the last frame counts this much
 * more when there are more lights than places: the places hold steady
 * instead of flickering between lights of nearly the same strength
 */
const STICKY = 1.5;

export interface ShotLightStats {
  /** Steady lights of the last frame (SteadyLightSource), in the places before the shots */
  steady: number;
  /** Lights asked for in the last frame, after merging, and handed to the materials */
  candidates: number;
  merged: number;
  shown: number;
  /** Main-thread ms of update(), smoothed over frames */
  updateMs: number;
}

export class ShotLights {
  private max = 0;
  private enabled = true;
  private readonly sources: ShotLightSource[] = [];
  private readonly steadySources: SteadyLightSource[] = [];
  /** This frame's steady lights, in the uniform's layout (two vec4 each) */
  private readonly steady = new Float32Array(SHOT_LIGHTS_MAX * 8);
  private steadyCount = 0;
  private readonly pulses = new Float32Array(PULSES * PULSE_FLOATS);
  private pulseCount = 0;
  /** Where the next pulse goes once all are taken (the oldest) */
  private pulseNext = 0;
  private readonly candidates = new Float32Array(CANDIDATES * CANDIDATE_FLOATS);
  private candidateCount = 0;
  /** Merged lights, the same layout as the candidates */
  private readonly merged = new Float32Array(CANDIDATES * CANDIDATE_FLOATS);
  private mergedCount = 0;
  private readonly slotKey = new Int32Array(MERGE_SLOTS * 3);
  /** The cell of each merged light, and those of the lights that had a place in the last frame */
  private readonly mergedKey = new Int32Array(CANDIDATES * 3);
  private readonly lastKey = new Int32Array(SHOT_LIGHTS_MAX * 3);
  private lastCount = 0;
  private readonly slotLight = new Int32Array(MERGE_SLOTS);
  /** Picked lights by score, best first */
  private readonly picked = new Int32Array(SHOT_LIGHTS_MAX);
  private readonly pickedScore = new Float32Array(SHOT_LIGHTS_MAX);
  private readonly frustum = new Frustum();
  private readonly viewProjection = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly camPos = new Vector3();
  readonly stats: ShotLightStats = { steady: 0, candidates: 0, merged: 0, shown: 0, updateMs: 0 };

  /** Whether shots are gathered: the level gives places and the switch is on (steady lights go on without) */
  get active(): boolean {
    return this.enabled && this.max > 0;
  }

  /** Places for lights (the quality level's `shotLights`), 0 off */
  setMax(max: number): void {
    this.max = Math.max(0, Math.min(SHOT_LIGHTS_MAX, Math.floor(max)));
    if (!this.active) this.clear();
  }

  get places(): number {
    return this.max;
  }

  /** The switch for measurements and comparisons (`__perf.shotLights`) */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!this.active) this.clear();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * `run` with the materials given no light, the frame's lights kept for
   * after it (the measurement's draw without them, e2e/perf/shot-lights.ts)
   */
  withoutLights<T>(run: () => T): T {
    const count = SHOT_LIGHT_UNIFORMS.uShotLightCount;
    const before = count.value;
    count.value = 0;
    try {
      return run();
    } finally {
      count.value = before;
    }
  }

  /** `run` with every light of this frame in every cell, as without the grid (measurements only) */
  withoutGrid<T>(run: () => T): T {
    const cells = SHOT_LIGHT_UNIFORMS.uShotCells.value;
    const kept = cells.slice();
    const shown = SHOT_LIGHT_UNIFORMS.uShotLightCount.value;
    cells.fill(shown >= 32 ? 0xffffffff : 2 ** shown - 1);
    try {
      return run();
    } finally {
      cells.set(kept);
    }
  }

  addSource(source: ShotLightSource): void {
    if (!this.sources.includes(source)) this.sources.push(source);
  }

  removeSource(source: ShotLightSource): void {
    const i = this.sources.indexOf(source);
    if (i >= 0) this.sources.splice(i, 1);
  }

  addSteadySource(source: SteadyLightSource): void {
    if (!this.steadySources.includes(source)) this.steadySources.push(source);
  }

  removeSteadySource(source: SteadyLightSource): void {
    const i = this.steadySources.indexOf(source);
    if (i >= 0) this.steadySources.splice(i, 1);
  }

  /**
   * A steady light for this frame (from a SteadyLightSource): at (x, y, z)
   * in scene metres, its light (colour times strength) `r`, `g`, `b`,
   * reaching `radius`, near full within `core` and falling as an inverse
   * square beyond. Past SHOT_LIGHTS_MAX it is left out
   */
  steadyLight(x: number, y: number, z: number, r: number, g: number, b: number, radius: number, core: number): void {
    if (this.steadyCount >= SHOT_LIGHTS_MAX || radius <= 0 || core <= 0 || r + g + b <= 0) return;
    const s = this.steady;
    const q = this.steadyCount++ * 8;
    s[q] = x;
    s[q + 1] = y;
    s[q + 2] = z;
    s[q + 3] = 1 / (radius * radius);
    s[q + 4] = r;
    s[q + 5] = g;
    s[q + 6] = b;
    s[q + 7] = 1 / (core * core);
  }

  /**
   * A light at (x, y, z) that fades over its look's duration, cooling to
   * its `fade` colour, `jitter` of its strength by chance (no two flashes
   * of a gatling alike); `scale` widens it (a blast's radius)
   */
  pulse(x: number, y: number, z: number, look: ShotLightPulseLook, scale = 1): void {
    if (!this.active) return;
    let i: number;
    if (this.pulseCount < PULSES) {
      i = this.pulseCount++;
    } else {
      i = this.pulseNext;
      this.pulseNext = (this.pulseNext + 1) % PULSES;
    }
    const p = this.pulses;
    const o = i * PULSE_FLOATS;
    p[o] = x;
    p[o + 1] = y;
    p[o + 2] = z;
    p[o + 3] = look.color[0];
    p[o + 4] = look.color[1];
    p[o + 5] = look.color[2];
    p[o + 6] = look.intensity * (1 + (look.jitter ?? 0) * (Math.random() * 2 - 1));
    p[o + 7] = look.radius * scale;
    p[o + 8] = 0;
    p[o + 9] = look.durationS;
    const fade = look.fade ?? look.color;
    p[o + 10] = fade[0];
    p[o + 11] = fade[1];
    p[o + 12] = fade[2];
  }

  /** A light for this frame only (the sources, each frame they glow), `strength` on the look's intensity */
  add(x: number, y: number, z: number, look: ShotLightLook, strength = 1): void {
    if (this.candidateCount >= CANDIDATES || strength <= 0) return;
    const c = this.candidates;
    const o = this.candidateCount++ * CANDIDATE_FLOATS;
    const k = look.intensity * strength;
    c[o] = x;
    c[o + 1] = y;
    c[o + 2] = z;
    c[o + 3] = look.color[0] * k;
    c[o + 4] = look.color[1] * k;
    c[o + 5] = look.color[2] * k;
    c[o + 6] = look.radius;
    c[o + 7] = k;
  }

  /**
   * Once per drawn frame, after the effects moved and before the draw: the
   * lights of this frame to the materials, the steady ones first
   */
  update(dtSeconds: number, camera: Camera): void {
    const u = SHOT_LIGHT_UNIFORMS;
    if (!this.enabled) {
      u.uShotLightCount.value = 0;
      return;
    }
    const start = performance.now();
    this.steadyCount = 0;
    for (const source of this.steadySources) source.steadyLights(this);
    const steady = this.steadyCount;
    this.stats.steady = steady;
    let shown = 0;
    if (this.max > 0) {
      this.agePulses(dtSeconds);
      for (const source of this.sources) source.shotLights(this);
      this.stats.candidates = this.candidateCount;
      this.mergeCandidates();
      this.candidateCount = 0;
      this.stats.merged = this.mergedCount;
      shown = this.pick(camera, Math.min(this.max, SHOT_LIGHTS_MAX - steady));
    }
    this.stats.shown = shown;
    const out = u.uShotLights.value;
    out.set(this.steady.subarray(0, steady * 8));
    const m = this.merged;
    for (let k = 0; k < shown; k++) {
      const o = this.picked[k] * CANDIDATE_FLOATS;
      const radius = m[o + 6];
      const core = radius * CORE;
      const q = (steady + k) * 8;
      out[q] = m[o];
      out[q + 1] = m[o + 1];
      out[q + 2] = m[o + 2];
      out[q + 3] = 1 / (radius * radius);
      out[q + 4] = m[o + 3];
      out[q + 5] = m[o + 4];
      out[q + 6] = m[o + 5];
      out[q + 7] = 1 / (core * core);
    }
    this.writeGrid(steady + shown);
    u.uShotLightCount.value = steady + shown;
    this.stats.updateMs += (performance.now() - start - this.stats.updateMs) * 0.05;
  }

  /**
   * The cells over the ground the `shown` lights cover (their spheres' box
   * on the ground, in SHOT_GRID steps each way) and in each cell a bit per
   * light whose circle on the ground meets it
   */
  private writeGrid(shown: number): void {
    const u = SHOT_LIGHT_UNIFORMS;
    const cells = u.uShotCells.value;
    cells.fill(0);
    if (shown === 0) return;
    const lights = u.uShotLights.value;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < shown; k++) {
      const r = 1 / Math.sqrt(lights[k * 8 + 3]);
      minX = Math.min(minX, lights[k * 8] - r);
      maxX = Math.max(maxX, lights[k * 8] + r);
      minZ = Math.min(minZ, lights[k * 8 + 2] - r);
      maxZ = Math.max(maxZ, lights[k * 8 + 2] + r);
    }
    const sx = SHOT_GRID / Math.max(maxX - minX, 1e-3);
    const sz = SHOT_GRID / Math.max(maxZ - minZ, 1e-3);
    const grid = u.uShotGrid.value;
    grid[0] = minX;
    grid[1] = minZ;
    grid[2] = sx;
    grid[3] = sz;
    const cellW = 1 / sx;
    const cellD = 1 / sz;
    for (let k = 0; k < shown; k++) {
      const x = lights[k * 8];
      const z = lights[k * 8 + 2];
      const r = 1 / Math.sqrt(lights[k * 8 + 3]);
      const bit = 2 ** k;
      const i0 = Math.max(0, Math.floor((x - r - minX) * sx));
      const i1 = Math.min(SHOT_GRID - 1, Math.floor((x + r - minX) * sx));
      const j0 = Math.max(0, Math.floor((z - r - minZ) * sz));
      const j1 = Math.min(SHOT_GRID - 1, Math.floor((z + r - minZ) * sz));
      for (let j = j0; j <= j1; j++) {
        // The cell's nearest point to the light: a corner cell the circle misses takes no bit
        const cz = Math.max(minZ + j * cellD, Math.min(z, minZ + (j + 1) * cellD)) - z;
        for (let i = i0; i <= i1; i++) {
          const cx = Math.max(minX + i * cellW, Math.min(x, minX + (i + 1) * cellW)) - x;
          if (cx * cx + cz * cz > r * r) continue;
          cells[j * SHOT_GRID + i] += bit;
        }
      }
    }
  }

  /** Every light out: the pulses go, the materials get none until the next update */
  clear(): void {
    this.pulseCount = 0;
    this.pulseNext = 0;
    this.candidateCount = 0;
    this.mergedCount = 0;
    this.stats.steady = this.stats.candidates = this.stats.merged = this.stats.shown = 0;
    SHOT_LIGHT_UNIFORMS.uShotLightCount.value = 0;
  }

  /**
   * The pulses as candidates, fading squared from their colour to their
   * fade colour, then one frame older: a pulse shows at full strength in the
   * frame after it came. The spent ones drop
   */
  private agePulses(dt: number): void {
    const p = this.pulses;
    let kept = 0;
    for (let i = 0; i < this.pulseCount; i++) {
      const o = i * PULSE_FLOATS;
      const age = p[o + 8];
      const duration = p[o + 9];
      if (age >= duration) continue;
      if (kept !== i) p.copyWithin(kept * PULSE_FLOATS, o, o + PULSE_FLOATS);
      const q = kept * PULSE_FLOATS;
      p[q + 8] = age + dt;
      kept++;
      const t = age / duration;
      const left = 1 - t;
      const strength = left * left * p[q + 6];
      if (this.candidateCount >= CANDIDATES) continue;
      const c = this.candidates;
      const k = this.candidateCount++ * CANDIDATE_FLOATS;
      c[k] = p[q];
      c[k + 1] = p[q + 1];
      c[k + 2] = p[q + 2];
      c[k + 3] = (p[q + 3] + (p[q + 10] - p[q + 3]) * t) * strength;
      c[k + 4] = (p[q + 4] + (p[q + 11] - p[q + 4]) * t) * strength;
      c[k + 5] = (p[q + 5] + (p[q + 12] - p[q + 5]) * t) * strength;
      c[k + 6] = p[q + 7];
      c[k + 7] = strength;
    }
    this.pulseCount = kept;
    if (this.pulseNext >= kept) this.pulseNext = 0;
  }

  /**
   * Candidates within MERGE_M of each other (by cell) become one light:
   * their light summed, at their position weighted by it, as wide as the
   * widest. Integer cell keys in an open hash table, no strings, no maps.
   */
  private mergeCandidates(): void {
    const c = this.candidates;
    const m = this.merged;
    const keys = this.slotKey;
    const slots = this.slotLight;
    slots.fill(-1);
    let count = 0;
    for (let i = 0; i < this.candidateCount; i++) {
      const o = i * CANDIDATE_FLOATS;
      const w = c[o + 7];
      if (w <= 0) continue;
      const ix = Math.floor(c[o] / MERGE_M);
      const iy = Math.floor(c[o + 1] / MERGE_M);
      const iz = Math.floor(c[o + 2] / MERGE_M);
      let s = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (MERGE_SLOTS - 1);
      while (slots[s] >= 0 && (keys[s * 3] !== ix || keys[s * 3 + 1] !== iy || keys[s * 3 + 2] !== iz)) s = (s + 1) & (MERGE_SLOTS - 1);
      if (slots[s] < 0) {
        slots[s] = count;
        keys[s * 3] = ix;
        keys[s * 3 + 1] = iy;
        keys[s * 3 + 2] = iz;
        this.mergedKey[count * 3] = ix;
        this.mergedKey[count * 3 + 1] = iy;
        this.mergedKey[count * 3 + 2] = iz;
        // The position summed by weight, divided once all are in
        const q = count * CANDIDATE_FLOATS;
        m[q] = c[o] * w;
        m[q + 1] = c[o + 1] * w;
        m[q + 2] = c[o + 2] * w;
        m[q + 3] = c[o + 3];
        m[q + 4] = c[o + 4];
        m[q + 5] = c[o + 5];
        m[q + 6] = c[o + 6];
        m[q + 7] = w;
        count++;
        continue;
      }
      const q = slots[s] * CANDIDATE_FLOATS;
      m[q] += c[o] * w;
      m[q + 1] += c[o + 1] * w;
      m[q + 2] += c[o + 2] * w;
      m[q + 3] += c[o + 3];
      m[q + 4] += c[o + 4];
      m[q + 5] += c[o + 5];
      m[q + 6] = Math.max(m[q + 6], c[o + 6]);
      m[q + 7] += w;
    }
    for (let k = 0; k < count; k++) {
      const q = k * CANDIDATE_FLOATS;
      const w = m[q + 7];
      m[q] /= w;
      m[q + 1] /= w;
      m[q + 2] /= w;
    }
    this.mergedCount = count;
  }

  /**
   * The `max` merged lights in view with the most light over their
   * distance, into `picked`; their count. Their cells are kept for the next
   * frame's choice (STICKY)
   */
  private pick(camera: Camera, max: number): number {
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    camera.getWorldPosition(this.camPos);
    const m = this.merged;
    const picked = this.picked;
    const scores = this.pickedScore;
    const crowded = this.mergedCount > max;
    let n = 0;
    for (let k = 0; k < this.mergedCount; k++) {
      const q = k * CANDIDATE_FLOATS;
      const radius = m[q + 6];
      const dx = m[q] - this.camPos.x;
      const dy = m[q + 1] - this.camPos.y;
      const dz = m[q + 2] - this.camPos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > FAR_M + radius) continue;
      this.sphere.center.set(m[q], m[q + 1], m[q + 2]);
      this.sphere.radius = radius;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      // Its light (luminance) times the ground it reaches, over its distance: a blast far off beats a tracer near by
      const light = m[q + 3] * 0.2126 + m[q + 4] * 0.7152 + m[q + 5] * 0.0722;
      let score = (light * radius) / Math.max(d, radius);
      if (crowded && this.hadPlace(k)) score *= STICKY;
      if (n === max && score <= scores[n - 1]) continue;
      let at = n < max ? n++ : n - 1;
      while (at > 0 && scores[at - 1] < score) {
        scores[at] = scores[at - 1];
        picked[at] = picked[at - 1];
        at--;
      }
      scores[at] = score;
      picked[at] = k;
    }
    for (let i = 0; i < n; i++) {
      const k = picked[i] * 3;
      this.lastKey[i * 3] = this.mergedKey[k];
      this.lastKey[i * 3 + 1] = this.mergedKey[k + 1];
      this.lastKey[i * 3 + 2] = this.mergedKey[k + 2];
    }
    this.lastCount = n;
    return n;
  }

  /** Whether merged light `k` lies in a cell that had a place in the last frame */
  private hadPlace(k: number): boolean {
    const key = this.mergedKey;
    const last = this.lastKey;
    for (let i = 0; i < this.lastCount; i++) {
      if (last[i * 3] === key[k * 3] && last[i * 3 + 1] === key[k * 3 + 1] && last[i * 3 + 2] === key[k * 3 + 2]) return true;
    }
    return false;
  }
}
