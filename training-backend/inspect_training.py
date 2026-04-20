"""
Training Inspector — compact, scriptable snapshot of current training state.

Pulls from:
  - Dashboard HTTP API (http://localhost:3002)
  - JSONL training logs (training-backend/logs/)
  - Checkpoint directory metadata

Usage:
  python inspect_training.py                   # full report, all sections
  python inspect_training.py --api             # dashboard API only
  python inspect_training.py --log             # JSONL log only
  python inspect_training.py --client 7680     # filter everything to client
  python inspect_training.py --breakdown       # reward-breakdown fire rates
  python inspect_training.py --tail 20         # last 20 waves
  python inspect_training.py --json            # machine-readable output
  python inspect_training.py --summary         # one-liners per client
"""

import argparse
import io
import json
import statistics
import sys
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

# Force UTF-8 output so unicode arrows/em-dashes render on Windows cp1252 consoles.
# Without this, print() crashes the moment non-ASCII glyphs hit stdout.
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

DASHBOARD_BASE = "http://localhost:3002"
LOGS_DIR = Path(__file__).parent / "logs"
CHECKPOINTS_DIR = Path(__file__).parent / "checkpoints"


# ─── HTTP helpers ─────────────────────────────────────────────────────────────

def fetch_json(path: str, timeout: float = 2.0):
    url = f"{DASHBOARD_BASE}{path}"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
        return {"__error__": str(e)}


# ─── Formatting ───────────────────────────────────────────────────────────────

def fmt_stat(values, decimals=3):
    if not values:
        return "n=0"
    f = f"{{:.{decimals}f}}"
    return (
        f"n={len(values)} "
        f"last={f.format(values[-1])} "
        f"mean={f.format(statistics.fmean(values))} "
        f"min={f.format(min(values))} "
        f"max={f.format(max(values))}"
    )


def print_line(label, values, unit="", decimals=3):
    print(f"  {label:<24} {fmt_stat(values, decimals)}{unit}")


# ─── Sections ─────────────────────────────────────────────────────────────────

def report_api(client_id=None):
    print("=== DASHBOARD API (http://localhost:3002) ===")

    stats = fetch_json("/api/stats")
    if "__error__" in (stats or {}):
        print(f"  [api unreachable: {stats['__error__']}]")
        return
    print(f"  Episode:         {stats.get('episode', 0)}")
    print(f"  Training state:  {stats.get('trainingState', '?')}")
    print(f"  Avg Reward:      {stats.get('avgReward', 0):.4f}")
    print(f"  Best Reward:     {stats.get('bestReward', 0):.4f}")
    print(f"  Clients:         {stats.get('clientCount', 0)}")
    print(f"  Sweet Spot %:    {stats.get('sweetSpotPct', 0):.1f}")
    print(f"  Game Over Rate:  {stats.get('gameOverRate', 0):.1f}%")
    print(f"  Near-Miss %:     {stats.get('nearMissPct', 0):.1f}%")
    print(f"  Model Updates:   {stats.get('modelUpdates', 0)}")

    cfg = fetch_json("/api/config")
    if cfg and "__error__" not in cfg:
        print()
        print("  Reward Config:")
        print(f"    center={cfg.get('progressCenter')} sigma={cfg.get('progressSigma')} overflow>{cfg.get('overflowThreshold')} entropy={cfg.get('entropyCoef')}")

    path = f"/api/history?clientId={client_id}" if client_id else "/api/history"
    hist = fetch_json(path)
    if hist and "__error__" not in hist:
        print()
        label = f"client #{client_id}" if client_id else "ALL clients (aggregated)"
        print(f"  History — {label}:")
        if hist.get("empty"):
            print("    (no samples for this client yet)")
        else:
            rewards = hist.get("rewards", []) or []
            progress = hist.get("progress", []) or []
            nm = hist.get("nearMiss", []) or []
            print_line("reward (last100)", rewards[-100:])
            print_line("progress (last100)", progress[-100:])
            print_line("near_miss (last100)", nm[-100:])
            print_line("kill_time (last100)", (hist.get("killTimeHistory") or [])[-100:], unit="s", decimals=2)
            print_line("enemy_hp (last100)", (hist.get("enemyHpHistory") or [])[-100:], decimals=0)
            print_line("effective_dps(last100)", (hist.get("dpsHistory") or [])[-100:], decimals=0)
            if hist.get("totalCountHistory"):
                print_line("total_count (last100)", hist["totalCountHistory"][-100:], decimals=0)
            if hist.get("numGroupsHistory"):
                print_line("num_groups (last100)", hist["numGroupsHistory"][-100:], decimals=1)
            if hist.get("playerCreditsHistory"):
                print_line("credits (last100)", hist["playerCreditsHistory"][-100:], decimals=0)
            if hist.get("playerHealthHistory"):
                print_line("lives (last100)", hist["playerHealthHistory"][-100:], decimals=0)

            dist = hist.get("distribution") or {}
            total = sum(dist.values()) or 1
            print()
            print("  Progress Distribution:")
            for key in ("boring", "low", "sweet", "moderate", "danger", "gameover"):
                v = dist.get(key, 0)
                bar = "#" * int(v / total * 40)
                print(f"    {key:<10} {v:>6} ({v/total*100:>5.1f}%) {bar}")

            bd = hist.get("lastBreakdown")
            if bd:
                print()
                print("  Last reward breakdown:")
                for k, v in sorted(bd.items(), key=lambda x: -abs(x[1] or 0)):
                    if v is None or v == 0:
                        continue
                    sign = "+" if v > 0 else " "
                    print(f"    {k:<20} {sign}{v}")

        avail = hist.get("availableClients") or []
        if avail:
            print()
            print(f"  Available clients: {avail}")


