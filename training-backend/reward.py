"""
Reward Calculation — v4, four terms.

  DEATH:   one-shot penalty, measured against the TARGET run length rather than
           in absolute terms. The run is supposed to end; ending it on schedule
           is free, ending it at wave 10 is not.
  DRAMA:   per-wave excitement, read off `near_miss_ratio` — the fraction of the
           wave that got past 80% of the path. A Gaussian around a target band,
           damped for waves too small to make the ratio meaningful.
  PACING:  run-length control, read off the player's remaining HP against a
           decay curve. This is where "how hard should waves hit" now lives.
  SWARM:   tiebreaker inside the drama envelope. Never the goal.

Why v3 was replaced (measured over ~9900 episodes, four parallel clients):

  v3 asked for 1-5% HP loss *per wave* and gated three of its four terms on
  that band. Three things made that unsatisfiable:

  1. Leak damage is `1 + floor((w-1)/10)` HP out of 100, so damage is quantised.
     From wave 51 one leak is 6% and zero leaks is 0% — the band contains no
     achievable value, and the three gated terms went permanently to zero.
  2. The player never heals and the game never ends. 100 HP is the whole run's
     budget, so sustaining 1-5% per wave IS the death that the DEATH term
     punished at -15..-30. The reward's optimum and its penalty pointed in
     opposite directions.
  3. Drama was read off the MEAN path progress, which the bulk of early-dying
     enemies dominates. A wave of 270 rats where five reach 95% scores 0.1 and
     read as boring.

  The agent's response was correct play: it collected a guaranteed -0.08 per
  wave by sending nothing. Measured `avgProgress50` of 0.06-0.27 against a
  0.65-0.90 target, `avgDamage50` of 0.000 on two of four clients, and one
  client at a 133-wave streak without losing a single HP.

What still constrains the waves themselves is NOT in here:
  - which template may run at all → the availability mask
    (schema.get_available_template_mask): curriculum, min-wave gates,
    capability requirements, reuse cooldown, boss cadence.
  - how big/hard a wave may get → the decoder (server.py::_decode_action):
    DPS ramp on count and HP, the 3-minute duration cap, the spawn-delay floor,
    the fairness gate.
"""

import math

from config import (
    # DEATH
    TARGET_RUN_WAVES,
    REWARD_DEATH_MAX,
    # DRAMA
    NEAR_MISS_TARGET,
    NEAR_MISS_SIGMA,
    REWARD_DRAMA_PEAK,
    REWARD_DRAMA_IDLE,
    DRAMA_FULL_COUNT,
    # PACING
    PACING_SIGMA,
    REWARD_PACING_PEAK,
    # SWARM_SIZE
    SWARM_SMALL_THRESHOLD,
    SWARM_SMALL_PENALTY,
    SWARM_SIZE_SLOPE,
    SWARM_SIZE_CAP,
    # OVERFLOW
    PROGRESS_OVERFLOW_THRESHOLD,
    REWARD_OVERFLOW,
)


def _bell(value: float, target: float, sigma: float) -> float:
    """Gaussian in [0,1], peaking at `target`.

    Used instead of v3's hard bands so that every wave — including a bad one —
    carries a gradient saying which direction is better. v3's step functions
    returned the same number across a whole region, so most waves told the
    policy nothing at all.
    """
    d = (value - target) / sigma
    return math.exp(-d * d)


def hp_target(wave_num: int) -> float:
    """Where the player's HP fraction should be after `wave_num` waves.

    Linear from 1.0 to 0.0 across TARGET_RUN_WAVES. The player cannot heal, so
    this is the only shape that both ends the run and stays monotone.
    """
    if TARGET_RUN_WAVES <= 0:
        return 0.0
    return max(0.0, 1.0 - wave_num / TARGET_RUN_WAVES)


def _death_penalty(wave_num: int, survived: bool) -> float:
    """Cost of ending the run, scaled by how early it ended.

    Quadratic in the shortfall so that dying near the target is nearly free
    while dying in the opening waves is catastrophic. At TARGET_RUN_WAVES and
    beyond this is exactly 0: the run reached its intended length.
    """
    if survived:
        return 0.0
    if TARGET_RUN_WAVES <= 0:
        return 0.0
    shortfall = max(0.0, (TARGET_RUN_WAVES - wave_num) / TARGET_RUN_WAVES)
    return REWARD_DEATH_MAX * shortfall * shortfall


