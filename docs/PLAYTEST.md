# Playtest-Liste

Stand 2026-09-15. Das ist die eine, laufende Liste für die nächste Session: nur offene Punkte. Die alten Listen
(REVIEW_FIX_2026-09-14, REVIEW_SPRINT_2026-09-12 bis -14) verweisen hierher. Code-Stand: Branch `next` (umbenannt
aus `sprint/night-2026-09-14`) auf `8d9cdb6c`, mit den Fixes aus Playtest 3 (Nachtests 701 bis 716).

Antworten reicht so: "603 ok, 607a kaputt". In Klammern stehen die alten Nummern. Jede Runde hat einen gemeinsamen
Aufbau, jeder Punkt höchstens drei Fragen. Wo ein Punkt zu viel auf einmal wollte, ist er in a, b und c geteilt; die
Teile laufen mit demselben Aufbau direkt nacheinander.

## Vorab

- Konsole (F12) offen lassen. Jede Zeile mit `Shader Error` oder `Uncaught` melden. Konsolenfilter nur als einfacher
  Text ("Corridor", "Camera").
- **Quick Actions:** eine Reihe Symbolknöpfe unten rechts. Sie tragen keinen Text; den Namen zeigt ein Tooltip, wenn
  die Maus darüber steht. Von links nach rechts:
  - Weg mit zwei Punkten: "Play route animation".
  - Auge: "Display", das Display-Menü. Oben "Effects" mit den Knöpfen Low, Medium und High, darunter Haken, einer
    davon "Bloom". Weiter unten die Haken "Blood Moon", "Screen Shake" und "Boss Intro".
  - Lautsprecher: "Audio", oben der Regler für die Musik, darunter der für die Soundeffekte (SFX).
  - Drei gestapelte Ebenen: "Layers". Klappt eine Spalte weiterer Symbolknöpfe nach oben auf, Namen wieder im
    Tooltip. Gebraucht werden der oberste, "Route Grid Overlay" (vier Quadrate), dazu "Show streets" (Weg mit zwei
    Punkten) und "Show routes" (Balkendiagramm).
  - Zielscheibe: "Reset camera".
  - Ganz rechts ein "T": "Developer options".
- **Developer options** öffnet Kacheln mit Text. Unter "Cheats":
  - "Kill" tötet alle Gegner.
  - "Credits": Klick +1000, Shift+Klick +100 000.
  - "+HP": Klick +1000 HP. Rechtsklick -10 HP, Shift+Rechtsklick -50 HP. Das HQ startet mit 100 HP.
  - "Research" (alle Forschungen fertig), "Max Up" (alle Tower voll ausgebaut), "Abilities" (alle Fähigkeiten,
    Ladungen voll), "Hero" (Held angeheuert).
  - Unter "Waves & Inspect": "Waves" öffnet das Fenster "Wave Debug", "Enemies" das Fenster "Enemy Debug".
- **Wave Debug:**
  - "Jump to wave" ist die Überschrift eines Abschnitts. Die Welle ins Feld "Wave" tippen (voreingestellt 35), dann
    den Knopf darunter drücken; er heißt "Jump: next start Wave" mit der getippten Zahl. Das geht nur zwischen zwei
    Wellen und nur vorwärts. Danach startet Space genau diese Welle.
  - Custom Wave: Knopf "Single", im Abschnitt "Spawn" bei "Type" den Gegner wählen, bei "Count" die Anzahl, dann
    "Start Custom Wave". Eine Custom Wave zählt als nächste Welle.
- **Enemy Debug:** Unter "Placement" den Typ in der Liste wählen, rechts daneben den Knopf mit dem Stecknadel-Symbol
  drücken ("Place enemy on route"), dann auf die Route klicken. Der Gegner erscheint in der Liste "Debug Enemies".
  Ihn dort anklicken, dann darunter im Abschnitt "Movement" auf "Start": er läuft los.
- Der Wurm heißt jetzt "Skarnax".

## Korridor-Umbau (Test des Users am 16.09., Logs und Bilder in `tmp/corridor_tests/`)

Getestet an fünf Orten: Erlenbach, Rothenburg, Berlin, Paris, Tokyo. Je Ort laden, Ladescreen beobachten, danach
zoomen und mit G springen.

- **738 Stabilität: ok.** In keinem der fünf Logs kommt nach `loading.done` noch ein `[Corridor] build` oder
  `rebuild`. Der Korridor ändert sich nach dem Ladescreen nicht mehr.
- **739 Determinismus: ok.** Tokyo dreimal geladen (mit Intro, Intro abgebrochen plus Zoomen, andere Fenstergröße):
  jedes Mal Fingerprint `e51f7114`, auch jeder Teil gleich.
- **740 Messung: ok.** Alle Stationen gemessen (`unmeasured=0`), alle auf der 2,5-m-Stufe.
- **741 Ladezeit: ok** ("sehr gut" laut User). Bau gesamt, davon Tiles: Erlenbach 4,6 s (3,1), Rothenburg 5,2 (2,7),
  Berlin 6,5 (4,0), Paris 4,7 (2,6), Tokyo 11,7 (9,4). Ladescreen fertig nach 10,3 bis 17,6 s.
- **742 Bilder: ok.** Berlin Straße und Platz sauber, Paris auf Deckhöhe mit sauberem Übergang am Brückenkopf, keine
  Zellen auf den Transportern, Tokyo ohne Ausreißer.
- **743 Turm in Rothenburg: Befund.** Am Turm mit Durchgang steigt der Korridor über den Turm, statt unten
  durchzugehen. Die Zellen sind gelb, also als Durchgang erkannt, nehmen aber die falsche Höhe; dazu
  `cellsWithoutHeight=7` (sonst überall 0). Worker corrpassage.
- **744 Rückfall kostet eine Sekunde umsonst.** Rothenburg 1036 ms ohne Fund, Berlin 1070 ms für eine Station,
  Paris 1087 ms für vier. Mit corrpassage.

## Nachtests 3 (Fixes der Session 4, 15.09.)

### Runde 18: Erlenbach (717 bis 720)

Aufbau: Erlenbach per URL laden (F5 auf der Orts-URL), Konsole offen, Layers "Route Grid Overlay" und "Show streets"
an.

- **717** (649, hqsound): Nach dem Intro Rechtsklick auf "+HP" (-10 HP). Ist an der HQ der Explosionston zu hören?
  Dann eine Welle ohne Tower, einen Zombie ins HQ laufen lassen: Ton auch beim Leck?
  **717, 718 und 720 ok (2026-09-15).** 719: Böschung ok, neben den Autos weiter Löcher in der Straße, die Autos
  selbst tragen noch Zellen (Zellbericht Erlenbacher Weg, Way 959083801: fehlende Zellen mit Boden auf Straßenhöhe
  und begehbaren Nachbarn, Breite je Station springt zwischen 2 und 7 m). Daten an Worker detour.
- **718** (D2, underpass): Kamera schräg auf die A6-Brücke über der Weinsberger Straße. Verschwindet die rote Linie
  unter dem Deck und kommt dahinter wieder heraus, unter dem Deck gelbe Zellen auf Straßenhöhe? Custom Wave, Count 5:
  laufen die Gegner unter dem Deck durch, keiner oben auf der Autobahn?
- **719** (706 bis 708, carcells): Weinstraße, Erlenweg, Schulstraße. Liegen neben den Reihen parkender Autos wieder
  Straßenzellen? Böschung talseitig weiter frei? (Zellen auf Autos direkt auf der OSM-Linie bleiben, bis das
  Ausweichen aus E6 kommt, Worker detour.)
- **720** (cellreport): Developer options, "Waves & Inspect", Kachel "Cells". Erscheint oben mittig das Panel "CELL
  REPORT"? Linksklick auf eine Zelle rahmt sie orange, ein zweiter nimmt den Rahmen weg; Shift + Linksziehen zieht
  ein Rechteck, ohne die Kamera zu drehen? Notiz tippen, "Copy JSON", das JSON in den Chat einfügen: kommt es an?

### Runde 19: Tower schießen wieder (721 bis 724)

Aufbau: beliebiger Ort, Konsole offen mit Filter "Corridor", Cheat "Credits".

- **721** (643, towercount): Mehrere Archer und Dual-Gatling an eine Stelle nahe der Route, Custom Wave "Zombie",
  Count 30: drehen und feuern die Turrets? Zwischen den Wellen die Kamera weit weg und zurück, Cheat "Hero", G, den
  Held per Klick woanders hinschicken, wieder G, zwei- bis dreimal: kommt keine Zeile `[Corridor] rebuild`, solange
  ein Tower steht? Nächste Welle: drehen und feuern die Turrets?
  **Ergebnis (2026-09-15):** Turrets drehen und feuern in Welle 2. In der Konsole kamen zwei `[Corridor] rebuild`
  (cells 2159, dann 2142 nach einem Lauf `clearance: segments=2 stations=2 ... changed=true`); ob vor oder nach dem
  ersten Tower, ist offen. Prüfung towercount. **722 bis 724 ok (2026-09-15).**
- **722** (towercount): `__corridor.set({ maxHalfWidth: 5 })` in die Konsole. Steht dort "Not changed: towers stand on
  the map, sell them first."?
