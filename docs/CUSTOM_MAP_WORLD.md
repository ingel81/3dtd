# Eigene Karten im Spiel (CustomMapWorld)

**Status:** Aktuell, seit 0.7.0 auf `main`, im Spiel gesperrt bis zur Freigabe (TODO E134); die nächste Runde plant [CUSTOM_MAPS_NEXT_PLAN.md](CUSTOM_MAPS_NEXT_PLAN.md) (E154). Teil von
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
bleiben ungenutzt.

## Spurenwahl (E130)

Volle Last je offener Spur: jede offene Spur bringt die ganze Welle. Dafür wählt der Spieler vor Welle 1, welche Spuren
offen sind.

- **Karte:** ein Spawn mit `optional: true` darf geschlossen werden, ohne das Feld ist er immer offen.
  `gameplay.lanes`: `min` (Standard 1), `max` (Standard alle) offene Spuren, `vacant` für Spuren, die im Koop niemand
  hält: `close` (Standard), `host`, `split`. Die gemeinsame Regel steht in `world/custom-map/lane-choice.ts`
  (`laneChoiceOf` hält die Grenzen in dem, was die Spawns erlauben; `defaultOpenLanes`: immer offene, dann optionale
  in Reihenfolge bis `max`; `laneChoiceProblem`, `toggledLanes`).
- **Welt:** `WorldProvider.lanes()` (`WorldLanes`: Wahl, offene Spuren, `setOpen`), `null` auf echten Orten und in
  DevWorld. `CustomMapWorld.startLayout()` gibt nur die offenen Spawns, jeder mit `slot` (Platz in der Liste der
  Karte, der die Farbe bestimmt, damit eine Spur ihre Farbe behält).
- **Spiel:** `app-lane-choice` im Wellen-Panel vor Welle 1, nur auf Karten mit optionalen Spuren, nicht für einen
  Koop-Gast und nicht im Koop-Spiel (`coopMapLocked`). Ein Schalter ruft `LocationFacadeService.setOpenLanes`;
  `MapRelocationService.applyLayoutSpawns` baut Spawns, Routen und den Lauf mit den eigenen Ids und Namen neu. Eine
  geschlossene Spur ist wie entfernt: kein Portal, keine Route. Darunter der Hinweis zur Last
  („3 lanes open: each brings a full wave, 3 times the enemies“).
- **Koop:** Der Host wählt in der Lobby (die Karte geht wie bei jeder Spawn-Änderung an die Gäste). Freie Spuren
  halten den Start nicht auf, wenn die Karte Spuren bringt (`CoopService.vacantRule`). Beim Start:
  `close` schließt sie (auch immer offene; eine bleibt), die Gäste bekommen die Karte neu und sagen wieder bereit, der
  Host startet erneut; `host` lässt den Host sie vor dem Start nehmen; `split` schickt `vacant: 'split'` mit dem
  Start, das Relay verteilt sie reihum ab dem Host (`Room.shareOutLanes`). Ein Relay vor diesem Stand kennt das Feld
  nicht und lehnt den Start ab.
- Die Wahl gilt für die Seite: ein Neuladen beginnt wieder bei `defaultOpenLanes`.

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

## Viele Spuren: Optionen

**Stand:** Rechnung und vorbereitete Option (2026-10-11), standardmäßig aus. Entscheidung offen für den User.

**Wie das Spiel heute rechnet:**

- Allein ist jeder Spawn eine Spur, und jede Spur bekommt die ganze Welle.
- Die Budget-Quelle plant jede Spur gegen 1/N der Abwehr (`shareDefense`) und 1/N der HQ-HP (`hpRemaining`).
- Startgeld und Kill-Gold kommen je Spur, also N-fach; das Abschlussgold kommt einmal.
- Die Lecks aller Spuren gehen auf das eine HQ.

Der w3x-Import schneidet seine Wellen schon auf 1/Wurzel(N) je Spur (`wave-convert.ts`). Eine Karte mit 10 Spuren und
Budget-Wellen (Mafa) war ab Welle 3 verloren.

