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
 * After wave 30 the director picks the template (every fifth wave a boss, see
 * isBossWave) and the gold budget tapers to a sustain level (goldBudgetForWave).
 *
 * The backend reads the template sequence from the generated schema
 * (training-backend/generated/ai-schema.json, `npm run ai-schema`). The gold
 * budget lives only here; backend training doesn't need it (the NN's reward
 * function is its own thing in reward.py).
 */

import { TEMPLATES, type Template } from '../ai/core/templates';
import { type EnemyTypeId } from './enemy-types.config';
import { WaveConfig as AIWaveConfig, WaveEnemyGroup } from '../ai/core/models/wave-config';
import { SpawnPattern } from '../ai/core/spawn-schedule-builder';

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
 * After the last entry the director picks the template (templateForWave
 * returns null) and the gold budget tapers (goldBudgetForWave).
 */
export const WAVE_CURRICULUM: readonly CurriculumWave[] = [
  // Rebalanced baseline derived from a Wave-Planner W30-target run:
  // every tower 1× (archer ×3), all upgrade tracks at L20, every research
  // done, RC Lv 3 — the cumulative cost of that endgame state is the income
  // budget this curriculum funds. Smoothed monotonic growth (~25-40%/wave)
  // with deliberate boss bonuses at W10/W20/W30.
  // Buffer over that roster: 25% when it was set, 83% since the upgrade
  // curves turned degressive and range stopped at L10 (roster 632,834 ->
  // 431,542 gold, see economy-chart.html), 69% since the chaos tower joined
  // the roster (468,702). Deliberately not retuned before a playtest, see
  // BALANCE_PROPOSAL_2026-09 §2.5.
  { template: 'zombie_horde',     goldKill:   133, goldComplete:    67 }, //  1 — unarmored intro (200 baseline; ~250 with combo)
  { template: 'rat_tide',         goldKill:   267, goldComplete:   133 }, //  2 — swarm test (400; funds gatling-tech)
  { template: 'penguin_rush',     goldKill:   333, goldComplete:   167 }, //  3 — speed mix (500; covers W4 build phase)
  { template: 'light_mix',        goldKill:   367, goldComplete:   183 }, //  4 — light armor intro (550; ice-magic research)
  { template: 'wallsmasher_crew', goldKill:   433, goldComplete:   217 }, //  5 — light tank-y (650)
  { template: 'spider_swarm',     goldKill:   467, goldComplete:   233 }, //  6 — light swarm (700)
  { template: 'bat_swarm',        goldKill:   533, goldComplete:   267 }, //  7 — AIR debut (800)
  { template: 'hornet_strike',    goldKill:   600, goldComplete:   300 }, //  8 — more air (900)
  { template: 'tank_column',      goldKill:   733, goldComplete:   367 }, //  9 — heavy intro (1100)
  { template: 'boss_herbert',     goldKill:   933, goldComplete:   467 }, // 10 — BOSS 1 (1400; reduced bonus peak)
  { template: 'bear_pack',        goldKill:  1200, goldComplete:   600 }, // 11 — heavy fast
  { template: 'dragon_elite',     goldKill:  1667, goldComplete:   833 }, // 12 — flying heavy
  { template: 'ghost_surge',      goldKill:  2000, goldComplete:  1000 }, // 13 — ETHEREAL intro
  { template: 'mammoth_siege',    goldKill:  2333, goldComplete:  1167 }, // 14 — fortified DPS-check
  { template: 'golem_squad',      goldKill:  3000, goldComplete:  1500 }, // 15 — fortified DPS check (Stone Golem squad)
  { template: 'chaos_wave',       goldKill:  3667, goldComplete:  1833 }, // 16 — multi-armor + air
  { template: 'wraith_storm',     goldKill:  4667, goldComplete:  2333 }, // 17 — ethereal swarm
  { template: 'armor_gauntlet',   goldKill:  6000, goldComplete:  3000 }, // 18 — multi-armor mix
  { template: 'skeleton_swarm',   goldKill:  8000, goldComplete:  4000 }, // 19: mega-swarm checkpoint (skeletons, was a second rat_tide)
  { template: 'boss_herbert',     goldKill: 12000, goldComplete:  6000 }, // 20 — BOSS 2 (bonus peak)
  { template: 'bat_swarm',        goldKill: 10667, goldComplete:  5333 }, // 21 — air pressure
  { template: 'tank_column',      goldKill: 14667, goldComplete:  7333 }, // 22 — heavy pressure
  { template: 'ghost_surge',      goldKill: 18667, goldComplete:  9333 }, // 23 — ethereal pressure
  { template: 'dragon_elite',     goldKill: 24000, goldComplete: 12000 }, // 24 — flying-heavy pressure
  { template: 'mammoth_siege',    goldKill: 30000, goldComplete: 15000 }, // 25 — fortified pressure
  { template: 'hornet_strike',    goldKill: 40000, goldComplete: 20000 }, // 26 — air mass
  { template: 'wraith_storm',     goldKill: 53333, goldComplete: 26667 }, // 27 — ethereal mass
  { template: 'mech_army',        goldKill: 73333, goldComplete: 36667 }, // 28 — heavy mass
  { template: 'chaos_wave',       goldKill: 93333, goldComplete: 46667 }, // 29 — final mix
  { template: 'boss_herbert',     goldKill:120000, goldComplete: 60000 }, // 30 — BOSS 3 (season finale, bonus peak)
] as const;

