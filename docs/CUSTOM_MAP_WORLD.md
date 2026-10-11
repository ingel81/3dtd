# Eigene Karten im Spiel (CustomMapWorld)

**Status:** Aktuell auf `exp/custom-maps` (Experiment, ab 2026-10-11). Teil von
[WORLD_PROVIDER_PLAN.md](WORLD_PROVIDER_PLAN.md); das Kartendokument beschreibt `map-document.ts`, den
Import aus Warcraft 3 [W3X_IMPORT.md](W3X_IMPORT.md).

`CustomMapWorld` (`src/app/world/custom-map/custom-map-world.ts`) ist der `WorldProvider` für
`WorldRef` `{ kind: 'custom-map', mapId, contentHash }`.

## Start

- `?world=map:<id>` wählt die Karte (`customMapRefFromSearch`), `?spawns=N` begrenzt die Spawns
- `WorldFactory.startHq` öffnet die Karte über den `MapStore`: eigene Karten aus IndexedDB, sonst
  mitgelieferte aus `public/maps/`. Trägt der Ref einen `contentHash` und passt er nicht, bricht der
  Start ab. Fehlt die Karte, zeigt der Startablauf die Meldung (`WorldUnavailableError`) statt eines
  Ladebildschirms ohne Ende
- `create` baut die Welt aus der geöffneten Karte; `WorldContext.open` übernimmt danach `contentHash`
  und Namen der Karte in den Ref
- Ursprung des Laufs ist das HQ der Karte, verschoben auf einen Punkt, dessen Grad die Umrechnung über
  Bogenmaß unverändert übersteht (`stableGeo`, höchstens 11 cm). Grund: die Simulation bekommt den
  Ursprung über `EllipsoidSync.getOrigin` (Grad, Bogenmaß, Grad), der Hauptthread rechnet mit den
  Grad selbst; ein Unterschied im letzten Bit legt Wegpunkte, die genau auf einer 2-m-Zellgrenze liegen
  (Knoten einer Karte auf ganzen Metern), auf beiden Seiten in verschiedene Zellen, und die Simulation
  lehnt die Welt ab

## Startaufstellung

HQ aus `doc.hq`, Spawns aus `doc.spawns` in ihrer Reihenfolge: die ersten `?spawns=N`, ohne Angabe
alle bis `MAX_SPAWN_PORTALS` (32), mehr Portale kann das Spiel nicht zeigen. Weitere Spawns der Karte
bleiben ungenutzt; eine Auswahl im Spiel kommt später.

## Spielwerte (`gameplay`)

Das optionale Feld `gameplay` des Dokuments (`MapGameplay`) setzt Startcredits, HQ-HP, erlaubte
Tower-Typen und die Wellen. Keine Weiche auf die Weltart, die Werte gehen über die vorhandenen Wege:

- `runRules()` macht daraus `RunRules` (`sim/protocol/run-rules.ts`, `runRulesOf`: ganze Zahlen in
  Grenzen, nur bekannte Tower in der Reihenfolge von `TOWER_TYPES`, leere Liste heißt alle). Ohne
  Startcredits, HP und Towerliste gibt es `null`: die Karte spielt die Werte des Spiels.
- Die Regeln reisen in `SimWorld.rules` in den Worker und stehen im Weltschlüssel (`runRulesKey`),
  nur wenn es sie gibt; Tiles und DevWorld haben den Schlüssel wie vorher, alte Replays bleiben gültig.
  Ein Koop-Gast mit anderer Karte oder anderen Werten passt nicht zum Schlüssel des Hosts.
- Im Worker übernimmt `GameStateManager.loadWorld` sie (`takeRunRules`): Start-HP des HQ, Startcredits
  je Spur. Ändern sich die Regeln gegenüber dem Lauf davor, starten HQ und Konten neu.
- Erlaubte Tower: `towerUnlockedBy` ist die eine Prüfung für Simulation (`ResearchManager`) und
  Baumenü (`ResearchStore.runRules`). Ein ausgelassener Typ bleibt gesperrt, auch wenn die Forschung
  ihn freischaltet. Die HQ-Anzeige liest das Maximum aus `WorldContextService.runRules`.
