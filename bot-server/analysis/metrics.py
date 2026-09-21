"""
The numbers a batch of runs comes to.

One group is one balance state, one director parameter set and one player
(a bot or a human). Everything is averaged over the runs of that group, per
wave, so two groups can be laid over each other
(docs/BALANCING_PLAN.md, phase 2c and 3b).

The wording follows the plan's table of metrics. Nothing here decides whether
a number is good: the target bands are set after the first baseline.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import mean, median

from .run_reader import Run, Wave

#: Spending that buys defense; a refund or the dev gold is not spending.
DEFENSE_SPENDING = ("build", "upgrade", "research", "hero")

#: Income that a run earned. Cheat gold and refunds are not earnings.
EARNED_INCOME = ("kill", "wave-bonus")


@dataclass
class WaveStats:
    """One wave number, averaged over the runs of a group."""

    wave: int
    runs: int
    hp_lost: float
    leak_rate: float
    """Share of the runs that lost HP in this wave."""
    damage_share: float
    unspent_gold: float
    """Gold lying around when the wave started, over the wave's own income."""
    gold_pressure: float
    spending: dict[str, float]
    duration_s: float
    decisions: float
    cap_bound: float
    """Share of the runs where the survivability cap held the count down."""


@dataclass
class EndingStats:
    """Where the runs of a group ended."""

    wave: int
    template: str
    runs: int
    share: float


@dataclass
class TowerStats:
    """What one tower type did over a group."""

    type: str
    towers: float
    """Build and upgrade gold that went into this type, per run."""
    gold: float
    gold_share: float
    """Damage per gold that went into this type; None while nothing was spent."""
    damage_per_gold: float | None
    damage_share: float
    kill_share: float


@dataclass
class GroupStats:
    """One balance state, one parameter set, one player."""

    config_hash: str
    director_params: str
    player: str
    runs: int
    waves_reached: list[int]
    median_wave: float
    mean_wave: float
    run_minutes: list[float]
    median_run_minutes: float
    per_wave: list[WaveStats]
    towers: list[TowerStats]
    """The last wave of each run, most common first: what actually ends runs."""
    endings: list[EndingStats]
    mismatches: int
    commits: set[str] = field(default_factory=set)
    game_versions: set[str] = field(default_factory=set)

    @property
    def label(self) -> str:
        return f"{self.player} · {self.director_params}"


def _share(part: float, whole: float) -> float:
    return part / whole if whole else 0.0


def _spent_on_defense(wave: Wave) -> float:
    return sum(float(wave.spending.get(key, 0) or 0) for key in DEFENSE_SPENDING)


def _earned(wave: Wave) -> float:
    return sum(float(wave.income.get(key, 0) or 0) for key in EARNED_INCOME)


def wave_stats(waves: list[Wave], wave_number: int) -> WaveStats:
    """The waves of one wave number, over every run that reached it."""
    hp_losses = [max(0, w.health_start - w.health_end) for w in waves]
    return WaveStats(
        wave=wave_number,
        runs=len(waves),
        hp_lost=mean(hp_losses) if hp_losses else 0.0,
        leak_rate=mean([_share(w.leaked, w.enemies_spawned) for w in waves]) if waves else 0.0,
        damage_share=_share(sum(1 for loss in hp_losses if loss > 0), len(waves)),
        unspent_gold=mean([w.credits_start for w in waves]) if waves else 0.0,
        gold_pressure=mean([_share(w.credits_start, max(1.0, _earned(w))) for w in waves]) if waves else 0.0,
        spending={
            key: mean([float(w.spending.get(key, 0) or 0) for w in waves]) if waves else 0.0
            for key in DEFENSE_SPENDING
        },
        duration_s=mean([w.duration_ms / 1000 for w in waves]) if waves else 0.0,
        decisions=mean([w.decisions for w in waves]) if waves else 0.0,
        cap_bound=_share(sum(1 for w in waves if w.survivable_count is not None), len(waves)),
    )


