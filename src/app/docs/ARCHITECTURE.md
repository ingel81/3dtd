# Tower Defense - Architektur

**Stand:** 2026-01-10

## Übersicht

Component-basierte Game Engine Architektur mit **Three.js + 3DTilesRendererJS** für Google Photorealistic 3D Tiles.

**Hinweis:** Cesium.js wurde vollständig entfernt. Die Engine basiert jetzt zu 100% auf Three.js.

### Feature-Status (nach Cesium-Cleanup)

- [x] Tower-Platzierung (mit Terrain-Höhe)
- [x] Tower-Rendering (GLB Modelle)
- [x] Tower-Selektion (Range-Anzeige mit Terrain-Raycasting)
- [x] Hex-Grid Line-of-Sight Visualisierung
- [x] Enemy-Spawning und Rendering
- [x] Enemy-Animationen (Walk, Death)
- [x] Enemy-Heading (folgt Bewegungsrichtung)
- [x] Pfad-Smoothing (Gegner folgen geglätteten Routen)
- [x] Projektile (Instanced Rendering mit GLB-Modell)
- [x] Projektil-Sound (arrow_01.mp3)
- [x] Blut-Effekte (Partikel + Decals)
- [x] Feuer-Effekte (bei Basis-Schaden + Game Over)
- [x] Location-System (Dialog, Random Spawn, Reset-Fix)
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

## Services (2026-01 Refactoring)

Die Komponente wurde durch Extraktion von **17 spezialisierten Services** modularisiert.
Die Komponente selbst ist von 4098 auf ~1950 Zeilen reduziert worden.

**Hinweis:** Services liegen in `/src/app/services/`, nicht im tower-defense Subfolder.

### Service-Übersicht

| Service | Verantwortung |
|---------|---------------|
| **GameUIStateService** | UI State Signals, Layer Toggles, Debug Log |
| **CameraControlService** | Kamera Position, Reset, Fly-To Animationen |
| **CameraFramingService** | Viewport-basierte Kamera-Positionierung |
| **MarkerVisualizationService** | 3D Marker (HQ, Spawn, Debug), Animation |
| **PathAndRouteService** | Pfad-Caching, Route-Visualisierung, Height Smoothing |
| **InputHandlerService** | Click/Pan Detection, Terrain Raycasting |
| **TowerPlacementService** | Build Mode, Placement Validation, Preview Mesh |
| **LocationManagementService** | Location CRUD, LocalStorage Persistence |
| **HeightUpdateService** | Terrain Height Sync, Stabilization Loop |
| **EngineInitializationService** | 6-Step Loading Sequence, Progress Tracking |
| **RouteAnimationService** | Knight Rider Routen-Animation |
| **WaveDebugService** | Wave-Debugging Utilities |
| **DebugWindowService** | Debug-Window Verwaltung |
| **OsmStreetService** | OpenStreetMap Straßen-Loading, A* Pathfinding |
| **GeocodingService** | Nominatim Geocoding & Reverse-Geocoding |
| **ModelPreviewService** | 3D Model Previews für Sidebar |
| **EntityPoolService** | Object Pooling (Placeholder) |

### Service-Architektur

