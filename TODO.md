# TODO

**Offene Arbeit steht nur hier.** Handover, Berichte und Playtest-Listen führen keine eigenen Listen, sie verweisen
hierher. Offene Nachtests stehen in [docs/PLAYTEST.md](docs/PLAYTEST.md), Erledigtes und getroffene Entscheidungen in
[DONE.md](DONE.md) (nur auf Zuruf), Überholtes in `docs/archive/` und in der Git-Historie.

- Ein Eintrag hat eine bis drei Zeilen: was, Status, Beleg nur wo nötig.
- Die Kennungen (A1, C4, ...) bleiben stabil. Ein erledigter Eintrag geht nach DONE.md, seine Nummer wird nicht neu
  vergeben. Neues kommt ans Ende des Backlogs.
- Konzepte und Pläne bekommen ein eigenes Dokument, hier steht nur der Verweis.

Stand 2026-09-25, gearbeitet wird auf `coop`. Offene Nachtests stehen in [docs/PLAYTEST.md](docs/PLAYTEST.md), vor
allem unter T (Coop).

---

## Später (Backlog)

- [ ] **C16 Zufalls-Spawn-Portal noch schräg** (User, 2026-09-17, Amsterdam "Westerstraat", nicht reproduziert): Trotz
      Verschieben auf ein gerades Stück (`cbdec4e5`) stand ein Portal schräg. Vermutungen: gerades Stück zu kurz (nur
      bis zur Ebene geprüft, Mindestlänge etwa 25 bis 30 m fehlt) oder die Gegnerlinie schwenkt am Start vom OSM-Punkt
      zur Bandmitte. Erst mit URL oder Snapshot eines neuen Falls debuggen.
- [ ] **C17 Zoom rutscht nahe der Route zurück und nach Norden** (User, 2026-09-23, nur hier reproduziert):
      `?l=52.55000,19.70000&s=52.54690,19.69225` (Płock). Wer aufs Portal oder daneben zoomt, wird am Limit
      zurückgesetzt, die Kamera rutscht nach Norden. Mit weit versetztem Spawn ist dieselbe Stelle unauffällig.
      Kein `cameraCorrection` im Log; der Korridor-Aufbau lief dort als "unmeasured freeze" (452/452 Stationen,
      Fallback). Vermutung, unbelegt: die Korridor-Region hält grobe Tiles, der Abstands-Raycast der GlobeControls
      trifft zu hoch. Messen: Raycast-Treffer, Höhe, Tile-Tiefe am Limit, mit und ohne Region.
- [ ] **C19 Tower bemannen wirkt kaputt** (bis 2026-09-25 als C18 geführt, die Nummer hat schon DONE) (User, 2026-09-24, Coop, im Einzelspieler ungeprüft; **gebaut 2026-09-24**,
      Nachtest T1 ok im Coop, archiviert; offen: Einzelspieler und die Desktop-App, PLAYTEST T72): Fadenkreuz kommt,
      Sidebar verschwindet, aber die Kamera bleibt, Zielen und Schießen gehen nicht. Ursache im Coop, aus dem Code:
      `TowerControlService.enter()` prüft direkt nach `command:man-tower` mit `getMannedTower()`, ob man drin
      sitzt; im Lockstep wirkt der Befehl erst am Tick, also bricht `enter()` ab (keine Kamera, kein Pointer-Lock,
      kein Zielen). Das spätere `tower:manned` setzt den Store trotzdem, daher Fadenkreuz und leere Sidebar. Lösung:
      Kamera und Eingabe erst auf das eigene `tower:manned` hin anschließen. Einzelspieler nachprüfen. So gebaut:
      `takeSeat` beim eigenen `tower:manned`; die Kamera folgt dem lokalen Ziel, das Maus-Ziel rechnet nicht mehr vom
      nachlaufenden Tower-Ziel aus, im Coop geht das Ziel höchstens einmal je Tick raus (D12).
