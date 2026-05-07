"""
Reward Calculation — Phase 5.10 Template-Based (4 Terms)

Minimal 4-term reward after the Phase 5.10 big-wurf overhaul.

  DEATH:        one-shot penalty when player's lives hit 0. Scaled so
                early-game death hurts more than late-game death.
  DRAMA:        merged damage-zone + path-progress. Player should take
                mild damage (1-10%) while enemies get far on the path
                (65-90%). Overflow (>95%) is penalized.
  SWARM_SIZE:   continuous bonus scaling with enemy count. Rewards actual
                swarms (cap at ~2700 enemies). Small waves (<20) penalized.
  PROGRESSION:  survival bonus scaling with wave number. Gated on minimal
                damage so boring low-damage runs don't farm progression.

Hard Constraints (Monotony, Armor-Dominance, Fairness) live in the decoder
(server.py::_decode_action). Reward is only about the 3 user goals:
  1. Player survives
  2. Enemies come far + minimal damage
  3. Large swarms with matching enemies
"""

from config import (
    # DEATH
    REWARD_GAME_OVER_PENALTY,
    REWARD_GAME_OVER_CAP,
    # DRAMA — damage
    DAMAGE_SWEET_MIN,
    DAMAGE_SWEET_MAX,
    DAMAGE_HARD_THRESHOLD,
    REWARD_DAMAGE_SWEET_PEAK,
    REWARD_DAMAGE_ZERO_PENALTY,
    REWARD_DAMAGE_HARD_SLOPE,
    # DRAMA — progress
    PROGRESS_NEAR_MISS_LOW,
    PROGRESS_NEAR_MISS_HIGH,
    PROGRESS_OVERFLOW_THRESHOLD,
    REWARD_NEAR_MISS_PEAK,
    REWARD_OVERFLOW,
    REWARD_PROGRESS_SLOPE,
    # SWARM_SIZE
    SWARM_SMALL_THRESHOLD,
    SWARM_SMALL_PENALTY,
    SWARM_SIZE_SLOPE,
    SWARM_SIZE_CAP,
    # PROGRESSION
    PROGRESSION_SLOPE,
    PROGRESSION_CAP,
)


def _death_penalty(wave_num: int, survived: bool) -> float:
    """One-shot death penalty. Harsher when bot dies early."""
    if survived:
        return 0.0
    # Base -0.3 scaled by 10 → -3.0; × early-game factor; capped at -3.5
    early_scaling = max(0.5, 1.0 - wave_num * 0.02)
    value = REWARD_GAME_OVER_PENALTY * 10 * early_scaling
    return max(REWARD_GAME_OVER_CAP, value)


def _drama_reward(damage_pct: float, avg_progress: float) -> float:
    """Drama = damage-zone + path-progress, merged into one signal.

    Phase 5.11: sweet zone tightened to 1-5% HP loss for "permanent fordernd".
    Zero-damage waves now cost REWARD_DAMAGE_ZERO_PENALTY (−0.10) so the NN
    has a gradient toward "at least a bit of damage every wave".
    """
    # Damage sub-component
    if damage_pct < DAMAGE_SWEET_MIN:
        damage_score = REWARD_DAMAGE_ZERO_PENALTY   # below 1% = boring
    elif damage_pct <= DAMAGE_SWEET_MAX:
        damage_score = REWARD_DAMAGE_SWEET_PEAK     # 1-5% = sweet peak
    elif damage_pct <= DAMAGE_HARD_THRESHOLD:
        damage_score = 0.0                          # 5-20% = neutral band
    else:
        overrun = damage_pct - DAMAGE_HARD_THRESHOLD
        damage_score = -1.0 * REWARD_DAMAGE_HARD_SLOPE * overrun  # >20% = penalty

    # Progress sub-component
    if avg_progress > PROGRESS_OVERFLOW_THRESHOLD:
        progress_score = REWARD_OVERFLOW
    elif PROGRESS_NEAR_MISS_LOW <= avg_progress <= PROGRESS_NEAR_MISS_HIGH:
        progress_score = REWARD_NEAR_MISS_PEAK
    else:
        progress_score = avg_progress * REWARD_PROGRESS_SLOPE

    return damage_score + progress_score


def _swarm_size_reward(total_count: int, damage_pct: float,
                        avg_progress: float, survived: bool) -> float:
    """Continuous bonus for wave size, gated on wave quality.

    Phase 5.11 hotfix: ungated swarm_size got over-exploited — NN sent 2000
    zombies knowing they'd ALL overflow, scoring +4.67 swarm vs −3.39 drama
    for net +1.28 per wave, while the bot actually lost every wave. The gate
    removes the bonus on waves that failed the user's goals ("player lives,
    enemies come far with minimal damage") so the NN has to learn to hit the
    drama-sweet first, then maximise count within that envelope.
    """
    if total_count <= SWARM_SMALL_THRESHOLD:
        return SWARM_SMALL_PENALTY

    # Gate conditions — any failure → swarm-bonus neutralised.
    if not survived:
        return 0.0
    if avg_progress > PROGRESS_OVERFLOW_THRESHOLD:
        return 0.0  # everyone reached base → "big wave" is meaningless
    if damage_pct > DAMAGE_HARD_THRESHOLD:
        return 0.0  # wave too hard → already penalised by DRAMA

    over = total_count - SWARM_SMALL_THRESHOLD
    return min(SWARM_SIZE_CAP, SWARM_SIZE_SLOPE * over)


def _progression_bonus(wave_num: int, survived: bool, damage_pct: float) -> float:
    """Wave-number progression bonus. Gated on survival + minimal damage."""
    if not survived:
        return 0.0
    if damage_pct < DAMAGE_SWEET_MIN:
        # Boring zero-damage wave — no progression credit
        return 0.0
    return min(PROGRESSION_CAP, PROGRESSION_SLOPE * wave_num)


def calculate_reward(wave_result: dict, context: dict) -> tuple[float, dict]:
    """
    Compute reward for a completed wave.

    Args:
        wave_result: {
            damagePercent: float,   # 0..1, fraction of max HP lost this wave
            totalCount: int,        # enemies in the wave
            enemies: list,          # unused in Phase 5.10 reward
            survived: bool,         # did bot survive this wave?
            avgProgress: float,     # 0..1, mean enemy path-progress at death
        }
        context: {
            wave_number: int,
        }

    Returns:
        (total_reward, breakdown_dict) — breakdown has exactly 4 keys.
    """
    damage_pct = float(wave_result.get("damagePercent", 0.0))
    total_count = int(wave_result.get("totalCount", 0))
    survived = bool(wave_result.get("survived", True))
    avg_progress = float(wave_result.get("avgProgress", 0.0))
    wave_num = int(context.get("wave_number", 0))

    death = _death_penalty(wave_num, survived)
    drama = _drama_reward(damage_pct, avg_progress)
    swarm = _swarm_size_reward(total_count, damage_pct, avg_progress, survived)
    progression = _progression_bonus(wave_num, survived, damage_pct)

    total = death + drama + swarm + progression

    breakdown = {
        "death": round(death, 4),
        "drama": round(drama, 4),
        "swarm_size": round(swarm, 4),
        "progression": round(progression, 4),
    }
    return total, breakdown
