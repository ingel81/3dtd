# Welt aus OpenStreetMap (Plan)

**Status:** Plan, 2026-10-14; Phase O1 „Graue Welt“ gebaut 2026-10-15 (TODO E157), siehe [Phase O1](#phase-o1-gebaut-2026-10-15);
Phase O3 „Land und Wasser“ gebaut 2026-10-15, siehe [Phase O3](#phase-o3-gebaut-2026-10-15)
**Bezug:** [CUSTOM_MAPS.md](CUSTOM_MAPS.md) (Renderer, Katalog), [CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md) (Spiel),
[LEVEL_EDITOR.md](LEVEL_EDITOR.md) (Editor), [W3X_IMPORT.md](W3X_IMPORT.md) (Vorbild für einen Importer im Worker),
[LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) (Ortssuche, Spawns auf echten Orten), [SHOWCASE_LEVELS.md](SHOWCASE_LEVELS.md)
(`LevelKit`)

Aus einer Adresse wird eine eigene Karte: Gelände aus freien Höhendaten, Straßen, Brücken, Gebäude, Landnutzung,
Gewässer und Ausstattung aus OpenStreetMap. Das Ergebnis ist ein gewöhnliches Kartendokument (`CustomMapDocument`), das
wie jede eigene Karte gespielt, im Koop verschickt und im Editor bearbeitet wird.

## Vorgaben (User, 2026-10-14)

- Spieler ohne 3D-Tile-Token spielen trotzdem auf „ihrer“ Adresse.
- Eine erzeugte Welt, zwei Wege: direkt spielen, oder in den Editor nehmen und bearbeiten, auch nachträglich aus einem
  laufenden oder gespielten Ort.
- Ortssuche wie im Spiel, Rahmen auf einer flachen OSM-Karte.
- Gelände aus freien Höhendaten, geglättet.
- HQ auf der Adresse, Spawns wie auf echten Orten (Portale auf Straßen, 500 bis 1000 m, verschiebbar), Gegner auf dem
  OSM-Straßennetz; die Karte wird so groß, dass alle Spawns darin liegen.
- Gebäude: jeder Grundriss bekommt ein passendes Katalog-Modell nach Größe, Form und Art, auf den Grundriss gedreht;
  fehlende Arten werden eine Liste für neue Katalog-Modelle.
- Erste Fassung mit allem, was geht: Gelände, Straßen, Brücken, Gebäude, Landnutzung zu Biomen (Wald mit Bäumen, Wiese,
  Acker, Sand, Fels), Gewässer (Seen, Flüsse, Küste), Ausstattung (Zäune, Mauern, Laternen, Einzelbäume, Bahnlinien).

## Ablauf

```
Adresse suchen ─► flache Karte mit Rahmen, HQ und Spawns ─► Daten holen ─► im Worker erzeugen ─► speichern
 (Nominatim)       (Spawns ziehen, Größe folgt)            (Overpass,       (Bericht, Fortschritt,   │
                                                            Höhenkacheln)    Abbruch)                 ├─► Spielen  ?world=map:<id>
                                                                                                      └─► Editor   /editor?map=<id>
```

1. **Suche:** `AddressAutocompleteComponent` und `GeocodingService` wie in der Ortswahl (Nominatim, 300 ms Entprellung,
   kein Wiederholen bei 429). Aus einem laufenden oder gespielten echten Ort geht es ohne Suche weiter: HQ und Spawns
   kommen aus dem Lauf („Make a map of this place“).
2. **Rahmen:** eine flache Karte zeigt den Ort, das HQ auf der Adresse, die Spawns und den Rahmen der Karte. Spawns
   werden wie auf echten Orten gewürfelt (500 bis 1000 m, auf befahrbaren Straßen) und lassen sich ziehen; sie rasten
   auf Straßen. Der Rahmen folgt: quadratisch um das HQ, groß genug für alle Spawns plus Rand (Vorschlag unten).
   Für das Würfeln und Einrasten braucht die Seite die Straßen schon hier: die Overpass-Abfrage läuft beim Öffnen
   des Rahmens.
3. **Daten holen:** eine Overpass-Abfrage für alles (Rahmen plus Rand), Höhenkacheln für den Rahmen. Beides kommt in
   einen IndexedDB-Speicher je Rahmen (wie `StreetCacheService`), damit ein zweites Erzeugen nichts mehr abruft.
4. **Erzeugen:** im Web Worker wie der W3X-Import (`importOsmInWorker`, Transferables, Abbruch, Zeitlimit), mit
   Fortschritt je Schritt und einem Bericht (was übernommen, ersetzt, ausgedünnt, weggelassen wurde; fehlende
   Gebäudearten).
5. **Speichern:** als eigene Karte im Map-Store, Name aus der Adresse, `meta.source = { kind: 'osm', … }`. Danach
   „Play“ (Spiel mit `?world=map:<id>`) oder „Edit“ (Editor). Weiter wie jede eigene Karte: Koop-Versand bis 32 MB,
   Versionen, Download.

## Was es schon gibt

| Baustein | Wo | Nutzen hier |
|---|---|---|
| Overpass-Zugriff: zwei EU-Server, Hedging nach 4 s, Zeitlimits, Log je Antwort | `services/location/osm-street.service.ts` (`fetchOverpass`, `askOverpass`) | herauslösen in einen Angular-freien `overpass-client.ts`, den Straßen und OSM-Welt teilen |
| Straßen-Tags (Breite, Spuren, Brücke, Tunnel, Ebene) | `parseStreetTags` im selben Service | unverändert |
| Spawn auf echten Orten: Knoten 500 bis 1000 m auf befahrbaren Straßen, Route geprüft, Portal gerade gerückt | `services/location/street-router.ts` (`findRandomStreetPoint`, `straightSpawn`) | läuft auf dem Netz der Karte (`mapStreetNetwork(doc)`), Rand der Karte über `WorldCoverage` (`coveredSpawnRange`) |
| Straßen der Karte als Spielnetz, Routen, Korridor, Routengitter | `world/custom-map/custom-map-streets.ts`, Routengitter wie für jede Welt | nichts Neues: eine OSM-Welt ist eine eigene Karte |
| Kartendokument, Datei, Store, Koop-Versand | `world/custom-map/` | `meta.source` bekommt die Art `osm` |
| Importer im Worker mit Bericht | `world/w3x/` (`import-w3x.ts`, `w3x.worker.ts`, `w3x-import-client.ts`) | Vorbild für Aufbau, Optionen, Bericht |
| Editor-Operationen ohne Oberfläche | `editor/ops/` über `tools/maps/levels/kit.ts` (`LevelKit`) | Wege einebnen und bemalen (`flattenUnderPaths`, `paintUnderPaths`), Fluss (`carveRiver`, Ufer, Schilf, Brücken), Becken (`fillBasin`, `ops/pour.ts`), Biom-Streuung (`biome-brush.ts`), Streuen (`scatterDab`), Linien (`objectsAlong`, `wallAlong`), Laternen (`dressEdge`), Felsen absetzen (`settled`), Prüfung (`validateMap`) |
| Höhen-Import | `editor/ops/heightmap.ts` | bilineares Umrechnen auf das Raster |
| Namensnennung | `configs/attributions.config.ts` (`OSM_MAP_ATTRIBUTION`) | Zeile für OSM-Welten und Höhendaten |

`LevelKit` liest den Katalog heute mit `node:fs`. Für den Worker wandert sein Kern nach `src/app/editor/` (Katalog per
`fetch`), die Level-Skripte behalten eine dünne Hülle.

## Grenzen des Kartenformats

| Grenze | Wert | Folge für 2,4 km |
|---|---|---|
| Höhenraster | 2 m (`DEFAULT_CELL_SIZE`), höchstens 4097 je Seite (`MAX_GRID_SIDE`) | 1201 × 1201 Punkte, passt |
| Bodenfarbe | 8 Schichten (`MAX_GROUND_LAYERS`), Splat bis 1024 (`splatResolutionFor`) | 2,3 m je Texel; Landnutzung muss in 8 Materialien passen |
| Wegemaske | 0,5 m je Texel, höchstens 2048 (`PATH_MASK_MAX_RESOLUTION`) | 1,2 m je Texel, für Straßen ab 3 m Breite ausreichend |
| Gewässer | Hauptwasser plus 64 weitere (`MAX_WATER_BODIES`) | Becken, Brunnen, Pools zusammenfassen oder weglassen |
| Objekte | Budget 15 000 im Editor (`OBJECT_BUDGET`), Messung bis 50 000 | Wald und Gebäude teilen sich das Budget |
| Spawns | 32 (`MAX_SPAWN_PORTALS`) | unkritisch |
| Datei | 32 MB für den Koop-Versand | gemessen 5,6 bis 6,0 MB |
| Größe der Level | mitgeliefert 512 m, Editor bis 2048 m („Large“) | eine OSM-Welt hat bis zur 22-fachen Fläche eines Levels |

Gemessen ist der Renderer bis 1025² Punkte (2 km) mit 50 000 Objekten: 352 fps Übersicht, 432 fps Spielkamera (RTX
5080, 1080p), Aufbau rund 430 ms ohne GPU ([CUSTOM_MAPS.md](CUSTOM_MAPS.md#leistung)). 1201² ist nicht gemessen.

## Proben (2026-10-14)

Zwei Orte, je ein Quadrat von 2,4 km um die Mitte: Miltenberg (Kleinstadt am Main, Weinberge, Wald, Hanglagen) und
Stuttgart Mitte (dichte Innenstadt). Je eine Overpass-Abfrage, Höhenkacheln von zwei Quellen, Rohdaten nur im
Scratchpad. Erzeugt wurde mit einer Wegwerf-Spec über `LevelKit` in Node (ein Kern, nicht im Repo).

**Overpass** (eine Abfrage: `highway`, `building`, `landuse`, `natural`, `leisure`, `waterway`, `water`, `railway`,
`barrier`, `man_made`, `amenity` als Wege und Relationen, dazu Bäume, Laternen, Schranken und `man_made` als Knoten;
`out body geom(<Rahmen>)`, die Geometrie am Rahmen abgeschnitten):

| | Miltenberg | Stuttgart Mitte |
|---|---|---|
| Antwort | 1,5 s, 0,62 MB gzip, 4,3 MB JSON | 2,9 s, 2,29 MB gzip, 15,1 MB JSON |
| Elemente | 6 316 (5 844 Wege, 10 Relationen) | 21 127 (16 895 Wege, 70 Relationen) |
| Straßenwege | 1 646, 118 km, 21 Brücken, 17 Tunnel | 6 367, 252 km, 60 Brücken, 578 Tunnel |
| Gebäude | 3 570 | 7 928 |
| Einzelbäume | 142 | 2 719 |
| Barrieren (Linien) | Hecke 107, Mauer 45, Zaun 35, Stützmauer 16, Stadtmauer 10 | Stützmauer 179, Zaun 158, Mauer 152, Hecke 108 |
| Bahn | 24 Gleise | 165 Gleise, 188 Stadtbahn |
| Wald (Fläche) | rund 1,6 km² von 5,76 | rund 0,07 km² |

Die Abfrage braucht ein größeres `maxsize` als die Straßenabfrage des Spiels (heute 4 MB Serverspeicher). Die
Status-Seite von overpass-api.de nannte am 2026-10-14 vier Plätze je IP; sind sie belegt, antwortet der Server mit 429
(nicht ausgelöst). Eine OSM-Welt kostet also eine Abfrage, ein zweites Erzeugen keine (Speicher).

**Gebäude-Grundrisse** (kleinstes gedrehtes Rechteck je Grundriss):

| | Miltenberg | Stuttgart Mitte |
|---|---|---|
| Fläche (Median, 90 %, 99 %) | 129, 287, 1 514 m² | 113, 399, 2 772 m² |
| unter 30 m² / über 600 m² | 226 / 147 | 2 004 / 492 |
| Längere Seite (Median, 90 %) | 13 m, 23 m | 13 m, 28 m |
| Füllgrad Fläche zu Rechteck (10 %-Quantil) | 0,86 | 0,72 (Hofhäuser, L- und U-Formen) |
| `building=yes` (Art unbekannt) | 45 % | 69 % |
| mit `building:levels` / `height` | 15 % / 0,3 % | 13 % / 0,4 % |

Häufigste Arten: Miltenberg `apartments` 605, `house` 347, `garage` und `garages` 412, `detached` 216, `industrial` 54,
`shed` 45, `carport` 38, `roof` 33, `school` 27; Stuttgart `apartments` 1 117, `office` 311, `garage` 233, `retail` 165,
`roof` 84, `university` 42. Die Art muss also meist aus Größe, Stockwerken und der umgebenden Landnutzung geraten
werden.

**Höhendaten:**

| Quelle | Format | Auflösung, gemessen | CORS | Kacheln für 2,4 km |
|---|---|---|---|---|
| AWS Terrain Tiles (`elevation-tiles-prod`, Terrarium-PNG, 256 px) | Höhe = R·256 + G + B/256 − 32768 | Kopfzeile nennt für beide Orte `eudem`; auf z15 (3 m je Pixel) liegen 75 bis 98 % der Pixel auf einer Geraden mit ihren Nachbarn, also hochgerechnet aus etwa 25 bis 30 m | ja (`*`) | 16 auf z15, 1,1 bis 1,2 MB; z13 genügt (9 Kacheln) |
| Mapterhorn (`tiles.mapterhorn.com`, Terrarium-WebP, 512 px) | wie oben | z16 (0,75 m je Pixel) mit echtem Detail, z17 nur hochgerechnet; laut `attribution.json` alle 16 Bundesländer mit DGM1 (1 m), weltweit Copernicus GLO-30 (30 m), 151 Quellen | ja (`*`) | z14 (3 m je Pixel): 4 bis 9 Kacheln, je 60 bis 85 kB |
| Copernicus GLO-30 direkt (`copernicus-dem-30m`, COG je Grad, 44 MB) | GeoTIFF, Bereichsabruf | 30 m | nein (keine CORS-Kopfzeile) | nur über einen eigenen Dienst |

Namensnennung, nur als Fakten: OpenStreetMap-Daten stehen unter ODbL mit der Zeile „© OpenStreetMap contributors“;
Mapterhorn nennt je Quelle Lizenz und Namen (`download.mapterhorn.com/attribution.json`, etwa „Datenlizenz Deutschland,
Namensnennung 2.0“ oder CC BY 4.0); die AWS-Kacheln haben eine eigene Liste ihrer Quellen.

**Erzeugen** (Node, ein Kern, `LevelKit` auf 2400 m, 2-m-Raster, Splat 1024; die Schritte so roh wie für eine Messung
nötig: Landnutzung nur aus geschlossenen Wegen, Straßen nur befahrbare, jedes Gebäude ein Dorfhaus nach Radius):

| Schritt | Miltenberg | Stuttgart Mitte |
|---|---|---|
| JSON lesen | 24 ms | 86 ms |
| Höhen setzen, Landnutzung in den Splat (89 bzw. 356 Flächen) | 35 ms | 37 ms |
| Straßengraph über `LevelKit.path` (Endpunkte einrasten) | 2,7 s | 26 s |
| Boden unter allen Straßen einebnen, Asphalt malen | 0,7 s | 0,6 s |
| Gebäude (3 496 bzw. 7 629) und Bäume (2 293 bzw. 3 425) setzen | 45 ms | 57 ms |
| HQ, 4 Spawns, Routen | 77 ms | 250 ms |
| Editor-Prüfung (`validateMap`) | 32 s | 312 s |
| Packen | 0,5 s | 0,6 s |
| Datei | 5,55 MB | 5,98 MB |
| Objekte | 5 789 | 11 054 |

Drei Befunde daraus:

- **Straßengraph über Knoten-Ids, nicht über Einrasten.** In Miltenberg waren alle vier Spawns ohne Route: Wege, die
  sich an einem inneren Knoten kreuzen, verbinden sich beim Einrasten der Endpunkte nicht. Das Netz muss aus den
  OSM-Knoten gebaut werden (wie `parseOverpassResponse` für echte Orte): jeder Knoten, den mehrere Wege teilen, wird
  ein Kartenknoten. Das kostet Millisekunden statt 26 s.
- **Die Editor-Prüfung skaliert nicht.** `object-on-path` sucht je Objekt über alle Kanten (`nearestOnEdges`), dazu
  `edgePolyline` je Treffer. Bei 11 000 Objekten und 3 000 Kanten 312 s; dieselbe Prüfung hängt den Editor auf. Braucht
  ein Raster über die Kanten, bevor OSM-Welten in den Editor dürfen.
- **Acht Bodenschichten sind schnell voll.** Schon Miltenberg füllte sie (Gras, Asphalt, Weinberg, Acker, Wiese,
  Rasen, Gestrüpp, Fels); Asphalt musste vorab reserviert werden. Die Landnutzung braucht eine feste Auswahl je Ort.

Alles andere ist schnell. Mit Abruf (2 bis 4 s), Wasser, Gebäudewahl und Ausstattung ist ein Ziel unter 10 s bis zur
fertigen Datei realistisch; geprüft ist das erst mit Phase O1.

## Größe der Karte

HQ in der Mitte. Seite = 2 × (weitester Spawn + 200 m Rand), auf 64 m gerundet, mindestens 1216 m, höchstens 2432 m
(Spawns bis 1000 m plus Rand). Ein Spawn, der im Rahmen weiter gezogen wird, vergrößert den Rahmen bis zur Grenze.
Kleinere Karten laden schneller und halten das Objektbudget leichter. Höhenpunkte alle 2 m, Splat 1024.

Der Rand von 200 m trägt Gelände, Boden und Gebäude, damit das Spielfeld nicht an einer Kante endet; das Land
jenseits der Karte macht der Renderer ohnehin (`terrain-apron.ts`).

## Bausteine

Code in `src/app/world/osm/` ohne Angular und DOM (Worker, Node, Specs), wie `world/w3x/`:

| Datei | Inhalt |
|---|---|
| `overpass-client.ts` (aus `osm-street.service.ts` herausgelöst) | Server, Hedging, Zeitlimits, Log; Straßen und OSM-Welt nutzen ihn |
| `osm-query.ts` | die eine Abfrage für einen Rahmen (Tabelle unten), `out body geom(<Rahmen>)`; bei `remark` (Speicher, Zeit) Teilung in vier Viertel |
| `dem-tiles.ts` | Kachelmathe, Abruf, Dekodieren (`createImageBitmap`, `OffscreenCanvas` im Worker), Mosaik, bilinear auf das Raster, Glätten; Quelle mit Rückfall |
| `osm-parse.ts` | Elemente zu Merkmalen: Linien, Flächen (Multipolygone aus Relationen zusammensetzen), Punkte; Projektion in Kartenmeter um die Mitte |
| `osm-tags.ts` | die Zuordnungstabellen dieses Plans als Daten |
| `convert/terrain.ts` | Höhen, Glätten, Kartennull (bei Küste der Meeresspiegel) |
| `convert/roads.ts` | Straßengraph über Knoten-Ids, Art und Breite, Brücken, Tunnel; Einebnen und Belag |
| `convert/water.ts` | Seen, Flussflächen, Bäche, Küste, Feuchtgebiete |
| `convert/ground.ts` | Landnutzung zu höchstens 8 Schichten, Vorrang bei Überlappung |
| `convert/vegetation.ts` | Wald, Gebüsch, Parks, Einzelbäume, Baumreihen, im Objektbudget |
| `convert/buildings.ts` | Grundriss zu Katalog-Modell(en), Art raten, ausrichten, auf den Hang setzen |
| `convert/furniture.ts` | Zäune, Mauern, Hecken, Laternen, Bahn, Brückenart, Kleinkram |
| `convert/layout.ts` | HQ und Spawns (`StreetRouter` auf `mapStreetNetwork`), Kartenrahmen |
| `import-osm.ts`, `osm.worker.ts`, `osm-import-client.ts` | Ablauf, Bericht, Worker, Abbruch |

Dazu:

- **Oberfläche:** Menü New game, Reiter Places: ein Eintrag „Play on a map of this place“ neben der Ortswahl (ohne
  Token der Weg, mit Token wahlweise); die Rahmen-Seite in `components/main-menu/pages/new-game/`; im Editor unter
  „New map“ ein Weg „From a real place“; im laufenden echten Ort „Make a map of this place“.
- **Flache Karte:** ein kleiner eigener Kachelbetrachter (Canvas, Ziehen, Zoom, Rahmen, HQ, Spawns) auf
  OSM-Rasterkacheln; die Nutzungsregeln der OSMF-Kacheln verlangen Namensnennung, eine erkennbare Anwendung und
  keinen Massenabruf. Alternative in den offenen Fragen.
- **Kartendokument:** `meta.source = { kind: 'osm', lat, lon, address, sideM, fetchedAt, dem, attribution }`. Die
  Herkunft geht mit der Datei; das Spiel zeigt die Namensnennung auf OSM-Welten.
- **Katalog:** je Gebäude ein gedrehtes Rechteck `box: [Breite, Tiefe]` und die Front (gemessen am GLB wie die
  Felsplatten in `tools/map-assets/measure_bases.mjs`, übernommen von `update_catalog.py`), dazu `osm`-Tags für die
  Arten, die ein Modell darstellen kann (`osm:house`, `osm:garage` …). Heute kennt der Katalog nur einen Radius.
- **Prüfung:** `validateMap` mit Raster über die Kanten (Befund oben), damit Prüfen und Editor bei 10 000 Objekten
  flüssig bleiben.

## Zuordnung

### Straßen

| OSM | Karte | Breite (ohne `width`/`lanes`) | Belag |
|---|---|---|---|
| `motorway` bis `tertiary` samt `_link` | `road` | 12 bis 7 m | Asphalt |
| `unclassified`, `residential`, `living_street` | `road` | 6 m | Asphalt, nach `surface` Pflaster |
| `service`, `pedestrian` | `road` | 4 bis 5 m | Asphalt bzw. Platten |
| `track` | `path` | 3 m | Feldweg (`mud-tracks`, `dirt-path`) |
| `footway`, `path`, `cycleway`, `steps` | `path` | 2 bis 3 m | nach `surface` (Kies, Platten, Erde) |
| `bridge=*` | `bridge`, Stil nach Material (Beton, Stein, Holz) | wie die Straße | Deck |
| `tunnel=*` | siehe offene Fragen | | |

Breite aus `width`, sonst `lanes` × 3 m (beide liest `parseStreetTags`), sonst die Tabelle. Einebnen und Belag über `flattenUnderPaths` und
`paintUnderPaths` für alle Kanten auf einmal, Straßen über Wasser ohne `bridge` werden Damm. Brücken brauchen einen
Stil `concrete` (heute `wood`, `stone`, `lava`; das Modell `bridge-concrete` gibt es).

### Boden, Biome, Pflanzen

Höchstens acht Schichten: fest Gras und Asphalt, dazu die sechs nach Fläche größten aus der Tabelle; seltene fallen
auf die nächste ähnliche (Vorrang: Wasser vor Straße vor Gebäude vor Landnutzung, kleinere Fläche vor größerer).

| OSM | Boden | Objekte |
|---|---|---|
| `landuse=forest`, `natural=wood` | `forest-floor` (`leaf_type=needleleaved`: `forest-ground`) | Biom Forest bzw. Pine forest, Dichte im Budget, Waldrand dichter |
| `natural=scrub`, `heath` | `grass-dry` | Sträucher, Büsche |
| `landuse=meadow`, `grass`, `village_green`, `natural=grassland`, `leisure=park` | `meadow`, `grass-lush` | Gras, im Park Einzelbäume aus Knoten, Bänke |
| `landuse=farmland` | `farmland` | Heuballen am Rand |
| `landuse=farmyard` | `dirt` | Scheune, Karren |
| `landuse=vineyard` | `farm-soil` | Rebzeilen (fehlt) |
| `landuse=orchard` | `meadow-earthy` | Obstbäume in Reihen (fehlt, solange junge Eichen) |
| `landuse=allotments` | `grass` | Gartenhäuschen (fehlt), Hecken |
| `landuse=cemetery` | `grass` | `graves`, Hecken |
| `landuse=residential` | `grass` (Gärten) | Gebäude tragen den Ort |
| `landuse=commercial`, `retail` | `paving` | |
| `landuse=industrial` | `concrete` | Container, Fässer |
| `landuse=railway` | `gravel` | |
| `landuse=construction`, `brownfield` | `dirt`, `rubble` | |
| `landuse=quarry`, `natural=bare_rock`, `scree` | `rocky-ground`, `scree` | Felsen |
| `natural=sand`, `beach` | `sand`, `sand-coast` | |
| `natural=wetland` | `swamp-ground` | Schilf, flaches Sumpfgewässer |
| `natural=glacier` | `ice`, `snow` | |
| `amenity=parking` (Fläche) | `asphalt` | wenige Autos |
| `leisure=pitch`, `playground` | `grass-lush` bzw. `wood-chips` | Tore, Spielgerät (fehlt) |

Einzelbäume (`natural=tree`) nach `leaf_type` und `genus` (Nadel, Laub, Birke, Weide), Baumreihen (`tree_row`) mit
`objectsAlong`. Biom der Stimmung (`environment.biome`): `city` bei hohem Gebäudeanteil, sonst `temperate`; Sonne nach
Breitengrad.

### Wasser

| OSM | Karte |
|---|---|
| `natural=coastline` | Hauptwasser `kind: 'sea'` auf dem Meeresspiegel; Land links der Küstenlinie; Kartennull bleibt dann absolute Höhe 0 |
| `natural=water` mit `water=river`, `waterway=riverbank` | größte Fläche wird Hauptwasser (läuft am Rand weiter), Spiegel aus dem Median der Höhen am Ufer; ein Fluss mit viel Gefälle wird in Abschnitte mit eigenem Spiegel geteilt |
| `natural=water` (See, Teich, Becken, Stausee) | eigenes Gewässer (`waterBodies`), Bett unter dem Spiegel ausgehoben; unter 50 m² weglassen, mehr als 64: die kleinsten fallen |
| `waterway=river`, `stream`, `canal`, `drain`, `ditch` | Fluss als Linie (`terrain.rivers`, `carveRiver`), Breite aus `width` oder 2 bis 8 m; `tunnel=culvert` weglassen |
| `leisure=swimming_pool`, `water=fountain` | kleine Gewässer nur, solange Platz unter 64 ist, sonst Boden |

### Ausstattung

| OSM | Katalog |
|---|---|
| `barrier=fence` (`fence_type`) | `fence-wood`, `fence-rail`, `fence-picket`, `fence-chainlink` (`objectsAlong`) |
| `barrier=wall`, `retaining_wall` | `wall-stone`, `wall-dry-stone`, `retaining-wall` |
| `barrier=city_wall` | Burgmauer-Baukasten (`wallAlong`) |
| `barrier=hedge` | `hedge`, `hedge-long` |
| `barrier=guard_rail`, `bollard`, `gate` | `road-barrier`, `bollards`, `gate-farm` |
| `highway=street_lamp` | `street-lamp`; fehlen Laternen, Regel wie der Straßenpinsel an Straßen mit `lit=yes` |
| `railway=rail`, `light_rail`, `tram` | Gleisstücke entlang der Linie (fehlen), Schotter als Bodenfarbe; im Tunnel weglassen |
| `railway=platform` | Platten, Bahnsteigkante (fehlt) |
| `amenity=bench`, `waste_basket`, `highway=bus_stop`, `emergency=fire_hydrant` | `bench`, `trash-can`, `bus-stop`, `hydrant` |
| `man_made=tower`, `mast`, `pier` | `watchtower`, `antenna-mast`, `pier` |
| `power=line`, `tower` (noch nicht in der Probe-Abfrage) | Strommast (fehlt für Hochspannung; `power-pole` für kleine) |

### Gebäude

1. **Art raten:** aus `building`, sonst aus `amenity`, `shop`, `building:levels`, der umgebenden Landnutzung und der
   Größe (unter 30 m² Schuppen oder Garage, über 600 m² Halle, Block oder öffentliches Gebäude).
2. **Form:** kleinstes gedrehtes Rechteck; Füllgrad unter 0,8 oder mehr als ein Modell lang: in Rechtecke teilen
   (Ecken, Flügel), jedes für sich.
3. **Modell:** unter den Modellen der Art das mit der besten Passung von Breite und Tiefe (`box`), gleichmäßig skaliert
   zwischen etwa 0,8 und 1,25; die Front zur nächsten Straße. Passt keins, ein Modell der nächsten Art und ein Eintrag
   im Bericht.
4. **Hang:** auf die tiefste Ecke des Grundrisses, Boden unter dem Grundriss auf diese Höhe eingeebnet (wie die Straßen
   ein Damm), bei viel Gefälle eine Stützmauer an der Talseite.
5. **Höhe:** `building:levels` oder `height` wählen das Modell (Stockwerke), nicht die Skala.

**Fehlende Arten** (Vorschlag für den Katalog, nach Häufigkeit in den Proben): Garage einzeln und als Reihe; Carport
und Vordach (`roof`, Tankstelle); Schuppen und Gartenhaus; Wohnhaus heutiger Art (Satteldach, verputzt) und
Doppelhaus; Reihenhaus-Modul; Blockrand-Module (gerade, Ecke, 4 bis 6 Geschosse) für Innenstädte; Büro- und
Geschäftshaus (4 bis 8 Geschosse, Flachdach); Supermarkt, flache Halle; Industriehalle groß; Schule oder Amt (lang, 2
bis 4 Geschosse); Stadtkirche mit Turm; Gewächshaus; Kiosk; Trafostation; Bahnhof; Parkhaus. Außerdem ohne Gebäude:
Gleis gerade und Bahnsteig, Oberleitungsmast, Prellbock; Rebzeile; Obstbaum; Spielgerät, Fußballtor; Brunnen;
Hochspannungsmast. Der Katalog hat heute Dorf-, Burg-, Wüsten- und einige Stadthäuser (`apartment-block`,
`brick-block`, `office-tower`, `shop`, `warehouse`); eine deutsche Kleinstadt sähe ohne neue Modelle wie ein Dorf mit
Plattenbauten aus.

**Gebaut (O6, 2026-10-15, `build_modern.py`):** Maße der Wände als Breite (X, Front) mal Tiefe, für die
Wahl nach `box` in O4; Dachüberstände, Vordächer, Anbauten und Rampen kommen dazu (gemessene Hüllen in `pack_models.py`,
`report.json`). Stockwerke stehen im Namen.

| OSM-Art (Vorschlag) | Modell | Maße, Geschosse |
|---|---|---|
| `house`, `detached` | `house-modern`, `house-modern-red` | 10 × 8,6 bzw. 9 × 8,2 m, 2 |
| `semidetached_house` | `house-semi` | 14 × 9 m, 2 |
| `terrace` | `house-terrace` (Modul, Seiten blind), `house-terrace-row` | 6 × 10 bzw. 24 × 10 m, 2 |
| `garage`, `garages` | `garage`, `garage-row` | 3 × 6 bzw. 15 × 6 m |
| `shed`, `hut` (Garten) | `garden-shed` | 2,2 × 2,6 m |
| `carport`, `roof` | `carport`, `carport-double`, `station-canopy` | 3,2 × 5,6, 6,4 × 5,6, 22 × 13 m |
| `apartments`, `residential` (Innenstadt) | `block-row-4`, `block-row-6`, `block-corner-4`, `block-corner-6` | 15 × 12, 16 × 13, 14 × 14, 15 × 15 m; 4 bzw. 6 |
| `office`, `commercial` | `office-mid`, `office-high` | 24 × 14 m, 5; 22 × 18 m, 8 |
| `retail`, `supermarket` | `supermarket`, `hall-flat` | 40 × 26, 30 × 20 m |
| `industrial`, `warehouse` (groß) | `industrial-hall` | 60 × 30 m, dazu ein Bürotrakt 10 × 9 m an der Westseite |
| `school`, `university`, `public` | `school` | 46 × 14 m, 3 |
| `townhall`, `civic` | `town-hall` | 30 × 15 m, 3 |
| `church` | `town-church` | Schiff 26 × 13 m mit Turm, gesamt rund 33 × 14 m |
| `train_station` | `station` | 28 × 11 m, 2 |
| `parking` (Parkhaus) | `parking-garage` | 32 × 40 m, 4 Decks, Treppenturm vorn links, Rampe hinten (Hülle 37 × 54 m) |
| `greenhouse`, `kiosk`, `transformer_tower` | `greenhouse`, `kiosk`, `transformer-station` | 6 × 12 (Giebel vorn), 4 × 3, 3,6 × 2,6 m |

Ohne Gebäude: `rail-track`, `rail-platform`, `catenary-mast`, `buffer-stop`, `power-pylon`, `vine-row`, `fruit-tree`,
`playground-swing`, `playground-slide`, `football-goal`, `fountain` (CUSTOM_MAPS.md, Katalog).

## Phasen

Aufwand in Arbeitstagen eines Workers, geschätzt.

| Phase | Inhalt | Aufwand |
|---|---|---|
| **O1 Graue Welt** | Overpass-Client herauslösen, Abfrage, Parsen samt Multipolygonen, Höhenkacheln mit Rückfall, Gelände, Straßengraph über Knoten-Ids mit Brücken, Einebnen und Belag, HQ und Spawns über `StreetRouter`, Rahmengröße, `meta.source`, Speichern und Spielen über `?osm=lat,lon` als Testeinstieg; Prüfung mit Kantenraster; Bericht; Specs auf eingefrorenen Proben (`integration/fixtures/osm`) | 5 |
| **O2 Ablauf** | Menüeintrag, Suche, flache Karte mit Rahmen, HQ und ziehbaren Spawns, Speicher je Rahmen, Worker mit Fortschritt und Abbruch, Editor-Einstieg, „Make a map of this place“ aus dem echten Ort, Namensnennung | 4 |
| **O3 Land und Wasser** | Landnutzung in acht Schichten, Wald und Gebüsch im Objektbudget, Parks, Einzelbäume, Baumreihen; Seen, Flussflächen, Bäche, Küste, Feuchtgebiete | 5 |
| **O4 Gebäude** | Katalog `box` und `osm`-Arten messen, Art raten, Teilen, Wahl, Ausrichten, Hang; Liste fehlender Arten im Bericht | 4 |
| **O5 Ausstattung** | Zäune, Mauern, Hecken, Laternen, Bahn, Brückenstil `concrete`, Kleinkram, Strom | 3 |
| **O6 Neue Modelle** | die Liste oben über die Blender-Skripte in `tools/map-assets/`, mit Fernstufen | 6 bis 10 (rund 25 Modelle) |
| **O7 Messen und Abnahme** | 5 bis 6 Orte (Dorf, Kleinstadt, Innenstadt, Küste, Gebirge, außerhalb Europas): Erzeugungszeit, Ladezeit, fps, Speicher, Dateigröße; Doku, Nachtest | 3 |

Summe 30 bis 34 Tage. O1 und O2 zusammen ergeben die erste spielbare Fassung (grau, mit Straßen, Platzhalter-Häusern
und Bäumen); O3 bis O5 füllen sie; O6 läuft parallel, sobald O4 die Liste liefert.

## Risiken

- **Overpass:** eine Abfrage je Ort, 1,5 bis 3 s in den Proben; dichte Weltstädte liefern mehr (Stuttgart Mitte 15 MB
  JSON). Teilung in Viertel bei `remark`, Speicher je Rahmen. Fällt Overpass aus, gibt es keine neue Welt; bereits
  erzeugte bleiben.
- **Höhendaten außerhalb Europas:** Mapterhorn fällt dort oft auf GLO-30 (30 m) zurück, ein Oberflächenmodell mit
  Gebäuden und Wald als Buckeln. Glätten, unter Straßen und Gebäuden einebnen; Ergebnis an Orten außerhalb Europas
  ansehen (O7).
- **Höhen und OSM passen nicht zusammen:** Flüsse nicht im Talgrund, Straßen am Hang. Einebnen und Flussbett graben
  helfen; Rest in O7 an den Proben.
- **Kartengröße:** bis zur 22-fachen Fläche eines mitgelieferten Levels, 1201² Punkte nie gemessen. Ladezeit, Speicher
  und Bildzeit in O1 an einer grauen Welt messen, bevor O3 sie füllt.
- **Objektbudget:** Miltenberg hat 1,6 km² Wald; ein Baum je 60 m² wären 27 000 Bäume. Dichte in der Ferne der Routen
  senken, Waldränder dichter, oder höheres Budget (offene Frage).
- **Editor-Prüfung:** 32 s bzw. 312 s gemessen; ohne Raster unbrauchbar für OSM-Welten.
- **Zwölf Bodenschichten** (seit E175, vorher acht): fein gegliederte Orte können trotzdem Unterschiede verlieren.
- **Optik:** ohne neue Modelle wirkt jede heutige Stadt wie ein Dorf; Grundrisse mit Höfen nur mit Modulen.
- **Datenlage:** in vielen Gegenden fehlen Gebäude oder Landnutzung in OSM; der Bericht sagt das, die Karte bleibt
  spielbar, solange es Straßen gibt.

## Entschieden (User, 2026-10-15)

1. Rahmen: Vektorkarte mit MapLibre.
2. Kartengröße immer 2,4 km.
3. Spawns wie auf echten Orten (mehrere, vor dem Start verschiebbar), danach im Editor bearbeitbar.
4. Höhendaten: Mapterhorn und AWS an Proben vergleichen, die bessere Quelle nehmen.
5. Objektbudget nach Scene cost, nicht fest 15 000.
6. Gebäude ohne passendes Modell: je nach Fall teilen, strecken oder als Block mit Fassade.
7. Wege der Gegner wie auf echten Orten (Straßen, Fußwege, Pfade, Treppen, dieselbe Liste).
8. Tunnel: an beiden Enden ein Tunneleingang (eigenes Modell, nicht das Spawn-Portal), dazwischen unsichtbar.
9. „Play on a map of this place“ auch für Spieler mit Token.
10. Splat 2048 für OSM-Welten.

## Phase O1, gebaut (2026-10-15)

Code in `src/app/world/osm/` (ohne Angular und DOM): `overpass-client.ts` (aus `osm-street.service.ts` herausgelöst,
die Straßen der echten Orte nutzen ihn mit ihren alten Grenzen), `osm-query.ts`, `osm-parse.ts`, `osm-tags.ts`,
`dem-tiles.ts`, `convert/terrain.ts`, `convert/roads.ts`, `convert/layout.ts`, `import-osm.ts` (Ablauf und Bericht),
`osm.worker.ts` mit `osm-import-client.ts`, `osm-link.ts` (Testeinstieg). Specs auf einer eingefrorenen Probe
(`integration/fixtures/osm/world-miltenberg.*`, 1,2 km Quadrat, 400 kB gepackt); `tools/osm/osm-world.spec.ts` erzeugt
Welten aus heruntergeladenen Rohdaten für Messungen (`--mode osm`).

**Testeinstieg:** `?osm=<lat>,<lon>` (nur wo Links eigene Karten öffnen dürfen, also im Dev-Build bis zur Freigabe):
die Seite erzeugt die Karte im Worker, zeigt eine Statuszeile, speichert sie als eigene Karte (freie Id
`osm-<lat>-<lon>`) und lädt neu auf `?world=map:<id>`. Der Bericht steht in der Konsole (`[OSM world]`).

### Beim Bau entschieden

- **Höhendaten:** Mapterhorn, Zoom 14, AWS-Kacheln (Zoom 13) als Rückfall, flacher Boden, wenn keine Quelle
  liefert (Bericht: `heights: no elevation tiles came`). Vergleich an drei Orten, je 2,6 km Quadrat:

  | | Mapterhorn z15 | Mapterhorn z14 | AWS z15 |
  |---|---|---|---|
  | Kacheln, Bytes (Oberbergen, Miltenberg, Stuttgart) | 20/16/20, 1,5 bis 2,3 MB | 6/9/6, 0,7 bis 0,9 MB | 20/16/20, 1,2 bis 1,8 MB |
  | Pixel auf einer Geraden mit beiden Nachbarn (hochgerechnet) | 14 bis 19 % | 13 bis 18 % | 32 bis 75 % (`eudem`) |

  Als Schummerung auf dem 2-m-Raster sehen z14 und z15 gleich aus (Altstadt, Mainufer, Bahndamm, Straßenkanten
  erkennbar); AWS zeigt nur weiche Hänge. Mapterhorn liefert WebP, dekodiert über `createImageBitmap` ohne
  Farbumrechnung auf einem `OffscreenCanvas` (auch im Worker).
- **Gelände:** bilinear auf das 2-m-Raster (1201², Seite immer 2400 m), zwei Durchgänge 3×3-Mittel gegen Stufen an
  Mauern und Bordsteinen, Kartennull auf der tiefsten Stelle (abgerundet); `meta.source.zeroM` hält deren Höhe über
  dem Meer (für die Küste in O3).
- **Abfrage:** globale `[bbox]` (Karte plus 100 m), `out body geom(<bbox>)`, `maxsize` 256 MB, `timeout` 90 s, eigene
  Zeitgrenzen (105 s bis zu den Kopfzeilen, 60 s Körper, Parallelfrage nach 8 s). Die Antwort hält die Geometrie
  eines Wegs passend zu seiner Knotenliste, Knoten außerhalb der Box als `null` (je Seite bleibt einer außerhalb
  stehen). Bei einer `remark` über Speicher oder Zeit vier Viertel nacheinander, zusammengeführt je Element.
- **Flächen:** geschlossene Wege mit Flächen-Tags und Multipolygone (Ringe über gleiche Endpunkte, ein offener Ring
  wird geradlinig geschlossen und gezählt), auf das Kartenquadrat geschnitten. In O1 nur gezählt; O3 malt sie.
- **Straßengraph:** dieselben `highway`-Typen wie die Straßenabfrage der echten Orte. Knoten, die zwei Wege teilen
  (oder ein Weg zweimal), werden Kartenknoten (`n<OSM-Id>`), am Kartenrand und an Abbruchstellen der Antwort
  entstehen eigene Knoten (`b<n>`); ein geschlossener Weg wird in der Mitte geteilt. Zwischenpunkte mit 0,2 m
  Douglas-Peucker. Breite aus `width`, sonst `lanes` × 3 m, sonst `ROAD_TYPES` in `osm-tags.ts`, auf 1,5 bis 24 m.
  Jede Kante trägt ihren `highway`-Typ (`street`): Routen und Spawns wählen wie auf echten Orten.
- **Brücken und Tunnel:** `bridge=*` wird Brückenkante (Stein, Holz bei `bridge:material` oder `material=wood`;
  Beton kommt mit O5). Tunnel bleiben draußen, bis sie ihre Portale haben (Entscheidung 8); `tunnel=building_passage`
  bleibt Straße. Der Bericht nennt Zahl und Länge.
- **Einebnen und Belag:** `flattenUnderPaths` mit 3 m Schulter und 20 m Glättung, erst Pfade, dann Straßen von
  schmal nach breit (die breitere gewinnt an Kreuzungen); Brücken nicht. Der Belag wird in die Bodenfarbe gemalt
  (Asphalt, Pflaster `pavers`, Kopfstein, Gehweg, Kies, Erdweg nach `highway` und `surface`, 0,75 m weicher Rand),
  die Kante bekommt `surface`, und die Wegmaske lässt solche Kanten aus (sonst lägen Kopfsteine mit Spurrillen
  darüber). Sieben Bodenschichten mit Gras; die dritte Splat-Karte bleibt für O3 frei. Splat 2048².
- **HQ und Spawns:** HQ auf dem nächsten Punkt einer Straße bis 250 m um den Ort, sonst eines Pfads. Vier Spawns
  über `StreetRouter.findRandomStreetPoint` auf dem Netz der Karte (500 bis 1000 m, Route geprüft, Portal gerade
  gerückt), mindestens 250 m und 40° auseinander; der erste immer offen, die anderen `optional`. Name nach der
  Straße, sonst nach der Himmelsrichtung.
- **Prüfung:** `EdgeIndex` in `editor/ops/path-graph.ts` (Kanten-Segmente in 32-m-Zellen, Linien vorgehalten);
  `validateMap`, `routeBetween`, `components` und `spawnRoutes` nutzen es, Dijkstra läuft auf einem Heap.

### Messungen O1 (2026-10-15)

Drei Orte, je 2,4 km: Oberbergen (Dorf im Kaiserstuhl, Weinberge), Miltenberg (Kleinstadt am Main), Stuttgart
Mitte. Overpass-Antworten von overpass.openstreetmap.fr (die beiden Server des Spiels antworteten am Nachmittag mit
502 bzw. 500), Höhen von Mapterhorn. Erzeugen in Node (ein Kern, Rechner voll mit anderen Läufen, also nur
Richtwerte); Laden und Bildrate im Dev-Server, headless Chromium mit D3D11 auf RTX 5080, Spielansicht nach dem Laden,
`?menu=skip`.

| | Oberbergen | Miltenberg | Stuttgart Mitte |
|---|---|---|---|
| Overpass: Zeit, JSON | 2,6 s, 6,0 MB | 2,2 s, 4,8 MB | 6,1 s, 18,1 MB |
| Elemente (Wege, Punkte) | 5 082 (4 336, 139) | 7 386 (6 385, 934) | 26 101 (19 581, 5 779) |
| Höhen (Mapterhorn z14): Kacheln, Bytes | 6, 0,73 MB | 9, 0,87 MB | 6, 0,69 MB |
| Höhenbereich | 215 bis 468 m | 124 bis 405 m | 233 bis 402 m |
| Kanten, Knoten, Brücken | 2 957, 2 827, 3 | 2 546, 2 029, 21 | 9 745, 7 508, 64 |
| Straße / Pfad km | 27 / 105 | 71 / 42 | 147 / 83 |
| Tunnel weggelassen | 1 (27 m) | 7 (434 m) | 463 (12,2 km) |
| Teile des Netzes (Prüfung) | 34 | 9 | 82 |
| Spawns | 3 von 4 | 4 | 4 |
| Erzeugen (Node) | 0,7 s | 0,7 s | 2,1 s |
| davon Einebnen, Belag | 0,40 s, 0,14 s | 0,35 s, 0,23 s | 1,19 s, 0,37 s |
| Packen, Datei | 1,0 s, 5,95 MB | 1,0 s, 5,59 MB | 1,2 s, 6,22 MB |
| Editor-Prüfung | 32 ms | 33 ms | 120 ms (vor dem Kantenraster 6,7 s) |
| `?osm=` bis zur gespeicherten Karte im Browser (Overpass aus dem Speicher, Höhen live) | 3,9 s | 5,2 s | 2,6 s |
| Laden bis `load:ready` (Dev-Server) | 13,9 s | 8,2 s | 8,3 s |
| Bilder je Sekunde (headless, Richtwert) | 1 219 | 1 468 | 712 |
| JS-Heap Hauptthread (CDP) | 84 MB | 103 MB | 97 MB |

Zum Vergleich im selben Lauf das Demo-Tal (mitgeliefert, mit Wald und Objekten): Laden 16,6 s, 35 Bilder je
Sekunde, 78 MB. Mit dem echten Overpass-Abruf (2 bis 6 s) bleibt eine graue Welt unter 10 s bis zur gespeicherten
Datei.

### Offen nach O1

- **Wege unter Brücken (nachgeprüft und behoben):** Die Zellen einer Route unter einem Deck laufen schon wie auf
  echten Orten (`UnderpassIndex` schneidet sie, sie nehmen den Boden zwischen den Portalen), Türme darunter stehen
  auf dem Boden mit dem Deck als Säulenoberkante. Falsch war nur die Gehhöhe abseits eines Brückenwegs
  (`CustomMapSurface.walkHeightAtMap`, `getGroundHeightEstimate`): sie gab das Deck; jetzt den Boden, das Deck nur
  am Brückenende bis 0,5 m über dem Boden. Die Vorschau des Editors (Probelauf) zeigt Läufer unter einer Brücke
  weiter auf dem Deck.
- **Tunnel:** Stuttgart verliert 12 km Wege (Fußgängerpassagen, Stadtbahn-Zugänge, B14), das Netz zerfällt in 82
  Teile; die Spawns liegen trotzdem auf dem Teil des HQ (sie brauchen eine Route).
- **Spuren zu Beginn:** alle Spawns sind beim Start offen (die Spurwahl öffnet optionale bis `max`); der Spieler
  schließt sie vor Welle 1. Ob eine OSM-Welt mit einer offenen Spur starten soll, ist offen.
- **Steile Pfade:** die Prüfung meldet Treppen und Weinbergpfade über 30° (Oberbergen 52, Stuttgart 59) als Warnung.
- **Namensnennung:** `meta.source.attribution` trägt die Zeilen (OSM, Höhenquelle); angezeigt werden sie mit O2.

## Phase O3, gebaut (2026-10-15)

Code in `src/app/world/osm/`: `land-tags.ts` (die Tabellen „Boden, Biome, Pflanzen“ und „Wasser“ als Daten),
`convert/raster.ts` (Flächen auf ein Raster, Distanzfeld, Linien mit Breite), `convert/water.ts`, `convert/ground.ts`,
`convert/vegetation.ts`. Ablauf in `convertOsm`: Gelände, Straßengraph, Wasser graben, Straßen einebnen, Wasser
nachziehen (`settleWater`), Landnutzung malen, Betten und Ufer malen, Beläge malen, HQ und Spawns, Pflanzen. Der
Bericht hat dafür `ground`, `water` und `plants`.

### Beim Bau entschieden

- **Boden:** jede Fläche mit einer Landklasse (`landClassOf`: `landuse`, `natural`, `leisure`, Parkplatz) füllt die
  Splat-Texel in ihr, die kleinere Fläche über der größeren. `landuse=residential` malt nichts (Gärten bleiben das
  Grundgras), benannte Gebiete wie `natural=mountain_range` und Naturschutzgebiete auch nicht. Die Schichten: Grundgras,
  die Beläge der Straßen und die Materialien des Wassers sind gesetzt, die Landnutzung bekommt den Rest bis 12, nach
  bedeckter Fläche; eine Klasse ohne eigene Schicht nimmt das nächste Material ihrer Liste, das eine hat (auch einen
  Straßenbelag, etwa Kies für Bahngelände), sonst das Grundgras. Ränder mischen über einen Texel (3 × 3). An allen
  drei Orten sind die 12 Schichten voll; der Bericht nennt, wer auf was fiel (`ground.fellBack`).
- **Stimmung:** Biom `city`, wenn Gebäude 15 % der Karte bedecken (Stuttgart Mitte 30 %, Miltenberg 11 %), sonst
  `temperate`; die Sonne so hoch wie mittags zur Tagundnachtgleiche (25 bis 65°), von Süden (südlich des Äquators von
  Norden).
- **Wasser vor dem Einebnen:** Flussflächen (`water=river`, `canal` …, `waterway=riverbank`) in eine Maske; jeder
  zusammenhängende Teil wird entlang seiner Hauptachse in 60-m-Stücken gelesen und dort geteilt, wo sein Spiegel
  0,75 m vom Anfang des Abschnitts abweicht. Der Spiegel eines Körpers ist das 30-%-Quantil der Höhen in ihm, ohne die
  Randproben (das Vermessungsmodell hält die Wasserfläche flach, die Glättung zieht den Rand hoch). Hauptwasser ist das
  Meer, sonst der größte Flussabschnitt; Seen, Teiche, Becken, Pools und Feuchtgebiete sind eigene Körper, unter 50 m²
  weggelassen, über 64 die kleinsten. Das Bett liegt unter dem Spiegel (Schelf am Ufer, tiefer nach innen, Pools mit
  steilen Wänden), der Rand 2 m breit 0,2 m über dem Spiegel, dann 3 m bis ins Land.
- **Feuchtgebiete:** Sumpfboden aus der Bodenstufe; ab 400 m² ein Sumpfkörper mit Tümpeln, wo ein weiches Rauschen
  (14 m) niedrig ist, mindestens 3 m vom Rand und höchstens 0,6 m über dem Spiegel.
- **Bäche und Flüsse als Linien:** `waterway=river`, `canal`, `stream`, `drain`, `ditch` ohne Tunnel (Durchlässe) und
  ohne `intermittent=yes`; Breite aus `width`, sonst 12, 8, 2,5, 1,6, 1,2 m. Sie laufen auf dem echten Verlauf (kein
  Mäander wie der Flusspinsel), nur außerhalb der Wasserflächen (ein Schritt hinein, damit sie sich treffen), und enden
  an einer Straße ohne Brücke (ein Durchlass, den die Daten nicht nennen). Der Spiegel kommt aus `bankLevels` des
  Flusspinsels und fällt in Richtung des Wegs (gegen die Höhen gezeichnete Wege werden gedreht). Der Graben ist
  mindestens eine Probe breit je Seite, sonst verfehlt das 2-m-Raster einen schmalen Graben.
- **Küste:** `natural=coastline` zu Ketten verbunden, am Kartenrand geschnitten; jedes Stück, das die Karte quert, wird
  im Uhrzeigersinn am Rand bis zum nächsten Stück geschlossen (OSM zeichnet das Land links), Inseln schneiden Löcher. Das
  Meer ist Hauptwasser auf 0 m über dem Meer, der Kartennull wandert dorthin (`meta.source.zeroM` 0). Liegt das so
  bestimmte Meer überwiegend über 3 m, ist die Küste in der Antwort kaputt: kein Meer, eine Warnung. Ein Strand
  (`sand-coast`) bis 16 m ins Land, wo es flach bleibt. Ohne Küste in den Proben nur in einer Spec geprüft.
- **Nach dem Einebnen** (`settleWater`): eine Straße durch einen Körper (ohne Brücke) wird Damm, ihre Proben verlassen
  die Maske und liegen über dem Spiegel; ein Ufer, das die Schulter einer Straße aus dem Wasser hob, ist Land; jede
  Probe neben einem Körper liegt wieder über seinem Spiegel; die Gräben der Bäche werden neben den Straßen neu
  geschnitten. Die Editor-Prüfung meldet an den drei Orten weder `water-floating` noch `path-under-water`.
- **Betten und Ufer:** `riverbed` unter dem Wasser und an den Ufern, `sand-coast` am Meer, nach der Landnutzung und vor
  den Belägen gemalt.
- **Pflanzen:** je Landklasse Arten mit Dichte je Hektar (Wald: Laubbäume 100, am Rand 200 auf 18 m, ein paar
  Nadelbäume, Büsche am Rand, Farn, Stümpfe; Nadelwald 120 und 220; Gebüsch, Heide, Wiese mit Blumen, Park, Friedhof,
  Kleingärten, Feuchtgebiet mit Schilf). Kandidaten aus einem verwackelten Gitter je Art, je Zelle ein Ort und ein Wurf
  aus einem Hash (gleiche Daten, gleicher Wald). Fern der Routen dünner: bis 150 m voll, ab 700 m die Hälfte. Reben in
  Reihen hangabwärts (2,4 m Abstand, Stücke von 10 m), Obstbäume in Reihen entlang der längsten Seite (8 × 7 m), Schilf
  in 3 m um Seen, Teiche und Bäche, Einzelbäume nach `leaf_type` und `genus` (in der Stadt `tree-street`), Baumreihen
  alle 9 m. Nichts wächst auf Straßen (Bäume 2 m, Büsche 1 m Abstand), im Wasser, in Gebäudegrundrissen, 25 m um das HQ
  und 12 m um Spawns.
- **Objektbudget nach Scene cost** (Entscheidung 5): die Pflanzen dürfen die Hälfte von `SCENE_BUDGET` kosten (6 M
  Punkte; der Rest bleibt für Gebäude und Ausstattung), Reihen davon höchstens 40 % (ein Rebstück kostet so viel wie
  drei Bäume, ein Weindorf gäbe sonst alles für Reben aus), höchstens 60 000 Objekte. Reicht es nicht, gehen
  Einzelbäume und Baumreihen vor, dann die Reihen nach Nähe zur Route und die übrigen nach Wurf geteilt durch die
  Routennähe. Die Kosten je Objekt rechnet `plantCosts` aus dem Katalog (`objectCost` auf 2,4 km); der Client liest den
  Katalog und gibt sie als Option `plantCosts` in den Worker. Ohne sie zählt eine Pflanze wie ein unbekanntes Objekt
  (lichter).

### Messungen O3 (2026-10-15)

Dieselben drei Orte und Rohdaten wie O1. Erzeugen in Node direkt hintereinander vorher und nachher (Rechner unter
Last anderer Läufe, Richtwerte); Objekte und Scene cost mit dem Katalog. Die Spawns werden gewürfelt, die Pflanzen
folgen den Routen: Objektzahlen schwanken zwischen Läufen um wenige Prozent.

| | Oberbergen | Miltenberg | Stuttgart Mitte |
|---|---|---|---|
| Erzeugen vorher, nachher | 0,7 s, 1,5 s | 0,5 s, 1,1 s | 1,3 s, 1,9 s |
| Datei vorher, nachher | 5,95, 7,36 MB | 5,59, 6,44 MB | 6,22, 7,16 MB |
| Bodenschichten (mit Grundgras) | 12 | 12 | 12 |
| Gewässer | 2 Seen, 2 Pools, 2 Feuchtgebiete, 20 Bachstücke (2,6 km) | Main als Hauptwasser, 3 Seen, 5 Pools, 11 Bachstücke (3,4 km) | 9 Seen und Teiche, 12 Pools und Brunnen |
| Pflanzen, davon Einzelbäume und Baumreihen | 28 167, 45 | 16 129, 160 | 5 373, 2 416 |
| größte Gruppen | Reben 9 360, Wald 7 337, Gebüsch 4 873, Heide 2 522, Obst 2 170 | Wald 10 461, Reben 1 854, Gebüsch 1 399 | Park 896, Reben 866, Wald 761 |
| Scene cost der Pflanzen (Budget 6 M) | 2,93 M | 1,12 M | 0,47 M |

Zum Vergleich die mitgelieferten Level (512 m): 0,7 bis 7,6 M Punkte, 460 bis 13 400 Objekte. Nur in Oberbergen
reichte das Budget nicht für alles: die Reben stießen an ihre 40 %, fern der Routen fehlen sie (dort Rebboden ohne
Stöcke). Laden im Dev-Server bis `load:ready`: 8 bis 13 s vorher wie nachher (Richtwert, Rechner unter Last).

### Offen nach O3

- **Bodenschichten:** die Beläge der Straßen nehmen sechs Schichten (Asphalt, Pflaster, Kopfstein, Gehweg, Kies,
  Erdweg), Wasser eine, so bleiben der Landnutzung fünf; Wald fiel im 1,2-km-Ausschnitt von Miltenberg auf Gras, weil
  Gewerbe und Wiese mehr Fläche hatten. Möglich: Gehweg und Pflaster zusammenlegen, oder Wald fest vorziehen.
- **Stadtzentren:** `landuse=retail` und `commercial` (Stuttgart: eine Fläche von 0,78 km²) malen Platten unter alles;
  bis die Gebäude aus O4 stehen, ist die Innenstadt eine graue Fläche mit Straßenbäumen.
- **Flussabschnitte:** die Teilung geht entlang einer geraden Hauptachse; ein stark gewundener Fluss mit Gefälle wird
  ungenau geteilt (in den Proben fällt der Main über die Karte kaum, ein Abschnitt).
- **Küste:** nur synthetisch geprüft; ein Küstenort gehört in die Abnahme (O7).
- **Bäche neben Wegen:** wo ein Weg dicht neben dem Bach läuft, schneidet der neu geschnittene Graben in dessen
  Schulter.

## Offene Fragen an den User (beantwortet, siehe oben)

1. Flache Karte für den Rahmen: OSM-Rasterkacheln in einem kleinen eigenen Betrachter, oder Vektorkarte mit MapLibre
   (schöner, rund 1 MB mehr Code), oder gar keine Karte, nur Adresse und Spawns im Text?
2. Kartengröße: nach den Spawns bemessen (1,2 bis 2,4 km, Vorschlag) oder immer 2,4 km?
3. Spawns: einer wie auf echten Orten, oder gleich mehrere? Und sollen sie im Spiel verschiebbar sein, oder reicht
   Ziehen im Rahmen vor dem Erzeugen und im Editor danach?
4. Höhendaten: Mapterhorn als erste Quelle (1 m in Deutschland, sonst meist 30 m) mit den AWS-Kacheln als Rückfall?
5. Objektbudget für OSM-Welten: 15 000 wie die Level (Wälder licht), oder mehr?
6. Gebäude, für die kein Modell passt: in mehrere Modelle teilen, gestreckte Modelle erlauben (eine neue Skala je
   Achse im Dateiformat), oder einfache Blöcke mit Fassadenmaterial erzeugen?
7. Sollen Gegner auch Fußwege, Pfade und Treppen nehmen dürfen (wie auf echten Orten), oder nur Straßen?
8. Tunnel: weglassen (Routen laufen außen herum) oder als Straße über den Berg legen?
9. Auch Spieler mit Token bekommen den Eintrag „Play on a map of this place“?
10. Feinere Bodenfarbe für OSM-Welten (Splat 2048 statt 1024, schärfere Ränder, mehr Grafikspeicher)?
