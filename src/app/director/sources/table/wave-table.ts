/**
 * The wave list: one row per wave, absolute numbers, edited by hand.
 *
 * This is the whole point of the table source. A wave is a row, changing a
 * wave is changing a number in that row, and the diff of `wave-table.json`
 * shows exactly which waves moved. Nothing reads the defense, so the same
 * wave number is always the same wave, and a run can be compared with the
 * previous one (docs/WAVE_SOURCE_PLAN.md).
 *
 * What comes after the last row is one rule, not a second list: the waves
 * from `cycle.fromWave` on run again, their HP multiplied by `cycle.hpGrowth`
 * once per round.
 */

import rawTable from './wave-table.json';
import { ENEMY_TYPES, type EnemyTypeId } from '../../../configs/enemy-types.config';
import type { SpawnPattern } from '../../spawn-schedule-builder';
import { DetMath } from '../../../utils/det-math';
import type { Messages } from '../../../i18n/messages/en';
import type { Said } from '../../../i18n/said';

/** What is wrong with a wave list, as data: the editor's check words it, the console in English */
export type WaveTableProblem = Said<Messages['check']['waveTable']>;

/** Longest a row may take to spawn (count times spawn delay), 3 minutes. */
export const MAX_WAVE_DURATION_MS = 180_000;
/** Shortest spawn delay a row with more than one enemy may use. */
export const MIN_SPAWN_DELAY_MS = 5;

/** One wave, as the list writes it down. */
export interface WaveTableRow {
  readonly wave: number;
  /** Shown in the wave panel, the debug window and the run log. */
  readonly name: string;
  /** Enemy type to count. Absolute, not a share of some total. */
  readonly enemies: Readonly<Record<string, number>>;
  readonly hpMult: number;
  readonly spawnDelay: number;
  readonly spawnDelayVariation?: number;
  readonly pattern?: SpawnPattern;
  /** A remark of the author, shown with the wave's explanation. */
  readonly note?: string;
}

/** What happens once the list runs out. */
export interface WaveTableCycle {
  /** First wave of the stretch that repeats. */
  readonly fromWave: number;
  /** HP factor per completed round. */
  readonly hpGrowth: number;
}

export interface WaveTable {
  readonly cycle: WaveTableCycle;
  readonly waves: readonly WaveTableRow[];
}

interface RawTable {
  cycle: WaveTableCycle;
  waves: WaveTableRow[];
}

/** The checked-in list. */
export const WAVE_TABLE: WaveTable = (rawTable as unknown as RawTable);

/** The rows by wave number, for O(1) lookup. */
const BY_WAVE = new Map<number, WaveTableRow>(WAVE_TABLE.waves.map((row) => [row.wave, row]));

/** The highest wave the list writes down. */
export const LAST_TABLE_WAVE = WAVE_TABLE.waves.reduce((max, row) => Math.max(max, row.wave), 0);

/** A row and, past the list, how many rounds of the cycle it took to get there. */
export interface TableLookup {
  readonly row: WaveTableRow;
  /** 0 inside the list, 1 on the first repeat, and so on. */
  readonly cycle: number;
  /** `row.hpMult` with the cycle's growth applied. */
  readonly hpMult: number;
}

/**
 * The row that describes `wave`.
 *
 * Inside the list its own row. Past it the cycle: the stretch from
 * `cycle.fromWave` to the last row repeats, and each completed round
 * multiplies the HP by `cycle.hpGrowth`. Returns null only for a wave below
 * the first row, which cannot happen in a run.
 */
export function tableRowForWave(wave: number, table: WaveTable = WAVE_TABLE): TableLookup | null {
  const direct = table === WAVE_TABLE ? BY_WAVE.get(wave) : table.waves.find((row) => row.wave === wave);
  if (direct) return { row: direct, cycle: 0, hpMult: direct.hpMult };

  const last = table.waves.reduce((max, row) => Math.max(max, row.wave), 0);
  if (wave <= last) return null;

  const stretch = table.waves.filter((row) => row.wave >= table.cycle.fromWave);
  if (stretch.length === 0) return null;

  const past = wave - last - 1;                    // 0 = the first wave past the list
  const cycle = Math.floor(past / stretch.length) + 1;
  const row = stretch[past % stretch.length];
  const hpMult = Math.round(row.hpMult * DetMath.pow(table.cycle.hpGrowth, cycle) * 1000) / 1000;
  return { row, cycle, hpMult };
}

/**
 * What is wrong with a table, as sentences. Empty means it is usable.
 *
 * Checked in a spec rather than at startup: a broken list is an authoring
 * mistake, and it should fail the build, not the run.
 */
export function validateWaveTable(table: WaveTable = WAVE_TABLE): WaveTableProblem[] {
  const problems: WaveTableProblem[] = [];
  if (table.waves.length === 0) problems.push({ key: 'empty' });
  if (table.cycle.hpGrowth <= 0) problems.push({ key: 'hpGrowth' });

  const seen = new Set<number>();
  let previous = 0;
  for (const row of table.waves) {
    const wave = row.wave;
    if (seen.has(wave)) problems.push({ key: 'twice', v: { wave } });
    seen.add(wave);
    if (wave <= previous) problems.push({ key: 'order', v: { wave, after: previous } });
    previous = wave;

    const counts = Object.values(row.enemies);
    if (counts.length === 0) problems.push({ key: 'noEnemies', v: { wave } });
    for (const [type, count] of Object.entries(row.enemies)) {
      if (!ENEMY_TYPES[type as EnemyTypeId]) problems.push({ key: 'unknownEnemy', v: { wave, type } });
      if (!Number.isInteger(count) || count < 1) problems.push({ key: 'count', v: { wave, type, count } });
    }
    const total = counts.reduce((sum, count) => sum + count, 0);
    if (row.hpMult <= 0) problems.push({ key: 'hpMult', v: { wave, hpMult: row.hpMult } });
    if (total > 1 && row.spawnDelay < MIN_SPAWN_DELAY_MS) {
      problems.push({ key: 'spawnDelay', v: { wave, delay: row.spawnDelay, min: MIN_SPAWN_DELAY_MS } });
    }
    if (total * row.spawnDelay > MAX_WAVE_DURATION_MS) {
      problems.push({ key: 'tooLong', v: { wave, total, delay: row.spawnDelay, cap: MAX_WAVE_DURATION_MS } });
    }
    if (row.spawnDelayVariation !== undefined && (row.spawnDelayVariation < 0 || row.spawnDelayVariation > 0.5)) {
      problems.push({ key: 'variation', v: { wave, variation: row.spawnDelayVariation } });
    }
  }

  const first = table.waves[0]?.wave;
  if (first !== undefined && first !== 1) problems.push({ key: 'start', v: { first } });
  if (table.cycle.fromWave > previous) problems.push({ key: 'cycleFrom', v: { from: table.cycle.fromWave, last: previous } });
  return problems;
}
