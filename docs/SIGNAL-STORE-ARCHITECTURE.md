# Signal Store Architektur — TowerDefenseStore

**Stand:** 2026-09-13 (`useAIDirector`-Ownership: 2026-09-07)

## Überblick

Der `TowerDefenseStore` konsolidiert **alle verstreuten Signals** in einen zentralen Store, aufgeteilt in **6 Sub-Stores** nach Domain. Keine externen Libraries (kein NgRx, kein NGXS) — nur pure Angular `signal()`, `computed()`, `effect()`.

> **Hinweis (2026-05-10):** Der `DebugStore` wurde als 6. Sub-Store eingeführt. Vorher
> lagen die Debug-Panel-Signals direkt auf `WaveDebugService` / `TowerDebugService` /
> `EnemyDebugService` — laut Store/Facade-Trennung gehört State in Stores; die Services
> bleiben als API-Schicht erhalten und delegieren intern an den `DebugStore`.

## Aktuelle Struktur

### Sub-Stores
| Store | Datei | Domain | Signals |
|-------|-------|--------|---------|
| `GameStore` | `store/game.store.ts` | Game State | credits, health, phase, wave, enemies (`enemiesAlive`, `waveEnemyTotal`, `waveEnemiesLeft`), towers (`selectedTower`, `selectedTowerRevision`), Training/AI-Director |
| `UIStore` | `store/ui.store.ts` | UI State | debug flags, layer toggles, Quick-Actions-Menü (`openMenu`), Audio-Lautstärken, build mode, persistence |
| `EngineStore` | `store/engine.store.ts` | Engine State | fps, tiles, camera, compass |
| `LocationStore` | `store/location.store.ts` | Location State | coords, spawns, favorites, streets |
| `ResearchStore` | `store/research.store.ts` | Research State | active research, completed, `researchElapsed`, unlocks |
| `DebugStore` | `store/debug.store.ts` | Debug-Panel State | waveEnemy{Count,Speed,Health,Type}, waveSpawn{Mode,Delay}, towerSelectedId, towerOverrides, enemyPlacementMode, enemyOverrides |
| **`TowerDefenseStore`** | `store/tower-defense.store.ts` | **Root/Aggregat** | Re-exports, Loading-Signals aus `EngineInitializationService`, cross-cutting computeds, resetAll() |

Alle Sub-Stores sind `@Injectable({ providedIn: 'root' })`. Der Root-Store injiziert Game-, UI-, Engine-, Location- und ResearchStore; den `DebugStore` injizieren nur `WaveDebugService`, `TowerDebugService` und `EnemyDebugService`. Nicht jedes Sub-Store-Signal ist im Root-Store re-exportiert (z.B. `openMenu`, die Audio-Lautstärken, `perTowerLosFilter`, `researchElapsed`); solche Signals lesen Konsumenten direkt aus `UIStore` bzw. `ResearchStore`.

### Sub-Facades
| Facade | Datei | Verantwortung |
|--------|-------|--------------|
| `GameLoopFacade` | `services/facade/game-loop-facade.service.ts` | Wave-Management, Game-Loop, Restart, Tower-Upgrades, AI Director |
| `LocationFacade` | `services/facade/location-facade.service.ts` | Location-Erkennung, DevWorld, Spawns, Map-Cleanup |
| `VisualizationFacade` | `services/facade/visualization-facade.service.ts` | Rendering, Kamera, DPS-Viz, Height-Updates, Click-Handler, Toggles |
| `DebugFacade` | `services/debug/debug-facade.service.ts` | Debug-Log, Height-Debug, Display Options, VFX-Schalter, Enemy-Debug |
| **`TowerDefenseFacade`** | `services/facade/tower-defense-facade.service.ts` | **Orchestrierung** — Init, Engine-Setup, delegiert an Sub-Facades |

### GSM→Store Sync Layer
| Service | Datei | Verantwortung |
|---------|-------|--------------|
| `GameStateSyncService` | `services/infrastructure/game-state-sync.service.ts` | EventBus → Store: Sync aller Game-State-Events |

