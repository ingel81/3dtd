# Routenkorridor

**Stand:** 2026-09-16

Wie breit der Korridor aus Route-Zellen links und rechts der Mittellinie einer
Route ist, woher die Breite kommt, wann sie gemessen und neu gebaut wird und
wie man sie im Spiel prüft. Die Herleitung und die Playtest-Befunde stehen in
[ROUTE_GEOMETRY_ANALYSIS.md](archive/ROUTE_GEOMETRY_ANALYSIS.md) und
[REVIEW_SPRINT_2026-09-12.md](archive/REVIEW_SPRINT_2026-09-12.md).

Längen in Metern. "Links" und "rechts" meinen immer die Fahrtrichtung der
Route (vom Spawn zum HQ).

## Überblick

| Schritt | Code | Ergebnis |
|---|---|---|
| Straßenbreite je Segment | `utils/route-corridor.ts` (`estimateStreetWidth`, `routeHalfWidths`), Zuordnung Segment zu OSM-Way in `PathAndRouteService.buildRouteFromPath` | Halbbreite aus OSM, Rückfall für alles, was die Tiles nicht messen |
| Messung | `PathAndRouteService.beginClearanceMeasurement` und der Lauf `ClearanceRun` (`path-route.service.ts`), Strahlen in `TerrainQueries.measureStreetClearance` (`three-engine/terrain-queries.ts`, als `engine.terrain` erreichbar) | Freiraum je Station und Seite |
| Anpassung | `fitCorridorStations`, `fitCorridorPieces`, `closeShortNarrowings` (`route-corridor.ts`), `fitRoute`, `applyClearance` (`path-route.service.ts`) | Segmente geteilt, wo sich eine Seite ändert; Halbbreite links und rechts je Stück; kurze Engstellen geschlossen |
| Waypoints | `PathAndRouteService.buildRouteFromPath` | `corridorLeft`, `corridorRight`, `onBridge`, `inTunnel`, `offStreet` (Endstück zum HQ) am Waypoint, gültig für das Segment ab dort (`RouteWaypoint`, `models/game.types.ts`) |
| Unterführung | `utils/underpass.ts` (`UnderpassIndex`, `splitAtSpans`), `PathAndRouteService.buildRouteFromPath` | Stück unter einem Way, der die Route auf höherer Ebene kreuzt, als Tunnel |
| Zellen | `GlobalRouteGrid.generateFromRoutes` (`global-route-grid.ts`) | 2-m-Zellen im Korridor |
| Zellhöhe | `RouteCellSampler.sampleCellY` (`route-cell-sampler.ts`), `utils/carried-height.ts` | Boden, Brückendeck und die Strecke hinter seinem Ende, Endstück zum HQ, Tunnelsohle, Straße unter einer fremden Brücke |
| Band | `buildBand`, `bandPath` (`utils/corridor-band.ts`), `PathAndRouteService.buildBands`, Schritt 4 in `CorridorBuild.build` | Je Station das Rückgrat, das begehbare Band beiderseits und die Gegnerlinie darin; die Waypoints laufen in seiner Mitte, ihre Halbbreiten sind seine Kanten |
| Laufweg | `judgeWalk`, `cellWalkable` (`utils/corridor-walk.ts`) | Nur noch Diagnose für `__corridor.pick()`: warum eine Zelle im Band liegt oder daneben (Auto, Traufe, Hecke, Böschung) |
| Gegner | `MovementComponent.advance`, `place` (`movement.component.ts`), `getRouteProfile`, `sizeRouteCorners` (`route-corridor.ts`), `RouteCornerBuilder` (`route-corners.ts`), `ArcCheck` (`route-corner-check.ts`) | Seitenversatz innerhalb der Zellen, Bögen an Ecken |
| Auslöser | `CorridorBuild` (`services/world/corridor-build.ts`), den `VisualizationFacadeService` hält | Wann gemessen und neu gebaut wird |

## Einstellungen

Alle Werte stehen in `corridorConfig`, die Vorgaben in `CORRIDOR_DEFAULTS`
(`route-corridor.ts`), die erlaubten Bereiche in `SETTING_RANGES`
(ebenda). Routen und Grid lesen die Werte beim Bauen; eine Änderung wirkt
erst nach einem Neuaufbau (`__corridor.set()` baut neu, siehe unten).

| Name | Vorgabe | Bereich | Wirkung |
|---|---|---|---|
| `minHalfWidth` | 1 | 0 bis 15 | kleinste Halbbreite je Seite |
| `maxHalfWidth` | 7 | 1 bis 15 | größte Halbbreite je Seite, zugleich Länge der Strahlen |
| `defaultHalfWidth` | 4,5 | min bis max | Halbbreite, wo nichts bekannt ist (Pfade außerhalb des Routenbaus, Tests) |
| `edgeMargin` | 1,5 | 1,42 bis 5 | Abstand der Gegner zum Korridorrand |
| `taper` | 0,5 | 0,05 bis 5 | wie schnell sich der seitliche Spielraum entlang der Route ändern darf, m pro m |
| `stationSpacing` | 2 | 0,5 bis 10 | Abstand der Messstationen |
| `rayHeightLow`, `rayHeightHigh` | 1, 3,5 | 0,3 bis 10, 0,3 bis 20 | Höhe der beiden Strahlen über dem Boden der Station |
| `lowWallRise` | 0,3 | 0,1 bis 50 | stoppt nur der untere Strahl, ist sein Treffer eine Wand, wo der Boden 1 m dahinter mindestens so weit über der Station liegt (niedriges Hindernis, siehe Messung); 50 schaltet es ab |
| `wallMargin` | 0,5 | 0 bis 5 | Abstand zu einer gefundenen Wand |
| `overhangDepth` | 1 | 0 bis 5 | bis zu so weit vorkragende Obergeschosse begrenzen den Korridor mit ihrer Außenkante, 0 aus |
| `maxTileError` | 5 | 0,1 bis 100 | gröbstes Tile (geometricError), das für die Messung zählt |
| `widthStep` | 0,5 | 0,1 bis 2 | Rundung der gemessenen Breite nach unten |
| `dipLength` | 4 | 0 bis 100 | Einbrüche bis etwa so lang werden geschlossen, außer an einem niedrigen Hindernis (Auto, Transporter) |
| `bulgeLength` | 8 | 0 bis 100 | Ausbuchtungen bis etwa so lang werden abgeschnitten |
| `roofRise` | 2,5 | 0,5 bis 50 | Dach-Check: so weit über dem Rückgrat der Station ist eine Zelle nicht begehbar (siehe Band) |
| `stepRise` | 0,5 | 0,1 bis 50 | Stufen-Check: höchste Stufe je Rasterschritt (2 m) auf dem Weg vom Rückgrat nach außen (siehe Band; bis 2026-09-14 0,75) |
| `stepDrop` | 0,5 | 0,1 bis 50 | Abfall-Check: tiefster Abfall je Rasterschritt auf demselben Weg (siehe Band; bis 2026-09-15 ohne Grenze); 50 schaltet ihn praktisch ab |
| `highwayWidths` | Tabelle unten | je bis 50 | Straßenbreite je `highway`-Klasse |
| `unknownHighwayWidth`, `laneWidth`, `laneExtra` | 5, 3, 1 | 1 bis 50, 1 bis 10, 0 bis 10 | Breite unbekannter Klassen, Spurbreite, Zuschlag bei `lanes` |

`MEASUREMENT_KEYS` (`route-corridor.ts`) sind die Werte, deren Änderung
eine neue Messung braucht: `stationSpacing`, `rayHeightLow`, `rayHeightHigh`,
`maxHalfWidth`, `maxTileError`, `overhangDepth` und `lowWallRise` (der
gespeicherte Freiraum entsteht beim Messen aus den Treffern), `roofRise`, `stepRise` und `stepDrop` (die
das Band entsteht beim Bauen aus den Säulen, siehe Band).
Die übrigen formen nur das Gemessene um.

## Breite aus dem Freiraum, je Seite

### Messung

`PathAndRouteService.beginClearanceMeasurement` (`path-route.service.ts`)
geht jedes Segment jeder Route durch und legt einen Lauf an (`ClearanceRun`). Ein Segment der Länge `L` bekommt
`n = max(1, round(L / stationSpacing))` Stationen, Station `k` steht bei
`(k + 0,5) / n` des Segments. Segmente, die mehrere Routen teilen, werden
einmal gemessen.

Je Station (`TerrainQueries.measureStreetClearance`):

1. Eine Säulenprobe unter der Station. Findet sie gar kein Tile, steht die
   Station womöglich auf einer Naht zwischen zwei Tile-Meshes; dann versucht
   sie die Säulen 0,5 m voraus und 0,5 m zurück entlang der Route
   (`SEAM_SHIFTS_M`, `terrain-queries.ts`) und misst von der ersten, die ein
   Tile findet. Das kostet höchstens zwei weitere Säulen, nur für solche
   Stationen; `__corridor.pick()` zeigt die Verschiebung als `shiftM`. Ohne
   Tile auch dort ist die Station `unmeasured: 'no tile'`, mit einem Tile
   gröber als `maxTileError` ist sie `unmeasured: 'coarse tile'`.

   Jede Säule einer Station (unter ihr, neben einer Naht, am und hinter
   einem Brückenende, hinter einem niedrigen Treffer) ist ein eigener Strahl
   am genauen Punkt, am Säulen-Cache vorbei: Sie liest ihn nicht und
   schreibt nichts hinein. Die Seitenstrahlen starten in der Höhe dieser
   Säule, und die Säule der Feldmitte (siehe Zellhöhe) läge bis 0,35 m
   daneben, etwa auf dem Bordstein oder einem Auto. Eine Station kostet so
   bei jeder Messung ihre Säulen neu. Mehr Strahlen als mit Cache sind das
   nur, wo sie eine Säule vorher aus dem Cache bekam, etwa die Säule eines
   Brückenendes für jede Station dahinter; nicht gemessen. Die Säulen
   entlang einer Strecke hinter einem Brückenende oder eines Endstücks zum
   HQ (`carriedY`) gehen die Stationen einer Scheibe (siehe "In Scheiben")
   gemeinsam einmal ab (`walked`, seit 2026-09-16): Ohne das ginge jede
   Station eines Endstücks von 150 m (`MAX_HQ_STREET_DISTANCE`) es von
   seinem Anfang neu ab, zusammen 2850 Strahlen statt höchstens 75 je Scheibe.
   Innerhalb einer Scheibe ändert sich kein Tile, die Höhen sind dieselben.
2. Je Strahlhöhe ein waagrechter Strahl nach links und einer nach rechts, in
   1 m und 3,5 m über der Fläche, auf der die Zellen dort stehen (`surfaceY`,
   siehe Zellhöhe), jeder `maxHalfWidth` lang. Das ist der Boden der Säule,
   auf einer Brücke ihre Oberkante `topY`. Auf der Strecke hinter einem
   Brückenende und auf dem Endstück zum HQ (`approach`) ist es der Treffer,
   der der Höhe am nächsten liegt, die die Route vom nächsten Brückenende
   oder von der Straße bis zur Station trägt, unter einem Treffer weit
   darüber diese Höhe selbst (`carriedY`, `approachY`, siehe Zellhöhe);
   dafür nimmt die Station die Säulen am Anfang der Strecke und entlang der
   Route bis zu ihr dazu, bei einer Naht mit denselben Verschiebungen. Hat
   die Säule am Anfang kein Tile bis `maxTileError`, ist die Station
   `unmeasured: 'no approach start'` (bis 2026-09-16 `'no bridge end'`) und
   kommt beim nächsten Lauf wieder dran. Teilen sich Routen ein Segment, liegt
   eine Station nur dann auf der Strecke, wenn jede von ihnen sie dort hat, wie bei den
   Zellen (die tiefere Fläche gewinnt, `stationApproach`). Bis 2026-09-15
   gingen die Strahlen dort vom untersten
   Treffer aus, am Brückenkopf also unter dem Deck (review-f M2).
3. Ein Treffer zählt nur auf einem Tile mit höchstens `maxTileError`
   geometricError und nicht auf dem Wurzel-Tile (`TerrainQueries.clearanceRay`). Ohne Treffer
   meldet der Strahl seine volle Länge.
4. Stoppt auf einer Seite nur der untere Strahl (der obere trifft nichts
   oder mindestens 1 m weiter, `lowRayAlone`), eine Säule 1 m hinter seinem
   Treffer (`LOW_WALL_BEHIND_M`, `riseBehindLowHit` in
   `terrain-queries.ts`): wie hoch ihr Boden über dem Boden der Station
   liegt (`StationProbe.lowRise`). Ihren Boden nimmt sie nach derselben
   Regel wie die Station (`surfaceY`): den untersten Treffer, auf der
   Strecke hinter einem Brückenende (`approach`, siehe Zellhöhe) den
   Treffer, der der getragenen Höhe am nächsten liegt. Nicht auf einem
   Brückendeck, dort träfe diese Säule den Fluss, den Kai oder die Straße
   unter dem Deck (`onDeck` in `measureStreetClearance`). Bis 2026-09-15
   fehlte die Prüfung auch auf der Strecke hinter einem Brückenende. Am
   Pont d'Iéna (Place de Varsovie, Pick A) lag eine Station hinter dem
   Ende der damaligen Strecke und nahm den Hohlraum unter der Straße als
   Boden; ihr unterer Strahl traf nach 1,4 m etwas, die Säule dahinter lag
   1 m über diesem Boden, und die Seite bekam eine niedrige Wand mit 1 m
   Halbbreite.

Der Freiraum einer Seite ist der weitere der beiden ersten Treffer
(`probeFreeSpace`, `route-corridor.ts`). Eine Wand ist also, was beide
Strahlen stoppt: Fassade, Mauer, Stamm. Eine Baumkrone, Traufe oder ein
Balkon stoppt nur den oberen und engt den Korridor nicht ein.

Ausnahme **niedriges Hindernis** (Nutzerentscheidung nach dem Playtest
2026-09-14, Vorgärten, Option a): Stoppt nur der untere Strahl und liegt die
Säule 1 m hinter seinem Treffer mindestens `lowWallRise` (0,3 m) über dem
Boden der Station, ist der untere Treffer eine Wand (`probeLowWall`). Unter
einem Auto hat die Photogrammetrie keinen Boden, die Säule trifft sein
Dach. So engen ein parkendes Auto, ein Transporter, eine Hecke und ein
Vorgarten höher als der Gehweg den Korridor ein, beim Vorgarten, wenn etwas
darauf den unteren Strahl stoppt (Hecke, Zaun, Bewuchs). Ein Zaun, Poller
oder Schildmast vor Boden auf Gehweghöhe nicht: 1 m dahinter liegt der
Boden.

**Hohles Auto** (seit 2026-09-15): Macht die Photogrammetrie ein Auto
hohl, trifft die Säule dahinter sein Dach und die Straße unter ihm. Liegt
ihr oberster Treffer mehr als `stepRise` und höchstens `roofRise` über dem
Boden, den sie nach `surfaceY` nimmt, zählt dieser Treffer (`lowObjectTop`,
`route-corridor.ts`). Anlass: Playtest 727, Rothenburg, Galgengasse, ein
rotes Auto etwa 4 m neben der roten Linie: Dach 1,48 und 2 m über der
Straße darunter, `lowRiseM` 0,1, keine Wand, Halbbreite 7 m. Ein Vordach,
eine Traufe oder Krone höher als `roofRise` über dem Boden dahinter zählt
nicht. Die Säule kennt nur ihren untersten und obersten Treffer: Ein Auto
unter einer höheren Krone bleibt unsichtbar.

- **0,3 m:** über einem Bordstein (10 bis 15 cm) samt Quergefälle der
  Fahrbahn, unter einem Hochbeet von 0,4 m und unter den 0,58 m, die Zellen
  auf einem parkenden Auto in Rothenburg über ihren Nachbarn lagen
  (Playtest 2026-09-14, `pick()` an Station `11:6/19`). Das Rauschen der
  Tiles in der Höhe ist nicht gemessen.
- **1 m:** tiefer als ein Poller, Mast, Mülleimer oder Zaun, schmaler als
  ein Auto (1,7 bis 1,9 m). Ein Stamm stoppt beide Strahlen etwa an
  derselben Stelle; er bleibt eine Wand beider Strahlen, die das Schließen
  der Einbrüche wegnimmt.
- **Kosten:** eine Säule mehr je Seite, auf der nur der untere Strahl
  stoppt, aus dem Cache der Engine, wo eine Zelle sie schon geprobt hat.
  Nicht im Spiel gemessen.

Vorher zählte ein Treffer nur des unteren Strahls nie; der Playtest vom
2026-09-12 hatte das Einengen an einer Transporterreihe verworfen
(`8910463`), der Nutzer will es seit dem 2026-09-14. `__corridor.pick()`
zeigt die Höhe als `lowRiseM` und die Regel als `low obstacle, raised
behind`. Abschaltbar mit `__corridor.set({ lowWallRise: 50 })` (misst neu).

Ausnahme **Auskragung**: Treffen beide Strahlen und stoppt der obere
höchstens `overhangDepth` (1 m) näher als der untere, gilt der nähere
Treffer, die Außenkante. So kragen die Obergeschosse eines Fachwerkhauses
über das Erdgeschoss vor, ein Erker ebenso. Mit dem weiteren Treffer lagen
die Randzellen unter dem Obergeschoss, ihre Säule traf dessen Dach oder
Unterseite, der Dach-Check setzte sie orange auf den Boden (Playtest
2026-09-14, Rothenburg, Zellen "unter dem Dach"). Ein Balkon oder eine
Krone weiter als 1 m vor der Fassade lassen es beim weiteren Treffer. Ein
Auto vor der Fassade (unterer Strahl näher) fällt nicht unter diese
Ausnahme; steht es mindestens 1 m davor, ist es ein niedriges Hindernis
(oben), sonst gilt die Fassade. `__corridor.pick()` nennt die
Ausnahme mit `overhang: outer face` in `rule`. Eine Urteilsfrage, abschaltbar
mit `__corridor.set({ overhangDepth: 0 })` (misst neu).

Gespeichert wird der Freiraum je Segment, Station und Seite in
`clearanceBySegment` (`PathAndRouteService`), NaN für ungemessene
Stationen, dazu die Rohwerte je Station für `__corridor.pick()`. Der Lauf hält
seine Ergebnisse bei sich und übergibt sie erst an seinem Ende
(`storeClearance`); bis dahin baut jede Route mit dem Korridor von
vorher. Ein weiterer Lauf misst nur die NaN-Stationen nach (`beginClearanceMeasurement`). Tunnel-
und Durchgangssegmente und Stücke unter einer fremden Brücke (siehe Zellhöhe) werden übersprungen
(ebenda).

### Glättung und Halbbreite

`fitCorridorStations` (`route-corridor.ts`) arbeitet je Seite über die
ganze Route, über Waypoints hinweg:

0. **Kurze Messlücken füllen** (`fillShortGaps`): Eine Folge ungemessener
   Stationen bis etwa `dipLength` lang (bei den Vorgaben eine oder zwei
   Stationen) bekommt den kleineren Freiraum der gemessenen Stationen davor
   und danach, am Routenende den der einen. So engt eine Station auf einer
   Naht zwischen zwei Tile-Meshes, deren Säule kein Tile findet, den
   Korridor nicht für 2 m auf die Straßenbreite ein (Playtest 2026-09-13,
   Station `7:3/32`). Längere Lücken behalten die Straßenbreite.
1. **Einbrüche schließen** (`closeShortDips`, morphologisches Closing): Ein
   schmalerer Abschnitt bis etwa `dipLength` (Laterne, Schild, einzelner
   Stamm) verschwindet, ein längerer bleibt in voller Länge. Ein niedriges
   Hindernis (siehe Messung) bleibt auch kürzer: Ein Auto von 4,5 m liegt
   vor zwei oder drei Stationen, ein kleineres vor einer, und nach der Länge
   allein wäre es von einer Laterne nicht zu trennen. Die Laterne stoppt
   beide Strahlen, das Auto nur den unteren, mit seinem Dach dahinter.
2. **Ausbuchtungen abschneiden** (`cutShortBulges`, Opening): Ein breiterer
   Abschnitt bis etwa `bulgeLength` (Einfahrt, Lücke zwischen zwei Häusern
   oder zwei parkenden Autos, schmale Einmündung) verschwindet.

   Beide Filter runden die Länge auf ganze Stationen je Seite auf
   (`ceil(Länge / stationSpacing / 2)`). Ungemessene Stationen bleiben
   unbekannt und zählen nicht für ihre Nachbarn.
3. **Halbbreite:** Reicht der geglättete Freiraum bis `maxHalfWidth`, gilt
   `maxHalfWidth`. Sonst gilt Freiraum minus `wallMargin`, abgerundet auf
   `widthStep`. Danach mindestens `minHalfWidth`.
4. **Endstück zum HQ:** Auf einem Segment ohne OSM-Way darf die Messung die
   Breite nur unter die geerbte Straßenbreite drücken, nicht darüber. Das
   Endstück läuft oft durch Gebäude und Höfe, und ein Strahl, der in einem
   Gebäude beginnt, findet dort keine Wand.

Stationen ohne Messung in einer kurzen Lücke durchlaufen die Schritte 1 bis 4
mit dem Freiraum ihrer Nachbarn (`rule: 'unmeasured: from neighbours, ...'`),
die übrigen bekommen die Halbbreite der Straße
(`rule: 'unmeasured: street width'`).

`fitCorridorPieces` (`route-corridor.ts`) fasst Stationen mit gleicher
Halbbreite links und rechts zu einem Stück zusammen. Solange noch gar nichts
gemessen ist, ist jedes Segment ein Stück mit der Straßenbreite auf beiden
Seiten.

**Kurze Engstellen schließen** (`closeShortNarrowings`, aufgerufen in
`PathAndRouteService.fitRoute`): Ein Stück oder eine Folge von Stücken, auf
einer Seite schmaler als das Stück davor und danach und zusammen höchstens
etwa `dipLength` lang, bekommt die schmalere der beiden Nachbarbreiten. Das
ist das Schließen der Einbrüche aus Schritt 1 noch einmal, über die fertigen
Stücke, egal welche Regel ihre Breite gesetzt hat: etwa die Straßenbreite
eines kurzen Segments, das noch nicht gemessen ist, oder eines kurzen
Fußweg-Stücks zwischen zwei Straßen. Längere Engstellen, eine Engstelle am
Anfang oder Ende der Route und Tunnel bleiben. Ein Stück an einem
niedrigen Hindernis wird nicht breiter als dort gemessen (`maxLeft`,
`maxRight`). `__corridor.pick()` nennt es mit `short narrowing closed` in
`rule`. Das alles ist die Wand, die die Strahlen sehen; wie weit der
Korridor tatsächlich reicht, entscheidet das Band darin (siehe Band).

`applyClearance` (`path-route.service.ts`) teilt jedes Segment an den
Stückgrenzen; jedes Stück wird ein eigener Waypoint mit `corridorLeft` und
`corridorRight`. Zellen und Seitenversatz der Gegner lesen beide diese
Waypoints, eine geschlossene Engstelle gilt also für beide.

## OSM-Breite als Rückfall und Deckel

`estimateStreetWidth` (`route-corridor.ts`): der `width`-Tag, sonst
`lanes` × `laneWidth` + `laneExtra` (3 m je Spur plus 1 m), sonst die Tabelle je
`highway`-Klasse, sonst `unknownHighwayWidth`. Die Halbbreite ist die halbe
Breite, geklemmt auf [`minHalfWidth`, `maxHalfWidth`] (`corridorHalfWidth`).

| Klasse | Breite |
|---|---|
| `motorway` (je Richtung) | 11 |
| `trunk` | 9 |
| `primary` | 8 |
| `secondary` | 7 |
| `tertiary` | 6,5 |
| `pedestrian` | 6 |
| `unclassified`, `residential`, `road` | 5,5 |
| `*_link` | 5 |
| `living_street` | 4,5 |
| `busway` | 4 |
| `service` | 3,5 |
| `track` | 3 |
| `cycleway`, `footway`, `path`, `bridleway`, `steps` | 2 |

Ein Segment ohne Way (das Endstück zum HQ) übernimmt die Breite des Ways davor,
ein Segment ohne Way davor `defaultHalfWidth` (`routeHalfWidths`).

Die OSM-Breite gilt:

- an Stationen ohne Messung (kein oder zu grobes Tile),
- in Tunneln, Durchgängen und unter einer fremden Brücke,
- als Obergrenze auf dem Endstück zum HQ,
- in DevWorld. Dort liefert `TerrainQueries.measureStreetClearance` keine Probe (`sources.devTerrain()`), und die
  Straßen werden in der Breite gezeichnet, die der Korridor ohnehin nimmt
  (siehe [DEVWORLD.md](DEVWORLD.md)).

## Zellen und Engstellen

Die Route-Zellen sind 2 m groß (`GlobalRouteGrid.CELL_SIZE`).
`claimSegmentCells` (`route-grid-builder.ts`) nimmt eine Zelle in den
Korridor auf, wenn

- ihr Mittelpunkt höchstens die Halbbreite ihrer Seite vom Segment entfernt
  liegt, oder
- das Segment ihr Quadrat berührt (`segmentTouchesCell`, Liang-Barsky).

Die zweite Regel sorgt dafür, dass die Zellen, durch die die Mittellinie läuft,
bei jeder Breite dazugehören. Eine Engstelle schmaler als eine Zelle bleibt so
eine Zellreihe, auf einer Diagonale eine Treppe.

