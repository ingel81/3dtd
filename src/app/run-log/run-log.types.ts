/**
 * The run log: what a run did, as data.
 *
 * One format for human and bot runs (docs/RUN_LOG.md). JSONL, one record per
 * line, in the order they happened: one head, then events, samples and one
 * block per wave, and one end record.
 *
 * Every record carries the sub-step it belongs to. The game time is a sum of
 * 16.667 ms steps and drifts in floating point; the step index does not, and a
 * replay as a re-simulation (BALANCING_PLAN.md, section 5) needs the step, not
 * the time.
 */

import type { CreditsSource } from '../game-engine/game-event-bus';
import type { WaveSourceId } from '../director/wave-source';

/** Bumped when a reader would have to change. */
export const RUN_LOG_FORMAT = 3;

/** Where a run was played. */
export type RunMap = 'devworld' | 'world';

/** Who played it. */
export type RunPlayer = 'human' | 'bot';

/** Why a run ended. */
export type RunEndReason = 'defeat' | 'restart' | 'location-change' | 'abandoned';

/** The head: everything that is true for the whole run. */
export interface RunLogHead {
  kind: 'head';
  format: number;
  /** Unique per run, also the file name. */
  runId: string;
  /** Wall clock, only for sorting and naming; the run itself reasons in game time. */
  startedAt: string;
  gameVersion: string;
  /** Git commit the build came from, with a dirty flag when the tree was not clean. */
  commit: string;
  /** Hash over every balance-relevant config, so runs of different balance never get mixed. */
  configHash: string;
  /** The run's seed (GameRng). Internal: players neither see nor share it (D11). */
  seed: number;
  player: RunPlayer;
  /** Which bot played, when one did. */
  botSkill?: string;
  map: RunMap;
  location?: { name: string; lat: number; lon: number };
  /** Fingerprint of the route corridor, so runs on the same route can be compared. */
  routeFingerprint?: string;
  /** Named overrides of director constants, when a batch ran with one (phase 2b). */
  directorParams?: string;
  /**
   * The wave source the run played, when it was not the default one.
   *
   * Absent means the adaptive source, which every run logged before the
   * sources existed played. `configHash` follows the same rule, so those
   * hashes stay where they were.
   */
  waveSource?: WaveSourceId;
}

/** A moment in the run worth naming. */
export type RunLogEventKind =
  | 'run-opened'
  | 'tower-built'
  | 'tower-upgraded'
  | 'tower-sold'
  | 'research-started'
  | 'research-completed'
  | 'research-cancelled'
  | 'ability-used'
  | 'hero-hired'
  | 'hero-level'
  | 'leak'
  | 'boss-spawned'
  | 'wave-started'
  | 'speed'
  | 'pause'
  | 'cheat'
  | 'wave-jump';

export interface RunLogEvent {
  kind: 'event';
  event: RunLogEventKind;
  /** Sub-steps since the run started. */
  step: number;
  /** Game time in ms, for reading by eye. */
  timeMs: number;
  /** The wave that was running, 0 in the build phase before wave 1. */
  wave: number;
  /** Type id of a tower, research, ability, enemy — whatever the event is about. */
  id?: string;
  /** Gold it cost (negative) or paid (positive). */
  credits?: number;
  /** Free field per event: the upgrade branch, the speed, the HP a leak cost. */
  value?: number | string | boolean;
  /** Where it happened, for towers and abilities. */
  at?: { lat: number; lon: number };
}

/** A snapshot once per second of game time. */
export interface RunLogSample {
  kind: 'sample';
  step: number;
  timeMs: number;
  wave: number;
  credits: number;
  baseHealth: number;
  enemiesAlive: number;
  /** Total DPS of the defense, hero included. */
  dps: number;
}

/** What one tower did in one wave. */
export interface RunLogTowerWave {
  id: string;
  type: string;
  /** Upgrade levels by branch. */
  levels: Record<string, number>;
  damage: number;
  kills: number;
  /** Sold in this wave; the numbers are the ones it had at the sale. */
  sold?: true;
}

