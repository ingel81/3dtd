# Refactoring-Plan: God Objects auflösen

> **Branch:** `jarvis/refactor-god-objects`
> **Ziel:** TowerDefenseComponent (2.842 Zeilen, ~40 Dependencies) und GameStateManager (764 Zeilen) entschlacken — **ohne neue Services zu erfinden**. Logik wandert in bestehende Services, der EventBus wird konsequenter genutzt.
> **Regel:** Keine Funktionalität darf brechen. Jeder Schritt ist einzeln testbar.

---

## 1. Problemanalyse

### TowerDefenseComponent — Der Elefant
- **2.842 Zeilen**, ~40 injizierte Services, ~99 Methoden
- Mischt: UI-Bindings, Game-Loop, Bot-Training, Location-Management, Debug-Steuerung, Visualization-Toggles, Keyboard-Handling
- Greift direkt auf `gameState.enemyManager`, `gameState.towerManager` etc. zu
- Enthält Business-Logik die in Services gehört (Tower-Kauf, Wave-Start, Bot-Steuerung)

### GameStateManager — Der Orchestrator mit Extras
- **764 Zeilen**, 10+ Angular-Services + 7 manuell erstellte Game-Objekte
- Kern-Rolle als Orchestrator ist **legitim**
- ABER: Tower-Placement-Backend (LOS, Grid-Registrierung), Defense-Reach-Berechnung und Proxy-Methoden gehören nicht hierher

### EventBus — Solide Basis, inkonsequent genutzt
- **25 Event-Typen** definiert, Manager↔Manager gut entkoppelt ✅
- **4 tote Events** (nie gesendet): `projectile:missed`, `vfx:explosion`, `ui:notification`, `debug:reset-wave`
- **3 Events ohne Listener**: `tower:deselected`, `game:paused`, `game:resumed`
- **Component→Manager fast komplett direkt gekoppelt** ❌

---

## 2. Strategie: Wohin gehört was?

Statt neue Services zu erfinden, nutzen wir die **existierende Service-Landschaft**. Die Component wird zur dünnen UI-Shell, die nur noch:
1. Template-Bindings verwaltet
2. User-Input entgegennimmt und an Services delegiert
3. Angular-Lifecycle handhabt (init/destroy)

### Absorptions-Zielmatrix

| Verantwortung in Component | Zeilen ~  | → Ziel-Service (existiert bereits) |
|---|---|---|
| Game-Loop (`onEngineUpdate`) | 120 | → `GameStateManager.update()` (hat bereits alle Manager) |
| Wave-Start + AI-Director-Integration | 80 | → `GameStateManager` + `WaveDirectorService` |
| Tower Kauf/Verkauf/Upgrade | 60 | → `GameStateManager` (hat Credits + TowerManager) |
| Build-Mode Orchestrierung | 90 | → `TowerPlacementService` (macht schon 90%) |
| Debug-Enemy-Placement (8 Methoden) | 150 | → `EnemyDebugService` (hat Signals, braucht Actions) |
| Street-Netzwerk-Filterung | 50 | → `StreetRenderingService` |
| Visualization-Toggles | 100 | → `GameUIStateService` (hat Signals) + zugehörige Viz-Services |
| Bot-Steuerung | 130 | → `TrainingClientService` (existiert, erweitern) |
| Camera-Debug | 50 | → `CameraControlService` |
| Location-Dialog + WorldDice + Favorites | 150 | → `LocationChangeCoordinatorService` (Orchestrator existiert) |
| Game-Init-Sequenz | 200 | → `EngineInitializationService` (macht schon 6-Step) |
| Game-Over / Restart | 50 | → `GameStateManager` |
| Keyboard-Shortcuts | 80 | → `InputHandlerService` (erweitern) |
| **Gesamt verschiebbar** | **~1.310** | |

### GameStateManager — Was raus muss

