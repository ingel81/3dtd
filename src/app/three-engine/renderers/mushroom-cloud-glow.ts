import { MathUtils, type Scene, type ShaderMaterial } from 'three';
import { MUSHROOM_CLOUD_LOOK as LOOK, type EffectRgb } from '../../configs/visual-effects.config';
import { commitParticles, particleBuffer, reach, type ParticleBuffer } from './effect-buffers';
import { CloudShape, SEEDS, TAU, fract, type Cloud } from './mushroom-cloud-shape';

const GLOW = LOOK.glowParticles;
/** Points of all ember streaks of one cloud */
const EMBER_POINTS = GLOW.embers * LOOK.embers.trail;
const GLOW_PER_CLOUD =
  GLOW.core + GLOW.fireball + GLOW.shell + EMBER_POINTS + GLOW.groundFire + GLOW.stemFire + GLOW.rim;

// Where each glow group's random numbers start within a cloud's block
const CORE_SEEDS = 0;
const BALL_SEEDS = CORE_SEEDS + GLOW.core * SEEDS;
const SHELL_SEEDS = BALL_SEEDS + GLOW.fireball * SEEDS;
const EMBER_SEEDS = SHELL_SEEDS + GLOW.shell * SEEDS;
const GROUND_FIRE_SEEDS = EMBER_SEEDS + EMBER_POINTS * SEEDS;
const STEM_FIRE_SEEDS = GROUND_FIRE_SEEDS + GLOW.groundFire * SEEDS;
const RIM_SEEDS = STEM_FIRE_SEEDS + GLOW.stemFire * SEEDS;
/** Embers launch within this many seconds of the impact */
const EMBER_LAUNCH = 0.12;
/** The last ember streak point is gone after this many game seconds */
const EMBERS_END = EMBER_LAUNCH + LOOK.embers.life[1] + (LOOK.embers.trail - 1) * LOOK.embers.trailStep;
/** A glow particle darker than this is left out */
const MIN_LIGHT = 0.01;
/** Share of the sprite the glow of an explosion-atlas frame covers */
const GLOW_COVERAGE = 0.6;
/** The glow draws before the smoke (CloudSmoke), so smoke in front of it dims it */
const GLOW_ORDER = 996;

/**
 * The glow of the mushroom clouds: white-hot core, fireball, fire shell,
 * embers, ground fire, stem fire and rim glow, as Points with the trail
 * pools' additive material (MushroomCloudRenderer). Every particle comes
 * from its cloud's age and the random numbers drawn at the strike.
 */
export class CloudGlow extends CloudShape {
  private readonly seeds = new Float32Array(LOOK.clouds * GLOW_PER_CLOUD * SEEDS);
  private readonly buffer: ParticleBuffer;
  /** Point size per metre in this frame (MushroomCloudRenderer.update) */
  sizePerMetre = 0;

  constructor(scene: Scene, material: ShaderMaterial) {
    super();
    this.buffer = particleBuffer(scene, LOOK.clouds * GLOW_PER_CLOUD, material, GLOW_ORDER);
  }

  /** Draw the random numbers of a strike in cloud `slot`. */
  seed(slot: number): void {
    const glowStart = slot * GLOW_PER_CLOUD * SEEDS;
    for (let i = glowStart; i < glowStart + GLOW_PER_CLOUD * SEEDS; i++) this.seeds[i] = Math.random();
  }

  /**
   * The glow of one cloud into the glow buffer from index `n`; returns the
   * next index. The detonation always, the rest with the full cloud.
   */
  write(cloud: Cloud, slot: number, n: number): number {
    this.shape(cloud);
    const seeds = slot * GLOW_PER_CLOUD * SEEDS;
    n = this.writeFireball(cloud, seeds, n);
    n = this.writeShell(cloud, seeds + SHELL_SEEDS, n);
    if (!cloud.full) return n;
    n = this.writeEmbers(cloud, seeds + EMBER_SEEDS, n);
    n = this.writeGroundFire(cloud, seeds + GROUND_FIRE_SEEDS, n);
    n = this.writeStemFire(cloud, seeds + STEM_FIRE_SEEDS, n);
    return this.writeRim(cloud, seeds + RIM_SEEDS, n);
  }

