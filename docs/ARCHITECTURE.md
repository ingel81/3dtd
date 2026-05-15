# Tower Defense - Architektur

**Stand:** 2026-05-12

## Übersicht

Component-basierte Game Engine Architektur mit **Three.js + 3DTilesRendererJS** für Google Photorealistic 3D Tiles.

**Hinweis:** Cesium.js wurde vollständig entfernt. Die Engine basiert jetzt zu 100% auf Three.js.

### Feature-Status (nach Cesium-Cleanup)

- [x] Tower-Platzierung (mit Terrain-Höhe)
- [x] Tower-Rendering (GLB Modelle)
- [x] Tower-Selektion (Range-Anzeige mit Terrain-Raycasting)
- [x] Route LOS Grid (2m Zellenauflösung, Shader-Visualisierung)
- [x] Enemy-Spawning und Rendering
- [x] Enemy-Animationen (Walk, Death, Run mit Speed-Multiplier)
- [x] Animation Speed Coupling (Animation-Geschwindigkeit an Bewegung gekoppelt)
- [x] Enemy-Heading (folgt Bewegungsrichtung)
- [x] Pfad-Smoothing (Gegner folgen geglätteten Routen)
- [x] Projektile (Instanced Rendering mit GLB-Modell)
- [x] Projektil-Sound (arrow_01.mp3)
- [x] Blut-Effekte (Partikel + Decals)
- [x] Feuer-Effekte (bei Basis-Schaden + Game Over)
- [x] Location-System (Dialog, Random Spawn, Reset-Fix)
- [x] Air Units (Fledermaus mit heightOffset + heightVariation)
- [x] Air-LOS (skyline-adaptive Cell-Layer, `airVisibility` pro Cell, `canTargetAir`-Tower routen via `isAirPositionVisibleFromTower`)
- [x] LOS-Overlay Ground vs Air visuell getrennt (grün=ground, blau=air-only, rot=blocked)
- [x] Post-Processing-Pipeline (Bloom + Color Grading) als eigene `three-engine/post-processing/` Klasse
- [ ] Projektil-LoS (nur bei Sichtverbindung treffen)

## Design Prinzipien

1. **Component-Based Architecture** - Flexibles GameObject-System mit austauschbaren Components
2. **Separation of Concerns** - Renderer getrennt von Game Logic
3. **Manager Pattern** - Spezialisierte Manager für Entity-Lifecycle
4. **Single Responsibility** - Jede Klasse hat eine klare Aufgabe
5. **Reusable Factories** - Wiederverwendbare Factory-Methoden für ähnliche Objekte

### Reusable Components

Ähnliche visuelle Elemente sollten **immer** als wiederverwendbare Factory-Methoden implementiert werden:

```typescript
// GUT: Factory mit konfigurierbaren Optionen
private createDiamondMarker(options: {
  color: number;
  size?: number;
  showRings?: boolean;
}): THREE.Group { ... }

// Verwendung für verschiedene Marker-Typen
this.baseMarker = this.createDiamondMarker({ color: 0x22c55e, size: 1, showRings: true });
const spawnMarker = this.createDiamondMarker({ color: 0xef4444, size: 0.5, showRings: false });
```

---

## Services

Die Haupt-Komponente wurde durch Extraktion spezialisierter Services modularisiert.
Die Komponente selbst ist seit dem 2026-01 Refactoring auf ~655 Zeilen reduziert.

**Hinweis:** Services liegen in `/src/app/services/`. Seit dem **services/-Subfolder-Split
am 2026-05-10** sind sie thematisch in 6 Subfolder gruppiert; Root-Files
bleiben einige zentrale Service-Klassen, die keinem Subfolder eindeutig zuzuordnen sind.

### Verzeichnisstruktur

```
src/app/services/
├── (Root)
│   ├── camera-control.service.ts
│   ├── camera-framing.service.ts
│   ├── economy.service.ts          ← Wave-Completion-Bonus, Perfect-Streak (extrahiert aus GSM, 2026-05-10)
│   ├── input-handler.service.ts
│   ├── keyboard-pan.service.ts
│   └── tower-placement.service.ts
├── combat/
│   ├── combat-effect.service.ts
│   ├── combat-vfx.service.ts
│   ├── damage-application.service.ts
│   ├── hq-damage.service.ts
│   ├── status-effect.service.ts
│   └── tower-combat.service.ts
├── debug/
│   ├── debug-facade.service.ts
│   ├── debug-window.service.ts
│   ├── enemy-debug.service.ts
│   ├── performance-profiler.service.ts
│   ├── sound-debug.service.ts
│   ├── tower-debug.service.ts
│   └── wave-debug.service.ts
├── facade/
│   ├── game-loop-facade.service.ts
│   ├── location-facade.service.ts
│   ├── tower-defense-facade.service.ts
│   └── visualization-facade.service.ts
├── infrastructure/
│   ├── asset-manager.service.ts
│   ├── engine-initialization.service.ts
│   ├── game-state-sync.service.ts
│   └── model-preview.service.ts
├── location/
│   ├── geocoding.service.ts
│   ├── geolocation.service.ts
│   ├── location-change-coordinator.service.ts
│   ├── location-management.service.ts
│   ├── osm-street.service.ts
│   ├── pathfinding-worker.service.ts
│   ├── street-cache.service.ts
│   ├── url-location.service.ts
│   └── world-dice.service.ts
└── world/
    ├── building-rendering.service.ts
    ├── global-route-grid.service.ts
    ├── height-update.service.ts
    ├── map-placement.service.ts
    ├── marker-visualization.service.ts
    ├── path-route.service.ts
    ├── route-animation.service.ts
    ├── spatial-grid.service.ts
    ├── strategic-placement.service.ts
    └── street-rendering.service.ts
```

### Service-Übersicht (nach Subfolder)

#### infrastructure/

| Service | Verantwortung |
|---------|---------------|
| **AssetManagerService** | Zentraler GLTF/FBX Loader mit Reference Counting |
| **EngineInitializationService** | 6-Step Loading Sequence, Progress Tracking |
| **ModelPreviewService** | 3D Model Previews für Sidebar (Max-Renderer + setViewport pro Preview, kein Re-`setSize()` pro Frame) |
| **GameStateSyncService** | EventBus → Store Bridge — wave/game/credits/health/tower/enemy/research:state-changed |

#### (Root) — Camera & Input + zentrale Services

| Service | Verantwortung |
|---------|---------------|
| **CameraControlService** | Kamera Position, Reset, Fly-To Animationen |
| **CameraFramingService** | Viewport-basierte Kamera-Positionierung |
| **InputHandlerService** | Click/Pan Detection, Terrain Raycasting |
| **KeyboardPanService** | WASD/Pfeiltasten Kamera-Steuerung |
| **TowerPlacementService** | Build Mode, Placement Validation, Preview Mesh, refineCellsInRadius vor LOS-Reg |
| **EconomyService** | Wave-Completion-Bonus + Perfect-Streak (extrahiert aus GameStateManager, 2026-05-10) |

#### combat/

| Service | Verantwortung |
|---------|---------------|
| **TowerCombatService** | Tower Targeting, Turret-Rotation, Shooting, Chain-Hitscan (Lightning) |
| **CombatEffectService** | Projectile Hits, Damage, Blood/Death/Slow Effects |
| **CombatVfxService** | VFX-Trigger fuer Combat-Events (Hit-Sparks, Splash-Visuals) |
| **DamageApplicationService** | Damage-Pipeline: Schadensmatrix, Resistances, DOT-Application |
| **StatusEffectService** | Status-Effekte (Slow, Freeze, Burn, Poison) inkl. DOT-Ticks |
| **HQDamageService** | HQ Fire Effects, Damage Sounds, Game Over Visuals |

#### world/

| Service | Verantwortung |
|---------|---------------|
| **MarkerVisualizationService** | 3D Marker (HQ, Spawn, Debug), Animation |
| **PathAndRouteService** (`path-route.service.ts`) | Pfad-Caching, Route-Visualisierung, Height Smoothing |
| **RouteAnimationService** | Knight Rider Routen-Animation |
| **GlobalRouteGridService** | 2m Grid entlang Route, O(1) LOS Lookup, owns Per-Tower-Viz-Mesh (showTowerViz/clearTowerViz, 2026-05-11) |
| **SpatialGridService** | Generischer Spatial Hash fuer Tower/Enemy Range-Queries |
| **HeightUpdateService** | Terrain Height Sync, Stabilization Loop |
| **StreetRenderingService** | Street Network Visualisierung mit Terrain-Following |
| **BuildingRenderingService** | OSM-Gebaeude rendern (DevWorld + Live) |
| **MapPlacementService** | HQ-Placement, Spawn-Generation, Map-Bounds |
| **StrategicPlacementService** | Optimale Tower-Positionen entlang Enemy-Pfade |