- **723** (towercount): Esc, damit kein Tower gewählt ist, dann zwei, drei Archer bauen und in der NEXT-Zeitleiste die
  Anzahl für W1 bis W3 per Hover merken. Cheat "Max Up": steigt die Anzahl sofort? (Zeigt NEXT schon die volle
  Spanne, bleibt sie gleich.)
- **724** (towercount): Header "Change location", ins leere Adressfeld `a` tippen: steht dort "2 more characters", bei
  `ab` "1 more characters"? Wieder leeren: "Enter address..."?

### Runde 20: Orte und Tipps (725 bis 728)

- **725** (D1, showcase): Standort-Dialog, Tab "Showcase", "Tokyo, Shibuya Crossing". Wird kein Spawn gewürfelt,
  steht das Portal an deiner Stelle, und in der Adresszeile `l=35.65924,139.70049&s=35.65208,139.69853`? Läuft die
  Route ohne Schlaufe? **725 und 726 ok (2026-09-15).**
- **726** (underpass, Gegenprobe): Paris, Pont d'Iéna, "Route Grid Overlay" an. Deck und Brückenköpfe blau wie in
  701, keine gelben Zellen auf der Brücke? Rote Linie und Gegner auf dem Deck?
- **727** (706, carcells): Rothenburg, Favorit "rothenburg rotes auto". Neben den parkenden Autos wieder
  Straßenzellen wie in 607?
  **Ergebnis (2026-09-15, Screenshot):** Die Reihe quer parkender Autos auf der einen Seite bleibt frei, der Korridor
  endet davor. Das rote Auto auf der anderen Seite, etwa 4 m neben der roten Linie (kein Mittellinienfall), trägt
  weiter Zellen. Zellbericht angefragt.
- **728**: vom User nicht mehr getestet ("sollte passen"); Tipp nach Welle 3 und der Hinweis nach gestarteter Welle
  sind per Spec belegt (showcase, firstrun).
- **728** (E1, 649 berichtigt): In den DevTools unter Application, Local Storage `td_onboarding_v2` und
  `td_best_waves_v1` löschen, F5 an einem Ort. Einen Archer bauen, Wellen 1 bis 3 spielen: kommt der Tipp "Build a
  research center" erst nach Welle 3, nicht nach 2? Welle 4 starten, Rechtsklick auf "+HP" bis Game Over: erscheint
  unter RESTART "First run here"?

### Runde 21: Schadenszahlen und hohles Auto (729 bis 731)

- **729** (abilitydmg): Cheat "Abilities", Welle mit vielen Gegnern. K auf eine Gruppe: erscheint 1,5 s später über
  jedem getroffenen Gegner eine rote Zahl, bei getöteten dazu ein goldenes "+N", und steigen die Credits? Zu voll bei
  einer großen Gruppe?
- **730** (abilitydmg): L vor die Spitze einer Kolonne. Erscheint über jedem Gegner, den der Strahl hinter sich lässt,
  eine Zahl (Zombies gold und groß, Tanks rot, Golem grau und klein), eine je Gegner, kein Zahlenregen? F und E: keine
  Zahlen?
- **731** (727, carcells): Rothenburg, Favorit "rothenburg rotes auto"
  (`http://localhost:4200/?l=49.37721,10.17904&s=49.37944,10.18365`), keine Tower, "Route Grid Overlay" an, warten,
  bis kein neues `[Corridor] rebuild` kommt. Liegt auf dem roten Auto keine Zelle mehr, endet der Korridor davor?
  **729 bis 731 ok (2026-09-15)**, rotes Auto frei, "sieht nun ganz gut aus" (Screenshot).

### Runde 22: Umweg, Sounds, Modelle, Sockel (732 bis 737)

Aufbau für 733 und 734: Cheat "Abilities", Custom Wave "Zombie", Count 20. Fähigkeiten nur während einer Welle, nach
jedem Einsatz "Abilities" erneut. Ton an, möglichst Kopfhörer.

- **732** (719, detour): Erlenbach, Erlenbacher Weg (`http://localhost:4200/?l=49.17337,9.26851&s=49.17434,9.25915`),
  "Route Grid Overlay" an, warten, bis kein neues `[Corridor] rebuild` kommt. Biegt die rote Linie vor der Autoreihe
  zur Fahrbahnseite aus? Liegen auf den Autos keine Zellen, und ist das Band daneben ohne Löcher?
  **Ergebnis (2026-09-15): nicht gut.** Zellen auf den Autos und Löcher links der Straße wie vorher (Zellbericht,
  Screenshot). Der Umweg hat nicht gegriffen: `detourM` null an allen Stationen, Autozellen `centre line`. Kandidaten:
  die Bedingung "Straße beiderseits des Hindernisses" (die Autos stehen am Rand vor dem Grünstreifen) und ein
  Ausreißer im Säulen-Cache bei (413,21), 782,65 m auf Tiefe 10. **Ursache (detour, nachgestellt mit der echten
  OSM-Linie):** Der Planer findet die Autos, legt aber zwei Ausweichstücke auf derselben Seite 1 m auseinander (3,5
  und 2,5 m Versatz); der Übergang braucht 2 m, das zweite fällt weg, die Rampe des ersten läuft dann durch dessen
  Autos, das erste fällt auch: leerer Plan. Beide Kandidaten oben ausgeschlossen. Vorschlag in
  `tmp/fix1/reports/detour.md` (Nachtrag 2). **User:** klingt sinnvoll, gewünscht ist aber eine allgemeine Lösung;
  mit der Umsetzung warten, Details zum Korridor folgen. **733 ok. 734:** ok, aber der Skarnax-Ton loopt zu
  gleichmäßig, lieber zufällig und seltener (sounds). **735:** Tank gut, Textur könnte moderner sein (models); Ghost
  und Mech passen.
- **733** (E18, sounds): K auf die Route: heult 1,5 s eine Sirene am Ziel und endet mit dem Knall? F auf eine Gruppe:
  eisiger Knall mit Knistern? E: elektrischer Schlag mit Knistern? Wirkt eine davon zu laut oder zu leise?
- **734** (E18, sounds): L vor eine Gruppe, der Strahlweg quer im Bild: Zap und Knall am Aufsetzpunkt, wandert das
  Brennen mit dem Fuß des Strahls und blendet am Ende aus, kein doppeltes Brennen? Custom Wave "Skarnax": Knurren und
  Klackern am Kopf, das mit ihm wandert?
- **735** (E18, models): "Enemies", nacheinander Tank, Ghost und Mech setzen und starten. Tank: grüner Panzer, Ketten
  laufen mit dem Boden, steht auf der Straße, Vorschau in der Sidebar ganz im Bild? Ghost und Mech wie vorher?
- **736** (E18, plinthbrace): Hochhaus mit unebenem Dachrand, Archer so an die Kante, dass der Geist über die Kante
  ragt: zeigt die Vorschau Schrägstützen, und stehen nach dem Bau Steinstützen schräg in der Fassade? Flachdach mitten
  drauf: keine Stützen? Verkaufen: Stützen weg?
  **Ergebnis 736 (2026-09-15, Screenshots):** Stützen machen, was sie sollen, sind optisch aber noch nicht überzeugend
  (dünne Spitzen unter dem Sockel). Dass der Sockel oben den Tower-Fuß manchmal nicht ganz deckt, gab es schon vorher,
  auch ohne Stützen; nicht mehr aufsatteln als nötig.
- **737** (E19, docsai): Developer options, Fenster "AI": fehlt der Knopf "Load ONNX model" (das eingecheckte Modell
  passt nicht)? **ok (2026-09-15)**; so etwas prüft der Lead künftig per Spec, nicht der User.

## Nachtests 2 (Fixes aus Playtest 3, 15.09.)

### Runde 14: Paris, Place de Varsovie (701 bis 704)

Aufbau wie Runde 1: Paris, Pont d'Iéna (Favorit), Spawn auf der Trocadéro-Seite, damit die Route über die Brücke
läuft. Keine Tower, Layers "Route Grid Overlay" an. Warten, bis einige Sekunden lang keine neue Zeile
`[Corridor] rebuild` mehr kommt. Liegt irgendwo eine weiße Zelle unter der Oberfläche: `__corridor.pick()`,
Linksklick darauf, die Tabelle schicken, dazu `__routes.describe()`.

- **701** (601): Zum Brückenkopf an der Place de Varsovie (Trocadéro-Seite) zoomen. Läuft die blaue Umrandung vom
  Brückenende über das kurze Stück, um die Ecke die Avenue de New York entlang und an der Kreuzung ein Stück
  Richtung Trocadéro, etwa 60 m? Keine weißen Zellen mehr unter der Oberfläche?
  **ok (2026-09-15)**, blau durchgehend um die Ecke (Screenshot).
- **702** (602): Space, die Welle über die Brücke laufen lassen. Bleiben rote Linie und Gegner an der Place de
  Varsovie durchgehend sichtbar, nicht im Boden? Eiffelturm-Seite weiter gut? **ok (2026-09-15)**
- **703** (603): Layers "Show streets" an. Liegt die gelbe Linie an der Place de Varsovie auf der Straße? Am Quai
  mit den Platanen weiter auf der Straße, nicht in den Kronen, und die Uferstraße unten bleibt unten?
  **ok (2026-09-15)**
