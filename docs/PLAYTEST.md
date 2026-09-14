# Playtest-Liste

Stand 2026-09-15. Das ist die eine, laufende Liste für die nächste Session: nur offene Punkte. Die alten Listen
(REVIEW_FIX_2026-09-14, REVIEW_SPRINT_2026-09-12 bis -14) verweisen hierher. Code-Stand: `sprint/night-2026-09-14`
ab `3df5f9e6` mit dem Merge des Atompilzes (nuke).

Antworten reicht so: "603 ok, 607 kaputt". In Klammern stehen die alten Nummern. Jede Runde hat einen gemeinsamen
Aufbau, jeder Punkt höchstens drei Fragen.

## Vorab

- Konsole (F12) offen lassen. Jede Zeile mit `Shader Error` oder `Uncaught` melden. Konsolenfilter nur als einfacher
  Text ("Corridor", "Camera").
- Quick Actions unten rechts: Auge = Display-Menü (Effects mit Low, Medium, High und "Bloom"; darunter "Blood Moon",
  "Screen Shake", "Boss Intro"), Layers ("Route Grid Overlay", "Show streets", "Show routes"), "Reset camera" und
  "Developer options".
- "Developer options": Cheats "Kill", "Credits" (Shift+Klick +100 000), "+HP" (Rechtsklick -10 HP, mit Shift -50),
  "Research", "Max Up", "Abilities" (alle Fähigkeiten, Ladungen voll), "Hero". "Waves" öffnet Wave Debug mit "Jump to
  wave" und darunter Single: Type, Count, "Start Custom Wave". "Enemies" öffnet Enemy Debug ("Place enemy on route",
  "Start moving").
- Der Wurm heißt jetzt "Skarnax".

## Nachtests (Fixes vom 14.09. abends und nachts)

### Runde 1: Paris, Pont d'Iéna (601 bis 604)

Aufbau: Paris am Pont d'Iéna laden wie im Playtest 2 (Favorit oder URL), keine Tower, Layers "Route Grid Overlay" an.

- **601** (564, alte 14): Zu beiden Brückenköpfen zoomen. Läuft die blaue Umrandung über die kurzen Straßenstücke
  hinter der Brücke auf Deckhöhe weiter? Keine weißen Zellen unten am Kai unter dem Deckanfang? Ist der Korridor an
  den Köpfen ohne Lücken und nicht schmaler als auf dem Deck?
- **602** (564): Space, die Welle über die Brücke laufen lassen. Bleiben rote Linie und Gegner an beiden Köpfen
  durchgehend sichtbar, oben auf dem Deck und nicht unten am Kai?
- **603** (564): Layers "Show streets" an. Liegt die gelbe Linie auf der Brücke und den kurzen Stücken dahinter oben
  auf dem Deck? Bleibt die Kaistraße unter dem Brückenende unten? Liegen an der Quai Branly (Platanen) Zellen und
  gelbe Linie auf der Straße, nicht in den Kronen?
- **604** (544): Beim Laden die "Field Tips" im Ladescreen lesen. Sind einzelne Wörter farbig hervorgehoben? Fehlt in
  der Konsole die Zeile "WARNING: sanitizing HTML stripped some content"?

### Runde 2: Korridor in Rothenburg und Erlenbach (605 bis 608)

Aufbau: keine Tower, keine Welle, "Route Grid Overlay" an, warten, bis die Konsole `[Corridor] rebuild` zeigt. Steht
irgendwo noch eine weiße Zelle, wo keine hingehört: `__corridor.pick()` in die Konsole, Linksklick auf die Zelle,
Tabelle schicken.

- **605** (560 bis 563, alte 44): Rothenburg, die Stellen deiner Screenshots vom 14.09. (Auto, Dachecke, Erker).
  Keine weißen Zellen mehr dort? Kamera 10 s nicht bewegen: bleibt auch danach nichts auf Dach, Traufe oder Auto? An
  einer Straße quer am Hang: bleiben die Randzellen?