def report_clients_summary():
    print("=== PER-CLIENT SUMMARY ===")
    data = fetch_json("/api/clients/summary")
    if "__error__" in (data or {}):
        print(f"  [api unreachable]")
        return
    clients = data.get("clients", []) if data else []
    if not clients:
        print("  (no clients recorded yet)")
        return
    header = f"  {'id':<8}{'waves':>8}{'GOs':>6}{'lastR':>9}{'avgR50':>9}{'avgP50':>9}  dist(sweet|dang|gover)"
    print(header)
    print(f"  {'-' * (len(header) - 2)}")
    for c in clients:
        dist = c.get("distribution", {}) or {}
        total = sum(dist.values()) or 1
        sweet = dist.get("sweet", 0) / total * 100
        dang = dist.get("danger", 0) / total * 100
        gover = dist.get("gameover", 0) / total * 100
        lr = c.get("lastReward")
        ar = c.get("avgReward50")
        ap = c.get("avgProgress50")
        print(
            f"  {c['id']:<8}"
            f"{c['totalWaves']:>8}"
            f"{c['gameOvers']:>6}"
            f"{(f'{lr:+.3f}' if lr is not None else '--'):>9}"
            f"{(f'{ar:+.3f}' if ar is not None else '--'):>9}"
            f"{(f'{ap:.2f}' if ap is not None else '--'):>9}"
            f"   {sweet:>4.0f}|{dang:>4.0f}|{gover:>4.0f}"
        )


# ─── Log parsing ──────────────────────────────────────────────────────────────

def latest_log_file():
    if not LOGS_DIR.exists():
        return None
    files = sorted(LOGS_DIR.glob("training_*.jsonl"), key=lambda p: p.stat().st_mtime)
    return files[-1] if files else None


