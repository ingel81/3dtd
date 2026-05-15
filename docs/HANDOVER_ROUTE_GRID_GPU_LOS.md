# Handover: GPU-LOS-Pipeline für das Route-Grid

> **Status (2026-05-15):** Ground-LOS UND Air-LOS produktiv und visuell
> verifiziert. Lesson 11 (scene.background / scene.environment save+restore
> während des Cube-Renders) war die fehlende Zutat — Skybox-Texture leakte
> als false-Blocker in jede Cube-Face. War die eigentliche Ursache der
> 2-Tage-Air-Falschspur, sichtbar gemacht durch das neue LOS-Debug-Panel.
>
> Branch: `feat/route-grid-gpu-los-v3` · letzte Sitzung 2026-05-15.

---

## TL;DR — Wo stehen wir

Drei Konsumenten teilen sich **einen** `TowerShadowMapper`-Singleton.
Eine Cubemap, drei Lesemodi:

1. **Build-Preview** — `TowerLosViz` als Composite. Live-`textureCube`
   pro Frame im Fragment-Shader. Bei jedem Mouse-Move im Build-Mode
   re-rendert der Mapper (move-gated) für den neuen Tip.
2. **Selection-Viz** — gleiche `TowerLosViz`-Klasse, anderer Owner
   (`TowerManager`). Mutex zur Build-Preview (Lesson 9 v2 — eine Viz
   zur Zeit).
3. **Combat-Cache** — `registerTower`/`registerTowerIncremental` in
   `global-route-grid.ts` füllen `cell.towerVisibility` und
   `cell.airVisibility` über einen **CPU-`readRenderTargetPixels`-Pass**
   gegen denselben Cube. Combat-Hot-Path liest dann nur noch
   Map-Lookups (O(1) pro Tower × Enemy × Frame).

Aggregate-Debug-Mesh (`grid` / `gridAir` Toggle) hat **eigene** Mesh +
Shader, liest aber dieselben Cache-Maps — keine separate Sample-
Pipeline. Damit kann es nicht von der Combat-Wahrheit abweichen.

**Höhen sind unified** (Option B, 2026-05-14):
- `getAirTargetY(cell) = cell.terrainHeight + airSampleYOffset` (= 15 m)
- Combat-Sample für Air, Per-Tower-Viz Air-Mesh-Position UND
  Air-Sample-Y im Shader, Air-Plate im Aggregate, Air-Route-Tube —
  alle laufen über diesen einen Helper.
- Enemy-Flughöhe: `geoHeight + heightOffset` mit `heightOffset` per
  Type-Config (15–20 m). Skyline-adaptiver Block in
  `enemy.manager.ts:391-411` wurde entfernt → **Caveat**: Air-Enemies
  können in Hochhaus-Szenen visuell durch Wände fliegen. Bewusste
  Wahl: Single-Source-of-Truth wichtiger als visuelles Vermeiden in
  dichten Skyline-Szenen. **Dies ist KEIN LOS-Bug** — die Cubemap
  weiß ob das Gebäude im Weg ist und blockiert korrekt. Nur die
  Enemy-Position-Wahrnehmung weicht visuell ab.

**LOS-Debug-Panel** (seit 2026-05-15, im dev-menu):
Cubemap des aktiven Towers als 4×3-Face-Cross. Bidirektionales Hover
(Cubemap-Pixel ↔ Route-Cell), Color-Legende, RGB-Readout, 6×-Zoom-
Viewport, Layer-Toggle Ground/Air. War das Tool das den Skybox-Leak
sichtbar machte (Wolken-RGB im Cube nach Hover-Inspektion offensichtlich
keine echte Geometrie). Funktioniert auch im Build-Preview-Mode.

---

## Aktuelle Architektur in Bildform

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
   │ Build-Preview   │  │ Selection-Viz   │  │ Combat-Resolve     │
   │ (TowerLosViz)   │  │ (TowerLosViz)   │  │ (registerTower)    │
   │                 │  │                 │  │                    │
   │ Owner: Tower-   │  │ Owner: Tower-   │  │ Owner: Tower-      │
   │   PlacementSvc  │  │   Manager       │  │   PlacementSvc     │
   │                 │  │                 │  │                    │
   │ Live-Sample im  │  │ Live-Sample im  │  │ readRenderTarget-  │
   │ Fragment-Shader │  │ Fragment-Shader │  │ Pixels (1× pro     │
   │ (textureCube)   │  │ (textureCube)   │  │ Tower-Build)       │
   │ pro Frame.      │  │ pro Frame.      │  │                    │
   │                 │  │                 │  │ → cell.towerVis +  │
   │ 4-State /       │  │ 4-State /       │  │   cell.airVis Maps │
   │ Filter-gated    │  │ Filter-gated    │  └────────┬───────────┘
   └─────────────────┘  └─────────────────┘           │
                                                      ▼
                                          ┌────────────────────┐
                                          │ Combat-Hot-Path    │
                                          │ Map-Lookup O(1)    │
                                          │ pro Frame, plus    │
                                          │ hasLineOfSight()   │
                                          │ Fallback für       │
                                          │ Enemies zwischen   │
                                          │ Cells.             │
                                          └────────┬───────────┘
                                                   │
                                                   ▼
                                          ┌────────────────────┐
                                          │ Aggregate-Viz      │
                                          │ (grid + gridAir    │
                                          │  Debug-Toggles)    │
                                          │ Eigener Shader,    │
                                          │ liest dieselben    │
                                          │ Maps. Strikt       │
                                          │ 2-state pro Layer  │
                                          │ (kein Gold).       │
                                          └────────────────────┘