- **606** (Vorgärten): Rothenburg, Wohnstraße. Erhöhter Vorgarten mit Hecke oder Mäuerchen: endet der Korridor davor?
  Laterne, Schild oder Straßenbaum am Rand: keine Kerbe im Korridor? Enge Gasse mit geparktem Auto: bleibt eine
  Zellreihe? (Ein Vorgarten auf Gehweghöhe hinter einem Zaun bleibt drin, bekannt.)
- **607** (562, alte 41): Straße mit parkenden Autos und dem Transporter. Endet der Korridor vor der Autoreihe, ohne
  Zellen auf dem Gehweg und ohne Ausbuchtung zwischen zwei Autos? Dann Space: läuft kein Gegner durch ein Auto?
  Zeigen die Gegner auf schrägen Straßen mit dem Körper in Laufrichtung (vorher gut 10° verdreht)?
- **608** (205 bis 209): Erlenbach, Weinstraße und Erlenweg, die Stellen deiner Screenshots. Keine einzelnen weißen
  Zellen mehr in Baumkronen oder auf Hecken, endet der Rand davor? Gleich danach D2 (selber Ort).

### Runde 3: Boss-Intro und Skarnax-Karte (609 bis 612)

Aufbau: Display-Menü "Boss Intro" an. Spawn mit dem Header-Knopf "Set spawn" setzen, Boss rufen mit "Waves", Single,
Type wählen, Count 1, "Start Custom Wave". Bei einem schlechten Bild: Screenshot und die Konsolenzeile
`[Camera] bossIntro.shot` schicken.

- **609** (366): Spawn in eine schmale Straße zwischen Häusern, möglichst kurz vor einer Kurve, Type "Herbert". Steht
  Herbert nach dem Schnitt ganz sichtbar vor der Portalöffnung, ohne Haus davor? Steht die Kamera frei, nicht in einem
  Haus?
- **610** (366): Spawn neben Bäume oder Büsche, wieder Herbert. Keine Krone und keine Büsche vor Herbert in der
  unteren Bildhälfte? Steckt die Kamera nicht selbst in einer Krone?
- **611** (352, 368): Spawn wie in 609, Type "Skarnax". Ist der Kopf frei vor dem Tor? Zeigt die Intro-Karte groß
  "SKARNAX" und darunter klein "THE THOUSAND-LEGGED CALAMITY", gut lesbar? Steht danach oben mittig die Boss-Leiste
  "SKARNAX"?
- **612** (366): Spawn an eine offene, breite Straße, Herbert. Dieselbe Einstellung wie bisher (ganzes Portal, Krone
  knapp unter dem oberen Rand)? Ruckelt es beim Abdunkeln merklich? Noch ein Herbert, in der ersten Abdunklung Esc:
  sofort die eigene Ansicht, kein Hänger?

### Runde 4: Skarnax an Ecken (613 bis 616)

Aufbau: Ort mit rechtwinkligem Knick auf der Route, Cheat "Credits". "Waves", Single, Type "Skarnax", Count 1,
"Start Custom Wave", Kamera über den Knick.

- **613** (356): Tempo 1x. Laufen die Ringe im Bogen durch die Ecke, ohne spitzes V und ohne Lücke außen? Bleibt der
  Wurm auf der Straße (er schneidet die Ecke leicht nach innen)? Schwingen die Ringe nach der Ecke nicht nach?
- **614** (356, 353): Tempo 4x: dieselbe Form wie bei 1x? Einen Tower an die Ecke setzen und einen Ring mitten im
  Bogen zerstören lassen: wird der Ring dahinter zum Kopf, und laufen beide Teile ohne Sprung weiter?
- **615** (356): Schmale Wohnstraße mit Knick, falls auf der Route: höchstens ein schmaler Spalt außen? Sticht der
  Körper an der Innenecke in Fassaden? Auf einer schrägen Straße: liegen die Ringe in einer Flucht?
