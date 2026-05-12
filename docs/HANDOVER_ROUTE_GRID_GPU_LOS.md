# Handover: GPU-LOS-Pipeline für das Route-Grid

> **Status:** Branch `feat/route-grid-gpu-los` abgebrochen, neuer Versuch geplant von main aus.
> Dieser Branch bleibt als Referenz erhalten — bitte nicht löschen.
>
> **Datum:** 2026-05-12 · **Dauer des alten Versuchs:** ein Arbeitstag, 14 Commits.

## TL;DR

GPU-Cubemap-basierter LOS-Test für Tower funktioniert grundsätzlich, ist deutlich
schneller als der bisherige 50-Cells-pro-Frame-CPU-Raycast-Batch und löst die
Frame-Drops beim Tower-Placement auf komplexen Karten. Der erste Versuch ist
allerdings im Chaos versandet — drei Visualisierungs-Pfade parallel, Debug-Code
verflochten mit Produktion, Bugfixes übereinander geschichtet ohne klare
Architektur. Neuer Branch von main aus, von Anfang an strikt nach den unten
beschriebenen Prinzipien.

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

- ✅ **Skyline-Cache** (Commit `7b758ee perf(route-grid): cache skyline raycast as single-source-of-truth`).
  Isolierter, kleiner Patch, ~33% weniger Raycasts überall im Grid (nicht nur
  beim Preview). Implementiert `sampleCellSkyline()` als Single-Source-of-Truth
  analog zu `sampleCellY`. Kein Bezug zur GPU-Pipeline.
  **Empfehlung:** Vor dem neuen Branch separat als Commit auf main.
  ```bash
  git checkout main
  git cherry-pick 7b758ee
  ```

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

### Air-Target-Höhe: skyline + 10 m, dynamisch pro Cell

Beim Air-LOS-Test ist das Ziel `cell.skylineHeight + AIR_CLEARANCE_M (10m)` —
nicht eine fixe absolute Höhe. Das modelliert dass fliegende Enemies adaptiv
über lokale Hindernisse steigen.

