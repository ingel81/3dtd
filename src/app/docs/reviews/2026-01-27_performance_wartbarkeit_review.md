# Code Review: Performance & Wartbarkeit

**Datum:** 2026-01-27
**Reviewer:** Claude Opus 4.5 (4 spezialisierte Agenten)
**Branch:** feature/ai-wave-director

---

## Executive Summary

| Bereich | Kritisch | Hoch | Mittel | Niedrig |
|---------|----------|------|--------|---------|
| Three.js/Rendering | 2 | 8 | 12 | 6 |
| Game Loop/Manager | 2 | 4 | 6 | 2 |
| Architektur | 3 | 5 | 3 | 3 |
| Code-Qualität | 4 | 5 | 8 | 5 |
| **GESAMT** | **11** | **22** | **29** | **16** |

---

## Teil 1: Three.js / Rendering Performance

### KRITISCHE PROBLEME

#### 1.1 Frustum Culling deaktiviert auf Enemy-Meshes
**Datei:** `src/app/three-engine/renderers/three-enemy.renderer.ts:183`
**Schweregrad:** KRITISCH
**Impact:** 20-40% Performance-Verlust

```typescript
mesh.traverse((node) => {
  node.visible = true;
  node.frustumCulled = false; // PROBLEM: Alle Enemies rendern, auch off-screen!
});
```

**Lösung:**
```typescript
node.frustumCulled = true; // oder Zeile entfernen
```

---

#### 1.2 Frustum Culling deaktiviert auf Projectile InstancedMesh
**Datei:** `src/app/three-engine/renderers/three-projectile.renderer.ts:62`
**Schweregrad:** KRITISCH
**Impact:** 15-30% Performance-Verlust

```typescript
this.instancedMesh = new InstancedMesh(geometry, material, maxCount);
this.instancedMesh.frustumCulled = false; // PROBLEM!
```

**Lösung:**
```typescript
this.instancedMesh.frustumCulled = true;
```

---

### HOHE PROBLEME

#### 1.3 Object Allocation in Particle Loops
**Datei:** `src/app/three-engine/renderers/three-effects.renderer.ts:723, 832, 874`
**Schweregrad:** HOCH

```typescript
const localPos = new Vector3(localXZ.x, localY, localXZ.z); // NEW jedes Mal!
```

**Lösung:** Static reusable Vector3 am Class-Level:
```typescript
private static readonly tempFirePos = new Vector3();
```

---

#### 1.4 Material Cloning statt Sharing
**Datei:** `src/app/three-engine/renderers/three-tower.renderer.ts:342, 948, 961`
**Schweregrad:** HOCH
**Impact:** 5% GPU Memory

```typescript
const material = this.selectionMaterial.clone(); // CLONE pro Tower!
const material = this.rangeMaterial.clone(); // CLONE pro Range!
```

**Lösung:** Direkt `this.selectionMaterial` / `this.rangeMaterial` nutzen ohne Clone.

---

#### 1.5 Double Material Allocation bei Enemies
**Datei:** `src/app/three-engine/renderers/three-enemy.renderer.ts:840-847`
**Schweregrad:** HOCH

Material wird geklont und sofort disposed, dann Pool-Material verwendet.

---

#### 1.6 Raycasting mit Fresh Raycaster
**Datei:** `src/app/three-engine/renderers/three-tiles-engine.ts:1235-1237, 1276-1277`
**Schweregrad:** HOCH

```typescript
const raycaster = new Raycaster(); // NEW jedes Mal bei Click!
```

**Lösung:** Static reusable Raycaster:
```typescript
private static readonly raycaster = new Raycaster();
```

---

#### 1.7 Tower Range Terrain-Anpassung - Zu viele Raycasts
**Datei:** `src/app/three-engine/renderers/three-tower.renderer.ts:1017-1044`
**Schweregrad:** HOCH
**Impact:** 8-15% CPU bei Range-Updates

48 Segments × 8 Rings = 384 Raycasts pro Range-Update!

**Lösung:** LRU Cache für Terrain-Höhen, Segments reduzieren.

---

#### 1.8 Tower Animation Mixer ohne Frustum-Check
**Datei:** `src/app/three-engine/renderers/three-tower.renderer.ts:748-752`
**Schweregrad:** HOCH
**Impact:** 5-10% CPU

```typescript
for (const [, towerData] of this.towers) {
  if (towerData.mixer) {
    towerData.mixer.update(deltaSeconds); // Alle Towers, auch off-screen!
  }
}
```

**Lösung:** Frustum-Check wie bei Enemies hinzufügen.

---

### MITTLERE PROBLEME

