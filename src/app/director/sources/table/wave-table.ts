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
import { MAX_WAVE_DURATION_MS, MIN_SPAWN_DELAY_MS } from '../../templates';
import { ENEMY_TYPES, type EnemyTypeId } from '../../../configs/enemy-types.config';
import type { SpawnPattern } from '../../spawn-schedule-builder';

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
  const hpMult = Math.round(row.hpMult * table.cycle.hpGrowth ** cycle * 1000) / 1000;
  return { row, cycle, hpMult };
}

/**
 * What is wrong with a table, as sentences. Empty means it is usable.
 *
 * Checked in a spec rather than at startup: a broken list is an authoring
 * mistake, and it should fail the build, not the run.
 */
export function validateWaveTable(table: WaveTable = WAVE_TABLE): string[] {
  const problems: string[] = [];
  if (table.waves.length === 0) problems.push('the list is empty');
  if (table.cycle.hpGrowth <= 0) problems.push('cycle.hpGrowth must be positive');

  const seen = new Set<number>();
  let previous = 0;
  for (const row of table.waves) {
    const at = `wave ${row.wave}`;
    if (seen.has(row.wave)) problems.push(`${at}: listed twice`);
    seen.add(row.wave);
    if (row.wave <= previous) problems.push(`${at}: out of order, comes after ${previous}`);
    previous = row.wave;

    const counts = Object.values(row.enemies);
    if (counts.length === 0) problems.push(`${at}: no enemies`);
    for (const [type, count] of Object.entries(row.enemies)) {
      if (!ENEMY_TYPES[type as EnemyTypeId]) problems.push(`${at}: unknown enemy type "${type}"`);
      if (!Number.isInteger(count) || count < 1) problems.push(`${at}: "${type}" has count ${count}`);
    }
    const total = counts.reduce((sum, count) => sum + count, 0);
    if (row.hpMult <= 0) problems.push(`${at}: hpMult ${row.hpMult}`);
    if (total > 1 && row.spawnDelay < MIN_SPAWN_DELAY_MS) {
      problems.push(`${at}: spawnDelay ${row.spawnDelay} is below ${MIN_SPAWN_DELAY_MS} ms`);
    }
    if (total * row.spawnDelay > MAX_WAVE_DURATION_MS) {
      problems.push(`${at}: ${total} enemies every ${row.spawnDelay} ms run past the ${MAX_WAVE_DURATION_MS} ms cap`);
    }
    if (row.spawnDelayVariation !== undefined && (row.spawnDelayVariation < 0 || row.spawnDelayVariation > 0.5)) {
      problems.push(`${at}: spawnDelayVariation ${row.spawnDelayVariation} is outside 0 to 0.5`);
    }
  }

  const first = table.waves[0]?.wave;
  if (first !== undefined && first !== 1) problems.push(`the list starts at wave ${first}, not 1`);
  if (table.cycle.fromWave > previous) {
    problems.push(`cycle.fromWave ${table.cycle.fromWave} is past the last wave ${previous}`);
  }
  return problems;
}
