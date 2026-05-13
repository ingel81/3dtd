# Handover: GPU-LOS-Pipeline für das Route-Grid

> **Status:** **v3 GROUND PRODUCTION-READY — AIR-LOS BUG WEITER OFFEN**
>
> v3 (`feat/route-grid-gpu-los-v3`) hat die Phasen 2-7 abgeschlossen.
> Ground-LOS läuft sauber und smooth bei 144 Hz auch bei aggressivem Drag
> (User-bestätigt). Build-Preview, Tower-Selection und globales Debug-Grid
> teilen sich denselben 4-State-Shader + Single-Source-of-Truth-Palette.
> Performance-Pitfall aus dem ursprünglichen Code (refineCellsInRadius pro
> Mouse-Move) ist gefixt.
>
> Air-LOS-Bug aus v2 ist NICHT angegangen worden — der User hat ihn
> explizit als eigene Research-Session vertagt. Die airRange-Pipeline ist
> aktuell ein Platzhalter (airRange == groundRange).
>
> **Datum (Original):** 2026-05-12 · **Datum letzter Update:** 2026-05-13
>
> **Empfehlung:** Auf v3 weiterbauen, NICHT verwerfen. Air-Research mit
> den 5 Hypothesen im v2-Abschnitt als nächste dedizierte Session.

## TL;DR

GPU-Cubemap-basierter LOS-Test für Tower funktioniert für Ground sauber, ist
deutlich schneller als der bisherige 50-Cells-pro-Frame-CPU-Raycast-Batch und
löst die Frame-Drops beim Tower-Placement auf komplexen Karten.

**Versuchsserie bis 2026-05-13:**
- **v1** (`feat/route-grid-gpu-los`) — im Chaos versandet, drei Viz-Pfade
  parallel, Debug-Code verflochten mit Produktion.
- **v2** (`feat/route-grid-gpu-los-v2`) — main-basierter Re-Build mit dem
  ersten v1-Handover als Spec. Ground-LOS funktioniert. Air-LOS produziert
  weiterhin Phantom-Blocker (s. Lessons Learned v2). Code im finalen Stand
  durch iterative Debug-Versuche wieder polluted.
- **v3** (`feat/route-grid-gpu-los-v3`, **AKTIV**) — main-basierter Re-Build
  mit DIESEM Dokument als Spec. Phasen 2-7 in einem Commit (`c5d27eb`),
  Performance-Fix nachgezogen (`b47bff2`). Air-LOS-Bug weiter offen
  (User-Entscheidung: separate Research-Session). Lessons Learned v3 weiter
  unten.

## Worum es geht

**Problem:** Der bisherige CPU-Raycast-Pfad für Tower-LOS (`registerTower`,
`createPlacementPreview` in `global-route-grid.ts`) macht **2 Raycasts pro Cell**
und lief in einem 50-Cells-pro-Frame-Batch. Bei Tower-Placement mit der Maus
über einer komplexen 3D-Tiles-Karte (~1500 Cells in Range) brachen die FPS
massiv ein, und ein 150 ms Debounce vor dem progressiven Build machte das
Preview "ploppen" statt fließend.

**Lösung:** Statt N Raycasts → **1 Cubemap-Render** vom Tower-Tip aus. Die
Cubemap encodiert die Distanz zum nächsten Blocker in jeder Richtung. Der
Cell-Shader macht pro Fragment einen Cubemap-Lookup statt eines CPU-Raycasts.
Performance: O(N Cells) Texture-Lookups auf der GPU statt O(N Cells) CPU-Rays.

**Architektur in einem Satz:** Single Source of Truth ist die Cubemap.
Preview, Per-Tower-Viz, Debug-Overlay, Tower-Targeting — alle vier nutzen
denselben Cubemap-Mechanismus, keine zweite Pipeline daneben.

## Was vom alten Branch erhalten / verloren geht

### Behalten — gehört auf main

- ~~**Skyline-Cache** (Commit `7b758ee`)~~ — **ABGELÖST** (v2-Update
  2026-05-13). Skyline-adaptives Air-Modell verworfen, Air-Enemies fliegen
  jetzt auf `terrainY + 15m` (fixe Höhe). Skyline-Cache nicht mehr nötig,
  die Variable existiert in main inzwischen ohnehin nicht mehr.

### Erhalten als Referenz (Branch bleibt liegen)

- **`TowerShadowMapper`-Klasse** (`src/app/three-engine/tower-shadow-mapper.ts`):
  Architektur grundsätzlich richtig. Custom-ShaderMaterial-Override mit
  Distance-Packing-Logik. Cube-Render-Gate (>0.5 m Bewegung), Invalidation-Token
  für Tile-Streaming. **Aber:** in der finalen Version stark durch
  Debug-Sphere / Probes / Cursor-Probe-Code aufgebläht — die saubere Core-Logik
  ist in den ersten Commits zu finden (siehe `e882437`, `de7f2f0`, `6389aea`).
- **`createPlacementPreviewWithShadowMap`** in `global-route-grid.ts`: die
  Idee einer Single-Pass-GPU-Mesh-Erzeugung. Aber Implementation mischt
  Ground+Air in einer Mesh — neuer Versuch macht das als zwei Layer-Meshes.

### Wegwerfen

- Die ganzen `debug(route-grid): ...`-Commits — Probes, Sphere, Cursor,
  Disagreement-Tint. Konzeptionell für Debug nützlich, aber als Produktions-Code
  verschmutzten sie Mapper + Cell-Shader + Service-Layer. Im neuen Versuch
  kein Debug-Code in der Production-Pipeline.
- X-Flip-Versuch (Commits `51c0591` + revert `a3230ff`): Three.js' `flipEnvMap`
  ist für loaded CubeTexture aus HDR-Dateien, **NICHT** für CubeRenderTarget.
  Lehrgeld — direkt im Handover dokumentiert (s.u.), nicht im Code.
- Optik (Holo-Shader, Activation-Wave, Volumen-3D) — schön, aber zu früh. Erst
  wenn funktional korrekt steht.

## Lessons Learned: was wir wissen müssen

Folgende Punkte sind durch Schmerz erkauft — der neue Branch sollte sie von
Anfang an richtig machen.

### Custom Distance-Material — die Falle mit MeshDistanceMaterial

Three.js' `MeshDistanceMaterial` ist auf den ersten Blick perfekt für unseren
Zweck (Distance vom Punkt aus packen). **Aber:** seine Uniforms
`referencePosition` / `nearDistance` / `farDistance` werden vom Renderer
intern für Point-Light-Shadow-Pässe wired — sie sind nicht Teil der JS-Klasse,
können nicht von außen gesetzt werden. Als `scene.overrideMaterial` gesetzt
ist das Material wirkungslos.

**Lösung:** Eigene ShaderMaterial schreiben, die `packDepthToRGBA(dist/far)`
direkt im Fragment macht. So sieht der Vertex-Shader aus:

```glsl
varying vec3 vWorldPosition;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 localPos = vec4(position, 1.0);
  // KRITISCH: USE_INSTANCING manuell honorieren (s.u.)
  #ifdef USE_INSTANCING
    localPos = instanceMatrix * localPos;
  #endif
  vec4 worldPos = modelMatrix * localPos;
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
  #include <logdepthbuf_vertex>
}
```

Fragment:

```glsl
#include <common>
#include <packing>
#include <logdepthbuf_pars_fragment>
varying vec3 vWorldPosition;
uniform vec3 uReferencePosition;
uniform float uFarDistance;
void main() {
  #include <logdepthbuf_fragment>
  float dist = length(vWorldPosition - uReferencePosition);
  float encoded = clamp(dist / uFarDistance, 0.0, 1.0);
  gl_FragColor = packDepthToRGBA(encoded);
}
```

### USE_INSTANCING im Override-Material ist kritisch

`scene.overrideMaterial` wird auf **alle** Scene-Renderables angewendet. Bei
einem `InstancedMesh` (Enemy-Renderer, Tower-Body-Instances, Projektile,
Route-Grid-Viz) hat jedes Renderable einen `instanceMatrix` mit
Per-Instance-Translation. Wenn das Override-Material `instanceMatrix` **nicht**
honoriert, kollabieren alle Instances zum Model-Origin → **Phantom-Blocker
direkt am Tower-Tip → Sphere komplett rot, Visibility-Test komplett broken.**

Three.js definiert das `USE_INSTANCING` Define automatisch beim Compile per
Renderable. Im Override-Vertex-Shader muss man explizit reagieren:

```glsl
vec4 localPos = vec4(position, 1.0);
#ifdef USE_INSTANCING
  localPos = instanceMatrix * localPos;
#endif
```

(Skinning, MorphTargets gleiche Logik — falls je relevant.)

### Overlay-Gruppe excluden ist Pflicht

Die Cubemap rendert **alles in der Szene**, auch UI-Overlays wie Streets,
Routes, Building-Outlines, Marker, Range-Indicator. Diese sitzen alle in
`engine.getOverlayGroup()` — sie sind **keine echten Welt-Blocker**, aber
schreiben Distance in die Cubemap → Phantom-Schatten in freien Bereichen,
yellow-disagreement-Probes ohne erkennbaren Grund.

**Lösung:** Beim Cube-Render `overlayGroup.visible = false` temporär setzen,
nach dem Render wieder restoren. Plus das Tower-Preview-Mesh selbst — sitzt
literally am Tower-Tip, sonst sieht die Kamera die eigene Antenne als Blocker.

```ts
const visBackup = excludeFromRender.map(o => o.visible);
excludeFromRender.forEach(o => o.visible = false);
this.cubeCamera.update(this.renderer, this.scene);
excludeFromRender.forEach((o, i) => o.visible = visBackup[i]);
```

**Mittelfristig besser:** Layer-System. `tilesRenderer.group` auf Layer X, Cube
rendert nur Layer X, Main-Camera rendert Layer X + Default. Spart die
visible-Toggle-Choreographie und vermeidet vergessene Excludes.

### `flipEnvMap` ist NICHT für CubeRenderTarget