def tower_stats(runs: list[Run]) -> list[TowerStats]:
    """
    Damage, kills and gold per tower type, over a group.

    Damage per gold is the number that separates a type that is strong from a
    type the player picks often: a share of the damage says nothing while the
    shares of the gold are unknown (docs/BALANCING_PLAN.md, 3b).
    """
    damage: dict[str, float] = {}
    kills: dict[str, float] = {}
    gold: dict[str, float] = {}
    seen: dict[str, set[str]] = {}
    for run in runs:
        for wave in run.waves:
            for tower in wave.towers:
                type_id = str(tower.get("type") or "?")
                damage[type_id] = damage.get(type_id, 0) + float(tower.get("damage", 0) or 0)
                kills[type_id] = kills.get(type_id, 0) + float(tower.get("kills", 0) or 0)
                seen.setdefault(type_id, set()).add(str(tower.get("id")))
            for type_id, spent in wave.tower_spending.items():
                gold[type_id] = gold.get(type_id, 0) + spent

    total_damage = sum(damage.values())
    total_kills = sum(kills.values())
    total_gold = sum(gold.values())
    # A type that was bought but never fired still belongs in the table: it is
    # gold that bought nothing.
    types = set(damage) | set(gold)
    stats = [
        TowerStats(
            type=type_id,
            towers=len(seen.get(type_id, set())) / max(1, len(runs)),
            gold=gold.get(type_id, 0) / max(1, len(runs)),
            gold_share=_share(gold.get(type_id, 0), total_gold),
            damage_per_gold=(damage.get(type_id, 0) / gold[type_id]) if gold.get(type_id) else None,
            damage_share=_share(damage.get(type_id, 0), total_damage),
            kill_share=_share(kills.get(type_id, 0), total_kills),
        )
        for type_id in sorted(types, key=lambda t: damage.get(t, 0), reverse=True)
    ]
    return stats


def endings(runs: list[Run]) -> list[EndingStats]:
    """
    The wave each run died in, counted.

    A median says how far a group gets; this says what stops it. Five
    templates in a row that each want a different counter show up here as five
    entries and nowhere else (docs/BALANCING_PLAN.md, Baseline).
    """
    counted: dict[tuple[int, str], int] = {}
    for run in runs:
        if not run.waves:
            continue
        last = run.waves[-1]
        key = (last.wave, last.template or "?")
        counted[key] = counted.get(key, 0) + 1
    total = sum(counted.values())
    return [
        EndingStats(wave=wave, template=template, runs=count, share=_share(count, total))
        for (wave, template), count in sorted(counted.items(), key=lambda kv: (-kv[1], kv[0]))
    ]


def group_stats(runs: list[Run]) -> GroupStats:
    """Everything one group comes to."""
    waves_reached = [run.wave_reached for run in runs]
    run_minutes = [
        sum(w.duration_ms for w in run.waves) / 60_000
        for run in runs
    ]
    longest = max(waves_reached, default=0)

    per_wave: list[WaveStats] = []
    for number in range(1, longest + 1):
        waves = [w for run in runs for w in run.waves if w.wave == number]
        if waves:
            per_wave.append(wave_stats(waves, number))

    first = runs[0]
    return GroupStats(
        config_hash=first.config_hash,
        director_params=first.director_params,
        player=first.bot or first.player,
        runs=len(runs),
        waves_reached=waves_reached,
        median_wave=median(waves_reached) if waves_reached else 0.0,
        mean_wave=mean(waves_reached) if waves_reached else 0.0,
        run_minutes=run_minutes,
        median_run_minutes=median(run_minutes) if run_minutes else 0.0,
        per_wave=per_wave,
        towers=tower_stats(runs),
        endings=endings(runs),
        mismatches=sum(len(w.mismatches) for run in runs for w in run.waves),
        commits={run.commit for run in runs},
        game_versions={run.game_version for run in runs},
    )


def group_runs(runs: list[Run]) -> list[GroupStats]:
    """Group by balance state, parameter set and player; biggest group first."""
    groups: dict[tuple[str, str, str], list[Run]] = {}
    for run in runs:
        groups.setdefault(run.key, []).append(run)
    return sorted(
        (group_stats(group) for group in groups.values()),
        key=lambda g: (-g.runs, g.label),
    )


def mixed_balance(groups: list[GroupStats]) -> set[str]:
    """
    The balance states in the batch, when there is more than one.

    Two states must never land in the same average: a changed table moves
    every number. The report says so at the top rather than quietly mixing.
    """
    hashes = {group.config_hash for group in groups}
    return hashes if len(hashes) > 1 else set()
