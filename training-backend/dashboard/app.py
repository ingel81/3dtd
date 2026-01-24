"""
Training Dashboard - FastAPI Web Interface

Provides real-time training visualization on port 3002.
Features: reward/progress charts, model metrics, DPS profiles, distribution, logs.

Runs in the same asyncio event loop as the WebSocket training server.
"""

import asyncio
import json
import time
from pathlib import Path
from collections import deque

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from config import (
    REWARD_PROGRESS_CENTER,
    REWARD_PROGRESS_SIGMA,
    REWARD_BORING_PENALTY,
    ENTROPY_COEF,
)

STATIC_DIR = Path(__file__).parent / "static"


class Dashboard:
    """Training dashboard state and API."""

    def __init__(self):
        self.app = FastAPI(title="3DTD Training Dashboard")
        self.server_ref = None  # Set by TrainingServer
        self.ws_clients: set[WebSocket] = set()

        # History buffers (circular)
        self.reward_history = deque(maxlen=2000)
        self.progress_history = deque(maxlen=2000)
        self.near_miss_history = deque(maxlen=2000)
        self.wave_log = deque(maxlen=50)

        # Distribution tracking
        self.distribution = {"boring": 0, "low": 0, "moderate": 0, "sweet": 0, "danger": 0, "gameover": 0}
        self.dist_history = deque(maxlen=500)  # sweet spot % over time
        self.total_waves = 0
        self.game_over_count = 0
        self.near_miss_count = 0  # waves with NM > 50%

        # Model metrics (latest)
        self.model_metrics = {
            "policyLoss": 0, "entropy": 0, "gradNorm": 0, "batchReward": 0,
        }
        self.model_updates = 0

        # Timing
        self.start_time = time.time()

        self._setup_routes()

    def set_server(self, server):
        """Set reference to TrainingServer for data access."""
        self.server_ref = server

    def _setup_routes(self):
        """Configure FastAPI routes."""

        @self.app.get("/")
        async def index():
            return FileResponse(STATIC_DIR / "index.html")

        @self.app.get("/api/config")
        async def get_config():
            """Return reward config for dynamic dashboard thresholds."""
            sweet_lower = REWARD_PROGRESS_CENTER - REWARD_PROGRESS_SIGMA
            sweet_upper = REWARD_PROGRESS_CENTER + REWARD_PROGRESS_SIGMA
            # Overflow threshold matches reward.py hard penalty
            overflow = min(sweet_upper + REWARD_PROGRESS_SIGMA, 0.95)
            return {
                "progressCenter": REWARD_PROGRESS_CENTER,
                "progressSigma": REWARD_PROGRESS_SIGMA,
                "sweetLower": round(sweet_lower, 3),
                "sweetUpper": round(sweet_upper, 3),
                "overflowThreshold": round(overflow, 3),
                "boringThreshold": 0.20,
                "entropyCoef": ENTROPY_COEF,
            }

        @self.app.get("/api/stats")
        async def get_stats():
            if not self.server_ref:
                return {"error": "Server not initialized"}
            stats = self.server_ref._get_stats()
            stats["sweetSpotPct"] = self._calc_sweet_spot_pct()
            stats["gameOverRate"] = self._calc_game_over_rate()
            stats["nearMissPct"] = self._calc_near_miss_pct()
            stats["modelUpdates"] = self.model_updates
            stats["startTime"] = int(self.start_time * 1000)  # JS timestamp
            return stats

        @self.app.get("/api/history")
        async def get_history():
            return {
                "rewards": list(self.reward_history),
                "progress": list(self.progress_history),
                "nearMiss": list(self.near_miss_history),
                "distribution": dict(self.distribution),
                "distHistory": list(self.dist_history),
            }

        @self.app.get("/api/clients")
        async def get_clients():
            if not self.server_ref:
                return []
            clients = []
            for cid, ctx in self.server_ref.client_contexts.items():
                clients.append({
                    "id": cid % 10000,
                    "waveNum": ctx.wave_num,
                    "bot": ctx.current_bot,
                    "groundDPS": ctx.ground_dps_profile,
                    "airDPS": ctx.air_dps_profile,
                    "recentProgress": ctx.recent_progress[-5:],
                    "winStreak": ctx.win_streak,
                })
            return clients

        @self.app.get("/api/profile/{client_id}")
        async def get_profile(client_id: int):
            if not self.server_ref:
                return {"error": "Server not initialized"}
            for cid, ctx in self.server_ref.client_contexts.items():
                if cid % 10000 == client_id:
                    return {
                        "groundDPS": ctx.ground_dps_profile,
                        "airDPS": ctx.air_dps_profile,
                    }
            return {"error": "Client not found"}

        @self.app.websocket("/ws/live")
        async def websocket_live(ws: WebSocket):
            await ws.accept()
            self.ws_clients.add(ws)
            try:
                while True:
                    await ws.receive_text()
            except WebSocketDisconnect:
                self.ws_clients.discard(ws)

        # Mount static files last (catch-all)
        self.app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    def record_episode(self, reward: float, avg_progress: float, near_miss: float = 0,
                       breakdown: dict = None):
        """Record training episode data."""
        self.reward_history.append(round(reward, 4))
        self.progress_history.append(round(avg_progress, 4))
        self.near_miss_history.append(round(near_miss, 4))

        # Update distribution
        bucket = self._classify_progress(avg_progress)
        self.distribution[bucket] = self.distribution.get(bucket, 0) + 1
        self.total_waves += 1
        if near_miss > 0.5:
            self.near_miss_count += 1

        # Track sweet spot over time
        sweet_pct = self._calc_sweet_spot_pct()
        self.dist_history.append(round(sweet_pct, 1))

        self._broadcast_event("episode", {
            "reward": round(reward, 4),
            "progress": round(avg_progress, 4),
            "nearMiss": round(near_miss, 4),
            "breakdown": breakdown,
        })

        # Broadcast updated stats
        if self.server_ref:
            stats = self.server_ref._get_stats()
            stats["sweetSpotPct"] = sweet_pct
            stats["gameOverRate"] = self._calc_game_over_rate()
            stats["nearMissPct"] = self._calc_near_miss_pct()
            stats["modelUpdates"] = self.model_updates
            self._broadcast_event("stats", stats)

    def record_wave(self, wave_num: int, enemy_type: str, count: int,
                    progress: float, reward: float, kill_time: float = 0):
        """Record wave result for log."""
        entry = {
            "wave": wave_num,
            "type": enemy_type,
            "count": count,
            "progress": round(progress, 3),
            "reward": round(reward, 3),
            "killTime": round(kill_time, 2),
        }
        self.wave_log.append(entry)
        self._broadcast_event("wave", entry)

    def record_game_over(self):
        """Record a game over event."""
        self.game_over_count += 1

    def record_training_update(self, policy_loss: float, entropy: float,
                               grad_norm: float, batch_avg_reward: float):
        """Record model training update (PPO internals)."""
        self.model_updates += 1
        self.model_metrics = {
            "policyLoss": round(policy_loss, 5),
            "entropy": round(entropy, 4),
            "gradNorm": round(grad_norm, 4),
            "batchReward": round(batch_avg_reward, 3),
        }
        self._broadcast_event("training_update", self.model_metrics)

    def _classify_progress(self, progress: float) -> str:
        sweet_lower = REWARD_PROGRESS_CENTER - REWARD_PROGRESS_SIGMA
        sweet_upper = REWARD_PROGRESS_CENTER + REWARD_PROGRESS_SIGMA
        overflow = min(REWARD_PROGRESS_CENTER + 2 * REWARD_PROGRESS_SIGMA, 0.95)

        if progress < 0.20: return "boring"
        if progress < sweet_lower: return "low"
        if progress <= sweet_upper: return "sweet"
        if progress <= overflow: return "moderate"
        if progress < 1.0: return "danger"
        return "gameover"

    def _calc_sweet_spot_pct(self) -> float:
        """Percentage of recent episodes in sweet spot (center ± sigma)."""
        if not self.progress_history:
            return 0
        sweet_lower = REWARD_PROGRESS_CENTER - REWARD_PROGRESS_SIGMA
        sweet_upper = REWARD_PROGRESS_CENTER + REWARD_PROGRESS_SIGMA
        recent = list(self.progress_history)[-100:]
        in_spot = sum(1 for p in recent if sweet_lower <= p <= sweet_upper)
        return round(in_spot / len(recent) * 100, 1)

    def _calc_game_over_rate(self) -> float:
        """Percentage of waves that resulted in game over."""
        if self.total_waves == 0:
            return 0
        return round(self.game_over_count / self.total_waves * 100, 1)

    def _calc_near_miss_pct(self) -> float:
        """Percentage of waves with near-miss ratio > 50%."""
        if self.total_waves == 0:
            return 0
        return round(self.near_miss_count / self.total_waves * 100, 1)

    def _broadcast_event(self, event_type: str, data: dict):
        """Broadcast event to all WebSocket dashboard clients."""
        msg = json.dumps({"type": event_type, "data": data})
        for ws in list(self.ws_clients):
            asyncio.ensure_future(self._safe_send(ws, msg))

    async def _safe_send(self, ws: WebSocket, msg: str):
        """Send message, remove client on error."""
        try:
            await ws.send_text(msg)
        except Exception:
            self.ws_clients.discard(ws)


# Singleton dashboard instance
dashboard = Dashboard()
