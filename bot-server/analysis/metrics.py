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
    #: Share of the standing HP the wave cost, the pressure loop's own metric.
    pressure: float
    #: What it was meant to cost. 0 for logs written before format 3.
    target_pressure: float
    #: Share of the waves whose pressure landed inside the target band.
    in_band: float
    #: Median multiplier of the closed loop.
    loop_multiplier: float
    #: Share of the waves where the loop sat on one of its stops.
    loop_pinned: float
    #: Median enemies the wave actually spawned.
    spawned: float
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
class NicheStats:
    """
    A tower type inside the waves it exists for.

    Damage per gold over a whole run is the wrong lens for a specialist. An
    ice tower is bought to slow, not to kill, and an anti-air tower is bought
    for the waves nothing else answers. Judged over every wave they read as
    dead weight; the question that matters is whether they carry the waves
    they are for.
    """

    type: str
    #: Share of the damage dealt in those waves.
    damage_share: float
    #: Share of the kills in those waves.
    kill_share: float
    #: Share of those waves the type was even standing in.
    present: float


@dataclass
class LoopStats:
    """How the closed loop behaved over a run, not over a wave number."""

    #: Longest run of consecutive waves that cost no HP at all.
    longest_dead_streak: float
    #: Share of waves inside the target band.
    in_band: float
    #: Share of waves where the multiplier sat on a stop.
    pinned: float
    #: Smallest and largest survivability cap seen, as a spread factor.
    cap_spread: float
    #: The same spread normalised to ten waves.
    #:
    #: The raw spread grows with the length of a run, because the defense does
    #: too and the cap has to follow it. Comparing a 25-wave baseline with a
    #: 47-wave run on the raw number says only that the second one is longer.
    #: Geometric, because the cap grows multiplicatively.
    cap_spread_per_10: float
    #: Median multiplier over every wave.
    median_multiplier: float


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
    #: Tower damage inside pure air waves, the lens for an anti-air specialist.
    air_niche: list[NicheStats] = field(default_factory=list)
    loop: LoopStats | None = None
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


#: The stops of the pressure loop (pressure-controller.ts). A multiplier that
#: sits on one of them is not regulating any more, it is saturated.
LOOP_MULT_MIN = 0.5
LOOP_MULT_MAX = 20.0

#: Band around the target inside which the loop holds, as factors.
BAND_LO = 0.5
BAND_HI = 1.5


def _pinned(multiplier: float) -> bool:
    return multiplier <= LOOP_MULT_MIN * 1.02 or multiplier >= LOOP_MULT_MAX * 0.98


def _in_band(wave: Wave) -> bool:
    """Did this wave cost roughly what it was meant to cost?"""
    target, actual = wave.target_pressure, wave.pressure
    if not target or actual is None:
        return False
    return target * BAND_LO <= actual <= target * BAND_HI


def wave_stats(waves: list[Wave], wave_number: int) -> WaveStats:
    """The waves of one wave number, over every run that reached it."""
    hp_losses = [max(0, w.health_start - w.health_end) for w in waves]
    pressures = [w.pressure for w in waves if w.pressure is not None]
    targets = [w.target_pressure for w in waves if w.target_pressure]
    mults = [w.loop_multiplier for w in waves if w.loop_multiplier is not None]
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
        pressure=mean(pressures) if pressures else 0.0,
        target_pressure=mean(targets) if targets else 0.0,
        in_band=_share(sum(1 for w in waves if _in_band(w)), len(waves)),
        loop_multiplier=median(mults) if mults else 0.0,
        loop_pinned=_share(sum(1 for m in mults if _pinned(m)), len(mults)) if mults else 0.0,
        spawned=median([w.enemies_spawned for w in waves]) if waves else 0.0,
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


#: The flying enemies, from `isAirUnit` in enemy-types.config.ts. A copy,
#: because the analysis does not read the game's TypeScript; if a flyer is
#: added there and not here, the air niche below simply sees fewer waves.
AIR_ENEMIES = frozenset({"bat", "hornet", "dragon"})


def air_niche(runs: list[Run]) -> list[NicheStats]:
    """
    What each tower type contributed in the waves made entirely of flyers.

    In those waves every point of damage is damage against air, so the shares
    answer the only question an anti-air tower can be asked: of the defense
    that was standing, how much of the work did it do.
    """
    damage: dict[str, float] = {}
    kills: dict[str, float] = {}
    present: dict[str, int] = {}
    waves = 0
    for run in runs:
        for wave in run.waves:
            if not wave.composition:
                continue
            if not all(e.get("type") in AIR_ENEMIES for e in wave.composition):
                continue
            waves += 1
            seen = set()
            for tower in wave.towers:
                kind = tower.get("type")
                if not kind:
                    continue
                damage[kind] = damage.get(kind, 0.0) + float(tower.get("damage", 0) or 0)
                kills[kind] = kills.get(kind, 0.0) + float(tower.get("kills", 0) or 0)
                seen.add(kind)
            for kind in seen:
                present[kind] = present.get(kind, 0) + 1

    total_damage = sum(damage.values())
    total_kills = sum(kills.values())
    stats = [
        NicheStats(
            type=kind,
            damage_share=_share(value, total_damage),
            kill_share=_share(kills.get(kind, 0.0), total_kills),
            present=_share(present.get(kind, 0), waves),
        )
        for kind, value in damage.items()
    ]
    return sorted(stats, key=lambda n: -n.damage_share)


def loop_stats(runs: list[Run]) -> LoopStats:
    """
    Whether the closed loop regulated or merely swung.

    The three numbers that separate the two: how long the player went without
    losing anything, how often the loop sat on a stop instead of steering,
    and how far the cap travelled inside one run. A working loop holds a
    narrow cap and a short dead streak.
    """
    dead_streaks: list[int] = []
    spreads: list[float] = []
    mults: list[float] = []
    in_band = 0
    pinned = 0
    counted = 0
    for run in runs:
        streak = longest = 0
        caps = [w.survivable_count for w in run.waves if w.survivable_count]
        for wave in run.waves:
            if wave.health_start - wave.health_end <= 0:
                streak += 1
                longest = max(longest, streak)
            else:
                streak = 0
            if wave.loop_multiplier is not None:
                mults.append(wave.loop_multiplier)
                counted += 1
                if _pinned(wave.loop_multiplier):
                    pinned += 1
            if _in_band(wave):
                in_band += 1
        dead_streaks.append(longest)
        if caps:
            spreads.append(max(caps) / max(1, min(caps)))

    waves = sum(len(run.waves) for run in runs)
    spread = median(spreads) if spreads else 0.0
    run_length = median([len(run.waves) for run in runs]) if runs else 0
    per_10 = spread ** (10 / run_length) if spread > 0 and run_length > 0 else 0.0
    return LoopStats(
        longest_dead_streak=mean(dead_streaks) if dead_streaks else 0.0,
        in_band=_share(in_band, waves),
        pinned=_share(pinned, counted),
        cap_spread=spread,
        cap_spread_per_10=per_10,
        median_multiplier=median(mults) if mults else 0.0,
    )


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
        air_niche=air_niche(runs),
        loop=loop_stats(runs),
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
