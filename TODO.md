# TODO

**Offene Arbeit steht nur hier.** Handover, Berichte und Playtest-Listen führen keine eigenen Listen, sie verweisen
hierher. Offene Nachtests stehen in [docs/PLAYTEST.md](docs/PLAYTEST.md), Erledigtes und getroffene Entscheidungen in
[DONE.md](DONE.md) (nur auf Zuruf), Überholtes in `docs/archive/` und in der Git-Historie.

- Ein Eintrag hat eine bis drei Zeilen: was, Status, Beleg nur wo nötig.
- Die Kennungen (A1, C4, ...) sind die der Klickliste vom 2026-09-16 und bleiben stabil. Ein erledigter Eintrag geht
  nach DONE.md, seine Nummer wird nicht neu vergeben. Neues kommt ans Ende der passenden Gruppe.
- Konzepte und Pläne bekommen ein eigenes Dokument, hier steht nur der Verweis.

Stand 2026-09-16, Branch `next`.

---

## In Arbeit

Worker laufen; nach dem Merge gehen die Einträge nach DONE.md.

- [ ] **A4 Replay-Knopf vor dem Merge ausblenden** (das Replay ist ungetestet). Status: in Arbeit.
- [ ] **B7 Schalter `centreMode` entfernen** (zweiter Modus der roten Linie neben der Bandmitte). Status: in Arbeit.
- [ ] **B13 Pathfinding-Worker entfernen**: `PathRouteService.initializeWorker()` hat keinen Aufrufer, der Worker
      startet nie; seine Typen sind doppelt. Status: in Arbeit.
- [ ] **E3 Bär dunkler**: wirkt zu hell und gelb. Status: in Arbeit.

### C. Bugs: Korrektheit (in Arbeit)

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

### D. Bugs: Kosmetik und Debug (in Arbeit)

- [ ] **D1 Spawn-Portal an engen Stellen und Hängen**: Pfeiler in Fassaden, Lichtfleck am Hang schief. Ungesehen.
- [ ] **D2 Vorschau dreht weiter**, wenn das Fenster bei gehaltenem R den Fokus verliert (auch beim Tower); lädt das
      Rahmenmodell spät, bleibt die Vorschau undurchsichtig (`map-placement.service.ts`).
- [ ] **D3 Held anheuern ohne Route** zeigt den Text für "Befehl ohne Weg" ("No way there along the routes").
- [ ] **D4 "Skarnax Tail"** steht in den Gegnerlisten von Custom Wave und Enemy Debug.
- [ ] **D5 DevWorld: Intro-Flug** rechnet mit `PATH_HEIGHT_OFFSET = 1`, die Linie liegt dort 3 m hoch
      (`intro-camera-flight.service.ts`).
- [ ] **D6 Enemy Debugger: Regler "Offset Y"** reicht nur bis ±3, manche Gegner brauchen 5 bis 7; Ziehen überschreibt.

### I. Aufräumen: Code, Tests, Werkzeuge (in Arbeit)

- [ ] **I1 Code-Reste**
  - `try/finally` im Korridor-Rückfall (`onFallbackLevel`), Listener erst entfernen, dann anhängen (Klarheit, kein
    Fehler).
  - Zwei Tower-Zähler könnten auseinanderlaufen (`store.towerCount` gegen `GameStateManager.towerCount()`,
    spekulativ).
  - Totes Signal `loadingStatus`, `hasStreets()` ohne Aufrufer.
  - `RefusalHintService` und `UpgradeHintService` zusammenlegen.
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

### J. Aufräumen: Doku (in Arbeit)

- [ ] **J1 Doku-Reste**
  - `MULTIPLAYER_CONCEPT.md` ist nicht nachgezogen.
  - Bekannte Grenzen aus den Worker-Berichten in die Fach-Doku übernehmen: Korridor-Nebenbefunde (Dachzellen an
    Routenecken, Überdeckung über 30 m, Füllregel über Gitterlagen, Loch im Mesh in Erlenbach, Rückfall-Sekunde bei
    Stationen), Review-Randfälle, schwebende Ooze-Trümmer am Hang und weitere laut
    `tmp/fix1/reports/cleanup-todo.md` Abschnitt 4 (Ziel "Doku").

## Vor dem Merge nach `main`

