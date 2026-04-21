"""
Wave Templates (Phase 5.10)

Designer-curated wave compositions. The NN picks a template index + strength +
count, the decoder expands the template into a concrete wave config.

Each template specifies a coherent enemy mix that matches a tactical theme.
Monotony and armor-dominance are prevented structurally via the cooldown mask
in server.py::_decode_action — no soft reward penalties for repetition.

Slots 0-17 are the active templates. Slots 18-31 are reserved placeholders
so the model can be extended later without retraining (MAX_TEMPLATE_SLOTS in
config.py). The slot-availability mask blocks reserved slots.
"""

from typing import Any


# Each template: a dict with keys:
#   id:                      stable string identifier
#   name:                    human-readable name (UI)
#   description:             short UI text
#   enemies:                 list of (enemy_type, share) tuples; shares must sum to 1.0
#   base_count:              typical wave size at count=1.0
#   base_spawn_delay_ms:     default spawn interval
#   base_hp_mult:            hp multiplier at strength=1.0
#   min_wave:                curriculum gate — template blocked before this wave
#   spawn_pattern:           'interleaved' | 'sequential' | 'clustered' | None
#   requires_capability:     None | 'antiAir' | 'antiEthereal'
#   boss_only:               True if this template is gated to every-10-waves
TEMPLATES: list[dict[str, Any]] = [
    # 0: Unarmored starter
    {
        "id": "zombie_horde",
        "name": "Zombie Horde",
        "description": "Langsame Unarmored-Welle mit ein paar Ratten als Füller",
        "enemies": [("zombie", 0.8), ("rat", 0.2)],
        "base_count": 40,
        "base_spawn_delay_ms": 300,
        "base_hp_mult": 1.0,
        "min_wave": 1,
        "spawn_pattern": "interleaved",
        "requires_capability": None,
        "boss_only": False,
    },
    # 1: Mega-Swarm — Hauptattraktion für 2000+ Enemies
    {
        "id": "rat_tide",
        "name": "Rat Tide",
        "description": "Mega-Swarm reiner Ratten mit sehr hoher Dichte",
        "enemies": [("rat", 1.0)],
        "base_count": 400,
        "base_spawn_delay_ms": 80,
        "base_hp_mult": 1.0,
        "min_wave": 8,
        "spawn_pattern": None,
        "requires_capability": None,
        "boss_only": False,
    },
    # 2: Speed-Swarm
    {
        "id": "penguin_rush",
        "name": "Penguin Rush",
        "description": "Schnelle Pinguine mit Ratten als Ablenkung",
        "enemies": [("penguin", 0.9), ("rat", 0.1)],
        "base_count": 80,
        "base_spawn_delay_ms": 150,
        "base_hp_mult": 1.0,
        "min_wave": 5,
        "spawn_pattern": "interleaved",
        "requires_capability": None,
        "boss_only": False,
    },
    # 3: Light ground intro
    {
        "id": "light_mix",
        "name": "Light Mix",
        "description": "Wallsmasher und Spider — Einführung in Light-Armor",
        "enemies": [("wallsmasher", 0.5), ("spider", 0.5)],
        "base_count": 60,
        "base_spawn_delay_ms": 400,
        "base_hp_mult": 1.0,
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
        "base_count": 120,
        "base_spawn_delay_ms": 250,
        "base_hp_mult": 1.0,
        "min_wave": 8,
        "spawn_pattern": None,
        "requires_capability": None,
        "boss_only": False,
    },
    # 5: Pure Light HP
    {
        "id": "wallsmasher_crew",
        "name": "Wallsmasher Crew",
        "description": "Reine Wallsmasher — HP-fokussiertes Light-Team",
        "enemies": [("wallsmasher", 1.0)],
        "base_count": 40,
        "base_spawn_delay_ms": 500,
        "base_hp_mult": 1.0,
        "min_wave": 6,
        "spawn_pattern": None,
        "requires_capability": None,
        "boss_only": False,
    },
    # 6: Air swarm
    {
        "id": "bat_swarm",
        "name": "Bat Swarm",
        "description": "Reiner Bat-Schwarm — erfordert Anti-Air",
        "enemies": [("bat", 1.0)],
        "base_count": 100,
        "base_spawn_delay_ms": 150,
        "base_hp_mult": 1.0,
        "min_wave": 7,
        "spawn_pattern": None,
        "requires_capability": "antiAir",
        "boss_only": False,
    },
    # 7: Air mix
    {
        "id": "hornet_strike",
        "name": "Hornet Strike",
        "description": "Hornets mit Bat-Support — Fortgeschrittener Air-Mix",
        "enemies": [("hornet", 0.7), ("bat", 0.3)],
        "base_count": 50,
        "base_spawn_delay_ms": 250,
        "base_hp_mult": 1.0,
        "min_wave": 9,
        "spawn_pattern": "interleaved",
        "requires_capability": "antiAir",
        "boss_only": False,
    },
    # 8: Heavy ground intro
    {
        "id": "tank_column",
        "name": "Tank Column",
        "description": "Tanks und Zombie-Soldiers — Heavy-Ground-Einführung",
        "enemies": [("tank", 0.6), ("zombie-soldier", 0.4)],
        "base_count": 25,
        "base_spawn_delay_ms": 500,
        "base_hp_mult": 1.0,
        "min_wave": 10,
        "spawn_pattern": "interleaved",
        "requires_capability": None,
        "boss_only": False,
    },
    # 9: Tank pack
    {
        "id": "bear_pack",
        "name": "Bear Pack",
        "description": "Reines Bear-Rudel",
        "enemies": [("bear", 1.0)],
        "base_count": 20,
        "base_spawn_delay_ms": 400,
        "base_hp_mult": 1.0,
        "min_wave": 12,
        "spawn_pattern": None,
        "requires_capability": None,
        "boss_only": False,
    },
    # 10: Late heavy
    {
        "id": "mech_army",
        "name": "Mech Army",
        "description": "Reine Mechs — Late-Game Heavy-Welle",
        "enemies": [("mech", 1.0)],
        "base_count": 15,
        "base_spawn_delay_ms": 600,
        "base_hp_mult": 1.0,
        "min_wave": 20,
        "spawn_pattern": None,
        "requires_capability": None,
        "boss_only": False,
    },
    # 11: Heavy air elite
    {
        "id": "dragon_elite",
        "name": "Dragon Elite",
        "description": "Dragons mit Hornet-Begleitung — Heavy+Light Air",
        "enemies": [("dragon", 0.6), ("hornet", 0.4)],
        "base_count": 15,
        "base_spawn_delay_ms": 600,
        "base_hp_mult": 1.0,
        "min_wave": 15,
        "spawn_pattern": "interleaved",
        "requires_capability": "antiAir",
        "boss_only": False,
    },
    # 12: Fortified siege
    {
        "id": "mammoth_siege",
        "name": "Mammoth Siege",
        "description": "Mammoths mit Wallsmasher — Fortified-Belagerung",
        "enemies": [("mammoth", 0.7), ("wallsmasher", 0.3)],
        "base_count": 20,
        "base_spawn_delay_ms": 700,
        "base_hp_mult": 1.0,
        "min_wave": 14,
        "spawn_pattern": "interleaved",
        "requires_capability": None,
        "boss_only": False,
    },
    # 13: Ethereal intro
    {
        "id": "ghost_surge",
        "name": "Ghost Surge",
        "description": "Ghosts mit Wraith-Anteil — benötigt Magic/Ice",
        "enemies": [("ghost", 0.8), ("wraith", 0.2)],
        "base_count": 40,
        "base_spawn_delay_ms": 250,
        "base_hp_mult": 1.0,
        "min_wave": 12,
        "spawn_pattern": "interleaved",
        "requires_capability": "antiEthereal",
        "boss_only": False,
    },
    # 14: Pure ethereal
    {
        "id": "wraith_storm",
        "name": "Wraith Storm",
        "description": "Reine Wraiths — benötigt Magic/Ice",
        "enemies": [("wraith", 1.0)],
        "base_count": 35,
        "base_spawn_delay_ms": 200,
        "base_hp_mult": 1.0,
        "min_wave": 18,
        "spawn_pattern": None,
        "requires_capability": "antiEthereal",
        "boss_only": False,
    },
    # 15: Chaos — all-round
    {
        "id": "chaos_wave",
        "name": "Chaos Wave",
        "description": "Chaotisch gemischte Welle aus 4 Typen",
        "enemies": [("zombie", 0.3), ("tank", 0.3), ("hornet", 0.2), ("bear", 0.2)],
        "base_count": 50,
        "base_spawn_delay_ms": 350,
        "base_hp_mult": 1.0,
        "min_wave": 15,
        "spawn_pattern": "interleaved",
        "requires_capability": "antiAir",
        "boss_only": False,
    },
    # 16: All-armor test
    {
        "id": "armor_gauntlet",
        "name": "Armor Gauntlet",
        "description": "Alle 4 Armor-Kategorien gleichzeitig — Allround-Test",
        "enemies": [("rat", 0.25), ("tank", 0.25), ("mammoth", 0.25), ("ghost", 0.25)],
        "base_count": 60,
        "base_spawn_delay_ms": 400,
        "base_hp_mult": 1.0,
        "min_wave": 20,
        "spawn_pattern": "interleaved",
        "requires_capability": "antiEthereal",
        "boss_only": False,
    },
    # 17: Boss wave
    {
        "id": "boss_herbert",
        "name": "Boss: Herbert",
        "description": "Herbert-Boss mit Tank- und Zombie-Support",
        "enemies": [("herbert", 0.0334), ("tank", 0.4833), ("zombie", 0.4833)],
        "base_count": 30,
        "base_spawn_delay_ms": 800,
        "base_hp_mult": 1.0,
        "min_wave": 20,
        "spawn_pattern": "clustered",
        "requires_capability": None,
        "boss_only": True,  # gated to wave % 10 == 0
    },
]


# Number of actual templates defined. Slots beyond this index are reserved
# (masked out by the slot-availability mask in the decoder).
NUM_ACTIVE_TEMPLATES = len(TEMPLATES)


def get_template(idx: int) -> dict[str, Any] | None:
    """Return template at slot idx, or None if slot is reserved/invalid."""
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
    """
    Return a boolean mask of length MAX_TEMPLATE_SLOTS indicating which
    slots are allowed for the current wave. True = allowed, False = blocked.

    Applies:
      - Slot-Availability (slot < NUM_ACTIVE_TEMPLATES)
      - Min-Wave curriculum
      - Capability gates (antiAir, antiEthereal)
      - Template cooldown (recent_template_indices tracked per client)
      - Boss gate (boss templates only at wave % 10 == 0)
    """
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

    # Fallback: if every slot is blocked (edge case — e.g. early wave with all recents),
    # unblock the first unblocked non-boss template regardless of cooldown.
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

    # Final safety: unblock slot 0 (zombie_horde, min_wave=1) if still nothing
    if not any(mask):
        mask[0] = True

    return mask
