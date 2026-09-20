# Bot-Server

Python-Server für Bot-Läufe mit Web-Dashboard. Er nimmt Bot-Clients an, schreibt
jede Welle in ein JSONL-Log und steuert die Tabs fern.

> **Der Server plant keine Wellen.** Das macht der Wave Director im Client
> ([`../docs/WAVE_DIRECTOR.md`](../docs/WAVE_DIRECTOR.md)). PPO, ONNX-Modell,
> State-Encoder und der Schema-Spiegel sind am 2026-09-20 entfallen
> ([`../docs/BALANCING_PLAN.md`](../docs/BALANCING_PLAN.md), Phase 1a und 1d).

## Schnellstart (Windows)

```bash
start.bat
```

Startet:
- **WebSocket-Server** auf `ws://localhost:3001` (Clients)
- **Dashboard** auf `http://localhost:3002` (wer läuft, und Fernbedienung)

`start.sh` ist das Pendant für Linux und Mac. Als Hintergrundprozess mit PID-
und Logdatei: `python manage_server.py start` (auch `stop`, `restart`,
`status`, `tail`).

Im Spiel steuert der Skill `/bots` den ganzen Stack.

## Manuelles Setup

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python server.py
```

## Dateien

| Datei | Zweck |
|---|---|
| `server.py` | WebSocket-Server: Clients, Wellen-Log, Fernbedienung |
| `manage_server.py` | Start/Stop/Status als Hintergrundprozess (PID- und Logdatei) |
| `config.py` | Ports, Bot-Gewichte, wie viel je Client im Speicher bleibt |
| `dashboard/app.py` | FastAPI auf `:3002`, ein Status-Endpunkt und die Steuerbefehle |
| `dashboard/static/` | Die Seite: Tabelle der Clients, Knöpfe, Fehlerliste |
| `utils/logger.py` | Konsole und JSONL unter `logs/` |
| `analyze_runs.py` | macht aus einem Stapel Läufe einen HTML-Bericht |
| `analysis/` | Lesen der Run-Logs, Kennzahlen, Bericht |
| `tests/` | pytest gegen den Nachrichten-Handler, den Logger und die Auswertung |

## Protokoll

Client zum Server:

| Nachricht | Inhalt |
|---|---|
| `connect` | `clientId`, `gameVersion` |
| `run_log` | die Zeilen des Run-Logs seit dem letzten Senden, je Welle und am Ende |
| `game_over` | ein Lauf endet (`won`, `waves`) |
| `status` | einmal je Sekunde: Welle, lebende Gegner, Phase |

Server zum Client:

| Nachricht | Inhalt |
|---|---|
| `connected` | `sessionId`, `displayId`, `runState` (`paused` oder `running`) |
| `run_config` | vor jedem Lauf: Bot, Seed, Director-Parametersatz |
| `control` | `start`, `stop`, `reload`, `set_timescale`, `set_rendering` |

`run_config` geht an einen einzelnen Client, nicht als Broadcast: Ein Batch ist
nur wiederholbar, wenn jeder Client seinen eigenen Seed hat.

## Dashboard-API

| Route | Zweck |
|---|---|
| `GET /api/status` | Clients, Welle, Phase, Läufe je Stunde, Fehler, Logdatei |
| `POST /api/control/<cmd>` | `start`, `stop`, `reload`, `set_timescale`, `set_rendering` |

## Läufe und Log

- `runs/<config-hash>/<lauf>.jsonl` — die Run-Logs der Clients, gefiltert nach
  Balance-Stand. Format: [RUN_LOG.md](../docs/RUN_LOG.md).
- `logs/bots_<zeitstempel>.jsonl` — was der Server selbst sah
  (`client_connected`, `client_session`, `run_start`, `run_end`, `error`).

## Auswertung

```bash
venv\Scripts\python.exe analyze_runs.py --open
venv\Scripts\python.exe analyze_runs.py runs/3f2a91c7 ~/Downloads/3dtd-run-*.jsonl
```

Liest Bot-Läufe und exportierte Spieler-Läufe gleich, gruppiert nach
Balance-Stand, Parametersatz und Spieler, und schreibt `run-report.html`:
HP-Verlust, Leck-Quote, Golddruck, Ausgaben, Entscheidungen und Wellendauer je
Welle, dazu die Tower-Anteile. Eine Seite ohne Netz, die Kurven sind
eingebettetes SVG. Stehen zwei Balance-Stände im Stapel, sagt der Bericht das
oben, statt sie zu mitteln.

## Tests

```bash
venv\Scripts\python.exe -m pytest tests -q
```
