# TODO

**Offene Arbeit steht nur hier.** Handover, Berichte und Playtest-Listen führen keine eigenen Listen, sie verweisen
hierher. Offene Nachtests stehen in [docs/PLAYTEST.md](docs/PLAYTEST.md), Erledigtes und getroffene Entscheidungen in
[DONE.md](DONE.md) (nur auf Zuruf), Überholtes in `docs/archive/` und in der Git-Historie.

- Ein Eintrag hat eine bis drei Zeilen: was, Status, Beleg nur wo nötig.
- Die Kennungen (A1, C4, ...) bleiben stabil. Ein erledigter Eintrag geht nach DONE.md, seine Nummer wird nicht neu
  vergeben. Neues kommt ans Ende des Backlogs.
- Konzepte und Pläne bekommen ein eigenes Dokument, hier steht nur der Verweis.

Stand 2026-10-02, gearbeitet wird auf `next` (Release 0.6 in Vorbereitung). Offene Nachtests stehen in
[docs/PLAYTEST.md](docs/PLAYTEST.md).

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
- [ ] **A2 Tentacle-Sound ersetzen** (Security-Review 2026-09-27, User: ersetzen): `tentacle-01.mp3` trägt ID3-Tags
      aus „The Odyssey Collection: Expanded“ (Liquid FX), eine Lizenz ist nicht belegt. Neu mit ElevenLabs über die
      Sound-Auswahlseite (`tmp/sound-audition`), User wählt, alte Datei raus.
- [ ] **E1 Balancing aufrollen**: Phase 1 und 2 sind gebaut, die Baseline steht (354 Läufe, 2026-09-21), sechs
      Tuning-Runden sind gelaufen. Offen sind die Zielbänder (3b) und das Kampagnenende (3a),
      [docs/BALANCING_PLAN.md](docs/BALANCING_PLAN.md).
