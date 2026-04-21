"""
Wave Templates — Phase 5.11 Range-Based

Each template defines the CHARACTER of a wave (enemy mix, curriculum gate,
capability requirement, spawn pattern) plus RANGES for 4 dynamic parameters:
count, spawn_delay, hp_mult, variation.

The NN picks template + 4 continuous factors in [0,1]; the decoder
interpolates each factor into its template-specific range.

Slots 0-17 are active. Slots 18-31 are reserved so more templates can be
added later without retraining the model.
"""

from typing import Any


# Template dict keys:
#   id, name, description:    metadata
#   enemies:                  [(enemy_type, share), ...] — shares sum to ~1.0
#   count_range:              (min, max) total enemies
#   spawn_delay_range:        (min_ms, max_ms) between spawns
#   hp_mult_range:            (min, max) healthMultiplier applied to base_hp
#   variation_range:          (min, max) spawn-delay jitter factor (0..1)
#   min_wave:                 curriculum gate — blocked before this wave
#   spawn_pattern:            'interleaved' | 'sequential' | 'clustered' | None
#   requires_capability:      None | 'antiAir' | 'antiEthereal'
#   boss_only:                True → only usable at wave % 10 == 0
TEMPLATES: list[dict[str, Any]] = [
    # 0: Unarmored starter → massive mega-horde
    {
        "id": "zombie_horde",
        "name": "Zombie Horde",
        "description": "Unarmored-Horde mit Ratten als Füller — von Easy-Intro bis Mega-Horde",
        "enemies": [("zombie", 0.8), ("rat", 0.2)],
        "count_range": (20, 2000),
        "spawn_delay_range": (15, 400),
        "hp_mult_range": (0.5, 6.0),
        "variation_range": (0.05, 0.40),
        "min_wave": 1,
        "spawn_pattern": "interleaved",
        "requires_capability": None,
        "boss_only": False,
    },
    # 1: Mega-Swarm
    {
        "id": "rat_tide",
        "name": "Rat Tide",
        "description": "Reine Rattenflut — 100 bis 5000 Ratten",
        "enemies": [("rat", 1.0)],
        "count_range": (100, 5000),
        "spawn_delay_range": (10, 200),
        "hp_mult_range": (0.5, 5.0),
        "variation_range": (0.05, 0.30),
        "min_wave": 8,
        "spawn_pattern": None,
        "requires_capability": None,
        "boss_only": False,
    },
    # 2: Speed-Swarm
    {
        "id": "penguin_rush",
        "name": "Penguin Rush",
        "description": "Schnelle Pinguine mit Rattenfüller",
        "enemies": [("penguin", 0.9), ("rat", 0.1)],
        "count_range": (30, 500),
        "spawn_delay_range": (10, 300),
        "hp_mult_range": (0.5, 4.0),
        "variation_range": (0.05, 0.35),
        "min_wave": 5,
        "spawn_pattern": "interleaved",
        "requires_capability": None,
        "boss_only": False,
    },
    # 3: Light ground intro
    {
        "id": "light_mix",
        "name": "Light Mix",
        "description": "Wallsmasher + Spider",
        "enemies": [("wallsmasher", 0.5), ("spider", 0.5)],
        "count_range": (30, 400),
        "spawn_delay_range": (30, 500),
        "hp_mult_range": (0.5, 5.0),
        "variation_range": (0.05, 0.40),
        "min_wave": 4,
        "spawn_pattern": "interleaved",
        "requires_capability": None,
        "boss_only": False,
    },
    # 4: Light swarm
    {
        "id": "spider_swarm",
        "name": "Spider Swarm",
        "description": "Reine Spider-Flut",
        "enemies": [("spider", 1.0)],
        "count_range": (50, 800),
        "spawn_delay_range": (20, 350),
        "hp_mult_range": (0.5, 4.0),
        "variation_range": (0.05, 0.35),
        "min_wave": 8,
        "spawn_pattern": None,
        "requires_capability": None,
        "boss_only": False,
    },
    # 5: Pure Light HP
    {
        "id": "wallsmasher_crew",
        "name": "Wallsmasher Crew",
        "description": "Reine Wallsmasher — HP-Fokus",
        "enemies": [("wallsmasher", 1.0)],
        "count_range": (15, 200),
        "spawn_delay_range": (50, 600),
        "hp_mult_range": (0.5, 6.0),
        "variation_range": (0.10, 0.40),
        "min_wave": 6,
        "spawn_pattern": None,
        "requires_capability": None,
        "boss_only": False,
    },
    # 6: Air swarm
    {
        "id": "bat_swarm",
        "name": "Bat Swarm",
        "description": "Reiner Bat-Schwarm — braucht Anti-Air",
        "enemies": [("bat", 1.0)],
        "count_range": (30, 600),
        "spawn_delay_range": (15, 300),
        "hp_mult_range": (0.5, 4.0),
        "variation_range": (0.05, 0.30),
        "min_wave": 7,
        "spawn_pattern": None,
        "requires_capability": "antiAir",
        "boss_only": False,
    },
    # 7: Air mix
    {
        "id": "hornet_strike",
        "name": "Hornet Strike",
        "description": "Hornets + Bats",
        "enemies": [("hornet", 0.7), ("bat", 0.3)],
        "count_range": (20, 300),
        "spawn_delay_range": (30, 400),
        "hp_mult_range": (0.5, 5.0),
        "variation_range": (0.10, 0.40),
        "min_wave": 9,
        "spawn_pattern": "interleaved",
        "requires_capability": "antiAir",
        "boss_only": False,
    },
    # 8: Heavy ground intro
    {
        "id": "tank_column",
        "name": "Tank Column",
        "description": "Tanks + Zombie-Soldiers",
        "enemies": [("tank", 0.6), ("zombie-soldier", 0.4)],
        "count_range": (10, 150),
        "spawn_delay_range": (80, 800),
        "hp_mult_range": (0.5, 8.0),
        "variation_range": (0.10, 0.35),
        "min_wave": 10,
        "spawn_pattern": "interleaved",
        "requires_capability": None,
        "boss_only": False,
    },
    # 9: Bear pack
    {
        "id": "bear_pack",
        "name": "Bear Pack",
        "description": "Reines Bear-Rudel",
        "enemies": [("bear", 1.0)],
        "count_range": (8, 120),
        "spawn_delay_range": (60, 600),
        "hp_mult_range": (0.5, 7.0),
        "variation_range": (0.10, 0.35),
        "min_wave": 12,
        "spawn_pattern": None,
        "requires_capability": None,
        "boss_only": False,
    },
    # 10: Late heavy
    {
        "id": "mech_army",
        "name": "Mech Army",
        "description": "Reine Mechs — Late-Game Stress",
        "enemies": [("mech", 1.0)],
        "count_range": (5, 100),
        "spawn_delay_range": (100, 900),
        "hp_mult_range": (0.5, 10.0),
        "variation_range": (0.10, 0.40),
        "min_wave": 20,
        "spawn_pattern": None,
        "requires_capability": None,
        "boss_only": False,
    },
    # 11: Heavy air elite
    {
        "id": "dragon_elite",
        "name": "Dragon Elite",
        "description": "Dragons + Hornets",
        "enemies": [("dragon", 0.6), ("hornet", 0.4)],
        "count_range": (5, 100),
        "spawn_delay_range": (80, 800),
        "hp_mult_range": (0.5, 8.0),
        "variation_range": (0.10, 0.40),
        "min_wave": 15,
        "spawn_pattern": "interleaved",
        "requires_capability": "antiAir",
        "boss_only": False,
    },
    # 12: Fortified siege
    {
        "id": "mammoth_siege",
        "name": "Mammoth Siege",
        "description": "Mammoths + Wallsmashers",
        "enemies": [("mammoth", 0.7), ("wallsmasher", 0.3)],
        "count_range": (8, 120),
        "spawn_delay_range": (100, 1000),
        "hp_mult_range": (0.5, 10.0),
        "variation_range": (0.10, 0.40),
        "min_wave": 14,
        "spawn_pattern": "interleaved",
        "requires_capability": None,
        "boss_only": False,
    },
    # 13: Ethereal intro
    {
        "id": "ghost_surge",
        "name": "Ghost Surge",
        "description": "Ghosts + Wraiths — braucht Magic/Ice",
        "enemies": [("ghost", 0.8), ("wraith", 0.2)],
        "count_range": (20, 350),
        "spawn_delay_range": (30, 400),
        "hp_mult_range": (0.5, 5.0),
        "variation_range": (0.10, 0.40),
        "min_wave": 12,
        "spawn_pattern": "interleaved",
        "requires_capability": "antiEthereal",
        "boss_only": False,
    },
    # 14: Pure ethereal
    {
        "id": "wraith_storm",
        "name": "Wraith Storm",
        "description": "Reine Wraiths — braucht Magic/Ice",
        "enemies": [("wraith", 1.0)],
        "count_range": (15, 300),
        "spawn_delay_range": (20, 350),
        "hp_mult_range": (0.5, 6.0),
        "variation_range": (0.05, 0.35),
        "min_wave": 18,
        "spawn_pattern": None,
        "requires_capability": "antiEthereal",
        "boss_only": False,
    },
    # 15: Chaos
    {
        "id": "chaos_wave",
        "name": "Chaos Wave",
        "description": "Chaotischer 4-Typen-Mix",
        "enemies": [("zombie", 0.3), ("tank", 0.3), ("hornet", 0.2), ("bear", 0.2)],
        "count_range": (25, 500),
        "spawn_delay_range": (40, 500),
        "hp_mult_range": (0.5, 5.0),
        "variation_range": (0.15, 0.50),
        "min_wave": 15,
        "spawn_pattern": "interleaved",
        "requires_capability": "antiAir",
        "boss_only": False,
    },
    # 16: All-armor test
    {
        "id": "armor_gauntlet",
        "name": "Armor Gauntlet",
        "description": "Alle 4 Armor-Kategorien gleichzeitig",
        "enemies": [("rat", 0.25), ("tank", 0.25), ("mammoth", 0.25), ("ghost", 0.25)],
        "count_range": (30, 600),
        "spawn_delay_range": (40, 500),
        "hp_mult_range": (0.5, 6.0),
        "variation_range": (0.15, 0.45),
        "min_wave": 20,
        "spawn_pattern": "interleaved",
        "requires_capability": "antiEthereal",
        "boss_only": False,
    },
    # 17: Boss (every 10 waves)
    {
        "id": "boss_herbert",
        "name": "Boss: Herbert",
        "description": "Herbert-Boss mit Support",
        "enemies": [("herbert", 0.0334), ("tank", 0.4833), ("zombie", 0.4833)],
        "count_range": (10, 100),
        "spawn_delay_range": (100, 1200),
        "hp_mult_range": (0.5, 6.0),
        "variation_range": (0.10, 0.30),
        "min_wave": 20,
        "spawn_pattern": "clustered",
        "requires_capability": None,
        "boss_only": True,
    },
]