### Persistenz (localStorage)
| Key | Schreiber | Inhalt |
|-----|-----------|--------|
| `td-ui-state` | `UIStore` (lädt im Konstruktor, schreibt per `effect()` mit 500 ms Trailing-Debounce) | `infoOverlayVisible`, `streetsVisible`, `routesVisible`, `spatialGridDebugVisible`, `airSpatialGridDebugVisible`, `airRouteVisible`, `perTowerLosFilter`, `openMenu`, `musicVolume`, `sfxVolume`, `musicMuted`, `sfxMuted`. Ältere Stände mit einem Flag pro Menü öffnen beim Laden genau ein Menü |
| `td_display_options` | `DebugFacadeService` über `utils/display-options.storage.ts` (Angular-frei) | Display-Optionen und VFX-Schalter in einem Objekt. Die alten Keys `3dtd-fps-limit` und `td_screen_shake_enabled` faltet `loadDisplayOptions()` einmal ein und löscht sie |

Weitere Keys liegen in Services, nicht in Stores: `td_favorites_v2` (`LocationManagementService`), `td_debug_windows_v6` (`DebugWindowService`), `td_music_enabled` (`BackgroundMusicService`), `training-timescale` (`GameStateManager`), `td_geocode_cache_v1` (`GeocodingService`), `3dtd-tile-credentials` (`ConfigService`).

**Display-Optionen und VFX-Schalter liegen in keinem Store.** `DebugFacadeService` hält die Signals `healthBarsVisible`, `screenShakeEnabled`, `damageNumbersVisible`, `fpsLimit` und `vfx` (`VfxSettings` aus `three-engine/vfx-settings.ts`: `muzzleFlash`, `projectileTrails`, `impactEffects`, `groundMarks`, `freezeTint`, `bloom`, `colorGrading`) und startet sie aus dem gespeicherten Objekt. Quick Actions und das Display-Debug-Fenster lesen diese Signals. Eine Änderung geht an die Engine (`applyVfxSettings()`, `setFpsLimit()` usw.) und per `persistDisplayOptions()` als Merge ins Objekt; jeder Schreiber setzt nur seine eigenen Felder. `ScreenShakeService` liest seinen Startwert selbst über `loadDisplayOptions()`.

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
  → Facade.startWave() → GameLoopFacade.startWave()
    → EventBus.emit('command:start-wave', config)
      → GameCommandsHandler → GameStateManager.startWave() → WaveManager.startWave()
        → EventBus.emit('wave:started', { wave: 1, enemyCount: 10 })
          → GameStateSyncService → Store.phase.set('wave')
          → GameStateSyncService → Store.waveNumber.set(1)
          → GameStateSyncService → Store.enemiesAlive.set(0)   (zählt per enemy:spawned hoch)
          → GameStateSyncService → Store.waveEnemyTotal.set(10), Store.waveEnemiesLeft.set(10)
```

**Konkretes Beispiel: Enemy stirbt**
```
DamageApplicationService → EnemyManager.kill() → enemy:died Event
  → GameStateSyncService:
    → Store.enemiesAlive.update(n => Math.max(0, n - 1))
    → Store.waveEnemiesLeft.update(n => Math.max(0, n - 1))
  → GSM: Credits update → credits:changed Event
    → GameStateSyncService → Store.credits.set(newValue)
