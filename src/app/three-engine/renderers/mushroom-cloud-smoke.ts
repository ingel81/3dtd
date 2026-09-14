import { MathUtils, Vector3, type Scene, type ShaderMaterial } from 'three';
import { MUSHROOM_CLOUD_LOOK as LOOK, type EffectRgb } from '../../configs/visual-effects.config';
import { commitParticles, particleBuffer, reach, type ParticleBuffer } from './effect-buffers';
import { CloudShape, SEEDS, TAU, fract, type Cloud } from './mushroom-cloud-shape';

const SMOKE = LOOK.smokeParticles;
const SMOKE_PER_CLOUD =
  SMOKE.cap + SMOKE.dome + SMOKE.stem + SMOKE.dust + SMOKE.skirt + SMOKE.wall + SMOKE.condensation;
/** Staged smoke values per particle: x, y, z, size, r, g, b, frame */
const STAGE = 8;

/** Frames of the 4x4 sprite atlases */
const ATLAS_FRAMES = 16;
/**
 * Centre alpha of smoke-atlas frame 0 as drawn: 0.6 in the atlas
 * (generateSmokeAtlas) times the 0.85 of the normal particle shader. Each
 * later frame is wider and fainter, the last one empty.
 */
const SMOKE_ALPHA = 0.51;
/** A puff fainter than this is left out */
const MIN_ALPHA = 0.015;
/** After the glow (CloudGlow), so smoke in front of it dims it */
const SMOKE_ORDER = 997;

/** Smoke-atlas frame whose centre alpha comes closest to `alpha`; the empty last frame is never picked. */
function smokeFrameFor(alpha: number): number {
  const frame = Math.round((ATLAS_FRAMES - 1) * (1 - alpha / SMOKE_ALPHA));
  return Math.min(ATLAS_FRAMES - 2, Math.max(0, frame));
}

/** Share of the sprite the puff of a smoke-atlas frame covers: 0.3 to 1 of 0.45 cell radius (generateSmokeAtlas). */
function smokeCoverage(frame: number): number {
  return 0.9 * (0.3 + (0.7 * frame) / (ATLAS_FRAMES - 1));
}

/**
 * The smoke of the mushroom clouds: cap, dome, stem, dust surge, skirt,
 * dust wall and condensation ring, as Points with the trail pools' normal
 * material (MushroomCloudRenderer). The puffs of all clouds are staged,
 * sorted far to near and written in that order, as they blend normally.
 */
export class CloudSmoke extends CloudShape {
  private readonly seeds = new Float32Array(LOOK.clouds * SMOKE_PER_CLOUD * SEEDS);
  private readonly buffer: ParticleBuffer;

  // The smoke of all clouds is staged, sorted by camera distance and then written
  private readonly stage = new Float32Array(LOOK.clouds * SMOKE_PER_CLOUD * STAGE);
  /** Squared distance to the camera, -1 = not drawn */
  private readonly depth = new Float32Array(LOOK.clouds * SMOKE_PER_CLOUD).fill(-1);
  private readonly order = new Uint16Array(LOOK.clouds * SMOKE_PER_CLOUD);
  // Frame values
  private sizePerMetre = 0;
  private readonly cameraPosition = new Vector3();

  constructor(scene: Scene, material: ShaderMaterial) {
    super();
    for (let i = 0; i < this.order.length; i++) this.order[i] = i;
    this.buffer = particleBuffer(scene, LOOK.clouds * SMOKE_PER_CLOUD, material, SMOKE_ORDER);
  }

  /** Draw the random numbers of a strike in cloud `slot`. */
  seed(slot: number): void {
    const smokeStart = slot * SMOKE_PER_CLOUD * SEEDS;
    for (let i = smokeStart; i < smokeStart + SMOKE_PER_CLOUD * SEEDS; i++) this.seeds[i] = Math.random();
  }

  /** Point size per metre and camera position of this frame; the camera sorts the smoke. */
  beginFrame(sizePerMetre: number, cameraPosition: Vector3): void {
    this.sizePerMetre = sizePerMetre;
    this.cameraPosition.copy(cameraPosition);
  }

