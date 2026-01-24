# AI Training Backend

## Ueberblick

Python-basiertes Training-System fuer den AI Wave Director. Besteht aus WebSocket-Server (Port 3001), PPO-Trainer, und Web-Dashboard (Port 3002) fuer Live-Monitoring.

**Stack:**
- Python 3.8+ / PyTorch 2.0+
- WebSocket Server (websockets)
- FastAPI + Chart.js Web-Dashboard
- ONNX (Model Export)

**Location:** `training-backend/`

---

## Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRAINING BACKEND (Python)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │   server.py  │─────▶│   model.py   │─────▶│  trainer.py  │  │
│  │  (WebSocket) │      │ (Conv1D+Dense)│      │    (PPO)     │  │
│  └──────┬───────┘      └──────────────┘      └──────────────┘  │
│         │                                                        │
│         │              ┌──────────────┐      ┌──────────────┐  │
│         └─────────────▶│  reward.py   │      │  config.py   │  │
│                        │(DPS-Gaussian)│      │  (Settings)  │  │
│                        └──────────────┘      └──────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  dashboard/                                               │  │
│  │  ├── app.py          (FastAPI, WebSocket broadcast)       │  │
│  │  └── static/         (Chart.js, real-time UI)             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────┐      ┌──────────────┐                        │
│  │ tui_logger.py│      │auto_logger.py│                        │
│  │(Console+JSONL)│◀────│(Logger Shim) │                        │
│  └──────────────┘      └──────────────┘                        │
│                                                                 │
└────────────────────────────────────┬────────────────────────────┘
        WebSocket :3001              │  HTTP :3002
              │                      │
              ▼                      ▼
┌─────────────────────────┐  ┌────────────────────┐
│  BROWSER (Angular)      │  │  WEB DASHBOARD     │
│  Game + Strategy Bot    │  │  (localhost:3002)   │
│  + Training Client      │  │  Charts, Metrics   │
└─────────────────────────┘  └────────────────────┘
```

---

## Datei-Struktur

```
training-backend/
├── server.py              # WebSocket Server & Hauptlogik
├── model.py               # Conv1D + Dense Neural Network
├── trainer.py             # PPO Training Algorithm
├── reward.py              # Reward Function (DPS-normalized Gaussian)
├── config.py              # Hyperparameter & Konfiguration
│
├── tui_logger.py          # Console Logger + JSONL File Logging
├── auto_logger.py         # Logger-Shim (importiert tui_logger)
│
├── dashboard/
│   ├── app.py             # FastAPI Dashboard Server
│   ├── __init__.py
│   └── static/
│       ├── index.html     # Dashboard UI (3-Column Grid)
│       ├── app.js         # Chart.js + WebSocket Live-Updates
│       └── style.css      # Multi-Color Dark Theme
│
├── requirements.txt       # Python Dependencies
├── start.bat              # Windows Start-Script
├── checkpoints/           # Model Checkpoints (checkpoint_*.pt)
└── logs/                  # JSONL Training Logs
```

---

## Kern-Konzepte

### 1. DPS-Profil (Raeumliche Verteidigung)

Statt die Verteidigung auf einen einzigen Wert (totalDPS) zu reduzieren, wird der Pfad in **20 Bins** unterteilt und die DPS pro Bin berechnet (Ground + Air getrennt).

```
Bin:    [0] [1] [2] [3] [4] [5] [6] [7] [8] [9] ... [19]
Ground:  0   0  0.3 0.8 1.0 1.0 0.5  0   0   0  ...   0
Air:     0   0   0  0.2 0.4 0.4  0   0   0   0  ...   0
```

**Berechnung (Frontend):** `src/app/ai/core/dps-profile.ts`
- Pfad in 20 gleichmaessig verteilte Punkte samplen
- Pro Punkt: RouteCell → sichtbare Towers → DPS aufsummieren
- Normalisiert auf [0, 1] (MAX_DPS_PER_BIN = 500)

**Nutzung (Backend):**
- Conv1D-Branch im Model verarbeitet das Profil raeumlich
- `compute_effective_progress()` normalisiert den Path-Progress relativ zur DPS-Verteilung

### 2. DPS-Relative HP (Kill-Time)

Das Model waehlt `kill_time` (0.5-4.0s) statt absoluter HP:

```
enemy_hp = effective_dps * kill_time
healthMultiplier = enemy_hp / base_hp_of_type
```

- Automatische Skalierung mit Spieler-DPS
- Fuer Air-Enemies (Bat): `air_dps` statt `ground_dps`

### 4. Action Decoding (Wave-Config Erzeugung)

Die Model-Outputs werden wie folgt in Wave-Parameter umgewandelt:

| Parameter | Model-Output | Umrechnung | Bereich |
|-----------|-------------|------------|---------|
| kill_time | sigmoid → [0,1] | 0.5 + x * 3.5 | 0.5 - 4.0s |
| count | sigmoid → [0,1] | min_count + x * (max - min) | 5 - 30 |
| delay | sigmoid → [0,1] | 150 + x * 450 | 150 - 600ms |
| variation | sigmoid → [0,0.3] | Spawn-Delay-Variation | 0 - 30% |

**Count-Berechnung:**
```python
min_count = max(5, tower_count + 1)  # Mindestens Towers+1 Enemies
max_count = min(30, tower_count * 5)
zone_time = max(8.0, defense_reach * 40.0)  # Min 8s Durchlaufzeit
kill_capacity = max(8, int((zone_time / kill_time) * tower_count * 1.5))
effective_max = min(max_count, kill_capacity)
total_count = min_count + count_factor * (effective_max - min_count)
```

**Enemy-Typ Restriktion:**
- Wave 0-1: Nur Zombie
- Wave 2-3: Zombie oder Tank
- Wave 4+: Alle Typen erlaubt

### 3. Effective Progress (DPS-Normalisierung)

```python
def compute_effective_progress(raw_progress, dps_profile):
    bins_traversed = int(raw_progress * 20)
    dps_traversed = sum(dps_profile[:bins_traversed])
    return dps_traversed / sum(dps_profile)