- [ ] **A1 Herkunft von 5 Gegnermodellen** (Ghost, Hornet, Mech, Wraith, zombie_v2), Einträge in
      `attributions.config.ts` nachtragen. Der User sucht die Quellen, low prio; Stone Golem und Herbert sind eigene
      Modelle.
- [ ] **E1 Balancing aufrollen**: Phase 1 und 2 sind gebaut, die Baseline steht (354 Läufe, 2026-09-21), sechs
      Tuning-Runden sind gelaufen. Offen sind die Zielbänder (3b) und das Kampagnenende (3a),
      [docs/BALANCING_PLAN.md](docs/BALANCING_PLAN.md).
- [ ] **E12 Heilung oder kürzere Kampagne? (Entscheidung, User)** Der Könner verliert in W24-29 je 8 bis 14 HP und
      nichts heilt; bei 100 Start-HP schließen sich Druck und ein erreichbares Kampagnenende gegenseitig aus. Drei
      Antworten stehen im Plan (Heilung an Meilensteinen, kürzere Kampagne, so lassen), keine Empfehlung bis zu
      deinen eigenen Läufen ([docs/BALANCING_PLAN.md](docs/BALANCING_PLAN.md), "Was das Tuning nicht lösen kann").
      Hängt an D10.
- [ ] **E14 Luftwellen kosten doppelt so viel wie der Deckel verspricht** (gemessen 2026-09-21, 5085 Bot-Wellen
      plus ein Menschenlauf): In Wellen, in denen der Deckel Spielraum versprach (Deckel x1,6 über der
      Wellengröße), töten Bodenverteidigungen **100 %** der Welle, Luftverteidigungen **50 %**, bei 10,9 statt
      4,2 HP Verlust. Im Menschenlauf sagte der Deckel bei W8 Hornet Strike "645, not binding", getötet wurden 68
      von 175, der Lauf endete dort.
      **Zwei Erklärungen sind widerlegt**, nicht nur vermutet: Luftgegner fliegen dieselbe Route wie Bodengegner
      (nur mit Höhenversatz), es liegt also nicht an der Flugbahn. Und die Rechnung des Deckels selbst stimmt:
      `air-cap-estimate.scenario.spec.ts` stellt sechs Tower, von denen zwei Luft treffen, und der Deckel fordert
      60 am Boden gegen 15 in der Luft; beide Wellen sterben vollständig. Der Fehler entsteht also nicht in
      `survivableCount`.
      **Was der Test wegnimmt und das Feld hat**, in der Reihenfolge, in der es zu prüfen lohnt: die Sichtlinie
      (im Test als frei gestubbt, echte Luftziele laufen über die Air-LOS-Pipeline, und hohe Häuser brechen sie),
      der Gegner (die Feldfälle sind zu 43 von 51 Dragon Elite, schnell und zäh zugleich), die Größenordnung
      (Hunderte statt Dutzende) und die Aufstellung (im Test läuft jeder Gegner an beiden Bogenschützen vorbei).
- [ ] **E13 Ein Tower trägt die Hälfte**: Über 202 Könner-Läufe macht die Kanone 50 bis 54 % des Schadens, danach
      Dual-Gatling 12-14 %, Gift und Eis je rund 10 %. Der Plan verlangt "kein Typ dominiert". Vor einer Änderung
      an Preisen oder Werten klären, ob die Bot-Strategie die Kanone überwählt oder ob sie wirklich zu stark ist.
      **Gemessen am 2026-09-21** (E10, 125 Könner-Läufe): Die Kanone macht 52,8 % des Schadens für 25,3 % des Golds,
      also 3,56 Schaden je Gold gegen 1,54 beim nächsten Breitband-Tower. Sie wird nicht nur überwählt. Gift liegt
      je Gold fast gleichauf (3,17), bekommt aber nur 5,5 % des Golds. Offen ist damit nur noch, was daraus folgt.