```

**Drei Konsumenten der Cube, drei eigene Meshes/Shader, eine geteilte
`TowerShadowMapper`-Instanz, ein gemeinsamer Cache.** Das ist die
finale Form.

---

## Die elf Lessons die für jeden Cube-Touch gelten

Stehen alle im Code als Kommentare in `TowerShadowMapper`, hier
nochmal zentralisiert als Checkliste:

1. **MeshDistanceMaterial nicht verwenden** — Three.js' eigenes
   Distance-Material lässt sich nicht von außen mit `referencePosition`
   füttern. Eigenes ShaderMaterial mit `packDepthToRGBA`.
2. **USE_INSTANCING + USE_BATCHING im Vertex-Shader** — `scene.override
   Material` wird auf BatchedMesh + InstancedMesh angewendet. Ohne
   `batchingMatrix` / `instanceMatrix` kollabieren alle Geometrien zum
   Model-Origin → Phantom-Blocker direkt am Tower-Tip.
3. **`<batching_pars_vertex>` + `<batching_vertex>` Chunks** — 3D-Tiles
   nutzen BatchedMesh, nicht reguläre Meshes.
4. **`scene.overrideMaterial` reicht nicht** — `TilesFadePlugin` hookt
   `mesh.onBeforeRender` und mutiert `material.opacity`. Pro Cube-Render
   für jedes Mesh in `includeOnly`: Material + onBeforeRender swappen,
   Distance-Material-State hart resetten (transparent=false, opacity=1,
   depthWrite=true, depthTest=true, needsUpdate=true).
5. **CubeRenderTarget: `NearestFilter`** — Bilinear-Interpolation auf
   `packDepthToRGBA`-Bytes ergibt mathematisch ungültige Distanzen
   (4-fach interpolierte Bit-Patterns).
6. **CubeRenderTarget: `colorSpace: NoColorSpace`** — sRGB-Roundtrip
   korrumpiert die bit-genaue Distance-Encoding.
7. **Renderer-ClearColor save/restore** — Game nutzt sky-blue Clear-
   Color, der leakt sonst in "leere" Cube-Texel und sieht aus wie ein
   Blocker bei ~0.4 m.
8. **`includeOnly: tilesGroup` Pattern** — alle Scene-Children außer
   einem werden für den Render unsichtbar. Keine Overlay/Preview/Tower-
   Geometrie als Phantom-Blocker.
9. **Build-Preview ↔ Selection-Mutex** — beide nutzen denselben
   Mapper. Bei Build-Mode-Entry wird Selection deselektiert.
10. **`textureCube(map, worldDir)` ohne X-Flip** — `flipEnvMap` ist
    für HDR-Cubemaps aus Dateien, NICHT für `WebGLCubeRenderTarget`.
11. **`scene.background` UND `scene.environment` save/restore** —
    Three.js rendert beide unabhängig vom `child.visible`-Filter
    (Lesson 8) und der overrideMaterial / per-Mesh-Material-Swap
    (Lesson 4) wird auf den Background NICHT angewendet. Eine
    Equirectangular-Skybox-Texture wandert ihre RGBA-Bytes also direkt
    in jedes Cube-Face — `unpackRGBAToDepth` auf eine blau-weiße
    Wolke (z.B. RGB=(140,180,200)) ergibt depth ≈ 0.55, was bei
    far=40m als 22m-"Wolken-Blocker" erscheint. Cells deren Direction
    in eine Sky-Region projiziert werden permanent als blocked
    markiert. Save+null vor `cubeCamera.update`, restore im finally.

Zusätzlich für **CPU-readPixels-Konsumenten**:

12. **`py = floor(t * size)` — NICHT `size - 1 - floor(t * size)`.**
    Three.js' `textureCube` auf einem `WebGLCubeRenderTarget` sampelt
    direkt mit framebuffer-bottom-up t-Koordinate. Der y-Flip aus der
    v2-Probe war FALSCH — siehe H5-Sektion. Wenn ein CPU-Path gegen
    den GPU-Sample geprüft wird: **muss ein unabhängiger GPU-Sample-
    Test sein** (z.B. 1×1-RT mit Quad-Shader der `textureCube` macht),
    nicht ein zweiter Call der selben Funktion gegen sich selbst
    (tautologisch). Heute deutlich einfacher per Hover im LOS-Debug-
    Panel: man sieht direkt ob der Cube-Pixel "stimmt".

---

## Files (Stand 2026-05-15)

| Datei | Verantwortung |
|---|---|
| `src/app/three-engine/tower-shadow-mapper.ts` | Cube-Render-Engine, Move-Gate, invalidate(), Render-Version, `getFaceImageData` (Debug-Panel), API: update/getRenderTarget/getReferencePos/getFarDistance/getRenderer/getRenderVersion |
| `src/app/utils/gpu-cube-resolve.ts` | `LosResolveContext`, `sampleCubeAtPoint`, `isCubeVisible` — CPU-readPixels-Pfad für Combat-Cache-Fill |
| `src/app/utils/tower-los-viz.ts` | Composite-Wrapper für Build-Preview und Selection-Viz, `getLayer()` für Debug-Panel-Picking |
| `src/app/utils/tower-los-layer-builder.ts` | InstancedMesh + Fragment-Shader für Live-Sample, 4-state + Filter-Mode, `cells`-Array für instanceId→Cell |
| `src/app/utils/global-route-grid.ts` | `RouteCell`-Daten + `registerTower`/`Incremental` mit GPU-Cube-Resolve + `getAirTargetY` Helper + Aggregate-Mesh + `clearGroundVisibilityForTower` |
| `src/app/services/tower-placement.service.ts` | `buildLosResolveContext` (private), `registerTowerOnGrid`, `recomputeTowerLOS`, `recomputeAllTowersGroundLOS` |
| `src/app/services/world/global-route-grid.service.ts` | Angular-Wrapper-Service |
| `src/app/services/facade/visualization-facade.service.ts` | `onTilesLoaded` ruft `recomputeAllTowersGroundLOS`, initialisiert `LosDebugService` |
| `src/app/managers/tower.manager.ts` | Selection-Viz-Owner, `refreshSelectionViz`, `applyLosFilter`, `getSelectionViz()` |
| `src/app/managers/enemy.manager.ts` | Air-Enemy-Flughöhe — Skyline-Block entfernt 2026-05-14 |
| `src/app/configs/los-viz.config.ts` | Single-Source-of-Truth-Magic-Numbers |
| `src/app/components/los-legend/los-legend.component.ts` | Filter-gated Legende |
| `src/app/utils/route-altitude-tubes.ts` | Air-Route-Debug-Tube |
| `src/app/utils/los-perf.ts` | Phase-Profiler (default off) |
| **Debug-Panel (2026-05-15)** | |
| `src/app/components/debug-window/los-debugger.component.ts` | Panel-UI: 4×3 Face-Cross, Hover-Marker, Zoom-Viewport, Layer-Toggle, Pixel-Readout. Im dev-menu unter `'los'` window-id. |
| `src/app/services/debug/los-debug.service.ts` | State (active tower, hovered cell/pixel, active layer), Cell-Pixel-Map, 3D-Hover-Marker, Reverse-Hover-Raycaster gegen Selection-Viz |
| `src/app/utils/los-debug-pixel-math.ts` | `directionToFacePixel` + Inverse, Cross-Layout-Konfig — bit-konsistent zu `gpu-cube-resolve.ts` |

---

## Was passiert wann (Daten-Flüsse)

### Tower-Build (`placeTower` → `registerTowerOnGrid`)

```
1. UI → command:place-tower → GameStateManager.placeTower
2. TowerManager.placeTower legt Entity an
3. TowerPlacementService.registerTowerOnGrid(tower, position, typeId):
   a. globalRouteGrid.refineCellsInRadius(x, z, range)
      — promote unsampled cells in Range zu heightSampled
   b. buildLosResolveContext(tipWorld, range):
      mapper.invalidate()                            ← PFLICHT
      mapper.update(tipWorld, range, blockerGroup)   ← rendert Cube
      → ctx = { cube, referencePos, farDistance, renderer, … }
   c. globalRouteGrid.registerTower(towerId, x, z, range, ctx, …):
      for each Cell in Range:
         sampleCellY(cell)             — Terrain refreshen
         if canTargetGround:
            isCubeVisible(tip, cell.terrainHeight + 1.5, …)
            cell.towerVisibility.set(towerId, …)
         if canTargetAir:
            isCubeVisible(tip, getAirTargetY(cell), …)
            cell.airVisibility.set(towerId, …)
      refreshAggregateVizPositions()    — Air-Plate-Y mit-syncen
   d. tower.losReady = true
   e. if (tower.selected) refreshSelectionViz(tower)
