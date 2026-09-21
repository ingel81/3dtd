# TODO

**Offene Arbeit steht nur hier.** Handover, Berichte und Playtest-Listen führen keine eigenen Listen, sie verweisen
hierher. Offene Nachtests stehen in [docs/PLAYTEST.md](docs/PLAYTEST.md), Erledigtes und getroffene Entscheidungen in
[DONE.md](DONE.md) (nur auf Zuruf), Überholtes in `docs/archive/` und in der Git-Historie.

- Ein Eintrag hat eine bis drei Zeilen: was, Status, Beleg nur wo nötig.
- Die Kennungen (A1, C4, ...) sind die der Klickliste vom 2026-09-16 und bleiben stabil. Ein erledigter Eintrag geht
  nach DONE.md, seine Nummer wird nicht neu vergeben. Neues kommt ans Ende der passenden Gruppe.
- Konzepte und Pläne bekommen ein eigenes Dokument, hier steht nur der Verweis.

Stand 2026-09-20, `main` = v0.3.1, `next` elf Commits davor (C11, E8, E9, J1, Route-Standard, Cheat-Stufen). Nichts
in Arbeit, J2 wartet aufs nächste Release, offen nur der Nachtest K8.4 (optional).

---

## Später (Backlog)

- [ ] **C16 Zufalls-Spawn-Portal noch schräg** (User, 2026-09-17, Amsterdam "Westerstraat", nicht reproduziert): Trotz
      Verschieben auf ein gerades Stück (`cbdec4e5`) stand ein Portal schräg. Vermutungen: gerades Stück zu kurz (nur
      bis zur Ebene geprüft, Mindestlänge etwa 25 bis 30 m fehlt) oder die Gegnerlinie schwenkt am Start vom OSM-Punkt
      zur Bandmitte. Erst mit URL oder Snapshot eines neuen Falls debuggen.
- [ ] **A1 Herkunft von 5 Gegnermodellen** (Ghost, Hornet, Mech, Wraith, zombie_v2), Einträge in
      `attributions.config.ts` nachtragen. Der User sucht die Quellen, low prio; Stone Golem und Herbert sind eigene
      Modelle.
- [ ] **B5 Straßen-Overlay und Intro-Flug auf die eingefrorenen Zellhöhen umstellen?** Beide haben eine eigene
      Höhenabfrage neben dem Korridor (`getStreetHeightEstimate`, Flugprofil).
- [ ] **E1 Balancing aufrollen**: Phase 1 und 2 sind gebaut, die Baseline steht (354 Läufe, 2026-09-21), sechs
      Tuning-Runden sind gelaufen. Offen sind die Zielbänder (3b) und das Kampagnenende (3a),
      [docs/BALANCING_PLAN.md](docs/BALANCING_PLAN.md).
- [ ] **E12 Heilung oder kürzere Kampagne? (Entscheidung, User)** Der Könner verliert in W24-29 je 8 bis 14 HP und
      nichts heilt; bei 100 Start-HP schließen sich Druck und ein erreichbares Kampagnenende gegenseitig aus. Drei
      Antworten stehen im Plan (Heilung an Meilensteinen, kürzere Kampagne, so lassen), keine Empfehlung bis zu
      deinen eigenen Läufen ([docs/BALANCING_PLAN.md](docs/BALANCING_PLAN.md), "Was das Tuning nicht lösen kann").
      Hängt an D10.
- [ ] **E14 Der Überlebbarkeits-Deckel überschätzt die Luftabwehr um rund das Doppelte** (gemessen 2026-09-21,
      5085 Wellen plus ein Menschenlauf): Sieht man nur Wellen, in denen der Deckel Spielraum versprach (Deckel
      x1,6 über der Wellengröße), töten Bodenverteidigungen **100 %** der Welle, Luftverteidigungen **50 %**, bei
      10,9 statt 4,2 HP Verlust. Im Menschenlauf sagte der Deckel bei W8 Hornet Strike "645, not binding", getötet
      wurden 68 von 175, der Lauf endete dort. Diagnose aus dem Code: `survivableCount` schränkt über
      `gateDpsPerArmor.air` und `killThroughput.air` korrekt ein, **wer** schießt, aber nicht **wie lange** —
      `engagementSeconds` rechnet für Luft mit demselben `FAIRNESS_ENGAGEMENT_REACH_M = 60`, obwohl nur die
      Luftabwehr-Tower diesen Abschnitt überhaupt abdecken. (Nicht die Ursache: Luftgegner folgen derselben Route
      wie Bodengegner, nur mit Höhenversatz.) Nächster Schritt: Szenario-Test, der eine bekannte Verteidigung gegen
      eine Luft- und eine Bodenwelle gleicher Größe stellt und Vorhersage gegen echte Kills hält; dann die Reichweite
      für Luft aus der Abdeckung der Luftabwehr ableiten (`getDefenseReachPercent` liefert das Muster).
