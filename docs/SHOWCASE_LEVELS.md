# Vorzeige-Level

**Status:** Alle acht gebaut auf `exp/custom-maps` (2026-10-11), Nachtest im Spiel offen

Acht Karten, die zeigen, was der Editor kann, und die sich gut spielen. Jede wird mit den Werkzeugen des Editors gebaut
(dieselben Operationen wie im Editor: Landschafts-Pinsel, Fluss, Straße, Biome, Objekte), als Bauskript unter
`tools/maps/levels/<id>.ts`, damit sie nachvollziehbar und reproduzierbar ist. `tools/maps/shipped-maps.spec.ts` packt
sie nach `public/maps/` mit Vorschaubild und Eintrag in `index.json`.

## Bauskripte

`tools/maps/levels/kit.ts` (`LevelKit`) fährt die Operationen des Editors ohne Oberfläche: jeder Landschafts-Aufruf
ist ein Strich des Landscape-Werkzeugs (`LandscapeStroke`, ein Schritt im Verlauf), dazu die Pinsel von Terrain,
Paint, Water, Objects, Paths und Spawns, der Gelände-Generator und das Prüfen des Editors. Die Seeds der Striche
kommen aus dem Seed des Levels und einem Zähler, ein Skript ergibt also immer dieselbe Karte. Bewährte Reihenfolge:
Bodenschichten festlegen (höchstens acht; Pinsel nehmen dann ihre Kandidaten aus dieser Liste), Gelände, Straßen,
Flüsse (sie machen Kreuzungen zu Brücken), Spawns und HQ, Biome und Farbe, einzelne Objekte.

Packen: `npx vitest run tools/maps/shipped-maps.spec.ts -t <id>` (mit `LEVEL_LOG=1` Spuren, Objekte, Warnungen) (ein Level allein; die Liste in `index.json` behält
die anderen). Ansehen: `/map-preview?map=<id>&cam=x,y,h,tx,ty,th&clean` (Kamera und Ziel in Kartenmetern, Höhen über
dem Boden). Bilder unter `docs/images/levels/`.

## Regeln für alle Level

- **Spielbarkeit vor Kulisse:** Wege 350 bis 800 m je Spawn, klare Bauflächen entlang der Wege (Plateaus, Lichtungen),
  Engstellen, an denen sich Türme lohnen, Sichtlinien über die Wege nicht überall verbaut. Objekte mit `blocksBuild`
  nie direkt an der Straße entlang lückenlos
- **Spawns:** 1 bis 4; mit mehr Spawns führen Wege früh zusammen, damit ein Spieler sie halten kann. Eine Coop-Karte
  (Arena) hat je Spieler eigene Spuren
- **Kartenprobe:** jede Karte besteht `?bot=trial&trialWaves=10` mit Budget-Wellen (Bot hält 10 Wellen); sonst werden
  Wege, Bauflächen oder Startgeld angepasst, nicht die Wellen
- **Leistung:** in der Spielansicht über 100 fps auf dem Entwicklungsrechner, Ladezeit im Produktions-Build unter 4 s
- **Größe:** Small (512 m) oder Medium (1024 m); Objekte höchstens etwa 15 000

## Die Level

### 1 Bergpass (`mountain-pass`)
**Gebaut** (`tools/maps/levels/mountain-pass.ts`, Small 512 m). Kartenprobe 10 Wellen bestanden (HQ 448 von 500,
19 Tower), Spielansicht 268 fps, Laden 5,8 s am Dev-Server. Spuren 765 und 770 m. Bilder:
`docs/images/levels/mountain-pass.jpg`, `mountain-pass-game.jpg`. Feinschliff: Erosion mit Rinnen und Felsbänder
(Cliff-Edge-Bögen) an den Gipfeln, Geröllfelder, dichterer Wald in den Senken, Bergwiese mit Blumen, Rauch aus den
Kaminen. Abweichungen: Schnee liegt nur auf den flacheren Gipfelpartien (an den Wänden deckt das Klippenmaterial ihn
zu; eine Schneegrenze ist beim Renderer gewünscht), die Brücke ist das Holzdeck der Wege, die Seilbahn hat keine Seile
(Objekte lassen sich nicht neigen).

