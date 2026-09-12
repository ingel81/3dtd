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
| Gegner | `movement.component.ts:383-415`, `enemy.manager.ts:179` | Lineare Interpolation zwischen Waypoints, dazu ein fester seitlicher Versatz pro Gegner, zufällig bis `lateralOffset` (Zombie 3,0 m, `enemy-types.config.ts:124`). Höhe pro Frame aus der Zelle an der Gegnerposition (`global-route-grid.ts:1447`). Stand 2026-09-11, seit 2026-09-12 nach Korridorbreite, siehe unten |
| Zellen | `global-route-grid.ts:707`, `:759` | Alle höchstens 2 m ein Stützpunkt auf jedem Routensegment, darum ein Kreis mit `CORRIDOR_WIDTH = 7` m Radius (`:377`). Stand 2026-09-11, seit 2026-09-12 nach Korridorbreite, siehe unten |
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

## Korridor nach Straßenbreite (Umsetzung ab 2026-09-12)

Vorher war der Zellkorridor überall ein Kreis von 7 m Radius um die Route und
jeder Gegner lief mit festem Versatz bis `lateralOffset` (bis 3 m). Jetzt hat
jedes Routensegment eine eigene Halbbreite `H`, und Zellen und Gegner richten
sich danach.

**Randbedingung.** Jeder Gegner muss in einer Zelle stehen. Außerhalb der
Zellen fällt er aus `enemyCellKeys`, `getEnemiesForTower` findet ihn nicht
mehr. Ein schmalerer Korridor allein ändert an der Engstelle wenig, der Versatz
muss mit.

Nach dem Playtest vom 2026-09-12 ("an freien Stellen nicht breit genug")
bestimmt der gemessene Freiraum die Breite, und zwar pro Seite der
Fahrtrichtung. Die Straßenbreite aus OSM ist nur noch Rückfall für
Stationen, die sich nicht messen lassen.

**Datenfluss:**

