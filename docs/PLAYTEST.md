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
- **B6.3 Kameraansichten:** im Spiel Shift+F1: *Meldung „Camera view 1 saved“.* Wegfahren, F1: *Kamera gleitet in
  etwa 0,7 s zurück, Seite lädt nicht neu.* F3 auf leerem Platz: *Hinweis statt Browser-Suche.* F5 im Lauf: *kein
  Reload* (Strg+F5 lädt neu). Spielstand speichern, neu laden, laden, F1: *Ansicht wieder da.* H: *Zeilen unter Camera.*
- **B6.4 Forschung ziehen:** drei Forschungen einreihen, Q: *Griff je Zeile.* Unterste nach oben ziehen: *Reihe bleibt,
  kein Zurückspringen;* wird ein Slot frei, *startet die oberste.* Pfeile per Tastatur gehen weiter.

## C Worker-Runden 2026-10-15 (Branch `night/custom-maps-round2`)

Eigene Karten: Hauptmenü, Reiter „Custom maps“, Karte wählen, Start. Nachtansicht im Spiel: Developer options oder im
Editor oben „Night“. Editor: Custom maps, Karte wählen, „Edit“.

Paket C1, Mond, Mars, Hafen:

- **C1.1 Moon Base:** Luftschleusen und Tunnel vorne geschlossen, Radarschüsseln drehen auf ebenem Boden, Krater mit
  Auswurf statt Steinkreisen, Masten mit Blinklicht, ferne Berge niedriger (80 m), Erde am Himmel mit Kontinenten.
- **C1.2 Mars Canyon:** zwei Gewächshäuser mit dunklem Glas, die Rover fahren frei (kein Objekt auf ihrer Spur).
- **C1.3 Harbor Town:** Straßen als Asphalt, das Fischerboot mit Deck auf dem Rumpf, Laternen nachts.
- **C1.4 Archipelago und Demo Valley:** Klippen ohne offene Rückseite, Felsen vom Fuß der Kante an, Bojen blinken wie
  Seezeichen; Demo Valley am Felsen (Crag) ebenso.

Paket C2, Leben und Licht:

- **C2.1 Ember Crater:** drei hohe Rauchsäulen über dem Krater, aus der Spielkamera und von oben.
- **C2.2 Autumn Keep nachts:** Herbstlaub je Baum von Rot bis Gelb, Fackeln an den Mauern leuchten ohne Sprünge.
- **C2.3 Mountain Pass:** Gras reicht weit (vom Turm und von oben), ferne Berge am Rand.
- **C2.4 Lichter nachts:** Laternen mit größerem Hof, Licht spiegelt auf Wasser (Harbor Town, Witch Marsh).

Paket C3, Editor und OSM:

- **C3.1 Straßenbelag:** Editor, Werkzeug Roads, Straße anklicken, unter „Surface“ Pflaster wählen. *Belag wechselt sofort,
  Undo nimmt ihn zurück.*
- **C3.2 Bauverbot als Rechteck:** neben einer langen Halle einen Tower setzen. *Gesperrt nur im gedrehten Rechteck.*
- **C3.3 OSM-Welt Erlenbach:** New game, „A map of a real place“, Erlenbach 74235. *Einfamilienhäuser statt Wohnblöcken,
  Gehweg und Pflaster als graue Platten.*
- **C3.4 OSM-Tunnel Miltenberg:** OSM-Welt Miltenberg. *Tunnel mit Portal an beiden Enden, Gegner laufen hindurch.*
- **C3.5 Biome:** Editor, Biom-Pinsel Wiese, Dorf, Wüste und das neue Herbst-Biom. *Mehrere Baumarten je Biom.*

Paket C4, Kampf:

- **C4.1 Ballista-Bolzen (Dev-Build):** Archer mit Sniper-Pfad. *Eigener Bolzen und eigener Ton.*
- **C4.2 Gatling plus Ätzend gegen Heavy:** Schaden steigt sichtbar, sobald Ätzend die Rüstung senkt.
- **C4.3 Zombies:** eine Zombie-Welle. *Verschiedene Kleidungen, Füße auf dem Boden.*
- **C4.4 Töne:** Klangvarianten im Life-Panel, Wellenton gegen Start-Horn unterscheidbar.

