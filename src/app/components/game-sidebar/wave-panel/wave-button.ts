/** What the wave button shows, derived from the store outside the template. */
export interface WaveButtonView {
  /** "Start Wave N" when idle or locked, "Wave N" while the wave runs */
  label: string;
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
 * @param wave    number the panel header shows: the upcoming wave when idle,
 *                the running one during a wave
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
  if (!running) {
    if (countdownSeconds === null || countdownTotal <= 0) {
      return { label: `Start Wave ${wave}`, left: null, barPercent: 0, countdown: null };
    }
    const seconds = Math.min(Math.max(countdownSeconds, 0), countdownTotal);
    return {
      label: `Start Wave ${wave}`,
      left: null,
      barPercent: (seconds / countdownTotal) * 100,
      countdown: `${seconds}s`,
    };
  }
  if (total <= 0) {
    return { label: `Wave ${wave}`, left: null, barPercent: 0, countdown: null };
  }
  const remaining = Math.min(Math.max(left, 0), total);
  return {
    label: `Wave ${wave}`,
    left: `${remaining} left`,
    barPercent: (remaining / total) * 100,
    countdown: null,
  };
}
