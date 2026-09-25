# CLAUDE.md - 3DTD

## Projekt

3DTD - Standalone Tower Defense auf Google Photorealistic 3D Tiles (über Cesium Ion oder die Google Maps API)

## Befehle

```bash
npm start       # Development Server (http://localhost:4200)
npm run build   # Production Build
npm test        # vitest
npm run lint
npm run e2e     # End-to-End-Tests im Browser (Dev-Server muss laufen, docs/E2E.md)
npm run coop-server  # Coop-Relay (:3003), docs/COOP_PLAN.md
```

## Architektur

- Angular 22 Standalone Components (nur UI)
- Three.js + 3DTilesRendererJS für 3D-Rendering
- **Event-driven Game Engine** - Manager kommunizieren via GameEventBus
- **Signal Store** - 6 Sub-Stores als Single Source of Truth (Game, UI, Engine, Location, Research, Debug)
- Kein Backend im Spiel-Client - komplett clientseitig (`bot-server/` nur für Bot-Läufe)
- **Wellenquellen sind austauschbar** (`director/wave-source.ts`, ein Unterordner je Variante unter
  `director/sources/`, Standard in `configs/director.config.ts`). Der adaptive Source ist regelbasiert und
  läuft ohne Server und ohne Modell, der Tabellen-Source spielt eine editierbare Liste. Rahmen in
  [WAVE_SOURCE_PLAN.md](docs/WAVE_SOURCE_PLAN.md), der adaptive in
  [WAVE_DIRECTOR.md](docs/WAVE_DIRECTOR.md), Umbau in [BALANCING_PLAN.md](docs/BALANCING_PLAN.md)
- Tile-Zugang: Cesium-Ion-Token (Standard) oder Google-Maps-Key. `ConfigService` liest ihn aus drei Quellen, die
  spätere gewinnt: `environment.ts` (Vorlage `environment.template.ts`), `public/runtime-config.json`, Token-Dialog
  (localStorage `3dtd-tile-credentials`)

## Projektstruktur

```
src/app/
├── app.ts                      # Root Component (AppComponent)
├── app.config.ts               # Provider Config
├── app.routes.ts               # Routing
├── tower-defense.component.*   # Haupt-Spielkomponente (.ts, .html, .scss)
├── bots/                       # Bot System (Strategy Pattern), Bot-Session, WebSocket-Client
│   ├── bots/                   # StrategyBot, Factory
│   └── strategies/             # Placement, Upgrade, Wave, Research, Ability, Hero Strategies
├── director/                   # Wellenquellen: Vertrag (wave-source.ts), WaveDirector, Templates,
│                               # Snapshot, Verteidigungsanalyse; sources/adaptive + sources/table
├── game-engine/                # Event Bus, VFX/Audio/BackgroundMusic/ScreenShake Services (Three.js-coupled, Angular-frei)
├── coop/                       # Coop: Lockstep, Relay-Protokoll, Weltpaket, Prüfsummen, Raum-Optionen (docs/COOP_PLAN.md)
├── components/                 # UI Components (compass, game-header, game-sidebar, etc.)
├── configs/                    # Tower/Enemy/Projectile/Combat/Research/Audio + Kampagne (campaign.config.ts)
├── core/                       # GameObject/Component-Basis, ConfigService
├── devworld/                   # DevWorld Offline-Entwicklungsumgebung
├── entities/                   # Enemy, Tower, Projectile (+ tower-targeting.util, enemy-rush)
├── game-components/            # ECS Components (transform, health, movement, combat, etc.)
├── integration/                # Cross-System Integration-Tests
├── interfaces/                 # Provider-Interfaces (StreetNetwork, Terrain)
├── managers/                   # Manager (Enemy, Tower, Wave, Research, Ability, Hero usw., event-driven), game-state/ (Ledger, Lifecycle, Clock), worm/, audio/ (Spatial Audio)
├── models/                     # Type Definitions (game.types, location.types, status-effects)
├── replay/                     # Replay-Leiste: Marken, Zeitformat (docs/REPLAY.md)
├── run-log/                    # Run-Log: Sammler, Speicher, Export, Game-Over-Zahlen (docs/RUN_LOG.md)
├── simulator/                  # Snapshot, Prüfsumme, Neu-Simulation, Replay-Session, Replay-Datei (docs/SIMULATOR_PLAN.md)
├── services/                   # Angular Services (Subfolders: combat/, debug/, facade/, infrastructure/, location/, onboarding/, world/)
├── store/                      # Signal Stores (Game, UI, Engine, Location, Research, Debug)
├── styles/                     # Theme-Tokens (td-theme.ts)
├── three-engine/               # 3D Rendering: Engine, CameraRig, Tiles, renderers/ (inkl. Shader), post-processing/
├── utils/                      # Shared Utilities (geo-utils, damage-calculator, global-route-grid, route-corridor, game-rng)
└── workers/                    # Web Worker: Heartbeat für den Loop im versteckten Tab

bot-server/                     # Python Bot-Server (nur für Bot-Läufe, plant keine Wellen)
├── server.py                   # WebSocket Server (:3001): Clients, Wellen-Log, Fernbedienung
├── manage_server.py            # Start/Stop/Status als Hintergrundprozess
├── config.py                   # Ports, Bot-Gewichte
├── utils/logger.py             # Console + JSONL-Logging (logs/bots_*.jsonl)
├── dashboard/                  # Web Dashboard (:3002): wer läuft, Knöpfe, Fehler
├── analyze_runs.py, analysis/  # Auswertung der Läufe (run-report.html)
├── tests/                      # pytest (Analyse, Bot-Log)
├── requirements.txt            # Python-Abhängigkeiten
└── start.bat / start.sh        # Start-Skripte (Windows, Unix)

coop-server/                    # Node-Relay für Coop (npm run coop-server, :3003), Einstieg der Desktop-App (desktop.ts)
desktop/                        # Electron-App: Installer, Auto-Update, LAN-Relay und LAN-Suche (docs/ELECTRON_DESKTOP_PLAN.md)
e2e/                            # Playwright-Tests des Dev-Spiels (docs/E2E.md)
tools/                          # Charts, Modell-Budget, Shader-Check, Blender-Skripte, Build-Info, Relay-Last
landing/                        # Projektseite
```

