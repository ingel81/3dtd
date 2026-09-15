# Routenkorridor

**Stand:** 2026-09-15

Wie breit der Korridor aus Route-Zellen links und rechts der Mittellinie einer
Route ist, woher die Breite kommt, wann sie gemessen und neu gebaut wird und
wie man sie im Spiel prüft. Die Herleitung und die Playtest-Befunde stehen in
[ROUTE_GEOMETRY_ANALYSIS.md](archive/ROUTE_GEOMETRY_ANALYSIS.md) und
[REVIEW_SPRINT_2026-09-12.md](REVIEW_SPRINT_2026-09-12.md).

Längen in Metern. "Links" und "rechts" meinen immer die Fahrtrichtung der
Route (vom Spawn zum HQ).

## Überblick

| Schritt | Code | Ergebnis |
|---|---|---|
| Straßenbreite je Segment | `utils/route-corridor.ts` (`estimateStreetWidth`, `routeHalfWidths`), Zuordnung Segment zu OSM-Way in `PathAndRouteService.buildRouteFromPath` | Halbbreite aus OSM, Rückfall für alles, was die Tiles nicht messen |
| Messung | `PathAndRouteService.beginClearanceMeasurement` und der Lauf `ClearanceRun` (`path-route.service.ts`), Strahlen in `TerrainQueries.measureStreetClearance` (`three-engine/terrain-queries.ts`, als `engine.terrain` erreichbar) | Freiraum je Station und Seite |
| Anpassung | `fitCorridorStations`, `fitCorridorPieces`, `closeShortNarrowings` (`route-corridor.ts`), `fitRoute`, `applyClearance` (`path-route.service.ts`) | Segmente geteilt, wo sich eine Seite ändert; Halbbreite links und rechts je Stück; kurze Engstellen geschlossen |
| Waypoints | `PathAndRouteService.buildRouteFromPath` | `corridorLeft`, `corridorRight`, `onBridge`, `inTunnel` am Waypoint, gültig für das Segment ab dort (`RouteWaypoint`, `models/game.types.ts`) |
| Unterführung | `utils/underpass.ts` (`UnderpassIndex`, `splitAtSpans`), `PathAndRouteService.buildRouteFromPath` | Stück unter einem Way, der die Route auf höherer Ebene kreuzt, als Tunnel |
| Zellen | `GlobalRouteGrid.generateFromRoutes` (`global-route-grid.ts`) | 2-m-Zellen im Korridor |
| Zellhöhe | `RouteCellSampler.sampleCellY` (`route-cell-sampler.ts`), `utils/deck-approach.ts` | Boden, Brückendeck und die Strecke hinter seinem Ende, Tunnelsohle, Straße unter einer fremden Brücke |
| Laufweg | `cellWalkable`, `walkCaps` (`utils/corridor-walk.ts`), `PathAndRouteService.narrowToWalkable`, `CorridorController.rebuildCorridors` | Zellen, zu denen kein Gegner laufen kann (Auto, Traufe, Hecke, Böschung), fallen weg; die Halbbreite endet davor |
| Umweg | `planDetours`, `applyDetourPlan` (`utils/corridor-detour.ts`), `PathAndRouteService.detoursWithGrid` | Die Waypoints biegen um ein Hindernis auf der Mittellinie (Auto, Hecke, Erker, Dachecke); ohne Platz wird ein Hindernis über der Gasse ein Durchgang (Tunnel), ein niedriges bleibt |
| Gegner | `MovementComponent.advance` (`movement.component.ts`), `getRouteProfile` (`route-corridor.ts`) | Seitenversatz innerhalb der Zellen |
| Auslöser | `CorridorRefit` (`services/world/corridor-refit.ts`), verdrahtet in `CorridorController` (`services/world/corridor-controller.ts`), den `VisualizationFacadeService` hält | Wann gemessen und neu gebaut wird |

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
| `roofRise` | 2,5 | 0,5 bis 50 | Dach-Check: so weit über der Mittellinie daneben ist eine Zelle nicht begehbar (siehe Laufweg) |
| `stepRise` | 0,5 | 0,1 bis 50 | Stufen-Check: höchste Stufe je Rasterschritt (2 m) auf dem Weg zur Zelle (siehe Laufweg; bis 2026-09-14 0,75) |
| `stepDrop` | 0,5 | 0,1 bis 50 | Abfall-Check: tiefster Abfall je Rasterschritt auf dem Weg zur Zelle (siehe Laufweg; bis 2026-09-15 ohne Grenze); 50 schaltet ihn praktisch ab |
| `highwayWidths` | Tabelle unten | je bis 50 | Straßenbreite je `highway`-Klasse |
| `unknownHighwayWidth`, `laneWidth`, `laneExtra` | 5, 3, 1 | 1 bis 50, 1 bis 10, 0 bis 10 | Breite unbekannter Klassen, Spurbreite, Zuschlag bei `lanes` |

`MEASUREMENT_KEYS` (`route-corridor.ts`) sind die Werte, deren Änderung
eine neue Messung braucht: `stationSpacing`, `rayHeightLow`, `rayHeightHigh`,
`maxHalfWidth`, `maxTileError`, `overhangDepth` und `lowWallRise` (der
gespeicherte Freiraum entsteht beim Messen aus den Treffern), `roofRise`, `stepRise` und `stepDrop` (die
gespeicherten Kappen des Laufwegs entstehen aus den Zellen, siehe Laufweg).
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
2. Je Strahlhöhe ein waagrechter Strahl nach links und einer nach rechts, in
   1 m und 3,5 m über der Fläche, auf der die Zellen dort stehen (`surfaceY`,
   siehe Zellhöhe), jeder `maxHalfWidth` lang. Das ist der Boden der Säule,
   auf einer Brücke ihre Oberkante `topY`. Auf der Strecke hinter einem
   Brückenende (`approach`) ist es der Treffer, der der Höhe am nächsten
   liegt, die die Route vom nächsten Brückenende bis zur Station trägt
   (`carriedDeckY`, siehe Zellhöhe); dafür nimmt die Station die Säulen am
   Brückenende und entlang der Route bis zu ihr dazu, bei einer Naht mit
   denselben Verschiebungen. Hat die Säule am Brückenende kein Tile bis
   `maxTileError`, ist die Station `unmeasured: 'no bridge end'` und kommt
   beim nächsten Lauf wieder dran. Teilen sich Routen ein Segment, liegt
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
`maxRight`, wie bei den Kappen des Laufwegs). `__corridor.pick()` nennt es
mit `short narrowing closed` in `rule`.

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

- **Naht zwischen zwei Tile-Meshes** (`RouteCellSampler.sampleCellY`,
  `CELL_PROBES_M`): Findet die Säule am Mittelpunkt kein Tile oder nur einen
  Treffer, den die Nachbarn ablehnen (unten), versucht die Zelle die Säulen
  0,5 m daneben in x und z und nimmt die erste, die einen annehmbaren
  Treffer gibt. Höchstens vier weitere Säulen, nur für solche Zellen. Die
  Säulen des Laufweg-Checks und die Portalproben eines Tunnels machen es
  ebenso. Liegt der Mittelpunkt in keiner Bounding Box
  eines Tiles, überspringt der Sweep die Zelle wie bisher ohne Probe.
- **Ausreißer** (`plausible`): Ein Treffer mehr als 50 m (`OUTLIER_M`) vom
  Median der stabilen Nachbarn derselben Fläche entfernt zählt nicht. Für
  die erste Probe einer Zelle und für ein LOD-Upgrade zählen nur Nachbarn
  aus mindestens so tiefen Tiles, damit eine grobe Hülle ringsum ein
  feineres Sample nicht verhindert. Vorher lief der Test nur für stabile
  Zellen ohne Upgrade; im Playtest 2026-09-13 stand eine Zelle so auf
  -3542 m zwischen Zellen auf 243 m. Der Laufweg-Check urteilt nicht über
  eine Zelle mehr als 50 m über oder unter der Mittellinie daneben.
