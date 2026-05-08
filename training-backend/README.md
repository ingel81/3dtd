# AI Wave Director — Training Backend

Python training server für den AI Wave Director mit Live-Web-Dashboard.

**Aktuelle Architektur:** Phase 5.11 (Range-Based Templates) mit Phase 5.16 Wave-Curriculum-Override.

## Quick Start (Windows)

```bash
start.bat
```

Startet:
- **WebSocket-Server** auf `ws://localhost:3001` (Game-Kommunikation)
- **Web-Dashboard** auf `http://localhost:3002` (Live-Monitoring)

`start.sh` ist das Linux/Mac-Pendant.

## Manuelles Setup

```bash
# Venv anlegen + Dependencies installieren
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# Server starten
python server.py
```

Dashboard wird automatisch mitgestartet (kann via `DASHBOARD=0` deaktiviert werden).

## Architektur

| Datei | Zweck |
|------|---------|
| `server.py` | WebSocket-Server, State-Encoding, Range-Based Action-Decoding |
| `model.py` | Conv1D + Dense-Netz, Template-Head + 4 Continuous-Params + Value-Head |
| `templates.py` | 32 Wave-Templates (18 aktiv) mit Designer-Ranges + Curriculum-Gates |
| `wave_curriculum.py` | Phase-5.16 Designer-Forced-Variety für Waves 1–18 |
| `trainer.py` | PPO-Training-Algorithmus |
| `reward.py` | 4-Term-Reward (DEATH, DRAMA, SWARM_SIZE, PROGRESSION) |
| `config.py` | Hyperparameter, State-Layout, Enemy-Definitions |
| `dashboard/` | FastAPI-Dashboard mit Chart.js |
| `tui_logger.py` / `auto_logger.py` | Console-Output + JSONL-Logging |
| `scripts/export_to_tfjs.py` | ONNX-Export für Browser-Inferenz |
| `scripts/analyze_log.py` | Post-hoc-Analyse von Trainings-Logs |
| `inspect_training.py` | Interaktives Checkpoint-Inspect-Tool |
| `manage_server.py` | Helper für Start/Stop |

## Web-Dashboard

`http://localhost:3002` — Live-Visualisierung:

- Reward, Damage-Sweet, Near-Miss-Charts mit Trendlinien
- Modell-Metriken (Policy-Loss, Entropy, Grad-Norm)
- Damage-Verteilung (Boring/Sweet/Hard/Game-Over)
- Per-Client-DPS-Profile (Ground + Air, je 20 Bins)
- Wave-Log + Training-Log
- Template-Auswahl-Histogramm

## Training-Workflow

1. Backend starten: `start.bat` (oder `python server.py`)
2. Frontend starten: `npm start` im Projekt-Root
3. Spiel öffnen, Training-Client verbindet sich automatisch zu `:3001`
4. Bot platziert Tower, AI generiert Wellen über Template-Auswahl
5. Monitoring im Dashboard `:3002`

Pro Episode laufen `EPISODE_LENGTH = 100` Wellen oder bis zum Game-Over.
Beim Game-Over fordert der Server einen Reset an, der Bot startet eine neue Episode.

## Anforderungen

- Python 3.8+
- PyTorch 2.0+
- FastAPI + uvicorn
- websockets

Siehe `requirements.txt` für die exakten Versionen.

## Konfiguration

Editiere `config.py`:

| Parameter | Default | Bedeutung |
|---|---|---|
| `SERVER_PORT` | 3001 | WebSocket-Port |
| `INPUT_SIZE` | 156 | State-Vektor-Größe (116 scalar + 40 spatial) |
| `MAX_TEMPLATE_SLOTS` | 32 | Reservierte Template-Slots (18 aktiv) |
| `NUM_CONTINUOUS` | 4 | Continuous-Params (count, spawn_delay, hp_mult, variation) |
| `LEARNING_RATE` | 0.0003 | Adam-LR |
| `ENTROPY_COEF` | 0.05 | Exploration-Bonus |
| `BATCH_SIZE` | 16 | Episoden pro PPO-Update |
| `EPISODE_LENGTH` | 100 | Max. Wellen pro Episode |
| `CHECKPOINT_INTERVAL` | 10 | Save-Frequenz |
| `TEMPLATE_COOLDOWN_WAVES` | 2 | Template-Sperre nach Nutzung |
| `MAX_WAVE_DURATION_MS` | 180_000 | Hard-Cap auf Wave-Dauer |

## Checkpoints

Auto-Save nach `checkpoints/checkpoint_*.pt` alle 10 Episoden.
Server lädt beim Start automatisch den jüngsten Checkpoint.

`checkpoints/archive-v3.5/` enthält die Pre-Phase-5.5-Checkpoints
(inkompatibel mit aktueller Architektur, nur für Reward-Kurven-Vergleich).

## Logs

JSONL-Logs in `logs/training_*.jsonl` für Post-hoc-Analyse via
`scripts/analyze_log.py`.

## Dokumentation

| Doku | Inhalt |
|---|---|
| `docs/AI_TRAINING_BACKEND.md` | Vollständige technische Dokumentation |
| `docs/AI_TRAINING_SESSION_NOTES.md` | Entwicklungsgeschichte (v1 → Phase 5.11) |
| `docs/AI_MODEL_EXPORT.md` | ONNX-Export für Browser-Inferenz |
| `PHASE5.5_TRAINING_RUNBOOK.md` | Historisches Runbook für Phase-5.5-Restart |

Frontend-seitige Architektur: siehe `docs/PHASE_5.11_RANGES.md` und
`docs/AI_WAVE_DIRECTOR_PLAN.md` im Projekt-Root.
