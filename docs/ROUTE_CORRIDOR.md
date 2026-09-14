# Routenkorridor

**Stand:** 2026-09-14

Wie breit der Korridor aus Route-Zellen links und rechts der Mittellinie einer
Route ist, woher die Breite kommt, wann sie gemessen und neu gebaut wird und
wie man sie im Spiel prüft. Die Herleitung und die Playtest-Befunde stehen in
[ROUTE_GEOMETRY_ANALYSIS.md](ROUTE_GEOMETRY_ANALYSIS.md) und
[REVIEW_SPRINT_2026-09-12.md](REVIEW_SPRINT_2026-09-12.md).

Längen in Metern. "Links" und "rechts" meinen immer die Fahrtrichtung der
Route (vom Spawn zum HQ).

## Überblick

| Schritt | Code | Ergebnis |
|---|---|---|
| Straßenbreite je Segment | `utils/route-corridor.ts` (`estimateStreetWidth`, `routeHalfWidths`), Zuordnung Segment zu OSM-Way in `path-route.service.ts:489-496` | Halbbreite aus OSM, Rückfall für alles, was die Tiles nicht messen |
| Messung | `PathAndRouteService.beginClearanceMeasurement` (`path-route.service.ts:829`) und der Lauf `ClearanceRun` (`:1023`), Strahlen in `TerrainQueries.measureStreetClearance` (`three-engine/terrain-queries.ts:340`, als `engine.terrain` erreichbar) | Freiraum je Station und Seite |
| Anpassung | `fitCorridorStations`, `fitCorridorPieces`, `closeShortNarrowings` (`route-corridor.ts`), `fitRoute`, `applyClearance` (`path-route.service.ts`) | Segmente geteilt, wo sich eine Seite ändert; Halbbreite links und rechts je Stück; kurze Engstellen geschlossen |
| Waypoints | `path-route.service.ts:546-551` | `corridorLeft`, `corridorRight`, `onBridge`, `inTunnel` am Waypoint, gültig für das Segment ab dort (`RouteWaypoint`, `models/game.types.ts`) |
| Zellen | `GlobalRouteGrid.generateFromRoutes` (`global-route-grid.ts:330`) | 2-m-Zellen im Korridor |
| Zellhöhe | `RouteCellSampler.sampleCellY` (`route-cell-sampler.ts`) | Boden, Brückendeck, Tunnelsohle, Dach- und Stufen-Check |
| Gegner | `MovementComponent.advance` (`movement.component.ts:460-509`), `getRouteProfile` (`route-corridor.ts:703`) | Seitenversatz innerhalb der Zellen |
| Auslöser | `CorridorRefit` (`services/world/corridor-refit.ts`), verdrahtet in `CorridorController` (`services/world/corridor-controller.ts:42-66`), den `VisualizationFacadeService` hält | Wann gemessen und neu gebaut wird |

## Einstellungen

Alle Werte stehen in `corridorConfig`, die Vorgaben in `CORRIDOR_DEFAULTS`
(`route-corridor.ts:137-182`), die erlaubten Bereiche in `SETTING_RANGES`
(`:211-234`). Routen und Grid lesen die Werte beim Bauen; eine Änderung wirkt
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
| `wallMargin` | 0,5 | 0 bis 5 | Abstand zu einer gefundenen Wand |
| `overhangDepth` | 1 | 0 bis 5 | bis zu so weit vorkragende Obergeschosse begrenzen den Korridor mit ihrer Außenkante, 0 aus |
| `maxTileError` | 5 | 0,1 bis 100 | gröbstes Tile (geometricError), das für die Messung zählt |
| `widthStep` | 0,5 | 0,1 bis 2 | Rundung der gemessenen Breite nach unten |
| `dipLength` | 4 | 0 bis 100 | Einbrüche bis etwa so lang werden geschlossen |
| `bulgeLength` | 8 | 0 bis 100 | Ausbuchtungen bis etwa so lang werden abgeschnitten |
| `roofRise` | 2,5 | 0,5 bis 50 | Schwelle des Dach-Checks |
| `stepRise` | 0,75 | 0,1 bis 50 | Schwelle des Stufen-Checks je Rasterschritt (2 m) |
| `highwayWidths` | Tabelle unten | je bis 50 | Straßenbreite je `highway`-Klasse |
| `unknownHighwayWidth`, `laneWidth`, `laneExtra` | 5, 3, 1 | 1 bis 50, 1 bis 10, 0 bis 10 | Breite unbekannter Klassen, Spurbreite, Zuschlag bei `lanes` |

`MEASUREMENT_KEYS` (`route-corridor.ts:201-208`) sind die Werte, deren Änderung
eine neue Messung braucht: `stationSpacing`, `rayHeightLow`, `rayHeightHigh`,
`maxHalfWidth`, `maxTileError`, `overhangDepth` (der gespeicherte Freiraum
entsteht beim Messen aus den Treffern). Die übrigen formen nur das Gemessene
um.