**Enden der Segmente** (`jointCap`, `claimRouteCells`): Hinter dem Anfang
und dem Ende eines Segments gilt der Abstand zum Endpunkt, das Segment hat
also runde Enden. An einem Waypoint zwischen zwei Segmenten ist der Radius
je Seite höchstens die seitliche Grenze des schmaleren der beiden
(`lateralLimit`) plus eine halbe Zelldiagonale mal `hypot(1, taper)`: So
weit reichen Zellen, in denen Gegner an dieser Stelle stehen können (siehe
"Seitenversatz der Gegner"). Weiter hinaus gehören die Zellen dem anderen
Segment. Die beiden Enden der Route behalten ihre volle Halbbreite.
Vorher hatte jedes Ende die volle Halbbreite seines Segments. Wo der
Korridor schmaler wird (Vorgarten endet am Haus, Parkbucht an einer
Fassade, Kreuzung an einer Gasse), griff das breitere Stück so rund um sein
Ende bis zu seiner Halbbreite weit in das schmalere hinein: Zellen im Haus,
die der Dach-Check dann orange auf den Boden setzte (Playtest 2026-09-14,
Rothenburg). Gegner standen dort nie, ihre Grenze am Waypoint ist die
kleinere.

Zellen werden erst gesampelt, wenn alle Segmente ihre Zellen beansprucht haben
(`GlobalRouteGrid.generateFromRoutes`), weil die Fläche einer Zelle von allen Segmenten abhängt, die sie
erreichen.

## Zellhöhe

Die Höhe einer Zelle kommt aus der Säulenprobe an ihrem Mittelpunkt: der
unterste Treffer der feinsten LOD (`column-sample.ts`).

**Eine Säule je 0,5-m-Feld** (`columnCentre`, `terrain-queries.ts`): Der
Säulen-Cache hält eine Säule je 0,5-m-Feld, und ihr Strahl steht in der
Mitte des Felds, nicht an dem Punkt, der fragt. Zellen und Band proben auf
ganzen und halben Metern, also genau dort; ein Knoten des Straßen-Overlays
oder ein Tower liest die Säule bis 0,35 m neben sich. Die Stationen gehen
am Cache vorbei und messen am genauen Punkt (siehe Messung). Bis
2026-09-16 stand der Strahl am ersten Punkt, der fragte, und jeder weitere
Punkt des Felds bekam dessen Höhe. Die Zellen eines Baus hingen damit davon
ab, was vorher gesampelt hatte: bei einer frischen Ladung die Stationen,
bei `__corridor.reset()` (gespeicherte Messungen, `stations=0`) nichts. So
ergab Tokyo in einer Sitzung drei Korridore mit gleichen `stations`, `cells`
und `tiles` und anderen `band` und `heights` (PLAYTEST 745). Nachgestellt in
`integration/corridor-column-order.spec.ts` auf dem Strahlweg der Bibliothek
(`test/library-tiles-fixture.ts`).

- **Naht zwischen zwei Tile-Meshes** (`RouteCellSampler.sampleCellY`,
  `CELL_PROBES_M`): Findet die Säule am Mittelpunkt kein Tile oder nur einen
  Treffer, den die Nachbarn ablehnen (unten), versucht die Zelle die Säulen
  0,5 m daneben in x und z und nimmt die erste, die einen annehmbaren
  Treffer gibt. Höchstens vier weitere Säulen, nur für solche Zellen. Die
  Säulen des Bands und die Portalproben eines Tunnels machen es
  ebenso. Ist an der Stelle noch kein Tile-Mesh dekodiert
  (`terrainPeekLOD`), bleibt die Zelle ohne Probe.
- **Ausreißer** (`plausible`): Ein Treffer mehr als 50 m (`OUTLIER_M`) vom
  Median der stabilen Nachbarn derselben Fläche entfernt zählt nicht. Für
  die erste Probe einer Zelle und für ein LOD-Upgrade zählen nur Nachbarn
  aus mindestens so tiefen Tiles, damit eine grobe Hülle ringsum ein
  feineres Sample nicht verhindert. Vorher lief der Test nur für stabile
  Zellen ohne Upgrade; im Playtest 2026-09-13 stand eine Zelle so auf
  -3542 m zwischen Zellen auf 243 m. Der Weg nach außen überspringt eine
  Zelle mehr als 50 m unter dem bisher erreichten Boden als Naht.
- **Lücken füllen** (`GlobalRouteGrid.fillGaps`, nach dem Erzeugen und nach
  einem Retry mit Promotion): Eine Zelle ohne
  annehmbares eigenes Sample, zwischen stabilen Zellen derselben Fläche auf
  gegenüberliegenden Seiten (west-ost, süd-nord, die zwei Diagonalen),
  bekommt den Mittelwert dieser Paare und den Zustand `filled`. Sie zählt
  als Zelle mit Höhe (`heightSampled`: LOS-Anzeige, Gegner, Overlay ohne
  rosa Kontur); der Rückfall für Zellen (`retryUnsampledCells`) versucht sie
  wie eine ungesampelte und ersetzt die Füllung durch das erste Sample, das
  er annimmt.
  - **Drei Nachbarn** (seit 2026-09-16): Ohne solches Paar nimmt eine
    Zelle, die mindestens drei stabile Zellen derselben Fläche berühren,
    deren Median (`medianOfStableNeighbourY`, derselbe wie im
    Ausreißer-Test) und ist ebenfalls `filled`. Das ist die Zelle am Rand
    des Korridors, deren Säulen nichts treffen, etwa ein Loch im Mesh am
    Fuß einer Fassade (ob die Tile-Materialien einseitig sind, sodass eine
    Säule unter einer Traufe nur deren Rückseite sähe, ist nicht geprüft).
    Hinter ihr liegt keine Zelle, also gibt es kein Paar. Anlass: Playtest 2026-09-16,
    Rothenburg, `build.fallback what=cells missing=7 found=0`: sieben rosa
    Zellen in einer Reihe am Rand des Bands vor dem Laubengang des
    Rathauses am Marktplatz (Way 1311003086, Screenshot 082242), die
    Rückfallstufe fand dort auch nichts. Ob ihre Säulen gar nichts trafen
    oder nur Treffer, die die Nachbarn ablehnten, sagt das Log nicht; das
    Band liest dieselben Säulen und endet vor einem Treffer weit über oder
    unter dem Boden, den es erreicht hat, also ist "gar nichts" das
    Wahrscheinlichere. Nachgestellt in `corridor-band.scenes.spec.ts`
    ("Marktplatz") auf der echten OSM-Linie mit den Gebäuden aus OSM.
  - Gefüllt wird nur aus stabilen Zellen, eine Füllung breitet sich also
    nicht aus. Eine Zelle, die weder zwischen zwei stabilen liegt noch drei
    berührt (eine Lücke breiter als eine Zelle, ihre Ecken), bleibt ohne
    Höhe; der Trace nennt sie (`build.freeze why=`, `at=`).
  - Eine stabile Zelle mehr als 50 m neben ihren Nachbarn aus mindestens so
    tiefen Tiles (ein Treffer, der vor ihnen kam) wird ebenso gefüllt oder,
    ohne beides, wieder `unsampled`.
  - Tunnelzellen bleiben, wie sie sind.

Ausnahmen:

- **Dach, Traufe, Krone, Auto, Hecke:** Die Zelle behält den untersten
  Treffer ihrer Säule, auch wo er auf deren Oberseite liegt, weil die
  Photogrammetrie darunter keinen Boden hat. Gegner laufen dort nicht: Das
  Band endet vor einer solchen Zelle (siehe Band). Auf einer Strecke, über
  die das Band nicht entscheidet, gilt das nur für den Boden; hinter einem
  Brückenende und auf dem Endstück zum HQ nimmt die Zelle statt eines
  Treffers weit über der getragenen Höhe diese Höhe (unten).
- **Auskragung oder Dachecke über der Linie:** Bis 2026-09-16 nahm eine
  Zelle, durch die eine Mittellinie läuft, statt eines Treffers mehr als
  `roofRise` über der Höhe der Mittellinie ringsum diese Höhe
  (`streetUnderRoof`). Die Regel ist weg, mit ihr `centreLineGround`: Die
  Gegnerlinie läuft jetzt in der Mitte des begehbaren Bands (siehe Band) und
  damit nicht mehr unter einer Auskragung durch. Füllt das Mesh die Gasse,
  ist das Stück ein Durchgang und seine Zellen sind Tunnelzellen; sonst
  liegt die Linie daneben, und die Zelle unter der Auskragung ist eine
  Randzelle, vor der das Band endet. In Rothenburg (Retest 560 bis 563) lag
  so eine Zelle unter einer Auskragung 5,7 m über der Straße (Pick C), eine
  an einer Dachecke 7,6 m (Pick B); beide weiß im Overlay, die Gegner
  stiegen hinauf.
