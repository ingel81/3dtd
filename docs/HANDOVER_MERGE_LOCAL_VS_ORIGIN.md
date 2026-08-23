# Handover: lokales `main` gegen `origin/main` zusammenführen

**Stand:** 2026-08-23 — **aufgelöst.** Der Merge liegt auf `merge/local-into-origin`.
**Statisch grün:** tsc, `ng lint`, 904 Tests, `npm run build`.
**Noch offen:** Gegenprobe im laufenden Spiel (Abschnitt 0.4). Nichts gepusht.

---

## 0. Wie aufgelöst wurde

`git checkout -b merge/local-into-origin main && git merge origin/main` — fünf echte
Textkonflikte, zwölf weitere Dateien textuell auto-gemergt und danach inhaltlich
nachgeprüft. Ein sauberer Auto-Merge sagt nichts darüber, ob am Ende zwei
Implementierungen derselben Sache nebeneinander stehen.

### 0.1 Entscheidung pro Kollision

| Bereich | Entscheidung |
|---|---|
| `gpu-cube-resolve.ts` | **lokal.** `origin/main` hatte den 1×1-Readback-Pfad *und* den Batch-Pfad nebeneinander — der alte war dort schon tot (kein Aufrufer). Die lokale Fassung hat nur einen Pfad: die Faces liegen auf `LosResolveContext.faces`, gefüllt von `TowerShadowMapper.readFacesToCpu()`. Die Lazyness aus `e069845` ist übernommen, aber ohne zweite API: `buildLosResolveContext` hängt `faces` als **Getter** ein, die 6 Readbacks laufen erst beim ersten wirklich gesampelten Cell. |
| `global-route-grid.ts` — Sweep | **beides.** Der frame-budgetierte Sweep aus `beae782` sitzt jetzt auf dem LOD-gefilterten Sampling: `sampleCellSkyline` raus, `onCellsChanged?.()` → `emitCellsChanged()`, `terrainRaycaster`-Guards → `columnSampler`. Danach war `updateTerrainHeights()` eine zweite vollständige Sweep-Implementierung — sie ist jetzt ein Wrapper, der dieselbe Queue mit `Infinity`-Budget leerdrainiert. Ein Sweep, zwei Einstiegspunkte (blockierend beim Initial-Load, budgetiert beim Tile-Load). |
| `global-route-grid.ts` — Tower-Reg | **remote.** Die Bounding-Box-Registrierung über `cellsInRange` (`0ccab8c`) ersetzt den Map-Scan über zehntausende Zellen. |
| `visualization-facade.service.ts` | **lokal, Trigger von remote eingearbeitet.** `refreshRoutesAndAnimation()` gelöscht; einzige Implementierung ist `scheduleBakedHeightRefresh()` (rAF-entprellt, refresht zusätzlich die Marker), angestoßen über `addCellsChangedListener`. |
| `health-bar-instance.manager.ts` | **remote.** Das GPU-Billboard (`a73c1fe`) ist die gründlichere Lösung: Ausrichtung im Vertex-Shader über `uCameraRight`/`uCameraUp`, `aCenter`/`aSize` als Instanz-Attribute, `instanceMatrix` ungenutzt. Die lokalen `addUpdateRange`-Uploads wurden **darauf gelegt** statt verworfen — remote lud sonst pro `needsUpdate` den vollen 20 000-Slot-Buffer. |
| `enemy-instance.manager.ts` | **beides.** Remotes Frame-Gate (`state.lastFrame`) und gecachtes Heading-Quaternion plus die lokalen Update-Ranges. |
| `tower.entity.ts` | **beides.** Beide Seiten hatten denselben Air-LOS-Bug unabhängig gefixt, kollidiert ist nur der Kommentar. Remotes `calculateDistanceFastSq` + gecachtes `_mPerDegLon` sind übernommen. |
| `tower-combat.service.ts` | **beides.** Remotes Scratch-Buffer und `out`-Parameter sind orthogonal zu den lokalen LOS-Fixes (Air-LOS, Beam-LOS samt periodischem Recheck, entfernter Flame-Beam-Doppeltick) und zum lazy `getAlive()`. |
| `TODO.md` / `DONE.md` / `three.mock.ts` | zusammengeführt, nichts verworfen. |