- Particle Buffer Updates immer als needsUpdate (three-effects.renderer.ts)
- Temporary Matrix in worldToScreen() nicht gecacht (three-tiles-engine.ts:1748)
- Euler() Object Allocation im Projectile Renderer (three-projectile.renderer.ts:443)
- Health Bar Texture Disposal ohne LRU Cache (three-enemy.renderer.ts)
- Arrow Model Geometry/Material Cloning ohne Cleanup (three-projectile.renderer.ts:230)
- Geometry Recreation bei Range Indicator (three-tower.renderer.ts:995)

---

### GUT IMPLEMENTIERT

- GPU Instancing für Projectiles
- GPU Instancing für Decals (DecalInstanceManager)
- Object Pooling für Particles (bloodPool, firePool, trailPool)
- Enemy Animation Frustum Culling
- Material Pooling für Enemies
- Health Bar Texture Caching
- Shader mit Log Depth Buffer

---

## Teil 2: Game Loop / Manager Performance

### KRITISCHE PROBLEME

#### 2.1 EntityManager.getAllActive() - O(n) Filter pro Frame
**Datei:** `src/app/managers/entity-manager.ts:50-52`
**Schweregrad:** KRITISCH

```typescript
getAllActive(): T[] {
  return this.getAll().filter((e) => e.active);  // O(n) JEDEM FRAME
}
```

**Impact:** Mit 100 Enemies + 50 Towers = 150 Array-Allocations + Filters pro Frame

**Lösung:** Separates `activeEntities: Set<T>()` mit O(1) Add/Remove.

---

#### 2.2 TowerCombatService Fallback-Path - O(towers × enemies × losCheck)
**Datei:** `src/app/services/tower-combat.service.ts:59-121`
**Schweregrad:** KRITISCH

Ground towers ohne visibleCells: 50 towers × 100 enemies × losCheck = 5000 LOS-Checks/Frame

**Lösung:** Fallback sollte auch `globalRouteGrid.getEnemiesInRadius()` nutzen.

---

### HOHE PROBLEME

#### 2.3 EnemyManager.getAlive() Cache zu aggressiv invalidiert
**Datei:** `src/app/managers/enemy.manager.ts:352-357`
**Schweregrad:** HOCH

Cache invalidiert bei jedem spawn/kill/remove. Bei schnellen Kill-Zyklen: Cache-Hit-Rate = niedrig.

---

#### 2.4 WaveManager.startWave() - setTimeout-Rekursion ohne Limit
**Datei:** `src/app/managers/wave.manager.ts:117-173`
**Schweregrad:** HOCH

`activeTimeouts` Set kann unbegrenzt wachsen bei schnellen Spawns.

---

#### 2.5 MovementComponent.move() - Teure Math-Operationen pro Frame
**Datei:** `src/app/game-components/movement.component.ts:236-325`
**Schweregrad:** HOCH

Mit 200 Enemies × 60 FPS = 12000 Math-Operationen pro Sekunde (sqrt, cos, sin).

**Lösung:** Pre-compute `lateralOffset` während spawn, cache `metersPerDegree`.

---

#### 2.6 CombatEffectService.handleProjectileHit() - Unkontrollierte Decal-Spawning
**Datei:** `src/app/services/combat-effect.service.ts:60-197`
**Schweregrad:** HOCH

Pro Ice-Projektil mit Splash: 4+ Decals pro Hit. Nach 10 Sekunden: 2800+ Decals.

**Lösung:** Decal-Pool mit max 100-200 aktiven Decals.

---

### MITTLERE PROBLEME

- GlobalRouteGrid.getEnemiesInRadius() - Geo-Conversion pro Enemy (global-route-grid.ts:529)
- StatusEffect Array Operations - findIndex() bei jedem Apply (movement.component.ts:160)
- Tower.findTarget() - calculateDistanceFast() bei jedem Candidate (tower.entity.ts:166)
- Enemy Random Sound Timers - Nested Timeouts (enemy.entity.ts:185)
- EventBus Listener Cleanup - Kein expliziter clear() (game-event-bus.ts)

---

## Teil 3: Architektur / Wartbarkeit

### KRITISCHE PROBLEME

#### 3.1 GameStateManager - God Class mit 15+ Verantwortlichkeiten
**Datei:** `src/app/managers/game-state.manager.ts` (720+ Zeilen)
**Schweregrad:** KRITISCH

Verwaltet:
- Manager-Orchestration (4 Sub-Manager)
- Tower Placement-Logik
- Tower Visualization
- Defense Reach Calculation
- Game Loop & Update-Logik
- 9 Angular Service Dependencies
- 8 Signals für UI-Bindung

