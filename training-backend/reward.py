"""
Reward Calculation — 4 terms.

  DEATH:        one-shot penalty when the player's lives hit 0. Scaled so an
                early-game death hurts more than a late-game one.
  DRAMA:        merged damage-zone + path-progress. The player should take
                mild damage (1-5% of max HP) while enemies get far along the
                path (65-90%). Overflow (>95%) is penalised.
  SWARM_SIZE:   continuous bonus scaling with enemy count, gated on the wave
                actually having been survived well. Saturates at 1353 enemies
                (SWARM_SIZE_CAP / SWARM_SIZE_SLOPE + SWARM_SMALL_THRESHOLD).
                Waves under 20 enemies are penalised.
  PROGRESSION:  survival bonus scaling with wave number. Gated on minimal
                damage so boring zero-damage runs cannot farm it.

What constrains the waves themselves is NOT in here:
  - which template may run at all → the availability mask
    (schema.get_available_template_mask): curriculum, min-wave gates,
    capability requirements, reuse cooldown, boss cadence.
  - how big/hard a wave may get → the decoder (server.py::_decode_action):
    DPS ramp on count and HP, the 3-minute duration cap, the spawn-delay floor.

Earlier revisions also had monotony and armor-dominance rules in the decoder;
those were removed when the template system replaced free enemy composition,
because a template already fixes the armor mix and the cooldown already blocks
repeats. The reward is therefore only about the three goals:
  1. the player survives
  2. enemies get far, with minimal damage
  3. large swarms of matching enemies
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
    """One-shot death penalty, harsher when the run ends early.

    REWARD_GAME_OVER_PENALTY is the per-wave-equivalent cost; the x10 turns it
    into a run-ending one. At the current constants that lands between -15
    (late) and -30 (wave 1, where the cap binds), which is what the discounted
    trajectory needs to outweigh the waves that produced the death.
    """
    if survived:
        return 0.0
    early_scaling = max(0.5, 1.0 - wave_num * 0.02)
    value = REWARD_GAME_OVER_PENALTY * 10 * early_scaling
    return max(REWARD_GAME_OVER_CAP, value)


def _drama_reward(damage_pct: float, avg_progress: float) -> float:
    """Drama = damage-zone + path-progress, merged into one signal.

    The sweet zone is 1-5% HP loss — "permanently demanding" without being
    punishing. Zero-damage waves cost REWARD_DAMAGE_ZERO_PENALTY (-0.10) so the
    net has a gradient toward "at least a little damage every wave" instead of
    settling on trivially clearable hordes.
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

    # Progress sub-component.
    #
    # The near-miss peak is gated on the wave having actually cost the player
    # something, exactly as the swarm and progression bonuses already are.
    # Ungated it was the cheapest reward in the function: a huge wave that walks
    # to 90% of the path and dies there scored -0.10 (no damage) +0.50
    # (near-miss) + swarm + progression, so the net learned to avoid damage
    # entirely. Observed directly — rolling reward climbed to +0.65 while the
    # share of waves in the 1-5% damage band collapsed from 63% to 6%.
    #
    # Below the sweet minimum the wave still earns the mild slope, so getting
    # enemies far remains worth something and the gradient stays smooth.
    if avg_progress > PROGRESS_OVERFLOW_THRESHOLD:
        progress_score = REWARD_OVERFLOW
    elif (
        PROGRESS_NEAR_MISS_LOW <= avg_progress <= PROGRESS_NEAR_MISS_HIGH
        and DAMAGE_SWEET_MIN <= damage_pct <= DAMAGE_SWEET_MAX
    ):
        progress_score = REWARD_NEAR_MISS_PEAK
    else:
        progress_score = avg_progress * REWARD_PROGRESS_SLOPE

    return damage_score + progress_score


def _swarm_size_reward(total_count: int, damage_pct: float,
                        avg_progress: float, survived: bool) -> float:
    """Continuous bonus for wave size, gated on wave quality.

    Ungated, this term was heavily exploited: the net sent 2000 zombies knowing
    they would ALL overflow, scoring +4.67 swarm against -3.39 drama for a net
    +1.28 per wave while the bot lost every single one. The gates below remove
    the bonus from any wave that failed the actual goals, so the net has to hit
    the drama sweet spot first and only then maximise count inside that
    envelope.
    """
    if total_count <= SWARM_SMALL_THRESHOLD:
        return SWARM_SMALL_PENALTY

    # Gates. These used to be one-sided — survived, progress <= 0.95,
    # damage <= 0.20 — with no MINIMUM on either. That left a completely safe
    # exploit: drip-feed ~1350 weak enemies that all die at 20% of the path.
    # Zero damage, zero risk, and the full bonus every single wave, which beat
    # actually hitting the narrow 1-5% damage band. Size is meant to break ties
    # inside the drama envelope, so it now only pays inside that envelope.
    if not survived:
        return 0.0
    if avg_progress > PROGRESS_OVERFLOW_THRESHOLD:
        return 0.0  # everyone reached base → "big wave" is meaningless
    if damage_pct < DAMAGE_SWEET_MIN or damage_pct > DAMAGE_SWEET_MAX:
        return 0.0  # outside the band this term has nothing to reward
    if avg_progress < PROGRESS_NEAR_MISS_LOW:
        return 0.0  # died early on the path → not a threatening swarm

    over = total_count - SWARM_SMALL_THRESHOLD
    return min(SWARM_SIZE_CAP, SWARM_SIZE_SLOPE * over)


def _progression_bonus(wave_num: int, survived: bool, damage_pct: float,
                       avg_progress: float) -> float:
    """Wave-number progression bonus, gated on the wave being a good one.

    The upper bound matters as much as the lower one: with only a `>= 0.01`
    gate, a wave costing 15% of the player's HP still collected full
    progression credit. Sustained, that kills the player in about seven waves —
    which is exactly where runs were dying.
    """
    if not survived:
        return 0.0
    if damage_pct < DAMAGE_SWEET_MIN or damage_pct > DAMAGE_SWEET_MAX:
        return 0.0
    if avg_progress > PROGRESS_OVERFLOW_THRESHOLD:
        # Everyone reached the base. Surviving that is luck, not pacing.
        return 0.0
    return min(PROGRESSION_CAP, PROGRESSION_SLOPE * wave_num)


def calculate_reward(wave_result: dict, context: dict) -> tuple[float, dict]:
    """
    Compute reward for a completed wave.

    Args:
        wave_result: {
            damagePercent: float,   # 0..1, fraction of max HP lost this wave
            totalCount: int,        # enemies in the wave
            survived: bool,         # did the bot survive this wave?
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
    progression = _progression_bonus(wave_num, survived, damage_pct, avg_progress)

    total = death + drama + swarm + progression

    breakdown = {
        "death": round(death, 4),
        "drama": round(drama, 4),
        "swarm_size": round(swarm, 4),
        "progression": round(progression, 4),
    }
    return total, breakdown