- **616** (398): Cheat "Abilities", dann F, E und L jeweils auf Ringe. Sehen Eis, Funken und Brand an den Ringen
  passend aus (bekannt: eher klein)?

### Runde 5: Ooze (617 bis 620)

Aufbau: Display-Menü "Boss Intro" an, Cheats "Credits" und "Abilities". "Waves", Single, Type "Ooze", Count 1,
"Start Custom Wave". Für 617 und 618 die Ooze mindestens 27 s wachsen lassen.

- **617** (363): Die Ooze töten (Tower oder K). Sackt das Band in etwa 2 s zusammen, mit Blasen, grünen Pfützen und
  fliegenden Trümmern (Knochen, Schädel, Helme, Stoppschilder, Dosen)? Klingt der Splat etwa 2 s nach? Genug
  übertrieben, oder noch mehr?
- **618** (363): Vorher `__towerTargets.watch()` in die Konsole. Fire, Poison und Ice Tower an den Körper stellen und
  die Ooze töten lassen. Nimmt jeder binnen etwa 3 s einen Klumpen ins Ziel? Schießt ein danach neu gesetzter Tower
  ebenso? Steht einer still: D4.
- **619** (360, 366): Nächste Ooze, solange sie lebt. Ist die Spitze im Intro frei vor dem Tor? Ice, Poison und Fire
  auf das Band schießen lassen: wird es bläulich, dunkler bzw. orange glühend, gut zu erkennen?
- **620** (399): Nächste Ooze. F auf den Körper: wird er weiß-cyan, und steht die Spitze still? E: violett? L über den
  Körper: passt der Brand auf dem Band?

### Runde 6: Atompilz und Frost (621 bis 624)

Aufbau: neues Spiel, Cheat "Abilities" (füllt die Ladungen beliebig oft nach). "Waves", "Jump to wave" 7, Space. Ton
an, möglichst Kopfhörer.

- **621** (216, 217): "Reset camera", K, Klick auf die Route. Liest sich der Schlag sofort als Atompilz (Blitz,
  Feuerball, Druckwelle, Pilz), passend groß zur Karte? Bis etwa 22 s zusehen: rollt die Kappe, ist der Stamm
  schmaler als die Kappe? Genug Wumms im Bild?
- **622** (218): Nächster Schlag, auf den Ton achten: scharfer Knall, tiefer Boom, dann etwa 8 s Grollen in drei
  Wellen. Klingt das wuchtig genug? SFX-Regler im Audio-Menü runter: wird alles leiser?
- **623** (220, 223): Display-Menü, Effects, "Bloom" an. Kamera unter 100 m an den Einschlag, HQ im Bild, nächster
  Schlag, dann in die Wolke fahren. Keine abgeschnittenen oder springenden Rauchballen, keine harte Kante auf flachem
  Boden (an Hängen und Häusern bekannt)? Kurzes Nachglühen, danach normal, kein schwarzer Block?
- **624** (395, 394): Passt das Wort "Abilities" in seine Cheat-Kachel? F auf eine Gruppe: Frostausbruch sichtbar
  (Blitz, Kältering, Reif, Splitter, Nebel)? Gegner weiß-cyan mit Eis, Fledermäuse hängen in der Luft, Knistern
  hörbar?

### Runde 7: Bloom an und aus (625 bis 628)

Aufbau: Ort mit Tiles, Cheats "Credits", "Research" und "Abilities", verschiedene Tower an die Route (Kanone oder
Rakete, Magie, Eis, Gift, Tentakel, Blitz), Welle starten. Display-Menü, Effects, "Bloom": jeden Punkt erst ohne,
dann mit, dann wieder ohne ansehen. Ohne Bloom soll alles aussehen wie bisher. (TODO 1.9, Ausgabe-Kodierung der
eigenen Shader)