Nicht kollidierende Remote-Arbeit ist vollständig übernommen: Lifecycle-/Race-Fixes
(`c068e7b`), Render-Loop-Trimmen (`d2c42f6`), VFX (`9f5f74e`), Pathfinding-Worker,
Post-Processing-Pass-Gating, Frame-Pacing, `scene.matrixAutoUpdate = false`.
Ein Verlust-Audit über alle 14 Remote-Commits fand keine fehlende Änderung; 13 der
32 remote-berührten Dateien sind byte-identisch mit `origin/main`.

### 0.2 Was das Review danach gefunden hat (behoben)

- **Route-Rebuild-Storm.** Die erste Auflösung hatte remotes „einmal am Sweep-Ende"
  durch „jede Frame" ersetzt: der Budget-Sweep emittiert pro Slice, und
  `scheduleBakedHeightRefresh` hing direkt daran — voller A\* pro Spawn,
  Line2-Neuallokation und `startAnimation()` (das `startTime` zurücksetzt) pro
  Frame. Die Dash-Animation wäre für die Dauer des Sweeps bei Offset 0
  eingefroren und das 5-ms-Budget wäre Fiktion gewesen. Der Refresh koalesziert
  jetzt bei aktivem Sweep und läuft einmal bei Konvergenz.
- **Listener-Leck.** Der lokale Wechsel von `setCellsChangedListener` (Overwrite)
  auf `addCellsChangedListener` (Liste) hatte an beiden Call-Sites das Unsubscribe
  verworfen. Das Grid ist ein Root-Singleton, `initialize()` läuft pro
  Location-Wechsel erneut → pro Wechsel zwei Listener mehr, also N-fache
  Tower-LOS-Neuberechnung inklusive N erzwungener Cubemap-Renders pro Emit.
- **Sweep-State über `clear()` hinweg.** Ein Location-Wechsel während laufendem
  Sweep hätte verwaiste Alt-Zellen mit dem neuen Sampler geraycastet und
  Cells-Changed für Zellen emittiert, die es nicht mehr gibt.
- **Health-Bar-Update-Ranges.** `aSize` wurde pro Enemy pro Frame unbedingt
  geschrieben. `clearUpdateRanges()` läuft nur, wenn der Renderer das Attribut
  wirklich hochlädt — bei ausgeblendeten Bars wuchs das Ranges-Array also
  unbegrenzt. Jetzt Schreibvorgang nur bei echter Änderung, plus ein
  `hiddenFlags`-Array, damit `update()` tote Slots überspringt statt die Bar über
  der Leiche wieder aufpoppen zu lassen.
- **AA-Retrofit.** Vor dem Research platzierte `dual-gatling` wurden nie
  neu registriert, hatten also keinen Eintrag in `cell.airVisibility`. Solange
  Air-LOS in `findTarget` nicht durchgesetzt war, fiel das nicht auf; jetzt
  löst `research:completed` ein `recomputeTowerLOS` für die betroffenen Türme aus.
- **Freeze.** Remotes `slowMultiplier = 0` in `updateStatusEffects` hatte kein
  Gegenstück in `getSlowMultiplier`/`isSlowed` — die Simulation hätte gestoppt,
  die Walk-Animation wäre weitergelaufen.

### 0.3 Gelöschter toter Code

