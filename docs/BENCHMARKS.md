# Benchmark-Ergebnisse je Rechner

**Status:** Laufend gepflegt
**Stand:** 2026-10-13

Ergebnisse des eingebauten Benchmarks (Menü Extras, Benchmark; DevWorld, 40 Tower, Gegner mit 1 000 000 HP, Stufen
2000 bis 25 000 Gegner je bei Tempo 4 und 1, siehe [SIM_WORKER.md](SIM_WORKER.md#kennzahlen)) auf verschiedenen
Rechnern. Messreihen zur Entwicklung der Simulation (Worker, Hebel, Firefox) stehen weiter in
[SIM_WORKER.md](SIM_WORKER.md).

**Neue Messung eintragen:** den kopierten Text des Benchmarks als Abschnitt `### <Datum>, Rechner <Buchstabe>` mit
Code-Block unten anhängen, den Rechner in „Rechner“ ergänzen (CPU von Hand, der Browser kann sie nicht lesen; eine andere GPU derselben Maschine bekommt eine eigene
Kennung wie B2), eine
Zeile in „Übersicht“ nachtragen, dann `npm run benchmark-chart`. GPU so übernehmen, wie der Benchmark sie meldet: das
ist die GPU, auf der wirklich gezeichnet wurde.

## Rechner

| Rechner | CPU | RAM | GPU (gemeldet) | Bildschirm | System |
|---|---|---|---|---|---|
| A | AMD Ryzen 9 9950X3D, 16 Kerne / 32 Threads | 64 GB | NVIDIA GeForce RTX 5080 | 2560 × 1440, 144 Hz, Skalierung 125 % | Windows 11 Pro |
| B (Laptop) | AMD Ryzen 7 4800H, 8 Kerne / 16 Threads, 2,9 GHz | 32 GB | AMD Radeon Graphics (integriert), obwohl eine GTX 1650 Ti (4 GB) verbaut ist | 1920 × 1080, 144 Hz | Windows 11 Pro |
| B2 (Laptop) | AMD Ryzen 7 4800H (Maschine B) | 32 GB | NVIDIA GeForce GTX 1650 Ti (dediziert); 3DTD.exe per Windows-Grafikeinstellung auf „Hohe Leistung“ | 1920 × 1080, 144 Hz | Windows 11 Pro |
| C | Intel Core i9-9900K, 8 Kerne / 16 Threads, 3,6 GHz | 32 GB | NVIDIA GeForce RTX 3080 Ti | 1920 × 1080, Bildrate bei 60 (vermutlich 60 Hz) | Windows 11 Pro |

## Übersicht

FPS bei Tempo 1 (langsamste 5 % in Klammern) und Hauptthread-Zeit je Paket („Apply“) bei 20 000 Gegnern:

| Datum | Rechner | Stand | Laufzeit | 5 000 | 10 000 | 20 000 | ~25 000 | Apply bei 20 000 | Engpass |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-12 | A | `014f10af`+ (Dev-Stand) | Chrome 154, Fenster, DPR 1,25 | 144 (143) | 143 (143) | 98 (48) | 74 (36) | 8,43 ms | Hauptthread ab 15 000 |
| 2026-10-13 | A | v0.7.0 | Desktop-App (Chromium 152), DPR 1 | 144 (143) | 144 (143) | 77 (48) | 71 (36) | 6,08 ms | Bildrate fällt ab 15 000 vor Apply-Grenze |
| 2026-10-13 | B | v0.7.0 | Desktop-App (Chromium 152), DPR 1 | 37 (36) | 21 (21) | 12 (11) | 9 (9) | 13,85 ms | integrierte GPU ab wenigen tausend |
| 2026-10-13 | B2 | v0.7.0 | Desktop-App (Chromium 152), DPR 1 | 77 (48) | 34 (18) | 17 (16) | 14 (13) | 11,97 ms | GPU ab ~5 000, Hauptthread ab ~15 000 |
| 2026-10-13 | C | v0.7.0 | Desktop-App (Chromium 152), DPR 1 | 60 (60) | 60 (60) | 60 (60) | 56 (30) | 9,60 ms | Hauptthread bei 25 000 |

- **FPS sind vom Monitor gedeckelt** (A 144 Hz, C 60 Hz): C hätte bis 20 000 Gegner vermutlich deutlich mehr geschafft.
  Für den Vergleich der Rechner zählt die Apply-Zeit; künftige Messungen am besten an einem Monitor mit hoher
  Bildwiederholrate.
- Apply wächst linear mit der Gegnerzahl. Unter gleichen Bedingungen (v0.7.0, Desktop-App, DPR 1): A rund 0,3 ms je
  1000 Gegner, C rund 0,5 ms, B 0,75 bis 0,8 ms (TODO E107). A ist bei 25 000 Gegnern 1,65-mal so schnell wie C (7,55
  gegen 12,50 ms). Die ältere A-Messung vom 12.10. (Dev-Stand, DPR 1,25) lag mit 10,39 ms deutlich höher.
- **A fällt ab 15 000 Gegnern unter 144 FPS, obwohl Apply nur 4,8 bis 7,6 ms braucht** (98 FPS = 10,2 ms je Bild bei
  15 000): Ein anderer Teil des Bilds begrenzt dort, nicht das Übernehmen. Ursache nicht untersucht.
- **B rendert ohne Zutun auf der integrierten GPU**, obwohl die Desktop-App `powerPreference: 'high-performance'`
  setzt (PLAYTEST A3.3, Plan E14). Auf der GTX 1650 Ti (B2, 3DTD.exe per Windows-Grafikeinstellung auf „Hohe Leistung“) etwa doppelt so viele FPS: 77 statt 37
  bei 5000 Gegnern, 34 statt 21 bei 10 000. Auch Apply sinkt (3,0 statt 4,0 ms bei 5000, 15,5 statt 18,3 ms bei 25 000):
  ein Teil davon ist Hochladen in die Grafik.
- **B2 ist trotzdem grafikgebunden:** bei 5000 Gegnern 13 ms je Bild, davon 3 ms Apply.

## Charts

Tempo 1, je Rechner die neueste Messung als Linie (ältere stehen nur unten in den Tabellen). Erzeugt aus den Tabellen unter „Messungen“ (`npm run benchmark-chart`, läuft
auch mit `npm test`).

![FPS je Gegnerzahl](images/benchmarks-fps.svg)

![Hauptthread-Zeit je Paket](images/benchmarks-apply.svg)

## Bildkosten (Grafik-Benchmark)

Was ein Bild einer Welt kostet, ohne Spiel darauf (E154): Tiles-Orte, eigene Karten und die DevWorld mit denselben
festen Kamerawegen um das HQ (`src/app/benchmark/render-benchmark.ts`), damit „so flüssig wie Tiles“ messbar ist.

- **Ansichten:** `game` die Startansicht des Spiels, `close` 30 m neben dem HQ in 12 m Höhe (Gras, Nahdetails),
  `pan` ein voller Kreis um das HQ im Abstand und in der Höhe der Startansicht, `top` 500 m senkrecht über dem HQ wie
  im Editor. Je Ansicht 2 s Einschwingen (Tiles: bis keine Kachel mehr lädt, höchstens 20 s), dann 5 s Messung.
- **Spalten:** `Frame` mittlerer Abstand der Bilder, `p95` der Abstand, den nur 5 % der Bilder überschreiten, `GPU`
  die GPU-Zeit des Zeichnens je Bild per Timer-Query (`EXT_disjoint_timer_query_webgl2`, `gpu-timer.ts`; Mittel und
  p95), `CPU` Hauptthread-Zeit für Update und Zeichnen, `Calls` und `Triangles` je Bild über alle Durchgänge
  (Schatten, Szene, Nachbearbeitung). Ohne Timer-Query (Firefox, Safari) bleibt die GPU-Spalte leer; dann zählt
  `Frame` bei ungedeckelter Bildrate.
- **Im Spiel:** Menü Extras, „Graphics benchmark“ lädt die Seite mit `benchmark=render` auf derselben Welt neu und
  zeigt am Ende die Tabelle zum Kopieren. Ohne Bildratendeckel (Skript unten) ist `Frame` aussagekräftig, im normalen
  Browser deckelt der Monitor, dann zählt `GPU`.
- **Per Skript** (Nachtschicht, reproduzierbar): Build mit Entwicklungs-Umgebung, aber optimiert (der
  Produktions-Build öffnet eigene Karten per Link erst nach der Freigabe, E134), statisch ausliefern, dann
  `e2e/perf/render-bench.ts`. Das Skript öffnet je Welt und Stufe ein Fenster (sichtbar, ANGLE D3D11, Bildrate
  ungedeckelt), wartet auf `window.__renderBenchmark` und druckt alle Zeilen; den Kartenschlüssel liest es aus
  `src/environments/environment.ts`. `--shots <dir>` legt je Ansicht ein Bild ab (die Aufnahme stört die Messung dieser
  Ansicht etwas, für Ausgangswerte ohne).

```
npx ng build --configuration development --optimization --source-map=false --output-path dist/bench
node e2e/perf/serve.mjs dist/bench/browser 4322 --isolate
node e2e/perf/render-bench.ts --url http://localhost:4322 --worlds map:demo-valley,map:harbor-town,tiles:48.7758,9.1829 [--qualities low,medium,high,ultra]
```

### Ausgangswerte 2026-10-14

Rechner A (RTX 5080), Chromium aus Playwright, Fenster 1600 × 900, Canvas 1300 × 852, DPR 1, Stand `96a5a5aa` plus
Koop-Versand (ohne Einfluss aufs Bild), vor den Qualitätsstufen. Zeiten in ms je Bild.

```
World                 View   Frame  p95   GPU   GPU p95  CPU   Calls  Triangles
map:demo-valley       game   1.32   1.57  1.21  1.55     1.15  290    1.23 M
map:demo-valley       close  0.91   1.17  0.71  1.08     0.75  109    0.94 M
map:demo-valley       pan    1.79   2.19  1.66  2.33     1.12  263    0.97 M
map:demo-valley       top    1.16   1.42  1.03  1.48     1.00  229    0.82 M
map:harbor-town       game   3.43   4.26  2.81  3.77     3.21  1111   1.60 M
map:harbor-town       close  1.74   2.10  1.59  2.16     1.57  251    1.27 M
map:harbor-town       pan    3.84   4.80  3.25  4.15     3.16  1019   1.54 M
map:harbor-town       top    2.98   3.53  2.45  3.10     2.79  893    1.28 M
tiles 48.7758,9.1829  game   0.77   0.93  0.23  0.64     0.60  148    0.37 M
tiles 48.7758,9.1829  close  0.85   1.00  0.31  0.73     0.67  168    0.46 M
tiles 48.7758,9.1829  pan    2.38   2.97  0.78  1.35     1.70  128    0.34 M
tiles 48.7758,9.1829  top    0.59   0.70  0.12  0.30     0.43  91     0.24 M
```

- Die Ausgangslage des Plans ([CUSTOM_MAPS_NEXT_PLAN.md](CUSTOM_MAPS_NEXT_PLAN.md): Tiles 0,88 ms bei 192 Calls,
  Demo-Tal 1,39 ms bei 290, Hafenstadt 4,41 ms bei 1111) war der Bildabstand der Spielansicht ohne Deckel. Das
  Demo-Tal trifft sie (1,32 ms, 290 Calls), die Hafenstadt liegt darunter (3,43 ms, 1111 Calls), Tiles ebenfalls
  (0,77 ms, 148 Calls: wie viele Kacheln stehen, hängt vom Laden ab).
- **Tiles sind auf der GPU billig, eigene Karten nicht:** Tiles 0,23 ms GPU in der Spielansicht, das Demo-Tal 1,21 ms,
  die Hafenstadt 2,81 ms. Beim Schwenk über Tiles wächst der Bildabstand (2,38 ms) bei nur 0,78 ms GPU: dort kostet
  das Nachladen der Kacheln Hauptthread-Zeit.
- **Die Hafenstadt ist auch auf dem Hauptthread teuer:** 3,21 ms CPU bei 1111 Draw Calls, gut fünfmal so viel wie
  Tiles (0,60 ms). Weniger Draw Calls (Modellteile zusammenführen) helfen dort doppelt.

## Messungen

### 2026-10-12, Rechner A

Stand `014f10af` mit Änderungen im Arbeitsbaum, Chrome 154 im normalen Fenster. Übertragen aus der Tabelle in
[SIM_WORKER.md](SIM_WORKER.md#benchmark-im-spiel-bis-25-000-gegner-gemessen-2026-10-12); dort nicht genannte Felder als `-`.

```
Version  Commit     Browser     OS       Threads  Memory  GPU                      DPR   Viewport  Enemies  Speed  FPS  p05  Reached  Ticks/s  Worker  Apply/packet
dev      014f10af+  Chrome 154  Windows  -        -       NVIDIA GeForce RTX 5080  1.25  2048x983  2000     4x     144  143  -        30       8 %     1.28 ms
dev      014f10af+  Chrome 154  Windows  -        -       NVIDIA GeForce RTX 5080  1.25  2048x983  2000     1x     144  143  -        30       3 %     1.19 ms
dev      014f10af+  Chrome 154  Windows  -        -       NVIDIA GeForce RTX 5080  1.25  2048x983  5000     4x     144  144  -        30       12 %    2.17 ms
dev      014f10af+  Chrome 154  Windows  -        -       NVIDIA GeForce RTX 5080  1.25  2048x983  5000     1x     144  143  -        30       5 %     2.18 ms
dev      014f10af+  Chrome 154  Windows  -        -       NVIDIA GeForce RTX 5080  1.25  2048x983  10000    4x     144  142  -        30       25 %    4.22 ms
dev      014f10af+  Chrome 154  Windows  -        -       NVIDIA GeForce RTX 5080  1.25  2048x983  10000    1x     143  143  -        30       10 %    4.04 ms
dev      014f10af+  Chrome 154  Windows  -        -       NVIDIA GeForce RTX 5080  1.25  2048x983  15000    4x     126  72   -        30       36 %    7.62 ms
dev      014f10af+  Chrome 154  Windows  -        -       NVIDIA GeForce RTX 5080  1.25  2048x983  15000    1x     127  72   -        30       14 %    6.59 ms
dev      014f10af+  Chrome 154  Windows  -        -       NVIDIA GeForce RTX 5080  1.25  2048x983  20000    4x     97   48   -        30       51 %    10.22 ms
dev      014f10af+  Chrome 154  Windows  -        -       NVIDIA GeForce RTX 5080  1.25  2048x983  20000    1x     98   48   -        30       20 %    8.43 ms
dev      014f10af+  Chrome 154  Windows  -        -       NVIDIA GeForce RTX 5080  1.25  2048x983  24920    4x     73   36   -        30       63 %    12.80 ms
dev      014f10af+  Chrome 154  Windows  -        -       NVIDIA GeForce RTX 5080  1.25  2048x983  24920    1x     74   36   -        30       25 %    10.39 ms
```

### 2026-10-13, Rechner A

Desktop-App v0.7.0, Fenster 1920 × 1080, DPR 1: gleiche Bedingungen wie B und C.

```
Version  Commit    Browser     OS       Threads  Memory  GPU                      DPR  Viewport   Enemies  Speed  FPS  p05  Reached  Ticks/s  Worker  Apply/packet
v0.7.0   08364a7+  Chrome 152  Windows  32       32 GB   NVIDIA GeForce RTX 5080  1    1920x1080  2001     4x     144  143  3.99     30       8 %     1.16 ms
v0.7.0   08364a7+  Chrome 152  Windows  32       32 GB   NVIDIA GeForce RTX 5080  1    1920x1080  2000     1x     144  143  1.00     30       3 %     1.10 ms
v0.7.0   08364a7+  Chrome 152  Windows  32       32 GB   NVIDIA GeForce RTX 5080  1    1920x1080  5000     4x     144  143  3.99     30       12 %    1.98 ms
v0.7.0   08364a7+  Chrome 152  Windows  32       32 GB   NVIDIA GeForce RTX 5080  1    1920x1080  5000     1x     144  143  1.00     30       5 %     1.87 ms
v0.7.0   08364a7+  Chrome 152  Windows  32       32 GB   NVIDIA GeForce RTX 5080  1    1920x1080  10000    4x     144  143  3.97     30       22 %    3.64 ms
v0.7.0   08364a7+  Chrome 152  Windows  32       32 GB   NVIDIA GeForce RTX 5080  1    1920x1080  10000    1x     144  143  1.00     30       9 %     3.37 ms
v0.7.0   08364a7+  Chrome 152  Windows  32       32 GB   NVIDIA GeForce RTX 5080  1    1920x1080  15000    4x     126  72   3.98     30       34 %    6.15 ms
v0.7.0   08364a7+  Chrome 152  Windows  32       32 GB   NVIDIA GeForce RTX 5080  1    1920x1080  15000    1x     98   72   0.99     30       11 %    4.77 ms
v0.7.0   08364a7+  Chrome 152  Windows  32       32 GB   NVIDIA GeForce RTX 5080  1    1920x1080  20000    4x     77   48   3.97     30       36 %    6.46 ms
v0.7.0   08364a7+  Chrome 152  Windows  32       32 GB   NVIDIA GeForce RTX 5080  1    1920x1080  20000    1x     77   48   1.00     30       15 %    6.08 ms
v0.7.0   08364a7+  Chrome 152  Windows  32       32 GB   NVIDIA GeForce RTX 5080  1    1920x1080  24920    4x     72   36   3.99     30       48 %    8.00 ms
v0.7.0   08364a7+  Chrome 152  Windows  32       32 GB   NVIDIA GeForce RTX 5080  1    1920x1080  24840    1x     71   36   1.00     30       19 %    7.55 ms
```

### 2026-10-13, Rechner B

```
Version  Commit    Browser     OS       Threads  Memory  GPU                      DPR  Viewport   Enemies  Speed  FPS  p05  Reached  Ticks/s  Worker  Apply/packet
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   AMD Radeon(TM) Graphics  1    1920x1080  2001     4x     65   48   3.98     30       20 %    2.39 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   AMD Radeon(TM) Graphics  1    1920x1080  2000     1x     65   48   1.00     30       6 %     2.19 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   AMD Radeon(TM) Graphics  1    1920x1080  5000     4x     36   36   3.97     30       29 %    4.46 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   AMD Radeon(TM) Graphics  1    1920x1080  5000     1x     37   36   0.99     30       9 %     3.97 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   AMD Radeon(TM) Graphics  1    1920x1080  10000    4x     20   18   3.98     20       44 %    7.78 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   AMD Radeon(TM) Graphics  1    1920x1080  10000    1x     21   21   1.00     21       15 %    7.33 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   AMD Radeon(TM) Graphics  1    1920x1080  15000    4x     15   14   3.97     15       63 %    11.87 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   AMD Radeon(TM) Graphics  1    1920x1080  15000    1x     15   14   0.99     15       20 %    10.79 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   AMD Radeon(TM) Graphics  1    1920x1080  20000    4x     11   11   3.96     12       77 %    15.72 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   AMD Radeon(TM) Graphics  1    1920x1080  20000    1x     12   11   0.99     12       23 %    13.85 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   AMD Radeon(TM) Graphics  1    1920x1080  24920    4x     9    9    3.95     11       92 %    20.19 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   AMD Radeon(TM) Graphics  1    1920x1080  24840    1x     9    9    0.99     10       27 %    18.33 ms
```

### 2026-10-13, Rechner B2

Derselbe Laptop wie B, die 3DTD.exe per Windows-Grafikeinstellung auf „Hohe Leistung“, also die GTX 1650 Ti.

```
Version  Commit    Browser     OS       Threads  Memory  GPU                         DPR  Viewport   Enemies  Speed  FPS  p05  Reached  Ticks/s  Worker  Apply/packet
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce GTX 1650 Ti  1    1920x1080  2001     4x     144  141  3.97     30       17 %    1.80 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce GTX 1650 Ti  1    1920x1080  2000     1x     144  139  1.00     30       5 %     1.79 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce GTX 1650 Ti  1    1920x1080  5000     4x     76   48   3.98     30       26 %    3.35 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce GTX 1650 Ti  1    1920x1080  5000     1x     77   48   0.99     30       9 %     3.01 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce GTX 1650 Ti  1    1920x1080  10000    4x     32   21   4.00     30       43 %    6.31 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce GTX 1650 Ti  1    1920x1080  10000    1x     34   18   1.00     27       14 %    5.94 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce GTX 1650 Ti  1    1920x1080  15000    4x     22   21   3.98     22       61 %    9.73 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce GTX 1650 Ti  1    1920x1080  15000    1x     22   21   1.00     22       21 %    8.93 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce GTX 1650 Ti  1    1920x1080  20000    4x     17   16   3.97     17       75 %    13.31 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce GTX 1650 Ti  1    1920x1080  20000    1x     17   16   0.99     17       23 %    11.97 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce GTX 1650 Ti  1    1920x1080  24920    4x     14   13   3.97     14       86 %    17.14 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce GTX 1650 Ti  1    1920x1080  24840    1x     14   13   0.99     14       27 %    15.45 ms
```

### 2026-10-13, Rechner C

```
Version  Commit    Browser     OS       Threads  Memory  GPU                         DPR  Viewport   Enemies  Speed  FPS  p05  Reached  Ticks/s  Worker  Apply/packet
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce RTX 3080 Ti  1    1920x1080  2001     4x     60   60   3.99     30       9 %     1.32 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce RTX 3080 Ti  1    1920x1080  2000     1x     60   60   1.00     30       3 %     1.15 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce RTX 3080 Ti  1    1920x1080  5000     4x     60   60   3.99     30       16 %    2.83 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce RTX 3080 Ti  1    1920x1080  5000     1x     60   60   0.99     30       6 %     2.63 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce RTX 3080 Ti  1    1920x1080  10000    4x     60   60   3.98     30       29 %    5.42 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce RTX 3080 Ti  1    1920x1080  10000    1x     60   60   1.00     30       11 %    5.20 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce RTX 3080 Ti  1    1920x1080  15000    4x     60   60   3.98     30       44 %    8.07 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce RTX 3080 Ti  1    1920x1080  15000    1x     60   60   1.00     30       17 %    7.77 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce RTX 3080 Ti  1    1920x1080  20000    4x     60   60   3.98     30       58 %    10.59 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce RTX 3080 Ti  1    1920x1080  20000    1x     60   60   1.00     30       22 %    9.60 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce RTX 3080 Ti  1    1920x1080  24920    4x     51   30   3.98     30       71 %    13.05 ms
v0.7.0   08364a7+  Chrome 152  Windows  16       32 GB   NVIDIA GeForce RTX 3080 Ti  1    1920x1080  24920    1x     56   30   1.00     30       28 %    12.50 ms
```

Beide Läufe in der Desktop-App; „Chrome 152“ ist die Chromium-Version der App.
