"""What the analysis makes of a batch of run logs.

Runs are grouped by balance state, parameter set and player; two balance
states in one batch are named rather than averaged together
(docs/BALANCING_PLAN.md, 2c).
"""

import json

import pytest

from analysis.metrics import group_runs, mixed_balance
from analysis.report import render
from analysis.run_reader import read_runs


def head(config_hash="abc123", params="default", bot="expert", run_id="run-1"):
    return {
        "kind": "head", "format": 1, "runId": run_id, "startedAt": "2026-09-20T10:00:00.000Z",
        "gameVersion": "v0.3.2", "commit": "d227323b", "configHash": config_hash,
        "seed": 1, "player": "bot", "botSkill": bot, "map": "devworld",
        "directorParams": params,
    }


def wave(number, *, hp_lost=0, leaked=0, spawned=10, credits_start=100, spend=0, towers=None,
         duration_ms=30_000, mismatches=None, tower_spending=None):
    record = {
        "kind": "wave", "wave": number, "step": number * 100, "timeMs": number * 30_000,
        "durationMs": duration_ms, "creditsStart": credits_start,
        "creditsEnd": credits_start + 50 - spend,
        "income": {"kill": 30, "wave-bonus": 20}, "spending": {"build": spend} if spend else {},
        "enemiesSpawned": spawned, "killsByTower": spawned - leaked, "killsByHero": 0,
        "killsByAbility": 0, "killsByDebug": 0, "killsByOther": 0, "leaked": leaked,
        "healthStart": 100, "healthEnd": 100 - hp_lost,
        "towerSpending": tower_spending if tower_spending is not None else {},
        "towers": towers if towers is not None else [
            {"id": "t1", "type": "archer", "levels": {"damage": 2}, "damage": 500, "kills": 5},
        ],
    }
    if mismatches:
        record["mismatches"] = mismatches
    return record


def event(name, *, type_id=None, credits=None):
    record = {"kind": "event", "event": name, "step": 1, "timeMs": 10, "wave": 1}
    if type_id is not None:
        record["id"] = type_id
    if credits is not None:
        record["credits"] = credits
    return record


def write(path, records):
    path.write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
    return path


def test_a_run_is_read_with_its_head_and_waves(tmp_path):
    write(tmp_path / "a.jsonl", [head(), wave(1), wave(2), {"kind": "end", "step": 9, "timeMs": 9,
                                                            "waveReached": 2, "reason": "defeat"}])

    [run] = read_runs([tmp_path]).runs

    assert run.config_hash == "abc123"
    assert run.bot == "expert"
    assert run.wave_reached == 2
    assert run.end_reason == "defeat"


def test_a_file_without_a_head_or_a_wave_is_skipped_by_name(tmp_path):
    write(tmp_path / "headless.jsonl", [wave(1)])
    write(tmp_path / "empty.jsonl", [head()])

    result = read_runs([tmp_path])

    assert result.runs == []
    assert {path.name for path, _ in result.skipped} == {"headless.jsonl", "empty.jsonl"}


def test_decisions_are_counted_into_the_wave_they_happened_in(tmp_path):
    write(tmp_path / "a.jsonl", [
        head(),
        event("tower-built"), event("research-started"), event("leak"),   # leak is no decision
        wave(1),
        event("tower-upgraded"),
        wave(2),
    ])

    [run] = read_runs([tmp_path]).runs

    assert [w.decisions for w in run.waves] == [2, 1]


def test_runs_are_grouped_by_balance_parameter_set_and_player(tmp_path):
    write(tmp_path / "a.jsonl", [head(bot="expert"), wave(1)])
    write(tmp_path / "b.jsonl", [head(bot="expert", run_id="run-2"), wave(1), wave(2)])
    write(tmp_path / "c.jsonl", [head(bot="beginner", run_id="run-3"), wave(1)])
    write(tmp_path / "d.jsonl", [head(params="steep-ramp", run_id="run-4"), wave(1)])

    groups = group_runs(read_runs([tmp_path]).runs)

    assert {(g.player, g.director_params, g.runs) for g in groups} == {
        ("expert", "default", 2),
        ("beginner", "default", 1),
        ("expert", "steep-ramp", 1),
    }


def test_two_balance_states_in_one_batch_are_named(tmp_path):
    write(tmp_path / "a.jsonl", [head(config_hash="aaa"), wave(1)])
    write(tmp_path / "b.jsonl", [head(config_hash="bbb", run_id="run-2"), wave(1)])

    groups = group_runs(read_runs([tmp_path]).runs)

    assert mixed_balance(groups) == {"aaa", "bbb"}
    assert "do not belong in the same average" in render(groups, [])


