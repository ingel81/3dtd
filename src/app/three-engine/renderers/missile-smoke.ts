import { MathUtils, Vector3, type Scene, type ShaderMaterial } from 'three';
import { MISSILE_LAUNCH_LOOK as LOOK, type EffectRgb } from '../../configs/visual-effects.config';
import type { Launch } from './missile-launch-state';
import { SEEDS, TAU, fract, lowSizeBoost } from './mushroom-cloud-shape';
import { ATLAS_FRAMES, SpriteBuffer } from './mushroom-cloud-sprites';

const FULL = LOOK.smokeSprites.full;
const LOW = LOOK.smokeSprites.low;
const SMOKE_PER_LAUNCH = FULL.cloud + FULL.trail;
/** Staged values per puff: x, y, z, floor, size, rotation, alpha, frame, colour, fire light */
const STAGE = 14;
/** A puff fainter than this is left out */
const MIN_ALPHA = 0.01;
/** Share of a sprite the dense middle of a billow covers */
const SMOKE_COVERAGE = 0.8;
/** Before the mushroom cloud's smoke (995) */
const SMOKE_ORDER = 994;
/** Trail puffs within this share of the way from either end fade towards the ground there */
const HALF_WAY = 0.5;

/**
 * The smoke of the missiles: the launch cloud welling out of the shaft and
 * rolling out along the ground, and the trail the missile leaves, as lit
 * billow sprites with the mushroom clouds' smoke material
 * (MissileLaunchRenderer). Every puff is a function of the launch's age and
 * random numbers drawn at the launch; a trail puff is born when the missile
 * passes its point of the flight (MissileFlight.timeAtDistance), laid out
 * at the launch. The puffs of all launches are staged, sorted far to near
 * and written in that order, as they blend normally. A launch with impact
 * effects off writes the `low` counts; its trail puffs lie farther apart
 * and are larger.
 */
export class MissileSmoke {
  private readonly seeds = new Float32Array(LOOK.launches * SMOKE_PER_LAUNCH * SEEDS);
  /** Per trail puff: game seconds of its birth, where (x y z), and the ground it fades towards */
  private readonly births = new Float32Array(LOOK.launches * FULL.trail);
  private readonly origins = new Float32Array(LOOK.launches * FULL.trail * 3);
  private readonly floors = new Float32Array(LOOK.launches * FULL.trail);
  /** Per launch: trail puffs laid out, and metres between them */
  private readonly trailCounts = new Uint16Array(LOOK.launches);
  private readonly spacings = new Float32Array(LOOK.launches);
  private readonly sprites: SpriteBuffer;

  private readonly stage = new Float32Array(LOOK.launches * SMOKE_PER_LAUNCH * STAGE);
  /** Squared distance to the camera, -1 = not drawn */
  private readonly depth = new Float32Array(LOOK.launches * SMOKE_PER_LAUNCH).fill(-1);
  private readonly order = new Uint16Array(LOOK.launches * SMOKE_PER_LAUNCH);
  private readonly cameraPosition = new Vector3();
  private readonly point = new Vector3();

  constructor(scene: Scene, material: ShaderMaterial) {
    for (let i = 0; i < this.order.length; i++) this.order[i] = i;
    this.sprites = new SpriteBuffer(scene, LOOK.launches * SMOKE_PER_LAUNCH, material, SMOKE_ORDER, 'missile-smoke', true);
  }

  /** Smoke sprites drawn in the last frame */
  get count(): number {
    return this.sprites.count;
  }

  /** Draw the random numbers of `launch` in `slot` and lay out its trail along its flight. */
  seed(launch: Launch, slot: number): void {
    const start = slot * SMOKE_PER_LAUNCH * SEEDS;
    for (let i = start; i < start + SMOKE_PER_LAUNCH * SEEDS; i++) this.seeds[i] = Math.random();

    const { trail } = LOOK;
    const flight = launch.flight;
    const counts = launch.full ? FULL : LOW;
    const way = Math.max(0, flight.length - trail.from);
    const count = Math.max(1, Math.min(counts.trail, Math.floor(way / trail.spacing)));
    const spacing = way / count;
    this.trailCounts[slot] = count;
    this.spacings[slot] = spacing;
    const base = slot * FULL.trail;
    for (let k = 0; k < count; k++) {
      const d = trail.from + (k + 0.5) * spacing;
      flight.atDistance(d, this.point);
      this.births[base + k] = flight.timeAtDistance(d);
      this.origins[(base + k) * 3] = this.point.x;
      this.origins[(base + k) * 3 + 1] = this.point.y;
      this.origins[(base + k) * 3 + 2] = this.point.z;
      this.floors[base + k] = d < flight.length * HALF_WAY ? launch.site.y : launch.targetY;
    }
  }

