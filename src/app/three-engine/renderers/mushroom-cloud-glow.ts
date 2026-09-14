import { MathUtils, type Scene, type ShaderMaterial } from 'three';
import { MUSHROOM_CLOUD_LOOK as LOOK, type EffectRgb } from '../../configs/visual-effects.config';
import { reach } from './effect-buffers';
import { ATLAS_FRAMES, SpriteBuffer } from './mushroom-cloud-sprites';
import { CloudShape, SEEDS, TAU, fract, lowSizeBoost, type Cloud } from './mushroom-cloud-shape';

const FULL = LOOK.glowSprites.full;
const LOW = LOOK.glowSprites.low;
/** Sprites of all ember streaks of one cloud */
const EMBER_SPRITES = FULL.embers * LOOK.embers.trail;
const GLOW_PER_CLOUD = FULL.shell + EMBER_SPRITES + FULL.groundFire + FULL.stemFire + FULL.rim;

// Where each glow group's random numbers start within a cloud's block
const SHELL_SEEDS = 0;
const EMBER_SEEDS = SHELL_SEEDS + FULL.shell * SEEDS;
const GROUND_FIRE_SEEDS = EMBER_SEEDS + EMBER_SPRITES * SEEDS;
const STEM_FIRE_SEEDS = GROUND_FIRE_SEEDS + FULL.groundFire * SEEDS;
const RIM_SEEDS = STEM_FIRE_SEEDS + FULL.stemFire * SEEDS;
/** Embers launch within this many seconds of the impact */
const EMBER_LAUNCH = 0.12;
/** The last ember streak sprite is gone after this many game seconds */
const EMBERS_END = EMBER_LAUNCH + LOOK.embers.life[1] + (LOOK.embers.trail - 1) * LOOK.embers.trailStep;
/** A glow sprite darker than this is left out */
const MIN_LIGHT = 0.01;
/** Share of a sprite the dense middle of a billow covers */
const GLOW_COVERAGE = 0.75;
/** Between the smoke behind the fireball and the smoke in front of it (CloudSmoke) */
const GLOW_ORDER = 997;

/**
 * The glow of the mushroom clouds: fire front, embers, ground fire, stem
 * fire and the glow under the cap, as additive sprites
 * (MushroomCloudRenderer). Every sprite comes from its cloud's age and the
 * random numbers drawn at the strike; a cloud with impact effects off
 * writes the `low` counts, larger.
 */
export class CloudGlow extends CloudShape {
  private readonly seeds = new Float32Array(LOOK.clouds * GLOW_PER_CLOUD * SEEDS);
  private readonly sprites: SpriteBuffer;

  constructor(scene: Scene, material: ShaderMaterial) {
    super();
    this.sprites = new SpriteBuffer(scene, LOOK.clouds * GLOW_PER_CLOUD, material, GLOW_ORDER, 'mushroom-glow', false);
  }

  /** Draw the random numbers of a strike in cloud `slot`. */
  seed(slot: number): void {
    const start = slot * GLOW_PER_CLOUD * SEEDS;
    for (let i = start; i < start + GLOW_PER_CLOUD * SEEDS; i++) this.seeds[i] = Math.random();
  }

  /** The glow of one cloud into the buffer from sprite `n` on; returns the next free one. */
  write(cloud: Cloud, slot: number, n: number): number {
    this.shape(cloud);
    const counts = cloud.full ? FULL : LOW;
    const seeds = slot * GLOW_PER_CLOUD * SEEDS;
    n = this.writeShell(cloud, seeds + SHELL_SEEDS, counts.shell, n);
    n = this.writeEmbers(cloud, seeds + EMBER_SEEDS, counts.embers, n);
    n = this.writeGroundFire(cloud, seeds + GROUND_FIRE_SEEDS, counts.groundFire, n);
    n = this.writeStemFire(cloud, seeds + STEM_FIRE_SEEDS, counts.stemFire, n);
    return this.writeRim(cloud, seeds + RIM_SEEDS, counts.rim, n);
  }

