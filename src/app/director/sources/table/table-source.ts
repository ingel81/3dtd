/**
 * The table wave source: every wave is a row in `wave-table.json`.
 *
 * It reads nothing about the defense and keeps no state across waves, so the
 * same wave number is always the same wave. That is the whole point: a wave
 * that is too hard is one number in one row, and a run measures the list
 * rather than a controller measuring itself (docs/WAVE_SOURCE_PLAN.md).
 *
 * It commits at the end of the previous wave, so the preview names exactly
 * what will come. Nothing changes between committing and starting, since it
 * does not look at the game.
 */

import type {
  PlannedWave,
  WavePeekFacts,
  WavePeekRequest,
  WavePlanRequest,
  WavePlanTiming,
  WaveSource,
  WaveSourceId,
} from '../../wave-source';
import type { DecisionExplanation } from '../../wave-explanation';
import type { WaveConfig, WaveEnemyGroup } from '../../models/wave-config';
import { ENEMY_TYPES, type EnemyTypeId } from '../../../configs/enemy-types.config';
import type { ArmorType } from '../../../configs/combat/combat.types';
import { LAST_TABLE_WAVE, tableRowForWave, type TableLookup } from './wave-table';

export class TableWaveSource implements WaveSource {
  readonly id: WaveSourceId = 'table';
  readonly name = 'Wave table';
  /** Nothing to read at wave start, so the wave can be named a wave early. */
  readonly plansAt: WavePlanTiming = 'wave-end';

  plan(request: WavePlanRequest): PlannedWave {
    const { wave } = request;
    const lookup = tableRowForWave(wave);
    if (!lookup) {
      // Only reachable for a wave below the first row, which no run asks for.
      throw new Error(`[table] no row for wave ${wave}`);
    }

    const enemies: WaveEnemyGroup[] = Object.entries(lookup.row.enemies).map(([type, count]) => ({
      type,
      count,
      healthMultiplier: lookup.hpMult,
    }));
    const totalCount = enemies.reduce((sum, group) => sum + group.count, 0);

    const config: WaveConfig = {
      enemies,
      totalCount,
      spawnDelay: lookup.row.spawnDelay,
      ...(lookup.row.spawnDelayVariation !== undefined
        ? { spawnDelayVariation: lookup.row.spawnDelayVariation }
        : {}),
      ...(lookup.row.pattern ? { pattern: lookup.row.pattern } : {}),
      templateName: lookup.row.name,
      templateStrength: lookup.hpMult,
      explanation: explain(wave, lookup, totalCount),
    };

    return {
      wave,
      config,
      explanation: config.explanation ?? null,
      log: {
        // No cap and no loop: the row is the decision.
        survivableCount: null,
        diagnostics: {
          tableWave: lookup.row.wave,
          tableCycle: lookup.cycle,
          tableHpMult: lookup.hpMult,
        },
      },
    };
  }

  /** Every wave is known, because every wave is written down. */
  peek(request: WavePeekRequest): WavePeekFacts[] {
    const facts: WavePeekFacts[] = [];
    for (let wave = request.fromWave; wave < request.fromWave + request.count; wave++) {
      const lookup = tableRowForWave(wave);
      facts.push(lookup ? factsOf(wave, lookup) : unknownFacts(wave));
    }
    return facts;
  }

  /** A list learns nothing from a finished wave. */
  onWaveResult(): void {
    // Deliberately empty: that a wave went badly is an argument for editing
    // the row, not for the game quietly sending something else next time.
  }

  /** No state per run, so nothing to clear. */
  reset(): void {
    // Deliberately empty.
  }
}

function explain(wave: number, lookup: TableLookup, totalCount: number): DecisionExplanation {
  const reasons = [
    lookup.cycle === 0
      ? `Wave list, row ${lookup.row.wave}: ${describe(lookup.row.enemies)}.`
      : `Past the list (last row W${LAST_TABLE_WAVE}): row ${lookup.row.wave} runs again, round ${lookup.cycle}.`,
    `HP ×${lookup.hpMult}${lookup.cycle > 0 ? ` (row ×${lookup.row.hpMult}, grown ${lookup.cycle} round(s))` : ''}.`,
    `Spawn every ${lookup.row.spawnDelay} ms, so the wave takes about `
      + `${Math.round((totalCount * lookup.row.spawnDelay) / 1000)} s.`,
    'Written down, not sized against the defense: the same wave number is always the same wave.',
  ];
  if (lookup.row.note) reasons.push(lookup.row.note);

  return {
    summary: `Wave ${wave}: ${lookup.row.name} · ${totalCount} enemies · HP ×${lookup.hpMult}`,
    reasons,
    // No sizing: nothing here ramped, capped or corrected anything.
  };
}

/** "23 zombies, 3 zombie-v2", for the first line of the explanation. */
function describe(enemies: Readonly<Record<string, number>>): string {
  return Object.entries(enemies).map(([type, count]) => `${count}× ${type}`).join(', ');
}

function factsOf(wave: number, lookup: TableLookup): WavePeekFacts {
  const entries = Object.entries(lookup.row.enemies);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const hpByArmor = new Map<ArmorType, number>();
  let air = false;
  let boss = false;
  for (const [type, count] of entries) {
    const cfg = ENEMY_TYPES[type as EnemyTypeId];
    if (!cfg) continue;
    hpByArmor.set(cfg.armorType, (hpByArmor.get(cfg.armorType) ?? 0) + count * cfg.baseHp * lookup.hpMult);
    if (cfg.isAirUnit) air = true;
    if (cfg.isBoss) boss = true;
  }

  return {
    wave,
    name: lookup.row.name,
    known: true,
    boss,
    air,
    armors: [...hpByArmor.keys()],
    hpByArmor: [...hpByArmor],
    // A written-down wave has one size, so lo, hi and max are the same number.
    count: { lo: total, hi: total, max: total },
    enemies: entries.map(([type, count]) => [type, count / total] as const),
    note: lookup.cycle > 0 ? `row ${lookup.row.wave}, round ${lookup.cycle}` : '',
    description: lookup.row.note
      ?? `${describe(lookup.row.enemies)} at HP ×${lookup.hpMult}, every ${lookup.row.spawnDelay} ms.`,
  };
}

/** Below the first row: cannot happen in a run, but the preview must answer. */
function unknownFacts(wave: number): WavePeekFacts {
  return {
    wave,
    name: 'Not in the list',
    known: false,
    boss: false,
    air: false,
    armors: [],
    hpByArmor: [],
    count: null,
    enemies: [],
    note: 'No row',
    description: 'The wave list has no row for this wave.',
  };
}