- [ ] **A5 Merge-Ablauf**: Code-Stopp; Nachtests K1 bis K3 ([docs/PLAYTEST.md](docs/PLAYTEST.md)), danach nach DONE:
      Korridor einmal messen und einfrieren, Kragsteine an der Dachkante, Skarnax mit Textur, Beinen, Schwanz und
      Stimme, Tank-Modell; Build aus frischem Klon mit dem CI-Befehl, dann Gate; Tag auf dem heutigen `main` als
      Rückweg; `next` sichern (liegt nur lokal). Ein Push auf `main` deployt ohne Tests sofort nach `/play/`.

## Später (Backlog)

- [ ] **A1 Herkunft von 5 Gegnermodellen** (Ghost, Hornet, Mech, Wraith, zombie_v2), Einträge in
      `attributions.config.ts` nachtragen. User: "Suche ich raus, low prio"; Stone Golem und Herbert sind eigene
      Modelle.
- [ ] **B5 Straßen-Overlay und Intro-Flug auf die eingefrorenen Zellhöhen umstellen?** Beide haben eine eigene
      Höhenabfrage neben dem Korridor (`getStreetHeightEstimate`, Flugprofil).
- [ ] **E1 Run-Dump**: ein ganzer Lauf als Datei fürs Balancing, [docs/RUN_DUMP_PLAN.md](docs/RUN_DUMP_PLAN.md).
- [ ] **E2 Replay als Neu-Simulation** statt Aufzeichnung, vollständig korrekt (User, Playtest 553). Blocker und
      Lücken: [docs/REPLAY.md](docs/REPLAY.md).
- [ ] **E4 Stone Golem: Laufgeräusch und Beben**: schwere Schritte, leichter Screen Shake in Kameranähe.
- [ ] **E5 Raketen-Sound**: neues Asset nach `docs/PROJECTILES.md`, "Bekannte Einschränkungen".
- [ ] **E8 Tower gezielt aus- und einschalten**, z. B. per Schalter im Tower-Panel.
- [ ] **E9 Offscreen-Marker klickbar**: Klick fährt die Kamera zum Gegner.
- [ ] **F4 Ungemessene Grafik- und CPU-Kosten**: Laser-Säule, drei Stencil-Pässe der Reichweitenringe, Kegel-Upload,
      Drehbereichssuche des Portals, `buildBand` im Spiel.
- [ ] **G1 Konzept Resistenzen, Immunitäten, Schild und HP** je Gegnertyp. Entschieden: Herbert Slow-Resistenz 50 %,
      `immunityPercent` geht im neuen Feld auf. Grundlage: `tmp/fix1/reports/bossresist.md`, `immunity.md`.
- [ ] **G2 Konzept Tech Tree des Helden** (Stufe 2 erst damit), Vorschläge in `tmp/fix1/reports/herotier2.md`.
- [ ] **G3 Konzept Forschung als eigener Dialog** mit echtem Baum (Knoten, Kanten, Fortschritt, Queue).
- [ ] **G4 Konzept Explosivmunition des Helden mit Flächenschaden** (`hero.config.ts`).
- [ ] **H3** Object-Pooling für Projektile, erst prüfen, ob GC-Druck messbar ist.
- [ ] **H4** Tower-LOD (High, Medium, Low).
- [ ] **H5** Tower-Instancing (schwierig wegen der Rotationen).
- [ ] **H6** Simulationsschritt und Frame entkoppeln (`microStep`/`frameStep`); lohnt nur bei extremen Speed-Faktoren.
- [ ] **H7** Explosionen zweistufig staffeln.
- [ ] **H8** Bloom nur für ausgewählte Objekte (Render-Layers, zweiter Composer).
- [ ] **H9** Mobile und Barrierefreiheit: Qualitäts-Presets, Breakpoints 768 und 480 px, Touch-Ziele 44 px,
      `aria-label` an allen Icon-Buttons.
- [ ] **H10** Electron-Desktop-Build ([ELECTRON_DESKTOP_PLAN.md](docs/ELECTRON_DESKTOP_PLAN.md)).
- [ ] **H13** Straßen parallel zu den Tiles laden, kleinere Box.
- [ ] **H14** Raumindex für `findNearestStreetPoint`.

---

## Verworfen (nicht erneut angehen)

- **Enemy Movement als Structure of Arrays**: gebaut `bd1d3a5`, zurückgenommen `731f454` (13 % langsamer). Nur als
  Komplettumbau mit Position und Rotation in Arrays sinnvoll; gemessen unter jsdom.
- **Weitere Enemy-Hot-Path-Hebel** (2026-09-10): Culling je Pool greift nur bei ganz anderer Blickrichtung; kalte
  Gegner einmal je Frame zu rechnen ändert die Simulation.
