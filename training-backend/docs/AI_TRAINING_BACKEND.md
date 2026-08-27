# AI Training Backend

**Stand:** 2026-05-08 — Phase 5.11 Range-Based Templates (Phase 5.16 Wave-Curriculum-Override aktiv).

## Überblick

Python-basiertes Trainingssystem für den AI Wave Director. Besteht aus
WebSocket-Server (Port 3001), PPO-Trainer und Web-Dashboard (Port 3002)
für Live-Monitoring.

**Stack:**
- Python 3.8+ / PyTorch 2.0+
- WebSocket-Server (`websockets`)
- FastAPI + Chart.js Dashboard
- ONNX (Browser-Export)

**Location:** `training-backend/`

---

## Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRAINING BACKEND (Python)                     │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   server.py  │───▶│   model.py   │───▶│  trainer.py  │       │
│  │  (WebSocket) │    │ (Template+4P)│    │    (PPO)     │       │
│  └──────┬───────┘    └──────────────┘    └──────────────┘       │
│         │                                                        │
│         │            ┌──────────────┐  ┌──────────────┐         │
│         ├──────────▶│  schema.py   │  │  reward.py   │         │
│         │            │ (32 slots,   │  │ (4 terms)    │         │
│         │            │  curriculum) │  └──────────────┘         │
│         │            └──────┬───────┘                            │
│         │                   │ liest                              │
│         │            ┌──────▼────────────────┐                   │
│         └──────────▶│ generated/             │                   │
│                      │   ai-schema.json      │                   │
│                      │ (npm run ai-schema)   │                   │
│                      └───────────────────────┘                   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  dashboard/                                               │   │
│  │  ├── app.py     (FastAPI, WebSocket-Broadcast)            │   │
│  │  └── static/    (Chart.js, Live-UI)                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└────────────────────────────────────┬────────────────────────────┘
        WebSocket :3001              │  HTTP :3002
              │                      │
              ▼                      ▼