`getHeightCacheKey` + `CACHE_PRECISION`/`CACHE_SCALE`/`lastOriginHeight`
(three-tiles-engine), `TowerShadowMapper.getRenderer()`, `getSkylineHeightAtLocal`
aus `TerrainProvider` und DevWorld-Provider, der per-Spawn-`hide()` für den
globalen Health-Bar-Toggle. Dazu mehrere Kommentare korrigiert, die nach dem
Merge etwas anderes behaupteten als der Code tut.

### 0.4 Was noch fehlt

Die Gegenprobe im laufenden Spiel — Turm auf Hochhaus, Flammenturm hinter Wand,
Flak hinter Hochhaus, Welle mit vielen Gegnern, Location-Wechsel, AA-Retrofit auf
einem bereits platzierten dual-gatling. Die im Review gefundenen, aber bewusst
nicht im Merge behobenen Punkte stehen in `TODO.md`.

---

## 1. Die Lage in einem Satz — historisch, Stand vor dem Merge

Der lokale Klon stand seit Sessionbeginn auf `f6a7a48` und war **von Anfang an 14 Commits hinter `origin/main`** — das ist erst beim Push aufgefallen. Die gesamte Arbeit dieser Session (25 Commits) ist damit auf einem 2,5 Monate alten Stand gewachsen.

```
                      ┌── 25 Commits (diese Session) ── main (lokal)
f6a7a48 ──────────────┤
(2026-05-23)          └── 14 Commits (Mai/Juni) ─────── origin/main
```

`git rev-list --left-right --count main...origin/main` → `25  14`

**17 Dateien wurden von beiden Seiten angefasst.** Ein blinder Merge produziert Konflikte in genau den Kerndateien und riskiert schlimmer noch: zwei Implementierungen derselben Sache nebeneinander, was dieses Projekt ausdrücklich verbietet.

---

## 2. Warum „lokal gewinnt" nicht funktioniert

Der naheliegende Reflex (`push --force`) würde 2,5 Monate gemergte, teils von Hand verifizierte Arbeit vernichten — darunter Dinge, die **gar nicht** mit uns kollidieren:

- Lifecycle-/Race-/Korrektheitsfixes (`c068e7b`)
- VFX-Optimierungen: geteilte Trail-Materialien, gedeckelte Flame-Spawns (`9f5f74e`)
- Render-Loop-Trimmen: Post-Processing, Tower-Renderer (`d2c42f6`)
- Pathfinding-Worker-Fixes

Umgekehrt gilt dasselbe: `git reset --hard origin/main` würde diese Session wegwerfen.

**Es braucht einen echten, bereichsweise begründet aufgelösten Merge.**

---

## 3. Was auf `origin/main` liegt (14 Commits, 2026-05-25 bis 2026-06-07)

Autoren: teils `ingel81` (von Hand), teils `Claude` aus einer früheren Session (`claude/3d-engine-performance-analysis-NHoDA`, existiert als Remote-Branch).

| Commit | Inhalt | Kollision |
|---|---|---|
| `eb315c0` | `test` (leer/klein) | — |
| `e2caa2c` | Deep-Dive-Analysebericht (docs) | — |
| `c068e7b` | Lifecycle-/Race-/Correctness-Bugs (B1-B5, C8, L1) — combat-effect, pathfinding-worker, game-state-sync | **nein** |
| `d2c42f6` | Render-Loop trimmen (R2-R5, R7, R8) — post-processing, three-tower.renderer | **nein** |
| `0ccab8c` | **Batch-Cube-Readbacks** + Bounding-Box-Tower-Registrierung (G1, G2, C2) | **ja, direkt** |
| `0830967` | Targeting-/Combat-Allokationen, O(n)-Arbeit (C1, C3-C7, L2, L4) | **ja, teilweise** |
| `14ab6eb` | Enemy-Frame-Uploads gaten, Heading-Quat cachen, Healthbar-Matrix teilen (G3-G6) | **ja** |
| `9f5f74e` | VFX: Trail-Materialien teilen, Allokationen, Flame-Spawn-Cap (P1, P3-P5) | **nein** |
| `cf9e83b` | Implementierungsstatus dokumentiert | — |
| `e069845` | processQueue härten, **lazy LOS-Face-Read**, Doku | **ja** |
| `1acae7c` | TODO: verschobene Render-/GPU-Punkte | TODO-Konflikt |
| `a73c1fe` | **Healthbar-GPU-Billboard** (G3) + statische Scene-Subtrees (R1) | **ja** |
| `beae782` | **Frame-budgetierter Terrain-Height-Refresh** gegen Tile-Load-Stutter | **ja** |
| `3c061be` | **Route-Line + Animation neu snappen** nach budgetiertem Sweep | **ja** |