  /**
   * The white-hot core and the fireball: a hemisphere on the ground whose
   * centre punches up, white-hot turning orange, then the glowing core of
   * the cap. `seeds` is the cloud's block.
   */
  private writeFireball(cloud: Cloud, seeds: number, n: number): number {
    const { core, fireball, colors } = LOOK;
    const t = cloud.t;
    const s = cloud.scale;
    const r = this.seeds;
    const punch = fireball.punch * (1 - Math.exp(-t / fireball.punchTime)) * s;
    const radius = (2 + (fireball.radius - 2) * (1 - Math.exp(-t / fireball.growTime))) * s;

    // Core: a white-hot knot in the middle of the fireball, burnt out after core.duration
    const coreLight = core.intensity * (1 - MathUtils.smoothstep(t, 0.1, core.duration));
    if (coreLight > MIN_LIGHT) {
      const centre = radius * 0.5 + punch;
      const grow = 0.6 + 0.4 * MathUtils.smoothstep(t, 0, 0.15);
      for (let i = 0, seed = seeds + CORE_SEEDS; i < GLOW.core; i++, seed += SEEDS) {
        const a = r[seed] * TAU;
        const up = r[seed + 1] * 2 - 1;
        const k = core.radius * s * Math.cbrt(r[seed + 2]);
        const out = Math.sqrt(1 - up * up) * k;
        this.px = Math.cos(a) * out;
        this.py = centre + up * k;
        this.pz = Math.sin(a) * out;
        const diameter = MathUtils.lerp(core.size[0], core.size[1], r[seed + 3]) * s * grow;
        this.putGlow(n++, cloud, diameter, 0, colors.core, coreLight);
      }
    }

    const ballLight =
      1.6 * (1 - MathUtils.smoothstep(t, fireball.fadeStart, fireball.fadeEnd)) * (0.45 + 0.55 * Math.exp(-t / 0.6));
    if (ballLight <= MIN_LIGHT) return n;
    const lift = MathUtils.smoothstep(t, fireball.liftStart, fireball.liftEnd);
    const grow = 0.5 + 0.5 * MathUtils.smoothstep(t, 0, 0.25);
    // Flash white to fireball orange to dark red (explosion atlas)
    const frame = Math.round(1 + 9 * Math.min(1, t / fireball.fadeEnd));
    const hot = 1 - MathUtils.smoothstep(t, 0.1, fireball.hotEnd);
    const { fireballHot, fireball: orange } = colors;
    const red = MathUtils.lerp(orange.r, fireballHot.r, hot) * ballLight;
    const green = MathUtils.lerp(orange.g, fireballHot.g, hot) * ballLight;
    const blue = MathUtils.lerp(orange.b, fireballHot.b, hot) * ballLight;
    for (let i = 0, seed = seeds + BALL_SEEDS; i < GLOW.fireball; i++, seed += SEEDS) {
      const azimuth = r[seed] * TAU;
      const up = r[seed + 1];
      const depth = r[seed + 2];
      const out = Math.sqrt(1 - up * up);
      const k = 0.25 + 0.75 * Math.cbrt(depth);
      const bx = Math.cos(azimuth) * out * radius * k;
      const by = radius * (0.35 + up * k) + punch;
      const bz = Math.sin(azimuth) * out * radius * k;
      this.torusPoint(azimuth, (up * 2 - 1) * Math.PI - this.roll, 0.2 + 0.4 * depth);
      this.px = MathUtils.lerp(bx, this.px, lift);
      this.py = MathUtils.lerp(by, this.py, lift);
      this.pz = MathUtils.lerp(bz, this.pz, lift);
      this.drift();
      const diameter = MathUtils.lerp(fireball.size[0], fireball.size[1], r[seed + 3]) * s * grow;
      this.putGlowRgb(n++, cloud, diameter, frame, red, green, blue);
    }
    return n;
  }