- **625**: Kamera nah an einen Pulk. Sind die Gegner mit Bloom gleich hell und gesättigt wie ohne (vorher heller und
  blasser)? Healthbars grün, gelb, rot gleich? Schadenszahlen in derselben Farbe?
- **626**: Brand- und Blutflecken am Boden, Feuer und Funken, dazu F und E. Sind die Flecken mit Bloom kaum heller als
  ohne (vorher deutlich heller)? Feuer und Funken über der Straße etwa gleich?
- **627**: Magie-, Eis-, Gift- und Chaos-Geschosse, Tentakel, Blitze. Tentakel mit Bloom in derselben Farbe wie ohne
  (vorher heller)? Kugeln, Spuren und Blitze über der Straße etwa gleich?
- **628**: Kamera aufs HQ, dann aufs Spawn-Portal zwischen zwei Wellen und beim Start. Diamant und Label mit Bloom wie
  ohne? Straßenlicht vor dem Portal mit Bloom nicht heller als ohne? Beschwörungskreis sichtbar wie bisher?

### Runde 8: Einzelstücke (629 bis 631)

Jeder Punkt hat seinen eigenen Aufbau.

- **629** (142): Standort-Dialog, Tab "Showcase", "Rio de Janeiro, Copacabana". Lädt der Ort ohne Zufalls-Spawn, mit
  dem Portal an deiner Stelle? Steht in der Adresszeile `s=-22.96421,-43.17463`? Fehlt "Dubai, Marina Walk" in der
  Liste?
- **630** (363): Ooze (Custom Wave) 5 s wachsen lassen und töten, gleich danach mit Shift+Rechtsklick auf "+HP" bis
  Game Over, RESTART. Sind Band und Trümmer sofort weg, keine schwebenden Knochen?
- **631**: DevWorld öffnen, Layers "Show routes" an, dann Quick Actions "Play route animation". Liegen die animierte
  und die feste rote Linie auf derselben Höhe, ohne 2 m Versatz?

## Runden (alte, noch ungetestete Punkte)

### Runde 9: Gegnermodelle (632 bis 635)

Aufbau: "Enemies" (Enemy Debug), Typ wählen, "Place enemy on route", Klick auf die Route, "Start moving".

- **632** (154, 183): Mech, Wallsmasher, Mammoth, Zombie Soldier, Bear und Stone Golem laufen lassen: stocken sie am
  Ende der Laufschleife? Rennt die Ratte? Fliegt der Drache ohne Sprung, und ist er zu hören?
- **633** (156, 154): Mit den Gegnern aus 632 zweimal `__perf.loseContext(2000)` in die Konsole. Kommt nach etwa 2 s
  "Baked N VATs again", und stehen die Gegner danach normal da? Dann Cheat "Kill": bleibt der Wallsmasher in seiner
  Endpose liegen?
- **634** (155): Ghost und Zombie gemischt setzen, Kamera so drehen, dass sie sich überdecken. Scheint kein Zombie
  durch einen Ghost davor? Verschwindet kein Ghost hinter einem Zombie, der weiter hinten steht?
- **635** (184, 185): "Waves", Single, "Zombie v2", Count 10, "Start Custom Wave", sterben lassen: fällt einer im
  Todes-Clip zu Boden, bevor er verschwindet? Danach Custom Wave "Wallsmasher": ist seine Vorschau im WAVE-Panel
  farbig?

### Runde 10: Laser und Held (636 bis 639)

Aufbau: Cheats "Abilities", "Research" und "Credits", Welle mit Bodengegnern.

- **636** (397): L. Ring mit goldenem Band Richtung Spawn, abseits der Route rot mit Hinweis? Klick vor eine Gruppe:
  oranges Band, dann eine Lichtsäule, die 4 s Richtung Portal läuft, mit Funken und Brandspur? Sieht das gut aus?