Three.js' built-in envMap-Shader sampelt mit `vec3(flipEnvMap * dir.x, dir.yz)`,
wobei `flipEnvMap = -1` für `CubeTexture`. Versuchung: "ich sample auch eine
CubeTexture, also brauche ich auch den X-Flip."

**Aber:** `flipEnvMap = -1` ist für CubeTextures, die aus 6 HDR-Bilddateien
geladen wurden, mit einer Renderman-Konvention die historisch von der
World-Space-Konvention abweicht. Eine `WebGLCubeRenderTarget`, die mit einer
`CubeCamera` gerendert wurde, hat **identische** Orientierung wie World-Space
— jede Face-Camera blickt in die entsprechende Welt-Achse mit `up=+Y`.

**Sample direkt mit `textureCube(map, worldDir)`** — kein X-Flip. Falls
Visibility seitenverkehrt erscheint, liegt das nicht am `flipEnvMap`.

### Far-Distance-Encoding muss in Lockstep mit Decode sein

Wenn die Cubemap mit `farDistance = range + 5` encoded wurde, muss der
Cell-Shader-Decode auch mit `range + 5` multiplizieren. **Im alten Branch:**
das Padding war auf dem Mapper, aber der Getter `getFarDistance()` gab `range`
zurück → Decode war 5 m zu kurz → alle Cells fälschlich blockiert.

**Lösung:** Drop the padding. `far = range` direkt. Der 0.5 m
Visibility-Bias im Cell-Shader (`cellDist < blockerDist - 0.5`) deckt Edge-Cases
am Rand der Range ab.

Variable im Mapper getrennt halten:
- `lastRange` für Change-Detection
- `lastEncodedFar` für was tatsächlich in der Cubemap steckt
- `getFarDistance()` returnt `lastEncodedFar`

### 512px Cubemap als Default

256² × 6 Faces gibt bei 90° FOV ~2.8 Pixel pro Grad. Eine Baumkrone von 1 m
Breite in 10 m Distanz nimmt 5.7° ein = 16 Pixel breit. Mit photorealistischen
3D-Tiles-Meshes kann es vorkommen dass dünne Triangulation zwischen Pixel
durchrutscht → Tree blockiert nicht zuverlässig.

512² × 6 = ~6 MB VRAM, ~5.7 Pixel pro Grad → 32 Pixel für 1 m bei 10 m. Reicht
für alles was wir bisher gesehen haben. Bei N Tower (Targeting via Cubemap)
linearer Speicher-Anstieg → bei 50 Tower 300 MB. Ggf. shared Cubemap mit
Re-Render statt persistenter pro-Tower-Cubemap, falls Memory eng wird.

### ~~Air-Target-Höhe: skyline + 10 m~~ — ABGELÖST: fixe Höhe `terrainY + 15m`

