# AI Wave Director

## Ueberblick

Machine-Learning-basierter Wave Director fuer 3DTD. Generiert adaptive Gegner-Wellen basierend auf der raeumlichen Verteidigung des Spielers. Ziel: avg raw progress ~55% (Haelfte der Enemies stirbt in der Defense, Haelfte kommt durch).

**Stack:** Angular (Browser) + Python (Training Backend)

---

## System-Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│                     BROWSER (Angular)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐      ┌──────────────────┐                 │
│  │ AIDataCollector   │─────▶│ GameStateEncoder │                 │
│  │ (State Snapshot)  │      │ (74 Features)    │                 │
│  └──────────────────┘      └────────┬─────────┘                 │
│                                     │                            │
│  ┌──────────────────┐               │                            │
│  │ DPS Profile      │               │                            │
│  │ (20 Bins along   │               │                            │
│  │  path, G+A)      │               ▼                            │
│  └──────────────────┘      ┌──────────────────┐                 │
│                             │ TrainingClient   │                 │
│  ┌──────────────────┐      │ (WebSocket :3001)│                 │
│  │ WaveConfigAdapter │◀─────│                  │                 │
│  │ (Config → Game)   │      └────────┬─────────┘                 │
│  └──────────────────┘               │                            │
│                                     │ WebSocket                  │
│  ┌──────────────────┐               │                            │
│  │ Bot System        │               │                            │
│  │ (Tower Placement) │               │                            │
│  └──────────────────┘               │                            │
│                                     │                            │
└─────────────────────────────────────┼────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                  TRAINING BACKEND (Python)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │  server.py   │─────▶│   model.py   │─────▶│  trainer.py  │  │
│  │ (WebSocket)  │      │(Conv1D+Dense)│      │    (PPO)     │  │
│  └──────────────┘      └──────────────┘      └──────────────┘  │
│         │                                                       │
│         │              ┌──────────────┐      ┌──────────────┐   │
│         └─────────────▶│  reward.py   │      │  config.py   │   │
│                        │(DPS-Gaussian)│      │  (Settings)  │   │
│                        └──────────────┘      └──────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  dashboard/ (FastAPI :3002, Chart.js, Live WebSocket)    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Kern-Konzepte

### 1. DPS-Profil (Raeumliche Verteidigung)

Der Pfad wird in **20 Bins** unterteilt. Pro Bin wird die DPS berechnet (Ground + Air getrennt).

```
Bin:    [0] [1] [2] [3] [4] [5] [6] [7] [8] [9] ... [19]
Ground:  0   0  0.3 0.8 1.0 1.0 0.5  0   0   0  ...   0
Air:     0   0   0  0.2 0.4 0.4  0   0   0   0  ...   0
```

**Berechnung:** `src/app/ai/core/dps-profile.ts`
- Pfad in 20 gleichmaessig verteilte Punkte samplen
- Pro Punkt: RouteCell → sichtbare Towers → DPS aufsummieren
- Normalisiert auf [0, 1] (MAX_DPS_PER_BIN = 500)

**Nutzen:**
- Conv1D-Branch im Model erkennt raeumliche Muster (Luecken, Cluster)
- Model lernt wo Verteidigung stark/schwach ist und waehlt Enemies entsprechend
- Air-Enemies nutzen Air-Profil, Ground-Enemies das Ground-Profil

### 2. DPS-Relative HP (Kill-Time)

Das Model waehlt `kill_time` (0.5-4.0s) statt absoluter HP:

```
enemy_hp = effective_dps * kill_time
healthMultiplier = enemy_hp / base_hp_of_type
```

- Automatische Skalierung mit Spieler-DPS
- Fuer Air-Enemies: `air_dps` statt `ground_dps`
- Alle Enemy-Typen inkl. Herbert nutzen DPS-relative HP (keine Spezialfaelle)

### 3. Raw Progress (Reward-Signal)