  /** Cap, dome, stem, dust surge, skirt, dust wall and condensation ring of one cloud into the stage. */
  stageCloud(cloud: Cloud, slot: number): void {
    this.shape(cloud);
    const { cap, stem, dust, shockwave, condensation, colors } = LOOK;
    const t = cloud.t;
    const s = cloud.scale;
    const seeds = this.seeds;
    let i = slot * SMOKE_PER_CLOUD;
    let seed = i * SEEDS;

    // Cap: a torus rolling out over the top and in underneath, bulging in
    // lobes around the stem that shift as it boils, so the rolling reads from
    // afar. Lit orange by the fireball at first, its underside glowing for
    // longer; dark on top.
    const capAlpha = 0.5 * MathUtils.smoothstep(t, cap.start, cap.start + 0.7) * (1 - this.spread);
    const capWarm = 1 - MathUtils.smoothstep(t, 1, 3.6);
    const rimWarm = 1 - MathUtils.smoothstep(t, 2.5, 7.5);
    const puffGrowth = 1 + 0.5 * this.spread;
    for (let p = 0; p < SMOKE.cap; p++, i++, seed += SEEDS) {
      const phi = seeds[seed] * TAU;
      const theta = seeds[seed + 1] * TAU - this.roll;
      const u = seeds[seed + 2];
      const v = seeds[seed + 3];
      const lobe = 1 + cap.lobes * (Math.sin(3 * phi + 0.35 * t + 2) + 0.6 * Math.sin(5 * phi - 0.25 * t));
      const k = (0.45 + 0.55 * u) * lobe;
      this.torusPoint(phi, theta, k);
      this.spreadOut(phi, u, v, s);
      this.drift();
      const sin = Math.sin(theta);
      const lum = 0.62 + 0.14 * sin - 0.12 * Math.max(0, Math.cos(theta)) * k;
      const warm = Math.max(capWarm, rimWarm * Math.max(0, -sin) ** 0.6);
      const boil = 1 + 0.15 * Math.sin(1.1 * t + TAU * v);
      this.putSmoke(i, cloud, this.tubeR * (0.95 + 0.4 * v) * puffGrowth * boil, capAlpha, colors.smoke, lum, warm);
    }

    // Dome: covers the middle of the cap, welling up at the centre and
    // flowing out to the torus
    const domeAlpha = 0.5 * MathUtils.smoothstep(t, cap.start + 0.2, cap.start + 1) * (1 - this.spread);
    const domeR = this.ringR + 0.25 * this.tubeR;
    for (let p = 0; p < SMOKE.dome; p++, i++, seed += SEEDS) {
      const out = fract(seeds[seed] + 0.1 * t);
      const phi = seeds[seed + 1] * TAU + 0.15 * t;
      const rho = domeR * Math.sqrt(out);
      this.px = Math.cos(phi) * rho;
      this.py = this.capY + this.tubeR * cap.flatten * (0.5 + 0.6 * (1 - out));
      this.pz = Math.sin(phi) * rho;
      this.spreadOut(phi, seeds[seed + 2], seeds[seed + 3], s);
      this.drift();
      const edges = MathUtils.smoothstep(out, 0, 0.12) * (1 - MathUtils.smoothstep(out, 0.85, 1));
      const diameter = this.tubeR * (1 + 0.3 * seeds[seed + 3]) * puffGrowth;
      this.putSmoke(i, cloud, diameter, domeAlpha * edges, colors.smoke, 0.85, capWarm);
    }

    // Stem: smoke climbing into the cap, wide at the foot, flaring into the
    // cap at the top, fire-lit at the bottom at first. Thins out before the cap.
    const stemAlpha =
      0.45 * MathUtils.smoothstep(t, stem.start, stem.start + 0.5) * (1 - MathUtils.smoothstep(t, 6, 11));
    const stemWarm = 1 - MathUtils.smoothstep(t, 0.6, 3.2);
    const climbed = stem.flow * Math.max(0, t - stem.start);
    for (let p = 0; p < SMOKE.stem; p++, i++, seed += SEEDS) {
      const climb = fract(seeds[seed] + climbed);
      const width =
        stem.width * s * (1 + 1.5 * (1 - climb) ** 4) * (1 + 0.6 * this.spread) + 0.45 * this.ringR * climb ** 5;
      const r = width * 0.8 * Math.sqrt(seeds[seed + 1]);
      const a = seeds[seed + 2] * TAU + 0.5 * t;
      this.px = Math.cos(a) * r;
      this.py = this.stemTop * climb;
      this.pz = Math.sin(a) * r;
      this.drift();
      const edges = MathUtils.smoothstep(climb, 0, 0.08) * (1 - MathUtils.smoothstep(climb, 0.9, 1));
      const diameter = (width * 1.2 + 2 * s) * (0.85 + 0.3 * seeds[seed + 3]);
      this.putSmoke(i, cloud, diameter, stemAlpha * edges, colors.smoke, 0.7, stemWarm * (1 - 0.7 * climb));
    }

    // Base surge: dust thrown out along the ground behind the shockwave
    const dustAlpha = 0.42 * MathUtils.smoothstep(t, 0.05, 0.3) * (1 - MathUtils.smoothstep(t, 3.5, 10));
    const dustOut = 1 - Math.exp(-t / dust.time);
    const dustWarm = 0.5 * (1 - MathUtils.smoothstep(t, 0.1, 0.9));
    const dustRise = MathUtils.smoothstep(t, 0, 2.5);
    const dustGrowth = 1 + 0.2 * Math.min(t, 5);
    for (let p = 0; p < SMOKE.dust; p++, i++, seed += SEEDS) {
      const phi = seeds[seed] * TAU + 0.03 * t;
      const r = (dust.radius * (0.75 + 0.25 * seeds[seed + 1]) * dustOut + 0.5 * t) * s;
      this.px = Math.cos(phi) * r;
      this.py = (1 + (2 + 5 * seeds[seed + 2]) * dustRise + 0.3 * t) * s;
      this.pz = Math.sin(phi) * r;
      this.putSmoke(i, cloud, (7 + 4 * seeds[seed + 3]) * s * dustGrowth, dustAlpha, colors.dust, 0.95, dustWarm);
    }

    // Skirt: darker dust drawn in around the foot of the stem
    const skirtAlpha = 0.4 * MathUtils.smoothstep(t, 0.5, 1.4) * (1 - MathUtils.smoothstep(t, 6, 12));
    const skirtOut = 1 - Math.exp(-t / 1.2);
    const skirtRise = MathUtils.smoothstep(t, 0.5, 3);
    const skirtGrowth = 1 + 0.1 * Math.min(t, 5);
    for (let p = 0; p < SMOKE.skirt; p++, i++, seed += SEEDS) {
      const phi = seeds[seed] * TAU + 0.2 * t;
      const r = (6 + 15 * seeds[seed + 1] * skirtOut) * s;
      this.px = Math.cos(phi) * r;
      this.py = (1 + 8 * seeds[seed + 2] * skirtRise) * s;
      this.pz = Math.sin(phi) * r;
      this.putSmoke(i, cloud, (8 + 4 * seeds[seed + 3]) * s * skirtGrowth, skirtAlpha, colors.dust, 0.7, 0);
    }

    // Dust wall: thrown up on the shockwave's front and left standing where
    // the front stops, creeping on a little
    const wallAlpha = 0.45 * MathUtils.smoothstep(t, 0.03, 0.2) * (1 - MathUtils.smoothstep(t, 1.2, 3.2));
    const front =
      shockwave.radius * s * reach(t, shockwave.duration, shockwave.timeConstant) +
      1.5 * s * Math.max(0, t - shockwave.duration);
    const wallWarm = 0.45 * (1 - MathUtils.smoothstep(t, 0.1, 0.6));
    const wallRise = MathUtils.smoothstep(t, 0, 0.5);
    for (let p = 0; p < SMOKE.wall; p++, i++, seed += SEEDS) {
      const phi = seeds[seed] * TAU;
      const r = front * (0.9 + 0.12 * seeds[seed + 1]);
      const diameter = (6 + 5 * seeds[seed + 3]) * s * (0.6 + 0.4 * wallRise);
      this.px = Math.cos(phi) * r;
      this.py = diameter * 0.3 + 4 * s * seeds[seed + 2] * wallRise;
      this.pz = Math.sin(phi) * r;
      this.putSmoke(i, cloud, diameter, wallAlpha, colors.dust, 1, wallWarm);
    }

    // Condensation ring: a white ring around the stem at mid height, early
    // on, spreading out and gone before the cap is up
    const ringAlpha =
      0.36 *
      MathUtils.smoothstep(t, condensation.start, condensation.start + 0.4) *
      (1 - MathUtils.smoothstep(t, condensation.end - 1.4, condensation.end));
    const ringOut = 1 - Math.exp(-Math.max(0, t - condensation.start) / condensation.time);
    const ringRadius = MathUtils.lerp(condensation.radius[0], condensation.radius[1], ringOut) * s;
    const ringY = this.capY * 0.45;
    for (let p = 0; p < SMOKE.condensation; p++, i++, seed += SEEDS) {
      const phi = seeds[seed] * TAU + 0.05 * t;
      const r = ringRadius * (0.85 + 0.3 * seeds[seed + 1]);
      this.px = Math.cos(phi) * r;
      this.py = ringY + (seeds[seed + 2] - 0.5) * 3 * s;
      this.pz = Math.sin(phi) * r;
      this.drift();
      this.putSmoke(i, cloud, (7 + 5 * seeds[seed + 3]) * s, ringAlpha, colors.condensation, 1.15, 0);
    }
  }

