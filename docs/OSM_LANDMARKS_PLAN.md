# Besondere Gebäude in OSM-Welten (Plan)

**Status:** Plan, 2026-10-21 (TODO E297), nichts gebaut
**Bezug:** [OSM_WORLD_PLAN.md](OSM_WORLD_PLAN.md) (Gebäude, Bau aus dem Grundriss E235, Altstadt V10),
[OSM_WORLD_ROUND2_PLAN.md](OSM_WORLD_ROUND2_PLAN.md) (Wahrzeichen als Anker, E240), [CUSTOM_MAPS.md](CUSTOM_MAPS.md)
(Katalog, Renderer), [DESTRUCTION_PLAN.md](DESTRUCTION_PLAN.md) (Ruinen, Programme), TODO E280 (Ruinen-Programme)

Schloss Johannisburg in Aschaffenburg steht in einer OSM-Welt als fünf sechsgeschossige Wohnblöcke um einen
gepflasterten Platz. Das ist kein Einzelfall: Burgen, Schlösser, Dome, Klöster, Stadttore, Rathäuser und Ruinen gehen
heute denselben Weg wie ein Wohnhaus, und auch gewöhnliche Häuser folgen ihrer OSM-Kontur oft nur grob. Dieser Plan
nimmt beides zusammen auf (Befund, Erhebung an acht Orten, Messung der Abdeckung an vier) und schlägt einen allgemeinen
Weg vor: das Gebaute folgt dem echten Grundriss, besondere Gebäude werden erkannt und mit ihren Teilen, Dächern und
Türmen gebaut, Katalogmodelle nur, wo sie wirklich passen.

## Ergebnis in Kürze

1. **Die Art kennt keine Wahrzeichen.** `building=castle`, `palace`, `tower`, `gatehouse`, `cloister`, `ruins`
   (weggelassen) und `historic=*` fehlen in `building-tags.ts`. Das Schloss (4 308 m², Hof, `building:levels=6`) wird
   `apartments`, in Rechtecke zerlegt und mit `block-row-6`-Modulen belegt. Eine zweite Einteilung derselben Tags gibt
   es schon: `landmarkKind` in `convert/anchors.ts` (Intro-Flug, HQ-Angebot). Beide werden eine.
2. **Der Bau aus dem Grundriss greift beim Schloss, darf aber nicht stehen.** Die Module decken 21 bis 25 % (Schwelle
   mit Hof 90 %), `raiseMass` baut den Umriss, `massBlocked` verwirft ihn: der Rand des Schlosshofs
   (`highway=pedestrian`, `area=yes`) ist eine 5 m breite Straße, deren Knoten teils in den Flügeln liegen, und vier
   Durchgänge (`tunnel=building_passage`) laufen als gewöhnliche Fußwege durch die Mauern. Das Zurückschneiden ließe
   weniger als die Hälfte stehen, also bleiben die Module, die übrig sind. Liegt das HQ im Hof (der nächste Weg zur
   Mitte ist der Hofrand), fällt der Bau zusätzlich wegen der 14 m um das HQ.
3. **OSM hat die Gestalt oft schon.** Von 59 besonderen Gebäuden ab 300 m² an acht Orten haben 28 (47 %)
   `building:part` (Simple 3D Buildings) mit Höhen, `min_height` und Dachform; das Schloss hat 19 Teile (vier Flügel mit
   Satteldach, vier Ecktürme mit Zwiebelhauben von 32,5 bis 52 m, vier Treppentürme). Die Abfrage holt keine
   `building:part` und keine `type=building`-Relationen.
4. **Ruinen fehlen oder stehen heil.** `building=ruins` wird weggelassen, `ruins=yes` übersehen (Burg Wertheim: sechs
   Türme und der Palas mit `ruins=yes` stehen als heile Häuser, die Burg selbst ist eine Fläche `historic=castle` ohne
   `building` und wird nicht gelesen).
5. **Die Kontur gewöhnlicher Häuser:** Median der Deckung 79 bis 91 %, unter 70 % Deckung 4 % (Miltenberg-Probe) bis
   33 % (Würzburg Altstadt). Größte Ursachen: zerlegte L-, T- und Hofformen (die Module decken die Flügel schlecht),
   an Straßen beschnittene Bauten aus dem Grundriss, weggelassene Grundrisse, und dieselbe Blockade wie beim Schloss:
   45 Grundrisse in Würzburg (39 000 m², 21 % der bebauten Fläche) behalten Modelle, 34 davon mit unter 50 % Deckung,
   weil ihr Bau aus dem Grundriss blockiert ist (Straße, Wasser oder HQ; am Schloss nachgeprüft: Platzrand und
   Durchgänge, für die übrigen nicht einzeln).
6. **Weg:** ein Bauweg, nicht zwei. Der Bau aus dem Grundriss (`MapMass`, `mass-layer.ts`) wird der Normalfall für
   alles, was die Modelle nicht sauber decken, und lernt Teile (Höhe von bis, eigenes Dach), Dächer über beliebigen
   Umrissen (Satteldach je Flügel), Dachaufsätze (Turmhelm, Zwiebel, Kuppel, Zinnen) und Ruinenzustand. Alles über
   Instanzen und Uniforms der bestehenden zwei Programme; Draw Calls je Dachaufsatz-Geometrie einer mehr, keine neuen
   Programme (E280).

