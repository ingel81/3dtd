# LOS-Pipeline: Sichtlinien der Tower auf dem Route-Grid

**Stand:** 2026-09-15

Wie ein Tower weiß, welche Route-Zellen er sieht: eine Cubemap je Tower-Tip auf
der GPU, drei Leser derselben Cubemap und ein Cache in den Zellen, den der
Kampf nachschlägt. Herausgelöst aus dem Handover vom 2026-05-15
([HANDOVER_ROUTE_GRID_GPU_LOS.md](archive/HANDOVER_ROUTE_GRID_GPU_LOS.md)); dort
bleiben die Sackgassen der drei Anläufe, die Diagnose-Geschichte und das
Muster für eine GPU-Probe. Wie breit der Korridor aus Zellen ist und woher
ihre Höhe kommt: [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md).

## Überblick

Drei Konsumenten teilen sich **einen** `TowerShadowMapper`. Eine Cubemap,
drei Lesarten:

1. **Build-Vorschau:** `TowerLosViz` als Composite, Live-`textureCube` pro
   Frame im Fragment-Shader. Bei jedem Mouse-Move im Build-Modus rendert der
   Mapper für den neuen Tip neu (move-gated).
2. **Auswahl-Anzeige:** dieselbe Klasse `TowerLosViz`, Besitzer ist der
   `TowerManager`. Schließt die Build-Vorschau aus (Lesson 9: eine Anzeige
   zur Zeit).
3. **Kampf-Cache:** `GlobalRouteGrid.registerTower` und
   `registerTowerIncremental` füllen `cell.towerVisibility` und
   `cell.airVisibility`. Aufgelöst wird in `utils/route-grid-los.ts`
   (`resolveTowerLos`, `resolveTowerLosIncremental`) über einen
   CPU-`readRenderTargetPixels`-Pass gegen denselben Cube (`isCubeVisible`,
   `utils/gpu-cube-resolve.ts`). Der Kampf liest danach nur Map-Lookups,
   O(1) je Tower und Gegner.

Das Aggregat-Mesh der Debug-Layer (`grid`, `gridAir`) hat eigenes Mesh und
eigenen Shader, liest aber dieselben Cache-Maps, keine eigene
Sample-Pipeline. Es kann also nicht von dem abweichen, was der Kampf sieht.

**Höhen an einer Stelle:** `getGroundTargetY(cell)` ist
`terrainHeight + groundSampleYOffset` (1,5 m), `getAirTargetY(cell)` ist
`terrainHeight + airSampleYOffset` (15 m), beide in `utils/route-cell.ts`
mit den Werten aus `LOS_VIZ_CONFIG`. Kampf-Probe, Platten der Anzeigen,
Sample-Y im Shader und die Air-Route-Röhre laufen über diese Helfer. Gegner
in der Luft fliegen auf `geoHeight + heightOffset` ihres Typs (15 bis 20 m).

