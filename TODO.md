# TODO

**Offene Arbeit steht nur hier.** Handover, Berichte und Playtest-Listen führen keine eigenen Listen, sie verweisen
hierher. Offene Nachtests stehen in [docs/PLAYTEST.md](docs/PLAYTEST.md), Erledigtes in [DONE.md](DONE.md) (nur auf
Zuruf), Überholtes in `docs/archive/` und in der Git-Historie.

- Ein Eintrag hat eine bis drei Zeilen: was, Status, Beleg nur wo nötig.
- Die Kennungen (A1, C4, ...) bleiben stabil. Ein erledigter Eintrag geht nach DONE.md, seine Nummer wird nicht neu
  vergeben. Neues kommt ans Ende der passenden Gruppe.
- Konzepte und Pläne bekommen ein eigenes Dokument, hier steht nur der Verweis.

Stand 2026-09-16, Branch `next`.

---

## A. Vor dem Merge nach `main`

- [ ] **A1 Herkunft von 7 Gegnermodellen klären** (Ghost, Hornet, Mech, Wraith, Herbert, Stone Golem, zombie_v2),
      Einträge in `attributions.config.ts` nachtragen. Liegen seit Januar bis Mai schon auf `main`. Die Quelle des Bären
      heißt "masha-and-the-bear" (Figurenrechte ungeprüft). Status: offen, Klärung.
- [ ] **A2 Benchmark mit 20.000 Gegnern gegen `main`**: gleicher Ort, gleiche Kamera; FPS, Frame-Zeit, GPU- und
      Tab-Speicher, Chrome-Trace je Sub-Step. Vergleichsstand im eigenen Worktree. Status: offen, Messung.
- [ ] **A3 Ladezeit und Grafikspeicher gegen `main`**: kalter und warmer Cache, Zeit bis spielbar, `__perf.stats`.
      Status: offen, Messung.
- [ ] **A4 Nachtests K1 bis K3** ([docs/PLAYTEST.md](docs/PLAYTEST.md)). Danach nach DONE: Korridor einmal messen und
      einfrieren (K1, K2), Kragsteine an der Dachkante (K3.4), Skarnax mit Textur, Beinen, Schwanz und Stimme (K3.1,
      K3.2), Tank-Modell (K3.3). Status: wartet auf den User.
- [ ] **A5 Merge-Ablauf**: Code-Stopp; Replay testen oder den Knopf ausblenden; Build aus frischem Klon mit dem
      CI-Befehl, dann Gate; Tag auf dem heutigen `main` als Rückweg; `next` sichern (liegt nur lokal). Ein Push auf
      `main` deployt ohne Tests sofort nach `/play/`.

## B. Entscheidungen (User)

- [ ] **B1 ONNX-Modell und Training behalten oder entfernen?** Das Netz war nicht besser als Zufall, der Betrieb läuft
      auf dem Regel-Director ([HANDOVER_TRAINING_REFRESH.md](docs/HANDOVER_TRAINING_REFRESH.md)). Bei "entfernen"
      fallen F7, die offenen Trainings-Prüfungen (DONE.md 2026-09-14) und Teile von E1 weg.
- [ ] **B2 BVH für Raycasts gegen die Tiles noch nötig?** Die teuren Messungen laufen seit dem Korridor-Umbau im
      Ladescreen. Stand 2026-09-14: ein Strahl 0,1 bis 0,45 ms, Bursts beim Setzen eines Towers und bei der
      Sockel-Abtastung. Erst entscheiden, dann Speicher und Aufbauzeit je Tile messen.
- [ ] **B3 Zellen parallel zur Route** statt im festen Gitter: Konzept
      [ROUTE_ALIGNED_CELLS_CONCEPT.md](docs/ROUTE_ALIGNED_CELLS_CONCEPT.md) liegt seit 12.09.; Playtest 747 zeigte,
      wie empfindlich das Gitter ist.
- [ ] **B4 748 behalten oder zurücknehmen** (Kette und Knick-Rahmen), nach K1. Zurücknehmen: Kette
      `git revert 5b527ec2 d6e679b7 d8c05568 75be147c`, Knick `git revert 47b29354 d35a753e`.
- [ ] **B5 Straßen-Overlay und Intro-Flug auf die eingefrorenen Zellhöhen umstellen?** Beide haben heute eine eigene
      Höhenabfrage neben dem Korridor (`getStreetHeightEstimate`, Flugprofil).
- [ ] **B6 Skarnax-Ringe** stehen neben einem Transporter 16,6° schräg im Korridor: stört das? (mit K3.2)
- [ ] **B7 Zweiter Modus der roten Linie** (`centreMode: 'minimal'`): einmal gegen die Bandmitte vergleichen oder den
      Schalter entfernen.
