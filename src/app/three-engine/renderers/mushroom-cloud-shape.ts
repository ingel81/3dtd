import { MathUtils } from 'three';
import { MUSHROOM_CLOUD_LOOK as LOOK } from '../../configs/visual-effects.config';

/** Random numbers per particle, drawn once per strike */
export const SEEDS = 4;
export const TAU = Math.PI * 2;

export interface Cloud {
  active: boolean;
  /** Game seconds since the impact */
  t: number;
  /** Ground point, local coordinates */
  x: number;
  y: number;
  z: number;
  /** Strike radius over LOOK.referenceRadius */
  scale: number;
  /** Everything, or the detonation only (impact effects off) */
  full: boolean;
  /** Wind direction, unit vector on the ground */
  windX: number;
  windZ: number;
  /** Order of the strikes, the oldest cloud makes room */
  born: number;
}

export function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * The shape of the cloud being written and the point being written, for
 * its glow (CloudGlow) and its smoke (CloudSmoke): each takes the cloud's
 * cap, stem and wind at its age (shape()) before it writes, then places
 * every particle with torusPoint(), spreadOut() and drift().
 */
export abstract class CloudShape {
  // Shape of the cloud being written (shape()), metres from its ground point
  protected capY = 0;
  protected ringR = 0;
  protected tubeR = 0;
  protected roll = 0;
  protected stemTop = 0;
  protected spread = 0;
  protected windX = 0;
  protected windZ = 0;
  // Point being written, from its ground point
  protected px = 0;
  protected py = 0;
  protected pz = 0;

  /** The cloud's cap, stem and wind at its age. */
  protected shape(cloud: Cloud): void {
    const { cap, disperse } = LOOK;
    const t = cloud.t;
    const s = cloud.scale;
    const tau = Math.max(0, t - cap.start);
    // A fast punch, then the slow climb
    const height =
      cap.startHeight +
      cap.punchHeight * (1 - Math.exp(-tau / cap.punchTime)) +
      (cap.height - cap.startHeight - cap.punchHeight) * (1 - Math.exp(-tau / cap.riseTime));
    const rise = (height - cap.startHeight) / (cap.height - cap.startHeight);
    const late = Math.max(0, t - disperse.start);
    this.spread = MathUtils.smoothstep(t, disperse.start, LOOK.duration);
    this.capY = (height + disperse.rise * late) * s;
    this.ringR = (MathUtils.lerp(cap.ringRadius[0], cap.ringRadius[1], rise) + disperse.spread * late) * s;
    this.tubeR = (MathUtils.lerp(cap.tubeRadius[0], cap.tubeRadius[1], rise) + disperse.spread * 0.6 * late) * s;
    // Turned so far: rollSpeed at first, slowing down
    this.roll = cap.rollSpeed * cap.rollTime * (1 - Math.exp(-tau / cap.rollTime));
    // The stem runs into the underside of the cap
    this.stemTop = this.capY - this.tubeR * cap.flatten * 0.6;
    const drift = disperse.wind * Math.max(0, t - 1.5);
    this.windX = cloud.windX * drift;
    this.windZ = cloud.windZ * drift;
  }

  /**
   * A point of the cap's torus into px/py/pz: `phi` around the stem,
   * `theta` around the tube (pi/2 on top), `k` the share of the tube radius.
   * The roll turns theta down: out over the top, in underneath.
   */
  protected torusPoint(phi: number, theta: number, k: number): void {
    const rho = this.ringR + this.tubeR * k * Math.cos(theta);
    this.px = rho * Math.cos(phi);
    this.py = this.capY + this.tubeR * k * Math.sin(theta) * LOOK.cap.flatten;
    this.pz = rho * Math.sin(phi);
  }

  /** Push the point out and up as the cloud spreads. */
  protected spreadOut(phi: number, u: number, v: number, s: number): void {
    if (this.spread <= 0) return;
    const out = this.spread * 8 * s * (0.5 + u);
    this.px += Math.cos(phi) * out;
    this.pz += Math.sin(phi) * out;
    this.py += this.spread * 5 * s * v;
  }

  /** Wind drift, full at the cap's height and none on the ground. */
  protected drift(): void {
    const share = this.capY > 0 ? Math.min(1, Math.max(0, this.py / this.capY)) : 0;
    this.px += this.windX * share;
    this.pz += this.windZ * share;
  }
}