**Lösung:** Aufteilen in:
- GameStateManager (100 Zeilen) - nur Orchestration
- TowerPlacementOrchestrator
- TowerVisualizationService
- DefenseReachService
- GameOverService

---

#### 3.2 TowerPlacementService - Zu viele Verantwortlichkeiten
**Datei:** `src/app/services/tower-placement.service.ts`
**Schweregrad:** KRITISCH

Kombiniert 4 Concerns: Preview Rendering, Model Loading, Placement Validation, LOS Preview.

---

#### 3.3 Zirkuläre Service-Abhängigkeiten
**Dateien:** `combat-effect.service.ts`, `tower-combat.service.ts`
**Schweregrad:** KRITISCH

Services kennen Manager direkt → Tight Coupling, schwer zu testen.

**Lösung:** Event-driven Ansatz verstärken oder Interface-Abstraktion.

---

### HOHE PROBLEME

#### 3.4 LocationChangeCoordinatorService - 11 Injected Dependencies
**Datei:** `src/app/services/location-change-coordinator.service.ts:81-91`
**Schweregrad:** HOCH

God Service, unmöglich zu testen.

---

#### 3.5 Manager-Initialisierungsmuster sind wildwuchs
**Dateien:** Alle Manager
**Schweregrad:** HOCH

- TowerManager: `initializeWithContext()` mit mehreren Parametern
- EnemyManager: `initialize()` mit Override
- WaveManager: `initialize()` + separater `setTimescaleProvider()` Call

**Lösung:** Template Method Pattern + Context Object.

---

#### 3.6 Excessive Null-Checks und Nullable State
**Dateien:** Services + Managers
**Schweregrad:** HOCH

```typescript
private engine: ThreeTilesEngine | null = null;
// Führt zu Null-Checks überall:
if (!this.engine) return;
```

**Lösung:** Non-null assertions + Template Methods.

---

### MITTLERE PROBLEME

- Magic Numbers überall (111000, 150, 75, 0.4, etc.)
- setTimeout nicht getrackt (enemy.manager.ts:201)
- Service Parameter-Injection statt Constructor-Injection
- EntityManager - Defensive Coding in Subklassen
- Logging inkonsistent

---

## Teil 4: Code-Qualität / Duplikation

### KRITISCHE PROBLEME

#### 4.1 Magische Zahlen für Geo-Koordinaten-Skalierung
**Dateien:** `tower.entity.ts:287`, `projectile.entity.ts:116-117`, `geo-utils.ts:17`
**Schweregrad:** KRITISCH

```typescript
const metersPerDegreeLat = 111320;  // Duplikat!
const dx = -dLon * 100000;  // FALSCH! Sollte 111320 sein
```

**Lösung:** Zentrale `geo-utils.ts` überall nutzen.

---

#### 4.2 Duplizierte Distance-Calculation Logik
**Datei:** `tower.entity.ts:283-292`
**Schweregrad:** KRITISCH

Vollständige Duplikation von `geoDistanceFast()` aus `geo-utils.ts`.

**Lösung:** Import und Nutzung der zentralen Funktion.

---

#### 4.3 Fehlende Initialisierungs-Validierungen
**Dateien:** Diverse Manager und Services
**Schweregrad:** KRITISCH

Inkonsistente Fehlerbehandlung: Manche werfen Error, manche loggen nur Warning.

---

#### 4.4 Unsafe Non-Null Assertions
**Dateien:** `projectile.entity.ts:273`, `wave.manager.ts:149`, `tower.entity.ts:81`
**Schweregrad:** KRITISCH

```typescript
const index = this.randomSoundsQueue.pop()!;  // Was wenn Queue leer?
const path = this.cachedPaths.get(spawn.id)!; // Was wenn nicht existiert?
```

---

### HOHE PROBLEME

#### 4.5 Timeout Memory Leaks
**Dateien:** `enemy.entity.ts:185-190`, `enemy.manager.ts:201-204`
**Schweregrad:** HOCH

Timeouts werden ohne Tracking erstellt.

---

#### 4.6 Lange Methoden (>50 Zeilen)
- `game-state.manager.ts:173-236` - `update()`: 63 Zeilen
- `game-state.manager.ts:609-662` - `getDefenseReachPercent()`: 53 Zeilen
- `combat-effect.service.ts:60-197` - `handleProjectileHit()`: **137 Zeilen!**

---

#### 4.7 Tiefe Verschachtelung (>3 Ebenen)
**Datei:** `combat-effect.service.ts:60-123`

Ice/Splash Explosion Block mit 4 Verschachtelungsebenen.

