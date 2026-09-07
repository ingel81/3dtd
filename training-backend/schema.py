"""
AI Schema Loader — reads the contract generated from the TypeScript configs.

`training-backend/generated/ai-schema.json` is written by `npm run ai-schema`
(see `tools/ai-schema/generate.spec.ts`) and is the ONLY place enemy tables,
wave templates, the curriculum sequence and the feature-block sizes are
defined. Nothing in this package hand-maintains a second copy — that
duplication is exactly what drifted for three months between `templates.py`
and `templates.ts`.

If the file is missing or its schema version is not the one this code was
written against, we fail loudly at import time rather than silently training
against a stale vocabulary.
"""

import json
from pathlib import Path
from typing import Any, Optional

# Schema version this backend understands. Bumped together with
# AI_SCHEMA_VERSION in src/app/ai/core/ai-schema.ts whenever a feature order
# or block size changes (which invalidates every checkpoint).
EXPECTED_SCHEMA_VERSION = 3

SCHEMA_PATH = Path(__file__).parent / "generated" / "ai-schema.json"


def _load() -> dict[str, Any]:
    if not SCHEMA_PATH.exists():
        raise RuntimeError(
            f"AI schema not found at {SCHEMA_PATH}.\n"
            f"Generate it from the game configs first:  npm run ai-schema"
        )
    with SCHEMA_PATH.open("r", encoding="utf-8") as fh:
        data = json.load(fh)

    version = data.get("schemaVersion")
    if version != EXPECTED_SCHEMA_VERSION:
        raise RuntimeError(
            f"AI schema version mismatch: file has v{version}, this backend "
            f"expects v{EXPECTED_SCHEMA_VERSION}. Either regenerate the schema "
            f"(`npm run ai-schema`) or update EXPECTED_SCHEMA_VERSION in "
            f"schema.py — the latter invalidates existing checkpoints."
        )
    return data


SCHEMA: dict[str, Any] = _load()


# === STATE LAYOUT ===
INPUT_SIZE: int = SCHEMA["state"]["inputSize"]
NUM_SCALAR: int = SCHEMA["state"]["numScalar"]
NUM_SPATIAL: int = SCHEMA["state"]["numSpatial"]
NUM_BINS: int = SCHEMA["state"]["numBins"]
NUM_TEMPLATE_RANGE_FEATURES: int = SCHEMA["state"]["templateRangeFeatures"]

# === ORDERED VOCABULARIES (positional — order is the contract) ===
ENEMY_TYPES: list[str] = list(SCHEMA["orders"]["enemies"])
TOWER_TYPES: list[str] = list(SCHEMA["orders"]["towers"])
DAMAGE_TYPES: list[str] = list(SCHEMA["orders"]["damageTypes"])
ARMOR_TYPES: list[str] = list(SCHEMA["orders"]["armorTypes"])
NUM_ENEMY_TYPES: int = len(ENEMY_TYPES)

# === ENEMY STATS ===
_ENEMIES: list[dict[str, Any]] = SCHEMA["enemies"]
ENEMY_BASE_HP: dict[str, float] = {e["id"]: e["baseHp"] for e in _ENEMIES}
ENEMY_ARMOR: dict[str, str] = {e["id"]: e["armor"] for e in _ENEMIES}
ENEMY_THREAT: dict[str, float] = {e["id"]: e["threat"] for e in _ENEMIES}
ENEMY_BASE_SPEED: dict[str, float] = {e["id"]: e["baseSpeed"] for e in _ENEMIES}
AIR_ENEMIES: set[str] = {e["id"] for e in _ENEMIES if e["isAir"]}
ETHEREAL_ENEMIES: set[str] = {e["id"] for e in _ENEMIES if e["armor"] == "ethereal"}

# === NORMALISATION CEILINGS ===
MAX_VALUES: dict[str, float] = dict(SCHEMA["maxValues"])

# === TEMPLATES ===
MAX_TEMPLATE_SLOTS: int = SCHEMA["templates"]["maxSlots"]
NUM_ACTIVE_TEMPLATES: int = SCHEMA["templates"]["activeCount"]
TEMPLATE_COOLDOWN_WAVES: int = SCHEMA["templates"]["cooldownWaves"]
TEMPLATES: list[dict[str, Any]] = SCHEMA["templates"]["list"]

# === CURRICULUM ===
CURRICULUM_SEQUENCE: list[str] = list(SCHEMA["curriculum"]["sequence"])
CURRICULUM_FORCED_THROUGH_WAVE: int = SCHEMA["curriculum"]["forcedThroughWave"]