def test_one_balance_state_raises_no_warning(tmp_path):
    write(tmp_path / "a.jsonl", [head(), wave(1)])

    groups = group_runs(read_runs([tmp_path]).runs)

    assert mixed_balance(groups) == set()
    assert "do not belong in the same average" not in render(groups, [])


def test_the_numbers_per_wave_are_averaged_over_the_runs(tmp_path):
    write(tmp_path / "a.jsonl", [head(), wave(1, hp_lost=10, leaked=2, spawned=10)])
    write(tmp_path / "b.jsonl", [head(run_id="run-2"), wave(1, hp_lost=0, leaked=0, spawned=10),
                                 wave(2, hp_lost=4, leaked=1, spawned=10)])

    [group] = group_runs(read_runs([tmp_path]).runs)

    first, second = group.per_wave
    assert first.runs == 2
    assert first.hp_lost == pytest.approx(5)
    assert first.leak_rate == pytest.approx(0.1)
    assert first.damage_share == pytest.approx(0.5)      # one of two runs lost HP
    assert second.runs == 1                              # only one run got that far


def test_the_tower_shares_add_up(tmp_path):
    towers = [
        {"id": "t1", "type": "archer", "levels": {}, "damage": 300, "kills": 3},
        {"id": "t2", "type": "cannon", "levels": {}, "damage": 100, "kills": 1},
    ]
    write(tmp_path / "a.jsonl", [head(), wave(1, towers=towers)])

    [group] = group_runs(read_runs([tmp_path]).runs)

    shares = {t.type: t.damage_share for t in group.towers}
    assert shares["archer"] == pytest.approx(0.75)
    assert shares["cannon"] == pytest.approx(0.25)
    assert group.towers[0].type == "archer"              # sorted by damage


def test_mismatches_of_the_log_are_carried_into_the_report(tmp_path):
    write(tmp_path / "a.jsonl", [head(), wave(1, mismatches=["gold: 100 + 10 - 60 = 50, end 500"])])

    [group] = group_runs(read_runs([tmp_path]).runs)

    assert group.mismatches == 1
    assert 'class="bad">1<' in render([group], [])


def test_the_report_is_one_self_contained_page(tmp_path):
    write(tmp_path / "a.jsonl", [head(), wave(1), wave(2)])

    page = render(group_runs(read_runs([tmp_path]).runs), [])

    assert page.startswith("<!DOCTYPE html>")
    assert "<svg" in page
    # No CDN, no script: the file has to open from disk years from now
    assert "http://" not in page and "https://" not in page
    assert "<script" not in page


def test_where_the_runs_end_is_counted_by_wave_and_template(tmp_path):
    def last(number, template):
        w = wave(number)
        w["template"] = template
        return w

    write(tmp_path / "a.jsonl", [head(), last(5, "Ghost Surge")])
    write(tmp_path / "b.jsonl", [head(run_id="r2"), last(5, "Ghost Surge")])
    write(tmp_path / "c.jsonl", [head(run_id="r3"), last(7, "Hornet Strike")])

    [group] = group_runs(read_runs([tmp_path]).runs)

    assert [(e.wave, e.template, e.runs) for e in group.endings] == [
        (5, "Ghost Surge", 2),
        (7, "Hornet Strike", 1),
    ]
    assert group.endings[0].share == pytest.approx(2 / 3)


def test_the_endings_reach_the_report(tmp_path):
    w = wave(9)
    w["template"] = "Mammoth Siege"
    write(tmp_path / "a.jsonl", [head(), w])

    page = render(group_runs(read_runs([tmp_path]).runs), [])

    assert "Where the runs end" in page
    assert "Mammoth Siege" in page


def test_the_gold_of_a_type_is_the_build_plus_its_upgrades(tmp_path):
    """Damage per gold needs a divisor: what the wave block booked per type."""
    towers = [
        {"id": "t1", "type": "cannon", "levels": {"damage": 2}, "damage": 900, "kills": 4},
        {"id": "t2", "type": "archer", "levels": {}, "damage": 100, "kills": 1},
    ]
    write(tmp_path / "a.jsonl", [
        head(),
        wave(1, towers=towers, tower_spending={"cannon": 200, "archer": 100}),
    ])

    [group] = group_runs(read_runs([tmp_path]).runs)
    by_type = {t.type: t for t in group.towers}

    assert by_type["cannon"].gold == 200
    assert by_type["archer"].gold == 100
    assert by_type["cannon"].gold_share == pytest.approx(2 / 3)
    # The cannon carries 90 % of the damage on two thirds of the gold
    assert by_type["cannon"].damage_per_gold == pytest.approx(4.5)
    assert by_type["archer"].damage_per_gold == pytest.approx(1.0)