| Verantwortung | Zeilen ~ | → Ziel |
|---|---|---|
| Tower-Placement-Backend (LOS, Grid-Reg) | 60 | → `TowerPlacementService` (Grid-Injection hinzufügen) |
| Tower-Sell-Backend (LOS-Cleanup, Grid) | 20 | → `TowerPlacementService` |
| Defense-Reach-Berechnung + Marker | 80 | → `GlobalRouteGridService` |
| Proxy-Methoden (towers(), enemies(), etc.) | 30 | → Entfernen. Manager sind `readonly public`, direkt nutzen |
| Debug-Methoden (HQ-Point, Spheres) | 30 | → `GameUIStateService` oder `MarkerVisualizationService` |

---

## 3. EventBus-Erweiterung: Command-Pattern

Statt direkte Service-Aufrufe aus der Component führen wir **Command-Events** ein. Die Component emittiert nur noch Befehle — Services reagieren darauf.

### Architektur-Prinzip: Store / Facade / EventBus Trennung

```
┌──────────────────────────────────────────────────────────────┐
│ DATENFLUSS                                                    │
│                                                               │
│  Component ──user input──> Facade.startWave()                │
│                              │                                │
│                              ▼                                │
│                         EventBus.emit('command:start-wave')   │
│                              │                                │
│                              ▼                                │
│                     GameStateManager (Engine reagiert)         │
│                              │                                │
│                              ▼                                │
│                     EventBus.emit('wave:started')             │
│                              │                                │
│                              ▼                                │
│                     Facade/Effect → Store.phase.set('wave')  │
│                                                               │
│  Component <──reads──── Store.phase() ─── (Template Binding) │
└──────────────────────────────────────────────────────────────┘
```

### Ownership-Matrix pro Signal

| Signal-Kategorie | Owner | Wer liest | Wer schreibt |
|---|---|---|---|
| UI-State (debug, toggles) | **Store** | Component (Template) | Store direkt, Facade |
| Game-State (credits, health, phase) | **Store** | Component (Template) | Facade via Effect (nach EventBus-Event) |
| Location (coords, spawns, favorites) | **Store** | Component, Facade | Facade (nach Location-Change) |
| Engine-Stats (fps, tiles, sounds) | **Store** | Component (Template) | Facade (aus Game-Loop) |
| Bot/AI (enabled, skill, autoMode) | **Store** | Component (Template) | Facade (nach Bot-Events) |

### Was gehört wohin?

| Schicht | ✅ Enthält | ❌ Enthält NICHT |
|---|---|---|
| **Store** | Signals, Computed, reset(), set/update | Action-Methods, EventBus, Side-Effects |
| **Facade** | Commands via EventBus, Service-Orchestrierung | Eigene Signals, direkte State-Mutations |
| **EventBus** | Engine-Commands, Engine-Events | UI-State, Persistence |
| **Component** | Template, @HostListener, Lifecycle | Business-Logik, State |

### Command-Events (bereits implementiert in EventBus)

```typescript
// game-event-bus.ts — Command Events
'command:place-tower':    { position: GeoPosition, typeId: string, rotation?: number }
'command:sell-tower':     { towerId: string }
'command:upgrade-tower':  { towerId: string, upgradeId: string }
'command:start-wave':     { config?: unknown }
'command:restart-game':   {}

// Debug-Commands
'debug:add-credits':      { amount: number }
'debug:add-health':       { amount: number }
'debug:toggle-movement':  { enabled: boolean }
'debug:remove-enemy':     { enemyId: string }
'debug:clear-enemies':    {}
```

### Wer hört auf was?

| Command | Listener |
|---|---|
| `command:place-tower` | `GameStateManager` → Credit-Check → `TowerPlacementService` → Grid-Reg |
| `command:sell-tower` | `GameStateManager` → `TowerPlacementService` → Cleanup → Credits |
| `command:upgrade-tower` | `GameStateManager` → Credit-Check → `TowerManager.upgrade()` |
| `command:start-wave` | `GameStateManager` → `WaveDirectorService` (optional AI) → `WaveManager` |
| `command:restart-game` | `GameStateManager.reset()` |
| `debug:add-credits` | `GameStateManager` |
| `debug:add-health` | `GameStateManager` |
| `debug:toggle-movement` | `EnemyManager` |
| `debug:remove-enemy` | `EnemyManager` |