- **704**: An der Place de Varsovie: ist der Korridor so breit wie die Straße, nicht auf einen schmalen Streifen
  eingeengt? Liegen parkende Autos dort außerhalb? **ok (2026-09-15)**, volle Breite am Brückenkopf (Screenshot
  aus 701).

### Runde 15: Korridor am Hang und im Torbogen (705 bis 708)

Aufbau wie Runde 2: keine Tower, keine Welle, "Route Grid Overlay" an, warten, bis keine neue Zeile
`[Corridor] rebuild` mehr kommt. Bleibt eine Zelle, wo keine hingehört: `__corridor.pick()`, Linksklick darauf,
die Tabelle schicken.

- **705** (605): Rothenburg, die Stelle deines Hang-Screenshots. Endet der Korridor talseitig an der Straßenkante
  oder eine Reihe dahinter, ohne Zellreihen die Böschung hinunter? Bergseitig wie vorher?
  **ok (2026-09-15)**: nicht perfekt, bleibt so.
- **706** (607): Favorit "rothenburg rotes auto". Sind die Zellen auf dem roten Auto weg? Auf den ebenen Straßen
  sonst alles wie in 607 (Autoreihen außen, Gehwegreihe frei)?
  **Ergebnis (2026-09-15): gefühlt schlechter geworden.** Parkende Autos haben mehr Zellen als in 607 (auch 707,
  708). Befund an einen Worker.
- **707** (607): Der Torbogen mit dem schmalen Durchgang. Liegen die gelben Zellen dort auf Straßenhöhe, ohne
  Anstieg im Durchgang? Space: kommen die Gegner auf Straßenhöhe aus dem Durchgang, nicht aus der Wand? (Kommen sie
  auf Straßenhöhe neben der Öffnung aus der Wand: Screenshot von oben mit der roten Linie; dann liegt der OSM-Weg
  neben der Öffnung.)
  **Ergebnis (2026-09-15):** Einstieg in den Torbogen etwas besser, Ausstieg deutlich besser. Parkende Autos dort
  schlechter (siehe 706).
- **708** (608): Erlenbach, Weinstraße und Erlenweg, die Böschung auf der Talseite. Keine Zellreihen mehr die
  Böschung hinunter? Bäume und Hecken weiter frei?
  **Ergebnis (2026-09-15):** Böschung besser. Parkende Autos dort schlechter oder weiter so schlecht wie vorher (siehe
  706). Picks Schulstraße (Way 959083801), drei Autos: die höchste Zelle je Auto ist `walkCheck: 'centre line'`,
  0,59 bis 1,08 m über der Linie, bis 1,23 m über den Nachbarn; die OSM-Linie läuft an den Autos entlang, die rote
  Linie nimmt die Dachhöhe. Auch die flacheren Nachbarzellen auf den Autos stören. Worker carcells.

### Runde 16: Ooze (709 bis 712)

Aufbau wie Runde 5: Display-Menü "Boss Intro" an, Effects "High", Cheats "Credits" und "Abilities", Konsole offen.
"Waves", "Single", Type "Ooze", Count 1, "Start Custom Wave".

- **709** (619a): Im Intro: ragt ein deutliches Stück Band aus dem Tor, runde Spitze plus ein gerades Stück von etwa
  6 m, nicht nur ein Buckel? (Der Schnitt aufs Portal kommt dafür etwa 1 s später als bisher.)
  **709 bis 712 ok (2026-09-15)**
- **710** (617a): Die Ooze mindestens 27 s wachsen lassen, dann töten (Tower oder K, fünf Schläge). Liegen entlang
  des ganzen Körpers viele grüne Pfützen, verschieden groß und glänzend? Bleiben sie etwa 45 s und verblassen dann
  über etwa 30 s?
- **711** (617b): Beim selben Tod: fliegen deutlich mehr Trümmer als bisher (Brustkörbe, Reifen, Leitkegel,
  Ölfässer, Stoppschilder, Helme, Dosen, Schädel), einige etwa 13 m hoch? Sind nach etwa 14 s alle weg? Genug
  übertrieben?
- **712** (618): Neue Custom Wave mit Ooze, im Intro Esc. Die Ooze nicht töten, mindestens 30 s laufen und ins HQ
  fließen lassen (vorher einmal "+HP"). Fehlt in der Konsole die Zeile `[WaveManager] STUCK`?

### Runde 17: Frost, Laser, Gegnermodelle (713 bis 716)

Aufbau wie Runde 6: neues Spiel, Cheat "Abilities", einmal "+HP". "Waves", bei "Jump to wave" 7 eintragen, "Jump:
next start Wave 7", dann Space. Fähigkeiten gehen nur, solange eine Welle läuft.

- **713** (625): Developer options: steht "Abilities" in einer breiten Kachel über zwei Spalten, mit Luft? F aus der
  Übersicht auf eine Gruppe: heben sich die eingefrorenen Gegner weiß-cyan klar vom bläulichen Reif ab, ohne
  weißen Nebel über der ganzen Stelle? Liegen auf Dächern und Fassaden am Rand keine hellen Kleckse?
  **713 bis 716 ok (2026-09-15)**, auch die Wallsmasher-Vorschau aus 635.
- **714** (636): L, Klick vor eine Gruppe. Kommt eine breite Säule mit weißem Kern und orange-roter Korona, mit
  Blitz, Bodenglühen, Funken, Brocken und Rauch? Liegt dahinter eine breite schwarze Brandspur, deren glühende Risse
  in etwa 6 s abkühlen? Mit Ton (Zap, Knall, Dröhnen) und kurzem Shake: bildgewaltig genug?
- **715** (635): "Waves", "Single", "Zombie v2", Count 10, "Start Custom Wave", dann Cheat "Kill". Liegt jeder am
  Boden, bevor er verschwindet (etwa 3 s nach dem Tod)? Dasselbe mit "Zombie Soldier" und "Stone Golem". Danach
  Custom Wave "Wallsmasher": ist seine Vorschau im WAVE-Panel farbig?
- **716** (633a): "Enemies": Zombie v2, Zombie Soldier und Stone Golem setzen, dann `__perf.loseContext(2000)` in die
  Konsole. Nach "Baked N VATs again" die Kamera drehen, weit hinein- und herauszoomen, in "Debug Enemies" einen
  Gegner mit dem Kreuz entfernen und neu setzen. Fehlt die Zeile `WebGL: INVALID_OPERATION: delete`? Ist der Himmel
  nach dem Restore da?

## Nachtests (Fixes vom 14.09. abends und nachts)

### Runde 1: Paris, Pont d'Iéna (601 bis 604)

Aufbau: Paris am Pont d'Iéna laden, am einfachsten über den Favoriten aus Playtest 2. Ohne Favorit: Standort-Dialog
("Change Location"), "New Location", im Feld "City, street or address..." nach "Pont d'Iéna, Paris" suchen und den
Treffer wählen. Führt die rote Route danach nicht über die Brücke, mit dem Header-Knopf "Set spawn" (Fahnen-Symbol)
den Spawn ans andere Seine-Ufer setzen. Keine Tower, Layers "Route Grid Overlay" an. Farben der Zellumrandung: blau
heißt Brückendeck samt dem Stück Straße, das es hinter dem Brückenende fortsetzt; weiß heißt normale Bodenzelle.

- **601** (564, alte 14): Nacheinander zu beiden Brückenenden zoomen. Läuft die blaue Umrandung hinter dem
  Brückenende über die kurzen Straßenstücke weiter, auf Höhe der Brücke? Liegen unten am Ufer unter dem
  Brückenanfang keine weißen Zellen? Hat der Korridor an den Brückenenden keine Lücken, und ist er dort so breit wie
  auf der Brücke?
  **Ergebnis (2026-09-15): deutlich besser, rechte Seite gut.** Links (Ufer mit der Kreuzung direkt hinter dem
  Brückenende) eine Unterbrechung: kurz hinter dem Brückenkopf liegen weiße Zellen, rote Linie und animierte Route
  stückweise unter der Oberfläche (Screenshots). Fix folgt (bridge4), erneut prüfen.
- **602** (564): Space, die Welle über die Brücke laufen lassen. Bleiben rote Linie und Gegner an beiden
  Brückenenden durchgehend sichtbar, oben auf der Brücke und nicht unten am Ufer?
  **Ergebnis (2026-09-15):** rechte Seite perfekt; links verschwinden die Gegner an derselben Stelle wie in 601 im
  Boden. Fix bridge4.
- **603** (564): Layers "Show streets" an, die Straßen erscheinen als gelbe Linien. Liegt die gelbe Linie auf der
  Brücke und auf den kurzen Stücken dahinter oben auf Brückenhöhe? Bleibt die Uferstraße unter dem Brückenende
  unten? An der Quai Branly (Uferstraße mit Platanen): liegen Zellen und gelbe Linie auf der Straße, nicht in den
  Baumkronen?
  **ok (2026-09-15)** bis auf die Stelle aus 601.
