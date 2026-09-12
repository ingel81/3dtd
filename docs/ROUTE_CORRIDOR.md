# Routenkorridor

**Stand:** 2026-09-13

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
| Straßenbreite je Segment | `utils/route-corridor.ts` (`estimateStreetWidth`, `routeHalfWidths`), Zuordnung Segment zu OSM-Way in `path-route.service.ts:580-588` | Halbbreite aus OSM, Rückfall für alles, was die Tiles nicht messen |
| Messung | `PathAndRouteService.measureStreetClearance` (`path-route.service.ts:909`), Strahlen in `ThreeTilesEngine.measureStreetClearance` (`three-tiles-engine.ts:1092`) | Freiraum je Station und Seite |
| Anpassung | `fitCorridorStations`, `fitCorridorPieces` (`route-corridor.ts:445`, `:496`), `applyClearance` (`path-route.service.ts:684`) | Segmente geteilt, wo sich eine Seite ändert; Halbbreite links und rechts je Stück |
| Waypoints | `path-route.service.ts:636-641` | `corridorLeft`, `corridorRight`, `onBridge`, `inTunnel` am Waypoint, gültig für das Segment ab dort (`RouteWaypoint`, `models/game.types.ts`) |
| Zellen | `GlobalRouteGrid.generateFromRoutes` (`global-route-grid.ts:312`) | 2-m-Zellen im Korridor |
| Zellhöhe | `RouteCellSampler.sampleCellY` (`route-cell-sampler.ts`) | Boden, Brückendeck, Tunnelsohle, Dach-Check |
| Gegner | `MovementComponent` (`movement.component.ts:379-428`), `getRouteProfile` (`route-corridor.ts:559`) | Seitenversatz innerhalb der Zellen |
| Auslöser | `CorridorRefit` (`services/world/corridor-refit.ts`), verdrahtet in `visualization-facade.service.ts:210-222` | Wann gemessen und neu gebaut wird |

## Einstellungen

Alle Werte stehen in `corridorConfig`, die Vorgaben in `CORRIDOR_DEFAULTS`
(`route-corridor.ts:117-160`), die erlaubten Bereiche in `SETTING_RANGES`
(`:188-209`). Routen und Grid lesen die Werte beim Bauen; eine Änderung wirkt
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
| `maxTileError` | 5 | 0,1 bis 100 | gröbstes Tile (geometricError), das für die Messung zählt |
| `widthStep` | 0,5 | 0,1 bis 2 | Rundung der gemessenen Breite nach unten |
| `dipLength` | 4 | 0 bis 100 | Einbrüche bis etwa so lang werden geschlossen |
| `bulgeLength` | 8 | 0 bis 100 | Ausbuchtungen bis etwa so lang werden abgeschnitten |
| `roofRise` | 2,5 | 0,5 bis 50 | Schwelle des Dach-Checks |
| `highwayWidths` | Tabelle unten | je bis 50 | Straßenbreite je `highway`-Klasse |
| `unknownHighwayWidth`, `laneWidth`, `laneExtra` | 5, 3, 1 | 1 bis 50, 1 bis 10, 0 bis 10 | Breite unbekannter Klassen, Spurbreite, Zuschlag bei `lanes` |

`MEASUREMENT_KEYS` (`route-corridor.ts:179-185`) sind die Werte, deren Änderung
eine neue Messung braucht: `stationSpacing`, `rayHeightLow`, `rayHeightHigh`,
`maxHalfWidth`, `maxTileError`. Die übrigen formen nur das Gemessene um.

## Breite aus dem Freiraum, je Seite

### Messung

`PathAndRouteService.measureStreetClearance` (`path-route.service.ts:909-984`)
geht jedes Segment jeder Route durch. Ein Segment der Länge `L` bekommt
`n = max(1, round(L / stationSpacing))` Stationen, Station `k` steht bei
`(k + 0,5) / n` des Segments. Segmente, die mehrere Routen teilen, werden
einmal gemessen.

Je Station (`three-tiles-engine.ts:1092-1147`):

1. Eine Säulenprobe unter der Station. Ohne Tile ist die Station
   `unmeasured: 'no tile'`, mit einem Tile gröber als `maxTileError` ist sie
   `unmeasured: 'coarse tile'`.
2. Je Strahlhöhe ein waagrechter Strahl nach links und einer nach rechts, in
   1 m und 3,5 m über dem Boden der Säule (auf einer Brücke über ihrer
   Oberkante `topY`), jeder `maxHalfWidth` lang.