| Schritt | Wo | Was |
|---|---|---|
| Breite pro Way | `utils/route-corridor.ts` (`estimateStreetWidth`) | `width`-Tag, sonst `lanes` × 3 m + 1 m, sonst Tabelle nach `highway` (`primary` 8 m, `secondary` 7 m, `tertiary` 6,5 m, `residential` 5,5 m, `living_street` 4,5 m, `service` 3,5 m, `footway`/`path`/`cycleway`/`steps` 2 m, ...). `H = clamp(Breite / 2, 2 m, 7 m)`. Quelle wird mitgeführt (`width`, `lanes`, `highway`). Gilt nur, wo die Tiles nicht messen, und als Obergrenze auf dem HQ-Endstück |
| Routenbau | `path-route.service.ts` (`buildRouteFromPath`), `utils/route-ways.ts` | Jedes Segment wird seinem Way zugeordnet (`StreetEdgeIndex`: exakter Kantenschlüssel, sonst geometrisch für den Abzweig zum HQ, geteilte Segmente und DevWorld). `corridorLeft`, `corridorRight` (Halbbreite links und rechts der Fahrtrichtung) und `onBridge` stehen am Waypoint und gelten für das Segment ab dort (`RouteWaypoint`). Das HQ-Endstück übernimmt die Breite des Ways, von dem es abzweigt. DevWorld gibt die gezeichnete Straßenbreite als `width` weiter (`primary` 8 m, `secondary` 7 m, `residential` 5 m) |
| Tile-Messung | `path-route.service.ts` (`measureStreetClearance`), `three-tiles-engine.ts`, `visualization-facade.service.ts` (`fitCorridorsToTiles`) | Einmal pro Ortsladung, nachdem die Overlay-Höhen stehen, und nur solange kein Tower steht und kein Gegner läuft; nie pro Frame. Alle 2 m je ein waagrechter Strahl nach links und nach rechts, 2 m über Grund (auf Brücken über dem Deck), jeder bis 7 m. Es zählen nur Tiles mit höchstens 5 m geometricError (die Verfeinerung des Korridors). Gespeichert wird der Freiraum je Station und Seite, NaN ohne feines Tile. Hat sich ein Korridor geändert, werden Routen, Grid und rote Linie neu gebaut. Gemessene Stationen bleiben gespeichert, ein weiterer Aufruf misst nur die ohne feines Tile nach. Log `[Corridor] clearance: segments= stations= unmeasured= rays= changed= in ms`. DevWorld misst nicht |
| Breite aus der Messung | `route-corridor.ts` (`fitCorridorPieces`), bei jedem Routenbau | Pro Seite: Halbbreite = gemessener Freiraum, begrenzt auf [2 m, 7 m], abgerundet auf 0,5 m. Die Messung verbreitert also auch. Stationen ohne Messung bekommen die Halbbreite aus OSM. Ausnahme HQ-Endstück (Segment ohne Way): dort darf die Messung nur unter die geerbte Breite gehen, denn es läuft oft durch Gebäude, und ein Strahl aus einem Gebäude heraus trifft keine Fassade (Rückseiten zählen beim Raycast nicht). Vorher geglättet, entlang der ganzen Route über Waypoints hinweg und je Seite: Einbrüche bis etwa 4 m (Laterne, Schild, Transporter, Baumstamm) werden geschlossen, Ausbuchtungen bis etwa 8 m (Einfahrt, Lücke zwischen zwei Häusern, schmale Einmündung) abgeschnitten; längere bleiben in voller Länge. Segmente werden geteilt, wo sich eine Seite ändert |
| Zellen | `global-route-grid.ts` (`generateFromRoutes`) | Eine Zelle gehört zum Korridor, wenn ihr Mittelpunkt höchstens `H` ihrer Seite vom Segment entfernt ist. Mittelpunkte liegen damit auf freier Fläche, quer liegen mindestens 2 Zellen |
| Gegner | `movement.component.ts`, `enemy.manager.ts` | Versatz = Faktor × lokale Grenze der Seite, auf der der Gegner läuft (Faktor < 0 links, > 0 rechts der Fahrtrichtung). Faktor = Zufall in [-1, 1] × `lateralSpread` des Typs (Anteil, ersetzt `lateralOffset` in Metern). Grenze = `H - 1,5 m`: die halbe Zelldiagonale ist 1,41 m, die Zelle unter dem Gegner hat ihren Mittelpunkt also sicher innerhalb `H`. Die Grenze ändert sich entlang der Route höchstens um 0,5 m pro Meter, Gegner rücken vor einer Engstelle sanft ein. Grenze pro Segment, Waypoint und Seite einmal pro Route vorberechnet, im Sub-Step Index, Seitenwahl und drei Vergleiche |
| Brücken | `global-route-grid.ts`, `route-cell-sampler.ts` | Segmente über einen Way mit `bridge=*` markieren ihre Zellen als Deck (`RouteCell.surface`), Deck-Zellen nehmen `topY` statt `groundY`. Beansprucht auch ein Segment ohne Brücke die Zelle, bleibt sie am Boden. Die Fläche steht fest, bevor die Zelle zum ersten Mal gesampelt wird |
| Diagnose | `__routes.describe()`, `__rg.dumpCellsInBox()`, `__corridor.towerCells()` | Pro Abschnitt `widthM` (Straßenbreite), `widthSource` (`width`, `lanes`, `highway`, `inherited` für das HQ-Endstück), `corridorM` (tatsächliche Korridorbreite links plus rechts, nach der Messung als Spanne wie `9.5-14.0`), `leftM` und `rightM` (Halbbreite je Seite). Pro Zelle `surface`. Zu Towern siehe Abschnitt "Lücken in der LOS-Anzeige" |

**Grenzen, im Spiel noch nicht geprüft:**

- Die Tile-Messung läuft einmal pro Ortsladung. Tiles, die danach feiner
  werden, ändern die Breite nicht mehr. Stationen ohne feines Tile behalten
  die OSM-Breite und stehen im Log als `unmeasured`. Ein zweiter Aufruf von
  `measureStreetClearance` würde genau diese Stationen nachmessen, im Spiel
  ruft ihn aber nichts ein zweites Mal auf.
