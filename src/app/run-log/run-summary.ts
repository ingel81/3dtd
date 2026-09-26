/**
 * The game-over screen's numbers, read out of the run log.
 *
 * Until 2026-09-20 a second collector (`RunStatsTracker`) counted the same
 * events a second time. One log, one truth: the summary is a fold over the
 * records (docs/RUN_LOG.md).
 */

import type { RunLog, RunLogWave } from './run-log.types';

/** Most towers the game-over summary lists */
export const RUN_TOP_TOWERS = 3;

/** One tower's share of a run */
export interface TowerRunStats {
  id: string;
  name: string;
  damageDealt: number;
  kills: number;
  /** Sold before the run ended; its numbers are from the moment of the sale */
  sold: boolean;
}

/** What a run came to, shown on the game-over screen */
export interface RunSummary {
  /** Wave the HQ fell in */
  waveReached: number;
  /** Enemies killed, by towers or anything else; an ooze killed while it flows into the HQ is a leak */
  kills: number;
  /** Kill rewards and wave bonuses; refunds and cheat credits left out */
  goldEarned: number;
  /** Towers, upgrades and research, minus what selling and cancelling gave back */
  goldSpent: number;
  /** Game time from the start of the run (build phase included) to the fall */
  durationMs: number;
  /**
   * Enemies that reached the HQ, index 0 = wave 1, one entry per wave up to
   * waveReached. An ooze counts once, from the first point that flows in.
   */
  leaksPerWave: number[];
  /** HP the HQ lost, same indexing as leaksPerWave */
  hqDamagePerWave: number[];
  /** Up to RUN_TOP_TOWERS towers with the most damage dealt, sold ones included */
  topTowers: TowerRunStats[];
}

/** Empty run: nothing played yet. */
export function emptyRunSummary(durationMs = 0): RunSummary {
  return {
    waveReached: 0, kills: 0, goldEarned: 0, goldSpent: 0, durationMs,
    leaksPerWave: [], hqDamagePerWave: [], topTowers: [],
  };
}

/**
 * Fold a run into its summary. `durationMs` is the game time at the fall; the
 * log's own records only reach to the last finished wave.
 */
export function runSummary(run: RunLog | null, durationMs: number, towerName: (type: string) => string): RunSummary {
  if (!run) return emptyRunSummary(durationMs);

  const waves = run.records.filter((r): r is RunLogWave => r.kind === 'wave');
  const waveReached = waves.length > 0 ? Math.max(...waves.map((w) => w.wave)) : 0;

  let kills = 0;
  let goldEarned = 0;
  let goldSpent = 0;
  const leaksPerWave: number[] = Array.from({ length: waveReached }, () => 0);
  const hqDamagePerWave: number[] = Array.from({ length: waveReached }, () => 0);
  /** Per tower id, summed over the waves it lived through. */
  const towers = new Map<string, TowerRunStats>();

  for (const wave of waves) {
    kills += wave.killsByTower + wave.killsByHero + wave.killsByAbility + wave.killsByOther;
    // The cheat gold and what a sale or a cancelled research gives back are
    // not earnings; they would make a dev run look rich.
    goldEarned += (wave.income.kill ?? 0) + (wave.income['wave-bonus'] ?? 0);
    goldSpent += (wave.spending.build ?? 0) + (wave.spending.upgrade ?? 0)
      + (wave.spending.research ?? 0) + (wave.spending.hero ?? 0);

    const index = wave.wave - 1;
    if (index >= 0 && index < waveReached) {
      leaksPerWave[index] = wave.leaked;
      hqDamagePerWave[index] = Math.max(0, wave.healthStart - wave.healthEnd);
    }

    for (const tower of wave.towers) {
      const known = towers.get(tower.id);
      if (known) {
        known.damageDealt += tower.damage;
        known.kills += tower.kills;
        known.sold ||= tower.sold === true;
      } else {
        towers.set(tower.id, {
          id: tower.id,
          name: towerName(tower.type),
          damageDealt: tower.damage,
          kills: tower.kills,
          sold: tower.sold === true,
        });
      }
    }
  }

  const topTowers = [...towers.values()]
    .filter((t) => t.damageDealt > 0 || t.kills > 0)
    .sort((a, b) => b.damageDealt - a.damageDealt || b.kills - a.kills)
    .slice(0, RUN_TOP_TOWERS);

  return {
    waveReached,
    kills,
    goldEarned: Math.round(goldEarned),
    goldSpent: Math.round(goldSpent),
    durationMs,
    leaksPerWave,
    hqDamagePerWave,
    topTowers,
  };
}
