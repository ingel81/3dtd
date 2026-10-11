# Eigene Karten im Spiel (CustomMapWorld)

**Status:** Aktuell auf `exp/custom-maps` (Experiment, ab 2026-10-11). Teil von
[WORLD_PROVIDER_PLAN.md](WORLD_PROVIDER_PLAN.md); das Kartendokument beschreibt `map-document.ts`, den
Import aus Warcraft 3 [W3X_IMPORT.md](W3X_IMPORT.md).

`CustomMapWorld` (`src/app/world/custom-map/custom-map-world.ts`) ist der `WorldProvider` für
`WorldRef` `{ kind: 'custom-map', mapId, contentHash }`.

## Start

- `?world=map:<id>` wählt die Karte (`worldRefFromSearch`), `?spawns=N` begrenzt die Spawns
- Im Hauptmenü: New game, Reiter „Maps“ (`MapPickerComponent`, `WorldChoiceService`).
  - Gelistet sind eigene Karten aus dem Map-Store, die mitgelieferten aus `maps/index.json` (eine eigene
    gleicher id verdeckt sie) und die eigenen Tilesets der Konfiguration.
  - Jede Zeile zeigt Bild, Name, Autor, Größe, Spawn-Zahl und Biom (`MapSummary.spawns`, `biome`; der Index
    trägt beide).
  - „Play“ lädt die Seite mit `?world=…` neu, ein Tileset in der Mitte seines Gebiets. „Edit“ öffnet
    `/editor?map=<id>`.
  - Auf einer Karte zeigt der Reiter „Real places“ statt der Ortswahl den Weg zurück zu den Kacheln.
- `WorldFactory.startHq` öffnet die Karte über den `MapStore`: eigene Karten aus IndexedDB, sonst
  mitgelieferte aus `public/maps/`. Trägt der Ref einen `contentHash` und passt er nicht, bricht der
  Start ab. Fehlt die Karte, zeigt der Startablauf die Meldung (`WorldUnavailableError`) statt eines
  Ladebildschirms ohne Ende
- `create` baut die Welt aus der geöffneten Karte; `WorldContext.open` übernimmt danach `contentHash`
  und Namen der Karte in den Ref
- Ursprung des Laufs ist das HQ der Karte. `EllipsoidSync` legt den Ursprung einmal über Grad, Bogenmaß,
  Grad fest; Hauptthread und Simulation rechnen mit denselben Bits, sodass Wegpunkte auf 2-m-Zellgrenzen
  (Knoten einer Karte auf ganzen Metern) auf beiden Seiten in derselben Zelle liegen

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

Alle Anteile an der HQ-HP rechnen mit der HP des Laufs (`RunRules.hqHealth`), nicht mit
`GAME_BALANCE.player.startHealth`:

- in der Simulation die Knapp-Grenze am Wellenende (`closeCallHp(max)`, `WaveManager`) und der
  Trostpreis (`EconomyService.computeWaveCompletionBonus`)
- auf dem Hauptthread die Ausgänge der Welle (`WaveOutcomeTracker`: `damagePercent`, `wasCloseCall`),
  der Spielerzustand des Snapshots (`playerState`), `GameStore.healthPercent` und `healthCritical`
  (aus `GameStore.maxHealth`, gesetzt beim Öffnen der Welt) und das HQ-Feuer

Der Druck-Regler selbst misst gegen die HP zu Wellenbeginn und braucht kein Maximum. Ohne eigene
Regeln ist das Maximum `startHealth`, die Rechnung bleibt bitgleich: Tiles, DevWorld und alte Replays
ändern sich nicht.

## Kartenprobe (`?bot=trial`)

`?world=map:<id>&bot=trial&trialWaves=N` lässt den Experten-Bot die ersten N Wellen (Standard 10, höchstens
50) der Karte allein spielen, mit Timescale 75 und ohne Bot-Server; der Tab läuft auch versteckt weiter.
Die Probe gilt für jede Welt ohne echten Ort (`capabilities.realPlace` aus), also auch DevWorld. Sie
zählt ab `game:started`, die Start-HP kommen aus den Spielwerten der Karte (`MapTrial`,
`world/map-trial.ts`). Ergebnis `MapTrialResult`:

- `passed`: N Wellen gehalten
- `lost`: das HQ fiel vorher
- `stuck`: fünf Minuten Wanduhr lang endete keine Welle

Dazu kommen die HQ-HP am Ende, die verlorenen HP je Welle, die Zahl der Tower und die Spielzeit. Danach
stoppt der Bot, die Spielgeschwindigkeit geht auf 1, und das Spiel bleibt stehen, wie es ist. Das
Ergebnis landet an vier Stellen:

- als Zeile im Banner
- auf der Konsole (`[MapTrial] {...}`)
- in `window.__mapTrial`
- per `postMessage({ type: '3dtd-map-trial', result })` an das öffnende Fenster oder den Rahmen. Darüber
  kann der Editor später mit „Karte prüfen“ die Probe in einem Tab oder iframe öffnen und das Ergebnis
  lesen.

## Zerstörbarkeit (`?destructible`, Experiment)

Die Schnittstelle gilt für jede Welt: `capabilities.destructible` und `WorldProvider.destruction`
(`WorldDestruction`: `structures()`, `damage(at, radius, amount)` gibt die gefallenen zurück, `reset()`).
Tiles und DevWorld haben `null`.

Eine eigene Karte wird zerstörbar, wenn der Link `?destructible` trägt (`customMapDestructible`). Eine
Einstellung im Kartendokument gibt es dafür noch nicht.

- **Bauwerke:** Bauwerke sind die Objekte, deren Katalogeintrag `building`, `wall` oder `structure` ist
  (`CustomMapDestruction`). Ihre HP folgen dem Volumen als Zylinder aus Grundradius und Höhe, 60 bis 3000.
- **Schaden:** Ihn verteilt `WorldDamagePresenter` (presentation/) auf dem Hauptthread. Jeder
  `vfx:projectile-impact` des Main-Bus, auf einem Gegner oder auf dem Boden, nimmt jedem stehenden Bauwerk im
  Umkreis 20 HP. Der Umkreis ist 4 m plus der Radius des Bauwerks.
- **Fallen:** Ein Bauwerk bei 0 HP explodiert in seiner Größe. Danach schrumpft es in der Ansicht auf
  fast nichts (`FALLEN_SCALE`, `view.updateObject`) und blockiert das Bauen nicht mehr. Der Boden darunter
  bleibt.
- **Neuer Lauf:** `game:reset` stellt alle wieder auf.
- **Kopie der Karte:** Die Welt arbeitet auf ihrer eigenen Kopie der Objektliste. Die geöffnete Karte und ihr
  Inhalts-Hash bleiben unberührt.
- **Debug:** In der Entwicklung listet `__worldDamage` in DevTools die Bauwerke und trifft einen Punkt
  (`structures()`, `hit(lat, lon, radius, amount)`).

Grenzen:

- Nur Darstellung und Bausperre: Die Simulation weiß von keinem Bauwerk. Die Fälle folgen den Ereignissen
  der Simulation und sind damit in Koop und Replay dieselben. Ein Sprung im Replay (Snapshot) stellt sie
  aber nicht wieder her.
- Die Sichtlinien der Tower lesen die Ansicht: Wann ein gefallenes Bauwerk dort fehlt, hängt davon ab,
  wann der Sichtwürfel des Towers neu gerendert wird. Für ein Spielfeature müsste der Fall in die
  Simulation (Weltschlüssel, Sichtlinien neu je Fall).
- Gegner richten keinen eigenen Schaden an, nur Einschläge. Auf der Demo-Karte stehen die Häuser abseits
  der Straßen; dort fiel in 8 Wellen nichts.

## Darstellung

`CustomMapView` (Renderer der Karte, `render/`) wird beim ersten Anhängen nachgeladen und so
verschoben, dass der Ursprung des Laufs (das HQ) der Ursprung der Szene ist. Darüber
`EnvironmentControls` wie in DevWorld, die Kamera beginnt über dem HQ; der Intro-Flug startet am HQ
und landet in der Übersicht über HQ, Spawns und Routen, wie auf echten Orten. `view.attach(scene)`
hängt die Gruppe und die Sichtblocker (Gelände, blockierende Objekte) als direkte Kinder an die
Szene; `losBlockers()` gibt die Sichtblocker (der Sichtlinien-Würfel blendet alle anderen Kinder
aus). Himmel, Sonne mit Schatten, Licht und Nebel bringt die Karte mit
(`view.environment.apply`); die Fähigkeit `ownEnvironment` sagt der Engine, dass sie ihre eigenen
Lichter und ihren Himmel weglässt.

