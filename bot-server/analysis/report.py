"""
The HTML report.

One page, no dependencies: the charts are inline SVG, so the file opens from
disk, years from now, without a CDN (decision D13 asks for curves per wave,
not for a dashboard).

Every chart lays the groups over each other: that is the whole point, seeing
the beginner against the expert, or one parameter set against another.
"""

from __future__ import annotations

import html
from datetime import datetime

from .metrics import GroupStats, mixed_balance

#: One colour per group, in order.
COLORS = ["#7cc4ff", "#ffb26b", "#7ddc8f", "#ff7b7b", "#c9a0ff", "#ffe08a"]

WIDTH = 820
HEIGHT = 240
PAD_LEFT = 52
PAD_BOTTOM = 28
PAD_TOP = 12
PAD_RIGHT = 12


def _color(index: int) -> str:
    return COLORS[index % len(COLORS)]


def _polyline(points: list[tuple[float, float]], x_max: float, y_max: float, color: str) -> str:
    if not points:
        return ""
    plot_w = WIDTH - PAD_LEFT - PAD_RIGHT
    plot_h = HEIGHT - PAD_TOP - PAD_BOTTOM
    coords = []
    for x, y in points:
        px = PAD_LEFT + (x / x_max if x_max else 0) * plot_w
        py = PAD_TOP + plot_h - (y / y_max if y_max else 0) * plot_h
        coords.append(f"{px:.1f},{py:.1f}")
    return f'<polyline fill="none" stroke="{color}" stroke-width="2" points="{" ".join(coords)}" />'


def _chart(title: str, subtitle: str, series: list[tuple[str, str, list[tuple[float, float]]]]) -> str:
    """A line chart: `series` is (label, colour, points), points are (wave, value)."""
    x_max = max((x for _, _, points in series for x, _ in points), default=1)
    y_max = max((y for _, _, points in series for _, y in points), default=1) or 1
    plot_w = WIDTH - PAD_LEFT - PAD_RIGHT
    plot_h = HEIGHT - PAD_TOP - PAD_BOTTOM

    grid = []
    for i in range(5):
        y = PAD_TOP + plot_h - (i / 4) * plot_h
        value = y_max * i / 4
        grid.append(f'<line x1="{PAD_LEFT}" y1="{y:.1f}" x2="{WIDTH - PAD_RIGHT}" y2="{y:.1f}" class="grid" />')
        grid.append(f'<text x="{PAD_LEFT - 6}" y="{y + 4:.1f}" class="tick" text-anchor="end">{value:,.4g}</text>')
    for i in range(5):
        x = PAD_LEFT + (i / 4) * plot_w
        grid.append(
            f'<text x="{x:.1f}" y="{HEIGHT - 8}" class="tick" text-anchor="middle">{x_max * i / 4:,.0f}</text>'
        )

    lines = [_polyline(points, x_max, y_max, color) for _, color, points in series]
    legend = " ".join(
        f'<span class="key"><i style="background:{color}"></i>{html.escape(label)}</span>'
        for label, color, _ in series
    )

    return f"""
    <section class="chart">
      <h3>{html.escape(title)}</h3>
      <p class="sub">{html.escape(subtitle)}</p>
      <div class="legend">{legend}</div>
      <svg viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-label="{html.escape(title)}">
        {''.join(grid)}
        {''.join(lines)}
      </svg>
      <p class="axis">wave</p>
    </section>
    """


def _series(groups: list[GroupStats], value) -> list[tuple[str, str, list[tuple[float, float]]]]:
    return [
        (group.label, _color(i), [(w.wave, value(w)) for w in group.per_wave])
        for i, group in enumerate(groups)
    ]


def _summary_table(groups: list[GroupStats]) -> str:
    rows = "".join(
        f"""<tr>
          <td><span class="key"><i style="background:{_color(i)}"></i>{html.escape(group.label)}</span></td>
          <td>{group.runs}</td>
          <td>{group.median_wave:.0f}</td>
          <td>{group.mean_wave:.1f}</td>
          <td>{group.median_run_minutes:.1f}</td>
          <td>{html.escape(group.config_hash)}</td>
          <td>{html.escape(', '.join(sorted(group.commits)))}</td>
          <td class="{'bad' if group.mismatches else ''}">{group.mismatches}</td>
        </tr>"""
        for i, group in enumerate(groups)
    )
    return f"""
    <table class="summary">
      <thead>
        <tr>
          <th>group</th><th>runs</th><th>median wave</th><th>mean wave</th>
          <th>median minutes</th><th>balance</th><th>commit</th><th>mismatches</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
    """


def _tower_table(group: GroupStats) -> str:
    rows = "".join(
        f"""<tr>
          <td>{html.escape(tower.type)}</td>
          <td>{tower.towers:.1f}</td>
          <td>{tower.damage_share * 100:.1f}%</td>
          <td>{tower.kill_share * 100:.1f}%</td>
        </tr>"""
        for tower in group.towers[:12]
    )
    return f"""
    <section class="towers">
      <h3>Towers · {html.escape(group.label)}</h3>
      <p class="sub">Share of damage and kills per type. A type that carries everything is a balance problem.</p>
      <table>
        <thead><tr><th>type</th><th>per run</th><th>damage</th><th>kills</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </section>
    """


