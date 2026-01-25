#!/usr/bin/env python3
"""
Training Log Analyzer - Full session analysis with AI parameter tracking

Analyzes:
- Reward trends per 2000-episode chunks
- Enemy type distribution
- AI parameters: kill_time, enemy_hp, effective_dps
- Type cooldown effectiveness
- Drift detection
"""
import json
import sys
from collections import defaultdict
from pathlib import Path


def analyze_log(filepath):
    episodes = []
    waves = []
    enemy_type_counts = defaultdict(int)
    game_overs = 0
    total_waves = 0
    cooldown_overrides = 0

    # AI parameter tracking
    kill_times = []
    enemy_hps = []
    effective_dps_values = []
    count_factors = []
    delay_factors = []
    variations = []

    # Type probability tracking (for bias detection)
    type_prob_sums = defaultdict(float)
    type_prob_count = 0

    # Progress distribution tracking
    progress_values = []

    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            try:
                entry = json.loads(line.strip())

                if entry.get('type') == 'training_step':
                    episodes.append({
                        'episode': entry.get('episode', 0),
                        'reward': entry.get('reward', 0),
                        'avg_reward': entry.get('avg_reward', 0),
                        'breakdown': entry.get('breakdown', {}),
                    })

                elif entry.get('type') == 'wave_generated':
                    enemy_type_counts[entry.get('enemy_type', 'unknown')] += 1
                    total_waves += 1

                    # Track AI parameters
                    if entry.get('kill_time') is not None:
                        kill_times.append(entry['kill_time'])
                    if entry.get('enemy_hp') is not None:
                        enemy_hps.append(entry['enemy_hp'])
                    if entry.get('effective_dps') is not None:
                        effective_dps_values.append(entry['effective_dps'])
                    if entry.get('count_factor') is not None:
                        count_factors.append(entry['count_factor'])
                    if entry.get('delay_factor') is not None:
                        delay_factors.append(entry['delay_factor'])
                    if entry.get('variation') is not None:
                        variations.append(entry['variation'])

                    # Track cooldown overrides
                    if entry.get('cooldown_override'):
                        cooldown_overrides += 1

                    # Track type probabilities
                    if entry.get('type_probs'):
                        type_prob_count += 1
                        for t, p in entry['type_probs'].items():
                            type_prob_sums[t] += p

                    waves.append(entry)

                elif entry.get('type') == 'wave_result':
                    avg_prog = entry.get('avg_progress')
                    if avg_prog is not None:
                        progress_values.append(avg_prog)

                elif entry.get('type') == 'episode_end':
                    if entry.get('reason') == 'game_over':
                        game_overs += 1

            except json.JSONDecodeError:
                continue

    if not episodes:
        print("No episodes found!")
        return

    # Overall stats
    total_eps = len(episodes)
    print(f"\n{'='*70}")
    print(f"TRAINING LOG ANALYSIS - {total_eps} Episodes, {total_waves} Waves")
    print(f"{'='*70}\n")

    # Chunk analysis (every 2000 episodes)
    chunk_size = 2000
    print(f"{'Episode Range':<18} {'Avg Reward':>12} {'Sweet%':>10} {'GO%':>8} {'Trend':>10}")
    print("-" * 70)

    prev_avg = None
    chunk_data = []

    for i in range(0, total_eps, chunk_size):
        chunk = episodes[i:i+chunk_size]
        if not chunk:
            continue

        avg_reward = sum(e['reward'] for e in chunk) / len(chunk)

        # Count sweet spot (progress between 0.4 and 0.7)
        sweet_count = 0
        go_count = 0
        for e in chunk:
            prog = e['breakdown'].get('progress', 0)
            if prog > 0.5:  # Good progress reward means sweet spot
                sweet_count += 1
            if e['breakdown'].get('game_over', 0) < 0:
                go_count += 1

        sweet_pct = (sweet_count / len(chunk)) * 100
        go_pct = (go_count / len(chunk)) * 100

        # Trend indicator
        if prev_avg is None:
            trend = "---"
        elif avg_reward > prev_avg + 0.02:
            trend = "^ UP"
        elif avg_reward < prev_avg - 0.02:
            trend = "v DOWN"
        else:
            trend = "= stable"

        ep_start = chunk[0]['episode']
        ep_end = chunk[-1]['episode']
        print(f"E{ep_start:>5} - {ep_end:<6} {avg_reward:>12.4f} {sweet_pct:>9.1f}% {go_pct:>7.1f}% {trend:>10}")

        chunk_data.append({
            'start': ep_start,
            'end': ep_end,
            'avg_reward': avg_reward,
            'sweet_pct': sweet_pct,
            'go_pct': go_pct,
        })
        prev_avg = avg_reward

    # Enemy type distribution
    print(f"\n{'='*70}")
    print("ENEMY TYPE DISTRIBUTION")
    print("-" * 50)
    for etype, count in sorted(enemy_type_counts.items(), key=lambda x: -x[1]):
        pct = (count / total_waves) * 100 if total_waves > 0 else 0
        bar = "#" * int(pct / 2)
        print(f"  {etype:<12} {count:>6} ({pct:>5.1f}%) {bar}")

    # Type cooldown effectiveness
    if total_waves > 0:
        cooldown_pct = (cooldown_overrides / total_waves) * 100
        print(f"\n  Cooldown Overrides: {cooldown_overrides}/{total_waves} ({cooldown_pct:.1f}%)")

    # Average type probabilities (shows model bias)
    if type_prob_count > 0:
        print(f"\n  Average Type Probabilities (Model Bias):")
        sorted_probs = sorted(type_prob_sums.items(), key=lambda x: -x[1])
        for t, psum in sorted_probs:
            avg_prob = (psum / type_prob_count) * 100
            ideal = 100 / len(type_prob_sums)  # Ideal uniform distribution
            bias = avg_prob - ideal
            bias_str = f"+{bias:.1f}" if bias > 0 else f"{bias:.1f}"
            bar = "#" * int(avg_prob / 2)
            print(f"    {t:<12} {avg_prob:>5.1f}% (bias: {bias_str:>6}%) {bar}")

    # AI Parameters Analysis
    print(f"\n{'='*70}")
    print("AI PARAMETER ANALYSIS")
    print("-" * 50)

    def stats(values, name, unit=""):
        if not values:
            return
        avg = sum(values) / len(values)
        min_v = min(values)
        max_v = max(values)
        # Calculate percentiles
        sorted_v = sorted(values)
        p10 = sorted_v[len(sorted_v) // 10] if len(sorted_v) >= 10 else min_v
        p90 = sorted_v[len(sorted_v) * 9 // 10] if len(sorted_v) >= 10 else max_v
        print(f"  {name}:")
        print(f"    Avg: {avg:.2f}{unit}  Min: {min_v:.2f}{unit}  Max: {max_v:.2f}{unit}")
        print(f"    P10: {p10:.2f}{unit}  P90: {p90:.2f}{unit}")

    stats(kill_times, "Kill Time", "s")
    stats(enemy_hps, "Enemy HP", "")
    stats(effective_dps_values, "Effective DPS", "")
    stats(count_factors, "Count Factor", "")
    stats(delay_factors, "Delay Factor", "")
    stats(variations, "Variation", "")

    # Progress Distribution Analysis
    if progress_values:
        print(f"\n{'='*70}")
        print("PROGRESS DISTRIBUTION (avg_progress per wave)")
        print("-" * 50)

        # Categorize progress values
        boring = sum(1 for p in progress_values if p < 0.20)  # Too easy
        low = sum(1 for p in progress_values if 0.20 <= p < 0.40)
        sweet = sum(1 for p in progress_values if 0.40 <= p < 0.70)  # TARGET
        moderate = sum(1 for p in progress_values if 0.70 <= p < 0.85)
        danger = sum(1 for p in progress_values if p >= 0.85)  # Too hard

        total = len(progress_values)

        categories = [
            ("Boring", boring, "<20%", "var(--accent-blue)", "Too easy - enemies die instantly"),
            ("Low", low, "20-40%", "var(--text-muted)", "Easy - enemies don't get far"),
            ("Sweet", sweet, "40-70%", "var(--accent-green)", "TARGET - balanced waves"),
            ("Moderate", moderate, "70-85%", "var(--accent-orange)", "Hard - many enemies pass"),
            ("Danger/GO", danger, ">85%", "var(--accent-red)", "Too hard - overwhelmed"),
        ]

        print(f"\n  {'Category':<12} {'Count':>7} {'Percent':>9}  Bar")
        print("  " + "-" * 48)

        for name, count, range_str, _, desc in categories:
            pct = (count / total) * 100 if total > 0 else 0
            bar_len = int(pct / 2)
            bar_char = "#" if name == "Sweet" else "=" if name in ["Low", "Moderate"] else "-"
            bar = bar_char * bar_len
            marker = " <-- TARGET" if name == "Sweet" else ""
            print(f"  {name:<12} {count:>7} {pct:>8.1f}%  {bar}{marker}")

        # Summary
        print(f"\n  Summary:")
        too_easy = boring + low
        just_right = sweet
        too_hard = moderate + danger

        too_easy_pct = (too_easy / total) * 100 if total > 0 else 0
        just_right_pct = (just_right / total) * 100 if total > 0 else 0
        too_hard_pct = (too_hard / total) * 100 if total > 0 else 0

        print(f"    Too Easy  (<40%):  {too_easy:>5} ({too_easy_pct:>5.1f}%)")
        print(f"    Sweet Spot (40-70%): {just_right:>5} ({just_right_pct:>5.1f}%) <-- TARGET: >40%")
        print(f"    Too Hard  (>70%):  {too_hard:>5} ({too_hard_pct:>5.1f}%)")

        # Avg progress
        avg_progress = sum(progress_values) / len(progress_values)
        print(f"\n    Avg Progress: {avg_progress:.1%} (Target: 55%)")

        # Recent trend (last 200 waves)
        if len(progress_values) >= 200:
            recent = progress_values[-200:]
            recent_avg = sum(recent) / len(recent)
            recent_sweet = sum(1 for p in recent if 0.40 <= p < 0.70)
            recent_sweet_pct = (recent_sweet / len(recent)) * 100
            print(f"\n    Last 200 waves:")
            print(f"      Avg Progress: {recent_avg:.1%}")
            print(f"      Sweet Spot:   {recent_sweet_pct:.1f}%")

    # AI Parameter trends (first vs last 1000 waves)
    if len(kill_times) >= 2000:
        first_kt = kill_times[:1000]
        last_kt = kill_times[-1000:]
        first_avg = sum(first_kt) / len(first_kt)
        last_avg = sum(last_kt) / len(last_kt)
        diff = last_avg - first_avg

        print(f"\n  Kill Time Trend:")
        print(f"    First 1000 waves: {first_avg:.2f}s")
        print(f"    Last 1000 waves:  {last_avg:.2f}s")
        print(f"    Change: {diff:+.2f}s", end="")
        if diff < -0.3:
            print(" !! DROPPING (may cause boring waves)")
        elif diff > 0.3:
            print(" ^ INCREASING (harder enemies)")
        else:
            print(" = stable")

    # First vs Last comparison
    print(f"\n{'='*70}")
    print("DRIFT ANALYSIS (First 2000 vs Last 2000)")
    print("-" * 50)

    first_chunk = episodes[:2000]
    last_chunk = episodes[-2000:]

    first_avg = sum(e['reward'] for e in first_chunk) / len(first_chunk)
    last_avg = sum(e['reward'] for e in last_chunk) / len(last_chunk)

    print(f"  First 2000 avg reward: {first_avg:.4f}")
    print(f"  Last 2000 avg reward:  {last_avg:.4f}")
    print(f"  Difference:            {last_avg - first_avg:+.4f}")

    if last_avg < first_avg - 0.05:
        print(f"\n  !!  DRIFT DETECTED: Performance degraded by {(first_avg - last_avg):.3f}")
    elif last_avg > first_avg + 0.05:
        print(f"\n  OK  IMPROVEMENT: Performance improved by {(last_avg - first_avg):.3f}")
    else:
        print(f"\n  =>  STABLE: No significant drift")

    # Find best and worst periods
    if chunk_data:
        best = max(chunk_data, key=lambda x: x['avg_reward'])
        worst = min(chunk_data, key=lambda x: x['avg_reward'])
        print(f"\n  Best period:  E{best['start']}-{best['end']} (reward: {best['avg_reward']:.4f})")
        print(f"  Worst period: E{worst['start']}-{worst['end']} (reward: {worst['avg_reward']:.4f})")

    # Current state analysis
    print(f"\n{'='*70}")
    print("CURRENT STATE (Last 500 episodes)")
    print("-" * 50)
    last_500 = episodes[-500:]
    curr_avg = sum(e['reward'] for e in last_500) / len(last_500)
    print(f"  Current avg reward: {curr_avg:.4f}")

    # Breakdown analysis
    breakdown_sums = defaultdict(float)
    for e in last_500:
        for k, v in e['breakdown'].items():
            breakdown_sums[k] += v

    print(f"  Avg breakdown:")
    for k, v in sorted(breakdown_sums.items()):
        avg_v = v / len(last_500)
        indicator = ""
        if k == 'progress' and avg_v < 0:
            indicator = " (low!)"
        elif k == 'boring' and avg_v < -0.05:
            indicator = " (high penalty!)"
        elif k == 'variety' and avg_v > 0.1:
            indicator = " (good!)"
        print(f"    {k}: {avg_v:+.4f}{indicator}")

    # Recent AI params (last 500 waves)
    if len(kill_times) >= 500:
        recent_kt = kill_times[-500:]
        recent_hp = enemy_hps[-500:] if len(enemy_hps) >= 500 else enemy_hps
        recent_dps = effective_dps_values[-500:] if len(effective_dps_values) >= 500 else effective_dps_values

        print(f"\n  Recent AI Params (last 500 waves):")
        if recent_kt:
            print(f"    Kill Time: {sum(recent_kt)/len(recent_kt):.2f}s avg")
        if recent_hp:
            print(f"    Enemy HP:  {sum(recent_hp)/len(recent_hp):.0f} avg")
        if recent_dps:
            print(f"    Eff. DPS:  {sum(recent_dps)/len(recent_dps):.0f} avg")

    # Recommendations
    print(f"\n{'='*70}")
    print("RECOMMENDATIONS")
    print("-" * 50)

    recommendations = []

    # Check for kill_time issues
    if len(kill_times) >= 500:
        recent_kt_avg = sum(kill_times[-500:]) / 500
        if recent_kt_avg < 1.8:
            recommendations.append(
                f"Kill Time too low ({recent_kt_avg:.2f}s avg). "
                "Consider increasing KILL_TIME_MIN to prevent boring waves."
            )

    # Check for type collapse
    if type_prob_count > 0:
        max_prob = max(type_prob_sums.values()) / type_prob_count
        if max_prob > 0.35:  # One type > 35%
            dominant = max(type_prob_sums.items(), key=lambda x: x[1])[0]
            recommendations.append(
                f"Type collapse detected: '{dominant}' dominates at {max_prob*100:.1f}%. "
                "Consider increasing ENTROPY_COEF or TYPE_COOLDOWN_WAVES."
            )

    # Check for reward degradation
    if chunk_data and len(chunk_data) >= 3:
        recent_chunks = chunk_data[-3:]
        if all(c['avg_reward'] < 0.1 for c in recent_chunks):
            recommendations.append(
                "Low rewards in recent chunks. Model may be stuck. "
                "Consider rollback to best checkpoint."
            )

    # Check for high game over rate
    if chunk_data:
        last_chunk = chunk_data[-1]
        if last_chunk['go_pct'] > 15:
            recommendations.append(
                f"High game over rate ({last_chunk['go_pct']:.1f}%). "
                "Enemies may be too strong. Check kill_time and enemy_hp."
            )

    # Check progress distribution
    if progress_values:
        total_prog = len(progress_values)
        too_hard = sum(1 for p in progress_values if p >= 0.70)
        too_hard_pct = (too_hard / total_prog) * 100

        if too_hard_pct > 50:
            recommendations.append(
                f"Progress too high: {too_hard_pct:.1f}% of waves have >70% progress. "
                "Waves are too hard! Consider: increase kill_time, reduce count, or check bot DPS."
            )

        too_easy = sum(1 for p in progress_values if p < 0.40)
        too_easy_pct = (too_easy / total_prog) * 100

        if too_easy_pct > 50:
            recommendations.append(
                f"Progress too low: {too_easy_pct:.1f}% of waves have <40% progress. "
                "Waves are too easy! Consider: reduce kill_time or increase count."
            )

    if recommendations:
        for i, rec in enumerate(recommendations, 1):
            print(f"  {i}. {rec}")
    else:
        print("  No issues detected. Training looks healthy!")

    print(f"\n{'='*70}\n")


def find_latest_log():
    """Find the most recent log file."""
    log_dir = Path("logs")
    if not log_dir.exists():
        return None
    logs = list(log_dir.glob("training_*.jsonl"))
    if not logs:
        return None
    return max(logs, key=lambda p: p.stat().st_mtime)


if __name__ == '__main__':
    if len(sys.argv) > 1:
        logfile = sys.argv[1]
    else:
        logfile = find_latest_log()
        if logfile:
            print(f"Using latest log: {logfile}")
        else:
            print("No log file found. Usage: python analyze_log.py <logfile>")
            sys.exit(1)

    analyze_log(logfile)
