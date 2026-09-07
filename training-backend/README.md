# AI Wave Director — Training Backend

Python-Trainings- und Messserver für den Wave Director mit Live-Web-Dashboard.

**Aktuelle Architektur:** Schema v3 (203 Features), Reward v4, A/B-Director-Roster.

> **Das Backend ist ein Messinstrument, keine Produktionsabhängigkeit.** Im
> Spiel entscheidet ein Regel-Director im Client
> (`src/app/ai/core/rule-director.ts`) — kein Server, kein Modell, keine
> ONNX-Runtime. Warum: [`../docs/HANDOVER_RULE_DIRECTOR.md`](../docs/HANDOVER_RULE_DIRECTOR.md).

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
| `server.py` | WebSocket-Server, State-Encoding, Range-Based Action-Decoding, Fairness-Gate-Regelkreis (`steer_gate`) |
| `directors.py` | A/B-Roster: `model` / `rules` / `random` / `maxgate` — gleichzeitig gegen dieselben Bots |
| `model.py` | Conv1D + Dense-Netz, Template-Head + 4 Continuous-Params + Value-Head |
| `schema.py` | Lädt `generated/ai-schema.json`: Enemy-Tabellen, Templates, Curriculum, Feature-Layout, Decoder-Konstanten. Erzeugt aus den TS-Configs via `npm run ai-schema` — nicht von Hand pflegen. |
| `trainer.py` | PPO-Training-Algorithmus (GAE, Mask-Aware-Reevaluation, Advantage-Clipping) |
| `reward.py` | 4-Term-Reward v4 (DEATH, DRAMA, PACING, SWARM_SIZE) |
| `config.py` | Trainings-Entscheidungen: Hyperparameter, Reward-Shaping, Gate-Regelparameter, Director-Roster |
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
3. Spiel öffnen, Training-Client im Debug-Fenster einschalten — verbindet sich zu `:3001`
4. Bot platziert Tower, der Server generiert Wellen über Template-Auswahl
5. Monitoring im Dashboard `:3002`

Pro Episode laufen `EPISODE_LENGTH = 100` Wellen oder bis zum Game-Over.
Beim Game-Over fordert der Server einen Reset an, der Bot startet eine neue Episode.

**A/B-Lauf:** Mit dem Default-Roster fahren vier verbundene Clients vier
verschiedene Wave-Designer gegen dieselben Bots, dasselbe Curriculum und
denselben Gate. Der Director steht in `logs/training_*.jsonl` an `wave_result`
und `episode_end` im Feld `director` — `scripts/analyze_log.py` gruppiert nicht
danach, die Auswertung ist selbst zu schreiben.

## Tests

```bash
python -m pytest tests -q          # 96 Tests, Stand 2026-09-07
```

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
| `INPUT_SIZE` | 203 | State-Vektor-Größe (163 scalar + 40 spatial), **aus dem Schema** |
| `MAX_TEMPLATE_SLOTS` | 32 | Reservierte Template-Slots (19 aktiv), aus dem Schema |
| `NUM_CONTINUOUS` | 4 | Continuous-Params (count, spawn_delay, hp_mult, variation) |
| `DIRECTOR_ROSTER` | `["model","rules","random","maxgate"]` | A/B-Zuweisung an verbindende Clients; `["model"]` = Einzelbetrieb |
| `LEARNING_RATE` | 0.0001 | Adam-LR |
| `ENTROPY_COEF` | 0.02 | Exploration-Bonus, **nur auf dem Template-Head** |
| `BATCH_SIZE` | 128 | Transitions pro PPO-Update |
| `MINIBATCH_SIZE` | 64 | Minibatch innerhalb eines Updates |
| `TARGET_KL` | 0.02 | Early-Stop pro Minibatch |
| `ADVANTAGE_CLIP` | 3.0 | standardisierte Advantages auf ±3 σ geklemmt |
| `GAMMA` | 0.9 | Discount entlang der Trajektorie |
| `GATE_LEAK_TARGET_LO/HI` | 0.08 / 0.16 | Zielband des Fairness-Gates |
| `GATE_GAIN` | 0.35 | Proportionalverstärkung des Gate-Regelkreises |
| `EPISODE_LENGTH` | 100 | Max. Wellen pro Episode, aus dem Schema |
| `CHECKPOINT_INTERVAL` | 10 | Save-Frequenz |
| `TEMPLATE_COOLDOWN_WAVES` | 2 | Template-Sperre nach Nutzung, aus dem Schema |
| `MAX_WAVE_DURATION_MS` | 180_000 | Hard-Cap auf Wave-Dauer, aus dem Schema |

Werte mit „aus dem Schema" stehen in `generated/ai-schema.json` und werden in
`config.py` nur re-exportiert — sie ändert man in `src/app/ai/core/ai-schema.ts`
und regeneriert mit `npm run ai-schema`.

## Checkpoints

Auto-Save nach `checkpoints/checkpoint_*.pt` alle 10 Episoden.
Server lädt beim Start automatisch den jüngsten Checkpoint.

`server.py --fresh` verschiebt vorhandene Checkpoints nach `checkpoints/archive-<datum>/`
(inkompatibel mit aktueller Architektur, nur für Reward-Kurven-Vergleich).

## Logs

JSONL-Logs in `logs/training_*.jsonl` für Post-hoc-Analyse via
`scripts/analyze_log.py`.

## Dokumentation

| Doku | Inhalt |
|---|---|
| `../docs/HANDOVER_RULE_DIRECTOR.md` | **Einstieg:** warum das Spiel auf Regeln läuft, und was zuerst zu reparieren ist, wenn wieder trainiert werden soll |
| `docs/AI_TRAINING_BACKEND.md` | Vollständige technische Dokumentation |
| `docs/AI_TRAINING_SESSION_NOTES.md` | Entwicklungsgeschichte (neueste zuerst) |
| `docs/AI_MODEL_EXPORT.md` | ONNX-Export für Browser-Inferenz (Opt-in-Pfad) |
| `PHASE5.5_TRAINING_RUNBOOK.md` | Historisches Runbook für Phase-5.5-Restart |

Frontend-seitige Architektur: siehe `docs/PHASE_5.11_RANGES.md` und
`docs/AI_WAVE_DIRECTOR_PLAN.md` im Projekt-Root.
