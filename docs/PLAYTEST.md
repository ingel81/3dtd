# Playtest: offene Nachtests

Stand 2026-10-13, Code-Stand `next` (= Release 0.7.0). Hier stehen nur Nachtests: Fixes, die gebaut sind und auf das Ergebnis im Spiel
warten. Offene Arbeit, Bugs und Entscheidungen stehen in [TODO.md](../TODO.md). Die erledigten Punkte samt Ergebnissen
(bis 748, dazu M, Q, R, T bis 2026-09-26) liegen in [archive/PLAYTEST_2026-09.md](archive/PLAYTEST_2026-09.md), die Pakete
T bis Z bis Release 0.7.0 in [archive/PLAYTEST_2026-10.md](archive/PLAYTEST_2026-10.md), ältere Listen in `archive/REVIEW_*.md`.

**So wird ein Punkt abgeschlossen:**
- Antworten reicht so: "K2.1 ok, K3.4 kaputt", bei kaputt ein Satz oder ein Screenshot.
- Das Ergebnis kommt als eine Zeile unter den Punkt (`**ok (Datum)**` oder der Befund).
- Ist ein Paket durch, wandert es ins Archiv; ein Befund wird ein Eintrag in TODO.md.
- Logik prüft der Lead per Szenario-Test, hier stehen nur Augen, Ohren und echte Karten.
- Was ein Browser prüfen kann, prüfen die End-to-End-Tests (`npm run e2e`, [E2E.md](E2E.md)); welcher Punkt dort
  abgedeckt ist, steht in den Testnamen (T.., M..).

## Vorab

- Konsole (F12) offen, Filter leer. Jede Zeile mit `Shader Error` oder `Uncaught` melden.
- **Quick Actions** unten rechts, Namen im Tooltip. "Layers" (drei gestapelte Ebenen) klappt weitere Knöpfe auf:
  "Route Grid Overlay" (vier Quadrate, oberster), "Show streets" (Weg mit zwei Punkten). Ganz rechts "T": "Developer
  options".
- **Developer options:** Kachel "Credits" unter "Cheats" (Klick +1000). Unter "Waves & Inspect": "Waves" öffnet
  "Wave Debug", "Enemies" öffnet "Enemy Debug", "Snapshot" lädt den Korridor als JSON herunter.
- **Custom Wave:** Wave Debug, Knopf "Single", bei "Type" den Gegner, bei "Count" die Anzahl, "Start Custom Wave".
- **Gegner setzen:** Enemy Debug, unter "Placement" den Typ wählen, Stecknadel-Knopf, Klick auf die Route; in "Debug
  Enemies" anklicken, unter "Movement" "Start".
- Orte immer per URL mit F5 kalt laden (`http://localhost:4200/` plus die Parameter unten), keine Tower, keine Welle,
  wenn nicht anders gesagt.

## A Rest nach Release 0.7.0 (2026-10-13)

Was nach dem Aufräumen offen ist; alles andere aus T bis Z ist abgehakt oder überholt (Archiv). Coop nur in der
Desktop-App über die echte Lobby, der Browser auf `/play/` zeigt dafür nur den Hinweis auf die App.

Paket A1, Coop App gegen App (zwei Rechner, echte Lobby):

- **A1.1 Raumliste (war T71):** A hostet online, B öffnet Coop. *Unter „Online“ steht „Open rooms“ mit dem Raum
  (Titel, Host, Stadt ohne Straße, 1/4, „Lobby“, Ping); privat oder gesperrt verschwindet er; nach dem Start grau
  „In game · Wave n“.*
- **A1.2 Einladungslink und Beitritt ohne Ort (war H3.1, H3.3):** B frisch gestartet, ohne Ort, tritt über den Link
  bzw. den Code bei. *Das Menü bleibt, die Karte des Hosts lädt dahinter, danach Spiel und Dock mit dem Raum.*
- **A1.3 Same network (war H3.4):** A „Host on this network“ (Firewall erlauben), B „Same network“. *Das Spiel von A
  steht mit Spielerzahl in der Liste, „Join“ führt in den Raum; ohne Spiel im Netz nach rund 4 s „Host IP“.*
- **A1.4 Coop nach Solo-Lauf (war N18):** allein ein paar Wellen, dann „Host a room“, einmal an einem Ort mit einem
  Spawn, einmal mit zwei. *Vorher die Frage „This ends your solo run (wave N)“, Cancel lässt den Lauf.*
- **A1.5 Forschungspreise des Partners (war S3.2):** zwei Spuren je Spieler, beim Partner forschen. *Sein Preis im
  Baum ist das, was ihm abgebucht wird.*