### Tote Events aufräumen

| Event | Aktion |
|---|---|
| `vfx:explosion` | Listener entfernen oder Emitter hinzufügen (HQ-Explosion?) |
| `debug:reset-wave` | Emitter in Quick-Actions hinzufügen oder Listener entfernen |
| `tower:deselected` | Listener in UI hinzufügen (Build-Mode exit) |
| `game:paused` / `game:resumed` | Listener für UI-State hinzufügen (Pause-Overlay etc.) |

---

## 4. Umsetzungsplan — Phasen

### Phase A: GameStateManager bereinigen (Low Risk)

**Schritt A1: Proxy-Methoden entfernen**
- `towers()`, `enemies()`, `spawnEnemy()`, `startAllEnemies()`, `selectTower()`, `deselectAll()`, `killEnemy()`, `checkWaveComplete()`, `stopSpawning()` entfernen
- Alle Aufrufer umstellen auf `gameState.towerManager.xxx` / `gameState.enemyManager.xxx` / `gameState.waveManager.xxx`
- Manager sind bereits `readonly public` → kein Breaking Change

**Schritt A2: Tower-Placement-Backend in TowerPlacementService verschieben**
- `GameStateManager.placeTower()`: LOS-Raycasting + Grid-Registration + Visualization → `TowerPlacementService`
- `GameStateManager.sellTower()`: LOS-Cleanup + Grid-Unregister → `TowerPlacementService`
- `TowerPlacementService` bekommt `GlobalRouteGridService` Injection (hat es teilweise schon)
- Credit-Check und Credit-Abzug bleibt in `GameStateManager` (Wirtschaftslogik)
- Ablauf: Component → `command:place-tower` → GSM (Credit-Check) → `TowerPlacementService` (Place + Grid + LOS) → Event `tower:placed`

**Schritt A3: Defense-Reach in GlobalRouteGridService**
- `getDefenseReachPercent()`, `updateDefenseReachMarker()`, `hideDefenseReachMarker()` → `GlobalRouteGridService`
- Der Service hat bereits das Grid und die Route-Daten

**Schritt A4: Debug-Methoden verschieben**
- `spawnHQDebugPoint()`, `updateDebugSpheresVisibility()` → `MarkerVisualizationService`

**Ergebnis Phase A:** GameStateManager von ~764 → ~550 Zeilen. Klare Rolle als Game-Lifecycle-Orchestrator + Wirtschaftssystem.

---

### Phase B: EventBus Command-Pattern (Medium Risk)

**Schritt B1: Command-Event-Types definieren**
- Neue Types in `game-event-bus.ts` hinzufügen
- Tote Events aufräumen

**Schritt B2: GameStateManager als Command-Listener**
- GSM subscribt auf `command:place-tower`, `command:sell-tower`, `command:upgrade-tower`, `command:start-wave`, `command:restart-game`
- Debug-Commands: `debug:add-credits`, `debug:add-health` → GSM
- `debug:toggle-movement`, `debug:remove-enemy` → EnemyManager

**Schritt B3: Component umstellen**
- Alle direkten `this.gameState.sellTower()`, `this.gameState.spendCredits()` etc. ersetzen durch `eventBus.emit('command:...')`
- Component braucht nur noch EventBus-Referenz für Commands (statt 40 Service-Referenzen für Mutationen)

**Ergebnis Phase B:** Component ist von GameStateManager für Mutationen entkoppelt. Nur noch Reads (Signals) + Commands (Events).

---

### Phase C: Component-Logik in Services verschieben (Higher Risk)