// Past W30 the curriculum pins no template (templateForWave returns null,
// the director picks) and goldBudgetForWave tapers the income to a sustain
// level. Neither a linear `+delta` extrapolation (half a million gold per wave)
// nor looping the W1-W30 budgets held up, see goldBudgetForWave.

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

/** Last wave the curriculum pins a template to. Beyond this the AI chooses. */
export const CURRICULUM_FORCED_THROUGH_WAVE = WAVE_CURRICULUM.length;

/**
 * Curriculum-forced template id for `waveNum` (1-indexed), or null.
 *
 * Returns null past wave {@link CURRICULUM_FORCED_THROUGH_WAVE}; from there
 * the Wave Director's template head chooses for itself under the normal
 * availability mask. The designer owns content and pacing through the scripted
 * run; the AI owns the open-ended tail.
 *
 * Note this does NOT loop, unlike {@link staticWaveProfileForWave} (the
 * AI-off fallback, which needs a defined value at every wave number and
 * loops mod-30). {@link goldBudgetForWave} also stays defined past this
 * wave, but it tapers rather than loops (docs/STATIC_WAVE_FALLBACK.md).
 */
export function templateForWave(waveNum: number): string | null {
  if (waveNum < 1 || waveNum > CURRICULUM_FORCED_THROUGH_WAVE) return null;
  return WAVE_CURRICULUM[waveNum - 1].template;
}

/** Boss-Takt im Curriculum (W10/W20/W30 sind dort gepinnt). */
export const BOSS_WAVE_INTERVAL = 10;
/** Boss-Takt danach, wenn der Director das Template wählt. */
export const BOSS_WAVE_INTERVAL_AFTER_CURRICULUM = 5;

/**
 * Ist `waveNum` eine Boss-Welle? Bis W30 jede zehnte, danach jede fünfte.
 *
 * Past the curriculum the template mask collapses onto the boss templates on
 * these waves (getAvailableTemplateMask). The mask used to merely ALLOW a boss
 * on `wave % 10 === 0`, and the stalest-template rule then tied it with about
 * fourteen other templates: simulated over 2,000 runs, W31-W130 produced 0.7
 * boss waves where ten were intended.
 *
 * Mirrored by `schema.is_boss_wave` in the training backend, which reads both
 * intervals from the generated schema.
 */
export function isBossWave(waveNum: number): boolean {
  if (waveNum < 1) return false;
  const interval = waveNum <= CURRICULUM_FORCED_THROUGH_WAVE
    ? BOSS_WAVE_INTERVAL
    : BOSS_WAVE_INTERVAL_AFTER_CURRICULUM;
  return waveNum % interval === 0;
}

/**
 * Lookup the full Template object for a wave (or null on bad waveNum/unknown id).
 */
