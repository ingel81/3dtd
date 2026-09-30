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
- [ ] **J2 GitHub-Actions auf Node 24**: gebaut 2026-09-19 (`actions/checkout@v7`, `actions/setup-node@v7`,
      `SamKirkland/FTP-Deploy-Action@v4.4.0`, alle auf Node 24; `ubuntu-latest` bleibt, Node ist gepinnt). Der erste
      echte Lauf ist das nächste Release (`release.yml`, dann `deploy.yml`); danach nach DONE.
- [ ] **H4** Tower-LOD (High, Medium, Low).
- [ ] **H5** Tower-Instancing (schwierig wegen der Rotationen).
- [ ] **H7** Explosionen zweistufig staffeln.
- [ ] **H8** Bloom nur für ausgewählte Objekte (Render-Layers, zweiter Composer).
- [ ] **H9** Mobile und Barrierefreiheit: Qualitäts-Presets, Breakpoints 768 und 480 px, Touch-Ziele 44 px.
      Der Teil "`aria-label` an allen Icon-Buttons" ist erledigt (2026-09-21), der Rest steht noch aus.
- [ ] **H16** Deep-Link in die Desktop-App: Schema `threedtd://open?l=...&s=...` (Installer, nur geprüfte Koordinaten)
      plus Knopf "In der Desktop-App öffnen" in der Web-Version. Erst nach dem ersten Desktop-Release, geteilte Links
      bleiben bis dahin https (E26). Skizze im [Electron-Plan](docs/ELECTRON_DESKTOP_PLAN.md), "Bewusst nicht".
