# Routengeometrie: Analyse zum Playtest-Befund vom 2026-09-10

Stand 2026-09-11, Branch `wt/route-investigate`. Bezieht sich auf TODO 1.1
"Route folgt der Straße nicht, Route-Cells auf Dach und Baum".

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
   heraus (`street-rendering.service.ts:223`). Biegt gelb um ein Haus, während
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
| Overpass | `osm-street.service.ts:215-223` | `way[highway~...]`, dann `out body; >; out skel qt;`: Ways mit allen Tags und alle ihre Knoten, auch außerhalb der Box |
| Parsen | `osm-street.service.ts:306-330` | Knoten in Way-Reihenfolge, fehlende Knoten werden übersprungen (`:313`), kommt mit `>;` nicht vor |
| Graph | `osm-street.service.ts:553`, `pathfinding.worker.ts:242` | Jedes aufeinanderfolgende Knotenpaar jedes Ways wird eine Kante. Shape-Nodes sind normale Graphknoten |
| A* | `pathfinding.worker.ts:341-403`, Rekonstruktion `:367` (Main-Thread-Kopie `osm-street.service.ts:623`) | Pfad über `cameFrom`, jeder besuchte Knoten landet in der Liste |
| Start/Ziel | `pathfinding.worker.ts:405-427` | Erster Knoten des nächstgelegenen Segments |
| Route bauen | `path-route.service.ts:358` | lat/lon unverändert kopiert; `extendPathToOptimalTurnoff` (`:373`) hängt weitere Knoten desselben Ways an; Schnitt am HQ-nächsten Punkt (`:403`); HQ als letzter Punkt (`:418`). DevWorld unterteilt nur, Real World gar nicht |
| Höhen je Waypoint | `path-route.service.ts:456` | Zellhöhe an jedem Waypoint, ergibt `cachedPaths` |
| Rote Linie | `path-route.service.ts` (Line2) | Genau die Punkte aus `cachedPaths`; die Route-Animation nutzt über `routePathToLocalPoints` dieselben |
| Gegner | `movement.component.ts:383-415`, `enemy.manager.ts:179` | Lineare Interpolation zwischen Waypoints, dazu ein fester seitlicher Versatz pro Gegner, zufällig bis `lateralOffset` (Zombie 3,0 m, `enemy-types.config.ts:124`). Höhe pro Frame aus der Zelle an der Gegnerposition (`global-route-grid.ts:1447`) |
| Zellen | `global-route-grid.ts:707`, `:759` | Alle höchstens 2 m ein Stützpunkt auf jedem Routensegment, darum ein Kreis mit `CORRIDOR_WIDTH = 7` m Radius (`:377`) |
| Zellhöhe | `column-sample.ts:59` | Unterster Treffer der feinsten LOD in der Säule |
| Gelbes Overlay | `street-rendering.service.ts:159-167`, `:216`, `:271` | Dieselben Knoten der gefilterten Ways. Höhe aus `getGroundHeightEstimate` (`three-tiles-engine.ts:1263`: Mitte und je 3 m und 6 m quer; liegt die Mitte mehr als 3 m über dem Minimum, gilt das Minimum), danach `smoothPathHeights` (Fenster-Minimum, Hindernisschwelle 5 m, Steigungsgrenze, Gauß) |

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
(`osm-street.service.ts:63`): `service` 1,2, `cycleway` 2,0, `track` und
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
(`MAX_PLACEMENT_STREET_DISTANCE`, `map-constants.config.ts:36`), quer durch
alles, was dazwischen steht. Betrifft nur das Routenende.

## Nebenbefund, behoben

`closestPointOnSegment` (`path-route.service.ts:754`) projizierte das HQ in
rohen Grad auf das Segment. Ein Längengrad ist nur cos(lat) so lang wie ein
Breitengrad; auf jeder schräg liegenden Straße rutschte der Abzweig die
Straße entlang, bei 48° N und einer Diagonale um etwa 6,5 m. Das HQ-Endstück
lief dadurch schräg statt quer. Gleiche Skalierung wie in
`OsmStreetService.distanceToSegment` (Commit `00e55af`). Spec: "leaves a
diagonal street at the point closest to the HQ", auf dem alten Code rot.

## Diagnose beim nächsten Playtest

In DevTools `__routes.describe()` aufrufen (`path-route.service.ts:915`,
registriert in `:131`). Eine Zeile je Abschnitt einer Route über einen
OSM-Way:

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

## Entwurf: straßenabhängiger Korridor (nicht umgesetzt)

