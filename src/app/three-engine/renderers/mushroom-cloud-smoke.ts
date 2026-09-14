import { MathUtils, Vector3, type Scene, type ShaderMaterial } from 'three';
import { MUSHROOM_CLOUD_LOOK as LOOK, type EffectRgb } from '../../configs/visual-effects.config';
import { reach } from './effect-buffers';
import { ATLAS_FRAMES, SpriteBuffer } from './mushroom-cloud-sprites';
import { CloudShape, SEEDS, TAU, fract, lowSizeBoost, type Cloud } from './mushroom-cloud-shape';

const FULL = LOOK.smokeSprites.full;
const LOW = LOOK.smokeSprites.low;
const SMOKE_PER_CLOUD =
  FULL.cap + FULL.dome + FULL.stem + FULL.inflow + FULL.surge + FULL.wall + FULL.condensation;
/** Staged values per puff: x, y, z, floor, size, rotation, alpha, frame, colour, fire light */
const STAGE = 14;
/** A puff fainter than this is left out */
const MIN_ALPHA = 0.01;
/** Share of a sprite the dense middle of a billow covers */
const SMOKE_COVERAGE = 0.8;
/** Smoke behind the fireball (996) and the glow (997), and in front of them */
const BACK_ORDER = 995;
const FRONT_ORDER = 998;

/**
 * The smoke of the mushroom clouds: cap, dome, stem, dust drawn in to the
 * stem's foot, base surge, dust wall and condensation ring, as lit sprites
 * (MushroomCloudRenderer). The puffs of all clouds are staged, sorted far
 * to near and written in that order, as they blend normally: those farther
 * than the fireball into the buffer drawn before it, the others into the
 * one drawn after it and after the glow. A cloud with impact effects off
 * writes the `low` counts, larger.
 */
export class CloudSmoke extends CloudShape {
  private readonly seeds = new Float32Array(LOOK.clouds * SMOKE_PER_CLOUD * SEEDS);
  private readonly back: SpriteBuffer;
  private readonly front: SpriteBuffer;

  // The smoke of all clouds is staged, sorted by camera distance and then written
  private readonly stage = new Float32Array(LOOK.clouds * SMOKE_PER_CLOUD * STAGE);
  /** Squared distance to the camera, -1 = not drawn */
  private readonly depth = new Float32Array(LOOK.clouds * SMOKE_PER_CLOUD).fill(-1);
  private readonly order = new Uint16Array(LOOK.clouds * SMOKE_PER_CLOUD);
  private readonly cameraPosition = new Vector3();
  /** Colour between dust and smoke, for the stem */
  private readonly mixed = { r: 0, g: 0, b: 0 };

  constructor(scene: Scene, material: ShaderMaterial) {
    super();
    for (let i = 0; i < this.order.length; i++) this.order[i] = i;
    const capacity = LOOK.clouds * SMOKE_PER_CLOUD;
    this.back = new SpriteBuffer(scene, capacity, material, BACK_ORDER, 'mushroom-smoke-back', true);
    this.front = new SpriteBuffer(scene, capacity, material, FRONT_ORDER, 'mushroom-smoke-front', true);
  }

  /** Draw the random numbers of a strike in cloud `slot`. */
  seed(slot: number): void {
    const start = slot * SMOKE_PER_CLOUD * SEEDS;
    for (let i = start; i < start + SMOKE_PER_CLOUD * SEEDS; i++) this.seeds[i] = Math.random();
  }

  /** The camera of this frame, which sorts the smoke and turns the cap's puffs. */
  beginFrame(cameraPosition: Vector3): void {
    this.cameraPosition.copy(cameraPosition);
  }

