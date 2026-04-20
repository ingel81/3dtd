"""
Reward Calculation — Damage-Zone + Near-Miss model (2026-04-17 redesign).

Core idea: tension pro Welle kommt aus zwei unabhängigen Quellen.

  (a) Damage-Zone: Bot soll pro Welle 1-10 HP verlieren (sweet), 0 HP ist
      leicht negativ (perfect/langweilig), 26-50 HP steil negativ, >50
      überwältigend.

  (b) Near-Miss-Progress: Enemies die 60-90% des Pfades erreichen erzeugen
      Drama auch bei 0 HP Schaden — rettet "perfect"-Waves.

Progress ≥0.95 → überlaufen, klare Penalty.
Progression über Wave-Nr: survival-bonus wächst linear → AI muss eskalieren.

Episode-Ziel: viele spannende Waves überlebt. Erfolgreich = Bot kommt weit,
pro Wave wenig Schaden, viele Near-Miss-Momente.
"""

import math

from config import (
    # Damage zone
    DAMAGE_SWEET_MIN,
    DAMAGE_SWEET_MAX,
    DAMAGE_NEUTRAL_MAX,
    DAMAGE_HARD_THRESHOLD,
    REWARD_DAMAGE_SWEET_PEAK,
    REWARD_DAMAGE_ZERO,
    REWARD_DAMAGE_HARD_SLOPE,
    # Near-miss
    NEAR_MISS_PROGRESS_LOW,
    NEAR_MISS_PROGRESS_HIGH,
    REWARD_NEAR_MISS_PEAK,
    # Overflow / boring
    OVERFLOW_PROGRESS_THRESHOLD,
    REWARD_OVERFLOW_SLOPE,
    REWARD_BORING_PENALTY,
    REWARD_BORING_THRESHOLD,
    # Survival / game-over
    REWARD_SURVIVAL_BASE,
    REWARD_SURVIVAL_SLOPE,
    REWARD_GAME_OVER_PENALTY,
    REWARD_GAME_OVER_CAP,
    # Variety / diversity
    REWARD_VARIETY_BONUS,
    MONOTONY_PENALTY,
    REWARD_MIXED_PER_GROUP,
    REWARD_ARMOR_MATCH_BONUS_MAX,
    # Armor diversity (new: combat single-category spam)
    ARMOR_MONOTONY_PENALTY,
    ARMOR_MONOTONY_WINDOW,
    REWARD_ARMOR_VARIETY_BONUS,
    ARMOR_VARIETY_WINDOW,
    ENEMY_ARMOR,
    # Phase 5.7: global armor-dominance-share
    ARMOR_DOMINANCE_PENALTY,
    ARMOR_DOMINANCE_THRESHOLD,
    ARMOR_DOMINANCE_WINDOW,
    # Phase 5.6/5.7 additional reward signals
    REWARD_SWARM_COUNT_THRESHOLD,
    REWARD_SWARM_COUNT_SLOPE,
    REWARD_SWARM_COUNT_CAP,
    SMALL_WAVE_PENALTY,
    SMALL_WAVE_THRESHOLD,
    LARGE_ZERO_DAMAGE_PENALTY,
    LARGE_ZERO_DAMAGE_THRESHOLD,
    REWARD_EPISODE_LENGTH_SLOPE,
    REWARD_EPISODE_LENGTH_CAP,
    REWARD_TYPE_DIVERSITY_PER,
    REWARD_TYPE_DIVERSITY_WINDOW,
    REWARD_TYPE_DIVERSITY_CAP,
)


# ─── Piecewise reward components ──────────────────────────────────────────────