- [ ] **E15 Rakete: gemessen, offen bleibt nur das Gefühl** (2026-09-22): Pfad repariert (`aa-retrofit` an
      `gatling-tech`), Wirkradius ergänzt (5 m, bis fünf Ziele) — sie war das einzige Sprenggeschoss ohne
      einen. **Gemessen in der richtigen Linse** (reine Luftwellen, 42 Läufe gegen 360 der Baseline): Ihr
      Schadensanteil dort stieg von 6,9 % auf 18,3 %, die Kills von 3,1 % auf 8,0 %, und sie steht in 55 %
      statt 41 % dieser Wellen. Damit liegt sie gleichauf mit Archer (21,4 %) und Eis (18,5 %), während das
      Gatling mit 41,4 % führt — ihre Schwäche gegen die Fledermaus bleibt als Preis erhalten, wie gewollt.
      Offen ist nur noch, ob sie sich im Spiel richtig anfühlt, und eine größere Stichprobe.
- [ ] **E18 Die tote Strecke beim Könner** (offen seit 2026-09-22): Der Druck-Regler hat die mediane Runlänge
      von 25 auf 45 gehoben und den Multiplikator von 35 % auf 3 % Anschlagzeit gebracht, aber der Könner hat
      weiter 8 bis 9 Wellen am Stück ohne HP-Verlust (der Anfänger nur 1,0). 26 von 71 langen Serien beginnen
      bei W15 bis W19, weitere 15 bei W30 bis W34, also am Übergang von der Kampagne zum freien Director. Das
      ist eine Grenze des Ansatzes, keine Fehleinstellung: Der Regler steuert den Erwartungswert, nicht die
      Verteilung. Kosten vier Wellen nichts und die fünfte 15 %, stimmt der Mittelwert und der Verlauf ist
      trotzdem zackig. Nächster Hebel wäre die Template-Wahl (siehe E19).
- [ ] **E19 Abwechslung gegen Passung: eine Design-Entscheidung** (offen seit 2026-09-22, misst sich nicht
      weg): `decideWave()` nimmt das älteste zulässige Template. Am 2026-09-22 löst der Druck-Regler den
      Gleichstand zwischen gleich alten Kandidaten nach Passung auf (das Template, gegen das die Abwehr am
      schlechtesten steht, wenn es zu leicht läuft). Gemessen bringt das fast nichts, und der Grund ist
      strukturell: Wer immer den ältesten nimmt, spielt langfristig jedes Template gleich oft. Über W31 bis
      W60 liegt jedes bei rund 5 %, mit und ohne Tie-Break. Der Gleichstand entscheidet nur das *Timing*.
      **Die Frage an den Menschen:** Soll die Älteste-zuerst-Regel weichen, damit der Director öfter das
      schickt, wogegen die Abwehr schlecht steht? Das ist der Hebel für die tote Strecke in E18, und es ist
      ein Tausch: weniger garantierte Abwechslung gegen gleichmäßigere Spannung.
- [ ] **E16 Warteschlange über die Wellennaht** (**geklärt 2026-09-26**): kann nicht eintreten, eine Welle endet nicht,
      solange ihre Ooze einfließt; belegt per Test in `ooze.scenario.spec.ts` (E16). Nach DONE.
- [ ] **E17 Der Menschenlauf mit Deckel 645** (offen seit 2026-09-21): E14 erklärt die Luftlücke für kleine
      Deckel, in denen das Leck-Kontingent den Deckel trägt. Bei 645 ist es Rauschen, dort dominiert der
      Tötungsterm, und 68 von 175 getötet bleibt unerklärt. Verdacht: der Spawn-Abstand im Nenner
      (`1 - killsPerSecond * REALISM * delay`), bei 24 Towern geht hornet_strike von 20 (0 ms) auf 83 (400 ms).
      Kein Beleg; dafür braucht es das Run-Log dieses Laufs.