- **Brückendeck:** Segmente über einen Way mit `bridge=*`
  (`PathAndRouteService.buildRouteFromPath`) tragen `onBridge`, ihre Zellen die Fläche
  `deck` und nehmen die Oberkante der Säule (`topY`) statt des Bodens
  (`RouteCellSampler.sampleCellY` über `surfaceY`). Wo Brücke und Zufahrt aneinanderstoßen,
  nimmt eine Zelle die Fläche des Segments, entlang dessen Länge sie liegt;
  das runde Ende des anderen ändert sie nicht (`claimSegmentCells`,
  `alongClaims`). Erreichen zwei Segmente eine Zelle beide entlang ihrer
  Länge (eine Straße unter der Brücke) oder beide nur mit dem runden Ende,
  gilt die tiefere Fläche: Boden vor Strecke hinter dem Brückenende vor Deck
  (`SURFACE_ORDER`); das Endstück zum HQ zählt vor dem Boden (`takesClaim`,
  siehe dort). Vorher gewann der Boden immer: Das runde Ende der
  Zufahrt (bei 7 m Halbbreite 7 m weit) machte die ersten Meter des Decks zu
  Bodenzellen, und die nahmen den untersten Treffer, den Kai oder Fluss
  unter dem Deck (Playtest 2026-09-14, Paris, siehe "Linie, Zellen und
  Gegner verschwinden").
- **Strecke hinter dem Brückenende** (`approach`, `utils/carried-height.ts`):
  Das Bauwerk einer Brücke reicht oft über das Ende ihres OSM-Brücken-Ways
  hinaus, die Ways dort tragen kein Brücken-Tag. Ein Segment, das an einem
  Ende einer Folge von Brückensegmenten weiterläuft, gehört bis
  `DECK_APPROACH_M` (60 m) entlang der Route zur Strecke, gleich wie die
  Route abbiegt, solange es weder Brücke noch Tunnel ist (`routeApproaches`).
  Seine Zellen tragen die Fläche `approach` und in `onApproach` die Route vom
  Brückenende bis zu ihnen (`path`, `m`, `start: 'bridge'`). Beginnt das
  Endstück zum HQ innerhalb dieser 60 m, gehört es ganz dazu.
  - **Getragene Höhe** (`carriedY`): Sie beginnt mit der Oberkante der
    Säule am Brückenende und folgt der Route alle `CARRY_STEP_M` (2 m). An
    jeder Stelle nimmt sie den Treffer der Säule dort, der ihr am nächsten
    liegt, wenn er höchstens `CARRY_STEP_RISE_M` (1,5 m) von ihr abweicht;
    sonst, und ohne Säule, bleibt sie. So geht sie eine Treppe hinunter
    (etwa 1,2 m je 2 m) und eine Rampe hinauf, fällt aber nicht durch eine
    Lücke im Mesh auf die Straße unter einem Platz und steigt nicht auf
    eine Krone oder ein Auto ohne Boden darunter.
  - **Höhe der Zelle** (`approachY`): der Treffer ihrer Säule, der der
    getragenen Höhe an ihrem Routenpunkt am nächsten liegt. Über einer
    tieferen Straße oder dem Kai ist das die Oberkante; eine Straße auf
    Deckhöhe liegt näher als Krone, Laterne, Statue oder Auto darüber; eine
    Treppe hinunter zum Kai behält ihre Stufen und der Kai unter einem Deck
    seinen Boden. Liegt dieser Treffer mehr als `CARRY_STEP_RISE_M` (1,5 m)
    über der getragenen Höhe, nimmt die Zelle die getragene Höhe selbst
    (seit 2026-09-16): Krone, Vordach, Schild oder Dach ohne Boden darunter
    sind kein Boden, und die getragene Höhe hat an ihrem eigenen Punkt einen
    solchen Treffer ebenso übergangen. Vorher stand die Zelle darauf, das
    gelbe Overlay erst ab `roofRise` (2,5 m) nicht mehr; beide nehmen jetzt
    dieselbe Regel. Ein Treffer weiter unten bleibt: Der offene Kai neben
    dem Deck ist Boden. Im Paris-Snapshot (`corridor-paris-cold-150811`)
    liegt keine der 409 Zellen der Strecke mehr als 1,5 m über dem Median
    ihrer Nachbarn der Strecke, dort ändert sich also voraussichtlich
    nichts (geprüft am Snapshot, nicht neu gebaut). Die LOD ist die gröbere der Säulen von Zelle und
    Brückenende, die Säulen dazwischen zählen nicht; ohne Säule am
    Brückenende wartet die Zelle wie ein Tunnel auf seine Portale. Eine
    Straße einer anderen Route unter dem Deck gewinnt als Boden (oben).
  - **Anlass:** Playtest 2026-09-14, Retest 564, Paris, Pont d'Iéna.
    `pick()` an einem Brückenkopf: Säulen mit Oberkante 79,8 bis 80,2 m
    (Deck) und Boden 71,4 bis 79,1 m, nächste Station auf Way 1423074549
    ohne `bridge`; weiße Zellen lagen an beiden Köpfen tiefer als das Deck,
    zum Teil im Kai. Die Regel danach (bis 2026-09-15): bis 40 m, höchstens
    45° je Knick, die Oberkante nur bis 1,5 m um die Oberkante am
    Brückenende. Retest 601 und 602: am Kopf auf der Eiffelturm-Seite gut;
    am Kopf an der Place de Varsovie lagen kurz davor weiße Zellen, rote
    Linie und Gegner unter der Oberfläche. Die Route kommt dort über Way
    25831373 (34 m), biegt an der Kreuzung um 35° auf die Avenue de New York
    (Way 531658370, 18 m) und um 90° auf Way 1322092758 (9 m) zum
    Brücken-Way 1322092757 (OSM-Daten über Overpass, 2026-09-15). Der Knick
    von 90° beendete die Strecke nach 9 m. Drei `pick()` 12 bis 27 m vor dem
    Brückenende: Zellen der Mittellinie mit `surface` `ground` lagen 1,2 bis
    3,4 m unter der Oberkante ihrer Säule, die Kamera sah sie nicht. Die
    Säule am Klick hatte im selben Tile (Tiefe 25) Oberkante 79,9 und Boden
    75,99 m (Pick A), 79,84 und 77,99 m (Pick C), an einer Stelle die Straße
    10 m tiefer (Pick B: 79,85 und 69,38 m); die Stellen daneben ohne Zelle
    hatten Boden gleich Oberkante bei 79,9 bis 80,0 m. Mit 60 m reicht die
    Strecke dort bis kurz vor die nächste Kreuzung (61 m). Auf der
    Eiffelturm-Seite erreicht die Route 44 m hinter dem Ende eine Kreuzung
    am Quai Jacques Chirac, unter der Unterführungen des Quais liegen; dort
    meldete der Retest nichts.
- **Endstück zum HQ** (`approach`, seit 2026-09-16): Das Segment vom Punkt
  der Route, der dem HQ am nächsten liegt, zum HQ läuft über keinen OSM-Way
  (`onStreet` false, am Waypoint `offStreet`) und oft in ein Gebäude. Die
  Photogrammetrie hat dort keinen Boden, der unterste Treffer einer Säule
  ist das Dach.
  - **Regel:** dieselbe wie hinter einem Brückenende (Entscheidung des
    Users). Das Endstück ist eine eigene Strecke (`routeApproaches`, Fläche
    `approach`, `start: 'street'`), vom Punkt, an dem es die Straße (oder
    einen Tunnel) verlässt, bis zum HQ, ohne Längengrenze. Die getragene
    Höhe beginnt dort mit dem untersten Treffer, nicht mit der Oberkante,
    und folgt der Route alle 2 m wie oben. Jede Zelle nimmt den Treffer
    ihrer Säule, der dieser Höhe an ihrem Routenpunkt am nächsten liegt,
    oder die Höhe selbst, wo er mehr als 1,5 m darüber liegt (`approachY`).
    Erreicht die Strecke eines Brückenendes den Anfang des Endstücks, trägt
    sie dessen Höhe über das ganze Endstück weiter.
  - **Wirkung:** Im Gebäude bleiben Zellen, rote Linie (sie liest am HQ die
    Zelle dort) und Gegner auf Straßenhöhe; die Gegner laufen ebenerdig
    hinein und verschwinden am Ende der Route. Hof, Garten, Rampe und
    Treppe bis 1,5 m je 2 m folgen dem Boden; ein HQ auf freier Fläche
    bleibt, wie es war. Eine Terrasse oder Stufe höher als 1,5 m je 2 m
    hängt die getragene Höhe ab: Die Zellen dahinter liegen auf der Höhe
    davor, im Hang oder in der Terrasse, wie im Gebäude. Ein Hof tiefer als
    die getragene Höhe nimmt seinen Boden (nur ein Treffer darüber wird
    ersetzt).
  - **Gleichstand:** Erreichen Straße und Endstück eine Zelle beide entlang
    ihrer Länge oder beide mit dem runden Ende, gewinnt das Endstück: Seine
    Höhe ist die des Bodens, außer unter einem Dach (`takesClaim` in
    `route-grid-builder.ts`). Erreichen zwei Strecken derselben Art eine
    Zelle so, etwa die Endstücke zweier Spawns, gilt die mit dem näheren
    Anfang, bei gleichem Abstand die mit dem kleineren x, dann z des
    Anfangs (`startsNearer`), unabhängig von der Reihenfolge der Routen.
    Eine Station auf einem Segment mehrerer Routen nimmt dieselbe Strecke
    (`stationApproach`).
  - **Wo es gilt:** Zellen (`RouteCellSampler.sampleCellY`), Stationen des
    Endstücks (`measureStreetClearance`, ihre Strahlen starten auf der
    getragenen Höhe), `__routes.describe()` (vergleicht auf dem Endstück mit
    der getragenen Höhe) und das Route Grid Overlay (blaue Kontur). Das
    gelbe Straßen-Overlay zeichnet das Endstück nicht, das Band entscheidet
    dort nichts (`fixed stretch`). Nicht in DevWorld: Seine Säulen sehen
    nur das Gelände, kein Gebäude, und das Gelände steigt dort weit steiler
    als eine Stufe (Preset `gentle`, Seed 42: in der Höhenkarte am HQ rund 190 %,
    auf dem Terrain-Mesh im Umkreis von 100 m bis rund 250 %); getragen liefe das
    Endstück in den Hang. `buildRouteFromPath` setzt `offStreet` dort nicht,
    das Endstück nimmt wie vorher den Boden.
  - **Anlass:** Playtest 2026-09-16, Audi NSU Neckarsulm
    (`?l=49.19489,9.22041`) und Erlenbach, BBH (`?l=49.17337,9.26851`):
    Zellen und rote Linie auf dem Hallendach unter dem HQ-Marker, am BBH die
    rote Linie schräg die Fassade hinauf; Gegner liefen ins Haus und kamen
    durchs Dach wieder heraus. In den Snapshots dazu
    (`corridor-neckarsulm-kernstadt-cold-231301`,
    `corridor-binswangen-cold-231425`) ist das Endstück 16 und 12 m lang,
    die Straße unter seiner letzten Station 198,94 und 227,33 m. Sechs
    Zellen des Endstücks lagen auf dem Hallendach (206,22 bis 207,58 m),
    acht auf dem Schuldach (235,59 bis 236,93 m). Auf den Säulen der
    Snapshots nachgerechnet (`integration/hq-leg.snapshots.spec.ts`,
    Ausschnitte in `integration/fixtures/hq-leg`): Sie liegen jetzt auf
    199,30 bis 199,53 m und 227,41 m, die Zellen der Straße davor
    unverändert. Nachgestellt in `global-route-grid.spec.ts` ("leg to the
    HQ": Halle, Hof mit Rampe und Terrasse, Platz mit Krone, Deck hinter
    einem Brückenende, kurzes Endstück, zwei Endstücke).
- **Tunnel und überdachte Durchgänge:** `runsUnderCover`
  (`route-corridor.ts`) gilt für `tunnel=*` außer `no` (also auch
  `building_passage`) und für `covered=yes`. Solche Segmente tragen `inTunnel`
  und werden nicht vermessen, es gilt die OSM-Breite. Ihre Zellen haben die
  Fläche `tunnel`.
  - **Höhe:** linear zwischen dem Boden an zwei Portalen, je 2 m vor den
    Mündungen des ganzen Tunnelstücks (`TUNNEL_PORTAL_OFFSET_M`,
    `tunnelSegments` in `route-grid-builder.ts`). Die Höhe hat die gröbere
    LOD der beiden Portale (`tunnelColumn`, `route-cell-sampler.ts`).
  - **Portal unter einem Dach** (seit 2026-09-15, seit 2026-09-16 am Band):
    Liegt der Boden der Säule an einem Portal mehr als `roofRise` über der
    Straße unter der Bandstation dort (`street`, siehe Band), nimmt das
    Portal diese Höhe (`portalGround` in `corridor-walk.ts`). Nicht das
    Rückgrat dieser Station: An einem Torturm reicht das Mesh über die
    Mündung hinaus, die Station 2 m davor ist dann selbst ein Durchgang
    (ohne Rückgrat) oder hat ihr Rückgrat auf dem Turm, und beides ließ das
    Portal auf dem Dach stehen (Playtest 2026-09-16, Rothenburg, Weißer
    Turm: alle Zellen des Durchgangs stiegen den Turm hinauf, die rote Linie
    mit ihnen). Anlass: Playtest
    2026-09-15 (Retest 607, Rothenburg), Torbogen: Die gelben Zellen
    stiegen im Durchgang an, die Gegner kamen auf der anderen Seite aus
    der Hauswand. 2 m vor einer Mündung kann die Säule auf der Auskragung
    des Hauses landen, durch das der Durchgang führt, oder auf dem Haus
    selbst, wo der OSM-Way vor der Öffnung endet; ihr unterster Treffer
    ist dann das Obergeschoss, und alle Zellen des Durchgangs lagen auf
    der Geraden dorthin (nachgestellt in `global-route-grid.spec.ts`,
    "takes a portal under a jetty from the street around it"). Das Rückgrat
    steht auf der Straße vor der Mündung; ohne Band (erster Bau, DevWorld)
    behält das Portal seinen Treffer.
  - **Portal ohne Treffer** (seit 2026-09-16): Trifft die Säule an einem
    Portal nichts (ein Loch im Mesh an der Mündung), nimmt das Portal ebenso die Straße unter der Bandstation dort
    (`portalGround`). Die Zellen des Stücks sind dann `filled`, nicht
    `stable`: Die Höhe ist die des Bands, nicht die einer Säule, und die
    Rückfallstufe ersetzt sie, wo das Portal dort eine Säule hat. Vorher
    blieb das ganze Stück ohne Höhe, bis die Rückfallstufe zufällig einen
    Treffer hatte. Ohne Band (DevWorld) oder ohne Straße dort bleibt die
    Zelle ohne Höhenprobe (`why=noPortal`).
  - **Geteilte Zellen:** Erreicht ein Tunnelsegment eine Zelle, ist sie
    Tunnelzelle, auch wenn ein anderes Segment sie ebenfalls erreicht
    (`claimSegmentCells`).
  - **Stützen** (seit 2026-09-15): Zwischen den Mündungen trägt eine Säule
    die Gerade, die unter etwas mehr als `roofRise` über ihrem untersten
    Treffer (Deck, Dach, Hügel) die Straße zeigt: ihr unterster Treffer
    liegt höchstens `stepRise` über der Geraden zwischen den Portalen und
    höchstens `roofRise` darunter. Die Zelle nimmt die Gerade durch die
    nächste solche Säule davor und danach (`supportedY`,
    `route-cell-sampler.ts`). Geprobt wird alle 2 m auf der Geraden von
    Portal zu Portal, nur auf Stücken bis 100 m; das LOD dieser Säulen
    zählt für die Zelle nicht. Ein Auto unter dem Deck (kein Boden unter
    seinem Dach) liegt über der Geraden und zählt nicht, eine Säule mit nur
    einer Fläche (Hügel, Auskragung) auch nicht, der Boden zwischen Portal
    und Mündung ebenso wenig: Für ihn steht das Portal. Anlass: D2, siehe
    unten.
  - Kein Band: Das Stück behält die OSM-Linie und die OSM-Breite.
- **Unter einer fremden Brücke** (`utils/underpass.ts`, seit 2026-09-15):
  Kreuzt ein Way die Route auf höherer Ebene, gilt das Stück darunter als
  Tunnel. `UnderpassIndex.spans` sucht je Segment der Route, das weder
  Brücke noch Tunnel ist, die Ways, die es in 2D kreuzen, nicht an einem
  gemeinsamen Knoten (Einmündung) und nicht der eigene Way. Höher heißt:
  `layer`, sonst 1 für einen Way mit `bridge=*`, sonst 0 (`wayLevel`), im
  Vergleich mit dem Way der Route (das Endstück zum HQ ohne Way: 0). So
  zählt auch eine Straße mit `layer=-1` ohne Tunnel-Tag unter einer
  gewöhnlichen Straße.
  - **Länge:** je Seite der Kreuzung die halbe OSM-Breite des Ways darüber
    (`estimateStreetWidth`) plus `DECK_EDGE_MARGIN_M` (4 m), geteilt durch
    den Sinus des Kreuzungswinkels, zusammen höchstens `UNDERPASS_MAX_M`
    (80 m). Stücke bis `UNDERPASS_JOIN_M` (10 m) auseinander werden eins
    (zwei Richtungsfahrbahnen), dann auf die Route gekürzt. Die 4 m: Eine
    Fahrbahn mit 3 Spuren ist nach `lanes` 10 m breit, das Bauwerk mit
    Standstreifen und Kappen etwa 16 m (geschätzt, nicht gemessen).
  - **Schnitt:** `splitAtSpans` teilt die Route an Anfang und Ende des
    Stücks (ein Schnitt näher als 1 m an einem Punkt der Route entfällt,
    dann entscheidet die Mitte); das Stück dazwischen trägt `inTunnel`.
    Damit gilt alles vom Tunnel: Portale 2 m vor den Mündungen, Höhe
    zwischen ihnen mit Stützen, Fläche `tunnel` (gelb im Overlay), keine
    Messung, OSM-Breite, kein Band, `closeShortNarrowings` lässt
    das Stück schmal, und die Strecke hinter einem Brückenende endet
    davor. Die rote Linie nimmt ihre Höhe an den Waypoints aus diesen
    Zellen, die Gegner aus der Zelle, in der sie stehen. Liegt ein Portal
    trotzdem auf dem Deck, greift "Portal unter einem Dach" oben, solange
    die Mittellinie hinter ihm auf der Straße liegt.
  - **Anlass (D2, Playtest 2026-09-15, Erlenbach):** Weinsberger Straße
    (Way 230161781, `secondary`, `lanes=2`, ohne `layer`) unter den beiden
    Fahrbahnen der A6 (Ways 15258911 und 15258913, `motorway`,
    `bridge=yes layer=1 lanes=3`; OSM-Daten über Overpass, 2026-09-15). Sie
    kreuzen die Straße unter 85°, 16 m auseinander; das gibt ein Stück von
    34 m (24,6 bis 58,7 m entlang des Ways ab seinem nördlichen Knoten).
    `pick()` unter der Brücke vorher: Zellen auf 220,6 bis 220,8 m (Deck),
    die Säule am Klick mit einem einzigen Treffer (220,67 m), zwei Säulen
    daneben mit der Straße bei 214,72 und 215,05 m unter dem Deck
    (Oberkante 220,6 und 220,7 m). Unter dem Deck ist das Mesh also
    größtenteils bis zum Boden gefüllt (Fall c im Befund Erlenbach unten).
    Nachgestellt in `path-route.service.spec.ts` ("under a bridge of no
    route way") und `global-route-grid.spec.ts` ("under a deck").

## Laufweg: Zellen, zu denen kein Gegner laufen kann

Die Strahlen lassen den Korridor über eine Traufe oder Krone reichen, die
nur den oberen stoppt, und über ein Auto, einen Transporter oder eine
Hecke, deren Säule 1 m hinter dem Treffer sie nicht erhöht sahen (siehe
Messung, niedriges Hindernis). Die
Photogrammetrie hat unter keinem davon Boden, die Säule einer Zelle dort
trifft dessen Oberseite. Seit der Nutzerentscheidung nach dem Playtest
2026-09-14 ("Orange Zellen weglassen") endet der Korridor vor einer solchen
Zelle. Vorher blieb sie im Korridor und wurde auf den Boden daneben gesetzt
(orange Kontur, `clamped`): Gegner liefen dort durch das Auto oder standen
unter dem Dach.

Seit 2026-09-16 entscheidet das Band, welche Zellen der Korridor bekommt
(siehe Band): Der Weg nach außen läuft dort einmal je Station vom Rückgrat
aus, und der Korridor beansprucht genau die Zellen, die er erreicht. Was
hier steht, sind die Regeln dieses Wegs (`walkSide` in `corridor-band.ts`)
und die Diagnose danach.

**Diagnose** (`judgeWalk`, `cellWalkable`, `utils/corridor-walk.ts`): für
jede Zelle mit Fläche `ground` oder `approach` und einer eigenen Probe aus
einem Tile bis `maxTileError`. Bezug ist das Rückgrat der Bandstation neben
der Zelle: Liegt die Zelle zwischen den Bandkanten, ist sie im Korridor
(`band`); sonst nennt die Diagnose die Regel, an der der Weg dort endete
(`hollow`, `roof`, `step`, `drop`), oder `beyond the band`, wenn eine
andere Grenze davor lag (Wand der Strahlen, geschnittene Ausbuchtung,
Taper). Ohne Band (erster Bau, DevWorld, Brücke, Tunnel, Durchgang,
Endstück zum HQ) urteilt sie nicht. Bis 2026-09-16 war der Bezug der Median
der Mittellinien-Stellen ringsum (`centreLineGround`); mit der Gegnerlinie
in der Bandmitte gibt es die Sonderfälle nicht mehr, die er auffangen
musste (Linie auf einer Autoreihe, unter einer Auskragung, an einem
Brückenkopf über dem Kai).

- **Dach-Check:** Liegt die Zelle mehr als `roofRise` (2,5 m) über dem
  Rückgrat ihrer Station, ist sie nicht begehbar: Dach, Traufe, Krone.
- **Hohl-Check** (`hollow`, seit 2026-09-15): Trifft die Säule der Zelle
  mehr als `stepRise` und höchstens `roofRise` über dem Treffer, auf dem
  die Zelle steht, noch etwas (`lowObjectTop`), ist sie nicht begehbar: ein
  Auto oder Transporter, den die Photogrammetrie hohl gemacht hat, die
  Straße unter der Karosserie als unterster Treffer. Anlass: Playtest 727,
  Rothenburg, Galgengasse, ein rotes Auto etwa 4 m neben der roten Linie,
  Dach 1,48 und 2 m über der Straße darunter; die Zellen standen auf der
  Straße und waren begehbar. Höher (Traufe, Krone, Vordach) zählt der Boden
  darunter wie bisher. Die Säule kennt nur ihren untersten und obersten
  Treffer: Ein Busch oder eine Krone, deren Oberkante höchstens 2,5 m über
  dem Boden liegt, und ein Unterstand bis 2,5 m fallen ebenso weg; ein Auto
  unter einer höheren Krone bleibt. Auf der Strecke hinter einem
  Brückenende steht die Zelle auf dem Treffer, der der getragenen Höhe am
  nächsten liegt; ist das das Deck, liegt nichts darüber (Place de
  Varsovie, Pick C, 1,85 m Hohlraum unter der Straße). Eine Straße über
  einem Hohlraum ohne Brücke in der Nähe steht auf dem untersten Treffer;
  liegt die Straße bis 2,5 m darüber, sind ihre Randzellen jetzt `hollow`.
- **Stufen-Check:** Sonst geht die Prüfung den Weg von der Mittellinie zur
  Zelle Rasterstelle für Rasterstelle ab (Säulen der Zellen dort, aus dem
  Cache der Engine). Eine Stelle gilt als erreicht, wenn ihr Boden
  höchstens `stepRise` (0,5 m) über dem höchsten bisher erreichten Boden
  liegt oder über dem zuletzt erreichten plus der Querneigung je Stelle
  seitdem, und höchstens `stepDrop` (0,5 m) unter dem tiefsten bisher
  erreichten oder unter dem zuletzt erreichten minus der Querneigung je
  Stelle seitdem. Fällt der Boden zur Zelle hin, zählt dabei jeder
  erreichte Boden um die Querneigung je Stelle bis dorthin abgesenkt, der
  zuletzt erreichte auch unverändert (Auto talseitig, unten). Erreicht der
  Weg die Zelle nicht, ist sie nicht begehbar:
  zu hoch (`step`) auf Auto, Transporter, Hecke, erhöhtem Garten, zu tief
  (`drop`) unter einer Böschung oder Kaimauer. Tiefer als `OUTLIER_M` ist
  eine Naht.
  - **Querneigung:** Steigt der Boden einen Schritt von der Mittellinie
    entlang der geraden Linie zur Zelle um etwa so viel, wie er gespiegelt
    auf der anderen Seite fällt (beide höchstens `stepRise` auseinander),
    darf der Weg je Stelle um das Kleinere der beiden mehr steigen; fällt
    er zur Zelle hin so, wie er gegenüber steigt, darf er je Stelle um so
    viel mehr fallen. Eine
    Straße quer am Hang (auch DevWorld) behält so ihre Randzellen, solange
    sie höchstens `roofRise` über der Mittellinie liegen (Playtest 563).
    Gemessen auf der geraden Linie, nicht auf den Rasterstellen: Auf einer
    Linie, die weder achsparallel noch diagonal läuft (Zellen um das Ende
    eines Segments), steigt der Boden über die Rasterstellen in ungleichen
    Stufen, oft beim ersten Schritt gar nicht.
  - **0,5 m statt 0,75 m** (seit 2026-09-14): In Rothenburg (Pick A) lag
    ein Auto 0,57 m über der Straßenzelle davor und bestand 0,75 m; die
    Stufen zwischen Bodenzellen dort waren höchstens 0,24 m, am Hang
    (Pick B) höchstens 0,2 m je Schritt. Eine Böschung auf nur einer Seite
    (nichts zu spiegeln) bleibt bis 25 % entlang der Rasterachsen begehbar,
    diagonal bis etwa 17 %; mit 0,4 m fiel an einer diagonalen Straße eine
    Böschung mit 15 % schon weg. Ein Auto, das die Photogrammetrie flacher
    als 0,5 m macht, bleibt im Korridor. Nach dem zweiten Playtest vom
    2026-09-14 hat der Nutzer entschieden: Geparkte Autos und Transporter
    sollen den Korridor einengen, Zellen auf ihnen sind nicht gewollt. Am
    Hang misst die Stufe von der Querneigung aus: Ein Auto 0,6 m hoch auf
    der Bergseite einer Straße mit 15 % Querneigung fällt mit 0,5 m weg,
    mit 0,75 m blieb es (`integration/corridor-walk.spec.ts`).
  - **Auto talseitig** (seit 2026-09-15): Bis dahin war talseitig einer
    Straße quer am Hang der höchste erreichte Boden die Mittellinie, und
    ein Auto zählte von dort: 0,8 m hoch in 4 m Abstand bei 10 %
    Querneigung lag es 0,4 m über ihr und blieb. Anlass: Playtest
    2026-09-15 (Retest 607, Rothenburg), einzelne Autos mit Zellen (rotes
    Auto, ohne Pick; ob es dieser Fall war, ist offen). Jetzt zählt es vom
    Boden davor. Der zuletzt erreichte Boden behält seine volle Stufe: Ein
    Garten auf Höhe der Mittellinie hinter der talseitigen Straßenkante
    bleibt begehbar, ein Auto bis `stepRise` plus einer Stelle Gefälle über
    dem Boden davor aber auch. Autozellen talseitig (synthetisch, Auto in
    4 bzw. 6 m Abstand, vorher → jetzt):

    | Querneigung | 0,6 m in 4 m | 0,8 m | 1,0 m | 0,6 m in 6 m | 0,8 m | 1,0 m |
    |---|---|---|---|---|---|---|
    | 3 % | bleibt → weg | weg | weg | bleibt → weg | weg | weg |
    | 5 % | bleibt | weg | weg | bleibt | bleibt → weg | weg |
    | 10 % | bleibt | bleibt → weg | weg | bleibt | bleibt → weg | bleibt → weg |
    | 15 % | bleibt | bleibt → weg | bleibt → weg | bleibt | bleibt → weg | bleibt → weg |

    Bergseitig fällt ein Auto mit 0,6 m in 4 m Abstand bei allen vier
    Neigungen weg, wie vorher. Kosten: Wo der Boden zur Zelle hin fällt,
    braucht die Prüfung nun auch für Zellen innerhalb einer Stufe um die
    Mittellinie die Querneigung. In einer Spec (Route 1 km mit Knicken,
    3594 Zellen, nicht committet) stiegen die Säulenproben je Durchgang
    eben von 5626 auf 7597, bei 5 % Neigung auf 8504, bei 15 % von 10167
    auf 11115; die Zeit blieb in der Spec bei etwa 1 ms (Säulen aus einer
    Funktion, nicht aus dem Cache der Engine).
  - **Abfall-Check** (`stepDrop`, seit 2026-09-15): Bis dahin ging es
    abwärts beliebig weit. Im Playtest 2026-09-15 (Retest 605, Rothenburg)
    endete der Korridor an einer Straße quer am Hang bergseitig an der
    Böschung, talseitig reichte er in Reihen die Böschung hinunter in den
    Bewuchs. Der Schwellwert kommt aus synthetischen Böden (nicht
    committete Spec): eine Straße 6 m breit mit 3 % Quergefälle zum Tal,
    Böschung ab 3 m neben der Mittellinie, 60 Zellen talseitig in 4 und
    6 m Abstand.

    | `stepDrop` | Bordstein 0,2 m hinab, Rauschen ±0,1, Böschung 20 % einseitig: nicht begehbar | 15 % einseitig, diagonale Straße: nicht begehbar | Hang 40 % quer: nicht begehbar | Böschung 1:1,5: bleiben | 1:2: bleiben | 1:3: bleiben | 1:4: bleiben | Kaimauer 4 m: nicht begehbar |
    |---|---|---|---|---|---|---|---|---|
    | 0,3 | 53 | 65 | 0 | 0 | 0 | 0 | 30 | 70 |
    | 0,4 | 0 | 65 | 0 | 0 | 0 | 30 | 30 | 70 |
    | 0,5 | 0 | 0 | 0 | 0 | 30 | 30 | 60 | 70 |
    | 0,75 | 0 | 0 | 0 | 30 | 30 | 60 | 60 | 70 |
    | 50 | 0 | 0 | 0 | 60 | 60 | 60 | 60 | 0 |

    0,5 m ist wie beim Stufen-Check der tiefste der geprüften Werte, der
    Bordstein, Rauschen und die einseitigen Böschungen mit 20 % entlang
    der Achsen und 15 % diagonal hält. Damit endet der Korridor an einer
    Böschung 1:1,5 an der Straßenkante, an 1:2 und 1:3 nach der ersten
    Reihe (1 m in der Böschung); eine Böschung 1:4 bleibt bis
    `maxHalfWidth`, wie eine gleich steile bergseitig. Ebenso endet er an
    einer Kaimauer, einer Stützmauer oder einer tiefer liegenden Straße
    daneben. `pick()` zeigt `walkCheck: 'drop'`, abschaltbar mit
    `__corridor.set({ stepDrop: 50 })` (misst neu).

    Zweiter Fall: Playtest 2026-09-15 (608, Erlenbach), Wohnstraße,
    talseitig mehrere Zellreihen die Böschung hinunter, je Reihe etwa 0,5
    bis 1 m tiefer. Nachgestellt in `integration/corridor-walk.spec.ts`
    (Straße eben, bergseitig Gärten auf Straßenhöhe, also keine
    Querneigung): Eine erste Reihe 0,55 bis 0,85 m unter der Straße fällt
    weg und alles dahinter mit, der Korridor endet an der Straßenkante. Ein
    Bankett bis 0,45 m unter der Straße bleibt als eine Reihe, die Böschung
    0,8 m darunter nicht. Eine Reihe genau 0,5 m tiefer bleibt ebenfalls.
  - **Erhöhte Mittellinie** (`groundBesideRaisedLine`, 2026-09-15 bis
    2026-09-16, weg): Lagen der erste Schritt zur Zelle hin und sein
    Spiegelbild beide mehr als `stepDrop` unter der Höhe der Mittellinie,
    stand die Linie auf etwas, von dem der Boden zu beiden Seiten abfällt
    (eine Reihe parkender Autos, über die der OSM-Weg läuft), und der Weg
    begann auf dem Boden daneben. Das Band braucht die Regel nicht: Sein
    Weg beginnt ohnehin am Rückgrat, also auf der tiefsten plausiblen
    Fläche quer zur Linie, und über einer Autoreihe liegt das Rückgrat auf
    der Straße daneben.
- **Kein Urteil** (`null`): Deck- und Tunnelzellen, Zellen eines
  Durchgangs (`passage`) und einer Strecke, über die das Band nicht
  entscheidet (`fixed stretch`: Brücke, Tunnel, Strecke hinter einem
  Brückenende, Endstück zum HQ), gefüllte und ungesampelte Zellen, Zellen
  aus Tiles gröber als `maxTileError` (sie kommen dran, sobald ein feineres
  Tile da ist) und jede Zelle, solange kein Band gebaut ist (`no band`).

Die Zelle selbst behält ihre Höhe (`sampleCellY` nimmt den untersten
Treffer). `clamped`, `stepTop` und die orange Kontur gibt es nicht mehr;
die Boden-Probe der Tower-LOS liegt wie überall 1,5 m über der Zelle
(`getGroundTargetY`).

**Von den Säulen auf die Breite:** Der Weg läuft einmal je Station und
Seite vom Rückgrat nach außen, und die Bandkante liegt mittig zwischen der
letzten erreichten und der ersten nicht erreichten Zellmitte. Genau
innerhalb dieser Kanten beansprucht der Korridor seine Zellen; eine Zelle
auf einem Auto oder unter einer Traufe kommt gar nicht erst hinein, statt
sie nachträglich wegzukappen (bis 2026-09-16: `walkCaps`, `roundEndsOff`,
`walkBySegment` und ein weiterer Durchgang je Fund). Was hinter der Kante
liegt, fällt mit weg, auch der Gehweg hinter einer Autoreihe. Gegner halten
sich an die Breite wie an jede andere (`lateralLimit`;
`route-corridor-coverage.spec.ts`).

**Wann:** einmal je Bau, in Schritt 4 (siehe "Wann gemessen und neu gebaut
wird"), auf den eingefrorenen Säulen. Zwischen zwei Bauten ändert sich
nichts. Was ein feineres Tile erst nach dem Einfrieren zeigt, bleibt im
Korridor, auf seiner Höhe (Autodach, Traufe), bis zum nächsten Bau.
`__corridor.towerCells()` zählt es unter `unwalkable`, `pick()` zeigt
`walkable: false`.

**Kosten:** Das Band probt je Station die Zellen quer zur Linie bis
`maxHalfWidth` plus eine Zelle, die Säulen aus dem Cache der Engine, den
der Bau im selben Frame gefüllt hat; je Route einmal, nicht je Durchgang.
Nicht im Spiel gemessen.

## Band: Rückgrat, Bandkanten und die Gegnerlinie

Seit 2026-09-16 (Phase 2, `89651d26`). Code:
`utils/corridor-band.ts` (`buildBand`, `bandPath`, `smoothCentre`),
`PathAndRouteService` (`buildBands`, `bandRouteOf`, `laidInBand`,
`bandStationAt`), Schritt 4 in `CorridorBuild.build`. Ersetzt den Umweg-Planer
(`corridor-detour.ts`) und die Kappen-Schleife.

**Anlass** (Nutzerentscheidung E6, 2026-09-15: "Es soll realistisch sein, das
3D-Modell gilt."): Die OSM-Linie einer Straße läuft über etwas, das die
Photogrammetrie auf der Straße zeigt: parkende Autos (Erlenbach, Way 959083801:
Mittellinienzellen 0,59 bis 1,08 m über der Linie), Erker und Dachecken
(Rothenburg). Der Korridor nimmt eine Zelle, durch die die Linie läuft, bei jeder
Breite; die Gegner stiegen über das Auto, die rote Linie nahm seine Dachhöhe. Der
Planer davor bog die Route um jedes einzelne Hindernis herum, und seine Kaskade
aus Finden, Zusammenlegen und Auslegen versagte, sobald mehrere zusammenkamen
(Playtest 732, `detour.md`, Nachtrag 2). Das Band kennt diese Fälle nicht
einzeln: Autos auf der Linie, eine Linie neben der Fahrbahn und viele Autos
hintereinander sind derselbe Fall.

**Eingaben,** eingefroren aus dem Bau: die OSM-Route je Spawn (Punkte, Ways,
Brücke, Tunnel, Unterführung, Brückenstrecke), je Station die Wand, die die
Strahlen erlauben (`fitCorridorStations`, ohne weitere Kappen), und die Säulen
auf dem Zellraster bis `maxHalfWidth` beiderseits. Stationen bleiben alle
`stationSpacing`.

**Rückgrat-Kandidaten** je Station: die plausiblen Zellen quer zur Linie innerhalb
der OSM-Halbbreite plus `BACKBONE_SLACK_M` (1,5 m) und innerhalb der
Strahlenwände. Plausibel heißt: nicht hohl (`hollow`), eine Nachbarzelle quer
innerhalb `stepRise` (ein Einzelloch wird nicht Start; in einer einzelligen Gasse
zwischen Häusern gilt die Regel nicht, weil dort kein Nachbar zwischen den Wänden
liegt), und Straße: höchstens `stepDrop` unter der Zelle der OSM-Linie, oder die
Linie kommt innerhalb von vier Stationen bis auf `stepRise` an sie heran. Ohne
diese letzte Bedingung wird der Fluss neben einem Kai oder die Böschung eines
Damms zum Start. Liegt die tiefste Kandidatin einer Station mehr als `stepDrop`
unter dem Median der tiefsten von ±2 Stationen (Gully, Loch im Mesh), fallen
die Kandidatinnen darunter weg (`withoutPits`), sofern welche übrig bleiben.

**Wege quer** (`sectionsOf`): Von der tiefsten Kandidatin aus wird das Band
gelaufen (Bandkanten, unten), dann von der tiefsten, die dieses Band nicht
erreicht, und so weiter, bis jede Kandidatin in einem Band liegt. Zwei Wege einer
Station liegen nebeneinander, getrennt durch das, woran ihr Lauf endete: ein
hohles Objekt, eine Stufe, einen Abfall.

**Rückgrat als Kette** (`chainSections`, seit 2026-09-16): Die Route wählt je
Station einen Weg, als kürzester Weg über Stationen und Wege (Viterbi),
deterministisch, bei Gleichstand der tiefere Weg. Über eine Station ohne Weg quer
(keine plausible Zelle) geht die Kette hinweg und vergleicht die Wege davor und
danach; eine Strecke, die das Band nicht entscheidet (Brücke, Tunnel), beendet sie.
Verglichen wird der Reihe nach:

1. **Wechsel ohne Überlappung:** Überlappt der Weg einer Station den der Station
   davor nicht (Versätze der Kanten), kreuzt die Linie das, was beide Läufe
   beendet hat. So wenige wie möglich.
2. **Erhöht:** Meter, die das Rückgrat eines Wegs mehr als `stepRise` über dem
   tiefsten Rückgrat seiner Station liegt, summiert. Innerhalb einer Stufe zählt
   die Höhe nicht: ein Grünstreifen 0,46 m unter der Fahrbahn, ein Rinnstein.
3. **Abseits:** Meter, die ein Weg neben der OSM-Linie liegt (0, wo sie in ihm
   liegt), summiert.

Damit steigt das Band von einem Auto, einer Hecke oder einem Erker, über die die
OSM-Linie läuft, auf die Straße daneben: Dieser Weg liegt tiefer und überlappt die
Stationen ringsum ebenso. Füllt ein Auto die Gasse, ist es der einzige Weg, das
Band liegt darauf (E6). Um eine lange Objektreihe herum wechselt die Kette die
Seite, wo kein Weg herum führt, einmal. Das Rückgrat ist die Kandidatin, von der
aus der gewählte Weg gelaufen wurde, die Bandkanten sind die seines Laufs.

**Anlass** (Playtest 748, Stuttgart `?l=48.77895,9.17875&s=48.78353,9.17791`):
Vorher nahm jede Station für sich die
tiefste Kandidatin. An der Kurve lag eine Grünstreifen-Zelle unter einer Hecke
0,46 m tiefer als die Fahrbahn, Station 188 legte ihr Band dorthin, die Nachbarn
auf die Fahrbahn; im Einmündungsbereich legte 192 ihr Band nördlich eines Masts.
Der Taper entlang der Route (`taperEdges`) begrenzt jede Kante gegen die Nachbarn
und klemmt sie am eigenen Rückgrat, so schnitten sich die seitlich getrennten
Bänder auf 0 bis 1,5 m ab, wo jeder Lauf für sich 4 bis 14 m breit war. Derselbe
Kern in Berlin (Platz der Republik, ein hohles Objekt zwischen den Seiten) und
Paris (Place de Varsovie, der Boden hinter einer Reihe hohler Zellen 3 cm tiefer).
Nachgestellt in `integration/corridor-band.snapshots.spec.ts` auf Ausschnitten der
Snapshots (`integration/fixtures/band/README.md`) und in `corridor-band.spec.ts`
(Grünstreifen hinter einer Hecke, Objekt zwischen den Seiten, eine Station ohne
Weg quer dazwischen, Seitenwechsel an einer langen Objektreihe). Die Klemme am
Rückgrat in `taperEdges` bleibt: Sie greift auch zwischen überlappenden Nachbarn,
wo das Rückgrat nahe einer Kante liegt, und hält jedes Band nicht leer. Wo die
Kette die Seite wechseln muss, schneidet sie die Bänder dort weiterhin auf das
Rückgrat zu. Kette und Knick-Rahmen bleiben (Entscheidung des Users, 2026-09-16).

**Bandkanten** je Station und Seite: vom Rückgrat quer nach außen, Zelle für
Zelle, mit den Stufen-, Abfall- und Querneigungsregeln des Laufwegs (oben), nur
vom Rückgrat statt von der Mittellinie aus. Das Band endet vor der ersten Zelle,
die zu hoch, zu tief, hohl oder mehr als `roofRise` über dem Rückgrat liegt,
spätestens an der Wand der Strahlen. Ein kleines Objekt auf einem Platz wird
nicht umflossen: Das Band endet davor (Nutzerentscheidung). Die Kante liegt
mittig zwischen der letzten erreichten und der ersten nicht erreichten Zellmitte.
Kurze Ausbuchtungen entlang der Route werden geschnitten (`cutShortBulges`,
`bulgeLength`), und Kanten wie Breiten steigen entlang der Route höchstens um
`taper` je Meter (`taperEdges`, `taperWidths`). Ohne diesen Taper legt sich das
runde Ende der Zellen einer breiten Station eine halbe Autolänge davor über genau
das Auto, vor dem das Band endet, denn `jointCap` kappt nur das Nachbarsegment.

**Gegnerlinie:** Ziel ist die Bandmitte. Geglättet wird mit einem
Glättungs-Spline mit Schranken (`smoothCentre`, `CENTRE_STIFFNESS`), der die
Linie innerhalb `[L + edgeMargin, R − edgeMargin]` hält; ist das Band schmaler
als `2 · edgeMargin`, läuft sie in seiner Mitte. Stationen ohne Band und beide
Enden der Route sind auf die OSM-Linie festgenagelt. Der Bericht nennt die
steilste Bewegung und die engste Krümmung; über die fünf Szenen bleibt sie unter
dem Wurm-Radius (1/20 m) und unter 0,25 m je Meter.

**Am Knick** (`edgeLength`, seit 2026-09-16): Ausbuchtungs-Schnitt (`cutBulges`) und
Taper (`taperEdges`, `taperWidths`) messen die Meter zwischen zwei Stationen entlang
der Kante, so wie `bandPath` das Band legt: als Parallele der Route, am Knick auf
Gehrung. Das ist die Route dazwischen, und wo sie von der Seite der Kante wegdreht,
dazu der Bogen um die Außenseite, Versatz mal Winkel. Der Taper nimmt den Versatz
der Station, von der die Grenze kommt, der Schnitt den der Stufe, die er prüft, und
zählt die Länge in Stationen. Auf gerader Route bleibt der Schnitt so genau
`cutShortBulges` und der Taper die Distanztransformation entlang der Route. Innen
verkürzt sich die Parallele und faltet sich wenige Meter vom Knick, wo die
Querlinien der Stationen die andere Straße entlanglaufen; dort bleibt die Länge
entlang der Route, der Taper greift innen also so stark wie zuvor.

- **Anlass** (Playtest 748): Entlang der Route gemessen schnürte eine schmalere
  Straße nach einem Knick die breitere davor an der Außenseite ein, auf einer
  Kante, die um die Ecke läuft und den Häusern der anderen Straße nicht nahekommt,
  und ebenso umgekehrt. Nachgestellt in `corridor-band.spec.ts` ("turning between
  a wide and a narrower street": 7 und 4 m Halbbreite, 30°, 60° und 90° in beide
  Richtungen, Häuser an eckigen Straßenrändern): Die Außenkante der breiten Straße
  lag in den 10 m vor oder nach dem Knick 1,25 bis 2,25 m innerhalb ihrer Wand, jetzt
  höchstens 0,5 m (bei 90° gar nicht).
- **Nicht geändert:** Die Querlinien selbst. Eine Station wenige Meter vor einem
  Knick misst quer zu ihrem Segment und damit die andere Straße entlang; ein Objekt
  dort beendet ihren Lauf (Nutzerentscheidung: Das Band endet vor einem kleinen
  Objekt). Die Querlinien entlang der Gehrung zu drehen (Variante a der Analyse)
  änderte Lauf, Wände und die Punkte der Gegnerlinie zugleich.

**Straße unter der Station** (`street`, `streetLevel`, seit 2026-09-16): die
Rückgrate entlang der Route als morphologisches Opening über `PASSAGE_SPAN_M`
(30 m) - erst das tiefste Rückgrat in 15 m beiderseits, dann das höchste dieser
Werte. Was die Gasse über weniger als diese Länge bedeckt (Torturm, Torbogen,
Auskragung, Auto), ist damit heraus, eine steigende Straße behält ihre Neigung
(auf einer geraden gibt das Opening sie exakt zurück). Stationen ohne Rückgrat
(Brücke, Tunnel, Endstück zum HQ) bekommen die Straße aus den Stationen in
Reichweite. `street` ist der Bezug für Durchgang und Übersteigen und die Höhe,
die ein Tunnelportal statt eines Treffers auf einem Dach nimmt (`portalGround`).

**Kein Band:** Ein Stück wird ein **Durchgang** (Tunnelstück wie ein Torbogen:
`inTunnel`, `passage`, Portale, Höhe zwischen ihnen), wenn die Station ihre
Linie nicht auf die Straße legen kann. Das gilt nur auf Straßen, die das Band
entscheidet, und wo `street` bekannt ist, auf drei Weisen (`markPassages`):

- Das **Rückgrat** liegt mehr als `roofRise` über `street`: quer zur Linie ist
  gar keine Zelle auf der Straße (Gasse bis zum Boden gefüllt, Krone, Erker).
- Die **Linie** läuft außerhalb eines Durchgangs durch eine Zelle, die so hoch
  über `street` liegt (`coveredOnLine`), mit oder ohne Rückgrat. Eine Route
  beansprucht jede Zelle, durch die ihre Linie läuft, bei jeder Breite
  (`claimSegmentCells`), und die behält das Dach über der Gasse: ein
  vorkragendes Obergeschoss, oder das Mesh eines Torturms hinter der Öffnung.
  Geprüft wird die Gegnerlinie, wie `bandPath` sie legt, Stück für Stück, mit
  jeder Zelle, die ein Stück berührt, auch nur an einer Ecke (auf 1 mm,
  `CLAIM_MARGIN_M`). Die Zelle zählt für die nähere der beiden Stationen an
  den Enden des Stücks; ein Punkt zwischen zwei Segmenten ist kein solches
  Ende. Diese Station wird Durchgang, dann werden Band und Linie neu gelegt,
  bis keine solche Zelle mehr bleibt. Jede Runde fügt nur Stationen hinzu,
  der Bau endet also.
- Eine **Lücke** zwischen zwei Durchgängen, oder zwischen einem Durchgang und
  einem Stück unter Deckung aus OSM (Tunnel, überdachter Durchgang, Stück
  unter einer fremden Brücke, `BandRoute.covered`), höchstens
  `PASSAGE_GAP_M` (4 m, zwei Stationen) lang (`closePassageGaps`).

Bis 2026-09-16 brauchten beide Regeln ein Rückgrat, und die zweite prüfte nur
die Zelle, in der die Station steht, und nur, wo das Band schmaler als zwei
`edgeMargin` war. Davor fing `streetUnderRoof` den zweiten Fall als eigene
Höhenregel ab; das Band hatte sie ersetzt.

Ein tieferes Objekt, das die Gasse ausfüllt, ist sein eigenes Rückgrat: Das Band
liegt darauf, die Gegner steigen darüber (E6, mehr als `stepRise` über `street`).
Brücke, Tunnel, Unterführung, Strecke hinter einem Brückenende und das Endstück
zum HQ entscheidet das Band nicht; dort bleiben OSM-Linie und Strahlbreiten.

**`passages`** (`CorridorBand.passages`, Trace `band.build` und
`build.freeze`) zählt die Durchgänge, die an kein Stück unter Deckung aus OSM
grenzen. Ein Durchgang an einem Tunnel verlängert diesen (das Mesh eines
Torturms über die Mündung hinaus) und zählt nicht: Ob die Kante des Meshes
noch die Linie einer Station erreicht, entscheidet die Lage des Gitters auf
eine Zelle genau.

**Anlass** (Playtest 2026-09-16, Rothenburg, Weißer Turm über der Georgengasse,
Way 139711833 `building=tower historic=city_gate height=37`): Der Bezug war
vorher der Median der Rückgrate von je vier Stationen beiderseits. Ein Torturm
ist tiefer als diese 8 m, also war der Median selbst das Turmdach: Nur die
beiden Enden des Stücks wurden Durchgang, das Band dazwischen lag auf dem Turm,
und die Portale 2 m vor den Mündungen fragten Stationen, die ebenfalls auf dem
Turm standen. Szene: `integration/corridor-band.scenes.spec.ts`, "Weisser Turm".

**Anlass Gitterlage** (Playtest 747, Rothenburg): Derselbe Turm, einmal kalt
geladen und einmal im Spiel hinnavigiert, auf denselben Tiles. Das HQ lag
0,148 m nördlich und 0,120 m östlich daneben, das 2-m-Gitter also rund 19 cm
anders gegen die Welt. Der kalte Bau fand zwei Durchgänge, der navigierte
einen, und dort standen Zellen zwischen Durchgang und Torbogen auf dem Turm
(Zelle -97,111 auf 490,37 m, die Straße auf 480,65 m). Aus den beiden
Snapshots, soweit sie reichen; die Säulen
darin sind die des Säulen-Caches beim Schnappschuss, dieselben wie beim Bau
angenommen:

- Station 11:5, 2 m vor dem Turm, hatte in beiden Bauen innerhalb der
  Strahlenwände nur Zellen auf dem Turm. Kalt lagen zwei davon 0,26 m
  auseinander (488,37 und 488,11 m), also innerhalb einer Stufe: Rückgrat auf
  dem Turm, rund 7,5 m über `street`, Durchgang. Navigiert 0,57 m (487,41 und
  487,98 m): kein Rückgrat, die Station `fixed`. Eine Station ohne Rückgrat
  prüfte keine Regel, ihr Stück behielt die Strahlbreiten und beanspruchte die
  Zellen auf dem Turm als Boden.
- Davor lagen die Zellen quer zur Linie 2,6 bis 2,9 m über `street`
  (Stationen 11:1 und 11:2, Durchgang), an Station 11:3 die Zelle der Linie
  2,3 m: kalt ohne Rückgrat, navigiert ein Übersteigen. Beide trennten den
  Durchgang davor vom Turm.
- Mit den Regeln von oben kreuzt die Linie beider Snapshots an 11:4 und 11:6
  (kalt) und an 11:4 bis 11:6 (navigiert) Zellen 4 bis 28 m über `street`;
  die Lücke an 11:3 schließt sich. Das gäbe in beiden Bauen einen Durchgang von
  11:1 bis in den Torbogen. Nachgerechnet auf den Linien und Säulen der
  Snapshots, nicht auf einem neu gebauten Band (die Säulen neben dem Korridor
  fehlen darin), also plausibel, nicht belegt.

Nachgestellt in `corridor-band.spec.ts` ("wherever the cell lattice lies":
Vorbau, Torturm, Gewölbe mit einer Stelle unter `roofRise`, Mesh vor einem
Torbogen aus OSM, je in 64 Gitterlagen und drei Winkeln) und in der Szene
"Weisser Turm" (65 Gitterlagen, die aus 747 eingeschlossen, 1 und 2 m
Mesh-Überstand). Mit den Regeln davor lagen in der Szene bei 1 m Überstand in
16 von 65 Gitterlagen Zellen im Umkreis von 15 m um den Turm über der Straße,
bei 2 m in 53; synthetisch lag in den schrägen Gassen in 23 bis 30 von 64
Lagen eine Zelle der Deckung auf der Linie.

**In der Route** (`bandPath`, `laidInBand`): Knoten sind der Routenstart, jede
Station um ihren Versatz zur Seite gesetzt, jeder Punkt der Route entlang der
Gehrung seiner beiden Segmente und das Routenende. Auf der Innenseite eines Knicks
entfällt jede Station, die entlang ihres Segments hinter dem Gehrungspunkt liegt
(vor dem Knick darüber hinaus, danach noch davor); der Gehrungspunkt übernimmt
ihre Halbbreiten. Sonst liefe die Linie dort ein Stück rückwärts (Erlenbach,
2026-09-17: 0,3 m bei 95 Grad und 1,23 m Versatz). Die Halbbreiten eines Stücks
sind die Bandkanten ab der Linie, das Schmalere seiner beiden Enden; in einem
Durchgang die OSM-Halbbreite. Ein Stück abseits der OSM-Linie trägt `detour`, ein
Durchgang `passage` und `inTunnel`. Zellen, Seitenversatz, Wurm, Ooze, Held und
rote Linie folgen den Waypoints ohne eigene Regel.

**Wann** (`buildBands`): einmal je Bau, nach der Messung und vor Routen und
Zellen, auf den eingefrorenen Säulen des Grids (`columnNear`, Tiles bis
`maxTileError`). Gespeichert je Route, wie das Straßennetz sie gibt; jeder Bau
derselben Route legt dieselbe Linie, auch ein Neubau der roten Linie nach einer
Höhenänderung. Vergessen mit den Messungen. Das Grid bekommt die Station zu einem
Punkt (`setBand`), für die Diagnose und für die Portale eines Tunnels.

**Diagnose:** `__corridor.pick()` nennt an der Station `backboneM`, `backboneY`,
`streetY` (die Straße unter der Station, siehe oben), `bandLeftM`, `bandRightM`,
`bandKind` (`band`, `climb`, `passage`, `fixed`), `detourM` (Versatz der
Gegnerlinie, rechts positiv) und `passage`; je Zelle `walkCheck` wie oben.
Steht `backboneY` mehr als 0,5 m über `streetY`, liegt das Band auf etwas;
liegen beide gleich, steht es auf der Straße. `__corridor.fingerprint()` hasht
das Band unter `band`, `streetY` eingeschlossen.

**Tests:** `utils/corridor-band.spec.ts` (Regeln, dazu Böschung, Kai, Damm, 15 %
Querneigung, Durchgang, Übersteigen, Determinismus, Durchgänge in jeder
Gitterlage), `integration/corridor-band.scenes.spec.ts` (fünf echte OSM-Routen
mit den Zellen der Playtests, je zweimal mit gleichem Bericht; Weißer Turm,
Pont d'Iéna und A6 in jeder Gitterlage auf eine Viertelzelle, `LATTICE_SHIFTS`),
`managers/worm/worm-detour.spec.ts` (Wurm neben einem Transporter),
`integration/corridor-band.snapshots.spec.ts` (Stuttgart, Berlin, Paris und zwei
Engstellen an Wänden auf den Säulen der Snapshots, Playtest 748).

## Seitenversatz der Gegner

Jeder Gegner bekommt beim Spawn einen Faktor in [-1, 1]: Zufall mal
`lateralSpread` seines Typs (`EnemyManager.spawnOne`,
`enemy-types.config.ts`: 0,5 bis 1,0; beim Wurm, dessen Kette als Ganzes schwingt, und bei der Ooze 0). Negativ heißt links, positiv
rechts der Fahrtrichtung, 0 die Mittellinie.

Der Versatz in Metern ist Faktor mal die seitliche Grenze an der aktuellen
Stelle, auf der Seite, auf der der Gegner läuft (`MovementComponent.place`,
aufgerufen aus `advance` und `setPath`). An einem Knick der Route laufen
Mittellinie und Bahnen auf Bögen (siehe Ecken).

- **Grenze eines Segments:** `lateralLimit(H) = max(0, H - edgeMargin)`
  (`route-corridor.ts`). `edgeMargin` ist mindestens die halbe Diagonale
  einer 2-m-Zelle (1,41 m). Ein Gegner innerhalb der Grenze steht deshalb
  in einer Zelle, deren Mittelpunkt innerhalb `H` liegt, also in einer Zelle,
  die das Grid angelegt hat (Kommentar an `CorridorConfig.edgeMargin`).
  - **Warum das zählt:** Außerhalb der Zellen findet `getEnemiesForTower`
    den Gegner nicht (`GlobalRouteGrid.getEnemiesForTower`).
  - **Test:** `integration/route-corridor-coverage.spec.ts` läuft das über
    Engstellen und Ecken ab.
- **Übergänge:** Die Grenze an einem Waypoint ist die kleinere der beiden
  angrenzenden Segmente. Danach darf sie entlang der Route höchstens um
  `taper` (0,5 m pro m) steigen (`buildSideLimits`, `route-corridor.ts`).
  Vor einer Engstelle rücken Gegner so allmählich ein, statt am ersten
  schmalen Waypoint seitlich zu springen. Diese Hülle der spitzen Route ist
  `SideLimits.node`; die Gegner halten sich an die Grenzen, die an Ecken
  daraus entstehen (`RouteCorners.left`, `right`, siehe Ecken).
- **Mittellinie:** Unter 1,5 m Halbbreite ist die Grenze 0. An einer
  einzelligen Engstelle laufen alle Gegner auf der Mittellinie.
- **Kosten:** Grenzen werden einmal je Pfad-Array berechnet und geteilt
  (`getRouteProfile`, WeakMap), die Bögen beim ersten Lesen von
  `RouteProfile.corners`. Im Sub-Step bleiben auf geraden Stücken
  Index-Lookups und vier Vergleiche, auf einem Bogen dazu Kosinus, Sinus,
  sechs Grenzen und die Blickrichtung (siehe Ecken, Kosten).
- **Richtung:** Der Versatz steht in Metern senkrecht zur Laufrichtung, auf
  einem Bogen radial; nur die Länge wird mit cos(Breite) skaliert
  (`MovementComponent.place`, `RouteCorners.insideLon`).

### Ecken

Seit 2026-09-16 (TODO C12, Nutzerentscheidung Variante A), ein Bogen je
Gruppe von Knicken seit 2026-09-17. Code: `utils/route-corners.ts`
(`RouteCorners`, `ArcLimits`, `RouteCornerBuilder`: Gruppen und Radius),
`utils/route-corner-check.ts` (`ArcCheck`: die Prüfung eines Bogens),
`RouteProfile.corners` und `sizeRouteCorners` (`route-corridor.ts`),
`MovementComponent.place` und `placeOnArc`.

**Anlass** (Playtest 2026-09-16, Stuttgart, Horde von rechts, Rechtskurve um
90° nach oben): Ein Gegner auf der Außenbahn sprang an der Ecke nach vorn.
Der Versatz stand senkrecht zum aktuellen Segment; am Waypoint wechselte die
Senkrechte schlagartig. Außen sprang eine Bahn um Versatz mal
`2 sin(Knick / 2)` schräg nach vorn (bei 90° das 1,41-Fache des Versatzes,
bei 5,5 m also 7,8 m), innen überlappten die Parallelen und sie sprang
zurück, und der Schritt über den Waypoint richtete die Blickrichtung auf
diesen Sprung. Kleine OSM-Knicke gaben dasselbe im Kleinen.

**Mechanismus:** Eine Ecke ist eine Gruppe aufeinanderfolgender Waypoints,
an denen die Route abknickt (je mehr als 1e-4 rad), die insgesamt in eine
Richtung dreht. Ihr Bogen beginnt auf dem Segment vor dem ersten und endet auf
dem Segment nach dem letzten Knick, tangential an beide, und dreht um die
Summe der Knicke (höchstens π − 1e-3). Die Mittellinie läuft dort auf einem
Kreisbogen mit Radius `R`, jede Bahn auf einem Bogen um denselben
Mittelpunkt. Korridor, Zellen, Band, Waypoints und Fingerprint bleiben, wie
sie sind. `RouteCorners` hält je Waypoint seinen Bogen (`arcOf`, -1 für
keinen), je Segment die Meter auf Bögen an Anfang und Ende (`arcIn`,
`arcOut`) und je Bogen Strecke (`from`, `to`), Radius, Drehung, Innenseite,
Kappen, Rücknahmen und die Richtungen in Grad je Meter für die Platzierung.

- **Gruppen:** Die Knicke werden nach Größe genommen. Jeder beginnt eine
  Gruppe und nimmt den Waypoint davor, danach oder beide dazu, solange der
  Radius dadurch um mehr als 0,1 % wächst. Waypoints, die insgesamt nicht in
  eine Richtung drehen (S-Kurve, Schleife), passen in keinen gemeinsamen
  Bogen. Ein Bogen bleibt von den Strecken schon gesetzter Bögen fern und
  lässt einem noch nicht gesetzten Knick am anderen Ende eines Segments, was
  dessen eigener Bogen bräuchte, höchstens die halbe Segmentlänge; am Anfang
  und Ende der Route darf er das ganze Segment nehmen. Eine Ecke, die das
  Band mit Stücken von 0,5 bis 1 m und kleinen Wacklern legt, wird so ein
  Bogen über diese Stücke; eine Kurve aus vielen kleinen Knicken wird zu
  Bögen, die sich etwa in der Mitte der Stücke treffen und dem Kreis der
  Kurve folgen.
- **Formation:** Der Fortschritt bleibt `currentIndex` und `progress`, die
  Strecke entlang der spitzen Mittellinie. Auf dem Bogen wird er linear auf
  den Winkel abgebildet: Alle Bahnen gehen im selben Sub-Step in die Ecke und
  aus ihr heraus. Außen läuft eine Bahn schneller, innen langsamer, die
  innerste dreht bei gleich breiten Seiten an einem einzelnen Knick auf der
  Stelle. `getPathProgress`, `getDistanceAlongPath`, Ankunft am HQ,
  Targeting "first", Wellen-Timing, Bots und Balance lesen dieselben Zahlen
  wie vorher (Test vergleicht Schritt für Schritt mit einem Gegner ohne
  Bögen).
- **Blickrichtung:** auf dem Bogen jeden Sub-Step die Tangente des Bogens an
  der Stelle, in jeder Bahn dieselbe, auch dort, wo eine Bahn nicht
  vorankommt oder ein- und ausrückt (die Richtung ihrer Bewegung dort
  drehte den Gegner um bis zu einen rechten Winkel). Der Heading-Hold hält
  sie auf geraden Stücken wie bisher; der Bogen ist ein eigenes Stück, der
  erste Schritt danach nimmt die Richtung wieder aus der Bewegung. Rückt die
  Bahn am Bogenende noch ein oder aus, dreht sie dort um bis zu
  `atan(taper)` auf einmal, wie an jedem Taper (der Transform glättet es).
- **Überall gleich:** `setPath(path, index, progress)` stellt den Gegner
  dorthin, wohin `advance` ihn bei diesem Fortschritt stellt, in der Bahn
  seines Faktors: Split-Kinder, auch die der Ooze, und die Platzierung im
  Enemy Debug stehen auf dem Bogen. Die Stelle hängt nur vom Fortschritt ab,
  nicht von den Schritten dorthin (fester Sub-Step, gleich bei 1x bis 75x).

**Grenze einer Bahn** (`ArcLimits` in `RouteCorners.left` und `right`,
`placeOnArc`): Eine Bahn hält die Grenze an ihrer Stelle entlang der Route
wie auf einem geraden Stück, aus den Werten je Waypoint (`arc`) und am
Anfang und Ende des geraden Teils jedes Segments (`entry`, `exit`) mit dem
Taper dazwischen. Diese Werte sind die Grenze der spitzen Route, an den
Waypoints und Enden eines Bogens höchstens seine Kappe, danach per
Min-Plus-Transformation höchstens um `taper` je Meter steigend
(`arcLimits`). Dazu:

- **Kappe innen:** höchstens `R`, weiter innen liefe die Bahn rückwärts.
- **Kappe außen:** Hinter einem Knick läuft eine Außenbahn durch die Rundung
  der Zellen, deren Raum die Grenze am Knick ist. Steigt die Grenze danach
  an (die Straße nach dem Knick breiter), wird die Außenseite auf die
  kleinste Außengrenze der Knicke des Bogens gekappt, wenn der Bogen erst
  damit passt (`capLeft`, `capRight`).
- **Rücknahme** (`shaveLeft`, `shaveRight`, höchstens `ARC_SHAVE_M` =
  0,2 m): Fehlen den äußersten Bahnen nur Zentimeter Raum (ein Bogen über
  den Sehnen einer Kurve, ein Radius etwas über der inneren Grenze), geben
  sie das in der Mitte des Bogens her, von seinen Enden an um `taper` je
  Meter ansteigend.
- `SideLimits.node` bleibt die Hülle der spitzen Route: an ihr wird jeder
  Bogen geprüft, der Wurm liest sie.

**Radiusregel** (`RouteCornerBuilder`): der größte Bogen, bei dem jede Bahn
von Faktor -1 bis 1 innerhalb der Grenze der spitzen Route bleibt
(`SideLimits.node`, je Seite) und damit in den Zellen.

- **Ein Knick, gleiche Grenzen:** `R` ist die innere Grenze, bis auf die
  Rücknahme. Eine Bahn `e` m innen steht beim Winkel `phi` ab Bogenanfang
  `R - (R - e) cos(phi)` innen neben dem Segment in die Ecke, also höchstens
  `R`; ein größerer Radius legt die inneren Bahnen hinter den Punkt, an dem
  sich die inneren Kanten beider Segmente treffen. Eine Bahn `o` m außen
  steht höchstens `o` außen neben einem Segment und hinter dem Waypoint
  höchstens `o` von ihm, in der Rundung der Zellen dort (`jointCap`,
  `route-grid-builder.ts`).
- **Prüfung** (`ArcCheck.fits`): An jeder geprüften Stelle liegen die Bahnen auf
  einer radialen Linie. Jedes Segment der Gruppe hält davon ein Intervall
  (neben dem Segment, innerhalb seiner Grenze auf der Seite), jeder Knick
  eines (hinter ihm, in der Rundung seiner Außengrenze); zusammen müssen sie
  die ganze Linie von der äußeren bis zur inneren Bahn halten. Außerdem muss
  die spitze Mittellinie an derselben Stelle der Route innerhalb des Raums
  der spitzen Route dort (breitere Seite) von der Mittellinie des Bogens
  liegen. So schneidet ein Bogen keine Haarnadel ab, deren Schenkel im Raum
  des anderen liegen, wo ein Gegner für die Länge der Kurve stehen bliebe.
- **Stellen:** alle 2° des Bogens und alle 0,5 m seiner äußersten Bahn; wo
  die Grenze der Bahnen einen Knick hat (Taper, Kappe, Rücknahme); 0,2 mm vor
  und nach jeder Stelle, an der eine Bahn oder die Mittellinie eine Linie
  kreuzt, an der sich ändert, was sie hält (Enden eines Segments, Knicke der
  Grenze neben ihm, die Winkelhalbierenden, wo sich die Raumkanten zweier
  Segmente an einem Knick treffen); wo zwei Enden der Intervalle
  aneinander vorbeigehen oder eines eine Bahn oder die Mittellinie passiert
  (`findPasses`). Beides mit Regula falsi. Zwischen den Stellen ändert sich
  glatt, was einer Bahn an Raum fehlt: `judgeBetween` schätzt aus der
  Krümmung von Bahn und Grenze, wie weit es zwischen zwei Stellen über der
  Geraden zwischen ihnen liegen kann, prüft, wo die Schätzung die Bahn
  draußen sieht, und teilt bis zu dreimal.
- **Suche:** zuerst die größte Tangente, die der Platz erlaubt, dann (bei
  einem Knick ab der Schranke `knickBound`) Halbieren bis auf 1 cm oder 1 %
  des Radius.

**In Zahlen** (Snapshots vom 2026-09-16, `corridor-stuttgart-nav-152029`,
`corridor-berlin-cold-150556`, `corridor-paris-cold-150811`, die
Gegnerlinie aus `bandPath`; Messung nicht eingecheckt). Vorher: ein Bogen je
Waypoint, geklemmt auf die halbe Segmentlänge. Außenbahn: Meter je Meter
Fortschritt auf dem Bogen, vorher geschätzt, jetzt gelaufen, schnellste der
Bahnen -1 bis 1.

| Ort | Knick | Stücke am Knick | R vorher | R jetzt | Waypoints | Außenbahn vorher, jetzt |
|-----|-------|-----------------|----------|---------|-----------|-------------------------|
| Stuttgart 48 m | 46° | 1,24 / 1,31 m | 1,46 m | 6,96 m | 4 | 4,0; 1,7 |
| Stuttgart 74 m | -51° | 0,95 / 0,93 m | 0,99 m | 7,26 m | 5 | 6,1; 1,7 |
| Stuttgart 574 m | -87° | 1,21 / 0,79 m | 0,41 m | 3,00 m | 4 | 10,1; 1,8 |
| Stuttgart 589 m | -56° | 1,53 / 1,65 m | 1,44 m | 5,96 m | 3 | 3,6; 1,6 |
| Berlin 110 m | 113° | 0,84 / 0,82 m | 0,27 m | 5,28 m | 9 | 14,1; 1,4 |
| Berlin 428 m | 88° | 1,02 / 1,04 m | 0,53 m | 5,88 m | 7 | 8,9; 1,6 |
| Paris 244 m | 89° | 0,97 / 1,04 m | 0,49 m | 5,98 m | 7 | 9,6; 1,5 |
| Paris 467 m | -121° | 1,00 / 1,05 m | 0,28 m | 3,02 m | 7 | 7,2; 1,8 |

Auf allen drei Routen steht keine Stelle einer Bahn (-1, -0,5, 0, 0,5, 1,
alle 5 cm) außerhalb der Zellen des Snapshots. Sub-Steps, in denen die
Blickrichtung um mehr als 0,3 rad dreht (5 m/s, Bahnen -1, -0,5, 0,5, 1):
Stuttgart 1068 spitz, 286 mit Bögen; Berlin 485, 135; Paris 326, 52.

**Was bleibt:**

- **Kein Innenraum:** Ist die innere Grenze 0 (Halbbreite innen bis
  `edgeMargin`), bleibt die Ecke spitz. In den Zickzack-Strecken der
  Snapshots ist die Grenze auf beiden Seiten 0 (Stuttgart bei 190, 282 und
  386 bis 403 m, Berlin bei 326 und 441 m, Paris bei 134 m): Alle Bahnen
  laufen dort auf der Mittellinie, ohne seitlichen Sprung; die
  Blickrichtung springt am Waypoint.
- **Sehr kurze Stücke:** Stuttgart 88° 0,15 m vor dem Ende der Route (R
  0,08 m, Außenbahn 6,3 m je m); 47° direkt hinter der Gruppe der 87°-Ecke,
  deren Bogen sich das Stück davor genommen hat (R 0,79 m, 4,4 m je m);
  Berlin ein Zickzack aus Stücken von 5 cm bei 250 m (121°, -95°, -113°,
  R 0,02 m, 2,1 m je m auf 16 cm Route) und 149° am Spawn (R 0,21 m, 2,3 m
  je m).
- **Rest der Prüfung:** 72 Zufallsrouten (Stücke 0,2 bis 6 m, Halbbreiten
  0,3 bis 8 m, Knicke bis etwa 45°), jede Bahn von -1 bis 1 in Viertelschritten
  an 400 Stellen je Bogen: höchstens 0,05 mm über der Grenze der spitzen
  Route, an den Enden der Bögen (Rechengenauigkeit der Messung, flache Meter
  gegen Grad). Die Zellen reichen um `edgeMargin` weniger eine halbe
  Zellendiagonale (1,414 m) über die Grenze hinaus: beim kleinsten erlaubten
  `edgeMargin` von 1,42 m um 5,8 mm, beim Standard von 1,5 m um 8,6 cm
  (Kommentar an `CorridorConfig.edgeMargin`).
- **Held:** läuft die spitze Linie (`new MovementComponent(hero, false)`,
  `roundsCorners`). Er plant alle 250 ms vom nächsten Punkt des Routengraphen
  neu, eine Stelle auf einem Bogen spränge dabei zurück auf die Linie. Er
  liest `RouteProfile.corners` nie, seine Pfade bauen keine Bögen.
- **Wurm:** unverändert. Er stellt sich mit `seekDistance` und
  `WormPath.place` selbst hin, mit eigenen Bögen bis 20 m, und liest
  `SideLimits.node`; `advance` ruft er nicht auf.
- **Nicht umgestellt, weil kein Gegnerort daraus wird:** der Körper der Ooze
  (`RouteBodyStations`, Stationen auf der spitzen Mittellinie; nur ihre
  Spitze folgt dem Bogen), die Kamera des Boss-Intros (`pointAlongRoute`
  rahmt auf der spitzen Mittellinie ohne Seitenversatz, neben dem Boss um
  höchstens den Abstand der Mittellinie des Bogens von der spitzen), der
  Vorhalt des Orbital-Laser-Bots (`pointAhead`: Mittellinie, Meter voraus,
  ohne Seitenversatz), Offscreen-Marker und Zielwahl des Helden (lesen den
  Fortschritt), das Replay (zeichnet die Position auf).
- **Bekannt, nicht geändert:** `advance` trägt den Überschuss über ein
  Segmentende als Anteil ins nächste Segment. Ein Schritt auf ein längeres
  Segment geht daher um bis zu das Längenverhältnis weiter, auf Band-Routen
  mit Stücken von 1 und 2 m bis zu einem Schritt mehr. Das war vorher so und
  ist von den Bögen unabhängig.

**Kosten** (Node ohne DOM, nicht eingecheckt; der Heap im Spiel verhält sich
anders, ein Chrome-Trace entscheidet):

- **Bögen bauen:** einmal je Pfad-Array. `CorridorBuild` baut sie in
  Schritt 6 für die Routen, die er einfriert, in Scheiben von `SLICE_MS`
  (32 ms) je Frame (`sizeRouteCorners`): `RouteCornerBuilder.step` hört
  nach jedem geprüften Bogen auf, wenn die Scheibe um ist. Die Gegner einer
  Welle, ihre Split-Kinder und die Segmente eines Wurms bekommen genau diese
  Arrays (`WaveManager` liest die Map von `PathAndRouteService`, ein
  Split-Kind den Pfad des Elternteils), HQ- und Spawn-Umzug bauen über
  `CorridorBuild`. Wer `RouteProfile.corners` vorher liest, baut den Rest
  am Stück. Snapshots, am Stück: Stuttgart (369 Waypoints, 650 m, 190
  Bögen) 140 bis 170 ms, Berlin (259 Waypoints, 445 m) 80 ms, Paris (258
  Waypoints, 477 m) 63 ms. In Scheiben: 6, 3 und 2 Scheiben, die längste
  33 bis 34 ms (die Scheibe plus ein Bogen; der teuerste einzelne Bogen 9,
  14 und 7 ms).
- **Nicht über `CorridorBuild`:** "Refresh terrain" in der DevWorld baut die
  Routen neu, ohne den Korridor zu bauen; deren Bögen baut der erste Gegner.
- **Sub-Step:** 10.000 Gegner, 300 Sub-Steps, Median aus sechs Läufen, auf
  der Stuttgarter Gegnerlinie (74 % der Strecke auf Bögen): 0,51 ms ohne
  Bögen (`roundsCorners` aus), 0,69 ms mit.

**Tests:**

- `utils/route-corners.spec.ts`: Radius gleich innerer Grenze, Innenseite
  entscheidet, spitze Ecken ohne Innenraum, fast gerade und bei Umkehr, ein
  Bogen über die Stücke einer Band-Ecke, Kurve aus zwölf Knicken von 7,5°,
  S-Kurve in zwei Bögen, kurzes Segment zwischen zwei Bögen geteilt, Kappen
  und Grenzen je Waypoint und Bogenende, Rücknahme höchstens `ARC_SHAVE_M`,
  gerade Route, einmal je Pfad und gleich für gleiche Waypoints, Bogen für
  Bogen dieselben Bögen wie am Stück.
- `services/world/corridor-build.spec.ts`: Schritt 6 baut die Bögen der
  Routen, die der Routenservice ausgibt, in mehreren Scheiben, und hört auf,
  wenn die Routen dabei ersetzt werden.
- `integration/route-corners-wave.scenario.spec.ts`: Gegner aus dem Portal,
  die Minions eines getöteten Skeletts und die Segmente eines Wurms laufen
  genau das Array, dessen Bögen vorher gebaut wurden, und die Bögen bleiben
  dasselbe Objekt.
- `game-components/movement.component.spec.ts`, "corner arcs": 90° nach
  rechts und links mit Faktoren -1, -0,5, 0, 0,5, 1 (Weg je Meter Fortschritt
  höchstens die Außenbahn des Bogens, Blickrichtung je Meter höchstens die
  Drehung des Bogens plus `atan(taper)` am Bogenende; vorher 4,3 m und 45°
  in einem Schritt), Formation (Mitte und Außenbahn laufen `π/2 · R` und
  `π/2 · (R + Grenze)`, alle drehen gleich), Fortschritt Schritt für Schritt
  gleich dem ohne Bögen, Stelle unabhängig von der Schrittlänge, Band-Ecke
  und Kurve ohne Sprung, S-Kurve, zwei Ecken an einem 2-m-Segment, jede Bahn
  Punkt für Punkt in der Grenze der spitzen Route an 60 Ecken (10° bis 170°,
  beide Richtungen, innen schmaler und breiter, 3 und 12 m Anlauf) und auf
  zwölf Zufallsrouten aus Stücken von 0,5 bis 3 m, Start auf dem Bogen,
  Held.
- `integration/route-corridor-coverage.spec.ts`, "on the arcs of corners":
  jede Stelle in einer Zelle des echten Grids an 40 Ecken (20° bis 160°,
  beide Richtungen, gleiche, einseitig schmale und wechselnde Breiten), an
  kurzen Segmenten (2-m-Versatz, drei Knicke von 45° im Abstand von 3 m,
  eine Ecke wie im Band mit 1-m-Stücken, Haarnadel), an zwei Ecken aus den
  Snapshots (Stuttgart 87°, Berlin 113°: je ein Bogen über mehrere Stücke,
  Radius mindestens die kleinste innere Grenze über seine Waypoints, keine
  Bahn schneller als das 2,5-Fache des Fortschritts; vorher 0,41 und 0,27 m
  Radius) und auf einer Kurve aus 20 Knicken von 6° alle 2 m.
- `services/debug/enemy-debug-placement.scenario.spec.ts`: Der platzierte
  Gegner läuft bis zum Bogen auf der Linie und geht `R · (√2 - 1)` an der Ecke
  vorbei.

## Wann gemessen und neu gebaut wird

`CorridorBuild` (`services/world/corridor-build.ts`) ist der einzige, der
Routen, Waypoints, Zellen, Zellhöhen, Freiraum und das begehbare Band
schreibt, getestet in `corridor-build.spec.ts`. Er baut den Korridor einmal
je Routensatz und friert ihn dann ein. Der Spieler sieht also den fertigen
Korridor, bevor er spielt, und danach ändert sich keiner mehr.

Ein Bau (`build`) läuft in dieser Reihenfolge:

1. **Tiles:** Region auf die feinste Stufe (`ROUTE_CORRIDOR_ERROR_TARGET`,
   2,5 m), die eigene Verfeinerung der Kamera stummgeschaltet
   (`MUTED_CAMERA_ERROR_TARGET`), dann warten, bis die Region ihr erstes Tile
   hält **und** 500 ms lang kein Tile mehr geladen hat (`waitForQuietTiles`).
   Beides zusammen, denn "nichts lädt" heißt nicht "alles ist da": Bevor der
   Renderer einmal traversiert hat, ist auch nichts angefragt. Solange nichts
   lädt und die Region leer ist, stupst der Bau den Renderer jede Sekunde an
   (`requestUpdate`); der traversiert von sich aus nur bei Kamerabewegung und
   Tile-Loads. Nach `TILES_TIMEOUT_MS` (30 s) baut er mit dem, was da ist,
   und schreibt `timedOut` in Log und Trace. Damit hängen die Tiles im
   Korridor an den Routen, nicht daran, wohin die Kamera gerade sieht.
2. **Messen:** jede Station einmal auf diesen Tiles, in Scheiben (unten),
   gegen einen geleerten Säulen-Cache.
3. **Rückfall für Stationen:** Stationen, für die es dort keine Säule gibt,
   bekommen die gröbere Stufe (`ROUTE_CORRIDOR_COARSE_ERROR_TARGET`, 5 m),
   dann geht es zurück auf die feinste.
4. **Bauen:** das begehbare Band jeder Route aus diesen Säulen
   (`PathAndRouteService.buildBands`, siehe Band), dann die Routen darin und
   ihre Zellen. Ein Durchgang, keine Schleife: Das Band liest die
   eingefrorenen Säulen, nicht die Zellen, es gibt also keinen Fixpunkt zu
   suchen. `MAX_PASSES`, die Zyklenerkennung über `walkState()` und
   `build.unsettled` sind mit der Kappen-Schleife weg. Der Trace schreibt
   `build.band` mit Routen, Stationen, Durchgängen, steilster Bewegung und
   engster Krümmung der Gegnerlinie.
5. **Rückfall für Zellen:** Zellen ohne Höhe bekommen dieselbe gröbere
   Stufe (`retryUnsampledCells`). Anders als bei den Stationen geht es danach
   nicht zurück auf die feinste Stufe (seit 2026-09-16): Rote Linie und
   Overlays lesen die Zellen, keine Säulen (die Linie liest die Säule am HQ
   nur für einen Punkt ohne Zellhöhe ringsum), und das Einfrieren setzt die
   Region ohnehin auf die grobe Stufe. Der Rückweg wartete mindestens
   `QUIET_MS` (500 ms) auf Tiles, auf denen niemand mehr misst; im Test auf
   der Uhr der Spec (16 ms je Frame) sinkt der Rückfall für Zellen von 1056
   auf 528 ms, der für Stationen bleibt bei 1056. Eine Zelle, die die
   feinste Stufe über zwei Nachbarn oder drei (siehe Zellhöhe, Lücken
   füllen) oder über die Straße des Bands (Portal ohne Treffer) füllt, zählt
   als Zelle mit Höhe und schickt den Bau nicht mehr auf die grobe Stufe.
6. **Einfrieren:** rote Linie auf den fertigen Zellen, die Bögen an den
   Ecken dieser Routen in Scheiben von `SLICE_MS` (siehe "Ecken", Kosten),
   Overlays, laufende Routenanimation neu; Kamera zurück, Region auf die
   grobe Stufe (5 m, siehe "Feine Tiles im Korridor").

Danach ändert nichts mehr Routen, Waypoints, Zellen oder Höhen: kein
Tile-Schub, keine Kamerafahrt, kein Tower. Erst der nächste Bau tut es.

Nach dem Bau einer Ortsladung rahmt `VisualizationFacadeService` den
Überblick neu, auf den eingefrorenen Zellen, stellt die Kamera dorthin und
speichert ihn als Startansicht (`CameraControlService.saveInitialPosition`,
Log `[Camera] corridor.cameraCorrection`). Bis 2026-09-16 standen Kamera und
Startansicht auf den Zellen des Schritts "Generating Route Grid", die der Bau
verwirft; Intro-Landung und Reset Camera rechneten ihn schon vorher frisch.
Der Rahmen nach den Höhen bleibt, er stellt nur die Karte hinter dem
Ladescreen während des Baus. Beim Umsetzen von HQ oder Spawn bleibt die
Kamera, wo der Spieler sie hat.

**Grenzfall Hintergrund-Tab:** Lädt ein Ort in einem Tab, den der Browser
nicht zeichnet, steht `requestAnimationFrame`. Der Renderer traversiert dann
nicht und fragt keine Tiles an, auch nicht die der Region. Der Bau wartet
seine 30 s ab, misst auf nichts und friert die OSM-Breiten ein; die Warnung
`no station found a tile` oder `no cell got a height` sagt es (siehe Logs),
und `CorridorBuild.frozeBlind()` merkt es sich.

Wird die Seite danach sichtbar, baut der Korridor von selbst noch einmal, nun
mit Tiles (`VisualizationFacadeService.rebuildAfterBlindBuild`, am
`visibilitychange` des Dokuments, Grund `visible after unmeasured freeze`).
Weil das in einer dichten Stadt Sekunden dauert und Tower und Wellen so lange
warten, steht dabei derselbe Hinweis über der Karte wie bei einem HQ-Umzug
(`RelocationStatusService`), mit den Schritten des Baus.

Höchstens ein Bau je eingefrorenem Bau: Solange er läuft, hält `pending()`
eine zweite Sichtbarkeitsmeldung ab, und danach ersetzt sein eigenes Ergebnis
den Merker. Friert auch er blind ein, bleibt der Merker stehen, und die
nächste Sichtbarkeitsmeldung versucht es noch einmal.

Der Merker gilt immer dem Bau, der gerade läuft: `expect()` löscht ihn, und
nur ein Einfrieren setzt ihn. Ein Bau, der vorher abbricht, lässt ihn also
auf `false` und nicht auf dem, was ein früherer Ort hinterließ.
`CorridorBuild` ist ein Singleton, und `dispose()` läuft erst beim Schließen
der Seite; ohne das überlebte ein blinder Ort den Ortswechsel, und die
nächste Sichtbarkeitsmeldung baute einen sauber gemessenen Korridor neu
(`review-corridor.md`).

Nicht, solange Tower stehen, eine Welle läuft oder Gegner auf der Karte sind
(`rebuildBlocker`): Deren LOS-Antworten, Zellen und Routen stehen auf dem
Korridor in Gebrauch. Das steht als `build.revisit built=false blocked=...`
im Trace, die Warnung im Log bleibt, und die nächste Sichtbarkeitsmeldung
versucht es wieder; das ist die Warteschlange auf den nächsten sicheren
Moment.

| Auslöser | Wann |
|---|---|
| Ortsladung | hinter dem Ladescreen, Schritt "Measuring the Corridor" nach "Finalizing 3D View" und vor dem Intro-Flug; die Wartezeit auf die Tiles steckt in diesem Schritt (einen Schritt "Waiting for 3D Tiles" gibt es seit 2026-09-16 nicht mehr) |
| HQ oder Spawn umsetzen ohne Neuladen | unter dem Hinweis "MOVING HQ" (`MapRelocationService`, `RelocationStatusService`) |
| `__corridor.set()`, `__corridor.reset()` | `change()`; bei geänderten `MEASUREMENT_KEYS` werden vorher alle Messungen verworfen |

Solange ein Bau läuft oder angekündigt ist (`pending()`), wartet alles, was
auf dem Korridor steht: `GameStateManager.placeTower` setzt keinen Tower,
`startWave` und `beginWave` starten keine Welle, der Trainings-Bot hält an
(`TrainingSession.updateBot`), und der Ladescreen bleibt stehen.
`__corridor.set()` wird unter Towern, einer laufenden Welle oder Gegnern
abgelehnt (`rebuildBlocker`): Tower halten ihre LOS-Antworten in den Zellen,
die ein Bau ersetzt, Gegner ihre Zelle und ihre Route.

Beim Umsetzen von Spawn oder HQ entsteht die Route neu aus den vorhandenen
Messungen: Ein Segment, das die neue Route mit der alten teilt, behält seine
Messung. Beim HQ beginnt der Routen-Dienst von vorn, dort ist nichts
gemessen.

Ein Bau, den ein neuer überholt (`superseded`), oder einer, dem der
Routendienst die Routen unter den Füßen wegzieht (`routes replaced`), hört
auf, ohne einzufrieren; Kamera und Region bekommen ihre Werte trotzdem
zurück. Ein Bau, der einen anderen überholt, hält die Kamera stumm, bis er
selbst fertig ist.

### In Scheiben

Gemessen wird nicht am Stück, sondern je Frame so viele Stationen, wie in
`SLICE_MS` (32 ms) passen (`CorridorBuild`). Der Ladescreen oder der Hinweis
über der Karte steht dabei, sonst wartet niemand auf diese Frames, und der
Balken bewegt sich weiter.

- **Budget:** Eine Station (Säule und vier Strahlen) kostete an den fünf
  Orten vom 2026-09-16 zwischen 0,6 und 1,9 ms; 32 ms sind dort etwa 17 bis
  50 Stationen je Frame. Der Lauf hört vor der Station auf, die nach den
  bisherigen Kosten je Station über das Budget ginge, nimmt aber mindestens
  eine Station je Frame. Bis 2026-09-16 waren es 4 ms im Hintergrund und
  32 ms unter dem Umzugs-Hinweis; jetzt wartet ohnehin immer jemand, also
  gilt überall dasselbe Budget.
- **Fortschritt:** Nach jeder Scheibe meldet der Bau Schritt und Prozent
  (`CorridorProgress`): am Ladescreen unter "Measuring the Corridor", beim
  Umzug im Hinweis "MOVING HQ".
- **Gleiches Ergebnis:** Der Lauf nimmt die Stationen in derselben
  Reihenfolge und mit denselben Strahlen wie ein Lauf am Stück und legt sie
  in dieselben Felder. `path-route.service.spec.ts` ("in slices") vergleicht
  Strahlen, Korridor und Log beider Wege.
- **Korridor bis zum Ende unverändert:** Bis zum Ende des Laufs bauen Routen
  und Zellen mit dem Korridor von vorher; gespeichert wird beim Commit.
- **Kein Flush mehr:** Tower und Welle warten auf das Einfrieren
  (`corridorPending`), statt einen offenen Lauf am Stück zu Ende bringen zu
  lassen. Den Haken `setBeforeCorridorLock` gibt es nicht mehr.
- **Abbruch:** Ein neuer Bau (`superseded`), ersetzte Routen
  (`routes replaced`) und `dispose` beenden den Lauf, ohne einzufrieren.
- **Konsole:** `__corridor.set()` und `reset()` bauen über denselben Weg; die
  Konsole wartet auf die Antwort.

### Logs

Alle Zeilen hier sind `console.log`, keine Warnungen: Chrome hängt an jede
Warnung einen aufklappbaren Stack, im Log Berlin vom 2026-09-15 etwa
192.000 von 206.000 Zeilen, bis DevTools aufgab (bis 2026-09-16 waren
`[Corridor]` und `[PerfTrace]` Warnungen). Warnungen und Fehler bleiben für
echte Probleme. Die `[PerfTrace]`-Zeilen je Tile-Schub
(`onTilesLoadCallback`, `onTilesLoaded`) sind seitdem aus;
`__perf.trace(true)` schaltet sie an, `__perf.trace(false)` wieder aus
(`utils/perf-trace.ts`). Die `[Corridor]`-Zeilen unten bleiben an.

```
[Corridor] build: reason= tiles= measure= fallback= band=N () corners= lines= wall=ms stations= unmeasured= cells= [tiles timed out]
[Corridor] build: no station found a tile (N stations[, and the tiles never settled]). ...   (console.warn)
[Corridor] build: no cell got a height (N cells[, and the tiles never settled]). ...         (console.warn)
[Corridor] clearance: segments= stations= unmeasured= (coarse tile N) rays= changed= in X ms slices= wall= ms [noTile=x,z;x,z;...]
[Corridor] clearance cancelled (Grund): stations=N of M in X ms slices= wall= ms, corridor unchanged
```

- **`clearance`** (`ClearanceRun.commit` in `path-route.service.ts`):
  erscheint am Ende eines Laufs, der mindestens ein Segment angefasst hat.
  - `stations`: die in diesem Lauf versuchten Stationen.
  - `rays`: 2 Strahlhöhen × 2 Seiten × gemessene Stationen; die Säulen unter
    der Station, am Brückenende und hinter einem niedrigen Hindernis sind
    nicht mitgezählt.
  - `in`: Rechenzeit des Laufs im Hauptthread, alle Scheiben samt Vergleich
    am Ende. So lange hätte der Lauf am Stück blockiert; vergleichbar mit den
    Zahlen von vor dem Stückeln.
  - `slices`: Scheiben, eine je Frame. `wall`: Zeit vom Start bis zum Ende
    des Laufs.
  - `noTile`: nur wenn Stationen auch 0,5 m voraus und zurück kein Tile
    fanden. Ihre lokalen `x,z` (wie `[Corridor] pick at` sie druckt), mit `;`
    getrennt, höchstens zehn, dahinter `;+N` für den Rest. Dort lohnt
    `__corridor.pick()`.
  - `__raycastStats()` bucht die Strahlen und die Säulenprobe unter
    `routeCorridor` (`TerrainQueries.measureStreetClearance`).
- **`clearance cancelled`** (`ClearanceRun.cancel`): Ein Lauf wurde verworfen, der
  Korridor bleibt, wie er war. Der Grund ist einer der Sperrgründe
  (`enemies are on the map`, sonst `towers stand on the map, sell them first`
  oder `a wave is running`) oder `routes replaced`, `location changed`,
  `measurements cleared`, `settings changed`, `superseded`, `disposed`,
  `intro flight`.
  `stations=N of M`: so weit kam er.
- **`build`** (`CorridorBuild.build`): eine Zeile je Bau, der eingefroren
  hat. `reason` ist sein Auslöser, `tiles` die Wartezeit auf die Tiles der
  Region, `measure` die Rechenzeit aller Messscheiben, `fallback` die
  Wechsel auf die gröbere Stufe (für Stationen hin und zurück, für Zellen
  nur hin), `band=N ()` die Stationen des Bands samt
  der Zeit für Band, Routen und Zellen, `corners` die Rechenzeit aller
  Scheiben der Bögen an den Ecken, `lines` die rote Linie am Ende,
  `wall` die ganze Dauer vom Aufruf bis zum Einfrieren; dazu `stations`,
  `unmeasured`, `cells` und, wenn die Tiles nicht ruhig wurden,
  `tiles timed out`. Ein Bau, der aufhört, ohne einzufrieren, schreibt keine
  Zeile und steht nur als `build.cancel` im Trace.
- **`build: no station found a tile`** und **`build: no cell got a height`**
  (`console.warn`, dazu `build.notiles` im Trace): Der Bau maß auf nichts,
  entweder hatte keine Station ein Tile oder keine Zelle bekam eine Höhe.
  Jede Route behält dann die Breite aus ihren OSM-Tags, und der Korridor
  friert so ein, bis ein neuer Bau läuft. Darum eine Warnung und kein
  Hinweis. Gesehen im Browser-Check vom 2026-09-16 in einem Hintergrund-Tab
  (siehe "Grenzfall Hintergrund-Tab" oben); sonst deutet die Zeile auf Tiles,
  die gar nicht laden (Token, Netz, voller Cache).
- **Gemessen** (Playtest 2026-09-12, Innenstadt, eine Route, Punkt 52 in
  archive/REVIEW_SPRINT_2026-09-12, noch am Stück): Neuaufbau 39,5 bis 41,7 ms; die
  Messung davor mit 1260 Strahlen 520 bis 533 ms. Weitere Orte sind nicht
  gemessen.

### Trace

`[CorridorTrace]` (`utils/corridor-trace.ts`) ist ein eigener Konsolenkanal
für alles, was Korridor, Zellen, Zellhöhen, Waypoints oder rote Linie ändert
oder ändern kann: wer, warum, auf welchen Tiles, was sich geändert hat. Er
ändert kein Verhalten; die Zeilen oben (`[Corridor]`, `[PerfTrace]`) behalten
ihren Text. `console.log`, eine Zeile je Ereignis; die ganze Tabelle nur mit
`__corridor.trace()`. An in Dev-Builds, aus in Production-Builds und unter
vitest (Specs schalten ihn selbst ein).

```
[CorridorTrace] 12.35s clearance.commit segments=20 stations=236 ... changed=true lod=2m:0,2.5m:236,5m:0,coarse:0,none:0 ... | build location load
[CorridorTrace] LONG 12.35s build.band routes=1 stations=236 passages=0 cells=1204 ms=183.5 | build location load
```

- **Zeit:** Sekunden seit dem Laden des Orts: Seitenaufruf,
  `LocationChangeExecutor` Schritt 1 oder ein HQ-Umzug mit neuem Ursprung
  (`MapRelocationService`). Ein Umsetzen ohne Neuladen läuft weiter.
- **Ereignis**, dann seine Zahlen als `name=wert`.
- **Auslöser** nach `|`: die Kette der Aufrufer und Gründe, der älteste
  zuerst. Ein Bau trägt seinen Grund als `build <reason>`, und die Frames,
  auf die er wartet, tragen die Kette weiter. Seine Schritte tragen ihr
  Label: `build location load -> pass 1`, `-> last plan`, `-> lines`. Wo
  keine Kette hinführt, steht `caller` mit den zwei Funktionen über dem
  Ereignis (im Production-Build minifiziert).
- **`LONG`:** ein Schritt, der in einem Frame länger lief als sein Budget:
  `build.band`, `rebuild`, `grid.generate`, `clearance.commit`,
  `routes.refresh`, `tilesLoaded` gegen 16 ms (`LONG_STEP_MS`),
  `clearance.slice` gegen das Budget der Scheibe selbst
  (`CorridorBuild.SLICE_MS`, 32 ms). Bis 2026-09-16 galten für alle 16 ms;
  damit war jede Messscheibe `LONG`, 15 bis 33 Zeilen je Ortsladung, die
  nichts meldeten außer der Absicht.

| Ereignis | Wo | Zahlen |
|---|---|---|
| `load` | Beginn eines Orts | `label` |
| `tiles` | `VisualizationFacadeService.onTilesLoaded`, je beruhigtem Tile-Schub | `lod` (lodVersion); aktive Tiles, die die Region (`RouteCorridorRegion.lodState`) erreichen: `tiles`, `fine` (bis zum Fehlerziel der Region, im Bau 2,5 m, sonst 5 m, oder Blatt), `finest` (bis 2 m), `coarse` (gröber und noch zu verfeinern); `tileSet`: welche der `fine`-Tiles das sind, 8 Hex-Ziffern über ihre Content-Pfade ohne Query (die trägt die Session), gleich heißt dieselben feinen Tiles. Die `coarse`-Eltern gehen seit 2026-09-16 nicht mehr ein: Wie viele davon noch aktiv sind, schwankt von Ladung zu Ladung (Tokyo, derselbe Korridor: `fine=181` beide Male, `coarse=20` frisch und 14 nach Ortswechsel und `reset()`, damit zwei Hashes); `pending`: Tiles in Warteschlange, Download oder beim Parsen, überall |
| `region.complete` | das erste Mal je Ort `coarse=0` | `tiles`, `finest` |
| `build.start` | Beginn eines Baus (`CorridorBuild.build`) | `reason`, `tiles` (es gibt 3D-Tiles; in DevWorld false) |
| `build.tiles` | die Tiles der Region sind ruhig, oder der Timeout ist um | `target` (Fehlerziel der Region, m), `loadS`, `timedOut`, dazu der Stand der Region (`lodState`) |
| `build.fallback` | ein Wechsel auf die gröbere Stufe (für Stationen und zurück) | `what`: `stations` oder `cells`; `missing`, `found`; für Zellen `why`: wie viele aus welchem Grund ohne Höhe waren, bevor die gröbere Stufe probte (unten) |
| `build.band` | das Band aller Routen, dann Routen und Zellen (Schritt 4) | `routes`, `stations`, `passages`, `maxSlopeM`, `maxCurvature`, `cells`, `ms` |
| `build.notiles` | der Bau maß auf nichts: keine Station mit Tile oder keine Zelle mit Höhe; der Korridor friert mit den OSM-Breiten ein | `stations`, `unmeasured`, `cells`, `bare` (Zellen ohne eigene Höhe), `timedOut` |
| `build.revisit` | die Seite wurde sichtbar und der Korridor war auf nichts gebaut (`rebuildAfterBlindBuild`) | `built`: ob ein Bau startete; `blocked`: die Sperre, wenn nicht |
| `build.cancel` | der Bau hört auf, ohne einzufrieren | `reason`: `superseded` oder `routes replaced` |
| `build.freeze` | Ende eines Baus, der eingefroren hat | wie die `[Corridor] build`-Zeile: `stations`, `unmeasured`, `bandStations`, `passages`, `timedOut`, `fallbackStations`, `fallbackCells`, `cells`, `cellsWithoutHeight`, `ms`, dazu `tilesMs`, `measureMs`, `fallbackMs`, `buildMs`, `cornersMs`; nur wenn Zellen ohne Höhe bleiben `why` (Gründe, unten) und `at` (lokale `x,z` der ersten zehn, `;+N` für den Rest) |
| `build.change` | `__corridor.set()` und `reset()` | `remeasure` (die Änderung braucht eine neue Messung) |
| `routes.refresh` | jeder Neuaufbau der roten Linie (`PathAndRouteService.refreshRouteLines`) | `spawns`, `waypoints`, `ms` |
| `routeAnimation.start` | jeder Start der Routen-Animation (`RouteAnimationService.startAnimation`), der ihren Strich-Versatz zurücksetzt | `routes`, `restart` (lief schon) |
| `clearance.start`, `clearance.commit`, `clearance.cancel` | `ClearanceRun`, auch ein Lauf ohne Segmente, für den `[Corridor] clearance` nichts schreibt | `segments`, `stations`, `rays`, `changed`, `lod`, `slices`, `budgetMs` (die Budgets der Scheiben, in einem Bau `32`), `overBudget` (Scheiben länger als ihr Budget: eine Scheibe nimmt mindestens eine Station), `maxSliceMs`, `meanSliceMs`, `msPerStation`, `busyMs`, `wallMs`; `reason` |
| `store` | `storeClearance` | `changed` (eine Breite hat sich geändert), `by`: `measured`, wenn der Lauf Freiraum brachte, den der Korridor nicht hatte; `segments`, `ms` (die ganze Übergabe) |
| `grid.generate` | `GlobalRouteGrid.generateFromRoutes` | `cells`, `routes`, `ms` |
| `rebuild` | Ende eines Baus, Delta über den ganzen Bau (`CorridorBuild`) | Delta, unten |
| `intro.*`, `loading.done`, `heights.*` | aus der Kamera-Zeitleiste (`cameraTimeline`): Intro-Phasen, Ladeschirm-Gate (`intro.gateOpen`), Höhen-Update | wie dort, Auslöser `camera timeline` |

**`why`** (`why=noColumn:5,refused:2`, `GlobalRouteGrid.describeCellsWithoutHeight`):
warum der letzte Versuch einer Zelle keine eigene Höhe gab
(`RouteCellSampler.lastMiss`). `noColumn`: keine Säule an der Zelle und
0,5 m daneben (kein Tile dort, oder ein Mesh, von dem die Säulen nichts
treffen); `refused`: Säulen mit Treffern, die die Nachbarn ablehnten
(Ausreißer); `noPortal`: ein Tunnelportal ohne Säule und ohne Straße des
Bands; `noApproachStart`: keine Säule am Anfang der Strecke, von dem die Höhe
getragen wird (Brückenende, Beginn des Endstücks zum HQ). Gezählt werden nur Zellen ohne Höhe, gefüllte nicht.

**`lod`** (`lod=2m:12,2.5m:200,5m:4,coarse:0,none:24`): die Säulen, die ein
Lauf je Station benutzt hat, nach dem geometricError ihres Tiles: bis 2 m
(feiner als die Region verlangt), bis 2,5 m (die feinste Stufe, auf der ein
Bau misst), bis 5 m (die Rückfallstufe und `maxTileError`), gröber, ohne
Tile. Ein Bau misst auf 2,5 m; `5m:` über 0 sind die Stationen, die erst der
Rückfall gemessen hat.

**Delta eines Neuaufbaus** (`rebuild`). Vor und nach dem Neuaufbau je ein
Schnappschuss: Höhe je Zelle (`GlobalRouteGrid.snapshotHeights`), die
Halbbreiten links und rechts alle 2 m entlang jeder Route aus den Waypoints
(`widthProfile`), die Zahl der Waypoints.

- `by`: welche Daten seit dem letzten Bau neu sind: `measured`
  (neuer Freiraum aus den Strahlen), `band` (das Band ist neu gebaut),
  `settings` (`__corridor.set()`); `none`.
- `rays`: Strahlen aller Läufe seit dem letzten Bau. `rays=0` mit
  `by=band` ist ein Bau ohne neue Messung.
- `cells` alt->neu, `added`, `removed`, `moved` (mehr als 0,25 m,
  `HEIGHT_MOVE_M`), `maxMoveM`, `lostHeight`, `gotHeight`.
- `widthPoints`: Punkte mit anderer Halbbreite / verglichene Punkte; ein
  Punkt, den nur einer der beiden hat (Route länger oder kürzer), zählt als
  geändert. `maxWidthChangeM`.
- `waypoints` alt->neu, `bands` (Routen mit Band), `spawns`, `ms` (Bau und
  Linien), `deltaMs` (das Delta selbst).

**Kosten** (Spec unter Node, `corridor-trace.spec.ts`, "cost"): beide
Schnappschüsse und das Delta für 1204 Zellen und 1194 Breitenpunkte
0,17 ms je Neuaufbau; die Spec verlangt unter 5 ms. Im Browser nicht
gemessen. Für `by` passt `storeClearance` die Korridore nicht noch einmal
an, es vergleicht Freiraum und Kappen vor und nach dem Speichern, je Station
ein Zahlenvergleich; ob sich eine Breite geändert hat, sagen `changed` und das
Delta des `rebuild`. Die `ms` der `store`-Zeile sind die ganze Übergabe
samt der beiden Anpassungen, die sie ohnehin rechnet. Die Zählung der Region je Tile-Schub kostet O(aktive Tiles ×
Segmente), nicht gemessen.

**Lesen:**

- Wer hat den Korridor geändert: die `rebuild`-Zeilen, `by`, `rays` und
  die Kette. `by=band` ohne `measured` ist ein Bau, der auf denselben
  Messungen ein neues Band gelegt hat; `by=settings` kommt von
  `__corridor.set()`.
- Auf welchen Tiles: `lod` in `clearance.commit`; `2m:` über 0 heißt,
  feinere Tiles als die Region (Kamera, Zoom) sind eingeflossen.
  `region.complete` sagt, wann die Region zum ersten Mal ganz verfeinert war.
- Warum ein Bau nicht eingefroren hat: `build.cancel reason=superseded` oder
  `routes replaced`. Was das Band ergab: `build.band` mit Routen, Stationen,
  Durchgängen, steilster Bewegung und engster Krümmung der Gegnerlinie.
- Welcher Frame hängt: `[CorridorTrace] LONG`. Eine Messscheibe steht dort
  nur, wenn sie über ihr eigenes Budget lief; ob die Messung es insgesamt
  hält, sagen `overBudget` und `msPerStation` in `clearance.commit`.
- Was die rote Linie neu baut: `routes.refresh` mit seinem Auslöser. Nach
  dem Einfrieren darf keine Zeile mehr kommen, bis der nächste Bau läuft;
  jede dort ist ein Neubau, den niemand bestellt hat. Dasselbe gilt für
  `grid.generate` und `routeAnimation.start`.

```js
__corridor.trace()        // Zeitleiste dieser Ortsladung als Tabelle (console.table)
__corridor.trace(false)   // Kanal aus; __corridor.trace(true) wieder an
```

Die Zeitleiste hält höchstens 5000 Einträge (`MAX_ENTRIES`), die ältesten
fallen heraus.

## Feine Tiles im Korridor

Die Tile-Region `RouteCorridorRegion` (`three-engine/route-corridor-region.ts`)
hält Tiles bis 20 m neben den Routensegmenten aktiv, auch außerhalb des
Bildes (`ROUTE_CORRIDOR_HALF_WIDTH` und `setRouteCorridor()` in
`three-tiles-engine.ts`). Daher die Vorgabe `maxTileError` 5 und die
Obergrenze 15 für `maxHalfWidth`: Weiter als 20 m neben der Route gibt es
keine garantiert feinen Tiles.

Zwei Stufen:

- **Bau:** 2,5 m (`ROUTE_CORRIDOR_ERROR_TARGET`), die feinste Stufe, die die
  Tiles haben. Nur ein Bau hält sie, und nur, solange er misst.
- **Ruhe:** 5 m (`ROUTE_CORRIDOR_COARSE_ERROR_TARGET`), sobald der Bau
  einfriert (`CorridorBuild.unmute`). Der eingefrorene Korridor probt keine
  Zelle mehr, feine Tiles braucht dafür niemand. 2,5 m die ganze Sitzung zu
  halten kostete nach Phase 0 39 bis 166 MB aktive Tiles.

Die Region selbst bleibt aber bestehen, denn der Renderer aktiviert nur, was
im Kamera-Frustum liegt, und Strahlen treffen nur aktive Tiles. Zwei Dinge
brauchen die Korridor-Tiles auch lange nach dem Einfrieren und egal, wohin
die Kamera sieht: die Cubemap der Tower-LOS, die die Tiles-Gruppe vom
Tower-Tip aus rendert (bei jeder Platzierung, jedem Reichweiten-Upgrade und
der Forschung mit Luftzielen), und der CPU-Rückfall des Kampfes, wo eine
Zelle keine Antwort hält (`TerrainQueries.raycastLineOfSight`). Beide
brauchen Geometrie, die da ist, nicht feine Geometrie; die grobe Stufe
genügt ihnen.

## Diagnose

### `__corridor` (DevTools)

Registriert in `CorridorConsole.install` (`services/debug/corridor-console.ts`),
aufgerufen aus `VisualizationFacadeService.initialize`.

```js
__corridor.get()                                        // alle Werte
__corridor.set({ maxHalfWidth: 5 })                     // ändern und neu bauen
__corridor.set({ bulgeLength: 14, dipLength: 6 })       // mehrere auf einmal
__corridor.set({ highwayWidths: { residential: 7 } })   // ergänzt die Tabelle
__corridor.reset()                                      // zurück auf CORRIDOR_DEFAULTS
__corridor.towerCells()                                 // Zellen in Reichweite des ausgewählten Towers
__corridor.towerCells('<towerId>')
__corridor.pick()                                       // nächster Linksklick auf die Karte, Radius 4 m
__corridor.pick(6)
__corridor.report()                                     // Zellbericht: Zellen wählen, JSON kopieren
__corridor.probeLod()                                   // Region auf 5, 2,5 und 0 m laden und messen, Bericht in die Zwischenablage (Phase 0)
__corridor.probeLod([5, 0], 90)                         // eigene Ziele, höchstens 90 s Warten je Ziel
__corridor.fingerprint()                                // Hash über den Korridor in Gebrauch (Phase 0)
__tiles.stats()                                         // Tiles, Cache, Downloads, beide Fehlerziele
__corridor.trace()                                      // Zeitleiste des Korridor-Trace, siehe Logs, Trace
__corridor.trace(false)                                 // Trace aus, trace(true) an
__corridor.snapshot()                                   // alles zum Korridor als eine JSON-Datei (Download), wie die Kachel Snapshot
```

- **`set` und `reset`** geben `Not changed: ...` zurück, wenn kein Ort geladen
  ist, die Sperre greift oder ein Wert abgelehnt wird (unbekannter Name, Wert
  außerhalb des Bereichs, Minimum über Maximum). Sonst kommt
  `Corridor rebuilt[, measured again]: N cells. Widths per stretch: __routes.describe()`
  zurück (`CorridorBuild.change`).
  - Die Werte gelten bis zum Neuladen der Seite; dauerhaft heißt
    `CORRIDOR_DEFAULTS` im Code ändern.
- **`towerCells`** gibt eine Tabelle zum Tower zurück (`CorridorConsole.describeTowerCells`):
  - Zellen in Reichweite: `cells`, `unsampled`.
  - Antworten des Towers: `groundVisible`/`Blocked`/`Missing`, dasselbe für
    `air`.
  - Auffällige Zellen: `holes`, `raised` (mehr als 1 m über dem Median der
    Nachbarn), `unwalkable` (Zellen neben dem Band, die der Korridor
    trotzdem hält, siehe Band).
  - Die Mittellinie für sich: `centreCells`, `centreMissing`,
    `centreUnsampled`, `centreBlocked`, `centreRaised`,
    `centreNotDisplayed`.
  - Die LOS-Anzeige: `displayed`, `displayOutdated`, `notDisplayed`,
    `cubeFromTower`.

  Deutung der Felder (die Anzeige zeichnet nur Zellen mit Höhenprobe und ist
  ein Schnappschuss, neu erst beim nächsten LOS-Recompute des Towers):

  | Feld | Deutung |
  |---|---|
  | `unsampled` > 0 | diese Zellen fehlen in der Anzeige |
  | `groundMissing` > 0 | dort prüft das Targeting per CPU-Raycast statt nachzuschlagen; die Anzeige liest die Antworten nicht |
  | `airMissing` | bei reinen Boden-Towern gleich `cells` |
  | `holes` > 0 | widerspräche dem Test "leaves no hole in the corridor at any heading" (`global-route-grid.spec.ts`); Liste in `holeCells` |
  | `raised` > 0 | Zellen auf Autodach oder Krone, ihre Platte schwebt und erscheint aus schräger Kamera versetzt; Liste in `raisedCells` (x, z, Meter über den Nachbarn, höchstens 20) |
  | `unwalkable` > 0 | ein feineres Tile zeigte sie erst, als Tower standen (siehe Band) |
  | `centreMissing` > 0 | widerspräche den Tests zur Mittelreihe; Liste in `centreMissingCells` |
  | `centreUnsampled`, `centreBlocked`, `centreRaised`, `centreNotDisplayed` | woran eine fehlende Reihe entlang der roten Linie liegt |
  | `displayOutdated` > 0 | Grid neu gebaut, Anzeige nicht |
  | `notDisplayed` > 0 | die Anzeige ist ein alter Schnappschuss |
  | `cubeFromTower` false | bleibt nur, wenn die Anzeige die geteilte Cubemap nicht zurückholt |

  Die Koordinaten aus `holeCells` und `raisedCells` zeigt
  `__rg.dumpCellsInBox({ xMin, xMax, zMin, zMax })` genauer. Herkunft der
  Felder: Playtest 2026-09-12, [ROUTE_GEOMETRY_ANALYSIS.md](archive/ROUTE_GEOMETRY_ANALYSIS.md).
- **`pick`** nimmt den nächsten Linksklick auf die Karte, ohne etwas auszuwählen
  oder zu bauen (`InputHandlerService.armPick`).
  Danach stehen drei Ausgaben in der Konsole.
  1. `[Corridor] pick at x,z: N spots within r m`: je Rasterstelle im Umkreis,
     die nächste zur Mittellinie zuerst (`RouteCellProbe`,
     `route-grid-diagnostics.ts`).
     - Lage und Zelle: `routeM`, `cell`, `state`, `heightM`, `walkable`
       (`cellWalkable`; `false`: die Zelle liegt neben dem Band), `walkCheck`
       (warum: `band`, `beyond the band`, `roof`, `step`, `drop`, `hollow`
       (Auto hohl im Mesh), `passage` (Zelle eines Durchgangs),
       `fixed stretch` (Brücke, Tunnel, Brückenstrecke, Endstück zum HQ),
       `deck or tunnel`, `coarse tile`, `no sample`, `no band`),
       `overLineM` (Höhe über dem Rückgrat der Station), `aboveNeighboursM`,
       `surface`.
     - Antworten und Anzeige des ausgewählten Towers: `ground`, `air`,
       `displayed`.
     - Was über der Stelle liegt und ob die Kamera sie sieht (`coverAt`,
       `corridor-console.ts`): `columnBottomM` und `columnTopM`, unterste
       und oberste Fläche der Säule (feinstes Tile, wie die Zellen sie
       proben); `overM`, wie weit die oberste über der Zelle liegt
       (Brückendeck, Dach, Krone); `cameraSees`, ob die Gerade von der
       Kamera zum Punkt in Linienhöhe über der Zelle frei von Tiles ist
       (`PathAndRouteService.routeLineLift`: 1 m, in DevWorld 3 m). Über
       einer Zelle der Mittellinie läuft dort die rote Linie; die Linie
       liegt nur auf der Mittellinie, daneben steht der Punkt für die
       Gegner auf der Zelle. `false` heißt: Linie und Gegner auf dieser
       Zelle sind von hier aus verdeckt.
  2. `[Corridor] column at the click` (`TerrainQueries.inspectColumn`, nicht
     in DevWorld): die Säule an der Klickstelle, `cached` wie der
     Säulen-Cache sie hält (das lesen Zellen und Overlay), `fresh` aus einem
     neuen Strahl durch die Mitte derselben Säule (`columnCentre`, siehe
     Zellhöhe), und unter `hits` jeder Treffer dieses Strahls als
     Höhe@Tiefe/geometricError, von oben. Unterscheidet eine Straße unter
     einem Deck, die kein Treffer zeigt, eine nur in einem gröberen Tile
     (verworfen) und eine, die der Cache noch nicht kennt (siehe Befund
     Erlenbach).
  3. `[Corridor] width at the nearest route station`: woher die Breite an der
     nächsten Station kommt (`explainCorridorAt`,
     `path-route.service.ts`).
     - Die Station: Way, `tags` (`width`, `lanes`, `bridge`, `tunnel`,
       `covered`, `layer` wie in `__routes.describe()`), `streetWidthM`, `widthSource`, `onStreet`,
       `inTunnel`, `underWay` (der Way über einem Stück unter einer fremden Brücke, sonst null),
       `backboneM` und `backboneY` (Versatz und Höhe des Rückgrats),
       `bandLeftM` und `bandRightM` (Bandkanten, Versatz zur OSM-Linie),
       `bandKind` (`band`, `climb`, `passage`, `fixed`),
       `detourM` (wie weit die Gegnerlinie dort neben der OSM-Linie läuft,
       rechts positiv, sonst null), `passage` (in einem Durchgang),
       `unmeasured`, `tileError`, am Ende `shiftM` (wie weit
       entlang der Route die Station neben einer Naht gemessen wurde, sonst
       null).
     - Je Seite eine Zeile: `lowHitM`, `highHitM`, `lowRiseM` (wo nur der
       untere Strahl stoppte: wie hoch die Säule 1 m hinter seinem Treffer
       über dem Boden der Station liegt, sonst null), `wall`, `freeM`,
       `smoothedM`, `halfWidthM` (was die Strahlen erlauben), `inUseM` (die
       Bandkante ab der Gegnerlinie, wie die Route sie hält) und `rule`.
     - Eine Tabelle mit den vier Stationen davor und danach; `leftM` und
       `rightM` sind die Halbbreiten der Stücke dort.

  `rule` nennt die Regeln, die gegriffen haben, auch mehrere
  (`bulge cut, wall less margin`):
  - aus der Messung: `low obstacle, raised behind` (niedriges Hindernis),
    `dip closed`, `bulge cut`, `wall less margin`,
    `no wall within the maximum`, `minimum`, `leg to the HQ: street width`,
    angehängt `overhang: outer face` (siehe Auskragung);
  - ohne Messung: `unmeasured: from neighbours` (kurze Lücke, gefolgt von
    den Regeln oben), `unmeasured: street width`,
    `tunnel or covered: street width`, `under way N: street width` (unter
    einer fremden Brücke, N der Way darüber; `unmeasured` dort
    `under way N: not measured`), `not measured yet: street width`;
  - danach, über die fertigen Stücke: `short narrowing closed`. Wie weit der
    Korridor dort wirklich reicht, sagen die Bandkanten (siehe Band).
- **`report`** schaltet den Zellbericht ein, wie die Kachel Cells in den
  Entwickleroptionen, Gruppe Waves & Inspect (`CellReportService`,
  `debug/cell-report.service.ts`). Solange er an ist:
  - Linksklick auf die Karte nimmt die Rasterzelle dort in die Auswahl oder
    wieder heraus, auch eine Stelle ohne Zelle (eine Lücke). Shift +
    Linksziehen nimmt alle Zellen dazu, deren Mitte im Rechteck auf dem
    Bildschirm liegt, auch hinter Häusern; das Rechteck folgt gestrichelt.
    Ziehen ohne Shift, rechte Taste und Mausrad bewegen die Kamera wie sonst,
    nur Shift + Linksziehen dreht sie in dieser Zeit nicht
    (`InputHandlerService.setCellReportCallbacks`). Höchstens 100 Zellen
    (`MAX_REPORT_CELLS`).
  - Die Auswahl trägt einen orangen Rahmen über der ganzen Zelle, über dem
    Route Grid Overlay und auch ohne es (`RouteGridSelectionViz`,
    `GlobalRouteGridService.showCellSelection`).
  - Das Panel oben in der Mitte zeigt die Zahl der Zellen, nimmt eine Notiz
    und hat Copy JSON, Clear und Done. Esc (auch im Notizfeld) oder Done
    beenden den Bericht, Auswahl und Notiz bleiben bis Clear, bis zu einem
    HQ an anderer Stelle oder bis zum Neuladen.
  - Grenzen: Touch ist nicht behandelt. Copy JSON liest die Zellen im
    Hauptthread (je Zelle zwei Cover-Strahlen, eine frische Säule und
    `explainCorridorAt` über alle Stationen); wie lange das für 100 Zellen
    dauert, ist nicht gemessen.

  Copy JSON liest jede Zelle so, wie `pick` einen Klick auf ihre Mitte liest
  (`CorridorConsole.describeCells`), und legt das Ergebnis in die
  Zwischenablage. Lehnt der Browser das ab, steht es in der Konsole, und das
  Panel sagt es. Aufbau (`buildCellReport`, `debug/cell-report.ts`; Zahlen
  auf 2 Stellen, eine Zeile je Station und je Zelle, im Test mit 30 Zellen
  unter 50 kB):
  - `meta`: `time`, `url` (ohne Parameter, deren Name nach Schlüssel oder
    Token klingt), `version`, `location`, `effects` (Preset oder `custom`),
    `corridor` (nur Werte, die von `CORRIDOR_DEFAULTS` abweichen), `tower`
    (dessen Antworten die Zeilen tragen), `routes`, `cells`. Kein
    Tile-Token, kein API-Key, nichts aus `3dtd-tile-credentials`. Einen
    Git-Commit gibt der Build nicht her, er fehlt.
  - `note`: die Notiz.
  - `stations`: jede Station einmal, Schlüssel `Route Station`, mit dem, was
    `explainCorridorAt` liefert, außer den Stationen daneben (`nearby`).
  - `cells`: je Zelle die Felder der `pick`-Tabelle (Ausgabe 1 oben, mit
    `coverAt`), dazu `geo` (lat,lon der Mitte), `nb` (die acht Nachbarn als
    `"dx,dz": [heightM, walkable]` in Zellen entlang lokal x und z, `null`
    ohne Zelle), `column` (wie Ausgabe 2), `station` (Schlüssel in
    `stations`) und `stationM` (Abstand zur Station).
- **`snapshot`** speichert alles zum Korridor dieses Orts als eine JSON-Datei
  im Download-Ordner, wie ein Klick auf die Kachel Snapshot in den
  Entwickleroptionen, Gruppe Waves & Inspect (`CorridorSnapshotService`,
  `debug/corridor-snapshot.service.ts`). Gedacht für zwei Ladungen desselben
  Orts, eine nach dem Seitenaufruf, eine im Spiel hinnavigiert. Unter den
  Kacheln steht der Fortschritt, am Ende der Dateiname; ohne Ort, im
  Ladebildschirm, während eines Korridorbaus und während `probeLod()` nur der
  Grund.
  - Name `corridor-<ort>-<cold|nav>-<hhmmss>.json`: `<ort>` die Stadt oder
    Gemeinde der Adresse (sonst der Name im Header, sonst die
    HQ-Koordinaten), höchstens 24 Zeichen ASCII. `cold`: die Ortsladung des Seitenaufrufs, `nav`: ein
    Ortswechsel oder HQ-Umzug im Spiel (`CorridorTrace.loads`, das Label der
    letzten Ortsladung). Ein Spawn-Umzug ist keine Ortsladung und ändert die
    Art nicht, sein Neubau steht im Trace.
  - Aufbau (`buildCorridorSnapshot`, `debug/corridor-snapshot.ts`), eine Zeile
    je Eintrag, Zahlen außerhalb von `meta` auf 2 Stellen, nicht endliche als
    `null`:
    - `meta`: `time`, `version`, `url` (mit `l=` und `s=`, ohne Parameter,
      deren Name nach Schlüssel oder Token klingt), `location`, `load`
      (`kind`, `label`, `loads` dieser Seite, `sinceLoadS`, `history` aller
      Ortsladungen der Seite, `previous`: der zuvor gespielte Ort seit dem
      Seitenaufruf aus der Liste der letzten Orte, die einen Ort nur einmal
      führt), `corridor` (alle Werte), `corridorChanged`, `hq` und `spawns`
      (lat, lon, lokal x, z), `cellSize`, `camera`.
    - `cost`: `cells`, `cellsMs`, `columnsMs`, `slices`, `screenshotMs`,
      `wallMs`.
    - `fingerprint` wie `__corridor.fingerprint()`, dazu `lines`: die
      Einträge jedes Teils vor dem Hash. Weicht ein Teil-Hash ab, zeigen die
      Zeilen, welche Einträge.
    - `tiles` wie `__tiles.stats()`, `region` wie die Trace-Zeile `tiles`
      (mit `tileSet`), `tilePaths`: die Content-Pfade der feinen Tiles, über
      die `tileSet` hasht (`RouteCorridorRegion.finePaths`).
    - `band`: je Route und Station des Bands (`BandStation`) `kind`,
      `backbone`, `street`, `left`, `right` und `centre` (Versatz der
      Gegnerlinie), dazu `route`, `segment`, `k`, `n`, `s`, `x`, `z`, `rx`,
      `rz`. `stations`: je gemessener Station `segment`, `k`, `leftM`,
      `rightM`, `tileError`, `unmeasured` und `shiftM`
      (`PathAndRouteService.corridorState`).
    - `cells`: jede Zelle mit `key`, `x`, `z`, `state`, `heightM`, `anchorM`,
      `surface`, `passage` (Tunnelzelle eines Durchgangs), `tileDepth`,
      `tileError`, `miss` (warum ohne Höhe, `GlobalRouteGrid.missOf`), aus
      der `pick`-Zeile `routeM`, `walkable`, `walkCheck`, `overLineM`,
      `aboveNeighboursM`, und `column`, die Säule an der Mitte wie Ausgabe 2.
    - `trace`: die Zeitleiste dieser Ortsladung wie `__corridor.trace()`,
      leer bei ausgeschaltetem Trace (Production-Build).
    - `screenshot`: das Canvas als PNG-Data-URL, höchstens 1920 px breit, als
      letzte Zeile.
  - Ablauf (`CorridorSnapshotReader`, `debug/corridor-snapshot-reader.ts`):
    zuerst das Bild, im Frame kopiert (`ThreeTilesEngine.captureFrame`), dann
    Korridor, Trace und Tiles, dann die Zellen in Scheiben von
    `CorridorBuild.SLICE_MS` je Frame. Solange hält er beruhigte Tile-Ladungen
    vom Spiel fern (`SettleHold`), Säulen-Cache und `lodVersion` bleiben also
    stehen. Kommt zwischen zwei Scheiben ein Ladebildschirm, ein Korridorbau
    oder ein anderer Ort, bricht er mit dem Grund ab.
  - Kosten, unter Node: Die Datei für 2000 Zellen entsteht in 8 bis 12 ms,
    775 kB ohne Bild (`corridor-snapshot.spec.ts`); die `pick`-Zeilen von
    1801 Zellen einer Route mit 400 Waypoints kosteten in einer einmaligen
    Messung rund 16 ms. Die Säulen, ein Strahl je Zelle, sind im Browser
    nicht gemessen. Geschätzt: Phase 0 kam auf 0,12 bis 0,33 ms je Strahl
    (`measureMs` durch `rays` einer Messung aller Stationen), für Tokyo mit
    1915 Zellen wären das 0,2 bis 0,6 s, verteilt auf bis zu rund 20 Frames.
    Die echten Zahlen stehen in `cost` jeder Datei.
  - Grenzen: `column` und `walkable` lesen die aktiven Tiles und den
    Säulen-Cache von jetzt. Die Tiles folgen der Kamera, die Region ruht nach
    dem Einfrieren auf 5 m. Dort können zwei Dateien abweichen, ohne dass der
    Korridor abweicht; der Korridor selbst steht in `fingerprint`, `lines`,
    `band`, `stations` und den gespeicherten Zellwerten.

### Phase 0: auf fester LOD messen

Werkzeuge für die Entscheidung "einmal im Ladebildschirm auf fester LOD messen"
(Region auf 5 m gegen feinste LOD, Entwurf `corrarch` vom 2026-09-15). Sie
ändern das Spiel nicht, solange niemand sie aufruft.

- **`__tiles.stats()`** (`TilesConsole`, `debug/tiles-console.ts`) druckt eine
  Tabelle aus `ThreeTilesEngine.tilesLodDebug()` (`three-engine/tiles-lod-debug.ts`):
  - `regionErrorTarget`: Fehlerziel der Korridor-Region in m, `null` vor den
    Routen; `cameraErrorTarget`: das der Kamera in px.
  - `active` und `visible`: Tiles im Durchlauf (nur die trifft ein Strahl),
    `activeMB` ihre Bytes, wie der LRU-Cache sie bucht.
  - `cachedTiles`, `cachedMB`, `cacheFull`: der LRU-Cache, gedeckelt auf
    0,7 GiB (`tiles-renderer-setup.ts`).
  - `queued`, `downloading`, `parsing`: ausstehende Arbeit; `lodVersion` des
    Säulen-Caches.

  In DevWorld: `No 3D tiles: ...`.
- **`__corridor.probeLod(targets = [5, 2.5, 0], timeoutS = 60)`**
  (`CorridorLodProbe`, `debug/corridor-lod-probe.ts`): ein Befehl je Ort,
  für den Playtest ohne Erklärung. Ausgabe nur über `console.log`, jede Zeile
  mit `[Corridor] probeLod:` davor:
  - Kann sie nicht laufen, genau eine Zeile mit Grund und was zu tun ist,
    z. B. `Intro noch aktiv: warten und Befehl nochmal`.
  - Sonst je Ziel eine Zeile
    (`2/3: 2.5 m geladen in 1.2 s, 236 Stationen gemessen in 310 ms`) und
    die Schlusszeile `Fertig: Ergebnis kopiert, bitte in den Chat einfügen`,
    nach einem Abbruch `Abgebrochen (Grund): ...`.
  - Die Zwischenablage braucht den Fokus der Seite, den nach dem Tippen
    DevTools hat. Lehnt sie deshalb ab, erscheint oben in der Mitte ein
    Knopf `Ergebnis kopieren` im Stil des Zellberichts
    (`debug/copy-result-button.ts`), der mit einem Klick kopiert und
    verschwindet; die Schlusszeile heißt dann
    `Fertig: Klick oben auf 'Ergebnis kopieren', dann in den Chat einfügen`.
    Lehnt die Zwischenablage auch beim Klick ab, steht der Bericht in der
    Konsole, und der Knopf sagt es.

  Ablauf:
  1. Verweigert, solange der Ort lädt (Ladebildschirm), Tower stehen, eine
     Welle läuft, Gegner da sind, der Intro-Flug läuft oder eine
     Korridormessung offen ist, ebenso ohne Tiles (DevWorld) oder ohne Region.
  2. Hält die beruhigten Tile-Ladungen vom Spiel fern (`SettleHold`): kein
     Sprung der `lodVersion`, solange sie läuft. Setzt das Fehlerziel der
     Kamera auf 1e6 px
     (`MUTED_CAMERA_ERROR_TARGET`): Die Kamera verfeinert nichts mehr, die
     Region weiter bis zu ihrem Ziel.
  3. Je Ziel: Fehlerziel der Region setzen, warten, bis 0,5 s lang nichts
     lädt (`QUIET_MS`, wie der Debounce des `TileLoadingTracker`), höchstens
     `timeoutS`. Dann jede Station einmal messen
     (`PathAndRouteService.measureAllStations`), am Stück; die Säulen einer
     Station berühren den Säulen-Cache nicht (siehe Messung).
     Nichts davon wird gespeichert oder gebaut.
  4. Am Ende, auch nach Timeout, Fehler oder Abbruch: beide Fehlerziele
     zurück auf die Werte von vorher, warten, bis die Tiles ruhig sind, dann
     die Ladungen freigeben. Kam in der Zeit eine an, gibt `SettleHold` genau
     eine weiter.
  5. Kommt zwischen zwei Zielen ein Tower, eine Welle oder eine Messung dazu,
     hört sie auf (`stoppedEarly`). `__corridor.set()` und `reset()`
     antworten während der Probe `Not changed: __corridor.probeLod() is running.`

  Der Bericht (`buildLodProbeReport`) ist eine Zeile JSON: `report`, `time`,
  `url` (ohne Parameter, deren Name nach Schlüssel oder Token klingt, wie
  im Zellbericht), `version`, `corridor` (von `CORRIDOR_DEFAULTS`
  abweichende Werte), `tiles` (wie `__tiles.stats()`, vor der Probe),
  `fingerprint` (Hash, je Teil `[entries, hash]`), `rows`, `restored`,
  `stoppedEarly`, `restoreTimedOut`, `corridorUnchanged`. Spalten von
  `rows`, eine Zeile je Ziel:

  | Spalte | Inhalt |
  |---|---|
  | `target` | Fehlerziel der Region in m, 0 = feinste LOD |
  | `loadS`, `timedOut` | Sekunden, bis nichts mehr lud (ohne die 0,5 s Ruhe); bei `timedOut` die ganze Wartezeit samt Ruhe |
  | `active`, `activeMB`, `cachedTiles`, `cachedMB`, `cacheFull` | wie `__tiles.stats()`, nach dem Laden |
  | `stations` | gemessene Stationen |
  | `upTo2`, `upTo2_5`, `upTo5`, `over5`, `none` | geometricError des Tiles unter jeder Station: bis 2 m, über 2 bis 2,5 m, über 2,5 bis 5 m, über 5 m, kein Tile |
  | `measureMs`, `msPerStation` | Hauptthread-Zeit des Durchlaufs, ein Frame lang am Stück |
  | `rays`, `rayMs`, `hitsPerRay` | Säulen- und Seitenstrahlen des Durchlaufs; `__raycastStats()` bucht sie unter `corridorLodProbe` |

  `corridorUnchanged` sagt, ob sich der Korridor während der Probe geändert
  hat (Fingerprint vor und nach der Probe, vor der Freigabe). Seit der
  Korridor eingefroren wird, ändert der weitergegebene Tile-Schub danach
  nichts mehr an ihm; die Probe misst nur und baut nie.

  Grenzen: Während der Probe fallen die Tiles außerhalb der Region auf grobe
  LOD, das Bild wird grob. Bei `cacheFull` starten keine neuen Downloads; die
  Zeile gilt dann für das, was in den Cache passte. Im Hintergrund-Tab lädt
  nichts, die Ziele laufen dann in den Timeout.
- **`__corridor.fingerprint()`** (`debug/corridor-fingerprint.ts`) druckt
  `[Corridor] fingerprint <8 Hex-Ziffern>` und je Teil `entries` und `hash`.
  Nur gespeicherter Zustand geht ein (`PathAndRouteService.corridorState` und
  die Zellen des Grids), nichts wird neu gemessen oder beurteilt; wohin die
  Kamera schaut, ändert ihn nicht. Derselbe Korridor gibt denselben Hash.

  | Teil | Inhalt |
  |---|---|
  | `band` | je Route und Station des Bands: Art, Rückgrat (Versatz cm, Höhe dm), Kanten links und rechts und Versatz der Gegnerlinie (cm) |
  | `stations` | je gemessener Station der Freiraum links und rechts (cm) und warum sie ungemessen blieb |
  | `cells` | Zellen nach ihrer Mitte (cm) |
  | `heights` | Zellhöhen auf 0,1 m gerundet |
  | `tiles` | geometricError des Tiles unter jeder gemessenen Station; je Zelle Sample-Zustand, Tiefe und geometricError |

  Routen, Segmente und Zellen gehen nach Schlüssel sortiert ein. Messungen
  von Routen, die nicht mehr in Gebrauch sind (Spawn verschoben), fehlen. Das
  Urteil je Zelle geht nicht ein: Es neu zu berechnen läse den Säulen-Cache,
  und der folgt der Kamera.

  Weichen zwei Fingerprints desselben Orts ab, sagt `tileSet` in der Zeile
  `build.tiles` des Trace, ob beide auf denselben feinen Tiles gemessen haben. Eine
  Zeile `tiles` zwischen `build.tiles` und `build.freeze` heißt, dass
  während des Baus ein Tile-Schub zur Ruhe kam, mit dem `tileSet` danach.

### `__routes.describe()`

`console.table` mit einer Zeile je Stück einer Route über einen OSM-Way
(`RouteWayRun`, `route-way-report.ts`):

- Lage: `route`, `fromIndex`, `toIndex`, `lengthM`.
- Der Way: `way`, `type`, `name`, `tags` (`width`, `lanes`, `bridge`,
  `tunnel`, `covered`, `layer`).
- Straßenbreite: `widthM`, `widthSource` (`width`, `lanes`, `highway` oder
  `inherited` für das Endstück zum HQ).
- Korridor: `corridorM` (links plus rechts), `leftM`, `rightM`, als Spanne,
  wo die Breite wechselt.
- Höhe: `maxCellAboveStreetM` und `at`, der größte Abstand der Zellhöhe über
  der Straßenhöhe entlang der Mittellinie, nach der Regel des gelben
  Straßen-Overlays (`getStreetHeightEstimate`, siehe unten). Die Strecke
  hinter einem Brückenende und das Endstück zum HQ nimmt der Vergleich wie
  die Zellen entlang der Route (`routeApproaches`), mit der Höhe, die die
  Route vom Brückenende oder von der Straße trägt.

Nur für Diagnose: je Punkt alle 2 m bis zu fünf Säulenproben, auf einer
Brücke eine mehr, auf der Strecke dahinter und auf dem Endstück die Säulen
entlang der Route von deren Anfang (alle 2 m, im Cache der Engine).

### Gelbes Straßen-Overlay

Layer "Show streets" im Layers-Menü der Quick-Actions
(`StreetRenderingService`, `street-rendering.service.ts`). Höhe je OSM-Knoten
(`TerrainQueries.getStreetHeightEstimate`), danach je Way geglättet
(`smoothPathHeights`):

- sonst der unterste Treffer unter dem Knoten, oder das Minimum der Proben
  3 und 6 m quer dazu, wenn der Knoten mehr als 3 m darüber liegt (Krone,
  Dach; `getGroundHeightEstimate`);
- auf einem Way mit `bridge=*` die Oberkante der Säule, das Deck, wie die
  Zellen eines Brückensegments;
- auf der Strecke hinter einem Brückenende der Treffer, der der Höhe am
  nächsten liegt, die der Weg vom Endknoten des Brücken-Ways bis zum Knoten
  trägt (`carriedY`); liegt er mehr als `CARRY_STEP_RISE_M` (1,5 m) über
  dieser Höhe (Krone, Schild, Auto ohne Boden darunter), die getragene
  Höhe. Beides nach derselben Regel wie eine Zelle der Strecke
  (`approachY`; bis 2026-09-16 galt hier `roofRise`). Ohne Säule am Endknoten wie oben. Welche Knoten dazugehören, sucht
  `streetDeckApproaches` im Straßennetz: von beiden Endknoten jedes
  Brücken-Ways über Ways ohne Brücken-Tag, in jede Richtung, ohne Tunnel,
  bis 60 m, je Knoten über den kürzesten Weg. Das ist dieselbe Strecke, die
  eine Route über diese Ways bekommt, außer wo eine Route den Brücken-Way
  an einem mittleren Knoten verlässt: Dort trägt die Route das Deck
  weiter, das Overlay nicht.
- auf einem Stück unter einem Way, der die Straße auf höherer Ebene kreuzt
  (dieselben Stücke wie für eine Route über die Straße, `streetUnderpasses`
  in `underpass.ts`), zwischen dem Boden an zwei Portalen 2 m vor den
  Enden des Stücks (`getGroundHeightEstimate` dort), wie die Zellen, aber
  ohne Stützen. Das betrifft nur Knoten: Liegt keiner im Stück, läuft die
  Linie gerade vom Knoten davor zum Knoten danach. In Erlenbach (D2)
  liegen die Knoten der Weinsberger Straße 5,8 und 4,6 m vor den Enden des
  Stücks, dort ändert sich nichts. Tunnel-Ways selbst bleiben, wie sie
  sind (ein Tunnel aus mehreren Ways hätte je Way eigene Portale im
  Tunnel).

Vorher lag das Overlay auf jeder Brücke auf Kai oder Fluss darunter
(Playtest 2026-09-14, Paris).

**Warum das Overlay seine eigenen Säulen behält** (geprüft 2026-09-21, B5):

- **Abdeckung:** Gezeichnet wird jede Straße ganz, von der ein Knoten
  höchstens `STREET_FILTER_RADIUS` (100 m) an einem Routenpunkt liegt
  (`filterStreetsNearRoutes`, `osm-street.service.ts`). Zellen gibt es nur
  bis zur Halbbreite neben der Route, höchstens `maxHalfWidth` (7 m).
  `getGroundLocalYAt` gäbe für den größten Teil der Knoten null, die eigene
  Abfrage bliebe also ohnehin stehen.
- **Vergleichswert:** Die Höhe des Overlays ist der Wert, gegen den
  `__routes.describe()` die Zellhöhe hält, um Zellen auf Dach oder Krone zu
  finden (`maxCellAboveStreetM`, `route-way-report.ts`). Aus den Zellen
  gespeist wäre er immer 0.
- **Auffrischung:** Das Overlay wird bei jedem Tile-Stapel neu gezeichnet
  (`VisualizationFacadeService.onTilesLoaded`) und folgt so den feineren
  Tiles; die Zellen bleiben eingefroren. Beim Laden läuft es vor dem
  Korridorbau (`scheduleOverlayHeightUpdate` vor
  `buildCorridorBehindLoadingScreen`), es sähe die eingefrorenen Höhen erst
  beim nächsten Stapel.
- Die Regeln teilen beide ohnehin: Deck, getragene Höhe und Portale kommen
  bei Zelle und Overlay aus `carried-height.ts` und `underpass.ts`.

Der Intro-Flug ebenso: Sein Profil braucht je Stützstelle neben dem Boden
die Oberkante (Dächer, Kronen), die eine Zelle nicht führt (`RouteCell`
kennt nur `terrainHeight`); beide kommen aus derselben Säule
(`IntroCameraFlightService.sampleIndex`), der Strahl bliebe also stehen.
Das Profil beginnt zudem vor dem HQ, mindestens `standoffStart` (60 m)
entlang der Anfangstangente nach hinten verlängert, und dieses Stück liegt
neben dem Korridor. Die eingefrorenen Zellhöhen liest der Flug bereits: Die
Routenpunkte tragen sie (`showPathFromSpawn` über `getGroundLocalYAt`, nach
dem Bau noch einmal in Schritt 6 von `CorridorBuild`), `routeYAt` gibt sie
zwischen den Punkten aus, und `safeGround` nimmt sie als Rückfallwert, wo
kein verlässliches Sample in der Nähe liegt.

### Linie, Zellen und Gegner verschwinden (Brücken, Unterführungen)

Befund Paris (TODO 1.10, alte Liste 14, Playtest 564): Route `spawn-1`
läuft über den Pont d'Iéna (Way 986589650, `service`,
`bridge=yes layer=1`, 156 m), davor und danach über kurze Ways ohne
Brücken-Tag mit demselben Namen (1322092756 mit 7 m, 1423074549 mit 2 m,
1284139443 mit 31 m), überall 7 m je Seite. An beiden Brückenköpfen
verschwanden Gegner, Zellen und rote Linie. Im Overlay lag das Deck blau,
an beiden Köpfen lagen weiße und orange Zellen verstreut, zum Teil auf einer
anderen Ebene. Zwei `pick()` 8 bis 13 m neben der Linie zeigten Säulen mit
zwei Ebenen: Deck bei 79,7 bis 79,85 m, darunter 70,4 und 71,5 m.

Was der Code dazu sagt:

- **Behoben:** In einer Zelle, die ein Brückensegment und ein Segment ohne
  Brücke erreichten, gewann bis dahin immer der Boden. Die Zufahrt reicht
  mit ihrem runden Ende (`jointCap`, bei 7 m auf beiden Stücken 7 m) über
  die ersten 7 m des Decks. Diese Zellen nahmen den untersten Treffer ihrer
  Säule, wo das Deck über dem Kai liegt also den Kai 8 bis 9,5 m tiefer.
  Dazu gehört die Zelle am Waypoint zwischen Brücke und Zufahrt; dort nimmt
  die rote Linie ihre Höhe und lief von dort unter das Deck, die Gegner auf
  diesen Zellen ebenso. Randzellen der Zone verwiesen für den Dach-Check auf
  die Mittellinien-Stelle am Übergang (`axisX`, `axisZ`); lag deren
  unterster Treffer auf dem Kai, lag eine Randzelle über festem Boden mehr
  als `roofRise` darüber und wurde orange auf den Kai gesetzt. Seitdem
  behält eine Zelle entlang der Brücke das Deck (siehe Zellhöhe,
  Brückendeck).
- **Kein Fehler der Zellen:** `maxCellAboveStreetM` 9,5 auf dem
  Brücken-Way. Das gelbe Straßen-Overlay und der Vergleichswert in
  `__routes.describe()` nahmen je Säule den untersten Treffer
  (`getGroundHeightEstimate`), auf einer Brücke also Kai oder Fluss; die
  Deckzellen lagen 9,5 m darüber. Seitdem nehmen beide dort das Deck
  (siehe "Gelbes Straßen-Overlay").
- Die rote Linie liegt 1 m (in DevWorld 3 m) über den Zellen der
  Mittellinie und zeichnet mit Tiefentest
  (`route-line-layer.ts`), Gegner ebenso. Das Route Grid Overlay zeichnet
  jede Zelle ohne Tiefentest (`route-grid-aggregate-viz.ts`), eine Zelle
  unter einer Brücke bliebe dort also sichtbar, in Schrägsicht versetzt.
- Eine Zelle nimmt den untersten Treffer ihrer Säule, auf einem Segment mit
  `bridge=*` den obersten. Ein Way unter einer Brücke ist in OSM oft ohne
  `tunnel`, nur mit `layer=-1` oder ganz ohne Tag erfasst; dann ist die
  Zelle `ground`.
- **Behoben (H2):** Die kurzen Ways ohne Brücken-Tag lagen selbst noch
  über dem Kai, das Bauwerk reicht über das Ende des OSM-Brücken-Ways
  hinaus. Beleg aus dem Retest: `pick()` an einem Kopf, alle 14 Stellen mit
  Oberkante 79,8 bis 80,2 m, nächste Station auf Way 1423074549 (2 m, ohne
  `bridge`). Seitdem tragen solche Ways das Deck weiter (siehe Zellhöhe,
  Strecke hinter dem Brückenende), seit dem Retest 601 auch um eine Ecke
  und bis 60 m.

**Befund Erlenbach** (Playtest 2026-09-14, seit 2026-09-15 als Unterführung
behoben, siehe Zellhöhe, "Unter einer fremden Brücke"): Route `spawn-1` auf der
Weinsberger Straße (Way 31361736, ohne Tags) unter einer Autobahnbrücke,
die kein Way der Route ist. Zellen und Gegner lagen auf dem Deck,
`maxCellAboveStreetM` 10,1. Keine Regel der Zellen hebt sie dorthin: Der
Way ist keine Brücke und lag damals auf keiner Strecke hinter einem
Brückenende, das Lückenfüllen greift nur bei
Zellen ohne eigene Probe oder mehr als 50 m neben den Nachbarn, Dach- und
Stufen-Check ändern keine Höhen. Die Zellen nehmen den untersten Treffer der
feinsten LOD ihrer Säule; dort war also beim Sampling keine Straße. Drei
mögliche Ursachen, alle in der Säulenprobe (`column-sample.ts`,
`terrain-queries.ts`), die ersten beiden in `terrain-queries.spec.ts`
(`inspectColumn()`) mit Fake-Tiles nachgestellt:

- a) Das Deck liegt in einem tiefer verfeinerten Tile als die Straße
  darunter. `selectColumnSample` behält nur die feinste LOD (gegen die
  grobe Hülle) und verwirft die Straße.
- b) Das Tile der Straße kam mit gleicher Tiefe nach dem des Decks. Der
  Säulen-Cache (`sampleColumn`) und der LOD-Peek einer stabilen Zelle
  (`sampleCellY`) proben nur neu, wenn ein besseres LOD da ist, und bleiben
  beim Deck: der Cache bis `clearHeightCache` (Höhen-Update beim Laden,
  Ortswechsel), die Zelle bis zum nächsten Neuaufbau.
- c) Die Photogrammetrie hat unter dem Deck keine Straße.

`__routes.describe()` fand die Straße über die Querproben 3 und 6 m neben
der Mittellinie. Welche Ursache greift, zeigt `pick()` mit
"[Corridor] column at the click" (siehe Diagnose): a) `fresh` auf dem Deck,
unter `hits` ein Treffer auf Straßenhöhe mit kleinerer Tiefe; b) `fresh` auf
der Straße, `cached` auf dem Deck; c) kein Treffer auf Straßenhöhe. Nicht
geändert: Jede Änderung dort trifft jede Säulenprobe (Zellen, Tower,
Overlay).