def _damage_zone_reward(damage_pct: float, near_miss_score: float) -> float:
    """Reward component based on player HP damage this wave.

    Curve:
        damage == 0          → REWARD_DAMAGE_ZERO (redeemable by near-miss)
        0 < damage < sweet_min → linear ramp-up
        damage ∈ [sweet_min, sweet_max] → REWARD_DAMAGE_SWEET_PEAK (plateau)
        damage ∈ (sweet_max, neutral_max] → linear fall to 0
        damage ∈ (neutral_max, hard_threshold] → linear fall to -REWARD_DAMAGE_SWEET_PEAK×2
        damage > hard_threshold → steep slope

    The zero-damage case is mild because Near-Miss can compensate (drama
    without penalty). If both 0 damage AND boring progress → boring rule fires.
    """
    d = max(0.0, damage_pct)

    if d == 0:
        # Perfect-wave penalty, but compensated by near-miss if drama was present.
        # If enemies got far (near_miss > 0.5), the wave wasn't actually boring.
        redemption = near_miss_score * abs(REWARD_DAMAGE_ZERO)
        return REWARD_DAMAGE_ZERO + redemption

    if d < DAMAGE_SWEET_MIN:
        # Ramp from 0 → peak as damage enters sweet zone
        t = d / DAMAGE_SWEET_MIN
        return REWARD_DAMAGE_SWEET_PEAK * t

    if d <= DAMAGE_SWEET_MAX:
        # Sweet zone plateau
        return REWARD_DAMAGE_SWEET_PEAK

    if d <= DAMAGE_NEUTRAL_MAX:
        # Gentle fall from peak → 0
        span = DAMAGE_NEUTRAL_MAX - DAMAGE_SWEET_MAX
        t = (d - DAMAGE_SWEET_MAX) / span if span > 0 else 1.0
        return REWARD_DAMAGE_SWEET_PEAK * (1 - t)

    if d <= DAMAGE_HARD_THRESHOLD:
        # From 0 down to -2× the sweet peak
        span = DAMAGE_HARD_THRESHOLD - DAMAGE_NEUTRAL_MAX
        t = (d - DAMAGE_NEUTRAL_MAX) / span if span > 0 else 1.0
        return -REWARD_DAMAGE_SWEET_PEAK * 2.0 * t

    # Beyond hard threshold: steep linear slope
    overrun = d - DAMAGE_HARD_THRESHOLD
    return -REWARD_DAMAGE_SWEET_PEAK * 2.0 - REWARD_DAMAGE_HARD_SLOPE * overrun


def _near_miss_reward(near_miss_ratio: float, avg_progress: float) -> float:
    """Reward for enemies reaching the near-miss band (60-90% of path).

    near_miss_ratio from the game is "fraction of enemies with progress>0.80".
    We combine it with avg_progress to check we're in the band (not overflow).

    Returns a bounded contribution [0, REWARD_NEAR_MISS_PEAK].
    """
    if near_miss_ratio <= 0:
        return 0.0
    # Only reward if avg_progress is in the tension band (not saturated).
    if avg_progress >= NEAR_MISS_PROGRESS_HIGH:
        # Already drifting into overflow — attenuate
        overshoot = (avg_progress - NEAR_MISS_PROGRESS_HIGH) / (1.0 - NEAR_MISS_PROGRESS_HIGH)
        attenuation = max(0.0, 1.0 - overshoot)
    elif avg_progress < NEAR_MISS_PROGRESS_LOW:
        # Enemies didn't actually come close to the base; near-miss_ratio
        # counts individual reach but average is too low → soft attenuation
        attenuation = avg_progress / NEAR_MISS_PROGRESS_LOW if NEAR_MISS_PROGRESS_LOW > 0 else 1.0
    else:
        attenuation = 1.0
    # Scale the ratio to reward: saturate at 1.0 enemies > 0.8
    return REWARD_NEAR_MISS_PEAK * min(1.0, near_miss_ratio) * attenuation


def _overflow_penalty(avg_progress: float) -> float:
    """Penalty when progress saturates. Linear above threshold."""
    if avg_progress <= OVERFLOW_PROGRESS_THRESHOLD:
        return 0.0
    return -REWARD_OVERFLOW_SLOPE * (avg_progress - OVERFLOW_PROGRESS_THRESHOLD) / (1.0 - OVERFLOW_PROGRESS_THRESHOLD)


def _survival_bonus(wave_number: int, survived: bool, damage_pct: float) -> float:
    """Bonus for surviving a wave, scaling with wave number (progression).

    Gated on damage_pct >= DAMAGE_SWEET_MIN: zero-damage "trivial" waves no
    longer cash in on the survival ramp. Closes reward-hack where AI learned
    to send empty waves and farm +1.0+ per wave after wave 100.
    """
    if not survived:
        return 0.0
    if damage_pct < DAMAGE_SWEET_MIN:
        return 0.0
    return REWARD_SURVIVAL_BASE + REWARD_SURVIVAL_SLOPE * max(0, wave_number)