- **Lücken füllen** (`GlobalRouteGrid.fillGaps`, nach dem Erzeugen, am Ende
  jedes Sweeps und nach einem Retry mit Promotion): Eine Zelle ohne
  annehmbares eigenes Sample, zwischen stabilen Zellen derselben Fläche auf
  gegenüberliegenden Seiten (west-ost, süd-nord, die zwei Diagonalen),
  bekommt den Mittelwert dieser Paare und den Zustand `filled`. Sie zählt
  als Zelle mit Höhe (`heightSampled`: LOS-Anzeige, Gegner, Overlay ohne
  rosa Kontur), das Sampling versucht sie weiter wie eine ungesampelte und
  ersetzt die Füllung durch das erste Sample, das es annimmt. Gefüllt wird
  nur aus stabilen Zellen, eine Füllung breitet sich also nicht aus; eine
  Lücke breiter als eine Zelle bleibt ohne Höhe. Eine stabile Zelle mehr als
  50 m neben ihren Nachbarn aus mindestens so tiefen Tiles (ein Treffer, der
  vor ihnen kam) wird ebenso gefüllt oder, ohne Paar, wieder `unsampled`.
  Tunnelzellen bleiben, wie sie sind.

Ausnahmen:

- **Dach, Traufe, Krone, Auto, Hecke:** Die Zelle behält den untersten
  Treffer ihrer Säule, auch wo er auf deren Oberseite liegt, weil die
  Photogrammetrie darunter keinen Boden hat. Gegner laufen dort nicht: Der
  Korridor endet vor einer solchen Zelle (siehe Laufweg).
- **Mittellinie unter einer Auskragung oder an einer Dachecke:** Eine
  Zelle, durch die eine Mittellinie läuft, nimmt statt eines Treffers mehr
  als `roofRise` über der Höhe der Mittellinie ringsum (`centreLineGround`,
  siehe Laufweg) diese Höhe, mit dem LOD des Treffers (`streetUnderRoof` in
  `corridor-walk.ts`, angewandt in `RouteCellSampler.sampleCellY`). Solche
  Zellen kann der Korridor nicht weglassen, er nimmt sie bei jeder Breite,
  und Gegner nehmen ihre Höhe aus der Zelle, in der sie stehen. In
  Rothenburg (Retest 560 bis 563) lag so eine Zelle unter einer Auskragung
  5,7 m über der Straße (Pick C) und eine an einer Dachecke, die die Linie
  anschneidet, 7,6 m (Pick B); beide weiß im Overlay, die Gegner stiegen
  hinauf. Eine Steigung entlang der Linie steigt von Stelle zu Stelle weit
  weniger als `roofRise`, und der Median über je zwei Stellen davor und
  danach lässt bis zu zwei hohe Stellen in Folge aus dem Bezug heraus, die
  Zelle und eine Nachbarin. Eine Baumkrone über der Straße ist derselbe
  Fall (Playtest Erlenbach). `__corridor.pick()` zeigt sie mit
  `walkCheck: 'centre line on a roof'`, `heightM` auf der Straße und
  `columnBottomM` auf der Auskragung. Eine Urteilsfrage: Die
  Nutzerentscheidung vom 2026-09-14 ("Orange Zellen weglassen") galt
  Randzellen, die wegfallen können; diese Zellen können es nicht. Seit der
  Entscheidung E6 (2026-09-15) planen die Routen um solche Stellen herum
  (siehe "Hindernis auf der Mittellinie"): Mit Platz daneben liegt dort keine
  Mittellinie mehr, ohne Platz ist die Zelle eine Tunnelzelle eines
  Durchgangs. Diese Regel bleibt für den ersten Bau vor der Planung und für
  eine Stelle, die die Planung nicht erfasst. Auf der
  Strecke hinter einem Brückenende (`approach`, unten) ist der Bezug die
  Höhe, die die Route dort trägt (`carriedDeckY`), nicht die Mittellinie
  ringsum: Die Mittellinie um die letzten Zellen der Strecke reicht über sie
  hinaus auf Bodenzellen, deren unterster Treffer unter einem
  weiterreichenden Deck der Kai sein kann, und der Median zöge eine Zelle
  auf dem Deck dorthin. Deck- und Tunnelzellen behalten ihren Treffer.
