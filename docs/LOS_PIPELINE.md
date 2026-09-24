# LOS-Pipeline: Sichtlinien der Tower auf dem Route-Grid

**Stand:** 2026-09-24

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
   O(1) je Tower und Gegner. Das Ergebnis steht zusätzlich als Daten am
   Tower (`LosMask`, siehe unten) und lässt sich ohne GPU wieder anwenden.

Das Aggregat-Mesh der Debug-Layer (`grid`, `gridAir`) hat eigenes Mesh und
eigenen Shader, liest aber dieselben Cache-Maps, keine eigene
Sample-Pipeline. Es kann also nicht von dem abweichen, was der Kampf sieht.

**Höhen an einer Stelle:** `getGroundTargetY(cell)` ist
`terrainHeight + groundSampleYOffset` (1,5 m), `getAirTargetY(cell)` ist
`terrainHeight + airSampleYOffset` (15 m), beide in `utils/route-cell.ts`
mit den Werten aus `LOS_VIZ_CONFIG`. Kampf-Probe, Platten der Anzeigen,
Sample-Y im Shader und die Air-Route-Röhre laufen über diese Helfer. Gegner
in der Luft fliegen auf `geoHeight + heightOffset` ihres Typs (15 bis 20 m).
Für eine Zelle ohne Höhe probt die Kampf-LOS über der Höhe, auf der die Gegner
dort stehen (Median der Nachbarn wie `getGroundLocalYAt`), nicht über dem
Routenanker, den die Zelle hält (`standY` in `resolveTowerLos`).

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
                                          │ keine Antwort =    │
                                          │ nicht sichtbar,    │
                                          │ kein Raycast       │
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
| `utils/route-grid-los.ts` | `resolveTowerLos`, `resolveTowerLosIncremental`: Antworten je Zelle in Reichweite, auf den eingefrorenen Höhen |
| `utils/los-mask.ts` | `LosMask`: die Antworten eines Towers als 2 Bit je Slot, JSON-Form für Log und Snapshot |
| `utils/global-route-grid.ts` | `GlobalRouteGrid`: Zellen, Gegner je Zelle und Umkreis (Hot Path), `forEachSlotInReach` (die Zellen in Reichweite), `registerTower`/`registerTowerIncremental`, `encodeLosMask`/`applyLosMask`, `retryUnsampledCells` |
| `utils/route-grid-builder.ts` | welche Zellen ein Segment beansprucht (`claimRouteCells`), siehe ROUTE_CORRIDOR.md |
| `utils/route-cell.ts` | `RouteCell`, `CellSample`, `getGroundTargetY`, `getAirTargetY` |
| `utils/route-cell-sampler.ts` | `sampleCellY` (einziger Schreiber von `cell.terrainHeight`), Säulenprobe, LOD-Peek, Zähler für übersprungene und gecastete Säulen |
| `utils/tower-los-viz.ts` | Composite für Build-Vorschau und Auswahl-Anzeige, `getLayer()` fürs Debug-Panel |
| `utils/tower-los-layer-builder.ts` | InstancedMesh und Fragment-Shader mit Live-Sample, ein Material je Layer, `visibleLosLayers` |
| `utils/route-grid-aggregate-viz.ts` | Aggregat-Mesh (`grid`, `gridAir`), `MAX_VIZ_CELLS_HARDLIMIT` |
| `utils/route-grid-diagnostics.ts` | `__rg`-Dumps, `RouteCellProbe` für `__corridor.pick()` |
| `utils/route-altitude-tubes.ts` | Debug-Röhre der Air-Route |
| `utils/los-perf.ts` | Phasen-Profiler (aus) |
| `utils/los-debug-pixel-math.ts` | `directionToFacePixel` und Umkehrung, bitgleich zu `gpu-cube-resolve.ts` |
| `services/tower-los-registry.ts` | `TowerLosRegistry`: `buildLosResolveContext`, `register`, `registerFromMask`, `recompute`, `scheduleRecompute` und `drainLosQueue`; Maske am Tower und Event `tower:los-resolved` |
| `services/tower-placement.service.ts` | Einstieg `registerTowerOnGrid`, `registerTowerFromMask`, `recomputeTowerLOS`, `scheduleLosRecompute`, `drainLosQueue`; Build-Vorschau in `build-preview-los.ts` |
| `services/combat/tower-combat.service.ts` | `buildLosCheck`: Nachschlagen im Cache, keine Antwort heißt nicht sichtbar |
| `services/combat/body-aim.ts` | Zielpunkt auf einem Körper entlang der Route (Ooze): erster Punkt, dessen Zelle der Tower sieht |
| `services/world/global-route-grid.service.ts` | Angular-Hülle um das Grid |
| `services/world/corridor-build.ts` | `CorridorBuild`: baut den Korridor einmal je Routensatz und friert Zellen und Höhen ein, siehe [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md) |
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
   a. buildLosResolveContext(tipWorld, range):
      mapper.invalidate()                            ← Pflicht
      mapper.update(tipWorld, range, blockerGroup)   ← rendert den Cube
   b. globalRouteGrid.registerTower(towerId, x, z, range, ctx, …)
      → resolveTowerLos über die Zellen in Reichweite (forEachSlotInReach:
        Fläche schneidet die Reichweite an), auf den Höhen, die der
        Korridor-Bau eingefroren hat (keine Säulenprobe):
         canTargetGround: isCubeVisible(tip, getGroundTargetY(cell, standY), …)
                          → cell.towerVisibility
         canTargetAir:    isCubeVisible(tip, getAirTargetY(cell, standY), …)
                          → cell.airVisibility
      danach Aggregat-Positionen auffrischen
   c. tower.losReady = true
   d. tower.losMask = encodeLosMask(…), Event tower:los-resolved
      { towerId, mask, reason: 'place' }
   e. ist der Tower gewählt: refreshSelectionViz(tower)
