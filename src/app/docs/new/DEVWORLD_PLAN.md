# DevWorld Plan

> **Status:** Entwurf - Feedback willkommen
> **Ziel:** Spielbare Entwicklungsumgebung ohne Google 3D Tiles
> **Zugriff:** `https://3dtd.de/devworld` oder `?devworld=true`

---

## 1. Motivation

### Probleme mit Google 3D Tiles im Development

| Problem | Impact |
|---------|--------|
| API Key erforderlich | Neue Entwickler brauchen erst Key |
| 3-8s Loading | Langsames Iterieren |
| Netzwerk nötig | Kein Offline-Development |
| Tiles variieren | Schwer reproduzierbare Bugs |
| Kosten | API-Calls kosten Geld |
| Nicht testbar | Kein Vitest ohne WebGL/Netzwerk |

### Lösung: DevWorld

Eine alternative "Fake World" die:
- **Sofort lädt** (<100ms)
- **Offline funktioniert**
- **Deterministisch ist** (immer gleiche Geometrie)
- **Testbar ist** (Vitest kann damit arbeiten)
- **Spielbar ist** (echtes Gameplay möglich)

---

## 2. Architektur

### 2.1 Aktueller Zustand

```
ThreeTilesEngine
    │
    ├── TilesRenderer (Google 3D Tiles)
    │   └── getTerrainHeightAtGeo()
    │   └── raycastTerrain()
    │   └── Gebäude für LOS
    │
    └── OsmStreetService
        └── Straßennetz von OpenStreetMap
        └── A* Pathfinding
```

**Problem:** Alles fest verdrahtet, keine Abstraktion.

### 2.2 Ziel-Architektur

```
ThreeTilesEngine
    │
    ├── TerrainProvider (Interface)
    │   ├── TilesTerrainProvider (Google 3D Tiles)
    │   └── DevTerrainProvider (Fake Geometry)
    │
    └── StreetNetworkProvider (Interface)
        ├── OsmStreetProvider (OpenStreetMap)
        └── DevStreetProvider (Hardcoded Netz)
```

**Vorteil:** Runtime-Switch über URL, gleicher Code für beides.

---

## 3. Interfaces

### 3.1 TerrainProvider

```typescript
interface TerrainProvider {
  // Initialisierung
  initialize(scene: THREE.Scene, origin: GeoPosition): Promise<void>;

  // Höhenabfrage
  getHeightAtGeo(lat: number, lon: number): number | null;
  getHeightAtLocal(x: number, z: number): number | null;

  // Raycasting
  raycastFromScreen(
    screenX: number,
    screenY: number,
    camera: THREE.Camera
  ): THREE.Vector3 | null;

  raycastDown(x: number, z: number): THREE.Vector3 | null;

  // Line of Sight
  hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean;

  // Mesh-Zugriff (für Tower-Raycasting etc.)
  getTerrainMeshes(): THREE.Object3D[];
  getBuildingMeshes(): THREE.Object3D[];

  // Lifecycle
  update?(deltaTime: number): void;
  dispose(): void;
}
```

### 3.2 StreetNetworkProvider

```typescript
interface StreetNetworkProvider {
  // Initialisierung
  initialize(bounds: GeoBounds): Promise<void>;

  // Straßennetz
  getStreetNetwork(): StreetNetwork;

  // Pathfinding
  findPath(from: GeoPosition, to: GeoPosition): GeoPosition[] | null;

  // Validierung
  findNearestStreetPoint(position: GeoPosition): {
    point: GeoPosition;
    distance: number;
  } | null;

  isOnStreet(position: GeoPosition, tolerance: number): boolean;

  // Visualisierung (optional)
  createStreetMeshes?(): THREE.Object3D[];

  // Lifecycle
  dispose(): void;
}
```

### 3.3 Koordinaten-Transformation