## Wichtig

- **Kein `npm start` ohne Befehl**
- **Keine Commits ohne Befehl**
- **Keine Co-Authored-By Zeile in Commits**
- **API Keys nie committen** (environment.ts ist in .gitignore)

## Dokumentation

**Pflichtlektüre je nach Aufgabe!** Alle weiteren Dokumente (Features wie Fähigkeiten, Held, Replay, Audio,
Partikel; Game Design und Balance; Berichte und Sprint-Handover; Pläne; Archiv) listet
[docs/INDEX.md](docs/INDEX.md) mit Status und Schnellnavigation.

| Aufgabe | Pflichtlektüre |
|---------|----------------|
| Einstieg, Gesamtarchitektur | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Manager und Events | [EVENT_SYSTEM.md](docs/EVENT_SYSTEM.md) |
| State, Stores, Facades | [SIGNAL-STORE-ARCHITECTURE.md](docs/SIGNAL-STORE-ARCHITECTURE.md) |
| UI und Styling | [DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) |
| Tower, Turrets, Placement | [TOWER_CREATION.md](docs/TOWER_CREATION.md) |
| Gegner, Animationen, Gegner-Audio | [ENEMY_CREATION.md](docs/ENEMY_CREATION.md) |
| Schaden, Rüstung, Balance | [MASTER_GAME_DESIGN.md](docs/game-design/MASTER_GAME_DESIGN.md) |
| Route, Korridor, Zellen | [ROUTE_CORRIDOR.md](docs/ROUTE_CORRIDOR.md) |
| Sichtlinien der Tower | [LOS_PIPELINE.md](docs/LOS_PIPELINE.md) |
| Wellen: Quellen, Vertrag, Wellenliste | [WAVE_SOURCE_PLAN.md](docs/WAVE_SOURCE_PLAN.md) (Einstieg) |
| Wellen: Regeln, Deckel, Spawning | [WAVE_DIRECTOR.md](docs/WAVE_DIRECTOR.md), [WAVE_SYSTEM.md](docs/WAVE_SYSTEM.md) |
| Daten eines Laufs, Export | [RUN_LOG.md](docs/RUN_LOG.md) |
| Offene Nachtests im Spiel | [PLAYTEST.md](docs/PLAYTEST.md) |
| End-to-End-Tests im Browser | [E2E.md](docs/E2E.md) |
| Coop, Relay, Lockstep, LAN | [COOP_PLAN.md](docs/COOP_PLAN.md), [SIMULATOR_PLAN.md](docs/SIMULATOR_PLAN.md) |
| Desktop-App, Release | [ELECTRON_DESKTOP_PLAN.md](docs/ELECTRON_DESKTOP_PLAN.md) |
| Offene Arbeit und Entscheidungen, Changelog | [TODO.md](TODO.md), [DONE.md](DONE.md) |

**Hinweis zu TODO/DONE:**
- **TODO.md** ist die einzige Liste offener Arbeit: ein Backlog mit stabilen Kennungen (A1, C16, E27 …), dazu
  „Entschieden“ und „Verworfen“; Handover und Berichte führen keine eigenen Listen
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
| Maps | Google Photorealistic 3D Tiles über Cesium Ion (Standard) oder die Google Maps API |
| Straßen | OpenStreetMap über Overpass |
| Geocoding | OpenStreetMap Nominatim |
| Bot-Server | Python 3.9+ (venv: 3.11) + WebSockets |
| Bot-Dashboard | FastAPI (http://localhost:3002) |
| Bot System | TypeScript Strategy Pattern (Browser) |
| Coop-Relay | Node + ws (coop-server/), im Lockstep |
| Desktop | Electron 44 (desktop/), NSIS (Windows), AppImage (Linux) |
| E2E | Playwright (e2e/) |
