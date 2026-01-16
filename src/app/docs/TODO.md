# Offene TODOs

> Siehe auch: [EXPERT_REVIEW_2026.md](EXPERT_REVIEW_2026.md) fuer detaillierte Analyse

---

## Code Quality & Architektur (aus Expert Review)

### Prioritaet 2: Mittelfristig
- [ ] **GameStateManager aufteilen** (~800 Zeilen, God-Object)
      Vorschlag: combat.manager.ts, effects.manager.ts, fire-intensity.manager.ts
      Siehe: [EXPERT_REVIEW_2026.md#13-empfehlung-gamestatemanager-aufteilen](EXPERT_REVIEW_2026.md#13-empfehlung-gamestatemanager-aufteilen)

- [ ] **Entity Object Pooling implementieren** - EntityPoolService ist nur Placeholder
      Datei: `entity-pool.service.ts`
      Siehe: [EXPERT_REVIEW_2026.md#21-object-pooling](EXPERT_REVIEW_2026.md)

- [ ] **Spatial Partitioning (Grid)** - Range-Checks sind O(n)
      Datei: `enemy.manager.ts:284-294` (getEnemiesInRadius)
      Siehe: [EXPERT_REVIEW_2026.md#43-loesung-spatial-partitioning](EXPERT_REVIEW_2026.md#43-loesung-spatial-partitioning)

- [ ] **Globaler Asset Manager** - 3 separate Model-Caches konsolidieren
      Betroffene: ThreeTowerRenderer, ThreeEnemyRenderer, ModelPreviewService
      Siehe: [EXPERT_REVIEW_2026.md#62-empfehlung-globaler-asset-manager](EXPERT_REVIEW_2026.md#62-empfehlung-globaler-asset-manager)

### Prioritaet 3: Langfristig
- [ ] **TowerDefenseComponent aufteilen** (~2280 Zeilen)
      Vorschlag: StreetRenderingService, WaveOrchestrationService, LocationChangeService

- [ ] **Event-System einfuehren** - Aktuell nur Callbacks
      Vorschlag: Typisierter EventBus mit emit<T>() und on<T>()

- [ ] **LOD-System fuer Entities** - Aktuell nicht vorhanden

- [ ] **Koordinaten-Typen vereinheitlichen** - 3 verschiedene Formate im Code
      `GeoPosition` vs `{latitude, longitude}` vs `{lat, lon}`
      Siehe: [EXPERT_REVIEW_2026.md#8-koordinaten-typen-inkonsistenz](EXPERT_REVIEW_2026.md#8-koordinaten-typen-inkonsistenz)

---

## Performance (aus Expert Review)

- [ ] **Reusable Vectors in ThreeEffectsRenderer**
      Datei: `three-effects.renderer.ts:1372, 1478, 1489` - `velocity.clone()` pro Partikel
      Siehe: [EXPERT_REVIEW_2026.md#41-kritische-hotspots](EXPERT_REVIEW_2026.md#41-kritische-hotspots)

- [ ] **Cached getAlive() Result** - Erstellt Array jeden Frame
      Datei: `enemy.manager.ts:267-269`

- [ ] **Fast-Distance statt Haversine** fuer lokale Berechnungen (<200m)
      Math.sin/cos in jedem Frame vermeiden

- [~] Tile-Loading optimiert (downloadQueue.maxJobs=4, parseQueue.maxJobs=1, groesserer lruCache)
      [~] Deutlich fluessiger

- [ ] Viele Gegner sind erfreulicherweise kein Problem...nur beim Panning/Zooming wenn Tiles dazu kommen

- [ ] Instanced Decal Rendering - Blood/Ice Decals auf InstancedMesh umstellen
      - Aktuell: ~250 Draw Calls fuer separate Meshes
      - Mit Instancing: 2 Draw Calls (1 Blood-Pool, 1 Ice-Pool)

---

## Dokumentation (aus Expert Review)

- [ ] **CLAUDE.md aktualisieren** - Service/Manager-Anzahl falsch
      "17 Services" -> 19, "8 Manager" -> 7
      Siehe: [EXPERT_REVIEW_2026.md#71-inkonsistenzen](EXPERT_REVIEW_2026.md#71-inkonsistenzen-docs-vs-code)

- [ ] **CLAUDE.md Dokumentations-Tabelle ergaenzen**
      Fehlend: FRAME_TIMING_FIXES.md, PARTICLE_SYSTEM.md, tasks/FPS_LIMIT.md, EXPERT_REVIEW_2026.md

- [ ] **ARCHITECTURE.md Dateistruktur korrigieren**
      `game/` Subfolder-Fehler (Zeilen 728-813)

- [ ] **src/app/README.md ueberarbeiten oder entfernen**
      Komplett veraltet: falsche Pfade, falsche Tower-Anzahl, veraltete APIs

- [ ] **ENEMY_CREATION.md erstellen** - Analog zu TOWER_CREATION.md
      Enemy-System ist nicht dokumentiert

- [ ] **Status-Effekt-System dokumentieren**
      Datei: `models/status-effects.ts`

- [ ] **Wave-System dokumentieren**
      WaveManager und Wave-Konfiguration

---

## Three.js & Rendering (aus Expert Review)

- [ ] **Selection Ring Geometry teilen**
      Datei: `three-tower.renderer.ts:389` - jeder Tower erstellt eigene Geometry

- [ ] **Model Templates korrekt disposen**
      Datei: `three-tower.renderer.ts:1479` - Geometry/Material nicht disposed

- [ ] **Tiles Update throttlen wenn Kamera statisch**
      Datei: `three-tiles-engine.ts:948` - Update jeden Frame auch ohne Bewegung

---

## Config-System erweitern

- [ ] **audio.config.ts erstellen** - Sound-Configs zentralisieren
      Aktuell: `projectile.manager.ts`, `spatial-audio.manager.ts`

- [ ] **visual-effects.config.ts erstellen** - Partikel/Decal-Configs
      Aktuell: `three-effects.renderer.ts:110-150` (MAX_PARTICLES, DECAL_FADE etc.)

- [ ] **timing.config.ts erstellen** - Animation/Game Timings
      Aktuell: Death-Animation (2000ms), LOS-Recheck (300ms), Spawn-Delays etc.

---

## Bestehende TODOs

### Bewerten
- [ ] FPS LIMIT auf 60 sinnvoll?
- [ ] Explosionen bei Rocket Treffern und Cannon Treffern
- [ ] Keine LOS Berechnung wenn Tower nicht gebaut werden kann
- [ ] LOS Berechnung performanter machen (gedrosselt und stueckweise einblenden)
- [ ] Gatling Dual Fire mit exakten Positionen der Barrels abwechselnd links und rechts

### Beobachten bis Testcase wieder da
- [ ] Mobs laufen z.T. unterirdisch an bestimmten Stellen (Vermutung: Unterbrechung der Route)

### Location-System Bekannte Einschraenkungen
- [ ] Nominatim-Geocoding gibt oft Strassen-Koordinaten statt Gebaeude-Koordinaten
      - Workaround: Manuelle Koordinaten-Eingabe nutzen
      - Moegliche Verbesserung: Alternative Geocoding-API (Photon, Google)

### Ideen
- [ ] Fette Explosion wenn HQ final kaputt
- [ ] Coole Locations irgendwie sharebar machen (URL-Parameter deaktiviert wegen Timing-Bugs beim Tile-Loading)
- [ ] Poison Tower
- [ ] Magic Tower
- [ ] Flame Tower

### Stashed Features
- [ ] World Dice - Random Street Generator (git stash: "feat: world dice random location generator")
      Wikidata SPARQL fuer zufaellige Stadt + Overpass API fuer Strasse
      Wuerfel-Button in Header + Location-Dialog