Hinweis: nach dem Wechsel auf diesen Stand den Dev-Server einmal neu starten (MapLibre neu in den Abhängigkeiten).

## D Nachtschicht 2026-10-15/16

- **D1 Karten:** Red Canyon und Mars Canyon (Felstürme am Rand, zerklüftet), Ember Crater aus der Spielkamera
  (Lavaströme hinter dem Rand, Asche statt Laub), Archipelago (helle Felsnadeln im Meer), Autumn Keep von Süden (Hügel
  neben der Burg), Ruined City (Rauchsäulen), Twin Gates (Belagerungsturm), Frost Hamlet (Hundeschlitten). *Spuren und
  Spawns wie vorher.*
- **D2 Nacht:** Harbor Town, Witch Marsh nachts. *Wasser dunkel, Laternenschein darauf; Leuchtturmstrahl von oben ein
  schwacher Streifen, flach gut sichtbar.* Autumn Keep nachts an den Fackeln entlang schwenken: *Licht wechselt weich.*
- **D3 Editor:** Map-Panel, „Intro flight“, Orbit the HQ, Preview, dann Test map. *Das Spiel fliegt den eigenen Orbit.*
  Karte öffnen: *kein grüner Boden, „Preparing the view“ bis der Boden steht.* Hölle-Pinsel: *Asche und Basalt.* Schule am
  Hang setzen: *geebnet nach dem Rechteck.*
- **D4 Modelle:** `/map-preview?assets=shop-small,shop-office,office-ribbon,barn-modern,outbuilding,shelter-lean-to,annex`.
- **D5 OSM:** Miltenberg neu erzeugen. *Zäune, Laternen, Gleise mit Oberleitung, Betonbrücke, Betonportal am Tunnel.*
- **D6 Welle:** Welle 1, Kill All, sofort im Wave Debugger auf 10. *Nächster Start Welle 10.*

## E Welten, Continue und Kartenserver (2026-10-16)

Dev-Server nach dem Wechsel auf diesen Stand einmal neu starten.

- **E1 Globen:** Start landet auf drei Globen. Ohne Key (Token aus `environment.ts` nehmen) ist Real places grau mit
  „Enter map key“. Die Menü-Erde zeigt eine Nachtseite mit Stadtlichtern.
- **E2 Back to:** Built Worlds › Demo Valley › Play, oben „Worlds“. *„Back to Demo Valley“, ein Klick, Spiel sofort da,
  ohne Ton hinter den Globen.*
- **E3 Continue:** eine Welle spielen, Esc › All worlds. *„Demo Valley | wave 2 | ready“.* Mountain Pass › Play. *Rückfrage
  „End it and start / Continue / Cancel“.* Mülleimer neben einem Continue. *Danach überall weg.*
- **E4 OSM:** OpenStreetMap, Adresse suchen (Hausnummer), Make the map. *Name „Straße Nr, Ort“, Karte mit Bild unter Recent
  worlds; nach einer Änderung im Editor unter Built Worlds mit „from OpenStreetMap“.*
- **E5 Kartenserver:** DevTools › Network › Request blocking „overpass“, Ort wählen. *„The map server is busy, trying
  again (2 of 5)…“, nach 30-60 s Meldung mit Retry.* Blockierung aufheben, Retry. *Ort lädt ohne Reload.*
- **E6 Editor:** Place, Q/E dreht, Gebäude richten sich zur Straße („Face the road“); Seeufer ohne Sägezahn; Speichern
  ohne Ruckler; Vulkan mit Glow cracks glüht, Krater auf Gipfeln hält Lava; Stempel nimmt Teiche mit.

## F Engine-Runde R4 (2026-10-17)

