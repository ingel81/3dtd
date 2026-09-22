#!/usr/bin/env python3
"""
Turn a batch of run logs into one HTML report.

    python analyze_runs.py                          # everything under runs/
    python analyze_runs.py --out report.html
    python analyze_runs.py runs/3f2a91c7 ~/Downloads/3dtd-run-*.jsonl

Bot runs and runs a player exported are the same format (docs/RUN_LOG.md), so
both can be passed in the same call. Runs are grouped by balance state,
director parameter set and who played; two balance states in one batch are
named at the top of the report instead of being averaged together.
"""

from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

from analysis.metrics import group_runs
from analysis.report import render
from analysis.run_reader import read_runs
from analysis.summary import summarize
from config import RUNS_DIR


def main() -> int:
    parser = argparse.ArgumentParser(description="Report over a batch of run logs")
    parser.add_argument("paths", nargs="*", type=Path, help=f"files or folders (default: {RUNS_DIR}/)")
    parser.add_argument("--out", type=Path, default=Path("run-report.html"), help="where the report lands")
    parser.add_argument("--title", default="3DTD runs")
    parser.add_argument("--open", action="store_true", help="open the report when it is written")
    parser.add_argument(
        "--text",
        action="store_true",
        help="print the whole picture to the terminal instead of only writing the HTML",
    )
    parser.add_argument("--no-html", action="store_true", help="skip the HTML report")
    args = parser.parse_args()

    paths = args.paths or [Path(RUNS_DIR)]
    missing = [path for path in paths if not path.exists()]
    if missing:
        print(f"nothing to read: {', '.join(str(p) for p in missing)}", file=sys.stderr)
        return 2

    result = read_runs(paths)
    if not result.runs:
        print("no run with a finished wave found", file=sys.stderr)
        for path, reason in result.skipped[:10]:
            print(f"  {path}: {reason}", file=sys.stderr)
        return 1

    groups = group_runs(result.runs)
    if not args.no_html:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(render(groups, result.skipped, args.title), encoding="utf-8")

    if args.text:
        print(summarize(groups, len(result.skipped)))
        if not args.no_html:
            print(f"HTML: {args.out}")
        return 0

    print(f"{len(result.runs)} runs in {len(groups)} group(s) -> {args.out}")
    for group in groups:
        print(f"  {group.label}: {group.runs} runs, median wave {group.median_wave:.0f}, "
              f"{group.mismatches} mismatches")
    if result.skipped:
        print(f"  {len(result.skipped)} file(s) skipped")
    if args.open:
        webbrowser.open(args.out.resolve().as_uri())
    return 0


if __name__ == "__main__":
    sys.exit(main())