- **Brückendeck:** Segmente über einen Way mit `bridge=*`
  (`PathAndRouteService.buildRouteFromPath`) tragen `onBridge`, ihre Zellen die Fläche
  `deck` und nehmen die Oberkante der Säule (`topY`) statt des Bodens
  (`RouteCellSampler.sampleCellY` über `surfaceY`). Wo Brücke und Zufahrt aneinanderstoßen,
  nimmt eine Zelle die Fläche des Segments, entlang dessen Länge sie liegt;
  das runde Ende des anderen ändert sie nicht (`claimSegmentCells`,
  `alongClaims`). Erreichen zwei Segmente eine Zelle beide entlang ihrer
  Länge (eine Straße unter der Brücke) oder beide nur mit dem runden Ende,
  gilt die tiefere Fläche: Boden vor Strecke hinter dem Brückenende vor Deck
  (`SURFACE_ORDER`). Vorher gewann der Boden immer: Das runde Ende der
  Zufahrt (bei 7 m Halbbreite 7 m weit) machte die ersten Meter des Decks zu
  Bodenzellen, und die nahmen den untersten Treffer, den Kai oder Fluss
  unter dem Deck (Playtest 2026-09-14, Paris, siehe "Linie, Zellen und
  Gegner verschwinden").
- **Strecke hinter dem Brückenende** (`approach`, `utils/deck-approach.ts`):
  Das Bauwerk einer Brücke reicht oft über das Ende ihres OSM-Brücken-Ways
  hinaus, die Ways dort tragen kein Brücken-Tag. Ein Segment, das an einem
  Ende einer Folge von Brückensegmenten weiterläuft, gehört bis
  `DECK_APPROACH_M` (60 m) entlang der Route zur Strecke, gleich wie die
  Route abbiegt, solange es weder Brücke noch Tunnel ist (`deckApproaches`).
  Seine Zellen tragen die Fläche `approach` und in `deckEnd` die Route vom
  Brückenende bis zu ihnen (`path`, `m`).
  - **Getragene Höhe** (`carriedDeckY`): Sie beginnt mit der Oberkante der
    Säule am Brückenende und folgt der Route alle `DECK_STEP_M` (2 m). An
    jeder Stelle nimmt sie den Treffer der Säule dort, der ihr am nächsten
    liegt, wenn er höchstens `DECK_STEP_RISE_M` (1,5 m) von ihr abweicht;
    sonst, und ohne Säule, bleibt sie. So geht sie eine Treppe hinunter
    (etwa 1,2 m je 2 m) und eine Rampe hinauf, fällt aber nicht durch eine
    Lücke im Mesh auf die Straße unter einem Platz und steigt nicht auf
    eine Krone oder ein Auto ohne Boden darunter.
  - **Höhe der Zelle** (`deckApproachY`): der Treffer ihrer Säule, der der
    getragenen Höhe an ihrem Routenpunkt am nächsten liegt. Über einer
    tieferen Straße oder dem Kai ist das die Oberkante; eine Straße auf
    Deckhöhe liegt näher als Krone, Laterne, Statue oder Auto darüber; eine
    Treppe hinunter zum Kai behält ihre Stufen und der Kai unter einem Deck
    seinen Boden. Die LOD ist die gröbere der Säulen von Zelle und
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
- **Tunnel und überdachte Durchgänge:** `runsUnderCover`
  (`route-corridor.ts`) gilt für `tunnel=*` außer `no` (also auch
  `building_passage`) und für `covered=yes`. Solche Segmente tragen `inTunnel`
  und werden nicht vermessen, es gilt die OSM-Breite. Ihre Zellen haben die
  Fläche `tunnel`.
  - **Höhe:** linear zwischen dem Boden an zwei Portalen, je 2 m vor den
    Mündungen des ganzen Tunnelstücks (`TUNNEL_PORTAL_OFFSET_M`,
    `tunnelSegments` in `route-grid-builder.ts`). Die Höhe hat die gröbere
    LOD der beiden Portale (`tunnelColumn`, `route-cell-sampler.ts`).
  - **Portal unter einem Dach** (seit 2026-09-15): Liegt der Boden der
    Säule an einem Portal mehr als `roofRise` über der Höhe der Mittellinie
    ringsum (`centreLineGround`, ohne Tunnelstellen, siehe Laufweg), nimmt
    das Portal diese Höhe (`streetUnderRoofAt` in `corridor-walk.ts`), wie
    eine Zelle der Mittellinie unter einer Auskragung. Anlass: Playtest
    2026-09-15 (Retest 607, Rothenburg), Torbogen: Die gelben Zellen
    stiegen im Durchgang an, die Gegner kamen auf der anderen Seite aus
    der Hauswand. 2 m vor einer Mündung kann die Säule auf der Auskragung
    des Hauses landen, durch das der Durchgang führt, oder auf dem Haus
    selbst, wo der OSM-Way vor der Öffnung endet; ihr unterster Treffer
    ist dann das Obergeschoss, und alle Zellen des Durchgangs lagen auf
    der Geraden dorthin (nachgestellt in `global-route-grid.spec.ts`,
    "takes a portal under a jetty from the street around it"). Der Boden
    ringsum kommt aus den Stellen der Mittellinie hinter der Mündung; die
    Zellen bis 3 m hinter der Mündung gehören noch zum Tunnel (rundes
    Ende) und zählen nicht.
  - **Ohne Portal-Tile:** Solange an einem der beiden Portale kein Tile
    liegt, bleibt die Zelle ohne Höhenprobe.
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
  - Kein Laufweg-Check.
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
    Messung, OSM-Breite, kein Laufweg-Check, `closeShortNarrowings` lässt
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

**Prüfung** (`judgeWalk`, `cellWalkable`, `utils/corridor-walk.ts`): für
jede Zelle mit Fläche `ground` oder `approach` und einer eigenen Probe aus
einem Tile bis `maxTileError`, durch die keine Mittellinie läuft. Bezug ist die Höhe der
Mittellinie neben der Zelle (`centreLineGround`): der Median über die
Mittellinien-Stelle daneben (`axisX`, `axisZ`, beim Anlegen festgelegt) und
die Mittellinien-Stellen bis zwei Rasterschritte um sie (5×5), bei gerader
Anzahl der untere der beiden mittleren. Auf einer Linie sind das die Stelle
und je zwei davor und danach. Mit nur je einer (3×3) kippte der Median, wo
eine Baumkrone über der Straße zwei Stellen in Folge abdeckt: Randzellen
in der Krone lagen unter dem Bezug und blieben (Playtest Erlenbach,
Weinstraße und Erlenweg, einzelne weiße Zellen in Kronen neben der Straße;
nachgestellt in `integration/corridor-walk.spec.ts`). Drei hohe Stellen in
Folge, etwa 6 m Krone über der Linie, kippen ihn weiter. Jede Stelle zählt
mit der Fläche ihrer Zelle wie beim
Sampeln (`surfaceY`, `deck-approach.ts`): der unterste Treffer, auf einem
Brückendeck der oberste, auf der Strecke hinter einem Brückenende
(`approach`) der, der der getragenen Höhe dort am nächsten liegt; eine
Tunnelstelle zählt nicht. Mit dem untersten Treffer auch der Deck-Stellen
lagen an einem Brückenkopf auf einer schrägen Linie Randzellen 8 m über dem
Median, dem Wasser unter dem Deck (Spec). Bis 2026-09-14 war es die eine Stelle.
Lag sie unter einer Auskragung, deren Säule keinen Boden hat, zählte deren
Unterseite: In Rothenburg (Retest 560 bis 563, Pick C) lag die Stelle 5,7 m
über der Straße, und eine Zelle 2 m über der Straße unter einer Traufe
bestand den Check. Auf der Strecke hinter einem Brückenende steht auch der
Weg nach außen auf dem Treffer, den eine Zelle dort nähme (`walkSurface`):
auf dem Deck, nicht auf dem Kai darunter. Sonst läge eine Randzelle auf dem Deck
10 m über dem Kai und fiele als Dach weg.

- **Dach-Check:** Liegt die Zelle mehr als `roofRise` (2,5 m) über der
  Höhe der Mittellinie daneben, ist sie nicht begehbar: Dach, Traufe,
  Krone.
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
  - **Erhöhte Mittellinie** (`groundBesideRaisedLine`, seit 2026-09-15):
    Liegen der erste Schritt zur Zelle hin und sein Spiegelbild beide mehr
    als `stepDrop` unter der Höhe der Mittellinie, steht die Linie auf
    etwas, von dem der Boden zu beiden Seiten abfällt: eine Reihe parkender
    Autos, über die der OSM-Weg läuft, eine Hecke. Dann beginnt der Weg auf
    dem Boden daneben, der Mitte der beiden Stellen, so bleibt die
    Querneigung. Liegen die beiden mehr als 2 × `stepRise` auseinander
    (eine Seite fällt weit, Kaimauer, Böschung), beginnt er auf der höheren.
    Anlass: Playtest 2026-09-15 (Retest 706 bis 708, Rothenburg und
    Erlenbach), parkende Autos hatten mehr Zellen als in 607. Liegen drei der
    fünf Mittellinien-Stellen auf Autos, steht der Median auf den Dächern.
    Mit dem Abfall-Check lag jede Zelle der Straße daneben mehr als eine
    Stufe darunter (`drop`), der Korridor bestand dort nur aus den
    Mittellinienzellen auf den Dächern; vorher ging der Weg jede Stufe
    hinab. Synthetisch (Reihe 9,2 m auf der Linie, 1,5 m hoch, Straße eben):
    je Seite 15 Zellen neben der Reihe vorher, 0 mit dem Abfall-Check, 15
    jetzt. Ein Auto am Rand neben so einer Reihe misst jetzt von der Straße
    aus und fällt weg; vorher maß es von den Dächern und blieb. Zellen genau
    einen Schritt neben der Linie und auf ihrer Höhe prüft der Weg ohne
    Proben (siehe oben), für sie gilt der Median weiter. Eine Straße auf
    einem Damm, der schon im ersten Schritt zu beiden Seiten mehr als
    `stepDrop` fällt, misst ebenso von den Seiten aus.
- **Kein Urteil** (`null`): Zellen, durch die eine Mittellinie läuft,
  auch wenn sie nur eine Ecke anschneidet (`centreLineKeys`; der Korridor
  nimmt sie bei jeder Breite, `walkCaps` lässt sie aus), Deck und Tunnel,
  Strecke hinter einem Brückenende ohne Säule dort (`no bridge end`),
  gefüllte und ungesampelte Zellen, Zellen aus Tiles gröber als
  `maxTileError` (ein grober Klumpen engt nichts ein; sie kommen dran,
  sobald ein feineres Tile da ist), eine Zelle ohne Säule an der
  Mittellinie oder mehr als `OUTLIER_M` von ihr entfernt (Naht). Bis
  2026-09-14 galt nur eine Zelle als Mittellinie, deren `axisX`/`axisZ`
  sie selbst ist. Schneidet die Linie nur eine Ecke an, liegt der nächste
  Punkt der Linie oft in der Nachbarstelle: Die Zelle wurde geprüft, als
  nicht begehbar gemeldet und blieb trotzdem (Rothenburg, Pick B, Dachecke
  7,6 m über der Straße).

Die Zelle selbst behält ihre Höhe (`sampleCellY` nimmt den untersten
Treffer). `clamped`, `stepTop` und die orange Kontur gibt es nicht mehr;
die Boden-Probe der Tower-LOS liegt wie überall 1,5 m über der Zelle
(`getGroundTargetY`).

**Vom Grid auf die Breite** (`walkCaps`,
`PathAndRouteService.walkCapsWithGrid`): Jede nicht begehbare Zelle kappt
auf ihrer Seite die Station, deren Stück sie beansprucht: entlang eines
Segments die Station dort, hinter einem Segmentende die Station an diesem
Ende, wenn dessen rundes Ende (`jointCap`, mit den Breiten in Gebrauch) die
Zelle erreicht; an einer Ecke, deren runde Enden sie beide erreichen, nur
das frühere Segment. Die Kappe ist der Abstand der Zelle zur Mittellinie
(hinter einem Ende zum Endpunkt) weniger 0,09 m: So weit reicht das runde
Ende eines Nachbarstücks über dessen Halbbreite hinaus (halbe
Zelldiagonale mal `hypot(1, taper)` weniger `edgeMargin`), dazu 1 cm. Das
gilt, solange die Kappe mindestens `edgeMargin` ist. Darunter ist die
Grenze der Gegner dort 0, und das runde Ende der Nachbarstation reicht
trotzdem 1,58 m weit (`jointCap`). Darum kappt `walkCaps` danach jede
Station, deren rundes Ende an einem Stoß (zwei Segmente, oder zwei
Stationen eines Segments, die auf einer der beiden Seiten verschieden
breit sind: Ändert sich nur die rechte Seite, reicht das runde Ende links
so weit, wie die Nachbarstation links erlaubt, auch über ein kurzes Stück
hinweg in eine links schmale Strecke) oder deren Ende
genau an der Zelle sie noch erreicht, auf ihren Abstand weniger 1 cm, bis
sich nichts mehr ändert (`roundEndsOff`). Vorher blieb in einer schmalen
Gasse eine Autozelle 1,5 m neben der Linie stehen, wo zwei Stationen
aneinanderstoßen. Eine Zelle, durch die eine Mittellinie läuft, bleibt;
der Korridor nimmt sie bei jeder Breite. Gespeichert je Segment, Station und Seite in
`walkBySegment`, nur je schmaler, vergessen mit den Messungen
(Ortswechsel, `clearCorridorMeasurements`, `__corridor.set()` mit einem
der `MEASUREMENT_KEYS`).

**In der Anpassung** (`fitCorridorStations`): Die Kappe gilt nach allen
anderen Regeln, abgerundet auf `widthStep`, auch unter `minHalfWidth`, und
ohne Glättung: Ein Auto engt den Korridor auf seiner Länge ein, auch unter
`dipLength`. `closeShortNarrowings` weitet ein Stück höchstens bis zu seiner
Kappe (`maxLeft`, `maxRight`). Weil der Korridor je Seite ein Band ist,
fällt alles dahinter mit weg, auch der Gehweg hinter einer Autoreihe.
Gegner halten sich an die schmalere Breite wie an jede andere
(`lateralLimit`; `route-corridor-coverage.spec.ts`,
`integration/corridor-walk.spec.ts`).

**Wann** (Rückkopplung Messung, Grid, Breite, Neubau):

- Am Ende jedes Messlaufs (`storeClearance`), mit dem Grid, das gerade
  steht.
- Nach jedem Neuaufbau (`CorridorController.rebuildCorridors`, Schritt
  `walk`): Die neuen Zellen können weiter reichen als die alten, etwa wenn
  die erste Messung über die OSM-Breite hinaus verbreitert. Dann Routen,
  Grid und Höhen noch einmal, bis sich kein Korridor mehr ändert, höchstens
  `MAX_WALK_PASSES` (2) weitere Male. Die Kappen werden nur schmaler, ein
  weiterer Bau hat also nur Zellen des vorherigen. Braucht er alle, ruft
  er `CorridorRefit.remeasureLater` auf: nach 3 s ein `remeasure()`, das
  nur misst, wo `hasUnwalkableCells` noch eine Zelle findet, die ein
  schmalerer Korridor wegnähme. Vorher wartete der Rest auf den nächsten
  Tile-Schub, der bei stehender Kamera nicht kommt.
- Nach einem Tile-Schub (`remeasure()`): Zeigt ein feineres Tile Zellen, zu
  denen kein Gegner laufen kann und die ein schmalerer Korridor wegnähme
  (`hasUnwalkableCells`), misst `remeasure()` wie bei ungemessenen
  Stationen; der dann leere Lauf speichert die Kappen, der Neuaufbau folgt.
- Nicht unter Tower, Welle oder Gegnern (`rebuildBlocker`). Was ein
  feineres Tile erst dann zeigt, bleibt im Korridor, auf seiner Höhe
  (Autodach, Traufe), bis zum nächsten Neuaufbau. `__corridor.towerCells()`
  zählt es unter `unwalkable`, `pick()` zeigt `walkable: false`.

**Kosten:** In einer Spec ohne Engine (1 km Route mit Knicken, 7 m je
Seite, 3714 Zellen, ein Auto alle 12 m, Median aus 7 Läufen) kostete die
Prüfung aller Zellen 1,2 ms und die Kappen 0,1 ms; Grid erzeugen und
voller Höhen-Sweep in derselben Spec 6 und 5 ms. Mit dem Median über die
Mittellinie (bis zu 25 Säulen je Achsstelle, je Durchgang einmal je
Stelle gemerkt) kostete die Prüfung in einer ähnlichen Spec (3714 Zellen,
227 nicht begehbar, Median aus 9 Läufen, nicht committet) 1,1 ms, mit dem
3×3 0,8 bis 0,9 ms, mit der einen Stelle 0,45 ms; ohne das Merken waren es
mit dem 3×3 1,8 ms. Im Spiel liest die Prüfung
die Säulen aus dem Cache der Engine, den das Grid im selben Frame gefüllt
hat; nicht gemessen. Teuer ist ein zusätzlicher Bau: nach den Zahlen vom
2026-09-12 (routes 14, grid 10, heights 4 bis 6 ms) etwa 30 ms, synchron im
selben Frame, und nur, wenn eine nicht begehbare Zelle einen Korridor
ändert. `[Corridor] rebuild` nennt ihn mit `walk=` und `narrowed=`.

## Hindernis auf der Mittellinie: Umweg und Durchgang

Seit 2026-09-15, Nutzerentscheidung E6 nach dem Playtest (Retest 706 bis 708): "Es
soll realistisch sein, das 3D-Modell gilt." Code: `utils/corridor-detour.ts`
(`planDetours`, `applyDetourPlan`, `derivedClearance`), `PathAndRouteService`
(`detoursWithGrid`, `detoured`, `measuredOf`).

**Anlass:** Die OSM-Linie einer Straße läuft über etwas, das die Photogrammetrie auf
der Straße zeigt: parkende Autos (Erlenbach, Schulstraße, Way 959083801:
Mittellinienzellen 0,59 bis 1,08 m über der Linie, `walkCheck: 'centre line'`),
Erker und Dachecken (Rothenburg). Der Korridor nimmt eine Zelle, durch die die Linie
läuft, bei jeder Breite. Die Gegner stiegen über das Auto, die rote Linie nahm seine
Dachhöhe.

**Hindernis** (`judge`, `streetBeside`): Alle `DETOUR_SAMPLE_M` (1 m) entlang der
Route, wie das Straßennetz sie gibt, eine Säule auf der Linie (nur Tiles bis
`maxTileError`). Straße neben der Stelle heißt: zu dieser Seite bis 3 m die erste
Säule mehr als `stepRise` unter dem Treffer, und 1 m weiter außen fällt der Boden
nicht um mehr als `stepDrop` (kein Damm, kein Grat). Ein Hindernis ist dort:

- ein Treffer mehr als `roofRise` über dem Boden der Linie ringsum (Median der
  Stellen bis 4 m davor und danach): Erker, Dachecke, Krone über der Linie;
- sonst ein Treffer mit Straße zu beiden Seiten, beide höchstens `stepRise`
  auseinander. Das trifft Auto, Transporter, Hecke, Mäuerchen. Diese Regel hat der
  Worker carcells als O1 an den Wächtern geprüft;
- sonst ein Treffer mit Straße nur auf einer Seite, während die andere steigt oder
  weit fällt (Garten oder Mauer hinter einer Autoreihe, Kaimauer). Dann muss die
  Stelle ein Buckel entlang der Linie sein: Bis `BUMP_REACH_M` (6 m) davor und
  danach kommt die Linie mehr als `stepRise` herunter (`raisedAlong`; ein Auto ist
  4,5 m lang, zwei Stoß an Stoß 9 m). Und die Linie muss dort bis auf `stepRise` an
  diese Straße herankommen (`reachesAlong`). Ein Gehweg auf einer Stützmauer oder
  eine Straße quer an einem steilen Hang ist kein Buckel; ein Kai unter einer Straße
  ist kein Boden, auf den die Linie herunterkommt. Anlass: Playtest 719, Erlenbach,
  Erlenbacher Weg (Way 959083801). Die Linie läuft an der Südkante einer Autoreihe
  entlang, dahinter liegt der Boden 1,6 bis 2,6 m höher. Der Laufweg begann dort auf
  den Dächern, weil nur eine Seite tiefer liegt (`groundBesideRaisedLine` braucht
  beide). Die Straße daneben war `drop`, und die Kappen rissen einzelne Löcher in
  den Korridor. Mit dem Umweg liegt die Mittellinie auf der Straße und der Laufweg
  misst von dort.

Stellen bis `JOIN_M` (2 m) auseinander sind ein Hindernis. Gesucht wird nur auf
Straßen am Boden: nicht auf einer Brücke, im Tunnel, auf der Strecke hinter einem
Brückenende oder auf dem Endstück zum HQ.

**Platz daneben** (`offsetFor`, `pickSide`): Der Weg rückt um das kleinste Maß in
Schritten von 0,5 m zur Seite, bei dem an jeder Stelle des Hindernisses und 2 m
davor und danach (`HOLD_MARGIN_M`) die Säulen bis 1,5 m zu beiden Seiten des Weges
Straße zeigen. Straße heißt: höchstens `stepRise` über und `stepDrop` unter dem
Boden daneben, mit dessen Querneigung, und innerhalb der Breite, die die Strahlen
dort erlauben, plus `wallMargin`. Die Breite zählt ohne die Kappen des Laufwegs,
denn die legen sich um das Hindernis selbst. 1,5 m ist die halbe Zelldiagonale
(1,41 m) auf dem 0,5-m-Raster der Säulen: Eine Zelle, die der Weg berührt, hat ihren
Mittelpunkt höchstens so weit neben ihm, ihre Höhe kommt also von der Straße.
Gewählt wird die Seite mit dem kleineren Maß, bei gleichem die mit mehr Platz, dann
rechts. Ein Auto von 1,8 m mittig auf der Linie braucht 2,5 m. Eine Säule ganz ohne
Treffer (ein Loch im Mesh, im Playtest 719 die Zellen (413, 25) und (413, 27)) zählt
nicht als Hindernis, solange mindestens die Hälfte der Säulen im Band einen Treffer
hat. Eine Zelle dort bekommt wie an einer Naht die Höhe ihrer Nachbarn (`fillGaps`),
wo auf zwei gegenüberliegenden Seiten stabile Zellen liegen; sonst bleibt sie ohne
Höhe (rosa), die Gegner nehmen dort den Median der Nachbarn. Der Laufweg überspringt
Säulen ohne Treffer und urteilt über eine Zelle ohne eigene Probe nicht, sie reißt
also keine Lücke in den Korridor.

**Umweg:** Das Maß gilt entlang des Hindernisses, davor und danach liegt eine Rampe
als halbe Kosinuskurve. Ihre engste Krümmung ist der Radius, mit dem der Wurm eine
Ecke rundet (`WORM_BEND_RADIUS_M`, 20 m): `rampLength` = π·√(Maß · 10 m), 15,7 m
für 2,5 m. Die starren Ringe des Wurms klaffen an einer schärferen Biegung auf; das
Band der Ooze dreht mit den Segmenten. Die Rampe bekommt alle `RAMP_STEP_M` (1 m)
einen Waypoint.

- Liefe die Rampe über ein anderes Hindernis, versucht sie 75 % und 50 % der Länge,
  mindestens das Doppelte des Maßes. Sonst entfällt der Umweg.
- Hindernisse auf derselben Seite, deren Rampen sich träfen (Autoreihe mit Lücken),
  werden ein Umweg mit dem größeren Maß, wo das überall frei ist. Sonst, und auf
  verschiedenen Seiten, geht der Weg in einem Stück von einem Maß zum anderen.

**Kein Platz:**

- Ein Hindernis mehr als `roofRise` hoch (Erker oder Dach über der Gasse, darunter
  vom Mesh gefüllt) wird ein **Durchgang**. Das Stück vom Hindernis bis 1 m davor und
  danach (`PASSAGE_MARGIN_M`) läuft als Tunnel (`inTunnel`, dazu `passage`), wie ein
  Torbogen: Höhe zwischen zwei Portalen 2 m vor den Mündungen, gelb im Overlay, nicht
  vermessen, OSM-Breite. Im gefüllten Mesh sind die Gegner kurz verdeckt.
- Ein niedrigeres Hindernis (ein Auto, das eine schmale Gasse ausfüllt) bleibt: Die
  Zellen stehen auf ihm, die Gegner steigen darüber, wie das Modell es zeigt.

**In der Route** (`applyDetourPlan`, `PathAndRouteService.detoured`): Die Route wird
an den Enden der Stücke und entlang der Rampen geteilt, jeder Schnitt um das Maß dort
zur Seite gesetzt, ein Punkt der Route innerhalb eines Umwegs entlang der Gehrung
seiner beiden Segmente. Die übrigen Segmente bleiben, wie sie waren.

- Jedes neue Segment trägt die Flags, die Straßenbreite und den Way des
  Straßensegments, auf dem es liegt (`parent`), dazu `detour` am Waypoint.
- Seine Stationen kommen aus der Messung dieses Straßensegments (`measuredOf`,
  `derivedClearance`): etwa gleich viele je Meter, der Freiraum der Station dort um
  das Maß verschoben. Eine Wand links liegt vom nach rechts gerückten Weg weiter weg,
  eine rechts näher. Ein Strahl ohne Treffer meldet seine Länge; auf der Seite, zu der
  der Weg rückt, reicht der Korridor also nicht weiter hinaus, als die Strahlen
  gesehen haben. Gemessen wird weiter nur die Route, wie das Straßennetz sie gibt.
- Die Kappen des Laufwegs gelten je neuem Segment. Das Hindernis liegt jetzt neben
  der Mittellinie und fällt als `step` oder `roof` weg wie ein Auto am Rand.
- Zellen, Seitenversatz, Wurm, Ooze, Held und rote Linie folgen den Waypoints ohne
  eigene Regel.

**Wann** (`detoursWithGrid`): zur selben Zeit wie die Kappen des Laufwegs, mit den
Säulen des Grids in Gebrauch: nach jedem Bau (`narrowToWalkable`, Schritt `walk` in
`rebuildCorridors`), am Ende eines Messlaufs (`storeClearance`) und bei `remeasure()`
(`hasUnwalkableCells`). Gespeichert je Route, wie das Straßennetz sie gibt
(`detourPlans`). Jeder Bau derselben Route setzt bis zur nächsten Planung dieselben
Umwege ein, auch ein Neubau der roten Linie nach einer Höhenänderung. Unter Tower,
Welle oder Gegnern wird nichts neu gebaut (`rebuildBlocker`). Ein neuer Umweg braucht
einen Bau zum Finden und einen für die Kappen um das Hindernis; mit
`MAX_WALK_PASSES` (2) prüft `remeasureLater` den Rest. Vergessen mit den Messungen.

**Diagnose:** `__corridor.pick()` nennt eine Zelle auf der Mittellinie eines Umwegs
`walkCheck: 'detour'`, eine Zelle eines Durchgangs `'passage'`. Die Station zeigt
`detourM` (Maß, rechts positiv, `null` auf der Linie) und `passage`; ihre Treffer
sind die der Straßenstation dort, um das Maß verschoben.

**Kosten:** je Planung eine Säule je Meter Route, dazu je Hindernisstelle bis 12
Säulen quer und je geprüftem Maß 7 Säulen je Stelle, nach dem ersten Mal aus dem
0,5-m-Cache der Engine. Nicht im Spiel gemessen.

**Tests:** `utils/corridor-detour.spec.ts` (Regeln), `integration/corridor-detour.spec.ts`
(ganze Kette mit Routendienst und Grid: Auto mit Platz, Auto in der Gasse, Erker über
der Gasse, Dachecke, Auto am Rand), `managers/worm/worm-detour.spec.ts` (Wurm durch den
Umweg).

## Seitenversatz der Gegner

Jeder Gegner bekommt beim Spawn einen Faktor in [-1, 1]: Zufall mal
`lateralSpread` seines Typs (`EnemyManager.spawnOne`,
`enemy-types.config.ts`: 0,5 bis 1,0; beim Wurm, dessen Kette als Ganzes schwingt, und bei der Ooze 0). Negativ heißt links, positiv
rechts der Fahrtrichtung, 0 die Mittellinie.

Der Versatz in Metern ist Faktor mal die seitliche Grenze an der aktuellen
Stelle, auf der Seite, auf der der Gegner läuft (`MovementComponent.advance`).

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
  schmalen Waypoint seitlich zu springen.
- **Mittellinie:** Unter 1,5 m Halbbreite ist die Grenze 0. An einer
  einzelligen Engstelle laufen alle Gegner auf der Mittellinie.
- **Kosten:** Die Grenzen werden einmal je Pfad-Array berechnet und geteilt
  (`getRouteProfile`, WeakMap). Im Sub-Step bleiben ein Index-Lookup und
  drei Vergleiche.
- **Richtung:** Der Versatz steht in Metern senkrecht zur Laufrichtung;
  nur die Länge wird mit cos(Breite) skaliert (`MovementComponent.advance`).

## Wann gemessen und neu gebaut wird

`CorridorRefit` (`services/world/corridor-refit.ts`) entscheidet das, getestet in
`corridor-refit.spec.ts`. Drei Auslöser:

| Auslöser | Wann | Bedingung |
|---|---|---|
| `fitToTiles()` | einmal pro Ortsladung, sobald `scheduleOverlayHeightUpdate` fertig ist (`VisualizationFacadeService.scheduleOverlayHeightUpdate`), und nach dem Umsetzen von Spawn oder HQ ohne Neuladen (siehe unten). Das Höhen-Update läuft alle 500 ms, mindestens 4 Runden (`MIN_ATTEMPTS`, `UPDATE_INTERVAL_MS` in `HeightUpdateService`) | kein Intro-Flug (siehe unten); neu gebaut wird nur, wenn die Messung einen Korridor ändert |
| `remeasure()` | am Ende jeder Konvergenzschleife nach einem Tile-Schub (`RouteGridConvergence`), und von selbst noch einmal, wenn ihn einer der letzten drei Punkte rechts aufhielt (siehe unten) | es gibt Stationen mit `no tile` oder `coarse tile` (`hasUnmeasuredStations`) oder Zellen, zu denen kein Gegner laufen kann und die ein schmalerer Korridor wegnähme (`hasUnwalkableCells`, siehe Laufweg), kein Lauf ist offen, kein Intro-Flug, letzter Lauf mindestens 3 s her (`REMEASURE_INTERVAL_MS`) |
| `change()` | `__corridor.set()` und `__corridor.reset()` | ein Ort ist geladen; bei geänderten `MEASUREMENT_KEYS` werden alle Messungen verworfen. Misst am Stück und baut immer neu |

Für alle drei gilt die Sperre `rebuildBlocker()`: kein Neuaufbau, solange Tower
stehen, eine Welle läuft oder Gegner auf der Karte sind. Tower halten ihre
LOS-Antworten in den Zellen, die ein Neuaufbau ersetzt, Gegner ihre Zelle und
ihre Route.

Die erste Messung wartet auf das Ende des Intro-Flugs, der die Tiles entlang
der Route lädt. Läuft er beim Aufruf, oder startet er mitten im Lauf (ein
Ortswechsel startet ihn gleich nach der ersten Scheibe, STEP 7 in
`location-change-executor.service.ts`), verwirft `fitToTiles()` den Lauf
(`clearance cancelled (intro flight)`) und merkt sich die Messung
(`fitPending`). `remeasure()` holt sie nach dem Flug nach, beim nächsten
Tile-Schub oder spätestens mit dem 3-s-Takt unten, ohne die 3 s seit dem
letzten Lauf abzuwarten; ein Tower oder eine Welle vorher misst sie am Stück
(`flush`). Anlass: Im Playtest vom 2026-09-14 in Paris lief die erste Messung
nach einem Umzug außerhalb der Straßen 5,1 s lang und ließ 617 Stationen
ungemessen. Auf die feinen Tiles selbst wartet die Messung nicht; die laden
danach weiter. Stationen, die dann noch auf groben Tiles stehen, laufen
mit der OSM-Breite, bis `remeasure()` sie nach einem späteren Tile-Schub
nachholt. Ob sich etwas geändert hat, vergleicht `storeClearance` an den
fertigen Korridorstücken aller Routen vor und nach dem Speichern
(`fittedCorridors`).

Hält der Intro-Flug, ein offener Lauf oder die 3 s `remeasure()` auf, ruft es
sich selbst wieder auf (`retryRemeasure`): bei
den 3 s, sobald sie um sind, sonst alle 3 s, bis es misst; unter Tower,
Gegner oder Welle nicht. Vorher geschah nach einem aufgehaltenen Aufruf nichts
mehr bis zum nächsten Tile-Schub. Setzte sich der letzte Schub eines Orts
während des Intro-Flugs (der den Korridor lädt) oder kurz nach einem Lauf,
blieben die Stationen bei der OSM-Breite, bis die Kamera neue Tiles lud
(Befund 2 in REVIEW_SPRINT_2026-09-12).

Wird der Spawn oder das HQ ohne Neuladen des Orts umgesetzt
(`MapRelocationService`, private `applySpawnInPlace` und `applyHqInPlace`), entsteht die
Route neu aus den vorhandenen Messungen: Ein Segment, das die neue Route mit
der alten teilt, behält seine Messung. Beim HQ beginnt der Routen-Dienst von
vorn, dort ist nichts gemessen. Danach misst `fitToTiles()` die neuen Segmente
wie nach dem Laden, in Scheiben und unter denselben Sperren
(`VisualizationFacadeService.fitCorridorToTiles`); bis der Lauf fertig ist,
laufen sie mit der OSM-Breite. Die feinen Tiles der neuen Route laden erst ab
dem Grid-Aufbau (`setRouteCorridor`); Stationen, die dann noch auf groben
Tiles stehen, holt `remeasure()` nach. Wartende Stationen einer ersetzten
Route zählen für `hasUnmeasuredStations` nicht mehr.

### In Scheiben

`fitToTiles()` und `remeasure()` messen nicht am Stück, sondern je Frame so
viele Stationen, wie in `MEASURE_BUDGET_MS` passen (4 ms,
`CorridorRefit`, Ablauf in `fitToTiles`). Die Frames kommen aus
`requestAnimationFrame` wie beim Höhen-Sweep
(`eachFrame` im Host, den der `CorridorController` baut).

- **Budget:** Eine Station (Säule und vier Strahlen) kostete im Playtest vom
  2026-09-12 in der Innenstadt etwa 1,7 ms (533 ms für 316 Stationen); 4 ms
  sind dort zwei Stationen je Frame. Der Höhen-Sweep nach einem Tile-Schub
  nimmt 5 ms je Frame und läuft oft in denselben Frames, zusammen bleiben
  beide unter 10 ms. Der Lauf hört vor der Station auf, die nach den
  bisherigen Kosten je Station über das Budget ginge, nimmt aber mindestens
  eine Station je Frame.
- **Budget, während der Spieler wartet:** Solange der Hinweis "MOVING HQ"
  die Messung zeigt (Schritt "Measuring the corridor", `MEASURING_STEP` in
  `relocation-status.service.ts`; `CorridorRefitHost.hurried`), sind es
  `HURRIED_BUDGET_MS` = 32 ms je Frame (`corridor-refit.ts`). Im Playtest
  vom 2026-09-14 in Paris brauchte ein Umzug für 358 Stationen 465 ms
  Rechenzeit in 144 Scheiben über 5,3 s; jeder Frame kostete neben seiner
  Scheibe etwa 33 ms. Mit 32 ms sind es etwa 15 Frames zu 65 ms, rund 1 s.
  Gelesen wird je Scheibe: Verschwindet der Hinweis mitten im Lauf, geht es
  mit 4 ms weiter. Die erste Scheibe läuft im Umzug selbst, noch unter
  "Finding the route", und nimmt 4 ms. Unter "Loading streets" (Umzug
  außerhalb der Straßen) bleibt es bei 4 ms: Ein Lauf misst dann die alten
  Routen, und der Ortswechsel danach verwirft sein Ergebnis. Nachmessungen
  nach Tile-Schüben und die erste Messung nach dem Laden laufen ohne Hinweis
  und behalten die 4 ms.
- **Gleiches Ergebnis:** Der Lauf nimmt die Stationen in derselben
  Reihenfolge und mit denselben Strahlen wie der frühere Lauf am Stück und
  legt sie in dieselben Felder. `path-route.service.spec.ts` ("in slices")
  vergleicht Strahlen, Korridor und Log beider Wege, auch für einen Lauf,
  den ein Tower zu Ende bringt.
- **Erste Scheibe sofort:** Die erste Scheibe läuft im Aufruf selbst. Passt
  alles hinein (DevWorld, wo `TerrainQueries` keine Probe liefert, oder wenige
  Stationen), ist der Lauf wie früher im Aufruf fertig.
- **Korridor bis zum Ende unverändert:** Bis zum Ende des Laufs bauen Routen
  und Zellen mit dem Korridor von vorher. Dann wird gespeichert und, wenn sich
  ein Korridor ändert, im selben Frame neu gebaut.
- **Tower und Welle bringen den Lauf zu Ende:** Soll ein Tower gesetzt werden
  oder eine Welle starten, solange ein Lauf offen ist, misst
  `CorridorRefit.flush` den Rest sofort am Stück,
  speichert und baut neu; erst dann steht der Tower oder startet die Welle.
  Dasselbe gilt für eine erste Messung, die auf das Ende des Intro-Flugs
  wartet.
  Der Haken sitzt in `GameStateManager.placeTower`, `startWave` und
  `beginWave` (`setBeforeCorridorLock`, gesetzt von `CorridorController.attach`
  aus `VisualizationFacadeService.initialize`) und gilt damit für Klick, Hotkey,
  Auto-Start, KI-Director und den Trainings-Bot, der `placeTower` direkt
  aufruft. Im schlimmsten Fall ist das der eine Hänger des früheren Laufs am
  Stück, mit demselben Ergebnis, und der Tower steht auf den neuen Zellen.
  Eine abgelehnte Platzierung (Gold, Research, zweites Research Center) löst
  nichts aus.
- **Sperren:** `rebuildBlocker()` wird zusätzlich vor jeder Scheibe geprüft.
  Gegner aus dem Debug-Panel verwerfen den Lauf, der Korridor bleibt dann, wie
  er war, ebenso ein Tower oder eine Welle, die ohne den Haken dazukamen.
- **Tiles laden weiter:** Laden während eines Laufs Tiles nach, läuft er
  weiter. Jede Station hält, was sie zu ihrem Zeitpunkt sah; eine Station auf
  einem noch groben Tile bleibt NaN und wird später nachgemessen. Ein Neustart
  bei jedem Tile-Schub käme bei laufendem Streaming (Intro-Flug) nicht ans
  Ende.
- **Abbruch:** Ortswechsel und ersetzte Routen (`initialize`, `clearCache`,
  auch beim Umsetzen von Spawn oder HQ), `clearCorridorMeasurements`,
  `dispose` und ein neuer Lauf verwerfen den offenen, ebenso ein Intro-Flug,
  der währenddessen startet (danach wie oben). `fitToTiles()` lässt einen
  offenen Lauf weiterlaufen, `remeasure()` wartet auf ihn.
- **Konsole:** `__corridor.set()` und `reset()` verwerfen einen offenen Lauf
  und messen am Stück (Budget unbegrenzt), die Konsole wartet auf die
  Antwort.

### Neuaufbau

`CorridorController.rebuildCorridors` läuft synchron in
einem Frame:

1. `routes`: `refreshRouteLines`, also Wegsuche je Spawn, Korridoranpassung
   und rote Linie.
2. `grid`: Grid leeren und neu erzeugen, samt erster Höhenprobe je Zelle.
3. `heights`: voller Höhen-Sweep (`updateTerrainHeights`).
4. `walk`: Zellen, zu denen kein Gegner laufen kann, kappen den Korridor
   (`narrowToWalkable`); wo das einen Korridor ändert, die Schritte 1 bis 3
   noch einmal, höchstens `MAX_WALK_PASSES` (2) Mal (siehe Laufweg).
5. `lines`: `refreshRouteLines` ein zweites Mal, auf den neuen Zellhöhen.
6. `overlays`: Debug-Layer neu, laufende Routen-Animation neu gestartet.

### Logs

```
[Corridor] clearance: segments= stations= unmeasured= (coarse tile N) rays= changed= in X ms slices= wall= ms [flushed=tower|wave] [noTile=x,z;x,z;...]
[Corridor] clearance cancelled (Grund): stations=N of M in X ms slices= wall= ms, corridor unchanged
[Corridor] rebuild: routes= grid= heights= walk= narrowed= lines= overlays= total= ms spawns= cells=
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
  - `flushed`: nur bei einem Lauf, den ein Tower (`tower`) oder eine Welle
    (`wave`) zu Ende gebracht hat; die letzte Scheibe war dann der Rest am
    Stück.
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
- **`rebuild`**: erscheint nur bei einem Neuaufbau, also nach `changed=true`
  oder nach `__corridor.set()`/`reset()`. `walk` ist die Zeit der
  Laufweg-Runden samt ihrer Bauten, `narrowed` deren Zahl (0 bis
  `MAX_WALK_PASSES`).
- **Gemessen** (Playtest 2026-09-12, Innenstadt, eine Route, Punkt 52 in
  REVIEW_SPRINT_2026-09-12, noch am Stück): Neuaufbau 39,5 bis 41,7 ms; die
  Messung davor mit 1260 Strahlen 520 bis 533 ms. Weitere Orte sind nicht
  gemessen.

## Feine Tiles im Korridor

Die Tile-Region `RouteCorridorRegion` (`three-engine/route-corridor-region.ts`)
hält Tiles bis 20 m neben den Routensegmenten auf 5 m geometricError und aktiv,
auch außerhalb des Bildes (`ROUTE_CORRIDOR_HALF_WIDTH`,
`ROUTE_CORRIDOR_ERROR_TARGET` und `setRouteCorridor()` in `three-tiles-engine.ts`). Daher
die Vorgabe `maxTileError` 5 und die Obergrenze 15 für `maxHalfWidth`: Weiter
als 20 m neben der Route gibt es keine garantiert feinen Tiles.

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
```

- **`set` und `reset`** geben `Not changed: ...` zurück, wenn kein Ort geladen
  ist, die Sperre greift oder ein Wert abgelehnt wird (unbekannter Name, Wert
  außerhalb des Bereichs, Minimum über Maximum). Sonst kommt
  `Corridor rebuilt[, measured again]: N cells. Widths per stretch: __routes.describe()`
  zurück (`CorridorRefit.change`).
  - Die Werte gelten bis zum Neuladen der Seite; dauerhaft heißt
    `CORRIDOR_DEFAULTS` im Code ändern.
- **`towerCells`** gibt eine Tabelle zum Tower zurück (`CorridorConsole.describeTowerCells`):
  - Zellen in Reichweite: `cells`, `unsampled`.
  - Antworten des Towers: `groundVisible`/`Blocked`/`Missing`, dasselbe für
    `air`.
  - Auffällige Zellen: `holes`, `raised` (mehr als 1 m über dem Median der
    Nachbarn), `unwalkable` (Zellen, zu denen kein Gegner laufen kann und die
    der Korridor trotzdem hält, siehe Laufweg).
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
  | `unwalkable` > 0 | ein feineres Tile zeigte sie erst, als Tower standen (siehe Laufweg) |
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
       (`cellWalkable`; `false`: kein Gegner kann dorthin laufen, der Korridor
       hält die Zelle trotzdem), `walkCheck` (warum: `walkable`, `roof`,
       `step`, `drop`, `hollow` (Auto hohl im Mesh), `centre line`, `centre line on a roof` (auf die Straße gesetzt,
       siehe Zellhöhe), `detour` (Mittellinie eines Umwegs), `passage` (Zelle eines
       Durchgangs, siehe "Hindernis auf der Mittellinie"), `coarse tile`, `no sample`, `deck or tunnel`,
       `no bridge end` (Strecke hinter einem Brückenende ohne Säule dort),
       `no centre line ground`, `seam`), `overLineM` (Höhe über der
       Mittellinie, gegen die der Check misst; bei einer Zelle der
       Mittellinie über der Mittellinie ringsum), `aboveNeighboursM`,
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
     neuen Strahl, und unter `hits` jeder Treffer dieses Strahls als
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
       `detourM` (wie weit die Route dort um ein Hindernis auf der Mittellinie
       zur Seite rückt, rechts positiv, sonst null), `passage` (in einem Durchgang),
       `unmeasured`, `tileError`, am Ende `shiftM` (wie weit
       entlang der Route die Station neben einer Naht gemessen wurde, sonst
       null).
     - Je Seite eine Zeile: `lowHitM`, `highHitM`, `lowRiseM` (wo nur der
       untere Strahl stoppte: wie hoch die Säule 1 m hinter seinem Treffer
       über dem Boden der Station liegt, sonst null), `wall`, `freeM`,
       `smoothedM`, `halfWidthM`, `inUseM`, `walkableM` (die Kappe des
       Laufwegs, sonst null) und `rule`.
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
  - zuletzt je Station, wo die Kappe des Laufwegs greift: `unwalkable cell beyond`;
  - danach, über die fertigen Stücke: `short narrowing closed`.
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
    und hat Copy JSON, Clear und Done. Esc oder Done beenden den Bericht,
    Auswahl und Notiz bleiben bis Clear, bis zu einem HQ an anderer Stelle
    oder bis zum Neuladen.

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
     Sprung der `lodVersion`, kein Höhen-Sweep, kein `remeasure`, solange sie
     läuft. Setzt das Fehlerziel der Kamera auf 1e6 px
     (`MUTED_CAMERA_ERROR_TARGET`): Die Kamera verfeinert nichts mehr, die
     Region weiter bis zu ihrem Ziel.
  3. Je Ziel: Fehlerziel der Region setzen, warten, bis 0,5 s lang nichts
     lädt (`QUIET_MS`, wie der Debounce des `TileLoadingTracker`), höchstens
     `timeoutS`. Dann jede Station einmal messen
     (`PathAndRouteService.measureAllStations`), am Stück und mit einem
     eigenen, leeren Säulen-Cache (`TerrainQueries.withScratchColumnCache`).
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
  hat (Fingerprint vor und nach der Probe, vor der Freigabe). Nach der Freigabe läuft der weitergegebene
  Tile-Schub wie jeder andere: Sweep, Konvergenz, `remeasure`. Fingerprints
  daher vor der Probe nehmen oder nach einem Neuladen.

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
  | `pieces` | je Route und Segment die Korridorstücke in Gebrauch: t, Halbbreite links und rechts (cm) |
  | `stations` | je gemessener Station der Freiraum links und rechts (cm) und warum sie ungemessen blieb |
  | `walk` | Kappen des Laufwegs je Station und Seite (cm): die Laufweg-Urteile, wie der Korridor sie angewendet hat |
  | `detours` | Umweg-Stücke (von, bis, Versatz, cm) und Durchgänge |
  | `cells` | Zellen nach ihrer Mitte (cm) |
  | `heights` | Zellhöhen auf 0,1 m gerundet |
  | `tiles` | geometricError des Tiles unter jeder gemessenen Station; je Zelle Sample-Zustand, Tiefe und geometricError |

  Routen, Segmente und Zellen gehen nach Schlüssel sortiert ein. Messungen
  von Routen, die nicht mehr in Gebrauch sind (Spawn verschoben), fehlen. Das
  Urteil des Laufwegs je Zelle geht nicht ein: Es neu zu berechnen läse den
  Säulen-Cache, und der folgt der Kamera.

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
  hinter einem Brückenende nimmt der Vergleich wie die Zellen entlang der
  Route (`deckApproaches`), mit der Höhe, die die Route von dort trägt.

Nur für Diagnose: je Punkt alle 2 m bis zu fünf Säulenproben, auf einer
Brücke eine mehr, auf der Strecke dahinter die Säulen entlang der Route vom
Brückenende (alle 2 m, im Cache der Engine).

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
  trägt (`carriedDeckY`, wie die Zellen); liegt er mehr als `roofRise` über
  dieser Höhe (Krone, Schild, Auto ohne Boden darunter), die getragene
  Höhe, wie eine Zelle auf der Mittellinie (`streetUnderRoof`). Ohne Säule
  am Endknoten wie oben. Welche Knoten dazugehören, sucht
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
| `surface` `tunnel`, `state` `unsampled` | Tunnelstück ohne Portal-Tile |

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
| blau | Brückendeck, und die Strecke hinter einem Brückenende (`approach`, bis 60 m entlang der Route), gleich welchen Treffer die Säule ihr gab; die Höhe zeigt, ob Deck oder Boden |
| gelb | Tunnel, überdachter Durchgang oder Stück unter einer fremden Brücke |
| weiß | normal |

Das "Air Route Grid Overlay" zeigt dieselben Konturen, die Fläche blau für
Luftabdeckung.

`__rg.dumpCellsInBox({ xMin, xMax, zMin, zMax })` listet die Zellen eines
Ausschnitts mit Probe, LOD und `surface`.

## Grenzen

Aus dem Code abgeleitet, im Spiel nur teilweise geprüft (Playtest-Liste in
REVIEW_SPRINT_2026-09-12.md, Punkte 9 bis 15 und 41 bis 53):

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
  Strahl in 1 m) und für den Laufweg auch, solange die Stufe unter
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
- Der Laufweg-Check geht von der Mittellinie neben der Zelle aus, dem
  Median über die Stelle daneben und je zwei Nachbarn auf der Linie.
  Stehen dort drei und mehr Stellen in Folge auf einer Krone oder einem
  Auto (OSM-Linie über dem Parkstreifen), greift er nicht, außer wo der
  Boden einen Schritt daneben zu beiden Seiten mehr als `stepDrop` tiefer
  liegt (Erhöhte Mittellinie, dann misst er von dort). Unter einer Krone,
  die auch die Stellen daneben deckt, zählt die Krone: Die Straße jenseits
  ihres Randes fällt dann als `drop` weg, die Zellen in der Krone bleiben.
  Zellen, durch die eine Mittellinie läuft,
  prüft er nicht. Um ein Hindernis auf ihr biegt die Route, wo Platz ist
  (siehe "Hindernis auf der Mittellinie"); was die Planung nicht erfasst,
  bleibt: Liegt ihr Treffer mehr als `roofRise` über der Mittellinie
  ringsum, nehmen sie deren Höhe (siehe Zellhöhe), sonst steigen die Gegner
  darüber.