- **604** (544): Beim Laden die Tipps unter "Field Tip" im Ladescreen lesen. Sind einzelne Wörter farbig
  hervorgehoben? Fehlt in der Konsole die Zeile "WARNING: sanitizing HTML stripped some content"?
  **ok (2026-09-15)**

### Runde 2: Korridor in Rothenburg und Erlenbach (605 bis 608)

Aufbau: keine Tower, keine Welle, "Route Grid Overlay" an. Nach dem Laden misst der Korridor mehrmals nach, jedes Mal
mit einer Konsolenzeile `[Corridor] rebuild`. Warten, bis einige Sekunden lang keine neue solche Zeile mehr kommt.
Steht dann irgendwo noch eine weiße Zelle, wo keine hingehört: `__corridor.pick()` in die Konsole, Linksklick auf die
Zelle, die Tabelle schicken.

- **605** (560 bis 563, alte 44): Rothenburg, die Stellen deiner Screenshots vom 14.09. (Auto, Dachecke, Erker).
  Keine weißen Zellen mehr dort? Kamera 10 s nicht bewegen: liegt auch danach keine Zelle auf Dach, Dachrand oder
  Auto? An einer Straße quer am Hang: bleiben die Zellen am Rand?
  **Ergebnis (2026-09-15): gut** (Häuser, Autos, Hang bergseitig). **Befund:** talseitig am Hang noch zu viele Zellen
  den Abhang hinunter (Screenshot). Fix corridor5 (Abfall-Check), erneut prüfen.
- **606a** (Vorgärten): Rothenburg, Wohnstraße mit einem erhöhten Vorgarten hinter Hecke oder Mäuerchen. Endet der
  Korridor davor? (Ein Vorgarten auf Gehweghöhe hinter einem Zaun bleibt drin, das ist bekannt.)
- **606b** (Vorgärten): Laterne, Schild oder Straßenbaum am Straßenrand. Läuft der Korridor gerade daran vorbei, ohne
  Kerbe?
- **606c** (Vorgärten): Enge Gasse mit einem geparkten Auto. Bleibt neben dem Auto mindestens eine Reihe Zellen?
  **606a bis 606c ok (2026-09-15)**
- **607a** (562, alte 41): Straße mit parkenden Autos und dem Transporter. Endet der Korridor vor der Autoreihe?
  Liegen keine Zellen auf dem Gehweg dahinter? Buchtet er nicht in die Lücke zwischen zwei Autos aus?
- **607b** (562): Space, die Welle durch diese Straße laufen lassen. Läuft kein Gegner durch ein Auto?
- **607c**: Solange die Welle läuft, eine Straße der Route suchen, die diagonal verläuft, also laut Kompass etwa nach
  Nordost oder Nordwest (um 45°). Kamera von oben nah an einen Gegner: zeigt sein Körper entlang der Straße in
  Laufrichtung? (Vorher war er auf solchen Straßen um gut 10° verdreht, auf Nord-Süd- und Ost-West-Straßen nicht.)
  **Ergebnis 607 (2026-09-15): im Großen ok**, "bombe im Vergleich zu vorher", Gehwegreihe bleibt frei. **Befunde:**
  einzelne Autos haben noch Zellen (rotes Auto, Favorit "rothenburg rotes auto"); am schmalen Durchgang eines
  Torbogens sind die Zellen gelb, steigen an, und die Gegner kommen auf der anderen Seite aus der Wand. Fix corridor5,
  erneut prüfen.
- **608** (205 bis 209): Erlenbach, Weinstraße und Erlenweg, die Stellen deiner Screenshots. Keine einzelnen weißen
  Zellen mehr in Baumkronen oder auf Hecken? Endet der Korridor davor? Gleich danach D2 (selber Ort).
  **Ergebnis (2026-09-15): ok** für Bäume und Hecken. **Befund:** auf der Talseite einer Straße noch zu viele Zellen
  eine Böschung hinunter (wie 605). Fix corridor5.

### Runde 3: Boss-Intro und Skarnax-Karte (609 bis 612)

Aufbau: Display-Menü "Boss Intro" an. Den Spawn mit dem Header-Knopf "Set spawn" (Fahnen-Symbol) setzen. Einen Boss
rufen: "Waves", "Single", Type wählen, Count 1, "Start Custom Wave". Jeder Boss-Typ bekommt je Welle ein Intro; für
ein weiteres Intro also eine neue Custom Wave starten. Bei einem schlechten Bild: Screenshot und die Konsolenzeile
`[Camera] bossIntro.shot` schicken.

- **609** (366): Spawn in eine schmale Straße zwischen Häusern, möglichst kurz vor einer Kurve, Type "Herbert". Steht
  Herbert nach dem Schnitt ganz sichtbar vor der Portalöffnung, ohne Haus davor? Steht die Kamera frei, nicht in einem
  Haus? **ok (2026-09-15)**
- **610** (366): Spawn neben Bäume oder Büsche, wieder Herbert. Keine Krone und keine Büsche vor Herbert in der
  unteren Bildhälfte? Steckt die Kamera nicht selbst in einer Krone? **ok (2026-09-15)**
- **611** (352, 368): Spawn wie in 609, Type "Skarnax". Ist der Kopf frei vor dem Tor? Zeigt die Intro-Karte groß
  "SKARNAX" und darunter klein "THE THOUSAND-LEGGED CALAMITY", gut lesbar? Steht danach oben mittig die Boss-Leiste
  "SKARNAX"? **ok (2026-09-15)**
- **612a** (366): Spawn an eine offene, breite Straße, Type "Herbert". Zeigt das Intro wie bisher das ganze Portal,
  mit der Krone oben am Portal knapp unter dem oberen Bildrand? Steht in der Zeile `[Camera] bossIntro.shot` bei
  `shot` der Wert `route` und bei `clear` der Wert `true`? (Nur dann ist es die bisherige Einstellung; sonst die
  Zeile schicken.) Ruckelt es beim Abdunkeln merklich? **ok (2026-09-15)**
- **612b** (366): Neue Custom Wave mit Herbert. Sobald das Bild zum ersten Mal dunkel wird, Esc drücken. Ist sofort die
  eigene Ansicht zurück, ohne Hänger? **ok (2026-09-15)**

### Runde 4: Skarnax an Ecken (613 bis 616)

Aufbau: Ort mit rechtwinkligem Knick auf der Route, Cheat "Credits". "Waves", "Single", Type "Skarnax", Count 1,
"Start Custom Wave", Kamera über den Knick.

- **613** (356): Tempo 1x. Laufen die Ringe im Bogen durch die Ecke, ohne spitzes V und ohne Lücke außen? Bleibt der
  Wurm auf der Straße (er schneidet die Ecke leicht nach innen)? Schwingen die Ringe nach der Ecke nicht nach?
  **ok (2026-09-15)** für die Ecke. Textur und fehlende Beinanimation bleiben ein Thema (Asset-Punkte, E18).
- **614** (356, 353): Tempo 4x: dieselbe Form wie bei 1x? Dann einen Tower direkt an die Ecke setzen. Welchen Ring er
  zerstört, lässt sich nicht steuern. Zerfällt der Wurm, während Ringe im Bogen liegen: wird der Ring hinter der
  Lücke zum neuen Kopf, und laufen beide Teile ohne Sprung weiter? Klappt es nicht, mit dem nächsten Skarnax.
  **ok (2026-09-15)**
- **615** (356): Schmale Wohnstraße mit Knick, falls auf der Route: höchstens ein schmaler Spalt außen? Sticht der
  Körper an der Innenecke in Fassaden? Auf einer diagonal verlaufenden Straße (laut Kompass etwa Nordost oder
  Nordwest): liegen die Ringe in einer Flucht? **ok (2026-09-15)**
- **616** (398): Cheat "Abilities", dann F, E und L jeweils auf Ringe. Passen Eis (F), Funken (E) und bei L
  Lichtsäule, Funken und Brandspur am Boden zu den Ringen (bekannt: eher klein)? Skarnax ist ein Boss: das Eis hält
  nur 1 s, der EMP 0,75 s, also genau hinsehen. **ok (2026-09-15)**

### Runde 5: Ooze (617 bis 621)

Aufbau: Display-Menü "Boss Intro" an, bei Effects "Medium" oder "High" (auf "Low" gibt es keine Blasen, keine
Spritzer, keine Pfützen und nur ein Drittel der Trümmer). Cheats "Credits" und "Abilities". "Waves", "Single", Type
"Ooze", Count 1, "Start Custom Wave". Für 617 und 618 die Ooze mindestens 27 s wachsen lassen.

- **617a** (363): Die Ooze töten, mit Towern oder mit K. K nimmt einem Boss 20 % seiner HP; allein mit K sind es also
  fünf Schläge, vor jedem die Kachel "Abilities". Sackt das Band in etwa 2 s zusammen? Platzen dabei grüne Blasen,
  und bleiben grüne Pfützen liegen? Klingt der Splat etwa 2 s nach?
  **Ergebnis (2026-09-15):** funktioniert, Wunsch: wesentlich mehr Pfützen, die länger liegen bleiben. Umsetzung
  oozedeath2.
