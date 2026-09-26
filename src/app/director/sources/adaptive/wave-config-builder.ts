/**
 * Turns a director's five numbers into a shippable wave.
 *
 * Everything here is shared between the model and the rule director: the
 * template lookup, range interpolation, the DPS ramp, the endgame
 * multiplier, the fairness cap and the duration cap. Only the choice of
 * template and factors differs between them, which is what makes an A/B
 * between the two honest — and what made it possible to measure that the
 * trained model was indistinguishable from uniform random sampling.
 */

import { GameStateSnapshot } from '../../models/game-state-snapshot';
import { WaveConfig } from '../../models/wave-config';
import { explainWaveDecision } from './decision-explainer';
import { MAX_WAVE_DURATION_MS, MIN_SPAWN_DELAY_MS, getTemplate, type CandidateReason } from '../../templates';
import { DPS_RAMP_FLOOR, DPS_RAMP_HP_MULT, dpsScaledCountMax, laneHp, lerpRange, survivableCount } from './wave-sizing';
import type { DirectorDecision } from './director-rules';
import { directorParams } from '../../director-params';
import type { PressureStatus } from './pressure-controller';
import { targetPressure } from './pressure-controller';
import {
  ENEMY_TYPES, lineageHp, lineageLeakDamage, splitBodyCount, type EnemyTypeId,
} from '../../../configs/enemy-types.config';
import { campaignIntensity, campaignMinSpawnDelay, endgameHpMultiplier, enemyBaseDamageForWave } from '../../../configs/campaign.config';

/** What the wave sizing reads from the fairness gate. */
export interface PressureReading {
  /** Closed-loop correction on the kill estimate. */
  readonly pressureMultiplier: number;
  /** Shown in the decision explanation. */
  readonly status: PressureStatus;
}

/**
 * The wave `decision` describes, for the defense in `state`.
 *
 * `templateIdx` of the result is the template that actually ships: an index
 * the template table does not know falls back to slot 0.
 *
 * `wave` is the wave being planned, defaulting to `state.waveNumber + 1`. It
 * is a parameter because a source may plan at the end of the previous wave,
 * where the snapshot's counter is the wave that just finished
 * (docs/WAVE_SOURCE_PLAN.md, section 3).
 */