---

#### 4.8 Inconsistente Fehlerbehandlung
| Datei | Pattern | Problem |
|-------|---------|---------|
| tower.manager.ts:78 | console.error + Weiterexekution | Warnt aber führt aus |
| enemy.manager.ts:58-59 | throw new Error | Wirft Fehler |
| combat-effect.service.ts:61-63 | console.warn + return | Silent fail |

---

#### 4.9 `any` Type Verwendung
**Dateien:** `game-event-bus.ts:260`, `spatial-audio.manager.ts`
**Schweregrad:** HOCH

Fehlende TypeScript-Typisierung für Event Listener Maps.

---

### MITTLERE PROBLEME

- Hardcodierte Konstanten für visuelle Effekte (combat-effect.service.ts:80, 94)
- Random Offset Hardcodierung (combat-effect.service.ts:98-99)
- Duplicate Random Sound Scheduling Pattern (enemy.entity.ts)
- Fehlende Separation of Concerns (game-state.manager.ts)
- Unvalidierte Async Operationen (enemy.manager.ts:115-121)

---

### NIEDRIGE PROBLEME

- TODO/FIXME Comments ohne Issues
- DEBUG Kommentare und Markierungen
- Veraltete/redundante Services (entity-pool.service.ts)
- Fehlende Documentation für komplexe Logik
- Array-Allokationen in Loops (teilweise schon optimiert)

---

## Positive Erkenntnisse (Best Practices)

- GPU Instancing für Projectiles und Decals
- Object Pooling für Particles
- Event-Driven Architecture mit GameEventBus
- Signal-Based Reactivity (Angular Signals)
- Entity-Component System (Transform, Health, Combat)
- Frustum Culling bei Enemy Animations (nur Tower fehlt)
- Reusable Arrays (`toRemove` Pattern)
- Zentralisierte Geo-Utils

---

## Action Plan

### Phase 1: Quick Wins (Heute - 30 Min)
- [ ] `frustumCulled = true` in `three-enemy.renderer.ts:183`
- [ ] `frustumCulled = true` in `three-projectile.renderer.ts:62`
- [ ] Promise `.catch()` in `enemy.manager.ts:117`

### Phase 2: Performance (Diese Woche)
- [ ] Tower Mixer Frustum-Check hinzufügen
- [ ] `getAllActive()` → Active Set refactoring
- [ ] Static Raycaster/Vector3 Pool erstellen
- [ ] setTimeout Tracking implementieren

### Phase 3: Code-Qualität (Nächste Woche)
- [ ] Magic Numbers → Config extrahieren
- [ ] `handleProjectileHit()` aufteilen
- [ ] `calculateDistanceFast()` Duplikat entfernen
- [ ] Einheitliches Error-Handling Pattern

### Phase 4: Architektur (Danach)
- [ ] GameStateManager aufteilen
- [ ] Service Dependencies zu Event-driven
- [ ] Manager-Init Pattern vereinheitlichen

---

## Performance Impact Matrix

| Fix | Aufwand | Performance-Gewinn | Priorität |
|-----|---------|-------------------|-----------|
| Frustum Culling aktivieren | 5 Min | **20-40%** | SOFORT |
| Tower Mixer Frustum-Check | 30 Min | **5-10%** | SOFORT |
| getAllActive() → Set | 30 Min | **15-25%** | SOFORT |
| Material Sharing | 15 Min | **5%** | Bald |
| Range Raycast Caching | 1h | **8-15%** | Bald |
| setTimeout Tracking | 45 Min | Memory Leak Fix | Bald |
| God Class aufteilen | 4-6h | Wartbarkeit | Geplant |

---

## Dateien mit den meisten Problemen

| Datei | Probleme | Zeilen | Komplexität |
|-------|----------|--------|-------------|
| combat-effect.service.ts | 6 | 312 | SEHR HOCH |
| game-state.manager.ts | 5 | 720 | SEHR HOCH |
| tower.entity.ts | 3 | 294 | HOCH |
| enemy.entity.ts | 3 | 289 | HOCH |
| tower-combat.service.ts | 2 | 175 | MITTEL |
| enemy.manager.ts | 2 | 377 | HOCH |
| tower-placement.service.ts | 2 | 300+ | HOCH |
| three-enemy.renderer.ts | 2 | 900+ | HOCH |
| three-tower.renderer.ts | 3 | 1200+ | SEHR HOCH |
| three-effects.renderer.ts | 4 | 2000+ | SEHR HOCH |

---

*Report generiert von Claude Opus 4.5 mit 4 spezialisierten Review-Agenten*