```

### Range-Upgrade (`recomputeTowerLOS`)

Identisch zu Tower-Build, aber `registerTowerIncremental` nutzt die
gecachten Visibility-Werte für Cells die schon registriert sind. Nur
der Annulus wird via Cube neu gesampled.

### Tile-Streaming (`onTilesLoaded`)

```
1. tilesRenderer event → engine.onTilesLoadCallback
2. visualization-facade:onTilesLoaded:
   a. UI updates (streets, buildings, markers, routes)
   b. gameState.onTilesLoaded()
   c. globalRouteGrid.retryUnsampledCells()
      — promote noch-unsampled Cells via Listener-Pfad
      (ruft recomputeTowerLOS per affected Tower über
       setCellsPromotedListener)
   d. towerPlacementService.recomputeAllTowersGroundLOS()
      — NEU: für JEDEN Tower clearGroundVisibility + recomputeTowerLOS,
      damit auch sampled→sampled-mit-höherem-LOD abgedeckt ist
   e. spatialGrid- + Air-Layer-Viz initialisieren
```

Performance-Bemerkung: `recomputeAllTowersGroundLOS` macht
1 Cube-Render + ~500 readPixels pro Tower. Bei 10 Tower also
~50–100 ms Spike pro Tile-Load. Tile-Loads sind selten (wenige
pro Minute unter aggressivem Panning), Spike ist akzeptiert.

### Combat-Frame (`updateTowerShooting`)

```
1. tower-combat.service.ts:updateTowerShooting(deltaTime, …):
   for each Tower:
      if attackType !== 'projectile' continue   ← PFLICHT VOR update
      tower.combat.update(deltaTime)
      if !tower.losReady continue
      candidates = globalRouteGrid.getEnemiesForTower(tower.visibleCells)
      losCheck = buildLosCheck(tower, hasVisibleCells)
         — reads cell.towerVisibility / cell.airVisibility (O(1))
         — Fallback: tilesEngine.towers.hasLineOfSight (CPU-Raycast,
           nur für Enemies zwischen Cells)
      target = tower.findTarget(candidates, …, losCheck)
      if combat.canFire() && turret aligned:
         combat.fire()
         projectileManager.spawn(tower, target, heading)