- [ ] **B8 Suchscheinwerfer auf `displayLight` umstellen?** Ändert seinen Look mit Bloom. Das DevWorld-Gitter und
      `/engine-test` schreiben ebenfalls ohne Ausgabe-Kodierung.
- [ ] **B9 Atompilz auf Grafikstufe Low** noch einmal ansehen? (User: später)
- [ ] **B10 Feste Spawns für weitere Showcase-Orte**: braucht Koordinaten vom User; Tokyo und Rio sind fest.
- [ ] **B11 Doku-Struktur**: `PERF_BUG_ANALYSIS_2026-05-28.md` archivieren, Abschnitte 0 bis 6 von
      `game-design/PLAYER_AGENCY_CONCEPT.md` abtrennen?
- [ ] **B12 32 Worker-Entscheidungen gesammelt bestätigen** (im Playtest ohne Einwand, nie ausdrücklich), dazu
      "Shader-Prüfung mit glslangValidator bleibt manuell". Die Entscheidungen stehen in `docs/archive/`:
      REVIEW_SPRINT_2026-09-11 Nr. 1; -12 Nr. 1, 4, 7; -13 Nr. 3 bis 14, 16 bis 18; -14 Nr. 1, 4, 5, 11, 13, 16, 17,
      19 bis 21, 24, 26, 28.

## C. Bugs: Korrektheit (alle niedrig oder ungeprüft)

- [ ] **C1 Tower-Sichtlinie für Zellen ohne Höhe** rechnet auf der Höhe des Routenankers (`route-grid-los.ts:54`,
      `:66`), die Gegner stehen dort anders.
- [ ] **C2 Luftgegner kurz nach dem Tor**: Auf den ersten 43 bis 47 m fliegen sie tiefer als die 15 m, für die die
      Air-LOS gilt; der Drache ist breiter als jede Toröffnung (`AIR_PORTAL_EXIT`). Nie gesehen.
- [ ] **C3 Straßen laden kann ewig hängen**: Die Overpass-Abfrage hat nur für die Header ein Zeitlimit
      (`OVERPASS_HEADER_TIMEOUT_MS`), nicht für die Antwort.
- [ ] **C4 Zufalls-Spawn nach dem Runden** auf 5 Stellen kann näher an einer anderen Straße liegen, schlimmstenfalls
      ohne Route; der Straßen-Cache rundet auf 4 Stellen. Aus dem Code, nicht beobachtet.
- [ ] **C5 `hasRoutes`** im Root-Service (`path-route.service.ts`) bleibt beim Neuaufbau der Spielkomponente eventuell
      veraltet. Ungeprüft.
- [ ] **C6 Dauergeräusche von Skarnax und Ooze**: `EnemyManager.destroy()` beendet ihre Loops nicht, nur `clear()`.
      Ungeprüft, ob hörbar.
- [ ] **C7 Onboarding zählt eventuell Ereignisse aus dem Replay** mit. Ungeprüft.
- [ ] **C8 `computed` ohne Signalquelle** (Muster des Tower-Schlaf-Bugs) in `los-legend.component.ts:35` und
      `icon.component.ts:188`. Ungeprüft.
- [ ] **C9 Grafikspeicher nach Kontextverlust**: Nach einem Context-Restore werden die ersetzten VAT-Texturen nicht
      freigegeben. Ungeprüft, ob es kostet.

## D. Bugs: Kosmetik und Debug

- [ ] **D1 Spawn-Portal an engen Stellen und Hängen**: Pfeiler in Fassaden, Lichtfleck am Hang schief. Ungesehen.
- [ ] **D2 Vorschau dreht weiter**, wenn das Fenster bei gehaltenem R den Fokus verliert (auch beim Tower); lädt das
      Rahmenmodell spät, bleibt die Vorschau undurchsichtig (`map-placement.service.ts`).
- [ ] **D3 Held anheuern ohne Route** zeigt den Text für "Befehl ohne Weg" ("No way there along the routes").
- [ ] **D4 "Skarnax Tail"** steht in den Gegnerlisten von Custom Wave und Enemy Debug.
- [ ] **D5 DevWorld: Intro-Flug** rechnet mit `PATH_HEIGHT_OFFSET = 1`, die Linie liegt dort 3 m hoch
      (`intro-camera-flight.service.ts`).
- [ ] **D6 Enemy Debugger: Regler "Offset Y"** reicht nur bis ±3, manche Gegner brauchen 5 bis 7; Ziehen überschreibt.
- [ ] **D7 "COMING UP"** zeigt eine falsche Spanne, nur bei ausgeschaltetem Director (Debug). Vorschlag: streichen.

## E. Features, als Nächstes

- [ ] **E1 Run-Dump**: ein ganzer Lauf als Datei fürs Balancing. Anforderungen, Bestand und die wartenden
      Balance-Fragen: [docs/RUN_DUMP_PLAN.md](docs/RUN_DUMP_PLAN.md).
