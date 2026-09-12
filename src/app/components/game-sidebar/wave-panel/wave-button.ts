/** What the wave button shows, derived from the store outside the template. */
export interface WaveButtonView {
  /** "Start Wave N" when idle or locked, "Wave N" while the wave runs */
  label: string;
  /** "{n} left" while a wave of known size runs, otherwise null */
  left: string | null;
  /** Width of the bar under a running wave: share still left, in percent */
  barPercent: number;
}

/**
 * @param wave    number the panel header shows: the upcoming wave when idle,
 *                the running one during a wave
 * @param running whether a wave is running
 * @param total   enemies the running wave brings in total, 0 = not announced
 *                (manual debug waves)
 * @param left    enemies of it not yet killed or through to the HQ
 */
export function waveButtonView(
  wave: number,
  running: boolean,
  total: number,
  left: number,
): WaveButtonView {
  if (!running) {
    return { label: `Start Wave ${wave}`, left: null, barPercent: 0 };
  }
  if (total <= 0) {
    return { label: `Wave ${wave}`, left: null, barPercent: 0 };
  }
  const remaining = Math.min(Math.max(left, 0), total);
  return {
    label: `Wave ${wave}`,
    left: `${remaining} left`,
    barPercent: (remaining / total) * 100,
  };
}