```typescript
interface CoordinateSync {
  // Origin (HQ Position)
  origin: GeoPosition;

  // Geo ↔ Local
  geoToLocal(lat: number, lon: number, height?: number): THREE.Vector3;
  localToGeo(position: THREE.Vector3): GeoPosition;

  // Distanz
  geoDistance(a: GeoPosition, b: GeoPosition): number;
}
```

**Hinweis:** `EllipsoidSync` implementiert das bereits, muss nur als Interface extrahiert werden.

---

## 4. DevWorld Terrain

### 4.1 Geometrie

```
500m x 500m Spielfeld
──────────────────────────────────────────────────────

     -250                    0                    +250
        ┌────────────────────┬────────────────────┐  +250
        │                    │                    │
        │    ┌────────┐      │                    │
        │    │Building│      │     ┌────────┐    │
        │    │   A    │      │     │Building│    │
        │    │ 40x25  │      │     │   D    │    │
        │    └────────┘      │     │ 20x15  │    │
        │                    │     └────────┘    │
        │         ═══════════╪═══════════        │  +100
        │              Street│North              │
        │                    │                    │
        ├────────────────────┼────────────────────┤  0
        │                    │                    │
        │         ═══════════╪═══════════════════│
        │              Street│South              │
        │    ┌────────┐      │     ┌────────┐    │
        │    │Building│      │     │Building│    │
        │    │   B    │      ⬟     │   C    │    │
        │    │ 25x12  │     HQ     │ 25x12  │    │
        │    └────────┘      │     └────────┘    │
        │                    │                    │
        └────────────────────┴────────────────────┘  -250

        ⬟ = HQ (Origin, 0/0)
        ═ = Hauptstraße
```

### 4.2 Gebäude-Konfiguration

```typescript
const DEV_BUILDINGS = [
  {
    id: 'building-a',
    position: { x: -80, z: 120 },
    size: { width: 40, height: 25, depth: 30 },
    purpose: 'LOS-Blocker für Nord-Route'
  },
  {
    id: 'building-b',
    position: { x: -70, z: -80 },
    size: { width: 25, height: 12, depth: 25 },
    purpose: 'Engpass West'
  },
  {
    id: 'building-c',
    position: { x: 70, z: -80 },
    size: { width: 25, height: 12, depth: 25 },
    purpose: 'Engpass Ost'
  },
  {
    id: 'building-d',
    position: { x: 100, z: 150 },
    size: { width: 20, height: 15, depth: 20 },
    purpose: 'LOS-Blocker Nordost'
  }
];
```

### 4.3 Terrain-Varianten (Später)

| Variante | Beschreibung | Priorität |
|----------|--------------|-----------|
| `flat` | Flache Ebene, Höhe = 0 | v1.0 |
| `heightmap` | Aus Grayscale-Bild | v2.0 |
| `procedural` | Noise-basiert | v2.0 |

---

## 5. DevWorld Straßennetz

### 5.1 Layout

```
        -200        -100         0         +100       +200
          │           │          │           │          │
    +200 ─┼───────────┼──────────┼───────────┼──────────┼─
          │           │          │           │          │
          │     ★ Spawn A        │                      │
          │           │          │                      │
    +150 ─┼═══════════╪══════════╪═══════════╪══════════┼─ Hauptstraße Nord
          │           │          │           │          │
          │           │    ┌─────┴─────┐     │          │
          │           │    │ Building A│     │          │
          │           │    └───────────┘     │          │
    +75  ─┼───────────┼──────────┼───────────┼──────────┼─ Nebenstraße
          │           │          │           │          │
          │           │          │           │          │
     0   ─╪═══════════╪══════════╪═══════════╪══════════╪═ Hauptstraße Mitte
          │           │          ⬟           │          │
          │           │         HQ           │          │
          │     ┌─────┴─────┐         ┌──────┴────┐     │
          │     │ Building B│         │Building C │     │
          │     └───────────┘         └───────────┘     │
    -75  ─┼───────────┼──────────┼───────────┼──────────┼─ Nebenstraße
          │           │          │           │          │
          │           │          │           │          │
    -150 ─┼═══════════╪══════════╪═══════════╪══════════┼─ Hauptstraße Süd
          │           │          │           │          │
          │     ★ Spawn B        │     ★ Spawn C        │
          │           │          │           │          │
    -200 ─┼───────────┼──────────┼───────────┼──────────┼─
          │           │          │           │          │

        ════  Hauptstraße (weight: 1.0)
        ────  Nebenstraße (weight: 1.5)
        │     Verbindungsstraße (weight: 1.2)
        ★     Spawn Point
        ⬟     HQ (Ziel)
```