## Befund im Code

### Art eines Grundrisses

`buildingKind` (`building-tags.ts`) liest `building` (Tabelle `BUILDING_VALUES`), sonst `amenity`, `shop`, dann
Größe, Geschosse, Landnutzung und Nachbarschaft. Was die Tabelle nicht kennt, wird geraten: über 1 500 m² mit Hof oder
Flügeln und mehr als zwei Geschossen ist es ein Wohnblock. Bekannt sind `church`, `cathedral`, `chapel`, `mosque`,
`religious` (Kirche), `townhall`, `civic`, `museum`, `government` (öffentlich), `train_station`. Unbekannt und damit
geraten: `castle`, `palace`, `tower`, `gatehouse`, `cloister`, `monastery` (nur als `amenity`), `synagogue`, `temple`,
`bell_tower`, `fort`, `bunker`. `historic`, `castle_type`, `tower:type`, `man_made=tower`, `ruins` liest die Art nie.
`NOT_ON_GROUND` lässt `building=ruins` ganz weg.

Dieselben Tags liest `landmarkKind` (`convert/anchors.ts`) für Intro-Flug, Glocke und das HQ-Angebot im Rahmen: dort
sind Schloss, Burg, Stadttor, Turm, Denkmal, Museum und Sehenswürdigkeit schon unterschieden. Die Gebäude wissen davon
nichts.

### Katalogmodelle in Rechtecken

`placeBuildings` (`convert/buildings.ts`): kleinstes gedrehtes Rechteck; Füllgrad unter 0,8 wird auf einem Raster in
bis zu acht größte Rechtecke zerlegt (`splitFootprint`); jedes Rechteck bekommt das Modell seiner Art mit der besten
Passung (Maßstab 0,8 bis 1,25, Reihen von Modulen, zwei Reihen Rücken an Rücken), sonst das der Nachbarart, sonst eine
Reihe Blockrand-Module. Danach frei von Wasser, HQ (14 m) und Straßen (verkleinern, sonst weg).

### Bau aus dem Grundriss (`mass`, E235)

Greift, wenn die Modelle weniger als 60 % decken (ab 250 m² 75 %, mit Hof 90 %) oder keins passt. `raiseMass`
(`convert/building-mass.ts`): Außenring und Höfe vereinfacht, Höhe aus `height` oder `building:levels` (Wohnen 2,9 m,
sonst 3,6 m je Geschoss), Dach aus `roof:shape`: geneigt **nur über einem Rechteck** ohne Hof (Füllgrad 0,9, Altstadt
0,72), sonst flach mit Attika oder Mansarde (ohne Hof). Fassade aus `building:material` oder der Art (`plaster`,
`concrete`, `metal`, `brick`, `stone`, `timber`). Türme: unter 400 m² und höher als das 2,2-fache der Wurzel der Fläche
werden Sandstein mit steiler Pyramide. Gezeichnet in `render/objects/mass-layer.ts`: jede Wand eine Instanz eines
Einheitsvierecks, jedes Dachdreieck eine Instanz, rund zehn Draw Calls für alle Bauten einer Karte, Fassaden aus dem
Shader (`uFacade` als Uniform, seit E280 Stufe 1 ein Programm für alle Wände, eins für alle Dächer).

`massBlocked` verwirft den Bau bei Wasser unter einer Ecke, HQ näher als 14 m, und wenn er nach dem Zurückschneiden an
Straßen (`clipOffRoads`, je Straße eine Halbebene) weniger als die Hälfte behält und auch auf 80 % verkleinert noch
auf einer Straße steht. Dann bleiben die Modelle, die vorher übrig waren, gleich wie schlecht sie decken.

Was die Straßen dabei mitbringen (`convert/roads.ts`, `osm-tags.ts`): `tunnel=building_passage` gilt nicht als Tunnel,
der Durchgang ist ein gewöhnlicher Weg durch das Haus. Der Rand eines Platzes (`highway=pedestrian`, `area=yes`) wird
eine begehbare Kante (`edge.area`) mit Straßenbreite, die `SegmentIndex` und `objectsOnPaths` wie eine Straße zählen.

### Teile, Dachform, Höhe, Höfe

| Tag | heute |
|---|---|
| Innere Ringe (Höfe) | gelesen: Zerlegung umgeht sie, `mass` baut Hofwände; mit Hof immer Flachdach |
| `building:part`, `type=building` | nicht abgefragt (`WAY_KEYS` hat `building`, nicht `building:part`), nirgends gelesen |
| `roof:shape` | nur am Grundriss: `flat`, `gabled`, `hipped`, `half-hipped`, `pyramidal`; `onion`, `dome`, `cone`, `skillion`, `gambrel`, `round`, `many` werden flach |
| `roof:height`, `roof:angle` | für `mass` gelesen |
| `height`, `building:levels` | Höhe von `mass`, Geschosszahl für die Modellwahl |
| `min_height`, `building:min_level` | nicht gelesen |
| `building:colour`, `roof:colour` | Wandtönung ja, Dachfarbe nein |
| `ruins=yes`, `building=ruins`, `historic=ruins` | übersehen bzw. weggelassen |
| `historic=castle` als Fläche ohne `building` | nur als Wahrzeichen-Anker, nicht gebaut |

