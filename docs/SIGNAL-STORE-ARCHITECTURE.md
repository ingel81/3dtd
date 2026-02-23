# Signal Store Architektur — TowerDefenseStore

## Überblick

Der `TowerDefenseStore` konsolidiert **alle verstreuten Signals** in einen zentralen Store, aufgeteilt in **4 Sub-Stores** nach Domain. Keine externen Libraries (kein NgRx, kein NGXS) — nur pure Angular `signal()`, `computed()`, `effect()`.

## Aktuelle Struktur (Stand: Januar 2026)

### Sub-Stores
| Store | Datei | Domain | Signals |
|-------|-------|--------|---------|
| `GameStore` | `store/game.store.ts` | Game State | credits, health, phase, wave, enemies, towers |
| `UIStore` | `store/ui.store.ts` | UI State | debug flags, layer toggles, build mode, menus |
| `EngineStore` | `store/engine.store.ts` | Engine State | fps, tiles, camera, loading |
| `LocationStore` | `store/location.store.ts` | Location State | coords, spawns, favorites, streets |
| **`TowerDefenseStore`** | `store/tower-defense.store.ts` | **Root/Aggregat** | Re-exports, cross-cutting computeds, resetAll() |

### Sub-Facades
| Facade | Datei | Verantwortung |
|--------|-------|--------------|
| `GameLoopFacade` | `services/game-loop-facade.service.ts` | Wave-Management, Game-Loop, Restart, Tower-Upgrades, AI Director |
| `LocationFacade` | `services/location-facade.service.ts` | Location-Erkennung, DevWorld, Spawns, Map-Cleanup |
| `VisualizationFacade` | `services/visualization-facade.service.ts` | Rendering, Kamera, DPS-Viz, Height-Updates, Click-Handler, Toggles |
| `DebugFacade` | `services/debug-facade.service.ts` | Debug-Log, Height-Debug, Display Options, Enemy-Debug |
| **`TowerDefenseFacade`** | `services/tower-defense-facade.service.ts` | **Orchestrierung** — Init, Engine-Setup, delegiert an Sub-Facades |

### GSM→Store Sync Layer
| Service | Datei | Verantwortung |
|---------|-------|--------------|
| `GameStateSyncService` | `services/game-state-sync.service.ts` | EventBus → Store: Sync aller Game-State-Events |

## Architektur-Prinzip: Store/Facade-Trennung

### Klare Verantwortungsverteilung

| Schicht | Verantwortung | Enthält |
|---------|--------------|---------|
| **Store** | State Container | Signals (state), Computed Values, set/update methods, resetAll() |
| **Facade** | Orchestration | Commands via EventBus, liest/schreibt UI-State über Store |
| **EventBus** | Engine-Kommunikation | Commands (start-wave, place-tower), Engine-Events (wave:started) |
| **GameStateSyncService** | GSM→Store Bridge | Hört EventBus, schreibt Store-Signals |
| **Component** | Pure View | Template-Bindings, User-Input → Facade, Angular Lifecycle |

### Was gehört wohin?

**Store (TowerDefenseStore):**
- ✅ `signal<number>(100)` — WritableSignals
- ✅ `computed(() => this.phase() === 'wave')` — Computed Values
- ✅ `resetGameState()` — State-Reset
- ✅ `updateEngineStats()` — Batch-State-Updates (pure, keine Side-Effects)
- ✅ `appendDebugLog()` — Convenience-Mutations
- ❌ `startWave()` — gehört in Facade
- ❌ `placeTower()` — gehört in Facade
- ❌ `upgradeTower()` — gehört in Facade
- ❌ EventBus-Interaktion — gehört in Facade / SyncService

**Facade (TowerDefenseFacadeService):**
- ✅ `startWave()` → `EventBus.emit('command:start-wave')`
- ✅ `placeTower()` → `EventBus.emit('command:place-tower')`
- ✅ `restartGame()` → `EventBus.emit('command:restart-game')`
- ✅ EventBus-Subscriptions für UI-State-Sync
- ✅ Service-Orchestrierung (Camera, Markers, Routes, etc.)
- ❌ Eigene Signals — benutzt Store-Signals
- ❌ Direkte State-Mutations ohne EventBus für Engine-Commands

