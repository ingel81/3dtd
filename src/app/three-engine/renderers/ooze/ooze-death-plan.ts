import { OOZE_DEATH_LOOK } from '../../../configs/visual-effects.config';
import { SeededRandom } from '../../../utils/seeded-random';
import { OOZE_DEBRIS_DECK, type OozeDebrisKind } from './ooze-debris.renderer';

/** What a collapse lets go: a bursting bubble, a splash on the ground, a piece of debris */
export type OozeMessKind = 'pop' | 'splash' | 'debris';

/** One part of a killed ooze's mess, see planOozeDeath */
export interface OozeMessEvent {
  kind: OozeMessKind;
  /** Share of the collapse (OOZE_LOOK.collapse) at which it goes */
  t: number;
  /** Metres along the body from its tail */
  alongM: number;
  /** Across the covered half width, -1 at the left edge, 1 at the right */
  across: number;
  /** The piece, for debris; null otherwise */
  debris: OozeDebrisKind | null;
  /** Seed of its own look (a splash's size, a piece's throw), see OozeBandRenderer.letGo */
  seed: number;
}

/** Share of the covered half width the mess keeps inside */
const ACROSS = 0.85;

/** How many bubbles, splashes and pieces a body `lengthM` long lets go (OOZE_DEATH_LOOK). */
export function oozeMessCounts(
  lengthM: number,
  impacts: boolean,
  groundMarks: boolean,
): { pops: number; splashes: number; debris: number } {
  const { pops, splashes, debris } = OOZE_DEATH_LOOK;
  const pieces = Math.max(debris.min, Math.round(lengthM * debris.perM));
  return {
    pops: impacts ? Math.max(pops.min, Math.round(lengthM / pops.everyM)) : 0,
    splashes: groundMarks ? Math.max(splashes.min, Math.round(lengthM / splashes.everyM)) : 0,
    debris: impacts ? pieces : Math.max(debris.minLow, Math.round(pieces * debris.lowShare)),
  };
}

/**
 * The mess of a killed ooze whose body is `lengthM` long, sorted by time:
 * oozeMessCounts of each kind, each one in its own equal stretch of the
 * whole body so they cover all of it, at a random place across and a
 * random time inside the kind's window of the collapse. The debris comes
 * in the order of OOZE_DEBRIS_DECK. With impact effects off no bubbles and
 * less debris, with ground marks off no splashes (the Low preset: both).
 *
 * Drawn from `seed` (OozeBandRenderer.collapse takes the ooze's id), each
 * part with a seed of its own: the same kill makes the same mess at any
 * timescale, the frames only decide when it is drawn.
 */
export function planOozeDeath(lengthM: number, impacts: boolean, groundMarks: boolean, seed: number): OozeMessEvent[] {
  const counts = oozeMessCounts(lengthM, impacts, groundMarks);
  const { pops, splashes, debris } = OOZE_DEATH_LOOK;
  const random = new SeededRandom(seed).next;
  const events: OozeMessEvent[] = [];
  const add = (kind: OozeMessKind, n: number, from: number, until: number): void => {
    for (let i = 0; i < n; i++) {
      events.push({
        kind,
        t: from + (until - from) * random(),
        alongM: ((i + random()) / n) * lengthM,
        across: (random() * 2 - 1) * ACROSS,
        debris: kind === 'debris' ? OOZE_DEBRIS_DECK[i % OOZE_DEBRIS_DECK.length] : null,
        seed: (random() * 4294967296) >>> 0,
      });
    }
  };
  add('pop', counts.pops, 0, pops.until);
  add('splash', counts.splashes, splashes.from, splashes.until);
  add('debris', counts.debris, debris.from, debris.until);
  return events.sort((a, b) => a.t - b.t);
}
