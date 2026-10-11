/**
 * Which wave sources exist, and how to build one.
 *
 * The one place that knows every implementation. `WaveSourceId` and this map
 * grow together, so an id that has no implementation cannot be configured
 * (docs/WAVE_SOURCE_PLAN.md, section 7).
 */

import { TableWaveSource } from './sources/table/table-source';
import { BudgetWaveSource } from './sources/budget/budget-source';
import type { WaveSource, WaveSourceId } from './wave-source';
import { DEFAULT_WAVE_SOURCE } from '../configs/director.config';
import type { WaveTable } from './sources/table/wave-table';

/**
 * How one lane's wave of the budget source shrinks with the lanes of the
 * run: 'none' the whole wave on every lane, 'sqrt' 1/sqrt(lanes) of its
 * bodies (docs/CUSTOM_MAP_WORLD.md, "Viele Spuren")
 */
export type LaneScaling = 'none' | 'sqrt';

/** What a world gives its sources: a custom map's own wave list for the table source, its lane scaling for the budget source */
export interface WaveSourceOptions {
  table?: WaveTable;
  laneScaling?: LaneScaling;
}

/** A fresh source per run; they hold per-run state. */
export const WAVE_SOURCES: Record<WaveSourceId, (options: WaveSourceOptions) => WaveSource> = {
  budget: (options) => new BudgetWaveSource(options.laneScaling),
  table: (options) => new TableWaveSource(options.table),
};

/** A source this build has; own keys only, so `constructor` and the like are no source. */
export function isWaveSourceId(id: unknown): id is WaveSourceId {
  return typeof id === 'string' && Object.hasOwn(WAVE_SOURCES, id);
}

/**
 * The source `?waves=<id>` in the address asks for, else the configured
 * default. For bot and test runs that compare sources side by side; in coop
 * every client must be opened with the same one.
 */
export function initialWaveSourceId(search = globalThis.location?.search ?? ''): WaveSourceId {
  const asked = new URLSearchParams(search).get('waves');
  return asked && isWaveSourceId(asked) ? asked : DEFAULT_WAVE_SOURCE;
}

export function createWaveSource(id: WaveSourceId, options: WaveSourceOptions = {}): WaveSource {
  return WAVE_SOURCES[id](options);
}