### Datenfluss-Muster

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│Component │────>│ Facade   │────>│ EventBus │────>│ Engine   │
│(UI Input)│     │(Command) │     │(Emit)    │     │(GSM)     │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                                        │
                                        ▼
                                  ┌──────────┐     ┌──────────┐
                                  │ SyncSvc  │────>│ Store    │
                                  │(EventBus │     │(Signals) │
                                  │ Listener)│     │          │
                                  └──────────┘     └──────────┘
                                                        │
                                                   reads │
                                                        ▼
                                                  ┌──────────┐
                                                  │Component │
                                                  │(Template)│
                                                  └──────────┘
```

**Konkretes Beispiel — Wave starten:**
```
Component.startWave()
  → Facade.startWave()
    → EventBus.emit('command:start-wave', config)
      → GameStateManager reagiert, startet Wave
        → EventBus.emit('wave:started', { wave: 1, enemyCount: 10 })
          → GameStateSyncService → Store.phase.set('wave')
          → GameStateSyncService → Store.waveNumber.set(1)
          → GameStateSyncService → Store.enemiesAlive.set(10)
```

**Konkretes Beispiel — Enemy stirbt:**
```
CombatComponent → enemy:died Event
  → GameStateSyncService:
    → Store.enemiesAlive.update(n => n - 1)
  → GSM: Credits update → credits:changed Event
    → GameStateSyncService → Store.credits.set(newValue)
```

## Die Lösung: TowerDefenseStore + GameStateSyncService

```
┌──────────────────────────────────────────────────────┐
│                  TowerDefenseStore                     │
│  @Injectable({ providedIn: 'root' })                  │
│  PURE STATE CONTAINER — keine Action-Methods!          │
│                                                        │
│  ┌─────────────┐ ┌──────────┐ ┌───────────────────┐  │
│  │ Game State   │ │ UI State │ │ Location          │  │
│  │ credits      │ │ loading  │ │ baseCoords        │  │
│  │ baseHealth   │ │ error    │ │ centerCoords      │  │
│  │ phase        │ │ debug    │ │ spawnPoints       │  │
│  │ waveNumber   │ │ build    │ │ favorites         │  │
│  │ enemies      │ │ toggles  │ │ locationName      │  │
│  │ selectedTwr  │ │ ...      │ │ ...               │  │
│  └─────────────┘ └──────────┘ └───────────────────┘  │
│                                                        │
│  ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐│
│  │ Engine       │ │ Bot/AI       │ │ Wave Debug      ││
│  │ fps          │ │ useAIDir     │ │ enemySpeed      ││
│  │ tileStats    │ │ aiExplain    │ │ enemyHealth     ││
│  │ sounds       │ │ (rest in     │ │ enemyCount      ││
│  │ compass      │ │ Training-    │ │ spawnMode       ││
│  │ cameraDbg    │ │ Client-Svc)  │ │ ...             ││
│  └─────────────┘ └──────────────┘ └─────────────────┘│
│                                                        │
│  ═══════ Computed ════════════════════════════════════ │
│  waveActive, isGameOver, canStartWave, healthPercent  │
│  healthCritical, canPlaceTowers, gameStarted          │
│                                                        │
│  ═══════ State Mutations (pure, no side effects) ════ │
│  resetGameState(), resetAll(), updateEngineStats()    │
│  appendDebugLog(), clearDebugLog()                    │
└──────────────────────────────────────────────────────┘
         │                              │
    reads signals                  reads/writes
         │                              │
    ┌────▼─────┐                 ┌──────▼──────┐
    │Component │                 │   Facade    │
    │(pure view│                 │ (Commands   │
    │ template)│                 │  via Event- │
    │          │───user input──>│  Bus)       │
    └──────────┘                 └──────┬──────┘
                                        │
                                   EventBus
                                        │
                                 ┌──────▼──────┐
                                 │   Engine    │
                                 │ (GSM, Mgrs)│
                                 └──────┬──────┘
                                        │
                                   EventBus
                                        │
                                 ┌──────▼──────┐
                                 │  SyncService│
                                 │  → Store    │
                                 └─────────────┘