  /** Every puff of one cloud into the stage. */
  stageCloud(cloud: Cloud, slot: number): void {
    this.shape(cloud);
    const { cap, stem, inflow, surge, shockwave, condensation, colors } = LOOK;
    const counts = cloud.full ? FULL : LOW;
    const t = cloud.t;
    const s = cloud.scale;
    const r = this.seeds;
    let i = slot * SMOKE_PER_CLOUD;
    let seed = i * SEEDS;
    this.hide(slot);
    // The smoke darkens as it cools
    const darken = 1 - 0.3 * MathUtils.smoothstep(t, 3, 12);

    // Cap: a torus rolling out over the top and in underneath, bulging in
    // lobes around the stem that shift as it boils. Each puff turns with the
    // roll as the camera sees it. Lit by the fire at first, its underside
    // for longer.
    const capAlpha = 0.6 * MathUtils.smoothstep(t, cap.appear[0], cap.appear[1]) * (1 - this.spread);
    const capWarm = 1 - MathUtils.smoothstep(t, 1.5, 5);
    const rimWarm = 1 - MathUtils.smoothstep(t, 4, 11);
    const puffGrowth = 1 + 0.5 * this.spread;
    let boost = lowSizeBoost(FULL.cap, counts.cap);
    for (let p = 0; p < counts.cap; p++) {
      const q = seed + p * SEEDS;
      const phi = r[q] * TAU;
      const theta = r[q + 1] * TAU - this.roll;
      const u = r[q + 2];
      const v = r[q + 3];
      const lobe = 1 + cap.lobes * (Math.sin(3 * phi + 0.35 * t + 2) + 0.6 * Math.sin(5 * phi - 0.25 * t));
      const k = (0.45 + 0.55 * u) * lobe;
      this.torusPoint(phi, theta, k);
      this.spreadOut(phi, u, v, s);
      this.drift();
      const sin = Math.sin(theta);
      const warm = Math.max(capWarm, rimWarm * Math.max(0, -sin) ** 0.6);
      const boil = 1 + 0.15 * Math.sin(1.1 * t + TAU * v);
      const diameter = this.tubeR * (0.95 + 0.4 * v) * puffGrowth * boil * boost;
      this.putSmoke(i + p, cloud, diameter, capAlpha, colors.smoke, (0.9 + 0.2 * sin) * darken, warm, u, v, this.capSpin(cloud, phi));
    }
    i += FULL.cap;
    seed += FULL.cap * SEEDS;

    // Dome: covers the middle of the cap, welling up at the centre and
    // flowing out to the torus
    const domeAlpha = 0.55 * MathUtils.smoothstep(t, cap.appear[0] + 0.2, cap.appear[1] + 0.4) * (1 - this.spread);
    const domeR = this.ringR + 0.25 * this.tubeR;
    boost = lowSizeBoost(FULL.dome, counts.dome);
    for (let p = 0; p < counts.dome; p++) {
      const q = seed + p * SEEDS;
      const out = fract(r[q] + 0.08 * t);
      const phi = r[q + 1] * TAU + 0.12 * t;
      const rho = domeR * Math.sqrt(out);
      this.px = Math.cos(phi) * rho;
      this.py = this.capY + this.tubeR * cap.flatten * (0.5 + 0.6 * (1 - out));
      this.pz = Math.sin(phi) * rho;
      this.spreadOut(phi, r[q + 2], r[q + 3], s);
      this.drift();
      const edges = MathUtils.smoothstep(out, 0, 0.12) * (1 - MathUtils.smoothstep(out, 0.85, 1));
      const diameter = this.tubeR * (1 + 0.3 * r[q + 3]) * puffGrowth * boost;
      this.putSmoke(i + p, cloud, diameter, domeAlpha * edges, colors.smoke, 1.05 * darken, 0.6 * capWarm, r[q + 2], r[q + 3], 0);
    }
    i += FULL.dome;
    seed += FULL.dome * SEEDS;

    // Stem: dust and smoke climbing into the cap, wide at the foot, narrow
    // in the middle, flaring into the cap at the top, fire-lit at the bottom
    // at first. Dust at the foot, smoke higher up.
    const stemAlpha =
      0.5 * MathUtils.smoothstep(t, stem.start, stem.start + 0.6) * (1 - MathUtils.smoothstep(t, 9, 17));
    const stemWarm = 1 - MathUtils.smoothstep(t, 0.6, 3.5);
    const climbed = stem.flow * Math.max(0, t - stem.start);
    const footFlare = stem.foot / stem.width - 1;
    boost = lowSizeBoost(FULL.stem, counts.stem);
    for (let p = 0; p < counts.stem; p++) {
      const q = seed + p * SEEDS;
      const climb = fract(r[q] + climbed);
      const width =
        stem.width * s * (1 + footFlare * (1 - climb) ** 4) * (1 + 0.6 * this.spread) + 0.45 * this.ringR * climb ** 5;
      const radius = width * 0.8 * Math.sqrt(r[q + 1]);
      const a = r[q + 2] * TAU + 0.5 * t;
      this.px = Math.cos(a) * radius;
      this.py = this.stemTop * climb;
      this.pz = Math.sin(a) * radius;
      this.drift();
      const edges = MathUtils.smoothstep(climb, 0, 0.06) * (1 - MathUtils.smoothstep(climb, 0.9, 1));
      const diameter = (width * 1.1 + 3 * s) * (0.85 + 0.3 * r[q + 3]) * boost;
      this.py = Math.max(this.py, 0.35 * diameter);
      const mixed = this.mixed;
      mixed.r = MathUtils.lerp(colors.dust.r, colors.smoke.r, climb);
      mixed.g = MathUtils.lerp(colors.dust.g, colors.smoke.g, climb);
      mixed.b = MathUtils.lerp(colors.dust.b, colors.smoke.b, climb);
      this.putSmoke(i + p, cloud, diameter, stemAlpha * edges, mixed, 0.95 * darken, stemWarm * (1 - 0.7 * climb), r[q + 2], r[q + 3], 0);
    }
    i += FULL.stem;
    seed += FULL.stem * SEEDS;

    // Inflow: dust drawn in along the ground to the stem's foot, spiralling,
    // rising as it gets there
    const inflowAlpha =
      0.42 * MathUtils.smoothstep(t, inflow.start, inflow.start + 1) * (1 - MathUtils.smoothstep(t, 10, 18));
    const trips = inflow.rate * Math.max(0, t - inflow.start);
    const footR = stem.foot * s * 0.6;
    boost = lowSizeBoost(FULL.inflow, counts.inflow);
    for (let p = 0; p < counts.inflow; p++) {
      const q = seed + p * SEEDS;
      const way = fract(r[q] + trips);
      const from = MathUtils.lerp(inflow.radius[0], inflow.radius[1], r[q + 1]) * s;
      const radius = MathUtils.lerp(from, footR, way ** 0.8);
      const a = r[q + 2] * TAU + 1.4 * way;
      const diameter = (9 + 6 * r[q + 3]) * s * (1 - 0.35 * way) * boost;
      this.px = Math.cos(a) * radius;
      this.py = Math.max(0.35 * diameter, (1.5 + 10 * way ** 3 + 3 * r[q + 3]) * s);
      this.pz = Math.sin(a) * radius;
      const edges = MathUtils.smoothstep(way, 0, 0.15) * (1 - MathUtils.smoothstep(way, 0.85, 1));
      this.putSmoke(i + p, cloud, diameter, inflowAlpha * edges, colors.dust, 0.85, 0, r[q + 1], r[q + 3], 0);
    }
    i += FULL.inflow;
    seed += FULL.inflow * SEEDS;

    // Base surge: a ring of dust rolling out along the ground, creeping on
    const surgeAge = t - surge.start;
    const surgeAlpha =
      surgeAge <= 0 ? 0 : 0.45 * MathUtils.smoothstep(surgeAge, 0, 0.6) * (1 - MathUtils.smoothstep(t, 9, 20));
    const surgeOut = 1 - Math.exp(-Math.max(0, surgeAge) / surge.time);
    const surgeRise = MathUtils.smoothstep(surgeAge, 0, 3);
    const surgeGrowth = 1 + 0.08 * Math.min(t, 10);
    const surgeWarm = 0.35 * (1 - MathUtils.smoothstep(t, 0.5, 1.5));
    boost = lowSizeBoost(FULL.surge, counts.surge);
    for (let p = 0; p < counts.surge; p++) {
      const q = seed + p * SEEDS;
      const phi = r[q] * TAU + 0.02 * t;
      const radius = (surge.radius * (0.55 + 0.45 * r[q + 1]) * surgeOut + 0.8 * Math.max(0, surgeAge)) * s;
      const diameter = (14 + 8 * r[q + 3]) * s * surgeGrowth * boost;
      this.px = Math.cos(phi) * radius;
      this.py = Math.max(
        0.35 * diameter,
        MathUtils.lerp(surge.height[0], surge.height[1], r[q + 2]) * s * (0.4 + 0.6 * surgeRise),
      );
      this.pz = Math.sin(phi) * radius;
      this.putSmoke(i + p, cloud, diameter, surgeAlpha, colors.dust, 0.95, surgeWarm, r[q + 1], r[q + 3], 0);
    }
    i += FULL.surge;
    seed += FULL.surge * SEEDS;

    // Dust wall: thrown up on the shockwave's front and left standing where
    // the front stops, creeping on a little
    const wallAlpha = 0.5 * MathUtils.smoothstep(t, 0.03, 0.2) * (1 - MathUtils.smoothstep(t, 1.6, 4));
    const front =
      shockwave.radius * s * reach(t, shockwave.duration, shockwave.timeConstant) +
      2 * s * Math.max(0, t - shockwave.duration);
    const wallWarm = 0.45 * (1 - MathUtils.smoothstep(t, 0.1, 0.6));
    const wallRise = MathUtils.smoothstep(t, 0, 0.5);
    boost = lowSizeBoost(FULL.wall, counts.wall);
    for (let p = 0; p < counts.wall; p++) {
      const q = seed + p * SEEDS;
      const phi = r[q] * TAU;
      const radius = front * (0.92 + 0.1 * r[q + 1]);
      const diameter = (9 + 7 * r[q + 3]) * s * (0.6 + 0.4 * wallRise) * boost;
      this.px = Math.cos(phi) * radius;
      this.py = diameter * 0.35 + 5 * s * r[q + 2] * wallRise;
      this.pz = Math.sin(phi) * radius;
      this.putSmoke(i + p, cloud, diameter, wallAlpha, colors.dust, 1.05, wallWarm, r[q + 1], r[q + 3], 0);
    }
    i += FULL.wall;
    seed += FULL.wall * SEEDS;

    // Condensation ring (Wilson cloud): a white ring around the stem, early
    // on, spreading out and gone once the cap is up
    const ringAlpha =
      0.6 *
      MathUtils.smoothstep(t, condensation.start, condensation.start + 0.35) *
      (1 - MathUtils.smoothstep(t, condensation.end - 1.2, condensation.end));
    const ringOut = 1 - Math.exp(-Math.max(0, t - condensation.start) / condensation.time);
    const ringRadius = MathUtils.lerp(condensation.radius[0], condensation.radius[1], ringOut) * s;
    const ringY = this.capY * condensation.height;
    boost = lowSizeBoost(FULL.condensation, counts.condensation);
    for (let p = 0; p < counts.condensation; p++) {
      const q = seed + p * SEEDS;
      const phi = r[q] * TAU + 0.05 * t;
      const radius = ringRadius * (0.88 + 0.24 * r[q + 1]);
      this.px = Math.cos(phi) * radius;
      this.py = ringY + (r[q + 2] - 0.5) * 4 * s;
      this.pz = Math.sin(phi) * radius;
      this.drift();
      const diameter = (10 + 6 * r[q + 3]) * s * boost;
      this.putSmoke(i + p, cloud, diameter, ringAlpha, colors.condensation, 1.1, 0, r[q + 1], r[q + 3], 0);
    }
  }