```
tower-defense.component.ts (Orchestrierung)
    │
    ├── GameUIStateService ──────── UI State & Toggles
    ├── EngineInitializationService ─ Loading Sequence
    │       └── verwendet alle anderen Services
    ├── CameraControlService ────── Kamera-Steuerung
    ├── CameraFramingService ────── Viewport-Framing
    ├── InputHandlerService ─────── Click/Pan Events
    ├── MarkerVisualizationService ─ 3D Marker
    ├── PathAndRouteService ─────── Pfade & Routen
    ├── RouteAnimationService ───── Route-Animation
    ├── TowerPlacementService ───── Build Mode
    ├── HeightUpdateService ─────── Terrain Sync
    ├── LocationManagementService ─ Location Management
    ├── WaveDebugService ────────── Wave Debugging
    └── DebugWindowService ──────── Debug Windows
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

### Pfad-Höhen und Smoothing

Gegner folgen gecachten Pfaden mit **geglätteten Höhen** statt live vom Terrain zu samplen.

**Problem ohne Smoothing:**
- Live-Terrain-Sampling würde Gegner über Bäume/Gebäude laufen lassen
- Routen sollen aber DURCH Hindernisse gehen (geglättete Linie)

**Lösung:**

```
┌─────────────────────────────────────────────────────────────┐
│  Route Creation (tower-defense.component.ts)                │
│  1. Sample terrain height per path point                    │
│  2. Smooth heights with smoothPathHeights()                 │
│  3. Convert back to geo heights                             │
│  4. Store in cachedPaths with smoothed heights              │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Enemy Movement (movement.component.ts)                     │
│  - Interpolates height between path waypoints               │
│  - Sets transform.terrainHeight from path data              │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Enemy Update (enemy.manager.ts)                            │
│  - Checks if path segment has valid heights                 │
│  - If yes: uses interpolated path height                    │
│  - If no: falls back to live terrain sampling               │
└─────────────────────────────────────────────────────────────┘
```

**Height Conversion:**
```typescript
// Path creation: local Y → geo height
const localTerrainY = smoothedPoint.y - HEIGHT_ABOVE_GROUND + originTerrainY;
const geoHeight = localTerrainY + origin.height;

// Enemy update: check for valid path heights
const pathHasHeights = segment.from.height !== 0 && segment.to.height !== 0;
if (pathHasHeights) {
  geoHeight = enemy.transform.terrainHeight; // From MovementComponent interpolation
}
```

**smoothPathHeights():**
- Erkennt Höhenanomalien (Sprünge > 10m, Steigung > 50%)
- Ersetzt Ausreißer durch interpolierte Werte
- Verhindert dass Gebäude/Bäume die Route beeinflussen

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
  addComponent<T extends Component>(component: T): T;
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
| `MovementComponent` | Path-Following, speedMps, currentIndex |
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

### 4.1 GameStateManager (Orchestrator)

```typescript
@Injectable()
class GameStateManager {
  // Sub-Managers
  readonly enemyManager: EnemyManager;
  readonly towerManager: TowerManager;
  readonly projectileManager: ProjectileManager;
  readonly waveManager: WaveManager;

  // Game State
  readonly baseHealth = signal(100);
  readonly credits = signal(100);

  initialize(engine: ThreeTilesEngine, streetNetwork, basePosition, spawnPoints, cachedPaths): void;
  update(currentTime: number): void;
  reset(): void;
}
```

### 4.2 EnemyManager

```typescript
@Injectable()
class EnemyManager extends EntityManager<Enemy> {
  spawn(path, typeId, speedOverride?, paused?): Enemy;
  kill(enemy: Enemy): void;
  update(deltaTime: number): void;
  startAll(delayBetween?: number): void;
  getAlive(): Enemy[];
}
```

### 4.3 TowerManager

```typescript
@Injectable()
class TowerManager extends EntityManager<Tower> {
  initializeWithContext(engine, streetNetwork, basePosition, spawnPoints): void;
  placeTower(position: GeoPosition, typeId: TowerTypeId): Tower | null;
  validatePosition(position: GeoPosition): { valid: boolean; reason?: string };
  selectTower(id: string | null): void;
  getSelected(): Tower | null;
}
```

### 4.4 ProjectileManager

```typescript
@Injectable()
class ProjectileManager extends EntityManager<Projectile> {
  spawn(tower: Tower, targetEnemy: Enemy): Projectile;
  update(deltaTime: number): void; // Hit detection
}
```

### 4.5 WaveManager

```typescript
@Injectable()
class WaveManager {
  readonly phase = signal<GamePhase>('setup');
  readonly waveNumber = signal(0);

  initialize(spawnPoints, cachedPaths): void;
  startWave(config: WaveConfig): void;
  checkWaveComplete(): boolean;
  endWave(): void;
  reset(): void;
}
```

### 4.6 SpatialAudioManager

```typescript
@Injectable()
class SpatialAudioManager {
  private readonly MAX_ENEMY_SOUNDS = 12;  // Sound Budget

