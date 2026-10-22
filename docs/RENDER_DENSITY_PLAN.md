# Zeichendichte: viel mehr Objekte bei gleicher Leistung (Plan, 2026-10-21)

**Status:** Plan mit Ausgangsmessung (Abschnitt 2), Entscheidungen in Abschnitt 10. Die ganze Würzburg-Karte nachgemessen
(2.8); (b) Pixelgrenze gebaut 2026-10-21 (2.9), Sicht-Cube mit fester Stufe (2.10), (d) Linien als Element und Band
(2.11). TODO E304.

**Bezug:** [CUSTOM_WORLD_PERF_VISUAL_PLAN.md](CUSTOM_WORLD_PERF_VISUAL_PLAN.md) (V2: eine InstancedMesh je Asset,
Stufe und Teil, LOD nach Bildanteil), [LEVEL_EDITOR.md](LEVEL_EDITOR.md#szenenkosten) (Szenenkosten, Budget),
[RENDER_QUALITY.md](RENDER_QUALITY.md) (Stufen), [LOS_PIPELINE.md](LOS_PIPELINE.md) (Sicht-Cube der Tower),
[DESTRUCTION_PLAN.md](DESTRUCTION_PLAN.md) (Ruinen), [BENCHMARKS.md](BENCHMARKS.md) (Grafik-Benchmark im Spiel).

Ziel des Users: „viel mehr zeichnen bei gleicher Leistung, ohne Kompromisse“. Gemeint sind eigene Karten und
OSM-Welten (Objekte, Gebäude, Linien); echte Orte (3D-Tiles) sind nicht Gegenstand, außer im WebGPU-Abschnitt.

## 1. Kurzfassung

- Auf der RTX 5080 kostet die Karte im Bild 1,0 bis 2,6 ms GPU (1600 × 900, High); im Spiel selbst misst der
  Grafik-Benchmark 1,25 ms (Ruined City) und 2,05 ms (Würzburg) in der Spielansicht. Die GPU ist hier nicht die Grenze.
  Der größte Einzelposten ist der **Boden** (0,7 bis 1,1 ms), nicht die Objekte (je Kategorie meist unter 0,4 ms).
- In den Spielansichten liegen **41 bis 69 % der Objekt-Dreiecke außerhalb des Sichtkegels** und laufen trotzdem durch
  den Vertex-Shader. Die Listen auf das Sichtbare zu kürzen spart heute gemessen 0 bis 0,33 ms (bis 15 %), weil die
  Dichte noch klein ist; auf der Lastkarte mit 200 000 Objekten 0,4 bis 0,6 ms (10 bis 16 %).
- **Hinter Gebäuden** liegen in Straßen und flachen Blicken über Städte 25 bis 35 % der Objekt-Dreiecke; das spart
  zusätzlich 0,1 bis 0,5 ms. Von oben (Spielansicht) sind es 9 bis 11 %, auf Autumn Keep (Wald, Hügel) fast nichts.
- Was heute **fehlt**, fehlt wegen der festen Sichtweite, nicht wegen der GPU: Würzburg zeigt in der Übersicht 93 %
  der Mauer- und Zaunstücke und 98 % der Gleisstücke nicht, in der Spielansicht 8 bis 11 % bzw. 7 bis 10 %. Die Stufe
  Ultra (Sichtweite × 1,25) holt die Gleise fast ganz zurück und kostet dabei keine messbare GPU-Zeit.
- Die eigentlichen Grenzen für „viel mehr“ sind **CPU** und **Schatten**: auf der Lastkarte mit 200 000 Objekten
  braucht die Stufenwahl 1,6 ms im Mittel und bis 5,7 ms je Bild, die Ansicht 2,7 ms; in Würzburg kostet allein die
  Abgabe des Bildes an den Treiber 1,8 bis 2,4 ms; ein Neubau der Schattenkarte kostet in Würzburg flach bis 4,3 ms.
  Das Budget (12 Mio. Punkte) bindet in Würzburg nicht: 1,05 Mio. Punkte, nichts wurde wegen des Budgets weggelassen.
- Empfohlen: (a) Ausklammern je Instanz über Kacheln, je Pass getrennt, dann (b) Sichtweite nach Bildgröße mit neuer
  Kostenrechnung, (d) Linien als Band, (c) HLOD je Kachel, zuletzt (e) Verdeckung. WebGPU nicht jetzt (Abschnitt 9).

## 2. Ausgangsmessung

### 2.1 Werkzeug und Bedingungen

- Probe `e2e/perf/render-density.ts` (neu): Production-Build auf eigenem Port (4440), `/map-preview` je Karte und
  Kamera, Chromium (Playwright, Chrome 141) mit ANGLE D3D11, Bilder ohne V-Sync, sichtbares Fenster 1600 × 900,
  DPR 1, Stufe High. JSON-Ausgabe, Bilder und Tiefenbild je Ansicht mit `--shots`. Aufruf und Felder im Kopf der Datei.
- Rechner: Windows 11, NVIDIA GeForce RTX 5080 (Treiber 610.88). Eine Maschine; Zeiten auf schwächeren GPUs
  skalieren grob mit deren Leistung, die Anteile bleiben.
- Gemessen wird die Karte, wie das Spiel sie zeichnet (Objekte, Gebäude aus dem Grundriss, Boden, Wasser, Himmel,
  Sonnenschatten), aber ohne Spiel darum: kein Tower, kein Gegner, kein Sicht-Cube, kein Post-Processing. Der Production-
  Build öffnet `/map-preview` erst, wenn die eigenen Karten freigegeben sind; gemessen wurde mit einem Build, in dem
  `CUSTOM_MAPS_RELEASED` nur für diesen Build auf `true` stand (nicht committet).
- **GPU-Zeit**: `EXT_disjoint_timer_query_webgl2` um jeden `render`-Aufruf eines Bildes, je Bild summiert, Median.
  Zwischen zwei Läufen derselben Ansicht schwankt der Wert um bis zu ±0,3 ms (Takt der GPU); deshalb werden die
  Varianten einer Ansicht abwechselnd im selben Lauf gemessen und gepoolt (vier Runden), Unterschiede unter 0,05 ms
  sind keine.
- **Je Kategorie** (Gebäude mit Grundriss-Bau, Bäume, Pflanzen, Felsen, Linien = Katalog `wall` (Mauern, Zäune,
  Hecken, Stützmauern), Gleise (Gleis, Oberleitung, Bahnübergang, Prellbock), übrige Möblierung, Bauwerke, Boden,
  Wege, Wasser, Himmel): Draw Calls, Instanzen, Dreiecke im Hauptpass, und die GPU-Zeit, die das Ausblenden der
  Kategorie spart.
- **Sichtkegel**: je gezeichneter Instanz die Kugel um ihr Modell gegen die sechs Ebenen der Kamera.
- **Verdeckung**: ein Tiefenbild der Gebäude (400 × 225, eine zweite three-Instanz zeichnet die Geometrie der Seite
  mit einem Tiefenmaterial), daraus eine Max-Pyramide wie bei einem Hi-Z-Culler; eine Instanz gilt als verdeckt, wenn
  der nächste Punkt ihrer Kugel hinter der fernsten Tiefe ihres Bildrechtecks liegt. Hügel zählen nicht als Verdecker
  (das Gelände holt seine Höhen im Shader aus einer Textur); auf hügeligen Karten ist der Anteil also eine Untergrenze.
- **Gemessener Gewinn der Instanzlisten-Kürzung**: die Instanzlisten werden für ein paar Bilder auf die Instanzen im
  Sichtkegel (und zusätzlich auf die nicht verdeckten) zusammengeschoben, `count` gesetzt, GPU-Zeit gemessen,
  danach zurück. Das ist genau, was ein Ausklammern je Instanz der GPU lässt, ohne die CPU-Kosten dafür.
- **CPU**: Zeit von `MapObjectLayer.update` (Stufen je Objekt, Instanzlisten) und der ganzen Ansicht, während die
  Kamera 3 s lang 60 m fährt und sich dreht. Dazu die Zeit des `render`-Aufrufs selbst (Abgabe an den Treiber).
- **Schatten**: die Sonnenschattenkarte entsteht nur nach einer Änderung neu (über vier Bilder verteilt,
  `shadow-parts.ts`). Gemessen ist ein ganzer Neubau je Bild (`invalidateShadowsNow`), also die Kosten eines Neubaus.
- **Was die feste Sichtweite weglässt**: je Kategorie die platzierten Objekte und wie viele davon von hier keine
  Stufe zeigen (jenseits ihrer `drawDistance`).

Karten: Ruined City und Autumn Keep (mitgeliefert), Würzburg als OSM-Welt 2,4 × 2,4 km (aus den Rohdaten von E297
mit dem Stand dieses Commits neu erzeugt, flach, 10 899 Objekte, Szenenkosten 1,05 Mio. Punkte), dazu die Lastkarte der
Vorschau (`?big=1201&objects=…`, 2,4 km, Bäume, Büsche, Felsen, Häuser gleichverteilt) mit 20 000 und 200 000 Objekten.

Ansichten: `start` die Startansicht des Spiels (400 m hoch, 145 m südlich des HQ, 60°), `game` gezoomt wie im Spiel
(90 m hoch, 110 m zurück), `low` flach über die Karte (35 m hoch, Blick 600 m weit), `top` die ganze Karte vom
Südrand, `street` in Augenhöhe in einer Straße.

### 2.2 Je Ansicht

Stufe High. „nur Sichtkegel“ und „+ ohne Verdeckte“: GPU-Zeit mit den gekürzten Listen (gemessen, abwechselnd mit
der Ansicht wie gezeichnet, je vier Runden gepoolt). „Schatten-Neubau“: Mehrkosten eines ganzen Neubaus in einem Bild.
„Abgabe `render`“: Hauptthread-Zeit des `render`-Aufrufs (enthält die Zählhaken der Probe an jedem Mesh, also etwas
mehr als im Spiel). „LOD-CPU“: `MapObjectLayer.update` während einer Kamerafahrt.

| Karte | Ansicht | Stufe | Calls | Dreiecke (Mio.) | Instanzen | GPU ms | nur Sichtkegel ms | + ohne Verdeckte ms | Schatten-Neubau +ms | Abgabe `render` ms | LOD-CPU ms Mittel / Max | Ansicht-Update ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ruined City | start | high | 103 | 1,84 | 4683 | 1,29 | 1,29 | 1,28 | 0,26 | 0,42 | 0,07 / 0,51 | 0,20 |
| Ruined City | game | high | 158 | 5,05 | 8262 | 1,90 | 1,82 | 1,75 | 0,37 | 0,73 | 0,12 / 1,92 | 0,33 |
| Ruined City | low | high | 140 | 2,65 | 5698 | 1,47 | 1,46 | 1,33 | 0,38 | 0,61 | 0,11 / 0,58 | 0,32 |
| Ruined City | top | high | 130 | 2,28 | 5561 | 1,56 | 1,55 | 1,52 | 0,38 | 0,56 | 0,09 / 0,64 | 0,26 |
| Ruined City | street | high | 120 | 7,30 | 10077 | 2,13 | 1,88 | 1,46 | 0,72 | 0,57 | 0,11 / 1,56 | 0,30 |
| Autumn Keep | start | high | 133 | 0,62 | 4525 | 1,04 | 1,04 | 1,03 | 0,20 | 0,60 | 0,05 / 0,71 | 0,18 |
| Autumn Keep | game | high | 174 | 3,33 | 9966 | 1,76 | 1,69 | 1,68 | 0,53 | 0,84 | 0,11 / 0,52 | 0,36 |
| Autumn Keep | low | high | 186 | 2,55 | 6595 | 1,49 | 1,45 | 1,45 | 0,18 | 0,88 | 0,10 / 0,84 | 0,31 |
| Autumn Keep | top | high | 158 | 0,86 | 5414 | 1,33 | 1,32 | 1,32 | 0,31 | 0,72 | 0,07 / 0,51 | 0,27 |
| Autumn Keep | street | high | 170 | 3,66 | 10136 | 1,77 | 1,69 | 1,70 | 0,43 | 0,86 | 0,09 / 0,70 | 0,31 |
| Würzburg | start | high | 194 | 1,83 | 35220 | 1,60 | 1,54 | 1,54 | 0,48 | 0,81 | 0,09 / 0,63 | 0,37 |
| Würzburg | game | high | 322 | 3,29 | 38106 | 2,25 | 1,92 | 1,85 | 0,61 | 1,87 | 0,19 / 0,84 | 0,63 |
| Würzburg | low | high | 399 | 3,91 | 37173 | 2,42 | 2,35 | 2,14 | 4,27 | 2,40 | 0,21 / 0,95 | 0,70 |
| Würzburg | top | high | 182 | 1,53 | 29814 | 2,27 | 2,26 | 2,27 | 0,68 | 0,56 | 0,08 / 0,74 | 0,20 |
| Würzburg | street | high | 325 | 3,77 | 38211 | 2,56 | 2,30 | 1,78 | 0,99 | 1,84 | 0,19 / 0,84 | 0,53 |

### 2.3 Wohin Dreiecke und GPU-Zeit gehen

Je Zelle: Dreiecke im Hauptpass / gesparte GPU-Zeit in ms, wenn die Kategorie ausgeblendet ist (abwechselnd gemessen,
Rauschen etwa ±0,2 ms, „-“ ohne Messwert). Gebäude enthalten die aus dem Grundriss gebauten Wände und Dächer.

| Karte | Ansicht | Boden | Gebäude | Bäume | Pflanzen | Felsen | Linien | Gleise | Möblierung | Bauwerke | Wege | Wasser | Gras | Himmel |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ruined City | start | 188k / 0,80 | 380k / 0,20 | 3k / -0,00 | 550k / - | 4k / - | 1k / -0,00 |  | 667k / - | 6k / - | 18k / 0,01 | 3k / 0,04 |  | 2k / 0,01 |
| Ruined City | game | 179k / 0,87 | 566k / 0,36 | 34k / 0,01 | 2775k / 0,33 | 74k / 0,02 | 5k / -0,01 |  | 1367k / 0,06 | 7k / 0,01 | 18k / 0,02 | 3k / 0,03 |  | 2k / 0,00 |
| Ruined City | low | 188k / 0,77 | 392k / 0,21 | 17k / 0,03 | 1031k / 0,18 | 38k / 0,03 | 4k / 0,00 |  | 940k / - | 6k / 0,01 | 16k / 0,00 | 3k / 0,04 |  | 2k / 0,05 |
| Ruined City | top | 188k / 0,95 | 387k / 0,25 | 16k / 0,00 | 735k / 0,11 | 34k / -0,00 | 2k / 0,01 |  | 869k / - | 6k / 0,01 | 20k / 0,02 | 3k / 0,06 |  | 2k / 0,00 |
| Ruined City | street | 133k / 0,67 | 725k / 0,52 | 41k / 0,02 | 4564k / 0,59 | 86k / 0,05 |  |  | 1711k / - | 5k / 0,02 | 20k / 0,00 |  |  | 2k / 0,05 |
| Autumn Keep | start | 188k / 0,78 | 13k / 0,01 | 59k / 0,10 | 67k / 0,03 | 181k / 0,06 | 46k / 0,01 |  | 15k / 0,01 |  | 22k / 0,02 | 1k / 0,05 |  | 2k / 0,01 |
| Autumn Keep | game | 133k / 0,94 | 21k / 0,27 | 629k / 0,23 | 1155k / 0,16 | 482k / 0,22 | 50k / 0,03 |  | 17k / 0,00 |  | 22k / -0,23 | 1k / 0,02 | 0k / 0,11 | 2k / -0,01 |
| Autumn Keep | low | 170k / 0,79 | 13k / 0,02 | 503k / 0,31 | 721k / 0,10 | 252k / 0,09 | 49k / 0,06 |  | 15k / -0,03 |  | 7k / -0,00 | 1k / 0,03 | 0k / 0,12 | 2k / 0,03 |
| Autumn Keep | top | 188k / 0,97 | 13k / 0,01 | 228k / 0,19 | 157k / 0,06 | 180k / 0,05 | 33k / 0,01 |  | 15k / 0,00 |  | 24k / 0,02 | 1k / 0,03 |  | 2k / -0,00 |
| Autumn Keep | street | 124k / 0,82 | 19k / 0,02 | 697k / 0,24 | 1429k / 0,21 | 480k / 0,23 | 50k / 0,04 |  | 17k / 0,01 |  | 24k / 0,02 | 1k / 0,04 | 0k / 0,11 | 2k / 0,06 |
| Würzburg | start | 669k / 1,06 | 178k / 0,18 | 12k / 0,01 | 2k / -0,00 |  | 141k / 0,02 | 148k / 0,03 | 385k / 0,09 | 5k / -0,01 | 112k / 0,11 | 36k / 0,05 |  | 2k / 0,00 |
| Würzburg | game | 607k / 1,00 | 548k / 0,62 | 94k / 0,08 | 5k / -0,21 |  | 347k / 0,11 | 470k / 0,07 | 665k / 0,12 | 5k / -0,12 | 134k / -0,16 | 24k / 0,00 | 0k / 0,15 | 2k / 0,05 |
| Würzburg | low | 887k / 0,98 | 587k / 0,62 | 93k / -0,19 | 5k / 0,01 |  | 327k / 0,03 | 401k / 0,07 | 494k / -0,13 | 5k / 0,22 | 128k / 0,07 | 28k / 0,05 | 0k / 0,10 | 2k / -0,14 |
| Würzburg | top | 1060k / - | 61k / - | 5k / - |  |  | 17k / 0,08 | 8k / - | 35k / - | 0k / - | 134k / 0,09 | 56k / - |  | 2k / - |
| Würzburg | street | 567k / 1,12 | 674k / 0,96 | 76k / 0,21 | 8k / 0,01 |  | 350k / 0,06 | 468k / 0,25 | 642k / 0,21 | 5k / 0,02 | 111k / 0,06 | 1k / 0,09 | 0k / 0,06 | 2k / -0,02 |

### 2.4 Sichtkegel, Verdeckung, Bildgröße

Nur Objekte (Gebäude, Bäume, Pflanzen, Felsen, Linien, Gleise, Möblierung, Bauwerke), Anteil der Dreiecke im
Hauptpass. „hinter Gebäuden“: im Sichtkegel, aber im Tiefenbild der Gebäude verdeckt (Hügel zählen nicht).

| Karte | Ansicht | Objekt-Dreiecke (Mio.) | außerhalb Sichtkegel (Dreiecke / Instanzen) | hinter Gebäuden | Radius unter 4 px | unter 1 px |
|---|---|---|---|---|---|---|
| Ruined City | start | 1,61 | 0 % / 0 % | 4 % | 54 % | 7 % |
| Ruined City | game | 4,83 | 41 % / 36 % | 9 % | 17 % | 2 % |
| Ruined City | low | 2,43 | 6 % / 6 % | 35 % | 33 % | 4 % |
| Ruined City | top | 2,05 | 9 % / 8 % | 8 % | 34 % | 5 % |
| Ruined City | street | 7,13 | 66 % / 65 % | 25 % | 8 % | 1 % |
| Autumn Keep | start | 0,38 | 13 % / 10 % | 0 % | 18 % | 1 % |
| Autumn Keep | game | 2,35 | 57 % / 62 % | 1 % | 8 % | 3 % |
| Autumn Keep | low | 1,55 | 53 % / 44 % | 0 % | 12 % | 2 % |
| Autumn Keep | top | 0,63 | 27 % / 21 % | 1 % | 17 % | 2 % |
| Autumn Keep | street | 2,69 | 65 % / 65 % | 0 % | 7 % | 3 % |
| Würzburg | start | 0,87 | 44 % / 39 % | 2 % | 23 % | 2 % |
| Würzburg | game | 2,13 | 69 % / 52 % | 11 % | 6 % | 0 % |
| Würzburg | low | 1,91 | 50 % / 20 % | 33 % | 19 % | 1 % |
| Würzburg | top | 0,13 | 0 % / 0 % | 0 % | 70 % | 5 % |
| Würzburg | street | 2,22 | 62 % / 56 % | 31 % | 12 % | 0 % |

### 2.5 Was die feste Sichtweite weglässt

Je Kategorie: Objekte, die von hier gar keine Stufe zeigen (jenseits `drawDistance` × `lodBias`), von allen
platzierten. Gebäude aus dem Grundriss (Mass-Layer) zeichnen immer und fehlen hier; die mitgelieferten Karten sind
klein genug, dass dort nur Pflanzen und Kleinkram fehlen. Unten dieselben Ansichten mit Stufe Ultra.

| Karte | Ansicht | Gebäude (Modelle) | Bäume | Pflanzen | Felsen | Linien | Gleise | Möblierung | Bauwerke |
|---|---|---|---|---|---|---|---|---|---|
| Ruined City | start | 0 / 209 | 0 / 61 | 6394 / 8173 | 0 / 164 | 0 / 6 |  | 405 / 1322 | 0 / 7 |
| Ruined City | game | 0 / 209 | 0 / 61 | 3991 / 8173 | 0 / 164 | 0 / 6 |  | 97 / 1322 | 0 / 7 |
| Ruined City | low | 0 / 209 | 0 / 61 | 5739 / 8173 | 0 / 164 | 0 / 6 |  | 308 / 1322 | 0 / 7 |
| Ruined City | top | 0 / 209 | 0 / 61 | 5954 / 8173 | 0 / 164 | 0 / 6 |  | 319 / 1322 | 0 / 7 |
| Ruined City | street | 0 / 209 | 0 / 61 | 2605 / 8173 | 0 / 164 | 0 / 6 |  | 19 / 1322 | 0 / 7 |
| Autumn Keep | start | 0 / 12 | 0 / 1283 | 4648 / 5288 | 16 / 163 | 0 / 33 |  | 0 / 27 |  |
| Autumn Keep | game | 0 / 12 | 0 / 1283 | 1465 / 5288 | 0 / 163 | 0 / 33 |  | 0 / 27 |  |
| Autumn Keep | low | 0 / 12 | 0 / 1283 | 3504 / 5288 | 13 / 163 | 0 / 33 |  | 0 / 27 |  |
| Autumn Keep | top | 0 / 12 | 0 / 1283 | 4463 / 5288 | 16 / 163 | 0 / 33 |  | 0 / 27 |  |
| Autumn Keep | street | 0 / 12 | 0 / 1283 | 1213 / 5288 | 0 / 163 | 0 / 33 |  | 0 / 27 |  |
| Würzburg | start | 0 / 848 | 0 / 1167 | 599 / 619 |  | 206 / 1972 | 257 / 3155 | 1335 / 2145 | 0 / 20 |
| Würzburg | game | 0 / 848 | 0 / 1167 | 499 / 619 |  | 161 / 1972 | 206 / 3155 | 866 / 2145 | 0 / 20 |
| Würzburg | low | 0 / 848 | 0 / 1167 | 510 / 619 |  | 218 / 1972 | 325 / 3155 | 1194 / 2145 | 0 / 20 |
| Würzburg | top | 0 / 848 | 1 / 1167 | 619 / 619 |  | 1837 / 1972 | 3087 / 3155 | 2145 / 2145 | 16 / 20 |
| Würzburg | street | 0 / 848 | 0 / 1167 | 425 / 619 |  | 160 / 1972 | 219 / 3155 | 767 / 2145 | 0 / 20 |
| Ruined City | game (Ultra) | 0 / 209 | 0 / 61 | 3140 / 8173 | 0 / 164 | 0 / 6 |  | 33 / 1322 | 0 / 7 |
| Ruined City | low (Ultra) | 0 / 209 | 0 / 61 | 4678 / 8173 | 0 / 164 | 0 / 6 |  | 127 / 1322 | 0 / 7 |
| Ruined City | street (Ultra) | 0 / 209 | 0 / 61 | 1987 / 8173 | 0 / 164 | 0 / 6 |  | 1 / 1322 | 0 / 7 |
| Würzburg | game (Ultra) | 0 / 848 | 0 / 1167 | 419 / 619 |  | 106 / 1972 | 18 / 3155 | 558 / 2145 | 0 / 20 |
| Würzburg | low (Ultra) | 0 / 848 | 0 / 1167 | 437 / 619 |  | 143 / 1972 | 18 / 3155 | 922 / 2145 | 0 / 20 |
| Würzburg | street (Ultra) | 0 / 848 | 0 / 1167 | 394 / 619 |  | 84 / 1972 | 18 / 3155 | 541 / 2145 | 0 / 20 |

### 2.6 Dichte: Lastkarte und Stufe Ultra

Ultra hebt `lodBias` auf 1,25 (Sichtweite der Deko × 1,25, Impostoren ab 500 m); die Lastkarte ist 2,4 km groß.
Für die Lastkarte mit 20 000 Objekten kam kein Timer-Ergebnis (der Treiber meldete die Messungen als ungültig);
die Zeilen mit 80 000 stammen aus einem früheren Lauf ohne gepoolte Runden.

| Karte | Ansicht | Stufe | Calls | Dreiecke (Mio.) | Instanzen | GPU ms | nur Sichtkegel ms | + ohne Verdeckte ms | Schatten-Neubau +ms | Abgabe `render` ms | LOD-CPU ms Mittel / Max | Ansicht-Update ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ruined City | game | ultra | 156 | 6,45 | 9411 | 2,13 | 2,01 | 1,91 | 0,41 | 0,73 | 0,12 / 0,76 | 0,38 |
| Ruined City | low | ultra | 151 | 3,78 | 7279 | 1,71 | 1,68 | 1,47 | 0,52 | 0,67 | 0,11 / 0,55 | 0,33 |
| Ruined City | street | ultra | 116 | 8,75 | 10871 | 2,23 | 1,95 | 1,50 | 0,75 | 0,54 | 0,11 / 0,71 | 0,30 |
| Würzburg | game | ultra | 355 | 4,79 | 39580 | 2,28 | 2,11 | 2,03 | 0,87 | 2,27 | 0,20 / 0,93 | 0,68 |
| Würzburg | low | ultra | 414 | 4,78 | 38556 | 2,63 | 2,53 | 2,30 | 5,69 | 2,59 | 0,19 / 0,66 | 0,66 |
| Würzburg | street | ultra | 341 | 4,60 | 39328 | 2,47 | 2,56 | 1,83 | 1,15 | 2,43 | 0,18 / 0,83 | 0,48 |
| Lastkarte 200000 | game | high | 73 | 10,51 | 151804 | 3,81 | 3,20 | 3,21 | 1,69 | 0,56 | 1,64 / 5,68 | 2,70 |
| Lastkarte 200000 | low | high | 116 | 12,09 | 153170 | 4,26 | 3,84 | 3,84 | 1,51 | 0,64 | 1,51 / 3,64 | 2,76 |
| Lastkarte 80000 | game | high, früherer Lauf | 73 | 4,66 | 60692 | 2,01 | 1,81 | 1,66 | - | 0,28 | 0,42 / 3,45 | 1,12 |
| Lastkarte 80000 | low | high, früherer Lauf | 116 | 5,88 | 61276 | 2,40 | 2,12 | 2,05 | - | 0,36 | 0,43 / 2,65 | 1,21 |

### 2.7 Erkenntnisse

1. **Der Boden ist der größte Posten.** Ausblenden des Bodens spart 0,7 bis 1,1 ms, 30 bis 75 % der
   Ansicht. Jede Objektkategorie liegt darunter (Gebäude in Würzburg 0,6 bis 1,0 ms, Rest meist unter 0,3 ms;
   Einzelwerte haben ±0,2 ms Rauschen, negative Werte sind Rauschen).
2. **Vieles läuft unsichtbar durch die Pipeline.** In `game` und `street` 41 bis 69 % der Objekt-Dreiecke außerhalb
   des Sichtkegels, in flachen Stadtblicken ein Drittel hinter Gebäuden. Heute kostet das wenig, weil die Dichte
   klein ist; es wird teuer, sobald die Dichte steigt (Lastkarte 200 000: 3,81 → 3,20 ms durch den Sichtkegel allein).
3. **Die feste Sichtweite schneidet das ab, was man aus der Ferne sehen will**: Gleise, Mauern, Zäune. In der
   Übersicht über Würzburg fehlen fast alle; die Stufe Ultra zeigt, dass weiter zeichnen auf dieser GPU nichts kostet
   (Würzburg `game` 2,25 → 2,28 ms, `street` 2,56 → 2,47 ms, innerhalb des Rauschens).
4. **CPU skaliert je Objekt**: Stufenwahl und Instanzlisten 0,05 bis 0,2 ms im Mittel auf den Karten, aber 1,6 ms im Mittel und
   bis 5,7 ms auf der Lastkarte mit 150 000 Instanzen; die Abgabe des Bildes (`render`) in Würzburg 1,8 bis 2,4 ms bei
   320 bis 400 Draws. Zehnmal mehr Objekte scheitern zuerst an der CPU, nicht an der GPU.
5. **Schatten**: ein Neubau der Sonnenschattenkarte (nach Kameraschwenk über den Schattenkasten hinaus oder nach
   einer Änderung) kostet 0,2 bis 1,0 ms, in Würzburg flach 4,3 ms (Ultra 5,7 ms); im Spiel verteilt sich ein Neubau über vier
   Bilder. Die
   Caster zählen voll, im Sichtkegel der Sonne, nicht der Kamera.
6. **Kleinkram**: Objekte mit weniger als 4 px Radius tragen in `game`, `low` und `street` 6 bis 33 %, in `start`
   und `top` 17 bis 70 % der Objekt-Dreiecke; unter 1 px 0 bis 9 %.
7. **Budget**: Szenenkosten Würzburg 1,05 Mio. von 12 Mio.; in den vier OSM-Orten aus E297 (Aschaffenburg, Würzburg,
   Würzburg-Garage, Würzburg-Welt) hat der Import nichts wegen des Budgets weggelassen (`dropped.budget` 0). Die
   Aussage „Budget reicht nicht für Gleise und Mauern zugleich“ ließ sich mit diesen Daten nicht nachstellen; sichtbar
   fehlen sie wegen der Sichtweite.

Abgleich mit dem ganzen Spiel (`e2e/perf/render-bench.ts`, Production, High, mit Post-Processing, ohne Tower):
Ruined City Spielansicht 1,25 ms GPU, nah 1,90 ms, Kreis 1,46 ms, oben 0,99 ms; Würzburg 2,05 / 2,47 / 2,12 / 1,65 ms;
Hauptthread (Update und Bild) Würzburg 1,6 bis 4,1 ms. Die Vorschau trifft also die Größenordnung des Spiels.

### 2.8 Die ganze Würzburg-Karte: Budget und Sichtweite (E304, 2026-10-21)

Die Würzburg-Welt oben hatte OSM-Daten nur für 1,6 × 1,0 km des 2,4-km-Quadrats (die Rohdaten aus E297), daher 10 899
Objekte. Nachgemessen auf der **ganzen** Welt: eine Overpass-Abfrage (`osmWorldQuery`, 2,4 km um 49.7932, 9.9312 plus
100 m Rand, 17 MB, 28 131 Elemente), gebaut mit `tools/osm/osm-world.spec.ts` auf dem Stand von `53b9f5d69`, flach
(ohne Höhendaten, wie oben). Ergebnis: **47 677 Objekte**, Szenenkosten 4,53 Mio. von 12 Mio. (38 %). Neu in der Probe
die Ansicht `station`: das Gleisfeld des Hauptbahnhofs aus 200 m Höhe von Süden.

**Wo das Budget bindet: im Anteil der Möblierung, nicht im Szenenbudget.** Der Import hält Teilbudgets: Möblierung
(Linien, Gleise, Punkte) 15 % = 1,8 Mio., Pflanzen 50 %, Flächen (Parkplätze, Friedhöfe, Sportplätze) 10 %, Gebäude
ohne Deckel. Auf der ganzen Karte ist die Möblierung voll (1 799 999 von 1 800 000) und lässt **8 371 Stücke** weg
(neu im Bericht: `overBudget` je Quelle):

| Quelle | gelegt | wegen Budget weggelassen |
|---|---|---|
| Gleise (Gleis, Brücke, Bahnübergang, Oberleitung, Widerlager) | 7 895 | 0 (kommen seit E303 zuerst, ganz) |
| Mauern (`wall`) | 2 144 | 3 406 (61 %) |
| Stützmauern | 2 432 | 1 134 (32 %) |
| Zäune | 1 692 | 853 (34 %) |
| Hecken | 160 | 383 (71 %) |
| Stadtmauer | 356 | 191 (35 %) |
| Lampen an beleuchteten Straßen / kartierte Lampen | 0 | 880 / 452 |
| Bänke, Mülleimer, Poller, Haltestellen, Hydranten, Brunnen, Prellböcke, Masten | 0 | 1 072 |

Alle anderen Teilbudgets binden nicht: Pflanzen 0,45 von 6 Mio., Flächen 1,11 von 1,2 Mio. (nichts weggelassen),
Läden und Schilder 0,06 von 0,72 Mio. Wohin die 4,53 Mio. Punkte gehen: Katalog-Kategorie `wall` (Mauern, Zäune, Hecken
aus Möblierung, Flächen und Gärten) 1,11 Mio., Bauwerke (fast nur Gleise) 0,96 Mio., Props 1,15 Mio. (davon **3 128 Autos auf Parkplätzen 1,01 Mio.**, 324 Punkte je Auto), Gebäude-
Modelle 0,67 Mio., Gebäude aus dem Grundriss 0,20 Mio., Bäume 0,32 Mio., Pflanzen 0,13 Mio. Der E303-Befund bestätigt
sich also in anderer Form: die Gleise scheitern nicht mehr am Budget, aber hinter ihnen fehlt der Stadt mehr als die
Hälfte ihrer Mauern, Zäune und Hecken und jede Lampe und Bank, während das Szenenbudget zu 62 % frei ist.

**Was die feste Sichtweite weglässt** (Stufe High, jenseits `drawDistance`, von allen platzierten):

| Ansicht | Linien (Mauern, Zäune, Hecken) | Gleise | Props | Pflanzen | Bäume | Bauwerke |
|---|---|---|---|---|---|---|
| start | 3 978 / 11 986 | 1 068 / 7 843 | 4 247 / 5 182 | 5 348 / 6 646 | 0 / 8 808 | 14 / 80 |
| game | 3 671 / 11 986 | 814 / 7 843 | 3 771 / 5 182 | 5 053 / 6 646 | 0 / 8 808 | 10 / 80 |
| low | 3 494 / 11 986 | 1 503 / 7 843 | 4 035 / 5 182 | 4 741 / 6 646 | 0 / 8 808 | 15 / 80 |
| top | 10 283 / 11 986 | 7 011 / 7 843 | 5 182 / 5 182 | 6 646 / 6 646 | 175 / 8 808 | 50 / 80 |
| street | 3 386 / 11 986 | 730 / 7 843 | 3 523 / 5 182 | 4 620 / 6 646 | 0 / 8 808 | 12 / 80 |
| station | 5 553 / 11 986 | 671 / 7 843 | 3 918 / 5 182 | 6 400 / 6 646 | 0 / 8 808 | 0 / 80 |

Gebäude (4 229 Modelle, 2 903 aus dem Grundriss) fehlen nirgends. Aus der Spielansicht fehlen ein Drittel der Linien und
ein Zehntel der Gleisstücke, von oben fast alle.

**Kosten je Ansicht** (High, Spalten wie in 2.2; „Sichtkegel“ und „ohne Verdeckte“ gemessen wie dort):

| Ansicht | Calls | Dreiecke (Mio.) | Instanzen | GPU ms | nur Sichtkegel ms | + ohne Verdeckte ms | Schatten-Neubau +ms | Abgabe `render` ms | LOD-CPU ms Mittel / Max | Ansicht-Update ms |
|---|---|---|---|---|---|---|---|---|---|---|
| start | 208 | 4,12 | 113 611 | 2,25 | 1,98 | 1,90 | 0,70 | 0,92 | 0,36 / 1,48 | 0,74 |
| game | 328 | 5,60 | 116 208 | 3,39 | 3,06 | 2,94 | 1,55 | 3,48 | 0,47 / 1,82 | 0,98 |
| low | 421 | 6,59 | 116 059 | 4,15 | 3,92 | 3,61 | 1,51 | 6,84 | 0,53 / 1,93 | 1,08 |
| top | 277 | 2,98 | 97 294 | 2,98 | 2,98 | 2,98 | 0,44 | 0,86 | 0,26 / 1,46 | 0,46 |
| street | 344 | 6,39 | 117 909 | 3,35 | 3,45 | 2,77 | 1,69 | 3,29 | 0,44 / 1,80 | 0,79 |
| station | 239 | 4,51 | 112 629 | 3,28 | 2,86 | 2,85 | 0,94 | 2,78 | 0,40 / 1,46 | 0,84 |

Gegen den Ausschnitt (2.2): 3- bis 4-mal so viele Instanzen, GPU 3,3 bis 4,2 ms statt 2,3 bis 2,6, die Abgabe des Bildes
an den Treiber bis 6,8 ms (flach über die Stadt, 421 Calls), die Stufenwahl 0,4 bis 0,5 ms im Mittel und knapp 2 ms
Spitze. Von den Objekt-Dreiecken liegen in `start`, `game`, `street` und `station` **65 bis 77 % außerhalb des
Sichtkegels** (Ausschnitt: 44 bis 69 %), flach und in der Straße 23 bis 26 % hinter Gebäuden. Weitere Befunde: die
Brückendecks (`path-bridges.ts`, 2 355 Stücke, ohne LOD und ohne Sichtweite) bringen in jeder Ansicht 0,6 bis
0,7 Mio. Dreiecke; die größten Einzelposten in `game` sind `wall-stone` (0,43 Mio.), Gleise (0,28 + 0,21 Mio.), das
Altstadthaus `oldtown-gable-3` (0,27 Mio.) und die Autos (vier Farben, zusammen 0,64 Mio.).

**Folgerung für (b):** die Kostenrechnung entscheidet in OSM-Städten über das Bild, nicht die GPU: auf der ganzen Karte
bleibt die GPU unter 4,2 ms, aber das Möblierungsbudget lässt Tausende Stücke gar nicht erst auf die Karte. Was (b)
an der Rechnung ändert, ändert also, was der Import legt (Abschnitt 2.9).

### 2.9 Pixelgrenze statt Sichtweite: vorher und nachher (E304 (b), 2026-10-21)

Gebaut (b): ein Objekt wird gezeichnet, solange sein Begrenzungsradius im Bild mindestens `drawPixels` einer Ansicht mit
1080 Zeilen hat (Low 3, Medium 2, High 1,5, Ultra 1 px, die Werte aus Abschnitt 8); `drawDistance` ist aus Katalog und
Code verschwunden, `lodBias` wirkt nur noch auf die Detailstufen. Sichtblocker gehen auf jeder Stufe an der Grenze von
High. Mauern und Bauwerke einer Gruppe (Gleise, Zäune, Hecken, Stützmauern, Stadtmauer) sind Stücke einer Linie und
zählen mit der Größe der ganzen Linie (`line-spheres.ts`): so bleiben sie bis zum Kartenrand, ohne die Bänder aus (d).
Die Kostenrechnung zählt jedes Objekt bis zu seiner Pixelgrenze bei High, ein Linienstück über die ganze Karte.

Gemessen mit derselben Probe, gleicher Rechner, 1600 × 900. Die Würzburg-Zeilen zeichnen **dieselbe Kartendatei**
(2.8, vor dem Umbau importiert), damit nur der Renderer wechselt. „fehlen“: platzierte Objekte, die von hier keine Stufe
zeigen (vorher jenseits der Sichtweite, nachher unter der Pixelgrenze). Rauschen der GPU-Zeit zwischen zwei Läufen
derselben Ansicht etwa ±0,15 ms (Ruined City im selben Build zweimal gemessen: 0,00 bis 0,10 ms Unterschied). Die
Abgabe `render` lag auf Würzburg mehrfach bei genau 6,8 ms, vor und nach dem Umbau; der Wert ist dort keine Messung der
Draws, sondern stößt an eine Grenze des Treibers oder der Bildfolge.

**High**

| Karte | Ansicht | GPU ms | Dreiecke (Mio.) | Calls | Abgabe `render` ms | LOD-CPU ms Mittel / Max | Schatten-Neubau +ms | fehlen: Linien + Gleise | fehlen: übrige Objekte |
|---|---|---|---|---|---|---|---|---|---|
| Ruined City | start | 1,30 → 1,32 | 1,84 → 2,01 | 103 → 98 | 0,41 → 0,39 | 0,07 / 0,55 → 0,04 / 0,35 | 0,25 → 0,27 | 0 → 0 | 6799 → 6269 |
| Ruined City | game | 2,10 → 2,09 | 5,05 → 4,86 | 158 → 158 | 0,74 → 0,71 | 0,12 / 0,71 → 0,14 / 0,77 | 0,20 → 0,30 | 0 → 0 | 4088 → 3348 |
| Ruined City | low | 1,49 → 1,64 | 2,65 → 2,70 | 140 → 139 | 0,60 → 0,61 | 0,11 / 0,59 → 0,11 / 0,58 | 0,24 → 0,36 | 0 → 0 | 6047 → 5428 |
| Ruined City | top | 1,57 → 1,58 | 2,28 → 2,33 | 130 → 131 | 0,57 → 0,58 | 0,10 / 0,60 → 0,09 / 0,55 | 0,38 → 0,38 | 0 → 0 | 6273 → 5853 |
| Ruined City | street | 2,12 → 2,10 | 7,30 → 7,04 | 120 → 120 | 0,56 → 0,56 | 0,11 / 0,82 → 0,13 / 1,17 | 0,70 → 0,70 | 0 → 0 | 2624 → 1389 |
| Autumn Keep | start | 1,29 → 1,31 | 0,62 → 0,82 | 133 → 135 | 0,59 → 0,61 | 0,06 / 0,41 → 0,06 / 0,43 | 0,27 → 0,27 | 0 → 0 | 4664 → 4318 |
| Autumn Keep | game | 2,27 → 2,26 | 3,33 → 3,39 | 174 → 174 | 0,90 → 0,88 | 0,12 / 0,53 → 0,09 / 0,60 | 0,39 → 0,50 | 0 → 0 | 1465 → 1399 |
| Autumn Keep | low | 1,86 → 1,86 | 2,55 → 2,68 | 186 → 190 | 0,89 → 0,92 | 0,10 / 0,60 → 0,11 / 0,68 | 0,16 → 0,26 | 0 → 0 | 3517 → 2900 |
| Autumn Keep | top | 1,67 → 1,71 | 0,86 → 1,11 | 158 → 164 | 0,72 → 0,77 | 0,08 / 0,48 → 0,08 / 0,51 | 0,31 → 0,33 | 0 → 0 | 4479 → 4090 |
| Autumn Keep | street | 2,31 → 2,29 | 3,66 → 3,73 | 170 → 170 | 0,88 → 1,02 | 0,10 / 0,63 → 0,09 / 0,65 | 0,60 → 0,65 | 0 → 0 | 1213 → 1127 |
| Würzburg | start | 2,25 → 2,75 | 4,12 → 6,39 | 208 → 244 | 0,92 → 1,19 | 0,36 / 1,48 → 0,25 / 1,35 | 0,70 → 0,70 | 5046 → 75 | 9609 → 4827 |
| Würzburg | game | 3,39 → 3,42 | 5,60 → 7,85 | 328 → 342 | 3,48 → 3,69 | 0,47 / 1,82 → 0,39 / 1,46 | 1,55 → 1,84 | 4485 → 64 | 8834 → 4202 |
| Würzburg | low | 4,15 → 4,59 | 6,59 → 8,78 | 421 → 440 | 6,84 → 6,83 | 0,53 / 1,93 → 0,41 / 1,60 | 1,51 → 1,35 | 4997 → 71 | 8791 → 4546 |
| Würzburg | top | 2,98 → 3,44 | 2,98 → 4,93 | 277 → 324 | 0,86 → 1,34 | 0,26 / 1,46 → 0,20 / 1,07 | 0,44 → 0,80 | 17294 → 347 | 12053 → 9823 |
| Würzburg | street | 3,35 → 4,41 | 6,39 → 8,39 | 344 → 363 | 3,29 → 6,86 | 0,44 / 1,80 → 0,36 / 2,12 | 1,69 → 1,43 | 4116 → 75 | 8155 → 4510 |
| Würzburg | station | 3,28 → 3,38 | 4,51 → 6,61 | 239 → 251 | 2,78 → 2,71 | 0,40 / 1,46 → 0,39 / 1,62 | 0,94 → 1,25 | 6224 → 40 | 10318 → 4995 |

**Ultra** (Würzburg; Ruined City und Autumn Keep wie bei High: GPU gleich innerhalb ±0,15 ms bis auf Autumn Keep
`start` und `top`, +0,14 und +0,24 ms)

| Karte | Ansicht | GPU ms | Dreiecke (Mio.) | Calls | Abgabe `render` ms | LOD-CPU ms Mittel / Max | Schatten-Neubau +ms | fehlen: Linien + Gleise | fehlen: übrige Objekte |
|---|---|---|---|---|---|---|---|---|---|
| Würzburg | start | 2,56 → 3,35 | 5,35 → 7,50 | 260 → 282 | 1,29 → 3,41 | 0,43 / 1,65 → 0,31 / 1,34 | 0,30 → 1,41 | 2428 → 50 | 7532 → 2458 |
| Würzburg | game | 4,13 → 4,40 | 8,02 → 9,91 | 388 → 392 | 6,84 → 6,87 | 0,55 / 1,67 → 0,46 / 1,44 | 1,53 → 2,57 | 1943 → 42 | 6645 → 2213 |
| Würzburg | low | 4,58 → 5,12 | 8,57 → 10,76 | 465 → 474 | 6,86 → 6,86 | 0,55 / 1,77 → 0,51 / 1,60 | 3,78 → 3,13 | 2254 → 55 | 6894 → 2266 |
| Würzburg | top | 3,00 → 3,52 | 3,13 → 5,68 | 278 → 358 | 0,88 → 1,45 | 0,28 / 1,77 → 0,24 / 1,19 | 0,46 → 0,81 | 14261 → 143 | 12019 → 8258 |
| Würzburg | street | 4,36 → 4,69 | 8,20 → 9,96 | 361 → 372 | 6,86 → 6,84 | 0,49 / 2,03 → 0,45 / 2,72 | 1,69 → 1,69 | 2054 → 48 | 6202 → 2218 |
| Würzburg | station | 3,42 → 3,30 | 5,60 → 7,87 | 311 → 319 | 3,01 → 3,52 | 0,55 / 1,74 → 0,49 / 1,62 | 3,89 → 2,49 | 4170 → 11 | 9463 → 3060 |

**Low** (Würzburg; Ruined City und Autumn Keep +0,02 bis +0,09 ms)

| Karte | Ansicht | GPU ms | Dreiecke (Mio.) | Calls | Abgabe `render` ms | LOD-CPU ms Mittel / Max | Schatten-Neubau +ms | fehlen: Linien + Gleise | fehlen: übrige Objekte |
|---|---|---|---|---|---|---|---|---|---|
| Würzburg | start | 1,22 → 1,71 | 2,54 → 4,42 | 151 → 190 | 0,58 → 0,79 | 0,15 / 1,10 → 0,17 / 1,16 | 0,15 → 0,17 | 15388 → 404 | 11863 → 8882 |
| Würzburg | game | 2,00 → 2,38 | 2,95 → 4,73 | 223 → 253 | 1,08 → 1,27 | 0,22 / 1,29 → 0,24 / 1,27 | 0,25 → 0,46 | 14333 → 348 | 11543 → 8427 |
| Würzburg | low | 2,27 → 2,68 | 3,46 → 5,26 | 347 → 380 | 3,41 → 3,31 | 0,24 / 1,30 → 0,31 / 1,31 | 0,26 → 0,22 | 14609 → 351 | 11566 → 8472 |
| Würzburg | top | 1,32 → 1,65 | 2,80 → 4,55 | 265 → 281 | 0,75 → 0,84 | 0,19 / 1,23 → 0,16 / 1,15 | 0,11 → 0,16 | 19065 → 1305 | 12212 → 11275 |
| Würzburg | street | 2,60 → 2,88 | 3,08 → 4,87 | 262 → 291 | 2,59 → 2,45 | 0,26 / 3,77 → 0,26 / 1,99 | 0,13 → 0,09 | 14062 → 387 | 11342 → 8295 |
| Würzburg | station | 1,51 → 1,85 | 2,56 → 3,94 | 158 → 180 | 0,78 → 0,90 | 0,23 / 1,35 → 0,27 / 1,34 | 0,23 → 0,08 | 12411 → 495 | 11622 → 9770 |

**Würzburg neu importiert** (High, vorher wie oben, nachher die Karte, die der Import mit der neuen Rechnung legt):

| Karte | Ansicht | GPU ms | Dreiecke (Mio.) | Calls | Abgabe `render` ms | LOD-CPU ms Mittel / Max | Schatten-Neubau +ms | fehlen: Linien + Gleise | fehlen: übrige Objekte |
|---|---|---|---|---|---|---|---|---|---|
| Würzburg | start | 2,25 → 2,44 | 4,12 → 5,26 | 208 → 244 | 0,92 → 1,18 | 0,36 / 1,48 → 0,22 / 1,30 | 0,70 → 0,39 | 5046 → 71 | 9609 → 4402 |
| Würzburg | game | 3,39 → 3,45 | 5,60 → 6,54 | 328 → 342 | 3,48 → 3,39 | 0,47 / 1,82 → 0,35 / 1,32 | 1,55 → 1,65 | 4485 → 63 | 8834 → 3884 |
| Würzburg | low | 4,15 → 4,32 | 6,59 → 7,54 | 421 → 443 | 6,84 → 6,86 | 0,53 / 1,93 → 0,36 / 1,52 | 1,51 → 1,28 | 4997 → 69 | 8791 → 4112 |
| Würzburg | top | 2,98 → 3,29 | 2,98 → 4,66 | 277 → 312 | 0,86 → 1,08 | 0,26 / 1,46 → 0,17 / 1,35 | 0,44 → 0,70 | 17294 → 325 | 12053 → 8194 |
| Würzburg | street | 3,35 → 3,48 | 6,39 → 7,10 | 344 → 352 | 3,29 → 3,39 | 0,44 / 1,80 → 0,31 / 1,87 | 1,69 → 1,46 | 4116 → 70 | 8155 → 4229 |
| Würzburg | station | 3,28 → 3,38 | 4,51 → 5,45 | 239 → 255 | 2,78 → 2,98 | 0,40 / 1,46 → 0,36 / 1,29 | 0,94 → 1,05 | 6224 → 35 | 10318 → 4498 |

**Was das heißt:**

1. **Linien und Gleise bleiben.** Auf der ganzen Würzburg-Karte fehlen in der Spielansicht (High) 64 statt 4 485
   Linien- und Gleisstücke, von oben 347 statt 17 294, auf Low 348 statt 14 333. Was noch fehlt, sind einzelne kurze
   Stücke (eine Linie aus einem Stück zählt mit ihrer eigenen Größe). Auf Ruined City und Autumn Keep fehlte schon vorher
   keine Linie.
2. **Gleiche Kartendatei, mehr im Bild: GPU High +0,0 bis +0,5 ms, in der Straße +1,1 ms; Ultra −0,1 bis +0,8;
   Low +0,3 bis +0,5.** Fast der ganze Zuwachs sind Autos und Zäune: die 3 128 Autos auf Parkplätzen (Radius 2,1 m)
   zeichneten bis 800 m und gehen jetzt bei 1,3 km; in der Spielansicht +1,5 Mio. Dreiecke Autos, +0,45 Mio. Zäune
   (`fence-picket`, `fence-wood`, früher 800 m, jetzt als Linie bis zum Rand). Auf den mitgelieferten Karten ändert sich
   die GPU-Zeit nicht messbar; dort zeigt die Pixelgrenze mehr Kleinkram als vorher (Ruined City `street` fehlen 1 389
   statt 2 624 Pflanzen und Props), weil viele Pflanzen und Props eine kurze Sichtweite hatten.
3. **Mit dem neu gerechneten Import kommt Würzburg fast auf die Kosten von vorher**: GPU +0,06 bis +0,31 ms, `game`,
   `street` und `station` +0,06 bis +0,13 (im Rauschen). Der Import legt unter denselben Teilbudgets weniger: Autos
   1 275 statt 3 128 (Flächen-Budget, jetzt 1 853 Stück weggelassen), Möblierung 13 444 statt 14 696 Stücke (Mauern
   1 893 statt 2 144, Zäune 1 443 statt 1 692, Stützmauern 1 869 statt 2 432, Hecken 43 statt 160, Stadtmauer 284 statt
   356); Gleise unverändert alle. Szenenkosten 5,06 Mio. (42 %) statt 4,53 Mio.
4. **CPU:** die Stufenwahl wird nicht teurer (Würzburg High 0,20 bis 0,41 ms im Mittel statt 0,26 bis 0,53); ein
   Linienstück rechnet eine Distanz mehr, die Kugeln der Linien entstehen nur nach einer Änderung.
5. **Szenenkosten der mitgelieferten Karten** (neue Rechnung): Ruined City 6,81 → 6,55 Mio., Autumn Keep 2,69 → 2,67,
   Demo Valley 1,95 → 2,20, Mars Canyon 3,85 → 4,14, übrige ±0,03 Mio.; alle bleiben unter 55 % (Grenze 80 %).
   `SCENE_BUDGET` ist nicht neu geeicht (Abschnitt 8 sah das vor): auf der ganzen Würzburg-Karte liegen 42 % bei 2,4 bis
   4,6 ms GPU in der Vorschau.

**Offen, zu entscheiden:**

- **Pixelwerte je Stufe.** Gebaut sind die Vorschläge (3 / 2 / 1,5 / 1 px). Sie zeichnen auf eigenen Karten fast überall
  weiter als die alten Sichtweiten. Die Entscheidung „bis (a) deckelt die Pixelgrenze die Kosten“ (Abschnitt 10) gilt mit
  diesen Werten nur über die Kostenrechnung des Imports (Punkt 3), nicht für eine Kartendatei, die schon liegt
  (Punkt 2). Wer bei gleicher Datei gleiche GPU-Zeit will, braucht höhere Werte (z. B. High 2 px) oder (a) zuerst.
  Abnahme am Bild je Stufe: `tmp/e304-shots/` (Worktree).
- **Teilbudgets des Imports.** Unverändert 15 % Möblierung, 10 % Flächen. Mit der neuen Rechnung bleiben 9 623
  Möblierungsstücke weg (vorher 8 371), darunter 92 % der Hecken, 66 % der Mauern und 43 bis 48 % der Zäune, Stütz-
  und Stadtmauern; das Szenenbudget ist dabei zu 58 % frei. Ein höherer Anteil für Linien hieße mehr Mauern, Zäune und Hecken bei mehr GPU-Zeit, bis (d) sie fern als
  Bänder zeichnet.
- **Sichtblocker und Sicht-Cube.** Blocker gehen bei 1,5 px (High), auch auf Low und Ultra. Ein kleiner Blocker (Fels
  ab 1,8 m, Schuppen) fällt damit ab etwa 0,7 bis 1,2 km Kameraabstand aus dem Cube eines Towers; vorher an seiner
  Sichtweite (Felsen 800 m). Die feste Stufe für den Cube (Entscheidung 5) löst das; gebaut, Abschnitt 2.10.

### 2.10 Sicht-Cube mit fester Stufe (Entscheidung 5, 2026-10-21)

**Befund vorher:** der Cube eines Towers sah, was die Spielkamera gewählt hatte: Detailstufen, Impostoren und
Fernkästen der Objekte, Pixelgrenze, und das Gelände in der Stufe seines Quadtrees. Probe `e2e/perf/los-cube.ts`:
24 Tower-Spitzen auf einer Spirale um das HQ (20 bis 400 m, 6 m über dem Boden), Reichweite 60 m, jeder Cube aus
drei Kameraposen (`game` über dem HQ, `top` die ganze Karte, `away` am Nordrand nach außen); verglichen werden die
Bytes der sechs Flächen mit denen aus `game`. Vorher lasen auf Ruined City 5 bzw. 2 von 24 Spitzen dasselbe (8 bis
10 % der Texel anders), auf Würzburg 4 bzw. 0 von 24 (26 bzw. 48 % der Texel anders). Eine Maske hing also an der
Kamera des Hosts im Moment des Baus. Dazu zeichnete jede Fläche alle Instanzen jedes Blocker-Meshes, das ihr Kegel
schnitt (die Hülle eines Meshes ist die ganze Karte).

**Gebaut:** die Blocker, die die Kamera in Stufen zeichnet, sind für den Cube unsichtbar (`losTransparent`). Er
zeichnet stattdessen je blockierendem Asset das volle Modell jedes Objekts, dessen Hülle innerhalb seiner Reichweite
(`losCubeFarDistance`) um die Spitze liegt (`LosDraw` in `object-layer.ts`, je Cube-Render neu gefüllt, Ruinen mit
ihrem Schaden), und die feinsten Geländestücke ohne Geomorph in dieser Reichweite (`TerrainChunks.losGroup`). Gebäude
aus dem Grundriss (`mass-layer.ts`) hingen nie an der Kamera und bleiben, wie sie sind. Die Fernkästen und Impostoren
brauchen ihre eigenen LOS-Shader nicht mehr (entfernt). Regel 14 in [LOS_PIPELINE.md](LOS_PIPELINE.md).

**Kosten je Cube** (High, Reichweite 60 m, 24 Spitzen, Median; „max“ enthält den ersten Cube einer Karte, der seine
Programme baut, im Spiel übernimmt das der Warm-up):

| Karte | Pose | Hauptthread ms | GPU ms | Calls | Dreiecke (Mio.) | gleiche Bytes wie aus `game` |
|---|---|---|---|---|---|---|
| Ruined City | game | 0,66 → 0,45 | 0,22 → 0,10 | 216 → 122 | 4,05 → 0,71 | |
| Ruined City | top | 0,42 → 0,40 | 0,16 → 0,10 | 114 → 122 | 2,78 → 0,71 | 5 → 24 von 24 |
| Ruined City | away | 0,56 → 0,41 | 0,22 → 0,10 | 204 → 122 | 4,03 → 0,71 | 2 → 24 von 24 |
| Würzburg | game | 2,53 → 1,83 | 1,22 → 0,33 | 654 → 290 | 9,02 → 1,30 | |
| Würzburg | top | 1,04 → 1,63 | 0,60 → 0,34 | 141 → 290 | 4,17 → 1,30 | 4 → 24 von 24 |
| Würzburg | away | 2,06 → 1,52 | 0,96 → 0,36 | 560 → 290 | 5,63 → 1,30 | 0 → 24 von 24 |

Würzburg ist die ganze Welt aus 2.8. Ein Cube kostet jetzt aus jeder Pose dasselbe; aus `top` war er vorher billiger,
weil die Kamera dort viel weggelassen hatte. Die Auswahl je Cube läuft über alle Blocker der Karte (ein Abstand je
Objekt, auf Würzburg rund 15 000), in der Hauptthread-Zeit enthalten. Bilder der Flächen (Kreuz der sechs, nah dunkel)
für die ersten drei Spitzen je Pose: `tmp/e304-shots/a-*` im Worktree.

### 2.11 Linien als Element und als Band (E304 (d), Entscheidung 4, 2026-10-22)

**Gebaut, in zwei Schritten:**

1. **Element „Linie“, Formatversion 5:** `CustomMapDocument.lines` (`MapLine`: Id und Verlauf) und `MapObject.line`
   an jedem Stück. Die Stücke bleiben Objekte; Bauen, Sicht, Zerstörung, Koop und die Simulation sehen, was sie sahen.
   Renderer und Kostenrechnung nehmen die Linie aus `MapObject.line` (vorher geraten aus Gruppe und Kategorie). Linien
   legen der OSM-Import (Mauern, Zäune, Hecken und Gleise jeder Gruppe), der Linien-Pinsel und `MapKit.line` (je
   Spiegelbild eine eigene), „Karte spiegeln“; Kopien, Stempel und Duplikate nehmen keine Linie mit. Migration von 4
   leer, die mitgelieferten Karten neu gebacken (ihre Hashes bleiben: ihre Skripte legen noch keine Linien).
2. **Band:** jedes Stück einer Mauer, eines Zauns oder eines Gleises (Katalog `wall`/`structure` mit `box` und
   LOD-Modell) endet ab 3 px Radius (1080 Zeilen) in einem Kasten aus sechs Dreiecken, alle Assets in einem Draw
   (`line-bands.ts`). Farben aus den LOD-Teilen, oben und seitlich. Die Kostenrechnung zählt das Band mit.
3. **Band für Gleise, Hecken und Maschendraht (2026-10-22):** die Farben kommen jetzt aus dem Katalog (`band`), beim
   Packen gemessen (`tools/map-assets/measure_bands.mjs`): das volle Modell von oben und von beiden Längsseiten mit
   Tiefenpuffer gerastert, Farbtextur (KTX2 über den Basis-Transcoder von three) linear mal Faktor, Alpha schneidet;
   dazu die Deckung der Seite (`cover`, unter 85 % gespeichert: Maschendraht 0,26, Lattenzaun 0,34, Eisentor 0,22),
   die das Band im Raster der Blende als Anteil seiner Pixel behält. `hasBand` = Linienstück mit `box` und `band`;
   Hecken und Maschendraht ohne LOD-Modell gehen nach dem vollen Modell bzw. dem Fernkasten ins Band. Die Farbmittel
   der LOD-Teile auf der CPU sind entfallen; das Band nimmt den Ton des LOD-Modells, wo eins davor steht. 37 Assets
   tragen ein Band (vorher 28; neu die vier Gleise, zwei Hecken, zwei Maschendrahtzäune und die Ruinenecke).

**Folge im Import (Würzburg, 2.8):** mit den billigeren Fernstufen legt der Import unter denselben Teilbudgets mehr:
Möblierung 18 528 statt 13 444 Stücke (Mauern 4 270 statt 1 893, Stützmauern 3 208 statt 1 869, Zäune 2 126 statt
1 443, Hecken 486 statt 43, Stadtmauer 526 statt 284; Gleise unverändert alle), Autos 1 375 statt 1 275, Szenenkosten
4,82 Mio. statt 5,06 Mio. 2 461 Linien mit 23 432 Stücken.

**Messung** (dieselbe Probe; vorher Teil A mit der Karte aus 2.9 „neu importiert“, nachher diese Karte mit Linien und
Bändern, also 5 044 Linienstücke mehr; Ruined City und Autumn Keep haben keine Linien und bleiben gleich, GPU innerhalb
±0,15 ms):

| Stufe | Ansicht | GPU ms | Dreiecke (Mio.) | Calls | Abgabe `render` ms | LOD-CPU ms Mittel / Max | Schatten-Neubau +ms | fehlen: Linien + Gleise | fehlen: übrige Objekte |
|---|---|---|---|---|---|---|---|---|---|
| high | start | 2,43 → 2,35 | 5,26 → 4,70 | 244 → 246 | 1,35 → 1,24 | 0,23 / 1,31 → 0,30 / 1,59 | 0,33 → 0,68 | 71 → 78 | 4402 → 4460 |
| high | game | 3,43 → 3,47 | 6,54 → 6,16 | 342 → 351 | 2,89 → 3,28 | 0,35 / 1,34 → 0,47 / 1,65 | 1,53 → 1,56 | 63 → 66 | 3884 → 3879 |
| high | low | 4,29 → 4,29 | 7,54 → 7,20 | 443 → 449 | 6,84 → 6,86 | 0,38 / 1,42 → 0,52 / 1,88 | 1,52 → 1,25 | 69 → 74 | 4112 → 4159 |
| high | top | 3,27 → 3,12 | 4,66 → 3,82 | 312 → 309 | 1,18 → 1,17 | 0,17 / 0,91 → 0,19 / 1,06 | 0,69 → 0,58 | 325 → 416 | 8194 → 8277 |
| high | street | 3,40 → 4,12 | 7,10 → 6,86 | 352 → 366 | 3,40 → 6,85 | 0,33 / 2,00 → 0,47 / 2,14 | 2,10 → 1,55 | 70 → 77 | 4229 → 4240 |
| high | station | 3,38 → 3,32 | 5,45 → 4,92 | 255 → 269 | 2,82 → 3,13 | 0,39 / 1,28 → 0,47 / 1,54 | 1,07 → 1,20 | 35 → 69 | 4498 → 4527 |
| ultra | start | 3,52 → 3,48 | 6,03 → 5,74 | 276 → 281 | 3,28 → 2,88 | 0,28 / 1,29 → 0,40 / 1,74 | 1,05 → 1,03 | 47 → 53 | 2480 → 2464 |
| ultra | game | 4,12 → 4,16 | 8,31 → 8,21 | 386 → 398 | 6,88 → 6,83 | 0,42 / 1,32 → 0,60 / 1,80 | 2,04 → 3,26 | 42 → 44 | 2215 → 2192 |
| ultra | low | 4,78 → 4,70 | 9,05 → 9,10 | 472 → 476 | 6,85 → 6,82 | 0,48 / 1,61 → 0,64 / 1,95 | 3,45 → 3,71 | 53 → 58 | 2271 → 2256 |
| ultra | top | 3,32 → 3,23 | 4,89 → 4,08 | 358 → 356 | 1,84 → 1,58 | 0,21 / 1,04 → 0,24 / 1,24 | 0,74 → 0,72 | 130 → 178 | 7371 → 7447 |
| ultra | street | 4,37 → 4,41 | 8,38 → 8,54 | 367 → 375 | 6,85 → 6,87 | 0,40 / 1,88 → 0,57 / 2,73 | 1,70 → 1,71 | 44 → 50 | 2190 → 2187 |
| ultra | station | 3,48 → 3,48 | 6,31 → 5,91 | 319 → 330 | 2,92 → 2,99 | 0,47 / 1,50 → 0,56 / 1,62 | 1,34 → 1,44 | 7 → 31 | 3035 → 3057 |
| low | start | 1,71 → 1,61 | 4,02 → 3,21 | 190 → 192 | 0,84 → 0,93 | 0,15 / 1,02 → 0,17 / 1,22 | 0,14 → 0,26 | 391 → 445 | 7441 → 7539 |
| low | game | 2,24 → 2,14 | 4,25 → 3,48 | 250 → 252 | 1,24 → 1,20 | 0,22 / 1,21 → 0,25 / 1,30 | 0,24 → 0,35 | 339 → 389 | 7058 → 7164 |
| low | low | 2,48 → 2,42 | 4,76 → 4,00 | 374 → 376 | 3,49 → 3,24 | 0,31 / 1,26 → 0,35 / 1,43 | 0,22 → 0,22 | 339 → 390 | 7150 → 7248 |
| low | top | 1,66 → 1,47 | 4,45 → 3,62 | 281 → 273 | 0,86 → 0,80 | 0,16 / 1,05 → 0,16 / 1,19 | 0,19 → 0,12 | 1272 → 1430 | 9424 → 9506 |
| low | street | 2,84 → 2,77 | 4,42 → 3,72 | 279 → 281 | 3,07 → 3,68 | 0,23 / 1,71 → 0,28 / 2,97 | 0,10 → 0,08 | 375 → 425 | 6901 → 7000 |
| low | station | 1,81 → 1,71 | 3,60 → 2,83 | 180 → 186 | 0,95 → 0,93 | 0,25 / 1,31 → 0,27 / 1,38 | 0,15 → 0,22 | 481 → 567 | 8273 → 8371 |

Trotz 5 000 Stücken mehr zeichnet Würzburg meist 0,1 bis 0,8 Mio. Dreiecke weniger (Ultra `low` und `street` +0,05
und +0,16 Mio.), die GPU-Zeit bleibt gleich oder fällt (Low −0,06 bis −0,19 ms); `street` High +0,7 ms ist der Lauf mit
der Abgabe an der Grenze von 6,8 ms (2.9). Die Stufenwahl kostet mit den zusätzlichen Objekten 0,02 bis 0,18 ms mehr im
Mittel. „fehlen“ steigt leicht: die
zusätzlichen Stücke einzelner kurzer Linien unter der Pixelgrenze.

**Offen:** Die Skripte der mitgelieferten Karten legen ihre Mauern noch Stück für Stück (Autumn Keep); als Linie hieße
neuer Hash.

**Messung Schritt 3** (Gleise, Hecken, Maschendraht mit Band; vorher die Karte und der Stand von Schritt 2, nachher
Würzburg neu importiert: Möblierung 18 754 statt 18 528 Stücke, Mauern 4 464 statt 4 270, Stützmauern 3 240 statt
3 208, Hecken und Zäune gleich, Szenenkosten 4,78 statt 4,82 Mio.). Die Vorher-Läufe stammen aus der Sitzung von
Schritt 2; zwischen den Sitzungen wich die GPU-Zeit auch auf den unveränderten Karten Ruined City und Autumn Keep um bis
zu 0,5 ms ab (Low und Ultra), deshalb hier nur die Dreiecke als Vergleich und die GPU-Zeit von High:

| Ansicht | High: Dreiecke (Mio.) | High: GPU ms | Ultra: Dreiecke (Mio.) | Low: Dreiecke (Mio.) |
|---|---|---|---|---|
| start | 4,70 → 4,55 | 2,35 → 2,43 | 5,74 → 5,69 | 3,21 → 2,62 |
| game | 6,16 → 6,05 | 3,47 → 3,45 | 8,21 → 8,16 | 3,48 → 2,90 |
| low | 7,20 → 6,98 | 4,29 → 4,28 | 9,10 → 9,05 | 4,00 → 3,43 |
| top | 3,82 → 3,25 | 3,12 → 3,00 | 4,08 → 3,54 | 3,62 → 3,03 |
| street | 6,86 → 6,75 | 4,12 → 4,07 | 8,54 → 8,49 | 3,72 → 3,14 |
| station | 4,92 → 4,80 | 3,32 → 3,31 | 5,91 → 5,85 | 2,83 → 2,53 |

Die Gleise sind der Posten: fern 6 statt 116 Dreiecke je Stück, von oben 0,57 Mio. Dreiecke weniger (High), auf Low
überall 0,3 bis 0,6 Mio. Ruined City und Autumn Keep zeichnen dieselben Dreiecke. Die Stufenwahl kostet auf Würzburg
0,05 bis 0,23 ms mehr im Mittel (mehr Stücke haben eine Stufe mehr). Bilder `tmp/e304-shots/b2-*` (Worktree).

### 2.12 HLOD je 128-m-Kachel: gebaut, gemessen, verworfen (E304 (c), 2026-10-22)

**Gebaut war (zurückgenommen):** Objekte, deren letzte Stufe ein Fernkasten oder ein Band war, lagen zusätzlich in
Kacheln von 128 m (Entscheidung 3). Ein Worker backte je Kachel aus dem, was der Layer übergab (Matrizen, Farben,
Zahlen des Assets), ihre Kästen Vertex für Vertex wie `far-boxes.ts` und ihre Bänder, gerade Läufe der Stücke einer
Linie zu einem Band. Je Art (Kästen, Bänder) und Sichtflag ein Puffer und ein Draw für alle Kacheln; der Index wurde
beim Ein- und Ausschalten aus den Indizes der Kacheln neu zusammengesetzt (kein `WEBGL_multi_draw`). Eine Kachel
zeichnete hinter dem Bandende der letzten Stufe aller ihrer Objekte und außerhalb der Schattenreichweite; ihre Objekte
verließen dann ihre Listen. Eine Änderung (Editor, Zerstörung, Höhen) nahm die Kachel heraus, bis der neue Bake da war
(300 ms Verzug). Der Sicht-Cube sah keine Kachel. Bäume (Impostoren) und Bauten aus dem Grundriss waren nicht in den
Kacheln.

**Messung** (High, dieselbe Sitzung, vorher Stand von 2.11 Schritt 3, Würzburg die neu importierte Karte von dort, die
Lastkarte `big:1201:80000`; Autumn Keep nicht im Nachher-Lauf):

| Karte | Ansicht | GPU ms | Dreiecke (Mio.) | Calls | LOD-CPU ms Mittel / Max | fehlen: Linien + Gleise | fehlen: übrige Objekte |
|---|---|---|---|---|---|---|---|
| Ruined City | game | 2,08 → 2,08 | 4,86 → 4,86 | 158 → 158 | 0,14 / 0,78 → 0,14 / 0,81 | 0 → 0 | 3348 → 3348 |
| Würzburg | start | 2,37 → 2,33 | 4,55 → 4,54 | 245 → 249 | 0,44 / 1,95 → 0,48 / 2,18 | 78 → 60 | 4444 → 4414 |
| Würzburg | game | 3,46 → 3,46 | 6,05 → 6,03 | 353 → 357 | 0,57 / 1,98 → 0,65 / 2,12 | 66 → 57 | 3873 → 3850 |
| Würzburg | low | 4,28 → 4,27 | 6,98 → 6,97 | 453 → 457 | 0,74 / 2,35 → 0,82 / 2,43 | 74 → 61 | 4152 → 4110 |
| Würzburg | top | 3,00 → 2,95 | 3,25 → 3,21 | 304 → 308 | 0,20 / 1,22 → 0,20 / 1,40 | 444 → 213 | 8300 → 7831 |
| Würzburg | street | 4,10 → 4,06 | 6,75 → 6,74 | 365 → 369 | 0,59 / 2,59 → 0,65 / 4,15 | 77 → 63 | 4225 → 4190 |
| Würzburg | station | 3,36 → 3,29 | 4,80 → 4,79 | 266 → 270 | 0,54 / 1,71 → 0,55 / 1,97 | 77 → 11 | 4550 → 4365 |
| Lastkarte | game | 1,71 → 1,65 | 4,03 → 4,03 | 73 → 74 | 0,41 / 2,73 → 0,48 / 1,87 | 0 → 0 | 29483 → 29483 |
| Lastkarte | low | 2,13 → 2,09 | 5,21 → 5,22 | 116 → 117 | 0,43 / 2,47 → 0,43 / 2,29 | 0 → 0 | 29325 → 29325 |

**Was das heißt, ehrlich:** Auf diesen Karten bringt HLOD kaum etwas. GPU −0,00 bis −0,07 ms (im Rauschen), 0,01 bis
0,04 Mio. Dreiecke weniger (die Läufe der Bänder), vier Calls mehr (die vier Kachel-Draws, solange noch Einzelobjekte
in Fernstufen zeichnen). Die Stufenwahl kostet im Mittel 0,00 bis 0,08 ms mehr, die Spitze beim Flug in die Straße
4,2 statt 2,6 ms (Kacheln, die ausgehen, bringen ihre Objekte in einem Bild in ihre Listen zurück). Der Grund: nach (b)
und (d) waren die Fernstufen schon billig (6 bis 24 Dreiecke je Objekt in einem geteilten Draw), und ein fernes Objekt
wurde dank `slack` ohnehin selten angesehen; der Plan nahm für (c) noch die Fernstufen vor (b) und (d) an. Sichtbar
gewinnt nur „fehlen“: in einer Kachel zeichnet alles bis zum Rand (von oben 213 statt 444 Linienstücke weg, 469 übrige
Objekte mehr im Bild). Ein Bild zeigt keinen Unterschied (`tmp/e304-shots/c-*` im Worktree). Low und Ultra sind
nicht neu gemessen: zwischen zwei Sitzungen wich die GPU-Zeit auf den unveränderten Karten um bis zu 0,3 ms ab; die
Dreiecke folgen High (Würzburg Low −0,00 bis −0,04 Mio.).

**Was es lohnend gemacht hätte:** HLOD lohnt erst, wenn die Kachel mehr einspart als die Instanzen: ein Kronendach je Kachel
statt Impostoren (Würzburg 8 808 Bäume), Bauten aus dem Grundriss in die Kacheln, oder Kästen benachbarter Gebäude
eines Blocks zusammengefasst. Sonst bleibt der Baustein Vorbereitung für WebGPU (dort ersetzt indirektes Zeichnen das
Neusetzen des Index).

**Entscheidung (User 2026-10-22):** verworfen, der Code ist zurückgenommen (Abschnitt 10, Punkt 12).

**Lehre:** Eine Fernstufe je Kachel lohnt nur, wenn sie weniger zeichnet als die Summe ihrer Objekte, nicht wenn sie
dieselben Dreiecke anders verpackt. Fernkästen und Bänder in einem geteilten instanzierten Draw kosten fern schon fast
nichts, und `slack` hält die Stufenwahl ferner Objekte klein; was eine Kachel ein- und ausschaltet, bringt neue Spitzen
in die Stufenwahl. Vor einem neuen Anlauf erst messen, was ein Kronendach oder ein Häuserblock gegenüber den Impostoren
und Fernkästen spart.

## 3. Wie andere es machen (belegt)

- **Cities: Skylines (2015)**: zwei Detailstufen je Asset, die ferne etwa ein Fünftel der Dreiecke; die
  Fern-Texturen aller Assets liegen in gemeinsamen Atlanten (eigene für Gebäude, Props, Fahrzeuge und Netze, höchstens
  4096 × 4096), damit Fernmodelle gemeinsam gezeichnet werden können; Asset-Ersteller sollen Fern-UVs deshalb im
  Bereich 0..1 halten und das Fernmesh klein (Warnung über 600 Dreiecke). Die Sichtweite der Netze (Straßen, Gleise) ist
  eine eigene Distanz (Mods heben sie von 1000 m auf 2000 bis 4000 m). Quellen:
  [cslmodding.info, Building Asset Creation](https://cslmodding.info/asset/building/),
  [Paradox Wiki, Asset Editor](https://skylines.paradoxwikis.com/Asset_Editor),
  [Steam-Diskussion, zwei Stufen](https://steamcommunity.com/workshop/filedetails/discussion/667342976/1636416951459546732),
  [Ultimate Level Of Detail](https://steamcommunity.com/sharedfiles/filedetails/?id=1680642819).
  Wie die Fernstufen intern gebündelt werden (Render-Gruppen je Gebiet), ist nur aus dekompiliertem Code bekannt und
  hier nicht belegt. Zu Cities: Skylines II zeigt eine RenderDoc-Analyse, dass es nur nach Sichtkegel, nicht nach
  Verdeckung aussortiert und manchen Modellen die Fernstufen fehlten
  ([paavohtl, Why Cities: Skylines 2 performs poorly](https://blog.paavo.me/cities-skylines-2-performance/)).
- **Unreal, HLOD und World Partition**: HLOD ersetzt ferne Gruppen von Actors durch eine erzeugte Fernstufe
  (Instanzierung, zusammengeführtes Mesh, vereinfacht oder angenähert), schaltet nach Ladeweite oder Bildgröße und
  dient weniger Draw Calls, weniger Speicher und weniger Geometrie in der Ferne; HLOD-Layer lassen sich verketten,
  jede Stufe mit eigener Distanz; Landschaft und Wasser deckt HLOD nicht ab.
  [Epic, World Partition HLOD](https://dev.epicgames.com/documentation/unreal-engine/world-partition---hierarchical-level-of-detail-in-unreal-engine),
  [Simplygon, HLOD in UE5](https://documentation.simplygon.com/SimplygonSDK_10.4.199.0/ue5/concepts/hlod.html).
- **Unreal, Cull Distance Volumes**: Paare aus Größe und Distanz, nach der längsten Kante der Bounds eines Actors;
  kleine Dinge verschwinden früh, große bleiben, der kleinere Wert aus Volume und eigener `MaxDrawDistance` gilt.
  Das ist Ausblenden nach Bildgröße in Tabellenform.
  [Epic, Cull Distance Volumes](https://dev.epicgames.com/documentation/en-us/unreal-engine/cull-distance-volumes-in-unreal-engine),
  [Epic, Visibility and Occlusion Culling](https://dev.epicgames.com/documentation/en-us/unreal-engine/visibility-and-occlusion-culling-in-unreal-engine).
- **Unreal, Nanite (Abgrenzung)**: Geometrie in Clustern von rund 128 Dreiecken in einer Hierarchie, je Cluster auf
  der GPU ausgewählt und verworfen; braucht Compute, Storage-Buffer und indirektes Zeichnen. Unter WebGL2 nicht
  machbar, unter WebGPU als Prinzip (Cluster, GPU-Auswahl) möglich, als Produkt kein Ziel für uns.
  [LMU-Folien zu Nanite](https://www.medien.informatik.uni-muenchen.de/lehre/ws2122/gp/slides/gp-ws2122-extra-nanite.pdf).
- **Unity 6, GPU Resident Drawer und GPU Occlusion Culling**: zeichnet MeshRenderer über die BatchRendererGroup mit
  GPU-Instanzierung, braucht Compute (nicht OpenGL ES); die Verdeckung baut Tiefentexturen aus Kamerasicht und testet
  Objekte gegen die Tiefe des aktuellen und des vorigen Bilds. Unity selbst sagt: am meisten bringt es bei viel
  Verdeckung und dichten verdeckten Meshes, bei wenig Verdeckung kann die Vorarbeit das Bild sogar verlangsamen.
  [Unity 6.3, GPU Resident Drawer](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/gpu-resident-drawer.html),
  [Unity 6, GPU culling](https://docs.unity.com/en-us/engine/6000.0/manual/analysis/graphics-performance-profiling/in-urp/gpu-culling).
- **three.js**:
  - `BatchedMesh` zeichnet viele Geometrien mit einem Material über `WEBGL_multi_draw`, sortiert und klammert je Objekt
    aus (`perObjectFrustumCulled`, Standard an; auf der CPU in `onBeforeRender`, je Kamera, auch je Schattenkamera);
    Matrizen und Farben liegen in Datentexturen, eigene Instanzattribute gibt es nicht; negativ skalierte Matrizen
    werden nicht unterstützt. [three.js, BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html), Quelltext
    `node_modules/three/src/objects/BatchedMesh.js` (r186). Ohne `WEBGL_multi_draw` fällt three auf einzelne Draws
    zurück; Firefox hat die Erweiterung in keiner Version
    ([caniuse, WEBGL_multi_draw](https://caniuse.com/wf-webgl-multi-draw)). Deshalb hat V2 InstancedMesh gewählt.
  - `InstancedMesh2` (`@three.ez/instanced-mesh`): InstancedMesh mit Ausklammern je Instanz, optional über eine BVH,
    LOD, Sortierung. [Forum, InstancedMesh2](https://discourse.threejs.org/t/three-ez-instancedmesh2-enhanced-instancedmesh-with-frustum-culling-fast-raycasting-bvh-sorting-visibility-management-lod-skinning-and-more/69344).
    Das Prinzip (je Bild die sichtbaren Instanzen nach vorn, `count` kürzen) ist das, was unsere Probe misst.
  - `three-mesh-bvh`: BVH über Dreiecke für Strahltests; für Instanz-Culling nicht nötig (ein Gitter je Kachel reicht).
- **Verdeckung unter WebGL2**: kein Compute, keine indirekten Draws. Möglich sind (1) Occlusion Queries
  (`ANY_SAMPLES_PASSED_CONSERVATIVE`, Ergebnis ein bis zwei Bilder später,
  [MDN, getQuery](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/getQuery)), (2) eine Hi-Z-
  Pyramide per Fragment-Shader und der Test im Vertex-Shader mit Transform Feedback, das sichtbare Instanzen
  herausschreibt ([RasterGrid, Hi-Z Occlusion Culling](https://www.rastergrid.com/?p=85)); ohne indirektes Zeichnen
  braucht die CPU dann aber die Anzahl zurück, (3) eine kleine Tiefen-Pyramide zur CPU zurücklesen (asynchron) und
  dort testen. Ein Erfahrungsbericht mit Hi-Z aus dem vorigen Bild unter WebGL2 nennt die konservative Mip-Wahl als
  Grenze ([Khronos-Forum](https://community.khronos.org/t/occlusion-culling-using-hiz-test-optimization-question/77313));
  PlayCanvas bietet Hi-Z für WebGL2 und WebGPU an ([PlayCanvas-Forum, OptiPixel](https://forum.playcanvas.com/t/optipixel-library/42206)).
- **WebGPU**: Compute-Pass prüft Instanzen, schreibt die sichtbaren in einen Puffer und die Zahl in einen
  indirekten Draw; VTK hat einen zweistufigen Hi-Z-Culler so gebaut
  ([VTK, WebGPU occlusion culling](https://docs.vtk.org/en/latest/release_details/9.4/webgpu-occlusion-culler.html)).

## 4. Was unter WebGL2 geht, was erst mit WebGPU

| Baustein | WebGL2 (heute) | WebGPU |
|---|---|---|
| Ausklammern je Instanz nach Sichtkegel | ja, auf der CPU je Bild (Listen kürzen); BatchedMesh nur ohne Firefox-Gewinn | Compute + indirekter Draw, CPU frei |
| Ausblenden nach Bildgröße | ja (CPU, schon heute je Objekt gerechnet) | dasselbe auf der GPU |
| HLOD je Kachel | ja (Mesh im Worker gebaut, ein Draw je Kachel und Material) | ja, gleich |
| Linien als Band | ja | ja |
| Verdeckung | grob: Tiefenbild des Vorbilds klein zurücklesen (asynchron, ein Bild Verzug), Test auf der CPU je Kachel oder Instanz; Occlusion Queries je Kachel | Hi-Z im Compute, zweistufig, im selben Bild |
| Schatten- und Sicht-Cube-Pässe getrennt ausklammern | ja, eigene Listen je Pass (CPU) | je Pass ein Compute-Lauf |

Unter WebGL2 bleibt jede Auswahl auf der CPU. Die Kosten dafür sind klein (Abschnitt 2.2, LOD-CPU: die Stufenwahl läuft
heute schon je Objekt und kostet auf den Karten 0,05 bis 0,2 ms), solange sie über Kacheln statt über jede Instanz
geht; auf der Lastkarte zeigt sich, dass „je Objekt“ bei 150 000 Instanzen nicht mehr reicht.

## 5. Ziele (mit Zahlen)

Gemessen mit derselben Probe, gleicher Rechner, High, 1600 × 900; „gleich“ heißt innerhalb ±0,1 ms des Ausgangswerts
derselben Ansicht.

| Nr. | Ziel | Heute | Danach |
|---|---|---|---|
| Z1 | Würzburg: alle Gleise, Mauern, Zäune, Hecken, Bäume und Gebäude bis zum Kartenrand sichtbar, in jeder Ansicht | Übersicht: 1 837 von 1 972 Linienstücken und 3 087 von 3 155 Gleisstücken fehlen; Spielansicht 161 bzw. 206 | 0 fehlen (Kleinkram nach Bildgröße) |
| Z2 | Bei Z1 GPU-Zeit wie heute je Ansicht | `game` 2,25 ms, `low` 2,42, `top` 2,27, `street` 2,56 | gleich oder darunter |
| Z3 | Dichte: Lastkarte mit 200 000 Objekten so teuer wie heute mit 80 000 | 3,81 / 4,26 ms (`game` / `low`) | ≤ 2,0 / 2,4 ms |
| Z4 | CPU der Auswahl (Stufen, Sichtkegel, Kacheln) bei 200 000 Objekten | 1,6 ms Mittel, 5,7 ms Spitze | ≤ 0,5 ms Mittel, ≤ 1,5 ms Spitze |
| Z5 | Schatten-Neubau Würzburg flach | 4,3 ms | ≤ 1,5 ms |
| Z6 | Sicht-Cube: Masken bitgleich auf einem festen Satz Tower-Plätze, Kosten je Cube nicht höher | Referenz vor dem Bau messen | gleich |
| Z7 | Gleiches auf einer schwächeren GPU (Zweitrechner) als Abnahme, Anteile wie hier | vor dem Bau messen | wie Z2 bis Z5 relativ |

## 6. Bausteine

Jeder Baustein bleibt unter WebGPU gültig; nichts davon ist eine Übergangslösung. Aufwand in Arbeitstagen (AT) für
einen Worker, grob.

### (a) Ausklammern je Instanz nach Sichtkegel, getrennt je Pass

**Was:** Die Instanzlisten (`instance-list.ts`) bekommen je Pass eine Sicht: der Hauptpass zeichnet je Bild nur die
Instanzen, deren Kugel im Sichtkegel liegt; der Schattenpass seine Caster im Schattenkasten der Sonne (heute: die
ersten `casters` der Liste); der Sicht-Cube je Fläche, was im Kegel dieser Fläche liegt. Umsetzung als zweiter,
kompakter Puffer je Liste und Pass (Index-Liste der Instanzen oder kopierte Matrizen), geschrieben nur, wenn sich die
Auswahl ändert. Die Auswahl läuft nicht über jede Instanz, sondern über **Kacheln** (z. B. 64 m): eine Kachel ganz
drin, ganz draußen oder geteilt; nur geteilte Kacheln prüfen ihre Instanzen. Die Instanzen einer Liste liegen dafür
nach Kachel sortiert (heute nach Stufe und Caster), damit eine Kachel ein zusammenhängender Bereich ist.

**Warum nicht `BatchedMesh`:** Firefox hat kein `WEBGL_multi_draw` (Abschnitt 3), BatchedMesh zeichnet dort je
Instanz einzeln; dazu keine eigenen Instanzattribute (wir haben Blende, Ruinen-Schaden, Ton). Die Kürzung der
eigenen Listen ist das, was die Probe misst.

**Gewinn (gemessen):** heute 0 bis 0,33 ms je Ansicht (Würzburg `game` 2,25 → 1,92 ms, −15 %; `street` 2,56 → 2,30 ms; Autumn Keep 0 bis 0,08 ms), auf der Lastkarte mit 200 000 Objekten 0,4 bis 0,6 ms (−10 bis −16 %). Mehr als die GPU-Zeit zählt, dass der Preis eines Objekts danach an seinem Anteil
im Bild hängt, nicht an seiner Existenz auf der Karte: das ist die Voraussetzung, um die Sichtweiten aufzumachen (b).

**Kosten:** 4 bis 6 AT (Listen, Kacheln, drei Pässe, Ruinen und geteilte Draws, Specs). CPU je Bild: nur bei
Kamerabewegung, über Kacheln; Ziel unter 0,3 ms im Mittel auf Würzburg, Stufenwahl eingeschlossen (heute Stufenwahl allein 0,2 ms).

**Risiken:** Schatten von Objekten außerhalb des Bildes dürfen nicht fehlen (deshalb eigene Schattenauswahl gegen
den Schattenkasten, nicht gegen die Kamera). Der Sicht-Cube darf nie von der Kamera abhängen (Abschnitt 8). Ein Bild
Verzug bei schnellem Drehen: die Auswahl läuft vor dem Rendern desselben Bildes, also keiner.

### (b) Sichtweite nach Bildgröße für alle Objekte, Kostenrechnung zieht mit

**Was:** `drawDistance` je Asset fällt als harte Grenze weg. Ein Objekt verschwindet (mit Blende), wenn sein Radius
im Bild unter eine Pixelgrenze fällt (z. B. 1,5 px bei High, je Stufe einstellbar), wie Unreals Cull Distance Volumes
es mit Größe-Distanz-Paaren tun. Große Dinge (Kirchtürme, Brücken, Gleisfelder, Hallen) bleiben bis zum Kartenrand,
Kleinkram geht früher als heute. Für Linien gilt die Länge der ganzen Linie, nicht des Stücks, also (d).
`scene-cost.ts` rechnet dann statt Kreisringen bis `drawDistance` mit der Distanz, bei der das Objekt die Pixelgrenze
erreicht, und mit dem Anteil des Sichtkegels (nach (a) zahlt ein Objekt nur, wenn es im Bild ist). Neu kalibriert
mit der Probe und `render-bench.ts`.

**Gewinn:** Z1 für Gebäude, Bäume und große Objekte (Linien siehe (d): ihre Stücke sind klein, die Linie lang). Die Stufe Ultra (Sichtweite × 1,25) kostet auf dieser GPU nichts Messbares (Abschnitt 2.6); mit (a) zahlt ein weit entferntes Objekt nur, wenn es im Bild ist. Zugleich fällt Kleinkram unter der Pixelgrenze weg: heute haben 6 bis 33 % der Objekt-Dreiecke in `game`, `low` und `street` unter 4 px Radius.

**Kosten:** 2 bis 3 AT (Stufenwahl hat die Distanz schon je Objekt, `blendAt`), dazu die Kostenrechnung und ihre
Kalibrierung 1 bis 2 AT, Editor-Anzeige 1 AT.

**Risiken:** Ohne (a) und (c) würde Aufmachen teurer; deshalb danach. Kleinkram geht früher: Möblierung unter
1,5 px ist ohnehin kaum zu sehen, aber die Grenze wird je Stufe am Bild abgenommen.

### (c) HLOD: Fernstufe je Kachel für Statisches

**Verworfen (Abschnitt 10, Punkt 12; Messung in 2.12).** Der Plan unten bleibt als Begründung stehen.

**Was:** Je Kachel (128 m, Entscheidung 3) ein zusammengebackenes Mesh für alles Statische, das ab einer Distanz
nicht mehr einzeln gezeichnet werden muss: Gebäude als Fernkästen (es gibt sie schon, `far-boxes.ts`, aber je Instanz),
Linien als Bänder (d), Bäume als Kreuzkarten oder ein Kronendach je Kachel, Kleinkram weggelassen. Nicht ein Draw je
Kachel (19 × 19 Kacheln in Würzburg wären mehr Draws als heute, und die Abgabe kostet dort schon 1,8 bis 2,4 ms):
alle Fernkacheln eines Materials liegen in einem Puffer, und ein Indexpuffer wird beim Wechsel der sichtbaren
Kacheln aus deren Bereichen neu zusammengesetzt (ohne `WEBGL_multi_draw`, das Firefox fehlt), ein Draw je Material.
Ein Atlas für alle Fernansichten, wie die Fernkästen heute und die LOD-Atlanten von Cities: Skylines. Gebaut im Worker beim
Laden (die Geometrie kommt aus dem Kartendokument und dem Katalog, nicht aus der Szene), als Transferable übergeben.
Nah zeichnet die Kachel ihre Einzelobjekte (a, b), fern ihr HLOD, im Band dazwischen beides mit der Blende von heute.

**Zerstörung:** fällt ein Gebäude oder eine Mauer (Stufe 3, Krater), wird die Kachel im Worker neu gebacken (ohne das
Objekt, mit Ruine als Kasten) und getauscht; bis dahin zeigt die alte Kachel weiter, was aus der Ferne nicht auffällt.
Kosten je Kachel im Worker zu messen (Erwartung: wenige ms), Upload auf dem Hauptthread klein.

**Gewinn:** die Instanzen in der Ferne fallen weg: Würzburg hat in der Spielansicht 15 bis 52 % der Objekt-Dreiecke (0,33 bis 0,46 Mio.) von Objekten weiter als 500 m, und auf der Lastkarte kostet die Stufenwahl je Objekt 1,6 ms im Mittel; Draw Calls: ein Draw je
Material für alle Fernkacheln; Schatten fern aus denselben Puffern. Vor allem: bis zum Kartenrand zeichnen kostet
pro Kachel einen festen kleinen Betrag statt pro Objekt.

**Kosten:** 6 bis 10 AT (Worker-Bäcker, Atlas aus vorhandenen Fern-Ansichten, Kachelverwaltung, Zerstörung, Editor:
Kachel neu nach Pinselstrich, verzögert).

**Risiken:** Optik der Übergänge (Abnahme je Karte), Speicher (Kachelmeshes, ein paar MB), Ladezeit (Worker parallel).

### (d) Linien als Band: Detail nah, Band fern

**Was:** Mauern, Zäune, Hecken, Stützmauern, Gleise, Leitplanken heute als Stücke von 1,4 bis 6 m
(`osm/convert/furniture.ts`, z. B. `wall-stone` je 3,8 m mit 1 040 / 156 Dreiecken). Neu: die Linie bleibt im
Dokument eine Linie; nah zeichnen die Stücke (wie heute, mit LOD), ab einer Distanz zeichnet ein Band entlang der
ganzen Linie (Querschnitt aus dem Katalog: Mauer als Kasten, Zaun als Karte mit Alpha, Hecke als Kasten mit
Laubtextur, Gleis als zwei Schienen und Schwellenband), ein Draw je Material und Kachel (also Teil von (c)). Die
Fugen zwischen Stücken und das Ende der Sichtweite mitten in einer Linie verschwinden.

**Gewinn:** ein 3,8-m-Stück Mauer kostet fern 156 Dreiecke, als Band 4 bis 8. Würzburg: 1 972 Linien- und 3 155 Gleisstücke; fern als LOD-Modelle rund 0,7 Mio. Dreiecke, als Bänder rund 30 000. Heute zeigt die Übersicht davon fast nichts (Abschnitt 2.5).

**Kosten:** 4 bis 6 AT (Band-Generator mit Querschnitten, Katalogfelder, Übergang, Gleise mit Weichen, Editor:
Linie bleibt bearbeitbar).

**Risiken:** Linien müssen im Dokument als Linien vorliegen (OSM-Import: ja, sie werden dort aus Wegen erzeugt;
Editor-Pinsel: Stücke heute einzeln; Zusammenfassen nötig). Zerstörung von Linien: ein Stück fällt, das Band bekommt
eine Lücke (Band je Kachel neu, wie (c)).

### (e) Verdeckung

**Was unter WebGL2 sinnvoll ist:** Gebäude-Verdeckung grob je Kachel aus dem Tiefenpuffer des Vorbilds. Ablauf:
das Hauptbild schreibt Tiefe (vorhanden); ein kleiner Pass baut daraus eine Max-Pyramide bis z. B. 128 × 72
(Fragment-Shader, zwei bis drei Durchgänge); die kleinste nötige Stufe wird asynchron gelesen
(`readRenderTargetPixelsAsync`, kein Stillstand); auf der CPU testet jede Kachel (und in geteilten Kacheln jede
Instanz) ihre Kugel gegen das Vorbild, mit Rückprojektion über die Kamera des Vorbilds und einem Rand. Was neu ins Bild
kommt, gilt als sichtbar (konservativ). So hat es die Probe gemessen, nur dort mit einem eigenen Tiefenbild der
Gebäude aus derselben Kamera.

**Gewinn (gemessen):** Straßen: Ruined City 1,88 → 1,46 ms, Würzburg 2,30 → 1,78 ms (nach dem Sichtkegel); flach über die Stadt 0,13 bzw. 0,21 ms; Spielansicht 0,07 ms; Autumn Keep 0 (Hügel zählen in der Probe nicht)

**Grenzen, ehrlich:** ein Bild Verzug (Aufploppen beim schnellen Drehen um eine Hausecke, abgefangen durch Rand und
„neu im Bild = sichtbar“); in der Spielansicht von oben fast nichts verdeckt; Bäume und Hügel als Verdecker erst mit
Gelände-Tiefe (das Hauptbild hat sie, die Probe nicht); kein Gewinn für den Schattenpass (Licht sieht anders). Occlusion
Queries je Kachel wären die Alternative ohne Rücklesen, aber ihr Ergebnis kommt ebenfalls ein bis zwei Bilder später und
kostet je Kachel einen Draw.

**Kosten:** 4 bis 5 AT (Pyramide, asynchrones Lesen, Rückprojektion, Tests, Proben für Aufploppen).

**Empfehlung:** erst nach (a) bis (d) und nur, wenn die Straßenansicht danach noch zählt; unter WebGPU als Compute-
Pass im selben Bild ohne Verzug.

### Nebenbefund: der Boden

Der Boden kostet in jeder Ansicht am meisten (0,7 bis 1,1 ms, 30 bis 75 % der gemessenen Ansicht). Für „mehr zeichnen“ ist das der größte freie Posten:
weniger Splat-Schichten in der Ferne, frühe Tiefe (prüfen, ob der Boden vor den Objekten zeichnet; zuletzt gezeichnet schattiert er
verdeckte Pixel nicht), Fernring ohne Detailtexturen. Eigener Punkt (Entscheidung 7), hier nur gemessen.

## 7. Reihenfolge und erwarteter Gewinn

| Schritt | Baustein | Aufwand | Erwarteter Gewinn | Begründung der Stelle |
|---|---|---|---|---|
| 1 | (a) Ausklammern je Instanz über Kacheln, je Pass | 4 bis 6 AT | GPU heute 0 bis −15 % je Ansicht, bei 200 000 Objekten −10 bis −16 %; vor allem: ein Objekt kostet nur noch, wenn es im Bild ist | Voraussetzung für (b) |
| 2 | (b) Sichtweite nach Bildgröße, Kostenrechnung neu | 4 bis 6 AT | Z1 für Gebäude, Bäume und große Objekte; Kleinkram unter der Pixelgrenze geht (6 bis 33 % der Objekt-Dreiecke unter 4 px) | erst mit (a) bezahlbar |
| 3 | (d) Linien als Band | 4 bis 6 AT | Z1 für Linien und Gleise; fern 4 bis 8 statt 116 bis 335 Dreiecke je Stück, 5 100 von 38 000 Instanzen in Würzburg werden fern zu Bändern | größter sichtbarer Gewinn in Städten |
| 4 | (c) HLOD je Kachel | 6 bis 10 AT | Z3, Z4, Z5: CPU und Schatten fern je Kachel statt je Objekt | lohnt, sobald (b) und (d) die Ferne füllen |
| 5 | (e) Verdeckung grob je Kachel | 4 bis 5 AT | −0,1 bis −0,5 ms in Straßen und flachen Stadtblicken, ~0 von oben | kleinster Gewinn in der Spielansicht, meiste Risiken |
| neben | Boden (eigener Punkt) | offen | bis −0,5 ms, Schätzung | größter Einzelposten |

Summe (a) bis (d): Würzburg zeigt alles bis zum Rand bei gleicher GPU-Zeit (die Rechnung: (a) gibt 0,1 bis 0,3 ms frei,
(b) und (d) verbrauchen fern wenig, weil fern Bänder und Kästen statt Modelle stehen), die Lastkarte mit 200 000
Objekten nähert sich der heutigen 80 000er. Belegt wird jeder Schritt mit der Probe vor und nach dem Bau.

## 8. Auswirkungen

- **Coop, Determinismus, Replays**: die Simulation im Worker sieht nichts davon (sie kennt keine Meshes). Eine Stelle
  zählt fürs Spiel: der **Sicht-Cube** der Tower. Die Maske rechnet heute der Host und verteilt sie (`LosMask`,
  `CommandLog.recordLos`), Replays tragen sie als Daten. Regeln für alle Bausteine: der Cube klammert nur nach seinem
  eigenen Flächenkegel aus, nie nach der Kamera, nie nach Bildgröße, nie nach Verdeckung aus Spielersicht, nie über
  HLOD. Heute sieht der Cube „die Stufe, die die Kamera gewählt hat“ (Kommentar in `object-layer.ts`); damit hängt eine
  Maske an der Kamera des Hosts im Moment des Baus. Vorschlag (Entscheidung 5): der Cube zeichnet eine feste Stufe je
  Asset. Das macht Masken unabhängig von der Kamera; der Preis je Cube ist vorher zu messen (Z6).
- **Schattenpass**: eigene Auswahl gegen den Schattenkasten der Sonne; ein Objekt außerhalb des Bildes wirft weiter
  Schatten hinein. HLOD-Kacheln werfen fern ihren Schatten als ein Mesh.
- **Editor**: zeichnet mit derselben `CustomMapView`; (a), (b), (e) wirken dort mit. HLOD-Kacheln (c) werden nach einer
  Änderung im Worker neu gebacken, verzögert (Pinselstrich zu Ende); bis dahin zeigt die Kachel ihre Einzelobjekte
  weiter (Fern-HLOD aus, solange die Kachel „schmutzig“ ist). Linien (d) brauchen ein Linien-Werkzeug, das die Linie als
  Linie speichert (Entscheidung 4); der heutige Objekt-Pinsel setzt Stücke einzeln (`object-tool.ts`, `objectsAlong`).
- **Budget-Panel und Prüfung**: `scene-cost.ts` rechnet heute Kreisringe bis `drawDistance`. Neu: Distanz bis zur
  Pixelgrenze, Anteil des Sichtkegels, Bänder und Kacheln für Linien und Ferne. `SCENE_BUDGET` wird mit der Probe
  und `render-bench.ts` neu kalibriert; die 80-%-Grenze der mitgelieferten Karten (`shipped-maps-check`) neu geprüft.
  Der OSM-Import (`FURNITURE_BUDGET_SHARE` 15 %, Pflanzen 50 %) bekommt die neue Rechnung mit.
- **Mitgelieferte Karten**: (a), (b), (c), (e) brauchen keine Änderung der Dateien. (d) braucht Linien im Dokument:
  Formatversion hoch, `npm run maps:bake`, keine Rücksicht auf alte eigene Karten (Editor in Entwicklung).
- **Grafikstufen**: `lodBias` als Sichtweite fällt weg, dafür eine Pixelgrenze je Stufe (Vorschlag Low 3 px, Medium
  2 px, High 1,5 px, Ultra 1 px), die HLOD-Distanz je Stufe, Verdeckung als Schalter. RENDER_QUALITY.md bekommt die
  neue Zeile.
- **Zerstörung**: Ruinen bleiben Einzelobjekte (eigene Ruinen-Batches); fällt etwas, wird seine HLOD-Kachel neu
  gebacken und das Band einer Linie bekommt eine Lücke. Ruinen-Programme (E280) sind davon unberührt.

## 9. Umzug auf WebGPU, kurze Betrachtung

Kurz, weil es ein eigener Plan wäre. Gezählt in `src/app` (ohne Specs, Textsuche nach den genannten Mustern,
2026-10-21): 1 337 TS-Dateien, davon **55 mit GLSL-Shadern** (148 `main()`), **50 mit `new ShaderMaterial`** (74 Stellen)
und 1 mit `RawShaderMaterial`, **30 mit `onBeforeCompile`** (58 Stellen), 25 mit Chunk-Ersetzungen (`#include`,
157 Stellen), 47 mit `logdepthbuf`-Chunks (223 Stellen), 13 mit `texelFetch`, 24 mit eigenen `DataTexture`s, 9 mit
`customDepthMaterial`/`customDistanceMaterial`, 5 Dateien Post-Processing über `EffectComposer` und `UnrealBloomPass`,
1 mit Stencil (Reichweitenringe), 5 mit synchronem `readPixels`/`readRenderTargetPixels`, 3 mit der asynchronen Form,
16 mit `compileAsync`/`KHR_parallel_shader_compile`, 9 mit direkten `gl.*`-Aufrufen (Timer, Benchmark, KTX2, Editor),
49 Dateien mit `WebGLRenderer` im Typ.

**Was three sagt** ([Manual, WebGPURenderer](https://threejs.org/manual/pages/webgpurenderer.html)): „Custom materials
based on ShaderMaterial, RawShaderMaterial and modifications of built-in materials via onBeforeCompile() are not
supported in WebGPURenderer. This part of your application must be ported to node materials and TSL.“ `EffectComposer`
ebenso nicht, es gibt einen eigenen Post-Processing-Stapel. Der Renderer hat einen WebGL-2-Rückfall (`forceWebGL`) und
heißt dort selbst „still in an experimental state“; `WebGLRenderer` wird gepflegt, bekommt aber keine größeren
Neuerungen mehr. TSL übersetzt nach WGSL oder GLSL, je Backend. TSL/Node-Materialien laufen nur im `WebGPURenderer`
(beide Backends), nicht im heutigen `WebGLRenderer`. `glslFn`/`wgslFn` betten Rohcode ein, aber nur für ein Backend.

**Probe** (`e2e/perf/tsl-probe.ts`, 2026-10-21, gleicher Rechner): ein mittlerer Shader nach dem Muster der Ruinen
(`ruin-damage.ts`, vereinfacht) einmal in TSL geschrieben: je Instanz ein vec4 (Stufe, Saat, Fallbeginn, Richtung),
eine Zeile Löcher in einer Datentextur (`textureLoad`), Risse und Ruß aus Rauschen, ein abgebissenes Eck und Löcher per
`Discard`, der Teil über einer gezackten Bruchlinie fällt (`positionNode`), Standardlicht mit Sonnenschatten. 2 000
Häuser, 1280 × 720. Ergebnis: läuft auf beiden Backends ohne Änderung, die Bilder sind gleich (0,01 % der Pixel weichen
um mehr als 8/255 ab). GPU je Bild: WebGPU 0,66 ms, das WebGL-2-Backend desselben Renderers 0,96 ms (ein Lauf;
ein Vergleich mit dem heutigen `WebGLRenderer` und GLSL ist das nicht); Programme bzw. Pipelines bauen 286 ms (WebGPU)
gegen 444 ms. Der Schattenpass kam ohne eigenes Tiefenmaterial aus: er leitet sich aus demselben Graphen ab
(heute brauchen Ruinen, Impostoren und Fernkästen eigene Tiefen- und Distanz-Zwillinge). WebGPU lief nur im
installierten Chrome (`--chrome`); das Chromium von Playwright meldete „Device failed at creation“ und fiel still auf
WebGL 2 zurück. Für E2E- und Messläufe unter WebGPU braucht es also den Chrome-Kanal.

**Shader-Familien: „einmal schreiben, beide Backends“**

| Familie (Beispiele) | Dateien | Einstufung | Grund |
|---|---|---|---|
| Chunk-Patches über `onBeforeCompile` an Standardmaterialien (Gelände `terrain-material.ts`, Objekte `object-layer.ts` mit Wind, LOD-Blende, Atlas-Varianten, Nachtfenster, Höhennebel; Gras, Ruinen, Fernkästen, Mass-Layer) | 30 | mittel | TSL hat die Einstiegspunkte (`positionNode`, `colorNode`, `normalNode`, `emissiveNode`, `outputNode`, Nebel als `fogNode`); die heute gestapelten Patches werden kleine Node-Funktionen. Arbeit ist das Nachbauen der Optik bis zur Gleichheit, nicht Technik |
| `logdepthbuf`-Chunks | 47 | leicht | entfällt: der Renderer setzt logarithmische Tiefe selbst |
| `ShaderMaterial` mit eigenem GLSL (Wasser 1 030 Zeilen, Himmel, Partikel, Decals, Effekte, Zielmarken, Laser, Pilzwolke …) | 50 | mittel bis schwer | Zeile für Zeile nach TSL; Wasser und Himmel sind die großen Brocken. Mechanisch, aber viel |
| GLSL3-Mittel (`texelFetch`, Ganzzahlen, `gl_VertexID`-Ersatz) | 13 | leicht | `textureLoad`, `ivec`, `vertexIndex`/`instanceIndex` gibt es in TSL auf beiden Backends |
| Datentexturen, VAT der Gegner (`vat-material.ts`) | 24 | leicht bis mittel | Texturzugriffe 1:1; Storage-Buffer nur unter WebGPU, also für beide Backends bei Texturen bleiben |
| Post-Processing (`EffectComposer`, `UnrealBloomPass`, Farbkorrektur, Bloom-Schutz, NaN-Marken) | 5 | mittel | three hat `PostProcessing` mit Bloom-Node; Farbkorrektur und Schutz in TSL neu |
| Partikel als `Points` mit Größe | 6 | mittel | WebGPU kennt nur 1-Pixel-Punkte; three löst Größe nur über `Sprite` mit Instanzierung (`PointsNodeMaterial`, Quelltext r186) |
| Sicht-Cube (`tower-shadow-mapper.ts`: eigenes Distanzmaterial je Mesh, Instancing/Batching-Chunks, `losVertex`-Patch je Blocker, NoColorSpace, Nearest) | 3 | mittel | Distanz in TSL schreiben ist einfach; die 13 Regeln aus LOS_PIPELINE.md gelten neu und brauchen ihre Proben wieder |
| Stencil (Reichweitenringe) | 1 | leicht | Stencil gibt es in WebGPU |
| Direktes `gl.*` (Timer, Benchmark, KTX2-Transcoder-Test, Editor) | 9 | mittel | eigene Wege je Backend (Timestamps über `trackTimestamp`) |

**Modelle**

| Teil | Unverändert? | Anpassung |
|---|---|---|
| GLTF, KTX2, Draco, Meshopt laden | ja | `KTX2Loader.detectSupport(renderer)` mit dem neuen Renderer |
| InstancedMesh, BatchedMesh | ja | eigene Instanzattribute über `instancedBufferAttribute` (Probe) |
| SkinnedMesh | ja | Gegner nutzen ohnehin VAT; der VAT-Bäcker (`vat-baker.ts`) rechnet auf der CPU |
| VAT-Gegner | nein | Shader nach TSL (Datentextur, `vertexIndex` statt `aVertexIndex`) |
| Morph-Targets | ja | |
| Impostoren | nein | Karten-Shader, Tiefen-Zwilling, Bake per Render-Target in TSL |
| LOD-Wechsel mit Dither-Blende (`lod-fade.ts`) | nein | Patch nach TSL |
| Materialvarianten (Atlas, Ton je Stufe, Nachtfenster) | nein | Patches nach TSL; Programmschlüssel werden Node-Graphen |

**Logik am Rendering**

| Was | Heute | Unter WebGPU | Folge |
|---|---|---|---|
| Picking, Raycasts | CPU (three, BVH, Höhenfeld) | gleich | keine |
| Sicht-Cube auslesen | `readFacesAsync` (asynchron, `tower-los-registry.ts`), daneben synchron `readFacesToCpu` (ein Weg in `tower-los-registry.ts`, `gpu-cube-resolve.ts`) und die Debug-Fläche | nur asynchron (`readRenderTargetPixelsAsync`) | die synchronen Wege werden asynchron, ein Tower bekommt seine Sicht ein Bild später (das ist heute schon der Normalfall); der Kampf liest die Zellen-Caches, `LosMask` ist schon Daten |
| GPU-Sichtlinien und Determinismus | Host rechnet die Maske, verteilt sie (`CommandLog.recordLos`) | gleich | Simulation im Worker unberührt; zwei Backends können in Randpixeln anders rastern, das trifft nur, wer die Maske rechnet (der Host) |
| Shader vorwärmen, Programmcache (E273) | `compileAsync`, Pins, KHR_parallel | `compileAsync` baut Pipelines; Dawn hat einen eigenen Pipeline-Cache | die E273-Befunde (Cache nur im selben Prozess bei Playwright-Chromium) sind neu zu messen; die Programmzahl hängt dann an Node-Graphen, nicht an Defines |
| Screenshots, Vorschaubilder, Minimap | `readPixels`, `toDataURL` | asynchron | Ablauf mit `await` |
| Benchmark, E2E-Proben | `EXT_disjoint_timer_query_webgl2`, `renderer.info` | `trackTimestamp`, `resolveTimestampsAsync` | Proben anpassen, Chrome-Kanal |
| Bilder pro Frame | `render()` synchron | `render()` nach `await init()` (`renderAsync` ist veraltet) | einmal beim Start asynchron |

**Verfügbarkeit** ([gpuweb, implementation status](https://github.com/gpuweb/gpuweb/wiki/implementation-status),
abgerufen 2026-10-21): Chrome/Edge Windows, macOS, ChromeOS seit 113; Linux nur Intel Gen12+ (144) und NVIDIA ab
Treiber 535.183.01 unter Wayland (147), sonst hinter Flags; Firefox Windows ab 141, macOS Apple Silicon ab 145/147,
Linux nur Nightly (Freigabe „2026“ erwartet); Safari ab 26 auf allen Apple-Systemen. Electron bringt Chromium mit;
für das Linux-AppImage gilt die Chromium-Liste. Ein WebGL-2-Rückfall bleibt also nötig, und mit `WebGPURenderer` hat
man ihn ohne zweiten Shader-Satz.

**3D-Tiles**: Der User weist darauf hin, dass 3DTilesRendererJS nur „Echte Orte“ betrifft. Die README nennt kein
WebGPU; ein offenes Issue meldet, dass `ImageOverlayPlugin` unter `WebGPURenderer` scheitert
([Issue 1380](https://github.com/NASA-AMMOS/3DTilesRendererJS/issues/1380)). Unsere eigenen Patches an Tile-Materialien
(Sicht-Cube, Schattierung) müssten ohnehin nach TSL.

**Variante: WebGPU zuerst nur für eigene Karten und OSM-Welten, echte Orte bleiben WebGL2.** Entscheidend ist, was
beide Welten teilen: Gegner (VAT), Tower und Sockel, Effekte und Partikel, Geschosse, Zielmarken und Ringe,
UI-Overlays im 3D (Badges, schwebende Texte), der Sicht-Cube, das Post-Processing. Zwei Wege:

| Weg | Was | Aufwand | Risiko |
|---|---|---|---|
| A: zwei Renderer-Klassen (`WebGLRenderer` für Tiles, `WebGPURenderer` für Karten) | alle geteilten Shader doppelt (GLSL und TSL), zwei Post-Stapel, zwei Warm-up-Wege | hoch, und bleibt hoch: jede Änderung zweimal | zwei Wahrheiten, die auseinanderlaufen; widerspricht „keine parallelen Systeme“ |
| B: ein `WebGPURenderer` für alles, Backend je Welt-Art (`forceWebGL: true` für Tiles, solange die Tiles-Seite nicht geprüft ist) | geteilte Teile einmal in TSL; Tiles laufen auf dem WebGL-2-Backend desselben Renderers | einmal der volle Port (oben), danach nichts doppelt | Tiles auf dem neuen Renderer erst prüfen (Plugins, unsere Patches); ein Wechsel der Welt-Art baut den Renderer neu (Pipelines neu, Ladezeit) |

Schrittweise geht es nur bedingt. TSL läuft nicht im heutigen `WebGLRenderer`; die geteilten Teile lassen sich also
nicht vorab portieren, während das Spiel noch darauf läuft. Der Umzug ist ein Schnitt in drei Schritten: (1) alle
Shader nach TSL, der Renderer wird `WebGPURenderer` mit `forceWebGL: true`, gleiches Bild auf allen Karten und Orten
nachweisen (Optik-Abnahme, Sicht-Cube-Masken bitgleich, Proben); (2) WebGPU für eigene Karten und OSM-Welten
einschalten (Weg B); (3) Tiles auf WebGPU prüfen, dann auch dort. Umfang nach den Zählungen: rund 80 Dateien mit
Shader-Code (die Mengen oben überschneiden sich), davon etwa zehn große (Wasser, Gelände, Himmel, Objekte, Ruinen,
Impostoren, VAT, Partikel, Post, Sicht-Cube); mehrere Wochen Arbeit plus Abnahme der Optik je Karte. Gewinn für die
Zeichendichte: Ausklammern je Instanz und Verdeckung (Hi-Z) im Compute-Pass, indirektes Zeichnen, Listen ohne
CPU-Arbeit, genau dort, wo die Messung die Grenze zeigt (CPU je Objekt). Empfehlung: nicht jetzt; erst die
WebGL2-Bausteine (a) bis (d), die unter WebGPU bleiben (die Auswahl wandert dann nur von der CPU in den Compute-Pass),
dann neu entscheiden (Entscheidung 6).

Weitere Quelle für den Umzug (vom User, vor der Aufwandsschätzung lesen):
[WebGPU three.js migration guide (utsubo)](https://www.utsubo.com/blog/webgpu-threejs-migration-guide).

## 10. Entscheidungen (User 2026-10-21)

1. **Reihenfolge, mit WebGPU:** WebGPU kommt sicher (zukunftssicherer, schneller, mehr möglich). Erst was den Umzug
   übersteht: (b) Sichtweite nach Bildgröße, (d) Linien als Band, (c) HLOD je Kachel; dann der Umzug auf WebGPU (ein
   `WebGPURenderer` für alle Welten, „Echte Orte“ über dessen WebGL2-Rückfall, alle Shader nach TSL, Weg B in
   Abschnitt 9); danach (a) Ausklammern und (e) Verdeckung direkt auf der GPU (Compute, indirektes Zeichnen, Hi-Z).
   Bis (a) deckelt die Pixelgrenze die Kosten. Vor dem Umzug eine Aufwandsschätzung.
   Vor (b): die Budgetfrage auf der ganzen Würzburg-Karte nachmessen (die Ausgangsmessung lief auf drei Ausschnitten;
   der Zweitrechner sah am Hauptbahnhof Gleise am Möblierungsbudget scheitern, E303).
2. **Sichtweite:** Pixelgrenze je Grafikstufe statt fester `drawDistance`; die Kostenrechnung zieht mit.
3. **Kacheln:** 128 m.
4. **Linien im Dokument:** eigenes Element „Linie“, neue Formatversion, mitgelieferte Karten neu backen, keine
   Altkarten-Rücksicht.
5. **Sicht-Cube:** feste Detailstufe, Kosten je Cube vorher messen.
6. **WebGPU:** siehe 1.
7. **Boden:** eigener Punkt, zusammen mit dem WebGPU-Umzug (die Boden-Shader werden dabei ohnehin neu geschrieben).
8. **Verdeckung:** nach dem Umzug, in WebGPU.
9. **Abnahme:** dieselbe Probe auf dem Hauptrechner (RTX 5080) und dem Zweitrechner (RTX 3080 Ti) vor und nach jedem
   Schritt; unter WebGPU mit installiertem Chrome.
10. **Pixelwerte (nach 2.9):** wie gebaut, Low 3, Medium 2, High 1,5, Ultra 1 px.
11. **Teilbudgets des OSM-Imports (nach 2.9):** bleiben bei 15 % Möblierung und 10 % Flächen, bis HLOD (c) Platz schafft.
12. **HLOD-Kacheln (nach 2.12, 2026-10-22):** verworfen. Gebaut und gemessen brachten sie auf Würzburg und der
    Lastkarte keinen Gewinn (GPU im Rauschen, Spitzen in der Stufenwahl), der Code ist zurückgenommen. Ein Kronendach je
    Kachel statt Impostoren und zusammengefasste Häuserblöcke bleiben Idee für nach dem WebGPU-Umzug. Damit gilt Punkt 11
    weiter, ohne Wartezeit auf (c).

Branch: Das ganze Programm läuft auf einem eigenen Branch (`render/density`). `next` bleibt spielbar und bekommt nur
Fixes; der Branch zieht `next` regelmäßig nach und kommt erst auf Zuruf des Users auf `next`.

## 11. Messwerkzeuge

- `e2e/perf/render-density.ts`: die Ausgangsmessung (oben). Beispiel:
  `node e2e/perf/render-density.ts --maps ruined-city,autumn-keep --own tmp/osm-out/osm-wuerzburgwelt.3dtdmap --json tmp/render-density.json --shots tmp/rd-shots`;
  `--only game,low`, `--quality ultra`, `--maps big:1201:80000` (Lastkarte), `--serve` (nur der Server).
  Eine OSM-Welt entsteht mit `tools/osm/osm-world.spec.ts` (`OSM_RAW`, `OSM_PLACES`). Die ganze Würzburg-Welt (2.8):
  die Abfrage von `osmWorldQuery(osmQueryBox(49.7932, 9.9312, 2400, 100))` einmal an Overpass, die Antwort als
  `<OSM_RAW>/wuerzburgwelt.json`, dann `OSM_PLACES="wuerzburgwelt:49.7932,9.9312"`; die Probe kennt für
  `osm-wuerzburgwelt` die Ansichten `street` und `station` (`VIEWS`). Die Probe liefert `public/` aus dem Arbeitsbaum:
  wer während eines Laufs den Katalog ändert, misst den Build mit dem neuen Katalog.
- `e2e/perf/tsl-probe.ts` mit `e2e/perf/tsl-probe/index.html`: ein Shader in TSL auf beiden Backends (Abschnitt 9).
- Für das ganze Spiel (mit Post-Processing, ohne Kamerawahl) bleibt `e2e/perf/render-bench.ts` (BENCHMARKS.md).
