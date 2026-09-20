import { Injectable } from '@angular/core';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { waveGold } from '../configs/campaign.config';
import type { WaveGoldBreakdown } from '../game-engine/game-event-bus';

/**
 * Gold that waves `first`..`last` pay a player who kills every enemy: the
 * kill budget, the base completion bonus and the milestone bonuses. No skill
 * bonuses (perfect, close call, combo, comeback), those depend on how a wave
 * was played. The dev wave jump grants it for the waves it skips
 * (GameStateManager.jumpToWave); 0 for an empty range.
 */
export function skippedWavesGold(first: number, last: number): number {
  const milestones = GAME_BALANCE.economy.milestoneBonuses;
  let total = 0;
  for (let wave = Math.max(1, first); wave <= last; wave++) {
    const budget = waveGold(wave);
    total += budget.kill + budget.complete + (milestones[wave] ?? 0);
  }
  return total;
}

/**
 * EconomyService — Wave-Completion-Bonus + Perfect-Streak-Tracking.
 *
 * Vorher inline in GameStateManager (`applyWaveCompletionBonus` + `_perfectStreak`).
 * Hier in eigenem Service, damit GSM nur noch den Wave-Loop orchestriert
 * und die Economy-Domäne separat testbar/balancebar ist.
 *
 * Phase 5.16:
 * - Base bonus aus dem Campaign-Budget (deterministisch).
 * - Skill-Bonusse stapeln: Perfect (no HP loss), CloseCall, Milestone,
 *   Combo (Perfect-Streak), Comeback (HP-Lost-Penalty-Trostpreis).
 */
/** The sum of a wave's completion gold. */
export function waveGoldTotal(breakdown: WaveGoldBreakdown): number {
  return breakdown.base + breakdown.perfect + breakdown.combo
    + breakdown.closeCall + breakdown.comeback + breakdown.milestone;
}

@Injectable({ providedIn: 'root' })
export class EconomyService {
  private _perfectStreak = 0;

  /** Aktuelle Perfect-Streak (0 wenn letzte Wave nicht perfect). */
  get perfectStreak(): number {
    return this._perfectStreak;
  }

  /**
   * Berechnet den Wave-Completion-Bonus inkl. aller Skill-Stacks und
   * aktualisiert den Perfect-Streak. Liefert die Teile einzeln; der Caller
   * bucht ihre Summe (`waveGoldTotal`) und das Run-Log schreibt die
   * Aufteilung mit (docs/RUN_LOG.md).
   */
  computeWaveCompletionBonus(result: {
    wave: number;
    perfect: boolean;
    closeCall: boolean;
    hpLost: number;
  }): WaveGoldBreakdown {
    const cfg = GAME_BALANCE.economy;
    const base = waveGold(result.wave).complete;
    const perfectBonus = result.perfect ? Math.round(base * cfg.perfectBonusRatio) : 0;
    const closeCallBonus = result.closeCall ? Math.round(base * cfg.closeCallBonusRatio) : 0;
    const milestoneBonus = cfg.milestoneBonuses[result.wave] ?? 0;
    const comebackBonus = result.hpLost > 0
      ? Math.min(cfg.comebackBonusCap, Math.round(result.hpLost * cfg.comebackBonusSlope))
      : 0;

    // Combo-Streak: Perfect-Wave erhöht Streak, Non-Perfect resettet.
    this._perfectStreak = result.perfect ? this._perfectStreak + 1 : 0;
    const comboMultiplier = Math.min(cfg.comboBonusMax, this._perfectStreak * cfg.comboBonusPerStreak);
    const comboBonus = Math.round(base * comboMultiplier);

    return {
      base,
      perfect: perfectBonus,
      combo: comboBonus,
      closeCall: closeCallBonus,
      comeback: comebackBonus,
      milestone: milestoneBonus,
    };
  }

  /** Reset (z.B. bei Game-Restart). */
  reset(): void {
    this._perfectStreak = 0;
  }
}