Reward basiert auf **raw path progress** (physische Distanz 0-1). Das DPS-Profil dient nur als Model-Input (Conv1D erkennt raeumliche Muster), nicht fuer Reward-Normalisierung.

Bei konzentrierter Verteidigung (Towers in 15-25% des Pfades): avg raw progress ~0.55 bedeutet die Haelfte der Enemies stirbt in der Defense-Zone, die andere Haelfte kommt durch. Das ist der Sweet Spot.

---

## State Vector (74 Features)

```
[0-3]   Player: credits, lives%, wave, time (4)
[4]     towerCount (1)
[5]     avgTowerLevel (1)
[6-11]  Tower Type Counts: 6 Typen, normalisiert (6)
[12-16] History Damage: letzte 5 Waves (5)
[17-21] History Progress: letzte 5 Waves avg_progress (5)
[22-26] Wave Signals: momentum, avgDmg, duration, episodeProgress, variance (5)
[27-31] Context: wave, trend, skill, lastThreat, winStreak (5)
[32-33] Reserved/Padding (2)
[34-53] Ground DPS Profile: 20 Bins (20)
[54-73] Air DPS Profile: 20 Bins (20)
```

---

## Model-Architektur

**Actor-Critic PPO mit Hybrid Action Space**

```
Input: 74 Features
├── Scalar Branch [0-33]: Linear(34, 64) + LayerNorm + ReLU
├── Spatial Branch [34-73]: Conv1d(2→16→32, k=3) + AdaptiveAvgPool → 32
├── Combined: concat(64, 32) = 96
│   → Linear(96, 128) + LayerNorm + ReLU + Dropout(0.1)
│   → Linear(128, 64) + LayerNorm + ReLU + Dropout(0.1)
└── Output Heads:
    ├── Enemy: Linear(64, 5) → Categorical(zombie, bat, tank, wallsmasher, herbert)
    ├── Params: Linear(64, 4) → Gaussian(kill_time, count, delay, variation)
    ├── Log-Std: Parameter(4) → Exploration noise
    └── Value: Linear(64, 1) → State value estimate
```

---

## Reward-Funktion

**Ziel:** Sweet Spot bei ~55% raw path progress (Gaussian Peak). Haelfte der Enemies stirbt in der Defense-Zone, Haelfte kommt durch.

```python
reward = exp(-((progress - 0.55)^2) / (2 * 0.15^2))
if avg_progress < 0.20:
    reward = -0.30  # Langweilig (flat penalty)
if avg_progress > 0.85:
    reward = -0.30  # Zu viele kommen durch
```

**Wichtig:** Reward nutzt **raw path progress** (physische Distanz), NICHT DPS-normalized progress. DPS-Profil ist nur Model-Input.

| avg_progress | Reward | Beschreibung |
|-------------|--------|--------------|
| < 20% | -0.30 | Langweilig |
| 20-40% | 0.2 - 0.6 | Moderat |
| 45-65% | 0.85 - 1.0 | Sweet Spot |
| > 85% | **-0.30** | Zu gefaehrlich |
| Game Over | -0.5*(20/wave) | Proportional zur Frueheit |

**Bonus-Signale** (nur wenn avg_progress < 0.85):

| Signal | Bedingung | Bonus |
|--------|-----------|-------|
| Near-Miss | >50% Enemies bei 80%+, survived, progress<85% | +0.15 |
| Max Progress | 1 Enemy bei 90%+, survived, progress<85% | +0.10 |
| Spread | Progress-StdDev > 0.05 | +0.05 |
| Variety | Neuer Enemy-Typ in letzten 5 Waves | +0.15 |

---

## Frontend-Dateien