- [ ] **E21 Abstand großer Gegner (Entscheidung, User)**: Golems überlappen trotz 600 ms Template-Grenze, weil
      das 3-min-Limit den Delay weiter drückt (W15 New York: 368 ms). Vorschlag: Mindestabstand in Metern je Typ
      aus der Modellgröße, den auch das 3-min-Limit nicht unterschreitet. Der User denkt noch darüber nach.
- [ ] **E20 Kamerapositionen 1 bis 5 speichern** wie in RTS-Spielen (User, 2026-09-23): Ctrl+Zahl speichert,
      Zahl springt. Kollidiert: 1 bis 9 wählen heute Tower (`hotkey-map.ts`), Ctrl wird bewusst durchgelassen
      (Ctrl+1 wechselt im Browser den Tab). Tastenbelegung erst entscheiden.
- [ ] **F4 Ungemessene Grafik- und CPU-Kosten**: Laser-Säule, drei Stencil-Pässe der Reichweitenringe, Kegel-Upload,
      Drehbereichssuche des Portals, `buildBand` im Spiel.
- [ ] **G1 Konzept Resistenzen, Immunitäten, Schild und HP** je Gegnertyp. Entschieden: Herbert Slow-Resistenz 50 %,
      `immunityPercent` geht im neuen Feld auf. Grundlage (lokal, nicht im Repo): `tmp/archive-2026-09/fix1/reports/bossresist.md`, `immunity.md`.
- [ ] **G2 Konzept Tech Tree des Helden** (Stufe 2 erst damit), Vorschläge (lokal, nicht im Repo) in `tmp/archive-2026-09/fix1/reports/herotier2.md`.
- [ ] **G4 Konzept Explosivmunition des Helden mit Flächenschaden** (`hero.config.ts`).
- [ ] **D1 Spawn-Portal an engen Stellen und Hängen**: Pfeiler in Fassaden, Lichtfleck am Hang schief. Nur im Browser
      an echten Gassen zu beurteilen.
- [ ] **J2 GitHub-Actions auf Node 24**: gebaut 2026-09-19 (`actions/checkout@v7`, `actions/setup-node@v7`,
      `SamKirkland/FTP-Deploy-Action@v4.4.0`, alle auf Node 24; `ubuntu-latest` bleibt, Node ist gepinnt). Der erste
      echte Lauf ist das nächste Release (`release.yml`, dann `deploy.yml`); danach nach DONE.
- [ ] **H3** Object-Pooling für Projektile, erst prüfen, ob GC-Druck messbar ist.
- [ ] **H4** Tower-LOD (High, Medium, Low).
- [ ] **H5** Tower-Instancing (schwierig wegen der Rotationen).
- [ ] **H6** Simulationsschritt und Frame entkoppeln (`microStep`/`frameStep`); lohnt nur bei extremen Speed-Faktoren.
- [ ] **H7** Explosionen zweistufig staffeln.
- [ ] **H8** Bloom nur für ausgewählte Objekte (Render-Layers, zweiter Composer).
- [ ] **H9** Mobile und Barrierefreiheit: Qualitäts-Presets, Breakpoints 768 und 480 px, Touch-Ziele 44 px.
      Der Teil "`aria-label` an allen Icon-Buttons" ist erledigt (2026-09-21), der Rest steht noch aus.
- [ ] **H13** Straßen parallel zu den Tiles laden, kleinere Box.
- [ ] **H16** Deep-Link in die Desktop-App: Schema `threedtd://open?l=...&s=...` (Installer, nur geprüfte Koordinaten)
      plus Knopf "In der Desktop-App öffnen" in der Web-Version. Erst nach dem ersten Desktop-Release, geteilte Links
      bleiben bis dahin https (E26). Skizze im [Electron-Plan](docs/ELECTRON_DESKTOP_PLAN.md), "Bewusst nicht".
