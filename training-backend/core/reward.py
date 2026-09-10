"""
Reward Calculation — v4, four terms.

  DEATH:   one-shot penalty, measured against the TARGET run length rather than
           in absolute terms, plus a surcharge for wiping the player out of
           healthy HP in a single wave.
  DRAMA:   per-wave excitement, read off `near_miss_ratio` — the fraction of the
           wave that got past 80% of the path without arriving. Leaks are
           charged here on their own slope.
  PACING:  run-length control, read off the player's remaining HP against a
           decay curve.
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
     reads as boring.

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
    OVERKILL_DAMAGE_FRACTION,
    REWARD_OVERKILL,
    # DRAMA
    NEAR_MISS_TARGET,
    NEAR_MISS_SIGMA,
    REWARD_DRAMA_PEAK,
    REWARD_DRAMA_IDLE,
    DRAMA_MIN_COUNT,
    DRAMA_FULL_COUNT,
    REWARD_LEAK_SLOPE,
    REWARD_P90_PROGRESS_WEIGHT,
    # PACING
    PACING_SIGMA,
    PACING_TAIL_SLOPE,
    PACING_SHAPE_CAP,
    REWARD_PACING_PEAK,
    # SWARM_SIZE
    SWARM_SMALL_THRESHOLD,
    SWARM_SMALL_PENALTY,
    SWARM_SIZE_SLOPE,
    SWARM_SIZE_CAP,
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


def _death_penalty(wave_num: int, survived: bool, damage_pct: float) -> float:
    """Cost of ending the run: how early it ended, and how brutally.

    Quadratic in the shortfall so that dying near the target is nearly free
    while dying in the opening waves is catastrophic. At TARGET_RUN_WAVES and
    beyond the shortfall term is exactly 0 — the run reached its intended
    length, and in a game with no win condition that is a finished run, not a
    failure.

    The shortfall term alone is not enough. It decays to -0.6 by wave 70 and
    -0.006 by wave 79, so deleting a player who was at healthy HP in a single
    wave costs nothing there — which is exactly the unfair wipe this design
    exists to rule out, available precisely where the agent has the firepower
    to do it. Reaching the intended length is fine; ending someone from a
    quarter of their HP in one wave is not, whenever it happens.
    """
    if survived:
        return 0.0
    if TARGET_RUN_WAVES <= 0:
        return 0.0
    shortfall = max(0.0, (TARGET_RUN_WAVES - wave_num) / TARGET_RUN_WAVES)
    penalty = REWARD_DEATH_MAX * shortfall * shortfall
    if damage_pct > OVERKILL_DAMAGE_FRACTION:
        penalty += REWARD_OVERKILL
    return penalty


def _drama_reward(near_miss_ratio: float, leak_ratio: float,
                  total_count: int, p90_progress: float = 0.0) -> float:
    """How exciting the wave was, from the upper tail of the progress spread.

    `near_miss_ratio` is the fraction of enemies that got past 80% of the path
    WITHOUT reaching the base. It is the right statistic for three reasons: it
    describes the tail rather than the mean, its step size is 1/count rather
    than the 6%-per-leak of the HP measure, and it is exactly the thing a player
    perceives as a close call.

    Excluding arrivals matters more than it looks. Counting `p > 0.80` scored a
    breach and a near-miss identically, so a wave where a quarter of 200 enemies
    walked into the base — fifty leaks, lethal several times over — read as
    perfectly on target. Leaks are charged here instead, on their own slope.

    That slope also replaces the old overflow guard, which tested
    `avg_progress > 0.95`: the mean, the very statistic this term exists to
    avoid. A wave leaking 40% of its enemies has a mean near 0.6 and sailed
    past that guard untouched.
    """
    # Linear on the way UP to the target, Gaussian on the way down.
    #
    # A pure bell is still 14.5% of its peak at ratio 0 (the target sits 1.4
    # sigma above it), so a wave that threatened nothing at all scored -0.11
    # instead of the full -0.30 idle penalty. Measured consequence: 52.5% of
    # waves parked in that band — cheaper than any attempt that risks a leak,
    # so the policy oscillated between harmless and breach and skipped the
    # near-miss in between.
    #
    # The ramp makes every step toward the target pay, and makes doing nothing
    # cost what it is supposed to cost. Overshooting still falls off on the
    # bell, because a wave where most of the horde is at the gate is a breach
    # in the making, not a better near-miss.
    if near_miss_ratio <= NEAR_MISS_TARGET and NEAR_MISS_TARGET > 0:
        shape = near_miss_ratio / NEAR_MISS_TARGET
    else:
        shape = _bell(near_miss_ratio, NEAR_MISS_TARGET, NEAR_MISS_SIGMA)
    score = REWARD_DRAMA_PEAK * shape + REWARD_DRAMA_IDLE * (1.0 - shape)

    # A ratio is scale-free: one near-misser out of four hits the band as neatly
    # as 25 out of 100. Below DRAMA_MIN_COUNT a wave earns no positive drama at
    # all, and from there credit ramps linearly to DRAMA_FULL_COUNT.
    #
    # sqrt-damping was not enough on its own: five near-missers out of 21
    # enemies still paid +0.71 at no risk, and 48% of measured waves came in at
    # 20 enemies or fewer. Damping only ever applies to a positive score —
    # scaling a PENALTY toward zero would make tiny waves the cheap way out.
    if score > 0:
        if total_count < DRAMA_MIN_COUNT:
            score = 0.0
        elif total_count < DRAMA_FULL_COUNT:
            span = DRAMA_FULL_COUNT - DRAMA_MIN_COUNT
            score *= (total_count - DRAMA_MIN_COUNT) / span

    # Dense tail-shaping so the region below the near-miss threshold is not
    # flat. Without it the agent cannot tell "everything died at 40%" from
    # "everything died at 79%", and both score identically at zero near-miss.
    return (score
            + REWARD_LEAK_SLOPE * leak_ratio
            + REWARD_P90_PROGRESS_WEIGHT * max(0.0, min(1.0, p90_progress)))


def _pacing_reward(wave_num: int, hp_after: float) -> float:
    """How well the run is tracking its intended length.

    This replaces v3's per-wave damage band, and it is the piece that resolves
    the contradiction. HP loss is judged cumulatively against a curve rather
    than per wave against a window, so the 6-HP granularity of a single leak is
    a small step along the curve instead of a jump clean over a 4-point band.

    A PENALTY for drifting off the curve, not a bonus for sitting on it. Paying
    a bonus here reopened the collapse from a new angle: a policy that sent
    nothing still collected the full pacing reward for as long as the player
    happened to be on the curve, so idling scored positive. Being on schedule is
    merely free, and DRAMA is the only term that pays.

    Quadratic inside one sigma, LINEAR beyond it. A Gaussian was the obvious
    shape and the wrong one: past about two sigma it is flat, so the term became
    a constant tax carrying no gradient. Measured at 58.4% of waves pinned to
    exactly -0.60 — the steering signal was dead on the majority of waves, and
    specifically on the ones furthest off the curve, which are the ones that
    most need telling which way to move.

    It is also the term that makes standing still expensive. A client sitting at
    100% HP on wave 92 is far off the curve, so every point of damage improves
    the score — the gradient points at attacking, which under v3 it never did.

    Returns a value in [-REWARD_PACING_PEAK * PACING_SHAPE_CAP, 0].
    """
    err = abs(hp_after - hp_target(wave_num))
    u = err / PACING_SIGMA
    shape = u * u if u <= 1.0 else 1.0 + PACING_TAIL_SLOPE * (u - 1.0)
    return -REWARD_PACING_PEAK * min(shape, PACING_SHAPE_CAP)


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
            nearMissRatio: float,   # 0..1, past 80% path but NOT arrived
            leakRatio: float,       # 0..1, fraction that reached the base
            p90Progress: float,     # 0..1, 90th percentile of path progress
            totalCount: int,        # enemies in the wave
            survived: bool,         # did the bot survive this wave?
            hpAfter: float,         # 0..1, player HP fraction after the wave
            damagePercent: float,   # 0..1, HP fraction lost this wave
        }
        context: {
            wave_number: int,
        }

    Returns:
        (total_reward, breakdown_dict) — breakdown has exactly 4 keys.
    """
    near_miss_ratio = float(wave_result.get("nearMissRatio", 0.0))
    leak_ratio = float(wave_result.get("leakRatio", 0.0))
    total_count = int(wave_result.get("totalCount", 0))
    survived = bool(wave_result.get("survived", True))
    hp_after = float(wave_result.get("hpAfter", 1.0))
    damage_pct = float(wave_result.get("damagePercent", 0.0))
    wave_num = int(context.get("wave_number", 0))

    death = _death_penalty(wave_num, survived, damage_pct)
    p90_progress = float(wave_result.get("p90Progress", 0.0))
    drama = _drama_reward(near_miss_ratio, leak_ratio, total_count, p90_progress)
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
