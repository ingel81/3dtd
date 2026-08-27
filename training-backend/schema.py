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
EXPECTED_SCHEMA_VERSION = 2

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
FAIRNESS_HEADROOM: float = SCHEMA["decoder"]["fairness"]["headroom"]
FAIRNESS_ENGAGEMENT_SECONDS: float = SCHEMA["decoder"]["fairness"]["engagementSeconds"]
FAIRNESS_MIN_COUNT: int = SCHEMA["decoder"]["fairness"]["minCount"]

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
) -> Optional[int]:
    """Largest enemy count the defense can plausibly handle, or None if unbounded.

    The DPS ramp scales a wave against its template's own range, so its floor is
    relative — 10% of zombie_horde's 20-2000 span is 218 enemies, which at wave 1
    (two archers, 50 DPS) is unkillable by an order of magnitude. This is the
    absolute counterpart: work out the HP the defense can actually chew through
    and allow the wave to carry FAIRNESS_HEADROOM times that much. The overshoot
    is the leak that produces the damage the reward is asking for.

    Uses armor-weighted effective DPS, not raw DPS: an archer contributes fully
    against unarmored and almost nothing (0.15x) against ethereal, and a wave of
    ghosts must be judged by the latter. Air and ground are read separately so a
    defense that cannot shoot upward is not credited for a bat swarm.

    Closed form, because the wave's duration itself depends on the count:

        killable_hp = dps * (count * delay_s + ENGAGEMENT) * HEADROOM
        want:  count * hp_per_enemy <= killable_hp
        =>     count * (hp_per_enemy - dps * HEADROOM * delay_s)
                   <= dps * HEADROOM * ENGAGEMENT

    If the bracket is <= 0 the defense out-damages the spawn rate and no cap
    applies — that is a strong defense, and the ramp stays in charge.
    """
    ground = (effective_dps_per_armor or {}).get("ground") or {}
    air = (effective_dps_per_armor or {}).get("air") or {}

    total_share = 0.0
    weighted_dps = 0.0
    weighted_hp = 0.0
    for group in template["enemies"]:
        enemy, share = group["type"], float(group["share"])
        if share <= 0:
            continue
        armor = ENEMY_ARMOR.get(enemy, "unarmored")
        source = air if enemy in AIR_ENEMIES else ground
        weighted_dps += share * float(source.get(armor, 0.0) or 0.0)
        weighted_hp += share * float(ENEMY_BASE_HP.get(enemy, 80)) * hp_mult
        total_share += share

    if total_share <= 0:
        return None
    dps = weighted_dps / total_share
    hp_per_enemy = weighted_hp / total_share
    if dps <= 0 or hp_per_enemy <= 0:
        # No effective damage at all against this wave. The capability mask is
        # what protects the player here; capping the count would only turn an
        # unwinnable wave into a smaller unwinnable wave.
        return None

    delay_s = max(0.0, spawn_delay_ms) / 1000.0
    budget = dps * FAIRNESS_HEADROOM
    denominator = hp_per_enemy - budget * delay_s
    if denominator <= 0:
        return None

    return max(FAIRNESS_MIN_COUNT, int(budget * FAIRNESS_ENGAGEMENT_SECONDS / denominator))


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
