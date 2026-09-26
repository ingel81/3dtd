# Playtest-Liste

> **Archiviert (2026-09-16).** Nur noch Historie. Offene Arbeit steht in [TODO.md](../../TODO.md), offene Nachtests in
> [PLAYTEST.md](../PLAYTEST.md). Die Punktnummern bleiben gültig, Tests und Code-Kommentare zitieren sie.

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

## Korridor-Umbau (Test des Users am 16.09., Logs und Bilder in `tmp/archive-2026-09/aus-tmp-2026-09-25/corridor_tests/`)

Getestet an fünf Orten: Erlenbach, Rothenburg, Berlin, Paris, Tokyo. Je Ort laden, Ladescreen beobachten, danach
zoomen und mit G springen.

- **738 Stabilität: ok.** In keinem der fünf Logs kommt nach `loading.done` noch ein `[Corridor] build` oder
  `rebuild`. Der Korridor ändert sich nach dem Ladescreen nicht mehr.
> **Achtung beim Vergleichen:** Der Turm-Fix vom 16.09. ändert den Teil `band` des Fingerprints an jedem Ort. Die
> Werte unten (Tokyo `e51f7114`, `band 40f24cbd`) taugen nur noch als Vergleich untereinander, nicht gegen neue
> Läufe. Für den nächsten Vergleich einmal frisch eichen. **Geeicht nach dem Säulen-Fix (`2ecb51d4`): Tokyo
> `1fc26ab1`**, siehe 745.

- **739 Determinismus: ok.** Tokyo dreimal geladen (mit Intro, Intro abgebrochen plus Zoomen, andere Fenstergröße):
  jedes Mal Fingerprint `e51f7114`, auch jeder Teil gleich.
- **740 Messung: ok.** Alle Stationen gemessen (`unmeasured=0`), alle auf der 2,5-m-Stufe.
- **741 Ladezeit: ok** ("sehr gut" laut User). Bau gesamt, davon Tiles: Erlenbach 4,6 s (3,1), Rothenburg 5,2 (2,7),
  Berlin 6,5 (4,0), Paris 4,7 (2,6), Tokyo 11,7 (9,4). Ladescreen fertig nach 10,3 bis 17,6 s.
- **742 Bilder: ok.** Berlin Straße und Platz sauber, Paris auf Deckhöhe mit sauberem Übergang am Brückenkopf, keine
  Zellen auf den Transportern, Tokyo ohne Ausreißer.
- **743 Turm in Rothenburg: Befund.** Am Turm mit Durchgang steigt der Korridor über den Turm, statt unten
  durchzugehen. Die Zellen sind gelb, also als Durchgang erkannt, nehmen aber die falsche Höhe; dazu
  `cellsWithoutHeight=7` (sonst überall 0). **Behoben (2026-09-16, `35539d1d`):** Unter dem Weißen Turm (Stadttor,
  8,7 m tief) stand das Rückgrat selbst auf dem Turm, deshalb erkannten alle Bandregeln den Durchgang nur an seinen
  Enden, das Portal fand keine Antwort, und die Zellen dazwischen nahmen das Dach. Jede Station trägt jetzt eine
  eigene Straßenhöhe (geglättet über 30 m); Durchgangserkennung, die zweite Durchgangsregel und die Portalhöhe lesen
  diese. Deckt Torturm, Torbogen, Auskragung und Steg ab, nicht Durchgänge über 30 m Tiefe. Die sieben Zellen ohne
  Höhe ließen sich nicht nachstellen, siehe nächsten Lauf. Nachtest: siehe `tmp/archive-2026-09/fix1/reports/corrpassage.md`.
  **Vom User bestätigt (2026-09-16):** "Turmpassage sieht nun gut aus", Bau 4,9 s, 235 Stationen, alle gemessen,
  765 Zellen. **Offen bleibt:** `build.fallback what=cells missing=7 found=0`, also weiter sieben Zellen ohne Höhe;
  der Lauf dauert genau die Sekunde aus Punkt 744. Beide Punkte sind derselbe Fall.
- **745 Ortswechsel im Spiel ändert den Korridor.** Erlenbach laden, dann im Spiel nach Tokyo navigieren: Fingerprint
  `fa4461be` statt `e51f7114` beim frischen Laden. Abweichend sind `band` (`23291918` statt `40f24cbd`) und `heights`
  (`813a9c6f` statt `8ae65891`); `stations`, `cells` und `tiles` sind gleich, alle Anzahlen identisch. Also weichen
  nur Säulenhöhen ab, und das Rückgrat verschiebt das Band mit. Nach einem vollständigen Neuladen stimmt der Hash
  wieder. Worker corrpassage. **Experiment (2026-09-16):** In einer Sitzung ergeben sich drei verschiedene Stände,
  bei identischen `stations`, `cells`, `tiles` und identischen Anzahlen: frisch geladen `e51f7114` (band `40f24cbd`,
  heights `8ae65891`), nach Navigation im Spiel `487799db` (`0b833f4b`, `813a9c6f`), nach `__corridor.reset()`
  `a53ad0e9` (`bab15dbb`, `9629bd73`), ein zweites `reset()` ändert nichts mehr. Also weichen nur Säulenhöhen ab,
  obwohl Tile-Tiefe und geometrischer Fehler je Zelle gleich bleiben. **Nebenbefund:** `reset()` baut ohne zu messen
  (`clearance.start segments=0 stations=0`, `rays=0`) und ändert dabei trotzdem die Höhen; ein Neubau ohne Messung
  sollte entweder neu messen oder ablehnen.
  **Fix (2026-09-16, `2ecb51d4`, Worker determ, Bericht `tmp/archive-2026-09/fix1/reports/determ.md`):** Die Vermutung "der Strahl
  trifft ausblendende Tiles" war falsch, die Bibliothek schneidet nur aktive Tiles. Ursache war der Säulen-Cache: Er
  hält eine Höhe je 0,5-m-Feld, gemessen am Punkt des ersten Aufrufers. Bei frischer Ladung füllten die Stationen die
  Felder der Zellmitten zuerst, bei `reset()` (keine Station gemessen) die Zellen selbst; gleiche Tiles, andere Höhen.
  Für `reset()` per Test belegt (ohne Fix 20 von 67 Zellen anders), für die Navigation nur plausibel. Jetzt castet der
  Cache in der Feldmitte, Stationen messen exakt am Punkt und ohne Cache. Neu im Trace: `tileSet` in `build.tiles`
  (Hash über die Tiles, auf denen gemessen wurde). Der Fix ändert `heights` und `band` an jedem Ort, also neu eichen.
  **Nachtest** (Konsole offen, Filter leer; keine Tower, keine Welle, sonst lehnt `reset()` ab):
  1. Tokyo `?l=35.65924,139.70049&s=35.65208,139.69853`, F5, Ladescreen abwarten (Intro darf abgebrochen werden).
     `__corridor.fingerprint()` notieren (**A**, neue Eichung), dazu `tileSet` aus der Zeile
     `[CorridorTrace] ... build.tiles`.
  2. Dieselbe URL noch einmal mit F5: Hash gleich A? `tileSet` gleich? (Wenn nicht, taugt `tileSet` nicht, trotzdem
     weiter.)
  3. Erlenbach `?l=49.17337,9.26851&s=49.17556,9.26401`, F5, warten. Dann Header "Change location", Tab "Showcase",
     "Tokyo, Shibuya Crossing", Ladescreen abwarten, nicht neu laden. `__corridor.fingerprint()`: gleich A? `tileSet`
     der neuen `build.tiles`-Zeile notieren.
  4. Ohne Neuladen `__corridor.reset()`, warten auf `[Corridor] Corridor rebuilt`. `__corridor.fingerprint()`: gleich
     A? `tileSet` notieren.
  Auswertung: 2, 3 und 4 gleich A heißt behoben. Weicht es ab, bitte die Fingerprint-Tabellen und die
  `build.tiles`-Zeilen schicken; bei anderem `tileSet` wurde auf anderen Tiles gemessen, bei gleichem dazu
  `__corridor.trace()` nach Schritt 3 und 4.
  **Nachtest ok (User, 2026-09-16):** frisch, zweites F5, Navigation Erlenbach -> Tokyo und `reset()` liefern alle
  `1fc26ab1` (band `bab15dbb`, stations `01764c71`, cells `cee4fd07`, heights `31d812ba`, tiles `cb1e6d21`; 470, 387,
  1509, 1509, 1896 Einträge). **Neue Eichung Tokyo: `1fc26ab1`.** `tileSet` taugt so nur bedingt: frisch `311f13f3`
  (201 Tiles, coarse 20), nach Navigation und `reset()` `aa4f29c7` (195 Tiles, coarse 14), bei gleichem `fine=181`
  und gleichem Fingerprint. Der Hash zählt die groben Eltern mit, die noch aktiv sind, aber nicht gemessen werden.
- **744 Rückfall kostet eine Sekunde umsonst.** Rothenburg 1036 ms ohne Fund, Berlin 1070 ms für eine Station,
  Paris 1087 ms für vier. **Stand 2026-09-16: bewusst offen gelassen.** Ladezeit ist billig, und die Sekunde ist in
  Rothenburg dieselbe Ursache wie die sieben Zellen ohne Höhe; zuerst gehören die geklärt. Einstiegspunkt im Bericht
  `tmp/archive-2026-09/fix1/reports/corrpassage.md`, Abschnitt 7. Nebenbei behoben: Die Trace meldet `LONG` jetzt nur noch über dem
  eigenen Budget des Schritts, statt bei jedem Messabschnitt (`bea9becd`).
  **Fix 743/744 (2026-09-16, `27bfa500`, Worker cells7, Bericht `tmp/archive-2026-09/fix1/reports/cells7.md`):** Die sieben Zellen
  liegen nicht am Turm, sondern am Marktplatz in einer Reihe am Rand vor dem Laubengang des Rathauses (belegt über
  Screenshot 082242, Route und OSM). Vermutlich treffen ihre Säulen nichts (Loch im Mesh), und am Rand fehlt das
  gegenüberliegende Nachbarpaar zum Füllen (plausibel, nicht belegt). Jetzt: Eine Zelle ohne eigene Höhe, die
  mindestens drei gemessene Zellen derselben Fläche berührt, nimmt deren Median (`filled`); ein Tunnelportal ohne
  Treffer nimmt die Straße des Bands; der Rückfall für Zellen spart sich den Rückweg auf 2,5 m (Spec 1056 -> 528 ms);
  `build.fallback` und `build.freeze` nennen `why=` und `at=`. Übrige Zellen ohne Höhe (Lücken ab zwei Zellen Tiefe,
  Brückenende oder Portal ohne Säule und Straße) bleiben ohne Höhe und stehen nur im Trace (Lead-Entscheidung: keine
  Höhen erfinden). **Offener Befund:** Für so eine Zelle rechnet die Tower-LOS auf der Höhe des Routenankers, die
  Gegner stehen dort anders (`route-grid-los.ts:54`, `:66`); nicht angefasst.
  **Nachtest** (Konsole offen, Filter leer):
  1. Rothenburg `?l=49.37721,10.17904&s=49.37944,10.18365`, F5, Ladescreen abwarten. Erwartet: keine Zeile
     `[CorridorTrace] ... build.fallback what=cells`; in `build.freeze` `cellsWithoutHeight=0` ohne `why=` und
     `fallbackMs=0` (vorher 1036); `[Corridor] build: ... fallback=0.0`.
  2. Layers "Route Grid Overlay" an, zum Rathaus am Ende der Route (wie Screenshot 082242): vor dem Laubengang keine
     rosa Zelle, die Randreihe auf Platzhöhe. `__corridor.pick()` auf eine dieser Zellen: `state: 'filled'`.
  3. Falls doch rosa: die Zeilen `build.freeze ... why=... at=...` und `build.fallback what=cells ...` schicken, dazu
     `__corridor.pick()` auf eine Stelle aus `at`.
  4. Gegenprobe Paris `?l=48.85889,2.29320&s=48.86239,2.29190`: `build.fallback what=stations` wie bisher (4
     gefunden, um 1,07 s), keine Zeile `what=cells`, `cellsWithoutHeight=0`.
  **Nachtest (User, 2026-09-16):** Die rosa Zellen in Rothenburg sind weg. Neuer Befund siehe 747.