**Rechnung:** `tools/balance-calc/lanes.ts`, Tabelle mit
`BALANCE_OUT=<dir> npx vitest run tools/balance-calc/lanes.spec.ts`. Grundlage ist die echte Budget-Quelle gegen die
Abwehr des menschlichen Laufs vom 2026-10-01:

- Die Abwehr wird mit dem Gold mal N genommen und gleichmäßig auf die Spuren verteilt.
- Die Leck-Schätzung ist die des Rechners (`tools/balance-calc/README.md`).
- Die Aufbauwellen W1 bis W7 kosten je Spur ihren aufgezeichneten Verlust mal dem Anteil der Körper.

Die Annahme zu den Aufbauwellen ist die unsicherste; deshalb steht die Rechnung auch ohne sie da (`buildUpWaves` 0).

HQ nach W3 / 5 / 10 / 20 / 30 / 40 und Tod, mit den aufgezeichneten Aufbauverlusten:

| Variante | 1 Spur | 2 Spuren | 4 Spuren | 10 Spuren |
|---|---|---|---|---|
| heute | 500/485/363/331/247/166, lebt | 469/227/217/132/41 bei W40, Tod W44 | Tod W7 | Tod W6 (W5: 346) |
| (a) Wellenanteil 1/Wurzel(N) | wie heute | 307 bei W10 und W20, 181 bei W30, 156 bei W40, Tod W60 | 227 bei W10 und W20, 1 ab W30, Tod W60 | 68 bei W10 bis W29, Tod W30 |
| (b) doppeltes Start- und Kill-Gold | wie heute | wie heute | wie heute | wie heute |
| (c) Leckschaden 1/N (nicht gebaut) | wie heute | 485/363/331/243/167, lebt | 485/363/333/249/172, lebt | 485/363/342/219/169, lebt |

Ohne Aufbauverluste:

| Variante | 2 Spuren | 4 Spuren | 10 Spuren |
|---|---|---|---|
| heute | Tod W55 | 397 bei W10, Tod W44 | 443 bei W10, 69 bei W20, Tod W22 |
| (a) Wurzel | 460 bei W10, 280 bei W40 | 420 bei W10, 194 bei W30, Tod W60 | 300 bei W10, Tod W30 |
| (c) 1/N | 474/349/243/175 | 474/354/249/180 | 474/357/253/183 |

Eine Spur in allen Varianten: 474/342/263/191.

**Was die Zahlen sagen:**

- **(a) Wurzel** hält einen Spieler auf vielen Spuren über die ersten Wellen, aber nicht bei vergleichbarer Last.
  Bei 10 Spuren kosten die Aufbauwellen 432 HP (eine Spur: 137). Danach liegt die Last je Spur bei 0,3 bis 0,55 und
  es leckt nichts mehr. Der Druck-Regler öffnet bis 2,5, und die erste schwere Welle (W30, Last 1,23) beendet den
  Lauf auf dem Rest-HQ. Zwischen W11 und W29 hat der Spieler keine Spannung, danach eine Wand.
- **(b) Gold** ändert in der Rechnung nichts: Die Budget-Quelle bemisst die HP gegen die Abwehr, mehr Tower bringen
  mehr HP. Die Aufbauverluste hängen in der Rechnung nicht vom Gold ab; im Spiel hilft mehr Startgeld dort,
  wie viel, kann die Rechnung nicht sagen. Startgeld und Kill-Gold je Spur sind heute schon so gebaut.
- **(c) Leckschaden 1/N** hält jede Spurzahl auf der Kurve einer Spur (Abweichung höchstens 28 HP bis W40). Das ist
  der einzige der drei Hebel mit vergleichbarer Last. Er ist nicht gebaut: Der Leckschaden entsteht in der
  Simulation, er gehörte als Lauf-Regel in die `RunRules` (Weltschlüssel) und gilt nur für Karten, die ihn wählen.

**Entschieden (2026-10-11):** volle Last je offener Spur bleibt, auch kein Leckschaden 1/N. Die vorbereitete Option
`gameplay.laneScaling: 'sqrt'` ist entfernt (E130); ein altes Kartendokument mit dem Feld liest sich weiter, das Feld
wirkt nicht. Stattdessen wählt der Spieler vor Welle 1, welche Spuren offen sind (siehe Spurenwahl). Die Variante (a)
rechnet nur noch `tools/balance-calc/lanes.ts`.

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

