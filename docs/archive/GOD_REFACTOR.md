# GOD Object Refactoring Plan

> **ARCHIVIERT** — Refactoring abgeschlossen (01/2026). Aktueller Stand: siehe [REFACTORING-PLAN.md](REFACTORING-PLAN.md) und [ARCHITECTURE.md](../ARCHITECTURE.md).

Vollständiger Umsetzungsplan zur Aufspaltung der God Objects im 3DTD-Projekt.

---

## Übersicht

| God Object | Vorher | Ziel | Aktuell | Status |
|------------|--------|------|---------|--------|
| **TowerDefenseComponent** | 2.697 | ~1.200 | 1.799 | Phase 2 ✅ |
| **GameStateManager** | 1.079 | ~400 | 523 | Phase 1 ✅ |

### Neue Services

| Service | Zeilen | Phase |
|---------|--------|-------|
| `combat-effect.service.ts` | 330 | Phase 1 |
| `hq-damage.service.ts` | 238 | Phase 1 |
| `tower-combat.service.ts` | 173 | Phase 1 |
| `street-rendering.service.ts` | 199 | Phase 2 |
| `location-change-coordinator.service.ts` | 406 | Phase 2 |

---

## Phase 0: Template & CSS Extraktion ✅ ERLEDIGT

**Status:** Abgeschlossen am 2026-01-19

### Ziel
Template (173 Zeilen) und CSS (389 Zeilen) aus `tower-defense.component.ts` in separate Dateien extrahieren.

### Neue Dateien

```
src/app/
├── tower-defense.component.ts      (2697 → ~2100 Zeilen)
├── tower-defense.component.html    (NEU - 173 Zeilen)
└── tower-defense.component.scss    (NEU - ~380 Zeilen)
```

### Umsetzung

**Schritt 1:** Template-Datei erstellen
```
Datei: src/app/tower-defense.component.html
Inhalt: Zeilen 125-295 aus tower-defense.component.ts (ohne Backticks)
```

**Schritt 2:** SCSS-Datei erstellen
```
Datei: src/app/tower-defense.component.scss
Inhalt: Alle CSS-Regeln AUSSER :host Block mit TD_CSS_VARS
```

**Schritt 3:** Component Decorator anpassen
```typescript
// VORHER:
@Component({
  template: `...`,
  styles: `...`,
})

// NACHHER:
@Component({
  templateUrl: './tower-defense.component.html',
  styleUrls: ['./tower-defense.component.scss'],
  styles: [`
    :host {
      display: contents;
      ${TD_CSS_VARS}
    }
  `],
})
```

**Hinweis:** Angular erlaubt `styleUrls` UND `styles` gleichzeitig. Die TD_CSS_VARS-Integration bleibt so funktionsfähig.

### Risiken
- **TD_CSS_VARS:** Bleibt inline im :host Block (keine Migration nötig)
- **Template-Bindungen:** Funktionieren identisch mit templateUrl

### Verifikation
- [x] `npm run build` erfolgreich
- [x] Alle UI-Elemente korrekt angezeigt
- [x] CSS-Variablen (--td-*) funktionieren

### Ergebnis
| Datei | Zeilen |
|-------|--------|
| `tower-defense.component.ts` | 2.144 |
| `tower-defense.component.html` | 171 |
| `tower-defense.component.scss` | 384 |

---

## Phase 1: GameStateManager Aufspaltung ✅ ERLEDIGT

**Status:** Abgeschlossen am 2026-01-19

### Ergebnis

| Datei | Zeilen (vorher) | Zeilen (nachher) |
|-------|-----------------|------------------|
| `game-state.manager.ts` | 1.079 | 523 |
| `combat-effect.service.ts` | - | 330 |
| `hq-damage.service.ts` | - | 238 |
| `tower-combat.service.ts` | - | 173 |

### Ursprüngliche Struktur (1.079 Zeilen)