Branch `eng/r4`, Dev-Server nach dem Wechsel auf diesen Stand einmal neu starten. Eigene Karten: Built Worlds, Karte
wählen, Play; Editor: Karte wählen, „Edit“. Alle mitgelieferten Karten sind neu gebacken: ältere Replays, Spielstände
und eigene Kopien darauf gelten als andere Karte. OSM-Welten für diese Punkte neu erzeugen. Logik ist per Tests
gedeckt, hier stehen nur Augen, Ohren und echte Karten.

Paket F1, Ruckler im Spiel:

- **F1.1 Erster Wechsel:** Autumn Keep frisch laden, Developer options, einmal Nacht, Dämmerung, Regen und Sturm
  wählen. *Kein Standbild beim ersten Wechsel, Lampen gehen ohne Hänger an.* Danach je Tower-Typ den ersten bauen:
  *kein Ruckler beim Erscheinen.*
- **F1.2 Qualitätswechsel:** im Spiel Esc, Settings, Graphics, Picture quality von High auf Medium, dann Low und
  zurück auf High; einmal gleich nach dem Laden, einmal nach einer Minute Bauphase. *Das Bild steht nie, die neue
  Stufe zeigt sich nach einem Moment.*
- **F1.3 Bloom:** Settings, Effects, „Bloom“ an und aus, „Color grading“ wechseln. *Kein Ruckler, der Wechsel zeigt
  sich nach wenigen Sekunden.*
- **F1.4 Herbert:** Welle 1, Kill All, im Wave Debugger auf 10, Start. *Herbert erscheint ohne Standbild.*

Paket F2, Menü:

- **F2.1 Hover auf den Globen:** Startseite, Maus langsam über jeden Globus, dann per Tab. *Der Globus wächst sichtbar
  (Mini-Globus etwas mehr), ein heller Rand blendet ein, er dreht schneller; flüssig, danach wieder klein.*
- **F2.2 OSM-Globus:** den OpenStreetMap-Globus ansehen. *Farben wie auf den Karten (Wiese, Wald, Steppe, Sand, Fels,
  Schnee), Felder als Parzellen, Orte mit Dächern und Straßen, Nachtseite mit Fenstern; kein Hellblau und Beige.*
- **F2.3 Kartenliste mit Weg zurück:** eine eigene Karte spielen, Esc, „Edit this map“, im Editor die Kartenliste
  öffnen; einmal ebenso aus „Test map“ heraus. *Oben der Pfad Worlds › Built Worlds › Map editor, Zurück-Pfeil und
  benannter Knopf.* Esc: *mit wartendem Lauf zurück in den Lauf, sonst zu Globen oder Weltmenü; eine offene Frage,
  Import oder New map schließt Esc zuerst.*
- **F2.4 Editor im Coop gesperrt:** Coop-Raum auf einer eigenen Karte (Lobby und Spiel), Esc. *„Edit this map“ steht
  da, gesperrt mit „Leave the coop room to edit“; ebenso „Edit map“ beim Game over.*

Paket F3, OSM-Welt:

- **F3.1 Rahmen:** OpenStreetMap, Adresse suchen, den goldenen Rahmen an der Kante ziehen, an einer Ecke kleiner
  ziehen. *Seitenlänge steht darüber (1,2 bis 2,4 km in 100-m-Schritten), die Adresse bleibt mindestens 200 m innen;
  nach dem Loslassen neue Anordnung, passende Spawns bleiben.* Während der Rahmen lädt, einen Spawn ziehen: *geht
  nicht.* „Try again now“ während des Ladens: *der verschobene Rahmen bleibt.*
- **F3.2 Fortschritt:** „Make the map“. *Beim Laden Daten, Overpass (Sekunden, dann Bytes) und Höhenkacheln (n von m)
  nebeneinander; beim Erzeugen neun Stufen mit Haken, Schritt in Worten, Prozent und Balken, der auch in langen
  Schritten weiterläuft; Wartezeiten und Fehler verständlich, Oberfläche bedienbar.*