- Hindernis auf der Mittellinie (`corridor-detour.ts`), nicht im Spiel
  geprüft:
  - Mit Straße nur auf einer Seite (Auto direkt an einer Mauer oder einem
    erhöhten Garten) gilt ein Hindernis nur als Buckel der Linie. Eine
    Reihe ohne Lücke, länger als etwa 12 m, gilt in ihrer Mitte nicht, und
    die Gegner steigen dort darüber.
  - Ein Erker oder eine Krone über mehr als etwa 4 m der Linie kippt den
    Median entlang der Linie und gilt nicht.
  - Der Weg braucht beiderseits 1,5 m Straße, zusammen etwa 3 m neben dem
    Hindernis. Ein Auto mitten auf einer Wohnstraße von 5,5 m lässt je Seite
    etwa 1,8 m; dort steigen die Gegner darüber.
  - Die Säulen quer zum Weg prüft die Planung nur an den Stellen im Meter-
    raster entlang der Linie; was zwischen zwei Stellen und zwischen den
    0,5-m-Säulen quer steht, sieht sie nicht.
  - Eine Rampe, die kürzer sein muss (Routenende, Brücke, Tunnel, anderes
    Hindernis), biegt enger als der Wurm; bei der Hälfte der Länge etwa mit
    5 m Radius.
  - `__routes.describe()` findet für die Segmente eines Umwegs keinen Way
    (sie liegen neben seiner Kante).
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
  nächsten Neuaufbau (siehe Laufweg).
