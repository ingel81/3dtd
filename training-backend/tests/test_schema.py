"""
Tests for the generated AI schema and the availability mask.

Run:  venv/Scripts/python.exe -m pytest tests/ -q
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest  # noqa: E402

import schema  # noqa: E402


# ── Schema integrity ────────────────────────────────────────────────────────

def test_state_sizes_are_self_consistent():
    assert schema.INPUT_SIZE == schema.NUM_SCALAR + schema.NUM_SPATIAL
    assert schema.NUM_SPATIAL == 2 * schema.NUM_BINS


def test_vocabularies_are_non_empty_and_unique():
    for name, vocab in [
        ("enemies", schema.ENEMY_TYPES),
        ("towers", schema.TOWER_TYPES),
        ("damage types", schema.DAMAGE_TYPES),
        ("armor types", schema.ARMOR_TYPES),
    ]:
        assert vocab, f"{name} vocabulary is empty"
        assert len(vocab) == len(set(vocab)), f"{name} vocabulary has duplicates"


def test_every_enemy_has_stats():
    for enemy in schema.ENEMY_TYPES:
        assert schema.ENEMY_BASE_HP[enemy] > 0
        assert schema.ENEMY_ARMOR[enemy] in schema.ARMOR_TYPES
        assert schema.ENEMY_THREAT[enemy] > 0


def test_air_and_ethereal_sets_are_subsets_of_the_roster():
    roster = set(schema.ENEMY_TYPES)
    assert schema.AIR_ENEMIES <= roster
    assert schema.ETHEREAL_ENEMIES <= roster
    assert schema.ETHEREAL_ENEMIES, "no ethereal enemies — the antiEthereal gate would be dead"


# ── Templates ───────────────────────────────────────────────────────────────

def test_active_templates_fit_in_the_output_slots():
    assert 0 < schema.NUM_ACTIVE_TEMPLATES <= schema.MAX_TEMPLATE_SLOTS
    assert len(schema.TEMPLATES) == schema.NUM_ACTIVE_TEMPLATES


def test_template_enemy_shares_sum_to_one():
    for t in schema.TEMPLATES:
        total = sum(g["share"] for g in t["enemies"])
        assert abs(total - 1.0) < 0.01, f"{t['id']} shares sum to {total}"


def test_template_enemies_are_in_the_vocabulary():
    roster = set(schema.ENEMY_TYPES)
    for t in schema.TEMPLATES:
        for g in t["enemies"]:
            assert g["type"] in roster, f"{t['id']} uses unknown enemy {g['type']}"


def test_template_ranges_are_ordered_and_sane():
    for t in schema.TEMPLATES:
        for key in ("countRange", "spawnDelayRange", "hpMultRange", "variationRange"):
            lo, hi = t[key]
            assert lo < hi, f"{t['id']}.{key} is not ordered"
        assert t["countRange"][0] >= 1
        assert t["spawnDelayRange"][0] >= schema.MIN_SPAWN_DELAY_MS
        assert t["hpMultRange"][0] > 0
        assert 0 <= t["variationRange"][0] < t["variationRange"][1] <= 1


def test_get_template_rejects_invalid_slots():
    assert schema.get_template(-1) is None
    assert schema.get_template(schema.NUM_ACTIVE_TEMPLATES) is None
    assert schema.get_template(schema.MAX_TEMPLATE_SLOTS) is None
    assert schema.get_template(0) is not None


def test_template_index_round_trips():
    for i, t in enumerate(schema.TEMPLATES):
        assert schema.template_index(t["id"]) == i
    assert schema.template_index("does-not-exist") is None


# ── Curriculum ──────────────────────────────────────────────────────────────

def test_curriculum_only_names_real_templates():
    ids = {t["id"] for t in schema.TEMPLATES}
    for name in schema.CURRICULUM_SEQUENCE:
        assert name in ids, f"curriculum references unknown template {name}"


def test_curriculum_ends_at_its_declared_length():
    assert schema.CURRICULUM_FORCED_THROUGH_WAVE == len(schema.CURRICULUM_SEQUENCE)
    assert schema.template_for_wave(1) == schema.CURRICULUM_SEQUENCE[0]
    last = schema.CURRICULUM_FORCED_THROUGH_WAVE
    assert schema.template_for_wave(last) == schema.CURRICULUM_SEQUENCE[-1]
    # Past the curriculum the model chooses for itself.
    assert schema.template_for_wave(last + 1) is None
    assert schema.template_for_wave(0) is None


# ── Availability mask ───────────────────────────────────────────────────────

def _live(mask):
    return [i for i, v in enumerate(mask) if v]


def test_mask_collapses_to_one_slot_inside_the_curriculum():
    """This is the property that makes PPO credit assignment honest.

    Sampling has exactly one option, so the stored action always equals the
    wave that ships. Previously the decoder overrode the sampled template
    afterwards and the categorical head learned from an action that never ran.
    """
    for wave in range(1, schema.CURRICULUM_FORCED_THROUGH_WAVE + 1):
        mask = schema.get_available_template_mask(wave, True, True, [])
        live = _live(mask)
        assert len(live) == 1, f"wave {wave} left {len(live)} slots open"
        assert schema.TEMPLATES[live[0]]["id"] == schema.CURRICULUM_SEQUENCE[wave - 1]


def test_curriculum_mask_ignores_capabilities_and_cooldown():
    # A forced template ships regardless of gates — the designer decided.
    wave = 1
    forced = schema.template_index(schema.CURRICULUM_SEQUENCE[0])
    mask = schema.get_available_template_mask(wave, False, False, [forced, forced])
    assert _live(mask) == [forced]


def test_free_choice_respects_min_wave():
    free_wave = schema.CURRICULUM_FORCED_THROUGH_WAVE + 1
    mask = schema.get_available_template_mask(free_wave, True, True, [])
    for i in _live(mask):
        assert schema.TEMPLATES[i]["minWave"] <= free_wave


def test_free_choice_respects_capabilities():
    free_wave = schema.CURRICULUM_FORCED_THROUGH_WAVE + 1
    mask = schema.get_available_template_mask(free_wave, False, False, [])
    for i in _live(mask):
        assert schema.TEMPLATES[i]["requiresCapability"] is None


def test_free_choice_respects_cooldown():
    free_wave = schema.CURRICULUM_FORCED_THROUGH_WAVE + 1
    unrestricted = _live(schema.get_available_template_mask(free_wave, True, True, []))
    assert len(unrestricted) > 2, "need spare templates for a meaningful cooldown test"

    blocked = unrestricted[:2]
    mask = schema.get_available_template_mask(free_wave, True, True, blocked)
    for i in blocked:
        assert not mask[i], f"slot {i} should be on cooldown"


def test_boss_templates_only_appear_on_boss_waves():
    boss_slots = {i for i, t in enumerate(schema.TEMPLATES) if t.get("bossOnly")}
    if not boss_slots:
        pytest.skip("no boss-only templates defined")

    base = schema.CURRICULUM_FORCED_THROUGH_WAVE
    non_boss_wave = next(w for w in range(base + 1, base + 12) if w % 10 != 0)
    mask = schema.get_available_template_mask(non_boss_wave, True, True, [])
    assert not (boss_slots & set(_live(mask)))


def test_mask_is_never_all_false():
    """An all-false mask makes Categorical produce NaN and poisons the update."""
    for wave in (1, 5, 30, 31, 57, 200):
        for aa in (False, True):
            for ae in (False, True):
                mask = schema.get_available_template_mask(wave, aa, ae, list(range(20)))
                assert any(mask), f"wave={wave} aa={aa} ae={ae} produced an empty mask"


def test_reserved_slots_stay_blocked():
    for wave in (1, 31, 77):
        mask = schema.get_available_template_mask(wave, True, True, [])
        for i in range(schema.NUM_ACTIVE_TEMPLATES, schema.MAX_TEMPLATE_SLOTS):
            assert not mask[i], f"reserved slot {i} was offered at wave {wave}"


# ── Difficulty ramps ────────────────────────────────────────────────────────

def test_endgame_hp_ramp_matches_the_game_curve():
    assert schema.endgame_hp_multiplier(1) == 1.0
    assert schema.endgame_hp_multiplier(20) == 1.0
    assert schema.endgame_hp_multiplier(30) == pytest.approx(1.5)
    assert schema.endgame_hp_multiplier(50) == pytest.approx(2.5)
    # Plateaus at 4.0, and clamps past the end of the generated table.
    assert schema.endgame_hp_multiplier(80) == pytest.approx(4.0)
    assert schema.endgame_hp_multiplier(10_000) == pytest.approx(4.0)


def test_endgame_hp_ramp_is_monotonic():
    values = [schema.endgame_hp_multiplier(w) for w in range(1, 120)]
    assert all(b >= a for a, b in zip(values, values[1:]))


def test_leak_damage_ramp_matches_the_game_curve():
    assert schema.enemy_base_damage_for_wave(1) == 1
    assert schema.enemy_base_damage_for_wave(10) == 1
    assert schema.enemy_base_damage_for_wave(11) == 2
    assert schema.enemy_base_damage_for_wave(21) == 3


# ── Fairness gate ───────────────────────────────────────────────────────────

def _dps(ground=0.0, air=0.0):
    """Effective-DPS block with the same value against every armor class."""
    armors = schema.ARMOR_TYPES
    return {
        "ground": {a: ground for a in armors},
        "air": {a: air for a in armors},
    }


def _template(tid):
    idx = schema.template_index(tid)
    assert idx is not None, f"unknown template {tid}"
    return schema.TEMPLATES[idx]


def test_wave_one_stays_fightable_for_a_starting_defense():
    """The regression that made every early run unwinnable.

    100 starting credits buy two archers: 50 DPS against unarmored. The DPS
    ramp still permitted ~120-220 zombies there, so runs died at wave 1 and the
    net never saw the curriculum past wave 11.
    """
    cap = schema.fair_max_count(
        _template("zombie_horde"), hp_mult=0.8, spawn_delay_ms=200,
        effective_dps_per_armor=_dps(ground=50),
    )
    assert cap is not None
    assert cap < 60, f"wave 1 still allows {cap} enemies against 50 DPS"
    assert cap >= schema.FAIRNESS_MIN_COUNT


def test_gate_scales_with_the_defense():
    tpl = _template("zombie_horde")
    weak = schema.fair_max_count(tpl, 1.0, 200, _dps(ground=50))
    strong = schema.fair_max_count(tpl, 1.0, 200, _dps(ground=1500))
    # A strong defense out-damages the spawn rate entirely -> no cap at all.
    assert strong is None or strong > weak


def test_gate_never_returns_below_the_floor():
    cap = schema.fair_max_count(
        _template("mech_army"), hp_mult=10.0, spawn_delay_ms=100,
        effective_dps_per_armor=_dps(ground=1),
    )
    assert cap is None or cap >= schema.FAIRNESS_MIN_COUNT


def test_gate_reads_air_dps_for_air_waves():
    """A ground-only defense must not be credited for an air wave."""
    tpl = _template("bat_swarm")
    ground_only = schema.fair_max_count(tpl, 1.0, 100, _dps(ground=500, air=0))
    with_air = schema.fair_max_count(tpl, 1.0, 100, _dps(ground=500, air=500))
    # Ground DPS must not be credited against an air wave: with none of it
    # reaching, the gate falls back to the floor.
    assert ground_only == schema.FAIRNESS_MIN_COUNT
    assert with_air is None or with_air > ground_only


def test_gate_uses_armor_weighted_dps():
    """Raw DPS would over-credit physical damage against ethereal armor."""
    tpl = _template("wraith_storm")
    poor = schema.fair_max_count(tpl, 1.0, 200, _dps(ground=30))
    good = schema.fair_max_count(tpl, 1.0, 200, _dps(ground=300))
    assert poor is not None
    assert good is None or good > poor


def _throughput(ground=0.0, air=0.0):
    return {"ground": ground, "air": air}


def test_rat_tide_is_capped_by_fire_rate_not_damage():
    """The wave that killed every run at wave 2.

    Observed: 848 rats at 3.4 HP against a 76-DPS defense (two archers plus a
    little). On damage alone that is trivially clearable — 76 DPS over a
    ~72-second wave is 5500 HP against 2900 HP of rats — and the gate let it
    through. But a tower engages one target per shot and throws away the
    surplus, so two archers kill two rats a second, roughly 144 of them, and
    the other 700 walked into the base for 75% damage.
    """
    cap = schema.fair_max_count(
        _template("rat_tide"), hp_mult=0.68, spawn_delay_ms=50,
        effective_dps_per_armor=_dps(ground=76),
        kill_throughput=_throughput(ground=2.0),
    )
    assert cap is not None, "a fire-rate-limited defense must still get a cap"
    assert cap < 300, f"gate still allows {cap} rats against 2 kills/sec"


def test_throughput_is_ignored_when_damage_is_the_scarcer_resource():
    """Against tanky enemies the damage term binds and throughput is moot."""
    tanky = schema.fair_max_count(
        _template("mech_army"), hp_mult=1.0, spawn_delay_ms=300,
        effective_dps_per_armor=_dps(ground=200),
        kill_throughput=_throughput(ground=50.0),
    )
    no_throughput = schema.fair_max_count(
        _template("mech_army"), hp_mult=1.0, spawn_delay_ms=300,
        effective_dps_per_armor=_dps(ground=200),
    )
    assert tanky == no_throughput


def test_more_towers_raise_the_cap():
    tpl = _template("rat_tide")
    small = schema.fair_max_count(tpl, 1.0, 50, _dps(ground=76), _throughput(ground=2.0))
    big = schema.fair_max_count(tpl, 1.0, 50, _dps(ground=760), _throughput(ground=20.0))
    assert small is not None
    assert big is None or big > small


def test_a_wave_the_defense_cannot_touch_is_shrunk_to_the_floor():
    """Curriculum forcing bypasses the capability mask.

    Wave 7 is `bat_swarm` whether or not the player can shoot upward. With no
    effective damage every enemy leaks, and leak damage scales with the count —
    so the smallest legal wave is the right answer, not an uncapped one.
    """
    cap = schema.fair_max_count(
        _template("bat_swarm"), hp_mult=1.0, spawn_delay_ms=100,
        effective_dps_per_armor=_dps(ground=500, air=0),
        kill_throughput=_throughput(ground=10, air=0),
    )
    assert cap == schema.FAIRNESS_MIN_COUNT