```

**Lesson 12 (2026-05-14 entdeckt + gefixt):** der `attackType`-Filter
MUSS **vor** dem `combat.update(deltaTime)`-Call stehen — sonst tickt
jeder Tower-Cooldown N× pro Sub-Step (N = Anzahl der `update*Towers`-
Methoden). Konkret: `updateTowerShooting`, `updateMeleeTowers` und
`updateChainTowers` iterieren alle über `getAllActive()` und riefen
früher `combat.update` für ALLE Tower auf, bevor sie skip'ten. Effekt:
Archer mit `fireRate: 1/s` feuerte ~3/s. Fix: in allen drei Methoden
den `attackType`-Check vor `combat.update`.

---

## Die kuratierte Sackgassen-Galerie

> **Diese Lessons stammen aus drei missgelaufenen Anläufen (v1, v2,
> verworfene Session 2026-05-13).** Sie sind hier nur soweit gekürzt
> wie nötig — wer den Branch in ein Jahr nochmal aufmacht, soll
> sehen warum bestimmte Sachen NICHT versucht werden sollten.

### ⚠️ SACKGASSE: drei parallele Viz-Pfade (v1)

Erstes Anlaufversuch hatte Build-Preview, Selection und Debug-
Aggregate als **drei separate Code-Pfade**, jeweils mit eigener Cube-
oder CPU-LOS-Logik. Resultat: jedes neue Feature musste dreimal gebaut
werden, jedes Debug-Tool zeigte für drei verschiedene Daten-Quellen
drei verschiedene Ergebnisse. **Branch versandet im Chaos.** Aktuelle
Architektur konsolidiert auf eine geteilte Mapper-Engine + getrennte
semantische Konsumenten — bewusst KEINE Mesh- oder Shader-Konsolidierung
(siehe Session-2026-05-13-Sackgasse).

### ⚠️ SACKGASSE: skyline-adaptive Air-Höhe

v1 und v2 hatten Air-Sample-Y auf `cell.skylineHeight + AIR_CLEARANCE_M
(10 m)`. Begründung damals: Air-Enemies fliegen "über dem Hochhaus".
**Probleme:**

- Visuell überraschend (Hochhaus blockiert Air-Tower über Straße davor)
- Cells unter sehr hohen Buildings hatten unsinnig hohe Air-Sample-
  Punkte mit kleiner Trefferchance
- `skylineHeight` musste per-Cell mit teurer Multi-Raycast-Samplung
  bestimmt werden (Skyline-Cache, mehrfach refactored)

2026-05-13 ersetzt durch fixe Höhe `terrain + 15 m` (Option B
aus dem drei-Optionen-Vergleich A/B/C — Skyline-adaptiv / fest /
Max-of-both). Trade-off: in echten Manhattan-Szenen fliegen Air-
Enemies durch Wände. Bewusst akzeptiert.

`AIR_CLEARANCE_M` Konstante existiert noch in `global-route-grid.ts`
für historischen Combat-Fallback, ist aber inaktiv. **Nicht wieder
einbauen** ohne expliziten Plan.

### ⚠️ SACKGASSE: Skyline-Cache als eigene Datenstruktur

Es gab in v2 ein Refactoring-Commit der `cell.skylineHeight` durch
einen separaten `skylineCache` ersetzte. **Ist abgelöst.** Mit der
fixen Air-Höhe (Option B) braucht es keine Skyline-Daten mehr. Falls
in einem späteren Versuch wieder skyline-adaptiv: alte Implementation
wäre ein guter Startpunkt, aber sehr wahrscheinlich besser komplett
neu konzipiert (Cube-basiert statt CPU-Raycast).

### ⚠️ SACKGASSE: Pipeline-Konsolidierung (verworfene Session 2026-05-13)

Eine ganze Session wurde investiert um:
- **Aggregate-Mesh und Per-Tower-Selection-Mesh** auf eine geteilte
  `RouteCellViz`-Klasse zu konsolidieren (mit `mode`-Uniform 0=aggregate
  / 1=perTower)
- **Build-Preview als `__preview__`-Tower** zu modellieren
  (`registerTowerIncremental('__preview__', …)` füllt den Cache,
  RouteCellViz im perTower-Mode liest aus Cache statt textureCube)

**Beides wurde via `git reset --hard pre-gpu-migration` zurückgerollt.**
Gründe:

1. **State-Code-Semantik ist NICHT mergeable.** Per-Tower-`state 0` =
   "in Range aber blockiert" (rot, alpha 0.25). Aggregate-`state 0` =
   "kein Tower in Range" (grau, alpha 0.15). Eine unified Konstante
   kann nicht beides korrekt rendern.
2. **Aggregate hat zusätzliche Enemy-Overlay-States** (state 4
   enemyHidden, state 5 enemyVisible) die im Per-Tower-Mode nicht
   existieren. Mode-Switch im Shader rettet das nicht — die
   Compute-Logik unterscheidet sich strukturell.
3. **Mode-Mutex bricht den User-Workflow** "Aggregate + Selection
   gleichzeitig sehen". Beide konkurrieren um denselben State-Buffer
   → Selection übersteuert Aggregate-Anzeige.
4. **Build-Preview als `__preview__`-Tower ist Performance-tödlich.**
   `registerTowerIncremental` ruft pro Cell `sampleCellSkyline` (5
   Raycasts pro Cell) + `sampleCellY` + GPU-Cube-Resolve. Bei 500
   Cells × Move-Gate-Übertretung = mehrere Tausend Raycasts pro
   Mouse-Move. Build-Preview wurde unspielbar.

**Lessons:**

- **Aggregate und Per-Tower-Viz MÜSSEN getrennte Meshes + Shader
  bleiben.** Code-Duplikation ist akzeptabel weil die Semantik
  unterschiedlich ist.
- **Build-Preview MUSS Live-Cube-Sample im Shader nutzen.** Cache-
  Fill ist nur für one-shot-Build-Operationen gerechtfertigt, nicht
  per-Mouse-Move.
- **TowerLosViz / TowerLosLayerBuilder NIEMALS löschen** — sie sind
  die Live-Viz-Pipeline und brauchen keinen Migrations-Touch.

### ⚠️ SACKGASSE: y-Flip in der Direction-zu-Pixel-Math (H5)

v2-Probe-Code hatte:

```ts
const py = size - 1 - Math.floor(t * size);
```

Aus der Annahme dass Cube-Faces image-Konvention (top-left=0,0)
brauchen und Framebuffer-readPixels bottom-up liefert. Eine
"Verify"-Methode in v2 lieferte angeblich `match=428, mismatch=0`
gegen den Live-Shader — daraus wurde geschlossen die Formel sei
korrekt.

**FALSCH.** Der Verify-Test verglich zwei Aufrufe **derselben
Funktion** (Cache-Fill mit dem buggy Flip vs. Live-Cache-Read mit
demselben Flip). Tautologisch korrekt, sagt nichts über
GPU-`textureCube` aus.

Echter Direct-GPU-vs-CPU-Test (1×1-RT mit `textureCube`-Quad-Shader,
`losDiagProbeGpuVsCpu` in der 2026-05-14-Sitzung) zeigte:

```
cpuGroundVisible:  98
gpuGroundVisible: 335
gpuMoreVisible:   244   ← CPU "blocked", GPU "visible"
cpuMoreVisible:     7
```

Bytes-Patterns waren komplett unterschiedlich (z.B. CPU
`[178,162,126,255]` = 42 m Blocker, GPU `[255,255,255,255]` = 60 m
keine Blocker — beide für **dieselbe** Direction). Lesen
verschiedener Texel.

**Fix in `gpu-cube-resolve.ts`:**

```ts
// FALSCH:
const py = Math.min(size - 1, Math.max(0, size - 1 - Math.floor(t * size)));

