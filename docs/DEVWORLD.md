# DevWorld - Offline-Entwicklungsumgebung

**Status:** Implementiert
**Zugriff:** `?devworld` URL-Parameter

---

## Uebersicht

DevWorld ist eine alternative Spielwelt die ohne Google 3D Tiles funktioniert. Sie ermoeglicht:
- **Sofortiges Laden** (<100ms statt 3-8s)
- **Offline-Development** (kein Netzwerk noetig)
- **Deterministische Welten** (Seed-basiert reproduzierbar)
- **AI Training** (schnelle Iterationen ohne API-Kosten)

---

## Aktivierung

Ueber URL-Parameter:

```
?devworld                          # Standard-Config (flat, dense, seed=42)
?devworld&terrain=mountains        # Terrain-Preset
?devworld&buildings=sparse         # Gebaeude-Dichte
?devworld&spawn=north              # Spawn-Position
?devworld&seed=123                 # Reproduzierbarer Seed
?devworld&grid                     # Debug-Grid anzeigen
```

---

## Architektur

DevWorld nutzt das Provider-Pattern um Google 3D Tiles transparent zu ersetzen:

```
ThreeTilesEngine
    |
    +-- TerrainProvider (Interface)
    |   +-- TilesTerrainProvider   (Google 3D Tiles - Production)
    |   +-- DevTerrainProvider     (Generierte Geometrie - DevWorld)
    |
    +-- StreetNetworkProvider (Interface)
        +-- OsmStreetService       (OpenStreetMap - Production, Angular Service)
        +-- DevStreetProvider      (Generiertes Netz - DevWorld)
```

### Kernkomponenten

| Datei | Beschreibung |
|-------|--------------|
| `devworld.service.ts` | URL-Parameter Parsing, Config, Konstanten |
| `dev-terrain.provider.ts` | TerrainProvider-Implementierung, Web Worker Steuerung |
| `dev-street.provider.ts` | StreetNetworkProvider mit A* Pathfinding |
| `devworld.worker.ts` | Web Worker fuer Off-Main-Thread Generation |
| `devworld-worker.types.ts` | Worker Message Types |
| `devworld-debug-panel.component.ts` | UI Panel fuer Terrain/Building-Auswahl |
| `devworld-debugger.component.ts` | Draggable Debug Window Wrapper |

### Generatoren

| Datei | Beschreibung |
|-------|--------------|
| `generators/terrain-generator.ts` | 28 Terrain-Presets via Seeded Noise (Simplex, FBM, Ridged, etc.) |
| `generators/street-generator.ts` | 3-Level Strassenhierarchie (Arterial, Collector, Residential) |
| `generators/building-generator.ts` | Gebaeude als LOS-Blocker, entlang Strassen platziert |
| `configs/building-presets.config.ts` | Vordefinierte Gebaeude-Layouts (none, sparse, dense, maze) |
| `utils/seeded-random.ts` | Deterministische Noise-Funktionen (Mulberry32, Simplex) |

---

## Terrain-Presets

28 Presets in 11 Kategorien:

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
- Multi-Layer Domain Warping fuer organische Formen
- Hydraulic/Thermal Erosion Simulation
- Street Flattening (Strassen werden ins Terrain eingeebnet)
- Heightmap-Aufloesung: 1024x1024 (~1m pro Pixel)
- Max. Hoehe: 150m

---

## Gebaeude-Dichte

| Preset | Beschreibung |
|--------|--------------|
| `none` | Keine Gebaeude |
| `sparse` | Wenige grosse Gebaeude (150 Stueck) |
| `dense` | Viele Gebaeude, Stadtgefuehl (1200 Stueck) |
| `maze` | Maximale Dichte, labyrinth-artig (2000 Stueck) |

Platzierungslogik:
- Alle Gebaeude entlang von Strassen platziert (keine isolierten Cluster)
- Mehrere Reihen pro Strassenseite (bis zu 4 Reihen)
- HQ Safe Zone wird respektiert (min. 60m Abstand)
- Grid-Fallback wenn keine Strassen vorhanden
- Gebaeude dienen als LOS-Blocker fuer Tower-Placement

---

## Strassen-Generation

3-Level Hierarchie:
1. **Arterial** (primary) - Hauptstrassen, breiter
2. **Collector** (secondary) - Verbindungsstrassen
3. **Residential** - Wohnstrassen, schmaler

Features:
- Terrain-Following mit max. 15% Steigung
- Catmull-Rom Splines fuer Kurven
- L-System Branching fuer Collector-Strassen
- Union-Find Connectivity Validation
- Min. 30m Intersection-Abstand
- A* Pathfinding mit Strassentyp-Gewichtung

---

## Web Worker

Die Terrain-/Strassen-/Gebaeude-Generation laeuft in einem Web Worker um den Main Thread nicht zu blockieren:

```
Main Thread                    Worker
    |                             |
    |-- generate(config) -------->|
    |                             |-- Terrain generieren
    |<-- progress(terrain, 50%) --|
    |                             |-- Strassen generieren
    |<-- progress(streets, 75%) --|
    |                             |-- Gebaeude platzieren
    |<-- progress(buildings, 90%)-|
    |                             |
    |<-- result(heightData,       |
    |    streets, buildings) -----|
```

---

## Konstanten

```typescript
DEV_WORLD_SIZE = 1000          // 1km x 1km Spielfeld
DEV_WORLD_HEIGHTMAP_SIZE = 1024 // ~1m Aufloesung
DEV_WORLD_MAX_HEIGHT = 150     // Max. Terrain-Hoehe in Metern
DEV_WORLD_DEFAULT_SEED = 42    // Standard-Seed
DEV_WORLD_ORIGIN = { lat: 0, lon: 0 }  // Fake Geo-Koordinaten
```

---

## Debug Panel

Das DevWorld Debug Panel (`app-devworld-debug-panel`) ermoeglicht zur Laufzeit:
- Terrain-Preset wechseln (nach Kategorie gruppiert)
- Building-Dichte aendern
- Seed aendern
- Welt regenerieren

Wird automatisch angezeigt wenn `?devworld` aktiv ist.
