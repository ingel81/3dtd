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
}

/**
 * @param wave    the upcoming wave when idle, the running one during a wave
 * @param running whether a wave is running
 * @param total   enemies the running wave brings in total, 0 = not announced
 *                (manual debug waves)
 * @param left    enemies of it not yet killed or through to the HQ
 * @param countdownSeconds seconds until the auto-start, null when it is off
 * @param countdownTotal   full length of that countdown in seconds
 */
export function waveButtonView(
  wave: number,
  running: boolean,
  total: number,
  left: number,
  countdownSeconds: number | null = null,
  countdownTotal = 0,
): WaveButtonView {
  const label = `Wave ${wave}`;
  if (!running) {
    const start = `Start wave ${wave}`;
    if (countdownSeconds === null || countdownTotal <= 0) {
      return { label, ariaLabel: start, left: null, barPercent: 0, countdown: null };
    }
    const seconds = Math.min(Math.max(countdownSeconds, 0), countdownTotal);
    return {
      label,
      ariaLabel: `${start} now, starts by itself in ${seconds}s`,
      left: null,
      barPercent: (seconds / countdownTotal) * 100,
      countdown: `${seconds}s`,
    };
  }
  if (total <= 0) {
    return { label, ariaLabel: null, left: null, barPercent: 0, countdown: null };
  }
  const remaining = Math.min(Math.max(left, 0), total);
  return {
    label,
    ariaLabel: null,
    left: `${remaining} left`,
    barPercent: (remaining / total) * 100,
    countdown: null,
  };
}