**v2-Update (2026-05-13):** Das skyline-adaptive Modell wurde komplett
verworfen. Begründung: visuell überraschend ("warum blockiert das Hochhaus
meinen Air-Tower über der Straße davor"), und Cells unter hohen Gebäuden
hatten unsinnig steile Air-Sample-Punkte mit viel zu kleinen Trefferchancen.

**Aktuelles Modell:**
- Air-Sample = `cell.terrainHeight + LOS_VIZ_CONFIG.airSampleYOffset (15m)`
- Pure-Air-Towers (Rocket): `airRangeMultiplier = 1.5` → 1.5× normale
  Range nur für Air-Targets
- Mixed-Towers (Dual-Gatling nach AA-Retrofit-Research):
  `airRangeMultiplier = 1.2`
- Single Source of Truth: `getAirTargetY(cell)` in
  `src/app/utils/global-route-grid.ts`
- Helper: `canTargetAirEffective()` / `getAirRangeMultiplierEffective()`
  in `src/app/entities/tower-targeting.util.ts` (gated by
  `researchStore.airTargetingUnlocked()`)

### Cubemap-Cell-Distanz mit horizontaler Range falloff vergleichen

Im Cell-Shader: Distanz für Cube-Sample = `length(cellWorld - towerTip)` (3D).
Distanz für Range-Falloff = horizontal nur (Y ignorieren).

Grund: Range-Falloff soll als horizontaler Ring um den Tower aussehen, nicht
als 3D-Kugel. Sonst sehen Air-Cells (die hoch oben sind) viel weiter weg aus
als sie horizontal sind → die fade-Range stimmt nicht zur tatsächlichen
Tower-Reichweite.

## Architektur-Vision für den neuen Branch

### Eine Pipeline, drei Verwendungen

```
TowerShadowMapper (1 pro Tower oder shared)
  ↓ rendert depth cubemap vom Tower-Tip
  ↓
TowerLosLayerBuilder
  ↓ baut bis zu 2 Meshes: GroundLayer + AirLayer
  ↓ beide mit identischem Cell-Shader, nur uLayerKind unterscheidet
  ↓
Verwendet von:
  ① Build-Preview        (mouse hover, neue Cubemap pro Bewegung)
  ② Tower-Selection-Viz  (selected tower, Cubemap entweder cached oder neu)
  ③ Tower-Build-Resolve  (1× Cubemap → cell.towerVisibility befüllen)
  ④ Debug-Overlay        (separate Entscheidung, ggf. Aggregat)
```

**Keine** Legacy-CPU-Raycast-Pipeline parallel daneben. **Keine** alternative
Mesh-Variante mit `aGroundVisible`/`aAirVisible` Attributes. **Eine** Code-Pfad.

### ~~Air als eigener Layer-Mesh~~ — ABGELÖST: Single-Mesh mit 4-State-Mix

**v2-Update (2026-05-13):** Two-Layer-Mesh-Aufteilung verworfen zugunsten
einer EIN-Mesh-Variante mit 4-State-Coloring. Begründung: zwei separate
Layer am Boden + in der Luft sind visuell verwirrend (zwei Schichten
übereinander, schlechte Lesbarkeit auf der Karte). User-Feedback in v2:
4-State auf Bodenebene mit Punkt-Indikator ist klarer.

**Aktuelles Modell** (siehe `LOS_VIZ_CONFIG.states` + Cell-Shader in
`tower-los-layer-builder.ts`):

```
both        — Tower kann sowohl Ground als auch Air treffen → gold
groundOnly  — Ground frei, Air blockiert (oder Tower hat nur Ground) → grün
airOnly     — Air frei, Ground blockiert (oder Tower hat nur Air) → cyan
neither     — Beides blockiert → rot (low alpha)
```

Plus **zentrierter schwarzer Dot** wenn ein REALER Blocker
(`depth < 0.99`) die Sichtbarkeit killt. Unterscheidet "blockiert durch
Range-Math" (kein Dot — Cell ist zu weit weg) von "blockiert durch echte
Geometrie" (mit Dot — Building im Weg). User-bestätigt als sehr nützlich.

Tower-Capability-Gating bleibt im Shader (uniform `uHasGround` /
`uHasAir`): bei einem Pure-Air-Tower wird nur `airOnly` oder `neither`
ausgegeben, ground sample wird gar nicht ausgewertet (Shader-Effizienz).

Plus die **Color-Legende** am Screen-Bottom
(`los-legend.component.ts`) — zeigt die 4-State-Bedeutung permanent an.

### Phasen-Plan für die Implementation (v3)

Reihenfolge, jede Phase als sauberer Commit, kein Debug-Code in
Production-Path. Gotchas-Checkliste v2 (alle 10 Lessons) MUSS vor jedem
Commit abgehakt sein.

> **v3-Stand 2026-05-13:** Phasen 2-7 sind **in einem konsolidierten
> Commit** (`c5d27eb feat(los): GPU-cubemap-driven LOS pipeline …`)
> umgesetzt — die User-Direktive "keine zwei Systeme parallel" hat das
> Aufteilen in viele Commits ad absurdum geführt, weil zwischen Phase 5
> und Phase 7 sonst der Legacy-CPU-Pfad neben dem GPU-Pfad gestanden
> hätte. Performance-Optimierung als `b47bff2 perf(los): skip stable-cell
> re-sampling on preview drag` nachgezogen. Phasen 8 (Debug-Overlay) und
> 9 (Optik-Polish) sind vom User explizit zurückgestellt — die Debug-
> Aggregat-Viz nutzt jetzt die gleiche Palette (s. Lessons v3) und
> Volumen-3D / Holo-Effekte sind nicht gewünscht (Optik bewusst subtil).
>
> Die Phasen-Beschreibungen unten bleiben als Referenz wie der Code
> aufgebaut wurde — nicht als To-do.

**Phase 1: ~~Skyline-Cache~~** — abgelöst, entfällt für v3.

**Phase 2: TowerShadowMapper** (clean) ✅ **DONE in v3**:
- Eigene Klasse in `src/app/three-engine/tower-shadow-mapper.ts`
- API: `update(towerTip, range, opts?: { includeOnly?: Object3D })`
- Render-Gate >0.5 m Bewegung, Invalidation-Token für Tile-Streaming
- 512² Default, Far = range (kein Padding), **NearestFilter**,
  **NoColorSpace**
- USE_INSTANCING + USE_BATCHING im Distance-Material (Lesson 1)
- mesh.material + mesh.onBeforeRender Swap mit Backup/Restore (Lesson 2)
- ClearColor save/restore auf (0x000000, 0) (Lesson 5)
- `includeOnly: tilesGroup` Pattern (Lesson 6)
- **Keine** Debug-Methoden, **kein** Cursor-Probe-Code, **keine**
  console.logs
- Instantiiert in `ThreeTilesEngine`, exposed via `getTowerShadowMapper()`

**Phase 3: TowerLosLayerBuilder** + Cell-Shader ✅ **DONE in v3** (Real-Blocker-Dot entfernt, s. Lessons v3):
- Eigene Klasse in `src/app/utils/tower-los-layer-builder.ts` (NICHT in
  `global-route-grid.ts` — das Routegrid ist Daten-Modell, nicht Renderer)
- `build({cells, towerX, towerZ, range, airRange, gridCellSize,
   canTargetGround, canTargetAir, shadowMapper}): LosLayer | null`
- **EIN Mesh** mit 4-State-Coloring (`both / groundOnly / airOnly /
  neither`), Punkt-Indikator für reale Blocker (depth < 0.99)
- Tower-Capability-Gating via `uHasGround` / `uHasAir` Uniforms
- Single-Pass-Mesh-Erzeugung, alle Cells in einem Frame, kein progressiver Batch
- Cell-Shader: `vAirSampleWorld` / `vGroundSampleWorld` aus instance-attributes
  `aAirSampleY` / `aGroundSampleY`, Safeguard `if (depth < 0.001) depth = 1.0`
- Sample-Logik: zwei `sampleVisible()` Calls (ground + air), beide Sample-Punkte
  haben gleiche XZ (cell.center), nur unterschiedliche Y

**Phase 4: TowerLosViz-Composite** ✅ **DONE in v3**:
- Wrapper-Klasse `src/app/utils/tower-los-viz.ts`
- Konstruktor: `shadowMapper.update()` + `LayerBuilder.build()` → Group
- `tick(t)`: refresh uTowerTip / uFarDistance / uTime uniforms each frame
- `dispose()`: free layer + remove group from parent
- Wird von Preview, Selection genutzt

**Phase 5: TowerPlacementService auf neue Pipeline** ✅ **DONE in v3**:
- `createLosPreview` erzeugt TowerLosViz statt direkt Mesh
- Kein 150 ms Debounce mehr (Cubemap-Update ist instant)
- Kein DevWorld-Fallback (DevWorld nutzt auch den Mapper)
- Komplette Entfernung der alten `createPlacementPreview`-Methode

**Phase 6: Per-Tower-Viz auf GPU** ✅ **DONE in v3** (Cubemap pro Selection neu, kein Caching):
- `TowerManager.selectTower` → erzeugt TowerLosViz mit Tower-Position
- Cubemap entweder pro Tower cached oder pro Selection neu — Entscheidung nach
  Memory-Test bei N Tower
- Alte `createTowerVisualization`-Methode entfernen

**Phase 7: registerTower auf GPU** (Tower-Build-Resolve) ✅ **DONE in v3** (Variant A umgesetzt):
- Beim Tower-Build: 1 Cubemap-Render
- Resolve-Pass: für jede Cell in Range den GPU-Visibility-Test reproduzieren
  und Ergebnis in `cell.towerVisibility` / `cell.airVisibility` schreiben
- Zwei Implementations-Optionen:
  - **A (einfach, langsamer):** CPU iteriert Cells, macht für jede einen
    `losRaycaster` Call — also doch CPU-Raycast, aber einmalig pro Build.
    Diese Variante ist eigentlich keine "GPU"-Variante, aber sie ersetzt den
    50-Cells-pro-Frame-Batch durch einen einmaligen synchronen Aufwand.
  - **B (richtig GPU):** Eigenes RenderTarget rendert pro Cell ein Pixel mit
    der Visibility-Logik. `readPixels` einmal in Buffer, dann in Map.
    Komplexer, aber strikt GPU.

  **Empfehlung:** A zuerst (saubere Abkehr vom Per-Frame-Batch ohne neue
  Komplexität), B nur wenn A messbar zu langsam ist.

**Phase 8: Debug-Overlay** — in v3 anders gelöst: bestehender globaler
LOS_CELL-Shader bleibt erhalten, aber die Farben werden zur Compile-Zeit
aus `LOS_VIZ_CONFIG.states` + `LOS_VIZ_CONFIG.globalStates` interpoliert
(siehe Lessons v3 §1). Single Source of Truth für Palette zwischen
per-Tower-Viz und Aggregat-Viz. Kein GPU-Aggregat über alle Tower-
Cubemaps nötig.

**Phase 9 (Optional): Optik-Polish** — vom User explizit zurückgestellt:
"Subtil bleiben". Volumen-3D, Holo-Shader, Activation-Wave nicht
portiert.

## Konkrete Gotchas-Checkliste v1 (für Phasen 2-9)

Allgemeine Pipeline-Konsistenz — vor jedem Commit prüfen:

- [ ] `MeshDistanceMaterial` nicht verwenden — eigenes ShaderMaterial schreiben
- [ ] `USE_INSTANCING` im Vertex-Shader des Distance-Materials honorieren
- [ ] `logdepthbuf_pars_*` Chunks einbinden (Renderer hat `logarithmicDepthBuffer: true`)
- [ ] `WebGLCubeRenderTarget` ohne X-Flip sampeln — `textureCube(map, worldDir)` direkt
- [ ] `includeOnly: tilesGroup` Pattern statt excludeFromRender-Liste
- [ ] Far-Distance ohne Padding — `cube.far = range`, decode mit demselben
- [ ] Cube-Resolution 512² (nicht 256²)
- [ ] Range-Falloff im Cell-Shader: **horizontale** Distanz, nicht 3D
- [ ] Air-Target = `cell.terrainHeight + LOS_VIZ_CONFIG.airSampleYOffset (15m)`
  — fixe Höhe, nicht skyline-adaptive
- [ ] Bei jedem Tower-Move: Cube-Render durch `>0.5 m` Bewegung gegated
- [ ] Bei Tile-Streaming: Mapper via `invalidate()` triggern für nächsten Render

**Zusätzliche v2-Checkliste siehe unten** ("Gotchas-Checkliste v2") —
behandelt BatchedMesh, NearestFilter, NoColorSpace, ClearColor,
onBeforeRender-Neutralisierung. **BEIDE Listen sind Pflicht.**

## Pfad zum Start von v3

```bash
# Auf main wechseln
git checkout main

# Dieses Handover-Doc von v2 holen (es enthält Lessons Learned v2)
git checkout feat/route-grid-gpu-los-v2 -- docs/HANDOVER_ROUTE_GRID_GPU_LOS.md
git commit -m "docs(los): handover update from v2 — lessons learned + air-bug status"

# v3 von main abzweigen
git checkout -b feat/route-grid-gpu-los-v3

# Loslegen — Phasenplan unten, Phase 2 zuerst (TowerShadowMapper neu).
# Gotchas-Checkliste v2 (= alle 10 Lessons) MUSS vor jedem Commit abgehakt
# sein.
```

Die alten Branches bleiben als historische Referenz liegen:
- `feat/route-grid-gpu-los` (v1) — gescheiterter erster Versuch
- `feat/route-grid-gpu-los-v2` (v2) — Ground funktioniert, Air-Bug
  ungelöst, Code im finalen Stand polluted

Aus v2 sind konkrete Code-Snippets verwertbar (siehe "Verwertbarer Code"-
Sektion unten). Anschauen als Vorlage, aber **nicht** direkt cherry-picken
oder mergen. v3 wird von Anfang an clean aufgebaut.

## ~~Anhang: Schlüssel-Code-Stellen im alten Branch (v1)~~

**ABGELÖST** durch die "Verwertbarer Code aus diesem Branch"-Tabelle in
Lessons Learned v2 unten. Die v1-Pfade (`global-route-grid.ts` Line-Ranges)
existieren in v2 so nicht mehr — Cell-Shader und Mesh-Builder wurden in
eigene Dateien herausgezogen (`tower-los-layer-builder.ts`,
`tower-los-viz.ts`).

## Was *nicht* in den neuen Branch gehört

- Per-Cell-Disagreement-Tint (war nur Debug-Tool für die GPU-vs-Legacy-Phase —
  ohne Legacy gibt's nichts zu vergleichen)
- LOS-Ray-Probes mit Sphären und Boxen (Debug-only)
- Heatmap-Debug-Sphere (Debug-only)
- Cursor-Probe (war degenerate weil im Build-Mode der Cursor schon der
  Tower-Tip ist)
- 150 ms Debounce vor Preview-Build (nicht mehr nötig wenn Cube-Render <1 ms ist)
- Console-Logs in Production-Pfaden (CellLayer-Build, ShadowMap-Update,
  REFINE-Output etc.) — in v2 alle als Debug eingebaut und nie entfernt.
  In v3 von Anfang an OHNE.
- Hover-Inspector mit Markern/Linien im production-`tower-placement.service.ts`
  (v2 hatte den dort verdrahtet). Falls Debug-Hover gewollt: separates
  Service/Modul, opt-in über Feature-Flag.

---

# Lessons Learned v2 (Implementation Attempt #2, 2026-05-13)

Diese Sektion dokumentiert alles was beim zweiten Versuch (`main`-basierter
Re-Build) gelernt wurde. Phase 2-6 des Plans oben sind grob umgesetzt; die
Lücke ist Air-LOS-Korrektheit. Punkte hier sind **kritisch** — jeder
einzelne hat in dieser Session mindestens eine Stunde gekostet.

## Hart erkaufte Erkenntnisse

### 1. 3DTilesRendererJS verwendet BatchedMesh (NICHT regulärer Mesh)

`TilesFadePlugin` und der Tiles-Renderer batchen geladene Tiles in einen
`THREE.BatchedMesh`. Per-Tile-Transform liegt in einer **Texture**, nicht
einem `instanceMatrix`-Attribute. Three.js definiert `USE_BATCHING` beim
Compile statt `USE_INSTANCING`.

**Konsequenz:** Custom Distance-Material muss `<batching_pars_vertex>` UND
`<batching_vertex>` Chunks einbinden, dann `batchingMatrix * localPos`.
Ohne das: alle Batch-Instanzen kollabieren zum Model-Origin der tilesGroup
→ Cube zeigt einen Phantom-Blocker ~0.3 m vom Tower-Tip in jeder Richtung.

```glsl
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  #include <batching_vertex>          // <-- DEKLARIERT batchingMatrix
  vec4 localPos = vec4(position, 1.0);
  #ifdef USE_BATCHING
    localPos = batchingMatrix * localPos;
  #endif
  #ifdef USE_INSTANCING
    localPos = instanceMatrix * localPos;
  #endif
  vec4 worldPos = modelMatrix * localPos;
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
  #include <logdepthbuf_vertex>
}
```

Reihenfolge (batching VOR instancing) wichtig — falls je beide gleichzeitig.

### 2. `scene.overrideMaterial` reicht für 3DTiles NICHT

Three.js' Renderer-Loop ruft `mesh.onBeforeRender(renderer, scene, camera,
geometry, material, group)` **mit dem ÜberrideMaterial als `material`-Arg**.
`TilesFadePlugin` hookt sich dort ein und mutiert `material.opacity` /
`material.transparent` auf den per-Tile-Fade-Zustand. Da wir ÜberrideMaterial
mit nur EINER shared Instanz nutzen, kontaminiert das die Distance-Material
und führt zu Alpha-Blending statt sauberem `gl_FragColor` Write.

**Symptom:** Cube-Bytes haben Alpha-Cluster auf 0 oder 127 statt voller
Range; bytes RGB sehen "verwaschen" aus statt klare `packDepthToRGBA`-Outputs.

**Lösung:** Vor dem Cube-Render `includeOnly`-Traversal:
```ts
includeOnly.traverse(obj => {
  if (!(obj instanceof Mesh)) return;
  const m = obj as Mesh;
  meshBackup.push({ mesh: m, material: m.material, onBeforeRender: m.onBeforeRender });
  m.material = this.distanceMaterial;
  m.onBeforeRender = noop;
});
// ... cube render ...
for (const e of meshBackup) {
  e.mesh.material = e.material;
  e.mesh.onBeforeRender = e.onBeforeRender;
}
```

**Plus** hart-resetten der Distance-Material State JEDEN Render (für den Fall
dass ein Plugin trotzdem durchschlüpft hat):
```ts
this.distanceMaterial.transparent = false;
this.distanceMaterial.opacity = 1;
this.distanceMaterial.depthWrite = true;
this.distanceMaterial.depthTest = true;
this.distanceMaterial.needsUpdate = true;
```

### 3. CubeRenderTarget MUSS NearestFilter haben (nicht LinearFilter)

`packDepthToRGBA` ist eine bit-genaue Encoding über 4 RGBA-Kanäle.
Bilinear-Interpolation zwischen 2 Nachbar-Texeln mit z.B. `pack(0.001)` und
`pack(0.997)` ergibt mathematisch **keinen** gültigen depth-Wert — die GPU
mixt 4 unabhängige Bit-Pattern.

**Symptom:** Cell-Shader und Probe lesen unterschiedliche depth-Werte für
denselben sample-Richtung, weil die Probe einen Texel direkt liest und der
Cell-Shader durch Bilinear-Filter 4 Texel mixt.

```ts
this.renderTarget = new WebGLCubeRenderTarget(cubeSize, {
  format: RGBAFormat,
  type: UnsignedByteType,
  minFilter: NearestFilter,    // ← NICHT LinearFilter
  magFilter: NearestFilter,    // ← NICHT LinearFilter
  generateMipmaps: false,
  colorSpace: NoColorSpace,    // s.u.
});
```

### 4. CubeRenderTarget MUSS `colorSpace: NoColorSpace` haben

Default sRGB-Pfad würde die packed-depth-Bytes sRGB-encodieren beim Write
und sRGB-decoden beim Sample → korrumpiert den bit-genauen Roundtrip.
Trifft besonders Read-Back-Pfade (Probe via `readRenderTargetPixels`).

### 5. Renderer Clear-Color für Cube-Render auf (0,0,0,0)

Die Game-Scene nutzt einen sky-blue Clear-Color für die Main-Render-Loop.
Wenn der Cube-Render im gleichen Renderer läuft, vererbt sich der
Clear-Color. "Leere" Cube-Texel (wo mein Distance-Material discardet oder
keine Geometrie hingerendert wurde) bekommen die sky-Farbe als Bytes —
diese sehen Bit-pattern-mässig aus wie `packDepthToRGBA(~0.003)` (= 0.4 m
Blocker) und triggern den Safeguard `if (depth < 0.001) depth = 1.0` NICHT.

Sicher save/restore:
```ts
const prevClearColor = new Color();
this.renderer.getClearColor(prevClearColor);
const prevClearAlpha = this.renderer.getClearAlpha();
this.renderer.setClearColor(0x000000, 0);

this.cubeCamera.update(this.renderer, this.scene);

this.renderer.setClearColor(prevClearColor, prevClearAlpha);
```

### 6. `includeOnly: tilesGroup` statt `excludeFromRender: [overlay, preview, ...]`

Statt jeden möglichen Nicht-Tile-Stör-Mesh in einer Exclude-Liste zu
verfolgen: hide ALLES auf scene-root-Level außer tilesGroup. Damit sind
Cube und CPU `Raycaster.intersectObject(tilesGroup, true)` in striktem
Lockstep — kein "der Cube sieht was, das der CPU-Raycast nicht sieht".

```ts
const hiddenSiblings: Object3D[] = [];
for (const child of this.scene.children) {
  if (child === includeOnly) continue;
  if (!child.visible) continue;
  child.visible = false;
  hiddenSiblings.push(child);
}
// render
for (const obj of hiddenSiblings) obj.visible = true;
```

### 7. Probe MUSS `shadowMapper.getReferencePos()` nutzen

Ein selected-Tower hat eine `tower.position` (geo). Beim Probe via
`engine.sync.geoToLocalSimple(...)` zu konvertieren ergibt **subtle
Differenzen** zu dem worldPosition mit dem `shadowMapper.update()` zuletzt
gerendert wurde (build-preview kann den shared mapper "gehijacked" haben).

Auch wenn die Position fast gleich ist (~0.5m diff), kann das mit
NearestFilter zu einem Texel-Offset von 4-5 pixels führen — Probe und
Cell-Shader sampeln dann verschiedene Pixel.

**Lösung:** Probe nutzt EXAKT die Position aus der der Cube zuletzt
gerendert wurde:
```ts
const referencePos = engine.getTowerShadowMapper().getReferencePos();
const tipWorld = new Vector3(referencePos.x, referencePos.y, referencePos.z);
```

### 8. Direct-Pixel-Readback statt Shader-basierter Probe

Erster Probe-Versuch: ein 1×1-RT mit fullscreen-Quad-Shader der
`textureCube(cube, dir)` sampelt. Hat sRGB-Encoding-Artefakte (sieht
Bytes anders als der Cell-Shader). **Lösung:** Direkt
`readRenderTargetPixels(cubeRT, px, py, 1, 1, buf, faceIndex)` —
kein Shader, keine Encoding-Pipeline, raw GPU-Bytes wie auf der
Cube-Face liegen.

Face-Index aus Richtung berechnen (GL cube map convention):
```ts
const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
let face: number, sc: number, tc: number, ma: number;
if (ax >= ay && ax >= az) {
  face = d.x >= 0 ? 0 : 1;
  sc = d.x >= 0 ? -d.z : d.z;
  tc = -d.y; ma = ax;
} else if (ay >= az) {
  face = d.y >= 0 ? 2 : 3;
  sc = d.x;
  tc = d.y >= 0 ? d.z : -d.z; ma = ay;
} else {
  face = d.z >= 0 ? 4 : 5;
  sc = d.z >= 0 ? d.x : -d.x;
  tc = -d.y; ma = az;
}
const s = (sc / ma + 1) * 0.5;
const t = (tc / ma + 1) * 0.5;
const px = Math.floor(s * size);
const py = size - 1 - Math.floor(t * size);    // readPixels y=bottom, face t=top
```

### 9. Multi-Viz Konflikt (Build-Preview + Tower-Selection gleichzeitig)

Wenn der Spieler einen platzierten Tower selected hat UND in Build-Mode
einen neuen Tower platziert, existieren ZWEI LOS-Vizes im Scene
gleichzeitig. **Beide teilen sich denselben `TowerShadowMapper`.** Bei
jedem Mouse-Move im Build-Mode wird der Cube für die Build-Preview-Position
neu gerendert — das macht das selected-Tower-Viz stale (sampled jetzt aus
einer Cube die für einen anderen Tip gerendert wurde).

Ungelöst — Optionen:
- A) **Mutex:** Build-Mode disposed alle Selection-Vizes. Selection-Mode
  disposed Build-Preview.
- B) **Separate Mapper:** Jede Viz bekommt einen eigenen `TowerShadowMapper`
  (Memory-Trade-off, 6 MB pro Mapper).
- C) **Cube-State-Tracking:** Cube-render-Position trackt welche Viz sie
  besitzt; Konflikt-Resolution per Priorität.

### 10. Multiple `[CellLayer]` Rebuilds pro Mouse-Move

Build-Preview rebuilt den Cell-Layer bei jeder validierten Cursor-Bewegung
(keine Debounce, "instant feedback"). Das ist Designed-So aus Phase 5,
aber im Selection-Mode sollte das NIE passieren (Tower steht fest). Wenn
trotzdem Rebuilds passieren → ein selection-Mode-Trigger feuert wo er
nicht soll. Im Code prüfen: was triggert `globalRouteGrid.showTowerViz`?
Reagiert es z.B. auf Tile-Streaming-Events? Falls ja: gate auf "position
hat sich nicht geändert".

## Status der Air-LOS-Korrektheit (BUG, 2026-05-13)

Ground-LOS produziert in der Praxis sinnvolle Ergebnisse — Cells hinter
Gebäuden sind blockiert, Cells auf offener Straße sind frei.

Air-LOS produziert Phantom-Blocker an Stellen wo **real keine Geometrie
zwischen Tower-Tip und Air-Sample steht** (User-bestätigt). Das ist kein
geometrisches Wahrnehmungsproblem — die Sicht ist im 3D-Tiles-View
offensichtlich frei, das Cube meldet trotzdem einen nahen Blocker.

**Reproduktion am Beispiel:**
- Tower-1 (Rocket) auf Gebäudedach in einer Wohngebiet-Szene
- Cell (21, 105) NE des Towers, 33-34 m horizontal entfernt
- Tower-Tip y ≈ 240.5, Air-Sample y = 246.2 (cell.terrainHeight=231.2 + 15)
- Direction (0.34, 0.16, 0.93) → +Z Cube-Face Pixel (348, 294)
- Probe-Bytes nach allen Fixes: `[80, 246, 10, 0]` → depth ≈ 0.0001
  (unter Safeguard → 1.0, sollte cyan sein)
- Cell-Shader rendert die Cell trotzdem als rot+Punkt
- Probe (via `readRenderTargetPixels`) und Cell-Shader (via `textureCube`)
  greifen auf dasselbe Texture-UUID + dieselbe Direction zu — sollten
  identisch sein, sind es aber bei manchen Cells nicht.

**Was funktionsmässig schon eliminiert ist (Bytes-Analyse):**
- Bilinear-Filtering (NearestFilter aktiv)
- sRGB-Encoding (NoColorSpace aktiv)
- Renderer-Clear-Color leakage (setClearColor=(0,0,0,0) während Cube-Render)
- TilesFadePlugin-Material-Mutation (onBeforeRender=noop während Render)
- BatchedMesh ohne Transform (batching_vertex chunk aktiv)
- Probe vs Cell-Shader Reference-Mismatch (beide nutzen `getReferencePos()`)

**Verbleibende Hypothesen (für nächste Session):**

1. **Sekundärer `FadeBatchedMesh` des TilesFadePlugin** wird im Cube-Render
   nicht erfasst oder hat eine andere Batching-Texture-Convention. Liegt
   irgendwo als Object3D im Scene, möglicherweise innerhalb tilesGroup,
   möglicherweise daneben. → Inspizieren in DevTools: `scene.traverse`,
   typeof prüfen. Wenn als Mesh erkannt, prüfen ob die Batching-Texture
   denselben Layout hat wie die primäre.

2. **3D-Tiles Tile-LOD-Wechsel während Cube-Render** — ein Tile lädt
   während des Renders um, die alte LOD-Geometrie wird teilweise gerendert,
   die neue noch nicht. Resultiert in Phantom-Geometrie aus übergangs-LOD.
   → Test: Tower fix lassen, mehrere Sekunden warten bis Tiles stabil,
   dann erst Cube rendern. Bug verschwunden?

3. **WebGL2 vs WebGL1 Cube-Sampling-Konvention** — Three.js auto-konvertiert
   `textureCube` zu `texture` in ES3, aber das könnte für CubeRenderTarget
   eine subtile Konvention-Differenz haben. → Test: probe-Shader und
   Cell-Shader gegen die SELBE FACE+UV direkt vergleichen, nicht über
   direction-to-face Lookup.

4. **Lookup-Direction vs Stored-Convention für CubeRenderTarget** — wenn
   CubeCamera die 6 Faces nicht in WebGL-Convention schreibt, sondern in
   Three.js-Convention (mit oder ohne `coordinateSystem`-Flag), und mein
   Probe in WebGL-Convention liest, könnte ein face- oder achsen-Mismatch
   entstehen. → Test: alle 6 Faces vollständig zu einer 2D-Atlas-Textur
   rendern (z.B. 3072×512), visuell inspizieren ob das was erwartet wird.

5. **Half-pixel-Offset zwischen Probe `Math.floor(s*size)` und GPU-Sampler**.
   Bei NearestFilter rundet die GPU technisch zu `floor(u*size)` für
   `u=s*size + 0.5` — bei Sub-Pixel-Genauigkeit an Kanten landet das
   anders als JS-`Math.floor`. → Test: Probe macht `Math.round(s*size)`
   oder testet beide Nachbar-Pixel.

**User-Anforderung:** Physikalisch korrekt. Tower darf nicht durch
Geometrie schießen, muss aber alles in echter Sicht treffen. Das Air-LOS
soll dasselbe Verhalten wie Ground-LOS zeigen — letzteres funktioniert
bereits. Daher: keine semantische Air-Höhen-Verschiebung als Workaround,
sondern den Sampling-Bug finden.

## Verwertbarer Code aus diesem Branch

User-bestätigte Wins die im neuen Branch erhalten bleiben sollten:

- **Ground-LOS-Mechanismus komplett** — die GPU-Cubemap-Pipeline für Ground
  funktioniert in der Praxis. Distance-Material, Cube-Render-Gating,
  Cell-Shader-Sample-Logik mit `if (depth < 0.001) depth = 1.0` Safeguard,
  Visibility-Bias 0.5 m. Alles unter den Lessons 1-8 ist hierfür kritisch.
- **4-State-Cell-Coloring mit Dots als Indikator** — Cells mit unterschiedlichen
  Farben für `both / groundOnly / airOnly / neither` und einem zentrischen
  schwarzen Dot, wenn ein REALER Blocker (depth < 0.99) die Sichtbarkeit
  killt. Differenziert "blockiert durch Range-Math" (kein Dot) von
  "blockiert durch echte Geometrie" (mit Dot). Konfiguration in
  `LOS_VIZ_CONFIG.states`.
- **Farb-Legende am Bildschirmrand** — `los-legend.component.ts` zeigt die
  Cell-Color-Bedeutung permanent an, kein Rätselraten. Mit Pulse-Animation
  beibehalten.

Files die die obigen Lessons konkret implementieren — beim Neuanfang als
Code-Vorlage anschauen, NICHT direkt cherry-picken:

| Datei | Was steht drin | Lessons darin |
|---|---|---|
| `src/app/three-engine/tower-shadow-mapper.ts` | Cube-Camera-Setup, Distance-Material, Update-Gating, mesh.material+onBeforeRender Swap, ClearColor save/restore | 1-8 |
| `src/app/utils/tower-los-viz.ts` | Wrapper-Klasse für Cell-Layer + Cube-Update | -- |
| `src/app/utils/tower-los-layer-builder.ts` | Cell-Shader (sampleVisible mit Safeguard `depth < 0.001 → 1.0`, 4-State-Mix, Real-Blocker-Dot) | Probe-Match |
| `src/app/components/los-legend/los-legend.component.ts` | Color-Legende am Screen-Bottom | UX |
| `src/app/configs/los-viz.config.ts` | Alle Optik-Konstanten (cube size, near, falloffs, minBlockerDistance, airSampleYOffset, 4-State-Palette) | -- |
| `src/app/configs/tower-types.config.ts` | `airRangeMultiplier` Feld pro Tower-Type | -- |
| `src/app/entities/tower-targeting.util.ts` | `canTargetAirEffective` / `getAirRangeMultiplierEffective` (AA-Retrofit-Research-Gate) | -- |
| `src/app/utils/global-route-grid.ts` | `getAirTargetY(cell)` als Single-Source-of-Truth für Air-Altitude | -- |
| `src/app/services/tower-placement.service.ts` | `updateLosDebugForSelectedTower` mit Hover-Debug (Linie, Marker, Cube-Probe) | 7, 8 |

## Konkrete Gotchas-Checkliste v2 (PFLICHT vor jedem neuen Branch-Start)

Phase 1-6 vom alten Plan zuerst implementieren, dann diese **zusätzlich**
auf der Distance-Material-Seite:

- [ ] `<batching_pars_vertex>` + `<batching_vertex>` im Vertex-Shader (Lesson 1)
- [ ] Reihenfolge im Vertex: `<batching_vertex>` zuerst, dann
  `localPos = batchingMatrix * localPos` unter `#ifdef USE_BATCHING`,
  dann instanceMatrix unter `#ifdef USE_INSTANCING`
- [ ] Pro Cube-Render: tilesGroup-traverse → `m.material = distanceMaterial;
  m.onBeforeRender = noop;` + Backup/Restore (Lesson 2)
- [ ] Distance-Material State hart-reset jeden Render: `transparent=false,
  opacity=1, depthWrite/depthTest=true, needsUpdate=true` (Lesson 2)
- [ ] `WebGLCubeRenderTarget`: `minFilter/magFilter: NearestFilter` (Lesson 3)
- [ ] `WebGLCubeRenderTarget`: `colorSpace: NoColorSpace` (Lesson 4)
- [ ] Save/restore `renderer.clearColor` zu `(0x000000, 0)` um Cube-Render
  (Lesson 5)
- [ ] `includeOnly: tilesGroup` Pattern für Visibility-Toggle (Lesson 6)
- [ ] Debug-Probes nutzen `shadowMapper.getReferencePos()`, NICHT die
  Tower-Entity-Position (Lesson 7)
- [ ] Debug-Probes via `readRenderTargetPixels(cubeRT, px, py, 1, 1, buf,
  faceIndex)` (Lesson 8)
- [ ] Build-Preview und Selection-Viz EXKLUSIV: nur eine zur Zeit aktiv
  (Lesson 9)
- [ ] `showTowerViz` nicht auf Tile-Streaming-Events neu triggern (Lesson 10)

**Air-LOS-Korrektheit:** offen — Option 1/2/3 oben mit dem User klären
BEVOR die Air-Pipeline implementiert wird.

---

# Lessons Learned v3 (Implementation, 2026-05-13)

Diese Sektion dokumentiert was beim dritten Versuch (`feat/route-grid-gpu-los-v3`)
gelernt wurde. Phase 2-7 sind in einem konsolidierten Commit (`c5d27eb`)
umgesetzt; Performance-Optimierung in einem Follow-up-Commit (`b47bff2`).
Ground-LOS läuft sauber bei 144 Hz auch unter aggressivem Drag. Air-LOS-Bug
aus v2 wurde explizit auf eine eigene Research-Session vertagt (User-Direktive).

## v3-Stand bei Session-Ende

**Was funktioniert:**
- Build-Preview mit instantem Cell-Set-Refresh ohne Debounce, smooth bei 144 FPS.
- Tower-Selection-Viz mit derselben Pipeline, automatisch bei Selection-Wechsel
  neu gebaut, beim Deselect / Sell disposed.
- Globales Debug-Cell-Grid mit derselben Farbpalette und 4-State-Logik
  (`groundOnly / airOnly / both / uncovered`) plus Enemy-Overlay-States
  (`enemyInCell / enemyVisible`).
- Color-Legende am Bildschirmrand während Build-Preview UND Tower-Selection,
  best-to-worst-Reihenfolge, Capability-gated (nur relevante States werden
  angezeigt).
- Per-Frame-CPU-Budget unter Heavy Drag: ~50 ms/s (≈ 5% eines Cores).

**Was offen ist:**
- Air-LOS-Phantom-Blocker-Bug aus v2 ist NICHT angegangen. Cells in der
  Cubemap des Towers können bei Air-Sample-Punkten weiterhin falsche
  Distanzen liefern. Mit AA-Retrofit-Research aktiv → Mixed Tower
  (Dual-Gatling, Archer) zeigen Cells unzuverlässig im "Air" / "Both"-State.
- `airRangeMultiplier` ist NICHT in `TowerConfig`. Aktueller Workaround:
  `airRange = groundRange` als Platzhalter. Sobald Air-Pipeline produktionsreif
  ist, Multiplier-Feld einführen (1.5× für Pure-Air-Tower, 1.2× für Mixed).
- Real-Blocker-Dot (schwarzer Punkt im Cell-Zentrum) ist im Shader auskommentiert,
  nicht ganz entfernt — User hat angedeutet, das später vielleicht wieder
  einzuführen für ausgewählte States nach Air-Fix.
- Cubemap-First-Call hat Shader-Compile-Spike von ~14 ms. Pre-Warm bei
  Engine-Init mit Dummy-Tip wäre möglich, aber unnötig (einmalig, beim ersten
  Build-Mode-Eintritt).

## Hart erkaufte Erkenntnisse

### 1. Single Source of Truth für die Cell-Palette

Der User hat explizit gefordert dass Build-Preview, Selection-Viz UND globales
Debug-Grid **dieselbe** Farbpalette verwenden. Implementation:

- `src/app/configs/los-viz.config.ts` ist die einzige Quelle für alle Farben
  und Alphas. Drei Gruppen:
  - `states` — 4 per-Tower-States (`both`, `groundOnly`, `airOnly`, `neither`)
  - `globalStates` — globale Aggregat-States (`uncovered`, `enemyInCell`,
    `enemyVisible`)
- Per-Tower-Shader (`tower-los-layer-builder.ts`) liest die Farben als
  Uniforms (`uColorBoth`, `uAlphaBoth`, …).
- Globaler Debug-Shader (`global-route-grid.ts`) baut sein Fragment-Shader-
  String zur **Compile-Zeit** aus den gleichen Config-Werten — Template-Literal-
  Interpolation in `buildLosCellFragment()`. Vermeidet Uniform-Overhead für
  Aggregat-Mesh ohne die Single-Source-of-Truth-Garantie zu brechen.

**Wichtige Semantik-Unterscheidung:** Per-Tower-State `neither` (rot, alpha
0.25) heißt "Tower hat diese Cell in Range aber kann sie nicht erreichen
(durch Geometrie blockiert)". Globaler Aggregat-State `uncovered` (grau,
alpha 0.15) heißt "kein einziger Tower hat diese Cell überhaupt in Range".
Das sind verschiedene Konzepte — daher **bewusst** unterschiedliche Farben,
auch wenn die Pipeline gemeinsam ist. **Niemals beide vermischen.**