### Wahrzeichen-Modelle im Katalog

Für OSM-Gebäude genutzt: `town-church` (33 × 14 m mit Turm, 2 202 Dreiecke), `chapel`, `town-hall` (30 × 15 m),
`station`, `school`. Dazu liegen im Katalog aus den Burg- und Ruinenwelten: `castle-keep`, `castle-tower`,
`castle-tower-roof`, `castle-tower-ruined`, `castle-gate`, `castle-wall` (gerade, Ecke, Ende, verfallen, genutzt für
`barrier=city_wall`), `castle-ruin`, `keep-ruin`, `gate-ruin`, `tower-ruin`, `ruin-wall`, `ruin-arch`, `bell-tower`,
`watchtower`, `fort-tower`, `statue-horse`, `statue-knight`, `obelisk`, `fountain`. Feste Größen, für echte Grundrisse
nur als Zierteil oder bei kleinen Einzelbauten brauchbar.

### Altstadt und HQ

`findOldTown` macht Häuser, Läden und öffentliche Bauten bis 700 m² und fünf Geschosse zur Art `oldtown`, auch nach
`start_date` vor 1850 und `historic=building`. Wahrzeichen über 700 m² bleiben ihrer Art. Das HQ-Angebot im Rahmen
(`osm-frame-core.ts`) setzt das HQ an den Weg, der der Mitte des Wahrzeichens am nächsten liegt; bei einem Hofgebäude
ist das der Hof, und die 14 m Abstand nehmen dann das Wahrzeichen weg.

## Erhebung (2026-10-21)

Je Ort eine Overpass-Abfrage: `building`, `building:part`, `type=building` im Umkreis (200 bis 250 m, Köln 150 m;
Wertheim und Köln mit `historic`-Flächen). Rohdaten und Auswertung lokal unter `tmp/e297/` (`*.json`,
`_summary.json`, `analyze.py`).

| Ort | Gebäude | `building:part` | mit Hof | Wahrzeichen (Tags) | Teile am Wahrzeichen |
|---|---|---|---|---|---|
| Aschaffenburg, Schloss | 113 | 19 | 1 | Multipolygon `building=castle`, `historic=castle`, `castle_type=stately`, `tourism=attraction`, `building:levels=6`, `roof:shape=gabled`, `wikidata` | 4 Flügel `gabled` 32,5 m, 4 Ecktürme `flat` 32,5 m, 4 Hauben `onion` 32,5 bis 52 m, 4 Treppentürme `pyramidal`; Relation `type=building` |
| Wertheim, Burg | 47 | 1 | 0 | Fläche `historic=castle`, `ruins=yes` ohne `building`; Bergfried `man_made=tower`, `height=25`, 45 m²; fünf Türme 15 bis 27 m² `ruins=yes`; Palas `ruins=yes` | keine |
| Würzburg, Dom | 358 | 237 | 7 | `building=cathedral`, `height=30`, `roof:shape=gabled`, Material und Farben; Rathaus `civic`, Marienkapelle, Neumünster, `building=cloister` mit Hof | Dom 23, Rathaus 42, Marienkapelle 47 (Turmhelme `pyramidal`, Kuppeln `dome`) |
| Michelstadt, Rathaus | 404 | 2 | 0 | Rathaus `building=yes`, `historic=building`, `tourism=attraction`, `roof:shape=half-hipped`, 123 m²; Diebsturm, Spitzer Turm `man_made=tower` 21 bis 23 m² | Stadtkirche 1 |
| Lübeck, Holstentor | 266 | 38 | 1 | `building=civic`, `historic=city_gate`, `roof:shape=many`, 361 m²; St. Petri `church`; Salzspeicher `warehouse`, `historic=building` | Tor 20 (Türme `pyramidal`), St. Petri 10 |
| Maulbronn, Kloster | 198 | 12 | 1 | Klosterkirche `church`, `historic=building` 2 088 m²; Seminar (Relation, 2 Höfe, 8 Außenringe); 46 × `historic=building`; `building=ruins` | Kirche 1, Seminar 8 |
| Heidelberg, Schloss | 144 | 90 | 3 | Bauten `building=yes`, `historic=yes`, Namen und `wikidata`, mehrere `ruins=yes`; Krautturm `man_made=tower`, `ruins=yes` | 11 von 12 Bauten ab 300 m² haben Teile (bis 24) |
| Köln, Dom | 46 | 96 | 4 | `building=cathedral`, `height=157.38`, 7 902 m², 535 Knoten; Nordturm `building=tower` | 90 (42 `building:part=church`), `gabled`, `pyramidal` |

Was daraus folgt:

- **Erkennen** geht über wenige Tags verlässlich: `building` (castle, cathedral, church, chapel, tower, ruins, cloister),
  `historic` (castle, city_gate, building, ruins, tower), `castle_type`, `man_made=tower` mit `tower:type`,
  `amenity=place_of_worship`/`townhall`/`monastery`, `ruins=yes`, `tourism=attraction|museum`, `wikidata`, `heritage`.
  `historic=building` ist in Altstädten und Klöstern massenhaft (Maulbronn 46, Wertheim 79): es macht ein Haus alt,
  nicht besonders.