# === DECODER CONSTANTS ===
MAX_WAVE_DURATION_MS: int = SCHEMA["decoder"]["maxWaveDurationMs"]
MIN_SPAWN_DELAY_MS: int = SCHEMA["decoder"]["minSpawnDelayMs"]
DPS_RAMP_FLOOR: float = SCHEMA["decoder"]["dpsRamp"]["floor"]
DPS_RAMP_COUNT: float = SCHEMA["decoder"]["dpsRamp"]["count"]
DPS_RAMP_HP_MULT: float = SCHEMA["decoder"]["dpsRamp"]["hpMult"]
FAIRNESS_ENGAGEMENT_REACH_M: float = SCHEMA["decoder"]["fairness"]["engagementReachM"]
FAIRNESS_ENGAGEMENT_MIN_S: float = SCHEMA["decoder"]["fairness"]["engagementMinSeconds"]
FAIRNESS_ENGAGEMENT_MAX_S: float = SCHEMA["decoder"]["fairness"]["engagementMaxSeconds"]
FAIRNESS_MIN_COUNT: int = SCHEMA["decoder"]["fairness"]["minCount"]
FAIRNESS_KILL_REALISM: float = SCHEMA["decoder"]["fairness"]["killRealism"]
FAIRNESS_WAVE_HP_BUDGET: float = SCHEMA["decoder"]["fairness"]["waveHpBudget"]
FAIRNESS_MIN_LEAK_HP: float = SCHEMA["decoder"]["fairness"]["minLeakHp"]

# === ENDGAME DIFFICULTY RAMPS ===
# Pre-computed tables so the backend applies the SAME curves the game ships.
# Both plateau, so clamping past the table end is correct.
_HP_RAMP: list[float] = SCHEMA["difficultyRamps"]["endgameHpMultiplier"]
_LEAK_RAMP: list[int] = SCHEMA["difficultyRamps"]["enemyBaseDamage"]

# === PLAYER BASELINE ===
START_HEALTH: float = SCHEMA["player"]["startHealth"]
START_CREDITS: float = SCHEMA["player"]["startCredits"]

# === TRAINING ===
# Shared with the encoder's "episode progress" feature, so the frontend and the
# backend normalise it against the same horizon.
EPISODE_LENGTH: int = SCHEMA["training"]["episodeLength"]


def endgame_hp_multiplier(wave_num: int) -> float:
    """Structural late-game HP multiplier applied AFTER the NN's hp_mult.

    Mirrors `endgameHpMultiplier` in wave-curriculum.config.ts. Waves past the
    generated table clamp to the last value (the curve plateaus at 4.0×).
    """
    if wave_num < 1:
        return 1.0
    return _HP_RAMP[min(wave_num, len(_HP_RAMP)) - 1]


def enemy_base_damage_for_wave(wave_num: int) -> int:
    """HP the player loses per leaked enemy at this wave.

    Mirrors `enemyBaseDamageForWave` in wave-curriculum.config.ts. Used to
    reason about how expensive a leak is, not to drive the game (the frontend
    owns that).
    """
    if wave_num < 1:
        return 1
    return _LEAK_RAMP[min(wave_num, len(_LEAK_RAMP)) - 1]


def template_for_wave(wave_num: int) -> Optional[str]:
    """Curriculum-forced template id for `wave_num` (1-indexed), or None.

    Returns None past `CURRICULUM_FORCED_THROUGH_WAVE` — from there the model's
    own template head decides, under the normal availability mask. Inside the
    curriculum the mask is narrowed to exactly this template, so the sampled
    action and the shipped wave are the same thing (that equality is what makes
    the PPO credit assignment honest).
    """
    if wave_num < 1 or wave_num > CURRICULUM_FORCED_THROUGH_WAVE:
        return None
    return CURRICULUM_SEQUENCE[wave_num - 1]


def get_template(idx: int) -> Optional[dict[str, Any]]:
    """Template at slot `idx`, or None for invalid/reserved slots."""
    if 0 <= idx < NUM_ACTIVE_TEMPLATES:
        return TEMPLATES[idx]
    return None


def template_index(template_id: str) -> Optional[int]:
    """Slot index of a template id, or None if unknown."""
    for i, t in enumerate(TEMPLATES):
        if t["id"] == template_id:
            return i
    return None


