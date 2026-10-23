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
- **C3.3 OSM-Welt Musterdorf:** New game, „A map of a real place“, Musterdorf 12345. *Einfamilienhäuser statt Wohnblöcken,
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
- **K11 Wasser im Editor:** eigene Karte mit kleinem See, mit dem Wasser-Pinsel weit über den See hinaus malen.
  *Ufer, Schaum und Strömung folgen sofort und überall; kein Fleck ohne Schaum oder mit hartem Rand.*
- **K8 Adresssuche:** Neues Spiel, einen Ort suchen. *Tippen sucht nicht, Hinweis „Enter drücken, um zu suchen“;
  Enter oder die Lupe rechts im Feld suchen, die Liste kommt; die Lupe ist unter drei Zeichen ausgegraut.*

## L Ironclad Warlord (2026-10-19)

Neuer schwerer Elite-Gegner. Logik (Wut, Lauf-Clip, Schrei-Event, Budget) ist per Spec gedeckt, Wut und Lauf-Clip
einmal per Browser-Probe in DevWorld gesehen; hier Augen und Ohren.

- **L1 Aussehen und Gang:** Developer options › Enemies (Enemy Debug), unter „Placement“ `Ironclad Warlord`, Stecknadel,
  Klick auf die Route, in „Debug Enemies“ anklicken, „Start“; Kamera nah ran. *Ork in Eisenplatten, gut doppelt so groß
  wie ein Zombie Soldier, Füße gleiten nicht, er steht auf dem Boden; Farben nicht gelbstichig oder zu dunkel.*
- **L2 Schritte und Brüllen:** derselbe Gegner, Kamera nah. *Schwere Schritte mit Plattenklirren im Takt der Füße, die
  Kamera bebt leicht; alle 12 bis 30 s ein tiefes Brüllen; ernst, nicht comichaft.*
- **L3 Wut:** ein paar Archer an die Route bauen, Wave Debug › „Single“, Type `Ironclad Warlord`, Count 2, „Start Custom
  Wave“. *Unter gut einem Drittel HP: Wutschrei, „ENRAGED“, rot, er rennt (Lauf-Clip, schneller), Füße gleiten nicht.*
- **L4 Treffer und Tod:** dieselbe Welle mit einer Kanone. *Treffer klingen dumpf metallisch; beim Tod Stöhnen, dann
  der Aufschlag der Rüstung; er fällt nach vorn, liegt am Boden und verschwindet erst danach.*
- **L5 Seitenleiste:** während der Custom Wave aus L3 die Gruppe im Wellen-Panel überfahren. *Name
  „Ironclad Warlord“, Vorschau dreht sich, Tooltip nennt „Enrages below 35 % of its HP“; auf Deutsch „Wütet unter 35 %“.*

## M Boss Jumper (2026-10-19)