┌─────────────────────────┐  ┌────────────────────┐
│  BROWSER (Angular)      │  │  WEB DASHBOARD     │
│  Game + Strategy-Bot    │  │  (localhost:3002)   │
│  + Training-Client      │  │  Charts, Metriken  │
└─────────────────────────┘  └────────────────────┘
```

---

## Datei-Struktur

```
training-backend/
├── server.py              # WebSocket-Server, State-Encoder, Action-Decoder
├── model.py               # Conv1D + Dense — Template-Head + 4 Continuous-Params
├── schema.py              # Lädt generated/ai-schema.json (Templates, Curriculum,
│                         #   Enemy-Tabellen, Feature-Layout) — generiert aus den TS-Configs
├── generated/             # ai-schema.json, erzeugt von `npm run ai-schema`
├── trainer.py             # PPO-Training mit Mask-Aware-Reevaluation
├── reward.py              # 4-Term-Reward v4 (DEATH, DRAMA, PACING, SWARM_SIZE)
├── config.py              # Hyperparameter, State-Layout, Enemy-Defs
│
├── tui_logger.py          # Console-Logger + JSONL-File-Logging
├── auto_logger.py         # Logger-Shim
│
├── inspect_training.py    # Interaktives Checkpoint-Inspect-Tool
├── manage_server.py       # Start/Stop-Helper
│
├── dashboard/
│   ├── app.py             # FastAPI-Dashboard-Server
│   └── static/
│       ├── index.html     # Dashboard-UI
│       ├── app.js         # Chart.js + WebSocket-Live-Updates
│       └── style.css      # Dark-Theme
│
├── scripts/
│   ├── export_to_tfjs.py  # ONNX-Export (Frontend-Inferenz)
│   └── analyze_log.py     # Post-hoc JSONL-Analyse
│
├── tests/                 # pytest-Suite
├── requirements.txt
├── start.bat / start.sh   # Startup-Skripte
├── checkpoints/           # checkpoint_*.pt (alle 10 Episoden) + checkpoint_latest.pt
└── logs/                  # JSONL-Trainingslogs
```

---

## Kern-Konzepte

### 1. State-Vektor (162 Features, Schema v2)

```
[0..52]    Base scalar (53)         — Spielerzustand, Tower-Stats, Enemy-Counter
[53..105]  Phase 5.6 awareness (53) — Damage-History, Type-History, Skill-Heuristik
[106..115] Effective DPS per armor (10) — DPS aufgeschlüsselt nach Armor-Effektivität
[116..135] Ground DPS-Profile (20)   — DPS pro Bin entlang des Pfads
[136..155] Air DPS-Profile (20)      — Air-DPS pro Bin
```

Layout-Definitionen: `config.py` (Header-Kommentar) + `server.py::_build_state`.
Frontend-Pendant: `src/app/ai/core/game-state-encoder.ts`.

### 2. Template-Based Action-Space (Phase 5.10/5.11)

Statt direkter Enemy-Type-Wahl pickt das NN aus 19 aktiven Templates
+ 4 Continuous-Params:

```
template_head:  Categorical(32)            # 32 Slots, 19 aktiv (Rest reserviert)
params_head:    sigmoid → [0,1] × 4        # count, spawn_delay, hp_mult, variation
log_std:        learnable                  # Exploration-Noise pro Continuous-Param
```

Jedes Template hat designer-gesetzte Ranges. Der Decoder interpoliert die
sigmoid-Faktoren in diese Ranges:

```python
final_count = lerp(template.count_range, count_factor)
```

**Hard Constraints im Decoder:**
- **Curriculum-Gate** (`min_wave`): Template gesperrt bis Wave N erreicht
- **Capability-Gate** (`requires_capability`): "antiAir" / "antiEthereal" muss
  vom Spieler erforscht sein
- **Boss-only**: Nur an `wave % 10 == 0`
- **Cooldown**: Template `TEMPLATE_COOLDOWN_WAVES = 2` Wellen lang gesperrt
- **DPS-Scaled Range Caps** (Phase 5.11b): Bei niedriger Spieler-DPS wird das
  obere Ende der Difficulty-Ranges (count, hp_mult) zusammengezogen
- **Wave-Duration-Cap**: Wenn `count × spawn_delay > 180s`, wird `spawn_delay`
  auf `max(5ms, cap/count)` komprimiert

**Phase 5.16 Wave-Curriculum-Override:**
Für Waves 1–30 verengt `schema.get_available_template_mask` die Maske auf genau ein Template / Mask-
Constraints (Boss-Wellen, Air-Forced, etc.). Die NN-Entscheidung wird vor
der Validierung durch den Curriculum-Layer gefiltert.

### 3. DPS-Profil (räumliche Verteidigung)

Pfad in **20 Bins** (Ground + Air separat). DPS pro Bin:

```
Bin:     [0] [1] [2] [3] [4] [5] ... [19]
Ground:   0   0  0.3 0.8 1.0 1.0 ...   0
Air:      0   0   0  0.2 0.4 0.4 ...   0
```

Frontend: `src/app/ai/core/dps-profile.ts` (sample 20 Punkte, sichtbare
Tower aufaddieren, normalisiert).
Backend: Conv1D-Branch verarbeitet das Profil räumlich (2 Channels × 20 Bins).

### 4. HP-Multiplier statt absolute HP

Das NN wählt `hp_mult` (interpoliert aus `template.hp_mult_range`).
Finale Gegner-HP = `enemy_base_hp × hp_mult` (Frontend liefert Base-HP via
`game_start`-Message als Single Source of Truth).

---

## Modell-Architektur

**Typ:** Actor-Critic-PPO mit Hybrid-Action-Space.

```
Input: 162 Features
├── Scalar Branch [0..115]: 116 Features
│   → Linear(116, 128) + LayerNorm + ReLU → 128 Features
│
├── Spatial Branch [116..155]: 40 Features = 2 Channels × 20 Bins
│   → Conv1d(2→16, k=3, padding=1) + ReLU
│   → Conv1d(16→32, k=3, padding=1) + ReLU
│   → AdaptiveAvgPool1d(1) → 32 Features
│
├── Combined: concat(128, 32) = 160
│   → Linear(160, 192) + LayerNorm + ReLU + Dropout(0.1)
│   → Linear(192, 96)  + LayerNorm + ReLU + Dropout(0.1)
│
└── Output Heads (alle aus 96 Features):
    ├── Template Head: Linear(96, 32)  → Categorical
    ├── Params Head:   Linear(96, 4)   → 4 sigmoid-Faktoren
    ├── log_std:       Parameter(4)    → Exploration-Noise
    └── Value Head:    Linear(96, 1)   → State-Value
