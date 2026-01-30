# Signal Store Architektur — TowerDefenseStore

## Überblick

Der `TowerDefenseStore` konsolidiert **alle verstreuten Signals** in einen zentralen Store, aufgeteilt in **4 Sub-Stores** nach Domain. Keine externen Libraries (kein NgRx, kein NGXS) — nur pure Angular `signal()`, `computed()`, `effect()`.

## Aktuelle Struktur (Stand: Januar 2025)

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
| `VisualizationFacade` | `services/visualization-facade.service.ts` | Rendering, Kamera, DPS-Viz, Height-Updates, Click-Handler |
| **`TowerDefenseFacade`** | `services/tower-defense-facade.service.ts` | **Orchestrierung** — Init, Engine-Setup, delegiert an Sub-Facades |

### Dateigrößen
| Datei | Zeilen |
|-------|--------|
| `tower-defense.component.ts` | 699 |
| `tower-defense-facade.service.ts` | 404 |
| `game-loop-facade.service.ts` | 429 |
| `location-facade.service.ts` | 456 |
| `visualization-facade.service.ts` | 662 |
| `tower-defense.store.ts` (Root) | 363 |
| Sub-Stores (4×) | ~370 |
| `game-state.manager.ts` | 603 |
| `debug-facade.service.ts` | 205 |

## Architektur-Prinzip: Store/Facade-Trennung

### Klare Verantwortungsverteilung

| Schicht | Verantwortung | Enthält |
|---------|--------------|---------|
| **Store** | State Container | Signals (state), Computed Values, set/update methods, resetAll() |
| **Facade** | Orchestration | Commands via EventBus, liest/schreibt UI-State über Store |
| **EventBus** | Engine-Kommunikation | Commands (start-wave, place-tower), Engine-Events (wave:started) |
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
- ❌ EventBus-Interaktion — gehört in Facade

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
│(UI Input)│     │(Command) │     │(Emit)    │     │(React)   │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                                        │
                                        ▼
                                  ┌──────────┐     ┌──────────┐
                                  │ EventBus │────>│ Store    │
                                  │(Response)│     │(UI State)│
                                  └──────────┘     └──────────┘
```

**Konkretes Beispiel — Wave starten:**
```
Component.startWave()
  → Facade.startWave()
    → EventBus.emit('command:start-wave', config)
      → GameStateManager reagiert, startet Wave
        → EventBus.emit('wave:started', { wave: 1, enemyCount: 10 })
          → Facade/Effect → Store.phase.set('wave')
          → Facade/Effect → Store.waveNumber.set(1)
```

**Konkretes Beispiel — Tower platzieren:**
```
Component.onTerrainClick()
  → TowerPlacementService.handleBuildClick()
    → EventBus.emit('command:place-tower', { position, typeId })
      → GameStateManager: Credit-Check + Place
        → EventBus.emit('tower:placed', { tower, cost })
          → Store.credits.update(c => c - cost)
          → Store.towerCount.update(n => n + 1)
