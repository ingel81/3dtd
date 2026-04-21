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
from fastapi.responses import FileResponse, JSONResponse

from config import (
    ENTROPY_COEF,
    ENEMY_TYPES,
    DAMAGE_SWEET_MIN,
    DAMAGE_SWEET_MAX,
    PROGRESS_NEAR_MISS_LOW,
    PROGRESS_NEAR_MISS_HIGH,
    PROGRESS_OVERFLOW_THRESHOLD,
)

# Wave-size histogram buckets. Upper bound exclusive, last bucket is "+inf".
# Endgame-orientiert: aktuelles "AI sendet zu kleine Waves"-Problem fällt sofort
# in Bucket 1 auf, große Wellen hätten eigene Buckets.
WAVE_SIZE_BUCKETS = [(0, 20), (20, 50), (50, 100), (100, 500), (500, float("inf"))]
WAVE_SIZE_BUCKET_LABELS = ["0-20", "20-50", "50-100", "100-500", "500+"]

STATIC_DIR = Path(__file__).parent / "static"


class Dashboard:
    """Training dashboard state and API."""

    def __init__(self):
        self.app = FastAPI(title="3DTD Training Dashboard")
        self.server_ref = None  # Set by TrainingServer
        self.ws_clients: set[WebSocket] = set()

        # History buffers (circular) — aggregated across all clients
        self.reward_history = deque(maxlen=2000)
        self.progress_history = deque(maxlen=2000)
        self.near_miss_history = deque(maxlen=2000)
        self.wave_log = deque(maxlen=200)  # larger to keep per-client entries visible

        # Latest NN policy output — for shared "Type Probabilities" chart.
        # Other per-wave metrics (kill_time, enemy_hp, dps, damage_pct) live
        # per-client only, since they depend on the specific client's tower
        # distribution — aggregating them across clients is misleading.
        self.type_probs_history = deque(maxlen=100)

        # Policy-output globals (legitim aggregierbar, Netz-Signale):
        # Enemy-Type-Frequency: Wie oft hat die AI jeden der 16 Typen bestellt
        # über alle Clients/Waves hinweg.
        self.enemy_type_counts: dict[str, int] = {t: 0 for t in ENEMY_TYPES}
        # Phase 5.10: Template-Usage — wie oft der NN welches Template wählt.
        # Wird in record_wave aus wave_info.template_id aggregiert.
        self.template_usage_counts: dict[str, int] = {}
        # Wave-Size-History: totalCount pro Wave, global, für Histogramm
        self.wave_size_history = deque(maxlen=2000)
        # Mixed-Wave-Rate: 0/1 pro Wave (≥2 Groups), Rolling-Avg später
        self.mixed_wave_rate_history = deque(maxlen=2000)

        # Per-client history mirrors — same deques but keyed by client id.
        # Dashboard can filter to one client for clean learning-curve inspection
        # instead of the global average.
        self.per_client: dict[int, dict] = {}

        # Distribution tracking
        self.distribution = {"boring": 0, "low": 0, "moderate": 0, "sweet": 0, "danger": 0, "gameover": 0}
        self.distribution_by_client: dict[int, dict] = {}
        self.dist_history = deque(maxlen=500)
        self.total_waves = 0
        self.game_over_count = 0
        self.near_miss_count = 0

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
            """Return reward config for dynamic dashboard thresholds (Phase 5.10)."""
            # Progress "sweet spot" = near-miss band from reward.py
            center = (PROGRESS_NEAR_MISS_LOW + PROGRESS_NEAR_MISS_HIGH) / 2
            sigma = (PROGRESS_NEAR_MISS_HIGH - PROGRESS_NEAR_MISS_LOW) / 2
            return {
                "progressCenter": round(center, 3),
                "progressSigma": round(sigma, 3),
                "sweetLower": round(PROGRESS_NEAR_MISS_LOW, 3),
                "sweetUpper": round(PROGRESS_NEAR_MISS_HIGH, 3),
                "overflowThreshold": round(PROGRESS_OVERFLOW_THRESHOLD, 3),
                "damageSweetMin": DAMAGE_SWEET_MIN,
                "damageSweetMax": DAMAGE_SWEET_MAX,
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
            # Policy-output diagnostics
            stats["enemyTypeCounts"] = dict(self.enemy_type_counts)
            stats["templateUsageCounts"] = dict(self.template_usage_counts)
            stats["waveSizeHistogram"] = self._calc_wave_size_histogram()
            stats["mixedWaveRate"] = self._calc_mixed_wave_rate()
            stats["modelMetrics"] = dict(self.model_metrics)
            return stats

        @self.app.get("/api/history")
        async def get_history(clientId: int = None):
            """Return history buffers.

            Without clientId: aggregated across all clients (legacy behavior).
            With clientId: only that client's samples. Charts can switch
            between views without re-fetching.
            """
            if clientId is None:
                return {
                    "clientId": None,
                    "rewards": list(self.reward_history),
                    "progress": list(self.progress_history),
                    "nearMiss": list(self.near_miss_history),
                    "distribution": dict(self.distribution),
                    "distHistory": list(self.dist_history),
                    # Policy-output globals (legitim aggregierbar)
                    "enemyTypeCounts": dict(self.enemy_type_counts),
                    "waveSizeHistory": list(self.wave_size_history),
                    "mixedWaveRate": self._calc_mixed_wave_rate(),
                    "waveSizeHistogram": self._calc_wave_size_histogram(),
                    "availableClients": sorted(self.per_client.keys()),
                }
            c = self.per_client.get(clientId)
            if c is None:
                return {"clientId": clientId, "empty": True, "availableClients": sorted(self.per_client.keys())}
            return {
                "clientId": clientId,
                "rewards": list(c["reward"]),
                "progress": list(c["progress"]),
                "nearMiss": list(c["near_miss"]),
                "damagePctHistory": list(c["damage_pct"]),
                "damageZones": dict(c["damage_zones"]),
                "distribution": dict(c["dist"]),
                "killTimeHistory": list(c["kill_time"]),
                "enemyHpHistory": list(c["enemy_hp"]),
                "dpsHistory": list(c["dps"]),
                "totalCountHistory": list(c["total_count"]),
                "numGroupsHistory": list(c["num_groups"]),
                "playerCreditsHistory": list(c["player_credits"]),
                "playerHealthHistory": list(c["player_health"]),
                "lastBreakdown": c.get("last_breakdown"),
                "totalWaves": c["total_waves"],
                "gameOverCount": c["game_over_count"],
                "nearMissCount": c["near_miss_count"],
                "availableClients": sorted(self.per_client.keys()),
            }

        @self.app.get("/api/clients/summary")
        async def get_clients_summary():
            """Compact per-client snapshot for the selector UI / scripted inspection."""
            out = []
            for cid, c in self.per_client.items():
                rewards = list(c["reward"])
                progresses = list(c["progress"])
                last_reward = rewards[-1] if rewards else None
                # Rolling avg (last 50) — what the NN is actually seeing as 'recent'
                def _avg(xs):
                    xs = xs[-50:]
                    return round(sum(xs) / len(xs), 4) if xs else None
                dmg = list(c["damage_pct"])
                out.append({
                    "id": cid,
                    "totalWaves": c["total_waves"],
                    "gameOvers": c["game_over_count"],
                    "lastReward": last_reward,
                    "avgReward50": _avg(rewards),
                    "avgProgress50": _avg(progresses),
                    "avgDamage50": _avg(dmg),
                    "distribution": dict(c["dist"]),
                    "damageZones": dict(c["damage_zones"]),
                    "lastBreakdown": c.get("last_breakdown"),
                    "lastSeen": c.get("last_seen"),
                })
            return {"clients": sorted(out, key=lambda x: x["id"])}

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
                    # Phase 5.10: ctx no longer caches dps_profile; endpoint
                    # returns empty arrays for API compatibility.
                    "groundDPS": [],
                    "airDPS": [],
                    "recentProgress": ctx.recent_progress[-5:],
                    "winStreak": ctx.win_streak,
                    "recentTemplateIndices": ctx.recent_template_indices[-5:],
                })
            return clients

        @self.app.get("/api/profile/{client_id}")
        async def get_profile(client_id: int):
            if not self.server_ref:
                return {"error": "Server not initialized"}
            for cid, ctx in self.server_ref.client_contexts.items():
                if cid % 10000 == client_id:
                    # Phase 5.10: dps_profile no longer cached in ctx.
                    return {"groundDPS": [], "airDPS": []}
            return {"error": "Client not found"}

        @self.app.post("/api/control/{cmd}")
        async def control(cmd: str):
            """Broadcast a control command (start/stop/reload) to all training clients."""
            if cmd not in ("start", "stop", "reload"):
                return JSONResponse({"error": f"Unknown command: {cmd}"}, status_code=400)
            if not self.server_ref:
                return JSONResponse({"error": "Server not initialized"}, status_code=503)
            count = await self.server_ref.broadcast_client_command(cmd)
            return {"cmd": cmd, "clientsNotified": count}

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

    def _damage_bucket(self, d: float) -> str:
        """Classify damage_pct into a zone matching reward.py semantics."""
        # Import here to avoid circular deps
        try:
            from config import (
                DAMAGE_SWEET_MIN, DAMAGE_SWEET_MAX,
                DAMAGE_NEUTRAL_MAX, DAMAGE_HARD_THRESHOLD,
            )
        except ImportError:
            DAMAGE_SWEET_MIN, DAMAGE_SWEET_MAX = 0.01, 0.10
            DAMAGE_NEUTRAL_MAX, DAMAGE_HARD_THRESHOLD = 0.25, 0.50
        if d <= 0:
            return "zero"
        if d <= DAMAGE_SWEET_MAX:
            return "sweet"
        if d <= DAMAGE_NEUTRAL_MAX:
            return "neutral"
        if d <= DAMAGE_HARD_THRESHOLD:
            return "hard"
        return "overwhelm"

    def _ensure_client(self, client_id: int) -> dict:
        """Lazy-init per-client history buffers."""
        if client_id is None:
            return None
        if client_id not in self.per_client:
            self.per_client[client_id] = {
                "reward": deque(maxlen=2000),
                "progress": deque(maxlen=2000),
                "near_miss": deque(maxlen=2000),
                "damage_pct": deque(maxlen=2000),  # NEW: core signal for damage-zone reward
                "kill_time": deque(maxlen=500),
                "enemy_hp": deque(maxlen=500),
                "dps": deque(maxlen=500),
                "total_count": deque(maxlen=500),
                "num_groups": deque(maxlen=500),
                "player_credits": deque(maxlen=500),
                "player_health": deque(maxlen=500),
                "dist": {"boring": 0, "low": 0, "moderate": 0, "sweet": 0, "danger": 0, "gameover": 0},
                # Damage-zone bucket counters for histogram view
                "damage_zones": {"zero": 0, "sweet": 0, "neutral": 0, "hard": 0, "overwhelm": 0},
                "total_waves": 0,
                "game_over_count": 0,
                "near_miss_count": 0,
                "last_breakdown": None,
                "last_seen": time.time(),
            }
        self.per_client[client_id]["last_seen"] = time.time()
        return self.per_client[client_id]

    def record_episode(self, reward: float, avg_progress: float, near_miss: float = 0,
                       breakdown: dict = None, client_id: int = None):
        """Record training episode data.

        client_id enables per-client history charts. Without it, only the
        aggregated globals are updated.
        """
        self.reward_history.append(round(reward, 4))
        self.progress_history.append(round(avg_progress, 4))
        self.near_miss_history.append(round(near_miss, 4))

        # Update global distribution
        bucket = self._classify_progress(avg_progress)
        self.distribution[bucket] = self.distribution.get(bucket, 0) + 1
        self.total_waves += 1
        if near_miss > 0.5:
            self.near_miss_count += 1

        # Per-client mirror
        c = self._ensure_client(client_id)
        if c is not None:
            c["reward"].append(round(reward, 4))
            c["progress"].append(round(avg_progress, 4))
            c["near_miss"].append(round(near_miss, 4))
            c["dist"][bucket] = c["dist"].get(bucket, 0) + 1
            c["total_waves"] += 1
            if near_miss > 0.5:
                c["near_miss_count"] += 1
            if breakdown is not None:
                c["last_breakdown"] = breakdown

        # Track sweet spot over time
        sweet_pct = self._calc_sweet_spot_pct()
        self.dist_history.append(round(sweet_pct, 1))

        self._broadcast_event("episode", {
            "clientId": client_id,
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
                    progress: float, reward: float, wave_info: dict = None,
                    client_id: int = None):
        """Record wave result for log.

        client_id is needed for per-client dashboard panels (State Signals,
        Type Probabilities) — without it, concurrent clients overwrite each
        other's view.
        """
        kill_time = wave_info.get("kill_time", 0) if wave_info else 0
        enemy_hp = wave_info.get("enemy_hp", 0) if wave_info else 0
        effective_dps = wave_info.get("effective_dps", 0) if wave_info else 0
        type_probs = wave_info.get("type_probs", {}) if wave_info else {}
        cooldown_override = wave_info.get("cooldown_override", False) if wave_info else False

        # Phase 5.5 signals
        num_groups = wave_info.get("num_groups", 1) if wave_info else 1
        groups = wave_info.get("groups", []) if wave_info else []
        armor_dist = wave_info.get("armor_dist") if wave_info else None
        dps_by_type = wave_info.get("dps_by_type") if wave_info else None
        research = wave_info.get("research") if wave_info else None
        # Dashboard-only: player economy snapshot (not AI-relevant)
        player_credits = wave_info.get("player_credits") if wave_info else None
        player_health = wave_info.get("player_health") if wave_info else None
        # NEW (damage-zone reward): track per-wave player damage as fraction 0..1
        damage_pct = wave_info.get("damage_pct") if wave_info else None
        # Bot telemetry: tower distribution + levels
        tower_counts = wave_info.get("tower_counts") if wave_info else None
        tower_avg_levels = wave_info.get("tower_avg_levels") if wave_info else None
        tower_count_total = wave_info.get("tower_count_total") if wave_info else None

        entry = {
            "wave": wave_num,
            "type": enemy_type,
            "count": count,
            "progress": round(progress, 3),
            "reward": round(reward, 3),
            "killTime": round(kill_time, 2),
            "enemyHp": round(enemy_hp, 1),
            "dps": round(effective_dps, 1),
            "cooldownOverride": cooldown_override,
            "numGroups": num_groups,
            "groups": groups,
        }
        self.wave_log.append(entry)

        # Latest NN policy output (legitim global — Netz hat shared weights)
        if type_probs:
            self.type_probs_history.append(type_probs)

        # Policy-output globals: Enemy-Type-Frequency, Wave-Size, Mixed-Rate.
        # Primäre Diagnose-Signale für "Was produziert das Netz?".
        total_count = int(count) if count else 0
        self.wave_size_history.append(total_count)
        self.mixed_wave_rate_history.append(1 if num_groups >= 2 else 0)
        # Iteriere über alle Groups (nicht nur dominant) — Mixed-Waves tragen bei.
        for g in groups or []:
            t = g.get("type")
            c_count = int(g.get("count", 0) or 0)
            if t in self.enemy_type_counts:
                self.enemy_type_counts[t] += c_count
            elif t:
                self.enemy_type_counts[t] = c_count

        # Phase 5.10: Template-Usage aggregation (which template did the NN pick?)
        template_id = wave_info.get("template_id") if wave_info else None
        if template_id:
            self.template_usage_counts[template_id] = self.template_usage_counts.get(template_id, 0) + 1

        # Per-client mirror so charts can filter cleanly
        c = self._ensure_client(client_id)
        if c is not None:
            c["kill_time"].append(round(kill_time, 2))
            c["enemy_hp"].append(round(enemy_hp, 1))
            c["dps"].append(round(effective_dps, 1))
            c["total_count"].append(int(count))
            c["num_groups"].append(int(num_groups))
            if player_credits is not None:
                c["player_credits"].append(int(player_credits))
            if player_health is not None:
                c["player_health"].append(int(player_health))
            if damage_pct is not None:
                c["damage_pct"].append(round(damage_pct, 4))
                # Bucket into damage zones for histogram
                bucket = self._damage_bucket(damage_pct)
                c["damage_zones"][bucket] = c["damage_zones"].get(bucket, 0) + 1

        entry["clientId"] = client_id
        self._broadcast_event("wave", entry)

        # Broadcast AI params update for live charts
        self._broadcast_event("ai_params", {
            "clientId": client_id,
            "killTime": round(kill_time, 2),
            "enemyHp": round(enemy_hp, 1),
            "dps": round(effective_dps, 1),
            "typeProbs": type_probs,
            "cooldownOverride": cooldown_override,
            # Phase 5.5: new signals
            "numGroups": num_groups,
            "armorDist": armor_dist,
            "dpsByType": dps_by_type,
            "research": research,
            # Dashboard-only economy snapshot (post-wave)
            "playerCredits": player_credits,
            "playerHealth": player_health,
            # Damage-zone reward model: per-wave damage + bucket
            "damagePct": round(damage_pct, 4) if damage_pct is not None else None,
            "damageBucket": self._damage_bucket(damage_pct) if damage_pct is not None else None,
            # Bot telemetry: tower-type distribution (diagnostic)
            "towerCounts": tower_counts,
            "towerAvgLevels": tower_avg_levels,
            "towerCountTotal": tower_count_total,
        })

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
        if progress < 0.20: return "boring"
        if progress < PROGRESS_NEAR_MISS_LOW: return "low"
        if progress <= PROGRESS_NEAR_MISS_HIGH: return "sweet"
        if progress <= PROGRESS_OVERFLOW_THRESHOLD: return "moderate"
        if progress < 1.0: return "danger"
        return "gameover"

    def _calc_sweet_spot_pct(self) -> float:
        """Percentage of recent episodes in the near-miss sweet band."""
        if not self.progress_history:
            return 0
        recent = list(self.progress_history)[-100:]
        in_spot = sum(1 for p in recent
                       if PROGRESS_NEAR_MISS_LOW <= p <= PROGRESS_NEAR_MISS_HIGH)
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

    def _calc_wave_size_histogram(self) -> dict:
        """Bucket the global wave_size_history into 5 size bins.

        Returns {labels: [...], counts: [...]}. Buckets see WAVE_SIZE_BUCKETS.
        """
        counts = [0] * len(WAVE_SIZE_BUCKETS)
        for size in self.wave_size_history:
            for i, (lo, hi) in enumerate(WAVE_SIZE_BUCKETS):
                if lo <= size < hi:
                    counts[i] += 1
                    break
        return {"labels": WAVE_SIZE_BUCKET_LABELS, "counts": counts}

    def _calc_mixed_wave_rate(self) -> dict:
        """Mixed-wave rate timeline: raw binary + rolling-50 avg.

        Raw array is the last 500 waves (capped). Rolling-50 is the sliding
        mean — if rising, the net is learning to send mixed waves; flat at 0
        means monotype spam.
        """
        raw = list(self.mixed_wave_rate_history)
        rolling = []
        window = 50
        for i in range(len(raw)):
            start = max(0, i - window + 1)
            chunk = raw[start:i + 1]
            rolling.append(round(sum(chunk) / len(chunk), 3))
        return {"raw": raw[-500:], "rolling50": rolling[-500:]}

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