def fair_max_count(
    template: dict[str, Any],
    hp_mult: float,
    spawn_delay_ms: float,
    effective_dps_per_armor: dict[str, Any],
    kill_throughput: Optional[dict[str, Any]] = None,
    hp_remaining: float = 100.0,
    leak_damage: float = 1.0,
    budget_multiplier: float = 1.0,
) -> Optional[int]:
    """Largest enemy count the defense can plausibly handle, or None if unbounded.

    The DPS ramp scales a wave against its template's own range, so its floor is
    relative — 10% of zombie_horde's 20-2000 span is 218 enemies, which at wave 1
    (two archers, 50 DPS) is unkillable by an order of magnitude. This is the
    absolute counterpart: work out how many enemies the defense can actually
    destroy, discount it by what defenses measurably achieve, and add an
    overshoot sized by how much HP the wave is allowed to cost. The overshoot is
    the leak that produces the drama the reward is asking for — now priced in HP
    instead of assumed away.

    Measured in KILLS per second, not damage per second. Damage alone said a
    76-DPS defense could clear 848 rats of 3.4 HP twice over; it could not,
    because a tower engages one target per shot and discards the surplus. Two
    archers kill two rats a second no matter how hard each shot hits, and the
    other 700 rats walked through — which is exactly what the training run did.
    Against tanky enemies the damage term binds instead and throughput is
    irrelevant; whichever is scarcer wins.

    Uses armor-weighted effective DPS: an archer contributes fully against
    unarmored and almost nothing (0.15x) against ethereal. Air and ground are
    read separately so a defense that cannot shoot upward is not credited for a
    bat swarm.
    """
    ground = (effective_dps_per_armor or {}).get("ground") or {}
    air = (effective_dps_per_armor or {}).get("air") or {}
    throughput_src = kill_throughput or {}

    total_share = 0.0
    weighted_dps = 0.0
    weighted_hp = 0.0
    weighted_throughput = 0.0
    weighted_speed = 0.0
    for group in template["enemies"]:
        enemy, share = group["type"], float(group["share"])
        if share <= 0:
            continue
        armor = ENEMY_ARMOR.get(enemy, "unarmored")
        is_air = enemy in AIR_ENEMIES
        weighted_dps += share * float((air if is_air else ground).get(armor, 0.0) or 0.0)
        weighted_throughput += share * float(
            throughput_src.get("air" if is_air else "ground", 0.0) or 0.0
        )
        weighted_hp += share * float(ENEMY_BASE_HP.get(enemy, 80)) * hp_mult
        weighted_speed += share * max(0.1, float(ENEMY_BASE_SPEED.get(enemy, 5)))
        total_share += share

    if total_share <= 0:
        return None
    dps = weighted_dps / total_share
    hp_per_enemy = weighted_hp / total_share
    throughput = weighted_throughput / total_share
    if dps <= 0 or hp_per_enemy <= 0:
        # No effective damage against this wave at all — a curriculum-forced air
        # wave against a ground-only defense, say, since forcing bypasses the
        # capability mask. Every enemy will leak, and leak damage scales with
        # the count, so the smallest legal wave is exactly the right answer: it
        # still teaches the lesson without ending the run outright.
        return FAIRNESS_MIN_COUNT

    dps_limited = dps / hp_per_enemy
    kills_per_second = min(dps_limited, throughput) if throughput > 0 else dps_limited
    if kills_per_second <= 0:
        return None

    # Closed form, since the wave's duration depends on the count:
    #   killable = kills_per_second * (count * delay_s + ENGAGEMENT) * HEADROOM
    #   want:  count <= killable
    # Seconds an enemy actually spends under fire, from its own speed. Fast
    # swarms give the defense far less time than the wave's nominal duration
    # suggests — a rat at 10 m/s crosses a 60 m engagement envelope in six
    # seconds, not the thirty a flat allowance assumed.
    speed = weighted_speed / total_share
    engagement_seconds = min(
        FAIRNESS_ENGAGEMENT_MAX_S,
        max(FAIRNESS_ENGAGEMENT_MIN_S, FAIRNESS_ENGAGEMENT_REACH_M / speed),
    )

    # What the model says is killable, discounted by what defenses actually
    # manage. Measured kill share over 15k waves: 0.64 through waves 1-10, 1.00
    # from wave 11 — so undiscounted the gate permitted about twice the real
    # capacity in exactly the phase where the player has no HP buffer.
    # `budget_multiplier` is the closed loop: the caller raises it while the
    # defense kills everything and lowers it when a run ends. The static
    # realism discount was measured on waves 1-10 and is wrong past wave 11.
    budget = kills_per_second * FAIRNESS_KILL_REALISM * max(0.01, budget_multiplier)
    denominator = 1.0 - budget * (max(0.0, spawn_delay_ms) / 1000.0)
    if denominator <= 0:
        return None
    killable = budget * engagement_seconds / denominator

    # Allow an overshoot priced in HP rather than assumed away. The leaks are
    # what make a wave dramatic; the budget is what stops them ending the run.
    leak_hp_budget = max(FAIRNESS_MIN_LEAK_HP, hp_remaining * FAIRNESS_WAVE_HP_BUDGET)
    allowed_leaks = leak_hp_budget / leak_damage if leak_damage > 0 else leak_hp_budget

    return max(FAIRNESS_MIN_COUNT, int(killable + allowed_leaks))