## Breite aus dem Freiraum, je Seite

### Messung

`PathAndRouteService.beginClearanceMeasurement` (`path-route.service.ts:829-878`)
geht jedes Segment jeder Route durch und legt einen Lauf an (`ClearanceRun`,
`:1023`). Ein Segment der Länge `L` bekommt
`n = max(1, round(L / stationSpacing))` Stationen, Station `k` steht bei
`(k + 0,5) / n` des Segments. Segmente, die mehrere Routen teilen, werden
einmal gemessen.

Je Station (`TerrainQueries.measureStreetClearance`, `terrain-queries.ts:340-390`):

1. Eine Säulenprobe unter der Station. Findet sie gar kein Tile, steht die
   Station womöglich auf einer Naht zwischen zwei Tile-Meshes; dann versucht
   sie die Säulen 0,5 m voraus und 0,5 m zurück entlang der Route
   (`SEAM_SHIFTS_M`, `terrain-queries.ts`) und misst von der ersten, die ein
   Tile findet. Das kostet höchstens zwei weitere Säulen, nur für solche
   Stationen; `__corridor.pick()` zeigt die Verschiebung als `shiftM`. Ohne
   Tile auch dort ist die Station `unmeasured: 'no tile'`, mit einem Tile
   gröber als `maxTileError` ist sie `unmeasured: 'coarse tile'`.
2. Je Strahlhöhe ein waagrechter Strahl nach links und einer nach rechts, in
   1 m und 3,5 m über dem Boden der Säule (auf einer Brücke über ihrer
   Oberkante `topY`), jeder `maxHalfWidth` lang.
3. Ein Treffer zählt nur auf einem Tile mit höchstens `maxTileError`
   geometricError und nicht auf dem Wurzel-Tile (`:406-407`). Ohne Treffer
   meldet der Strahl seine volle Länge.

Der Freiraum einer Seite ist der weitere der beiden ersten Treffer
(`probeFreeSpace`, `route-corridor.ts:481`). Eine Wand ist also nur, was beide
Strahlen stoppt: Fassade, Mauer, Stamm. Ein parkendes Auto, ein Transporter,
eine Hecke oder ein Zaun stoppt nur den unteren, eine Baumkrone, Traufe oder ein
Balkon nur den oberen; beides engt den Korridor nicht ein.

Ausnahme **Auskragung**: Treffen beide Strahlen und stoppt der obere
höchstens `overhangDepth` (1 m) näher als der untere, gilt der nähere
Treffer, die Außenkante. So kragen die Obergeschosse eines Fachwerkhauses
über das Erdgeschoss vor, ein Erker ebenso. Mit dem weiteren Treffer lagen
die Randzellen unter dem Obergeschoss, ihre Säule traf dessen Dach oder
Unterseite, der Dach-Check setzte sie orange auf den Boden (Playtest
2026-09-14, Rothenburg, Zellen "unter dem Dach"). Ein Balkon oder eine
Krone weiter als 1 m vor der Fassade und ein Auto vor der Fassade (unterer
Strahl näher) lassen es beim weiteren Treffer. `__corridor.pick()` nennt die
Ausnahme mit `overhang: outer face` in `rule`. Eine Urteilsfrage, abschaltbar
mit `__corridor.set({ overhangDepth: 0 })` (misst neu).

Gespeichert wird der Freiraum je Segment, Station und Seite in
`clearanceBySegment` (`path-route.service.ts:186`), NaN für ungemessene
Stationen, dazu die Rohwerte je Station für `__corridor.pick()`. Der Lauf hält
seine Ergebnisse bei sich und übergibt sie erst an seinem Ende
(`storeClearance`, `:881-890`); bis dahin baut jede Route mit dem Korridor von
vorher. Ein weiterer Lauf misst nur die NaN-Stationen nach (`:850`). Tunnel-
und Durchgangssegmente werden übersprungen (`:843`).

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
   schmalerer Abschnitt bis etwa `dipLength` (Laterne, Schild, Transporter,
   einzelner Stamm) verschwindet, ein längerer bleibt in voller Länge.
2. **Ausbuchtungen abschneiden** (`cutShortBulges`, Opening): Ein breiterer
   Abschnitt bis etwa `bulgeLength` (Einfahrt, Lücke zwischen zwei Häusern,
   schmale Einmündung) verschwindet.

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
Anfang oder Ende der Route und Tunnel bleiben. `__corridor.pick()` nennt es
mit `short narrowing closed` in `rule`.

`applyClearance` (`path-route.service.ts`) teilt jedes Segment an den
Stückgrenzen; jedes Stück wird ein eigener Waypoint mit `corridorLeft` und
`corridorRight`. Zellen und Seitenversatz der Gegner lesen beide diese
Waypoints, eine geschlossene Engstelle gilt also für beide.

