"""
Training-Server Lifecycle Manager.

Start/stop/restart/status of the WebSocket training server as a background
process. Tracks PID in `.server.pid`, routes stdout/stderr to `.server.log`.

Usage:
  python manage_server.py start
  python manage_server.py stop
  python manage_server.py restart
  python manage_server.py status
  python manage_server.py tail          # show last 40 log lines
  python manage_server.py tail --lines 200
"""

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
PID_FILE = HERE / ".server.pid"
LOG_FILE = HERE / ".server.log"
SERVER_MODULE = "server"  # runs `python server.py`


def _python_executable() -> str:
    """Return the venv python if present, else the interpreter that ran us.

    Important: the training server needs packages installed in the
    training-backend/venv (websockets, torch, fastapi, etc.). If manage_server
    was launched via a system-python, sys.executable would NOT have those
    packages.
    """
    if os.name == "nt":
        candidate = HERE / "venv" / "Scripts" / "python.exe"
    else:
        candidate = HERE / "venv" / "bin" / "python"
    if candidate.exists():
        return str(candidate)
    return sys.executable


# ─── OS helpers ───────────────────────────────────────────────────────────────

def _is_alive(pid: int) -> bool:
    """Cross-platform check: is this PID still a running process?"""
    if pid <= 0:
        return False
    try:
        if os.name == "nt":
            # Windows: use tasklist. errors='replace' avoids cp1252 Unicode crashes
            # when task names contain non-ASCII characters.
            out = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, check=False,
                encoding="utf-8", errors="replace",
            )
            stdout = out.stdout or ""
            return str(pid) in stdout
        else:
            os.kill(pid, 0)
            return True
    except (ProcessLookupError, PermissionError, OSError):
        return False


def _kill(pid: int) -> bool:
    """Terminate process. Returns True if killed or already dead."""
    if not _is_alive(pid):
        return True
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], check=False,
                           capture_output=True)
        else:
            os.kill(pid, signal.SIGTERM)
            time.sleep(0.5)
            if _is_alive(pid):
                os.kill(pid, signal.SIGKILL)
        # Wait up to 3s for process to really die
        for _ in range(30):
            if not _is_alive(pid):
                return True
            time.sleep(0.1)
        return False
    except (ProcessLookupError, PermissionError, OSError):
        return True


def _read_pid() -> int | None:
    if not PID_FILE.exists():
        return None
    try:
        return int(PID_FILE.read_text().strip())
    except (ValueError, OSError):
        return None


# ─── Actions ──────────────────────────────────────────────────────────────────

def cmd_start() -> int:
    existing = _read_pid()
    if existing and _is_alive(existing):
        print(f"[manage] Already running (PID {existing}).")
        return 0

    # Clear stale pid file if process is dead
    if existing:
        PID_FILE.unlink(missing_ok=True)

    # Open log for append so subsequent starts don't truncate history
    log = LOG_FILE.open("ab")
    # On Windows, CREATE_NEW_PROCESS_GROUP lets us kill the whole group later
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW

    python = _python_executable()
    proc = subprocess.Popen(
        [python, "-u", f"{SERVER_MODULE}.py"],
        cwd=HERE,
        stdout=log,
        stderr=subprocess.STDOUT,
        creationflags=creationflags,
    )
    PID_FILE.write_text(str(proc.pid))
    print(f"[manage] Started (PID {proc.pid}), log: {LOG_FILE.name}")

    # Quick liveness check after 1s — catch immediate crashes
    time.sleep(1.5)
    if not _is_alive(proc.pid):
        PID_FILE.unlink(missing_ok=True)
        print("[manage] ERROR — server died within 1.5s. See log:")
        _tail(30)
        return 1
    return 0


def cmd_stop() -> int:
    pid = _read_pid()
    if not pid:
        print("[manage] Not running (no pid file).")
        return 0
    if not _is_alive(pid):
        PID_FILE.unlink(missing_ok=True)
        print(f"[manage] Not running (pid {pid} already dead, cleaned up).")
        return 0

    ok = _kill(pid)
    if ok:
        PID_FILE.unlink(missing_ok=True)
        print(f"[manage] Stopped (PID {pid}).")
        return 0
    print(f"[manage] ERROR — could not kill PID {pid}.")
    return 1


def cmd_restart() -> int:
    rc = cmd_stop()
    if rc != 0:
        return rc
    time.sleep(0.3)
    return cmd_start()


def cmd_status() -> int:
    pid = _read_pid()
    if not pid:
        print("[manage] stopped (no pid file)")
        return 3
    alive = _is_alive(pid)
    if alive:
        size_kb = LOG_FILE.stat().st_size / 1024 if LOG_FILE.exists() else 0
        print(f"[manage] running (PID {pid}, log {size_kb:.1f} KB)")
        return 0
    print(f"[manage] dead (pid file has {pid}, process not alive)")
    return 2


def _tail(n: int = 40) -> None:
    if not LOG_FILE.exists():
        print("[manage] (no log file yet)")
        return
    # Read last N lines efficiently
    try:
        with LOG_FILE.open("rb") as f:
            f.seek(0, 2)
            size = f.tell()
            block = 4096
            data = b""
            pos = size
            while pos > 0 and data.count(b"\n") <= n:
                read = min(block, pos)
                pos -= read
                f.seek(pos)
                data = f.read(read) + data
        lines = data.decode("utf-8", errors="replace").splitlines()
        for line in lines[-n:]:
            print(line)
    except OSError as e:
        print(f"[manage] tail error: {e}")


def cmd_tail(lines: int) -> int:
    _tail(lines)
    return 0


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=["start", "stop", "restart", "status", "tail"])
    p.add_argument("--lines", type=int, default=40, help="tail line count")
    args = p.parse_args()

    if args.action == "start":
        return cmd_start()
    if args.action == "stop":
        return cmd_stop()
    if args.action == "restart":
        return cmd_restart()
    if args.action == "status":
        return cmd_status()
    if args.action == "tail":
        return cmd_tail(args.lines)
    return 1


if __name__ == "__main__":
    sys.exit(main())
