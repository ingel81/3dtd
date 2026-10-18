# OSM-Welt, Runde 2: Flächen, POIs, Daten für Level (Plan)

**Status:** Plan, 2026-10-18 (TODO E237, E239, E240; Schnittstellen zu E235 und E238)
**Bezug:** [OSM_WORLD_PLAN.md](OSM_WORLD_PLAN.md) (Runde 1, Phasen O1 bis O7), [CUSTOM_MAPS.md](CUSTOM_MAPS.md) (Renderer,
Katalog), [CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md) (Spiel), [LEVEL_EDITOR.md](LEVEL_EDITOR.md) (Editor)

Runde 1 hat aus OSM eine spielbare Welt gemacht: Gelände, Straßen, Wasser, Landnutzung als Bodenfarbe, Gebäude aus dem
Katalog, Ausstattung. Runde 2 macht sie erkennbar: Sportplätze mit Linien und Toren, Spielplätze mit Fallschutz und
Geräten, gepflasterte Plätze, Parkplätze mit Autos, Läden und Gasthäuser mit Schild und Markise, Boote auf dem Fluss,
die Glocke der Kirche zur Welle. Dazu eine Erhebung an sieben Orten, wie verbreitet die Daten dafür sind.

## Ergebnis in Kürze

1. **Flächen brauchen einen eigenen Weg.** Die 12 Bodenschichten waren an allen drei Orten der Runde 1 voll (O3);
   Sportplatz, Spielplatz und Parkplatz fallen dort auf ein Ersatzmaterial, Linien gibt es gar nicht. Neu: eine
   **Flächenoberfläche** wie die Straßenoberfläche (`render/paths/road-surface.ts`): Polygone mit eigenem Material über
   dem Boden, Linien und Markierungen im Shader je Art, ein Material, ein Draw Call je Kachel. Ein neues, allgemeines
   Element des Kartenformats (`surfaces`), auch im Editor setzbar.
2. **POIs sind Knoten.** Läden stehen zu 80 bis 100 % als Punkt in OSM (Städte 95 bis 100 %), POIs zu 89 bis 100 %
   innerhalb eines Gebäudegrundrisses (Städte 98 bis 100 %). Die Abfrage holt sie heute nicht. Die erweiterte Abfrage kostet an der
   dichtesten Probe (Paris Marais) 1,9 s und 1,2 MB gzip mehr.
3. **Schilder mit Text** als allgemeines Objektmerkmal (`MapObject.sign`), gezeichnet aus einem Schrift-Atlas, ein Draw
   Call für alle.
4. **Level aus Daten** ohne neue Spielregeln: Spawns an Bahnhof, Haltestelle, Parkplatz, Hafen (und nach ihnen
   benannt), Leben aus Daten (Boote, Möwen, Glocke der nächsten Kirche, Schiffshorn), Wahrzeichen im Intro-Flug.
   Hydranten als Spielmechanik erst später (offene Frage 1).
5. **Nebenbefunde:** gepflasterte Plätze (`highway=pedestrian` mit `area=yes`, `area:highway`) sind heute Gras mit
   einer Straße um den Rand; `landuse=retail`/`commercial` malt Pflaster unter ganze Viertel; Stolpersteine sind in
   Würzburg 490 der 726 `historic`-Punkte und gehören nicht in die Welt.

## Erhebung (2026-10-18)