def _drama_reward(near_miss_ratio: float, avg_progress: float,
                  total_count: int) -> float:
    """How exciting the wave was, from the upper tail of the progress spread.

    `near_miss_ratio` is the fraction of enemies that got past 80% of the path.
    It is the right statistic for three reasons: it describes the tail rather
    than the mean, its step size is 1/count rather than the 6%-per-leak of the
    HP measure, and it is exactly the thing a player perceives as a close call.

    An overflowing wave short-circuits this. Everyone reaching the base is a
    breach, and a breach has a near_miss_ratio of 1.0 that would otherwise be
    scored on the same curve as a genuine near-miss.
    """
    if avg_progress > PROGRESS_OVERFLOW_THRESHOLD:
        return REWARD_OVERFLOW

    bell = _bell(near_miss_ratio, NEAR_MISS_TARGET, NEAR_MISS_SIGMA)
    score = REWARD_DRAMA_PEAK * bell + REWARD_DRAMA_IDLE * (1.0 - bell)

    # A ratio is scale-free: one leaker out of four hits the band as neatly as
    # 25 out of 100. Damp waves too small for the ratio to mean anything, so
    # the band cannot be farmed with a handful of enemies. Square-root so the
    # damping is gentle — boss templates legitimately run at count 10.
    if DRAMA_FULL_COUNT > 0 and total_count < DRAMA_FULL_COUNT:
        scale = math.sqrt(max(0, total_count) / DRAMA_FULL_COUNT)
        # Only damp a positive score. Scaling a penalty toward zero would make
        # tiny waves the cheap way to avoid one.
        if score > 0:
            score *= scale

    return score


def _pacing_reward(wave_num: int, hp_after: float) -> float:
    """How well the run is tracking its intended length.

    This replaces v3's per-wave damage band, and it is the piece that resolves
    the contradiction. HP loss is judged cumulatively against a curve rather
    than per wave against a window, so the 6-HP granularity of a single leak is
    a small step along the curve instead of a jump clean over a 4-point band.

    It is also the term that makes standing still expensive. A client sitting at
    100% HP on wave 92 is maximally far from the curve, so every point of damage
    improves the score — the gradient points at attacking, which under v3 it
    never did.

    Returns a value in [-REWARD_PACING_PEAK, 0].
    """
    err = hp_after - hp_target(wave_num)
    # A PENALTY for being off the curve, not a bonus for being on it. Paying a
    # bonus here re-opened the collapse from a new angle: a policy that sent
    # nothing still collected the full pacing reward for as long as the player
    # happened to sit on the curve, so idling scored positive. Being on schedule
    # is now merely free, and DRAMA is the only term that pays.
    return REWARD_PACING_PEAK * (_bell(err, 0.0, PACING_SIGMA) - 1.0)


def _swarm_size_reward(total_count: int, drama: float) -> float:
    """Continuous bonus for wave size, gated on the wave being a good one.

    Ungated, this term was heavily exploited: the net sent 2000 enemies knowing
    they would all overflow, scoring +4.67 swarm against -3.39 drama for a net
    +1.28 per wave while the bot lost every wave. v3 fixed that by gating on the
    damage band; since that band is gone, the gate is now drama itself, which is
    what the band was standing in for.
    """
    if total_count <= SWARM_SMALL_THRESHOLD:
        return SWARM_SMALL_PENALTY
    if drama <= 0:
        return 0.0
    over = total_count - SWARM_SMALL_THRESHOLD
    return min(SWARM_SIZE_CAP, SWARM_SIZE_SLOPE * over)


def calculate_reward(wave_result: dict, context: dict) -> tuple[float, dict]:
    """
    Compute reward for a completed wave.

    Args:
        wave_result: {
            nearMissRatio: float,   # 0..1, fraction of enemies past 80% path
            avgProgress: float,     # 0..1, mean enemy path-progress at death
            totalCount: int,        # enemies in the wave
            survived: bool,         # did the bot survive this wave?
            hpAfter: float,         # 0..1, player HP fraction after the wave
        }
        context: {
            wave_number: int,
        }

    Returns:
        (total_reward, breakdown_dict) — breakdown has exactly 4 keys.
    """
    near_miss_ratio = float(wave_result.get("nearMissRatio", 0.0))
    avg_progress = float(wave_result.get("avgProgress", 0.0))
    total_count = int(wave_result.get("totalCount", 0))
    survived = bool(wave_result.get("survived", True))
    hp_after = float(wave_result.get("hpAfter", 1.0))
    wave_num = int(context.get("wave_number", 0))

    death = _death_penalty(wave_num, survived)
    drama = _drama_reward(near_miss_ratio, avg_progress, total_count)
    pacing = _pacing_reward(wave_num, hp_after)
    swarm = _swarm_size_reward(total_count, drama)

    total = death + drama + pacing + swarm

    breakdown = {
        "death": round(death, 4),
        "drama": round(drama, 4),
        "pacing": round(pacing, 4),
        "swarm_size": round(swarm, 4),
    }
    return total, breakdown
