# Routengeometrie: Analyse zum Playtest-Befund vom 2026-09-10

Stand 2026-09-11, Branch `wt/route-investigate`. Bezieht sich auf TODO 1.1
"Route folgt der Straße nicht, Route-Cells auf Dach und Baum".

> **Bericht.** Hält die Herleitung vom 2026-09-10 bis 2026-09-12 fest; Konstanten
> und Stellen in den Tabellen gelten für diesen Stand. Den laufenden Stand des
> Korridors beschreibt [ROUTE_CORRIDOR.md](../ROUTE_CORRIDOR.md), die
> Offenen Punkte am Ende sind vom 2026-09-15.

## Befund

Kleinstadt, Engstelle: Die rote Enemy-Route schneidet eine Hausecke, die
gelbe OSM-Straße biegt um das Haus. Die Route-Cells liegen auf Dach und
Baumkronen, Gegner laufen dort zu hoch. Ein Re-Raycast ändert nichts, die
Zellen folgen der Linie.

## Ergebnis in Kürze

1. **In der Lage (XY) geht nichts verloren.** Rote Linie, Zellen und Gegner
   laufen exakt auf dem Polygonzug der OSM-Ways, über die der A*-Pfad führt,
   mit allen Shape-Nodes. Es gibt keine Reduktion auf Kreuzungsknoten und
   keine Glättung (kein Douglas-Peucker, kein Spline, kein Resampling).
   Einzige Ausnahme ist das letzte Stück vom Abzweig zum HQ. Durch Specs
   belegt (siehe unten).
2. **Die gelbe Linie kann höchstens weniger Knicke haben als die rote, nie
   mehr:** Knoten, deren Höhenprobe keinen Treffer liefert, fallen aus ihr
   heraus (`street-rendering.service.ts`). Biegt gelb um ein Haus, während
   rot abkürzt, ist es also nicht dieselbe XY-Linie an dieser Stelle. Entweder
   läuft die Route dort über einen anderen Way, dessen gelbe Linie unter der
   roten verschwindet, oder beide liegen in XY übereinander und nur die Höhe
   unterscheidet sich.
3. **Die Höhen der roten Linie und des gelben Overlays entstehen
   unterschiedlich.** Rot, Zellen und Gegner nehmen die rohe Säulenprobe
   (unterster Treffer der feinsten LOD). Unter Baumkronen und Dachüberständen
   hat die Photogrammetrie keinen Boden, die Probe liefert Krone oder Dach.
   Gelb nimmt das seitliche Minimum und glättet. Eine Linie in Dachhöhe über
   einer Hausecke wirkt in der Perspektive, als schneide sie die Ecke.
4. Für den konkreten Ort ist die Ursache **nicht belegt**, der Ort ist nicht
   bekannt. `__routes.describe()` (neu, siehe unten) entscheidet es beim
   nächsten Playtest vor Ort.

## Die Kette von Overpass bis zur Zelle