- **637** (385): Münze oben in der linken Leiste klicken. Steht der Soldat am Routenpunkt beim HQ? Fehlt in der
  Konsole "[HeroRenderer] Hero model did not load"? Sieht die Figur gut aus?
- **638** (386): G drücken (oder den Held-Knopf). Goldener Ring unter ihm und ein kleinerer auf seinem Posten? Noch
  einmal G: gleitet die Kamera zu ihm?
- **639** (388, 389): Held an eine schräge Straße schicken, Gegner nah an ihn. Starten Tracer und Mündungsfeuer an der
  Waffe, nicht im Boden oder über dem Kopf? V mehrmals: wechseln Farbe und Schussgeräusch? Explodiert die Munition
  "Explosive" am Ziel?

### Runde 11: Veteranen und viele Gegner (640 bis 643)

Aufbau: Cheat "Credits", ein Archer an die Route.

- **640** (348): Welle 1 spielen. Steht nach 10 Kills im Tower-Panel "BLOODED"? Sitzt über dem Archer ein silberner
  Winkel mit dunklem Rand, sieht er ordentlich aus?
- **641** (349): Kamera nah an den Archer (etwa 20 m), dann weit weg. Passt das Abzeichen nah zum Tower, und ist es ab
  etwa 1 100 m weg? Verschwindet es hinter einem Gebäude? Archer auf einem Dach mit Sockel: sitzt es über der Spitze?
- **642** (351, 210, 211): "Credits" und "+HP" je mehrmals mit Shift+Klick: ragt keine Zahl im Header ins
  Nachbarfeld? Viele Tower an eine Stelle, große Custom Wave: ab 150 Kills drei silberne Winkel, ab 400 drei goldene,
  ab 1 000 ein Stern? Lesbar über hellen Dächern und dunklem Himmel?
- **643** (172, 546): Etwa 10 Archer oder Gatling an eine Stelle, Custom Wave "Zombie", Count 100, Tempo 1x. Kamera
  erst weit weg, dann heran: setzen die Laufgeräusche in Hörweite ein, höchstens etwa 12 zugleich? 2 Minuten zusehen:
  bleiben die Schüsse hörbar?

### Runde 12: Blutmond (644 bis 647)

Aufbau: Display-Menü "Blood Moon" an, Cheats "Research" und "Credits".

- **644** (373): Tower auf ein Dach mit Sockel, "Jump to wave" 14, Space. Haben die Gegner einen roten Rand? Beginnt
  der Lichtkegel des Sockel-Towers oben am Tower, nicht im Sockel?
- **645** (422): In Welle 14 einen Ice Tower Zombies töten lassen. Sind Eis- und Blutflecken am Boden rot getönt wie
  der Boden, nicht hell leuchtend?
- **646** (376): In Welle 14 Display-Menü, Effects, "Bloom" an. Bleibt die rote Tönung etwa gleich? Ist der Kegel über
  hellem Boden schwächer?
- **647** (376): "Jump to wave" 20, Welle 21 starten: sind die Fledermäuse rot getönt wie die anderen? "Jump to wave"
  35: glühen die Skarnax-Ringe rot, auch der neue Kopf nach einem Split?

### Runde 13: Neustart, Musik, Game Over, Dialoge (648 bis 651)

Aufbau: je Punkt beschrieben.

- **648** (158, 181, 173): Neuen Ort laden, dann Strg+Umschalt+R, nichts klicken. Kein "Uncaught" in der Konsole
  (höchstens "[MusicMixer] Audio context did not resume")? Erster Klick: Main Theme, nach dem Intro der Build-Track
  mit Überblendung? Audio-Menü: wirken Musik aus, an und Lautstärke sofort?
- **649** (341, 173): Welle 1, Rechtsklick auf "+HP" bis Game Over. Blendet die Musik aus? Erscheint nach etwa 1,2 s
  unter RESTART ein kleiner Globus mit "First run here", ohne dass RESTART springt? Blendet "Skip" den Hinweis aus?