def parse_log(path: Path, client_id: int = None):
    """Stream-parse the JSONL and bucket events. Filter by client if given."""
    buckets = {
        "event_counts": Counter(),
        "wave_results": [],
        "training_steps": [],
        "model_updates": [],
        "state_changes": [],
    }
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = o.get("type", "?")
            buckets["event_counts"][t] += 1
            if client_id is not None and "client_id" in o and o.get("client_id") != client_id:
                continue
            if t == "wave_result":
                buckets["wave_results"].append(o)
            elif t == "training_step":
                buckets["training_steps"].append(o)
            elif t == "model_update":
                buckets["model_updates"].append(o)
            elif t == "state_change":
                buckets["state_changes"].append(o)
    return buckets


def report_log(client_id=None, tail=0):
    path = latest_log_file()
    print(f"=== TRAINING LOG ({path.name if path else 'none found'}) ===")
    if not path:
        return
    size_kb = path.stat().st_size / 1024
    mtime = datetime.fromtimestamp(path.stat().st_mtime)
    print(f"  Path: {path}")
    print(f"  Size: {size_kb:.1f} KB   Modified: {mtime:%Y-%m-%d %H:%M:%S}")
    if client_id:
        print(f"  Filter: client #{client_id}")

    buckets = parse_log(path, client_id=client_id)
    print()
    print("  Event counts (global, pre-filter):")
    for k, v in buckets["event_counts"].most_common():
        print(f"    {k:<20} {v}")

    waves = buckets["wave_results"]
    if waves:
        progress = [w.get("avg_progress", 0) for w in waves]
        near_zero = sum(1 for p in progress if p < 0.05)
        near_one = sum(1 for p in progress if p > 0.95)
        print()
        print(f"  wave_results (filtered): {len(waves)}")
        print(f"    progress <0.05:  {near_zero:>5}  {near_zero/len(waves)*100:>5.1f}%")
        print(f"    progress >0.95:  {near_one:>5}  {near_one/len(waves)*100:>5.1f}%")
        print_line("avg_progress", progress)
        print_line("near_miss", [w.get("near_miss_ratio", 0) for w in waves])
        print_line("damage_pct", [w.get("damage_pct", 0) for w in waves])
        tc = [w.get("total_count") for w in waves if w.get("total_count") is not None]
        if tc:
            print_line("total_count", tc, decimals=0)
        rs = [w.get("reward") for w in waves if w.get("reward") is not None]
        if rs:
            print_line("reward", rs)

    steps = buckets["training_steps"]
    if steps:
        print()
        print(f"  training_steps (filtered): {len(steps)}")
        print_line("reward", [s.get("reward", 0) for s in steps], decimals=4)

    updates = buckets["model_updates"]
    if updates:
        print()
        print(f"  model_updates: {len(updates)}")
        print_line("policy_loss", [u.get("policy_loss", 0) for u in updates], decimals=5)
        print_line("entropy", [u.get("entropy", 0) for u in updates])
        print_line("grad_norm", [u.get("grad_norm", 0) for u in updates])
        print_line("batch_reward", [u.get("batch_avg_reward", 0) for u in updates])

    if tail > 0 and waves:
        print()
        print(f"=== LAST {tail} wave_results ===")
        for w in waves[-tail:]:
            ts = w.get("ts", "?").split("T")[-1][:8]
            cid = w.get("client_id", "?")
            print(
                f"  [{ts}] #{cid} wave={w.get('wave'):<3} "
                f"prog={w.get('avg_progress', 0):.2f} "
                f"nm={w.get('near_miss_ratio', 0):.2f} "
                f"dmg={w.get('damage_pct', 0):.2f} "
                f"n={w.get('total_count', '?')} "
                f"reward={w.get('reward', '?')}"
            )


