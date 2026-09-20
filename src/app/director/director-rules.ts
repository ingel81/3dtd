/**
 * The director's rules: which template a wave uses and how it is shaped.
 *
 * Everything downstream — the candidate list, range interpolation, the DPS
 * ramp, the endgame multiplier, the survivability cap — is shared with what
 * came before it.
 *
 * WHY RULES AND NOT A MODEL
 *
 * Measured across a day of A/B runs with four directors sharing the same bots,
 * campaign and survivability cap, the trained policy network was three times
 * statistically indistinguishable from uniform random sampling (mean run length
 * 45.6 [42,49] against random's 44.7 [41,48]), while two trivial heuristics
 * produced measurably more tension (near-miss 0.067-0.069 against 0.045). The
 * network had never learned: after thousands of episodes its log_std was
 * unmoved from its initial value and every factor mean sat on sigmoid(0) = 0.5.
 *
 * The cause was upstream of learning. The campaign pins the template on 49%
 * of waves and the cap bound on 63%, so the full range of the count factor
 * moved a wave from 19 to 28 enemies — there was almost nothing to decide, and
 * therefore nothing to learn.
 *
 * TWO DELIBERATE CHOICES
 *
 * Variety is ENFORCED, not rewarded. The old reward function had a variation
 * term and the candidate list has a template cooldown, and waves still came out
 * repetitive. Picking the stalest candidate makes repetition impossible rather
 * than merely expensive.
 *
 * Difficulty is a CURVE, not a per-wave decision. The player never heals, so
 * their HP is a whole-run budget; that makes difficulty something you write
 * down, not something to infer from a scalar reward one wave at a time.
 */

/**
 * Wave by which the difficulty ramp reaches full strength.
 *
 * The default; a bot batch may run a named parameter set instead
 * (director-params.ts), which is why `decideWave` reads it through
 * `directorParams()`.
 */
export const RAMP_FULL_WAVE = 60;

import { directorParams } from './director-params';

/** Spread applied to each factor so successive waves are not identical. */
const JITTER = 0.12;

/**
 * The four numbers that shape a wave, each 0..1 inside the template's ranges:
 * how many enemies, how fast they arrive, how tough they are, how mixed.
 */
export interface DirectorFactors {
  count: number;
  spawn: number;
  hp: number;
  variation: number;
}

/**
 * How the template was picked among the candidates, for the decision
 * explainer. The candidate reason says what was allowed; this says how the
 * choice among it was made.
 */
export interface DirectorReason {
  /** Templates that were candidates. 0 means the defensive fallback. */
  candidates: number;
  /** Waves since the pick last ran (1 = the previous wave), null if not in the history. */
  lastRanWavesAgo: number | null;
  /** Length of the template history staleness was read from. */
  history: number;
  /** Candidates that shared the pick's staleness; the tie was broken at random. */
  tied: number;
  /** Position on the difficulty ramp, 0..1. */
  ramp: number;
}

export interface DirectorDecision {
  templateIdx: number;
  factors: DirectorFactors;
  why: DirectorReason;
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

/**
 * Pick a template among `candidates` and the four factors for the wave.
 *
 * @param candidates  template indices the wave may use (candidateTemplates);
 *                    carries campaign pin, requirements, boss cadence and the
 *                    reuse cooldown
 * @param waveNumber  the wave being planned (not the one just finished)
 * @param recent      recently shipped template indices, oldest first
 * @param random      injectable for deterministic tests
 */
export function decideWave(
  candidates: readonly number[],
  waveNumber: number,
  recent: readonly number[],
  random: () => number = Math.random,
): DirectorDecision {
  // Ramp to full difficulty around the target run length, then hold.
  const ramp = Math.min(1, Math.max(0, waveNumber / directorParams().rampFullWave));
  const jitter = (v: number) => clamp01(v + (random() * 2 - 1) * JITTER);

  const factors: DirectorFactors = {
    count: jitter(0.45 + 0.4 * ramp),      // grows through the run
    spawn: jitter(0.55 - 0.25 * ramp),     // spawn delay tightens
    hp: jitter(0.4 + 0.35 * ramp),         // enemies get tougher
    variation: jitter(0.6),                // steady mix
  };

  if (candidates.length === 0) {
    // Defensive only. `candidateTemplates` cannot currently return an empty
    // list: a campaign-pinned wave returns early without consulting the
    // requirements, and the unpinned path guarantees slot 0. This branch
    // exists so a future change there cannot turn into a wave with no
    // template at all.
    //
    // Fixed mid-range factors rather than the ramped ones. There is no
    // meaningful difficulty statement to make about a wave nobody intended to
    // ship.
    return {
      templateIdx: 0,
      factors: { count: 0.6, spawn: 0.4, hp: 0.5, variation: 0.5 },
      why: { candidates: 0, lastRanWavesAgo: null, history: recent.length, tied: 0, ramp },
    };
  }

  // Stalest candidate, ties broken at random.
  let bestAge = -1;
  const tied: number[] = [];
  for (const idx of candidates) {
    const age = staleness(idx, recent);
    if (age > bestAge) {
      bestAge = age;
      tied.length = 0;
      tied.push(idx);
    } else if (age === bestAge) {
      tied.push(idx);
    }
  }
  const best = tied[Math.floor(random() * tied.length) % tied.length];

  return {
    templateIdx: best,
    factors,
    why: {
      candidates: candidates.length,
      // staleness() puts anything outside the history one past its end.
      lastRanWavesAgo: bestAge < recent.length ? bestAge + 1 : null,
      history: recent.length,
      tied: tied.length,
      ramp,
    },
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