  // 3D Audio mit Sound-Budget-Verwaltung
  playEnemySound(enemyId: string, soundType: string, position: Vector3): void;
  stopEnemySound(enemyId: string): void;
  stopAllSounds(): void;
}
```

**Sound Budget:** Maximal 12 gleichzeitige Enemy-Sounds, um Performance zu schonen.

---

## 5. Event-Koordination

**Wichtig:** Das Projekt verwendet **kein** klassisches EventEmitter/Subject-System (wie RxJS).

Stattdessen werden **Callback-basierte Events** verwendet:

```typescript
// In GameStateManager
onGameOverCallback?: () => void;
onDebugLogCallback?: (msg: string) => void;
onEnemyReachedBase?: (enemy: Enemy) => void;

// Verwendung
this.onGameOverCallback?.();
this.onEnemyReachedBase?.(enemy);
```

**Warum Callbacks statt Subjects?**
- Einfachere Lifecycle-Verwaltung
- Keine Subscription-Leaks
- Direktere Kommunikation zwischen Managern und Component

---

## 6. Renderer System

Alle Renderer verwenden das `CoordinateSync` Interface für Geo-zu-Lokal Transformation:

```typescript
interface CoordinateSync {
  geoToLocal(lat: number, lon: number, height: number): THREE.Vector3;
  localToGeo?(vec: THREE.Vector3): { lat: number; lon: number; height: number };
}
```

### 6.1 ThreeEnemyRenderer

```typescript
class ThreeEnemyRenderer {
  constructor(scene: THREE.Scene, sync: CoordinateSync);

  preloadModel(typeId: EnemyTypeId): Promise<void>;
  create(id, typeId, lat, lon, height): Promise<EnemyRenderData>;
  update(id, lat, lon, height, rotation, healthPercent): void;
  startWalkAnimation(id: string): void;
  playDeathAnimation(id: string): void;
  remove(id: string): void;
}
```

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

### 6.4 ThreeEffectsRenderer

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
    cost: 100,
  },
  cannon: { /* ... */ },
  magic: { /* ... */ },
  sniper: { /* ... */ },
};
```

### Enemy Types

