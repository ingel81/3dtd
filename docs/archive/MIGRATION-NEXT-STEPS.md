# Migration: Nächste Schritte

> **ARCHIVIERT** — Migration vollstaendig abgeschlossen. Aktuelle Architektur: siehe [SIGNAL-STORE-ARCHITECTURE.md](../SIGNAL-STORE-ARCHITECTURE.md).
>
> Handoff-Dokument fuer die Weiterarbeit nach PR #2 (`jarvis/refactor-god-objects`)
>
> **Status: ABGESCHLOSSEN** — Alle Migrationspunkte sind erledigt (30.01.2026).

## Status Quo

Der Store (`TowerDefenseStore` + 4 Sub-Stores) ist **vollständig** als Single Source of Truth aktiv:

| Bereich | Store aktiv? | Writer | Reader |
|---------|-------------|--------|--------|
| **Game-State** (credits, health, phase, wave, enemies, towers) | ✅ Ja | `GameStateSyncService` (via EventBus) | Component, Facades, AI-Services |
| **Location** (coords, spawns, favorites) | ✅ Ja | Facades direkt | Component |
| **Engine-Stats** (fps, tileStats, compass, sounds) | ✅ Ja | `EngineStore.updateEngineStats()` via GameLoopFacade | Component liest aus Store |
| **Debug-Toggles** (debugMode, streetsVisible, etc.) | ✅ Ja | `UIStore` | Component, Services lesen aus Store |
| **Camera-Debug** | ✅ Ja | `EngineStore` via VizFacade | Component liest aus Store |
| **Build-Mode** (buildMode, selectedTowerType) | ✅ Ja | `UIStore` via TowerPlacementService | Component liest aus Store |

## Was getan werden muss

### 1. Engine-Stats → EngineStore (Priorität 1 — FPS/Compass broken)

**Problem:** `GameLoopFacadeService.onEngineUpdate()` schreibt via `uiState.updateThrottledStats()` in `GameUIStateService`. Aber Component liest aus `EngineStore`. `EngineStore.updateEngineStats()` wird nie aufgerufen → FPS = 0, Compass = 0.

**Fix:**
```typescript
// game-loop-facade.service.ts — im ngZone.run() Block:
// ALT:
this.uiState.updateThrottledStats({ fps, tileStats, ... });

// NEU:
this.store.engineStore.updateEngineStats({ fps, tileStats, activeSounds, mapAttribution });
this.store.engineStore.compassRotation.set(...);
this.store.engineStore.cameraDebugInfo.set(...);
```

Die Throttle-Logik (100ms + only-if-changed) kann aus `GameUIStateService.updateThrottledStats()` übernommen werden — `EngineStore` hat bereits eigene Equality-Checks.

### 2. Debug-Toggles → UIStore (Priorität 2 — Toggles broken)

**Problem:** 10+ Toggle-Signals existieren doppelt in `UIStore` und `GameUIStateService`. Kein Sync. Services lesen aus `GameUIStateService`, Component aus Store.

**Betroffene Signals:**
- `debugMode`, `streetsVisible`, `routesVisible`, `showGrid`, `showSpawnRadius`
- `dpsBinsVisible`, `showRoutes`, `showSpawnPoints`
- etc.

**Fix-Strategie:**
1. `UIStore` wird Owner aller Toggle-Signals
2. Services die aktuell `GameUIStateService.streetsVisible()` lesen → auf `store.uiStore.streetsVisible()` umstellen
3. `GameUIStateService` wird zum **Persistence-Adapter**:
   - Bei App-Start: localStorage → UIStore (Initialwerte)
   - Bei Änderung: UIStore → localStorage (Persistenz via Effect oder Subscription)
4. Toggle-Methoden in `GameUIStateService` delegieren an UIStore

### 3. Camera-Debug → EngineStore (Priorität 2)

**Fix:** `VisualizationFacadeService.toggleCameraDebug()` schreibt in `store.engineStore.cameraDebugEnabled` statt `GameUIStateService`.

### 4. Build-Mode → UIStore (Priorität 3)

**Problem:** `TowerPlacementService` hat eigene Signals `buildMode`, `selectedTowerType`. UIStore hat Kopien.

**Fix:** `TowerPlacementService` injected `UIStore` und schreibt/liest dort:
```typescript
// tower-placement.service.ts
toggleBuildMode() {
  this.store.uiStore.buildMode.update(v => !v);
}
```