### 5.2 Straßen-Definition

```typescript
const DEV_STREETS: StreetDefinition[] = [
  // Hauptstraßen (Ost-West)
  { id: 'main-n', type: 'primary', from: [-200, 150], to: [200, 150] },
  { id: 'main-m', type: 'primary', from: [-200, 0], to: [200, 0] },
  { id: 'main-s', type: 'primary', from: [-200, -150], to: [200, -150] },

  // Hauptstraßen (Nord-Süd)
  { id: 'main-w', type: 'primary', from: [-100, 200], to: [-100, -200] },
  { id: 'main-c', type: 'primary', from: [0, 200], to: [0, -200] },
  { id: 'main-e', type: 'primary', from: [100, 200], to: [100, -200] },

  // Nebenstraßen (Ost-West)
  { id: 'res-n', type: 'residential', from: [-150, 75], to: [150, 75] },
  { id: 'res-s', type: 'residential', from: [-150, -75], to: [150, -75] },

  // Verbindungsstraßen
  { id: 'con-1', type: 'residential', from: [-50, 150], to: [-50, 75] },
  { id: 'con-2', type: 'residential', from: [50, 150], to: [50, 75] },
  { id: 'con-3', type: 'residential', from: [-50, -75], to: [-50, -150] },
  { id: 'con-4', type: 'residential', from: [50, -75], to: [50, -150] },
];
```

### 5.3 Spawn Points

```typescript
const DEV_SPAWNS: SpawnPoint[] = [
  {
    id: 'spawn-a',
    name: 'Nord',
    position: { x: -100, z: 180 },
    expectedRoute: 'Süd über Weststraße, dann Ost zum HQ',
    estimatedDistance: 280  // Meter
  },
  {
    id: 'spawn-b',
    name: 'Südwest',
    position: { x: -100, z: -180 },
    expectedRoute: 'Nord über Weststraße zum HQ',
    estimatedDistance: 180
  },
  {
    id: 'spawn-c',
    name: 'Südost',
    position: { x: 100, z: -180 },
    expectedRoute: 'Nord über Oststraße, dann West zum HQ',
    estimatedDistance: 280
  }
];
```

### 5.4 Graph-Aufbau

```typescript
class DevStreetGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge[]> = new Map();

  constructor(streets: StreetDefinition[]) {
    // 1. Alle Endpunkte als Nodes
    streets.forEach(s => {
      this.addNode(s.from);
      this.addNode(s.to);
    });

    // 2. Kreuzungen finden (wo sich Straßen schneiden)
    this.findIntersections(streets);

    // 3. Edges mit Gewichtung
    streets.forEach(s => {
      const weight = s.type === 'primary' ? 1.0 : 1.5;
      this.addEdge(s.from, s.to, weight);
    });
  }

  findPath(from: Vector2, to: Vector2): Vector2[] {
    // A* mit Gewichtung
  }
}
```

---

## 6. Integration in Engine

### 6.1 URL-Switch

```typescript
// src/app/services/devworld.service.ts
@Injectable({ providedIn: 'root' })
export class DevWorldService {
  readonly isActive: boolean;

  constructor(private route: ActivatedRoute) {
    // Option 1: Query Parameter
    const params = new URLSearchParams(window.location.search);
    this.isActive = params.has('devworld');

    // Option 2: Route Data (wenn /devworld Route)
    // this.isActive = this.route.snapshot.data['devworld'] ?? false;
  }
}
```