  /**
   * How far a cap puff at `phi` around the stem, at px/py/pz, has turned
   * on the screen: the tube rolls about the tangent of the ring, so the
   * puffs on either side of the stem turn opposite ways.
   */
  private capSpin(cloud: Cloud, phi: number): number {
    const dx = this.cameraPosition.x - cloud.x - this.px;
    const dy = this.cameraPosition.y - cloud.y - this.py;
    const dz = this.cameraPosition.z - cloud.z - this.pz;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return distance > 1 ? (this.roll * (Math.sin(phi) * dx - Math.cos(phi) * dz)) / distance : 0;
  }

  /**
   * The point px/py/pz as puff `i` of the stage: `diameter` in metres,
   * `alpha` at its densest, `base` colour times `lum`, fire light `warm`;
   * `u` and `v` pick its billow and turn, `spin` turns it on.
   */
  private putSmoke(
    i: number,
    cloud: Cloud,
    diameter: number,
    alpha: number,
    base: EffectRgb,
    lum: number,
    warm: number,
    u: number,
    v: number,
    spin: number,
  ): void {
    if (alpha < MIN_ALPHA) {
      this.depth[i] = -1;
      return;
    }
    const x = cloud.x + this.px;
    const y = cloud.y + this.py;
    const z = cloud.z + this.pz;
    const lit = LOOK.colors.fireLit;
    const o = i * STAGE;
    const stage = this.stage;
    stage[o] = x;
    stage[o + 1] = y;
    stage[o + 2] = z;
    stage[o + 3] = cloud.y;
    stage[o + 4] = diameter / SMOKE_COVERAGE;
    stage[o + 5] = TAU * fract(u * 5.1 + v * 2.9) + spin;
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

  hide(slot: number): void {
    this.depth.fill(-1, slot * SMOKE_PER_CLOUD, (slot + 1) * SMOKE_PER_CLOUD);
  }

  /**
   * Sort the staged smoke far to near and write the drawn puffs: those at
   * least `splitDepthSq` (squared distance of the fireball) from the camera
   * into the buffer behind the fireball, the rest into the one in front;
   * -1, no fireball, puts all behind. Insertion sort over last frame's
   * order, which the camera and the cloud change only a little per frame.
   */
  writeSorted(splitDepthSq: number): void {
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

    let back = 0;
    let front = 0;
    for (const index of order) {
      const d = depth[index];
      if (d < 0) break;
      const behind = d >= splitDepthSq;
      const target = behind ? this.back : this.front;
      const k = behind ? back++ : front++;
      const o = index * STAGE;
      target.put(
        k,
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
      target.putGlow(k, stage[o + 11], stage[o + 12], stage[o + 13]);
    }
    this.back.commit(back);
    this.front.commit(front);
  }

  /** Drop every staged puff and draw none (restart). */
  clear(): void {
    this.depth.fill(-1);
    this.back.commit(0);
    this.front.commit(0);
  }

  /** Remove and free the buffers; the material belongs to the renderer. */
  dispose(scene: Scene): void {
    this.back.dispose(scene);
    this.front.dispose(scene);
  }
}