#### location/

| Service | Verantwortung |
|---------|---------------|
| **LocationManagementService** | Location CRUD, LocalStorage Persistence |
| **LocationChangeCoordinatorService** | Koordiniert Location-Wechsel (Dialog, Spawns, Reset) |
| **GeocodingService** | Nominatim Geocoding & Reverse-Geocoding |
| **GeolocationService** | Browser Geolocation API Wrapper |
| **OsmStreetService** | OpenStreetMap Straßen-Loading, A* Pathfinding |
| **StreetCacheService** | IndexedDB Cache für Straßendaten |
| **PathfindingWorkerService** | A*-Pathfinding ueber Web Worker |
| **UrlLocationService** | URL-Parameter für Location-Sharing |
| **WorldDiceService** | Zufällige Städte für Random-Location |

#### debug/

| Service | Verantwortung |
|---------|---------------|
| **DebugFacadeService** | Debug Log, Height Debug, Display Options, Enemy Debug |
| **WaveDebugService** | Wave-Debugging Utilities — delegiert State an `DebugStore` |
| **SoundDebugService** | Sound-Debug Stats & Events von SpatialAudioManager |
| **TowerDebugService** | Tower-Parameter Overrides (Scale, Height, Rotation) — delegiert State an `DebugStore` |
| **EnemyDebugService** | Enemy-Debug (Spawn, Type-Config, Live-Visualisierung) — delegiert State an `DebugStore` |
| **DebugWindowService** | Debug-Window Verwaltung |
| **PerformanceProfilerService** | Frame-Time Sampling, Hot-Path-Profile (`.profiles/`) |

### Facade Services

Fünf Facade Services orchestrieren die spezialisierten Services und bilden die Schnittstelle zur Komponente.
Vier davon liegen in `services/facade/`, der Debug-Facade in `services/debug/`.

| Facade | Datei | Verantwortung |
|--------|-------|---------------|
| **TowerDefenseFacadeService** | `facade/tower-defense-facade.service.ts` | Haupt-Orchestrator: Initialisierung, Service-Wiring, Lifecycle |
| **GameLoopFacadeService** | `facade/game-loop-facade.service.ts` | Wave-Management, Game Loop, Upgrades, AI-Integration |
| **VisualizationFacadeService** | `facade/visualization-facade.service.ts` | Rendering, Kamera, Toggle-Steuerung, DPS-Visualisierung |
| **LocationFacadeService** | `facade/location-facade.service.ts` | Location Detection, DevWorld, Spawn-Management |
| **DebugFacadeService** | `debug/debug-facade.service.ts` | Debug Log, Height Debug, Display Options, Enemy Debug |

### Service-Architektur

```
tower-defense.component.ts
    │
    ├── TowerDefenseFacadeService ─── Haupt-Orchestrator
    │   ├── EngineInitializationService ─ Loading Sequence
    │   │       └── AssetManagerService ─ Zentrales Asset Loading
    │   ├── TowerPlacementService ────── Build Mode
    │   └── GameStateSyncService ─────── EventBus → Store Bridge
    │
    ├── GameLoopFacadeService ───────── Wave, Game Loop, AI
    │   ├── TowerCombatService ───────── Targeting, Rotation, Shooting
    │   ├── CombatEffectService ──────── Hits, Damage, Effects
    │   ├── HQDamageService ──────────── HQ Fire, Damage Sounds
    │   └── StrategicPlacementService ── Optimale Tower-Positionen
    │
    ├── VisualizationFacadeService ──── Rendering, Camera, Toggles
    │   ├── CameraControlService ─────── Kamera-Steuerung
    │   ├── CameraFramingService ─────── Viewport-Framing
    │   ├── KeyboardPanService ───────── WASD Steuerung
    │   ├── MarkerVisualizationService ─ 3D Marker
    │   ├── PathAndRouteService ──────── Pfade & Routen
    │   ├── RouteAnimationService ────── Route-Animation
    │   ├── GlobalRouteGridService ───── LOS Grid
    │   ├── HeightUpdateService ──────── Terrain Sync
    │   ├── StreetRenderingService ───── Street Visualization
    │   └── InputHandlerService ──────── Click/Pan Events
    │
    ├── LocationFacadeService ────────── Location, DevWorld, Spawns
    │   ├── LocationManagementService ── Location CRUD
    │   ├── LocationChangeCoordinatorService ── Location-Wechsel
    │   ├── UrlLocationService ────────── URL Sharing
    │   ├── GeocodingService ──────────── Nominatim
    │   ├── GeolocationService ────────── Browser GPS
    │   ├── OsmStreetService ──────────── OSM + A* Pathfinding
    │   ├── StreetCacheService ────────── IndexedDB Cache
    │   └── WorldDiceService ──────────── Random Cities
    │
    ├── DebugFacadeService ───────────── Debug Operations
    │   ├── WaveDebugService ──────────── Wave Debugging (→ DebugStore)
    │   ├── SoundDebugService ─────────── Sound Debug Stats
    │   ├── TowerDebugService ─────────── Tower Parameter Overrides (→ DebugStore)
    │   └── EnemyDebugService ─────────── Enemy Debug (→ DebugStore)
    │
    ├── UI Services
    │   ├── UIStore ───────────────────── UI State & Toggles
    │   ├── DebugStore ────────────────── Wave/Tower/Enemy Debug Signals (2026-05-10)
    │   ├── DebugWindowService ────────── Debug Windows
    │   └── ModelPreviewService ───────── 3D Previews
    │
    ├── Managers (event-driven)
    │   ├── GameStateManager ──────────── Game-Logic-Orchestrator + Sub-Manager-Lifecycle
    │   ├── GameCommandsHandler ───────── Bündelt 11 `command:*`/`debug:*` Subscriptions (2026-05-10)
    │   ├── EconomyService ────────────── Wave-Completion-Bonus + Streak (extrahiert aus GSM)
    │   ├── EnemyManager / TowerManager / ProjectileManager / WaveManager / ResearchManager
    │   └── EntityManager ─────────────── Generischer Entity-Container
    │
    └── Shared
        └── EntityPoolService ─────────── Object Pooling
```

---

## 1. Rendering Stack

### Three.js + 3DTilesRendererJS

```
┌─────────────────────────────────────────────────────────────┐
│  Three.js Scene                                              │
│  ├─ TilesRenderer (3DTilesRendererJS)                       │
│  │   └─ Google Photorealistic 3D Tiles (via Cesium Ion)     │
│  │                                                           │
│  ├─ overlayGroup (synced with tiles)                        │
│  │   ├─ Streets (LineSegments)                              │
│  │   ├─ Route Lines                                         │
│  │   ├─ HQ Marker                                           │
│  │   └─ Spawn Markers                                       │
│  │                                                           │
│  ├─ Enemies (GLTFLoader + AnimationMixer)                   │
│  ├─ Towers (GLTFLoader)                                     │
│  ├─ Projectiles (InstancedMesh)                             │
│  └─ Effects (Particles)                                     │
└─────────────────────────────────────────────────────────────┘
         Automatische Depth-Occlusion
```

**Hinweis:** `CesiumIonAuthPlugin` ist Teil von `3d-tiles-renderer` (NASA JPL), nicht Cesium.js!
Es wird nur für die Authentifizierung zum Cesium Ion Hosting-Service verwendet.

### Kern-Komponenten

| Datei | Beschreibung |
|-------|--------------|
| `three-tiles-engine.ts` | Haupt-Engine: Scene, Renderer, TilesRenderer, Overlays |
| `ellipsoid-sync.ts` | WGS84 - Three.js Koordinatentransformation |
| `renderers/index.ts` | CoordinateSync Interface + Renderer Exports |

### Koordinatensystem (WICHTIG!)

Das Projekt verwendet zwei Koordinatensysteme. **Häufige Fehlerquelle!**

#### 1. Geographic Coordinates (WGS84)
- `lat`, `lon`: Geografische Koordinaten in Grad
- `height`: Absolute Höhe über WGS84-Ellipsoid in Metern (z.B. 235m)

#### 2. Local Coordinates (Three.js Scene)
- `x`, `z`: Horizontale Position relativ zum Origin (HQ)
- `y`: Vertikale Position relativ zum Origin (0 = Origin-Höhe)

#### Transformation

