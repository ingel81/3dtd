"""What a training run writes to its JSONL about the build and the waves.

Playtest 565 (fix session 2026-09-14): a connect message carries the game's
BUILD_VERSION, and the server writes it as a `client_session` entry; each
`wave_result` entry carries the wave's `perfect` flag from the client's
outcome (WaveOutcome.perfect, taken from wave:completed). Both through the
server's own message handler and the real logger, into a log file of the test.
"""

import asyncio
import json

import pytest

import server
from utils.logger import logger


class _Ws:
    """The client's socket: keeps what the server sends back."""

    def __init__(self):
        self.sent = []

    async def send(self, text):
        self.sent.append(json.loads(text))


async def _nothing(*_args, **_kwargs):
    return None


@pytest.fixture
def srv(monkeypatch):
    """A server without model, trainer, dashboard and checkpoints."""
    s = server.TrainingServer.__new__(server.TrainingServer)
    s.client_contexts = {}
    s.training_state = "paused"
    s.dashboard = None
    s.episode = 0
    s.total_reward = 0
    # Past the log line the result goes to training; that is not what is tested here
    monkeypatch.setattr(s, "_process_result", lambda *args, **kwargs: (0.0, {}), raising=False)
    monkeypatch.setattr(s, "_save_checkpoint", lambda: None, raising=False)
    monkeypatch.setattr(s, "_broadcast_stats", _nothing, raising=False)
    monkeypatch.setattr(server, "EPISODE_LENGTH", 1000)
    return s


@pytest.fixture
def log(tmp_path, monkeypatch):
    """Point the shared logger at a file of this test and read it back."""
    path = tmp_path / "training_test.jsonl"
    handle = open(path, "a", encoding="utf-8")
    monkeypatch.setattr(logger, "logfile", handle)

    def entries(kind):
        handle.flush()
        lines = path.read_text(encoding="utf-8").splitlines()
        return [e for e in map(json.loads, lines) if e["type"] == kind]

    yield entries
    handle.close()


def _handle(srv, msg, client_id=4242):
    ws = _Ws()
    asyncio.run(srv._handle_message(ws, client_id, msg))
    return ws


def _result(wave, perfect):
    outcome = {
        "damagePercent": 0.4,
        "enemiesKilled": 12,
        "enemiesSpawned": 12,
        "avgPathProgressPercent": 0.5,
        "enemyProgressValues": [0.3, 0.5, 0.7],
        "wasCloseCall": False,
    }
    if perfect is not None:
        outcome["perfect"] = perfect
    return {"type": "result", "data": {"waveNumber": wave, "outcome": outcome, "stateAfter": None}}


def test_connect_writes_the_game_version(srv, log):
    ws = _handle(srv, {"type": "connect", "clientId": "c1", "gameVersion": "v0.2.0"})

    assert ws.sent[0]["type"] == "connected"
    [session] = log("client_session")
    assert session["game_version"] == "v0.2.0"
    assert session["client_id"] == 4242


def test_wave_result_carries_perfect_from_the_outcome(srv, log):
    _handle(srv, _result(1, True))
    _handle(srv, _result(2, False))

    results = log("wave_result")
    assert [(r["wave"], r["perfect"]) for r in results] == [(1, True), (2, False)]


def test_wave_result_without_the_flag_leaves_it_out(srv, log):
    # A client from before cc1ee892 sent no perfect: nothing is made up
    _handle(srv, _result(1, None))

    [result] = log("wave_result")
    assert "perfect" not in result