- Ein Spawn-Wechsel über den schnellen Pfad (`LocationFacadeService`, ohne
  Neuladen des Orts) misst die neue Route nicht, sie läuft mit OSM-Breiten.
- Die Messung ist pro Seite. Liegt die OSM-Mittellinie neben der
  Straßenmitte der Photogrammetrie, bekommt die Seite mit mehr Platz den
  breiteren Korridor. Die Mittellinie selbst (rote Linie, Mitte der
  Gegnerverteilung) wird nicht verschoben.
- Kreuzungen: Die Strahlen an den Stationen vor und nach dem Knoten laufen
  in die Querstraße. Ist die Einmündung breiter als etwa 8 m, bleibt die
  Ausbuchtung stehen: Der Korridor wird dort auf dieser Seite bis 7 m
  breit, Gegner mit großem Versatz schwenken mit höchstens 0,5 m pro Meter
  hinein und wieder zurück. Das ist Freiraum, den es gibt; wer es ruhiger
  will, stellt die Ausbuchtungslänge höher (siehe Stellschrauben).
- Freiflächen: Ohne Fassade, Mauer, Hecke oder Baum innerhalb von 7 m
  (Platz, Park, Vorgärten mit Zaun unter 2 m) wird der Korridor auf dieser
  Seite 7 m breit. Zellen liegen dann auch auf Parkstreifen, Gehwegen und
  Vorgärten.
- Geparkte Autos sind niedriger als die Strahlhöhe und engen nicht ein.
  Liegt eine Zelle auf einem Auto, trifft die senkrechte Säulenprobe
  vermutlich dessen Dach, weil die Photogrammetrie unter dem Auto keinen
  Boden hat; die Zelle und Gegner auf ihr stehen dann gut 1,5 m höher. Ein
  breiterer Korridor enthält mehr solche Zellen. Im Spiel nicht geprüft,
  zählbar mit `__corridor.towerCells()` (`raised`).
- Mehr Zellen: Bei 5 bis 7 m pro Seite statt 2,75 m entstehen pro Meter
  Route etwa doppelt bis zweieinhalbmal so viele Zellen. Mehr Arbeit fällt
  an bei der Grid-Erzeugung (eine Säulenprobe je neuer Zelle), bei der
  Tower-Registrierung (eine Cube-Probe je Zelle in Reichweite), in
  `getEnemiesForTower` (läuft pro Tower und Sub-Step über die sichtbaren
  Zellen, auch leere) und in den Debug-Anzeigen. Zuordnung und Höhe der
  Gegner im Sub-Step kosten gleich viel. Nicht gemessen.
- Fast jede Ortsladung baut Routen und Grid jetzt ein zweites Mal
  (`fitCorridorsToTiles`), weil die Messung fast überall eine andere Breite
  als OSM ergibt. Vorher geschah das nur bei einer Verengung. Die Dauer
  steht nicht im Log und ist nicht gemessen.
- Brücken mit Tragwerk über dem Deck (Bogen, Fachwerk) oder mit Autos und
  Bäumen darauf: `topY` ist dann deren Oberkante.
- Kreuzen sich zwei Routen auf verschiedenen Ebenen, gilt in den gemeinsamen
  Zellen der Boden, die Gegner auf der Brücke sacken dort ab.

**Stellschrauben.** Alle Werte stehen in `corridorConfig`
(`utils/route-corridor.ts`), die Vorgaben in `CORRIDOR_DEFAULTS`. In
DevTools, ohne Neuladen:

```js
__corridor.get()                                        // alle Werte
__corridor.set({ maxHalfWidth: 8 })                     // ändern, Korridor wird neu gebaut
__corridor.set({ bulgeLength: 14, dipLength: 6 })       // mehrere auf einmal
__corridor.set({ highwayWidths: { residential: 7 } })   // einzelne Straßenklassen
__corridor.reset()                                      // zurück auf die Vorgaben
```