| Methode | Input | Output | Verwendung |
|---------|-------|--------|------------|
| `geoToLocal(lat, lon, height)` | Geo + WGS84-Höhe | Local X/Y/Z | Objekte mit bekannter geo-Höhe |
| `geoToLocalSimple(lat, lon, 0)` | Geo | Local X/Z (Y=0) | Nur X/Z Position, Y separat setzen |
| `getTerrainHeightAtGeo(lat, lon)` | Geo | **Local Y** | Raycast → Terrain/Dach-Höhe |

#### WICHTIG: getTerrainHeightAtGeo gibt LOCAL Y zurück!

```typescript
// FALSCH - localY ist keine geo-Höhe!
const localY = engine.getTerrainHeightAtGeo(lat, lon);
const pos = engine.sync.geoToLocal(lat, lon, localY); // ❌ Doppelte Transformation!

// RICHTIG - localY direkt verwenden
const localY = engine.getTerrainHeightAtGeo(lat, lon);
const localXZ = engine.sync.geoToLocalSimple(lat, lon, 0);
object.position.set(localXZ.x, localY, localXZ.z); // ✅
```

#### Convenience-Methoden

Für häufige Operationen gibt es Convenience-Methoden, die das automatisch richtig machen:

```typescript
// Feuer auf Terrain spawnen - macht Raycast intern
engine.effects.spawnFireOnTerrain(lat, lon, engine.getTerrainHeightAtGeo, 'medium');

// Oder mit lokalem Y direkt
engine.effects.spawnFireAtLocalY(lat, lon, localY, 'medium');
```

#### WICHTIG: Terrain-Höhe LIVE ermitteln!

Terrain-Höhen sollten **zum Zeitpunkt der Verwendung** ermittelt werden, nicht beim Initialisieren:

```typescript
// FALSCH - Tiles sind beim Init möglicherweise noch nicht geladen!
initialize() {
  this.cachedHeight = engine.getTerrainHeightAtGeo(lat, lon); // ❌ Kann falsch sein!
}

useHeight() {
  doSomething(this.cachedHeight); // ❌ Veralteter/falscher Wert
}

// RICHTIG - Live ermitteln wenn benötigt
useHeight() {
  const localY = engine.getTerrainHeightAtGeo(lat, lon); // ✅ Tiles sind jetzt geladen

  // Sanity check für Werte am Origin (sollten nahe 0 sein)
  if (localY === null || Math.abs(localY) > 50) {
    console.warn('Invalid terrain height:', localY);
    localY = 0;
  }

  doSomething(localY);
}
```

**Grund:** 3D Tiles werden asynchron geladen. Beim Spielstart sind oft noch keine Tiles vorhanden, sodass Raycasts ins Leere gehen oder falsche Werte liefern.

### Terrain-Höhenermittlung

Raycast gegen geladene 3D Tiles in lokalen Koordinaten:

```typescript
getTerrainHeightAtGeo(lat: number, lon: number): number | null {
  // 1. Lokale Position berechnen (X/Z)
  const localPos = this.sync.geoToLocalSimple(lat, lon, 0);

  // 2. Raycast von 10km Höhe nach unten
  const rayOrigin = new THREE.Vector3(localPos.x, 10000, localPos.z);
  const direction = new THREE.Vector3(0, -1, 0);

  this.raycaster.set(rayOrigin, direction);
  const results = this.raycaster.intersectObject(this.tilesRenderer.group, true);

  // 3. Hit-Point Y-Koordinate zurückgeben
  return results.length > 0 ? results[0].point.y : null;
}
```

### Pfad-Höhen und Route-Grid-Cells

Gegner folgen gecachten Pfaden mit Höhen, die aus dem **Route-Grid** stammen.
Cells sind die Single Source of Truth für Boden-Y — dieselben Cells, die auch
Tower-LOS und Air-Routing bedienen.

**Problem ohne zentrale Quelle:**
- Live-Terrain-Sampling pro Frame würde Gegner über Bäume/Gebäude laufen lassen
- Routen sollen DURCH Hindernisse gehen (geglättete Linie auf Strassenniveau)
- Doppelpipeline (eigene Pfad-Raycasts neben Cell-Raycasts) führt zu Drift
  zwischen sichtbarer Linie, Gegner-Position und Tower-LOS-Sample

**Lösung — eine Quelle, drei Konsumenten:**

```
┌─────────────────────────────────────────────────────────────┐
│  Route Grid (global-route-grid.ts)                          │
│  - sampleCellY: strict raycast + sanity-check + LOD-versioned│
│  - cell.terrainHeight = single source of truth              │
│  - getGroundLocalYAt(x,z): cell-first + neighbour fallback  │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Route Build (path-route.service.ts: buildRouteFromPath)    │
│  1. A* pathfinding on street network                        │
│  2. Per waypoint: getGroundLocalYAt(geoToLocal(pos))        │
│  3. Cache pathWithHeights with cell-sourced geo heights     │
│  4. Build Line2 with the same cell heights                  │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Enemy Movement (movement.component.ts)                     │
│  - Interpolates height between path waypoints               │
│  - Waypoint heights came from cells (Step 2 above)          │
└─────────────────────────────────────────────────────────────┘
```

**onTilesLoaded sequence:**
1. `engine.clearHeightCache()` (signalled before callback)
2. `globalRouteGrid.updateTerrainHeights()` — re-sample all cells against
   freshly streamed tile geometry; quality-versioned idempotency skips
   stable cells unless LOD improved
3. `pathRoute.refreshRouteLines()` — line + cachedPaths rebuilt from
   the now-fresh cells
4. `scheduleRouteGridConvergence()` — rAF self-heal loop for cells
   still `unsampled` (async tile-mesh decode)

**Sanity & sampling rules (in `sampleCellY`):**
- Rejects raycast hits with `tileDepth=0` / `tileGeomErr=Infinity` (mesh
  not yet decoded → keeps cell `unsampled` instead of caching garbage)
- Rejects outliers >50 m from the median of stable 3×3 neighbours
- LOD-versioned idempotency: stable cells are only resampled when the
  hit comes from a strictly better LOD

**smoothPathHeights():** existiert noch in `path-route.service.ts`, wird aber
ausschliesslich von `street-rendering.service.ts` für gerenderte Strassenmesh-
Vertices genutzt. Der Pfad-Bau braucht es nicht mehr — Cells sind schon
sanity-checked.

### Progressive LOS & Street Rendering

Tower-Platzierung und Kamera-Bewegung loesten frueher schwere Frame-Drops aus
(95-600ms synchrone Raycasts). Beide nutzen jetzt progressive Batching:

**Tower LOS Registration:**
- `registerTowerProgressive()` berechnet LOS in Batches von 50 Zellen/Frame
- Tower bleibt inaktiv (`tower.losReady = false`) bis LOS komplett (~130ms / ~8 Frames)
- Combat-System ueberspringt Towers mit `!losReady`
- Gleiche Logik wie die existierende Preview (`continuePreviewBuild()`)

**Street Rendering:**
- `renderStreets()` sammelt alle Nodes und gibt sofort zurueck
- `continueStreetRender()` verarbeitet 50 Nodes/Frame (je 5 Raycasts bei Lateral Sampling)
- Alte Strassen bleiben sichtbar bis neue fertig (kein Flackern)
- Tile-Reload-Callback: von 350-600ms auf 14-34ms reduziert

### Enemy System Performance

Optimiert fuer 5000+ Enemies bei 67 FPS (~1.79µs pro Enemy):

| Optimierung | Ersparnis |
|-------------|-----------|
| `performance.now()` einmal pro Frame cachen | ~0.5ms |
| Single-Pass Status-Effects (in-place compact) | ~0.8ms |
| GPU `needsUpdate` Flags pro Pool batchen | ~0.7ms |
| Integer-Hash-Keys fuer Spatial Grids | ~0.4ms |
| `geoToLocalSimple` inlined + cos gecacht | ~0.9ms |
| Heading sqrt eliminiert, lateralOffset gecacht | ~0.4ms |
| `Math.pow` → lineare Approximation | ~0.4ms |

---

## 2. Core System: GameObject & Components

### 2.1 GameObject (Basis-Entity)

```typescript
abstract class GameObject {
  readonly id: string;
  readonly type: GameObjectType; // 'enemy' | 'tower' | 'projectile'

  protected components = new Map<string, Component>();
  private _active = true;

  // Component Management
  addComponent<T extends Component>(component: T, type: ComponentType): T;
  getComponent<T extends Component>(type: ComponentType): T | null;
  hasComponent(type: ComponentType): boolean;
  removeComponent(type: ComponentType): void;

  // Lifecycle
  update(deltaTime: number): void;
  destroy(): void;
}
```