| Schritt | Wo | Was passiert |
|---|---|---|
| Overpass | `osm-street.service.ts` | `way[highway~...]`, dann `out body; >; out skel qt;`: Ways mit allen Tags und alle ihre Knoten, auch außerhalb der Box |
| Parsen | `osm-street.service.ts` | Knoten in Way-Reihenfolge, fehlende Knoten werden übersprungen, kommt mit `>;` nicht vor |
| Graph | `osm-street.service.ts`, `pathfinding.worker.ts` | Jedes aufeinanderfolgende Knotenpaar jedes Ways wird eine Kante. Shape-Nodes sind normale Graphknoten |
| A* | `pathfinding.worker.ts` (Main-Thread-Kopie in `osm-street.service.ts`) | Pfad über `cameFrom`, jeder besuchte Knoten landet in der Liste |
| Start/Ziel | `pathfinding.worker.ts` | Erster Knoten des nächstgelegenen Segments |
| Route bauen | `path-route.service.ts` | lat/lon unverändert kopiert; `extendPathToOptimalTurnoff` hängt weitere Knoten desselben Ways an; Schnitt am HQ-nächsten Punkt; HQ als letzter Punkt. DevWorld unterteilt nur, Real World gar nicht |
| Höhen je Waypoint | `path-route.service.ts` | Zellhöhe an jedem Waypoint, ergibt `cachedPaths` |
| Rote Linie | `path-route.service.ts` (Line2) | Genau die Punkte aus `cachedPaths`; die Route-Animation nutzt über `routePathToLocalPoints` dieselben |
| Gegner | `movement.component.ts`, `enemy.manager.ts` | Lineare Interpolation zwischen Waypoints, dazu ein fester seitlicher Versatz pro Gegner, zufällig bis `lateralOffset` (Zombie 3,0 m, `enemy-types.config.ts`). Höhe pro Frame aus der Zelle an der Gegnerposition (`global-route-grid.ts`). Stand 2026-09-11, seit 2026-09-12 nach Korridorbreite, siehe unten |
| Zellen | `global-route-grid.ts` | Alle höchstens 2 m ein Stützpunkt auf jedem Routensegment, darum ein Kreis mit `CORRIDOR_WIDTH = 7` m Radius. Stand 2026-09-11, seit 2026-09-12 nach Korridorbreite, siehe unten |
| Zellhöhe | `column-sample.ts` | Unterster Treffer der feinsten LOD in der Säule |
| Gelbes Overlay | `street-rendering.service.ts` | Dieselben Knoten der gefilterten Ways. Höhe aus `getGroundHeightEstimate` (`terrain-queries.ts`: Mitte und je 3 m und 6 m quer; liegt die Mitte mehr als 3 m über dem Minimum, gilt das Minimum), danach `smoothPathHeights` (Fenster-Minimum, Hindernisschwelle 5 m, Steigungsgrenze, Gauß) |

Der einzige Douglas-Peucker im Code sitzt im DevWorld-Straßengenerator
(`devworld/generators/street-generator.ts`) und betrifft echte Orte nicht.

## Was die Tests belegen

- `pathfinding.worker.spec.ts`, `osm-street.service.spec.ts`: L-förmiger Way
  mit reinem Shape-Node an der Ecke, Kreuzungen nur an den Enden. Der Pfad ist
  `10, 1, 2, 3` und enthält den Eckknoten `2`.
- `path-route.service.spec.ts`: die ganze Main-Thread-Kette bis `cachedPaths`.
  Der Eckknoten ist in der gecachten Route, und jedes Segment außer dem
  HQ-Endstück liegt auf einer Kante eines OSM-Ways.

## Mögliche Ursachen am Ort

**A. Die Route nimmt einen anderen Way.** `ROAD_TYPE_WEIGHTS`
(`osm-street.service.ts`): `service` 1,2, `cycleway` 2,0, `track` und
`pedestrian` 2,5, `footway` und `path` 3,0. Ein Durchgang
(`tunnel=building_passage`, `covered=yes`) oder ein Fußweg über den Hof wird
genommen, sobald der Umweg um den Block länger ist als das Gewicht mal die
Abkürzung. Seine gelbe Linie liegt 0,5 m über Grund, die rote 1 m darüber und
2 px breit: Sie verdeckt die gelbe vollständig. Unter einem Durchgang trifft
die Säulenprobe von oben das Dach, die Zellen liegen also dort. Passt zu
"Hausecke" und "Dach".

**B. Gleicher Way, andere Höhe.** OSM-Mittellinie und Photogrammetrie sind
oft 1 bis 3 m gegeneinander versetzt. In einer Engstelle liegt der Eckknoten
dann unter Dachüberstand oder Baumkrone. Rot und Zellen nehmen Dach oder
Krone, gelb das seitliche Minimum. Passt zu "Baumkronen" und dazu, dass ein
Re-Raycast nichts ändert: Die Probe ist richtig, sie sieht dort nur keinen
Boden.

