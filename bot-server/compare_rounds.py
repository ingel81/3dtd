#!/usr/bin/env python3
"""
Every tuning round side by side.

    python compare_rounds.py                 # every folder under runs/
    python compare_rounds.py runs/a runs/b   # only these

One row per round and player, so a change is judged against the round before
it rather than against a memory of it. The folders are the rounds: each one is
named for the change it carries (docs/DRAMA_CONTROLLER_PLAN.md, section 6).
"""

from __future__ import annotations

import sys
from pathlib import Path

from analysis.metrics import group_runs
from analysis.run_reader import read_runs
from analysis.summary import compare
from config import RUNS_DIR


def main() -> int:
    paths = [Path(p) for p in sys.argv[1:]]
    if not paths:
        paths = sorted(p for p in Path(RUNS_DIR).iterdir() if p.is_dir())

    rounds = []
    for path in paths:
        result = read_runs([path])
        if not result.runs:
            continue
        for group in group_runs(result.runs):
            who = "expert" if "expert" in group.label else "beginner"
            rounds.append((f"{path.name} · {who}", group))

    if not rounds:
        print("no runs found", file=sys.stderr)
        return 1
    print(compare(rounds))
    return 0


if __name__ == "__main__":
    sys.exit(main())
