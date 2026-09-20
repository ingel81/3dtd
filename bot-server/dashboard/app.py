"""
Bot dashboard (FastAPI, port 3002).

Shows what is running and lets you steer it: which clients are connected, the
bot they play, the wave they are on, how many runs per hour come in, and the
last errors. No curves — the analysis reads the JSONL log (docs/BALANCING_PLAN.md,
decision D13).
"""

from collections import deque
from pathlib import Path
import time

try:
    from fastapi import Body, FastAPI
    from fastapi.responses import FileResponse, JSONResponse
    from fastapi.staticfiles import StaticFiles
except ImportError:   # pragma: no cover - the server runs headless without it
    raise

from config import CLIENT_WAVE_HISTORY, CLIENT_STALE_AFTER_S

STATIC_DIR = Path(__file__).parent / "static"


class Dashboard:
    """Server state as the browser page reads it."""

    def __init__(self):
        self.app = FastAPI(title="3DTD Bots")
        self.server = None
        # display_id -> {waves, lastWave, bot, runs, bestWave}
        self.per_client: dict[int, dict] = {}
        self.errors = deque(maxlen=20)
        self.started_at = time.time()
        self._setup_routes()
        if STATIC_DIR.exists():
            self.app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    def set_server(self, server):
        self.server = server

    # === ROUTES ===

    def _setup_routes(self):
        app = self.app

        @app.get("/")
        async def index():
            return FileResponse(str(STATIC_DIR / "index.html"))

        @app.get("/api/status")
        async def status():
            """Everything the page shows, in one poll."""
            base = self.server.status() if self.server else {}
            now = time.time()
            clients = []
            for client in base.get("clients", []):
                stale = now - client.get("ts", 0) > CLIENT_STALE_AFTER_S
                history = self.per_client.get(client["id"], {})
                clients.append({
                    **client,
                    "stale": stale,
                    "runs": history.get("runs", 0),
                    "bestWave": history.get("bestWave", 0),
                    "wavesLogged": history.get("waves", 0),
                })
            return JSONResponse({
                **base,
                "clients": clients,
                "errors": list(self.errors),
                "uptimeS": round(now - self.started_at),
            })

        @app.post("/api/control/{cmd}")
        async def control(cmd: str, body: dict = Body(default=None)):
            """start | stop | reload | set_timescale | set_rendering"""
            allowed = {"start", "stop", "reload", "set_timescale", "set_rendering"}
            if cmd not in allowed:
                return JSONResponse({"error": f"unknown command '{cmd}'"}, status_code=400)
            if not self.server:
                return JSONResponse({"error": "server not attached"}, status_code=503)
            value = (body or {}).get("value")
            delivered = await self.server.broadcast_client_command(cmd, value)
            return JSONResponse({"command": cmd, "value": value, "delivered": delivered})

    # === RECORDING (called by the server) ===

    def _client(self, display_id: int) -> dict:
        return self.per_client.setdefault(
            display_id,
            {"waves": 0, "lastWave": 0, "bot": None, "runs": 0, "bestWave": 0,
             "recent": deque(maxlen=CLIENT_WAVE_HISTORY)},
        )

    def record_wave(self, display_id: int, wave_num: int, bot: str):
        client = self._client(display_id)
        client["waves"] += 1
        client["lastWave"] = wave_num
        client["bot"] = bot
        client["bestWave"] = max(client["bestWave"], wave_num)
        client["recent"].append(wave_num)

    def record_run_end(self, display_id: int, waves: int):
        client = self._client(display_id)
        client["runs"] += 1
        client["bestWave"] = max(client["bestWave"], waves)

    def record_error(self, message: str):
        self.errors.append({"ts": time.time(), "message": str(message)})

    def drop_client(self, display_id: int):
        self.per_client.pop(display_id, None)


dashboard = Dashboard()