3. Ein Treffer zählt nur auf einem Tile mit höchstens `maxTileError`
   geometricError und nicht auf dem Wurzel-Tile (`:1142-1143`). Ohne Treffer
   meldet der Strahl seine volle Länge.

Der Freiraum einer Seite ist der weitere der beiden ersten Treffer
(`probeFreeSpace`, `route-corridor.ts:417`). Eine Wand ist also nur, was beide
Strahlen stoppt: Fassade, Mauer, Stamm. Ein parkendes Auto, ein Transporter,
eine Hecke oder ein Zaun stoppt nur den unteren, eine Baumkrone, Traufe oder ein
Balkon nur den oberen; beides engt den Korridor nicht ein.

Gespeichert wird der Freiraum je Segment, Station und Seite in
`clearanceBySegment` (`path-route.service.ts:218`), NaN für ungemessene
Stationen, dazu die Rohwerte je Station für `__corridor.pick()`. Ein weiterer
Lauf misst nur die NaN-Stationen nach (`:934-951`). Tunnel- und
Durchgangssegmente werden übersprungen (`:928`).

### Glättung und Halbbreite

`fitCorridorStations` (`route-corridor.ts:445-488`) arbeitet je Seite über die
ganze Route, über Waypoints hinweg:

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

Stationen ohne Messung bekommen die Halbbreite der Straße
(`rule: 'unmeasured: street width'`).

`fitCorridorPieces` (`:496-510`) fasst Stationen mit gleicher Halbbreite links
und rechts zu einem Stück zusammen. `applyClearance`
(`path-route.service.ts:684-709`) teilt jedes Segment an den Stückgrenzen; jedes
Stück wird ein eigener Waypoint mit `corridorLeft` und `corridorRight`. Solange
noch gar nichts gemessen ist, laufen beide Seiten mit der Straßenbreite.

## OSM-Breite als Rückfall und Deckel

`estimateStreetWidth` (`route-corridor.ts:271-282`): der `width`-Tag, sonst
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
ein Segment ohne Way davor `defaultHalfWidth` (`routeHalfWidths`, `:294-302`).

Die OSM-Breite gilt:

- an Stationen ohne Messung (kein oder zu grobes Tile),
- in Tunneln und Durchgängen,
- als Obergrenze auf dem Endstück zum HQ,
- in DevWorld. Dort liefert die Engine keine Probe (`three-tiles-engine.ts:1102`), und die
  Straßen werden in der Breite gezeichnet, die der Korridor ohnehin nimmt
  (siehe [DEVWORLD.md](DEVWORLD.md)).

## Zellen und Engstellen

Die Route-Zellen sind 2 m groß (`global-route-grid.ts:150`).
`generateSegmentCells` (`:353-409`) nimmt eine Zelle in den Korridor auf, wenn

- ihr Mittelpunkt höchstens die Halbbreite ihrer Seite vom Segment entfernt
  liegt, oder
- das Segment ihr Quadrat berührt (`segmentTouchesCell`, Liang-Barsky,
  `:415-441`).

Die zweite Regel sorgt dafür, dass die Zellen, durch die die Mittellinie läuft,
bei jeder Breite dazugehören. Eine Engstelle schmaler als eine Zelle bleibt so
eine Zellreihe, auf einer Diagonale eine Treppe.

Zellen werden erst gesampelt, wenn alle Segmente ihre Zellen beansprucht haben
(`:336-338`), weil die Fläche einer Zelle von allen Segmenten abhängt, die sie
erreichen.

## Zellhöhe

Die Höhe einer Zelle kommt aus der Säulenprobe an ihrem Mittelpunkt: der
unterste Treffer der feinsten LOD (`column-sample.ts`). Ausnahmen:

- **Dach-Check** (`route-cell-sampler.ts:141-155`): Liegt die Probe einer
  Zelle neben der Mittellinie mehr als `roofRise` (2,5 m) über dem Boden der
  Mittellinien-Zelle daneben, nimmt die Zelle diesen Boden und trägt
  `sample.clamped = true`. Die Säule hat dann ein Dach, eine Traufe oder eine
  Krone getroffen, unter der die Photogrammetrie keinen Boden hat. Der Check
  senkt nur ab, gilt nur für Zellen mit Fläche `ground` und nicht für die
  Mittellinien-Zellen selbst. Welche Mittellinien-Zelle daneben liegt, legt
  `generateSegmentCells` beim Anlegen fest (`axisX`, `axisZ`,
  `global-route-grid.ts:401-403`).