```

### Reichweiten-Upgrade (`recomputeTowerLOS`)

Wie beim Bau, aber `registerTowerIncremental` behält die Antworten für
schon registrierte Zellen. Gegen den Cube gehalten werden nur der neue Ring
und Zellen, für die dieser Tower noch keine Antwort hat. Das Ergebnis mischt
Cubes verschiedener Zeitpunkte; neu gerechnet käme nicht dasselbe heraus.
Deshalb gilt die Maske danach (`reason: 'upgrade'`), nicht eine Neurechnung.

### Luftziele durch Forschung (`research:completed`)

`TowerLifecycle.scheduleAirRetrofit` stellt die Tower, die erst durch die
Forschung Luftziele bekommen, per `scheduleLosRecompute` in die
Warteschlange des Registers (`staleLos`). Das Air-Flag liest das Register
aus dem `ResearchManager` (`airTargetingUnlocked`), der es vor dem Event
setzt; die Warteschlange gibt es wegen des Render-Budgets, ein Cube je
Frame.

Abgearbeitet wird die Warteschlange von der Spielschleife:
`GameStateManager.update` ruft nach der Sub-Step-Schleife einmal je Frame
`drainLosQueue`, ein Tower je Aufruf, in der Reihenfolge des Einreihens.
Kein `requestAnimationFrame`: der Heartbeat eines versteckten Tabs tickt
`update` ohne Frames, die Warteschlange läuft dort mit. Bis ein Tower dran
ist, behält er seine Bodenantworten, Luftantworten fehlen ihm noch, und
Luftgegner gelten für ihn so lange als nicht sichtbar. Jeder abgearbeitete
Tower sendet `tower:los-resolved` mit `reason: 'retrofit'`. Für ein exaktes
Nachrechnen muss das Befehlslog den Sub-Step festhalten, an dem das Event
kam; die Maske steckt im Event.

Sonst entwertet nichts die Registrierung eines platzierten Towers: Die
Reichweite ändert sich nur per Upgrade (`recomputeRangeAfterUpgrade` in
`TowerLifecycle`), Position und Höhe sind ab dem Bau fest, `canTargetGround`
ist statisch, die übrigen Forschungseffekte berühren platzierte Tower nicht.
Die Tower-Debug-Slider (`heightOffset`, `shootHeight`) verschieben das
Modell, nicht die gecachte LOS; als Tuning-Werkzeug so gelassen.

### Tile-Schub (`onTilesLoaded`)

```
1. tilesRenderer-Event → engine.onTilesLoadCallback
2. VisualizationFacadeService.onTilesLoaded:
   a. UI (Straßen, Gebäude, Marker)
   b. gameState.onTilesLoaded()
```

Die Overlays der Zellen (Route Grid, Air Route Grid, Flughöhe der Air-Route)
zeichnet, wer die Zellen macht: der Korridor-Bau an seinem Ende, ein
Ortswechsel in seinem Grid-Schritt. Ein Tile-Schub fasst sie seit 2026-09-16
nicht mehr an.

Am Korridor ändert ein Tile-Schub nichts: keine Zellhöhe wird neu geprobt,
keine Routenlinie neu gebacken, kein Tower neu aufgelöst. Zellen und Höhen
stehen, seit der Korridor-Bau sie eingefroren hat
([ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md)); bis zum nächsten Bau (Ortswechsel,
HQ- oder Spawn-Umzug) bleibt die Antwort jedes Towers gültig. Die
Warteschlange des Registers (`staleLos`, `drainLosQueue`, ein Tower je
Frame) bleibt für die Anfrage, die es noch gibt: Luftziele durch Forschung.

Bis zum 2026-09-16 lief hier ein Höhen-Sweep über alle Zellen, danach eine
rAF-Konvergenzschleife mit Nachproben, ein Neubacken von Routenlinie,
Markern und Animation, und eine Warteschlange, die jeden Tower über einer
bewegten Zelle neu auflöste. Auf diesem Weg änderte sich der Korridor unter
stehenden Towern (Playtest 2026-09-15): die Tower hielten Zellen eines
ersetzten Grids und hörten auf zu schießen.

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
   losCheck = buildLosCheck(tower)
      liest cell.towerVisibility / cell.airVisibility (O(1))
      keine Zelle oder keine Antwort des Towers → nicht sichtbar
   target = tower.findTarget(candidates, …, losCheck)
   canFire() und Turret ausgerichtet → combat.fire(), Projektil spawnen
```