`set` und `reset` laufen nur, solange kein Tower steht, keine Welle läuft
und kein Gegner auf der Karte ist; sonst kommt `Not changed: ...` zurück.
Unbekannte Namen und Werte außerhalb des Bereichs werden abgelehnt, dann
ändert sich nichts. Sonst werden Routen, Zellen und rote Linie neu gebaut,
bei `stationSpacing`, `rayHeight`, `maxHalfWidth` und `maxTileError` wird
vorher neu gemessen (Log `[Corridor] clearance:`). Die Antwort nennt die
Zellzahl; die Breiten je Abschnitt zeigt `__routes.describe()`. Die Werte
gelten bis zum Neuladen der Seite. Übernehmen heißt `CORRIDOR_DEFAULTS` im
Code ändern.

| Name | Vorgabe | Bereich | Wirkung |
|---|---|---|---|
| `minHalfWidth` | 2 | 1,5 bis 15 | kleinste Halbbreite je Seite |
| `maxHalfWidth` | 7 | 1,5 bis 15 | größte Halbbreite je Seite, zugleich die Strahllänge (misst neu) |
| `defaultHalfWidth` | 4,5 | min bis max | Halbbreite, wo nichts bekannt ist (Pfade außerhalb des Routenbaus); rückt bei engerem Bereich mit |
| `edgeMargin` | 1,5 | 1,42 bis 5 | Abstand der Gegner zum Korridorrand. Unter der halben Zelldiagonale stünden Gegner am Rand außerhalb der Zellen |
| `taper` | 0,5 | 0,05 bis 5 | wie schnell sich der Seitenversatz entlang der Route ändern darf, m pro m |
| `stationSpacing` | 2 | 0,5 bis 10 | Abstand der Messstationen (misst neu) |
| `rayHeight` | 2 | 0,3 bis 10 | Höhe der Strahlen über Grund (misst neu). Tiefer: Autos und niedrige Hecken engen ein. Höher: nur Fassaden und hohe Kronen |
| `maxTileError` | 5 | 0,1 bis 100 | gröbstes Tile in m geometricError, das für die Strahlen zählt (misst neu) |
| `widthStep` | 0,5 | 0,1 bis 2 | Rundung der gemessenen Breite nach unten |
| `dipLength` | 4 | 0 bis 100 | Einbrüche bis etwa so lang werden geschlossen (Laterne, Transporter). Auf ganze Stationen je Seite aufgerundet |
| `bulgeLength` | 8 | 0 bis 100 | Ausbuchtungen bis etwa so lang werden abgeschnitten (Einfahrt, Hauslücke, schmale Einmündung). Höher: ruhigerer Rand, auch an Kreuzungen |
| `highwayWidths` | Tabelle oben | je bis 50 | Straßenbreite je `highway`-Klasse, nur für Stationen ohne Messung und das HQ-Endstück |
| `unknownHighwayWidth`, `laneWidth`, `laneExtra` | 5, 3, 1 | | Breite unbekannter Klassen, Spurbreite und Zuschlag bei `lanes` |