- [ ] **E13 Ein Tower trägt die Hälfte**: Über 202 Könner-Läufe macht die Kanone 50 bis 54 % des Schadens, danach
      Dual-Gatling 12-14 %, Gift und Eis je rund 10 %. Der Plan verlangt "kein Typ dominiert". Vor einer Änderung
      an Preisen oder Werten klären, ob die Bot-Strategie die Kanone überwählt oder ob sie wirklich zu stark ist;
      E10 (Schaden je Gold je Typ) ist die Zahl, die das entscheidet.
- [ ] **E10 Schaden je Gold je Tower-Typ** im Run-Bericht: Der Wellenblock kennt die Ausgaben nach Zweck, nicht nach
      Tower-Typ. Bau- und Upgrade-Preise je Typ aus den Ereignissen summieren
      ([docs/BALANCING_PLAN.md](docs/BALANCING_PLAN.md), Stand 2c).
- [ ] **E11 Eine Leiche zu viel im Körper-Abgleich** (Bot-Läufe, 2026-09-21): In etwa 1 % der Wellen meldet das
      Run-Log `killed = spawned + 1`. Eingegrenzt über 22 Fälle: Die Abweichung ist **immer genau +1**, immer ein
      **Tower-Kill** (nie Held, Fähigkeit oder `killsByOther`), und sie trifft alle Templates und Gegnertypen
      gleichermaßen, also kein Splitter-Effekt. Ausgeschlossen: Jeder Gegner entsteht über `EnemyManager.spawn()`,
      und das emittiert immer `enemy:spawned`; ein zweiter `kill()` auf denselben Gegner wird von `killingEnemies`
      abgewiesen. Offener Verdacht: `aliveCount` driftet um 1 nach unten (`Math.max(0, c - 1)` verschluckt eine
      doppelte Dekrementierung dauerhaft), sodass `enemiesAtStart` an der Wellengrenze 0 liest, obwohl noch ein
      Gegner lebt. Nächster Schritt ist eine Spur je Gegner-Id in einem Szenario-Test, kein weiteres Lesen.
      Verfälscht keine Kennzahl, steht als Spalte im Bericht ([docs/RUN_LOG.md](docs/RUN_LOG.md), Die Abgleiche).
- [ ] **E2 Replay als Neu-Simulation** statt Aufzeichnung, vollständig korrekt (User, Playtest 553). Blocker und
      Lücken: [docs/REPLAY.md](docs/REPLAY.md).
- [ ] **E4 Stone Golem: Laufgeräusch und Beben**: schwere Schritte, leichter Screen Shake in Kameranähe.
- [ ] **E5 Raketen-Sound**: neues Asset nach `docs/PROJECTILES.md`, "Bekannte Einschränkungen".
- [ ] **F4 Ungemessene Grafik- und CPU-Kosten**: Laser-Säule, drei Stencil-Pässe der Reichweitenringe, Kegel-Upload,
      Drehbereichssuche des Portals, `buildBand` im Spiel.
- [ ] **G1 Konzept Resistenzen, Immunitäten, Schild und HP** je Gegnertyp. Entschieden: Herbert Slow-Resistenz 50 %,
      `immunityPercent` geht im neuen Feld auf. Grundlage: `tmp/archive-2026-09/fix1/reports/bossresist.md`, `immunity.md`.
- [ ] **G2 Konzept Tech Tree des Helden** (Stufe 2 erst damit), Vorschläge in `tmp/archive-2026-09/fix1/reports/herotier2.md`.
- [ ] **G3 Konzept Forschung als eigener Dialog** mit echtem Baum (Knoten, Kanten, Fortschritt, Queue).
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
- [ ] **H9** Mobile und Barrierefreiheit: Qualitäts-Presets, Breakpoints 768 und 480 px, Touch-Ziele 44 px,
      `aria-label` an allen Icon-Buttons.
- [ ] **H13** Straßen parallel zu den Tiles laden, kleinere Box.
- [ ] **H14** Raumindex für `findNearestStreetPoint`.
- [ ] **H16** Deep-Link in die Desktop-App: Schema `threedtd://open?l=...&s=...` (Installer, nur geprüfte Koordinaten)
      plus Knopf "In der Desktop-App öffnen" in der Web-Version. Erst nach dem ersten Desktop-Release, geteilte Links
      bleiben bis dahin https (E26). Skizze im [Electron-Plan](docs/ELECTRON_DESKTOP_PLAN.md), "Bewusst nicht".

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