DamageApplicationService → tower:kill Event
  → GameStateSyncService → Store.selectedTowerRevision + 1 (nur beim gewählten Tower)
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
│  │ credits      │ │ openMenu │ │ baseCoords        │  │
│  │ baseHealth   │ │ volumes  │ │ centerCoords      │  │
│  │ phase        │ │ debug    │ │ spawnPoints       │  │
│  │ waveNumber   │ │ build    │ │ favorites         │  │
│  │ enemies      │ │ toggles  │ │ locationName      │  │
│  │ selectedTwr  │ │ ...      │ │ ...               │  │
│  └─────────────┘ └──────────┘ └───────────────────┘  │
│                                                        │
│  ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐│
│  │ Engine       │ │ Research     │ │ Debug           ││
│  │ fps          │ │ active       │ │ waveEnemyCount  ││
│  │ tileStats    │ │ completed    │ │ waveEnemySpeed  ││
│  │ sounds       │ │ progress     │ │ waveEnemyHealth ││
│  │ compass      │ │ unlocks      │ │ waveSpawnMode   ││
│  │ cameraDbg    │ │              │ │ towerOverrides  ││
│  │              │ │              │ │ enemyOverrides  ││
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
  onMapPlacementClick / onMapPlacementMove / exitMapPlacement
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
| UI-State (toggles, persistence) | Store (UIStore) | Component (Template) | Store direkt, Facade |
| Game-State (credits, health, phase, Wave-Zähler) | Store (GameStore) | Component, Facade, AI | GameStateSyncService (via EventBus) |
| Location (coords, spawns) | Store (LocationStore) | Component, Facade | Facade (nach Location-Change) |
| Engine-Stats (fps, tiles) | Store (EngineStore) | Component (Template) | Facade (aus Game-Loop) |
| Research-State | Store (ResearchStore) | Component, ResearchManager | GameStateSyncService (`research:state-changed`, `research:progress`, `research:completed`) |
| Kills/Stats des gewählten Towers | Store (GameStore `selectedTowerRevision`) | Sidebar (Tower-/Research-Panel) | GameStateSyncService (`tower:kill`, `tower:upgraded`) |
| Debug-Panel (wave/tower/enemy overrides) | Store (DebugStore) | WaveDebug/TowerDebug/EnemyDebug Services | Services intern (delegieren an Store) |
| Display-Optionen, VFX-Schalter | kein Store: DebugFacadeService-Signals, localStorage `td_display_options` | Quick Actions, Display-Debug-Fenster | DebugFacadeService |
| Bot/AI (useAIDirector, aiExplanation) | Store (GameStore) | Component (Template) | Facade (Toggle, Fehlerpfad, DevWorld-Init; `aiExplanation` beim Wave-Start) |
| Bot/AI (botEnabled, botSkillLevel, botAutoMode) | TrainingClientService | Component, Facade | TrainingClientService intern |

#### `useAIDirector`: Default `true`, kein Auto-Enable-Effect

`useAIDirector` steht seit 2026-09-07 per Default auf `true` (auch in
`resetAll()`). Der Wave-Director ist regelbasiert und braucht weder Modell noch
Netzwerk, es gibt also kein Startfenster, in dem er nicht verfuegbar waere.

Vorher war der Default `false` und ein `effect()` im `GameLoopFacadeService`
schaltete ihn ein, sobald das ONNX-Modell geladen war. Dieser Effect ist
**ersatzlos entfernt** — und zwar nicht nur, weil er ueberfluessig wurde:

> Ein `effect()`, der ein Signal liest **und** schreibt, das er selbst als
> Bedingung auswertet, feuert auf den eigenen Schreibvorgang neu. Der Effect las
> `useAIDirector()` neben dem Modell-Status; mit einem immer verfuegbaren
> Director war die Bedingung permanent wahr und der Effect zwang das Flag
> zurueck auf `true`. Konsequenz: der UI-Toggle war wirkungslos, der Fehlerpfad
> konnte den Director nicht abschalten, und ein Store-Reset wurde sofort
> ueberschrieben.

Geschrieben wird das Flag außer von den Store-Resets an drei Stellen, alle in
den Facades: `GameLoopFacadeService.toggleAIDirector()` (User), der Fehlerpfad
in `startWaveWithAI()`, der auf manuelle Wave-Erzeugung zurückfällt, und
`TowerDefenseFacadeService` beim Init in der DevWorld (setzt `true`). Das
entspricht der Regel oben: **State im Store, Entscheidung in der Facade**.

## Migrationsplan — ABGESCHLOSSEN ✅