- **F3.3 Straßen aus der Ferne:** Miltenberg neu erzeugen, spielen, Kamera hoch und weit. *Straßen lesen sich als
  Straßen: gerade Kanten, Belag längs, Rand- und Mittellinien je Klasse, Wohnstraßen mit Bordstein und Rinne,
  Kreuzungen ohne Naht, am Rand ein Bankett statt Gras.* Altstadtgassen: *nicht mehr fransig und kantig.*
- **F3.4 Tunnelportal:** in derselben Welt an beide Tunnelportale heran. *Portal zeigt nach außen, kein Flimmern an
  den hinteren Kanten, der Hang liegt auf dem Gewölbe, die Straße läuft sichtbar hinein, Gegner gehen hindurch.*

Paket F4, Wasser, Natur, Boden:

- **F4.1 Ufer und Wasser:** Archipelago und Witch Marsh, Spielkamera und nah. *Schaum als Spitze mit Lücken, mal
  schmal, mal breit, atmet am Ufer; aus der Ferne nur ein Hauch, kein weißer Rahmen.* Ein Fluss und ein höher
  gelegener See (Editor, Water, Becken gießen): *Flachwasser nicht türkis wie Plastik, Fluss trüber mit Bahnen in der
  Strömung, über der Wasserlinie ein nasser, glänzender Film.*
- **F4.2 Lava:** Ember Crater, Spielkamera und nah. *Geschlossene Risse dunkel, offene glühen, keine Waben, ein
  Lavafluss zeigt keine Dreiecke.*
- **F4.3 Bäume und Nordlicht:** Mountain Pass, Nadelbäume im Wind. *Sie wiegen sich langsam als Ganzes, nichts
  wobbelt oder flimmert.* Frost Hamlet nachts: *Nordlicht als gefaltete Vorhänge im Norden, unten hell und scharf,
  wandernd, keine gleichen Streifen.*
- **F4.4 Bodenoptik:** Demo Valley, Autumn Keep und Harbor Town, Spielkamera und nah. *Böden wirken gemalt,
  Stimmung je Biom, Wegränder zertreten, Geröll am Fuß von Fels und Hängen, Uferstreifen, Kleeinseln mit Blüten in
  der Wiese; Pflaster, Asphalt und Planken sauber, ohne gelbliche Flecken.*

Paket F5, Gegner, Tower, Ton:

- **F5.1 Zombies:** Custom Wave, Zombie, Count 40, dann auf 4x. *Fahle Haut (grau-grün, gelblich, bläulich),
  verblichene Kleidung, Dreck von den Füßen, Blut von Brust und Mund, jeder etwas anders; der Lauf flüssig auch bei
  4x, Zombie V1 ohne Sprung am Loop-Ende.*
- **F5.2 Tower auf Mauern und Gebäuden:** Autumn Keep oder Twin Gates, einen Tower auf den Wehrgang einer Burgmauer,
  einen auf ein Hausdach setzen. *Auf der Mauer rückt er auf die Mittellinie, Konsolen tragen ihn beidseitig; auf dem
  Dach steht er auf dem Dach.* Palisade oder Zaun: *kein Bauplatz.*
- **F5.3 Sägearme:** Chainsaw gegen eine Welle, danach verkaufen. *Arme klappen in zwei Stufen aus, bleiben auf ihrer
  Seite, kreuzen und durchdringen sich nicht, folgen weich; nach dem Verkauf sofort still.* Seit 2026-10-19: *kein
  Gegner stirbt, bevor eine Säge an ihm ist; die Arme sägen nicht im Gleichtakt und schwenken beim Gegnerwechsel
  ruhig; Blut spritzt beim Ansetzen und beim Sägen (nicht bei Skeletten, Panzern oder Mechs); Zielwahl am Tower
  (z. B. stärkster) gilt auch für die Arme.*
- **F5.4 Ton:** Sentinel Laser, Chainsaw, Shawarma Slicer und Iron Bastion bauen, eine Welle. *Eigene Klänge (Laser
  zündet und brummt, Säge läuft an, läuft, schneidet, Slicer-Maschine), die Flak-Salve knallt dort, wo sie platzt.*
  Demo Valley eine Minute hinhören: *Umgebung leiser, Vögel als einzelne Rufe mit Pausen, keine Dauerschleife.*