  /** The camera of this frame, which sorts the smoke. */
  beginFrame(cameraPosition: Vector3): void {
    this.cameraPosition.copy(cameraPosition);
  }

  /** Every puff of one launch into the stage. */
  stageLaunch(launch: Launch, slot: number): void {
    this.hide(slot);
    this.stageCloud(launch, slot);
    this.stageTrail(launch, slot);
  }

  hide(slot: number): void {
    this.depth.fill(-1, slot * SMOKE_PER_LAUNCH, (slot + 1) * SMOKE_PER_LAUNCH);
  }

  /**
   * Sort the staged smoke far to near and write the drawn puffs. Insertion
   * sort over last frame's order, which the camera and the smoke change only
   * a little per frame.
   */
  writeSorted(): void {
    const { order, depth, stage } = this;
    for (let i = 1; i < order.length; i++) {
      const index = order[i];
      const d = depth[index];
      let j = i - 1;
      while (j >= 0 && depth[order[j]] < d) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = index;
    }

    let n = 0;
    for (const index of order) {
      if (depth[index] < 0) break;
      const o = index * STAGE;
      this.sprites.put(
        n,
        stage[o],
        stage[o + 1],
        stage[o + 2],
        stage[o + 3],
        stage[o + 4],
        stage[o + 5],
        stage[o + 6],
        stage[o + 7],
        stage[o + 8],
        stage[o + 9],
        stage[o + 10],
      );
      this.sprites.putGlow(n, stage[o + 11], stage[o + 12], stage[o + 13]);
      n++;
    }
    this.sprites.commit(n);
  }

  /** Drop every staged puff and draw none (restart). */
  clear(): void {
    this.depth.fill(-1);
    this.sprites.commit(0);
  }

  /** Remove and free the buffer; the material belongs to the mushroom clouds. */
  dispose(scene: Scene): void {
    this.sprites.dispose(scene);
  }

  /**
   * Launch cloud: puffs born at the top of the shaft through the ignition,
   * thrown up, then out along the ground and settling low over it, lit by
   * the fire at first.
   */
  private stageCloud(launch: Launch, slot: number): void {
    const { cloud, shaftTop, colors } = LOOK;
    const counts = launch.full ? FULL : LOW;
    const boost = lowSizeBoost(FULL.cloud, counts.cloud);
    const r = this.seeds;
    const { site, t } = launch;
    let i = slot * SMOKE_PER_LAUNCH;
    for (let j = 0, seed = i * SEEDS; j < counts.cloud; j++, seed += SEEDS, i++) {
      const born = MathUtils.lerp(cloud.emit[0], cloud.emit[1], (j + r[seed]) / counts.cloud);
      const age = t - born;
      const life = MathUtils.lerp(cloud.life[0], cloud.life[1], r[seed + 1]);
      if (age <= 0 || age >= life) continue;
      const out = 1 - Math.exp(-age / cloud.spreadTime);
      const angle = r[seed + 2] * TAU;
      const radius = MathUtils.lerp(cloud.radius[0], cloud.radius[1], Math.sqrt(r[seed + 3])) * out;
      const burst = shaftTop + MathUtils.lerp(cloud.burst[0], cloud.burst[1], r[seed + 1]) * (1 - Math.exp(-age / 0.3));
      const rest = MathUtils.lerp(cloud.rest[0], cloud.rest[1], r[seed]);
      const height = MathUtils.lerp(burst, rest, MathUtils.smoothstep(age, 0.3, 2.6)) + cloud.rise * age;
      const diameter =
        (MathUtils.lerp(cloud.size[0], cloud.size[1], out) * (0.85 + 0.3 * r[seed + 2]) + cloud.growth * age) * boost;
      const drift = LOOK.trail.drift * 0.5 * age;
      const alpha =
        cloud.alpha * MathUtils.smoothstep(age, 0, 0.25) * (1 - MathUtils.smoothstep(age, 0.4 * life, life));
      const warm = 0.8 * (1 - MathUtils.smoothstep(age, 0.1, 1)) * (1 - MathUtils.smoothstep(born, 0.6, 2.2));
      this.putSmoke(
        i,
        site.x + Math.cos(angle) * radius + launch.windX * drift,
        site.y + Math.max(height, 0.35 * diameter),
        site.z + Math.sin(angle) * radius + launch.windZ * drift,
        site.y,
        diameter,
        alpha,
        colors.cloud,
        0.95 + 0.1 * r[seed + 3],
        warm,
        r[seed + 2],
        r[seed + 3],
        age,
      );
    }
  }

