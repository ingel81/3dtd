# Tower Defense - Erlenbach

Ein Tower Defense Spiel mit echten 3D-Karten von Erlenbach (Google Photorealistic 3D Tiles).

**Status:** POC (Proof of Concept) - Admin-only sichtbar

## 3D Engine

Das Spiel nutzt **Three.js** mit **3DTilesRendererJS** (NASA JPL) für Google Photorealistic 3D Tiles.

| Komponente | Technologie |
|------------|-------------|
| 3D-Rendering | Three.js |
| Google 3D Tiles | 3DTilesRendererJS (NASA JPL) |
| Koordinaten | WGS84 via EllipsoidSync |
| Terrain-Höhen | Raycast gegen geladene Tiles |
| Authentifizierung | Cesium Ion Token |

## Features

### Implementiert

- **3D-Karte**: Echte Gebäude und Terrain von Erlenbach (Google Photorealistic 3D Tiles)
- **Straßennetz**: Gegner laufen auf echten Straßen (OpenStreetMap + A* Pathfinding)
- **3D-Modelle**: Tower und Enemies als glTF/glb Modelle
- **Animationen**: Zombies mit Walk- und Death-Animation (AnimationMixer)
- **Tower-System**: Platziere Tower neben Straßen (10-50m Abstand)
- **Wellen-System**: Gegner spawnen in Wellen
- **Projektile**: Tower schießen auf Gegner in Reichweite
- **Health Bars**: Gegner haben HP und farbige Lebensbalken (Sprites)
- **Blut-Effekte**: Partikel bei Treffern
- **Terrain-Following**: Overlays folgen dem echten Gelände (Raycast-basiert)
- **localStorage Cache**: OSM-Daten werden gecacht

### UI-Toggles

| Button | Funktion | Default |
|--------|----------|---------|
| Straßen | Gelbe Straßen ein/aus | Aus |
| Routen | Rote Gegner-Pfade ein/aus | Aus |
| Terrain | Terrain-Höhen Debug-Marker | Aus |
| Neigung | Kamera-Neigung wechseln | 45° |
| Kamera | Kamera zurücksetzen | - |

## Architektur

```
tower-defense/
├── tower-defense.component.ts    # Haupt-UI + Three.js Integration
├── README.md                     # Diese Dokumentation
│
├── three-engine/                 # Three.js + 3DTilesRenderer Engine
│   ├── three-tiles-engine.ts     # Haupt-Engine (Scene, Renderer, Tiles)
│   ├── ellipsoid-sync.ts         # WGS84 ↔ Three.js Koordinaten
│   └── renderers/
│       ├── three-enemy.renderer.ts      # GLB Models + AnimationMixer
│       ├── three-tower.renderer.ts      # Tower Models + Range/Selection
│       └── three-projectile.renderer.ts # Projektile
│
├── core/                         # OO Game Engine
│   ├── game-object.ts            # GameObject Base Class
│   └── component.ts              # Component System
│
├── game-components/              # Entity Components
│   ├── transform.component.ts    # Position, Rotation
│   ├── health.component.ts       # HP, Damage
│   ├── movement.component.ts     # Path-Following
│   ├── combat.component.ts       # Damage, Range, Fire Rate
│   └── render.component.ts       # Renderer Integration
│
├── entities/                     # Spezialisierte GameObjects
│   ├── enemy.entity.ts           # Enemy mit Components
│   ├── tower.entity.ts           # Tower mit Components
│   └── projectile.entity.ts      # Projectile mit Components
│
├── managers/                     # Entity Lifecycle Management
│   ├── game-state.manager.ts     # Main Orchestrator
│   ├── enemy.manager.ts          # Spawn, Kill, Wave
│   ├── tower.manager.ts          # Placement, Selection
│   ├── projectile.manager.ts     # Spawn, Hit Detection
│   └── wave.manager.ts           # Wave Progression
│
├── configs/                      # Type Registries
│   ├── tower-types.config.ts     # Archer, Cannon, Magic, Sniper
│   └── projectile-types.config.ts
│
├── models/
│   ├── enemy-types.ts            # Zombie, Tank Definitionen
│   └── game.types.ts             # GeoPosition, etc.
│
├── services/
│   └── osm-street.service.ts     # OpenStreetMap + A* Pathfinding
│
├── components/
│   └── debug-panel.component.ts  # Debug-Steuerung
│
└── docs/
    ├── ARCHITECTURE.md           # Detaillierte Architektur
    └── MIGRATION_TO_THREE_TILES.md  # Migrations-Dokumentation
```

## Koordinatensystem

Mit ReorientationPlugin (recenter: true) werden Tiles auf den Origin (HQ) zentriert:

