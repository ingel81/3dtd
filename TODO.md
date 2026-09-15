# Offene TODOs

> **Philosophie:** Engine first, Game second.
> Erst die Engine stabil, performant und testbar machen — dann Features bauen.
>
> **Stand 2026-05-11:** Reorganisiert nach Prio-Layern.
> - **PRIO 1:** Engine & Umbauten (Engine-Bugs, Refactoring, Test-Coverage, Hot-Path-Optimierungen, Cleanup)
> - **PRIO 2:** Balance & Followups der parked Phase-5.16 + Pre-Production AI-Safeguards
> - **PRIO 3:** Game-Features (Visual Polish, Damage & Armor, AI Build & Deploy, Attributions)
> - **BACKLOG:** Langfristig, bei Bedarf
>
> **Phase 1 (Engine Foundation) und Phase 2 (Engine Performance) abgeschlossen** → siehe DONE.md.
> **Housekeeping 2026-05-09/10:** 16/18 Items + PostProcessingPipeline-Extract erledigt → DONE.md.
> **Engine Cleanup-Pass 2026-05-11 (Commit f26fbe3):** komplette 1.3 Test-Coverage (+99 Tests),
> komplette 1.4 CPU Hot-Path (8 Items), services/-Subfolder-Split, IGameManager-Teilrollout → DONE.md.

---

# PRIO 1 — Engine & Umbauten und Co.

> Engine zuerst stabil, performant und testbar machen. Hier sammeln sich die laufenden
> Refactoring-, Test- und Bugfix-Themen.

## 1.0 Nächste Runde: Top-Priorität

