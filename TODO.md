# TODO

**Offene Arbeit steht nur hier.** Handover, Berichte und Playtest-Listen führen keine eigenen Listen, sie verweisen
hierher. Offene Nachtests stehen in [docs/PLAYTEST.md](docs/PLAYTEST.md), Erledigtes in [DONE.md](DONE.md), Überholtes
in `docs/archive/` und in der Git-Historie.

**Drei Abschnitte, ein Weg:**

1. **Offen**: was gebaut oder entschieden werden soll, nach Gewicht. Besprochene Details für noch nicht Gebautes stehen
   im Eintrag (`Entschieden (User, Datum): …`); mehr als ein paar Entscheidungen bekommen ein Plan-Doc
   `docs/<THEMA>_PLAN.md`, hier steht dann nur der Verweis.
2. **Gebaut, wartet auf Test**: höchstens drei Zeilen, mit Verweis auf den Punkt in PLAYTEST.md. Die Entscheidungen
   wandern beim Bau in die Fach-Doku, der Verlauf steht in den Commits.
3. **Später und Ideen**: ohne Termin, höchstens drei Zeilen; Konzepte bekommen ein eigenes Dokument.

Nach dem Test geht ein Eintrag **nur auf Zuruf des Users** nach DONE.md. Die Kennungen (A1, C4, E106 …) bleiben stabil
und werden nicht neu vergeben, Neues bekommt die nächste freie Nummer. Nichts Internes ins Repo (Adressen,
Mitspielernamen, Gesprächsdetails).

Stand 2026-10-03. `next` ist der RC für 0.6 (gepusht), `dev/after-0.6` wartet auf das Review des Users.

---

## 1. Offen

### Nach dem Playtest 2026-10-04

- [ ] **E1 Balancing aufrollen**: Phase 1 und 2 gebaut, Baseline und sechs Tuning-Runden gelaufen. Offen: Zielbänder
      (3b) und Kampagnenende (3a), [docs/BALANCING_PLAN.md](docs/BALANCING_PLAN.md).
- [ ] **E98 Druck-Regler getrennt für Luft und Boden** (2026-10-02): Laut Rechnung scheitern schwächere Spieler vor allem
      an Luft- und Geisterwellen (W17, W27, W44, W50), weil ein Regler für alle Wellen gilt. Nach dem Playtest entscheiden.
- [ ] **E105 Spieltiefe, Rest der Balance-Nacht**: Schild am Skarnax-Kopf, Gegnereigenschaften Shielded und Aura,
      Mutator „Panzerung +1“.
- [ ] **E106 Menschenähnlicher Bot** ([BOT_PLAYER_PLAN.md](docs/BOT_PLAYER_PLAN.md), B1 bis B6 auf `next`): offen B7
      (Camo, Pfade, Bauzeit) nach dem Merge von `dev/after-0.6`; Profile mit dem Lauf vom 2026-10-04 nachjustieren
      (`tools/play-profile`); Gold an den Coop-Partner im Browser auslösen (bisher nur per Spec).

### Bugs

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

### Features

- [ ] **E102 Neue Tower aus den Meshy-Kandidaten** (User, 2026-10-02; Modelle in
      `public/assets/models/towers/candidates/`, Zerlegung mit `tools/blender/split_tower.py` und `towers/*.json`):
      Iron Bastion und Sentinel Laser abgenommen. Chainsaw mit Roboter-Tentakeln statt Armen (bis 14 m, eingefahren wie
      das Modell, je Arm ein eigenes Ziel, Zuordnung nach Entfernung, damit nichts kreuzt). Shawarma Slicer mit
      Döner-Strahl (dreht aus dem Stand hoch, Fett-Spritzer später als Pfad). Magma Reactor zurückgestellt. Alle auf das
      Modell-Budget reduzieren (heute 0,8 bis 2,5 Mio. Dreiecke).
- [ ] **E103 Ego-Steuerung des Helden** (User, 2026-10-02).
- [ ] **E83 AppImage im AppImage-Katalog nachbessern** (2026-09-30): 3DTD steht seit dem 2026-09-30 im Katalog auf
      appimage.github.io. Der Test meldet drei Punkte. Gebaut für 0.6 (2026-10-03): der Name ist jetzt
      `3DTD-X.Y.Z-x86_64.AppImage` und `3DTD-x86_64.AppImage` ohne „linux“, der Updater zieht mit (`latest-linux.yml`);
      die alte Kopie `3DTD-linux-x64.AppImage` lädt `release.yml` ein Release lang mit hoch, danach aus dem Workflow
      nehmen. Offen: keine eingebettete Update-Information (`appimagetool -u` und eine `.zsync` neben dem AppImage, für
      AppImageUpdate; electron-builder kann das nicht selbst); alte AppImage-Laufzeit, die glibc und libfuse2 braucht.
      Dazu (User, 2026-09-30): ein AUR-Paket `3dtd-bin` (PKGBUILD, das das AppImage des Releases lädt, mit
      Desktop-Eintrag und Icon); bei jedem Release Version und Prüfsumme nachziehen, am besten aus der CI.