### 2. Real-Blocker-Dot wegen Air-Bug deaktiviert

Erster Wurf des Cell-Shaders hatte einen schwarzen Punkt im Cell-Zentrum für
"durch Geometrie blockiert" (vs "außerhalb der Reichweite verblasst"). Logik:
wenn `groundBlocker < uFarDistance * 0.99` oder `airBlocker < 0.99 * far` →
Dot. Funktionell korrekt für Ground.

**Problem:** mit dem ungelösten v2-Phantom-Air-Blocker-Bug feuert der Dot auf
jeden Air-Capable Tower IMMER, weil die Air-Sample-Cubemap-Distanz fast immer
unter 99% liegt. Resultat: Cells haben überall einen Dot, der nichts mehr
unterscheidet.

**Fix:** Dot aus dem Shader entfernt + zugehörige Uniforms (`uBlockerDot*`,
`uRealBlockerThreshold`, `uCellHalfWidth`) raus + Legenden-Footer raus + die
Config-Felder gelöscht. Code in den Commit-History (`c5d27eb` → Folge-Edit)
zurückverfolgbar wenn er für die Re-Aktivierung gebraucht wird.

**Was es heißen würde wenn es wieder rein soll:** Per-State-Gating —
Dot nur für **ground-only** oder **neither**, nicht für Air-States. Solange
Air-Bug offen ist, ist das die einzige sinnvolle Variante. **Erst nach
Air-Research-Session** entscheiden.