### 5. GameUIStateService schrittweise ablösen — ✅ ERLEDIGT

`GameUIStateService` wurde vollständig entfernt. Persistence (localStorage) lebt jetzt direkt im `UIStore`-Konstruktor.

**Erledigte Schritte:**
1. Stats-Writing → EngineStore ✅
2. Debug-Toggles → UIStore ✅
3. Camera-Debug → EngineStore ✅
4. Build-Mode → UIStore ✅
5. Persistence → UIStore-Konstruktor (Effect + localStorage) ✅
6. Alle Service-Referenzen auf Store umgestellt ✅
7. `GameUIStateService` entfernt (Datei gelöscht) ✅
8. Toggle-Aufrufe im Component über VisualizationFacade geroutet ✅

## EventBus-Event-Katalog

### Command Events (Component/Facade → GSM)
| Event | Emitter | Listener | Store-Sync |
|-------|---------|----------|------------|
| `command:start-wave` | GameLoopFacade | GSM | via `wave:started` |
| `command:place-tower` | TowerPlacementService | GSM | via `tower:placed` |
| `command:sell-tower` | TowerDefenseFacade | GSM | via `tower:sold` |
| `command:upgrade-tower` | GameLoopFacade | GSM | via `credits:changed` |
| `command:restart-game` | TowerDefenseFacade | GSM | via `game:reset` |
| `debug:add-credits` | DebugFacade | GSM | via `credits:changed` |
| `debug:add-health` | DebugFacade | GSM | via `health:changed` |
| `debug:kill-all` | DebugFacade | WaveManager | via `enemy:died` (mehrfach) |
| `debug:start-custom-wave` | DebugFacade | GameLoopFacade | via `wave:started` |

### Engine Events (GSM/Managers → Sync → Store)
| Event | Emitter | Sync-Service schreibt |
|-------|---------|----------------------|
| `wave:started` | WaveManager | `phase='wave'`, `waveNumber`, `enemiesAlive=0` |
| `wave:completed` | WaveManager | `phase='setup'` |
| `game:over` | HqDamageService | `phase='gameover'` |
| `game:reset` | GSM | `resetAll()` |
| `credits:changed` | GSM | `credits` |
| `health:changed` | GSM | `baseHealth` |
| `tower:placed` | GSM | `towerCount++`, `credits` |
| `tower:sold` | TowerManager | `towerCount--`, clear `selectedTower` if same |
| `tower:selected` | TowerManager | `selectedTowerId` |
| `tower:deselected` | TowerManager | `selectedTowerId=null` |
| `enemy:spawned` | EnemyManager | `enemiesAlive++` |
| `enemy:died` | EnemyManager | `enemiesAlive--` (min 0) |
| `enemy:reached-base` | EnemyManager | `enemiesAlive--` (min 0) |

### Nicht im Store synchronisierte Events (Engine-intern)
| Event | Verwendung |
|-------|-----------|
| `projectile:hit` | CombatEffectService (VFX) |
| `tower:attack` | Audio, VFX |
| `enemy:status-effect` | Visual-Feedback |

## FacadeComponentBridge — Was ist noch drin?

Die Bridge enthält nur noch Engine/Canvas-Runtime-Objekte die NICHT in den Store gehören:

| Property | Typ | Warum nicht im Store? |
|----------|-----|----------------------|
| `getEngine()` / `setEngine()` | `ThreeTilesEngine` | Komplexes Objekt, nicht serialisierbar |
| `getStreetNetwork()` / `setStreetNetwork()` | `StreetNetwork` | Komplexes Objekt |
| `getFilteredStreetNetwork()` / `setFilteredStreetNetwork()` | `StreetNetwork` | Komplexes Objekt |
| `getDevStreetProvider()` / `setDevStreetProvider()` | `DevTerrainProvider` | Komplexes Objekt |
| `getStreetNetworkLocation()` / `setStreetNetworkLocation()` | `GeoCoord` | Könnte in LocationStore, aber nur intern genutzt |
| `getCanvas()` | `HTMLCanvasElement` | DOM-Element |
| `onTilesLoaded` | Callback | Lifecycle |
| `onCreateBuildPreview` | Callback | Lifecycle |
| `onRemoveBuildPreview` | Callback | Lifecycle |
| `onDeselectTower` | Callback | Lifecycle |