| Datei | Funktion |
|-------|----------|
| `src/app/ai/core/dps-profile.ts` | DPS-Profil Berechnung (20 Bins) |
| `src/app/ai/core/dps-profile-visualizer.ts` | 3D Bin-Visualisierung auf Pfad |
| `src/app/ai/core/game-state-encoder.ts` | 74-Feature Encoding |
| `src/app/ai/core/ai-data-collector.service.ts` | State Snapshot + DPS Cache |
| `src/app/ai/core/wave-director.service.ts` | Inference + Fallback Rules |
| `src/app/ai/core/wave-config-adapter.ts` | Backend-Config → Game WaveConfig |
| `src/app/ai/core/defense-analyzer.ts` | Defense-Metriken berechnen |
| `src/app/ai/core/fallback-rules.ts` | Fallback wenn kein Backend |
| `src/app/ai/core/models/game-state-snapshot.ts` | State Interface |
| `src/app/ai/core/models/wave-config.ts` | Wave Config Interface |
| `src/app/ai/core/models/wave-result.ts` | Wave Result Interface |
| `src/app/ai/training/training-client.service.ts` | WebSocket Client |

---

## Backend-Dateien

| Datei | Funktion |
|-------|----------|
| `training-backend/server.py` | WebSocket Server, State Encoding, Action Decoding |
| `training-backend/model.py` | Conv1D + Dense Neural Network |
| `training-backend/trainer.py` | PPO Training Algorithm |
| `training-backend/reward.py` | Reward Function (DPS-Gaussian) |
| `training-backend/config.py` | Hyperparameter & Settings |
| `training-backend/tui_logger.py` | Console + JSONL Logging |
| `training-backend/dashboard/` | FastAPI Web Dashboard (Port 3002) |

---

## Training Workflow

1. Backend starten: `cd training-backend && start.bat`
2. Frontend starten: `npm start` (Angular Dev-Server)
3. Im Spiel: Training-Debugger aktivieren
4. Bot platziert Towers, AI generiert Waves
5. Dashboard ueberwachen: `http://localhost:3002`
6. Checkpoints werden alle 10 Episoden gespeichert

---

## WebSocket-Protokoll (Port 3001)

### Browser → Backend

| Type | Beschreibung |
|------|-------------|
| `connect` | Initial Connection |
| `state` | Game State (74 Features + DPS-Profil) |
| `result` | Wave Outcome (Progress, Kills, etc.) |
| `game_start` | Neues Spiel (+ enemyBaseHp) |
| `game_over` | Spiel beendet (won/lost) |

### Backend → Browser

| Type | Beschreibung |
|------|-------------|
| `connected` | Connection bestaetigt |
| `wave_config` | Generierte Wave-Konfiguration |
| `stats` | Training-Statistiken |
| `reset` | Episode zuruecksetzen |
| `select_bot` | Bot-Typ zuweisen |

---

## Hyperparameter

| Parameter | Wert |
|-----------|------|
| Learning Rate | 0.0003 |
| Clip Epsilon | 0.2 |
| Entropy Coef | 0.04 |
| Value Coef | 0.5 |
| Batch Size | 16 |
| Update Epochs | 4 |
| Gamma | 0.99 |
| Grad Clip | 0.5 |
| Episode Length | 20 Waves |
| Checkpoint | alle 10 Ep. |
| Progress Center | 0.55 (raw path progress) |
| Progress Sigma | 0.15 |
| Kill-Time Range | 1.0 - 4.0s |
| Spawn Delay | 500 - 2000ms |
| Enemy Base Damage | 1 (pro Enemy am HQ) |
| Game-Over-Penalty | -0.5 * (20/wave) |
| Boring-Penalty | -0.30 flat (progress < 0.20) |
| Overflow-Penalty | -0.30 (progress > 0.85) |
| Min Enemy Count | max(5, towers+1) |

---

## Verwandte Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [AI_TRAINING_BACKEND.md](../training-backend/docs/AI_TRAINING_BACKEND.md) | Detaillierte Backend-Doku |
| [BOT_SYSTEM.md](../src/app/docs/BOT_SYSTEM.md) | Strategy Bot Architektur |
| [AI_TRAINING_SESSION_NOTES.md](../training-backend/docs/AI_TRAINING_SESSION_NOTES.md) | Entwicklungsgeschichte |

---

**Last Updated:** 2026-01-25
