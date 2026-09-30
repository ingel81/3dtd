// With the extension: the relay loads this file in plain Node, which resolves no import without one
import { SIM_STEPS_PER_SECOND } from '../configs/timing.config.ts';
import type { CommandData } from '../managers/game-state/command-data';

/**
 * Lockstep for coop (docs/COOP_PLAN.md, C0): every client runs the whole
 * simulation, only commands travel. A command a player gives does not act
 * where it was given; it goes to the relay, which puts it into the next open
 * tick, and acts on every client at the same sub-step boundary, in the order
 * the relay gave it.
 *
 * A tick is TICK_SUB_STEPS sub-steps. The commands of tick T act at the
 * boundary after sub-step T * TICK_SUB_STEPS (tick 0 before the first step).
 * A client may run a sub-step only once the relay has closed the tick whose
 * boundary lies before it: that is the barrier, and it is what keeps a fast
 * client from running past a command it has not heard of yet.
 */

/** Net ticks the relay closes per second at speed 1 */
const TICKS_PER_SECOND = 30;

/**
 * Sub-steps per net tick, from the simulation's rate
 * (SIM_STEPS_PER_SECOND): as many as make a tick of about 33 ms, one at 30
 * sub-steps a second, two at 60. A tick was twice as long until 2026-09-25:
 * a shorter one shortens the wait for a command to come back (PLAYTEST T28,
 * TODO E29).
 */
export const TICK_SUB_STEPS = Math.max(1, Math.round(SIM_STEPS_PER_SECOND / TICKS_PER_SECOND));

/** A command as the relay stamped it. */
export interface StampedCommand {
  /** The tick it acts at */
  readonly tick: number;
  /** The relay's running number; the order commands of one tick act in */
  readonly seq: number;
  /** Who gave it */
  readonly playerId: string;
  /** The event as plain data (toPlainData), `type` included */
  readonly command: CommandData;
}

/**
 * The client's end of the relay, whatever carries it (a WebSocket, the
 * in-process relay of the specs).
 */
export interface LockstepLink {
  /** The player at this client */
  readonly playerId: string;
  /** Hand a command to the relay; it acts when its tick comes back. */
  send(command: CommandData): void;
  /** The last tick the relay closed and this client has received; -1 before the first. */
  confirmedTick(): number;
  /** The commands of a received tick in the order they act; empty for a tick without any. */
  commandsAt(tick: number): readonly StampedCommand[];
  /** The tick is done here; a link may drop what it kept for it. */
  release(tick: number): void;
  /** The state hash at the boundary of `tick`, before its commands ran; every HASH_EVERY_TICKS ticks (C5). `parts`: per HASH_PARTS entry. */
  reportHash(tick: number, hash: number, parts?: readonly number[]): void;
  /**
   * A pass of the simulation's loop ran `steps` sub-steps; `blocked` when
   * the tick barrier held one that was due; `behind` ticks closed and not
   * yet run. Only passes that ran a sub-step or were held: the loop sleeps
   * until a sub-step is due, a pass that an input woke for nothing does not
   * count. For the smoothness report (coop/lockstep-stats.ts); a link may
   * ignore it.
   */
  noteFrame?(steps: number, blocked: boolean, behind: number): void;
  /**
   * Call `listener` whenever a tick came in (confirmedTick moved), null to
   * stop: the ticks go on to the simulation at once instead of with the
   * next frame (docs/SIM_DECOUPLE_PLAN.md). A link may leave it out.
   */
  onTick?(listener: (() => void) | null): void;
  /**
   * `count` commands of this client's player ran now (the input delay of
   * the smoothness report); a link may ignore it.
   */
  commandsRan?(count: number): void;
}

/** The tick whose commands act at sub-step boundary `boundary`, or -1 when none act there. */
export function tickAtBoundary(boundary: number): number {
  return boundary % TICK_SUB_STEPS === 0 ? boundary / TICK_SUB_STEPS : -1;
}

/**
 * The tick that has to be closed before the sub-step after `boundary` may
 * run: the last tick boundary at or before it.
 */
export function tickNeededAfter(boundary: number): number {
  return Math.floor(boundary / TICK_SUB_STEPS);
}