### 2.2 Components

| Component | Beschreibung |
|-----------|--------------|
| `TransformComponent` | Position (GeoPosition), Rotation, Scale |
| `HealthComponent` | HP, maxHp, takeDamage(), heal() |
| `MovementComponent` | Path-Following, speedMps, speedMultiplier, effectiveSpeed |
| `CombatComponent` | damage, range, fireRate, canFire() |
| `RenderComponent` | Placeholder (Rendering via ThreeTilesEngine) |
| `AudioComponent` | Sound-Verwaltung |

---

## 3. Entity Types

### 3.1 Enemy

```typescript
class Enemy extends GameObject {
  readonly typeConfig: EnemyTypeConfig;

  // Components
  transform: TransformComponent;
  health: HealthComponent;
  render: RenderComponent;
  movement: MovementComponent;
  audio: AudioComponent;

  // Convenience
  get alive(): boolean;
  get position(): GeoPosition;
  startMoving(): void;
  stopMoving(): void;
}
```

### 3.2 Tower

```typescript
class Tower extends GameObject {
  readonly typeConfig: TowerTypeConfig;

  transform: TransformComponent;
  combat: CombatComponent;
  render: RenderComponent;

  selected = false;

  findTarget(enemies: Enemy[]): Enemy | null;
  select(): void;
  deselect(): void;
}
```

### 3.3 Projectile

```typescript
class Projectile extends GameObject {
  readonly typeConfig: ProjectileTypeConfig;
  readonly targetEnemy: Enemy;

  transform: TransformComponent;
  combat: CombatComponent;
  movement: MovementComponent;
  render: RenderComponent;

  updateTowardsTarget(deltaTime: number): boolean; // Returns true on hit
}
```

---

## 4. Manager System

> **Event-driven seit 2026-01-19:** Alle Manager kommunizieren via GameEventBus.
> Siehe [EVENT_SYSTEM.md](EVENT_SYSTEM.md) fuer Details.

### 4.1 GameStateManager (Orchestrator)

```typescript
@Injectable()  // Nur dieser Manager hat noch Angular DI
class GameStateManager {
  // Sub-Managers (manuell erstellt, nicht injected)
  readonly enemyManager: EnemyManager;
  readonly towerManager: TowerManager;
  readonly projectileManager: ProjectileManager;
  readonly waveManager: WaveManager;

  // Event Bus
  private eventBus: GameEventBus;

  // Game State (Angular Signals fuer UI-Bindings)
  readonly baseHealth = signal(100);
  readonly credits = signal(100);

  initialize(engine: ThreeTilesEngine, streetNetwork, basePosition, spawnPoints, cachedPaths): void;
  update(currentTime: number): void;
  reset(): void;
  getEventBus(): GameEventBus;  // Fuer externe Subscriptions
}
```

### 4.2 EnemyManager (Framework-agnostic)

```typescript
// Kein @Injectable - Constructor Injection
class EnemyManager extends EntityManager<Enemy> {
  constructor(eventBus: GameEventBus, entityPool: EntityPoolService, routeGrid: GlobalRouteGridService, spatialGrid: SpatialGridService);

  spawn(path, typeId, speedOverride?, paused?): Enemy;
  kill(enemy: Enemy): void;  // Emittiert 'enemy:died'
  update(deltaTime: number): void;  // Emittiert 'enemy:reached-base'
  startAll(delayBetween?: number): void;
  getAlive(): Enemy[];
}
```

### 4.3 TowerManager (Framework-agnostic)

```typescript
// Kein @Injectable - Constructor Injection
class TowerManager extends EntityManager<Tower> {
  constructor(eventBus: GameEventBus, osmService: OsmStreetService);

  initializeWithContext(engine, streetNetwork, basePosition, spawnPoints): void;
  placeTower(position: GeoPosition, typeId: TowerTypeId): Tower | null;  // Emittiert 'tower:placed'
  sell(tower: Tower): number;  // Emittiert 'tower:sold'
  validatePosition(position: GeoPosition): { valid: boolean; reason?: string };
  selectTower(id: string | null): void;
  getSelected(): Tower | null;
}
```

### 4.4 ProjectileManager (Framework-agnostic)

```typescript
// Kein @Injectable - Constructor Injection
class ProjectileManager extends EntityManager<Projectile> {
  constructor(eventBus: GameEventBus, entityPool: EntityPoolService);

  spawn(tower: Tower, targetEnemy: Enemy): Projectile;
  update(deltaTime: number): void;  // Emittiert 'projectile:hit', 'vfx:projectile-impact', 'audio:play'
}
```

### 4.5 WaveManager (Framework-agnostic)

```typescript
// Kein @Injectable - Constructor Injection
class WaveManager implements IGameManager {
  constructor(eventBus: GameEventBus, enemyManager: EnemyManager);

  readonly phase = signal<GamePhase>('setup');
  readonly waveNumber = signal(0);

  initialize(spawnPoints, cachedPaths): void;
  startWave(config: WaveConfig): void;  // Emittiert 'wave:started'
  checkWaveComplete(): boolean;
  endWave(): void;  // Emittiert 'wave:completed' (perfect, closeCall, hpLost)
  reset(): void;
}
```

### 4.6 ResearchManager (Framework-agnostic)

```typescript
// Kein @Injectable - Constructor Injection
class ResearchManager {
  constructor(eventBus: GameEventBus, researchStore: ResearchStore);

  start(researchId: string): void;   // Emittiert 'research:started'
  cancel(researchId: string): void;  // Emittiert 'research:cancelled'
  update(deltaTime: number): void;   // Tick fuer aktive Forschungen, emittiert 'research:completed'
}
```

ResearchEffects sind in `configs/research/research.types.ts` definiert und werden bei Completion an Tower- und Game-Systeme verteilt (z.B. unlockTowerType, multiplyDamage).

### 4.7 SpatialAudioManager

```typescript
// Framework-agnostic (kein @Injectable)
class SpatialAudioManager {
  // 3D Audio mit Sound-Budget-Verwaltung
  // Delegiert an AudioPoolManager, AudioBufferCache, SpatialAudioPlayback
  playAtGeo(soundId: string, lat: number, lon: number, height: number, volumeMultiplier?: number): Promise<PositionalAudio | null>;
  stopAll(): void;
}
```

**Sound Budget:** Maximal 12 gleichzeitige Enemy-Sounds, um Performance zu schonen.

---

## 5. Event-System

> **Vollstaendige Dokumentation:** [EVENT_SYSTEM.md](EVENT_SYSTEM.md)

Das Projekt verwendet einen **type-safe Event Bus** fuer lose Kopplung zwischen Komponenten.

### GameEventBus

```typescript
class GameEventBus {
  // Type-safe event emission
  emit(event: GameEvent): void;           // Immediate (blocking)
  emitDeferred(event: GameEvent): void;   // Queued for frame-end
  processQueue(): void;                    // Process deferred events

  // Subscriptions
  on<T extends GameEvent['type']>(type: T, handler: (event) => void): () => void;
  onAny(handler: (event: GameEvent) => void): () => void;  // Debug
}
```

### Event-Typen

| Kategorie | Events |
|-----------|--------|
| Enemy | `enemy:died`, `enemy:reached-base`, `enemy:spawned` |
| Tower | `tower:placed`, `tower:sold`, `tower:upgraded`, `tower:selected`, `tower:deselected` |
| Combat | `projectile:hit`, `dot:damage` |
| Wave | `wave:started`, `wave:completed` (mit `perfect`, `closeCall`, `hpLost`) |
| Game | `game:started`, `game:over`, `game:reset`, `health:changed`, `credits:changed` |
| Research | `research:started`, `research:completed`, `research:cancelled` |
| Effects | `vfx:blood`, `vfx:explosion`, `vfx:projectile-impact`, `vfx:muzzle-flash`, `audio:play` |
| Debug | `debug:sound`, `debug:spawn-enemy`, `debug:kill-all`, `debug:start-custom-wave`, `debug:complete-all-research`, `debug:max-upgrade-all-towers` |
| Commands | `command:place-tower`, `command:sell-tower`, `command:upgrade-tower`, `command:start-wave`, `command:restart-game`, `command:start-research`, `command:cancel-research` |

### Immediate vs Deferred

- **Immediate Events:** Game-kritisch, sofort verarbeitet (z.B. `enemy:died`, `projectile:hit`)
- **Deferred Events:** Nicht-kritisch, am Frame-Ende verarbeitet (z.B. `vfx:*`, `audio:play`)