def report_breakdown(client_id=None):
    """Analyze reward-breakdown fire rates from the log.

    Shows how often each signal (perfect/close_call/variety/...) fired and
    its average contribution. Flags dead signals (never fire = noise) and
    dominant ones (drive reward more than the core).
    """
    path = latest_log_file()
    print("=== REWARD BREAKDOWN ANALYSIS ===")
    if not path:
        return
    buckets = parse_log(path, client_id=client_id)
    steps = buckets["training_steps"]
    if not steps:
        print("  (no training_steps logged)")
        return

    fire_counts = defaultdict(int)
    sums = defaultdict(float)
    total = 0
    for s in steps:
        bd = s.get("breakdown")
        if not bd:
            continue
        total += 1
        for k, v in bd.items():
            if v is None or v == 0:
                continue
            fire_counts[k] += 1
            sums[k] += v

    if total == 0:
        print("  (no breakdowns in log yet — run training a bit then retry)")
        return

    label = f"client #{client_id}" if client_id else "ALL clients"
    print(f"  Analyzed {total} training_steps from {label}")
    print()
    print(f"  {'signal':<22}{'fires':>8}{'rate':>9}{'mean':>10}{'sum':>12}")
    print(f"  {'-' * 60}")
    for k in sorted(sums.keys(), key=lambda x: -abs(sums[x])):
        n = fire_counts[k]
        rate = n / total * 100
        mean = sums[k] / n if n else 0
        print(f"  {k:<22}{n:>8}{rate:>8.1f}%{mean:>+10.4f}{sums[k]:>+12.2f}")

    print()
    dead = [k for k in fire_counts if fire_counts[k] / total < 0.02]
    if dead:
        print(f"  [warn] signals firing <2% of the time (noise?): {', '.join(dead)}")


def report_checkpoints():
    if not CHECKPOINTS_DIR.exists():
        print("=== CHECKPOINTS === (directory missing)")
        return
    print("=== CHECKPOINTS ===")
    items = sorted(CHECKPOINTS_DIR.iterdir(), key=lambda p: p.stat().st_mtime)
    for p in items[-10:]:
        sz = p.stat().st_size / 1024 / 1024
        mt = datetime.fromtimestamp(p.stat().st_mtime)
        kind = "dir" if p.is_dir() else "file"
        print(f"  {kind:<4} {p.name:<40} {sz:>7.2f} MB  {mt:%Y-%m-%d %H:%M}")


# ─── Consolidated Report (single-call diagnosis) ─────────────────────────────

def _window_stats(xs, decimals=3):
    """Basic stats over a list with None-safety."""
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    return {
        "n": len(xs),
        "last": xs[-1],
        "mean": statistics.fmean(xs),
        "min": min(xs),
        "max": max(xs),
        "decimals": decimals,
    }


def _fmt_stats(s, unit=""):
    if not s:
        return "n=0"
    d = s["decimals"]
    f = f"{{:.{d}f}}"
    return f"n={s['n']} last={f.format(s['last'])} mean={f.format(s['mean'])} min={f.format(s['min'])} max={f.format(s['max'])}{unit}"


def _split_halves(xs):
    """Return (first_half_mean, second_half_mean) for trend detection."""
    xs = [x for x in xs if x is not None]
    if len(xs) < 10:
        return None, None
    mid = len(xs) // 2
    a = statistics.fmean(xs[:mid])
    b = statistics.fmean(xs[mid:])
    return a, b


def _trend_arrow(a, b, good_direction="up", eps=0.01):
    if a is None or b is None:
        return "?"
    if abs(b - a) < eps:
        return "="
    improving = (b > a) if good_direction == "up" else (b < a)
    return "^" if improving else "v"


def _damage_bucket(d):
    """Mirror of dashboard/app.py._damage_bucket — keep in sync."""
    if d is None:
        return None
    if d <= 0:
        return "zero"
    if d <= 0.10:
        return "sweet"
    if d <= 0.25:
        return "neutral"
    if d <= 0.50:
        return "hard"
    return "overwhelm"


