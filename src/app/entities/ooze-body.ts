import { RouteBody, RouteBodyStations } from '../utils/route-body';

/**
 * The body of an ooze along its route (OozeConfig). The tip is where the
 * enemy walks. The tail stays where the ooze entered the path, at the portal
 * for a wave spawn, until the body is `maxLengthM` long; from then on it
 * follows the tip at the same distance, so the body keeps its length.
 *
 * Simulation state, advanced in the enemy sub-step (OozeBodies.update) from
 * the tip's distance along the path, so it is the same at every timescale.
 */
export class OozeBody extends RouteBody {
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
}