Die Daten D2 vom 2026-09-15 (Way 230161781) zeigen c): `cached` 220,77 m
aus Tiefe 23, `fresh` 220,67 m aus Tiefe 25, unter `hits` nur 220,67 m. Auch
das feinste Tile hat an der Stelle nur das Deck; ein F5 lädt dieselben
Tiles und ändert daran nichts. Der Unterschied zwischen `cached` und
`fresh` (10 cm, zwei Tiefen) ist ein älteres Sample im Säulen-Cache, das
beim nächsten Zugriff nach einem Tile-Schub neu geprobt wird. Seit der
Unterführung hängt die Höhe dort nicht mehr von dieser Säule ab, sondern
von den Portalen auf der Straße und den Stützen.

Ein `__corridor.pick()` je Stelle trennt die Fälle:

| Befund in den Zeilen nahe `routeM` 0 | Deutung |
|---|---|
| `cell` true, `heightM` gleich `columnBottomM`, `overM` mehrere Meter, `cameraSees` false | Die Route läuft unter etwas durch (Brücke, Rampe) und liegt richtig; Linie und Gegner sind verdeckt, die Zellen im Overlay nicht |
| wie oben, aber die Straße liegt in Wirklichkeit oben (`tags` mit `layer=1`, keine `bridge`) | Die Route läuft über ein Bauwerk ohne Brücken-Tag, die Zellen fallen auf die untere Ebene |
| `heightM` weit weg von `columnBottomM` und den Nachbarn, oder `NaN` | Zellhöhe falsch (Naht, Ausreißer-Cluster); Linie, Zellen und Gegner liegen woanders |
| `cell` false auf der Linie | keine Zellen, Lücke im Grid |
| `surface` `tunnel`, `state` `unsampled` | Tunnelstück mit einem Portal ohne Treffer und ohne Straße des Bands dort (`build.freeze why=noPortal`) |