- [ ] **E2 Replay als Neu-Simulation** statt Aufzeichnung; Ziel ist eine vollständig korrekte Wiedergabe (User,
      Playtest 553). Blocker und heutige Lücken: [docs/REPLAY.md](docs/REPLAY.md).
- [ ] **E3 Bär dunkler**: wirkt zu hell und gelb; im Enemy Debug gegen die anderen vergleichen.
- [ ] **E4 Stone Golem: Laufgeräusch und Beben**: schwere Schritte, leichter Screen Shake in Kameranähe (Schalter
      "Screen Shake" beachten).
- [ ] **E5 Raketen-Sound**: `launch.mp3` ist ein tiefer Knall; neues Asset nach `docs/PROJECTILES.md`, "Bekannte
      Einschränkungen" (CC0, Zischen 1 bis 6 kHz, 0,6 bis 0,9 s, mono).
- [ ] **E6 Tower-Debug: Kegelhöhe des Blutmond-Scheinwerfers** je Towertyp einstellbar (Gatling sitzt zu hoch).
- [ ] **E7 Debug: Modus erzwingen**: Schalter, der Blutmond mit allem Zubehör unabhängig von der Welle erzwingt,
      erweiterbar für weitere Modi.
- [ ] **E8 Tower gezielt aus- und einschalten**, z. B. per Schalter im Tower-Panel.
- [ ] **E9 Offscreen-Marker klickbar**: Klick fährt die Kamera zum Gegner.

## F. Messungen

- [ ] **F1 Anteil beleuchteter Tile-Materialien** (`MeshStandardMaterial` gegen `MeshBasicMaterial`), dann Lichter
      reduzieren oder Tiles einheitlich unlit.
- [ ] **F2 Skarnax-Pfad bei 75-facher Geschwindigkeit**: hochgerechnet etwa 3 statt 1 ms je Frame (240 Ringe).
- [ ] **F3 Audio-Aktualisierung je Sub-Step**: `AudioComponent.update()` für jeden Gegner mit Laufgeräusch.
- [ ] **F4 Ungemessene Grafik- und CPU-Kosten**: Laser-Säule, drei Stencil-Pässe der Reichweitenringe, Kegel-Upload,
      Drehbereichssuche des Portals, `buildBand` im Spiel.
- [ ] **F5 Kalter Start ohne Intro auf 2,5 m**; `__raycastStats()` beim Boss-Intro.
- [ ] **F6 Grobe Kamera-Tiles**, wo die Korridor-Region kein Tile hat: antwortet eines davon?
- [ ] **F7 Laser-Bot** braucht 2,9 ms je Entscheidung bei 1500 Gegnern (hängt an B1).

## G. Konzepte, erst besprechen

- [ ] **G1 Resistenzen, Immunitäten, Schild und HP** je Gegnertyp. Entschieden: Herbert Slow-Resistenz 50 %,
      `immunityPercent` geht im neuen Feld auf. Grundlage: `tmp/fix1/reports/bossresist.md`, `immunity.md`.
- [ ] **G2 Tech Tree des Helden** (Stufe 2 erst damit). Drei Vorschläge mit Aufwand: `tmp/fix1/reports/herotier2.md`.
- [ ] **G3 Forschung als eigener Dialog** mit echtem Baum (Knoten, Kanten, Fortschritt, Queue).
- [ ] **G4 Explosivmunition des Helden mit Flächenschaden** (`hero.config.ts`).

## H. Ideen und Backlog

- [ ] **H1** logDepth-Experiment: `logarithmicDepthBuffer` aus, `camera.near` 5 bis 10 m; nur mit Vorher/Nachher.
- [ ] **H2** Loading Screen überarbeiten (noch unkonkret).
- [ ] **H3** Object-Pooling für Projektile, erst prüfen, ob GC-Druck messbar ist.
- [ ] **H4** Tower-LOD (High, Medium, Low).
- [ ] **H5** Tower-Instancing (schwierig wegen der Rotationen).
- [ ] **H6** Simulationsschritt und Frame entkoppeln (`microStep`/`frameStep`); lohnt nur bei extremen Speed-Faktoren.
- [ ] **H7** Explosionen zweistufig staffeln.
- [ ] **H8** Bloom nur für ausgewählte Objekte (Render-Layers, zweiter Composer).
- [ ] **H9** Mobile und Barrierefreiheit: Qualitäts-Presets, Breakpoints 768 und 480 px, Touch-Ziele 44 px,
      `aria-label` an allen Icon-Buttons.