## OSM-Breite als Rückfall und Deckel

`estimateStreetWidth` (`route-corridor.ts:296-307`): der `width`-Tag, sonst
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
ein Segment ohne Way davor `defaultHalfWidth` (`routeHalfWidths`, `:319-327`).

Die OSM-Breite gilt:

- an Stationen ohne Messung (kein oder zu grobes Tile),
- in Tunneln und Durchgängen,
- als Obergrenze auf dem Endstück zum HQ,
- in DevWorld. Dort liefert `TerrainQueries` keine Probe (`terrain-queries.ts:350`), und die
  Straßen werden in der Breite gezeichnet, die der Korridor ohnehin nimmt
  (siehe [DEVWORLD.md](DEVWORLD.md)).

## Zellen und Engstellen

Die Route-Zellen sind 2 m groß (`global-route-grid.ts:95`).
`claimSegmentCells` (`route-grid-builder.ts:174-236`) nimmt eine Zelle in den
Korridor auf, wenn

- ihr Mittelpunkt höchstens die Halbbreite ihrer Seite vom Segment entfernt
  liegt, oder
- das Segment ihr Quadrat berührt (`segmentTouchesCell`, Liang-Barsky,
  `route-grid-builder.ts:242-269`).

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
(`global-route-grid.ts:352`), weil die Fläche einer Zelle von allen Segmenten abhängt, die sie
erreichen.

## Zellhöhe

Die Höhe einer Zelle kommt aus der Säulenprobe an ihrem Mittelpunkt: der
unterste Treffer der feinsten LOD (`column-sample.ts`).

- **Naht zwischen zwei Tile-Meshes** (`RouteCellSampler.sampleCellY`,
  `CELL_PROBES_M`): Findet die Säule am Mittelpunkt kein Tile oder nur einen
  Treffer, den die Nachbarn ablehnen (unten), versucht die Zelle die Säulen
  0,5 m daneben in x und z und nimmt die erste, die einen annehmbaren
  Treffer gibt. Höchstens vier weitere Säulen, nur für solche Zellen. Die
  Probe auf der Mittellinie für den Dach-Check und die Portalproben eines
  Tunnels machen es ebenso. Liegt der Mittelpunkt in keiner Bounding Box
  eines Tiles, überspringt der Sweep die Zelle wie bisher ohne Probe.
- **Ausreißer** (`plausible`): Ein Treffer mehr als 50 m (`OUTLIER_M`) vom
  Median der stabilen Nachbarn derselben Fläche entfernt zählt nicht. Für
  die erste Probe einer Zelle und für ein LOD-Upgrade zählen nur Nachbarn
  aus mindestens so tiefen Tiles, damit eine grobe Hülle ringsum ein
  feineres Sample nicht verhindert. Vorher lief der Test nur für stabile
  Zellen ohne Upgrade; im Playtest 2026-09-13 stand eine Zelle so auf
  -3542 m zwischen Zellen auf 243 m. Der Dach-Check übergeht einen Boden
  auf der Mittellinie mehr als 50 m unter der Zelle.
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

- **Dach-Check** (`hitOf`, `route-cell-sampler.ts:280-285`): Liegt die Probe einer
  Zelle neben der Mittellinie mehr als `roofRise` (2,5 m) über dem Boden der
  Mittellinien-Zelle daneben, nimmt die Zelle diesen Boden und trägt
  `sample.clamped = true`. Die Säule hat dann ein Dach, eine Traufe oder eine
  Krone getroffen, unter der die Photogrammetrie keinen Boden hat. Der Check
  senkt nur ab, gilt nur für Zellen mit Fläche `ground` und nicht für die
  Mittellinien-Zellen selbst. Welche Mittellinien-Zelle daneben liegt, legt
  `claimSegmentCells` beim Anlegen fest (`axisX`, `axisZ`,
  `route-grid-builder.ts:228-230`).