- **617b** (363): Beim selben Tod auf die Trümmer achten. Fliegen Knochen, Schädel, Helme, Stoppschilder und Dosen aus
  dem ganzen Körper, liegen ein paar Sekunden und sinken dann ein? Laufen sie auch dann zu Ende, wenn die Welle
  währenddessen endet (letzter Klumpen tot)? Genug übertrieben, oder noch mehr?
  **Ergebnis (2026-09-15):** noch mehr übertreiben. Umsetzung oozedeath2.
- **618** (363): Vorher `__towerTargets.watch()` in die Konsole. Fire, Poison und Ice Tower an den Körper stellen und
  die Ooze töten lassen. Nimmt jeder binnen etwa 3 s einen Klumpen ins Ziel? Schießt ein danach neu gesetzter Tower
  ebenso? Steht einer still: D4.
  **ok (2026-09-15)**, Sonde: Fire, Poison und Ice haben je einen Klumpen im Ziel. Nebenbefund: nach dem übersprungenen
  Intro `[WaveManager] STUCK wave 4 (all spawned, counters frozen)`; Prüfung introfix.
- **619a** (360, 366): Nächste Ooze (neue Custom Wave). Ist die Spitze im Intro frei vor dem Tor?
- **619b** (360): Solange sie lebt, nacheinander je einen Tower an das Band stellen und den vorigen verkaufen, denn das
  Band zeigt nur eine Tönung zugleich (ein Slow verdeckt das Gift). Ice: wird es bläulich? Poison: dunkler? Fire:
  glüht es orange? Jeweils gut zu erkennen?
  **Ergebnis 619 (2026-09-15):** Tönungen gut. Wunsch: im Boss-Intro soll die Spitze weiter aus dem Tor ragen.
  Umsetzung introfix.
- **620** (399): Nächste Ooze. F auf den Körper: wird er weiß-cyan, und steht die Spitze still? Bei einem Boss hält
  das nur 1 s. E: wird er violett (0,75 s)? L über den Körper: passen Lichtsäule, Funken und Brandspur am Boden zum
  Band? (L setzt keinen Brand; das orange Glühen am Band kommt nur vom Fire Tower.) **ok (2026-09-15)**
- **621** (363): Eine Ooze töten, gleich danach zweimal Shift+Rechtsklick auf "+HP" (je -50 HP; hat das HQ mehr als
  100, entsprechend öfter): Game Over. Laufen Band und Trümmer dabei zu Ende, ohne schlagartig zu verschwinden? Dann
  RESTART (oder einen anderen Ort laden): sind Band und Trümmer sofort weg, keine schwebenden Knochen?
  **ok (2026-09-15)**

### Runde 6: Atompilz und Frost (622 bis 625)

Aufbau: neues Spiel, Cheat "Abilities" (füllt die Ladungen beliebig oft nach), zur Sicherheit einmal "+HP" (Klick,
+1000 HP). "Waves", bei "Jump to wave" 7 eintragen, "Jump: next start Wave 7", dann Space. Fähigkeiten gehen nur,
solange eine Welle läuft; ist Welle 7 vorbei, die nächste mit Space starten. Ton an, möglichst Kopfhörer.

- **622** (216, 217): "Reset camera" (Zielscheibe), K, Klick auf die Route. Liest sich der Schlag sofort als Atompilz
  (Blitz, Feuerball, Druckwelle, Pilz), passend groß zur Karte? Bis etwa 22 s zusehen: rollt die Kappe, ist der Stamm
  schmaler als die Kappe? Genug Wumms im Bild? **ok (2026-09-15)**, mit der Option, später noch einmal daran zu gehen.
- **623** (218): Nächster Schlag, auf den Ton achten: scharfer Knall, tiefer Boom, dann etwa 8 s Grollen in drei
  Wellen. Klingt das wuchtig genug? Dann im Audio-Menü den unteren Regler (SFX) weit herunter und noch ein Schlag: ist
  er leiser? (Der Regler wirkt auf Klänge, die danach starten; ein schon laufender Knall bleibt laut.)
  **ok (2026-09-15)**
- **624a** (220): Display-Menü, Effects, Haken "Bloom" an. Kamera tief an die Stelle, wo der nächste Schlag landen
  soll (unter 100 m über dem Boden), Schlag, dann mit der Kamera in die Wolke hineinfahren. Die Wolke besteht aus
  vielen Rauchballen: wird einer am Bildrand abgeschnitten, oder springt einer beim Fahren? Zeichnet sich dort, wo der
  Rauch auf flachem Boden aufsitzt, eine harte gerade Linie ab (an Hängen und Häusern ist das bekannt)?
  **ok (2026-09-15)**
- **624b** (223): Bloom bleibt an, nächster Schlag mit dem HQ im Bild. Glüht das Bild kurz nach und ist nach etwa
  1,4 s wieder normal? Taucht dabei ein schwarzes Rechteck auf, oder flackert es? **ok (2026-09-15)**, der
  Vollbild-Blitz ist für den User in Ordnung (E15).
- **625a** (395): Developer options: passt das Wort "Abilities" ganz in seine Kachel?
- **625b** (394): F auf eine Gruppe Gegner. Sieht man den Frostausbruch (Blitz, Kältering, Reif, Splitter, Nebel)?
  Werden die Gegner weiß-cyan mit Eis, und hängen Fledermäuse still in der Luft? Ist ein Knistern zu hören?
  **Ergebnis 625 (2026-09-15):** a) passt, aber sehr eng. b) Befund: die Frostbombe überlagert die ganze Stelle
  (weißer Nebel und Glühen), Gegner und Details sind nicht mehr zu unterscheiden; Fledermäuse hängen gut in der Luft.
  Fix frostfix (Frost zurücknehmen, Label luftiger), erneut prüfen.

### Runde 7: Bloom an und aus (626 bis 629)

Aufbau: ein Ort mit Karte (nicht DevWorld), Cheats "Credits", "Research" und "Abilities". Verschiedene Tower an die
Route: Kanone oder Rakete, Magie, Eis, Gift, Chaos, Tentakel, Blitz ("Research" schaltet alle frei). Welle starten.
Bloom schalten: Display-Menü, Effects, Haken "Bloom". Jeden Punkt erst ohne, dann mit, dann wieder ohne Bloom
ansehen. Ohne Bloom hat sich rechnerisch nichts geändert, gefragt ist der Unterschied mit Bloom. Fällt dir ohne Bloom
trotzdem etwas als neu auf, bitte melden.

- **626**: Kamera nah an einen Pulk. Sind die Gegner mit Bloom gleich hell und gesättigt wie ohne (bisher mit Bloom
  heller und blasser)? Healthbars grün, gelb, rot gleich? Schadenszahlen in derselben Farbe? **ok (2026-09-15)**
- **627**: Brand- und Blutflecken am Boden, Feuer und Funken, dazu F und E. Sind die Flecken mit Bloom noch etwas
  heller als ohne, aber weniger als bisher (bisher mit Bloom deutlich heller)? Feuer und Funken über der Straße mit und
  ohne Bloom etwa gleich? **ok (2026-09-15)**
- **628**: Magie-, Eis-, Gift- und Chaos-Geschosse, Tentakel, Blitze. Tentakel mit Bloom in derselben Farbe wie ohne
  (bisher mit Bloom heller)? Kugeln, Spuren und Blitze über der Straße etwa gleich? **ok (2026-09-15)**
- **629**: Kamera aufs HQ, dann aufs Spawn-Portal zwischen zwei Wellen und beim Start. Diamant und Label mit Bloom wie
  ohne? Straßenlicht vor dem Portal mit Bloom nicht heller als ohne? Beschwörungskreis sichtbar wie bisher?
  **ok (2026-09-15)**

### Runde 8: Einzelstücke (630 bis 631)

Jeder Punkt hat seinen eigenen Aufbau.

- **630** (142): Standort-Dialog, Tab "Showcase", "Rio de Janeiro, Copacabana". Lädt der Ort ohne Zufalls-Spawn, mit
  dem Portal an der Stelle, die du für Rio geliefert hast? Steht in der Adresszeile `s=-22.96421,-43.17463`? Fehlt
  "Dubai, Marina Walk" in der Liste? **ok (2026-09-15)**
- **631**: DevWorld öffnen: an die Adresse `?devworld` anhängen, also `http://localhost:4200/?devworld`. Layers "Show
  routes" an, dann in den Quick Actions ganz links "Play route animation". Liegen die animierte und die feste rote
  Linie auf derselben Höhe, ohne 2 m Versatz? **ok (2026-09-15)**

## Runden (alte, noch ungetestete Punkte)

### Runde 9: Gegnermodelle (632 bis 635)

Aufbau: "Enemies" (Enemy Debug), Typ wählen, Stecknadel-Knopf, Klick auf die Route, den Gegner in "Debug Enemies"
anklicken, unter "Movement" auf "Start" (siehe Vorab).

- **632** (154, 183): Mech, Wallsmasher, Mammoth, Zombie Soldier, Bear und Stone Golem laufen lassen: stocken sie am
  Ende der Laufschleife? Rennt die Ratte? Fliegt der Drache ohne Sprung, und ist alle 12 bis 35 s sein Brüllen zu
  hören (ein Laufgeräusch hat er nicht)? **ok (2026-09-15)**. Wünsche für später (TODO): Bär dunkler (zu hell und
  gelb), Tank durch ein schöneres Modell ersetzen, Stone Golem mit besserem Laufgeräusch und leichtem Beben in
  Kameranähe.