**Schritt C1: Debug-Enemy-Logic → EnemyDebugService**
- 8 Methoden: `handleEnemyPlacement`, `onRemoveDebugEnemy`, `onClearDebugEnemies`, `onPlayIdleAnimation`, `onPlayWalkAnimation`, `onPlayRunAnimation`, `onStartEnemyMovement`, `onStopEnemyMovement`
- `EnemyDebugService` hat bereits Signals für Scale/HP/Speed → bekommt jetzt auch Action-Methoden
- Braucht `EnemyManager`-Referenz (über EventBus oder direkte Injection)

**Schritt C2: Bot/Training-Logic → TrainingClientService erweitern**
- `enableBot()`, `disableBot()`, `executeBotAction()`, Timescale-Management, Episode-Tracking
- `TrainingClientService` hat bereits WebSocket + Training-State
- Neuer Bereich: `TrainingOrchestrationService`? → NEIN, lieber `TrainingClientService` erweitern (ist mit 299 Zeilen schlank genug)

**Schritt C3: Visualization-Toggles → zugehörige Services**
- Streets-Toggle → `StreetRenderingService.toggle()`
- Routes-Toggle → `PathAndRouteService.toggleVisualization()`
- SpatialGrid → `GlobalRouteGridService.toggleDebugViz()`
- DPS-Bins → `DpsProfileVisualizer` (ist kein Service, ggf. wrappen)
- SpecialPoints → `MarkerVisualizationService.toggleSpecialPoints()`

**Schritt C4: Location-Flow → LocationChangeCoordinatorService erweitern**
- `openLocationDialog()`, `onWorldDice()`, `onAddFavorite()`, `onSelectFavorite()`, `onDeleteFavorite()`, `onApplyNewLocation()`
- Der Coordinator existiert bereits mit 404 Zeilen und orchestriert Location-Changes
- Erweitern um Dialog-Öffnung und Favorites-Management

**Schritt C5: Game-Init vereinfachen**
- `ngAfterViewInit()` → `EngineInitializationService` bekommt die gesamte Sequenz
- Component ruft nur noch `this.engineInit.start(containerElement)` auf
- Init-Service emittiert Events bei Fortschritt → Component bindet Loading-UI daran

**Schritt C6: Keyboard-Shortcuts → InputHandlerService**
- `@HostListener('window:keydown')` und `@HostListener('window:keyup')` → `InputHandlerService`
- Service emittiert Action-Events (oder ruft Commands auf)
- Component registriert nur noch den Service

**Schritt C7: Game-Loop in GameStateManager konsolidieren**
- `onEngineUpdate()` enthält: deltaTime-Berechnung, gameState.update(), Tile-Stats, FPS-Counter, UI-Update-Throttling
- `GameStateManager.update()` macht bereits die Game-Logic
- Tile-Stats + FPS gehören eher in `EngineInitializationService` oder `GameUIStateService`

**Ergebnis Phase C:** Component sinkt von ~2.842 → ~800-1.000 Zeilen. Reine UI-Shell mit Template-Bindings und Lifecycle.

---

## 5. Dependency-Reduktion der Component

### Vor dem Refactoring (~40 Injections):
```
MatDialogRef, MatDialog, NgZone, OsmStreetService, ConfigService,
GameStateManager, EntityPoolService, ModelPreviewService,
GameUIStateService, CameraControlService, MarkerVisualizationService,
PathAndRouteService, InputHandlerService, TowerPlacementService,
LocationManagementService, UrlLocationService, HeightUpdateService,
EngineInitializationService, CameraFramingService, RouteAnimationService,
KeyboardPanService, GeolocationService, WorldDiceService,
StreetRenderingService, LocationChangeCoordinatorService, DevWorldService,
DebugWindowService, WaveDebugService, SoundDebugService, TowerDebugService,
EnemyDebugService, WaveDirectorService, TrainingClientService,
AIDataCollectorService, StrategicPlacementService, DestroyRef
```

