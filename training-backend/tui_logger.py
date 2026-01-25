"""
Simple Console Logger

Lightweight logger that writes structured JSONL logs for analysis
and prints minimal console output. The web dashboard (port 3002)
handles all visualization.
"""

import sys
import json
from datetime import datetime
from pathlib import Path


class TUILogger:
    """Simple console + file logger (dashboard handles visualization)."""

    def __init__(self):
        self.stats = {
            "episode": 0,
            "avg_reward": 0.0,
            "best_reward": float("-inf"),
            "games_played": 0,
            "clients_connected": 0,
            "model_updates": 0,
        }
        self.start_time = datetime.now()

        # JSONL logfile for post-hoc analysis
        self.logfile_path = Path("logs") / f"training_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl"
        self.logfile_path.parent.mkdir(exist_ok=True)
        self.logfile = open(self.logfile_path, 'a', encoding='utf-8')
        print(f"[LOG] {self.logfile_path}", file=sys.stderr)

    def start(self):
        """No-op (dashboard handles display)."""
        pass

    def stop(self):
        """Close logfile."""
        if self.logfile:
            self.logfile.close()

    def _log(self, entry_type: str, data: dict):
        """Write structured log entry to JSONL file."""
        if self.logfile and not self.logfile.closed:
            entry = {"ts": datetime.now().isoformat(), "type": entry_type, **data}
            self.logfile.write(json.dumps(entry) + '\n')
            self.logfile.flush()

    def _print(self, msg: str):
        """Print to stderr (stdout may be piped)."""
        print(msg, file=sys.stderr)

    # === PUBLIC API (same interface as before) ===

    def update_episode(self, episode, total_reward, avg_reward, best_reward):
        self.stats.update({"episode": episode, "avg_reward": avg_reward, "best_reward": best_reward})

    def update_clients(self, count):
        self.stats["clients_connected"] = count

    def update_wave(self, wave_num):
        pass

    def update_games(self, count):
        self.stats["games_played"] = count

    def info(self, message):
        self._print(f"[INFO] {message}")

    def success(self, message):
        self._print(f"[OK]   {message}")

    def warning(self, message):
        self._print(f"[WARN] {message}")

    def error(self, message):
        self._print(f"[ERR]  {message}")

    def debug(self, message):
        pass  # Suppress debug in console

    def client_connected(self, client_id, total):
        self.update_clients(total)
        self._print(f"[+] Client #{client_id % 10000} connected ({total} total)")
        self._log("client_connect", {"client_id": client_id, "total": total})

    def client_disconnected(self, client_id, total):
        self.update_clients(total)
        self._print(f"[-] Client #{client_id % 10000} disconnected ({total} total)")
        self._log("client_disconnect", {"client_id": client_id, "total": total})

    def wave_received(self, client_id, wave_num, towers, dps,
                      credits=0, defense_reach=0.0, bot_type=None):
        self._log("wave_state", {
            "client_id": client_id, "wave": wave_num,
            "towers": towers, "dps": round(dps, 1),
            "credits": credits, "defense_reach": round(defense_reach, 3),
            "bot_type": bot_type,
        })

    def wave_generated(self, config, wave_info=None, enemy_hp=None, kill_time=None):
        enemy_type = config.get("enemies", [{}])[0].get("type", "?")
        count = config.get("totalCount", 0)

        # Build log entry
        log_data = {
            "enemy_type": enemy_type,
            "count": count,
        }

        # Use wave_info if provided (new format), fall back to legacy params
        if wave_info:
            log_data.update({
                "enemy_hp": round(wave_info.get("enemy_hp", 0), 1),
                "kill_time": round(wave_info.get("kill_time", 0), 2),
                "effective_dps": round(wave_info.get("effective_dps", 0), 1),
                "count_factor": round(wave_info.get("count_factor", 0), 3),
                "delay_factor": round(wave_info.get("delay_factor", 0), 3),
                "variation": round(wave_info.get("variation", 0), 3),
                "spawn_delay": wave_info.get("spawn_delay", 0),
                "type_probs": wave_info.get("type_probs", {}),
                "sampled_type": wave_info.get("sampled_type", "?"),
                "cooldown_override": wave_info.get("cooldown_override", False),
            })
        else:
            # Legacy format
            log_data["enemy_hp"] = round(enemy_hp, 1) if enemy_hp else None
            log_data["kill_time"] = round(kill_time, 2) if kill_time else None

        self._log("wave_generated", log_data)

    def wave_result(self, wave_num, damage_pct, killed, avg_progress, near_miss_ratio=0):
        self._log("wave_result", {
            "wave": wave_num, "damage_pct": round(damage_pct, 3),
            "killed": killed, "avg_progress": round(avg_progress, 3),
            "near_miss_ratio": round(near_miss_ratio, 3),
        })

    def training_step(self, episode, reward, avg_reward, breakdown=None):
        best = self.stats["best_reward"]
        if reward > best:
            best = reward
        self.update_episode(episode, 0, avg_reward, best)

        self._log("training_step", {
            "episode": episode, "reward": round(reward, 4),
            "avg_reward": round(avg_reward, 4),
            "breakdown": breakdown,
        })

        # Print every 10th episode to reduce noise
        if episode % 10 == 0:
            self._print(f"[E{episode:>4}] R:{reward:+.3f} avg:{avg_reward:+.3f}")

    def episode_start(self, client_id, bot_type):
        self._log("episode_start", {"client_id": client_id, "bot_type": bot_type})

    def episode_end(self, client_id, waves_survived, avg_progress=0.0, reason="reset"):
        self._log("episode_end", {
            "client_id": client_id, "waves": waves_survived,
            "avg_progress": round(avg_progress, 3), "reason": reason,
        })
        if reason == "game_over":
            self._print(f"[DEAD] #{client_id % 10000} after W{waves_survived}")

    def training_update(self, policy_loss, entropy, grad_norm, batch_avg_reward):
        self.stats["model_updates"] += 1
        self._log("model_update", {
            "policy_loss": round(policy_loss, 5),
            "entropy": round(entropy, 4),
            "grad_norm": round(grad_norm, 4),
            "batch_avg_reward": round(batch_avg_reward, 3),
        })
        self._print(f"[UPD#{self.stats['model_updates']}] L:{policy_loss:+.4f} H:{entropy:.3f} G:{grad_norm:.2f} R:{batch_avg_reward:+.3f}")

    def checkpoint_saved(self, episode, path):
        self._print(f"[SAVE] E{episode} -> {Path(path).name}")
        self._log("checkpoint", {"episode": episode, "path": path})

    def model_resumed(self, episode, path):
        self._print(f"[LOAD] E{episode} <- {Path(path).name}")
        self._log("model_resumed", {"episode": episode, "path": path})

    def server_started(self, host, port, episode):
        self.stats["episode"] = episode
        self._print(f"[OK]   ws://{host}:{port} (E{episode})")

    def server_shutdown(self):
        self._print("[STOP] Server shutting down")

    def player_state_change(self, before, after):
        """Log significant player state changes."""
        before_towers = before.get("defense", {}).get("towerCount", 0)
        after_towers = after.get("defense", {}).get("towerCount", 0)
        if after_towers != before_towers:
            self._log("state_change", {
                "towers_before": before_towers, "towers_after": after_towers,
            })


# Global logger instance
tui_logger = TUILogger()