```

**Beispiel:** Enemy bei 75% Pfad-Progress. Erste 50% stark verteidigt, zweite 50% leer.
- raw_progress = 0.75
- dps_traversed = 100% (alle Towers passiert)
- effective_progress = 1.0 (hat gesamte Verteidigung durchlaufen)

---

## Model-Architektur

**Typ:** Actor-Critic PPO mit Hybrid Action Space

```
Input: 74 Features
├── Scalar Branch [0-33]: 34 Features
│   ├── Player: credits, lives%, wave, time (4)
│   ├── Defense: towerCount, avgLevel (2)
│   ├── Tower Types: 6 Typen normalisiert (6)
│   ├── History Damage: letzte 5 Waves (5)
│   ├── History Progress: letzte 5 Waves (5)
│   ├── Wave Signals: momentum, avgDmg, duration, episodeProgress, variance (5)
│   ├── Context: wave, trend, skill, lastThreat, winStreak (5)
│   └── Reserved (2)
│
│   → Linear(34, 64) + LayerNorm + ReLU → 64 Features
│
├── Spatial Branch [34-73]: 40 Features = 2 Channels x 20 Bins
│   ├── Ground DPS Profile: 20 Bins (normalized 0-1)
│   └── Air DPS Profile: 20 Bins (normalized 0-1)
│
│   → Conv1d(2→16, k=3) + ReLU
│   → Conv1d(16→32, k=3) + ReLU
│   → AdaptiveAvgPool1d(1) → 32 Features
│
├── Combined: concat(64, 32) = 96
│   → Linear(96, 128) + LayerNorm + ReLU + Dropout(0.1)
│   → Linear(128, 64) + LayerNorm + ReLU + Dropout(0.1)
│
└── Output Heads:
    ├── Enemy Head: Linear(64, 5) → Categorical(zombie, bat, tank, wallsmasher, herbert)
    ├── Params Head: Linear(64, 4) → Gaussian(kill_time, count, delay, variation)
    ├── Log-Std: Parameter(4) → Exploration noise
    └── Value Head: Linear(64, 1) → State value estimate
```

---

## Reward-Funktion

**Ziel:** Wellen generieren bei denen Enemies 85-95% des verteidigten Pfades erreichen (Sweet Spot).

### Gaussian Peak bei 90% Progress

```python
reward = exp(-((progress - 0.90)^2) / (2 * 0.08^2))

# Hard cutoff: Base erreicht = negativ
if avg_progress > 0.95:
    reward = -0.30
