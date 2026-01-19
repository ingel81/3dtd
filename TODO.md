# Offene TODOs

> Siehe auch: [EXPERT_REVIEW_2026.md](src/app/docs/archive/EXPERT_REVIEW_2026.md) fuer detaillierte Analyse

---

## Code Quality & Architektur (aus Expert Review)

### Prioritaet 2: Mittelfristig
- [ ] **GameStateManager weiter aufteilen** (~543 Zeilen, von 800 reduziert durch Event-System)
      Combat/VFX/HQ-Fire bereits ausgelagert. Optional: weitere Aufteilung
      Siehe: [EXPERT_REVIEW_2026.md#13-empfehlung-gamestatemanager-aufteilen](src/app/docs/archive/EXPERT_REVIEW_2026.md#13-empfehlung-gamestatemanager-aufteilen)

- [ ] **Entity Object Pooling implementieren** - EntityPoolService ist nur Placeholder
      Datei: `entity-pool.service.ts`
      Siehe: [EXPERT_REVIEW_2026.md#21-object-pooling](src/app/docs/archive/EXPERT_REVIEW_2026.md)

- [x] ~~**Spawn-Logik in WaveManager konsolidieren**~~ - ✅ ERLEDIGT (2026-01-19)
      tower-defense.component.ts delegiert jetzt an gameState.startWave() → waveManager.startWave()
      Keine eigene Spawn-Logik mehr in der Komponente

### Prioritaet 3: Langfristig
- [ ] **TowerDefenseComponent weiter aufteilen** (~1797 Zeilen, von 2280 reduziert durch Event-System)
      Provider entfernt, Event-Subscriptions vereinfacht. Optional: weitere Aufteilung

- [x] ~~**Event-System einfuehren**~~ - ✅ ERLEDIGT (2026-01-19)
      GameEventBus mit 20 Event-Typen, alle Manager event-driven
      Siehe: [EVENT_SYSTEM.md](src/app/docs/EVENT_SYSTEM.md) und [DONE.md](DONE.md#2026-01-19)

- [ ] **Koordinaten-Typen vereinheitlichen** - 3 verschiedene Formate im Code
      `GeoPosition` vs `{latitude, longitude}` vs `{lat, lon}`
      Siehe: [EXPERT_REVIEW_2026.md#8-koordinaten-typen-inkonsistenz](src/app/docs/archive/EXPERT_REVIEW_2026.md#8-koordinaten-typen-inkonsistenz)

- [ ] **Codebase komplett auf Englisch umstellen** - Strings, Kommentare, Variablen, UI
      Aktuell: Deutsche Tower-Namen ('Schnellfeuer'), Enemy-Namen ('Fledermaus'), UI-Texte, Tooltips

### Event-System Erweiterungen (optional)

> Siehe: [EVENT_SYSTEM.md](src/app/docs/EVENT_SYSTEM.md) fuer aktuelle Implementierung

- [x] ~~**Letzten Callback entfernen**~~ - ✅ ERLEDIGT (2026-01-19)
      `onDebugLogCallback` war toter Code und wurde entfernt
- [x] ~~**SpatialAudio debugCallback**~~ - ✅ ERLEDIGT (2026-01-19)
      `debug:sound` Event hinzugefuegt, SoundDebugService subscribt via EventBus
- [ ] **Pause-System Events** - `game:started`, `game:paused`, `game:resumed`
      Fuer zukuenftiges Pause-Feature

---

## Performance Optimierung (aus Performance Report)

> Siehe: [PERFORMANCE_REPORT.md](src/app/docs/archive/PERFORMANCE_REPORT.md) für Details
> Erwarteter Gesamt-Gewinn: +80-100% FPS, -140MB Download, Memory Leaks behoben

### 🟡 Priorität 2: Hoher Impact

- [ ] **Tiles Update Throttling** - 5-10% FPS bei statischer Kamera
      `three-tiles-engine.ts:965-969` - Nur bei Kamera-Bewegung updaten
      → [Teil 1.2](src/app/docs/archive/PERFORMANCE_REPORT.md#12-kritisches-problem-tiles-update-ohne-throttling)

- [ ] **Animation LOD System** - 60-80% Animation-CPU verschwendet
      Enemies @ 200m+ mit 6 FPS statt 60 FPS animieren
      → [Teil 3.1](src/app/docs/archive/PERFORMANCE_REPORT.md#31-kritisch-kein-animation-lod-system-)

- [ ] **HQ Explosion Partikel reduzieren** - 1350 → 500 Partikel
      `game-state.manager.ts:990-1103` - Massive Overdraw
      → [Teil 5.2](src/app/docs/archive/PERFORMANCE_REPORT.md#52-overdraw-durch-additive-blending)

- [ ] **Magic Orb Shader vereinfachen** - 200-300 ALU → 100 ALU
      `magic-orb.shaders.ts` - FBM 4→2 Iterationen, Voronoi 3×3→2×2
      → [Teil 5.1](src/app/docs/archive/PERFORMANCE_REPORT.md#51-magic-orb-shader---zu-komplex)

- [ ] **Partikel Free-List** - O(n) → O(1) Pool-Suche
      `three-effects.renderer.ts:1926-1933` - 1000× schneller bei voller Auslastung
      → [Teil 6.1](src/app/docs/archive/PERFORMANCE_REPORT.md#61-linearer-pool-search)

- [ ] **Draco Model Compression** - 132MB → 30MB Models
      gltf-pipeline mit Draco, DRACOLoader in asset-manager
      → [Teil 10.1](src/app/docs/archive/PERFORMANCE_REPORT.md#101-unkomprimierte-3d-models--kritisch-132mb)

- [ ] **A* MinHeap statt Linear Search** - 50-100ms gespart
      `osm-street.service.ts:323-354` - TinyQueue für O(log n)
      → [Teil 9.1](src/app/docs/archive/PERFORMANCE_REPORT.md#91-route-calculation--kritisch-100-500ms)

- [ ] **Sleeping Towers** - Idle Towers nicht updaten
      `tower.manager.ts` - Sleep/Wake System für Towers ohne Target
      → [Teil 2.4](src/app/docs/archive/PERFORMANCE_REPORT.md#24-sleeping-towers--fehlt)

- [ ] **Progressive Asset Loading** - 3-8s → 0.5-1s TTI
      Nur Critical Assets upfront, Rest im Background
      → [Teil 10.4](src/app/docs/archive/PERFORMANCE_REPORT.md#104-fehlende-progressive-loading)

- [ ] **Performance Instrumentation** - Null Monitoring vorhanden
      PerformanceMonitorService mit mark/measure, Memory, Long Tasks
      → [Teil 15](src/app/docs/archive/PERFORMANCE_REPORT.md#teil-15-performance-instrumentation--kritisch-fehlt)

### 🟢 Priorität 3: Moderate Impact

- [ ] **Selection Ring Geometry teilen** - Memory sparen
      `three-tower.renderer.ts:315-322` - Shared Geometry + Material
      → [Teil 4.3](src/app/docs/archive/PERFORMANCE_REPORT.md#43-selection-ring-geometry-nicht-geteilt)

- [ ] **Bounding Sphere Culling** - Große Enemies korrekt cullen
      `three-enemy.renderer.ts:440` - intersectsSphere statt containsPoint
      → [Teil 3.2](src/app/docs/archive/PERFORMANCE_REPORT.md#32-frustum-culling---gut-aber-verbesserungsfähig)

- [ ] **Partikel-Systeme konsolidieren** - 4 → 2 Draw Calls
      `three-effects.renderer.ts` - Additive + Normal zusammenfassen
      → [Teil 6.2](src/app/docs/archive/PERFORMANCE_REPORT.md#62-konsolidierung-der-partikel-systeme)

- [ ] **Tower Frustum Culling** - Unsichtbare Towers nicht animieren
      `three-tower.renderer.ts:659`
      → [Teil 4.4](src/app/docs/archive/PERFORMANCE_REPORT.md#44-draw-call-analyse)

- [ ] **Precision Qualifiers in Shadern** - Mobile Artefakte vermeiden
      Alle Fragment Shader: `precision highp float;`
      → [Teil 5.3](src/app/docs/archive/PERFORMANCE_REPORT.md#53-fehlende-precision-qualifiers)

### ⚪ Priorität 4: Langfristig (Architektur)

- [ ] **BVH für Terrain Raycasts** - 50ms → 0.5ms (100× schneller)
      `three-tiles-engine.ts:721` - Brute-Force ohne BVH, benötigt `three-mesh-bvh`
      → [Teil 14.1](src/app/docs/archive/PERFORMANCE_REPORT.md#141-bvh-acceleration--kritisch-fehlt)
      **Hinweis:** Weniger kritisch als im Report dargestellt:
      - Raycasts passieren hauptsächlich **einmalig** beim Setup (Route-Höhen, Tower-Platzierung)
      - Der Fallback in `enemy.manager.ts:211` greift nur wenn Routen keine Heights haben
      - Es gibt bereits einen Height-Cache (`heightCache` in three-tiles-engine.ts)
      - Verbesserung würde sich vor allem bei initialer Route-Berechnung bemerkbar machen

- [ ] **Web Worker Pathfinding** - 200-600ms → 0ms Main Thread
      A* in Worker auslagern für non-blocking Location Changes
      → [Teil 9.1](src/app/docs/archive/PERFORMANCE_REPORT.md#91-route-calculation--kritisch-100-500ms)

- [ ] **Tower GPU Instancing** - Schwierig wegen Rotationen
      → [Teil 4.4](src/app/docs/archive/PERFORMANCE_REPORT.md#44-draw-call-analyse)

---

## Three.js & Rendering (aus Expert Review)

- [ ] **Model Templates korrekt disposen**
      Datei: `three-tower.renderer.ts:1479` - Geometry/Material nicht disposed

---

## Config-System erweitern

- [ ] **timing.config.ts erstellen** - Animation/Game Timings
      Aktuell: Death-Animation (2000ms), LOS-Recheck (300ms), Spawn-Delays etc.

- [ ] **Range-Upgrade System implementieren**
      Ermoegliche Tower-Upgrades die Range erhoehen
      - LOS-Zellen muessen bei Upgrade neu berechnet werden
      - Visualisierung muss aktualisiert werden (Radius-Anzeige)
      - Grundsystem bauen, konkreter Tower-Einsatz spaeter

---

## Bestehende TODOs

### Bewerten
- [ ] FPS LIMIT auf 60 sinnvoll?
- [ ] Gatling Dual Fire mit exakten Positionen der Barrels abwechselnd links und rechts
- [ ] **Event Debug Panel Position** - Größe wird gespeichert aber Position nicht perfekt (Panel springt beim Öffnen)
      Datei: `debug-window.service.ts`, `draggable-debug-panel.component.ts`
- [ ] **Scrollbar Styling** - Scrollbar im Event Bus Debug Panel passt nicht zum App-Style
      Globale Scrollbar-Styles in `td-theme.ts` oder `styles.scss` anlegen/verwenden
      Betrifft: `event-debugger.component.ts`, ggf. andere Debug-Panels

### Beobachten bis Testcase wieder da
- [ ] Mobs laufen z.T. unterirdisch an bestimmten Stellen (Vermutung: Unterbrechung der Route)
- [ ] **3D-Tiles Loading bei F5** - sporadisch "0 Kacheln geladen" nach Reload
      Fix: Retry-Mechanismus + Force-Update, siehe [TILES_LOADING_BUG.md](src/app/docs/TILES_LOADING_BUG.md)
- [x] **Route Overlay "Routen anzeigen"** - funktioniert nicht mehr richtig, Route wird manchmal nicht angezeigt
      Route Animation (anderes Feature) funktioniert hingegen korrekt
      Dateien: `path-route.service.ts`, `route-animation.service.ts`
- [ ] **Wave Debug Panel Delay** - Änderungen am Delay haben keinen Einfluss auf aktuell spawnende Welle mehr
      Dateien: `wave-debug.service.ts`, `wave.manager.ts`

### Location-System Bekannte Einschraenkungen
- [ ] Nominatim-Geocoding gibt oft Strassen-Koordinaten statt Gebaeude-Koordinaten
      - Workaround: Manuelle Koordinaten-Eingabe nutzen
      - Moegliche Verbesserung: Alternative Geocoding-API (Photon, Google)

### Ideen
- [ ] Coole Locations irgendwie sharebar machen (URL-Parameter deaktiviert wegen Timing-Bugs beim Tile-Loading)
- [ ] **Browser Geolocation API** - Standort per GPS/WLAN ermitteln
      `navigator.geolocation.getCurrentPosition()` - kostenlos, präzise, kein API-Key
      Fallback: IP-basiert via ip-api.com (Stadt-Genauigkeit)
- [ ] Poison Tower
- [ ] Flame Tower

### Stashed Features
- [ ] World Dice - Random Street Generator (git stash: "feat: world dice random location generator")
      Wikidata SPARQL fuer zufaellige Stadt + Overpass API fuer Strasse
      Wuerfel-Button in Header + Location-Dialog