```typescript
// Game Loop
function update(deltaTime: number) {
  enemyManager.update(deltaTime);      // Emits immediate events
  projectileManager.update(deltaTime); // Emits immediate + deferred
  eventBus.processQueue();             // Process deferred at stable point
}
```

---

## 6. Renderer System

Alle Renderer verwenden das `CoordinateSync` Interface für Geo-zu-Lokal Transformation:

```typescript
interface CoordinateSync {
  geoToLocal(lat: number, lon: number, height: number): THREE.Vector3;
  geoToLocalSimple(lat: number, lon: number, height: number): THREE.Vector3;
  geoToLocalSimpleInto(lat: number, lon: number, height: number, target: THREE.Vector3): THREE.Vector3;
  localToGeo?(vec: THREE.Vector3): { lat: number; lon: number; height: number };
}
```

### 6.1 ThreeEnemyRenderer

```typescript
class ThreeEnemyRenderer {
  constructor(scene: THREE.Scene, sync: CoordinateSync);

  preloadModel(typeId: EnemyTypeId): Promise<void>;
  create(id, typeId, lat, lon, height): Promise<EnemyRenderData | null>;
  update(id, lat, lon, height, rotation, healthPercent, currentSpeed?): void;
  startWalkAnimation(id: string): void;
  playDeathAnimation(id: string): void;
  getSpeedMultiplier(id: string): number;  // 1.0 for walk, runSpeedMultiplier for run
  remove(id: string): void;
}
```

#### Animation Speed Coupling

Gegner-Animationen sind automatisch an ihre Bewegungsgeschwindigkeit gekoppelt:

```typescript
// In ThreeEnemyRenderer.update()
const speedRatio = currentSpeed / effectiveBaseSpeed;
animationAction.timeScale = baseAnimSpeed * speedRatio;
```

**Effekt:** Schnellere Bewegung → Schnellere Animation (natürliche Laufbewegung)