### 3. Performance: `refineCellsInRadius` ist NICHT cheap

Der Kommentar im Code behauptete "cheap relative to a full grid sweep — only
cells inside the radius are touched". Das stimmt im Vergleich zur globalen
Sweep, aber pro Mouse-Move ist es trotzdem teuer:

```
~500 cells in range × sampleCellY() × ~7 µs raycast = ~60 ms pro Call
× 17 Mouse-Events/s während Drag = ~1000 ms/s CPU
```

**Pitfall in `sampleCellY`:** die Funktion macht den teuren Raycast FIRST
(Zeile 361-368) und checkt DANN auf LOD-Versionierung / Same-Y-Idempotenz.
Stable Cells mit identischem LOD zahlen also den vollen Raycast und kriegen
ihre Schreib-Operation verworfen. Die Idempotenz ist auf Daten-Konsistenz
ausgelegt, NICHT auf Performance.

**Fix:** Neue Methode `promoteUnsampledCellsInRadius` in `GlobalRouteGrid` —
skippt explizit `cell.heightSampled === true`. Stable Cells = O(1) no-op,
nur unsampled Cells zahlen den Raycast. Für die Build-Preview reicht das, weil
Cell-Y sich nicht durch Cursor-Bewegung ändert, sondern nur durch
Tile-Streaming (was über `onTilesLoadEnd` und `setCellsPromotedListener`
ohnehin separat gehandelt wird).

