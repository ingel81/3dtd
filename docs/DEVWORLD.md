# DevWorld - Offline-Entwicklungsumgebung

**Status:** Implementiert
**Zugriff:** `?devworld` URL-Parameter
**Stand:** 2026-09-15

---

## Übersicht

DevWorld ist eine alternative Spielwelt die ohne Google 3D Tiles funktioniert. Sie ermöglicht:
- **Schnelles Laden** (keine Tiles, kein Netzwerk)
- **Offline-Development** (kein Netzwerk nötig)
- **Deterministische Welten** (Seed-basiert reproduzierbar)
- **Bot-Läufe** (schnelle Iterationen ohne API-Kosten)

---

## Aktivierung

Über URL-Parameter:

```
?devworld                          # Standard-Config (flat, dense, seed=42)
?devworld&terrain=mountains        # Terrain-Preset
?devworld&buildings=sparse         # Gebäude-Dichte
?devworld&spawn=north              # Spawn-Position (nur Fallback, siehe unten)
?devworld&seed=123                 # Reproduzierbarer Seed
?devworld&bot=manual               # ohne Trainings-Bot, siehe Training
?devworld&spawns=2&bot=manual      # zwei Lanes für einen Coop-Test (1 bis 4, Standard 1)
```

`DevWorldService` schreibt die aufgelösten Werte per `replaceState` zurück in die URL
(`terrain`, `seed`, `buildings` immer, `spawn` nur wenn nicht `north`). Unbekannte Werte fallen auf `flat`, `dense`, `north` und Seed 42 zurück.

`spawn` wirkt nur, wenn der Straßengenerator keinen Spawn liefert: Normalerweise nimmt
`LocationFacadeService.addPredefinedSpawns()` die ersten `spawns` generierten Spawns (Standard einer, damit Bots
das ausgelieferte Spiel mit einer Route spielen), erst ohne sie gilt `DEV_WORLD_SPAWNS[spawn]`.

**Coop in DevWorld (seit 2026-09-26):** zwei Seiten auf `?devworld&spawns=2&bot=manual`, ein Relay
(`npm run coop-server`), Host öffnet einen Raum, der Gast tritt per Code bei; ohne Kartensitzung. Ein Tab mit
`bot=manual` ignoriert die Befehle eines laufenden Bot-Servers (vorher spielte der Bot mit und kaufte beim Start das
Research Center).

---

## Architektur

DevWorld klinkt sich an zwei Stellen ein, beide über `DevWorldService.isActive`:

```
ThreeTilesEngine
    |
    +-- Produktion: TilesRenderer (Google 3D Tiles), direkt in der Engine
    +-- DevWorld:   initializeDevWorld() -> DevTerrainProvider (implements TerrainProvider)
                    Höhen-, LOS- und Screen-Raycasts der Engine verzweigen auf den Provider,
                    Kamera über EnvironmentControls statt GlobeControls

EngineInitializationService.loadStreets()
    |
    +-- Produktion: OsmStreetService.loadStreets(lat, lon, 2000)   (Overpass, IndexedDB-Cache)
    +-- DevWorld:   DevStreetProvider (implements StreetNetworkProvider),
                    Straßen und Spawns vom DevTerrainProvider
```

Die Interfaces liegen in `src/app/interfaces/` (`terrain-provider.interface.ts`,
`street-network-provider.interface.ts`). `OsmStreetService` hat dieselben Methoden,
implementiert das Interface aber nicht formal. `PathAndRouteService` bekommt in DevWorld
den `DevStreetProvider` als Pathfinding-Service (`VisualizationFacadeService`).

### Kernkomponenten

| Datei | Beschreibung |
|-------|--------------|
| `devworld.service.ts` | URL-Parameter Parsing, Config, Konstanten |
| `dev-terrain.provider.ts` | TerrainProvider-Implementierung, Meshes, Web Worker Steuerung |
| `dev-street.provider.ts` | StreetNetworkProvider mit A* Pathfinding (Gewichtung nach Straßentyp) |
| `devworld.worker.ts` | Web Worker für Off-Main-Thread Generation |
| `devworld-worker.types.ts` | Worker Message Types |
| `devworld-debug-panel.component.ts` | UI Panel: Terrain, Seed, Gebäude, Regenerate, Share-URL |
| `devworld-debugger.component.ts` | Draggable Debug Window Wrapper |

### Generatoren

