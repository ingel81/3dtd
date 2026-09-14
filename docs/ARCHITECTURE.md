# Tower Defense - Architektur

**Stand:** 2026-09-15 (Services, Manager, Signaturen, Ordner und Game Loop gegen den Code geprüft)

## Übersicht

Component-basierte Game Engine Architektur mit **Three.js + 3DTilesRendererJS** für Google Photorealistic 3D Tiles.

**Hinweis:** Cesium.js wurde vollständig entfernt. Die Engine basiert jetzt zu 100% auf Three.js.

### Systeme im Überblick

| System | Kern im Code | Dokument |
|---|---|---|
| Tower (Bau, Upgrades, Sockel, Veteranen-Ränge) | `managers/tower.manager.ts`, `TowerPlacementService`, `TowerLifecycle` | [TOWER_CREATION.md](TOWER_CREATION.md) |
| Gegner, auch Luft, Ooze und Wurm (Skarnax) | `managers/enemy.manager.ts`, `managers/ooze-bodies.ts`, `managers/worm/` | [ENEMY_CREATION.md](ENEMY_CREATION.md), [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md) |
| Wellen, Director, Boss-Intro, Blutmond | `managers/wave.manager.ts`, `ai/core/` | [WAVE_SYSTEM.md](WAVE_SYSTEM.md), [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) |
| Route, Korridor, Zellen | `services/world/path-route.service.ts`, `utils/global-route-grid.ts`, `utils/route-corridor.ts` | [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md) |
| Sichtlinien der Tower (Boden und Luft) | `three-engine/tower-shadow-mapper.ts`, `utils/route-grid-los.ts` | [LOS_PIPELINE.md](LOS_PIPELINE.md) |
| Kampf, Schaden, Status-Effekte | `services/combat/` | [STATUS_EFFECTS.md](STATUS_EFFECTS.md), [PROJECTILES.md](PROJECTILES.md), [MASTER_GAME_DESIGN.md](game-design/MASTER_GAME_DESIGN.md) |
| Forschung | `managers/research.manager.ts`, `configs/research/` | [MASTER_GAME_DESIGN.md](game-design/MASTER_GAME_DESIGN.md) |
| Fähigkeiten | `managers/ability.manager.ts` | [ABILITIES.md](ABILITIES.md) |
| Held (Söldner) | `managers/hero.manager.ts` | [HERO.md](HERO.md) |
| Replay der letzten Welle | `replay/` | [REPLAY.md](REPLAY.md) |
| Ort, Straßen, Favoriten, Weltkarte | `services/location/` | [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) |
| Effekte, Post-Processing, Screen Shake | `three-engine/renderers/`, `three-engine/post-processing/` | [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md) |
| Ton und Musik | `managers/audio/`, `game-engine/background-music.service.ts` | [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) |
| UI, Tasten, Photo Mode, Onboarding | `components/`, `services/` | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) |
| Offline-Welt | `devworld/` | [DEVWORLD.md](DEVWORLD.md) |

Offen aus der früheren Feature-Liste: Projektil-LoS (ein Projektil trifft nur bei
Sichtverbindung).

### Laufzeit-Abhängigkeiten

Das Spiel läuft **vollständig im Browser**. Zur Laufzeit gibt es keinen
Server-Anteil und kein Modell:

| Abhängigkeit | Status |
|---|---|
| Google Maps 3D Tiles / Cesium-Tiles | extern, Pflicht (Kartendaten) |
| OSM Nominatim | extern, nur beim Location-Wechsel |
| OSM Overpass | extern, Straßen und Gebäude beim Laden eines Orts (IndexedDB-Cache, siehe [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md)) |
| Python-Training-Backend (`:3001`) | **nur Training**. Ohne Verbindung läuft das Spiel unverändert. |
| Bots + WebSocket-Client (`ai/training/training-session.ts`) | **nur Training**. Eigener Lazy-Chunk, lädt erst bei Bot-Start oder Backend-Verbindung ([BOT_SYSTEM.md](BOT_SYSTEM.md#integration)). |
| ONNX-Modell + `onnxruntime-web` | **opt-in**. Wird nicht mehr beim Start geladen. |

Der **Wave-Director sitzt im Client**. Standard ist der regelbasierte Director
(`ai/core/rule-director.ts`), der weder Netzwerk noch Modell braucht; deshalb
gibt es kein Startfenster, in dem der Director nicht verfügbar wäre, und
`useAIDirector` steht per Default auf `true`. Der ONNX-Pfad ist erhalten, wird
aber nur durch einen expliziten `WaveDirectorService.loadModel()`-Aufruf aktiv
(Button im Training-Debugger-Panel, `forceRuleMode()` schaltet zurück);
`onnxruntime-web` (404 kB WASM) landet damit nicht im Cold Start. Das
Training-Backend übernimmt die Wave-Wahl nur, solange der
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
`tower-defense.component.ts` ist die Spielkomponente, Template und Styles liegen daneben in
`tower-defense.component.html` und `.scss`.

**Hinweis:** Services liegen in `/src/app/services/`. Seit dem **services/-Subfolder-Split
am 2026-05-10** sind sie thematisch in Subfolder gruppiert (heute sieben, `onboarding/` kam dazu); Root-Files
bleiben einige zentrale Service-Klassen, die keinem Subfolder eindeutig zuzuordnen sind.

Die Tabellen unten führen die Services und Hilfsklassen je Ordner. Specs liegen daneben
(`*.spec.ts`), Szenario-Tests als `*.scenario.spec.ts`.

### Service-Übersicht (nach Subfolder)

#### infrastructure/

| Service | Verantwortung |
|---------|---------------|
| **AssetManagerService** | Zentraler GLTF/FBX Loader mit Reference Counting |
| **EngineInitializationService** | Loading Sequence mit 10 Boot-Steps (`location` bis `flight`; `location`, `grid` und `flight` setzen andere Services), Progress Tracking |
| **ModelPreviewService** | 3D Model Previews für Sidebar (Max-Renderer + setViewport pro Preview, kein Re-`setSize()` pro Frame) |
| **GameStateSyncService** | EventBus → Store Bridge: wave/game/credits/health/tower/enemy/research:state-changed |
| **RunStatsTracker** (`run-stats.ts`) | Zahlen der Game-Over-Bilanz vom Event-Bus, Angular-frei, gehalten vom GameStateSyncService |

#### (Root): Camera & Input + zentrale Services

| Service | Verantwortung |
|---------|---------------|
| **CameraControlService** | Start- und Übersichtsansicht merken, Kamera-Reset, Heading und Debug-Info für Kompass und Engine-Store, Schnellsprung `focusGeo` (Home/N): Blickrichtung bleibt, die Position gleitet 600 ms additiv zu Keyboard-Pan und Controls; `stopJump()` beendet ihn, wenn eine geskriptete Einstellung die Kamera nimmt (Boss-Intro) |
| **CameraFramingService** | Viewport-basierte Kamera-Positionierung |
| **InputHandlerService** | Click/Pan Detection, Terrain Raycasting, Kamera-, Build- und Debug-Tasten. Außerhalb von Build- und Platzierungsmodus zeigt der Tower unter dem Zeiger seine Reichweite (Scheibe und Auswahlring des Renderers, `ThreeTowerRenderer.setHovered`): höchstens ein Tower-Pick alle 100 ms mit Nachzügler für die Endposition, keiner bei gedrückter Maustaste. Ein Druck auf dem Canvas nimmt die Hover-Reichweite weg (auch auf dem Tower selbst, vor einem Kamera-Ziehen), das Loslassen über dem Canvas pickt neu |
| **HotkeyService** | Spieltasten nach dem InputHandler (alle Tasten: [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#tastenkürzel)); Provider der Spielkomponente, weil er die Facade braucht. Zuordnung in `hotkey-map.ts` |
| **TowerUpgradeService** | Upgrade-Käufe des Spielers, von U (`buyFirst`, aus dem HotkeyService) und vom Klick auf eine Upgrade-Kachel (`buy`, Tower- und Research-Panel über die Spielkomponente), mit einer Antwort für beide: Track und neue Stufe als Welttext über dem Tower und Kachel-Blitz, oder der Grund über dem Tower und als Zeile im Panel (`UpgradeHintService`). Regeln in `utils/player-actions.ts` (`upgradeTrackRefusal`). Provider der Spielkomponente, weil er die Facade braucht; die Bots kaufen direkt über die Facade, ohne Antwort |
| **BossIntroService** | Boss-Intro: tritt ein Boss einer Welle aus seinem Portal, Kameraschnitt aufs Portal mit Titelkarte, das Spiel pausiert, Klick oder Esc überspringt. Provider der Spielkomponente (hört am Bus des GameStateManager), getickt aus `GameLoopFacadeService.onEngineUpdate` nach den Sub-Steps; bekommt jede Taste vor InputHandler und HotkeyService. Regeln, Zeitplan und Einstellung in `utils/boss-intro.ts`, siehe [WAVE_SYSTEM.md](WAVE_SYSTEM.md#boss-intro) |
| **KeyboardPanService** | WASD/Pfeiltasten Kamera-Steuerung |
| **TowerPlacementService** | Build Mode, Placement Validation, Preview Mesh, refineCellsInRadius vor LOS-Reg. Tastet die Grundfläche ab (`resolveFootprint`): auf unebenem Grund Fuß auf dem höchsten Punkt, Sockel bis zum tiefsten, schon in der Vorschau |
| **EconomyService** | Wave-Completion-Bonus + Perfect-Streak (extrahiert aus GameStateManager, 2026-05-10) |
| **AbilityTargetingService** | Zielmodus einer Fähigkeit: Ring im Radius des Schlags am Cursor, auf die Route gesnappt, Klick sendet `command:use-ability`, siehe [ABILITIES.md](ABILITIES.md) |
| **HeroControlService** | Held wählen, schicken (`command:hero-move`), anheuern und Munition wechseln, siehe [HERO.md](HERO.md) |
| **PhotoModeService** | Photo Mode: HUD aus, Screenshot mit Logo und Adresse (`utils/screenshot.ts`), siehe [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#photo-mode) |
| **ReplayService** | Replay der letzten Welle starten und verlassen: Pause, `ReplayPlayer`, Kamera, Menü und Fokus zurück, siehe [REPLAY.md](REPLAY.md) |
| **SellConfirmService** | Verkauf in zwei Schritten ohne Dialog (`SELL_CONFIRM_WINDOW_MS`), für Tower- und Research-Panel |
| **RefusalHintService** | Hinweis in der Context-Hint-Box, wenn eine Fähigkeit oder der Held einen Befehl des Spielers ablehnt |
| **UpgradeHintService** | Zeile im Panel, wenn ein Upgrade nicht gekauft werden kann (`UPGRADE_HINT_MS`) |
| **TowerLosRegistry** (`tower-los-registry.ts`) | LOS eines Towers auf dem Route-Grid: Registrieren, Neuberechnen, Warteschlange geänderter Zellen, siehe [LOS_PIPELINE.md](LOS_PIPELINE.md) |
| `build-preview-los.ts`, `tower-preview-model.ts`, `tower-plinth-preview.ts` | Bauvorschau: LOS-Anzeige, transparentes Modell mit Grün/Rot-Tönung, Sockel |
| `hotkey-map.ts` | Zuordnung Taste zu Aktion (`resolveHotkey`, `HOTKEY_HELP`) |

#### combat/

| Service | Verantwortung |
|---------|---------------|
| **TowerCombatService** | Tower Targeting, Turret-Rotation, Shooting, Chain-Hitscan (Lightning) |
| **CombatEffectService** | Projectile Hits, Damage, Blood/Death/Slow Effects |
| **CombatVfxService** | VFX-Trigger für Combat-Events (Hit-Sparks, Splash-Visuals) |
| **DamageApplicationService** | Damage-Pipeline: Schadensmatrix, Resistances, DOT-Application |
| **StatusEffectService** | Status-Effekte (Slow, Burn, Poison, Freeze als Halt, Stun) inkl. DOT-Ticks, siehe [STATUS_EFFECTS.md](STATUS_EFFECTS.md) |
| **HQDamageService** | HQ Fire Effects, Damage Sounds, Game Over Visuals |
| **BodyAim** (`body-aim.ts`) | Zielpunkt eines Towers auf einem Körper entlang der Route (Ooze): der nächste Punkt in Reichweite und Sicht |

#### world/

| Service | Verantwortung |
|---------|---------------|
| **MarkerVisualizationService** | 3D Marker (HQ, Spawn, Debug), Animation |
| **PathAndRouteService** (`path-route.service.ts`) | Pfad-Caching, Route-Visualisierung, Height Smoothing |
| **RouteAnimationService** | Knight Rider Routen-Animation |
| **GlobalRouteGridService** | 2m Grid entlang Route, O(1) LOS Lookup, Tower-Registrierung. Die Per-Tower-Viz (`TowerLosViz`, `utils/tower-los-viz.ts`) halten TowerManager (Auswahl) und TowerPlacementService (Build-Preview) |
| **IntroCameraFlightService** | Intro-Kamerafahrt entlang der Route, lädt dabei die Tiles des Korridors vor. Abbruch per Klick oder Mausrad auf dem Canvas, "Skip Intro" oder Esc; die übrigen Spieltasten wirken während des Flugs nicht (`handleKeyDown`, von der Spielkomponente nach dem Boss-Intro und vor InputHandler und HotkeyService gefragt) |
| **CorridorRefit** (`corridor-refit.ts`) | Korridor-Messung nach Tile-Loads nachziehen, siehe [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md) |
| **SpatialGridService** | Generischer Spatial Hash für Tower/Enemy Range-Queries |
| **HeightUpdateService** | Terrain Height Sync, Stabilization Loop |
| **StreetRenderingService** | Street Network Visualisierung mit Terrain-Following |
| **BuildingRenderingService** | OSM-Gebäude rendern (DevWorld + Live) |
| **MapPlacementService** | HQ-Placement, Spawn-Generation, Map-Bounds |
| **StrategicPlacementService** | Optimale Tower-Positionen entlang Enemy-Pfade |
| **RelocationStatusService** | Hinweis "MOVING HQ" beim HQ-Umzug mit Schritt und Messfortschritt |
| `route-line-layer.ts` | Rote Routenlinien (Line2, eine je Spawn-Route) des PathAndRouteService |
| `route-way-report.ts` | Tabelle für `__routes.describe()`, siehe [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md#__routesdescribe) |
| `corridor-controller.ts`, `route-grid-convergence.ts`, `intro-loading-gate.ts`, `building-overlay.ts` | Hilfsklassen der VisualizationFacade (unten) |

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
| **PathfindingWorkerService** | A*-Pathfinding über Web Worker |
| **UrlLocationService** | URL-Parameter für Location-Sharing |
| **WorldDiceService** | Zufällige Städte für Random-Location |
| **BestWaveService** | Beste Welle je Ort am Event-Bus, Rekord-Hinweis beim Game Over; Liste und Speicher in `best-waves.ts` |
| `favorite-locations.ts`, `recent-locations.ts` | Favoriten und zuletzt gespielte Orte: Laden, Speichern, Ordnen (reine Funktionen) |
| `street-box.ts` | Kasten der Straßenabfrage und der Rest nach schon geladenen Straßen (`boxMinus`, `mergeStreets`) |

Details: [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md).

#### onboarding/

| Service | Verantwortung |
|---------|---------------|
| **OnboardingService** | First-Run-Tipps in der Context-Hint-Box, Fortschritt vom Event-Bus, gespeichert unter `td_onboarding_v2`; die Zustandsmaschine liegt in `onboarding.ts`, siehe [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#first-run-tipps) |

#### debug/

| Service | Verantwortung |
|---------|---------------|
| **DebugFacadeService** | Debug Log, Height Debug, Display Options (ein Objekt unter `td_display_options`, `utils/display-options.storage.ts`), Enemy Debug |
| **WaveDebugService** | Wave-Debugging Utilities, delegiert State an `DebugStore` |
| **SoundDebugService** | Sound-Debug Stats & Events von SpatialAudioManager |
| **TowerDebugService** | Tower-Parameter Overrides (Scale, Height, Rotation), delegiert State an `DebugStore` |
| **EnemyDebugService** | Enemy-Debug (Spawn, Type-Config, Live-Visualisierung), delegiert State an `DebugStore` |
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
    │   ├── GameCommandsHandler ───────── Routing der `command:*`- und sieben `debug:*`-Events (2026-05-10)
    │   ├── EconomyService ────────────── Wave-Completion-Bonus + Streak (extrahiert aus GSM)
    │   ├── EnemyManager / TowerManager / ProjectileManager / WaveManager / ResearchManager
    │   ├── AbilityManager / HeroManager / ReplayRecorder
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
| `camera-rig.ts` | Kamera-Controls (GlobeControls, in DevWorld EnvironmentControls), Startposition, lokaler Kamera-Setter. Vom Engine besessen, die Kamera selbst bleibt beim Engine. Die GlobeControls raycasten nur gegen die Tiles (`ground-pick-root.ts`) |
| `ground-pick-root.ts` | Szene der GlobeControls: Gruppe ohne Transform in der Engine-Szene, beantwortet ihre Strahlen (Punkt unter der Kamera, Zoom-Punkt, Pivot) nur mit der Tiles-Gruppe und trägt ihr Pivot-Mesh. three prüft beim Raycast `visible` nicht; mit der ganzen Szene trafen die Controls die versteckten Reichweiten-Scheiben der Tower an der Route. Raycast-Cache (seit 2026-09-14): die letzten vier Strahlen samt Treffern; ein gleicher Strahl (`near`, `far`, `firstHitOnly`, Layer gleich, neuer Strahl höchstens 1 mm am alten Treffer vorbei) kommt aus dem Speicher, als Kopie. `TileSetVersion` im selben File zählt jede Traversierung (`frameCount` bei `update-after`), `load-tileset`, `load-model`, `dispose-model`, `tile-visibility-change` und `needs-update`; eine neue Version oder eine bewegte Tiles-Gruppe (`matrixWorld`) leert den Cache. In Ruhe überspringt der UpdateOnChangePlugin die Traversierung, die zwei Strahlen pro Frame unter die Kamera kommen dann aus dem Cache; bewegt sich die Kamera oder streamen Tiles, wird wie vorher gecastet |
| `tile-loading-tracker.ts` | Tile-Loading-State: erster Tile-Load (Debounce 500 ms, Retry 200 ms x 50, Force-Update x 3), Auth-Fehler, Tile-Stats. Hintergrund: [TILES_LOADING_BUG.md](archive/TILES_LOADING_BUG.md) |
| `render-loop.ts` | Render-Loop: rAF-Treiber mit FPS-Cap (`FramePacer`), Heartbeat-Worker für versteckte Trainings-Tabs, FPS-Zähler, Warten auf den nächsten gezeichneten Frame. Als `engine.renderLoop` erreichbar |
| `terrain-queries.ts` | Raycasts gegen Boden und Tiles: Säulen-Probe `sampleColumn()` mit Cache pro 0,5-m-Säule und `lodVersion`, `getGroundHeightEstimate()`, Tile-LOD-Peek ohne Raycast, Straßen-Freiraum für den Routen-Korridor (`measureStreetClearance()`), Line-of-Sight. Als `engine.terrain` erreichbar, nur `getTerrainHeightAtGeo()` reicht der Engine durch |
| `scene-environment.ts` | Statische Szenen-Lichter (`addSceneLights()`) und der Himmel als Cube-Textur aus `day.webp` (`SkyBackground`) |
| `screen-picker.ts` | Screen-Picking: Boden unter dem Mauszeiger (`raycastTerrain()`, in DevWorld über den DevTerrainProvider) und der vorderste Tower unter dem Punkt (`raycastTowers()`, bei gleichem Abstand der erste der Liste), je Aufruf ein frischer Raycaster. Als `engine.picker` erreichbar |
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

#### Raycast-Messung (`__raycastStats`)

`instrumentRaycasts()` (`utils/raycast-stats.ts`) misst jeden Strahl in die Tiles-Group.
Aufrufer benennen sich mit `raycastStats.enter()`/`exit()`, der äußerste gewinnt; ein Strahl
ohne Aufrufer landet unter `unscoped`, ein Treffer im Säulen-Cache kostet keinen Strahl und
taucht nicht auf. `__raycastStats()` in der Konsole zeigt je Aufrufer Aufrufe, Summe, Mittel,
Maximum, den längsten Burst (Strahlen mit weniger als 4 ms Abstand) und Treffer pro Strahl,
`__raycastStats(true)` setzt danach zurück. Kosten ohne Abfrage: zwei `performance.now()` und
ein Map-Zugriff pro Strahl. Herkunft: PERF_BUG_ANALYSIS_2026-05-28.md, Nachtrag 2026-09-12.

| Aufrufer | Strahlen |
|---|---|
| `routeGrid` | Zell-Sampling und Sweeps des Route-Grids (`GameStateManager`) |
| `routeCorridor` | Säule und Seitenstrahlen der Korridor-Stationen (`TerrainQueries.measureStreetClearance`) |
| `corridorPick` | Säulen-Inspektion ohne Cache (`TerrainQueries.inspectColumn`) |
| `streets` | Straßen-Overlay (`StreetRenderingService`) |
| `lineOfSight` | LOS-Strahl zwischen zwei Punkten (`TerrainQueries.raycastLineOfSight`) |
| `screenPick` | Zeiger im Bau- und Platziermodus, Klicks (`ScreenPicker`) |
| `towerFootprint` | Säulen unter der Grundfläche eines Towers (`TowerPlacementService`, Sockel) |
| `spawnRings` | Abstandsringe um die Spawns (`MapPlacementService`) |
| `intro` | Höhenproben des Einleitungsflugs (`IntroCameraFlightService`) |
| `bossShot` | Suche der Kameraeinstellung beim Boss-Intro (`BossIntroService`) |
| `tileProbe` | Origin-Probe nach jedem Tile-Load |
| `heightAtGeo` | alles andere über `getTerrainHeightAtGeo` |
| `cameraControls` | GlobeControls über `GroundPickRoot`: Punkt unter der Kamera, Zoom-Punkt, Pivot. Ein wiederholter Strahl bei unverändertem Tile-Set kommt aus dem Cache und taucht nicht auf |

### Pfad-Höhen und Route-Grid-Cells

Gegner folgen gecachten Pfaden mit Höhen, die aus dem **Route-Grid** stammen.
Cells sind die Single Source of Truth für Boden-Y: dieselben Cells, die auch
Tower-LOS und Air-Routing bedienen.

**Problem ohne zentrale Quelle:**
- Live-Terrain-Sampling pro Frame würde Gegner über Bäume/Gebäude laufen lassen
- Routen sollen DURCH Hindernisse gehen (geglättete Linie auf Straßenniveau)
- Doppelpipeline (eigene Pfad-Raycasts neben Cell-Raycasts) führt zu Drift
  zwischen sichtbarer Linie, Gegner-Position und Tower-LOS-Sample

**Lösung: eine Quelle, drei Konsumenten**

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
- Rejects outliers >50 m from the median of stable neighbours of the same
  surface; for a first sample or an LOD upgrade only neighbours from tiles at
  least as deep count (ROUTE_CORRIDOR.md, Zellhöhe)
- LOD-versioned idempotency: stable cells are only resampled when the
  hit comes from a strictly better LOD

**smoothPathHeights():** liegt in `utils/route-height-smoothing.ts` und wird
ausschließlich von `street-rendering.service.ts` für gerenderte Straßenmesh-
Vertices genutzt. Der Pfad-Bau braucht es nicht mehr, Cells sind schon
sanity-checked.

### Progressive LOS & Street Rendering

Tower-Platzierung und Kamera-Bewegung lösten früher schwere Frame-Drops aus
(95-600ms synchrone Raycasts). Beide nutzen jetzt progressive Batching:

**Tower LOS Registration:**
- `TowerPlacementService.registerTowerOnGrid()` läuft beim Platzieren (aus
  `GameStateManager`, nicht für passive Gebäude): erst `refineCellsInRadius()` im
  Tower-Radius, dann `registerTower()` am Grid mit GPU-Cubemap-LOS
  ([LOS_PIPELINE.md](LOS_PIPELINE.md)), danach
  `tower.losReady = true`
- Combat-System überspringt Towers mit `!losReady`
- Ändern sich Cell-Höhen (cells-changed-Listener), kommen die betroffenen Tower in eine
  Queue (`TowerLosRegistry`); `drainLosRefresh()` rechnet höchstens einen Tower pro Frame neu
  (`LOS_RECOMPUTES_PER_FRAME`) und wartet dabei auf einen laufenden Terrain-Sweep, maximal
  3 s (`MAX_LOS_WAIT_MS`)

**Street Rendering:**
- `renderStreets()` sammelt alle Nodes und gibt sofort zurück
- `continueStreetRender()` verarbeitet 50 Nodes/Frame (je 5 Raycasts bei Lateral Sampling)
- Alte Straßen bleiben sichtbar bis neue fertig (kein Flackern)
- Tile-Reload-Callback: von 350-600ms auf 14-34ms reduziert

### Enemy System Performance

Optimierungen im Enemy-Pfad. Die Zahlen (5000+ Gegner bei 67 FPS, etwa 1,79 µs je Gegner,
die Ersparnis je Zeile) stammen aus einer Messung ohne Datum und ohne Protokoll im Repo:

| Optimierung | Ersparnis |
|-------------|-----------|
| `performance.now()` einmal pro Frame cachen | ~0.5ms |
| Single-Pass Status-Effects (in-place compact) | ~0.8ms |
| GPU `needsUpdate` Flags pro Pool batchen | ~0.7ms |
| Integer-Hash-Keys für Spatial Grids | ~0.4ms |
| `geoToLocalSimple` inlined + cos gecacht | ~0.9ms |
| Heading sqrt eliminiert, lateralOffset gecacht | ~0.4ms |
| `Math.pow` → lineare Approximation | ~0.4ms |

---

## 2. Core System: GameObject & Components

### 2.1 GameObject (Basis-Entity)

```typescript
abstract class GameObject {
  readonly id: string;
  readonly type: GameObjectType; // 'enemy' | 'tower' | 'projectile' | 'hero'

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

  // Körper entlang der Route (Ooze), sonst null; Treffer, Umkreis-Abfragen
  // und Renderer nehmen ihn statt `position`, siehe ENEMY_CREATION.md
  body: RouteBody | null;
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

  findTarget(enemies: Enemy[], airTargetingUnlocked: boolean, losCheck?, bodyDistSq?): Enemy | null;
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
> Siehe [EVENT_SYSTEM.md](EVENT_SYSTEM.md) für Details.

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
  readonly abilityManager: AbilityManager;
  readonly heroManager: HeroManager;

  // Event Bus
  private readonly eventBus = new GameEventBus();

  // Game State (Angular Signals für UI-Bindings, gehalten von BaseHealthLedger / CreditsLedger)
  readonly baseHealth: WritableSignal<number>;
  readonly credits: WritableSignal<number>;

  initialize(engine: ThreeTilesEngine, basePosition, spawnPoints, cachedPaths): void;
  update(currentTime: number, onSubStep?: (gameTimeStepMs: number) => void): void;  // Sub-Step-Loop, siehe Abschnitt 9
  reset(): void;
  dispose(): void;
  getEventBus(): GameEventBus;  // Fuer externe Subscriptions
}
```

Die `command:*`- und sieben `debug:*`-Subscriptions liegen in `GameCommandsHandler`
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

Außerdem hält er den `ReplayRecorder`, der die laufende Welle für das Replay aufnimmt
(siehe [4.9](#49-replay-der-letzten-welle)).

`update()`/`runSubStep()` und das Event-Wiring in `initialize()` bleiben im GameStateManager,
damit die Reihenfolge an einer Stelle steht. `game-state.manager.order.spec.ts` hält sie fest:
Aufrufe pro Sub-Step und pro Frame, Pause, Timescale 1 und 10, Listener-Reihenfolge, Tower-Befehle, `reset()`.

### 4.2 EnemyManager (Framework-agnostic)

```typescript
// Kein @Injectable - Constructor Injection
class EnemyManager extends EntityManager<Enemy> {
  constructor(eventBus: GameEventBus, routeGrid: GlobalRouteGridService, spatialGrid: SpatialGridService);

  spawn(path, typeId, speedOverride?, paused?, healthOverride?, entry?): Enemy;  // entry: 'portal' oder ein Start mitten auf dem Pfad
  kill(enemy: Enemy, cause: KillCause = 'combat'): boolean;  // Emittiert 'enemy:died'; nur 'combat' zahlt Gold und teilt, 'debug' (kill-all) nicht
  update(deltaTime: number, gameTimeMs: number): void;  // Emittiert 'enemy:reached-base'
  startAll(defaultDelayBetween?: number): void;
  getAlive(): Enemy[];
  getPendingSpawnCount(): number;  // Wurm-Segmente noch im Portal
}
```

Würmer (Typen mit `chain`) laufen über `managers/worm/`: `WormGroup` hält die Slots eines
Wurms (im Portal, auf der Route, weg) und seine Ketten, `WormChains` schiebt jede Kette pro
Sub-Step vor der Enemy-Schleife vor, lässt Segmente aus dem Portal kommen und gibt jedem
Segment sein Ziel; `stepWormSegment()` ersetzt für sie `MovementComponent.move()`, `WormPath`
stellt sie auf die Route mit gerundeten Ecken (Ort und Blickrichtung). Ein Spawn
eines Wurms liefert den Kopf und emittiert `worm:spawned`. Details in
[ENEMY_CREATION.md](ENEMY_CREATION.md#kette-chain-der-wurm).

Oozes führt `OozeBodies` (`managers/ooze-bodies.ts`), damit die Schleife pro Gegner
für alle anderen nur `enemy.body` prüft: Körper anlegen beim Spawn, wachsen und in die
HQ fließen im Sub-Step (`enemy:leaking`, am Ende einmal `enemy:reached-base`), Split
entlang des Körpers, Frame an `tilesEngine.oozes` in `presentFrame`.

### 4.3 TowerManager (Framework-agnostic)

```typescript
// Kein @Injectable - Constructor Injection
class TowerManager extends EntityManager<Tower> {
  constructor(eventBus: GameEventBus, osmService: OsmStreetService, researchStore: ResearchStore);

  initialize(tilesEngine: ThreeTilesEngine): void;  // aus EntityManager
  placeTower(position: GeoPosition, typeId: TowerTypeId, customRotation = 0, plinthHeight = 0): Tower | null;  // Emittiert 'tower:placed'
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

  spawn(tower: Tower, targetEnemy: Enemy, heading?: number, aimPoint?: GeoPosition): Projectile;  // Emittiert 'vfx:muzzle-flash'; aimPoint für Körper entlang der Route
  spawnShot(origin, originHeight, target, typeId, damage, damageType, sourceId, aimPoint?): Projectile;  // Schuss ohne Tower (Held); aimPoint für Körper entlang der Route
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

ResearchEffects sind in `configs/research/research.types.ts` definiert und werden bei Completion an Tower- und Game-Systeme verteilt (`kind`: `unlock-tower`, `global-perk`, `unlock-upgrade-tier`, `enable-targeting`).

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

### 4.8 HeroManager (Framework-agnostic)

```typescript
// Kein @Injectable - Constructor Injection, Welt über HeroWorld
class HeroManager implements IGameManager {
  constructor(eventBus: GameEventBus, world: HeroWorld);

  hire(price?: number): boolean;            // command:hire-hero
  moveTo(target: GeoPosition): boolean;     // command:hero-move, Weg per Dijkstra im Befehl
  setAmmo(ammo: HeroAmmoId): boolean;       // command:hero-ammo
  update(stepMs: number): void;             // eigener Schritt am Ende von runSubStep
  presentFrame(): void;                     // einmal pro Frame an den HeroRenderer
  getDefenseProfile(): HeroDefenseProfile | null;  // für analyzeDefense
}
```

Der Held (Söldner) läuft auf dem Routengraph (`utils/route-graph.ts`), kämpft
über `ProjectileManager.spawnShot` und `DamageApplicationService` mit Quelle
`hero` und steht als virtueller Tower im Fairness-Gate. Siehe [HERO.md](HERO.md).

### 4.9 Replay der letzten Welle

> **Vollständige Dokumentation:** [REPLAY.md](REPLAY.md)

Ein Präsentations-Replay, keine Re-Simulation (Begründung in REPLAY.md):
`ReplayRecorder` (`replay/`, ohne Angular-DI, vom GameStateManager gehalten)
nimmt alle 6 Sub-Steps auf, was die Renderer zeigen (Gegner, Projektile,
Türme, die Körper der Oozes, den Helden), in Typed-Array-Spalten mit
Speichergrenze, dazu Effekt-Events und jedes `command:*` über `onAny()`,
das nur während einer aufgenommenen Welle am Bus hängt.
`ReplayPlayer` spielt das über die Live-Renderer ab, während das Spiel
pausiert, im Blutmond-Look der aufgezeichneten Welle; Effekte laufen über
einen eigenen Bus mit eigenem `VFXService`, `AudioService` und
`ScreenShakeService`. `ReplayService` (Angular, vom
Spiel-Component bereitgestellt) steuert den Modus, `app-replay-bar` die Leiste.

```typescript
class ReplayRecorder {
  readonly readyWave: Signal<number | null>;  // Welle der fertigen Aufnahme
  onSubStep(): void;                           // GameStateManager, nach dem Turret-Aim
  finish(outcome: 'completed' | 'gameover'): void;
  clear(): void;
}
```

---

## 5. Event-System

> **Vollständige Dokumentation:** [EVENT_SYSTEM.md](EVENT_SYSTEM.md)

Das Projekt verwendet einen **type-safe Event Bus** für lose Kopplung zwischen Komponenten.

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
  onAny(handler: (event: GameEvent) => void): EventSubscription;  // Catch-all: Event-Debugger, ReplayRecorder
  clear(): void;
}
```

Services und Manager sammeln ihre Subscriptions in einer `SubscriptionBag`
(`game-event-bus.ts`) und lösen sie in `dispose()`/`destroy()`.

### Event-Typen

Alle Event-Typen (Enemy, Tower, Combat, Wave, Game, Research, Ability, Hero, Effects, Debug,
Commands) mit Producer, Listener und Payload stehen in [EVENT_SYSTEM.md](EVENT_SYSTEM.md#event-typen).

### Immediate vs Deferred

- **Immediate Events:** Game-kritisch, sofort verarbeitet (z.B. `enemy:died`, `projectile:hit`)
- **Deferred Events:** Nicht-kritisch, beim nächsten `processQueue()` verarbeitet (z.B. `vfx:*`, `audio:play`, `debug:sound`; außerdem `wave:completed`)

```typescript
// GameStateManager.runSubStep(stepMs), einmal pro Sub-Step
projectileManager.update(stepMs);          // Emits immediate + deferred
researchManager.update(stepMs);
audioService?.update(stepMs);              // Loop-Sounds in Spielzeit
abilityManager.update(stepMs);             // Einschläge und Strahlen der Fähigkeiten
eventBus.processQueue();                   // Process deferred at stable point
waveManager.tickSpawn(stepMs);             // nur in der Wave-Phase
enemyManager.update(stepMs, gameTimeMs);   // Emits immediate events
towerCombat.updateTowerShooting(...);      // + Beam/Melee/Chain, nur in der Wave-Phase oder mit Debug-Gegnern
heroManager.update(stepMs);                // eigener Schritt des Helden
// danach in update(): onSubStep (Turret-Aim, Bot), replayRecorder.onSubStep()
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

Die Animationen laufen an die Bewegung gekoppelt (`EnemyInstanceManager.updateEnemyState`:
schneller laufen heißt schneller animieren), manche Gegner wechseln in Spielzeit zwischen Gehen
und Rennen (`Enemy.rush`, Simulationszustand, der Renderer zeigt nur den Clip). Beides steht in
[ENEMY_CREATION.md → Animation Speed Coupling](ENEMY_CREATION.md#animation-speed-coupling) und
[Run-Animation-System](ENEMY_CREATION.md#run-animation-system-animation-variation), die Technik
in [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md).

### 6.2 ThreeTowerRenderer

```typescript
class ThreeTowerRenderer {
  constructor(scene: THREE.Scene, sync: CoordinateSync, assetManager: AssetManagerService);

  preloadModel(typeId: TowerTypeId): Promise<void>;
  create(id, typeId, lat, lon, height, customRotation?, initialHeading?): Promise<TowerRenderData | null>;
  advanceTurretAim(gameTimeStepMs: number): void;  // pro Sub-Step, aus GameLoopFacadeService
  setIdleHeading(id: string, heading: number): void;  // Guard-Richtung nach der Wave
  updateRangeIndicator(id: string, range?: number): void;  // Reichweitenring nach Range-Upgrade
  showPreviewRange(x, y, z, range): void;  // Reichweitenring der Bauvorschau (TowerPlacementService)
  hidePreviewRange(): void;
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
| **InstancedEnemyRenderer** | `renderers/instanced-enemy/` | GPU-instancing für Enemies via VAT (Vertex Animation Textures), siehe [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md) |
| **OozeBandRenderer** | `renderers/ooze/` | Körper der Ooze als Schleimband entlang der Route: Geometrie einmal pro Pfad, pro Frame nur Uniforms (`OOZE_LOOK`), siehe [ENEMY_CREATION.md](ENEMY_CREATION.md#körper-entlang-der-route-ooze) |
| **DecalInstanceManager** | `renderers/decal-instance.manager.ts` | Blut-, Eis- und Scorch-Decals (`scorch-marks.ts`) als InstancedMesh mit Free-List-Pool |
| **ThreeFlameBeamRenderer** | `renderers/three-flame-beam.renderer.ts` | Fire-Tower-Beam (animierter Flammen-Kegel) |
| **ThreeTentacleRenderer** | `renderers/three-tentacle.renderer.ts` | Bezier-basierte Tentakel für Tentacle-Tower |
| **TowerPlinthRenderer** | `renderers/tower-plinth/` | Steinsockel unter Towern auf unebenem Grund (`engine.plinths`), ein Mesh pro Sockel, Bruchsteinmauerwerk prozedural im `MeshStandardMaterial` (`onBeforeCompile`). Angelegt und entfernt vom `TowerManager`, Höhe aus `Tower.plinthHeight`, siehe [TOWER_CREATION.md → Sockel auf unebenem Grund](TOWER_CREATION.md#sockel-auf-unebenem-grund) |
| **TowerBadgeRenderer** | `renderers/tower-badge/` | Veteranen-Abzeichen über Towern mit Rang (`engine.towerBadges`), alle in einem Draw Call, Billboard und Insignien im Shader. Rang aus `CombatComponent.kills`, jeden Frame vom `TowerManager` gesetzt (`syncVeteranBadges`), siehe [TOWER_CREATION.md → Veteranen-Ränge](TOWER_CREATION.md#veteranen-ränge) |
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

**Architektur (Stand 2026-05-21):** `ThreeEffectsRenderer` ist eine dünne
Delegations-Facade: die Konsumenten-API (`tilesEngine.effects.*`) bleibt stabil,
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
  bossIntro.update(deltaTime);  // Boss aus dem Portal: Kameraschnitt, Wanduhr, siehe WAVE_SYSTEM.md
  // danach: Auto-Wave-Countdown, Profiler, Route-Grid-Viz, LOS-Viz-Puls, UI-Stats (~10 Hz)
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

Ordner unter `src/app/` mit Zweck und Einstieg. Die Dateien einzelner Ordner stehen in den
Abschnitten dieses Dokuments (Services oben, Three.js-Kern in Abschnitt 1, Renderer in
Abschnitt 6) und in den Fach-Dokumenten.

| Ordner | Zweck | Einstieg |
|---|---|---|
| (Root) | Root-Component, Provider, Routing, Spielkomponente | `app.ts`, `tower-defense.component.ts` (Template mit den Debug-Fenstern in einem `@defer`-Block) |
| `ai/core/` | Wave-Director (Regeln, optional ONNX), Gate-Controller, Templates, Encoder, Defense-Analyse | `wave-director.service.ts`, `rule-director.ts`, `gate-controller.ts`, `wave-config-builder.ts` |
| `ai/training/` | Bots (Strategy Pattern), Strategien je Bereich, Trainings-Client | `training-session.ts`, `bots/`, `strategies/` |
| `components/` | UI-Komponenten (Header, Sidebar-Panels, Dialoge, Leisten, Debug-Fenster) | siehe [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#dateien) |
| `configs/` | Tower, Gegner, Projektile, Effekte, Audio, Balance, Wellen-Curriculum, Forschung, Fähigkeiten, Held, LOS-Farben | `tower-types.config.ts`, `enemy-types.config.ts`, `wave-curriculum.config.ts`, `research/`, `combat/` |
| `core/` | `GameObject`, `Component`, `ConfigService` (Tile-Zugang) | `game-object.ts`, `services/config.service.ts` |
| `devworld/` | Offline-Welt: Terrain, Straßen, Gebäude, Worker | siehe [DEVWORLD.md](DEVWORLD.md) |
| `entities/` | Enemy, Tower, Projectile, Held, Körper der Ooze | `enemy.entity.ts`, `tower.entity.ts`, `enemy-rush.ts`, `tower-targeting.util.ts` |
| `game-components/` | Transform, Health, Movement, Combat, Render, Audio | `movement.component.ts` |
| `game-engine/` | Event Bus und die Angular-freien Dienste daran | siehe [game-engine/README.md](../src/app/game-engine/README.md) |
| `integration/` | Tests über mehrere Manager und Services | |
| `interfaces/` | Provider-Interfaces für Straßennetz und Terrain | |
| `managers/` | Manager (event-driven, Angular-frei außer dem GameStateManager), `game-state/` (GameClock, Ledger, TowerLifecycle, Wellen-Vorschau), `worm/`, `audio/` (Spatial Audio), `ooze-*.ts` | `game-state.manager.ts`, `game-commands.handler.ts` |
| `models/` | Typen (`game.types.ts`, `location.types.ts`, `status-effects.ts`) | |
| `replay/` | Replay der letzten Welle: Aufnahme, Wiedergabe, Leiste | `replay-recorder.ts`, `replay-player.ts`, siehe [REPLAY.md](REPLAY.md) |
| `services/` | Angular-Services in sieben Unterordnern und im Root | Tabellen unter [Services](#services) |
| `store/` | Signal Stores | siehe [SIGNAL-STORE-ARCHITECTURE.md](SIGNAL-STORE-ARCHITECTURE.md) |
| `styles/` | Theme-Tokens | `td-theme.ts` |
| `three-engine/` | Three.js-Engine: Szene, Tiles, Kamera, Render-Loop, Raycasts, Renderer, Post-Processing | `three-tiles-engine.ts`, Abschnitt 1 und 6 |
| `utils/` | Reine Hilfsmodule (Route-Grid, Korridor, Geo, Kamera, LOS, Platzierung, Frame-Pacer) | `global-route-grid.ts`, `route-corridor.ts`, `geo-utils.ts` |
| `workers/` | Web Worker: A*-Pathfinding, Heartbeat für den Loop im versteckten Tab | `pathfinding.worker.ts`, `heartbeat.worker.ts` |

Außerhalb von `src/app/`: `tools/` (Shader-Check, Blender-Skripte, Weltkarten-Umrisse,
Modell-Budget, Charts, Benchmarks, AI-Schema), `training-backend/` (Python, nur Training), `docs/` (siehe
[INDEX.md](INDEX.md)).

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

### Spawn-Portal

Ein Steintor auf dem Routenstart jedes Spawns (`SpawnPortalManager`, `renderers/marker/`), zwei
instanzierte Draw Calls für alle Portale. Gegner spawnen in seinem Volumen und treten vorn heraus,
verdeckt samt Healthbar; das Portal schaut dorthin, wo die Route sein Volumen verlässt
(`spawnPortalPose`). Beim Setzen zeigt eine Vorschau es so, wie es stehen wird; R dreht es im
Drehbereich, der Kurs steht in URL und Favoriten. Rahmen ist ein gebackenes Asset
(`spawn_portal.glb`), Sigillen und Beschwörungskreis zeichnen die Shader aus Distanzfeldern.
Alles Weitere, auch Drehbereich, Lufteinheiten, Licht und die Regeln für neue Sigillen:
[SPAWN_PORTAL.md](SPAWN_PORTAL.md).

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
  (normal, Brückendeck, ohne Höhenprobe, Tunnel), Farben in `LOS_VIZ_CONFIG.gridOverlay`
- `corridor-walk.ts`: Laufweg-Check (`cellWalkable`, Dach- und Stufen-Check) und `walkCaps`, die
  Kappen je Station, mit denen der Korridor vor Zellen endet, zu denen kein Gegner laufen kann
- `route-grid-diagnostics.ts`: `__rg.*`-Dumps; `route-grid-log.ts`: `[CELL-GRID]`-Log
- Körperliste (`addBodyEnemy`, `getBodyEnemies`, `hasBodyWithin`): Gegner mit einem Körper
  entlang der Route (Ooze, `route-body.ts`) stehen in keiner Zelle. `getEnemiesInRadius`
  nimmt einen Körper auf, den der Kreis erreicht, und legt seinen Treffer an diesen Punkt

**Zellengenerierung:**
- Korridor pro Routensegment und Seite so breit wie der Freiraum, den die Tiles zeigen
  (`corridorLeft`/`corridorRight` am Waypoint, `utils/route-corridor.ts`), Halbbreite 1 bis
  7 m; OSM `width`/`lanes`/`highway` nur, wo nicht gemessen werden kann
- Eine Zelle gehört dazu, wenn ihr Mittelpunkt auf seiner Seite höchstens die Halbbreite vom
  Segment entfernt ist, außerdem jede Zelle, durch die die Mittellinie läuft (Engstelle: eine
  Zellreihe)
- Randzellen, deren Säule ein Dach, eine Krone, ein Auto oder eine Hecke trifft, sind nicht
  begehbar; der Korridor endet vor ihnen, Routen und Grid werden neu gebaut (`roofRise`,
  `stepRise`, `corridor-walk.ts`, ROUTE_CORRIDOR.md, Laufweg)
- Gegner-Seitenversatz auf die Halbbreite der Seite minus 1,5 m begrenzt, damit jeder Gegner
  in einer Zelle steht (Details: [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md#seitenversatz-der-gegner))
- 2m Zellenauflösung für präzise LOS-Prüfung

**Shader-Visualisierung:**
```typescript
// USE_INSTANCING setzt three für InstancedMesh selbst (Abschnitt 13), hier nur zusätzlich explizit
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
per-Tower-Viz, siehe [LOS_PIPELINE.md](LOS_PIPELINE.md#farben-der-zellplatten)):
- Ground-Plate (`grid`): grün `#5CE6A8` (α `gridOverlay.coveredAlpha` 0,6), wenn ein Tower die Zelle am Boden sieht
- Air-Plate (`gridAir`, `getAirTargetY` = `terrainHeight` + 15 m): blau `#3AA0FF` (α 0,6),
  wenn ein Tower die Air-Höhe sieht
- Sonst grau `#9999A1` (α 0,35, `globalStates.uncovered`): kein Tower deckt die Zelle ab. Vermillon `#D55E00`
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

**Problem:** Rekursive setTimeout-Loops (z.B. für Spawning) laufen weiter, auch wenn der Game State sich ändert. Das Beispiel stammt aus der Zeit vor dem Sub-Step-Spawner; gespawnt wird heute in `WaveManager.tickSpawn` im Sub-Step. Die Lehre gilt für jede Schleife außerhalb des Game Loops.

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

### ShaderMaterial + InstancedMesh: instanceMatrix kommt von three

**Stand three r186:** Für jedes Material auf einem `THREE.InstancedMesh`, ein eigenes `ShaderMaterial` eingeschlossen, setzt three `#define USE_INSTANCING` und deklariert `attribute mat4 instanceMatrix` im Vertex-Prefix (`WebGLPrograms.getParameters`: `instancing` aus `object.isInstancedMesh`, den Prefix baut `WebGLProgram`). Ein eigenes `defines: { USE_INSTANCING: '' }` ist nicht nötig. Auf einem InstancedMesh schadet es auch nicht, die zweite, gleiche Makrodefinition ist gültiges GLSL. VAT-Gegner, Spawn-Portale und HQ-Marker nutzen `instanceMatrix` ohne eigenes Define.

**Die Falle ist die Gegenrichtung:** Ein Shader, der `instanceMatrix` ohne `#ifdef USE_INSTANCING` benutzt, kompiliert auf einem normalen `Mesh` nicht (`'instanceMatrix' : undeclared identifier`). Das Material bleibt unsichtbar, die Meldung steht nur in der Browser-Konsole.

```typescript
// Nur für InstancedMesh: instanceMatrix kommt aus dem Prefix von three
vertexShader: `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`,

// Für Mesh und InstancedMesh
vertexShader: `
  void main() {
    vec4 local = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * local;
  }
`,
```

**Regel:** Ein Shader, der `instanceMatrix` direkt benutzt, gehört auf ein InstancedMesh; soll er auch auf einem Mesh laufen, mit `#ifdef USE_INSTANCING`. Der Shader-Compile-Check (unten) baut jedes Material wie im Spiel und findet die falsche Kombination.

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

### Reichweitenring: Stencil-Volumen statt Raycasts

**Problem:** Der Ring um einen Turm war bis 2026-09-14 eine Linie aus 48 Punkten, 2 m über dem Boden, jede Höhe per Raycast (`raycastTerrainHeight`, also Boden, nicht Dach). Zwischen den Punkten lagen gerade Sehnen von rund 6,5 m (bei 50 m Reichweite), über Gebäuden lief der Ring auf Straßenhöhe durch die Fassaden, und `depthTest: false` zeichnete ihn durch alles hindurch. Dazu kamen 433 Höhenabfragen (`raycastTerrainHeight`) je Turm beim Bauen und bei jedem Range-Upgrade (Linie und eine unsichtbare Scheibe).

**Lösung:** `renderers/range-ring.ts`. Der Ring ist ein geschlossenes Volumen: ein Wandring um den Turmfuß, 100 m darunter bis 250 m darüber, zwischen der Reichweite und einer Bandbreite innen. Drei Draws finden im Stencil-Puffer die Pixel, deren sichtbare Oberfläche im Volumen liegt (Depth-Fail): Rückseiten zählen +1, wo sie hinter der Oberfläche liegen, Vorderseiten -1, dann malt ein dritter Draw ohne Tiefentest, wo der Zähler nicht 0 ist, und setzt ihn auf 0 zurück. Das Band liegt so pixelgenau auf Boden, Dächern, Fassaden und Brücken, ohne Raycast und ohne Geometrie je Turm. Die Reichweite ist horizontal (`Tower.calculateDistanceFastSq`), darum ein senkrechter Zylinder. Die Bandbreite wächst mit dem Kameraabstand (0,5 % davon, 0,75 bis 6 m), damit sie auf dem Schirm etwa gleich breit bleibt. Alle Ringe teilen eine Geometrie und drei Materialien (`RangeRingKit`), ein Ring ist eine Gruppe aus drei Meshes mit Fuß und Reichweite in der Transformation. Denselben Ring zeigen Hover, Auswahl und die Bauvorschau (`showPreviewRange`, auf gültigen und ungültigen Plätzen). Was vor dem Ring Tiefe geschrieben hat, bekommt das Band, auch ein Gegner, der den Ring kreuzt. Auch Baumkronen auf der Kante: der Zylinder schneidet die Krone, das Band läuft als Schleife um sie herum. Nach dem Playtest 2026-09-14 ("zu viel Gelb") ist die Deckkraft von 0,85 auf 0,6 gesenkt. Kronen gezielt auszunehmen geht mit diesem Verfahren nicht: jeder Draw erfährt nur, ob der Oberflächenpunkt im Volumen liegt, nicht wie die Fläche geneigt ist; dafür bräuchte der Mal-Draw die Tiefe der Nachbarpixel als Textur, also die Szene in jedem Frame in einem eigenen Render Target mit `DepthTexture` statt direkt auf dem Canvas, dazu ein Pass mehr und das Auflösen der MSAA-Tiefe; für den Ring verworfen. Und selbst mit Normalen aus der Tiefe wäre eine zerklüftete Krone ein Gemisch aus aufwärts und seitwärts zeigenden Pixeln, ein Normalen-Filter ließe sie gesprenkelt statt leer.

**Regel:** Canvas (`stencil: true`, `three-tiles-engine.ts`) und Composer-Ziel (`stencilBuffer: true`, `post-processing-pipeline.ts`) brauchen einen Stencil-Puffer. Fehlt er, besteht der Stencil-Test überall und der dritte Draw malt das ganze Volumen. Nach dem Ring steht der Stencil überall wieder auf 0; ein anderes Material, das ihn benutzt, darf sich nur darauf verlassen.

### Bloom: ein NaN-Pixel wird zum schwarzen Block

**Problem:** Playtest 2026-09-14 (Paris, Kamera auf dem HQ): mit Bloom an deckte ein schwarzer, flackernder Block mehr als die rechte Bildhälfte ab, ohne Bloom war alles normal, keine Konsolenfehler.

**Ursache (Mechanismus aus dem Code, die Quelle des Pixels ist im Browser zu bestimmen):** Der Composer rendert in ein Half-Float-Ziel. Schreibt irgendein Shader dort NaN oder Unendlich (Division durch 0, `pow` mit negativer Basis, `normalize` eines Nullvektors, eine additive Mischung über 65504), bleibt das ohne Bloom ein einzelner schwarzer Pixel. Mit Bloom lässt der Hochpass von three (`LuminosityHighPassShader`, `mix(outputColor, texel, alpha)`) NaN durch und macht aus Unendlich mal 0 ein NaN; die fünf Blur-Stufen (bis 1/32 Auflösung, Kernel bis 22 Texel) tragen es rund 1150 px weit in jede Richtung, der Composite addiert es auf das Bild, der Output-Pass zeigt NaN schwarz. Ein Pixel reicht für einen Block von über 2000 px Seitenlänge; er flackert, wenn der Pixel nur in manchen Frames entsteht.

**Quelle (aus dem Code, im Browser mit `__bloom.marks()` zu bestätigen):** Nachtest des Nutzers: der Block kommt immer, wenn das HQ im Bild ist, auf jeder Karte und in DevWorld, auch ohne Blutmond und ohne Reichweitenring. Am HQ zeichnen nur Diamant, zwei Tori, Bodenglühen und Label (`marker-shaders.ts`). Der Ring-Shader rechnete `pow(1.0 - abs(dot(viewDir, vWorldNormal)), 1.5)` mit der interpolierten, nicht normierten Normale. Im MSAA-Ziel des Composers (4 Samples) wird ein Randpixel des dünnen Rohrs (0,8 m Radius, 8 Segmente, aus der Spielkamera wenige Pixel breit) in der Pixelmitte außerhalb seines Dreiecks schattiert, die Normale dort über die Länge 1 hinaus extrapoliert; zeigt sie zur Kamera, wird die Basis negativ und `pow` liefert NaN. Seit dem Fix `clamp`en Ring und Diamant die Basis auf 0 bis 1, im Dreieck ändert das nichts. Die Spawn-Abstandsringe (Line2) sind nur im Spawn-Platzierungsmodus in der Szene (`map-placement.service.ts`), keine Ursache.

**Lösung:** `post-processing/bloom-guard.ts` ersetzt den Fragment-Shader des Hochpasses: ein Pixel mit NaN oder Unendlich in einem Kanal trägt nichts zum Bloom bei, negative Kanäle zählen als 0. Der Test ist ein Bit-Test auf den Exponenten (`floatBitsToUint`), weil `isnan()` unter Fast-Math wegoptimiert werden darf. Das Bild selbst bleibt unverändert, der kaputte Pixel ist mit und ohne Bloom derselbe eine Pixel.

**Diagnose (DevTools):** `__bloom.marks()` malt jeden NaN-Pixel, den die Szene schreibt, als magenta Quadrat (9 px), jeden unendlichen cyan, mit Bloom an oder aus (`post-processing/pixel-marks.ts`, direkt nach dem RenderPass; solange die Marken an sind, läuft das Bild durch den Composer). Wo ein Quadrat erscheint, sitzt der Shader, der repariert werden muss. `__bloom.marks(false)` schaltet sie ab. `__bloom.guard(false)` stellt den alten Hochpass zum Vergleich wieder her, `__bloom.guard()` den geschützten.

**Regel:** Der Hochpass ist die einzige Stelle, an der ein einzelner Pixel großflächig wirkt. Wer einen weiteren Pass einbaut, der Nachbarn über große Radien mischt, muss dieselbe Prüfung vorschalten.

### Eigene Shader: Farben in Anzeigewerten, für das Ziel geschrieben

**Problem:** Bloom und Color Grading sind standardmäßig aus, dann rendert die Engine direkt auf den sRGB-Canvas. Ein `ShaderMaterial`, das `gl_FragColor` selbst schreibt, zeigt dort genau diese Werte; die meisten eigenen Shader sind so abgestimmt, in Anzeigewerten. Mit Bloom oder Grading geht die Szene erst in das lineare Half-Float-Ziel des Composers, der Output-Pass kodiert das Bild nach sRGB. Ein Anzeigewert, unkodiert in dieses Ziel geschrieben, kommt heller und blasser an (0,2 als 0,48).

**Mechanismus (three r186):** Jedes `ShaderMaterial` (nicht `RawShaderMaterial`) bekommt `linearToOutputTexel` vorangestellt, gebaut für das Ziel des Programms: sRGB-Kodierung für den Canvas (`renderer.outputColorSpace`), keine für ein Render Target (`WebGLPrograms`, `outputColorSpace`: der Arbeitsfarbraum, linear). Der Renderer baut das Programm neu, wenn das Ziel wechselt. Tone Mapping ist im Spiel aus, auch im Output-Pass.

**Lösung:** `renderers/display-output.ts`, `DISPLAY_OUTPUT_GLSL` vor `main()` einfügen:
- `displayOutput(farbe)`: dekodiert den Anzeigewert zu linearem Licht (`sRGBTransferEOTF`) und kodiert ihn für das Ziel. Auf dem Canvas kommt derselbe Wert heraus (Abweichung höchstens 6e-6, ein 8-Bit-Schritt ist 3,9e-3), das Bild ohne Bloom bleibt also gleich; ins Composer-Ziel geht das Licht, das der Output-Pass wieder zu diesem Anzeigewert macht. Der Teil über 1 geht unverändert durch: der Canvas klemmt ihn ohnehin, der Bloom bekommt so viel davon wie vorher.
- `displayLight(licht)`: für additives Licht. Der Canvas addiert in Anzeigewerten, das Composer-Ziel linear; keine Menge addiert über jedem Boden gleich. `displayLight` schreibt das Licht, das einen Boden von `ADDITIVE_GROUND` (0,3, eine Straße der Tiles) so weit anhebt wie auf dem Canvas: dort gleich, über dunklerem Boden mit Bloom heller, über hellerem dunkler. Die `vec4`-Form rechnet das Alpha von `AdditiveBlending` (SrcAlpha, One) mit ein.

Deckend ist das Bild mit und ohne Bloom gleich. Normales Blending mit Teil-Alpha mischt im Composer-Ziel linear, wie die eingebauten transparenten Materialien von three dort auch, etwas heller als auf dem Canvas; näher am Canvas als unkodiert. Ein Farbfaktor, der schon in den Werten des Ziels vorliegt (der Blutmond-Multiplikator, `bloodMoonMultiplier`), gehört hinter `displayOutput`. Der Beleg mit Probewerten steht in `display-output.spec.ts`.

**Regel:** Ein neuer eigener Shader rechnet entweder linear und endet mit `#include <colorspace_fragment>` (Uniform-Farben dann linear, wie `Color` sie aus Hex-Werten macht), oder er baut in Anzeigewerten und schreibt über `displayOutput` bzw. `displayLight`. Ohne eins von beiden sieht er mit Bloom anders aus als ohne.

### Shader-Compile-Check ohne Browser

**Problem:** Ein GLSL-Fehler in einem eigenen Material zeigt sich nur in der Browser-Konsole, das Material bleibt dann unsichtbar. Specs, die nur den Shader-Text prüfen, finden keine Tippfehler, reservierten Wörter (`flat`, `sample`, ...) oder Typfehler.

**Lösung:** `npm run shader-check` (läuft auch mit `npm test`), Code in `tools/shader-check/`:

- `capture-renderer.ts`: der echte `WebGLRenderer` von three über einem Ersatz-WebGL2-Kontext, der nur die Quelltexte aus `shaderSource()` aufhebt. `renderer.compile()` nimmt den Weg wie im Spiel: Parameter aus `WebGLPrograms` (Instancing, Nebel, Lichter, Log-Depth, Ausgabe-Farbraum), `onBeforeCompile`, Chunks, entrollte Schleifen, WebGL2-Prefix. Szene wie im Spiel: Lichter aus `addSceneLights` plus ein Punktlicht (Mündungsfeuer), Nebel, `logarithmicDepthBuffer: true`. Drei Aufbauten: sRGB-Canvas mit Nebel, lineares Half-Float-Ziel des Composers, Canvas ohne Nebel. Tone Mapping bleibt aus, wie im Spiel.
- `glslang.ts`: `glslangValidator` (Khronos-Referenz-Frontend) prüft beide Stufen als GLSL ES 3.00 und linkt sie (`-l`: Uniform- und Varying-Typen zwischen den Stufen). Dazu ein eigener Test: jedes benutzte Fragment-`in` braucht ein Vertex-`out`, sonst scheitert der Link in WebGL.
- `shader-check.spec.ts`: ein Fall je eigenem Material in `src/` (`ShaderMaterial`, `onBeforeCompile`; `RawShaderMaterial` benutzt das Spiel nicht), gebaut wie in seinem Renderer. Die Partikel-Materialien (`particle-shaders.ts`) laufen über die Fähigkeits-Effekte mit, die ihre Punkte damit zeichnen, Glut und Rauch des Atompilzes über dessen Fall. Nicht erfasst ist die Testseite `/engine-test` (`engine-test.component.ts`): eigener Renderer ohne Log-Depth, keine Tiles, nicht Teil des Spiels. Ohne Log-Depth zeichnen, im Fall begründet (`withoutLogDepth`): der Farbkorrektur-Pass des Composers, die Debug-Röhren der Luftroute (ohne Tiefentest) und das Debug-Quad der LOS-Cube-Faces. Jeder Lauf schreibt die Quelltexte in einen eigenen Ordner im Temp-Verzeichnis (`3dtd-shader-check-*`), damit sich Läufe in mehreren Worktrees nicht gegenseitig löschen oder überschreiben. Scheitert ein Compile, bleibt der Ordner stehen und der Fehler nennt ihn (dazu `<fall>.errors.txt` mit den Zeilen drumherum), sonst wird er am Ende gelöscht. Scheitert glslang beim Vorverarbeiten (`-E`), bricht der Test ab, statt mit leerer Ausgabe weiterzuprüfen.

**glslangValidator besorgen:** keine Abhängigkeit des Projekts, einmal von Hand. Offizielle Builds unter [github.com/KhronosGroup/glslang/releases](https://github.com/KhronosGroup/glslang/releases): das Archiv `glslang-<version>-windows-x86_64-release.zip` (Linux `...-linux-x86_64-release`, macOS `...-macos-universal-release`) entpacken, das Programm liegt in `bin/` (im Release 16.6.0 heißt es `glslang.exe`, `GLSLANG_VALIDATOR` darf darauf zeigen). Das Vulkan SDK bringt es ebenfalls mit. Dann entweder den Pfad setzen (Git Bash: `export GLSLANG_VALIDATOR=/c/tools/glslang/bin/glslangValidator.exe`, PowerShell: `$env:GLSLANG_VALIDATOR = 'C:\tools\glslang\bin\glslangValidator.exe'`) oder `bin/` in den PATH legen. Der Check nimmt `GLSLANG_VALIDATOR` und sonst `glslangValidator` aus dem PATH. Ohne beides überspringt die Spec die Compile-Tests: `npm run shader-check` sagt dann, warum und woher, in `npm test` stehen sie nur als übersprungen in der Zusammenfassung. Der GLSL-Aufbau (Chunks, `onBeforeCompile`, Log-Depth) wird trotzdem geprüft. Log-Depth heißt: Der Vertex-Shader schreibt `vFragDepth`, der Fragment-Shader `gl_FragDepth`, die Zuweisungen aus `logdepthbuf_vertex` und `logdepthbuf_fragment`. Das `#define USE_LOGARITHMIC_DEPTH_BUFFER` stellt three jedem `ShaderMaterial` selbst voran, mit den Chunks oder ohne; es sagt darüber nichts.

**Nicht geprüft:** Treiber- und ANGLE-Eigenheiten, Grenzen der echten GPU (Uniform- und Varying-Anzahl), Extensions (der Ersatz-Kontext meldet nur Float-Farbpuffer für das Composer-Ziel). glslang kennt in GLSL ES ein eingebautes `average()`, das WebGL nicht hat; three definiert es in `common` selbst, darum benennt der Check es nur für glslang um.

**Regel:** Ein neues eigenes Material (`ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile`) bekommt einen Fall in `CASES`, gebaut wie im Spiel (InstancedMesh, wenn es instanziert gezeichnet wird). Ein `onBeforeCompile`-Patch nennt in `marks` eine Zeile, die im Programm stehen muss: sonst fällt er bei einem umbenannten Chunk still weg. Zeichnet ein Material bewusst ohne Log-Depth (weder Tiefentest noch Tiefe schreiben, Vollbild-Pass), sagt `withoutLogDepth` im Fall, warum.
