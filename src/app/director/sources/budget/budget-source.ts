/**
 * The budget wave source: the run plan fixes what every wave is, the budget
 * step fills in the HP against the defense, the pressure loop moves the budget
 * by what the waves cost the player. One way for every wave, boss or not
 * (docs/WAVE_RUN_PLAN.md).
 *
 * It commits at the end of the previous wave, so the preview names the wave
 * exactly, and sizes its HP again when it starts (sizeAtStart): against the
 * defense the player built in the break, not the one that stood when the
 * wave before ended. The human run of 2026-10-01 bought 1.3 to 1.4 times the
 * damage between planning and start before W10, W11 and W13 (TODO E95).
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
import type { WaveConfig, WaveEnemyGroup } from '../../models/wave-config';
import type { GameStateSnapshot } from '../../models/game-state-snapshot';
import type { WaveResult } from '../../models/wave-result';
import type { BudgetBreakdown, DecisionExplanation } from '../../wave-explanation';
import type { ArmorType } from '../../../configs/combat/combat.types';
import { ENEMY_TYPES, type EnemyTypeId } from '../../../configs/enemy-types.config';
import { PressureController, targetPressure, wavePressure } from '../../pressure-controller';
import { directorParams } from '../../director-params';
import { RUN_PLAN_RULES, planEnemies, planLeakScale, planMutator, planRowForWave, type RunPlanRow } from './run-plan';
import { bodyParts, sizeWave, type BudgetResult } from './budget';

/**
 * The loop moves the budget between half and one and a half. Decided was half to double (User, 2026-09-28);
 * at double the bots lost nothing on most waves, the loop stood at its stop by W23 and the waves the defense
 * matches worst (ghosts W24, mammoths W25) then cost 60 to 210 HP (bot runs 2026-09-29).
 */
export const BUDGET_REGULATOR_LIMITS = { min: 0.5, max: 1.5 } as const;
/** From the second wave on, two readings: bots lost 40 to 60 HP a wave in W5-W7 while the loop still waited. */
export const BUDGET_REGULATOR_START = { warmupWaves: 1, minSamples: 2 } as const;

export class BudgetWaveSource implements WaveSource {
  readonly id: WaveSourceId = 'budget';
  readonly name = 'Run plan with budget';
  readonly plansAt: WavePlanTiming = 'wave-end';
  readonly rules = RUN_PLAN_RULES;

  private readonly pressure = new PressureController(BUDGET_REGULATOR_LIMITS, BUDGET_REGULATOR_START);
  /** Did the cap cut the last wave? Then opening the loop would not have helped (anti-windup). */
  private lastCapped = false;

  plan(request: WavePlanRequest): PlannedWave {
    return this.size(request.wave, request.state);
  }

  /** The same wave, its HP against the defense at the start; the row fixes the rest. */
  sizeAtStart(planned: PlannedWave, request: WavePlanRequest): PlannedWave {
    if (planned.wave !== request.wave) throw new Error(`[budget] wave ${planned.wave} committed, ${request.wave} started`);
    return this.size(request.wave, request.state);
  }

  private size(wave: number, state: GameStateSnapshot): PlannedWave {
    const row = planRowForWave(wave);
    if (!row) throw new Error(`[budget] no plan row for wave ${wave}`);

    const lanes = Math.max(1, state.lanes ?? 1);
    const regulator = this.pressure.pressureMultiplier;
    // The same set point the loop aims at (pressureTargetScale included)
    const target = targetPressure(wave) * directorParams().pressureTargetScale;
    const planned = planEnemies(wave);
    const mutator = planMutator(wave);
    const sized = sizeWave({
      wave,
      enemies: planned,
      // A mutator that makes its enemies harder to kill takes it out of the HP (WAVE_MUTATORS)
      strength: row.strength * (mutator?.budget ?? 1),
      spawnDelayMs: row.spawnDelay,
      regulator,
      targetPressure: target,
      leakScale: planLeakScale(wave),
      defense: {
        dps: state.defense?.effectiveDPSPerArmor,
        damageMetres: state.defense?.damageMetres,
        metresUnderFire: state.defense?.metresUnderFire,
        hpRemaining: (state.player?.lives ?? 100) / lanes,
      },
    });
    // Anti-windup: opening the loop helps nothing when the cap or every type's own limit holds the wave
    const hurt = Object.keys(sized.hpMult).filter((type) => !sized.unhurt.includes(type));
    this.lastCapped = sized.capped || (hurt.length > 0 && hurt.every((type) => sized.clamped.includes(type)));

    const enemies: WaveEnemyGroup[] = Object.entries(planned)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({
        type,
        count,
        healthMultiplier: sized.hpMult[type] ?? 1,
        ...(mutator?.speed ? { speedMultiplier: mutator.speed } : {}),
      }));
    const totalCount = enemies.reduce((sum, group) => sum + group.count, 0);
    const shared = sharedMult(sized);
    const explanation: DecisionExplanation = {
      ...explain(wave, row, planned, sized, regulator, totalCount, shared),
      budget: breakdown(row, planned, sized, regulator, target),
    };

    const config: WaveConfig = {
      enemies,
      totalCount,
      spawnDelay: row.spawnDelay,
      ...(row.spawnDelayVariation !== undefined ? { spawnDelayVariation: row.spawnDelayVariation } : {}),
      ...(row.pattern ? { pattern: row.pattern } : {}),
      templateName: row.name,
      templateStrength: shared,
      explanation,
    };