| Bereich | Zeilen | Extrahieren zu |
|---------|--------|----------------|
| Combat/Hit Effects | ~250 | `CombatEffectService` |
| Tower Targeting | ~110 | `TowerCombatService` |
| Fire/HQ Effects | ~120 | `HQDamageService` |
| Tower Placement | ~60 | (TowerPlacementService existiert bereits) |
| Orchestration | ~200 | Bleibt im Manager |
| Public API | ~150 | Bleibt im Manager |
| Debug/Init | ~90 | Bleibt im Manager |

### 1.1 CombatEffectService

**Datei:** `src/app/services/combat-effect.service.ts`

**Extrahierte Methoden:**
- `onProjectileHit()` - Splash-Berechnung, Effekte
- `applyDamageToEnemy()` - Schaden, Blood Effects
- `spawnDeathBloodEffect()` - Death-Animation
- `applySlowEffect()` - Ice-Tower Slow
- `getTerrainHeightForDecal()` - Terrain-Raycast

**Interface:**
```typescript
@Injectable({ providedIn: 'root' })
export class CombatEffectService {
  initialize(tilesEngine: ThreeTilesEngine): void;

  onProjectileHit(
    projectile: Projectile,
    enemy: Enemy,
    towerManager: TowerManager,
    enemyManager: EnemyManager
  ): { killed: boolean; reward: number };

  applyDamageToEnemy(
    enemy: Enemy,
    damage: number,
    sourceTowerId: string,
    isSplashDamage: boolean,
    skipBloodEffects: boolean,
    towerManager: TowerManager,
    enemyManager: EnemyManager
  ): { killed: boolean; reward: number };
}
```

**Abhängigkeiten:**
- ThreeTilesEngine.effects
- ThreeTilesEngine.sync
- GlobalRouteGridService
- GAME_BALANCE

### 1.2 HQDamageService

**Datei:** `src/app/services/hq-damage.service.ts`

**Extrahierte Methoden:**
- `onEnemyReachedBase()` - HP-Reduktion, Sound
- `updateFireIntensity()` - Dynamische Feuer-Skalierung
- `triggerGameOver()` - Explosion, Inferno
- `healBase()` - Feuer löschen

**Interface:**
```typescript
@Injectable({ providedIn: 'root' })
export class HQDamageService {
  readonly showGameOverScreen = signal(false);

  initialize(tilesEngine: ThreeTilesEngine, basePosition: GeoPosition): void;
  onEnemyReachedBase(currentHealth: number): number;
  updateFireIntensity(currentHealth: number): void;
  triggerGameOver(onGameOverCallback?: () => void, ...): void;
  healBase(): void;
  reset(): void;
}
```

**Abhängigkeiten:**
- ThreeTilesEngine.effects
- ThreeTilesEngine.spatialAudio
- GAME_BALANCE.fire
- GAME_SOUNDS.hqDamage

### 1.3 TowerCombatService

**Datei:** `src/app/services/tower-combat.service.ts`

**Extrahierte Methoden:**
- `updateTowerShooting()` - Targeting, Rotation, Schuss
- `updateTowerIdleRotations()` - Idle-Reset
- `calculateHeading()` - Geo-Math

**Interface:**
```typescript
@Injectable({ providedIn: 'root' })
export class TowerCombatService {
  initialize(tilesEngine: ThreeTilesEngine): void;

  updateTowerShooting(
    currentTime: number,
    towerManager: TowerManager,
    enemyManager: EnemyManager,
    projectileManager: ProjectileManager
  ): void;

  updateTowerIdleRotations(towerManager: TowerManager): void;
  calculateHeading(from: GeoPosition, to: GeoPosition): number;
}
```

**Abhängigkeiten:**
- ThreeTilesEngine.towers
- ThreeTilesEngine.sync
- GlobalRouteGridService

### 1.4 GameStateManager nach Refactoring (~400 Zeilen)

```typescript
@Injectable()
export class GameStateManager {
  // Signals
  readonly baseHealth = signal(100);
  readonly credits = signal(100);

  // Injizierte Services
  private readonly combatEffectService = inject(CombatEffectService);
  private readonly hqDamageService = inject(HQDamageService);
  private readonly towerCombatService = inject(TowerCombatService);

  // Orchestration
  initialize(...): void { /* delegiert */ }
  update(currentTime: number): void { /* koordiniert */ }
  reset(): void { /* cleanup */ }

  // Public API (Fassade)
  startWave(): void;
  placeTower(): Tower | null;
  sellTower(): number;
  // ...
}
```