Ein Tower ohne sichtbare Zelle hat keine Kandidaten; eine Umkreisabfrage
als Ersatz gibt es nicht mehr. Körper entlang der Route (Ooze) prüft
`BodyAim` ebenso über die Bodenantwort der Zelle unter dem Zielpunkt.

Bis zum 2026-09-24 raycastete der Kampf gegen die gerade geladenen Tiles,
wenn die Zelle keine Antwort hatte: am Rand der Reichweite, für Gegner neben
dem Korridor, im Fenster der Luft-Nachrüstung, für Tower ohne sichtbare
Zelle, und `BodyAim` bis zu viermal je Auflösung. Das Ergebnis hing an
Kamera und LOD und ließ sich nicht nachrechnen (Entscheidung D2 in
[SIMULATOR_PLAN.md](SIMULATOR_PLAN.md)).

## Reichweite in Zellen

Ein Tower hat Antworten für jede Zelle, deren 2-m-Quadrat die Reichweite
anschneidet (`GlobalRouteGrid.forEachSlotInReach`), nicht nur für die mit
Mittelpunkt in der Reichweite. Ein Gegner in Reichweite steht damit immer in
einer Zelle mit Antwort, sofern er auf dem Korridor steht. Der Cube reicht
dafür eine halbe Zelldiagonale weiter (`reachBeyondRangeMeters`,
`losCubeFarDistance`). Die Anzeigen (`getCellsInRange`) nehmen dieselben
Zellen.

## LosMask: Sicht als Daten

`utils/los-mask.ts`. Nach jeder Auflösung (Bau, Reichweiten-Upgrade,
Luft-Nachrüstung) liest `encodeLosMask` die Antworten des Towers zurück in
eine Maske, die am Tower steht (`tower.losMask`) und mit dem Event
`tower:los-resolved { towerId, mask, reason }` hinausgeht.

- **Slots:** die Gitterplätze in Reichweite in fester Reihenfolge (Gitter-x,
  dann Gitter-z, aufsteigend), abgeleitet nur aus Position, Reichweite und
  Zellgröße. Ein Platz ohne Zelle hat auch einen Slot.
- **Bits:** 2 je Slot (Boden sichtbar, Luft sichtbar), 4 Slots je Byte.
  Welche Zellen eine Antwort haben, folgt aus dem eingefrorenen Grid und den
  Flags `ground`/`air` der Maske: jede Zelle in Reichweite hat eine
  Bodenantwort, wenn der Tower Boden zielt, eine Luftantwort, wenn er Luft
  zielt.
- **Größe mit Reichweite und Flags:** 98 B bei 20 m, 202 B bei 30 m, 344 B bei
  40 m, 746 B bei 60 m. Kodieren 15 bis 65 µs, Anwenden 15 bis 70 µs je
  Tower (jsdom, `los-mask.spec.ts`).
- **Anwenden:** `applyLosMask` schreibt die Antworten ohne GPU in die Zellen
  und gibt die sichtbaren Zellen zurück; `TowerLosRegistry.registerFromMask`
  setzt damit `visibleCells`, `losReady` und die Maske wie ein Bau, sendet
  aber kein Event. Für Snapshot-Restore und Neu-Simulation. Passt die Länge
  nicht zu Position und Reichweite, wirft es.
- **Text:** `losMaskToJson`/`losMaskFromJson`, Bits als Base64.

## Sonstiges

- `TerrainQueries.raycastLineOfSight` bleibt für Boss-Intro und
  Korridor-Konsole; die Tower nutzen es nicht mehr.
- `MAX_VIZ_CELLS_HARDLIMIT` (50.000) in `route-grid-aggregate-viz.ts` ist nur
  eine Obergrenze; die Kapazität des InstancedMesh ist `min(Zellen, Grenze)`.
  Sie wächst nicht zur Laufzeit: Ändert sich das Grid (Ortswechsel,
  Neuaufbau), baut `clear()` die Anzeige ab, beim nächsten Einschalten neu.

## Spätere Ideen

- **Both-Markierung im Aggregat:** Heute sieht man "Ground + Air" nur durch
  Stapeln von `grid` und `gridAir`. Falls gewünscht, als Zusatzmarkierung,
  die die Layer-Farben nicht ersetzt; die Debug-Layer bleiben getrennt.