Paket F6, Editor:

- **F6.1 Absenken:** Editor, Terrain, „Lower“, einen tiefen Strich über eine Kachelgrenze halten. *Kein dunkles
  Kreuz entlang der Kachelränder, auch nicht während des Strichs.*
- **F6.2 Ohne Hänger:** eine OSM-Welt im Editor. Landscape, Gebirge groß malen; Roads, einen Knoten ziehen; Check
  offen (V) beim Malen; Ctrl+S. *Flüssig, die Straßenfläche folgt dem Knoten, der Check meldet erst nach dem Strich,
  Speichern ohne Ruckler.*
- **F6.3 Hang-Fels und Mountain Pass:** Mountain Pass im Spiel und im Editor. *Objekte sitzen auf dem Boden, nichts
  schwebt oder sinkt ein.* Editor, Objects, einen Fels an einen steilen Hang setzen, Check: *„floating“ nur, wenn
  man den Spalt auch sieht.*
- **F6.4 Unbekanntes Biom:** eine `.3dtdmap` entpacken (Zip), in `map.json` `environment.biome` auf `"jungle"`
  setzen, wieder packen, Editor, Kartenliste, „Import file“. *Die Karte öffnet, Banner „environment biome jungle is
  unknown; the map looks temperate“.* Dieselbe Karte spielen: *das Banner bleibt, bis man es schließt.*

Paket F7, Modelle:

- **F7.1 Pfahlhaus:** Witch Marsh, am nördlichen Steg. *Das Pfahlhaus steht neben dem Steg, nicht darauf.*
- **F7.2 Kutter und Kühe:** `/map-preview?assets=fishing-boat,cow,cow-grazing,cow-lying`. *Kutter mit Rumpf, Kajüte,
  Mast und Deckzeug, verwittert; Kühe mit Fell statt einfarbig.* Im Editor, Objects, mehrere Kühe streuen: *Holstein,
  Fleckvieh, Braunvieh und Angus gemischt.*

## G Einzelfixes (2026-10-18)

Logik (keine Welle, kein Gold, kein Auto-Start, Spuren) ist per Szenario-Test gedeckt; hier nur, was man sieht.

- **G1.1 Ohne Route:** einen Ort per Link kalt laden, dessen einziger Spawn auf einer Insel ohne Brücke liegt
  (`?l=<HQ am Ufer>&s=<Punkt auf der Insel>`). *Menü: „No route possible between HQ and spawn. The streets are not
  connected. Pick another place.“, Play gesperrt, ein anderer Ort lädt normal.*
- **G1.2 Ein Spawn ohne Route:** derselbe Link mit einem zweiten Spawn auf dem Festland (`&s=<Insel>;<Festland>`).
  *Banner „No street leads from … to the HQ: it sends no enemies …“, bleibt bis zum Schließen; Welle starten: alle
  Gegner kommen vom Festland, der Wellenzähler steigt einmal je Welle.*

- **G1.3 Continue ohne Route:** einen Spielstand laden, dessen Welt keine Route hat (aus 0.7.1, wo leere Wellen
  gespeichert wurden). *Meldung statt Lauf, der Ort wechselt nicht; ein neuer Lauf am selben Ort spielt normal.*

## H Runde 5 (2026-10-18)

Nur Augen und Gefühl; Logik und Pixelgleichheit sind per Test gedeckt.

- **H1 Gelände auf der GPU:** Demo Valley im Editor, Raise und Smooth mit großem Pinsel. *Kein Stocken, Hänge
  schattieren wie vorher, keine Nähte.*
- **H2 Wiese:** Stillwater oder Demo Valley von oben, Wiese mit Klee. *Kleeinseln unregelmäßig verteilt, kein Raster.*
- **H3 Wasserspiegel:** Witch Marsh oder Archipelago, mit der Kamera langsam an einen See heran und wieder weg, aus
  mehreren Winkeln, Ultra. *Spiegelung blendet weich ein und aus, kein Aufploppen.*