- Nähte zwischen Tile-Meshes: Stationen und Zellen versuchen Säulen 0,5 m
  daneben, Lücken füllt der Grid aus den Nachbarn. Eine Lücke breiter als
  eine Zelle bleibt ohne Höhe (rosa), eine Messlücke länger als etwa
  `dipLength` bei der Straßenbreite. Liegt der Mittelpunkt einer Zelle in
  keiner Bounding Box eines Tiles, probt der Sweep sie gar nicht; dann greift
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
  - Kosten nicht gemessen: je Zelle, Station und Overlay-Knoten der Strecke
    bis zu 30 Säulen entlang der Route, für alle einer Strecke dieselben,
    im 0,5-m-Cache der Engine.
- Der Neuaufbau läuft weiter synchron in einem Frame, im Playtest etwa 40 ms
  (routes 14, lines 11, grid 10, heights 4 bis 6 ms), mit dem Laufweg bis
  zu zwei weitere Bauten von Routen, Grid und Höhen, nach diesen Zahlen je
  etwa 30 ms (nicht gemessen). Routen und Zellen
  müssen im selben Frame wechseln: Eine Welle, die dazwischen startet, liefe
  sonst mit den neuen Breiten der Routen auf den alten Zellen. Übrig bliebe
  der Höhen-Sweep (4 bis 6 ms), der auf den Sweep mit Frame-Budget könnte;
  das spart wenig und ließe die neuen Zellen einige Frames auf ihrer ersten
  Höhenprobe. Nicht gemacht.
- Setzt der Spieler einen Tower oder startet eine Welle, solange der erste
  Lauf misst, hängt das Spiel in diesem Moment für den Rest der Messung
  (höchstens so lange wie früher der ganze Lauf). Gegner aus dem Debug-Panel
  verwerfen den Lauf dagegen; der Ort bleibt dann bei der OSM-Breite, bis sie
  weg sind und `__corridor.set()` oder `reset()` neu baut.
- Die Welle startet nach einem Flush mit der Konfiguration, die der
  Director vorher berechnet hat. Die neuen Breiten ändern Route und Länge
  nicht, nur die Zellen daneben.