    return {
      wave,
      config,
      explanation,
      log: {
        pressureMultiplier: regulator,
        targetPressure: target,
        diagnostics: {
          planWave: row.wave,
          budget: round1(sized.budget),
          delivered: round1(sized.delivered),
          window: round1(sized.window),
          capped: sized.capped,
          clamped: sized.clamped.join(' ') || null,
          unhurt: sized.unhurt.join(' ') || null,
          mutator: mutator?.id ?? null,
        },
      },
    };
  }

  /** Every wave's enemies are known in advance; their HP is set when the wave starts. */
  peek(request: WavePeekRequest): WavePeekFacts[] {
    const facts: WavePeekFacts[] = [];
    for (let wave = request.fromWave; wave < request.fromWave + request.count; wave++) {
      const row = planRowForWave(wave);
      if (row) facts.push(factsOf(wave, row, planEnemies(wave)));
    }
    return facts;
  }

  onWaveResult(result: WaveResult): void {
    // A wave the HQ's health was cheated in measures the cheat, not the defense
    if (result.outcome.cheated) return;
    const pressure = wavePressure(
      result.outcome.damageToPlayer ?? 0,
      result.outcome.healthAtWaveStart ?? 0,
      result.outcome.enemiesSpawned ?? 0,
    );
    this.pressure.recordWave(pressure, result.waveNumber, !this.lastCapped);
  }

  reset(): void {
    this.pressure.reset();
    this.lastCapped = false;
  }
}

/** The numbers of a sized wave for the wave debug window */
function breakdown(
  row: RunPlanRow, planned: Readonly<Record<string, number>>, sized: BudgetResult, regulator: number, target: number,
): BudgetBreakdown {
  return {
    row: row.wave,
    strength: row.strength,
    regulator: round2(regulator),
    regulatorMin: BUDGET_REGULATOR_LIMITS.min,
    regulatorMax: BUDGET_REGULATOR_LIMITS.max,
    targetPressure: round3(target),
    budget: round1(sized.budget),
    window: round1(sized.window),
    delivered: round1(sized.delivered),
    capped: sized.capped,
    types: Object.entries(planned)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => {
        const cfg = ENEMY_TYPES[type as EnemyTypeId];
        const unhurt = sized.unhurt.includes(type);
        return {
          type,
          name: cfg?.name ?? type,
          count,
          armor: cfg?.armorType ?? 'unarmored',
          hpMult: sized.hpMult[type] ?? 1,
          limit: unhurt ? null : sized.limits[type] ?? null,
          state: unhurt ? 'unhurt' as const : sized.clamped.includes(type) ? 'limit' as const : 'shared' as const,
        };
      }),
  };
}

/** The factor most of the wave got: the unclamped one, else the largest. */
function sharedMult(sized: BudgetResult): number {
  const free = Object.entries(sized.hpMult).filter(([type]) => !sized.clamped.includes(type) && !sized.unhurt.includes(type));
  const values = (free.length ? free : Object.entries(sized.hpMult)).map(([, m]) => m);
  return values.length ? Math.max(...values) : 1;
}

function explain(
  wave: number, row: RunPlanRow, planned: Readonly<Record<string, number>>, sized: BudgetResult,
  regulator: number, totalCount: number, shared: number,
): DecisionExplanation {
  const reasons = [
    `Run plan, row ${row.wave}: ${Object.entries(planned).map(([type, count]) => `${count}× ${type}`).join(', ')}, every ${row.spawnDelay} ms.`,
    `Budget ${round1(sized.budget)} s of defense damage (curve × strength ${row.strength} × loop ×${round2(regulator)}).`,
  ];
  if (sized.capped) reasons.push(`The defense has about ${round1(sized.window)} s while the wave is on the route: ${round1(sized.delivered)} s of it are sent, leaks included.`);
  if (sized.clamped.length) reasons.push(`At their limit (time under fire): ${sized.clamped.map((type) => `${type} HP ×${sized.hpMult[type]}`).join(', ')}.`);
  if (sized.unhurt.length) reasons.push(`The defense cannot hurt ${sized.unhurt.join(', ')}: HP × the row's strength ${row.strength}.`);
  const mutator = planMutator(wave);
  if (mutator) reasons.push(`Blood moon: ${mutator.name}. ${mutator.description}`);
  if (row.note) reasons.push(row.note);
  return {
    summary: `Wave ${wave}: ${row.name} · ${totalCount} enemies · HP ×${shared}`,
    reasons,
  };
}

function factsOf(wave: number, row: RunPlanRow, planned: Readonly<Record<string, number>>): WavePeekFacts {
  const entries = Object.entries(planned).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const hpByArmor = new Map<ArmorType, number>();
  let air = false;
  for (const [type, count] of entries) {
    const cfg = ENEMY_TYPES[type as EnemyTypeId];
    if (!cfg) continue;
    for (const part of bodyParts(type)) {
      hpByArmor.set(part.armor, (hpByArmor.get(part.armor) ?? 0) + count * part.bodies * part.hp);
    }
    if (cfg.isAirUnit) air = true;
  }
  return {
    wave,
    name: row.name,
    known: true,
    boss: row.boss === true,
    air,
    armors: [...hpByArmor.keys()],
    hpByArmor: [...hpByArmor],
    count: total,
    enemies: entries.map(([type, count]) => [type, count / total] as const),
    note: 'HP set against the defense when the wave starts',
    description: row.note ?? `${entries.map(([type, count]) => `${count}× ${type}`).join(', ')}, every ${row.spawnDelay} ms.`,
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