def report_full():
    """One-shot consolidated training diagnosis.

    Pulls everything needed to judge training health and prints a compact
    report with executive summary, per-client breakdown, trend halves, and
    rule-based red flags / suggested actions.

    Updated for the Damage-Zone + Near-Miss reward model (2026-04-17).
    Key signal-name mapping changed:
      OLD progress (Gaussian peak)  → NEW damage_zone (primary)
      OLD max_progress / close_call  → absorbed into damage_zone/near_miss
      OLD perfect_penalty           → built into damage_zone
      OLD mixed_diversity           → mixed
    """
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"=== TRAINING HEALTH REPORT ({now}) ===")
    print()

    # 1. Live stats
    stats = fetch_json("/api/stats")
    cfg = fetch_json("/api/config")
    summary = fetch_json("/api/clients/summary")
    hist = fetch_json("/api/history")

    if not stats or "__error__" in stats:
        print(f"  [backend unreachable at {DASHBOARD_BASE}]")
        print("  Start the training server and retry.")
        return

    episode = stats.get("episode", 0)
    state = stats.get("trainingState", "?")
    clients = stats.get("clientCount", 0)
    avg_r = stats.get("avgReward", 0)
    best_r = stats.get("bestReward", 0)
    sweet_pct = stats.get("sweetSpotPct", 0)
    go_rate = stats.get("gameOverRate", 0)

    # 2. Parse the JSONL log for deeper signals
    log_path = latest_log_file()
    log_buckets = parse_log(log_path, client_id=None) if log_path else None

    # 3. Reward breakdown totals (signals that actually fire vs. dead)
    fire_counts = defaultdict(int)
    fire_sums = defaultdict(float)
    total_steps = 0
    if log_buckets:
        for s in log_buckets["training_steps"]:
            bd = s.get("breakdown")
            if not bd:
                continue
            total_steps += 1
            for k, v in bd.items():
                if v is None or v == 0:
                    continue
                fire_counts[k] += 1
                fire_sums[k] += v

    # 4. Trend halves (first-half vs second-half of whatever we have)
    rewards_log = [s.get("reward", 0) for s in (log_buckets["training_steps"] if log_buckets else [])]
    updates = log_buckets["model_updates"] if log_buckets else []
    entropy_series = [u.get("entropy", 0) for u in updates]
    progress_series = [w.get("avg_progress", 0) for w in (log_buckets["wave_results"] if log_buckets else [])]
    count_series = [w.get("total_count") for w in (log_buckets["wave_results"] if log_buckets else []) if w.get("total_count") is not None]
    damage_series = [w.get("damage_pct", 0) for w in (log_buckets["wave_results"] if log_buckets else []) if w.get("damage_pct") is not None]

    r_early, r_late = _split_halves(rewards_log)
    p_early, p_late = _split_halves(progress_series)
    e_early, e_late = _split_halves(entropy_series)
    c_early, c_late = _split_halves(count_series)
    d_early, d_late = _split_halves(damage_series)

    # Damage-zone histogram
    damage_zones = {"zero": 0, "sweet": 0, "neutral": 0, "hard": 0, "overwhelm": 0}
    for d in damage_series:
        bucket = _damage_bucket(d)
        if bucket in damage_zones:
            damage_zones[bucket] += 1
    total_damage_samples = sum(damage_zones.values())

    # 5. Red-flag detection
    flags = []

    # Damage-zone health (primary signal under new reward model)
    if total_damage_samples >= 20:
        sweet_dmg_pct = damage_zones["sweet"] / total_damage_samples * 100
        overwhelm_dmg_pct = damage_zones["overwhelm"] / total_damage_samples * 100
        if sweet_dmg_pct < 15:
            flags.append(("RED", f"Damage sweet-zone only {sweet_dmg_pct:.0f}% — AI rarely hits 1-10% damage target"))
        if overwhelm_dmg_pct > 30:
            flags.append(("RED", f"Damage overwhelm {overwhelm_dmg_pct:.0f}% of waves (>50% HP loss) — AI too aggressive"))
        if damage_zones["zero"] / total_damage_samples > 0.5:
            flags.append(("YEL", f"Zero-damage waves {damage_zones['zero']/total_damage_samples*100:.0f}% — mostly perfect waves, maybe under-pressure"))

    if progress_series and statistics.fmean(progress_series[-50:]) > 0.95:
        flags.append(("RED", f"Progress saturated at {statistics.fmean(progress_series[-50:]):.2f} — permanent overflow"))
    if e_early is not None and e_late is not None and abs(e_late - e_early) < 0.05 and len(entropy_series) >= 4:
        flags.append(("RED", f"Entropy stuck at {e_late:.2f} over {len(entropy_series)} updates — no commitment"))
    if count_series and statistics.fmean(count_series[-50:]) < 30:
        flags.append(("YEL", f"Count dim unused (avg last50 = {statistics.fmean(count_series[-50:]):.0f}) — AI not exploiting swarm waves"))

    # Dominant negative signal
    if fire_sums:
        total_neg = sum(v for v in fire_sums.values() if v < 0)
        for k, v in fire_sums.items():
            if v < 0 and total_neg < 0 and v / total_neg > 0.55:
                flags.append(("YEL", f"Signal '{k}' drives {v/total_neg*100:.0f}% of negative reward — likely over-weighted"))

    # Dead signals
    dead = []
    if total_steps > 20:
        for k, n in fire_counts.items():
            if n / total_steps < 0.02:
                dead.append(k)
    if dead:
        flags.append(("YEL", f"Signals firing <2%: {', '.join(dead)} — noise or unreachable"))

    # 6. Headline health
    if not flags:
        headline = "GREEN — training looks healthy"
    elif any(f[0] == "RED" for f in flags):
        headline = "RED — active blockers preventing learning"
    else:
        headline = "YELLOW — training functional but sub-optimal"

    # 7. Print everything
    print(f"  Episode: {episode}   State: {state}   Clients: {clients}")
    print(f"  Headline: {headline}")
    print()

    print(f"  [Reward]   avg={avg_r:+.3f}  best={best_r:+.3f}  trend={_trend_arrow(r_early, r_late, 'up')} ({_fmt_delta(r_early, r_late)})")
    if damage_series:
        mean_d = statistics.fmean(damage_series[-50:])
        sweet_dmg = damage_zones["sweet"] / total_damage_samples * 100 if total_damage_samples > 0 else 0
        print(f"  [Damage]   recent50={mean_d*100:.1f}%  sweet-zone={sweet_dmg:.0f}%  trend={_trend_arrow(d_early, d_late, 'down' if d_late and d_late > 0.15 else 'up')} ({_fmt_delta(d_early, d_late)})")
    if progress_series:
        mean_p = statistics.fmean(progress_series[-50:])
        print(f"  [Progress] recent50={mean_p:.2f}  go_rate={go_rate:.0f}%  trend={_trend_arrow(p_early, p_late, 'down')} ({_fmt_delta(p_early, p_late)})")
    if entropy_series:
        last_e = entropy_series[-1]
        print(f"  [Entropy]  {last_e:.2f}  trend={_trend_arrow(e_early, e_late, 'down')} ({_fmt_delta(e_early, e_late)})")
    if count_series:
        print(f"  [Count]    recent50={statistics.fmean(count_series[-50:]):.0f}  trend={_trend_arrow(c_early, c_late, 'up')} ({_fmt_delta(c_early, c_late)})")
    if cfg and "__error__" not in cfg:
        print(f"  [Config]   entropy_coef={cfg.get('entropyCoef')}")
    print()

    # Damage-zone histogram
    if total_damage_samples > 0:
        print("  DAMAGE-ZONE HISTOGRAM (primary reward signal)")
        for key in ("zero", "sweet", "neutral", "hard", "overwhelm"):
            v = damage_zones.get(key, 0)
            pct = v / total_damage_samples * 100
            bar = "#" * int(pct / 2.5)
            marker = " <- TARGET" if key == "sweet" else ""
            print(f"    {key:<10} {v:>5} ({pct:>5.1f}%) {bar}{marker}")
        print()

    # Signals
    if total_steps > 0:
        print(f"  SIGNALS ({total_steps} training_steps analyzed)")
        print(f"    {'signal':<22}{'fires':>7}{'rate':>8}{'mean':>10}{'sum':>11}")
        for k in sorted(fire_sums.keys(), key=lambda x: -abs(fire_sums[x])):
            n = fire_counts[k]
            rate = n / total_steps * 100
            mean = fire_sums[k] / n if n else 0
            print(f"    {k:<22}{n:>7}{rate:>7.0f}%{mean:>+10.3f}{fire_sums[k]:>+11.2f}")
        print()

    # Per-client breakdown
    if summary and "clients" in summary and summary["clients"]:
        print("  PER-CLIENT (last 50 eps)")
        print(f"    {'id':<7}{'waves':>7}{'GOs':>5}{'avgR':>8}{'avgP':>7}  {'sweet':>6}{'dang':>6}{'gover':>6}")
        for c in summary["clients"]:
            dist = c.get("distribution", {}) or {}
            total = sum(dist.values()) or 1
            sweet = dist.get("sweet", 0) / total * 100
            dang = dist.get("danger", 0) / total * 100
            gover = dist.get("gameover", 0) / total * 100
            ar = c.get("avgReward50")
            ap = c.get("avgProgress50")
            print(
                f"    {c['id']:<7}{c['totalWaves']:>7}{c['gameOvers']:>5}"
                f"{(f'{ar:+.3f}' if ar is not None else '--'):>8}"
                f"{(f'{ap:.2f}' if ap is not None else '--'):>7}"
                f"  {sweet:>5.0f}%{dang:>5.0f}%{gover:>5.0f}%"
            )
        print()

    # Distribution bar
    if hist and "distribution" in hist and hist.get("distribution"):
        dist = hist["distribution"]
        total = sum(dist.values()) or 1
        print("  PROGRESS DISTRIBUTION")
        for key in ("boring", "low", "sweet", "moderate", "danger", "gameover"):
            v = dist.get(key, 0)
            pct = v / total * 100
            bar = "#" * int(pct / 2.5)
            print(f"    {key:<10} {v:>5} ({pct:>5.1f}%) {bar}")
        print()

    # Flags
    print("  DIAGNOSIS")
    if not flags:
        print("    (no red flags detected)")
    else:
        for kind, msg in flags:
            marker = "[!!]" if kind == "RED" else "[  ]"
            print(f"    {marker} {msg}")
    print()

    # Rule-based action suggestions
    actions = _suggest_actions(flags, cfg, fire_sums, total_steps)
    if actions:
        print("  SUGGESTED ACTIONS")
        for i, a in enumerate(actions, 1):
            print(f"    {i}. {a}")
        print()

    # Log summary footer
    if log_path:
        print(f"  Log: {log_path.name}  size={log_path.stat().st_size/1024:.1f}KB  updates={len(updates)}")


