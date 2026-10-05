/**
 * Wall-clock budgets of the specs. A full `npm test` runs every spec file in
 * parallel workers next to whatever else the machine does: a GC pause or a
 * busy core put a frame of the ooze death at 51.9 ms against its 50, with no
 * change to the code. The budgets keep their numbers for `npm run test:perf`
 * (vitest --mode perf, alone on a quiet machine); the normal run holds them
 * at CATASTROPHE_FACTOR times, which still trips an accidental O(n^2) or a
 * blocking call, not the scheduler.
 */

/** How much looser a budget is outside `npm run test:perf` */
const CATASTROPHE_FACTOR = 10;

const mode = (import.meta as { env?: Record<string, string> }).env?.['MODE'];

/** The run holds wall-clock budgets as written (npm run test:perf) */
export const STRICT_PERF = mode === 'perf';

/** `ms` under `npm run test:perf`, CATASTROPHE_FACTOR times it in the normal run */
export function perfBudget(ms: number): number {
  return STRICT_PERF ? ms : ms * CATASTROPHE_FACTOR;
}

/** Median wall time of `runs` calls of `work`, ms: one slow call (a GC pause) does not move it */
export function medianMs(work: () => void, runs: number): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    work();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}