### 6.2 Engine Initialization

```typescript
// three-tiles-engine.ts
async initialize(origin: GeoPosition): Promise<void> {
  const devWorld = inject(DevWorldService);

  if (devWorld.isActive) {
    // DevWorld - instant
    this.terrain = new DevTerrainProvider();
    this.streets = new DevStreetProvider();
    await this.terrain.initialize(this.scene, DEV_ORIGIN);
    await this.streets.initialize(DEV_BOUNDS);

    console.log('🎮 DevWorld loaded');
  } else {
    // Echte Tiles - async
    this.terrain = new TilesTerrainProvider();
    this.streets = new OsmStreetProvider();
    await this.terrain.initialize(this.scene, origin);
    await this.streets.initialize(this.getBounds(origin));
  }

  // Ab hier identisch
  this.setupLighting();
  this.setupCamera();
}
```

### 6.3 Bestehenden Code wrappen

```typescript
// TilesTerrainProvider - Wrapper um bestehenden Code
class TilesTerrainProvider implements TerrainProvider {
  private tilesRenderer: TilesRenderer;

  async initialize(scene: THREE.Scene, origin: GeoPosition): Promise<void> {
    // Bestehender TilesRenderer Setup-Code
    this.tilesRenderer = new TilesRenderer(TILES_URL);
    // ... (wie bisher)
  }

  getHeightAtGeo(lat: number, lon: number): number | null {
    // Bestehende getTerrainHeightAtGeo() Logik
  }

  hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    // Bestehende LOS-Check Logik
  }
}
```

---

## 7. DevWorld-spezifische Anpassungen

### 7.1 Was deaktiviert wird

| Feature | Grund |
|---------|-------|
| Location Dialog | Keine echten Locations in DevWorld |
| World Dice | Braucht echte Städte |
| URL Location Sharing | Macht keinen Sinn |
| Geocoding | Kein OSM in DevWorld |

### 7.2 Was anders funktioniert

| Feature | Echte Welt | DevWorld |
|---------|------------|----------|
| Origin | User-Location | Fester Punkt (0,0) |
| Spawns | OSM-generiert | Hardcoded 3 Punkte |
| Routen | A* auf OSM | A* auf DevStreetGraph |
| Terrain-Höhe | Raycast auf Tiles | Immer 0 (flat) |

### 7.3 UI Anpassungen

```typescript
// game-header.component.ts
@if (devWorld.isActive) {
  <div class="devworld-indicator">
    <mat-icon>science</mat-icon>
    DevWorld
  </div>
}

// Location-Button verstecken
@if (!devWorld.isActive) {
  <button (click)="openLocationDialog()">
    <mat-icon>place</mat-icon>
  </button>
}
```

---

## 8. Test-Integration

### 8.1 DevWorld als Test-Fixture

```typescript
// test/fixtures/test-world.ts
export function createTestWorld(): {
  terrain: DevTerrainProvider;
  streets: DevStreetProvider;
  scene: THREE.Scene;
} {
  const scene = new THREE.Scene();
  const terrain = new DevTerrainProvider();
  const streets = new DevStreetProvider();

  terrain.initialize(scene, DEV_ORIGIN);
  streets.initialize(DEV_BOUNDS);

  return { terrain, streets, scene };
}
```

### 8.2 Gameplay-Tests

```typescript
describe('Tower Placement', () => {
  let world: ReturnType<typeof createTestWorld>;

  beforeEach(() => {
    world = createTestWorld();
  });

  it('places tower at correct terrain height', () => {
    const position = { lat: 0.0001, lon: 0.0001 };
    const height = world.terrain.getHeightAtGeo(position.lat, position.lon);

    expect(height).toBe(0);  // DevWorld ist flat
  });

  it('LOS blocked by building', () => {
    const tower = new THREE.Vector3(-120, 10, 120);  // West von Building A
    const enemy = new THREE.Vector3(-40, 1, 120);    // Ost von Building A

    expect(world.terrain.hasLineOfSight(tower, enemy)).toBe(false);
  });
});
```