- **747 Rothenburg: Durchgang unterscheidet sich zwischen Navigation im Spiel und kaltem Einstieg** (User,
  2026-09-16). Daten folgen. Dafür neu (`aa9cf333`, Worker snapshot, Bericht `tmp/archive-2026-09/fix1/reports/snapshot.md`): Kachel
  "Snapshot" unter Developer options, "Waves & Inspect" (oder `__corridor.snapshot()`) lädt den ganzen Korridor als
  `corridor-<ort>-<cold|nav>-<hhmmss>.json` herunter. Ablauf: Rothenburg kalt laden, Kamera auf den Durchgang,
  Snapshot; von einem anderen Ort im Spiel nach Rothenburg, Kamera auf den Durchgang, Snapshot. Die Dateien liest der
  Lead aus dem Download-Ordner.
  **Auswertung (Lead, Snapshots `tmp/snapshots/corridor-rothenburg-ob-der-tauber-{cold-140702,nav-140807}.json`):**
  Beide Baue messen auf denselben Tiles (`tileSet` im Bau `2c5bb2bf`, Region `8f6524dd`, 27 feine Tile-Pfade
  identisch). Verschieden ist die Eingabe: kalt kommt das HQ aus der URL mit 5 Nachkommastellen (`49.37721,10.17904`),
  nach Navigation mit voller Genauigkeit (`49.377211325…,10.179041659…`), 0,148 m nördlich und 0,120 m östlich; der
  Spawn liegt ebenso rund 0,1 m daneben. Damit verschiebt sich das 2-m-Zellgitter gegen die Welt, und alles danach
  weicht ab: 238 von 238 Band-Einträgen, 51 Stationen, 765 gegen 763 Zellen. Am Weißen Turm erkennt der kalte Bau zwei
  Durchgänge, der navigierte nur einen (`passages=2` gegen `1`); dort stehen im navigierten Bau Zellen auf dem Turm
  (z.B. Zelle -97,111: 490,37 m statt 480,65 m Straße). **Zwei Befunde:** (a) derselbe Ort hat je nach Einstieg andere
  Koordinaten; (b) die Durchgangserkennung kippt schon bei 19 cm Versatz des Gitters.
  **Fix (a) (2026-09-16, `0acd8fe2`, Worker coords, Bericht `tmp/archive-2026-09/fix1/reports/coords.md`):** HQ und Spawns kommen auf
  jedem Weg mit 5 Nachkommastellen ins Spiel, so wie die URL sie schreibt (`canonicalCoords` in `utils/geo-utils.ts`):
  URL, Favoriten, letzte Orte, Dialog, Zufalls-Spawn, Klick-Platzierung. Gespeicherte Orte werden beim Laden gerundet.
  Die Platzierungs-Vorschau springt in Schritten von rund 1 m, ein Punkt rückt bis 0,66 m. Orte, die bisher mit voller
  Genauigkeit geladen wurden, bekommen einen anderen Fingerprint (denselben wie über ihre URL). Befund (b) ist in
  Arbeit (Worker passshift).
  **Nachtest (a):** Rothenburg `?l=49.37721,10.17904&s=49.37944,10.18365` kalt laden, Snapshot. Anderen Ort laden, im
  Spiel über Favoriten oder "letzte Orte" nach Rothenburg, Snapshot. Erwartet: beide Dateien gleiche `meta.hq` und
  gleicher Fingerprint (der Lead vergleicht).
  **Fix (b) (2026-09-16, `790bff72`, Worker passshift, Bericht `tmp/archive-2026-09/fix1/reports/passshift.md`):** Beide
  Durchgangsregeln brauchten ein Rückgrat, unter dem Turm gab es nur eines auf dem Dach; ob zwei Dachzellen eine Stufe
  auseinander lagen (kalt 0,26 m, nav 0,57 m), entschied über Durchgang oder Zellen auf dem Turm. Dazu prüfte die
  Linienregel nur die Zelle unter der Station. Jetzt: Durchgang auch ohne Rückgrat, sobald die Gegnerlinie irgendwo eine
  Zelle mehr als `roofRise` über der Straße kreuzt; Lücken bis 4 m zu einem anderen Durchgang oder OSM-Tunnel werden
  geschlossen; `passages` im Trace zählt keine Durchgänge mehr, die an einen OSM-Tunnel grenzen. Test: Turm-Szene in 65
  Gitterlagen, Überdeckungen in drei Winkeln, Pont d'Iéna und A6 in allen Lagen. **Risiko:** Die Bedingung "Band
  schmaler als 3 m" ist weg, an Traufen oder Kronen können neue Durchgänge entstehen. `passages` bisher: Berlin 0,
  Erlenbach 0, Paris 0, Tokyo 1, Rothenburg 2 (jetzt erwartet 0, der Turm liegt an einem OSM-Tunnel).
  **Offene Nebenbefunde (vor dem Fix schon so):** Zellen auf Dächern an Routenecken (`jointCap`, Ratstrinkstube,
  Markt 3); bei Überdeckung über 30 m liest `street` die Dächer (`PASSAGE_SPAN_M`); Marktplatz-Füllregel greift in 10
  von 65 Lagen nicht.
  **Nachtest (a + b):**
  1. Rothenburg `?l=49.37721,10.17904&s=49.37944,10.18365` kalt, Ladescreen abwarten. Overlay an, Kamera auf den
     Weißen Turm: gelbe Zellen durchgehend durch das Tor auf Straßenhöhe, keine Zelle auf dem Turm, rote Linie ohne
     Buckel. Snapshot.
  2. Anderen Ort laden, im Spiel über Favoriten oder "letzte Orte" nach Rothenburg, gleiche Prüfung, Snapshot.
  3. Kurz Berlin, Erlenbach, Paris, Tokyo kalt laden: `band.build ... passages=` wie bisher (0, 0, 0, 1)? Wo mehr: dort
     ein Snapshot mit Kamera auf die gelbe Stelle.
  **Nachtest ok (User, 2026-09-16, Snapshots in `tmp/snapshots/`, *-1503xx bis *-1509xx):** Rothenburg kalt und nach
  Navigation identisch, Fingerprint `d8050177` in allen fünf Teilen, `passages=0`, HQ beide `49.37721,10.17904`.
  `passages`: Berlin 0, Erlenbach 0, Paris 0, Tokyo 2 (vorher 1; laut User legitim). **Neue Eichung** (URL-Orte mit
  festem Spawn): Rothenburg `d8050177`, Tokyo `efc7362a`, Berlin `1d521dce`, Paris `16fbf786`; Erlenbach mit Spawn
  `s=49.17434,9.25915` `deaf0179`. **Beobachtung Erlenbach** (dieser Spawn): 2 von 482 Stationen ohne Tile auf beiden
  Stufen (`lod ... none:2`, `build.fallback what=stations missing=2 found=0`), auf einem Stück von rund 0,6 m
  (Segment `49.1736292,9.2614654|49.1736286,9.2614738`); `build.band` 1,02 s. Lead aus dem Snapshot: ein rund 2 m
  breiter Nord-Süd-Streifen ohne jeden Säulentreffer bei `49.17363, 9.26147` (vermutlich Naht zwischen Tiles, nicht
  belegt); Zellen dort gefüllt, die zwei Stationen auf Standardbreiten. **User: zurückgestellt**, wieder aufmachen,
  wenn solche Löcher gehäuft Probleme machen.
- **748 Band an Kurven und Abzweigungen dünn** (User, 2026-09-16, Stuttgart `?l=48.77895,9.17875&s=48.78353,9.17791`,
  Snapshot `tmp/snapshots/corridor-stuttgart-nav-152029.json`). **Analyse (Analyst cornerband, nur verstanden, nichts
  gebaut; Bericht `tmp/archive-2026-09/fix1/reports/cornerband.md`, Harness `tmp/archive-2026-09/fix1/cornerband-harness/`):** Nachgerechnet auf
  0,004 m. Je Station nimmt das Band als Rückgrat die tiefste Zelle im Suchfenster um die OSM-Linie. An der Kurve liegt
  eine Grünstreifen-Zelle neben der Fahrbahn 0,46 m tiefer und besteht die Einstiegsregeln mit rund 4 cm Luft; Station
  188 legt ihr Band deshalb neben die Straße, die Nachbarn auf die Fahrbahn. `taperEdges` (`corridor-band.ts:724-730`)
  begrenzt jede Kante auf 0,5 m je Meter gegen die Nachbarn und klemmt sie am eigenen Rückgrat; zwei seitlich
  auseinanderliegende Bänder schneiden sich so gegenseitig auf 1 m oder 0 ab. Der Knick verstärkt es (Kanten in
  gedrehten Segmentrahmen über den Knick verglichen, Querlinien laufen die andere Straße entlang), ist aber nicht die
  Ursache: Derselbe Kern steckt nachgerechnet in Berlin 157-159 und Paris 64-66 auf geraden Stücken (Rückgrat springt
  um ein Objekt, in Paris wegen 3 cm), nach Signatur in 35 von 59 schmalen Stationen aus 6 Snapshots. **Merkmal:**
  falsch schmal, wenn der eigene Lauf breit war, eine Kante am Rückgrat liegt und ein Nachbar ±2 Stationen ein Band
  ohne Überlappung hat; korrekt schmal, wenn die Kante aus eigenem Lauf oder eigener Wand kommt und die Nachbarn
  überlappen. **Lösungsrichtungen:** (1) Rückgrat als zusammenhängende Wahl entlang der Route (kürzester Weg über
  Stationen und begehbare Abschnitte) statt je Station die tiefste Zelle; (2) Taper aufs Intervall statt Kante plus
  Klemme; (3) gemeinsamer Rahmen am Knick. Empfehlung des Analysten: 1, dann 3. Entscheidung beim User.
  **User: 1 und 3 bauen, beides zurücknehmbar. Gebaut (2026-09-16, `47b29354`, Worker chainband, Bericht
  `tmp/archive-2026-09/fix1/reports/chainband.md`):** (A) Je Station alle begehbaren Wege quer zur Linie; die Kette wählt über alle
  Stationen die Folge mit möglichst wenig Wechseln ohne Überlappung, dann möglichst wenig Metern über `stepRise`, dann
  Abstand zur OSM-Linie (lexikographisch, deterministisch). Stationen ohne Weg werden überbrückt. Die Klemme am Rückgrat
  bleibt. (B) Taper und Ausbuchtungs-Schnitt messen außen am Knick die Kantenlänge um die Ecke, innen und auf geraden
  Stücken wie vorher. Modell (Säulen außerhalb des Snapshots modelliert): Stuttgart 185-194 von 0,0-5,8 auf 2,5-9,8 m,
  Berlin 155-163 auf 8,8-12,8 m, Paris 60-66 auf 9,2-14,0 m. **Zurücknehmen** (geprüft, jeweils ohne Konflikt, Suite
  grün): A `git revert 5b527ec2 d6e679b7 d8c05568 75be147c`, B `git revert 47b29354 d35a753e`. **Risiken:** Tokyo
  verliert im Modell den Durchgang an Station 207/208 (Kette nimmt einen ebenerdigen Weg daneben); einzelne Stellen
  schmaler (Stuttgart 134 5,0 auf 1,8 m, 137, Berlin 29, Shibuya 202-204); alle Fingerprints ändern sich.
  **Nachtest:**
  1. Stuttgart `?l=48.77895,9.17875&s=48.78353,9.17791` kalt, Overlay an, Kurve an der Einmündung: Zellen durchgehend
     über die Fahrbahn, rote Linie ohne Sprünge. Snapshot.
  2. Kalt laden, je Snapshot (der Lead vergleicht Breiten gegen die alten Dateien): Rothenburg
     `?l=49.37721,10.17904&s=49.37944,10.18365`, Berlin `?l=52.51630,13.37759&s=52.51861,13.37529`, Paris
     `?l=48.85889,2.29320&s=48.86239,2.29190`, Tokyo `?l=35.65924,139.70049&s=35.65208,139.69853`, Erlenbach
     `?l=49.17337,9.26851&s=49.17434,9.25915`.
  3. Tokyo gezielt: `band.build ... passages=` (vorher 2) und die gelben Durchgänge zwischen den zwei Knicken: Läuft die
     Linie noch darunter oder daneben, und ist daneben wirklich begehbar?
  4. Rothenburg: Weißer Turm weiter ein Durchgang, keine Zelle auf dem Turm.
  **User (2026-09-16, abends): "Das gesamte Korridorthema ist jetzt mal soweit in Ordnung und vorerst abgenommen."**
  Neue Snapshots nach `47b29354` liegen nicht vor; die Eichwerte aus 747 gelten nach 748 nicht mehr und sind beim
  nächsten Vergleich neu zu nehmen.