- **Gestalt** liefert OSM bei großen Wahrzeichen in gut der Hälfte der Fälle über `building:part`; bei kleineren (Burg
  Wertheim, Michelstadt) stehen Türme als eigene kleine Grundrisse mit `man_made=tower` neben oder in der Anlage.
- **Dachformen** der Teile: `gabled`, `pyramidal`, `flat`, `hipped`, `skillion` überwiegen; `onion`, `dome`, `round`,
  `quadruple_saltbox`, `gambrel` kommen an Wahrzeichen vor.
- **Ruinen** sind getaggt (`ruins=yes` oder `building=ruins`), nicht immer am Gebäude selbst (Burg Wertheim an der
  Fläche).

## Abdeckung der Grundrisse (alle Häuser)

Gemessen mit dem Import des Spiels (`convertOsm`, Katalog wie im Spiel, ohne Höhen) an der Miltenberg-Probe
(`tools/osm/osm-probe.ts`, 1,2 km) und drei Quadraten von 600 m (Aschaffenburg, Würzburg, Heidelberg). Je OSM-Grundriss
ab 40 m²: Anteil seiner Fläche unter dem Gebauten (Wandkasten der Modelle aus `BUILDING_MODELS`, Umriss des `mass`),
und Fläche des Gebauten außerhalb, als Anteil der Grundrissfläche. Raster etwa 1 500 Punkte je Grundriss. Skript und
Zahlen lokal: `tmp/e297/world/*.coverage.json`.

| | Probe | Aschaffenburg | Würzburg | Heidelberg |
|---|---|---|---|---|
| Grundrisse ab 40 m² | 1 271 | 224 | 633 | 227 |
| Deckung Median | 90 % | 91 % | 79 % | 88 % |
| Deckung nach Fläche gewichtet | 89 % | 81 % | 65 % | 72 % |
| Anteil unter 70 % Deckung | 4 % | 7 % | 33 % | 21 % |
| Anteil mit über 30 % Überstand | 0,3 % | 2 % | 2 % | 1 % |
| Bau aus dem Grundriss | 103 | 74 | 267 | 88 |
| Modelle trotz Unterdeckung (Bau blockiert) | 10 | 5 | 45 | 9 |
| weggelassen (ab 80 m²) | 4 | 1 | 48 | 7 |

Ungedeckte Fläche nach Ursache (Anteil an der ungedeckten Fläche des Orts):

| Ursache | Probe | Aschaffenburg | Würzburg | Heidelberg |
|---|---|---|---|---|
| Modelle, Rechteck, Größe passt nicht (Maßstab 0,8 bis 1,25, Seitenverhältnis) | 64 % | 9 % | 4 % | 2 % |
| Modelle, L/T/U oder Hof, in Rechtecke zerlegt | 13 % | 41 % | 33 % | 24 % |
| Modelle, schiefe oder unregelmäßige Form (Füllgrad 0,8 bis 0,95) | 12 % | 11 % | 11 % | 17 % |
| Bau aus dem Grundriss, an Straßen beschnitten oder verkleinert | 8 % | 24 % | 30 % | 28 % |
| weggelassen (Straße, kein Modell) | 2 % | 13 % | 22 % | 26 % |

- In der Kleinstadt ist der Fehler klein und verteilt: Einzelhäuser, deren Rechteck das Modell um 10 bis 20 % verfehlt.
- In Altstädten und an Wahrzeichen bestimmen drei Dinge das Bild: zerlegte Hofformen mit wenigen Modulen, der
  blockierte Bau aus dem Grundriss (siehe Schloss), und weggelassene Grundrisse (Würzburg 70 wegen Straßen, 20 ohne
  Modell). Überstand entsteht fast nur bei schiefen Formen (ein Rechteckmodell über einem Trapez, bis 27 %).
- **Bilder:** `tmp/e297/coverage/<ort>-worst.png`, je zehn schlechteste Grundrisse (rot OSM-Kontur, gestrichelt Hof;
  grau Wandkästen der Modelle; blau Bau aus dem Grundriss). Nicht mit der Ebene „OSM“ im Spiel aufgenommen, sondern
  aus denselben Daten gezeichnet (die Ebene liest dieselben Ringe aus `footprints`); das spart den Spielstart je Bild.
- **Heute im Bild** (`/map-preview` aus einem Entwicklungs-Build, Karten wie oben): `tmp/e297/today/aschaffenburg-*.png`
  (fünf Blöcke um den Platz, der Hof gepflastert), `wuerzburg-*.png` (Dom als flacher heller Block, die Türme fehlen),
  `heidelberg-*.png` (Schlossbauten als glatte Hochhäuser in Ziegel und Putz, Ruinen heil, ohne Höhendaten).

## Kategorien und Erkennung

Eine Funktion entscheidet für jeden Grundriss **Art** (wie heute) und **Rolle** (neu): `ordinary` oder ein Wahrzeichen.
Sie ersetzt `landmarkKind` in `anchors.ts`, das die Rolle dann nur noch liest. Reihenfolge = Vorrang, die erste
Regel trifft:

| Rolle | Erkennung | Bemerkung |
|---|---|---|
| `ruin` (Zustand, kein eigener Typ) | `building=ruins`, `ruins=yes`, `historic=ruins`, `abandoned:building`, oder liegt in einer Fläche `historic=castle\|ruins` mit `ruins=yes` | kombiniert mit jeder Rolle darunter (Burgruine, Kirchenruine) |
| `castle` | `building=castle\|fortress`, `historic=castle\|fort` am Gebäude; Unterart aus `castle_type`: `stately`, `palace`, `manor` → Schloss; `defensive`, `fortress` → Burg | Fläche `historic=castle` ohne `building`: Anlage, ihre Gebäude darin erben die Rolle |
| `cathedral`, `church`, `chapel` | `building=cathedral\|church\|chapel\|basilica\|monastery\|cloister`, `amenity=place_of_worship` (Religion für Turmform: christlich Turm mit Helm, sonst Kuppel oder Minarett aus `building=mosque`, Synagoge ohne Turm) | `cloister` mit Hof: Kreuzgang (Pultdach zum Hof) |
| `tower` | `building=tower`, `man_made=tower` mit `tower:type=defensive\|bell_tower\|watchtower`, `historic=tower`, oder schlank (heute schon: unter 400 m², Höhe über 2,2 × Wurzel der Fläche) | Bergfried, Stadtturm, Glockenturm |
| `gate` | `historic=city_gate`, `building=gatehouse` | Durchfahrt aus `building_passage` oder Straße durch den Grundriss |
| `townhall` | `amenity=townhall`, `building=townhall` | Rathaus am Markt, meist Altstadtnähe |
| `monument` | `historic=monument\|memorial` als Fläche, `building=monument` | selten Gebäude, eher Sockel mit Figur |
| `station` | `building=train_station`, `railway=station` als Fläche | lange Halle, Uhrturm optional |
| `sight` | `tourism=attraction\|museum` mit `wikidata` oder `heritage` | nur Optik: eigene Fassadenfamilie, keine eigene Form |
| `ordinary` | alles andere | wie heute, Altstadt bleibt |

`historic=building`, `heritage`, `start_date` allein machen nichts besonders, sie bleiben Altstadtzeichen.

## Bauweg je Kategorie

Ein Weg für alle: der Bau aus dem Grundriss (`MapMass`), erweitert. Kein zweiter Renderer, keine Wahrzeichen-Sonderwelt.

### Gemeinsame Erweiterungen von `MapMass`

1. **Teile.** `MapMass.parts?: MassPart[]`, je Teil: Ringe, Sockel (`min_height`, sonst 0), Höhe, Dach, Dachhöhe,
   Fassade optional. Aus `building:part` innerhalb des Grundrisses (Mittelpunkt im Außenring), sonst aus der
   Formerkennung unten. Ohne Teile wie heute ein Körper.
2. **Dach über beliebigem Umriss.** Satteldach und Walmdach über L-, T-, U- und Hofformen über ein gerades Skelett
   (straight skeleton) des Umrisses: jeder Flügel bekommt seinen First, Kehlen und Grate ergeben sich. Das hilft auch
   den Altstadthäusern und Wohnblöcken, die heute flach oder als Mansarde enden. Gezeichnet als Dachdreiecke wie heute
   (eine Instanz je Dreieck).
3. **Dachaufsätze.** `pyramidal` (Turmhelm), `cone`, `onion` (Zwiebelhaube), `dome`, `spire` (sehr steiler Helm),
   `battlement` (Zinnenkranz statt Attika). Je Form eine Einheitsgeometrie im Dachprogramm, instanziert, skaliert auf
   den Umriss des Teils (Achteck, Kreis, Quadrat aus dem kleinsten umschließenden Kreis bzw. Rechteck).
4. **Zustand Ruine.** Ein Feld `ruin` am Bau (Grad und Saat): gezeichnet über den vorhandenen Ruinenweg
   (`ruin-damage.ts`, `setDamage`), von Anfang an im festen Zustand „gefallen vor langer Zeit“ (`FELL_LONG_AGO` gibt es
   schon), ohne Dach, Mauerkrone gebrochen. Kein eigener Ruinen-Bau.
5. **Wege durch Gebäude.** `tunnel=building_passage` und `covered=yes` werden für Gebäude kein Hindernis (der Weg
   bleibt begehbar und gezeichnet, das Haus darüber steht; im Spiel ein Durchgang wie ein Tunnel). Die Randkante eines
   Platzes (`edge.area`) schneidet keine Gebäude, deren Grundriss sie berührt; sie wird stattdessen an der Wand
   zurückgenommen. Das löst den blockierten Bau beim Schloss und vermutlich bei vielen der 45 Grundrisse in Würzburg (dort nicht
   einzeln geprüft).
6. **Nie schlechter als der Grundriss.** Ist der Bau aus dem Grundriss blockiert, bleiben die Modelle nur, wenn sie
   mindestens so viel decken wie die Schwelle; sonst wird der Bau beschnitten gebaut (auch unter 50 %), oder der
   Grundriss fällt sichtbar weg, statt fünf Module als Ersatz stehen zu lassen.