**Details:** Siehe [ENEMY_CREATION.md → Animation Speed Coupling](ENEMY_CREATION.md#animation-speed-coupling)

#### Run Animation System

Manche Enemies wechseln zwischen Walk- und Run-Animation:

```typescript
animationVariation: true,     // Walk/Run Variation aktiviert
runSpeedMultiplier: 2.5,      // 2.5× Speed bei Run-Animation
```

**Effekt:** Run-Animation → Enemy bewegt sich 2.5× schneller (Animation bleibt gleich schnell, da Run-Animation bereits schneller im Modell ist)

**Details:** Siehe [ENEMY_CREATION.md → Run-Animation-System](ENEMY_CREATION.md#run-animation-system-animation-variation)

### 6.2 ThreeTowerRenderer

```typescript
class ThreeTowerRenderer {
  constructor(scene: THREE.Scene, sync: CoordinateSync);

  preloadModel(typeId: TowerTypeId): Promise<void>;
  create(id, typeId, lat, lon, height): Promise<TowerRenderData>;
  select(id: string): void;
  deselect(id: string): void;
  remove(id: string): void;
}
```

### 6.3 ThreeProjectileRenderer

```typescript
class ThreeProjectileRenderer {
  constructor(scene: THREE.Scene, sync: CoordinateSync);

  create(id, typeId, lat, lon, height, heading): void;
  update(id, lat, lon, height, heading): void;
  remove(id: string): void;
}
```

### 6.4 Spezialisierte Renderer

Zusaetzlich zum klassischen `ThreeEnemyRenderer` existieren mehrere spezialisierte Renderer:

| Renderer | Datei | Zweck |
|----------|-------|-------|
| **InstancedEnemyRenderer** | `renderers/instanced-enemy/` | GPU-instancing fuer Enemies via VAT (Vertex Animation Textures) — siehe [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md) |
| **DecalInstanceManager** | `renderers/decal-instance.manager.ts` | Blut/Eis-Decals als InstancedMesh mit Free-List-Pool |
| **ThreeFlameBeamRenderer** | `renderers/three-flame-beam.renderer.ts` | Fire-Tower-Beam (animierter Flammen-Kegel) |
| **ThreeTentacleRenderer** | `renderers/three-tentacle.renderer.ts` | Bezier-basierte Tentakel fuer Tentacle-Tower |
| **TrailStreakRenderer** | `renderers/trail-streak.renderer.ts` | Projektil-Trails als gestreckte Quads |
| **FloatingTextManager** | `renderers/floating-text/` | GPU-instanzierte Schadenszahlen ueber Enemies |
| **MarkerRenderers** | `renderers/marker/` | HQ-/Spawn-Marker, Range-Discs |
| **SpriteAtlasGenerator** | `renderers/sprite-atlas-generator.ts` | Generiert Atlas-Texturen fuer GPU-instanzierte Floating-Texts |

### 6.5 ThreeEffectsRenderer

```typescript
class ThreeEffectsRenderer {
  constructor(scene: THREE.Scene, sync: CoordinateSync);

  // Blood effects
  spawnBloodSplatter(lat, lon, height, count?): string;  // Particle splatter
  spawnBloodDecal(lat, lon, height, size?): string;      // Persistent ground stain

  // Fire effects
  spawnFire(lat, lon, height, intensity): string;
  stopFire(id: string): void;
  stopAllFires(): void;

  update(deltaTime: number): void;
  clear(): void;
  dispose(): void;
}
```

---

## 7. Type Configuration

### Tower Types

```typescript
const TOWER_TYPES: Record<TowerTypeId, TowerTypeConfig> = {
  archer: {
    id: 'archer',
    name: 'Archer Tower',
    modelUrl: '/assets/games/tower-defense/models/tower_archer.glb',
    scale: 1.8,
    damage: 25,
    range: 60,
    fireRate: 1,
    projectileType: 'arrow',
    cost: 45,
  },
  cannon: { /* ... */ },
  magic: { /* ... */ },
  // ... weitere: dual-gatling, rocket, ice, fire, tentacle
};
```

### Enemy Types

```typescript
const ENEMY_TYPES: Record<EnemyTypeId, EnemyTypeConfig> = {
  zombie: {
    id: 'zombie',
    name: 'Zombie',
    modelUrl: '/assets/models/enemies/zombie.glb',
    baseHp: 80,
    baseSpeed: 5,
    scale: 0.984,
    hasAnimations: true,
    walkAnimation: 'Armature|Walk',
    deathAnimation: 'Armature|Die',
  },
  tank: { /* ... */ },
};
```

---

## 8. Koordinatensystem

### Mit ReorientationPlugin (recenter: true)

Tiles werden auf den Origin (HQ) zentriert. Lokale Koordinaten in Metern:

```
X = East/West Offset (-X = East, +X = West)
Y = Höhe (relativ zu Origin-Terrain + overlayBaseY)
Z = North/South Offset (+Z = North, -Z = South)
```

### EllipsoidSync

```typescript
class EllipsoidSync {
  // WGS84 → Lokale Koordinaten (Meter)
  geoToLocal(lat, lon, height): THREE.Vector3;
  geoToLocalSimple(lat, lon, height): THREE.Vector3;

  // Lokale Koordinaten → WGS84
  localToGeo(vec: THREE.Vector3): { lat, lon, height };

  // Entfernung vom Origin
  distanceFromOrigin(lat, lon): number;

  // Heading-Berechnung
  calculateHeading(fromLat, fromLon, toLat, toLon): number;
}
```

### 8.1 Geo-Distance Utilities

**Datei:** `utils/geo-utils.ts`

Zentralisierte Distanzberechnungen zwischen geografischen Koordinaten. Früher 5x dupliziert in enemy.manager, tower.manager, game-state.manager, projectile.entity, movement.component.

#### haversineDistance() - Präzise, teuer

```typescript
haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number
```

**Verwendung:**
- Präzise Berechnung für **beliebige Distanzen** auf der Erdkugel
- Verwendet Trigonometrie (sin, cos, atan2)
- **Performance:** ~100-200 ns pro Aufruf (langsam)

**Wann verwenden:**
- Initialberechnung (Spawn-Point zu Base)
- Einmalige Operationen (Location-Validierung)
- Große Distanzen (>200m)

**Beispiel:**
```typescript
// Spawn-Point 500m von Base entfernt?
const distance = haversineDistance(
  spawnLat, spawnLon,
  baseLat, baseLon
);
if (distance < 500) {
  console.warn('Spawn zu nah an Base');
}
```

#### fastDistance() - Schnell, ungenau bei Distanz

```typescript
fastDistance(lat1: number, lon1: number, lat2: number, lon2: number): number
```

**Verwendung:**
- **Flat-Earth Approximation** (kein Haversine)
- Nur Multiplikation und sqrt, kein sin/cos
- **Performance:** ~20-30 ns pro Aufruf (10x schneller!)
- **Genauigkeit:** <1% Fehler bei Distanzen <200m

**Wann verwenden:**
- **Hot-Path:** In Update-Loops (jeden Frame)
- Lokale Berechnungen (<200m)
- Range-Checks (Enemy in Reichweite?)

**Beispiel:**
```typescript
// Enemy-Manager Update Loop (JEDEN FRAME!)
for (const enemy of enemies) {
  const dist = fastDistance(
    enemy.position.lat, enemy.position.lon,
    tower.position.lat, tower.position.lon
  );
  if (dist < tower.combat.range) {
    // In Reichweite!
  }
}
```

#### geoDistance() - Convenience Wrapper

```typescript
geoDistance(
  pos1: { lat: number; lon: number },
  pos2: { lat: number; lon: number }
): number
```

Wrapper für `haversineDistance` mit Objekt-Syntax statt 4 Parametern.

**Beispiel:**
```typescript
const dist = geoDistance(enemy.position, tower.position);
```

#### Performance-Vergleich

| Methode | Ns/Aufruf | Relativ | Use Case |
|---------|-----------|---------|----------|
| `fastDistance()` | ~25 ns | 1x (Basis) | Hot-Path, <200m |
| `haversineDistance()` | ~180 ns | 7x langsamer | Einmalig, >200m |

**WICHTIG:** In einem Frame mit 100 Enemies × 10 Towers = 1000 Distanzberechnungen:
- `fastDistance`: 1000 × 25ns = **25 µs**
- `haversineDistance`: 1000 × 180ns = **180 µs** (7x langsamer!)

#### TODO: Migration zu fastDistance

**Status:** Viele Stellen verwenden noch Haversine in Hot-Paths

**Betroffene Dateien:**
- `enemy.manager.ts:284-294` - getEnemiesInRadius (Range-Checks)
- `tower.manager.ts` - Tower-Placement-Validierung
- `game-state.manager.ts` - Combat Update Loop

**Siehe:** [TODO.md - Fast-Distance statt Haversine](../TODO.md)

---

## 9. Render Pipeline

**Design-Prinzip:** Der Game Loop läuft IMMER. Die Phase kontrolliert WAS passiert, nicht OB der Loop läuft.

```typescript
// Engine Render Loop (three-tiles-engine.ts) - läuft IMMER
function engineLoop(currentTime: number) {
  engine.update(deltaTime);    // Animationen, Effekte, Shader
  engine.render();             // Three.js Rendering

  // Callback für Game-Logik
  onUpdateCallback(deltaTime);

  requestAnimationFrame(engineLoop);
}

// onEngineUpdate (tower-defense.component.ts) - Game-Logik
function onEngineUpdate(deltaTime: number) {
  // IMMER: Projektile, Tower-Idle-Rotation, Grid-Animation
  // NUR WAVE: Enemy-Bewegung, Tower-Schießen, Wave-Check
  gameState.update(performance.now());
}
```

**Update-Matrix nach Phase:**
| System | setup | wave | gameover |
|--------|-------|------|----------|
| Projektile | ✓ | ✓ | ✓ |
| Tower Idle-Rotation | ✓ | - | ✓ |
| Enemy-Bewegung | - | ✓ | - |
| Tower-Schießen | - | ✓ | - |

---

## 10. Dateistruktur

```
src/app/
├── tower-defense.component.ts    # Haupt-Component (~655 Zeilen)
│
├── ai/                           # AI Wave Director, Bot System, Training Hooks
│   ├── core/                     # Game-State-Capture, Data Collection
│   └── training/                 # Bots (Strategy Pattern), Strategies
│
├── services/                     # Angular Services — vollstaendige Liste oben unter "Verzeichnisstruktur"
│   ├── (Root)                    # economy, tower-placement, camera-*, keyboard-pan, input-handler
│   ├── combat/                   # Tower-Combat, Damage-Application, Status-Effect, Combat-Effect/Vfx, HQ-Damage
│   ├── debug/                    # Debug-Facade + Wave/Tower/Enemy/Sound-Debug, Performance-Profiler, Debug-Window
│   ├── facade/                   # TowerDefense/GameLoop/Visualization/Location-Facades
│   ├── infrastructure/           # Asset-Manager, EngineInit, GameStateSync, ModelPreview
│   ├── location/                 # Geocoding, Geolocation, OsmStreet, PathfindingWorker, etc.
│   └── world/                    # Marker, Path/Route, Grid (Global/Spatial), Height, Streets, Buildings
│
├── managers/                     # Manager-Dateien (event-driven, Angular-frei)
│   ├── index.ts                  # Manager Exports
│   ├── entity-manager.ts         # Base class
│   ├── game-state.manager.ts     # Orchestrator + subManagers[] + dispose()
│   ├── game-commands.handler.ts  # 11 `command:*`/`debug:*` Subscriptions (extrahiert aus GSM, 2026-05-10)
│   ├── enemy.manager.ts          # Enemy Lifecycle
│   ├── tower.manager.ts          # Tower Lifecycle
│   ├── projectile.manager.ts     # Projectile Lifecycle
│   ├── wave.manager.ts           # Wave Management (templates, mixed waves)
│   ├── research.manager.ts       # Forschungs-System (Effects, Tick) — emittiert `research:state-changed`
│   └── audio/                    # Audio-Subsystem
│       ├── spatial-audio.manager.ts    # 3D Audio Manager
│       ├── spatial-audio-playback.ts   # Playback-Logik
│       ├── audio-buffer-cache.ts       # LRU Buffer Cache
│       └── audio-pool.manager.ts       # Audio Pool
│
├── game-engine/                  # Framework-agnostic Engine-Services
│   ├── game-event-bus.ts         # Event Bus + GameEvent Union
│   ├── vfx.service.ts            # VFX Event Handler
│   ├── audio.service.ts          # Audio Event Handler
│   ├── background-music.service.ts
│   ├── screen-shake.service.ts
│   └── game-manager.interface.ts # IGameManager
│
├── three-engine/                 # Three.js Engine
│   ├── three-tiles-engine.ts     # Haupt-Engine (Camera-Setup + Tile-Loading-State noch hier)
│   ├── ellipsoid-sync.ts         # Koordinaten
│   ├── index.ts                  # Exports
│   ├── post-processing/          # Bloom + Color Grading (eigene Pipeline-Klasse seit 2026-05-10)
│   │   ├── post-processing-pipeline.ts
│   │   └── color-grading.ts
│   └── renderers/
│       ├── index.ts              # CoordinateSync Interface
│       ├── three-tower.renderer.ts
│       ├── three-projectile.renderer.ts
│       ├── three-effects.renderer.ts        # ParticlePools + Auras + Environment FX
│       ├── three-flame-beam.renderer.ts
│       ├── three-tentacle.renderer.ts
│       ├── lightning-bolt.renderer.ts       # Chain-Bolts + Idle-Crackle + Impact-Halos (Lightning Tower)
│       ├── lightning-bolt-shaders.ts
│       ├── trail-streak.renderer.ts
│       ├── decal-instance.manager.ts
│       ├── decal-shaders.ts
│       ├── magic-orb-shaders.ts
│       ├── tentacle-shaders.ts
│       ├── sprite-atlas-generator.ts
│       ├── instanced-enemy/      # VAT-instanced enemy renderer
│       ├── floating-text/        # GPU-instanzierte Schadenszahlen
│       └── marker/               # HQ-/Spawn-Marker, Range-Discs
│
├── devworld/                     # DevWorld Offline-Entwicklungsumgebung
│
├── entities/
│   ├── enemy.entity.ts
│   ├── tower.entity.ts
│   └── projectile.entity.ts
│
├── game-components/
│   ├── transform.component.ts
│   ├── health.component.ts
│   ├── movement.component.ts
│   ├── combat.component.ts
│   ├── render.component.ts
│   └── audio.component.ts
│
├── core/
│   ├── game-object.ts
│   └── component.ts
│
├── store/                        # Signal Stores (Single Source of Truth)
│   ├── tower-defense.store.ts    # Root-Store (Aggregat-Fassade)
│   ├── tower-defense.store.types.ts
│   ├── game.store.ts             # Game State (credits, health, phase, wave)
│   ├── ui.store.ts               # UI State (toggles, build mode, persistence)
│   ├── engine.store.ts           # Engine Stats (fps, tiles, camera, loading)
│   ├── location.store.ts         # Location (coords, spawns, favorites)
│   └── research.store.ts         # Research-State (active, completed, locks)
│
├── configs/
│   ├── tower-types.config.ts
│   ├── enemy-types.config.ts     # (2026-05-10 aus models/ migriert)
│   ├── projectile-types.config.ts
│   ├── visual-effects.config.ts
│   ├── audio.config.ts
│   ├── background-music.config.ts
│   ├── attributions.config.ts
│   ├── game-balance.config.ts
│   ├── map-constants.config.ts
│   ├── placement.config.ts
│   ├── timing.config.ts
│   ├── wave-curriculum.config.ts # (2026-05-10 aus ai/core/ migriert)
│   ├── combat/                   # Damage-Matrix, ArmorTypes, DamageTypes, combat-tuning
│   └── research/                 # Research-Tree, Effects, Types
│
├── models/
│   ├── game.types.ts
│   ├── location.types.ts
│   └── status-effects.ts
│   # (enemy-types.ts ist 2026-05-10 nach configs/enemy-types.config.ts umgezogen)
│
├── styles/
│   └── td-theme.ts               # Theme-Konstanten + CSS-Vars
│
├── utils/
│   └── geo-utils.ts              # Haversine, Fast Distance
│
├── workers/                      # Web Workers (Pathfinding)
│
├── interfaces/                   # Public Interfaces (IGameManager, etc.)
│
├── integration/                  # Cross-Manager Integration Tests
│
└── components/
    ├── location-dialog/          # Location-Auswahl Dialog
    ├── address-autocomplete.component.ts
    ├── attributions-dialog/
    ├── compass/
    ├── context-hint/
    ├── debug-window/
    ├── engine-test/
    ├── game-header/
    ├── game-sidebar/
    ├── game-speed/
    ├── info-overlay/
    └── quick-actions/

docs/                              # siehe INDEX.md
```

---

## 11. Visual Effects & Features

### Blood Decal System

**Datei:** `three-engine/renderers/three-effects.renderer.ts`

Persistente Blutflecken auf dem Boden nach Enemy-Deaths. Verwendet **Instanced Rendering** für Performance.

#### Technische Implementierung

```typescript
// InstancedMesh mit Custom Shader
private bloodDecalMesh: THREE.InstancedMesh;
private iceDecalMesh: THREE.InstancedMesh;

spawnBloodDecal(lat: number, lon: number, height: number, size?: number): string;
spawnIceDecal(lat: number, lon: number, height: number, size?: number): string;
```

**Rendering:**
- **InstancedMesh** statt einzelne Meshes → 250 Draw Calls → **2 Draw Calls**
- Ein Pool für Blood (rot), ein Pool für Ice (blau)
- Custom Shader für Fade-Out und Color Tinting
- Decals bleiben bestehen bis zum Game Reset

**Shader-Features:**
```typescript
// Vertex Shader: USE_INSTANCING für Matrix-Transformation
// Fragment Shader: Color Tint + Alpha Fade
uniform vec3 uColor;      // Decal-Farbe (rot/blau)
uniform float uAlpha;     // Transparenz
```

**Konfiguration:** `configs/visual-effects.config.ts`

```typescript
export const BLOOD_DECAL_CONFIG = {
  maxDecals: 100,
  fadeDelay: 20000,      // ms before fade starts
  fadeDuration: 10000,   // ms fade duration
  baseOpacity: 0.7,
  baseColor: { r: 0.55, g: 0, b: 0 },  // Dark red
  colorVariation: 0.2,
  heightOffset: 0.12,
};

export const ICE_DECAL_CONFIG = {
  maxDecals: 150,
  fadeDelay: 4000,
  fadeDuration: 3000,
  baseOpacity: 0.6,
  baseColor: { r: 0.75, g: 0.94, b: 1.0 },  // Light cyan
  colorVariation: 0.1,
  heightOffset: 0.12,
};
```

**Automatisches Spawning:**
- Blood: Bei Enemy-Death mit `canBleed: true`
- Ice: Bei Ice Tower Hit (Splash-Effekt)

**Performance:**
- 100 Blood + 150 Ice Decals = **2 Draw Calls** (statt 250!)
- Keine Performance-Impact bei vielen Decals

### Fire Effects

**Datei:** `three-engine/renderers/three-effects.renderer.ts`

Feuer-Effekte bei HQ-Damage und Game Over. Kombiniert **Partikel + Geometrie + Sound**.

#### Technische Implementierung

```typescript
spawnFire(lat: number, lon: number, height: number, intensity: FireIntensity): string;
spawnFireOnTerrain(lat: number, lon: number, getHeight: Function, intensity: FireIntensity): string;
spawnFireAtLocalY(lat: number, lon: number, localY: number, intensity: FireIntensity): string;

type FireIntensityLevel = 'tiny' | 'small' | 'medium' | 'large' | 'inferno';
```

**Intensitätsstufen:**

| Intensity | Count | Radius | Use Case |
|-----------|-------|--------|----------|
| `tiny` | 10 | 1m | Kleinster Effekt |
| `small` | 30 | 2m | Einzelner Treffer |
| `medium` | 60 | 3m | HQ Schaden (pro Hit) |
| `large` | 100 | 5m | Game Over Explosion |
| `inferno` | 200 | 8m | Dauerhaftes Inferno |

**Komponenten:**

1. **Partikel-Emitter** (Additive Blending)
   - Flammen-Partikel (orange/gelb)
   - Rauch-Partikel (grau)
   - Aufwärtsbewegung mit Turbulenz

2. **Licht-Effekt** (optional)
   - Point Light mit flackernder Intensität
   - Orange Farbe

3. **Sound-Effekt**
   - Loop-Sound (`fire_loop.mp3`)
   - Spatial Audio (3D Position)
   - Automatisch gestoppt wenn Feuer erlischt

**Lifecycle:**

```typescript
// 1. Spawn
const fireId = engine.effects.spawnFire(lat, lon, height, 'large');

// 2. Update Loop (intern)
// - Partikel bewegen sich nach oben
// - Neue Partikel spawnen
// - Alte Partikel faden out

// 3. Cleanup
engine.effects.stopFire(fireId);     // Einzelnes Feuer
engine.effects.stopAllFires();       // Alle Feuer
```

**Automatisches Spawning:**
- Medium Fire: Jedes Mal wenn Enemy HQ erreicht (1 Fire pro Hit)
- Large Fire: Bei Game Over (3-5 Fires um HQ herum)

**Convenience-Methoden:**

```typescript
// Mit automatischem Terrain-Raycast
spawnFireOnTerrain(lat, lon, getTerrainHeight, 'medium');

// Mit bekannter Local-Y
spawnFireAtLocalY(lat, lon, localY, 'medium');
```

**WICHTIG:** `spawnFireOnTerrain` nutzt die übergebene `getTerrainHeight` Funktion. Grund: ThreeEffectsRenderer hat keinen direkten Zugriff auf TilesRenderer.

**Konfiguration:** `configs/visual-effects.config.ts`

```typescript
export const FIRE_INTENSITY = {
  tiny:    { count: 10,  radius: 1, duration: 3000 },
  small:   { count: 30,  radius: 2, duration: 5000 },
  medium:  { count: 60,  radius: 3, duration: 8000 },
  large:   { count: 100, radius: 5, duration: 10000 },
  inferno: { count: 200, radius: 8, duration: -1 },  // -1 = infinite
};
```

### Route Animation (Knight Rider Effekt)

Animierte Routen-Visualisierung:

```typescript
// RouteAnimationService
startAnimation(routes: RouteData[]): void;
stopAnimation(): void;
```

- Lauflichter entlang der Routen
- Konfigurierbare Geschwindigkeit und Farbe
- Aktiviert während Setup-Phase

### Route LOS Grid System

Feingranulare Line-of-Sight Visualisierung entlang der Gegner-Routen:

```typescript
// GlobalRouteGrid (utils/global-route-grid.ts)
class GlobalRouteGrid {
  // 2m Zellenauflösung entlang aller Routen
  generateFromRoutes(routes: GeoPosition[][]): void;

  // Enemy-Tracking in Zellen
  getEnemiesInRadius(lat: number, lon: number, radiusMeters: number, excludeId?: string): Enemy[];
  getEnemiesInRadiusGeo(position: GeoPosition, radiusMeters: number, excludeId?: string): Enemy[];
}
```

**Zellengenerierung:**
- Radiale/flächen-basierte Generierung (nicht perpendikular zur Route)
- 7m Korridor-Breite um jede Route
- 2m Zellenauflösung für präzise LOS-Prüfung

**Shader-Visualisierung:**
```typescript
// USE_INSTANCING define erforderlich für InstancedMesh
const material = new THREE.ShaderMaterial({
  defines: { USE_INSTANCING: '' },
  transparent: true,
  depthTest: false,  // WICHTIG: Über 3D Tiles rendern
  depthWrite: false,
  side: THREE.DoubleSide,
  // ...
});
```

**Farben:**
- Grün (`vec3(0.2, 0.8, 0.4)`): Tower hat Sichtlinie
- Rot (`vec3(0.9, 0.2, 0.2)`): Blockiert durch Terrain/Gebäude
- Pulsing Animation: Opacity 0.6-0.8

---

## 12. Vorteile der Architektur

### Modularität
- Components sind wiederverwendbar
- Neue Entity-Typen durch Kombination von Components

### Separation of Concerns
- Entities: Daten und Logik
- Managers: Lifecycle und Orchestrierung
- Renderers: Nur Visualisierung

### Erweiterbarkeit
- Neue Tower/Enemy-Typen durch Config
- Neue Components ohne bestehenden Code zu ändern

### Performance
- Three.js InstancedMesh für Projektile
- Raycast-Cache für Terrain-Höhen
- AnimationMixer für Skelett-Animationen

### Cesium-frei
- Keine Abhängigkeit von Cesium.js
- Nur `3d-tiles-renderer` (NASA JPL) für Google 3D Tiles
- Cesium Ion nur als Hosting-Service (Token-basiert)

---

## 13. Gotchas & Lessons Learned

### Async Methods + Component Lifecycle = Race Condition

**Problem:** Async Methoden können NACH `onDestroy()` weiterlaufen und Ressourcen erstellen, die nie aufgeräumt werden.

```typescript
// ❌ FALSCH - Sound wird nach destroy erstellt
async playLoop() {
  await loadBuffer();      // <-- onDestroy() kann hier aufgerufen werden
  this.activeLoops.set();  // <-- läuft trotzdem weiter!
  audio.play();            // <-- Sound spielt ewig
}

// ✅ RICHTIG - destroyed Flag nach jedem await prüfen
private destroyed = false;

async playLoop() {
  await loadBuffer();
  if (this.destroyed) return;  // Abbruch nach jedem await!
  this.activeLoops.set();
  audio.play();
}

onDestroy() {
  this.destroyed = true;  // ZUERST Flag setzen
  this.stopAll();         // DANN cleanup
}
```

**Regel:** Bei async Component-Methoden immer ein `destroyed` Flag führen und nach jedem `await` prüfen.

### `alive` vs `active` bei GameObjects

| Property | Prüft | Wann false |
|----------|-------|------------|
| `alive` | `!health.isDead` | Enemy wurde getötet (HP = 0) |
| `active` | GameObject._active | `destroy()` wurde aufgerufen |

**Problem:** Bei setTimeout-Callbacks auf bereits zerstörte Objekte.

```typescript
// ❌ FALSCH - Enemy könnte destroyed sein aber health > 0
setTimeout(() => {
  if (enemy.alive) {
    enemy.startMoving();  // Crash oder Zombie-Sound!
  }
}, delay);

// ✅ RICHTIG - Beides prüfen
setTimeout(() => {
  if (enemy.alive && enemy.active) {
    enemy.startMoving();
  }
}, delay);
```

### setTimeout-Loops bei Game State Changes

**Problem:** Rekursive setTimeout-Loops (z.B. für Spawning) laufen weiter, auch wenn der Game State sich ändert.

```typescript
// ❌ FALSCH - Spawnt weiter nach Game Over
const spawnNext = () => {
  spawnEnemy();
  setTimeout(spawnNext, delay);  // Loop läuft ewig
};

// ✅ RICHTIG - State prüfen
const spawnNext = () => {
  if (this.gameOver || this.waveAborted) return;  // Abbruch!
  spawnEnemy();
  setTimeout(spawnNext, delay);
};

onGameOver() {
  this.waveAborted = true;  // Loop wird beim nächsten Tick gestoppt
}
```

### Duplizierte Logik vermeiden

**Problem:** Gleiche Funktionalität an mehreren Stellen implementiert → Fixes werden inkonsistent.

**Beispiel:** `spawnNext()` war sowohl in `WaveManager` als auch in `TowerDefenseComponent` implementiert. Fix in WaveManager wurde nie benutzt.

**Regel:** Spawn-Logik, Game-State-Änderungen etc. gehören in die Manager, nicht in Components.

### THREE.Raycaster State-Korruption

**Problem:** Ein geteilter `THREE.Raycaster` behält internen State, der nachfolgende Raycasts kaputt macht.

**Symptom:** Nach Line-of-Sight (LoS) Checks mit custom Origin/Direction gibt `raycastTerrain()` plötzlich `null` zurück, obwohl Tiles geladen sind und die Mausposition gültig ist.

```typescript
// ❌ FALSCH - Geteilter Raycaster wird durch LoS-Checks korrumpiert
class ThreeTilesEngine {
  private raycaster = new THREE.Raycaster();  // Geteilt!

  hasLineOfSight(from, to) {
    this.raycaster.set(customOrigin, customDirection);  // Modifiziert State
    return this.raycaster.intersectObject(...);
  }

  raycastTerrain(screenX, screenY) {
    this.raycaster.setFromCamera(mouse, camera);  // State ist korrumpiert!
    return this.raycaster.intersectObject(...);   // → null obwohl Hit erwartet
  }
}
```

**Lösung:** Für Screen-zu-Terrain Raycasts immer einen **frischen Raycaster** erstellen:

```typescript
// ✅ RICHTIG - Frischer Raycaster pro Aufruf
raycastTerrain(screenX: number, screenY: number): THREE.Vector3 | null {
  const mouse = new THREE.Vector2(/* NDC coords */);

  // Frische Instanz - wird nicht durch LoS-Checks beeinflusst
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, this.camera);

  const results = raycaster.intersectObject(this.tilesRenderer.group, true);
  return results.length > 0 ? results[0].point.clone() : null;
}
```

**Wo angewandt:**
- `three-tiles-engine.ts`: `raycastTerrain()` und `raycastTowers()`

**Regel:** Raycaster, die mit `setFromCamera()` arbeiten, sollten nie denselben Instance verwenden wie Raycaster mit manuellem `set(origin, direction)`.

### ShaderMaterial + InstancedMesh = USE_INSTANCING

**Problem:** Custom ShaderMaterial mit `THREE.InstancedMesh` rendert nichts - keine Fehler, einfach unsichtbar.

**Ursache:** Three.js injiziert automatisch `#ifdef USE_INSTANCING` Code in Built-in Materials. Bei Custom ShaderMaterial muss man das Define selbst setzen.

```typescript
// ❌ FALSCH - Instancing funktioniert nicht
const material = new THREE.ShaderMaterial({
  vertexShader: `
    void main() {
      vec4 mvPosition = vec4(position, 1.0);
      mvPosition = instanceMatrix * mvPosition;  // instanceMatrix ist undefined!
      gl_Position = projectionMatrix * modelViewMatrix * mvPosition;
    }
  `,
});

// ✅ RICHTIG - USE_INSTANCING Define setzen
const material = new THREE.ShaderMaterial({
  defines: { USE_INSTANCING: '' },  // Aktiviert instanceMatrix
  vertexShader: `
    void main() {
      vec4 mvPosition = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * mvPosition;
    }
  `,
});
```

**Regel:** Bei Custom ShaderMaterial mit InstancedMesh immer `defines: { USE_INSTANCING: '' }` und `#ifdef USE_INSTANCING` im Vertex Shader.

### depthTest: false für Overlays auf 3D Tiles

**Problem:** Shader-basierte Overlays sind nur sichtbar wenn man gegen den Himmel schaut, verschwinden aber über 3D Tiles.

**Ursache:** 3D Tiles haben komplexe Z-Werte die Standard-Depth-Testing beeinflussen.

```typescript
// ❌ FALSCH - Overlay wird von Tiles verdeckt
const material = new THREE.ShaderMaterial({
  transparent: true,
  // depthTest default = true
});

// ✅ RICHTIG - Overlay rendert über Tiles
const material = new THREE.ShaderMaterial({
  transparent: true,
  depthTest: false,   // Ignoriert Depth Buffer
  depthWrite: false,  // Schreibt nicht in Depth Buffer
});
```

**Regel:** Für flache Overlays auf Terrain (LOS-Grid, Markers, etc.) immer `depthTest: false` und `depthWrite: false` setzen.