- **A1.6 Resync (war S3.4):** im Spiel ein Fenster lange hängen lassen (Debugger-Pause o. ä.). *Resync läuft, danach
  gleiche Prüfsummen, kein Abbruch.*

Paket A2, App und Web:

- **A2.1 Quit und Links (war H4):** App ohne Lauf „Quit 3DTD“ beendet; mit Tower fragt Esc, „Quit 3DTD“ erst „Quit
  3DTD? The run ends.“. Extras, „Legal & privacy“ und „Source on GitHub“ öffnen den System-Browser.
- **A2.2 Datei laden im Lauf (war S1.4):** „Load game“, Download-Symbol am Platz, im laufenden Lauf „Load from a
  file“ mit der Datei. *Die Rückfrage, danach lädt sie wie ein Platz.*
- **A2.3 Konsole auf `/play/` (war S3.3):** Header live geprüft (2026-10-13). Offen: ein Spiel in Chrome und Firefox
  mit offener Konsole, *keine CSP-Verletzung* bei Ortssuche, Straßen, Tiles, Schlüsselprüfung, Globus.
- **A2.4 Globus Low/Off (war G3.1):** Settings, Graphics, „Menu globe“ Low und Off; auf einem schwächeren Rechner
  High. *Low weicher, gleicher Ablauf; Off dunkler Grund, kein Abtauchen; flüssig.*

Nur wenn es passiert oder ein Gerät da ist:

- **A3.1 Kartenserver lehnt ab (war Y5):** bei 429 oder ohne Netz. *„The map server is busy or out of reach …“, Play
  wartet, nach 15 s bis 2 min lädt es von selbst weiter.*
- **A3.2 AppImage (war S5.1):** auf einem Linux-Desktop starten, einen Ort spielen.
- **A3.3 Hybrid-Laptop (war K8.4):** Task-Manager, Spalte „GPU-Modul“ beim 3DTD-Prozess. *Die dedizierte GPU, ebenso
  im Log `[info] GPU: ... (active)`.*
  **kaputt (2026-10-13):** Benchmark der Desktop-App v0.7.0 auf einem Laptop mit Ryzen 7 4800H und GTX 1650 Ti meldet
  „AMD Radeon(TM) Graphics“, die App rendert also auf der integrierten GPU ([BENCHMARKS.md](BENCHMARKS.md), Rechner B).
  `powerPreference` allein reicht nicht; nächster Schritt `force_high_performance_gpu` (Plan E14, TODO E153). Per
  Windows-Grafikeinstellung für die 3DTD.exe auf „Hohe Leistung“ etwa doppelt so viele FPS (Rechner B2).
  **ok mit 0.7.1-beta.1 (2026-10-13):** `force_high_performance_gpu` gesetzt, Windows-Eintrag „Windows
  entscheiden lassen“ und auch ganz entfernt: Task-Manager zeigt beim 3DTD-Prozess „GPU 1 - 3D“, GPU 1 ist die GTX 1650 Ti.

Offen als Entscheidung, kein Nachtest: **M4/S2.3** „Why this wave“ in Worten war dir „verwirrend, sagt mir alles nichts“
(2026-10-04); neu gefasst am 2026-10-05, seitdem nicht wieder angesehen. Gehört in TODO.md, falls es bleiben soll.

## B Eigene Karten rund (Nachtschicht 2026-10-14, E154)

Branch `night/custom-maps-round2` (nicht gepusht), Dev-Server. Eigene Karten sind bis E134 nur im Dev-Build offen.
Vorschau-Adressen gehen auf `/map-preview?…`, Spiel auf `?world=map:<id>`. Logik ist per Tests und Fuzz geprüft, hier
stehen nur Augen und Gefühl.

Paket B1, Welt und Optik:

- **B1.1 Wind:** `/map-preview?view=trees` und Autumn Keep, Wiese. *Bäume schwingen ruhig (Stamm fast starr, Blätter
  flattern), Böen laufen sichtbar über Wiese und Wald, Gras, Wolken und Rauch in dieselbe Richtung.* Ist die
  Standardstärke zu ruhig oder zu stark? Editor, Sky and weather (8), Abschnitt Wind: Regler wirken sofort.
- **B1.2 Tone-Mapping:** eine eigene Karte bei Tag, Dämmerung, Nacht, dazu Frost Hamlet und eine Wüstenkarte. *Nichts
  brennt weiß aus, Farben satt.* Danach eine Tiles-Welt und das Menü: *aussehen wie vorher.*
