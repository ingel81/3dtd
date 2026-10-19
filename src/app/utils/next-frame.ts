/**
 * Waiting for the next frame on the page: for work spread over frames (the
 * corridor's measurement, a map's objects built asset by asset) and for a
 * step that must follow a paint.
 */

/** Where a wait for the next frame gives up on rAF: it stops in a hidden tab, the timeouts keep counting. */
const FRAME_FALLBACK_MS = 250;

/** Resolves on the next animation frame, at the latest after FRAME_FALLBACK_MS. */
export function nextFrameOrTimeout(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cancelAnimationFrame(frame);
      resolve();
    }, FRAME_FALLBACK_MS);
    const frame = requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Resolves once the browser painted the frame after the call: the next
 * animation frame (as nextFrameOrTimeout), then a task after it, so what
 * follows runs after the paint, not before it in the frame's own task.
 */
export function afterNextPaint(): Promise<void> {
  return nextFrameOrTimeout().then(() => new Promise((resolve) => setTimeout(resolve)));
}