- [ ] **E27 Coop "Vier Tore"** (Branch `coop`, gepusht, nicht gemergt), alles in [docs/COOP_PLAN.md](docs/COOP_PLAN.md).
      Gebaut: C0 bis C4d, C5a, C7 (öffentliche Lobby, läuft seit 2026-09-25), C8, Review R1 bis R21 (R10 teilweise).
      LAN (T66) und online (erster Lauf 2026-09-25, keine Abweichung) mit zwei Rechnern bestätigt. Als Nächstes:
      Playtest T67 bis T72, dann Merge nach `main` und Release 0.5.0. Später C5b (Wiedereinstieg, Resync; daran die
      Squad-Zustände aus D45), Browser online erst nach einem Lauf Chrome gegen App (D59).
- [ ] **E28 Coop Chrome gegen Firefox: Abweichung eingrenzen** (low prio, Randthema; Electron ist primär, D29):
      Gemessen am 2026-09-24: Chrome gegen Chrome bis W10 ohne Abweichung, Chrome gegen Firefox weicht 14 Spielsekunden
      nach dem Start ab (Tick 210) und bleibt abweichend. Ursache unbelegt (Verdacht Trigonometrie im Sim-Pfad).
      Erst eingrenzen: Prüfsumme in Teile zerlegen (Zufall, Gold, Gegner, Tower, Projektile, Held), Teile mitschicken,
      bei Abweichung ersten abweichenden Teil und erstes Objekt ins Relay-Log. Danach entscheiden: hart machen oder
      Raum nur mit gleicher Engine. [COOP_PLAN.md](docs/COOP_PLAN.md) C5.
- [ ] **E30 Coop: Beitreten, ohne erst einen Ort zu laden** (**gebaut 2026-09-25**, Nachtest PLAYTEST T70) (User, 2026-09-25, LAN-Test): Startet die App ohne Ort,
      steht der Standortdialog; heute muss der Gast erst irgendeinen Ort laden, dann beitreten, dann lädt der Ort des
      Hosts. Lösung: im Standortdialog (und im Token-Dialog) ein Abschnitt „Coop“ mit den LAN-Spielen und dem Raum-Code;
      beim Beitritt schließt der Dialog mit dem Ort aus dem Weltpaket des Hosts (HQ und Spawns), wie beim Einladungslink.
      Spart ein Laden und eine Kartensitzung. Dazu (User, 2026-09-25): der ganze Ablauf vom Start der App bis im
      Raum ist noch nicht rund; beim Bau einmal von vorn durchgehen (Start ohne Ort, Schlüssel, Liste, Beitritt, Laden).
- [ ] **E31 Coop übers Internet: Lobby, Dock, öffentliche Liste** (User, 2026-09-25): entschieden D56 bis D68,
      Plan in [COOP_PLAN.md](docs/COOP_PLAN.md) C7 „Öffentliche Lobby“. Alle drei Schritte gebaut, die Lobby läuft
      (2026-09-25). Offen: Nachtests PLAYTEST T70, T71 mit neuem Installer, ein Lauf über die echte Lobby.
- [ ] **E29 Coop: Lobby und Gefühl nach den Playtests** (D30 bis D48 im Plan; Nachtests T21 bis T65 erledigt, im Archiv).
      Gebaut und hier nicht mehr offen: kürzere Ticks, Schuss sofort beim Klick, ein Tick Vorrat, Design-Handover C8,
      Zustand des Gasts (D47), End-to-End-Tests. Offen: Egoperspektive im Coop fühlt sich zäher an als allein (T19,
      User); später vielleicht Turm-Modell lokal vorausdrehen. Vorgesehen, nicht gebaut (D45): weitere Raum-Optionen
      aus dem Design (Credits je Spieler oder Shared pool, Gold senden an/aus, Startgeld, Difficulty, Regel bei Abbruch).
- [ ] **J3 Zwei Specs flaky**: `air-los-city.scenario.spec.ts` hat seit 2026-09-26 einen festen Seed. Offen:
      `tower-control.scenario.spec.ts` ("fires at its own rate"), zweimal rot nur unter Volllast; 40 feste Seeds grün,
      kein Timeout (17 ms), keine Wanduhr im Schusspfad. Ursache unbekannt, erst mit einem roten Lauf samt Ausgabe weiter.