### Je Kategorie

| Rolle | Bau |
|---|---|
| Schloss | Teile aus `building:part` (Aschaffenburg: vier Flügel Satteldach 32,5 m + 13 m Dach, vier Ecktürme, Zwiebelhauben, Treppentürme); ohne Teile: Flügel aus dem Skelett um den Hof mit Satteldach, Ecktürme aus der Formerkennung. Fassade `baroque` (Sandstein, Pilaster, hohe Fenster, Gesims je Geschoss), rote oder graue Schieferdächer aus `roof:colour` |
| Burg | Teile, sonst: Grundriss als Anlage; Türme (eigene kleine Grundrisse mit `man_made=tower` oder Formerkennung) mit Zinnen oder Helm; Mauer der Anlagenfläche `historic=castle` mit dem Burgmauer-Kit (wie `barrier=city_wall` heute), wo keine Gebäude stehen; Fassade `rubble` (Bruchstein, wenige kleine Fenster) |
| Kirche, Dom, Kapelle | Teile (Köln 90, Würzburg 23); ohne Teile: Schiff mit steilem Satteldach (48°, heute nur über Rechteck), Turm: eigener Grundriss `building=tower`/`man_made=tower` in oder an der Kirche, sonst am schmalen Ende des Schiffs, das zur Straße zeigt, quadratisch aus der Schiffsbreite, Höhe aus `height` oder 2,5 × Schiffshöhe, mit Helm. Fassade `gothic` oder `romanesque` (Spitz- oder Rundbogenfenster, Strebepfeiler als Lisenen). Kleine Kapellen bis 200 m²: Modell `chapel`, wenn es zu mindestens 85 % deckt |
| Turm, Stadttor | Teil oder schlanker Grundriss: Bruchstein oder Sandstein, Helm, Zinnen nach `tower:type`; Tor: Durchfahrt aus dem Weg unter dem Grundriss (Punkt 5 oben), Bogen im Shader der Wand an dieser Stelle (eine Wand-Art mehr wie `WALL_SHOP`) |
| Rathaus | Teile, sonst Satteldach über dem Umriss (Skelett), Fassade `baroque` oder `timber` in der Altstadt, Dachreiter (kleiner Aufsatz mit Helm) bei `wikidata` oder `tourism=attraction` |
| Kloster, Kreuzgang | wie Kirche; `cloister` mit Hof: Pultdach zum Hof, Arkaden als Wandart |
| Bahnhof | Modell `station`, wenn es deckt; sonst Halle aus dem Umriss mit Satteldach, Fassade `brick` |
| Sehenswürdigkeit, Museum | gewöhnlicher Bau, Fassade nach Alter (`start_date`, `building:architecture`): `baroque`, `gothic`, `brick` |
| Ruine | Rolle wie oben plus Zustand Ruine; heute weggelassene `building=ruins` werden gebaut |
| Denkmal | Punkt oder Fläche ohne Gebäude: Katalog (`obelisk`, `statue-*`, `fountain`) auf Sockel, nicht über die Gebäude |

### Formerkennung ohne Teile

Für Burgen, Schlösser und Kirchen ohne `building:part`:

- **Ecktürme:** Ausbuchtungen des Umrisses an konvexen Ecken: ein Stück des Rings, das sich vom Rechteck des Flügels
  abhebt (Douglas-Peucker der Flügel gegen den Ring, Rest als Polygon), Fläche 15 bis 250 m², rund oder vieleckig
  (Kreis- oder Achteckgüte über Fläche zu Umfang). Daraus ein Turmteil, eine Etage höher als der Flügel, mit Helm oder
  Zinnen.
- **Türme als eigene Grundrisse:** kleine Grundrisse (unter 120 m²) mit `man_made=tower` oder schlank, die einen
  Wahrzeichen-Grundriss berühren, werden Teil desselben Baus (gleiche Gruppe, gleiche Fassade).
- **Schiff und Turm:** bei Kirchen ohne Turmgrundriss das Rechteck des Schiffs aus dem Skelett, der Turm am Ende zur
  nächsten Straße.

Was nicht sicher erkannt wird, bleibt ein schlichter Bau mit Dach: lieber ruhig als falsch.

### Katalogmodelle

Nur noch, wo sie wirklich passen: Deckung mindestens 85 %, Überstand höchstens 10 % (heute nur Untergrenzen 60, 75,
90 %), und nie als Ersatz für einen blockierten Bau. Kleine Wahrzeichen mit eigener Gestalt (Kapelle, Kiosk,
Trafostation, Bushäuschen) und gewöhnliche Häuser mit gut passendem Rechteck bleiben Modelle; die handgemachten
Modelle tragen die Optik der Wohngebiete weiter. Zierteile aus dem Katalog (Statue, Brunnen, Uhr) können an Wahrzeichen
stehen, aber nicht ihre Form ersetzen.

## Gebautes folgt der Kontur (alle Häuser)

Aus der Messung folgen vier Schritte, die auch gewöhnliche Häuser treffen:

1. **Blockade lösen** (Punkte 5 und 6 oben): Durchgänge und Platzränder schneiden keine Häuser mehr; kein Rückfall
   auf schlecht deckende Modelle. Größter Hebel in Altstädten (Würzburg: 45 Grundrisse, 21 % der Fläche).
2. **Schwellen umdrehen:** `mass` ist der Normalfall für Grundrisse ab etwa 150 m², die kein Modell zu 85 % deckt,
   und für jede Hof-, L- und T-Form; Modelle für Rechtecke mit guter Passung. In der Probe betrifft das rund 140
   zusätzliche Grundrisse (die 13 % und 12 % der ungedeckten Fläche), in Würzburg rund 200.
3. **Fassadenfamilien statt Einheitsputz:** der Bau aus dem Grundriss muss so aussehen wie die Modelle daneben, sonst
   fällt jeder Wechsel auf. Neue Fassaden im Wand-Shader, je Familie der Modelle eine: `block` (Blockrand: Erker,
   Balkone als Wandart), `house` (Sprossenfenster, Fensterläden), dazu für Wahrzeichen `baroque`, `gothic`, `rubble`.
   Neue Dachfarben aus `roof:colour` und Dachdeckungen (Schiefer, Biberschwanz, Kupfer grün) als Instanzfarbe und
   Uniform. Alles Uniform oder Instanzattribut: kein neues Programm.
4. **Bessere Zerlegung für Modelle:** wo Modelle bleiben, Rechtecke entlang echter Kanten (rechtwinklige Zerlegung des
   vereinfachten Rings) statt Raster, und kein Rechteckmodell über einem Trapez (Füllgrad unter 0,95 und Überstand über
   10 %: `mass`). Die Altstadt-Logik behält ihre Module, wo der Grundriss ein Reihenhaus-Rechteck ist.

Der Bericht des Imports bekommt die Deckung (Median, Anteil unter 70 %, Überstand) als feste Zahl, damit jede Änderung
gemessen wird (`tools/osm/osm-world.spec.ts`).

## Optik

- **Handgemacht statt Klotz:** die Wahrzeichen tragen ihre echte Silhouette (Teile, Helme, Hauben, Zinnen); die
  Fassade bestimmt der Shader mit Gesimsen, Lisenen, Fenstern je Familie, Sockel aus Sandstein, Verwitterung wie bei
  den Modellen (Schmutz vom Boden, Läufer unter Simsen).
- **Farben aus OSM:** `building:colour` (heute schon), `roof:colour` und `roof:material` (neu): das Schloss bekommt
  rote Wände und graue Dächer, wie OSM sagt.
- **Kleine Variation:** je Bau eine Saat für Fensterachsen, Sprossen, Tönung; keine zwei Kirchen gleich.
- **Abnahme** per Vorher/Nachher-Bildern an festen Kamerapunkten (Schloss Johannisburg, Würzburger Dom, Heidelberger
  Schloss, Holstentor, Burg Wertheim mit Höhendaten), User nimmt optisch ab.

## Leistung

| | heute | nachher (Schätzung) |
|---|---|---|
| Programme der Gebäude aus dem Grundriss | 8 mit Ruinen (E280 Stufe 1, vorher 22) | gleich: Familien, Dachformen, Ruinenzustand als Uniform und Attribut |
| Draw Calls aller `mass`-Bauten | rund 10 je Karte (je Fassade, Deckung, Kappen), Schatten gleich viel | je Fassade einer: plus 5 Familien, plus je Aufsatzgeometrie einer (4 bis 6): rund 20, mit Schatten 40 |
| Draw Calls Katalogmodelle | je Modellart und LOD | weniger Modellarten in Altstädten und an Wahrzeichen |
| Dreiecke Schloss Johannisburg | fünf `block-row-6-ends` je 12 896 = 64 000 (LOD1 je 2 041) | 19 Teile: Wände rund 300, Dächer über Skelett rund 200, 8 Aufsätze à 64 bis 200: unter 2 000 |
| Dreiecke Würzburg 600 m | 2,72 M an der Kamera des Bilds `wuerzburg-dom.png` (259 Draws) | weniger: ein `mass`-Haus kostet 20 bis 300 Dreiecke, ein Modell 3 000 bis 13 000 (LOD1 800 bis 2 000) |
| Importzeit | Gebäudeschritt nicht eigens gemessen | Skelett je Grundriss: O(n log n), n bis 2 048 Punkte; Ziel höchstens 30 % mehr im Gebäudeschritt |
| Datei | `mass` je Bau Ringe als Zahlen | Teile kommen dazu: Würzburg 237 Teile, Köln 96: wenige kB |

Der Wechsel von Modellen zu `mass` spart Dreiecke und Speicher, kostet aber Shader-Arbeit je Pixel (Fassade im
Fragment-Shader). Messen: `map-load`-Probe vor und nach jedem Schritt auf derselben Karte.

## Zerstörung, E280, Altstadt