```typescript
const ENEMY_TYPES: Record<EnemyTypeId, EnemyTypeConfig> = {
  zombie: {
    id: 'zombie',
    name: 'Zombie',
    modelUrl: '/assets/games/tower-defense/models/zombie_alternative.glb',
    baseHp: 100,
    baseSpeed: 2.5,
    scale: 0.5,
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

---

## 9. Render Pipeline

```typescript
// Game Loop (requestAnimationFrame)
function gameLoop(currentTime: number) {
  // 1. Game Logic Update
  gameState.update(currentTime);

  // 2. Three.js Update
  engine.update();

  // 3. Tiles Update
  tilesRenderer.update();

  // 4. Render
  renderer.render(scene, camera);

  requestAnimationFrame(gameLoop);
}
```

---

## 10. Dateistruktur

```
src/app/
├── tower-defense.component.ts    # Haupt-Component (~1950 Zeilen)
│
├── services/                     # 17 Services
│   ├── game-ui-state.service.ts        # UI State & Toggles
│   ├── camera-control.service.ts       # Kamera-Steuerung
│   ├── camera-framing.service.ts       # Viewport-Framing
│   ├── marker-visualization.service.ts # 3D Marker
│   ├── path-route.service.ts           # Pfade & Routen
│   ├── route-animation.service.ts      # Knight Rider Animation
│   ├── input-handler.service.ts        # Click/Pan Events
│   ├── tower-placement.service.ts      # Build Mode
│   ├── location-management.service.ts  # Location CRUD
│   ├── height-update.service.ts        # Terrain Sync
│   ├── engine-initialization.service.ts# Loading Sequence
│   ├── wave-debug.service.ts           # Wave Debugging
│   ├── debug-window.service.ts         # Debug Windows
│   ├── osm-street.service.ts           # OSM Straßen-Loading
│   ├── geocoding.service.ts            # Nominatim Geocoding
│   ├── model-preview.service.ts        # 3D Previews
│   └── entity-pool.service.ts          # Object Pooling
│
├── managers/                     # 8 Manager-Dateien
│   ├── index.ts                  # Manager Exports
│   ├── entity-manager.ts         # Base class
│   ├── game-state.manager.ts     # Orchestrator
│   ├── enemy.manager.ts          # Enemy Lifecycle
│   ├── tower.manager.ts          # Tower Lifecycle
│   ├── projectile.manager.ts     # Projectile Lifecycle
│   ├── wave.manager.ts           # Wave Management
│   └── spatial-audio.manager.ts  # 3D Audio (Sound Budget)
│
├── game/                         # Game Subsystem
│   ├── three-engine/
│   │   ├── three-tiles-engine.ts     # Haupt-Engine
│   │   ├── ellipsoid-sync.ts         # Koordinaten
│   │   ├── index.ts                  # Exports
│   │   └── renderers/
│   │       ├── index.ts              # CoordinateSync Interface
│   │       ├── three-enemy.renderer.ts
│   │       ├── three-tower.renderer.ts
│   │       ├── three-projectile.renderer.ts
│   │       └── three-effects.renderer.ts
│   │
│   ├── entities/
│   │   ├── enemy.entity.ts
│   │   ├── tower.entity.ts
│   │   └── projectile.entity.ts
│   │
│   ├── game-components/
│   │   ├── transform.component.ts
│   │   ├── health.component.ts
│   │   ├── movement.component.ts
│   │   ├── combat.component.ts
│   │   ├── render.component.ts
│   │   └── audio.component.ts
│   │
│   ├── core/
│   │   ├── game-object.ts
│   │   └── component.ts
│   │
│   ├── configs/
│   │   ├── tower-types.config.ts
│   │   └── projectile-types.config.ts
│   │
│   └── models/
│       ├── enemy-types.ts
│       ├── game.types.ts
│       └── location.types.ts
│
├── components/
│   ├── location-dialog/          # Location-Auswahl Dialog
│   └── ...
│
└── docs/
    ├── INDEX.md                  # Dokumentations-Index
    ├── ARCHITECTURE.md           # Dieses Dokument
    ├── DESIGN_SYSTEM.md          # UI/UX Guidelines
    ├── TODO.md                   # Offene Aufgaben
    ├── DONE.md                   # Abgeschlossene Features
    ├── LOCATION_SYSTEM.md        # Location-Feature Doku
    ├── PROJECTILES.md            # Projektil-System Doku
    ├── SPATIAL_AUDIO.md          # 3D Audio Doku
    └── MODEL_PREVIEW.md          # Model Preview Doku
```

---

## 11. Visual Effects & Features

### Blood Decal System

Persistente Blutflecken auf dem Boden nach Enemy-Deaths:

```typescript
// ThreeEffectsRenderer
spawnBloodDecal(lat, lon, height, size?): string;
```

- Decals bleiben bestehen bis zum Game Reset
- Verwendet Alpha-Blending für realistische Erscheinung
- Automatische Terrain-Ausrichtung

### Fire Effects

Feuer-Effekte bei HQ-Damage und Game Over:

```typescript
// ThreeEffectsRenderer
spawnFire(lat, lon, height, intensity): string;  // 'small' | 'medium' | 'large'
spawnFireOnTerrain(lat, lon, getHeight, intensity): string;
spawnFireAtLocalY(lat, lon, localY, intensity): string;
```

- Particle-basierte Feuer-Simulation
- Drei Intensitätsstufen
- Automatischer Sound bei Spawn

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

### Hex-Grid LoS-Visualisierung

Line-of-Sight Visualisierung im TowerRenderer:

- Zeigt Sichtlinien vom ausgewählten Tower zu Gegnern
- Hex-Grid basierte Darstellung der Tower-Range
- Aktiviert bei Tower-Selektion

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