- **746 Ladeschritte aufgeräumt (2026-09-16, `78911ecd`, Worker bootclean, Bericht `tmp/archive-2026-09/fix1/reports/bootclean.md`).**
  Überblick wird nach dem Einfrieren auf den fertigen Zellen gerahmt und als Startansicht gespeichert (nicht bei
  HQ-/Spawn-Umzug). Schritt "Waiting for 3D Tiles" gestrichen (10 statt 11 Schritte); beim Ortswechsel läuft das
  Warten auf die ersten Tiles jetzt unter "Placing Headquarters". Tote Reste entfernt. Im Spiel: kein
  `init...IfEnabled` mehr je Tile-Satz, Straßen werden nur gerechnet, wenn Straßen oder Höhen-Marker sichtbar sind.
  `tileSet` hasht nur noch die feinen Tiles (alte Werte gelten nicht). Frühe Zellerzeugung bleibt: kostet laut Logs
  1,7 bis 2,7 ms je Ladung. Nicht im Browser geprüft.
  **Nachtest** (Konsole offen, Filter leer):
  1. Tokyo `?l=35.65924,139.70049&s=35.65208,139.69853`, F5: 10 Schritte, zu jedem Zeitpunkt genau einer aktiv, kein
     "Waiting for 3D Tiles". Nach `[Corridor] build` die Zeile `[Camera] ... corridor.cameraCorrection`. Die Kamera am
     Ende des Ladescreens bzw. nach der Intro-Landung steht sauber über der Route.
     `__corridor.fingerprint()` = `1fc26ab1`, `tileSet` aus `build.tiles` notieren.
  2. Noch einmal F5: Fingerprint `1fc26ab1`, `tileSet` gleich wie in 1.
  3. Erlenbach `?l=49.17337,9.26851&s=49.17556,9.26401` laden, im Spiel "Change location" -> Tab "Showcase" -> "Tokyo,
     Shibuya Crossing": nach "Loading Street Network" dreht sofort "Placing Headquarters". Danach Fingerprint
     `1fc26ab1`, `tileSet` gleich wie in 1. Dann `__corridor.reset()`: Fingerprint und `tileSet` gleich.
  4. Straßen aus (Vorgabe): `__raycastStats()` notieren, zoomen, bis Tiles nachladen, erneut `__raycastStats()`: der
     Posten `streets` wächst nicht. Straßen einschalten: gelbe Linien erscheinen nach kurzer Zeit.
  5. "Route Grid Overlay" an, F5: Overlay erscheint mit dem Ende von "Measuring the Corridor" und ändert sich beim
     Zoomen nicht.

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
  `tmp/archive-2026-09/fix1/reports/detour.md` (Nachtrag 2). **User:** klingt sinnvoll, gewünscht ist aber eine allgemeine Lösung;
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
  (`2acf7db9`, Tabelle in `tmp/archive-2026-09/fix1/reports/oozedeath.md`). **Entscheidung User (2026-09-15): ins Balancing**
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
  100 wäre Herbert unverwundbar (`tmp/archive-2026-09/fix1/reports/immunity.md`). **User:** Bosse brauchen so etwas sicher, offen ist
  was genau und in welchem Umfang; erst besprechen. Grundlage: `tmp/archive-2026-09/fix1/reports/bossresist.md`.
  **Teilentscheidungen User (2026-09-15):** Herbert Slow-Schutz 50 %; Skarnax steht nur still, wenn sein Kopf
  eingefroren oder betäubt ist (Worker skarnax). **User:** Es gibt Immunitäten und Resistenzen, für Effekte und für
  Schadenstypen, dazu eventuell Schild und HP getrennt; erst ein Konzept, nicht heute (TODO 3.3). Nicht mehr vorlegen.
- **Held Stufe 2 (aus E18):** Worker herotier2 fand keine Vorgabe in der Doku und schlug drei Varianten vor
  (`tmp/archive-2026-09/fix1/reports/herotier2.md`). **User (2026-09-15):** offen lassen, erst braucht es den richtigen Tech Tree;
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

## Nachtests aus docs/PLAYTEST.md (2026-09-16)

### K2: Laden, Eichung, Rückfall (744, 746)

URLs: Tokyo `?l=35.65924,139.70049&s=35.65208,139.69853`, Rothenburg `?l=49.37721,10.17904&s=49.37944,10.18365`,
Paris `?l=48.85889,2.29320&s=48.86239,2.29190`.

- **K2.1** Tokyo-URL, F5: 10 Ladeschritte, immer genau einer aktiv, kein "Waiting for 3D Tiles"? Nach `[Corridor]
  build` eine Zeile `[Camera] ... corridor.cameraCorrection`, Kamera nach der Landung über der Route?
  `__corridor.fingerprint()` und `tileSet` aus der Zeile `[CorridorTrace] ... build.tiles` notieren. Zweites F5: beides
  gleich?
- **K2.2** Erlenbach `?l=49.17337,9.26851&s=49.17556,9.26401` laden, Header "Change location", Tab "Showcase", "Tokyo,
  Shibuya Crossing": dreht nach "Loading Street Network" sofort "Placing Headquarters"? Fingerprint und `tileSet` gleich
  K2.1? Dann `__corridor.reset()`, warten auf `[Corridor] Corridor rebuilt`: weiter gleich?
- **K2.3** Rothenburg-URL, F5: keine Zeile `build.fallback what=cells`, in `build.freeze` `cellsWithoutHeight=0` und
  `fallbackMs=0`? Overlay an, am Rathaus `__corridor.pick()` auf die Randreihe vor dem Laubengang: `state: 'filled'`?
  Paris-URL, F5: `build.fallback what=stations` mit 4 gefunden, keine Zeile `what=cells`?
- **K2.4** Straßen aus (Vorgabe), `__raycastStats()` notieren, zoomen, bis Tiles nachladen, erneut: wächst `streets`
  nicht? Layers "Show streets" an: erscheinen gelbe Linien? "Route Grid Overlay" an, F5: erscheint das Overlay mit dem
  Ende von "Measuring the Corridor" und bleibt beim Zoomen gleich?

**K2.1 bis K2.4 ok (2026-09-16).** Werte der Eichtabelle nicht notiert.

### K3: Assets nach Runde 22 (734, 735, 736, E18)

Beliebiger Ort, Ton an, Cheat "Credits".

- **K3.1** Custom Wave "Skarnax", Count 1, Kamera an den Kopf: knurrt er ab und zu unregelmäßig statt in gleichmäßiger
  Schleife?
  **ok (2026-09-16)**
- **K3.2** Gleiche Welle, nah heran: Chitin-Textur, Beine bewegen sich mit dem Boden, Kiefer am Kopf, Schwanzstück am
  letzten Ring? Ein Archer an die Wurmmitte: trägt nach dem Zerfall jedes Teil Kopf und Schwanz?
  **ok (2026-09-16)**
- **K3.3** Enemy Debug, Tank setzen und starten: Tarnanstrich, abgewetzte Kanten, Staub? Vorschau in der Sidebar ganz
  im Bild?
  **Modell ok (2026-09-16). Befund:** In der Sidebar-Vorschau ist der Panzer nicht zu erkennen und lässt sich nicht
  einstellen, nachrangig (TODO C11).
- **K3.4** Archer wählen, die Bauvorschau so an eine Hochhauskante, dass sie übersteht: gestufte Kragsteine statt
  dünner Streben? Bauen: Kragsteine an der Fassade? Mitte eines Flachdachs: keine? Tower wählen, zweimal Sell:
  Kragsteine weg?
  **Kragsteine ok (2026-09-16), gutes Beispiel: Sockel rund 3 m, Achse über dem Dach, Kragsteine darunter. Befund
  (TODO C10):** An gestuften Gebäuden hängt der Sockel oft 10 bis 20 m an der Fassade herab und endet in der Luft, wo
  früh Kragsteine abschließen sollten. Ein Tower an der Kante kann mit der Achse fast über der Straße stehen, dann
  hängt ein langer Sockel ohne Kragsteine vor der Fassade. Ein Tower lässt sich zur Hälfte in eine höhere Wand bauen.

### K4: Sockel an Kanten und Wänden (C10, `0889daa0`)

Archer, Cheat "Credits". Vorschau jeweils kurz ruhig halten, dann erst urteilen. Bilder aus K3.4 als Vorlage.

- **K4.1** Gestuftes Gebäude, Stelle aus Bild 12: Vorschau so an die Kante, dass nur der Rand übersteht. Grün, Sockel
  höchstens etwa 3 m (oft nur eine flache Platte), Kragsteine an der Fassade, nichts hängt bis zur tieferen Stufe?
  Bauen: sieht der Tower aus wie die Vorschau?
- **K4.2** Gleiche Stelle, Vorschau 1 bis 2 m weiter über die Kante: rot mit "Too far over the edge", Klick baut
  nichts?
- **K4.3** Tokyo, gerade Hochhauskante mit flachem Dach (wie Bild 10): nur der Rand steht über. Platte mit Kragsteinen
  darunter? Flimmert die Oberseite der Platte mit dem Dach?
- **K4.4** Stelle aus Bild 13, Tower an die höhere Fassade schieben: rot mit "Not enough room", sobald er etwa
  ein Viertel in der Wand steckt, grün, solange nur der Rand streift? Danach neben eine Baumkrone: wird es dort zu oft
  rot?

**K4.1 bis K4.4 ok (2026-09-16).** Vom User abgenommen ("passt so mal vorerst").

### K5: Gegner an Knicken (C12, Bögen über Knick-Gruppen)

Gegner laufen um Ecken jetzt auf einem Bogen statt am Waypoint seitlich zu springen, die Formation bleibt (außen
schneller, innen langsamer). Wave Debug: "T", Developer options, "Waves".

- **K5.1** Stuttgart `?l=48.77895,9.17875&s=48.78353,9.17791`, Wave Debug "Single", Type Zombie, Count 100, "Start
  Custom Wave". Die Rechtskurve aus Bild 19 (A nach B): läuft die Außenbahn einen weiten Bogen ohne Sprung und ohne
  hektischen Schwenk?
- **K5.2** Dieselbe Welle, die Kurve aus vielen kleinen Knicken kurz nach dem Spawn: ein ruhiger Bogen statt vieler
  kleiner Schwenks?
- **K5.3** Rothenburg `?l=49.37721,10.17904&s=49.37944,10.18365`, dieselbe Welle, enge Gasse: laufen die Gegner an
  Knicken ohne Platz auf der Mittellinie, ohne seitlichen Sprung? (Die Blickrichtung darf dort am Knick umspringen.)
- **K5.4** Beim Laden eines der Orte: ruckelt der Ladescreen gegen Ende des Korridor-Baus sichtbar? (Die Bögen werden
  dort in Zeitscheiben gebaut.)

**K5.1 bis K5.4 ok (2026-09-17).** Vom User abgenommen ("abgenommen und für gut befunden").

### K6: Endstück zum HQ (C13)

Das letzte Stück zum HQ trägt die Straßenhöhe weiter: im Gebäude ebenerdig statt auf dem Dach. F5 kalt laden,
Layers "Route Grid Overlay" an, Custom Wave wie K5 mit Count 5, Kamera an den HQ-Marker.

- **K6.1** Audi NSU `?l=49.19489,9.22041&s=49.18659,9.22281`: Zellen des Endstücks mit blauer Kontur auf Straßenhöhe,
  keine auf dem Hallendach (vorher Bild 20)? Rote Linie flach zur Fassade? Gegner laufen ebenerdig hinein, keiner
  erscheint auf dem Dach?
- **K6.2** Erlenbach BBH `?l=49.17337,9.26851&s=49.17434,9.25915`: keine Zellen auf dem Schuldach, rote Linie nicht mehr
  schräg die Fassade hinauf (vorher Bild 21), Gegner ebenerdig hinein?
- **K6.3** Berlin Pariser Platz `?l=52.51630,13.37759&s=52.51861,13.37529` (HQ auf freier Fläche): Endstück blau,
  Zellen und Gegner auf dem Pflaster wie bisher, kein Höhensprung am HQ?

**K6.1 bis K6.3 ok (2026-09-17).** Vom User abgenommen ("abgenommen und für gut befunden").

### K7: Raketensilo

Stand `next` @ `11de208a`. Per Test verifiziert, hier nicht zu klicken: Knopf und Taste K nur mit Silo, Hinweis "Build a
Missile Silo first", nur ein Silo, Einschlag auf Sub-Step 390, Rakete im Silo weg ab dem Befehl und wieder da nach dem
Nachladen (3 Wellen), neu gebautes Silo mit richtigem Zustand, Zielmodus endet beim Verkauf, Bot baut und hält vor.

**Aufbau (für alle Punkte):** Tokyo kalt laden (`l=35.65924,139.70049&s=35.65208,139.69853`). Developer options, unter
"Cheats" zweimal "Credits", dann "Abilities". Research Center ist nicht nötig. In der Build-Leiste die Karte "Missile
Silo" (Stufe 3), neben die Route setzen, vorher R kurz gedrückt halten (dreht die Vorschau). Wave Debug, "Single",
Zombie, Count 30, "Start Custom Wave". Nach jedem Schuss für den nächsten Punkt wieder "Abilities" drücken (füllt die Ladung auf).

#### Paket A: Start und Flug

- **K7.1 Silo im Spiel.** Kamera nah ans Silo. Erwartet: 14 m breit, steht auf dem Boden (oder Plinth), keine Löcher
  in den Wänden, die Rakete steht im offenen Schacht. Die Vorschau auf der Build-Karte ist etwa so groß wie die des
  Research Center.
- **K7.2 Start aus der Nähe.** Kamera unter 80 m vom Silo, K, Klick auf die Route. Erwartet: die Rakete im Silo ist im
  Moment des Klicks weg und die fliegende hebt genau dort mit derselben Drehung ab, kein Sprung, keine doppelte
  Rakete. Blitz über dem Schacht, Feuer und Rauch quellen heraus und rollen am Boden aus, leichter Shake.