def _fmt_delta(a, b):
    if a is None or b is None:
        return "--"
    return f"{a:+.2f} -> {b:+.2f}"


def _suggest_actions(flags, cfg, fire_sums, total_steps):
    """Rule-based action suggestions tailored to the damage-zone reward model."""
    actions = []
    red_flags = [f[1] for f in flags if f[0] == "RED"]
    yellow_flags = [f[1] for f in flags if f[0] == "YEL"]

    # Entropy / commitment
    if cfg and "entropyCoef" in (cfg or {}):
        if any("Entropy stuck" in f for f in red_flags):
            actions.append(f"Lower ENTROPY_COEF (currently {cfg['entropyCoef']}) -> 0.02 to force commitment")

    # Damage-zone misses
    if any("Damage sweet-zone" in f for f in red_flags):
        actions.append("AI misses 1-10% damage target. Check per-client damage-chart — 0% (too weak) or too high (overwhelm)?")
    if any("Damage overwhelm" in f for f in red_flags):
        actions.append("AI consistently overwhelms bot. Lower WAVE_COUNT_SLACK (1.25 -> 1.10) or tighten DAMAGE_HARD_THRESHOLD")
    if any("Zero-damage waves" in f for f in yellow_flags):
        actions.append("AI under-pressures bot. Increase REWARD_DAMAGE_ZERO penalty from -0.10 to -0.15, or lower DAMAGE_SWEET_MIN")

    # Progress saturation
    if any("Progress saturated" in f for f in red_flags):
        actions.append("Progress saturated. Strengthen OVERFLOW_PROGRESS_THRESHOLD (0.95) or REWARD_OVERFLOW_SLOPE (0.8)")

    # Count dimension
    if any("Count dim unused" in f for f in yellow_flags):
        actions.append("Count dim still small. Add count-bonus when total_count>50 AND damage in sweet zone")

    # Dominant negative signal
    if fire_sums:
        neg_items = [(k, v) for k, v in fire_sums.items() if v < 0]
        if neg_items:
            neg_items.sort(key=lambda x: x[1])
            dominant = neg_items[0]
            if dominant[0] in ("damage_zone", "overflow", "game_over") and total_steps > 20:
                actions.append(f"'{dominant[0]}' dominates negative reward ({dominant[1]:.1f} total). AI stuck in penalty region — inspect per-client waves")

    if not actions and not flags:
        actions.append("Keep running — no changes needed right now")
    elif not actions:
        actions.append("Flags detected but no mechanical fix — consider archiving checkpoints + config tweaks")

    return actions