  /** Fire front: a flattened shell running out along the ground and fading. */
  private writeShell(cloud: Cloud, seeds: number, count: number, n: number): number {
    const { shell, colors } = LOOK;
    const age = cloud.t - shell.start;
    if (count === 0 || age <= 0 || age >= shell.duration) return n;
    const share = age / shell.duration;
    const light = 1.6 * (1 - share) ** 1.5 * MathUtils.smoothstep(age, 0, 0.06);
    if (light <= MIN_LIGHT) return n;
    const s = cloud.scale;
    const out = reach(age, shell.duration, shell.timeConstant);
    const radius = shell.radius * s * out;
    const boost = lowSizeBoost(FULL.shell, count);
    const r = this.seeds;
    for (let i = 0, seed = seeds; i < count; i++, seed += SEEDS) {
      const a = r[seed] * TAU;
      // Mostly low over the ground, a few up the side
      const elevation = r[seed + 1] ** 1.5 * 1.3;
      const k = radius * (0.85 + 0.15 * r[seed + 2]);
      const diameter = MathUtils.lerp(shell.size[0], shell.size[1], r[seed + 3]) * s * (0.6 + 0.6 * out) * boost;
      this.px = Math.cos(a) * Math.cos(elevation) * k;
      this.py = Math.max(0.3 * diameter, Math.sin(elevation) * k * 0.6);
      this.pz = Math.sin(a) * Math.cos(elevation) * k;
      this.putGlow(n++, cloud, diameter, r[seed + 3], colors.shell, light);
    }
    return n;
  }

