import type { WebGLRenderer } from 'three';

/** How long a released context waits for the next view at most, ms (a page that opens none, the menu) */
const LONGEST_WAIT_MS = 20_000;
/** The idle callback's latest, ms */
const IDLE_TIMEOUT_MS = 2_000;

const waiting = new Set<Pick<WebGLRenderer, 'forceContextLoss'>>();
let fallback: ReturnType<typeof setTimeout> | null = null;

/**
 * Gives a disposed renderer's WebGL context back to the browser once the
 * view that replaces it stands (settleContexts), at the page's next idle
 * moment. Browsers keep only a few contexts alive, so a renderer that goes
 * loses its own (forceContextLoss) instead of waiting for its canvas to be
 * collected. Lost at once, in the switch between the editor and a test run,
 * `loseContext` blocked the main thread 0.9 s on the way out and 2.3 s on
 * the way back, while the GPU process built the new context's programs
 * (docs/CUSTOM_WORLD_PERF_VISUAL_PLAN.md, V1). Lost later it does not meet
 * that work. Without a new view (back to the menu) it goes after
 * LONGEST_WAIT_MS.
 */
export function releaseContext(renderer: Pick<WebGLRenderer, 'forceContextLoss'>): void {
  waiting.add(renderer);
  fallback ??= setTimeout(settleContexts, LONGEST_WAIT_MS);
}

/**
 * The new view stands (the game's `load:ready`, the editor's first frames
 * with its programs built): the contexts released before go when the page
 * next idles
 */
export function settleContexts(): void {
  if (fallback) {
    clearTimeout(fallback);
    fallback = null;
  }
  if (waiting.size === 0) return;
  const lose = [...waiting];
  waiting.clear();
  const run = (): void => {
    for (const renderer of lose) {
      try {
        renderer.forceContextLoss();
      } catch (err) {
        console.warn('[Context] could not give a context back', err);
      }
    }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(run, 0);
}