  /**
   * The point px/py/pz as smoke puff `i` of the stage: `diameter` in metres,
   * `alpha` at its centre (picks the atlas frame), `base` colour times `lum`
   * blended towards the fire-lit colour by `warm`.
   */
  private putSmoke(
    i: number,
    cloud: Cloud,
    diameter: number,
    alpha: number,
    base: EffectRgb,
    lum: number,
    warm: number,
  ): void {
    if (alpha < MIN_ALPHA) {
      this.depth[i] = -1;
      return;
    }
    const x = cloud.x + this.px;
    const y = cloud.y + this.py;
    const z = cloud.z + this.pz;
    const frame = smokeFrameFor(alpha);
    const lit = LOOK.colors.fireLit;
    const o = i * STAGE;
    const stage = this.stage;
    stage[o] = x;
    stage[o + 1] = y;
    stage[o + 2] = z;
    stage[o + 3] = (diameter / smokeCoverage(frame)) * this.sizePerMetre;
    stage[o + 4] = MathUtils.lerp(base.r * lum, lit.r, warm);
    stage[o + 5] = MathUtils.lerp(base.g * lum, lit.g, warm);
    stage[o + 6] = MathUtils.lerp(base.b * lum, lit.b, warm);
    stage[o + 7] = frame;
    const dx = x - this.cameraPosition.x;
    const dy = y - this.cameraPosition.y;
    const dz = z - this.cameraPosition.z;
    this.depth[i] = dx * dx + dy * dy + dz * dz;
  }

