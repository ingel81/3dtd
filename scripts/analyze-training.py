"""
Training Log Analyzer

Analyzes JSONL training logs and prints key metrics.
Usage: python scripts/analyze-training.py [logfile]
       If no logfile given, uses the latest in training-backend/logs/
"""

import json
import sys
from pathlib import Path
from collections import Counter


def load_log(path: Path) -> list[dict]:
    entries = []
    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries


def analyze(entries: list[dict]):
    # Separate by type
    steps = [e for e in entries if e.get('type') == 'training_step']
    waves = [e for e in entries if e.get('type') == 'wave_result']
    updates = [e for e in entries if e.get('type') == 'model_update']
    game_overs = [e for e in entries if e.get('type') == 'episode_end' and e.get('reason') == 'game_over']
    wave_gens = [e for e in entries if e.get('type') == 'wave_generated']
    episodes_complete = [e for e in entries if e.get('type') == 'episode_end' and e.get('reason') == 'max_waves']

    total_episodes = len(steps)
    print(f"\n{'='*60}")
    print(f"  TRAINING LOG ANALYSIS ({total_episodes} episodes)")
    print(f"{'='*60}")

    if not steps:
        print("No training steps found.")
        return

    # --- Reward Trend ---
    print(f"\n--- Reward ---")
    rewards = [s['reward'] for s in steps]
    n = len(rewards)
    first_50 = rewards[:50] if n >= 50 else rewards
    last_50 = rewards[-50:] if n >= 50 else rewards
    print(f"  First 50 avg:  {sum(first_50)/len(first_50):.3f}")
    print(f"  Last 50 avg:   {sum(last_50)/len(last_50):.3f}")
    print(f"  Overall avg:   {sum(rewards)/n:.3f}")
    print(f"  Min/Max:       {min(rewards):.3f} / {max(rewards):.3f}")

    # Sweet spot hits (reward > 0.9)
    sweet_hits = sum(1 for r in rewards if r > 0.9)
    print(f"  Sweet Spot (>0.9): {sweet_hits}/{n} ({sweet_hits/n*100:.1f}%)")

    # --- Progress ---
    print(f"\n--- Progress ---")
    progress_vals = [w['avg_progress'] for w in waves if w.get('avg_progress', 0) > 0]
    if progress_vals:
        first_p = progress_vals[:50] if len(progress_vals) >= 50 else progress_vals
        last_p = progress_vals[-50:] if len(progress_vals) >= 50 else progress_vals
        print(f"  First 50 avg:  {sum(first_p)/len(first_p):.3f}")
        print(f"  Last 50 avg:   {sum(last_p)/len(last_p):.3f}")
        print(f"  Overall avg:   {sum(progress_vals)/len(progress_vals):.3f}")

        # Distribution
        boring = sum(1 for p in progress_vals if p < 0.20)
        low = sum(1 for p in progress_vals if 0.20 <= p < 0.40)
        sweet = sum(1 for p in progress_vals if 0.40 <= p <= 0.70)
        moderate = sum(1 for p in progress_vals if 0.70 < p <= 0.85)
        danger = sum(1 for p in progress_vals if p > 0.85)
        total_p = len(progress_vals)
        print(f"\n  Distribution:")
        print(f"    Boring (<20%):     {boring:4d} ({boring/total_p*100:5.1f}%)")
        print(f"    Low (20-40%):      {low:4d} ({low/total_p*100:5.1f}%)")
        print(f"    Sweet (40-70%):    {sweet:4d} ({sweet/total_p*100:5.1f}%) <-- target")
        print(f"    Moderate (70-85%): {moderate:4d} ({moderate/total_p*100:5.1f}%)")
        print(f"    Danger (>85%):     {danger:4d} ({danger/total_p*100:5.1f}%)")

    # --- Game Overs ---
    print(f"\n--- Game Overs ---")
    print(f"  Total: {len(game_overs)}")
    print(f"  Completed (20 waves): {len(episodes_complete)}")
    if game_overs:
        go_waves = [g['waves'] for g in game_overs]
        print(f"  Avg wave at GO: {sum(go_waves)/len(go_waves):.1f}")
        print(f"  Min/Max wave:   {min(go_waves)} / {max(go_waves)}")

    # --- Enemy Types ---
    print(f"\n--- Enemy Types ---")
    if wave_gens:
        type_counts = Counter(w['enemy_type'] for w in wave_gens)
        total_gens = sum(type_counts.values())
        for etype, count in type_counts.most_common():
            print(f"  {etype:12s}: {count:4d} ({count/total_gens*100:5.1f}%)")

    # --- Kill Time ---
    print(f"\n--- Kill Time ---")
    if wave_gens:
        kill_times = [w['kill_time'] for w in wave_gens]
        first_kt = kill_times[:50] if len(kill_times) >= 50 else kill_times
        last_kt = kill_times[-50:] if len(kill_times) >= 50 else kill_times
        print(f"  First 50 avg:  {sum(first_kt)/len(first_kt):.2f}s")
        print(f"  Last 50 avg:   {sum(last_kt)/len(last_kt):.2f}s")
        print(f"  Overall avg:   {sum(kill_times)/len(kill_times):.2f}s")
        print(f"  Min/Max:       {min(kill_times):.2f}s / {max(kill_times):.2f}s")

    # --- Model Updates ---
    print(f"\n--- Model (PPO) ---")
    if updates:
        print(f"  Updates: {len(updates)}")
        last_5 = updates[-5:]
        print(f"  Last 5 batch_avg_reward: {[u['batch_avg_reward'] for u in last_5]}")
        entropies = [u['entropy'] for u in updates]
        print(f"  Entropy: {entropies[0]:.3f} -> {entropies[-1]:.3f} (start -> now)")
        grad_norms = [u['grad_norm'] for u in updates]
        print(f"  Grad norm avg: {sum(grad_norms)/len(grad_norms):.3f}")

    # --- Tower Counts (from wave_state) ---
    print(f"\n--- Defense ---")
    wave_states = [e for e in entries if e.get('type') == 'wave_state']
    if wave_states:
        tower_counts = [w['towers'] for w in wave_states]
        dps_vals = [w['dps'] for w in wave_states]
        print(f"  Avg towers:  {sum(tower_counts)/len(tower_counts):.1f}")
        print(f"  Max towers:  {max(tower_counts)}")
        print(f"  Avg DPS:     {sum(dps_vals)/len(dps_vals):.0f}")
        print(f"  Max DPS:     {max(dps_vals)}")

    print(f"\n{'='*60}\n")


if __name__ == '__main__':
    if len(sys.argv) > 1:
        log_path = Path(sys.argv[1])
    else:
        # Find latest log
        log_dir = Path(__file__).parent.parent / 'training-backend' / 'logs'
        logs = sorted(log_dir.glob('*.jsonl'), key=lambda p: p.stat().st_mtime)
        if not logs:
            print("No log files found in training-backend/logs/")
            sys.exit(1)
        log_path = logs[-1]

    print(f"Analyzing: {log_path.name}")
    entries = load_log(log_path)
    analyze(entries)