**Konsequenz:** Bei einer Cell direkt unter einem Hochhaus wird Air-Target =
Dachhöhe + 10 m — sehr hoch. Der Strahl vom Tower-Tip dorthin ist sehr steil
und kann durch andere Gebäude blockiert werden. **Das ist geometrisch
korrekt**, aber visuell überraschend ("warum ist mein Air-Tower hinter einem
Hochhaus blockiert obwohl die Straße offen ist?").

Game-Design-Entscheidung: aktuelles Modell behalten. Falls je geändert: in
`AIR_CLEARANCE_M` (Konstante in `global-route-grid.ts`) zentral verwaltbar.

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

### Air als eigener Layer-Mesh

Statt einem Mesh am Boden, das per Shader-Mix Ground und Air anzeigt:
**zwei separate Meshes**. Ground-Layer-Cells sitzen am Boden (`terrainY +
offset`), Air-Layer-Cells schweben bei `skylineY + 10`. Visuell sieht der
User direkt:
- Türkise Cells am Boden = Ground-LOS frei
- Sky-Blue Cells in der Luft = Air-LOS frei
- Rote Cells am Boden = Ground blockiert
- Lila Cells in der Luft = Air blockiert

Bei einem Mixed-Tower (Ice) sind beide Layer da; bei einem Air-Only (Rocket)
nur Air; bei einem Ground-Only (Cannon, Fire) nur Ground. Das gating ist auf
Mesh-Erzeugungs-Ebene, **nicht** im Shader. Keine `uCanTargetGround`/
`uCanTargetAir`-Uniforms mehr nötig.

Der Cell-Shader wird massiv einfacher: eine Visibility-Berechnung pro Cell,
eine Farb-Logik, kein Drei-States-Mix mehr.

### Phasen-Plan für die Implementation

Reihenfolge, jede Phase als sauberer Commit, kein Debug-Code in
Production-Path:

**Phase 1: Skyline-Cache** (kann auch direkt vor Branch-Erstellung als
separater Commit auf main passieren — Cherry-Pick von `7b758ee`).

**Phase 2: TowerShadowMapper** (clean):
- Eigene Klasse in `src/app/three-engine/tower-shadow-mapper.ts`
- API: `update(towerTip, range, opts?: { excludeFromRender? })`
- Render-Gate >0.5 m Bewegung, Invalidation-Token für Tile-Streaming
- 512² Default, Far = range (kein Padding)
- USE_INSTANCING im Override-Material
- **Keine** Debug-Methoden, **kein** Cursor-Probe-Code
- Instantiiert in `ThreeTilesEngine`, exposed via `getTowerShadowMapper()`

**Phase 3: TowerLosLayerBuilder** + Cell-Shader:
- Eigene Klasse in `src/app/utils/tower-los-layer-builder.ts` (NICHT in
  `global-route-grid.ts` — das Routegrid ist Daten-Modell, nicht Renderer)
- `build(towerX, towerZ, tipY, range, kind, shadowMap, shadowFar): InstancedMesh`
- kind = 'ground' oder 'air'; Y-Position der Cells abhängig vom kind
- Single-Pass-Mesh-Erzeugung, alle Cells in einem Frame, kein progressiver Batch
- Cell-Shader sampled Cubemap einmal pro Fragment, eine Farbe pro Cell

**Phase 4: TowerLosViz-Composite**:
- Wrapper-Klasse, die eine Group mit Ground- und/oder Air-Layer-Mesh erzeugt
- Input: tower-config + position; entscheidet was canTargetGround/Air ist
- Returns: Object3D (die Group)
- Wird von Preview, Selection, Debug-Overlay genutzt

**Phase 5: TowerPlacementService auf neue Pipeline**:
- `createLosPreview` erzeugt TowerLosViz statt direkt Mesh
- Kein 150 ms Debounce mehr (Cubemap-Update ist instant)
- Kein DevWorld-Fallback (DevWorld nutzt auch den Mapper)
- Komplette Entfernung der alten `createPlacementPreview`-Methode

**Phase 6: Per-Tower-Viz auf GPU**:
- `TowerManager.selectTower` → erzeugt TowerLosViz mit Tower-Position
- Cubemap entweder pro Tower cached oder pro Selection neu — Entscheidung nach
  Memory-Test bei N Tower
- Alte `createTowerVisualization`-Methode entfernen

**Phase 7: registerTower auf GPU** (Tower-Build-Resolve):
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

**Phase 8: Debug-Overlay**:
- Entweder kompletter Re-Build auf GPU (Aggregat aller Tower-Cubemaps)
- Oder Debug-Overlay komplett rausnehmen (wird vermutlich selten gebraucht
  wenn alle anderen Wege funktionieren)
- Entscheidung nach Test der Phasen 5-7

**Phase 9 (Optional): Optik-Polish**:
- Volumen-3D, Holo-Shader, Activation-Wave aus altem Branch portieren.
- **Erst wenn alles andere stabil läuft.**

## Konkrete Gotchas-Checkliste für die nächste Session

Beim Start des neuen Branches sofort diese Punkte abhaken:

- [ ] `MeshDistanceMaterial` nicht verwenden — eigenes ShaderMaterial schreiben
- [ ] `USE_INSTANCING` im Vertex-Shader des Distance-Materials honorieren
- [ ] `logdepthbuf_pars_*` Chunks einbinden (Renderer hat `logarithmicDepthBuffer: true`)
- [ ] `WebGLCubeRenderTarget` ohne X-Flip sampeln — `textureCube(map, worldDir)` direkt
- [ ] Beim Cube-Render `overlayGroup` excluden — und `previewTowerMesh` falls separate
- [ ] Far-Distance ohne Padding — `cube.far = range`, decode mit demselben
- [ ] Cube-Resolution 512² (nicht 256²)
- [ ] Range-Falloff im Cell-Shader: **horizontale** Distanz, nicht 3D
- [ ] Air-Target = `cell.skylineHeight + AIR_CLEARANCE_M` (dynamisch pro Cell)
- [ ] Bei jedem Tower-Move: Cube-Render durch `>0.5 m` Bewegung gegated
- [ ] Bei Tile-Streaming: Mapper via `invalidate()` triggern für nächsten Render

## Pfad zum Start des neuen Branches

```bash
# Aktuellen Branch sichern (nicht löschen)
git checkout main

# Skyline-Cache cherry-picken (sauberer Patch)
git cherry-pick 7b758ee

# Neuen Branch erstellen
git checkout -b feat/route-grid-gpu-los-v2

# Loslegen — Phasenplan oben, Phase 2 zuerst (TowerShadowMapper neu)
```

Der alte Branch `feat/route-grid-gpu-los` bleibt als historische Referenz
liegen. Wenn aus einem der späteren Commits (z. B. `de7f2f0` USE_INSTANCING
Fix, `6389aea` overlayGroup-Exclude) konkrete Code-Snippets nützlich sind,
in der neuen Session die Diffs als Vorlage anschauen — aber **nichts** direkt
mergen oder cherry-picken außer dem Skyline-Cache. Den neuen Branch von
Anfang an sauber aufbauen.

## Anhang: Schlüssel-Code-Stellen im alten Branch

Falls die nächste Session Snippets als Vorlage will:

| Datei | Was steht drin | Anmerkung |
|---|---|---|
| `src/app/three-engine/tower-shadow-mapper.ts` | Cube-Camera-Setup, Distance-Shader, Update-Gating | In Commit `6389aea` noch ohne Debug; finale Version stark mit Debug überlagert |
| `src/app/utils/global-route-grid.ts` (Lines ~309-577) | Cell-Shader (Cubemap-Lookup) | Mix aus Ground+Air — beim Neuaufsatz auf Two-Layer trennen |
| `src/app/utils/global-route-grid.ts` (Lines ~2038-2185) | `createPlacementPreviewWithShadowMap` | Single-Pass-Mesh-Erzeugung, in zwei Methoden für Ground/Air splitten |
| `src/app/services/tower-placement.service.ts` (`createLosPreview`) | Caller-Integration | Beim Neubau: Debounce raus, DevWorld-Fallback raus |

## Was *nicht* in den neuen Branch gehört

- Per-Cell-Disagreement-Tint (war nur Debug-Tool für die GPU-vs-Legacy-Phase —
  ohne Legacy gibt's nichts zu vergleichen)
- LOS-Ray-Probes mit Sphären und Boxen (Debug-only)
- Heatmap-Debug-Sphere (Debug-only)
- Cursor-Probe (war degenerate weil im Build-Mode der Cursor schon der
  Tower-Tip ist)
- Tower-Type-spezifische Farben im Cell-Shader (das macht die Two-Layer-
  Aufteilung obsolet — eine Farbe pro Layer reicht)
- 150 ms Debounce vor Preview-Build (nicht mehr nötig wenn Cube-Render <1 ms ist)