---

## 4. Was diese Session lokal gebaut hat (25 Commits)

Reihenfolge und Absicht, damit die nächste Session die Entscheidungen versteht:

**Intro-Kameraflug** (`943c1eb`, `556df55`)
Skriptierter Flug HQ → Spawn nach dem Laden. Halte-Phasen an beiden Enden mit aus der FOV berechnetem Abstand, damit Marker samt Label vollständig im Bild sind. Hindernisvermeidung über ein dilatiertes Skyline-Profil mit Vorausschau-Fenster. Quaternion-Slerp statt `lookAt` pro Frame. Skip-Button. Doppelt als Tile-Prewarm für den Routenkorridor.

**Terrain-Konsolidierung** (`b8df8d0`, `fd5117c`, `8a903ba`, `d6c3626`)
Der eigentliche Bugfix der Session. Routen und Marker hingen in Tokio auf Dachhöhe in der Luft.
- Ursache: Während der Tile-Verfeinerung bleibt eine grobe Ancestor-Kachel aktiv, bis alle Kinder bereit sind. Ein senkrechter Strahl trifft dann zwei LOD-Generationen gleichzeitig; die grobe ist in der Photogrammetrie eine dezimierte Hülle auf ungefähr Dachniveau. Der alte Code nahm `results[0]`, also den obersten Treffer.
- Der vorhandene Schutz (`anchorY`-Band ±3 m) war wirkungslos, weil `routeAnchorY` beim Bootstrap 0 ist und echter Boden bei ~165 m liegt.
- Neu: `sampleColumn` → `selectColumnSample` behält **nur die Treffer der feinsten vorhandenen LOD** und liest Boden als tiefsten, Oberkante als höchsten davon. Kein Anker, keine Toleranz.
- Cache pro 0,5-m-Säule mit `lodVersion` statt globalem Clear.
- Overlay-Space ersatzlos entfernt (`overlayBaseY`, `cachedOriginTerrainY`, ~12 unabhängige HQ-Snapshots) — alles absolutes Scene-Y. Die schwebende Linie war exakt die Differenz zweier dieser Snapshots.
- Skyline komplett entfernt (seit Option B kein produktiver Leser) — spart fünf von sechs Raycasts pro Zelle im Sweep.
- **Wichtig für den Merge:** Der Nachbar-Median-Guard in `sampleCellY` wird jetzt übersprungen, wenn das neue Sample aus einer strikt besseren Kachel kommt. Ohne das blockierte er die eigene Korrektur, weil die Nachbarn aus denselben groben Kacheln stammten. Das fand ein Test (107 Zellen neu abgetastet, 0 übernommen) — der LOD-Filter allein hätte den Bug **nicht** behoben.