### Reihenfolge (Niedrigstes Risiko zuerst)
1. **CombatEffectService** - Isolierte Logik, klare Input/Output
2. **HQDamageService** - Eigener State, aber klar abgegrenzt
3. **TowerCombatService** - Komplex, Performance-kritisch

---

## Phase 2: TowerDefenseComponent Aufspaltung ✅ ERLEDIGT

**Status:** Alle geplanten Extraktionen abgeschlossen

### Aktuelle Struktur (1.799 Zeilen)

| Bereich | Zeilen | Status |
|---------|--------|--------|
| Location Change | ~60 | ✅ Extrahiert zu `LocationChangeCoordinatorService` |
| Street Rendering | ~15 | ✅ Extrahiert zu `StreetRenderingService` |
| Wave Spawning | ~15 | ✅ Konsolidiert in `WaveManager` |
| Frame Update | ~100 | Bleibt (Performance-kritisch) |
| UI/Lifecycle | ~1.600 | Bleibt in Component |

### 2.1 LocationChangeCoordinatorService ✅ ERLEDIGT

**Status:** Abgeschlossen am 2026-01-19

**Datei:** `src/app/services/location-change-coordinator.service.ts` (406 Zeilen)

**Extrahiert aus:** `onApplyNewLocation()` (215 → 60 Zeilen, -155 Zeilen)

**Die 7 Steps:**
```typescript
@Injectable({ providedIn: 'root' })
export class LocationChangeCoordinatorService {
  async executeLocationChange(
    input: LocationChangeInput,
    ctx: LocationChangeContext,
    callbacks: LocationChangeCallbacks
  ): Promise<void> {
    await this.step1_InitializeLoadingState();
    await this.step2_ResetAndConfigureEngine(input, ctx, callbacks);
    const streetNetwork = await this.step3_LoadStreets(input, ctx, callbacks);
    await this.waitForTilesWithTimeout(ctx);
    await this.step4_PlaceHQMarker(input, ctx, streetNetwork);
    await this.step5_PlaceSpawnPoint(input, callbacks);
    await this.step6_CalculateRoutes(ctx, streetNetwork, callbacks);
    await this.step7_Finalize(ctx, callbacks);
  }
}
```

**Interfaces:**
```typescript
interface LocationChangeInput {
  hq: LocationConfig;
  spawn: LocationConfig;
}

interface LocationChangeContext {
  engine: ThreeTilesEngine;
  gameState: GameStateManager;
  streetNetwork: StreetNetwork | null;
  streetNetworkLocation: { lat: number; lon: number } | null;
  heightDebugVisible: WritableSignal<boolean>;
}

interface LocationChangeCallbacks {
  setBaseCoords(coords): void;
  setCenterCoords(coords): void;
  setSpawnPoints(points): void;
  addSpawnPoint(id, name, lat, lon, color): void;
  setStreetCount(count): void;
  setStreetNetwork(network): void;
  setStreetNetworkLocation(loc): void;
  syncUrlWithLocation(): void;
  clearMapEntities(): void;
  appendDebugLog(msg): void;
  initializeTowerPlacement(): void;
  filterStreetNetworkToRoutes(): void;
  scheduleOverlayHeightUpdate(): Promise<void>;
  onGameOver(): void;
  getSpawnPoints(): SpawnPoint[];
  getBaseCoords(): { latitude: number; longitude: number };
}
```

**Abhängigkeiten:**
- EngineInitializationService
- HeightUpdateService
- GameStateManager
- PathAndRouteService
- MarkerVisualizationService
- CameraFramingService
- OsmStreetService

### 2.2 StreetRenderingService ✅ ERLEDIGT

**Status:** Abgeschlossen am 2026-01-19

**Datei:** `src/app/services/street-rendering.service.ts` (199 Zeilen)