- **650** (160, 162): Im BUILD-Panel die Info "Damage vs armor" öffnen und mit Esc schließen. Ist der Übergang
  animiert, die Schrift wie gewohnt? Bleibt der Kopf des Dialogs beim Scrollen stehen?
- **651** (326): Im WAVE-Panel mit Tab auf die NEXT-Rauten: ist der goldene Fokusrahmen gut sichtbar?

## Daten vom User

- **D1 Tokyo (142):** Showcase "Tokyo, Shibuya Crossing" laden. Macht die Route eine Schlaufe um einen Block: URL aus
  der Adresszeile schicken, dazu die Ausgabe von `__routes.describe()`.
- **D2 Erlenbach unter der Autobahn (alte 53):** Weinsberger Straße unter der Autobahnbrücke. `__corridor.pick()`,
  Linksklick auf die rote Linie mitten unter der Brücke, die Zeile `[Corridor] column at the click` schicken. Dann F5:
  liegen Zellen und Gegner danach auf der Straße? Das zeigt die Ursache, behoben ist noch nichts.
- **D3 Feste Spawns für Showcases (142):** Für jeden Showcase-Ort, der einen festen Spawn bekommen soll: Ort laden,
  Header "Set spawn" an die gewünschte Stelle (R dreht das Portal), `__showcase.line()` in die Konsole, Zeile schicken.
- **D4 Klumpen ohne Beschuss (363):** Steht in 618 ein Tower still, obwohl Klumpen in seinem Ring sind: seine Zeilen
  mit `[TowerTargets]` aus der Konsole kopieren (die Tower-ID steht vorn), den Tower anklicken, Screenshot mit Ring.
  `__towerTargets.watch(false)` beendet die Ausgabe.
- **D5 optional (alte 53):** Kennst du einen Ort mit Tunnel oder überdachtem Durchgang auf der Route? URL schicken,
  sonst bleibt der Punkt liegen.

## Entscheidungen

Einzeln vorlegen. Die Lead-Entscheidungen sind gebaut und lassen sich einzeln zurücknehmen.

**Lead-Entscheidungen zum Bestätigen**

- **E1 Center-Tipp nach Welle 2:** Der Tipp "Build a research center" kommt erst nach Welle 2
  (`RESEARCH_TIP_AFTER_WAVE`). Bestätigen oder eine andere Welle nennen.
- **E2 Laser-Bot-Zählung:** Die Bot-Strategie zählt Gegner bis 72 m hinter dem vordersten, der Strahl trifft im
  5-m-Radius; eine Näherung, nur für Trainingsläufe. Bleibt, weil eine Änderung die Bot-Läufe verschiebt.
- **E3 Boss-Varianten im Log:** Welche Welle mit Skarnax oder Ooze ins Log des Collectors gehört, wartet auf den
  Run-Dump. Bis dahin bleibt es, wie es ist.
- **E4 Wackeln bei HQ-Treffern:** "Härter" heißt mehr HP: ein Treffer, der mehr HP kostet, kommt durch die
  900-ms-Drossel, die Stärke bleibt gedeckelt (`d48b5c87`). Alternative: härter heißt stärkeres Wackeln.
- **E5 Tower-Sicht neben Autos:** Für Zellen, die der Stufen-Check auf Straßenhöhe setzt, prüft die Sichtlinie über
  dem Objekt; der Tower schießt dann auf Gegner "im Auto" (`66569eca`). Seit Autozellen wegfallen, kaum noch
  sichtbar. Bestätigen oder zurücknehmen.
- **E6 Mittellinienzellen auf Dach oder Erker:** Läuft die OSM-Linie selbst unter einem Erker oder über eine Dachecke,
  bleibt die Zelle, bekommt aber Straßenhöhe (`f75e72ab`). Alternative: Zelle oben lassen, dann `f75e72ab` und
  `afb3ad2d` zusammen zurücknehmen.