// KORREKT:
const py = Math.min(size - 1, Math.max(0, Math.floor(t * size)));
```

Three.js' CubeCamera rendert die 6 Faces so dass `textureCube` direkt
mit framebuffer-Y-Konvention sampeln kann. Kein zusätzlicher CPU-Flip.

**Lesson — extrem wichtig für künftige Diagnose-Sessions:**
Verify-Tests müssen den Pfad gegen einen *unabhängigen* Pfad benchen,
nicht gegen einen zweiten Aufruf desselben Pfads. Das `1×1-RT-Quad-
Shader-Pattern` aus `losDiagProbeGpuVsCpu` (in der 2026-05-14-Diagnose
gebaut, danach mit dem Rest der Diagnostik entfernt) ist das saubere
Tool — wenn du es nochmal brauchst: Code aus dem Git-Log
zurückholen (Diagnose-Reste sind in einem ge-`reset`-ten oder
git-stash-bar separaten Commit), oder via `tower-shadow-mapper.ts`
neu aufsetzen — wenige Dutzend Zeilen.

### ⚠️ SACKGASSE: Bias-Asymmetrie (war nie produktionsrelevant, aber dokumentationswürdig)

Verworfene Session: zwischen CPU-`raycaster.far = dist - 0.5` (stoppt
0.5 m **vor** Ziel) und GPU-`cellDist < blockerDist - 0.5` (Blocker
muss 0.5 m **hinter** Cell sein) gab es 1 m breites Toleranz-Band
an Wand-Kanten. Beim Migrations-Versuch wurden 60–80% Mismatch im
Parallel-Verify gemessen — die hießen aber zum Großteil "CPU lenient,
GPU strict". User-Entscheidung: strict (Combat schießt nicht halb
durch Wand). Bias bleibt strict, war keine Bug-Quelle.

### ⚠️ SACKGASSE: Real-Blocker-Dot ohne Per-State-Gating

v3 hatte ursprünglich einen schwarzen Punkt im Cell-Zentrum wenn ein
realer Blocker (`depth < 0.99`) die Sichtbarkeit killte. Mit dem
ungelösten Air-Bug feuerte der Dot überall (jeder Air-Sample sah
sich selbst als Blocker). Entfernt 2026-05-13. **Falls Re-Aktivierung:
Per-State-Gating Pflicht** — Dot nur für `groundOnly` / `neither`,
nicht für Air-States bis Air bewiesen sauber ist.

### ⚠️ SACKGASSE: `scene.background` als unsichtbarer Render-Pfad (Lesson 11, der eigentliche Air-Bug)

**Diese Sackgasse hat uns 2 Tage gekostet und alle Air-Lessons davor
falsch interpretieren lassen.**

Wir hatten Lesson 4 (Material-Swap pro Mesh), Lesson 7 (ClearColor
save/restore) und Lesson 8 (`includeOnly`) — alle drei dazu da
Phantom-Blocker aus dem Cube herauszuhalten. Trotzdem zeigte das
+Y-Face dauerhaft "Wolken"-Muster, die Air-Cells unter diesen
Wolken-Pixeln wurden als blocked markiert.

**Was wir vermuteten (alles falsch):**
- Air-Sample-Y zu niedrig in Skyline-Szenen → Sample in Hochhaus-
  Stockwerk → permanent blockiert. **Hypothese hat nicht gepasst:
  Test in flacher Szene (keine Hochhäuser) zeigte dieselben
  "Wolken"-Artefakte.**
- Cube-Near=0.1m erfasst eigenes Tower-Dach. **Hypothese hat nicht
  gepasst: Pattern war in jeder Tower-Position, auch ohne hohes
  Tower-Mesh.**
- Direction-zu-Pixel-Konvention bei Y-dominanten Directions
  (POS_Y/NEG_Y-Face brauchen evtl. Konventionsabweichung). **Hypothese
  hat nicht gepasst: die Direction-Math war korrekt, sie traf nur den
  falschen Pixel-Inhalt.**

**Was es tatsächlich war:**
`scene.background` ist auf eine Equirectangular-Skybox-Texture gesetzt
(`day.webp`). Three.js' `WebGLRenderer` rendert diesen Background bei
JEDEM Render-Call, **unabhängig** vom `child.visible`-Filter und
**unabhängig** vom per-Mesh-Material-Swap. Die Background-Pixel werden
ungeprüft in jedes Cube-Face geschrieben. `unpackRGBAToDepth` auf eine
blau-weiße Wolken-RGB-Tupel (z.B. 140/180/200) liefert depth ≈ 0.55,
was bei far=40m als Blocker bei 22m auftritt. Cells deren Direction in
eine Sky-Region projiziert wurde, wurden permanent als blocked geflagt.

**Fix:**

```ts
const prevBackground = this.scene.background;
const prevEnvironment = this.scene.environment;
this.scene.background = null;
this.scene.environment = null;
try {
  this.cubeCamera.update(this.renderer, this.scene);
} finally {
  this.scene.background = prevBackground;
  this.scene.environment = prevEnvironment;
}
```

Drei Zeilen. Lesson 11.

**Was zum Fund geführt hat:**
Das neue LOS-Debug-Panel (2026-05-15). Beim Hover über einen "Wolken"-
Pixel im +Y-Face zeigte das Panel saubere RGB-Werte mit decodierter
Distance — und der User erkannte sofort dass das Skybox-Pattern war,
nicht echte Geometrie. Ohne das Visualisierungs-Tool hätten wir mit
hoher Wahrscheinlichkeit noch eine weitere Session über Skyline-
Adaptive-Sample-Y, Cube-Near-Adjustments oder neue Y-Flip-Konventionen
verbracht. **Das Tool selbst ist hier der MVP.**

**Lessons:**
- Wenn nach Lesson 4+7+8 immer noch Phantom-Blocker erscheinen, ist
  `scene.background` und/oder `scene.environment` der nächste
  Verdächtige.
- Diagnose-Visualisierung **früh** bauen, nicht erst nach Tagen
  Hypothesen-Debugging. Die "30 Zeilen GPU-Probe"-Variante aus dem
  H5-Fund war zwar punktuell brauchbar, ein dauerhaftes Panel mit
  Cubemap-Visualisierung schlägt sie aber bei jedem nicht-H5-Bug.

---

### ⚠️ SACKGASSE: ScreenShake / Holo-Shader / Volumen-3D (Optik)

v1-Plan hatte schöne Optik geplant (Activation-Wave, Holo-Effekte,
Volumen-3D-Plates). User hat das in v3 zurückgestellt mit "subtil
bleiben". Aktuelle Plates sind flache 2-cm-Boxen, sanfter Pulse,
~0.45 Alpha. Wer Optik aufpolieren will: aus v1-Branch (`feat/route-
grid-gpu-los`) portierbar, aber nicht ohne expliziten User-Anstoß.

---

## Stand der Air-Pipeline (verifiziert 2026-05-15)

Air-LOS funktioniert wie Ground-LOS. Beweis war eine direkte Inspektion
im Debug-Panel: zwei Nachbar-Cells an derselben Air-Höhe, eine als
`visible` (Blocker 19.3m, Cell-Distanz 17m), eine als `blocked` (Blocker
12.9m, Cell-Distanz 18.7m). Die Sample-Direction der blockierten Cell
projizierte auf eine Wolken-Region des Skybox-Hintergrundbilds — kein
echter Blocker. Lesson 11 entfernt diese false-Blocker; danach Air-Cells
in clear airspace alle visible, Cells hinter echten Bäumen/Gebäuden
weiterhin blocked. Aggregate-`gridAir`-Toggle und Per-Tower-Filter='air'
zeigen ab Fix identische Cell-Sets.

### Was strukturell passt (unverändert seit 2026-05-14)

- Single-Source-of-Truth-Helper `getAirTargetY(cell)` ist überall im
  Spiel — Combat, Per-Tower-Viz Air-Mesh-Position, Per-Tower-Viz
  Sample-Y im Shader (per-instance `aAirSampleY`), Aggregate-Air-Plate-
  Position, Air-Route-Tube.
- Combat-Cache und Live-Shader sampeln nach H5-Fix bit-konsistent.
- Air-Enemy-Flughöhe ist auf `geoHeight + heightOffset` (heightOffset
  per Type-Config 15–20m) — passt zum Sample-Y bei flachen Cells.

### Verbleibende Caveats (kein LOS-Bug, sind bewusste Trade-offs)

- **Enemy-vs-Tower-Höhen-Drift im Hochhausviertel.** Sample-Y =
  `terrain + 15`. Enemy-Y = `geoHeight + heightOffset`. In flachen
  Cells decken sich beide auf ±5m. Wenn Pfade-Wegpunkte aber durch
  enge Cells gehen mit hohen Buildings drumherum, kann der Tower
  geometrisch durch ein Gebäude schießen während der Enemy auf einer
  anderen y-Position fliegt. **LOS ist korrekt** (Cubemap kennt das
  Gebäude), die Diskrepanz liegt nur in der visuellen Enemy-Position.
  Bewusster Trade-off zugunsten Single-Source-of-Truth — siehe TL;DR.

### Pre-Production (offen, jetzt unblocked durch Air-Verify)

- **`airRangeMultiplier` in `TowerConfig`** — aktuell ist `airRange =
  groundRange` als Platzhalter. Pure-Air-Tower (Rocket) sollen 1.5×,
  Mixed-Tower (Dual-Gatling AA-Retrofit) 1.2×. Stellen sind markiert
  in `tower.manager.ts:331` und in `tower-placement.service.ts`.
- **Real-Blocker-Dot mit Per-State-Gating** — kann zurückkommen jetzt
  wo Air sauber läuft (keine false-Blocker mehr, also keine Dot-Flut).
  Siehe Sackgassen-Galerie zu Per-State-Gating.

---

## Weitere Pre-Production-TODOs (kein LOS-Blocker mehr)

- "Combined View" überlegen: Per-Tower-Viz mit Filter='both' und
  Aggregate-Gold-State auf 3. Shader-Variante (Gold im Aggregat).
  Aktuell strikt 2-state pro Layer — User kann gold-Cells im
  Aggregate nicht erkennen, muss visuell stapeln (`grid` + `gridAir`).

---

## Stand der Tests + nicht-LOS-Erkenntnisse aus dieser Session

### Schussraten-Bug gefixt (Bonus aus dieser Session)

Beim Smoke-Test nach der LOS-Migration fiel auf dass Archer mit
`fireRate: 1/s` ungefähr 3/s schoss. Bug-Quelle in
`tower-combat.service.ts`: drei `update*Towers`-Methoden
(`updateTowerShooting`, `updateMeleeTowers`, `updateChainTowers`)
iterierten alle über `getAllActive()` und riefen `tower.combat.update
(deltaTime)` **vor** dem `attackType`-Filter auf. Jeder Tower bekam
seinen Cooldown also 3× pro Sub-Step runtergezählt → effektive
Schussrate war 3× zu hoch.

Fix: `attackType`-Filter VOR `combat.update` in allen drei Methoden.
Beam-Pfad ist nicht betroffen (continuous damage, kein
`combat.update`-Call).

Dieser Bug war alt — vermutlich aus einem früheren Branch mitgenommen.
LOS-Migration hat ihn nur sichtbarer gemacht weil im Smoke-Test
gegen die Tower-Card-Anzeige verglichen wurde.

### Diagnose-Infrastructure (heute: LOS-Debug-Panel)

Während der Air- und H5-Hunt-Session 2026-05-14 wurden ad-hoc-Tools
eingebaut und nach Verifikation wieder entfernt:

- `[LOS-DIAG] cube-render`-Logs mit `callerLabel`
- `losDiagProbeTower(towerId)` — Cache-vs-CPU-readPixels-Check
  (tautologisch, weil Cache MIT CPU-readPixels gefüllt wird)
- `losDiagDumpAggregate()` — Cache vs. State-Buffer
- `losDiagProbeGpuVsCpu(towerId)` — der **eigentliche** H5-Test:
  1×1-RT mit Quad-Shader `textureCube(map, dir)` vs.
  `sampleCubeAtPoint` für identische Direction-Vektoren
- `losDiagDumpSelectionState()` — Filter-Bridge-Check

**Seit 2026-05-15 obsolet** — das permanente LOS-Debug-Panel liefert
alles davon visuell:

- **6-Face-Cubemap-View** ersetzt das Mental-Modell-Raten "was sieht der
  Cube eigentlich" — der Skybox-Leak war im Panel auf einen Blick als
  Wolken-Muster erkennbar.
- **Pixel-Hover mit RGB-Readout + decoded Distance + Zoom-Viewport**
  ersetzt `losDiagDumpAggregate` für ad-hoc Cell-Inspektion.
- **Bidirektionales Hovering** (Pixel → Cell, Cell → Pixel) ersetzt das
  Reverse-Lookup "welche Cell projiziert auf diesen Pixel".
- **Layer-Toggle Ground/Air** vergleicht beide Sample-Y direkt am
  selben Tower.

Was im Panel NICHT direkt drin ist und potenziell wiederkommt, falls
nochmal nötig:

- **Direct-GPU-vs-CPU-Probe** wie das alte `losDiagProbeGpuVsCpu` (1×1-
  RT mit Quad-Shader, sampling-Konventions-Check). Im Panel kann man
  zwar pro Pixel sehen was der CPU-Pfad ausliest, aber ein
  programmatischer All-Cells-Sweep mit Mismatch-Reporting ist
  separate Arbeit. Code-Pattern dafür in `tower-shadow-mapper.ts`
  anhängen (~30 Zeilen), siehe Sackgasse "y-Flip in der Direction-zu-
  Pixel-Math (H5)" oben für die Vorlage.
- **Cache-vs-Live-Diff über alle Cells** für Drift-Diagnose nach Tile-
  Streaming — könnte als One-Click-Button im Panel ergänzt werden.

### Sonstiges

- LOS_OFFSET (alte 2.4 m Edge-Offset) ist entfernt.
- `setLineOfSightRaycaster` Setter in `three-tower.renderer.ts` bleibt
  für den `hasLineOfSight`-Combat-Fallback (Enemies zwischen Cells).
  `getLosRaycaster` Getter wurde entfernt (nie aufgerufen).
- `MAX_VIZ_CELLS = 5000` in `global-route-grid.ts` ist der Hard-Cap
  fürs Aggregate-Mesh. Bei 1763 Cells in der Test-Szene unkritisch.

---

## Was hier NICHT mehr stehen muss

Hatte hier in alten Versionen Code-Snippets für Phase 1-9-Plan,
v1-Code-Pfad-Inventur, Distance-Material-Source mit allen Lessons-
Kommentaren, AbStract-Description-of-State-Codes. Stehen alle im
Code selbst — `tower-shadow-mapper.ts` und `tower-los-layer-builder.ts`
haben Lesson-Nummerierung in Kommentaren. Dieses Doc ist Higher-Order-
Kontext und Sackgassen-Mahnmal, nicht API-Reference.

Frühere ausführliche Phase-Pläne (v1 → v3) sind im Git-Log
nachvollziehbar (Branch `feat/route-grid-gpu-los-v3`, History).

---

## Appendix: GPU-Probe Code-Pattern (für H5-artige Diagnosen)

Falls in einer künftigen Session wieder ein direkter GPU-vs-CPU-Vergleich
über viele Cells gebraucht wird (über die per-Pixel-Inspection im
Debug-Panel hinaus), das alte H5-Pattern reinbringen — ~30 Zeilen in
`tower-shadow-mapper.ts`:

```ts
private probeRT: WebGLRenderTarget | null = null;
private probeMaterial: ShaderMaterial | null = null;
private probeQuad: Mesh | null = null;
private probeScene: Scene | null = null;
private probeCamera: OrthographicCamera | null = null;

