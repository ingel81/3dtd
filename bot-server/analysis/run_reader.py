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
    leak_multiplier: float | None
    towers: list[dict]
    mismatches: list[str]
    #: Decisions the player made while this wave was prepared and played.
    decisions: int = 0


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


def _wave(record: dict, decisions: int) -> Wave:
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
        leak_multiplier=record.get("leakMultiplier"),
        towers=list(record.get("towers") or []),
        mismatches=list(record.get("mismatches") or []),
        decisions=decisions,
    )


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
                if record.get("event") in DECISION_EVENTS:
                    decisions += 1
            elif kind == "wave":
                waves.append(_wave(record, decisions))
                decisions = 0
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
