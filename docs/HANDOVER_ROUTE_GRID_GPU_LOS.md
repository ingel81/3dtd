# Handover: GPU-LOS-Pipeline für das Route-Grid

> **Status (2026-05-15):** Ground-LOS UND Air-LOS produktiv und visuell
> verifiziert. Lesson 11 (scene.background / scene.environment save+restore
> während des Cube-Renders) war die fehlende Zutat: Skybox-Texture leakte
> als false-Blocker in jede Cube-Face. War die eigentliche Ursache der
> 2-Tage-Air-Falschspur, sichtbar gemacht durch das neue LOS-Debug-Panel.
>
> Branch: `feat/route-grid-gpu-los-v3` · letzte Sitzung 2026-05-15.
>
> **Seit 2026-09-15 Bericht:** den laufenden Stand beschreibt
> [LOS_PIPELINE.md](LOS_PIPELINE.md).

---

## Laufender Stand

Überblick, Aufbau, Farben der Zellplatten, die Regeln für jeden Eingriff am
Cube (hier früher "Lessons" 1 bis 12), Dateien und Abläufe (Tower bauen,
Upgrade, Luftziele durch Forschung, Tile-Schub, Kampf je Sub-Step) stehen seit
2026-09-15 in [LOS_PIPELINE.md](LOS_PIPELINE.md) und werden dort nachgeführt.
Dieses Handover behält, was nur als Herkunft zählt: die Sackgassen der drei
Anläufe, den Stand der Air-Pipeline vom 2026-05-15, die Diagnose-Werkzeuge
jener Sitzungen und das Muster für eine GPU-Probe.

---
## Die kuratierte Sackgassen-Galerie

> **Diese Lessons stammen aus drei missgelaufenen Anläufen (v1, v2,
> verworfene Session 2026-05-13).** Sie sind hier nur soweit gekürzt
> wie nötig: wer den Branch in ein Jahr nochmal aufmacht, soll
> sehen warum bestimmte Sachen NICHT versucht werden sollten.

### ⚠️ SACKGASSE: drei parallele Viz-Pfade (v1)

Erstes Anlaufversuch hatte Build-Preview, Selection und Debug-
Aggregate als **drei separate Code-Pfade**, jeweils mit eigener Cube-
oder CPU-LOS-Logik. Resultat: jedes neue Feature musste dreimal gebaut
werden, jedes Debug-Tool zeigte für drei verschiedene Daten-Quellen
drei verschiedene Ergebnisse. **Branch versandet im Chaos.** Aktuelle
Architektur konsolidiert auf eine geteilte Mapper-Engine + getrennte
semantische Konsumenten, bewusst KEINE Mesh- oder Shader-Konsolidierung
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
aus dem drei-Optionen-Vergleich A/B/C: Skyline-adaptiv / fest /
Max-of-both). Trade-off: in echten Manhattan-Szenen fliegen Air-
Enemies durch Wände. Bewusst akzeptiert.

`AIR_CLEARANCE_M`, `cell.skylineHeight`, `cell.skylineSampled`,
`sampleCellSkyline` und `getSkylineHeightAtLocal` sind 2026-08-22 mit der
Terrain-Konsolidierung entfernt worden: sie hatten seit Option B keinen
produktiven Leser mehr und kosteten fünf von sechs Raycasts pro Zelle im
Grid-Sweep. Der Intro-Kameraflug, der als einziger noch eine
Oberkanten-Höhe brauchte, liest sie aus `sampleColumn(...).topY` derselben
Säulen-Abfrage, die er ohnehin für den Boden macht. **Nicht wieder
einbauen** ohne expliziten Plan.

### ⚠️ SACKGASSE: Skyline-Cache als eigene Datenstruktur

Es gab in v2 ein Refactoring-Commit der `cell.skylineHeight` durch
einen separaten `skylineCache` ersetzte. **Ist abgelöst.** Mit der
fixen Air-Höhe (Option B) braucht es keine Skyline-Daten mehr, und seit
der Terrain-Konsolidierung existiert das Feld nicht mehr. Falls
in einem späteren Versuch wieder skyline-adaptiv: `sampleColumn` liefert
mit `topY` bereits die Oberkante derselben Säule, aus der der Boden kommt;
eine getrennte Skyline-Datenstruktur braucht es dafür nicht.

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
   existieren. Mode-Switch im Shader rettet das nicht: die
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
- **TowerLosViz / TowerLosLayerBuilder NIEMALS löschen**: sie sind
  die Live-Viz-Pipeline und brauchen keinen Migrations-Touch.

