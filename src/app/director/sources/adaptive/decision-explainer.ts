/**
 * Decision Explainer
 *
 * Turns the reasons behind a director decision into short sentences for the
 * "Why this wave" block in the wave debug window and the debug-mode console.
 *
 * It only reads reasons the pipeline recorded while deciding: the mask
 * (campaign pin, boss rule, capability gates), how the director picked among
 * what the mask allowed, and how the shared path sized the wave (DPS ramp,
 * fairness cap, pressure loop, duration cap, endgame HP). It never infers intent
 * from the game state. The previous version did: it read the defense snapshot
 * and printed heuristics like "no anti-air -> sending flying enemies" or "player
 * is struggling, sending an easier wave (mercy)". The rule director does none
 * of that, so those lines described decisions nobody made.
 */

import {
  TEMPLATES,
  TEMPLATE_COOLDOWN_WAVES,
  DPS_RAMP_COUNT,
  MAX_WAVE_DURATION_MS,
  type NumberRange,
  type TemplateCapability,
  type CandidateReason,
} from './templates';
import { RAMP_FULL_WAVE, type DirectorReason } from './director-rules';
import {
  PRESSURE_MIN_SAMPLES,
  PRESSURE_BAND_LO,
  PRESSURE_BAND_HI,
  type PressureStatus,
} from './pressure-controller';
import {
  CAMPAIGN_LENGTH,
  BOSS_WAVE_INTERVAL_AFTER_CAMPAIGN,
} from '../configs/campaign.config';

/**
 * Hat der Überlebbarkeits-Deckel die Wellengröße bestimmt?
 *
 * Der Druck-Regler braucht die Antwort als Anti-Windup: Wenn die Welle ohnehin
 * kleiner ist, als der Deckel erlauben würde, hat sein Multiplikator gar keine
 * Wirkung, und weiter zu öffnen heißt, gegen eine Sättigung zu integrieren.
 * Gemessen: Über die Wellen 20 bis 26 lief er so von ×1,04 auf ×8,6, und als
 * der Deckel wieder griff, schickte er 673 Gegner
 * (docs/DRAMA_CONTROLLER_PLAN.md).
 */
export function capIsBinding(sizing: WaveSizing): boolean {
  return sizing.cap !== null && sizing.cap < sizing.dpsScaledMax;
}

/** How the shared path sized the wave, as recorded by `buildWaveConfig`. */
export interface WaveSizing {
  /** The template's designer count range. */
  countRange: NumberRange;
  /** Upper end of the count range after the DPS ramp. */
  dpsScaledMax: number;
  totalDps: number;
  /** Survivability cap at the shipped spawn delay; null means no finite cap. */
  cap: number | null;
  countFactor: number;
  count: number;
  hpMult: number;
  /** Endgame share of `hpMult` (1 through wave 20). */
  endgameHpMult: number;
  spawnDelay: number;
  /** The wave-duration cap compressed the spawn delay. */
  durationCapped: boolean;
}

/** Everything the explainer is allowed to talk about. */
export interface WaveDecisionTrace {
  /** The wave being planned, not the one just finished. */
  wave: number;
  templateName: string;
  candidates: CandidateReason;
  director: DirectorReason;
  pressure: PressureStatus;
  sizing: WaveSizing;
}

export interface DecisionExplanation {
  /** One line: wave, template, size, HP. */
  summary: string;
  /** Short sentences, template choice first, then size. */
  reasons: string[];
  /**
   * The numbers the sentences were written from.
   *
   * The run log needs the survivability cap as a number, not as the sentence
   * "Survivability cap holds the count at 5": how often the cap binds is the
   * figure the tuning rounds are judged by, and prose cannot be counted
   * (docs/BALANCING_PLAN.md, Baseline).
   *
   * Optional: an explanation written by hand, as a boss rotation or a test
   * does, has sentences but no numbers behind them.
   */
  sizing?: WaveSizing;
}

const CAPABILITY_LABEL: Record<NonNullable<TemplateCapability>, string> = {
  antiAir: 'anti-air',
  antiEthereal: 'anti-ethereal',
};

export function explainWaveDecision(trace: WaveDecisionTrace): DecisionExplanation {
  const { wave, templateName, sizing } = trace;
  return {
    summary: `Wave ${wave}: ${templateName} · ${sizing.count} enemies · HP ×${sizing.hpMult.toFixed(2)}`,
    reasons: [...templateReasons(trace), ...sizeReasons(trace)],
    sizing,
  };
}

/** Plain text for the debug-mode console, same wording as the debug window. */
export function formatExplanation(explanation: DecisionExplanation): string {
  return [explanation.summary, ...explanation.reasons.map((r) => `  - ${r}`)].join('\n');
}