export function templateObjectForWave(waveNum: number): Template | null {
  const id = templateForWave(waveNum);
  if (!id) return null;
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

// =====================================================================
// Static Wave Fallback Profiles
//
// Concrete enemy composition per wave — used when the AI Wave Director is
// OFF (debug toggle / no model loaded) so the game can still spawn sensible
// waves without any neural-net inference.
//
// Multi-group native: each profile lists one or more enemy groups (analog to
// the Template `enemies: [[id, ratio], …]` shape), so boss waves can carry
// their support waves and mixed-template waves stay mixed at runtime. The
// shape mirrors `WaveEnemyGroup` from `models/wave-config.ts` so it pipes
// straight through `adaptAIWaveConfig` into the WaveManager's one true
// spawn pipeline — no parallel single-type fast path.
//
// Sizing target: ~10-30 seconds per wave against the planned player DPS at
// that wave (see docs/wave-planner.html). Hand-tuned baselines, not optimal.
// =====================================================================

export interface StaticWaveGroup {
  /** Enemy type spawned by this group. */
  enemyType: EnemyTypeId;
  /** Number of enemies in this group. */
  count: number;
  /** HP multiplier applied to the enemy's baseHp (stacks with endgame ramp). */
  hpMult: number;
  /** Optional speed multiplier applied to the enemy's baseSpeed. */
  speedMult?: number;
}

export interface StaticWaveProfile {
  /** Wave number (1-indexed). */
  wave: number;
  /** Enemy groups making up the wave. ≥1 group; multi-group waves get a schedule. */
  groups: readonly StaticWaveGroup[];
  /** Base delay between spawns in ms. */
  spawnDelayMs: number;
  /** Spawn pattern (enemy ordering) — defaults to 'interleaved' when omitted. */
  pattern?: SpawnPattern;
}

export const STATIC_WAVE_PROFILES: readonly StaticWaveProfile[] = [
  // ── Early game (W1-W9): bootstrap, single-armor tests ────────────────
  { wave:  1, groups: [{ enemyType: 'zombie',      count:  20, hpMult: 0.8 }], spawnDelayMs: 1000 },
  { wave:  2, groups: [{ enemyType: 'rat',         count:  60, hpMult: 1.0 }], spawnDelayMs:  400 },
  { wave:  3, groups: [{ enemyType: 'penguin',     count:  25, hpMult: 1.0 }], spawnDelayMs:  500 },
  { wave:  4, groups: [{ enemyType: 'wallsmasher', count:  12, hpMult: 0.7 }], spawnDelayMs:  700 },
  { wave:  5, groups: [{ enemyType: 'wallsmasher', count:  15, hpMult: 0.9 }], spawnDelayMs:  600 },
  { wave:  6, groups: [{ enemyType: 'spider',      count:  35, hpMult: 0.9 }], spawnDelayMs:  450 },
  { wave:  7, groups: [{ enemyType: 'bat',         count:  30, hpMult: 1.0 }], spawnDelayMs:  450 },     // AIR debut
  // W8 mirrors template `hornet_strike` — hornet 70% + bat 30%
  { wave:  8, groups: [
    { enemyType: 'hornet', count: 15, hpMult: 0.9 },
    { enemyType: 'bat',    count:  6, hpMult: 1.0 },
  ], spawnDelayMs: 500, pattern: 'interleaved' },
  // W9 mirrors template `tank_column` — tank 60% + zombie-soldier 40%
  { wave:  9, groups: [
    { enemyType: 'tank',           count:  8, hpMult: 1.2 },
    { enemyType: 'zombie-soldier', count:  6, hpMult: 1.0 },
  ], spawnDelayMs: 800, pattern: 'interleaved' },
  // ── Mid game (W10-W19): boss + first ethereal/fortified ─────────────
  // W10 BOSS 1 — Herbert with tank + zombie support per template `boss_herbert`
  { wave: 10, groups: [
    { enemyType: 'herbert', count:  1, hpMult: 8.0 },
    { enemyType: 'tank',    count: 12, hpMult: 1.0 },
    { enemyType: 'zombie',  count: 18, hpMult: 0.6 },
  ], spawnDelayMs: 700, pattern: 'clustered' },
  { wave: 11, groups: [{ enemyType: 'bear',  count: 10, hpMult: 1.2 }], spawnDelayMs: 850 },
  // W12 mirrors template `dragon_elite` — dragon 60% + hornet 40%
  { wave: 12, groups: [
    { enemyType: 'dragon', count:  6, hpMult: 1.4 },
    { enemyType: 'hornet', count:  4, hpMult: 1.0 },
  ], spawnDelayMs: 1000, pattern: 'interleaved' },
  // W13 mirrors template `ghost_surge` — ghost 80% + wraith 20%
  { wave: 13, groups: [
    { enemyType: 'ghost',  count: 18, hpMult: 1.3 },
    { enemyType: 'wraith', count:  5, hpMult: 1.2 },
  ], spawnDelayMs: 450, pattern: 'interleaved' },     // ETHEREAL intro
  // W14 mirrors template `mammoth_siege` — mammoth 70% + wallsmasher 30%
  { wave: 14, groups: [
    { enemyType: 'mammoth',     count:  6, hpMult: 1.6 },
    { enemyType: 'wallsmasher', count:  4, hpMult: 1.0 },
  ], spawnDelayMs: 1000, pattern: 'interleaved' },
  { wave: 15, groups: [{ enemyType: 'stone-golem', count:  6, hpMult: 1.5 }], spawnDelayMs: 1100 },     // golem squad
  // W16 mirrors template `chaos_wave` — zombie 30% + tank 30% + hornet 20% + bear 20%
  { wave: 16, groups: [
    { enemyType: 'zombie', count: 18, hpMult: 1.0 },
    { enemyType: 'tank',   count: 12, hpMult: 1.5 },
    { enemyType: 'hornet', count:  8, hpMult: 1.2 },
    { enemyType: 'bear',   count:  4, hpMult: 1.0 },
  ], spawnDelayMs: 400, pattern: 'interleaved' },
  { wave: 17, groups: [{ enemyType: 'wraith', count:  30, hpMult: 2.0 }], spawnDelayMs:  280 },
  // W18 mirrors template `armor_gauntlet` — rat 25% + tank 25% + mammoth 25% + ghost 25%
  { wave: 18, groups: [
    { enemyType: 'rat',     count: 20, hpMult: 1.5 },
    { enemyType: 'tank',    count: 10, hpMult: 1.8 },
    { enemyType: 'mammoth', count:  4, hpMult: 1.8 },
    { enemyType: 'ghost',   count: 12, hpMult: 1.5 },
  ], spawnDelayMs: 400, pattern: 'interleaved' },
  // W19 mirrors template `skeleton_swarm`: the rat wave it replaced (500 rats
  // × 5 HP × 2.0 = 5000 HP over 25 s). A skeleton splits into two minions,
  // 20 + 2 × 6 HP at hpMult 1: 310 at 0.5 are 4960 HP in 930 bodies over
  // 24.8 s. Skeletons walk 6 m/s, minions 7, rats 10
  { wave: 19, groups: [{ enemyType: 'skeleton', count: 310, hpMult: 0.5 }], spawnDelayMs:   80 },     // mega-swarm
  // ── Late game (W20-W30): pressure phase, boss spikes ─────────────────
  // W20 BOSS 2 — Herbert with bigger support
  { wave: 20, groups: [
    { enemyType: 'herbert', count:  1, hpMult: 30.0 },
    { enemyType: 'tank',    count: 20, hpMult: 1.8 },
    { enemyType: 'zombie',  count: 24, hpMult: 1.0 },
  ], spawnDelayMs: 600, pattern: 'clustered' },
  { wave: 21, groups: [{ enemyType: 'bat',     count: 150, hpMult: 3.0 }], spawnDelayMs:  100 },
  { wave: 22, groups: [{ enemyType: 'tank',    count:  20, hpMult: 3.5 }], spawnDelayMs:  400 },
  // W23 mirrors template `ghost_surge` at higher pressure
  { wave: 23, groups: [
    { enemyType: 'ghost',  count: 40, hpMult: 3.0 },
    { enemyType: 'wraith', count: 10, hpMult: 2.5 },
  ], spawnDelayMs: 250, pattern: 'interleaved' },
  // W24 mirrors template `dragon_elite` at higher pressure
  { wave: 24, groups: [
    { enemyType: 'dragon', count:  9, hpMult: 3.0 },
    { enemyType: 'hornet', count:  6, hpMult: 2.5 },
  ], spawnDelayMs: 600, pattern: 'interleaved' },
  // W25 mirrors template `mammoth_siege` at higher pressure
  { wave: 25, groups: [
    { enemyType: 'mammoth',     count: 12, hpMult: 3.5 },
    { enemyType: 'wallsmasher', count:  6, hpMult: 2.5 },
  ], spawnDelayMs: 700, pattern: 'interleaved' },
  { wave: 26, groups: [{ enemyType: 'hornet',  count:  80, hpMult: 4.0 }], spawnDelayMs:  150 },
  { wave: 27, groups: [{ enemyType: 'wraith',  count:  80, hpMult: 5.0 }], spawnDelayMs:  200 },
  { wave: 28, groups: [{ enemyType: 'mech',    count:  20, hpMult: 4.0 }], spawnDelayMs:  500 },
  // W29 mirrors template `chaos_wave` at pressure
  { wave: 29, groups: [
    { enemyType: 'zombie', count: 60, hpMult: 4.0 },
    { enemyType: 'tank',   count: 20, hpMult: 4.0 },
    { enemyType: 'hornet', count: 15, hpMult: 3.5 },
    { enemyType: 'bear',   count:  8, hpMult: 3.0 },
  ], spawnDelayMs: 150, pattern: 'interleaved' },
  // W30 BOSS 3 (season finale) — 3 Herberts + heaviest support
  { wave: 30, groups: [
    { enemyType: 'herbert', count:  3, hpMult: 35.0 },
    { enemyType: 'tank',    count: 25, hpMult: 2.5 },
    { enemyType: 'zombie',  count: 30, hpMult: 1.5 },
  ], spawnDelayMs: 600, pattern: 'clustered' },
] as const;

/**
 * Get the static wave profile for `waveNum` (1-indexed). Beyond
 * {@link CURRICULUM_FORCED_THROUGH_WAVE} the profile loops on its own
 * (wave 31 = wave 1, etc.); `templateForWave` does not loop, from there the
 * Wave Director picks freely under the normal mask
 * (docs/STATIC_WAVE_FALLBACK.md). Late-game difficulty escalates via
 * `endgameHpMultiplier` (applied at resolve-time), not via runaway count/hp
 * here.
 */
export function staticWaveProfileForWave(waveNum: number): StaticWaveProfile | null {
  if (waveNum < 1) return null;
  return STATIC_WAVE_PROFILES[(waveNum - 1) % STATIC_WAVE_PROFILES.length];
}

/**
 * Resolve a static profile into an AIWaveConfig (the same shape the AI
 * Director and training-backend emit). The facade pipes the result through
 * `adaptAIWaveConfig` to get the runtime WaveConfig, one spawn pipeline for
 * AI, training, and static fallback. Endgame HP ramp is baked into each
 * group's `healthMultiplier` so post-W20 waves keep escalating even while
 * `STATIC_WAVE_PROFILES` itself loops mod-30; the gold budget does not
 * loop, it tapers instead (`goldBudgetForWave`, docs/STATIC_WAVE_FALLBACK.md).
 *
 * Returns null for waveNum < 1.
 */
export function staticWaveResolvedFor(waveNum: number): AIWaveConfig | null {
  const profile = staticWaveProfileForWave(waveNum);
  if (!profile) return null;
  const endgameHp = endgameHpMultiplier(waveNum);
  const enemies: WaveEnemyGroup[] = profile.groups.map((g) => ({
    type: g.enemyType,
    count: g.count,
    healthMultiplier: g.hpMult * endgameHp,
    speedMultiplier: g.speedMult,
  }));
  const totalCount = enemies.reduce((sum, g) => sum + g.count, 0);
  return {
    enemies,
    totalCount,
    spawnDelay: profile.spawnDelayMs,
    pattern: profile.pattern,
  };
}

/**
 * How fast income decays once the authored build-up is over.
 *
 * Applied per wave past the curriculum, down to GOLD_SUSTAIN_FRACTION.
 */
const GOLD_TAPER_PER_WAVE = 0.5;

/**
 * Floor on post-curriculum income, as a fraction of the last authored wave.
 *
 * Sized against what the run is supposed to buy. The design roster — one tower
 * of each type plus three archers, all upgrade tracks maxed, every research —
 * costs about 1.39M gold. The authored curriculum pays 791k across its 30
 * waves, so the tail has to supply roughly 600k more over a long run and then
 * stop, rather than fund a second army.
 */
const GOLD_SUSTAIN_FRACTION = 0.05;

/**
 * Boss waves past the curriculum pay this multiple of the tapered budget.
 * Inside the curriculum the boss bonus is authored into WAVE_CURRICULUM.
 */
const BOSS_GOLD_MULTIPLIER = 2;

/**
 * Deterministic gold budget for `waveNum` (1-indexed). Within the explicit
 * curriculum (waves 1-30) the values are read directly.
 *
 * Past wave 30 income TAPERS to a sustain level. It used to loop with
 * `templateForWave`, which had two consequences, both bad. Wave 31 dropped from
 * 180,000 gold to 200 and then climbed all over again — incoherent for a player
 * mid-run. And across 100 waves the loop paid out 2.64M against a design roster
 * costing 1.39M, so a defense could reach full build-out and keep going: the
 * training bot ended up at ~6700 DPS covering the whole route, killing 100% of
 * every wave from wave 11 on, which left the wave director nothing to aim at.
 *
 * Tapering instead keeps the curve monotone and lands the 100-wave total near
 * 1.5M — the roster plus a working reserve. Economic pressure survives into the
 * late game, which is where the genre's actual tension lives.
 *
 * (Endgame difficulty still compounds via `endgameHpMultiplier`, not via gold.)
 *
 * Boss waves past the curriculum (every fifth, see isBossWave) pay double.
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
  const scale = Math.max(
    GOLD_SUSTAIN_FRACTION,
    Math.pow(GOLD_TAPER_PER_WAVE, waveNum - len),
  ) * (isBossWave(waveNum) ? BOSS_GOLD_MULTIPLIER : 1);
  return {
    kill: Math.round(last.goldKill * scale),
    complete: Math.round(last.goldComplete * scale),
  };
}