  /**
   * Glowing debris thrown out and up, slowed by the air and falling back,
   * each a streak of its last few positions. A sprite that has reached the
   * ground is left out.
   */
  private writeEmbers(cloud: Cloud, seeds: number, count: number, n: number): number {
    const { embers, colors } = LOOK;
    const t = cloud.t;
    if (count === 0 || t >= EMBERS_END) return n;
    const s = cloud.scale;
    const r = this.seeds;
    const drag = embers.drag;
    const gravity = embers.gravity * s;
    for (let e = 0, seed = seeds; e < count; e++, seed += embers.trail * SEEDS) {
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
        this.putGlow(n++, cloud, size * (1 - 0.18 * j), r[seed + 6], colors.ember, 1.5 * fade);
      }
    }
    return n;
  }

  /** Burning ground around the foot of the stem, flickering in game time. */
  private writeGroundFire(cloud: Cloud, seeds: number, count: number, n: number): number {
    const { groundFire, colors } = LOOK;
    const t = cloud.t;
    const light =
      1.2 *
      MathUtils.smoothstep(t, groundFire.start, groundFire.start + 0.4) *
      (1 - MathUtils.smoothstep(t, groundFire.fadeStart, groundFire.fadeEnd));
    if (count === 0 || light <= MIN_LIGHT) return n;
    const s = cloud.scale;
    const boost = lowSizeBoost(FULL.groundFire, count);
    const r = this.seeds;
    for (let i = 0, seed = seeds; i < count; i++, seed += SEEDS) {
      const a = r[seed] * TAU;
      const d = MathUtils.lerp(groundFire.radius[0], groundFire.radius[1], Math.sqrt(r[seed + 1])) * s;
      const phase = r[seed + 2] * TAU;
      const flicker = (0.7 + 0.3 * Math.sin(9 * t + phase)) * (0.85 + 0.15 * Math.sin(23 * t + 3 * phase));
      const diameter =
        MathUtils.lerp(groundFire.size[0], groundFire.size[1], r[seed + 3]) * s * boost *
        (0.9 + 0.2 * Math.sin(6 * t + 2 * phase));
      this.px = Math.cos(a) * d;
      this.py = diameter * 0.35;
      this.pz = Math.sin(a) * d;
      this.putGlow(n++, cloud, diameter, r[seed + 3], colors.groundFire, light * flicker);
    }
    return n;
  }

  /** Stem fire: rising through the core of the stem, dimmer the higher it gets. */
  private writeStemFire(cloud: Cloud, seeds: number, count: number, n: number): number {
    const { stem, colors } = LOOK;
    const t = cloud.t;
    const fireLight = 1.3 * MathUtils.smoothstep(t, 0.25, 0.5) * (1 - MathUtils.smoothstep(t, 1.8, 4.5));
    if (count === 0 || fireLight <= MIN_LIGHT) return n;
    const s = cloud.scale;
    const boost = lowSizeBoost(FULL.stemFire, count);
    const r = this.seeds;
    const width = stem.width * s * 0.6;
    for (let i = 0, seed = seeds; i < count; i++, seed += SEEDS) {
      const climb = fract(r[seed] + 0.8 * (t - 0.25));
      const light = fireLight * (1 - 0.65 * climb) * MathUtils.smoothstep(climb, 0, 0.1);
      if (light <= MIN_LIGHT) continue;
      const radius = width * Math.sqrt(r[seed + 1]);
      const a = r[seed + 2] * TAU + 0.7 * t;
      this.px = Math.cos(a) * radius;
      this.py = this.stemTop * climb * 0.9;
      this.pz = Math.sin(a) * radius;
      this.drift();
      this.putGlow(n++, cloud, (6 + 4 * r[seed + 3]) * s * boost, r[seed + 3], colors.stemFire, light);
    }
    return n;
  }

  /**
   * Glow under the cap and inside its tube, lit by the fire below: sprites
   * on the underside of the torus that flow inward with its roll, orange
   * cooling to dark red.
   */
  private writeRim(cloud: Cloud, seeds: number, count: number, n: number): number {
    const { colors } = LOOK;
    const t = cloud.t;
    const rimLight = 1.3 * MathUtils.smoothstep(t, 0.8, 1.6) * (1 - MathUtils.smoothstep(t, 4, 11));
    if (count === 0 || rimLight <= MIN_LIGHT) return n;
    const cool = MathUtils.smoothstep(t, 2, 8);
    const red = MathUtils.lerp(colors.rim.r, colors.rimLate.r, cool);
    const green = MathUtils.lerp(colors.rim.g, colors.rimLate.g, cool);
    const blue = MathUtils.lerp(colors.rim.b, colors.rimLate.b, cool);
    const boost = lowSizeBoost(FULL.rim, count);
    const r = this.seeds;
    for (let i = 0, seed = seeds; i < count; i++, seed += SEEDS) {
      const u = r[seed + 3];
      // Along the underside, inward as the tube rolls, fading at both ends of the band
      const band = fract(r[seed + 1] + 0.12 * this.roll);
      this.torusPoint(r[seed] * TAU + 0.1 * t, -Math.PI / 2 + (0.5 - band) * 2.2, 0.3 + 0.7 * r[seed + 2]);
      this.drift();
      const light = rimLight * Math.sin(Math.PI * band);
      if (light <= MIN_LIGHT) continue;
      const diameter = this.tubeR * 0.8 * (0.8 + 0.4 * u) * boost;
      this.putGlowRgb(n++, cloud, diameter, u, red * light, green * light, blue * light);
    }
    return n;
  }

  /** The point px/py/pz as glow sprite `n`: `diameter` in metres, colour times `light`; `pick` chooses puff and turn. */
  private putGlow(n: number, cloud: Cloud, diameter: number, pick: number, color: EffectRgb, light: number): void {
    this.putGlowRgb(n, cloud, diameter, pick, color.r * light, color.g * light, color.b * light);
  }

  private putGlowRgb(n: number, cloud: Cloud, diameter: number, pick: number, r: number, g: number, b: number): void {
    const frame = Math.floor(fract(pick * 13.7) * ATLAS_FRAMES);
    const rotation = TAU * fract(pick * 7.9) + (fract(pick * 3.1) - 0.5) * cloud.t;
    this.sprites.put(
      n,
      cloud.x + this.px,
      cloud.y + this.py,
      cloud.z + this.pz,
      cloud.y,
      diameter / GLOW_COVERAGE,
      rotation,
      1,
      frame,
      r,
      g,
      b,
    );
  }

  /** Draw the first `count` glow sprites written this frame. */
  commit(count: number): void {
    this.sprites.commit(count);
  }

  /** Remove and free the buffer; the material belongs to the renderer. */
  dispose(scene: Scene): void {
    this.sprites.dispose(scene);
  }
}
