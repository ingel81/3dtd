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
 * Wie viele Wellen jünger als der älteste Kandidat ein Template sein darf und
 * trotzdem in die Wahl kommt.
 *
 * Bis zum 2026-09-22 stand hier faktisch 0: Es gewann immer der älteste, und
 * nur ein echter Gleichstand ließ eine Wahl zu. Das erzwingt Abwechslung
 * perfekt, macht aber auch jede Anpassung an den Spieler unmöglich — wer
 * immer den ältesten nimmt, spielt langfristig jedes Template gleich oft,
 * ganz gleich wie der Gleichstand fällt.
 *
 * Mit 2 kann ein Template höchstens zwei Wellen früher oder später kommen als
 * bisher. Die Rotation bleibt, sie wird nur atmungsfähig genug, dass der
 * Druck-Regler in ihr etwas bewirken kann (docs/DRAMA_CONTROLLER_PLAN.md,
 * Runde 16; Entscheidung des Users am 2026-09-22).
 */
export const STALENESS_SLACK = 2;

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
  /** Candidates that were exactly as stale as the oldest one. */
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
 * Wie der Gleichstand zwischen gleich alten Kandidaten aufgelöst wird.
 *
 * `null` würfelt, wie bisher. Sonst entscheidet, wie viel Luft der Deckel dem
 * Template lässt: `harder` nimmt das Template mit der wenigsten (die
 * Verteidigung steht dagegen schlecht), `easier` das mit der meisten.
 *
 * Die Älteste-zuerst-Regel bleibt davon unberührt — Abwechslung wird weiter
 * erzwungen, nur die Wahl *innerhalb* der gleich alten Kandidaten hört auf,
 * zufällig zu sein. Sie ist häufig: Über die Kampagne hinaus stehen regelmäßig
 * neun Templates gleichauf.
 */
export interface TieBreak {
  prefer: 'harder' | 'easier';
  /** Luft des Deckels je Template-Index, 0..1 (buildWaveContext). */
  headroom: ReadonlyMap<number, number>;
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
 * @param tieBreak    resolves ties by how well the defense covers each
 *                    template instead of by chance; omitted or null keeps the
 *                    coin flip
 */
export function decideWave(
  candidates: readonly number[],
  waveNumber: number,
  recent: readonly number[],
  random: () => number = Math.random,
  tieBreak: TieBreak | null = null,
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

  // Die ältesten Kandidaten, plus die, die höchstens STALENESS_SLACK Wellen
  // jünger sind. Unter ihnen entscheidet der Tie-Break.
  let bestAge = -1;
  for (const idx of candidates) {
    bestAge = Math.max(bestAge, staleness(idx, recent));
  }
  // `max(1, ...)`: Das Template der letzten Welle kommt nie zweimal
  // hintereinander, auch wenn der Slack es rechnerisch zuließe. Bei nur zwei
  // Kandidaten wäre das sonst möglich, und eine direkte Wiederholung ist das
  // eine, was die Regel auf jeden Fall verhindern soll.
  const floor = Math.max(1, bestAge - STALENESS_SLACK);
  const eligible = candidates.filter((idx) => staleness(idx, recent) >= floor);
  // `tied` bleibt die Aussage über echten Gleichstand, für die Begründung.
  const tied = candidates.filter((idx) => staleness(idx, recent) === bestAge);
  const best = breakTie(eligible, tieBreak, random);

  return {
    templateIdx: best,
    factors,
    why: {
      candidates: candidates.length,
      // staleness() puts anything outside the history one past its end.
      // Das Alter des Gewählten, nicht das des ältesten: Seit dem Slack
      // können die auseinanderfallen.
      lastRanWavesAgo: (() => {
        const age = staleness(best, recent);
        return age < recent.length ? age + 1 : null;
      })(),
      history: recent.length,
      tied: tied.length,
      ramp,
    },
  };
}

/**
 * Einer aus den Kandidaten, die alt genug sind (siehe STALENESS_SLACK).
 *
 * Ohne `tieBreak` per Zufall, wie seit jeher. Mit ihm der, dessen Deckel am
 * wenigsten (`harder`) oder am meisten (`easier`) Luft lässt. Der Zufall
 * bleibt der Gleichstand des Gleichstands: Mehrere Templates mit demselben
 * Wert werden weiter ausgewürfelt, sonst liefe dieselbe Reihenfolge in jedem
 * Lauf.
 */
function breakTie(tied: readonly number[], tieBreak: TieBreak | null, random: () => number): number {
  if (!tieBreak || tied.length < 2) {
    return tied[Math.floor(random() * tied.length) % tied.length];
  }
  const harder = tieBreak.prefer === 'harder';
  let bestValue = harder ? Infinity : -Infinity;
  const bestOf: number[] = [];
  for (const idx of tied) {
    // Ein Template ohne Eintrag zählt als "die Verteidigung räumt es ab":
    // Das ist die vorsichtige Annahme, sie macht es nicht zum Favoriten für
    // `harder`.
    const value = tieBreak.headroom.get(idx) ?? 1;
    if (harder ? value < bestValue : value > bestValue) {
      bestValue = value;
      bestOf.length = 0;
      bestOf.push(idx);
    } else if (value === bestValue) {
      bestOf.push(idx);
    }
  }
  return bestOf[Math.floor(random() * bestOf.length) % bestOf.length];
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