**Lehre für künftige Refactorings:** Wenn ein Hot-Path eine Funktion mit
"cheap" / "idempotent"-Kommentar aufruft, trotzdem profilen. Idempotenz
heißt nicht "schnell", sondern nur "darf mehrfach laufen ohne Schaden".

### 4. DevWorld-Blocker-Group muss ein direkter Scene-Child sein

Der `TowerShadowMapper` versteckt für jeden Cube-Render alle Scene-Children
außer dem `includeOnly`-Argument (Lesson 8). Wenn `includeOnly` ein **nested**
Child ist (z.B. `terrainGroup` innerhalb von `devWorldGroup`), dann wird
sein Parent (`devWorldGroup`) versteckt → der nested Child verschwindet
mit. → Cube rendert in eine leere Szene.

**Fix:** In DevWorld-Mode gibt `engine.getLosBlockerGroup()` den `devWorldGroup`
zurück (direkter Scene-Child), nicht den nested `terrainGroup` aus dem
`DevTerrainProvider`. Im Normal-Mode bleibt `tilesRenderer.group` korrekt
(ist direkter Scene-Child).

### 5. `canTargetGround` defaultet auf `true` — `?? true` nicht `?? false`

In `TowerConfig` ist `canTargetGround?: boolean` optional mit semantischem
Default `true` (siehe Archer-Config: nur `canTargetAir: true` gesetzt, kein
`canTargetGround`-Eintrag — Archer kann trotzdem Ground treffen).

**Pitfall:** Die LOS-Legend-Component hat initial `?? false` benutzt → Archer
zeigte nur "Air", kein "Ground" in der Legende.

**Fix:** Überall wo `TOWER_TYPES[id].canTargetGround` gelesen wird ohne
explizite Tower-Instanz: `?? true`. Hartcodierte Konvention im gesamten
Codebase.

### 6. Build-Preview ↔ Selection-Mutex schon vorhanden

Lesson 9 aus v2: "Build-Preview und Selection-Viz dürfen nicht gleichzeitig
leben sonst Cubemap-Konflikt." → Keine neue Wiring nötig: `selectTowerType`
ruft bereits `selectTower(null)` vor Build-Mode-Aktivierung. Der umgekehrte
Pfad (Tower selektieren während Build-Mode) ist im aktuellen UI-Flow durch
den Click-Handler ausgeschlossen (Click in Build-Mode = Place, nicht
Select).

**Bei künftigen UI-Änderungen darauf achten:** wenn ein neuer Click-Pfad
beide gleichzeitig aktiv haben könnte, explizit eine Mutex einführen.

### 7. Cell-Mesh-Build ist billig genug für Per-Move-Rebuild

500 Cells × InstancedMesh-Allocation + ShaderMaterial-Compile = ~0.1 ms.
Geprüft via `los-perf.ts`. Mesh-Pooling (Reuse einer Max-Capacity-Mesh mit
dynamischem Count) wäre Engineering-Overhead ohne messbaren Win. Material-
Compile passiert einmal per Build-Mode-Eintritt, danach gecacht.

### 8. Cubemap-GPU-Budget bei 512² ist trivial

Ein Cube-Render (6 Faces × ~150 Tiles) braucht ~0.7-1.0 ms GPU-Zeit. 50
Renders/s während Heavy Drag = 50 ms/s = ~5% Frame-Budget bei 144 Hz. Wir
brauchen weder 256² noch async-face-rendering noch Layer-Filter. Die
Material-Swap-Traversierung über 150 Meshes kostet ~0.08 ms pro Render —
nicht messbar.

**Falls in einer komplexeren Szene (deutlich >300 Tiles) doch zu langsam:**
Layer-System ist die saubere Lösung (Tiles auf Layer X, Cube-Camera rendert
nur Layer X). Erspart die material-swap-Choreographie komplett. Aktuell
nicht nötig.

### 9. Cubemap-First-Call hat einen ~14 ms Compile-Spike

Erstes `cubeCamera.update()` triggert Shader-Compile des Distance-Materials
plus die Tile-Shader-Compile mit dem neuen Material-Override. Danach
~1 ms/Call. Einmaliger Effekt beim ersten Build-Mode-Eintritt oder ersten
Tower-Select. **Mitigation möglich:** Pre-Warm in `EngineInit` durch einen
Dummy-`mapper.update(origin, 1, tilesGroup)`-Call sobald Tiles initial
geladen sind. **Aktuell nicht umgesetzt** — User hat keine Beschwerde
darüber geäußert, der Spike ist visuell kaum wahrnehmbar (einmaliger
17-ms-Frame statt 7-ms-Frame).