- **Brückendeck:** Segmente über einen Way mit `bridge=*`
  (`path-route.service.ts:584`) tragen `onBridge`, ihre Zellen die Fläche
  `deck` und nehmen die Oberkante der Säule (`topY`) statt des Bodens
  (`route-cell-sampler.ts:136`). Erreicht auch ein Segment ohne Brücke dieselbe
  Zelle, bleibt sie am Boden (`global-route-grid.ts:396-398`).
- **Tunnel und überdachte Durchgänge:** `runsUnderCover`
  (`route-corridor.ts:316`) gilt für `tunnel=*` außer `no` (also auch
  `building_passage`) und für `covered=yes`. Solche Segmente tragen `inTunnel`
  und werden nicht vermessen, es gilt die OSM-Breite. Ihre Zellen haben die
  Fläche `tunnel`.
  - **Höhe:** linear zwischen dem Boden an zwei Portalen, je 2 m vor den
    Mündungen des ganzen Tunnelstücks (`TUNNEL_PORTAL_OFFSET_M`,
    `tunnelSegments`, `global-route-grid.ts:33-90`). Die Höhe hat die gröbere
    LOD der beiden Portale (`tunnelColumn`, `route-cell-sampler.ts:237-249`).
  - **Ohne Portal-Tile:** Solange an einem der beiden Portale kein Tile
    liegt, bleibt die Zelle ohne Höhenprobe.
  - **Geteilte Zellen:** Erreicht ein Tunnelsegment eine Zelle, ist sie
    Tunnelzelle, auch wenn ein anderes Segment sie ebenfalls erreicht
    (`global-route-grid.ts:393-395`).
  - Kein Dach-Check.

## Seitenversatz der Gegner

Jeder Gegner bekommt beim Spawn einen Faktor in [-1, 1]: Zufall mal
`lateralSpread` seines Typs (`enemy.manager.ts:176-178`,
`enemy-types.config.ts`, Werte 0,5 bis 1,0). Negativ heißt links, positiv
rechts der Fahrtrichtung, 0 die Mittellinie.

Der Versatz in Metern ist Faktor mal die seitliche Grenze an der aktuellen
Stelle, auf der Seite, auf der der Gegner läuft (`movement.component.ts:406-427`).

- **Grenze eines Segments:** `lateralLimit(H) = max(0, H - edgeMargin)`
  (`route-corridor.ts:523`). `edgeMargin` ist mindestens die halbe Diagonale
  einer 2-m-Zelle (1,41 m). Ein Gegner innerhalb der Grenze steht deshalb
  in einer Zelle, deren Mittelpunkt innerhalb `H` liegt, also in einer Zelle,
  die das Grid angelegt hat (`route-corridor.ts:37-44`).
  - **Warum das zählt:** Außerhalb der Zellen findet `getEnemiesForTower`
    den Gegner nicht (`global-route-grid.ts:1059`).
  - **Test:** `integration/route-corridor-coverage.spec.ts` läuft das über
    Engstellen und Ecken ab.
- **Übergänge:** Die Grenze an einem Waypoint ist die kleinere der beiden
  angrenzenden Segmente. Danach darf sie entlang der Route höchstens um
  `taper` (0,5 m pro m) steigen (`buildSideLimits`, `route-corridor.ts:592-622`).
  Vor einer Engstelle rücken Gegner so allmählich ein, statt am ersten
  schmalen Waypoint seitlich zu springen.
- **Mittellinie:** Unter 1,5 m Halbbreite ist die Grenze 0. An einer
  einzelligen Engstelle laufen alle Gegner auf der Mittellinie.
- **Kosten:** Die Grenzen werden einmal je Pfad-Array berechnet und geteilt
  (`getRouteProfile`, WeakMap). Im Sub-Step bleiben ein Index-Lookup und
  drei Vergleiche.
- **Richtung:** Der Versatz steht in Metern senkrecht zur Laufrichtung;
  nur die Länge wird mit cos(Breite) skaliert (`movement.component.ts:386-403`).

## Wann gemessen und neu gebaut wird

`CorridorRefit` (`services/world/corridor-refit.ts`) entscheidet das, getestet in
`corridor-refit.spec.ts`. Drei Auslöser:

| Auslöser | Wann | Bedingung |
|---|---|---|
| `fitToTiles()` | einmal pro Ortsladung, sobald `scheduleOverlayHeightUpdate` fertig ist (`visualization-facade.service.ts:649-651`). Das Höhen-Update läuft alle 500 ms, mindestens 4 Runden (`height-update.service.ts:23-26`) | neu gebaut wird nur, wenn die Messung einen Korridor ändert |
| `remeasure()` | am Ende jeder Konvergenzschleife nach einem Tile-Schub (`visualization-facade.service.ts:1085-1094`) | es gibt Stationen mit `no tile` oder `coarse tile` (`hasUnmeasuredStations`), kein Intro-Flug, letzter Lauf mindestens 3 s her (`REMEASURE_INTERVAL_MS`) |
| `change()` | `__corridor.set()` und `__corridor.reset()` | ein Ort ist geladen; bei geänderten `MEASUREMENT_KEYS` werden alle Messungen verworfen. Misst und baut immer neu |

Für alle drei gilt die Sperre `rebuildBlocker()`: kein Neuaufbau, solange Tower
stehen, eine Welle läuft oder Gegner auf der Karte sind. Tower halten ihre
LOS-Antworten in den Zellen, die ein Neuaufbau ersetzt, Gegner ihre Zelle und
ihre Route.

Die erste Messung wartet nicht auf die feinen Tiles entlang der Route; die
laden danach weiter. Stationen, die dann noch auf groben Tiles stehen, laufen
mit der OSM-Breite, bis `remeasure()` sie nach einem späteren Tile-Schub
nachholt. Ob sich etwas geändert hat, vergleicht `measureStreetClearance` an den
fertigen Korridorstücken aller Routen vor und nach dem Lauf
(`path-route.service.ts:731-734`, `:976`).

Ein Spawn, der ohne Neuladen des Orts dazukommt
(`LocationFacadeService.addSpawnPoint`, `location-facade.service.ts:348-360`),
baut seine Route mit den vorhandenen Messungen und löst selbst keine Messung
aus. Seine neuen Segmente laufen mit der OSM-Breite, bis ein späterer Lauf sie
mitmisst (`remeasure()` bei ungemessenen Stationen anderswo, oder
`__corridor.set()`/`reset()`).

### Neuaufbau

`rebuildCorridors` (`visualization-facade.service.ts:662-691`) läuft synchron in
einem Frame:

1. `routes`: `refreshRouteLines`, also Wegsuche je Spawn, Korridoranpassung
   und rote Linie.
2. `grid`: Grid leeren und neu erzeugen, samt erster Höhenprobe je Zelle.
3. `heights`: voller Höhen-Sweep (`updateTerrainHeights`).
4. `lines`: `refreshRouteLines` ein zweites Mal, auf den neuen Zellhöhen.
5. `overlays`: Debug-Layer neu, laufende Routen-Animation neu gestartet.

### Logs

```
[Corridor] clearance: segments= stations= unmeasured= (coarse tile N) rays= changed= in X ms
[Corridor] rebuild: routes= grid= heights= lines= overlays= total= ms spawns= cells=
```

- **`clearance`** (`path-route.service.ts:977-982`): erscheint, sobald ein
  Lauf mindestens ein Segment angefasst hat.
  - `stations`: die in diesem Lauf versuchten Stationen.
  - `rays`: 2 Strahlhöhen × 2 Seiten × gemessene Stationen; die Säulenprobe
    ist nicht mitgezählt.
  - `__raycastStats()` bucht die Strahlen und die Säulenprobe unter
    `routeCorridor` (`three-tiles-engine.ts:1104`).
- **`rebuild`**: erscheint nur bei einem Neuaufbau, also nach `changed=true`
  oder nach `__corridor.set()`/`reset()`.
- **Gemessen** (Playtest 2026-09-12, Innenstadt, eine Route, Punkt 52 in
  REVIEW_SPRINT_2026-09-12): Neuaufbau 39,5 bis 41,7 ms; die Messung davor mit
  1260 Strahlen 520 bis 533 ms. Weitere Orte sind nicht gemessen.

## Feine Tiles im Korridor

