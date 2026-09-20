"""
Bot-Server.

WebSocket server for bot runs. It is transport, log and remote control:

- browsers connect, are told which bot, seed and director parameter set to
  play, and push a status once a second
- every finished wave arrives as run-log lines and is appended to a file
- the dashboard (port 3002) shows who is running and can start, stop, reload
  or re-speed every client

It does not plan waves. The client's Wave Director decides every wave on its
own since 2026-09-20 (docs/BALANCING_PLAN.md, phase 1a), so there is no model,
no encoder and no copy of the game's tables here any more.
"""

import asyncio
import json
import random
import time
from datetime import datetime
from pathlib import Path

import websockets

from config import (
    SERVER_HOST,
    SERVER_PORT,
    DASHBOARD_PORT,
    BOT_WEIGHTS,
    DIRECTOR_PARAMS,
    RUNS_DIR,
)
from utils.logger import logger

# Optional dashboard (FastAPI). Without it the server runs headless.
try:
    from dashboard.app import dashboard as _dashboard
except ImportError:
    _dashboard = None


class ClientContext:
    """What the server knows about one connected browser."""

    def __init__(self):
        self.bot = "expert"
        self.wave_num = 0
        self.waves_played = 0
        self.runs = 0
        self.game_version = None
        # The seed of the run this client is playing. Handed out per client:
        # a batch is only repeatable if every client has its own
        # (BALANCING_PLAN.md, section 5).
        self.seed = None