function templateReasons({ wave, templateName, candidates, director }: WaveDecisionTrace): string[] {
  const reasons: string[] = [];

  if (candidates.rule === 'campaign') {
    reasons.push(
      `Campaign: wave ${wave} is always ${templateName} (waves 1-${CAMPAIGN_LENGTH} are fixed).`,
    );
    if (candidates.pinnedLacks) {
      reasons.push(`Pinned although the defense has no ${CAPABILITY_LABEL[candidates.pinnedLacks]}.`);
    }
    return reasons;
  }

  if (candidates.rule === 'boss') {
    reasons.push(
      `Boss wave (every ${BOSS_WAVE_INTERVAL_AFTER_CAMPAIGN} waves after wave ${CAMPAIGN_LENGTH}): boss templates only.`,
    );
  } else if (candidates.bossUnavailable) {
    reasons.push('Boss wave, but no boss template is available: runs as a normal wave.');
  }
  if (candidates.cooldownWaived) {
    reasons.push(`Every eligible template ran in the last ${plural(TEMPLATE_COOLDOWN_WAVES, 'wave')}: cooldown waived.`);
  }

  reasons.push(pickReason(director));

  for (const capability of ['antiAir', 'antiEthereal'] as const) {
    const held = candidates.heldBack[capability];
    if (held.length > 0) {
      const names = held.map((i) => TEMPLATES[i].name).join(', ');
      reasons.push(`Held back, no ${CAPABILITY_LABEL[capability]}: ${names}.`);
    }
  }
  return reasons;
}

function pickReason(director: DirectorReason): string {
  const { candidates, lastRanWavesAgo, history, tied } = director;
  if (candidates === 0) return 'No template allowed: fell back to the first one with fixed mid-range factors.';
  if (candidates === 1) return 'The only template allowed.';

  const age = lastRanWavesAgo !== null
    ? `last ran ${plural(lastRanWavesAgo, 'wave')} ago`
    : history > 0 ? `not used in the last ${plural(history, 'wave')}` : 'no history yet';
  const tie = tied > 1 ? `, random among ${tied} tied` : '';
  return `Oldest of ${candidates} allowed templates: ${age}${tie}.`;
}

function sizeReasons({ director, pressure, sizing }: WaveDecisionTrace): string[] {
  const reasons: string[] = [];
  const [lo, hi] = sizing.countRange;
  const dpsMax = Math.round(sizing.dpsScaledMax);
  const { cap } = sizing;

  if (dpsMax < hi) {
    reasons.push(
      `DPS ramp: ${Math.round(sizing.totalDps)} of ${DPS_RAMP_COUNT} DPS narrows the count range to ${lo}-${dpsMax}.`,
    );
  }

  // Mirrors the fold in buildWaveConfig: a cap below the template minimum
  // collapses the range onto the cap, a cap inside it becomes the new top.
  const binding = capIsBinding(sizing);
  if (cap === null) {
    reasons.push('Survivability cap: none, the defense kills faster than enemies spawn.');
  } else if (cap < lo) {
    reasons.push(`Survivability cap is ${cap}, below the template minimum of ${lo}.`);
  } else if (binding) {
    reasons.push(`Survivability cap holds the count at ${cap}.`);
  } else {
    reasons.push(`Survivability cap ${cap}, not binding.`);
  }
  // The loop only shaped this wave if its cap did.
  if (binding) reasons.push(pressureLoopReason(pressure));

  if (cap === null || cap >= lo) {
    const top = binding ? cap : dpsMax;
    const where = `count at ${percent(sizing.countFactor)} of ${lo}-${top}`;
    if (director.candidates === 0) {
      reasons.push(`Fixed factor: ${where}.`);
    } else {
      reasons.push(`Ramp ${percent(director.ramp)} (full at wave ${RAMP_FULL_WAVE}): ${where}.`);
    }
  }

  if (sizing.durationCapped) {
    reasons.push(
      `Spawn delay compressed to ${sizing.spawnDelay} ms to keep the wave under ${MAX_WAVE_DURATION_MS / 60_000} min.`,
    );
  }
  if (sizing.endgameHpMult > 1) {
    reasons.push(
      `HP ×${sizing.hpMult.toFixed(2)} includes the endgame multiplier ×${sizing.endgameHpMult.toFixed(2)}.`,
    );
  }
  return reasons;
}

function pressureLoopReason(pressure: PressureStatus): string {
  const mult = `×${pressure.multiplier.toFixed(2)}`;
  const target = pressure.target ?? 0;
  const band = `${percent(target * PRESSURE_BAND_LO)}-${percent(target * PRESSURE_BAND_HI)}`;
  const cost = `waves cost ${percent(pressure.meanPressure ?? 0)} of HP on average`;
  switch (pressure.lastStep) {
    case 'warming-up':
      return `Pressure loop still collecting (${pressure.samples} of ${PRESSURE_MIN_SAMPLES} waves), at ${mult}.`;
    case 'opened':
      return `Pressure loop: ${cost}, under the ${band} target, so it opened to ${mult}.`;
    case 'closed':
      return `Pressure loop: ${cost}, over the ${band} target, so it closed to ${mult}.`;
    case 'held':
      return `Pressure loop: ${cost}, inside the ${band} target, it holds at ${mult}.`;
  }
}

function percent(v: number): string {
  const pct = v * 100;
  // Der Zieldruck liegt bei wenigen Prozent; auf ganze Prozent gerundet
  // stünde in der Begründung dreimal dieselbe Zahl.
  return pct > 0 && pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
