# Handover: GPU-LOS-Pipeline für das Route-Grid

> **Status (2026-05-14):** Ground-LOS produktiv, Cache und Live-Sample
> sind nach dem H5-Fix bit-konsistent (`mismatch=0` über 427 Cells eines
> Archers verifiziert). **Air-LOS-Pipeline ist strukturell aufgesetzt
> (gleicher Cube, gleiche Sample-Y über `getAirTargetY`)** — User hat
> visuell aber noch nicht systematisch getestet. Air ist das nächste
> Thema in einer eigenen Session.
>
> Branch: `feat/route-grid-gpu-los-v3` · letzte Sitzung 2026-05-14.

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
  dichten Skyline-Szenen.

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

## Die zehn Lessons die für jeden Cube-Touch gelten

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

Zusätzlich für **CPU-readPixels-Konsumenten**:

11. **`py = floor(t * size)` — NICHT `size - 1 - floor(t * size)`.**
    Three.js' `textureCube` auf einem `WebGLCubeRenderTarget` sampelt
    direkt mit framebuffer-bottom-up t-Koordinate. Der y-Flip aus der
    v2-Probe (Lesson 8 unten) war FALSCH — siehe H5-Sektion. Wenn ein
    CPU-Path gegen den GPU-Sample geprüft wird: **muss ein
    unabhängiger GPU-Sample-Test sein** (z.B. 1×1-RT mit Quad-Shader
    der `textureCube` macht), nicht ein zweiter Call der selben
    Funktion gegen sich selbst (tautologisch).

---

## Files (Stand 2026-05-14)

| Datei | Verantwortung |
|---|---|
| `src/app/three-engine/tower-shadow-mapper.ts` | Cube-Render-Engine, Move-Gate, invalidate(), API: update/getRenderTarget/getReferencePos/getFarDistance/getRenderer |
| `src/app/utils/gpu-cube-resolve.ts` | `LosResolveContext`, `sampleCubeAtPoint`, `isCubeVisible` — CPU-readPixels-Pfad für Combat-Cache-Fill |
| `src/app/utils/tower-los-viz.ts` | Composite-Wrapper für Build-Preview und Selection-Viz |
| `src/app/utils/tower-los-layer-builder.ts` | InstancedMesh + Fragment-Shader für Live-Sample, 4-state + Filter-Mode |
| `src/app/utils/global-route-grid.ts` | `RouteCell`-Daten + `registerTower`/`Incremental` mit GPU-Cube-Resolve + `getAirTargetY` Helper + Aggregate-Mesh + `clearGroundVisibilityForTower` |
| `src/app/services/tower-placement.service.ts` | `buildLosResolveContext` (private), `registerTowerOnGrid`, `recomputeTowerLOS`, `recomputeAllTowersGroundLOS` |
| `src/app/services/world/global-route-grid.service.ts` | Angular-Wrapper-Service |
| `src/app/services/facade/visualization-facade.service.ts` | `onTilesLoaded` ruft `recomputeAllTowersGroundLOS` |
| `src/app/managers/tower.manager.ts` | Selection-Viz-Owner, `refreshSelectionViz`, `applyLosFilter` |
| `src/app/managers/enemy.manager.ts` | Air-Enemy-Flughöhe — Skyline-Block entfernt 2026-05-14 |
| `src/app/configs/los-viz.config.ts` | Single-Source-of-Truth-Magic-Numbers |
| `src/app/components/los-legend/los-legend.component.ts` | Filter-gated Legende |
| `src/app/utils/route-altitude-tubes.ts` | Air-Route-Debug-Tube |
| `src/app/utils/los-perf.ts` | Phase-Profiler (default off) |

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

### ⚠️ SACKGASSE: ScreenShake / Holo-Shader / Volumen-3D (Optik)

v1-Plan hatte schöne Optik geplant (Activation-Wave, Holo-Effekte,
Volumen-3D-Plates). User hat das in v3 zurückgestellt mit "subtil
bleiben". Aktuelle Plates sind flache 2-cm-Boxen, sanfter Pulse,
~0.45 Alpha. Wer Optik aufpolieren will: aus v1-Branch (`feat/route-
grid-gpu-los`) portierbar, aber nicht ohne expliziten User-Anstoß.

---

## Stand der Air-Pipeline (für die nächste Session)

### Was strukturell schon passt

- Single-Source-of-Truth-Helper `getAirTargetY(cell)` ist
  überall im Spiel — Combat, Per-Tower-Viz Air-Mesh-Position,
  Per-Tower-Viz Sample-Y im Shader (per-instance `aAirSampleY`),
  Aggregate-Air-Plate-Position, Air-Route-Tube.
- Combat-Cache und Live-Shader sampeln nach H5-Fix bit-konsistent.
- Air-Enemy-Flughöhe ist auf `geoHeight + heightOffset` (heightOffset
  per Type-Config 15–20m) — passt zum Sample-Y bei flachen Cells.

### Was offen ist

- **User hat Air noch nicht systematisch geprüft.** Wir wissen
  Ground funktioniert (per-Tower-Viz und Aggregate zeigen identische
  Cell-Counts mit Filter='ground'). Air hat denselben Mechanismus —
  sollte identisch laufen, ist aber nicht visuell verifiziert.
- **Enemy-vs-Tower-Höhen-Drift im Hochhausviertel.** Sample-Y =
  `terrain + 15`. Enemy-Y = `geoHeight + heightOffset`. In flachen
  Cells decken sich beide auf ±5m. Wenn Pfade-Wegpunkte aber durch
  enge Cells gehen mit hohen Buildings drumherum, könnte der Tower
  durch ein Building schießen während der Enemy oben drüber fliegt
  (oder umgekehrt). Erst empirisch in einer Manhattan-Szene testen.