### Route Grid Overlay

Layer "Route Grid Overlay" im Layers-Menü der Quick-Actions
(`quick-actions.component.html`). Gezeichnet wird jede Zelle des Grids, auch
ohne Höhenprobe. Die Fläche ist grau ohne Tower-Abdeckung und grün mit, Zellen
der Mittellinie sind etwas kräftiger.

Die Kontur zeigt den Zustand, in dieser Rangfolge (`overlayCellKind`,
`route-grid-aggregate-viz.ts`; Farben in `LOS_VIZ_CONFIG.gridOverlay`,
`los-viz.config.ts`):

| Kontur | Zustand |
|---|---|
| rosa | ohne Höhenprobe; die LOS-Anzeige eines Towers lässt die Zelle aus. Eine gefüllte Zelle (`filled`, siehe Zellhöhe) hat eine Höhe und die Kontur ihrer Fläche; `__corridor.pick()` zeigt sie als `state: 'filled'`, `__rg.dumpStats()` zählt sie unter `filled` |
| blau | Brückendeck, die Strecke hinter einem Brückenende (`approach`, bis 60 m entlang der Route) und das Endstück zum HQ (`approach`, seit 2026-09-16), gleich welchen Treffer die Säule ihr gab; die Höhe zeigt, ob Deck, Boden oder getragene Höhe |
| gelb | Tunnel, überdachter Durchgang oder Stück unter einer fremden Brücke |
| weiß | normal |