probeGpuSample(direction: Vector3): Uint8Array {
  if (!this.probeRT) {
    this.probeRT = new WebGLRenderTarget(1, 1, {
      format: RGBAFormat, type: UnsignedByteType,
      minFilter: NearestFilter, magFilter: NearestFilter,
      generateMipmaps: false, colorSpace: NoColorSpace,
    });
    this.probeMaterial = new ShaderMaterial({
      uniforms: { uCubeMap: { value: this.renderTarget.texture },
                  uDir: { value: new Vector3() } },
      vertexShader: `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `precision highp float;
        uniform samplerCube uCubeMap; uniform vec3 uDir;
        void main() {
          gl_FragColor = textureCube(uCubeMap, normalize(uDir));
        }`,
    });
    this.probeQuad = new Mesh(new PlaneGeometry(2, 2), this.probeMaterial);
    this.probeScene = new Scene();
    this.probeScene.add(this.probeQuad);
    this.probeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  this.probeMaterial!.uniforms['uCubeMap'].value = this.renderTarget.texture;
  this.probeMaterial!.uniforms['uDir'].value.copy(direction);
  const prevRT = this.renderer.getRenderTarget();
  this.renderer.setRenderTarget(this.probeRT);
  this.renderer.render(this.probeScene!, this.probeCamera!);
  this.renderer.setRenderTarget(prevRT);
  const buf = new Uint8Array(4);
  this.renderer.readRenderTargetPixels(this.probeRT, 0, 0, 1, 1, buf);
  return buf;
}
```

Plus den dazugehörigen `losDiagProbeGpuVsCpu`-Caller: pro Cell die
Direction berechnen, `probeGpuSample(dir)` UND `sampleCubeAtPoint(...)`
aufrufen, RGBA-Bytes byte-für-byte vergleichen. Mismatch → Math-
Inkonsistenz zwischen GPU-`textureCube` und der CPU-`directionToFace
Pixel`+`readRenderTargetPixels`-Kette. **Wichtig**: das ist ein
unabhängiger Pfad. Ein zweiter Aufruf derselben CPU-Funktion zum
Verify ist tautologisch (genau das war der H5-Stolperstein, siehe
Sackgassen-Galerie).