- **Stufen-Check** (`groundInFront`, `crossSlope` in
  `route-cell-sampler.ts`): Greift der Dach-Check nicht, geht die Zelle den
  Weg von der Mittellinien-Zelle zu sich Rasterstelle für Rasterstelle ab
  (Säulen der Zellen dort, aus dem Cache). Eine Stelle gilt als erreicht,
  wenn ihr Boden höchstens `stepRise` (0,75 m) über dem höchsten bisher
  erreichten Boden liegt oder über dem zuletzt erreichten plus der
  Querneigung je Stelle seitdem. Liegt die Zelle selbst höher, nimmt sie den
  Boden der letzten erreichten Stelle vor ihr und trägt ebenfalls
  `clamped = true`. Das trifft Zellen auf einem geparkten Auto, einem
  Transporter oder einer Hecke: Die Strahlen lassen den Korridor darüber
  reichen (nur der untere Strahl stoppt), und die Photogrammetrie hat unter
  einem Auto keinen Boden (Playtest 2026-09-14). Der Gehweg hinter einer
  Reihe Autos bleibt, wie er ist, abwärts geht es beliebig weit (bis
  `OUTLIER_M`).
  - **Querneigung:** Steigt der Boden an der ersten Stelle zur Zelle hin
    um etwa so viel, wie er an der gespiegelten Stelle auf der anderen
    Seite der Mittellinie fällt (beide höchstens `stepRise` auseinander),
    darf der Weg je Stelle um das Kleinere der beiden mehr steigen. Eine
    Straße quer am Hang (auch DevWorld) behält so ihre Randzellen; ein Auto
    steigt nur auf einer Seite, eine Kaimauer fällt viel tiefer, als ein
    Auto hoch ist.
  - **Kosten:** eine Säule je Rasterstelle auf dem Weg und eine
    gespiegelte, meist Zellen, deren Säulen der Engine schon im Cache hat.
  - **Sichtlinie der Tower:** Die Zelle merkt sich die Höhe, von der der
    Stufen-Check sie heruntergesetzt hat, als `sample.stepTop` (das Dach
    des Autos). Die Boden-Probe der Tower-LOS liegt 1,5 m darüber
    (`getGroundTargetY`, `route-cell.ts`), wie vor dem Stufen-Check; die
    Zelle selbst, die Gegner darauf und die Platte der LOS-Anzeige bleiben
    auf Straßenhöhe. Auf Straßenhöhe plus 1,5 m läge die Probe bei einem
    Transporter oder einer Hecke im Objekt, der Cube sähe dessen
    Oberfläche vor der Probe, und die Zelle wäre für jeden Tower
    `blocked`: Gegner dort fände kein Tower (Review 2026-09-14, C1). Die
    Air-Probe bleibt `getAirTargetY` über der Zellhöhe, dort fliegen die
    Luftgegner. Eine Zelle, die der Dach-Check geklemmt hat, probt wie
    bisher über ihrer Zellhöhe.
- **Brückendeck:** Segmente über einen Way mit `bridge=*`
  (`path-route.service.ts:493`) tragen `onBridge`, ihre Zellen die Fläche
  `deck` und nehmen die Oberkante der Säule (`topY`) statt des Bodens
  (`route-cell-sampler.ts:274`). Erreicht auch ein Segment ohne Brücke dieselbe
  Zelle, bleibt sie am Boden (`route-grid-builder.ts:223-225`).
- **Tunnel und überdachte Durchgänge:** `runsUnderCover`
  (`route-corridor.ts:341`) gilt für `tunnel=*` außer `no` (also auch
  `building_passage`) und für `covered=yes`. Solche Segmente tragen `inTunnel`
  und werden nicht vermessen, es gilt die OSM-Breite. Ihre Zellen haben die
  Fläche `tunnel`.
  - **Höhe:** linear zwischen dem Boden an zwei Portalen, je 2 m vor den
    Mündungen des ganzen Tunnelstücks (`TUNNEL_PORTAL_OFFSET_M`,
    `tunnelSegments`, `route-grid-builder.ts:12-89`). Die Höhe hat die gröbere
    LOD der beiden Portale (`tunnelColumn`, `route-cell-sampler.ts:402-413`).
  - **Ohne Portal-Tile:** Solange an einem der beiden Portale kein Tile
    liegt, bleibt die Zelle ohne Höhenprobe.
  - **Geteilte Zellen:** Erreicht ein Tunnelsegment eine Zelle, ist sie
    Tunnelzelle, auch wenn ein anderes Segment sie ebenfalls erreicht
    (`route-grid-builder.ts:220-222`).
  - Kein Dach-Check.

## Seitenversatz der Gegner

Jeder Gegner bekommt beim Spawn einen Faktor in [-1, 1]: Zufall mal
`lateralSpread` seines Typs (`enemy.manager.ts:278-283`,
`enemy-types.config.ts`, Werte 0,5 bis 1,0). Negativ heißt links, positiv
rechts der Fahrtrichtung, 0 die Mittellinie.

Der Versatz in Metern ist Faktor mal die seitliche Grenze an der aktuellen
Stelle, auf der Seite, auf der der Gegner läuft (`movement.component.ts:487-508`).

- **Grenze eines Segments:** `lateralLimit(H) = max(0, H - edgeMargin)`
  (`route-corridor.ts:667`). `edgeMargin` ist mindestens die halbe Diagonale
  einer 2-m-Zelle (1,41 m). Ein Gegner innerhalb der Grenze steht deshalb
  in einer Zelle, deren Mittelpunkt innerhalb `H` liegt, also in einer Zelle,
  die das Grid angelegt hat (`route-corridor.ts:37-44`).
  - **Warum das zählt:** Außerhalb der Zellen findet `getEnemiesForTower`
    den Gegner nicht (`global-route-grid.ts:826`).
  - **Test:** `integration/route-corridor-coverage.spec.ts` läuft das über
    Engstellen und Ecken ab.