- [ ] **J4 Große Dateien aufteilen** (Code-Smell-Suche 2026-09-25): `game-state.manager.ts` 1991 Zeilen
      (Spieler-Sitze, Lockstep-Takt, Snapshot, Tower-Befehle, Route-Grid), `path-route.service.ts` 1567
      (`ClearanceRun` in eigene Datei), `three-tiles-engine.ts` 1387, `game-event-bus.ts` 1274 (Event-Typen je Bereich
      auslagern), `enemy.manager.ts` 1273, `global-route-grid.ts` 1270, `coop.service.ts` 1266 (Schnitt: Verbindung,
      LAN, Lobby und Welt, Spiel, Chat und Pings, Laufzahlen; `leave()` setzt heute rund 25 Felder von Hand zurück),
      `corridor-band.ts` 1236. Längste Funktionen: `buildWaveConfig` 233, `startRelay` 227, `CorridorBuild.build` 220,
      `GameStateSyncService.initialize` 197 Zeilen.
- [ ] **J5 Doppelte Helfer zusammenlegen** (**gebaut 2026-09-26**): `utils/storage.ts` für alle localStorage-Zugriffe,
      `formatClock` statt drei Zeitformaten, `coordKey` für Ort und Kartensignatur (5 Stellen), `tilesInternals` als
      einziger Blick in die Tiles-Interna, `CommandData` und `isLosLogCommand` statt der Casts, die Rahmen-Debuganzeige
      zeichnet den Rahmen von `CameraFramingService`; `clamp`/`lerp` über `MathUtils`, Vec2 der DevWorld in einer
      Datei. Der Director behält sein `clamp01` (ohne three). Nach DONE.
- [ ] **J6 Spec-Typen** (**gebaut 2026-09-26**): `tsc -p tsconfig.spec.json` ohne Fehler (Relay-Importe, Stub,
      `noteFrame`), der Release-Workflow prüft die Spec-Typen jetzt mit. Nach DONE.
- [ ] **J7 Voller E2E-Lauf nach dem Coop-UI-Umbau** (**gelaufen 2026-09-26**): 11 von 14 grün. Rot: ein Desync
      (E32), dadurch auch der Folgetest, weil `relay.log()` die ganze Tagesdatei las (behoben: nur noch der eigene
      Teil), und M5 (J8). Nach DONE, sobald ein Lauf mit den Fixes grün ist.
- [ ] **J8 E2E M5 rot** (**gebaut 2026-09-26**): Der Test erbte die sauberen Wellen der Coop-Tests auf derselben Seite
      (×2.01). Er beginnt jetzt mit "Random location" und prüft dort ×1.00, dann die sieben Wellen. Offen: ein grüner Lauf.
- [ ] **E32 Coop: Desync nach Kill-all** (E2E 2026-09-26, einmal von zwei Läufen): Raum mit Gast-Pause und Auto-Welle,
      der Host räumt die Welle per Kill-all (Tick 123, 162). Prüfsumme bei 150 gleich, bei 180 verschieden, ab 510 wieder
      gleich. Verdacht (unbelegt): `enemy.transform.terrainHeight` geht in die Prüfsumme und folgt dem Routenraster,
      das nachladende Kacheln je Rechner korrigieren. Erst die Prüfsumme in Teile zerlegen (wie E28), dann entscheiden.
---

## Entschieden (keine Arbeit)

Vom User am 2026-09-16 entschieden, festgehalten in DONE.md (2026-09-16, "Entscheidungen des Users") und in der
jeweiligen Fach-Doku.

- **B1** ~~ONNX-Modell und Training bleiben.~~ Am 2026-09-19 revidiert: PPO, ONNX und die Python-Directors fallen
  weg, das Backend bleibt als Bot-Server ([BALANCING_PLAN.md](docs/BALANCING_PLAN.md), D12 bis D16).