### ⚠️ SACKGASSE: y-Flip in der Direction-zu-Pixel-Math (H5)

v2-Probe-Code hatte:

```ts
const py = size - 1 - Math.floor(t * size);
```

Aus der Annahme dass Cube-Faces image-Konvention (top-left=0,0)
brauchen und Framebuffer-readPixels bottom-up liefert. Eine
"Verify"-Methode in v2 lieferte angeblich `match=428, mismatch=0`
gegen den Live-Shader: daraus wurde geschlossen die Formel sei
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
keine Blocker; beide für **dieselbe** Direction). Lesen
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

**Lesson, extrem wichtig für künftige Diagnose-Sessions:**
Verify-Tests müssen den Pfad gegen einen *unabhängigen* Pfad benchen,
nicht gegen einen zweiten Aufruf desselben Pfads. Das `1×1-RT-Quad-
Shader-Pattern` aus `losDiagProbeGpuVsCpu` (in der 2026-05-14-Diagnose
gebaut, danach mit dem Rest der Diagnostik entfernt) ist das saubere
Tool: wenn du es nochmal brauchst: Code aus dem Git-Log
zurückholen (Diagnose-Reste sind in einem ge-`reset`-ten oder
git-stash-bar separaten Commit), oder via `tower-shadow-mapper.ts`
neu aufsetzen, wenige Dutzend Zeilen.

### ⚠️ SACKGASSE: Bias-Asymmetrie (war nie produktionsrelevant, aber dokumentationswürdig)

Verworfene Session: zwischen CPU-`raycaster.far = dist - 0.5` (stoppt
0.5 m **vor** Ziel) und GPU-`cellDist < blockerDist - 0.5` (Blocker
muss 0.5 m **hinter** Cell sein) gab es 1 m breites Toleranz-Band
an Wand-Kanten. Beim Migrations-Versuch wurden 60–80% Mismatch im
Parallel-Verify gemessen: die hießen aber zum Großteil "CPU lenient,
GPU strict". User-Entscheidung: strict (Combat schießt nicht halb
durch Wand). Bias bleibt strict, war keine Bug-Quelle.

### ⚠️ SACKGASSE: Real-Blocker-Dot ohne Per-State-Gating

v3 hatte ursprünglich einen schwarzen Punkt im Cell-Zentrum wenn ein
realer Blocker (`depth < 0.99`) die Sichtbarkeit killte. Mit dem
ungelösten Air-Bug feuerte der Dot überall (jeder Air-Sample sah
sich selbst als Blocker). Entfernt 2026-05-13. **Falls Re-Aktivierung:
Per-Layer-Gating Pflicht**: Dot nur auf dem Ground-Layer, nicht auf
dem Air-Layer, bis Air bewiesen sauber ist.

### ⚠️ SACKGASSE: `scene.background` als unsichtbarer Render-Pfad (Lesson 11, der eigentliche Air-Bug)

**Diese Sackgasse hat uns 2 Tage gekostet und alle Air-Lessons davor
falsch interpretieren lassen.**

Wir hatten Lesson 4 (Material-Swap pro Mesh), Lesson 7 (ClearColor
save/restore) und Lesson 8 (`includeOnly`), alle drei dazu da
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
Distance, und der User erkannte sofort dass das Skybox-Pattern war,
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
projizierte auf eine Wolken-Region des Skybox-Hintergrundbilds, kein
echter Blocker. Lesson 11 entfernt diese false-Blocker; danach Air-Cells
in clear airspace alle visible, Cells hinter echten Bäumen/Gebäuden
weiterhin blocked. Aggregate-`gridAir`-Toggle und Per-Tower-Filter='air'
zeigen ab Fix identische Cell-Sets.

### Was strukturell passt (unverändert seit 2026-05-14)