---

## 9. Implementierungsplan

### Phase 1: Interfaces (2h)

- [ ] `TerrainProvider` Interface definieren
- [ ] `StreetNetworkProvider` Interface definieren
- [ ] `CoordinateSync` Interface extrahieren (aus EllipsoidSync)

### Phase 2: DevWorld Terrain (3h)

- [ ] `DevTerrainProvider` Klasse
- [ ] Flat Plane Terrain
- [ ] Box Buildings (4 Stück)
- [ ] Raycast implementieren
- [ ] LOS Check implementieren

### Phase 3: DevWorld Streets (3h)

- [ ] `DevStreetProvider` Klasse
- [ ] Straßen-Definition (Hardcoded)
- [ ] Graph-Aufbau mit Kreuzungen
- [ ] A* Pathfinding auf Graph
- [ ] `findNearestStreetPoint()` implementieren

### Phase 4: Wrapper für bestehenden Code (2h)

- [ ] `TilesTerrainProvider` (Wrapper)
- [ ] `OsmStreetProvider` (Wrapper)
- [ ] Bestehende Logik in Wrapper verschieben

### Phase 5: Integration (2h)

- [ ] `DevWorldService` mit URL-Detection
- [ ] Engine-Switch einbauen
- [ ] UI-Anpassungen (Badge, Buttons)
- [ ] Location Dialog in DevWorld deaktivieren

### Phase 6: Testing (2h)

- [ ] Vitest Setup (falls noch nicht)
- [ ] `createTestWorld()` Fixture
- [ ] Erste Terrain-Tests
- [ ] Erste LOS-Tests
- [ ] Manueller Gameplay-Test

---

## 10. Offene Fragen

1. **Soll DevWorld auch in Production erreichbar sein?**
   - Pro: Debugging in Prod möglich
   - Contra: User könnten verwirrt sein

2. **Skybox in DevWorld?**
   - Option A: Gleiche Skybox wie echte Welt
   - Option B: Einfacher Gradient
   - Option C: Keine (schwarz)

3. **Grid-Overlay im DevWorld?**
   - Hilfreich für Debugging
   - Toggle über URL-Parameter? `?devworld&grid`

4. **Mehrere DevWorld-Presets?**
   - `?devworld=flat` - Nur Ebene
   - `?devworld=city` - Mit Gebäuden
   - `?devworld=maze` - Labyrinth für Pathfinding-Tests

5. **Straßen-Visualisierung?**
   - Sollen Straßen sichtbar gerendert werden?
   - Wie in echter Welt (Street Overlay)?

---

## 11. Geschätzter Aufwand

| Phase | Aufwand | Kumulativ |
|-------|---------|-----------|
| Phase 1: Interfaces | 2h | 2h |
| Phase 2: DevWorld Terrain | 3h | 5h |
| Phase 3: DevWorld Streets | 3h | 8h |
| Phase 4: Wrapper | 2h | 10h |
| Phase 5: Integration | 2h | 12h |
| Phase 6: Testing | 2h | 14h |
| **Gesamt** | **14h** | |

---

## 12. Erfolgskriterien

### Minimum Viable DevWorld

- [ ] `/devworld` oder `?devworld` funktioniert
- [ ] Terrain wird gerendert (Flat Plane)
- [ ] Gebäude werden gerendert (4 Boxen)
- [ ] Spawns funktionieren (3 Punkte)
- [ ] Routen werden berechnet
- [ ] Tower Placement funktioniert
- [ ] Enemies laufen Route
- [ ] LOS Check funktioniert
- [ ] Komplette Wave spielbar
- [ ] Game Over funktioniert

### Nice to Have

- [ ] Grid-Overlay Toggle
- [ ] Straßen-Visualisierung
- [ ] Heightmap-Support
- [ ] Mehrere Presets