Die Tile-Region `RouteCorridorRegion` (`three-engine/route-corridor-region.ts`)
hält Tiles bis 20 m neben den Routensegmenten auf 5 m geometricError und aktiv,
auch außerhalb des Bildes (`ROUTE_CORRIDOR_HALF_WIDTH`,
`ROUTE_CORRIDOR_ERROR_TARGET`, `three-tiles-engine.ts:104-110`, `:1267`). Daher
die Vorgabe `maxTileError` 5 und die Obergrenze 15 für `maxHalfWidth`: Weiter
als 20 m neben der Route gibt es keine garantiert feinen Tiles.

## Diagnose

### `__corridor` (DevTools)

Registriert in `visualization-facade.service.ts:153-162`.

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
  zurück (`corridor-refit.ts:99-113`).
  - Die Werte gelten bis zum Neuladen der Seite; dauerhaft heißt
    `CORRIDOR_DEFAULTS` im Code ändern.
- **`towerCells`** gibt eine Tabelle zum Tower zurück (`:233-286`):
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
  oder zu bauen (`InputHandlerService.armPick`, `input-handler.service.ts:170`).
  Danach stehen zwei Ausgaben in der Konsole.
  1. `[Corridor] pick at x,z: N spots within r m`: je Rasterstelle im Umkreis,
     die nächste zur Mittellinie zuerst (`RouteCellProbe`,
     `route-grid-diagnostics.ts:96-113`).
     - Lage und Zelle: `routeM`, `cell`, `state`, `heightM`, `clamped`,
       `aboveNeighboursM`, `surface`.
     - Antworten und Anzeige des ausgewählten Towers: `ground`, `air`,
       `displayed`.
  2. `[Corridor] width at the nearest route station`: woher die Breite an der
     nächsten Station kommt (`explainCorridorAt`,
     `path-route.service.ts:765-865`).
     - Die Station: Way, `streetWidthM`, `widthSource`, `onStreet`,
       `inTunnel`, `unmeasured`, `tileError`.
     - Je Seite eine Zeile: `lowHitM`, `highHitM`, `wall`, `freeM`,
       `smoothedM`, `halfWidthM`, `inUseM` und `rule`.
     - Eine Tabelle mit den vier Stationen davor und danach.

  `rule` nennt die Regeln, die gegriffen haben, auch mehrere
  (`bulge cut, wall less margin`):
  - aus der Messung: `dip closed`, `bulge cut`, `wall less margin`,
    `no wall within the maximum`, `minimum`, `leg to the HQ: street width`;
  - ohne Messung: `unmeasured: street width`,
    `tunnel or covered: street width`, `not measured yet: street width`.

### `__routes.describe()`

`console.table` mit einer Zeile je Stück einer Route über einen OSM-Way
(`RouteWayRun`, `path-route.service.ts:84-117`):

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

### Route Grid Overlay

Layer "Route Grid Overlay" im Layers-Menü der Quick-Actions
(`quick-actions.component.ts:172`). Gezeichnet wird jede Zelle des Grids, auch
ohne Höhenprobe. Die Fläche ist grau ohne Tower-Abdeckung und grün mit, Zellen
der Mittellinie sind etwas kräftiger.

Die Kontur zeigt den Zustand, in dieser Rangfolge (`overlayCellKind`,
`route-grid-aggregate-viz.ts:30-37`; Farben in `LOS_VIZ_CONFIG.gridOverlay`,
`los-viz.config.ts:111-135`):

| Kontur | Zustand |
|---|---|
| rosa | ohne Höhenprobe; die LOS-Anzeige eines Towers lässt die Zelle aus |
| blau | Brückendeck |
| gelb | Tunnel oder überdachter Durchgang |
| orange | vom Dach-Check auf den Boden gesetzt (`clamped`) |
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
- Der Dach-Check vergleicht mit der Mittellinien-Zelle daneben. Steht dort
  selbst eine Krone, greift er nicht; eine Probe auf einem Autodach unter
  2,5 m über der Mittellinie greift er ebenfalls nicht.
- Die Portalprobe eines Tunnels kann auf einem Überhang oder Hang landen, dann
  steht das ganze Tunnelstück schief. Eine Kuppe oder Senke im Tunnel wird als
  Gerade zwischen den Portalen angenähert.
- Zwei Routen auf verschiedenen Ebenen, die sich Zellen teilen: bei einer
  Brücke gilt der Boden, bei einem Tunnel die Tunnelsohle.
- Messung und Neuaufbau laufen synchron im Hauptthread.
