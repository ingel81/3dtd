# AI Wave Director — Übersicht & Historie

> **Aktueller Stand (Phase 5.16):** Range-Based Templates + Designer-Curriculum + Endgame-Difficulty-Knobs.
> Architektur-Details: [PHASE_5.11_RANGES.md](PHASE_5.11_RANGES.md) (Templates/Decoder/Reward)
> + [HANDOVER_PLAYTEST_PHASE5.16.md](HANDOVER_PLAYTEST_PHASE5.16.md) (Curriculum/Economy/Difficulty).
>
> Dieses Dokument fasst die übergreifende AI-Wave-Director-Architektur zusammen und
> verweist auf die phase-spezifischen Dokumente für die Detail-Spezifikation.

## Überblick

Machine-Learning-basierter Wave Director für 3DTD. Generiert adaptive Gegner-Wellen
basierend auf Wave-Curriculum (welcher Template-Charakter) + Spieler-DPS (wie hart).
Ziel: durchgehend "fordernd" — pro Wave 1-5 % HP-Verlust + 65-90 % Path-Progress
(near-miss Zone).

**Stack:** Angular (Browser/Inference) + Python (PPO Training Backend)

**Aktueller Action-/State-Space (Phase 5.11+):**
- State: 156 Features
- Output: 36 (32 Template-Logits + 4 Continuous-Factors über Sigmoid)
- 4 Reward-Terms: DEATH + DRAMA + SWARM_SIZE + PROGRESSION
- Hard Constraints im Decoder (Curriculum-Override, Capability-Gates, Cooldown,
  DPS-Ramp-Caps, Wave-Duration-Cap, Endgame-HP-Multiplier)

---

## System-Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│                     BROWSER (Angular)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐      ┌──────────────────┐                  │
│  │ AIDataCollector  │─────▶│ GameStateEncoder │                  │
│  │ (State Snapshot) │      │ (156 Features)   │                  │
│  └──────────────────┘      └────────┬─────────┘                  │
│                                     │                            │
│  ┌──────────────────┐               │                            │
│  │ DPS Profile      │               │                            │
│  │ (20 Bins along   │               │                            │
│  │  path, G+A)      │               ▼                            │
│  └──────────────────┘      ┌──────────────────┐                  │
│                            │ TrainingClient   │                  │
│  ┌──────────────────┐      │ (WebSocket :3001)│                  │
│  │ Wave-Curriculum  │      │  → Server        │                  │
│  │ (Template-Pin    │      └────────┬─────────┘                  │
│  │  + Gold-Budget)  │               │                            │
│  └──────────────────┘               │                            │
│                                     │                            │
│  ┌──────────────────┐      ┌────────▼─────────┐                  │
│  │ WaveDirectorSvc  │◀─────│  Decoder         │                  │
│  │ (ONNX Inference  │      │  (lerp Range,    │                  │
│  │  in Standalone-  │      │   Curriculum-    │                  │
│  │  Modus)          │      │   Override,      │                  │
│  └────────┬─────────┘      │   DPS-Cap,       │                  │
│           ▼                │   Duration-Cap)  │                  │
│  ┌──────────────────┐      └──────────────────┘                  │
│  │ WaveConfigAdapter│                                            │
│  │ (Decoded → Game) │                                            │
│  └──────────────────┘                                            │
│                                                                  │
│  ┌──────────────────┐                                            │
│  │ Bot System       │                                            │
│  │ (Training-       │                                            │
│  │  Strategist)     │                                            │
│  └──────────────────┘                                            │
└─────────────────────────────────────┬────────────────────────────┘
                                      │ WebSocket
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                  TRAINING BACKEND (Python)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │  server.py   │─────▶│   model.py   │─────▶│  trainer.py  │  │
│  │ (WebSocket,  │      │(Conv1D+Dense)│      │    (PPO)     │  │
│  │  Decoder)    │      │ 156→36       │      │              │  │
│  └──────────────┘      └──────────────┘      └──────────────┘  │
│         │                                                       │
│         │              ┌──────────────┐      ┌──────────────┐   │
│         └─────────────▶│  reward.py   │      │  config.py   │   │
│                        │ (4 Terms)    │      │              │   │
│                        └──────────────┘      └──────────────┘   │
│                                                                 │
│  ┌──────────────┐      ┌──────────────┐                         │
│  │ templates.py │      │wave_curric.py│                         │
│  │ (18 Ranges)  │      │ (30-Wave Seq)│                         │
│  └──────────────┘      └──────────────┘                         │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  dashboard/ (FastAPI :3002, Chart.js, Live WebSocket)    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Kern-Konzepte

