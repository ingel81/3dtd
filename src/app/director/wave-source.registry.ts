/**
 * Which wave sources exist, and how to build one.
 *
 * The one place that knows every implementation. `WaveSourceId` and this map
 * grow together, so an id that has no implementation cannot be configured
 * (docs/WAVE_SOURCE_PLAN.md, section 7).
 */

import { AdaptiveWaveSource } from './sources/adaptive/adaptive-source';
import { TableWaveSource } from './sources/table/table-source';
import type { WaveSource, WaveSourceId } from './wave-source';

/** A fresh source per run; they hold per-run state. */
export const WAVE_SOURCES: Record<WaveSourceId, () => WaveSource> = {
  adaptive: () => new AdaptiveWaveSource(),
  table: () => new TableWaveSource(),
};

export function createWaveSource(id: WaveSourceId): WaveSource {
  return WAVE_SOURCES[id]();
}