```

| avg_progress | Reward | Beschreibung |
|-------------|--------|--------------|
| < 20% | -0.30 | Langweilig (Enemies sterben sofort) |
| 20-70% | 0 - 0.5 | Moderat |
| 85-95% | 0.95 - 1.0 | **Sweet Spot** |
| > 95% | **-0.30** | Ueberfordernd (Base erreicht) |

### Game-Over-Penalty (proportional)

Fruehe Game-Overs werden staerker bestraft als spaete:

```python
penalty = -0.5 * (EPISODE_LENGTH / wave_number)  # Cap: -5.0
```

| Wave | Penalty | Erklaerung |
|------|---------|------------|
| 3 | -3.33 | Sehr fruehe Niederlage |
| 5 | -2.00 | Fruehe Niederlage |
| 10 | -1.00 | Mittlere Niederlage |
| 20 | -0.50 | Spaete Niederlage |

### Bonus-Signale (nur wenn avg_progress < 0.95)

| Komponente | Bedingung | Bonus |
|-----------|-----------|-------|
| Near-Miss | >50% Enemies bei 80%+ Progress, player survived, progress < 95% | +0.15 |
| Max Progress | Mind. 1 Enemy bei 90%+, player survived, progress < 95% | +0.10 |
| Spread | Progress-StdDev > 0.05 | +0.05 |
| Variety | Neuer Enemy-Typ in letzten 5 Waves | +0.15 |

**Wichtig:** Near-Miss und Max-Progress Bonuses werden NICHT vergeben wenn Enemies die Base erreichen (progress >= 0.95). Dies verhindert Reward-Exploitation durch unkillbare Enemies.

---

## PPO Training

### Hyperparameter

| Parameter | Wert | Beschreibung |
|-----------|------|--------------|
| Learning Rate | 0.0003 | Adam Optimizer |
| Clip Epsilon | 0.2 | PPO Surrogate Clip |
| Entropy Coef | 0.005 | Exploration Bonus |
| Value Coef | 0.5 | Value Loss Weight |
| Batch Size | 16 | Episodes pro Update |
| Update Epochs | 4 | PPO Epochs pro Batch |
| Gamma | 0.99 | Discount Factor |
| Grad Clip | 0.5 | Max Gradient Norm |
| Episode Length | 20 | Waves pro Episode |
| Checkpoint | alle 10 Ep. | Auto-Save |

### Training-Loop

1. Browser sendet Game State (74 Features inkl. DPS-Profil)
2. Model generiert Action (Enemy-Typ + Params)
3. Server dekodiert zu Wave-Config (DPS-relative HP)
4. Browser spielt Wave, sendet Ergebnis
5. `compute_effective_progress()` normalisiert Progress
6. `calculate_reward()` berechnet Reward
7. Transition gespeichert: (state, action, log_prob, reward)
8. Bei BATCH_SIZE Transitions: PPO Update (4 Epochs)

---

## Web Dashboard (Port 3002)

### Features

- **Header:** Episode, Avg Reward, Best, Clients, Sweet Spot %, Game Over Rate
- **Reward Chart:** Raw + Rolling Average (50) Trendlinie
- **Progress Chart:** Avg Progress + Sweet Zone Band + Trend (30)
- **Near-Miss Chart:** Ratio + Target-Linie + Trend (30)
- **Distribution:** Progress-Verteilung (Boring/Low/Moderate/Sweet/Danger)
- **Model Metrics:** Policy Loss, Entropy, Grad Norm, Batch Reward
- **DPS Profiles:** Per-Client Ground/Air DPS-Profil (20 Bins)
- **Wave Log:** Letzte Waves mit Typ, Progress, Reward
- **Training Log:** PPO Updates mit Timestamps

### API Endpoints

| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/` | GET | Dashboard HTML |
| `/api/stats` | GET | Aktuelle Training-Stats |
| `/api/history` | GET | Reward/Progress/NearMiss History |
| `/api/clients` | GET | Verbundene Clients + DPS-Profile |
| `/api/profile/{id}` | GET | DPS-Profil eines Clients |
| `/ws/live` | WebSocket | Real-Time Event Stream |

### WebSocket Events

- `episode`: Neues Reward/Progress/NearMiss Datenpunkt
- `wave`: Wave-Ergebnis (Typ, Count, Progress, Reward)
- `stats`: Aktuelle Gesamt-Statistiken
- `training_update`: PPO Metriken (Loss, Entropy, Grad)

