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
         duration_ms=30_000, mismatches=None):
    record = {
        "kind": "wave", "wave": number, "step": number * 100, "timeMs": number * 30_000,
        "durationMs": duration_ms, "creditsStart": credits_start,
        "creditsEnd": credits_start + 50 - spend,
        "income": {"kill": 30, "wave-bonus": 20}, "spending": {"build": spend} if spend else {},
        "enemiesSpawned": spawned, "killsByTower": spawned - leaked, "killsByHero": 0,
        "killsByAbility": 0, "killsByDebug": 0, "killsByOther": 0, "leaked": leaked,
        "healthStart": 100, "healthEnd": 100 - hp_lost,
        "towers": towers if towers is not None else [
            {"id": "t1", "type": "archer", "levels": {"damage": 2}, "damage": 500, "kills": 5},
        ],
    }
    if mismatches:
        record["mismatches"] = mismatches
    return record


def event(name):
    return {"kind": "event", "event": name, "step": 1, "timeMs": 10, "wave": 1}


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