- **K7.3 Flug aus der Übersicht.** Übersichtskamera, K, Klick auf die Route etwa 500 m vom Silo. Erwartet: langsames
  Abheben, immer schneller, hoher Bogen, fast senkrechter Sturz, Einschlag genau mit dem Atompilz. Rakete aus der
  Übersicht erkennbar, Rauchspur steht 10 bis 15 s. Wirkt es imposant?
- **K7.4 Ton.** Bei 1x nah am Silo: Zündknall und Tosen, das Triebwerk wandert mit der Rakete, am Ziel etwa 2,5 s ein
  fallendes Pfeifen, das der Knall abschneidet. Lautstärke gegen Sirene und Knall stimmig?

#### Paket B: Grenzfälle

- **K7.5 Kurze und weite Ziele.** Ziel unter 50 m vom Silo, dann eins über 1000 m. Erwartet: nah steigt sie hoch und
  dreht sauber über den Scheitel, weit ist der Bogen hoch genug und nichts schneidet durch Gebäude.
- **K7.6 Effekte Low.** Quick Actions, "Display" (Auge), unter "Effects" "Low", K, Klick. Erwartet: Rakete, Flamme und
  Blitz da, weniger und größere Rauchpuffs, kein Feuer aus dem Schacht. Konsole ohne `Shader Error`.
- **K7.7 Verkauf im Flug.** K, Klick, sofort das Silo anklicken und zweimal auf den Verkaufsknopf. Erwartet: die Rakete
  fliegt weiter und landet, Textur der fliegenden Rakete bleibt korrekt (nicht schwarz, nicht weiß).
- **K7.8 Spielgefühl.** Ein paar Schüsse auf laufende Gruppen. Ist das Vorhalten über 6,5 s spielbar, oder braucht es
  eine Zielhilfe?

**K7.1 bis K7.8 ok (2026-09-17).** Vom User abgenommen ("Alles gut. Abgenommen.").

## Nachtests aus docs/PLAYTEST.md (2026-09-19)

### K8: Desktop-Build (Branch `electron`, als v0.3.1 veröffentlicht)

Installer aus dem Release-Entwurf v0.3.1. K8.4 (Hybrid-Laptop, optional) bleibt in `docs/PLAYTEST.md`.

- **K8.1 SmartScreen:** den Installer aus dem ersten Release-Entwurf auf GitHub herunterladen (nicht den lokalen, der
  trägt keine Download-Markierung) und starten. Erwartung: "Der Computer wurde durch Windows geschützt", unter
  "Weitere Informationen" der Knopf "Trotzdem ausführen", danach Installation ohne Admin-Abfrage.
  **ok (2026-09-19)**, SmartScreen kam, Installation klappt (Installer aus dem Entwurf v0.3.1).
- **K8.2 Eine Partie in der installierten App:** Ort laden, Tower setzen, zwei Wellen. F12, Konsole: keine Zeile mit
  "Content Security Policy". Danach Ctrl+Shift+L, `main.log` öffnen: dein Token kommt darin nicht vor.
  **ok (2026-09-19)**, mit Installation per Doppelklick, Update auf 0.3.1 über den lokalen Feed und Deinstallation.
- **K8.3 Kleines Fenster:** das Fenster auf die Mindestgröße ziehen (1024 × 600). Erwartung: Sidebar, Header und
  Schnellaktionen bleiben bedienbar, nichts überlappt so, dass ein Knopf nicht mehr erreichbar ist.
  **ok (2026-09-19)**
- **K8.5 What's new** (mit K8.1, derselbe Installer): einen Ort laden. Erwartung: unten in der Sidebar steht `v0.3.1`.
  Hat das Profil schon einen Token, öffnet sich nach dem Laden einmal "What's new" mit 0.3.1, und nach einem Neustart
  der App nicht noch einmal. Klick auf `v0.3.1` öffnet es jederzeit. Text und Aussehen prüfen (E45).
  **ok (2026-09-19)**: Sidebar passt, der Dialog kam, "Full changelog" öffnet GitHub (404, bis `CHANGELOG.md` auf `main` liegt).
  Seit dem ff-Merge liegt `CHANGELOG.md` auf `main`, der Link geht (per `gh api` geprüft, 2026-09-19).

**K8.1, K8.2, K8.3 und K8.5 ok (2026-09-19).**

## N Wellenquellen und Geist-Fix (2026-09-22)

Code-Stand `next` ab `00efe481`. Auf der Standardquelle "adaptive" soll sich nichts anders anfühlen. Ob der
Umbau dieselben Wellen liefert, prüfen Referenz- und Contract-Specs. Hier geht es nur darum, ob die Anzeige
stimmt und die Türme sich richtig verhalten. Vor dem Test fiel NG0201 auf (RunLogFacade injizierte den
komponentengebundenen WaveDirector), behoben samt Wächter `integration/injector-scope.spec.ts`. N1 und N4 gehen in einem Lauf. N2 und N3 gehen in einem
zweiten, mit den Sprüngen in dieser Reihenfolge: 33, 35, 43, 45.

- **N1 Kein Turm schießt ins HQ**: Ort laden, einen einzelnen Turm direkt neben das HQ stellen. Im Wave Debug
  "Single" wählen, einen schnellen Gegner (Rat) mit Count 40 einstellen und "Start Custom Wave" drücken, damit
  einige durchkommen. Danach normal die nächste Welle starten. Erwartung: Kein Mündungsfeuer und keine Geschosse
  zur Stelle am HQ, sobald dort nichts mehr steht. Der Turm nimmt den ersten Gegner der neuen Welle ins Visier.
  **ok (2026-09-23)**
- **N2 Boss-Wellen nach Sprung**: Im Wave Debug unter "Jump to wave" 35 eintragen und springen, die Welle
  starten. Erwartung: "Boss: Skarnax", der Wurm kommt. Danach auf 45 springen und starten. Erwartung:
  "Boss: Ooze", ein einzelner großer Schleim.
  **ok (2026-09-23)**
- **N3 NEXT-Leiste** (zeigt fünf Wellen voraus): Im WAVE-Panel die Zeitleiste "NEXT" ansehen, einmal bei Welle 1
  bis 5, dann nach "Jump to wave" 33 und nach "Jump to wave" 43. Erwartung: Marken, Namen und
  Tooltips wie gewohnt; bei 33 steht W35 als Skarnax, bei 43 steht W45 als Ooze, nicht als der normale Boss.
  Keine leere Zeile, kein "undefined".
  **ok (2026-09-23)**
- **N4 Bot-Fenster "Gate ×"**: Developer options, Kachel "Bots". Erwartung: Vor der ersten Welle steht bei
  "Gate ×" ein Strich, spätestens nach dem Start der ersten Welle eine Zahl wie 1.00.
  **ok (2026-09-23)**

**N1 bis N4 ok (2026-09-23).**

## O Sidebar und Dialoge (2026-09-23)

Aus dem Playtest von L1/L2 und zwei Wünschen am Rand. Alles in einem Lauf.

- **O1 Knopf zum Forschungsbaum**: Research Center bauen. Erwartung: Im Header neben dem Würfel ist kein Knopf
  mehr. Unter dem Turmraster im BUILD-Panel steht "Research tree" mit goldenem Symbol, fest am unteren Rand der
  Sektion, er scrollt nicht mit. Mit vorgemerkten Forschungen steht die Zahl rechts darin. Klick oder `Q` öffnet
  den Baum.
  **ok (2026-09-23)**
- **O2 Erforschte Knoten**: eine Forschung abschließen, Baum öffnen. Erwartung: Der Knoten hat eine grüne Kante
  links, einen grünen Haken, einen hellen Titel und "RESEARCHED" in Grün. Die Linie zum nächsten Knoten ist grün,
  Legende und Zählung oben ebenso. Laufend bleibt teal, offen gold.
  **ok (2026-09-23)**
- **O3 Fußleiste der Sidebar**: Erwartung: sechs Knöpfe in zwei Reihen zu drei, alle Namen voll lesbar (World,
  Tips, Keys, Map Key, Runs, Attributions), und jeder zeigt beim Überfahren einen Tooltip.
  **ok (2026-09-23)**. Befund: die Warnzeile ("Too close to route") schob den Hinweis-Kasten in die LOS-Legende.
  Behoben: Legende, Hinweis und "Skip intro" stapeln sich jetzt in einer Spalte (`.td-bottom-stack`), Nachtest O7.
- **O4 Runs-Dialog**: Fußleiste, "Runs". Erwartung: Rahmen wie bei Attributions, oben rechts "n / 20". Je Zeile
  links groß die erreichte Welle, daneben Ort und darunter Datum und "YOU" oder "BOT …". DevWorld-Läufe heißen
  "DevWorld" statt "0.0000, 0.0000". Rechts zwei Symbolknöpfe (Speichern, Löschen) mit Tooltip. Unten links
  "Delete all": Erst fragt die Fußleiste nach ("Delete all n runs?"), "Cancel" bricht ab, "Delete all" leert die
  Liste.
  **ok (2026-09-23)**
- **O5 Steuerungs-Hinweis beim Start**: Ort kalt laden. Erwartung: Die Tasten erscheinen unten in der Mitte im
  Hinweis-Kasten, nicht mehr unten links über "Google Maps" und der Cesium-Zeile. Maustasten als Maus-Symbol mit
  gefüllter Taste (links Pan, rechts Rotate, Rad Zoom), dazu WASD und H. "Got it" blendet ihn aus, sonst nach
  15 s. Im Build-Modus zeigt "Click" jetzt ebenfalls die Maus.
  **ok (2026-09-23)**
- **O6 Mitte ist die Spielfeld-Mitte**: Ort kalt laden, danach einen Tower wählen (Build-Modus) und über einen
  Tower fahren. Erwartung: "Skip intro", der Steuerungs-Hinweis, die Build-Hinweise und die LOS-Legende stehen
  mittig über der Karte, nicht über der Seitenmitte (also nicht nach rechts zur Sidebar verschoben). Der
  Steuerungs-Hinweis kommt erst nach dem Intro-Flug, nicht darunter. Der Ladebildschirm ist schon mittig zur Karte.
  **ok (2026-09-23)**
- **O7 Legende und Hinweis stapeln sich**: Tower wählen, an eine Stelle zu nah an der Route fahren, sodass
  "TOO CLOSE TO ROUTE" erscheint. Erwartung: Die LOS-Legende rückt über den höheren Kasten, nichts überdeckt sich.
  Ohne Warnung sitzt sie wie bisher knapp darüber.
  **ok (2026-09-23)**

**O1 bis O7 ok (2026-09-23).**

## P Spawn-Namen (2026-09-23)

- **P1 Ein Name je Stelle**: Ort laden und "Set spawn" auf eine Straße setzen, danach F5, danach über den
  Standort-Dialog wieder denselben Ort. Erwartung: Über dem Portal steht jedes Mal derselbe Straßenname, nie
  "Spawn 1" oder "Fallback Spawn". Auf einem Weg ohne Namen steht der Name der nächsten benannten Straße bis etwa
  150 m, sonst "Spawn". In DevWorld bleibt es bei den DevWorld-Namen.
  **ok (2026-09-23)**

## L Forschung und die Sitzung vom 2026-09-21

Alles hier ist gebaut, gemessen und durch das Gate; was fehlt, sind Augen im Spiel. Reihenfolge egal,
L1 bis L4 gehen in einem Lauf.

- **L1 Forschungsbaum als Dialog** (G3): Research Center bauen, anklicken, im Panel "Research tree", oder Taste
  `Q`, oder den Knopf im Header neben dem Würfel. Erwartung: Vollbild, drei Wurzeln oben (Gatling, Ice Magic,
  Biology), Tier-Marken links auf Höhe ihrer Reihe, unten Legende und die Zählung je Strang. Ziehen mit der Maus
  verschiebt den Graphen, ein Klick auf einen offenen Knoten startet ihn trotzdem.
  **ok (2026-09-23)**. Befund: der Header-Knopf passt nicht zu seinen Nachbarn (Ort, Würfel, HQ). Umgezogen, Nachtest O1.
- **L2 Zustände am Knoten**: eine Forschung starten und eine zweite anklicken, während der Slot belegt ist.
  Erwartung: die laufende teal mit Balken und Restzeit, die zweite gestrichelt gold mit Nummer in der Ecke, die
  Warteschlange rechts mit derselben Reihenfolge. Credits unter den Preis bringen (nichts kaufen, warten):
  offene Knoten färben sich orange (`poor`), der Detailknopf sagt, wie viel fehlt.
  **ok (2026-09-23)**. Befund: erforschte Knoten optisch deutlicher absetzen. Umgebaut, Nachtest O2.
