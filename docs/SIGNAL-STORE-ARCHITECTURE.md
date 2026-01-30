# Signal Store Architektur — TowerDefenseStore

## Überblick

Der `TowerDefenseStore` konsolidiert **alle verstreuten Signals** aus 6+ Klassen in einen einzigen, zentralen Store. Keine externen Libraries (kein NgRx, kein NGXS) — nur pure Angular `signal()`, `computed()`, `effect()`.

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
│  ═══════ Actions ═════════════════════════════════════ │
│  placeTower(), sellTower(), upgradeTower()             │
│  startWave(), restartGame(), toggleBuildMode()         │
│  toggleDebug(), addSpawnPoint(), ...                   │
└──────────────────────────────────────────────────────┘
         │                              │
    reads/actions                  reads/actions
         │                              │
    ┌────▼─────┐                 ┌──────▼──────┐
    │Component │                 │  Services   │
    │(pure view│                 │ (Facade,    │
    │ template)│                 │  GameState, │
    │          │                 │  etc.)      │
    └──────────┘                 └─────────────┘
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

  onStartWave() { this.store.startWave(); }
  onToggleBuild() { this.store.toggleBuildMode(); }
  // Template bindet direkt an store.credits(), store.phase(), etc.
}
```

## Migrationsplan

### Phase 1: Store erstellen ✅
- [x] `TowerDefenseStore` mit allen Signals und Interfaces
- [x] Computed Values definieren
- [x] Action-Method-Stubs mit TODO

### Phase 2: Store als Read-Layer einführen
- Store injizieren, aber NICHT als primäre Quelle verwenden
- Sync-Effects: `effect(() => store.credits.set(gameState.credits()))` 
- Template schrittweise auf `store.xxx()` umstellen
- **Kein Breaking Change** — alter und neuer Code koexistieren

### Phase 3: Store als Write-Layer
- Action-Methods implementieren (emit Events via EventBus)
- Component-Methoden delegieren an `store.startWave()` etc.
- FacadeComponentBridge schrittweise abbauen

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
- **God Object Risiko** — Der Store hat ~60 Signals. Das ist viel.
  - *Mitigation:* Logische Gruppierung in Sections. Später ggf. Sub-Stores (GameStore, UIStore, LocationStore).
- **Doppelte Signals während Migration** — Phase 2-3 haben temporär zwei Quellen
  - *Mitigation:* Sync-Effects, klare TODO-Marker, zeitlich begrenzt
- **Performance** — Mehr Signals = mehr Change Detection?
  - *Mitigation:* Angular Signals sind lazy. Computed werden nur evaluiert wenn gelesen.
    OnPush + Signals = optimal. Kein Overhead gegenüber jetzigem Setup.
- **Kein Slicing** — NgRx Signal Store bietet `signalStoreFeature()` für Modularität.
  - *Mitigation:* Wir brauchen das (noch) nicht. 60 Signals sind manageable.
    Falls nötig: Sub-Stores mit eigenem `@Injectable()`.

## Architektur-Entscheidungen

### Warum kein NgRx Signal Store?
- **Overkill** — Wir haben keine komplexen Reducers, keine Actions mit Metadata, kein DevTools-Replay
- **Lernkurve** — Das Team kennt Angular Signals; NgRx hat eigene Konzepte (Features, Methods, etc.)
- **Vendor Lock** — Reines Angular bleibt portabler
- **Performance** — NgRx Signal Store hat overhead für Features wir nicht brauchen

### Warum nicht mehrere kleine Stores?
- **Erst konsolidieren, dann splitten** — Wir wissen noch nicht, wo die natürlichen Grenzen sind
- **Cross-Cutting Concerns** — `canStartWave` braucht `loading`, `spawnPoints`, `phase`, `isGameOver` — das sind 4 verschiedene "Domains"
- **Einfachheit** — Ein Store mit Sections ist einfacher als 5 Stores mit Cross-Injection

### Warum `@Injectable({ providedIn: 'root' })`?
- **Singleton** — Es gibt genau ein Spiel, genau einen State
- **Lazy Loading** — Angular tree-shakes unused stores
- **Kein Provider-Array** — Einfachste Konfiguration

## Datei-Struktur

```
src/app/store/
  tower-defense.store.ts          ← Haupt-Store (diese Datei)
  tower-defense.store.spec.ts     ← Unit Tests (Phase 5)
```

## Referenzen

- [Angular Signals RFC](https://github.com/angular/angular/discussions/49685)
- [Angular Signal Store Discussion](https://github.com/angular/angular/discussions/56472)
- [Manfred Steyer: Signal Store Patterns](https://www.angulararchitects.io/en/blog/the-new-ngrx-signal-store-for-angular-critical-review/)