**Die Bridge kann langfristig weg** wenn Engine/StreetNetwork als Services bereitgestellt werden (z.B. `EngineService` der die Instanz hält). Aber das ist kein Blocker.

## Component — Direkte Service-Aufrufe

Verbleibende direkte Service-Aufrufe (absichtlich, da view-nah):

| Service | Methoden | Warum direkt? |
|---------|----------|---------------|
| `towerPlacement` | `handleBuildClick()`, `toggleBuildMode()`, `selectTowerType()` | View-naher Input-Handler |
| `inputHandler` | `onKeyDown()`, `onKeyUp()` | Keyboard-Events |
| `cameraControl` | `focusOnCoordinate()` | User-Action |
| `locationCoordinator` | `applyNewLocation()`, Favorites/Dialogs | Location-Flow |
| `enemyDebug` | div. Debug-Methoden | Debug (direkt OK) |

**Erledigt:** Toggle-Aufrufe (streets, routes, specialPoints, routeAnimation) laufen jetzt über `VisualizationFacadeService` via `TowerDefenseFacadeService`.

## Angular/Engine Zone-Regeln

```
AUSSERHALB Angular Zone (runOutsideAngular):
├── Three.js Render Loop (requestAnimationFrame)
├── onEngineUpdate() — Game-Loop-Callback
│   ├── towerPlacement.updateRotation()
│   ├── keyboardPan.update()
│   ├── markerViz.animateMarkers()
│   ├── routeAnimation.update()
│   ├── gameState.update() — GESAMTE Game-Logik
│   │   ├── enemyManager.update()
│   │   ├── projectileManager.update()
│   │   ├── towerCombat.update()
│   │   └── eventBus.processQueue()
│   │       └── EventBus-Handler (inkl. GameStateSyncService)
│   │           └── Store-Signal-Writes (credits, health, phase etc.)
│   └── [10Hz Throttle] → ngZone.run() → UI-Stats schreiben
│
INNERHALB Angular Zone:
├── Component Template-Bindings (OnPush)
├── User Input Events (@HostListener)
├── Init-Phase (ngAfterViewInit → startGame)
└── ngZone.run() Block — NUR für UI-Stats (10Hz)
```

**WICHTIG:** Signal-Writes AUSSERHALB der Zone triggern KEIN sofortiges Re-Render. Angular batched sie und rendert beim nächsten Zone-Entry (= der 10Hz Stats-Update). Das ist gewollt — Game-State-Updates (credits, health) erscheinen mit max 100ms Delay im UI, was für ein Game perfekt ist.

## Architektur-Regeln

```
Component → liest NUR vom Store (Signals + Computed)
Component → ruft Facades für Actions auf
Facades → schreiben in Store (UI-State) + emittieren EventBus (Engine-Commands)
EventBus → GSM reagiert auf Commands, emittiert Events
GameStateSyncService → hört auf GSM-Events, schreibt Game-State in Store
Services → lesen/schreiben Store direkt
Store → Single Source of Truth für ALLES
```

## Dateien-Referenz

| Datei | Rolle |
|-------|-------|
| `src/app/store/tower-defense.store.ts` | Root-Store (Aggregat) |
| `src/app/store/game.store.ts` | Game-State (credits, health, phase...) |
| `src/app/store/ui.store.ts` | UI-State (debug flags, toggles, build mode) |
| `src/app/store/engine.store.ts` | Engine-Stats (fps, tiles, camera, loading) |
| `src/app/store/location.store.ts` | Location (coords, spawns, favorites) |
| ~~`src/app/services/game-ui-state.service.ts`~~ | **ENTFERNT** — Persistence lebt jetzt in UIStore |
| `src/app/services/game-state-sync.service.ts` | GSM→Store Sync (Vorbild für weitere Syncs) |
| `docs/SIGNAL-STORE-ARCHITECTURE.md` | Architektur-Dokumentation |

## Tests

Nach jeder Änderung:
```bash
npx vitest run    # 346 Tests müssen grün bleiben
npx ng lint       # Keine Lint-Errors
npx ng build      # Build muss kompilieren
```

Store-Tests in `src/app/store/*.spec.ts` — bei neuen Store-Signals auch Tests erweitern!