**Performance** (`40e58f6`, `97ee07a`, `92020e1`, `da872f5`, `bd1d3a5`+`731f454`)
- Profiler mischte zwei Nenner: Enemy-Werte pro Sub-Step neben Frame-Werten. Jetzt alles pro Frame, neue Zeile `Substeps/Frame`.
- `rawDeltaTime` auf 50 ms geklemmt **vor** der Timescale-Multiplikation. Bounded die Todesspirale (gemessen: 40,5 Sub-Steps/Frame) und fixt nebenbei einen Tab-Switch-Hänger. Timescale-Semantik bleibt exakt.
- Visueller Push aus dem Sub-Step-Loop in `EnemyManager.presentFrame()`, nur wenn ein Sub-Step lief und `renderingEnabled`.
- Komponenten-Dispatch: `enemy.update()` iterierte eine Map mit fünf polymorphen Calls, drei davon leer.
- **SoA wurde gebaut und revertiert** — gemessen langsamer als die Objektvariante. Begründung in der Revert-Message `731f454`.
- Ergebnis: **3 → 47 FPS bei ~14 000 Gegnern** (Overlay geschlossen).

**Korrektheit + weitere Perf** (`9c560ed`, `4674df0`, `b0b83d1`, `a09c2a6`, `9816397`, `2383296`, `91ada54`)
- Zell-Key 0 wurde als „keine Zelle" behandelt (`intCellKey(0,0) === 0`, Truthiness-Test an zwei Stellen). Gegner in der Zelle am Ursprung — dem HQ, auf das alle Routen zulaufen — wurden nie aus deren Set entfernt, auch beim Tod nicht. Echter Leak.
- Batch-Face-Readback statt 1×1 pro Zelle. **Kollidiert mit `0ccab8c`.**
- Projektile: Sim/Present-Split wie bei den Gegnern.
- Instancing-Upload-Ranges. **Kollidiert mit `14ab6eb` / `a73c1fe`.**
- **Air-LOS wurde nie durchgesetzt**: `findTarget` übersprang den LOS-Check für Luft-Einheiten mit einem Kommentar aus Januar, vier Monate bevor die Air-LOS-Pipeline im Mai kam. Der periodische Recheck verwarf das Ziel ~3×/Sekunde, die Selektion wählte es sofort wieder — rund 95 % der Schüsse gingen durch Gebäude.
- **Beam-Türme prüften überhaupt kein LOS** — die einzige der fünf `findTarget`-Aufrufstellen ohne Prädikat. Zusätzlich brauchte der Beam einen eigenen periodischen Recheck, weil er sein Ziel über den Fast-Path hält und kein `canFire`-Gate hat.
- Turmplatzierung auf Dächern war kaputt (Regression aus der Terrain-Arbeit): Der Build-Handler leitete die Höhe über `getTerrainHeightAtGeo` neu ab statt den Cursor-Treffer zu nehmen. Der liefert jetzt den begehbaren Boden — bei einem Hochhaus die Straße vierzig Stockwerke tiefer. Behoben durch Nutzung von `hitPoint.y`.

---

## 5. Kollisionen im Detail — Vorschlag pro Bereich

Das ist der eigentliche Arbeitsauftrag. **Keine Entscheidung ist getroffen**, die Einschätzungen sind Vorschläge.