  /**
   * Trail: puff k where the missile passed it, from its birth on: pushed out
   * of the exhaust at first, then spreading, rising, drifting with the wind
   * and fading; lit by the flame while it is young.
   */
  private stageTrail(launch: Launch, slot: number): void {
    const { trail, colors } = LOOK;
    const r = this.seeds;
    const t = launch.t;
    const spacing = this.spacings[slot];
    const from = Math.max(trail.size[0], 0.9 * spacing);
    const to = Math.max(trail.size[1], 1.6 * spacing);
    const base = slot * FULL.trail;
    const count = this.trailCounts[slot];
    let i = slot * SMOKE_PER_LAUNCH + FULL.cloud;
    for (let k = 0, seed = i * SEEDS; k < count; k++, seed += SEEDS, i++) {
      const age = t - this.births[base + k];
      const life = MathUtils.lerp(trail.life[0], trail.life[1], r[seed]);
      if (age < 0 || age >= life) continue;
      const expand = 1 - Math.exp(-age / trail.expandTime);
      const diameter = (MathUtils.lerp(from, to, expand) + trail.growth * age) * (0.8 + 0.4 * r[seed + 2]);
      const angle = r[seed + 1] * TAU;
      const push = trail.spread * expand * (0.4 + 0.6 * r[seed + 3]);
      const drift = trail.drift * age;
      const o = (base + k) * 3;
      const alpha =
        trail.alpha * MathUtils.smoothstep(age, 0, 0.1) * (1 - MathUtils.smoothstep(age, 0.25 * life, life));
      this.putSmoke(
        i,
        this.origins[o] + Math.cos(angle) * push + launch.windX * drift,
        this.origins[o + 1] + (r[seed + 3] - 0.5) * push + trail.rise * age,
        this.origins[o + 2] + Math.sin(angle) * push + launch.windZ * drift,
        this.floors[base + k],
        diameter,
        alpha,
        colors.smoke,
        0.95 + 0.1 * r[seed + 2],
        Math.max(0, 1 - age / trail.lit),
        r[seed + 1],
        r[seed + 2],
        age,
      );
    }
  }

  /**
   * Puff `i` of the stage at x y z over the ground at `floor`: `diameter`
   * m, `alpha` at its densest, `base` colour times `lum`, flame light
   * `warm`; `u` and `v` pick its billow and turn, slowly turning with `age`.
   */
  private putSmoke(
    i: number,
    x: number,
    y: number,
    z: number,
    floor: number,
    diameter: number,
    alpha: number,
    base: EffectRgb,
    lum: number,
    warm: number,
    u: number,
    v: number,
    age: number,
  ): void {
    if (alpha < MIN_ALPHA) {
      this.depth[i] = -1;
      return;
    }
    const lit = LOOK.colors.exhaustLit;
    const o = i * STAGE;
    const stage = this.stage;
    stage[o] = x;
    stage[o + 1] = y;
    stage[o + 2] = z;
    stage[o + 3] = floor;
    stage[o + 4] = diameter / SMOKE_COVERAGE;
    stage[o + 5] = TAU * fract(u * 5.1 + v * 2.9) + (v - 0.5) * 0.15 * age;
    stage[o + 6] = alpha;
    stage[o + 7] = Math.floor(fract(u * 13.7 + v * 7.3) * ATLAS_FRAMES);
    stage[o + 8] = base.r * lum;
    stage[o + 9] = base.g * lum;
    stage[o + 10] = base.b * lum;
    stage[o + 11] = lit.r * warm;
    stage[o + 12] = lit.g * warm;
    stage[o + 13] = lit.b * warm;
    const dx = x - this.cameraPosition.x;
    const dy = y - this.cameraPosition.y;
    const dz = z - this.cameraPosition.z;
    this.depth[i] = dx * dx + dy * dy + dz * dz;
  }
}