**C. Die Engstelle selbst.** Korridorradius 7 m, Versatz bis 3 m. In einer 4
bis 5 m breiten Gasse liegen die Zellen ab etwa 2 m neben der Mitte auf
Fassade oder Dach, und ein Drittel der Zombies (Betrag des Versatzes über 2 m
bei gleichverteilt bis 3 m) läuft dort und nimmt deren Höhe. Das passiert
auch bei richtiger Route und richtigem Eckknoten.

**D. HQ-Endstück.** Vom Abzweig geht es gerade zum HQ, bis zu 150 m weit
(`MAX_HQ_STREET_DISTANCE`, `map-constants.config.ts`), quer durch
alles, was dazwischen steht. Betrifft nur das Routenende.

## Nebenbefund, behoben

`closestPointOnSegment` (`path-route.service.ts`) projizierte das HQ in
rohen Grad auf das Segment. Ein Längengrad ist nur cos(lat) so lang wie ein
Breitengrad; auf jeder schräg liegenden Straße rutschte der Abzweig die
Straße entlang, bei 48° N und einer Diagonale um etwa 6,5 m. Das HQ-Endstück
lief dadurch schräg statt quer. Gleiche Skalierung wie in
`OsmStreetService.distanceToSegment` (Commit `00e55af`). Spec: "leaves a
diagonal street at the point closest to the HQ", auf dem alten Code rot.

## Diagnose beim nächsten Playtest