Biom Berge, Look `mountain`, später Nachmittag. Ein Pass zwischen zwei Gipfeln; die Straße windet sich in Serpentinen
vom Tal zum Pass, wo das HQ in einem Bergdorf steht (Steinhäuser mit Holzbalkon, Kapelle, Stützmauern). Ein Wasserfall
stürzt von einer Klippe in einen Bergsee, der Fluss läuft talwärts unter einer Steinbrücke durch. Seilbahn als Kulisse
über dem Tal. Spawns: 2, beide im Tal, die Wege treffen sich an der ersten Kehre. Bauflächen: die Kehren-Innenseiten
und Felsterrassen über der Straße.

### 2 Sumpf bei Nacht (`witch-marsh`)
**Gebaut** (`tools/maps/levels/witch-marsh.ts`, Small 512 m). Kartenprobe 10 Wellen bestanden (HQ 416,1 von 500,
19 Tower), Spielansicht 453 fps, Laden 5,9 s am Dev-Server. Spuren 459 und 457 m. Bilder:
`docs/images/levels/witch-marsh.jpg`, `witch-marsh-game.jpg`. Die Stege sind Wege der Art Bridge (das Holzdeck mit
Geländer), gelegt, wo die Linie übers Wasser läuft; Fackeln an den Stegen. Feinschliff: dunkler Sternenhimmel (Look
`temperate` bei Nacht, weil der Sumpf-Look nachts helle Wolken hat; an den Renderer gemeldet), tiefe Nebelbänke übers
offene Wasser, Moos, Schlamm und Wurzeln auf den Inseln, Laternen an den Pfahlhütten, Kessel und Leuchtpilze.

Biom Sumpf, Look `swamp`, Nacht mit Bodennebel und Glühwürmchen. Ein Bohlenweg über Sumpfwasser, Inseln mit
Pfahlhütten, die Hexenhütte mit grün leuchtenden Fenstern als HQ-Kulisse, Laternen an den Stegen als einzige
Lichtinseln. Spawns: 2 aus dem Nebel im Norden und Westen; die Stege verzweigen und treffen sich auf einer großen
Insel. Bauflächen: die Inseln; das Wasser selbst ist nicht bebaubar.

### 3 Burgruine im Herbst (`autumn-keep`)
**Gebaut** (`tools/maps/levels/autumn-keep.ts`, Small 512 m). Kartenprobe 10 Wellen bestanden (HQ 299,4 von 500,
19 Tower), Spielansicht 362 fps, Laden 5,7 s am Dev-Server. Spuren 356, 377 und 363 m. Bilder:
`docs/images/levels/autumn-keep.jpg` (Burghof), `autumn-keep-bailey.jpg`, `autumn-keep-game.jpg`. Feinschliff: Burg
84 x 76 m statt 60 x 60 m, Mauern und Torhaus größer, Bergfried höher, sechs Turmruinen an Ecken und Mauern, Lücken
im Mauerzug; Felsen, Efeu und Gestrüpp um die Hügelkrone; Laub und Farbflecken auf der Wiese. Der Herbstwald ist der
Wald-Pinsel, dessen Sommerbäume danach gegen ihre Herbstvarianten getauscht werden (ein Herbst-Biom fehlt dem
Landscape-Werkzeug); Morgennebel nur als wenige kleine Nebelfelder, größere wirken von oben wie Schnee.

Biom Laubwald mit Herbstfarben, Look `day` warm. Eine Burgruine auf einem Hügel, Mauerreste, Bergfried-Ruine, ein
Torhaus. Drei Wege kommen aus den Wäldern und treffen sich vor dem Tor; das HQ steht im Burghof. Laubhaufen, Efeu,
Nebel in den Senken am Morgen. Spawns: 3. Bauflächen: Mauerkronen-Nähe, Lichtungen.

### 4 Wüstencanyon (`red-canyon`)
**Gebaut** (`tools/maps/levels/red-canyon.ts`, Small 512 m). Kartenprobe 10 Wellen bestanden (HQ 409,4 von 500,
19 Tower), Spielansicht 601 fps, Laden 7,4 s am Dev-Server. Feinschliff: Dünenfelder, Gestrüpp- und
Kakteengruppen, Steinstreu und weitere Felstürme auf der Hochebene. Spuren 506 und 553 m. Bilder:
`docs/images/levels/red-canyon.jpg` (Tempelbecken), `red-canyon-floor.jpg`, `red-canyon-game.jpg`. Die Schluchten
sind mit dem Level-Pinsel entlang einer Linie geschnitten und mit dem Terrace-Pinsel gestuft; Tafelberge mit dem
Cliff-Pinsel (Plateau) und einer Rampe.