```

ONNX-Export-Format: `concat(template_logits, raw_params)` →
**36 Werte** pro Sample (`OUTPUT_SIZE = MAX_TEMPLATE_SLOTS + NUM_CONTINUOUS`).

---

## Reward-Funktion (v4, 4 Terms)

`reward.py::calculate_reward` summiert DEATH + DRAMA + PACING + SWARM_SIZE.

> **v3 wurde ersetzt, weil sie nicht erfüllbar war.** v3 verlangte 1–5 % HP-Verlust
> *pro Wave* und gatete drei ihrer vier Terme auf dieses Band. Der Leak-Schaden
> ist `1 + floor((w-1)/10)` HP bei 100 max HP, also quantisiert: ab Wave 51 sind
> 0 Leaks = 0 % und 1 Leak = 6 %, dazwischen existiert nichts. Die drei gegateten
> Terme lieferten ab W51 strukturell 0. Dazu heilt der Spieler nie und das Spiel
> hat kein Sieg-Ziel — 100 HP sind das Budget des gesamten Runs, 1–5 % pro Wave
> sind also der Tod, den der DEATH-Term mit −15…−30 bestrafte. Gemessenes
> Ergebnis nach 9.800 Episoden: die AI schickte nichts mehr (avgProgress 0,06–0,27
> gegen Zielband 0,65–0,90; ein Client mit 133 Waves ohne einen HP-Verlust).
> Details in `docs/HANDOVER_TRAINING_REFRESH.md`, Abschnitt G.

v4 trennt die zwei Fragen, die v3 vermischt hatte:

* **DRAMA** — „war diese Wave spannend?" — pro Wave, auf `near_miss_ratio`.
* **PACING** — „hat der Run die richtige Länge?" — über den ganzen Run, auf der HP-Kurve.

Alle Terme sind Gauss-Kurven statt Stufen, damit auch eine verfehlte Wave einen
Gradienten trägt. v3s Stufenfunktionen lieferten über ganze Regionen denselben
Wert und sagten der Policy damit nichts.

### Term 1: DEATH (`_death_penalty`)

Relativ zur Ziel-Rundenlänge, nicht absolut. Der Run *soll* enden — ein endloses
Spiel ohne Heilung hat genau einen Ausgang. Planmäßig zu enden ist gratis:

```python
shortfall = max(0.0, (TARGET_RUN_WAVES - wave_num) / TARGET_RUN_WAVES)
penalty   = REWARD_DEATH_MAX * shortfall ** 2      # -40 bei W0, 0 ab W80
```

Die Größenordnung folgt aus einer Bedingung: ein Tod muss die Waves im
Discount-Horizont überwiegen (1/(1−GAMMA) ≈ 10 Waves à ~1,3), sonst wird
„ausbluten lassen und dann kassieren" wieder die beste Strategie — dieser Exploit
war in v3 real.

### Term 2: DRAMA (`_drama_reward`)

Gelesen aus `near_miss_ratio` = Anteil der Gegner, die über 80 % des Pfades kamen.
Das ist aus drei Gründen die richtige Größe: sie beschreibt den *oberen Rand* der
Verteilung statt des Mittelwerts, ihre Schrittweite ist 1/count statt 6 % pro
Leak, und sie ist genau das, was ein Spieler als knappe Sache wahrnimmt.

```python
if avg_progress > 0.95: return -0.80                       # Overflow = Durchbruch
bell  = exp(-((near_miss_ratio - 0.25) / 0.18) ** 2)
score = 1.00 * bell + (-0.30) * (1 - bell)                 # +1.00 im Ziel, -0.30 weit weg
if total_count < 40:                                       # Anteile sind skalenfrei
    if score > 0: score *= sqrt(total_count / 40)          # Strafen NIE dämpfen