def _game_over_penalty(wave_number: int, episode_length: int) -> float:
    """Penalty for dying, softer the later it happened."""
    p = REWARD_GAME_OVER_PENALTY * (episode_length / max(1, wave_number))
    return max(REWARD_GAME_OVER_CAP, p)


# ─── Main reward function ─────────────────────────────────────────────────────

def calculate_reward(result: dict, context: dict, state_before: dict = None, state_after: dict = None) -> tuple[float, dict]:
    """Compute reward + breakdown for a completed wave.

    Inputs from `result` (emitted by the Angular client after a wave):
      - avgPathProgressPercent: avg enemy progress 0..1
      - maxPathProgress: furthest enemy's progress 0..1
      - nearMissRatio: fraction of enemies who reached >0.8 path
      - progressStd: std-dev of per-enemy progress
      - damagePercent: player HP lost as fraction of max HP (0..1)
      - playerSurvived: bool — did the wave not end with game-over
      - perfect / closeCall: bools (legacy flags, not required)
      - enemy_types / enemies: wave composition
    Inputs from `context`:
      - wave_number: current wave (for progression)
      - enemy_types_used / recent_types_flat: variety/monotony tracking
    Output:
      (reward: float, breakdown: dict) — breakdown keys are analyzed by
      inspect_training.py --breakdown to see which signals actually fire.
    """
    # Read result fields (with safe defaults)
    avg_progress = result.get("avgPathProgressPercent", 0)
    near_miss_ratio = result.get("nearMissRatio", 0)
    damage_pct = result.get("damagePercent", 0)
    if damage_pct == 0 and result.get("damage_pct") is not None:
        damage_pct = result.get("damage_pct")
    player_survived = result.get("playerSurvived", True)

    breakdown = {}
    reward = 0.0

    # === (A) DAMAGE-ZONE (primary signal) ===
    damage_component = _damage_zone_reward(damage_pct, near_miss_ratio)
    breakdown["damage_zone"] = round(damage_component, 4)
    reward += damage_component

    # === (B) NEAR-MISS progress drama (independent of damage) ===
    near_miss_component = _near_miss_reward(near_miss_ratio, avg_progress)
    breakdown["near_miss"] = round(near_miss_component, 4)
    reward += near_miss_component

    # === Overflow penalty (runaway progress) ===
    overflow = _overflow_penalty(avg_progress)
    breakdown["overflow"] = round(overflow, 4)
    reward += overflow

    # === Boring — only if BOTH no damage AND low progress ===
    boring_penalty = 0.0
    if damage_pct == 0 and avg_progress < REWARD_BORING_THRESHOLD:
        boring_penalty = REWARD_BORING_PENALTY
        reward += boring_penalty
    breakdown["boring"] = round(boring_penalty, 4)

    # === Survival bonus (scales with wave number — progression) ===
    # Gated on damage_pct >= DAMAGE_SWEET_MIN so zero-damage waves don't farm
    # the wave-number ramp (closed a reward-hack found after 11k episodes).
    wave_number = context.get("wave_number", 1)
    survival = _survival_bonus(wave_number, player_survived, damage_pct)
    breakdown["survival"] = round(survival, 4)
    reward += survival

    # === Game-over penalty ===
    game_over = 0.0
    if not player_survived:
        from config import EPISODE_LENGTH
        game_over = _game_over_penalty(wave_number, EPISODE_LENGTH)
        reward += game_over
    breakdown["game_over"] = round(game_over, 4)

    # === Variety bonus (new enemy types) ===
    variety = 0.0
    enemy_types = result.get("enemy_types", [])
    recent_types = context.get("enemy_types_used", [])
    if recent_types and enemy_types:
        all_recent = [t for wave_types in recent_types[-5:] for t in wave_types]
        unique_recent = set(all_recent)
        unique_now = set(enemy_types)
        new_types = unique_now - unique_recent
        if new_types:
            variety = REWARD_VARIETY_BONUS * min(1.0, len(new_types) / 2.0)
            reward += variety
    breakdown["variety"] = round(variety, 4)

    # === Monotony penalty (Mixed-Wave-aware) ===
    # Fires if EVERY enemy type in the current wave already appeared in the
    # flattened last-N types. I.e. the wave introduces zero new types.
    # This catches mixed-wave spam (e.g. spider+bat wave after several other
    # spider+bat waves) not just single-type repetition.
    monotony = 0.0
    recent_flat = context.get("recent_types_flat", []) or []
    current_types_set = set(enemy_types) if enemy_types else set()
    if current_types_set and len(recent_flat) >= 5:
        recent_window = set(recent_flat[-15:])  # ~5 mixed waves worth
        new_types = current_types_set - recent_window
        if not new_types:
            monotony = MONOTONY_PENALTY
            reward += monotony
    breakdown["monotony"] = round(monotony, 4)

    # === Armor-category monotony (Mixed-Wave-aware) ===
    # recent_armor_categories now carries comma-joined armor-sets per wave
    # (e.g. "light,unarmored" if wave had spider+penguin).
    # Penalty fires if last N waves all had a subset of the same armors AND
    # current wave brings no new category.
    armor_monotony = 0.0
    recent_armors = context.get("recent_armor_categories", []) or []
    current_armors_set = set()
    for t in current_types_set:
        a = ENEMY_ARMOR.get(t)
        if a:
            current_armors_set.add(a)

    if current_armors_set and len(recent_armors) >= ARMOR_MONOTONY_WINDOW:
        # Build union of all armors in last N waves
        recent_window_armors = set()
        for entry in recent_armors[-ARMOR_MONOTONY_WINDOW:]:
            recent_window_armors.update(entry.split(",") if entry else [])
        # Monotony if current wave's armors ⊆ recent-window's armors
        # AND recent window is already narrow (≤2 categories in N waves)
        if current_armors_set.issubset(recent_window_armors) and len(recent_window_armors) <= 2:
            armor_monotony = ARMOR_MONOTONY_PENALTY
            reward += armor_monotony
    breakdown["armor_monotony"] = round(armor_monotony, 4)

    # === Armor-variety bonus (Mixed-Wave-aware) ===
    # Fires when the current wave introduces an armor-category NOT present
    # in ANY of the last N recent-armor-set entries. Encourages conscious
    # rotation into Heavy / Fortified / Ethereal after long light/unarmored runs.
    armor_variety = 0.0
    if current_armors_set and recent_armors:
        recent_variety_armors = set()
        for entry in recent_armors[-ARMOR_VARIETY_WINDOW:]:
            recent_variety_armors.update(entry.split(",") if entry else [])
        new_armors = current_armors_set - recent_variety_armors
        if new_armors:
            armor_variety = REWARD_ARMOR_VARIETY_BONUS
            reward += armor_variety
    breakdown["armor_variety"] = round(armor_variety, 4)

    # === Mixed-diversity bonus ===
    mixed = 0.0
    num_groups = len(result.get("enemies", [])) if "enemies" in result else len(enemy_types)
    if num_groups >= 2:
        # +0.05 per extra group (cap at 3)
        mixed = REWARD_MIXED_PER_GROUP * min(num_groups, 3)
        reward += mixed
    breakdown["mixed"] = round(mixed, 4)

    # === Swarm-Count Bonus (Phase 5.7: continuous scaling) ===
    # Old (binary +0.05 @ count>100) was no match for overflow-penalty up to
    # -1.5 — net collapsed into small-wave local minimum (87% waves in [0-20]
    # after 5742 eps). New: linear scaling up to +1.00 at count=240, gate on
    # damage ≤ NEUTRAL_MAX (25%) so large waves with minor overflow still
    # count, not only damage-sweet.
    swarm_bonus = 0.0
    total_count = 0
    for g in (result.get("enemies") or []):
        total_count += g.get("count", 0)
    if not total_count:
        total_count = result.get("totalCount", 0) or 0
    # Gate (Phase 5.7.1 hotfix): require MINIMUM damage too — not only "not
    # overwhelming". Fixes reward-hack found at Ep ~600: net learned to send
    # 500-rat swarms that bot instantly killed (damage=0) and still collected
    # full +1.00 swarm bonus. Damage must be ≥ SWEET_MIN (1%) so big waves
    # actually pressure the bot.
    if (total_count > REWARD_SWARM_COUNT_THRESHOLD
            and DAMAGE_SWEET_MIN <= damage_pct <= DAMAGE_NEUTRAL_MAX):
        swarm_bonus = min(
            REWARD_SWARM_COUNT_CAP,
            REWARD_SWARM_COUNT_SLOPE * (total_count - REWARD_SWARM_COUNT_THRESHOLD),
        )
        reward += swarm_bonus
    breakdown["swarm_count"] = round(swarm_bonus, 4)

    # === Small-Wave Penalty (Phase 5.7) ===
    # Complements the Swarm-Bonus: tiny waves are actively bad. Together they
    # create a gradient pushing policy out of the "few enemies per type" local
    # minimum. Fires regardless of damage outcome — just bcecause 10 enemies is
    # not a wave, it's a rounding error.
    small_wave_penalty = 0.0
    if total_count > 0 and total_count < SMALL_WAVE_THRESHOLD:
        small_wave_penalty = SMALL_WAVE_PENALTY
        reward += small_wave_penalty
    breakdown["small_wave"] = round(small_wave_penalty, 4)

    # === Large-Zero-Damage Penalty (Phase 5.8) ===
    # Closes the landscape gap: big waves that don't pressure the bot (trivial
    # rat-spam that dies in 1s) used to collect only the generic boring-penalty
    # (−0.30). Now they also pay a fat −0.50 on top, so PPO has a clear
    # gradient away from the "big empty horde" trap that caught the net at
    # Ep 3229 (74% of waves >100 enemies, 70%+ zero-damage).
    # Only fires when count > threshold AND damage < SWEET_MIN (wave was
    # trivial, not "a bit light on damage").
    large_zero_penalty = 0.0
    if total_count > LARGE_ZERO_DAMAGE_THRESHOLD and damage_pct < DAMAGE_SWEET_MIN:
        large_zero_penalty = LARGE_ZERO_DAMAGE_PENALTY
        reward += large_zero_penalty
    breakdown["large_zero_damage"] = round(large_zero_penalty, 4)

    # === Armor-Dominance Penalty (Phase 5.7, global, 30-wave window) ===
    # Local armor-monotony (5-wave window) can't catch "64% light/unarmored
    # over 30 waves with just enough rotation to avoid the local check".
    # This penalises an armor category exceeding THRESHOLD share over the
    # long window, with linear escalation. Uses context's recent_armor_cats
    # (flat list of armor-type strings over last N waves, maintained in server).
    armor_dominance_penalty = 0.0
    recent_armor_flat = context.get("recent_armor_categories_flat", []) or []
    if len(recent_armor_flat) >= ARMOR_DOMINANCE_WINDOW:
        window = recent_armor_flat[-ARMOR_DOMINANCE_WINDOW:]
        total = len(window)
        cat_counts = {}
        for a in window:
            cat_counts[a] = cat_counts.get(a, 0) + 1
        max_share = max(cat_counts.values()) / total if total > 0 else 0.0
        if max_share > ARMOR_DOMINANCE_THRESHOLD:
            # Linear scaling: at exactly threshold → 0, at share=1.0 → full penalty
            overshoot = (max_share - ARMOR_DOMINANCE_THRESHOLD) / (1.0 - ARMOR_DOMINANCE_THRESHOLD)
            armor_dominance_penalty = ARMOR_DOMINANCE_PENALTY * min(1.0, overshoot)
            reward += armor_dominance_penalty
    breakdown["armor_dominance"] = round(armor_dominance_penalty, 4)

    # === Episode-Length Bonus ===
    # +0.005 × wave_num (capped). Rewards late-game survival.
    # Wave 10 → +0.05, Wave 50 → +0.25, Wave 60+ → cap at +0.30.
    # Gated on damage_pct >= DAMAGE_SWEET_MIN (same reward-hack fix as
    # survival bonus): empty waves must not farm the wave-number ramp.
    episode_bonus = 0.0
    if player_survived and damage_pct >= DAMAGE_SWEET_MIN:
        episode_bonus = min(
            REWARD_EPISODE_LENGTH_CAP,
            REWARD_EPISODE_LENGTH_SLOPE * max(0, wave_number),
        )
        reward += episode_bonus
    breakdown["episode_length"] = round(episode_bonus, 4)

    # === Type-Diversity Score (long-term variety) ===
    # Counts unique types seen in last N waves; +0.02 per unique beyond 5,
    # capped at +0.10. Long-term pressure to actually rotate the roster
    # instead of just single-wave variety jumps.
    diversity_bonus = 0.0
    if recent_types:
        all_recent = [t for wave_types in recent_types[-REWARD_TYPE_DIVERSITY_WINDOW:] for t in wave_types]
        unique_count = len(set(all_recent))
        if unique_count > 5:
            diversity_bonus = min(
                REWARD_TYPE_DIVERSITY_CAP,
                REWARD_TYPE_DIVERSITY_PER * (unique_count - 5),
            )
            reward += diversity_bonus
    breakdown["type_diversity"] = round(diversity_bonus, 4)

    # === Armor-match bonus (small tactical signal) ===
    # If the wave's armor distribution skews toward types the bot's damage
    # matrix handles poorly, award a small bonus. Purely optional — kept
    # tiny so it doesn't override the core signals.
    armor_match = 0.0
    armor_dist = result.get("armorDist") or result.get("armor_dist")
    bot_damage = result.get("dpsByType") or result.get("dps_by_type")
    if armor_dist and bot_damage:
        armor_match = _armor_match_bonus(armor_dist, bot_damage)
        reward += armor_match
    breakdown["armor_match"] = round(armor_match, 4)

    return reward, breakdown