**Daten.** `width`, `lanes` und `highway` stehen seit Commit `62165c6` am
`Street`. `width` ist in OSM selten gesetzt, `lanes` meist nur an größeren
Straßen, `highway` immer. Breitenschätzung: `width`, sonst `lanes` mal 3 m
plus 1 m, sonst eine Tabelle nach `highway` (etwa `primary` 8 m, `secondary`
7 m, `tertiary` 6,5 m, `residential` 5,5 m, `living_street` 4,5 m, `service`
3,5 m, `track` 3 m, `footway`/`path`/`cycleway`/`steps` 2 m).

**Randbedingung.** Jeder Gegner muss in einer Zelle stehen. Außerhalb der
Zellen fällt er aus `enemyCellKeys` (`global-route-grid.ts:1369-1376`),
`getEnemiesForTower` findet ihn nicht mehr. Der Radius darf deshalb nicht
unter den Versatz plus eine halbe Zelldiagonale fallen, heute 3,0 + 1,4, also
etwa 4,5 m. Ein schmalerer Korridor allein ändert an der Engstelle wenig: Die
Gegner mit großem Versatz stehen weiter in den Dachzellen. Der wirksame Hebel
ist, den Versatz mitzubegrenzen.

**Umsetzung in drei Teilen:**

1. Beim Routenbau jeder Kante ihren Way zuordnen (wie in `describeRoutes`)
   und pro Waypoint eine halbe Straßenbreite mitgeben, als optionales Feld
   oder als paralleles Array neben `cachedPaths`.
2. `generateFromRoutes` nimmt den Radius pro Segment statt der Konstante
   (`global-route-grid.ts:377`, einziger Leser `:765-766`):
   `r = clamp(halbe Breite + 1,5 m, 4,5 m, 7 m)`.
3. `MovementComponent` begrenzt den Versatz pro Segment auf
   `max(0, halbe Breite - 0,5 m)`.

**Warum nicht jetzt:** Es berührt Zellgenerierung (dort wird parallel
gearbeitet), Gegnerbewegung und Targeting-Abdeckung, ist spielrelevant und
ohne Teil 3 nahezu wirkungslos.

**Höhenmodell (zu Fall B).** Der direktere Hebel wäre, Zellhöhen gegen die
Mittellinie zu prüfen: Liegt eine Zelle deutlich über dem seitlichen Minimum
der Mittellinie, gilt dieses. Das wäre wieder ein Anker mit Toleranzband, den
`column-sample.ts` bewusst abgeschafft hat ("no anchor, no tolerance band, no
guessing"). Das ist eine Designentscheidung, keine Kleinigkeit. Nebenbei: Der
Kommentar an `RouteCell.routeAnchorY` (`global-route-grid.ts:65-70`)
beschreibt noch eine Verwerfung über `GROUND_ANCHOR_TOLERANCE_M`; die
Konstante gibt es nicht mehr.

## Backlog-Punkte aus "Terrain & Routing Experimente"

**OSM bridge/tunnel Tags abfragen.** Abfragen muss man nichts, `out body`
liefert sie. Seit Commit `62165c6` stehen `bridge`, `tunnel`, `covered` und
`layer` am `Street`, noch ohne Wirkung. Was damit zu tun wäre:

- Brücke: `selectColumnSample` nimmt den untersten Treffer. Unter einer
  Brücke ist das der Grund darunter (Fluss, Straße), Zellen und Gegner einer
  Brückenroute laufen also unten. Für Brückensegmente bräuchte die Zelle
  `topY` statt `groundY`. Die im Backlog genannte Idee "bridge: Korrektur
  überspringen" hilft nicht: Schon die Probe in der Mitte liefert den Grund
  unter der Brücke.
- Tunnel und Durchgang: Die Probe von oben liefert die Oberfläche darüber.
  Möglich wären ein höheres Routing-Gewicht oder Höhen, die zwischen den
  Portalen linear interpoliert werden.

**Laterales Sampling nur auf Routen.** `street-rendering.service.ts:216` ruft
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

## Offene Punkte

- Ort des Befunds unbekannt, mit `__routes.describe()` klären.
- Entscheidung zum Höhenmodell der Zellen (Anker gegen die Mittellinie oder nicht).
- Korridor und Versatz nach Straßenbreite (Entwurf oben).
- HQ-Endstück läuft gerade durch Gebäude, bis 150 m.
- Beobachtet, nicht untersucht: Auf einem Playtest-Screenshot (Hongkong,
  Victoria Park Road) läuft die rote Linie am HQ vorbei und wieder zurück.
  Kandidat ist `extendPathToOptimalTurnoff` an einer zweibahnigen Straße.