- **633a** (156): Mit den Gegnern aus 632 `__perf.loseContext(2000)` in die Konsole, danach ein zweites Mal. Kommt
  jedes Mal nach etwa 2 s die Zeile "Baked N VATs again"? Stehen die Gegner danach normal da?
  **Ergebnis (2026-09-15): klappt** (Bild kurz schwarz, einmal kurz weiß, dann normal; "Baked 23 VATs again ...
  4507 ms", beim zweiten Mal 5 VATs, 804 ms). **Befund:** 180-mal `WebGL: INVALID_OPERATION: delete: object does not
  belong to this context` aus `three-tiles-engine.ts:849` (render), nachdem im Enemy Debug Gegner entfernt und neu
  gesetzt wurden. Fix vatfix, erneut prüfen.
- **633b** (154): Dann Cheat "Kill". Bleibt der Wallsmasher in seiner Endpose liegen? **ok (2026-09-15)**
- **634** (155): Ghost und Zombie gemischt setzen, Kamera so drehen, dass sie sich überdecken. Scheint kein Zombie
  durch einen Ghost davor? Verschwindet kein Ghost hinter einem Zombie, der weiter hinten steht? **ok (2026-09-15)**
- **635** (184, 185): "Waves", Single, "Zombie v2", Count 10, "Start Custom Wave", sterben lassen: fällt einer im
  Todes-Clip zu Boden, bevor er verschwindet? Danach Custom Wave "Wallsmasher": ist seine Vorschau im WAVE-Panel
  farbig?
  **Ergebnis (2026-09-15):** zombie_v2 verschwindet minimal zu früh, liegt noch nicht ganz am Boden; Fix vatfix.
  Wallsmasher-Vorschau nicht beantwortet, noch offen.

### Runde 10: Laser und Held (636 bis 639)

Aufbau: Cheats "Abilities", "Research" und "Credits", eine Welle mit Bodengegnern (etwa Custom Wave "Zombie",
Count 30).

- **636a** (397): L drücken. Erscheint ein Ring mit einem goldenen Band Richtung Spawn? Wird er abseits der Route rot,
  mit einem Hinweis?
- **636b** (397): Klick vor eine Gruppe. Kommt erst ein oranges Band, dann eine Lichtsäule, die 4 s Richtung Portal
  läuft, mit Funken und Brandspur? Sieht das gut aus?
  **Ergebnis 636 (2026-09-15):** alles da und funktioniert. Wunsch: insgesamt bildgewaltiger, die Brandflecken tiefer
  und mächtiger. Umsetzung laserfx.
- **637** (385): Münze oben in der linken Leiste klicken. Steht der Soldat am Routenpunkt beim HQ? Fehlt in der
  Konsole "[HeroRenderer] Hero model did not load"? Sieht die Figur gut aus? **ok (2026-09-15)**
- **638** (386): G drücken (oder den Held-Knopf). Goldener Ring unter ihm und ein kleinerer auf seinem Posten? Noch
  einmal G: gleitet die Kamera zu ihm? **ok (2026-09-15)**
- **639** (388, 389): Held an eine diagonal verlaufende Straße schicken (laut Kompass etwa Nordost oder Nordwest),
  Gegner nah an ihn. Starten Tracer und Mündungsfeuer an der Waffe, nicht im Boden oder über dem Kopf? V mehrmals:
  wechseln Farbe und Schussgeräusch? Explodiert die Munition "Explosive" am Ziel? **ok (2026-09-15)**

### Runde 11: Veteranen und viele Gegner (640 bis 643)

Aufbau: Cheat "Credits", ein Archer an die Route.

- **640** (348): Welle 1 spielen, wenn nötig auch Welle 2. Steht nach 10 Todesstößen im Tower-Panel "BLOODED"? Sitzt
  über dem Archer ein silberner Winkel mit dunklem Rand, sieht er ordentlich aus? **ok (2026-09-15)**
- **641** (349): Kamera nah an den Archer (etwa 20 m), dann weit weg. Passt das Abzeichen nah zum Tower, und blendet es
  beim Wegzoomen ab etwa 700 m aus, bis es ab 1 100 m weg ist? Verschwindet es hinter einem Gebäude? Archer auf einem
  Dach mit Sockel: sitzt es über der Spitze? **ok (2026-09-15)**
- **642a** (351): "Credits" und "+HP" je mehrmals mit Shift+Klick. Ragt keine Zahl im Header ins Nachbarfeld?
- **642b** (210, 211): Ränge zählen je Tower, und nur der Todesstoß zählt; stehen viele Tower an einer Stelle, teilen
  sie sich die Kills. Deshalb einen einzelnen Tower an ein langes Stück Route, Cheat "Max Up", andere Tower weit weg.
  Custom Wave "Zombie", Count 1200, dazu ein paarmal "+HP" (Klick), falls Zombies durchkommen. Zeigt das Abzeichen ab
  150 Kills drei silberne Winkel, ab 400 drei goldene, ab 1 000 einen Stern? Lesbar über hellen Dächern und dunklem
  Himmel? **642a und 642b ok (2026-09-15)**
- **643** (172, 546): Etwa 10 Archer oder Gatling an eine Stelle, Custom Wave "Zombie", Count 100, Tempo 1x. Kamera
  erst weit weg, dann heran: setzt das Stöhnen der Zombies in Hörweite ein, von höchstens etwa 12 zugleich? 2 Minuten
  zusehen: bleiben die Schüsse hörbar? **ok (2026-09-15)** für den Ton; dabei fiel dem User ein anderer, gravierender
  Bug auf:
  **Befund (2026-09-15, 2 von 2 reproduziert):** viele Archer und Gatling an einer Stelle, mehrere Custom Waves mit
  vielen Gegnern. Den Helden anheuern und in die Nähe des Tower-Pulks schicken: in der nächsten Welle feuern die Tower
  gar nicht mehr auf Gegner. Den Helden wieder wegschicken hilft nicht. Solange er am HQ stand, war alles gut.
  Vermutlich braucht es eine Bewegung und einen Wellenwechsel, oder den Helden nahe den Towern beim nächsten
  Wellenstart. Keine Fehler in der Konsole; der Held stand 50 m oder mehr von den Towern entfernt (Verdeckung durch
  das Modell damit unwahrscheinlich). Untersuchung herolos (Zustand nach Marschbefehl und Wellenwechsel). Daten:
  Der Fehler beginnt mit der ersten Bewegung des Helden. `__towerTargets()` im Fehlerzustand: tower-2 und tower-3
  "no target, asleep (wake check every 500 ms)", `sleeping: true`, `visibleCells: 241`, "2 tower(s) with an enemy
  near". Die Sicht ist also in Ordnung, die Tower schlafen und wachen trotz Gegnern nicht mehr auf. Es reicht, den
  Helden ein paar Meter am HQ zu bewegen, 900 m von den Towern entfernt: ein globaler Zustand, keine Nähe. Später trat
  es auch ganz ohne Bewegung des Helden auf: ein allgemeiner Fehler im Schlaf/Aufwach-Pfad der Tower.

### Runde 12: Blutmond (644 bis 647)

Aufbau: Display-Menü "Blood Moon" an, Cheats "Research" und "Credits", ein paarmal "+HP" (Klick, je +1000 HP), damit
das HQ die Wellen ohne passende Tower übersteht. Blutmond ist in Welle 14, 21, 28, 35 und so fort. Einen Tower auf
ein Dach mit Sockel und einen Ice Tower an die Route stellen. "Jump to wave" 14 ("Jump: next start Wave 14"). Dann
nicht Space, sondern eine Custom Wave "Zombie", Count 30: sie zählt als Welle 14 und ist damit eine Blutmond-Welle.
(Die echte Welle 14 bringt Mammuts und Wallsmasher, keine Zombies.)

- **644** (373): Haben die Gegner einen roten Rand? Beginnt der Lichtkegel des Sockel-Towers oben am Tower, nicht im
  Sockel? **ok (2026-09-15)**, funktional; der Kegel der Gatling sitzt minimal zu hoch. Wünsche (TODO 3.7):
  Kegelhöhe je Tower in den Tower-Debug-Tools feinjustierbar; Debug-Schalter, der Blutmond (und künftige Modi) mit
  allem Zubehör erzwingt.
- **645** (422): Den Ice Tower Zombies töten lassen. Sind Eis- und Blutflecken am Boden rot getönt wie der Boden,
  nicht hell leuchtend? **ok (2026-09-15)**
- **646** (376): Noch in dieser Welle Display-Menü, Effects, "Bloom" an. Bleibt die rote Tönung etwa gleich? Ist der
  Kegel über hellem Boden schwächer? **ok (2026-09-15)**
- **647** (376): Nach dem Ende der Welle "Jump to wave" 21, Space: Welle 21 bringt Fledermäuse. Sind sie rot getönt
  wie die anderen Gegner? Danach "Jump to wave" 35, Space: glühen die Skarnax-Ringe rot, auch der neue Kopf nach einem
  Split? **ok (2026-09-15)**

### Runde 13: Neustart, Musik, Game Over, Dialoge, Verkauf (648 bis 652)

Aufbau: je Punkt beschrieben.

- **648a** (158, 181, 173): Neuen Ort laden, dann Strg+Umschalt+R, nichts klicken. Kein "Uncaught" in der Konsole
  (höchstens "[MusicMixer] Audio context did not resume")? Läuft im Ladescreen das Main Theme? Es startet beim Laden
  von selbst; blockiert der Browser das automatische Abspielen, bleibt es stumm, und kein Klick holt es nach (bekannt).
  **648a und 648b ok (2026-09-15)**
- **648b** (158, 173): Wenn der Ladescreen verschwindet: blendet das Main Theme in etwa 3 s aus, und nach einer kurzen
  Stille beginnt der Build-Track (nacheinander, nicht überblendet)? War bis hier alles stumm, einmal ins Bild klicken
  und melden, ob danach Musik kommt. Audio-Menü: wirken Musik aus, an und Lautstärke sofort?
- **649** (341, 173): An einem Ort, der auf diesem Rechner noch nie gespielt wurde, Welle 1, ohne "Jump to wave".
  Rechtsklick auf "+HP" bis Game Over (zehnmal, oder zweimal mit Shift). Blendet die Musik aus? Erscheint nach etwa
  1,2 s unter RESTART ein kleiner Globus mit "First run here", ohne dass RESTART springt? Blendet "Skip" den Hinweis
  aus?
  **Ergebnis (2026-09-15): kein "First run here"** nach Game Over an neuen Orten (Screenshot: WAVE 0, TIME 0:17, also
  vor dem Start von Welle 1). Worker firstrun: kein Bug, der Hinweis braucht eine gestartete Welle
  (LOCATION_SYSTEM.md); berichtigter Nachtest in 728. **Nebenbefund, reproduzierbar:** Wird der Ort beim Boot geladen (URL
  oder F5), fehlt der Schadenston am HQ; nach einem Ortswechsel ist er da. HP werden korrekt abgezogen; Bau-, Verkaufs-
  und Zombie-Sounds und Musik laufen. Worker hqsound. **Nebenbefund 2:** Fähigkeiten (Abilities) zeigen keine
  Schadenszahlen an den Gegnern wie Treffer von Towern, vielleicht fehlt auch die Belohnung. Worker abilitydmg.
- **650** (160, 162): Im BUILD-Panel die Info "Damage vs armor" öffnen und mit Esc schließen. Ist der Übergang
  animiert, die Schrift wie gewohnt? Bleibt der Kopf des Dialogs beim Scrollen stehen? **ok (2026-09-15)**
- **651** (326): Im WAVE-Panel mit Tab auf die NEXT-Rauten: ist der goldene Fokusrahmen gut sichtbar?
  **651 und 652 ok (2026-09-15)**
- **652** (Doku, Research Center verkaufen): Cheat "Credits", ein Research Center bauen und anklicken. Zeigt sein
  Panel einen Sell-Knopf wie beim Tower (zweimal klicken)? Gibt der Verkauf Credits zurück wie bei einem Tower (75 %
  des Eingesetzten)?

## Daten vom User

- **D1 Tokyo (142):** Showcase "Tokyo, Shibuya Crossing" laden. Macht die Route eine Schlaufe um einen Block: URL aus
  der Adresszeile schicken, dazu die Ausgabe von `__routes.describe()`.
  **Ergebnis (2026-09-15):** Route nicht gut. Neuer Ort vom User: `?l=35.65924,139.70049&s=35.65208,139.69853`.
  Worker showcase.
- **D2 Erlenbach unter der Autobahn (alte 53):** Weinsberger Straße unter der Autobahnbrücke. `__corridor.pick()`,
  Linksklick auf die rote Linie mitten unter der Brücke, die Zeile `[Corridor] column at the click` schicken. Dann F5:
  liegen Zellen und Gegner danach auf der Straße? Das zeigt die Ursache, behoben ist noch nichts.
  **Daten (2026-09-15):** Die rote Linie liegt weiter oben auf dem Autobahndeck (Screenshot). Pick bei 268,3/-812,8,
  Way 230161781 (secondary): die Zellen liegen auf 220,6 bis 220,8 m (Deck), zwei Säulen (269/-815, 271/-815) sehen
  unten die Straße bei 214,7 und 215,05 m (`overM` 5,9 und 5,6). Säule am Klick: nur ein Treffer, 220,67 (cached
  220,77, Tiefe 23 und 25). Das Mesh unter der Brücke ist also größtenteils gefüllt. F5-Teil offen. Worker underpass.
- **D3:** später. **D5:** kein Ort bekannt, Punkt ruht.
- **D6 Korridor-Sperre messen (lockbrief, Entscheidung 2026-09-15: Sperre bleibt, erst messen):** Ort laden, Konsole
  mit Filter "Corridor". Vor dem ersten Tower die letzte Zeile `[Corridor] clearance ...` notieren, vor allem
  `unmeasured=`. Dann `losPerfEnable()` in die Konsole, einen Tower bauen und die Zeile mit `cube` und `total`
  schicken. Viele offene Stationen und kleine Cube-Zeiten sprechen für den Mittelweg (ein Neubau je Wellenpause).
- **D3 Feste Spawns für Showcases (142):** Für jeden Showcase-Ort, der einen festen Spawn bekommen soll: Ort laden,
  Header "Set spawn" an die gewünschte Stelle (R dreht das Portal), `__showcase.line()` in die Konsole, Zeile schicken.
- **D4 Klumpen ohne Beschuss (363):** Entfällt, 618 war ok (2026-09-15). Nur wenn in 618 ein Tower stillsteht, obwohl
  Klumpen in seinem Ring sind:
  1. Aus der Konsole die letzten Zeilen mit `[TowerTargets]` kopieren. Vorn steht die Tower-ID; im Zweifel alle
     Zeilen der letzten Sekunden.
  2. Den Tower anklicken und einen Screenshot mit seinem Ring machen.
  3. `__towerTargets.watch(false)` in die Konsole, das beendet die Ausgabe.
- **D5 optional (alte 53):** Kennst du einen Ort mit Tunnel oder überdachtem Durchgang auf der Route? URL schicken,
  sonst bleibt der Punkt liegen.

## Entscheidungen

Einzeln vorlegen. Die Lead-Entscheidungen sind gebaut und lassen sich einzeln zurücknehmen.

**Lead-Entscheidungen zum Bestätigen**

- **E1 Center-Tipp nach Welle 2:** Der Tipp "Build a research center" kommt erst nach Welle 2
  (`RESEARCH_TIP_AFTER_WAVE`). Bestätigen oder eine andere Welle nennen. **Entscheidung User (2026-09-15): nach
  Welle 3.** Worker showcase.
- **E2 Laser-Bot-Zählung:** Die Bot-Strategie zählt Gegner bis 72 m hinter dem vordersten, der Strahl trifft im
  5-m-Radius; eine Näherung, nur für Trainingsläufe. Bleibt, weil eine Änderung die Bot-Läufe verschiebt.
  **Entscheidung User (2026-09-15): genauer machen.** Worker botlaser.
- **E3 Boss-Varianten im Log:** Welche Welle mit Skarnax oder Ooze ins Log des Collectors gehört, wartet auf den
  Run-Dump. Bis dahin bleibt es, wie es ist. **User (2026-09-15):** Dazu muss auch ermittelt werden, wie stark die
  Bosse je Welle sein sollen; das passt aktuell nicht. Beides im Rahmen des Balancings (TODO), nicht mehr vorlegen.
- **E4 Wackeln bei HQ-Treffern:** "Härter" heißt mehr HP: ein Treffer, der mehr HP kostet, kommt durch die
  900-ms-Drossel, die Stärke bleibt gedeckelt (`d48b5c87`). Alternative: härter heißt stärkeres Wackeln.
  **Entscheidung User (2026-09-15): bleibt so.**
- **E5 Tower-Sicht neben Autos:** Für Zellen, die der Stufen-Check auf Straßenhöhe setzt, prüft die Sichtlinie über
  dem Objekt; der Tower schießt dann auf Gegner "im Auto" (`66569eca`). Seit Autozellen wegfallen, kaum noch
  sichtbar. Bestätigen oder zurücknehmen. **Entscheidung User (2026-09-15): bleibt** (Prüfpunkt über dem Objekt).
- **E6 Mittellinienzellen auf Dach oder Erker:** Läuft die OSM-Linie selbst unter einem Erker oder über eine Dachecke,
  bleibt die Zelle, bekommt aber Straßenhöhe (`f75e72ab`). Alternative: Zelle oben lassen, dann `f75e72ab` und
  `afb3ad2d` zusammen zurücknehmen. `afb3ad2d` ist zugleich der Kronen-Fix für Erlenbach (608); die Alternative nimmt
  ihn mit zurück. **User (2026-09-15):** Es soll realistisch sein, Straßenhöhe unter einem gefüllten Erker ist falsch,
  das 3D-Modell gilt. In Diskussion: Ausweichen im Korridor (Zelle weg, Weg biegt um das Hindernis, ohne Platz
  daneben wie ein Durchgang), gilt dann auch für Autos auf der Mittellinie (706 bis 708). **Entscheidungen User
  (2026-09-15):** Hindernis ab 0,5 m über dem Straßenboden daneben; ein Auto, das eine enge Gasse ganz sperrt: die
  Gegner klettern drüber (dem Modell nach); eine Gasse ganz unter einem Erker mit gefülltem Mesh: Durchgang wie im
  Torbogen. Worker detour.
- **E7 Brückenenden ohne Niedrig-Hindernis-Probe:** Bis 40 m hinter einem Brückenende prüft der Korridor keine
  niedrigen Hindernisse, auch wo die Zufahrt schon auf Bodenhöhe liegt; Autos engen dort nur über den Laufweg ein
  (`347ae61b`). **Überholt durch bridge4 (2026-09-15):** Auf der Strecke hinter dem Brückenende (jetzt 60 m) läuft
  die Probe wieder und misst vom Boden der Station; nur auf dem Brückendeck bleibt sie aus. Nicht mehr vorlegen.
- **E8 Heldenschüsse auf diagonal verlaufenden Straßen:** Seit Gegner und Held metrisch ausgerichtet werden, starten
  seine Schüsse an einer anderen Stelle, dort, wo das Modell die Waffe hält (`fa7712ec`): auf einer 45°-Straße bei
  49° N etwa 0,5 m seitlich, auf Nord-Süd- und Ost-West-Straßen gar nicht. **Erledigt durch 639 (ok, Tracer an der
  Waffe).**
- **E9 Klumpen-Befund ohne Code-Fix:** Im Test nicht nachstellbar. Statt einer Änderung gibt es die Sonde
  `__towerTargets` (618, D4); ein Fix erst mit Daten. **Erledigt: 618 ok, kein Befund mehr.**
- **E10 Additives Licht mit Bloom:** `ADDITIVE_GROUND` 0,3 wie beim Beschwörungskreis. Mit Bloom sind additive Effekte
  jetzt über jedem Boden schwächer als vorher (Licht 0,1 über Boden 0: 0,349 → 0,271; über 0,6: 0,079 → 0,049).
  Verglichen mit ohne Bloom sind sie gleich über einem Boden von 0,3, heller über dunklerem und dunkler über hellerem.
  Bei einem Boden von etwa 0,53 passte der alte Rohwert zufällig zum Bild ohne Bloom. Ändern geht über eine Zahl in
  `display-output.ts`. **Erledigt durch Runde 7 (626 bis 629 ok).**
- **E11 Ooze-Gold bei junger Ooze:** Eine voll gewachsene Ooze zahlt gleich viel wie vorher. Bei einer jung getöteten
  hängt es von der Länge ab: meist weniger, bei manchen Längen etwas mehr (Welle 45: 1,5 m Körper 1142 statt 2181
  Gold, 15 m 2855 statt 3272, 27 m 4568 statt 4363). Genau gleich ginge nur mit gewichteten Slots für alle Gegner
  (`2acf7db9`, Tabelle in `tmp/fix1/reports/oozedeath.md`). **Entscheidung User (2026-09-15): ins Balancing**
  (TODO 2.2).
- **E12 Debug-Checkboxen entfernt:** "Textures", "Skeleton Clone" und "Alpha Blend" im Debug-Fenster Display
  (Abschnitt "Performance") waren wirkungslos und sind weg (`1427f5c0`). **Entscheidung User (2026-09-15): ok.**
- **E13 Atompilz auf Preset Low:** Low zeigt jetzt den ganzen Pilz in derselben Form mit weniger Sprites (294 Rauch,
  88 Glut) statt nur der Detonation, ist damit aber teurer als vorher. Ansehen: Display-Menü, Effects, "Low", K. Pilz
  gröber, Framerate ok? **User (2026-09-15): später ansehen.**
- **E14 Hörweite des Atomschlags:** Knall und Grollen sind bis 1500 m zu hören, so weit wie das Wackeln reicht, statt
  bis 500 m. Ansehen: aus der Übersicht weiter als 500 m herauszoomen, K. **Entscheidung User (2026-09-15): ok.**
- **E15 Vollbild-Blitz des Atomschlags:** Das ganze Bild steht 80 ms lang auf 0,92 Weiß (`flash.screenPeak`,
  `screenHold` 0,08 s), danach blendet der Blitz bis 1,1 s nach dem Einschlag aus. Bitte auch mit Blick auf
  Lichtempfindlichkeit beurteilen, über die ganze Dauer. Mildern geht über `screenPeak`, 0 schaltet den Blitz ab.
  **Entscheidung User (2026-09-15): bleibt so** (Playtest 624b).

**Neu zu entscheiden**

- **E16 `immunityPercent`:** Steht bei Herbert auf 100, wirkt aber nirgends. Entfernen oder an Schaden und Anzeige
  anbinden? **Entscheidung User (2026-09-15): anbinden.** Worker immunity fand: gedacht als Schadensimmunität, bei
  100 wäre Herbert unverwundbar (`tmp/fix1/reports/immunity.md`). **User:** Bosse brauchen so etwas sicher, offen ist
  was genau und in welchem Umfang; erst besprechen. Grundlage: `tmp/fix1/reports/bossresist.md`.
  **Teilentscheidungen User (2026-09-15):** Herbert Slow-Schutz 50 %; Skarnax steht nur still, wenn sein Kopf
  eingefroren oder betäubt ist (Worker skarnax). **User:** Es gibt Immunitäten und Resistenzen, für Effekte und für
  Schadenstypen, dazu eventuell Schild und HP getrennt; erst ein Konzept, nicht heute (TODO 3.3). Nicht mehr vorlegen.
- **Held Stufe 2 (aus E18):** Worker herotier2 fand keine Vorgabe in der Doku und schlug drei Varianten vor
  (`tmp/fix1/reports/herotier2.md`). **User (2026-09-15):** offen lassen, erst braucht es den richtigen Tech Tree;
  der Held muss vermutlich viel mehr Möglichkeiten bekommen. TODO.
- **E17 Doku-Tabelle in CLAUDE.md:** Auf die Pflichtlektüre plus Verweis auf docs/INDEX.md kürzen? Vorerst bleibt sie
  voll. **Entscheidung User (2026-09-15): kürzen.** Worker docsai.
- **E18 Assets und Features:** Welche willst du, in welcher Reihenfolge? Warnsirene des Atomschlags; eigene Sounds
  für Frost und EMP; Laser-Ton am Startpunkt; Skarnax (Textur, bewegte Beine, Schwanzstück, Mandibeln, Sound am
  Kopf, Healthbar je Ring); Tod-Sound der Schleimklumpen; Mech und Ghost über dem Modell-Budget; Gold-Popup der Ooze
  an der Spitze; größere Eiskristalle an großen Gegnern; Held Stufe 2; Schrägstütze für Sockel an der Dachkante.
  **Entscheidung User (2026-09-15), alles als Nächstes:** Sounds Warnsirene Atomschlag, Frost, EMP, Laser am
  Startpunkt, Skarnax-Kopf (ElevenLabs steht auf dem Rechner bereit); Skarnax Textur, Beine, Schwanzstück und
  Mandibeln (Healthbar je Ring gibt es laut User schon); Modelle Held Stufe 2, Sockel-Stütze, Tank-Modell (TODO 3.1),
  Mech und Ghost ins Budget. Nicht gewählt: Tod-Sound der Schleimklumpen, Ooze-Gold-Popup, Eiskristalle.
- **E19 ONNX-Director im Debug-Fenster:** Das eingecheckte Modell hat 156 Eingänge, der Encoder liefert 208.
  `OnnxPolicy.load()` lehnt es deshalb ab, "Load ONNX model" im Fenster "AI" (Developer options) bleibt immer bei den
  Regeln. Ein Modell neu exportieren oder trainieren, oder das Opt-in so lassen? **Entscheidung User (2026-09-15): Opt-in ausblenden**, bis ein passendes Modell da ist.
  Worker docsai.

Schon entschieden, nicht mehr vorlegen: Wurm-Ecken, Held ohne Ersatzmodell, Boss-Intro mit Hindernis-Check und
Abstand 21,4 m, Vorgärten (a), Showcases mit festen Spawns und ohne Dubai, Name Skarnax, Atompilz "realistisch,
aber größer", Dachkante so lassen, Replay als eigenes Thema.

## Erledigt per Test

- 542, 321, 393, 398 (Laser auf die Wurmringe) und 400 sind per Szenario-Test bestätigt, 334 im frischen Checkout
  (`npm ci` und `ng build` je Exit 0). Suite dabei: 395 Testdateien, 4520 Tests grün.
- Ebenfalls per Test, ohne eigenen Punkt: Klumpen-HP in der Summe gleich beim voll gewachsenen Körper (bei jungen
  Körpern weicht sie ab, wie das Gold in E11) und 1x wie 4x beim Ooze-Tod, Tower nehmen Klumpen als Ziel
  (Wächter-Szenario), Atompilz und Grollen in Pause und bei 4x, Held in der Pause nach einem Routen-Neubau,
  Blickrichtung der Gegner auf Diagonalen. Letztes Gate `994badd4`: 4596 Tests grün.