## Zerstörbarkeit (E131)

Eine Karte sagt es selbst: `gameplay.destructible: true` (im Editor unter Rules, „World“). Der frühere Link-Schalter
`?destructible` ist entfallen. Mitgeliefert zerstörbar: die Endzeit-Stadt (`ruined-city`).

- **Bauwerke:** die Objekte, deren Katalogeintrag `building`, `wall` oder `structure` ist (`CustomMapDestruction`);
  HP nach dem Volumen als Zylinder aus Grundradius und Höhe, 60 bis 3000. Die Welt lädt den Katalog vor dem Senden an
  die Simulation (`attach` wartet darauf).
- **In der Simulation:** Die Bauwerke reisen in den Lauf-Regeln (`RunRules.structures`, `asRunStructures`) und damit
  im Weltschlüssel (`runRulesKey`, ein Digest aus Id, Ort, Radius, HP); ein Koop-Gast baut dieselbe Liste aus derselben
  Karte. `StructureLedger` (managers/game-state) hält die HP: jeder `vfx:projectile-impact` der Simulation nimmt jedem
  stehenden Bauwerk in 4 m plus seinem Radius 20 HP, bei 0 fällt es. Snapshot (`SimSnapshot.structures`) und
  Zustands-Hash (Teil `health`, `STATE_HASH_VERSION` 6) tragen die HP; ein neuer Lauf stellt alle auf.
- **Zum Hauptthread:** Op `structures.setFallen(ids)` mit der ganzen Menge der gefallenen (auch nach Restore und
  Replay-Sprung, `resyncPresentation`), dazu im Moment des Falls der flüchtige Op `main.structureFell` (Explosion in
  der Größe, im stummen Replay-Sprung weggelassen). `WorldDamagePresenter` reicht die Menge an
  `WorldDestruction.setFallen`: Neues fällt (schrumpft auf `FALLEN_SCALE`, blockiert das Bauen nicht mehr), was nicht
  mehr in der Menge ist, steht wieder.
- **Sichtlinien:** Tower, deren Reichweite plus Bauwerksradius den Fall erreicht, fragen ihre Sicht neu an
  (`TowerLos.recompute`, Grund `world`; ein Tower, der noch auf seine erste wartet, bleibt bei `place`).
- **Debug:** In der Entwicklung trifft `__worldDamage.hit(lat, lon, reach, amount)` über die Simulation
  (`debug:hit-structures`, im Koop ein Cheat); `structures()` zeigt die HP (gefallen 0, stehend die volle).

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
Westen links); Tiles und DevWorld geben `null`. Auf echten Orten (E142) zeichnet die Minikarte ihr Bild selbst aus OSM
(`components/world-minimap/osm-minimap.ts`): dunkler Grund, Gebäude als Flächen (die Footprints nahe der Routen, die
`BuildingOverlay` jetzt nach jedem Routenwechsel lädt, auch bei ausgeschalteter Ebene), Straßen als Linien (Hauptstraßen
breiter, Fußwege nicht), als Quadrat um HQ, Spawns und Routen mit Rand, mindestens 400 m; ebenso in DevWorld, deren
Straßen erzeugt sind. Die Szene hat Norden bei +Z und Osten bei -X, das Rechteck (`osmArea`) legt deshalb links den
größeren X-Wert an. Der Ebenen-Knopf schaltet auf eine Straßenkarten-Ansicht (`minimapLook: 'map'`): helle Gebäude und Straßen,
Straßen 12 m und Nebenstraßen 7 m breit mit dunklem Rand, Farben `TD_THEME.map*`. Die eigene Karte rendert sie einmal
nach ihrem ersten gezeichneten Bild (`custom-map-minimap.ts`): orthografisch von oben, nur die Szenenkinder, die
`view.attach` und `environment.apply` angehängt haben (Gelände, Wasser, Objekte, Licht), 512 px an der längeren
Seite. Sie braucht keine eigenen Shader-Programme: der Nebel bleibt mit Dichte 0 an der Szene, alle Lichter bleiben an
(Nebel und Zahl der Lichter gehören zum Programm), und das Ziel ist wie das der Bilder: ohne Nachbearbeitung gilt es
three als Bildschirm (`isXRRenderTarget`, sRGB heraus), mit Bloom oder Grading ist es ein lineares Ziel wie das des
Composers (danach nach sRGB gewandelt). Mit eigenem Programm je Material warteten kalte Ladevorgänge 3 bis 4 s auf
deren Linken.

