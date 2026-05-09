/**
 * Wave Curriculum — designer-curated wave sequence + gold budget (Phase 5.16).
 *
 * Each entry pins a template (content/pacing) AND a deterministic gold budget
 * (kill-credits + completion-bonus) for that wave. The NN's continuous factors
 * (count, spawn_delay, hp_mult, variation) still tune *difficulty* — but the
 * player's income per wave is decoupled from those factors entirely. This is
 * the foundation for tower/research-cost balancing: cumulative income is
 * predictable and progression can be planned wave-by-wave.
 *
 * After wave 30 the template loops back to wave 1; gold budgets keep climbing
 * via linear extrapolation (see goldBudgetForWave below) so DPS-Ramp scaling
 * has matching economic headroom.
 *
 * Mirror: training-backend/wave_curriculum.py — keep template sequence in sync.
 * Gold budget lives only here; backend training doesn't need it (the NN's
 * reward function is its own thing in reward.py).
 */

import { TEMPLATES, type Template } from '../ai/core/templates';

export interface CurriculumWave {
  /** Template id forced by the curriculum for this wave. */
  template: string;
  /** Total kill-credits awarded across the whole wave (split per enemy). */
  goldKill: number;
  /** Base wave-completion bonus (skill bonuses stack on top). */
  goldComplete: number;
}

/**
 * Hard sequence, 1-indexed: WAVE_CURRICULUM[0] = wave 1.
 * After the last entry the template loops; the gold budget extrapolates.
 */
export const WAVE_CURRICULUM: readonly CurriculumWave[] = [
  { template: 'zombie_horde',     goldKill:  30, goldComplete:  15 }, //  1 — unarmored intro (bootstrap)
  { template: 'rat_tide',         goldKill:  35, goldComplete:  18 }, //  2 — swarm test
  { template: 'penguin_rush',     goldKill:  42, goldComplete:  22 }, //  3 — speed mix
  { template: 'light_mix',        goldKill:  50, goldComplete:  26 }, //  4 — light armor intro
  { template: 'wallsmasher_crew', goldKill:  60, goldComplete:  30 }, //  5 — light tank-y
  { template: 'spider_swarm',     goldKill:  70, goldComplete:  35 }, //  6 — light swarm
  { template: 'bat_swarm',        goldKill:  82, goldComplete:  40 }, //  7 — AIR debut
  { template: 'hornet_strike',    goldKill:  95, goldComplete:  45 }, //  8 — more air
  { template: 'tank_column',      goldKill: 110, goldComplete:  52 }, //  9 — heavy intro
  { template: 'boss_herbert',     goldKill: 125, goldComplete:  60 }, // 10 — BOSS 1
  { template: 'bear_pack',        goldKill: 142, goldComplete:  68 }, // 11 — heavy fast
  { template: 'dragon_elite',     goldKill: 160, goldComplete:  76 }, // 12 — flying heavy
  { template: 'ghost_surge',      goldKill: 180, goldComplete:  85 }, // 13 — ETHEREAL intro
  { template: 'mammoth_siege',    goldKill: 200, goldComplete:  95 }, // 14 — fortified DPS-check
  { template: 'mech_army',        goldKill: 220, goldComplete: 105 }, // 15 — max heavy
  { template: 'chaos_wave',       goldKill: 240, goldComplete: 115 }, // 16 — multi-armor + air
  { template: 'wraith_storm',     goldKill: 260, goldComplete: 125 }, // 17 — ethereal swarm
  { template: 'armor_gauntlet',   goldKill: 280, goldComplete: 135 }, // 18 — multi-armor mix
  { template: 'rat_tide',         goldKill: 305, goldComplete: 145 }, // 19 — mega-swarm checkpoint
  { template: 'boss_herbert',     goldKill: 330, goldComplete: 160 }, // 20 — BOSS 2
  { template: 'bat_swarm',        goldKill: 360, goldComplete: 175 }, // 21 — air pressure
  { template: 'tank_column',      goldKill: 390, goldComplete: 190 }, // 22 — heavy pressure
  { template: 'ghost_surge',      goldKill: 420, goldComplete: 205 }, // 23 — ethereal pressure
  { template: 'dragon_elite',     goldKill: 450, goldComplete: 220 }, // 24 — flying-heavy pressure
  { template: 'mammoth_siege',    goldKill: 480, goldComplete: 235 }, // 25 — fortified pressure
  { template: 'hornet_strike',    goldKill: 510, goldComplete: 250 }, // 26 — air mass
  { template: 'wraith_storm',     goldKill: 540, goldComplete: 265 }, // 27 — ethereal mass
  { template: 'mech_army',        goldKill: 575, goldComplete: 285 }, // 28 — heavy mass
  { template: 'chaos_wave',       goldKill: 610, goldComplete: 305 }, // 29 — final mix
  { template: 'boss_herbert',     goldKill: 650, goldComplete: 325 }, // 30 — BOSS 3 (season finale)
] as const;