### 10. Profiler-Infrastructure als permanentes Werkzeug

`src/app/utils/los-perf.ts` ist ein leichtgewichtiger Phase-Profiler:

```typescript
import { losPerf } from './los-perf';
losPerf.sample('mesh/build', performance.now() - t0, cells.length);
```

Aggregiert über ein 1-Sekunden-Fenster, loggt sortiert nach dominantester
Phase in die Console. Default **off** (Overhead = 1 Boolean-Vergleich pro
Call). DevTools-Toggle:

```javascript
losPerfEnable()   // aktivieren
losPerfDisable()  // deaktivieren
```

Instrumentierte Phasen: `cube/total`, `cube/render`, `cube/traverse`,
`cube/restore`, `mesh/build`, `preview/promote`, `preview/getCells`,
`preview/tip-only`. Stehen lassen für künftige Performance-Untersuchungen,
nicht entfernen.

## Architektur-Update v3

```
Scene
├── tilesRenderer.group       (oder devWorldGroup im DevWorld-Mode)
│     └── { Tile-Meshes, BatchedMesh }
│
├── overlayGroup              (Streets, Routes, Markers)
│
├── TowerLosViz.group         (Build-Preview ODER Selection — exclusive)
│     └── InstancedMesh       (4-State 4-color cells)
│            ↑ samples uCubeMap (shared via TowerShadowMapper)
│
└── globalRouteGrid.visualization  (Debug-Aggregat, eigene Palette)
       └── InstancedMesh      (6-State: 4 LOS + 2 enemy)

TowerShadowMapper             (singleton in ThreeTilesEngine)
├── WebGLCubeRenderTarget     (512² × 6 faces, NearestFilter, NoColorSpace)
├── CubeCamera                (90° FOV per face, far = tower range)
└── distanceMaterial          (packDepthToRGBA, USE_BATCHING + USE_INSTANCING)

Render-Flow pro update():
  1. Hide all scene children except `includeOnly`
  2. Traverse `includeOnly`: swap material → distanceMaterial,
     swap onBeforeRender → noop, push to backup
  3. Save ClearColor, set to (0,0,0,0)
  4. cubeCamera.update(renderer, scene)
  5. Restore ClearColor, materials, onBeforeRender, visibility
```

**Owner-Map:**
| Komponente | Owner | Lebenszeit |
|---|---|---|
| TowerShadowMapper | `ThreeTilesEngine` (lazy) | Engine-Lifetime |
| Build-Preview TowerLosViz | `TowerPlacementService` | aktives Build-Mode |
| Selection TowerLosViz | `TowerManager` | aktive Tower-Selektion |
| Debug-Aggregat-Mesh | `GlobalRouteGrid` | wenn Display-Option an |
| Cell-Visibility-Maps | `RouteCell` (in `GlobalRouteGrid.cells`) | Game-Lifetime |

**Daten-Flüsse bei Tower-Build:**
1. `gameState.commands.placeTower` → `TowerManager.placeTower` → Tower-Entity
2. `TowerPlacementService.registerTowerOnGrid(tower, …)`:
   a. `globalRouteGrid.refineCellsInRadius` (one-shot, OK)
   b. `globalRouteGrid.registerTower` (synchroner CPU-Raycast-Pass, Variant A)
      → schreibt `cell.towerVisibility.set(towerId, vis)` und
        `cell.airVisibility.set(towerId, vis)`
   c. `tower.losReady = true`, `tower.visibleCells = visibleCells`
   d. Falls Tower selected: `towerManager.refreshSelectionViz(tower)`

**Daten-Fluss bei Range-Upgrade:**
1. Tower-combat.range geändert
2. `TowerPlacementService.recomputeTowerLOS(tower)`:
   a. `globalRouteGrid.registerTowerIncremental` (raycast nur neue Cells im
      Annulus, gecachte Cells behalten visibility)
   b. Falls selected: `towerManager.refreshSelectionViz(tower)`

**Daten-Fluss bei Tile-Streaming:**
1. `tilesRenderer.tiles-load-end` → `engine.onTilesLoadEnd`
2. `towerShadowMapper.invalidate()` → nächster cube-render wird forced
3. (existing) `globalRouteGrid.retryUnsampledCells` promotet ggf. Cells
4. (existing) `setCellsPromotedListener` → `recomputeTowerLOS` für betroffene
   Tower

## Welche Phasen-Plan-Beschreibungen oben sind veraltet

Die ursprüngliche Phase-9-Vision (Volumen-3D, Holo-Effekte, Activation-Wave)
ist gestrichen. User-Wunsch: **subtile** Optik (flache 2cm-Plates, sanfter
Pulse, ~0.45 Alpha). Falls jemand in Zukunft Holo-Effekte willl: aus v1-Branch
(`feat/route-grid-gpu-los`) portierbar.

Die ursprüngliche Phase-8 (GPU-Aggregat über alle Tower-Cubemaps) ist nicht
umgesetzt — der bestehende globale Shader plus Palette-Sync war einfacher
und ausreichend.

## Was definitiv NICHT mehr in den Branch gehört

- **Real-Blocker-Dot ohne Per-State-Gating** — siehe Lesson v3 §2. Wenn er
  zurückkommt, dann nur für `groundOnly` / `neither`, nicht für Air-States,
  bis der Air-Bug gelöst ist.
- **`refineCellsInRadius` pro Mouse-Move** — siehe Lesson v3 §3. Wer das
  wieder einbaut, lest den Profile-Output unten.
- **`losPreviewMesh` / `losPreviewBuilding` / progressive Pfad** — komplett
  ersetzt durch `TowerLosViz` (single-instance per Owner).
- **Per-tower-Viz-State im `GlobalRouteGridService`** (`currentTowerVizMesh`,
  `showTowerViz`, `clearTowerViz`) — gelöscht. Owner ist jetzt
  `TowerManager.selectionViz`.

## Verwertbarer v3-Code (Stand 2026-05-13)

| Datei | Verantwortung |
|---|---|
| `src/app/configs/los-viz.config.ts` | Single source of truth: cube size, threshold, sample offsets, alle Farben + Alphas |
| `src/app/three-engine/tower-shadow-mapper.ts` | Cube-Render-Engine mit Mesh-Material-Swap + Move-Gate + invalidate() |
| `src/app/utils/tower-los-layer-builder.ts` | Statische `build()`-Methode → InstancedMesh + 4-State-Shader |
| `src/app/utils/tower-los-viz.ts` | Composite: Mapper + LayerBuilder, addTo/dispose/tick API |
| `src/app/utils/global-route-grid.ts` | RouteCell-Daten + Aggregat-Viz + `promoteUnsampledCellsInRadius` + `getCellsInRange` + `getCellSize` |
| `src/app/services/world/global-route-grid.service.ts` | Angular-Wrapper, exposed nur was außen benötigt wird |
| `src/app/services/tower-placement.service.ts` | Build-Preview-Owner, `registerTowerOnGrid` synchron, `tickBuildPreviewViz` |
| `src/app/managers/tower.manager.ts` | Selection-Viz-Owner, `refreshSelectionViz`, `onTowerUnregistered`, `tickSelectionViz` |
| `src/app/components/los-legend/los-legend.component.ts` | Capability-gated Legende, best-to-worst, kompakt nur Swatch + Label |
| `src/app/utils/los-perf.ts` | Phase-Profiler, default off, DevTools-Toggle |

## Wenn ein Neustart (v4) nötig wird

Wenn der Air-LOS-Bug v3 grundlegend zerstört, oder das Layer-System sich
nachträglich als zwingend erweist:

1. **v3 nicht verwerfen** — die Architektur ist tragfähig. Nur das Air-
   Sampling muss anders sein.
2. Air-Hypothesen-Sektion oben (v2 Section §5) systematisch abarbeiten —
   das ist die Forschungsarbeit für die nächste Session.
3. `airRangeMultiplier` Feld in `TowerConfig` einführen sobald Air
   sinnvoll separate Reichweite haben darf.
4. Falls Real-Blocker-Dot wiederkommt: per Capability gaten (`groundOnly`-
   Dot okay, `airOnly`-Dot erst wenn Air zuverlässig).

## v3 Gotchas-Checkliste (vor jedem Touch der LOS-Pipeline)

- [ ] Palette ändern? Nur in `LOS_VIZ_CONFIG`, nirgendwo anders.
- [ ] Cubemap-Sample-Funktion ergänzt/geändert? Auch im globalen Shader
  (oder über Config-Werte). Single Source of Truth.
- [ ] Pro Mouse-Move-Pfad einen neuen Call hinzugefügt? Profilen mit
  `losPerfEnable()` vor Commit, sicherstellen dass Total <50 ms/s bleibt.
- [ ] Neuen Cell-Visibility-Pfad? Sicherstellen dass die Owner-Map oben
  konsistent bleibt — niemand außer dem Owner darf `dispose` rufen.
- [ ] DevWorld-Pfad gleichzeitig getestet? `getLosBlockerGroup()` muss
  immer einen direkten Scene-Child liefern.
- [ ] Tile-Streaming-Path beachtet? `mapper.invalidate()` muss bei allen
  Events feuern die Tile-Geometrie ändern können.

---

# Air-Research-Session Infrastruktur (2026-05-13)

Vor Beginn der eigentlichen Air-Bug-Hunt wurde die Debug-Infrastruktur
aufgebaut. Die unten genannten Toggles und Filter bleiben dauerhaft im
Production-Code als Debug-Helfer. Wenn die Air-LOS-Pipeline produktions-
reif ist, kommt zusätzlich ein vereinheitlichtes "Combined View"-Display;
das hier dokumentierte Debug-System bleibt parallel verfügbar.

## Universelle Cell-Palette (Single Source of Truth)

Eine Farbe = eine Bedeutung über ALLE Modi (per-Tower-Viz, globale
Aggregate, Legend). Definiert in `LOS_VIZ_CONFIG.states` +
`globalStates`:

| Farbe | Bedeutung |
|---|---|
| 🟡 Gold | Ground UND Air covered |
| 🟢 Grün | Ground covered |
| 🔵 Blau | Air covered (war v2 cyan — auf Blau umgestellt) |
| ⬜ Grau | Uncovered (kein Tower covered) |
| 🔴 Rot | (Per-Tower only) in Range aber blockiert |

**Regel:** Keine Farbe darf in einem anderen Modus eine andere Bedeutung
haben. Bei neuen Features die Cells einfärben: erst LOS_VIZ_CONFIG prüfen
ob die Farbe semantisch passt, sonst NEUE Farbe einführen — niemals eine
bestehende umwidmen.

## Vier Layer-Toggles + ein Filter (Quick-Actions Layer-Menu)

| Icon | UIStore-Signal | Toggle-Methode | Was es zeigt |
|---|---|---|---|
| `chart` | `routesVisible` | `pathRoute.toggleRouteLinesVisibility` | Ground-Route — 2px Line2 entlang Polyline |
| `wind` | `airRouteVisible` | `globalRouteGridService.toggleAirRouteLayer` | Air-Route-Tube (magenta dashed, +15m) |
| `grid` | `spatialGridDebugVisible` | `globalRouteGridService.toggleSpatialGridDebug` | Ground-Cells aggregate (alle Cells am Boden) |
| `gridAir` | `airSpatialGridDebugVisible` | `globalRouteGridService.toggleAirSpatialGridDebug` | Air-Cells aggregate (alle Cells +15m) |
| dynamisch | `perTowerLosFilter` | `uiStore.cyclePerTowerLosFilter` | Per-Tower-Filter Cycle: Both/Ground/Air |

Per-Tower-Filter-Button: Icon ändert sich je State (`layers` / `grid` /
`gridAir`), Tooltip zeigt aktuellen + nächsten Mode. State persistent.

## Per-Tower-Filter Implementation

`UIStore.perTowerLosFilter: 'both' | 'ground' | 'air'`. Bridge zur
non-Angular `TowerManager` läuft über `GameLoopFacade` per `effect()`
das `towerManager.applyLosFilter(mode)` aufruft. Build-Preview-Owner
(`TowerPlacementService`) hat sein eigenes `effect()` — kein Owner
abhängig von einem anderen.

`TowerLosViz.setFilterMode(mode)` setzt zwei Dinge in Lockstep:
1. Shader-Uniform `uFilterMode` (0=both / 1=ground / 2=air) — der
   Fragment-Shader entscheidet 4-state vs. 2-state-Reduktion
2. `groundMesh.visible` / `airMesh.visible` — die irrelevante Mesh wird
   gehidet (spart Draw-Call, fokussiert die 3D-Stack visuell)

**Wichtig:** Initial-Apply nach `new TowerLosViz` ist explizit nötig.
Der reagierende Effect feuert nur bei Signal-Änderungen, nicht bei
Viz-Re-Construction. Siehe `tower-placement.service.ts:registerLosPreview`
und `tower.manager.ts:applyLosFilter`.

## Air-Cells Aggregate Viz (gridAir)

Zweite InstancedMesh in `GlobalRouteGrid.createAirVisualization()`,
parallel zur `createVisualization()` (Ground-Layer). **Geteiltes
`aCellState`-Buffer** zwischen beiden Meshes — Single-Source-of-Truth-
Update, ein `updateVisualization()`-Call refresht beide Layer simultan.

Layer-spezifische Interpretation derselben State-Codes (0..5) im
Fragment-Shader-Build (`buildLosCellFragment({ airLayer: boolean })`):

```
                Ground-Layer    Air-Layer
state 0 (none)  → grau          → grau
state 1 (g.only)→ grün          → grau   (kein Air-Coverage)
state 2 (a.only)→ grau          → blau
state 3 (both)  → gold          → gold
state 4 (eIC)   → grau          → grau
state 5 (eVis)  → gold          → gold
```

Keine neuen Farben — nur Re-Routing pro Layer welcher State welche
Palette-Farbe bekommt.

## Air-Route-Tube (Quick-Actions Toggle)

`src/app/utils/route-altitude-tubes.ts` — Polyline aus Unit-Cylinder-
Segmenten entlang der Enemy-Routen auf `getAirTargetY(cell) =
cell.terrainHeight + airSampleYOffset (15m)`. Terrain-adaptiv: jeder
Polyline-Sample greift die Cell unter dem Waypoint.

Material: ShaderMaterial mit per-Instance `aSegLength` für längen-
korrekte Dash-Modulation in World-Meter (nicht UV). Farbe `0xff00aa`
magenta, `depthTest:false`, `renderOrder=5`.

Bewusst farblich von der Cell-Palette getrennt (Magenta ≠ Blau) damit
"Route-Mittellinie" vs. "Cell-Coverage" sofort visuell unterscheidbar
sind.

## getAirTargetY Helper

`src/app/utils/global-route-grid.ts` exportiert
`getAirTargetY(cell: RouteCell): number`. Single-Source-of-Truth für
die Air-Sample-Y. Bisherige Inline-Formel
`cell.terrainHeight + LOS_VIZ_CONFIG.airSampleYOffset` an drei Call-
Sites ersetzt. Bei Änderungen der Air-Altitude **nur diesen Helper
ändern** — der Tower-Los-Layer-Builder und die Tube müssen synchron
bleiben.

## cachedRoutes auf GlobalRouteGrid

`GlobalRouteGrid.cachedRoutes` / `getCachedRoutes()` — die letzte
Route-Polyline-Liste die `generateFromRoutes()` gesehen hat. Wird vom
Air-Route-Tube-Builder genutzt. Bei Route-Regeneration triggert die
Service-Wrapper-Schicht `rebuildAirRouteLayer()` automatisch.

## 5 Hypothesen-Status nach Research-Session

Parallel-Agenten haben die Hypothesen aus dem v2-Handover §5
(Lines 737-769) durchgeprüft:

| Hyp | Likelihood | Status | Notiz |
|---|---|---|---|
| H1 FadeBatchedMesh | 2/10 | **OUT** | `BatchedTilesPlugin` ist gar nicht registriert → kein FadeBatchedMesh-Sibling |
| H2 LOD-Wechsel literal | 3/10 | OUT | CubeCamera-Loop ist synchron, kein async-Boundary |
| **H2 TilesFadePlugin Variant** | **8/10** | **STRONG LEAD** | Material-Swap umgeht dither-discard → fadende Tiles rendern voll opak in Cube |
| H3 WebGL2 textureCube | 2/10 | OUT | Three.js r182 source: `#define textureCube texture` API-identisch |
| H4 Face/Axis-Convention | 3/10 | OUT | v2-Probe-Formel matched Khronos-Spec exakt für alle 6 Faces |
| H5 Half-Pixel-Offset isolated | 3/10 | OUT | Isolierte sub-pixel-Edge-Case unwahrscheinlich deterministisch |
| **H5 y-flip im v2-Probe** | **8/10 für v2-Debug-Output** | Separater Bug | `py = size - 1 - floor(t*size)` ist falsch für CubeFace-Reads — erklärt v2-Probe-Bytes-Inkonsistenz, **NICHT** den eigentlichen Air-Bug |

**Nächste Test-Schritte (priorisiert):**

1. **H2-Fade-Plugin-Disable-Test:** `TilesFadePlugin` temporär unregistern
   oder per-Frame disablen während `cubeCamera.update()`. Wenn Air-Cells
   dann konsistent rendern → bewiesen. Einfacher One-Liner-Test im Mapper.
2. **Tiles-Stable-Wait-Test:** Tower fix lassen, ≥1s warten bis
   `loadProgress === 1` UND keine pending fades, dann Cube rendern.
   Bug weg → ebenfalls Fade-related.
3. **6-Faces-Atlas-Dump (H4 visuell ausschliessen):** `readRenderTargetPixels`
   für alle 6 Faces in eine 2D-Atlas-Canvas-Texture, als PNG downloaden,
   visuell prüfen. Code-Sketch aus H4-Agent-Report.

## Verwertbarer Code aus Research-Session (Stand 2026-05-13)

| Datei | Was es macht |
|---|---|
| `src/app/utils/route-altitude-tubes.ts` | Air-Route-Tube ShaderMaterial mit dash-modulation, terrain-adaptiv |
| `src/app/utils/global-route-grid.ts:getAirTargetY` | Single source of truth für Air-Sample-Y |
| `src/app/utils/global-route-grid.ts:createAirVisualization` | Air-Cells aggregate mit shared state buffer |
| `src/app/utils/global-route-grid.ts:buildLosCellFragment` | Layer-spezifische State-Interpretation |
| `src/app/utils/tower-los-layer-builder.ts` | uFilterMode-Uniform + 2-state/4-state Coloring-Logik |
| `src/app/utils/tower-los-viz.ts:setFilterMode` | Filter-Mode-Setter, Shader + Mesh-Visibility in Lockstep |
| `src/app/components/los-legend/los-legend.component.ts` | Dynamische Entries je Filter |
| `src/app/configs/los-viz.config.ts:states.airOnly` | Cyan → Blau (universelle Palette) |
| `src/app/configs/los-viz.config.ts:airRouteTube` | Magenta-dashed Tube-Config |
| `src/app/components/icon/icon.component.ts:wind,gridAir` | Neue Icons für Air-Toggles |

## Wenn der Air-Bug gelöst ist

1. **Real-Blocker-Dot** kann per Per-State-Gating wieder rein
   (groundOnly+blocked und neither bekommen Dot; airOnly+blocked nicht).
2. **airRangeMultiplier** in `TowerConfig` einführen (1.5× pure-air,
   1.2× mixed) sobald Air zuverlässig.
3. **Combined Production-View** dazubauen — die Debug-Layer (4 globale
   Toggles + per-Tower-Filter) bleiben in der Codebase, aber das
   Default-UI für Spieler zeigt die unified View.
4. Stripes/Texturen-Differenzierung zwischen Ground und Air Plates ist
   **bewusst NICHT** drin (User-Entscheidung): identische Textur, nur
   die Y-Höhe unterscheidet.
