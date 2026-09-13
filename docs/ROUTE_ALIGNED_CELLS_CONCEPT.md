# Konzept: Zellen parallel zur Route

Stand 2026-09-12. Nur Konzept, kein Code. Die Entscheidung liegt beim
Nutzer. Zeilenangaben beziehen sich auf den Stand von `wt/corridor` nach
dem Korridor nach Freiraum (`331c7a3`).

## Ausgangslage

Route-Zellen sind 2 m große Quadrate auf einem Raster nach Nord und Ost
(lokal x Ost, z Süd). Der Schlüssel ist `intCellKey(floor(x / 2), floor(z / 2))`
(`utils/global-route-grid.ts:100`, `:110`, Zellgröße `:88`), alle Zellen
liegen in einer `Map<number, RouteCell>` (`:47`). Eine Zelle gehört zum
Korridor, wenn ihr Mittelpunkt innerhalb der Halbbreite ihrer Seite liegt
(`generateSegmentCells`, `:270`). An schrägen Straßen entstehen dadurch
Treppenkanten, der Rand folgt der Straße nur in 2-m-Stufen, und die
Anzeigen zeichnen achsparallele Platten (`utils/tower-los-layer-builder.ts:263`,
`:292`; `utils/route-grid-aggregate-viz.ts:227`, `:376`).

Seit dem Korridor nach Freiraum ist der Korridor meist 4 bis 7 m pro
Seite breit statt 2 bis 3 m. Die Treppe am Rand ist dieselbe, im Verhältnis
zur Breite aber kleiner. Ob sie danach noch stört, zeigt erst der nächste
Playtest.

## Idee

Eine Zelle wird über ihre Lage zur Route bestimmt statt über das Raster:
Index = Strecke entlang der Route `s` (in 2-m-Schritten) mal Seitenversatz
`q` (in 2-m-Schritten, links negativ, rechts positiv). Die Zelle ist ein
Rechteck, gedreht in die Richtung ihres Segments, mit dem Mittelpunkt auf
der Mittellinie plus `q` mal der Normalen. Die Anzahl der Zellen quer folgt
den Halbbreiten links und rechts (`corridorLeft`, `corridorRight`).

Die Gegner kennen `s` und ihren Versatz schon: `currentIndex` und
`progress` entlang des Pfads, der Versatz ist `lateralFactor` mal der
Grenze ihrer Seite (`game-components/movement.component.ts:411`, `:425`),
die Streckensummen liegen im Routenprofil (`utils/route-corridor.ts:434`).
Die Zuordnung Gegner zu Zelle bräuchte also keinen Raster-Lookup.

## Was heute am Raster und am Zellschlüssel hängt