Biom Wüste, Look `desert`, harte Mittagssonne mit Hitzedunst. Ein verzweigter Canyon mit Tafelbergen; die Wege laufen
im Canyon-Boden, Türme stehen oben auf den Tafelbergen (Plateaus mit Rampen). Tempelruine als HQ, Oase mit Palmen,
Karawanenzelte. Spawns: 2. Bauflächen: Plateaus über dem Canyon (Sichtlinie nach unten).

### 5 Inselarchipel (`archipelago`)
**Gebaut** (`tools/maps/levels/archipelago.ts`, Small 512 m). Kartenprobe 10 Wellen bestanden (HQ 336,2 von 500,
18 Tower), Spielansicht 539 fps, Laden 9,8 s am Dev-Server. Spuren 365 und 363 m. Bilder:
`docs/images/levels/archipelago.jpg`, `archipelago-game.jpg`. Strände, Felsufer und Wiesen mit „Auto paint“ nach
Höhe und Neigung; der Hafen ist bis ans Südufer ausgebaggert (Level-Pinsel unter Wasser), die Furt ein Pfad über eine
Sandbank knapp unter dem Spiegel (die Prüfung warnt dort bewusst „under water“).

Biom gemäßigt/Küste, Meer rundum, Look `day` klar. Fünf Inseln, verbunden durch Holzbrücken und Furten; Hafen mit
Kaimauer, Kran, Fischerhütten, Leuchtturm. Gegner kommen über zwei Brückenketten zur Hauptinsel. Spawns: 2. Bauflächen:
Inselränder an den Brückenköpfen.

### 6 Winterdorf (`frost-hamlet`)
**Gebaut** (`tools/maps/levels/frost-hamlet.ts`, Small 512 m, 1,0 MB). Kartenprobe 10 Wellen bestanden (HQ 342,4 von
500, 19 Tower), Spielansicht 513 fps, Laden 4,5 s am Dev-Server. Spuren 686 (Straße mit Laternen) und 394 m (übers
Eis). Bilder: `docs/images/levels/frost-hamlet.jpg`, `frost-hamlet-game.jpg`. Unter dem Eisweg liegt ein Rücken knapp
unter der Eisfläche, so laufen die Gegner auf dem Eis; die Prüfung warnt dort bewusst „under water“.

Biom Schnee/Arktis, Look `arctic`, leichter Schneefall, später Abend mit Laternen. Ein Dorf mit verschneiten Häusern um
einen zugefrorenen See (Eisfläche), Eisfischerhütten, Holzstapel, Schlitten. Die Straße führt um den See; ein zweiter Weg
über das Eis (Gegner laufen übers Eis). Spawns: 2. Bauflächen: Seeufer, Dorfplatz.

### 7 Vulkankrater (`ember-crater`)
**Gebaut** (`tools/maps/levels/ember-crater.ts`, Small 512 m). Kartenprobe 10 Wellen bestanden (HQ 463,3 von 500,
19 Tower), Spielansicht 698 fps, Laden 4,7 s am Dev-Server. Spuren 772, 402 und 609 m. Bilder:
`docs/images/levels/ember-crater.jpg`, `ember-crater-game.jpg`. Der Krater ist ein Strich des Crater-Pinsels (200 m),
der Lavasee mit „Dig lake“ in einen Lava-Körper gegraben; die Lavabrücke ist das Modell über einem Damm aus zwei
Rampen bis zu seinem Deck, der Weg ist eine Straße darauf. Lavaströme nur außen am Hang (sie würden die Spirale
schneiden).

Biom Hölle/Vulkan, Look `hell`. Ein großer Krater mit Lavasee; ein Spiralweg führt vom Kraterrand hinab zum HQ auf
einer Obsidianinsel im Lavasee, über eine Lavabrücke. Glutrisse, Lavaströme, Schmiede am Rand, Rauchsäulen. Spawns: 3
am Kraterrand, die Wege münden in die Spirale. Bauflächen: Terrassen zwischen den Spiralwindungen.

### 8 Spiegel-Arena (`twin-gates`)
**Gebaut** (`tools/maps/levels/twin-gates.ts`, Small 512 m). Kartenprobe 10 Wellen bestanden, allein mit vier Spuren
knapp (HQ 164,5 von 500, 19 Tower; Verluste fast nur in den Wellen 1 bis 3), Spielansicht 416 fps, Laden 4,2 s am
Dev-Server. Vier Spuren zu je 474 m, Startgeld 250 je Spur (`gameplay.startCredits`; mit 100 und 150 hielt der Bot
ebenfalls, aber mit 124 und 140 HP). Bilder: `docs/images/levels/twin-gates.jpg`, `twin-gates-castle.jpg`,
`twin-gates-game.jpg`. Gebaut mit Mirror X: Pinsel kopieren ihre Zellen, Linien und Objekte entstehen gespiegelt; den
Generator-Boden spiegelt `mirrorFrom` einmal von West nach Ost. Was auf der Achse steht (Bergfried hinter dem HQ),
ist ohne Symmetrie gesetzt.