NUM_ACTIVE_TEMPLATES = len(TEMPLATES)


def get_template(idx: int) -> dict[str, Any] | None:
    """Return template at slot idx, or None if invalid/reserved."""
    if 0 <= idx < NUM_ACTIVE_TEMPLATES:
        return TEMPLATES[idx]
    return None


def get_available_template_mask(
    current_wave: int,
    has_anti_air: bool,
    has_anti_ethereal: bool,
    recent_template_indices: list[int],
    cooldown_waves: int = 2,
) -> list[bool]:
    """Boolean mask of length MAX_TEMPLATE_SLOTS: True = template allowed."""
    from config import MAX_TEMPLATE_SLOTS

    mask = [False] * MAX_TEMPLATE_SLOTS
    recent_set = set(recent_template_indices[-cooldown_waves:]) if recent_template_indices else set()

    for i in range(NUM_ACTIVE_TEMPLATES):
        t = TEMPLATES[i]
        if current_wave < t["min_wave"]:
            continue
        if t["requires_capability"] == "antiAir" and not has_anti_air:
            continue
        if t["requires_capability"] == "antiEthereal" and not has_anti_ethereal:
            continue
        if i in recent_set:
            continue
        if t.get("boss_only", False) and current_wave % 10 != 0:
            continue
        mask[i] = True

    # Fallback: never return an all-false mask
    if not any(mask):
        for i in range(NUM_ACTIVE_TEMPLATES):
            t = TEMPLATES[i]
            if current_wave < t["min_wave"]:
                continue
            if t["requires_capability"] == "antiAir" and not has_anti_air:
                continue
            if t["requires_capability"] == "antiEthereal" and not has_anti_ethereal:
                continue
            if t.get("boss_only", False):
                continue
            mask[i] = True
            break

    if not any(mask):
        mask[0] = True

    return mask
