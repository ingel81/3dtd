import type { SpawnPreview } from '../../services/world/map-placement.service';
import { laneCss } from '../../coop/lane-color';

/** One lane in the lane length panel */
export interface LaneLengthRow {
  label: string;
  color: string;
  /** Route to the HQ, m; null where the spawn being placed may not stand */
  meters: number | null;
  /** meters over the longest row's, 0 to 1 */
  share: number;
  /** The lane being placed */
  edited: boolean;
}

/**
 * The rows of the lane length panel (docs/LANES_PLAN.md, L6): the lanes as
 * they stand, the one being placed in its place (moved), after them (added)
 * or alone (one in place of all), and how much longer or shorter it is than
 * the others on average, in percent; null without others or without a route.
 * Framework-free and pure.
 */
export function laneLengthRows(
  /** The route lengths of the spawns as they stand, spawn order, m */
  lanes: readonly number[],
  preview: SpawnPreview,
): { rows: LaneLengthRow[]; deltaPercent: number | null } {
  const row = (index: number, meters: number | null, edited: boolean, label = `Spawn ${index + 1}`) =>
    ({ label, color: laneCss(index), meters, share: 0, edited });
  const { target } = preview;
  const rows = target.kind === 'all'
    ? [row(0, preview.meters, true)]
    : lanes.map((m, i) => (target.kind === 'move' && target.index === i ? row(i, preview.meters, true) : row(i, m, false)));
  if (target.kind === 'add') rows.push(row(lanes.length, preview.meters, true, 'New'));

  const longest = Math.max(0, ...rows.map((r) => r.meters ?? 0));
  for (const r of rows) r.share = longest > 0 && r.meters !== null ? r.meters / longest : 0;

  const others = rows.filter((r) => !r.edited && r.meters !== null).map((r) => r.meters!);
  const average = others.length > 0 ? others.reduce((a, b) => a + b, 0) / others.length : 0;
  const deltaPercent = preview.meters === null || average <= 0 ? null : Math.round(((preview.meters - average) / average) * 100);
  return { rows, deltaPercent };
}