- **Übergänge:** Die Grenze an einem Waypoint ist die kleinere der beiden
  angrenzenden Segmente. Danach darf sie entlang der Route höchstens um
  `taper` (0,5 m pro m) steigen (`buildSideLimits`, `route-corridor.ts:736-766`).
  Vor einer Engstelle rücken Gegner so allmählich ein, statt am ersten
  schmalen Waypoint seitlich zu springen.
- **Mittellinie:** Unter 1,5 m Halbbreite ist die Grenze 0. An einer
  einzelligen Engstelle laufen alle Gegner auf der Mittellinie.
- **Kosten:** Die Grenzen werden einmal je Pfad-Array berechnet und geteilt
  (`getRouteProfile`, WeakMap). Im Sub-Step bleiben ein Index-Lookup und
  drei Vergleiche.
- **Richtung:** Der Versatz steht in Metern senkrecht zur Laufrichtung;
  nur die Länge wird mit cos(Breite) skaliert (`movement.component.ts:466-485`).

## Wann gemessen und neu gebaut wird

`CorridorRefit` (`services/world/corridor-refit.ts`) entscheidet das, getestet in
`corridor-refit.spec.ts`. Drei Auslöser:

| Auslöser | Wann | Bedingung |
|---|---|---|
| `fitToTiles()` | einmal pro Ortsladung, sobald `scheduleOverlayHeightUpdate` fertig ist (`visualization-facade.service.ts:553-556`), und nach dem Umsetzen von Spawn oder HQ ohne Neuladen (siehe unten). Das Höhen-Update läuft alle 500 ms, mindestens 4 Runden (`height-update.service.ts:21-25`) | neu gebaut wird nur, wenn die Messung einen Korridor ändert |
| `remeasure()` | am Ende jeder Konvergenzschleife nach einem Tile-Schub (`RouteGridConvergence`, `route-grid-convergence.ts:140-142`), und von selbst noch einmal, wenn ihn einer der letzten drei Punkte rechts aufhielt (siehe unten) | es gibt Stationen mit `no tile` oder `coarse tile` (`hasUnmeasuredStations`), kein Lauf ist offen, kein Intro-Flug, letzter Lauf mindestens 3 s her (`REMEASURE_INTERVAL_MS`) |
| `change()` | `__corridor.set()` und `__corridor.reset()` | ein Ort ist geladen; bei geänderten `MEASUREMENT_KEYS` werden alle Messungen verworfen. Misst am Stück und baut immer neu |

Für alle drei gilt die Sperre `rebuildBlocker()`: kein Neuaufbau, solange Tower
stehen, eine Welle läuft oder Gegner auf der Karte sind. Tower halten ihre
LOS-Antworten in den Zellen, die ein Neuaufbau ersetzt, Gegner ihre Zelle und
ihre Route.

Die erste Messung wartet nicht auf die feinen Tiles entlang der Route; die
laden danach weiter. Stationen, die dann noch auf groben Tiles stehen, laufen
mit der OSM-Breite, bis `remeasure()` sie nach einem späteren Tile-Schub
nachholt. Ob sich etwas geändert hat, vergleicht `storeClearance` an den
fertigen Korridorstücken aller Routen vor und nach dem Speichern
(`fittedCorridors`, `path-route.service.ts:625-627`, `:881-890`).

Hält der Intro-Flug, ein offener Lauf oder die 3 s `remeasure()` auf, ruft es
sich selbst wieder auf (`retryRemeasure`, `corridor-refit.ts:222-228`): bei
den 3 s, sobald sie um sind, sonst alle 3 s, bis es misst; unter Tower,
Gegner oder Welle nicht. Vorher geschah nach einem aufgehaltenen Aufruf nichts
mehr bis zum nächsten Tile-Schub. Setzte sich der letzte Schub eines Orts
während des Intro-Flugs (der den Korridor lädt) oder kurz nach einem Lauf,
blieben die Stationen bei der OSM-Breite, bis die Kamera neue Tiles lud
(Befund 2 in REVIEW_SPRINT_2026-09-12).

Wird der Spawn oder das HQ ohne Neuladen des Orts umgesetzt
(`LocationFacadeService.applySpawnInPlace`, `applyHqInPlace`), entsteht die
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
`corridor-refit.ts:89`, Ablauf `:115-131`). Die Frames kommen aus
`requestAnimationFrame` wie beim Höhen-Sweep
(`CorridorController`, `corridor-controller.ts:54-61`).

- **Budget:** Eine Station (Säule und vier Strahlen) kostete im Playtest vom
  2026-09-12 in der Innenstadt etwa 1,7 ms (533 ms für 316 Stationen); 4 ms
  sind dort zwei Stationen je Frame. Der Höhen-Sweep nach einem Tile-Schub
  nimmt 5 ms je Frame und läuft oft in denselben Frames, zusammen bleiben
  beide unter 10 ms. Der Lauf hört vor der Station auf, die nach den
  bisherigen Kosten je Station über das Budget ginge, nimmt aber mindestens
  eine Station je Frame.