```

Die Dämpfung schließt ein Schlupfloch: 1 Durchkommer von 4 trifft das Band so
sauber wie 25 von 100. Eine *Strafe* wird nicht gedämpft, sonst wären Mini-Waves
der billige Ausweg.

### Term 3: PACING (`_pacing_reward`)

HP-Zerfallskurve über den Run statt eines Per-Wave-Bandes:

```python
target = max(0.0, 1.0 - wave_num / TARGET_RUN_WAVES)       # linear 1.0 -> 0.0
err    = hp_after - target
return 0.60 * (exp(-(err / 0.18) ** 2) - 1.0)              # [-0.60, 0]
```

**Eine Strafe, kein Bonus.** Für das Sitzen auf der Kurve zu zahlen bedeutete,
dass Nichtstun positiv punktet, solange der Spieler zufällig auf der Kurve liegt —
der v3-Kollaps durch eine andere Tür. Auf Kurve zu sein ist jetzt lediglich
kostenlos; nur DRAMA zahlt.

Der Term macht Stillstand teuer: ein Client mit 100 % HP auf Wave 92 ist maximal
weit von der Kurve entfernt, also verbessert jeder Schadenspunkt den Score — der
Gradient zeigt auf Angriff, was er unter v3 nie tat.

### Term 4: SWARM_SIZE (`_swarm_size_reward`)

Tiebreaker innerhalb der Drama-Hülle, nie das Ziel. Gate ist jetzt DRAMA selbst,
weil das Damage-Band, für das es stand, nicht mehr existiert:

```python
if total_count <= 20: return -0.10
if drama <= 0:        return 0.0
return min(0.30, 0.0004 * (total_count - 20))
```

**Hard-Constraints** (Verfügbarkeits-Maske, DPS-Ramp, Dauer-Cap, Spawn-Delay-Floor,
Fairness-Gate) sind nicht im Reward, sondern im Decoder (`server.py::_decode_action`)
bzw. in `schema.get_available_template_mask`.

---

## PPO-Training

### Hyperparameter

| Parameter | Wert | Beschreibung |
|---|---|---|
| Learning Rate | 0.0003 | Adam |
| Clip Epsilon | 0.2 | PPO Surrogate Clip |
| Entropy Coef | 0.05 | Exploration-Bonus |
| Value Coef | 0.5 | Value-Loss-Gewicht |
| Batch Size | 16 | Episoden pro Update |
| Update Epochs | 4 | PPO-Epochs pro Batch |
| Gamma | 0.99 | Discount |
| Episode Length | 100 | Max. Wellen pro Episode |
| Checkpoint | alle 10 Ep. | Auto-Save |

### Training-Loop

1. Browser sendet den Game-State-Snapshot; der Server kodiert ihn zu 162 Features und baut die Template-Mask
2. Modell sampled `template_idx` aus maskierter Categorical + 4 sigmoid-Params
3. Die Mask ist innerhalb des Curriculums (W1–W30) auf ein Template verengt
4. Server dekodiert zu Wave-Config (Range-Interpolation, DPS-Caps, Duration-Cap)
5. Browser spielt Wave, sendet Result (`damagePercent`, `avgProgress`,
   `totalCount`, `survived`)
6. `calculate_reward()` berechnet 4-Term-Reward
7. Transition gespeichert: `(state, template_idx, raw_params, log_prob, reward, mask)`
8. Bei `BATCH_SIZE` Transitions: Mask-Aware-PPO-Update über 4 Epochs

### PPO-Update mit Mask

`model.evaluate_action()` akzeptiert die ursprüngliche Template-Mask, damit
geblockte Logits korrekt re-evaluiert werden — sonst bekäme das NN
Ratio-Werte für Templates, die es nie hätte wählen können.

---

## Web-Dashboard (Port 3002)

### Features

- **Header:** Episode, Avg-Reward, Best, Clients, Damage-Sweet %, Game-Over-Rate
- **Reward-Chart:** Raw + Rolling Average (50)
- **Damage-Chart:** Damage-Distribution + Sweet-Zone-Band
- **Near-Miss-Chart:** Path-Progress + Target-Linie
- **Damage-Distribution:** Boring / Sweet / Hard / Game-Over
- **Modell-Metriken:** Policy-Loss, Entropy, Grad-Norm, Batch-Reward
- **DPS-Profile:** Per-Client Ground/Air-Profil (20 Bins)
- **Template-Histogram:** Welche Templates pickt das NN aktuell?
- **Wave-Log + Training-Log**

### API-Endpoints

| Endpoint | Methode | Beschreibung |
|----------|---------|---|
| `/` | GET | Dashboard-HTML |
| `/api/stats` | GET | Aktuelle Trainings-Stats |
| `/api/history` | GET | Reward/Damage/Progress-History |
| `/api/clients` | GET | Verbundene Clients + DPS-Profile |
| `/api/profile/{id}` | GET | DPS-Profil eines Clients |
| `/api/config` | GET | Reward-Schwellwerte (Frontend liest diese dynamisch) |
| `/ws/live` | WebSocket | Real-Time-Event-Stream |

### WebSocket-Events

- `episode` — neuer Reward/Damage/Progress-Datenpunkt
- `wave` — Wave-Ergebnis (Template, Count, Progress, Reward-Breakdown)
- `stats` — Gesamt-Statistiken
- `training_update` — PPO-Metriken (Loss, Entropy, Grad-Norm)

---

## WebSocket-Protokoll (Port 3001)

### Browser → Backend

| Type | Beschreibung |
|------|---|
| `connect` | Initial-Connection |
| `state` | Game-State-Snapshot (wird serverseitig zu 162 Features kodiert) |
| `result` | Wave-Outcome (`damagePercent`, `avgProgress`, `totalCount`, …) |
| `game_start` | Neues Spiel (+ `enemyBaseHp`-Map) |
| `game_over` | Spiel beendet |
| `request_stats` | Stats anfordern |
| `request_export` | Modell-Export anfordern |
| `client_status` | Phase-5.14 1Hz Live-Status (Wave, EnemiesAlive, Phase) |

### Backend → Browser

| Type | Beschreibung |
|------|---|
| `connected` | Connection bestätigt |
| `wave_config` | Generierte Wave-Konfiguration (Enemies + Spawn-Pattern) |
| `stats` | Trainings-Statistiken |
| `reset` | Episode zurücksetzen |
| `select_bot` | Bot-Typ zuweisen (aus `BOT_WEIGHTS`) |
| `model_exported` | ONNX-Export fertig |
| `control` | Server-side Steuerung |

---

## Start & Betrieb

### Quick Start (Windows)

```bash
cd training-backend
start.bat
```

Startet WebSocket :3001 + Dashboard :3002.

### Manuell

```bash
cd training-backend
pip install -r requirements.txt
python server.py
```

`DASHBOARD=0 python server.py` startet ohne Dashboard (CI/Headless).

### Browser-Client verbinden

1. `npm start` (Angular Dev-Server)
2. Im Spiel Training-Client einschalten (Debug-Panel)
3. Auto-Connect zum WebSocket :3001

---

## Logging

### Console (stderr)

Minimal: jede 10. Episode, Game-Overs, PPO-Updates, Checkpoints.

### JSONL-Logfile

Strukturierte Logs in `logs/training_YYYYMMDD_HHMMSS.jsonl`:

| Entry-Type | Felder |
|---|---|
| `wave_state` | `client_id`, `wave`, `towers`, `dps`, `bot_type` |
| `wave_generated` | `template_id`, `count`, `hp_mult`, `spawn_delay_ms`, `enemies` |
| `wave_result` | `wave`, `damage_pct`, `killed`, `avg_progress`, `survived` |
| `training_step` | `episode`, `reward`, `avg_reward`, `breakdown` |
| `model_update` | `policy_loss`, `entropy`, `grad_norm`, `batch_avg_reward` |
| `episode_start` / `episode_end` | `client_id`, `bot_type`, `waves`, `reason` |
| `checkpoint` | `episode`, `path` |

Analyse via `python scripts/analyze_log.py logs/training_*.jsonl`.

---

## Dependencies

```
torch>=2.0.0
numpy>=1.24.0
websockets>=10.0
onnx>=1.14.0
fastapi>=0.100.0
uvicorn>=0.23.0
```

Exakte Versionen siehe `requirements.txt`.

---

## Changelog

Vollständige Entwicklungsgeschichte: [AI_TRAINING_SESSION_NOTES.md](AI_TRAINING_SESSION_NOTES.md).

Kurz-Timeline:
- **v1.0** Damage-basiert
- **v2.0** DPS-Relative HP + Path-Progress
- **v3.0** DPS-Profil + Conv1D + Web-Dashboard
- **v3.1–3.5** Anti-Exploitation, Anti-Kollaps, Reward-Skalierung
- **Phase 5.5** State 74→93, Multi-Group-Decoder, Reward-Restart
  (siehe `PHASE5.5_TRAINING_RUNBOOK.md`)
- **Phase 5.10** Template-basiert, State 156, 4-Term-Reward (Schema v1)
  (siehe `docs/PHASE_5.10_TEMPLATES.md` im Projekt-Root)
- **Phase 5.11 (aktuell)** Range-Based-Templates, 4 Continuous-Params,
  Wave-Duration-Cap, narrower Sweet-Zone
  (siehe `docs/PHASE_5.11_RANGES.md` im Projekt-Root)
- **Phase 5.16** Wave-Curriculum-Override für Waves 1–18
  (siehe `docs/HANDOVER_PLAYTEST_PHASE5.16.md` im Projekt-Root)