- [ ] **H10** Electron-Desktop-Build ([ELECTRON_DESKTOP_PLAN.md](docs/ELECTRON_DESKTOP_PLAN.md)).
- [ ] **H11** Gewässer aus OSM als unpassierbare Zonen (Brücken als Engstellen).
- [ ] **H12** MechaCat als Gegner (`enemies/candidates/mechacat_01.glb`, Lizenz fehlt).
- [ ] **H13** Straßen parallel zu den Tiles laden, kleinere Box.
- [ ] **H14** Raumindex für `findNearestStreetPoint`.
- [ ] **H15** Hitze-Verzerrung beim Orbitallaser.

## I. Aufräumen: Code, Tests, Werkzeuge

- [ ] **I1 Code-Reste**
  - `try/finally` im Korridor-Rückfall (`onFallbackLevel`), Listener erst entfernen, dann anhängen (Klarheit, kein
    Fehler).
  - Zwei Tower-Zähler könnten auseinanderlaufen (`store.towerCount` gegen `GameStateManager.towerCount()`,
    spekulativ).
  - Totes Signal `loadingStatus`, `hasStreets()` ohne Aufrufer.
  - `RefusalHintService` und `UpgradeHintService` zusammenlegen.
  - Pathfinding-Worker startet nie (`PathRouteService.initializeWorker()` ohne Aufrufer): anbinden oder entfernen.
  - Typen im Worker doppelt (`pathfinding.worker.ts`).
  - `loadingPercentage` ohne Leser und falsch gerechnet (`asset-manager.service.ts`); ungelesenes `computed` in
    `td-rich-tooltip.directive.ts`.
  - `111320` und `Math.PI/180` statt gemeinsamer Konstanten (`tower-placement.service.ts`, `route-geometry.ts`).
  - `isMixedWave` ohne Leser (`wave-debug.service.ts`).
  - Tote `createLineGeometryWithDistances()`, ungenutzter Parameter `_color` (`route-animation.service.ts`).
  - Info-Ausgaben in der Konsole im Normalbetrieb; 231 überflüssige `export`.
  - Überflüssiger Parameter `resolution` bei den Spawn-Distanzringen (`spawn-distance-rings.ts`).
  - Trace-Klammer in `onTilesLoaded` ohne `try` (`visualization-facade.service.ts`).
  - Falsches Label `climb` an einer Straßenkuppe (Trace des Bands).
  - Krücken für grobe Tiles (`unmeasured: 'coarse tile'`) nach dem Einfrieren noch nötig?
  - Hinweistext "Ground Marks" nennt die Ooze-Pfützen nicht (`quick-actions.component.ts`).
  - Zähler `peekSkipCount` und `raycastCount` in `route-cell-sampler.ts` ohne Leser.
- [ ] **I2 Tests und Werkzeuge**
  - Gemeinsamer Engine-Mock (`integration/test-helpers.ts`) kennt `tentacles` und `plinths` nicht.
  - `ability-bosses.scenario.spec.ts` baut `applyMaxHpFraction` nach, statt sie aufzurufen.
  - Stencil-Pflicht der Reichweitenringe nur per Kommentar abgesichert.
  - Testlücken: gesperrte Kachel anklicken, Doppelklick im Referenz-Dialog, Training-Debugger ohne Spec.
  - `bake-compare.mjs` schneidet Todes-Animationen bei 2 s ab statt bei `deathDuration`.
  - Ordner `tools/` wird von keiner Typprüfung erfasst.
  - npm meldet sechs Install-Skripte; `TimeoutNaNWarning` und "Handler for 'audio:play' threw" in der Testausgabe.
  - Veraltetes `::ng-deep` in `loading-screen.component.scss`.

## J. Aufräumen: Doku

- [ ] **J1 Doku-Reste**
  - `HANDOVER_RULE_DIRECTOR.md` nennt deutsche Knopfnamen; `MULTIPLAYER_CONCEPT.md` nicht nachgezogen.
  - Bekannte Grenzen aus den Worker-Berichten in die Fach-Doku übernehmen: Korridor-Nebenbefunde (Dachzellen an
    Routenecken, Überdeckung über 30 m, Füllregel über Gitterlagen, Loch im Mesh in Erlenbach, Rückfall-Sekunde bei
    Stationen), Review-Randfälle, schwebende Ooze-Trümmer am Hang und weitere laut
    `tmp/fix1/reports/cleanup-todo.md` Abschnitt 4 (Ziel "Doku").

---

## Verworfen (nicht erneut angehen)

- **Enemy Movement als Structure of Arrays**: gebaut `bd1d3a5`, zurückgenommen `731f454` (13 % langsamer). Nur als
  Komplettumbau mit Position und Rotation in Arrays sinnvoll; gemessen unter jsdom.
- **Weitere Enemy-Hot-Path-Hebel** (2026-09-10): Culling je Pool greift nur bei ganz anderer Blickrichtung; kalte
  Gegner einmal je Frame zu rechnen ändert die Simulation.