### 1. DPS-Profil (Räumliche Verteidigung)

Der Pfad wird in **20 Bins** unterteilt. Pro Bin werden Ground-DPS und Air-DPS getrennt
berechnet.

**Berechnung:** `src/app/ai/core/dps-profile.ts`
- Pfad in 20 gleichmäßig verteilte Punkte samplen
- Pro Punkt: RouteCell → sichtbare Towers → DPS aufsummieren
- Normalisiert auf [0, 1]

**Nutzen:**
- Conv1D-Branch im Model erkennt räumliche Muster (Lücken, Cluster)
- Model lernt wo Verteidigung stark/schwach ist und wählt Range-Faktoren entsprechend
- Air-Profil wird relevant wenn Capability-Gate Air-Templates erlaubt

### 2. Wave-Curriculum + DPS-Ramp (Difficulty)

**Curriculum:** 30 Waves explizit gepinnt (Phase 5.16). Der Decoder ignoriert das
Template-Argmax des NN für Wave 1-30 und nimmt das Curriculum-Template; ab Wave 31
loopt die Sequenz mod-30.

```
Wave 1 → zombie_horde     (unarmored intro)
Wave 7 → bat_swarm        (Air debut – Anti-Air required)
Wave 10 → boss_herbert    (Boss 1)
Wave 13 → ghost_surge     (Ethereal intro – Magic required)
Wave 20 → boss_herbert    (Boss 2)
Wave 30 → boss_herbert    (Boss 3 – season finale)
```

**DPS-Ramp:** Die Continuous-Faktoren in [0,1] des NN werden im Decoder NICHT direkt
über die volle Range gemappt — der obere Endpunkt von `count` und `hp_mult` wird auf
Basis der aktuellen Spieler-DPS gerampt:
- `count_max_eff = range_min + (range_max − range_min) × min(1, totalDPS / 500)`
- `hp_mult_max_eff = range_min + (range_max − range_min) × min(1, totalDPS / 1000)`
- Floor: 10 % der Range bleibt selbst bei 0 DPS erreichbar

Das verhindert "one-shot Wave 1" Pathologien wenn der NN aus altem Checkpoint sigmoid
≈ 0.5 produziert.

### 3. Wave-Duration-Cap

Wenn `count × spawn_delay > 180_000 ms`, komprimiert der Decoder `spawn_delay` auf
`max(5 ms, 180_000 / count)`. Mega-Swarms mit langem Delay werden so automatisch zu
schnell-spawnenden Swarms — der NN wählt Stil, nicht Pathologie.

### 4. Endgame HP Multiplier (Phase 5.16)

Post-Decoder wird `hp_mult` mit `endgameHpMultiplier(wave)` multipliziert:
- W1-19: ×1.0 (kein Effekt)
- W20+: +5 %/Wave, Cap ×4.0 bei W80
- Compoundet auf NN's `hp_mult` — ein Checkpoint der bei W30 ×3 hp_mult lernt liefert
  effektiv ×3 × ×1.5 = ×4.5

### 5. Gold-Budget (Phase 5.16)

Pro Wave deterministisches Gold-Budget (`wave-curriculum.ts`):
- `goldKill` (Summe aller Kill-Credits, geteilt durch waveSize)
- `goldComplete` (Wave-Complete-Bonus + Skill-Bonuses)

Income ist damit unabhängig vom NN's Continuous-Faktoren — nur vom Curriculum.
Das ist die Grundlage für deterministische Tower-/Research-Cost-Balance.

---

## State Vector (156 Features)

| Indizes      | Block                                               |
|--------------|-----------------------------------------------------|
| `[0-52]`     | Base Scalar (player, towers, signals, history)      |
| `[53-105]`   | Phase 5.6 Awareness (types/armor/damage histories)  |
| `[106-115]`  | Gap-5 effective-DPS per armor (5 ground + 5 air)    |
| `[116-135]`  | Ground DPS Profile (20 Bins)                        |
| `[136-155]`  | Air DPS Profile (20 Bins)                           |