| Bereich | Stelle | Wie oft | Annahme |
|---|---|---|---|
| Gegner-Zuordnung | `managers/enemy.manager.ts:450` ruft `updateEnemyPosition` (`global-route-grid.ts:885`), Memo `routeCellGen`/`routeCellKey`/`routeCell` (`entities/enemy.entity.ts:56-58`) | pro Gegner und Sub-Step | Punkt ergibt genau einen Schlüssel über `floor(x / 2)` |
| Gegnerhöhe | `enemy.manager.ts:476` ruft `getGroundLocalYForEnemy` (`global-route-grid.ts:1000`), Rückfall `estimateTerrainY` (`:166`) mit 3×3- und 5×5-Nachbarring | pro Gegner und Sub-Step | Nachbarn über `dx`/`dz` im Raster |
| Kandidaten fürs Targeting | `services/combat/tower-combat.service.ts:168` ruft `getEnemiesForTower` (`global-route-grid.ts:949`) über `tower.visibleCells` | pro Tower und Sub-Step | Liste von Zellen je Tower |
| LOS je Kandidat | `tower-combat.service.ts:79`, `:100-101` ruft `isPositionVisibleFromTower` / `isAirPositionVisibleFromTower` (`global-route-grid.ts:1104`, `:1117`), die rechnen über `getCellAt` (`:968`) den Schlüssel neu; Rückfall CPU-Raycast `tower-combat.service.ts:112` | pro Kandidat und Tower | Punkt ergibt eine Zelle |
| Umkreis | `getEnemiesInRadius` (`global-route-grid.ts:1021`) läuft ein Quadrat von Rasterindizes ab; Aufrufer: Targeting ohne `visibleCells` (`tower-combat.service.ts:179`), Splash (`services/combat/combat-effect.service.ts:177`) | pro Einschlag | Nachbarschaft im Raster |
| LOS-Registrierung | `registerTower` (`global-route-grid.ts:691`), `registerTowerIncremental` (`:778`) über die Indexbox `cellsInRange` (`:658`); eine Probe je Zelle am Mittelpunkt, Boden +1,5 m, Luft +15 m (`configs/los-viz.config.ts:44`, `:38`); `isCubeVisible` (`utils/gpu-cube-resolve.ts:139`) nimmt einen beliebigen Punkt | pro Registrierung und Recompute | Zelle hat einen Mittelpunkt |
| Veraltete LOS | `services/tower-placement.service.ts:207` (Mittelpunkt in Reichweite) | pro Änderungsschub | wie oben |
| Höhenprobe | `utils/route-cell-sampler.ts:81`, Säule am Mittelpunkt `:126`, LOD-Peek `:98`, Ausreißertest gegen den Nachbarmedian (`global-route-grid.ts:143`) | Erzeugung, Tile-Sweep, Registrierung | eine Höhe je Zelle, Nachbarn im Raster |
| Luftschicht | `getAirTargetY` (`utils/route-cell.ts:88`); Röhre `utils/route-altitude-tubes.ts:114`, `:126` | Registrierung, Debug | eine Höhe je Zelle |
| Anzeige je Tower | Plattengröße aus der Zellgröße (`tower-los-layer-builder.ts:86`, `:263`), Instanz nur verschoben, nicht gedreht (`:292`), Shader liest den Mittelpunkt aus `instanceMatrix[3]` (`:120`) | pro Auswahl oder Vorschau | achsparallele Quadrate |
| Aggregat-Anzeige | `route-grid-aggregate-viz.ts:227`, `:376`, Reihenfolge der Instanzen gleich der Map-Reihenfolge | Debug, pro Frame Farben | wie oben |
| LOS-Debug | `services/debug/los-debug.service.ts:304` (ein Pixel je Mittelpunkt) | Debug | Mittelpunkt |
| Kampfspuren | `three-engine/renderers/scorch-marks.ts:52` (eine Brandspur je Zellschlüssel) | pro Treffer | Schlüssel pro Ort |
| Verteidigungsreichweite, KI | `services/world/global-route-grid.service.ts:633` (`getDefenseReachPercent`), `ai/core/dps-profile.ts:123` (Bins für den KI-Encoder) | KI-Schnappschuss | Punkt ergibt eine Zelle |
| Platzierungsregeln | `utils/tower-placement-rules.ts:68` misst den Abstand zur Routenlinie | pro Platzierung | nicht zellbasiert, bleibt |
| Diagnose | `__rg` (`global-route-grid.service.ts:66`), `__corridor.towerCells()` (`services/debug/corridor-console.ts:94`, Lochsuche `global-route-grid.ts:1169`), `services/debug/enemy-debug.service.ts:397` | Debug | Raster, Nachbarn über Achsen |
| Mehrere Routen | `generateSegmentCells` vereinigt über den Schlüssel (`global-route-grid.ts:302`), eine Zelle kennt keine Route | pro Routenbau | ein Ort, eine Zelle |
| Tests | `utils/global-route-grid.spec.ts` (Zellen quer zählen, Schlüssel um den Ursprung, Lochtest), `integration/route-corridor-coverage.spec.ts`, `three-engine/renderers/scorch-marks.spec.ts`, `services/tower-placement-los.spec.ts`, `utils/tower-los-layer-builder.spec.ts` | | Raster |

Unabhängig von der Zellform sind: die LOS-Auflösung selbst (sie braucht nur
einen Punkt), der Anzeige-Shader (braucht nur den Mittelpunkt), die
Platzierungsregeln und die Tile-Verfeinerung entlang der Route
(`three-engine/three-tiles-engine.ts:61`, 20 m pro Seite).

## Problemstellen