### 5.1 Cubemap-Readback — `gpu-cube-resolve.ts`
Beide Seiten haben dasselbe Problem erkannt und gebatcht.
- **Lokal** (`4674df0`): `TowerShadowMapper.readFacesToCpu()`, 6 persistente Puffer, per `renderVersion` gecached, `LosResolveContext.faces`. Verifiziert: `(py*size+px)*4` ist byte-identisch zum alten `readPixels(px,py,1,1)`; No-Y-Flip-Konvention (H5) unangetastet.
- **Remote** (`0ccab8c` + `e069845` „lazy LOS face-read"): eigene Batch-Variante, **plus** Bounding-Box-Tower-Registrierung über einen `cellsInRange`-Index statt Map-Scan über zehntausende Zellen — das haben wir **nicht**.
- **Vorschlag:** Remote-Implementierung als Basis nehmen (sie kann mehr), unsere prüfen auf Details, die dort fehlen. **Auf keinen Fall beide behalten.** Die H5-Konvention in beiden gegenprüfen — hier hat sich das Projekt schon einmal verrannt.

### 5.2 Terrain-Height-Sweep — `global-route-grid.ts`, `visualization-facade.service.ts`
Unterschiedliche Ebenen desselben Problems, **vermutlich komplementär**.
- **Remote** (`beae782`): budgetiert den Sweep über Frames (Scheduling).
- **Lokal**: behebt die Ursache im Sampling (LOD-Filter) und reduziert 6 Raycasts pro Zelle auf 1.
- **Vorschlag:** beides behalten. Aber: Mit unserem Sampling ist der Sweep deutlich billiger, also erst messen, ob das Frame-Budget überhaupt noch nötig ist. Achtung, `beae782` führt neue Methoden ein (`stepTerrainHeightRefresh`), die unser `updateTerrainHeights` erwarten — Signaturen abgleichen.

### 5.3 Route-Line-Refresh — `visualization-facade.service.ts`
**Direkt konkurrierend, gleiche Absicht.**
- **Remote** (`3c061be`): `refreshRoutesAndAnimation()`, angestoßen wenn der budgetierte Sweep meldet, dass sich etwas geändert hat. Der Commit sagt selbst: *„No unification of the redundant systems; they are just triggered correctly."*
- **Lokal**: `scheduleBakedHeightRefresh()` über `addCellsChangedListener` (Mehrfach-Abonnenten statt Einzel-Slot), rAF-entprellt, plus Gegner lesen den Boden pro Frame direkt aus dem Grid statt aus gebackenen Pfadhöhen.
- **Vorschlag:** Unsere Variante bevorzugen — sie behebt zusätzlich, dass Gegner auf eingefrorenen Pfadhöhen liefen, und der Mehrfach-Listener ist die Ursache dafür, dass überhaupt nur die Tower-LOS benachrichtigt wurde. Remote-Trigger einarbeiten, nicht danebenstellen.

### 5.4 Healthbars / Instancing — `health-bar-instance.manager.ts`, `enemy-instance.manager.ts`
- **Remote** (`a73c1fe` + `14ab6eb`): Billboarding im **GPU-Shader** statt CPU-Composes, plus gegatete Frame-Uploads und geteilte Matrix.
- **Lokal** (`a09c2a6`): `addUpdateRange` auf allen `needsUpdate`-Pfaden.
- **Vorschlag:** **Remote gewinnt klar** — das GPU-Billboard ist die gründlichere Lösung und war auch die Empfehlung unseres Perf-Agenten. Unsere Update-Ranges sind evtl. *zusätzlich* sinnvoll (sie lösen den Full-Buffer-Upload, nicht die Composes) — prüfen, ob `a73c1fe` das schon abdeckt.

### 5.5 Combat / Targeting — `tower-combat.service.ts`, `tower.entity.ts`
- **Remote** (`0830967`): Allokationen in Targeting/Combat, O(n)-Arbeit.
- **Lokal**: lazy `getAlive()`, flameBeams-Doppeltick entfernt, **Air-LOS und Beam-LOS durchgesetzt**.
- **Vorschlag:** Unsere LOS-Fixes sind **Korrektheit und nicht verhandelbar** (ausdrückliche Nutzeransage: Verdeckung muss korrekt sein, das Spiel heißt 3DTD). Die Remote-Allokationsarbeit ist orthogonal und sollte mit. Sorgfältig von Hand zusammenführen, `findTarget` wurde von beiden Seiten angefasst.

### 5.6 `movement.component.ts`, `enemy.manager.ts`
- **Remote** (`0830967`, `14ab6eb`): kleinere Allokations-/Caching-Änderungen.
- **Lokal**: Present-Split, Grid-Boden pro Frame, Höhen-Interpolation entfernt, Komponenten-Dispatch.
- **Vorschlag:** Unsere Struktur ist die tiefgreifendere; Remote-Detailoptimierungen einarbeiten, wo sie noch passen.

### 5.7 `TODO.md`, `DONE.md`, `three.mock.ts`
Textkonflikte, unkritisch. Beide Seiten haben Einträge ergänzt — zusammenführen, nichts wegwerfen. `1acae7c` und unser `5e707b1` betreffen verschiedene Abschnitte.

---

## 6. Empfohlenes Vorgehen

1. **Branch anlegen** statt direkt auf `main` zu mergen:
   `git checkout -b merge/local-into-origin main`
2. `git merge origin/main` und die 17 Konflikte **bereichsweise** nach Abschnitt 5 auflösen. Nicht datei-, sondern themenweise denken.
3. Nach jedem aufgelösten Bereich: `npx tsc --noEmit -p tsconfig.app.json`, damit man nicht am Ende vor einem Berg steht.
4. Am Ende: `npx ng lint`, `npx vitest run`, `npm run build`.
   **Erwartung:** lokal 903 Tests, remote 885 — die Vereinigung liegt höher. Wenn Tests fehlen, wurde etwas verschluckt.
5. **Nach jedem entfernten Duplikat prüfen: bleibt genau eine Implementierung übrig?** Zwei parallele Systeme sind hier ein Abbruchkriterium.
6. Erst mergen, wenn im Spiel gegengeprüft: Turm auf Hochhaus, Flammenturm hinter Wand, Flak hinter Hochhaus, Welle mit vielen Gegnern.

**Nicht tun:** `push --force`, `reset --hard` auf eine der beiden Seiten, oder Konflikte mit „theirs"/„ours" pauschal auflösen.

---

## 7. Offene Punkte unabhängig vom Merge

Stehen auch in `TODO.md` unter *1.1 Engine-Bugs*:

- **Gift bei Timescale > 1** in *Spielzeit* messen, nicht mit der Stoppuhr. Gleiche Tick-Zahl und gleicher Gesamtschaden bei 1× und 10×; die Wanduhr-Zeit unterscheidet sich um den Faktor. Der DOT-Akkumulator liegt bewusst im Sub-Step.
- **Frost-Aura, Todesanimation, Healthbars** bei niedriger Framerate (visuelle Toggles laufen jetzt pro Frame).
- **Luft-Einheiten** auf korrekter Flughöhe.
- **Headless-Trainingslauf** — der Visual-Push ist jetzt auf `renderingEnabled` gegatet.
- **Terrain-Höhen an mehreren Standorten** — flaches Gelände gegen Großstadt.

Gemeldet, aber bewusst nicht behoben:
- `updateBeamTowers` hat keinen Sleep-Check, anders als Melee (`:586`) und Chain (`:697`). Performance, nicht Korrektheit.
- `cell.skylineHeight` konnte Müll enthalten (gemessen 325,64 gegen einen Live-Raycast von 164,96) — mit der Skyline-Entfernung gegenstandslos, aber falls sie je zurückkommt: `sampleColumn().topY` liefert die Oberkante derselben Säule.

---

## 8. Messwerkzeuge

- **Perf-Overlay** kostet bei hohen Gegnerzahlen mehr als alles andere: acht `performance.now()` pro Gegner pro Sub-Step, bei 14k Gegnern ~340k Aufrufe pro Frame, gemessen ~34 von 55 ms. **Jede Zahl mit offenem Overlay ist aufgebläht.** Für echte Werte: Overlay schließen, Chrome-Trace.
- `__perf.setRendering(false)` in DevTools trennt JS von Render+GPU ohne neue Instrumentierung. `__perf.stats()`, `__perf.isRendering()`.
- `__flight.cfg` / `.replay()` / `.state()` für den Intro-Flug.
- `__rg.dumpStats()` / `.dumpCellsInBox()` / `.resetHeightsAndRetry()` fürs Route-Grid.
- **Substeps/Frame** im Overlay ist die Zahl, die alle anderen erklärt: 0 bei 144 FPS, 1 bei 60, 3 am Clamp-Limit.