- **Zerstörung:** Bauten aus dem Grundriss werden heute schon Ruinen (`mass-layer.ts`, `ruin-damage.ts`); Teile fallen
  mit dem Bau (ein Objekt, eine Gruppe), ein Turmteil darf über die Bruchlinie hinaus fallen wie heute die oberen
  Wände. Ruinen aus OSM sind derselbe Weg mit festem Startzustand. Neue Dachaufsätze brauchen ihre Ruinenform (abgebrochen
  oder weg) im selben Dachprogramm.
- **E280:** keine neuen Programme; die Aufsatz-Geometrien laufen durch den vorhandenen Warm-up (`warmRuins`) mit.
  Weniger Katalogmodelle heißt auch weniger Asset-Ruinen-Programme (Stufe 2 von E280 wird kleiner).
- **Altstadt:** bleibt für gewöhnliche Häuser bis 700 m²; Wahrzeichen nehmen nie die Art `oldtown`. Die neuen
  Fassadenfamilien ersetzen den Einheitsputz von `mass` in der Altstadt nicht, `timber` bleibt.
- **HQ:** das HQ-Angebot setzt das HQ vor das Wahrzeichen (nächster Platz oder Straße außerhalb des Grundrisses, nicht
  im Hof), und ein Wahrzeichen fällt nie wegen der 14 m weg: dann rückt das HQ.
- **Spielregeln:** Dach und Bauverbot lesen `massRoof` (`object-mass.ts`); geneigte Dächer und Aufsätze bekommen dort
  ihre Höhe, damit Tower und Sichtlinien stimmen.

## Schritte

| Schritt | Inhalt | Aufwand |
|---|---|---|
| L1 | Wege durch Gebäude (`building_passage`, `covered`, Platzrand) und kein Rückfall auf schlechte Modelle; Deckung in den Bericht | 1 Tag |
| L2 | Eine Rolle für Wahrzeichen (`building-tags.ts` statt `landmarkKind`), Ruinen nicht mehr weglassen, Anlagenfläche `historic=castle` lesen; HQ vor dem Wahrzeichen | 1 Tag |
| L3 | Abfrage um `building:part` und `type=building` (Version des Rahmenspeichers hoch), Teile an den Grundriss hängen, `MapMass.parts` im Format, Editor und Prüfung | 2 Tage |
| L4 | Dach über beliebigem Umriss (Skelett), Satteldach und Walmdach für Flügel und Höfe, auch für gewöhnliche Häuser | 2 bis 3 Tage |
| L5 | Dachaufsätze (Helm, Kegel, Zwiebel, Kuppel, Zinnen) und ihre Ruinenform im Dachprogramm | 2 Tage |
| L6 | Fassadenfamilien im Wand-Shader (`baroque`, `gothic`, `rubble`, `block`, `house`), Dachfarben und -deckungen, Torbogen als Wandart | 3 Tage, mit Optikrunden |
| L7 | Formerkennung ohne Teile (Ecktürme, angelehnte Türme, Kirchturm am Schiff) | 2 Tage |
| L8 | Schwellen umdrehen (`mass` als Normalfall, Modelle nur bei guter Passung), bessere Zerlegung | 1 bis 2 Tage, danach Messung an vier Orten |

L1 und L2 zuerst: sie beheben das Schloss schon als schlichten Bau mit Hof und kosten wenig. L3 bis L5 machen die
Silhouette, L6 die Optik, L7 und L8 die Breite.

## Offene Fragen an den User

1. **Ein Bauweg für Wahrzeichen und gewöhnliche Häuser** (der erweiterte Bau aus dem Grundriss), Katalogmodelle nur
   noch bei guter Passung? Empfehlung: ja; die Wohngebiete behalten ihre Modelle, Altstädte und Wahrzeichen werden
   überwiegend aus dem Grundriss gebaut.
2. **Durchgänge im Spiel:** sollen Gegner durch `building_passage` laufen (wie ein Tunnel unter dem Haus) oder nur
   der Weg gezeichnet sein? Empfehlung: begehbar wie ein Tunnel, das Haus darüber steht.
3. **Ruinen aus OSM:** sofort als Ruine gebaut (Burg Wertheim, Heidelberg), oder heil, bis das Spiel sie zerstört?
   Empfehlung: als Ruine, im festen Zustand, mit derselben Darstellung wie zerstörte Häuser.
4. **HQ an einem Wahrzeichen:** HQ davor (Platz, Straße) statt im Hof? Empfehlung: davor, das Wahrzeichen bleibt immer
   stehen.
5. **Wie weit die Formerkennung gehen soll**, wenn OSM keine Teile hat (Ecktürme, Kirchturm am Schiff)? Empfehlung:
   Türme nur aus eigenen Turm-Grundrissen und klaren Ausbuchtungen; sonst ein schlichter Bau mit richtigem Dach.
6. **Fassadenfamilien:** fünf neue Familien im Shader (Barock, Gotik, Bruchstein, Blockrand, Haus) oder zuerst nur die
   drei für Wahrzeichen? Empfehlung: zuerst Barock, Gotik, Bruchstein; Blockrand und Haus mit L8, wenn mehr Häuser aus
   dem Grundriss stehen. Abnahme per Baukasten mit Varianten.
7. **Reihenfolge gegen E280:** L1 und L2 vor der Fortsetzung von E280, L5 und L6 danach (sie berühren die Programme)?
   Empfehlung: ja.