```
Lokale Koordinaten (overlayGroup):
  X = East/West Offset (Meter), -X = East
  Y = Höhe über Origin-Terrain
  Z = North/South Offset (Meter), +Z = North
```

### Geo → Lokal Transformation

```typescript
// Für Overlays (Straßen, Marker, Routen)
const local = engine.sync.geoToLocalSimple(lat, lon, 0);

// Terrain-Höhe per Raycast (relativ zu Origin)
const terrainY = engine.getTerrainHeightAtGeo(lat, lon);
const originTerrainY = engine.getTerrainHeightAtGeo(originLat, originLon);
local.y = (terrainY - originTerrainY) + HEIGHT_ABOVE_GROUND;
```

### Overlays

Objekte zu `overlayGroup` hinzufügen (NICHT scene.add()!):

```typescript
const overlayGroup = engine.getOverlayGroup();
const localPos = engine.sync.geoToLocalSimple(lat, lon, height);
mesh.position.copy(localPos);
overlayGroup.add(mesh);
```

Die overlayGroup wird automatisch mit der Tiles-Bewegung synchronisiert und auf `overlayBaseY` (Origin-Terrain-Höhe) positioniert.

## Terrain-Höhenermittlung

Terrain-Höhen werden per Raycast gegen die geladenen 3D Tiles ermittelt:

```typescript
// In three-tiles-engine.ts
getTerrainHeightAtGeo(lat: number, lon: number): number | null {
  const localPos = this.sync.geoToLocalSimple(lat, lon, 0);
  const rayOrigin = new THREE.Vector3(localPos.x, 10000, localPos.z);
  const direction = new THREE.Vector3(0, -1, 0);

  this.raycaster.set(rayOrigin, direction);
  const results = this.raycaster.intersectObject(this.tilesRenderer.group, true);

  return results.length > 0 ? results[0].point.y : null;
}
```

## Setup

Cesium Ion Token in `environment.ts`:

```typescript
export const environment = {
  cesiumAccessToken: 'dein-token-hier'
};
```

Token erstellen: https://cesium.com/ion/tokens

## 3D-Modelle

Modelle befinden sich in `/public/assets/games/tower-defense/models/`:

| Datei | Typ | Beschreibung |
|-------|-----|--------------|
| `tower_archer.glb` | Tower | Bogen-Turm |
| `tower_cannon.glb` | Tower | Kanonen-Turm |
| `tower_magic.glb` | Tower | Magie-Turm |
| `tower_sniper.glb` | Tower | Sniper-Turm |
| `zombie_alternative.glb` | Enemy | Zombie mit Animationen |
| `tank.glb` | Enemy | Panzer |

## Koordinaten (Erlenbach, BW)

```typescript
// HQ / Origin
BASE_COORDS = {
  latitude: 49.17326887448299,
  longitude: 9.268588397188681
}

// Spawn-Punkte
SPAWN_POINTS = [
  { name: 'Nord', latitude: 49.17554723, longitude: 9.26387053 },
  { name: 'Sued', latitude: 49.16999715, longitude: 9.26636044 }
]
```

## Tower-Platzierung

| Regel | Wert |
|-------|------|
| Min. Abstand zu Straße | 10m |
| Max. Abstand zu Straße | 50m |
| Min. Abstand zu Basis | 30m |
| Min. Abstand zu Spawn | 30m |
| Min. Abstand zu anderen Towern | 20m |

## Steuerung

| Aktion | Steuerung |
|--------|-----------|
| Kamera verschieben | Linke Maustaste + Ziehen |
| Kamera drehen | Strg + Maus |
| Zoom | Mausrad |
| Tower selektieren | Klick auf Tower |
| Tower platzieren | Build-Mode → Klick neben Straße |

## Performance

- **AnimationMixer**: Pro Enemy-Typ ein Mixer
- **Instanced Rendering**: Projektile als InstancedMesh
- **Raycast-Cache**: Terrain-Höhen werden gecacht
- **localStorage Cache**: OSM-Daten werden lokal gespeichert

## Dokumentation

| Datei | Inhalt |
|-------|--------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | OO Game Engine Architektur |

**Hinweis:** Die Migration von Cesium.js zu Three.js + 3DTilesRendererJS ist abgeschlossen.
Cesium.js wurde vollständig aus der Codebasis entfernt.

## Offene Features

- [ ] Mehr Spawn-Punkte
- [ ] Wave-Progression (mehr/stärkere Gegner)
- [ ] Tower-Upgrades
- [ ] Game Over Screen mit Highscore
- [ ] Tower-Verkauf
- [ ] Weitere Gegner-Typen
