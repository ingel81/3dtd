import { Injectable } from '@angular/core';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { goldBudgetForWave } from '../configs/wave-curriculum.config';

/**
 * EconomyService — Wave-Completion-Bonus + Perfect-Streak-Tracking.
 *
 * Vorher inline in GameStateManager (`applyWaveCompletionBonus` + `_perfectStreak`).
 * Hier in eigenem Service, damit GSM nur noch den Wave-Loop orchestriert
 * und die Economy-Domäne separat testbar/balancebar ist.
 *
 * Phase 5.16:
 * - Base bonus aus dem Curriculum-Budget (deterministisch).
 * - Skill-Bonusse stapeln: Perfect (no HP loss), CloseCall, Milestone,
 *   Combo (Perfect-Streak), Comeback (HP-Lost-Penalty-Trostpreis).
 */
@Injectable({ providedIn: 'root' })
export class EconomyService {
  private _perfectStreak = 0;

  /** Aktuelle Perfect-Streak (0 wenn letzte Wave nicht perfect). */
  get perfectStreak(): number {
    return this._perfectStreak;
  }

  /**
   * Berechnet den Wave-Completion-Bonus inkl. aller Skill-Stacks und
   * aktualisiert den Perfect-Streak. Liefert die Gesamt-Credit-Gutschrift
   * — der Caller schreibt sie aufs Konto.
   */
  computeWaveCompletionBonus(result: {
    wave: number;
    perfect: boolean;
    closeCall: boolean;
    hpLost: number;
  }): number {
    const cfg = GAME_BALANCE.economy;
    const base = goldBudgetForWave(result.wave).complete;
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

    return base + perfectBonus + closeCallBonus + milestoneBonus + comebackBonus + comboBonus;
  }

  /** Reset (z.B. bei Game-Restart). */
  reset(): void {
    this._perfectStreak = 0;
  }
}
