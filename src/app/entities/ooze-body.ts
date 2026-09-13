import { RouteBody, RouteBodyStations } from '../utils/route-body';

/**
 * The body of an ooze along its route (OozeConfig). The tip is where the
 * enemy walks. The tail stays where the ooze entered the path, at the portal
 * for a wave spawn, until the body is `maxLengthM` long; from then on it
 * follows the tip at the same distance, so the body keeps its length.
 *
 * At the HQ the tip stops and the body flows in: the tail crawls on toward
 * the tip (flowIn), and every metre that enters costs its share of the leak
 * (owe, settle), see OozeBodies.update.
 *
 * Simulation state, advanced in the enemy sub-step from the tip's distance
 * along the path, so it is the same at every timescale.
 */
export class OozeBody extends RouteBody {
  /** The tip reached the end of the path, the HQ: the body flows in. */
  arrived = false;
  /** HQ damage owed for metres that went in and not charged yet, below one point */
  private leakDebt = 0;

  constructor(
    stations: RouteBodyStations,
    readonly maxLengthM: number,
    startM: number,
  ) {
    super(stations);
    this.tailM = startM;
    this.tipM = startM;
  }

  /** The tip walked to `tipM`: the tail stays or follows at maxLengthM. */
  grow(tipM: number): void {
    this.tipM = Math.max(this.tipM, tipM);
    this.tailM = Math.max(this.tailM, this.tipM - this.maxLengthM);
  }

  /** `stepM` metres flow into the HQ, at most what is left: the tail moves up. Returns the metres that went in. */
  flowIn(stepM: number): number {
    const entered = Math.max(0, Math.min(stepM, this.tipM - this.tailM));
    this.tailM += entered;
    return entered;
  }

  /** The whole body is in the HQ. */
  get flowedIn(): boolean {
    return this.arrived && this.tailM >= this.tipM;
  }

  /** Adds `damage` owed and returns the whole points to charge now; the fraction stays owed. */
  owe(damage: number): number {
    this.leakDebt += damage;
    const whole = Math.floor(this.leakDebt + 1e-9);
    this.leakDebt -= whole;
    return whole;
  }

  /** The fraction still owed once the whole body is in, rounded to a whole point. */
  settle(): number {
    const rest = Math.round(this.leakDebt);
    this.leakDebt = 0;
    return rest;
  }
}