export function buildWaveConfig(
  decision: DirectorDecision,
  state: GameStateSnapshot,
  candidateReason: CandidateReason,
  pressure: PressureReading,
  wave = state.waveNumber + 1,
): WaveConfig & { templateIdx: number } {
  const upcomingWave = wave;
  // Derselbe Sollwert, auf den der Regler regelt: der Deckel gibt genau so
  // viel Leck frei, wie die Spannungskurve für diese Welle vorsieht.
  const wantPressure = targetPressure(upcomingWave) * directorParams().pressureTargetScale;
  let bestIdx = decision.templateIdx;
  // The director simply decides; there is no distribution to read a
  // confidence out of.
  const bestProb = 1;

  // An invalid index means the mask and the template table disagree, which is
  // a real bug worth shouting about — but not one worth ending the wave over.
  // Throwing here propagates to the facade, which disables the director and
  // drops to manual waves; the Python decoder logs and ships slot 0 instead,
  // and a degraded AI wave beats no AI wave.
  let template = bestIdx >= 0 ? getTemplate(bestIdx) : null;
  if (!template) {
    console.error(`[AI] Director selected invalid template index ${bestIdx} — using slot 0`);
    template = getTemplate(0);
    bestIdx = 0;
    if (!template) {
      throw new Error('[AI] Template table is empty');
    }
  }

  const { count: countFactor, spawn: spawnFactor, hp: hpFactor, variation: variationFactor } = decision.factors;

  // DPS-scaled range caps for difficulty axes (count, hp_mult). Weak defense
  // → narrow effective range; strong defense → full range.
  const totalDPS = Math.max(0, state.defense?.totalDPS ?? 0);
  const dpsFracHp = Math.max(DPS_RAMP_FLOOR, Math.min(1.0, totalDPS / DPS_RAMP_HP_MULT));
  const lerpCapped = (rng: readonly [number, number], factor: number, dpsFrac: number): number => {
    const effMax = rng[0] + (rng[1] - rng[0]) * dpsFrac;
    return rng[0] + (effMax - rng[0]) * factor;
  };

  let spawnDelay = Math.max(MIN_SPAWN_DELAY_MS, Math.round(lerpRange(template.spawnDelayRange, spawnFactor)));
  // Phase 5.16: post-NN endgame multiplier compounds onto the NN's hp_mult so
  // late waves get steeper without retraining (W30 ≈ ×1.5, W50 ≈ ×2.5, cap 4×).
  const endgameHpMult = endgameHpMultiplier(upcomingWave);
  const hpMultFor = (factor: number): number => {
    const base = lerpCapped(template.hpMultRange, factor, dpsFracHp);
    return Math.round(base * endgameHpMult * 1000) / 1000;
  };
  let hpMult = hpMultFor(hpFactor);
  const variation = Math.round(lerpRange(template.variationRange, variationFactor) * 1000) / 1000;

  // Fairness gate: never ship a wave the defense cannot plausibly fight.
  // Applied after the HP multipliers so it judges the enemies as they will
  // actually spawn.
  //
  // The gate INTERPOLATES rather than clamps, mirroring `_decode_action` in
  // the bot server. Clamping after the fact discarded the model's
  // choice on most waves and mapped every count factor above the cap onto an
  // identical wave — a flat region the policy cannot express a preference in,
  // and during training a chosen action paired with a different executed one.
  // Folding the cap into the range keeps chosen == executed; the factor means
  // "how far into what is currently allowed", and the cap is already part of
  // the model's observation.
  //
  // Recomputed against the template that was actually chosen and the factors
  // that were actually emitted — the context's value is a coarse ceiling
  // signal for the model, this is the binding decision.
  const countLo = template.countRange[0];
  const dpsScaledMax = dpsScaledCountMax(template.countRange, totalDPS);
  const countFor = (delay: number): { count: number; cap: number | null; allowed: number | null; capBinds: boolean } => {
    const cap = survivableCount(
      template,
      hpMult,
      delay,
      state.defense?.gateDpsPerArmor,
      state.defense?.killThroughput,
      (id) => ENEMY_TYPES[id as EnemyTypeId]?.armorType ?? 'unarmored',
      (id) => ENEMY_TYPES[id as EnemyTypeId]?.isAirUnit === true,
      (id) => lineageHp(id as EnemyTypeId),
      (id) => ENEMY_TYPES[id as EnemyTypeId]?.baseSpeed ?? 5,
      (id) => splitBodyCount(id as EnemyTypeId),
      (id) => lineageLeakDamage(id as EnemyTypeId),
      laneHp(state),
      enemyBaseDamageForWave(upcomingWave),
      // Closed-loop correction. FAIRNESS_KILL_REALISM was measured on waves
      // 1-10 and understates the defense from wave 11 on; this is the only
      // thing that notices.
      pressure.pressureMultiplier,
      wantPressure,
    );
    // The gate outranks the template minimum. A cap BELOW countRange[0] means
    // the defense cannot handle even the smallest wave the designer wrote,
    // and shipping the minimum anyway makes early runs far more lethal than
    // intended. Collapse the range onto the cap instead.
    //
    // `capSlack` is the headroom over it. At 1 the wave is exactly what the
    // defense can plausibly kill, which is why it is never quite in danger;
    // above 1 the cap only keeps a wave from being unwinnable
    // (director-params.ts, and BALANCING_PLAN.md, Baseline).
    const allowed = cap === null ? null : Math.max(1, Math.round(cap * directorParams().capSlack));
    let lo = countLo;
    let hi = dpsScaledMax;
    if (allowed !== null) {
      lo = Math.min(lo, allowed);
      hi = Math.max(lo, Math.min(hi, allowed));
    }

    // The pressure loop's multiplier acts in one place only: the cap's kill
    // budget (survivableCount). It used to shift the count factor, push the
    // count past the template's top (up to 5000) and raise the HP as well;
    // four handles on one number sent W15 of the Heilbronn run with 490
    // golems a lane and W38 with 490 bears (docs/PRESSURE_ONE_PLACE_PLAN.md).
    // A cap that does not bind leaves the multiplier without effect, and the
    // loop's anti-windup holds it there.
    const capBinds = allowed !== null && allowed < dpsScaledMax;
    const count = Math.max(1, Math.round(lo + (hi - lo) * countFactor));

    return { count, cap, allowed, capBinds };
  };

  let sized = countFor(spawnDelay);

  // Wave-duration cap: compress spawn_delay if total would exceed 3 min.
  const plannedDelay = spawnDelay;
  const durationCapped = sized.count * spawnDelay > MAX_WAVE_DURATION_MS;
  if (durationCapped) {
    spawnDelay = Math.max(MIN_SPAWN_DELAY_MS, Math.floor(MAX_WAVE_DURATION_MS / sized.count));
    // Re-derive against the compressed delay. A slow mega-wave can clear the
    // gate precisely BECAUSE its long spawn window gives the defense time,
    // and the compression then multiplies the spawn rate — so without this
    // the gate is bypassed by exactly the waves it exists to stop. The
    // backend has always done this second pass; the frontend did not.
    sized = countFor(spawnDelay);
  }
  // The campaign's own say in how hard this wave leans (decision D3). Last,
  // so it also lowers a count the survivability cap set: a wave meant as a
  // breather cannot be one while the cap is free to fill it up again.
  const intensity = campaignIntensity(upcomingWave);
  let totalCount = Math.max(1, Math.round(sized.count * intensity));
  // The compression was worked out from the count before the second pass and
  // the campaign's intensity. The wave that ships can be far smaller: W16 of
  // the Heilbronn coop run came as 148 enemies 62 ms apart, a 9 s burst,
  // against a count of thousands that never shipped (TODO E41). Spread what
  // ships over the three minutes again, never slower than planned.
  if (durationCapped) {
    spawnDelay = Math.min(plannedDelay, Math.max(MIN_SPAWN_DELAY_MS, Math.floor(MAX_WAVE_DURATION_MS / totalCount)));
  }

  // The campaign keeps large models apart (TODO E21). The wave is sized as it
  // would be; only then its delay stretches to the campaign's floor. Where
  // that runs past the three minutes, fewer come, each tougher by as much:
  // the wave keeps its health, the models keep their room.
  const delayFloor = campaignMinSpawnDelay(upcomingWave);
  if (delayFloor > spawnDelay) {
    spawnDelay = delayFloor;
    const fits = Math.max(1, Math.floor(MAX_WAVE_DURATION_MS / delayFloor));
    if (totalCount > fits) {
      hpMult = hpMult * (totalCount / fits);
      totalCount = fits;
    }
  }

  // Expand template → enemy groups
  // A template with a leader (a boss wave's boss) sends exactly that many of
  // its first entry; the rest share what is left by their own shares.
  const enemies: { type: string; count: number; healthMultiplier: number }[] = [];
  const leader = template.leaderCount;
  let allocated = 0;
  let shareLeft = 1;
  let countLeft = totalCount;
  if (leader !== undefined && template.enemies.length > 1) {
    const [type, share] = template.enemies[0];
    const count = Math.max(1, Math.min(leader, totalCount - (template.enemies.length - 1)));
    enemies.push({ type, count, healthMultiplier: hpMult });
    shareLeft -= share;
    countLeft -= count;
  }
  const start = enemies.length;
  for (let i = start; i < template.enemies.length; i++) {
    const [type, share] = template.enemies[i];
    const count = i === template.enemies.length - 1
      ? Math.max(1, countLeft - allocated)
      : Math.max(1, Math.round(countLeft * (share / shareLeft)));
    allocated += count;
    enemies.push({ type, count, healthMultiplier: hpMult });
  }

  const shippedCount = enemies.reduce((s, e) => s + e.count, 0);
  return {
    enemies,
    totalCount: shippedCount,
    spawnDelay,
    spawnDelayVariation: variation,
    pattern: template.spawnPattern ?? undefined,
    confidence: bestProb,
    templateIdx: bestIdx,
    templateName: template.name,
    templateStrength: hpMult,
    // Built from the values this function just used, so the debug window
    // explains the wave that ships rather than a re-derivation of it.
    explanation: explainWaveDecision({
      wave: upcomingWave,
      templateName: template.name,
      candidates: candidateReason,
      director: decision.why,
      pressure: pressure.status,
      sizing: {
        countRange: template.countRange,
        dpsScaledMax,
        totalDps: totalDPS,
        cap: sized.cap,
        allowed: sized.allowed,
        capBinds: sized.capBinds,
        countFactor,
        count: shippedCount,
        hpMult,
        endgameHpMult,
        spawnDelay,
        // Compressed only if the wave that ships still needs it
        durationCapped: spawnDelay < plannedDelay,
      },
    }),
  };
}