- **E7 Brückenenden ohne Niedrig-Hindernis-Probe:** Bis 40 m hinter einem Brückenende prüft der Korridor keine
  niedrigen Hindernisse, auch wo die Zufahrt schon auf Bodenhöhe liegt; Autos engen dort nur über den Laufweg ein
  (`347ae61b`).
- **E8 Heldenschüsse auf schrägen Straßen:** Seit Gegner und Held metrisch ausgerichtet werden, starten seine Schüsse
  auf Diagonalen etwa 0,5 m anders, dort, wo das Modell die Waffe hält (`fa7712ec`).
- **E9 Klumpen-Befund ohne Code-Fix:** Im Test nicht nachstellbar. Statt einer Änderung gibt es die Sonde
  `__towerTargets` (618, D4); ein Fix erst mit Daten.
- **E10 Additives Licht mit Bloom:** `ADDITIVE_GROUND` 0,3 wie beim Beschwörungskreis. Mit Bloom sind additive Effekte
  über hellem Boden schwächer als vorher, über dunklem kräftiger. Das alte Verhalten entspräche etwa 0,53, eine Zahl
  in `display-output.ts`.
- **E11 Ooze-Gold bei junger Ooze:** Voller Körper zahlt gleich viel, eine jung getötete weniger (Welle 45, 1,5 m
  Körper: 1142 statt 2181 Gold; 27 m: 4568 statt 4363). Genau gleich ginge nur mit gewichteten Slots für alle Gegner
  (`2acf7db9`, Tabelle in `tmp/fix1/reports/oozedeath.md`).
- **E12 Debug-Checkboxen entfernt:** "Textures", "Skeleton Clone" und "Alpha Blend" im Debug-Fenster Display
  (Abschnitt "Performance") waren wirkungslos und sind weg (`1427f5c0`).

**Neu zu entscheiden**

- **E13 `immunityPercent`:** Steht bei Herbert auf 100, wirkt aber nirgends. Entfernen oder an Schaden und Anzeige
  anbinden?
- **E14 Assets und Features:** Welche willst du, in welcher Reihenfolge? Warnsirene des Atomschlags; eigene Sounds
  für Frost und EMP; Laser-Ton am Startpunkt; Skarnax (Textur, bewegte Beine, Schwanzstück, Mandibeln, Sound am
  Kopf, Healthbar je Ring); Tod-Sound der Schleimklumpen; Mech und Ghost über dem Modell-Budget; Gold-Popup der Ooze
  an der Spitze; größere Eiskristalle an großen Gegnern; Held Stufe 2; Schrägstütze für Sockel an der Dachkante.

Schon entschieden, nicht mehr vorlegen: Wurm-Ecken, Held ohne Ersatzmodell, Boss-Intro mit Hindernis-Check und
Abstand 21,4 m, Vorgärten (a), Showcases mit festen Spawns und ohne Dubai, Name Skarnax, Atompilz "realistisch,
aber größer", Dachkante so lassen, Replay als eigenes Thema.

## Erledigt per Test

- 542, 321, 393, 398 (Laser auf die Wurmringe) und 400 sind per Szenario-Test bestätigt, 334 im frischen Checkout
  (`npm ci` und `ng build` je Exit 0). Suite dabei: 395 Testdateien, 4520 Tests grün.
- Ebenfalls per Test, ohne eigenen Punkt: Klumpen-HP in der Summe gleich und 1x wie 4x beim Ooze-Tod, Tower nehmen
  Klumpen als Ziel (Wächter-Szenario), Atompilz und Grollen in Pause und bei 4x, Held in der Pause nach einem
  Routen-Neubau, Blickrichtung der Gegner auf Diagonalen. Letztes Gate `3df5f9e6`: 4564 Tests grün.
