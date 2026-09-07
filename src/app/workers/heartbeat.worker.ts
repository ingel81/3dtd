/// <reference lib="webworker" />

/**
 * Heartbeat Worker — keeps the game loop ticking in a backgrounded tab.
 *
 * Chrome freezes `requestAnimationFrame` entirely while a tab is hidden. The
 * render loop is driven by rAF, so a training tab that loses visibility does
 * not slow down — it stops. Measured directly: `document.hidden === true`
 * gives 0 rAF callbacks in 2 seconds, and four training clients sat in the
 * setup phase indefinitely while still pushing healthy status to the
 * dashboard once per second (that push runs on setInterval, which does keep
 * running, so from the outside everything looked fine).
 *
 * Timers inside a dedicated worker are not tied to the frame clock, so this
 * keeps delivering ticks with the tab hidden. Chrome does apply intensive
 * throttling to hidden pages after ~5 minutes, which a page playing audio is
 * exempt from — see `startTrainingKeepAlive` in the engine.
 *
 * PROTOCOL:
 *   Main → Worker:  { type: 'start', intervalMs: number }
 *                   { type: 'stop' }
 *   Worker → Main:  { type: 'tick' }
 */

let timer: ReturnType<typeof setInterval> | null = null;

addEventListener('message', ({ data }: MessageEvent) => {
  if (!data || typeof data !== 'object') return;

  if (data.type === 'start') {
    if (timer !== null) clearInterval(timer);
    const intervalMs = Math.max(1, Number(data.intervalMs) || 16);
    timer = setInterval(() => postMessage({ type: 'tick' }), intervalMs);
    return;
  }

  if (data.type === 'stop' && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
});