`app-world-minimap` (unter dem Kompass, `td-overlay`) zeichnet jeden Frame außerhalb Angulars in ein Canvas: Bild,
Routen in der Farbe ihres Spawns, Spawns und HQ einmal in ein Grundbild (neu, wenn Welt, Routen oder HQ wechseln),
Tower und Gegner höchstens alle 50 ms in ein Punkte-Canvas (Bosse größer, je Bildpunkt höchstens ein Gegner gezeichnet),
darüber jeden Frame das Sichtfeld der Kamera (die vier Bildecken auf der Bodenhöhe des HQ). Ein Klick führt die Kamera per `focusGeo` dorthin, Ziehen mit gedrückter Taste setzt sie sofort
mit (`focusGeo(lat, lon, true)`, Pointer Capture). Das Minus klappt sie zu einem Stein „Map“ ein (`minimapOpen`), offen
und Ansicht bleiben im UI-Store gespeichert.

## Laden

**Kartendaten nachladen (Vorbereitung E134, 2026-10-12):** `world/custom-map/map-data.ts`. `maps/index.json`, die
mitgelieferten Karten und `maps/assets/` (rund 190 MB) kommen über `mapDataFetch`: aus der Cache Storage des Browsers
(`3dtd-map-data-<Version>`), sonst vom Netz und dann dort abgelegt. Der Index fragt zuerst das Netz (offline der
Cache), eine mitgelieferte Karte wird mit ihrem Inhalts-Hash angefragt (`?v=`), Modelle laufen über denselben Weg
(`loadGlb` mit `parseAsync`). Woher: `mapData` in `runtime-config.json`, sonst neben der Seite (der Dev-Server liefert
`public/maps`). Ein neuer Build beginnt mit leerem Cache, `dropOldMapData` räumt die alten (beim Lesen der
runtime-config). Die Ladeplatte zeigt „Map data 12 of 48 files, 3.4 MB“, solange Dateien vom Netz kommen. Die
Desktop-App hält die Cache Storage im Profil auf der Platte (`app://` ist als sicheres Schema registriert).
Jede Datei hinterlässt ein `performance.measure` `map-data <Quelle> <Pfad>` (Quelle `cache`, `network`, `stale` oder
`failed`, Bytes im `detail`; vom Netz der ganze Download, aus dem Cache das Nachschlagen): ein langsamer Start nennt
die Datei und woher sie kam. `e2e/perf/shipped-maps.ts` druckt dazu je Ladevorgang Dateien, MB und summierte ms je
Quelle und die langsamsten Dateien (2026-10-14, optimierter Dev-Stand, frischer Browser-Kontext: Demo-Tal 60 Dateien,
20,2 MB, Hafenstadt 83 Dateien, 19,2 MB, alle vom Netz, kalt 4,4 und 4,7 s).
Offen für die Freigabe: die Daten auf den Webserver legen, dort CORS für die Seite und `app://`, im CSP der
Desktop-App (`desktop/src/protocol.js`, `connect-src`) den Host eintragen, `mapData` in die runtime-config.

- `startHq` öffnet die Karte und beginnt sofort, ihre Bodenmaterialien und Modelle zu laden
  (`prefetchCustomMapAssets`), während Engine, Straßen und Routen entstehen