  hide(slot: number): void {
    this.depth.fill(-1, slot * SMOKE_PER_CLOUD, (slot + 1) * SMOKE_PER_CLOUD);
  }

  /**
   * Sort the staged smoke far to near and write the drawn puffs into the
   * smoke buffer; returns how many. Insertion sort over last frame's order,
   * which the camera and the cloud change only a little per frame.
   */
  writeSorted(): number {
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

    const position = this.buffer.position.array as Float32Array;
    const size = this.buffer.size.array as Float32Array;
    const rgb = this.buffer.color.array as Float32Array;
    const frame = this.buffer.frame.array as Float32Array;
    let n = 0;
    for (; n < order.length; n++) {
      const index = order[n];
      if (depth[index] < 0) break;
      const o = index * STAGE;
      position[n * 3] = stage[o];
      position[n * 3 + 1] = stage[o + 1];
      position[n * 3 + 2] = stage[o + 2];
      size[n] = stage[o + 3];
      rgb[n * 3] = stage[o + 4];
      rgb[n * 3 + 1] = stage[o + 5];
      rgb[n * 3 + 2] = stage[o + 6];
      frame[n] = stage[o + 7];
    }
    return n;
  }

  /** Draw the first `count` puffs written this frame. */
  commit(count: number): void {
    commitParticles(this.buffer, count);
  }

  /** Drop every staged puff (restart). */
  clear(): void {
    this.depth.fill(-1);
  }

  /** Remove and free the buffer; the material belongs to the trail pools. */
  dispose(scene: Scene): void {
    scene.remove(this.buffer.points);
    this.buffer.points.geometry.dispose();
  }
}