**Knicke.** Zwei Segmente mit einem Knick um den Winkel φ: Außen klafft
zwischen den Rechtecken ein Keil, innen überlappen sie. Am Rand bei der
Halbbreite H ist der Keil etwa 2·H·sin(φ/2) breit, bei H = 7 m und 45°
rund 5,4 m, also zwei bis drei Zellen. Lösungen: Gehrung (die Zellen am
Knick werden Trapeze bis zur Winkelhalbierenden, außen länger, innen
kürzer, innen bei engem Knick bis auf null), Fächerzellen um den Knoten,
oder Überlappung zulassen und den Keil mit Zusatzzellen füllen. Viele
Routen haben alle paar Meter einen kleinen Knick (Formknoten von OSM).

**Kreuzungen und mehrere Routen auf derselben Straße.** Heute vereinigt
das Raster alle Routen. Mit Zellen je Route hätte eine Straße, die zwei
Spawns nutzen, zwei Sätze Zellen am selben Ort, und an einer Kreuzung
überlappen sich die Zellen zweier Routen schräg. Towers würden beide
registrieren, die Anzeige beide zeichnen. Abhilfe: Zellen je gemeinsamem
Straßenabschnitt statt je Route (Schlüssel wie `segmentKey`,
`services/world/path-route.service.ts:51`; Gegenrichtung heißt gespiegeltes
`s` und `q`). An der Kreuzung selbst bleibt Überlappung.

**Punkt ergibt Zelle für alles ohne Routenbezug.** Splash, Brandspuren,
rote Linie, Debug und die LOS-Abfrage je Kandidat fragen mit einer Position.
Gedrehte Zellen brauchen dafür einen räumlichen Index, etwa das heutige
Raster als Index auf Zell-IDs; eine Rasterzelle kann dann mehrere
Routenzellen führen.

**HQ-Endstück.** Es läuft querfeldein zum HQ und biegt meist rechtwinklig
von der Straße ab: ein harter Knick, oft durch Gebäude.

**Brücken.** Heute hat eine Zelle eine Fläche, am gemeinsamen Ort gewinnt
der Boden, Gegner auf der Brücke sacken dort ab. Mit Routenzellen wären
Brücke und Straße darunter getrennte Zellen: ein Vorteil dieses Ansatzes.

**Wechselnde Breite.** Die Zahl der Zellen quer ändert sich entlang `s`
und je Seite getrennt. Der Index `q` bleibt stabil, Randzellen fallen weg
oder kommen hinzu. Mit dem Taper der Gegner passt das zusammen.

## Varianten

### A: Echte Routenzellen mit Gehrung

Zellen je gemeinsamem Straßenabschnitt, indiziert über `s` und `q`, an
Knicken als Trapeze, dazu ein Raster-Index auf Zell-IDs für Abfragen per
Punkt.

- Vorteile: Zellen folgen der Straße ohne Treppe. Gegner werden aus ihrer
  Bewegung zugeordnet, ohne Geo-nach-Lokal-Rechnung für diesen Zweck.
  Brücke und Straße darunter sind getrennt. Anzeige und Spiellogik zeigen
  dieselben Zellen.
- Nachteile: Alle Stellen der Tabelle oben ändern sich. Knicke, Kreuzungen
  und das HQ-Endstück brauchen Sonderfälle. Zwei Datenstrukturen (Zellen
  und Punkt-Index), die zusammenpassen müssen. Die Tests zum Raster sind neu
  zu schreiben, der Coverage-Beweis (jeder Gegner in einer Zelle) muss für
  Trapeze neu geführt werden.
- Aufwand grob 8 bis 12 Tage: Datenmodell und Erzeugung mit Gehrung 2 bis 3,
  Gegner-Zuordnung und Höhen 1 bis 2, Punkt-Index samt Splash, Brandspuren
  und Debug 1 bis 2, LOS-Registrierung und Anzeigen 1 bis 2, Tests,
  Coverage und Messung mit vielen Gegnern 2 bis 3.

### B: Raster bleibt, nur die Anzeige folgt der Route

Die Spiellogik bleibt, wie sie ist. Nur die Anzeigen zeichnen entlang der
Route.

- B1, gedrehte Platten: Jede Zelle merkt sich bei der Erzeugung die
  Richtung ihres Segments, die Platte wird darum gedreht. Aufwand etwa
  1 Tag. Die Treppe bleibt in der Lage, gedrehte Quadrate auf
  Rasterpositionen decken sich teils und lassen teils Fugen, das kann
  unruhiger aussehen als heute.