In DevTools `__routes.describe()` aufrufen (registriert im
`PathAndRouteService`, Tabelle aus `route-way-report.ts`). Eine Zeile je
Abschnitt einer Route über einen OSM-Way, alle Spalten in
[ROUTE_CORRIDOR.md](../ROUTE_CORRIDOR.md#__routesdescribe); für die Fälle hier:

| Spalte | Bedeutung |
|---|---|
| `route`, `fromIndex`, `toIndex` | Spawn-ID und Waypoint-Bereich |
| `way`, `type`, `name`, `tags` | OSM-Way (prüfen unter `https://www.openstreetmap.org/way/<id>`), `highway`, Name, `width`/`lanes`/`bridge`/`tunnel`/`covered`/`layer` |
| `lengthM` | Länge des Abschnitts |
| `maxCellAboveStreetM`, `at` | Größter Abstand Zellhöhe über Overlay-Höhe entlang der Mittellinie (alle 2 m) und die Stelle als `lat,lon` |

Deutung:

- An der Stelle `type` `footway`, `service`, `path` oder `steps`, oder `tags`
  mit `tunnel=` oder `covered=`: Fall A.
- `maxCellAboveStreetM` von mehreren Metern an der Stelle: Fall B oder C.
  Mit `__rg.dumpCellsInBox({ xMin, xMax, zMin, zMax })` lassen sich die
  Zellen daneben ansehen.
- `way` ist `null` nur in der letzten Zeile: das HQ-Endstück (Fall D).

Der Straßen-Cache hat den Schlüssel `v2_` bekommen: Ein bereits besuchter
Ort wird einmal neu von Overpass geladen, danach sind die Tags da.

## Korridor nach Straßenbreite (umgesetzt ab 2026-09-12)

Vorher war der Zellkorridor überall ein Kreis von 7 m Radius um die Route und
jeder Gegner lief mit festem Versatz bis `lateralOffset` (bis 3 m). Umgesetzt
wurde in mehreren Schritten, die Commits stehen unten:

- Halbbreite je Segment aus der OSM-Straßenbreite, Zellen und Seitenversatz
  der Gegner nach dieser Breite (Randbedingung: jeder Gegner steht in einer
  Zelle, sonst findet `getEnemiesForTower` ihn nicht).
- Nach dem Playtest vom 2026-09-12 ("an freien Stellen nicht breit genug"):
  Breite je Seite aus dem Freiraum, den waagrechte Strahlen in zwei Höhen an
  den Tiles messen; die OSM-Breite ist nur noch Rückfall.
- Brückendeck, Tunnel und überdachte Durchgänge, Dach-Check für Zellen
  neben der Mittellinie (zu Fall B), Nachmessen nach Tile-Schüben
  (`CorridorRefit`), Stellschrauben in `corridorConfig` mit `__corridor.set()`.

Den laufenden Stand mit Datenfluss, Einstellungen, Grenzen und Diagnose
beschreibt [ROUTE_CORRIDOR.md](../ROUTE_CORRIDOR.md). Seit 2026-09-14 setzt der
Dach-Check keine Zelle mehr auf den Boden, der Korridor endet vor ihr
(ROUTE_CORRIDOR.md, Laufweg).

## Lücken in der LOS-Anzeige eines Towers (Playtest 2026-09-12)

**Befund.** Auf einer schrägen Wohnstraße fehlten in der grünen
LOS-Anzeige eines ausgewählten Towers einzelne Zellen schachbrettartig,
auch auf freier Straße, ohne rote Zellen dazwischen. Das Debug-Grid wirkte
durchgehend, an Diagonalen mit Treppenkanten.

**Was der Code dazu sagt.** Die Anzeige (`tower-los-layer-builder.ts`)
zeichnet jede Zelle ihrer Liste, grün oder rot, der Shader entscheidet
gegen die Cubemap. Eine Platte, die fehlt, ist also eine Zelle, die nicht
in der Liste steht (`getCellsInRange`: nur Zellen mit Höhenprobe), oder
eine Platte, die woanders liegt.

| Hypothese | Ergebnis | Beleg |
|---|---|---|
| (a) Die Zellen existieren nicht | Verworfen | Jedes Segment beansprucht eine konvexe Fläche, auch mit getrennten Seiten. Test "leaves no hole in the corridor at any heading" (`global-route-grid.spec.ts`): 17 Richtungen, schmale und breite Stücke, eine Ecke, kein Loch. Ein Kontrolltest zeigt, dass der Lochdetektor ein entferntes Loch findet |
| (b) Zellen existieren, der Tower hat keine Antwort | Für die Anzeige ohne Wirkung | Die Anzeige liest `towerVisibility` nicht. Eine fehlende Antwort betrifft nur das Targeting (CPU-Raycast statt Nachschlagen) |
| (c) Verdeckt durch Tiles oder Tiefe | Verworfen | Die Boden-Platten zeichnen mit `depthTest: false` |
| (d) Höhe auf Autodach oder Krone | Möglich, ohne Browser nicht entscheidbar | Eine Platte 1,5 bis 8 m über dem Boden erscheint aus schräger Kamera versetzt, an ihrer Stelle bleibt eine Lücke. Das Debug-Grid nutzt dieselbe Höhe |
| (e) Zelle ohne Höhenprobe | Möglich, ohne Browser nicht entscheidbar | Solche Zellen stehen nicht in der Liste. Die Anzeige ist ein Schnappschuss, neu gebaut erst beim nächsten LOS-Recompute des Towers |

Auf einer schmalen Diagonale (2 m Halbbreite) liegen je Reihe nur zwei
bis drei Zellen, von Reihe zu Reihe versetzt, mit 0,3 m Fuge zwischen den
1,7-m-Platten. Das wirkt am Rand wie ein Schachbrett, ist aber lückenlos.
Der breitere Korridor macht solche Bänder seltener.

**Nebenbefund, behoben** (`88bd5cd`). Anzeige und LOS-Neuberechnung aller
Tower teilen einen `TowerShadowMapper`. Rechnet das Tile-Streaming im
Hintergrund einen anderen Tower neu, rendert er die Cubemap von seinem
Tip aus, und die Anzeige färbte ihre Zellen danach gegen dessen Sicht:
falsches Rot oder Grün, keine fehlenden Platten. Ob das zum Befund
beitrug, ist offen. Die Anzeige holt sich die Cubemap jetzt im nächsten
Frame zurück.

**Diagnose im Spiel.** Tower auswählen, in DevTools `__corridor.towerCells()`
aufrufen; ohne Koordinaten `__corridor.pick()` und dann auf die Stelle
klicken; dazu der Layer "Route Grid Overlay". Felder, Deutung und Konturen
stehen heute in [ROUTE_CORRIDOR.md](../ROUTE_CORRIDOR.md), Abschnitt Diagnose.
Zu den Hypothesen oben: `unsampled` und `notDisplayed` zeigen Fall (e),
`raised` Fall (d), `holes` widerspräche dem Test zu (a).

**Zweiter Befund: eine ganze Reihe entlang der roten Linie.** Auf einer
schrägen, freien, flachen Straße fehlte in der Anzeige genau die Reihe, durch
die die rote Linie läuft, über mehrere Zellen; links und rechts standen je
zwei Reihen. Geprüft:

| Kandidat | Ergebnis | Beleg |
|---|---|---|
| Die Säulenprobe trifft Routenlinie, Straßen-Overlay, Marker oder Gegner | Verworfen | Die Probe schneidet nur die Tile-Gruppe (`raycastColumn`); Routenlinie, Straßen und Marker hängen in der eigenen `overlayGroup` der Szene. Treffer ohne Tile würden ohnehin verworfen (`selectColumnSample`) |
| Die Mittelreihe wird von zwei Segmenten oder Routen beansprucht und dabei falsch behandelt | Verworfen | Test "keeps the centre row of a street two routes share, whichever way they run": zwei Routen gegenläufig auf derselben Straße, eine mit Abzweig; jede Zelle der Mittellinie existiert, hat eine Höhe, eine Antwort des Towers und steht in der Liste der Anzeige. Die Registrierung eines Towers läuft über alle Zellen in Reichweite, unabhängig davon, wer sie angelegt hat |
| Schlüssel und Position passen nicht zusammen (floor gegen round) | Verworfen | Test "finds every cell at its own centre, one cell per spot": Erzeugung und Suche nutzen dieselbe `cellIndex`-Regel, jede Zelle liegt allein an ihrer Stelle |
| Die Animation der Route (1 m breite rote Linie, 1,8 m breiter Schein, in Weltmetern) überdeckt die Reihe | Möglich, nur während sie läuft | Sie liegt mit `renderOrder` 2 und 3 auf der Höhe der Platten und endet nach einem Durchlauf; die statische rote Linie ist 2 px breit und verdeckt keine Platte |
| Zellen der Mittelreihe ohne Höhenprobe oder auf falscher Höhe | Offen | Zeigt `__corridor.towerCells()` (`centreUnsampled`, `centreRaised`, `centreNotDisplayed`) und `__corridor.pick()` an der Stelle |

## Backlog-Punkte aus "Terrain & Routing Experimente"

**OSM bridge/tunnel Tags abfragen.** Abfragen muss man nichts, `out body`
liefert sie. Seit Commit `62165c6` stehen `bridge`, `tunnel`, `covered` und
`layer` am `Street`. Was damit zu tun war:

- Brücke (umgesetzt, siehe Korridor oben): `selectColumnSample` nimmt den
  untersten Treffer. Unter einer Brücke ist das der Grund darunter (Fluss,
  Straße), Zellen und Gegner einer Brückenroute liefen also unten. Zellen von
  Brückensegmenten nehmen jetzt `topY` statt `groundY`. Die im Backlog
  genannte Idee "bridge: Korrektur überspringen" hätte nicht geholfen: Schon
  die Probe in der Mitte liefert den Grund unter der Brücke.
- Tunnel und Durchgang (umgesetzt, siehe Korridor oben): Die Probe von oben
  liefert die Oberfläche darüber. Die Zellen nehmen jetzt Höhen, die
  zwischen den Portalen linear interpoliert werden. Ein höheres
  Routing-Gewicht gibt es nicht, Routen laufen weiter durch Tunnel.

**Laterales Sampling nur auf Routen.** `street-rendering.service.ts` ruft
`getGroundHeightEstimate` für jeden Knoten jedes gefilterten Ways (bis zu fünf
Säulenproben, pro Säule gecacht). Umsetzbar wäre es klein: das Kanten-Set der
Routen an `renderStreets` geben, andere Ways nur mit der Mittelprobe. Nicht
gemacht, weil es die Optik der übrigen Straßen verschlechtert (mehr gelbe
Linien auf Kronen, `smoothPathHeights` greift erst ab 5 m), der Gewinn
begrenzt ist (progressiv 50 Knoten pro Frame, Säulen-Cache) und die laterale
Probe nach Fall B genau die Information ist, die den Zellen fehlt.

## Commits

| Hash | Titel |
|---|---|
| `fcbe1d8` | test(routing): prove shape nodes survive pathfinding and route build |
| `4ad010a` | fix(route): leave the street at the point really closest to the HQ |
| `03ffd7b` | feat(osm): keep width, lanes, bridge, tunnel, covered and layer on streets |
| `aa121aa` | feat(debug): __routes.describe() shows the ways and the height gap of a route |
| `1306460` | feat(route): estimate the corridor width per street |
| `a46c507` | feat(route): cached routes carry the corridor half width per segment |
| `daba76c` | feat(route-grid): the cell corridor follows the street width |
| `59e6db3` | feat(enemy): lateral offset follows the local corridor width |
| `147e4e3` | feat(route): narrow the corridor where the tiles show facades or trees |
| `b0a8424` | feat(route-grid): cells on a bridge take the deck, not the ground below |
| `88bd5cd` | fix(los): a tower's LOS display takes the shared cube back |
| `7e5b57b` | feat(debug): __corridor.towerCells() explains gaps in a tower's LOS display |
| `ef6a1d8` | refactor(route): collect the corridor knobs in one config |
| `331c7a3` | feat(route): corridor width from the free space the tiles show, per side |
| `9367158` | feat(debug): tune the corridor from the console with __corridor.set() |
| `bf695ff` | feat(debug): report the centre line cells and the grid around a click |
| `d2f3e26` | fix(route-grid): a cell whose column finds a roof stands on the ground |
| `f4532a1` | feat(route-grid): a bottleneck may be one cell wide |
| `8910463` | feat(route): a wall is what stops a low and a high ray |
| `cb925c6` | refactor(route): CorridorRefit decides when the corridor is rebuilt |
| `f9fe730` | feat(route): log how long each part of a corridor rebuild takes |
| (dieser) | feat(route): tunnels and covered passages keep their width and a height between the portals |

## Offene Punkte

Stand 2026-09-15; was seit dem Bericht umgesetzt ist, steht in ROUTE_CORRIDOR.md.

- Ort des Befunds vom 2026-09-10 unbekannt, mit `__routes.describe()` klären.
- Höhenmodell der Zellen: umgesetzt als Dach-Check gegen die Mittellinie
  daneben, seit 2026-09-14 als Laufweg (Dach- und Stufen-Check); Zellen der
  Mittellinie auf einem Dach nehmen die Höhe der Mittellinie ringsum.
- Korridor nach Freiraum pro Seite, Engstelle mit einer Zelle, zwei
  Strahlhöhen, Dach-Check, Tunnel und Durchgänge (Höhe zwischen den
  Portalen): umgesetzt, in den Playtests vom 2026-09-12 bis 2026-09-14
  nachgebessert.
- Fehlende Reihe entlang der roten Linie (Playtest 2026-09-12): Ursache
  offen, mit `__corridor.towerCells()` und `__corridor.pick()` an der Stelle
  klären.
- HQ-Endstück läuft gerade durch Gebäude, bis 150 m. Es hat die Breite der
  Straße, von der es abzweigt, und die Tile-Messung verengt es dort, wo
  Gebäude stehen.
- Beobachtet, nicht untersucht: Auf einem Playtest-Screenshot (Hongkong,
  Victoria Park Road) läuft die rote Linie am HQ vorbei und wieder zurück.
  Kandidat ist `extendPathToOptimalTurnoff` an einer zweibahnigen Straße.