### Assets

- [ ] **A1 Herkunft von 5 Gegnermodellen** (Ghost, Hornet, Mech, Wraith, zombie_v2), Einträge in
      `attributions.config.ts` nachtragen. Der User sucht die Quellen, low prio; Stone Golem und Herbert sind eigene
      Modelle.

### Entscheidung des Users offen

- [ ] **E12 Heilung oder kürzere Kampagne?** (User, 2026-09-26: vertagt bis zu eigenen langen Läufen, Tendenz "so
      lassen"): Der Könner verliert in W24-29 je 8 bis 14 HP und nichts heilt; die drei Antworten stehen in
      [docs/BALANCING_PLAN.md](docs/BALANCING_PLAN.md), "Was das Tuning nicht lösen kann". Hängt an D10.
- [ ] **E68 Pool-Größen** (Geschoss-Spuren, Schadenszahlen): die Suche im vollen Pool ist behoben (`778343c2`, 31 bis
      50 statt 18 bis 25 FPS bei 5000 Gegnern); 2- und 4-fache Größe waren wieder langsamer. Vorschlag: Größen lassen.
- [ ] **E94a Content-Security-Policy für die Webversion** (aus E94): die Desktop-App hat eine, die Webversion nicht;
      keine ausnutzbare Lücke gefunden, die CSP wäre das Netz für den Kartenschlüssel im localStorage.

### Review-Reste

- [ ] **E92 Rest aus dem Review Robustheit und Bedienung** (Review 2026-10-01, zwei Reviewer, Befunde im Code
      nachgeprüft; das Behobene steht in den Commits des Tages). Offen, nach Gewicht:
      - Coop: Ein Gast kann mit falschen Hashes bis zu 5 Resyncs erzwingen; geht der Host während
        eines Resyncs, wartet der Raum die 20 s ab. Unbekannte Felder eines Befehls landen im Befehlslog jedes Clients.
      - Relay: der Run-Log-Speicher entpackt synchron bis 32 MB und räumt bei jedem Eintrag auf (nur Relays mit
        `collectRuns`); 200 Räume lassen sich von vielen Adressen mit leeren Lobbys belegen.
      - Bedienung: Startbildschirm für Kartenschlüssel ohne Fokusfalle; Tab-/Radio-Rollen (Forschung, Raumoptionen,
        Munition des Helden) ohne Pfeiltasten; Rich-Tooltip ohne Esc und ohne Aktualisierung; Tab öffnet im Coop das
        Dock, bevor ein Fokus gesetzt ist; `aria-label` auf Spans ohne Rolle (Bau-Leiste).
      - Kleinigkeiten: Coop-Name hält bei gesperrtem Speicher nicht für die Sitzung; gespeicherte Debug-Fenster können
        außerhalb des Bildschirms landen; die 1,5 km Spawn-Grenze steht viermal von Hand; M (stumm) überlebt einen
        Reload mit wenig Hinweis.
      - Testlücken: Quick-Actions, Game-Speed, Info-Overlay-Komponente, Rich-Tooltip, Tower-Control-HUD, Coop-Chat-Tasten,
        Loading-Screen, `tower-defense.component` selbst.
- [ ] **E94 Rest aus dem Review Sicherheit, Desktop und Spiellogik** (Review 2026-10-01, zwei Reviewer, Befunde im
      Code nachgeprüft). Offen (die CSP steht als E94a oben):
      - Windows-Installer und Auto-Update ohne Code-Signierung: SmartScreen warnt, das Update vertraut nur der
        Prüfsumme aus demselben GitHub-Release. Entschieden (User, 2026-10-01): vorerst nicht, wieder ansehen, wenn
        die App mehr Nutzer hat.
      - Langsam und Gift haben je einen Platz: ein neuer, schwächerer Treffer überschreibt einen stärkeren, im Coop
        also der Tower, der zuletzt traf (laut Code so gewollt).
      - Der State-Hash erfasst Spawner (`accumulatedMs`, `nextDelayMs`, `spawnIndex`), Rush-Phase und
        `remainingKillBudget` nicht: eine Abweichung dort zeigt sich erst später an Gegnern oder Gold.
      - Bot-Server: das Dashboard ist jetzt nur lokal (`DASHBOARD_HOST`); der LAN-Relay der Desktop-App lauscht auf
        allen Schnittstellen (für LAN-Spiel nötig) und nimmt Verbindungen ohne Origin an.

---

## 2. Gebaut, wartet auf Test

### Playtest 2026-10-04 auf `next`

- [ ] **E95 Solo-Lauf bis Welle 60, Befunde**: in der Balance-Nacht umgesetzt (2026-10-02), bis W20 gut. Lauf ab W20 mit
      Spuren (PLAYTEST N1 bis N14), danach Run-Log und Replay gegen `tools/balance-calc` legen.
- [ ] **E71 Worker-Stand**: Coop über zwei Rechner (PLAYTEST N15, W), Webseite nach dem Deploy mit `curl -I` auf
      /play/ (COOP und COEP, im Overlay `Memory: shared`).
- [ ] **E86 Simulationsrate 30, Bild interpoliert** ([SIM_WORKER.md](docs/SIM_WORKER.md)): ansehen, ob die Drehung mit
      dem Stand springt und Auren und Flammen mitgleiten.
- [ ] **E76 Vorschau der Seitenleiste**: vorgebackene Bildbänder (`npm run previews`), im Spiel ansehen (PLAYTEST W1.4).

### Gefühl im Spiel

- [ ] **E14 Luftwellen**: der Deckel lässt bei zähen Luftgegnern (Drache) fast nur Leck zu, gerechnet so gewollt. Der
      User spielt Drachenwellen; falls zu hart: Leck-Kontingent nach Tötbarkeit gewichten, bei großem Spawn-Abstand Rate 0,8.
- [ ] **E15 Rakete**: Wirkradius und Pfad repariert, in reinen Luftwellen jetzt 18 % des Schadens (vorher 7 %), gleichauf
      mit Archer und Eis. Offen nur, ob sie sich im Spiel richtig anfühlt.
- [ ] **E52 Tower-Balance**: Schaden je Gold Kanone 3,2, Magic 3,0, Archer 0,7 (Bot-Läufe); ein Versuch mit anderen Werten
      brachte nichts. Offen nur, ob ein menschlicher Lauf Kanone oder Archer anders erlebt.

### Coop-Nachtests

- [ ] **E30 Coop: Beitreten ohne erst einen Ort zu laden** (PLAYTEST T70); dabei den ganzen Ablauf vom Start der App bis
      im Raum einmal durchgehen.
- [ ] **E31 Coop übers Internet** ([COOP_PLAN.md](docs/COOP_PLAN.md) C7): PLAYTEST T70, T71 mit neuem Installer, ein
      Lauf über die echte Lobby.
- [ ] **E34 Coop-Skalierung** (jede Spur bekommt die ganze Welle): PLAYTEST T76, T81.
- [ ] **E35 Coop: Forschung des Mitspielers ansehen**: PLAYTEST T83.
- [ ] **E36 Coop: Gold in beliebiger Höhe senden**: im Coop ausprobieren.
- [ ] **E38 Run-Log ans Relay** (Opt-in, nur Coop, Relay-Schalter `--collect-runs`): PLAYTEST T79.
- [ ] **E39 Coop: Tower des Mitspielers ansehen**: PLAYTEST T77.
- [ ] **E43 Coop-Masken des Hosts mit groben Kacheln**: auf einer echten Karte prüfen.

### Sonstige

- [ ] **A2 Tentacle-Sound ersetzt** (2026-10-03): Saugnapf-Griff von ElevenLabs statt der Datei ohne belegte Lizenz;
      im Spiel anhören (PLAYTEST N17).
- [ ] **C19 Tower bemannen**: im Coop behoben und geprüft; im Einzelspieler und in der Desktop-App offen (PLAYTEST T72).
- [ ] **E37 Desktop: Downloads sichtbar** (Speichern-Dialog für Run-Log, Dump, Replay): in der App prüfen.
- [ ] **E93 Route, Zellen, Spawn und HQ schweben nach dem Laden**: Neubau der Region im neuen Rahmen gebaut; im Spiel
      bestätigen. Tritt es wieder auf: [ROUTE_CORRIDOR.md](docs/ROUTE_CORRIDOR.md), „Vorgehen, wenn die Route wieder schwebt“.

### Auf `dev/after-0.6`, Review des Users

- [ ] **E97 Replay kleiner und mit Tempo**: Sichtmasken einmal je Tower, `.json.gz`, Tempo-Wechsel im Replay.
- [ ] **E100 Camo** und **E101 Tower-Pfade** (Archer: Späher erkennt Camo).
- [ ] **E104 Bauzeit mit Gerüst**: der Tower wächst im Gerüst und schießt erst danach. Idee dazu, nicht gebaut:
      manche Aktionen laufen nur während einer Welle weiter.

---

## 3. Später und Ideen

- [ ] **E18 Die tote Strecke beim Könner** und **E19 Abwechslung gegen Passung**: Der Regler steuert den Erwartungswert,
      nicht die Verteilung; Serien ohne HP-Verlust häufen sich bei W15 bis W19 und W30 bis W34. Hebel wäre die
      Template-Wahl (öfter schicken, wogegen die Abwehr schwach ist), Tausch: weniger Abwechslung. User kommt darauf zurück.
- [ ] **E20 Kamerapositionen 1 bis 5 speichern** wie in RTS-Spielen: 1 bis 9 wählen heute Tower (`hotkey-map.ts`),
      Ctrl+Zahl wechselt im Browser den Tab; Tasten unklar.
- [ ] **E29 Coop-Rest**: Egoperspektive im Coop zäher als allein (T19), vielleicht Turm-Modell lokal vorausdrehen;
      weitere Raum-Optionen aus dem Design (D45: Credits je Spieler oder geteilt, Gold senden an/aus, Startgeld,
      Difficulty, Regel bei Abbruch).
- [ ] **E33 Relay-Rest**: Drain, C5b nach dem Playtest ([COOP_PLAN.md](docs/COOP_PLAN.md) C9).
- [ ] **E34 Rest**: Perfect, Combo und Comeback für die ganze Welle statt je Spur.
- [ ] **E101 Rest: weitere Tower-Pfade** (User, 2026-10-02; gebaut ist der Späher des Archers): je Tower ein Pfad, Forschung
      schaltet frei, je Tower einmal gekauft, Anbau oder Modelltausch. Archer: Scharfschütze (Modelltausch, etwa auf die
      Ironclad Ballista, E102), Brandpfeile. Ideen: Rakete Mehrzweck (Boden mit halbem Schaden), Magic Bannsiegel (hebt
      Phasing auf), Poison Ätzend (−1 Rüstung); Ice, Kanone, Gatling, Lightning, Fire, Tentacle offen.
- [ ] **E81 Restrisiken des zweiten Worker-Reviews**: Wellenstart-Sperre fällt nach 2 s Wanduhr; Coop-Start und
      Ortswechsel ohne Paket dazwischen lassen den Lauf unmarkiert; ein hängender Worker blockiert nach `newRun`;
      Gegner-Views nur aus Event-Refs behalten die Werte des Events. Beobachten, nur mit Beleg angehen.
- [ ] **E107 Hauptthread bei vielen Gegnern** (aus dem Fahrplan Worker und Performance, A und B1 sind in `next`, B2
      und B3 verworfen): Paket anwenden und Gegner darstellen sind der nächste Hebel für die Bildrate.
- [ ] **F4 Laser auf der Karte messen** (`e2e/perf/render-costs.ts`): Ringe und Laser-Säule kosten in DevWorld 0,05
      bis 0,14 ms je Bild; auf der Karte kam im Lauf kein Laser-Schlag zustande.
- [ ] **D1 Spawn-Portal an engen Stellen und Hängen**: Pfeiler in Fassaden, Lichtfleck am Hang schief. Nur im Browser
      an echten Gassen zu beurteilen.
- [ ] **E84 Weitere Vertriebswege** (nach E83): Flathub, Snap Store, winget; Distro-Repos erst, wenn jemand dort
      paketiert. Je Weg klären: Aufwand pro Release, Auto-Update, Sandbox gegen WebGL und LAN-Relay.
- [ ] **H4** Tower-LOD (High, Medium, Low).
- [ ] **H5** Tower-Instancing (schwierig wegen der Rotationen).
- [ ] **H7** Explosionen zweistufig staffeln.
- [ ] **H8** Bloom nur für ausgewählte Objekte (Render-Layers, zweiter Composer).
- [ ] **H9** Mobile und Barrierefreiheit: Qualitäts-Presets, Breakpoints 768 und 480 px, Touch-Ziele 44 px
      (`aria-label` an allen Icon-Buttons ist erledigt).
- [ ] **H16** Deep-Link in die Desktop-App (`threedtd://open?l=...&s=...`) plus Knopf in der Web-Version; Skizze im
      [Electron-Plan](docs/ELECTRON_DESKTOP_PLAN.md), "Bewusst nicht".
- [ ] **G1 Konzept Resistenzen, Immunitäten, Schild und HP** je Gegnertyp. Entschieden: Herbert Slow-Resistenz 50 %,
      `immunityPercent` geht im neuen Feld auf. Grundlage lokal in `tmp/archive-2026-09/fix1/reports/`.
- [ ] **G2 Konzept Tech Tree des Helden** (Stufe 2 erst damit), Vorschläge lokal in `tmp/archive-2026-09/fix1/reports/herotier2.md`.
- [ ] **G4 Konzept Explosivmunition des Helden mit Flächenschaden** (`hero.config.ts`).
- [ ] **E55 Eigene Tilesets als dritter Anbieter**: Anbieter „tileset.json per URL“ mit eigener Authentifizierung;
      braucht ein Mesh mit Boden (Raycasts), Höhen mit Geoidabstand nach EPSG:4978.
- [ ] **E56 Eigenes Spielfeld aus Photogrammetrie** (z. B. der eigene Garten): `TerrainProvider` auf das Mesh, Wege
      ohne OSM (größter Brocken), Maßstab, glTF-Import; verwandt Mond/Mars mit anderem Ellipsoid.
- [ ] **E60 Versus-Modus** (im Lobby-Umschalter als SOON, COOP_PLAN D39): Form offen.
- [ ] **E61 DevWorld als Spielfeld**: prozedurale Karten als volles Spiel ohne Google-Tiles, später ein Editor.
- [ ] **E108 Kampfzonen-Heatmap** (Schicht 2 der Studie, [COMBAT_HEATMAP_STUDY.md](docs/archive/COMBAT_HEATMAP_STUDY.md)):
      Kills je Route-Grid-Zelle mit Farbrampe, in der Bauphase als Bild der letzten Welle, in der Welle per Taste;
      Aufwand M laut Studie. Schicht 1 (Kampfspuren) ist gebaut.
- [ ] **E109 Forschungsdialog**: Warteschlange per Ziehen umsortieren (heute Hoch/Runter-Knöpfe, das Repo nutzt kein
      `cdk/drag-drop`) und weitere Rubriken neben "Tower Tech", sobald es Inhalt dafür gibt.

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
- **E66** Coop: Das gemeinsame HQ trägt die Lecks aller Spuren, Coop bleibt härter (User, 2026-09-28: so lassen).
- Dev-Menü mit Cheats, alle Konsolen-Globals (`__corridor`, `__rg`, `__perf` usw.) und die Dauer-Messungen
  (Raycast-Zeitmessung, `[Camera]`-Log) bleiben im Release-Build.

## Verworfen (nicht erneut angehen)

- **Sichtmaske im Coop nur vom Host annehmen** (E92; User 2026-10-01): `command:los-mask` gilt nur für einen
  wartenden Tower mit passender Generation, die erste Antwort gewinnt. Ein umgebauter Gast könnte nur direkt nach
  Setzen, Reichweiten-Upgrade oder Luftziel-Forschung schneller antworten als der Host. Coop läuft unter Freunden;
  der Host-Wechsel über den Lockstep lohnt dafür nicht.
- **Enemy Movement als Structure of Arrays**: gebaut `bd1d3a5`, zurückgenommen `731f454` (13 % langsamer). Nur als
  Komplettumbau mit Position und Rotation in Arrays sinnvoll; gemessen unter jsdom.
- **Mehrere Simulations-Worker und Gegnerzustand in Tabellen** (E72 B2, B3; User 2026-09-30): gebaut auf
  `perf/multi-worker` (Bewegung als Zeilen einer geteilten Tabelle, zwei Phasen, Helfer-Worker, bitgleich im Coop 4
  gegen 1 Thread) und `spike/tables` (Position als Getter, Paket aus den Zeilen). Gemessen: mit 4 Threads 13 bis 18 %
  weniger Rechenzeit als heute, mit 1 Thread 12 bis 19 % mehr (schwache Rechner bekämen 1 bis 2 Threads); das Paket
  aus den Zeilen macht seine Schleife nicht schneller. Etwa 60 % des Sub-Steps bleiben seriell. Branches als Archiv.
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