Eigene Overpass-Instanz, je Ort ein Quadrat von 2632 m (Karte 2432 m plus 100 m Rand), drei Abfragen: Zensus aller
getaggten Elemente (`out tags`), die heutige Abfrage der Welt (`osmWorldQuery`) und der Vorschlag dieses Plans
(Abschnitt [Abfrage](#abfrage)). Flächenanteile und POI-Zuordnung mit dem Parser der Welt (`parseOsm`, auf das Quadrat
der Karte geschnitten), Erzeugen mit `convertOsm` in Node ohne Höhen und ohne Katalog (Richtwerte, ein Kern).

### Orte und Abfrage

| Ort | Art | Elemente | Gebäude, Anteil der Fläche | Heute: MB, gzip, s | Vorschlag: MB, gzip, s | Erzeugen heute |
|---|---|---|---|---|---|---|
| Würzburg Altstadt | Altstadt, Fluss, Weinberg | 34 623 | 5 445, 22,5 % | 14,9, 2,18, 1,7 | 16,2, 2,43, 2,4 | 2,0 s |
| Frankfurt Innenstadt/Sachsenhausen | Großstadt, Fluss | 35 827 | 7 880, 29,6 % | 16,8, 2,47, 1,9 | 18,9, 2,82, 2,5 | 1,9 s |
| Frankfurt Osthafen | Gewerbe, Hafen, Kleingärten | 11 313 | 4 299, 15,7 % | 6,8, 1,01, 1,4 | 7,1, 1,06, 2,0 | 1,2 s |
| Mönchberg | Dorf im Spessart | 3 068 | 1 491, 2,9 % | 1,7, 0,23, 1,0 | 1,7, 0,24, 1,1 | 0,9 s |
| Paris Marais | Weltstadt, dicht | 97 751 | 11 067, 49,7 % | 34,6, 4,75, 3,3 | 41,5, 5,98, 5,2 | 4,5 s |
| Amsterdam Centrum | Grachten, Hausboote | 111 346 | 17 788, überlappend | 29,3, 3,96, 3,8 | 32,0, 4,40, 5,4 | 3,3 s |
| Kleinstadt am Main | Kleinstadt am Fluss | 6 410 | 3 808, 8,1 % | 3,5, 0,49, 1,2 | 3,6, 0,50, 1,3 | 1,1 s |

Die Instanz liefert gzip; „MB“ ist der entpackte JSON-Text, den Parser und Rahmenspeicher sehen. Parsen kostet 2 bis
94 ms, die erweiterte Abfrage ändert daran und am Erzeugen nichts Messbares (bis 0,4 s in Paris, im Rauschen). Zum
Vergleich ein Quadrat von 4,8 km um den Marais: 118,6 MB, 9,7 s; über 5 km Kante lehnt die Instanz ab.

### Gebäude (Anteil der Grundrisse in %, außer Zählungen)

| | Würzburg | Frankfurt | Osthafen | Mönchberg | Marais | Amsterdam | Kleinstadt am Main |
|---|---|---|---|---|---|---|---|
| nur `building=yes` | 29 | 50 | 51 | 57 | 29 | 27 | 83 |
| `building:levels` | 41 | 30 | 10 | 1 | 69 | 11 | 1 |
| `height` | 3 | 1 | 0 | 0 | 1 | 83 | 0 |
| `roof:shape` | 37 | 11 | 4 | 1 | 4 | 7 | 0 |
| Dach- oder Wandfarbe, Material | 1 bis 6 | 1 bis 3 | 0 | 0 | 0 bis 3 | 0 bis 1 | 0 |
| Name | 7 | 6 | 3 | 1 | 5 | 1 | 1 |
| Adresse | 55 | 73 | 53 | 29 | 2 | 5 | 40 |
| `building:part` (Anzahl) | 1 349 | 564 | 40 | 0 | 1 488 | 564 | 1 |
| Multipolygon-Gebäude (Anzahl) | 35 | 41 | 9 | 0 | 2 131 | 208 | 6 |
| `heritage` (Anzahl) | 49 | 57 | 5 | 0 | 185 | 90 | 9 |

Häufigste Dachformen: Würzburg Sattel 762, Walm 648, flach 300, Mansard 89; Frankfurt Sattel 268, flach 228, Mansard
102; Marais Mansard (als `gambrel`) 156, flach 100; Amsterdam Giebelhaus (`double_saltbox`) 627, Sattel 269.

Für E235: der Marais hat 2 131 Gebäude als Multipolygon (Katasterimport mit Innenhöfen), Amsterdam bei 83 % eine
gemessene Höhe (Import der amtlichen 3D-Daten), Würzburg bei 41 % Geschosse und bei 37 % eine Dachform. Dörfer haben
nichts davon: dort bleibt es beim Schätzen aus Grundriss und Lage (Runde 1).

### Straßen (Anteil der Fahrstraßen in %, außer Zählungen)

| | Würzburg | Frankfurt | Osthafen | Mönchberg | Marais | Amsterdam | Kleinstadt am Main |
|---|---|---|---|---|---|---|---|
| Fahrstraßen, Wege | 3 325, 3 898 | 2 823, 4 495 | 1 244, 817 | 203, 332 | 2 508, 12 343 | 2 841, 2 890 | 482, 282 |
| `surface` | 82 | 93 | 73 | 93 | 89 | 87 | 66 |
| `maxspeed` | 43 | 65 | 40 | 56 | 65 | 73 | 26 |
| `lanes` | 22 | 43 | 28 | 6 | 23 | 26 | 14 |
| `width` | 20 | 3 | 7 | 63 | 5 | 8 | 1 |
| `sidewalk*` | 43 | 68 | 34 | 20 | 61 | 41 | 15 |
| `lit` | 66 | 79 | 49 | 41 | 87 | 71 | 12 |
| `cycleway*` | 38 | 62 | 34 | 12 | 55 | 18 | 16 |
| `parking:*` | 29 | 60 | 18 | 0 | 6 | 9 | 1 |
| Brücken, Tunnel (Wege) | 76, 388 | 39, 716 | 36, 69 | 5, 0 | 108, 617 | 500, 269 | 8, 4 |
| Plätze (`highway=pedestrian` als Fläche, `area:highway`) | 66, 51 | 85, 35 | 6, 8 | 0, 0 | 269, 316 | 180, 19 | 0, 0 |
| Übergänge, Ampeln (Knoten) | 240, 148 | 934, 428 | 197, 109 | 1, 0 | 3 040, 453 | 648, 329 | 10, 2 |

Die vielen Tunnel der Städte sind Unterführungen, Treppen und Rampen in Gebäuden. Markierte Übergänge
(`crossing=marked`, `zebra`, `traffic_signals`, `uncontrolled`): 225, 853, 183, 1, 2 888, 553, 10.

### POIs

| | Würzburg | Frankfurt | Osthafen | Mönchberg | Marais | Amsterdam | Kleinstadt am Main |
|---|---|---|---|---|---|---|---|
| Gastronomie | 344 | 914 | 73 | 8 | 3 551 | 1 743 | 32 |
| Läden (davon als Punkt) | 688 (95 %) | 1 214 (95 %) | 135 (94 %) | 13 (100 %) | 6 169 (98 %) | 2 205 (100 %) | 64 (80 %) |
| Tourismus | 555 | 456 | 74 | 26 | 1 595 | 697 | 44 |
| `historic` (davon Stolpersteine) | 726 (490) | 315 (191) | 31 (7) | 19 (0) | 464 (8) | 86 (9) | 36 (0) |
| Handwerk, Büros, Gesundheit | 40, 183, 142 | 29, 221, 155 | 5, 66, 10 | 12, 3, 6 | 270, 798, 342 | 32, 233, 82 | 11, 17, 11 |
| Kirchen, Rathaus, Markt, Tankstelle | 50, 2, 2, 8 | 30, 1, 9, 3 | 8, 0, 1, 4 | 3, 2, 0, 1 | 47, 2, 11, 3 | 32, 1, 9, 1 | 5, 2, 0, 1 |
| POI im Gebäudegrundriss | 98 % | 98 % | 97 % | 89 % | 99 % | 100 % | 99 % |
| Gebäude mit mehreren POIs | 232 | 463 | 39 | 1 | 2 515 | 441 | 10 |
| Gastronomie mit `outdoor_seating` | 72 % | 56 % | 38 % | 50 % | 55 % | 27 % | 50 % |

Läden und Handwerk tragen fast immer einen Namen (80 bis 100 %), Gastronomie zu 45 bis 88 % eine Küche, Marken
(`brand`) 0 bis 30 %. Die Häufigsten: Kleidung, Friseur, Bäcker, Schmuck, Supermarkt, Optiker, Kiosk; Gaststätten
vor Cafés, Imbissen und Bars. Zuordnung Punkt zu Grundriss über ein 50-m-Raster: 0 bis 16 ms je Ort.

### Flächen (Anteil am Quadrat der Karte, Anzahl und Median der Größe)

| | Würzburg | Frankfurt | Osthafen | Mönchberg | Marais | Amsterdam | Kleinstadt am Main |
|---|---|---|---|---|---|---|---|
| größte Nutzungen | Wohnen 47 %, Park 16 %, Wasser 5 %, Parkplatz 4 % | Wohnen 78 %, Park 7 %, Wasser 7 %, Plätze 3 % | Industrie 25 %, Wohnen 21 %, Wasser 11 %, Acker 10 %, Gewerbe 8 %, Kleingärten 6 % | Wald 31 %, Acker 31 %, Wiese 18 %, Obst 3 % | Wohnen 96 %, Gehflächen 6 %, Wasser 5 %, Plätze 5 % | Wohnen 58 %, Wasser 22 %, Handel 4 % | Acker 15 %, Wald 10 %, Wasser 7 % |
| Sportplätze | 43, 469 m² | 7, 310 m² | 11, 517 m² | 12, 738 m² | 24, 203 m² | 15, 171 m² | 18, 801 m² |
| Spielplätze | 24, 741 m² | 19, 610 m² | 7, 405 m² | 1, 325 m² | 22, 148 m² | 35, 215 m² | 9, 877 m² |
| Parkplätze | 333, 225 m² | 84, 298 m² | 99, 496 m² | 17, 514 m² | 50, 63 m² | 78, 64 m² | 53, 375 m² |
| Parks und Gärten | 233, 214 m² | 74, 1 430 m² | 28, 365 m² | 4, 3 129 m² | 186, 171 m² | 169, 212 m² | 5, 1 356 m² |
| Friedhof, Kleingärten | 1, 6 | 1, 1 | 2, 60 | 1, 8 | 0, 2 | 1, 0 | 3, 8 |
| Schwimmbecken | 6 | 0 | 1 | 3 | 0 | 0 | 4 |

Sportarten (`sport` an 91 bis 100 % der Plätze): in Städten zuerst Tischtennis (13, 32, 17), dann Fußball, Basketball,
Mehrzweck (Bolzplatz), Boules, Skate; in Dorf und Kleinstadt Fußball und Tennis (Kleinstadt am Main 8 und 5, Mönchberg 3
und 4, Osthafen 6 und 11); Leichtathletik in Würzburg 11. `surface` an Sportplätzen 20 bis 67 %, an Spielplätzen 0 bis
15 %. Spielgeräte als eigene Punkte (`playground=*`): 24, 31, 2, 9, 33, 40, 0; meist Schaukel, Rutsche, Wippe,
Federtier, Klettergerüst, Sandkasten.

### Wasser, Bahn, Straßenmöbel, Wahrzeichen (Anzahl)

| | Würzburg | Frankfurt | Osthafen | Mönchberg | Marais | Amsterdam | Kleinstadt am Main |
|---|---|---|---|---|---|---|---|
| Schifffahrtszeichen (`seamark:type`) | 78 | 117 | 141 | 0 | 88 | 392 | 57 |
| Stege, Schleusentore, Fähren | 30, 6, 1 | 12, 0, 1 | 25, 10, 1 | 0 | 69, 5, 6 | 141, 41, 11 | 1, 6, 0 |
| Gleise, davon Brücke, Tunnel, Damm | 427, 33, 13, 4 | 453, 45, 150, 73 | 140, 6, 21, 0 | 0 | 184, 2, 168, 0 | 876, 182, 54, 0 | 8, 1, 0, 0 |
| Bahnübergänge, Bahnhöfe, Bahnsteige | 49, 2, 190 | 106, 17, 229 | 29, 1, 81 | 0, 0, 7 | 0, 33, 285 | 0, 7, 228 | 4, 1, 24 |
| Bushaltestellen, Straßenbahnhalte | 124, 44 | 138, 64 | 65, 17 | 7, 0 | 226, 0 | 84, 78 | 22, 0 |
| Einzelbäume, Baumreihen | 2 412, 64 | 2 469, 125 | 385, 61 | 7, 1 | 8 695, 25 | 2 193, 131 | 41, 1 |
| Laternen, Bänke, Abfallkörbe | 608, 801, 379 | 906, 515, 561 | 44, 90, 84 | 3, 103, 17 | 4 846, 1 402, 937 | 1 738, 870, 501 | 4, 80, 47 |
| Fahrradständer, Poller | 217, 387 | 919, 172 | 166, 52 | 2, 1 | 1 489, 309 | 496, 311 | 10, 16 |
| Hydranten | 554 | 267 | 330 | 68 | 1 158 | 48 | 386 |
| Schaltkästen, Litfaßsäulen, Fahnenmasten | 55, 27, 113 | 30, 120, 11 | 19, 12, 4 | 251, 0, 0 | 87, 66, 73 | 48, 27, 6 | 1, 1, 0 |
| Brunnen und Trinkbrunnen | 88 | 74 | 6 | 1 | 144 | 65 | 5 |
| Elemente mit `wikidata` | 1 169 | 677 | 90 | 8 | 2 678 | 1 485 | 43 |
| Ortsteile mit Namen (`place`) | 6 | 10 | 3 | 0 | 20 | 47 | 0 |

### Was daraus folgt

- **Robust überall:** Nutzungsflächen mit Art (Sportplatz samt Sportart, Spielplatz, Parkplatz, Park, Friedhof,
  Kleingärten), POIs mit Namen, Bushaltestellen, Hydranten (in Deutschland dicht), Kirchen, Gewässer, Bahn.
- **Robust in Städten:** Bäume, Laternen, Bänke, Plätze als Fläche, Übergänge, Spielgeräte als Punkte, Wahrzeichen
  über `wikidata`, Ortsteilnamen.
- **Selten oder nur stellenweise:** Höhe, Dachform, Farben und Material von Gebäuden (außer in Importgebieten),
  Breite von Straßen, Belag von Sport- und Spielplätzen, Außenbestuhlung als Fläche, Markisen (`awning` an keinem
  Element). Gestaltung darf sich darauf nie verlassen: Tag nutzen, wenn er da ist, sonst eine gute Annahme je Art.
- **Importe prägen ganze Länder:** Amsterdam (Höhen, Hausboote 754), Paris (Kataster, Geschosse, 4 846 Laternen),
  Mönchberg (251 Schaltkästen eines Netzbetreibers). Mengengrenzen je Art sind Pflicht.

## Abfrage

Vorschlag (gemessen oben als „Vorschlag“): die heutige Abfrage plus

- **Ways:** `shop`, `tourism`, `historic`, `craft`, `office` (Gebäude oder Flächen mit diesen Tags ohne `building`),
  `area:highway`, `place=square`.
- **Knoten:** `amenity` als Liste statt drei Werten (Gastronomie, Bank, Apotheke, Tankstelle, Kirche, Rathaus, Post,
  Markt, Uhr, Briefkasten, Telefon, Toilette, Unterstand, Wertstoff, Ladesäule, Leihrad, Kino, Theater, Bibliothek,
  Polizei, Feuerwehr, Schule, Kindergarten, Arzt, Zahnarzt, Trinkbrunnen, Fahrradständer, dazu die bisherigen Bank,
  Abfallkorb, Brunnen); `shop`, `tourism`, `craft`, `office` ganz; `historic` ohne `memorial=stolperstein`;
  `leisure` (Picknicktisch, Außenbestuhlung, Fitnessgerät, Spielplatz, Musikpavillon); `playground`;
  `railway` (Prellbock, Bahnübergang, Fußgängerübergang, Bahnhof, Haltepunkt, Straßenbahnhalt);
  `public_transport=station`; `highway` dazu Übergang und Ampel; `seamark:type`; `waterway` Schleusentor, Wehr,
  Damm; `advertising` Säule und Plakatwand.
- **Nicht:** alle `amenity` (Stellplätze, Automaten, Parkhauseinfahrten kosten in Paris 0,8 MB ohne Nutzen),
  `building:part` (1,1 MB im Marais; Entscheidung von E235), `emergency` außer Hydranten, `sport` als Knoten.

Kosten gegen heute: 0,05 bis 1,9 s und 2 bis 20 % mehr Text (gzip 2 bis 26 %); die heutigen Grenzen (90 s, 256 MB,
Viertel bei `remark`) reichen mit Abstand. Der Rahmenspeicher hält die Antwort als Objekt (`osm-frame-store.ts`, im
Marais 41 MB Text): er bekommt eine **Abfrage-Version im Schlüssel**, damit ältere Rahmen neu abgerufen werden
(Runde 1 hatte das Problem schon mit den Prellböcken), und bleibt sonst wie er ist.

Abstimmung mit den laufenden Paketen: E238 (r6-rail) braucht `railway=level_crossing`, E235 (r6-bldg) entscheidet
über `building:part`. Das Abfrage-Paket P0 nimmt auf, was dort schon ergänzt ist, statt es doppelt einzubauen.

## E237: Nutzungsflächen

### Warum nicht über die Bodenschichten

Ein Material je Flächenart in den 12 Schichten reicht nicht (an allen drei Orten der Runde 1 voll), gäbe keine Linien
und bei 1,2 m je Texel (Splat 2048 der OSM-Welten) keine scharfen Kanten: ein Tennisplatz ist 9 Texel breit. Die Straßen haben das
gleiche Problem schon gelöst: `road-surface.ts` legt die befestigten Straßen als eigene Oberfläche über den Boden,
mit Material aus einem kleinen Array, Linien im Shader und der Höhe aus der Höhentextur.

### Flächenoberfläche (neu, allgemein)

**Kartenformat:** `CustomMapDocument.surfaces?: MapSurface[]`, Grenze `MAX_SURFACES` (Vorschlag 4096):

```ts
interface MapSurface {
  id: string;
  /** Ground material from the catalogue (an array of at most MAX_SURFACE_MATERIALS per map) */
  material: string;
  outer: MapPoint[];
  holes?: MapPoint[][];
  /** Lines drawn on it, in the frame of a turned rectangle; none when missing */
  marking?: {
    kind: 'soccer' | 'handball' | 'basketball' | 'tennis' | 'volleyball' | 'multi' | 'track' | 'parking' | 'platform';
    x: number; y: number; angle: number; length: number; width: number;
  };
  /** Moved with the objects of the same group in the editor (osm-a<id>) */
  group?: string;
}
```

Rein darstellend: Routen, Bauverbot und Simulation sehen Flächen nicht (wie Bodendecals), also kein Einfluss auf
Koop-Prüfsummen. Datei: Würzburg rund 900 Flächen, geschätzt unter 100 KB.

**Renderer** `render/surfaces/`: der Teil von `road-surface.ts`, der eine Oberfläche über das Gelände legt (Kacheln
`ROAD_TILE`, Höhe aus der Höhentextur, Ziehen zur Kamera, Nebel, Schatten, Material-Arrays aus
`terrain-textures.ts`), wandert in ein gemeinsames Modul, das Straßen und Flächen nutzen; kein zweiter Weg daneben.
Flächen werden auf ein 4-m-Raster geschnitten und je Zelle trianguliert, damit sie dem Gelände folgen. Markierungen
rechnet der Fragment-Shader aus den Koordinaten im Rechteck der Markierung: Fußball (Seiten-, Tor-, Mittellinie,
Mittelkreis, Strafräume in den Maßen des Platzes, Mähstreifen auf Rasen), Handball (6-m- und 9-m-Bögen), Basketball
(Feld, Zonen, Dreierlinie), Tennis (Doppel, Einzel, Aufschlagfelder; mittig im meist größeren Zaunfeld), Volleyball,
Mehrzweck (zwei Sätze in zwei Farben), Laufbahn (Stadionoval im Rechteck mit Bahnen), Parkplatz (Stellplätze 2,5 m
quer zur Längsachse an beiden Langseiten, Fahrgasse frei), Bahnsteig (weiße Sicherheitslinie an der Kante; für E238).
Linien weiß, auf Tennisasche weiß, auf Kunststoff je Belag.

**Editor:** Werkzeug „Flächen“: Polygon zeichnen, Material und Markierung wählen, Rechteck der Markierung ziehen
(nach der Regel aus E190: allgemeine Mechanismen, auch im Editor setzbar; Map-Kit- und MCP-Befehl dazu).

**Materialien** neu (prozedural, `tools/map-assets/bake_grounds.py`): Tartan rot, Fallschutz (EPDM, gesprenkelt),
Kunstrasen, Hartplatz (Acryl grün und blau), Beckenfliesen. Vorhanden und passend: `grass-lush`, `red-earth`
(Tennisasche, prüfen), `sand`, `wood-chips`, `gravel-light` (Boules, Wege), `asphalt`, `concrete`, `paving`,
`cobblestone`, `sidewalk`.

### Zuordnung

| OSM | Oberfläche | Markierung | Objekte |
|---|---|---|---|
| `leisure=pitch`, `sport=soccer` | `grass-lush`; `surface=artificial_turf` Kunstrasen, Asche `red-earth` | Fußball | `football-goal` an den Stirnseiten; im `sports_centre` Flutlicht (`floodlight-mast`) an den Ecken ab 60 m Länge |
| `sport=tennis` | Asche nach `surface=clay`, sonst Hartplatz | Tennis | Netz, `fence-chainlink` um das Feld |
| `sport=basketball` | Hartplatz, `asphalt` | Basketball | Korb an den Stirnseiten |
| `sport=multi` (Bolzplatz) | Tartan oder `asphalt` | Mehrzweck | Kleinfeldtore, Körbe, Ballfangzaun |
| `sport=handball`, `volleyball`, `beachvolleyball` | Hartplatz, `sand` | je Sport | Tore, Netz |
| `sport=table_tennis` | `concrete` (kleines Feld) | keine | Tischtennisplatte |
| `sport=boules` | `gravel-light` | keine | Bänke am Rand |
| `sport=athletics`, `leisure=track` | Tartan | Laufbahn | keine |
| `sport=skateboard` | `concrete` | keine | Rampen |
| `sport=equestrian` | `sand` | keine | `fence-rail` |
| `leisure=playground` | nach `surface`, sonst Fallschutz und Hackschnitzel gemischt | keine | Geräte der gemappten `playground=*`-Punkte; ohne Punkte ein Satz nach Größe (Schaukel, Rutsche, Wippe, Federtier, Klettergerüst, Sandkasten); Bänke am Rand |
| `amenity=parking` (`surface`, Fläche) | `asphalt` nach `surface` | Parkplatz | Autos auf 40 bis 70 % der Stellplätze (Hash je Platz) |
| `highway=pedestrian` + `area=yes`, `area:highway`, `place=square` | nach `surface`, sonst Pflaster (`paving`), in Altstädten `cobblestone` | keine | gemappte Bänke, Brunnen, Bäume; `amenity=marketplace` dazu Marktstände |
| `railway=platform` (Fläche) | `concrete` oder `paving` | Bahnsteig | Kante (E238) |
| `leisure=swimming_pool` | Becken wie heute, dazu 2-m-Rand aus Beckenfliesen | keine | Liegen im Freibad (`sports_centre`/`water_park` mit `swimming`) |
| `landuse=cemetery`, `amenity=grave_yard` | Boden wie heute | keine | `graves` in Reihen entlang der Längsachse statt verstreut, Wege aus `gravel-light`, Hecke am Rand |
| `landuse=allotments` | Boden wie heute | keine | Parzellen etwa 15 × 25 m mit Hecke oder Staketenzaun; Gartenhaus nur, wo OSM keine Hütten hat (Osthafen: 313 gemappte); Beete |
| `leisure=outdoor_seating` (Fläche) | keine | keine | Tische und Schirme |

Nur wo eine Markierung sinnvoll ist: Füllgrad des gedrehten Rechtecks (`minAreaRect` aus `buildings.ts`) ab 0,85,
sonst nur der Belag. Sportplätze, Tennis- und Parkplätze bekommen wie Gebäude einen ebenen Boden (auf die mittlere
Höhe, Böschung am Rand), damit Linien und Autos nicht am Hang kippen.

### Boden und Straßen danach

- `pitch`, `playground`, `parking`, `paved` fallen aus den Bodenschichten (`land-tags.ts`); die Schichten gehen an
  natürliche Klassen. Unter einer Fläche bleibt der Boden ihr nächstes Material (für die Ferne, wo das grobe Gelände
  die Oberfläche überragt, wie bei den Straßen).
- `landuse=retail`/`commercial` malen nichts mehr (wie Wohngebiet): Pflaster liegt, wo OSM Pflaster sagt (Plätze,
  Parkplätze, Fußgängerzonen).
- Ringe von Plätzen (`highway=pedestrian` mit `area=yes`) bleiben im Straßengraph (Gegner gehen über den Platz wie
  heute), werden aber nicht als Band gezeichnet; die Fläche zeigt den Platz.

## E239: POIs

### Datenweg

1. **Kategorien** `poi-tags.ts` (Daten, wie `land-tags.ts`): aus `shop`, `amenity`, `craft`, `office`, `tourism`,
   `healthcare` eine Kategorie (Bäcker, Metzger, Café, Gaststätte, Bar, Imbiss, Eis, Mode, Friseur, Apotheke, Bank,
   Supermarkt, Kiosk, Hotel, Büro, Handwerk, Arzt, Tankstelle, Kirche, Rathaus, Museum …), je Kategorie Schildfarbe,
   Piktogramm, Markise ja/nein und Farbe, Außenbestuhlung, Ladenfront.
2. **Zuordnung** `convert/pois.ts`: Punkt in Grundriss über ein Raster der OSM-Grundrisse (98 % treffen), sonst der
   nächste Grundriss in 8 m (Eingänge auf der Umrisslinie), sonst frei stehend (Kiosk, Imbisswagen, Infotafel).
   Ways mit POI-Tags sind ihr eigener Grundriss.
3. **Fassadenanker** aus den Gebäuden: je platziertem Modell (Katalog oder Extrusion aus E235) die Front zur Straße
   mit Mitte, Richtung, Breite und Höhe des Erdgeschosses. Mehrere POIs eines Gebäudes teilen die Front (Marais: 2 515
   Gebäude mit mehreren), sonst die Seitenfronten.
4. **Objekte:** Schild über dem Erdgeschoss (Text und Piktogramm), Markise (eine Modellform, Farbe über `tint`),
   Ladenfront (Glasfront in zwei Breiten, 5 cm vor der Fassade), bei `outdoor_seating=yes` Tische und Schirme vor der
   Front, wenn der Gehweg Platz hat (Prüfung `objectsOnPaths` wie Gebäude). Sonderfälle: Tankstelle (`station-canopy`
   plus Zapfsäulen), Markt (`market-stall-*`), Bildstock und Wegkreuz (`shrine`, Wegkreuz), Litfaßsäule,
   Fahrradständer, Infotafel (`signpost`), Denkmal (`statue-*`, `obelisk`).
5. **Grenzen:** Schilder mit Text höchstens 512 je Karte, nach Nähe zu den Routen und zum HQ; darüber nur Markise und
   Front. Stolpersteine kommen gar nicht (Abfrage); Gedenkorte ohne Modell bleiben weg.

### Schilder mit Text (neu, allgemein)

`MapObject.sign?: { text?: string; icon?: string }`: jedes Katalog-Modell mit einer Schildfläche im Katalog
(`signPanel: { width, height, offset }`) zeigt den Text, auch im Editor setzbar (Eigenschaftsfeld). Gezeichnet von
`render/objects/sign-text.ts`: beim Laden ein Atlas (R8, 2048², Zellen 256 × 32 px, 512 Namen) aus `fillText` in der
Schrift des Spiels, Piktogramme aus einem kleinen handgezeichneten Atlas, alles als instanzierte Quads in einem Draw
Call; Text bis 200 m Abstand, darüber nur die Tafel. Keine Logos, nur Text in unserer Schrift.

## E240: Daten für Level

Empfehlungen nach Nutzen und Risiko; keine davon ändert Spielregeln.

| Idee | Daten (siehe Erhebung) | Empfehlung |
|---|---|---|
| **Spawns an Ankern:** beim Würfeln im Rahmen Straßenpunkte nahe Bahnhof, Haltepunkt, Bushaltestelle, großem Parkplatz, Hafen, Autobahnanschluss bevorzugen; der Spawn heißt danach („Bahnhof Miltenberg“, „Parkplatz Mainstraße“), sonst wie heute nach der Straße oder dem Ortsteil | überall: Haltestellen 7 bis 226, Parkplätze 17 bis 420 | bauen (P5), billig, macht den Ort lesbar |
| **Leben aus Daten:** Boote auf dem Hauptwasser (`life` Route `boats` entlang der Flussmitte, wo Schifffahrtszeichen, Schleusen oder Stege sind), festgemachte Boote an Stegen und Liegeplätzen, Möwen über Hafen und Fluss, Glocke der Kirche nächst dem HQ zu jeder Welle (`life.waveSound` mit Bereich), Schiffshorn bei Häfen, Grundgeräusch des Bioms | Schifffahrtszeichen 57 bis 392, Stege bis 141, Kirchen in jedem Ort | bauen (P5), alles vorhandene Mechanik aus E190 |
| **Wahrzeichen:** Kirche, Rathaus, Burg, Tor, Elemente mit `wikidata` nahe HQ: Intro-Flug über das Wahrzeichen (`MapIntro`), im Rahmen ein Knopf „HQ an das Wahrzeichen“; Standard bleibt die Adresse | `wikidata` 8 bis 2 678 | Intro bauen (P5), Knopf siehe offene Frage 2 |
| **Ortsteile:** Namen aus `place=suburb/quarter` für Spawns ohne Anker | Städte 3 bis 47, Dörfer keine | mit den Ankern |
| **Engstellen** an Brücken, Schleusen, Tunneln | Brücken bis 500 | nichts bauen: sie sind schon Engstellen des Wegenetzes |
| **Sportplätze als Bauflächen** | 7 bis 43 je Karte | bleiben frei bebaubar (Tore und Netze klein), keine Regel |
| **Hydranten und Brunnen als Wasserquelle** (Bonus für Wasser- und Frost-Tower) | Deutschland dicht (bis 1 158), Amsterdam 48 | später, offene Frage 1 |
| **POI-Boni** (Bäcker, Tankstelle …) | dicht in Städten | verworfen für jetzt: Balance auf echten Orten ungleich verteilt |

## Schnittstellen

- **E235 (Gebäude):** liefert je platziertem Gebäude den Fassadenanker (oben); entscheidet `building:part`; nutzt
  Höhen und Dachformen, wo sie da sind (Amsterdam, Marais, Würzburg). Grundrisse mit POI-Tags (`shop`, `amenity` als
  Way) laufen wie andere Gebäude, P3 hängt nur an.
- **E238 (Bahn und Straße):** Bahnsteige sind Flächen mit Markierung `platform` (P1), die Kante baut E238;
  Bahnübergänge (Platten, Andreaskreuz, Schranke) sind E238. Zebrastreifen aus `highway=crossing` holt P0 schon; das
  Zeichnen im Straßenshader ist eine spätere Kleinigkeit (E238 oder danach).
- **Runde 1:** `paintGround` (Klassen raus), `vegetation.ts` (Friedhof und Kleingärten in Reihen und Parzellen),
  `furniture.ts` (Punkte wie Brunnen und Bänke bleiben dort, POI-Objekte kommen aus `pois.ts`), `layout.ts`
  (Anker), Bericht je Schritt (`areas`, `pois`, `life`).

## Leistung

| Teil | Budget |
|---|---|
| Abfrage | höchstens 6 s und 6 MB gzip an der dichtesten Probe (Marais heute 5,2 s, 5,98 MB) |
| Erzeugen | Flächen, POIs, Leben zusammen höchstens 300 ms in Node am Marais |
| Flächenoberfläche | ein Material, ein Draw Call je belegter Kachel (höchstens 16 mehr), höchstens 150 000 Dreiecke (Würzburg geschätzt: Parkplätze, Plätze, Sport- und Spielplätze rund 7 % der Fläche auf 4-m-Zellen, 50 000 bis 80 000), Aufbau unter 30 ms |
| Schilder | zwei Draw Calls (Tafeln laufen als Objekte, Text als Quads), Atlas 4 MB, Aufbau unter 40 ms |
| Objekte der Flächen und POIs | eigener Anteil `AREA_BUDGET_SHARE` 10 % von `SCENE_BUDGET`; reicht es nicht, fallen Autos, dann Außenbestuhlung, dann Geräte fern der Routen |
| Bildzeit | Messung wie O5/O7 (Dev-Server, headless, Startansicht): Würzburg und Marais vorher und nachher, höchstens 10 % mehr |

## Arbeitspakete

Reihenfolge: **P0**, dann **P1** und **P4** parallel (P4 ab sofort möglich), dann **P2** und **P3**; **P5** nach P0
parallel zu allem.

| Paket | Inhalt | Dateien | Hängt an | Prüfungen |
|---|---|---|---|---|
| **P0 Abfrage** | Abfrage wie oben, `isAreaTags` für `area:highway` und `place=square`, Abfrage-Version im Rahmenschlüssel, eingefrorene Probe erweitern | `osm-query.ts`, `osm-parse.ts`, `osm-frame-store.ts`, Specs, `integration/fixtures/osm` | Abgleich mit r6-rail und r6-bldg | `osm-query.spec`, `osm-parse.spec`, `import-osm.spec`; eine Messung Marais und Mönchberg (Zeit, Bytes) |
| **P1 Flächenoberfläche** | `MapSurface` im Dokument, Datei, Prüfung, Packen, Koop-Versand; gemeinsames Modul aus `road-surface.ts`; Flächen-Renderer mit Markierungen; Editor-Werkzeug, Map-Kit, MCP; neue Materialien | `map-document.ts`, `map-file.ts`, `map-pack*.ts`, `map-ops/validation`, `render/surfaces/`, `render/paths/road-surface.ts`, `editor/`, `tools/map-assets/bake_grounds.py`, Katalog | keins | Specs (Hin und Zurück der Datei, Triangulation, Raster, Markierungsrechteck), `custom-map-view.perf.spec`, Bild je Markierung auf einer Testkarte, Vorher/Nachher Straßen unverändert |
| **P2 Flächen der OSM-Welt** (E237) | `area-tags.ts` (Tabelle), `convert/areas.ts`: Klassen, Rechteck, Markierung, Ebnen, Objekte je Art, Budget; Boden ohne die Flächenklassen; `retail`/`commercial` ohne Farbe; Plätze statt Ringband | `world/osm/area-tags.ts`, `convert/areas.ts`, `land-tags.ts`, `convert/ground.ts`, `convert/vegetation.ts`, `import-osm.ts`, Bericht, Rahmen-Fortschritt | P0, P1, P4 (Modelle) | Specs je Art; `import-osm.spec` (kein `object-on-path`, Budget); Editor-Prüfung; Bilder Vorher/Nachher: Spielplatz der Kleinstadt am Main, Sportplätze Würzburg, Plätze Marais |
| **P3 POIs** (E239) | `poi-tags.ts`, `convert/pois.ts` (Zuordnung, Anker, Objekte, Grenze); `MapObject.sign`, Katalog `signPanel`, Text-Renderer, Editor-Feld | `world/osm/poi-tags.ts`, `convert/pois.ts`, `convert/buildings.ts` (Anker), `map-document.ts`, `render/objects/sign-text.ts`, Editor | P0, Anker aus E235, P4 | Specs (Zuordnung, mehrere POIs je Front, nichts auf der Straße, Grenze 512); Aufbauzeit Atlas; Draw Calls; Bilder Altstadt Würzburg, Marais |
| **P4 Modelle und Materialien** | Basketballkorb, Tennisnetz, Volleyballnetz, Tischtennisplatte, Kleinfeld- und Handballtor, Klettergerüst, Wippe, Federtier, Sandkasten, Skaterampe, Fahrradständer, Litfaßsäule, Fassadenschild mit Schildfläche, Ausleger-Schild (Altstadt), Markise, Ladenfront (zwei Breiten), Café-Garnitur, Schirm, Biertisch-Garnitur, Zapfsäule, Liege, Wegkreuz, Beet; mit Fernstufen, im Szenenbudget | `tools/map-assets/build_*.py`, `public/maps/assets/`, `LICENSES.md` | keins | Vorher/Nachher-Bilder je Modell zur Abnahme, Dreiecke und Szenenkosten je Modell |
| **P5 Level-Daten** (E240) | Anker beim Würfeln und Namen der Spawns (`layout.ts`, Rahmen), Leben aus Daten, Intro-Flug über das Wahrzeichen | `convert/layout.ts`, `osm-frame-core.ts`, `convert/life.ts` (neu), `import-osm.ts` | P0 | Specs (Anker gleich bei gleichen Daten, Boote nur auf Wasser, Glocke an einer Kirche); Bilder; Ton hört der User |

Jedes Paket: Doku in diesem Plan (Abschnitt „gebaut“ je Paket wie in Runde 1), Bericht der Welt um seine Zahlen,
Szenenkosten an Würzburg, Marais und Kleinstadt am Main.

## P0 Abfrage, gebaut (2026-10-18)

- `osm-query.ts`: die Abfrage wie im Abschnitt [Abfrage](#abfrage) (Ways nach Schlüssel samt `area:highway`, dazu
  `place=square`; Knoten mit der `amenity`-Liste `POINT_AMENITIES`, ohne Stolpersteine; dazu `healthcare` als Way und
  Knoten für P3). `OSM_QUERY_VERSION` (heute 3) steht im
  Schlüssel des Rahmenspeichers (`frameKey`, vorher fest `v1`): Rahmen der alten Abfrage werden neu abgerufen.
- `isAreaTags`: `area:highway`, `place=square` und geschlossene Ways mit `shop`, `tourism`, `craft`, `office`, `healthcare` sind
  Flächen. Keine davon hat eine Landklasse, die Welt sieht bis P2 und P3 also gleich aus.
- Die eingefrorene Probe Miltenberg hat die 410 Elemente angehängt, die die neue Abfrage im selben Quadrat mehr
  liefert (95 Läden, 107 `amenity`-Punkte, 34 Tourismus, 30 `historic`, 18 Spielgeräte, 3 Plätze als Fläche …; Daten
  der eigenen Instanz vom 2026-10-13, `source.round2`); was vorher darin war, ist unverändert.

## P5 Level-Daten, gebaut (2026-10-18)

Code: `convert/anchors.ts` (Anker und Wahrzeichen), `convert/life.ts` (Leben und Intro), `convert/layout.ts` (Spawns an
Ankern), `osm-frame-core.ts` und `components/osm-frame/` (Knopf „HQ an das Wahrzeichen“). Specs: `anchors.spec.ts`,
`life.spec.ts`, `osm-frame.scenario.spec.ts`.

### Beim Bau entschieden

- **Anker:** Bahnhof und Haltepunkt (Stufe 0), Hafen (`seamark:type=harbour`, `leisure=marina`, `landuse=harbour`) und
  Parkplätze ab 1500 m² auf der Fläche (Stufe 1), Bus- und Straßenbahnhalte (Stufe 2). Ein Anker gilt mit dem Fuß auf
  der nächsten Fahrstraße in 120 m, im Abstand der Spawns (500 bis 1000 m) und 40 m vom Kartenrand. 75 % der
  gewürfelten Spawns versuchen zuerst einen Anker (gewichtete Ziehung 4 : 2 : 1 nach Stufe), der Rest wird wie bisher
  auf irgendeiner Straße gewürfelt: „Roll again“ findet so auch neue Straßen statt immer desselben Bahnhofs. Die Füße
  werden einmal je Layout über ein Straßenraster gesucht.
- **Namen:** ein Spawn bis 60 m von einem Anker heißt nach ihm („Engelplatz stop“, „Miltenberg station“, „Car park“;
  bei Haltestellen ohne den Ort vor dem Komma; ein Name, der schon „Bahnhof“, „Station“, „Parkplatz“, „Hafen“ o. ä.
  sagt, steht allein: „Würzburg Hauptbahnhof“), sonst wie bisher nach der Straße oder der Himmelsrichtung. Ortsteile
  (`place=suburb`) als Rückfall sind nicht gebaut: die Abfrage holt diese Knoten nicht, und fast jeder Spawn hat eine
  Straße mit Namen.
- **Wahrzeichen:** Dom, Burg, Palast (`castle_type=palace`), Kirche, Rathaus, Stadttor, Turm, Denkmal, Museum, Sehenswürdigkeit mit `wikidata`;
  Gewicht nach Art (Dom 6 bis Andachtsort 1), `wikidata` +2, `heritage` +1, Größe bis +2, geteilt durch
  1 + Abstand / 600 m. Altar- und Kapellenpunkte im Haus zählen nicht, zwei Wahrzeichen unter 40 m sind eines.
- **HQ an das Wahrzeichen:** der Rahmen zeigt bis zu drei Wahrzeichen in 800 m um die Adresse (im Quadrat mit Platz
  für das HQ) als Knöpfe; das HQ geht auf die Straße nächst dem gewählten, stehende Spawns bleiben, wo sie noch
  passen; „Back to the address“ nimmt es zurück. Kartenname und Adresse bleiben.
- **Leben** (Lebensbereiche wie im Editor, `doc.life`): Grundgeräusch des Bioms (Lautstärke 0,5); Boote auf dem längsten
  Stück einer Fluss- oder Kanallinie, das auf dem Wasser der Karte liegt (mindestens 250 m; Wege an Brücken über ihre
  Knoten verbunden), Fischkutter, wo Schiffe fahren (ab 3 Schifffahrtszeichen, ein Schleusentor oder `CEMT`), sonst
  Ruderboote, so viele, wie der Fluss lang ist (Dichte 1 je 800 m, eine Route trägt drei Boote je Dichte, höchstens
  Dichte 3); Möwen über derselben Linie; Ruderboote in den drei größten Yachthäfen; Krähen um die Kirche mit Glocken
  nächst dem HQ (bis 900 m), deren Glocke zu jeder Welle läutet (`waveSound` mit diesem Bereich), sonst das
  Schiffshorn auf dem Fluss. Ein Lastkahn als Modell fehlt (Vorschlag an P4).
- **Intro:** wo ein Wahrzeichen bis 1200 m vom HQ steht, ein Flug in vier Ansichten (16 s): von jenseits des
  Wahrzeichens heran, an ihm vorbei, hinüber und auf das HQ hinab, jede Ansicht über dem höheren Boden von Kamera und
  Ziel. Sonst der Rundflug des Spiels wie bisher.

### Messungen P5 (2026-10-18)

Erzeugen in Node ohne Höhen und ohne Katalog mit den Antworten der Erhebung (Vorschlag-Abfrage). Zeiten sind hier
nicht angegeben: der Rechner war belegt, die Messung von Schritt „life“ und Layout mit und ohne Anker steht in der
Liste der späteren Messungen.

| | Würzburg | Frankfurt | Osthafen | Mönchberg | Marais | Amsterdam |
|---|---|---|---|---|---|---|
| Spawns (Namen) | Bahnhofplatz car park, Parkplatz Congresscentrum car park, Mainleitenweg stop, Car park | Börneplatz/Stoltzestraße stop, Südbahnhof stop, Untermainanlage, Affentorplatz stop | Buchrainplatz stop, Strahlenbergerstraße, Hafenmühlenweg stop, Wiener Straße stop | vier Straßen und Himmelsrichtungen (keine Anker im Abstand) | Hôtel-de-Ville station, Arts et Métiers station, Saint-Claude stop, Saint-Paul stop | Buiten Brouwersstraat stop, Muntplein stop, Centraal Station station, Nieuwmarkt station |
| Intro über | Dom St. Kilian | Kaiserdom St. Bartholomäus | Erlöserkirche | St. Johannes der Täufer | Cathédrale Sainte-Croix des Arméniens | Koninklijk Paleis |
| Glocke | Marienkapelle | Dreikönigskirche | Erlöserkirche | St. Johannes der Täufer | Notre-Dame-des-Blancs-Manteaux | eine Kirche ohne Namen |
| Lebensbereiche, Boote | 3, Fischkutter | 3, Fischkutter | 4, Fischkutter | 1, keine | 6, Fischkutter | 6, Fischkutter |

### Browser-Probe P5 (2026-10-18)

Würzburg (HQ auf der Adresse) und Amsterdam (HQ auf dem Koninklijk Paleis) im Dev-Server neu erzeugt und gespielt,
Chromium headless auf der GPU, Ton über einen Abgriff der Audio-Kontexte. Rahmen mit drei Wahrzeichen-Knöpfen,
„Back to the address“, Spawn-Namen an Haltestellen, Parkplätzen und Bahnhöfen, Intro über Dom bzw. Palast, Fischkutter
auf Main und Grachten, Möwen, Krähen um die Kirche, die Glocke zum Start der ersten Welle (im Mitschnitt an der Stelle
des Wellenstarts, Korrelation mit `bell.mp3`). Gefunden und behoben: doppelte Wörter in Spawn-Namen, ein Palast als
Burg, drei Boote auf 2,4 km Fluss. Bilder und Clips liegen lokal, nicht im Repo.

## P4 Modelle, gebaut (2026-10-18)

- `tools/map-assets/build_poi.py`, 25 Modelle im Stil von `build_modern.py`: `basketball-hoop`, `tennis-net`,
  `volleyball-net`, `table-tennis`, `goal-small`, `handball-goal`, `skate-ramp`, `climbing-frame`, `seesaw`,
  `spring-rider`, `sandbox`, `bike-rack`, `advertising-column` (Plakate selbst gezeichnet, ohne Inhalt),
  `fuel-pump`, `wayside-cross`, `flower-bed`, `sun-lounger`, `beer-bench-set`, `cafe-set`, `parasol`,
  `shopfront-narrow` und `-wide` (3 und 6 m), `awning`, `sign-facade`, `sign-bracket`. 96 bis 792 Dreiecke, Sichtweite
  250 bis 700 m; elf mit Fernstufe (`decimate_keeping`, alle Materialien bleiben).
- Netze zeichnet das Skript selbst (Schnüre ein Viertel der Masche breit): die gemeinsamen Karten `net.png` und
  `chainlink.png` verschwinden nach wenigen Metern, weil die Mipmaps die dünnen Schnüre wegmitteln (gilt auch für das
  ältere `football-goal`).
- Fassadenobjekte haben den Ursprung auf der Wand am Fuß, Front -Y; Markise, Schirm, Schilder und Zapfsäule sind hell
  gebaut, damit `tint` sie färbt (die Markise Ton in Ton gestreift).
- Die fünf Bodenmaterialien baut P1 (`bake_grounds.py`), Bahnübergang-Teile E238.

## P3 POIs, gebaut (2026-10-18)

- **Schilder** (allgemein, `docs/CUSTOM_MAPS.md` „Schilder“): `MapObject.sign { text, icon }`, Katalog `signPanel`
  (`sign-facade`, `sign-bracket`, dazu die Schildbänder von `shop-small` und `shop-office`), `render/objects/sign-text.ts`
  mit einem R8-Atlas aus Wort und Piktogramm (`sign-icons.ts`, rund 40 von Hand gezeichnet) und einem Draw Call für
  alle Schilder. Die Kartenprüfung verwirft kaputte Schilder.
- **Kategorien** `world/osm/poi-tags.ts`: 46 Gattungen aus `shop`, `amenity`, `craft`, `office`, `tourism`,
  `healthcare` mit Wort in sechs Sprachen (de, fr, nl, it, es, en), Piktogramm, Ladenfront ja/nein, Markisenfarbe,
  Bestuhlung, Ausleger, Brettfarbe, Rang. Restaurant mit deutscher oder regionaler Küche wird „Gasthaus“. Sprache: das
  häufigste `addr:country`, sonst grobe Landesumrisse (Belgien und Schweiz nach Sprachgebiet), sonst Englisch.
- **Fassadenanker** `convert/facades.ts` (`FacadeAnchor`): Straßenfront und, bei freistehenden Häusern, die Seiten;
  Erdgeschosshöhe, Platz und Höhe für das Brett, Tiefe des Gesimses und ob das Erdgeschoss eigene Schaufenster oder ein
  eigenes Schildband hat, je Katalogmodell gemessen. Andere Gebäude (Extrusion aus E235) bringen dieselbe Form mit.
- **Zuordnung und Gestaltung** `convert/pois.ts`: Punkt im Grundriss, sonst nächster Grundriss bis 8 m; nächste
  Front, die Straßenfront zuerst; mehrere Läden teilen die Front in Felder (je 2,8 m, sonst fallen die niedrigeren
  Ränge weg). Je Feld: Brett mit Wort und Piktogramm (ein einzelner Laden schreibt auf das eigene Schildband), Ladenfront
  wo die Wand keine eigenen Schaufenster hat, Markise unter dem Brett (Saum mindestens 2,1 m), Ausleger mit Piktogramm
  bei Gasthaus, Bäcker, Metzger, Apotheke, Hotel in der Altstadt (`heritage`, `historic`, Baujahr vor 1900 oder
  Satteldach und höchstens fünf Geschosse, nur wie OSM es sagt), Tische und Schirm bei `outdoor_seating=yes`, wenn sie
  abseits von Straße und Grundriss Platz haben. Zapfsäulen unter dem Tankstellendach, Litfaßsäulen, Wegkreuze,
  Bildstöcke, Fahrradständer und Picknicktische an ihren Punkten. Alles einer Front in der Gruppe des Gebäudes.
- **Grenzen:** 512 Schilder, die Ränge und dann die Nähe zum HQ zuerst; Objekte in 6 % des Szenenbudgets (Schilder und
  Fronten, dann Markisen, dann Tische). Schritt `pois` im Rahmen-Fortschritt, Bericht `report.pois`.
- **Zahlen** (eigene Instanz, 1 km um die Mitte, ohne Höhen): Würzburg 838 POIs, 677 an Gebäuden, 512 Schilder (165
  über der Grenze), 230 Ladenfronten, 148 Markisen, 54 Ausleger; Marais 1 863 POIs, 1 587 an Gebäuden, 512
  Schilder (823 über der Grenze, 253 ohne Feld), Sprache Französisch. Miltenberg (Probe) 159 POIs, 138 Schilder.

## Entschieden (User, 2026-10-18)

1. **Hydranten und Brunnen als Spielmechanik:** nicht in dieser Runde.
2. **HQ an das Wahrzeichen:** ja, als Knopf im Rahmen; die Adresse bleibt der Standard (P5).
3. **Schilder:** nur die Gattung („Bäckerei“, „Gasthaus“, „Apotheke“) als Symbol und Schrift, keine echten Namen,
   keine Logos (P3). Der Text-Atlas schrumpft damit auf die Gattungen der Kategorietabelle.