- **`airRangeMultiplier`-Feld in `TowerConfig`** ist immer noch nicht
  da. Aktuell ist `airRange = groundRange` als Platzhalter (in
  `tower.manager.ts:331` und in `tower-placement.service.ts`). Pure-
  Air-Tower (Rocket) hätten nach Plan 1.5×, Mixed-Tower (Dual-Gatling
  AA-Retrofit) 1.2×. **Erst nach Air-Smoke-Test ergänzen** — bis
  dahin keine Komplexität ohne sichtbaren Mehrwert.
- **Real-Blocker-Dot kann zurückkommen** — siehe oben, Per-State-
  Gating ist Pflicht.

### Vorgeschlagener Air-Session-Workflow

1. Manhattan-ähnliche Szene laden (Tokyo / NYC), Hochhäuser sichtbar.
2. Air-Tower platzieren (Rocket oder Archer mit AA-Forschung). Per-
   Tower-Filter auf `air` setzen.
3. Visueller Check Selection-Viz ↔ Aggregate-Air (`gridAir`-Toggle):
   beide sollten dasselbe Cell-Set blau zeigen.
4. Air-Enemies spawnen lassen — Tower sollte sie treffen. Wenn nicht:
   `losDiagProbe…`-Pattern aus Git wieder einbauen (Code-Vorlage in
   diesem Doc unter H5-Sackgasse), die direkte CPU-vs-GPU-Probe für
   Air durchführen.
5. Hochhaus-Edge-Case: Enemy fliegt unten ums Hochhaus rum, Tower
   steht oben drauf. Tower sollte Enemy treffen wenn Sichtline
   geometrisch frei ist.
6. Falls Air auch sauber: `airRangeMultiplier` ergänzen, Real-
   Blocker-Dot mit Per-State-Gating zurückbringen wenn gewünscht.

### Hypothesen falls Air NICHT sauber läuft

- **Direction-zu-Pixel-Konvention bei Y-dominanter Direction**:
  Air-Sample ist häufig steil nach oben/unten von Tower-Tip aus.
  Vielleicht braucht POS_Y/NEG_Y eine Konventionsabweichung die ich
  in der CPU-Math nicht abgebildet habe. Diagnose: 1×1-RT-Probe
  speziell für Air-Cells.
- **Cube-Near=0.1m erfasst eigenes Tower-Dach** falls Tower auf
  Building steht: das Dach ist `< 1m` unter dem Tip → wird als Near-
  Blocker erfasst → ALL Air-Cells nahe diesem Tower false-blocked.
  CPU-Raycast hatte früher LOS_OFFSET=2.4m, das maskierte das.
  Mitigation falls relevant: `cubeCamera.near` auf z.B. 2.5m setzen.
- **getAirTargetY-Höhe zu niedrig in Skyline-Szenen** — `terrain+15`
  bringt Air-Sample-Punkt in Building-Stockwerke. Wenn Hochhaus 30m
  hoch, Sample bei 16m liegt mitten im Building → permanent
  blockiert. Mitigation: höherer Offset, oder doch wieder Option C
  (Max-of-both terrain+15 vs skyline+10). Aber **erst Option B
  durchspielen** — User hat sich bewusst dafür entschieden.

---

## Pre-Production-TODOs nach Air-Verify

- `airRangeMultiplier` in `TowerConfig` (1.5× pure-air, 1.2× mixed).
- Real-Blocker-Dot mit Per-State-Gating zurückbringen (optional, User-
  Entscheidung).
- "Combined View" überlegen: Per-Tower-Viz mit Filter='both' und
  Aggregate-Gold-State auf 3. Shader-Variante (Gold im Aggregat).
  Aktuell strikt 2-state pro Layer — User kann gold-Cells im
  Aggregate nicht erkennen, muss visuell stapeln (`grid` + `gridAir`).
- `MEMORY.md`-Eintrag: y-Flip-Konvention ist NICHT zusätzlich nötig
  bei `WebGLCubeRenderTarget` Three.js readPixels — der Test der das
  bewiesen hat ist nur dann valide wenn unabhängiger GPU-Sample-Pfad
  vergleicht.

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

### Diagnose-Infrastructure (entfernt)

Während der Air- und H5-Hunt-Session wurden eingebaut und nach
Verifikation wieder ENTFERNT:

- `[LOS-DIAG] cube-render`-Logs mit `callerLabel` in
  `TowerShadowMapper.update`
- `losDiagProbeTower(towerId)` — Cache-vs-CPU-readPixels-Check
  (tautologisch, weil Cache MIT CPU-readPixels gefüllt wird —
  nicht verwechseln mit der GPU-Probe)
- `losDiagDumpAggregate()` — Cache vs. State-Buffer
- `losDiagProbeGpuVsCpu(towerId)` — der **eigentliche** H5-Test:
  1×1-RT mit Quad-Shader `textureCube(map, dir)` vs.
  `sampleCubeAtPoint` für identische Direction-Vektoren
- `losDiagDumpSelectionState()` — Filter-Bridge-Check

Code-Pattern für die GPU-Probe (falls nächste Session wieder
gebraucht — 30 Zeilen, in `tower-shadow-mapper.ts` anhängen):

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

Plus den dazugehörigen `losDiagProbeGpuVsCpu`-Caller (siehe Git-Log
für Vorlage).

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