- Die Karte zeichnet ihr erstes Bild erst, wenn ihre Texturen und Modelle da sind und alle ihre
  Shader-Programme parallel abseits des Hauptthreads übersetzt sind (`compileAsync` mit
  `KHR_parallel_shader_compile`, die ganze Szene wie `view.warmUp`); bis dahin hält `ready()` die Bilder zurück.
  Vorher übersetzte jedes neue Material sein Programm synchron im ersten Bild, das es zeigte. Zeichnen die Bilder
  durch die Nachbearbeitung (Bloom oder Grading an, `WorldAttachContext.drawsToTarget`), wird für ein lineares Ziel
  übersetzt, sonst linkt das erste Bild alles neu; die Engine bekommt die gespeicherten VFX-Einstellungen deshalb
  schon beim Anlegen. Kalt mit Bloom: 9,4 bis 17,6 s vorher, 5,6 bis 5,7 s danach (Demo-Tal)
- Beim Verlassen gibt die Welt die geteilte `MapAssetLibrary` frei (etwa 88 MB Materialpixel); die nächste Karte
  legt eine neue an
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
- `buildBlocker` sagt, warum ein Tower nicht stehen darf, `null` wo er darf. Die Platzierungsregel fragt mit
  dem Radius eines Towers (3 m, `PLACEMENT_CONFIG.TOWER_BUILD_RADIUS`) und zeigt den Grund als Hinweis:
  - „Water there“ (`inWater`): die Mitte oder ein Punkt des Rings (0,7 x Radius) liegt in einem Gewässer
    (`terrain.water` und `waterBodies`, jede Art auch Eis und Lava: Maske gesetzt und Boden mehr als
    0,3 m unter dem Spiegel, `WATER_DEPTH_M`), oder näher an der Linie eines Flusses (`terrain.rivers`)
    als seine halbe Breite plus der halbe Towerradius. Flache Ufer bleiben bebaubar, Brücken nicht
  - „Something stands there“: Objekte, die das Bauen verbieten (eigenes `blocksBuild`, sonst das ihres
    Katalogeintrags), als Scheiben aus Grundfläche mal Skala in 16-m-Feldern
  - Tiles und DevWorld antworten immer `null` (Tower stehen dort auf Dächern)

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
ECEF, kein Streaming, nicht neu würfelbar, zerstörbar nur mit `?destructible`, `controls: 'environment'`.
Unter der Karte stehen ihr Name und Autor und „Assets: CC0, see licences“; der OSM-Hinweis erscheint nur
auf echten Orten.

## Koop, Spielstand, Replay

- Koop: Der Host schickt die Karte über das Relay in Stücken, der Gast legt sie in seinen Map-Store und
  lädt die Seite auf ihr neu ([COOP_PLAN.md](COOP_PLAN.md) C1c). Ein Gast ohne Cesium-Token wartet auf
  keinen Schlüssel (`capabilities.credentials`).
- Spielstand und Replay tragen den `WorldRef` mit `contentHash`; eine geänderte Karte lehnt der Start ab.
  Die Spielwerte stehen im Dokument und damit im Hash.

## Geprüft

Specs in `custom-map-world.spec.ts`: Frame gegen `geoToLocalSimple`, Höhen nach Geo und Szene,
Brückendeck, Sichtlinie, Bodenpick, Straßennetz und Route über Kurvenpunkt und Brücke,
Startaufstellung, Spawn-Grenze, Spielwerte und Wellen der Karte, Fallen und Aufstehen von Bauwerken auf
der eigenen Kopie, Öffnen einer gespeicherten, fehlenden und geänderten Karte; dazu
`custom-map-destruction.spec.ts`, `world-damage-presenter.spec.ts`, `map-trial.spec.ts`,
`world-choice.service.spec.ts`, `map-picker.scenario.spec.ts`.

E2E ohne Kartensitzung (`e2e/tests/custom-map.e2e.ts`): Demo-Tal per Link mit Tower und Welle, Kartenprobe
des Bots, „Test map“ aus dem Editor, Spielstand speichern und laden, Replay einer Welle, ein Bauwerk von
`?destructible` fällt per Debug-Treffer und steht nach „Restart here“ wieder, Koop auf einer eigenen
Kopie des Demo-Tals mit einem Gast ohne sie (Kartenversand, eine Welle, kein DESYNC). Im Browser (Dev-Server, die importierte Testkarte in IndexedDB): Karte lädt in 12 bis 18 s (Dev-Server),
8 Portale, Wellen laufen die Wege zum HQ, gebaute Tower schießen.