- Single-Source-of-Truth-Helper `getAirTargetY(cell)` ist überall im
  Spiel: Combat, Per-Tower-Viz Air-Mesh-Position, Per-Tower-Viz
  Sample-Y im Shader (per-instance `aAirSampleY`), Aggregate-Air-Plate-
  Position, Air-Route-Tube.
- Combat-Cache und Live-Shader sampeln nach H5-Fix bit-konsistent.
- Air-Enemy-Flughöhe ist auf `geoHeight + heightOffset` (heightOffset
  per Type-Config 15–20m), passt zum Sample-Y bei flachen Cells.


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

Dieser Bug war alt, vermutlich aus einem früheren Branch mitgenommen.
LOS-Migration hat ihn nur sichtbarer gemacht weil im Smoke-Test
gegen die Tower-Card-Anzeige verglichen wurde.

### Diagnose-Infrastructure (heute: LOS-Debug-Panel)

Während der Air- und H5-Hunt-Session 2026-05-14 wurden ad-hoc-Tools
eingebaut und nach Verifikation wieder entfernt:

- `[LOS-DIAG] cube-render`-Logs mit `callerLabel`
- `losDiagProbeTower(towerId)`: Cache-vs-CPU-readPixels-Check
  (tautologisch, weil Cache MIT CPU-readPixels gefüllt wird)
- `losDiagDumpAggregate()`: Cache vs. State-Buffer
- `losDiagProbeGpuVsCpu(towerId)`: der **eigentliche** H5-Test:
  1×1-RT mit Quad-Shader `textureCube(map, dir)` vs.
  `sampleCubeAtPoint` für identische Direction-Vektoren
- `losDiagDumpSelectionState()`: Filter-Bridge-Check

**Seit 2026-05-15 obsolet**: das permanente LOS-Debug-Panel liefert
alles davon visuell:

- **6-Face-Cubemap-View** ersetzt das Mental-Modell-Raten "was sieht der
  Cube eigentlich": der Skybox-Leak war im Panel auf einen Blick als
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
  Streaming, könnte als One-Click-Button im Panel ergänzt werden.

### Sonstiges

- LOS_OFFSET (alte 2.4 m Edge-Offset) ist entfernt.
- `setLineOfSightRaycaster` Setter in `three-tower.renderer.ts` bleibt
  für den `hasLineOfSight`-Combat-Fallback (Enemies zwischen Cells).
  `getLosRaycaster` Getter wurde entfernt (nie aufgerufen).
- `MAX_VIZ_CELLS_HARDLIMIT = 50_000` in `route-grid-aggregate-viz.ts` ist nur
  noch eine Safety-Obergrenze; die InstancedMesh-Capacity wird dynamisch
  als `min(cells.size, hardlimit)` allokiert. Test-Szene mit 1763 Cells
  bekommt 1763 Slots, eine Manhattan-große Karte würde bis 50k mitwachsen.
  InstancedMesh-Capacity ist nicht runtime-growable: wenn das Grid sich
  nachträglich vergrößert (Location-Switch / Route-Regen), läuft
  `clear()` → `disposeVisualization` → frischer Build beim nächsten
  Toggle.

---

## Was hier NICHT mehr stehen muss

Hatte hier in alten Versionen Code-Snippets für Phase 1-9-Plan,
v1-Code-Pfad-Inventur, Distance-Material-Source mit allen Lessons-
Kommentaren, AbStract-Description-of-State-Codes. Stehen alle im
Code selbst: `tower-shadow-mapper.ts` und `tower-los-layer-builder.ts`
haben Lesson-Nummerierung in Kommentaren. Dieses Doc ist Higher-Order-
Kontext und Sackgassen-Mahnmal, nicht API-Reference.

Frühere ausführliche Phase-Pläne (v1 → v3) sind im Git-Log
nachvollziehbar (Branch `feat/route-grid-gpu-los-v3`, History).

---

## Appendix: GPU-Probe Code-Pattern (für H5-artige Diagnosen)

Falls in einer künftigen Session wieder ein direkter GPU-vs-CPU-Vergleich
über viele Cells gebraucht wird (über die per-Pixel-Inspection im
Debug-Panel hinaus), das alte H5-Pattern reinbringen, ~30 Zeilen in
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