- **L3 Kette und Detail**: mit dem Zeiger auf einen tiefen Knoten (etwa Transcendent Tech). Erwartung: der Weg
  bis zur Wurzel leuchtet gold, alles andere blendet ab, und rechts steht Zustand, Wirkung, Kosten, Zeit und die
  Vorbedingungen mit Haken.
  **ok (2026-09-23)**
- **L4 Warteschlange umsortieren**: zwei Forschungen vormerken, im rechten Panel die Pfeile benutzen. Erwartung:
  die Reihenfolge ändert sich, nichts wird abgebucht, und die frei werdende Slot nimmt den, der oben steht.
  **ok (2026-09-23)**
- **L5 Biology-Tor**: am Anfang stehen nur Gatling Technology, Ice Magic und Biology offen. Tentacle und Toxic
  öffnen sich erst, wenn Biology fertig ist (120, 8 s).
  **ok (2026-09-23)**
- **L6 Raketen-Pfad** (Form B): `aa-retrofit` hängt jetzt direkt an `gatling-tech`, `rocketry` unter
  `siege-engineering`. Erwartung im Spiel: die Flugabwehr fürs Gatling ist ab 850 erreichbar, die Rakete kostet
  1500 und liegt beim Drachen in W12, nicht bei den Fledermäusen in W7. Ob die Rakete damit stark genug ist, ist
  **nicht** geprüft, das ist ein eigener Punkt in TODO.md.
  **ok (2026-09-23)**
- **L7 Panel des Research Centers**: Center anklicken, ohne dass etwas läuft. Erwartung: "n/21 researched",
  Slots, eine Zeile wie "5 researches are open right now", darunter der goldene Knopf. Läuft etwas, steht dort
  die laufende Forschung mit Balken und Abbrechen.
  **ok (2026-09-23)**
- **L8 Schaden je Gold je Typ** (E10): einen Lauf spielen, zwei Tower-Typen bauen, einen zweimal aufrüsten, Lauf
  exportieren. Erwartung: `"format":2` im Kopf, `"towerSpending":{...}` in jeder Wellenzeile, und die Summe
  darin gleich `spending.build + spending.upgrade` derselben Zeile.
  **ok (2026-09-23)**: Kopf zeigt `"format":3`, richtig: seit `26100153` (2026-09-22) ist es 3, der Punkt war älter. W1 `towerSpending` 481 = build + upgrade 481.
- **L9 Kein Kill zu viel** (E11): Devworld, einen Archer ans HQ-Ende der Route, Welle laufen lassen, bis ein
  Gegner durchkommt. Erwartung: das HQ nimmt einmal Schaden, der Tower bekommt dafür keinen Kill, und im
  Wellenblock steht kein `bodies:`-Eintrag unter `mismatches`.
  **ok (2026-09-23)**: W1 14 geleckt, kein `mismatches` in der Wellenzeile (`tmp/runs/3dtd-run-2026-09-23T07-42-07-418Z-devworld.jsonl`).
- **L10 Straßensuche nach Ortswechsel** (H14): Ort laden, Spawn setzen, dann über den Standort-Dialog in eine
  andere Stadt wechseln und wieder einen Spawn setzen. Erwartung: das Portal sitzt an einer Straße der **neuen**
  Stadt, nicht an einer der alten (der Raumindex wird je Netz neu gebaut).
  **ok (2026-09-23)**. Frage: warum mal "Spawn", mal ein Straßenname über dem Portal (siehe Antwort im Chat, noch keine Arbeit).
- **L11 Nur für Screenreader** (H9, optional): die Dev-Kacheln der Quick Actions melden jetzt ihren Zustand
  (`aria-pressed`). Optisch ändert sich nichts, also nur zu prüfen, wenn du magst.
  **ausgelassen (2026-09-23)**, der User hält es für unnötig.

**L1 bis L10 ok, L11 ausgelassen (2026-09-23).**

## T Tower bemannen (2026-09-23)

Neu: in einen Tower steigen und selbst feuern ([TOWER_CONTROL.md](../TOWER_CONTROL.md)). Die Regeln (Feuerrate,
Reichweite, Sichtlinie, Fehlschuss, Kill-Credit) prüft ein Szenario-Test; hier geht es um Gefühl, Bild und Ton.
Ort egal, etwas Credits über "Credits" in den Developer options.

- **T1 Einsteigen**: Dual Gatling bauen, anklicken, `C` (oder der Gamepad-Knopf in der Zielwahl-Zeile). Erwartung:
  Sidebar weg, Header und FPS-Anzeige bleiben, Blick aus dem Tower über die Rohre, Fadenkreuz in der Mitte, Maus gefangen. Unten eine
  Zeile mit "DUAL GATLING", dann die Tastenkappen LMB fire, RMB zoom, Esc get out.
- **T2 Zielen und Feuern**: Welle starten, Maus bewegen, linke Taste halten. Erwartung: Turm und Rohre folgen dem
  Blick mit kurzer Verzögerung, Fadenkreuz wird gold auf einem Gegner, Schüsse im Takt des Towers, weißes Kreuz und
  Tick bei Treffer, rotes Kreuz und Doppel-Tick beim Kill. Daneben: Mündungsfeuer und Sound, kein Treffer.
  **Befund (2026-09-23)**: Geschütz nimmt vor allem beim Blick nach unten zu viel Bild ein; Zoom beim Feuern
  rastet mal ein, mal nicht; zwischen den Wellen kein Feuer; FPS weg. **Nachtest**: Blick steil nach unten zeigt
  die Straße, nicht den Turm; RMB bei gehaltenem LMB zoomt jedes Mal und umgekehrt; zwischen den Wellen feuert
  er; FPS oben links bleibt. **Befund**: Rang-Abzeichen des eigenen Towers im Bild. **Nachtest**: Tower mit Rang
  bemannen, sein Abzeichen ist weg, die der anderen Tower bleiben; nach dem Aussteigen ist es wieder da.
  **Befund**: Auswahl-Ring der Cannon im Bild. **Nachtest**: Maus auf den Tower, anklicken, `C`: kein Ring, keine
  Reichweite im Bild. **Befund**: Reward-Sound (Kill-Gold) drinnen viel lauter. **Nachtest**: im Tower Gegner
  töten, der Coin klingt etwa so laut wie in der Draufsicht, Schüsse und Einschläge bleiben nah.
- **T3 Befund (2026-09-23)**: Archer: Blick im Inneren des Turms. **Nachtest**: Archer bemannen, Blick über dem Dach,
  kein Innenraum; die anderen Tower wie vorher (höchstens etwas höher).
- **T5 Freies Feuern (2026-09-23)**: Befund: zwischen den Wellen keine Projektile zu sehen. Nachtest: zwischen den
  Wellen und in der Welle in alle Richtungen und steil nach oben feuern. Erwartung: die Projektile fliegen durchs
  Fadenkreuz davon und verschwinden in Reichweite; ein Fehlschuss neben einem Gegner zieht ihm nichts ab, Treffer
  wie vorher.
- **T6 Schuss-Klang nach oben (2026-09-23)**: Befund: nach oben gefeuert klingen die Schüsse anders (HRTF, Quelle
  hinter dem Kopf). Nachtest: waagerecht, steil nach oben und nach unten feuern, der Schuss klingt überall gleich.
- **T3 Augenpunkt je Tower**: Archer, Cannon, Magic, Rocket, Ice, Poison, Chaos je einmal. Erwartung: Blick sitzt
  nicht im Modell und nicht absurd hoch. Welcher Tower schlecht sitzt, bitte nennen (der Augenpunkt ist für alle
  gleich).
- **T4 Aussteigen**: `Esc`, dann erneut rein und `C`. Erwartung: beide Male Kamera zurück, wo sie beim Einsteigen
  war, der Tower feuert wieder selbst. Photo Mode (`O`) und Fähigkeiten wirken drinnen nicht.

**T1 bis T6 ok (2026-09-23).**

## S Vor dem Release (2026-09-24)

- **S1 Signale zur Musik**: Wellen bei 1x und bei 4x starten und beenden. Erwartung: Erst blendet die Musik aus,
  dann kommt das Start-Signal oder das Horn in die Stille, danach die neue Musik. Bei 4x kommt das Signal, bevor die
  ersten Gegner weit gelaufen sind. Der Anfang der Signale klingt nicht mehr abgeschnitten.
  **ok (2026-09-24)**
- **S2 Bauen vor oder nach dem Start**: Neues Spiel, vor Welle 1 viele Tower bauen, Welle 1 starten, Anzahl der
  Gegner im WAVE-Panel merken. Neues Spiel am selben Ort, Welle 1 sofort starten, dann dieselben Tower bauen.
  Erwartung: dieselbe Anzahl. Ebenso ab Welle 2: Was in der Pause gebaut wird, macht die kommende Welle nicht größer.
  **ok (2026-09-24)**

**S1 und S2 ok (2026-09-24), am 2026-09-25 hierher verschoben.**

## Nachtests M, Q, R, T, erledigt oder überholt (archiviert 2026-09-26)

### M Druck-Regler und HP-Budget (2026-09-22)

- **M1 Die HP-Zahl**: Der Spieler startet jetzt mit **500 HP** statt 100, ein durchgekommener Gegner kostet 1
  (bis W30), 2 (bis W60), 3 (bis W90). Erwartung: Die Anzeige bleibt lesbar, der Balken fühlt sich nicht
  belanglos an, und ein einzelner Durchbruch tut weh, ohne den Lauf zu entscheiden. Wenn 500 als Zahl komisch
  wirkt: Es geht nur um die Auflösung, jede andere Zahl mit demselben Verhältnis täte es auch.
  **ok (2026-09-23)**
- **M2 Keine toten Strecken**: Über die Wellen 10 bis 30 mitzählen, wie viele gar nichts kosten. Erwartung:
  keine lange Serie mehr, in der man nur zusieht. Vorher waren es im Schnitt elf Wellen am Stück.
  **Befund (2026-09-23, New York, bis W34)**: W18 bis W29 zwölf Wellen ohne jeden HP-Verlust. Folge von M3: bei 19 HP
  kann der Regler nicht mehr messen (ein Leck sind 5 %, sein Band 1,2 bis 3,7 %).
- **M3 Keine Wand**: Erwartung: Der Lauf endet nicht an einer einzelnen Welle, die plötzlich alles mitnimmt,
  sondern weil es über mehrere Wellen enger wird. Wenn doch eine Welle heraussticht, ihren Namen notieren.
  **Befund (2026-09-23)**, behoben, Nachtest Q1: W15 Golem Squad, 489 Golems, 387 durch, 438 → 51 HP (88 %). Ursache im Code: die
  Anzahl über der Template-Obergrenze (`count × Multiplikator`, `wave-config-builder.ts:211`) wird nicht am
  Überlebbarkeits-Deckel begrenzt. Deckel 221, geschickt 489 bei ×8,15, dazu HP-Hebel ×2,85. Der Regler öffnete
  von W10 bis W15 je Welle um ×1,42, obwohl die Wellen 0,9 bis 1,5 % kosteten, knapp unter dem Band.
- **M5 Nach einem Ortswechsel**: Der Regler ist Zustand pro Lauf. Erwartung: Ein neues Spiel startet wieder bei
  ×1,00, also mit normal großen Anfangswellen, egal wie der Lauf davor lief.
  Vor dem Test gefunden (2026-09-23): Ein Ortswechsel setzte den Director gar nicht zurück, nur der
  Neustart-Knopf. Behoben, der Director hängt jetzt an `game:reset`.
  **ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** sieben Wellen ohne HP-Verlust öffnen den Regler auf ×1,42 (die ersten vier zählt er nicht,
  `PRESSURE_WARMUP_WAVES`); nach dem Würfeln (Essen) steht die erste Welle bei „still collecting (0 of 3 waves), at
  ×1.00“ (`extras.mjs`).

### Q Balance-Runde nach dem New-York-Lauf (2026-09-23)

- **Q2 Ein Herbert in W10**: Erwartung: genau ein Herbert, dazu Tanks und Zombies.
  **ok (2026-09-23)**
- **Q3 Bosse der Kampagne**: W20 der Ooze, W30 Skarnax (per "Jump to wave" 20 und 30 prüfbar). Erwartung:
  beide schaffbar, aber spürbar. Ihre HP entsprechen der Welle, die der Director dort geplant hätte.
  **ok (2026-09-23)**
- **Q5 Alt**: Option "Health Bars" aus, Alt halten: Balken erscheinen, loslassen: weg. Option an: Alt blendet
  sie aus. Danach tippt die nächste Taste ins Spiel, nicht in die Menüleiste des Browsers.
  **ok (2026-09-23)**

### R Replay als Neu-Simulation und Determinismus (2026-09-24, Branch `simulator`)

- **R1 Abspielen**: Nach einer Welle "replay W3" unter dem Wellen-Knopf. Erwartung: Die Welle läuft wie gespielt,
  mit Schadenszahlen, Gold, Sounds, Upgrades zur richtigen Zeit. In der Leiste steht **kein** "differs from".
  **ok (2026-09-24)**