def build_wave_context(
    upcoming_wave: int,
    has_anti_air: bool,
    has_anti_ethereal: bool,
    recent_template_indices: list[int],
    effective_dps_per_armor: dict[str, Any],
    kill_throughput: Optional[dict[str, Any]] = None,
    hp_remaining: float = 100.0,
) -> dict[str, Any]:
    """Context for the wave about to be decided: mask, ranges, fairness ceiling.

    The params head emits four values in [0,1] that mean nothing on their own —
    `count_factor = 0.5` is ~1000 enemies for zombie_horde and ~50 for
    mech_army. Inside the curriculum the template follows from the wave number,
    but past it the model picks the template in the same forward pass that
    produces the factors, so it was genuinely blind there.

    The availability mask covers both cases with one mechanism: inside the
    curriculum it has collapsed to a single slot and IS a one-hot of the wave
    that will ship; past it, it is the set of legal choices. Ranges are the
    single template's, or the average over what is still legal.

    Mirrored by `buildWaveContext` in src/app/ai/core/wave-context.ts.
    """
    mask = get_available_template_mask(
        upcoming_wave, has_anti_air, has_anti_ethereal, recent_template_indices
    )
    allowed = [TEMPLATES[i] for i in range(NUM_ACTIVE_TEMPLATES) if mask[i]]

    def avg_range(key: str) -> tuple[float, float]:
        if not allowed:
            return (0.0, 0.0)
        lo = sum(float(t[key][0]) for t in allowed) / len(allowed)
        hi = sum(float(t[key][1]) for t in allowed) / len(allowed)
        return (lo, hi)

    count_range = avg_range("countRange")
    hp_range = avg_range("hpMultRange")
    delay_range = avg_range("spawnDelayRange")

    # Evaluate the gate against a representative wave — the midpoint of the HP
    # and delay ranges. The real factors are what the model is about to emit, so
    # this is a signal about the ceiling, not a prediction of it.
    cap = None
    headroom = 1.0
    if allowed:
        mid_hp = (hp_range[0] + hp_range[1]) / 2
        mid_delay = (delay_range[0] + delay_range[1]) / 2
        cap = fair_max_count(
            allowed[0], mid_hp, mid_delay, effective_dps_per_armor, kill_throughput,
            hp_remaining, enemy_base_damage_for_wave(upcoming_wave),
        )
        if cap is not None:
            span = count_range[1] - count_range[0]
            headroom = (cap - count_range[0]) / span if span > 0 else 1.0
            headroom = max(0.0, min(1.0, headroom))

    return {
        "mask": mask,
        "count_range": count_range,
        "hp_mult_range": hp_range,
        "spawn_delay_range": delay_range,
        "fairness_headroom": headroom,
        "fair_max_count": cap,
    }


def get_available_template_mask(
    current_wave: int,
    has_anti_air: bool,
    has_anti_ethereal: bool,
    recent_template_indices: list[int],
    cooldown_waves: int = TEMPLATE_COOLDOWN_WAVES,
) -> list[bool]:
    """Boolean mask of length MAX_TEMPLATE_SLOTS: True = template allowed.

    Inside the curriculum the mask collapses to the single forced template, so
    `Categorical` has exactly one option: the sampled index always equals the
    wave that actually ships. Past the curriculum the designer gates apply —
    `min_wave`, capability requirements, the reuse cooldown and the boss cadence.
    """
    mask = [False] * MAX_TEMPLATE_SLOTS

    forced_id = template_for_wave(current_wave)
    if forced_id is not None:
        idx = template_index(forced_id)
        if idx is not None:
            mask[idx] = True
            return mask
        # Unknown curriculum id would be a generator bug; fall through to the
        # free-choice path rather than shipping an all-false mask.

    recent_set = set(recent_template_indices[-cooldown_waves:]) if recent_template_indices else set()

    def passes_gates(t: dict[str, Any], allow_boss: bool) -> bool:
        if current_wave < t["minWave"]:
            return False
        if t["requiresCapability"] == "antiAir" and not has_anti_air:
            return False
        if t["requiresCapability"] == "antiEthereal" and not has_anti_ethereal:
            return False
        if t.get("bossOnly", False):
            return allow_boss and current_wave % 10 == 0
        return True

    for i in range(NUM_ACTIVE_TEMPLATES):
        if not passes_gates(TEMPLATES[i], allow_boss=True):
            continue
        if i in recent_set:
            continue
        mask[i] = True

    # Fallbacks: the cooldown must never be able to starve the mask, and an
    # all-false mask would make Categorical produce NaN.
    if not any(mask):
        for i in range(NUM_ACTIVE_TEMPLATES):
            if passes_gates(TEMPLATES[i], allow_boss=False):
                mask[i] = True
                break
    if not any(mask):
        mask[0] = True

    return mask