class BotServer:
    """WebSocket server for bot runs."""

    def __init__(self):
        self.dashboard = _dashboard
        if self.dashboard:
            self.dashboard.set_server(self)

        self.clients = set()
        self.client_contexts = {}          # client_id -> ClientContext
        self.client_statuses: dict[int, dict] = {}   # display_id -> live status
        self.started_at = time.time()
        self.runs_finished = 0
        self.waves_logged = 0
        # Clients join paused; the dashboard's Start flips this and broadcasts.
        self.run_state = "paused"          # 'paused' | 'running'

    # === CONNECTION ===

    async def handle_client(self, websocket):
        self.clients.add(websocket)
        client_id = id(websocket)
        self.client_contexts[client_id] = ClientContext()
        logger.client_connected(client_id, len(self.clients))

        try:
            async for message in websocket:
                try:
                    await self._handle_message(websocket, client_id, json.loads(message))
                except Exception as e:
                    logger.error(f"message from #{client_id % 10000}: {type(e).__name__}: {e}")
        except (websockets.ConnectionClosed, asyncio.CancelledError):
            pass
        finally:
            self.clients.discard(websocket)
            self.client_contexts.pop(client_id, None)
            self.client_statuses.pop(client_id % 10000, None)
            if self.dashboard:
                self.dashboard.drop_client(client_id % 10000)
            logger.client_disconnected(client_id, len(self.clients))

    # === MESSAGES ===

    async def _handle_message(self, ws, client_id, msg):
        msg_type = msg.get("type")
        ctx = self.client_contexts.setdefault(client_id, ClientContext())
        display_id = client_id % 10000

        if msg_type == "connect":
            ctx.game_version = msg.get("gameVersion")
            ctx.bot = self._pick_bot()
            await ws.send(json.dumps({
                "type": "connected",
                "sessionId": f"session_{datetime.now().timestamp()}",
                "displayId": display_id,
                "runState": self.run_state,
            }))
            logger.client_session(client_id, ctx.game_version)
            await self._send_run_config(ws, ctx, client_id)

        elif msg_type == "run_log":
            self._write_run_log(ctx, client_id, msg)

        elif msg_type == "game_over":
            self.runs_finished += 1
            logger.run_end(client_id, ctx.wave_num, reason="won" if msg.get("won") else "game_over")
            if self.dashboard:
                self.dashboard.record_run_end(display_id, ctx.wave_num)
            # The next run gets its own bot and seed, so a batch covers both
            # bots and never repeats a seed by accident.
            await self._send_run_config(ws, ctx, client_id)

        elif msg_type == "status":
            self.client_statuses[display_id] = {
                "wave": int(msg.get("wave", 0) or 0),
                "enemiesAlive": int(msg.get("enemiesAlive", 0) or 0),
                "phase": msg.get("phase", "setup"),
                "bot": ctx.bot,
                "ts": time.time(),
            }

    async def _send_run_config(self, ws, ctx, client_id):
        """Tell the client what the next run plays: bot, seed, parameter set."""
        ctx.bot = self._pick_bot()
        ctx.seed = random.getrandbits(32)
        ctx.runs += 1
        ctx.wave_num = 0
        ctx.waves_played = 0
        await ws.send(json.dumps({
            "type": "run_config",
            "bot": ctx.bot,
            "seed": ctx.seed,
            "directorParams": DIRECTOR_PARAMS,
        }))
        logger.run_start(client_id, ctx.bot)

    def _write_run_log(self, ctx, client_id, msg):
        """
        Append the client's run-log lines to its file.

        The server does not read the log, it stores it: the format belongs to
        the game (docs/RUN_LOG.md) and the analysis reads the files. Only the
        head is looked at, for the config hash the file is filed under, and
        the wave blocks, to count what the dashboard shows.
        """
        run_id = str(msg.get("runId") or "").replace("/", "_").replace("\\", "_")
        lines = msg.get("lines") or []
        if not run_id or not lines:
            return

        for line in lines:
            try:
                record = json.loads(line)
            except (TypeError, ValueError):
                continue
            kind = record.get("kind")
            if kind == "head":
                ctx.config_hash = str(record.get("configHash") or "unknown")
            elif kind == "wave":
                ctx.wave_num = int(record.get("wave", 0) or 0)
                ctx.waves_played += 1
                self.waves_logged += 1
                if self.dashboard:
                    self.dashboard.record_wave(client_id % 10000, ctx.wave_num, ctx.bot)

        path = Path(RUNS_DIR) / getattr(ctx, "config_hash", "unknown")
        path.mkdir(parents=True, exist_ok=True)
        with (path / f"{run_id}.jsonl").open("a", encoding="utf-8") as handle:
            for line in lines:
                handle.write(line + "\n")

    def _pick_bot(self) -> str:
        """Draw a bot from BOT_WEIGHTS."""
        names = list(BOT_WEIGHTS.keys())
        weights = [BOT_WEIGHTS[n] for n in names]
        return random.choices(names, weights=weights, k=1)[0]

    # === REMOTE CONTROL (dashboard -> clients) ===

    async def broadcast_client_command(self, cmd: str, value=None) -> int:
        """
        Send a control command to every connected client.

          - 'start'          : bot on, game speed 75
          - 'stop'           : bot off, game speed 1
          - 'reload'         : hard-reload the tab (fresh engine)
          - 'set_timescale'  : value=number — game speed
          - 'set_rendering'  : value=bool   — draw the 3D scene or not

        Returns how many clients got it.
        """
        if cmd == "start":
            self.run_state = "running"
        elif cmd == "stop":
            self.run_state = "paused"

        payload = {"type": "control", "action": cmd}
        if value is not None:
            payload["value"] = value
        msg = json.dumps(payload)

        delivered = 0
        for client in list(self.clients):
            try:
                await client.send(msg)
                delivered += 1
            except Exception:
                pass
        logger.info(f"control '{cmd}' value={value} -> {delivered}/{len(self.clients)} clients")
        return delivered

    # === STATUS (dashboard -> browser) ===

    def status(self) -> dict:
        """What the dashboard polls: who is connected and what they are doing."""
        hours = max(1e-6, (time.time() - self.started_at) / 3600)
        return {
            "runState": self.run_state,
            "clientCount": len(self.clients),
            "clients": [
                {"id": display_id, **status}
                for display_id, status in sorted(self.client_statuses.items())
            ],
            "wavesLogged": self.waves_logged,
            "runsFinished": self.runs_finished,
            "runsPerHour": round(self.runs_finished / hours, 1),
            "wavesPerHour": round(self.waves_logged / hours, 1),
            "logfile": str(logger.logfile_path),
        }


async def main():
    """WebSocket server plus the dashboard, if FastAPI is installed."""
    server = BotServer()
    dashboard_task = None

    try:
        await websockets.serve(
            server.handle_client,
            SERVER_HOST,
            SERVER_PORT,
            ping_interval=None,   # the browser is busy drawing; a missed ping is not a death
            ping_timeout=None,
            close_timeout=30,
        )
        logger.server_started(SERVER_HOST, SERVER_PORT)

        if _dashboard:
            try:
                import uvicorn
                config = uvicorn.Config(
                    _dashboard.app,
                    host="0.0.0.0",
                    port=DASHBOARD_PORT,
                    log_level="warning",
                )
                dashboard_task = asyncio.create_task(uvicorn.Server(config).serve())
                logger.info(f"dashboard on http://localhost:{DASHBOARD_PORT}")
            except ImportError:
                logger.warning("uvicorn not installed, dashboard disabled")

        await asyncio.Future()   # run forever
    except asyncio.CancelledError:
        logger.server_shutdown()
    finally:
        if dashboard_task:
            dashboard_task.cancel()
        logger.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.server_shutdown()
        logger.stop()
    except Exception as e:
        logger.error(f"Server error: {e}")
        logger.stop()