Implementation: `src/app/ai/core/game-state-encoder.ts` (Mirror in `server.py::_encode_state`).

---

## Model-Architektur

**Actor-Critic PPO mit Hybrid Action Space**

```
Input: 156 Features
├── Spatial Branch [116-155]: Conv1d(2→16→32, k=3) + AdaptiveAvgPool → 32
├── Scalar  Branch [0-115]:   Linear(116, 128) + LayerNorm + ReLU
├── Combined: concat(128, 32) = 160
│   → Linear(160, 192) + LayerNorm + ReLU + Dropout(0.1)
│   → Linear(192,  96) + LayerNorm + ReLU + Dropout(0.1)
└── Output Heads:
    ├── template_head: Linear(96, 32) → Categorical (18 active slots)
    ├── params_head:   Linear(96, 4)  → Sigmoid → factors in [0,1]
    │                                   for (count, spawn_delay, hp_mult, variation)
    ├── log_std:       Parameter(4)   → exploration noise
    └── value_head:    Linear(96, 1)  → critic baseline
```

Total: **36 Outputs**. Code: `training-backend/model.py` und ONNX-Export
`training-backend/scripts/export_to_tfjs.py`.

---

## Reward-Funktion (4 Terms)

Details + Formeln: [PHASE_5.11_RANGES.md](PHASE_5.11_RANGES.md) (Sweet-Zone-Tuning),
Code: `training-backend/reward.py`.

| Term         | Bereich                | Hot-Notes                                       |
|--------------|------------------------|--------------------------------------------------|
| DEATH        | -3.5 .. 0              | Early-game-Tod schmerzt mehr (lineare Skalierung) |
| DRAMA        | -0.8 .. +0.9 (sweet)   | Damage 1-5 % + Progress 65-90 % = Sweet         |
| SWARM_SIZE   | -0.10 .. +2.0          | Phase 5.14: Slope 0.0015, Cap 2.0 (gegen Exploits)|
| PROGRESSION  | 0 .. +0.5              | Slope 0.02 × wave_num, gated auf Survival+Damage|

**Wichtig:** SWARM_SIZE ist seit Phase 5.14 stark gedämpft + gegated auf
Survival + Damage-Hard-Threshold + Progress-Overflow — verhindert dass das NN
"riesige Swarms die alle durchlaufen" als Reward-Hack lernt.

---

## Frontend-Dateien (`src/app/ai/`)

| Datei                                              | Funktion                                           |
|---------------------------------------------------|----------------------------------------------------|
| `core/dps-profile.ts`                              | DPS-Profil-Berechnung (20 Bins)                    |
| `core/dps-profile-visualizer.ts`                  | 3D-Bin-Visualisierung auf Pfad                     |
| `core/game-state-encoder.ts`                       | 156-Feature Encoding                               |
| `core/ai-data-collector.service.ts`               | State Snapshot + DPS Cache                         |
| `core/wave-director.service.ts`                    | ONNX Inference + Decoder (Curriculum-Override etc.)|
| `core/wave-config-adapter.ts`                      | WaveConfig → Game-Format                           |
| `core/templates.ts`                                | 18 Templates (Mirror von `templates.py`)           |
| `core/wave-curriculum.ts`                          | 30-Wave-Sequenz + Gold-Budget + Difficulty-Knobs   |
| `core/defense-analyzer.ts`                         | Defense-Metriken                                   |
| `core/decision-explainer.ts`                       | Entscheidungs-Erklärungen (UI-Tooltip)             |
| `core/spawn-schedule-builder.ts`                   | Pattern-basiertes Spawn-Schedule                   |
| `core/tower-dps.util.ts`                           | DPS-Berechnung pro Tower-Typ                       |
| `core/models/game-state-snapshot.ts`               | State-Interface                                    |
| `core/models/wave-config.ts`                       | WaveConfig-Interface                               |
| `core/models/wave-result.ts`                       | WaveResult-Interface                               |
| `training/training-client.service.ts`              | WebSocket-Client für Live-Training                 |
| `training/bots/`                                   | Bot-Klassen + Factory (siehe BOT_SYSTEM.md)        |
| `training/strategies/{placement,research,upgrade,wave}/` | Strategien                                  |