def test_the_gold_of_a_type_adds_up_over_the_waves_of_a_run(tmp_path):
    towers = [{"id": "t1", "type": "cannon", "levels": {}, "damage": 300, "kills": 2}]
    write(tmp_path / "a.jsonl", [
        head(),
        wave(1, towers=towers, tower_spending={"cannon": 120}),
        wave(2, towers=towers, tower_spending={"cannon": 80}),
    ])

    [group] = group_runs(read_runs([tmp_path]).runs)

    assert group.towers[0].gold == 200
    assert group.towers[0].damage_per_gold == pytest.approx(3.0)


def test_a_type_that_was_bought_but_never_fired_still_shows_its_gold(tmp_path):
    """Gold that bought nothing is the point of the number, so it may not drop out."""
    write(tmp_path / "a.jsonl", [
        head(),
        wave(1, towers=[], tower_spending={"rocket": 500}),
    ])

    [group] = group_runs(read_runs([tmp_path]).runs)

    assert [(t.type, t.gold, t.damage_per_gold) for t in group.towers] == [("rocket", 500, 0.0)]


def test_a_type_without_gold_has_no_damage_per_gold(tmp_path):
    """A debug-placed tower has damage and no price; the column says so instead of dividing by zero."""
    towers = [{"id": "t1", "type": "cannon", "levels": {}, "damage": 300, "kills": 2}]
    write(tmp_path / "a.jsonl", [head(), wave(1, towers=towers)])

    [group] = group_runs(read_runs([tmp_path]).runs)

    assert group.towers[0].damage_per_gold is None
    assert "no gold" in render([group], [])


def test_a_log_from_before_the_block_carried_the_gold_falls_back_to_its_events(tmp_path):
    """Format 1 runs are the whole first baseline; their events name type and price."""
    old = wave(1, towers=[{"id": "t1", "type": "cannon", "levels": {}, "damage": 400, "kills": 3}])
    del old["towerSpending"]
    write(tmp_path / "a.jsonl", [
        head(),
        event("tower-built", type_id="cannon", credits=-120),
        event("tower-upgraded", type_id="cannon", credits=-80),
        # A sale pays gold back; damage per gold counts what went in, gross
        event("tower-sold", type_id="cannon", credits=60),
        old,
    ])

    [group] = group_runs(read_runs([tmp_path]).runs)

    assert group.towers[0].gold == 200
    assert group.towers[0].damage_per_gold == pytest.approx(2.0)


def test_the_gold_of_one_block_does_not_leak_into_the_next(tmp_path):
    towers = [{"id": "t1", "type": "cannon", "levels": {}, "damage": 100, "kills": 1}]
    first = wave(1, towers=towers)
    second = wave(2, towers=towers)
    for record in (first, second):
        del record["towerSpending"]
    write(tmp_path / "a.jsonl", [
        head(),
        event("tower-built", type_id="cannon", credits=-120),
        first,
        event("tower-upgraded", type_id="cannon", credits=-80),
        second,
    ])

    run = read_runs([tmp_path]).runs[0]

    assert [w.tower_spending for w in run.waves] == [{"cannon": 120}, {"cannon": 80}]


def test_damage_per_gold_reaches_the_report(tmp_path):
    towers = [{"id": "t1", "type": "cannon", "levels": {}, "damage": 900, "kills": 4}]
    write(tmp_path / "a.jsonl", [head(), wave(1, towers=towers, tower_spending={"cannon": 200})])

    page = render(group_runs(read_runs([tmp_path]).runs), [])

    assert "damage/gold" in page
    assert "4.50" in page


# ===================================================================
# Der Druck-Regler (docs/DRAMA_CONTROLLER_PLAN.md)
# ===================================================================

def loop_of(tmp_path, records, name="run.jsonl"):
    write(tmp_path / name, records)
    return group_runs(read_runs([tmp_path]).runs)[0].loop