- **H4 OSM-Flächen und Lava:** OSM-Welt für Lindau (Bodensee), Hallstatt, Cochem und Miltenberg bauen. *Seen und
  Wälder am Rahmen geschlossen, keine Diagonalen quer über die Karte, Lindau-Insel mit Brücken.* Mars Canyon im
  Editor, Krater mit Lava füllen. *Kraterflanken als Fels, nicht glatt orange.*
- **H5 Straßen bei vollen Servern:** einen Echtwelt-Ort kalt laden, wenn overpass-api.de ausgelastet ist. *Ladeplatte
  zeigt „The map server is busy, trying again (n of 8)…“, Straßen kommen nach einiger Zeit; Zürich oder London laden
  in wenigen Sekunden.*

## I Licht durch Munition (2026-10-18, E242)

Nur Augen; Auswahl, Raster und Ausklingen sind per Test gedeckt ([SHOT_LIGHTS.md](SHOT_LIGHTS.md)).

- **I1 Nacht:** Harbor Town im Editor auf Nacht stellen (Environment, Sky „Night“), spielen, vier Gatlings, eine Iron
  Bastion und einen Magic Tower an eine Straße zwischen Häusern, eine Welle. *Unter den Gatlings flackert ein warmer
  Lichtfleck, Leuchtspuren ziehen einen Schimmer über die Straße, Explosionen färben Hauswände und Gegner orange und
  klingen rot aus, Magic- und Chaos-Treffer violett. Nichts bleibt hängen, kein Flackern ganzer Flächen.*
- **I2 Held:** dieselbe Szene mit dem Helden, alle drei Munitionen durchschalten. *Standard gelb, Explosiv orange mit
  kleinem Blitz am Einschlag, Rune violett; der Held selbst leuchtet im Licht seiner Schüsse auf.*
- **I3 Stufen:** Settings, Graphics, Picture quality Low, Medium, High, Ultra während des Kampfs. *Low ohne Licht der
  Schüsse, sonst sofort, kein Stocken beim Umschalten. Die Zeile unter Custom maps nennt die Zahl.*
- **I4 Tag und echte Orte:** eine eigene Karte bei Tag und ein echter Ort. *Bei Tag dezent, nicht grell; auf dem echten
  Ort leuchten nur Tower, Held und Gegner auf, die Tiles nicht.*

## J Laden und Speicher (Runde 8, 2026-10-19)

Speicher und Haltepfade sind gemessen (`e2e/perf/world-switch.ts`); hier nur, ob nach einem Wechsel alles wieder so
aussieht wie beim ersten Mal (die geteilten Texturen und Materialien laden je Welt neu hoch).

- **J1 Weltwechsel:** Built Worlds › Demo Valley › Play, einen Tower bauen, eine Welle; dann fünfmal über Built Worlds
  zwischen Ember Crater, Archipelago und Demo Valley wechseln. *Gerüst beim Bau, Portalrahmen, Schatten unter den
  Gegnern, Schaum am Ufer, Lava und Wasserwellen wie beim ersten Mal; Vorschaubilder der Seitenleiste da; keine
  schwarzen oder weißen Flächen.*
- **J2 Editor und Test:** Demo Valley im Editor, Test, zurück, zweimal. *Paletten-Bilder, Wasser und Gelände wie vorher.*
- **J3 Ladeschirm:** Demo Valley kalt laden (F5). *Nach dem Korridor steht „Compiling Shaders“ mit hochzählendem
  „x / y“, nicht sekundenlang „Preparing Intro Flight“; die Schritte springen ohne spürbare Pausen.*
- **J4 Gelände und Wasser aus dem Worker:** eine OSM-Welt (Miltenberg) und Ember Crater laden. *Mulden und Hangfüße
  dunkler, Rinnen grüner, Ufer mit Schaum und Strömung, Lava-Rand erkaltet und glüht wie vorher; kein Moment mit
  hellem, flachem Boden nach dem Ladeschirm.*

