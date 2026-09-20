"""
Bot-run logger.

Writes one JSONL line per event for later analysis and prints a minimal
console line; the dashboard on port 3002 does the looking.

Import the shared instance: `from utils.logger import logger`.

The per-wave lines here are the stopgap until the run log takes over
(docs/BALANCING_PLAN.md, phase 2a): the client will then send its own log and
the server only writes it to disk.
"""

import sys
import json
from datetime import datetime
from pathlib import Path


class BotRunLogger:
    """Console plus JSONL; the dashboard handles visualization."""

    def __init__(self):
        self.stats = {
            "waves": 0,
            "runs": 0,
            "clients_connected": 0,
        }
        self.start_time = datetime.now()

        self.logfile_path = Path("logs") / f"bots_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl"
        self.logfile_path.parent.mkdir(exist_ok=True)
        self.logfile = open(self.logfile_path, "a", encoding="utf-8")
        print(f"[LOG] {self.logfile_path}", file=sys.stderr)

    def stop(self):
        if self.logfile and not self.logfile.closed:
            self.logfile.close()

    def _log(self, entry_type: str, data: dict):
        if self.logfile and not self.logfile.closed:
            entry = {"ts": datetime.now().isoformat(), "type": entry_type, **data}
            self.logfile.write(json.dumps(entry) + "\n")
            self.logfile.flush()

    def _print(self, msg: str):
        """stderr, because stdout may be piped."""
        print(msg, file=sys.stderr)

    # === CONSOLE LEVELS ===

    def info(self, message):
        self._print(f"[INFO] {message}")

    def success(self, message):
        self._print(f"[OK]   {message}")

    def warning(self, message):
        self._print(f"[WARN] {message}")

    def error(self, message):
        self._print(f"[ERR]  {message}")
        self._log("error", {"message": str(message)})

    def debug(self, message):
        self._log("debug", {"message": str(message)})

    # === CLIENTS ===

    def client_connected(self, client_id, total):
        self.stats["clients_connected"] = total
        self._log("client_connected", {"client_id": client_id % 10000, "clients": total})
        self._print(f"[JOIN] #{client_id % 10000} ({total} clients)")

    def client_session(self, client_id, game_version):
        self._log("client_session", {"client_id": client_id % 10000, "game_version": game_version})

    def client_disconnected(self, client_id, total):
        self.stats["clients_connected"] = total
        self._log("client_disconnected", {"client_id": client_id % 10000, "clients": total})
        self._print(f"[LEFT] #{client_id % 10000} ({total} clients)")

    # === RUNS AND WAVES ===

    def run_start(self, client_id, bot_type):
        self.stats["runs"] += 1
        self._log("run_start", {"client_id": client_id % 10000, "bot": bot_type})

    def run_end(self, client_id, waves, reason="game_over"):
        self._log("run_end", {"client_id": client_id % 10000, "waves": waves, "reason": reason})
        if reason == "game_over":
            self._print(f"[DEAD] #{client_id % 10000} after W{waves}")

    def wave_result(self, wave_num, damage_pct, killed, avg_progress, leak_ratio=0.0,
                    client_id=None, total_count=None, perfect=None, close_call=None,
                    enemy_types=None, player_credits=None, player_health=None):
        """One wave as the client reported it."""
        self.stats["waves"] += 1
        payload = {
            "wave": wave_num,
            "damage_pct": round(damage_pct, 3),
            "killed": killed,
            "avg_progress": round(avg_progress, 3),
            "leak_ratio": round(leak_ratio, 3),
        }
        if client_id is not None: payload["client_id"] = client_id % 10000
        if total_count is not None: payload["total_count"] = int(total_count)
        if perfect is not None: payload["perfect"] = bool(perfect)
        if close_call is not None: payload["close_call"] = bool(close_call)
        if enemy_types is not None: payload["enemy_types"] = list(enemy_types)
        if player_credits is not None: payload["player_credits"] = int(player_credits)
        if player_health is not None: payload["player_health"] = int(player_health)
        self._log("wave_result", payload)

    # === SERVER ===

    def server_started(self, host, port):
        self._print(f"[OK]   ws://{host}:{port}")

    def server_shutdown(self):
        self._print("[STOP] Server shutting down")


# Global logger instance
logger = BotRunLogger()