---

## WebSocket-Protokoll (Port 3001)

### Browser → Backend

| Type | Beschreibung |
|------|-------------|
| `connect` | Initial Connection |
| `state` | Game State Snapshot (74 Features) |
| `result` | Wave Outcome (Progress, Kills, etc.) |
| `game_start` | Neues Spiel (+ enemyBaseHp) |
| `game_over` | Spiel beendet (won/lost) |
| `request_stats` | Stats anfordern |
| `request_export` | Model exportieren |

### Backend → Browser

| Type | Beschreibung |
|------|-------------|
| `connected` | Connection bestaetigt |
| `wave_config` | Generierte Wave-Konfiguration |
| `stats` | Training-Statistiken |
| `reset` | Episode zuruecksetzen |
| `select_bot` | Bot-Typ zuweisen |

---

## Start & Betrieb

### Quick Start (Windows)

```bash
cd training-backend
start.bat
```

Startet: WebSocket :3001 + Dashboard :3002

### Manuell

```bash
cd training-backend
pip install -r requirements.txt
python server.py
```

### Dashboard oeffnen

```
http://localhost:3002
```

### Browser-Client verbinden

1. `npm start` (Angular Dev-Server)
2. Im Spiel: Training-Debugger oeffnen
3. Auto-Connect zum WebSocket :3001

---

## Logging

### Console (stderr)

Minimale Ausgabe: Jedes 10. Episode, Game Overs, PPO Updates, Checkpoints.

### JSONL Logfile

Alle Events strukturiert in `logs/training_YYYYMMDD_HHMMSS.jsonl`:

| Entry Type | Felder |
|-----------|--------|
| `wave_state` | client_id, wave, towers, dps, bot_type |
| `wave_generated` | enemy_type, count, enemy_hp, kill_time |
| `wave_result` | wave, damage_pct, killed, avg_progress, near_miss |
| `training_step` | episode, reward, avg_reward, breakdown |
| `model_update` | policy_loss, entropy, grad_norm, batch_avg_reward |
| `episode_start` | client_id, bot_type |
| `episode_end` | client_id, waves, avg_progress, reason |
| `checkpoint` | episode, path |

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

---

## Changelog

### Version 3.1 (2026-01-24) - Anti-Exploitation Fixes

- kill_time Range: [0.5, 8.0] → [0.5, 4.0]s (verhindert unkillbare Enemies)
- Hard Penalty: progress > 0.95 → reward = -0.30 (Base erreicht = negativ)
- Game-Over-Penalty proportional: -0.5 * (20/wave), cap -5.0
- Near-Miss/Max-Progress Bonus nur bei progress < 0.95
- Count-Minimum: max(5, tower_count+1) statt 3
- Kill-Capacity zone_time Minimum: 8s statt 2s

### Version 3.0 (2026-01-24) - DPS-Profil + Web Dashboard

- DPS-Profil (20 Bins) ersetzt totalDPS/pathCoverage
- Conv1D + Dense Modell-Architektur (74 Features)
- `compute_effective_progress()` mit DPS-Normalisierung
- Reward: Gaussian Peak bei 90% (statt 65%), Sigma 0.08
- Near-Miss, Max-Progress, Spread Bonus-Signale
- Web Dashboard (FastAPI + Chart.js) ersetzt TUI
- Dashboard: 4 Charts mit Trendlinien, Distribution, Model Metrics
- Per-Client DPS-Profile im Dashboard
- TUI vereinfacht zu Console + JSONL Logger
- `rich` und `tqdm` Dependencies entfernt
- Trainer piped Training-Updates an Dashboard

### Version 2.0 (2026-01-24) - DPS-Relative HP + Path-Progress

- Reward: Path-Progress Gaussian (Peak bei 65%)
- DPS-relative HP: `enemy_hp = effective_dps * kill_time`
- Model: 4 continuous params (kill_time, count, delay, variation)
- Anti-Air DPS fuer Bats
- Frontend sendet enemyBaseHp (Single Source of Truth)

### Version 1.0 (2026-01-23) - Initial

- WebSocket Server + PPO Training
- 52-Feature State Vector
- Professional TUI (rich)
- Checkpoint System + Bot Rotation

---

**Last Updated:** 2026-01-24