- **B4** Kette und Knick-Rahmen aus Playtest 748 bleiben.
- **B6** Skarnax-Ringe, die neben einem Transporter schräg stehen, stören nicht.
- **B8** Der Suchscheinwerfer bleibt, wie er ist.
- **B11** `PERF_BUG_ANALYSIS_2026-05-28.md` und die Abschnitte 0 bis 6 von `PLAYER_AGENCY_CONCEPT.md` liegen im Archiv
  (erledigt, `fbd30436`).
- **B12** Die 32 Worker-Entscheidungen und "Shader-Prüfung bleibt manuell" sind bestätigt; Fundstellen in DONE.md.
- Dev-Menü mit Cheats, alle Konsolen-Globals (`__corridor`, `__rg`, `__perf` usw.) und die Dauer-Messungen
  (Raycast-Zeitmessung, `[Camera]`-Log) bleiben im Release-Build.

## Verworfen (nicht erneut angehen)

- **Enemy Movement als Structure of Arrays**: gebaut `bd1d3a5`, zurückgenommen `731f454` (13 % langsamer). Nur als
  Komplettumbau mit Position und Rotation in Arrays sinnvoll; gemessen unter jsdom.
- **Weitere Enemy-Hot-Path-Hebel** (2026-09-10): Culling je Pool greift nur bei ganz anderer Blickrichtung; kalte
  Gegner einmal je Frame zu rechnen ändert die Simulation.

Vom User am 2026-09-16 gestrichen:

- **A2** Benchmark mit 20.000 Gegnern gegen `main` (der User misst laufend).
- **A3** Ladezeit und Grafikspeicher gegen `main` (irrelevant).
- **B2** BVH für Raycasts gegen die Tiles.
- **B3** Zellen parallel zur Route (das Konzeptdokument bleibt, nicht geplant).
- **B9** Atompilz auf Grafikstufe Low noch einmal ansehen.
- **B10** Feste Spawns für weitere Showcase-Orte.
- **B14 (D7)** Falsche Spanne in "COMING UP" bei ausgeschaltetem Director.
- **E6** Tower-Debug: Kegelhöhe des Blutmond-Scheinwerfers je Towertyp.
- **E7** Debug: Blutmond und künftige Modi erzwingen.
- **F1** Anteil beleuchteter Tile-Materialien messen.
- **F2** Skarnax-Pfad bei 75-facher Geschwindigkeit messen.
- **F3** Audio-Aktualisierung je Sub-Step messen.
- **F5** Kalter Start ohne Intro auf 2,5 m; `__raycastStats()` beim Boss-Intro.
- **F6** Grobe Kamera-Tiles, wo die Korridor-Region kein Tile hat.
- **F7** Laser-Bot: 2,9 ms je Entscheidung.
- **H1** logDepth-Experiment.
- **H2** Loading Screen überarbeiten.
- **H11** Gewässer aus OSM als unpassierbare Zonen.
- **H12** MechaCat als Gegner.
- **H15** Hitze-Verzerrung beim Orbitallaser.

Bei den Aufräumarbeiten am 2026-09-16 bewusst nicht gemacht:

- **Zwei Tower-Zähler zusammenlegen**: keine echte Doppelung, der Store-Zähler ist nur Auslöser.
- **Hinweis-Services zusammenlegen** (Refusal, Upgrade): verschiedene Leser und Regeln, 19 Dateien für einen Timer.
- **Label `climb` an Straßenkuppen korrigieren**: würde die abgenommene Korridor-Messung ändern.
- **Krücken für grobe Tiles entfernen**: `maxTileError` greift weiterhin, wenn Tiles spät kommen.
- **231 überflüssige `export` entfernen**: kein sicheres Werkzeug (Specs, `tools/`, dynamische Importe).
- **npm-Install-Skripte freigeben**: Entscheidung über fremden Code, bei Bedarf neu aufmachen.
