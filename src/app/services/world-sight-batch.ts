/** A batch of the towers that see anew after the world changed starts this often at most, ms (E291) */
export const WORLD_SIGHT_EVERY_MS = 1000;

/**
 * The ops that weigh on the frame they come in and on the next (a fall's
 * show, a crater's ground written the frame after): a changed world's cube
 * renders in none of those frames (TowerLosRegistry). On a city map a cube
 * of 6 to 13 ms in a fall's frame made it one of 34 to 47 ms.
 */
export const WORLD_BUSY_OPS: ReadonlySet<string> = new Set(['main.structureFell', 'craters.dig']);
/** Frames a busy op holds a changed world's cubes back: its own and the next */
export const WORLD_CALM_FRAMES = 2;

/**
 * When the towers whose world changed render their cubes again
 * (TowerLosRegistry, reason 'world': a crater under the routes, a fall, a
 * ruin's lost wall, a wave event's objects). Under a nuclear strike's
 * fire a crater opens every few frames and asks every tower in reach
 * again; rendering each at once would cost a cube per tower and crater.
 * Instead the requests wait and go as one batch, at most every
 * WORLD_SIGHT_EVERY_MS: the requests waiting when it starts, each the
 * latest of its tower, so one cube per tower answers all the changes
 * since the last batch. A request newer than the batch's start waits for
 * the next.
 *
 * A batch starts only on the ground as it is drawn now: the craters and
 * rubble of the drawn ground are written over a few frames
 * (CustomMapGroundDamage.pending), and a cube rendered before that would
 * not see the crater's wall.
 *
 * Main thread only and only the timing of the renders: the simulation
 * waits for the masks either way and applies them when they come, which
 * the command log keeps (docs/SIM_WORKER.md). `R` is the request, compared
 * by identity.
 */
export class WorldSightBatch<R> {
  /** The requests of the batch under way, null for none */
  private batch: Set<R> | null = null;
  private startedAt = -Infinity;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Whether `request` may render now: it belongs to the batch under way */
  allows(request: R): boolean {
    return this.batch?.has(request) ?? false;
  }

  /** The batch under way, for the debug tools and specs; empty for none */
  get size(): number {
    return this.batch?.size ?? 0;
  }

  /**
   * Once per frame, before the renders: `waiting` are the world requests
   * that wait now and came before this frame, `groundDrawn` whether the
   * drawn ground holds every stamp. A batch under way loses what no longer
   * waits (answered, replaced by a newer request, sold) and ends when none
   * is left; with none under way the next starts once its time came.
   */
  tick(waiting: readonly R[], groundDrawn: boolean): void {
    if (this.batch) {
      const still = new Set(waiting);
      for (const r of this.batch) if (!still.has(r)) this.batch.delete(r);
      if (this.batch.size > 0) return;
      this.batch = null;
    }
    if (!waiting.length || !groundDrawn) return;
    const now = this.now();
    if (now - this.startedAt < WORLD_SIGHT_EVERY_MS) return;
    this.batch = new Set(waiting);
    this.startedAt = now;
  }

  /** A new run or location: nothing under way, the next batch may start at once */
  reset(): void {
    this.batch = null;
    this.startedAt = -Infinity;
  }
}