```

## Vorteile

### 1. Single Source of Truth
Jedes Signal existiert **genau einmal** im Store. Component, Facades, AI-Services lesen alle vom Store.

### 2. Keine Proxy-Signals mehr
```typescript
// VORHER: Component (40+ Zeilen Proxy-Boilerplate von verschiedenen Services)
readonly fps = this.uiState.fps;
readonly buildMode = this.towerPlacement.buildMode;
readonly credits = this.gameState.credits;

// NACHHER: Component liest vom Store
readonly fps = this.store.fps;
readonly buildMode = this.store.buildMode;
readonly credits = this.store.credits;
```

### 3. Minimale Bridge
```typescript
// Bridge enthält nur noch mutable Engine-Infrastruktur
export interface FacadeComponentBridge {
  getEngine: () => ThreeTilesEngine | null;
  setEngine: (e: ThreeTilesEngine | null) => void;
  getStreetNetwork / setStreetNetwork, etc.
  getCanvasElement: () => HTMLCanvasElement;
  onTerrainClick / onMouseMove / exitBuildMode / handleEnemyPlacement
}
```

### 4. Testbar
```typescript
const store = TestBed.inject(TowerDefenseStore);
store.phase.set('wave');
expect(store.waveActive()).toBe(true);
expect(store.canStartWave()).toBe(false);
```

### 5. Klare Ownership

| Signal-Kategorie | Owner | Wer liest | Wer schreibt |
|------------------|-------|-----------|-------------|
| UI-State (debug, toggles) | Store (UIStore) | Component (Template) | Store direkt, Facade |
| Game-State (credits, health) | Store (GameStore) | Component, Facade, AI | GameStateSyncService (via EventBus) |
| Location (coords, spawns) | Store (LocationStore) | Component, Facade | Facade (nach Location-Change) |
| Engine-Stats (fps, tiles) | Store (EngineStore) | Component (Template) | Facade (aus Game-Loop) |
| Bot/AI (useAIDirector, aiExplanation) | Store (GameStore) | Component (Template) | Facade (nach Bot-Events) |
| Bot/AI (botEnabled, botSkillLevel, botAutoMode) | TrainingClientService | Component, Facade | TrainingClientService intern |

## Migrationsplan — ABGESCHLOSSEN ✅

### Phase 1: Store erstellen ✅
- [x] `TowerDefenseStore` mit allen Signals und Interfaces
- [x] Computed Values definieren
- [x] Sub-Stores erstellt: `GameStore`, `UIStore`, `EngineStore`, `LocationStore`
- [x] Root-Store als Aggregate-Fassade refactored
- [x] Types in `tower-defense.store.types.ts` extrahiert

### Phase 2: Store als Read-Layer einführen ✅
- [x] GameStateSyncService erstellt — EventBus → Store sync
- [x] Alle EventBus-Events (wave, game, credits, health, tower, enemy) synced
- [x] Template schrittweise auf `store.xxx()` umgestellt
- [x] GameSidebar nutzt Store statt GameStateManager-Input

### Phase 3: Facade nutzt Store als State-Layer ✅
- [x] GameLoopFacade liest phase/credits/health vom Store
- [x] LocationFacade liest phase/waveNumber vom Store
- [x] AI-Services (AIDataCollector, TrainingClient) lesen vom Store
- [x] InputHandler liest selectedTowerId vom Store
- [x] Commands weiterhin über EventBus → GSM

### Phase 4: Services entkernen ✅
- [x] Component-Signals von 40+ Service-Proxies auf Store umgestellt
- [x] GameUIStateService entfernt — Persistence lebt in UIStore-Konstruktor
- [x] GSM bleibt als Game-Logic-Orchestrator (update loop, entity managers)
- [x] Bridge auf Minimum reduziert (5 getter/setter-Paare + Canvas getter + 4 Callbacks)

### Phase 5: Cleanup ✅
- [x] Dead code: Duplicate `activeSounds` entfernt
- [x] GameSidebar: `gameState` Input entfernt, nutzt Store direkt
- [x] Alle 223 Tests grün
- [x] Lint clean, Build OK
- [x] Dokumentation aktualisiert

## Trade-offs

### Pro
- **Klarheit** — Wo lebt State? Im Store. Immer.
- **Testbarkeit** — Store isoliert testbar, kein DOM nötig
- **Refactoring-sicher** — Services können intern umgebaut werden, solange sie den Store updaten
- **DevTools** — Ein `console.log(inject(TowerDefenseStore))` zeigt alles

### Contra
- **God Object Risiko** — Der Store hatte ~60 Signals in einer Klasse.
  - *Gelöst:* Aufgeteilt in 4 Sub-Stores (GameStore, UIStore, EngineStore, LocationStore). Root-Store aggregiert als Fassade.
- **Performance** — Mehr Signals = mehr Change Detection?
  - *Mitigation:* Angular Signals sind lazy. Computed werden nur evaluiert wenn gelesen.
    OnPush + Signals = optimal. Kein Overhead gegenüber jetzigem Setup.

## Architektur-Entscheidungen

### Warum kein NgRx Signal Store?
- **Overkill** — Wir haben keine komplexen Reducers, keine Actions mit Metadata, kein DevTools-Replay
- **Lernkurve** — Das Team kennt Angular Signals; NgRx hat eigene Konzepte
- **Vendor Lock** — Reines Angular bleibt portabler
- **Performance** — NgRx Signal Store hat overhead für Features die wir nicht brauchen

### Sub-Store Architektur
- **4 Sub-Stores:** `GameStore`, `UIStore`, `EngineStore`, `LocationStore`
- **Root-Store als Fassade:** `TowerDefenseStore` injiziert alle Sub-Stores und re-exportiert deren Signals
- **Cross-Cutting Concerns** bleiben im Root-Store — `canStartWave` braucht Signals aus Game, Engine und Location
- **Consumer-kompatibel** — Bestehender Code nutzt weiterhin `TowerDefenseStore`

### GameStateSyncService (EventBus → Store)
- **Warum nicht direkt im Store?** — Store soll keine EventBus-Dependency haben (pure state)
- **Warum nicht in der Facade?** — Separation of Concerns. Facade = Commands. SyncService = State-Sync.
- **Lifecycle:** `initialize(eventBus)` nach GSM.initialize(), `dispose()` bei Game-Dispose

### Verbleibende Bridge
- **Enthält NUR:** Engine-Referenz, StreetNetwork, Canvas, Click-Callbacks
- **Warum nicht im Store?** — Mutable Runtime-Objekte (ThreeTilesEngine, HTMLCanvasElement) passen nicht in ein Signal-Store-Pattern
- **Minimal:** 5 getter/setter Paare + 1 getter (Canvas) + 4 Callbacks

## Datei-Struktur

```
src/app/store/
  tower-defense.store.ts          ← Root-Store (Aggregate-Fassade, cross-cutting computed)
  tower-defense.store.types.ts    ← Shared Type Definitions (GamePhase, GeoCoord, etc.)
  game.store.ts                   ← Game State (credits, health, phase, wave, towers, bot/AI)
  ui.store.ts                     ← UI State (debug flags, layers, build mode, wave debug)
  engine.store.ts                 ← Engine State (fps, tiles, camera, loading)
  location.store.ts               ← Location State (coords, spawns, favorites)
  *.spec.ts                       ← Unit Tests

src/app/services/
  game-state-sync.service.ts      ← EventBus → Store sync layer
  tower-defense-facade.service.ts ← Main orchestration facade
  game-loop-facade.service.ts     ← Wave, game loop, upgrades
  location-facade.service.ts      ← Location detection, DevWorld
  visualization-facade.service.ts ← Rendering, camera, viz
  debug-facade.service.ts         ← Debug operations, display options
```

## Referenzen

- [Angular Signals RFC](https://github.com/angular/angular/discussions/49685)
- [Angular Signal Store Discussion](https://github.com/angular/angular/discussions/56472)
