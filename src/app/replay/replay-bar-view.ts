import type { CommandLogEntry } from '../managers/game-state/command-log';
import { LOS_LOG_TYPE } from '../managers/game-state/command-log';

/** A tick on the replay's progress bar where the player gave a command */
export interface ReplayMarker {
  /** Place on the bar, 0-100 */
  percent: number;
}

/** Ticks closer than this share of the bar (percent) are drawn as one */
const MARKER_MIN_GAP_PERCENT = 0.4;

/** Commands that are no decision of the player's and get no tick */
const UNMARKED = new Set<string>([LOS_LOG_TYPE, 'command:tower-aim']);

/**
 * The commands of a wave as ticks on the progress bar: build, sell,
 * upgrade, targeting, abilities, whatever command the wave saw between
 * `startStep` and `endStep`. Ticks that would touch merge, so a burst of
 * clicks stays one mark. The aim of a manned tower and the logged lines of
 * sight get none.
 */
export function commandMarkers(entries: readonly CommandLogEntry[], startStep: number, endStep: number): ReplayMarker[] {
  const length = endStep - startStep;
  if (length <= 0) return [];
  const markers: ReplayMarker[] = [];
  let last = -Infinity;
  for (const { step, command } of entries) {
    if (step < startStep || step >= endStep || UNMARKED.has(command.type)) continue;
    const percent = Math.max(0, Math.min(100, ((step - startStep) / length) * 100));
    if (percent - last < MARKER_MIN_GAP_PERCENT) continue;
    markers.push({ percent });
    last = percent;
  }
  return markers;
}

/** Speed as the bar writes it: 0.25x, 1x, 4x. */
export function formatReplaySpeed(speed: number): string {
  return `${speed}x`;
}