**Höhenmodell (zu Fall B).** Der direktere Hebel wäre, Zellhöhen gegen die
Mittellinie zu prüfen: Liegt eine Zelle deutlich über dem seitlichen Minimum
der Mittellinie, gilt dieses. Das wäre wieder ein Anker mit Toleranzband, den
`column-sample.ts` bewusst abgeschafft hat ("no anchor, no tolerance band, no
guessing"). Das ist eine Designentscheidung, keine Kleinigkeit. Nebenbei: Der
Kommentar an `RouteCell.routeAnchorY` (`global-route-grid.ts:65-70`)
beschreibt noch eine Verwerfung über `GROUND_ANCHOR_TOLERANCE_M`; die
Konstante gibt es nicht mehr.

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

**Diagnose im Spiel.** Tower auswählen, in DevTools
`__corridor.towerCells()` aufrufen (oder `__corridor.towerCells('<id>')`).
Die Tabelle:

| Feld | Bedeutung | Deutung |
|---|---|---|
| `cells` | Zellen mit Mittelpunkt in Reichweite | |
| `unsampled` | davon ohne Höhenprobe | > 0: diese fehlen in der Anzeige, Fall (e) |
| `groundVisible`, `groundBlocked`, `groundMissing` | Antworten des Towers für Bodenziele | `groundMissing` > 0: dort prüft das Targeting per CPU-Raycast |
| `airVisible`, `airBlocked`, `airMissing` | dasselbe für Luftziele | Bei reinen Boden-Towern ist `airMissing` gleich `cells` |
| `holes` | Stellen ohne Zelle, aber mit Zellen auf allen vier Seiten | > 0 widerspräche dem Test zu (a); Liste in `holeCells` |
| `raised` | Zellen mehr als 1 m über dem Median ihrer Nachbarn | > 0: Kandidaten für (d); Liste in `raisedCells` (x, z, Meter über den Nachbarn) |
| `displayed` | Platten der Anzeige | |
| `displayOutdated` | Platten, deren Zelle nicht mehr im Grid ist | > 0: Grid neu gebaut, Anzeige nicht |
| `notDisplayed` | Zellen mit Höhe in Reichweite, die der Anzeige fehlen | > 0: Anzeige ist ein alter Schnappschuss, Fall (e) |
| `cubeFromTower` | Cubemap zuletzt von diesem Tower gerendert | `false` bleibt nur, wenn die Anzeige die Cubemap nicht zurückholt |

Die Koordinaten aus `holeCells` und `raisedCells` lassen sich mit
`__rg.dumpCellsInBox({ xMin, xMax, zMin, zMax })` genauer ansehen.

## Backlog-Punkte aus "Terrain & Routing Experimente"

**OSM bridge/tunnel Tags abfragen.** Abfragen muss man nichts, `out body`
liefert sie. Seit Commit `62165c6` stehen `bridge`, `tunnel`, `covered` und
`layer` am `Street`, noch ohne Wirkung. Was damit zu tun wäre:

- Brücke (umgesetzt, siehe Korridor oben): `selectColumnSample` nimmt den
  untersten Treffer. Unter einer Brücke ist das der Grund darunter (Fluss,
  Straße), Zellen und Gegner einer Brückenroute liefen also unten. Zellen von
  Brückensegmenten nehmen jetzt `topY` statt `groundY`. Die im Backlog
  genannte Idee "bridge: Korrektur überspringen" hätte nicht geholfen: Schon
  die Probe in der Mitte liefert den Grund unter der Brücke.
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
| `1306460` | feat(route): estimate the corridor width per street |
| `a46c507` | feat(route): cached routes carry the corridor half width per segment |
| `daba76c` | feat(route-grid): the cell corridor follows the street width |
| `59e6db3` | feat(enemy): lateral offset follows the local corridor width |
| `147e4e3` | feat(route): narrow the corridor where the tiles show facades or trees |
| `b0a8424` | feat(route-grid): cells on a bridge take the deck, not the ground below |

## Offene Punkte

- Ort des Befunds unbekannt, mit `__routes.describe()` klären.
- Entscheidung zum Höhenmodell der Zellen (Anker gegen die Mittellinie oder nicht).
- Korridor und Versatz nach Straßenbreite: umgesetzt, im Spiel nicht geprüft
  (Grenzen im Abschnitt Korridor).
- Tunnel und Durchgänge: Zellen nehmen weiter die Oberfläche darüber.
- HQ-Endstück läuft gerade durch Gebäude, bis 150 m. Es hat jetzt die Breite
  der Straße, von der es abzweigt, und die Tile-Messung verengt es dort, wo
  Gebäude stehen.
- Beobachtet, nicht untersucht: Auf einem Playtest-Screenshot (Hongkong,
  Victoria Park Road) läuft die rote Linie am HQ vorbei und wieder zurück.
  Kandidat ist `extendPathToOptimalTurnoff` an einer zweibahnigen Straße.
