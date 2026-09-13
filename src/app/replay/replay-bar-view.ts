import type { ReplayRecording } from './replay-recording';

/** A tick on the replay's progress bar where the player gave a command */
export interface ReplayMarker {
  /** Place on the bar, 0-100 */
  percent: number;
}

/** Ticks closer than this share of the bar (percent) are drawn as one */
const MARKER_MIN_GAP_PERCENT = 0.4;

/**
 * The commands of the recording as ticks on the progress bar: build, sell,
 * upgrade, targeting, abilities, whatever command:* the wave saw. Ticks
 * that would touch merge, so a burst of clicks stays one mark.
 */
export function commandMarkers(recording: ReplayRecording): ReplayMarker[] {
  const duration = recording.durationMs;
  if (duration <= 0) return [];
  const markers: ReplayMarker[] = [];
  let last = -Infinity;
  for (const { ms } of recording.commands) {
    const percent = Math.max(0, Math.min(100, (ms / duration) * 100));
    if (percent - last < MARKER_MIN_GAP_PERCENT) continue;
    markers.push({ percent });
    last = percent;
  }
  return markers;
}

/** Game time as m:ss, rounded down to the second. */
export function formatReplayTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}

/** Speed as the bar writes it: 0.25x, 1x, 4x. */
export function formatReplaySpeed(speed: number): string {
  return `${speed}x`;
}