### Nach dem Refactoring (~15 Injections):
```
NgZone, DestroyRef,
GameStateManager,        // Signals lesen (credits, health, phase, etc.)
GameUIStateService,      // UI-State Signals (debug-flags, toggles)
EngineInitializationService,  // Init + Engine-Referenz
InputHandlerService,     // Keyboard + Mouse (erweitert)
TowerPlacementService,   // Build-Mode UI (Preview etc.)
LocationChangeCoordinatorService,  // Location-Flow
DebugWindowService,      // Debug-Panel-Steuerung
EnemyDebugService,       // Debug-Enemy UI
TrainingClientService,   // Bot-Steuerung UI
CameraControlService,    // Kamera-Aktionen (Reset, Debug)
MatDialog,               // Dialog-Öffnung
ConfigService,           // App-Config
DevWorldService,         // DevWorld-Modus
```

**Reduktion: ~40 → ~15 Dependencies** (62% weniger)

---

## 6. Risiko-Einschätzung

| Phase | Risiko | Grund |
|---|---|---|
| A (GSM bereinigen) | 🟢 Niedrig | Nur Verschieben + Proxy-Entfernung, alles intern |
| B (Command-Pattern) | 🟡 Mittel | Neue Kommunikationswege, aber Event-Bus ist bewährt |
| C1-C2 (Debug/Bot) | 🟢 Niedrig | Isolierte Features, kaum Auswirkung auf Gameplay |
| C3 (Viz-Toggles) | 🟢 Niedrig | Reine UI-Aktionen, gut testbar |
| C4 (Location) | 🟡 Mittel | Komplexer Flow mit async/Dialog |
| C5 (Game-Init) | 🟠 Erhöht | Init-Sequenz ist fragil, viele Abhängigkeiten |
| C6 (Keyboard) | 🟢 Niedrig | Klar isolierbar |
| C7 (Game-Loop) | 🟡 Mittel | Performance-sensitiv |

---

## 7. Testplan

### Vor jedem Schritt
- `npx vitest run` → alle 87 Tests grün ✅
- `npx ng lint` → 0 Errors ✅
- `ng serve` → Spiel startet, keine Console-Errors

### Nach jedem Schritt
- Gleiche Checks wie oben
- **Manueller Smoke-Test:** Wave starten, Tower bauen/verkaufen/upgraden, Enemies spawnen, Game-Over/Restart
- Falls Bot-System berührt: Bot aktivieren, Episode abwarten

### Regressions-Indikatoren
- FPS-Drop > 5% → Performance-Regression
- Console-Errors → Broken Event-Wiring
- UI-Elemente nicht reaktiv → Signal-Binding verloren

---

## 8. Zusammenfassung

```
VORHER:
┌─────────────────────────────────────┐
│    TowerDefenseComponent (2842 Z)   │
│    40 Services, 99 Methoden         │
│    UI + Logic + Debug + Init + ...  │
├─────────────────────────────────────┤
│    GameStateManager (764 Z)         │
│    Orchestrator + Placement + Debug │
└─────────────────────────────────────┘

NACHHER:
┌──────────────────────────────────────┐
│    TowerDefenseComponent (~900 Z)    │
│    15 Services, ~30 Methoden         │
│    Nur: Template + Lifecycle + Reads │
├──────────────────────────────────────┤
│    GameStateManager (~550 Z)         │
│    Orchestrator + Credits + Health   │
│    Hört auf Command-Events           │
├──────────────────────────────────────┤
│    EventBus (Command-Pattern)        │
│    Component ──emit──> Services      │
│    Services ──emit──> Services       │
└──────────────────────────────────────┘

Bestehende Services absorbieren Logik:
• TowerPlacementService  ← Tower Backend (LOS, Grid)
• EnemyDebugService      ← Debug-Enemy Actions
• TrainingClientService  ← Bot-Steuerung
• LocationChangeCoord.   ← Location-Flow
• EngineInitService      ← Init-Sequenz
• InputHandlerService    ← Keyboard-Shortcuts
• GlobalRouteGridService ← Defense-Reach
• MarkerVizService       ← Debug-Marker
• StreetRenderingService ← Street-Filter
```

**Kein einziger neuer Service.** Nur Verantwortung verschieben + EventBus konsequent nutzen.