Biom gemäßigt mit Burgmauern, Look `dusk`. Streng symmetrische Coop-Karte (Spiegelung an X): zwei Burgen, je zwei
Spuren pro Spieler, die sich in der Mitte am gemeinsamen HQ treffen. Gestaltet mit dem Symmetrie-Modus. Spawns: 4.
Bauflächen gespiegelt, gleiche Chancen für beide Spieler.

## Prüfung und Messung

`tools/maps/shipped-maps-check.spec.ts` (läuft mit `npm test`) prüft jede Karte aus `index.json`: Datei gültig, Hash
wie im Eintrag, Prüfen des Editors ohne Fehler, jeder Spawn erreicht das HQ über die Straßen, wie das Spiel routet
(300 bis 1200 m inklusive des letzten Stücks zum HQ), keine Objekte mit `blocksBuild` auf Straßen (Tore und Bögen, durch
die die Straße führt, ausgenommen), nur Assets und Materialien aus dem Katalog, höchstens 15 000 Objekte und 6 MB.

`e2e/perf/shipped-maps.ts` misst alle Karten am Produktions-Build: Laden kalt (frischer Browser, kein Shader-Cache) und
warm (derselbe Browser noch einmal), jeweils über das Startmenü bis `load:ready`, Bilder je Sekunde in der Spielansicht
ohne Bildratengrenze, Kartenprobe `?bot=trial&trialWaves=10` mit Budget-Wellen. Druckt die Tabelle unten.

### Messung

Entwicklungsrechner, Chromium mit GPU, 1600 x 900, 2026-10-11, nach dem Feinschliff über alle acht. Laden und
Spielansicht am Produktions-Build (`e2e/perf/shipped-maps.ts --no-trial`), Kartenprobe am Dev-Server mit der
Wasser-Bausperre:

| Karte | Laden kalt | Laden warm | Spielansicht | Kartenprobe |
|-------|-----------|-----------|--------------|-------------|
| Demo Valley (`demo-valley`) | 4,1 s | 3,3 s | 328 fps | |
| Mountain Pass (`mountain-pass`) | 4,7 s | 3,6 s | 373 fps | bestanden, HQ 449,9/500, 19 Tower |
| Witch Marsh (`witch-marsh`) | 4,0 s | 3,1 s | 570 fps | bestanden, HQ 408,5/500, 19 Tower |
| Autumn Keep (`autumn-keep`) | 4,3 s | 3,2 s | 354 fps | bestanden, HQ 298,7/500, 19 Tower |
| Red Canyon (`red-canyon`) | 4,3 s | 3,3 s | 550 fps | bestanden, HQ 422,4/500, 19 Tower |
| Archipelago (`archipelago`) | 4,2 s | 3,3 s | 404 fps | bestanden, HQ 325/500, 18 Tower |
| Frost Hamlet (`frost-hamlet`) | 4,1 s | 3,5 s | 413 fps | bestanden, HQ 355,4/500, 19 Tower |
| Ember Crater (`ember-crater`) | 4,2 s | 3,1 s | 611 fps | bestanden, HQ 440,6/500, 19 Tower |
| Twin Gates (`twin-gates`) | 3,8 s | 3,1 s | 360 fps | bestanden, HQ 150,1/500, 19 Tower |

Kalt liegen die Karten wie das Demo-Tal knapp über 4 s, warm unter 4 s. Bis auf den Archipel haben alle Karten fünf
Bodenschichten statt acht (`kit.trimLayers`, die am wenigsten genutzten gehen; beim Archipel fielen dabei die Strände
weg). Die Werte streuen auf dem geteilten Rechner stark: ein zweiter Lauf maß Mountain Pass kalt mit 7,9 s, Twin Gates
im ersten Lauf warm mit 6,7 s und 120 fps.

## Weitere bei Bedarf
Mondbasis (Krater, Habitate, Erde am Himmel), Mars-Canyon (rote Dünen, Rover), Endzeit-Stadt (Ruinen, Wracks, Smog),
Hafenstadt (Kanäle mit Brücken).