- **B1.3 Wasser:** `?map=archipelago&effects=refraction,seaWaves`. *Grund durchs Wasser, Dünung, breite weiche Schaumbänder
  laufen zum Ufer (an der Kaimauer kein eckiger Umriss), nasser Strand; Wasser zieht entlang der Ufer; bei Dämmerung
  von oben warm gedämpft statt kräftig blau.* Witch Marsh: *Algen nur am flachen Ufer, nachts kaum.*
  Ein Wasserfall: *keine Ecken, Gischt, Schaum unten.*
- **B1.4 Lava:** `?map=ember-crater&effects=lavaGlow&post=bloom` und `cam=30,-60,25,0,0,0`. *Kruste reißt auf und
  schließt sich, Ränder abgekühlt, Glut nur orange in Rissen, Hitzeflimmern, Steg und Felsen glühen unten orange.*
  Ember Crater im Spiel: *Bauflächen lesbar, Hölle nicht zu dunkel.*
- **B1.5 Boden:** `?map=mountain-pass` und `?map=autumn-keep`. *Neue Bodenmaterialien mit Charakter, Klippen ohne
  Streifen, Grenze Fels zu Geröll gebrochen, Laub- und Erdflecken, Mulden feucht, Kuppen trocken.*
  `?map=red-canyon&cam=-40,-150,40,0,-90,0`: *Felskante am Wandfuß und an der Oberkante.*
- **B1.6 Wiese und Schnee:** `?view=ground`: *Blüten, Samenstände, breite Halme, kein Kachelrand.* `?view=game&
  weather=snow&strength=0.12`: *Schnee zuerst in Mulden und im Windschatten.* `?map=frost-hamlet&view=river`: *Eis
  mit Flecken, Blasen und Plattenrissen, kein Wabenmuster.*
- **B1.7 Schatten und Lesbarkeit:** ein Spiel auf einer eigenen Karte. *Tower werfen Schatten, Gegner und Held stehen
  auf weichen Blobs (auch am Hang nicht eingesunken), Gegner haben einen kühlen Randlicht-Saum, auf Tiles keinen.*
  Schatten insgesamt heller und kühler: Geschmack prüfen (Twin Gates).
- **B1.8 Ferne und LOD:** Demo-Tal langsam heranzoomen. *Bäume und Häuser blenden weich über statt zu springen, kein
  störendes Punktmuster bei ruhender Kamera; ferne Bäume von oben ohne Kartenkreuz, Wald in der Ferne nicht dunkler
  als nah.* Hafenstadt, Spielansicht: *Dächer in der Ferne haben dieselbe Farbe wie nah.*
- **B1.9 Hafenstadt:** *gerade Kaimauer, kein Hügel im Becken, durchgehende Piers.* Horizont jeder Karte: *keine
  helle Naht zwischen Himmel und Nebel.*

Paket B2, Qualität und Leistung:

- **B2.1 Stufen:** Settings, Graphics, Picture quality: *drei Gruppen „All worlds“, „Custom maps only“, „Real places
  (3D tiles) only“.* Demo-Tal auf Low: *kein Gras, FXAA, Deko früher weg, gröbere Schatten, keine Wassereffekte.*
  Archipel High gegen Low: *Brechung und Dünung nur in High.* Stufe im Spiel wechseln: *kurzes Stocken, kein
  mehrsekündiges Einfrieren.*
- **B2.2 Auto auf dem Laptop (Rechner B):** Stufe Auto, erste Karte laden. *Wählt eine passende Stufe, läuft flüssig.*
  Dazu Extras, „Graphics benchmark“ auf Demo-Tal und Hafenstadt, die Tabelle in [BENCHMARKS.md](BENCHMARKS.md)
  eintragen.
- **B2.3 Laden:** eine eigene Karte kalt laden. *Kein Ruckler nach dem Ladebild, Bodentexturen scharf.*

Paket B3, Editor:

- **B3.1 Kopie und Tabs:** eine mitgelieferte Karte zweimal mit „Edit“ öffnen: *beide Male dieselbe Kopie.* Zweiter Tab
  auf dieselbe Karte: *schreibgeschützt mit „Take over editing“; übernehmen zeigt die letzten Änderungen.* Die offene
  Karte in einem anderen Tab löschen: *Hinweis „open in another tab“.*
- **B3.2 Speicher und Papierkorb:** Firefox, erstes Strg+S: *Frage nach dauerhaftem Speicher, danach im Map-Panel
  „keeps your maps for good“.* Karte löschen und aus „Trash“ zurückholen.
- **B3.3 Test-Fenster in der Desktop-App** (Editor freigeschaltet): „Test map“ *öffnet ein zweites App-Fenster, ein
  zweiter Klick lädt dasselbe neu, Quit dort schließt nur dieses.*