- `worldWaves()`: `budget` setzt die Budget-Quelle, `table` die Tabellen-Quelle mit der Liste der
  Karte (`WaveSourceOptions.table`, `TableWaveSource(table)`). Der Start gibt sie an
  `WaveDirector.useWorldWaves`, der Worker bekommt die Liste über `SimConfig.waveTable`. Eine Liste
  mit Fehlern (`validateWaveTable`) wird mit Warnung übergangen, dann spielt die Wahl des Spielers.

Offen: die Prozentwerte des Druck-Reglers und der Ausgänge rechnen weiter mit
`GAME_BALANCE.player.startHealth`, nicht mit der HP der Karte.

## Darstellung

`CustomMapView` (Renderer der Karte, `render/`) wird beim ersten Anhängen nachgeladen und so
verschoben, dass der Ursprung des Laufs (das HQ) der Ursprung der Szene ist. Darüber
`EnvironmentControls` wie in DevWorld, die Kamera beginnt über dem HQ. `losBlockers()` gibt die ganze
Gruppe der Ansicht (direktes Kind der Szene, der Sichtlinien-Würfel blendet alle anderen aus). Die
Umgebung des Dokuments geht an `view.setEnvironment`.

## Abfragen (`CustomMapSurface`)

- Höhen aus dem Höhenraster der Karte über `HeightField`, dieselben zwei Dreiecke je Zelle, die der
  Renderer zeichnet; allokationsfrei bis auf das Spalten-Objekt, das die Schnittstelle zurückgibt
- Brücken: Kanten der Art `bridge` tragen ein Deck wie im `BridgeLayer` des Renderers (Enden über dem
  Wasser, leichter Bogen); `topY` der Spalte und die Straßenhöhe liegen darauf, `groundY` bleibt der
  Boden darunter
- Sichtlinie über das Gelände (Schritte von einer halben Zelle); Objekte sieht der Sichtlinien-Würfel
- Kein Streaming, keine LOD-Stufen, kein Messen der Straßenbreite (die Kanten haben ihre Breite)

`CustomMapFrame` rechnet Szene und Karte ineinander um: Szene x = Ursprung x - Karte x, Szene z =
Karte y - Ursprung y. Der Kosinus der Ursprungsbreite fehlt: eine Karte reicht höchstens wenige
Kilometer vom Äquator, der Fehler bleibt unter einem Millimeter.

## Straßen (`CustomMapStreets`)

Jede Kante des Wegenetzes wird eine Straße von Knoten a über die Kurvenpunkte zu Knoten b; Knoten, an
denen Kanten zusammentreffen, sind gemeinsam. `width` ist die Breite der Kante, Brücken tragen
`bridge: 'yes'`, Wege den Typ `residential`, Straßen und Brücken `primary`. Routen über die A*-Suche
von `StreetRouter`, wie auf jedem Netz; die Richtung der Kanten zählt dabei nicht (Karten aus dem
Import führen ohnehin zum HQ). Keine Gebäude, Spawn-Namen aus der Karte.

`StreetStyle`: Overlay 0,5 m und Routenlinie 1,5 m über dem Boden, in 4-m-Stücke geteilt (Rampen und
Klippen), Höhen vom Gelände, kein Mitführen der Höhe zum HQ. Die Karte zeichnet ihre Straßen selbst;
das gelbe Straßen-Overlay ist eine Debug-Ebene und standardmäßig aus, es entsteht also nichts doppelt.

## Fähigkeiten

Kein echter Ort (keine Ortssuche, kein Speichern über den Ort, kein Globus), keine Zugangsdaten, kein
ECEF, kein Streaming, nicht neu würfelbar, nicht zerstörbar, `controls: 'environment'`. Unter der Karte
steht ihr Name und Autor; der OSM-Hinweis erscheint nur auf echten Orten.

## Geprüft

Specs in `custom-map-world.spec.ts`: Frame gegen `geoToLocalSimple`, Höhen nach Geo und Szene,
Brückendeck, Sichtlinie, Bodenpick, Straßennetz und Route über Kurvenpunkt und Brücke,
Startaufstellung, Spawn-Grenze, Spielwerte und Wellen der Karte, Öffnen einer gespeicherten, fehlenden und geänderten
Karte. Im Browser (Dev-Server, die importierte Testkarte in IndexedDB): Karte lädt in 12 bis 18 s (Dev-Server),
8 Portale, Wellen laufen die Wege zum HQ, gebaute Tower schießen.
