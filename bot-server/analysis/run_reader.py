"""
Reading run logs.

A run log is JSONL, one record per line (docs/RUN_LOG.md). A bot run and a
run a player exported are the same format, so this reads both the same way:
whatever lies under `runs/`, plus whatever file you point it at.

Nothing here judges a run. It returns what the file says, and says where a
file could not be read; the metrics are next door in `metrics.py`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Wave:
    """One wave block of a run."""

    wave: int
    duration_ms: int
    template: str | None
    credits_start: int
    credits_end: int
    income: dict[str, float]
    spending: dict[str, float]
    enemies_spawned: int
    kills: int
    leaked: int
    health_start: int
    health_end: int
    survivable_count: int | None
    #: Multiplier of the closed loop. `leakMultiplier` up to run log format 2,
    #: `pressureMultiplier` from format 3 on; both mean the same correction on
    #: the kill estimate, they differ in what the loop steers on.
    loop_multiplier: float | None
    #: Share of HP the wave was meant to cost. Format 3 on; None before.
    target_pressure: float | None
    towers: list[dict]
    mismatches: list[str]
    #: Enemy types and counts as the wave shipped them.
    composition: list[dict] = field(default_factory=list)
    #: Decisions the player made while this wave was prepared and played.
    decisions: int = 0
    #: Build and upgrade gold per tower type, the divisor of damage per gold.
    tower_spending: dict[str, float] = field(default_factory=dict)


    @property
    def pressure(self) -> float | None:
        """
        Share of the standing HP this wave cost.

        Derived rather than logged: `healthStart` and `healthEnd` have always
        been in the block, and a second copy of the same number would only be
        able to disagree with them. None when there was no HP to lose from.
        """
        if self.health_start <= 0:
            return None
        return max(0.0, (self.health_start - self.health_end) / self.health_start)


@dataclass
class Run:
    """One run: its head, its waves, and how it ended."""

    run_id: str
    path: Path
    config_hash: str
    commit: str
    game_version: str
    seed: int | None
    player: str
    bot: str | None
    map: str
    director_params: str
    waves: list[Wave] = field(default_factory=list)
    end_reason: str | None = None

    @property
    def wave_reached(self) -> int:
        return max((w.wave for w in self.waves), default=0)

    @property
    def key(self) -> tuple[str, str, str]:
        """What a run is grouped by: balance, parameter set, who played."""
        return (self.config_hash, self.director_params, self.bot or self.player)


@dataclass
class ReadResult:
    runs: list[Run]
    """Files that could not be read, with the reason."""
    skipped: list[tuple[Path, str]]


#: Events that put gold into a tower type.
TOWER_SPENDING_EVENTS = {"tower-built", "tower-upgraded"}


def _wave(record: dict, decisions: int, tower_spending: dict[str, float]) -> Wave:
    kills = (
        int(record.get("killsByTower", 0) or 0)
        + int(record.get("killsByHero", 0) or 0)
        + int(record.get("killsByAbility", 0) or 0)
        + int(record.get("killsByDebug", 0) or 0)
        + int(record.get("killsByOther", 0) or 0)
    )
    return Wave(
        wave=int(record.get("wave", 0) or 0),
        duration_ms=int(record.get("durationMs", 0) or 0),
        template=record.get("template"),
        credits_start=int(record.get("creditsStart", 0) or 0),
        credits_end=int(record.get("creditsEnd", 0) or 0),
        income=dict(record.get("income") or {}),
        spending=dict(record.get("spending") or {}),
        enemies_spawned=int(record.get("enemiesSpawned", 0) or 0),
        kills=kills,
        leaked=int(record.get("leaked", 0) or 0),
        health_start=int(record.get("healthStart", 0) or 0),
        health_end=int(record.get("healthEnd", 0) or 0),
        survivable_count=record.get("survivableCount"),
        loop_multiplier=record.get("pressureMultiplier", record.get("leakMultiplier")),
        target_pressure=record.get("targetPressure") or _target_pressure(int(record.get("wave", 0) or 0)),
        towers=list(record.get("towers") or []),
        mismatches=list(record.get("mismatches") or []),
        composition=list(record.get("composition") or []),
        decisions=decisions,
        tower_spending=_tower_spending(record, tower_spending),
    )


#: The target curve, mirrored from `targetPressure` in pressure-controller.ts.
#:
#: Runs written before run log format 3 carry no target, and without one an
#: A/B against the old loop could not say whether either run was on curve.
#: Computing it here reads the old runs against the same yardstick as the new
#: ones — the curve is a property of the design, not of the run.
TARGET_RUN_WAVES = 80
TARGET_RESIDUAL_HP = 0.05
SHAPE_START = 0.5
SHAPE_END = 1.5


def _target_pressure(wave: int) -> float:
    base = 1 - TARGET_RESIDUAL_HP ** (1 / TARGET_RUN_WAVES)
    ramp = max(0.0, min(1.0, wave / TARGET_RUN_WAVES))
    return base * (SHAPE_START + (SHAPE_END - SHAPE_START) * ramp)


def _tower_spending(record: dict, from_events: dict[str, float]) -> dict[str, float]:
    """
    Build and upgrade gold per tower type.

    The wave block carries it from run log format 2 on. Older logs are read
    from their own build and upgrade events, which have always named the type
    and the price; without that, every run of the first baseline would lose
    its damage per gold. Drop the fallback once no format 1 log is left.
    """
    booked = record.get("towerSpending")
    if booked is not None:
        return {str(key): float(value or 0) for key, value in booked.items()}
    return dict(from_events)


#: Events that count as a decision of the player (or the bot).
DECISION_EVENTS = {
    "tower-built", "tower-upgraded", "tower-sold",
    "research-started", "ability-used", "hero-hired", "hero-ammo",
}


def read_run(path: Path) -> Run | None:
    """One run out of one file, or None when there is no usable head."""
    head: dict | None = None
    waves: list[Wave] = []
    end_reason: str | None = None
    decisions = 0
    tower_spending: dict[str, float] = {}

    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except ValueError:
                # A half-written last line costs one record, not the file
                continue
            kind = record.get("kind")
            if kind == "head" and head is None:
                head = record
            elif kind == "event":
                event = record.get("event")
                if event in DECISION_EVENTS:
                    decisions += 1
                if event in TOWER_SPENDING_EVENTS:
                    type_id = str(record.get("id") or "?")
                    cost = -float(record.get("credits", 0) or 0)
                    if cost > 0:
                        tower_spending[type_id] = tower_spending.get(type_id, 0) + cost
            elif kind == "wave":
                waves.append(_wave(record, decisions, tower_spending))
                decisions = 0
                tower_spending = {}
            elif kind == "end":
                end_reason = record.get("reason")

    if head is None:
        return None

    return Run(
        run_id=str(head.get("runId") or path.stem),
        path=path,
        config_hash=str(head.get("configHash") or "unknown"),
        commit=str(head.get("commit") or "unknown"),
        game_version=str(head.get("gameVersion") or "unknown"),
        seed=head.get("seed"),
        player=str(head.get("player") or "human"),
        bot=head.get("botSkill"),
        map=str(head.get("map") or "world"),
        director_params=str(head.get("directorParams") or "default"),
        waves=waves,
        end_reason=end_reason,
    )


def read_runs(paths: list[Path]) -> ReadResult:
    """
    Every run under `paths`. A directory is searched for `*.jsonl`, a file is
    read as it is. A run without waves is skipped: it says nothing.
    """
    runs: list[Run] = []
    skipped: list[tuple[Path, str]] = []

    for path in paths:
        files = sorted(path.rglob("*.jsonl")) if path.is_dir() else [path]
        for file in files:
            try:
                run = read_run(file)
            except OSError as error:
                skipped.append((file, str(error)))
                continue
            if run is None:
                skipped.append((file, "no head"))
            elif not run.waves:
                skipped.append((file, "no finished wave"))
            else:
                runs.append(run)

    return ReadResult(runs=runs, skipped=skipped)
