# Tower Defense - Architektur

**Stand:** 2026-09-13 (Dateistruktur, Services, Manager, Renderer, Game Loop gegen den Code geprüft; `ai/`-Baum: 2026-09-07)

## Übersicht

Component-basierte Game Engine Architektur mit **Three.js + 3DTilesRendererJS** für Google Photorealistic 3D Tiles.

**Hinweis:** Cesium.js wurde vollständig entfernt. Die Engine basiert jetzt zu 100% auf Three.js.

### Feature-Status (nach Cesium-Cleanup)

- [x] Tower-Platzierung (mit Terrain-Höhe)
- [x] Tower-Rendering (GLB Modelle)
- [x] Tower-Selektion (Range-Anzeige mit Terrain-Raycasting)
- [x] Route LOS Grid (2m Zellenauflösung, Shader-Visualisierung)
- [x] Enemy-Spawning und Rendering
- [x] Enemy-Animationen (Walk, Death, Run mit Speed-Multiplier)
- [x] Animation Speed Coupling (Animation-Geschwindigkeit an Bewegung gekoppelt)
- [x] Enemy-Heading (folgt Bewegungsrichtung)
- [x] Pfad-Smoothing (Gegner folgen geglätteten Routen)
- [x] Projektile (Instanced Rendering mit GLB-Modell)
- [x] Projektil-Sound (arrow_01.mp3)
- [x] Blut-Effekte (Partikel + Decals)
- [x] Feuer-Effekte (bei Basis-Schaden + Game Over)
- [x] Location-System (Dialog, Random Spawn, Reset-Fix)
- [x] Air Units (Fledermaus mit heightOffset + heightVariation)
- [x] Air-LOS (skyline-adaptive Cell-Layer, `airVisibility` pro Cell, `canTargetAir`-Tower routen via `isAirPositionVisibleFromTower`)
- [x] LOS-Overlay Ground vs Air visuell getrennt (grün=ground, blau=air-only, rot=blocked)
- [x] Post-Processing-Pipeline (Bloom + Color Grading) als eigene `three-engine/post-processing/` Klasse
- [ ] Projektil-LoS (nur bei Sichtverbindung treffen)

### Laufzeit-Abhaengigkeiten

Das Spiel laeuft **vollstaendig im Browser**. Zur Laufzeit gibt es keinen
Server-Anteil und kein Modell:

| Abhaengigkeit | Status |
|---|---|
| Google Maps 3D Tiles / Cesium-Tiles | extern, Pflicht (Kartendaten) |
| OSM Nominatim | extern, nur beim Location-Wechsel |
| Python-Training-Backend (`:3001`) | **nur Training**. Ohne Verbindung laeuft das Spiel unveraendert. |
| Bots + WebSocket-Client (`ai/training/training-session.ts`) | **nur Training**. Eigener Lazy-Chunk, laedt erst bei Bot-Start oder Backend-Verbindung ([BOT_SYSTEM.md](BOT_SYSTEM.md#integration)). |
| ONNX-Modell + `onnxruntime-web` | **opt-in**. Wird nicht mehr beim Start geladen. |

Der **Wave-Director sitzt im Client**. Standard ist der regelbasierte Director
(`ai/core/rule-director.ts`), der weder Netzwerk noch Modell braucht — deshalb
gibt es kein Startfenster, in dem der Director nicht verfuegbar waere, und
`useAIDirector` steht per Default auf `true`. Der ONNX-Pfad ist erhalten, wird
aber nur durch einen expliziten `WaveDirectorService.loadModel()`-Aufruf aktiv
(Button im Training-Debugger-Panel, `forceRuleMode()` schaltet zurueck);
`onnxruntime-web` (404 kB WASM) landet damit nicht im Cold Start. Das
Training-Backend uebernimmt die Wave-Wahl nur, solange der
`TrainingClientService` verbunden ist.

Details zum Weg vom Director zur fertigen Welle:
[WAVE_SYSTEM.md](WAVE_SYSTEM.md#wave-erzeugung-director--waveconfig).

## Design Prinzipien

1. **Component-Based Architecture** - Flexibles GameObject-System mit austauschbaren Components
2. **Separation of Concerns** - Renderer getrennt von Game Logic
3. **Manager Pattern** - Spezialisierte Manager für Entity-Lifecycle
4. **Single Responsibility** - Jede Klasse hat eine klare Aufgabe
5. **Reusable Factories** - Wiederverwendbare Factory-Methoden für ähnliche Objekte

### Reusable Components

Ähnliche visuelle Elemente sollten **immer** als wiederverwendbare Factory-Methoden implementiert werden:

```typescript
// GUT: Factory mit konfigurierbaren Optionen
createDiamondMarker(options: {
  color: number;
  size?: number;
  glowIntensity?: number;
}): THREE.Group { ... }

// Verwendung: Platzierungsvorschau des HQ (MapPlacementService)
const preview = this.markerViz.createDiamondMarker({ color: 0x22c55e, size: 0.8, glowIntensity: 0.6 });
```

---

## Services

Die Haupt-Komponente wurde durch Extraktion spezialisierter Services modularisiert.
`tower-defense.component.ts` hat ~810 Zeilen, Template und Styles liegen daneben in
`tower-defense.component.html` und `.scss`.

**Hinweis:** Services liegen in `/src/app/services/`. Seit dem **services/-Subfolder-Split
am 2026-05-10** sind sie thematisch in 6 Subfolder gruppiert; Root-Files
bleiben einige zentrale Service-Klassen, die keinem Subfolder eindeutig zuzuordnen sind.

### Verzeichnisstruktur

```
src/app/services/
├── (Root)
│   ├── camera-control.service.ts
│   ├── camera-framing.service.ts
│   ├── camera-overview.ts          ← Hilfsklasse der VisualizationFacade (unten)
│   ├── economy.service.ts          ← Wave-Completion-Bonus, Perfect-Streak (extrahiert aus GSM, 2026-05-10)
│   ├── input-handler.service.ts
│   ├── keyboard-pan.service.ts
│   ├── tower-placement.service.ts  ← Build-Mode, Preview, Validierung; LOS-API delegiert an:
│   ├── tower-los-registry.ts       ← Tower-LOS auf dem Route-Grid (Register, Recompute, Stale-Queue)
│   ├── build-preview-los.ts        ← GPU-LOS-Viz der Build-Preview
│   └── tower-preview-model.ts      ← Transparenz + Gruen/Rot-Tint des Preview-Modells
├── combat/
│   ├── combat-effect.service.ts
│   ├── combat-vfx.service.ts
│   ├── damage-application.service.ts
│   ├── hq-damage.service.ts
│   ├── status-effect.service.ts
│   └── tower-combat.service.ts
├── debug/
│   ├── corridor-console.ts           ← `__corridor`, Hilfsklasse der VisualizationFacade
│   ├── debug-facade.service.ts
│   ├── debug-state-dump.service.ts
│   ├── debug-window.service.ts
│   ├── dps-bins-overlay.ts           ← Hilfsklasse der VisualizationFacade
│   ├── enemy-debug.service.ts
│   ├── los-debug.service.ts
│   ├── performance-profiler.service.ts
│   ├── sound-debug.service.ts
│   ├── tower-debug.service.ts
│   └── wave-debug.service.ts
├── facade/
│   ├── game-loop-facade.service.ts
│   ├── location-facade.service.ts
│   ├── tower-defense-facade.service.ts
│   └── visualization-facade.service.ts
├── infrastructure/
│   ├── asset-manager.service.ts
│   ├── engine-initialization.service.ts
│   ├── game-state-sync.service.ts
│   └── model-preview.service.ts
├── location/
│   ├── geocoding.service.ts
│   ├── geolocation.service.ts
│   ├── location-change-coordinator.service.ts
│   ├── location-change-executor.service.ts
│   ├── location-management.service.ts
│   ├── osm-street.service.ts
│   ├── pathfinding-worker.service.ts
│   ├── street-cache.service.ts
│   ├── url-location.service.ts
│   └── world-dice.service.ts
└── world/
    ├── building-overlay.ts           ← Hilfsklasse der VisualizationFacade
    ├── building-rendering.service.ts
    ├── corridor-controller.ts        ← Hilfsklasse der VisualizationFacade, siehe ROUTE_CORRIDOR.md
    ├── corridor-refit.ts             ← CorridorRefit, siehe ROUTE_CORRIDOR.md
    ├── global-route-grid.service.ts
    ├── height-update.service.ts
    ├── intro-camera-flight.service.ts
    ├── intro-loading-gate.ts         ← Hilfsklasse der VisualizationFacade
    ├── map-placement.service.ts
    ├── marker-visualization.service.ts
    ├── path-route.service.ts
    ├── route-animation.service.ts
    ├── route-grid-convergence.ts     ← Hilfsklasse der VisualizationFacade
    ├── spatial-grid.service.ts
    ├── strategic-placement.service.ts
    └── street-rendering.service.ts
```

### Service-Übersicht (nach Subfolder)

#### infrastructure/

| Service | Verantwortung |
|---------|---------------|
| **AssetManagerService** | Zentraler GLTF/FBX Loader mit Reference Counting |
| **EngineInitializationService** | Loading Sequence mit 10 Boot-Steps (`location` bis `flight`; `location`, `grid` und `flight` setzen andere Services), Progress Tracking |
| **ModelPreviewService** | 3D Model Previews für Sidebar (Max-Renderer + setViewport pro Preview, kein Re-`setSize()` pro Frame) |
| **GameStateSyncService** | EventBus → Store Bridge — wave/game/credits/health/tower/enemy/research:state-changed |

#### (Root) — Camera & Input + zentrale Services

| Service | Verantwortung |
|---------|---------------|
| **CameraControlService** | Start- und Übersichtsansicht merken, Kamera-Reset, Heading und Debug-Info für Kompass und Engine-Store, Schnellsprung `focusGeo` (Home/N): Blickrichtung bleibt, die Position gleitet 600 ms additiv zu Keyboard-Pan und Controls |
| **CameraFramingService** | Viewport-basierte Kamera-Positionierung |
| **InputHandlerService** | Click/Pan Detection, Terrain Raycasting, Kamera-, Build- und Debug-Tasten. Außerhalb von Build- und Platzierungsmodus zeigt der Tower unter dem Zeiger seine Reichweite (Scheibe und Auswahlring des Renderers, `ThreeTowerRenderer.setHovered`): höchstens ein Tower-Pick alle 100 ms mit Nachzügler für die Endposition, keiner bei gedrückter Maustaste |
| **HotkeyService** | Spieltasten (1-9, U, Entf, Leertaste, P, +/-, H, Esc, Pos1, N) nach dem InputHandler; Provider der Spielkomponente, weil er die Facade braucht. Zuordnung in `hotkey-map.ts` |
| **KeyboardPanService** | WASD/Pfeiltasten Kamera-Steuerung |
| **TowerPlacementService** | Build Mode, Placement Validation, Preview Mesh, refineCellsInRadius vor LOS-Reg |
| **EconomyService** | Wave-Completion-Bonus + Perfect-Streak (extrahiert aus GameStateManager, 2026-05-10) |

#### combat/

| Service | Verantwortung |
|---------|---------------|
| **TowerCombatService** | Tower Targeting, Turret-Rotation, Shooting, Chain-Hitscan (Lightning) |
| **CombatEffectService** | Projectile Hits, Damage, Blood/Death/Slow Effects |
| **CombatVfxService** | VFX-Trigger fuer Combat-Events (Hit-Sparks, Splash-Visuals) |
| **DamageApplicationService** | Damage-Pipeline: Schadensmatrix, Resistances, DOT-Application |
| **StatusEffectService** | Status-Effekte (Slow, Burn, Poison; Freeze reserviert) inkl. DOT-Ticks |
| **HQDamageService** | HQ Fire Effects, Damage Sounds, Game Over Visuals |

#### world/

| Service | Verantwortung |
|---------|---------------|
| **MarkerVisualizationService** | 3D Marker (HQ, Spawn, Debug), Animation |
| **PathAndRouteService** (`path-route.service.ts`) | Pfad-Caching, Route-Visualisierung, Height Smoothing |
| **RouteAnimationService** | Knight Rider Routen-Animation |
| **GlobalRouteGridService** | 2m Grid entlang Route, O(1) LOS Lookup, Tower-Registrierung. Die Per-Tower-Viz (`TowerLosViz`, `utils/tower-los-viz.ts`) halten TowerManager (Auswahl) und TowerPlacementService (Build-Preview) |
| **IntroCameraFlightService** | Intro-Kamerafahrt entlang der Route, lädt dabei die Tiles des Korridors vor |
| **CorridorRefit** (`corridor-refit.ts`) | Korridor-Messung nach Tile-Loads nachziehen, siehe [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md) |
| **SpatialGridService** | Generischer Spatial Hash fuer Tower/Enemy Range-Queries |
| **HeightUpdateService** | Terrain Height Sync, Stabilization Loop |
| **StreetRenderingService** | Street Network Visualisierung mit Terrain-Following |
| **BuildingRenderingService** | OSM-Gebaeude rendern (DevWorld + Live) |
| **MapPlacementService** | HQ-Placement, Spawn-Generation, Map-Bounds |
| **StrategicPlacementService** | Optimale Tower-Positionen entlang Enemy-Pfade |

#### location/

| Service | Verantwortung |
|---------|---------------|
| **LocationManagementService** | Location CRUD, LocalStorage Persistence |
| **LocationChangeCoordinatorService** | Koordiniert Location-Wechsel (Dialog, Favoriten, Weltwürfel, Fehler-Unwinding) |
| **LocationChangeExecutorService** | Die 7 Schritte eines Location-Wechsels (Reset, Straßen, HQ, Spawn, Routen, Finalize) |
| **GeocodingService** | Nominatim Geocoding & Reverse-Geocoding |
| **GeolocationService** | Browser Geolocation API Wrapper |
| **OsmStreetService** | OpenStreetMap Straßen-Loading, A* Pathfinding |
| **StreetCacheService** | IndexedDB Cache für Straßendaten |
| **PathfindingWorkerService** | A*-Pathfinding ueber Web Worker |
| **UrlLocationService** | URL-Parameter für Location-Sharing |
| **WorldDiceService** | Zufällige Städte für Random-Location |

#### debug/

| Service | Verantwortung |
|---------|---------------|
| **DebugFacadeService** | Debug Log, Height Debug, Display Options (ein Objekt unter `td_display_options`, `utils/display-options.storage.ts`), Enemy Debug |
| **WaveDebugService** | Wave-Debugging Utilities — delegiert State an `DebugStore` |
| **SoundDebugService** | Sound-Debug Stats & Events von SpatialAudioManager |
| **TowerDebugService** | Tower-Parameter Overrides (Scale, Height, Rotation) — delegiert State an `DebugStore` |
| **EnemyDebugService** | Enemy-Debug (Spawn, Type-Config, Live-Visualisierung) — delegiert State an `DebugStore` |
| **DebugWindowService** | Offen/zu-Zustand der elf Debug-Fenster. Die Fenster-Komponenten laden als ein Lazy-Chunk (`components/debug-window/debug-windows.ts`, ein `@defer`-Block im Template), sobald das Dev-Menü oder ein Fenster offen ist; die Debug-Services bleiben im Spiel-Chunk |
| **PerformanceProfilerService** | Frame-Time Sampling, Hot-Path-Profile (`.profiles/`) |
| **LosDebugService** | Zustand des LOS-Debug-Fensters: aktiver Tower, Cubemap-Faces, Pixel-zu-Cell-Lookup |
| **DebugStateDumpService** | JSON-Snapshot des Engine-Zustands als Download für Bug-Hunts |

### Facade Services

Fünf Facade Services orchestrieren die spezialisierten Services und bilden die Schnittstelle zur Komponente.
Vier davon liegen in `services/facade/`, der Debug-Facade in `services/debug/`.

| Facade | Datei | Verantwortung |
|--------|-------|---------------|
| **TowerDefenseFacadeService** | `facade/tower-defense-facade.service.ts` | Haupt-Orchestrator: Initialisierung, Service-Wiring, Lifecycle |
| **GameLoopFacadeService** | `facade/game-loop-facade.service.ts` | Wave-Management, Game Loop, Upgrades, AI-Integration |
| **VisualizationFacadeService** | `facade/visualization-facade.service.ts` | Rendering, Kamera, Toggle-Steuerung, Height-Updates; Teilaufgaben in eigenen Klassen (unten) |
| **LocationFacadeService** | `facade/location-facade.service.ts` | Location Detection, DevWorld, Spawn-Management |
| **DebugFacadeService** | `debug/debug-facade.service.ts` | Debug Log, Height Debug, Display Options, Enemy Debug |

`VisualizationFacadeService` bleibt der Einstieg für seine Aufrufer. Sieben Teilaufgaben
liegen in kleinen Klassen ohne DI, die er in seinen Feld-Initialisierern mit den Services
baut, die sie brauchen, und an denselben Stellen aufruft wie vorher den eigenen Code:

| Klasse | Datei | Aufgabe |
|--------|-------|---------|
| **CorridorController** | `world/corridor-controller.ts` | `CorridorRefit` verdrahten (Frames, Timer, Sperren), Neuaufbau von Routen, Zellen und Routenlinie, Flush-Haken am `GameStateManager` |
| **CorridorConsole** | `debug/corridor-console.ts` | `__corridor.get/set/reset/towerCells/pick` |
| **RouteGridConvergence** | `world/route-grid-convergence.ts` | rAF-Schleife nach Tile-Loads (Höhen-Sweep, Retry), Routenlinie, Marker und Animation neu, wenn sich Zellen ändern |
| **IntroLoadingGate** | `world/intro-loading-gate.ts` | Ladescreen beim ersten Laden halten, bis die Intro-Fahrt Höhen hat |
| **CameraOverview** | `camera-overview.ts` | Übersichts-Frame, Startansicht, Kamera-Debug-Toggles |
| **DpsBinsOverlay** | `debug/dps-bins-overlay.ts` | DPS-Profil-Bins entlang der Route |
| **BuildingOverlay** | `world/building-overlay.ts` | OSM-Gebäudegrundrisse nahe der Routen |

### Service-Architektur

```
tower-defense.component.ts
    │
    ├── TowerDefenseFacadeService ─── Haupt-Orchestrator
    │   ├── EngineInitializationService ─ Loading Sequence
    │   │       └── AssetManagerService ─ Zentrales Asset Loading
    │   ├── TowerPlacementService ────── Build Mode
    │   └── GameStateSyncService ─────── EventBus → Store Bridge
    │
    ├── GameLoopFacadeService ───────── Wave, Game Loop, AI
    │   ├── TowerCombatService ───────── Targeting, Rotation, Shooting
    │   ├── CombatEffectService ──────── Hits, Damage, Effects
    │   ├── HQDamageService ──────────── HQ Fire, Damage Sounds
    │   └── StrategicPlacementService ── Optimale Tower-Positionen
    │
    ├── VisualizationFacadeService ──── Rendering, Camera, Toggles
    │   ├── CameraControlService ─────── Kamera-Steuerung
    │   ├── CameraFramingService ─────── Viewport-Framing
    │   ├── KeyboardPanService ───────── WASD Steuerung
    │   ├── MarkerVisualizationService ─ 3D Marker
    │   ├── PathAndRouteService ──────── Pfade & Routen
    │   ├── RouteAnimationService ────── Route-Animation
    │   ├── GlobalRouteGridService ───── LOS Grid
    │   ├── HeightUpdateService ──────── Terrain Sync
    │   ├── StreetRenderingService ───── Street Visualization
    │   └── InputHandlerService ──────── Click/Pan Events
    │
    ├── LocationFacadeService ────────── Location, DevWorld, Spawns
    │   ├── LocationManagementService ── Location CRUD
    │   ├── LocationChangeCoordinatorService ── Location-Wechsel (7 Schritte: LocationChangeExecutorService)
    │   ├── UrlLocationService ────────── URL Sharing
    │   ├── GeocodingService ──────────── Nominatim
    │   ├── GeolocationService ────────── Browser GPS
    │   ├── OsmStreetService ──────────── OSM + A* Pathfinding
    │   ├── StreetCacheService ────────── IndexedDB Cache
    │   └── WorldDiceService ──────────── Random Cities
    │
    ├── DebugFacadeService ───────────── Debug Operations
    │   ├── WaveDebugService ──────────── Wave Debugging (→ DebugStore)
    │   ├── SoundDebugService ─────────── Sound Debug Stats
    │   ├── TowerDebugService ─────────── Tower Parameter Overrides (→ DebugStore)
    │   └── EnemyDebugService ─────────── Enemy Debug (→ DebugStore)
    │
    ├── UI Services
    │   ├── UIStore ───────────────────── UI State & Toggles
    │   ├── DebugStore ────────────────── Wave/Tower/Enemy Debug Signals (2026-05-10)
    │   ├── DebugWindowService ────────── Debug Windows
    │   └── ModelPreviewService ───────── 3D Previews
    │
    ├── Managers (event-driven)
    │   ├── GameStateManager ──────────── Game-Loop, Event-Wiring, Sub-Manager-Lifecycle, Fassade für UI und Bots
    │   │   └── game-state/ ───────────── GameClock, CreditsLedger, BaseHealthLedger, TowerLifecycle (2026-09-13)
    │   ├── GameCommandsHandler ───────── Routing der `command:*`- und vier `debug:*`-Events (2026-05-10)
    │   ├── EconomyService ────────────── Wave-Completion-Bonus + Streak (extrahiert aus GSM)
    │   ├── EnemyManager / TowerManager / ProjectileManager / WaveManager / ResearchManager
    │   └── EntityManager ─────────────── Generischer Entity-Container
```

---

## 1. Rendering Stack

### Three.js + 3DTilesRendererJS

```
┌─────────────────────────────────────────────────────────────┐
│  Three.js Scene                                              │
│  ├─ TilesRenderer (3DTilesRendererJS)                       │
│  │   └─ Google Photorealistic 3D Tiles (via Cesium Ion)     │
│  │                                                           │
│  ├─ overlayGroup (synced with tiles)                        │
│  │   ├─ Streets (LineSegments)                              │
│  │   ├─ Route Lines                                         │
│  │   ├─ HQ Marker                                           │
│  │   └─ Spawn-Portale                                       │
│  │                                                           │
│  ├─ Enemies (InstancedMesh + VAT, InstancedEnemyRenderer)   │
│  ├─ Towers (GLTFLoader)                                     │
│  ├─ Projectiles (InstancedMesh)                             │
│  └─ Effects (Particles)                                     │
└─────────────────────────────────────────────────────────────┘
         Automatische Depth-Occlusion
```

**Hinweis:** `CesiumIonAuthPlugin` ist Teil von `3d-tiles-renderer` (NASA JPL), nicht Cesium.js!
Es wird nur für die Authentifizierung zum Cesium Ion Hosting-Service verwendet.

### Kern-Komponenten

| Datei | Beschreibung |
|-------|--------------|
| `three-tiles-engine.ts` | Haupt-Engine: Scene, Renderer, TilesRenderer, Overlays |
| `camera-rig.ts` | Kamera-Controls (GlobeControls, in DevWorld EnvironmentControls), Startposition, lokaler Kamera-Setter. Vom Engine besessen, die Kamera selbst bleibt beim Engine |
| `tile-loading-tracker.ts` | Tile-Loading-State: erster Tile-Load (Debounce 500 ms, Retry 200 ms x 50, Force-Update x 3), Auth-Fehler, Tile-Stats. Hintergrund: [TILES_LOADING_BUG.md](TILES_LOADING_BUG.md) |
| `render-loop.ts` | Render-Loop: rAF-Treiber mit FPS-Cap (`FramePacer`), Heartbeat-Worker für versteckte Trainings-Tabs, FPS-Zähler, Warten auf den nächsten gezeichneten Frame. Als `engine.renderLoop` erreichbar |
| `terrain-queries.ts` | Raycasts gegen Boden und Tiles: Säulen-Probe `sampleColumn()` mit Cache pro 0,5-m-Säule und `lodVersion`, `getGroundHeightEstimate()`, Tile-LOD-Peek ohne Raycast, Straßen-Freiraum für den Routen-Korridor (`measureStreetClearance()`), Line-of-Sight. Als `engine.terrain` erreichbar, nur `getTerrainHeightAtGeo()` reicht der Engine durch |
| `scene-environment.ts` | Statische Szenen-Lichter (`addSceneLights()`) und der Himmel als Cube-Textur aus `day.webp` (`SkyBackground`) |
| `screen-picker.ts` | Screen-Picking: Boden unter dem Mauszeiger (`raycastTerrain()`, in DevWorld über den DevTerrainProvider) und angeklickter Tower (`raycastTowers()`), je Aufruf ein frischer Raycaster. Als `engine.picker` erreichbar |
| `tiles-renderer-setup.ts` | Aufbau des TilesRenderers (`createTilesRenderer()`: Auth je Provider, Kompression, Update-on-Change, verzögertes Entladen, Fade, glTF/Draco, Reorientation, Load-Regions, Gruppe auf Y-oben) und Streaming-Budget (`applyStreamingBudget()`) |
| `ellipsoid-sync.ts` | WGS84 - Three.js Koordinatentransformation |
| `renderers/index.ts` | CoordinateSync Interface + Renderer Exports |

`CameraRig`, `TileLoadingTracker` und `PostProcessingPipeline` gehören dem Engine, er legt
sie im Konstruktor an und reicht Aufrufe durch; seine öffentliche API bleibt die Fassade.
`RenderLoop`, `TerrainQueries` und `ScreenPicker` legt er ebenfalls an, reicht sie aber nicht durch: Aufrufer
nehmen `engine.renderLoop` (`start()`, `setFpsLimit()`, `setBackgroundLoopEnabled()`, `getFPS()`)
und `engine.terrain` (`sampleColumn()`, `peekBestTileLODAtLocal()`, `getGroundHeightEstimate()`,
`measureStreetClearance()`, `clearHeightCache()`) und `engine.picker` (`raycastTerrain()`, `raycastTowers()`)
direkt. Nur `getTerrainHeightAtGeo()` mit seinen
vielen Aufrufern bleibt als Durchreiche am Engine.
Der Loop ruft pro Frame `update()` und `render()` des Engines, `render()` meldet jeden
gezeichneten Frame mit `renderLoop.frameRendered()` zurück.
`initialize()` bindet sie in fester Reihenfolge an den TilesRenderer: `createTilesRenderer()`
(Plugins registrieren), Gruppe in die Szene, `cameraRig.setupGlobeControls()`, Kamera setzen,
`applyStreamingBudget()`, dann `tileLoading.attach()` (Listener für `tiles-load-end`, `load-tileset`,
`load-error`). Nach jedem beruhigten `tiles-load-end` meldet der Tracker
`onTileSetSettled()` zurück, dort invalidiert der Engine LOD-Version (`terrain.markTileSetChanged()`) und LOS-Cubemap und
ruft `onTilesLoadCallback`. `setOrigin()` ruft `tileLoading.reset()`. `dispose()` stoppt
zuerst den Loop (`renderLoop.dispose()`, samt Sichtbarkeits-Listener des Hintergrund-Loops), löst dann die Listener (`tileLoading.dispose()`, `cameraRig.dispose()`) und gibt danach
Entity-Renderer, TilesRenderer, Pipeline und WebGLRenderer frei.

### Koordinatensystem (WICHTIG!)

Das Projekt verwendet zwei Koordinatensysteme. **Häufige Fehlerquelle!**

#### 1. Geographic Coordinates (WGS84)
- `lat`, `lon`: Geografische Koordinaten in Grad
- `height`: Absolute Höhe über WGS84-Ellipsoid in Metern (z.B. 235m)

#### 2. Local Coordinates (Three.js Scene)
- `x`, `z`: Horizontale Position relativ zum Origin (HQ)
- `y`: Vertikale Position relativ zum Origin (0 = Origin-Höhe)

#### Transformation

| Methode | Input | Output | Verwendung |
|---------|-------|--------|------------|
| `geoToLocal(lat, lon, height)` | Geo + WGS84-Höhe | Local X/Y/Z | Objekte mit bekannter geo-Höhe |
| `geoToLocalSimple(lat, lon, 0)` | Geo | Local X/Z (Y=0) | Nur X/Z Position, Y separat setzen |
| `getTerrainHeightAtGeo(lat, lon)` | Geo | **Local Y** | Raycast → Terrain/Dach-Höhe |

#### WICHTIG: getTerrainHeightAtGeo gibt LOCAL Y zurück!

```typescript
// FALSCH - localY ist keine geo-Höhe!
const localY = engine.getTerrainHeightAtGeo(lat, lon);
const pos = engine.sync.geoToLocal(lat, lon, localY); // ❌ Doppelte Transformation!

// RICHTIG - localY direkt verwenden
const localY = engine.getTerrainHeightAtGeo(lat, lon);
const localXZ = engine.sync.geoToLocalSimple(lat, lon, 0);
object.position.set(localXZ.x, localY, localXZ.z); // ✅
```

#### Convenience-Methoden

Für häufige Operationen gibt es Convenience-Methoden, die das automatisch richtig machen:

```typescript
// Feuer auf Terrain spawnen - macht Raycast intern
engine.effects.spawnFireOnTerrain(lat, lon, engine.getTerrainHeightAtGeo, 'medium');

// Oder mit lokalem Y direkt
engine.effects.spawnFireAtLocalY(lat, lon, localY, 'medium');
```

#### WICHTIG: Terrain-Höhe LIVE ermitteln!

Terrain-Höhen sollten **zum Zeitpunkt der Verwendung** ermittelt werden, nicht beim Initialisieren:

```typescript
// FALSCH - Tiles sind beim Init möglicherweise noch nicht geladen!
initialize() {
  this.cachedHeight = engine.getTerrainHeightAtGeo(lat, lon); // ❌ Kann falsch sein!
}

useHeight() {
  doSomething(this.cachedHeight); // ❌ Veralteter/falscher Wert
}

// RICHTIG - Live ermitteln wenn benötigt
useHeight() {
  const localY = engine.getTerrainHeightAtGeo(lat, lon); // ✅ Tiles sind jetzt geladen

  // Sanity check für Werte am Origin (sollten nahe 0 sein)
  if (localY === null || Math.abs(localY) > 50) {
    console.warn('Invalid terrain height:', localY);
    localY = 0;
  }

  doSomething(localY);
}
```

**Grund:** 3D Tiles werden asynchron geladen. Beim Spielstart sind oft noch keine Tiles vorhanden, sodass Raycasts ins Leere gehen oder falsche Werte liefern.

### Terrain-Höhenermittlung

Senkrechte Säulen-Probe gegen die geladenen 3D Tiles in lokalen Koordinaten, in
`TerrainQueries` (`three-engine/terrain-queries.ts`); `engine.getTerrainHeightAtGeo()`
reicht nur durch:

```typescript
getTerrainHeightAtGeo(lat: number, lon: number): number | null {
  // DevWorld: Höhe kommt vom Provider
  const devTerrain = this.sources.devTerrain();
  if (devTerrain) return devTerrain.getHeightAtGeo(lat, lon);

  // Lokale X/Z, dann Säulen-Probe (Cache pro Säule, Key = lokales x/z),
  // gebucht unter 'heightAtGeo' in __raycastStats()
  const localPos = this.sync.geoToLocalSimple(lat, lon, 0);
  return this.sampleColumn(localPos.x, localPos.z)?.groundY ?? null;
}
```

Welcher Treffer der Probe als Boden zählt, entscheidet `three-engine/column-sample.ts`
(ohne Three.js, einzeln testbar). `clearHeightCache()` leert den Säulen-Cache.

### Pfad-Höhen und Route-Grid-Cells

Gegner folgen gecachten Pfaden mit Höhen, die aus dem **Route-Grid** stammen.
Cells sind die Single Source of Truth für Boden-Y — dieselben Cells, die auch
Tower-LOS und Air-Routing bedienen.

**Problem ohne zentrale Quelle:**
- Live-Terrain-Sampling pro Frame würde Gegner über Bäume/Gebäude laufen lassen
- Routen sollen DURCH Hindernisse gehen (geglättete Linie auf Strassenniveau)
- Doppelpipeline (eigene Pfad-Raycasts neben Cell-Raycasts) führt zu Drift
  zwischen sichtbarer Linie, Gegner-Position und Tower-LOS-Sample

**Lösung — eine Quelle, drei Konsumenten:**

```
┌─────────────────────────────────────────────────────────────┐
│  Route Grid (global-route-grid.ts, route-cell-sampler.ts)   │
│  - sampleCellY: strict raycast + sanity-check + LOD-versioned│
│  - cell.terrainHeight = single source of truth              │
│  - getGroundLocalYAt(x,z): cell-first + neighbour fallback  │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Route Build (path-route.service.ts: buildRouteFromPath)    │
│  1. A* pathfinding on street network                        │
│  2. Per waypoint: getGroundLocalYAt(geoToLocal(pos))        │
│  3. Cache pathWithHeights with cell-sourced geo heights     │
│  4. Build Line2 with the same cell heights                  │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Enemy Movement (movement.component.ts)                     │
│  - Interpolates height between path waypoints               │
│  - Waypoint heights came from cells (Step 2 above)          │
└─────────────────────────────────────────────────────────────┘
```

**onTilesLoaded sequence:**
1. Engine (`onTileSetSettled`): `terrain.markTileSetChanged()` erhöht `lodVersion`,
   das entwertet einzelne Säulen-Samples (kein globaler Cache-Clear); danach
   invalidiert der Engine die LOS-Cubemap und ruft den Callback
2. `VisualizationFacadeService.onTilesLoaded()`: Straßen, Gebäude, Marker-Höhen, dann
   `globalRouteGrid.beginTerrainHeightRefresh()`, ein Sweep über alle Cells mit
   Frame-Budget statt eines blockierenden Voll-Durchlaufs; stabile Cells werden nur bei
   besserem LOD neu gesampelt
3. `RouteGridConvergence.scheduleBakedHeightRefresh()` merkt den Neuaufbau von Route-Linien, Markern und
   Animation vor; er läuft einmal, wenn der Sweep fertig ist
4. `RouteGridConvergence.schedule()`: rAF-Schleife, erst `stepTerrainHeightRefresh()` mit
   5 ms pro Frame, danach `retryUnsampledCells()` für Cells, deren Tile-Mesh später
   dekodiert wurde, bis zwei Frames nacheinander nichts mehr befördern (Sicherheitsgrenze
   120 Frames). Am Ende laufen der Baked-Refresh und `CorridorRefit.remeasure()`
   ([ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md))

**Sanity & sampling rules (in `sampleCellY`, `route-cell-sampler.ts`):**
- Rejects raycast hits with `tileDepth=0` / `tileGeomErr=Infinity` (mesh
  not yet decoded → keeps cell `unsampled` instead of caching garbage)
- Rejects outliers >50 m from the median of stable 3×3 neighbours
- LOD-versioned idempotency: stable cells are only resampled when the
  hit comes from a strictly better LOD

**smoothPathHeights():** liegt in `utils/route-height-smoothing.ts` und wird
ausschliesslich von `street-rendering.service.ts` für gerenderte Strassenmesh-
Vertices genutzt. Der Pfad-Bau braucht es nicht mehr, Cells sind schon
sanity-checked.

### Progressive LOS & Street Rendering

Tower-Platzierung und Kamera-Bewegung loesten frueher schwere Frame-Drops aus
(95-600ms synchrone Raycasts). Beide nutzen jetzt progressive Batching:

**Tower LOS Registration:**
- `TowerPlacementService.registerTowerOnGrid()` läuft beim Platzieren (aus
  `GameStateManager`, nicht für passive Gebäude): erst `refineCellsInRadius()` im
  Tower-Radius, dann `registerTower()` am Grid mit GPU-Cubemap-LOS
  ([HANDOVER_ROUTE_GRID_GPU_LOS.md](HANDOVER_ROUTE_GRID_GPU_LOS.md)), danach
  `tower.losReady = true`
- Combat-System überspringt Towers mit `!losReady`
- Ändern sich Cell-Höhen (cells-changed-Listener), kommen die betroffenen Tower in eine
  Queue (`TowerLosRegistry`); `drainLosRefresh()` rechnet höchstens einen Tower pro Frame neu
  (`LOS_RECOMPUTES_PER_FRAME`) und wartet dabei auf einen laufenden Terrain-Sweep, maximal
  3 s (`MAX_LOS_WAIT_MS`)

**Street Rendering:**
- `renderStreets()` sammelt alle Nodes und gibt sofort zurueck
- `continueStreetRender()` verarbeitet 50 Nodes/Frame (je 5 Raycasts bei Lateral Sampling)
- Alte Strassen bleiben sichtbar bis neue fertig (kein Flackern)
- Tile-Reload-Callback: von 350-600ms auf 14-34ms reduziert

### Enemy System Performance

Optimiert fuer 5000+ Enemies bei 67 FPS (~1.79µs pro Enemy):

| Optimierung | Ersparnis |
|-------------|-----------|
| `performance.now()` einmal pro Frame cachen | ~0.5ms |
| Single-Pass Status-Effects (in-place compact) | ~0.8ms |
| GPU `needsUpdate` Flags pro Pool batchen | ~0.7ms |
| Integer-Hash-Keys fuer Spatial Grids | ~0.4ms |
| `geoToLocalSimple` inlined + cos gecacht | ~0.9ms |
| Heading sqrt eliminiert, lateralOffset gecacht | ~0.4ms |
| `Math.pow` → lineare Approximation | ~0.4ms |

---

## 2. Core System: GameObject & Components

### 2.1 GameObject (Basis-Entity)

```typescript
abstract class GameObject {
  readonly id: string;
  readonly type: GameObjectType; // 'enemy' | 'tower' | 'projectile'

  protected components = new Map<ComponentType, Component>();
  private _active = true;

  // Component Management
  addComponent<T extends Component>(component: T, type: ComponentType): T;
  getComponent<T extends Component>(type: ComponentType): T | null;
  hasComponent(type: ComponentType): boolean;
  removeComponent(type: ComponentType): void;

  // Lifecycle
  update(deltaTime: number): void;
  destroy(): void;
}
```

### 2.2 Components

| Component | Beschreibung |
|-----------|--------------|
| `TransformComponent` | Position (GeoPosition), Rotation, Scale |
| `HealthComponent` | HP, maxHp, takeDamage(), heal() |
| `MovementComponent` | Path-Following, speedMps, speedMultiplier, getEffectiveSpeed(gameTimeMs) |
| `CombatComponent` | damage, range, fireRate, canFire() |
| `RenderComponent` | Placeholder (Rendering via ThreeTilesEngine) |
| `AudioComponent` | Sound-Verwaltung |

---

## 3. Entity Types

### 3.1 Enemy

```typescript
class Enemy extends GameObject {
  readonly typeConfig: EnemyTypeConfig;

  // Components
  transform: TransformComponent;
  health: HealthComponent;
  render: RenderComponent;
  movement: MovementComponent;
  audio: AudioComponent;

  // Convenience
  get alive(): boolean;
  get position(): GeoPosition;
  startMoving(): void;
  stopMoving(): void;
}
```

### 3.2 Tower

```typescript
class Tower extends GameObject {
  readonly typeConfig: TowerTypeConfig;

  transform: TransformComponent;
  combat: CombatComponent;
  render: RenderComponent;

  selected = false;

  findTarget(enemies: Enemy[]): Enemy | null;
  select(): void;
  deselect(): void;
}
```

### 3.3 Projectile

```typescript
class Projectile extends GameObject {
  readonly typeConfig: ProjectileTypeConfig;
  readonly targetEnemy: Enemy;

  transform: TransformComponent;
  combat: CombatComponent;
  movement: MovementComponent;
  render: RenderComponent;

  updateTowardsTarget(deltaTime: number): boolean; // Returns true on hit
}
```

---

## 4. Manager System

> **Event-driven seit 2026-01-19:** Alle Manager kommunizieren via GameEventBus.
> Siehe [EVENT_SYSTEM.md](EVENT_SYSTEM.md) fuer Details.

### 4.1 GameStateManager (Orchestrator)

```typescript
@Injectable()  // Nur dieser Manager hat noch Angular DI
class GameStateManager {
  // Sub-Managers (manuell erstellt, nicht injected)
  readonly towerManager: TowerManager;
  readonly enemyManager: EnemyManager;
  readonly projectileManager: ProjectileManager;
  readonly waveManager: WaveManager;
  readonly researchManager: ResearchManager;

  // Event Bus
  private readonly eventBus = new GameEventBus();

  // Game State (Angular Signals fuer UI-Bindings, gehalten von BaseHealthLedger / CreditsLedger)
  readonly baseHealth: WritableSignal<number>;
  readonly credits: WritableSignal<number>;

  initialize(engine: ThreeTilesEngine, basePosition, spawnPoints, cachedPaths): void;
  update(currentTime: number, onSubStep?: (gameTimeStepMs: number) => void): void;  // Sub-Step-Loop, siehe Abschnitt 9
  reset(): void;
  dispose(): void;
  getEventBus(): GameEventBus;  // Fuer externe Subscriptions
}
```

Die `command:*`- und vier `debug:*`-Subscriptions liegen in `GameCommandsHandler`
(`managers/game-commands.handler.ts`). Der Handler sucht nur den Tower heraus und ruft die
öffentliche API des GameStateManager.

Seit 2026-09-13 hält der GameStateManager vier kleine Klassen aus `managers/game-state/`,
ohne Angular-DI, und delegiert an sie. Seine öffentliche API (`placeTower`, `sellTower`,
`spendCredits`, `credits`, `baseHealth` usw.) bleibt dieselbe:

| Klasse | Aufgabe |
|--------|---------|
| `GameClock` | Sub-Step-Takt: Wanduhr-Delta begrenzen, mit dem Timescale multiplizieren, Rest übertragen, Spielzeit führen (`FIXED_STEP_MS` und die Deckel) |
| `CreditsLedger` | `credits`-Signal; einzige Stelle, die bucht und `credits:changed` emittiert |
| `BaseHealthLedger` | `baseHealth`-Signal und Leck-Budget pro Welle; emittiert `health:changed` |
| `TowerLifecycle` | Bauen, Verkaufen, Upgraden (Prüfungen, Kosten, Tier-Gating, `tower:upgraded`), Range-Refresh, AA-Retrofit, Wachrichtung |

`update()`/`runSubStep()` und das Event-Wiring in `initialize()` bleiben im GameStateManager,
damit die Reihenfolge an einer Stelle steht. `game-state.manager.order.spec.ts` hält sie fest:
Aufrufe pro Sub-Step und pro Frame, Pause, Timescale 1 und 10, Listener-Reihenfolge, Tower-Befehle, `reset()`.

### 4.2 EnemyManager (Framework-agnostic)

```typescript
// Kein @Injectable - Constructor Injection
class EnemyManager extends EntityManager<Enemy> {
  constructor(eventBus: GameEventBus, routeGrid: GlobalRouteGridService, spatialGrid: SpatialGridService);

  spawn(path, typeId, speedOverride?, paused?, healthOverride?): Enemy;
  kill(enemy: Enemy, awardCredits?: boolean): boolean;  // Emittiert 'enemy:died'
  update(deltaTime: number, gameTimeMs: number): void;  // Emittiert 'enemy:reached-base'
  startAll(defaultDelayBetween?: number): void;
  getAlive(): Enemy[];
}
```

### 4.3 TowerManager (Framework-agnostic)

```typescript
// Kein @Injectable - Constructor Injection
class TowerManager extends EntityManager<Tower> {
  constructor(eventBus: GameEventBus, osmService: OsmStreetService, researchStore: ResearchStore);

  initialize(tilesEngine: ThreeTilesEngine): void;  // aus EntityManager
  placeTower(position: GeoPosition, typeId: TowerTypeId, customRotation?: number): Tower | null;  // Emittiert 'tower:placed'
  sell(tower: Tower): number;  // Emittiert 'tower:sold'
  selectTower(id: string | null): void;
  getSelected(): Tower | null;
}
```

Die Platzierungsregeln liegen nicht im TowerManager, sondern in `TowerPlacementService`
und `utils/tower-placement-rules.ts`.

### 4.4 ProjectileManager (Framework-agnostic)

```typescript
// Kein @Injectable - Constructor Injection
class ProjectileManager extends EntityManager<Projectile> {
  constructor(eventBus: GameEventBus);

  spawn(tower: Tower, targetEnemy: Enemy, heading?: number): Projectile;  // Emittiert 'vfx:muzzle-flash'
  update(deltaTime: number): void;  // Emittiert 'projectile:hit', 'vfx:projectile-impact', 'audio:play'
}
```

### 4.5 WaveManager (Framework-agnostic)

```typescript
// Kein @Injectable - Constructor Injection
class WaveManager implements IGameManager {
  constructor(eventBus: GameEventBus, enemyManager: EnemyManager);

  readonly phase = signal<GamePhase>('setup');
  readonly waveNumber = signal(0);

  initialize(spawnPoints, cachedPaths): void;
  startWave(config: WaveConfig): void;  // Emittiert 'wave:started'
  beginWave(): void;                    // Wave-Phase ohne Auto-Spawn, emittiert 'wave:started'
  tickSpawn(gameTimeDeltaMs: number): void;  // pro Sub-Step in der Wave-Phase
  checkWaveComplete(): boolean;
  endWave(): { wave; perfect; closeCall; hpLost };  // emitDeferred 'wave:completed'
  reset(): void;
}
```

### 4.6 ResearchManager (Framework-agnostic)

```typescript
// Kein @Injectable - Constructor Injection
class ResearchManager implements IGameManager {
  constructor(eventBus: GameEventBus);

  startResearch(id: ResearchId): boolean;  // Emittiert 'research:started'
  cancelResearch(id: ResearchId): number;  // Emittiert 'research:cancelled'
  update(stepMs: number): void;            // Tick für aktive Forschungen, emittiert 'research:progress' / 'research:completed'
}
```

Den Store-Zustand meldet der Manager als `research:state-changed`, `GameStateSyncService`
schreibt ihn in den `ResearchStore`.

ResearchEffects sind in `configs/research/research.types.ts` definiert und werden bei Completion an Tower- und Game-Systeme verteilt (z.B. unlockTowerType, multiplyDamage).

### 4.7 SpatialAudioManager

```typescript
// Framework-agnostic (kein @Injectable)
class SpatialAudioManager {
  // 3D Audio mit Sound-Budget-Verwaltung
  // Delegiert an AudioPoolManager, AudioBufferCache, SpatialAudioPlayback
  playAtGeo(soundId: string, lat: number, lon: number, height: number, volumeMultiplier?: number): Promise<PositionalAudio | null>;
  stopAll(): void;
}
```

**Sound Budget:** Maximal 12 gleichzeitige Enemy-Sounds, um Performance zu schonen.

---

## 5. Event-System

> **Vollstaendige Dokumentation:** [EVENT_SYSTEM.md](EVENT_SYSTEM.md)

Das Projekt verwendet einen **type-safe Event Bus** fuer lose Kopplung zwischen Komponenten.

### GameEventBus

```typescript
class GameEventBus {
  // Type-safe event emission
  emit(event: GameEvent): void;           // Immediate (blocking)
  emitDeferred(event: GameEvent): void;   // Queued bis processQueue()
  processQueue(): void;                    // Process deferred events (pro Sub-Step)

  // Subscriptions
  on<T extends GameEvent['type']>(type: T, handler: (event) => void): EventSubscription;
  off<T extends GameEvent['type']>(type: T, handler): void;
  onAny(handler: (event: GameEvent) => void): EventSubscription;  // Debug
  clear(): void;
}
```

Services und Manager sammeln ihre Subscriptions in einer `SubscriptionBag`
(`game-event-bus.ts`) und lösen sie in `dispose()`/`destroy()`.

### Event-Typen

| Kategorie | Events |
|-----------|--------|
| Enemy | `enemy:died`, `enemy:reached-base`, `enemy:spawned` |
| Tower | `tower:placed`, `tower:sold`, `tower:upgraded`, `tower:selected`, `tower:deselected`, `tower:kill` |
| Combat | `projectile:hit`, `dot:damage` |
| Wave | `wave:started`, `wave:completed` (mit `perfect`, `closeCall`, `hpLost`) |
| Game | `game:started`, `game:over`, `game:reset`, `health:changed`, `credits:changed` |
| Research | `research:started`, `research:progress`, `research:completed`, `research:cancelled`, `research:state-changed` |
| Effects | `vfx:blood`, `vfx:projectile-impact`, `vfx:muzzle-flash`, `vfx:chain-lightning`, `audio:play` |
| Debug | `debug:sound`, `debug:spawn-enemy`, `debug:kill-all`, `debug:start-custom-wave`, `debug:complete-all-research`, `debug:max-upgrade-all-towers`, `debug:add-credits`, `debug:add-health`, `debug:remove-enemy` |
| Commands | `command:place-tower`, `command:sell-tower`, `command:upgrade-tower`, `command:start-wave`, `command:restart-game`, `command:start-research`, `command:cancel-research` |

### Immediate vs Deferred

- **Immediate Events:** Game-kritisch, sofort verarbeitet (z.B. `enemy:died`, `projectile:hit`)
- **Deferred Events:** Nicht-kritisch, beim nächsten `processQueue()` verarbeitet (z.B. `vfx:*`, `audio:play`, `debug:sound`; außerdem `wave:completed`)

```typescript
// GameStateManager.runSubStep(stepMs), einmal pro Sub-Step
projectileManager.update(stepMs);          // Emits immediate + deferred
researchManager.update(stepMs);
eventBus.processQueue();                   // Process deferred at stable point
waveManager.tickSpawn(stepMs);             // nur in der Wave-Phase
enemyManager.update(stepMs, gameTimeMs);   // Emits immediate events
towerCombat.updateTowerShooting(...);      // + Beam/Melee/Chain, nur in der Wave-Phase oder mit Debug-Gegnern
```

---

## 6. Renderer System

Alle Renderer verwenden das `CoordinateSync` Interface für Geo-zu-Lokal Transformation:

```typescript
interface CoordinateSync {
  geoToLocal(lat: number, lon: number, height: number): THREE.Vector3;
  geoToLocalSimple(lat: number, lon: number, height: number): THREE.Vector3;
  geoToLocalSimpleInto(lat: number, lon: number, height: number, target: THREE.Vector3): THREE.Vector3;
  localToGeo?(vec: THREE.Vector3): { lat: number; lon: number; height: number };
}
```

### 6.1 InstancedEnemyRenderer

```typescript
class InstancedEnemyRenderer {
  constructor(scene: THREE.Scene, sync: CoordinateSync, assetManager: AssetManagerService);

  preloadModel(typeId: EnemyTypeId): Promise<void>;
  create(id, typeId, lat, lon, height): Promise<EnemyRenderData | null>;
  updateSlot(slot, localPos, heading, healthPercent, currentSpeed): void;
  startWalkAnimation(id: string): void;
  startRunAnimation(id: string): void;     // nur Clip, die Geschwindigkeit ist Simulation (Enemy.rush)
  playDeathAnimation(id: string): void;
  updateAnimations(deltaTime: number, camera: Camera): void;  // pro Frame, in Spielzeit
  remove(id: string): void;
}
```

#### Animation Speed Coupling

Gegner-Animationen sind automatisch an ihre Bewegungsgeschwindigkeit gekoppelt:

```typescript
// EnemyInstanceManager.updateEnemyState() (instanced-enemy/enemy-instance.manager.ts)
let effectiveBaseSpeed = config.baseSpeed;
if (!state.isWalking && config.runSpeedMultiplier) effectiveBaseSpeed *= config.runSpeedMultiplier;
state.speedMultiplier = currentSpeed / effectiveBaseSpeed;

// beim Animations-Update
state.animTime += deltaTime * state.animSpeed * state.speedMultiplier;
```

**Effekt:** Schnellere Bewegung → Schnellere Animation (natürliche Laufbewegung)

**Details:** Siehe [ENEMY_CREATION.md → Animation Speed Coupling](ENEMY_CREATION.md#animation-speed-coupling)

#### Run Animation System

Manche Enemies wechseln zwischen Walk- und Run-Animation:

```typescript
animationVariation: true,     // Walk/Run Variation aktiviert
runSpeedMultiplier: 2.5,      // 2.5× Speed bei Run-Animation
```

**Effekt:** Alle 3-8 s Spielzeit Wechsel zwischen Gehen und Rennen; rennend bewegt sich der Enemy 2.5× schneller (Animation bleibt gleich schnell, da Run-Animation bereits schneller im Modell ist). Der Wechsel ist Simulationszustand (`Enemy.rush`, Sub-Step, deterministisch aus der Enemy-ID), der Renderer zeigt nur den Clip.

**Details:** Siehe [ENEMY_CREATION.md → Run-Animation-System](ENEMY_CREATION.md#run-animation-system-animation-variation)

### 6.2 ThreeTowerRenderer

```typescript
class ThreeTowerRenderer {
  constructor(scene: THREE.Scene, sync: CoordinateSync, assetManager: AssetManagerService);

  preloadModel(typeId: TowerTypeId): Promise<void>;
  create(id, typeId, lat, lon, height, customRotation?, initialHeading?): Promise<TowerRenderData | null>;
  advanceTurretAim(gameTimeStepMs: number): void;  // pro Sub-Step, aus GameLoopFacadeService
  setIdleHeading(id: string, heading: number): void;  // Guard-Richtung nach der Wave
  select(id: string): void;
  deselect(id: string): void;
  remove(id: string): void;
}
```

### 6.3 ThreeProjectileRenderer

```typescript
class ThreeProjectileRenderer {
  constructor(scene: THREE.Scene, sync: CoordinateSync);

  create(id, typeId, startLat, startLon, startHeight, direction: { dx; dy; dz }): void;
  update(id, lat, lon, height): void;
  updateWithRotation(id, lat, lon, height, direction: { dx; dy; dz }): void;
  commitToGPU(): void;  // einmal pro Frame aus ThreeTilesEngine.update()
  remove(id: string): void;
}
```

### 6.4 Spezialisierte Renderer

Neben Tower-, Projektil- und Effects-Renderer gibt es mehrere spezialisierte Renderer:

| Renderer | Datei | Zweck |
|----------|-------|-------|
| **InstancedEnemyRenderer** | `renderers/instanced-enemy/` | GPU-instancing fuer Enemies via VAT (Vertex Animation Textures) — siehe [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md) |
| **DecalInstanceManager** | `renderers/decal-instance.manager.ts` | Blut-, Eis- und Scorch-Decals (`scorch-marks.ts`) als InstancedMesh mit Free-List-Pool |
| **ThreeFlameBeamRenderer** | `renderers/three-flame-beam.renderer.ts` | Fire-Tower-Beam (animierter Flammen-Kegel) |
| **ThreeTentacleRenderer** | `renderers/three-tentacle.renderer.ts` | Bezier-basierte Tentakel fuer Tentacle-Tower |
| **LightningBoltRenderer** | `renderers/lightning-bolt.renderer.ts` | Chain-Bolts, Idle-Crackle, Impact-Halos (Lightning Tower) |
| **TrailStreakRenderer** | `renderers/trail-streak.renderer.ts` | Projektil-Trails als gestreckte Quads |
| **FloatingTextInstanceManager** | `renderers/floating-text/` | GPU-instanzierte Schadenszahlen über Enemies, Atlas in `floating-text-atlas.ts` |
| **MarkerInstanceManager** / **SpawnPortalManager** / **MarkerLabelManager** | `renderers/marker/` | HQ-Diamant, Spawn-Portale, Range-Discs, Labels |
| **SpriteAtlasGenerator** | `renderers/sprite-atlas-generator.ts` | Canvas2D-Atlas mit Animations-Frames (z. B. Explosion) für die Partikel-Pools (`ParticlePoolManager`) |

Der klassische `ThreeEnemyRenderer` (GLTF + AnimationMixer pro Enemy) wurde entfernt
(2bbf91f), Enemies laufen nur noch über den InstancedEnemyRenderer.

### 6.5 ThreeEffectsRenderer

```typescript
class ThreeEffectsRenderer {
  constructor(scene: THREE.Scene, sync: CoordinateSync);

  // Blood effects
  spawnBloodSplatter(lat, lon, height, count?): string;  // Particle splatter
  spawnBloodDecal(lat, lon, height, size?): string;      // Persistent ground stain

  // Fire effects
  spawnFire(lat, lon, height, intensity): string;
  stopFire(id: string): void;
  stopAllFires(): void;

  update(deltaTime: number): void;
  clear(): void;
  dispose(): void;
}
```

**Architektur (Stand 2026-05-21):** `ThreeEffectsRenderer` ist eine duenne
Delegations-Facade — die Konsumenten-API (`tilesEngine.effects.*`) bleibt stabil,
die Implementierung liegt in fokussierten Modulen: `ParticlePoolManager`
(GPU-Pools, Free-Lists, Buffer-Caches, Atlas), `ParticleEffectsRenderer`
(Blood/Fire/Explosion/Smoke/Trails + `activeEffects`-Lifecycle, dazu die Decal-Pools für
Blut, Eis und Scorch Marks), `EnvironmentEffectsRenderer` (HQ-Explosion, Fire-Flash,
Tower-Inner-Fire), `AuraRenderer` (Frost-/Poison-Auren), `FloatingTextInstanceManager`
(Schadenszahlen) und `particle-shaders.ts` (GLSL).

---

## 7. Type Configuration

### Tower Types

```typescript
const TOWER_TYPES: Record<TowerTypeId, TowerTypeConfig> = {
  archer: {
    id: 'archer',
    name: 'Archer Tower',
    modelUrl: 'assets/models/towers/archer.glb',
    scale: 10.1,
    damage: 25,
    range: 30,
    fireRate: 1,
    projectileType: 'arrow',
    cost: 45,
    // ... (Auszug)
  },
  cannon: { /* ... */ },
  magic: { /* ... */ },
  // ... weitere: dual-gatling, rocket, ice, fire, tentacle, poison, lightning, chaos, research-center
};
```

### Enemy Types

```typescript
const ENEMY_TYPES: Record<EnemyTypeId, EnemyTypeConfig> = {
  zombie: {
    id: 'zombie',
    name: 'Zombie',
    modelUrl: 'assets/models/enemies/zombie.glb',
    baseHp: 80,
    baseSpeed: 5,
    scale: 0.984,
    hasAnimations: true,
    walkAnimation: 'Armature|Walk',
    deathAnimation: 'Armature|Die',
  },
  tank: { /* ... */ },
};
```

---

## 8. Koordinatensystem

### Mit ReorientationPlugin (recenter: true)

Tiles werden auf den Origin (HQ) zentriert. Lokale Koordinaten in Metern:

```
X = East/West Offset (-X = East, +X = West)
Y = Höhe (absolut in Scene-Koordinaten)
Z = North/South Offset (+Z = North, -Z = South)
```

### EllipsoidSync

```typescript
class EllipsoidSync {
  // WGS84 → Lokale Koordinaten (Meter)
  geoToLocal(lat, lon, height): THREE.Vector3;
  geoToLocalSimple(lat, lon, height): THREE.Vector3;

  // Lokale Koordinaten → WGS84
  localToGeo(vec: THREE.Vector3): { lat, lon, height };

  // Entfernung vom Origin
  distanceFromOrigin(lat, lon): number;

  // Heading-Berechnung
  calculateHeading(fromLat, fromLon, toLat, toLon): number;
}
```

### 8.1 Geo-Distance Utilities

**Datei:** `utils/geo-utils.ts`

Zentralisierte Distanzberechnungen zwischen geografischen Koordinaten. Früher 5x dupliziert in enemy.manager, tower.manager, game-state.manager, projectile.entity, movement.component.

#### haversineDistance() - Präzise, teuer

```typescript
haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number
```

**Verwendung:**
- Präzise Berechnung für **beliebige Distanzen** auf der Erdkugel
- Verwendet Trigonometrie (sin, cos, atan2)
- **Performance:** ~100-200 ns pro Aufruf (langsam)

**Wann verwenden:**
- Initialberechnung (Spawn-Point zu Base)
- Einmalige Operationen (Location-Validierung)
- Große Distanzen (>200m)

**Beispiel:**
```typescript
// Spawn-Point 500m von Base entfernt?
const distance = haversineDistance(
  spawnLat, spawnLon,
  baseLat, baseLon
);
if (distance < 500) {
  console.warn('Spawn zu nah an Base');
}
```

#### fastDistance() - Schnell, ungenau bei Distanz

```typescript
fastDistance(lat1: number, lon1: number, lat2: number, lon2: number): number
```

**Verwendung:**
- **Flat-Earth Approximation** (kein Haversine)
- Nur Multiplikation und sqrt, kein sin/cos
- **Performance:** ~20-30 ns pro Aufruf (10x schneller!)
- **Genauigkeit:** <1% Fehler bei Distanzen <200m

**Wann verwenden:**
- **Hot-Path:** In Update-Loops (jeden Frame)
- Lokale Berechnungen (<200m)
- Range-Checks (Enemy in Reichweite?)

**Beispiel:**
```typescript
// Enemy-Manager Update Loop (JEDEN FRAME!)
for (const enemy of enemies) {
  const dist = fastDistance(
    enemy.position.lat, enemy.position.lon,
    tower.position.lat, tower.position.lon
  );
  if (dist < tower.combat.range) {
    // In Reichweite!
  }
}
```

#### geoDistance() - Convenience Wrapper

```typescript
geoDistance(
  pos1: { lat: number; lon: number },
  pos2: { lat: number; lon: number }
): number
```

Wrapper für `haversineDistance` mit Objekt-Syntax statt 4 Parametern.

**Beispiel:**
```typescript
const dist = geoDistance(enemy.position, tower.position);
```

#### Performance-Vergleich

| Methode | Ns/Aufruf | Relativ | Use Case |
|---------|-----------|---------|----------|
| `fastDistance()` | ~25 ns | 1x (Basis) | Hot-Path, <200m |
| `haversineDistance()` | ~180 ns | 7x langsamer | Einmalig, >200m |

**WICHTIG:** In einem Frame mit 100 Enemies × 10 Towers = 1000 Distanzberechnungen:
- `fastDistance`: 1000 × 25ns = **25 µs**
- `haversineDistance`: 1000 × 180ns = **180 µs** (7x langsamer!)

Außerdem: `geoDistanceFast()` (Objekt-Wrapper um `fastDistance`) sowie
`fastDistanceSq()`/`geoDistanceFastSq()` für Vergleiche ohne `sqrt`.

#### Stand der Migration zu fastDistance

Erledigt (DONE.md, „Fast-Distance statt Haversine"). EnemyManager, TowerManager und
GameStateManager rufen keine Distanzfunktion aus `geo-utils` mehr direkt auf, Umkreis-Abfragen
laufen über `GlobalRouteGrid.getEnemiesInRadius()`. `haversineDistance`/`geoDistance`
nutzen noch Location-, OSM-, Pfad- und Platzierungscode sowie der Pathfinding-Worker.

---

## 9. Render Pipeline

**Design-Prinzip:** Der Game Loop läuft IMMER. Die Phase kontrolliert WAS passiert, nicht OB der Loop läuft.

```typescript
// RenderLoop.start() (render-loop.ts, engine.renderLoop) - rAF-Loop
const animate = (currentTime: number) => {
  if (heartbeatWorker) return requestAnimationFrame(animate);                    // Worker-Takt hat die Uhr
  if (!framePacer.shouldRun(currentTime)) return requestAnimationFrame(animate); // Frame-Cap
  hooks.update(currentTime - lastLoopTime);  // engine.update(): zuerst onUpdateCallback, dann Visuals
  hooks.render();                            // engine.render()
  requestAnimationFrame(animate);
};

// GameLoopFacadeService.onEngineUpdate(deltaTime) - der onUpdateCallback
function onEngineUpdate(deltaTime: number) {
  // pro Frame: Build-Preview-Rotation, Street-Batches, Keyboard-Pan, Marker, Route-Animation, Intro-Flug
  gameState.update(performance.now(), (stepMs) => {
    tilesEngine.towers.advanceTurretAim(stepMs);             // pro Sub-Step, Spielzeit
    if (botEnabled) trainingClient.updateBot(snapshot, stepMs);
  });
  // danach: Profiler, Route-Grid-Viz, LOS-Viz-Puls, UI-Stats (~10 Hz)
}
```

`ThreeTilesEngine.update()` ruft `onUpdateCallback` auch bei abgeschaltetem Rendering
(Headless-Training); Enemy-Animation, Tower-Visuals, Projektil-Upload und Effekte laufen
danach nur mit Rendering.

**Sub-Steps:** `GameStateManager.update()` überlässt die Zeitrechnung `GameClock`
(`managers/game-state/game-clock.ts`): `beginFrame()` begrenzt das Wanduhr-Delta auf
`MAX_CATCHUP_MS` (50) und multipliziert es mit dem Training-Timescale, `nextSubStep()` gibt
die Spielzeit in festen Sub-Steps von `FIXED_STEP_MS` (16,667 ms) frei, höchstens
`MAX_SUBSTEPS_PER_FRAME` (600) pro Frame, und `endFrame()` trägt den Rest in den nächsten
Frame, gedeckelt auf 600 Sub-Steps plus `MAX_REMAINDER_MS` (2000). Jeder Sub-Step läuft durch `runSubStep()`
(Reihenfolge in Abschnitt 5), danach prüft die Schleife Wave-Ende und Game Over. Nach der
Schleife gibt `presentFrame()` den Enemy- und Projektil-Zustand einmal an den Renderer, wenn
mindestens ein Sub-Step lief und Rendering an ist. Oberhalb von 60 fps läuft deshalb nicht
in jedem Frame ein Sub-Step.

**Hintergrund-Tab (nur Training):** Mit `setBackgroundLoopEnabled(true)` ruft bei
verstecktem Tab ein Worker-Takt (`workers/heartbeat.worker.ts`, 16 ms) `update()` ohne
`render()` auf, mit höchstens 50 ms pro Tick (`MAX_BACKGROUND_STEP_MS`). Solange der Worker
läuft, steppt der rAF-Loop die Simulation nicht.

**Frame-Cap (60 / 30 / unbegrenzt):** Spieler-Einstellung im Display-Menü der
Quick-Actions, persistiert von `DebugFacadeService` als `fpsLimit` in
`td_display_options` (`utils/display-options.storage.ts`; bis 2026-09-12 unter
eigenem Schlüssel `3dtd-fps-limit`, der beim Laden übernommen wird).
`engine.renderLoop.setFpsLimit()` (`three-engine/render-loop.ts`) gibt sie an einen `FramePacer`
(`utils/frame-pacer.ts`), der zu frühe rAF-Callbacks komplett überspringt,
Update eingeschlossen. Der Anker rückt pro gelaufenem Frame um genau ein
Intervall vor, so bleibt z. B. 50 auf 60 Hz bei 50 statt auf 30 zu fallen;
ein halbes Intervall Toleranz fängt rAF-Jitter ab, und auf einem Display, das
langsamer als der Cap ist (59,94 Hz bei Cap 60), läuft jeder Frame. Ein Frame,
der mehr als ein halbes Intervall zu spät kommt (erster Frame, Stall,
Tab-Wechsel), setzt die Phase 3/8 Intervall vor sich neu; bei Refreshraten vom
Ein- bis Vierfachen des Caps liegt dann kein Vsync auf der Schwelle, sonst
würde Jitter kurze und lange Abstände abwechseln lassen. Die
Simulation rechnet mit dem Wanduhr-Delta zwischen den gelaufenen Frames: bei
30 fps sind das ~33 ms, unter `MAX_CATCHUP_MS` (50) in `GameClock`,
also volle Spielgeschwindigkeit, auch bei Training-Timescales. Standard ist
unbegrenzt, der Loop verhält sich dann wie ohne Cap.

**Pause:** `GameStore.paused` (Pause-Button neben dem Game-Speed), gespiegelt
in `GameStateManager.paused`. Pausiert läuft kein Sub-Step: Spawns, Kampf,
Projektile, Status-Effekte, Forschung und Bot-Ticks stehen, die Game-Clock
auch. `update()` merkt sich trotzdem die Wanduhr, damit der erste Frame nach
der Pause nichts nachholt, und setzt die Renderer-Timescale auf 0, damit die
Laufanimationen mit ihren Gegnern stehen bleiben. Rendering, Kamera, Partikel
und UI laufen weiter. Die Timescale (Untergrenze 0,1) bleibt unberührt, beim
Fortsetzen gilt wieder die gewählte Geschwindigkeit. Ein Neustart hebt die
Pause auf (`resetGameState`).

**Update-Matrix nach Phase** (pro Sub-Step, `runSubStep`, pausiert läuft keiner):
| System | setup | wave | gameover |
|--------|-------|------|----------|
| Projektile, Forschung, Event-Queue | ✓ | ✓ | ✓ |
| Enemy-Update (Bewegung, laufende Tode) | ✓ | ✓ | ✓ |
| Spawns (`tickSpawn`) | - | ✓ | - |
| Tower-Schießen (Projektil, Beam, Melee, Chain) | nur mit Debug-Gegnern | ✓ | nur mit Debug-Gegnern |

`triggerGameOver()` leert die Enemies. Nach `wave:completed` drehen die Tower auf ihre
Guard-Richtung (`TowerCombatService.turnTowersToGuard`), in der Wave behalten sie die
Richtung des letzten Ziels. Der Idle-Spin des Magic-Towers ohne Ziel ist rein visuell
(`ThreeTowerRenderer.updateAnimations`).

---

## 10. Dateistruktur

```
src/app/
├── app.ts, app.config.ts, app.routes.ts  # Root-Component, Provider, Routing
├── tower-defense.component.ts    # Haupt-Component (~810 Zeilen)
├── tower-defense.component.html  # Template, Debug-Fenster in einem @defer-Block
├── tower-defense.component.scss
│
├── ai/                           # Wave Director, Bot System, Training Hooks
│   ├── core/
│   │   ├── rule-director.ts      # Regel-Director (Default): Template + 4 Formfaktoren
│   │   ├── gate-controller.ts    # Regelkreis fuer den Fairness-Cap (Leak-Quote)
│   │   ├── wave-director.service.ts  # Einstieg getNextWave, Regeln oder optionaler ONNX-Pfad
│   │   ├── wave-config-builder.ts    # buildWaveConfig: Entscheidung → Welle (beide Directors)
│   │   ├── onnx-policy.ts        # ONNX-Runtime + Session, decodeModelOutput
│   │   ├── templates.ts          # Template-Tabelle, Mask, fairMaxCount
│   │   ├── wave-context.ts       # Mask + Ranges + Fairness-Headroom (Encoder/Decoder-Sync)
│   │   ├── wave-config-adapter.ts# AIWaveConfig → WaveConfig (SpawnSchedule)
│   │   ├── ai-data-collector.service.ts # Snapshots, Wave-History, onWaveResult-Hook
│   │   └── ...                   # Encoder, Defense-Analyzer, DPS-Profil, Explainer
│   └── training/                 # Bots (Strategy Pattern), Strategies, TrainingClient
│
├── services/                     # Angular Services — vollstaendige Liste oben unter "Verzeichnisstruktur"
│   ├── (Root)                    # economy, tower-placement, camera-*, keyboard-pan, input-handler
│   ├── combat/                   # Tower-Combat, Damage-Application, Status-Effect, Combat-Effect/Vfx, HQ-Damage
│   ├── debug/                    # Debug-Facade + Wave/Tower/Enemy/Sound/LOS-Debug, Performance-Profiler, Debug-Window, State-Dump
│   ├── facade/                   # TowerDefense/GameLoop/Visualization/Location-Facades
│   ├── infrastructure/           # Asset-Manager, EngineInit, GameStateSync, ModelPreview
│   ├── location/                 # Geocoding, Geolocation, OsmStreet, PathfindingWorker, etc.
│   └── world/                    # Marker, Path/Route, Grid (Global/Spatial), Height, Streets, Buildings, Intro-Kamerafahrt, CorridorRefit
│
├── managers/                     # Manager-Dateien (event-driven, Angular-frei)
│   ├── entity-manager.ts         # Base class
│   ├── game-state.manager.ts     # Orchestrator: Game-Loop, Event-Wiring, subManagers[] + dispose()
│   ├── game-state/               # Vom GSM gehalten: GameClock, CreditsLedger, BaseHealthLedger, TowerLifecycle, summarizeWaveGroups
│   ├── game-commands.handler.ts  # Routing der `command:*`- und vier `debug:*`-Events (extrahiert aus GSM, 2026-05-10)
│   ├── enemy.manager.ts          # Enemy Lifecycle
│   ├── tower.manager.ts          # Tower Lifecycle
│   ├── projectile.manager.ts     # Projectile Lifecycle
│   ├── wave.manager.ts           # Wave Management (templates, mixed waves)
│   ├── research.manager.ts       # Forschungs-System (Effects, Tick) — emittiert `research:state-changed`
│   └── audio/                    # Audio-Subsystem
│       ├── spatial-audio.manager.ts    # 3D Audio Manager
│       ├── spatial-audio-playback.ts   # Playback-Logik
│       ├── audio-buffer-cache.ts       # LRU Buffer Cache
│       └── audio-pool.manager.ts       # Audio Pool
│
├── game-engine/                  # Framework-agnostic Engine-Services
│   ├── index.ts
│   ├── game-event-bus.ts         # Event Bus + GameEvent Union + SubscriptionBag
│   ├── vfx.service.ts            # VFX Event Handler
│   ├── audio.service.ts          # Audio Event Handler
│   ├── background-music.service.ts
│   ├── screen-shake.service.ts   # Event Handler, Hüllkurve in three-engine/screen-shake.ts
│   └── game-manager.interface.ts # IGameManager
│
├── three-engine/                 # Three.js Engine
│   ├── three-tiles-engine.ts     # Haupt-Engine: Scene, Renderer, TilesRenderer, Frame-Ablauf
│   ├── camera-rig.ts             # Controls + Startposition der Kamera (seit 2026-09-11)
│   ├── tile-loading-tracker.ts   # Erster Tile-Load, Retry, Auth-Fehler, Tile-Stats (seit 2026-09-11)
│   ├── render-loop.ts            # rAF-Loop, FPS-Cap, Heartbeat für versteckte Tabs (seit 2026-09-13)
│   ├── terrain-queries.ts        # Boden-, Freiraum- und LOS-Raycasts mit Säulen-Cache (seit 2026-09-13)
│   ├── scene-environment.ts      # Statische Lichter + Himmel (seit 2026-09-13)
│   ├── column-sample.ts          # Was eine senkrechte Terrain-Probe getroffen hat (ohne Three.js)
│   ├── route-corridor-region.ts  # Load-Region, hält den Routen-Korridor auf feinem LOD
│   ├── tower-shadow-mapper.ts    # Tiefen-Cubemap vom Tower-Tip (GPU-LOS)
│   ├── screen-shake.ts           # Shake-Hüllkurve in Wanduhr-Zeit
│   ├── screen-shake-benchmark.ts
│   ├── scene-warmup.ts           # Warm-up beim Laden (Shader, leere Pools)
│   ├── vfx-settings.ts           # Abschaltbare Effekte (Display-Menü)
│   ├── tile-material-log.ts      # Diagnose: welche Materialien Szenenlichter rechnen
│   ├── screen-picker.ts          # Boden und Tower unter dem Mauszeiger (seit 2026-09-13)
│   ├── tiles-renderer-setup.ts   # TilesRenderer-Aufbau + Streaming-Budget (seit 2026-09-13)
│   ├── ellipsoid-sync.ts         # Koordinaten
│   ├── index.ts                  # Exports
│   ├── post-processing/          # Bloom + Color Grading (eigene Pipeline-Klasse seit 2026-05-10)
│   │   ├── post-processing-pipeline.ts
│   │   └── color-grading.ts
│   └── renderers/
│       ├── index.ts              # CoordinateSync Interface
│       ├── three-tower.renderer.ts
│       ├── three-projectile.renderer.ts
│       ├── three-effects.renderer.ts        # Fassade über die Effekt-Module (Abschnitt 6.5)
│       ├── particle-pool-manager.ts
│       ├── particle-effects-renderer.ts
│       ├── particle-shaders.ts
│       ├── environment-effects-renderer.ts
│       ├── aura-renderer.ts
│       ├── scorch-marks.ts
│       ├── three-flame-beam.renderer.ts
│       ├── three-tentacle.renderer.ts
│       ├── lightning-bolt.renderer.ts       # Chain-Bolts + Idle-Crackle + Impact-Halos (Lightning Tower)
│       ├── lightning-bolt-shaders.ts
│       ├── trail-streak.renderer.ts
│       ├── decal-instance.manager.ts
│       ├── decal-shaders.ts
│       ├── magic-orb-shaders.ts
│       ├── tentacle-shaders.ts
│       ├── sprite-atlas-generator.ts
│       ├── draw-gate.ts          # Leere Pools aus der Render-Liste nehmen
│       ├── instance-slot-allocator.ts # Update-Ranges pro Instanz-Slot
│       ├── instanced-enemy/      # VAT-instanced enemy renderer
│       ├── floating-text/        # GPU-instanzierte Schadenszahlen
│       └── marker/               # HQ-Marker, Spawn-Portale, Range-Discs
│
├── devworld/                     # DevWorld Offline-Entwicklungsumgebung
│
├── entities/
│   ├── enemy.entity.ts
│   ├── enemy-rush.ts             # Gehen/Rennen-Wechsel als Simulationszustand
│   ├── tower.entity.ts
│   ├── tower-targeting.util.ts
│   └── projectile.entity.ts
│
├── game-components/
│   ├── transform.component.ts
│   ├── health.component.ts
│   ├── movement.component.ts
│   ├── combat.component.ts
│   ├── render.component.ts
│   └── audio.component.ts
│
├── core/
│   ├── game-object.ts
│   ├── component.ts
│   └── services/config.service.ts
│
├── store/                        # Signal Stores (Single Source of Truth)
│   ├── tower-defense.store.ts    # Root-Store (Aggregat-Fassade)
│   ├── tower-defense.store.types.ts
│   ├── game.store.ts             # Game State (credits, health, phase, wave)
│   ├── ui.store.ts               # UI State (toggles, build mode, persistence)
│   ├── engine.store.ts           # Engine Stats (fps, tiles, camera, loading)
│   ├── location.store.ts         # Location (coords, spawns, streets)
│   ├── research.store.ts         # Research-State (active, completed, locks)
│   └── debug.store.ts            # Wave/Tower/Enemy-Debug-State
│
├── configs/
│   ├── tower-types.config.ts
│   ├── enemy-types.config.ts     # (2026-05-10 aus models/ migriert)
│   ├── projectile-types.config.ts
│   ├── visual-effects.config.ts
│   ├── audio.config.ts
│   ├── background-music.config.ts
│   ├── attributions.config.ts
│   ├── combat-tuning.config.ts
│   ├── game-balance.config.ts
│   ├── los-viz.config.ts         # LOS_VIZ_CONFIG (Farben der LOS- und Grid-Visualisierung)
│   ├── map-constants.config.ts
│   ├── marker-geometry.config.ts
│   ├── placement.config.ts
│   ├── timing.config.ts
│   ├── wave-curriculum.config.ts # (2026-05-10 aus ai/core/ migriert)
│   ├── combat/                   # damage-matrix.config, combat.types, combat-ui.config
│   └── research/                 # research-tree.config, research-center.config, research.types
│
├── models/
│   ├── game.types.ts
│   ├── location.types.ts
│   └── status-effects.ts
│   # (enemy-types.ts ist 2026-05-10 nach configs/enemy-types.config.ts umgezogen)
│
├── styles/
│   └── td-theme.ts               # Theme-Konstanten + CSS-Vars
│
├── utils/                        # Reine Hilfsmodule (Auswahl)
│   ├── geo-utils.ts              # Haversine, Fast Distance
│   ├── global-route-grid.ts      # GlobalRouteGrid, dazu route-cell*.ts, route-grid-*.ts (Abschnitt 11)
│   ├── route-corridor.ts         # Korridorbreite pro Seite, siehe ROUTE_CORRIDOR.md
│   ├── tower-los-viz.ts          # TowerLosViz, mit tower-los-layer-builder.ts und gpu-cube-resolve.ts (GPU-LOS)
│   ├── tower-placement-rules.ts
│   ├── display-options.storage.ts # td_display_options
│   ├── frame-pacer.ts            # Frame-Cap
│   ├── damage-calculator.ts
│   ├── flight-*.ts, camera-*.ts  # Intro-Kamerafahrt, Kamera-Framing, Kamera-Timeline
│   └── ...                       # raycast-stats, los-perf, route-ways, route-path.util, enemy-aim.util, ...
│
├── workers/
│   ├── pathfinding.worker.ts     # A*-Pathfinding
│   └── heartbeat.worker.ts       # Takt für den Game Loop im versteckten Tab (Training)
│
├── interfaces/                   # Provider-Interfaces für Straßennetz und Terrain (IGameManager liegt in game-engine/)
│
├── integration/                  # Cross-Manager Integration Tests
│
└── components/
    ├── address-autocomplete.component.ts
    ├── attributions-dialog/
    ├── compass/
    ├── context-hint/
    ├── damage-matrix-dialog/
    ├── debug-window/             # Debug-Fenster; debug-windows.ts bündelt sie zu einem Lazy-Chunk
    ├── engine-test/
    ├── game-header/
    ├── game-sidebar/             # Rahmen + Footer; wave-, build-, tower-, research-panel/, sidebar-tooltips.ts
    ├── game-speed/
    ├── icon/                     # Inline-SVG-Icons
    ├── info-overlay/
    ├── intro-skip/               # Überspringen der Intro-Kamerafahrt
    ├── loading-screen/
    ├── location-dialog/          # Location-Auswahl Dialog
    ├── los-legend/               # Legende der LOS-Coverage
    ├── quick-actions/
    ├── token-setup/              # Erststart: eigene Tile-Credentials
    └── tooltip/                  # Rich-Tooltip-Direktive

docs/                              # siehe INDEX.md
```

---

## 11. Visual Effects & Features

### Blood Decal System

**Dateien:** `three-engine/renderers/particle-effects-renderer.ts` (Spawning),
`decal-instance.manager.ts` (InstancedMesh-Pool), `decal-shaders.ts`; öffentliche API über
`ThreeEffectsRenderer`

Blutflecken auf dem Boden nach Enemy-Deaths. Verwendet **Instanced Rendering** für Performance.

#### Technische Implementierung

```typescript
// GroundDecals (ground-decals.ts), gehört ParticleEffectsRenderer:
// je ein DecalInstanceManager (InstancedMesh + Custom Shader)
readonly blood: DecalInstanceManager;
readonly ice: DecalInstanceManager;
// dazu ScorchMarks (scorch-marks.ts), höchstens eine Marke pro Route-Cell
readonly scorch: ScorchMarks;

spawnBloodDecal(lat: number, lon: number, height: number, size?: number): string;
spawnIceDecal(lat: number, lon: number, height: number, size?: number): string;
```

**Rendering:**
- **InstancedMesh** statt einzelner Meshes: ein Draw Call pro Pool
- Je ein Pool für Blood (rot), Ice (hell-cyan) und Scorch Marks
- Decals verblassen nach `fadeDelay` über `fadeDuration`; ist ein Pool voll, wird der
  älteste Decal entfernt
- Sind die Bodenmarken in den VFX-Settings aus (`groundMarks`), entsteht kein Blut-Decal

**Shader-Features** (`decal-shaders.ts`):
```glsl
// Per-Instance-Attribute statt Uniforms
attribute vec3 instanceColor;      // Decal-Farbe
attribute float instanceOpacity;   // Transparenz, der Fade läuft von hier auf 0
attribute float instanceVariation; // Zufallsvariation für das Muster
// + logdepthbuf-Chunks für korrekte Verdeckung mit den 3D Tiles
```

**Konfiguration:** `configs/visual-effects.config.ts`

```typescript
export const BLOOD_DECAL_CONFIG = {
  maxDecals: 100,
  fadeDelay: 20000,      // ms before fade starts
  fadeDuration: 10000,   // ms fade duration
  baseOpacity: 0.7,
  baseColor: { r: 0.55, g: 0, b: 0 },  // Dark red
  colorVariation: 0.2,
  heightOffset: 0.12,
};

export const ICE_DECAL_CONFIG = {
  maxDecals: 150,
  fadeDelay: 4000,
  fadeDuration: 3000,
  baseOpacity: 0.6,
  baseColor: { r: 0.75, g: 0.94, b: 1.0 },  // Light cyan
  colorVariation: 0.1,
  heightOffset: 0.12,
};
```

**Automatisches Spawning:**
- Blood: Bei Enemy-Death mit `canBleed: true`
- Ice: Bei Ice Tower Hit (Splash-Effekt)

**Performance:**
- 100 Blood + 150 Ice Decals = **2 Draw Calls** (statt 250!)
- Keine Performance-Impact bei vielen Decals

### Fire Effects

**Dateien:** `three-engine/renderers/three-effects.renderer.ts` (Fassade), `particle-effects-renderer.ts`

Feuer-Effekte bei HQ-Damage und Game Over, als Partikel.

#### Technische Implementierung

```typescript
spawnFire(lat: number, lon: number, height: number, intensity: FireIntensityLevel): string;
spawnFireOnTerrain(lat: number, lon: number, getHeight: Function, intensity: FireIntensityLevel): string;
spawnFireAtLocalY(lat: number, lon: number, localY: number, intensity: FireIntensityLevel): string;

type FireIntensityLevel = keyof typeof FIRE_INTENSITY; // 'tiny' | 'small' | 'medium' | 'large' | 'inferno'
```

**Intensitätsstufen** (`FIRE_INTENSITY` in `configs/visual-effects.config.ts`, jedes Feuer brennt bis `stopFire()`):

| Intensity | Partikel | Radius |
|-----------|----------|--------|
| `tiny` | 15 | 1,5 m |
| `small` | 40 | 2,5 m |
| `medium` | 80 | 4 m |
| `large` | 120 | 6 m |
| `inferno` | 200 | 10 m |

**Komponenten:**

1. **Partikel-Emitter** (Additive Blending)
   - Flammen-Partikel (orange/gelb)
   - Rauch-Partikel (grau)
   - Aufwärtsbewegung mit Turbulenz

Ein Licht oder einen eigenen Loop-Sound erzeugt `spawnFire()` nicht.

**Lifecycle:**

```typescript
// 1. Spawn
const fireId = engine.effects.spawnFire(lat, lon, height, 'large');

// 2. Update Loop (intern)
// - Partikel bewegen sich nach oben
// - Neue Partikel spawnen
// - Alte Partikel faden out

// 3. Cleanup
engine.effects.stopFire(fireId);     // Einzelnes Feuer
engine.effects.stopAllFires();       // Alle Feuer
```

**Automatisches Spawning** (`HQDamageService`):
- HP über `GAME_BALANCE.fire.permanentThreshold` (50): kurzer `spawnFireFlash()` pro Treffer
- HP darunter: ein dauerhaftes `spawnScaledFire()` mit Skala `1 - HP/50`, bei jedem Treffer neu gesetzt
- Game Over: `spawnHQExplosion()` plus `spawnScaledFire(…, 1.0)`

**Convenience-Methoden:**

```typescript
// Mit automatischem Terrain-Raycast
spawnFireOnTerrain(lat, lon, getTerrainHeight, 'medium');

// Mit bekannter Local-Y
spawnFireAtLocalY(lat, lon, localY, 'medium');
```

**WICHTIG:** `spawnFireOnTerrain` nutzt die übergebene `getTerrainHeight` Funktion. Grund: ThreeEffectsRenderer hat keinen direkten Zugriff auf TilesRenderer.

**Konfiguration:** `FIRE_INTENSITY` in `configs/visual-effects.config.ts` (Tabelle oben);
der Typ `FireIntensityLevel` ist aus seinen Schlüsseln abgeleitet.

### Route Animation (Knight Rider Effekt)

Animierte Routen-Visualisierung:

```typescript
// RouteAnimationService
startAnimation(routes: RouteData[]): void;
stopAnimation(): void;
```

- Lauflichter entlang der Routen
- Konfigurierbare Geschwindigkeit und Farbe
- Aktiviert während Setup-Phase

### Route LOS Grid System

Feingranulare Line-of-Sight Visualisierung entlang der Gegner-Routen:

```typescript
// GlobalRouteGrid (utils/global-route-grid.ts)
class GlobalRouteGrid {
  // 2m Zellenauflösung entlang aller Routen
  generateFromRoutes(routes: RouteWaypoint[][]): void;

  // Enemy-Tracking in Zellen
  getEnemiesInRadius(localX: number, localZ: number, radiusMeters: number, excludeId?: string, out?: Enemy[]): Enemy[];
  getEnemiesInRadiusGeo(center: GeoPosition, radiusMeters: number, excludeId?: string): Enemy[];
}
```

**Module (`src/app/utils/`):**
- `global-route-grid.ts`: `GlobalRouteGrid`, Einstiegspunkt. Cell-Generierung, Enemy-Tracking
  und Umkreis-Abfragen (Hot Path, Daten bleiben in dieser Klasse), Tower-Registrierung,
  Terrain-Sweep, cells-changed-Listener
- `route-cell.ts`: `RouteCell`/`CellSample` + `getAirTargetY`
- `route-cell-sampler.ts`: `sampleCellY`, einziger Schreiber von `cell.terrainHeight`
- `route-grid-aggregate-viz.ts`: Aggregat-Debug-Mesh (`grid`/`gridAir`, "Route Grid Overlay") mit
  Cell-Shader: jede Zelle, auch ohne Höhenprobe, Fläche nach Coverage, Kontur nach Zustand
  (normal, Dach-Check, Brückendeck, ohne Höhenprobe), Farben in `LOS_VIZ_CONFIG.gridOverlay`
- `route-grid-diagnostics.ts`: `__rg.*`-Dumps; `route-grid-log.ts`: `[CELL-GRID]`-Log

**Zellengenerierung:**
- Korridor pro Routensegment und Seite so breit wie der Freiraum, den die Tiles zeigen
  (`corridorLeft`/`corridorRight` am Waypoint, `utils/route-corridor.ts`), Halbbreite 1 bis
  7 m; OSM `width`/`lanes`/`highway` nur, wo nicht gemessen werden kann
- Eine Zelle gehört dazu, wenn ihr Mittelpunkt auf seiner Seite höchstens die Halbbreite vom
  Segment entfernt ist, außerdem jede Zelle, durch die die Mittellinie läuft (Engstelle: eine
  Zellreihe)
- Randzellen, deren Säule ein Dach oder eine Krone trifft, nehmen den Boden der Mittellinie
  daneben (`roofRise`, `CellSample.clamped`)
- Gegner-Seitenversatz auf die Halbbreite der Seite minus 1,5 m begrenzt, damit jeder Gegner
  in einer Zelle steht (Details: [ROUTE_GEOMETRY_ANALYSIS.md](ROUTE_GEOMETRY_ANALYSIS.md))
- 2m Zellenauflösung für präzise LOS-Prüfung

**Shader-Visualisierung:**
```typescript
// USE_INSTANCING define erforderlich für InstancedMesh
const material = new THREE.ShaderMaterial({
  defines: { USE_INSTANCING: '' },
  transparent: true,
  depthTest: false,  // WICHTIG: Über 3D Tiles rendern (Ground-Plate; Air-Plate: depthTest + polygonOffset)
  depthWrite: false,
  side: THREE.DoubleSide,
  // ...
});
```

**Farben** (Aggregat-Mesh, Quelle `LOS_VIZ_CONFIG`; gleiche Layer-Farben wie die
per-Tower-Viz, siehe "Farbsemantik der Cell-Plates" in
[HANDOVER_ROUTE_GRID_GPU_LOS.md](HANDOVER_ROUTE_GRID_GPU_LOS.md)):
- Ground-Plate (`grid`): grün `#5CE6A8` (α 0.45), wenn ein Tower die Zelle am Boden sieht
- Air-Plate (`gridAir`, `getAirTargetY` = `terrainHeight` + 15 m): blau `#3AA0FF` (α 0.45),
  wenn ein Tower die Air-Höhe sieht
- Sonst grau `#9999A1` (α 0.15): kein Tower deckt die Zelle ab. Vermillon `#D55E00`
  (in Reichweite, aber blockiert) gibt es nur in der per-Tower-Viz
- Jede Plate zeigt nur ihre eigene Coverage, "Ground + Air" ergibt sich aus dem Stapeln
- Alpha pulsiert leicht (Faktor 0,925 bis 1,025; `pulseSpeed` 2.0, `pulseDepth` 0.05)

---

## 12. Vorteile der Architektur

### Modularität
- Components sind wiederverwendbar
- Neue Entity-Typen durch Kombination von Components

### Separation of Concerns
- Entities: Daten und Logik
- Managers: Lifecycle und Orchestrierung
- Renderers: Nur Visualisierung

### Erweiterbarkeit
- Neue Tower/Enemy-Typen durch Config
- Neue Components ohne bestehenden Code zu ändern

### Performance
- Three.js InstancedMesh für Projektile, Enemies, Decals und Floating Texts
- Säulen-Cache für Terrain-Höhen
- VAT-Texturen für Enemy-Animationen, AnimationMixer nur für Tower-Modelle

### Cesium-frei
- Keine Abhängigkeit von Cesium.js
- Nur `3d-tiles-renderer` (NASA JPL) für Google 3D Tiles
- Cesium Ion nur als Hosting-Service (Token-basiert)

---

## 13. Gotchas & Lessons Learned

### Async Methods + Component Lifecycle = Race Condition

**Problem:** Async Methoden können NACH `onDestroy()` weiterlaufen und Ressourcen erstellen, die nie aufgeräumt werden.

```typescript
// ❌ FALSCH - Sound wird nach destroy erstellt
async playLoop() {
  await loadBuffer();      // <-- onDestroy() kann hier aufgerufen werden
  this.activeLoops.set();  // <-- läuft trotzdem weiter!
  audio.play();            // <-- Sound spielt ewig
}

// ✅ RICHTIG - destroyed Flag nach jedem await prüfen
private destroyed = false;

async playLoop() {
  await loadBuffer();
  if (this.destroyed) return;  // Abbruch nach jedem await!
  this.activeLoops.set();
  audio.play();
}

onDestroy() {
  this.destroyed = true;  // ZUERST Flag setzen
  this.stopAll();         // DANN cleanup
}
```

**Regel:** Bei async Component-Methoden immer ein `destroyed` Flag führen und nach jedem `await` prüfen.

### `alive` vs `active` bei GameObjects

| Property | Prüft | Wann false |
|----------|-------|------------|
| `alive` | `!health.isDead` | Enemy wurde getötet (HP = 0) |
| `active` | GameObject._active | `destroy()` wurde aufgerufen |

**Problem:** Bei setTimeout-Callbacks auf bereits zerstörte Objekte.

```typescript
// ❌ FALSCH - Enemy könnte destroyed sein aber health > 0
setTimeout(() => {
  if (enemy.alive) {
    enemy.startMoving();  // Crash oder Zombie-Sound!
  }
}, delay);

// ✅ RICHTIG - Beides prüfen
setTimeout(() => {
  if (enemy.alive && enemy.active) {
    enemy.startMoving();
  }
}, delay);
```

### setTimeout-Loops bei Game State Changes

**Problem:** Rekursive setTimeout-Loops (z.B. für Spawning) laufen weiter, auch wenn der Game State sich ändert.

```typescript
// ❌ FALSCH - Spawnt weiter nach Game Over
const spawnNext = () => {
  spawnEnemy();
  setTimeout(spawnNext, delay);  // Loop läuft ewig
};

// ✅ RICHTIG - State prüfen
const spawnNext = () => {
  if (this.gameOver || this.waveAborted) return;  // Abbruch!
  spawnEnemy();
  setTimeout(spawnNext, delay);
};

onGameOver() {
  this.waveAborted = true;  // Loop wird beim nächsten Tick gestoppt
}
```

### Duplizierte Logik vermeiden

**Problem:** Gleiche Funktionalität an mehreren Stellen implementiert → Fixes werden inkonsistent.

**Beispiel:** `spawnNext()` war sowohl in `WaveManager` als auch in `TowerDefenseComponent` implementiert. Fix in WaveManager wurde nie benutzt.

**Regel:** Spawn-Logik, Game-State-Änderungen etc. gehören in die Manager, nicht in Components.

### THREE.Raycaster State-Korruption

**Problem:** Ein geteilter `THREE.Raycaster` behält internen State, der nachfolgende Raycasts kaputt macht.

**Symptom:** Nach Line-of-Sight (LoS) Checks mit custom Origin/Direction gibt `raycastTerrain()` plötzlich `null` zurück, obwohl Tiles geladen sind und die Mausposition gültig ist.

```typescript
// ❌ FALSCH - Geteilter Raycaster wird durch LoS-Checks korrumpiert
class ThreeTilesEngine {
  private raycaster = new THREE.Raycaster();  // Geteilt!

  hasLineOfSight(from, to) {
    this.raycaster.set(customOrigin, customDirection);  // Modifiziert State
    return this.raycaster.intersectObject(...);
  }

  raycastTerrain(screenX, screenY) {
    this.raycaster.setFromCamera(mouse, camera);  // State ist korrumpiert!
    return this.raycaster.intersectObject(...);   // → null obwohl Hit erwartet
  }
}
```

**Lösung:** Für Screen-zu-Terrain Raycasts immer einen **frischen Raycaster** erstellen:

```typescript
// ✅ RICHTIG - Frischer Raycaster pro Aufruf
raycastTerrain(screenX: number, screenY: number): THREE.Vector3 | null {
  const mouse = new THREE.Vector2(/* NDC coords */);

  // Frische Instanz - wird nicht durch LoS-Checks beeinflusst
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, this.camera);

  const results = raycaster.intersectObject(this.tilesRenderer.group, true);
  return results.length > 0 ? results[0].point.clone() : null;
}
```

**Wo angewandt:**
- `screen-picker.ts`: `raycastTerrain()` und `raycastTowers()`

**Regel:** Raycaster, die mit `setFromCamera()` arbeiten, sollten nie denselben Instance verwenden wie Raycaster mit manuellem `set(origin, direction)`.

### ShaderMaterial + InstancedMesh = USE_INSTANCING

**Problem:** Custom ShaderMaterial mit `THREE.InstancedMesh` rendert nichts - keine Fehler, einfach unsichtbar.

**Ursache:** Three.js injiziert automatisch `#ifdef USE_INSTANCING` Code in Built-in Materials. Bei Custom ShaderMaterial muss man das Define selbst setzen.

```typescript
// ❌ FALSCH - Instancing funktioniert nicht
const material = new THREE.ShaderMaterial({
  vertexShader: `
    void main() {
      vec4 mvPosition = vec4(position, 1.0);
      mvPosition = instanceMatrix * mvPosition;  // instanceMatrix ist undefined!
      gl_Position = projectionMatrix * modelViewMatrix * mvPosition;
    }
  `,
});

// ✅ RICHTIG - USE_INSTANCING Define setzen
const material = new THREE.ShaderMaterial({
  defines: { USE_INSTANCING: '' },  // Aktiviert instanceMatrix
  vertexShader: `
    void main() {
      vec4 mvPosition = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * mvPosition;
    }
  `,
});
```

**Regel:** Bei Custom ShaderMaterial mit InstancedMesh immer `defines: { USE_INSTANCING: '' }` und `#ifdef USE_INSTANCING` im Vertex Shader.

### depthTest: false für Overlays auf 3D Tiles

**Problem:** Shader-basierte Overlays sind nur sichtbar wenn man gegen den Himmel schaut, verschwinden aber über 3D Tiles.

**Ursache:** 3D Tiles haben komplexe Z-Werte die Standard-Depth-Testing beeinflussen.

```typescript
// ❌ FALSCH - Overlay wird von Tiles verdeckt
const material = new THREE.ShaderMaterial({
  transparent: true,
  // depthTest default = true
});

// ✅ RICHTIG - Overlay rendert über Tiles
const material = new THREE.ShaderMaterial({
  transparent: true,
  depthTest: false,   // Ignoriert Depth Buffer
  depthWrite: false,  // Schreibt nicht in Depth Buffer
});
```

**Regel:** Für flache Overlays auf Terrain (LOS-Grid, Markers, etc.) immer `depthTest: false` und `depthWrite: false` setzen.