/** A finished wave, everything about it in one record. */
export interface RunLogWave {
  kind: 'wave';
  wave: number;
  step: number;
  timeMs: number;
  durationMs: number;
  /**
   * Which wave source planned this wave.
   *
   * Absent on runs logged before the sources existed and on waves that came
   * from the debug panel. Two sources are compared by grouping on it
   * (docs/WAVE_SOURCE_PLAN.md, section 8).
   */
  waveSource?: WaveSourceId;
  /** The campaign template that ran. */
  template?: string;
  /** What the director decided and why, as the debug window words it. */
  reason?: string[];
  /** The survivability cap it was sized against; null when none bound. */
  survivableCount?: number | null;
  /**
   * Der Multiplikator des Druck-Reglers zu diesem Zeitpunkt. Hieß bis
   * Format 2 `leakMultiplier` und regelte auf die Leck-Quote.
   */
  pressureMultiplier?: number;
  /**
   * Der Sollwert, auf den geregelt wurde: Anteil der HP, den die Welle kosten
   * sollte. Was sie wirklich gekostet hat, steht als `healthStart` minus
   * `healthEnd` schon in derselben Zeile, also führt das Log den Istwert
   * nicht doppelt.
   */
  targetPressure?: number;
  /**
   * Numbers only the planning source knows, stored as they come.
   *
   * The three fields above stay typed because the format and the Python
   * report already read them; anything a new source wants to record lands
   * here instead of growing the format per source.
   */
  diagnostics?: Readonly<Record<string, number | string | boolean | null>>;
  /** Enemy types and counts as the wave shipped them. */
  composition?: { type: string; count: number; hp: number }[];
  creditsStart: number;
  creditsEnd: number;
  /** Income by source over the wave. */
  income: Partial<Record<CreditsSource, number>>;
  /** Spending by source over the wave, as positive numbers. */
  spending: Partial<Record<CreditsSource, number>>;
  /**
   * Build and upgrade gold per tower type over the wave, as positive numbers.
   *
   * `spending` knows what the gold was for, not what it was spent on, and
   * damage per gold per type is the number that says whether a type is strong
   * or just picked often (BALANCING_PLAN.md, 3b). Gross: what a sale gives
   * back is not subtracted here, the same way `spending` counts it as income.
   */
  towerSpending: Record<string, number>;
  /** How the completion gold came about. */
  waveGold?: { base: number; perfect: number; combo: number; closeCall: number; comeback: number; milestone: number };
  enemiesSpawned: number;
  killsByTower: number;
  killsByHero: number;
  killsByAbility: number;
  killsByDebug: number;
  /** Killed with nobody credited, e.g. a wave that was cleared by a script. */
  killsByOther: number;
  leaked: number;
  /**
   * Enemies still standing when the block began, and when it ended.
   *
   * A block runs from the end of one wave to the end of the next, and enemies
   * live across that seam: what the last wave left over dies in this one. Both
   * numbers are needed to check the bodies, see `reconcileWave`.
   */
  enemiesAtStart: number;
  enemiesAlive: number;
  healthStart: number;
  healthEnd: number;
  towers: RunLogTowerWave[];
  /** The checks of this wave, see `reconcileWave`. Empty when everything adds up. */
  mismatches?: string[];
}

/** The last record of a run. */
export interface RunLogEnd {
  kind: 'end';
  step: number;
  timeMs: number;
  waveReached: number;
  reason: RunEndReason;
}

export type RunLogRecord = RunLogHead | RunLogEvent | RunLogSample | RunLogWave | RunLogEnd;

/** A whole run, as it is kept and exported. */
export interface RunLog {
  head: RunLogHead;
  records: RunLogRecord[];
}

/**
 * The checks a wave has to pass. They are written into the wave record rather
 * than thrown: a run with a hole in its bookkeeping is still worth keeping,
 * and the hole is what the analysis needs to see.
 *
 * - gold: start plus income minus spending is the end
 * - bodies: what stood at the start plus what spawned is killed, leaked or
 *   still standing. The leftovers matter: a wave that hands two enemies to
 *   the next block kills more than it spawned, and that is correct.
 * - towers: the towers' kills do not exceed the wave's tower kills
 */
export function reconcileWave(wave: RunLogWave): string[] {
  const mismatches: string[] = [];

  const income = sum(Object.values(wave.income));
  const spending = sum(Object.values(wave.spending));
  const expected = wave.creditsStart + income - spending;
  if (Math.round(expected) !== Math.round(wave.creditsEnd)) {
    mismatches.push(`gold: ${wave.creditsStart} + ${income} - ${spending} = ${expected}, end ${wave.creditsEnd}`);
  }

  const kills = wave.killsByTower + wave.killsByHero + wave.killsByAbility
    + wave.killsByDebug + wave.killsByOther;
  const bodies = wave.enemiesAtStart + wave.enemiesSpawned;
  const accounted = kills + wave.leaked + wave.enemiesAlive;
  if (bodies !== accounted) {
    mismatches.push(
      `bodies: stood ${wave.enemiesAtStart} + spawned ${wave.enemiesSpawned}`
      + ` = ${bodies}, killed ${kills} + leaked ${wave.leaked} + alive ${wave.enemiesAlive} = ${accounted}`,
    );
  }

  const towerKills = sum(wave.towers.map((t) => t.kills));
  if (towerKills > wave.killsByTower) {
    mismatches.push(`towers: ${towerKills} kills on the towers, ${wave.killsByTower} booked for the wave`);
  }

  return mismatches;
}

function sum(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}
