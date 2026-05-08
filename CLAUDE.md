# CLAUDE.md - 3DTD

## Projekt

3DTD - Standalone Tower Defense auf Google Maps 3D Tiles

## Befehle

```bash
npm start       # Development Server (http://localhost:4200)
npm run build   # Production Build
```

## Architektur

- Angular 21 Standalone Components (nur UI)
- Three.js + 3DTilesRendererJS fuer 3D-Rendering
- **Event-driven Game Engine** - Manager kommunizieren via GameEventBus
- **Signal Store** - 5 Sub-Stores als Single Source of Truth (Game, UI, Engine, Location, Research)
- Kein Backend im Spiel-Client - komplett clientseitig (Python-Backend nur fuer AI-Training)
- Google Maps API Key in environment.ts

## Projektstruktur

```
src/app/
├── app.ts                      # Root Component (AppComponent)
├── app.config.ts               # Provider Config
├── app.routes.ts               # Routing
├── tower-defense.component.ts  # Haupt-Spielkomponente
├── ai/                         # AI System (Browser)
│   ├── training/               # Bot System (Strategy Pattern)
│   │   ├── bots/               # StrategyBot, Factory
│   │   └── strategies/         # Placement, Upgrade, Wave, Research Strategies
│   ├── wave-director/          # Onnx-basierter Wave-Director (Inference)
│   └── core/                   # Game State Capture, Data Collection
├── game-engine/                # Event Bus, VFX/Audio/BackgroundMusic Services (framework-agnostic)
├── components/                 # UI Components (compass, game-header, game-sidebar, etc.)
├── configs/                    # Tower/Enemy/Projectile/Combat/Research/Audio Configs
├── core/                       # Config Service
├── devworld/                   # DevWorld Offline-Entwicklungsumgebung
├── entities/                   # Enemy, Tower, Projectile
├── game-components/            # ECS Components (transform, health, movement, combat, etc.)
├── managers/                   # Manager (Enemy, Tower, Wave, Research, etc. - event-driven)
├── models/                     # Type Definitions
├── services/                   # Angular Services (Facades, UI-Bindings)
├── store/                      # Signal Stores (Game, UI, Engine, Location, Research)
├── styles/                     # Theme & Global Styles
├── workers/                    # Web Workers (Pathfinding)
└── three-engine/               # 3D Rendering (renderers/, post-processing/, shaders)

training-backend/               # Python Training Backend
├── server.py                   # WebSocket Server (:3001)
├── model.py                    # Neural Network (Conv1D + Dense, State 156 → 36 Outputs)
├── trainer.py                  # PPO Training Algorithm
├── reward.py                   # Reward Function (4 Terms: DPS-sweet, leak, swarm, idle)
├── templates.py                # Wave Template Definitions + Constraints
├── wave_curriculum.py          # Wave-Curriculum Mask (Phase 5.16)
├── config.py                   # Hyperparameter
├── dashboard/                  # Web Dashboard (:3002)
│   ├── app.py                  # FastAPI Server
│   └── static/                 # Chart.js UI
├── scripts/                    # Export, Inspect, Manage
├── start.bat                   # Windows Start-Script
├── checkpoints/                # Model Checkpoints (+ archive-v3.5/)
└── docs/                       # Backend-Dokumentation
```

## Wichtig

- **Kein `npm start` ohne Befehl**
- **Keine Commits ohne Befehl**
- **Keine Co-Authored-By Zeile in Commits**
- **API Keys nie committen** (environment.ts ist in .gitignore)

## Dokumentation

**Pflichtlektüre je nach Aufgabe!** Detaillierte Dokumentation befindet sich in `docs/`:

| Dokument | Beschreibung |
|----------|--------------|
| [INDEX.md](docs/INDEX.md) | Uebersicht aller Dokumentationen |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System-Architektur & Design |
| [EVENT_SYSTEM.md](docs/EVENT_SYSTEM.md) | Event Bus & Manager-Kommunikation |
| [DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | UI Design System |
| [TOWER_CREATION.md](docs/TOWER_CREATION.md) | Neue Tower & rotierende Turrets |
| [ENEMY_CREATION.md](docs/ENEMY_CREATION.md) | Neue Enemies, Animationen, Audio |
| [WAVE_SYSTEM.md](docs/WAVE_SYSTEM.md) | Wave-Management, Spawning, Phases |
| [STATUS_EFFECTS.md](docs/STATUS_EFFECTS.md) | Status-Effekte (Slow, Freeze, Burn) |
| [LOCATION_SYSTEM.md](docs/LOCATION_SYSTEM.md) | Standort-System |
| [SPATIAL_AUDIO.md](docs/SPATIAL_AUDIO.md) | 3D Audio System |
| [PROJECTILES.md](docs/PROJECTILES.md) | Projektil-System |
| [MODEL_PREVIEW.md](docs/MODEL_PREVIEW.md) | 3D Model Preview |
| [PARTICLE_SYSTEM.md](docs/PARTICLE_SYSTEM.md) | Partikel-System (Blut, Feuer, Trails) |
| [TILES_LOADING_BUG.md](docs/TILES_LOADING_BUG.md) | 3D-Tiles Loading Bug Analyse |
| [DEVWORLD.md](docs/DEVWORLD.md) | DevWorld Offline-Entwicklungsumgebung |
| [MASTER_GAME_DESIGN.md](docs/game-design/MASTER_GAME_DESIGN.md) | Game Design (Schadenstypen, Ruestung, Balance) |
| [INSTANCED_ENEMY_RENDERING.md](docs/INSTANCED_ENEMY_RENDERING.md) | GPU Instancing mit VAT (Draw Call Reduktion) |
| **Architektur & Store** | |
| [SIGNAL-STORE-ARCHITECTURE.md](docs/SIGNAL-STORE-ARCHITECTURE.md) | Signal Store Architektur (5 Sub-Stores: Game/UI/Engine/Location/Research) |
| **AI System (Frontend)** | |
| **[PHASE_5.11_RANGES.md](docs/PHASE_5.11_RANGES.md)** | **Aktuelle AI-Architektur** (Range-Based Templates + 5.11b/5.14/5.16-Erweiterungen) |
| **[HANDOVER_PLAYTEST_PHASE5.16.md](docs/HANDOVER_PLAYTEST_PHASE5.16.md)** | **Aktueller Balance-Stand** (Wave-Curriculum, Endgame-Knobs, Gold-Budget) |
| [AI_WAVE_DIRECTOR_PLAN.md](docs/AI_WAVE_DIRECTOR_PLAN.md) | AI Wave Director - konsolidierte Gesamtuebersicht |
| [BOT_SYSTEM.md](docs/BOT_SYSTEM.md) | Strategy-Based Bot System - 8 Strategien inkl. Research |
| [PHASE_5.10_TEMPLATES.md](docs/PHASE_5.10_TEMPLATES.md) | _Historical:_ Template-Based (superseded by 5.11) |
| **Training Backend** (`training-backend/`) | |
| [AI_TRAINING_BACKEND.md](training-backend/docs/AI_TRAINING_BACKEND.md) | Python Training Backend - PPO, State 156, 4-Term Reward, Decoder-Constraints |
| [AI_TRAINING_SESSION_NOTES.md](training-backend/docs/AI_TRAINING_SESSION_NOTES.md) | Entwicklungsgeschichte v1→v3.5 + Phase-5.x-Index |
| [AI_MODEL_EXPORT.md](training-backend/docs/AI_MODEL_EXPORT.md) | ONNX Model Export (`npm run export-ai`) |
| **Project Management** | |
| [TODO.md](TODO.md) | Offene Aufgaben |
| [DONE.md](DONE.md) | Changelog (chronologisch, neueste zuerst) |

**Hinweis zu TODO/DONE:**
- **TODO.md** enthält offene Aufgaben, gruppiert nach Priorität und Bereich
- **DONE.md** ist ein chronologischer Changelog mit Datumsabschnitten (neueste zuerst)
- Einträge werden **nur auf menschlichen Zuruf** von TODO nach DONE verschoben
- Bei neuen Einträgen in DONE.md immer das aktuelle Datum als Section verwenden

## Tech Stack

| Teil | Technologie |
|------|-------------|
| Framework | Angular 21 |
| 3D Engine | Three.js 0.182 |
| 3D Tiles | 3DTilesRendererJS 0.4.19 |
| UI | Angular Material 21 |
| Maps | Google Maps 3D Tiles API |
| Geocoding | OpenStreetMap Nominatim |
| AI Training | Python 3.8+ + PyTorch 2.0 + WebSockets |
| AI Dashboard | FastAPI + Chart.js (http://localhost:3002) |
| Bot System | TypeScript Strategy Pattern (Browser) |