`fallback-rules.ts` wurde in Phase 5.10 entfernt — Standalone-Modus erfordert ein
geladenes ONNX-Modell, sonst zeigt das UI eine rote Fehlermeldung.

---

## Backend-Dateien (`training-backend/`)

| Datei                       | Funktion                                                      |
|----------------------------|---------------------------------------------------------------|
| `server.py`                 | WebSocket-Server, State-Encoder, Decoder (`_decode_action`)   |
| `model.py`                  | PyTorch Conv1D+Dense Modell (Phase 5.11 Range-Based)          |
| `trainer.py`                | PPO + Running-Mean/Std-Reward-Normalisierung                  |
| `reward.py`                 | 4-Term-Reward (DEATH, DRAMA, SWARM_SIZE, PROGRESSION)         |
| `config.py`                 | Hyperparameter, Reward-Schwellen, DPS-Ramp-Caps               |
| `templates.py`              | 18 Templates mit Ranges + Mask-Helper                         |
| `wave_curriculum.py`        | 30-Wave Sequenz (Mirror von `wave-curriculum.ts`)             |
| `tui_logger.py`             | Konsolen + JSONL-Log                                          |
| `auto_logger.py`            | Auto-Snapshot des Konfigs in JSONL                            |
| `manage_server.py`          | Start/Stop/Restart-CLI                                        |
| `inspect_training.py`       | Dashboard-CLI (Template-Usage, Reward-Breakdown)              |
| `dashboard/app.py`          | FastAPI Dashboard (Port 3002)                                 |
| `dashboard/static/*`        | Chart.js Frontend                                             |
| `scripts/export_to_tfjs.py` | ONNX-Export (Phase-5.11 Schema)                               |
| `scripts/analyze_log.py`    | Log-Analyse                                                   |
| `tests/test_templates.py`   | Template-Integrität                                           |
| `tests/test_reward_v2.py`   | Reward-Function Sanity Tests                                  |

Detail-Doku: [AI_TRAINING_BACKEND.md](../training-backend/docs/AI_TRAINING_BACKEND.md).

---

## Training-Workflow

1. Backend starten: `cd training-backend && python manage_server.py start` (oder `start.bat`)
2. Frontend starten: `npm start`
3. Mehrere Browser-Tabs öffnen (4-8 für parallele Episodes)
4. `curl -X POST http://localhost:3002/api/control/start`
5. Dashboard: `http://localhost:3002`
6. Checkpoints alle 10 Episoden in `training-backend/checkpoints/`
7. ONNX-Export: `npm run export-ai`

Training Notes + Erkenntnisse: [PHASE5.5_TRAINING_RUNBOOK.md](../training-backend/PHASE5.5_TRAINING_RUNBOOK.md)
+ [AI_TRAINING_SESSION_NOTES.md](../training-backend/docs/AI_TRAINING_SESSION_NOTES.md).

---

## Verwandte Dokumentation

| Dokument                                                 | Inhalt                                                         |
|----------------------------------------------------------|----------------------------------------------------------------|
| [PHASE_5.11_RANGES.md](PHASE_5.11_RANGES.md)             | **Aktive Architektur:** Range-Templates, Decoder, Reward-Tuning|
| [HANDOVER_PLAYTEST_PHASE5.16.md](HANDOVER_PLAYTEST_PHASE5.16.md) | Phase 5.16 Balance-Pass: Curriculum, Endgame-Knobs, Gold-Budget|
| [PHASE_5.10_TEMPLATES.md](PHASE_5.10_TEMPLATES.md)       | Historisch: Übergang von 16-Softmax zu Templates               |
| [BOT_SYSTEM.md](BOT_SYSTEM.md)                           | Strategy-Pattern Bot-Architektur                               |
| [AI_TRAINING_BACKEND.md](../training-backend/docs/AI_TRAINING_BACKEND.md) | Detaillierte Backend-Doku                          |
| [AI_TRAINING_SESSION_NOTES.md](../training-backend/docs/AI_TRAINING_SESSION_NOTES.md) | Entwicklungsgeschichte (v1→v2→v3 → Phase 5.x)|
| [AI_MODEL_EXPORT.md](../training-backend/docs/AI_MODEL_EXPORT.md) | ONNX Export Workflow                                   |

---

**Last Updated:** 2026-05-08 (Phase 5.16 — Curriculum + Endgame-Knobs)