- **R2 Springen**: Im Fortschrittsbalken nach vorn und zurück ziehen. Erwartung: Nach dem Loslassen steht das Feld
  sofort richtig da (höchstens etwa eine Sekunde Warten), kein Knall von hundert Sounds auf einmal.
  **Befund (2026-09-24)**: Springen selbst ok, aber durch mehrfaches Hin und Her ließen sich die Effekte der
  Fähigkeiten (Orbital-Laser) mehrfach auf den Schirm bringen. Behoben: das Replay räumt beim Betreten, Verlassen und
  Springen alle Schlag-Effekte ab (`clearStrikeEffects`). Nachtest **ok (2026-09-24)**.
- **R3 Wellen wechseln**: In der Leiste die Pfeile neben "Wave 3". Erwartung: Welle 2 und 1 spielen ebenso.
  **Befund (2026-09-24)**: Wechsel klappt, aber Tower aus Welle 3 standen auch in Welle 2 und 1 (ohne
  mitzukämpfen). Die Snapshots waren richtig (Replay-Datei geprüft: 2, 4, 5 Tower); Modelle, die erst nach dem
  Entfernen ihres Towers fertig luden, blieben verwaist stehen. Behoben im Tower-Renderer. Nachtest **ok (2026-09-24)**.
- **R4 Zurück ins Spiel**: Esc. Erwartung: Tower, Credits, HP, Forschung, Held, Kamera wie vorher; die nächste Welle
  startet normal; das HUD zeigt dieselben Zahlen wie vor dem Replay.
  **ok (2026-09-24)**
- **R2b Nach dem Springen**: Während Feuer-Tower brennen, Gegner eingefroren oder vergiftet sind, hin und her
  springen. Erwartung: Die Glut in den Feuer-Towern bleibt, Frost- und Giftauren sind da, das HQ-Feuer (unter 50 % HP)
  brennt, kein Glöckchen beim Zurückspringen über eine Fähigkeit.
  **ok (2026-09-24)**
- **R4b Nach dem Verlassen**: Mitten in der Welle Esc. Erwartung: Aufbau-Musik statt Wellenmusik, kein roter Himmel
  nach einer Blutmondwelle, ein Tower auf Feuerpause ist grau mit Pausenzeichen, Reichweitenringe nach
  Reichweiten-Upgrade stimmen, kein Grollen eines Atomschlags aus dem Replay.
  **ok (2026-09-24)**
- **R5 Speichern und Laden**: Im Replay "Save". Seite neu laden (F5), denselben Ort, dann "load" im WAVE-Panel und die
  Datei wählen. Erwartung: Das Replay läuft, in der Leiste "from file", kein "differs from".
  **ok (2026-09-24)**
- **R6 Andere Karte**: Einen anderen Ort laden, dieselbe Datei laden. Erwartung: Unter den Knöpfen steht, dass das
  Replay auf einer anderen Karte gespielt wurde; nichts startet.
  **ok (2026-09-24)**
- **R7 Game Over**: Einen Lauf verlieren, "Replay wave N" auf dem Game-Over-Screen. Erwartung: Die letzte Welle bis
  zum Fall des HQ; Esc führt zurück auf den Game-Over-Screen.
  **ok (2026-09-24)**
- **R9 Turrets**: Einen Cannon bauen, während sein Modell noch lädt. Erwartung: Er schießt erst, wenn der Turm zum
  Ziel gedreht ist (vorher schoss er in dieser Zeit sofort).
  **ok (2026-09-24)**
- **R10 Reichweitenrand**: Mit "Route Grid Overlay" einen Tower wählen. Erwartung: Die Sichtzellen reichen bis an den
  Rand des Reichweitenkreises; der Tower schießt auf Gegner am Rand wie bisher.
  **ok (2026-09-24)**
- **R11 Luft nach Forschung**: AA-Retrofit erforschen, während Fledermäuse laufen. Erwartung: Die Dual Gatling nimmt
  sie nach kurzer Zeit ins Ziel.
  **ok (2026-09-24)**
- **R12 Bemannter Tower**: Einen Archer bemannen (C), zielen, schießen, danach ein Replay dieser Welle. Erwartung:
  Die Schüsse im Replay gehen dorthin, wohin gezielt wurde.
  **ok (2026-09-24)**

### T Coop: Tower bemannen, Spieler-Leiste, Gold, Lobby (2026-09-24, Branch `coop`)

- **T1 Tower bemannen (C19)**: Im Spiel einen eigenen Archer-Tower wählen, im Tower-Panel den Gamepad-Knopf („Get in and fire it yourself“) oder Taste C.
  Erwartung: Die Kamera springt in den Tower, die Maus ist gefangen, Zielen folgt der Maus ohne Ruckeln, linke Taste
  schießt, rechte zoomt, C oder Esc steigt aus und die Kamera kommt zurück. Das andere Fenster sieht den Turm drehen.
  Dasselbe einmal im Einzelspieler ohne Coop.
  **ok (2026-09-24), mit Befund:** Nach einem kurzen Klick feuerte der Archer weiter, bis die Maus sich bewegte. Ursache:
  Der Abzug wurde mit dem Tower verglichen, der im Coop einen Tick nachläuft, und so ging das Loslassen nie raus.
  Behoben, Nachtest T19. Zielen „etwas hakelig“ ist offen (TODO E29). Das Drehen im anderen Fenster und der
  Einzelspieler sind ungetestet.
- **T2 Name in der Lobby**: Vor dem Start im Dialog „Your name“ ändern, Enter. Erwartung: Das andere Fenster zeigt den
  neuen Namen; beide gleich benannt ergibt „Name 2“. Nach dem Start ist das Feld weg.
  **ok (2026-09-24)**
- **T3 Engine in der Lobby**: In der Spielerliste steht je Spieler Browser, Version und System (z. B. „Chrome 140.0.0.0,
  Windows“). Mit Chrome und Firefox im selben Raum steht darunter der Hinweis auf verschiedene Engines.
  **ok (2026-09-24)**
- **T4 Dialog beim Start**: Der Host drückt Start. Erwartung: Der Dialog geht in beiden Fenstern zu.
  **ok (2026-09-24)**
- **T5 Spieler-Leiste**: Oben mittig unter dem Tempo je Spieler ein Feld mit Lane-Farbe, Name, Gold und zwischen den
  Wellen „building“. Der Wellenknopf heißt im Coop „Ready for wave N“ mit „0/2 ready“ rechts, ohne Auto-Schalter.
  Ein Spieler klickt ihn: Der Knopf bleibt gedrückt („Wave N: ready“, 1/2), bei beiden steht bei ihm „ready“, bei ihm
  selbst zusätzlich „Waiting for …“ mit dem Namen des anderen. In der Welle verschwinden die Zustände.
  **ok (2026-09-24)**, Wunsch: Die Leiste soll untereinander links neben den Fähigkeiten stehen, die Meldungen darunter.
  Umgebaut, Nachtest T16.
- **T6 Gold senden**: Neben dem Mitspieler der kleine Knopf, dann 100. Erwartung: Das eigene Gold sinkt um 100, das des
  anderen steigt in beiden Fenstern gleich, beim Empfänger steht kurz „… sent you 100 gold“. Beträge über dem eigenen
  Gold sind ausgegraut. Im Relay-Log keine `DESYNC`-Zeile.
  **ok (2026-09-24)**, Wunsch: mehrfach senden können. Das Menü bleibt jetzt offen, Nachtest T16.
- **T7 Zusammenfinden**: Host öffnet den Raum, Gast kommt per Einladungslink. Erwartung: Beim Gast öffnet sich der
  Dialog sofort mit „Loading the host's map…“. Beide bekommen von selbst eine freie Lane. Der Host hat keinen
  Bereit-Knopf, der Gast einen großen „I am ready“. Unter der Liste steht, worauf der Start wartet („Waiting for …
  to be ready“, dann „Everyone is ready“). Der Coop-Knopf in der Seitenleiste zeigt „Coop“ plus Raumcode.
  **ok (2026-09-24)**. Offene Fragen in TODO E29: Soll man einen Raum allein starten können, soll der Host einen freien
  Extra-Spawn bereithalten, und wo sitzt der Coop-Knopf?
- **T8 Meldungen im Spiel**: Unter der Spieler-Leiste erscheinen für ein paar Sekunden: Chat aus dem Dialog des
  anderen, „… left the game“, wenn ein Fenster geschlossen wird, „… is the host now“. Relay beenden (Strg+C):
  „Connection to the coop server lost“ bleibt stehen.
  **ok (2026-09-24)**, Wunsch: Chat links unten. Die Meldungen stehen jetzt links unter der Spieler-Leiste, Nachtest T16.
