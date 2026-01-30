# Refactoring-Plan: God Objects auflösen — ABGESCHLOSSEN ✅

> **Branch:** `jarvis/refactor-god-objects`
> **Status:** ✅ Alle Phasen abgeschlossen (Januar 2025)
> **Ergebnis:** TowerDefenseStore ist Single Source of Truth. Component, Facades, AI lesen vom Store.

---

## Zusammenfassung

### Was wurde erreicht

1. **TowerDefenseStore** als zentraler Signal Store mit 4 Sub-Stores:
   - `GameStore` — credits, health, phase, wave, enemies, towers, bot/AI
   - `UIStore` — debug flags, layer toggles, build mode, wave debug
   - `EngineStore` — fps, tiles, camera, loading
   - `LocationStore` — coords, spawns, favorites, streets

2. **GameStateSyncService** — EventBus → Store Sync Layer:
   - Hört auf alle GSM-Events (wave:started, game:over, credits:changed, etc.)
   - Schreibt State-Änderungen in den Store
   - Store ist einzige Quelle für State-Reads

3. **Facade-Pattern** konsequent umgesetzt:
   - `TowerDefenseFacadeService` → Orchestrierung
   - `GameLoopFacadeService` → Wave, Game-Loop, Upgrades
   - `LocationFacadeService` → Location, DevWorld, Spawns
   - `VisualizationFacadeService` → Rendering, Camera, DPS-Viz

4. **EventBus Command-Pattern**:
   - Component → Facade → EventBus → GSM (Commands)
   - GSM → EventBus → SyncService → Store (State Updates)
   - Component ← Store (Reads)

5. **Bridge minimiert**: Nur noch Engine-Referenz, StreetNetwork, Canvas, Click-Callbacks

### Kennzahlen

| Metrik | Vorher | Nachher |
|--------|--------|---------|
| Component-Dependencies | ~40 | ~15 |
| Proxy-Signals im Component | 40+ (Service-Proxies) | Store-basiert |
| Source of Truth | GSM + Component + Services | Store (einzige) |
| Signal-Duplikate | Viele | Keine |
| Bridge-Signals | 15+ WritableSignals | 0 (nur Callbacks) |
| Tests | 346 ✅ | 346 ✅ |

### Architektur-Datenfluss

```
Component ──user input──> Facade.startWave()
                            │
                            ▼
                       EventBus.emit('command:start-wave')
                            │
                            ▼
                    GameStateManager (Engine)
                            │
                            ▼
                    EventBus.emit('wave:started')
                            │
                            ▼
                    GameStateSyncService
                            │
                            ▼
                    Store.phase.set('wave')
                            │
                       reads │
                            ▼
                    Component (Template)
```

---

## Abgeschlossene Phasen

### Phase A: GameStateManager bereinigen ✅
- Proxy-Methoden entfernt
- Tower-Placement-Backend in TowerPlacementService verschoben
- Defense-Reach in GlobalRouteGridService
- Debug-Methoden in MarkerVisualizationService

### Phase B: EventBus Command-Pattern ✅
- Command-Events definiert und implementiert
- GSM als Command-Listener
- Component nutzt EventBus für Mutations

### Phase C: Component-Logik in Services verschoben ✅
- Debug-Enemy-Logic → EnemyDebugService
- Bot/Training-Logic → TrainingClientService
- Visualization-Toggles → zugehörige Services
- Location-Flow → LocationChangeCoordinatorService
- Keyboard-Shortcuts → InputHandlerService

### Phase D: Signal Store ✅
- TowerDefenseStore mit 4 Sub-Stores erstellt
- GameStateSyncService: EventBus → Store sync
- Component liest vom Store (nicht von Services)
- Facades lesen vom Store
- AI-Services lesen vom Store

---

## Verbleibendes (bewusst nicht geändert)

### GameUIStateService koexistiert mit UIStore
- **Grund:** 80+ Referenzen, Persistence-Logic (localStorage), Throttled-Stats-Pipeline
- **Status:** Service behält Nische als Persistence-Layer + Toggle-Actions
- **UIStore/EngineStore** spiegeln die gleichen Signals — GameUIStateService ist der Writer

### Bridge hat 4 getter/setter + 4 Callbacks
- **Grund:** Mutable Runtime-Objekte (ThreeTilesEngine, HTMLCanvasElement)
- **Status:** Minimal — kann nicht weiter reduziert werden ohne Angular-Antipatterns

### GameStateManager behält Signals
- **Grund:** GSM ist der Game-Logic-Orchestrator mit Entity Managers
- **Status:** GSM-Signals werden via SyncService in den Store gespiegelt
- **Reads** gehen über den Store, **Writes** gehen über GSM

### Domain-spezifische TODOs
- `camera-control.service.ts:342` — Smooth camera animation
- `strategy-bot.factory.ts:84` — Advanced bot strategies
- `training-client.service.ts:316` — Sell execution
- Diese sind Feature-Requests, kein Refactoring-Schuld
