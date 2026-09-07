/**
 * Rule-based wave director.
 *
 * Chooses the template and the four shape factors that the ONNX model used to
 * emit. Everything downstream — the availability mask, range interpolation, the
 * DPS ramp, the endgame multiplier, the fairness cap — is unchanged and shared,
 * so this is a drop-in substitute for the model's five numbers and nothing else.
 *
 * WHY RULES AND NOT THE MODEL
 *
 * Measured across a day of A/B runs with four directors sharing the same bots,
 * curriculum and fairness gate, the trained policy network was three times
 * statistically indistinguishable from uniform random sampling (mean run length
 * 45.6 [42,49] against random's 44.7 [41,48]), while two trivial heuristics
 * produced measurably more tension (near-miss 0.067-0.069 against 0.045). The
 * network had never learned: after thousands of episodes its log_std was
 * unmoved from its initial value and every factor mean sat on sigmoid(0) = 0.5.
 *
 * The cause was upstream of learning. The curriculum pins the template on 49%
 * of waves and the fairness cap bound on 63%, so the full range of the count
 * factor moved a wave from 19 to 28 enemies — there was almost nothing for a
 * policy to decide, and therefore nothing to learn.
 *
 * TWO DELIBERATE CHOICES
 *
 * Variety is ENFORCED, not rewarded. The reward function had a variation factor
 * and the mask has a template cooldown, and waves still came out repetitive.
 * Picking the stalest allowed template makes repetition impossible rather than
 * merely expensive.
 *
 * Difficulty is a CURVE, not a per-wave decision. The player never heals, so
 * their HP is a whole-run budget; that makes difficulty something you write
 * down, not something to infer from a scalar reward one wave at a time.
 */

import { MAX_TEMPLATE_SLOTS } from './templates';

/** Wave by which the difficulty ramp reaches full strength. */
const RAMP_FULL_WAVE = 60;

/** Spread applied to each factor so successive waves are not identical. */
const JITTER = 0.12;

export interface DirectorDecision {
  templateIdx: number;
  countFactor: number;
  spawnFactor: number;
  hpFactor: number;
  variationFactor: number;
}

/**
 * How stale a template is: 0 = used last wave, higher = longer ago, and one
 * past the history length for anything unused. Drives the variety rule.
 */
function staleness(idx: number, recent: readonly number[]): number {
  for (let i = recent.length - 1, age = 0; i >= 0; i--, age++) {
    if (recent[i] === idx) return age;
  }
  return recent.length + 1;
}

export class RuleDirector {
  /**
   * @param mask         per-slot availability; carries curriculum, capability
   *                     gates, boss cadence and template cooldown
   * @param waveNumber   the wave being planned (not the one just finished)
   * @param recent       recently shipped template indices, oldest first
   * @param random       injectable for deterministic tests
   */
  decide(
    mask: readonly boolean[],
    waveNumber: number,
    recent: readonly number[],
    random: () => number = Math.random,
  ): DirectorDecision {
    const allowed: number[] = [];
    for (let i = 0; i < Math.min(mask.length, MAX_TEMPLATE_SLOTS); i++) {
      if (mask[i]) allowed.push(i);
    }

    // Ramp to full difficulty around the target run length, then hold.
    const ramp = Math.min(1, Math.max(0, waveNumber / RAMP_FULL_WAVE));
    const jitter = (v: number) => clamp01(v + (random() * 2 - 1) * JITTER);

    const decision = {
      countFactor: jitter(0.45 + 0.4 * ramp),      // grows through the run
      spawnFactor: jitter(0.55 - 0.25 * ramp),     // spawn delay tightens
      hpFactor: jitter(0.4 + 0.35 * ramp),         // enemies get tougher
      variationFactor: jitter(0.6),                // steady mix
    };

    if (allowed.length === 0) {
      // Degenerate but reachable: a curriculum-forced template whose slot the
      // capability mask also blocks. Slot 0 always exists; shipping the
      // designer's first template beats shipping nothing.
      //
      // Fixed mid-range factors rather than the ramped ones, matching the
      // Python reference this was measured against. There is no meaningful
      // difficulty statement to make about a wave nobody intended to ship.
      return {
        templateIdx: 0,
        countFactor: 0.6,
        spawnFactor: 0.4,
        hpFactor: 0.5,
        variationFactor: 0.5,
      };
    }

    // Stalest allowed template, ties broken at random.
    let best = -1;
    let bestAge = -1;
    const tied: number[] = [];
    for (const idx of allowed) {
      const age = staleness(idx, recent);
      if (age > bestAge) {
        bestAge = age;
        tied.length = 0;
        tied.push(idx);
      } else if (age === bestAge) {
        tied.push(idx);
      }
    }
    best = tied[Math.floor(random() * tied.length) % tied.length];

    return { templateIdx: best, ...decision };
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