- **Budget, während der Spieler wartet:** Solange der Hinweis "MOVING HQ"
  steht (`RelocationStatusService.status`, `CorridorRefitHost.hurried`), sind
  es `HURRIED_BUDGET_MS` = 32 ms je Frame (`corridor-refit.ts`). Im Playtest
  vom 2026-09-14 in Paris brauchte ein Umzug für 358 Stationen 465 ms
  Rechenzeit in 144 Scheiben über 5,3 s; jeder Frame kostete neben seiner
  Scheibe etwa 33 ms. Mit 32 ms sind es etwa 15 Frames zu 65 ms, rund 1 s.
  Gelesen wird je Scheibe: Verschwindet der Hinweis mitten im Lauf, geht es
  mit 4 ms weiter. Nachmessungen nach Tile-Schüben und die erste Messung
  nach dem Laden laufen ohne Hinweis und behalten die 4 ms.
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
  `CorridorRefit.flush` (`corridor-refit.ts:200`) den Rest sofort am Stück,
  speichert und baut neu; erst dann steht der Tower oder startet die Welle.
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
  `dispose` und ein neuer Lauf verwerfen den offenen. `fitToTiles()` lässt
  einen offenen Lauf weiterlaufen, `remeasure()` wartet auf ihn.
- **Konsole:** `__corridor.set()` und `reset()` verwerfen einen offenen Lauf
  und messen am Stück (Budget unbegrenzt), die Konsole wartet auf die
  Antwort.

### Neuaufbau

`CorridorController.rebuildCorridors` (`corridor-controller.ts:108-138`) läuft synchron in
einem Frame:

1. `routes`: `refreshRouteLines`, also Wegsuche je Spawn, Korridoranpassung
   und rote Linie.
2. `grid`: Grid leeren und neu erzeugen, samt erster Höhenprobe je Zelle.
3. `heights`: voller Höhen-Sweep (`updateTerrainHeights`).
4. `lines`: `refreshRouteLines` ein zweites Mal, auf den neuen Zellhöhen.
5. `overlays`: Debug-Layer neu, laufende Routen-Animation neu gestartet.

### Logs

```
[Corridor] clearance: segments= stations= unmeasured= (coarse tile N) rays= changed= in X ms slices= wall= ms [flushed=tower|wave] [noTile=x,z;x,z;...]
[Corridor] clearance cancelled (Grund): stations=N of M in X ms slices= wall= ms, corridor unchanged
[Corridor] rebuild: routes= grid= heights= lines= overlays= total= ms spawns= cells=
```

- **`clearance`** (`ClearanceRun.commit`, `path-route.service.ts:1096-1102`):
  erscheint am Ende eines Laufs, der mindestens ein Segment angefasst hat.
  - `stations`: die in diesem Lauf versuchten Stationen.
  - `rays`: 2 Strahlhöhen × 2 Seiten × gemessene Stationen; die Säulenprobe
    ist nicht mitgezählt.
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
    `routeCorridor` (`terrain-queries.ts:352`).
- **`clearance cancelled`** (`:1111-1114`): Ein Lauf wurde verworfen, der
  Korridor bleibt, wie er war. Der Grund ist einer der Sperrgründe
  (`enemies are on the map`, sonst `towers stand on the map, sell them first`
  oder `a wave is running`) oder `routes replaced`, `location changed`,
  `measurements cleared`, `settings changed`, `superseded`, `disposed`.
  `stations=N of M`: so weit kam er.
- **`rebuild`**: erscheint nur bei einem Neuaufbau, also nach `changed=true`
  oder nach `__corridor.set()`/`reset()`.
- **Gemessen** (Playtest 2026-09-12, Innenstadt, eine Route, Punkt 52 in
  REVIEW_SPRINT_2026-09-12, noch am Stück): Neuaufbau 39,5 bis 41,7 ms; die
  Messung davor mit 1260 Strahlen 520 bis 533 ms. Weitere Orte sind nicht
  gemessen.

## Feine Tiles im Korridor

Die Tile-Region `RouteCorridorRegion` (`three-engine/route-corridor-region.ts`)
hält Tiles bis 20 m neben den Routensegmenten auf 5 m geometricError und aktiv,
auch außerhalb des Bildes (`ROUTE_CORRIDOR_HALF_WIDTH`,
`ROUTE_CORRIDOR_ERROR_TARGET`, `three-tiles-engine.ts:74-80`, `setRouteCorridor()` `:759`). Daher
die Vorgabe `maxTileError` 5 und die Obergrenze 15 für `maxHalfWidth`: Weiter
als 20 m neben der Route gibt es keine garantiert feinen Tiles.

