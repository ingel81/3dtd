"""
Bot-Server configuration.

Everything the server itself decides: where it listens, which bot the clients
play and how much it keeps in memory. The game's own numbers (enemies, waves,
templates, economy) live in the TypeScript configs and are never mirrored here
any more — the client plans every wave itself since 2026-09-20
(docs/BALANCING_PLAN.md, phase 1a).
"""

# === SERVER ===
SERVER_HOST = "localhost"
SERVER_PORT = 3001
DASHBOARD_PORT = 3002

# === BOTS ===
# Skill levels the server hands out to connecting clients, with their weight
# in the draw. Two bots since 2026-09-20 (BALANCING_PLAN.md, D15): a beginner
# and an expert. Equal weights means a batch measures both.
BOT_WEIGHTS = {"beginner": 1.0, "expert": 1.0}

# === RUNS ===
# The director parameter set every client plays. A batch that compares two
# sets runs the server twice, once per name; the name lands in every run
# log's head, so the analysis can tell the runs apart.
DIRECTOR_PARAMS = "cap-loose"

# Where the run logs land: runs/<config-hash>/<run-id>.jsonl. The config hash
# comes out of the log's own head, so runs of different balance never mix.
RUNS_DIR = "runs"

# === LOGGING ===
# Waves a client keeps in memory for the dashboard's per-client card.
CLIENT_WAVE_HISTORY = 50

# A client is counted as gone from the dashboard after this many seconds
# without a status push (the client sends one per second).
CLIENT_STALE_AFTER_S = 5
