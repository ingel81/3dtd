/** What the wave button shows, derived from the store outside the template. */
export interface WaveButtonView {
  /** "Wave N": the upcoming wave when idle or locked, the running one during a wave */
  label: string;
  /**
   * Accessible name when the visible text does not say what a press does:
   * "Start wave N" idle, with the countdown while it runs; null during a wave
   */
  ariaLabel: string | null;
  /** "{n} left" while a wave of known size runs, otherwise null */
  left: string | null;
  /**
   * Width of the bar at the bottom, in percent: while a wave runs the share
   * of enemies still left, while the auto-start counts down the time left
   */
  barPercent: number;
  /** "{n}s" while the auto-start counts down to this wave, otherwise null */
  countdown: string | null;
  /** Coop between waves: "{ready}/{players} ready", otherwise null */
  coopReady: string | null;
  /** Coop between waves: this player said ready, the button stays pressed */
  pressed: boolean;
}

/** Coop between waves: the wave starts once every player is ready (docs/COOP_PLAN.md, D15) */
export interface CoopReadyState {
  /** This player is ready */
  ready: boolean;
  /** Players ready, and players still in the game */
  readyCount: number;
  playerCount: number;
  /** The room lets the host start the waves, and this is the host (D38): the button starts it */
  hostStarts: boolean;
}

/**
 * @param wave    the upcoming wave when idle, the running one during a wave
 * @param running whether a wave is running
 * @param total   enemies the running wave brings in total, 0 = not announced
 *                (manual debug waves)
 * @param left    enemies of it not yet killed or through to the HQ
 * @param countdownSeconds seconds until the auto-start, null when it is off
 * @param countdownTotal   full length of that countdown in seconds
 * @param coop  coop readiness; the button then says ready instead of start
 */
export function waveButtonView(
  wave: number,
  running: boolean,
  total: number,
  left: number,
  countdownSeconds: number | null = null,
  countdownTotal = 0,
  coop: CoopReadyState | null = null,
): WaveButtonView {
  const label = `Wave ${wave}`;
  const plain = { coopReady: null, pressed: false };
  if (!running && coop) {
    // "Auto 10 s" counts on every client alike (D44)
    const auto = countdownSeconds !== null ? ` · ${Math.max(countdownSeconds, 0)}s` : '';
    const count = `${coop.readyCount}/${coop.playerCount} ready${auto}`;
    if (coop.hostStarts) {
      return {
        label: `Start wave ${wave}`,
        ariaLabel: `Start wave ${wave}, ${count}`,
        left: null,
        barPercent: coop.playerCount > 0 ? (coop.readyCount / coop.playerCount) * 100 : 0,
        countdown: null,
        coopReady: count,
        pressed: false,
      };
    }
    return {
      label: coop.ready ? `Wave ${wave}: ready` : `Ready for wave ${wave}`,
      ariaLabel: coop.ready ? `Not ready for wave ${wave} after all, ${count}` : `Ready for wave ${wave}, ${count}`,
      left: null,
      barPercent: coop.playerCount > 0 ? (coop.readyCount / coop.playerCount) * 100 : 0,
      countdown: null,
      coopReady: count,
      pressed: coop.ready,
    };
  }
  if (!running) {
    const start = `Start wave ${wave}`;
    if (countdownSeconds === null || countdownTotal <= 0) {
      return { label, ariaLabel: start, left: null, barPercent: 0, countdown: null, ...plain };
    }
    const seconds = Math.min(Math.max(countdownSeconds, 0), countdownTotal);
    return {
      label,
      ariaLabel: `${start} now, starts by itself in ${seconds}s`,
      left: null,
      barPercent: (seconds / countdownTotal) * 100,
      countdown: `${seconds}s`,
      ...plain,
    };
  }
  if (total <= 0) {
    return { label, ariaLabel: null, left: null, barPercent: 0, countdown: null, ...plain };
  }
  const remaining = Math.min(Math.max(left, 0), total);
  return {
    label,
    ariaLabel: null,
    left: `${remaining} left`,
    barPercent: (remaining / total) * 100,
    countdown: null,
    ...plain,
  };
}