/** Per-wave delta used to extrapolate budgets beyond the explicit curriculum. */
const KILL_DELTA_PER_WAVE = 50;
const COMPLETE_DELTA_PER_WAVE = 30;

// =====================================================================
// Phase 5.16 Endgame Difficulty Knobs (P2)
// Structural difficulty scaling that compounds the NN's continuous factors.
// Both the existing checkpoint (no retraining) and a future fresh checkpoint
// will see steeper late-game without needing to learn it.
// =====================================================================

/**
 * Late-wave HP multiplier applied AFTER the NN's hp_mult — so a strong
 * checkpoint pushing 3× hp_mult at W30 effectively delivers 3× × 1.5× = 4.5×
 * once endgameHpMultiplier kicks in.
 *
 *  W1-19 → 1.00× (no change)
 *  W20   → 1.00× (start of ramp; +5%/wave from here)
 *  W30   → 1.50×
 *  W50   → 2.50×
 *  W80   → 4.00× (cap)
 */
export function endgameHpMultiplier(waveNum: number): number {
  if (waveNum <= 20) return 1.0;
  return Math.min(4.0, 1.0 + 0.05 * (waveNum - 20));
}

/**
 * Per-leak HP-damage to player base scales with wave number — late-game
 * leaks should hurt more so the player can't just tank a steady trickle.
 *
 *  W1-10  → 1
 *  W11-20 → 2
 *  W21-30 → 3
 *  W31-40 → 4
 *  ...
 */
export function enemyBaseDamageForWave(waveNum: number): number {
  if (waveNum < 11) return 1;
  return 1 + Math.floor((waveNum - 1) / 10);
}

/**
 * Curriculum-forced template id for `waveNum` (1-indexed). Loops indefinitely:
 * wave 31 reuses wave 1's template, wave 32 reuses wave 2's, etc.
 */
export function templateForWave(waveNum: number): string | null {
  if (waveNum < 1) return null;
  return WAVE_CURRICULUM[(waveNum - 1) % WAVE_CURRICULUM.length].template;
}

/**
 * Lookup the full Template object for a wave (or null on bad waveNum/unknown id).
 */
export function templateObjectForWave(waveNum: number): Template | null {
  const id = templateForWave(waveNum);
  if (!id) return null;
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * Deterministic gold budget for `waveNum` (1-indexed). Within the explicit
 * curriculum (wave 1-30) the values are read directly. Beyond wave 30 we
 * extrapolate linearly from the last entry — no looping, the player's
 * income keeps growing alongside difficulty (DPS-Ramp scales enemy stats
 * up similarly).
 */
export function goldBudgetForWave(
  waveNum: number,
): { kill: number; complete: number } {
  if (waveNum < 1) return { kill: 0, complete: 0 };
  const len = WAVE_CURRICULUM.length;
  if (waveNum <= len) {
    const e = WAVE_CURRICULUM[waveNum - 1];
    return { kill: e.goldKill, complete: e.goldComplete };
  }
  const last = WAVE_CURRICULUM[len - 1];
  const extra = waveNum - len;
  return {
    kill: last.goldKill + extra * KILL_DELTA_PER_WAVE,
    complete: last.goldComplete + extra * COMPLETE_DELTA_PER_WAVE,
  };
}