Das "Air Route Grid Overlay" zeigt dieselben Konturen, die Fläche blau für
Luftabdeckung.

`__rg.dumpCellsInBox({ xMin, xMax, zMin, zMax })` listet die Zellen eines
Ausschnitts mit Probe, LOD und `surface`.

## Grenzen

Aus dem Code abgeleitet, im Spiel nur teilweise geprüft (Playtest-Liste in
archive/REVIEW_SPRINT_2026-09-12.md, Punkte 9 bis 15 und 41 bis 53):

- Die Messung ist je Seite. Liegt die OSM-Mittellinie neben der Straßenmitte
  der Photogrammetrie, wird die Seite mit mehr Platz breiter. Die Mittellinie
  selbst (rote Linie, Mitte der Gegnerverteilung) wird nicht verschoben.
- An Kreuzungen laufen die Strahlen in die Querstraße. Eine Einmündung breiter
  als etwa `bulgeLength` bleibt als Ausbuchtung stehen, bis `maxHalfWidth`.
- Auf freien Flächen ohne Wand innerhalb von `maxHalfWidth` (Platz, Park,
  ein Vorgarten auf Gehweghöhe hinter Zaun, Mauer oder schmaler Hecke) ist
  der Korridor auf dieser Seite 7 m breit.
- **Vorgärten:** Die Strahlen trennen einen Vorgarten nur über die Höhe
  seines Bodens 1 m hinter dem, was den unteren Strahl stoppt. Einer auf
  Gehweghöhe bleibt im Korridor; eine Hecke 1 m tief und mehr zählt selbst
  als erhöht. Ein erhöhter Garten ohne etwas darauf, das den unteren
  Strahl stoppt, bleibt für die Strahlen offen (0,4 m liegen unter dem
  Strahl in 1 m) und für den Weg nach außen auch, solange die Stufe unter
  `stepRise` bleibt.