- [ ] **E27 Coop "Vier Tore"** (Branch `coop`, gepusht, nicht gemergt), alles in [docs/COOP_PLAN.md](docs/COOP_PLAN.md).
      Gebaut: C0 bis C4d, C5a, C7 (öffentliche Lobby, läuft seit 2026-09-25), C8, Review R1 bis R21 (R10 teilweise).
      LAN (T66) und online (erster Lauf 2026-09-25, keine Abweichung) mit zwei Rechnern bestätigt. Als Nächstes:
      Playtest T67 bis T72, dann Merge nach `main` und Release 0.5.0. Später C5b (Wiedereinstieg, Resync; daran die
      Squad-Zustände aus D45), Browser online erst nach einem Lauf Chrome gegen App (D59).
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
- [ ] **E54 Skarnax beendet Läufe** (Bot-Messung 2026-09-27): W35 beendet 4 von 12 kalibrierten Läufen, 113 bis 206
      Segmente im HQ. Entschieden (User, 2026-09-28): Boss-Varianten nach der Kampagne genauso normieren wie darin
      (`directedTotalHp / variantNominalHp`), danach mit Bots messen. Beleg in [Plan](docs/PRESSURE_ONE_PLACE_PLAN.md).
      **2026-09-29:** mit gepanzertem Kopf (E67) kostet Skarnax W30 die Bots 21 HP statt 0; kein Lauf endete dort.

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
- [ ] **E72 Mehr Gegner bei gleicher Bildrate** ([SIM_WORKER.md](docs/SIM_WORKER.md#mehr-gegner-gemessen-2026-09-29)):
      **Gemessen 2026-09-29** bis 25000 Gegner: Chromium hält 144 FPS und Tempo 4 bis rund 11000 (vorher 4900), dann
      wird der Worker knapp; Firefox hält Tempo 4 bis rund 7300, Grenze ist der Hauptthread (Paket anwenden 6 bis 19 ms).
      Nächste Hebel laut Messung: Hauptthread verschlanken, Tick vom Bild lösen, GPU-Culling; SAB-Gegnerdaten und
      mehrere Worker danach. Entscheidung User.
      **Entschieden (User, 2026-09-30):** alle Hebel bauen, auch Gegnerdaten im SAB und mehrere Worker fest einplanen.
      Worker-Zahl automatisch aus `navigator.hardwareConcurrency` (Kerne minus 2, höchstens 4, mindestens 1), Ergebnis
      bei jeder Zahl bitgleich (Coop mit verschiedenen Rechnern), Schalter in den Einstellungen erzwingt 1 Worker.
      Messen: volle Ausgangsreihe mit `--dpr 1` vor dem ersten Umbau, nach jedem Umbau ein kurzer Check (5000 und 16 000
      Gegner, beide Browser), am Ende die volle Reihe bis 25 000 inklusive `next`.
      **Gebaut 2026-09-30** (simu-worker, [SIM_WORKER.md](docs/SIM_WORKER.md#hebel-gebaut-gemessen-2026-09-30)): Tick vom
      Bild gelöst (zwei Tabellensätze, früher Tick ab 35 ms), Spiegel liest bei Bedarf, Presenter ohne Map-Schreiben je
      Gegner. Firefox bei Tempo 4 deutlich mehr Tempo bei etwa gleicher Bildrate (16 000: 3,34 statt 2,42), Chromium
      bei 25 000 Tempo 3,89 statt 3,34.
      **Mehrere Worker:** nur im Labor gebaut und gemessen (Branch `perf/multi-worker-lab`): Bewegung bitgleich, mit 4
      Workern 1,7- bis 3,7-mal so schnell; hochgerechnet 1,3- bis 1,4-mal so viel Simulation. Offen: der Umbau im Spiel
      (Bewegungsdaten aus dem Worker heraus, Snapshot, Prüfsumme und Resync bitgleich, 24 Dateien), Worker-Zahl und
      Schalter in den Einstellungen. **Entschieden (User, 2026-09-30):** mehrere Worker bauen, auf eigenem Branch, mit
      Schalter für 1 Worker und Bitgleichheit gegen Coop; Culling erst messen (Chromium ohne Bildratenbremse bei 8000,
      16 000, 25 000, normal und herangezoomt, Sichttest am Bildrand), nur bei Gewinn übernehmen; die Schwelle für frühe
      Ticks (35 ms) in Firefox mit mehreren Wiederholungen bei 16 000 und 20 000 nachmessen. **Culling** (Hebel 3) gebaut, aber ungemessen (Branch `wt/render-cull`): der
      Vertex-Shader verwirft eine Gegner-Instanz, deren Hüllkugel außerhalb des Sichtfelds liegt, ohne Kosten im
      Hauptthread. **Gemessen 2026-09-30, nicht übernommen** (Branch `perf/cull`, Chromium ohne Bildratenbremse,
      8000/16 000/25 000 Gegner, je zwei Runden): weder in der Gesamtansicht noch im Bestfall (herangezoomt, alle Gegner
      außerhalb des Bildes) ein Unterschied über die Streuung von rund ±10 FPS. Den Sichttest am Bildrand braucht es
      damit nicht.
      **Schwelle früher Ticks nachgemessen 2026-09-30** (Firefox, Tempo 4, je drei Läufe, `?earlyTick=`): bei 16 000
      Gegnern ohne frühe Ticks 108,6 FPS und Tempo 2,97, mit 50 ms 107,8/3,39, mit 35 ms 104,7/3,76, mit 20 ms
      103,4/3,88; bei 20 000 ähnlich (88,9/2,07 bis 87,4/2,86). Frühe Ticks kosten 2 bis 4 FPS für 0,7 bis 0,8 mehr
      Tempo; 20 gegen 35 ms liegt im Rauschen. 35 ms bleibt.
      **Mehrere Worker im Spiel:** Plan in `docs/MULTI_WORKER_PLAN.md` (Branch `perf/multi-worker`); entschieden (User,
      2026-09-30): bauen wie dort empfohlen, auf dem eigenen Branch, danach messen.
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
      oder eine Ansicht sich ändert und nicht neu gebacken wurde. Offen: Firefox im Spiel ansehen.
- [ ] **E81 Restrisiken des zweiten Worker-Reviews** (2026-09-29): Wellenstart-Sperre im Hauptthread fällt nach 2 s
      Wanduhr (braucht das Relay länger, verwirft die Simulation den zweiten Start); Coop-Start und Ortswechsel ohne Paket
      dazwischen ließen den Lauf unmarkiert; ein hängender Worker blockiert nach `newRun`; Gegner-Views nur aus Event-Refs
      behalten die Werte des Events. Beobachten, nur mit Beleg angehen.
- [ ] **E58 Coop-Resync auf Abruf** (**erster Bau 2026-09-28**, COOP_PLAN C5b): Relay hält nach einer Abweichung, der
      Host schickt seinen Stand, die Gäste laden ihn an derselben Tick-Grenze; im Browser mit Bots geprüft.
      **Fertig gebaut 2026-09-29:** Stände in Teilen, Darstellung und Stores nach dem Laden (mit Bild zweier Sitze
      geprüft). Offen nur: ein Stand in mehreren Teilen im Browser (bisher nur Unit-Tests).
      **Entschieden (User, 2026-09-30):** beides bauen: ein Coop-Bot-Lauf mit großer Custom-Welle ohne Spawn-Untergrenze und
      gefälschtem Gold, der einen Resync in mehreren Teilen auslöst, und ein URL-Schalter, der die Teilgröße für Tests
      verkleinert.
      **Gebaut 2026-09-30:** `?resyncPart=<kB>` (1 bis 768) teilt den Stand des Hosts in kleinere Stücke;
      `e2e/coop-bots/run.ts --big-wave N` startet vor der Fälschung (`--falsify-at-wave`) eine Welle aus N zähen
      Zombies ohne Spawn-Untergrenze. **Geprüft 2026-09-30** (zwei Bots, Tempo 4, Dev-Build isoliert): bei rund 3600
      Gegnern mitten in der Welle ein Stand von 406 kB in einem Teil, mit `resyncPart=64` in 7 Teilen; beide Male lud der
      Gast, der Raum lief ohne neue Abweichung weiter (einmal 55 s bis Game Over). Dafür liest der Coop-Bot-Läufer jetzt
      Spiegel und Bus statt `gameState`, gefälscht wird per Test-Aufruf in die Simulation (`falsifyCredits`).
- [ ] **E60 Versus-Modus** (Idee, im Lobby-Umschalter schon als SOON, COOP_PLAN D39): Form offen.
- [ ] **E61 DevWorld als Spielfeld** (Idee): prozedurale Karten als volles Spiel ohne Google-Tiles, später ein Editor.
      Verwandt: E55, E56.
- [ ] **E65 Relay verwirft Nachrichten still, der Raum friert ein** (Nachtlauf 2026-09-28): Überschreitet ein Client
      die Nachrichtengrenze, verwirft das Relay den Rest der Sekunde ohne Hinweis; gehen dabei Nachrichten verloren, die
      der Lockstep braucht, bleibt der Raum für alle stehen. Im normalen Spiel nur durch einen Client-Fehler oder einen
      manipulierten Client erreichbar. Entschieden (User, 2026-09-28): nach anhaltender Überschreitung trennt das Relay
      nur diesen Client mit dem Grund „zu schnell“, der bekommt eine Meldung, die anderen spielen weiter.
- [ ] **E66 Coop: das gemeinsame HQ trägt die Lecks aller Spuren** (Bot-Messung 2026-09-28, 22 Läufe zu zweit): Welle 6
      bis 10 kosten 128 statt 85 HP, der Coop endet 1,7 Wellen früher. Als Nächstes messen: Leck geteilt durch die
      Spuren, HQ mal Spuren, unverändert; je etwa 10 Läufe. Bot-Werte, kein Menschenlauf.
      **Gemessen 2026-09-28** (je 10 Räume bis W15): HP-Rest nach W15 Solo 63 %, unverändert 45 %, Leck geteilt 72 %,
      HQ mal Spuren 68 %. **Entschieden (User, 2026-09-28): so lassen**, Coop bleibt härter.
- [ ] **E67 Skarnax zu anspruchslos** (User, 2026-09-28): Segment für Segment von vorne nach hinten zu zerlegen, wenig
      Anspruch. **Gebaut 2026-09-29:** Kopf mit 5× HP und `fortified`, nach jedem Schnitt neu; schneller, je kürzer
      der Wurm ([ENEMY_CREATION.md](docs/ENEMY_CREATION.md)). Offen: im Spiel ansehen (Playtest).
- [ ] **E69 Budget-Quelle als Standard** ([WAVE_RUN_PLAN.md](docs/WAVE_RUN_PLAN.md)): **seit 2026-09-29 auf `next`**,
      adaptiver Director entfernt; dazu Gold nach Zeilenstärke, Endlos nach W60, Geisterwarnung, Why this wave.
      Offen: der Playtest des Users auf diesem Stand.
- [ ] **E70 Budget-Quelle gegen starke Abwehr** (Bot-Messung 2026-09-29): mit dem Bot bis 40 Tower und Magic/Eis/Blitz
      im Mix sterben Bots erst W42 bis W79 (Median 57, vorher 37 bis 40). Nach dem Playtest entscheiden, ob nachgestellt
      wird.
- [ ] **E68 Zwei volle Pools** (gemessen 2026-09-28): Geschoss-Spuren (11 % des Bildes bei Tempo 4) und Schadenszahlen
      (4 % der Simulation) durchsuchen bei jedem neuen Eintrag den ganzen Pool. Entschieden (User): beide beheben, dann
      Bildrate, Bildzeit und verworfene Einträge bei 1-, 2- und 4-facher Poolgröße messen; Größen erst nach Zuruf ändern.
      **Behoben und gemessen 2026-09-28** (`778343c2`; DevWorld, 5000 Gegner, 60 Tower, Tempo 4): 31 bis 50 statt
      18 bis 25 FPS gemischt, 36 bis 38 statt 17 nur mit Gatling und Archer; mit Fenster 31,3 statt 18,2. 2x und 4x
      sind wieder langsamer (mehr lebende Partikel), und der additive Pool und die Schadenszahlen bleiben dort auch bei
      4x voll. Vorschlag: Größen lassen; Entscheidung User.
- [ ] **E83 AppImage im AppImage-Katalog nachbessern** (2026-09-30): 3DTD steht seit dem 2026-09-30 im Katalog auf
      appimage.github.io (automatisch gefunden und aufgenommen, dessen Test bestanden). Der Test meldet drei Punkte: der Dateiname
      `3DTD-linux-x64.AppImage` soll kein „linux“ tragen (etwa `3DTD-0.5.1-x86_64.AppImage`); keine eingebettete
      Update-Information (`appimagetool -u` und eine `.zsync` neben dem AppImage, für AppImageUpdate); alte
      AppImage-Laufzeit, die glibc und libfuse2 des Systems braucht. Prüfen, was electron-builder davon kann, und ob
      ein neuer Name den Auto-Update-Feed (`latest-linux.yml`) bricht.
      Dazu (User, 2026-09-30): ein AUR-Paket `3dtd-bin` (PKGBUILD, das das AppImage des Releases lädt, mit
      Desktop-Eintrag und Icon), damit Arch-Nutzer es per AUR-Helfer installieren; bei jedem Release Version und
      Prüfsumme nachziehen, am besten aus der CI.
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