**Extrahiert aus:** `renderStreets()` (~130 Zeilen)

**Interface:**
```typescript
@Injectable({ providedIn: 'root' })
export class StreetRenderingService {
  renderStreets(
    engine: ThreeTilesEngine,
    filteredNetwork: StreetNetwork | null,
    fullNetwork: StreetNetwork | null,
    baseCoords: { latitude: number; longitude: number },
    visible: boolean
  ): void;
  setVisibility(visible: boolean): void;
  hasStreets(): boolean;
  dispose(overlayGroup: Group): void;
  reset(): void;
}
```

**Abhängigkeiten:**
- ThreeTilesEngine
- MarkerVisualizationService
- PathAndRouteService

### 2.3 Wave-Logik in WaveManager konsolidieren ✅ ERLEDIGT

**Status:** Abgeschlossen am 2026-01-19

**Änderungen:**
- `startWave()` von 70 auf 15 Zeilen reduziert (delegiert an WaveManager)
- `waveAborted` Flag entfernt (WaveManager nutzt Phase-basierte Abort-Detection)
- `gatheringPhase` Signal delegiert an WaveManager
- `stopSpawning()` Methode hinzugefügt für Kill-All Funktionalität
- `WaveConfig` um `enemyHealth` erweitert

**Neue Methoden:**
- `WaveManager.stopSpawning()` - Stoppt pending Spawns (für Kill All)
- `GameStateManager.stopSpawning()` - Fassade

### 2.4 Component aktueller Stand (1.954 Zeilen)

**Erreicht:**
- Template & CSS extrahiert (Phase 0)
- StreetRenderingService extrahiert (Phase 2.2)
- Wave-Logik konsolidiert (Phase 2.3)
- LocationChangeCoordinatorService extrahiert (Phase 2.1)

**Was bleibt:**
- Angular Lifecycle Hooks
- Template Event Handler
- UI-Koordination (Dialoge, Debug-Panels)
- Computed Signals für Template
- `onEngineUpdate()` (Performance-kritisch)

---

## Zusammenfassung: Erstellte Dateien

```
src/app/
├── tower-defense.component.ts       (2697 → 1799) ✅
├── tower-defense.component.html     (NEU - 171)   ✅
├── tower-defense.component.scss     (NEU - 384)   ✅
│
├── services/
│   ├── combat-effect.service.ts     (NEU - 330)   ✅
│   ├── hq-damage.service.ts         (NEU - 238)   ✅
│   ├── tower-combat.service.ts      (NEU - 173)   ✅
│   ├── street-rendering.service.ts  (NEU - 199)   ✅
│   └── location-change-coordinator.service.ts (NEU - 406) ✅
│
└── managers/
    └── game-state.manager.ts        (1079 → 530)  ✅
```

**Gesamtreduktion:**
- TowerDefenseComponent: -898 Zeilen (2697 → 1799)
- GameStateManager: -549 Zeilen (1079 → 530)
- **Total extrahiert: ~1450 Zeilen in 5 neue Services + Wave-Konsolidierung**

---

## Umsetzungs-Timeline

### Sprint 1: Template/CSS Extraktion ✅ ERLEDIGT (2026-01-19)
- [x] `tower-defense.component.html` erstellen (171 Zeilen)
- [x] `tower-defense.component.scss` erstellen (384 Zeilen)
- [x] Component Decorator anpassen
- [x] Build & Test

### Sprint 2: CombatEffectService ✅ ERLEDIGT (2026-01-19)
- [x] Service erstellen (330 Zeilen)
- [x] Methoden extrahieren (onProjectileHit, applyDamageToEnemy, etc.)
- [x] GameStateManager anpassen
- [x] Test

### Sprint 3: HQDamageService ✅ ERLEDIGT (2026-01-19)
- [x] Service erstellen (238 Zeilen)
- [x] Fire-State migrieren
- [x] GameStateManager anpassen
- [x] Test