- **Quergefälle:** Steigt der Boden neben der Straße bis auf die Höhe des
  unteren Strahls (Böschung, Hang), trifft der ihn, und die Säule dahinter
  liegt höher: Der Korridor endet dort. Ein Zaun auf einem Gehweg, der
  1 m hinter dem Zaun 0,3 m über der Station liegt (etwa 6 % Quergefälle
  auf 5 m), engt ebenso ein. Nicht im Spiel geprüft.
- **Einzelnes Erhöhtes:** Alles mindestens 1 m Tiefe, das nur den unteren
  Strahl stoppt und oben mehr als 0,3 m hoch ist (Stromkasten, Kübel mit
  Bewuchs), engt seine Station (2 m) ein; das Schließen der Einbrüche nimmt
  es nicht weg.
- Das Band (`corridor-band.ts`), nicht im Spiel geprüft:
  - Das Rückgrat sucht nur innerhalb der OSM-Halbbreite plus 1,5 m und
    innerhalb der Strahlenwände. Liegt die Fahrbahn weiter neben der Linie,
    bleibt das Band auf dem, was im Fenster liegt.
  - Eine Autoreihe ohne Lücke, über die die Linie länger als etwa 8 m
    läuft (vier Stationen), sieht die Regel "Rückgrat nur auf Straßenhöhe"
    nicht mehr als Straße daneben: Das Band legt sich dann auf die Dächer,
    und die Gegner steigen darüber.
  - Die Straße unter einer Station (`street`) kommt aus einem Opening über
    `PASSAGE_SPAN_M` (30 m). Ein Durchgang, der länger ist, hat in seiner
    Mitte keine Straße in Reichweite; dort liegt das Band wieder auf dem,
    was ihn überdeckt. An den beiden Enden der Route liest das Opening auf
    einer Steigung bis zu `Neigung · 15 m` zu tief: bei 8 % sind das 1,2 m,
    ab etwa 17 % erreicht das `roofRise`, und die letzten 15 m der Route
    könnten fälschlich Durchgang werden. Im Spiel nicht beobachtet, im Test
    nur bis 8 % geprüft.
    In der Turm-Szene mit 3 m Mesh-Überstand liegen so in 15 von 65
    Gitterlagen Zellen auf den Dächern (in zwei davon nachgesehen: die Gasse
    ist dort über 40 m überdeckt, `street` liest die Dächer), mit den Regeln
    vor wie nach Playtest 747.
  - Die Durchgangsregel der Linie prüft die Zellen, durch die die Linie
    läuft, nicht die Zellen innerhalb der Halbbreiten ihrer Stücke. In der
    Szene "Marktplatz" liegen je nach Gitterlage bis zu zwei Zellen auf dem
    Block der Ratstrinkstube (Way 141331646, 28 m), in der Turm-Szene
    ebenso auf Markt 3 (Way 141331659): an Ecken der Route, beansprucht nur
    vom runden Ende eines Stücks (`jointCap`). Mit den Regeln vor wie nach
    Playtest 747, Ursache nicht weiter untersucht, im Spiel nicht beobachtet.
  - Wie weit ein Durchgang reicht, entscheidet die Lage des Gitters an jedem
    Ende auf etwa eine Zelle genau; ein Durchgang an einem Tunnel aus OSM ist
    deshalb Teil des Tunnels (`passages`). Eine Deckung, deren Kante gerade
    bis an die Linie reicht, ergibt je nach Gitterlage einen Durchgang oder
    keinen.
  - Die Zellen quer prüft das Band nur auf der Linie durch jede Station;
    was zwischen zwei Stationen steht, sieht es nur, wenn es auch eine
    ihrer Querlinien trifft. Auf einer Diagonale kann eine Zelle dazwischen
    durchrutschen.
  - Die Gegnerlinie hält `edgeMargin` zu beiden Kanten; ist das Band
    schmaler als 3 m, läuft sie in seiner Mitte und die Gegner laufen alle
    auf ihr.
  - `__routes.describe()` findet für Segmente neben der OSM-Linie keinen
    Way (sie liegen neben seiner Kante).
  - Die Ringe des Wurms stehen quer im Korridor und folgen dessen Breite;
    wo das Band neben einem Transporter von 7 auf 1,5 m schrumpft, gieren
    benachbarte Ringe bis 16,6 Grad gegeneinander (`worm-detour.spec.ts`). Das
    stört laut User nicht (2026-09-16).