# ─── JSON output mode ─────────────────────────────────────────────────────────

def report_json(client_id=None):
    """Dump a machine-readable snapshot — for scripting / CI / chat tooling."""
    stats = fetch_json("/api/stats")
    cfg = fetch_json("/api/config")
    summary = fetch_json("/api/clients/summary")
    path = f"/api/history?clientId={client_id}" if client_id else "/api/history"
    hist = fetch_json(path)

    log_path = latest_log_file()
    log_summary = None
    if log_path:
        buckets = parse_log(log_path, client_id=client_id)
        waves = buckets["wave_results"]
        log_summary = {
            "path": str(log_path),
            "event_counts": dict(buckets["event_counts"]),
            "wave_count": len(waves),
            "last_waves": waves[-10:],
            "model_updates_count": len(buckets["model_updates"]),
        }

    out = {
        "stats": stats,
        "config": cfg,
        "clients_summary": summary,
        "history": hist,
        "log": log_summary,
    }
    print(json.dumps(out, indent=2, default=str))


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", action="store_true")
    parser.add_argument("--log", action="store_true")
    parser.add_argument("--breakdown", action="store_true")
    parser.add_argument("--checkpoints", action="store_true")
    parser.add_argument("--summary", action="store_true", help="Per-client one-liner table")
    parser.add_argument("--report", action="store_true", help="One-shot consolidated health report with diagnosis")
    parser.add_argument("--client", type=int, default=None, help="Filter to client id")
    parser.add_argument("--tail", type=int, default=0, help="Show last N waves")
    parser.add_argument("--json", action="store_true", help="Machine-readable output")
    args = parser.parse_args()

    if args.json:
        report_json(client_id=args.client)
        return

    if args.report:
        report_full()
        return

    any_flag = args.api or args.log or args.breakdown or args.checkpoints or args.summary

    if args.api or not any_flag:
        report_api(client_id=args.client)
        print()
    if args.summary or not any_flag:
        report_clients_summary()
        print()
    if args.breakdown or not any_flag:
        report_breakdown(client_id=args.client)
        print()
    if args.log or args.tail or not any_flag:
        report_log(client_id=args.client, tail=args.tail)
        print()
    if args.checkpoints or not any_flag:
        report_checkpoints()


if __name__ == "__main__":
    main()