- **T9 Relay aus**: Relay nicht starten, „Open a room“. Erwartung: „Found no coop server (tried ws://localhost:3003)…“.
  **ok (2026-09-24)**
- **T10 Neustart im Coop (R1)**: Game over herbeiführen (HQ fallen lassen). Beim Gast steht „The host starts the next
  run“ statt RESTART, beim Host RESTART. Danach bei beiden Welle 0, Startgold, unter der Leiste „New run started“,
  eine Welle spielen, im Relay-Log keine `DESYNC`-Zeile.
  **ok (2026-09-24)**. Die Welle danach ist ungeprüft.
- **T11 Aufholen (R2)**: Im Spiel das Fenster des Gasts 20 s minimieren, dann zurück. Erwartung: Das Spiel läuft kurz
  schneller und ist nach wenigen Sekunden wieder gleichauf; in der Statusseite des Relays liegen die Prüfsummen-
  Ticks beider Spieler danach wieder dicht beieinander.
  **kaputt (2026-09-24):** Danach Abweichungen, Gegner unsichtbar. Das Log zeigt: Das Aufholen selbst klappte, der Gast
  stand 2 min und war nach etwa 45 s gleichauf, danach stimmten die Prüfsummen noch 2 min. Die Abweichungen kamen später
  von zwei Stellen am Kommando vorbei: Der Plan der eigenen Welle zog beim Absender aus dem Spawn-Zufall, und Kill all,
  Gegner-Spawn und Gegner-Entfernen wirkten nur im eigenen Fenster. Beides behoben, Nachtest T15. „Gegner unsichtbar“
  ist ungeklärt und kommt in T15 mit.
  **überholt, Nachtest T34 ok (2026-09-26)**
- **T12 Sperren (R3 bis R5)**: Im Coop-Spiel Developer options „+1000 Credits“: nichts passiert, bei beiden. Ortsname,
  Würfel, HQ, Spawn und „+“ im Kopf sind ausgegraut (für den Gast schon in der Lobby). Beim Gast Tempo und Pause
  ausgegraut, Tooltip „The host sets speed and pause“. Kein Replay-Link unter dem Wellenknopf.
  **ok (2026-09-24)**, Wünsche: Cheats im Coop, der Relay soll das erlauben. Gäste sollen pausieren dürfen, das Tempo
  ist offen (TODO E29). Beides gebaut, Nachtest T17 und T18. Kill all ging, weil es am Kommando vorbeilief (siehe T11).
- **T14 Server von Hand (R6)**: Startbildschirm des Dialogs, „Server“ aufklappen, Unsinn eintragen: Hinweis „no ws://
  or wss:// address“. Eine gültige, aber tote Adresse: „Can't reach the coop server at …“. Feld leeren: wieder
  automatisch.
  **ok (2026-09-24)**, Wunsch: gleich beim Eintragen prüfen, dazu ein Test-Knopf. Gebaut, Nachtest T20.
- **T15 Viele Gegner bleiben gleich**: Im Coop eine Custom Wave mit vielen Gegnern starten (Wave Debug, „Start Custom
  Wave“). Mitten darin einmal Kill all, dann noch eine Custom Wave, dazu einmal das Gast-Fenster 20 s minimieren.
  Erwartung: In beiden Fenstern gleiche Abstände und gleiches Tempo der Gegner, Kill all wirkt in beiden, im Relay-Log
  keine `DESYNC`-Zeile, nach dem Minimieren sind die Gegner sichtbar.
  **ok (2026-09-25)**, Relay-Log: 1297 s, 1353 Kommandos, 0 Abweichungen.
- **T16 Spieler-Leiste links**: Die Spieler stehen untereinander links neben der Fähigkeitenleiste, darunter „Waiting
  for …“ und die Meldungen, Chat eingeschlossen. Nichts überdeckt das Info-Overlay oben links. Im Gold-Menü dreimal auf
  100 klicken: 300 kommen an, das Menü bleibt offen, der Gold-Knopf schließt es.
  **ok (2026-09-25)**; Position und Anordnung geht an einen Designer (TODO E29).
- **T17 Cheats übers Relay**: Beim Start schreibt der Relay „cheats allowed“. Im Coop „+1000 Credits“: Gold +1000 bei
  beiden gleich. Kill all, Max upgrade, Research: wirken in beiden Fenstern. Relay mit
  `npm run coop-server -- --no-cheats`: Die Knöpfe tun nichts.
  **ok (2026-09-25)** mit Cheats; der Teil mit `--no-cheats` später.
- **T18 Pause für Gäste**: Der Gast drückt Pause (oder P): Beide stehen, im Relay-Log „paused by …“. Der Gast drückt
  wieder: Es läuft im Tempo des Hosts weiter. Der Tempo-Knopf bleibt beim Gast gesperrt.
  **ok (2026-09-25)**
- **T20 Server-Feld prüft sofort**: Im Dialog „Server“ aufklappen, `ws://localhost:3003` eintragen, Enter: „The coop
  server at ws://localhost:3003 answers.“ `ws://localhost:9999`: „Can't reach …“. Feld leer, „Test“: prüft die
  automatische Suche.
  **ok (2026-09-25)**, Wunsch: grüner Haken bei Erfolg. Gebaut, sieht man beim nächsten Mal.
- **T21 Nicht allein starten, freier Spawn**: Auf einer Karte mit einem Spawn einen Raum öffnen: Ein zweiter Spawn
  kommt von selbst dazu. Allein ist Start ausgegraut, der Hinweis sagt „send the invite link to a second player“.
  **ok (2026-09-25)**
- **T22 Coop-Knopf im Kopf**: Rechts neben den Spawn-Knöpfen das Zwei-Personen-Icon, im Raum mit dem Raumcode
  daneben. In der Seitenleiste ist der alte Knopf weg. Einladungslink öffnet das Panel weiterhin von selbst.
  **ok (2026-09-25)**
- **T23 Panel links, Karte frei**: Vor dem Start steht das Raum-Panel links ohne Abdunklung. Daneben klappen: auf
  die Karte klicken, Kopfknöpfe, Hotkeys, Esc bricht ein Platzieren ab (und schließt das Panel nicht). Close schließt
  es. Im Spiel öffnet der Kopf-Knopf es als normalen Dialog.
  **ok (2026-09-25)**; das Panel überdeckt die FPS-Anzeige (TODO E29).
- **T24 Spawn versetzen**: Host, zwei Spawns. Im Panel bei Spawn 2 die Flagge, auf der Karte neu setzen: Spawn 1 bleibt
  stehen. Im Kopf öffnet die Flagge ein Menü „Move spawn 1/2“ und „One spawn in place of all“; mit nur einem Spawn
  setzt sie direkt, ohne Menü.
  **ok (2026-09-25)**
- **T25 Gäste ziehen mit**: Host versetzt einen Spawn oder fügt mit + einen hinzu: Beim Gast ändern sich die Spawns
  ohne Neuladen, er behält seine Lane, „ready“ ist wieder aus. Host würfelt einen neuen Ort: Der Gast lädt neu, ist
  wieder im Raum und auf seiner alten Lane. Im Relay-Log kein `DESYNC` im Spiel danach.
  **kaputt (2026-09-25):** Beim Würfeln flog der Host aus dem Raum, der Gast wurde Host. Ursache: Der Würfel lud die ganze
  Seite neu. Er wechselt jetzt ohne Neuladen wie die Ortssuche; nochmal testen. Wunsch: Lanes auch wieder entfernen
  können, gebaut (× je Lane im Panel). Nochmal testen: Spawn versetzen, +, ×, würfeln.
  **ok (2026-09-25):** Wunsch: der Gast soll vorher hören, was passiert. Gebaut: der Host meldet den Wechsel sofort
  (Relay-Nachricht `moving`), der Gast sieht „… is changing the map, it comes here next“ und im Panel einen Hinweis bis
  zur neuen Karte.
- **T26 Lane-Länge**: Im Panel je Lane Balken, Meter und Laufzeit (m:ss). Die kürzere Lane hat den kürzeren Balken.
  **ok (2026-09-25)**
- **T27 Ping**: In Panel und Spieler-Leiste je Spieler „… ms“; beim eigenen Tooltip „round trip to the coop server“,
  beim Mitspieler „about“. Zweimal Chrome lokal: wenige ms.
  **kaputt (2026-09-25):** Im Panel keine ms. Ursache: Lokal misst der Relay 0 ms, und das Panel hat die 0 als „nichts“
  behandelt. Behoben, nochmal testen.
  **ok (2026-09-25)**
- **T28 Messlauf Ruckeln (T19)**: Relay neu starten (Protokoll 4), zwei Fenster, Coop starten. 1 min eine Welle
  zuschauen, dann 1 min einen Tower bemannen, zielen und schießen. Nichts melden, der Relay loggt je Fenster alle 10 s
  eine `stats`-Zeile (Frames an der Sperre, Sub-Steps je Frame, Rückstand, Tick-Abstand, Eingabe-Verzögerung).
  **gemessen (2026-09-25):** Host an der Sperre in 62 bis 73 % der Frames, rechnet in 4er-Paketen (15 Hz), Rückstand 0;
  Gast nie an der Sperre, aber 1 bis 2 Ticks zurück, Eingabe 112 bis 195 ms. Tick-Abstand bei beiden 67 ± 7 ms. Gebaut:
  jeder Client hält einen Tick Vorrat (Tempo ±10 %), und das Auge im bemannten Tower folgt der eigenen Maus statt dem
  verzögerten Tower. Nachtest T29.
  **überholt, T29 und T30 ok (2026-09-26)**
- **T29 Glatter im Coop (nach T28)**: Relay neu starten, derselbe Lauf wie T28 (1 min Welle, 1 min Tower, als Host
  und als Gast). Erwartung: Gegner laufen bei beiden gleichmäßig, im Tower dreht die Sicht direkt mit der Maus ohne
  Nachziehen. Im Log bei beiden `blocked` nahe 0 %, `behind` um 1, `input` bei beiden etwa 100 bis 130 ms.
  **ok (2026-09-25):** „deutlich besser“, Gegner ruckeln nicht mehr, der Tower nur „etwas besser“. Log: bei beiden
  `blocked` 0 %, `behind` 0,9, Eingabe 83 bis 98 ms bei Tempo 1, 0 Abweichungen.
- **T30 Kürzere Ticks**: Coop mit zwei Fenstern, 1 min Welle, 1 min Tower bemannen. Erwartung: flüssig wie in T29, der
  Tower spürbar direkter. Im Relay-Log in den `stats`-Zeilen `input` etwa 40 bis 70 ms (vorher ~95).
  **ok (2026-09-25):** Log: `input` 46 bis 63 ms (vorher ~95), `blocked` 0 bis 2 %.
- **T31 Schuss beim Klick**: Im Coop einen Tower bemannen, einzelne Klicks. Erwartung: Mündungsfeuer, Ton und Rückstoß
  sofort beim Klick, nicht doppelt; Projektil und Treffer kurz danach.
  **ok (2026-09-25)**
- **T32 Panel unter der FPS-Anzeige**: Raum öffnen: Das Panel steht links unter dem Info-Overlay oben links, auch wenn
  man das Overlay auf- und zuklappt; es reicht nicht unter den Fensterrand.
  **teils (2026-09-25):** steht unter der FPS-Anzeige; Wunsch: „einfach darunter, bottom-left quasi“. Gebaut: das Panel
  dockt unten links über der Logo-Zeile an, ein hohes reicht bis unter die FPS-Anzeige. Nachtest T46.
  **überholt, das Panel ist jetzt das Dock (T54 ok) (2026-09-26)**
- **T33 Du oben in der Leiste**: Im Spiel steht man selbst oben in der Spieler-Leiste, etwas größer, mit „you“; der
  Host trägt „host“. Beim Gast: der Host steht an zweiter Stelle.
  **ok (2026-09-25)**
- **T34 Warten auf den Langsamsten (R2)**: Im Spiel das Gast-Fenster 10 s minimieren. Erwartung: Nach etwa 3 s steht
  das Spiel beim Host, „Waiting for … to catch up“, in der Leiste beim Gast „catching up“; nach dem Zurückholen läuft
  es weiter. Im Relay-Log „waiting for … to catch up“.
  **ok (2026-09-25):** Log „waiting for … to catch up“ mehrfach.
- **T35 Hinweis beim Beitritt (R11)**: Startbildschirm des Panels: unter dem Raum-Feld der Satz, dass die Seite beim
  Beitritt neu laden kann.
  **ok (2026-09-25)**
- **T36 Rauswerfen und Schließen (R9)**: Host drückt in der Lobby das × beim Gast: Der Gast ist raus mit „The host took
  you out of the room.“. Host hakt „Closed to new players“ an, ein weiterer Beitritt bekommt „The host closed the room
  to new players.“.
  **ok (2026-09-25)**
- **T37 Ohne Kartenschlüssel (R8)**: Einladungslink in einem Inkognito-Fenster öffnen. Erwartung: Token-Bildschirm mit
  dem Satz zum Coop-Raum, Panel sagt „Enter your map key first“. Schlüssel eintragen: Karte lädt, Beitritt von selbst.
  **nicht testbar (2026-09-25):** Inkognito hat den Schlüssel auch, er kommt aus `environment.ts`, das im Build steckt.
  Gebaut: `?nokey` in der URL lässt die Schlüssel des Builds weg. Nachtest T47.
  **überholt, Nachtest T47 ok (2026-09-26)**
- **T38 Allein weiter (R10)**: Im Spiel den Relay beenden (Strg+C). Unter der Meldung „Continue alone“: Klick, das Spiel
  läuft als Einzelspieler weiter, die Lane des anderen ist zu.
  **kaputt (2026-09-25):** danach keine Welle, kein Tower, keine Cheats. Ursache: ohne Relay liefen Befehle als
  Spieler `local`, im Lauf heißen die Spieler aber wie im Coop (`p8`); jeder Befehl fiel weg. Behoben (Befehle des
  lokalen Spielers), dazu zählt so ein Lauf nicht mehr als Rekord. Nochmal testen.
  **überholt, Nachtest T48 ok (2026-09-26)**
- **T39 Chat unten links (R12)**: Im Spiel Enter: Eingabezeile unten links, Text, Enter schickt, Esc schließt. Beim
  anderen erscheint die Zeile unten links, nicht mehr unter der Spieler-Leiste.
  **ok (2026-09-25):** Wunsch: weiter links, unter der Spieler-Leiste. Gebaut: der Chat steht jetzt direkt unter der
  Leiste. Nochmal ansehen.
- **T40 Karten-Ping (R13)**: Im Spiel X, dann auf die Karte klicken: Bei beiden steht dort „▼ Name“ in der Lane-Farbe
  mit Ton, beim anderen die Meldung „… marked a place on the map“. X und Esc bricht ab.
  **ok (2026-09-25):** Wunsch: deutlicher, größer, Kreis außen herum, Hinweis am Rand. Gebaut: größere Schrift, drei
  Ringe in Lane-Farbe wachsen auf 45 m, Pfeil mit Namen am Bildrand, solange die Kamera woanders ist (Klick fährt hin).
  Nochmal ansehen.
- **T41 Tower des Partners (R14)**: Der Partner baut einen Tower: Bei dir trägt er einen Ring in seiner Lane-Farbe.
  Klick darauf: „That is …'s tower“.
  **kaputt (2026-09-25):** Ring nicht in Lane-Farbe. Ursache: der Ring wurde gesetzt, bevor das Modell geladen war, und
  fiel weg. Behoben, nochmal testen.
  **überholt, Nachtest T51 ok (2026-09-26)**
- **T42 Lecks je Lane (R15)**: Gegner durchlassen: In der Leiste beim Spieler, dessen Lane es war, „N through“ in
  Orange; mit der nächsten Welle wieder weg.
  **ok (2026-09-25)**
- **T43 Game over im Coop (R16)**: HQ fallen lassen: unter der Zusammenfassung eine Tabelle je Spieler (Kills, Leaks,
  Towers, Gold given, Gold). In „Runs“ steht der Lauf als „coop: Ann, Bob“; die Weltkarte zeigt keinen neuen Rekord
  aus dem Coop-Lauf.
  **ok (2026-09-25)**
- **T44 Raumcode kopieren**: Raum öffnen, oben im Panel auf den Code klicken. Erwartung: Häkchen, der Code ist in der
  Zwischenablage.
  **überholt, Code kopieren im Dock (T56 ok) (2026-09-26)**
- **T45 Gast hört den Kartenwechsel (T25)**: In der Lobby würfelt der Host einen neuen Ort (oder setzt einen Spawn).
  Erwartung: beim Gast im Panel sofort „The host is changing the map“, bis die neue Karte da ist.
  **ok (2026-09-25):** danach beim Gast der volle Ladebildschirm. So gewollt, wo der Host den Ort wechselt (der Gast lädt
  den neuen Ort); bei geänderten Spawns am selben Ort lädt nichts.
- **T46 Panel unten links (T32)**: Raum öffnen: das Panel steht unten links über der Logo-Zeile; wird es hoch, reicht
  es bis unter die FPS-Anzeige und scrollt.
  **überholt, das Panel ist jetzt das Dock (T54 ok) (2026-09-26)**
- **T47 Ohne Kartenschlüssel (T37)**: Einladungslink im Inkognito-Fenster öffnen und `&nokey` anhängen. Erwartung:
  Token-Bildschirm mit dem Satz zum Coop-Raum, Panel „Enter your map key first“. Schlüssel eintragen: Karte lädt,
  Beitritt von selbst.
  **übersprungen (2026-09-25)**
  **ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** Token-Bildschirm nennt den Raum (`coop-look.mjs`).
- **T48 Allein weiter (T38)**: Im Spiel den Relay beenden, „Continue alone“. Erwartung: Welle starten, Tower bauen und
  Cheats gehen; die Lane des anderen bleibt zu. Game over danach: kein neuer Rekord auf der Weltkarte.
  **ok (2026-09-25)**
- **T49 Chat unter der Leiste (T39)**: Im Spiel Enter, Text, Enter. Erwartung: Eingabe und Zeilen direkt unter der
  Spieler-Leiste.
  **überholt, Chat unter der Squad-Box (T62 ok) (2026-09-26)**
- **T50 Karten-Ping deutlicher (T40)**: X, Klick auf die Karte. Erwartung: größeres „▼ Name“, drei Ringe in
  Lane-Farbe wachsen aus dem Punkt. Beim anderen, Kamera woanders: Pfeil mit Namen am Bildrand, Klick fährt hin.
  **ok (2026-09-25):** der Hinweis nach X war unten links kaum zu sehen. Gebaut: eigene Fläche mit Goldrand wie die
  Chat-Eingabe. Nochmal ansehen.
- **T51 Partner-Ring (T41)**: Der Partner baut einen Tower. Erwartung: Ring in seiner Lane-Farbe, auch beim ersten
  Tower eines Typs.
  **ok (2026-09-25):** der Ring soll nur bei Hover da sein, immer an nervt. Gebaut: Lane-Farbe bei Hover und Auswahl.
  Nochmal ansehen.
  **Nachtest offen (Auge):** „nur bei Hover“ ist per Renderer-Spec gesichert; im Browser-Lauf fanden die Kameras
  von Host und Gast nicht verlässlich dieselbe Stelle.
- **T52 Chat in der Lobby**: Vor dem Start im Panel unten „Say something“, Text, Enter. Erwartung: die Zeile steht bei
  beiden im Panel, die neueste unten sichtbar.
  **ok (2026-09-25):** doppeltes Scrollen (Dock und Chat) war das Schlimmste. Gebaut: das Dock im Raum zweispaltig
  (820 px), links Raum, Spieler, Lanes, Optionen, rechts der Chat über die volle Höhe; nur der Chat scrollt,
  links nur bei Platzmangel. Nochmal ansehen.
- **T53 Fähigkeiten oben**: Die Fähigkeitenleiste steht links direkt unter der FPS-Anzeige (nicht mehr mittig) und rückt
  mit, wenn man das Overlay auf- und zuklappt.
  **ok (2026-09-25)**
- **T54 Dock, Einstieg**: Ohne Raum das Zwei-Personen-Icon im Kopf. Erwartung: Dock rechts neben der
  Fähigkeitenleiste, oben auf ihrer Höhe, ohne Schleier; Name, Karte „Host this map“ mit „Open room“, „OR“, Karte
  „Join a room“ mit Code-Feld, unten „SERVER · …“ zum Aufklappen mit Test. X schließt.
  **ok (2026-09-25):** das Fenster scrollte quer (Eingabefeld 100 % plus Rand). Behoben (`box-sizing`).
- **T55 Beitritt als Schrittliste**: Gast öffnet den Einladungslink. Erwartung: Dock „Joining <Code>“, Schritte
  Connected, Room found, Loading the host's map (mit % und Balken, solange geladen wird), Taking a seat; danach die
  Lobby. „Cancel“ bricht ab.
  **ok (2026-09-25):** nur, wenn man schon im Spiel war; beim frischen Einladungslink steht zuerst der Ladebildschirm
  davor, das Dock kommt danach.
- **T56 Lobby als Host**: Raum öffnen. Erwartung: großer Code, „Code“ und „Invite link“ kopieren mit „Copied“,
  Schalter „Open to new players“/„Locked“, Statuszeile „Waiting for a second player“, leerer Platz mit „Copy
  invite“; „Start match“ grau, Tooltip nennt den Grund. Mit Gast: der Host steht auf „✓ Ready“, ohne Knopf.
  **ok (2026-09-25):** der eigene Name war nicht als änderbar zu erkennen. Gebaut: vertieftes Feld mit Stift.
- **T57 Lanes im Dock**: Je Lane Farbe, Balken, „m · m:ss“, „You“, Name oder „Free · take“ (Klick nimmt sie).
  Fliegen (Nadel), beim Host Versetzen (Flagge) und Entfernen (×).
  **ok (2026-09-25)**
- **T58 Mode & options**: Host klappt „Mode & options“ auf, setzt Pause auf „Anyone“. Erwartung: beim Gast fällt
  „Ready“, in beiden Chats „<Host> set Pause: Anyone“; der Gast sieht die Werte nur zum Lesen mit Schloss-Hinweis.
  Zugeklappt Chips. Game mode: PvE Coop aktiv, Versus grau mit SOON.
  **ok (2026-09-25):** unklar, dass „edit“ aufklappt. Gebaut: Knopf „Edit“/„Hide“ mit Pfeil; für den Host von Anfang
  an offen.
- **T59 Cheats nach Regel**: Relay mit Cheats. Host setzt Cheats „Host only“, Start. Erwartung: „+1000 Credits“ des
  Hosts wirkt bei beiden, der des Gasts nirgends; Squad zeigt „CHEATS ON“. Mit `-- --no-cheats` sind „Host only“ und
  „Everyone“ grau.
  **übersprungen (2026-09-25)**
  **ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** Host 100 → 1100 bei beiden, Gast-Cheat ohne Wirkung, CHEATS ON; mit `--no-cheats` beide
  Cheat-Knöpfe grau (`coop-rules.mjs`, Bilder `tmp/checks/t59-*`).
- **T60 Pause nach Regel**: Standard (Host only): der Gast kann nicht pausieren, Knopf gesperrt mit Tooltip, P tut
  nichts. „Anyone“: der Gast kann. „Off“: niemand.
  **übersprungen (2026-09-25)**
  **ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** Standard: Gast gesperrt, sein Klick tut nichts, Host pausiert beide; „Anyone“: Gast pausiert und
  setzt fort. „Off“ nicht geprüft.
  **„Off“ ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** bei Host und Gast gesperrt, Klick und P pausieren nichts (`extras.mjs`).
- **T61 Next wave**: „Host starts“: beim Host heißt der Knopf „Start wave N“ und startet sofort. „Auto 10 s“: nach
  einer Welle zählt der Knopf bei beiden herunter und die Welle startet von selbst; sind vorher alle bereit, sofort.
  **ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** „Host starts“: Host-Knopf „Start wave 1“, startet sofort; „Auto 10 s“: Gast zählt „· 8s“,
  Welle 2 startet von selbst; alle bereit startet Welle 1.
- **T62 Squad und Chat unten links**: Im Spiel. Erwartung: Squad-Box mit dir oben (YOU, HOST), „SPAWN n · BUILDING“
  oder „READY“, Credits, Ping-Balken; das Häkchen setzt dich bereit, beim Partner öffnet die Münze das Gold-Menü; Fuß
  „Waiting for …“ bzw. „waiting for you“ mit Space. Minus klappt auf eine Zeile „1/2 READY“. Darunter der Chat auf
  einem Schleier, alte Zeilen blasser, Systemzeilen in Mono; Enter schreibt, X markiert, Tab öffnet das Dock.
  **ok (2026-09-25):** „waiting for you“ irreführend. Jetzt „Ready up for the next wave“ mit Space.
  **Nachtest ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** Fuß „Ready up for the next wave“ mit Space; X zeigt den Hinweis auf eigener Fläche
  (T50). Dabei gefunden und behoben: Credits in der Squad-Box mit Tausenderpunkt („1.100“), im Kopf ohne.
- **T63 Raum-Chip und Dock im Spiel**: Im Kopf Code, ein Quadrat je Spieler in Lane-Farbe, „2/4“. Klick oder Tab
  öffnet das Dock auch im Spiel: Optionen nur lesen, unten nur „Leave“; das Spiel läuft daneben weiter.
  **ok (2026-09-25):** der Chip passte nicht in den Kopf und blieb nach dem Klick im Fokus. Gebaut: der Coop-Knopf im
  Stil der Kopf-Knöpfe (aktiv), kein Fokus nach dem Klick.
  **Nachtest ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** nach dem Klick kein Fokus auf dem Knopf; Einstieg scrollt nicht quer (T54), eigener
  Name als Feld (T56), Optionen beim Host offen, beim Gast „Show all“ (T58).
- **T64 Mono-Schrift**: Zahlen, Codes und Tasten stehen jetzt in JetBrains Mono (vorher Consolas). Erwartung: Kopf-
  Leiste, Sidebar und Dialoge ohne abgeschnittene oder umbrechende Werte.
  **ok (2026-09-25)**
- **T65 Der Host sieht den Gast kommen (D47)**: Gast öffnet den Einladungslink, danach würfelt der Host einen neuen Ort.
  Erwartung: beim Host sofort „Bob joined“, in Bobs Zeile „Loading the map…“, Statuszeile „Waiting for Bob to load the
  map“, danach „Bob's map stands“. Beim Würfeln „Bob reloads for the new place, back in a moment“ statt „Bob left“.
  **ok (E2E, 2026-09-25):** Beitritt per Einladungslink und das Neuladen beim Würfeln; der Gast landet wieder auf
  seiner Lane, kein „Bob left“ (`e2e/tests/coop-lobby.e2e.ts`). Seit 2026-09-25 lädt der Gast dabei nicht mehr neu, er
  wechselt den Ort in der Seite (Chat „Bob is loading the map“); E2E ok, dieselbe Seite, dieselbe Lane.
- **T66 LAN-Spiel zu Hause (C4d)**: Zwei Rechner mit der Desktop-App aus diesem Stand (`cd desktop && npm run dist`,
  oder `npm run dev` auf beiden). Rechner A: Tab, „Host LAN game“, die Windows-Firewall fragt einmal, „Private
  Netzwerke“ erlauben. Rechner B: Tab. Erwartung: unter „Games on this network“ binnen zwei Sekunden „A · 1/4
  players · 192.168.x.y · CODE“, „Join“ bringt B in den Raum, Spiel läuft wie im Browser. Dann gegenprüfen: A im WLAN,
  B am Kabel; einer mit VPN an. Findet B nichts: nach 4 s kommt das Feld „Host IP“, A zeigt seine Adresse im Raumkopf
  hinter „LAN“. Schon geprüft (2026-09-25, ein Rechner): Relay startet aus `app.asar`, die Suche findet ihn über alle
  drei Adapter, „Leave“ beendet ihn.
  **ok (2026-09-25, zwei Rechner, Firewall am Host aus):** Liste findet den Raum ohne IP, Beitritt, Karte zieht zum Ort
  des Hosts, Match mit einer Welle und Towern auf beiden Seiten, Tick 5734 ohne Abweichung, Laufzeit unter 1 ms.
  „Ask“ mit IP findet den Raum über `/status`. Gefunden und behoben: eine zweite Suche beendete die der Liste (danach
  „No game answered“ trotz Eintrag), das IP-Feld blieb bei gefüllter Liste stehen; neu ein Knopf „Search again“.
  Offen: die Frage der Windows-Firewall beim Hosten; der Weg vom Start der App bis in den Raum (E30), die Wege übers
  Internet (E31).

### Nachgetragen: Ergebnisse, die als Zwischenstand standen

- **R4c Aus dem bemannten Tower**: In einem Tower sitzen (C), dann "replay". Erwartung: Das Replay startet mit freier
  Kamera; nach Esc steht man draußen.
  **entfällt (2026-09-24)**: In der Egoperspektive ist der Replay-Einstieg nicht erreichbar; der Ausstieg im
  Code bleibt als Absicherung.
- **R8 Klick direkt nach der Welle**: Sofort nach dem Wellenende auf "replay" klicken, während noch Schüsse fliegen.
  Erwartung: Das Replay startet nach spätestens ein paar Sekunden von selbst.
  **im Spiel schwer zu treffen (2026-09-24)**; per Spec abgedeckt (`replay.service.spec.ts`: wartet, startet von
  selbst, gibt nach 5 s auf).
- **T19 Abzug im Coop**: Archer bemannen, einzelne kurze Klicks: je ein Schuss, kein Dauerfeuer. Gedrückt halten:
  Dauerfeuer, Loslassen stoppt. Zum Vergleich einmal Gatling.
  **teilweise (2026-09-25):** Bewegung und Gefühl in der Egoperspektive sind im Coop deutlich zäher und verzögerter. Verdacht
  (unbelegt): Der Client hängt ohne Puffer an der Tick-Sperre und läuft in 4er-Sprüngen. Offen in TODO E29.