- **B3.4 Straßen und Flüsse:** Road mit Laternen über einen Hügel, dann einen Endknoten 60 m ziehen: *alter Damm weg,
  Boden wie vorher, neue Laternen entlang der Linie.* Flusspunkt verschieben: *Schilf und Steine am neuen Ufer, am
  alten nichts.* Alte Karte, Straße wählen, „Rebuild road dressing“: *Lampen, Zäune, Belag passen.* Eine Straße
  stempeln und die Kopie verschieben: *ihre Lampen gehen mit.*
- **B3.5 Werkzeuge:** Objects, Line, castle-wall, einen Ring ziehen: *Ecken, Zinnen, keine Lücken.* Landschaft, Cliff
  rocks an einem Steilhang: *Felswände längs der Kante.* Objects, Line, „Along a road or river“, Zaun mit Versatz 6,
  Both sides: *Zäune beidseitig längs.* Sky, Night, Moonlight: *Land kühl heller.*
- **B3.6 Flüssig:** neue Karte, zum ersten Mal Objects öffnen, Nadelwald malen, ein großes Haus setzen: *kein spürbares
  Stocken.* Terrain- und Biom-Pinsel halten: *flüssig, auch auf 2-m-Karten.*
- **B3.7 Echter Treiber-Reset** (falls er vorkommt): *Banner „View lost, your map is safe“, die Ansicht kommt zurück.*

Paket B4, Koop mit eigener Karte (zwei Rechner, Relay auf Protokoll 5, also `:latest` neu ziehen):

- **B4.1 Große Karte:** Host mit einer Karte über 10 MB. *Beide sehen den Fortschritt in Prozent, die Karte kommt an.*
  Gast tritt mitten im Versand bei bzw. lädt neu: *bekommt die Karte.* Host geht mitten im Versand: *Gäste bekommen
  eine Meldung statt einer hängenden Zeile.*

Paket B5, nach der Nachtschicht (2026-10-14 vormittags):

- **B5.1 Baumschatten beim Schwenken:** Demo Valley im Spiel, Kamera flach, Blick über den Kartenrand, in kleinen
  Schritten seitlich schieben. *Die Baumschatten bleiben, kein großflächiges Ein- und Ausblenden.*
- **B5.2 Reiter im Hauptmenü** (eigene Karten freigeschaltet): eine eigene Karte laden, Menü öffnen. *Reiter „Custom
  maps“ gewählt, Play spielt die Karte, kein Continue zu einem echten Ort darunter.* Reiter „Real places“: *Continue zum
  Autosave des echten Orts; nach der Rückfrage lädt die Seite dort neu und spielt den Stand.* Ein paar Wellen auf einer
  Karte, Menü: *unter Custom maps ein eigenes Continue mit Kartenname und Welle.* Load zeigt je Reiter nur dessen
  Stände.

Paket B6, 2026-10-15 nachmittags:

- **B6.1 Editor aus dem Spiel:** eine Karte im Spiel, Esc, „Edit this map“, bestätigen: *der Editor öffnet die Karte
  (mitgelieferte als Kopie).* Im Editor „Test map“, im Testfenster Esc, „Back to editor“: *der Editor-Tab kommt nach
  vorn, das Testfenster schließt.* Game over auf einer Karte: *Knopf „Edit map“ bzw. „Back to editor“.*
- **B6.2 KI-Agent im Editor (Desktop-App):** oben rechts „Agent“, Schalter an: *„On“, Adresse mit Copy.*
  `claude mcp add --transport http 3dtd <Adresse>`, dann in Claude Code eine Karte anlegen lassen: *Editor öffnet sie,
  unten das Band mit Agentenname, Etikett „Connected“.* Einen langen Hügelzug bauen lassen und währenddessen Stop:
  *Hügel weg, „Stopped“, der Agent meldet „pressed Stop“.* „Let it go on“, dann Spiegeln mit Probelauf: *erst nur eine
  Beschreibung, danach ein Schritt im Verlauf, Ctrl+Z nimmt ihn ganz zurück.* „Öffne Demo Valley“: *eine Kopie öffnet.*
  Schalter aus: *Band weg.*

## Eichtabelle

Fingerprints aus `__corridor.fingerprint()` für K2.1 und K2.2. Alle Werte vor 748 (Rothenburg `d8050177`, Tokyo
`efc7362a` usw.) gelten nicht mehr. Ein neuer Wert gilt, bis ein Commit den Korridor ändert; dann hier leeren.

| Ort | URL-Parameter | Fingerprint | `tileSet` | Datum |
|---|---|---|---|---|
| Tokyo | `l=35.65924,139.70049&s=35.65208,139.69853` | | | |