| Datei | Beschreibung |
|-------|--------------|
| `generators/terrain-generator.ts` | 30 Terrain-Presets via Seeded Noise (Simplex, FBM, Ridged, Warp, Cellular) |
| `generators/street-generator.ts` | 3-Level Straßenhierarchie (Arterial, Collector, Residential) |
| `generators/building-generator.ts` | Gebäude als LOS-Blocker entlang Straßen; Größen (`BUILDING_PRESETS`) und Dichten (`DENSITY_CONFIGS`) in derselben Datei |
| `utils/seeded-random.ts` | Deterministische Noise-Funktionen (Mulberry32, `hashSeed`, Simplex aus `simplex-noise`, FBM, Ridged, Warp, Cellular) |

---

## Terrain-Presets

30 Presets in 11 Kategorien (`TERRAIN_PRESETS` in `devworld/terrain-presets.ts`, dort nach Kategorie kommentiert; der Typ `TerrainPreset` ist daraus abgeleitet):

| Kategorie | Presets |
|-----------|---------|
| Basic | `flat`, `gentle`, `default` |
| Slopes | `slope_ns`, `slope_ew`, `slope_diag` |
| Mountains | `mountains`, `peaks` |
| Valleys | `crater`, `bowl`, `dome` |
| Plateaus | `mesa`, `terraces`, `steps` |
| Cellular | `canyon`, `cells`, `cracks` |
| Waves | `waves`, `dunes`, `ripples` |
| Patterns | `spiral`, `rings` |
| Eroded | `eroded`, `weathered` |
| Biomes | `islands`, `highlands`, `badlands` |
| Extreme | `chaos`, `alien`, `fractal` |

Terrain-Features:
- Multi-Layer Domain Warping für organische Formen
- Hydraulic/Thermal Erosion Simulation
- Keine Straßen-Einebnung: Straßen folgen dem Terrain (max. 15 % Steigung im Generator),
  die Fahrbahn wird 0,5 m über dem Mesh gezeichnet
- Heightmap-Auflösung: 1024x1024 (~1m pro Pixel)
- Max. Höhe: 150m
- Terrain-Mesh: 64x64 Segmente (ca. 15,6 m pro Quad). Höhenabfragen (`getHeightAtLocal`)
  interpolieren die Mesh-Oberfläche, nicht die Heightmap, damit Boden-Samples, CPU-Raycasts
  und die GPU-LOS-Cubemap dieselbe Fläche sehen

---

## Gebäude-Dichte

URL-akzeptierte Werte (`?devworld&buildings=…`, siehe `DevWorldService.parseBuildingsParam`):

| Preset | Beschreibung |
|--------|--------------|
| `none` | Keine Gebäude |
| `sparse` | 150 Gebäude, nur `medium` und `large` |
| `dense` | 1200 Gebäude, Stadtgefühl (Default) |
| `maze` | 2000 Gebäude, überwiegend `small`: dicht gestellte Blocker, platziert wie die anderen Stufen |

Hinweis: `building-generator.ts` definiert intern zusätzlich eine Stufe `medium`
(`BuildingDensity = 'none' | 'sparse' | 'medium' | 'dense' | 'maze'`).
Über den URL-Parameter ist sie nicht erreichbar: `parseBuildingsParam` macht aus
`medium` (wie aus jedem unbekannten Wert) `dense`. Bei Bedarf kann der Generator-Aufrufer den
Wert direkt setzen.

Platzierungslogik:
- Alle Gebäude entlang von Straßen platziert (keine isolierten Cluster)
- Mehrere Reihen pro Straßenseite (bis zu 4 Reihen)
- HQ Safe Zone wird respektiert (min. 60m Abstand)
- Grid-Fallback wenn keine Straßen vorhanden
- Gebäude dienen als LOS-Blocker für Tower-Placement
- Gerendert als ein InstancedMesh; für Raycasts hält `DevTerrainProvider` zusätzlich
  Box-Meshes, die nicht in der Szene hängen

---

## Straßen-Generation

3-Level Hierarchie:
1. **Arterial** (primary) - Hauptstraßen, breiter
2. **Collector** (secondary) - Verbindungsstraßen
3. **Residential** - Wohnstraßen, schmaler

Fahrbahnbreite je Klasse (`DEV_STREET_WIDTHS`): primary 8 m, secondary 7 m, residential 5 m.
`DevTerrainProvider` zeichnet die Straßen so breit, `DevStreetProvider` gibt denselben Wert
als `width` weiter wie ein OSM-Tag.

Features:
- Terrain-Following mit max. 15% Steigung
- Catmull-Rom Splines für Kurven
- L-System Branching für Collector-Straßen
- Union-Find Connectivity Validation
- Min. 30m Intersection-Abstand
- A* Pathfinding mit Straßentyp-Gewichtung

