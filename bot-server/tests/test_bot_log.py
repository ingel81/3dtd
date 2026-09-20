"""What the server does with a bot run: the run config it hands out, and the
run-log lines it files.

The server neither plans waves nor reads the log's contents; it hands each
client a bot, a seed and a parameter set, and appends what comes back to
`runs/<config-hash>/<run-id>.jsonl` (docs/RUN_LOG.md, BALANCING_PLAN.md 2b).
Everything goes through the server's own message handler.
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


@pytest.fixture
def srv(tmp_path, monkeypatch):
    """A server without a dashboard, writing its runs into the test's folder."""
    s = server.BotServer.__new__(server.BotServer)
    s.clients = set()
    s.client_contexts = {}
    s.client_statuses = {}
    s.dashboard = None
    s.run_state = "paused"
    s.runs_finished = 0
    s.waves_logged = 0
    monkeypatch.setattr(server, "RUNS_DIR", str(tmp_path / "runs"))
    return s


@pytest.fixture
def log(tmp_path, monkeypatch):
    """Point the shared logger at a file of this test and read it back."""
    path = tmp_path / "bots_test.jsonl"
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


def _head(config_hash="abc123"):
    return json.dumps({
        "kind": "head", "format": 1, "runId": "run-1", "startedAt": "2026-09-20T10:00:00.000Z",
        "gameVersion": "v0.3.2", "commit": "d227323b", "configHash": config_hash,
        "seed": 4711, "player": "bot", "botSkill": "expert", "map": "devworld",
    })


def _wave(wave):
    return json.dumps({"kind": "wave", "wave": wave, "step": 0, "timeMs": 0, "durationMs": 1000,
                       "creditsStart": 100, "creditsEnd": 120, "income": {}, "spending": {},
                       "enemiesSpawned": 3, "killsByTower": 3, "killsByHero": 0, "killsByAbility": 0,
                       "killsByDebug": 0, "killsByOther": 0, "leaked": 0,
                       "healthStart": 100, "healthEnd": 100, "towers": []})


def _run_log(lines, final=False, run_id="run-1"):
    return {"type": "run_log", "runId": run_id, "lines": lines, "final": final}


def test_connect_answers_with_the_run_state_and_the_run_config(srv, log):
    ws = _handle(srv, {"type": "connect", "clientId": "c1", "gameVersion": "v0.3.2"})

    assert ws.sent[0]["type"] == "connected"
    assert ws.sent[0]["runState"] == "paused"
    assert ws.sent[0]["displayId"] == 4242

    config = ws.sent[1]
    assert config["type"] == "run_config"
    assert config["bot"] in ("beginner", "expert")
    assert isinstance(config["seed"], int)
    assert config["directorParams"] == "default"

    [session] = log("client_session")
    assert session["game_version"] == "v0.3.2"


def test_every_client_gets_its_own_seed(srv):
    first = _handle(srv, {"type": "connect", "clientId": "c1", "gameVersion": "v"}, client_id=1)
    second = _handle(srv, {"type": "connect", "clientId": "c2", "gameVersion": "v"}, client_id=2)

    # A batch only repeats if every client runs its own seed
    assert first.sent[1]["seed"] != second.sent[1]["seed"]


def test_run_log_lines_land_under_the_config_hash(srv, tmp_path):
    _handle(srv, _run_log([_head("deadbeef"), _wave(1)]))
    _handle(srv, _run_log([_wave(2)], final=True))

    path = tmp_path / "runs" / "deadbeef" / "run-1.jsonl"
    written = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert [r["kind"] for r in written] == ["head", "wave", "wave"]
    assert [r["wave"] for r in written if r["kind"] == "wave"] == [1, 2]


def test_a_log_without_a_head_is_filed_as_unknown(srv, tmp_path):
    # A client that reconnects mid-run sends no head again
    _handle(srv, _run_log([_wave(5)]))

    assert (tmp_path / "runs" / "unknown" / "run-1.jsonl").exists()


def test_broken_lines_do_not_take_the_file_with_them(srv, tmp_path):
    _handle(srv, _run_log([_head(), "{not json", _wave(1)]))

    path = tmp_path / "runs" / "abc123" / "run-1.jsonl"
    assert len(path.read_text(encoding="utf-8").splitlines()) == 3
    assert srv.waves_logged == 1


def test_the_waves_of_the_log_are_counted(srv):
    _handle(srv, _run_log([_head(), _wave(1), _wave(2), _wave(3)]))

    assert srv.waves_logged == 3
    assert srv.client_contexts[4242].wave_num == 3


def test_a_run_that_ends_is_counted_and_gets_the_next_config(srv, log):
    _handle(srv, _run_log([_head(), _wave(7)]))
    ws = _handle(srv, {"type": "game_over", "won": False, "waves": 7})

    [end] = log("run_end")
    assert end["waves"] == 7
    assert end["reason"] == "game_over"
    assert srv.runs_finished == 1
    # The next run gets its own bot and seed
    assert ws.sent[0]["type"] == "run_config"


def test_status_is_kept_per_client_for_the_dashboard(srv):
    _handle(srv, {"type": "status", "wave": 12, "enemiesAlive": 30, "phase": "wave"})

    status = srv.client_statuses[4242]
    assert (status["wave"], status["enemiesAlive"], status["phase"]) == (12, 30, "wave")
