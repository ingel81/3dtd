"""
Wave Curriculum — designer-curated wave sequence (Phase 5.16).

The decoder forces the curriculum's template per wave, ignoring the NN's
template choice. The NN's continuous factors (count, spawn_delay, hp_mult,
variation) still apply — so the NN tunes *difficulty* while the designer
controls *content* and *pacing*.

The list loops indefinitely: wave 31 = wave 1's template, etc. Difficulty
progression at higher waves comes automatically from the NN reading higher
player DPS + higher wave_num and pushing its continuous factors accordingly
(DPS-Ramp lifts the effective max of count/hp_mult ranges).

Mirror in src/app/ai/core/wave-curriculum.ts — keep both files in sync.
"""

from typing import Optional


# Hard sequence by wave-number (1-indexed: WAVE_CURRICULUM[0] is wave 1).
# After the last entry the curriculum loops back to wave 1's template —
# difficulty progression is handled automatically by the NN's continuous
# factors (count, hp_mult) which scale with the player's totalDPS via the
# DPS-Ramp caps. So at wave 31 a "zombie_horde" repeat will spawn many more
# zombies with much higher HP than at wave 1.
WAVE_CURRICULUM: list[str] = [
    "zombie_horde",      #  1 — unarmored intro (bootstrap)
    "rat_tide",          #  2 — swarm test
    "penguin_rush",      #  3 — speed mix
    "light_mix",         #  4 — light armor intro
    "wallsmasher_crew",  #  5 — light tank-y
    "spider_swarm",      #  6 — light swarm
    "bat_swarm",         #  7 — AIR debut (Anti-Air required)
    "hornet_strike",     #  8 — more air
    "tank_column",       #  9 — heavy intro
    "boss_herbert",      # 10 — BOSS 1 (fortified)
    "bear_pack",         # 11 — heavy fast
    "dragon_elite",      # 12 — flying heavy
    "ghost_surge",       # 13 — ETHEREAL intro (Magic required)
    "mammoth_siege",     # 14 — fortified DPS-check
    "mech_army",         # 15 — max heavy
    "chaos_wave",        # 16 — multi-armor + air
    "wraith_storm",      # 17 — ethereal swarm
    "armor_gauntlet",    # 18 — multi-armor mix
    "rat_tide",          # 19 — mega-swarm checkpoint
    "boss_herbert",      # 20 — BOSS 2
    "bat_swarm",         # 21 — air pressure
    "tank_column",       # 22 — heavy pressure
    "ghost_surge",       # 23 — ethereal pressure
    "dragon_elite",      # 24 — flying-heavy pressure
    "mammoth_siege",     # 25 — fortified pressure
    "hornet_strike",     # 26 — air mass
    "wraith_storm",      # 27 — ethereal mass
    "mech_army",         # 28 — heavy mass
    "chaos_wave",        # 29 — final mix
    "boss_herbert",      # 30 — BOSS 3 (season finale)
]


def template_for_wave(wave_num: int) -> Optional[str]:
    """Return the curriculum-forced template id for `wave_num` (1-indexed).
    The list loops indefinitely: wave 31 = wave 1's template, wave 32 = 2's,
    etc. Difficulty scales via NN's continuous factors + DPS-Ramp caps.
    """
    if wave_num < 1:
        return None
    return WAVE_CURRICULUM[(wave_num - 1) % len(WAVE_CURRICULUM)]