## K Nachtschicht 2026-10-18/19

Nur Augen und Ohren; Logik, Prüfsummen und Strukturzahlen sind per Spec und Probe gedeckt. Alles auf `next`.

- **K1 OSM-Stadt:** eine OSM-Welt mit Altstadt laden (z. B. Miltenberg). *Jeder Grundriss steht als Gebäude, auch
  große mit Innenhof; Fachwerk und Verwitterung; Hallen behalten fern ihr Dach; Läden mit Schildern; Bahn mit
  Gleisbett und ebenerdigen Übergängen; Kaimauern statt Strand.*
- **K2 Straßen und Gelände fern:** dieselbe Welt, auf den Horizont zoomen. *Straßen fern als Straßen lesbar (dunkler
  Belag, helle Kanten, Markierung), Gehwege in Wohnstraßen; kein sichtbarer Übergang zwischen nahem und fernem Boden.*
- **K3 Wetter:** eigene Karte, Environment auf Gewitter, dann Regen. *Blitz erhellt das Land, Donner nach Entfernung,
  Regen mit Regenton; nachts ohne Mond bleibt die Karte lesbar.*
- **K4 Tower:** Iron Bastion, Kanone, Ballista und Kettensäge feuern lassen. *Iron Bastion fährt sichtbar zurück und
  federt, Staub am Fuß; Ballista spannt nach; Sägeblatt quer, Arme berühren sich nicht.*
- **K5 Zerstörung:** Ruined City, eine Welle mit Explosivwaffen gegen Gebäude. *Risse und Ruß, dann ein Biss mit
  Glutkanten und Decken und Innenwänden, dann ein Fall mit stehendem Stumpf; Krater mit verbrannter Sohle; Schutt.
  Noch ohne Klang.*
- **K6 Laden und Wechsel:** Demo Valley kalt laden, dann Editor, Test, Editor, Test. *Spielbar nach wenigen Sekunden;
  der zweite Teststart deutlich schneller als der erste; Bäume fern ohne Aufpoppen; auch der erste Teststart ohne
  Bild, das sichtbar hält (E246, 2026-10-19).*
- **K7 Sprache und Editor:** Settings, Gameplay, Sprache auf Deutsch. *Editor und Seitenleiste deutsch, Turm- und
  Gegnernamen englisch; nichts abgeschnitten (bekannt: „Ungepanzert“ im Wellen-Tooltip).*
- **K9 Witch Marsh nachts:** Witch Marsh spielen, Spielkamera und nah. *Wege, Inseln, Tower und Gegner aus der
  Spielkamera lesbar, Laternen bleiben die hellsten Stellen, Sumpfstimmung bleibt. Wasser noch fast schwarz: reicht es,
  oder soll es nachts einen matten Mondschimmer bekommen?*
- **K10 Spielplatz:** OSM-Welt mit Wohngebiet (z. B. Stuttgart). *Spielplätze ohne Bodenangabe grün mit Sandkasten,
  Schaukel und weiteren Geräten je nach Größe; roter Gummi nur, wo OSM ihn nennt.*
- **K8 Adresssuche:** Neues Spiel, einen Ort suchen. *Tippen sucht nicht, Hinweis „Enter drücken, um zu suchen“;
  Enter oder die Lupe rechts im Feld suchen, die Liste kommt; die Lupe ist unter drei Zeichen ausgegraut.*

## Eichtabelle

Fingerprints aus `__corridor.fingerprint()` für K2.1 und K2.2. Alle Werte vor 748 (Rothenburg `d8050177`, Tokyo
`efc7362a` usw.) gelten nicht mehr. Ein neuer Wert gilt, bis ein Commit den Korridor ändert; dann hier leeren.

| Ort | URL-Parameter | Fingerprint | `tileSet` | Datum |
|---|---|---|---|---|
| Tokyo | `l=35.65924,139.70049&s=35.65208,139.69853` | | | |