```

## Das Problem (Ist-Zustand)

### Signal-Chaos: 40+ Proxy-Signals im Component

```typescript
// tower-defense.component.ts — AKTUELL
readonly loading = this.engineInit.loading;          // Proxy
readonly fps = this.uiState.fps;                     // Proxy
readonly buildMode = this.towerPlacement.buildMode;  // Proxy
readonly debugMode = this.uiState.debugMode;         // Proxy
readonly credits = this.gameState.credits;            // Proxy (indirekt)
readonly spawnPoints = signal<SpawnPoint[]>([]);      // Eigenes Signal
readonly useAIDirector = signal(false);               // Eigenes Signal
readonly baseCoords = signal(EMPTY_COORDS);           // Eigenes Signal
// ... 30+ weitere
```

**Probleme:**
1. **Kein Single Source of Truth** — Signals leben in 6 verschiedenen Services + dem Component
2. **Proxy-Signals** — Component exportiert nur `this.service.signal` — zero added value, pure Boilerplate
3. **FacadeComponentBridge** — Service mutiert Component-owned WritableSignals via Callback-Objekt (Antipattern)
4. **Untestbar** — Um `waveActive` zu testen, muss man den 500-Zeilen-Component instanziieren
5. **Unklare Ownership** — Wem gehört `spawnPoints`? Component? Facade? LocationMgmt? Alle drei!

### Die Bridge-Krücke

```typescript
// AKTUELL: FacadeComponentBridge — Service mutiert Component-State
export interface FacadeComponentBridge {
  spawnPoints: WritableSignal<SpawnPoint[]>;       // Component-owned
  baseCoords: WritableSignal<{ lat; lon }>;        // Component-owned
  useAIDirector: WritableSignal<boolean>;          // Component-owned
  isDevWorldRegenerating: WritableSignal<boolean>; // Component-owned
  // ... 12+ weitere WritableSignals + Callbacks
}
```

Die Facade ruft `bridge.spawnPoints.set(...)` auf — sie mutiert also State, der dem Component gehört. Das ist ein klares Zeichen, dass der State **weder** dem Component **noch** der Facade gehören sollte.

## Die Lösung: TowerDefenseStore

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
│  ┌─────────────┐ ┌──────────┐ ┌───────────────────┐  │
│  │ Engine       │ │ Bot/AI   │ │ Wave Debug        │  │
│  │ fps          │ │ botOn    │ │ enemySpeed        │  │
│  │ tileStats    │ │ skill    │ │ enemyHealth       │  │
│  │ sounds       │ │ aiDir    │ │ enemyCount        │  │
│  │ compass      │ │ explain  │ │ spawnMode         │  │
│  │ cameraDbg    │ │ ...      │ │ ...               │  │
│  └─────────────┘ └──────────┘ └───────────────────┘  │
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
                                 └─────────────┘
```

## Vorteile

### 1. Single Source of Truth
Jedes Signal existiert **genau einmal**. Kein `this.uiState.fps` → `this.fps` → Template.

### 2. Keine Proxy-Signals mehr
```typescript
// VORHER: Component (40+ Zeilen Proxy-Boilerplate)
readonly fps = this.uiState.fps;
readonly buildMode = this.towerPlacement.buildMode;
readonly credits = this.gameState.credits;

// NACHHER: Component
constructor(readonly store: TowerDefenseStore) {}
// Template: {{ store.fps() }}, {{ store.buildMode() }}
```

### 3. Keine Bridge mehr
```typescript
// VORHER: Facade braucht Bridge-Objekt mit 15+ WritableSignals
this.facade.initialize(this.buildFacadeBridge());

// NACHHER: Facade injected einfach den Store
constructor(private readonly store: TowerDefenseStore) {}
// store.spawnPoints.set([...])
```

### 4. Testbar
```typescript
// Unit Test
const store = TestBed.inject(TowerDefenseStore);
store.phase.set('wave');
expect(store.waveActive()).toBe(true);
expect(store.canStartWave()).toBe(false);

store.baseHealth.set(10);
expect(store.healthCritical()).toBe(true);
```

### 5. Component wird zur reinen View
```typescript
// NACHHER: Component hat KEINE Signals, KEINEN State
@Component({ ... })
export class TowerDefenseComponent {
  readonly store = inject(TowerDefenseStore);
  readonly facade = inject(TowerDefenseFacadeService);

  onStartWave() { this.facade.startWave(); }  // NOT store!
  onToggleBuild() { this.facade.toggleBuildMode(); }
  // Template bindet direkt an store.credits(), store.phase(), etc.
}
```

### 6. Klare Ownership

| Signal-Kategorie | Owner | Wer liest | Wer schreibt |
|------------------|-------|-----------|-------------|
| UI-State (debug, toggles) | Store | Component (Template) | Store direkt, Facade |
| Game-State (credits, health) | Store | Component (Template) | Facade via Effect (nach EventBus-Event) |
| Location (coords, spawns) | Store | Component, Facade | Facade (nach Location-Change) |
| Engine-Stats (fps, tiles) | Store | Component (Template) | Facade (aus Game-Loop) |
| Bot/AI | Store | Component (Template) | Facade (nach Bot-Events) |

## Migrationsplan

### Phase 1: Store erstellen ✅
- [x] `TowerDefenseStore` mit allen Signals und Interfaces
- [x] Computed Values definieren
- [x] Action-Method-Stubs entfernt — Store ist reiner State-Container
- [x] Sub-Stores erstellt: `GameStore`, `UIStore`, `EngineStore`, `LocationStore`
- [x] Root-Store als Aggregate-Fassade refactored
- [x] Types in `tower-defense.store.types.ts` extrahiert
- [x] `buildModeHints` als Config-Konstante in Component verschoben (kein reaktiver State)

