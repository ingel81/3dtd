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
- Kein Backend - komplett clientseitig
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
│   │   └── strategies/         # Placement, Upgrade, Wave Strategies
│   └── core/                   # Game State Capture, Data Collection
├── game-engine/                # Event Bus, VFX/Audio Services (framework-agnostic)
├── components/                 # UI Components (compass, game-header, game-sidebar, etc.)
├── configs/                    # Tower & Projectile Type Configs
├── core/services/              # Config Service
├── docs/                       # Feature Dokumentation
├── entities/                   # Enemy, Tower, Projectile
├── game/tower-defense/shaders/ # Shader Code
├── game-components/            # ECS Components (transform, health, etc.)
├── managers/                   # Manager (event-driven, framework-agnostic)
├── models/                     # Type Definitions
├── services/                   # Angular Services (UI-Bindings)
├── styles/                     # Theme & Global Styles
└── three-engine/               # 3D Rendering (renderers/)

training-backend/               # Python Training Backend
├── server.py                   # WebSocket Server (:3001)
├── model.py                    # Neural Network (Conv1D + Dense)
├── trainer.py                  # PPO Training Algorithm
├── reward.py                   # Reward Function (DPS-Gaussian)
├── config.py                   # Hyperparameter
├── dashboard/                  # Web Dashboard (:3002)
│   ├── app.py                  # FastAPI Server
│   └── static/                 # Chart.js UI
├── start.bat                   # Windows Start-Script
├── checkpoints/                # Model Checkpoints
└── docs/                       # Backend-Dokumentation
```

## Wichtig

- **Kein `npm start` ohne Befehl**
- **Keine Commits ohne Befehl**
- **Keine Co-Authored-By Zeile in Commits**
- **API Keys nie committen** (environment.ts ist in .gitignore)

## Dokumentation

**Pflichtlektüre je nach Aufgabe!** Detaillierte Dokumentation befindet sich in `src/app/docs/`:

| Dokument | Beschreibung |
|----------|--------------|
| [INDEX.md](src/app/docs/INDEX.md) | Uebersicht aller Dokumentationen |
| [ARCHITECTURE.md](src/app/docs/ARCHITECTURE.md) | System-Architektur & Design |
| [EVENT_SYSTEM.md](src/app/docs/EVENT_SYSTEM.md) | Event Bus & Manager-Kommunikation |
| [DESIGN_SYSTEM.md](src/app/docs/DESIGN_SYSTEM.md) | UI Design System |
| [TOWER_CREATION.md](src/app/docs/TOWER_CREATION.md) | Neue Tower & rotierende Turrets |
| [ENEMY_CREATION.md](src/app/docs/ENEMY_CREATION.md) | Neue Enemies, Animationen, Audio |
| [WAVE_SYSTEM.md](src/app/docs/WAVE_SYSTEM.md) | Wave-Management, Spawning, Phases |
| [STATUS_EFFECTS.md](src/app/docs/STATUS_EFFECTS.md) | Status-Effekte (Slow, Freeze, Burn) |
| [LOCATION_SYSTEM.md](src/app/docs/LOCATION_SYSTEM.md) | Standort-System |
| [SPATIAL_AUDIO.md](src/app/docs/SPATIAL_AUDIO.md) | 3D Audio System |
| [PROJECTILES.md](src/app/docs/PROJECTILES.md) | Projektil-System |
| [MODEL_PREVIEW.md](src/app/docs/MODEL_PREVIEW.md) | 3D Model Preview |
| [PARTICLE_SYSTEM.md](src/app/docs/PARTICLE_SYSTEM.md) | Partikel-System (Blut, Feuer, Trails) |
| [TILES_LOADING_BUG.md](src/app/docs/TILES_LOADING_BUG.md) | 3D-Tiles Loading Bug Analyse |
| [DEVWORLD.md](src/app/docs/DEVWORLD.md) | DevWorld Offline-Entwicklungsumgebung |
| **AI System (Frontend)** | |
| [AI_WAVE_DIRECTOR_PLAN.md](docs/AI_WAVE_DIRECTOR_PLAN.md) | AI Wave Director - Architektur, Konzepte, Dateien |
| [BOT_SYSTEM.md](src/app/docs/BOT_SYSTEM.md) | Strategy-Based Bot System - Architecture & Strategies |
| **Training Backend** (`training-backend/`) | |
| [AI_TRAINING_BACKEND.md](training-backend/docs/AI_TRAINING_BACKEND.md) | Python Training Backend - PPO, Dashboard, Reward |
| [AI_TRAINING_SESSION_NOTES.md](training-backend/docs/AI_TRAINING_SESSION_NOTES.md) | Entwicklungsgeschichte (v1→v2→v3) |
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