# Damage matrix (must match frontend: damage_type → armor_type → multiplier).
# Lower multiplier = poorer match for the attacker; we reward when the AI
# stacks armors that the bot's tower-damage mix has trouble with.
DAMAGE_MATRIX = {
    "physical": {"unarmored": 1.0, "light": 1.0, "heavy": 0.5, "fortified": 0.3, "ethereal": 0.0},
    "pierce":   {"unarmored": 1.25, "light": 1.5, "heavy": 1.0, "fortified": 0.7, "ethereal": 0.0},
    "siege":    {"unarmored": 0.7, "light": 1.0, "heavy": 1.5, "fortified": 1.5, "ethereal": 0.0},
    "magic":    {"unarmored": 1.0, "light": 1.0, "heavy": 1.0, "fortified": 1.0, "ethereal": 1.5},
    "fire":     {"unarmored": 1.25, "light": 1.25, "heavy": 1.0, "fortified": 0.7, "ethereal": 0.0},
    "ice":      {"unarmored": 1.0, "light": 1.0, "heavy": 1.0, "fortified": 1.0, "ethereal": 1.0},
    "poison":   {"unarmored": 1.5, "light": 1.0, "heavy": 0.5, "fortified": 0.3, "ethereal": 0.0},
}


def _armor_match_bonus(armor_dist: dict, bot_damage_by_type: dict) -> float:
    """Award AI for picking armor mix that resists the bot's damage types.

    Computes expected damage multiplier under the bot's damage-type mix.
    If weighted multiplier < 1.0, bot deals below-baseline damage →
    AI found a tactical weakness → small bonus.
    """
    total_bot_dps = sum(bot_damage_by_type.values()) or 1.0
    damage_weights = {k: v / total_bot_dps for k, v in bot_damage_by_type.items()}

    expected_multiplier = 0.0
    for armor_type, armor_frac in armor_dist.items():
        if armor_frac <= 0:
            continue
        for dmg_type, weight in damage_weights.items():
            mult = DAMAGE_MATRIX.get(dmg_type, {}).get(armor_type, 1.0)
            expected_multiplier += armor_frac * weight * mult

    # Bonus scales linearly with how far below 1.0 (= baseline match) we are.
    # Capped at REWARD_ARMOR_MATCH_BONUS_MAX.
    if expected_multiplier >= 1.0:
        return 0.0
    deficit = 1.0 - expected_multiplier
    return min(REWARD_ARMOR_MATCH_BONUS_MAX, REWARD_ARMOR_MATCH_BONUS_MAX * deficit)


# ─── Legacy helper (kept to avoid import breakage) ────────────────────────────

def estimate_player_skill(recent_damages: list, recent_win_streak: int) -> float:
    """Estimate player skill from recent performance (0-1)."""
    if not recent_damages:
        return 0.5
    avg_damage = sum(recent_damages) / len(recent_damages)
    damage_skill = 1 - avg_damage
    streak_bonus = min(0.2, recent_win_streak * 0.04)
    return min(1, max(0, damage_skill + streak_bonus))
