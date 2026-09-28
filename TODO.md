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
      Offen nur: dieselbe Messung über echten Tiles (Stencil gegen Tile-Tiefe), kostet Kartensitzungen.
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
- [ ] **H6** Simulationsschritt und Frame entkoppeln (**eingeordnet 2026-09-29**, ohne Umbau): Nach dem Pool-Fix (E68)
      nimmt die Simulation bei Tempo 4 und 5000 Gegnern 12 bis 27 ms je Bild, Bild und Anzeige zusammen 5 bis 7 ms
      (Bot-Messung 2026-09-28, `tmp/nightly-2026-09-28/pools/series.log`): 26 bis 50 FPS. `GameClock` hält schon
      heute ab 20 FPS (MAX_CATCHUP_MS 50) die Zeitlupe statt der Spirale. Entkoppeln heißt: der Simulation ein
      Zeitbudget je Bild geben (etwa 16 ms), das Bild bleibt flüssig, das Tempo sinkt unter Last (Tempo 4 würde bei
      5000 Gegnern effektiv etwa 2,5); im Coop bremst der Langsamste den Raum wie heute über MAX_AHEAD_TICKS. Frage an
      den User: flüssiges Bild oder volles Tempo unter Last? Der Worker (E57) wäre die Lösung ohne diesen Tausch.
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
- [ ] **E57 Simulation in einen Worker?** (**gemessen 2026-09-28**): Offline-Testwelt, Produktions-Build, Tempo 4 und
      5000 Gegner: die Simulation nimmt 67 bis 68 % des Bildes (24 FPS), bei Tempo 1 lohnt es nicht (Bild 7 bis 9 ms).
      Erst die beiden vollen Pools beheben (E68) und neu messen, dann über den Umbau entscheiden (grob 2 bis 4 Wochen).
- [ ] **E58 Coop-Resync auf Abruf** (**erster Bau 2026-09-28**, COOP_PLAN C5b): Relay hält nach einer Abweichung, der
      Host schickt seinen Stand, die Gäste laden ihn an derselben Tick-Grenze; im Browser mit Bots geprüft. Offen:
      Darstellung nach dem Laden (Augen), Stände über 1 MB.
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
      Anspruch. Ideen später per Konzept.
- [ ] **E68 Zwei volle Pools** (gemessen 2026-09-28): Geschoss-Spuren (11 % des Bildes bei Tempo 4) und Schadenszahlen
      (4 % der Simulation) durchsuchen bei jedem neuen Eintrag den ganzen Pool. Entschieden (User): beide beheben, dann
      Bildrate, Bildzeit und verworfene Einträge bei 1-, 2- und 4-facher Poolgröße messen; Größen erst nach Zuruf ändern.
      **Behoben und gemessen 2026-09-28** (`778343c2`; DevWorld, 5000 Gegner, 60 Tower, Tempo 4): 31 bis 50 statt
      18 bis 25 FPS gemischt, 36 bis 38 statt 17 nur mit Gatling und Archer; mit Fenster 31,3 statt 18,2. 2x und 4x
      sind wieder langsamer (mehr lebende Partikel), und der additive Pool und die Schadenszahlen bleiben dort auch bei
      4x voll. Vorschlag: Größen lassen; Entscheidung User.
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