Spawns: Der Generator legt bis zu 4 an Straßenenden an (mindestens 0,7 x `minSpawnDistance`
vom HQ, Default 300 m). Das Spiel nutzt nur den ersten, beim Laden
(`addPredefinedSpawns()`) wie nach dem Regenerieren (`onDevWorldRegenerated()`), passend
zum Ein-Spawn-Spiel der echten Welt.

---

## Web Worker

Die Terrain-/Straßen-/Gebäude-Generation läuft in einem Web Worker um den Main Thread nicht zu blockieren:

```
Main Thread                    Worker
    |                             |
    |-- generate(config) -------->|
    |                             |-- Terrain generieren
    |<-- progress(terrain, 0/100)-|
    |                             |-- Straßen generieren
    |<-- progress(streets, 0/100)-|
    |                             |-- Gebäude platzieren
    |<-- progress(buildings,0/100)|
    |                             |
    |<-- result(heightData,       |
    |    streetSegments,          |
    |    spawnPoints,             |
    |    buildingConfigs) --------|
```

Jede Phase meldet nur 0 und 100 %; `DevTerrainProvider` wertet die Progress-Nachrichten
derzeit nicht aus. Die Three.js-Meshes baut der Main Thread aus dem Ergebnis.

---

## Konstanten

```typescript
DEV_WORLD_SIZE = 1000          // 1km x 1km Spielfeld
DEV_WORLD_HEIGHTMAP_SIZE = 1024 // ~1m Aufloesung
DEV_WORLD_MAX_HEIGHT = 150     // Max. Terrain-Höhe in Metern
DEV_WORLD_DEFAULT_SEED = 42    // Standard-Seed
DEV_WORLD_ORIGIN = { lat: 0.0, lon: 0.0, height: 0 }  // Fake Geo-Koordinaten
```

---

## Debug Panel

Das DevWorld Debug Panel (`app-devworld-debug-panel`) ermöglicht zur Laufzeit:
- Terrain-Preset wechseln (nach Kategorie gruppiert)
- Building-Dichte ändern
- Seed ändern
- Welt regenerieren
- Share-URL kopieren (`DevWorldService.getShareUrl()`)

Das Debug-Fenster ist nicht automatisch offen: Mit `?devworld` zeigen die Quick Actions eine
Kachel "DevWorld", die es umschaltet.

Regenerieren: `LocationFacadeService.refreshTerrainHeights()` räumt die Szene
(`clearDevWorldVisuals()`), ruft `DevTerrainProvider.regenerate()` und danach
`onDevWorldRegenerated()`: HQ-Marker, ein Spawn, Route-Grid vor den Routenlinien, dann
`GameStateManager.reseatWavePipeline()`, damit die nächste Welle auf der neuen Karte startet.

---

## Route-Grid und Korridor

- `filterStreetNetworkToRoutes()` filtert in DevWorld nicht, das ganze Netz bleibt.
- Die Höhen kommen in einem Schritt vom Mesh, es gibt keine Tile-Batches. Die Zellen tasten
  einmal beim Aufbau des Grids ab; beim Neugenerieren baut
  `LocationFacadeService.onDevWorldRegenerated()` erst das Grid und legt dann die Routenlinien
  darauf (`PathRouteService.refreshRouteLines()`).
- Korridor: `engine.terrain.measureStreetClearance()` (`TerrainQueries`) gibt in DevWorld `null` zurück, es
  laufen keine Clearance-Rays. Der Korridor behält die Breite aus `DEV_STREET_WIDTHS`.
  Details: [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md).
- LOS: Fahrbahn-Stempel und Terrain-Skirt tragen `userData.losTransparent` und fehlen in
  der LOS-Cubemap (`tower-shadow-mapper.ts`); Terrain-Mesh und Gebäude blockieren.

---

## Training

Mit `?devworld` schaltet `TowerDefenseFacadeService` den AI-Director ein
(`directorEnabled`), verbindet `BotClientService` mit dem Backend und startet den Bot
`strategist` mit Auto-Waves, außer bei `?bot=manual`. Die Engine läuft auch im
Hintergrund-Tab weiter (`setBackgroundLoopEnabled`), und nur in DevWorld zeigt der Header
den Rendering-Schalter (headless). Verbindet sich der Tab mit dem Bot-Server, geht er headless,
mit `?bot=manual` nicht: Dort spielt der Mensch und das Bild bleibt an (seit 2026-09-23, vorher
wurde auch der manuelle Tab dunkel). Trainings-Tabs öffnen `http://localhost:4200/?devworld`,
Details in [BOT_SYSTEM.md](BOT_SYSTEM.md).