Der Krabben-Läufer mit dem Zwillingsgeschütz ([ENEMY_CREATION.md](ENEMY_CREATION.md#geschützturm-und-belagerung-jumper)).
Zielwahl, Kadenz, Einsturz und Gleichheit über Läufe sind per Spec gedeckt; hier Augen und Ohren. Die Klänge sind
erzeugt und nach Messwerten ausgewählt, nicht angehört: bei jedem Klang sagen, ob er passt.

- **M1 Gang in DevWorld:** `http://localhost:4200/?devworld`, Wave Debug, „Single“, Type „Jumper“, Count 1, „Start
  Custom Wave“; Kamera nah ran. *Kommt er aus dem Portal, das Boss-Intro mit Karte „Jumper“, „The Siege Engine“ und
  eigenem Klang; er läuft wie eine Krabbe quer zur Route, die Front zur Seite, Beine treten diagonal paarweise
  seitwärts, Füße gleiten nicht über den Boden, der Rumpf wiegt schwer von Paar zu Paar, Scheren schweben knapp über
  dem Boden und arbeiten; bei jedem Aufsetzen ein schwerer Stahlschritt und nah an der Kamera ein leichtes Beben;
  Lauf-Loop hörbar. In DevWorld schießt er nicht, der Turm schaut die Route entlang, quer zum Rumpf.*
- **M2 Aussehen:** dieselbe Welle, um ihn herum drehen. *Gesicht mit Augen vorn, rote Raketenkästen am Turm, zwei
  Rohre, Farben wie im Blender-Bild (dunkelgrauer Rumpf, helle Beine, rote Teile); keine Löcher, keine Flecken, die
  flackern; gut 14 m breit, gut 9 m hoch.*
- **M3 Beschuss in Ruined City:** Built Worlds › Ruined City › Play, Wave Debug „Single“, Jumper, 1, „Start Custom
  Wave“. *Der Turm dreht mit Surren zum nächsten Gebäude, die Rohre heben sich etwas; dann ein schwerer Doppelschuss:
  Rohre fahren zurück, großes Mündungsfeuer, Licht, Rauch vor den Rohren, Staub um die Füße, ein Beben; ein glühender
  Strich mit Rauchspur fliegt zum Gebäude, dort Explosion mit Funken und Brocken, Einschlagklang, das Gebäude bekommt
  Risse oder fällt mit Staubwand und Schutt; ein Krater. Etwa alle 5,5 s ein Schuss, solange Gebäude in 80 m stehen.*
- **M4 Kein Ziel mehr:** in M3 warten, bis er an einer Stelle ohne stehende Gebäude ist (oder Atomschlag vorher).
  *Der Turm dreht zurück nach vorn, kein Schuss ins Leere.*
- **M5 Tower auf dem Dach:** in Ruined City vor der Welle einen Tower auf das Dach eines Gebäudes nah an der Route
  bauen, dann M3. *Dieses Gebäude beschießt er nicht, er nimmt ein anderes.*
- **M6 Boss-Welle:** Ruined City, Wave Debug, „Jump to wave“ 45, Start. *Name „Boss: Jumper“, eigene Boss-Musik
  (industrieller Marsch, nicht der übliche Boss-Track), Panzer und Zombie-Soldaten dabei; Boss-Leiste oben.*
- **M7 Tod:** in M1 Credits holen, an der Route einige Kanonen und Raketen bauen (Research per Cheat) oder den
  Atomschlag nehmen, bis er fällt. *Er sackt zusammen: Beine knicken nach außen, Bauch auf den Boden, Rohre sinken,
  er rollt etwas zur Seite; schwerer Explosionsklang, Beben; nichts versinkt im Boden. „Kill“ unter Cheats zeigt den
  Tod ohne Klang (kein Kill eines Towers).*
- **M8 Krebsgang beim Zielen:** in M3 eine Straße mit Häusern auf beiden Seiten abwarten und auf den Rumpf achten.
  *Er bleibt mehrere Schüsse auf einer Seite und nimmt die Häuser dort; schießt er doch auf die andere Seite (dort
  viel näher oder auf seiner keines mehr), schwenkt nur der Turm hinüber. Den Rumpf dreht er höchstens alle 16 s,
  ruhig in etwa 3,5 s über vorn (dabei kurz normaler Gang), und läuft dann in die andere Richtung seitwärts weiter;
  die Rohre bleiben auf dem Ziel, die Schritte setzen ohne Sprung fort. In Ruined City etwa einmal je Minute.*
  **2026-10-20 User (vor dem Fix):** drehte zu schnell und zu oft hin und her in Straßen mit Häusern auf beiden
  Seiten (E257, jetzt die Regel oben); Ruckeln bei Gebäudetreffern (E256, behoben).
- **M9 Vorschau:** Enemy Debug, Typ „Jumper“, und in der Wellenvorschau von W45. *Drehbild ganz im Rahmen, Beine
  laufen.*

## N Performance, Jumper und Zerstörungswerkzeug (2026-10-20)

Gemessen ist alles per Probe (e2e/perf); hier zählt das Gefühl im echten Spiel. Konsole offen.

- **N1 Treffer:** Ruined City › Play, Wave Debug „Single“, Jumper, 1, „Start Custom Wave“, 30 s zusehen, auch nah am
  Kartenrand. *Beim Einschlag und Einsturz kein spürbares Ruckeln, auch nicht kurz danach; Effekte wie vorher.*
- **N2 Wellenstart:** Ruined City › Play, nach dem Laden 15 s nichts tun, dann gleich nach dem Laden einmal den
  Wellenknopf. *Kein Ruckeln im Leerlauf, die Welle startet ohne Hänger.*
- **N3 Bauvorschau OSM:** eine OSM-Welt (gern die eigene Testwelt) › Spiel starten, sofort im Baumenü den Bogenschützen
  wählen, die Maus die Route entlang ziehen, Escape; 3 bis 4 Mal, dann ein anderer Tower. *Kein Hänger beim Wählen,
  bei der ersten Bewegung und beim Entlangfahren, auch auf neuer Strecke.*
- **N4 Lava-Pinsel:** Editor › eine Karte › Lava-Becken pinseln; im Spiel einen Krater am Lavarand. *Pinsel flüssig;
  Glut, Funken und Lichter erscheinen etwa 0,25 s nach dem Absetzen.*
- **N5 Jumper hält die Seite:** wie M8. *Mehrere Schüsse auf einer Straßenseite, Rumpf dreht höchstens alle 16 s.*
- **N6 Jumper nimmt Häuser:** OSM-Welt mit Gleisen und Häusern an der Route, Jumper wie N1. *Er feuert auf Häuser,
  nicht auf Gleise, Zäune oder Hecken; Kleinkram geht nur nebenbei kaputt.*
- **N7 Werkzeug:** Ruined City › Play › Developer options › „Zerstören“. Rakete an, mehrmals in die Stadt klicken;
  ein Haus wählen, „Fell now“, „Mend“, wieder „Fell now“; „Nuke“ klicken. *Treffer wie echte; das Haus fällt beide
  Male gleich; Pilzwolke, alles in 25 m fällt, Krater.*
- **N8 HP-Balken:** nach N7. *Balken über beschädigten Häusern, keiner bei 100 % oder über Ruinen; Alt halten blendet
  sie mit den Gegnerbalken aus; ein Haus davor verdeckt den Balken.*
- **N9 Hecken nach dem Laden:** eine schon gespielte OSM-Karte mit Zerstörung laden, Konsole in den ersten Sekunden;
  dann oben auf Edit. *Kein „Shader Error … foliage-hedge-bush … vNormal“.*
- **N10 Altstadt beim Zoomen:** OSM-Welt mit Fachwerkhäusern, aus der Spielkamera langsam heraus- und hineinzoomen;
  dasselbe an einem Wohnblock und einem Einfamilienhaus. *Dach bleibt dunkel ziegelrot, Wände behalten ihre Farbe,
  nur die Ziegelstruktur glättet sich leicht.*
- **N11 Radius für Nuke:** wie N7, „Nuke“ wählen, Regler auf 5 m, in die Stadt klicken; dann 100 m an anderer Stelle.
  *Bei 5 m fällt nur, was direkt getroffen ist, kleiner Krater und kleine Wolke; bei 100 m fällt ein ganzes Viertel,
  Krater und Wolke entsprechend groß. Bei Kanone und Rakete kein Regler.*

## O Listenbilder der Karten (2026-10-21, E289)

Ein Bild wie bei den mitgelieferten Karten: Boden in seinen Farben, Wasser, Bäume, Wege hell, Spawns rot, HQ gelb,
Norden oben.

- **O1 Alte Karte ohne Bild:** Globen › Built Worlds, eine eigene Karte, die bisher ein leeres Feld hatte (z. B.
  „Editor Testworld1“), in Zuletzt und Eigene Welten. *Nach einem Augenblick erscheint ihr Bild in beiden Zeilen,
  nach einem Neuladen sofort.*
- **O2 Autosave:** die Karte › Edit, einen Spawn versetzen oder einen Weg ziehen, warten bis „Saved“ (kein Strg+S),
  über die Globen zurück nach Built Worlds. *Das Bild zeigt die Änderung; kein Ruckeln beim Autosave.*
- **O3 Neu, Import, OSM:** New map anlegen und einmal ändern; eine `.w3x` oder fremde `.3dtdmap` importieren; eine
  neue OSM-Welt bauen. *Alle drei mit Bild; die OSM-Welt mit Norden oben wie im Spiel (vorher stand ihr Bild auf dem
  Kopf).*

## P Gräben und Rinnen in OSM-Welten (2026-10-21, E286)

Neu bauen, alte OSM-Welten behalten ihre Gräben. Ort im Feld „A map of a real place“ als Koordinaten eingeben.

- **P1 Betonrinne im Weinberg:** New game, „A map of a real place“, `49.9214, 7.0720` (Mosel), bauen und von nah auf
  die Rinne im Weinberg östlich des HQ schauen, dann aus Spielhöhe. *Eine schmale graue Rinne aus Halbschalen den
  Hang hinab, eine Seite hell, eine im Schatten, am Grund ein dunkles Rinnsal; kein blaues Band, kein Schilf, kein
  Kiesufer, kein Gras auf den Schalen. Aus Spielhöhe eine feine helle Linie mit dunkler Mitte.* Wenn möglich auch am
  eigenen Weinberg mit Rinnen.
- **P2 Erdgräben:** wie P1 mit `49.8895, 10.1600` (Weinberg in Franken mit vielen Gräben). *Die Gräben sind flache
  Erdmulden ohne Wasser und ohne Schilf; Weinbergzeilen reichen bis an den Graben, stehen nicht darin.*

## Q Rebzeilen in OSM-Welten (2026-10-21, E285)

Neu bauen, alte OSM-Welten behalten ihre Zeilen (die neue Zeichnung, Hang und Farbton je Zeile, gilt aber auch dort).
Richtung, durchgehende Zeilen, Ende an der Grenze und Bruch an einem Weg prüfen Specs (`crop-rows.spec.ts`,
`vegetation.spec.ts`); hier nur das Auge.

- **Q1 Steilhang:** New game, „A map of a real place“, `49.9214, 7.0720` (Mosel), bauen, aus Spielhöhe auf die
  Weinberge östlich des HQ, dann von nah zwischen die Zeilen. *Je Parzelle gerade, parallele Zeilen den Hang hinauf,
  ohne Treppen und Lücken; die Pfähle stehen senkrecht, Draht und Laub laufen am Boden entlang; jede Zeile endet mit
  einem Pfahl kurz vor der Parzellengrenze, an Wegen und an der Betonrinne bricht sie ab.*
- **Q2 Franken:** wie Q1 mit `49.8895, 10.1600`. *Zeilen den Hang hinab, durch die großen Flächen durchgehend, an
  Feldwegen und Erdgräben unterbrochen.* Aus größerer Höhe kann ein Moiré-Muster über dichten Zeilen flimmern: notieren,
  ob es stört.
- **Q3 Flache Lage:** wie Q1 mit `49.4000, 8.1950` (Ruppertsberg, Pfalz). *Zeilen rechtwinklig zu den Wirtschaftswegen,
  zwischen denen der Block liegt; fern der Route fehlen ganze Zeilen statt einzelner Stücke.*
- **Q4 Gewölbter Hang (Nachbesserung):** eine Welt mit Weinbergen an einem Hang, der sich um eine Kuppe dreht (wie Q1
  oder ein eigener Ort), neu bauen, aus Spielhöhe hangauf schauen, dann von oben. *Überall laufen die Zeilen den Hang
  hinauf, auch wo der untere Feldweg quer liegt; wo der Hang dreht, wechseln Blöcke die Richtung mit einer schmalen
  Gasse dazwischen, deren Grenze dem Hang folgt (keine rechtwinkligen Treppen).*

## R OSM-Grundrisse in OSM-Welten (2026-10-21, E290)

Nur mit diesem Stand neu gebaute OSM-Welten tragen die Grundrisse; ältere (auch die mit dem ersten Format) zeigen die
Kachel nicht.

- **R1 Kachel und Ebene:** New game, „A map of a real place“, einen Ort mit Altstadt bauen (z. B. Miltenberg), im Spiel
  unten rechts Entwickleroptionen › Karte › „OSM“. *Kästen mit Kanten über allen Häusern der Karte, auch fern der
  Routen und am Kartenrand, sofort da; gut sichtbar auch hinter Dächern; nochmals klicken blendet sie aus. Im
  Ebenenmenü kein Knopf „Gebäude“.* Danach vor Welle 1 eine weitere Spur öffnen: *die Grundrisse bleiben, wie sie sind.*
- **R3 Arten:** wie R1, Maus auf die Kachel: *der Tooltip nennt die Farben.* Über der Altstadt umherfliegen: *Häuser
  türkis, Gebäudeteile (Türme, Anbauten mit eigener Höhe) messingfarben, ein Hof als Loch mit hellen Kanten, an
  Straßen oder beim HQ weggelassene Grundrisse rot, wo es welche gibt unterirdische grün und nicht am Boden
  Stehendes (Brücke, eingestürzt) orange flach am Boden.* (Ruinen stehen seit E297 L2 als Ruine, türkis.) Nach Augenmaß: *die Farben sind gut auseinanderzuhalten.*
- **R2 Echter Ort unverändert:** einen echten Ort (3D-Tiles) spielen, Ebenenmenü › „Gebäude“. *Wie bisher: Grundrisse
  an den Routen, im Entwicklermenü keine Kachel „OSM“.*

## S Rahmen der Karte von einem Ort (2026-10-21, E282)

Variante B: der Rahmen steht fest in der Mitte, die Karte wird darunter gezogen. Rechnung (Zoom zur Kante, Tasten,
Laden ohne Sprung, HQ in der Mitte) prüfen Specs (`osm-frame-view.spec.ts`, `osm-frame.scenario.spec.ts`); hier Hand
und Auge. Globen › OpenStreetMap, einen Ort suchen (z. B. Miltenberg).

- **S1 Öffnen:** *Unter dem Titel „Karte ziehen, bis der Rahmen sitzt. Das HQ steht in der Mitte.“, darunter sofort die
  Karte mit dem Messingrahmen, im Rahmen ein Schleier „Straßen und Gebäude laden“ mit kleiner Mauer; die Schrittliste
  steht unter der Karte. Ist der Ort da, verschwinden Schleier und Liste, Karte und Rahmen bleiben, wo sie waren.*
- **S2 Ziehen:** in den Rahmen klicken und ziehen. *Greifhand, beim Ziehen geschlossen; die Karte gleitet unter dem
  festen Rahmen, das HQ bleibt als Messingpunkt in der Mitte, die Routen sind weg. Losgelassen: Schleier im Rahmen,
  oben und unten springt nichts; danach HQ und Routen neu, unter HQ „In der Mitte des Rahmens, … von der Adresse“.*
  Weit ziehen: *die Karte hält an, wenn die Adresse nahe an den Rand käme.*
- **S3 Spawn ziehen:** einen roten Spawn greifen und auf eine andere Straße ziehen. *Nur der Spawn wandert, die Karte
  steht.*
- **S4 Kante:** den Regler „Kante“ unter der Karte ziehen. *Der Rahmen bleibt gleich groß, die Karte zoomt, daneben
  „1,8 km“ usw.; erst beim Loslassen lädt es (Schleier im Rahmen).* Dann die Karte anklicken und Pfeiltasten, Plus,
  Minus drücken: *die Karte rückt, die Kante ändert sich; nach dem Loslassen der Taste lädt es.*

## T Besondere Gebäude in OSM-Welten (2026-10-21, E297 L1 bis L3)

Nur neu gebaute OSM-Welten. Einteilung, Durchgang, Deckungsschwelle, Ruine und HQ prüfen Specs (`building-tags.spec.ts`,
`buildings.spec.ts`, `roads.spec.ts`), Teile mit Höhen, Abdeckung, Farben, Zerstörung und gleicher Bau auf jedem
Rechner `building-parts.spec.ts`, `object-mass.spec.ts`, `mass-layer.spec.ts`; hier Auge und Route. Dächer über
beliebigen Umrissen, Turmhelme als eigene Form und Fassadenfamilien kommen erst (L4 bis L6).

- **T1 Schloss mit HQ im Hof:** New game, „A map of a real place“, `49.9763, 9.1414` (Schloss Johannisburg,
  Aschaffenburg), die Karte ziehen, bis das HQ (Mitte des Rahmens) im Schlosshof sitzt, bauen. *Das Schloss steht als ein Bau aus seinem Grundriss um den
  Hof, sechs Geschosse in Stein mit Rundbogenfenstern, flaches Dach; keine Wohnblöcke. Das HQ steht im Hof, wo es
  hingesetzt wurde, kein Flügel fehlt.* Notieren, ob das HQ in eine Wand ragt.
- **T2 Durchgang:** in T1 die erste Welle starten und den Gegnern folgen, die zum Hof laufen. *Sie gehen durch die
  Durchgänge in den Flügeln in den Hof (dort noch ohne Torbogen: sie verschwinden in der Wand und kommen im Hof heraus),
  nicht außen herum und nicht über das Dach; im Hof laufen sie nicht durch die Wände.*
- **T3 Altstadt:** wie T1 mit `49.7932, 9.9312` (Würzburg, Dom). *Häuser stehen auf ihrem ganzen Grundriss, auch an
  Plätzen und in Hofformen (ein Bau statt einzelner Blöcke mit Lücken); Reihen von Altstadthäusern bleiben einzelne
  Häuser; nichts steht auf den Straßen.* Notieren, wo flache Dächer über Hofblöcken stören (kommt mit L4).
- **T4 Ruinen:** wie T1 mit `49.4106, 8.7153` (Heidelberger Schloss), Zerstörung an. *Die Ruinen (Dicker Turm,
  Ludwigsbau und andere mit `ruins=yes`) stehen von Anfang an als gefallene Ruinen mit Schutt, wie zerstörte Häuser;
  die übrigen Schlossbauten stehen in Stein.* Notieren, ob Glut und Ruß an alten Ruinen stören und wie die Türme
  liegen.
- **T5 Schloss aus seinen Teilen (L3):** wie T1, das Schloss von außen an einer Ecke ansehen. *Vier Flügel mit
  Satteldach (einer mit flacherem Mansarddach), an den Ecken höhere Türme, auf ihnen spitze Hauben bis 52 m (als
  Pyramide, die Zwiebelform kommt mit L5); im Hof vier achteckige Treppentürme mit Pyramide; rote Sandsteinwände,
  graue Schieferdächer.* Notieren, wo Teile flimmern oder Lücken zwischen Flügel und Turm klaffen.
- **T6 Dom (L3):** wie T3, den Dom von Westen und von oben ansehen. *Zwei Westtürme mit dunklen Helmen bis 64 m, zwei
  rote Osttürme mit grünen Kupferhelmen, Langhaus und Querhaus mit Satteldach, Vierung mit Pyramide; die Westfassade
  steht ganz (vorher fehlte sie).* Notieren, wo Wege des Platzes in den Dom ragen.
- **T7 Zerstörung eines Baus aus Teilen (L3):** in T5 einen Flügel des Schlosses beschießen, bis er fällt
  (Zerstörung an). *Das ganze Schloss wird eine Ruine, Türme und Hauben fallen mit, nichts bleibt in der Luft stehen.*

## U Kratersee im Editor (2026-10-21, E294)

Ob ein Krater einen Fluss schneidet, wie hoch der See steht und wohin er überläuft, prüfen Specs (`crater-water.spec.ts`,
`landscape.spec.ts`); hier das Auge. Editor, Mountain Pass öffnen, Landschaft › Krater, Pinselradius etwa 30.

- **U1 Wasser:** den Pinsel auf den Bergbach halten (etwa drei Sekunden), loslassen. *Der Bach fällt über den Rand in
  die Grube, ein See steigt in wenigen Sekunden, läuft über; wo er überläuft, rinnt ein neuer Bach ab, das Bett
  darunter liegt trocken, bis das Wasser wiederkommt.* Strg+Z: *Grube und See weg, der Bach fließt wie vorher.*
- **U2 Lava:** wie U1 auf Ember Crater an einem Lavastrom. *Die Lava füllt die Grube langsamer, mit Kruste; ihr
  Überlauf erstarrt, wo er auf Wasser trifft.*
- **U3 Spielen:** die Karte aus U1 speichern und spielen. *Der See steht von Anfang an voll da, mit Fall und Überlauf.*
- **U4 Skript:** Editor, neue Karte, im Agenten-Skript `map.river([{x:0,y:-120},{x:0,y:120}])` und
  `map.form('crater',{x:0,y:0},{radius:40,strength:1},4)`. *Der See füllt sich wie beim Pinsel; gespielt steht er voll.*

## V Tunnel unter Gebäuden (2026-10-21, E299)

Welche Tunnel Durchgang, Tiefgarage oder Geländetunnel werden, prüft `underground.spec.ts`; hier das Auge. New game,
„A map of a real place“, `49.7932, 9.9312` (Würzburg), bauen.

- **V1 Kein Portal in der Stadt:** durch die Altstadt fliegen. *Kein Betonportal und kein Hügel zwischen den Häusern;
  wo vorher einer lag, stehen Häuser.*
- **V2 Tiefgarage:** eine Garageneinfahrt suchen (Rampe an einer Hauswand). *Kurze abgesenkte Rampe bis zur Wand; die
  Wand öffnet sich dort dunkel (W3).* Gegner laufen nicht hinein.
- **V3 Durchgang:** einem Fußweg folgen, der unter einem Haus durchführt. *Das Haus steht, der Weg läuft darunter
  durch.*

## W Durchgänge durch Gebäude (2026-10-21, E297)

Wo die Öffnungen liegen und wie hoch und breit sie werden, prüfen `buildings.spec.ts`, `building-parts.spec.ts`,
`mass-openings.spec.ts`, `mass-layer.spec.ts`; hier das Auge. New game, „A map of a real place“, `49.7932, 9.9312`
(Würzburg, Standardgröße), bauen; im Spiel nah heranzoomen und die Kamera tief stellen.

- **W1 Fußgängerzone:** zu `49.792930, 9.929030` (die Gasse, die von Westen in den Häuserblock führt und darin
  abknickt). *Im Fachwerkhaus an der Gasse eine Durchfahrt mit heller Putzfasche und Sturz; man sieht durch sie in den
  Gang, der im Block abknickt, Laibungen und Decke im Wandton, etwas dunkler; über der Öffnung stehen die Fenster wie
  sonst, keines ist angeschnitten; kein Schild und keine Markise davor.* Gegner laufen sichtbar hindurch.
- **W2 Hofeinfahrt:** zu `49.801880, 9.934385`. *Eine lange Durchfahrt (gut 40 m) durch den flachen Bau, an beiden
  Enden offen, man sieht ans andere Ende.*
- **W3 Tiefgarageneinfahrt:** zu `49.798047, 9.926921`. *In der Hauswand eine dunkle Öffnung mit Betonsturz, dahinter
  ein kurzer dunkler Raum, kein Modell, kein Portal.* Liegt die Rampe tiefer als die Straße, sitzt die Öffnung unten in
  der Rampe, das Haus selbst steht auf seinem Grund (nicht abgesenkt).
- **W4 Torbogen am Schloss:** neue Karte `49.9763, 9.1414` (Aschaffenburg), zum Schloss. *Durch die Flügel führen
  Rundbögen (gut 3,6 m breit, Scheitel um 4,4 m) mit hellerem Werkstein: Keilsteine mit Schlussstein, Kämpfer, Eckquader;
  innen ein Gewölbe; man sieht vom Vorplatz in den Hof und vom Hof hinaus.*
- **W5 Zerstören:** ein Haus mit Durchgang zerstören (Nuke). *Es fällt als Ruine wie andere Häuser, die Öffnung und
  ihre Laibungen fallen mit; nichts bleibt in der Luft stehen.*

## X Gebaute Welten aufgeräumt (2026-10-21, E302)

Gruppen, Zeilen, Platte und Menü prüft `worlds-stage.scenario.spec.ts`; hier Auge und Hand. Globen, Gebaute Welten.

- **X1 Liste:** ohne laufendes Spiel öffnen. *Oben nur der Hinweis, dann Eigene Welten (rechts „+ Neue Karte“,
  „Importieren“), Mitgeliefert, unten Papierkorb eingeklappt. Jede Karte einmal, keine Spawns in den Zeilen; zuletzt
  gespielte rechts „zuletzt heute“, OSM-Karten „OSM“. „Von Koop-Hosts“ fehlt, solange kein Host eine Karte schickte.*
- **X2 Laufendes Spiel:** eine Karte spielen, eine Welle starten, Esc, Alle Welten, Gebaute Welten. *Oben ein
  vertiefter Block: Bild, „Laufendes Spiel“, Name, „Welle 2 | heute …“, Weiterspielen, Papierkorb.* Weiterspielen
  zeigt das Spiel sofort; der Papierkorb fragt erst.
- **X3 Platte:** eine eigene Karte anklicken. *Die Zeile wird zur Steinplatte: „4 Spawns | geändert …“, Spielen,
  Bearbeiten, rechts „...“.* Eine mitgelieferte: *ihre Beschreibung, darunter „Deine Kopie entsteht mit der ersten
  Änderung“.* Doppelklick spielt, Pfeile wandern, Enter spielt, der Globus dreht mit.
- **X4 Mehr:** „...“ an einer eigenen Karte. *Menü Herunterladen, Duplizieren, Löschen; an einer mitgelieferten nur
  Herunterladen.* Esc und ein Klick daneben schließen es, Esc lässt das Weltmenü offen; Löschen legt die Karte in den
  Papierkorb, der aufgeht.

## Y Dächer über dem echten Grundriss (2026-10-21, E297 L4)

Formen, Höhen, Giebel, Brandwände und die Gasse prüfen `roof-skeleton.spec.ts`, `mass-roof.spec.ts`,
`building-mass.spec.ts`, `building-parts.spec.ts`, `buildings.spec.ts`; hier das Auge. New game, „A map of a real
place“, Koordinate eingeben, Standardgröße, bauen; die Kamera tief und nah stellen.

- **Y1 Schloss:** `49.9763, 9.1414` (Aschaffenburg), zum Schloss, von außen und über den Hof. *Jeder der vier Flügel
  hat ein Satteldach mit First entlang des Flügels, auch der leicht schiefe; an den Ecktürmen endet es senkrecht (kein
  Walm, der in den Turm läuft), an den Innenecken stoßen die Dächer zweier Flügel hinter den Treppentürmen aneinander,
  ohne Spalt und ohne Walm in die Ecke.* Vorher stand ein Flügel als Mansarde mit flachem Deckel.
- **Y2 Dom:** `49.7932, 9.9312` (Würzburg), zum Dom. *Die Seitenschiffe tragen Pultdächer, hoch am Mittelschiff, tief
  an der Außenwand (vorher flach mit Brüstung); der Kreuzgang südlich ein Pultdach rundum zum Hof hin, keine hohen
  kahlen Wände.*
- **Y3 Altstadt von oben:** gleiche Karte, über der Altstadt westlich des Doms hoch heranzoomen. *Fast alle Häuser
  geneigt: Satteldächer, einige Krüppelwalme, große Bauten Walm; über L-, T- und Hofformen je Flügel ein First mit
  Kehlen; zwischen Nachbarn enden Dächer an der Brandwand senkrecht ohne Überstand. Kein Haus steht als Rechteck über
  seinen Grundriss hinaus auf Gasse oder Gehweg.*
- **Y4 Nordzugang Fußgängerzone:** gleiche Karte, zu `49.792930, 9.929030`, von dort zur Domstraße; der Zugang liegt
  bei `49.79316, 9.92930`, von der Domstraße nach Süden schauen. *Die Gasse führt zwischen zwei Häusern hindurch zur
  Öffnung der Passage dahinter, nicht mehr gegen eine Wand.* Gegner, die dort laufen, gehen sichtbar durch die Gasse.
- **Y5 Zerstören:** ein Haus mit geneigtem Dach und eines mit Pultdach zerstören (Nuke). *Das Dach fällt mit, kein
  Dachstück oder Giebel bleibt in der Luft.*

## Z Krater und Einstürze ändern Route und Sicht (2026-10-21, E291)

Drosselung, Reichweite und Neuanfrage prüfen `world-sight-batch.spec.ts`, `tower-los-registry.spec.ts`,
`route-line-layer.spec.ts`; hier das Auge. Ruined City, Routen an.

- **Z1 Linie:** einen Atomschlag auf eine Route setzen. *Rote Linie und Korridor-Kacheln senken sich in die Mulde,
  andere Linien bleiben, wo sie sind.*
- **Z2 Sicht in die Mulde:** einen Tower an den Kraterrand stellen, ihn wählen. *Nach höchstens einer Sekunde zeigen
  die Sichtzellen: tief in der Mulde hinter der Kraterwand sieht er nichts.*
- **Z3 Lücke nach Einsturz:** ein Gebäude neben einem Tower einstürzen lassen. *Der Tower sieht durch die Lücke.*

## AA Straßen und Gleise in OSM-Städten (2026-10-21, E303)

Kreuzungen, Flecken, Unterführungen, Brückenrampen und Router prüfen `road-network.spec.ts`, `ground-decals.spec.ts`,
`roads.spec.ts`, `rails.spec.ts`, Router-Specs; hier das Auge. New game, „A map of a real place“, `49.7932, 9.9312`
(Würzburg), bauen.

- **AA1 Gehweg an Einmündungen:** über Straßen mit vielen Einfahrten fliegen. *Der Gehweg läuft gerade weiter, nur
  der einmündende Weg quert ihn als Rechteck; keine Zacken in die Fahrbahn.*
- **AA2 Flecken:** Plätze, Parkplätze, Straßen ansehen. *Keine braunen Erdflecken auf Pflaster und Asphalt; an
  Feldwegen draußen weiter Trampelränder.*
- **AA3 Bahnhof:** zum Hauptbahnhof. *Das Gleisfeld ist durchgehend, keine Gräben quer hindurch, keine schwebenden
  Steinblöcke.*
- **AA4 Kreuzung am Hang:** Straßen in Einschnitten oder an Böschungen. *Fußwege setzen glatt an, keine
  Dreiecksfetzen.*
- **AA5 Gleis an der Brücke:** Westkopf der Friedensbrücke, etwa `49.79820, 9.92140`. *Das Gleis läuft eben auf die
  Brücke, keine Felsklippe darunter.*
- **AA6 Durchgang:** Garage `49.798047, 9.926921`. *Im Durchgang Pflaster bis an die Wände, kein Gras.*
- **AA7 Gleise im Bahnhof:** Hauptbahnhof von oben. *Das ganze Gleisfeld trägt Gleise und Masten.* Dafür stehen in
  der Stadt weniger Mauern, Zäune und Hecken (Budget, E304).
- **AA8 Abgänge:** auf die Bahnsteige östlich der Unterführung, dann zur Fußgänger-Unterführung am Westrand des
  Gleisfelds (Nord- und Südende). *Grube mit Betontreppe, Geländer, Kopfwand mit dunkler Öffnung; die Bahnsteigdächer
  stehen.* Gegner laufen nicht hindurch.
- **AA9 Stützmauern am Gleisfeld:** Würzburg neu bauen. (1) Fußgänger-Unterführung westlich des Bahnhofs, (2)
  Straße beim Bürobau nordöstlich am Gleisfeld, (3) Parkplatz am Fluss bei der Brücke. *Betonmauer mit Kiesbett statt
  Felshang, keine schwebenden Platten, kein Durchblick an den Mauerenden; am Parkplatz keine Mauer (bleibt Fels).* Aus
  der Höhe: wirken die grauen Kiesflächen neben den Brückenwiderlagern zu flächig?

## AB Zeichendichte (2026-10-22, E304)

Pixelgrenze, Linien und Cube prüfen `line-spheres`, `line-bands`, `scene-cost`, Object-Layer- und Mapper-Specs; hier
das Auge. Würzburg neu bauen (`49.7932, 9.9312`), eigene Karten mit Version 4 laden nicht mehr (gewollt).

- **AB1 Ferne:** Kamera weit hoch über die Stadt. *Mauern, Zäune, Hecken und Gleise laufen als feine Bänder bis zum
  Rand, keine Lücken, kein Farbsprung beim Heranzoomen; Maschendraht fern durchscheinend.*
- **AB2 Grafikstufe:** Einstellungen Low ↔ Ultra. *Auf Low verschwinden fern mehr kleine Dinge, Linien bleiben.*
- **AB3 Sicht unabhängig von der Kamera:** Tower bauen, Sichtzellen merken, weit wegzoomen, Tower erneut wählen
  oder Reichweite upgraden. *Sichtzellen gleich wie mit naher Kamera.*
- **AB4 Linie im Editor:** mit dem Linien-Pinsel eine Mauer ziehen, Symmetrie x, Undo/Redo, „Karte spiegeln“; ein
  Mauerstück per Explosion zerstören und von fern ansehen. *Nichts bricht, Lücke im Band.*
- **AB5 Brücken:** Würzburg, die großen Mainbrücken nah und von weit oben, langsam heranzoomen. *Deck,
  Geländer und Stege wie vorher, kein Farbsprung beim Wechsel aufs LOD, keine Lücke zwischen den Stücken.* Tower am
  Ufer neben einer Brücke bauen, deren Straße darunter die Route nimmt. *Sichtzellen unter dem Deck verdeckt, auf
  dem Deck sichtbar.* Im Editor eine Brücke ziehen und anklicken. *Die Kante wird gewählt, das Deck folgt.*
- **AB6 Erster Fall in Sicht:** eigene Karte mit Zerstörung (OSM-Stadt), Tower bauen, ein Gebäude in seiner Sicht
  fällen. *Kein Ruckler beim ersten Fall.*
- **AB7 Übergang ins Spiel:** OSM-Karte laden. *Minikarte erscheint ohne Ruck, das Spiel startet ohne Hänger.*
- **AB9 Loch im Haus:** auf einer OSM-Karte ein Haus mit Rakete oder Kanone treffen, bis ein Loch aufgeht. *Durch das
  Loch Decken, eine Innenwand und ein Boden statt Rasen; das Dach bleibt.*
- **AB10 Schatten nach dem Bau:** Kanone über das Baumenü bauen, nach dem Bauende (5 s) den Tower ansehen. *Er wirft
  sofort den ganzen Schatten, nicht den des Gerüst-Stumpfs.* Danach ein Gebäude in seiner Sicht fällen. *Kein
  zusätzlicher Ruckler nach dem Fall-Bild.* OSM-Welt zweimal laden: *beim zweiten Laden kein Hänger beim Erscheinen,
  Töne gleich nach dem Laden da.*
- **AB8 Editor kalt:** nach einem Update den Editor mit Demo Valley öffnen. *Kein langes Standbild, bevor die Ansicht
  erscheint.*

## AC Wasser als Körper (2026-10-22, E301)

Wo Wände entstehen und wie sie liegen prüft `river-surface.spec.ts`; hier das Auge. Grafik High.

- **AC1 Bach am Kartenrand:** Mountain Pass, Editor, zum Südende des Bergbachs (unten links) fliegen und flach von
  der Seite ansehen. *Wo der Bach über dem Hang endet, ist das Wasser seitlich geschlossen, kein Blatt mit Luft
  darunter; keine helle Linie am Ufer.*
- **AC2 Kratersee:** wie U1 einen Krater in den Bergbach setzen und von der Seite in die Grube sehen, während der
  See steigt. *Das abgeschnittene Flussende zur Grube zeigt seine Wasserseite, sie verschwindet, so weit der See
  steigt.*
- **AC3 Dinge im Wasser:** Demo Valley, die Holzbrücke über den Fluss nah ansehen. *Die Pfeiler stehen sichtbar im
  Wasser, an der Wasserlinie ein leichter Schaumsaum, unter Wasser klarer als der tiefe Grund.*
- **AC5 Gezeichneter Fluss:** im Editor einen Fluss über flaches Land ziehen, beide Enden nah ansehen. *Das Wasser
  läuft im Bett flach aus, keine türkise Platte am Ende.* Die Oberfläche von oben und flach: *kleine unregelmäßige
  Wellen, die mit der Strömung treiben, keine gleichmäßigen Streifen oder Winkel in Kurven, kein Plastikglanz.*
- **AC6 Lava:** einen Krater graben und Lava hineingießen (Wasser › Gießen, Lava). *Kruste schwarzbraun und rau, an
  den Rissen dunkelrote Unterglut, Risse unterschiedlich hell, kein grauer Randstreifen.*
- **AC4 Seen:** Archipelago und Harbor Town an den Ufern entlang fliegen. *Keine türkisen Splitter an Felsen oder
  Kaimauern, die Strände wie vorher.*

## AD Erlenbach-Notizen (2026-10-23, E307)

OSM-Welt Erlenbach (74235) neu erzeugen und öffnen, Grafik High. Bilder je Punkt im Board.

- **AD1 Straßen:** Kreuzungen, Kreisel und die Brücke über den Bach ansehen. *Keine Straßendreiecke, die in den Hang
  tauchen; Kreisel rund; Bordstein und Gehweg laufen glatt um die Ecken, keine Treppe an der Brückenkreuzung.*
  Ladezeit wie vorher.
- **AD2 Flächen:** Schulhof und Kindergarten. *Asphalt oder Pflaster statt Wiese.* Ein Platz mit Brunnen:
  *Kopfsteinpflaster rund um den Brunnen.*
- **AD3 Häuser am Hang:** am Hang entlang fliegen. *Häuser stehen auf Eingangshöhe, bergseitig Keller oder Sockel,
  keine Mauerstücke im Hof; am Kartenrand ganze Häuser oder keine.*
- **AD4 Kirche und Fenster:** die Kirche ohne eigenen Turm in OSM. *Turm am Westende mit Steinhelm.* Weit
  rauszoomen: *Fenster bleiben als Fenster sichtbar, keine Jalousien in Hallenfenstern.*
- **AD5 Bäume und Ufer:** Bäume am Hang und Pflanzen am Bach. *Kein Stamm schwebt, keine Pflanze hängt in der Luft;
  kein Schilf an steilen Ufern.* Parkende Autos: *sechs Formen (Kleinwagen bis Van), gedämpfte Farben, auch schwarz und grün.*
- **AD6 Ruinen und Krater:** Häuser beschießen und Krater neben Bäume setzen. *Innen verbrannt, kein Himmelblau am
  Boden, Lochränder ausgefranst, kaum Flimmern beim Zoomen; Bäume am Krater fallen vom Loch weg, nahe stehende
  welken braun.*

## Eichtabelle

Fingerprints aus `__corridor.fingerprint()` für K2.1 und K2.2. Alle Werte vor 748 (Rothenburg `d8050177`, Tokyo
`efc7362a` usw.) gelten nicht mehr. Ein neuer Wert gilt, bis ein Commit den Korridor ändert; dann hier leeren.

| Ort | URL-Parameter | Fingerprint | `tileSet` | Datum |
|---|---|---|---|---|
| Tokyo | `l=35.65924,139.70049&s=35.65208,139.69853` | | | |
