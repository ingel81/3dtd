# Migration: Nächste Schritte

> Handoff-Dokument für die Weiterarbeit nach PR #2 (`jarvis/refactor-god-objects`)

## Status Quo

Der Store (`TowerDefenseStore` + 4 Sub-Stores) existiert und ist **teilweise** als Single Source of Truth aktiv:

| Bereich | Store aktiv? | Writer | Reader |
|---------|-------------|--------|--------|
| **Game-State** (credits, health, phase, wave, enemies, towers) | ✅ Ja | `GameStateSyncService` (via EventBus) | Component, Facades, AI-Services |
| **Location** (coords, spawns, favorites) | ✅ Ja | Facades direkt | Component |
| **Engine-Stats** (fps, tileStats, compass, sounds) | ❌ Nein | `GameUIStateService.updateThrottledStats()` | Component liest aus Store → zeigt 0 |
| **Debug-Toggles** (debugMode, streetsVisible, etc.) | ❌ Nein | `GameUIStateService` | Component liest aus Store → out of sync |
| **Camera-Debug** | ❌ Nein | `GameUIStateService` via VizFacade | Component liest aus Store → Toggle funktioniert nicht |
| **Build-Mode** (buildMode, selectedTowerType) | ❌ Nein | `TowerPlacementService` eigene Signals | Component liest aus Store → out of sync |

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

### 5. GameUIStateService schrittweise ablösen

**Langfristiges Ziel:** `GameUIStateService` wird komplett durch Stores + einen kleinen `StorePersistenceService` ersetzt.

**Schrittweise Migration:**
1. Stats-Writing → EngineStore ✅ (Schritt 1)
2. Debug-Toggles → UIStore ✅ (Schritt 2)
3. Camera-Debug → EngineStore ✅ (Schritt 3)
4. Build-Mode → UIStore ✅ (Schritt 4)
5. Persistence → `StorePersistenceService` (Effects die Store→localStorage synced)
6. Verbleibende Referenzen auf GameUIStateService → Store
7. `GameUIStateService` entfernen

**Tipp:** `grep -rn "GameUIStateService\|uiState" src/app/ --include="*.ts" | grep -v ".spec.ts"` zeigt alle Referenzen.

## Architektur-Regeln

```
Component → liest NUR vom Store (Signals + Computed)
Component → ruft Facades für Actions auf
Facades → schreiben in Store (UI-State) + emittieren EventBus (Engine-Commands)
EventBus → GSM reagiert auf Commands, emittiert Events
GameStateSyncService → hört auf GSM-Events, schreibt Game-State in Store
Services → lesen/schreiben Store (nicht GameUIStateService)
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
| `src/app/services/game-ui-state.service.ts` | **LEGACY** — wird schrittweise durch Stores ersetzt |
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