Zellen in einem Tunnel und unter einer fremden Brücke liegen auf der Straße
darunter ([ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md#zellhöhe)), ihre Bodenprobe
1,5 m darüber wie überall. Ein Tower außerhalb sieht dorthin den Hügel, das
Deck oder die bis zum Boden gefüllte Photogrammetrie davor, und die Zelle
gilt als verdeckt. Dafür gibt es keinen Sonderfall im Code.

**LOS-Debug-Panel** (Dev-Menü, Fenster `los`): die Cubemap des aktiven
Towers als 4×3-Kreuz der sechs Flächen, Hover in beide Richtungen
(Cube-Pixel und Route-Zelle), Legende, RGB-Wert mit dekodierter Distanz,
6-fach-Zoom, Umschalter Ground/Air. Funktioniert auch in der
Build-Vorschau. Mit diesem Panel wurde der Skybox-Leak (Lesson 11) gefunden.

## Aufbau

```
                ┌─────────────────────────────┐
                │   TowerShadowMapper         │
                │   (eine Cubemap-Engine)     │
                │   • 512² × 6 faces, RGBA    │
                │   • packDepthToRGBA per face│
                │   • move-gated + invalidate │
                │   • NearestFilter           │
                │   • NoColorSpace            │
                └──────────────┬──────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
   ┌─────────────────┐  ┌─────────────────┐  ┌────────────────────┐
   │ Build-Vorschau  │  │ Auswahl-Anzeige │  │ Kampf-Cache        │
   │ (TowerLosViz)   │  │ (TowerLosViz)   │  │ (registerTower)    │
   │                 │  │                 │  │                    │
   │ Besitzer:       │  │ Besitzer:       │  │ Besitzer:          │
   │ TowerPlacement- │  │ TowerManager    │  │ TowerLosRegistry   │
   │ Service         │  │                 │  │                    │
   │ Live-Sample im  │  │ Live-Sample im  │  │ readRenderTarget-  │
   │ Fragment-Shader │  │ Fragment-Shader │  │ Pixels, einmal je  │
   │ (textureCube)   │  │ (textureCube)   │  │ Registrierung      │
   │ pro Frame       │  │ pro Frame       │  │ → cell.towerVis +  │
   │                 │  │                 │  │   cell.airVis      │
   └─────────────────┘  └─────────────────┘  └────────┬───────────┘
                                                      ▼
                                          ┌────────────────────┐
                                          │ Kampf je Sub-Step  │
                                          │ Map-Lookup O(1),   │
                                          │ hasLineOfSight()   │
                                          │ als Rückfall für   │
                                          │ Gegner ohne Zelle  │
                                          └────────┬───────────┘
                                                   ▼
                                          ┌────────────────────┐
                                          │ Aggregat-Anzeige   │
                                          │ (grid, gridAir)    │
                                          │ eigener Shader,    │
                                          │ liest dieselben    │
                                          │ Maps, 2 Zustände   │
                                          │ je Layer           │
                                          └────────────────────┘
```

Drei Konsumenten, drei eigene Meshes und Shader, eine geteilte
`TowerShadowMapper`-Instanz, ein gemeinsamer Cache. Warum Aggregat und
Tower-Anzeige getrennt bleiben, steht in den Sackgassen des Handovers
(Pipeline-Konsolidierung).

## Farben der Zellplatten

Quelle: `LOS_VIZ_CONFIG.states` in `configs/los-viz.config.ts`. Gilt für
Build-Vorschau, Auswahl-Anzeige, Aggregat und Legende.

| Layer | Plattenhöhe | covered | blocked |
|---|---|---|---|
| Ground | `terrainHeight + cellYOffset`, probt `getGroundTargetY(cell)` | grün `#5CE6A8`, α 0,45 | vermillon `#D55E00`, α 0,30 |
| Air | `getAirTargetY(cell)`, probt dieselbe Höhe | blau `#3AA0FF`, α 0,45 | vermillon `#D55E00`, α 0,30 |

- Jede Platte zeigt nur die eigene Abdeckung. "Ground + Air" hat keine eigene
  Farbe: an derselben Zelle liegt grün unten und blau darüber.
- Welche Layer ein Tower zeigt, sagt `visibleLosLayers(filter,
  canTargetGround, canTargetAir)` in `tower-los-layer-builder.ts`. Reine
  Boden-Tower zeigen nie den Air-Layer, reine Luft-Tower (Rocket) nie den
  Ground-Layer. Der Filter je Tower wirkt nur bei gemischten Towern. Die
  Legende (`los-legend-entries.ts`) nutzt dieselbe Funktion.
- Aggregat (`grid`, `gridAir`): dieselben Layer-Farben mit
  `gridOverlay.coveredAlpha` (0,6), statt blocked das neutrale Grau
  `globalStates.uncovered` (α 0,35, kein Tower in Reichweite).
- Farben sind sRGB-Hex (three speichert sie linear). Beide Zell-Shader enden
  mit `#include <colorspace_fragment>`; ohne das landeten die Werte im
  Render-Pfad ohne Composer roh im Framebuffer, und die Legende passte nicht
  zur 3D-Farbe.
- Farbfehlsichtigkeit: Palette nach Okabe-Ito. Simuliert (Machado 2009,
  CIEDE2000, über Asphalt, dunklem und hellem Grund): Ground gegen Blocked
  ΔE 12 bis 18 bei Deuteranopie (alte Palette 2 bis 10), Air gegen Blocked
  überall über 32. Ground gegen Air ist bei Tritanopie knapp (ΔE 8 bis 10),
  dort trennt die Plattenhöhe.

Bis 2026-09-11 rechneten beide Platten denselben Zustand aus beiden Proben
(gold both, grün, blau, rot); jede Zelle erschien zweimal in gleicher Farbe.
Im Playtest vom 2026-09-10 sahen Boden und Luft deshalb identisch aus.

## Regeln für jeden Eingriff am Cube

Die Kommentare in `TowerShadowMapper` verweisen als "Lesson N" auf diese
Regeln; ihre Nummern stammen aus einer älteren Zählung und stimmen nur
teilweise (`NearestFilter` ist dort Lesson 3, hier Regel 5).

1. **Kein `MeshDistanceMaterial`:** Three.js' eigenes Distance-Material lässt
   sich nicht von außen mit `referencePosition` füttern. Eigenes
   `ShaderMaterial` mit `packDepthToRGBA`.
2. **`USE_INSTANCING` und `USE_BATCHING` im Vertex-Shader:**
   `scene.overrideMaterial` wirkt auch auf `BatchedMesh` und `InstancedMesh`.
   Ohne `batchingMatrix` und `instanceMatrix` fallen alle Geometrien auf den
   Ursprung des Modells, ein Phantom-Blocker direkt am Tower-Tip.
3. **Chunks `<batching_pars_vertex>` und `<batching_vertex>`:** greifen nur
   bei `BatchedMesh`. Die Tiles rendern als normale Meshes, solange kein
   `BatchedTilesPlugin` registriert ist. Unter `#ifdef USE_BATCHING` kosten
   die Chunks nichts und bleiben als Absicherung.
4. **`scene.overrideMaterial` reicht nicht:** `TilesFadePlugin` hängt an
   `mesh.onBeforeRender` und ändert `material.opacity`. Je Cube-Render für
   jedes Mesh in `includeOnly` Material und `onBeforeRender` tauschen und den
   Zustand des Distance-Materials hart setzen (`transparent=false`,
   `opacity=1`, `depthWrite=true`, `depthTest=true`, `needsUpdate=true`).
5. **CubeRenderTarget mit `NearestFilter`:** Bilineare Interpolation auf
   `packDepthToRGBA`-Bytes ergibt ungültige Distanzen.
6. **CubeRenderTarget mit `colorSpace: NoColorSpace`:** Ein sRGB-Umweg
   zerstört die bitgenaue Kodierung der Distanz.
7. **ClearColor des Renderers sichern und zurücksetzen:** Die himmelblaue
   ClearColor des Spiels landet sonst in leeren Cube-Texeln und sieht aus wie
   ein Blocker bei etwa 0,4 m.
8. **`includeOnly: tilesGroup`:** Alle Kinder der Szene außer einem sind
   für den Render unsichtbar. Keine Overlay-, Vorschau- oder Tower-Geometrie
   als Phantom-Blocker.
9. **Build-Vorschau und Auswahl schließen sich aus:** Beide nutzen denselben
   Mapper. Beim Einstieg in den Build-Modus wird abgewählt.
10. **`textureCube(map, worldDir)` ohne X-Flip:** `flipEnvMap` gilt für
    HDR-Cubemaps aus Dateien, nicht für `WebGLCubeRenderTarget`.
11. **`scene.background` und `scene.environment` sichern und auf null
    setzen:** Three.js rendert beide unabhängig vom `child.visible`-Filter
    (Regel 8), und Override- oder Material-Tausch (Regel 4) wirken auf den
    Hintergrund nicht. Eine Skybox-Textur schreibt ihre RGBA-Bytes sonst in
    jede Fläche: `unpackRGBAToDepth` auf eine blau-weiße Wolke ergibt etwa
    0,55, bei `far` 40 m ein Blocker in 22 m. Vor `cubeCamera.update` auf null,
    im `finally` zurück.
12. **CPU-Leser: `py = floor(t * size)`, nicht `size - 1 - floor(t * size)`.**
    `textureCube` auf einem `WebGLCubeRenderTarget` probt direkt mit der
    t-Koordinate des Framebuffers von unten. Einen CPU-Pfad gegen die GPU
    prüfen heißt: mit einem unabhängigen GPU-Test (1×1-Render-Target mit
    Quad-Shader, der `textureCube` aufruft), nicht mit einem zweiten Aufruf
    derselben Funktion. Muster dafür im Anhang des Handovers; für einzelne
    Pixel reicht der Hover im LOS-Debug-Panel.

Für die Schleifen im Kampf gilt außerdem: In `updateTowerShooting`,
`updateMeleeTowers` und `updateChainTowers` (`tower-combat.service.ts`) steht
der Filter nach `attackType` **vor** `tower.combat.update(deltaTime)`.
Sonst zählt jeder Tower seinen Cooldown einmal je Methode herunter (Befund
2026-05-14: Archer mit `fireRate` 1/s schoss etwa 3/s).

## Dateien

| Datei | Aufgabe |
|---|---|
| `three-engine/tower-shadow-mapper.ts` | Cube-Render, Move-Gate, `invalidate()`, Render-Version, `getFaceImageData` fürs Debug-Panel |
| `utils/gpu-cube-resolve.ts` | `LosResolveContext`, `sampleCubeAtPoint`, `isCubeVisible`: der CPU-Pfad für den Kampf-Cache |
| `utils/route-grid-los.ts` | `resolveTowerLos`, `resolveTowerLosIncremental`: Antworten je Zelle in Reichweite, Höhe vorher neu geprobt |
| `utils/global-route-grid.ts` | `GlobalRouteGrid`: Zellen, Gegner je Zelle und Umkreis (Hot Path), `registerTower`/`registerTowerIncremental` über die Box `cellsInRange`, Höhen-Sweep, `addCellsChangedListener` |
| `utils/route-grid-builder.ts` | welche Zellen ein Segment beansprucht (`claimRouteCells`), siehe ROUTE_CORRIDOR.md |
| `utils/route-cell.ts` | `RouteCell`, `CellSample`, `getGroundTargetY`, `getAirTargetY` |
| `utils/route-cell-sampler.ts` | `sampleCellY` (einziger Schreiber von `cell.terrainHeight`), Säulenprobe, LOD-Peek, Sweep-Zähler |
| `utils/tower-los-viz.ts` | Composite für Build-Vorschau und Auswahl-Anzeige, `getLayer()` fürs Debug-Panel |
| `utils/tower-los-layer-builder.ts` | InstancedMesh und Fragment-Shader mit Live-Sample, ein Material je Layer, `visibleLosLayers` |
| `utils/route-grid-aggregate-viz.ts` | Aggregat-Mesh (`grid`, `gridAir`), `MAX_VIZ_CELLS_HARDLIMIT` |
| `utils/route-grid-diagnostics.ts` | `__rg`-Dumps, `RouteCellProbe` für `__corridor.pick()` |
| `utils/route-altitude-tubes.ts` | Debug-Röhre der Air-Route |
| `utils/los-perf.ts` | Phasen-Profiler (aus) |
| `utils/los-debug-pixel-math.ts` | `directionToFacePixel` und Umkehrung, bitgleich zu `gpu-cube-resolve.ts` |
| `services/tower-los-registry.ts` | `TowerLosRegistry`: `buildLosResolveContext`, `register`, `recompute`, `onCellsChanged` und `drainLosRefresh` |
| `services/tower-placement.service.ts` | Einstieg `registerTowerOnGrid`, `recomputeTowerLOS`, `scheduleLosRecompute`; Build-Vorschau in `build-preview-los.ts` |
| `services/combat/tower-combat.service.ts` | `buildLosCheck`: Nachschlagen im Cache, CPU-Rückfall |
| `services/world/global-route-grid.service.ts` | Angular-Hülle um das Grid |
| `services/world/route-grid-convergence.ts` | Höhen-Sweep und Nachproben nach einem Tile-Schub |
| `services/facade/visualization-facade.service.ts` | `onTilesLoaded`, initialisiert den `LosDebugService` |
| `managers/tower.manager.ts` | Besitzer der Auswahl-Anzeige, `refreshSelectionViz`, `applyLosFilter`, `getSelectionViz()` |
| `configs/los-viz.config.ts` | alle Zahlen: Probenhöhen, Farben, Deckkraft |
| `components/los-legend/` | Legende, Einträge aus `los-legend-entries.ts` |
| `components/debug-window/los-debugger.component.ts`, `services/debug/los-debug.service.ts` | LOS-Debug-Panel |

## Abläufe

### Tower bauen (`placeTower` → `registerTowerOnGrid`)

```
1. UI → command:place-tower → GameStateManager.placeTower
2. TowerManager.placeTower legt die Entity an
3. TowerPlacementService.registerTowerOnGrid(tower, position, typeId):
   a. globalRouteGrid.refineCellsInRadius(x, z, range)
      holt ungeprobte Zellen nach und frischt stabile bei besserem LOD auf,
      meldet beide per cells-changed (andere Tower landen in staleLos)
   b. buildLosResolveContext(tipWorld, range):
      mapper.invalidate()                            ← Pflicht
      mapper.update(tipWorld, range, blockerGroup)   ← rendert den Cube
   c. globalRouteGrid.registerTower(towerId, x, z, range, ctx, …)
      → resolveTowerLos über cellsInRange:
         sampleCellY(cell)                      Höhe auffrischen
         canTargetGround: isCubeVisible(tip, getGroundTargetY(cell), …)
                          → cell.towerVisibility
         canTargetAir:    isCubeVisible(tip, getAirTargetY(cell), …)
                          → cell.airVisibility
      danach Aggregat-Positionen auffrischen und die Zellen melden, deren
      Höhe sich bewegt hat (die anderen Tower rechnen später, dieser ist
      schon aktuell)
   d. tower.losReady = true
   e. ist der Tower gewählt: refreshSelectionViz(tower)
```

### Reichweiten-Upgrade (`recomputeTowerLOS`)

Wie beim Bau, aber `registerTowerIncremental` behält die Antworten für
schon registrierte Zellen. Neu geprobt werden der Ring, die wartenden Zellen
aus `staleLos` und Zellen, deren Höhe `sampleCellY` im selben Durchlauf
bewegt hat; die meldet das Grid danach an die anderen Tower weiter.

### Luftziele durch Forschung (`research:completed`)

`TowerLifecycle.scheduleAirRetrofit` stellt die Tower, die erst durch die
Forschung Luftziele bekommen, per `scheduleLosRecompute` in dieselbe
Warteschlange (`staleLos`, als ausdrückliche Anfrage, ohne auf einen Sweep zu
warten). Nicht synchron: der `ResearchStore` setzt das Air-Flag erst im
Handler des `GameStateSyncService`, und der läuft nach dem des
GameStateManagers.

Sonst entwertet nichts die Registrierung eines platzierten Towers: Die
Reichweite ändert sich nur per Upgrade (`recomputeRangeAfterUpgrade` in
`TowerLifecycle`), Position und Höhe sind ab dem Bau fest, `canTargetGround`
ist statisch, die übrigen Forschungseffekte berühren platzierte Tower nicht.
Die Tower-Debug-Slider (`heightOffset`, `shootHeight`) verschieben Modell und
den Tip des CPU-Rückfalls, nicht die gecachte LOS; als Tuning-Werkzeug so
gelassen.

### Tile-Schub (`onTilesLoaded`)

```
1. tilesRenderer-Event → engine.onTilesLoadCallback
2. VisualizationFacadeService.onTilesLoaded:
   a. UI (Straßen, Gebäude, Marker)
   b. globalRouteGrid.beginTerrainHeightRefresh()
      legt den Sweep über alle Zellen an, er läuft erst in e. Jede Scheibe
      probt die Zellhöhen gegen die neuen Tiles und meldet die geänderten
      Zellen: nachgeholt (ungeprobt → geprobt) und aufgefrischt (besseres LOD)
   c. RouteGridConvergence.scheduleBakedHeightRefresh(): während des Sweeps
      nur vorgemerkt; Routenlinien, Marker und Routenanimation werden einmal
      neu gebaut, wenn er durch ist
   d. gameState.onTilesLoaded()
   e. RouteGridConvergence.schedule(): rAF-Schleife, erst
      stepTerrainHeightRefresh(5 ms) je Frame bis der Sweep durch ist, dann
      retryUnsampledCells(), bis 2 Frames ohne Nachholen oder 120 Frames
   f. Spatial-Grid- und Air-Layer-Anzeige
```

Der blockierende `updateTerrainHeights()` (derselbe Sweep ohne Budget) läuft
beim Laden eines Orts (`HeightUpdateService`) und beim Neuaufbau des
Korridors (`CorridorController.rebuildCorridors`).

Der cells-changed-Listener (`TowerLosRegistry.onCellsChanged`) rechnet nicht
sofort. Er merkt sich je Tower die geänderten Zellen (`staleLos`), dazu ein
per rAF entprellter `rebuildAirRouteLayer()`. `drainLosRefresh` wartet, solange
der Sweep läuft, und löst dann jeden betroffenen Tower einmal inkrementell
neu auf, einen je Frame (`LOS_RECOMPUTES_PER_FRAME`). Länger als
`MAX_LOS_WAIT_MS` (3 s Wanduhr) wartet kein Tower. Bis zum Recompute gilt die
alte Antwort; ohne Eintrag nähme jeder Kandidat in diesen Zellen den
CPU-Rückfall. Bricht ein Recompute ab (keine Engine, kein Grid, keine
Blocker-Gruppe), bleibt der Tower in der Warteschlange. Ändert kein Tile das
LOD einer Zelle (der häufige Fall beim Schwenken), meldet der Listener
nichts.

Früher leerte jeder Tile-Load den Cache aller Tower und rechnete jede Zelle in
Reichweite neu (`recomputeAllTowersGroundLOS`, entfernt am 2026-05-16 in
`a7cb2c5`); das hielt den Hauptthread bei jedem Tile-Load Sekunden lang an.

**Feine Tiles entlang der Route:** 3DTilesRendererJS aktiviert nur Tiles im
Kamera-Frustum, und `TilesRenderer.raycast` trifft nur aktive. Die
`RouteCorridorRegion` hält Tiles bis 20 m neben den Routen fein und aktiv,
auch außerhalb des Bildes; die Cube-LOS sieht sie damit ebenfalls. Details
in [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md#feine-tiles-im-korridor). Das LOD
eines Treffers kommt seit 3DTilesRendererJS 0.5.1 aus
`hit.object.userData.tile`.

### Kampf je Sub-Step (`updateTowerShooting`)

```
für jeden Tower:
   attackType passt nicht → weiter          ← vor combat.update, siehe oben
   tower.combat.update(deltaTime)
   !tower.losReady → weiter
   candidates = globalRouteGrid.getEnemiesForTower(tower.visibleCells)
   losCheck = buildLosCheck(tower, …)
      liest cell.towerVisibility / cell.airVisibility (O(1))
      Rückfall: tilesEngine.towers.hasLineOfSight (CPU-Raycast) für
      Gegner ohne Antwort in ihrer Zelle
   target = tower.findTarget(candidates, …, losCheck)
   canFire() und Turret ausgerichtet → combat.fire(), Projektil spawnen
```

## Sonstiges

- `setLineOfSightRaycaster` in `three-tower.renderer.ts` bleibt für den
  CPU-Rückfall `hasLineOfSight`.
- `MAX_VIZ_CELLS_HARDLIMIT` (50.000) in `route-grid-aggregate-viz.ts` ist nur
  eine Obergrenze; die Kapazität des InstancedMesh ist `min(Zellen, Grenze)`.
  Sie wächst nicht zur Laufzeit: Ändert sich das Grid (Ortswechsel,
  Neuaufbau), baut `clear()` die Anzeige ab, beim nächsten Einschalten neu.

## Spätere Ideen

- **Both-Markierung im Aggregat:** Heute sieht man "Ground + Air" nur durch
  Stapeln von `grid` und `gridAir`. Falls gewünscht, als Zusatzmarkierung,
  die die Layer-Farben nicht ersetzt; die Debug-Layer bleiben getrennt.