- Ein Auto oder eine Hecke am Rand nimmt den Korridor dahinter mit, den
  Gehweg hinter einer Autoreihe eingeschlossen: Der Korridor ist je Seite
  ein Band. Genau dieses Einengen hatte der Playtest vom 2026-09-12 bei den
  Strahlen verworfen (Transporterreihe, `8910463`); nach dem Playtest
  2026-09-14 hat der Nutzer entschieden, die orangen Zellen wegzulassen,
  und dass Autos und Transporter einengen sollen (Vorgärten, Option a; zu
  den Strahlen siehe Vorgärten oben).
  Ein Vorgarten auf Straßenhöhe ohne Wand bleibt im Korridor, bis
  `maxHalfWidth`, auch hinter einem Zaun oder einer schmalen Hecke, die
  zwischen zwei Zellmitten liegt. Kommt eine Zelle auf die Hecke (mehr als
  `stepRise` über dem Weg davor), fällt der Garten dahinter mit weg; ein
  erhöhter Garten fällt weg.
- Eine Hecke, eine Krone oder ein erhöhter Garten, den die
  Photogrammetrie zu einer Böschung verschmilzt, die je Rasterschritt
  höchstens `stepRise` steigt und unter `roofRise` bleibt, ist vom Hang nicht
  zu unterscheiden und bleibt im Korridor.
- Abfall-Check: Eine Böschung bis 25 % entlang der Rasterachsen (diagonal
  etwa 17 %) bleibt im Korridor. Liegt an einer schmalen Straße schon die
  erste Rasterstelle neben der Mittellinie auf Böschung und Hang, nimmt der
  Check die Neigung für eine Straße quer am Hang, und die Böschung bleibt.
  Eine Straße auf einem Grat oder Damm, der zu beiden Seiten mehr als
  0,5 m je Rasterschritt fällt, verliert dort die Randzellen (nichts zu
  spiegeln), auch in DevWorld. Nicht im Spiel geprüft.
- Steht an einem Hang zur Zelle hin ein Auto und fällt die andere Seite
  ähnlich stark, nimmt der Stufen-Check die Neigung für den Hang und lässt
  die Zelle im Korridor, auf dem Autodach. Talseitig bleibt ein Auto bis
  `stepRise` plus einer Stelle Gefälle über dem Boden davor (bei 5 %
  Querneigung 0,6 m), direkt neben der Mittellinie (erste Stelle) zählt es
  weiter von der Mittellinie. Liegt eine Randzelle am Hang
  mehr als `roofRise` über der Mittellinie, endet der Korridor bergseitig
  vor ihr.
- Was ein feineres Tile erst zeigt, während Tower stehen, eine Welle läuft
  oder Gegner da sind, bleibt im Korridor, auf seiner Höhe, bis zum
  nächsten Neuaufbau (siehe Band).
- Nähte zwischen Tile-Meshes: Stationen und Zellen versuchen Säulen 0,5 m
  daneben, Lücken füllt der Grid aus den Nachbarn. Eine Zelle, die weder
  zwischen zwei stabilen Zellen liegt noch drei berührt, bleibt ohne Höhe
  (rosa), wenn auch die gröbere Stufe dort nichts trifft; ihre LOS-Antwort
  rechnet der Tower dann auf der Höhe des Routenankers
  (`route-grid-los.ts`), während Gegner dort auf dem Median der Nachbarn
  stehen (`estimateTerrainY`). Eine Messlücke länger als etwa
  `dipLength` bei der Straßenbreite. Ist an der Stelle einer Zelle kein
  Tile-Mesh dekodiert, probt sie gar nicht (`terrainPeekLOD`); dann greift
  nur das Füllen. Der Ausreißer-Test braucht mindestens drei stabile
  Nachbarn derselben Fläche; für eine erste Probe oder ein Upgrade zählen
  nur Nachbarn aus mindestens so tiefen Tiles. Ein Treffer aus einem
  feineren Tile als alle Nachbarn wird dort also nicht geprüft.
- Die Portalprobe eines Tunnels kann auf einem Hang oder auf etwas weniger
  als `roofRise` Hohem (Auto, Mauer) landen, dann steht das ganze
  Tunnelstück schief. Ein Dach oder eine Auskragung darüber ersetzt seit
  2026-09-15 die Mittellinie ringsum, außer wo auch die Stellen dort auf
  dem Haus liegen (der OSM-Way läuft mehrere Meter im Haus). Liegt der
  OSM-Way neben der Öffnung, laufen die Gegner neben ihr durch die Wand;
  das erkennt der Korridor nicht, im Durchgang gilt die OSM-Breite. Eine
  Kuppe oder Senke im Tunnel wird als Gerade zwischen den Portalen
  angenähert.
- Zwei Routen auf verschiedenen Ebenen, die sich Zellen teilen: bei einer
  Brücke und der Strecke hinter ihrem Ende gilt der Boden, bei einem Tunnel
  und einem Stück unter einer fremden Brücke die Tunnelsohle. Läuft eine
  Route über die Brücke und eine zweite darunter, liegen die Zellen der
  ersten an der Kreuzung also auf der Straße.
- Unter einer fremden Brücke (`underpass.ts`):
  - Nur Ways aus der Overpass-Abfrage der Straßen (`highway=*`). Eine
    Eisenbahnbrücke oder ein anderes Bauwerk ohne `highway` fehlt dort;
    unter ihm bleiben die Zellen auf dem untersten Treffer.
  - Nur wo der Way darüber die Route kreuzt. Läuft die Route längs unter
    einem Viadukt, oder reicht ein Deck über das Ende seines Ways hinaus
    über die Route, greift es nicht.
  - Die Breite des Bauwerks ist geschätzt (OSM-Breite und 4 m je Seite).
    Ein breiteres Deck lässt die Portale darauf liegen; dann hilft nur
    "Portal unter einem Dach".
  - Eine Route auf einer Brücke unter einer höheren Brücke bleibt, wie sie
    ist: Ihre Zellen nehmen die Oberkante, also das höhere Deck.
  - Unter einer Fußgängerbrücke wird ein Stück von etwa 10 m nicht
    gemessen und behält die OSM-Breite; eine breiter gemessene Straße wird
    dort schmaler. Nicht im Spiel geprüft.
  - Die Stützen liegen auf der Geraden von Portal zu Portal, der Anteil
    einer Zelle zählt entlang der Route; auf einem gebogenen Stück weichen
    beide etwas voneinander ab.
  - Kosten nicht gemessen: je Routenaufbau eine Suche über die Ways mit
    `bridge` oder `layer` über dem Way der Route (Bounding Box je Way), je
    Tunnelzelle bis zu 50 Säulen für die Stützen aus dem Cache der Engine.
- Strecke hinter einem Brückenende:
  - Die getragene Höhe beginnt mit der Oberkante am Brückenende. Steht dort
    etwas mehr als 1,5 m hoch auf dem Deck (Bus, Lieferwagen), bleibt sie
    auf dessen Höhe, bis eine Stelle wieder bis 1,5 m heranreicht. Die
    Zellen nehmen trotzdem den Treffer, der ihr am nächsten liegt, bei einem
    Bus von 3 m also das Deck, nicht den Kai 10 m tiefer (Spec).
  - Eine Treppe steiler als 1,5 m je 2 m (etwa 37°) hängt die getragene
    Höhe ab. Ihre Stufen behalten ihre Höhe, solange ihre Säule nur sie
    trifft; unter einem Deck dort gewönne das Deck.
  - Ein Deck, das weiter als 60 m hinter dem Brückenende reicht, fällt dort
    auf den untersten Treffer zurück.
  - Eine Säule liefert nur Oberkante und untersten Treffer. Liegt die
    Fläche der Route dazwischen (ein Deck über einer Straße über einer
    tieferen Straße), nimmt die Zelle den näheren der beiden.
  - Kosten nicht gemessen: je Zelle und Overlay-Knoten der Strecke bis zu
    30 Säulen entlang der Route, für alle einer Strecke dieselben, im
    0,5-m-Cache der Engine; die Stationen einer Scheibe dieselben Säulen
    einmal als eigene Strahlen.
- Endstück zum HQ (seit 2026-09-16, nicht im Spiel geprüft):
  - Die getragene Höhe beginnt mit dem untersten Treffer dort, wo das
    Endstück die Straße verlässt. Steht dort ein Transporter ohne Straße
    darunter, oder beginnt das Endstück an der Mündung eines Tunnels oder
    Durchgangs unter einer Auskragung, beginnt sie auf dessen Dach. Ein Hof
    oder Dach unter dieser Höhe oder bis 1,5 m darüber behält dann seinen
    Treffer, ein höheres Dach bekommt die Höhe am Anfang.
  - Seitlich misst eine Zelle gegen die getragene Höhe an ihrem Routenpunkt.
    Am Hang quer zum Endstück liegen Zellen bergseitig mehr als 1,5 m über
    ihr auf dieser Höhe, also im Hang; bei 2,75 m Halbbreite ab etwa 55 %
    Querneigung an der äußersten Zelle.
  - Eine Terrasse, Mauer oder Stufe höher als 1,5 m je 2 m auf dem Endstück
    hängt die getragene Höhe ab; Zellen dahinter liegen in ihr, die Gegner
    laufen hinein. Das gilt auch für einen Weinberg mit Trockenmauern über
    1,5 m, die das Endstück hinaufsteigt, und für Gelände steiler als 75 %.
  - Kosten nicht gemessen: je Zelle eine Säule aus dem Cache je 2 m vom
    Anfang des Endstücks bis zu ihrem Routenpunkt (auf den Endstücken der
    beiden Snapshots, 16 und 12 m, bis zu 9, auf einem von 150 m bis zu 76),
    für die Stationen einer Scheibe zusammen ebenso viele Strahlen.
- Der synchrone Neuaufbau im laufenden Spiel, der Hänger beim Setzen eines
  Towers während der Messung und der Flush vor einer Welle sind mit
  `CorridorBuild` entfallen: Der Korridor wird je Routensatz einmal gebaut
  und eingefroren (siehe "Wann gemessen und neu gebaut wird").
- Zellhöhe, zurückgestellt (Stand 2026-09-16, im Spiel nicht aufgefallen):
  - **Füllregel über Gitterlagen:** In der Szene "Marktplatz" (ein 4 m
    breiter Streifen ohne Treffer) bleibt in 10 von 65 Gitterlagen eine
    Zelle ohne Höhe: Sie liegt zwischen keinem Paar stabiler Zellen und
    berührt keine drei. Wie viele Zellen blind bleiben, hängt von der Lage
    des Gitters ab.
  - **Loch zwischen Dachzellen:** Berühren eine Zelle ohne Höhe vor allem
    stabile Zellen auf einem Dach (jenseits des Bandrands, etwa an einem
    Knick), nimmt sie deren Median (`fillGaps`) und liegt auf dem Dach. Die
    Paar-Regel hat dasselbe Risiko. Nicht beobachtet, nicht getestet.
  - **Stationen ohne Tile:** In Erlenbach (Playtest 2026-09-15) blieben
    zwei Stationen ohne Tile-Treffer, vermutlich an einer Naht zwischen
    Tiles; sie bekommen die gröbere Stufe (Rückfall für Stationen). Der
    User will das erst wieder aufmachen, wenn es sich häuft.
  - **Rückfall-Sekunde:** Der Rückfall für Stationen kostet weiter rund
    1 s Ladezeit, auch für wenige Stationen (Paris, vier Stationen): Er
    wartet auf die gröbere Stufe und danach wieder auf die feinste (siehe
    "Wann gemessen und neu gebaut wird", Schritt 3). Für den User ist die
    Ladezeit billig.
- Die Kette der Wege quer (`chainSections` in `corridor-band.ts`):
  - Sie überbrückt Stationen ohne Weg quer, ohne Grenze für die Länge der
    Lücke; im Berliner Snapshot verbindet sie Stationen über 14 m ohne Weg.
    Eine Kette endet nur an Strecken ohne Zellen quer (Brücke, Tunnel,
    Endstück).
  - Ihre Kosten vergleicht sie der Reihe nach (`ChainCost`: Wechsel durch
    ein Objekt, dann Meter auf Erhöhtem, dann Abstand zur OSM-Linie). Ein
    langer erhöhter Weg, der überlappt, schlägt deshalb einen einzigen
    Wechsel durch ein Objekt. In den Snapshots gibt es dafür kein Beispiel.
  - Die Klemme am Rückgrat in `taperEdges` greift auch zwischen
    überlappenden Nachbarn und lässt dort Band stehen, das der Taper
    schneiden wollte: in den Snapshots bis 6,1 m ohne Säule (Stuttgart,
    Station 137) und bis 4,9 m als Straße (Shibuya, Station 205), je
    nachdem, wo die tiefste Zelle liegt.
- Die Gegnerlinie zielt auf die Bandmitte. Jedes Auto am Rand verschiebt
  diese Mitte, nach dem Entwurf um 0,5 bis 1 m; die Glättung (`smoothCentre`)
  dämpft das, weg ist es nicht.
- Auf Plätzen mit verstreuten kleinen Objekten endet das Band je Station an
  einem anderen Objekt (Entscheidung: kein Umfließen); die Kante springt von
  Station zu Station (Sägezahn). `cutShortBulges` nimmt kurze Ausbuchtungen
  weg und macht das Band damit schmaler.