def _endings_table(group: GroupStats) -> str:
    """Where the runs of one group ended. The median says how far, this says what stopped them."""
    rows = "".join(
        f"""<tr>
          <td>{ending.wave}</td>
          <td>{html.escape(ending.template)}</td>
          <td>{ending.runs}</td>
          <td>{ending.share * 100:.0f}%</td>
        </tr>"""
        for ending in group.endings[:12]
    )
    return f"""
    <section class="endings">
      <h3>Where the runs end · {html.escape(group.label)}</h3>
      <p class="sub">The last wave of each run. Several templates sharing the top says the campaign
      asks for several counters in a row, and a roster missing one loses the chain, not a wave.</p>
      <table>
        <thead><tr><th>wave</th><th>template</th><th>runs</th><th>share</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </section>
    """


def render(groups: list[GroupStats], skipped: list[tuple], title: str = "3DTD runs") -> str:
    """The whole page."""
    mixed = mixed_balance(groups)
    warning = ""
    if mixed:
        warning = (
            '<p class="warn">Two balance states in one batch: '
            + html.escape(", ".join(sorted(mixed)))
            + ". Their numbers do not belong in the same average.</p>"
        )
    if skipped:
        warning += (
            f'<p class="warn">{len(skipped)} file(s) skipped: '
            + html.escape(", ".join(f"{path.name} ({reason})" for path, reason in skipped[:5]))
            + ("…" if len(skipped) > 5 else "")
            + "</p>"
        )

    charts = [
        _chart(
            "HP lost per wave",
            "How much the base pays for a wave. Flat at zero means the waves are not testing anything.",
            _series(groups, lambda w: w.hp_lost),
        ),
        _chart(
            "Waves that cost HP",
            "Share of the runs that lost HP in this wave. The plan's pressure metric.",
            _series(groups, lambda w: w.damage_share),
        ),
        _chart(
            "Leak rate",
            "Enemies that reached the base, over the enemies the wave spawned.",
            _series(groups, lambda w: w.leak_rate),
        ),
        _chart(
            "Gold lying around at the start of the wave",
            "Over the wave's own income. Above 1 the player is hoarding: there was nothing worth buying.",
            _series(groups, lambda w: w.gold_pressure),
        ),
        _chart(
            "Spending on defense per wave",
            "Towers, upgrades, research and the hero together.",
            _series(groups, lambda w: sum(w.spending.values())),
        ),
        _chart(
            "Decisions per wave",
            "Builds, upgrades, sales, research, abilities. Near zero means the wave asked nothing of the player.",
            _series(groups, lambda w: w.decisions),
        ),
        _chart(
            "Wave duration",
            "Seconds of game time from the start of the wave to its end.",
            _series(groups, lambda w: w.duration_s),
        ),
        _chart(
            "Runs still alive",
            "How many runs of the group reached this wave.",
            _series(groups, lambda w: w.runs),
        ),
        _chart(
            "Survivability cap binding",
            "Share of the runs whose wave was cut by the cap. Near 1 the size of a wave is a"
            " formula over the defense, not a decision of the campaign.",
            _series(groups, lambda w: w.cap_bound),
        ),
    ]

    towers = "".join(_tower_table(group) for group in groups)
    endings = "".join(_endings_table(group) for group in groups)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>{html.escape(title)}</title>
<style>
  :root {{ --bg:#12151a; --panel:#1a1f27; --line:#2b323d; --text:#e6e9ee; --muted:#8b95a5; --err:#ff7b7b; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; padding:24px; background:var(--bg); color:var(--text);
         font:14px/1.5 ui-monospace,"Cascadia Code",Consolas,monospace; }}
  h1 {{ font-size:18px; margin:0 0 4px; }}
  h3 {{ font-size:13px; margin:0 0 2px; }}
  .sub, .axis, .tick {{ color:var(--muted); font-size:11px; }}
  .sub {{ margin:0 0 8px; }}
  .axis {{ margin:2px 0 0; text-align:center; }}
  .warn {{ color:var(--err); }}
  section {{ background:var(--panel); border:1px solid var(--line); border-radius:8px;
             padding:12px 16px; margin:12px 0; }}
  svg {{ width:100%; height:auto; }}
  .grid {{ stroke:#2b323d; stroke-width:1; }}
  .legend {{ margin-bottom:6px; }}
  .key {{ display:inline-flex; align-items:center; gap:6px; margin-right:12px; font-size:12px; }}
  .key i {{ width:10px; height:10px; border-radius:2px; display:inline-block; }}
  table {{ width:100%; border-collapse:collapse; }}
  th, td {{ text-align:left; padding:6px 10px; border-bottom:1px solid var(--line); font-size:12px; }}
  th {{ color:var(--muted); }}
  td.bad {{ color:var(--err); }}
</style>
</head>
<body>
  <h1>{html.escape(title)}</h1>
  <p class="sub">{datetime.now().strftime('%Y-%m-%d %H:%M')} · {sum(g.runs for g in groups)} runs</p>
  {warning}
  {_summary_table(groups)}
  {''.join(charts)}
  {endings}
  {towers}
</body>
</html>
"""