  /** Second fire front: a flattened shell running out over the ground and fading. */
  private writeShell(cloud: Cloud, seeds: number, n: number): number {
    const { shell, colors } = LOOK;
    const age = cloud.t - shell.start;
    if (age <= 0 || age >= shell.duration) return n;
    const share = age / shell.duration;
    const light = 1.5 * (1 - share) ** 1.5 * MathUtils.smoothstep(age, 0, 0.06);
    if (light <= MIN_LIGHT) return n;
    const s = cloud.scale;
    const out = reach(age, shell.duration, shell.timeConstant);
    const radius = shell.radius * s * out;
    const frame = Math.round(3 + 6 * share);
    const r = this.seeds;
    for (let i = 0, seed = seeds; i < GLOW.shell; i++, seed += SEEDS) {
      const a = r[seed] * TAU;
      // Mostly low over the ground, a few up the side
      const elevation = r[seed + 1] ** 1.5 * 1.3;
      const k = radius * (0.85 + 0.15 * r[seed + 2]);
      this.px = Math.cos(a) * Math.cos(elevation) * k;
      this.py = Math.sin(elevation) * k * 0.7 + s;
      this.pz = Math.sin(a) * Math.cos(elevation) * k;
      const diameter = MathUtils.lerp(shell.size[0], shell.size[1], r[seed + 3]) * s * (0.6 + 0.6 * out);
      this.putGlow(n++, cloud, diameter, frame, colors.shell, light);
    }
    return n;
  }

  /**
   * Glowing debris thrown out and up, slowed by the air and falling back,
   * each a streak of its last few positions. A point that has reached the
   * ground is left out.
   */
  private writeEmbers(cloud: Cloud, seeds: number, n: number): number {
    const { embers, colors } = LOOK;
    const t = cloud.t;
    if (t >= EMBERS_END) return n;
    const s = cloud.scale;
    const r = this.seeds;
    const drag = embers.drag;
    const gravity = embers.gravity * s;
    for (let e = 0, seed = seeds; e < GLOW.embers; e++, seed += embers.trail * SEEDS) {
      const azimuth = r[seed] * TAU;
      const elevation = 0.25 + 1.1 * r[seed + 1];
      const speed = MathUtils.lerp(embers.speed[0], embers.speed[1], r[seed + 2]) * s;
      const life = MathUtils.lerp(embers.life[0], embers.life[1], r[seed + 3]);
      const start = EMBER_LAUNCH * r[seed + 4];
      const size = MathUtils.lerp(embers.size[0], embers.size[1], r[seed + 5]) * s;
      const out = Math.cos(elevation) * speed;
      const up = Math.sin(elevation) * speed;
      const cos = Math.cos(azimuth);
      const sin = Math.sin(azimuth);
      for (let j = 0; j < embers.trail; j++) {
        const age = t - start - j * embers.trailStep;
        if (age <= 0 || age >= life) continue;
        // Linear drag: the speed falls off with the time constant, gravity pulls against it
        const covered = drag * (1 - Math.exp(-age / drag));
        const y = 2 * s + up * covered - gravity * drag * (age - covered);
        if (y < 0) continue;
        const h = 3 * s + out * covered;
        this.px = cos * h;
        this.py = y;
        this.pz = sin * h;
        const fade = (1 - age / life) ** 1.5 * (1 - 0.22 * j);
        this.putGlow(n++, cloud, size * (1 - 0.18 * j), 1 + Math.round((6 * age) / life), colors.ember, 1.4 * fade);
      }
    }
    return n;
  }

  /** Burning ground around the foot of the stem, flickering in game time. */
  private writeGroundFire(cloud: Cloud, seeds: number, n: number): number {
    const { groundFire, colors } = LOOK;
    const t = cloud.t;
    const light =
      1.1 *
      MathUtils.smoothstep(t, groundFire.start, groundFire.start + 0.4) *
      (1 - MathUtils.smoothstep(t, groundFire.fadeStart, groundFire.fadeEnd));
    if (light <= MIN_LIGHT) return n;
    const s = cloud.scale;
    const r = this.seeds;
    for (let i = 0, seed = seeds; i < GLOW.groundFire; i++, seed += SEEDS) {
      const a = r[seed] * TAU;
      const d = MathUtils.lerp(groundFire.radius[0], groundFire.radius[1], Math.sqrt(r[seed + 1])) * s;
      const phase = r[seed + 2] * TAU;
      const flicker = (0.7 + 0.3 * Math.sin(9 * t + phase)) * (0.85 + 0.15 * Math.sin(23 * t + 3 * phase));
      const diameter =
        MathUtils.lerp(groundFire.size[0], groundFire.size[1], r[seed + 3]) * s * (0.9 + 0.2 * Math.sin(6 * t + 2 * phase));
      this.px = Math.cos(a) * d;
      this.py = diameter * 0.35;
      this.pz = Math.sin(a) * d;
      // Cycles through the fireball frames of the atlas
      const frame = 4 + (Math.floor(8 * t + 16 * r[seed + 2]) % 4);
      this.putGlow(n++, cloud, diameter, frame, colors.groundFire, light * flicker);
    }
    return n;
  }