## Minikarte

`WorldProvider.minimap()` gibt die Draufsicht einer Welt mit dem Szenen-Rechteck, das sie zeigt (Norden oben,
Westen links); Tiles und DevWorld geben `null`, dann bleibt die Minikarte weg. Die eigene Karte rendert sie einmal
nach ihrem ersten gezeichneten Bild (`custom-map-minimap.ts`): orthografisch von oben, nur die Szenenkinder, die
`view.attach` und `environment.apply` angehängt haben (Gelände, Wasser, Objekte, Licht), ohne Nebel, 512 px an der
längeren Seite, aus dem linearen Render-Target nach sRGB gewandelt.

`app-world-minimap` (unter dem Kompass, `td-overlay`) zeichnet in ein Canvas mit eigenem 10-Hz-Takt außerhalb
Angulars: Bild, Routen in der Farbe ihres Spawns, Spawns und HQ einmal in ein Grundbild (neu, wenn Welt, Routen
oder HQ wechseln), je Takt darauf Tower, Gegner (Bosse größer, alle in einem Pfad je Farbe) und das Sichtfeld der
Kamera (die vier Bildecken auf der Bodenhöhe des HQ). Ein Klick führt die Kamera per `focusGeo` dorthin.

## Laden

- `startHq` öffnet die Karte und beginnt sofort, ihre Bodenmaterialien und Modelle zu laden
  (`prefetchCustomMapAssets`), während Engine, Straßen und Routen entstehen
- Die Karte zeichnet ihr erstes Bild erst, wenn ihre Texturen und Modelle da sind und alle ihre
  Shader-Programme parallel abseits des Hauptthreads übersetzt sind (`compileAsync` mit
  `KHR_parallel_shader_compile`); bis dahin hält `ready()` die Bilder zurück. Vorher übersetzte jedes
  neue Material sein Programm synchron im ersten Bild, das es zeigte
- Höhen für das Overlay: eine Runde sofort statt vier Runden zu 500 ms, weil der Boden nicht streamt
  (`HeightUpdateService`, `capabilities.streaming`)
- Messen: `e2e/perf/map-load.ts` gegen einen Produktions-Build (Schritte als `performance.mark`
  `load:<schritt>`, mit `--profile` die CPU-Zeit je Funktion). Stand 2026-10-11, Chromium mit Fenster:
  2,3 bis 2,9 s bis spielbar, beim ersten Start des Browsers 3,1 bis 3,8 s (vorher 7,6 bis 9,3 s beim
  Demo-Tal)

## Abfragen (`CustomMapSurface`)

- Höhen aus dem Höhenraster der Karte über `HeightField`, dieselben zwei Dreiecke je Zelle, die der
  Renderer zeichnet; allokationsfrei bis auf das Spalten-Objekt, das die Schnittstelle zurückgibt
- Brücken: Kanten der Art `bridge` tragen ein Deck wie im `BridgeLayer` des Renderers (Enden über dem
  Wasser, leichter Bogen); `topY` der Spalte und die Straßenhöhe liegen darauf, `groundY` bleibt der
  Boden darunter
- Sichtlinie über das Gelände (Schritte von einer halben Zelle); Objekte sieht der Sichtlinien-Würfel
- Kein Streaming, keine LOD-Stufen, kein Messen der Straßenbreite (die Kanten haben ihre Breite)
- `isBuildBlocked`: Objekte, die das Bauen verbieten (eigenes `blocksBuild`, sonst das ihres
  Katalogeintrags), als Scheiben aus Grundfläche mal Skala in 16-m-Feldern; die Platzierungsregel
  fragt mit dem Radius eines Towers (3 m, `PLACEMENT_CONFIG.TOWER_BUILD_RADIUS`): „Something stands
  there“. Tiles und DevWorld antworten immer nein (Tower stehen dort auf Dächern)

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
