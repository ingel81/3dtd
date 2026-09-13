# CLAUDE.md - 3DTD

## Projekt

3DTD - Standalone Tower Defense auf Google Maps 3D Tiles

## Befehle

```bash
npm start       # Development Server (http://localhost:4200)
npm run build   # Production Build
npm test        # vitest
npm run lint
```

## Architektur

- Angular 22 Standalone Components (nur UI)
- Three.js + 3DTilesRendererJS fuer 3D-Rendering
- **Event-driven Game Engine** - Manager kommunizieren via GameEventBus
- **Signal Store** - 6 Sub-Stores als Single Source of Truth (Game, UI, Engine, Location, Research, Debug)
- Kein Backend im Spiel-Client - komplett clientseitig (Python-Backend nur fuer AI-Training)
- **Wave-Director ist regelbasiert** (`ai/core/rule-director.ts` + `gate-controller.ts`),
  laeuft ohne Server, ohne Modell, ohne ONNX-Runtime. Das ONNX-Modell ist Opt-in
  im Debug-Fenster - Begruendung in [AI_WAVE_DIRECTOR_PLAN.md](docs/AI_WAVE_DIRECTOR_PLAN.md)
- Google Maps API Key in environment.ts

## Projektstruktur

```
src/app/
├── app.ts                      # Root Component (AppComponent)
├── app.config.ts               # Provider Config
├── app.routes.ts               # Routing
├── tower-defense.component.*   # Haupt-Spielkomponente (.ts, .html, .scss)
├── ai/                         # AI System (Browser)
│   ├── core/                   # Regel-Director, Gate-Controller, Templates, State-Encoder, Decision-Explainer
│   └── training/               # Bot System (Strategy Pattern), Training-Session, WebSocket-Client
│       ├── bots/               # StrategyBot, Factory
│       └── strategies/         # Placement, Upgrade, Wave, Research Strategies
├── game-engine/                # Event Bus, VFX/Audio/BackgroundMusic/ScreenShake Services (Three.js-coupled, Angular-frei)
├── components/                 # UI Components (compass, game-header, game-sidebar, etc.)
├── configs/                    # Tower/Enemy/Projectile/Combat/Research/Audio + Wave-Curriculum-Configs
├── core/                       # GameObject/Component-Basis, ConfigService
├── devworld/                   # DevWorld Offline-Entwicklungsumgebung
├── entities/                   # Enemy, Tower, Projectile (+ tower-targeting.util, enemy-rush)
├── game-components/            # ECS Components (transform, health, movement, combat, etc.)
├── integration/                # Cross-System Integration-Tests
├── interfaces/                 # Provider-Interfaces (StreetNetwork, Terrain)
├── managers/                   # Manager (Enemy, Tower, Wave, Research, etc. - event-driven), audio/ (Spatial Audio)
├── models/                     # Type Definitions (game.types, location.types, status-effects)
├── services/                   # Angular Services (Subfolders: combat/, debug/, facade/, infrastructure/, location/, world/)
├── store/                      # Signal Stores (Game, UI, Engine, Location, Research, Debug)
├── styles/                     # Theme-Tokens (td-theme.ts)
├── three-engine/               # 3D Rendering: Engine, CameraRig, Tiles, renderers/ (inkl. Shader), post-processing/
├── utils/                      # Shared Utilities (geo-utils, damage-calculator, global-route-grid, route-corridor)
└── workers/                    # Web Workers (Pathfinding, Heartbeat)

training-backend/               # Python Training Backend (nur fuer Trainingslaeufe)
├── server.py                   # WebSocket Server (:3001), Decoder, A/B-Verteilung
├── manage_server.py            # Start/Stop/Status als Hintergrundprozess
├── directors.py                # Austauschbare Wave-Designer (model/rules/random/maxgate)
├── schema.py                   # Laedt generated/ai-schema.json (Templates, Curriculum, Masken)
├── config.py                   # Hyperparameter, DIRECTOR_ROSTER
├── core/
│   ├── model.py                # Neural Network (Conv1D + Dense, State 208 → 36 Outputs)
│   ├── trainer.py              # PPO Training Algorithm
│   └── reward.py               # Reward Function (4 Terms: death, drama, pacing, swarm_size)
├── utils/logger.py             # Console + JSONL-Logging
├── dashboard/                  # Web Dashboard (:3002)
│   ├── app.py                  # FastAPI Server
│   └── static/                 # Chart.js UI
├── generated/ai-schema.json    # Aus den TS-Configs generiert (`npm run ai-schema`)
├── scripts/                    # ONNX-Export, Log-Analyse, Training-Inspector
├── tests/                      # pytest (Schema, Encoder, Reward, Directors, Gate-Loop)
├── start.bat                   # Windows Start-Script
├── checkpoints/                # Model Checkpoints (+ archive-<datum>/)
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
| [STATUS_EFFECTS.md](docs/STATUS_EFFECTS.md) | Status-Effekte (Slow, Burn, Poison; Freeze reserviert) |
| [LOCATION_SYSTEM.md](docs/LOCATION_SYSTEM.md) | Standort-System |
| [SPATIAL_AUDIO.md](docs/SPATIAL_AUDIO.md) | 3D Audio System |
| [PROJECTILES.md](docs/PROJECTILES.md) | Projektil-System |
| [MODEL_PREVIEW.md](docs/MODEL_PREVIEW.md) | 3D Model Preview |
| [PARTICLE_SYSTEM.md](docs/PARTICLE_SYSTEM.md) | Partikel-System (Blut, Feuer, Trails) |
| [TILES_LOADING_BUG.md](docs/TILES_LOADING_BUG.md) | 3D-Tiles Loading Bug Analyse |
| [DEVWORLD.md](docs/DEVWORLD.md) | DevWorld Offline-Entwicklungsumgebung |
| [ROUTE_CORRIDOR.md](docs/ROUTE_CORRIDOR.md) | Routenkorridor: Breite je Seite aus den Tiles, OSM-Rückfall, Dach-Check, Brücken/Tunnel, CorridorRefit, `__corridor.*` |
| [MASTER_GAME_DESIGN.md](docs/game-design/MASTER_GAME_DESIGN.md) | Game Design (Schadenstypen, Ruestung, Balance) |
| [BALANCE_PROPOSAL_2026-09.md](docs/game-design/BALANCE_PROPOSAL_2026-09.md) | Balance-Vorschlag (Upgrade-Kurven, Cannon, Matrix, Boss-Takt), im Sprint 2026-09-11 umgesetzt, offene Fragen am Ende |
| [PLAYER_AGENCY_CONCEPT.md](docs/game-design/PLAYER_AGENCY_CONCEPT.md) | _Konzept:_ Spielerfähigkeiten und Held; Entscheidung 2026-09-12 in Abschnitt 7 |
| [INSTANCED_ENEMY_RENDERING.md](docs/INSTANCED_ENEMY_RENDERING.md) | GPU Instancing mit VAT (Draw Call Reduktion) |
| [ENEMY_MODEL_BUDGET.md](docs/ENEMY_MODEL_BUDGET.md) | Gegnermodelle vermessen, Budget je Klasse (`npm run model-budget`) |
| [MULTIPLAYER_CONCEPT.md](docs/MULTIPLAYER_CONCEPT.md) | _Plan:_ PvE-Coop & PvP - Determinismus-Blocker, Server-Entwurf, zwei Zielmodi. Kein Code |
| [ROUTE_ALIGNED_CELLS_CONCEPT.md](docs/ROUTE_ALIGNED_CELLS_CONCEPT.md) | _Konzept:_ Zellen parallel zur Route statt Nord-Ost-Raster. Kein Code |
| **Analysen & Berichte** | |
| [REVIEW_SPRINT_2026-09-13.md](docs/REVIEW_SPRINT_2026-09-13.md) | Handover der Nachtschicht 2026-09-13: Änderungen, Entscheidungen, Review, Playtest-Liste ab 101 |
| [REVIEW_SPRINT_2026-09-12.md](docs/REVIEW_SPRINT_2026-09-12.md) | Letzter Sprint-Handover: Änderungen, Review-Befunde, Playtest-Liste mit Ergebnissen |
| [ROUTE_GEOMETRY_ANALYSIS.md](docs/ROUTE_GEOMETRY_ANALYSIS.md) | Route vs. Straße: Herleitung des Korridors, Lücken in der LOS-Anzeige |
| [PERF_BUG_ANALYSIS_2026-05-28.md](docs/PERF_BUG_ANALYSIS_2026-05-28.md) | Performance- und Bug-Deep-Dive (Render-Loop, Instancing, VFX, Leaks) |
| **Architektur & Store** | |
| [SIGNAL-STORE-ARCHITECTURE.md](docs/SIGNAL-STORE-ARCHITECTURE.md) | Signal Store Architektur (6 Sub-Stores: Game/UI/Engine/Location/Research/Debug) |
| [HANDOVER_ROUTE_GRID_GPU_LOS.md](docs/HANDOVER_ROUTE_GRID_GPU_LOS.md) | GPU-Cubemap-LOS-Pipeline (Ground + Air produktiv) |
| **Wave Director & AI** | |
| **[AI_WAVE_DIRECTOR_PLAN.md](docs/AI_WAVE_DIRECTOR_PLAN.md)** | **Einstieg:** Regel-Director + Gate-Controller, warum das ONNX-Modell ersetzt wurde |
| [HANDOVER_RULE_DIRECTOR.md](docs/HANDOVER_RULE_DIRECTOR.md) | Umstellung auf den Regel-Director (2026-09-07), Messreihe, Einstieg für späteres Training |
| [BOT_SYSTEM.md](docs/BOT_SYSTEM.md) | Strategy-Based Bot System (Gegenspieler im Training) |
| [HANDOVER_PLAYTEST_PHASE5.16.md](docs/HANDOVER_PLAYTEST_PHASE5.16.md) | Balance-Stand (Wave-Curriculum, Endgame-Knobs, Gold-Budget) |
| [PHASE_5.11_RANGES.md](docs/PHASE_5.11_RANGES.md) | Range-Templates + Decoder-Constraints (Mechanik gilt; Modell-als-Director ist ueberholt) |
| [STATIC_WAVE_FALLBACK.md](docs/STATIC_WAVE_FALLBACK.md) | Debug-Pfad ohne Director (STATIC_WAVE_PROFILES) |
| [PHASE_5.10_TEMPLATES.md](docs/archive/PHASE_5.10_TEMPLATES.md) | _Historisch:_ superseded by 5.11 (weitere überholte Docs in `docs/archive/`) |
| **Training Backend** (`training-backend/`, nur fuer Trainingslaeufe) | |
| [AI_TRAINING_BACKEND.md](training-backend/docs/AI_TRAINING_BACKEND.md) | PPO, State-Encoder, Reward, Decoder-Constraints, A/B-Directors |
| [HANDOVER_TRAINING_REFRESH.md](docs/HANDOVER_TRAINING_REFRESH.md) | Backend-Refresh: Befunde + Grundsatzentscheidungen |
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
| Framework | Angular 22 (Node >= 22.22.3 bzw. 24.15, npm 11) |
| 3D Engine | Three.js 0.186 |
| 3D Tiles | 3DTilesRendererJS 0.5.2 |
| UI | Angular Material 22 |
| Maps | Google Maps 3D Tiles API |
| Geocoding | OpenStreetMap Nominatim |
| AI Training | Python 3.8+ + PyTorch 2.0 + WebSockets |
| AI Dashboard | FastAPI + Chart.js (http://localhost:3002) |
| Bot System | TypeScript Strategy Pattern (Browser) |