### Phase 2: Store als Read-Layer einführen
- Store injizieren, aber NICHT als primäre Quelle verwenden
- Sync-Effects: `effect(() => store.credits.set(gameState.credits()))`
- Template schrittweise auf `store.xxx()` umstellen
- **Kein Breaking Change** — alter und neuer Code koexistieren

### Phase 3: Facade nutzt Store als State-Layer
- Facade schreibt UI-State über Store statt Bridge
- FacadeComponentBridge schrittweise abbauen
- Commands weiterhin über EventBus

### Phase 4: Services entkernen
- `GameUIStateService` Signals → Store (Service wird Persistence-Helper)
- `GameStateManager` Signals → Store (Manager wird reiner Logic-Coordinator)
- Component Proxy-Signals → entfernen
- FacadeComponentBridge → entfernen

### Phase 5: Cleanup
- Dead Code entfernen
- Tests schreiben
- Performance validieren (Signal-Count, Change Detection)

## Trade-offs

### Pro
- **Klarheit** — Wo lebt State? Im Store. Immer.
- **Testbarkeit** — Store isoliert testbar, kein DOM nötig
- **Refactoring-sicher** — Services können intern umgebaut werden, solange sie den Store updaten
- **DevTools** — Ein `console.log(inject(TowerDefenseStore))` zeigt alles

### Contra
- **God Object Risiko** — Der Store hatte ~60 Signals in einer Klasse.
  - *Gelöst:* Aufgeteilt in 4 Sub-Stores (GameStore, UIStore, EngineStore, LocationStore). Root-Store aggregiert als Fassade.
- **Doppelte Signals während Migration** — Phase 2-3 haben temporär zwei Quellen
  - *Mitigation:* Sync-Effects, klare TODO-Marker, zeitlich begrenzt
- **Performance** — Mehr Signals = mehr Change Detection?
  - *Mitigation:* Angular Signals sind lazy. Computed werden nur evaluiert wenn gelesen.
    OnPush + Signals = optimal. Kein Overhead gegenüber jetzigem Setup.

## Architektur-Entscheidungen

### Warum kein NgRx Signal Store?
- **Overkill** — Wir haben keine komplexen Reducers, keine Actions mit Metadata, kein DevTools-Replay
- **Lernkurve** — Das Team kennt Angular Signals; NgRx hat eigene Konzepte
- **Vendor Lock** — Reines Angular bleibt portabler
- **Performance** — NgRx Signal Store hat overhead für Features die wir nicht brauchen

### Sub-Store Architektur (umgesetzt)
- **Konsolidiert, dann gesplittet** — Nach der initialen Konsolidierung wurden natürliche Domain-Grenzen sichtbar
- **4 Sub-Stores:** `GameStore`, `UIStore`, `EngineStore`, `LocationStore`
- **Root-Store als Fassade:** `TowerDefenseStore` injiziert alle Sub-Stores und re-exportiert deren Signals
- **Cross-Cutting Concerns** bleiben im Root-Store — `canStartWave` braucht Signals aus Game, Engine und Location
- **Consumer-kompatibel** — Bestehender Code nutzt weiterhin `TowerDefenseStore`, keine Breaking Changes

### Warum `@Injectable({ providedIn: 'root' })`?
- **Singleton** — Es gibt genau ein Spiel, genau einen State
- **Lazy Loading** — Angular tree-shakes unused stores
- **Kein Provider-Array** — Einfachste Konfiguration

## Datei-Struktur

```
src/app/store/
  tower-defense.store.ts          ← Root-Store (Aggregate-Fassade, cross-cutting computed)
  tower-defense.store.types.ts    ← Shared Type Definitions (GamePhase, GeoCoord, etc.)
  game.store.ts                   ← Game State (credits, health, phase, wave, towers, bot/AI)
  ui.store.ts                     ← UI State (debug flags, layers, build mode, wave debug)
  engine.store.ts                 ← Engine State (fps, tiles, camera, loading)
  location.store.ts               ← Location State (coords, spawns, favorites)
  tower-defense.store.spec.ts     ← Unit Tests (Phase 5)
```

## Referenzen

- [Angular Signals RFC](https://github.com/angular/angular/discussions/49685)
- [Angular Signal Store Discussion](https://github.com/angular/angular/discussions/56472)