  /** Stem fire: rising through the core of the stem, darker the higher it gets. */
  private writeStemFire(cloud: Cloud, seeds: number, n: number): number {
    const { stem, colors } = LOOK;
    const t = cloud.t;
    const fireLight = 1.3 * MathUtils.smoothstep(t, 0.25, 0.5) * (1 - MathUtils.smoothstep(t, 1.6, 3.8));
    if (fireLight <= MIN_LIGHT) return n;
    const s = cloud.scale;
    const r = this.seeds;
    const width = stem.width * s * 0.55;
    for (let i = 0, seed = seeds; i < GLOW.stemFire; i++, seed += SEEDS) {
      const climb = fract(r[seed] + 0.9 * (t - 0.25));
      const light = fireLight * (1 - 0.65 * climb) * MathUtils.smoothstep(climb, 0, 0.1);
      if (light <= MIN_LIGHT) continue;
      const radius = width * Math.sqrt(r[seed + 1]);
      const a = r[seed + 2] * TAU + 0.7 * t;
      this.px = Math.cos(a) * radius;
      this.py = this.stemTop * climb * 0.9;
      this.pz = Math.sin(a) * radius;
      this.drift();
      this.putGlow(n++, cloud, (4 + 3 * r[seed + 3]) * s, Math.round(4 + 5 * climb), colors.stemFire, light);
    }
    return n;
  }

  /** Rim glow: the underside of the cap, lit by the fire in the stem. */
  private writeRim(cloud: Cloud, seeds: number, n: number): number {
    const t = cloud.t;
    const rimLight = 1.2 * MathUtils.smoothstep(t, 0.7, 1.4) * (1 - MathUtils.smoothstep(t, 3.5, 7.5));
    if (rimLight <= MIN_LIGHT) return n;
    const r = this.seeds;
    for (let i = 0, seed = seeds; i < GLOW.rim; i++, seed += SEEDS) {
      const u = r[seed + 3];
      this.torusPoint(r[seed] * TAU + 0.1 * t, -Math.PI / 2 + (r[seed + 1] - 0.5) * 1.9, 0.8 + 0.2 * r[seed + 2]);
      this.drift();
      this.putGlow(n++, cloud, this.tubeR * 0.8 * (0.8 + 0.4 * u), 5 + Math.round(2 * u), LOOK.colors.rim, rimLight);
    }
    return n;
  }

  /** The point px/py/pz as glow particle `n`: `diameter` in metres, colour times `light`. */
  private putGlow(n: number, cloud: Cloud, diameter: number, frame: number, color: EffectRgb, light: number): void {
    this.putGlowRgb(n, cloud, diameter, frame, color.r * light, color.g * light, color.b * light);
  }

  private putGlowRgb(n: number, cloud: Cloud, diameter: number, frame: number, r: number, g: number, b: number): void {
    const position = this.buffer.position.array as Float32Array;
    const rgb = this.buffer.color.array as Float32Array;
    position[n * 3] = cloud.x + this.px;
    position[n * 3 + 1] = cloud.y + this.py;
    position[n * 3 + 2] = cloud.z + this.pz;
    rgb[n * 3] = r;
    rgb[n * 3 + 1] = g;
    rgb[n * 3 + 2] = b;
    (this.buffer.size.array as Float32Array)[n] = (diameter / GLOW_COVERAGE) * this.sizePerMetre;
    (this.buffer.frame.array as Float32Array)[n] = frame;
  }

  /** Draw the first `count` glow particles written this frame. */
  commit(count: number): void {
    commitParticles(this.buffer, count);
  }

  /** Remove and free the buffer; the material belongs to the trail pools. */
  dispose(scene: Scene): void {
    scene.remove(this.buffer.points);
    this.buffer.points.geometry.dispose();
  }
}