- [ ] **E12 Heilung oder kürzere Kampagne?** (User, 2026-09-26: vertagt bis zu eigenen langen Läufen, Tendenz "so
      lassen"): Der Könner verliert in W24-29 je 8 bis 14 HP und nichts heilt; die drei Antworten stehen in
      [docs/BALANCING_PLAN.md](docs/BALANCING_PLAN.md), "Was das Tuning nicht lösen kann". Hängt an D10.
- [ ] **E14 Luftwellen: Rechnung verstanden, Gefühl offen** (E14 und E17 zusammengelegt 2026-09-28): Der Deckel
      erlaubt bei zähen Luftgegnern (Drache) fast nur Leck, daher kommt viel durch; gerechnet ist das so gewollt
      (Test-Szenario 2026-09-28). Offen: der User spielt selbst Drachenwellen und entscheidet. Falls zu hart: das
      Leck-Kontingent nach Tötbarkeit gewichten; für Ausreißer bei großem Spawn-Abstand eine vorsichtige Rate 0,8.
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
- [ ] **E19 Abwechslung gegen Passung** (User, 2026-09-26: bleibt vorerst, der User kommt nach längeren Sessions
      darauf zurück): `decideWave()` nimmt das älteste zulässige Template; der Hebel gegen die tote Strecke (E18) wäre,
      öfter zu schicken, wogegen die Abwehr schwach ist. Tausch: weniger garantierte Abwechslung.
- [ ] **E20 Kamerapositionen 1 bis 5 speichern** wie in RTS-Spielen (User, 2026-09-23; 2026-09-26: Tasten unklar,
      später): 1 bis 9 wählen heute Tower (`hotkey-map.ts`), Ctrl+Zahl wechselt im Browser den Tab.
- [ ] **F4 Ungemessene Grafik- und CPU-Kosten** (**gemessen 2026-09-29**, `e2e/perf/render-costs.ts`): DevWorld,
      1600×900, eine RTX-Karte, Render mit `gl.finish()`, an und aus im Wechsel: Reichweitenringe aller 12 Tower
      +0,05 ms je Bild (0,87 gegen 0,92), Laser-Säule +0,1 ms (0,9 gegen 1,0). Der Kegel lädt je Bild ein Attribut
      von höchstens 256 × 2 Zahlen hoch, Portal-Drehbereich und `buildBand` laufen einmal je Ortsaufbau, nicht je Bild.
      Über echten Tiles (`--map`, Stuttgart, 36 Tower, 2026-09-29): Ringe +0,14 ms im Mittel (0,76 gegen 0,90).
      Offen: Laser auf der Karte, dort kam im Lauf kein Schlag zustande.
- [ ] **G1 Konzept Resistenzen, Immunitäten, Schild und HP** je Gegnertyp. Entschieden: Herbert Slow-Resistenz 50 %,
      `immunityPercent` geht im neuen Feld auf. Grundlage (lokal, nicht im Repo): `tmp/archive-2026-09/fix1/reports/bossresist.md`, `immunity.md`.
- [ ] **G2 Konzept Tech Tree des Helden** (Stufe 2 erst damit), Vorschläge (lokal, nicht im Repo) in `tmp/archive-2026-09/fix1/reports/herotier2.md`.
- [ ] **G4 Konzept Explosivmunition des Helden mit Flächenschaden** (`hero.config.ts`).
- [ ] **D1 Spawn-Portal an engen Stellen und Hängen**: Pfeiler in Fassaden, Lichtfleck am Hang schief. Nur im Browser
      an echten Gassen zu beurteilen.
- [ ] **H4** Tower-LOD (High, Medium, Low).
- [ ] **H5** Tower-Instancing (schwierig wegen der Rotationen).
- [ ] **H7** Explosionen zweistufig staffeln.
- [ ] **H8** Bloom nur für ausgewählte Objekte (Render-Layers, zweiter Composer).
- [ ] **H9** Mobile und Barrierefreiheit: Qualitäts-Presets, Breakpoints 768 und 480 px, Touch-Ziele 44 px.
      Der Teil "`aria-label` an allen Icon-Buttons" ist erledigt (2026-09-21), der Rest steht noch aus.
- [ ] **H16** Deep-Link in die Desktop-App: Schema `threedtd://open?l=...&s=...` (Installer, nur geprüfte Koordinaten)
      plus Knopf "In der Desktop-App öffnen" in der Web-Version. Erst nach dem ersten Desktop-Release, geteilte Links
      bleiben bis dahin https (E26). Skizze im [Electron-Plan](docs/ELECTRON_DESKTOP_PLAN.md), "Bewusst nicht".
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

- [ ] **E33 Relay-Härtung** (**gebaut 2026-09-26**, [COOP_PLAN.md](docs/COOP_PLAN.md) C9, D69 bis D73): Review mit
      Absturz durch eine einzige Nachricht (K1) und weiteren Grenzen; alles behoben, Statusseite mit Aktionen.
      Offen: das neue Relay-Image für die Lobby (`relay-image.yml`), später Drain, C5b nach dem Playtest.
      Nach dem Playtest (2026-09-26): die Statusseite prüft den Token (`/admin/check`, „Unlock“, Rückmeldung,
      Erklärung), die Zeile `metrics:` kommt nur noch bei einer Änderung.
- [ ] **E34 Coop-Skalierung** (User, Coop-Playtest 2026-09-26: zu wenig Gold, 1006 Spinnen in W6 zu zweit; **gebaut
      2026-09-26**): Jede Lane bekommt die ganze Welle (D13), mehrere Größen waren für eine Lane gedacht. Gebaut:
      Kill-Gold je Lane, Wellengröße gegen den Lane-Anteil der Abwehr (Durchschnitt), Leck-Budget je Lane, Luftziel je
      Tower-Besitzer, Run-Log nur eigene Tower/Kills/DPS (`killsByPartner`), Vorschau „per lane“, Ooze-Lecks einmal
      je Lane, alle Helden zählen (je Lane geteilt), ein Spiel mit einer Lane ohne Route startet nicht (Punkt 7).
      Nachtests PLAYTEST T76, T81. Bleibt:
      Perfect/Combo/Comeback für die ganze Welle.
- [ ] **E35 Coop: Forschung des Mitspielers ansehen** (User, 2026-09-26, Prio B; **gebaut 2026-09-26**, Nachtest T83): der Forschungsbaum eines anderen
      Spielers, nur lesend. Entschieden: Reiter je Spieler im Forschungsfenster (fremder Baum ohne Kauf-Knöpfe) und
      ein Knopf am Spieler in der Squad-Box, der das Fenster mit seinem Reiter öffnet.
- [ ] **E36 Coop: Gold in beliebiger Höhe senden** (User, 2026-09-26; **gebaut 2026-09-26**): im Gold-Fenster ein
      Eingabefeld mit „Send“ neben den festen Stufen. Nachtest im Coop.
- [ ] **E37 Desktop: Downloads sichtbar** (User, 2026-09-26; **gebaut 2026-09-26**): die Windows-Benachrichtigung blieb
      unbemerkt. Run-Log, Dump, Replay fragen jetzt per Speichern-Dialog; Screenshots gehen weiter still nach
      Downloads, die Foto-Leiste nennt die Datei fünf Sekunden lang. Nachtest in der App.
- [ ] **E38 Run-Log ans Relay** (User, 2026-09-26, entschieden per AUQ; **gebaut 2026-09-26**, Nachtest T79; die
      Prüfung vergleicht die Gegenrechnung mit den Fehlern, die das Spiel selbst in die Welle schrieb, damit echte Runs
      mit Buchungsfehlern durchkommen; eine Datei je Spieler und Run, höchstens zehn je Verbindung): Opt-in, einmal beim ersten Spielende gefragt,
      in den Optionen änderbar. Die Frage nennt den Inhalt (Spielernamen, Ort mit Adresse, alle Spielzüge und Zahlen),
      den Zweck (Fehlersuche und Verbesserung des Spiels), dass es danach gelöscht wird (90 Tage) und dass es sehr hilft.
      Das Log geht vollständig. Zuerst nur Coop, über die bestehende Spielverbindung (Raum belegt), beide Seiten je
      Raum abgelegt; Einzelspieler erst später. Schutz: strenge Prüfung (JSONL, Kopf Format 3, bekannte Version, jede
      Welle besteht `reconcileWave`), getrennte Töpfe Coop/Solo. Deckel 2 GB, 90 Tage, das Älteste fällt weg.
      Download auf der Statusseite mit Token. Relay-Schalter `--collect-runs`, Standard aus.
- [ ] **E39 Coop: Tower des Mitspielers ansehen** (User, 2026-09-26, entschieden per AUQ; **gebaut 2026-09-26**,
      Nachtest T77; sein Research Center bleibt bis E35 nicht auswählbar):
      Anklicken wählt ihn wie einen eigenen (Upgrades, Werte, Zielmodus, Kills, Reichweite und Sichtlinie), Kopfzeile
      „<Name>'s tower, view only“; Upgrade, Verkauf, Zielmodus und Bemannen ausgeblendet. `tower-policy.ts`: `select`
      für alle, die übrigen Aktionen bleiben beim Besitzer.

Aus dem Coop-Playtest Heilbronn W1-W38 (2026-09-26, `tmp/coop-playtest/ANALYSE.md`), alles entschieden per AUQ
(2026-09-26/27), Reihenfolge E40 bis E52:

- [ ] **E43 Rest: Coop-Masken des Hosts mit groben Kacheln** (Lightning-Sichtlinie gebaut 2026-09-27, in DONE):
      ungeprüft, braucht eine echte Karte.
- [ ] **E52 Tower-Balance** (**gemessen 2026-09-27 und 2026-09-29**, nicht übernommen): Lauf-Logs mit dem neuen Bot
      (Budget-Quelle, 6 Läufe), Schaden je Gold: Kanone 3,2, Magic 3,0, Lightning 2,9, Gatling 2,1, Archer 0,7 (54 % des
      Golds). Versuch auf Branch `wt/tower-balance` (Kanone 55 auf 45, Magic 40 auf 36, Archer 25 auf 29), je 6
      Bot-Läufe: Todeswelle 34 gegen 34 bis 42, HP nach W20 288 gegen 312, also keine Verbesserung. Schaden je Gold
      ist bei gestuften Upgrade-Kosten kein sauberes Maß (Archer bekommt die meisten Upgrades). Offen bleibt nur, ob ein
      menschlicher Lauf Kanone oder Archer anders erlebt.

Ideen (2026-09-27), nichts entschieden:

- [ ] **E55 Eigene Tilesets als dritter Anbieter** (Idee, später): Eigene
      Cesium-ion-Assets gehen schon heute (`cesiumAssetId` in `runtime-config.json`). Neu wäre ein Anbieter „tileset.json
      per URL“ mit eigener Authentifizierung, damit Tileserver ohne ion gehen (3D Tiles in EPSG:4978).
      Voraussetzung fürs Spiel: ein Mesh mit Boden, weil Routen, Bauplätze und Korridor per Raycast auf die Oberfläche
      gehen; reine LoD2-Gebäude ohne Gelände reichen nicht. Straßen und Adressen bleiben aus OSM. Höhen: Daten kommen oft
      in UTM mit Höhe über NN, beim Umrechnen nach 4978 muss der Geoidabstand (in Deutschland rund 45 bis 50 m) stimmen.
- [ ] **E56 Eigenes Spielfeld aus Photogrammetrie** (Idee User): ein Scan z.B. des eigenen Gartens als autarkes
      Spielfeld statt der Welt, nicht eingebettet. Vorbild DevWorld: ein `TerrainProvider`, der auf das Mesh raycastet,
      und ein `StreetNetworkProvider` ohne OSM. Offen: Wege (selbst gezeichnet oder Wegsuche über die begehbare Fläche,
      der größte Brocken), Maßstab (Garten 20 bis 30 m gegen Straßenzüge), Import als glTF in echtem Maßstab.
      Photogrammetrie braucht Aufnahmen von oben (Drohne). Gaussian Splats nur für die Optik, Kollision braucht ein Mesh.
      Verwandt: Mond/Mars-Tiles bräuchten ein anderes Ellipsoid (`EARTH_RADIUS` in `geo-utils.ts`, `EllipsoidSync`) und
      ebenfalls Wege ohne Straßen.
- [ ] **E71 Worker-Stand nachprüfen** (Branch `simu-worker`, [SIM_WORKER.md](docs/SIM_WORKER.md)): Handtest,
      Coop über zwei Rechner; Bot-Lauf (der Bot entscheidet je Bild statt je Sub-Step, Werte können sich verschieben);
      Desktop-App mit `crossOriginIsolated` (Header in `desktop/src/protocol.js`, kein Build geprüft); Webseite nach dem
      Deploy mit `curl -I` auf /play/. Einmal hing M5 über 5 Minuten auf dem Ladebildschirm (zufälliger Ort), in drei
      weiteren Läufen nicht; nach den Review-Fixes zählte M5 einmal 5 statt 6 Wellen und der Coop-Test T65 sah einen
      Reload, beide im zweiten Lauf grün; erst mit Logs belegen. Dann entscheiden, ob `simu-worker` nach `next` geht.
      **Entschieden (User, 2026-09-30):** Claude macht den Bot-Lauf (Solo über einige Wellen gegen `next`), baut und startet
      das Desktop-Paket (Isolation, Worker-Modus) und schreibt die Klickwege für Handtest und Coop in PLAYTEST.md; Handtest
      und Coop über zwei Rechner macht der User.
      **Stand 2026-09-30:** Klickwege in PLAYTEST.md (Paket W1 bis W3). Desktop-Paket gebaut (0.5.1, NSIS) und gestartet:
      `crossOriginIsolated` wahr, Simulation im Worker, DevWorld lädt. Bot-Lauf allein, je ein Lauf bis Welle 24
      (Zeitlimit): beide ohne Fehler, gleich viele Tower und Kills, HQ am Ende 255 (`simu-worker`) gegen 294 (`next`);
      ein Lauf je Seite sagt über den Unterschied nichts, weitere Läufe auf Wunsch des Users abgebrochen.
      Dabei gefunden und behoben: der Coop-Bot-Läufer las noch `gameState` im Hauptthread.
      **Stand 2026-10-01:** `simu-worker` ist seit 2026-09-30 in `next` (Branch gelöscht). Nachtlauf 2026-10-01: Review
      gegen `main` nur im Code, Regressionen behoben (Run-Log nach neuem Ort, Game Over ohne Abwahl, Forschung nach
      Restore, Raster-Overlay, Bot auf altem Stand, Movement-Schalter, Messskripte, Gold-Abweichungen im Run-Log bei
      hohem Tempo, Kill-Zuordnung im Coop beim Verkauf). E2E 15 von 15 grün (2026-10-01, erneut nachmittags nach den
      Fixes des Tages, Gate grün). Offen: Handtest, Coop über zwei Rechner, Webseite nach dem Deploy (`curl -I` auf
      /play/: COOP und COEP aus `public/.htaccess`, im Overlay `Memory: shared`).
      **Entschieden (User, 2026-10-01):** Der Bot entscheidet einmal je Bild und wartet auf das Paket seines letzten
      Befehls; bei Tempo 75 sind das weniger Entscheidungen je Spielsekunde als auf `main`. So lassen: die nächste
      Bot-Messreihe auf `next` ist die neue Basis, Reihen von vor dem Worker nicht mehr direkt damit vergleichen.
- [ ] **E76 Vorschau der Seitenleiste nachbessern** (Playtest 2026-09-30, nach E73): die gebackene Drehung wirkt minimal
      ruckelig (72 Bilder mit 12 FPS, 5° je Schritt) und dreht in 6 s statt früher 15,7 s. Gebacken wird beim ersten
      Anzeigen, Gegnergruppen also beim Wellenstart; besser vorberechnen (beim Laden, im Leerlauf der Setup-Phase) oder
      als fertige Bildbänder mit dem Build ausliefern.
      **Entschieden (User, 2026-09-30):** flüssiger bei gleichem Tempo (144 Bilder mit 24 FPS, 6 s je Umdrehung) und
      alle Drehungen beim Laden des Ortes backen (alle Tower samt gesperrter Silhouetten, alle Gegnertypen).
      **Versuch 2026-09-30, nicht übernommen** (Branch `wt/render`, Commit `570d74ac`): 144 Bilder mit 24 FPS, alle
      Gegnertypen nach dem Laden im Leerlauf vorgebacken. Chromium unauffällig, Firefox fällt minutenlang auf 13 FPS:
      jedes Bild wird aus dem WebGL-Canvas in ein 2D-Bildband kopiert, und das ist in Firefox teuer; beim Vorbacken sind es
      rund 3600 Kopien. Eine Obergrenze je Leerlauf-Rückruf half nicht. Vorschlag: die Drehungen beim Build vorrendern und
      als Bildbänder ausliefern, oder im Worker auf einem OffscreenCanvas backen. Entscheidung User. Speicher der Bildbänder
      mit 144 Bildern geschätzt (nicht gemessen) 140 bis 190 MB, doppelt so viel wie mit 72.
      **Entschieden (User, 2026-09-30):** die Drehungen beim Build vorrendern und als Bildbänder ausliefern.
      **Gebaut 2026-09-30:** `npm run previews` (`e2e/previews/bake.ts`) backt in einem Build alle Tower und Gegnertypen
      (144 Bilder, 24 FPS) als WebP nach `public/assets/previews/` (37 Bildbänder, 5,7 MB); das Spiel lädt sie und backt
      nur noch eine Ansicht ohne Bildband (Debug-Regler) selbst. `preview-sheets.spec.ts` schlägt fehl, sobald ein Modell
      oder eine Ansicht sich ändert und nicht neu gebacken wurde. **Gemessen** (Firefox, DevWorld, Tempo 4, gegen
      `5b3198d2`): 5000 Gegner 134 statt 94 FPS, 16 000 Gegner 103 statt 71 FPS und Tempo 3,94 statt 3,46; die Ursache
      im Einzelnen nicht profiliert. Offen: im Spiel ansehen (PLAYTEST W1.4).
- [ ] **E81 Restrisiken des zweiten Worker-Reviews** (2026-09-29): Wellenstart-Sperre im Hauptthread fällt nach 2 s
      Wanduhr (braucht das Relay länger, verwirft die Simulation den zweiten Start); Coop-Start und Ortswechsel ohne Paket
      dazwischen ließen den Lauf unmarkiert; ein hängender Worker blockiert nach `newRun`; Gegner-Views nur aus Event-Refs
      behalten die Werte des Events. Beobachten, nur mit Beleg angehen.
- [ ] **E60 Versus-Modus** (Idee, im Lobby-Umschalter schon als SOON, COOP_PLAN D39): Form offen.
- [ ] **E61 DevWorld als Spielfeld** (Idee): prozedurale Karten als volles Spiel ohne Google-Tiles, später ein Editor.
      Verwandt: E55, E56.
- [ ] **E68 Zwei volle Pools** (gemessen 2026-09-28): Geschoss-Spuren (11 % des Bildes bei Tempo 4) und Schadenszahlen
      (4 % der Simulation) durchsuchen bei jedem neuen Eintrag den ganzen Pool. Entschieden (User): beide beheben, dann
      Bildrate, Bildzeit und verworfene Einträge bei 1-, 2- und 4-facher Poolgröße messen; Größen erst nach Zuruf ändern.
      **Behoben und gemessen 2026-09-28** (`778343c2`; DevWorld, 5000 Gegner, 60 Tower, Tempo 4): 31 bis 50 statt
      18 bis 25 FPS gemischt, 36 bis 38 statt 17 nur mit Gatling und Archer; mit Fenster 31,3 statt 18,2. 2x und 4x
      sind wieder langsamer (mehr lebende Partikel), und der additive Pool und die Schadenszahlen bleiben dort auch bei
      4x voll. Vorschlag: Größen lassen; Entscheidung User.
- [ ] **Fahrplan Worker und Performance** (User, 2026-09-30, Claude arbeitet ihn selbstständig ab, alles auf eigenen
      Branches, nichts gepusht, Übernahme nach `simu-worker` und Merge nach `next` entscheidet der User):
      **A** Entkopplung fertig (E85: Coop, Replay und Aufrufe, Gegendruck, Hintergrund-Tab, E2E, Schlussmessung).
      **B1** Interpolation im Shader, dann niedrigere Simulationsrate (E86, mit Prüfliste). **B2** mehrere Worker
      wieder aufnehmen (E72, `perf/multi-worker`), auch für schwächere Rechner und deutlich mehr Gegner. **B3** Paket
      direkt aus der Tabelle. Jeder Schritt bitgleich über alle Rechner, gemessen in beiden Browsern.
      **Stand 2026-09-30 abends:** A und B1 in `simu-worker` übernommen; B2 und B3 verworfen (siehe „Verworfen“).
      **Stand 2026-10-01:** A und B1 sind in `next`.
      Nächster Hebel: der Hauptthread (Paket anwenden, Gegner darstellen), der bei vielen Gegnern die Bildrate hält.

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
- [ ] **E93 Route, Zellen, Spawn und HQ schweben nach dem Laden** (User, 2026-10-01, sporadisch, auch bei F5 und
      sichtbarem Tab): Belegt sind 8 statt rund 100 Tiles in der Region und keine gemessene Station. Wahrscheinliche
      Ursache nach dem Code, nicht direkt gemessen: die Korridor-Region stand im Rahmen der Tile-Gruppe vor
      `load-root-tileset` (Straßen aus dem Cache kamen vor dem Wurzel-Tileset). Gebaut: Region neu im neuen Rahmen, Neubau bei neuen Tiles nach blindem Einfrieren, `frame` im Trace.
      Offen: im Spiel bestätigen; tritt es wieder auf, Vorgehen in ROUTE_CORRIDOR.md („Vorgehen, wenn die Route wieder
      schwebt“).
- [ ] **E94 Rest aus dem Review Sicherheit, Desktop und Spiellogik** (Review 2026-10-01, zwei Reviewer, Befunde im
      Code nachgeprüft; das Behobene steht in den Commits des Tages). Offen:
      - Windows-Installer und Auto-Update ohne Code-Signierung: SmartScreen warnt, das Update vertraut nur der
        Prüfsumme aus demselben GitHub-Release. Entschieden (User, 2026-10-01): vorerst nicht, wieder ansehen, wenn
        die App mehr Nutzer hat.
      - Webversion ohne Content-Security-Policy (die Desktop-App hat eine); keine ausnutzbare Lücke gefunden, die CSP
        wäre das Netz für den Kartenschlüssel im localStorage. Entscheidung User offen.
      - Langsam und Gift haben je einen Platz: ein neuer, schwächerer Treffer überschreibt einen stärkeren, im Coop
        also der Tower, der zuletzt traf (laut Code so gewollt).
      - Der State-Hash erfasst Spawner (`accumulatedMs`, `nextDelayMs`, `spawnIndex`), Rush-Phase und
        `remainingKillBudget` nicht: eine Abweichung dort zeigt sich erst später an Gegnern oder Gold.
      - Bot-Server: das Dashboard ist jetzt nur lokal (`DASHBOARD_HOST`); der LAN-Relay der Desktop-App lauscht auf
        allen Schnittstellen (für LAN-Spiel nötig) und nimmt Verbindungen ohne Origin an.
- [ ] **E95 Solo-Lauf bis Welle 60, Befunde** (User, 2026-10-01, Kirchgasse Binswangen; Run-Log und Replay in
      `tmp/runs/`): zu leicht, monoton, Forschung zu früh, schwache Bosse, Projektile bei Tempo 4, gelber Punkt,
      Soldier-Vorschau, Air-Warnung. **Umgesetzt 2026-10-02** (Balance-Nacht, dabei E54, E67, E69 und E70 aufgegangen),
      gerechnet mit `tools/balance-calc` gegen diesen Lauf. Erster Test bis W20 gut (User). Offen: Playtest ab W20 mit
      Spuren (Sonntag 2026-10-04), dessen Run-Log und Replay danach gegen die Rechnung legen.
- [ ] **E86 Simulationsrate senken, Bild interpolieren** (User, 2026-09-30): Die Simulation rechnet 60 Sub-Steps je
      Sekunde Spielzeit (`GameClock.FIXED_STEP_MS` 16,667 ms), bei Tempo 4 also 240 je Sekunde. Viele Strategiespiele
      rechnen 10 bis 30 und interpolieren das Bild. 30 statt 60 würde die Arbeit des Workers grob halbieren; Ergebnisse,
      Balance, Replays und Coop ändern sich (auf Altlasten nimmt der User keine Rücksicht, die Balance wird ohnehin neu
      eingestellt). Erst messen (Wegwerf-Build mit 33,333 ms), dann entscheiden; hängt an E85 (Interpolation zwischen
      zwei Ständen). Nach E85.
      Vor einer Entscheidung zu prüfen: (1) Interpolation im Vertex-Shader (alte und neue Position je Instanz einmal je
      Stand hochladen, der Shader mischt je Bild) statt je Bild im Hauptthread, auch für Lebensbalken, Geschosse, Held;
      (2) Feuerraten über 30 Schüsse je Sekunde und das Raster von Schaden über Zeit und Effektdauern; (3) Treffer
      schneller Geschosse bei doppeltem Weg je Schritt; (4) Coop-Takt (heute 2 Sub-Steps je Netz-Tick); (5) Stellen, die
      16,67 ms oder feste Schrittzahlen annehmen (Atombombe 390 Sub-Steps); (6) feste Prüfsummen der Specs neu.
      **Gemessen 2026-09-30** (Wegwerf-Build von `88658b44` mit 33,333 ms, eine Runde, Tempo 4, nur Rechenzeit): Firefox
      25 000 Gegner Tempo 3,23 statt 2,00, 16 000 Gegner Worker-Last 0,68 statt 0,94; Chromium Worker-Last 0,63 statt 0,85
      (25 000) und 0,49 statt 0,59 (16 000); FPS unverändert. Weniger als die Hälfte, weil ein Teil je Paket anfällt.
      **Gebaut 2026-09-30** (Branches `perf/interp` `ca8b6f1b` und darauf `perf/rate30` `8f18da91`, beide auf
      `perf/decouple`): Gegner und Lebensbalken gleiten im Shader zwischen zwei Ständen, Geschosse, Spuren und Helden
      auf der CPU, der Worker veröffentlicht höchstens alle 33 ms (ein laufender Gegner steht in 0 bis 4 % der Bilder
      statt in 53 bis 78 %). Die Rate ist eine Konstante (`SIM_STEPS_PER_SECOND`, jetzt 30), alles andere leitet sich
      ab; die Suite ist bei 30 und bei 60 grün. Dabei: Abklingzeiten tragen ihren Rest (Tower schießen genau mit ihrer
      Rate, gerechnet 4 % mehr bei 5 Schüssen je Sekunde, 8 % bei 10), der Überschuss an Wegpunkten läuft als Strecke
      weiter, Coop-Protokoll, Replay-Datei und Snapshots haben Version 2. Kurzcheck bei 16 000 Gegnern und Tempo 4
      gegen den Stand mit Interpolation: Worker-Last Firefox 0,52 statt 0,94, Chromium 0,31 statt 0,52, Tempo 4,0.
      Offen: E2E und Coop-Lauf auf dem Endstand, die Drehung springt mit dem Stand, Auren und Flammen gleiten nicht
      mit (ansehen), Balance neu einstellen, Übernahme (User).
      **Übernommen 2026-09-30** in `next`. Firefox-Gegencheck 2026-10-01 (16 000 Gegner, Tempo 4, je zwei Runden,
      gleiche Bedingungen): vor E86 (`9070ba91`) 64 bis 69 FPS bei Worker-Last 0,89 bis 0,91, jetzt 72 bis 75 FPS bei
      0,51 bis 0,53; die höheren FPS aus früheren Messungen entstanden unter anderen Bedingungen.
- [ ] **E83 AppImage im AppImage-Katalog nachbessern** (2026-09-30): 3DTD steht seit dem 2026-09-30 im Katalog auf
      appimage.github.io (automatisch gefunden und aufgenommen, dessen Test bestanden). Der Test meldet drei Punkte: der Dateiname
      `3DTD-linux-x64.AppImage` soll kein „linux“ tragen (etwa `3DTD-0.5.1-x86_64.AppImage`); keine eingebettete
      Update-Information (`appimagetool -u` und eine `.zsync` neben dem AppImage, für AppImageUpdate); alte
      AppImage-Laufzeit, die glibc und libfuse2 des Systems braucht. Prüfen, was electron-builder davon kann, und ob
      ein neuer Name den Auto-Update-Feed (`latest-linux.yml`) bricht.
      Dazu (User, 2026-09-30): ein AUR-Paket `3dtd-bin` (PKGBUILD, das das AppImage des Releases lädt, mit
      Desktop-Eintrag und Icon), damit Arch-Nutzer es per AUR-Helfer installieren; bei jedem Release Version und
      Prüfsumme nachziehen, am besten aus der CI.
- [ ] **E84 Weitere Vertriebswege** (nachrangig, User 2026-09-30, nach E83): Flathub (Flatpak-Manifest, Review durch
      Flathub, Electron-Basis-App), Snap Store (snapcraft, electron-builder kann `snap`), unter Windows winget (Manifest
      per PR an winget-pkgs, nimmt den NSIS-Installer). Distro-Repos (Debian, Fedora) erst, wenn jemand dort paketiert.
      Je Weg klären: Aufwand pro Release, Auto-Update neben dem eigenen, Sandbox gegen WebGL und LAN-Relay.
---

- [ ] **E97 Replay kleiner und mit Tempo** (User, 2026-10-02): Sichtmasken einmal je Tower und Sichtweite ablegen
      (45 % eines W60-Replays, nur 71 verschiedene), beim Speichern komprimieren (`.json.gz`, beim Laden erkannt),
      Tempo-Wechsel ins Replay; Abspielen im Original-Tempo als Schalter, Standard aus.
- [ ] **E98 Druck-Regler getrennt für Luft und Boden** (2026-10-02): Laut Rechnung scheitern schwächere Spieler vor allem
      an Luft- und Geisterwellen (W17, W27, W44, W50), weil ein Regler für alle Wellen gilt. Nach dem Playtest entscheiden.
- [ ] **E99 Anfänger-Bot hortet W7 bis W15**: Tier 3 öffnet erst ab W15, seine Forschungsliste hat dazwischen nichts.
      Nur Bot-Läufe; bei der nächsten Bot-Messung ansehen.
- [ ] **E100 Camo** (User, 2026-10-02): flexibel (einzelne Gegner, Anteil einer Art, ganze Wellen); getarnt schimmernd
      halbtransparent, ohne Lebensbalken, nicht anvisierbar. Nur im Radius eines Archers mit Erkennung sichtbar und von
      allen Towern treffbar. Erkennung: Forschung schaltet ein Einmal-Upgrade frei, sichtbarer Anbau (Blender), Ring beim
      Auswählen, NEXT-Leiste warnt. Ins Budget rechnen.
- [ ] **E101 Tower-Pfade und Ein-Klick-Upgrades** (User, 2026-10-02): ein Pfad je Tower, Forschung schaltet frei, je
      Tower einmal gekauft, Anbau oder Modelltausch. Archer: Späher (Erkennung, E100), Scharfschütze (Modelltausch, etwa
      auf die Ironclad Ballista, E102), Brandpfeile. Weitere Ideen: Rakete Mehrzweck (Boden mit halbem Schaden), Magic
      Bannsiegel (hebt Phasing auf), Poison Ätzend (−1 Rüstung), Ice, Kanone, Gatling, Lightning, Fire, Tentacle.
- [ ] **E102 Neue Tower aus den Meshy-Kandidaten** (User, 2026-10-02; Modelle in
      `public/assets/models/towers/candidates/`, Zerlegung mit `tools/blender/split_tower.py` und `towers/*.json`):
      Iron Bastion und Sentinel Laser abgenommen. Chainsaw mit Roboter-Tentakeln statt Armen (bis 14 m, eingefahren wie
      das Modell, je Arm ein eigenes Ziel, Zuordnung nach Entfernung, damit nichts kreuzt). Shawarma Slicer mit
      Döner-Strahl (dreht aus dem Stand hoch, Fett-Spritzer später als Pfad). Magma Reactor zurückgestellt. Alle auf das
      Modell-Budget reduzieren (heute 0,8 bis 2,5 Mio. Dreiecke).
- [ ] **E103 Ego-Steuerung des Helden** (User, 2026-10-02).
- [ ] **E104 Bauzeit mit Gerüst** (User, 2026-10-02): echte Bauzeit, kurz (etwa 5 s, je Tower-Typ), der Tower wächst im
      Gerüst schichtweise nach oben und schießt erst danach. Idee dazu: manche Aktionen laufen nur während einer Welle weiter.
- [ ] **E105 Spieltiefe, Rest der Balance-Nacht**: Schild am Skarnax-Kopf, Gegnereigenschaften Shielded und Aura,
      Mutator „Panzerung +1“.
- [ ] **E106 Menschenähnlicher Bot** (User, 2026-10-03, entschieden per Einzelfragen P1 bis P6,
      [BOT_PLAYER_PLAN.md](docs/BOT_PLAYER_PLAN.md)): Wahrnehmung, Sichtlinien-Probe für Bauplätze, Nutzen-Schiedsrichter
      statt Prioritätsliste, drei Profile mit menschlichen Grenzen, Coop-Partner. Branch `bot-player`, lokal committet:
      B1 (Wahrnehmung), B2 (Sichtprobe), B3 (Schiedsrichter), B4 (Zielwahl, Verkauf, Slots); weiter mit B5 (Profile,
      Vergleich gegen Läufe).

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