## Diagnose

### `__corridor` (DevTools)

Registriert in `CorridorConsole.install` (`services/debug/corridor-console.ts:40-52`),
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
```

- **`set` und `reset`** geben `Not changed: ...` zurück, wenn kein Ort geladen
  ist, die Sperre greift oder ein Wert abgelehnt wird (unbekannter Name, Wert
  außerhalb des Bereichs, Minimum über Maximum). Sonst kommt
  `Corridor rebuilt[, measured again]: N cells. Widths per stretch: __routes.describe()`
  zurück (`corridor-refit.ts:169-187`).
  - Die Werte gelten bis zum Neuladen der Seite; dauerhaft heißt
    `CORRIDOR_DEFAULTS` im Code ändern.
- **`towerCells`** gibt eine Tabelle zum Tower zurück (`corridor-console.ts:149-203`):
  - Zellen in Reichweite: `cells`, `unsampled`.
  - Antworten des Towers: `groundVisible`/`Blocked`/`Missing`, dasselbe für
    `air`.
  - Auffällige Zellen: `holes`, `raised` (mehr als 1 m über dem Median der
    Nachbarn), `clamped`.
  - Die Mittellinie für sich: `centreCells`, `centreMissing`,
    `centreUnsampled`, `centreBlocked`, `centreRaised`, `centreClamped`,
    `centreNotDisplayed`.
  - Die LOS-Anzeige: `displayed`, `displayOutdated`, `notDisplayed`,
    `cubeFromTower`.

  Deutung der Felder: ROUTE_GEOMETRY_ANALYSIS.md, Abschnitt "Lücken in der
  LOS-Anzeige".
- **`pick`** nimmt den nächsten Linksklick auf die Karte, ohne etwas auszuwählen
  oder zu bauen (`InputHandlerService.armPick`, `input-handler.service.ts:239`).
  Danach stehen zwei Ausgaben in der Konsole.
  1. `[Corridor] pick at x,z: N spots within r m`: je Rasterstelle im Umkreis,
     die nächste zur Mittellinie zuerst (`RouteCellProbe`,
     `route-grid-diagnostics.ts:101-118`).
     - Lage und Zelle: `routeM`, `cell`, `state`, `heightM`, `clamped`,
       `aboveNeighboursM`, `surface`.
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
  2. `[Corridor] width at the nearest route station`: woher die Breite an der
     nächsten Station kommt (`explainCorridorAt`,
     `path-route.service.ts:664-780`).
     - Die Station: Way, `tags` (`width`, `lanes`, `bridge`, `tunnel`,
       `covered`, `layer` wie in `__routes.describe()`), `streetWidthM`, `widthSource`, `onStreet`,
       `inTunnel`, `unmeasured`, `tileError`, am Ende `shiftM` (wie weit
       entlang der Route die Station neben einer Naht gemessen wurde, sonst
       null).
     - Je Seite eine Zeile: `lowHitM`, `highHitM`, `wall`, `freeM`,
       `smoothedM`, `halfWidthM`, `inUseM` und `rule`.
     - Eine Tabelle mit den vier Stationen davor und danach; `leftM` und
       `rightM` sind die Halbbreiten der Stücke dort.

  `rule` nennt die Regeln, die gegriffen haben, auch mehrere
  (`bulge cut, wall less margin`):
  - aus der Messung: `dip closed`, `bulge cut`, `wall less margin`,
    `no wall within the maximum`, `minimum`, `leg to the HQ: street width`,
    angehängt `overhang: outer face` (siehe Auskragung);
  - ohne Messung: `unmeasured: from neighbours` (kurze Lücke, gefolgt von
    den Regeln oben), `unmeasured: street width`,
    `tunnel or covered: street width`, `not measured yet: street width`;
  - danach, über die fertigen Stücke: `short narrowing closed`.

### `__routes.describe()`

`console.table` mit einer Zeile je Stück einer Route über einen OSM-Way
(`RouteWayRun`, `route-way-report.ts:34-67`):

- Lage: `route`, `fromIndex`, `toIndex`, `lengthM`.
- Der Way: `way`, `type`, `name`, `tags` (`width`, `lanes`, `bridge`,
  `tunnel`, `covered`, `layer`).
- Straßenbreite: `widthM`, `widthSource` (`width`, `lanes`, `highway` oder
  `inherited` für das Endstück zum HQ).
- Korridor: `corridorM` (links plus rechts), `leftM`, `rightM`, als Spanne,
  wo die Breite wechselt.
- Höhe: `maxCellAboveStreetM` und `at`, der größte Abstand der Zellhöhe über
  dem gelben Straßen-Overlay entlang der Mittellinie.

Nur für Diagnose: je Punkt alle 2 m bis zu fünf Säulenproben.

### Linie, Zellen und Gegner verschwinden (Brücken, Unterführungen)

Befund Paris (TODO 1.10, alte Liste 14): Die Route läuft am Quai an den
Köpfen einer Brücke vorbei, an zwei Stellen verschwinden Gegner, Zellen und
rote Linie. Was der Code dazu sagt:

- Die rote Linie liegt 1 m (in DevWorld 3 m) über den Zellen der
  Mittellinie und zeichnet mit Tiefentest
  (`route-line-layer.ts`), Gegner ebenso. Das Route Grid Overlay zeichnet
  jede Zelle ohne Tiefentest (`route-grid-aggregate-viz.ts`), eine Zelle
  unter einer Brücke bliebe dort also sichtbar.
- Eine Zelle nimmt den untersten Treffer ihrer Säule, auf einem Segment mit
  `bridge=*` den obersten. Ein Way unter einer Brücke ist in OSM oft ohne
  `tunnel`, nur mit `layer=-1` oder ganz ohne Tag erfasst; dann ist die
  Zelle `ground`.

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
(`quick-actions.component.html:156-163`). Gezeichnet wird jede Zelle des Grids, auch
ohne Höhenprobe. Die Fläche ist grau ohne Tower-Abdeckung und grün mit, Zellen
der Mittellinie sind etwas kräftiger.

Die Kontur zeigt den Zustand, in dieser Rangfolge (`overlayCellKind`,
`route-grid-aggregate-viz.ts:30-37`; Farben in `LOS_VIZ_CONFIG.gridOverlay`,
`los-viz.config.ts:113-137`):

| Kontur | Zustand |
|---|---|
| rosa | ohne Höhenprobe; die LOS-Anzeige eines Towers lässt die Zelle aus. Eine gefüllte Zelle (`filled`, siehe Zellhöhe) hat eine Höhe und die Kontur ihrer Fläche; `__corridor.pick()` zeigt sie als `state: 'filled'`, `__rg.dumpStats()` zählt sie unter `filled` |
| blau | Brückendeck |
| gelb | Tunnel oder überdachter Durchgang |
| orange | vom Dach- oder Stufen-Check auf den Boden gesetzt (`clamped`) |
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
  Vorgärten mit niedriger Hecke oder Mauer) ist der Korridor auf dieser Seite
  7 m breit.
- Dach- und Stufen-Check gehen von der Mittellinien-Zelle daneben aus.
  Steht dort selbst eine Krone oder ein Auto (OSM-Linie über dem
  Parkstreifen), greifen sie nicht. Eine Zelle auf einem Auto oder einer
  Hecke bleibt begehbar, nur auf Straßenhöhe: Gegner laufen dort durch das
  Auto. Die Tower-LOS probt dort weiter über dem Objekt (siehe
  Stufen-Check, Sichtlinie); ob ein Tower die Zelle sieht, hängt also wie
  vorher davon ab, was zwischen ihm und dem Objekt steht, nicht davon, dass
  der Gegner darin gezeichnet wird. Den Korridor am Auto enden zu lassen hieße, einen Strahl allein als
  Wand zu werten, genau das hat der Playtest vom 2026-09-12 verworfen
  (Transporterreihe engte die Straße ein, `8910463`). Vorgärten auf
  Straßenhöhe hinter Zaun oder Hecke bleiben aus demselben Grund im
  Korridor. Steht an einem Hang zur Zelle hin ein Auto und fällt die andere
  Seite ähnlich stark, nimmt der Stufen-Check die Neigung für den Hang und
  lässt die Zelle auf dem Auto.
- Nähte zwischen Tile-Meshes: Stationen und Zellen versuchen Säulen 0,5 m
  daneben, Lücken füllt der Grid aus den Nachbarn. Eine Lücke breiter als
  eine Zelle bleibt ohne Höhe (rosa), eine Messlücke länger als etwa
  `dipLength` bei der Straßenbreite. Liegt der Mittelpunkt einer Zelle in
  keiner Bounding Box eines Tiles, probt der Sweep sie gar nicht; dann greift
  nur das Füllen. Der Ausreißer-Test braucht mindestens drei stabile
  Nachbarn derselben Fläche; für eine erste Probe oder ein Upgrade zählen
  nur Nachbarn aus mindestens so tiefen Tiles. Ein Treffer aus einem
  feineren Tile als alle Nachbarn wird dort also nicht geprüft.
- Die Portalprobe eines Tunnels kann auf einem Überhang oder Hang landen, dann
  steht das ganze Tunnelstück schief. Eine Kuppe oder Senke im Tunnel wird als
  Gerade zwischen den Portalen angenähert.
- Zwei Routen auf verschiedenen Ebenen, die sich Zellen teilen: bei einer
  Brücke gilt der Boden, bei einem Tunnel die Tunnelsohle.
- Der Neuaufbau läuft weiter synchron in einem Frame, im Playtest etwa 40 ms
  (routes 14, lines 11, grid 10, heights 4 bis 6 ms). Routen und Zellen
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
