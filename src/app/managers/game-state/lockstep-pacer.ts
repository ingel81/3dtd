import type { LockstepLink } from '../../coop/lockstep';
import { tickAtBoundary, tickNeededAfter } from '../../coop/lockstep';
import { HASH_EVERY_TICKS } from '../../coop/hash-check';
import type { HashBreakdown } from '../../simulator/state-hash';

/** Coop: ticks a client keeps in hand behind the relay, so it never waits at the barrier (pace) */
const LOCKSTEP_BUFFER_TICKS = 1;
/** Coop: the most the pace bends to hold the buffer, either way (0.1 = 90 % to 110 %) */
const LOCKSTEP_PACE_BEND = 0.1;
/** Coop: ticks behind beyond which a client catches up fast, as after a hidden tab (200 ms) */
const LOCKSTEP_LAG_TICKS = 6;
/** Coop: the fastest a lagging client catches up, times the room's pace */
const LOCKSTEP_MAX_CATCH_UP = 4;
/** Coop: hash breakdowns kept back, in hash reports: a desync's verdict comes a few seconds late at most. */
const KEEP_HASH_BREAKDOWNS = 10;

/** What the pacer asks of the game at a tick's boundary */
export interface LockstepTickHost {
  /** The state hash with its parts, reported at every HASH_EVERY_TICKS-th tick */
  hashBreakdown(): HashBreakdown;
  /** Run the commands of `tick` (GameCommandsHandler.runTick) */
  runTick(tick: number): void;
}

/**
 * Coop lockstep of the GameStateManager (docs/COOP_PLAN.md, C0): the relay
 * link, which tick ran last, the relay tick of this run's sub-step 0, the
 * pace against the room and the barrier at each boundary, and the hash
 * breakdowns kept for a desync's detail. Without a link the barrier is
 * always open and the pace is 1.
 */
export class LockstepPacer {
  /** Coop: the relay link, see set(); null in the single player game */
  private link: LockstepLink | null = null;
  /** Coop: the last tick whose commands ran */
  private tickRun = -1;
  /**
   * Coop: the relay tick of this run's sub-step 0. A restart in the room
   * (command:restart-game) resets the clock while the relay counts on; the
   * new run starts at the tick after the one that restarted it.
   */
  private tickBase = 0;
  /**
   * Coop: the hash breakdowns of the last reports by tick, for the detail a
   * desync asks for once its verdict came back (TODO E32). A few seconds.
   */
  private readonly breakdowns = new Map<number, HashBreakdown>();

  constructor(private readonly host: LockstepTickHost) {}

  get current(): LockstepLink | null {
    return this.link;
  }

  /** A new link or none: nothing of the previous one's ticks is kept */
  set(link: LockstepLink | null): void {
    this.link = link;
    this.tickRun = -1;
    this.tickBase = 0;
    this.breakdowns.clear();
  }

  /** A new run (reset): in a room it goes on at the relay's next tick, alone from tick 0 */
  newRun(): void {
    if (this.link) {
      this.tickBase = this.tickRun + 1;
    } else {
      this.tickRun = -1;
      this.tickBase = 0;
    }
  }

  /** Ticks the relay has closed beyond the one the sub-step after `subStep` needs */
  ticksInHand(link: LockstepLink, subStep: number): number {
    return link.confirmedTick() - (tickNeededAfter(subStep) + this.tickBase);
  }

  /**
   * Coop: this client's pace against the room's. The relay closes ticks by
   * the wall clock. A client right at the newest tick waits at the barrier
   * each tick and then runs the tick's sub-steps at once, a stutter at the tick rate
   * (measured, PLAYTEST T28: the host 72 % of its frames); one further behind
   * runs smoothly but its input comes late (the guest up to 190 ms).
   *
   * So each client holds LOCKSTEP_BUFFER_TICKS in hand: a little slower when
   * it has less, a little faster when it has more, at most
   * LOCKSTEP_PACE_BEND either way. Far behind (a slow frame, a hidden tab,
   * review R2) it catches up at up to LOCKSTEP_MAX_CATCH_UP times. 1 alone.
   * Sub-steps are fixed, so this changes when they run, never what they do.
   */
  pace(subStep: number): number {
    const link = this.link;
    if (!link) return 1;
    const behind = this.ticksInHand(link, subStep);
    if (behind > LOCKSTEP_LAG_TICKS) {
      return Math.min(LOCKSTEP_MAX_CATCH_UP, 1 + (behind - LOCKSTEP_LAG_TICKS) / LOCKSTEP_LAG_TICKS);
    }
    const bend = (behind - LOCKSTEP_BUFFER_TICKS) * LOCKSTEP_PACE_BEND;
    return 1 + Math.max(-LOCKSTEP_PACE_BEND, Math.min(LOCKSTEP_PACE_BEND, bend));
  }

  /**
   * The lockstep barrier at the boundary the clock stands at (`boundary()`):
   * false while the relay has not closed the tick before the next sub-step.
   * At a tick's boundary its commands run first, once, and every
   * HASH_EVERY_TICKS ticks the state hash goes to the relay. Always true
   * without a link.
   */
  open(boundary: () => number): boolean {
    const link = this.link;
    if (!link) return true;
    // Again after running a tick: a restart among its commands moved the clock to a new boundary
    for (;;) {
      const at = boundary();
      if (tickNeededAfter(at) + this.tickBase > link.confirmedTick()) return false;
      const local = tickAtBoundary(at);
      const tick = local < 0 ? -1 : local + this.tickBase;
      if (tick <= this.tickRun) return true;
      this.tickRun = tick;
      // The relay compares these across clients (C5): same boundary, before the tick's commands
      if (tick % HASH_EVERY_TICKS === 0) this.reportHash(link, tick);
      this.host.runTick(tick);
    }
  }

  /** Coop: the hash with its parts to the relay, the breakdown kept for a desync's detail. */
  private reportHash(link: LockstepLink, tick: number): void {
    const breakdown = this.host.hashBreakdown();
    link.reportHash(tick, breakdown.total, breakdown.parts);
    this.breakdowns.set(tick, breakdown);
    for (const kept of this.breakdowns.keys()) {
      if (kept > tick - KEEP_HASH_BREAKDOWNS * HASH_EVERY_TICKS) break;
      this.breakdowns.delete(kept);
    }
  }

  /** Coop: the breakdown reported for `tick`, while it is kept (see breakdowns). */
  breakdownAt(tick: number): HashBreakdown | null {
    return this.breakdowns.get(tick) ?? null;
  }
}