- B2, Band: Je Route (oder Straßenabschnitt) ein Streifen aus Vierecken
  entlang der Mittellinie, 2 m lang, quer bis zur Halbbreite je Seite, an
  Knicken mit Gehrung (für eine Anzeige ohne Spiellogik ist das einfach).
  Jedes Viereck nimmt Farbe und Höhe der Rasterzelle unter seinem
  Mittelpunkt. Aufwand etwa 2 bis 3 Tage.
- Vorteile: Kein Eingriff in Hot Path, Kampf und LOS. Wenige Dateien
  (`tower-los-layer-builder.ts`, `route-grid-aggregate-viz.ts`, ein
  Band-Aufbau). Geringes Risiko.
- Nachteile: Anzeige und Logik weichen am Rand bis zu etwa einer halben
  Zelle ab. Ein Gegner am Rand einer Treppe gehört weiter zur quadratischen
  Zelle mit deren LOS-Antwort. Wo zwei Routen dieselbe Straße nutzen,
  zeichnet B2 ohne Zusammenlegung zwei Bänder übereinander.

### C: Hybrid, Routenzellen für Zuordnung, LOS und Anzeige, Raster als Punkt-Index

Wie A, aber ohne Gehrung: An Knicken dürfen sich Routenzellen innen
überlappen, den Keil außen füllen Zusatzzellen. Die Zuordnung eines Gegners
bleibt über `s` eindeutig, eine Abfrage per Punkt kann innen zwei Zellen
treffen und nimmt die erste. Höhe und Punkt-Abfragen laufen über das
Raster als Index.

- Vorteile: Weniger Geometrie als A, sonst dieselben Gewinne.
- Nachteile: Am Innenknick können zwei Zellen am selben Ort verschiedene
  LOS-Antworten haben. Umfang der Umbauten wie A.
- Aufwand grob 6 bis 8 Tage.

## Auswirkungen auf die Leistung

Gemessen ist nichts davon; die Einschätzung folgt aus dem Code.

- Gegner-Zuordnung pro Sub-Step: heute Geo-nach-Lokal
  (`enemy.manager.ts:438`), zwei `floor`, ein Schlüssel und der
  Memo-Vergleich, der fast immer trifft. Mit Routenzellen (A, C): Strecke
  aus Profil und `progress`, eine Division, der `q`-Index ist pro Gegner
  fest, dann derselbe Memo-Vergleich. Etwa gleich teuer. Die Geo-Position
  braucht das Rendering ohnehin.
- Targeting pro Kandidat: Die LOS-Abfrage rechnet heute den Schlüssel neu,
  statt die Zelle aus dem Memo zu nehmen (`tower-combat.service.ts:100`).
  Das ließe sich in jeder Variante sparen, auch ohne Umbau.
- Zellzahl: Die Fläche bleibt, die Zahl der Zellen damit etwa gleich; bei
  A kommen an Knicken Trapeze, bei C Überlappungen und Keilzellen hinzu,
  bei geteilten Straßen ohne Zusammenlegung doppelte Zellen.
- Registrierung und Anzeige: gleiche Zahl an Proben je Zelle; eine Drehung
  in der Instanzmatrix kostet pro Frame nichts.
- B ändert am Hot Path nichts.

## Risiken

- A und C: Regressionen im Kampf (Gegner außerhalb aller Zellen, LOS-Lücken
  an Knicken), neue Fehlerquellen an Kreuzungen und geteilten Straßen,
  Aufwand mit großer Unsicherheit, weil fast jedes Grid-Subsystem betroffen
  ist.
- B: Die Anzeige verspricht am Rand etwas anderes als die Logik tut.
  B1 kann optisch unruhiger werden als heute.

## Empfehlung

Erst den Playtest mit dem Korridor nach Freiraum abwarten. Der Korridor ist
jetzt meist doppelt so breit, und die Treppen am Rand wiegen dadurch
weniger. Stören sie dann noch vor allem optisch, B2 umsetzen: 2 bis 3 Tage,
ohne Eingriff in Kampf und Hot Path. A oder C lohnen sich erst, wenn auch
das Spielverhalten an der Treppe stört, etwa Gegner am Rand, die ein Tower
laut Anzeige sehen müsste, aber nicht angreift, oder wenn Brücken über
Routen häufig werden. Unabhängig davon lässt sich die LOS-Abfrage je
Kandidat auf die Memo-Zelle umstellen.
