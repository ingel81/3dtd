"""
The whole picture of a batch as text, for a terminal.

The HTML report is for looking at curves; this is for the question "did that
change work". One call, every number that decides it, nothing to assemble by
hand afterwards.

Nothing here computes anything of its own: it prints what `metrics.py` already
knows, in the order the questions are usually asked.
"""

from __future__ import annotations

from .metrics import GroupStats

#: Waves shown in the per-wave table. Past this a run is rare enough that the
#: numbers are single runs, not averages.
WAVE_ROWS = 40

#: Every nth wave in the per-wave table, so it stays readable.
WAVE_STEP = 2


def _pct(value: float | None, digits: int = 0) -> str:
    if value is None:
        return "-"
    return f"{value * 100:.{digits}f}%"


def _verdict(loop, median_wave: float) -> list[str]:
    """
    The acceptance criteria from DRAMA_CONTROLLER_PLAN.md, section 5.

    Printed as pass or fail so a round does not need a human to remember what
    the targets were.
    """
    checks = [
        ("Median-Welle über 25", median_wave > 25, f"{median_wave:.0f}"),
        ("tote Strecke höchstens 3", loop.longest_dead_streak <= 3, f"{loop.longest_dead_streak:.1f}"),
        ("am Anschlag unter 5 %", loop.pinned < 0.05, _pct(loop.pinned)),
        # Auf zehn Wellen normiert, sonst misst die Kennzahl nur die Lauflänge:
        # Ein doppelt so langer Lauf hat zwangsläufig die doppelte Spanne, weil
        # die Verteidigung über ihn hinweg wächst und der Deckel ihr folgt.
        ("Deckel-Spanne je 10 Wellen unter ×4", loop.cap_spread_per_10 < 4,
         f"×{loop.cap_spread_per_10:.1f} (roh ×{loop.cap_spread:.0f})"),
        ("über 50 % im Zielband", loop.in_band > 0.5, _pct(loop.in_band)),
    ]
    return [f"  [{'ok ' if ok else 'NEIN'}] {name}: {value}" for name, ok, value in checks]


def summarize(groups: list[GroupStats], skipped: int = 0) -> str:
    """Everything worth knowing about a batch, as plain text."""
    out: list[str] = []
    for group in groups:
        out.append("=" * 78)
        out.append(f"{group.label}  ·  {group.runs} Läufe  ·  {', '.join(sorted(group.commits))}")
        out.append("=" * 78)
        out.append(
            f"Welle: Median {group.median_wave:.0f}, Mittel {group.mean_wave:.1f}, "
            f"längste {max(group.waves_reached, default=0)}  ·  "
            f"Laufzeit Median {group.median_run_minutes:.1f} min  ·  "
            f"Abgleichfehler {group.mismatches}"
        )

        if group.loop:
            out.append("")
            out.append("Regler")
            out.extend(_verdict(group.loop, group.median_wave))
            out.append(f"  Multiplikator Median ×{group.loop.median_multiplier:.2f}")

        out.append("")
        out.append("Verlauf")
        out.append(
            f"  {'W':>3} {'Läufe':>6} {'Druck':>7} {'Ziel':>6} {'Band':>5} "
            f"{'Mult':>5} {'Deckel':>7} {'gespawnt':>9} {'HP':>6} {'Entsch':>7}"
        )
        for wave in group.per_wave:
            if wave.wave > WAVE_ROWS:
                break
            if wave.wave % WAVE_STEP and wave.wave != 1:
                continue
            out.append(
                f"  {wave.wave:>3} {wave.runs:>6.0f} {_pct(wave.pressure, 1):>7} "
                f"{_pct(wave.target_pressure, 1):>6} {_pct(wave.in_band):>5} "
                f"×{wave.loop_multiplier:>4.2f} {_pct(wave.cap_bound):>7} "
                f"{wave.spawned:>9.0f} {wave.hp_lost:>6.1f} {wave.decisions:>7.1f}"
            )

        out.append("")
        out.append("Tower über den ganzen Lauf (Breitband-Linse)")
        out.append(f"  {'Typ':<16} {'je Lauf':>8} {'Gold%':>7} {'Schaden%':>9} {'Kills%':>7} {'Dmg/Gold':>9}")
        for tower in group.towers[:10]:
            per_gold = "-" if tower.damage_per_gold is None else f"{tower.damage_per_gold:.2f}"
            out.append(
                f"  {tower.type:<16} {tower.towers:>8.1f} {_pct(tower.gold_share, 1):>7} "
                f"{_pct(tower.damage_share, 1):>9} {_pct(tower.kill_share, 1):>7} {per_gold:>9}"
            )

        if group.air_niche:
            out.append("")
            out.append("Reine Luftwellen (Nischen-Linse: hier ist jeder Schaden Luftschaden)")
            out.append(f"  {'Typ':<16} {'Schaden%':>9} {'Kills%':>7} {'steht in':>9}")
            for niche in group.air_niche[:6]:
                out.append(
                    f"  {niche.type:<16} {_pct(niche.damage_share, 1):>9} "
                    f"{_pct(niche.kill_share, 1):>7} {_pct(niche.present):>9}"
                )

        out.append("")
        out.append("Wo die Läufe enden")
        for ending in group.endings[:6]:
            out.append(f"  W{ending.wave:<3} {ending.template:<20} {ending.runs:>4} Läufe  {_pct(ending.share)}")
        out.append("")

    if skipped:
        out.append(f"{skipped} Datei(en) übersprungen (laufend oder abgeschnitten).")
    return "\n".join(out)


def compare(rounds: list[tuple[str, GroupStats]]) -> str:
    """
    Several batches side by side, one row per batch.

    What a tuning round actually needs: not the detail of one batch but
    whether the last change moved the numbers in the right direction.
    """
    out = [
        f"{'Runde':<28} {'n':>4} {'Welle':>6} {'max':>4} {'tot':>5} "
        f"{'Band':>6} {'Anschl':>7} {'Sp/10':>7} {'Mult':>6}",
        "-" * 82,
    ]
    for name, group in rounds:
        loop = group.loop
        if loop is None:
            continue
        out.append(
            f"{name:<28} {group.runs:>4} {group.median_wave:>6.0f} "
            f"{max(group.waves_reached, default=0):>4} {loop.longest_dead_streak:>5.1f} "
            f"{_pct(loop.in_band):>6} {_pct(loop.pinned):>7} "
            f"×{loop.cap_spread_per_10:>6.1f} ×{loop.median_multiplier:>5.2f}"
        )
    return "\n".join(out)