### Sprint 4: TowerCombatService ✅ ERLEDIGT (2026-01-19)
- [x] Service erstellen (173 Zeilen)
- [x] Targeting-Logik extrahieren
- [x] Performance-Test
- [x] GameStateManager anpassen

### Sprint 5: StreetRenderingService ✅ ERLEDIGT (2026-01-19)
- [x] Service erstellen (199 Zeilen)
- [x] State migrieren (streetLinesMesh, isRenderingStreets)
- [x] Component anpassen
- [x] Build & Lint verifiziert

### Sprint 6: LocationChangeCoordinatorService ✅ ERLEDIGT (2026-01-19)
- [x] Service erstellen (406 Zeilen)
- [x] 7 Steps implementieren mit Callback-Pattern
- [x] onApplyNewLocation ersetzen (215 → 60 Zeilen)
- [x] Build & Lint verifiziert

### Sprint 7: Wave-Konsolidierung ✅ ERLEDIGT (2026-01-19)
- [x] WaveManager um stopSpawning() erweitert
- [x] Component Spawn-Logik delegiert (70 → 15 Zeilen)
- [x] waveAborted Flag entfernt
- [x] gatheringPhase Signal delegiert
- [x] Build & Lint verifiziert

### Sprint 8: Cleanup & Dokumentation ✅ ERLEDIGT (2026-01-19)
- [x] Toten Code entfernen (ungenutzte Three.js Imports)
- [x] GOD_REFACTOR.md aktualisiert
- [ ] ARCHITECTURE.md aktualisieren (optional)

---

## Abhängigkeits-Vermeidung

### Problem: Zirkuläre Abhängigkeiten
```
GameStateManager → CombatEffectService → TowerManager → GameStateManager
```

### Lösung: Parameter statt Injection
```typescript
// NICHT:
class CombatEffectService {
  private towerManager = inject(TowerManager); // Zirkulär!
}

// SONDERN:
class CombatEffectService {
  onProjectileHit(proj, enemy, towerManager: TowerManager) {
    // towerManager als Parameter
  }
}
```

### Lösung: Return Values statt Callbacks
```typescript
// Service returned Daten:
const result = combatEffectService.onProjectileHit(...);

// GameStateManager verarbeitet:
if (result.reward > 0) {
  this.credits.update(c => c + result.reward);
}
```

---

## Risiken & Mitigationen

| Risiko | Wahrscheinlichkeit | Mitigation |
|--------|-------------------|------------|
| Performance-Regression | Mittel | Benchmark vor/nach, Hot-Path in Component |
| Zirkuläre Dependencies | Niedrig | Parameter statt Injection |
| State-Inkonsistenz | Mittel | Signals im GameStateManager belassen |
| Race Conditions | Niedrig | isChangingLocation Guard |
| Breaking Changes | Niedrig | Public API bleibt unverändert |

---

## Erwartetes Ergebnis

### Vorher
```
tower-defense.component.ts: 2.697 Zeilen (God Component)
game-state.manager.ts:      1.079 Zeilen (God Manager)
────────────────────────────────────────────────────────
TOTAL:                      3.776 Zeilen in 2 Dateien
```

### Nachher
```
tower-defense.component.ts:              ~1.200 Zeilen
tower-defense.component.html:              ~173 Zeilen
tower-defense.component.scss:              ~380 Zeilen
game-state.manager.ts:                     ~400 Zeilen
combat-effect.service.ts:                  ~200 Zeilen
hq-damage.service.ts:                      ~150 Zeilen
tower-combat.service.ts:                   ~130 Zeilen
location-change-coordinator.service.ts:   ~250 Zeilen
street-rendering.service.ts:              ~150 Zeilen
────────────────────────────────────────────────────────
TOTAL:                                   ~3.033 Zeilen in 9 Dateien
```

### Vorteile
- **Separation of Concerns:** Jede Datei hat eine klare Verantwortung
- **Testbarkeit:** Services sind isoliert testbar
- **Wartbarkeit:** Änderungen betreffen weniger Code
- **Lesbarkeit:** Kleinere Dateien, bessere Navigation
- **IDE-Support:** HTML/SCSS mit korrektem Syntax Highlighting