def test_the_pressure_of_a_wave_comes_from_the_health_it_cost(tmp_path):
    # Anteil des Stands zu Wellenbeginn, nicht des Startmaximums: Das ist die
    # Stelle, an der die Messung Heilung überlebt.
    runs = read_runs([write(tmp_path / "r.jsonl", [head(), wave(1, hp_lost=10)])]).runs
    assert runs[0].waves[0].pressure == pytest.approx(0.1)


def test_a_wave_that_started_at_zero_health_carries_no_pressure(tmp_path):
    record = wave(1)
    record["healthStart"] = 0
    runs = read_runs([write(tmp_path / "r.jsonl", [head(), record])]).runs
    assert runs[0].waves[0].pressure is None


def test_an_old_log_without_a_target_is_read_against_the_same_curve(tmp_path):
    # Format 2 kennt `targetPressure` nicht. Ohne einen nachgerechneten Wert
    # ließe sich eine Baseline nicht gegen den neuen Regler halten.
    runs = read_runs([write(tmp_path / "r.jsonl", [head(), wave(1)])]).runs
    assert runs[0].waves[0].target_pressure > 0


def test_the_logged_target_wins_over_the_computed_one(tmp_path):
    record = wave(1)
    record["targetPressure"] = 0.42
    runs = read_runs([write(tmp_path / "r.jsonl", [head(), record])]).runs
    assert runs[0].waves[0].target_pressure == 0.42


def test_the_loop_multiplier_is_read_from_either_format(tmp_path):
    old, new = wave(1), wave(2)
    old["leakMultiplier"] = 1.5          # Format 2
    new["pressureMultiplier"] = 2.5      # Format 3
    runs = read_runs([write(tmp_path / "r.jsonl", [head(), old, new])]).runs
    assert [w.loop_multiplier for w in runs[0].waves] == [1.5, 2.5]


def test_the_longest_dead_streak_counts_waves_that_cost_nothing(tmp_path):
    loop = loop_of(tmp_path, [
        head(),
        wave(1, hp_lost=5), wave(2), wave(3), wave(4), wave(5, hp_lost=5), wave(6),
    ])
    assert loop.longest_dead_streak == 3


def test_a_multiplier_on_its_stop_is_counted_as_pinned(tmp_path):
    waves = []
    for i in range(1, 5):
        record = wave(i)
        record["pressureMultiplier"] = 0.5 if i < 3 else 2.0
        waves.append(record)
    loop = loop_of(tmp_path, [head(), *waves])
    assert loop.pinned == pytest.approx(0.5)


def test_the_cap_spread_is_normalised_to_ten_waves(tmp_path):
    # Roh wächst die Spanne mit der Lauflänge, weil die Verteidigung wächst
    # und der Deckel ihr folgt. Ein längerer Lauf darf dafür nicht bestraft
    # werden.
    waves = []
    for i in range(1, 21):
        record = wave(i)
        record["survivableCount"] = 10 if i == 1 else 1000
        waves.append(record)
    loop = loop_of(tmp_path, [head(), *waves])
    assert loop.cap_spread == pytest.approx(100)
    assert loop.cap_spread_per_10 == pytest.approx(10)


def test_a_wave_inside_the_band_is_counted_as_on_target(tmp_path):
    on_target = wave(1, hp_lost=4)
    on_target["targetPressure"] = 0.04
    way_over = wave(2, hp_lost=40)
    way_over["targetPressure"] = 0.04
    loop = loop_of(tmp_path, [head(), on_target, way_over])
    assert loop.in_band == pytest.approx(0.5)


def test_the_air_niche_reads_only_the_waves_made_of_flyers(tmp_path):
    # Die Linse für einen Spezialisten: In einer reinen Luftwelle ist jeder
    # Punkt Schaden Luftschaden, über einen ganzen Lauf gemittelt nicht.
    air = wave(1, towers=[
        {"id": "t1", "type": "rocket", "damage": 300, "kills": 3},
        {"id": "t2", "type": "archer", "damage": 100, "kills": 1},
    ])
    air["composition"] = [{"type": "bat", "count": 10}]
    ground = wave(2, towers=[{"id": "t3", "type": "cannon", "damage": 9000, "kills": 90}])
    ground["composition"] = [{"type": "zombie", "count": 10}]

    write(tmp_path / "r.jsonl", [head(), air, ground])
    niche = {n.type: n for n in group_runs(read_runs([tmp_path]).runs)[0].air_niche}

    assert set(niche) == {"rocket", "archer"}          # die Bodenwelle zählt nicht
    assert niche["rocket"].damage_share == pytest.approx(0.75)
    assert niche["rocket"].present == pytest.approx(1.0)