- [ ] **Korridor einmal fertig messen, dann einfrieren** (Top, User 2026-09-15: "das brauchen wir gelöst, das geht
      so gar nicht"). Heute ändert sich der Korridor sichtbar: erst OSM-Breite auf groben Tiles, nach dem Intro die
      echte Messung (2 bis 3 s) und ein Neubau von bis zu 408 ms in einem Frame, danach weitere Neubauten aus
      Laufweg-Kappen, sobald die Kamera feinere Tiles als die 5-m-Region lädt; das Ergebnis hängt vom Kamerapfad ab.
      Befund und Entwurf: `tmp/fix1/reports/corrperf.md`, `corrarch.md`. Entschieden: Phase 0 Region-LOD messen
      (5 m, 2,5 m, feinste; Worker corrprobe, Trace corrlog), Phase 1 im Ladescreen auf fester LOD messen, bauen bis
      stabil, einfrieren, Nachmess-Maschinerie entfernen (längerer Ladescreen ok), Phase 2 Regeln vereinfachen:
      Route mittig im begehbaren Band statt an der OSM-Linie (ersetzt ggf. den Umweg-Planer, behebt 732). Kleine
      Objekte auf Plätzen: Band endet davor. Prüfung mit `__corridor.fingerprint()` über drei Kamerapfade je Ort.
      Phase 1 auch (corrperf, beide Logs): Routenlinie und Marker nur neu bauen, wenn sich Zellen geändert haben
      (heute bei jedem Tile-Settle, `visualization-facade.service.ts:719`, samt Neustart der Routenanimation);
      Zellhöhen mit einfrieren; keine Leerlauf-Abtastung derselben Zellen (`route-cell-sampler.ts:156/230`).

- [ ] **Routenkorridor dynamisch nach Straßenbreite** (Top-Priorität, dem Nutzer sehr wichtig)
      Heute ist der Zellkorridor überall gleich breit (`CORRIDOR_WIDTH` 7 m in
      `global-route-grid.ts`), die Gegner weichen fest bis 3 m seitlich aus.
      An Engstellen liegen Zellen dadurch auf Fassaden, Dächern und Bäumen, auf
      breiten Straßen bleibt Platz ungenutzt. Festgelegt 2026-09-12:
      - **Breite pro Abschnitt, entlang der Route variabel:** nicht ein Wert
        pro Route, sondern pro Kante bzw. Abschnitt, enger und breiter werdend
        wie die Straße. Anzahl Zellen in der Breite folgt der Straße.
      - **Quelle:** OSM `width`/`lanes` (seit `03ffd7b` am Street-Objekt
        gespeichert), sonst Standardbreite je `highway`-Klasse; zusätzlich aus
        den 3D-Tiles messen: seitlich raycasten, wo Fassaden oder Bäume
        beginnen, und den Korridor dort begrenzen.
      - **Gegner nutzen die Breite:** Der Seitenversatz folgt der
        Korridorbreite (breit verteilt auf Hauptstraßen, eng in Gassen).
      - **Minimum 2 Zellen (4 m):** Tower sehen nur Gegner in Zellen, der
        Seitenversatz wird dort auf die Breite begrenzt.
      - Zusammen mit den **Brücken- und Tunnel-Tags** angehen: Auf Brücken
        die Oberkante statt des Bodens darunter nehmen (Tags liegen seit
        `03ffd7b` vor; "Korrektur überspringen" reicht nicht, siehe
        `docs/archive/ROUTE_GEOMETRY_ANALYSIS.md`).
      Folgen: Zellzuordnung, LOS-Registrierung, Targeting und Bodenhöhe der
      Gegner ändern sich; Hot Path (20k Gegner) nicht verlangsamen.
      **Stand 2026-09-12 (Runde 2):** umgesetzt auf dem Sprint-Branch
      (`1306460` bis `bfb550c`), inklusive Tile-Messung und Brücken-Deck;
      Tunnel nicht angefasst. Playtest steht aus
      (`docs/REVIEW_SPRINT_2026-09-12.md`).
      **Nach dem Playtest 2026-09-12:** Breite aus dem gemessenen Freiraum je
      Seite (bis 7 m Halbbreite, OSM nur Fallback), Engstelle 1 Zelle,
      Dach-Check, zwei Strahlhöhen gegen parkende Autos, Tuning per
      `__corridor.set` (`331c7a3` bis `8910463`). Konzept für
      route-parallele Zellen: `docs/ROUTE_ALIGNED_CELLS_CONCEPT.md`,
      Entscheidung nach dem nächsten Test.

## 1.1 Engine-Bugs

> Air-Enemy-Flughöhe-Drift am Hang wurde 2026-05-21 als kosmetisch
> akzeptiert (Option γ, siehe DONE.md).

- [ ] **Verhaltensprüfung nach Terrain- + Performance-Umbau (2026-08-22)**
      Beide Umbauten sind auf `main`, statisch abgesichert (903 Tests, Lint,
      Build), aber im laufenden Spiel nicht durchgeprüft. Fällt beim normalen
      Spielen mit ab — hier nur als Erinnerung, worauf zu achten ist:
      - **Gift bei Timescale > 1**: in *Spielzeit* messen, nicht mit der
        Stoppuhr. Gleiche Anzahl Ticks und gleicher Gesamtschaden bei 1× und
        10×; die Wanduhr-Zeit unterscheidet sich um den Faktor. Der DOT-
        Akkumulator liegt bewusst im Sub-Step (`enemy.manager.ts`) — wäre er
        im Present-Pass gelandet, würde Gift bei hohem Timescale still
        schwächer.
      - **Frost-Aura, Todesanimation, Healthbars** bei niedriger Framerate:
        die visuellen Toggles laufen jetzt einmal pro Frame statt pro
        Sub-Step.
      - **Luft-Einheiten** auf korrekter Flughöhe (`terrainHeight +
        heightOffset`).
      - **Headless-Trainingslauf**: der Visual-Push ist jetzt auf
        `renderingEnabled` gegatet — vorher lief er bei 75× pro Sub-Step für
        ein Bild, das nie entsteht.
      - **Terrain-Höhen an mehreren Standorten**: der Wegfall des
        Overlay-Space verschiebt Y von Straßen, Gebäuden, Markern, Route-Linie
        und Tower-Preview auf absolute Scene-Koordinaten. Flaches Gelände und
        eine Großstadt gegenprüfen.
      **Entscheidung 2026-09-12:** Diese Punkte kommen in die nächste
      nummerierte Playtest-Liste, danach schließen.
      **Stand:** Punkte 5 bis 8 der Playtest-Liste in
      `docs/REVIEW_SPRINT_2026-09-12.md`.

- [ ] **Route folgt der Straße nicht, Route-Cells auf Dach und Baum**
      Playtest 2026-09-10 (Kleinstadt, Engstelle): Die rote Enemy-Route
      schneidet eine Hausecke, während die gelbe OSM-Straße um das Haus biegt.
      Die Route-Cells liegen dadurch auf Dach und Baumkronen, Gegner laufen
      dort zu hoch. Ein Re-Raycast ändert nichts, die Zellen folgen der Linie.
      Nicht durch das Dependency-Update eingeführt (Routengeometrie kommt
      unverändert aus dem Pathfinding), bekannte Routen sind sonst sauber.
      Vermutungen, ungeprüft:
      - Der Pfad läuft nur über Kreuzungsknoten und verliert die Shape-Nodes
        der OSM-Ways, oder die Route wird nachträglich geglättet/vereinfacht.
      - An Engstellen erfasst der 7 m breite Zellkorridor (`CORRIDOR_WIDTH` in
        `global-route-grid.ts`) Fassaden und Bäume auch bei korrekter Route;
        der Korridor müsste sich der Straßenbreite anpassen.
      Kontrolle: Debug → Display → LOD Colors, Route-Linie gegen das
      Straßen-Overlay.
      **Stand 2026-09-11:** Im Playtest an derselben Stelle nicht mehr
      reproduziert. Die Route verliert nachweislich keine Shape-Nodes
      (`fcbe1d8`), der HQ-Abzweig ist korrigiert (`4ad010a`); die Ursache des
      ursprünglichen Befunds ist aber nicht belegt. Offen lassen, bei
      Wiederauftreten `__routes.describe()` aufrufen (Fälle A bis D in
      `docs/archive/ROUTE_GEOMETRY_ANALYSIS.md`).

## 1.2 Refactoring (Housekeeping Tier 3)

- [ ] **`three-tiles-engine.ts` weiter abspecken — Camera-Setup + Tile-Loading-State**
      Post-Processing ist 2026-05-10 raus (PostProcessingPipeline, siehe DONE.md).
      Noch offen: Camera-Setup (GlobeControls + Initial-Position) und Tile-Loading-State-Machine
      (firstTilesLoaded, retry, debounce). Beide deutlich enger mit `tilesRenderer.initialize()`
      verzahnt — eigene Session mit Plan vorab.
      **Stand 2026-09-13 (Nacht):** Camera-Setup und Tile-Loading lagen schon
      vor der Nacht in `CameraRig` und `TileLoadingTracker`. Dazu ausgelagert:
      Render-Loop, Terrain-Abfragen, Szene, Picking, TilesRenderer-Setup; 2 234
      auf 1 144 Zeilen, heute 1 198 (`89871ab` bis `f8d1a97`, `d57026c` bis
      `1f7c867`), Playtest steht aus.

## 1.3 Test-Coverage (Housekeeping Tier 4)

> Cleanup-Pass 2026-05-11 + Engine-Deep-Review 2026-05-16 (160 neue Tests) +
> TEST-6..10-Lücken 2026-05-21 (59 neue Tests) → DONE.md.
> Keine offenen Test-Coverage-Lücken.

## 1.4 CPU Hot-Path Optimierungen

- **Bewusst nicht umgesetzt: weitere Enemy-Hot-Path-Hebel**
      Stand nach dem Umbau vom 2026-09-10 (DONE.md, 21 → 48 FPS bei 20k
      Gegnern; Traces unter `tmp/perf/`). Am 2026-09-10 entschieden, nicht zu
      machen:
      - Culling pro Pool (Pools außerhalb des Bildes weder beschreiben noch
        zeichnen). Ein Pool ist ein Gegnertyp über die ganze Route, greift also
        nur, wenn die Kamera ganz woanders hinschaut. Räumliche Pools wären M-L.
      - Kalte Gegner (ohne Tower in Reichweite) nur einmal pro Frame rechnen.
        Größter verbleibender Hebel, ändert aber die Simulation (Wegpunkte,
        Reichweiten-Eintritt, Gift-Ticks, Event-Reihenfolge).
      SoA siehe Backlog, verworfen.

- [ ] **20k-Benchmark gegen den Stand vor dem Terrain-/Performance-Umbau**
      Aus der Playtest-Liste verschoben (REVIEW_SPRINT_2026-09-12.md, alte Liste
      16, Playtest 2026-09-14): Messaufgabe, kein Klicktest. 20k Gegner auf
      demselben Ort und derselben Kamera einmal auf `02278dc` und einmal auf dem
      aktuellen Stand messen (FPS, Frame-Zeit, Chrome-Trace je Sub-Step), damit
      belegt ist, dass der Umbau nicht langsamer ist. Vergleichsstand in einem
      eigenen Worktree bauen.
      Dazu aus der Nacht-1-Liste 157 (REVIEW_SPRINT_2026-09-13.md): derselbe
      20k-Lauf gegen `39fbb18` (vor der Nachtschicht 1) mit FPS, GPU-Speicher
      und Tab-Speicher, um die VAT-Umstellung (Half Float, opak, nur GPU) zu
      belegen.

## 1.5 Render-/GPU-Hebel aus Deep-Dive 2026-05 (verschoben, messgestützt)

> Aus PR #5 / [PERF_BUG_ANALYSIS_2026-05-28.md](docs/PERF_BUG_ANALYSIS_2026-05-28.md).
> Die risikoarmen High-Value-Findings sind umgesetzt (Bugs, LOS-Readback-Batching,
> Bounding-Box-Tower-Reg, Targeting-Hot-Path, Health-Bar-Buffer-Sharing, Trail-Material-
> Sharing u.a.). Die folgenden sind größere Shader-/Buffer-Umbauten oder visuelle/
> balance-relevante Änderungen — **vor Umsetzung Frame-Time im echten Render messen**
> (davor/danach), da hier kein Headless-/GPU-Test greift. Sichere Teilvarianten sind
> jeweils bereits drin.

- [ ] **R4-Experiment — `logarithmicDepthBuffer` evaluieren**
      logDepth schreibt `gl_FragDepth` → deaktiviert Early-Z auf vielen GPUs über die
      gesamte Tile-Geometrie. Experiment: entfernen + `camera.near` 1→5-10m anheben (Spiel-
      Skala ~150m, Fern-Z im Fog). Z-Fighting-Risiko → nur mit visuellem Vorher/Nachher.
      Sichere Teilmaßnahme (`powerPreference`/`stencil:false`) ist bereits drin.

- [ ] **Render-Kleinkram: R6 und R10**
      P6, P8, G8 und R9 sind im Sprint 2026-09-11 erledigt (Nachtrag in
      PERF_BUG_ANALYSIS_2026-05-28.md). Für die nächste Runde festgelegt:
      - **R6:** leere Instanz- und Partikel-Pools nicht zeichnen
        (`visible = count > 0`), zusammen mit einem Shader-Warm-up beim Laden
        (`compileAsync`), damit der Compile nicht in die erste Welle rutscht.
      - **R10:** erst loggen, ob die Tile-Materialien überhaupt Licht rechnen
        (Materialtyp im `load-model`-Event), dann entscheiden. Die Zahl der
        PointLights bleibt bei 1.
      **Stand 2026-09-12 (Runde 2):** R6 und Shader-Warm-up umgesetzt, R10
      loggt die Materialtypen (`aa0bd7a` bis `33aed45`); Entscheidung zu R10
      nach dem Playtest.
      **Playtest 2026-09-12:** Beide Typen treten auf, `MeshBasicMaterial`
      (unlit) und `MeshStandardMaterial` (lit). Ein Teil der Tiles rechnet die
      Szenenlichter also doch; der Anteil ist nicht gemessen. Offen: Anteil
      messen, dann Lichter reduzieren oder die Tiles einheitlich unlit machen.

- [ ] **Ladezeit und GPU-Speicher gegen `412cbff` messen**
      Aus der Playtest-Liste verschoben (REVIEW_SPRINT_2026-09-12.md, alte Liste
      29, Playtest 2026-09-14): Messaufgabe gegen einen alten Stand, kein
      Klicktest. Gleicher Ort, kalter und warmer Cache, jeweils Zeit bis
      spielbar und GPU-Speicher (Chrome Task-Manager bzw. `__perf.stats`),
      alter Stand in einem eigenen Worktree.

## 1.6 Befunde aus dem Sprint 2026-09-11 (nicht behoben)

> Beim Abarbeiten auf `sprint/todo-2026-09-11` aufgefallen, bewusst nicht im
> Sprint erledigt. Übersicht des Sprints: `docs/REVIEW_SPRINT_2026-09-11.md`.

- [ ] **Platzierungsregeln: zwei weitere Kopien mit anderer Distanzformel**
      Maus-Vorschau, Klick und Training-Session prüfen seit dem Sprint über
      `utils/tower-placement-rules.ts` (`checkTowerPlacement`). Daneben stehen
      noch `TowerManager.validatePosition` (`tower.manager.ts:222`, ohne
      Bounds-Check, schnelle Quadrat-Distanz) und die Prüfung in
      `strategic-placement.service.ts:349`. Die sechs Placement-Strategien des
      Bots filtern damit vor; ungültig platziert wird nichts, weil die Session
      zuletzt `checkTowerPlacement` fragt, es fallen nur Kandidaten weg.
      Zusammenlegen ändert die Kandidatenwahl der Bots.
      **Entscheidung 2026-09-12:** zusammenlegen, eine Regelquelle für Spiel
      und Bots.
      **Stand 2026-09-12 (Runde 2):** umgesetzt (`9eecf67`).

- [ ] **Decision-Explainer ist halb tot**
      `ai/core/decision-explainer.ts` schreibt seine Zusammenfassung nach
      `aiExplanation` im Game-Store, kein Template zeigt sie an;
      `lastExplanation` liest niemand. Übrig bleibt die Konsolen-Ausgabe im
      `debugMode`.
      **Entscheidung 2026-09-12:** im Wave-Debug-Fenster anzeigen (Zeile "Why
      this wave"), `aiExplanation` dafür nutzen, `lastExplanation` entfernen.
      **Stand 2026-09-12 (Runde 2):** umgesetzt (`0f3c364` bis `98676f2`).

- [ ] **Debug-Fenster gemeinsam per `@defer` laden**
      Die elf Debug-Fenster liegen mit ~160 kB im Start-Bundle. Einzeln lohnt
      `@defer` nicht (8 kB Defer-Runtime gegen 13,8 kB beim Training-Fenster),
      gemeinsam schon. Befund aus dem Lazy-Training-Umbau (`85d8402`).
      **Stand 2026-09-12 (Runde 2):** umgesetzt (`eddeb82`): ein Lazy-Chunk
      für alle elf Fenster, Spielstart netto etwa 147 kB weniger (statische
      Import-Hülle des Builds, unkomprimiert). Browser-Test steht aus.

- [ ] **Kleinkram**
      Rocket-Düsenglühen (Trail-Streak) ist in der Länge FPS-abhängig
      (erledigt, `482f4e1`) · `training-backend/scripts/analyze_log.py` hat
      kein argparse und liest `--help` als Logdatei (erledigt, `e2ac3ae`) · die Tower-Debug-Slider verschieben den Tip des
      CPU-Fallbacks, nicht die gecachte Grid-LOS (nur Debug) ·
      `SpatialGridService` rechnet Zellschlüssel mit `| 0` (Zelle 0 doppelt
      breit, beim Einfügen und Abfragen gleich, also kein Fehler) · elf Buttons
      in einzelnen Debug-Fenstern haben noch kein `aria-label` (meist `title`;
      erledigt, `ef2e626`, es waren zehn)
      · ein im Browser gecachter Fehlschlag beim Nachladen des Training-Chunks
      lässt sich per Retry eventuell nicht beheben, dann hilft nur ein Reload.

## 1.7 Befunde aus der Sprint-Runde 2026-09-12 (nicht behoben)

> Übersicht der Runde: `docs/REVIEW_SPRINT_2026-09-12.md`.

- [ ] **Routenkorridor: Restpunkte**
      Tunnel und Durchgänge: erledigt (`db2eb51`, Höhe zwischen den Portalen,
      keine Messung; Entscheidung 2026-09-12: keine Sonderregel für die
      Sicht der Tower). Ein Spawn-Wechsel
      ohne Neuladen misst die neue Route nicht, sie läuft mit OSM-Breiten.
      Kreuzen sich zwei Routen auf verschiedenen Ebenen, gilt in den
      gemeinsamen Zellen der Boden. Der Neuaufbau nach der Tile-Messung läuft
      synchron, möglicherweise bei schon sichtbarer Karte (Strahlen je
      Station, bei Verengung zweimal A* pro Spawn, neue Zellen, ein
      Höhen-Sweep); seit `f9fe730` gemessen (`[Corridor] rebuild:`).
      **Playtest 2026-09-12** (Innenstadt, 1 Route, 316 Stationen): Neuaufbau
      etwa 40 ms, unkritisch. Teuer ist die Messung davor: `clearance` mit
      1260 Strahlen 520 bis 533 ms am Stück im Main Thread, ein spürbarer
      Hänger. Kandidat zum Stückeln (Stationen über mehrere Frames) oder für
      die BVH-Entscheidung. Nachmessen
      nach Tile-Schüben seit `30bc473`, die Regeln stecken in
      `CorridorRefit` mit Spec (`cb925c6`).
      **Stand 2026-09-13 (Nacht):** Spawn- und HQ-Wechsel messen den Korridor
      (`428f339`), die Messung läuft in 4-ms-Scheiben statt 520 ms am Stück
      (`879ad8b`), ein Tower oder eine Welle misst den Rest zuerst (`b9f468c`),
      zurückgehaltene Nachmessungen kommen nach etwa 3 s (`9a6aa37`). Offen:
      gemeinsame Zellen zweier Routen auf verschiedenen Ebenen, Neuaufbau
      synchron. Playtest steht aus.
      **Playtest 2026-09-14** (alte Liste 41): Die Breite folgt Parkstreifen,
      Vorgärten und Fassaden, schmale Gassen entstehen, wo die Häuser es
      vorgeben. Aber parkende Autos (etwas höher als die Straße) und Vorgärten
      zählen noch zu sehr als begehbare Zellen, obwohl der Höhenunterschied sie
      vermutlich trennen würde; Screenshots zeigen Zellen auf einem geparkten
      Transporter in einer Gasse, daneben orange (vom Dach-Check auf den Boden
      gesetzte) Zellen. Ansatz prüfen: Zellen, die deutlich über ihren
      Nachbarn in Straßenmitte liegen, aus dem Laufweg nehmen oder auf den
      Boden setzen, ohne echte Stufen und Rampen zu verlieren. Verwandt: die
      Sockel-Boden-Regel aus fix1/fix4 (Autos erkennen) in
      `utils/tower-footprint.ts`.
      **Playtest 2026-09-14** (alte Liste 44, Rothenburg): Viele orange,
      also vom Dach-Check auf den Boden gesetzte Zellen (`clamped`) liegen in
      der Draufsicht im Haus oder unter dem Dach statt auf der Straße. User:
      solche Zellen sollten meist gar nicht nutzbar sein. Prüfen, ob der
      Dach-Check sie weglassen statt auf den Boden setzen soll, und wie weit
      sie heute Laufweg (seitlicher Versatz im Korridor), Zielwahl und LOS
      beeinflussen.
      **Stand (Fix-Session 2026-09-14):** teilweise, alles aus dem Code
      abgeleitet, im Browser ungesehen. Orange Zellen im Haus an Engstellen
      behoben (`0e9b9280`, runde Segmentenden reichten bis 7 m ins
      schmalere Stück); Zellen auf Autos, Transportern und Hecken stehen auf
      Straßenhöhe (orange, `33ce898d`), bleiben aber im Laufweg, Gegner laufen
      durch das Auto; Auskragungen begrenzen den Korridor (`a8866f4d`,
      Urteilsfrage, alte Regel per `__corridor.set({ overhangDepth: 0 })`);
      `__corridor.pick()` zeigt Säule, Überbau, Kamerasicht und OSM-Tags
      (`8f47fc4b`). Offen: Vorgärten (Entscheidung a/b/c), Traufen über 3,5 m,
      Innenseite von Knicks, zwei Ebenen, synchroner Neuaufbau. Review-Befunde
      C1 bis C4 behoben (fixrev2): Ein Tower sieht eine Zelle am Auto wieder
      über dem Dach und zielt auf Gegner im Auto (`66569eca`,
      Lead-Entscheidung), Stufen-Check erst über Straßenhöhe (`9f2e2b47`),
      `pick()` mit dem echten Lift der Linie (`d8298b31`), Zeilenverweise
      (`633ec1cf`). Playtest 560 bis 563 und 566 bis 570 in
      `docs/REVIEW_FIX_2026-09-14.md`.
      Seit `509aaed0` (User-Entscheidung nach Playtest 560 bis 562): keine
      orangen Zellen mehr, der Korridor endet vor Zellen, zu denen kein
      Gegner laufen kann (aus Code und Specs, im Browser ungesehen); die
      `stepTop`-Probe aus `66569eca` ist damit entfallen, Gegner laufen dort
      nicht mehr durchs Auto. Nachtest 560 bis 564 im Stand-Block von
      REVIEW_FIX, 566 und 568 entfallen, 567 und 570 überholt.

- [ ] **Gegnermodelle: Blender-Runde**
      Reihenfolge laut `docs/ENEMY_MODEL_BUDGET.md`: Hornet (69 297
      VAT-Vertices pro Instanz), zombie_v2, Rat, Spider, Wraith, Zombie, Mech,
      Wallsmasher als GLB statt FBX, Dragon-Flug-Clip (13 s) auf einen Loop
      kürzen (die ganze Dragon-VAT hat 98,5 MB). `Electrocuted_Fall` von
      zombie_v2 auf den Sturz zuschneiden, dann kann der Clip zurück in den
      Pool (das Skript dafür ist jetzt `tools/blender/optimize_enemy.py`,
      `optimize_zombie_v2.py` ist entfernt). Zombie Soldier
      verschwindet möglicherweise ebenfalls mitten im Fallen (ungeprüft). Alle
      VAT-Materialien waren `transparent: true` (bis `eb3b7da`), Kosten
      ungemessen.
      **Stand 2026-09-13 (Nacht):** 12 Modelle optimiert (`99f2845` bis
      `32195cb`): Hornet, zombie_v2 (neue UVs, Farbe neu gebacken), Rat,
      Spider, Wraith, Zombie (glatte Normalen, Look), Wallsmasher als GLB
      (FBX-Loader entfernt), Dragon-Flug auf 3,3 s, Stone-Golem-Walk auf
      1,33 s, Bat, Penguin, Mammoth. VAT aller Typen 264,2 auf 105,2 MB, kein
      Template über 5 Mio. Vertices pro Frame. `Electrocuted_Fall` ist auf den
      Sturz geschnitten und zurück im Pool (`05b2523`). VAT-Materialien opak,
      wo kein Alpha nötig ist (`eb3b7da`). Offen: Mech, Ghost und Tank nicht
      geändert; Rat-Animation nicht exakt (`43a511c`); Wraith-Brustkorb aus
      der Nähe gröber. `43a511c` und die glatten Normalen (`700b102`) lassen
      sich im Code und in der GLB einzeln zurücknehmen, am Head mit Konflikt
      nur in `docs/ENEMY_MODEL_BUDGET.md`; die Datei danach per
      `npm run model-budget` neu erzeugen. Playtest steht aus.

- [ ] **Lizenzen und Attributions**
      In `attributions.config.ts` fehlen Ghost, Hornet, Mech, Wraith, Herbert,
      Stone Golem und zombie_v2; die 14 älteren Dateien in
      `enemies/candidates/` sind ohne Lizenznachweis getrackt. Herkunft nicht
      geprüft. Die Kenney-Texturen liegen als `Textures/colormap.png` unter
      `towers/` und `enemies/`; ein Modell aus einem weiteren Kenney-Kit
      braucht einen eigenen Ordner.

- [ ] **Bot-Läufe mit den neuen Inhalten**
      Keine Bot-Baseline mit Chaos Tower und `skeleton_swarm`, die Wirkung auf
      die Director-Zahlen ist offen.
      **Stand 2026-09-13 (Nacht):** Split und Nuklearschlag kommen dazu.
      strategist und meta erforschen und nutzen den Schlag, ihre Baselines
      sind mit Läufen vor `77f3f2d` nicht direkt vergleichbar. Weiter offen.

- [ ] **Kleinkram Runde 2**
      `GameStateManager.initialize` hat den unbenutzten Parameter
      `_streetNetwork` (erledigt, `71f41ec`) · mit Debug-Gegnern außerhalb
      einer Welle kommt kein `wave:completed`, die Tower drehen dann nicht zur
      Wachrichtung (erledigt, `d6a5b06`) · `getCurrentDifficulty()` und `calculateReward()` im
      `WaveDirectorService` haben keine Aufrufer (erledigt, `71f41ec`) ·
      `poison-glob` fehlt in `PROJECTILE_SOUND_IDS` (erledigt, `3047750`) ·
      economy-chart, tower-stats-chart und wave-planner schreiben noch ohne
      `writeGeneratedFile` (erledigt, `9f4b0a5`; Charts neu erzeugt in
      `881a7a7`) · `spawnBulletTracer`, `spawnCannonSmoke`,
      `setBloomStrength`/`setBloomThreshold`/`isBloomEnabled` haben keine
      Aufrufer (erledigt, `693571b`) · verzögerter Rauch wird mit Größe 0
      gezeichnet, manche GPUs zeigen dann eventuell einen 1-px-Punkt
      (erledigt, `bd5112d`) · der Split des Skeletons aus
      MASTER_GAME_DESIGN §4 ist nicht umgesetzt · `EXPLOSION_PRESETS.hq`, der
      Typ `ExplosionPreset` und `ThreeTilesEngine.clearEntities()` haben keine
      Nutzer (erledigt, `71f41ec`).
      **Stand 2026-09-13 (Nacht):** Split des Skeletons umgesetzt (`99178cd`
      bis `0557aba`, Fixes `5dc8409`, `42f94b3`), Playtest steht aus.

## 1.8 Befunde aus der Nachtschicht 2026-09-13 (nicht behoben)

> Auf `sprint/night-2026-09-13` aufgefallen, bewusst nicht in der Nacht
> erledigt. Übersicht: `docs/REVIEW_SPRINT_2026-09-13.md`. In der Nacht noch
> behoben (fix3, `158f0f1` bis `c8c4242`): Leck-Budget in `beginWave()`,
> DPS-Bins doppelt abonniert, Höhen-Refresh und `__corridor` nach
> `dispose()`, Musik bei verweigertem `ctx.resume()`, Sounddatei nach
> Ladefehler, ein veralteter Verweis in HANDOVER_ROUTE_GRID_GPU_LOS; dazu die
> vier Befunde des dritten Reviews (`06d49b2` bis `9d60aaa`): Lazy-Chunk ohne
> Fehlerpfad, Air-Alert-Ton nach Restart, Pan-Taste auf einem Slider, Fokus im
> Photo Mode; dazu die drei Befunde des vierten Reviews (fix4, `54a51cf` bis
> `52f6b3b`): Lade- und Öffnungsfehler des Ortsdialogs unterscheiden, Air-Alert
> erst nach dem Ton, `getOrLoad` löst mit null auf.

- [ ] **Canvas folgt keiner Fenstergröße**
      `engine.resize()` läuft nur beim Start
      (`services/infrastructure/engine-initialization.service.ts:308`) und über
      `fitToCanvas()` beim Photo Mode (`services/photo-mode.service.ts:95`).
      Aus dem Code, nicht im Browser gesehen.

- [ ] **COMING UP: Anzahl-Spanne nur mit aktivem Director** (laut hud-Worker)
      `components/game-sidebar/wave-panel/upcoming-waves.ts:69`.

- [ ] **Nuklearschlag: Explosionsstufen in Echtzeit**
      Die Stufen nach 120 und 260 ms laufen über `setTimeout`
      (`game-engine/vfx.service.ts:108`) und gehen auch in einer Pause los.
      VFX, Audio und Shake unterscheiden keine Fähigkeiten, keine Warnsirene
      (`docs/ABILITIES.md`, "Eine weitere Fähigkeit").

- [ ] **Spawn-Portal an engen Stellen und Hängen** (laut portal-Worker, ungesehen)
      Pfeiler können in Gassen in Fassaden ragen, der Lichtfleck liegt am Hang
      eventuell schief, von hinten ploppen Gegner auf
      (`three-engine/renderers/marker/spawn-portal.manager.ts`).

- [ ] **Korridor-Neuaufbau im Intro**
      Der Neuaufbau (etwa 40 ms, synchron) landet meist mitten im Intro, die
      Routen-Animation startet dann neu. Eine Welle nach einem Flush nutzt die
      vorher berechnete Director-Konfiguration
      (`services/world/corridor-controller.ts`).

- [ ] **Skeleton-Split: Reste**
      Balance ungespielt; Training-`total_count` enthält die Minions; die
      Debug-Platzierung kopiert weiter den Pfad; ist ein Debug-Skeleton der
      einzige Gegner, drehen die Tower eventuell kurz zur Wachrichtung; der
      Commit-Text von `99178cd` nennt +0,5 MB, richtig sind +0,2 MB
      (`docs/ENEMY_MODEL_BUDGET.md:313`). Beschrieben ist der Split in
      `docs/ENEMY_CREATION.md`, Abschnitt zu `splitOnDeath`.

- [ ] **Lazy-Chunks: Reste**
      Der Fehlerbildschirm nach einem gescheiterten Chunk-Download nennt
      weiter "Change tile credentials" als Ausweg (laut fix3, `9d60aaa`).
      `@angular/animations` steht noch in `package.json`.

- [ ] **Steuerung und HUD: Kleinkram** (laut controls- und hud-Worker)
      Ein Wellenstart hebt die Pause nicht auf; die Research-Queue nimmt keine
      Ketten von Voraussetzungen. Ungemessen: Hover-Pick bis 10 pro Sekunde,
      Offscreen-Scan bei 20k Gegnern. Ungesehen: die HQ-Zelle "100/100" ist
      knapp (47 von 51 px). Die Photo-Leiste hat keine Fokusfalle
      (`services/photo-mode.service.ts`).
      **Stand (Fix-Session 2026-09-14):** Die Queue-Ketten der Nacht 2
      (`7914062f`) sind zurückgenommen (`a1bcb3d5`, User-Entscheidung): eine
      gesperrte Forschung lässt sich nicht einreihen, die Queue läuft strikt in
      Reihenfolge. Playtest 508, 509 in `docs/REVIEW_FIX_2026-09-14.md`.

- [ ] **Meta: ungeprüft**
      Showcase-Orte nicht angespielt (`configs/showcase-locations.config.ts`);
      Recent speichert auch Orte, deren Route scheitert
      (`services/location/recent-locations.ts`).

- [ ] **VAT nach Context-Restore**
      `InstancedEnemyRenderer` backt nach einem WebGL-Context-Restore alle
      Typen neu (in Node etwa 5 s), im Browser ungemessen; die Ersparnis im
      Tab-Speicher ist gerechnet
      (`three-engine/renderers/instanced-enemy/instanced-enemy.renderer.ts`).

- [ ] **Training-Debugger: Callbacks als Funktions-Inputs**
      `components/debug-window/training-debugger.component.ts` bekommt seine
      Callbacks als Funktions-`@Input` statt als Outputs. Von hygiene nicht
      umgestellt, weil das die API der Komponente ändert.

- [ ] **Eigene Shader ohne Ausgabe-Kodierung** (laut portal4, ungesehen)
      Diese `ShaderMaterial`s schreiben ohne `colorspace_fragment` bzw.
      `linearToOutputTexel` und sehen darum mit Bloom oder Grading anders aus
      als ohne (Bloom ist standardmäßig aus, dann geht das Bild direkt auf den
      sRGB-Canvas). Das Tor und der Beschwörungskreis sind seit `0be611c` und
      `f3f7238` kodiert. Offen in `three-engine/renderers/`:
      Straßenlicht des Portals und HQ-Diamant, -Ringe, -Bodenglühen, Labels
      (`marker/spawn-portal-glow-material.ts:195`,
      `marker/marker-shaders.ts:134, 246, 325, 422`; bei Labels eventuell
      gewollt), VAT-Gegner (`instanced-enemy/vat-material.ts:281, 283`), Healthbars
      (`instanced-enemy/health-bar-instance.manager.ts:425`), Partikel
      (`particle-shaders.ts:156, 169`), Decals (`decal-shaders.ts:112, 218,
      325`), Projektile (`three-projectile.renderer.ts:395, 418, 469, 494`),
      Trails (`trail-streak.renderer.ts:447`), Tentakel
      (`three-tentacle.renderer.ts:148`), Blitz
      (`lightning-bolt.renderer.ts:235`), Atompilz
      (`mushroom-cloud-blast.ts:50, 83`), Schadenszahlen
      (`floating-text/floating-text-material.ts:18`); dazu
      `utils/route-altitude-tubes.ts:45`. Additives Licht lässt sich zwischen
      Canvas und linearem Composer-Target nicht exakt angleichen.

- [ ] **Beschwörungskreis mit Bloom unsichtbar** (Playtest 2026-09-13, Punkt 248)
      Ohne Bloom sichtbar, mit Bloom weg. Kam vermutlich mit `f3f7238`, das
      den Kreis per `linearToOutputTexel(sRGBTransferEOTF(...))` für sein Ziel
      kodiert (`three-engine/renderers/marker/marker-shaders.ts`, Kreis im
      Straßenlicht-Shader).

- [ ] **Tower auf schrägen Dächern: automatischer Steinsockel** (Playtest 2026-09-13)
      Auf einem Satteldach versinkt ein Teil des Towers in der Schräge
      (Screenshot: Plant- und Cannon-Tower auf Steildächern). Wunsch: vor dem
      Setzen prüfen, ob der Untergrund unter der Grundfläche halbwegs eben
      ist; wenn nicht, sitzt der Tower an der höchsten Stelle und darunter
      entsteht automatisch ein gemauerter Steinsockel bis zur tiefsten Stelle.
      Der Sockel ist schon in der Bauvorschau zu sehen. Zu klären: Abtastung
      der Grundfläche (`three-engine/terrain-queries.ts`), Toleranz und
      maximale Sockelhöhe, Schusshöhe und LOS mit angehobenem Fuß
      (`services/tower-los-registry.ts`, `heightOffset` + `shootHeight`),
      Sockel-Mesh (instanziert, Steinmaterial, eventuell aus Blender).

- [ ] **Drache ohne Sound? Erst prüfen** (Playtest 2026-09-13, bei Punkt 235)
      Beim Test wirkte der Drache stumm; laut User eventuell eine
      Falschmeldung. Zuerst nachstellen (Custom Wave Dragon, Kamera nah,
      SFX an), erst bei Bestätigung Ursache suchen (etwa seit airgate
      `bd7ec68` oder der Blender-Runde).

- [ ] **Debug-Gegner: falsche Anfangsrichtung** (Playtest 2026-09-13, bei Punkt 237)
      Ein im Enemy-Inspector per Place gesetzter Gegner schaut zuerst in eine
      falsche Richtung und dreht sich erst beim Loslaufen zur Route Richtung
      HQ.

- [ ] **Luftgegner am Portal: Reste** (laut airgate, ungesehen)
      Die Air-LOS der Tower ist für 15 m über der Zelle vorberechnet
      (`getAirTargetY`); auf den ersten 43 bis 47 m nach dem Tor fliegen
      Luftgegner tiefer und werden nach dieser Sicht gewählt. Der Drache
      (14,5 m Spannweite) ist breiter als jede Toröffnung, die Fledermaus
      breiter als die kleinste (`configs/marker-geometry.config.ts`,
      `AIR_PORTAL_EXIT`).

- [ ] **Kamera-Raycasts gegen die Tiles kosten Zeit** (Playtest 2026-09-13, Punkt 254)
      `__raycastStats()` über 37 s: `cameraControls` 10752 Aufrufe, 4238 ms,
      0,39 ms je Aufruf, im Schnitt etwa 11 % der Laufzeit (Ruhe plus 10 s
      Zoomen und Ziehen gemischt); ohne Kameraberührung 5010 Aufrufe und
      1355 ms (0,27 ms je Aufruf, Dauer nicht notiert, bei etwa 10 s rund
      13 %). Die GlobeControls raycasten jeden Frame
      den Punkt unter der Kamera, auch in Ruhe. Hebel: Strahl nur bei
      Kamerabewegung oder Tile-Wechsel, oder BVH für die Tile-Meshes (siehe
      alte Playtest-Frage 27 in `docs/REVIEW_SPRINT_2026-09-12.md`).

- [ ] **Kamera fährt in Tower-Modelle** (seit `bac034a2`)
      Zoom, Pan und Mindestabstand der GlobeControls treffen nur noch die
      Tiles (`three-engine/ground-pick-root.ts`); Tower zählen nicht als
      Hindernis, sonst hoben sie Zoom-Halt und Pivot wieder an.

## 1.9 Befunde aus der Nachtschicht 2026-09-14 (nicht behoben)

> Auf `sprint/night-2026-09-14` aufgefallen, bewusst nicht in der Nacht
> erledigt. Übersicht: `docs/REVIEW_SPRINT_2026-09-14.md`. Aus 1.8 hat die
> Nacht bearbeitet (nichts verschoben, Playtest steht aus): Canvas folgt der
> Fenstergröße (`9619b82f`); Lazy-Chunks: "Reload" statt "Change tile
> credentials" (`9504032d`), `@angular/animations` raus (`82f23124`);
> Steuerung: Wellenstart hebt die Pause auf (`c3d6f89a`), die Research-Queue
> nimmt Voraussetzungsketten (`7914062f`), Fokusfalle der Photo-Leiste
> (`ae0a5f39`), Hover-Pick und Offscreen-Scan in Node gemessen (`42fb575b`);
> Recent erst nach stehender Route (`df847ee8`); Training-Debugger mit
> Outputs (`ca88d039`); Beschwörungskreis mit Bloom (`7c2530f6`); Tower auf
> schrägen Dächern: Steinsockel (`7185812f` bis `10c9b178`); Debug-Gegner
> schauen ab dem Spawn in Laufrichtung und stehen auf der Route (`7414ee13`,
> `cbd01d10`); Skeleton-Split: Tower drehen nicht mehr zur Wache
> (`dde04a9c`); Kamera-Raycasts: Cache in Ruhe (`8380bd01`, im Browser
> ungemessen). Der Eintrag "Nuklearschlag: Explosionsstufen in Echtzeit" ist
> überholt: Die Stufen-Timer fielen schon am 2026-09-13 weg
> (`configs/visual-effects.config.ts:212`), der Nachhall läuft in Spielzeit
> (`46a096d2`), VFX, Ton und Shake gehen je Fähigkeit (`4479bc9f`); offen
> bleibt die Warnsirene.
> Fix-Session 2026-09-14: Stand je Eintrag unten, Übersicht in
> `docs/REVIEW_FIX_2026-09-14.md`. Die Queue-Ketten (`7914062f`) sind dort
> zurückgenommen (`a1bcb3d5`).

- [ ] **Idee: Tower an der Dachkante mit Schrägstütze** (Playtest 2, 2026-09-14, bei 429)
      An einer Dachkante ragt der runde Sockel über den Abgrund (Tokyo,
      `plinthHeight` 3,25). Vorschlag des Users: statt des runden Sockels
      eine eckige, schräge Abstützung gegen die Fassade, die einen Überstand
      bis etwa 49 % der Standfläche erlaubt; darüber ablehnen. Die Seite,
      deren Proben ins Leere fallen, gibt die Richtung zur Fassade
      (`utils/tower-footprint.ts`). Vorerst bleibt das Bauen an der Kante wie
      es ist (User).

- [ ] **Sockel: Dach oder Boden, Annahmen ungeprüft** (laut fix1 und fix4)
      Ob die Tiles unter einem Dach Boden zeigen, ist unbelegt; die
      Kommentare in `utils/route-cell-sampler.ts:248` und
      `tower-defense.component.ts:541` widersprechen sich. Im Playtest mit
      `__footprintDebug()` auf Dach und Straße klären (`centreGroundY` gegen
      `centreTopY`). Grenzen der Regel (`a26cd7dd`, `utils/tower-footprint.ts`):
      Auf einem Damm, einer Kuppe oder Terrasse, die binnen Radius plus 8 m zu
      zwei gegenüberliegenden Seiten mehr als 2,5 m abfällt, gilt fälschlich
      die Dach-Regel, dort heben Autos und Hecken den Tower. In der Mitte
      eines Dachs, das in jede Richtung weiter als Radius plus 8 m reicht und
      unter der Säule keinen Boden zeigt, gilt die Boden-Regel, ein Aufbau
      hebt dann nicht. Wo sich Dach- und Boden-Regel uneinig sind (neben
      Autos, Mauern, Hecken, an Dachkanten und -stufen), kostet jede
      Validierung 8 Säulenproben mehr, im Browser nicht gemessen. Eine Probe
      auf der geglätteten Flanke eines Autos kann den Tower um bis zu 0,5 m
      (`MAX_STEP`) heben; Terrassenmauern, die neben ebenem Cursor steiler
      als 0,5 m je Nachbarschritt steigen, heben nicht mehr. Cursor auf einem
      Autodach: Tower dort mit Sockel (die Cursor-Fläche zählt).
      **Stand (Fix-Session 2026-09-14):** nicht geändert. Der Widerspruch ist
      bestätigt (Doc-Kommentar über `hitOf` in `utils/route-cell-sampler.ts`
      gegen den Kommentar in `onMouseMove` von `tower-defense.component.ts`);
      welche Aussage stimmt, zeigt nur
      `__footprintDebug()` im Spiel (Nacht-2-Playtest 429); seit `4f4bdb0b`
      mit `__footprintDebug.watch()` (eine Zeile je Ruhepunkt, 429 erneut).

- [ ] **Shader-Compile-Check braucht glslangValidator von Hand** (laut shadercheck und fix4)
      `npm run shader-check` (läuft auch in `npm test`) kompiliert die
      eigenen Shader nur, wenn `GLSLANG_VALIDATOR` gesetzt oder
      `glslangValidator` im PATH ist; sonst meldet er "30 passed | 27 skipped
      (57)", mit Binary "57 passed (57)". Getestet mit 11.7.0, die in
      ARCHITECTURE.md §13 genannte 16.6.0 nicht. Treiber, ANGLE und
      GPU-Grenzen prüft er nicht; `/engine-test` hat keinen Fall. Drei Fälle
      greifen per Cast auf private Member zu und scheitern bei einer
      Umbenennung mit TypeError (`tools/shader-check/`).
      **Stand (Fix-Session 2026-09-14):** nicht geändert (Tooling-Entscheidung);
      die Casts bleiben, sie zu ersetzen hieße Produktionsklassen für den Test
      zu öffnen.

- [ ] **Pause: Gegner- und Flammen-Loops laufen weiter** (laut blob)
      Nur der Loop der Ooze hält in der Pause an (`EnemyManager.holdSounds()`,
      `managers/ooze-sounds.ts`); die Loops der übrigen Gegner und der
      Flammen laufen weiter.
      **Stand (Fix-Session 2026-09-14):** behoben: Die Pause hält alle Loops
      (`177ba53f`), ein fortgesetzter Loop nimmt die aktuelle Lautstärke
      (`5ae79d52`); gilt auch für Boss-Intro und Replay. Playtest 545 bis 548.

- [ ] **Mech und Ghost knapp über dem Modell-Budget** (laut assets)
      Mech 5 416 und Ghost 5 248 VAT-Vertices bei einem Budget von 5 000.
      Der Ghost hat 1 487 Dreiecke doppelt mit umgekehrter Windung (1 301 in
      den Schleiern); nur die Wiederholungen zu entfernen spart 233 Vertices
      und macht die Schleier schwächer. Tiefer nur mit stärkerem Decimate
      oder Retopologie (`docs/ENEMY_MODEL_BUDGET.md`, "Offen").
      **Stand (Fix-Session 2026-09-14):** nicht geändert (Blender-Arbeit).

- [ ] **Wurm-Boss: Reste** (laut worm und assets, ungesehen)
      An scharfen Routenecken können außen Lücken zwischen den Ringen
      aufgehen (Stellschrauben `SEG_FRONT`/`SEG_REAR` in
      `tools/blender/worm_boss.py`). Beine starr, kein Schwanzstück, keine
      Mandibel-Animation. Kein Sound: ein Loop je Segment belegte das Budget
      von 12 Gegner-Sounds. Jeder Ring hat eine eigene Healthbar (bei 240
      Ringen ein Band), jedes Segment gilt für die Offscreen-Pfeile als
      Boss. Mit Beinen 7,2 m breit, auf engen Straßen breiter als die
      Portalöffnung. Ein per Debug platzierter Wurm kommt ohne Portal aus
      dem Nichts (`managers/worm/`).
      **Stand (Fix-Session 2026-09-14):** Offscreen-Pfeile behoben, nur der
      Kopf jedes Stücks ist ein Boss (`66a5468a`, Playtest 555). Ecken nicht
      geändert: Überschlag ohne Messung, Außenspalt ab etwa 5° Knick, bei 90°
      etwa 3,6 m; Heading aus den Nachbarringen oder längeres `SEG_FRONT`
      bräuchten Sichtprüfung. Beine, Schwanz, Sound, Healthbar je Ring:
      Entscheidung; Breite und Debug-Wurm ohne Portal bewusst so.

- [ ] **Boss-Varianten ohne Fairness-Gate** (laut worm und blob)
      Die Größe der Wurm- und Ooze-Wellen (W35, W45, ...) bestimmt die
      Routenlänge bzw. die Config, nicht das Gate. Balance ungespielt: Wurm
      35 HP je Segment, Ooze 3 000 HP, 80 m, voller Körper im HQ = 10 Lecks,
      10 Klumpen à 30 HP (`configs/boss-variants.config.ts`,
      `configs/enemy-types.config.ts`). Auf Varianten-Wellen speichert der
      AI-Data-Collector die Wurm- bzw. Ooze-Welle statt der Director-Welle.
      **Stand (Fix-Session 2026-09-14):** bestätigt, nicht geändert; welche
      Welle ins Log gehört, wartet auf den Run-Dump (2.2).

- [ ] **Ooze: Reste** (laut blob, ungesehen)
      Gold-Popup, Offscreen-Pfeil und Knochen-Burst erscheinen an der
      Spitze; Zielpunkte liegen auf 2-m-Stationen; die Debug-Slider (Scale
      usw.) wirken nicht; Schleimklumpen ohne eigenen Tod-Sound; die
      Synthese der Sounds beim ersten Spawn ist im Browser ungemessen. Der
      Band-Shader ist nur offline geprüft (Desktop-Treiber, glslang), nicht
      im Browser (`three-engine/renderers/ooze/`).
      **Stand (Fix-Session 2026-09-14):** nicht geändert. Gold-Popup an der
      Spitze bestätigt (Designfrage, welcher Punkt besser wäre); Slider,
      Tod-Sound und Messungen sind Feature, Asset oder Browser-Arbeit.

- [ ] **Held: Reste** (laut hero)
      Ein abgelehntes Anheuern bleibt stumm (`hero:rejected` hat keinen
      UI-Listener). Lädt das GLB nicht, ist der Held unsichtbar. In der
      Lauf-Schieß-Pose startet der Tracer bis 0,2 m neben dem Lauf, weil die
      Mündung fest aus der Zielpose kommt (`HERO.muzzle` in
      `configs/hero.config.ts`). Explosivmunition ohne Flächenschaden, kein
      Mündungsfeuer, keine eigenen Sounds. Nicht in `totalDPS`, DPS-Rampe und
      NEXT sehen ihn nicht. Stufe 2 aus PLAYER_AGENCY_CONCEPT (ganzes
      Straßennetz) offen (`docs/HERO.md`).
      **Stand (Fix-Session 2026-09-14):** nicht geändert. `hero:rejected` ohne
      Anzeige bestätigt (auch `ability:rejected`, ein Toast-System gibt es
      nicht), die Form der Rückmeldung ist offen; ohne GLB nur `console.warn`;
      Tracer-Versatz nur im Browser prüfbar; `totalDPS` bewusst ohne ihn.

- [ ] **Fähigkeiten: Reste** (laut abilities)
      Keine eigenen Sound-Assets für Frost und EMP, der Laser-Ton sitzt am
      Startpunkt; Eiskristalle und Funken wirken an großen Modellen
      (Wurmring 7 m) klein; die Bot-Zählung des Lasers nimmt die Mittellinie
      ohne den 5-m-Radius des Strahls; ein späteres
      Angriffssystem der Gegner muss `movement.isHalted()` fragen. Die
      Bots strategist und meta erforschen und nutzen Frost, EMP und Laser,
      ihre Trainingsläufe sind mit älteren nicht direkt vergleichbar
      (`docs/ABILITIES.md`).
      **Stand (Fix-Session 2026-09-14):** nicht geändert. Laser-Bot-Zählung
      bestätigt (0 bis 72 m hinter dem Anführer gegen 5-m-Radius, Näherung in
      beide Richtungen), eine Änderung verschiebt die Bot-Läufe: Entscheidung
      offen. Sounds sind Assets.

- [ ] **Fähigkeitsleiste: Kopplung und Platz** (laut abilitybar, ungesehen)
      `ABILITY_BAR_EDGE_PX` (68) hängt nur per Kommentar am SCSS der Leiste
      (`components/ability-bar/`); bei sehr niedrigen Fenstern kann die
      mittige Leiste das aufgeklappte Info-Overlay berühren. Drei Icons über
      einer NEXT-Marke (Boss, Luft, Mond) sind 34 px breit bei 28 px Marke
      (laut bloodmoon).
      **Stand (Fix-Session 2026-09-14):** Kopplung behoben, `ABILITY_BAR_PX`
      ist die eine Zahlenquelle (`49d8e06e`); drei Icons in 8 px (`f758f544`,
      bis W210 trägt keine Marke drei). Offen: Die Leiste berührt das
      aufgeklappte Info-Overlay unter etwa 483 px Canvas-Höhe (gerechnet).
      Playtest 512, 516.

- [ ] **Blutmond: Grenzen des Looks** (laut bloodmoon, bewusst so gebaut)
      Das Multiplikations-Quad tönt nur Opakes: Feuer, Projektile,
      Healthbars, Kegel, Glasteile, HQ-Marker und Portal bleiben ungetönt
      (die Decals sind seit `3f1f5fdc` getönt); Rotstich statt Entsättigung;
      die Kegel enden ohne Lichtfleck am Boden; Kosten ungemessen. Auf W35
      läuft das Banner unter dem Schleier des Boss-Intros eventuell verdeckt
      ab (z-index 5 gegen 25) (`three-engine/blood-moon/`).
      **Stand (Fix-Session 2026-09-14):** Der Banner-Befund oben ist behoben:
      Das Banner wartet auf das Ende des Boss-Intros (`1997c45b`, Playtest
      554, 556); die Kegel folgen seit
      `6a42d3a5` dem Turret. Die übrigen Grenzen sind bewusst so.

- [ ] **Boss-Intro: Reste** (laut bossintro, ungesehen)
      Kein Hindernis-Check der Kameraeinstellung (Kurven, Brücken, Hänge);
      ein offener Dialog hält das Intro nicht auf; die Tastenübersicht (H)
      nennt Esc zum Überspringen nicht (`services/boss-intro.service.ts`).
      **Stand (Fix-Session 2026-09-14):** Die Tastenübersicht nennt Esc
      (`821c0cf6`, seit `a99d0c92` für Intro-Flug und Boss-Intro, Playtest
      524, 528). Hindernis-Check und offener Dialog (überspringen oder
      aufschieben): Entscheidung offen.

- [ ] **Veteranen: Reste** (laut veterans)
      Schwellen aus Bot-Logs vom 2026-08-28 mit älterem W19-Template
      (`configs/veteran-ranks.config.ts`). Der Anker des Abzeichens wird
      einmal gemessen, Tower-Debug-Overrides verschieben es nicht mit; die
      Tentakel können über das Abzeichen reichen
      (`three-engine/renderers/tower-badge/`).
      **Stand (Fix-Session 2026-09-14):** nicht geändert (Schwellen warten auf
      Balance-Daten, der Anker betrifft nur Debug-Overrides, die Tentakel sind
      nur im Browser prüfbar).

- [ ] **Weltkarte: ungesehen** (laut worldmap)
      Zeichnen, Hover, Ziehen und Zoomen des Globus sowie das Layout von Tab,
      Sidebar-Fuß und Game-Over-Hinweis sind ungeprüft (die Komponente hat
      keinen Spec, jsdom hat kein Canvas). Der Hover-Tipp im
      Game-Over-Overlay kann abgeschnitten werden; die Bot-Ausnahme hängt an
      `botEnabled`.
      **Stand (Fix-Session 2026-09-14):** nicht geändert, nur im Browser
      prüfbar.

- [ ] **Quickfix-Paket: Reste** (laut quickfix)
      Training-`total_count` mit den Minions: siehe 1.8, Skeleton-Split.
      Recent: `hasRoutes`
      (`services/world/path-route.service.ts:160`) liegt in einem
      Root-Service; wird die Spielkomponente in derselben Seite neu erzeugt,
      bleibt der alte Wert bis zum nächsten Leeren (ungeprüft, ob das
      vorkommt). Research-Queue: Wer auf eine Voraussetzung wartet, lässt
      spätere Einträge vor (neue Regel, mit Frost, EMP und Laser ungetestet).
      Entscheidung offen (User, Playtest 2026-09-14 zu alter Liste 36): ob ein
      gesperrter Knoten überhaupt anklickbar sein und seine fehlenden
      Voraussetzungen mit einreihen soll (`7914062f`), oder wie vorher gesperrt
      bleibt.
      Der Beschwörungskreis ist mit Bloom exakt gleich hell nur über einer
      Straße der Helligkeit 0,3 (`CIRCLE_STREET` in
      `three-engine/renderers/marker/spawn-portal-glow-material.ts`).
      `TowerLifecycle.turnToGuardIfClear()` nimmt an, dass Kill-All die
      einzige Tötung ohne Split ist (`managers/game-state/tower-lifecycle.ts`).
      **Stand (Fix-Session 2026-09-14):** Research-Queue entschieden: gesperrt
      wie vor `7914062f` (`a1bcb3d5`, Playtest 508, 509). `hasRoutes` weiter
      ungeprüft (zwei Routen in `app.routes.ts`, die Spielkomponente kann neu
      entstehen); Kreis und `turnToGuardIfClear` bewusst so.

- [ ] **Hover-Pick nimmt den ersten statt des vordersten Towers** (laut perf, nicht nachgestellt)
      `ScreenPicker.raycastTowers()` (`three-engine/screen-picker.ts`)
      liefert den ersten getroffenen Tower in Einfügereihenfolge; stehen zwei
      Tower auf dem Schirm hintereinander, kann der hintere gewinnen.
      **Stand (Fix-Session 2026-09-14):** behoben, der nächste Treffer über
      alle Tower gewinnt (`57858cb0`, Playtest 523); die Kosten nach einem
      Treffer sind nicht gemessen.

- [ ] **Sprung zu Welle N: Wellenzähler** (laut wavejump)
      Was nur `wave:completed` mitzählt, bekommt übersprungene Wellen nicht
      mit; neue Zähler dieser Art müssen `wave:jumped` abonnieren. Rückwärts
      springen gibt es nicht.
      **Stand (Fix-Session 2026-09-14):** nicht geändert. Die Ladungen der
      Fähigkeiten zählen mit: `GameStateManager.jumpToWave` ruft
      `abilityManager.advanceWaves(skipped)`; der Hinweis für neue Zähler
      bleibt.

- [ ] **Replay: Re-Simulation durch Determinismus-Blocker verhindert** (laut replay)
      Das Replay zeigt nur, was die Renderer gezeigt haben (`docs/REPLAY.md`).
      Eine Re-Simulation aus Wellenstart und Befehlen scheitert heute an:
      ungeseedetem `Math.random()` beim Spawn (Seitenversatz, Flughöhe;
      `EnemyManager.spawn()`) und bei der Spawnpunkt-Wahl
      (`WaveManager.selectSpawnPoint()`, Standard `'random'`); der Tower-LOS
      aus GPU-Readbacks gegen gestreamte Tiles (`losReady`, Zellhöhen beim
      Nachladen); der Turmdrehung, die das Feuern freigibt, im Renderer
      (`advanceTurretAim`); den Simulationsdiensten als Singletons des
      laufenden Spiels. Zufall, GPU-LOS und Zellhöhen stehen auch in
      `docs/MULTIPLAYER_CONCEPT.md`, Abschnitt 2; Turmdrehung im Renderer und
      Singleton-Dienste kommen dazu. Die Befehle der Welle stehen
      schon als Klartext im Log, darauf kann eine Re-Simulation aufsetzen.
      **Stand (Fix-Session 2026-09-14):** außer Scope, nicht angefasst.
      **User 2026-09-14 (Playtest 553):** Replay als eigenes Thema angehen;
      Ziel ist eine vollständig korrekte Wiedergabe, keine Krücke. Playtest
      553 bis dahin zurückgestellt.

- [ ] **Replay: Lücken und ungemessene Kosten** (laut replay, ungesehen)
      Nicht wiedergegeben: Schadenszahlen, Gold-Popups, Aufblitzen der
      Kettenblitze, Eis-Explosionen der Eis-Treffer, Bodenmarken
      (angehalten), Gegner-Sounds, Ooze-Blubbern, Flammen-Loop, Verlauf des
      HQ-Feuers, Boss-Tod-Shake, Ringe des Helden; Upgrades nicht Schritt für
      Schritt. Gegner, die zwischen zwei Frames spawnen und sterben, fehlen.
      Die Aufnahme kostet in jsdom etwa 0,8 ms je Spielsekunde, im Browser
      ungemessen; Stichproben bis 48 MB, Events geschätzt bis 15 MB, die
      Spalten bleiben nach der ersten großen Welle reserviert. Landet im
      Replay eine Fähigkeit, räumt das Verlassen auch deren Effekte im
      Live-Spiel ab. Die Boss-Intro-Sperre in `ReplayService.enter()` hat
      keinen Test (`services/replay.service.ts`). Aus review5 bewusst offen:
      Ein Replay-Tower-Modell, das beim Verlassen noch lädt, bliebe danach
      stehen (praktisch nicht erreichbar); die Replay-Leiste stößt die Change
      Detection mit 20 Hz an (nicht gemessen). Seit `cd4036d9` läuft das
      Replay unter 20 Bildern je Sekunde langsamer als sein Tempo.
      **Stand (Fix-Session 2026-09-14):** Die Boss-Intro-Sperre in `enter()`
      hat einen Test (`8404cd10`). Archer, Lightning und Tentacle zeichnen
      ihre Zielrichtung je Frame auf (`18d7cef7`, 23 B je Turm und Frame),
      ihre Blutmond-Kegel sollten im Replay mitdrehen (aus dem Code;
      Playtest 553 zurückgestellt). Die übrigen Lücken sind nicht geändert.

- [ ] **Review-Fixes: bewusst ausgelassen** (laut fix2 und fix3)
      Die Portal-Shader-Inhalte haben keine eigene Spec (review2, zweiter
      Teil von Befund 14). Der Raycast-Cache von `BodyAim` verfällt nicht bei
      einem Debug-Override der Tip-Höhe. Fließt eine Ooze über einen
      Wellenwechsel ins HQ, zählt sie in der neuen Welle noch einmal als Leck
      (im normalen Ablauf endet eine Welle erst ohne Gegner). Die Drossel des
      HQ-Shakes läuft auf der Wanduhr. Der Flammenkegel prüft den Ooze-Körper
      an zwei Stichproben, schräg kreuzend kann ein Treffer fehlen. Ein
      Neubau des Routengraphen in der Pause zeigt den Helden erst beim
      Fortsetzen. Die Bot-Strategien der Fähigkeiten rechnen
      `enemiesFromProgress` je Strategie. Weitere Eingangsverschiebungen des
      ONNX-Modells seit April (außer Forschungsquote und Held-DPS) sind nicht
      untersucht.
      **Stand (Fix-Session 2026-09-14):** eingeordnet, nicht geändert; die
      Portal-Shader-Spec ist zurückgestellt.

---

## 1.10 Befunde aus dem Playtest 2026-09-14 (gesammelt, nicht behoben)

> Gesammelt beim Durchgehen der offenen Playtest-Listen auf
> `sprint/night-2026-09-14`; gefixt wird in einer eigenen Session. Weitere
> Befunde dieses Playtests stehen bei ihren Themen: Korridor (Autos und
> Vorgärten, orange Zellen im Haus) in 1.7 "Routenkorridor: Restpunkte",
> Run-Dump und zurückgestellte Balance-Punkte in 2.2.

- [ ] **Route unter einer Brücke: Gegner, Zellen und Linie verschwinden**
      Paris, Brücke vor dem Eiffelturm (alte Liste 14): Die Route läuft am Quai
      an den Brückenköpfen vorbei, an zwei größeren Stellen verschwinden dort
      Gegner, Zellen und Routenlinie. Vermutung (unbelegt): die Straße führt
      unter den Brückenrampen durch, OSM markiert das nicht als Tunnel, die
      Tiles verdecken alles darunter. Diagnose: `__corridor.pick()` an der
      Stelle, `__routes.describe()` (Tags), `__rg.dumpCellsInBox` um die
      Pick-Koordinaten.
      **Stand (Fix-Session 2026-09-14):** zuerst nur Diagnose, kein Fix ohne
      Daten. Fünf Hypothesen aus dem Code (H1 bis H5 in
      `docs/REVIEW_FIX_2026-09-14.md`); `__corridor.pick()` zeigt jetzt Säule,
      Überbau, Kamerasicht und OSM-Tags (`8f47fc4b`). Nach den Paris-Daten
      aus Playtest 564: die Route liegt auf der Brücke selbst (Way
      986589650), Ursache aus dem Code: das runde Ende der Zufahrt zog die
      ersten Meter des Decks auf den Kai. Fix `427443a6`, durch Specs belegt,
      im Browser ungesehen; offen bleibt H2 (Zufahrt ohne Brücken-Tag noch
      über dem Kai). Nachtest 564 (Nacht-1-Runde O, alte Liste 14).
- [ ] **Upgrade per U ohne sichtbares Feedback** (Nacht-1-Liste 105): Beim
      Drücken von U mehr sichtbare Rückmeldung (Aufblitzen des Towers, Zahl,
      Panel-Hinweis), auch wenn nichts bezahlbar ist.
      **Stand (Fix-Session 2026-09-14):** umgesetzt (`68f69772`): Welttext über
      dem Tower, Kachel-Blitz, bei Ablehnung der Grund. Playtest 517 bis 520.
      Seit `a2198b2a` dieselbe Rückmeldung auch beim Klick auf eine Kachel
      (Wunsch aus 517, Nachtest ok); 520 ist damit in einem Teil überholt.
- [ ] **Tastenübersicht prominenter öffnen** (105): Sie geht mit H oder ?,
      braucht aber einen sichtbaren Knopf in der Oberfläche.
      **Stand (Fix-Session 2026-09-14):** Knopf "Keys" im Sidebar-Fuß
      (`edb6d630`). Playtest 524.
- [ ] **Intro-Flug: nur Esc und Maus brechen ab** (106): Heute bricht jede
      Taste das Intro ab, und der Sprung (Pos1, N) folgt nicht. Wunsch: nur Esc
      und Mausklick brechen ab, andere Tasten wirken erst nach dem Intro oder
      gar nicht.
      **Stand (Fix-Session 2026-09-14):** umgesetzt (`f94813b7`), andere Tasten
      wirken im Flug gar nicht; die Tastenübersicht nennt Esc für den Flug
      (`a99d0c92`). Playtest 525 bis 528.
- [ ] **Hover-Reichweite beim Ziehen auf dem Tower** (107): Drückt man die
      Maustaste auf dem Tower, um die Kamera zu ziehen, erscheint die
      Reichweite trotzdem; sie soll bei gedrückter Taste ausbleiben.
      **Stand (Fix-Session 2026-09-14):** umgesetzt (`b1b684dd`). Playtest 521,
      522.
- [ ] **Screenshot: Logo als Wasserzeichen und URL** (Nacht-1-Liste 145):
      Beim "Save screenshot" im Photo Mode zusätzlich das Logo als
      Wasserzeichen und unten links dezent `https://3dtd.sgeht.net`
      einbacken.
      **Stand (Fix-Session 2026-09-14):** umgesetzt (`2e2b266c`; wo die
      Attributionsleiste bis unter die Adresse reicht, rückt diese über die
      Logos, `794415b3`). Playtest 557 bis 559. Nach Wunsch aus 557 stehen
      Logo und Adresse seit `81ad0b9b` als ein Block unten rechts über der
      ganzen unteren Zeile, die Adresse mit dunkler Kontur; das ersetzt den
      Rückfall aus `794415b3`. Nachtest 557, 558 ok.
- [ ] **Onboarding-Tipps überarbeiten** (146): Die Funktion geht, aber der
      frühe Tipp zum Research Center ist unsinnig; Reihenfolge und Inhalt der
      Tipps neu festlegen.
      **Stand (Fix-Session 2026-09-14):** 7 Tipps entlang des Spielablaufs nach
      Vorschlag des Workers (`4a219445`, Key `td_onboarding_v2`), der
      Center-Tipp kommt nach Welle 2. Playtest 502 bis 507: 502 bis 504 ok,
      506 und 507 per Test. Befund 505: der Knopf "Tips" beginnt seit
      `1d8d2aaa` beim ersten offenen Schritt des laufenden Spiels (Deutung,
      dass 505 den Knopf meinte, vom User nicht bestätigt); Nachtest offen.
- [ ] **Fähigkeiten erst nach der Forschung in der linken Leiste** (User):
      Heute stehen gesperrte Fähigkeiten gedimmt mit Schloss von Anfang an in
      der Leiste (Entscheidung der Nachtschicht 2, `3769d8e3`). Wunsch: ein
      Knopf erscheint erst, wenn seine Forschung fertig ist.
      **Stand (Fix-Session 2026-09-14):** umgesetzt (`586f493e`), der
      Gesperrt-Zustand ist entfernt. Playtest 510 bis 513.
- [ ] **Blutmond-Scheinwerfer an die Turmdrehung koppeln** (User): Der Kegel
      soll in Schuss- bzw. Blickrichtung des Turms zeigen und mit ihm drehen,
      statt unabhängig um die Wachrichtung zu schwenken
      (`three-engine/renderers/searchlight/`).
      **Stand (Fix-Session 2026-09-14):** umgesetzt (`6a42d3a5`; die
      Replay-Aufnahme je Frame für Türme ohne Turret-Teil kam mit `18d7cef7`).
      Playtest 549 bis 553. Der Kegel zeigte bis `a7c29cca` um 180° verkehrt
      (Befund 501); danach 501 und 549 bis 552 ok, 553 zurückgestellt
      (Replay als eigenes Thema).
- [ ] **HQ umsetzen in dichter Stadt: lange Bedenkzeit ohne Rückmeldung**
      (User, z. B. Paris): Nach dem Umplatzieren des HQ vergeht spürbar Zeit
      (Route, Korridor-Messung, Grid-Neubau), ohne dass die Oberfläche etwas
      zeigt. Fortschritt oder zumindest einen Hinweis anzeigen; vorher messen,
      welcher Schritt die Zeit kostet (`[Corridor] clearance`/`rebuild`,
      Routensuche).
      **Stand (Fix-Session 2026-09-14):** teilweise. Hinweis-Chip mit
      Korridor-Prozent (`ac5eafee`), Zeitlogs (`5bdce997`, Ausgang `ended=`
      seit `4044c44a`). Nicht schneller; welcher Schritt dauert, zeigt erst die
      Messung in Paris. Playtest 541 bis 544.
      Messung Paris (541, 544): die Korridor-Messung war gedrosselt (0,46 s
      Rechenzeit über 5,3 s), 17 s kostete das Nachladen der Straßen von
      Overpass. Beschleunigt mit `b8f837fc` (32-ms-Scheiben unter dem
      Hinweis), `2eb908b4` (erste Messung erst nach dem Intro-Flug),
      `0bd7cf6d` (nächster Overpass-Server nach 4 s), `3eb5a26e` (nur der
      fehlende Teil der Box), Log je Versuch `3c472037`. Nachtest 541: 2,5 s
      statt 6,1 s (Ziel etwa 1 s noch nicht erreicht); 544 nicht erneut
      gemessen.
- [ ] **Beim Ortswechsel bleibt der alte Korridor sichtbar** (User): Während
      ein neuer Ort lädt, sieht man noch den Korridor bzw. die Zellen (falls
      das Overlay an ist) des alten Orts. Beim Start des Ladens abräumen.
      **Stand (Fix-Session 2026-09-14):** behoben (`4132607f`), die Overlays
      stehen am neuen Ort gleich nach dem Grid-Schritt (`a99e7095`). Playtest
      535, 536.
- [ ] **Portal an einer Kurve falsch ausgerichtet; Spawn drehbar machen**
      (User, Screenshots `C:\Users\joerg\Pictures\Screenshots\Screenshot
      2026-09-14 105455.png` und `105627.png`): Beginnt die Route an einer
      Kurve (Kreisverkehr), steht das Tor quer zur Route; die Route verlässt es
      seitlich am Pfeiler, die Gegner laufen durch die Wand des Portals.
      Ausrichtung am tatsächlichen Routenverlauf der ersten Meter statt am
      ersten Segment prüfen. Dazu: beim manuellen Setzen oder Verschieben des
      Spawns soll man ihn drehen können (etwa mit R wie beim Tower).
      **Stand (Fix-Session 2026-09-14):** Das Portal zielt auf den Punkt, an
      dem die Route die Vorderfläche verlässt (`5a061423`; Ursache aus dem
      Code, der Screenshot-Ort ist nicht nachgestellt); R dreht es beim Setzen
      (`8e79069f`). Playtest 529 bis 534. Nach Befund 529 (Entscheidung
      User): R dreht nur im Rahmen, in dem die Route durch die Öffnung läuft
      (`bfd2d312`), die Vorschau steht und dreht wie das Portal (`71ad5120`),
      die Route beginnt am Fußpunkt des Spawns auf der Straße (`83565c40`),
      die Vorschau gleitet (`f6568d7a`, `4e4ace28`); Nachtest 529 offen.
- [ ] **Favoriten: Knopf weg bei 10 Einträgen, volles CRUD** (User): Mit 10
      Favoriten verschwindet das Speichern, weil `canAddFavorite` fest
      `favorites().length < 10` ist (`tower-defense.component.html:29`); die
      Oberfläche sagt nicht, warum. Wunsch: Favoriten anlegen, umbenennen,
      löschen (gibt es), ordnen; beim Speichern nur ein vorbefüllter,
      änderbarer Namensvorschlag. Grenze klären (höher, weg oder mit Hinweis
      "Liste voll").
      **Stand (Fix-Session 2026-09-14):** umgesetzt (`a30d8412`), keine Grenze
      (User), Name beim Speichern, umbenennen, ordnen. Playtest 537 bis 540.
- [ ] **zombie_v2 ohne bewegte Vorschau** (User): In der Modellvorschau
      (docs/MODEL_PREVIEW.md) steht zombie_v2 still, statt animiert zu laufen.
      **Stand (Fix-Session 2026-09-14):** teilweise. Behoben ist die
      Fehlrahmung (`909fba4b`, die Kamera zielte auf die Füße); ein Stillstand
      ist nicht belegt, in jsdom läuft der Clip. Playtest 515.
      Nach Befund 515 (Rahmung noch falsch, zu dunkel): Rahmung mit den
      Debugger-Werten des Users (`b2631a18`, ersetzt den Wert aus
      `909fba4b`), zu dunkel war der fehlende `metallicFactor` im GLB
      (`814dec34`). Nachtest 515 ok; ein Stillstand war nicht belegt.
- [ ] **Spawn-Vorschau immer rot** (Nacht-1-Liste 132): Beim Umsetzen des
      Spawns ist die Portal-Vorschau am Cursor auch an gültigen Stellen rot;
      das Setzen klappt und die Karte unten zeigt die Gültigkeit richtig.
      **Stand (Fix-Session 2026-09-14):** behoben, es war nur die Farbe
      (`23483121`). Playtest 531.
- [ ] **Einstellung "Impact Effects" ohne Wirkung** (Nacht-1-Liste 126): Der
      Knochen-Puff beim Skeleton-Split bleibt auch ausgeschaltet. Prüfen,
      welche Effekte die Einstellung abdecken soll und ob sie überhaupt noch
      irgendwo gelesen wird.
      **Stand (Fix-Session 2026-09-14):** kein Code-Defekt gefunden, die
      Einstellung wirkt auf den Knochen-Puff (Test `0b1dbdf4`). Vermutung,
      unbelegt: gesehen wurde der Todesclip. Playtest 514.

# PRIO 2 — Balance & Phase-5.16-Followups

> Aktueller Stand des parked Branches `feature/phase5.5-economy-ai-prep` — nach PRIO 1
> oder zwischendurch wenn Engine-Themen blockiert sind.

## 2.1 Tower-Balance

- [ ] **Schadensarten gegen Rüstungsarten viel deutlicher spreizen**
      Playtest 2026-09-10: Das Schadens- und Rüstungssystem hat zu wenig Einfluss.
      An manchen Gegnern sollen sich bestimmte Tower wirklich die Zähne
      ausbeißen, das Delta zwischen guter und schlechter Paarung muss deutlich
      größer werden.
      Stand in `combat/damage-matrix.config.ts` (Quelle MASTER_GAME_DESIGN.md
      2.3): Außer bei `ethereal` (0,15 bis 1,75) liegen fast alle Werte zwischen
      0,5 und 1,5. Gegen `unarmored` reicht die Spanne nur von 0,8 bis 1,2,
      gegen `light` von 0,7 bis 1,3, der beste Tower macht dort also nur das
      1,5- bis 1,9-Fache des schlechtesten.
      Beim Anpacken:
      - Ziel-Spreizung pro Rüstungsart festlegen, erst in MASTER_GAME_DESIGN.md,
        dann in der Matrix.
      - Folgen prüfen: Die Capability-Gates und der Fairness-Gate des
        Wave-Directors setzen voraus, dass die passende Tower-Art verfügbar ist;
        die Trainings-Bots und die Economy-Kurve (`npm run economy-chart`,
        `npm run tower-stats-chart`) ebenfalls.
      - Die Schwellen für die Schadenszahlen-Farben (`EFFECTIVENESS_THRESHOLDS`)
        an die neue Spreizung anpassen.
      Verwandt: 3.3 Damage & Armor System.
      **Stand 2026-09-12:** umgesetzt auf dem Sprint-Branch (`5b3102e`, Matrix
      nach `BALANCE_PROPOSAL_2026-09.md`, Fairness-Floor 0,6). Bestätigung im
      Playtest steht noch aus.


## 2.2 Phase 5.16 Playtest + Followups

> **Stand 2026-09-07:** Der Wave Director ist **regelbasiert und clientseitig**
> (`src/app/ai/core/rule-director.ts` + `gate-controller.ts`). Das ONNX-Modell
> liegt noch unter `public/assets/ai/wave-director/`, wird aber nicht mehr geladen
> — nur noch per explizitem `WaveDirectorService.loadModel()`. Die Difficulty-Knobs
> (`endgameHpMultiplier`, `enemyBaseDamageForWave`) und das Curriculum sitzen
> unverändert **hinter** dem Director und gelten für beide Pfade.
>
> **Ältere Notiz (2026-05-11):** Checkpoint ep 7350 wurde gegen das alte
> Reward-System trainiert; Schema v2 (162 Features) macht ihn ohnehin unladbar.
> Kontext: [HANDOVER_PLAYTEST_PHASE5.16.md](docs/archive/HANDOVER_PLAYTEST_PHASE5.16.md).
>
> **Architektur-Status:** Phase 5.10 hat das Template-System geshipped (18 Templates,
> 4 Reward-Terme, State 156, Hard-Constraints im Decoder). Bei Tuning gilt:
> **Templates zuerst, nicht Reward-Weights** — Reward-Landscape ist minimal (DEATH,
> DRAMA, SWARM_SIZE, PROGRESSION) und sollte ohne neue Exploits stabil bleiben.

- [ ] **Live-Playtest Phase-5.16-Balance**
      Erwartete Knackpunkte: W1-7 zugänglich (Air-Debüt W7 mit AA-Forschung), W10 Boss
      fordernd (Cannon nötig), W13 Ghost-Surge erfordert Magic, W15-20 sichtbare
      HP-Steigerung, Gold zwischen W10-30 knapp. Notizen sammeln wo's hakt/zu leicht/teuer/billig
      ist. Tool: `npm run economy-chart` regeneriert `docs/economy-chart.html` nach
      jeder Curriculum-Änderung.

- [ ] **Boss-Frequenz ab W31 verdichten**
      Plan war: ab W31 Bosse alle 5 Waves statt 10. Nicht implementiert — Curriculum
      loopt einfach mod-30. Override in `templateForWave()` für
      `wave > 30 && wave % 5 === 0`.
      Datei: `src/app/configs/wave-curriculum.config.ts`.
      **Stand 2026-09-12:** umgesetzt auf dem Sprint-Branch (`9e46b11`: jede
      fünfte Welle ab W31 Boss, zwei neue Boss-Templates, Boss-Gold ×2).
      Bestätigung im Playtest steht noch aus.

- [ ] **Wave-Curriculum Gold-Budget feinjustieren**
      Nach Live-Playtest: `goldKill`/`goldComplete` in `wave-curriculum.config.ts` anpassen.
      Nach jeder Änderung `npm run economy-chart` für Sanity-Check.
      **Stand 2026-09-12:** Nach dem Balance-Umbau steigt der Puffer bis W30 von
      25 % auf 83 %. Wer W30 mit mehr als 150k Gold oder über 20 Towern
      erreicht: Gold für W16 bis W30 um 20 % kürzen (Vorschlag §2.5).

- [ ] **Run-Dump je Welle als Feedbackschleife fürs Balancing**
      Playtest 2026-09-14 (alte Liste 4, Balance bis W30): Ohne Daten je Welle
      lässt sich die Balance nicht sinnvoll prüfen. Gewünscht ist ein
      vollständiger Dump des ganzen Laufs von Welle 1 bis Game Over, als Datei
      exportierbar, damit Claude beim Balancing und Feintuning die Sachlage
      und den Verlauf auswerten kann. Nicht nur Einzelwellen, sondern der
      komplette Verlauf:
      - eine Zeitleiste aller Ereignisse mit Spielzeit und Welle (Bau, Upgrade,
        Verkauf, Forschung, Fähigkeit, Held-Befehl, Leck, Boss-Spawn, Tod),
      - Stichproben im Takt (etwa jede Sekunde Spielzeit: Gold, HQ-HP, lebende
        Gegner, Gesamt-DPS der Verteidigung), damit Kurven über den ganzen Lauf
        entstehen,
      - dazu je Welle ein Abschluss-Datensatz:
        - Gold: Stand zu Wellenstart und -ende, Einnahmen nach Quelle
          (Kill-Gold, Abschlussbonus, Meilensteine, Cheat-Gold), Ausgaben nach
          Zweck (Bau, Upgrade, Forschung, Fähigkeiten, Held), Verkäufe.
        - Welle: Nummer, Template und Zusammensetzung, Director-Entscheidung
          und Fairness-Gate-Werte, Boss-Variante (Wurm, Ooze), Blutmond, Dauer
          in Spiel- und Wanduhrzeit, Tempo.
        - Gegner: gespawnt, getötet (nach Quelle: Tower, Held, Fähigkeit),
          Lecks, HQ-HP vorher und nachher.
        - Tower: Typ, Position, Stufe und Upgrades, Schaden und Kills in dieser
          Welle, Zielwahl; Forschung, Fähigkeiten (Einsatz, Wirkung), Held
          (Stufe, Munition, Kills).
      - ein Lauf-Kopf: Ort, Route, Build/Commit, Director-Modus, Cheats und
        Wellensprünge (damit solche Läufe erkennbar sind), am Ende das
        Ergebnis (erreichte Welle, Grund des Endes).
      Dasselbe Format auch für Bot-/Trainingsläufe, damit Menschen- und Bot-Läufe
      vergleichbar sind. Vorher prüfen, was schon erfasst wird (RunStats und
      Game-Over-Übersicht, AIDataCollector und Snapshot-Teile des Encoders,
      JSONL-Logs des Trainings-Backends) und darauf aufbauen statt ein zweites
      System daneben zu stellen.
      Richtung laut User (2026-09-14):
      - Transport vermutlich über das Trainings-Backend (WebSocket :3001), das
        die Läufe als Dateien in einen Ordner schreibt, den Claude lesen kann.
      - Muss in echten Welten (Google 3D Tiles, beliebiger Ort) genauso gehen
        wie in DevWorld, mit allen Inhalten (Held, Fähigkeiten, Bosse,
        Blutmond, Forschung).
      - Drei Datenquellen fürs Balancing: menschliche Spieler, die
        Strategie-Bots und der Regel-Director. Das soll reichen; das
        PPO/ONNX-Training ist vermutlich endgültig obsolet.
      - Deshalb zuerst sichten, was aus der Trainings-Infrastruktur verwertbar
        ist (WebSocket-Client, Server, Logger, AIDataCollector, Snapshot-Teile,
        Bot-System, Training-Session, Dashboard) und was mit dem ONNX-Pfad
        wegfallen kann (siehe "Re-Training auswerten": Entscheidung, ob der
        ONNX-Pfad entfällt).
      Bestand (Sichtung 2026-09-14, Pfade unter `src/app/`):
      - `ai/core/ai-data-collector.service.ts:348` `onWaveResult()` meldet jede
        Welle, auch die tödliche (bei `game:over` schließt der Collector sie
        selbst ab, `:317`): bester Einhängepunkt. `WaveOutcome`
        (`ai/core/models/wave-result.ts:37`) hat Spawns, Kills, Lecks,
        Fähigkeits-Kills, HQ-Schaden, Fortschritt, Gegner je Typ; Lücken:
        `towerPerformance` wird nie gefüllt, `enemyPerformance.totalDamageDealt`
        bleibt 0, `preWaveSnapshot` wird nie gesetzt, Zeiten sind Wanduhr durch
        Trainings-Tempo statt Spielzeit.
      - `GameStateSnapshot` (`ai/core/models/game-state-snapshot.ts:15`) liefert
        Gold, HP, Verteidigung (DPS je Rüstung, Abdeckung, Tower-Verteilung),
        Lücken, DPS-Profil entlang der Route, Forschung.
      - `services/infrastructure/run-stats.ts` (`RunStatsTracker`): nur
        Run-Summen und Lecks/HQ-Schaden je Welle, nur im Speicher.
      - Gold: jede Buchung sendet nur `credits:changed{credits, delta}` ohne
        Quelle; die Aufteilung des Wellenbonus (Basis, Perfect, CloseCall,
        Milestone, Comeback, Combo, `services/economy.service.ts:48`) wird nicht
        gesendet, `wave:completed.credits` ist immer 0 (`managers/wave.manager.ts:449`).
      - Director: `WaveConfig` mit Zusammensetzung kommt über
        `command:start-wave`; die strukturierte Begründung
        (`ai/core/decision-explainer.ts:39-66`) wird nicht gespeichert;
        Fairness-Gate über `gate.status` (`ai/core/gate-controller.ts:88`).
      - Backend: `training-backend/utils/logger.py:32` schreibt
        `logs/training_*.jsonl` mit `wave_state`, `wave_generated`,
        `wave_result`, nur wenn ein Trainingslauf verbunden ist. Fehler dabei:
        `server.py:449` liest `outcome.perfect`, das Feld gibt es in
        `WaveOutcome` nicht, im Log steht immer `None`.
      - Download im Browser nur privat in `services/debug/debug-state-dump.service.ts:99`
        (Dev-Knopf "Dump", ohne Spieldaten); keine gemeinsame Hilfe.
      - Replay-Recorder (`replay/replay-recorder.ts`) sieht über `onAny` alle
        Events der letzten Welle, speichert aber nichts dauerhaft.
      **Anforderung (User 2026-09-14): alle Lücken schließen, "wirklich
      perfekt".** Konkret heißt das:
      - Jede Lücke oben ist behoben, nicht umgangen: Speicherung auch ohne
        Trainingslauf, `towerPerformance` und Schaden je Gegnertyp gefüllt,
        `preWaveSnapshot` gesetzt, Zeiten in Spielzeit, Gold-Buchungen mit
        Quelle, Aufteilung des Wellenbonus gesendet, `wave:completed.credits`
        korrekt, Director-Begründung strukturiert gespeichert,
        `server.py`-Feld `perfect` repariert, eine gemeinsame Download-Hilfe.
      - Die Daten gehen auf: Startgold + Summe der Einnahmen − Summe der
        Ausgaben = Endgold je Welle und über den Lauf; gespawnt = getötet +
        geleckt + noch lebend; Schaden und Kills je Tower summieren sich zu den
        Wellensummen. Diese Abgleiche laufen als Specs und im Dump selbst als
        Prüffelder.
      - Gleiche Daten in DevWorld und echten Welten, bei 1x bis 75x, mit
        Menschen, Bots und Director, mit allen Inhalten (Held, Fähigkeiten,
        Wurm, Ooze, Blutmond, Wellensprung, Cheats markiert).
      - Versioniertes, dokumentiertes Format (eigene Doku, z. B.
        `docs/RUN_LOG.md`) und ein Auswerte-Skript, das einen oder viele Läufe
        zu Kurven und Kennzahlen je Welle zusammenfasst.
      - Kein spürbarer Laufzeit-Preis im Spiel (Budget festlegen und messen),
        keine Allokationen im Sub-Step.
      - Spielstand im Lauf-Kopf, damit nach einer Änderung nie ein Log eines
        alten Stands mit einem neuen verglichen wird: Spielversion
        (`BUILD_VERSION` aus `configs/build-info.config.ts`, heute `v0.2.0`,
        per Hand mit `package.json` synchron), Git-Commit und Dirty-Flag (beim
        Build eingebettet), ein Fingerabdruck (Hash) aller
        balance-relevanten Configs (Curriculum, Tower, Gegner, Schadensmatrix,
        Forschung, Fähigkeiten, Held, Boss-Varianten, Economy) und die
        Format-Version des Dumps. Das Auswerte-Skript gruppiert nach
        Fingerabdruck und warnt, wenn Läufe verschiedener Stände gemischt
        werden. Nebenbefund: `ai/training/training-session.ts:502` meldet dem
        Backend fest `gameVersion: '1.0.0'` statt der echten Version.
      Balance-Fragen, die auf den Run-Dump warten (aus den Playtest-Listen
      zurückgestellt oder offen als Entscheidung):
      - REVIEW_SPRINT_2026-09-12.md: alte Liste 4 (Matrix, Boss-Takt, Gold bei
        W30), 38 (Chaos an W16/W18), Entscheidung 2 (Chaos-Preis 200, Vorschlag
        220 bis 250).
      - REVIEW_SPRINT_2026-09-13.md: Entscheidung 1 (Atomschlag gegen Golem und
        Dragon 60 statt 20 %), Befund 6 (Skeleton-Split ungespielt).
      - Playtest-Eindruck des Users 2026-09-14: Ooze eher zu schwach, Chitin
        Worm eher zu stark (Worm erst in einem vollständigen Durchlauf
        bewerten).
      - REVIEW_SPRINT_2026-09-14.md: Entscheidungen 2 (Held-Preise), 6 (Wurm
        35 HP je Segment, bis 240), 8 (Ooze-Werte), 9 (Boss-Rotation), 12
        (Veteranen-Schwellen aus Bot-Logs), 14 (Sprung-Gold), Befund 4
        (Boss-Varianten ohne Fairness-Gate), Freischaltzeitpunkte der
        Fähigkeiten nur geschätzt.
      - PLAYTEST.md E3 (2026-09-15): Wie stark Herbert, Skarnax und Ooze je
        Welle sein sollen (HP, Tempo, Gold gegen typische Tower-DPS), passt laut
        User aktuell nicht; zusammen damit klären, welche Welle mit welcher
        Boss-Variante ins Log des Collectors gehört.
      - PLAYTEST.md E11 (2026-09-15): Gold einer jung getöteten Ooze hängt von
        der Länge ab (meist weniger, bei manchen Längen etwas mehr als vorher;
        Tabelle in `tmp/fix1/reports/oozedeath.md`), mit der Boss-Stärke klären.
      Verwandt: Live-Playtest Phase-5.16-Balance, Gold-Budget feinjustieren (oben),
      1.7 "Bot-Läufe mit den neuen Inhalten", Backlog "Training Backend
      Refactoring".

- [x] **Stone Golem ins Wave-Curriculum aufnehmen** — erledigt 2026-08-27.
      `golem_squad` hat `minWave: 14`, steht auf W15 im Curriculum und ist über
      das generierte Schema auch im Backend sichtbar.
- [x] **Frontend/Backend Wave-Template-Drift beheben** — erledigt 2026-08-27.
      Strukturell gelöst statt nur synchronisiert: `templates.py`,
      `wave_curriculum.py` und die Enemy-Tabellen in `config.py` sind gelöscht.
      Das Backend liest `training-backend/generated/ai-schema.json`, erzeugt von
      `npm run ai-schema` aus den TS-Configs. `zombie_horde` mischt jetzt
      90 % `zombie` / 10 % `zombie-v2`.
- [x] **Lightning in AI/Bot integrieren** — erledigt 2026-08-27. Schema v2 nimmt
      Lightning als 10. Tower und 8. Damage-Type auf (162 statt 156 Features);
      der Bot hat es in `ALL_COMBAT_TOWERS` und `storm-mastery` in der
      Research-Reihenfolge.
- [ ] **Re-Training auswerten** — *Ergebnis liegt vor, Konsequenz gezogen (2026-09-07)*
      Der From-Scratch-Lauf ist ausgewertet: das trainierte Netz war in A/B-Runs
      dreimal statistisch ununterscheidbar von gleichverteiltem Zufall (mittlere
      Run-Länge 45,6 [42,49] gegen 44,7 [41,48]), während zwei triviale Heuristiken
      messbar mehr Spannung erzeugten (Near-Miss 0,067–0,069 gegen 0,045). Das Netz
      hatte nie gelernt — `log_std` unverändert, alle Faktor-Mittel auf sigmoid(0).
      Ursache lag **vor** dem Lernen: das Curriculum pinnt auf 49% der Wellen das
      Template, der Fairness-Cap bindet auf 63% — die volle Spanne des
      count-Faktors bewegte eine Welle von 19 auf 28 Gegner.
      Konsequenz: Betrieb läuft auf dem Regel-Director. Offen bleibt nur noch die
      **Entscheidung**, ob das Training weiterverfolgt wird (dann zuerst
      Aktionsraum aufmachen, nicht Reward tunen) oder ob der ONNX-Pfad entfällt.
      Vollständiger Befund: [docs/HANDOVER_TRAINING_REFRESH.md](docs/HANDOVER_TRAINING_REFRESH.md).

## 2.3 Pre-Production Wave-Deployment Safeguards

> **Status:** Konzept festgehalten, **nicht implementiert**. Implementierung **nach**
> erfolgreichem Training-Run, **vor** Production-Release. Ziel: verhindern dass die AI
> auf einen einzelnen Enemy-Typ/Armor-Category kollabiert (Spider/Bat/Penguin-Spam)
> ohne die AI komplett zu überschreiben.
>
> Hintergrund: Im Training-Betrieb (Phase 5.10) ist das durch Template-System +
> Cooldowns strukturell gemildert. Beim **echten Spieler-Deployment** sind aber
> zusätzliche Inference-seitige Schichten geplant, weil ein differenziertes Netz
> trotzdem Single-Type-Waves erzeugen kann wenn Mixed-Wave-Threshold ungünstig liegt.
>
> **Hinfällig für den Regel-Director (2026-09-07):** Die beiden Decoder-Punkte
> unten adressieren beide Monotonie im Softmax des Netzes. Der Regel-Director hat
> gar keinen Softmax — er wählt das *älteste erlaubte* Template, Wiederholung ist
> damit strukturell ausgeschlossen statt nur bestraft. Relevant bleiben die Punkte
> ausschließlich, falls der ONNX-Pfad wieder produktiv wird.

- [ ] ~~**Temperature-Sampling im Decoder**~~ — nur bei ONNX relevant
      Bei Inference `softmax(probs / T)` mit T=1.5-2.0 statt `argmax`. Secondary Types
      bekommen mehr Raum ohne Neutraining. Null Training-Kosten, reiner Inference-Parameter.
      Datei: `src/app/ai/core/wave-director.service.ts` (`decodeModelOutput()`).

- [ ] ~~**Hard-Monotony-Cap im Decoder**~~ — durch die Stalest-Template-Regel erledigt
      Notbremse: max. 3 Waves in Folge mit demselben dominanten Typ — über alle
      Mixed-Groups hinweg getrackt, nicht nur `groups[0]`. Wenn Cap triggert:
      nächst-stärkster Typ im Softmax wird promoted.

- [ ] **Scripted Milestone-Waves (Constraint-based Blueprints)**
      Statt fester Typen-Listen: Designer setzt Constraints, AI komponiert innerhalb frei.
      Constraint-Typen kombinierbar:
      - `category: 'air' | 'ethereal' | 'fortified' | 'swarm'` — Armor-Klassen-Lock
      - `anchor: <EnemyTypeId>` — min. 1 Exemplar garantiert (z.B. Boss)
      - `min-count: N` — Swarm-Pflicht (Typen egal)
      - `exclude: <category | enemy>` — Blacklist
      - `preferredPattern: 'burst' | 'drip' | 'interleaved'`

      Beispiele: W10 `{ anchor: 'herbert' }`, W14 `{ category: 'air' }`,
      W22 `{ category: 'ethereal', min-count: 150 }`, W30 `{ category: 'fortified', anchor: 'mammoth' }`,
      W25 `{ min-count: 300 }`, W5 `{ exclude: 'boss' }`.

      AI kontrolliert innerhalb: konkrete Typen (aus Category-erlaubten), Verhältnisse,
      `totalCount`, `killTime`, `hpMultiplier`, `spawnDelay` + Variation, Boss-Verstärkungs-Level.
      Designer pinselt nur die **Thematik**, nicht die Bausteine.

      Skizze:
      ```ts
      interface WaveBlueprint {
        triggerWave: number;
        name: string;
        composition: Array<{ type: EnemyTypeId; countWeight: number; minCount?: number }>;
        archetype: 'boss' | 'elite' | 'mixed-heavy' | 'swarm' | 'ethereal-storm';
        preferredPattern?: SpawnPattern;
      }
      // wave-director.service.ts:
      const blueprint = blueprintLibrary.find(b => b.triggerWave === currentWave);
      return blueprint ? buildFromBlueprint(blueprint, aiParams) : normalAIGenerate(aiParams);
      ```

      Bewusst NICHT gewählt: feste Wellenliste (killt den AI-Point), Ensemble mit
      Preference-Switch (3× Training-Aufwand), rein Soft-Signals via Reward-Bonus
      (Training-Runs zeigten: reicht nicht).

---

# PRIO 3 — Game Features

> Spielbares, poliertes Tower Defense. Nach PRIO 1+2 oder als Lückenfüller.

## 3.1 Visual Feintuning

- [ ] **Bär dunkler** (Playtest 2026-09-15, bei Punkt 632)
      Das Bär-Modell wirkt viel zu hell und gelb. Material/Textur abdunkeln, im Enemy Debug gegen die anderen
      Gegner vergleichen.

- [ ] **Tank: schöneres Modell** (Playtest 2026-09-15, bei Punkt 632)
      Den Tank durch ein ansprechenderes Modell ersetzen (Modell-Budget beachten, `npm run model-budget`,
      docs/ENEMY_MODEL_BUDGET.md).

- [ ] **Stone Golem: Laufgeräusch und Beben** (Playtest 2026-09-15, bei Punkt 632)
      Besseres Laufgeräusch (schwere Schritte); dazu ein minimales Beben (Screen Shake), wenn die Kamera in der Nähe
      ist. Audio-Budget und Schalter "Screen Shake" beachten.

- [ ] **Explosions-Partikel feintunen** (nächste Runde, festgelegt 2026-09-12)
      Sprite-Sheet Partikel (Flash→Fireball→Rauch) — Timing, Größe, Farben polieren
      Betrifft Cannon- und Rocket-Einschläge. Zusammen mit
      "Advanced-Explosion-Staging" (zweistufig, Backlog) denken.
      **Stand 2026-09-12 (Runde 2):** umgesetzt (`c904b3f` bis `6686dc1`),
      Sichtprüfung steht aus.

- [ ] **Screen Shake Performance untersuchen** (nächste Runde, festgelegt 2026-09-12)
      Aktuell deaktiviert wegen Performance-Bedenken
      Messen: tatsächlicher FPS-Impact, ggf. nur bei nahen Explosionen aktivieren
      Dateien: `screen-shake.service.ts`, Display Options Toggle
      **Stand 2026-09-12 (Runde 2):** Der Shake verschiebt nur noch die
      Projektion beim Zeichnen, ohne Tile-Traversierung, und nur bei nahen
      Einschlägen (`142193c`). Messen mit `await __perf.shakeBench(5)`. Anders
      als oben steht, ist er seit `02d9d43` standardmäßig an; wer ihn aus
      sieht, hat das im localStorage gespeichert.

- [ ] **Loading Screen optimieren**
      Layout/Wirkung des Initial-Loading-Screens überarbeiten. Detaillierter Stats-Block
      und 3D-Tiles-Counter sind 2026 vorhandene Basis (siehe DONE.md), aber Polish steht
      aus. Konkretisieren beim Anpacken (Bullet-Liste was raus/rein soll).

- [ ] **Türme nach Zielverlust nicht in die Grundstellung drehen**
      Heute drehen Türme zurück, sobald kein Gegner mehr in Sicht ist
      (`updateTowerIdleRotations` → `resetRotation` in
      `tower-combat.service.ts`); das kostet bis 1 s bis zum nächsten Schuss,
      weil ein Tower erst schießt, wenn er ausgerichtet ist
      (`docs/archive/UX_DISCUSSION_NOTES.md`).
      **Entscheidung 2026-09-12:** Während der Welle in der letzten Richtung
      stehen bleiben; nach der Welle zur Stelle drehen, an der die Route in die
      Reichweite eintritt (Wachrichtung).
      **Stand 2026-09-12 (Runde 2):** umgesetzt (`c4cb08b`), dazu der
      Zielwinkel in Metern (`eb1c8c8`).

- [ ] **Kampfspuren (Heatmap Schicht 1)**
      Studie: `docs/game-design/COMBAT_HEATMAP_STUDY.md` (machbar).
      **Entscheidung 2026-09-12:** Schicht 1 umsetzen: Brand- und Kampfspuren
      als Decals auf dem vorhandenen Decal-Pool, höchstens einer pro
      Route-Grid-Zelle (dedupliziert), rein optisch, Aufwand S. Die
      Kill-Heatmap (Schicht 2) bleibt vorerst weg.
      **Stand 2026-09-12 (Runde 2):** umgesetzt (`e404806`, `412cbff`).

- [ ] **Rocket Tower: Abschuss-Sound ersetzen**
      Geschoss und Schweif sind seit dem Sprint 2026-09-11 erledigt (DONE.md
      2026-09-12). Offen ist nur der Sound: `assets/sounds/towers/rocket/launch.mp3`
      ist ein tiefer Knall (87 % der Energie unter 150 Hz), per Pitch oder
      Filter wird daraus kein Zischen, und im Repo passt kein anderer Sound.
      Anforderung an ein neues Asset in `docs/PROJECTILES.md` unter "Bekannte
      Einschränkungen" (CC0, Zischen mit Schwerpunkt 1-6 kHz, 0,6-0,9 s, mono).

## 3.2 Visual Settings (Performance-Toggles)

- [ ] **VFX Settings Menu** — Visuelle Effekte einzeln ein/ausschaltbar
      Freeze-Tint, Muzzle Flash, Trail-Streaks, Sprite-Sheet Partikel,
      Screen Shake, Bloom, Color-Grading
      Ziel: Low-End-Geräte können teure Effekte deaktivieren
      **Stand 2026-09-12 (Runde 2):** umgesetzt (`8eb765f` bis `de1b57d`):
      Effekt-Panel im Display-Menü mit Preset Low/Medium/High, Muzzle Flash,
      Trails, Impact Effects, Ground Marks, Bloom, Color Grading, Freeze Tint;
      alle Display-Optionen in `td_display_options`. FPS-Gewinn je Schalter
      ungemessen.

## 3.3 Damage & Armor System

> **Konzept:** [MASTER_GAME_DESIGN.md](docs/game-design/MASTER_GAME_DESIGN.md)
> **Status (2026-05-08):** Infrastruktur abgeschlossen (siehe DONE.md) — Types,
> Schadensmatrix, damageType/armorType an allen Configs, Flame Tower,
> Damage-Matchup-Tooltips. Offen: weitere Tower-Typen + Wave-Preview-UI.

- [ ] **Chaos Tower (`chaos`)** — Teuer, voller Schaden gegen alle Armor-Typen
      (Hinweis: `chaos` ist aktuell **nicht** im `DamageType`-Enum
      → Type erst erweitern, Matrix-Eintrag ergänzen)
      Nächste Runde (festgelegt 2026-09-12).
      **Stand 2026-09-12 (Runde 2):** umgesetzt (`0fcacd8` bis `12e9f1e`,
      Kenney-Kristallmodell), Balance-Playtest steht aus.

- [ ] **Globale Damage-Matrix-Übersicht im UI** (Optional, niedrige Priorität)
      Tooltips zeigen aktuell nur Multiplier per Tower und per Enemy. Eine globale
      "vs"-Tabelle (alle Tower × alle Armor) gibt es nicht. Eigener Sidebar-Tab oder
      Hilfe-Dialog möglich.
      **Stand 2026-09-12:** Dialog auf dem Sprint-Branch (`46c350d` bis
      `324ca45`); nach dem Playtest überarbeitet (gesperrte Tower ausblenden,
      Breite, Optik) auf `wt/fix-matrixui`, Retest steht aus.

- [ ] **Konzept: Resistenzen, Immunitäten, Schild und HP** (PLAYTEST.md E16,
      2026-09-15, erst Konzept, dann bauen). Resistenz heißt: ein Effekt oder
      Schadenstyp wirkt nur zum Teil; Immunität: gar nicht (100 %). Gewünscht
      für Effekte (Slow, Frost, Stun) und für Schadenstypen, je Gegnertyp.
      Dazu die Idee, Gegner generell in Schild und HP aufzuteilen (bisher nur
      "Schildphasen" als Boss-Feature diskutiert). Grundlage mit Ist-Stand,
      betroffenen Stellen (Gate, Training, Encoder, Matrix-Anzeigen) und
      Optionen: `tmp/fix1/reports/bossresist.md` und `immunity.md`. Schon
      entschieden: Herbert Slow-Resistenz 50 %; `immunityPercent` (Herbert
      100, wirkt nirgends) geht im neuen Feld auf. Umgesetzt vorab: Skarnax
      steht nur still, wenn sein Kopf eingefroren oder betäubt ist.

## 3.4 Wave Director — Build & Deployment

> Training-Code nicht in Prod Bundle

- [ ] **Build Configuration**
      `angular.json`: fileReplacements für Training-Code
      Production: Training-Module wird zu leerem Stub
      Bundle Size Check: AI < 300KB
      *Teilweise entschärft (2026-09-07):* `onnxruntime-web` wird nicht mehr beim
      Start importiert, sondern nur in `loadModel()` — die 404 kB liegen damit
      hinter einem Lazy-Chunk, den niemand mehr anfordert. Offen bleibt der
      Training-Code (`ai/training/`).
      **Stand 2026-09-12:** per Lazy-Loading statt fileReplacements umgesetzt
      (`85d8402`, `ab6a7c1`, `88ddc55`); Test mit Backend und DevWorld-Tab
      steht aus.

- [ ] **Model Validation** — nur relevant, falls der ONNX-Pfad produktiv wird
      `scripts/validate-model.js`
      Prüft: Format, Größe, Basis-Inference
      Läuft vor Commit (optional)

## 3.5 AI Training UI

- [ ] **Dashboard Header Styling verbessern**
      Status/Header Metriken besser stylen
      Model Metrics (Entropy, Grad Norm, etc.) als eigene Gruppe rechts
      Dezenter als Hauptmetriken, nach "Game Over" Bereich
      Dateien: `training-backend/dashboard/static/index.html`, `style.css`
      **Stand 2026-09-12:** umgesetzt (`c2ee884`), Sichtprüfung beim nächsten
      Trainingslauf steht aus.

## 3.7 UI-Feinschliff und Debug-Oberfläche

- [ ] **Tower-Debug: Kegelhöhe des Blutmond-Scheinwerfers je Tower** (Playtest 2026-09-15, Punkt 644)
      Der Lichtkegel der Gatling sitzt minimal zu hoch. Die Ansatzhöhe des Scheinwerfers je Towertyp in den
      Tower-Debug-Tools feinjustierbar machen (wie die Vorschau-Werte im Enemy Debugger), damit der User sie
      selbst einstellt und die Werte übernommen werden können.

- [ ] **Debug: Modus erzwingen (Blutmond und künftige Modi)** (Playtest 2026-09-15, Punkt 644)
      Ein Schalter in den Debug-Tools, der die Szenerie auf Blutmond zwingt, mit allem, was dazugehört (Tönung,
      Scheinwerfer, Banner, Decals, Gegnerrand), unabhängig von der Wellennummer; so gebaut, dass weitere Modi
      später dazukommen.

- [ ] **Design-Runde: Header, Next-Wave-Button, Dev-Menü**
      Playtest 2026-09-11 nach dem Sprint: Dev-Menü (zwei Spalten) und Header
      (bündig mit der Sidebar) sind funktional erledigt (DONE.md 2026-09-12),
      sehen aber noch nicht gut aus. Der Next-Wave-Button wirkt weiterhin
      billig, auch im Teal der Restart-Buttons (Idee: anderes Icon und Farbe,
      z. B. Gold für die wichtigste Aktion), die Header-Optik ist
      unspektakulär, das Dev-Menü mit seinen zwei Button-Spalten ist nicht
      hübsch. Gemeinsam gestalten statt einzeln, mit visuellem Feedback.
      **Entscheidung 2026-09-12:** über Design-Canvas-Mockups (Artifact), die
      der Nutzer zurechtklickt; danach setzt ein Worker exakt das um.
      **Stand 2026-09-12:** Canvas "3DTD Header und Dev-Menü" mit dem
      heutigen Stand und drei bzw. zwei Richtungen liegt als Artifact vor,
      Auswahl des Nutzers steht aus. Befunde dabei: JetBrains Mono wird im
      Spiel nicht geladen (Ersatzschrift), der aktive Dev-Toggle ist gold mit
      Teal-Glow (vermutlich nicht beabsichtigt), die Farben in
      `docs/DESIGN_SYSTEM.md` sind teils veraltet.

---

- [ ] **Idee: Forschung als eigener Dialog mit echtem Forschungsbaum**
      (User, 2026-09-14): statt der heutigen Liste ein eigener Dialog, der den
      Baum visuell zeigt (Knoten, Voraussetzungen als Kanten, Fortschritt,
      Queue). Verwandt: offene Entscheidung zur Queue mit Voraussetzungen
      (1.9, Quickfix-Reste) und die neuen Knoten für Held und Fähigkeiten.

# BACKLOG

> Langfristig, bei Bedarf.

## Training Backend Refactoring

- [ ] **training-backend Struktur verbessern**
      Aktuell alles flach, besser in Module aufteilen:
      - `core/` - model.py, trainer.py, reward.py
      - `utils/` - logger (tui_logger + auto_logger mergen)
      - `scripts/` - export, analyze (bereits teilweise)
      Import-Pfade in server.py anpassen
      **Stand 2026-09-12:** umgesetzt (`058df7a`), Test mit einem echten
      Trainingslauf (Checkpoint laden) steht aus.

## Performance - Advanced

- [ ] **zombie_v2-Modell extern weiter optimieren**
      Frames gegenüber dem alten `zombie.glb` aktuell deutlich schlechter, sichtbar
      vor allem bei sehr großen Waves (>2k Enemies). Externe Mesh-/Material-/
      Animations-Optimierung am Modell selbst (Polycount, Skeleton-Komplexität,
      Texturgrößen, VAT-Frame-Count, ggf. Splitting in LOD-Stufen) — kein
      Code-Fix, sondern Asset-Pass. Backup liegt als
      `public/assets/models/enemies/zombie_v2.original.glb.bak` vor.
      **Festgelegt 2026-09-12:** auf alle Gegnermodelle ausweiten: erst alle
      vermessen (Dreiecke, Knochen, Texturgrößen, VAT-Frames), die schwersten
      zuerst optimieren; das Blender-Werkzeug (MCP) ist angebunden.
      **Stand 2026-09-12 (Runde 2):** alle vermessen
      (`docs/ENEMY_MODEL_BUDGET.md`, `npm run model-budget`), VAT backt nur
      noch sichtbare Frames (`be5eaa0`, `fd18a10`: 664,6 auf 485,6 MB, aus
      den Modelldateien gerechnet). Die
      Mesh-Optimierung in Blender ist offen (siehe 1.7). Das oben genannte
      `zombie_v2.original.glb.bak` gibt es im Repo nicht.
      **Stand 2026-09-13 (Nacht):** VAT als RGBA16F, wo der Fehler im Spiel
      höchstens 2 mm beträgt (486,6 auf 264,7 MB, `e948529`), opak gezeichnet,
      wo kein Alpha nötig ist (`eb3b7da`), CPU-Kopie nach dem Upload
      freigegeben, laut Rechnung 264 MB weniger Tab-Speicher (`ec878b6`). In
      der Blender-Runde zombie_v2 von 31 342 auf 4 870 VAT-Vertices mit neu
      gebackener Textur (`4c8d21c`, `b09d24d`); VAT aller Typen jetzt 105,2 MB
      (siehe 1.7). Playtest steht aus.

- **Verworfen: Enemy Movement auf SoA (Structure of Arrays)**
      Nicht erneut als Teilumbau angehen. Gebaut in `bd1d3a5`, zurückgenommen in
      `731f454` (2026-08-22): 13 % langsamer als die Objektvariante (0,071 gegen
      0,063 ms pro 1000 Gegner und Substep). Die Gegner bleiben Objekte, weil
      Combat, Targeting, Events und Route-Grid sie so ansprechen; `setPosition`
      und `lookAt` schreiben dadurch weiter in verstreute Objekte, und der
      Staging-Pass kostet mehr, als die Lokalität der Eingabe-Arrays bringt.
      Sinnvoll nur als Komplettumbau, bei dem auch Position und Rotation in Arrays
      liegen und `presentFrame` direkt daraus liest. Vorbehalt aus dem Revert:
      gemessen unter jsdom, im Browser nie nachgemessen.

- [ ] **Object-Pooling für Projektile** - Pool-Größe: 500 pro Typ
      ⚠️ GPU-Instancing existiert bereits — Entity-Pooling (JS-Objekte) nochmal prüfen ob GC-Druck messbar ist
- [ ] **Tower-Model-LOD-System** - Three.js LOD: High/Medium/Low
- [ ] **BVH für Terrain Raycasts** - 50ms → 0.5ms (weniger kritisch, siehe Hinweis in PERFORMANCE_REPORT)
      Stand 2026-09-12: three-mesh-bvh ist nicht im Projekt, Raycasts gegen die
      Tiles laufen Dreieck für Dreieck. Nutzen bei Laden, Terrain-Sweeps,
      Platzier-Vorschau und Intro-Sampling, nicht bei den FPS in Wellen;
      Kosten: BVH-Aufbau pro Tile beim Laden, mehr Speicher. Erst messen, wie
      viel Zeit Raycasts heute kosten.
      **Stand 2026-09-12 (Runde 2):** Messung eingebaut (`072d29f`,
      `__raycastStats()`), Entscheidung nach dem Playtest.
      **Stand 2026-09-13 (Nacht):** Der größte gemessene Brocken, die
      Korridor-Messung (520 ms am Stück), läuft in 4-ms-Scheiben (`879ad8b`).
      Entscheidung weiter nach dem Playtest.
      **Messung Playtest 2026-09-14** (alte Liste 27, Details in
      REVIEW_SPRINT_2026-09-12.md): Ein Strahl kostet 0,1 bis 0,45 ms. Beim
      Laden eines echten Orts laufen gut 6 s Raycasts (`streets` 3,2 s mit
      einem Burst von 502 ms, `routeGrid` 1,9 s mit 696 ms, `routeCorridor`
      0,9 s). In einer Welle mit Platzieren 4,2 s in 101 s, davon
      `towerFootprint` 1,6 s und `towerRange` 1,0 s; `towerRange` und
      `routeGrid` haben dort Bursts von je 110 ms, also sichtbare Hänger beim
      Setzen eines Towers. (Stand 2026-09-14: der `towerRange`-Anteil ist mit
      dem Stencil-Reichweitenring `225c42dd` weggefallen, der Ring kommt ohne
      Raycasts aus.) In Ruhe spielt die Kamera dank Cache kaum noch eine
      Rolle (`cameraControls` 454 Aufrufe in 101 s).
      Einschätzung: BVH lohnt sich für Laden und Platzieren, die Bursts beim
      Setzen und die Sockel-Abtastung würden am meisten gewinnen; für die FPS
      in einer ruhigen Welle bringt es wenig. Offen: Entscheidung, dann
      Speicher und Aufbauzeit je Tile messen.
- [ ] **Web Worker Offloading** - weitere rechenintensive Logik
      Pathfinding läuft bereits im Worker (`pathfinding-worker.service.ts`).
      Übrige Kandidaten (Collision-Checks, Wave-Director-Inference,
      Audio-Decoding) bringen wenig; für die FPS in Wellen kein Hebel.
- [ ] **Tower GPU Instancing** - Schwierig wegen Rotationen

## Game-Loop Performance (Speed-Multiplikator)

> **Kontext:** Beim AI-Training mit hohen Speed-Multiplikatoren (x75) wurde Mitte 2026-05 der Substep-Fix eingebaut — Movement/Hittest/Status-Restzeit laufen jetzt mathematisch korrekt N× pro Frame. Beim normalen Gameplay mit aktivem Rendering brachen daraufhin die FPS bei x2/x4 sichtbar ein. Erste Hypothese (microStep/frameStep-Refactor) wurde profilet (`.profiles/`, 2026-05-07) und **falsifiziert**: ~80% der x4-Cost waren **gar nicht der Game-Loop**, sondern der `ModelPreviewService` (rotierende 3D-Modelle in der Sidebar) der pro Frame `WebGLRenderer.setSize()` aufrief und damit den WebGL-Drawingbuffer reallozierte. Der Fix (Renderer auf Max-Size + setViewport pro Preview) hat den Hot-Path eliminiert: x4 läuft jetzt mit 10.8% Idle-Reserve und 1.3% Dropped-Frames (vorher 0% Idle, 46% Drops). Damit ist das Symptom weitgehend gelöst, die folgenden Punkte sind nur noch optionale Mini-Hebel.

- [ ] **microStep/frameStep-Trennung** (LOW PRIO, nur bei Bedarf)
      `update()`-Kette aufteilen: `microStep(dt)` läuft N× pro Frame und enthält nur substep-kritisches (Movement, Hittest, Status-Restzeit-Decrement). `frameStep(totalDt)` läuft 1× pro Frame und enthält Targeting, Spatial-Grid-Rebuild, VFX/Audio-Trigger, Three.js-Sync, Signal-Emits.
      Aktuell **nicht dringend** — bei x4 mit ~1000 Enemies bleibt 10% Idle-Reserve. Erst bei extremen Setups (>2000 Enemies, x10+) wieder relevant. Determinismus für x75-Training muss erhalten bleiben.
      Startpunkte: `src/app/services/game-loop-facade.service.ts`, `src/app/managers/enemy.manager.ts:285`, `src/app/managers/projectile.manager.ts`, `src/app/managers/status-effect.manager.ts`.
      Einschätzung 2026-09-12: Nach dem Hot-Path-Umbau (21 → 48 FPS bei 20k)
      lohnt das nur noch bei extremen Speed-Faktoren im Training und gefährdet
      die Deterministik; weit hinten lassen.

- [ ] **Training-Bot-Snapshots lazy berechnen** (LOW PRIO)
      Stand 2026-09-11: war bereits umgesetzt (`updateBot(() => snapshot, dt)`
      mit `tickCooldown`), im Sprint nur Tests ergänzt (`f3b0c79`). Kann nach
      einem Trainingslauf geschlossen werden.
      Im Substep wird für den Bot ein kompletter State-Snapshot erzeugt, bevor klar ist,
      ob der Bot wegen Reaction-Cooldown überhaupt eine Entscheidung trifft. Bei x75 viele
      teure Snapshots pro gerendertem Frame.
      Lösung: Lazy-API (`needsBotDecision(dt)` oder `updateBotLazy(() => snapshot, dt)`) —
      der Cooldown tickt weiter pro Substep, der Snapshot wird erst nach Cooldown-Ablauf
      gebaut. Tests: Bot im Cooldown → Snapshot-Funktion nicht aufgerufen; nach Cooldown
      → genau einmal.
      Dateien: `src/app/services/facade/game-loop-facade.service.ts`,
      `src/app/ai/core/ai-data-collector.service.ts`,
      `src/app/ai/training/bots/base-tower-bot.ts`.

## Visual Effects - Advanced

- [ ] **Advanced-Explosion-Staging** - 2-Stage Explosionen
- [ ] **Terrain-Decals bei Waffenbeschuss** — Scorch Marks, Krater-Optik, Einschusslöcher, Burn Areas
      Basiert auf existierendem GPU-Instanced Decal System (Blood/Ice Decals)
      Neue Shader in `decal-shaders.ts`, Configs in `visual-effects.config.ts`
      Dateien: `decal-instance.manager.ts`, `three-effects.renderer.ts`, `vfx.service.ts`

- [ ] **Selective / lokales Post-Processing für Effekt-Hotspots**
      Bloom (und ggf. weitere Post-FX) nur an konkreten Effekt-Positionen statt global.
      Hintergrund: erste Lightning-Tower-Iteration hat Auto-Bloom global eingeschaltet —
      Fullscreen-Pass mit Threshold 0.75 ließ alle emissiven Materialien dauerhaft leuchten
      (Gegner, Health-Bars, Particles). Sauberer Weg: Three.js Selective Bloom via
      Render-Layers — Bolts/Hotspot-Meshes auf eigener Bloom-Layer, zweiter EffectComposer
      rendert nur diese Layer in ein Off-Screen-Render-Target, das additiv über die normale
      Szene komponiert wird. Erst experimentell evaluieren (Lightning-Bolts, Explosions-Cores,
      ggf. Magic-Orb-Highlights) bevor in die Pipeline gehoben.
      **Stand 2026-05-11:** Pragmatischer Workaround für Lightning-Impacts sitzt in
      `lightning-bolt.renderer.ts` (additive Billboard-Halos via Sprite-Pool, AdditiveBlending,
      Radial-Gradient-CanvasTexture). Funktioniert weil additiv komponiert wird — Tiles
      reagieren bekanntlich nicht auf dynamische Lichter. Echtes Selective-Bloom-Setup für
      weitere Effekt-Kategorien (Explosions-Cores, Magic-Orb-Highlights) steht weiterhin aus.
      Dateien: `three-engine/post-processing/post-processing-pipeline.ts`,
      `three-engine/renderers/lightning-bolt.renderer.ts`, `three-engine/three-tiles-engine.ts`.

- [ ] **Spawn-Portal statt Spawn-Marker** (Idee, 2026-09-12)
      Der schwebende Diamant am Spawn wird zum Portal, im Stil des Dunklen Portals aus
      WoW Burning Crusade: Die Gegner kommen aus einer anderen Dimension und treten
      durch das Portal auf die Route.
      Mögliche Bausteine: Portalrahmen am Routenanfang auf dem Boden statt schwebendem
      Marker, wirbelnde Portalfläche (Shader), Spawn-Effekt beim Durchtreten (Funken,
      Verzerrung), stärkeres Pulsieren bei Wellenstart.
      Zu beachten: Die Marker-Geometrie steht in `configs/marker-geometry.config.ts`.
      Intro-Flug (Marker als Hindernis und Motiv) und Totale (Framing) lesen daraus,
      ein Portal am Boden ändert diese Maße.
      Dateien: `services/world/marker-visualization.service.ts`,
      `three-engine/renderers/marker/marker-instance.manager.ts`.
      **Stand 2026-09-13 (Nacht):** umgesetzt (`a214973` bis `cc8da0f`):
      Steintor am Routenanfang (`spawn-portal.manager.ts`), Wirbel in der
      Spawnfarbe, Aufflammen bei Wellenstart, Burst beim Durchtreten, Portal als
      Platzier-Vorschau. Playtest steht aus.

## Mobile Support & Accessibility

- [ ] **Mobile-Qualitäts-Presets**
      Low (1.0 pixelRatio, 50% Partikel), Medium, High (Retina)
      Auto-Detect via `navigator.userAgent`
- [ ] **Mobile Breakpoints hinzufügen**
      Breakpoints: 768px (Tablet), 480px (Mobile)
- [ ] **Touch-Targets auf 44px vergrößern**
      Mobile usability (Apple/Google Guidelines)
- [ ] **ARIA-Labels zu Icon-Buttons**
      Accessibility (Screen Reader)

## Electron Desktop-Build

- [ ] **3DTD als Windows-Desktop-App (Electron) ausliefern**
      Eigenes `desktop/`-Unterprojekt mit `app://`-Protokoll, Dev-/Prod-Modus und
      NSIS-Installer. Proof-of-Concept am 2026-05-16 erfolgreich durchgespielt
      (Spiel lief im Fenster, Installer gebaut) und wieder zurueckgebaut. Vollstaendiger
      Plan inkl. Architektur-Entscheidungen, Best-Practice-Haertung, Cesium-Token-
      Runtime-Config und Code-Signing-Kostenuebersicht:
      [ELECTRON_DESKTOP_PLAN.md](docs/ELECTRON_DESKTOP_PLAN.md).

## Terrain & Routing Experimente

- [ ] **Laterales Sampling nur auf Routen** - Aktuell wird getGroundHeightEstimate für alle gefilterten Straßen aufgerufen (4 Extra-Raycasts pro Punkt). Optimierung: nur für Straßen die tatsächlich Routen sind das teure laterale Sampling nutzen, restliche Straßen im Korridor mit einfachem Raycast + Smoothing rendern
- [ ] **Gewässer von OSM laden** - `natural=water`, `waterway=river/stream/canal` über Overpass abfragen. Gewässer als unpassierbare Zonen ins Routing einbeziehen → Brücken werden natürliche Chokepoints (Engstellen). Optional: Gewässerflächen visuell auf der Karte darstellen

## Gameplay-Konzepte

- [ ] **Konzept: Tech Tree des Helden** (PLAYTEST.md E18 "Held Stufe 2",
      2026-09-15). Der Held braucht vermutlich viel mehr Möglichkeiten; eine
      Stufe 2 erst mit dem passenden Tech Tree. Drei Vorschläge (Forschung
      "Heavy Gear", nur Look ab 100 Kills, ganzes Straßennetz) mit Werten und
      Aufwand in `tmp/fix1/reports/herotier2.md`.

- [ ] **Konzept: Spieler aktiver ins Geschehen einbinden**
      Idee 2026-09-10. Heute baut der Spieler nur und schaut zu; er braucht
      eine Möglichkeit, während einer Wave aktiv mitzumischen. Kandidaten:
      - **Held**, der aktiv mitkämpft und vom Spieler herumgeschickt wird
        (Klick auf ein Ziel, Bewegung über das Straßennetz).
      - **Weitere Gebäude mit Aufgaben** statt Schaden: Gold farmen, Drohnen
        aussenden, Pickup-Items aufsammeln usw. Vorbild für ein Nicht-Kampf-
        Gebäude ist das Research Center.
      - **Nuklearschlag** mit Cooldown, über den Research-Tree freischaltbar.
      Beim Ausarbeiten mitdenken:
      - Economy: Gold-Farm und Pickups greifen ins Gold-Budget des
        Wave-Curriculums (`npm run economy-chart`).
      - Wave-Director und Fairness-Gate lesen die Verteidigungsstärke aus den
        Towern; Held, Drohnen und Nuke müssen dort mitzählen, sonst passt der
        Director die Waves nicht an.
      - Die Trainings-Bots brauchen eine Strategie dafür oder ignorieren es
        bewusst.
      - Spieleraktionen im Sub-Step verarbeiten, damit die Simulation
        deterministisch bleibt (siehe MULTIPLAYER_CONCEPT.md).
      Ergebnis sollte ein Konzept in `docs/game-design/` sein, bevor gebaut wird.
      **Stand 2026-09-12:** Konzept liegt vor
      (`docs/game-design/PLAYER_AGENCY_CONCEPT.md`, Empfehlung Nuklearschlag
      zuerst). Nächster Schritt laut Nutzer: Konzept gemeinsam schärfen (Name
      der Fähigkeit, ob Fähigkeits-Kills für den Gate-Regler als Leck zählen,
      Ladungen pro Welle), erst danach bauen.
      **Entscheidung 2026-09-12:** Konzept geschärft (Abschnitt 7 im
      Konzept): Nuklearschlag, Kills zählen als Leck, 1 Ladung, nachladen
      nach je 3 Wellen, 60 % Max-HP (Bosse 20 %), 25 m, 1,5 s Vorwarnung mit
      Einschlag auf der nächsten Route-Zelle (30 m), Forschung (1.000 Gold,
      40 s, nach `advanced-weaponry`, voraussichtlich nach dem ersten Boss),
      sofort eine Bot-Strategie, danach der Held. Gebaut wird später.
      **Stand 2026-09-13 (Nacht):** Nuklearschlag gebaut (`94213b0` bis
      `44b8741`, Fix `cf6b6ee`, `docs/ABILITIES.md`), der Held ist offen.
      Playtest steht aus.

## Tower-Ideen

> Siehe auch: [MASTER_GAME_DESIGN.md](docs/game-design/MASTER_GAME_DESIGN.md)
> Tesla / Chaos sind bereits in PRIO 3.3 (Damage & Armor) gelistet — hier nur Verweis.

## Enemy-Ideen

> Siehe auch: [MASTER_GAME_DESIGN.md](docs/game-design/MASTER_GAME_DESIGN.md)

- [ ] **MechaCat** - Roboter-Katze als neuer Gegner-Typ
      Model bereits vorhanden: `public/assets/models/enemies/candidates/mechacat_01.glb`
- [ ] **Ghost** - `ethereal` Rüstung, nur Magic/Chaos wirkt (nächste Runde, festgelegt 2026-09-12)
      Stand 2026-09-12: gibt es schon (`ghost` in `enemy-types.config.ts`, im
      Curriculum auf W13, W18 und W23); der Eintrag kann weg.
- [ ] **Skeleton** - `unarmored`, Swarm (nächste Runde, festgelegt 2026-09-12)
      **Stand 2026-09-12 (Runde 2):** umgesetzt (`a177026`, `3f9b854`:
      Kenney-Modell, `skeleton_swarm` auf W19).
      **Stand 2026-09-13 (Nacht):** Ein im Kampf getötetes Skeleton spaltet
      sich in zwei `skeleton-minion` (`99178cd` bis `0557aba`), Playtest steht
      aus.