### Phase 1: Store erstellen ✅
- [x] `TowerDefenseStore` mit allen Signals und Interfaces
- [x] Computed Values definieren
- [x] Sub-Stores erstellt: `GameStore`, `UIStore`, `EngineStore`, `LocationStore`, `ResearchStore`
- [x] `DebugStore` als 6. Sub-Store ergänzt (2026-05-10) — Migration der Wave/Tower/Enemy-Debug-Signals aus den jeweiligen Services
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
- [x] Tests grün (zuletzt 487/487 nach Code-Review-Sprint 2026-03)
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
  - *Gelöst:* Aufgeteilt in 6 Sub-Stores (GameStore, UIStore, EngineStore, LocationStore, ResearchStore, DebugStore). Root-Store aggregiert als Fassade.
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
- **6 Sub-Stores:** `GameStore`, `UIStore`, `EngineStore`, `LocationStore`, `ResearchStore`, `DebugStore`
- **Root-Store als Fassade:** `TowerDefenseStore` injiziert alle Sub-Stores außer dem `DebugStore` und re-exportiert den Großteil ihrer Signals (Ausnahmen siehe [Sub-Stores](#sub-stores))
- **Cross-Cutting Concerns** bleiben im Root-Store — `canStartWave` braucht Signals aus Game, Engine und Location
- **Consumer-kompatibel** — Bestehender Code nutzt weiterhin `TowerDefenseStore`
- **`DebugStore`-Sonderrolle:** Hält ausschließlich Debug-Panel-State (Wave/Tower/Enemy-Overrides). `WaveDebugService` / `TowerDebugService` / `EnemyDebugService` bleiben als Service-Schicht und delegieren ihre Signals an den Store. Konsumenten lesen weiterhin z.B. `waveDebug.enemyCount()` — die Quelle ist transparent verlegt.

### GameStateSyncService (EventBus → Store)
- **Warum nicht direkt im Store?** — Store soll keine EventBus-Dependency haben (pure state)
- **Warum nicht in der Facade?** — Separation of Concerns. Facade = Commands. SyncService = State-Sync.
- **Lifecycle:** `initialize(eventBus)` nach GSM.initialize(), `dispose()` bei Game-Dispose

### Verbleibende Bridge
- **Enthält NUR:** Engine-Referenz, StreetNetwork-State, Canvas, Click-Callbacks (Terrain, Build-Mode, Enemy- und Map-Placement)
- **Warum nicht im Store?** — Mutable Runtime-Objekte (ThreeTilesEngine, HTMLCanvasElement) passen nicht in ein Signal-Store-Pattern
- **Minimal:** 5 getter/setter Paare + 1 getter (Canvas) + 7 Callbacks

## Datei-Struktur

```
src/app/store/
  tower-defense.store.ts          ← Root-Store (Aggregate-Fassade, cross-cutting computed)
  tower-defense.store.types.ts    ← Shared Type Definitions (GamePhase, GeoCoord, etc.)
  game.store.ts                   ← Game State (credits, health, phase, wave, towers, AI-Director)
  ui.store.ts                     ← UI State (debug flags, layers, menus, audio, build mode, persistence)
  engine.store.ts                 ← Engine State (fps, tiles, camera, compass)
  location.store.ts               ← Location State (coords, spawns, favorites)
  research.store.ts               ← Research State (active, completed, elapsed, unlocks)
  debug.store.ts                  ← Debug-Panel State (wave/tower/enemy overrides)
  *.spec.ts                       ← Unit Tests

src/app/services/
  infrastructure/game-state-sync.service.ts  ← EventBus → Store sync layer
  facade/tower-defense-facade.service.ts     ← Main orchestration facade
  facade/game-loop-facade.service.ts         ← Wave, game loop, upgrades
  facade/location-facade.service.ts          ← Location detection, DevWorld
  facade/visualization-facade.service.ts     ← Rendering, camera, viz
  debug/debug-facade.service.ts              ← Debug operations, display options, VFX settings

src/app/utils/
  display-options.storage.ts      ← localStorage-Objekt der Display-Optionen (Angular-frei)
```

## Referenzen

- [Angular Signals RFC](https://github.com/angular/angular/discussions/49685)
- [Angular Signal Store Discussion](https://github.com/angular/angular/discussions/56472)
